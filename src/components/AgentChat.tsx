import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Bot, ChevronDown, ChevronRight, RotateCcw, Send, Square, Wrench } from 'lucide-react';
import {
  getHealth,
  getLog,
  resetBudget,
  resetChat,
  stopTurn,
  streamChat,
  type AgentEvent,
  type Health,
  type LogEntry,
} from '../lib/agentClient';

type Item =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'tool'; id: string; name: string; input: unknown; result?: string; isError?: boolean }
  | { kind: 'notice'; text: string; error?: boolean };

const URL_RE = /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/g;

function applyEvent(items: Item[], e: AgentEvent): Item[] {
  switch (e.type) {
    case 'text': {
      const last = items[items.length - 1];
      if (last?.kind === 'assistant') return [...items.slice(0, -1), { ...last, text: last.text + e.delta }];
      return [...items, { kind: 'assistant', text: e.delta }];
    }
    case 'tool_call':
      return [...items, { kind: 'tool', id: e.id, name: e.name, input: e.input }];
    case 'tool_result':
      return items.map((i) => (i.kind === 'tool' && i.id === e.id ? { ...i, result: e.text, isError: e.isError } : i));
    case 'error':
      return [...items, { kind: 'notice', text: e.message, error: true }];
    case 'done':
      if (e.reason === 'end_turn') return items;
      return [
        ...items,
        { kind: 'notice', text: e.reason === 'aborted' ? 'Stopped.' : 'Stopped: reached the step limit for one turn.' },
      ];
  }
}

function ToolCard({ item }: { item: Extract<Item, { kind: 'tool' }> }) {
  const [open, setOpen] = useState(false);
  const pending = item.result === undefined;
  const prs = item.result?.match(URL_RE) ?? [];
  return (
    <div className={`rounded-lg border text-xs ${item.isError ? 'border-red-900/60 bg-red-950/20' : 'border-slate-800 bg-slate-900/60'}`}>
      <button onClick={() => setOpen(!open)} className="w-full flex items-center gap-2 px-3 py-2 text-left text-slate-300">
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        <Wrench className="w-3 h-3 text-purple-400" />
        <span className="font-mono">{item.name}</span>
        <span className={`ml-auto ${pending ? 'text-amber-400' : item.isError ? 'text-red-400' : 'text-emerald-400'}`}>
          {pending ? 'running…' : item.isError ? 'refused / failed' : 'ok'}
        </span>
      </button>
      {prs.length > 0 && (
        <div className="px-3 pb-2">
          {prs.map((u) => (
            <a key={u} href={u} target="_blank" rel="noreferrer noopener" className="text-blue-400 hover:underline block">
              {u}
            </a>
          ))}
        </div>
      )}
      {open && (
        <div className="px-3 pb-3 space-y-2 border-t border-slate-800 pt-2">
          <pre className="whitespace-pre-wrap break-words text-slate-400 font-mono">{JSON.stringify(item.input, null, 2)}</pre>
          {item.result !== undefined && (
            <pre className="whitespace-pre-wrap break-words text-slate-300 font-mono max-h-64 overflow-auto">{item.result}</pre>
          )}
        </div>
      )}
    </div>
  );
}

export function AgentChat() {
  const [items, setItems] = useState<Item[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [health, setHealth] = useState<Health | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  const refresh = useCallback(async () => {
    try {
      setHealth(await getHealth());
      setLog(await getLog());
      setHealthError(null);
    } catch (e) {
      setHealthError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [items]);

  const send = async () => {
    const message = input.trim();
    if (!message || busy) return;
    setInput('');
    setBusy(true);
    setItems((i) => [...i, { kind: 'user', text: message }]);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      await streamChat(message, (e) => setItems((i) => applyEvent(i, e)), ac.signal);
    } catch (e) {
      if (!ac.signal.aborted) {
        setItems((i) => [...i, { kind: 'notice', text: e instanceof Error ? e.message : String(e), error: true }]);
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
      void refresh();
    }
  };

  const stop = async () => {
    // Ask the server first so no further tool call runs, then drop the connection.
    await stopTurn().catch(() => undefined);
    abortRef.current?.abort();
  };

  const newChat = async () => {
    await resetChat().catch(() => undefined);
    setItems([]);
    void refresh();
  };

  const ready = health?.anthropic === true;

  return (
    <div className="grid lg:grid-cols-[1fr_20rem] gap-6">
      <section className="flex flex-col bg-slate-900/60 border border-slate-800 rounded-xl min-h-[32rem] h-[70vh]">
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {items.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-center text-slate-500 gap-2">
              <Bot className="w-8 h-8" />
              <p className="text-sm">Ask the agent to read the repo, review a PR, or draft a change.</p>
              <p className="text-xs">Writes only ever become draft PRs on agent/* branches.</p>
            </div>
          )}
          {items.map((item, idx) => {
            if (item.kind === 'user')
              return (
                <div key={idx} className="ml-auto max-w-[80%] rounded-xl bg-blue-600/90 px-3 py-2 text-sm whitespace-pre-wrap break-words">
                  {item.text}
                </div>
              );
            if (item.kind === 'assistant')
              return (
                <div key={idx} className="max-w-[90%] rounded-xl bg-slate-800 px-3 py-2 text-sm whitespace-pre-wrap break-words">
                  {item.text}
                </div>
              );
            if (item.kind === 'tool') return <ToolCard key={idx} item={item} />;
            return (
              <div key={idx} className={`text-xs text-center ${item.error ? 'text-red-400' : 'text-slate-500'}`}>
                {item.text}
              </div>
            );
          })}
          <div ref={endRef} />
        </div>
        <form
          className="border-t border-slate-800 p-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            maxLength={8000}
            rows={2}
            placeholder={ready ? 'Message the agent (Enter to send, Shift+Enter for a new line)' : 'Agent server not ready'}
            disabled={!ready}
            className="flex-1 resize-none rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-sm focus:outline-none focus:border-blue-600 disabled:opacity-50"
          />
          {busy ? (
            <button type="button" onClick={() => void stop()} className="px-3 rounded-lg bg-red-600 hover:bg-red-500 flex items-center gap-1 text-sm">
              <Square className="w-4 h-4" /> Stop
            </button>
          ) : (
            <button type="submit" disabled={!ready || !input.trim()} className="px-3 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 flex items-center gap-1 text-sm">
              <Send className="w-4 h-4" /> Send
            </button>
          )}
        </form>
      </section>

      <aside className="space-y-4">
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 text-sm space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Agent status</h3>
            <button onClick={() => void newChat()} disabled={busy} title="Start a new conversation" className="text-slate-400 hover:text-white disabled:opacity-40">
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>
          {healthError && (
            <p className="text-xs text-red-400 flex gap-1">
              <AlertTriangle className="w-4 h-4 shrink-0" /> Server unreachable: {healthError}. Run <code className="font-mono">npm run dev</code>.
            </p>
          )}
          {health && (
            <dl className="text-xs space-y-1 text-slate-400">
              <div className="flex justify-between"><dt>Model</dt><dd className="font-mono text-slate-200">{health.anthropic ? health.model : 'no API key'}</dd></div>
              <div className="flex justify-between"><dt>GitHub</dt><dd className="font-mono text-slate-200">{health.repo ?? 'not configured'}</dd></div>
              <div className="flex justify-between"><dt>Write budget</dt><dd className="font-mono text-slate-200">{health.budget.remaining}/{health.budget.limit}</dd></div>
            </dl>
          )}
          {health && health.budget.remaining === 0 && (
            <button
              onClick={() => void resetBudget().then(refresh)}
              className="w-full text-xs rounded-lg border border-amber-700 text-amber-300 py-1.5 hover:bg-amber-950/40"
            >
              Budget spent — allow more writes
            </button>
          )}
        </div>

        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
          <h3 className="font-semibold text-sm mb-2">Action log</h3>
          {log.length === 0 ? (
            <p className="text-xs text-slate-500">No tool calls yet.</p>
          ) : (
            <ul className="space-y-1 max-h-72 overflow-auto">
              {[...log].reverse().map((l, i) => (
                <li key={`${l.at}-${i}`} className="text-xs font-mono flex justify-between gap-2">
                  <span className={l.isError ? 'text-red-400' : 'text-slate-300'}>{l.tool}</span>
                  <span className="text-slate-500">{new Date(l.at).toLocaleTimeString()}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}
