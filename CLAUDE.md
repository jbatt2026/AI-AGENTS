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

The repo holds a TypeScript / Vite / React web app — the GitHub App workbench —
plus the App manifest, install docs, and the CI that guards agent-authored pull
requests. 30 tracked files:

```
index.html, vite.config.ts        # app entry and build config
package.json, package-lock.json   # dependencies; the lockfile IS committed
tsconfig.json, tsconfig.node.json # TypeScript config
src/                              # App.tsx, main.tsx, types.ts, index.css
src/components/                   # 6 components: Header, DocsHub,
                                  #   ManifestBuilder, TokenAuthSimulator,
                                  #   PRWorkflowWorkbench, AgentScriptsRunner
.github/GITHUB_APP_MANIFEST.json  # App manifest
.github/workflows/                # agent-pr-check.yml
.github/scripts/scan_secrets.py   # the CI secret scanner
.githooks/pre-commit              # local secret scanning
```

There is a build system and CI, but **no test suite** — `npm run lint` is a
typecheck (`tsc --noEmit`), not tests. Do not claim tests pass; there are none
to run.

`.github/scripts/scan_secrets.py` is the only Python in the tree. It is
stdlib-only and has no toolchain of its own — no pytest, no ruff, no
`requirements.txt`. Run it directly.

The files `README.md` references all exist:

| Referenced in README | Exists? | Purpose |
| --- | --- | --- |
| `INSTALL_GITHUB_APP.md` | Yes | Step-by-step GitHub App install/config |
| `.github/GITHUB_APP_MANIFEST.json` | Yes | App manifest (permissions, webhook, events) |
| `CONTRIBUTING.md` | Yes | Contributor and agent guidelines |
| `CODEOWNERS` | Yes | Review ownership routing |
| `.github/workflows/agent-pr-check.yml` | Yes | Checks on agent-created PRs |
| `.github/scripts/scan_secrets.py` | Yes | Secret scanner the workflow runs |

When you add another entry, update the table above so this file stays accurate.

**Verify before you generalize**: a quick `git ls-files` is cheaper than an
assumption about structure that no longer holds once more code lands. This
section was wrong for some time — it described a two-file scaffold with no CI
long after the app, the workflow and the lockfile had landed.

## Working conventions

### Language and tooling

The project uses a standard TypeScript / Vite / React stack with Node.js 22 runtime:

- Dependency manifest: `package.json`
- Build command: `npm run build`
- Dev server: `npm run dev` (starts on port 3000, host localhost by default; use `VITE_HOST=0.0.0.0` to expose to network)
- Continuous Integration: `.github/workflows/agent-pr-check.yml`

### Commands

Documented invocations:
- `npm install` — install dependencies
- `npm run dev` — start local development server at `http://localhost:3000` (restricted to localhost by default for security)
- `npm run build` — typecheck and compile production bundle into `dist/`
- `npm run lint` — typecheck only (`tsc --noEmit`). This is not a test suite.
- `npm run preview` — preview production build locally
- `python3 .github/scripts/scan_secrets.py .` — the secret scan CI runs.
  Exits 0 when clean, 1 on a finding. Needs no dependencies.

Run all three of CI's steps before pushing, in the workflow's own order:

```bash
npm ci && npm run build && python3 .github/scripts/scan_secrets.py .
```

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

Keep the root uncluttered:

- `.github/` — App manifest, workflows, issue/PR templates, `CODEOWNERS`.
- `.github/scripts/` — scripts the workflows call.
- `.githooks/` — Git hooks for local development (pre-commit secret scanning)
- `scripts/` — standalone operational scripts agents run. Does not exist yet;
  create it rather than putting such a script at the root.
- `src/` — the web app's TypeScript source; components under `src/components/`.
- `docs/` — anything longer than a section of `README.md`. Does not exist yet.

### Secrets & Credential Safety

This repo is about credentialed automation, so the rule is strict: **never**
commit App private keys (`.pem`), installation tokens, webhook secrets,
`.env` files, or any live credential. Reference them as environment variables
or GitHub Actions secrets and document the variable names only. If you find a
committed secret, stop and flag it rather than quietly rewriting history.

**Local Protection:**
- `.env.local`, `*.pem`, and `.env.*local` are git-ignored (see `.gitignore`)
- Pre-commit hook (in `.githooks/pre-commit`) scans staged changes for secrets before commit
- CI runs `.github/scripts/scan_secrets.py`, which looks for private keys with
  a real base64 body, credential-ish assignments, and AWS, GitHub, Slack,
  Google and Stripe token formats. Files that legitimately document these
  patterns are named individually in that script's `ALLOWLIST` — if a finding
  is a placeholder, add the path there with a reason rather than loosening a
  pattern.

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
