import React, { useMemo, useState } from 'react';
import {
  Bot,
  BrainCircuit,
  Check,
  ChevronRight,
  Copy,
  KeyRound,
  MessageCircle,
  Network,
  Play,
  ShieldCheck,
  Terminal,
} from 'lucide-react';

interface ProviderOption {
  id: string;
  label: string;
  modelLabel: string;
  type: 'openai-compatible' | 'anthropic' | 'gemini';
  baseUrl: string;
  model: string;
  apiKeyEnv?: string;
  color: string;
  local?: boolean;
}

const PROVIDERS: ProviderOption[] = [
  { id: 'openrouter', label: 'OpenRouter', modelLabel: 'Claude · GPT · Qwen', type: 'openai-compatible', baseUrl: 'https://openrouter.ai/api/v1', model: 'anthropic/claude-sonnet-4.6', apiKeyEnv: 'OPENROUTER_API_KEY', color: 'text-violet-300 border-violet-500/30 bg-violet-500/10' },
  { id: 'anthropic', label: 'Anthropic', modelLabel: 'Claude Sonnet', type: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-4-6', apiKeyEnv: 'ANTHROPIC_API_KEY', color: 'text-orange-300 border-orange-500/30 bg-orange-500/10' },
  { id: 'gemini', label: 'Google Gemini', modelLabel: 'Gemini Flash', type: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com', model: 'gemini-2.5-flash', apiKeyEnv: 'GEMINI_API_KEY', color: 'text-blue-300 border-blue-500/30 bg-blue-500/10' },
  { id: 'ollama', label: 'Local Ollama', modelLabel: 'Qwen · Llama · Gemma', type: 'openai-compatible', baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen3:8b', color: 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10', local: true },
];

const COMMANDS = [
  ['/new', 'Clear this Telegram chat session'],
  ['/model', 'List providers and current model'],
  ['/model <id>', 'Select a preferred brain'],
  ['/status', 'Show session and routing state'],
  ['/help', 'Show the command menu'],
];

export const BrainGateway: React.FC = () => {
  const [enabled, setEnabled] = useState<string[]>(['openrouter', 'ollama']);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle');

  const configPreview = useMemo(() => JSON.stringify({
    historyLimit: 24,
    requestTimeoutMs: 60000,
    providers: PROVIDERS.filter((provider) => enabled.includes(provider.id)).map((provider) => ({
      id: provider.id,
      label: provider.label,
      type: provider.type,
      baseUrl: provider.baseUrl,
      model: provider.model,
      ...(provider.apiKeyEnv ? { apiKeyEnv: provider.apiKeyEnv } : {}),
    })),
  }, null, 2), [enabled]);

  const copySetup = async () => {
    try {
      if (!navigator.clipboard) throw new Error('Clipboard access is unavailable');
      await navigator.clipboard.writeText('npm run agent:setup\nnpm run agent:doctor\nnpm run agent:start');
      setCopyStatus('copied');
    } catch {
      setCopyStatus('failed');
    }
    window.setTimeout(() => setCopyStatus('idle'), 1800);
  };

  const toggleProvider = (id: string) => {
    setEnabled((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-2xl border border-cyan-500/20 bg-slate-900 p-6 sm:p-8">
        <div className="absolute -right-24 -top-24 h-64 w-64 rounded-full bg-cyan-500/10 blur-3xl" />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-2xl">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-xs font-semibold text-cyan-300">
              <RadioPulse /> Provider-agnostic runtime
            </div>
            <h2 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">One Telegram agent. Several brains.</h2>
            <p className="mt-3 max-w-xl text-sm leading-6 text-slate-400">
              A distilled, Hermes-inspired gateway flow: configure once, chat from Telegram, switch models per session, and fall back to the next provider when one is unavailable.
            </p>
          </div>
          <button
            onClick={copySetup}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-cyan-500 px-4 py-2.5 text-sm font-bold text-slate-950 transition-colors hover:bg-cyan-400"
          >
            {copyStatus === 'copied' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copyStatus === 'copied' ? 'Copied commands' : copyStatus === 'failed' ? 'Copy failed' : 'Copy quick start'}
          </button>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-4 md:grid-cols-7 md:items-center">
        <FlowNode icon={MessageCircle} title="Telegram" detail="Private allowlist" />
        <ChevronRight className="mx-auto hidden h-5 w-5 text-slate-600 md:block" />
        <FlowNode icon={ShieldCheck} title="Gateway" detail="Session + commands" />
        <ChevronRight className="mx-auto hidden h-5 w-5 text-slate-600 md:block" />
        <FlowNode icon={Network} title="Router" detail="Ordered fallback" />
        <ChevronRight className="mx-auto hidden h-5 w-5 text-slate-600 md:block" />
        <FlowNode icon={BrainCircuit} title="Brain" detail="Cloud or local" />
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <section className="space-y-4 xl:col-span-7">
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
            <div className="mb-4 flex items-center justify-between gap-4">
              <div>
                <h3 className="text-sm font-bold text-white">Brain pool</h3>
                <p className="mt-1 text-xs text-slate-400">Order in the local config determines fallback priority.</p>
              </div>
              <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-300">{enabled.length} selected</span>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {PROVIDERS.map((provider) => {
                const active = enabled.includes(provider.id);
                return (
                  <button
                    key={provider.id}
                    onClick={() => toggleProvider(provider.id)}
                    aria-pressed={active}
                    className={`rounded-xl border p-4 text-left transition-all ${active ? provider.color : 'border-slate-800 bg-slate-950/60 text-slate-300 hover:border-slate-700'}`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <BrainCircuit className="h-4 w-4" />
                        <span className="text-sm font-bold">{provider.label}</span>
                      </div>
                      <span className={`flex h-5 w-5 items-center justify-center rounded-full border ${active ? 'border-current bg-current/10' : 'border-slate-700'}`}>
                        {active && <Check className="h-3 w-3" />}
                      </span>
                    </div>
                    <p className="mt-2 text-xs">{provider.modelLabel}</p>
                    <p className="mt-3 text-[10px] font-semibold uppercase tracking-wider opacity-90">{provider.local ? 'Local · no API key' : 'Cloud · API key'}</p>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
            <div className="mb-4 flex items-center gap-2">
              <Terminal className="h-4 w-4 text-cyan-400" />
              <h3 className="text-sm font-bold text-white">Three-command setup</h3>
            </div>
            <div className="space-y-2 font-mono text-xs">
              <CommandLine index="01" command="npm run agent:setup" note="Telegram + providers" />
              <CommandLine index="02" command="npm run agent:doctor" note="Credentials + connectivity" />
              <CommandLine index="03" command="npm run agent:start" note="Long-polling gateway" />
            </div>
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-500/15 bg-amber-500/5 p-3 text-xs leading-5 text-amber-200/80">
              <KeyRound className="mt-0.5 h-4 w-4 shrink-0" />
              Secrets are written only to <code>.env.local</code>; provider routing goes in ignored <code>agent.config.json</code>.
            </div>
          </div>
        </section>

        <aside className="space-y-4 xl:col-span-5">
          <div className="rounded-xl border border-slate-800 bg-slate-950 p-5">
            <div className="mb-3 flex items-center justify-between border-b border-slate-800 pb-3">
              <span className="text-xs font-bold text-slate-300">agent.config.json</span>
              <span className="text-[10px] font-semibold text-slate-400">PREVIEW</span>
            </div>
            <pre className="min-h-64 overflow-x-auto whitespace-pre-wrap text-xs leading-5 text-slate-300"><code>{configPreview}</code></pre>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
            <div className="mb-3 flex items-center gap-2">
              <Bot className="h-4 w-4 text-cyan-400" />
              <h3 className="text-sm font-bold text-white">Telegram command surface</h3>
            </div>
            <div className="divide-y divide-slate-800">
              {COMMANDS.map(([command, description]) => (
                <div key={command} className="flex items-center justify-between gap-4 py-2.5 text-xs">
                  <code className="shrink-0 font-semibold text-cyan-300">{command}</code>
                  <span className="text-right text-slate-400">{description}</span>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
};

const RadioPulse = () => <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-300 opacity-75" /><span className="relative inline-flex h-2 w-2 rounded-full bg-cyan-400" /></span>;

const FlowNode: React.FC<{ icon: React.ElementType; title: string; detail: string }> = ({ icon: Icon, title, detail }) => (
  <div className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/70 p-3 md:flex-col md:justify-center md:text-center">
    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-300"><Icon className="h-4 w-4" /></div>
    <div><div className="text-xs font-bold text-white">{title}</div><div className="mt-0.5 text-[10px] text-slate-400">{detail}</div></div>
  </div>
);

const CommandLine: React.FC<{ index: string; command: string; note: string }> = ({ index, command, note }) => (
  <div className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-950 px-3 py-2.5">
    <span className="text-slate-400">{index}</span>
    <Play className="h-3 w-3 fill-cyan-400 text-cyan-400" />
    <span className="flex-1 text-slate-200">{command}</span>
    <span className="hidden text-slate-400 sm:block"># {note}</span>
  </div>
);
