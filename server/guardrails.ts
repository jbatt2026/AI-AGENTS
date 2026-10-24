// Hard limits on what the agent may do on GitHub. Enforced in code: nothing
// the model says can relax them.

export class GuardrailError extends Error {}

/** Same pattern the CI branch-name check enforces. */
export const BRANCH_RE = /^agent\/[a-z0-9-]+$/;

export const FOOTER =
  '\n\n---\n🤖 Generated with [Claude Code](https://claude.com/claude-code) via AI-AGENTS';

/**
 * Paths the agent may never write: CI, hooks, ownership, the server (which holds
 * these very checks), build config and secrets. Compared case-insensitively and
 * by path segment, so neither a file *named* like a protected directory nor a
 * file inside it gets through.
 */
const PROTECTED_ROOTS = ['.github', '.githooks', '.git', 'server', 'vite.config.ts', 'vitest.config.ts', '.gitignore'];
const PROTECTED_ANYWHERE = ['codeowners'];

function isProtected(path: string): boolean {
  const lower = path.toLowerCase();
  const segs = lower.split('/');
  if (PROTECTED_ROOTS.includes(segs[0])) return true;
  if (segs.some((seg) => PROTECTED_ANYWHERE.includes(seg))) return true;
  const base = segs[segs.length - 1];
  return /^\.env($|\.)/.test(base) || base === '.envrc' || /\.(pem|key)$/.test(base) || /^id_(rsa|ed25519|ecdsa)/.test(base);
}

export const MAX_FILES = 20;
export const MAX_FILE_BYTES = 200_000;

const PEM_BODY =
  /-----BEGIN [A-Z ]*PRIVATE KEY( BLOCK)?-----[^A-Za-z0-9+/]{0,40}[A-Za-z0-9+/]{40,}/;
// Optional closing quote after the name covers JSON keys; unquoted values cover YAML/env style.
const ASSIGNED_SECRET =
  /(api[_-]?key|bearer[_-]?token|access[_-]?token|oauth[_-]?token|secret[_-]?key|client[_-]?secret|password)['"]?\s*[:=]\s*['"]?([A-Za-z0-9_\-./+=]{20,})/i;
const PLACEHOLDER =
  /(x{4,}|\.{3,}|<[^>]*>|\$\{[^}]*\}|changeme|placeholder|redacted|dummy|sample|example|your[_-]|insert[_-]|todo|fixme)/i;
const PROVIDER_TOKENS: [string, RegExp][] = [
  ['AWS access key', /AKIA[0-9A-Z]{16}/],
  ['GitHub token', /gh[pusor]_[A-Za-z0-9_]{36,}/],
  ['Slack token', /xox[baprs]-[A-Za-z0-9-]{10,}/],
  ['Google API key', /AIza[0-9A-Za-z_-]{35}/],
  ['Stripe live key', /sk_live_[0-9a-zA-Z]{24,}/],
  ['Anthropic API key', /sk-ant-[A-Za-z0-9_-]{20,}/],
];

export function assertAgentBranch(branch: string): void {
  if (!BRANCH_RE.test(branch)) {
    throw new GuardrailError(
      `Branch "${branch}" refused: agent branches must match agent/<name>-<slug> (lowercase letters, digits, hyphens). Never main.`,
    );
  }
}

export function assertSafePath(path: string): void {
  if (!path || path.startsWith('/') || path.includes('\\') || path.includes('\0')) {
    throw new GuardrailError(`Path "${path}" refused: must be a relative POSIX path.`);
  }
  if (path.split('/').some((seg) => seg === '..' || seg === '.' || seg === '')) {
    throw new GuardrailError(`Path "${path}" refused: no "..", "." or empty segments.`);
  }
  if (isProtected(path)) {
    throw new GuardrailError(`Path "${path}" is protected and cannot be written by the agent.`);
  }
}

/** Returns a description of the first credential found, or null. */
export function findSecret(text: string): string | null {
  const pem = PEM_BODY.exec(text);
  if (pem) return 'private key with a base64 body';
  // Provider tokens are fixed-shape, so they are checked on the whole text, long lines included.
  for (const [label, re] of PROVIDER_TOKENS) {
    const m = re.exec(text);
    if (m && !PLACEHOLDER.test(m[0])) return label;
  }
  for (const line of text.split('\n')) {
    if (line.length > 4000) continue;
    const assigned = ASSIGNED_SECRET.exec(line);
    if (assigned && !PLACEHOLDER.test(assigned[2])) return `${assigned[1]} assigned a literal`;
  }
  return null;
}

export interface FileInput {
  path: string;
  content: string;
}

export function assertCommit(files: FileInput[]): void {
  if (files.length === 0) throw new GuardrailError('No files supplied.');
  if (files.length > MAX_FILES) {
    throw new GuardrailError(`Too many files (${files.length}); the limit is ${MAX_FILES} per commit.`);
  }
  for (const f of files) {
    assertSafePath(f.path);
    if (Buffer.byteLength(f.content, 'utf8') > MAX_FILE_BYTES) {
      throw new GuardrailError(`"${f.path}" exceeds ${MAX_FILE_BYTES} bytes.`);
    }
    const hit = findSecret(f.content);
    if (hit) throw new GuardrailError(`"${f.path}" refused: looks like it contains a credential (${hit}).`);
  }
}

/** Free text that will be published (commit message, PR title/body, comment). */
export function assertPublishable(label: string, text: string, maxChars = 20_000): void {
  if (text.length > maxChars) throw new GuardrailError(`${label} exceeds ${maxChars} characters.`);
  const hit = findSecret(text);
  if (hit) throw new GuardrailError(`${label} refused: looks like it contains a credential (${hit}).`);
}

export function withFooter(body: string): string {
  return body.includes(FOOTER.trim()) ? body : body + FOOTER;
}

/** Counts write actions; once spent, the user must reset it from the GUI. */
export class WriteBudget {
  private used = 0;
  constructor(public readonly limit: number) {}

  consume(): void {
    if (this.used >= this.limit) {
      throw new GuardrailError(
        `Write budget exhausted (${this.limit}). Stop and tell the user; they can reset the budget in the GUI.`,
      );
    }
    this.used += 1;
  }

  get remaining(): number {
    return this.limit - this.used;
  }

  reset(): void {
    this.used = 0;
  }
}
