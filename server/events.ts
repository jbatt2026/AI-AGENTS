import { appendFileSync, existsSync, readFileSync } from 'node:fs';

export interface WebhookEvent {
  /** X-GitHub-Delivery GUID: the idempotency key. */
  id: string;
  event: string;
  action: string;
  repo: string;
  number: number | null;
  title: string;
  actor: string;
  /** Only ever an https://github.com/<repo>/… link, else "". */
  url: string;
  state: string;
  at: string;
}

const SEEN_LIMIT = 5000;

/** Recent webhook events, deduplicated by delivery id and persisted as JSON lines. */
export class EventStore {
  private ring: WebhookEvent[] = [];
  private seen = new Set<string>();
  private invalid = 0;

  constructor(
    private readonly path: string | null,
    private readonly cap = 200,
  ) {
    if (path && existsSync(path)) this.load(path);
  }

  private load(path: string): void {
    // Rehydrating the seen-set means a restart does not re-record a redelivery.
    const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean).slice(-SEEN_LIMIT);
    for (const line of lines) {
      try {
        const e = JSON.parse(line) as WebhookEvent;
        this.remember(e);
      } catch {
        // Skip a torn line rather than refusing to start.
      }
    }
  }

  private remember(e: WebhookEvent): void {
    this.seen.add(e.id);
    this.ring.push(e);
    if (this.ring.length > this.cap) this.ring.shift();
    if (this.seen.size > SEEN_LIMIT) this.seen.delete(this.seen.values().next().value as string);
  }

  has(id: string): boolean {
    return this.seen.has(id);
  }

  add(e: WebhookEvent): void {
    this.remember(e);
    if (!this.path) return;
    try {
      appendFileSync(this.path, JSON.stringify(e) + '\n');
    } catch {
      // The in-memory ring still serves the GUI.
    }
  }

  /** Newest first. */
  list(): WebhookEvent[] {
    return [...this.ring].reverse();
  }

  /** Counted rather than logged, so a flood of bad requests cannot fill the disk. */
  reject(): void {
    this.invalid += 1;
  }

  get rejected(): number {
    return this.invalid;
  }

  get lastEventAt(): string | null {
    return this.ring.at(-1)?.at ?? null;
  }
}
