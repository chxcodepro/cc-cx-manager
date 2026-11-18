// 配置格式读写测试：保留注释、缩进、换行符、BOM，以及 ops 的安全检查
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { json, toml, dotenv, applyOps, toTransit } from '../server/lib/formats.mjs';

test('TOML：修改值后保留注释与排版', () => {
  const original = '# 顶部注释\nmodel = "gpt-5"\n\n[features]\nhooks = true # 行内注释\n';
  const data = toml.parse(original);
  data.model = 'gpt-5.5';
  data.features.memories = false;
  const out = toml.serialize(data, original);
  assert.match(out, /# 顶部注释/);
  assert.match(out, /hooks = true # 行内注释/);
  assert.match(out, /model = "gpt-5\.5"/);
  assert.match(out, /memories = false/);
  assert.deepEqual(toTransit(toml.parse(out)), { model: 'gpt-5.5', features: { hooks: true, memories: false } });
});

test('TOML：保留 CRLF 与 BOM', () => {
  const original = '﻿a = 1\r\n# 注释\r\nb = "x"\r\n';
  const data = toml.parse(original);
  data.a = 2;
  const out = toml.serialize(data, original);
  assert.equal(out.charCodeAt(0), 0xfeff);
  assert.ok(out.includes('\r\n'));
  assert.ok(!/[^\r]\n/.test(out), '不应出现单独的 LF');
  assert.deepEqual(toTransit(toml.parse(out)), { a: 2, b: 'x' });
});

test('JSON：保留缩进、BOM 与 CRLF', () => {
  const original = '﻿{\r\n    "a": 1,\r\n    "b": {\r\n        "c": true\r\n    }\r\n}\r\n';
  const data = json.parse(original);
  data.b.d = 'x';
  const out = json.serialize(data, original);
  assert.equal(out.charCodeAt(0), 0xfeff);
  assert.ok(out.includes('\r\n    "a": 1'));
  assert.ok(out.includes('        "d": "x"'));
  assert.deepEqual(json.parse(out), { a: 1, b: { c: true, d: 'x' } });
});

test('JSON：顶层不是对象时报错', () => {
  assert.throws(() => json.parse('[1, 2]'));
});

test('dotenv：未修改的行原样保留，修改、删除、新增正确', () => {
  const original = '# Codex 环境变量\nA=1\nB="hello world" # 说明\nexport C=\'raw value\'\nD=old\n';
  const data = dotenv.parse(original);
  assert.deepEqual(data, { A: '1', B: 'hello world', C: 'raw value', D: 'old' });
  data.D = 'new value';
  delete data.A;
  data.E = 'line1\nline2';
  const out = dotenv.serialize(data, original);
  assert.ok(out.startsWith('# Codex 环境变量\n'));
  assert.ok(out.includes('B="hello world" # 说明'), '未修改的行应保留引号与行内注释');
  assert.ok(out.includes("export C='raw value'"));
  assert.ok(out.includes('D="new value"'));
  assert.ok(!/^A=/m.test(out), '删除的变量不应再出现');
  assert.deepEqual(dotenv.parse(out), { B: 'hello world', C: 'raw value', D: 'new value', E: 'line1\nline2' });
});

test('ops：set / unset / rename，删除后清理空的父对象', () => {
  const data = { a: { b: { c: 1 } }, x: 1, y: 2, z: 3 };
  applyOps(data, [
    { op: 'set', path: ['p', 'q'], value: true },
    { op: 'unset', path: ['a', 'b', 'c'] },
    { op: 'rename', path: ['y'], to: 'yy' },
  ]);
  assert.deepEqual(data, { x: 1, yy: 2, z: 3, p: { q: true } });
  assert.deepEqual(Object.keys(data), ['x', 'yy', 'z', 'p'], 'rename 应保持原有顺序');
});

test('ops：拒绝原型污染路径', () => {
  assert.throws(() => applyOps({}, [{ op: 'set', path: ['__proto__', 'polluted'], value: 1 }]));
  assert.throws(() => applyOps({}, [{ op: 'set', path: ['a', 'constructor'], value: 1 }]));
  assert.throws(() => applyOps({ a: 1 }, [{ op: 'rename', path: ['a'], to: '__proto__' }]));
  assert.equal({}.polluted, undefined);
});
