import { Alert, App, Avatar, Button, Empty, Modal, Select, Spin, Tag, theme as antdTheme } from "antd";
import { Boxes, ExternalLink, KeyRound, LogIn, LogOut, Plus, RefreshCw, Trash2, UserRound } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { USA0_WEBSITE_URL } from "@/services/api/usa0-auth";
import { keyDisabledReason, useUsa0AuthStore } from "@/stores/use-usa0-auth-store";

export function Usa0AccountModal() {
    const { message, modal } = App.useApp();
    const { i18n, t } = useTranslation();
    const { token } = antdTheme.useToken();
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
    const locale = i18n.resolvedLanguage || "zh-CN";
    const numberFormat = new Intl.NumberFormat(locale);
    const syncedModelCount = Object.values(keyModelCounts).reduce((sum, count) => sum + count, 0);
    const progressKey = ["restoring", "authorizing", "syncing"].includes(status) ? status : null;

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

    const accountTag = status === "needs-key"
        ? <Tag color="warning" className="m-0 shrink-0">{t("account.needsKey")}</Tag>
        : status === "error"
            ? <Tag color="error" className="m-0 shrink-0">{t("account.syncIssue")}</Tag>
            : <Tag color="green" className="m-0 shrink-0">{t("account.connected")}</Tag>;

    return (
        <Modal
            title={(
                <div className="min-w-0 pr-8">
                    <div className="text-base font-semibold leading-6">{t("account.title")}</div>
                    <div className="mt-0.5 text-xs font-normal leading-5 text-stone-500">{t("account.subtitle")}</div>
                </div>
            )}
            open={modalOpen}
            width={720}
            centered
            footer={null}
            onCancel={() => setModalOpen(false)}
        >
            <div className="thin-scrollbar max-h-[76dvh] overflow-y-auto pr-1">
                {!profile ? (
                    <div className="py-3 sm:py-5">
                        <div className="mx-auto max-w-lg">
                            <div className="flex items-start gap-4">
                                <Avatar
                                    size={52}
                                    icon={<UserRound className="size-6" />}
                                    style={{ background: token.colorFillSecondary, color: token.colorTextSecondary }}
                                />
                                <div className="min-w-0 flex-1 pt-0.5">
                                    <div className="text-base font-semibold">{t("account.connectTitle")}</div>
                                    <div className="mt-1.5 text-sm leading-6 text-stone-500">{t("account.connectDescription")}</div>
                                </div>
                            </div>

                            {progressKey ? (
                                <div
                                    className="mt-5 flex items-center gap-3 rounded-md px-3 py-2.5 text-sm"
                                    style={{ background: token.colorFillAlter, color: token.colorTextSecondary }}
                                >
                                    <Spin size="small" />
                                    <span>{t(`account.progress.${progressKey}`)}</span>
                                </div>
                            ) : null}
                            {error ? <Alert className="mt-4" type="error" showIcon message={error} /> : null}

                            <div className="mt-5 border-t border-stone-200 pt-5 dark:border-stone-800">
                                <Button
                                    type="primary"
                                    size="large"
                                    block
                                    icon={<LogIn className="size-4" />}
                                    loading={loading}
                                    onClick={() => void run(login)}
                                >
                                    {t("account.login")}
                                </Button>
                                <a
                                    href={USA0_WEBSITE_URL}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="mt-3 flex items-center justify-center gap-1.5 text-xs text-stone-500 hover:text-stone-800 dark:hover:text-stone-200"
                                >
                                    {t("account.openWebsite")}
                                    <ExternalLink className="size-3" />
                                </a>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-5 py-2">
                        <section className="flex flex-col gap-4 border-b border-stone-200 pb-5 dark:border-stone-800 sm:flex-row sm:items-center">
                            <div className="flex min-w-0 flex-1 items-center gap-3">
                                <Avatar size={48} src={profile.avatar_url} icon={<UserRound className="size-5" />} />
                                <div className="min-w-0 flex-1">
                                    <div className="flex min-w-0 items-center gap-2">
                                        <span className="truncate text-sm font-semibold" title={profile.username || profile.email}>{profile.username || profile.email}</span>
                                        {accountTag}
                                    </div>
                                    <div className="mt-1 truncate text-xs text-stone-500" title={profile.email}>{profile.email}</div>
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-5 sm:shrink-0">
                                <div className="min-w-24">
                                    <div className="flex items-center gap-1.5 text-xs text-stone-500"><KeyRound className="size-3.5" />{t("account.keyTotal")}</div>
                                    <div className="mt-1 text-lg font-semibold tabular-nums">{numberFormat.format(keys.length)}</div>
                                </div>
                                <div className="min-w-24 border-l border-stone-200 pl-5 dark:border-stone-800">
                                    <div className="flex items-center gap-1.5 text-xs text-stone-500"><Boxes className="size-3.5" />{t("account.modelTotal")}</div>
                                    <div className="mt-1 text-lg font-semibold tabular-nums">{numberFormat.format(syncedModelCount)}</div>
                                </div>
                            </div>
                        </section>

                        <section>
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <div className="min-w-0 flex-1">
                                    <div className="text-sm font-semibold">{t("account.keysTitle")}</div>
                                    <div className="mt-1 text-xs leading-5 text-stone-500">{t("account.keysDescription")}</div>
                                </div>
                                <Button
                                    type="text"
                                    icon={<RefreshCw className="size-4" />}
                                    loading={loading}
                                    onClick={() => void run(syncKeys, t("account.keysSynced"))}
                                >
                                    {t("account.syncKeys")}
                                </Button>
                            </div>

                            <div className="mt-4 border-y border-stone-200 py-4 dark:border-stone-800">
                                <div className="mb-3">
                                    <div className="text-sm font-medium">{t("account.createKeyTitle")}</div>
                                    <div className="mt-1 text-xs leading-5 text-stone-500">{t("account.createKeyDescription")}</div>
                                </div>
                                <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                                    <label className="min-w-0 flex-1">
                                        <span className="mb-1.5 block text-xs text-stone-500">{t("account.createGroup")}</span>
                                        <Select
                                            className="w-full"
                                            value={groupId}
                                            placeholder={t("account.selectGroup")}
                                            options={groups.map((group) => ({ value: group.id, label: `${group.name} · ${group.platform}` }))}
                                            onChange={setGroupId}
                                        />
                                    </label>
                                    <Button
                                        type="primary"
                                        icon={<Plus className="size-4" />}
                                        className="w-full sm:w-auto"
                                        disabled={!groupId}
                                        loading={loading}
                                        onClick={() => groupId && void run(() => createKey(groupId), t("account.keyCreated"))}
                                    >
                                        {t("account.createKey")}
                                    </Button>
                                </div>
                            </div>
                        </section>

                        {keys.length ? (
                            <div className="space-y-2">
                                {keys.map((key) => {
                                    const reason = keyDisabledReason(key);
                                    const modelCount = keyModelCounts[key.id] || 0;
                                    const keyError = keyErrors[key.id];
                                    const unavailable = Boolean(reason || keyError);
                                    return (
                                        <div key={key.id} className="rounded-md border border-stone-200 px-3 py-3 dark:border-stone-800 sm:flex sm:items-start sm:gap-2">
                                            <div className="flex min-w-0 flex-1 items-start gap-3">
                                                <div
                                                    className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md"
                                                    style={{ background: token.colorFillAlter, color: token.colorTextSecondary }}
                                                >
                                                    <KeyRound className="size-4" />
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                                                        <span className="max-w-full truncate text-sm font-medium" title={key.name}>{key.name}</span>
                                                        <Tag className="m-0 max-w-full truncate" title={key.group?.name || t("account.noGroup")}>{key.group?.name || t("account.noGroup")}</Tag>
                                                    </div>
                                                    <div className={`mt-1 text-xs ${unavailable ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                                                        {reason ? t(`account.keyReasons.${reason}`) : keyError ? t("account.syncFailed") : t("account.modelCount", { count: modelCount })}
                                                    </div>
                                                    {keyError ? <div className="mt-1 break-words text-xs leading-5 text-stone-500" title={keyError}>{keyError}</div> : null}
                                                    {usageKeyId === key.id ? (
                                                        <div className="mt-2 border-t border-stone-200 pt-2 text-xs leading-5 text-stone-500 dark:border-stone-800">
                                                            {keyUsageLoading ? (
                                                                <span className="inline-flex items-center gap-2"><Spin size="small" />{t("common.loading")}</span>
                                                            ) : keyUsageError ? keyUsageError : t("account.usageSummary", {
                                                                balance: formatUsage(keyUsage?.balance ?? keyUsage?.remaining, locale),
                                                                today: formatUsage(keyUsage?.usage?.today?.total_tokens, locale),
                                                                total: formatUsage(keyUsage?.usage?.total?.total_tokens, locale),
                                                            })}
                                                        </div>
                                                    ) : null}
                                                </div>
                                            </div>
                                            <div className="mt-3 flex items-center justify-end gap-1 border-t border-stone-200 pt-2 dark:border-stone-800 sm:mt-0 sm:border-0 sm:pt-0">
                                                <Button
                                                    type="text"
                                                    size="small"
                                                    disabled={Boolean(reason) || !modelCount}
                                                    loading={usageKeyId === key.id && keyUsageLoading}
                                                    onClick={() => void inspectKey(key.id)}
                                                >
                                                    {t("account.viewUsage")}
                                                </Button>
                                                <Button
                                                    type="text"
                                                    danger
                                                    size="small"
                                                    icon={<Trash2 className="size-4" />}
                                                    aria-label={t("common.delete")}
                                                    title={t("common.delete")}
                                                    onClick={() => confirmDelete(key.id, key.name)}
                                                />
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        ) : (
                            <Empty
                                className="py-4"
                                image={Empty.PRESENTED_IMAGE_SIMPLE}
                                description={t(groups.length ? "account.noKeysCreate" : "account.noGroups")}
                            />
                        )}

                        {progressKey ? (
                            <div className="flex items-center gap-2 text-xs text-stone-500"><Spin size="small" />{t(`account.progress.${progressKey}`)}</div>
                        ) : null}
                        {error ? <Alert type="error" showIcon message={error} /> : null}
                        <div className="flex flex-col-reverse gap-2 border-t border-stone-200 pt-3 dark:border-stone-800 sm:flex-row sm:items-center sm:justify-between">
                            <Button type="text" danger icon={<LogOut className="size-4" />} loading={loading} onClick={() => void run(logout)}>{t("account.logout")}</Button>
                            <a
                                href={USA0_WEBSITE_URL}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs text-stone-500 hover:text-stone-800 dark:hover:text-stone-200"
                            >
                                {t("account.openWebsite")}<ExternalLink className="size-3" />
                            </a>
                        </div>
                    </div>
                )}
            </div>
        </Modal>
    );
}

function formatUsage(value: number | string | null | undefined, locale: string) {
    const number = Number(value);
    return value === null || value === undefined || value === "" || !Number.isFinite(number) ? "--" : new Intl.NumberFormat(locale).format(number);
}
