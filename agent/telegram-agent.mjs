import { pathToFileURL } from 'node:url';
import { loadAgentConfig, validateRuntimeConfig } from './config.mjs';
import { BrainRouter } from './providers.mjs';

const TELEGRAM_MESSAGE_LIMIT = 4096;

export function splitTelegramMessage(text, limit = 4000) {
  if (text.length <= limit) return [text];
  const chunks = [];
  let remaining = text;
  while (remaining.length > limit) {
    let splitAt = remaining.lastIndexOf('\n', limit);
    if (splitAt < limit * 0.5) splitAt = remaining.lastIndexOf(' ', limit);
    if (splitAt < limit * 0.5) splitAt = limit;
    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

export async function telegramRequest(token, method, payload, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const response = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(options.timeoutMs || 40_000),
  });
  const result = await response.json();
  if (!response.ok || !result.ok) {
    throw new Error(`Telegram ${method} failed (${response.status}): ${result.description || 'unknown error'}`);
  }
  return result.result;
}

export class TelegramAgent {
  constructor(config, options = {}) {
    this.config = config;
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.router = options.router || new BrainRouter(config.providers, {
      fetchImpl: this.fetchImpl,
      timeoutMs: config.requestTimeoutMs,
    });
    this.sessions = new Map();
    this.allowedUsers = new Set(config.allowedUsers.map(String));
    this.offset = 0;
    this.running = false;
  }

  sessionFor(chatId) {
    if (!this.sessions.has(chatId)) this.sessions.set(chatId, { history: [], providerId: undefined, lastModel: undefined });
    return this.sessions.get(chatId);
  }

  async api(method, payload) {
    return telegramRequest(this.config.telegramToken, method, payload, { fetchImpl: this.fetchImpl });
  }

  async send(chatId, text) {
    const safeText = text || 'The provider returned an empty response.';
    for (const chunk of splitTelegramMessage(safeText)) {
      await this.api('sendMessage', { chat_id: chatId, text: chunk });
    }
  }

  providerSummary(session) {
    return this.router.list().map((provider) => {
      const selected = session.providerId === provider.id ? '→ ' : '  ';
      const state = provider.available ? 'ready' : 'missing credentials';
      return `${selected}${provider.id} — ${provider.model} (${state})`;
    }).join('\n');
  }

  async handleCommand(chatId, text) {
    const [rawCommand, ...args] = text.trim().split(/\s+/);
    const command = rawCommand.toLowerCase().split('@')[0];
    const session = this.sessionFor(chatId);

    if (command === '/start' || command === '/help') {
      await this.send(chatId,
        'AI Agent Gateway\n\n' +
        'Send a message to talk to the configured brain. If the selected provider fails, the next ready provider is tried automatically.\n\n' +
        '/new — clear this chat session\n' +
        '/model — list brain providers\n' +
        '/model <id> — prefer a provider\n' +
        '/status — show session and routing status\n' +
        '/help — show this message'
      );
      return true;
    }

    if (command === '/new') {
      session.history = [];
      session.lastModel = undefined;
      await this.send(chatId, 'Started a fresh conversation. Your provider preference is unchanged.');
      return true;
    }

    if (command === '/model' || command === '/providers') {
      if (args.length === 0) {
        await this.send(chatId, `Brain providers:\n${this.providerSummary(session)}\n\nUse /model <id> to choose one.`);
        return true;
      }
      const provider = this.router.list().find((item) => item.id === args[0].toLowerCase());
      if (!provider) {
        await this.send(chatId, `Unknown provider "${args[0]}".\n\n${this.providerSummary(session)}`);
      } else if (!provider.available) {
        await this.send(chatId, `${provider.label} is missing its configured API key.`);
      } else {
        session.providerId = provider.id;
        await this.send(chatId, `Preferred brain set to ${provider.label} (${provider.model}).`);
      }
      return true;
    }

    if (command === '/status') {
      await this.send(chatId,
        `Session messages: ${session.history.length}\n` +
        `Preferred provider: ${session.providerId || 'automatic'}\n` +
        `Last model: ${session.lastModel || 'none'}\n` +
        `Ready providers: ${this.router.list().filter((provider) => provider.available).length}`
      );
      return true;
    }
    return false;
  }

  async handleMessage(message) {
    const chatId = message.chat?.id;
    const userId = String(message.from?.id || '');
    const text = message.text?.trim();
    if (!chatId || !text) return;

    // Fail silently for untrusted senders to avoid becoming a discovery or
    // response-amplification oracle. Group replies are opt-in because every
    // member of a group can read the authorized user's agent output.
    if (!this.allowedUsers.has(userId)) return;
    if (message.chat?.type !== 'private' && !this.config.allowGroups) return;

    if (text.startsWith('/') && await this.handleCommand(chatId, text)) return;

    const session = this.sessionFor(chatId);
    await this.api('sendChatAction', { chat_id: chatId, action: 'typing' });
    const messages = [
      { role: 'system', content: this.config.systemPrompt },
      ...session.history,
      { role: 'user', content: text },
    ];

    try {
      const result = await this.router.complete(messages, session.providerId);
      session.history.push({ role: 'user', content: text }, { role: 'assistant', content: result.text });
      session.history = session.history.slice(-this.config.historyLimit);
      session.lastModel = `${result.providerId}/${result.model}`;
      const fallbackNotice = result.fallbackCount > 0 ? `\n\n↪ Routed through ${result.providerId} after ${result.fallbackCount} provider failure(s).` : '';
      await this.send(chatId, `${result.text}${fallbackNotice}`);
    } catch (error) {
      console.error(`[agent] chat ${chatId} failed: ${error.message}`);
      await this.send(chatId, 'Every configured brain provider failed. Run `npm run agent:doctor` on the host for details.');
    }
  }

  async processUpdate(update) {
    if (update.message) await this.handleMessage(update.message);
  }

  async run() {
    this.running = true;
    const me = await this.api('getMe', {});
    console.log(`[agent] Telegram gateway connected as @${me.username}`);
    console.log(`[agent] ${this.router.list().filter((provider) => provider.available).length} brain provider(s) ready`);

    while (this.running) {
      try {
        const updates = await this.api('getUpdates', {
          offset: this.offset,
          timeout: 30,
          allowed_updates: ['message'],
        });
        for (const update of updates) {
          this.offset = update.update_id + 1;
          await this.processUpdate(update);
        }
      } catch (error) {
        if (!this.running) break;
        console.error(`[agent] polling error: ${error.message}`);
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      }
    }
  }

  stop() {
    this.running = false;
  }
}

async function main() {
  const config = await loadAgentConfig();
  const errors = validateRuntimeConfig(config);
  if (errors.length) {
    console.error('Agent configuration is incomplete:\n- ' + errors.join('\n- '));
    console.error('\nRun `npm run agent:setup`, then `npm run agent:doctor`.');
    process.exitCode = 1;
    return;
  }

  const agent = new TelegramAgent(config);
  process.once('SIGINT', () => agent.stop());
  process.once('SIGTERM', () => agent.stop());
  await agent.run();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`[agent] startup failed: ${error.message}`);
    process.exitCode = 1;
  });
}

export { TELEGRAM_MESSAGE_LIMIT };
