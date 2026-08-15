import { useSyncExternalStore } from "react";

type RuntimeCredential = {
    value: string;
    fingerprint: string;
};

let accountId: number | null = null;
let credentials = new Map<number, RuntimeCredential>();
let updateId = 0;
let revision = 0;
const listeners = new Set<() => void>();

function notify() {
    revision += 1;
    listeners.forEach((listener) => listener());
}

export async function replaceUsa0RuntimeCredentials(values: Iterable<readonly [number, string]>, sourceAccountId: number) {
    const requestId = ++updateId;
    const entries = await Promise.all(
        Array.from(values, async ([keyId, raw]) => {
            const value = raw.trim();
            return value ? ([keyId, { value, fingerprint: await sha256(value) }] as const) : null;
        }),
    );
    if (requestId !== updateId) return;
    accountId = sourceAccountId;
    credentials = new Map(entries.filter((entry): entry is NonNullable<typeof entry> => Boolean(entry)));
    notify();
}

export function removeUsa0RuntimeCredential(keyId: number) {
    updateId += 1;
    if (!credentials.delete(keyId)) return;
    notify();
}

export function clearUsa0RuntimeCredentials() {
    updateId += 1;
    if (!credentials.size && accountId === null) return;
    accountId = null;
    credentials = new Map();
    notify();
}

export function getUsa0RuntimeCredential(keyId: number) {
    return credentials.get(keyId)?.value || "";
}

export function getUsa0RuntimeSourceIdentity(keyId: number) {
    const credential = credentials.get(keyId);
    return credential && accountId !== null ? { accountId, keyFingerprint: credential.fingerprint } : null;
}

export function hasUsa0RuntimeCredential(keyId: number) {
    return credentials.has(keyId);
}

export function redactUsa0Secrets(value: string) {
    let result = value;
    for (const credential of credentials.values()) {
        if (credential.value) result = result.split(credential.value).join("[REDACTED]");
    }
    return result.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [REDACTED]");
}

export function useUsa0RuntimeCredentialsRevision() {
    return useSyncExternalStore(
        (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        () => revision,
        () => 0,
    );
}

async function sha256(value: string) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
