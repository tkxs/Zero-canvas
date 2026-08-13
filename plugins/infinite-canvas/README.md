# USA零 Codex Plugin

让 Codex 可以打开并操作 USA零。

插件默认连接运行在 `http://localhost:3000` 的本地 Web 前端，并通过本地 Canvas Agent 将画布接入 Codex。

## 安装

macOS / Linux：

```bash
git clone https://github.com/tkxs/Zero-canvas.git
cd Zero-canvas
codex plugin marketplace add "$(pwd)"
codex plugin add infinite-canvas@infinite-canvas-local
```

Windows PowerShell：

```powershell
git clone https://github.com/tkxs/Zero-canvas.git
cd Zero-canvas
codex plugin marketplace add "$PWD"
codex plugin add infinite-canvas@infinite-canvas-local
```

Windows CMD 将 `$PWD` 替换为 `%cd%`。

安装后新建一个 Codex 任务，然后输入：

```text
帮我打开并连接到 USA零
```
