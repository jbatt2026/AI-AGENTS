import { timingSafeEqual } from 'node:crypto';
import type Anthropic from '@anthropic-ai/sdk';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { runTurn, type AgentEvent, type MessagesClient } from './agent';
import { WriteBudget } from './guardrails';
import type { GitHubPort } from './github';

export const MAX_MESSAGE_CHARS = 8000;
export const MAX_HISTORY = 80;

export interface AppDeps {
  token: string;
  /** Host header values and browser Origins allowed to reach the API. */
  allowedHosts: string[];
  allowedOrigins: string[];
  client: MessagesClient | null;
  github: GitHubPort | null;
  model: string;
  repo: string | null;
  budget: WriteBudget;
  audit: (entry: Record<string, unknown>) => void;
  auditLog: () => Record<string, unknown>[];
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function createApp(d: AppDeps) {
  const app = new Hono();
  let history: Anthropic.MessageParam[] = [];
  let running: AbortController | null = null;

  // DNS-rebinding and cross-site defence, then a bearer token. The token stops other users and
  // direct hits on this port; it does not stop a process of the same user, which can read the token
  // file or call the Vite proxy.
  app.use('/api/*', async (c, next) => {
    if (!d.allowedHosts.includes(c.req.header('host') ?? '')) return c.json({ error: 'bad host' }, 403);
    const origin = c.req.header('origin');
    if (origin && !d.allowedOrigins.includes(origin)) return c.json({ error: 'bad origin' }, 403);
    const auth = c.req.header('authorization') ?? '';
    if (!auth.startsWith('Bearer ') || !safeEqual(auth.slice(7), d.token)) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    await next();
  });

  app.get('/api/health', (c) =>
    c.json({
      anthropic: d.client !== null,
      github: d.github !== null,
      model: d.model,
      repo: d.repo,
      budget: { limit: d.budget.limit, remaining: d.budget.remaining },
      busy: running !== null,
      messages: history.length,
    }),
  );

  app.get('/api/log', (c) => c.json(d.auditLog()));

  app.post('/api/stop', (c) => {
    running?.abort();
    return c.json({ stopped: running !== null });
  });

  app.post('/api/reset', (c) => {
    if (running) return c.json({ error: 'a turn is running; stop it first' }, 409);
    history = [];
    return c.json({ ok: true });
  });

  app.post('/api/budget/reset', (c) => {
    d.budget.reset();
    return c.json({ remaining: d.budget.remaining });
  });

  app.post('/api/chat', async (c) => {
    if (!d.client) return c.json({ error: 'ANTHROPIC_API_KEY is not set on the server' }, 503);
    // Claim the slot before the first await: otherwise two requests can both pass this check.
    if (running) return c.json({ error: 'a turn is already running' }, 409);
    const ac = new AbortController();
    running = ac;
    const release = () => {
      if (running === ac) running = null;
    };

    const body = (await c.req.json().catch(() => null)) as { message?: unknown } | null;
    const message = body?.message;
    if (typeof message !== 'string' || !message.trim()) {
      release();
      return c.json({ error: 'message required' }, 400);
    }
    if (message.length > MAX_MESSAGE_CHARS) {
      release();
      return c.json({ error: 'message too long' }, 413);
    }
    if (history.length >= MAX_HISTORY) {
      release();
      return c.json({ error: 'conversation too long; start a new chat' }, 413);
    }

    const client = d.client;
    const mark = history.length;
    history.push({ role: 'user', content: message });

    return streamSSE(c, async (stream) => {
      // Writes are chained so events keep their order and all land before the stream closes.
      let queue: Promise<unknown> = Promise.resolve();
      const send = (e: AgentEvent) => {
        queue = queue.then(() => stream.writeSSE({ data: JSON.stringify(e) }));
        return queue;
      };
      stream.onAbort(() => ac.abort());
      try {
        await runTurn({
          client,
          model: d.model,
          history,
          ctx: { github: d.github, budget: d.budget, audit: d.audit },
          emit: (e) => void send(e),
          signal: ac.signal,
        });
      } catch (err) {
        // Completed tool pairs stay in the history so the model still knows which writes
        // happened; only a turn that made no progress drops its user message.
        if (history.length === mark + 1) history.length = mark;
        await send({ type: 'error', message: err instanceof Error ? err.message : String(err) });
      } finally {
        release();
        await queue;
      }
    });
  });

  return app;
}
