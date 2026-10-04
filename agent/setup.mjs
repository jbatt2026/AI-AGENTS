import { chmod, readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PROVIDERS = [
  { id: 'openrouter', label: 'OpenRouter', type: 'openai-compatible', baseUrl: 'https://openrouter.ai/api/v1', model: 'anthropic/claude-sonnet-4.6', apiKeyEnv: 'OPENROUTER_API_KEY' },
  { id: 'openai', label: 'OpenAI', type: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', model: 'gpt-5-mini', apiKeyEnv: 'OPENAI_API_KEY' },
  { id: 'anthropic', label: 'Anthropic', type: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-4-6', apiKeyEnv: 'ANTHROPIC_API_KEY' },
  { id: 'gemini', label: 'Google Gemini', type: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com', model: 'gemini-2.5-flash', apiKeyEnv: 'GEMINI_API_KEY' },
  { id: 'ollama', label: 'Local Ollama', type: 'openai-compatible', baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen3:8b' },
];

function envLine(key, value) {
  return `${key}=${JSON.stringify(value)}`;
}

export function updateEnvText(existing, updates) {
  const pending = new Map(Object.entries(updates));
  const lines = existing ? existing.split(/\r?\n/) : [];
  const result = lines.map((line) => {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=/);
    if (!match || !pending.has(match[1])) return line;
    const value = pending.get(match[1]);
    pending.delete(match[1]);
    return envLine(match[1], value);
  });
  if (result.length && result.at(-1) !== '') result.push('');
  for (const [key, value] of pending) result.push(envLine(key, value));
  return `${result.join('\n').replace(/\n+$/, '')}\n`;
}

async function main() {
  const rl = createInterface({ input, output });
  console.log('\nAI Agent Gateway setup\n');
  console.log('This creates ignored local configuration. Credentials are never written to the tracked example files.\n');

  try {
    const telegramToken = (await rl.question('Telegram BotFather token (input is visible; leave blank to set later): ')).trim();
    const allowedUsers = (await rl.question('Allowed Telegram user ids (comma separated): ')).trim();
    console.log('\nBrain providers (ordered fallback):');
    PROVIDERS.forEach((provider, index) => console.log(`  ${index + 1}. ${provider.label} — ${provider.model}`));
    const selection = (await rl.question('\nSelect one or more (example: 1,3,5) [1,5]: ')).trim() || '1,5';
    const indexes = [...new Set(selection.split(',').map((value) => Number(value.trim()) - 1))];
    if (indexes.some((index) => !Number.isInteger(index) || !PROVIDERS[index])) throw new Error('Provider selection is invalid');

    const providers = [];
    const envUpdates = {};
    if (telegramToken) envUpdates.TELEGRAM_BOT_TOKEN = telegramToken;
    if (allowedUsers) envUpdates.TELEGRAM_ALLOWED_USERS = allowedUsers;
    for (const index of indexes) {
      const provider = { ...PROVIDERS[index] };
      const model = (await rl.question(`${provider.label} model [${provider.model}]: `)).trim();
      if (model) provider.model = model;
      if (provider.apiKeyEnv) {
        const key = (await rl.question(`${provider.apiKeyEnv} (input is visible; leave blank to set later): `)).trim();
        if (key) envUpdates[provider.apiKeyEnv] = key;
      }
      providers.push(provider);
    }

    const rootDir = process.cwd();
    const config = {
      systemPrompt: 'You are a capable, careful personal AI agent. Be concise, say when you are uncertain, and never claim that an action succeeded unless you verified it.',
      historyLimit: 24,
      requestTimeoutMs: 60000,
      providers,
    };
    await writeFile(path.join(rootDir, 'agent.config.json'), `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
    await chmod(path.join(rootDir, 'agent.config.json'), 0o600);
    let existingEnv = '';
    try {
      existingEnv = await readFile(path.join(rootDir, '.env.local'), 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    await writeFile(path.join(rootDir, '.env.local'), updateEnvText(existingEnv, envUpdates), { mode: 0o600 });
    await chmod(path.join(rootDir, '.env.local'), 0o600);
    console.log('\n✓ Wrote agent.config.json and .env.local (both ignored by git)');
    console.log('Next: npm run agent:doctor && npm run agent:start\n');
  } finally {
    rl.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`Setup failed: ${error.message}`);
    process.exitCode = 1;
  });
}
