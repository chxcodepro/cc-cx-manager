// 接口测试：~/.claude.json 只把 MCP 相关部分发给界面
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-api-'));
const claudeDir = path.join(tmp, 'claude');
const projectDir = path.join(tmp, 'proj');
fs.mkdirSync(claudeDir, { recursive: true });
fs.mkdirSync(projectDir, { recursive: true });
process.env.CLAUDE_CONFIG_DIR = claudeDir;
process.env.CODEX_HOME = path.join(tmp, 'codex');
process.env.CC_CX_MANAGER_HOME = path.join(tmp, 'app');

// Claude Code 在 Windows 上用正斜杠记录项目路径
const projectKey = projectDir.split(path.sep).join('/');
fs.writeFileSync(path.join(claudeDir, '.claude.json'), JSON.stringify({
  numStartups: 5,
  oauthAccount: { emailAddress: 'someone@example.invalid' },
  mcpServers: { docs: { command: 'npx', args: ['-y', '<package-name>'] } },
  projects: {
    [projectKey]: { allowedTools: [], history: ['不该发给界面'], mcpServers: { db: { type: 'stdio', command: 'uvx' } } },
    'D:/other': { mcpServers: { other: { command: 'x' } } },
  },
}, null, 2), 'utf8');

const { createApi } = await import('../server/api.mjs');
const api = createApi();
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('用户范围：只发 mcpServers，不发全文和账号信息', async () => {
  const f = await api.file({ id: 'claude-mcp-user' });
  assert.equal(f.exists, true);
  assert.equal(f.text, '');
  assert.deepEqual(Object.keys(f.data), ['mcpServers']);
  assert.deepEqual(Object.keys(f.data.mcpServers), ['docs']);
});

test('项目本地范围：按原路径只发这个项目的 mcpServers', async () => {
  await api.setProject({ dir: projectDir });
  const f = await api.file({ id: 'claude-mcp-local' });
  assert.equal(f.text, '');
  const key = f.dataPrefix[1];
  assert.equal(key.toLowerCase(), projectKey.toLowerCase());
  assert.deepEqual(Object.keys(f.data), ['projects']);
  assert.deepEqual(Object.keys(f.data.projects), [key]);
  assert.deepEqual(f.data.projects[key], { mcpServers: { db: { type: 'stdio', command: 'uvx' } } });
});

test('Windows：还没在 Claude Code 里打开过的项目，键用大写盘符和正斜杠', { skip: process.platform !== 'win32' }, async () => {
  const { claudeProjectKey } = await import('../server/lib/paths.mjs');
  assert.equal(claudeProjectKey('d:\\demo\\new-project'), 'D:/demo/new-project');
});

test('项目本地范围保存后，其他项目和账号信息原样保留', async () => {
  const f = await api.file({ id: 'claude-mcp-local' });
  const key = f.dataPrefix[1];
  const r = await api.save({ id: 'claude-mcp-local', baseHash: f.hash, ops: [{ op: 'set', path: ['projects', key, 'mcpServers', 'db', 'command'], value: 'uv' }] });
  assert.equal(r.changed, true);
  assert.deepEqual(Object.keys(r.file.data), ['projects']);
  const all = JSON.parse(fs.readFileSync(path.join(claudeDir, '.claude.json'), 'utf8'));
  assert.equal(all.projects[key].mcpServers.db.command, 'uv');
  assert.deepEqual(all.projects[key].history, ['不该发给界面']);
  assert.deepEqual(all.projects['D:/other'], { mcpServers: { other: { command: 'x' } } });
  assert.equal(all.oauthAccount.emailAddress, 'someone@example.invalid');
});
