import axios from "axios";
import localforage from "localforage";

import { USA0_ORIGIN } from "@/constant/runtime-config";
import { redactUsa0Secrets } from "@/services/api/usa0-runtime";

export { USA0_ORIGIN };
export const USA0_WEBSITE_URL = `${USA0_ORIGIN}/home`;
export const USA0_CLIENT_ID = "zero-canvas-web";
export const USA0_SCOPES = "profile:read groups:read keys:read keys:write offline_access";

const authStorage = localforage.createInstance({ name: "infinite-canvas-auth", storeName: "usa0_session" });

export type Usa0PersistedSession = {
    refreshToken: string;
    expiresAt: number;
    installationId: string;
    sessionId: string;
    accountId?: number;
    revision?: number;
};

export type Usa0TokenResponse = {
    access_token: string;
    refresh_token?: string;
    token_type: string;
    expires_in: number;
    scope: string;
};

export type Usa0Profile = {
    id: number;
    email: string;
    username: string;
    avatar_url?: string;
};

export type Usa0Group = {
    id: number;
    name: string;
    platform: string;
};

export type Usa0ApiKey = {
    id: number;
    name: string;
    group_id: number | null;
    status: string;
    quota: number;
    quota_used: number;
    expires_at: string | null;
    group?: Usa0Group | null;
};

export type Usa0ApiKeyCredential = Usa0ApiKey & { key: string };

export type Usa0KeysResult = {
    keys: Usa0ApiKey[];
    credentials: Map<number, string>;
};

export type Usa0CreateKeyResult = {
    key: Usa0ApiKey;
    credential: string;
};

export type Usa0Model = {
    name: string;
    platform: string;
    capabilities: Array<"text" | "image" | "video" | "audio">;
};

type Usa0UsageValue = number | string | null;

export type Usa0UsageTotals = {
    requests?: Usa0UsageValue;
    input_tokens?: Usa0UsageValue;
    output_tokens?: Usa0UsageValue;
    cache_creation_tokens?: Usa0UsageValue;
    cache_read_tokens?: Usa0UsageValue;
    total_tokens?: Usa0UsageValue;
    actual_cost?: Usa0UsageValue;
};

export type Usa0KeyUsage = {
    mode?: string;
    status?: string;
    planName?: string;
    balance?: Usa0UsageValue;
    remaining?: Usa0UsageValue;
    quota?: { limit?: Usa0UsageValue; used?: Usa0UsageValue; remaining?: Usa0UsageValue } | null;
    usage?: { today?: Usa0UsageTotals; total?: Usa0UsageTotals } | null;
    daily_usage?: Array<Usa0UsageTotals & { date: string }>;
};

type ApiEnvelope<T> = { success?: boolean; data?: T; message?: string; error?: { code?: string; message?: string } };
type PaginatedResult<T> = { items: T[]; total: number };
type AuthorizationRequestResult = { request_id: string };
type GatewayModel = { id?: string; name?: string; display_name?: string };
type OAuthCallbackMessage = { type: "usa0-oauth-callback"; code?: string; state?: string; error?: string };

export class Usa0RequestError extends Error {
    constructor(
        message: string,
        public readonly status?: number,
    ) {
        super(message);
    }
}

export async function getPersistedUsa0Session() {
    return authStorage.getItem<Usa0PersistedSession>("session");
}

export async function savePersistedUsa0Session(session: Usa0PersistedSession) {
    await authStorage.setItem("session", session);
}

export async function clearPersistedUsa0Session() {
    await authStorage.removeItem("session");
}

export async function getOrCreateInstallationId() {
    const existing = await authStorage.getItem<string>("installation_id");
    if (existing) return existing;
    const value = crypto.randomUUID();
    await authStorage.setItem("installation_id", value);
    return value;
}

export function getOAuthRedirectUri() {
    const url = new URL(window.location.origin);
    const loopbackHttp = url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
    if (url.protocol !== "https:" && !loopbackHttp) throw new Error("USA零账号登录仅支持 HTTPS 或本机 HTTP 地址");
    return `${url.origin}/oauth/callback`;
}

export async function authorizeUsa0WithPopup() {
    const redirectUri = getOAuthRedirectUri();
    const popup = window.open("about:blank", `usa0-oauth-${crypto.randomUUID()}`, "popup=yes,width=520,height=720");
    if (!popup) throw new Error("登录窗口被浏览器拦截，请允许弹窗后重试");
    let navigated = false;
    const verifier = randomBase64Url(64);
    try {
        showPopupConnecting(popup);
        const state = randomBase64Url(32);
        const installationId = await getOrCreateInstallationId();
        const request = {
            response_type: "code",
            client_id: USA0_CLIENT_ID,
            redirect_uri: redirectUri,
            scope: USA0_SCOPES,
            state,
            code_challenge: await sha256Base64Url(verifier),
            code_challenge_method: "S256",
            installation_id: installationId,
            device_name: "USA零网页画布",
            platform: "web",
        };
        const created = await publicPost<AuthorizationRequestResult>("/api/v1/app-auth/authorize/requests", request);
        if (!created.request_id) throw new Error("授权服务未返回请求 ID");
        const authorizationUrl = new URL("/oauth/authorize", USA0_ORIGIN);
        authorizationUrl.searchParams.set("request_id", created.request_id);
        popup.location.replace(authorizationUrl.toString());
        navigated = true;
        const callback = await waitForOAuthCallback(popup, state);
        if (callback.error) throw new Error(callback.error === "access_denied" ? "已取消账号授权" : "账号授权失败");
        if (!callback.code || callback.state !== state) throw new Error("授权状态校验失败，请重新登录");
        return exchangeAuthorizationCode(callback.code, redirectUri, verifier);
    } catch (error) {
        if (!navigated) popup.close();
        throw safeAuthError(error, "无法连接 USA零账号服务", [verifier]);
    }
}

export async function refreshUsa0Token(refreshToken: string) {
    const form = new URLSearchParams({ grant_type: "refresh_token", client_id: USA0_CLIENT_ID, refresh_token: refreshToken });
    try {
        return (await axios.post<Usa0TokenResponse>(`${USA0_ORIGIN}/api/v1/app-auth/token`, form, { headers: { "Content-Type": "application/x-www-form-urlencoded" }, withCredentials: false })).data;
    } catch (error) {
        throw safeAuthError(error, "账号授权已失效，请重新登录", [refreshToken]);
    }
}

export async function revokeUsa0Token(token: string) {
    const form = new URLSearchParams({ token, token_type_hint: "refresh_token" });
    await axios.post(`${USA0_ORIGIN}/api/v1/app-auth/revoke`, form, { headers: { "Content-Type": "application/x-www-form-urlencoded" }, withCredentials: false });
}

export async function fetchUsa0Profile(accessToken: string) {
    return appGet<Usa0Profile>("/api/v1/app/me", accessToken);
}

export async function fetchUsa0Groups(accessToken: string) {
    const result = await appGet<PaginatedResult<Usa0Group> | Usa0Group[]>("/api/v1/app/groups?page=1&page_size=100", accessToken);
    if (Array.isArray(result)) return result;
    return paginationItems(result, "/api/v1/app/groups");
}

export async function fetchUsa0Keys(accessToken: string): Promise<Usa0KeysResult> {
    const items = await fetchAllPages<Usa0ApiKeyCredential>("/api/v1/app/keys", accessToken);
    return {
        keys: items.map(toKeySummary),
        credentials: new Map(items.map((item) => [item.id, item.key])),
    };
}

export async function createUsa0Key(accessToken: string, groupId: number, idempotencyKey: string): Promise<Usa0CreateKeyResult> {
    const item = await appPost<Usa0ApiKeyCredential>(`/api/v1/app/groups/${encodeURIComponent(groupId)}/keys`, accessToken, { name: "USA零画布" }, { "Idempotency-Key": idempotencyKey });
    return { key: toKeySummary(item), credential: item.key };
}

export async function deleteUsa0Key(accessToken: string, keyId: number) {
    await appDelete(`/api/v1/app/keys/${encodeURIComponent(keyId)}`, accessToken);
}

export async function fetchUsa0KeyUsage(apiKey: string) {
    try {
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
        const response = await axios.get<Usa0KeyUsage>(`${USA0_ORIGIN}/v1/usage`, {
            headers: { Authorization: `Bearer ${apiKey}` },
            params: { days: 30, timezone },
            withCredentials: false,
        });
        const data = response.data;
        return {
            mode: data.mode,
            status: data.status,
            planName: data.planName,
            balance: data.balance,
            remaining: data.remaining,
            quota: data.quota ? { limit: data.quota.limit, used: data.quota.used, remaining: data.quota.remaining } : null,
            usage: data.usage ? { today: { total_tokens: data.usage.today?.total_tokens }, total: { total_tokens: data.usage.total?.total_tokens } } : null,
            daily_usage: data.daily_usage?.map((item) => ({ date: item.date, total_tokens: item.total_tokens })),
        } satisfies Usa0KeyUsage;
    } catch (error) {
        throw safeAuthError(error, "无法读取所选 API Key 的用量信息", [apiKey]);
    }
}

export async function fetchUsa0Models(apiKey: string) {
    try {
        const response = await axios.get<{ data?: GatewayModel[] }>(`${USA0_ORIGIN}/v1/models`, {
            headers: { Authorization: `Bearer ${apiKey}` },
            withCredentials: false,
        });
        const items = Array.isArray(response.data?.data) ? response.data.data : [];
        const seen = new Set<string>();
        return items.flatMap((item) => {
            const name = String(item.id || item.name || item.display_name || "").trim();
            if (!name || seen.has(name)) return [];
            seen.add(name);
            return [{ name, platform: "", capabilities: inferModelCapabilities(name) } satisfies Usa0Model];
        });
    } catch (error) {
        throw safeAuthError(error, "无法读取所选 API Key 的模型列表", [apiKey]);
    }
}

async function exchangeAuthorizationCode(code: string, redirectUri: string, verifier: string) {
    const form = new URLSearchParams({ grant_type: "authorization_code", client_id: USA0_CLIENT_ID, code, redirect_uri: redirectUri, code_verifier: verifier });
    try {
        return (await axios.post<Usa0TokenResponse>(`${USA0_ORIGIN}/api/v1/app-auth/token`, form, { headers: { "Content-Type": "application/x-www-form-urlencoded" }, withCredentials: false })).data;
    } catch (error) {
        throw safeAuthError(error, "授权请求已过期，请重新登录", [code, verifier]);
    }
}

async function fetchAllPages<T>(path: string, accessToken: string) {
    const pageSize = 100;
    const items: T[] = [];
    for (let page = 1; ; page += 1) {
        const separator = path.includes("?") ? "&" : "?";
        const result = await appGet<PaginatedResult<T>>(`${path}${separator}page=${page}&page_size=${pageSize}`, accessToken);
        const pageItems = paginationItems(result, path);
        items.push(...pageItems);
        if (!pageItems.length || items.length >= result.total) return items;
    }
}

async function publicPost<T>(path: string, data: unknown) {
    try {
        const response = await axios.post<T | ApiEnvelope<T>>(`${USA0_ORIGIN}${path}`, data, { withCredentials: false });
        return unwrapAppResponse(response.data);
    } catch (error) {
        throw safeAuthError(error, "USA零账号请求失败");
    }
}

async function appGet<T>(path: string, accessToken: string) {
    return appRequest<T>("get", path, accessToken);
}

async function appPost<T>(path: string, accessToken: string, data: unknown, headers?: Record<string, string>) {
    return appRequest<T>("post", path, accessToken, data, headers);
}

async function appDelete(path: string, accessToken: string) {
    await appRequest<unknown>("delete", path, accessToken);
}

async function appRequest<T>(method: "get" | "post" | "delete", path: string, accessToken: string, data?: unknown, extraHeaders?: Record<string, string>) {
    try {
        const response = await axios.request<T | ApiEnvelope<T>>({
            method,
            url: `${USA0_ORIGIN}${path}`,
            data,
            headers: { Authorization: `Bearer ${accessToken}`, ...extraHeaders },
            withCredentials: false,
        });
        return unwrapAppResponse(response.data);
    } catch (error) {
        throw safeAuthError(error, "USA零账号请求失败", [accessToken]);
    }
}

function waitForOAuthCallback(popup: Window, expectedState: string) {
    return new Promise<OAuthCallbackMessage>((resolve, reject) => {
        let deadline = 0;
        let closed = 0;
        const callbackChannel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(`usa0-oauth-callback:${expectedState}`);
        const receive = (payload: OAuthCallbackMessage) => {
            if (payload?.type === "usa0-oauth-callback" && payload.state === expectedState) finish(() => resolve(payload));
        };
        const onMessage = (event: MessageEvent<OAuthCallbackMessage>) => {
            if (event.origin !== window.location.origin || event.source !== popup) return;
            receive(event.data);
        };
        const onChannelMessage = (event: MessageEvent<OAuthCallbackMessage>) => receive(event.data);
        const finish = (done: () => void) => {
            window.clearTimeout(deadline);
            window.clearInterval(closed);
            window.removeEventListener("message", onMessage);
            callbackChannel?.removeEventListener("message", onChannelMessage);
            callbackChannel?.close();
            popup.close();
            done();
        };
        deadline = window.setTimeout(() => finish(() => reject(new Error("登录请求已过期，请重试"))), 5 * 60 * 1000);
        closed = window.setInterval(() => {
            if (popup.closed) finish(() => reject(new Error("登录窗口已关闭")));
        }, 400);
        window.addEventListener("message", onMessage);
        callbackChannel?.addEventListener("message", onChannelMessage);
    });
}

function unwrapAppResponse<T>(value: T | ApiEnvelope<T>): T {
    if (!value || typeof value !== "object") return value as T;
    const envelope = value as ApiEnvelope<T>;
    if (!("success" in envelope || "message" in envelope || "error" in envelope)) return value as T;
    if (envelope.success === false) throw new Usa0RequestError(appErrorMessage(envelope));
    if (!("data" in envelope)) throw new Usa0RequestError("USA零账号服务返回格式无效");
    return envelope.data as T;
}

function paginationItems<T>(result: PaginatedResult<T>, path: string) {
    if (!result || !Array.isArray(result.items) || !Number.isFinite(result.total)) throw new Usa0RequestError(`${path} 返回的分页格式无效`);
    return result.items;
}

function appErrorMessage(envelope: ApiEnvelope<unknown>) {
    const message = envelope.error?.message || envelope.message;
    return typeof message === "string" && message.length <= 200 ? message : "USA零账号请求失败";
}

function toKeySummary({ key: _credential, ...summary }: Usa0ApiKeyCredential): Usa0ApiKey {
    return summary;
}

function showPopupConnecting(popup: Window) {
    popup.document.title = "USA零账号授权";
    popup.document.body.style.cssText = "margin:0;min-height:100vh;display:grid;place-items:center;background:#fafaf9;color:#292524;font:14px system-ui,sans-serif";
    popup.document.body.textContent = "正在连接 USA零账号…";
}

function randomBase64Url(bytes: number) {
    const value = crypto.getRandomValues(new Uint8Array(bytes));
    return bytesToBase64Url(value);
}

async function sha256Base64Url(value: string) {
    return bytesToBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}

function bytesToBase64Url(value: Uint8Array) {
    let binary = "";
    value.forEach((byte) => (binary += String.fromCharCode(byte)));
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function inferModelCapabilities(name: string): Usa0Model["capabilities"] {
    const value = name.toLowerCase();
    if (["seedance", "video", "sora", "veo", "kling", "wan", "hailuo"].some((keyword) => value.includes(keyword))) return ["video"];
    if (["audio", "tts", "speech", "voice", "music", "sound"].some((keyword) => value.includes(keyword))) return ["audio"];
    if ((value.includes("image") || value.includes("imagen") || value.includes("seedream") || value.includes("dall-e") || value.includes("flux")) && !value.includes("vision")) return ["image"];
    return ["text"];
}

function safeAuthError(error: unknown, fallback: string, secrets: string[] = []) {
    const redact = (value: string) => redactUsa0Secrets(secrets.reduce((result, secret) => (secret ? result.split(secret).join("[REDACTED]") : result), value));
    if (error instanceof Error && !axios.isAxiosError(error)) return new Usa0RequestError(redact(error.message));
    if (axios.isAxiosError(error)) {
        if (!error.response) return new Usa0RequestError("无法连接 USA零账号服务，请检查网络、服务地址和跨域配置");
        const data = error.response?.data as { error_description?: unknown; error?: { message?: unknown }; message?: unknown } | undefined;
        const message = data?.error_description || data?.error?.message || data?.message;
        if (typeof message === "string" && message.length <= 200) return new Usa0RequestError(redact(message), error.response?.status);
        return new Usa0RequestError(redact(fallback), error.response?.status);
    }
    return new Usa0RequestError(redact(fallback));
}
