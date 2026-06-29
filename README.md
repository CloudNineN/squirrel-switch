# Squirrel Switch

[简体中文](README.zh-CN.md)

Local multi-account switcher for AI developer tools. Squirrel Switch currently focuses on Codex account session management: save encrypted login states, switch accounts with one click, inspect 5-hour and weekly/monthly quota windows, and migrate accounts between Macs.

## Highlights

- Local-first: credentials stay on your machine and are encrypted with AES-256-GCM.
- Codex account switching: atomically writes `~/.codex/auth.json` and can restart a running Codex.app.
- Account health view: shows quota windows, subscription metadata when available, refresh status, and recommended account.
- Scheduled refresh: refresh all accounts within a daily time window.
- Claude Code profile switching: manage provider profiles and apply them to user or project settings.
- Prompt management: edit the default global prompt files used by local AI tools.
- Bilingual UI: Simplified Chinese and English, with an in-app language selector.

## Screenshots

### Codex Accounts

![Codex account overview](docs/screenshots/codex-accounts.png)

### Add A Codex Account

![Add a Codex account](docs/screenshots/add-codex-account.png)

### Scheduled Refresh

![Scheduled account refresh](docs/screenshots/scheduled-refresh.png)

### Claude Code Profiles

![Claude Code provider profiles](docs/screenshots/claude-code-profiles.png)

### Prompt Management

![Global prompt management](docs/screenshots/prompt-management.png)

## Install And Run

Requirements:

- Node.js 22+
- Corepack
- pnpm via Corepack
- macOS for the best desktop experience today

```bash
corepack pnpm install
corepack pnpm dev
```

Default local services:

- Server: `http://127.0.0.1:3210`
- Web dev server: `http://127.0.0.1:5173`
- Local database: `~/.squirrel-switch/squirrel-switch.sqlite`
- Master key: macOS Keychain first, fallback to `~/.squirrel-switch/master-key`

Current version: `V1.12.0`

## Desktop App

```bash
corepack pnpm desktop
```

This builds the web and server packages, starts Electron, and launches a local Fastify server. If port `3210` is occupied, Squirrel Switch tries the next available port.

## Packaging

macOS:

```bash
corepack pnpm package:mac
```

Generate only the `.app` bundle:

```bash
corepack pnpm package:mac:app
```

Windows:

```bash
corepack pnpm package:win
```

The macOS package script currently uses local ad-hoc signing. It verifies bundle structure and code signature consistency, but it is not the same as Apple Developer ID signing or notarization. For stable distribution to other users, sign with a Developer ID Application certificate and submit for Apple notarization.

## Security And Privacy

Squirrel Switch handles sensitive login state files. Please read [SECURITY.md](SECURITY.md) before publishing releases or accepting user reports.

Important notes:

- Do not commit real `auth.json`, API keys, database files, logs, or backup files.
- Account backups contain credentials that can directly sign in. Export only the accounts you need, use backups only for your own device migration, and delete transit copies after import.
- Runtime logs should not include access tokens, refresh tokens, id tokens, full `auth.json`, or complete raw API responses.

## Project Structure

```text
apps/
  desktop/   Electron shell
  server/    Local Fastify API and persistence
  web/       React UI
packages/
  shared/    Shared types and version metadata
scripts/     Build and packaging scripts
docs/        Design notes
```

## Development

```bash
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm build
```

## Contributing

Issues and pull requests are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) first.

## Support

If this project helps you, a star is the best support.

Donation links can be added later, for example PayPal, GitHub Sponsors, or a WeChat QR code. Keep donations framed as support for maintenance, not paid unlocks.

## License

[GNU General Public License v3.0 or later](LICENSE)
