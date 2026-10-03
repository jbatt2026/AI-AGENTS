import { randomBytes } from 'node:crypto';
import { appendFileSync, chmodSync, rmSync, writeFileSync } from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';
import { serve } from '@hono/node-server';
import { createApp } from './app';
import { WriteBudget } from './guardrails';
import { createGitHub, type GitHubPort } from './github';

try {
  process.loadEnvFile('.env.local');
} catch {
  // No .env.local: rely on the real environment.
}

const env = process.env;
const port = Number(env.AGENT_SERVER_PORT || 8787);
const vitePort = Number(env.VITE_PORT || 3000);
const model = env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
const budget = new WriteBudget(Number(env.AGENT_WRITE_BUDGET || 10));

const client = env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }) : null;

let github: GitHubPort | null = null;
let repo: string | null = null;
const { GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, GITHUB_APP_INSTALLATION_ID, GITHUB_TARGET_REPO } = env;
if (GITHUB_APP_ID && GITHUB_APP_PRIVATE_KEY && GITHUB_APP_INSTALLATION_ID && GITHUB_TARGET_REPO?.includes('/')) {
  const [owner, name] = GITHUB_TARGET_REPO.split('/');
  repo = GITHUB_TARGET_REPO;
  github = createGitHub({
    appId: GITHUB_APP_ID,
    privateKey: GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, '\n'),
    installationId: Number(GITHUB_APP_INSTALLATION_ID),
    owner,
    repo: name,
    baseBranch: 'main',
  });
}

// The token lives in a 0600 file; the Vite dev proxy reads it, the browser never sees it.
const token = randomBytes(32).toString('hex');
// Remove first so a stale file or symlink cannot keep loose permissions or redirect the write.
rmSync('.agent-token', { force: true });
writeFileSync('.agent-token', token, { mode: 0o600, flag: 'wx' });
chmodSync('.agent-token', 0o600);
process.on('exit', () => rmSync('.agent-token', { force: true }));
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => process.exit(0));

const logPath = '.agent-log.jsonl';
const recent: Record<string, unknown>[] = [];
const audit = (entry: Record<string, unknown>) => {
  const row = { at: new Date().toISOString(), ...entry };
  recent.push(row);
  if (recent.length > 200) recent.shift();
  try {
    appendFileSync(logPath, JSON.stringify(row) + '\n');
  } catch {
    // The in-memory log still serves the GUI.
  }
};

const hosts = [`127.0.0.1:${port}`, `localhost:${port}`, `127.0.0.1:${vitePort}`, `localhost:${vitePort}`];
const app = createApp({
  token,
  allowedHosts: hosts,
  allowedOrigins: [`http://127.0.0.1:${vitePort}`, `http://localhost:${vitePort}`],
  client,
  github,
  model,
  repo,
  budget,
  audit,
  auditLog: () => recent,
});

serve({ fetch: app.fetch, hostname: '127.0.0.1', port }, () => {
  console.log(`agent server on http://127.0.0.1:${port}`);
  console.log(`  anthropic: ${client ? model : 'NOT CONFIGURED (set ANTHROPIC_API_KEY)'}`);
  console.log(`  github:    ${repo ?? 'NOT CONFIGURED (chat and read-only answers only)'}`);
  console.log(`  writes:    draft PRs on agent/* branches, budget ${budget.limit}`);
});
