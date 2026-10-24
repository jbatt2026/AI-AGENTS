# AI-AGENTS — Completion Guide

Verified against the tree at `f8d250e` on 2026-10-03. `npm ci`, `npm run lint` (`tsc --noEmit`) and `npm run build` all pass locally.

## 1. What exists

| Area | State |
| --- | --- |
| React 18 / Vite 6 / Tailwind 4 UI (`src/`, 5 components) | Builds clean. **Entirely simulated**: `AgentScriptsRunner` prints canned `simulatedOutput`; `TokenAuthSimulator` generates a fake token. Nothing calls GitHub. |
| `.github/GITHUB_APP_MANIFEST.json` | Present. Webhook `active: false`, URL from `${GITHUB_WEBHOOK_URL}` (see gap 3). |
| `.github/workflows/agent-pr-check.yml` | Branch-name check, attribution check (non-blocking), `npm ci`, `npm run build`, secret scan. |
| `.github/scripts/scan_secrets.py`, `.githooks/pre-commit` | Present. |
| `INSTALL_GITHUB_APP.md`, `CONTRIBUTING.md`, `SECURITY.md`, `CODEOWNERS` | Present. |
| `scripts/` (real agent tooling), tests | **Absent.** |

The README's stated purpose is tooling that lets agents authenticate as a GitHub App and open PRs. That tooling does not exist yet; only the UI mock-up and scaffolding do.

## 2. Gaps, in priority order

### P0 — correctness and security

1. **`npm run dev`/`preview` ignore the localhost default.** `package.json` hardcodes `--host 0.0.0.0`, which overrides `vite.config.ts`. `PR_AUDIT_REPORT.md` and `CLAUDE.md` claim the opposite. Fix: drop the CLI flags (let `vite.config.ts` decide) and make `preview` read the same env vars.
2. **`allowedHosts: true`** in `vite.config.ts` disables Vite's DNS-rebinding protection. Remove it, or set an explicit list when `VITE_HOST` is non-local.
3. **Manifest webhook placeholder.** `"${GITHUB_WEBHOOK_URL}"` is not expanded by GitHub; the manifest flow takes literal JSON. Either generate the manifest from a template in a script, or document that the value must be substituted before submission. Keep `active: false` until a receiver exists.
4. **Manifest permissions are broad** (`contents`, `pull_requests`, `issues`, `checks` write). Confirm each is needed; drop `issues`/`checks` if no script uses them. `workflow_dispatch` is not a webhook event GitHub accepts in `default_events` — verify against current GitHub App docs and remove if rejected.
5. **`PR_AUDIT_REPORT.md` overclaims** ("production-ready", "all resolved") while gaps 1–2 are open. Correct it or delete it; it is a dated snapshot, not documentation.

### P1 — make the repo do what the README says

6. **Real agent scripts under `scripts/`** (the planned `AgentScriptsRunner` content made real):
   - `scripts/auth.*` — mint a JWT from `GITHUB_APP_ID` + private key (from env/secret manager, never a file in the repo), exchange for an installation token. Use a maintained library (`@octokit/auth-app`) rather than hand-rolled JWT; check its current version first.
   - `scripts/open-pr.*` — create branch, commit, open **draft** PR with attribution footer and `agent/<name>-<slug>` branch naming (the CI check already enforces this).
   - `scripts/check-secrets` — thin wrapper around `scan_secrets.py`.
   Tokens are short-lived (1 h); scripts must never log them.
7. **Wire the UI to reality or label it.** Either clearly mark the five components as an interactive demo/docs site, or have them link to the real scripts. Currently a user can mistake the simulation for a working integration.
8. **Webhook receiver** (only if reacting to events is a goal): signature verification (`X-Hub-Signature-256`, constant-time compare) before anything else; then flip `active` to `true`.

### P2 — quality gates

9. **Tests.** None exist. Add Vitest; cover `scan_secrets.py` (pytest) and any `scripts/` logic with business rules (branch-name regex, footer check).
10. **CI**: add `npm run lint` (typecheck is not run separately; `vite build` does not typecheck). Add `permissions: contents: read` at workflow top level. Pin actions to SHAs or at least confirm `@v4` is still current. Make the attribution check blocking once agents reliably comply, or document that it is advisory.
11. **Dependabot** (`.github/dependabot.yml`) for npm and github-actions.
12. **Branch protection on `main`**: require the `validate` check and CODEOWNERS review (settings, not code — owner action).

### P3 — docs hygiene

13. **`CLAUDE.md` is stale**: its "Current state" section still says the repo has two files, and the backlog table lists files as missing. Rewrite that section and the commands table (update `dev` description after gap 1).
14. **`README.md`** lacks run/build instructions and a pointer to `SECURITY.md`.
15. Check `.env.example` documents only variable *names* (`GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_INSTALLATION_ID`, `GITHUB_WEBHOOK_URL`, `GITHUB_WEBHOOK_SECRET`).

## 3. Suggested PR sequence

Each is small, independently reviewable, off latest `main`, draft PR:

1. `fix: dev server host defaults` — gaps 1, 2.
2. `docs: refresh CLAUDE.md and audit report` — gaps 5, 13, 14.
3. `ci: add typecheck, least-privilege permissions, dependabot` — gaps 10, 11.
4. `fix: manifest webhook and permissions` — gaps 3, 4.
5. `feat: GitHub App auth + open-PR scripts` with tests — gaps 6, 9.
6. `feat: UI wired to scripts / demo labelling` — gap 7.
7. `feat: webhook receiver` — gap 8 (optional).

## 4. Definition of done

- An agent with only `GITHUB_APP_ID`, key, and installation ID in env can run one command and get a draft PR with the correct branch name and footer.
- `main` protected; CI (lint, build, tests, secret scan) required and green.
- No credential ever in git; `dev` binds to localhost unless explicitly overridden.
- `CLAUDE.md`, README and manifest describe what actually exists.

## 5. Not verified

Manifest event/permission validity against live GitHub docs; whether `scan_secrets.py` has tests (none are tracked); contents of `.env.example`, `SECURITY.md`, and `INSTALL_GITHUB_APP.md` beyond line counts; runtime behaviour of the UI in a browser.
