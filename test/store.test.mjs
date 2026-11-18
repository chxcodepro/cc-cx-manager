// 保存流程测试：冲突检测、写前备份、备份恢复
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-store-'));
process.env.CC_CX_MANAGER_HOME = path.join(tmp, 'app');
const { computeNext, saveTarget, listBackups, restoreBackup, hashText, ConflictError } = await import('../server/lib/store.mjs');

const target = { id: 'test-codex', path: path.join(tmp, 'config.toml'), format: 'toml' };

before(() => fs.writeFileSync(target.path, '# 我的配置\nmodel = "gpt-5"\n', 'utf8'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('文件被外部修改后保存会报冲突', () => {
  const staleHash = hashText('旧内容');
  assert.throws(() => computeNext(target, { ops: [], baseHash: staleHash }), ConflictError);
});

test('保存前自动备份，并能从备份恢复', () => {
  const text0 = fs.readFileSync(target.path, 'utf8');
  const r = saveTarget(target, { ops: [{ op: 'set', path: ['model'], value: 'gpt-5.5' }], baseHash: hashText(text0) });
  assert.equal(r.changed, true);
  assert.ok(r.backup, '应生成备份');
  const text1 = fs.readFileSync(target.path, 'utf8');
  assert.match(text1, /# 我的配置/);
  assert.match(text1, /model = "gpt-5\.5"/);

  const backups = listBackups(target);
  assert.equal(backups.length, 1);
  restoreBackup(target, backups[0].name);
  assert.equal(fs.readFileSync(target.path, 'utf8'), text0);
});

test('原始文本模式会先校验格式', () => {
  const cur = fs.readFileSync(target.path, 'utf8');
  assert.throws(() => computeNext(target, { text: 'model = = 1', baseHash: hashText(cur) }));
});

test('会被程序改写的文件（~/.claude.json）：可视化修改合并进最新内容，且不允许原始文本保存', () => {
  const live = { id: 'test-live', path: path.join(tmp, '.claude.json'), format: 'json', live: true, rawDisabled: true };
  fs.writeFileSync(live.path, JSON.stringify({ numStartups: 1, mcpServers: { a: { command: 'npx' } } }, null, 2), 'utf8');
  const loadedHash = hashText(fs.readFileSync(live.path, 'utf8'));
  // 模拟 Claude Code 在你编辑期间改写了文件
  fs.writeFileSync(live.path, JSON.stringify({ numStartups: 2, mcpServers: { a: { command: 'npx' } } }, null, 2), 'utf8');
  const r = saveTarget(live, { ops: [{ op: 'set', path: ['mcpServers', 'b'], value: { type: 'http', url: 'https://example.invalid/mcp' } }], baseHash: loadedHash });
  assert.equal(r.changed, true);
  const after = JSON.parse(fs.readFileSync(live.path, 'utf8'));
  assert.equal(after.numStartups, 2, '应保留 Claude Code 写入的最新内容');
  assert.deepEqual(Object.keys(after.mcpServers), ['a', 'b']);
  assert.throws(() => computeNext(live, { text: '{}', baseHash: hashText(fs.readFileSync(live.path, 'utf8')) }), /原始文本/);
});

test('内容没有变化时不写入、不备份', () => {
  const cur = fs.readFileSync(target.path, 'utf8');
  const n = listBackups(target).length;
  const r = saveTarget(target, { ops: [], baseHash: hashText(cur) });
  assert.equal(r.changed, false);
  assert.equal(listBackups(target).length, n);
});
