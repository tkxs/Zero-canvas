export const APP_VERSION = __APP_VERSION__ || "dev";

export const OFFICIAL_URL = "https://usa0.top";

export const DOCS_URL = import.meta.env.VITE_DOC_URL || OFFICIAL_URL;

// Official plugin registry URL: CI publishes to plugins-dist for jsDelivr delivery; an environment variable may override it for self-hosting.
export const PLUGIN_REGISTRY_URL = import.meta.env.VITE_PLUGIN_REGISTRY_URL || "https://cdn.jsdelivr.net/gh/tkxs/Zero-canvas@plugins-dist/official-plugins.json";
