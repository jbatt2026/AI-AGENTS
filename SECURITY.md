# Security Guidelines for AI-AGENTS Repository

This document outlines security best practices for all developers and AI agents working with the AI-AGENTS repository.

---

## 1. Credential Management

### ❌ NEVER DO
- Commit `.pem` files, private keys, or `.env` files with real credentials
- Hardcode API keys, tokens, or passwords in source code
- Share credentials in git history or pull request comments
- Push to public repositories with exposed secrets

### ✅ DO
- Store credentials in `.env.local` (git-ignored, never committed)
- Use GitHub Actions Secrets for CI/CD workflows
- Use cloud platform secret managers (AWS Secrets Manager, GCP Secret Manager) for deployments
- Reference credentials via environment variables only
- Rotate compromised credentials immediately

### Setup

```bash
# Enable pre-commit hook to prevent accidental secret commits
git config --local core.hooksPath .githooks

# Create local .env file with your credentials (git-ignored)
cp .env.example .env.local

# Edit .env.local and add real values
# This file will never be committed
```

---

## 2. Scanning & Detection

### Pre-commit Hook
Local `.githooks/pre-commit` scans before commit:
- ✓ Prevents `.env.local` from being committed
- ✓ Detects private keys (RSA, EC, OpenSSH formats)
- ✓ Warns about hardcoded API keys and tokens
- ✓ Can be bypassed with `git commit --no-verify` (only in emergencies)

### GitHub Actions CI Workflow
`.github/workflows/agent-pr-check.yml` scans every PR:
- ✓ Private keys (RSA, EC, OpenSSH)
- ✓ API key patterns
- ✓ Bearer tokens and OAuth credentials
- ✓ AWS access key patterns
- ✓ GitHub personal access tokens
- ✓ TypeScript compilation (no secrets in code)

### Patterns Detected

| Secret Type | Pattern | Example |
|------------|---------|---------|
| RSA Private Key | `BEGIN RSA PRIVATE KEY` | `-----BEGIN RSA PRIVATE KEY-----` |
| GitHub Token | `ghp_` or `ghu_` prefix | `ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ1234` |
| AWS Access Key | `AKIA` + 16 alphanumerics | `AKIAIOSFODNN7EXAMPLE` |
| API Key | `api_key=<20+ chars>` | `api_key="sk_test_4eC39HqLyjWDarhtT..."` |

---

## 3. GitHub App Permissions

The AI-AGENTS GitHub App has been configured with minimal necessary permissions:

| Resource | Permission | Reason |
|----------|-----------|--------|
| Repository contents | Write | Create branches, push commits |
| Pull requests | Write | Create and update PRs, comment |
| Issues | Write | Read tasks, create issues |
| Checks | Write | Report validation results |
| Workflows | **Read-only** | View CI status, don't modify pipelines |
| Actions | **Read-only** | View action results, don't modify workflows |
| Metadata | Read-only | Mandatory GitHub default |

### Permission Rationale
- **Write permissions limited to:** contents, pull_requests, issues, checks
- **Read-only for workflows/actions:** Prevents compromised app from modifying CI/CD pipeline
- **No delete permissions:** Prevents accidental data loss

---

## 4. Development Server Security

### Port 3000 Configuration

**Default (Secure):**
```bash
npm run dev
# Binds to localhost:3000 (only accessible locally)
```

**Network Access (Development Only):**
```bash
# Only on trusted networks (internal, VPN, etc.)
VITE_HOST=0.0.0.0 npm run dev
# Now accessible from any machine on the network
```

**Custom Port:**
```bash
VITE_PORT=5000 npm run dev
```

### Production Deployment
- **Never** use `VITE_HOST=0.0.0.0` in production
- **Always** run behind a reverse proxy (Nginx, AWS ALB, Cloud Load Balancer)
- **Always** use HTTPS/TLS
- **Always** implement authentication and rate limiting
- **Always** run with minimal privileges (non-root user)

---

## 5. Webhook Security

### Current Status
- Webhook URL: Environment variable `GITHUB_WEBHOOK_URL` (see `.env.example`)
- Webhook signature: Required `GITHUB_APP_WEBHOOK_SECRET` (stored in GitHub Secrets)
- Webhook status: Inactive until deployed

### When Deploying Webhook

1. **Implement webhook handler** that:
   - Validates GitHub webhook signature using `GITHUB_APP_WEBHOOK_SECRET`
   - Uses HTTPS/TLS only
   - Responds within 30 seconds (async processing for long tasks)
   - Logs all requests (for audit trail)

2. **Update manifest:**
   ```bash
   # Set in GitHub Actions Secrets first
   GITHUB_WEBHOOK_URL=https://your-endpoint.example.com/api/github/webhook
   ```

3. **Validate signature (example in Node.js):**
   ```javascript
   const crypto = require('crypto');
   
   function validateWebhookSignature(secret, payload, signature) {
     const hmac = crypto.createHmac('sha256', secret);
     hmac.update(payload);
     const expected = 'sha256=' + hmac.digest('hex');
     return crypto.timingSafeEqual(expected, signature);
   }
   ```

---

## 6. For AI Agents

### Rules

✅ **DO:**
- Scan for hardcoded secrets before pushing
- Use branch naming convention: `agent/<agent-name>-<task-slug>`
- Include attribution footer in PR body
- Read `.env.example` and `.SECURITY.md` before making credential-related changes
- Ask for clarification if credential handling seems unsafe

❌ **DON'T:**
- Commit `.env.local` or any `.env.*` files
- Create GitHub App credentials without explicit permission
- Disable or skip security checks in CI
- Commit credentials "temporarily" with a promise to remove later
- Modify GitHub App permissions without review

### Pre-PR Checklist

Before opening a pull request:

```bash
# 1. Run linter/type-check
npm run lint

# 2. Run build
npm run build

# 3. Check for secret patterns manually
grep -r "BEGIN.*PRIVATE KEY\|api_key=\|ghp_\|AKIA" . --exclude-dir=node_modules

# 4. Review .env changes
git diff --cached .env.example

# 5. Ensure no .env.local in staging
git diff --cached --name-only | grep -v ".env.example" | grep "\.env"
```

---

## 7. Incident Response

### If You Find Exposed Credentials

1. **STOP immediately** — Do not proceed with the commit/push
2. **Notify maintainer** — Flag the issue in the PR comment or GitHub issue
3. **Do NOT rewrite history** — Don't force-push or amend to "hide" the secret
4. **Request rotation** — Ask for the credential to be rotated by the owner
5. **Document the leak** — Add a note in the PR explaining what was exposed and when it was rotated

### If Credentials Are Accidentally Committed

1. Contact repository maintainer immediately
2. The exposed credential **must be rotated** (GitHub will automatically revoke exposed tokens)
3. Optionally: Run `git-filter-repo` to remove from history (only if critical)
4. Document in repository security logs

---

## 8. Resources

- [GitHub App Security Best Practices](https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps/best-practices-for-creating-a-github-app)
- [GitHub Secrets Management](https://docs.github.com/en/actions/security-guides/encrypted-secrets)
- [OWASP Secrets Management](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html)
- [Git Pre-commit Hooks](https://git-scm.com/book/en/v2/Customizing-Git-Git-Hooks)
- [TruffleHog Secret Scanner](https://github.com/trufflesecurity/trufflehog)

---

## 9. Questions?

If you're unsure about credential handling, security implications, or webhook configuration:
- Ask in the PR comments
- Refer to `.env.example` for variable descriptions
- Review CONTRIBUTING.md for agent guidelines
- Check CLAUDE.md for repo conventions

**Better to ask for clarification than to accidentally commit a secret.**
