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

The repo holds one tool so far — `face-agent`, a local facial recognition
service that agents call over MCP or a loopback HTTP API:

```
README.md                    # repo purpose and agent guidance
CLAUDE.md                    # this file
pyproject.toml               # project metadata, ruff + pytest config
requirements.txt             # runtime deps (opencv backend)
requirements-dev.txt         # + pytest, ruff, pyinstaller
scripts/face_agent.py        # the tool: CLI, HTTP API, MCP server
scripts/build_executable.py  # PyInstaller wrapper -> dist/face-agent[.exe]
tests/                       # pytest suite, no camera or vision libs needed
docs/FACE_AGENT.md           # install, usage, agent integration
.github/workflows/ci.yml     # ruff + pytest on 3.10/3.11/3.12
```

The GitHub App machinery the README describes in the present tense is still
**not written**:

| Referenced in README | Exists? | Purpose when created |
| --- | --- | --- |
| `INSTALL_GITHUB_APP.md` | No | Step-by-step GitHub App install/config |
| `.github/GITHUB_APP_MANIFEST.json` | No | App manifest (permissions, webhook, events) |
| `CONTRIBUTING.md` | No | Contributor and agent guidelines |
| `CODEOWNERS` | No | Review ownership routing |
| `.github/workflows/ci.yml` | **Yes** | Lint + test on pushes and PRs |

Treat that table as the backlog. When a task touches one of those items, create
the file rather than assuming it is somewhere you haven't looked. When you do
create one, update the table above so this file stays accurate.

The tree is still small, so **verify before you generalize**: a quick
`git ls-files` is cheaper than an assumption about structure that no longer
holds once more code lands.

## Working conventions

### Language and tooling

**Python 3.10+**, linted and formatted with **ruff**, tested with **pytest**.
Stay on it unless there is a concrete reason not to.

Two rules the first change established, worth keeping:

- New code ships with its own runnable check in the same change, wired into
  `.github/workflows/ci.yml` so agent-authored PRs are actually verified.
- Keep the dependency floor low. `scripts/face_agent.py` is stdlib-only at its
  core and imports opencv/dlib lazily inside the backends, which is why the
  test suite runs in CI with neither installed. Anything new that needs a heavy
  dependency should isolate it the same way.

Prefer the standard, boring choice for the ecosystem over anything clever — this
repo's audience is other agents, and predictable layout matters more than taste.

### Commands

```bash
pip install -r requirements-dev.txt   # dev setup (adds pytest, ruff, pyinstaller)
pytest                                # full suite; needs no camera or vision libs
ruff check .                          # lint
ruff format --check .                 # formatting (CI runs this too)

python scripts/face_agent.py doctor   # face-agent health check
python scripts/build_executable.py    # freeze to dist/face-agent[.exe]
```

There is no typecheck step. Do not invent commands or claim a check passed when
you have not run it.

### Layout for new code

When adding the first real code, keep the root uncluttered:

- `.github/` — App manifest, workflows, issue/PR templates, `CODEOWNERS`.
- `scripts/` — standalone operational scripts agents run.
- `src/` (or the ecosystem's convention) — reusable library code.
- `tests/` — pytest suite, mirroring the module under test.
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
