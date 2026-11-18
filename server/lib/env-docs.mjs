// 解析官方环境变量文档（markdown 表格）→ 基础条目
// Claude Code: https://code.claude.com/docs/en/env-vars.md

function stripMd(s) {
  return s
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // 链接
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 根据英文说明推断类型 */
export function guessEnvType(name, desc) {
  const d = desc.toLowerCase();
  const out = { type: 'string' };
  if (/^set to `?(1|true)`?\b/i.test(desc) || /\bset (?:it )?to `?1`? to\b/i.test(desc) || /^(?:set to )?`1` to /i.test(desc)) {
    out.type = 'boolean';
    out.envTrue = /`true`/.test(desc) && !/`1`/.test(desc) ? 'true' : '1';
  } else if (/milliseconds|\bin ms\b|\(ms\)/.test(d)) {
    out.type = 'integer';
    out.unit = 'ms';
  } else if (/\bseconds\b/.test(d) && /(timeout|interval|seconds)/.test(d) && !/milliseconds/.test(d) && /^(?:[^.]*)(number|how long|timeout|interval|seconds)/.test(d)) {
    out.type = 'integer';
    out.unit = '秒';
  } else if (/(maximum|max|number of|cap on|limit).{0,40}tokens/.test(d) || /tokens? (?:limit|budget|cap)/.test(d)) {
    out.type = 'integer';
    out.unit = 'tokens';
  } else if (/^(maximum|max|number of|cap on|how many)/.test(d)) {
    out.type = 'integer';
  }
  if (/(^|_)(API_KEY|TOKEN|SECRET|PASSWORD|PASSPHRASE|AUTH_TOKEN|ACCESS_KEY|SESSION_TOKEN|CLIENT_KEY)($|_)/.test(name) && !/_TOKENS($|_)/.test(name)) {
    out.sensitive = true;
  }
  const def = /\(default:?\s*`?([^`),]+)`?\)/i.exec(desc) || /\bdefaults? (?:is|to)\s+`([^`]+)`/i.exec(desc) || /\bDefault:\s*`([^`]+)`/.exec(desc);
  if (def) {
    const v = def[1].trim();
    out.defaultRaw = v;
  }
  if (/\bremoved in v?[\d.]+|\bno-op\b|\bdeprecated\b/i.test(desc)) out.deprecated = true;
  return out;
}

export function parseClaudeEnvDoc(md) {
  const start = md.indexOf('\n## Variables');
  const endIdx = md.indexOf('\n## ', start + 5);
  const section = md.slice(start, endIdx > 0 ? endIdx : undefined);
  const items = [];
  const seen = new Set();
  for (const line of section.split(/\r?\n/)) {
    const m = /^\|\s*`([A-Z][A-Z0-9_]+)`\s*\|(.*)\|\s*$/.exec(line);
    if (!m) continue;
    const name = m[1];
    if (seen.has(name)) continue;
    seen.add(name);
    const en = stripMd(m[2]);
    const g = guessEnvType(name, m[2]);
    const item = { key: name, type: g.type, en };
    if (g.envTrue) item.envTrue = g.envTrue;
    if (g.unit) item.unit = g.unit;
    if (g.sensitive) item.sensitive = true;
    if (g.deprecated) item.deprecated = true;
    if (g.defaultRaw !== undefined) item.defaultNote = g.defaultRaw;
    items.push(item);
  }
  return items;
}
