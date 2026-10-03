# Installing and Configuring the GitHub App for AI Agents

This guide explains how to configure and install a GitHub App to grant automated AI agents (such as Hermes, Claude Code, and Gemini agents) programmatic access to open pull requests, push code branches, and trigger automated verification.

---

## Architecture Overview

```
+-------------------+           +-----------------------+           +-------------------+
|                   |  JWT Auth |                       | Token     |                   |
| AI Agent (Hermes/ | --------> | GitHub App            | --------> | Target Repository |
| Claude / Gemini)  |           | (App ID + PrivateKey) |           | (Branches, PRs,   |
|                   |           |                       |           |  Checks, Actions) |
+-------------------+           +-----------------------+           +-------------------+
```

1. **GitHub App**: Acts as the bot identity with granular, scoped permissions.
2. **Private Key (`.pem`)**: Cryptographically signs JSON Web Tokens (JWT).
3. **Installation Access Token**: Short-lived (1-hour) bearer token created per target repo.

---

## Step 1: Create the GitHub App

You can create the app using the pre-configured manifest in `.github/GITHUB_APP_MANIFEST.json`:

1. Navigate to **GitHub Settings** -> **Developer settings** -> **GitHub Apps** -> **New GitHub App**.
2. Or use GitHub's App Manifest flow by submitting a POST request containing `.github/GITHUB_APP_MANIFEST.json`.
   The manifest's `hook_attributes.url` is the literal string `${GITHUB_WEBHOOK_URL}`, which GitHub does not expand. Replace it with your real HTTPS endpoint before submitting, and keep `"active": false` until a webhook receiver exists.
3. Set the following details:
   - **GitHub App name**: `ai-agents-bot` (or custom name)
   - **Homepage URL**: Your repository URL or deployment URL
   - **Webhook URL**: Your webhook endpoint (or disable Active Webhook if polling)

---

## Step 2: Configure Scopes & Permissions

Ensure the following repository permissions are configured:

| Resource | Access Level | Reason |
| :--- | :--- | :--- |
| **Repository contents** | `Read & Write` | Commit code changes and push branches (`feature/*`, `agent/*`) |
| **Pull requests** | `Read & Write` | Create, update, and comment on agent PRs |
| **Issues** | `Read & Write` | Read task context, triage bugs, and link issues |
| **Actions** | `Read-only` | Inspect workflow runs (matches `actions: read` in the manifest) |
| **Workflows** | `Read-only` | Matches `workflows: read` in the manifest |
| **Checks** | `Read & Write` | Inspect verification suites and report status |
| **Metadata** | `Read-only` | Mandatory default for GitHub Apps |

---

## Step 3: Generate Private Key & Install App

1. In your GitHub App settings, scroll to **Private keys** and click **Generate a private key**.
2. Download the `.pem` file and store it securely (e.g. in your secret manager or environment variables).
3. Click **Install App** in the sidebar.
4. Select your target account or organization and select **Only select repositories** -> Choose `AI-AGENTS`.
5. Note down your **App ID** and **Installation ID**.

---

## Step 4: Environment Configuration for Agents

Configure the following secrets in your execution environment or CI/CD runner:

```env
GITHUB_APP_ID=123456
GITHUB_APP_INSTALLATION_ID=98765432
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
GITHUB_TARGET_REPO="jbatt2026/AI-AGENTS"
```

---

## Step 5: Run the Agent

```bash
cp .env.example .env.local   # add ANTHROPIC_API_KEY and the App values from Step 4
npm run dev
```
Open `http://localhost:3000` (localhost only; set `VITE_HOST=0.0.0.0` to expose the GUI on a trusted network) and use the **Agent Chat** tab. The agent server mints installation tokens itself with `@octokit/auth-app`; the key never reaches the browser. Use a scratch repository for `GITHUB_TARGET_REPO` until you trust the setup. The Auth Simulator and PR Pipeline Workbench tabs are demos with canned output and do not contact GitHub.
