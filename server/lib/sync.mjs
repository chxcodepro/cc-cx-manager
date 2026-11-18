// 「同步最新参数」：从本机已安装的程序与官方源重新生成基础定义，
// 让管理器在 Claude Code / Codex 升级后自动认识新增参数（未翻译的会标注出来）
import { extractClaudeSettingsFromBinary } from './claude-schema.mjs';
import { flattenCodexSchema } from './codex-schema.mjs';
import { parseClaudeEnvDoc } from './env-docs.mjs';
import { findClaudeBinary, installedVersion, codexFeaturesList } from './versions.mjs';
import { loadBase, writeCache, getCatalog } from './catalog.mjs';

async function fetchText(url, timeout = 20000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

function now() {
  return new Date().toISOString();
}

export async function syncClaudeSettings() {
  const ver = await installedVersion('claude');
  const bin = await findClaudeBinary();
  if (!bin) throw new Error('没有找到 Claude Code 程序文件');
  const { items, topKeys } = extractClaudeSettingsFromBinary(bin);
  if (topKeys.length < 50) throw new Error(`只提取到 ${topKeys.length} 个参数，结果不可信，已放弃`);
  writeCache('claude-settings', { meta: { version: ver || '0', source: 'binary', path: bin, generatedAt: now() }, items });
  return { version: ver, count: topKeys.length };
}

export async function syncClaudeEnv() {
  const ver = await installedVersion('claude');
  const md = await fetchText('https://code.claude.com/docs/en/env-vars.md');
  const items = parseClaudeEnvDoc(md);
  if (items.length < 50) throw new Error('文档解析结果过少，已放弃');
  writeCache('claude-env', { meta: { version: ver || '0', source: 'https://code.claude.com/docs/en/env-vars.md', generatedAt: now() }, items });
  return { version: ver, count: items.length };
}

export async function syncCodexConfig() {
  const ver = await installedVersion('codex');
  if (!ver) throw new Error('没有检测到 Codex CLI');
  const urls = [
    `https://raw.githubusercontent.com/openai/codex/rust-v${ver}/codex-rs/core/config.schema.json`,
    `https://cdn.jsdelivr.net/gh/openai/codex@rust-v${ver}/codex-rs/core/config.schema.json`,
  ];
  let schema = null;
  let lastErr;
  for (const u of urls) {
    try {
      schema = JSON.parse(await fetchText(u));
      break;
    } catch (e) {
      lastErr = e;
    }
  }
  if (!schema) throw new Error('下载 Codex 官方 schema 失败：' + (lastErr?.message || ''));
  const items = flattenCodexSchema(schema).filter((i) => !i.key.startsWith('features.'));
  writeCache('codex-config', { meta: { version: ver, source: urls[0], generatedAt: now() }, items });
  return { version: ver, count: items.length };
}

export async function syncCodexFeatures() {
  const ver = await installedVersion('codex');
  const rows = await codexFeaturesList();
  if (!rows) throw new Error('执行 codex features list 失败');
  const bundled = loadBase('codex-features');
  const known = new Map((bundled.items || []).map((i) => [i.key, i]));
  const items = rows.map((r) => {
    const key = `features.${r.key}`;
    const old = known.get(key) || {};
    return { ...old, key, type: 'boolean', stage: r.stage, default: r.enabled };
  });
  // 保留旧别名等未在列表中的条目
  for (const [k, v] of known) if (!items.some((i) => i.key === k)) items.push(v);
  writeCache('codex-features', { meta: { version: ver || '0', source: 'codex features list', generatedAt: now() }, items });
  return { version: ver, count: rows.length };
}

/** 依次执行全部同步步骤，单步失败不影响其他步骤 */
export async function syncAll() {
  const steps = [
    ['claude-settings', '从本机 Claude Code 程序提取 settings 参数', syncClaudeSettings],
    ['claude-env', '从官方文档同步 Claude Code 环境变量', syncClaudeEnv],
    ['codex-config', '下载与本机 Codex 版本对应的官方 schema', syncCodexConfig],
    ['codex-features', '读取本机 Codex 的功能开关列表', syncCodexFeatures],
  ];
  const results = [];
  for (const [id, label, fn] of steps) {
    try {
      const r = await fn();
      results.push({ id, label, ok: true, ...r });
    } catch (e) {
      results.push({ id, label, ok: false, error: e.message });
    }
  }
  const untranslated = {};
  for (const c of ['claude-settings', 'claude-env', 'codex-config', 'codex-env']) {
    untranslated[c] = getCatalog(c).stats.untranslated;
  }
  return { results, untranslated };
}
