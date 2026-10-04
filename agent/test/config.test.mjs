import assert from 'node:assert/strict';
import test from 'node:test';
import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadAgentConfig, parseEnv, validateRuntimeConfig } from '../config.mjs';
import { updateEnvText } from '../setup.mjs';

const isolatedEnv = (overrides = {}) => ({ AGENT_CONFIG: '', TELEGRAM_ALLOW_GROUPS: '', ...overrides });

test('parseEnv handles comments and quoted values', () => {
  assert.deepEqual(parseEnv('# note\nONE=value\nTWO="two words"\n'), { ONE: 'value', TWO: 'two words' });
});

test('loadAgentConfig resolves provider availability without exposing key values', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'agent-config-'));
  await writeFile(path.join(rootDir, 'agent.config.json'), JSON.stringify({
    providers: [{ id: 'demo', type: 'openai-compatible', baseUrl: 'https://example.test/v1', model: 'demo-model', apiKeyEnv: 'DEMO_KEY' }],
  }));
  const config = await loadAgentConfig({ rootDir, env: isolatedEnv({
    DEMO_KEY: 'short-test-value',
    TELEGRAM_BOT_TOKEN: 'test-token',
    TELEGRAM_ALLOWED_USERS: '123, 456',
  }) });

  assert.equal(config.providers[0].available, true);
  assert.deepEqual(config.allowedUsers, ['123', '456']);
  assert.equal(config.allowGroups, false);
  assert.deepEqual(validateRuntimeConfig(config), []);
});

test('loadAgentConfig rejects credential leaks and insecure remote provider URLs', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'agent-config-'));
  const writeConfig = (provider) => writeFile(path.join(rootDir, 'agent.config.json'), JSON.stringify({ providers: [provider] }));

  await writeConfig({ id: 'remote', type: 'openai-compatible', baseUrl: 'http://models.example.test/v1', model: 'demo' });
  await assert.rejects(() => loadAgentConfig({ rootDir, env: isolatedEnv() }), /must use HTTPS/);

  await writeConfig({ id: 'embedded', type: 'openai-compatible', baseUrl: 'https://user:secret@example.test/v1', model: 'demo' });
  await assert.rejects(() => loadAgentConfig({ rootDir, env: isolatedEnv() }), /must not contain credentials/);

  await writeConfig({ id: 'header', type: 'openai-compatible', baseUrl: 'https://example.test/v1', model: 'demo', headers: { Authorization: 'literal' } });
  await assert.rejects(() => loadAgentConfig({ rootDir, env: isolatedEnv() }), /must not contain credential header/);

  await writeConfig({ id: 'header-token', type: 'openai-compatible', baseUrl: 'https://example.test/v1', model: 'demo', headers: { 'X-Auth-Token': 'literal' } });
  await assert.rejects(() => loadAgentConfig({ rootDir, env: isolatedEnv() }), /must not contain credential header/);

  await writeConfig({ id: 'anthropic', type: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'demo' });
  await assert.rejects(() => loadAgentConfig({ rootDir, env: isolatedEnv() }), /apiKeyEnv is required for anthropic/);

  await writeConfig({ id: 'gemini', type: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com', model: 'demo' });
  await assert.rejects(() => loadAgentConfig({ rootDir, env: isolatedEnv() }), /apiKeyEnv is required for gemini/);

  await writeConfig({ id: { unsafe: true }, type: 'openai-compatible', baseUrl: 'https://example.test/v1', model: 'demo' });
  await assert.rejects(() => loadAgentConfig({ rootDir, env: isolatedEnv() }), /id must use lowercase/);

  await writeConfig({ id: 'invalid-model', type: 'openai-compatible', baseUrl: 'https://example.test/v1', model: { unsafe: true } });
  await assert.rejects(() => loadAgentConfig({ rootDir, env: isolatedEnv() }), /baseUrl and model as non-empty strings/);
});

test('loadAgentConfig rejects non-object configuration roots', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'agent-config-'));
  await writeFile(path.join(rootDir, 'agent.config.json'), 'null');
  await assert.rejects(() => loadAgentConfig({ rootDir, env: isolatedEnv() }), /root must be an object/);
});

test('loadAgentConfig permits HTTP only for loopback providers', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'agent-config-'));
  await writeFile(path.join(rootDir, 'agent.config.json'), JSON.stringify({
    providers: [{ id: 'local', type: 'openai-compatible', baseUrl: 'http://127.0.0.1:11434/v1', model: 'demo' }],
  }));
  const config = await loadAgentConfig({ rootDir, env: isolatedEnv({
    TELEGRAM_BOT_TOKEN: 'test-token',
    TELEGRAM_ALLOWED_USERS: '123',
    TELEGRAM_ALLOW_GROUPS: 'true',
  }) });
  assert.equal(config.allowGroups, true);
});

test('loadAgentConfig rejects broadly readable local secret files', async () => {
  if (process.platform === 'win32') return;
  const rootDir = await mkdtemp(path.join(tmpdir(), 'agent-config-'));
  await writeFile(path.join(rootDir, 'agent.config.json'), JSON.stringify({
    providers: [{ id: 'local', type: 'openai-compatible', baseUrl: 'http://127.0.0.1:11434/v1', model: 'demo' }],
  }));
  const envPath = path.join(rootDir, '.env.local');
  await writeFile(envPath, 'TELEGRAM_BOT_TOKEN=test\n', { mode: 0o644 });
  await chmod(envPath, 0o644);
  await assert.rejects(() => loadAgentConfig({ rootDir, env: isolatedEnv() }), /permissions are too broad/);
});

test('updateEnvText preserves unrelated settings and replaces owned keys', () => {
  const result = updateEnvText('UNRELATED=yes\nTELEGRAM_BOT_TOKEN="old"\n', {
    TELEGRAM_BOT_TOKEN: 'new',
    TELEGRAM_ALLOWED_USERS: '123',
  });
  assert.match(result, /UNRELATED=yes/);
  assert.match(result, /TELEGRAM_BOT_TOKEN="new"/);
  assert.match(result, /TELEGRAM_ALLOWED_USERS="123"/);
  assert.doesNotMatch(result, /old/);
});
