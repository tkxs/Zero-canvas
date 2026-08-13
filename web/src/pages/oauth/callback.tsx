import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";

export default function OAuthCallbackPage() {
    const [message, setMessage] = useState("正在完成账号授权…");

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const payload = {
            type: "usa0-oauth-callback" as const,
            code: params.get("code") || undefined,
            state: params.get("state") || undefined,
            error: params.get("error") || undefined,
            errorDescription: params.get("error_description") || undefined,
        };
        window.history.replaceState(null, "", window.location.pathname);
        const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("usa0-oauth-callback");
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
