import { LoaderCircle } from "lucide-react";
import { useEffect } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";

import { useUsa0AuthStore } from "@/stores/use-usa0-auth-store";

export function RequireUsa0Account() {
    const location = useLocation();
    const hydrated = useUsa0AuthStore((state) => state.hydrated);
    const status = useUsa0AuthStore((state) => state.status);
    const requestAccess = useUsa0AuthStore((state) => state.requestAccess);
    const ready = status === "ready";

    useEffect(() => {
        if (hydrated && !ready) requestAccess(`${location.pathname}${location.search}${location.hash}`);
    }, [hydrated, location.hash, location.pathname, location.search, ready, requestAccess]);

    if (!hydrated || status === "restoring" || status === "syncing") {
        return (
            <div className="flex h-full items-center justify-center bg-background text-stone-500">
                <LoaderCircle className="size-5 animate-spin" />
            </div>
        );
    }
    if (!ready) return <Navigate to="/" replace />;
    return <Outlet />;
}
