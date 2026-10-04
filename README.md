# AI-AGENTS

AI-AGENTS is a TypeScript/Vite studio plus a runnable Telegram AI gateway. The gateway follows the useful parts of the Hermes/Nous setup pattern—one setup flow, one messaging surface, selectable models, and provider fallback—while remaining independent and using credentials you control.

## Telegram agent quick start

Requirements: Node.js 22 or newer and a Telegram bot token from [@BotFather](https://t.me/BotFather).

```bash
npm ci
npm run agent:setup
npm run agent:doctor
npm run agent:start
```

The setup wizard creates two git-ignored files:

- `.env.local` contains the Telegram token, user allowlist, and provider keys.
- `agent.config.json` contains the system prompt and ordered provider pool.

No API keys belong in `agent.config.json`. The tracked [`agent.config.example.json`](agent.config.example.json) shows every supported adapter.

### Telegram commands

| Command | Behavior |
| --- | --- |
| `/new` | Clear the current chat history. |
| `/model` | Show configured and ready brain providers. |
| `/model <id>` | Prefer a provider for this Telegram chat. |
| `/status` | Show session, provider, and last-model status. |
| `/help` | Show the command menu. |

Only IDs in `TELEGRAM_ALLOWED_USERS` can use the bot. Each chat gets isolated in-memory history. When its preferred provider fails, the router tries the remaining ready providers in configuration order and labels the fallback in the response.

Unauthorized users are ignored without a response. Group chats are blocked by default because every group member can read bot replies; set `TELEGRAM_ALLOW_GROUPS=true` only when that exposure is intentional.

### Brain platforms

The gateway ships three provider protocols:

- `openai-compatible` for OpenAI, OpenRouter, Ollama, and compatible gateways
- `anthropic` for the Anthropic Messages API
- `gemini` for Google Gemini `generateContent`

Add, remove, or reorder providers in your ignored `agent.config.json`. Every provider requires `id`, `type`, `baseUrl`, and `model`. `apiKeyEnv` is optional for OpenAI-compatible providers, which allows credential-free local services.

```json
{
  "id": "my-gateway",
  "label": "My Gateway",
  "type": "openai-compatible",
  "baseUrl": "https://gateway.example/v1",
  "model": "my-model",
  "apiKeyEnv": "MY_GATEWAY_API_KEY"
}
```

This project does not copy Nous Portal authentication or claim compatibility with a Nous subscription. It mirrors the public gateway workflow and can connect to any service that exposes one of the supported APIs.

## Web studio

```bash
npm run dev
```

Open `http://localhost:3000`. The Agent Gateway tab visualizes the Telegram → session gateway → fallback router → model flow. The remaining tabs provide GitHub App, pull-request, auth, scripts, and documentation prototypes.

## Validation

```bash
npm test
npm run lint
npm run build
python3 .github/scripts/scan_secrets.py .
```

## Security

- Never commit `.env.local`, `agent.config.json`, private keys, bot tokens, or provider credentials.
- Keep `TELEGRAM_ALLOWED_USERS` narrow. The gateway fails closed when it is empty.
- Provider endpoints require HTTPS; plain HTTP is accepted only for loopback services such as local Ollama.
- Gemini credentials are sent in the `x-goog-api-key` header rather than the URL.
- Run the agent under a process manager on a host you control if it must stay online.
- The current gateway sends text to the selected model provider. It does not execute shell commands or expose repository tools.

GitHub automation guidance remains in [`INSTALL_GITHUB_APP.md`](INSTALL_GITHUB_APP.md), [`CONTRIBUTING.md`](CONTRIBUTING.md), and [`CLAUDE.md`](CLAUDE.md).
