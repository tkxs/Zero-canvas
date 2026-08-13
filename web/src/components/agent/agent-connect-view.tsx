import { Fragment, useState } from "react";
import { App, Button, Collapse, Input, Segmented, Tooltip } from "antd";
import copyToClipboard from "copy-to-clipboard";
import { saveAs } from "file-saver";
import { Check, Copy, Download, KeyRound, Link2, PackageCheck, PlugZap } from "lucide-react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";

const AGENT_PLUGIN_REMOVE_COMMAND = "codex plugin remove infinite-canvas";
const AGENT_MCP_REMOVE_COMMAND = "codex mcp remove infinite-canvas";
const CODEX_PLUGIN_DOWNLOAD_URL = "/downloads/usa0-codex-plugin.zip";
const CODEX_PLUGIN_DOWNLOAD_NAME = `usa0-codex-plugin-${__USA0_CODEX_PLUGIN_VERSION__}.zip`;

type InstallPlatform = "windows" | "unix";

function defaultInstallPlatform(): InstallPlatform {
    if (typeof navigator === "undefined") return "windows";
    return /mac|linux/i.test(navigator.userAgent) ? "unix" : "windows";
}

const INSTALL_COMMANDS: Record<InstallPlatform, { script: string; manual: string }> = {
    windows: {
        script: "powershell -ExecutionPolicy Bypass -File .\\install.ps1",
        manual: `$installRoot = Join-Path $HOME ".usa0\\codex-plugin-marketplace"
Remove-Item -LiteralPath $installRoot -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $installRoot | Out-Null
Copy-Item -LiteralPath ".\\.agents" -Destination $installRoot -Recurse -Force
Copy-Item -LiteralPath ".\\plugins" -Destination $installRoot -Recurse -Force
codex plugin marketplace remove infinite-canvas-local --json
codex plugin marketplace add $installRoot --json
codex plugin add infinite-canvas@infinite-canvas-local --json`,
    },
    unix: {
        script: "sh ./install.sh",
        manual: `install_root="$HOME/.usa0/codex-plugin-marketplace"
rm -rf "$install_root"
mkdir -p "$install_root"
cp -R "./.agents" "./plugins" "$install_root/"
codex plugin marketplace remove infinite-canvas-local --json || true
codex plugin marketplace add "$install_root" --json
codex plugin add infinite-canvas@infinite-canvas-local --json`,
    },
};

export function AgentConnectView({
    theme,
    url,
    token,
    enabled,
    connected,
    activity,
    connectError,
    onUrlChange,
    onTokenChange,
    onToggleEnabled,
}: {
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    url: string;
    token: string;
    enabled: boolean;
    connected: boolean;
    activity: string;
    connectError: string;
    onUrlChange: (value: string) => void;
    onTokenChange: (value: string) => void;
    onToggleEnabled: () => void;
}) {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const [installPlatform, setInstallPlatform] = useState<InstallPlatform>(defaultInstallPlatform);
    const [downloadingPlugin, setDownloadingPlugin] = useState(false);
    const steps = [{ title: t("agent.connect.pluginTitle"), text: t("agent.connect.pluginText") }, { title: t("agent.connect.directTitle"), text: t("agent.connect.directText"), command: "npx -y @basketikun/canvas-agent" }];
    const statusText = connectError ? t("agent.status.failed") : connected ? activity : enabled ? t("agent.status.connecting") : t("agent.status.disconnected");
    const statusColor = connectError ? "#dc2626" : connected ? "#16a34a" : enabled ? "#d97706" : theme.node.muted;
    const copyCommand = (command: string) => {
        copyToClipboard(command);
        message.success(t("agent.connect.commandCopied"));
    };
    const downloadPlugin = async () => {
        if (downloadingPlugin) return;
        setDownloadingPlugin(true);
        try {
            const response = await fetch(CODEX_PLUGIN_DOWNLOAD_URL, { cache: "no-store" });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const bytes = new Uint8Array(await response.arrayBuffer());
            if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error("Invalid ZIP response");
            saveAs(new Blob([bytes], { type: "application/zip" }), CODEX_PLUGIN_DOWNLOAD_NAME);
        } catch {
            message.error(t("agent.connect.pluginDownloadFailed"));
        } finally {
            setDownloadingPlugin(false);
        }
    };
    const commandRow = (command: string, multiline = false) => (
        <div className="flex min-w-0 items-start gap-2 rounded-md border bg-transparent px-2 py-1.5" style={{ borderColor: theme.node.stroke, color: theme.node.text }}>
            <code className={`min-w-0 flex-1 overflow-x-auto text-[11px] leading-5 ${multiline ? "whitespace-pre" : "whitespace-nowrap"}`}>{command}</code>
            <Tooltip title={t("agent.connect.copyCommand")}>
                <Button size="small" type="text" className="!h-6 !w-6 !min-w-6" icon={<Copy className="size-3.5" />} onClick={() => copyCommand(command)} />
            </Tooltip>
        </div>
    );
    const codexPluginInstall = (
        <div className="mt-3 space-y-3 border-t pt-3" style={{ borderColor: theme.node.stroke }}>
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2 text-xs" style={{ color: theme.node.muted }}>
                    <PackageCheck className="size-4 shrink-0" style={{ color: theme.node.text }} />
                    <span>{t("agent.connect.pluginContents")}</span>
                    <span className="shrink-0">v{__USA0_CODEX_PLUGIN_VERSION__}</span>
                </div>
                <Button type="primary" icon={<Download className="size-4" />} loading={downloadingPlugin} onClick={() => void downloadPlugin()}>
                    {t("agent.connect.downloadPlugin")}
                </Button>
            </div>
            <ol className="grid gap-2 text-xs leading-5" style={{ color: theme.node.muted }}>
                {[t("agent.connect.installStepDownload"), t("agent.connect.installStepRun"), t("agent.connect.installStepRestart")].map((text, index) => (
                    <li key={text} className="flex gap-2">
                        <span className="grid size-5 shrink-0 place-items-center rounded-full border text-[10px]" style={{ borderColor: theme.node.stroke, color: theme.node.text }}>{index + 1}</span>
                        <span>{text}</span>
                    </li>
                ))}
            </ol>
            <Segmented<InstallPlatform>
                block
                size="small"
                value={installPlatform}
                options={[{ label: "Windows", value: "windows" }, { label: "macOS / Linux", value: "unix" }]}
                onChange={setInstallPlatform}
            />
            {commandRow(INSTALL_COMMANDS[installPlatform].script)}
            <Collapse
                ghost
                size="small"
                items={[{
                    key: "manual",
                    label: t("agent.connect.manualInstall"),
                    children: <div className="space-y-2">{commandRow(INSTALL_COMMANDS[installPlatform].manual, true)}</div>,
                }]}
            />
            <div className="flex items-start gap-2 text-xs leading-5" style={{ color: theme.node.muted }}>
                <Check className="mt-0.5 size-3.5 shrink-0" style={{ color: "#16a34a" }} />
                <span>{t("agent.connect.installUpdateHint")}</span>
            </div>
        </div>
    );
    const codexPluginReminder = (
        <div className="rounded-lg border px-3 py-2.5 text-xs leading-5" style={{ borderColor: theme.node.stroke, color: theme.node.muted }}>
            <div className="font-medium" style={{ color: theme.node.text }}>
                {t("agent.connect.pluginReminder")}
            </div>
            <div className="mt-1">{t("agent.connect.pluginReminderText")}</div>
            <div className="mt-2 grid gap-1.5">
                {[
                    [t("agent.connect.removePlugin"), AGENT_PLUGIN_REMOVE_COMMAND],
                    [t("agent.connect.removeMcp"), AGENT_MCP_REMOVE_COMMAND],
                ].map(([label, command]) => (
                    <div key={command} className="flex items-center gap-2 rounded-md border bg-transparent px-2 py-1.5" style={{ borderColor: theme.node.stroke, color: theme.node.text }}>
                        <span className="shrink-0 text-[11px]" style={{ color: theme.node.muted }}>
                            {label}
                        </span>
                        <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-[11px] leading-5">{command}</code>
                        <Tooltip title={t("agent.connect.copyCommand")}>
                            <Button size="small" type="text" className="!h-6 !w-6 !min-w-6" icon={<Copy className="size-3.5" />} onClick={() => copyCommand(command)} />
                        </Tooltip>
                    </div>
                ))}
            </div>
        </div>
    );
    return (
        <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto p-4">
            <div className="space-y-4">
                <div>
                    <div className="text-base font-semibold leading-6">{t("agent.connect.title")}</div>
                    <div className="mt-1 text-xs leading-5" style={{ color: theme.node.muted }}>
                        {t("agent.connect.description")}
                    </div>
                </div>
                <div className="space-y-2">
                    {steps.map((step, index) => {
                        const command = "command" in step ? step.command : "";
                        return (
                            <Fragment key={step.title}>
                                <div className="rounded-lg px-3 py-2.5">
                                    <div className="text-sm font-medium leading-5">{step.title}</div>
                                    <div className="mt-1 text-xs leading-5" style={{ color: theme.node.muted }}>
                                        {step.text}
                                    </div>
                                    {command ? (
                                        <div className="mt-2">{commandRow(command)}</div>
                                    ) : null}
                                    {index === 0 ? codexPluginInstall : null}
                                </div>
                                {index === 0 ? codexPluginReminder : null}
                            </Fragment>
                        );
                    })}
                </div>
                <div className="rounded-lg border p-3" style={{ borderColor: theme.node.stroke }}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                            <div className="flex min-w-0 items-center gap-2">
                                <span className="shrink-0 text-sm font-medium leading-5">{t("agent.connect.webConnection")}</span>
                                <span
                                    className="inline-flex min-w-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] leading-4"
                                    style={{ borderColor: connected || enabled || connectError ? statusColor : theme.node.stroke, color: statusColor }}
                                >
                                    <span className="size-1.5 shrink-0 rounded-full" style={{ background: statusColor }} />
                                    <span className="truncate">{statusText}</span>
                                </span>
                            </div>
                            <div className="mt-1 text-xs leading-5" style={{ color: theme.node.muted }}>
                                {t("agent.connect.autoDiscover")}
                            </div>
                        </div>
                        <Button className="!h-8 !px-3" type={enabled ? "default" : "primary"} icon={<PlugZap className="size-4" />} onClick={onToggleEnabled}>
                            {t(enabled ? "agent.connect.disconnect" : "agent.connect.connect")}
                        </Button>
                    </div>
                    <div className="mt-3 grid gap-2.5">
                        <label className="grid gap-1.5">
                            <span className="flex items-center gap-1.5 text-xs font-medium" style={{ color: theme.node.muted }}>
                                <Link2 className="size-3.5" />
                                {t("agent.connect.localAddress")}
                                <span className="font-normal opacity-70">Local URL</span>
                            </span>
                            <Input size="large" prefix={<Link2 className="mr-1 size-4" style={{ color: theme.node.faint }} />} value={url} onChange={(event) => onUrlChange(event.target.value)} placeholder={t("agent.connect.urlPlaceholder")} />
                        </label>
                        <label className="grid gap-1.5">
                            <span className="flex items-center gap-1.5 text-xs font-medium" style={{ color: theme.node.muted }}>
                                <KeyRound className="size-3.5" />
                                {t("agent.connect.token")}
                                <span className="font-normal opacity-70">Connect token</span>
                            </span>
                            <Input.Password
                                size="large"
                                prefix={<KeyRound className="mr-1 size-4" style={{ color: theme.node.faint }} />}
                                value={token}
                                onChange={(event) => onTokenChange(event.target.value)}
                                placeholder={t("agent.connect.tokenPlaceholder")}
                            />
                        </label>
                        {connectError ? (
                            <div className="rounded-md border px-2.5 py-2 text-xs leading-5" style={{ borderColor: "rgba(220,38,38,.35)", color: "#dc2626" }}>
                                {connectError}
                            </div>
                        ) : null}
                    </div>
                </div>
            </div>
        </div>
    );
}
