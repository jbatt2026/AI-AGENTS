function joinUrl(baseUrl, pathname) {
  return `${baseUrl.replace(/\/$/, '')}${pathname}`;
}

async function readJson(response, providerId) {
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${providerId} returned a non-JSON response (${response.status})`);
  }
  if (!response.ok) {
    const detail = String(payload.error?.message || payload.message || response.statusText).slice(0, 500);
    throw new Error(`${providerId} request failed (${response.status}): ${detail}`);
  }
  return payload;
}

export function redactProviderError(error, provider) {
  let message = error instanceof Error ? error.message : String(error);
  const headerSecrets = Object.entries(provider.headers || {})
    .filter(([name, value]) => /authorization|api[-_]?key|token|secret|cookie/i.test(name) && typeof value === 'string' && value)
    .map(([, value]) => value);
  const secrets = [provider.apiKey, ...headerSecrets].filter((value) => typeof value === 'string' && value);
  for (const secret of secrets) message = message.split(secret).join('[REDACTED]');
  return message
    .replace(/(authorization\s*:\s*bearer\s+)[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/([?&](?:key|api_key|token)=)[^&\s]+/gi, '$1[REDACTED]')
    .slice(0, 600);
}

function contentToText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((part) => typeof part === 'string' ? part : part?.text || '').join('');
  }
  return '';
}

async function callOpenAICompatible(provider, messages, options) {
  const headers = { 'content-type': 'application/json', ...(provider.headers || {}) };
  if (provider.apiKey) headers.authorization = `Bearer ${provider.apiKey}`;
  const response = await options.fetchImpl(joinUrl(provider.baseUrl, '/chat/completions'), {
    method: 'POST',
    headers,
    body: JSON.stringify({ model: provider.model, messages }),
    signal: AbortSignal.timeout(options.timeoutMs),
  });
  const payload = await readJson(response, provider.id);
  const text = contentToText(payload.choices?.[0]?.message?.content).trim();
  if (!text) throw new Error(`${provider.id} returned an empty response`);
  return text;
}

async function callAnthropic(provider, messages, options) {
  const system = messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n\n');
  const conversation = messages.filter((message) => message.role !== 'system');
  const response = await options.fetchImpl(joinUrl(provider.baseUrl, '/v1/messages'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key': provider.apiKey,
      ...(provider.headers || {}),
    },
    body: JSON.stringify({ model: provider.model, system, max_tokens: provider.maxTokens || 4096, messages: conversation }),
    signal: AbortSignal.timeout(options.timeoutMs),
  });
  const payload = await readJson(response, provider.id);
  const text = contentToText(payload.content).trim();
  if (!text) throw new Error(`${provider.id} returned an empty response`);
  return text;
}

async function callGemini(provider, messages, options) {
  const systemText = messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n\n');
  const contents = messages
    .filter((message) => message.role !== 'system')
    .map((message) => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: message.content }],
    }));
  const url = new URL(joinUrl(provider.baseUrl, `/v1beta/models/${encodeURIComponent(provider.model)}:generateContent`));
  const body = { contents };
  if (systemText) body.systemInstruction = { parts: [{ text: systemText }] };
  const response = await options.fetchImpl(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-goog-api-key': provider.apiKey,
      ...(provider.headers || {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(options.timeoutMs),
  });
  const payload = await readJson(response, provider.id);
  const text = contentToText(payload.candidates?.[0]?.content?.parts).trim();
  if (!text) throw new Error(`${provider.id} returned an empty response`);
  return text;
}

export async function callProvider(provider, messages, options = {}) {
  const resolvedOptions = {
    fetchImpl: options.fetchImpl || globalThis.fetch,
    timeoutMs: options.timeoutMs || 60_000,
  };
  if (provider.type === 'openai-compatible') return callOpenAICompatible(provider, messages, resolvedOptions);
  if (provider.type === 'anthropic') return callAnthropic(provider, messages, resolvedOptions);
  if (provider.type === 'gemini') return callGemini(provider, messages, resolvedOptions);
  throw new Error(`Unsupported provider type: ${provider.type}`);
}

export class BrainRouter {
  constructor(providers, options = {}) {
    this.providers = providers;
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.timeoutMs = options.timeoutMs || 60_000;
  }

  list() {
    return this.providers.map(({ id, label, model, available }) => ({ id, label, model, available }));
  }

  async complete(messages, preferredProviderId) {
    const available = this.providers.filter((provider) => provider.available);
    const preferred = preferredProviderId && available.find((provider) => provider.id === preferredProviderId);
    const candidates = preferred ? [preferred, ...available.filter((provider) => provider !== preferred)] : available;
    if (candidates.length === 0) throw new Error('No configured brain provider is available');

    const failures = [];
    for (const provider of candidates) {
      try {
        const text = await callProvider(provider, messages, {
          fetchImpl: this.fetchImpl,
          timeoutMs: this.timeoutMs,
        });
        return { text, providerId: provider.id, model: provider.model, fallbackCount: failures.length };
      } catch (error) {
        failures.push(`${provider.id}: ${redactProviderError(error, provider)}`);
      }
    }
    throw new Error(`All brain providers failed: ${failures.join(' | ')}`);
  }
}
