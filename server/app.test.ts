import { describe, expect, it } from 'vitest';
import { createApp, type AppDeps } from './app';
import type { MessagesClient } from './agent';
import { WriteBudget } from './guardrails';

const textClient: MessagesClient = {
  messages: {
    stream() {
      let cb: (d: string) => void = () => {};
      return {
        on(_e, f) {
          cb = f;
          return this;
        },
        async finalMessage() {
          cb('hi there');
          return { content: [{ type: 'text', text: 'hi there', citations: null }] } as never;
        },
      };
    },
  },
};

const deps = (over: Partial<AppDeps> = {}): AppDeps => ({
  token: 'tok',
  allowedHosts: ['localhost:8787'],
  allowedOrigins: ['http://localhost:3000'],
  client: textClient,
  github: null,
  model: 'm',
  repo: null,
  budget: new WriteBudget(3),
  audit: () => {},
  auditLog: () => [],
  ...over,
});

const headers = (extra: Record<string, string> = {}) => ({
  host: 'localhost:8787',
  authorization: 'Bearer tok',
  'content-type': 'application/json',
  ...extra,
});

describe('api auth', () => {
  it('rejects missing/wrong token with 401', async () => {
    const app = createApp(deps());
    expect((await app.request('/api/health', { headers: { host: 'localhost:8787' } })).status).toBe(401);
    expect((await app.request('/api/health', { headers: headers({ authorization: 'Bearer nope' }) })).status).toBe(401);
  });
  it('rejects a foreign Host (DNS rebinding) and Origin', async () => {
    const app = createApp(deps());
    expect((await app.request('/api/health', { headers: headers({ host: 'evil.example' }) })).status).toBe(403);
    expect((await app.request('/api/health', { headers: headers({ origin: 'http://evil.example' }) })).status).toBe(403);
  });
  it('serves health to a valid caller', async () => {
    const res = await createApp(deps()).request('/api/health', { headers: headers({ origin: 'http://localhost:3000' }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ anthropic: true, github: false, budget: { limit: 3, remaining: 3 } });
  });
});

describe('chat', () => {
  it('validates input', async () => {
    const app = createApp(deps());
    const post = (b: unknown) => app.request('/api/chat', { method: 'POST', headers: headers(), body: JSON.stringify(b) });
    expect((await post({})).status).toBe(400);
    expect((await post({ message: 'x'.repeat(8001) })).status).toBe(413);
  });
  it('503s without an Anthropic key', async () => {
    const app = createApp(deps({ client: null }));
    const res = await app.request('/api/chat', { method: 'POST', headers: headers(), body: JSON.stringify({ message: 'a' }) });
    expect(res.status).toBe(503);
  });
  it('streams events as SSE', async () => {
    const app = createApp(deps());
    const res = await app.request('/api/chat', { method: 'POST', headers: headers(), body: JSON.stringify({ message: 'hello' }) });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('"type":"text"');
    expect(text).toContain('"reason":"end_turn"');
  });

  it('rejects a second concurrent chat instead of running both', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const slow: MessagesClient = {
      messages: {
        stream() {
          return {
            on() {
              return this;
            },
            async finalMessage() {
              await gate;
              return { content: [{ type: 'text', text: 'x', citations: null }] } as never;
            },
          };
        },
      },
    };
    const app = createApp(deps({ client: slow }));
    const post = () => app.request('/api/chat', { method: 'POST', headers: headers(), body: JSON.stringify({ message: 'a' }) });
    const [r1, r2] = await Promise.all([post(), post()]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    release();
    await Promise.all([r1.status === 200 ? r1.text() : r2.text()]);
    // slot is free again afterwards
    expect((await post()).status).toBe(200);
  });
});
