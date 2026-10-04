import { loadAgentConfig, validateRuntimeConfig } from './config.mjs';
import { telegramRequest } from './telegram-agent.mjs';
import { pathToFileURL } from 'node:url';

export async function checkProvider(provider, timeoutMs, fetchImpl = globalThis.fetch) {
  if (!provider.available) return { ok: false, detail: `missing ${provider.apiKeyEnv}` };
  let url;
  const headers = {};
  if (provider.type === 'gemini') {
    url = new URL(`${provider.baseUrl.replace(/\/$/, '')}/v1beta/models`);
    headers['x-goog-api-key'] = provider.apiKey;
  } else if (provider.type === 'anthropic') {
    url = `${provider.baseUrl.replace(/\/$/, '')}/v1/models`;
    headers['x-api-key'] = provider.apiKey;
    headers['anthropic-version'] = '2023-06-01';
  } else {
    url = `${provider.baseUrl.replace(/\/$/, '')}/models`;
    if (provider.apiKey) headers.authorization = `Bearer ${provider.apiKey}`;
  }
  try {
    const response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
    return response.ok ? { ok: true, detail: 'reachable' } : { ok: false, detail: `HTTP ${response.status}` };
  } catch (error) {
    return { ok: false, detail: error.name === 'TimeoutError' ? 'timed out' : error.message };
  }
}

async function main() {
  const config = await loadAgentConfig();
  console.log(`Configuration: ${config.loadedPath}`);
  const errors = validateRuntimeConfig(config);
  for (const error of errors) console.log(`✗ ${error}`);

  if (config.telegramToken) {
    try {
      const me = await telegramRequest(config.telegramToken, 'getMe', {}, { timeoutMs: 10_000 });
      console.log(`✓ Telegram: @${me.username}`);
    } catch (error) {
      console.log(`✗ Telegram: ${error.message}`);
      errors.push('Telegram connection failed');
    }
  }

  for (const provider of config.providers) {
    const result = await checkProvider(provider, Math.min(config.requestTimeoutMs, 10_000));
    console.log(`${result.ok ? '✓' : '✗'} ${provider.label}: ${provider.model} — ${result.detail}`);
    if (provider.available && !result.ok) errors.push(`${provider.id} connection failed`);
  }

  if (errors.length) {
    console.log('\nDoctor found configuration problems. No chat requests were billed.');
    process.exitCode = 1;
  } else {
    console.log('\nGateway is ready. Start it with: npm run agent:start');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`Doctor failed: ${error.message}`);
    process.exitCode = 1;
  });
}
