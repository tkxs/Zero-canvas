import { useMemo } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import i18n from "@/i18n";
import { getUsa0RuntimeCredential, useUsa0RuntimeCredentialsRevision } from "@/services/api/usa0-runtime";

export type ApiCallFormat = "openai" | "gemini" | "ark";
export type ModelCapability = "image" | "video" | "text" | "audio";
export type ReasoningEffort = "auto" | "low" | "medium" | "high" | "xhigh";

export class ModelSourceUnavailableError extends Error {
    constructor() {
        super(i18n.t("account.keySourceUnavailable"));
    }
}

export function isModelSourceUnavailableError(error: unknown) {
    return error instanceof ModelSourceUnavailableError;
}

export type ChannelModel = {
    name: string;
    capabilities: ModelCapability[];
};

export type ModelChannel = {
    id: string;
    name: string;
    baseUrl: string;
    apiKey: string;
    apiFormat: ApiCallFormat;
    models: ChannelModel[];
    source: "usa0";
    sourceKeyId: number;
};

export type AiConfig = {
    channelMode: "remote" | "local";
    baseUrl: string;
    apiKey: string;
    apiFormat: ApiCallFormat;
    channels: ModelChannel[];
    model: string;
    imageModel: string;
    videoModel: string;
    textModel: string;
    audioModel: string;
    audioVoice: string;
    audioFormat: string;
    audioSpeed: string;
    audioInstructions: string;
    videoSeconds: string;
    vquality: string;
    videoGenerateAudio: string;
    videoWatermark: string;
    systemPrompt: string;
    reasoningEffort: ReasoningEffort;
    models: string[];
    quality: string;
    size: string;
    background: string;
    count: string;
    canvasImageCount: string;
};

export type WebdavSyncConfig = {
    url: string;
    username: string;
    password: string;
    directory: string;
    lastSyncedAt: string;
};
export type ConfigTabKey = "preferences" | "prompt-sources" | "webdav" | "local-storage";

export const CONFIG_STORE_KEY = "infinite-canvas:ai_config_store";
export const USA0_KEY_CHANNEL_PREFIX = "usa0-key-";
const CHANNEL_MODEL_SEPARATOR = "::";

export const defaultConfig: AiConfig = {
    channelMode: "local",
    baseUrl: "",
    apiKey: "",
    apiFormat: "openai",
    channels: [],
    model: "",
    imageModel: "",
    videoModel: "",
    textModel: "",
    audioModel: "",
    audioVoice: "alloy",
    audioFormat: "mp3",
    audioSpeed: "1",
    audioInstructions: "",
    videoSeconds: "6",
    vquality: "720",
    videoGenerateAudio: "true",
    videoWatermark: "false",
    systemPrompt: "",
    reasoningEffort: "auto",
    models: [],
    quality: "auto",
    size: "1:1",
    background: "",
    count: "1",
    canvasImageCount: "3",
};

export const defaultWebdavSyncConfig: WebdavSyncConfig = {
    url: "",
    username: "",
    password: "",
    directory: "infinite-canvas",
    lastSyncedAt: "",
};

type ConfigStore = {
    config: AiConfig;
    webdav: WebdavSyncConfig;
    isConfigOpen: boolean;
    configTab: ConfigTabKey;
    shouldPromptContinue: boolean;
    updateConfig: <K extends keyof AiConfig>(key: K, value: AiConfig[K]) => void;
    updateWebdavConfig: <K extends keyof WebdavSyncConfig>(key: K, value: WebdavSyncConfig[K]) => void;
    isAiConfigReady: (config: AiConfig, model: string) => boolean;
    openConfigDialog: (shouldPromptContinue?: boolean, tab?: ConfigTabKey) => void;
    setConfigDialogOpen: (isOpen: boolean) => void;
    clearPromptContinue: () => void;
};

const VIDEO_KEYWORDS = ["seedance", "video", "sora", "veo", "kling", "wan", "hailuo"];
const AUDIO_KEYWORDS = ["audio", "tts", "speech", "voice", "music", "sound"];
const IMAGE_KEYWORDS = ["seedream", "gpt-image", "image", "dall-e", "dalle", "imagen", "flux", "sdxl", "stable-diffusion", "midjourney"];

/** Best-effort capability inferred from a synchronized model name. */
export function guessCapability(name: string): ModelCapability {
    const value = name.toLowerCase();
    if (VIDEO_KEYWORDS.some((keyword) => value.includes(keyword))) return "video";
    if (AUDIO_KEYWORDS.some((keyword) => value.includes(keyword))) return "audio";
    if (IMAGE_KEYWORDS.some((keyword) => value.includes(keyword))) return "image";
    return "text";
}

function findChannelModel(config: AiConfig, value: string): { channel: ModelChannel; model: ChannelModel } | null {
    const decoded = decodeChannelModel(value);
    if (!decoded) return null;
    const channel = config.channels.find((item) => item.id === decoded.channelId);
    const model = channel?.models.find((item) => item.name === decoded.model);
    return channel && model ? { channel, model } : null;
}

export function modelCapabilityOf(config: AiConfig, value: string): ModelCapability | undefined {
    return findChannelModel(config, value)?.model.capabilities[0];
}

export function modelMatchesCapability(config: AiConfig, value: string, capability?: ModelCapability) {
    const matched = findChannelModel(config, value);
    return Boolean(matched && (!capability || matched.model.capabilities.includes(capability)));
}

export function resolveModelForCapability(config: AiConfig, currentModel: string | undefined, capability: ModelCapability) {
    if (currentModel) {
        if (modelMatchesCapability(config, currentModel, capability)) return currentModel;
        throw new ModelSourceUnavailableError();
    }
    const defaultModel = capability === "image" ? config.imageModel : capability === "video" ? config.videoModel : capability === "audio" ? config.audioModel : config.textModel;
    return defaultModel && modelMatchesCapability(config, defaultModel, capability) ? defaultModel : "";
}

export function selectableModelsByCapability(config: AiConfig, capability?: ModelCapability) {
    if (!capability) return config.models;
    return config.channels.flatMap((channel) => channel.models.filter((model) => model.capabilities.includes(capability)).map((model) => encodeChannelModel(channel.id, model.name)));
}

function isAiConfigReady(config: AiConfig, model: string) {
    try {
        const channel = resolveModelChannel(config, model);
        return Boolean(model.trim() && channel.baseUrl.trim() && getUsa0RuntimeCredential(channel.sourceKeyId));
    } catch {
        return false;
    }
}

export const useConfigStore = create<ConfigStore>()(
    persist(
        (set, get) => ({
            config: defaultConfig,
            webdav: defaultWebdavSyncConfig,
            isConfigOpen: false,
            configTab: "preferences",
            shouldPromptContinue: false,
            updateConfig: (key, value) =>
                set((state) => ({
                    config: {
                        ...state.config,
                        [key]: value,
                    },
                })),
            updateWebdavConfig: (key, value) =>
                set((state) => ({
                    webdav: {
                        ...state.webdav,
                        [key]: value,
                    },
                })),
            isAiConfigReady: (config, model) => isAiConfigReady(config, model),
            openConfigDialog: (shouldPromptContinue = false, configTab = "preferences") => set({ isConfigOpen: true, shouldPromptContinue, configTab }),
            setConfigDialogOpen: (isConfigOpen) => set({ isConfigOpen }),
            clearPromptContinue: () => set({ shouldPromptContinue: false }),
        }),
        {
            name: CONFIG_STORE_KEY,
            partialize: (state) => ({ config: sanitizeConfigSecrets(state.config), webdav: state.webdav }),
            merge: (persisted, current) => {
                const persistedState = (persisted || {}) as Partial<ConfigStore>;
                const persistedConfig = (persistedState.config || {}) as Partial<AiConfig>;
                const persistedWebdav = (persistedState.webdav || {}) as Partial<WebdavSyncConfig>;
                const config = { ...defaultConfig, ...persistedConfig };
                const channels: ModelChannel[] = [];
                const models: string[] = [];
                return {
                    ...current,
                    webdav: { ...defaultWebdavSyncConfig, ...persistedWebdav },
                    config: {
                        ...config,
                        channelMode: "local",
                        apiFormat: normalizeApiFormat(config.apiFormat),
                        channels,
                        models,
                        imageModel: config.imageModel || config.model || "",
                        videoModel: config.videoModel || "",
                        textModel: config.textModel || config.model || "",
                        audioModel: config.audioModel || "",
                        audioVoice: config.audioVoice || defaultConfig.audioVoice,
                        audioFormat: config.audioFormat || defaultConfig.audioFormat,
                        audioSpeed: config.audioSpeed || defaultConfig.audioSpeed,
                        audioInstructions: config.audioInstructions || "",
                        reasoningEffort: config.reasoningEffort || "auto",
                        videoSeconds: config.videoSeconds || "6",
                        vquality: config.vquality || "720",
                        videoGenerateAudio: config.videoGenerateAudio || "true",
                        videoWatermark: config.videoWatermark || "false",
                        canvasImageCount: config.canvasImageCount || "3",
                    },
                };
            },
        },
    ),
);

export function useEffectiveConfig() {
    const config = useConfigStore((state) => state.config);
    const credentialsRevision = useUsa0RuntimeCredentialsRevision();
    return useMemo(() => ({ ...config, channelMode: "local" as const }), [config, credentialsRevision]);
}

/** Normalize a mixed list of raw model names or model objects into deduped ChannelModel entries. */
export function normalizeChannelModels(models: Array<string | ChannelModel> | undefined): ChannelModel[] {
    const seen = new Set<string>();
    const result: ChannelModel[] = [];
    for (const item of models || []) {
        const name = (typeof item === "string" ? item : item?.name || "").trim();
        if (!name || seen.has(name)) continue;
        seen.add(name);
        const capabilities = typeof item === "string" ? [guessCapability(name)] : normalizeCapabilities(item.capabilities, name);
        result.push({ name, capabilities });
    }
    return result;
}

export function createOfficialKeyChannel(channel: Omit<ModelChannel, "id" | "apiKey" | "source"> & { id?: string }): ModelChannel {
    return {
        ...channel,
        id: channel.id?.trim() || `${USA0_KEY_CHANNEL_PREFIX}${channel.sourceKeyId}`,
        name: channel.name.trim(),
        baseUrl: channel.baseUrl.trim(),
        apiKey: "",
        apiFormat: normalizeApiFormat(channel.apiFormat),
        models: normalizeChannelModels(channel.models),
        source: "usa0",
        sourceKeyId: channel.sourceKeyId,
    };
}

export function encodeChannelModel(channelId: string, model: string) {
    return `${channelId}${CHANNEL_MODEL_SEPARATOR}${model.trim()}`;
}

export function isChannelModelValue(value: string) {
    return value.includes(CHANNEL_MODEL_SEPARATOR);
}

export function decodeChannelModel(value: string) {
    const index = value.indexOf(CHANNEL_MODEL_SEPARATOR);
    if (index < 0) return null;
    return { channelId: value.slice(0, index), model: value.slice(index + CHANNEL_MODEL_SEPARATOR.length) };
}

export function modelOptionName(value: string) {
    return decodeChannelModel(value)?.model || value;
}

export function modelOptionLabel(config: AiConfig, value: string) {
    const decoded = decodeChannelModel(value);
    if (!decoded) return value;
    const channel = config.channels.find((item) => item.id === decoded.channelId);
    return channel ? `${decoded.model}（${channel.name} · #${channel.sourceKeyId}）` : `${decoded.model}（Key #${decoded.channelId.replace(USA0_KEY_CHANNEL_PREFIX, "")}）`;
}

export function modelOptionsFromChannels(channels: ModelChannel[]) {
    return uniqueModelOptions(channels.flatMap((channel) => channel.models.map((model) => encodeChannelModel(channel.id, model.name))));
}

export function replaceOfficialKeyChannels(channels: ModelChannel[]) {
    useConfigStore.setState((state) => {
        const config = { ...state.config, channels, models: modelOptionsFromChannels(channels), baseUrl: "", apiKey: "", apiFormat: "openai" as const };
        const first = (value: string, capability?: ModelCapability) => value || selectableModelsByCapability(config, capability)[0] || "";
        return { config: { ...config, model: first(config.model), imageModel: first(config.imageModel, "image"), videoModel: first(config.videoModel, "video"), textModel: first(config.textModel, "text"), audioModel: first(config.audioModel, "audio") } };
    });
}

export function removeOfficialKeyChannel(sourceKeyId: number) {
    useConfigStore.setState((state) => {
        const channels = state.config.channels.filter((channel) => channel.sourceKeyId !== sourceKeyId);
        return { config: repairModelDefaults({ ...state.config, channels, models: modelOptionsFromChannels(channels) }) };
    });
}

function repairModelDefaults(config: AiConfig): AiConfig {
    const pick = (value: string, capability?: ModelCapability) => {
        const options = selectableModelsByCapability(config, capability);
        return options.includes(value) ? value : options[0] || "";
    };
    return {
        ...config,
        model: pick(config.model),
        imageModel: pick(config.imageModel, "image"),
        videoModel: pick(config.videoModel, "video"),
        textModel: pick(config.textModel, "text"),
        audioModel: pick(config.audioModel, "audio"),
    };
}

export function normalizeModelOptionValue(value: string | undefined, channels: ModelChannel[]) {
    const model = (value || "").trim();
    const decoded = decodeChannelModel(model);
    if (!decoded) return "";
    const channel = channels.find((item) => item.id === decoded.channelId);
    return channel?.models.some((item) => item.name === decoded.model) ? model : "";
}

export function resolveModelChannel(config: AiConfig, value: string) {
    const decoded = decodeChannelModel(value);
    if (!decoded) throw new ModelSourceUnavailableError();
    const matched = config.channels.find((channel) => channel.id === decoded.channelId && channel.models.some((item) => item.name === decoded.model));
    if (!matched) throw new ModelSourceUnavailableError();
    return matched;
}

export function resolveModelRequestConfig(config: AiConfig, value: string) {
    const channel = resolveModelChannel(config, value);
    const apiKey = getUsa0RuntimeCredential(channel.sourceKeyId);
    if (!apiKey) throw new ModelSourceUnavailableError();
    return {
        ...config,
        model: modelOptionName(value),
        baseUrl: channel.baseUrl,
        apiKey,
        apiFormat: channel.apiFormat,
    };
}

function normalizeApiFormat(apiFormat: unknown): ApiCallFormat {
    return apiFormat === "gemini" || apiFormat === "ark" ? apiFormat : "openai";
}

function normalizeCapabilities(capabilities: ModelCapability[] | undefined, name: string) {
    const allowed: ModelCapability[] = ["image", "video", "text", "audio"];
    const values = Array.from(new Set((capabilities || []).filter((value): value is ModelCapability => allowed.includes(value))));
    return values.length ? values : [guessCapability(name)];
}

export function sanitizeConfigSecrets(config: AiConfig): AiConfig {
    return { ...config, baseUrl: "", apiKey: "", channels: [], models: [] };
}

function uniqueModelOptions(models: string[]) {
    return Array.from(new Set((models || []).map((model) => model.trim()).filter(Boolean)));
}

export function buildApiUrl(baseUrl: string, path: string) {
    let normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, "");
    normalizedBaseUrl = normalizeArkPlanBaseUrl(normalizedBaseUrl);
    const lowerBaseUrl = normalizedBaseUrl.toLowerCase();
    const apiBaseUrl = lowerBaseUrl.endsWith("/v1") || lowerBaseUrl.endsWith("/api/v3") || lowerBaseUrl.endsWith("/api/plan/v3") ? normalizedBaseUrl : `${normalizedBaseUrl}/v1`;
    return `${apiBaseUrl}${path}`;
}

function normalizeArkPlanBaseUrl(baseUrl: string) {
    try {
        const url = new URL(baseUrl);
        const path = url.pathname.replace(/\/+$/, "");
        const lowerPath = path.toLowerCase();
        const arkPlanIndex = lowerPath.indexOf("/api/plan/v3");
        if (arkPlanIndex < 0) return baseUrl;
        const end = arkPlanIndex + "/api/plan/v3".length;
        if (lowerPath.length !== end && lowerPath[end] !== "/") return baseUrl;
        url.pathname = path.slice(0, end);
        url.search = "";
        url.hash = "";
        return url.toString().replace(/\/+$/, "");
    } catch {
        return baseUrl;
    }
}
