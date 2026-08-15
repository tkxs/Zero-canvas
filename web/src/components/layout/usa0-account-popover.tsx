import { App, Avatar, Button, Popover, Spin, Tag } from "antd";
import { Boxes, History, KeyRound, LogIn, LogOut, RefreshCw, Settings2, UserRound, WalletCards, Zap } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";

import { keyDisabledReason, useUsa0AuthStore } from "@/stores/use-usa0-auth-store";

export function Usa0AccountPopover({ children }: { children: ReactNode }) {
    const { message } = App.useApp();
    const { i18n, t } = useTranslation();
    const [open, setOpen] = useState(false);
    const [working, setWorking] = useState(false);
    const status = useUsa0AuthStore((state) => state.status);
    const profile = useUsa0AuthStore((state) => state.profile);
    const keys = useUsa0AuthStore((state) => state.keys);
    const keyModelCounts = useUsa0AuthStore((state) => state.keyModelCounts);
    const usageKeyId = useUsa0AuthStore((state) => state.usageKeyId);
    const keyUsage = useUsa0AuthStore((state) => state.keyUsage);
    const keyUsageLoading = useUsa0AuthStore((state) => state.keyUsageLoading);
    const keyUsageError = useUsa0AuthStore((state) => state.keyUsageError);
    const keyUsageUpdatedAt = useUsa0AuthStore((state) => state.keyUsageUpdatedAt);
    const refreshKeyUsage = useUsa0AuthStore((state) => state.refreshKeyUsage);
    const setModalOpen = useUsa0AuthStore((state) => state.setModalOpen);
    const logout = useUsa0AuthStore((state) => state.logout);
    const inspectedKey = keys.find((key) => key.id === usageKeyId);
    const syncedModelCount = Object.values(keyModelCounts).reduce((sum, count) => sum + count, 0);
    const locale = i18n.resolvedLanguage || "zh-CN";
    const integerFormat = new Intl.NumberFormat(locale);
    const compactFormat = new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 });
    const currencyFormat = new Intl.NumberFormat(locale, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const balance = firstNumber(keyUsage?.balance, keyUsage?.remaining, keyUsage?.quota?.remaining);
    const todayTokens = toNumber(keyUsage?.daily_usage?.find((item) => item.date === localDateKey(new Date()))?.total_tokens ?? keyUsage?.usage?.today?.total_tokens);
    const totalTokens = toNumber(keyUsage?.usage?.total?.total_tokens);

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
        if (nextOpen && usageKeyId) void refreshKeyUsage();
    };

    const content = ["restoring", "syncing"].includes(status) && !profile ? (
        <div className="flex min-h-40 items-center justify-center gap-2 px-4 text-sm text-stone-500"><Spin size="small" />{t("account.summary.restoring")}</div>
    ) : profile ? (
        <div className="max-h-[calc(100dvh-24px)] overflow-y-auto p-4">
            <div className="flex min-w-0 items-center gap-3 border-b border-stone-200 pb-4 dark:border-stone-800">
                <Avatar size={44} src={profile.avatar_url} icon={<UserRound className="size-5" />} />
                <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{profile.username || profile.email}</div>
                    <div className="mt-0.5 truncate text-xs text-stone-500">{profile.email}</div>
                </div>
                <Tag color="green" className="m-0 shrink-0">{t("account.connected")}</Tag>
            </div>
            <div className="py-4">
                <div className="mb-2 flex items-center justify-between gap-3">
                    <div className="text-xs font-medium text-stone-500">{t("account.summary.inspectedKeyUsage", { name: inspectedKey?.name || "--" })}</div>
                    <Button type="text" size="small" className="!size-6 !min-w-6" icon={<RefreshCw className="size-3.5" />} loading={keyUsageLoading} disabled={!inspectedKey} aria-label={t("account.summary.refreshUsage")} onClick={() => void refreshKeyUsage()} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                    <Metric icon={<WalletCards />} label={t("account.summary.balance")} value={formatCurrency(balance, currencyFormat)} loading={keyUsageLoading && !keyUsage} />
                    <Metric icon={<Zap />} label={t("account.summary.todayTokens")} value={formatTokens(todayTokens, compactFormat)} loading={keyUsageLoading && !keyUsage} />
                    <Metric icon={<History />} label={t("account.summary.totalTokens")} value={formatTokens(totalTokens, compactFormat)} loading={keyUsageLoading && !keyUsage} />
                    <Metric icon={<Boxes />} label={t("account.summary.syncedModels")} value={integerFormat.format(syncedModelCount)} />
                </div>
                {keyUsageError ? <div className="mt-2 text-[11px] leading-4 text-red-500">{t(keyUsage ? "account.summary.usageStale" : "account.summary.usageUnavailable")}</div> : null}
                {keyUsageUpdatedAt ? <div className="mt-2 text-right text-[10px] text-stone-400">{t("account.summary.updatedAt", { time: new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(keyUsageUpdatedAt) })}</div> : null}
            </div>
            <div className="flex items-start gap-3 border-t border-stone-200 py-4 dark:border-stone-800">
                <KeyRound className="mt-0.5 size-4 shrink-0 text-stone-400" />
                <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{inspectedKey?.name || t("account.summary.noSelectedKey")}</div>
                    <div className="mt-1 text-[11px] text-stone-500">{inspectedKey ? `${inspectedKey.group?.name || t("account.noGroup")} · ${keyDisabledReason(inspectedKey) ? t(`account.keyReasons.${keyDisabledReason(inspectedKey)}`) : t("account.summary.available")}` : t("account.summary.selectKeyHint")}</div>
                </div>
            </div>
            <div className="flex items-center justify-between gap-2 border-t border-stone-200 pt-3 dark:border-stone-800">
                <Button type="text" danger size="small" icon={<LogOut className="size-4" />} loading={working} onClick={() => void signOut()}>{t("account.logout")}</Button>
                <Button type="text" size="small" icon={<Settings2 className="size-4" />} onClick={openAccount}>{t("account.summary.accountManagement")}</Button>
            </div>
        </div>
    ) : (
        <div className="p-4">
            <div className="flex items-center gap-3 pb-4"><Avatar size={42} icon={<UserRound className="size-5" />} /><div><div className="text-sm font-semibold">{t("account.connectTitle")}</div><div className="mt-1 text-xs text-stone-500">{t("account.summary.notSignedIn")}</div></div></div>
            <Button type="primary" block icon={<LogIn className="size-4" />} onClick={openAccount}>{t("account.login")}</Button>
        </div>
    );

    return <Popover content={content} trigger="click" placement="bottomRight" open={open} onOpenChange={changeOpen} styles={{ container: { width: "min(360px, calc(100vw - 16px))" }, content: { padding: 0 } }}>{children}</Popover>;
}

function Metric({ icon, label, value, loading = false }: { icon: ReactNode; label: string; value: string; loading?: boolean }) {
    return <div className="min-h-20 rounded-md bg-stone-100/70 p-3 dark:bg-stone-900/70"><div className="flex items-center gap-1.5 text-[11px] leading-4 text-stone-500 [&_svg]:size-3.5">{icon}{label}</div><div className="mt-2 truncate text-lg font-semibold tabular-nums">{loading ? <Spin size="small" /> : value}</div></div>;
}
function localDateKey(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function toNumber(value: number | string | null | undefined) { const result = Number(value); return value === null || value === undefined || value === "" || !Number.isFinite(result) ? null : result; }
function firstNumber(...values: Array<number | string | null | undefined>) { for (const value of values) { const result = toNumber(value); if (result !== null) return result; } return null; }
function formatCurrency(value: number | null, formatter: Intl.NumberFormat) { return value === null || value < 0 ? "--" : formatter.format(value); }
function formatTokens(value: number | null, formatter: Intl.NumberFormat) { return value === null || value < 0 ? "--" : formatter.format(value); }
