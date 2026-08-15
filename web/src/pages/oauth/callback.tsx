import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";

export default function OAuthCallbackPage() {
    const [message, setMessage] = useState("正在完成账号授权…");

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const rawCode = params.get("code") || "";
        const rawState = params.get("state") || "";
        const rawError = params.get("error") || "";
        const payload = {
            type: "usa0-oauth-callback" as const,
            code: /^[\x21-\x7E]{1,2048}$/.test(rawCode) ? rawCode : undefined,
            state: /^[A-Za-z0-9_-]{43}$/.test(rawState) ? rawState : undefined,
            error: /^[A-Za-z0-9_.-]{1,64}$/.test(rawError) ? rawError : rawError ? "invalid_request" : undefined,
        };
        window.history.replaceState(null, "", window.location.pathname);
        const channel = typeof BroadcastChannel === "undefined" || !payload.state ? null : new BroadcastChannel(`usa0-oauth-callback:${payload.state}`);
        channel?.postMessage(payload);
        channel?.close();
        if (!window.opener) {
            setMessage("授权结果已返回，可以关闭此页");
            return;
        }
        window.opener.postMessage(payload, window.location.origin);
        window.close();
        setMessage("授权结果已返回，可以关闭此页");
    }, []);

    return (
        <main className="flex min-h-dvh items-center justify-center bg-background px-6 text-foreground">
            <div className="flex items-center gap-3 text-sm text-stone-600 dark:text-stone-300">
                <LoaderCircle className="size-4 animate-spin" />
                <span>{message}</span>
            </div>
        </main>
    );
}
