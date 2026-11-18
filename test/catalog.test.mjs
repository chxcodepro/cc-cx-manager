// 参数目录测试：中文叠加层解析无误、所有参数都有中文说明
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// 使用空的数据目录，避免读到本机「同步最新参数」生成的缓存
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-catalog-'));
process.env.CC_CX_MANAGER_HOME = tmpHome;
after(() => fs.rmSync(tmpHome, { recursive: true, force: true }));
const { CATALOGS, getCatalog } = await import('../server/lib/catalog.mjs');
const { parseOverlay, parseBrief } = await import('../server/lib/overlay.mjs');

for (const name of Object.keys(CATALOGS)) {
  test(`参数目录 ${name}：叠加层无错误、全部已翻译`, () => {
    const c = getCatalog(name);
    assert.deepEqual(c.overlayErrors, []);
    assert.ok(c.stats.total > 0);
    const untranslated = c.items.filter((i) => i.untranslated && i.type !== 'group').map((i) => i.key);
    assert.deepEqual(untranslated, [], '以下参数缺少中文说明');
    for (const i of c.items) assert.ok(c.categories.some((x) => x.id === i.category), `${i.key} 的分类 ${i.category} 不存在`);
  });

  test(`参数目录 ${name}：说明较长的参数都有一句话说明`, () => {
    const c = getCatalog(name);
    const len = (s) => [...(s || '')].length;
    const missing = c.items.filter((i) => i.type !== 'group' && !i.untranslated && !i.brief && len(i.description) > 30).map((i) => i.key);
    assert.deepEqual(missing, [], '以下参数缺少一句话说明');
    const tooLong = c.items.filter((i) => i.brief && len(i.brief) > 40).map((i) => i.key);
    assert.deepEqual(tooLong, [], '以下一句话说明超过 40 字');
    assert.deepEqual(c.briefOrphans, [], '一句话说明中有找不到的参数');
    const longReason = c.items.filter((i) => len(i.recommendedReason) > 40).map((i) => i.key);
    assert.deepEqual(longReason, [], '以下推荐理由超过 40 字');
  });
}

test('一句话说明文件：解析与格式检查', () => {
  const r = parseBrief('# 注释\na.b | 开启后更快\nbad line\nc | 含\\|竖线', 't.brief.zh.txt');
  assert.deepEqual(r.items, [{ key: 'a.b', brief: '开启后更快' }, { key: 'c', brief: '含|竖线' }]);
  assert.equal(r.errors.length, 1);
});

test('叠加层：转义、推荐值与扩展字段', () => {
  const src = [
    '@category demo | 演示 | 10 | 第一行\\n第二行',
    'a.b | 标题 | demo | 说明\\n第二行 | true | 理由 | tags=x,y ;; p=windows ;; ex={"k":"a\\|b"} ;; s',
  ].join('\n');
  const r = parseOverlay(src, 't.zh.txt');
  assert.deepEqual(r.errors, []);
  assert.equal(r.categories[0].description, '第一行\n第二行');
  const it = r.items[0];
  assert.equal(it.description, '说明\n第二行');
  assert.equal(it.recommended, true);
  assert.equal(it.recommendedReason, '理由');
  assert.deepEqual(it.tags, ['x', 'y']);
  assert.deepEqual(it.platforms, ['windows']);
  assert.deepEqual(it.example, { k: 'a|b' });
  assert.equal(it.sensitive, true);
});

test('叠加层：能发现扩展列错位', () => {
  const missingPipe = parseOverlay('k | 标题 | c | 说明 | | 理由 ;; tags=x', 't');
  assert.match(missingPipe.errors.join(), /漏写了竖线/);
  const shifted = parseOverlay('k | 标题 | c | 说明 | | | 理由 ;; tags=x', 't');
  assert.match(shifted.errors.join(), /未知扩展项/);
});
