import { create } from "zustand";

import {
    authorizeUsa0WithPopup,
    clearPersistedUsa0Session,
    fetchUsa0Keys,
    fetchUsa0KeyUsage,
    fetchUsa0Models,
    fetchUsa0Profile,
    getOrCreateInstallationId,
    getPersistedUsa0Session,
    refreshUsa0Token,
    revokeUsa0Token,
    savePersistedUsa0Session,
    USA0_ORIGIN,
    type Usa0ApiKey,
    type Usa0KeyUsage,
    type Usa0PersistedSession,
    type Usa0Profile,
    Usa0RequestError,
    type Usa0TokenResponse,
} from "@/services/api/usa0-auth";
import { setUsa0RuntimeApiKey } from "@/services/api/usa0-runtime";
import { modelOptionsFromChannels, selectableModelsByCapability, USA0_CHANNEL_ID, useConfigStore, type AiConfig, type ChannelModel, type ModelCapability, type ModelChannel } from "@/stores/use-config-store";

type Usa0AuthStatus = "idle" | "restoring" | "authorizing" | "authenticated" | "error";

type Usa0AuthStore = {
    status: Usa0AuthStatus;
    modalOpen: boolean;
    profile: Usa0Profile | null;
    keys: Usa0ApiKey[];
    selectedKeyId: number | null;
    selectedGroupName: string;
    keyUsage: Usa0KeyUsage | null;
    keyUsageLoading: boolean;
    keyUsageError: string;
    keyUsageUpdatedAt: number;
    error: string;
    accessToken: string;
    accessTokenExpiresAt: number;
    initialize: () => Promise<void>;
    login: () => Promise<void>;
    selectKey: (keyId: number) => Promise<void>;
    refreshKeyUsage: () => Promise<void>;
    refreshModels: () => Promise<void>;
    logout: () => Promise<void>;
    setModalOpen: (open: boolean) => void;
};

const authChannel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("usa0-auth");
let initialized = false;
let keyUsageRequestId = 0;
let keyUsageRequest: { keyId: number; requestId: number; promise: Promise<void> } | null = null;

export const useUsa0AuthStore = create<Usa0AuthStore>((set, get) => ({
    status: "idle",
    modalOpen: false,
    profile: null,
    keys: [],
    selectedKeyId: null,
    selectedGroupName: "",
    keyUsage: null,
    keyUsageLoading: false,
    keyUsageError: "",
    keyUsageUpdatedAt: 0,
    error: "",
    accessToken: "",
    accessTokenExpiresAt: 0,
    setModalOpen: (modalOpen) => set({ modalOpen }),
    initialize: async () => {
        if (initialized) return;
        initialized = true;
        authChannel?.addEventListener("message", (event) => {
            if (event.data?.type === "logout") void clearLocalSession(false);
            if (event.data?.type === "session-updated" || event.data?.type === "selection-updated") void syncFromPersistedSession();
        });
        const session = await getPersistedUsa0Session();
        if (!session?.refreshToken) {
            setUsa0RuntimeApiKey("");
            removeUsa0Channel();
            return;
        }
        set({ status: "restoring", error: "" });
        try {
            await restoreWithRefresh();
        } catch (error) {
            await clearLocalSession(false);
            set({ status: "error", error: authErrorMessage(error) });
        }
    },
    login: async () => {
        set({ status: "authorizing", error: "" });
        try {
            const token = await authorizeUsa0WithPopup();
            await acceptToken(token, null);
            authChannel?.postMessage({ type: "session-updated" });
        } catch (error) {
            set({ status: "error", error: authErrorMessage(error) });
        }
    },
    selectKey: async (keyId) => {
        try {
            const key = get().keys.find((item) => item.id === keyId);
            if (!key || keyDisabledReason(key)) throw new Error(keyDisabledReason(key) || "API Key 不可用");
            const models = await fetchUsa0Models(key.key);
            if (!models.length) {
                if (get().selectedKeyId === keyId) await clearSelectedKey();
                throw new Error("所选分组暂无可用模型，请先在网站为该分组绑定可用账号并配置模型");
            }
            applyUsa0Channel(models, key.key);
            const session = await getPersistedUsa0Session();
            if (session) await savePersistedUsa0Session({ ...session, selectedKeyId: keyId });
            const keyChanged = get().selectedKeyId !== keyId;
            set({
                selectedKeyId: keyId,
                selectedGroupName: key.group?.name || "",
                ...(keyChanged ? { keyUsage: null, keyUsageError: "", keyUsageUpdatedAt: 0 } : {}),
                status: "authenticated",
                error: "",
            });
            void get().refreshKeyUsage();
            authChannel?.postMessage({ type: "selection-updated" });
        } catch (error) {
            if (error instanceof Usa0RequestError && [403, 404, 409].includes(error.status || 0) && get().selectedKeyId === keyId) await clearSelectedKey();
            set({ error: authErrorMessage(error) });
            throw error;
        }
    },
    refreshKeyUsage: async () => {
        const keyId = get().selectedKeyId;
        if (keyUsageRequest?.keyId === keyId) return keyUsageRequest.promise;
        const key = get().keys.find((item) => item.id === keyId);
        if (!key) {
            set({ keyUsage: null, keyUsageLoading: false, keyUsageError: "", keyUsageUpdatedAt: 0 });
            return;
        }
        const requestId = ++keyUsageRequestId;
        const promise = (async () => {
            set({ keyUsageLoading: true, keyUsageError: "" });
            try {
                const usage = await fetchUsa0KeyUsage(key.key);
                if (get().selectedKeyId !== keyId || keyUsageRequestId !== requestId) return;
                set({ keyUsage: usage, keyUsageLoading: false, keyUsageError: "", keyUsageUpdatedAt: Date.now() });
            } catch (error) {
                if (get().selectedKeyId !== keyId || keyUsageRequestId !== requestId) return;
                set({ keyUsageLoading: false, keyUsageError: authErrorMessage(error) });
            }
        })().finally(() => {
            if (keyUsageRequest?.requestId === requestId) keyUsageRequest = null;
        });
        keyUsageRequest = { keyId, requestId, promise };
        return promise;
    },
    refreshModels: async () => {
        const keyId = get().selectedKeyId;
        if (!keyId) return;
        await get().selectKey(keyId);
    },
    logout: async () => {
        const session = await getPersistedUsa0Session();
        try {
            if (session?.refreshToken) await revokeUsa0Token(session.refreshToken);
        } catch {
            // Local logout must still complete when the authorization server is unavailable.
        }
        await clearLocalSession(true);
    },
}));

export function keyDisabledReason(key: Usa0ApiKey) {
    if (key.status === "quota_exhausted" || (key.quota > 0 && key.quota_used >= key.quota)) return "quotaExhausted";
    if (key.status === "expired" || (key.expires_at && new Date(key.expires_at).getTime() <= Date.now())) return "expired";
    if (!key.group_id) return "ungrouped";
    if (key.status !== "active") return "disabled";
    return "";
}

async function acceptToken(token: Usa0TokenResponse, previous: Usa0PersistedSession | null) {
    const installationId = previous?.installationId || (await getOrCreateInstallationId());
    const expiresAt = Date.now() + Math.max(1, token.expires_in - 30) * 1000;
    const session: Usa0PersistedSession = {
        refreshToken: token.refresh_token || previous?.refreshToken || "",
        expiresAt,
        installationId,
        selectedKeyId: previous?.selectedKeyId || null,
    };
    if (!session.refreshToken) throw new Error("授权服务未返回刷新凭证");
    await savePersistedUsa0Session(session);
    useUsa0AuthStore.setState({ accessToken: token.access_token, accessTokenExpiresAt: expiresAt });
    await loadAccount(token.access_token, session.selectedKeyId);
}

async function loadAccount(accessToken: string, selectedKeyId: number | null) {
    keyUsageRequestId += 1;
    keyUsageRequest = null;
    const [profile, keys] = await Promise.all([fetchUsa0Profile(accessToken), fetchUsa0Keys(accessToken)]);
    useUsa0AuthStore.setState({ profile, keys, status: "authenticated", error: "", selectedKeyId: null, selectedGroupName: "", keyUsage: null, keyUsageLoading: false, keyUsageError: "", keyUsageUpdatedAt: 0 });
    if (!selectedKeyId) return;
    const key = keys.find((item) => item.id === selectedKeyId);
    if (!key || keyDisabledReason(key)) {
        setUsa0RuntimeApiKey("");
        removeUsa0Channel();
        const session = await getPersistedUsa0Session();
        if (session) await savePersistedUsa0Session({ ...session, selectedKeyId: null });
        return;
    }
    try {
        const models = await fetchUsa0Models(key.key);
        if (!models.length) throw new Error("No models available");
        applyUsa0Channel(models, key.key);
        useUsa0AuthStore.setState({ selectedKeyId, selectedGroupName: key.group?.name || "" });
        void useUsa0AuthStore.getState().refreshKeyUsage();
    } catch {
        setUsa0RuntimeApiKey("");
        removeUsa0Channel();
        const session = await getPersistedUsa0Session();
        if (session) await savePersistedUsa0Session({ ...session, selectedKeyId: null });
    }
}

async function restoreWithRefresh() {
    const token = await withRefreshLock(async () => {
        const latest = await getPersistedUsa0Session();
        if (!latest?.refreshToken) throw new Error("账号授权不存在");
        const refreshed = await refreshUsa0Token(latest.refreshToken);
        await acceptToken(refreshed, latest);
        return refreshed;
    });
    return token;
}

async function ensureAccessToken() {
    const state = useUsa0AuthStore.getState();
    if (state.accessToken && state.accessTokenExpiresAt > Date.now()) return state.accessToken;
    const session = await getPersistedUsa0Session();
    if (!session?.refreshToken) throw new Error("请先登录 USA零账号");
    await restoreWithRefresh();
    return useUsa0AuthStore.getState().accessToken;
}

async function withAccessToken<T>(request: (accessToken: string) => Promise<T>) {
    try {
        return await request(await ensureAccessToken());
    } catch (error) {
        if (!(error instanceof Usa0RequestError) || error.status !== 401) throw error;
        useUsa0AuthStore.setState({ accessToken: "", accessTokenExpiresAt: 0 });
        await restoreWithRefresh();
        return request(useUsa0AuthStore.getState().accessToken);
    }
}

async function withRefreshLock<T>(task: () => Promise<T>) {
    if (navigator.locks?.request) return navigator.locks.request("usa0-oauth-refresh", { mode: "exclusive" }, task);
    return task();
}

async function syncFromPersistedSession() {
    const session = await getPersistedUsa0Session();
    if (!session?.refreshToken) return;
    try {
        const state = useUsa0AuthStore.getState();
        if (state.accessToken && state.accessTokenExpiresAt > Date.now()) {
            await withAccessToken((accessToken) => loadAccount(accessToken, session.selectedKeyId));
            return;
        }
        await restoreWithRefresh();
    } catch (error) {
        useUsa0AuthStore.setState({ status: "error", error: authErrorMessage(error) });
    }
}

async function clearLocalSession(broadcast: boolean) {
    keyUsageRequestId += 1;
    keyUsageRequest = null;
    await clearPersistedUsa0Session();
    setUsa0RuntimeApiKey("");
    removeUsa0Channel();
    useUsa0AuthStore.setState({ status: "idle", profile: null, keys: [], selectedKeyId: null, selectedGroupName: "", keyUsage: null, keyUsageLoading: false, keyUsageError: "", keyUsageUpdatedAt: 0, error: "", accessToken: "", accessTokenExpiresAt: 0 });
    if (broadcast) authChannel?.postMessage({ type: "logout" });
}

async function clearSelectedKey() {
    keyUsageRequestId += 1;
    keyUsageRequest = null;
    setUsa0RuntimeApiKey("");
    removeUsa0Channel();
    const session = await getPersistedUsa0Session();
    if (session) await savePersistedUsa0Session({ ...session, selectedKeyId: null });
    useUsa0AuthStore.setState({ selectedKeyId: null, selectedGroupName: "", keyUsage: null, keyUsageLoading: false, keyUsageError: "", keyUsageUpdatedAt: 0 });
}

function applyUsa0Channel(availableModels: Array<{ name: string; capabilities: ModelCapability[] }>, apiKey: string) {
    const models: ChannelModel[] = availableModels.map((model) => ({
        name: model.name,
        capabilities: model.capabilities,
        script: model.capabilities.includes("video") ? USA0_VIDEO_SCRIPT : undefined,
    }));
    const channel: ModelChannel = { id: USA0_CHANNEL_ID, name: "USA零网站", baseUrl: USA0_ORIGIN, apiKey: "", apiFormat: "openai", models, source: "usa0" };
    setUsa0RuntimeApiKey(apiKey);
    useConfigStore.setState((state) => ({ config: replaceUsa0Channel(state.config, channel) }));
}

function replaceUsa0Channel(config: AiConfig, channel: ModelChannel): AiConfig {
    const oldChannel = config.channels.find((item) => item.id === USA0_CHANNEL_ID);
    const channels = [...config.channels.filter((item) => item.id !== USA0_CHANNEL_ID), channel];
    const next = { ...config, channels, models: modelOptionsFromChannels(channels) };
    return repairUsa0Defaults(next, config, oldChannel);
}

function repairUsa0Defaults(next: AiConfig, previous: AiConfig, oldChannel?: ModelChannel): AiConfig {
    const repair = (value: string, capability: ModelCapability) => {
        if (!value.startsWith(`${USA0_CHANNEL_ID}::`)) return value;
        if (selectableModelsByCapability(next, capability).includes(value)) return value;
        return selectableModelsByCapability(next, capability).find((item) => item.startsWith(`${USA0_CHANNEL_ID}::`)) || "";
    };
    let model = previous.model;
    if (model.startsWith(`${USA0_CHANNEL_ID}::`)) {
        const name = model.slice(`${USA0_CHANNEL_ID}::`.length);
        const capability = oldChannel?.models.find((item) => item.name === name)?.capabilities[0] || "image";
        model = repair(model, capability);
    }
    return {
        ...next,
        model,
        imageModel: repair(previous.imageModel, "image"),
        videoModel: repair(previous.videoModel, "video"),
        textModel: repair(previous.textModel, "text"),
        audioModel: previous.audioModel,
    };
}

function removeUsa0Channel() {
    useConfigStore.setState((state) => {
        const channels = state.config.channels.filter((item) => item.id !== USA0_CHANNEL_ID);
        const clear = (value: string) => (value.startsWith(`${USA0_CHANNEL_ID}::`) ? "" : value);
        return {
            config: {
                ...state.config,
                channels,
                models: modelOptionsFromChannels(channels),
                model: clear(state.config.model),
                imageModel: clear(state.config.imageModel),
                videoModel: clear(state.config.videoModel),
                textModel: clear(state.config.textModel),
                audioModel: clear(state.config.audioModel),
            },
        };
    });
}

function authErrorMessage(error: unknown) {
    return error instanceof Error ? error.message : "USA零账号操作失败";
}

const USA0_VIDEO_SCRIPT = `const headers = { "Content-Type": "application/json", Authorization: \`Bearer \${apiKey}\` };
const unwrap = (value) => value?.data?.data || value?.data || value;
const created = unwrap(await request({
  method: "post",
  url: \`\${baseUrl}/v1/videos/generations\`,
  headers,
  data: { model, prompt, duration: Number(params.seconds), resolution: \`\${params.resolution}p\` },
}));
const requestId = created?.request_id || created?.id;
if (!requestId) throw new Error("视频接口未返回任务 ID");
const state = await poll(
  () => request({ method: "get", url: \`\${baseUrl}/v1/videos/\${requestId}\`, headers }),
  (value) => {
    const current = unwrap(value);
    if (["failed", "cancelled"].includes(current?.status)) throw new Error(current?.error?.message || "视频生成失败");
    return ["completed", "succeeded"].includes(current?.status) ? current : null;
  },
  { intervalMs: 2500, timeoutMs: 300000 },
);
const url = state?.video_url || state?.url || state?.content?.video_url || state?.content?.url;
if (url) return { url };
return await request({ method: "get", url: \`\${baseUrl}/v1/videos/\${requestId}/content\`, headers, responseType: "blob" });`;
