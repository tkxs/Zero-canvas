import { useSyncExternalStore } from "react";

let apiKey = "";
const listeners = new Set<() => void>();

export function setUsa0RuntimeApiKey(value: string) {
    apiKey = value;
    listeners.forEach((listener) => listener());
}

export function getUsa0RuntimeApiKey() {
    return apiKey;
}

export function useUsa0RuntimeApiKey() {
    return useSyncExternalStore(
        (listener) => {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        getUsa0RuntimeApiKey,
        () => "",
    );
}
