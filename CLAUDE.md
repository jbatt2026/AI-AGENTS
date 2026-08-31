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

This repo is a scaffold. As of the latest commit it contains exactly two files:

```
README.md     # repo purpose and agent guidance
CLAUDE.md     # this file
```

There is **no source code, no package manifest, no test suite, no CI, and no
build system yet.** Do not report or assume otherwise.

`README.md` describes the repo's intended contents in the present tense, but
those files are **not yet written**:

| Referenced in README | Exists? | Purpose when created |
| --- | --- | --- |
| `INSTALL_GITHUB_APP.md` | Yes | Step-by-step GitHub App install/config |
| `.github/GITHUB_APP_MANIFEST.json` | Yes | App manifest (permissions, webhook, events) |
| `CONTRIBUTING.md` | Yes | Contributor and agent guidelines |
| `CODEOWNERS` | Yes | Review ownership routing |
| `.github/workflows/agent-pr-check.yml` | Yes | Checks on agent-created PRs |

Treat that table as the backlog. When a task touches one of those items, create
the file rather than assuming it is somewhere you haven't looked. When you do
create one, update the table above so this file stays accurate.

Because the tree is nearly empty, **verify before you generalize**: a quick
`git ls-files` is cheaper than an assumption about structure that no longer holds
once real code lands.

## Working conventions

### Language and tooling

The project uses a standard TypeScript / Vite / React stack with Node.js 22 runtime:

- Dependency manifest: `package.json`
- Build command: `npm run build`
- Dev server: `npm run dev` (starts on port 3000, host 0.0.0.0)
- Continuous Integration: `.github/workflows/agent-pr-check.yml`

### Commands

Documented invocations:
- `npm install` — install dependencies
- `npm run dev` — start local development server at `http://localhost:3000`
- `npm run build` — typecheck and compile production bundle into `dist/`
- `npm run preview` — preview production build locally

### Layout for new code

When adding the first real code, keep the root uncluttered:

- `.github/` — App manifest, workflows, issue/PR templates, `CODEOWNERS`.
- `scripts/` — standalone operational scripts agents run.
- `src/` (or the ecosystem's convention) — reusable library code.
- `docs/` — anything longer than a section of `README.md`.

### Secrets

This repo is about credentialed automation, so the rule is strict: **never**
commit App private keys (`.pem`), installation tokens, webhook secrets,
`.env` files, or any live credential. Reference them as environment variables
or GitHub Actions secrets and document the variable names only. If you find a
committed secret, stop and flag it rather than quietly rewriting history.

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
