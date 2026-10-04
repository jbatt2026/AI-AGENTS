import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const scanner = path.join(repositoryRoot, '.github/scripts/scan_secrets.py');
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function telegramTokenFixture() {
  return ['123456789', ':', 'A'.repeat(35)].join('');
}

test('secret scanner detects example-file tokens without echoing their values', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'secret-scan-'));
  const secret = telegramTokenFixture();
  const genericSecret = ['opaque-example', 'Z'.repeat(24), '!$%+/@'].join('-');
  const secondGenericSecret = ['opaque', 'Y'.repeat(24), '!$%+/@'].join('-');
  const tokenName = ['TELEGRAM', 'BOT', 'TOKEN'].join('_');
  const clientSecretName = ['CLIENT', 'SECRET'].join('_');
  const apiKeyName = ['API', 'KEY'].join('_');
  const passwordName = ['PASS', 'WORD'].join('');
  const secretKeyName = ['SECRET', 'KEY'].join('_');
  const doubleQuotedSecret = ['opaque', 'D'.repeat(24), "can't-be-public"].join('-');
  const singleQuotedSecret = ['opaque', 'E'.repeat(24), 'say-"private"'].join('-');
  await writeFile(path.join(rootDir, '.env.example'), `${tokenName}=${secret}\n${clientSecretName}=${genericSecret} ${apiKeyName}=${secondGenericSecret}\n\"${passwordName}\": \"${doubleQuotedSecret}\"\n${secretKeyName}='${singleQuotedSecret}'\n`);

  const result = spawnSync('python3', [scanner, rootDir], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /Telegram bot token/);
  assert.match(result.stdout, /CLIENT_SECRET assigned a literal/);
  assert.match(result.stdout, /API_KEY assigned a literal/);
  assert.match(result.stdout, /PASSWORD assigned a literal/);
  assert.match(result.stdout, /SECRET_KEY assigned a literal/);
  assert.match(result.stdout, /value redacted/);
  assert.doesNotMatch(result.stdout, new RegExp(secret));
  assert.doesNotMatch(result.stdout, new RegExp(escapeRegExp(genericSecret)));
  assert.doesNotMatch(result.stdout, new RegExp(escapeRegExp(secondGenericSecret)));
  assert.doesNotMatch(result.stdout, new RegExp(escapeRegExp(doubleQuotedSecret)));
  assert.doesNotMatch(result.stdout, new RegExp(escapeRegExp(singleQuotedSecret)));
});

test('secret scanner accepts only complete environment-variable references', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'secret-reference-scan-'));
  const configPath = path.join(rootDir, 'config.txt');
  const apiKeyName = ['API', 'KEY'].join('_');
  const clientSecretName = ['CLIENT', 'SECRET'].join('_');
  const jsReference = ['process', 'env', 'PROVIDER_API_KEY'].join('.');
  const pythonReference = `os.environ["${clientSecretName}"]`;
  await writeFile(configPath, `${apiKeyName}=${jsReference},\n${clientSecretName}=${pythonReference});\n`);

  const clean = spawnSync('python3', [scanner, rootDir], { encoding: 'utf8' });
  assert.equal(clean.status, 0, clean.stdout || clean.stderr);

  await writeFile(configPath, `${apiKeyName}=prefix-${jsReference}\n${clientSecretName}=${pythonReference.slice(0, -1)}\n`);
  const embedded = spawnSync('python3', [scanner, rootDir], { encoding: 'utf8' });
  assert.equal(embedded.status, 1);
  assert.match(embedded.stdout, /API_KEY assigned a literal/);
  assert.match(embedded.stdout, /CLIENT_SECRET assigned a literal/);
});

test('staged scan reads the Git index instead of a sanitized working copy', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'staged-secret-scan-'));
  const secret = telegramTokenFixture();
  spawnSync('git', ['init', '-q'], { cwd: rootDir });
  await writeFile(path.join(rootDir, 'config.txt'), `bot_token=${secret}\n`);
  assert.equal(spawnSync('git', ['add', 'config.txt'], { cwd: rootDir }).status, 0);
  await writeFile(path.join(rootDir, 'config.txt'), 'bot_token=\n');

  const result = spawnSync('python3', [scanner, '--staged', rootDir], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /config\.txt:1/);
  assert.doesNotMatch(result.stdout, new RegExp(secret));
});

test('pre-commit hook blocks nested local credential files', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'credential-path-'));
  spawnSync('git', ['init', '-q'], { cwd: rootDir });
  await mkdir(path.join(rootDir, 'config'));
  await writeFile(path.join(rootDir, 'config/.env.example'), 'SAFE_PLACEHOLDER=\n');
  assert.equal(spawnSync('git', ['add', 'config/.env.example'], { cwd: rootDir }).status, 0);
  const hook = path.join(repositoryRoot, '.githooks/pre-commit');
  const blocked = spawnSync('bash', [hook], { cwd: rootDir, encoding: 'utf8' });
  assert.equal(blocked.status, 1);
  assert.match(blocked.stdout, /Refusing to commit local credential file/);
});

test('history scan checks shared blobs without exposing their contents', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'history-secret-scan-'));
  const secret = ['opaque', 'Q'.repeat(24), '!$%+/@'].join('-');
  spawnSync('git', ['init', '-q'], { cwd: rootDir });
  await mkdir(path.join(rootDir, '.github/scripts'), { recursive: true });
  const content = `CLIENT_SECRET=${secret}\n`;
  await writeFile(path.join(rootDir, '.github/scripts/scan_secrets.py'), content);
  await writeFile(path.join(rootDir, 'leak.txt'), content);
  assert.equal(spawnSync('git', ['add', '.'], { cwd: rootDir }).status, 0);
  assert.equal(spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '-qm', 'fixture'], { cwd: rootDir }).status, 0);

  const result = spawnSync('python3', [scanner, '--history', rootDir], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /git object/);
  assert.doesNotMatch(result.stdout, new RegExp(escapeRegExp(secret)));
});

test('history scan does not trust current path allowlists for old content', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'history-allowlist-scan-'));
  const secret = ['opaque', 'R'.repeat(24), '!$%+/@'].join('-');
  spawnSync('git', ['init', '-q'], { cwd: rootDir });
  await mkdir(path.join(rootDir, '.github/scripts'), { recursive: true });
  await writeFile(path.join(rootDir, '.github/scripts/scan_secrets.py'), `CLIENT_SECRET=${secret}\n`);
  assert.equal(spawnSync('git', ['add', '.'], { cwd: rootDir }).status, 0);
  assert.equal(spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '-qm', 'fixture'], { cwd: rootDir }).status, 0);

  const result = spawnSync('python3', [scanner, '--history', rootDir], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /\.github\/scripts\/scan_secrets\.py/);
  assert.doesNotMatch(result.stdout, new RegExp(escapeRegExp(secret)));
});

test('history scan skips Git submodule commit objects', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'history-gitlink-scan-'));
  spawnSync('git', ['init', '-q'], { cwd: rootDir });
  await writeFile(path.join(rootDir, 'README.md'), 'fixture\n');
  assert.equal(spawnSync('git', ['add', 'README.md'], { cwd: rootDir }).status, 0);
  const commitArgs = ['-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '-qm'];
  assert.equal(spawnSync('git', [...commitArgs, 'base'], { cwd: rootDir }).status, 0);
  const commitId = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: rootDir, encoding: 'utf8' }).stdout.trim();
  assert.equal(spawnSync('git', ['update-index', '--add', '--cacheinfo', `160000,${commitId},vendor/submodule`], { cwd: rootDir }).status, 0);
  assert.equal(spawnSync('git', [...commitArgs, 'gitlink'], { cwd: rootDir }).status, 0);

  const result = spawnSync('python3', [scanner, '--history', rootDir], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout || result.stderr);
});
