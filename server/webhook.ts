import { createHmac } from 'node:crypto';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { EventStore, WebhookEvent } from './events';
import { safeEqual } from './util';

export const MAX_BODY_BYTES = 1_000_000;
export const ALLOWED_EVENTS = new Set(['pull_request', 'pull_request_review', 'issue_comment', 'workflow_run', 'push']);

const DELIVERY_RE = /^[0-9a-fA-F-]{8,64}$/;

/** HMAC-SHA256 of the raw body, as GitHub sends it in X-Hub-Signature-256. */
export function sign(secret: string, body: Uint8Array | string): string {
  return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
}

export function verifySignature(secret: string, body: Uint8Array, header: string | undefined): boolean {
  if (!header || !header.startsWith('sha256=')) return false;
  return safeEqual(header, sign(secret, body));
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' ? (v as Json) : {});
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/**
 * Reduces a payload to a small fixed shape. Comment and review bodies are deliberately dropped:
 * they are untrusted text and nothing here needs them. Titles are truncated and only ever
 * rendered as plain text.
 */
export function summarize(event: string, p: Json, id: string, repo: string, now: Date): WebhookEvent {
  const pr = obj(p.pull_request);
  const issue = obj(p.issue);
  const run = obj(p.workflow_run);
  let number: number | null = null;
  let title = '';
  let url = '';
  let state = '';

  switch (event) {
    case 'pull_request':
      number = typeof pr.number === 'number' ? pr.number : null;
      title = str(pr.title);
      url = str(pr.html_url);
      state = pr.merged === true ? 'merged' : str(pr.state);
      break;
    case 'pull_request_review':
      number = typeof pr.number === 'number' ? pr.number : null;
      title = str(pr.title);
      url = str(pr.html_url);
      state = str(obj(p.review).state).toLowerCase();
      break;
    case 'issue_comment':
      number = typeof issue.number === 'number' ? issue.number : null;
      title = str(issue.title);
      url = str(issue.html_url);
      state = 'comment';
      break;
    case 'workflow_run':
      title = str(run.name);
      url = str(run.html_url);
      state = str(run.conclusion) || str(run.status);
      break;
    case 'push':
      title = str(p.ref);
      url = str(p.compare);
      state = 'push';
      break;
  }

  return {
    id,
    event,
    action: str(p.action),
    repo,
    number,
    title: title.slice(0, 120),
    actor: str(obj(p.sender).login).slice(0, 60),
    url: url.startsWith(`https://github.com/${repo}/`) ? url : '',
    state: state.slice(0, 40),
    at: now.toISOString(),
  };
}

export interface WebhookDeps {
  secret: string;
  /** owner/repo; deliveries for any other repository are ignored. */
  repo: string;
  store: EventStore;
  now?: () => Date;
}

/** Receiver for GitHub App webhooks. Serves exactly one route; everything else is 404. */
export function createWebhookApp(d: WebhookDeps) {
  const app = new Hono();
  const now = d.now ?? (() => new Date());

  app.post(
    '/api/github/webhook',
    bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => c.json({ error: 'payload too large' }, 413) }),
    async (c) => {
      const event = c.req.header('x-github-event') ?? '';
      const delivery = c.req.header('x-github-delivery') ?? '';
      if (!event || !DELIVERY_RE.test(delivery)) {
        d.store.reject();
        return c.json({ error: 'missing or malformed GitHub headers' }, 400);
      }

      // Verify against the exact bytes received, before parsing anything.
      const raw = new Uint8Array(await c.req.arrayBuffer());
      if (!verifySignature(d.secret, raw, c.req.header('x-hub-signature-256'))) {
        d.store.reject();
        return c.json({ error: 'invalid signature' }, 401);
      }

      if (event === 'ping') return c.json({ ok: true, pong: true });
      if (!ALLOWED_EVENTS.has(event)) return c.json({ ignored: 'event not handled' }, 202);

      let payload: Json;
      try {
        payload = obj(JSON.parse(new TextDecoder().decode(raw)));
      } catch {
        return c.json({ error: 'invalid JSON' }, 400);
      }

      if (str(obj(payload.repository).full_name) !== d.repo) return c.json({ ignored: 'other repository' }, 202);

      // GitHub retries deliveries; the delivery GUID makes the effect happen once.
      if (d.store.has(delivery)) return c.json({ ok: true, duplicate: true });

      d.store.add(summarize(event, payload, delivery, d.repo, now()));
      return c.json({ ok: true }, 202);
    },
  );

  return app;
}
