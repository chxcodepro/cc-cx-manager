#!/usr/bin/env node
// 生成随程序附带的基础定义（catalog/base/*.base.json）
// 数据来源：
//   claude-settings ← 本机安装的 Claude Code 程序内置 schema
//   claude-env      ← 官方文档 env-vars.md
//   codex-config    ← openai/codex 仓库对应版本的 config.schema.json
//   codex-features  ← openai/codex 源码 features/src/lib.rs + codex features list
//   codex-env       ← 官方文档 environment-variables.md
// 用法：node scripts/gen-base.mjs [--only claude-settings,codex-config]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractClaudeSettingsFromBinary } from '../server/lib/claude-schema.mjs';
import { flattenCodexSchema } from '../server/lib/codex-schema.mjs';
import { parseClaudeEnvDoc } from '../server/lib/env-docs.mjs';
import { parseFeaturesRust } from '../server/lib/codex-features.mjs';
import { findClaudeBinary, installedVersion, codexFeaturesList } from '../server/lib/versions.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'catalog', 'base');
fs.mkdirSync(OUT, { recursive: true });

const onlyArg = process.argv.indexOf('--only');
const only = onlyArg > 0 ? process.argv[onlyArg + 1].split(',') : null;
const want = (n) => !only || only.includes(n);

async function get(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.text();
}

function write(name, meta, items) {
  fs.writeFileSync(path.join(OUT, `${name}.base.json`), JSON.stringify({ meta: { ...meta, generatedAt: new Date().toISOString().slice(0, 10) }, items }, null, 1) + '\n');
  console.log(`✓ ${name}: ${items.length} 条（${meta.version}）`);
}

const claudeVer = await installedVersion('claude');
const codexVer = await installedVersion('codex');
console.log(`Claude Code ${claudeVer}，Codex ${codexVer}`);

if (want('claude-settings')) {
  const bin = await findClaudeBinary();
  if (!bin) throw new Error('未找到 Claude Code 程序');
  const { items } = extractClaudeSettingsFromBinary(bin);
  write('claude-settings', { version: claudeVer, source: 'Claude Code 程序内置 settings schema' }, items);
}

if (want('claude-env')) {
  const md = await get('https://code.claude.com/docs/en/env-vars.md');
  write('claude-env', { version: claudeVer, source: 'https://code.claude.com/docs/en/env-vars.md' }, parseClaudeEnvDoc(md));
}

if (want('codex-config')) {
  const schema = JSON.parse(await get(`https://raw.githubusercontent.com/openai/codex/rust-v${codexVer}/codex-rs/core/config.schema.json`));
  fs.mkdirSync(path.join(ROOT, 'schemas'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'schemas', 'codex-config.schema.json'), JSON.stringify(schema, null, 2) + '\n');
  const items = flattenCodexSchema(schema).filter((i) => i.key !== 'features');
  write('codex-config', { version: codexVer, source: `openai/codex@rust-v${codexVer} codex-rs/core/config.schema.json` }, items);
}

if (want('codex-features')) {
  const lib = await get(`https://raw.githubusercontent.com/openai/codex/rust-v${codexVer}/codex-rs/features/src/lib.rs`);
  const legacy = await get(`https://raw.githubusercontent.com/openai/codex/rust-v${codexVer}/codex-rs/features/src/legacy.rs`);
  const parsed = parseFeaturesRust(lib, legacy);
  const live = (await codexFeaturesList()) || [];
  const liveMap = new Map(live.map((r) => [r.key, r]));
  const items = [];
  const seen = new Set();
  for (const f of parsed) {
    if (seen.has(f.key)) continue;
    seen.add(f.key);
    const l = liveMap.get(f.key);
    const item = { key: `features.${f.key}`, type: 'boolean', stage: l?.stage || f.stage, default: l ? l.enabled : f.default, en: f.en };
    if (f.name) item.featureName = f.name;
    if (f.aliasOf) { item.aliasOf = f.aliasOf; item.deprecated = true; }
    items.push(item);
  }
  for (const l of live) {
    if (!seen.has(l.key)) items.push({ key: `features.${l.key}`, type: 'boolean', stage: l.stage, default: l.enabled });
  }
  write('codex-features', { version: codexVer, source: `openai/codex@rust-v${codexVer} features/src/lib.rs + codex features list` }, items);
}

if (want('codex-env')) {
  const md = await get('https://learn.chatgpt.com/docs/config-file/environment-variables.md');
  const items = [];
  for (const line of md.split(/\r?\n/)) {
    const m = /^\|\s*`([A-Z][A-Z0-9_]+)`\s*\|(.*)\|\s*$/.exec(line);
    if (!m) continue;
    const cols = m[2].split('|').map((s) => s.trim());
    const en = cols[cols.length - 1].replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
    if (!items.some((i) => i.key === m[1])) items.push({ key: m[1], type: 'string', en });
  }
  write('codex-env', { version: codexVer, source: 'https://learn.chatgpt.com/docs/config-file/environment-variables.md' }, items);
}
