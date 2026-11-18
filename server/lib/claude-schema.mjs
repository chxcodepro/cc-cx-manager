// 从本机安装的 Claude Code 程序中提取 settings.json 的官方 schema（zod 定义）
// 原理：Claude Code 的 settings schema 以 `return{$schema:()=>...}` 形式内嵌在程序里，
// 每个键都是一个惰性函数，带 .describe("官方英文说明")。这里用「符号执行」的方式求值：
// 把压缩后的 zod 构造函数替换成记录结构的替身，从而得到类型、枚举、默认值与说明。
// 用途：1) 生成基础目录；2) 运行时检测「新版本新增、目录尚未收录」的参数。

import fs from 'node:fs';

const BS = String.fromCharCode(92);

// ---------- 文本提取 ----------

function skipString(s, q, j) {
  j++;
  while (j < s.length) {
    const ch = s[j];
    if (ch === BS) { j += 2; continue; }
    if (q === '`' && ch === '$' && s[j + 1] === '{') {
      let d = 1; j += 2;
      while (j < s.length && d > 0) {
        const c2 = s[j];
        if (c2 === '"' || c2 === "'" || c2 === '`') { j = skipString(s, c2, j) + 1; continue; }
        if (c2 === '{') d++; else if (c2 === '}') d--;
        j++;
      }
      continue;
    }
    if (ch === q) return j;
    j++;
  }
  return j;
}

// 从 start 处（指向 { ( [）做括号匹配，返回结束位置（不含）
export function matchBrackets(s, start) {
  let depth = 0;
  for (let j = start; j < s.length; j++) {
    const ch = s[j];
    if (ch === '"' || ch === "'" || ch === '`') { j = skipString(s, ch, j); continue; }
    if (ch === '{' || ch === '(' || ch === '[') depth++;
    else if (ch === '}' || ch === ')' || ch === ']') { depth--; if (depth === 0) return j + 1; }
  }
  return -1;
}

const MARKER = 'return{$schema:()=>';
const EXTRA_MARKER = 'shape:()=>({';

/** 在程序文件中定位 settings schema 文本。返回 { main, extras[], win, rel } */
export function extractSchemaTextFromBinary(binPath) {
  const buf = fs.readFileSync(binPath);
  const markerBuf = Buffer.from(MARKER, 'latin1');
  const pos = buf.indexOf(markerBuf);
  if (pos < 0) throw new Error('未在程序中找到 settings schema 标记');
  // 取标记前后一段窗口转为 utf8 文本处理（schema 本身约 80KB，辅助定义大多在其前 1MB 内）
  const winStart = Math.max(0, pos - 1200000);
  const win = buf.subarray(winStart, Math.min(buf.length, pos + 400000)).toString('utf8');
  const rel = win.indexOf(MARKER);
  const objStart = rel + 'return'.length;
  const objEnd = matchBrackets(win, objStart);
  if (objEnd < 0) throw new Error('settings schema 括号不匹配');
  const main = win.slice(objStart, objEnd);

  // 额外注册表（autoMode / voice 等通过 shape:()=>({...}) 拼入）
  const extras = [];
  const regStart = win.lastIndexOf('={autoMode:{', rel);
  if (regStart > 0) {
    const regEnd = matchBrackets(win, regStart + 1);
    const reg = win.slice(regStart + 1, regEnd);
    let i = -1;
    while ((i = reg.indexOf(EXTRA_MARKER, i + 1)) !== -1) {
      const o = i + EXTRA_MARKER.length - 1; // 指向 {
      const e = matchBrackets(reg, o);
      if (e > 0) extras.push(reg.slice(o, e));
    }
  }
  return { main, extras, win, rel };
}

// ---------- 辅助定义查找（把 nd(e) / fpr() 这类辅助函数解析成真实 schema） ----------

const IDENT_CHARS = /[\w$]/;

function findDefinition(win, rel, name) {
  const cands = [];
  const fnNeedle = `function ${name}(`;
  let i = -1;
  while ((i = win.indexOf(fnNeedle, i + 1)) !== -1) {
    if (i > 0 && IDENT_CHARS.test(win[i - 1])) continue;
    cands.push({ pos: i, kind: 'fn' });
  }
  const asNeedle = `${name}=`;
  i = -1;
  while ((i = win.indexOf(asNeedle, i + 1)) !== -1) {
    const prev = win[i - 1];
    const next = win[i + asNeedle.length];
    if (!(prev === ',' || prev === ';' || prev === ' ' || prev === '{' || prev === '\n')) continue;
    if (next === '=' || next === '>') continue;
    // 排除对象字面量里的 key=（不存在）以及解构默认值：要求前面是 var/let/const 声明链或语句起始
    cands.push({ pos: i, kind: 'assign' });
  }
  if (!cands.length) return null;
  // 优先选择 schema 之前最近的定义
  cands.sort((a, b) => {
    const da = a.pos <= rel ? rel - a.pos : (a.pos - rel) * 3;
    const db = b.pos <= rel ? rel - b.pos : (b.pos - rel) * 3;
    return da - db;
  });
  for (const c of cands.slice(0, 4)) {
    if (c.kind === 'fn') {
      const p0 = c.pos + fnNeedle.length - 1;
      const p1 = matchBrackets(win, p0);
      if (p1 < 0 || win[p1] !== '{') continue;
      const p2 = matchBrackets(win, p1);
      if (p2 < 0) continue;
      return { kind: 'fn', text: win.slice(c.pos, p2) };
    }
    // 赋值：读取到深度 0 的 , 或 ;
    const start = c.pos + asNeedle.length;
    let depth = 0, j = start;
    for (; j < win.length && j - start < 200000; j++) {
      const ch = win[j];
      if (ch === '"' || ch === "'" || ch === '`') { j = skipString(win, ch, j); continue; }
      if (ch === '{' || ch === '(' || ch === '[') depth++;
      else if (ch === '}' || ch === ')' || ch === ']') { if (depth === 0) break; depth--; }
      else if ((ch === ',' || ch === ';') && depth === 0) break;
    }
    const expr = win.slice(start, j);
    if (!expr) continue;
    return { kind: 'assign', text: expr };
  }
  return null;
}

// ---------- 符号执行 ----------

const KIND = Symbol('kind');

function makeNode(kind, data = {}) {
  const node = { [KIND]: kind, kind, ...data };
  const target = function () {};
  const handler = {
    get(t, prop) {
      if (prop === KIND) return node[KIND];
      if (prop === '__node') return node;
      if (prop === Symbol.toPrimitive) return () => '?';
      if (prop === Symbol.iterator) return function* () {};
      if (prop === 'then') return undefined;
      switch (prop) {
        case 'optional': case 'nullish': return () => { node.optional = true; return proxy; };
        case 'describe': return (d) => { node.desc = d; return proxy; };
        case 'default': return (v) => { node.def = typeof v === 'function' ? undefined : v; node.optional = true; return proxy; };
        case 'int': return () => { node.int = true; return proxy; };
        case 'min': case 'gte': return (n) => { if (typeof n === 'number') node.min = n; return proxy; };
        case 'max': case 'lte': return (n) => { if (typeof n === 'number') node.max = n; return proxy; };
        case 'gt': return (n) => { if (typeof n === 'number') node.min = n + (node.int ? 1 : 0); return proxy; };
        case 'lt': return (n) => { if (typeof n === 'number') node.max = n - (node.int ? 1 : 0); return proxy; };
        case 'positive': return () => { node.min = node.int ? 1 : 0; return proxy; };
        case 'nonnegative': return () => { node.min = 0; return proxy; };
        case 'extend': return (shape) => makeNode('object', { shape: { ...(node.shape || {}), ...shape }, desc: node.desc });
        case 'merge': return (o) => makeNode('object', { shape: { ...(node.shape || {}), ...((o && o.__node && o.__node.shape) || {}) } });
        case 'or': return (o) => makeNode('union', { options: [proxy, o] });
        case 'array': return () => makeNode('array', { element: proxy });
        case 'shape': return node.shape;
        default:
          // 其余 zod 方法（passthrough/check/refine/transform/catch/...）都原样返回，保持可链式调用
          return (..._a) => proxy;
      }
    },
    apply(t, thisArg, args) { return makeNode('unknown', { args }); },
    // zod v4 内部构造：new ZodXxx({ type: "record", keyType, valueType }) 等
    construct(t, args) { return fromZodDef(args[0]) || makeNode('unknown', { args }); },
    has() { return false; },
    ownKeys() { return ['prototype']; },
    getOwnPropertyDescriptor(t, p) { return Reflect.getOwnPropertyDescriptor(t, p); },
  };
  const proxy = new Proxy(target, handler);
  return proxy;
}

function fromZodDef(def) {
  if (!def || typeof def !== 'object' || typeof def.type !== 'string') return null;
  switch (def.type) {
    case 'record': return makeNode('record', { value: def.valueType, keyNode: def.keyType });
    case 'enum': return makeNode('enum', { values: def.entries ? Object.values(def.entries) : [] });
    case 'object': return makeNode('object', { shape: def.shape || {} });
    case 'array': return makeNode('array', { element: def.element });
    case 'string': case 'boolean': return makeNode(def.type);
    case 'number': return makeNode('number');
    case 'union': return makeNode('union', { options: def.options || [] });
    default: return null;
  }
}

// 允许直接使用的安全全局对象；其余一律替换为替身，避免执行到真实的 process / require 等
const SAFE_GLOBALS = new Set([
  'Object', 'Array', 'JSON', 'Math', 'Number', 'String', 'Boolean', 'RegExp', 'Symbol', 'Set', 'Map',
  'WeakMap', 'WeakSet', 'Error', 'TypeError', 'RangeError', 'parseInt', 'parseFloat', 'isNaN', 'isFinite',
  'Infinity', 'NaN', 'undefined', 'encodeURIComponent', 'decodeURIComponent', 'Date', 'BigInt',
]);

// 压缩标识符 → zod 构造器（2.1.x 版本中的命名；新版本若变化会退化为 unknown，不影响其他键）
function buildScope(ctx) {
  const resolved = new Map();
  const known = {
    r: () => makeNode('string'),
    v: () => makeNode('number'),
    I: () => makeNode('boolean'),
    c: (shape) => makeNode('object', { shape: shape || {} }),
    R: (el) => makeNode('array', { element: el }),
    B: (vals) => makeNode('enum', { values: Array.isArray(vals) ? vals : [] }),
    T: (v) => makeNode('literal', { value: v }),
    Ve: (opts) => makeNode('union', { options: Array.isArray(opts) ? opts : [] }),
    he: (k, v) => makeNode('record', { value: v === undefined ? k : v }),
    Dl: (_fn, schema) => schema,
    m: (fn) => fn,
    dt: (x) => x,
    a: (l) => l,
    o: () => makeNode('record', { value: makeNode('unknown') }),
    De: (fn) => (typeof fn === 'function' ? safeCall(fn) : fn),
    // 原函数参数 e 是「已启用的设置扩展列表」，给空数组即可（扩展键单独解析）
    e: [],
    n: false,
  };
  let depth = 0;
  const scope = new Proxy(known, {
    has(t, k) {
      if (typeof k !== 'string') return false;
      if (k in t) return true;
      if (SAFE_GLOBALS.has(k)) return false;
      return /^[A-Za-z_$][\w$]*$/.test(k);
    },
    get(t, k) {
      if (k === Symbol.unscopables) return undefined;
      if (k in t) return t[k];
      if (typeof k !== 'string') return undefined;
      if (resolved.has(k)) return resolved.get(k);
      // 尝试在程序文本中找到该标识符的定义并求值
      if (ctx && ctx.win && depth < 12 && /^[A-Za-z_$][\w$]{0,5}$/.test(k)) {
        resolved.set(k, makeNode('unknown', { ref: k })); // 防循环
        const def = findDefinition(ctx.win, ctx.rel, k);
        if (def) {
          depth++;
          try {
            const code = def.kind === 'fn' ? `(${def.text})` : `(${def.text})`;
            // eslint-disable-next-line no-new-func
            const val = new Function('scope', `with (scope) { return ${code}; }`)(scope);
            resolved.set(k, val);
            return val;
          } catch {
            // 求值失败保留替身
          } finally {
            depth--;
          }
        }
        return resolved.get(k);
      }
      // 未知标识符：既可当函数调用，也可当对象访问属性
      return makeNode('unknown', { ref: k });
    },
  });
  return scope;
}

function evaluateObjectText(objText, ctx) {
  // 去掉末尾展开的注册表拼接（单独处理）
  const cleaned = objText.replace(/,\.\.\.[A-Za-z_$][\w$]*\([A-Za-z_$][\w$]*\(e\),\(l\)=>\(\)=>l\)\}$/, '}');
  const scope = buildScope(ctx);
  // eslint-disable-next-line no-new-func
  const fn = new Function('scope', `with (scope) { return (${cleaned}); }`);
  return fn(scope);
}

// ---------- 结构 → 条目 ----------

function nodeOf(x) {
  if (x && x.__node) return x.__node;
  return null;
}

function toItem(key, schemaLike, items, depth = 0) {
  let node = nodeOf(schemaLike);
  if (!node) return;
  const base = { key, en: node.desc };
  if (node.def !== undefined && typeof node.def !== 'object') base.default = node.def;
  else if (node.def !== undefined && node.def !== null && JSON.stringify(node.def).length < 200) base.default = node.def;

  switch (node.kind) {
    case 'string': items.push({ ...base, type: 'string' }); return;
    case 'boolean': items.push({ ...base, type: 'boolean' }); return;
    case 'number':
      items.push({ ...base, type: node.int ? 'integer' : 'number', min: node.min, max: node.max });
      return;
    case 'enum':
      items.push({ ...base, type: 'enum', enum: node.values.map((v) => ({ value: v })) });
      return;
    case 'literal':
      items.push({ ...base, type: 'enum', enum: [{ value: node.value }] });
      return;
    case 'union': {
      const opts = node.options.map(nodeOf).filter(Boolean);
      const lits = [];
      let allLit = opts.length > 0;
      for (const o of opts) {
        if (o.kind === 'literal') lits.push(o.value);
        else if (o.kind === 'enum') lits.push(...o.values);
        else allLit = false;
      }
      if (allLit) { items.push({ ...base, type: 'enum', enum: lits.map((v) => ({ value: v })) }); return; }
      // 「布尔 或 对象」这类联合：展开对象字段，父级标注联合类型
      const objs = opts.filter((o) => o.kind === 'object');
      const prims = opts.filter((o) => ['boolean', 'string', 'number', 'literal', 'enum'].includes(o.kind));
      if (objs.length === 1 && objs.length + prims.length === opts.length && depth < 4) {
        items.push({ ...base, type: 'group', union: opts.map((o) => o.kind).join('|') });
        for (const [k, v] of Object.entries(objs[0].shape || {})) toItem(`${key}.${k}`, typeof v === 'function' && !v.__node ? safeCall(v) : v, items, depth + 1);
        return;
      }
      items.push({ ...base, type: 'json', union: opts.map((o) => o.kind).join('|') });
      return;
    }
    case 'array': {
      const el = nodeOf(node.element);
      if (el && el.kind === 'string') { items.push({ ...base, type: 'string[]' }); return; }
      if (el && (el.kind === 'enum' || el.kind === 'literal')) {
        const vals = el.kind === 'enum' ? el.values : [el.value];
        items.push({ ...base, type: 'enum[]', enum: vals.map((v) => ({ value: v })) });
        return;
      }
      items.push({ ...base, type: 'json', of: el ? `array<${el.kind}>` : 'array' });
      return;
    }
    case 'record': {
      const val = nodeOf(node.value);
      const keyN = node.keyNode && nodeOf(node.keyNode);
      if (keyN && keyN.kind === 'enum') base.enumKeys = keyN.values;
      if (val && val.kind === 'string') { items.push({ ...base, type: 'map' }); return; }
      if (val && val.kind === 'boolean') { items.push({ ...base, type: 'json', of: 'record<boolean>' }); return; }
      if (val && val.kind === 'object' && depth < 4) {
        items.push({ ...base, type: 'record' });
        for (const [k, v] of Object.entries(val.shape || {})) toItem(`${key}.*.${k}`, typeof v === 'function' && !v.__node ? safeCall(v) : v, items, depth + 1);
        return;
      }
      items.push({ ...base, type: 'json', of: `record<${val ? val.kind : '?'}>` });
      return;
    }
    case 'object': {
      const shape = node.shape || {};
      const keys = Object.keys(shape);
      if (!keys.length || depth >= 4) { items.push({ ...base, type: 'json' }); return; }
      items.push({ ...base, type: 'group' });
      for (const [k, v] of Object.entries(shape)) toItem(`${key}.${k}`, typeof v === 'function' && !v.__node ? safeCall(v) : v, items, depth + 1);
      return;
    }
    default: {
      // 未识别的构造器：若首个参数是枚举（如 hooks 的事件名），记录下来供说明使用
      const a0 = node.args && nodeOf(node.args[0]);
      const extra = {};
      if (a0 && a0.kind === 'enum') extra.enumKeys = a0.values;
      items.push({ ...base, type: 'json', ...extra });
    }
  }
}

function safeCall(fn) {
  try { return fn(); } catch { return makeNode('unknown'); }
}

// 正则兜底：直接从文本里取每个顶层键最外层的 describe
function fallbackDescribe(objText, key) {
  const re = new RegExp(`[{,]${key.replace(/[$]/g, '\\$')}:\\(\\)=>`);
  const m = re.exec(objText);
  if (!m) return undefined;
  const start = m.index + m[0].length;
  // 找到该键值的结束（深度 0 的逗号）
  let depth = 0, j = start;
  for (; j < objText.length; j++) {
    const ch = objText[j];
    if (ch === '"' || ch === "'" || ch === '`') { j = skipString(objText, ch, j); continue; }
    if (ch === '{' || ch === '(' || ch === '[') depth++;
    else if (ch === '}' || ch === ')' || ch === ']') { if (depth === 0) break; depth--; }
    else if (ch === ',' && depth === 0) break;
  }
  const seg = objText.slice(start, j);
  const all = [...seg.matchAll(/\.describe\(("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)\)/g)];
  if (!all.length) return undefined;
  const last = all[all.length - 1][1];
  try { return JSON.parse(last[0] === '"' ? last : '"' + last.slice(1, -1).replace(/"/g, '\\"') + '"'); } catch { return last.slice(1, -1); }
}

/** 解析 schema 文本 → 扁平条目（含顶层键列表） */
export function schemaTextToItems({ main, extras = [], win, rel }) {
  const items = [];
  const topKeys = [];
  const sources = [main, ...extras];
  const ctx = win ? { win, rel } : null;
  for (const text of sources) {
    let obj;
    try {
      obj = evaluateObjectText(text, ctx);
    } catch (e) {
      // 整体求值失败：退化为只列顶层键
      const keys = [...text.matchAll(/[{,]([A-Za-z_$][\w$]*):\(\)=>/g)].map((m) => m[1]);
      for (const k of keys) {
        if (topKeys.includes(k)) continue;
        topKeys.push(k);
        items.push({ key: k, type: 'json', en: fallbackDescribe(text, k) });
      }
      continue;
    }
    for (const [k, v] of Object.entries(obj)) {
      if (k === '$schema' || topKeys.includes(k)) continue;
      topKeys.push(k);
      let val = v;
      if (typeof v === 'function' && !v.__node) val = safeCall(v);
      const before = items.length;
      toItem(k, val, items, 0);
      if (items.length === before) items.push({ key: k, type: 'json' });
      const first = items[before];
      if (first && !first.en) first.en = fallbackDescribe(text, k);
    }
  }
  return { items, topKeys };
}

export function extractClaudeSettingsFromBinary(binPath) {
  return schemaTextToItems(extractSchemaTextFromBinary(binPath));
}
