// 中文叠加层（overlay）解析器
// 文件格式（UTF-8，每行一条）：
//   # 注释
//   @category id | 名称 | 排序 | 描述
//   @prefix 键前缀 => 分类id          （未指定分类时按最长前缀匹配）
//   key | 标题 | 分类 | 说明 | 推荐值 | 推荐理由 | 扩展
// 说明里的 \n 表示换行；字段内如需竖线写成 \|
// 推荐值为 JSON 字面量（true / 30 / "high" / ["a"]），解析失败按普通字符串处理
// 扩展：用 ;; 分隔的 k=v，例如  tags=security,advanced ;; p=windows ;; ex={"a":1}
//   tags  p(平台)  pn.<os>(平台说明)  rp.<os>(平台推荐值)  scopes  dep(弃用说明)  by(替代键)
//   ex(示例)  ph(占位)  u(单位)  type  def(默认值)  dn(默认值说明)  enum(值:标签,...)  enumd.<值>(取值说明)
//   s(敏感)  et/ef(env 布尔写入值)  min  max  since  stage  doc

const PIPE_ESC = '\u0000P\u0000';

function parseJsonLoose(s) {
  const t = s.trim();
  if (t === '') return undefined;
  try {
    return JSON.parse(t);
  } catch {
    return t;
  }
}

// 转义：\n → 换行，\\ → 反斜杠（Windows 路径写成 C:\\Program Files）
function text(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length) {
      const n = s[i + 1];
      if (n === 'n') { out += '\n'; i++; continue; }
      if (n === '\\') { out += '\\'; i++; continue; }
    }
    out += c;
  }
  return out.trim();
}

function parseExt(ext, item) {
  for (const part of ext.split(';;')) {
    const p = part.trim();
    if (!p) continue;
    const eq = p.indexOf('=');
    const k = (eq < 0 ? p : p.slice(0, eq)).trim();
    const v = eq < 0 ? '' : p.slice(eq + 1).trim();
    if (k === 'tags') item.tags = v.split(',').map((x) => x.trim()).filter(Boolean);
    else if (k === 'p') item.platforms = v.split(',').map((x) => x.trim()).filter(Boolean);
    else if (k.startsWith('pn.')) (item.platformNotes ||= {})[k.slice(3)] = text(v);
    else if (k.startsWith('rp.')) (item.recommendedByPlatform ||= {})[k.slice(3)] = parseJsonLoose(v);
    else if (k === 'scopes') item.scopes = v.split(',').map((x) => x.trim()).filter(Boolean);
    else if (k === 'dep') { item.deprecated = true; if (v) item.deprecatedNote = text(v); }
    else if (k === 'by') item.replacedBy = v;
    else if (k === 'ex') item.example = parseJsonLoose(v);
    else if (k === 'ph') item.placeholder = v;
    else if (k === 'u') item.unit = v;
    else if (k === 'type') item.type = v;
    else if (k === 'def') item.default = parseJsonLoose(v);
    else if (k === 'dn') item.defaultNote = text(v);
    else if (k === 'enum') {
      item.enumLabels = item.enumLabels || {};
      for (const pair of v.split(',')) {
        const i = pair.indexOf(':');
        const val = (i < 0 ? pair : pair.slice(0, i)).trim();
        const label = i < 0 ? '' : pair.slice(i + 1).trim();
        if (val) item.enumLabels[val] = label;
      }
    } else if (k.startsWith('enumd.')) (item.enumDescs ||= {})[k.slice(6)] = text(v);
    else if (k === 's') item.sensitive = true;
    else if (k === 'et') item.envTrue = v;
    else if (k === 'ef') item.envFalse = v;
    else if (k === 'min') item.min = Number(v);
    else if (k === 'max') item.max = Number(v);
    else if (k === 'since') item.since = v;
    else if (k === 'stage') item.stage = v;
    else if (k === 'doc') item.docUrl = v;
    else if (k === 'fieldKeys') item.fieldKeys = v.split(',').map((x) => x.trim()).filter(Boolean);
    else (item.extra ||= {})[k] = v;
  }
}

/**
 * 一句话说明文件（name.brief.zh.txt）：每行「key | 说明」，# 开头为注释。
 * 说明讲清楚「改这个参数有什么效果」，显示在界面「?」弹出层的第一行。
 */
export function parseBrief(src, fileName = '') {
  const items = [];
  const errors = [];
  src.replace(/^\uFEFF/, '').split(/\r?\n/).forEach((raw, idx) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const cols = line.replace(/\\\|/g, PIPE_ESC).split('|').map((s) => s.trim().split(PIPE_ESC).join('|'));
    if (cols.length !== 2 || !cols[0] || /\s/.test(cols[0]) || !cols[1]) {
      errors.push(`${fileName}:${idx + 1} 格式应为「key | 说明」`);
      return;
    }
    items.push({ key: cols[0], brief: text(cols[1]) });
  });
  return { items, errors };
}

export function parseOverlay(src, fileName = '') {
  const categories = [];
  const prefixes = [];
  const items = [];
  const errors = [];
  const lines = src.replace(/^\uFEFF/, '').split(/\r?\n/);
  lines.forEach((raw, idx) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    if (line.startsWith('@category')) {
      const [id, name, order, desc] = line.slice(9).split('|').map((s) => s.trim());
      if (!id || !name) { errors.push(`${fileName}:${idx + 1} @category 缺少 id 或名称`); return; }
      categories.push({ id, name, order: Number(order) || 999, description: desc ? text(desc) : undefined });
      return;
    }
    if (line.startsWith('@settype')) {
      // @settype 前缀 => 类型：为匹配前缀的非分组条目统一指定控件类型（如快捷键统一用 string[]）
      const m = /^@settype\s+(\S+)\s*=>\s*(\S+)$/.exec(line);
      if (m) (prefixes.settypes ||= []).push({ prefix: m[1], type: m[2] });
      else errors.push(`${fileName}:${idx + 1} @settype 格式应为 @settype 前缀 => 类型`);
      return;
    }
    if (line.startsWith('@prefix')) {
      const m = /^@prefix\s+(\S+)\s*=>\s*(\S+)$/.exec(line);
      if (m) prefixes.push({ prefix: m[1], category: m[2] });
      else errors.push(`${fileName}:${idx + 1} @prefix 格式应为 @prefix 前缀 => 分类`);
      return;
    }
    const cols = line.replace(/\\\|/g, PIPE_ESC).split('|').map((s) => s.trim().split(PIPE_ESC).join('|'));
    const [key, title, category, description, rec, reason, ext] = cols;
    if (!key || /\s/.test(key.trim())) { errors.push(`${fileName}:${idx + 1} 无法解析的行`); return; }
    const item = { key: key.trim() };
    if (title && title.trim()) item.title = title.trim();
    if (category && category.trim()) item.category = category.trim();
    if (description && description.trim()) item.description = text(description);
    const r = rec !== undefined ? parseJsonLoose(rec) : undefined;
    if (r !== undefined) item.recommended = r;
    if (reason && reason.trim()) item.recommendedReason = text(reason);
    if (ext && ext.trim()) parseExt(ext, item);
    if (cols.length > 7) errors.push(`${fileName}:${idx + 1} 字段过多（说明中的竖线请写成 \\|）`);
    // 常见笔误：推荐理由后直接写 ;; 扩展而漏了竖线，扩展会被当成理由文本
    if (ext === undefined && reason && reason.includes(';;')) errors.push(`${fileName}:${idx + 1} 推荐理由中出现 ;;，扩展字段前可能漏写了竖线`);
    // 另一种笔误：多写了一个空列，推荐理由跑进了扩展列，变成未知扩展项
    if (item.extra) errors.push(`${fileName}:${idx + 1} 未知扩展项：${Object.keys(item.extra).join('、')}（推荐理由可能写进了扩展列）`);
    items.push(item);
  });
  return { categories, prefixes, settypes: prefixes.settypes || [], items, errors };
}
