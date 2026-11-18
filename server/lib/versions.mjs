// 已安装版本 / 最新版本检测，以及三端的更新命令
import { execFile, exec } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { PLATFORM } from './paths.mjs';

// 只用于固定的简单参数（--version、features list 等），不拼接任何用户输入
function run(cmd, args, timeout = 10000) {
  return new Promise((resolve) => {
    const opts = { timeout, windowsHide: true, env: { ...process.env, NO_COLOR: '1' }, maxBuffer: 8 * 1024 * 1024 };
    const done = (err, stdout, stderr) => resolve({ ok: !err, stdout: String(stdout || ''), stderr: String(stderr || ''), code: err?.code });
    // Windows 上 claude / codex / npm 多为 .cmd 包装脚本，需要经由 shell 执行
    if (PLATFORM === 'windows') exec([cmd, ...args].join(' '), opts, done);
    else execFile(cmd, args, opts, done);
  });
}

export async function which(cmd) {
  const r = PLATFORM === 'windows' ? await run('where', [cmd], 5000) : await run('which', [cmd], 5000);
  if (!r.ok) return null;
  const lines = r.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  return lines[0] || null;
}

let npmRootCache;
export async function npmGlobalRoot() {
  if (npmRootCache !== undefined) return npmRootCache;
  const r = await run('npm', ['root', '-g'], 15000);
  npmRootCache = r.ok ? r.stdout.trim() : null;
  return npmRootCache;
}

const SEMVER = /(\d+\.\d+\.\d+(?:-[\w.]+)?)/;

export async function installedVersion(cmd) {
  const r = await run(cmd, ['--version'], 15000);
  if (!r.ok) return null;
  const m = SEMVER.exec(r.stdout + ' ' + r.stderr);
  return m ? m[1] : null;
}

async function fetchJson(url, timeout = 6000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ctl.signal, headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

/** 查询 npm 最新版本：官方源失败时回退到 npmmirror（国内网络友好） */
export async function latestVersion(pkg) {
  const regs = ['https://registry.npmjs.org', 'https://registry.npmmirror.com'];
  for (const reg of regs) {
    try {
      const j = await fetchJson(`${reg}/${pkg}/latest`);
      if (j && j.version) return { version: j.version, registry: reg };
    } catch {}
  }
  return null;
}

export function compareVersions(a, b) {
  const pa = String(a).split(/[.-]/).map((x) => (/^\d+$/.test(x) ? +x : x));
  const pb = String(b).split(/[.-]/).map((x) => (/^\d+$/.test(x) ? +x : x));
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0, y = pb[i] ?? 0;
    if (x === y) continue;
    if (typeof x === 'number' && typeof y === 'number') return x - y;
    return String(x) < String(y) ? -1 : 1;
  }
  return 0;
}

/** 推断安装方式，给出对应的更新命令 */
function detectInstall(binPath) {
  if (!binPath) return 'unknown';
  const p = binPath.replace(/\\/g, '/').toLowerCase();
  if (p.includes('/npm/') || p.includes('node_modules') || p.includes('/nvm/') || p.includes('/fnm') || p.includes('/volta/') || p.endsWith('.cmd')) return 'npm';
  if (p.includes('/homebrew/') || p.includes('/cellar/') || p.includes('/linuxbrew/')) return 'brew';
  if (p.includes('/.local/bin/') || p.includes('/.local/share/claude') || p.includes('/programs/openai/codex')) return 'native';
  return 'unknown';
}

export function updateCommands(product, install) {
  const cmds = [];
  if (product === 'claude') {
    cmds.push({ label: '内置更新（推荐）', cmd: 'claude update' });
    if (install === 'npm' || install === 'unknown') cmds.push({ label: 'npm 安装', cmd: 'npm install -g @anthropic-ai/claude-code@latest' });
    if (install === 'brew') cmds.push({ label: 'Homebrew', cmd: 'brew upgrade --cask claude-code' });
    if (PLATFORM === 'windows') cmds.push({ label: '原生安装（PowerShell）', cmd: 'irm https://claude.ai/install.ps1 | iex' });
    else cmds.push({ label: '原生安装', cmd: 'curl -fsSL https://claude.ai/install.sh | bash' });
  } else {
    cmds.push({ label: '内置更新（推荐）', cmd: 'codex update' });
    if (install === 'npm' || install === 'unknown') cmds.push({ label: 'npm 安装', cmd: 'npm install -g @openai/codex@latest' });
    if (install === 'brew' || PLATFORM === 'macos') cmds.push({ label: 'Homebrew', cmd: 'brew upgrade --cask codex' });
    if (PLATFORM === 'windows') cmds.push({ label: '独立安装（PowerShell）', cmd: 'irm https://chatgpt.com/codex/install.ps1 | iex' });
    else cmds.push({ label: '独立安装', cmd: 'curl -fsSL https://chatgpt.com/codex/install.sh | sh' });
  }
  return cmds;
}

const PRODUCTS = {
  claude: { cmd: 'claude', pkg: '@anthropic-ai/claude-code', name: 'Claude Code' },
  codex: { cmd: 'codex', pkg: '@openai/codex', name: 'Codex CLI' },
};

let cache = null;
let cacheAt = 0;

export async function getVersions({ refresh = false, latest = true } = {}) {
  if (cache && !refresh && Date.now() - cacheAt < 10 * 60 * 1000) return cache;
  const out = {};
  await Promise.all(Object.entries(PRODUCTS).map(async ([id, p]) => {
    const [bin, ver, lat] = await Promise.all([
      which(p.cmd),
      installedVersion(p.cmd),
      latest ? latestVersion(p.pkg) : Promise.resolve(null),
    ]);
    const install = detectInstall(bin);
    out[id] = {
      name: p.name,
      bin,
      installed: ver,
      latest: lat?.version || null,
      registry: lat?.registry || null,
      outdated: !!(ver && lat?.version && compareVersions(ver, lat.version) < 0),
      install,
      updateCommands: updateCommands(id, install),
    };
  }));
  cache = out;
  cacheAt = Date.now();
  return out;
}

/** 定位 Claude Code 的原生程序文件（用于提取 settings schema） */
export async function findClaudeBinary() {
  const cands = [];
  const root = await npmGlobalRoot();
  if (root) {
    for (const n of ['claude.exe', 'claude']) cands.push(path.join(root, '@anthropic-ai', 'claude-code', 'bin', n));
    cands.push(path.join(root, '@anthropic-ai', 'claude-code', 'cli.js'));
  }
  const w = await which('claude');
  if (w) {
    try { cands.unshift(fs.realpathSync(w)); } catch {}
  }
  const home = os.homedir();
  cands.push(path.join(home, '.local', 'bin', PLATFORM === 'windows' ? 'claude.exe' : 'claude'));
  cands.push(path.join(home, '.claude', 'local', 'claude'));
  for (const c of cands) {
    try {
      const real = fs.realpathSync(c);
      const st = fs.statSync(real);
      // 原生程序体积很大；JS 版是 cli.js
      if (st.isFile() && (st.size > 20 * 1024 * 1024 || real.endsWith('.js'))) return real;
    } catch {}
  }
  return null;
}

/** 执行 codex features list，返回 [{ key, stage, enabled }] */
export async function codexFeaturesList() {
  const r = await run('codex', ['features', 'list'], 20000);
  if (!r.ok) return null;
  const rows = [];
  for (const line of r.stdout.split(/\r?\n/)) {
    const m = /^(\S+)\s+(stable|experimental|under development|deprecated|removed|beta)\s+(true|false)\s*$/.exec(line.trim());
    if (m) rows.push({ key: m[1], stage: m[2], enabled: m[3] === 'true' });
  }
  return rows.length ? rows : null;
}
