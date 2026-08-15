import { App, Avatar, Button, Popover, Progress, Spin, Tag } from "antd";
import { Boxes, History, KeyRound, LogIn, LogOut, RefreshCw, Settings2, UserRound, WalletCards, Zap } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";

import { USA0_CHANNEL_ID, useConfigStore } from "@/stores/use-config-store";
import { keyDisabledReason, useUsa0AuthStore } from "@/stores/use-usa0-auth-store";

type Usa0AccountPopoverProps = {
    children: ReactNode;
};

export function Usa0AccountPopover({ children }: Usa0AccountPopoverProps) {
    const { message } = App.useApp();
    const { i18n, t } = useTranslation();
    const [open, setOpen] = useState(false);
    const [working, setWorking] = useState(false);
    const status = useUsa0AuthStore((state) => state.status);
    const profile = useUsa0AuthStore((state) => state.profile);
    const keys = useUsa0AuthStore((state) => state.keys);
    const selectedKeyId = useUsa0AuthStore((state) => state.selectedKeyId);
    const keyUsage = useUsa0AuthStore((state) => state.keyUsage);
    const keyUsageLoading = useUsa0AuthStore((state) => state.keyUsageLoading);
    const keyUsageError = useUsa0AuthStore((state) => state.keyUsageError);
    const keyUsageUpdatedAt = useUsa0AuthStore((state) => state.keyUsageUpdatedAt);
    const refreshKeyUsage = useUsa0AuthStore((state) => state.refreshKeyUsage);
    const setModalOpen = useUsa0AuthStore((state) => state.setModalOpen);
    const logout = useUsa0AuthStore((state) => state.logout);
    const syncedModelCount = useConfigStore((state) => state.config.channels.find((channel) => channel.id === USA0_CHANNEL_ID)?.models.length || 0);
    const selectedKey = keys.find((key) => key.id === selectedKeyId);
    const locale = i18n.resolvedLanguage || "zh-CN";
    const integerFormat = new Intl.NumberFormat(locale);
    const compactFormat = new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 });
    const currencyFormat = new Intl.NumberFormat(locale, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const liveKeyReason = usageStatusReason(keyUsage?.status);
    const keyReason = selectedKey ? liveKeyReason ?? keyDisabledReason(selectedKey) : "";
    const balance = firstNumber(keyUsage?.balance, keyUsage?.remaining, keyUsage?.quota?.remaining);
    const localToday = localDateKey(new Date());
    const todayTokens = toNumber(keyUsage?.daily_usage?.find((item) => item.date === localToday)?.total_tokens ?? keyUsage?.usage?.today?.total_tokens);
    const totalTokens = toNumber(keyUsage?.usage?.total?.total_tokens);
    const quotaLimit = firstNumber(keyUsage?.quota?.limit, selectedKey?.quota);
    const quotaUsed = firstNumber(keyUsage?.quota?.used, selectedKey?.quota_used) || 0;
    const quotaPercent = quotaLimit && quotaLimit > 0 ? Math.min(100, Math.max(0, (quotaUsed / quotaLimit) * 100)) : 0;

    const openAccount = () => {
        setOpen(false);
        setModalOpen(true);
    };

    const signOut = async () => {
        setWorking(true);
        try {
            await logout();
            setOpen(false);
        } catch {
            message.error(t("account.summary.logoutFailed"));
        } finally {
            setWorking(false);
        }
    };

    const changeOpen = (nextOpen: boolean) => {
        setOpen(nextOpen);
        if (nextOpen && selectedKeyId) void refreshKeyUsage();
    };

    const formatExpiration = (value: string | null) => {
        if (!value) return t("account.summary.neverExpires");
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return t("account.summary.unknown");
        return new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "numeric" }).format(date);
    };

    const content = status === "restoring" && !profile ? (
        <div className="flex min-h-40 items-center justify-center gap-2 px-4 text-sm text-stone-500">
            <Spin size="small" />
            <span>{t("account.summary.restoring")}</span>
        </div>
    ) : profile ? (
        <div className="max-h-[calc(100dvh-24px)] overflow-y-auto p-4">
            <div className="flex min-w-0 items-center gap-3 border-b border-stone-200 pb-4 dark:border-stone-800">
                <Avatar size={44} src={profile.avatar_url} icon={<UserRound className="size-5" />} />
                <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold" title={profile.username || profile.email}>
                        {profile.username || profile.email}
                    </div>
                    <div className="mt-0.5 truncate text-xs text-stone-500" title={profile.email}>
                        {profile.email}
                    </div>
                    <div className="mt-1 text-[11px] text-stone-400">{t("account.summary.userId")}: {profile.id}</div>
                </div>
                <Tag color="green" className="m-0 shrink-0">{t("account.connected")}</Tag>
            </div>

            <div className="py-4">
                <div className="mb-2 flex items-center justify-between gap-3">
                    <div className="text-xs font-medium text-stone-500">{t("account.summary.currentKeyUsage")}</div>
                    <Button
                        type="text"
                        size="small"
                        className="!size-6 !min-w-6"
                        icon={<RefreshCw className="size-3.5" />}
                        loading={keyUsageLoading}
                        disabled={!selectedKey}
                        aria-label={t("account.summary.refreshUsage")}
                        title={t("account.summary.refreshUsage")}
                        onClick={() => void refreshKeyUsage()}
                    />
                </div>
                <div className="grid grid-cols-2 gap-2">
                    <Metric icon={<WalletCards />} label={t("account.summary.balance")} value={formatCurrency(balance, currencyFormat)} exact={balance === null ? undefined : currencyFormat.format(balance)} loading={keyUsageLoading && !keyUsage} />
                    <Metric icon={<Zap />} label={t("account.summary.todayTokens")} value={formatTokens(todayTokens, compactFormat)} exact={todayTokens === null ? undefined : integerFormat.format(todayTokens)} loading={keyUsageLoading && !keyUsage} />
                    <Metric icon={<History />} label={t("account.summary.totalTokens")} value={formatTokens(totalTokens, compactFormat)} exact={totalTokens === null ? undefined : integerFormat.format(totalTokens)} loading={keyUsageLoading && !keyUsage} />
                    <Metric icon={<Boxes />} label={t("account.summary.syncedModels")} value={integerFormat.format(syncedModelCount)} exact={integerFormat.format(syncedModelCount)} />
                </div>
                {keyUsageError ? <div className="mt-2 text-[11px] leading-4 text-red-500">{t(keyUsage ? "account.summary.usageStale" : "account.summary.usageUnavailable")}</div> : null}
                {keyUsageUpdatedAt ? (
                    <div className="mt-2 text-right text-[10px] text-stone-400">
                        {t("account.summary.updatedAt", { time: new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(keyUsageUpdatedAt) })}
                    </div>
                ) : null}
            </div>

            {selectedKey ? (
                <div className="border-t border-stone-200 py-4 dark:border-stone-800">
                    <div className="mb-2 flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
                        <span className="font-medium">{t("account.summary.quotaUsage")}</span>
                        <span className="min-w-0 break-all text-right text-stone-500 tabular-nums">
                            {quotaLimit && quotaLimit > 0 ? `${currencyFormat.format(quotaUsed)} / ${currencyFormat.format(quotaLimit)}` : `${currencyFormat.format(quotaUsed)} · ${t("account.summary.unlimited")}`}
                        </span>
                    </div>
                    {quotaLimit && quotaLimit > 0 ? <Progress percent={quotaPercent} size="small" showInfo={false} status={quotaPercent >= 100 ? "exception" : "normal"} /> : null}
                </div>
            ) : null}

            <div className="border-t border-stone-200 py-4 dark:border-stone-800">
                <div className="flex items-start gap-3">
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-stone-100 text-stone-600 dark:bg-stone-900 dark:text-stone-300">
                        <KeyRound className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center justify-between gap-2">
                            <div className="truncate text-sm font-medium" title={selectedKey?.name}>{selectedKey?.name || t("account.summary.noSelectedKey")}</div>
                            {selectedKey ? <span className={`shrink-0 text-[11px] ${keyReason ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}>{keyReason ? t(`account.keyReasons.${keyReason}`) : t("account.summary.available")}</span> : null}
                        </div>
                        {selectedKey ? (
                            <div className="mt-1 flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-[11px] text-stone-500">
                                <span className="max-w-full truncate" title={selectedKey.group?.name || undefined}>{selectedKey.group?.name || t("account.summary.none")}</span>
                                <span>{formatExpiration(selectedKey.expires_at)}</span>
                            </div>
                        ) : <div className="mt-1 text-[11px] leading-4 text-stone-500">{t("account.summary.selectKeyHint")}</div>}
                    </div>
                </div>
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-stone-200 pt-3 dark:border-stone-800">
                <Button type="text" danger size="small" icon={<LogOut className="size-4" />} loading={working} onClick={() => void signOut()}>{t("account.logout")}</Button>
                <Button type="text" size="small" icon={<Settings2 className="size-4" />} onClick={openAccount}>{t("account.summary.accountManagement")}</Button>
            </div>
        </div>
    ) : (
        <div className="p-4">
            <div className="flex items-center gap-3 pb-4">
                <Avatar size={42} icon={<UserRound className="size-5" />} />
                <div className="min-w-0">
                    <div className="text-sm font-semibold">{t("account.connectTitle")}</div>
                    <div className="mt-1 text-xs leading-5 text-stone-500">{t("account.summary.notSignedIn")}</div>
                </div>
            </div>
            <Button type="primary" block icon={<LogIn className="size-4" />} onClick={openAccount}>{t("account.login")}</Button>
        </div>
    );

    return (
        <Popover
            content={content}
            trigger="click"
            placement="bottomRight"
            open={open}
            onOpenChange={changeOpen}
            styles={{ container: { width: "min(360px, calc(100vw - 16px))" }, content: { padding: 0 } }}
        >
            {children}
        </Popover>
    );
}

function Metric({ icon, label, value, exact, loading = false }: { icon: ReactNode; label: string; value: string; exact?: string; loading?: boolean }) {
    return (
        <div className="min-h-20 rounded-md bg-stone-100/70 p-3 dark:bg-stone-900/70">
            <div className="flex items-center gap-1.5 text-[11px] leading-4 text-stone-500 [&_svg]:size-3.5">{icon}{label}</div>
            <div className="mt-2 truncate text-lg font-semibold tabular-nums" title={exact}>{loading ? <Spin size="small" /> : value}</div>
        </div>
    );
}

function localDateKey(date: Date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function usageStatusReason(status: string | undefined) {
    if (status === "quota_exhausted") return "quotaExhausted";
    if (status === "expired") return "expired";
    if (status === "active") return "";
    return null;
}

function toNumber(value: number | string | null | undefined) {
    if (value === null || value === undefined || value === "") return null;
    const result = Number(value);
    return Number.isFinite(result) ? result : null;
}

function firstNumber(...values: Array<number | string | null | undefined>) {
    for (const value of values) {
        const result = toNumber(value);
        if (result !== null) return result;
    }
    return null;
}

function formatCurrency(value: number | null, formatter: Intl.NumberFormat) {
    return value === null || value < 0 ? "--" : formatter.format(value);
}

function formatTokens(value: number | null, formatter: Intl.NumberFormat) {
    return value === null || value < 0 ? "--" : formatter.format(value);
}
