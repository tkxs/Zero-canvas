# USA零 Codex Plugin

让 Codex 可以打开并操作 USA零。

插件默认连接运行在 `http://localhost:3000` 的本地 Web 前端，并通过本地 Canvas Agent 将画布接入 Codex。

## 安装

从 USA零「连接本地 Agent」页面下载完整插件 ZIP 并解压。

Windows PowerShell：

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

macOS / Linux：

```bash
sh ./install.sh
```

安装脚本会把插件复制到 `~/.usa0/codex-plugin-marketplace`，注册本地 Marketplace，并安装 `infinite-canvas@infinite-canvas-local`。重复运行脚本即可更新，不会修改其他插件或 Marketplace。

需要手动安装时，在解压目录依次执行：

```text
codex plugin marketplace add <解压目录或固定安装目录>
codex plugin add infinite-canvas@infinite-canvas-local
```

安装后新建一个 Codex 任务，然后输入：

```text
帮我打开并连接到 USA零
```
