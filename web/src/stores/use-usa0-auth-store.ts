import { create } from "zustand";

import {
    authorizeUsa0WithPopup,
    clearPersistedUsa0Session,
    createUsa0Key,
    deleteUsa0Key,
    fetchUsa0Groups,
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
    type Usa0Group,
    type Usa0KeyUsage,
    type Usa0Model,
    type Usa0PersistedSession,
    type Usa0Profile,
    Usa0RequestError,
    type Usa0TokenResponse,
} from "@/services/api/usa0-auth";
import { clearUsa0RuntimeCredentials, getUsa0RuntimeCredential, redactUsa0Secrets, removeUsa0RuntimeCredential, replaceUsa0RuntimeCredentials } from "@/services/api/usa0-runtime";
import { createOfficialKeyChannel, removeOfficialKeyChannel, replaceOfficialKeyChannels, type ChannelModel, type ModelCapability, type ModelChannel } from "@/stores/use-config-store";

type Usa0AuthStatus = "idle" | "restoring" | "authorizing" | "syncing" | "needs-key" | "ready" | "error";

type Usa0AuthStore = {
    hydrated: boolean;
    status: Usa0AuthStatus;
    modalOpen: boolean;
    profile: Usa0Profile | null;
    keys: Usa0ApiKey[];
    groups: Usa0Group[];
    keyModelCounts: Record<number, number>;
    keyErrors: Record<number, string>;
    usageKeyId: number | null;
    keyUsage: Usa0KeyUsage | null;
    keyUsageLoading: boolean;
    keyUsageError: string;
    keyUsageUpdatedAt: number;
    error: string;
    accessToken: string;
    accessTokenExpiresAt: number;
    pendingPath: string;
    initialize: () => Promise<void>;
    login: () => Promise<void>;
    requestAccess: (path: string) => void;
    clearPendingPath: () => void;
    syncKeys: () => Promise<void>;
    createKey: (groupId: number) => Promise<void>;
    deleteKey: (keyId: number) => Promise<void>;
    inspectKey: (keyId: number) => Promise<void>;
    refreshKeyUsage: () => Promise<void>;
    logout: () => Promise<void>;
    setModalOpen: (open: boolean) => void;
};

type AuthEvent = { type: "session-updated" | "keys-updated" | "logout"; sessionId: string; revision?: number };

const authChannel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("usa0-auth");
let initializePromise: Promise<void> | null = null;
let syncRequestId = 0;
let keyUsageRequestId = 0;
let sessionEpoch = 0;
let activeSessionId = "";
let activeSessionRevision = 0;
let listenersRegistered = false;
const lastKnownModels = new Map<string, Usa0Model[]>();
const deletedKeyIds = new Set<number>();

export const useUsa0AuthStore = create<Usa0AuthStore>((set, get) => ({
    hydrated: false,
    status: "idle",
    modalOpen: false,
    profile: null,
    keys: [],
    groups: [],
    keyModelCounts: {},
    keyErrors: {},
    usageKeyId: null,
    keyUsage: null,
    keyUsageLoading: false,
    keyUsageError: "",
    keyUsageUpdatedAt: 0,
    error: "",
    accessToken: "",
    accessTokenExpiresAt: 0,
    pendingPath: "",
    setModalOpen: (modalOpen) => set((state) => ({ modalOpen, pendingPath: modalOpen ? state.pendingPath : "" })),
    requestAccess: (pendingPath) => set((state) => ({ pendingPath: safeInternalPath(pendingPath), modalOpen: state.status === "ready" ? state.modalOpen : true })),
    clearPendingPath: () => set({ pendingPath: "" }),
    initialize: async () => {
        if (initializePromise) return initializePromise;
        initializePromise = (async () => {
            registerAuthListeners();
            let session: Usa0PersistedSession | null = null;
            try {
                session = await getPersistedUsa0Session();
                if (!validSession(session)) {
                    session = await withRefreshLock(async () => {
                        const latest = await getPersistedUsa0Session();
                        if (validSession(latest)) return latest;
                        await clearPersistedUsa0Session();
                        return null;
                    });
                    if (!validSession(session)) {
                        clearActiveSessionState();
                        return;
                    }
                }
                activateSessionIdentity(session);
                await restoreWithRefresh(session.sessionId);
            } catch (error) {
                const current = await getPersistedUsa0Session().catch(() => null);
                if (validSession(session) && validSession(current) && current.sessionId !== session.sessionId) {
                    await syncFromPersistedSession();
                    return;
                }
                if (!validSession(session) || activeSessionId === session.sessionId) set({ hydrated: true, status: "error", error: authErrorMessage(error) });
            }
        })();
        return initializePromise;
    },
    login: async () => {
        const previousStatus = get().status;
        const baseline = await getPersistedUsa0Session();
        const expectedEpoch = sessionEpoch;
        const authorizingSessionId = crypto.randomUUID();
        set({ status: "authorizing", error: "" });
        try {
            const token = await authorizeUsa0WithPopup();
            await acceptToken(token, validSession(baseline) ? baseline : null, expectedEpoch, authorizingSessionId);
        } catch (error) {
            if (sessionEpoch === expectedEpoch || activeSessionId === authorizingSessionId) set({ hydrated: true, status: get().profile ? previousStatus : "error", error: authErrorMessage(error) });
            throw error;
        }
    },
    syncKeys: async () => {
        const previousStatus = get().status;
        const expectedSessionId = activeSessionId;
        try {
            const sessionId = await withAccessToken((accessToken, currentSessionId) => syncAccount(accessToken, currentSessionId), expectedSessionId || undefined);
            authChannel?.postMessage({ type: "keys-updated", sessionId } satisfies AuthEvent);
        } catch (error) {
            if (activeSessionId === expectedSessionId) set({ status: get().profile && previousStatus === "ready" ? "ready" : "needs-key", error: authErrorMessage(error) });
            throw error;
        }
    },
    createKey: async (groupId) => {
        const previousStatus = get().status;
        const expectedSessionId = activeSessionId;
        set(previousStatus === "ready" ? { error: "" } : { status: "syncing", error: "" });
        try {
            const sessionId = await withAccessToken(async (accessToken, currentSessionId) => {
                let createConfirmed = false;
                const executed = await withKeyCreateOperation(
                    currentSessionId,
                    groupId,
                    async (idempotencyKey) => {
                        await createUsa0Key(accessToken, groupId, idempotencyKey);
                        createConfirmed = true;
                        await syncAccount(accessToken, currentSessionId);
                    },
                    () => createConfirmed,
                );
                if (!executed) await syncAccount(accessToken, currentSessionId);
                return currentSessionId;
            }, expectedSessionId || undefined);
            authChannel?.postMessage({ type: "keys-updated", sessionId } satisfies AuthEvent);
        } catch (error) {
            if (activeSessionId === expectedSessionId) set({ status: get().profile && previousStatus === "ready" ? "ready" : "needs-key", error: authErrorMessage(error) });
            throw error;
        }
    },
    deleteKey: async (keyId) => {
        const expectedSessionId = activeSessionId;
        let deleted = false;
        try {
            const sessionId = await withAccessToken(async (accessToken, currentSessionId) => {
                await deleteUsa0Key(accessToken, keyId);
                return currentSessionId;
            }, expectedSessionId || undefined);
            deleted = true;
            if (!(await isCurrentPersistedSession(sessionId))) return;
            syncRequestId += 1;
            deletedKeyIds.add(keyId);
            markKeyDeleted(sessionId, keyId);
            lastKnownModels.delete(modelCacheKey(sessionId, keyId));
            removeUsa0RuntimeCredential(keyId);
            removeOfficialKeyChannel(keyId);
            removeKeyFromAccountState(keyId);
            authChannel?.postMessage({ type: "keys-updated", sessionId } satisfies AuthEvent);
            await withAccessToken((accessToken, expectedSessionId) => syncAccount(accessToken, expectedSessionId), sessionId);
        } catch (error) {
            if (activeSessionId === expectedSessionId) set({ error: authErrorMessage(error) });
            if (!deleted) throw error;
        }
    },
    inspectKey: async (usageKeyId) => {
        set({ usageKeyId, keyUsage: null, keyUsageError: "", keyUsageUpdatedAt: 0 });
        await get().refreshKeyUsage();
    },
    refreshKeyUsage: async () => {
        const keyId = get().usageKeyId;
        const credential = keyId ? getUsa0RuntimeCredential(keyId) : "";
        if (!keyId || !credential) {
            set({ keyUsage: null, keyUsageLoading: false, keyUsageError: "", keyUsageUpdatedAt: 0 });
            return;
        }
        const expectedSessionId = activeSessionId;
        const requestId = ++keyUsageRequestId;
        set({ keyUsageLoading: true, keyUsageError: "" });
        try {
            const keyUsage = await fetchUsa0KeyUsage(credential);
            if (activeSessionId !== expectedSessionId || get().usageKeyId !== keyId || requestId !== keyUsageRequestId) return;
            set({ keyUsage, keyUsageLoading: false, keyUsageUpdatedAt: Date.now() });
        } catch (error) {
            if (activeSessionId !== expectedSessionId || get().usageKeyId !== keyId || requestId !== keyUsageRequestId) return;
            set({ keyUsageLoading: false, keyUsageError: authErrorMessage(error) });
        }
    },
    logout: async () => {
        const expectedSessionId = activeSessionId;
        sessionEpoch += 1;
        const session = await getPersistedUsa0Session();
        if (!validSession(session)) {
            if (!activeSessionId || activeSessionId === expectedSessionId) clearActiveSessionState();
            return;
        }
        if (expectedSessionId && session.sessionId !== expectedSessionId) return;
        await withRefreshLock(() => clearLocalSession(true, session.sessionId));
        try {
            await revokeUsa0Token(session.refreshToken);
        } catch {
            // Local logout is already complete when the authorization server is unavailable.
        }
    },
}));

export function keyDisabledReason(key: Usa0ApiKey) {
    if (key.status === "quota_exhausted" || (key.quota > 0 && key.quota_used >= key.quota)) return "quotaExhausted";
    if (key.status === "expired" || (key.expires_at && new Date(key.expires_at).getTime() <= Date.now())) return "expired";
    if (!key.group_id) return "ungrouped";
    if (key.status !== "active") return "disabled";
    return "";
}

async function acceptToken(token: Usa0TokenResponse, previous: Usa0PersistedSession | null, expectedEpoch: number, sessionId: string) {
    const session = await withRefreshLock(() => persistToken(token, previous, expectedEpoch, sessionId));
    authChannel?.postMessage({ type: "session-updated", sessionId: session.sessionId, revision: session.revision } satisfies AuthEvent);
    await syncAccount(token.access_token, session.sessionId);
    return session;
}

async function persistToken(token: Usa0TokenResponse, previous: Usa0PersistedSession | null, expectedEpoch: number, sessionId: string) {
    const installationId = previous?.installationId || (await getOrCreateInstallationId());
    const expiresAt = Date.now() + Math.max(1, token.expires_in - 30) * 1000;
    const session: Usa0PersistedSession = {
        refreshToken: token.refresh_token || (previous?.sessionId === sessionId ? previous.refreshToken : ""),
        expiresAt,
        installationId,
        sessionId,
        accountId: previous?.sessionId === sessionId ? previous.accountId : undefined,
        revision: Math.max(Date.now(), (previous?.revision || 0) + 1),
    };
    if (!session.refreshToken) throw new Error("授权服务未返回刷新凭证");
    if (expectedEpoch !== sessionEpoch) throw new Error("账号授权状态已变化");
    const current = await getPersistedUsa0Session();
    if (!sameSessionVersion(current, previous)) throw new Error("账号授权状态已变化");
    await savePersistedUsa0Session(session);
    const saved = await getPersistedUsa0Session();
    if (expectedEpoch !== sessionEpoch || !sameSessionVersion(saved, session)) {
        if (sameSessionVersion(saved, session)) await clearPersistedUsa0Session();
        throw new Error("账号授权状态已变化");
    }
    activateSessionIdentity(session);
    activeSessionRevision = session.revision || 0;
    useUsa0AuthStore.setState({ accessToken: token.access_token, accessTokenExpiresAt: expiresAt });
    return session;
}

async function syncAccount(accessToken: string, expectedSessionId: string) {
    assertActiveSession(expectedSessionId);
    const requestId = ++syncRequestId;
    const keepReady = useUsa0AuthStore.getState().status === "ready";
    useUsa0AuthStore.setState(keepReady ? { error: "" } : { status: "syncing", error: "" });
    const [profile, keyResult, groupResult] = await Promise.all([
        fetchUsa0Profile(accessToken),
        fetchUsa0Keys(accessToken),
        fetchUsa0Groups(accessToken).then(
            (groups) => ({ groups, error: "" }),
            (error) => ({ groups: [], error: authErrorMessage(error) }),
        ),
    ]);
    const visibleKeys = keyResult.keys.filter((key) => !deletedKeyIds.has(key.id) && !isKeyDeleted(expectedSessionId, key.id));
    const availableKeys = visibleKeys.filter((key) => !keyDisabledReason(key) && keyResult.credentials.has(key.id));
    const results = await Promise.all(
        availableKeys.map(async (key) => {
            try {
                const models = await fetchUsa0Models(keyResult.credentials.get(key.id) || "");
                if (!models.length) throw new Error("当前密钥没有可用模型");
                return { key, models, error: "", fresh: true };
            } catch (error) {
                return { key, models: lastKnownModels.get(modelCacheKey(expectedSessionId, key.id)) || [], error: authErrorMessage(error), fresh: false };
            }
        }),
    );
    await assertPersistedSession(expectedSessionId, requestId);

    const currentKeyIds = new Set(visibleKeys.map((key) => key.id));
    for (const key of lastKnownModels.keys()) {
        if (key.startsWith(`${expectedSessionId}:`) && !currentKeyIds.has(Number(key.slice(expectedSessionId.length + 1)))) lastKnownModels.delete(key);
    }
    results.forEach(({ key, models, fresh }) => {
        if (fresh) lastKnownModels.set(modelCacheKey(expectedSessionId, key.id), models);
    });
    const usable = results.filter((result) => result.models.length);
    const usableCredentials = new Map(usable.map(({ key }) => [key.id, keyResult.credentials.get(key.id) || ""]));
    const channels = usable.map(({ key, models }) => keyChannel(key, models));
    const keyModelCounts = Object.fromEntries(results.map(({ key, models }) => [key.id, models.length]));
    const keyErrors = Object.fromEntries(results.filter(({ error }) => error).map(({ key, error }) => [key.id, error]));
    await saveSessionAccountId(expectedSessionId, profile.id);
    await assertPersistedSession(expectedSessionId, requestId);
    if (keyResult.keys.some((key) => isKeyDeleted(expectedSessionId, key.id))) throw new Error("密钥同步状态已变化");
    await replaceUsa0RuntimeCredentials(usableCredentials, profile.id);
    try {
        await assertPersistedSession(expectedSessionId, requestId);
    } catch (error) {
        if (activeSessionId === expectedSessionId && requestId === syncRequestId) clearOfficialSources();
        throw error;
    }
    replaceOfficialKeyChannels(channels);

    const groups = groupResult.groups;
    const syncError = groupResult.error;
    const previousUsageKeyId = useUsa0AuthStore.getState().usageKeyId;
    const usageKeyId = usable.some(({ key }) => key.id === previousUsageKeyId) ? previousUsageKeyId : usable[0]?.key.id || null;
    keyUsageRequestId += 1;
    useUsa0AuthStore.setState({
        hydrated: true,
        profile,
        keys: visibleKeys,
        groups,
        keyModelCounts,
        keyErrors,
        usageKeyId,
        keyUsage: null,
        keyUsageLoading: false,
        keyUsageError: "",
        keyUsageUpdatedAt: 0,
        status: channels.length ? "ready" : "needs-key",
        modalOpen: channels.length ? useUsa0AuthStore.getState().modalOpen : true,
        error: syncError,
    });
    if (usageKeyId) void useUsa0AuthStore.getState().refreshKeyUsage();
    return expectedSessionId;
}

async function restoreWithRefresh(expectedSessionId: string) {
    const expectedEpoch = sessionEpoch;
    const refreshed = await withRefreshLock(async () => {
        const latest = await getPersistedUsa0Session();
        if (!validSession(latest) || latest.sessionId !== expectedSessionId) throw new Error("账号授权状态已变化");
        let token: Usa0TokenResponse;
        try {
            token = await refreshUsa0Token(latest.refreshToken);
        } catch (error) {
            if (error instanceof Usa0RequestError && (error.status === 400 || error.status === 401)) await clearLocalSession(false, latest.sessionId);
            throw error;
        }
        const session = await persistToken(token, latest, expectedEpoch, latest.sessionId);
        return { token, session };
    });
    assertActiveSession(expectedSessionId);
    await syncAccount(refreshed.token.access_token, refreshed.session.sessionId);
    return refreshed.token;
}

async function ensureAccessToken(expectedSessionId: string) {
    const session = await getPersistedUsa0Session();
    if (!validSession(session) || session.sessionId !== expectedSessionId) throw new Error("账号授权状态已变化");
    activateSessionIdentity(session);
    const state = useUsa0AuthStore.getState();
    if (state.accessToken && state.accessTokenExpiresAt > Date.now() && activeSessionId === expectedSessionId && (session.revision || 0) === activeSessionRevision) return state.accessToken;
    useUsa0AuthStore.setState({ accessToken: "", accessTokenExpiresAt: 0 });
    await restoreWithRefresh(expectedSessionId);
    assertActiveSession(expectedSessionId);
    return useUsa0AuthStore.getState().accessToken;
}

async function withAccessToken<T>(request: (accessToken: string, sessionId: string) => Promise<T>, requiredSessionId?: string) {
    const session = await getPersistedUsa0Session();
    if (!validSession(session)) throw new Error("请先登录 USA零账号");
    if (requiredSessionId && session.sessionId !== requiredSessionId) throw new Error("账号授权状态已变化");
    activateSessionIdentity(session);
    const expectedSessionId = session.sessionId;
    try {
        return await request(await ensureAccessToken(expectedSessionId), expectedSessionId);
    } catch (error) {
        if (!(error instanceof Usa0RequestError) || error.status !== 401) throw error;
        assertActiveSession(expectedSessionId);
        useUsa0AuthStore.setState({ accessToken: "", accessTokenExpiresAt: 0 });
        await restoreWithRefresh(expectedSessionId);
        assertActiveSession(expectedSessionId);
        return request(useUsa0AuthStore.getState().accessToken, expectedSessionId);
    }
}

async function withKeyCreateOperation(sessionId: string, groupId: number, task: (idempotencyKey: string) => Promise<void>, wasCreateConfirmed: () => boolean) {
    const storageKey = `usa0:key-create:${sessionId}:${groupId}`;
    const observed = readKeyCreateOperation(storageKey);
    return withNamedLock(`usa0-key-create:${sessionId}:${groupId}`, async () => {
        const current = readKeyCreateOperation(storageKey);
        const joinedCurrent = Boolean(current && (!observed || current.operationId !== observed.operationId || observed.status === "pending"));
        if (current?.status === "completed" && joinedCurrent) return false;
        const operation = current && joinedCurrent
            ? current
            : { operationId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID(), status: "pending" as const, updatedAt: Date.now() };
        writeKeyCreateOperation(storageKey, operation);
        try {
            await task(operation.idempotencyKey);
            writeKeyCreateOperation(storageKey, { ...operation, status: "completed", updatedAt: Date.now() });
            return true;
        } catch (error) {
            if (!wasCreateConfirmed() && isDefinitiveCreateFailure(error)) removeKeyCreateOperation(storageKey, operation.operationId);
            throw error;
        }
    });
}

type KeyCreateOperation = { operationId: string; idempotencyKey: string; status: "pending" | "completed"; updatedAt: number };

function readKeyCreateOperation(key: string): KeyCreateOperation | null {
    try {
        const value = JSON.parse(localStorage.getItem(key) || "null") as Partial<KeyCreateOperation> | null;
        if (typeof value?.operationId !== "string" || typeof value.idempotencyKey !== "string" || (value.status !== "pending" && value.status !== "completed") || typeof value.updatedAt !== "number") {
            localStorage.removeItem(key);
            return null;
        }
        if (Date.now() - value.updatedAt > 24 * 60 * 60 * 1000) {
            localStorage.removeItem(key);
            return null;
        }
        return value as KeyCreateOperation;
    } catch {
        return null;
    }
}

function writeKeyCreateOperation(key: string, operation: KeyCreateOperation) {
    localStorage.setItem(key, JSON.stringify(operation));
}

function removeKeyCreateOperation(key: string, operationId: string) {
    if (readKeyCreateOperation(key)?.operationId === operationId) localStorage.removeItem(key);
}

function isDefinitiveCreateFailure(error: unknown) {
    return error instanceof Usa0RequestError && Boolean(error.status && error.status < 500 && error.status !== 408 && error.status !== 429);
}

function markKeyDeleted(sessionId: string, keyId: number) {
    localStorage.setItem(`usa0:key-deleted:${sessionId}:${keyId}`, "1");
}

function isKeyDeleted(sessionId: string, keyId: number) {
    return localStorage.getItem(`usa0:key-deleted:${sessionId}:${keyId}`) === "1";
}

function clearSessionOperationRecords(sessionId: string) {
    const prefixes = [`usa0:key-create:${sessionId}:`, `usa0:key-deleted:${sessionId}:`];
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
        const key = localStorage.key(index);
        if (key && prefixes.some((prefix) => key.startsWith(prefix))) localStorage.removeItem(key);
    }
}

async function withRefreshLock<T>(task: () => Promise<T>) {
    return withNamedLock("usa0-oauth-refresh", task);
}

async function withNamedLock<T>(name: string, task: () => Promise<T>) {
    if (navigator.locks?.request) return navigator.locks.request(name, { mode: "exclusive" }, task);
    return withLease(`usa0:lock:${name}`, task);
}

async function withLease<T>(key: string, task: () => Promise<T>) {
    const owner = crypto.randomUUID();
    const timeoutAt = Date.now() + 15_000;
    while (Date.now() < timeoutAt) {
        const current = readLease(key);
        if (!current || current.expiresAt <= Date.now()) {
            localStorage.setItem(key, JSON.stringify({ owner, expiresAt: Date.now() + 30_000 }));
            await new Promise((resolve) => window.setTimeout(resolve, 50 + Math.random() * 50));
            if (readLease(key)?.owner === owner) {
                const renew = window.setInterval(() => {
                    if (readLease(key)?.owner === owner) localStorage.setItem(key, JSON.stringify({ owner, expiresAt: Date.now() + 30_000 }));
                }, 5_000);
                try {
                    const result = await task();
                    if (readLease(key)?.owner !== owner) throw new Error("跨窗口操作锁已失效，请重试");
                    return result;
                } finally {
                    window.clearInterval(renew);
                    if (readLease(key)?.owner === owner) localStorage.removeItem(key);
                }
            }
        }
        await new Promise((resolve) => window.setTimeout(resolve, 100 + Math.random() * 150));
    }
    throw new Error("其他窗口正在执行同一操作，请稍后重试");
}

function readLease(key: string): { owner: string; expiresAt: number } | null {
    try {
        const value = JSON.parse(localStorage.getItem(key) || "null") as { owner?: unknown; expiresAt?: unknown } | null;
        return typeof value?.owner === "string" && typeof value.expiresAt === "number" ? { owner: value.owner, expiresAt: value.expiresAt } : null;
    } catch {
        return null;
    }
}

function registerAuthListeners() {
    if (listenersRegistered) return;
    listenersRegistered = true;
    authChannel?.addEventListener("message", (event: MessageEvent<AuthEvent>) => {
        const payload = event.data;
        if (!payload?.sessionId) return;
        if (payload.type === "logout") void withRefreshLock(() => clearLocalSession(false, payload.sessionId));
        if (payload.type === "session-updated") void syncFromPersistedSession();
        if (payload.type === "keys-updated") void syncMatchingSession(payload.sessionId);
    });
    window.addEventListener("focus", () => void syncFromPersistedSession());
}

async function syncMatchingSession(expectedSessionId: string) {
    const session = await getPersistedUsa0Session();
    if (!validSession(session) || session.sessionId !== expectedSessionId) return;
    await syncFromPersistedSession();
}

async function syncFromPersistedSession() {
    const session = await getPersistedUsa0Session();
    if (!validSession(session)) {
        if (activeSessionId) clearActiveSessionState();
        return;
    }
    const identityChanged = activeSessionId !== session.sessionId;
    activateSessionIdentity(session);
    const expectedSessionId = session.sessionId;
    try {
        if (identityChanged || (session.revision || 0) !== activeSessionRevision) useUsa0AuthStore.setState({ accessToken: "", accessTokenExpiresAt: 0 });
        await withAccessToken((accessToken, currentSessionId) => syncAccount(accessToken, currentSessionId), expectedSessionId);
    } catch (error) {
        if (activeSessionId !== expectedSessionId) return;
        const state = useUsa0AuthStore.getState();
        useUsa0AuthStore.setState({ hydrated: true, status: state.profile ? state.status : "error", error: authErrorMessage(error) });
    }
}

async function clearLocalSession(broadcast: boolean, expectedSessionId?: string) {
    const current = await getPersistedUsa0Session();
    if (expectedSessionId && validSession(current) && current.sessionId !== expectedSessionId) return;
    if (expectedSessionId && !validSession(current) && activeSessionId !== expectedSessionId) return;
    const removedSessionId = validSession(current) ? current.sessionId : activeSessionId;
    if (validSession(current)) await clearPersistedUsa0Session();
    if (removedSessionId) clearSessionOperationRecords(removedSessionId);
    clearActiveSessionState();
    if (broadcast && removedSessionId) authChannel?.postMessage({ type: "logout", sessionId: removedSessionId } satisfies AuthEvent);
}

function activateSessionIdentity(session: Usa0PersistedSession) {
    if (activeSessionId === session.sessionId) return;
    sessionEpoch += 1;
    if (activeSessionId) clearSessionOperationRecords(activeSessionId);
    activeSessionId = session.sessionId;
    activeSessionRevision = session.revision || 0;
    syncRequestId += 1;
    keyUsageRequestId += 1;
    clearOfficialSources();
    useUsa0AuthStore.setState({ hydrated: true, status: "restoring", profile: null, keys: [], groups: [], keyModelCounts: {}, keyErrors: {}, usageKeyId: null, keyUsage: null, keyUsageLoading: false, keyUsageError: "", keyUsageUpdatedAt: 0, error: "", accessToken: "", accessTokenExpiresAt: 0 });
}

function clearActiveSessionState() {
    sessionEpoch += 1;
    if (activeSessionId) clearSessionOperationRecords(activeSessionId);
    activeSessionId = "";
    activeSessionRevision = 0;
    syncRequestId += 1;
    keyUsageRequestId += 1;
    clearOfficialSources();
    useUsa0AuthStore.setState({ hydrated: true, status: "idle", profile: null, keys: [], groups: [], keyModelCounts: {}, keyErrors: {}, usageKeyId: null, keyUsage: null, keyUsageLoading: false, keyUsageError: "", keyUsageUpdatedAt: 0, error: "", accessToken: "", accessTokenExpiresAt: 0, modalOpen: false, pendingPath: "" });
}

function clearOfficialSources() {
    lastKnownModels.clear();
    deletedKeyIds.clear();
    clearUsa0RuntimeCredentials();
    replaceOfficialKeyChannels([]);
}

async function isCurrentPersistedSession(expectedSessionId: string) {
    const session = await getPersistedUsa0Session();
    return activeSessionId === expectedSessionId && validSession(session) && session.sessionId === expectedSessionId;
}

async function assertPersistedSession(expectedSessionId: string, requestId: number) {
    if (requestId !== syncRequestId || !(await isCurrentPersistedSession(expectedSessionId))) throw new Error("账号授权状态已变化");
}

function assertActiveSession(expectedSessionId: string) {
    if (!expectedSessionId || activeSessionId !== expectedSessionId) throw new Error("账号授权状态已变化");
}

async function saveSessionAccountId(expectedSessionId: string, accountId: number) {
    await withRefreshLock(async () => {
        const session = await getPersistedUsa0Session();
        if (!validSession(session) || session.sessionId !== expectedSessionId) throw new Error("账号授权状态已变化");
        if (session.accountId !== accountId) await savePersistedUsa0Session({ ...session, accountId });
    });
}

function validSession(session: Usa0PersistedSession | null): session is Usa0PersistedSession {
    return Boolean(session?.refreshToken && session.sessionId && session.installationId);
}

function sameSessionVersion(left: Usa0PersistedSession | null, right: Usa0PersistedSession | null) {
    if (!left || !right) return left === right;
    return left.sessionId === right.sessionId && left.refreshToken === right.refreshToken && (left.revision || 0) === (right.revision || 0);
}

function modelCacheKey(sessionId: string, keyId: number) {
    return `${sessionId}:${keyId}`;
}

function keyChannel(key: Usa0ApiKey, availableModels: Array<{ name: string; capabilities: ModelCapability[] }>): ModelChannel {
    const models: ChannelModel[] = availableModels.map((model) => ({ name: model.name, capabilities: model.capabilities }));
    const label = key.group?.name ? `${key.name || "Key"} · ${key.group.name}` : key.name || "Key";
    return createOfficialKeyChannel({ name: label, baseUrl: USA0_ORIGIN, apiFormat: "openai", models, sourceKeyId: key.id });
}

function removeKeyFromAccountState(keyId: number) {
    useUsa0AuthStore.setState((state) => {
        const keys = state.keys.filter((key) => key.id !== keyId);
        const keyModelCounts = { ...state.keyModelCounts };
        const keyErrors = { ...state.keyErrors };
        delete keyModelCounts[keyId];
        delete keyErrors[keyId];
        const hasUsableKey = Object.values(keyModelCounts).some((count) => count > 0);
        return {
            keys,
            keyModelCounts,
            keyErrors,
            usageKeyId: state.usageKeyId === keyId ? null : state.usageKeyId,
            keyUsage: state.usageKeyId === keyId ? null : state.keyUsage,
            status: hasUsableKey ? "ready" : "needs-key",
            modalOpen: hasUsableKey ? state.modalOpen : true,
        };
    });
}

function safeInternalPath(path: string) {
    return path.startsWith("/") && !path.startsWith("//") && path !== "/oauth/callback" ? path : "/canvas";
}

function authErrorMessage(error: unknown) {
    const message = error instanceof Error ? error.message : "USA零账号操作失败";
    const state = useUsa0AuthStore.getState();
    return redactUsa0Secrets(redactExact(message, [state.accessToken]));
}

function redactExact(value: string, secrets: string[]) {
    return secrets.reduce((result, secret) => (secret ? result.split(secret).join("[REDACTED]") : result), value);
}
