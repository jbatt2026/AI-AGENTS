import { describe, expect, it } from 'vitest';
import {
  FOOTER,
  GuardrailError,
  WriteBudget,
  assertAgentBranch,
  assertCommit,
  assertPublishable,
  assertSafePath,
  findSecret,
  withFooter,
} from './guardrails';

describe('assertAgentBranch', () => {
  it('accepts agent/<slug>', () => {
    expect(() => assertAgentBranch('agent/claude-fix-docs')).not.toThrow();
  });
  it.each(['main', 'master', 'agent/', 'agent/Up', 'feature/x', 'agent/a/b', 'agent/a b', 'xagent/a'])(
    'rejects %s',
    (b) => expect(() => assertAgentBranch(b)).toThrow(GuardrailError),
  );
});

describe('assertSafePath', () => {
  it.each(['src/a.ts', 'README.md', 'docs/x/y.md'])('accepts %s', (p) =>
    expect(() => assertSafePath(p)).not.toThrow(),
  );
  it.each([
    '../x',
    'a/../b',
    '/etc/passwd',
    'a\\b',
    '',
    './a',
    'a//b',
    '.github/workflows/agent-pr-check.yml',
    '.githooks/pre-commit',
    'CODEOWNERS',
    'server/guardrails.ts',
    'server/tools.ts',
    'vite.config.ts',
    // a file named like a protected directory would replace the whole tree
    '.github',
    '.githooks',
    'server',
    'CODEOWNERS/x',
    'docs/CODEOWNERS',
    '.GitHub/workflows/x.yml',
    'Server/tools.ts',
    '.envrc',
    'id_rsa',
    '.env.local',
    'config/.env',
    'key.pem',
    '.git/config',
  ])('rejects %s', (p) => expect(() => assertSafePath(p)).toThrow(GuardrailError));
});

describe('findSecret', () => {
  it('flags a PEM with a body', () => {
    const body = 'A'.repeat(64);
    expect(findSecret(`-----BEGIN RSA PRIVATE KEY-----\n${body}`)).toMatch(/private key/);
  });
  it('flags provider tokens and assigned literals', () => {
    // Fixtures are assembled at runtime so this file stays clean under the repo's own scanner.
    expect(findSecret('k = ' + 'AKIA' + 'ABCDEFGHIJKLMNOP')).toMatch(/AWS/);
    expect(findSecret('api_key = "' + 'abcdefghijklmnopqrstuvwxyz' + '123456"')).toMatch(/api_key/);
    expect(findSecret('x ' + 'sk-ant-' + 'abcdefghijklmnopqrstuvwxyz')).toMatch(/Anthropic/);
  });
  it('catches JSON keys, unquoted values, PGP/encrypted keys and long lines', () => {
    const body = 'A'.repeat(64);
    expect(findSecret('{"api_key": "' + 'abcdefghijklmnopqrstuvwxyz' + '123456"}')).toMatch(/api_key/);
    expect(findSecret('password: ' + 'hunter2hunter2' + 'hunter2hunter2')).toMatch(/password/);
    expect(findSecret(`-----BEGIN PGP PRIVATE KEY BLOCK-----\n${body}`)).toMatch(/private key/);
    expect(findSecret(`-----BEGIN ENCRYPTED PRIVATE KEY-----\n${body}`)).toMatch(/private key/);
    expect(findSecret('x'.repeat(5000) + ' AKIA' + 'ABCDEFGHIJKLMNOP')).toMatch(/AWS/);
  });
  it('ignores placeholders and prose', () => {
    expect(findSecret('-----BEGIN RSA PRIVATE KEY-----\\n...')).toBeNull();
    expect(findSecret('api_key = "your_api_key_here_placeholder"')).toBeNull();
    expect(findSecret('just some text')).toBeNull();
  });
});

describe('assertCommit', () => {
  it('accepts a normal commit', () => {
    expect(() => assertCommit([{ path: 'a.md', content: 'hi' }])).not.toThrow();
  });
  it('rejects empty, oversized, too many, protected and secret-bearing', () => {
    expect(() => assertCommit([])).toThrow(GuardrailError);
    expect(() => assertCommit([{ path: 'a', content: 'x'.repeat(200_001) }])).toThrow(/exceeds/);
    const many = Array.from({ length: 21 }, (_, i) => ({ path: `f${i}`, content: '' }));
    expect(() => assertCommit(many)).toThrow(/Too many/);
    expect(() => assertCommit([{ path: '.github/x.yml', content: '' }])).toThrow(/protected/);
    expect(() => assertCommit([{ path: 'a', content: 'tok ghp_' + 'a'.repeat(36) }])).toThrow(/credential/);
  });
});

describe('assertPublishable', () => {
  it('rejects credentials and oversize text', () => {
    expect(() => assertPublishable('Comment', 'ok')).not.toThrow();
    expect(() => assertPublishable('Comment', 'tok ghp_' + 'a'.repeat(36))).toThrow(/credential/);
    expect(() => assertPublishable('Title', 'x'.repeat(301), 300)).toThrow(/exceeds/);
  });
});

describe('withFooter', () => {
  it('appends once', () => {
    const once = withFooter('body');
    expect(once.endsWith(FOOTER)).toBe(true);
    expect(withFooter(once)).toBe(once);
  });
});

describe('WriteBudget', () => {
  it('stops after the limit and resets', () => {
    const b = new WriteBudget(2);
    b.consume();
    b.consume();
    expect(b.remaining).toBe(0);
    expect(() => b.consume()).toThrow(/exhausted/);
    b.reset();
    expect(() => b.consume()).not.toThrow();
  });
});
