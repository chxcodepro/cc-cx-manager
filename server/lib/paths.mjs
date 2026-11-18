// 三端（Windows / macOS / Linux）路径解析
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

export const PLATFORM = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux';

export function isWSL() {
  if (PLATFORM !== 'linux') return false;
  try {
    return /microsoft/i.test(fs.readFileSync('/proc/version', 'utf8'));
  } catch {
    return false;
  }
}

export function expandHome(p) {
  if (!p) return p;
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(os.homedir(), p.slice(2));
  return p;
}

/** Claude Code 用户配置目录：尊重 CLAUDE_CONFIG_DIR */
export function claudeConfigDir() {
  const v = process.env.CLAUDE_CONFIG_DIR;
  return v ? path.resolve(expandHome(v)) : path.join(os.homedir(), '.claude');
}

/** Codex 主目录：尊重 CODEX_HOME */
export function codexHome() {
  const v = process.env.CODEX_HOME;
  return v ? path.resolve(expandHome(v)) : path.join(os.homedir(), '.codex');
}

/** Claude Code 托管策略目录（系统级） */
export function claudeManagedDir() {
  if (PLATFORM === 'windows') return path.join(process.env.ProgramFiles || 'C:\\Program Files', 'ClaudeCode');
  if (PLATFORM === 'macos') return '/Library/Application Support/ClaudeCode';
  return '/etc/claude-code';
}

/** Codex 系统级要求文件目录 */
export function codexSystemDir() {
  if (PLATFORM === 'windows') return path.join(process.env.ProgramData || 'C:\\ProgramData', 'OpenAI', 'Codex');
  return '/etc/codex';
}

/** Claude Code 的全局状态文件（保存用户级和项目本地的 MCP 服务器）：设置了 CLAUDE_CONFIG_DIR 时在其中，否则在主目录 */
export function claudeGlobalConfigPath() {
  const v = process.env.CLAUDE_CONFIG_DIR;
  return v ? path.join(path.resolve(expandHome(v)), '.claude.json') : path.join(os.homedir(), '.claude.json');
}

/** ~/.claude.json 中 projects 的键：Windows 上用正斜杠；已有条目不区分大小写匹配 */
export function claudeProjectKey(projectDir) {
  if (!projectDir) return null;
  let key = path.resolve(projectDir);
  // Claude Code 在 Windows 上记录为「大写盘符 + 正斜杠」，如 D:/project/app
  if (PLATFORM === 'windows') key = key.replace(/\\/g, '/').replace(/^[a-z](?=:)/, (d) => d.toUpperCase());
  try {
    const data = JSON.parse(fs.readFileSync(claudeGlobalConfigPath(), 'utf8').replace(/^\uFEFF/, ''));
    const keys = Object.keys((data && data.projects) || {});
    const hit = keys.find((k) => (PLATFORM === 'windows' ? k.toLowerCase() === key.toLowerCase() : k === key));
    if (hit) return hit;
  } catch {
    // 文件不存在或格式错误：使用规范化后的路径
  }
  return key;
}

/** 管理器自身的数据目录：备份、缓存、偏好 */
export function appDataDir() {
  const v = process.env.CC_CX_MANAGER_HOME;
  return v ? path.resolve(expandHome(v)) : path.join(os.homedir(), '.cc-cx-manager');
}

/**
 * 所有可编辑的配置文件（target）。
 * format: json | toml | dotenv
 * catalog: 该文件使用的参数目录
 */
export function resolveTargets(projectDir) {
  const claudeDir = claudeConfigDir();
  const claudeGlobal = claudeGlobalConfigPath();
  const cxHome = codexHome();
  const list = [
    {
      id: 'claude-user', product: 'claude', format: 'json', scope: 'user', catalog: 'claude-settings',
      label: '用户设置', desc: '对你的所有项目生效',
      path: path.join(claudeDir, 'settings.json'),
    },
    {
      id: 'claude-project', product: 'claude', format: 'json', scope: 'project', catalog: 'claude-settings',
      label: '项目设置', desc: '提交到仓库，团队共享', requiresProject: true,
      path: projectDir ? path.join(projectDir, '.claude', 'settings.json') : null,
    },
    {
      id: 'claude-local', product: 'claude', format: 'json', scope: 'local', catalog: 'claude-settings',
      label: '项目本地设置', desc: '只对你在此项目生效，通常被 git 忽略', requiresProject: true,
      path: projectDir ? path.join(projectDir, '.claude', 'settings.local.json') : null,
    },
    {
      id: 'claude-managed', product: 'claude', format: 'json', scope: 'managed', catalog: 'claude-settings',
      label: '托管策略', desc: '企业管理员下发，优先级最高；写入通常需要管理员权限', system: true,
      path: path.join(claudeManagedDir(), 'managed-settings.json'),
    },
    // Claude Code 的 MCP 服务器不在 settings.json 里：用户级与项目本地级保存在 ~/.claude.json，项目级在 .mcp.json
    // ~/.claude.json 会被 Claude Code 频繁改写（live）：保存时只把你的修改合并进最新内容，且不提供原始文本编辑
    {
      id: 'claude-mcp-user', product: 'claude', format: 'json', scope: 'user', catalog: 'claude-mcp',
      label: '用户', desc: '保存在 ~/.claude.json，对你的所有项目生效（相当于 claude mcp add --scope user）',
      path: claudeGlobal, live: true, rawDisabled: true, dataPick: ['mcpServers'],
    },
    {
      id: 'claude-mcp-project', product: 'claude', format: 'json', scope: 'project', catalog: 'claude-mcp',
      label: '项目', desc: '项目根目录的 .mcp.json，提交到仓库与团队共享（相当于 --scope project）', requiresProject: true,
      path: projectDir ? path.join(projectDir, '.mcp.json') : null,
    },
    {
      id: 'claude-mcp-local', product: 'claude', format: 'json', scope: 'local', catalog: 'claude-mcp',
      label: '项目本地', desc: '保存在 ~/.claude.json 中这个项目的条目里，只对你在这个项目生效（claude mcp add 的默认范围）', requiresProject: true,
      path: projectDir ? claudeGlobal : null, dataPrefix: projectDir ? ['projects', claudeProjectKey(projectDir)] : undefined,
      live: true, rawDisabled: true, dataPick: ['mcpServers'],
    },
    {
      id: 'codex-user', product: 'codex', format: 'toml', scope: 'user', catalog: 'codex-config',
      label: 'config.toml', desc: 'Codex 用户配置（CLI、IDE 插件、桌面端共用）',
      path: path.join(cxHome, 'config.toml'),
    },
    {
      id: 'codex-project', product: 'codex', format: 'toml', scope: 'project', catalog: 'codex-config',
      label: '项目 config.toml', desc: '仅在项目被信任时生效，覆盖用户配置', requiresProject: true,
      path: projectDir ? path.join(projectDir, '.codex', 'config.toml') : null,
    },
    {
      id: 'codex-env', product: 'codex', format: 'dotenv', scope: 'user', catalog: 'codex-env',
      label: '.env', desc: 'Codex 启动时加载的环境变量（CODEX_ 开头的变量会被忽略）',
      path: path.join(cxHome, '.env'),
    },
    {
      id: 'codex-requirements', product: 'codex', format: 'toml', scope: 'managed', catalog: 'codex-config',
      label: 'requirements.toml', desc: '系统级管理员要求（强制约束），写入通常需要管理员权限', system: true,
      path: path.join(codexSystemDir(), 'requirements.toml'),
    },
  ];
  return list;
}

export function pathInfo(p) {
  if (!p) return { exists: false };
  try {
    const st = fs.statSync(p);
    let writable = false;
    try {
      fs.accessSync(p, fs.constants.W_OK);
      writable = true;
    } catch {}
    return { exists: true, size: st.size, mtimeMs: st.mtimeMs, writable };
  } catch {
    // 文件不存在：看能否在父目录创建
    let dir = path.dirname(p);
    while (dir && !fs.existsSync(dir)) {
      const up = path.dirname(dir);
      if (up === dir) break;
      dir = up;
    }
    let writable = false;
    try {
      fs.accessSync(dir, fs.constants.W_OK);
      writable = true;
    } catch {}
    return { exists: false, writable };
  }
}
