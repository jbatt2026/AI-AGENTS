import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { EventStore, type WebhookEvent } from './events';

const ev = (id: string, at = '2026-10-23T00:00:00.000Z'): WebhookEvent => ({
  id,
  event: 'push',
  action: '',
  repo: 'o/r',
  number: null,
  title: 'refs/heads/x',
  actor: 'a',
  url: '',
  state: 'push',
  at,
});

let dir = '';
afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));
const tmp = () => (dir = mkdtempSync(join(tmpdir(), 'events-')));

describe('EventStore', () => {
  it('lists newest first and caps the ring', () => {
    const s = new EventStore(null, 3);
    ['a', 'b', 'c', 'd'].forEach((id) => s.add(ev(id)));
    expect(s.list().map((e) => e.id)).toEqual(['d', 'c', 'b']);
    expect(s.has('d')).toBe(true);
  });

  it('persists and rehydrates so a restart does not re-record a redelivery', () => {
    const path = join(tmp(), 'e.jsonl');
    const first = new EventStore(path);
    first.add(ev('one'));
    first.add(ev('two'));
    const second = new EventStore(path);
    expect(second.has('one')).toBe(true);
    expect(second.list().map((e) => e.id)).toEqual(['two', 'one']);
    expect(readFileSync(path, 'utf8').trim().split('\n')).toHaveLength(2);
  });

  it('skips a torn line instead of failing to start', () => {
    const path = join(tmp(), 'e.jsonl');
    writeFileSync(path, JSON.stringify(ev('ok')) + '\n{"id":"tor');
    expect(new EventStore(path).list().map((e) => e.id)).toEqual(['ok']);
  });

  it('counts rejected requests', () => {
    const s = new EventStore(null);
    s.reject();
    s.reject();
    expect(s.rejected).toBe(2);
    expect(s.lastEventAt).toBeNull();
  });
});
