import type { ReactNode } from "react";
import { useEffect } from "react";

import { usePromptSourceScheduler } from "@/hooks/use-prompt-source-scheduler";
import { useUsa0AuthStore } from "@/stores/use-usa0-auth-store";

export function ClientRootInit({ children }: { children: ReactNode }) {
    const initializeUsa0Auth = useUsa0AuthStore((state) => state.initialize);

    usePromptSourceScheduler();

    useEffect(() => {
        if (window.location.pathname === "/oauth/callback") return;
        void initializeUsa0Auth();
    }, [initializeUsa0Auth]);

    return <>{children}</>;
}
