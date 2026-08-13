import { Alert, Avatar, Button, Modal, Select, Tag } from "antd";
import { ExternalLink, LogIn, LogOut, RefreshCw, UserRound } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { USA0_ORIGIN } from "@/services/api/usa0-auth";
import { keyDisabledReason, useUsa0AuthStore } from "@/stores/use-usa0-auth-store";

export function Usa0AccountModal() {
    const { t } = useTranslation();
    const [working, setWorking] = useState(false);
    const modalOpen = useUsa0AuthStore((state) => state.modalOpen);
    const status = useUsa0AuthStore((state) => state.status);
    const profile = useUsa0AuthStore((state) => state.profile);
    const keys = useUsa0AuthStore((state) => state.keys);
    const selectedKeyId = useUsa0AuthStore((state) => state.selectedKeyId);
    const selectedGroupName = useUsa0AuthStore((state) => state.selectedGroupName);
    const error = useUsa0AuthStore((state) => state.error);
    const setModalOpen = useUsa0AuthStore((state) => state.setModalOpen);
    const login = useUsa0AuthStore((state) => state.login);
    const selectKey = useUsa0AuthStore((state) => state.selectKey);
    const refreshModels = useUsa0AuthStore((state) => state.refreshModels);
    const logout = useUsa0AuthStore((state) => state.logout);
    const authenticated = Boolean(profile);
    const loading = working || status === "authorizing" || status === "restoring";

    const run = async (action: () => Promise<void>) => {
        setWorking(true);
        try {
            await action();
        } catch {
            // Store actions expose failures through the account modal state.
        } finally {
            setWorking(false);
        }
    };

    const options = keys.map((key) => {
        const reason = keyDisabledReason(key);
        return {
            value: key.id,
            disabled: Boolean(reason),
            label: (
                <div className="flex min-w-0 items-center justify-between gap-3">
                    <span className="truncate">{key.name}</span>
                    {reason ? <span className="shrink-0 text-xs text-stone-400">{t(`account.keyReasons.${reason}`)}</span> : null}
                </div>
            ),
        };
    });

    return (
        <Modal title={t("account.title")} open={modalOpen} width={560} centered footer={null} onCancel={() => setModalOpen(false)}>
            {!authenticated ? (
                <div className="py-3">
                    <div className="mb-5 flex items-center gap-3">
                        <Avatar size={42} icon={<UserRound className="size-5" />} />
                        <div className="min-w-0">
                            <div className="text-sm font-semibold">{t("account.connectTitle")}</div>
                            <div className="mt-1 text-xs leading-5 text-stone-500">{t("account.connectDescription")}</div>
                        </div>
                    </div>
                    {error ? <Alert className="mb-4" type="error" showIcon message={error} /> : null}
                    <Button type="primary" block icon={<LogIn className="size-4" />} loading={loading} onClick={() => void run(login)}>
                        {t("account.login")}
                    </Button>
                    <a href={USA0_ORIGIN} target="_blank" rel="noopener noreferrer" className="mt-3 flex items-center justify-center gap-1 text-xs text-stone-500 hover:text-stone-800 dark:hover:text-stone-200">
                        {t("account.openWebsite")}
                        <ExternalLink className="size-3" />
                    </a>
                </div>
            ) : (
                <div className="space-y-5 py-2">
                    <div className="flex items-center gap-3 border-b border-stone-200 pb-4 dark:border-stone-800">
                        <Avatar size={42} src={profile.avatar_url} icon={<UserRound className="size-5" />} />
                        <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-semibold">{profile.username || profile.email}</div>
                            <div className="mt-1 truncate text-xs text-stone-500">{profile.email}</div>
                        </div>
                        <Tag color="green">{t("account.connected")}</Tag>
                    </div>

                    <div>
                        <div className="mb-2 flex items-center justify-between gap-3">
                            <label className="text-sm font-medium">{t("account.apiKey")}</label>
                            {selectedGroupName ? <span className="truncate text-xs text-stone-500">{t("account.group", { name: selectedGroupName })}</span> : null}
                        </div>
                        <Select
                            className="w-full"
                            placeholder={t("account.selectKey")}
                            value={selectedKeyId || undefined}
                            options={options}
                            optionLabelProp="label"
                            loading={loading}
                            onChange={(value) => void run(() => selectKey(value))}
                        />
                        <div className="mt-2 text-xs leading-5 text-stone-500">{t("account.keyDescription")}</div>
                    </div>

                    {error ? <Alert type="error" showIcon message={error} /> : null}

                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-stone-200 pt-4 dark:border-stone-800">
                        <Button type="text" danger icon={<LogOut className="size-4" />} loading={loading} onClick={() => void run(logout)}>
                            {t("account.logout")}
                        </Button>
                        <Button icon={<RefreshCw className="size-4" />} disabled={!selectedKeyId} loading={loading} onClick={() => void run(refreshModels)}>
                            {t("account.refreshModels")}
                        </Button>
                    </div>
                </div>
            )}
        </Modal>
    );
}
