// 三种配置格式的解析与「尽量保留原格式」的序列化
//   json   ：settings.json，保持键顺序与缩进
//   toml   ：config.toml，用 toml-patch 保留注释、空行、排版
//   dotenv ：.env，逐行修改，保留注释与顺序
import * as TomlPatch from '@decimalturn/toml-patch';

// ---------- 公共 ----------

export function detectEol(text) {
  return text && text.includes('\r\n') ? '\r\n' : '\n';
}

export function normalizeEol(text, eol) {
  const lf = text.replace(/\r\n/g, '\n');
  return eol === '\r\n' ? lf.replace(/\n/g, '\r\n') : lf;
}

export function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

// ---------- JSON ----------

function detectIndent(text) {
  const m = /\n([ \t]+)"/.exec(text || '');
  if (!m) return 2;
  return m[1].startsWith('\t') ? '\t' : m[1].length;
}

export const json = {
  parse(text) {
    const t = stripBom(text).trim();
    if (!t) return {};
    const data = JSON.parse(t);
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('settings 文件顶层必须是 JSON 对象');
    return data;
  },
  serialize(data, original) {
    const indent = original ? detectIndent(original) : 2;
    let out = JSON.stringify(data, null, indent) + '\n';
    if (original) {
      if (original.charCodeAt(0) === 0xfeff) out = '\uFEFF' + out;
      out = normalizeEol(out, detectEol(original));
    }
    return out;
  },
};

// ---------- TOML ----------

export const toml = {
  parse(text) {
    const t = stripBom(text);
    if (!t.trim()) return {};
    return TomlPatch.parse(t);
  },
  serialize(data, original) {
    const base = original ? stripBom(original) : '';
    let out;
    if (base.trim()) {
      out = TomlPatch.patch(base, data);
    } else {
      out = TomlPatch.stringify(data);
    }
    if (!out.endsWith('\n')) out += '\n';
    if (original) {
      out = normalizeEol(out, detectEol(original));
      if (original.charCodeAt(0) === 0xfeff) out = '\uFEFF' + out;
    }
    return out;
  },
};

// ---------- dotenv ----------

const ENV_LINE = /^\s*(export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)$/;

function unquote(raw) {
  let v = raw.trim();
  if (v.startsWith('"')) {
    const end = findClosingQuote(v, '"');
    const inner = v.slice(1, end < 0 ? undefined : end);
    return inner.replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  if (v.startsWith("'")) {
    const end = v.indexOf("'", 1);
    return v.slice(1, end < 0 ? undefined : end);
  }
  // 未加引号：去掉行内注释（# 前需要有空白）
  const hash = v.search(/\s#/);
  if (hash >= 0) v = v.slice(0, hash);
  return v.trim();
}

function findClosingQuote(s, q) {
  for (let i = 1; i < s.length; i++) {
    if (s[i] === '\\') { i++; continue; }
    if (s[i] === q) return i;
  }
  return -1;
}

export function quoteEnvValue(v) {
  const s = String(v ?? '');
  if (s === '') return '""';
  if (/^[A-Za-z0-9_./:@%+,~=-]+$/.test(s)) return s;
  return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r') + '"';
}

export const dotenv = {
  parse(text) {
    const data = {};
    for (const line of stripBom(text).split(/\r?\n/)) {
      if (/^\s*#/.test(line) || !line.trim()) continue;
      const m = ENV_LINE.exec(line);
      if (!m) continue;
      data[m[2]] = unquote(m[3]);
    }
    return data;
  },
  serialize(data, original) {
    const eol = original ? detectEol(original) : '\n';
    const lines = original ? stripBom(original).split(/\r?\n/) : [];
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    const seen = new Set();
    const out = [];
    for (const line of lines) {
      const m = !/^\s*#/.test(line) && ENV_LINE.exec(line);
      if (!m) { out.push(line); continue; }
      const key = m[2];
      if (seen.has(key)) continue; // 重复定义只保留第一处
      seen.add(key);
      if (!(key in data)) continue; // 已删除
      const oldVal = unquote(m[3]);
      if (oldVal === String(data[key])) out.push(line); // 未变：原样保留（含引号风格、行内注释）
      else out.push(`${m[1] || ''}${key}=${quoteEnvValue(data[key])}`);
    }
    for (const [k, v] of Object.entries(data)) {
      if (!seen.has(k)) out.push(`${k}=${quoteEnvValue(v)}`);
    }
    let text = out.join(eol);
    if (text) text += eol;
    if (original && original.charCodeAt(0) === 0xfeff) text = '\uFEFF' + text;
    return text;
  },
};

export const FORMATS = { json, toml, dotenv };

// ---------- 传输：把 TOML 日期等特殊对象转成字符串，便于 JSON 传给前端 ----------

export function toTransit(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'bigint') return Number(value);
  if (Array.isArray(value)) return value.map(toTransit);
  if (typeof value === 'object') {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      if (typeof value.toISOString === 'function') return value.toISOString();
      return String(value);
    }
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = toTransit(v);
    return out;
  }
  return value;
}

// ---------- 路径操作（ops） ----------

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
}

export function getPath(obj, path) {
  let cur = obj;
  for (const seg of path) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = cur[seg];
  }
  return cur;
}

export function setPath(obj, path, value) {
  let cur = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const seg = path[i];
    if (!isPlainObject(cur[seg])) cur[seg] = {};
    cur = cur[seg];
  }
  cur[path[path.length - 1]] = value;
}

export function unsetPath(obj, path) {
  const stack = [];
  let cur = obj;
  for (let i = 0; i < path.length - 1; i++) {
    if (!isPlainObject(cur[path[i]])) return;
    stack.push([cur, path[i]]);
    cur = cur[path[i]];
  }
  delete cur[path[path.length - 1]];
  // 沿路径清理因删除而变空的父对象
  for (let i = stack.length - 1; i >= 0; i--) {
    const [parent, key] = stack[i];
    if (isPlainObject(parent[key]) && Object.keys(parent[key]).length === 0) delete parent[key];
    else break;
  }
}

/** ops: [{ op: 'set', path: [...], value } | { op: 'unset', path: [...] } | { op: 'rename', path, to }] */
export function applyOps(data, ops) {
  for (const o of ops || []) {
    if (!Array.isArray(o.path) || !o.path.length) throw new Error('无效的修改路径');
    for (const seg of o.path) if (typeof seg !== 'string' || seg === '__proto__' || seg === 'constructor' || seg === 'prototype') throw new Error('非法的键名：' + seg);
    if (o.op === 'set') setPath(data, o.path, o.value);
    else if (o.op === 'unset') unsetPath(data, o.path);
    else if (o.op === 'rename') {
      const v = getPath(data, o.path);
      if (v === undefined) continue;
      const parentPath = o.path.slice(0, -1);
      const parent = parentPath.length ? getPath(data, parentPath) : data;
      if (!isPlainObject(parent)) continue;
      if (typeof o.to !== 'string' || !o.to || o.to === '__proto__') throw new Error('非法的新名称');
      // 保持原有顺序：重建父对象
      const entries = Object.entries(parent).map(([k, val]) => (k === o.path[o.path.length - 1] ? [o.to, val] : [k, val]));
      for (const k of Object.keys(parent)) delete parent[k];
      for (const [k, val] of entries) parent[k] = val;
    } else throw new Error('未知操作：' + o.op);
  }
  return data;
}
