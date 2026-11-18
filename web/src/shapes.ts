// JSON 类参数的结构定义：让可视化编辑器知道有哪些字段、中文名称、取值范围
// 没有定义结构的参数，编辑器会根据现有内容自动推断（对象 / 列表 / 文本 / 数字 / 开关）
import type { Item } from './types';

export interface Opt { v: string; l?: string }
type Obj = Record<string, unknown>;

export interface Field {
  k: string;
  label: string;
  s: Shape;
  hint?: string;
  /** 高级字段：没有值时收在「更多字段」里 */
  adv?: boolean;
  /** 只在满足条件时显示（如 hook 的 type 为 command 时才有 command 字段） */
  when?: (o: Obj) => boolean;
}

export type Shape =
  | { t: 'string'; ph?: string; enum?: Opt[]; free?: boolean; long?: boolean; secret?: boolean }
  | { t: 'number'; ph?: string; unit?: string; int?: boolean }
  | { t: 'boolean' }
  | { t: 'list'; of: Shape; add?: string; template?: () => unknown; ph?: string }
  | { t: 'map'; of: Shape; keyPh?: string; keyEnum?: Opt[]; add?: string; template?: () => unknown; secret?: boolean }
  | { t: 'object'; fields: Field[]; summary?: (o: Obj) => string }
  | { t: 'union'; of: Shape[] }
  | { t: 'any' };

const str = (ph?: string, extra: Partial<Extract<Shape, { t: 'string' }>> = {}): Shape => ({ t: 'string', ph, ...extra });
const num = (unit?: string, ph?: string): Shape => ({ t: 'number', unit, ph, int: true });
const bool: Shape = { t: 'boolean' };
const strList = (ph?: string, add?: string): Shape => ({ t: 'list', of: { t: 'string' }, ph, add });
const strMap = (keyPh?: string, secret?: boolean): Shape => ({ t: 'map', of: { t: 'string', secret }, keyPh, secret });
const enumOf = (opts: Opt[], free = false): Shape => ({ t: 'string', enum: opts, free });

// ---------------- Hooks ----------------

const CLAUDE_HOOK_EVENTS: Opt[] = [
  { v: 'PreToolUse', l: '工具调用前' },
  { v: 'PostToolUse', l: '工具调用后' },
  { v: 'PostToolUseFailure', l: '工具调用失败后' },
  { v: 'PostToolBatch', l: '一批工具调用后' },
  { v: 'UserPromptSubmit', l: '提交提示时' },
  { v: 'UserPromptExpansion', l: '展开提示时' },
  { v: 'Notification', l: '发出通知时' },
  { v: 'Stop', l: '回合结束' },
  { v: 'StopFailure', l: '回合出错结束' },
  { v: 'SubagentStart', l: '子代理开始' },
  { v: 'SubagentStop', l: '子代理结束' },
  { v: 'SessionStart', l: '会话开始' },
  { v: 'SessionEnd', l: '会话结束' },
  { v: 'PreCompact', l: '压缩前' },
  { v: 'PostCompact', l: '压缩后' },
  { v: 'PreModelSwitch', l: '切换模型前' },
  { v: 'PostModelSwitch', l: '切换模型后' },
  { v: 'PermissionRequest', l: '请求权限时' },
  { v: 'PermissionDenied', l: '权限被拒绝时' },
  { v: 'Setup', l: '初始化时' },
  { v: 'TeammateIdle', l: '队友空闲时' },
  { v: 'TaskCreated', l: '创建任务时' },
  { v: 'TaskCompleted', l: '任务完成时' },
  { v: 'Elicitation', l: '请求你输入时' },
  { v: 'ElicitationResult', l: '收到你的输入时' },
  { v: 'ConfigChange', l: '配置变更时' },
  { v: 'WorktreeCreate', l: '创建 worktree 时' },
  { v: 'WorktreeRemove', l: '删除 worktree 时' },
  { v: 'InstructionsLoaded', l: '加载指令时' },
  { v: 'CwdChanged', l: '切换目录时' },
  { v: 'FileChanged', l: '文件变化时' },
  { v: 'DirectoryAdded', l: '添加目录时' },
  { v: 'MessageDisplay', l: '显示消息时' },
];

const HOOK_TYPE_LABEL: Record<string, string> = {
  command: '运行命令', http: '发送 HTTP 请求', prompt: '让模型判断', agent: '让代理检查', mcp_tool: '调用 MCP 工具',
};

const is = (...types: string[]) => (o: Obj) => types.includes(String(o.type ?? 'command'));

function hookSummary(o: Obj): string {
  const type = String(o.type ?? 'command');
  const main = (o.command ?? o.url ?? o.prompt ?? (o.server ? `${o.server} · ${o.tool ?? ''}` : '')) as string;
  const text = typeof main === 'string' ? main.replace(/\s+/g, ' ') : '';
  return `${HOOK_TYPE_LABEL[type] || type}${text ? '：' + (text.length > 60 ? text.slice(0, 60) + '…' : text) : ''}`;
}

const claudeHookHandler: Shape = {
  t: 'object',
  summary: hookSummary,
  fields: [
    { k: 'type', label: '类型', s: enumOf(Object.entries(HOOK_TYPE_LABEL).map(([v, l]) => ({ v, l }))) },
    { k: 'command', label: '命令', s: str('如 npx prettier --write "$CLAUDE_PROJECT_DIR"', { long: true }), when: is('command') },
    { k: 'url', label: '地址', s: str('接收 POST 请求的地址'), when: is('http') },
    { k: 'prompt', label: '提示', s: str('让模型检查什么，可用 $ARGUMENTS 引用输入', { long: true }), when: is('prompt', 'agent') },
    { k: 'server', label: 'MCP 服务器', s: str('已配置的 MCP 服务器名称'), when: is('mcp_tool') },
    { k: 'tool', label: '工具名', s: str(), when: is('mcp_tool') },
    { k: 'timeout', label: '超时', s: num('秒'), hint: '超过这个时间就中止这个 hook' },
    { k: 'if', label: '触发条件', s: str('如 Bash(git *)，留空表示总是运行'), hint: '用权限规则语法过滤：只有匹配的工具调用才运行', adv: true },
    { k: 'args', label: '参数列表', s: strList('每行一个参数'), hint: '填写后直接运行命令、不经过 Shell', adv: true, when: is('command') },
    { k: 'shell', label: 'Shell', s: enumOf([{ v: 'bash' }, { v: 'powershell' }]), adv: true, when: is('command') },
    { k: 'headers', label: '请求头', s: strMap('请求头名称', true), hint: '值里可用 $变量名 引用环境变量（需在下面允许）', adv: true, when: is('http') },
    { k: 'allowedEnvVars', label: '允许引用的变量', s: strList('每行一个变量名'), adv: true, when: is('http') },
    { k: 'input', label: '工具参数', s: { t: 'map', of: { t: 'any' }, keyPh: '参数名' }, adv: true, when: is('mcp_tool') },
    { k: 'model', label: '模型', s: str('留空使用默认的小模型'), adv: true, when: is('prompt', 'agent') },
    { k: 'onFailure', label: '失败时', s: enumOf([{ v: 'continue', l: '照常继续' }, { v: 'block', l: '阻止这次操作' }]), adv: true, when: is('command', 'http') },
    { k: 'continueOnBlock', label: '拦截后继续', s: bool, adv: true, when: is('prompt') },
    { k: 'async', label: '后台运行', s: bool, hint: '不等它运行完，不阻塞 Claude', adv: true, when: is('command') },
    { k: 'asyncRewake', label: '后台运行并在失败时提醒', s: bool, adv: true, when: is('command') },
    { k: 'statusMessage', label: '运行时提示', s: str('运行时在加载动画旁显示的文字'), adv: true },
    { k: 'once', label: '只运行一次', s: bool, adv: true },
  ],
};

function matcherSummary(o: Obj): string {
  const hooks = Array.isArray(o.hooks) ? o.hooks.length : 0;
  const m = typeof o.matcher === 'string' && o.matcher ? `匹配 ${o.matcher}` : '全部';
  return `${m} · ${hooks} 个动作`;
}

const claudeMatcherGroup = (handler: Shape): Shape => ({
  t: 'object',
  summary: matcherSummary,
  fields: [
    { k: 'matcher', label: '匹配', s: str('如 Edit|Write，留空表示全部'), hint: '工具类事件按工具名匹配，支持正则；会话开始等事件按来源匹配' },
    { k: 'hooks', label: '要做的事', s: { t: 'list', of: handler, add: '添加动作', template: () => ({ type: 'command', command: '' }) } },
  ],
});

const claudeHooks: Shape = {
  t: 'map',
  keyEnum: CLAUDE_HOOK_EVENTS,
  add: '添加事件',
  of: { t: 'list', of: claudeMatcherGroup(claudeHookHandler), add: '添加匹配规则', template: () => ({ matcher: '', hooks: [{ type: 'command', command: '' }] }) },
  template: () => [{ matcher: '', hooks: [{ type: 'command', command: '' }] }],
};

const CODEX_HOOK_TYPE: Opt[] = [
  { v: 'command', l: '运行命令' }, { v: 'mcp_tool', l: '调用 MCP 工具' }, { v: 'prompt', l: '让模型判断' }, { v: 'agent', l: '让代理检查' },
];

const codexHookHandler: Shape = {
  t: 'object',
  summary: hookSummary,
  fields: [
    { k: 'type', label: '类型', s: enumOf(CODEX_HOOK_TYPE) },
    { k: 'command', label: '命令', s: str('要运行的命令', { long: true }), when: is('command') },
    { k: 'commandWindows', label: 'Windows 命令', s: str('Windows 上改用这条命令', { long: true }), adv: true, when: is('command') },
    { k: 'server', label: 'MCP 服务器', s: str(), when: is('mcp_tool') },
    { k: 'tool', label: '工具名', s: str(), when: is('mcp_tool') },
    { k: 'input', label: '工具参数', s: { t: 'map', of: { t: 'any' }, keyPh: '参数名' }, adv: true, when: is('mcp_tool') },
    { k: 'timeout', label: '超时', s: num('秒'), when: is('command', 'mcp_tool') },
    { k: 'async', label: '后台运行', s: bool, adv: true, when: is('command') },
    { k: 'statusMessage', label: '运行时提示', s: str(), adv: true, when: is('command', 'mcp_tool') },
    { k: 'additionalContextLimit', label: '附加上下文上限', s: num('token'), adv: true, when: is('command') },
  ],
};

const codexHookEvent: Shape = {
  t: 'list',
  of: claudeMatcherGroup(codexHookHandler),
  add: '添加匹配规则',
  template: () => ({ matcher: '', hooks: [{ type: 'command', command: '' }] }),
};

// ---------------- 插件与市场 ----------------

const MARKET_SOURCE: Opt[] = [
  { v: 'github', l: 'GitHub 仓库' }, { v: 'git', l: 'Git 地址' }, { v: 'url', l: '网址' }, { v: 'directory', l: '本地目录' }, { v: 'file', l: '本地文件' },
];

const marketSource: Shape = {
  t: 'object',
  summary: (o) => String(o.repo ?? o.url ?? o.path ?? ''),
  fields: [
    { k: 'source', label: '来源类型', s: enumOf(MARKET_SOURCE, true) },
    { k: 'repo', label: '仓库', s: str('如 owner/repo'), when: (o) => o.source === 'github' || o.repo !== undefined },
    { k: 'url', label: '地址', s: str(), when: (o) => o.source === 'git' || o.source === 'url' || o.url !== undefined },
    { k: 'path', label: '路径', s: str(), when: (o) => o.source === 'directory' || o.source === 'file' || o.path !== undefined },
    { k: 'ref', label: '分支 / 标签', s: str(), adv: true },
  ],
};

const marketplaces: Shape = {
  t: 'map',
  keyPh: '市场名称',
  add: '添加插件市场',
  template: () => ({ source: { source: 'github', repo: '' } }),
  of: {
    t: 'object',
    summary: (o) => {
      const s = (o.source ?? {}) as Obj;
      return String(s.repo ?? s.url ?? s.path ?? '');
    },
    fields: [
      { k: 'source', label: '来源', s: marketSource },
      { k: 'autoUpdate', label: '自动更新', s: bool, adv: true },
    ],
  },
};

const marketSourceList: Shape = { t: 'list', of: marketSource, add: '添加来源', template: () => ({ source: 'github', repo: '' }) };

const mcpMatchList: Shape = {
  t: 'list',
  add: '添加规则',
  template: () => ({ serverName: '' }),
  of: {
    t: 'object',
    summary: (o) => String(o.serverName ?? o.serverUrl ?? (Array.isArray(o.serverCommand) ? o.serverCommand.join(' ') : '')),
    fields: [
      { k: 'serverName', label: '服务器名称', s: str() },
      { k: 'serverUrl', label: '服务器地址', s: str('支持 * 通配') },
      { k: 'serverCommand', label: '启动命令', s: strList('每行一段，如 npx、-y、包名'), adv: true },
    ],
  },
};

// ---------------- 其他 ----------------

const SHAPES: Record<string, Shape> = {
  // Claude Code settings.json
  hooks: claudeHooks,
  enabledPlugins: { t: 'map', of: bool, keyPh: '插件名@市场名', add: '添加插件', template: () => true },
  extraKnownMarketplaces: marketplaces,
  additionalMarketplaces: marketplaces,
  strictKnownMarketplaces: marketSourceList,
  allowedMarketplaces: marketSourceList,
  blockedMarketplaces: marketSourceList,
  skillOverrides: {
    t: 'map', keyPh: '技能名称', add: '添加技能', template: () => 'name-only',
    of: enumOf([{ v: 'name-only', l: '只显示名称' }, { v: 'user-invocable-only', l: '只能用 / 调用' }, { v: 'off', l: '完全隐藏' }]),
  },
  vimInsertModeRemaps: { t: 'map', of: enumOf([{ v: '<Esc>', l: '退出插入模式' }]), keyPh: '两个字符，如 jj', add: '添加映射', template: () => '<Esc>' },
  'sandbox.ignoreViolations': { t: 'map', of: strList('每行一个路径'), keyPh: '命令模式，* 表示全部', add: '添加规则', template: () => [] },
  'spinnerTipsOverride.tips': { t: 'list', of: { t: 'union', of: [{ t: 'string' }, { t: 'any' }] }, add: '添加提示', template: () => '' },
  theme: { t: 'union', of: [enumOf(['dark', 'light', 'dark-daltonized', 'light-daltonized', 'dark-ansi', 'light-ansi'].map((v) => ({ v })), true), { t: 'any' }] },
  timeFormat: { t: 'union', of: [enumOf([{ v: 'auto', l: '跟随系统' }, { v: '12-hour', l: '12 小时制' }, { v: '24-hour', l: '24 小时制' }, { v: '24-hour-utc', l: '24 小时制（UTC）' }], true), { t: 'any' }] },
  forceLoginOrgUUID: { t: 'union', of: [str('组织 UUID'), strList('每行一个组织 UUID')] },
  strictPluginOnlyCustomization: {
    t: 'union',
    of: [bool, { t: 'list', of: enumOf([{ v: 'skills', l: '技能' }, { v: 'agents', l: '代理' }, { v: 'hooks', l: 'Hooks' }, { v: 'mcp', l: 'MCP' }]), add: '添加类别', template: () => 'skills' }],
  },
  'modelSettings.*.autoCompactWindow': { t: 'union', of: [num('token'), enumOf([{ v: 'auto', l: '自动' }])] },
  'policyHelper.refreshIntervalMs': { t: 'union', of: [num('毫秒'), { t: 'any' }] },
  allowedMcpServers: mcpMatchList,
  deniedMcpServers: mcpMatchList,
  'modelPicker.options': {
    t: 'list', add: '添加模型', template: () => ({ model: '' }),
    of: {
      t: 'object',
      summary: (o) => String(o.label ?? o.model ?? ''),
      fields: [
        { k: 'model', label: '模型 ID', s: str('如 claude-opus-5-5') },
        { k: 'label', label: '显示名称', s: str() },
        { k: 'description', label: '说明', s: str(), adv: true },
      ],
    },
  },
  // Codex config.toml
  'tui.notifications': { t: 'union', of: [bool, strList('每行一个事件，如 agent-turn-complete')] },
  forced_chatgpt_workspace_id: { t: 'union', of: [str('工作区 UUID'), strList('每行一个工作区 UUID')] },
  'audio.microphone_channel': { t: 'union', of: [num(), { t: 'list', of: num(), add: '添加声道', template: () => 1 }] },
  'mcp_servers.*.env_vars': {
    t: 'list', add: '添加变量', template: () => '',
    of: { t: 'union', of: [str('变量名'), { t: 'object', fields: [{ k: 'name', label: '变量名', s: str() }, { k: 'source', label: '来源', s: enumOf([{ v: 'local', l: '本机' }, { v: 'remote', l: '远程执行器' }]) }] }] },
  },
  'tool_suggest.disabled_tools': { t: 'list', of: { t: 'any' }, add: '添加' },
};

/** 取参数的结构定义：record 字段用 fullKey（如 mcp_servers.*.env_vars），Codex 的各个 hook 事件共用一个结构 */
export function shapeFor(item: Item): Shape | undefined {
  const key = item.fullKey || item.key;
  if (SHAPES[key]) return SHAPES[key];
  if (/^hooks\.[A-Z]/.test(key)) return codexHookEvent;
  return undefined;
}

export function labelOf(opts: Opt[] | undefined, v: string): string | undefined {
  return opts?.find((o) => o.v === v)?.l;
}

// ---------------- 记录型条目（MCP 服务器、模型服务商等） ----------------

const claudeRemote = (e: Obj) => ['http', 'sse', 'ws'].includes(String(e.type)) || (e.type === undefined && e.url !== undefined && e.command === undefined);
const claudeLocal = (e: Obj) => !claudeRemote(e);
const codexLocal = (e: Obj) => e.url === undefined;
const codexRemote = (e: Obj) => e.command === undefined;

/** 记录型字段的显示条件（按完整键）：只显示与当前条目相关的字段 */
export const FIELD_WHEN: Record<string, (entry: Obj) => boolean> = {
  'mcpServers.*.command': claudeLocal,
  'mcpServers.*.args': claudeLocal,
  'mcpServers.*.env': claudeLocal,
  'mcpServers.*.url': claudeRemote,
  'mcpServers.*.headers': claudeRemote,
  'mcpServers.*.headersHelper': claudeRemote,
  'mcpServers.*.oauth.clientId': claudeRemote,
  'mcpServers.*.oauth.callbackPort': claudeRemote,
  'mcpServers.*.oauth.scopes': claudeRemote,
  'mcp_servers.*.command': codexLocal,
  'mcp_servers.*.args': codexLocal,
  'mcp_servers.*.env': codexLocal,
  'mcp_servers.*.env_vars': codexLocal,
  'mcp_servers.*.cwd': codexLocal,
  'mcp_servers.*.url': codexRemote,
  'mcp_servers.*.bearer_token_env_var': codexRemote,
  'mcp_servers.*.http_headers': codexRemote,
  'mcp_servers.*.env_http_headers': codexRemote,
  'mcp_servers.*.http_headers_helper': codexRemote,
  'mcp_servers.*.auth': codexRemote,
  'mcp_servers.*.oauth.client_id': codexRemote,
  'mcp_servers.*.oauth.client_secret': codexRemote,
  'mcp_servers.*.oauth.callback_port': codexRemote,
  'mcp_servers.*.oauth.callback_url': codexRemote,
  'mcp_servers.*.oauth.authorization_server_issuer': codexRemote,
  'mcp_servers.*.oauth.token_endpoint_auth_method': codexRemote,
  'mcp_servers.*.oauth_resource': codexRemote,
  'mcp_servers.*.scopes': codexRemote,
};

/** 记录型条目默认只显示这些常用字段（加上已设置的字段），其余收进「更多字段」 */
export const RECORD_MAIN: Record<string, string[]> = {
  mcpServers: ['type', 'command', 'args', 'env', 'url', 'headers'],
  mcp_servers: ['command', 'args', 'env', 'url', 'bearer_token_env_var', 'http_headers', 'enabled'],
  model_providers: ['name', 'base_url', 'env_key', 'wire_api', 'requires_openai_auth', 'query_params'],
  marketplaces: ['source_type', 'source', 'ref'],
};
