import assert from 'node:assert/strict';
import test from 'node:test';
import { splitTelegramMessage, TelegramAgent } from '../telegram-agent.mjs';

test('splitTelegramMessage keeps every chunk within Telegram limits', () => {
  const text = `${'a'.repeat(60)}\n${'b'.repeat(60)}\n${'c'.repeat(60)}`;
  const chunks = splitTelegramMessage(text, 80);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.length <= 80));
  assert.equal(chunks.join('').replace(/\s/g, ''), text.replace(/\s/g, ''));
});

test('unauthorized users never reach a brain provider', async () => {
  let providerCalls = 0;
  const sent = [];
  const agent = new TelegramAgent({
    telegramToken: 'test-token',
    allowedUsers: ['123'],
    providers: [],
    requestTimeoutMs: 1000,
    historyLimit: 4,
    systemPrompt: 'test',
  }, {
    router: {
      list: () => [],
      complete: async () => { providerCalls += 1; },
    },
  });
  agent.send = async (_chatId, text) => sent.push(text);

  await agent.handleMessage({ chat: { id: 7 }, from: { id: 999 }, text: 'hello' });
  assert.equal(providerCalls, 0);
  assert.deepEqual(sent, []);
});

test('group chats are ignored unless the owner explicitly enables them', async () => {
  let providerCalls = 0;
  const agent = new TelegramAgent({
    telegramToken: 'test-token',
    allowedUsers: ['123'],
    allowGroups: false,
    providers: [],
    requestTimeoutMs: 1000,
    historyLimit: 4,
    systemPrompt: 'test',
  }, {
    router: {
      list: () => [],
      complete: async () => { providerCalls += 1; },
    },
  });

  await agent.handleMessage({ chat: { id: -7, type: 'group' }, from: { id: 123 }, text: 'hello' });
  assert.equal(providerCalls, 0);
});
