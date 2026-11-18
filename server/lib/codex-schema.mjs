// 把 Codex 官方 config.schema.json（JSON Schema draft-07）展平成「参数条目」列表
// 规则：
//   - 普通对象（有 properties）递归展开为点路径：tui.notifications
//   - 动态键表（additionalProperties 为对象 schema）输出为 record，子字段用 * 占位：mcp_servers.*.command
//   - profiles 不展开（字段与顶层同名，复用顶层说明），features 单独处理
//   - 无法用简单控件表达的联合类型 / 深层结构输出为 json
// 该模块同时用于：生成调研底稿、运行时发现「目录中尚未收录的新参数」

const MAX_DEPTH = 6;

export function flattenCodexSchema(schema, { skipRecurse = ['profiles', 'features'] } = {}) {
  const defs = schema.definitions || schema.$defs || {};
  const items = [];

  const refName = (ref) => ref.split('/').pop();

  // 解析 $ref / 单元素 allOf 包装，返回合并后的节点（保留外层 description/default）
  function resolve(node, seen = new Set()) {
    if (!node || typeof node !== 'object') return node;
    let cur = node;
    let outer = {};
    for (let guard = 0; guard < 10; guard++) {
      if (cur.$ref) {
        const name = refName(cur.$ref);
        if (seen.has(name)) return { ...cur, $circular: name };
        seen.add(name);
        outer = { ...pickMeta(cur), ...outer };
        cur = defs[name] || {};
        continue;
      }
      if (Array.isArray(cur.allOf) && cur.allOf.length === 1 && !cur.properties) {
        outer = { ...pickMeta(cur), ...outer };
        cur = cur.allOf[0];
        continue;
      }
      break;
    }
    return { ...cur, ...stripUndef(outer) };
  }

  function pickMeta(n) {
    return stripUndef({ description: n.description, default: n.default, deprecated: n.deprecated });
  }
  function stripUndef(o) {
    const r = {};
    for (const [k, v] of Object.entries(o)) if (v !== undefined) r[k] = v;
    return r;
  }

  function nonNullTypes(n) {
    if (Array.isArray(n.type)) return n.type.filter((t) => t !== 'null');
    return n.type ? [n.type] : [];
  }

  // 尝试把 oneOf/anyOf 识别为字符串枚举
  function asEnum(n) {
    if (Array.isArray(n.enum)) {
      return n.enum.filter((v) => v !== null).map((v) => ({ value: v }));
    }
    const branches = n.oneOf || n.anyOf;
    if (!Array.isArray(branches)) return null;
    const out = [];
    for (const b0 of branches) {
      const b = resolve(b0);
      if (b.type === 'null') continue;
      if (b.const !== undefined) { out.push({ value: b.const, en: b.description }); continue; }
      if (Array.isArray(b.enum)) {
        for (const v of b.enum) if (v !== null) out.push({ value: v, en: b.description });
        continue;
      }
      return null;
    }
    return out.length ? out : null;
  }

  function classify(n) {
    const en = asEnum(n);
    if (en) return { type: 'enum', enum: en };
    const types = nonNullTypes(n);
    if (n.oneOf || n.anyOf) {
      // 可空包装：anyOf [X, null]
      const br = (n.oneOf || n.anyOf).map((b) => resolve(b)).filter((b) => b.type !== 'null');
      if (br.length === 1) return classify({ ...br[0], description: n.description ?? br[0].description, default: n.default ?? br[0].default });
      return { type: 'json', union: true };
    }
    if (types.length > 1) return { type: 'json', union: true };
    const t = types[0];
    if (t === 'boolean') return { type: 'boolean' };
    if (t === 'integer') return { type: 'integer', min: n.minimum, max: n.maximum };
    if (t === 'number') return { type: 'number', min: n.minimum, max: n.maximum };
    if (t === 'string') return { type: 'string' };
    if (t === 'array') {
      const it = resolve(n.items || {});
      const itEnum = asEnum(it);
      if (itEnum) return { type: 'enum[]', enum: itEnum };
      if (nonNullTypes(it)[0] === 'string') return { type: 'string[]' };
      return { type: 'json' };
    }
    if (t === 'object' || n.properties || n.additionalProperties) {
      if (n.properties && Object.keys(n.properties).length) return { type: 'object' };
      if (n.additionalProperties && typeof n.additionalProperties === 'object') {
        const v = resolve(n.additionalProperties);
        const vt = nonNullTypes(v)[0];
        if (vt === 'string' && !v.properties) return { type: 'map' };
        if (v.properties) return { type: 'record' };
        return { type: 'json' };
      }
      return { type: 'json' };
    }
    return { type: 'json' };
  }

  // 可空包装 anyOf [X, null] → X（保留外层说明与默认值）
  function unwrap(node0) {
    let node = resolve(node0);
    for (let guard = 0; guard < 5; guard++) {
      const branches = node.oneOf || node.anyOf;
      if (!Array.isArray(branches) || asEnum(node)) break;
      const br = branches.map((b) => resolve(b)).filter((b) => b.type !== 'null');
      if (br.length !== 1) break;
      const meta = pickMeta(node);
      node = { ...br[0], ...stripUndef(meta) };
    }
    return node;
  }

  function walk(node0, path, depth) {
    const node = unwrap(node0);
    const cls = classify(node);
    const item = stripUndef({
      key: path,
      type: cls.type,
      enum: cls.enum,
      min: cls.min,
      max: cls.max,
      default: node.default === null ? undefined : node.default,
      en: node.description,
      deprecated: node.deprecated || undefined,
    });
    const top = path.split('.')[0];

    if (cls.type === 'object') {
      items.push({ ...item, type: 'group' });
      if (depth >= MAX_DEPTH) return;
      for (const [k, v] of Object.entries(node.properties)) walk(v, `${path}.${k}`, depth + 1);
      return;
    }
    if (cls.type === 'record') {
      const v = unwrap(node.additionalProperties);
      if (skipRecurse.includes(top) && depth === 0) {
        items.push({ ...item, fieldKeys: Object.keys(v.properties || {}) });
        return;
      }
      items.push(item);
      if (depth >= MAX_DEPTH) return;
      for (const [k, sub] of Object.entries(v.properties || {})) walk(sub, `${path}.*.${k}`, depth + 1);
      return;
    }
    items.push(item);
  }

  for (const [k, v] of Object.entries(schema.properties || {})) {
    if (skipRecurse.includes(k)) {
      const node = unwrap(v);
      const cls = classify(node);
      const props = node.properties ? Object.keys(node.properties) : undefined;
      const rec = node.additionalProperties && typeof node.additionalProperties === 'object'
        ? Object.keys(unwrap(node.additionalProperties).properties || {})
        : undefined;
      items.push(stripUndef({ key: k, type: cls.type === 'object' ? 'group' : cls.type, en: node.description, fieldKeys: props || rec }));
      continue;
    }
    walk(v, k, 0);
  }
  return items;
}
