import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { strToU8, zipSync } from "fflate";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

import { parseChangelog } from "./src/lib/release";

const webDir = dirname(fileURLToPath(import.meta.url));
const localVersion = readFileSync(resolve(webDir, "../VERSION"), "utf8").trim() || "dev";
const localChangelog = readFileSync(resolve(webDir, "../CHANGELOG.md"), "utf8");
const codexPluginManifest = JSON.parse(readFileSync(resolve(webDir, "../plugins/infinite-canvas/.codex-plugin/plugin.json"), "utf8")) as { version: string };
const codexPluginVersion = codexPluginManifest.version;
const codexPluginDownloadPath = "/downloads/usa0-codex-plugin.zip";

const windowsInstaller = String.raw`$ErrorActionPreference = "Stop"

$codex = Get-Command codex -ErrorAction SilentlyContinue
if (-not $codex) {
    Write-Error "Codex was not found. Install the Codex app or CLI, then run this script again."
    exit 1
}

$packageRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$homeDir = [Environment]::GetFolderPath("UserProfile")
if (-not $homeDir) {
    Write-Error "The user home directory could not be resolved."
    exit 1
}

$installRoot = Join-Path $homeDir ".usa0\codex-plugin-marketplace"
if (Test-Path -LiteralPath $installRoot) {
    Remove-Item -LiteralPath $installRoot -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $installRoot | Out-Null
Copy-Item -LiteralPath (Join-Path $packageRoot ".agents") -Destination $installRoot -Recurse -Force
Copy-Item -LiteralPath (Join-Path $packageRoot "plugins") -Destination $installRoot -Recurse -Force

& codex plugin marketplace remove infinite-canvas-local --json 2>$null
& codex plugin marketplace add $installRoot --json
if ($LASTEXITCODE -ne 0) { throw "Failed to register the USA0 plugin marketplace." }
& codex plugin add infinite-canvas@infinite-canvas-local --json
if ($LASTEXITCODE -ne 0) { throw "Failed to install the USA0 Codex plugin." }

Write-Host "USA0 Codex plugin installed. Start a new Codex task and ask: Help me open and connect to USA0."
`;

const unixInstaller = String.raw`#!/bin/sh
set -eu

if ! command -v codex >/dev/null 2>&1; then
    echo "Codex was not found. Install the Codex app or CLI, then run this script again." >&2
    exit 1
fi

package_root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
install_root="$HOME/.usa0/codex-plugin-marketplace"

rm -rf "$install_root"
mkdir -p "$install_root"
cp -R "$package_root/.agents" "$package_root/plugins" "$install_root/"

codex plugin marketplace remove infinite-canvas-local --json >/dev/null 2>&1 || true
codex plugin marketplace add "$install_root" --json
codex plugin add infinite-canvas@infinite-canvas-local --json

echo "USA0 Codex plugin installed. Start a new Codex task and ask: Help me open and connect to USA0."
`;

const packageReadme = `# USA0 Codex Plugin ${codexPluginVersion}

This package installs the complete USA0 Codex plugin, including two Skills and the Canvas Agent MCP configuration.

## Install

- Windows PowerShell: \`powershell -ExecutionPolicy Bypass -File .\\install.ps1\`
- macOS / Linux: \`sh ./install.sh\`

The installer copies this marketplace to \`~/.usa0/codex-plugin-marketplace\`, registers it with Codex, and installs \`infinite-canvas@infinite-canvas-local\`.

After installation, start a new Codex task and ask: \`帮我打开并连接到 USA零\`.
`;

function createCodexPluginZip() {
    const sourceFiles: Array<[string, string]> = [
        [".agents/plugins/marketplace.json", "../.agents/plugins/marketplace.json"],
        ["plugins/infinite-canvas/.codex-plugin/plugin.json", "../plugins/infinite-canvas/.codex-plugin/plugin.json"],
        ["plugins/infinite-canvas/.mcp.json", "../plugins/infinite-canvas/.mcp.json"],
        ["plugins/infinite-canvas/README.md", "../plugins/infinite-canvas/README.md"],
        ["plugins/infinite-canvas/assets/icon.png", "../plugins/infinite-canvas/assets/icon.png"],
        ["plugins/infinite-canvas/skills/canvas/SKILL.md", "../plugins/infinite-canvas/skills/canvas/SKILL.md"],
        ["plugins/infinite-canvas/skills/open-canvas/SKILL.md", "../plugins/infinite-canvas/skills/open-canvas/SKILL.md"],
    ];
    const entries: Record<string, Uint8Array> = {
        "README.md": strToU8(packageReadme),
        "install.ps1": strToU8(windowsInstaller),
        "install.sh": strToU8(unixInstaller),
    };
    sourceFiles.forEach(([archivePath, sourcePath]) => {
        entries[archivePath] = new Uint8Array(readFileSync(resolve(webDir, sourcePath)));
    });
    return zipSync(entries, { level: 6 });
}

function codexPluginDownload(): Plugin {
    const downloadName = `usa0-codex-plugin-${codexPluginVersion.replace(/[^a-zA-Z0-9.+-]/g, "-")}.zip`;
    return {
        name: "usa0-codex-plugin-download",
        configureServer(server) {
            server.middlewares.use((req, res, next) => {
                if (req.url?.split("?", 1)[0] !== codexPluginDownloadPath) return next();
                res.setHeader("Content-Type", "application/zip");
                res.setHeader("Content-Disposition", `attachment; filename="${downloadName}"`);
                res.setHeader("Cache-Control", "no-store");
                res.end(createCodexPluginZip());
            });
        },
        generateBundle() {
            this.emitFile({ type: "asset", fileName: codexPluginDownloadPath.slice(1), source: createCodexPluginZip() });
        },
    };
}

// Expose /plugins/index.json with local plugin files from public/plugins.
// The frontend can discover and list them when enabled; development reads the directory live, while builds emit a static registry.
function localPluginsManifest(): Plugin {
    const pluginsDir = resolve(webDir, "public/plugins");
    const listLocalPlugins = () => {
        try {
            return readdirSync(pluginsDir)
                .filter((file) => file.endsWith(".js"))
                .sort()
                .map((file) => `/plugins/${file}`);
        } catch {
            return [];
        }
    };
    return {
        name: "local-plugins-manifest",
        configureServer(server) {
            server.middlewares.use("/plugins/index.json", (_req, res) => {
                res.setHeader("Content-Type", "application/json");
                res.end(JSON.stringify(listLocalPlugins()));
            });
        },
        generateBundle() {
            this.emitFile({ type: "asset", fileName: "plugins/index.json", source: JSON.stringify(listLocalPlugins()) });
        },
    };
}

export default defineConfig({
    base: process.env.VITE_BASE || "/",
    plugins: [react(), localPluginsManifest(), codexPluginDownload()],
    resolve: {
        alias: {
            "@": resolve(webDir, "src"),
        },
    },
    define: {
        __APP_VERSION__: JSON.stringify(localVersion),
        __APP_RELEASES__: JSON.stringify(parseChangelog(localChangelog)),
        __USA0_CODEX_PLUGIN_VERSION__: JSON.stringify(codexPluginVersion),
    },
});
