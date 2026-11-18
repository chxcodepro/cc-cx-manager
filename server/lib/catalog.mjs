// 参数目录：基础定义（来自官方 schema / 文档 / 程序）+ 中文叠加层 → 合并结果
// 基础定义优先使用「同步最新参数」生成的缓存（版本更新时），否则使用随程序附带的版本
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appDataDir } from './paths.mjs';
import { parseBrief, parseOverlay } from './overlay.mjs';
import { compareVersions } from './versions.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CATALOG_DIR = path.join(ROOT, 'catalog');
const BASE_DIR = path.join(CATALOG_DIR, 'base');
const ZH_DIR = path.join(CATALOG_DIR, 'zh');

export function cacheDir() {
  return path.join(appDataDir(), 'cache');
}

export const CATALOGS = {
  'claude-settings': { product: 'claude', title: 'Claude Code settings.json', bases: ['claude-settings'], overlays: ['claude-settings'] },
  'claude-env': { product: 'claude', title: 'Claude Code 环境变量', bases: ['claude-env'], overlays: ['claude-env'] },
  'claude-mcp': { product: 'claude', title: 'Claude Code MCP 服务器', bases: ['claude-mcp'], overlays: ['claude-mcp'] },
  'codex-config': { product: 'codex', title: 'Codex config.toml', bases: ['codex-config', 'codex-features'], overlays: ['codex-config', 'codex-tui', 'codex-features'] },
  'codex-env': { product: 'codex', title: 'Codex .env', bases: ['codex-env'], overlays: ['codex-env'] },
};

function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

/** 选出较新的基础定义：缓存（同步生成）与附带版本比较 version */
export function loadBase(name) {
  const bundled = readJson(path.join(BASE_DIR, `${name}.base.json`));
  const cached = readJson(path.join(cacheDir(), `${name}.base.json`));
  if (cached && (!bundled || compareVersions(cached.meta?.version || '0', bundled.meta?.version || '0') > 0)) {
    return { ...cached, from: 'cache', bundledVersion: bundled?.meta?.version };
  }
  return bundled ? { ...bundled, from: 'bundled' } : { meta: {}, items: [], from: 'none' };
}

/** 叠加层可以拆成多个文件：name.zh.txt、name.1.zh.txt、name.2.zh.txt …（按文件名顺序合并） */
function overlayFiles(name) {
  let files = [];
  try {
    const re = new RegExp(`^${name.replace(/[-]/g, '\\-')}(\\.\\d+)?\\.zh\\.txt$`);
    files = fs.readdirSync(ZH_DIR).filter((f) => re.test(f));
  } catch {}
  const num = (f) => Number((/\.(\d+)\.zh\.txt$/.exec(f) || [0, 0])[1]);
  return files.sort((a, b) => num(a) - num(b)).map((f) => path.join(ZH_DIR, f));
}

/** 一句话说明：name.brief.zh.txt、name.brief.1.zh.txt …（按文件名顺序合并） */
function briefFiles(name) {
  let files = [];
  try {
    const re = new RegExp(`^${name.replace(/[-]/g, '\\-')}\\.brief(\\.\\d+)?\\.zh\\.txt$`);
    files = fs.readdirSync(ZH_DIR).filter((f) => re.test(f));
  } catch {}
  const num = (f) => Number((/\.brief\.(\d+)\.zh\.txt$/.exec(f) || [0, 0])[1]);
  return files.sort((a, b) => num(a) - num(b)).map((f) => path.join(ZH_DIR, f));
}

function loadOverlay(name) {
  const merged = { categories: [], prefixes: [], settypes: [], items: [], errors: [] };
  for (const p of overlayFiles(name)) {
    const r = parseOverlay(fs.readFileSync(p, 'utf8'), path.basename(p));
    merged.categories.push(...r.categories);
    merged.prefixes.push(...r.prefixes);
    merged.settypes.push(...(r.settypes || []));
    merged.items.push(...r.items);
    merged.errors.push(...r.errors);
  }
  return merged;
}

function stampOf(names) {
  const parts = [];
  for (const n of names.bases) {
    for (const p of [path.join(BASE_DIR, `${n}.base.json`), path.join(cacheDir(), `${n}.base.json`)]) {
      try { parts.push(fs.statSync(p).mtimeMs); } catch { parts.push(0); }
    }
  }
  for (const n of names.overlays) {
    for (const p of [...overlayFiles(n), ...briefFiles(n)]) {
      try { parts.push(p + fs.statSync(p).mtimeMs); } catch { parts.push(0); }
    }
  }
  return parts.join(',');
}

const memo = new Map();

export function getCatalog(name) {
  const def = CATALOGS[name];
  if (!def) throw new Error('未知的参数目录：' + name);
  const stamp = stampOf(def);
  const hit = memo.get(name);
  if (hit && hit.stamp === stamp) return hit.value;
  const value = buildCatalog(name, def);
  memo.set(name, { stamp, value });
  return value;
}

export function invalidateCatalogs() {
  memo.clear();
}

function buildCatalog(name, def) {
  const items = new Map();
  const metas = [];
  let ord = 0;
  for (const b of def.bases) {
    const base = loadBase(b);
    metas.push({ name: b, ...base.meta, from: base.from, bundledVersion: base.bundledVersion });
    for (const it of base.items || []) {
      const cur = items.get(it.key) || {};
      items.set(it.key, { ...cur, ...it, inBase: true, ord: cur.ord ?? 100000 + ord++ });
    }
  }
  const categories = new Map();
  const prefixes = [];
  const settypes = [];
  const overlayErrors = [];
  let ovOrd = 0;
  for (const o of def.overlays) {
    const ov = loadOverlay(o);
    overlayErrors.push(...ov.errors);
    for (const c of ov.categories) if (!categories.has(c.id)) categories.set(c.id, c);
    prefixes.push(...ov.prefixes);
    settypes.push(...ov.settypes);
    for (const it of ov.items) {
      const cur = items.get(it.key);
      const merged = { ...(cur || { type: 'string' }), ...stripUndefined(it), inOverlay: true, ord: ovOrd++ };
      if (!cur) merged.inBase = false;
      items.set(it.key, merged);
    }
  }
  // 一句话说明（找不到对应参数的记入 briefOrphans，供检查脚本报告）
  const briefOrphans = [];
  for (const o of def.overlays) {
    for (const p of briefFiles(o)) {
      const r = parseBrief(fs.readFileSync(p, 'utf8'), path.basename(p));
      overlayErrors.push(...r.errors);
      for (const b of r.items) {
        const cur = items.get(b.key);
        if (cur) cur.brief = b.brief;
        else briefOrphans.push(b.key);
      }
    }
  }
  prefixes.sort((a, b) => b.prefix.length - a.prefix.length);
  if (!categories.has('other')) categories.set('other', { id: 'other', name: '其他', order: 9999 });

  const out = [];
  for (const it of items.values()) {
    const item = { ...it };
    if (item.type !== 'group') {
      const st = settypes.find((s) => item.key.startsWith(s.prefix));
      if (st && !it.typeFromOverlay) item.type = st.type;
    }
    if (!item.category || !categories.has(item.category)) {
      const p = prefixes.find((x) => item.key === x.prefix || item.key.startsWith(x.prefix));
      item.category = p && categories.has(p.category) ? p.category : 'other';
    }
    if (!item.title) {
      item.untranslated = true;
      item.title = item.key.split('.').pop();
      if (!item.description) item.description = item.en || '';
    }
    // 枚举：合并中文标签与取值说明
    if (item.enumLabels || item.enumDescs) {
      const list = Array.isArray(item.enum) ? item.enum.map((e) => ({ ...e })) : [];
      for (const [v, label] of Object.entries(item.enumLabels || {})) {
        let e = list.find((x) => String(x.value) === v);
        if (!e) { e = { value: coerceEnumValue(v, list) }; list.push(e); }
        if (label) e.label = label;
      }
      for (const [v, d] of Object.entries(item.enumDescs || {})) {
        const e = list.find((x) => String(x.value) === v);
        if (e) e.description = d;
      }
      item.enum = list;
      delete item.enumLabels;
      delete item.enumDescs;
      if (item.type === 'string' && list.length) item.type = 'enum';
    }
    if (name.endsWith('-env') && item.type === 'boolean' && !item.envTrue) item.envTrue = '1';
    out.push(item);
  }
  const catOrder = Object.fromEntries([...categories.values()].map((c) => [c.id, c.order]));
  out.sort((a, b) => (catOrder[a.category] ?? 9999) - (catOrder[b.category] ?? 9999) || a.ord - b.ord);
  return {
    name,
    product: def.product,
    title: def.title,
    meta: metas,
    categories: [...categories.values()].sort((a, b) => a.order - b.order),
    items: out,
    overlayErrors,
    briefOrphans,
    stats: {
      total: out.filter((i) => i.type !== 'group').length,
      untranslated: out.filter((i) => i.untranslated && i.type !== 'group').length,
    },
  };
}

function coerceEnumValue(v, list) {
  if (list.some((x) => typeof x.value === 'number') && /^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if (v === 'true') return true;
  if (v === 'false') return false;
  return v;
}

function stripUndefined(o) {
  const r = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) r[k] = v;
  return r;
}

export function writeCache(name, data) {
  fs.mkdirSync(cacheDir(), { recursive: true });
  fs.writeFileSync(path.join(cacheDir(), `${name}.base.json`), JSON.stringify(data, null, 1), 'utf8');
  invalidateCatalogs();
}

export function clearCache() {
  for (const n of ['claude-settings', 'claude-env', 'codex-config', 'codex-features', 'codex-env']) {
    try { fs.unlinkSync(path.join(cacheDir(), `${n}.base.json`)); } catch {}
  }
  invalidateCatalogs();
}
