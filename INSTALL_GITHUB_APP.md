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
| **Workflows / Actions** | `Read & Write` | Trigger CI checks (`workflow_dispatch`) |
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

## Step 5: Verify Agent Authentication

Run the test suite or interactive dashboard workbench:
```bash
npm run dev
```
Open `http://localhost:3000` and use the built-in **Auth Simulator** and **PR Pipeline Workbench** to test agent actions safely.
