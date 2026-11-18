// Codex .env 页「config.toml 引用的变量」提取测试（直接加载前端的 TypeScript 模块，需要 Node 22.18+ 的类型剥离）
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { collectEnvRefs } = await import('../web/src/model.ts');

test('从 model_providers 与 mcp_servers 中提取引用的环境变量', () => {
  const cfg = {
    model_providers: {
      deepseek: { name: 'DeepSeek', base_url: '<YOUR_BASE_URL>', env_key: 'DEEPSEEK_API_KEY', env_http_headers: { 'X-Org': 'DS_ORG' } },
      bad: { env_key: 'not a valid name' },
    },
    mcp_servers: {
      ctx: { url: '<YOUR_MCP_URL>', bearer_token_env_var: 'CTX_TOKEN', env_http_headers: { Authorization: 'CTX_AUTH' } },
      local: { command: 'node', env_vars: ['GITHUB_TOKEN', 'CODEX_INTERNAL', { name: 'REMOTE_ONLY', source: 'remote' }, { name: 'PLAIN_VAR' }] },
    },
  };
  const out = new Map();
  collectEnvRefs(cfg, 'config.toml', out);
  assert.deepEqual([...out.keys()].sort(), ['CTX_AUTH', 'CTX_TOKEN', 'DEEPSEEK_API_KEY', 'DS_ORG', 'GITHUB_TOKEN', 'PLAIN_VAR']);
  assert.equal(out.get('DEEPSEEK_API_KEY').sensitive, true);
  assert.equal(out.get('DEEPSEEK_API_KEY').title, 'DeepSeek（deepseek） 的 API Key');
  assert.equal(out.get('CTX_AUTH').sensitive, true, 'Authorization 请求头应视为敏感');
  assert.equal(out.get('DS_ORG').sensitive, false);
  assert.equal(out.get('GITHUB_TOKEN').sensitive, true);
  assert.equal(out.get('PLAIN_VAR').sensitive, false);
});

test('用户自选的 CODEX_ 变量名会给出警告', () => {
  const out = new Map();
  collectEnvRefs({ model_providers: { p: { env_key: 'CODEX_MY_KEY' } } }, 'config.toml', out);
  assert.match(out.get('CODEX_MY_KEY').description, /Codex 会忽略/);
});
