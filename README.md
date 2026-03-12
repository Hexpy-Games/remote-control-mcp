# remote-control-mcp

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20.16-green)](https://nodejs.org)
[![MCP SDK](https://img.shields.io/badge/MCP%20SDK-1.24-purple)](https://github.com/modelcontextprotocol/typescript-sdk)

An MCP server that gives AI services (Claude, Cursor, etc.) remote control of your Mac — execute shell commands, read/write files, and run AppleScript — secured with OAuth 2.0 + PKCE.

## Demo

![remote-control-mcp demo](./demo.gif)

> Claude searches for a tteok shop on Naver Maps, gets driving directions, takes a screenshot, and emails the result. All done in the Claude app on iOS.

---

## What it does

- Exposes your Mac as an MCP server reachable over the internet through a secure tunnel
- Runs shell commands (`zsh`) asynchronously and returns stdout, stderr, and exit code
- Reads and writes files and directories using `fs.promises` — no shell injection surface
- Executes AppleScript for UI automation and app control
- Protects every tool call with OAuth 2.0 + PKCE; token rotation revokes old tokens immediately
- Optional file server (port 3835) to share files from `~/Public/mcp-files/` via browser or any HTTP client

---

## ⚠️ Security Warning

This server provides **remote shell execution** on your Mac.

- **OAuth 2.0 + PKCE** protects the MCP endpoint — valid tokens are required for all tool calls
- **No credential gate on authorization** — the approval page is a single-click. Anyone who can reach `/authorize` can obtain a token.
- **The network layer is your primary defense** — always expose the server through an authenticated tunnel. Never bind directly to a public IP.

**This server is designed for personal, single-user use behind a private tunnel. Do not expose it to untrusted networks.**

---

## Requirements

- **macOS** (Linux support planned; AppleScript tools are macOS-only)
- **Node.js** `>=20.16.0` or `>=22.3.0`
- A tunnel to expose the server — Cloudflare Tunnel, ngrok, or Tailscale (see below)
- **Redis** (required in production for token persistence; in-memory fallback used without it)

---

## Quick Start

### Automated (recommended)

`setup.sh` handles everything interactively — dependencies, `.env`, build, tunnel, LaunchAgent, and CLI:

```bash
git clone https://github.com/hexpy-games/remote-control-mcp
cd remote-control-mcp
./setup.sh
```

### Manual

```bash
git clone https://github.com/hexpy-games/remote-control-mcp
cd remote-control-mcp
npm install
cp .env.example .env
# Edit .env — set BASE_URI to your tunnel URL
npm run build
npm start
```

Then set up a tunnel (see below) and add the server URL to your AI client.

---

## Tunnel Options

Never bind the server directly to a public IP. Use one of the following:

### Option 1: Cloudflare Tunnel (recommended — free, stable URL)

```bash
brew install cloudflared

# Quick one-shot (URL changes each run)
cloudflared tunnel --url http://localhost:3232

# Permanent subdomain (requires free Cloudflare account)
cloudflared tunnel login
cloudflared tunnel create remote-control-mcp
cloudflared tunnel route dns remote-control-mcp your-subdomain.yourdomain.com
# Set BASE_URI=https://your-subdomain.yourdomain.com in .env
cloudflared tunnel run remote-control-mcp
```

### Option 2: ngrok (quick setup, generous free tier)

```bash
brew install ngrok
ngrok config add-authtoken <your-token>
ngrok http 3232
# Copy the https URL and set it as BASE_URI in .env
```

The ngrok free tier assigns a random URL on each restart. Use a paid plan for a stable domain.

### Option 3: Tailscale Funnel

```bash
brew install tailscale
tailscale up
tailscale funnel 3232
# Copy the https URL and set it as BASE_URI in .env
```

### Option 4: Direct IP (advanced)

Use only if you understand the risks:

1. Forward port 3232 on your router to your Mac
2. Set `BASE_URI` to your domain or public IP
3. Terminate TLS yourself — plain HTTP exposes OAuth tokens

```bash
# Example: Caddy as a TLS-terminating reverse proxy
brew install caddy
# Caddyfile:
# your-domain.com {
#   reverse_proxy localhost:3232
# }
caddy run
```

---

## Connect to an AI client

After the server is running and a tunnel is up, add the MCP server in your AI client's settings:

```
https://your-tunnel-url/mcp
```

The client will trigger an OAuth authorization flow on first connect.

**Claude (claude.ai):** Settings → Connectors → Add MCP Server

---

## Configuration

Copy `.env.example` to `.env` and edit as needed.

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3232` | Port the MCP server listens on |
| `BASE_URI` | `http://localhost:3232` | Public URL of this server — must match your tunnel URL |
| `NODE_ENV` | `development` | Set to `production` when deploying |
| `BLOCKED_COMMANDS` | _(empty)_ | Comma-separated substrings to block in `shell_exec` |
| `REDIS_URL` | _(unset)_ | Redis connection URL — required in production |
| `REDIS_TLS` | `0` | Set to `1` to enable TLS for the Redis connection |

### Redis

Redis is **required in production** for token persistence and expiry. Without it, tokens are stored in memory and lost on restart.

```bash
# Docker
docker run -d -p 6379:6379 redis:7-alpine

# Homebrew
brew install redis && brew services start redis
```

Set `REDIS_URL=redis://localhost:6379` in `.env`.

---

## Available Tools

| Tool | Description |
|---|---|
| `shell_exec` | Execute a `zsh` command on the Mac. Runs asynchronously; supports concurrent commands. Returns stdout, stderr, and exit code. |
| `osascript` | Execute an AppleScript. Scripts are written to a private temp directory to prevent TOCTOU races. Use for UI automation and app control. |
| `file_read` | Read file contents or list a directory. Uses `fs.promises` directly — no shell spawning. |
| `file_write` | Write content to a file. Creates intermediate directories if needed. |

### Security notes

- `BLOCKED_COMMANDS` is a last-resort safeguard, **not** a security boundary. Security is enforced at the OAuth + tunnel layer.
- Refresh token rotation revokes the previous token immediately.
- A default blocklist prevents the most catastrophic commands (`rm -rf /`, fork bombs, direct disk writes, etc.).

---

## rcmcp CLI

`setup.sh` installs `rcmcp`, a management CLI for day-to-day operations:

```bash
rcmcp status                    # server + tunnel + file server status and endpoint URL
rcmcp start [server|tunnel|fileserver|all]
rcmcp stop  [server|tunnel|fileserver|all]
rcmcp restart [server|tunnel|fileserver|all]
rcmcp logs [server|tunnel|fileserver|all] [-f]
rcmcp url                       # print current MCP endpoint URL
rcmcp update                    # git pull → rebuild → restart server
rcmcp uninstall                 # remove LaunchAgents, binary, and PATH entry
```

Targets can be abbreviated: `srv`, `tun`, `fs`.

---

## File Server (optional)

`setup.sh` can install an optional lightweight file server (port 3835) that serves files from `~/Public/mcp-files/` over HTTP. Useful for sharing or viewing Mac files from any browser, HTTP client, or AI service.

```
GET https://your-tunnel-url/files/<filename>
```

Managed via `rcmcp start fileserver` / `rcmcp stop fileserver`.

---

## Development

```bash
# Run with live reload
npm run dev

# Type-check without emitting
npm run typecheck

# Lint
npm run lint

# Build
npm run build
```

---

## Contributing

### Reporting issues

- **Bug**: Open an issue with the prefix `[bug]`. Include OS version, Node version, reproduction steps, and expected vs. actual behavior.
- **Feature request**: Open an issue with the prefix `[feat]`. Describe the use case, not just the solution.

### Submitting a PR

1. Fork the repo and create a branch from `main`
2. Follow branch naming conventions:
   - `feat/` — new feature
   - `fix/` — bug fix
   - `docs/` — documentation only
   - `chore/` — tooling, deps, CI
3. Run `npm run lint` and `npm run typecheck` — both must pass
4. Open a PR against `main` with a clear description of what and why

### Commit style

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add Tailscale tunnel option
fix: prevent shell_exec hanging on commands with no output
docs: clarify Redis requirement in README
chore: upgrade MCP SDK to 1.25
```

### What gets accepted

- Security improvements
- New MCP tools that fit the "remote Mac control" scope
- Additional tunnel provider support
- Bug fixes

### What gets rejected

- Changes that remove the OAuth requirement
- Features that broaden scope to multi-user or server-side use cases

---

## License

MIT — Copyright (c) 2026 Hexpy Games & remote-control-mcp contributors

See [LICENSE](./LICENSE) for the full text.

---

## Disclaimer

This project is not affiliated with, endorsed by, or sponsored by Anthropic, Claude.ai, or any other AI service provider.
