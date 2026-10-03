export type AgentEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool_call'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; id: string; text: string; isError: boolean }
  | { type: 'done'; reason: 'end_turn' | 'max_iterations' | 'aborted' }
  | { type: 'error'; message: string };

export interface Health {
  anthropic: boolean;
  github: boolean;
  model: string;
  repo: string | null;
  budget: { limit: number; remaining: number };
  busy: boolean;
  messages: number;
}

export interface LogEntry {
  at: string;
  tool: string;
  isError: boolean;
  ms: number;
  input: Record<string, unknown>;
}

/** Splits an SSE buffer into complete `data:` payloads plus the unfinished remainder. */
export function parseSSE(buffer: string): { events: AgentEvent[]; rest: string } {
  const frames = buffer.split('\n\n');
  const rest = frames.pop() ?? '';
  const events: AgentEvent[] = [];
  for (const frame of frames) {
    const data = frame
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trimStart())
      .join('\n');
    if (!data) continue;
    try {
      events.push(JSON.parse(data) as AgentEvent);
    } catch {
      // A malformed frame is dropped rather than breaking the stream.
    }
  }
  return { events, rest };
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, init);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

const post = (path: string, body?: unknown) =>
  api<Record<string, unknown>>(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

export const getHealth = () => api<Health>('/health');
export const getLog = () => api<LogEntry[]>('/log');
export const stopTurn = () => post('/stop');
export const resetChat = () => post('/reset');
export const resetBudget = () => post('/budget/reset');

export async function streamChat(
  message: string,
  onEvent: (e: AgentEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message }),
    signal,
  });
  if (!res.ok || !res.body) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
    const parsed = parseSSE(buffer);
    buffer = parsed.rest;
    parsed.events.forEach(onEvent);
  }
}
