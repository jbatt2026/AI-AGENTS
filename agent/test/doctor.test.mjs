import assert from 'node:assert/strict';
import test from 'node:test';
import { checkProvider } from '../doctor.mjs';

test('doctor checks OpenAI-compatible models without duplicating /v1', async () => {
  let requestUrl;
  const result = await checkProvider({
    id: 'openrouter',
    type: 'openai-compatible',
    baseUrl: 'https://openrouter.test/v1',
    apiKey: 'test-key',
    available: true,
  }, 1000, async (url) => {
    requestUrl = String(url);
    return new Response('{}', { status: 200 });
  });

  assert.equal(result.ok, true);
  assert.equal(requestUrl, 'https://openrouter.test/v1/models');
});

test('doctor sends Gemini credentials in a header', async () => {
  let requestUrl;
  let requestHeaders;
  await checkProvider({
    id: 'gemini',
    type: 'gemini',
    baseUrl: 'https://gemini.test',
    apiKey: 'test-key',
    available: true,
  }, 1000, async (url, options) => {
    requestUrl = String(url);
    requestHeaders = options.headers;
    return new Response('{}', { status: 200 });
  });

  assert.equal(new URL(requestUrl).search, '');
  assert.equal(requestHeaders['x-goog-api-key'], 'test-key');
});
