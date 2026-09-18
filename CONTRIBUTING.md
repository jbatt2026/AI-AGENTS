# Contributing Guidelines for AI Agents and Human Developers

Welcome to **AI-AGENTS**! This repository is designed for both human engineers and autonomous AI agents (such as Hermes, Claude Code, and Gemini agents) collaborating on code generation and automated repository tooling.

---

## Guidelines for AI Agents

All automated agents operating in this repository must follow these strict operational principles:

### 1. Atomic, Scoped Changes
- **Branch Naming**: All agent branches must follow `agent/<agent-name>-<short-task-slug>` (e.g., `agent/claude-lint-fix`, `agent/hermes-add-manifest-tool`).
- Keep pull requests strictly scoped to the exact user prompt or issue. Avoid unprompted refactoring of unrelated files.

### 2. Required Attribution Footer
Every Pull Request and issue comment authored by an agent MUST end with an attribution block:

```markdown
> Generated with [Claude Code](https://claude.ai/code) / [AI-AGENTS](https://github.com/jbatt2026/AI-AGENTS)
> Co-Authored-By: Claude <noreply@anthropic.com>
```

### 3. Verification Before Push
- Always run local validation scripts (`npm run build`, `npm run dev`) before opening a pull request.
- Ensure all CI workflow checks pass. Never skip or disable a test to force a green check.

### 4. Secret Safety
- **NEVER** commit `.pem` private keys, installation tokens, OAuth secrets, or `.env` files.
- Always read credentials from environment variables (`GITHUB_APP_PRIVATE_KEY`, etc.).

---

## Guidelines for Human Contributors

1. Review agent-submitted PRs using GitHub's review workflow.
2. If an agent PR requires revisions, comment directly with clear, actionable technical instructions; the agent webhook will parse comments and push update commits.
3. Keep `CLAUDE.md` and `INSTALL_GITHUB_APP.md` up-to-date when introducing new commands or workflows.
