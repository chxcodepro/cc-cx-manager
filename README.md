# CC-CX 配置管理器

Claude Code 与 Codex 的图形化配置管理器，是 Windows / macOS / Linux 桌面程序，不需要浏览器或命令行。

- 可视化编辑 Claude Code 的 `settings.json`（含 `env` 环境变量）和 MCP 服务器（`~/.claude.json`、`.mcp.json`），以及 Codex 的 `config.toml`、`[features]` 功能开关和 `~/.codex/.env`。
- 参数目录覆盖约 1,570 个参数，每个都有**中文说明、推荐值和推荐理由**。参数取自官方 schema、官方文档和已安装程序本身，并对应当前最新版本：Claude Code 2.1.327、Codex 0.170.0。
- 升级 Claude Code 或 Codex 后，可以一键「同步最新参数」。新版本新增、但还没有中文说明的参数标记为「新参数」，并显示官方英文原文。

## 功能

| 页面 | 编辑的文件 | 参数数量 |
| --- | --- | --- |
| Claude Code · 设置 | `settings.json`（用户 / 项目 / 项目本地 / 托管策略） | 324 |
| Claude Code · 环境变量 | `settings.json` 中的 `env` 对象 | 413 |
| Claude Code · MCP 服务器 | `~/.claude.json` 的 `mcpServers`（用户 / 项目本地），`<项目>/.mcp.json`（项目） | 13 |
| Codex · 配置 | `config.toml`（用户 / 项目 / `requirements.toml` 原始文本） | 581 |
| Codex · 功能开关 | `config.toml` 中的 `[features]` 表 | 226 |
| Codex · 环境变量 | `~/.codex/.env` | 15，另会自动列出 `config.toml` 引用的变量 |

- **界面简洁**：每个参数只显示名称和控件。点名称旁的 **?**（或把鼠标移上去）可以看到：
  - 一句话说明「改了有什么效果」，以及默认值、推荐值和注意事项；
  - 更详细的说明和官方原文，收在「详细说明」里。
- **JSON 参数可视化**：Hooks、插件与插件市场、MCP 服务器、模型提供商这类 JSON / 表结构的参数用表单编辑，不用手写 JSON。
  - 现有配置会读进表单，列表和对象按条目显示，常用字段在前，不常用的收进「更多字段」。
  - 每个 JSON 参数右上角可切换「可视化 / JSON」，记住你上次的选择。
  - 没有预设结构的对象，按值的类型显示成文本、数字、开关、列表或对象。
- **保留原格式**：
  - TOML 只改动你修改的项，注释、空行、排版、键顺序都原样保留。
  - JSON 保留键顺序、缩进宽度、换行符（CRLF / LF）和 BOM，但整个文件会按标准格式排版，例如写在一行里的数组会展开成多行。Claude Code 自己写出的文件本来就是这种格式，所以通常只有你改的那几行有差异。
- **先看差异再保存**：保存前显示逐行差异。敏感值（API Key、令牌）在编辑界面中默认遮挡，点眼睛图标才显示。差异预览中显示的是明文，屏幕共享时请注意。
- **自动备份与恢复**：每次保存前备份原文件（每个文件最多保留 50 份），可随时一键恢复。
- **冲突检测**：如果文件在你编辑期间被 Claude Code、Codex 或其他程序修改，会拒绝覆盖并提示重新加载。
  - 例外是 `~/.claude.json`：Claude Code 运行时会频繁改写它，所以保存时把你的修改合并进文件的最新内容，不做冲突拒绝；这个文件也不提供原始文本编辑。
  - 改了 MCP 服务器后，需要重启 Claude Code 才会生效。
- **推荐配置**：「★ 推荐配置」会列出所有可应用的推荐值，勾选后一次性应用。默认值本身就是推荐值的参数不会被重复写入。
- **三端差异提示**：只适用于某个系统的参数会标注平台；部分参数的推荐值按系统区分，如沙箱在 macOS / Linux 上推荐开启。
- **Codex `.env` 辅助**：
  - 自动列出 `config.toml` 中 `model_providers.*.env_key`、`mcp_servers.*.bearer_token_env_var` 等字段引用的变量，方便直接在 `.env` 中填写 API Key。
  - Codex 会忽略 `.env` 中 `CODEX_` 开头的变量，这类变量会单独标出。
- **安全**：
  - 桌面程序不监听任何端口，界面与文件读写通过 Electron IPC 通信。
  - 外部链接在系统浏览器中打开。
  - 在 macOS / Linux 上，新建的 `.env` 和备份文件权限为 0600（仅当前用户可读写）；已有文件保留原权限。

## 下载与运行

可以到 [Releases](https://github.com/chxcodepro/cc-cx-manager/releases) 下载，也可以按下文「从源码构建」自己打包。

| 系统 | 文件 | 说明 |
| --- | --- | --- |
| Windows x64 | `CC-CX-Manager-<版本>-windows-x64-portable.exe` | 便携版，双击即用 |
| Windows x64 | `CC-CX-Manager-<版本>-windows-x64-setup.exe` | 安装版，可选择安装目录，创建桌面快捷方式 |
| macOS（Intel + Apple 芯片） | `CC-CX-Manager-<版本>-macos-universal.dmg` / `.zip` | 拖入「应用程序」 |
| Linux x64 | `.AppImage` / `.deb` / `.tar.gz` | 见下方 |

程序没有购买代码签名证书，首次运行时：

- **Windows**：SmartScreen 提示时点「更多信息」→「仍要运行」。
- **macOS**：程序只做了 ad-hoc 签名，没有经过 Apple 公证。提示「无法验证开发者」或「已损坏」时，执行下面的命令后再打开；也可以在「系统设置 → 隐私与安全性」中点「仍要打开」。

  ```bash
  xattr -dr com.apple.quarantine "/Applications/CC-CX Manager.app"
  ```

- **Linux**：AppImage 需要先加执行权限：

  ```bash
  chmod +x CC-CX-Manager-*-linux-x64.AppImage
  ```

  deb 包用 apt 安装：

  ```bash
  sudo apt install ./CC-CX-Manager-*-linux-x64.deb
  ```

  Ubuntu 24.04 及以上限制了 AppImage 使用的沙箱，双击没反应时，改用 deb 包，或加 `--no-sandbox` 参数启动 AppImage。

## 管理的配置文件

| 配置 | Windows | macOS | Linux |
| --- | --- | --- | --- |
| Claude 用户设置 | `%USERPROFILE%\.claude\settings.json` | `~/.claude/settings.json` | `~/.claude/settings.json` |
| Claude 项目设置 | `<项目>\.claude\settings.json` | `<项目>/.claude/settings.json` | 同 macOS |
| Claude 项目本地设置 | `<项目>\.claude\settings.local.json` | `<项目>/.claude/settings.local.json` | 同 macOS |
| Claude MCP 服务器（用户） | `%USERPROFILE%\.claude.json` 的 `mcpServers` | `~/.claude.json` 的 `mcpServers` | 同 macOS |
| Claude MCP 服务器（项目） | `<项目>\.mcp.json` | `<项目>/.mcp.json` | 同 macOS |
| Claude MCP 服务器（项目本地） | `.claude.json` 的 `projects["<项目路径>"].mcpServers` | 同 Windows | 同 Windows |
| Claude 托管策略 | `C:\Program Files\ClaudeCode\managed-settings.json` | `/Library/Application Support/ClaudeCode/managed-settings.json` | `/etc/claude-code/managed-settings.json` |
| Codex 用户配置 | `%USERPROFILE%\.codex\config.toml` | `~/.codex/config.toml` | `~/.codex/config.toml` |
| Codex 项目配置 | `<项目>\.codex\config.toml` | `<项目>/.codex/config.toml` | 同 macOS |
| Codex `.env` | `%USERPROFILE%\.codex\.env` | `~/.codex/.env` | `~/.codex/.env` |
| Codex 管理员要求 | `%ProgramData%\OpenAI\Codex\requirements.toml` | `/etc/codex/requirements.toml` | `/etc/codex/requirements.toml` |

- 设置了 `CLAUDE_CONFIG_DIR` 或 `CODEX_HOME` 环境变量时，以它们指定的目录为准；`.claude.json` 这时也在 `CLAUDE_CONFIG_DIR` 里。
- 项目级配置需要先在左下角「项目目录」中选择项目。
- 托管策略和 `requirements.toml` 是系统级文件，写入通常需要管理员权限。

## 参数目录从哪里来

| 目录 | 来源 |
| --- | --- |
| Claude Code `settings.json` | 从已安装的 Claude Code 程序中提取内置的设置 schema（比 SchemaStore 更完整） |
| Claude Code 环境变量 | 官方文档 `code.claude.com/docs/en/env-vars` |
| Claude Code MCP 服务器 | 已安装的 Claude Code 程序中的 MCP 配置校验规则 |
| Codex `config.toml` | 官方仓库对应版本标签下的 `config.schema.json` |
| Codex 功能开关 | 官方源码中的功能列表，以及 `codex features list` 输出（含阶段与默认值） |
| Codex `.env` | 官方文档 `learn.chatgpt.com/docs/config-file/environment-variables`；`.env` 加载规则已对照源码核实 |

中文说明、推荐值和推荐理由写在 `catalog/zh/*.zh.txt` 中文叠加层里，与上面的官方基础定义在运行时合并。

### 同步最新参数

升级 Claude Code 或 Codex 后，打开左下角「版本与参数目录」，点「同步最新参数」，程序会：

1. 从本机已安装的 Claude Code 中重新提取设置 schema；
2. 重新下载并解析 Claude Code 环境变量文档；
3. 下载与本机 Codex 版本对应的配置 schema；
4. 运行 `codex features list` 获取最新功能开关。

结果保存在 `~/.cc-cx-manager/cache/`。缓存版本比程序自带版本新时优先使用缓存，可在同一窗口中清除缓存。新增参数会立刻出现在界面中，标记为「新参数」。

## 备份与数据目录

管理器自身的数据保存在 `~/.cc-cx-manager/`（Windows 为 `%USERPROFILE%\.cc-cx-manager\`）：

- `backups/<配置 ID>/`：保存前的自动备份，文件名包含时间与原因；
- `cache/`：同步生成的参数目录；
- `prefs.json`：最近使用的项目目录。

设置环境变量 `CC_CX_MANAGER_HOME` 可以改到其他位置。

## 从源码构建

需要 Node.js 22.18 或更高版本。

```bash
npm ci
```

```bash
npm run desktop
```

`npm run desktop` 会构建界面并以开发模式启动桌面程序。打包前可以先运行测试：

```bash
npm test
```

打包命令：

```bash
npm run dist:win
```

```bash
npm run dist:mac
```

```bash
npm run dist:linux
```

安装包输出到 `release/`。electron-builder 只能在对应系统上打包 macOS 版本，Linux 版本也建议在 Linux 上打包。

### 用 GitHub Actions 构建三端版本

仓库自带 `.github/workflows/build.yml`。它会在 Windows、macOS、Linux 上分别：

1. 安装依赖并运行测试；
2. 打包；
3. 启动打包好的程序做一次自检，确认界面和全部参数目录都能正常加载；
4. 上传安装包。

有两种运行方式：

- **只构建**：在仓库的 Actions 页面选择 `build`，点「Run workflow」。完成后在这次运行的 Artifacts 里下载三个平台的安装包。
- **构建并发布**：推送 `v` 开头的标签，构建完成后会自动创建同名 Release 并附上全部安装包。安装包里的版本号取自标签，例如 `v1.0.1` 对应 `1.0.1`，所以标签要写成三段数字的格式。

  ```bash
  git tag v1.0.1
  ```

  ```bash
  git push origin v1.0.1
  ```

发布用的是 GitHub 自动提供的 `GITHUB_TOKEN`，不需要另外配置密钥。

其他脚本：

| 命令 | 作用 |
| --- | --- |
| `npm run gen-base` | 重新生成 `catalog/base/*.base.json`（开发者用） |
| `node scripts/check-overlay.mjs <目录名> --list` | 检查中文叠加层：未翻译参数、多余的键、推荐值类型、格式错误 |
| `npm run icon` | 重新生成应用图标 |

## 维护中文说明

叠加层是 UTF-8 纯文本，每行一个参数，字段用 `|` 分隔：

```text
@category 分类ID | 分类名称 | 排序 | 分类说明
@prefix 键前缀 => 分类ID
键 | 标题 | 分类 | 说明 | 推荐值(JSON) | 推荐理由 | 扩展
```

- 说明中的 `\n` 表示换行；字段内需要竖线时写成 `\|`。
- 推荐值是 JSON 字面量，如 `true`、`30`、`"high"`、`["a"]`。
- 扩展是用 `;;` 分隔的 `键=值`，常用的有：
  - `tags=security,experimental`
  - `p=windows`（适用平台）
  - `pn.macos=…`（平台说明）
  - `rp.linux=true`（平台推荐值）
  - `dep=…`（弃用说明）、`by=替代参数`
  - `ex=示例`、`ph=占位提示`、`s`（敏感值）

「?」弹出层第一行显示的一句话说明单独放在 `<目录名>.brief.zh.txt`（可拆成 `.brief.1.zh.txt` 等多个文件）中，每行一条：

```text
键 | 改这个参数有什么效果（不超过 40 字）
```

说明超过 30 字的参数都需要一句话说明；推荐理由也不超过 40 字。

修改后运行 `node scripts/check-overlay.mjs claude-settings`（或 `claude-env`、`codex-config`、`codex-env`）检查格式、缺失和长度，或直接运行 `npm test`。

## 常见问题

**Codex 的 `.env` 里写了 `CODEX_HOME` / `CODEX_API_KEY` 没有生效？**

Codex 只读取 `CODEX_HOME/.env`，并且出于安全考虑会忽略其中所有以 `CODEX_` 开头的变量，这类变量必须在系统环境中设置。其他变量（如服务商 API Key）会覆盖同名的系统环境变量。

**怎么给第三方 OpenAI 兼容服务配置 API Key？**

1. 在「Codex · 配置」的 `model_providers` 中新增一个服务商，`base_url` 填服务商地址，`env_key` 填一个变量名（如 `MY_PROVIDER_API_KEY`）。
2. 到「Codex · 环境变量」页，「config.toml 引用的变量」分类中会出现这个变量，填入 Key 即可：

```toml
[model_providers.my_provider]
name = "My Provider"
base_url = "<YOUR_BASE_URL>"
env_key = "MY_PROVIDER_API_KEY"
```

```dotenv
MY_PROVIDER_API_KEY=<YOUR_API_KEY>
```

**Claude Code 使用第三方中转？**

在「Claude Code · 环境变量」中设置 `ANTHROPIC_BASE_URL`（中转地址）和 `ANTHROPIC_AUTH_TOKEN` 或 `ANTHROPIC_API_KEY`（密钥）。如果中转只提供部分模型，还要检查以下模型变量，确认每个都指向中转实际支持的模型：

- `ANTHROPIC_DEFAULT_OPUS_MODEL`
- `ANTHROPIC_DEFAULT_SONNET_MODEL`
- `ANTHROPIC_DEFAULT_HAIKU_MODEL`
- `CLAUDE_CODE_SUBAGENT_MODEL`

否则子代理等功能会因模型不存在而失败。

## 许可证

MIT
