import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';

const PROVIDER_TYPES = new Set(['openai-compatible', 'anthropic', 'gemini']);
const SENSITIVE_HEADERS = new Set([
  'authorization',
  'cookie',
  'proxy-authorization',
  'set-cookie',
  'x-api-key',
  'x-goog-api-key',
]);
const SENSITIVE_HEADER_TERMS = ['apikey', 'authorization', 'cookie', 'credential', 'password', 'secret', 'token'];

function isLoopbackHost(hostname) {
  return hostname === 'localhost' || hostname === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(hostname);
}

export function parseEnv(text) {
  const values = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1).replace(/\\n/g, '\n');
    }
    values[key] = value;
  }
  return values;
}

async function loadLocalEnv(rootDir) {
  const envPath = path.join(rootDir, '.env.local');
  try {
    const fileStat = await lstat(envPath);
    if (fileStat.isSymbolicLink()) throw new Error('.env.local must not be a symbolic link');
    if (process.platform !== 'win32' && (fileStat.mode & 0o077) !== 0) {
      throw new Error('.env.local permissions are too broad; run `chmod 600 .env.local`');
    }
    return parseEnv(await readFile(envPath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

function validateProvider(provider, index) {
  const prefix = `providers[${index}]`;
  if (!provider || typeof provider !== 'object') throw new Error(`${prefix} must be an object`);
  if (typeof provider.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(provider.id)) {
    throw new Error(`${prefix}.id must use lowercase letters, numbers, and hyphens`);
  }
  if (!PROVIDER_TYPES.has(provider.type)) throw new Error(`${prefix}.type is unsupported`);
  if (typeof provider.baseUrl !== 'string' || !provider.baseUrl.trim()
      || typeof provider.model !== 'string' || !provider.model.trim()) {
    throw new Error(`${prefix} requires baseUrl and model as non-empty strings`);
  }
  let parsedUrl;
  try {
    parsedUrl = new URL(provider.baseUrl);
  } catch {
    throw new Error(`${prefix}.baseUrl must be an absolute URL`);
  }
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error(`${prefix}.baseUrl must use HTTP or HTTPS`);
  if (parsedUrl.username || parsedUrl.password) throw new Error(`${prefix}.baseUrl must not contain credentials`);
  if (parsedUrl.protocol === 'http:' && !isLoopbackHost(parsedUrl.hostname)) {
    throw new Error(`${prefix}.baseUrl must use HTTPS unless it targets a loopback address`);
  }
  if (provider.apiKeyEnv && !/^[A-Z][A-Z0-9_]*$/.test(provider.apiKeyEnv)) {
    throw new Error(`${prefix}.apiKeyEnv must be an uppercase environment variable name`);
  }
  if ((provider.type === 'anthropic' || provider.type === 'gemini') && !provider.apiKeyEnv) {
    throw new Error(`${prefix}.apiKeyEnv is required for ${provider.type} providers`);
  }
  if (provider.headers !== undefined) {
    if (!provider.headers || typeof provider.headers !== 'object' || Array.isArray(provider.headers)) {
      throw new Error(`${prefix}.headers must be an object`);
    }
    for (const [name, value] of Object.entries(provider.headers)) {
      const normalizedName = name.toLowerCase();
      const compactName = normalizedName.replace(/[^a-z0-9]/g, '');
      if (SENSITIVE_HEADERS.has(normalizedName) || SENSITIVE_HEADER_TERMS.some((term) => compactName.includes(term))) {
        throw new Error(`${prefix}.headers must not contain credential header ${name}; use apiKeyEnv`);
      }
      if (typeof value !== 'string') throw new Error(`${prefix}.headers.${name} must be a string`);
    }
  }
}

export async function loadAgentConfig(options = {}) {
  const rootDir = options.rootDir || process.cwd();
  const localEnv = await loadLocalEnv(rootDir);
  const env = { ...localEnv, ...process.env, ...options.env };
  const requestedPath = env.AGENT_CONFIG || options.configPath || 'agent.config.json';
  const configPath = path.resolve(rootDir, requestedPath);
  let rawConfig;
  let loadedPath = configPath;

  try {
    rawConfig = await readFile(configPath, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT' || requestedPath !== 'agent.config.json') throw error;
    loadedPath = path.join(rootDir, 'agent.config.example.json');
    rawConfig = await readFile(loadedPath, 'utf8');
  }

  let config;
  try {
    config = JSON.parse(rawConfig);
  } catch (error) {
    throw new Error(`Invalid JSON in ${loadedPath}: ${error.message}`);
  }

  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error(`Invalid configuration in ${loadedPath}: root must be an object`);
  }
  if (!Array.isArray(config.providers) || config.providers.length === 0) {
    throw new Error('Agent configuration needs at least one provider');
  }
  config.providers.forEach(validateProvider);
  if (new Set(config.providers.map((provider) => provider.id)).size !== config.providers.length) {
    throw new Error('Provider ids must be unique');
  }

  const historyLimit = Number(config.historyLimit ?? 24);
  const requestTimeoutMs = Number(config.requestTimeoutMs ?? 60_000);
  if (!Number.isInteger(historyLimit) || historyLimit < 2 || historyLimit > 100) {
    throw new Error('historyLimit must be an integer between 2 and 100');
  }
  if (!Number.isFinite(requestTimeoutMs) || requestTimeoutMs < 1_000 || requestTimeoutMs > 300_000) {
    throw new Error('requestTimeoutMs must be between 1000 and 300000');
  }

  const allowedUsers = (env.TELEGRAM_ALLOWED_USERS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  return {
    ...config,
    historyLimit,
    requestTimeoutMs,
    systemPrompt: config.systemPrompt || 'You are a helpful AI assistant.',
    providers: config.providers.map((provider) => ({
      ...provider,
      label: provider.label || provider.id,
      apiKey: provider.apiKeyEnv ? env[provider.apiKeyEnv] : undefined,
      available: !provider.apiKeyEnv || Boolean(env[provider.apiKeyEnv]),
    })),
    telegramToken: env.TELEGRAM_BOT_TOKEN,
    allowedUsers,
    allowGroups: /^(1|true|yes)$/i.test(env.TELEGRAM_ALLOW_GROUPS || ''),
    loadedPath,
  };
}

export function validateRuntimeConfig(config) {
  const errors = [];
  if (!config.telegramToken) errors.push('TELEGRAM_BOT_TOKEN is not set');
  if (config.allowedUsers.length === 0) errors.push('TELEGRAM_ALLOWED_USERS must contain at least one Telegram user id');
  if (!config.providers.some((provider) => provider.available)) {
    errors.push('No provider is available; set a configured API key or enable a local provider');
  }
  return errors;
}
