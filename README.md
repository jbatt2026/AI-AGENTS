# AI-AGENTS

HELP BUILD AND ADD TOOLS AND SCRIPTS TO AGENT CODE

This repository hosts tools, scripts, and integrations to enable automated AI agents (for example: Hermes and Claude) to create, update, and manage code via GitHub. The repo is public and intended to be configured with a GitHub App so authorized agents can open pull requests and interact programmatically.

What this repo contains
- Guidance and templates for installing a GitHub App that agents can use to create PRs.
- CONTRIBUTING.md with contributor and agent guidelines.
- CODEOWNERS to direct reviews/ownership.
- Example GitHub Actions workflow that runs basic checks on agent-created PRs.

How agents should be used
1. Install the provided GitHub App (see .github/GITHUB_APP_MANIFEST.json and INSTALL_GITHUB_APP.md) or create an app with the same permissions.
2. Configure the app's webhook and generate an installation token for the repository.
3. Agents (Hermes, Claude, or other bots) use the app's installation token to create branches and open pull requests.

For detailed installation and configuration steps for the GitHub App, see INSTALL_GITHUB_APP.md.
