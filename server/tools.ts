import type Anthropic from '@anthropic-ai/sdk';
import type { GitHubPort } from './github';
import {
  GuardrailError,
  WriteBudget,
  assertAgentBranch,
  assertCommit,
  assertSafePath,
  withFooter,
} from './guardrails';

export interface ToolContext {
  github: GitHubPort | null;
  budget: WriteBudget;
  audit: (entry: Record<string, unknown>) => void;
}

const str = { type: 'string' } as const;

export const TOOLS: Anthropic.Tool[] = [
  {
    name: 'read_file',
    description: 'Read a text file from the target repository (default branch unless ref is given).',
    input_schema: { type: 'object', properties: { path: str, ref: str }, required: ['path'] },
  },
  {
    name: 'list_dir',
    description: 'List a directory in the target repository. Use "" for the root.',
    input_schema: { type: 'object', properties: { path: str, ref: str }, required: ['path'] },
  },
  {
    name: 'list_prs',
    description: 'List open pull requests.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_pr',
    description: 'Get a pull request by number.',
    input_schema: { type: 'object', properties: { number: { type: 'integer' } }, required: ['number'] },
  },
  {
    name: 'get_check_runs',
    description: 'Get CI check runs for a pull request.',
    input_schema: { type: 'object', properties: { number: { type: 'integer' } }, required: ['number'] },
  },
  {
    name: 'create_branch',
    description:
      'Create a branch from main. The name must match agent/<name>-<slug> (lowercase letters, digits, hyphens). Counts against the write budget.',
    input_schema: { type: 'object', properties: { name: str }, required: ['name'] },
  },
  {
    name: 'commit_files',
    description:
      'Commit files to an agent/ branch. Max 20 files of 200KB. Cannot touch .github/, .githooks/, CODEOWNERS, env or key files. Rejected if content contains credentials. Counts against the write budget.',
    input_schema: {
      type: 'object',
      properties: {
        branch: str,
        message: str,
        files: {
          type: 'array',
          items: { type: 'object', properties: { path: str, content: str }, required: ['path', 'content'] },
        },
      },
      required: ['branch', 'message', 'files'],
    },
  },
  {
    name: 'open_pr',
    description: 'Open a DRAFT pull request from an agent/ branch into main. Counts against the write budget.',
    input_schema: {
      type: 'object',
      properties: { head: str, title: str, body: str },
      required: ['head', 'title', 'body'],
    },
  },
  {
    name: 'comment_pr',
    description: 'Comment on a pull request whose head branch is an agent/ branch. Counts against the write budget.',
    input_schema: { type: 'object', properties: { number: { type: 'integer' }, body: str }, required: ['number', 'body'] },
  },
];

function field<T>(input: Record<string, unknown>, key: string, type: 'string' | 'number'): T {
  const v = input[key];
  if (typeof v !== type) throw new GuardrailError(`Argument "${key}" must be a ${type}.`);
  return v as T;
}

/** Executes one tool call. Never throws: failures come back as is_error text for the model. */
export async function runTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<{ text: string; isError: boolean }> {
  const started = Date.now();
  let result: { text: string; isError: boolean };
  try {
    if (!ctx.github) throw new GuardrailError('GitHub is not configured on the server; only chat is available.');
    const gh = ctx.github;
    switch (name) {
      case 'read_file': {
        const path = field<string>(input, 'path', 'string');
        assertSafePathForRead(path);
        result = ok(await gh.readFile(path, optRef(input)));
        break;
      }
      case 'list_dir': {
        const path = field<string>(input, 'path', 'string');
        if (path !== '') assertSafePathForRead(path);
        result = ok((await gh.listDir(path, optRef(input))).join('\n'));
        break;
      }
      case 'list_prs':
        result = ok(JSON.stringify(await gh.listPRs(), null, 2));
        break;
      case 'get_pr':
        result = ok(JSON.stringify(await gh.getPR(field<number>(input, 'number', 'number')), null, 2));
        break;
      case 'get_check_runs':
        result = ok(JSON.stringify(await gh.getCheckRuns(field<number>(input, 'number', 'number')), null, 2));
        break;
      case 'create_branch': {
        const branch = field<string>(input, 'name', 'string');
        assertAgentBranch(branch);
        ctx.budget.consume();
        await gh.createBranch(branch);
        result = ok(`Created ${branch} from main.`);
        break;
      }
      case 'commit_files': {
        const branch = field<string>(input, 'branch', 'string');
        const message = field<string>(input, 'message', 'string');
        assertAgentBranch(branch);
        const files = parseFiles(input.files);
        assertCommit(files);
        ctx.budget.consume();
        const sha = await gh.commitFiles(branch, message, files);
        result = ok(`Committed ${files.length} file(s) to ${branch}: ${sha}`);
        break;
      }
      case 'open_pr': {
        const head = field<string>(input, 'head', 'string');
        assertAgentBranch(head);
        ctx.budget.consume();
        const pr = await gh.openDraftPR(
          head,
          field<string>(input, 'title', 'string'),
          withFooter(field<string>(input, 'body', 'string')),
        );
        result = ok(`Opened draft PR #${pr.number}: ${pr.url}`);
        break;
      }
      case 'comment_pr': {
        const number = field<number>(input, 'number', 'number');
        const pr = await gh.getPR(number);
        assertAgentBranch(pr.head);
        ctx.budget.consume();
        await gh.commentPR(number, withFooter(field<string>(input, 'body', 'string')));
        result = ok(`Commented on #${number}.`);
        break;
      }
      default:
        throw new GuardrailError(`Unknown tool "${name}".`);
    }
  } catch (err) {
    result = { text: err instanceof Error ? err.message : String(err), isError: true };
  }
  ctx.audit({ tool: name, input: redact(name, input), isError: result.isError, ms: Date.now() - started });
  return result;
}

function ok(text: string) {
  return { text, isError: false };
}

function optRef(input: Record<string, unknown>): string | undefined {
  return typeof input.ref === 'string' && input.ref ? input.ref : undefined;
}

// Reads cannot escape the repo either, but protected paths are readable.
function assertSafePathForRead(path: string): void {
  try {
    assertSafePath(path);
  } catch (e) {
    if (e instanceof GuardrailError && /protected/.test(e.message)) return;
    throw e;
  }
}

function parseFiles(v: unknown): { path: string; content: string }[] {
  if (!Array.isArray(v)) throw new GuardrailError('"files" must be an array.');
  return v.map((f) => {
    if (!f || typeof f.path !== 'string' || typeof f.content !== 'string') {
      throw new GuardrailError('Each file needs string "path" and "content".');
    }
    return { path: f.path, content: f.content };
  });
}

// File bodies stay out of the audit log; paths are enough.
function redact(name: string, input: Record<string, unknown>): Record<string, unknown> {
  if (name !== 'commit_files') return input;
  const files = Array.isArray(input.files) ? input.files.map((f) => (f as { path?: unknown })?.path) : [];
  return { ...input, files };
}
