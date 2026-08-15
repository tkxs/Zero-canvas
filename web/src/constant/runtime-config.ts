// Runtime configuration access layer.
// Priority: window.__RUNTIME_CONFIG__ (injected by the container entrypoint) > build-time VITE_ variables > defaults.
// This supports both configuring the same image with docker run -e and injecting values during custom builds.
//
// Each analytics provider has its own variable; configured providers are enabled independently and all are disabled by default.
// Only GA4 and Baidu are supported. Both accept IDs only, and script URLs are assembled in code without arbitrary scripts or inline JavaScript.

type RuntimeConfig = {
    ANALYTICS_GA4_ID?: string; // GA4 measurement ID (G-XXXX)
    ANALYTICS_BAIDU_ID?: string; // Baidu Analytics site ID
    USA0_ORIGIN?: string;
};

declare global {
    interface Window {
        __RUNTIME_CONFIG__?: RuntimeConfig;
    }
}

const runtime: RuntimeConfig = (typeof window !== "undefined" && window.__RUNTIME_CONFIG__) || {};
const DEFAULT_USA0_ORIGIN = import.meta.env.DEV ? "http://localhost:8080" : "https://usa0.top";

function read(key: keyof RuntimeConfig, buildTime: string | undefined, fallback = ""): string {
    const value = runtime[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof buildTime === "string" && buildTime.trim()) return buildTime.trim();
    return fallback;
}

export const ANALYTICS_GA4_ID = read("ANALYTICS_GA4_ID", import.meta.env.VITE_ANALYTICS_GA4_ID);
export const ANALYTICS_BAIDU_ID = read("ANALYTICS_BAIDU_ID", import.meta.env.VITE_ANALYTICS_BAIDU_ID);
export const USA0_ORIGIN = sanitizeOrigin(read("USA0_ORIGIN", import.meta.env.VITE_USA0_ORIGIN, DEFAULT_USA0_ORIGIN));

function sanitizeOrigin(value: string) {
    try {
        const url = new URL(value);
        const loopbackHttp = url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
        if ((url.protocol !== "https:" && !loopbackHttp) || url.username || url.password) return DEFAULT_USA0_ORIGIN;
        return url.origin;
    } catch {
        return DEFAULT_USA0_ORIGIN;
    }
}
