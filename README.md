# AI-AGENTS

HELP BUILD AND ADD TOOLS AND SCRIPTS TO AGENT CODE

This repository hosts tools, scripts, and integrations to enable automated AI agents (for example: Hermes and Claude) to create, update, and manage code via GitHub. The repo is public and intended to be configured with a GitHub App so authorized agents can open pull requests and interact programmatically.

What this repo contains
- `scripts/face_agent.py` — local facial recognition an agent can call over MCP or a loopback HTTP API. See [docs/FACE_AGENT.md](docs/FACE_AGENT.md).
- `.github/workflows/ci.yml` — lint and tests on every push and pull request.

Planned, not yet written: guidance and templates for installing a GitHub App
that agents can use to create PRs, CONTRIBUTING.md, and CODEOWNERS.

## Tools

### face-agent

Enroll faces, identify them from a photo or webcam, and expose that to an AI
agent as a set of tools. Everything stays on the machine — embeddings live in a
local SQLite file and the HTTP API binds to loopback with a bearer token.

```bash
pip install -r requirements.txt
python scripts/face_agent.py models --download
python scripts/face_agent.py doctor

python scripts/face_agent.py enroll --name "Jane" --images ./photos/jane
python scripts/face_agent.py identify --camera --json
```

Connect an agent over MCP:

```bash
claude mcp add face-agent -- python /path/to/scripts/face_agent.py mcp
```

Or build a standalone executable to drop on a PC with no Python:

```bash
pip install pyinstaller && python scripts/build_executable.py
```

Face templates are biometric data — only enroll people who have agreed to it.
Full setup, agent integration, and limitations: [docs/FACE_AGENT.md](docs/FACE_AGENT.md).

How agents should be used
1. Install the provided GitHub App (see .github/GITHUB_APP_MANIFEST.json and INSTALL_GITHUB_APP.md) or create an app with the same permissions.
2. Configure the app's webhook and generate an installation token for the repository.
3. Agents (Hermes, Claude, or other bots) use the app's installation token to create branches and open pull requests.

For detailed installation and configuration steps for the GitHub App, see INSTALL_GITHUB_APP.md.
