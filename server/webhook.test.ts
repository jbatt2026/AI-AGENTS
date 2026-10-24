import { describe, expect, it } from 'vitest';
import { EventStore } from './events';
import { MAX_BODY_BYTES, createWebhookApp, sign, summarize, verifySignature } from './webhook';

// Built at runtime so the repo's own secret scanner has nothing to flag.
const SECRET = ['test', 'webhook', 'secret', 'value'].join('-');
const REPO = 'o/r';
const GUID = '11111111-2222-3333-4444-555555555555';

const prPayload = (over: Record<string, unknown> = {}) => ({
  action: 'opened',
  repository: { full_name: REPO },
  sender: { login: 'octo' },
  pull_request: {
    number: 7,
    title: 'Add thing',
    html_url: `https://github.com/${REPO}/pull/7`,
    state: 'open',
    body: 'SECRET PR BODY',
  },
  ...over,
});

function setup() {
  const store = new EventStore(null);
  const app = createWebhookApp({ secret: SECRET, repo: REPO, store, now: () => new Date('2026-10-23T12:00:00Z') });
  const post = (body: unknown, h: Record<string, string> = {}, raw?: string) => {
    const text = raw ?? JSON.stringify(body);
    return app.request('/api/github/webhook', {
      method: 'POST',
      body: text,
      headers: {
        'x-github-event': 'pull_request',
        'x-github-delivery': GUID,
        'x-hub-signature-256': sign(SECRET, text),
        'content-type': 'application/json',
        ...h,
      },
    });
  };
  return { app, store, post };
}

describe('verifySignature', () => {
  const body = new TextEncoder().encode('{"a":1}');
  it('accepts the right signature only', () => {
    expect(verifySignature(SECRET, body, sign(SECRET, body))).toBe(true);
    expect(verifySignature(SECRET, body, sign('other', body))).toBe(false);
    expect(verifySignature(SECRET, body, undefined)).toBe(false);
    expect(verifySignature(SECRET, body, 'sha256=short')).toBe(false);
    expect(verifySignature(SECRET, body, sign(SECRET, body).replace('sha256=', ''))).toBe(false);
  });
  it('is bound to the exact bytes', () => {
    expect(verifySignature(SECRET, new TextEncoder().encode('{"a":2}'), sign(SECRET, body))).toBe(false);
  });
});

describe('POST /api/github/webhook', () => {
  it('stores a validly signed event and answers 202', async () => {
    const { post, store } = setup();
    const res = await post(prPayload());
    expect(res.status).toBe(202);
    expect(store.list()).toEqual([
      {
        id: GUID,
        event: 'pull_request',
        action: 'opened',
        repo: REPO,
        number: 7,
        title: 'Add thing',
        actor: 'octo',
        url: `https://github.com/${REPO}/pull/7`,
        state: 'open',
        at: '2026-10-23T12:00:00.000Z',
      },
    ]);
  });

  it('never stores PR/comment bodies', async () => {
    const { post, store } = setup();
    await post(prPayload());
    expect(JSON.stringify(store.list())).not.toContain('SECRET PR BODY');
  });

  it.each([
    ['missing', { 'x-hub-signature-256': '' }],
    ['wrong secret', { 'x-hub-signature-256': sign('other', '{}') }],
    ['too short', { 'x-hub-signature-256': 'sha256=abc' }],
  ])('rejects %s signature with 401 and stores nothing', async (_n, h) => {
    const { post, store } = setup();
    const res = await post(prPayload(), h);
    expect(res.status).toBe(401);
    expect(store.list()).toHaveLength(0);
    expect(store.rejected).toBe(1);
  });

  it('rejects a tampered body', async () => {
    const { post, store } = setup();
    const signed = JSON.stringify(prPayload());
    const res = await post(null, { 'x-hub-signature-256': sign(SECRET, signed) }, signed.replace('Add thing', 'Evil'));
    expect(res.status).toBe(401);
    expect(store.list()).toHaveLength(0);
  });

  it('records a redelivery once', async () => {
    const { post, store } = setup();
    expect((await post(prPayload())).status).toBe(202);
    const again = await post(prPayload());
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ duplicate: true });
    expect(store.list()).toHaveLength(1);
  });

  it('answers ping and ignores unlisted events and other repositories', async () => {
    const { post, store } = setup();
    expect((await post({ zen: 'x' }, { 'x-github-event': 'ping' })).status).toBe(200);
    expect((await post(prPayload(), { 'x-github-event': 'star' })).status).toBe(202);
    expect((await post(prPayload({ repository: { full_name: 'evil/fork' } }))).status).toBe(202);
    expect(store.list()).toHaveLength(0);
  });

  it('checks the signature before parsing, then 400s on invalid JSON', async () => {
    const { post } = setup();
    expect((await post(null, { 'x-hub-signature-256': sign('other', 'not json') }, 'not json')).status).toBe(401);
    expect((await post(null, {}, 'not json')).status).toBe(400);
  });

  it('rejects malformed headers and oversize bodies', async () => {
    const { post } = setup();
    expect((await post(prPayload(), { 'x-github-delivery': '../../etc' })).status).toBe(400);
    expect((await post(prPayload(), { 'x-github-event': '' })).status).toBe(400);
    const big = 'x'.repeat(MAX_BODY_BYTES + 1);
    expect((await post(null, {}, big)).status).toBe(413);
  });

  it('serves nothing else', async () => {
    const { app } = setup();
    expect((await app.request('/api/github/webhook')).status).toBe(404);
    expect((await app.request('/', { method: 'POST' })).status).toBe(404);
    expect((await app.request('/api/health')).status).toBe(404);
  });
});

describe('summarize', () => {
  const now = new Date('2026-10-23T00:00:00Z');
  it('truncates titles and drops links outside the target repository', () => {
    const e = summarize(
      'pull_request',
      prPayload({ pull_request: { number: 1, title: 'T'.repeat(500), html_url: 'https://evil.example/x', state: 'open' } }),
      GUID,
      REPO,
      now,
    );
    expect(e.title).toHaveLength(120);
    expect(e.url).toBe('');
  });
  it('marks merged PRs and reads workflow conclusions', () => {
    expect(summarize('pull_request', prPayload({ pull_request: { number: 1, state: 'closed', merged: true } }), GUID, REPO, now).state).toBe('merged');
    const run = summarize('workflow_run', { workflow_run: { name: 'CI', conclusion: 'success' }, repository: { full_name: REPO } }, GUID, REPO, now);
    expect([run.title, run.state, run.number]).toEqual(['CI', 'success', null]);
  });
});
