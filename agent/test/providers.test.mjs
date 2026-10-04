import assert from 'node:assert/strict';
import test from 'node:test';
import { BrainRouter, callProvider, redactProviderError } from '../providers.mjs';

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
}

test('BrainRouter falls back in order and reports the provider used', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (String(url).startsWith('https://first.test')) return jsonResponse({ error: { message: 'offline' } }, 503);
    return jsonResponse({ choices: [{ message: { content: 'fallback answer' } }] });
  };
  const router = new BrainRouter([
    { id: 'first', label: 'First', type: 'openai-compatible', baseUrl: 'https://first.test/v1', model: 'one', available: true },
    { id: 'second', label: 'Second', type: 'openai-compatible', baseUrl: 'https://second.test/v1', model: 'two', available: true },
  ], { fetchImpl });

  const result = await router.complete([{ role: 'user', content: 'hello' }]);
  assert.equal(result.text, 'fallback answer');
  assert.equal(result.providerId, 'second');
  assert.equal(result.fallbackCount, 1);
  assert.equal(calls.length, 2);
});

test('Anthropic adapter separates the system prompt', async () => {
  let request;
  const fetchImpl = async (_url, options) => {
    request = JSON.parse(options.body);
    return jsonResponse({ content: [{ type: 'text', text: 'answer' }] });
  };
  const text = await callProvider({
    id: 'anthropic',
    type: 'anthropic',
    baseUrl: 'https://anthropic.test',
    model: 'model',
    apiKey: 'test-key',
  }, [
    { role: 'system', content: 'Be careful.' },
    { role: 'user', content: 'Hello' },
  ], { fetchImpl });

  assert.equal(text, 'answer');
  assert.equal(request.system, 'Be careful.');
  assert.deepEqual(request.messages, [{ role: 'user', content: 'Hello' }]);
});

test('Gemini adapter keeps the API key out of the URL', async () => {
  let requestUrl;
  let requestHeaders;
  const fetchImpl = async (url, options) => {
    requestUrl = String(url);
    requestHeaders = options.headers;
    return jsonResponse({ candidates: [{ content: { parts: [{ text: 'answer' }] } }] });
  };
  const text = await callProvider({
    id: 'gemini',
    type: 'gemini',
    baseUrl: 'https://gemini.test',
    model: 'model',
    apiKey: 'test-key',
  }, [{ role: 'user', content: 'Hello' }], { fetchImpl });

  assert.equal(text, 'answer');
  assert.equal(new URL(requestUrl).search, '');
  assert.equal(requestHeaders['x-goog-api-key'], 'test-key');
});

test('provider error redaction removes key values and URL credentials', () => {
  const message = redactProviderError(
    new Error('request failed?key=secret-value Authorization: Bearer bearer-value header-secret-value'),
    { apiKey: 'secret-value', headers: { 'X-Auth-Token': 'header-secret-value' } },
  );
  assert.doesNotMatch(message, /secret-value|bearer-value|header-secret-value/);
  assert.match(message, /REDACTED/);
});
