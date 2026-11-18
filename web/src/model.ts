// 数据模型工具：按路径读写（不可变更新）、计算修改操作、推荐值等
import type { Item, Op, Platform } from './types';

export type Obj = Record<string, unknown>;

export function isPlainObject(v: unknown): v is Obj {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export function keyToPath(key: string, prefix: string[] = []): string[] {
  return [...prefix, ...key.split('.')];
}

export function getIn(obj: unknown, path: string[]): unknown {
  let cur: unknown = obj;
  for (const seg of path) {
    if (!isPlainObject(cur)) return undefined;
    cur = cur[seg];
  }
  return cur;
}

export function setIn(obj: Obj, path: string[], value: unknown): Obj {
  if (!path.length) return obj;
  const [head, ...rest] = path;
  const copy: Obj = { ...obj };
  if (!rest.length) {
    copy[head] = value;
    return copy;
  }
  const child = isPlainObject(obj[head]) ? (obj[head] as Obj) : {};
  copy[head] = setIn(child, rest, value);
  return copy;
}

export function unsetIn(obj: Obj, path: string[]): Obj {
  if (!path.length) return obj;
  const [head, ...rest] = path;
  if (!(head in obj)) return obj;
  const copy: Obj = { ...obj };
  if (!rest.length) {
    delete copy[head];
    return copy;
  }
  if (!isPlainObject(obj[head])) return obj;
  const child = unsetIn(obj[head] as Obj, rest);
  if (Object.keys(child).length === 0) delete copy[head];
  else copy[head] = child;
  return copy;
}

/** 重命名对象中的某个键，保持原有顺序 */
export function renameIn(obj: Obj, path: string[], to: string): Obj {
  const parentPath = path.slice(0, -1);
  const from = path[path.length - 1];
  const parent = parentPath.length ? getIn(obj, parentPath) : obj;
  if (!isPlainObject(parent) || !(from in parent)) return obj;
  const rebuilt: Obj = {};
  for (const [k, v] of Object.entries(parent)) rebuilt[k === from ? to : k] = v;
  return parentPath.length ? setIn(obj, parentPath, rebuilt) : rebuilt;
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => deepEqual(x, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => k in b && deepEqual(a[k], b[k]));
  }
  return false;
}

/** 比较原始数据与草稿，生成最小修改操作 */
export function diffOps(before: unknown, after: unknown, path: string[] = []): Op[] {
  if (deepEqual(before, after)) return [];
  if (isPlainObject(before) && isPlainObject(after)) {
    const ops: Op[] = [];
    for (const k of Object.keys(before)) {
      if (!(k in after)) ops.push({ op: 'unset', path: [...path, k] });
    }
    for (const k of Object.keys(after)) {
      if (!(k in before)) ops.push({ op: 'set', path: [...path, k], value: after[k] });
      else ops.push(...diffOps(before[k], after[k], [...path, k]));
    }
    return ops;
  }
  if (after === undefined) return [{ op: 'unset', path }];
  return [{ op: 'set', path, value: after }];
}

/** 统计草稿中被修改的叶子路径（用于高亮） */
export function changedPaths(before: unknown, after: unknown): Set<string> {
  const set = new Set<string>();
  for (const op of diffOps(before, after)) set.add(op.path.join('\u0001'));
  return set;
}

export function pathChanged(changed: Set<string>, path: string[]): boolean {
  const key = path.join('\u0001');
  for (const c of changed) {
    if (c === key || c.startsWith(key + '\u0001') || key.startsWith(c + '\u0001')) return true;
  }
  return false;
}

export function recommendedFor(item: Item, platform: Platform): unknown {
  if (item.recommendedByPlatform && platform in item.recommendedByPlatform) return item.recommendedByPlatform[platform];
  return item.recommended;
}

/** env 类目录：把推荐值（布尔/数字）转成要写入的字符串 */
export function envEncode(item: Item, v: unknown): string {
  if (typeof v === 'boolean') return v ? item.envTrue || '1' : item.envFalse || '0';
  if (v === null || v === undefined) return '';
  return typeof v === 'string' ? v : JSON.stringify(v);
}

export function envTruthy(v: unknown, item: Item): boolean {
  if (v === undefined) return false;
  const s = String(v).toLowerCase();
  if (item.envTrue && s === item.envTrue.toLowerCase()) return true;
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

export function formatValue(v: unknown): string {
  if (v === undefined) return '未设置';
  if (typeof v === 'string') return v === '' ? '""（空字符串）' : v;
  return JSON.stringify(v);
}

export function itemAppliesToPlatform(item: Item, platform: Platform): boolean {
  return !item.platforms || !item.platforms.length || item.platforms.includes(platform);
}

/** 记录型条目（如 mcp_servers.*）的字段列表 */
export function recordFields(items: Item[], recordKey: string): Item[] {
  const prefix = recordKey + '.*.';
  return items.filter((i) => i.key.startsWith(prefix) && !i.key.slice(prefix.length).includes('*'));
}

export function searchText(item: Item): string {
  return [item.key, item.title, item.description, item.en, item.featureName, ...(item.tags || [])].filter(Boolean).join(' ').toLowerCase();
}

/** 未设置且默认值就等于推荐值：无需再写入 */
export function recIsDefault(item: Item, current: unknown, rec: unknown): boolean {
  return rec !== undefined && current === undefined && item.default !== undefined && deepEqual(item.default, rec);
}

/** 企业 / 托管 / 内部参数：默认隐藏，勾选「企业/内部」后显示 */
export function isTierHidden(item: Item): boolean {
  if (item.tags?.some((t) => t === 'managed-only' || t === 'enterprise' || t === 'internal')) return true;
  return item.scopes?.length === 1 && item.scopes[0] === 'managed';
}

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SECRET_HINT = /key|token|secret|password|auth/i;

/**
 * 从 Codex config.toml 中找出引用的环境变量名：
 * model_providers.<id>.env_key / env_http_headers，mcp_servers.<id>.bearer_token_env_var / env_http_headers / env_vars
 * 这些变量写在 ~/.codex/.env 中即可被 Codex 读取（CODEX_ 开头的除外）
 */
export function collectEnvRefs(cfg: Obj, source: string, out: Map<string, Item>): void {
  const add = (name: unknown, title: string, desc: string, sensitive: boolean) => {
    if (typeof name !== 'string' || !ENV_NAME.test(name)) return;
    const line = `${source}：${desc}`;
    const prev = out.get(name);
    if (prev) {
      if (!prev.description?.includes(line)) prev.description = `${prev.description}\n${line}`;
      prev.sensitive = prev.sensitive || sensitive;
      return;
    }
    const ignored = name.toUpperCase().startsWith('CODEX_');
    out.set(name, {
      key: name,
      title,
      category: 'refs',
      type: 'string',
      sensitive,
      placeholder: sensitive ? '<YOUR_API_KEY>' : undefined,
      tags: ['ref'],
      description: (ignored ? '⚠ 变量名以 CODEX_ 开头，Codex 会忽略 .env 中的它：请在 config.toml 中换一个变量名，或改在系统环境中设置。\n' : '') + line,
    });
  };
  const providers = cfg.model_providers;
  if (isPlainObject(providers)) {
    for (const [id, p] of Object.entries(providers)) {
      if (!isPlainObject(p)) continue;
      const label = typeof p.name === 'string' && p.name && p.name !== id ? `${p.name}（${id}）` : id;
      add(p.env_key, `${label} 的 API Key`, `[model_providers.${id}] 的 env_key 引用此变量作为 API Key`, true);
      if (isPlainObject(p.env_http_headers)) {
        for (const [h, v] of Object.entries(p.env_http_headers)) {
          add(v, `${label} 请求头 ${h}`, `[model_providers.${id}] 的 env_http_headers 用此变量的值作为请求头 ${h}`, SECRET_HINT.test(h));
        }
      }
    }
  }
  const servers = cfg.mcp_servers;
  if (isPlainObject(servers)) {
    for (const [id, s] of Object.entries(servers)) {
      if (!isPlainObject(s)) continue;
      add(s.bearer_token_env_var, `MCP ${id} 的令牌`, `[mcp_servers.${id}] 的 bearer_token_env_var 用此变量作为 Bearer 令牌`, true);
      if (isPlainObject(s.env_http_headers)) {
        for (const [h, v] of Object.entries(s.env_http_headers)) {
          add(v, `MCP ${id} 请求头 ${h}`, `[mcp_servers.${id}] 的 env_http_headers 用此变量的值作为请求头 ${h}`, SECRET_HINT.test(h));
        }
      }
      if (Array.isArray(s.env_vars)) {
        for (const e of s.env_vars) {
          const n = typeof e === 'string' ? e : isPlainObject(e) ? e.name : undefined;
          // source = "remote" 读取远程执行器的环境；CODEX_ 开头的通常由 Codex 自动提供，且 .env 中无法设置
          if (isPlainObject(e) && e.source === 'remote') continue;
          if (typeof n !== 'string' || n.toUpperCase().startsWith('CODEX_')) continue;
          add(n, `MCP ${id} 放行的变量`, `[mcp_servers.${id}] 的 env_vars 允许把此变量传给 MCP 服务器进程`, SECRET_HINT.test(n));
        }
      }
    }
  }
}
