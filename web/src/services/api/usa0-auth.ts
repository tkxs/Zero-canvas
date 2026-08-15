import axios from "axios";
import localforage from "localforage";

export const USA0_ORIGIN = "http://localhost:8080";
export const USA0_WEBSITE_URL = `${USA0_ORIGIN}/home`;
export const USA0_CLIENT_ID = "zero-canvas-web";
export const USA0_SCOPES = "profile:read keys:read offline_access";

const PKCE_VERIFIER_KEY = "usa0:oauth:verifier";
const PKCE_STATE_KEY = "usa0:oauth:state";
const authStorage = localforage.createInstance({ name: "infinite-canvas-auth", storeName: "usa0_session" });

export type Usa0PersistedSession = {
    refreshToken: string;
    expiresAt: number;
    installationId: string;
    selectedKeyId: number | null;
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

export type Usa0ApiKey = {
    id: number;
    key: string;
    name: string;
    group_id: number | null;
    status: string;
    quota: number;
    quota_used: number;
    expires_at: string | null;
    group?: { id: number; name: string; platform: string } | null;
};

export type Usa0Model = {
    name: string;
    platform: string;
    capabilities: Array<"text" | "image" | "video">;
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

type ApiEnvelope<T> = { success: boolean; data: T; message?: string; error?: { code?: string; message?: string } };
type GatewayModel = { id?: string; name?: string; display_name?: string };
type OAuthCallbackMessage = { type: "usa0-oauth-callback"; code?: string; state?: string; error?: string; errorDescription?: string };

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
    await authStorage.clear();
}

export async function getOrCreateInstallationId() {
    const existing = await authStorage.getItem<string>("installation_id");
    if (existing) return existing;
    const value = crypto.randomUUID();
    await authStorage.setItem("installation_id", value);
    return value;
}

export function getOAuthRedirectUri() {
    const { origin } = window.location;
    if (origin !== "http://localhost:3000" && origin !== "http://127.0.0.1:3000") throw new Error("USA零账号登录首版仅支持 localhost:3000 或 127.0.0.1:3000");
    return `${origin}/oauth/callback`;
}

export async function authorizeUsa0WithPopup() {
    const redirectUri = getOAuthRedirectUri();
    const popup = window.open("about:blank", "usa0-oauth", "popup=yes,width=520,height=720");
    if (!popup) throw new Error("登录窗口被浏览器拦截，请允许弹窗后重试");
    let navigated = false;
    try {
        showPopupConnecting(popup);
        const verifier = randomBase64Url(64);
        const state = randomBase64Url(32);
        const installationId = await getOrCreateInstallationId();
        sessionStorage.setItem(PKCE_VERIFIER_KEY, verifier);
        sessionStorage.setItem(PKCE_STATE_KEY, state);
        const challenge = await sha256Base64Url(verifier);
        const authorizationUrl = new URL("/oauth/authorize", USA0_ORIGIN);
        authorizationUrl.search = new URLSearchParams({
            response_type: "code",
            client_id: USA0_CLIENT_ID,
            redirect_uri: redirectUri,
            scope: USA0_SCOPES,
            state,
            code_challenge: challenge,
            code_challenge_method: "S256",
            installation_id: installationId,
            device_name: "USA零网页画布",
            platform: "web",
        }).toString();
        popup.location.replace(authorizationUrl.toString());
        navigated = true;
        const callback = await waitForOAuthCallback(popup);
        if (callback.error) throw new Error(callback.error === "access_denied" ? "已取消账号授权" : callback.errorDescription || "账号授权失败");
        const savedState = sessionStorage.getItem(PKCE_STATE_KEY);
        const savedVerifier = sessionStorage.getItem(PKCE_VERIFIER_KEY);
        if (!callback.code || !callback.state || callback.state !== savedState || !savedVerifier) throw new Error("授权状态校验失败，请重新登录");
        return exchangeAuthorizationCode(callback.code, redirectUri, savedVerifier);
    } catch (error) {
        if (!navigated) popup.close();
        throw safeAuthError(error, "无法连接 USA零账号服务");
    } finally {
        clearPkceSession();
    }
}

export async function refreshUsa0Token(refreshToken: string) {
    const form = new URLSearchParams({ grant_type: "refresh_token", client_id: USA0_CLIENT_ID, refresh_token: refreshToken });
    try {
        return (await axios.post<Usa0TokenResponse>(`${USA0_ORIGIN}/api/v1/app-auth/token`, form, { headers: { "Content-Type": "application/x-www-form-urlencoded" } })).data;
    } catch (error) {
        throw safeAuthError(error, "账号授权已失效，请重新登录");
    }
}

export async function revokeUsa0Token(token: string) {
    const form = new URLSearchParams({ token, token_type_hint: "refresh_token" });
    await axios.post(`${USA0_ORIGIN}/api/v1/app-auth/revoke`, form, { headers: { "Content-Type": "application/x-www-form-urlencoded" } });
}

export async function fetchUsa0Profile(accessToken: string) {
    return appGet<Usa0Profile>("/api/v1/app/me", accessToken);
}

export async function fetchUsa0Keys(accessToken: string) {
    const result = await appGet<{ items: Usa0ApiKey[]; total: number }>("/api/v1/app/keys?page=1&page_size=100", accessToken);
    return result.items;
}

export async function fetchUsa0KeyUsage(apiKey: string) {
    try {
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
        const response = await axios.get<Usa0KeyUsage>(`${USA0_ORIGIN}/v1/usage`, {
            headers: { Authorization: `Bearer ${apiKey}` },
            params: { days: 30, timezone },
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
        throw safeAuthError(error, "无法读取所选 API Key 的用量信息");
    }
}

export async function fetchUsa0Models(apiKey: string) {
    try {
        const response = await axios.get<{ data?: GatewayModel[] }>(`${USA0_ORIGIN}/v1/models`, {
            headers: { Authorization: `Bearer ${apiKey}` },
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
        throw safeAuthError(error, "无法读取所选 API Key 的模型列表");
    }
}

async function exchangeAuthorizationCode(code: string, redirectUri: string, verifier: string) {
    const form = new URLSearchParams({ grant_type: "authorization_code", client_id: USA0_CLIENT_ID, code, redirect_uri: redirectUri, code_verifier: verifier });
    try {
        return (await axios.post<Usa0TokenResponse>(`${USA0_ORIGIN}/api/v1/app-auth/token`, form, { headers: { "Content-Type": "application/x-www-form-urlencoded" } })).data;
    } catch (error) {
        throw safeAuthError(error, "授权请求已过期，请重新登录");
    }
}

async function appGet<T>(path: string, accessToken: string) {
    try {
        const response = await axios.get<ApiEnvelope<T>>(`${USA0_ORIGIN}${path}`, { headers: { Authorization: `Bearer ${accessToken}` } });
        return response.data.data;
    } catch (error) {
        throw safeAuthError(error, "USA零账号请求失败");
    }
}

function waitForOAuthCallback(popup: Window) {
    return new Promise<OAuthCallbackMessage>((resolve, reject) => {
        let deadline = 0;
        let closed = 0;
        const callbackChannel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("usa0-oauth-callback");
        const receive = (payload: OAuthCallbackMessage) => {
            if (payload?.type === "usa0-oauth-callback") finish(() => resolve(payload));
        };
        const onMessage = (event: MessageEvent<OAuthCallbackMessage>) => {
            if (event.origin !== window.location.origin || event.source !== popup || event.data?.type !== "usa0-oauth-callback") return;
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

function clearPkceSession() {
    sessionStorage.removeItem(PKCE_VERIFIER_KEY);
    sessionStorage.removeItem(PKCE_STATE_KEY);
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
    if (value.startsWith("grok-imagine-video")) return ["video"];
    if ((value.includes("image") || value.includes("imagen")) && !value.includes("vision")) return ["image"];
    return ["text"];
}

function safeAuthError(error: unknown, fallback: string) {
    if (error instanceof Error && !axios.isAxiosError(error)) return error;
    if (axios.isAxiosError(error)) {
        if (!error.response) return new Usa0RequestError("无法连接本地 sub2api，请确认服务已启动并允许当前画布地址跨域访问");
        const data = error.response?.data as { error_description?: unknown; error?: { message?: unknown }; message?: unknown } | undefined;
        const message = data?.error_description || data?.error?.message || data?.message;
        if (typeof message === "string" && message.length <= 200) return new Usa0RequestError(message, error.response?.status);
        return new Usa0RequestError(fallback, error.response?.status);
    }
    return new Usa0RequestError(fallback);
}
