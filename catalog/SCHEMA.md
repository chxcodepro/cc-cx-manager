# 参数目录（catalog）文件格式

管理器界面完全由本目录下的 `*.json` 驱动。每个文件是一个「目录片段」，同一 `target` 的多个片段会在加载时合并。

## 目标（target）

| target | 对应文件 | 键名形式 |
|---|---|---|
| `claude-settings` | `~/.claude/settings.json`、`.claude/settings.json`、`.claude/settings.local.json`、managed-settings.json | JSON 点路径：`permissions.defaultMode`、`sandbox.network.allowLocalBinding` |
| `claude-env` | settings.json 里的 `env` 对象 | 环境变量名：`ANTHROPIC_BASE_URL` |
| `codex-config` | `~/.codex/config.toml`、`<项目>/.codex/config.toml` | TOML 点路径：`tui.notifications`；动态键段写 `*`：`mcp_servers.*.command` |
| `codex-env` | `~/.codex/.env`（CODEX_HOME/.env） | 环境变量名：`OPENAI_API_KEY` |

## 文件结构

```json
{
  "target": "codex-config",
  "part": "main",
  "title": "Codex config.toml",
  "targetVersion": "0.170.0",
  "verifiedAt": "2026-11-17",
  "sources": ["https://..."],
  "categories": [
    { "id": "model", "name": "模型与推理", "description": "可选，一句话说明", "order": 10 }
  ],
  "items": [ /* 条目，见下 */ ]
}
```

- `categories`：分类按 `order` 升序显示。不同片段里同 id 的分类会合并（以先出现的为准），所以请优先使用下文给定的分类 id。
- `items` 中 `key` 在同一 target 内必须唯一。

## 条目字段

| 字段 | 必填 | 说明 |
|---|---|---|
| `key` | ✅ | 见上表。动态键（用户自定义名字的表）用 `*` 占位 |
| `title` | ✅ | 简短中文名，≤16 字，例如「推理强度」 |
| `category` | ✅ | 必须是某个 `categories[].id` |
| `type` | ✅ | `boolean` `string` `integer` `number` `enum` `string[]` `enum[]` `map` `record` `group` `json` |
| `description` | ✅ | 中文说明：作用、各取值含义、生效条件、注意事项。1~4 句，必要时用 `\n` 分段。不要照抄英文，要让中文用户看懂 |
| `enum` | type=enum/enum[] 时必填 | `[{ "value": "high", "label": "高", "description": "可选" }]`，value 必须与官方取值完全一致 |
| `default` | | 官方默认值。未知或动态时省略，改写 `defaultNote` |
| `defaultNote` | | 默认值的文字说明，如「取决于订阅类型」 |
| `recommended` | | 推荐值，必须是该参数的合法取值。没有普适推荐时省略 |
| `recommendedReason` | | 推荐理由；没有推荐值时可以写使用建议（如「保持默认即可，仅在 X 时调整」） |
| `example` | | 示例值。`json` / `record` / `map` / `string[]` 类型请务必提供 |
| `placeholder` | | 输入框占位提示 |
| `unit` | | 单位：`ms` `秒` `tokens` `天` `字符` `%` 等 |
| `min` / `max` | | 数值范围 |
| `scopes` | | **仅 claude-settings**：可生效的范围，取值 `user` `project` `local` `managed`。缺省 = 全部范围。只在托管策略中生效的写 `["managed"]` |
| `tags` | | 见下方标签表 |
| `deprecated` | | 已弃用 / 已移除 / 无效时为 `true` |
| `deprecatedNote` | | 弃用说明与替代方案 |
| `replacedBy` | | 替代它的参数 key |
| `since` | | 引入版本（确知才写） |
| `sensitive` | | 密钥、令牌等敏感值为 `true`（界面会打码） |
| `envTrue` / `envFalse` | | 仅 env 类：布尔变量开启时写入的字符串（默认 `"1"`）；只有写入 `"0"`/`"false"` 与「不设置」效果不同时才给 `envFalse` |
| `platforms` | | 仅特定平台生效时：`windows` `macos` `linux`（缺省 = 三端通用） |
| `recommendedByPlatform` | | 推荐值因平台而异时使用：`{ "windows": ..., "macos": ..., "linux": ... }`，可只写部分平台，其余回落到 `recommended` |
| `platformNotes` | | 平台差异说明：`{ "windows": "…", "macos": "…", "linux": "…" }`（路径、默认值、行为不同等），可只写有差异的平台 |
| `docUrl` | | 官方文档链接 |
| `stage` | | 仅 Codex features：`stable` `experimental` `under development` `deprecated` `removed` |
| `fieldKeys` | | 仅 `profiles` 这类复用顶层字段的 record：可用字段名列表 |

### type 的含义

- `boolean` / `string` / `integer` / `number`：基本类型。
- `enum`：单选；`enum[]`：多选数组。
- `string[]`：字符串数组（如权限规则列表）。
- `map`：字符串到字符串的键值表（如 `http_headers`、`env`）。
- `record`：用户自定义名字的表，每个条目结构相同（如 `mcp_servers`、`model_providers`）。其字段写成独立条目：`mcp_servers.*.command`。
- `group`：只起分组作用的父对象（如 `sandbox_workspace_write`），通常不需要单独条目；子字段各自成条目。
- `json`：结构复杂或多种类型联合（如 `hooks`），界面提供 JSON 编辑器。**必须给 `example`**。

### 标签（tags）

| 标签 | 含义 |
|---|---|
| `managed-only` | 只在企业托管配置中生效 |
| `enterprise` | 面向企业/团队管理员 |
| `experimental` | 实验性 |
| `advanced` | 高级，普通用户一般不用改 |
| `security` | 影响安全边界（权限、沙箱、密钥） |
| `restart` | 修改后需重启才生效 |
| `desktop` | 作用于桌面端 App |
| `ide` | 作用于 IDE 集成 |
| `internal` | 内部/调试用途 |
| `undocumented` | 只存在于程序 schema，官方文档未写 |
| `windows` `macos` `linux` | 平台相关 |

## 写作规范

1. **准确第一**：说明、默认值、取值必须来自官方文档 / 官方 schema / 源码。不确定的不要编，省略该字段或写「以官方文档为准」。
2. **推荐值要克制**：只在对「个人开发者日常使用」有明确收益时给 `recommended`，并写清理由。降低安全性的选项不要推荐，或在理由里写明风险。
3. **密钥与地址**：API Key、Token、Base URL 一律不给推荐值，示例/占位用 `<YOUR_API_KEY>`、`<YOUR_BASE_URL>` 这类占位符。
4. 中文使用简体中文与中文标点；参数名、取值、命令保持英文原文。
5. **三端适配**：管理器要在 Windows、macOS、Linux 上使用。凡是只在某平台生效、或路径/默认值/行为因平台不同的参数，必须填写 `platforms` 或 `platformNotes`；推荐值因平台不同时用 `recommendedByPlatform`。描述里出现路径时，三端写法都要给出（如 `~/.codex` 在 Windows 上是 `%USERPROFILE%\.codex`）。
6. JSON 必须合法（注意转义双引号和反斜杠），写完运行校验：
   `node scripts/validate-catalog.mjs catalog/<文件名>.json`
