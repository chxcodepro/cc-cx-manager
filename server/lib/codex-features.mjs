// 解析 Codex 源码中的功能开关定义（codex-rs/features/src/lib.rs、legacy.rs）
// 输出：[{ key, stage, default, en, name }]

export function parseFeaturesRust(libRs, legacyRs = '') {
  // 1) enum Feature 变体上的文档注释
  const docs = {};
  const enumStart = libRs.indexOf('pub enum Feature {');
  const enumEnd = libRs.indexOf('\n}', enumStart);
  const body = libRs.slice(enumStart, enumEnd);
  let buf = [];
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('///')) { buf.push(line.replace(/^\/\/\/\s?/, '')); continue; }
    const m = /^([A-Z][A-Za-z0-9]*)\s*,?$/.exec(line);
    if (m) { docs[m[1]] = buf.join(' ').trim(); buf = []; continue; }
    if (!line.startsWith('//') && line) buf = [];
  }
  // 2) FEATURES 数组
  const out = [];
  const arrStart = libRs.indexOf('pub const FEATURES: &[FeatureSpec] = &[');
  const arr = libRs.slice(arrStart);
  const re = /FeatureSpec\s*\{\s*id:\s*Feature::(\w+),\s*key:\s*"([^"]+)",\s*stage:\s*Stage::(\w+)(\s*\{[\s\S]*?\})?,\s*default_enabled:\s*(true|false),?\s*\}/g;
  let m;
  while ((m = re.exec(arr))) {
    const [, variant, key, stageRaw, stageBody, def] = m;
    const stage = { Stable: 'stable', Experimental: 'experimental', UnderDevelopment: 'under development', Deprecated: 'deprecated', Removed: 'removed' }[stageRaw] || stageRaw;
    const item = { key, stage, default: def === 'true', en: docs[variant] || undefined, variant };
    if (stageBody) {
      const name = /name:\s*"([^"]*)"/.exec(stageBody);
      const menu = /menu_description:\s*"([^"]*)"/.exec(stageBody);
      if (name && name[1]) item.name = name[1];
      if (menu && menu[1]) item.en = menu[1] + (item.en && item.en !== menu[1] ? ` (${item.en})` : '');
    }
    out.push(item);
  }
  // 3) 旧别名
  const byVariant = Object.fromEntries(out.map((f) => [f.variant, f.key]));
  const aliasRe = /legacy_key:\s*"([^"]+)",\s*feature:\s*Feature::(\w+)/g;
  while ((m = aliasRe.exec(legacyRs))) {
    out.push({ key: m[1], stage: 'deprecated', aliasOf: byVariant[m[2]] || m[2], en: `Legacy alias of \`${byVariant[m[2]] || m[2]}\`.` });
  }
  return out;
}
