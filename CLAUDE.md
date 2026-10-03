# CLAUDE.md

Guidance for Claude Code and other AI agents working in this repository.

## What this repository is

`AI-AGENTS` (github.com/jbatt2026/AI-AGENTS) hosts tools, scripts, and
integrations that let automated AI agents — e.g. Hermes and Claude — create,
update, and manage code through GitHub. The intended mechanism is a GitHub App:
agents authenticate with an installation token, push branches, and open pull
requests programmatically.

The repository is **public**. Assume anything committed here is world-readable.

## Current state — read this first

A React 18 / Vite 6 / Tailwind 4 dashboard plus GitHub App scaffolding. Verify with
`git ls-files` before generalizing.

| Path | Purpose |
| --- | --- |
| `src/` | Dashboard. `AgentChat` talks to the live agent via `src/lib/agentClient.ts`; the other four tabs are **simulated demos** |
| `server/` | Local Node agent server (Hono, 127.0.0.1): Claude tool-use loop (`agent.ts`), GitHub tools (`tools.ts`, `github.ts`), hard limits (`guardrails.ts`), bearer-token/Host/Origin checks (`app.ts`) |
| `.github/GITHUB_APP_MANIFEST.json` | App manifest (webhook inactive; URL placeholder must be substituted before use) |
| `.github/workflows/agent-pr-check.yml` | Branch-name, attribution, typecheck, build, secret-scan checks |
| `.github/scripts/scan_secrets.py` | Secret scanner used by CI |
| `.github/dependabot.yml` | Weekly npm + Actions updates |
| `.githooks/pre-commit` | Local secret scan (enable with `core.hooksPath`) |
| `INSTALL_GITHUB_APP.md`, `CONTRIBUTING.md`, `SECURITY.md`, `CODEOWNERS` | Docs and review routing |
| `outputs/AI-AGENTS-completion-guide.md` | Gap analysis and remaining work |

**Not yet present:** a webhook receiver. Tests are Vitest (`npm test`), covering `server/` and `src/lib/`. The write guardrails live in `server/guardrails.ts` and must not be loosened by prompt or tool changes; the agent cannot write that file.

## Working conventions

### Language and tooling

The project uses a standard TypeScript / Vite / React stack with Node.js 22 runtime:

- Dependency manifest: `package.json`
- Typecheck: `npm run lint` (`tsc` for `src/` and `server/`); tests: `npm test`
- Build command: `npm run build`
- Dev server: `npm run dev` (starts on port 3000, host localhost by default; use `VITE_HOST=0.0.0.0` to expose to network)
- Continuous Integration: `.github/workflows/agent-pr-check.yml`

### Commands

Documented invocations:
- `npm install` — install dependencies
- `npm run dev` — start the agent server (127.0.0.1:8787) and the GUI at `http://localhost:3000` (localhost only by default)
- `npm run lint` — typecheck only
- `npm run build` — compile production bundle into `dist/` (does not typecheck; CI runs lint separately)
- `npm run preview` — preview production build locally

For network access (shared/cloud environments), set environment variables:
```bash
VITE_HOST=0.0.0.0 npm run dev    # Expose to network (use only on trusted networks)
VITE_PORT=5000 npm run dev       # Use custom port
```

### Environment Setup

Before developing locally:

```bash
# Copy template and add your credentials (ONLY to .env.local, which is .gitignored)
cp .env.example .env.local

# Enable pre-commit secret scanning hook
git config --local core.hooksPath .githooks
chmod +x .githooks/pre-commit  # On Unix/macOS
```

The `.env.local` file is git-ignored and safe for local development. For CI/CD:
- Use GitHub Secrets (Settings > Secrets > Actions) for GitHub Actions workflows
- Use your cloud platform's secret manager (AWS Secrets Manager, GCP Secret Manager) for deployed services
- Never commit `.env.local`, `.env.pem`, or any credential files

### Layout for new code

When adding the first real code, keep the root uncluttered:

- `.github/` — App manifest, workflows, issue/PR templates, `CODEOWNERS`.
- `.githooks/` — Git hooks for local development (pre-commit secret scanning)
- `scripts/` — standalone operational scripts agents run.
- `src/` (or the ecosystem's convention) — reusable library code.
- `docs/` — anything longer than a section of `README.md`.

### Secrets & Credential Safety

This repo is about credentialed automation, so the rule is strict: **never**
commit App private keys (`.pem`), installation tokens, webhook secrets,
`.env` files, or any live credential. Reference them as environment variables
or GitHub Actions secrets and document the variable names only. If you find a
committed secret, stop and flag it rather than quietly rewriting history.

**Local Protection:**
- `.env.local`, `*.pem`, and `.env.*local` are git-ignored (see `.gitignore`)
- Pre-commit hook (in `.githooks/pre-commit`) scans staged changes for secrets before commit
- CI workflow scans for private keys, API keys, tokens, and AWS credentials

**Setup:**
After cloning, enable the pre-commit hook:
```bash
git config --local core.hooksPath .githooks
```

## Git workflow

Default branch is `main`. Work happens on feature branches; `main` is not
pushed to directly.

- Branch off the latest `main`.
- Commit with clear, descriptive messages explaining *why*, not just *what*.
- Push with `git push -u origin <branch-name>`.
- Open a **draft** pull request for the pushed branch if no open PR exists for
  it. A merged or closed PR does not count — follow-up work starts a fresh
  branch off `main` and a new PR.
- Never stack new commits on already-merged history.
- Never rewrite history (rebase, amend, force-push) on a branch someone else
  may have checked out.

Retry pushes and fetches on network failure with exponential backoff (2s, 4s,
8s, 16s) rather than giving up on the first error.

## Pull request expectations

Agent-authored PRs are the primary way changes enter this repo, so they carry
the burden of proof:

- Keep the diff scoped to what was asked; don't opportunistically widen it.
- State in the PR body what you verified and what you could not.
- Once CI exists, drive the PR to green: diagnose and fix real failures rather
  than re-running. Never skip, disable, or quarantine a test to get green.
- Address review comments or explain concretely why a change isn't right.

## Notes for AI assistants

- **Accuracy over completeness.** Describing structure this repo doesn't have
  is worse than a short answer. Ground claims in files you actually read.
- **Keep this file current.** It is the first thing a new session reads. When
  the repo gains code, tooling, or CI, update the state section, the backlog
  table, and the commands section in the same PR that adds them.
- **Attribution.** Every GitHub comment, review, or reply you author ends with
  the Claude Code attribution footer.
