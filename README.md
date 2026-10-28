# KGUI

Windows 桌面编程助手。Pi 负责理解需求与组织任务，Codex CLI 在选定的 Git 仓库中执行操作，MyGo 提供桌面界面。

## 功能

- **单项目工作区**：启动时选择 Git 仓库，同一时间只打开一个项目、运行一个任务。
- **双栏界面**：左侧与 Pi 对话，右侧查看每次委派的完整任务、执行状态及返回结果。
- **执行详情**：展开命令查看原始输出与退出码；委派卡片展示耗时、用量及上游提供的文件变更事件。
- **只读与修改权限**：默认只读，勾选“允许修改”后可编辑项目文件。
- **停止任务**：停止当前执行及其所属子进程，结束后可以继续发送需求。
- **切换项目**：空闲时关闭当前会话，再选择其他仓库；切换后清空工作区内容并恢复只读。

## 环境准备

需要 Windows、Git 和 WebView2 Runtime，以及已安装并登录的 Codex CLI。安装脚本将 Node.js 24.22.1、Go 1.27.3 和 Bun 1.4.4 放入项目的 `.tools/`，不替换系统工具或修改永久 PATH。

在项目根目录运行 PowerShell：

```powershell
.\scripts\install-tools.ps1
.\scripts\setup-runtime.ps1
. .\scripts\use-tools.ps1
Push-Location desktop
bun install --frozen-lockfile
Pop-Location
```

复制配置示例：

```powershell
New-Item -ItemType Directory -Force .local
Copy-Item settings.example.json .local\settings.json
```

编辑 `.local/settings.json`，将 `<project-root>` 和 `<user-profile>` 替换为实际绝对路径：

| 配置项 | 用途 |
| --- | --- |
| `nodePath` | 项目内 `node.exe` 的绝对路径 |
| `codexEntry` | 本机 Codex CLI 的 `bin/codex.js` 入口路径 |
| `piProvider` | Pi 使用的服务，示例为 `openai-codex` |
| `piModel` | Pi 使用的模型，示例为 `gpt-6.1-sol:high` |

Pi 与 Codex CLI 分别登录。Pi 首次登录运行：

```powershell
.\scripts\pi.ps1 --provider openai-codex --model 'gpt-6.1-sol:high'
```

进入 Pi 后输入 `/login openai-codex`，完成浏览器授权。配置文件只保存路径与模型选择，不保存登录凭据。

## 构建与启动

首次使用或更新源码后，在项目根目录构建：

```powershell
. .\scripts\use-tools.ps1
Push-Location desktop
bun run build
Pop-Location
```

构建产物位于 `desktop/build/windows-amd64/`。启动应用：

```powershell
.\scripts\start.ps1
```

应用目前需从项目目录运行，并保留 `.tools/`、`runtime/` 和 `.local/settings.json`；生成的安装包不包含这些外部运行时。开发模式使用 `.\scripts\dev.ps1`。

## 操作方式

1. 点击“选择项目文件夹”，或输入已有 Git 仓库路径并点击“打开”。
2. 在左侧输入任务目标、修改范围和预期结果，点击“发送”或按 `Ctrl + Enter`。
3. 在右侧查看 Pi 下发的任务与 Codex 返回结果，展开“执行明细”查看命令及输出。
4. 需要编辑文件时，在发送前勾选“允许修改”。切换权限会重建 Pi 会话；后续任务使用新的会话上下文。
5. 执行期间可点击“停止”。运行中不能再次发送或切换项目、权限；停止后可继续发送。
6. 空闲时点击“更换项目”，返回项目选择页。当前对话与委派卡片将清空。

默认不会提交、推送或发布代码；这些操作需要用户明确要求。
