#!/usr/bin/env node
// 检查叠加层覆盖率：列出未翻译的条目、叠加层中写错的 key、推荐值与类型不符等问题
// 用法：node scripts/check-overlay.mjs claude-settings [--list]
import { getCatalog, loadBase } from '../server/lib/catalog.mjs';

const name = process.argv[2];
const list = process.argv.includes('--list');
const c = getCatalog(name);
const baseKeys = new Set();
for (const b of { 'claude-settings': ['claude-settings'], 'claude-env': ['claude-env'], 'claude-mcp': ['claude-mcp'], 'codex-config': ['codex-config', 'codex-features'], 'codex-env': ['codex-env'] }[name]) {
  for (const i of loadBase(b).items || []) baseKeys.add(i.key);
}
const untranslated = c.items.filter((i) => i.untranslated);
const orphan = c.items.filter((i) => i.inOverlay && !i.inBase);
const typeErr = [];
for (const i of c.items) {
  const r = i.recommended;
  if (r === undefined) continue;
  if (name.endsWith('-env')) continue;
  const t = i.type;
  const ok =
    (t === 'boolean' && typeof r === 'boolean') ||
    ((t === 'integer' || t === 'number') && typeof r === 'number') ||
    (t === 'string' && typeof r === 'string') ||
    (t === 'enum' && (i.enum || []).some((e) => e.value === r)) ||
    ((t === 'string[]' || t === 'enum[]') && Array.isArray(r)) ||
    t === 'json' || t === 'map' || t === 'record' || t === 'group';
  if (!ok) typeErr.push(`${i.key}（${t}）推荐值 ${JSON.stringify(r)}`);
}
// 一句话说明：说明超过 30 字的参数都应该有；说明本身不超过 40 字
const BRIEF_NEED = 30;
const BRIEF_MAX = 40;
const len = (s) => [...(s || '')].length;
const needBrief = c.items.filter((i) => i.type !== 'group' && !i.untranslated && !i.brief && len(i.description) > BRIEF_NEED);
const longBrief = c.items.filter((i) => i.brief && len(i.brief) > BRIEF_MAX);
console.log(`${name}: 共 ${c.items.length} 条，未翻译 ${untranslated.length}，叠加层多余 key ${orphan.length}，推荐值类型问题 ${typeErr.length}，解析错误 ${c.overlayErrors.length}，缺一句话说明 ${needBrief.length}，一句话说明过长 ${longBrief.length}，一句话说明多余 key ${c.briefOrphans.length}`);
if (c.briefOrphans.length) console.log('一句话说明中找不到的 key：' + c.briefOrphans.join(', '));
if (longBrief.length) console.log('一句话说明过长：\n  ' + longBrief.map((i) => `${i.key}（${len(i.brief)} 字）`).join('\n  '));
if (list && needBrief.length) console.log('缺一句话说明：' + needBrief.map((i) => i.key).join(' '));
const longReason = c.items.filter((i) => len(i.recommendedReason) > BRIEF_MAX);
if (longReason.length) console.log('推荐理由超过 ' + BRIEF_MAX + ' 字：\n  ' + longReason.map((i) => `${i.key}（${len(i.recommendedReason)} 字）`).join('\n  '));
if (c.overlayErrors.length) console.log('解析错误：\n  ' + c.overlayErrors.join('\n  '));
if (orphan.length) console.log('叠加层中存在但官方定义没有的 key：' + orphan.map((i) => i.key).join(', '));
if (typeErr.length) console.log('推荐值问题：\n  ' + typeErr.join('\n  '));
if (list && untranslated.length) console.log('未翻译：' + untranslated.map((i) => i.key).join(' '));
