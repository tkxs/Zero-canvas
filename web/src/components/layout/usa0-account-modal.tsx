import { Alert, App, Avatar, Button, Empty, Modal, Select, Tag } from "antd";
import { ExternalLink, KeyRound, LogIn, LogOut, Plus, RefreshCw, Trash2, UserRound } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { USA0_WEBSITE_URL } from "@/services/api/usa0-auth";
import { keyDisabledReason, useUsa0AuthStore } from "@/stores/use-usa0-auth-store";

export function Usa0AccountModal() {
    const { message, modal } = App.useApp();
    const { t } = useTranslation();
    const [working, setWorking] = useState(false);
    const [groupId, setGroupId] = useState<number>();
    const modalOpen = useUsa0AuthStore((state) => state.modalOpen);
    const status = useUsa0AuthStore((state) => state.status);
    const profile = useUsa0AuthStore((state) => state.profile);
    const keys = useUsa0AuthStore((state) => state.keys);
    const groups = useUsa0AuthStore((state) => state.groups);
    const keyModelCounts = useUsa0AuthStore((state) => state.keyModelCounts);
    const keyErrors = useUsa0AuthStore((state) => state.keyErrors);
    const usageKeyId = useUsa0AuthStore((state) => state.usageKeyId);
    const keyUsage = useUsa0AuthStore((state) => state.keyUsage);
    const keyUsageLoading = useUsa0AuthStore((state) => state.keyUsageLoading);
    const keyUsageError = useUsa0AuthStore((state) => state.keyUsageError);
    const error = useUsa0AuthStore((state) => state.error);
    const setModalOpen = useUsa0AuthStore((state) => state.setModalOpen);
    const login = useUsa0AuthStore((state) => state.login);
    const syncKeys = useUsa0AuthStore((state) => state.syncKeys);
    const createKey = useUsa0AuthStore((state) => state.createKey);
    const deleteKey = useUsa0AuthStore((state) => state.deleteKey);
    const inspectKey = useUsa0AuthStore((state) => state.inspectKey);
    const logout = useUsa0AuthStore((state) => state.logout);
    const loading = working || ["authorizing", "restoring", "syncing"].includes(status);

    const run = async (action: () => Promise<void>, success?: string) => {
        setWorking(true);
        try {
            await action();
            if (success) message.success(success);
        } catch {
            // Store actions expose failures through the account state.
        } finally {
            setWorking(false);
        }
    };

    const confirmDelete = (keyId: number, name: string) => {
        modal.confirm({
            title: t("account.deleteKeyTitle"),
            content: t("account.deleteKeyConfirm", { name }),
            okText: t("common.delete"),
            cancelText: t("common.cancel"),
            okButtonProps: { danger: true },
            onOk: () => run(() => deleteKey(keyId), t("account.keyDeleted")),
        });
    };

    return (
        <Modal title={t("account.title")} open={modalOpen} width={680} centered footer={null} onCancel={() => setModalOpen(false)}>
            {!profile ? (
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
                    <a href={USA0_WEBSITE_URL} target="_blank" rel="noopener noreferrer" className="mt-3 flex items-center justify-center gap-1 text-xs text-stone-500 hover:text-stone-800 dark:hover:text-stone-200">
                        {t("account.openWebsite")}
                        <ExternalLink className="size-3" />
                    </a>
                </div>
            ) : (
                <div className="space-y-4 py-2">
                    <div className="flex items-center gap-3 border-b border-stone-200 pb-4 dark:border-stone-800">
                        <Avatar size={42} src={profile.avatar_url} icon={<UserRound className="size-5" />} />
                        <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-semibold">{profile.username || profile.email}</div>
                            <div className="mt-1 truncate text-xs text-stone-500">{profile.email}</div>
                        </div>
                        <Tag color="green">{t("account.connected")}</Tag>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                            <div className="text-sm font-semibold">{t("account.keysTitle")}</div>
                            <div className="mt-1 text-xs text-stone-500">{t("account.keysDescription")}</div>
                        </div>
                        <div className="flex gap-2">
                            <Button icon={<RefreshCw className="size-4" />} loading={loading} onClick={() => void run(syncKeys, t("account.keysSynced"))}>{t("account.syncKeys")}</Button>
                        </div>
                    </div>

                    <div className="flex flex-wrap items-end gap-2 border-y border-stone-200 py-3 dark:border-stone-800">
                        <label className="min-w-56 flex-1">
                            <span className="mb-1.5 block text-xs text-stone-500">{t("account.createGroup")}</span>
                            <Select className="w-full" value={groupId} placeholder={t("account.selectGroup")} options={groups.map((group) => ({ value: group.id, label: `${group.name} · ${group.platform}` }))} onChange={setGroupId} />
                        </label>
                        <Button type="primary" icon={<Plus className="size-4" />} disabled={!groupId} loading={loading} onClick={() => groupId && void run(() => createKey(groupId), t("account.keyCreated"))}>
                            {t("account.createKey")}
                        </Button>
                    </div>

                    {keys.length ? (
                        <div className="max-h-[42vh] space-y-2 overflow-y-auto pr-1">
                            {keys.map((key) => {
                                const reason = keyDisabledReason(key);
                                const modelCount = keyModelCounts[key.id] || 0;
                                const keyError = keyErrors[key.id];
                                return (
                                    <div key={key.id} className="flex min-w-0 items-center gap-3 rounded-md border border-stone-200 px-3 py-3 dark:border-stone-800">
                                        <KeyRound className="size-4 shrink-0 text-stone-400" />
                                        <div className="min-w-0 flex-1">
                                            <div className="flex min-w-0 flex-wrap items-center gap-2">
                                                <span className="truncate text-sm font-medium">{key.name}</span>
                                                <Tag className="m-0">{key.group?.name || t("account.noGroup")}</Tag>
                                                <span className={`text-xs ${reason || keyError ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                                                    {reason ? t(`account.keyReasons.${reason}`) : keyError ? t("account.syncFailed") : t("account.modelCount", { count: modelCount })}
                                                </span>
                                            </div>
                                            {keyError ? <div className="mt-1 truncate text-xs text-stone-500" title={keyError}>{keyError}</div> : null}
                                            {usageKeyId === key.id ? (
                                                <div className="mt-2 text-xs text-stone-500">
                                                    {keyUsageLoading ? t("common.loading") : keyUsageError ? keyUsageError : t("account.usageSummary", { balance: formatUsage(keyUsage?.balance ?? keyUsage?.remaining), today: formatUsage(keyUsage?.usage?.today?.total_tokens), total: formatUsage(keyUsage?.usage?.total?.total_tokens) })}
                                                </div>
                                            ) : null}
                                        </div>
                                        <Button type="text" size="small" disabled={Boolean(reason) || !modelCount} onClick={() => void inspectKey(key.id)}>{t("account.viewUsage")}</Button>
                                        <Button type="text" danger size="small" icon={<Trash2 className="size-4" />} aria-label={t("common.delete")} onClick={() => confirmDelete(key.id, key.name)} />
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t(groups.length ? "account.noKeysCreate" : "account.noGroups")} />
                    )}

                    {error ? <Alert type="error" showIcon message={error} /> : null}
                    <div className="flex justify-between border-t border-stone-200 pt-3 dark:border-stone-800">
                        <Button type="text" danger icon={<LogOut className="size-4" />} loading={loading} onClick={() => void run(logout)}>{t("account.logout")}</Button>
                        <a href={USA0_WEBSITE_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 px-3 text-xs text-stone-500 hover:text-stone-800 dark:hover:text-stone-200">
                            {t("account.openWebsite")}<ExternalLink className="size-3" />
                        </a>
                    </div>
                </div>
            )}
        </Modal>
    );
}

function formatUsage(value: number | string | null | undefined) {
    const number = Number(value);
    return value === null || value === undefined || value === "" || !Number.isFinite(number) ? "--" : new Intl.NumberFormat().format(number);
}
