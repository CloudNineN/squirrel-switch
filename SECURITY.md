# Security Policy

Squirrel Switch manages sensitive local credentials. Please report security issues responsibly.

## Sensitive Data

Never publish or attach:

- Real `~/.codex/auth.json`
- Access tokens, refresh tokens, id tokens, API keys, or cookies
- `~/.squirrel-switch/squirrel-switch.sqlite`
- `~/.squirrel-switch/master-key`
- Account backup JSON files
- Runtime logs that include secrets or full raw API responses

## Reporting A Vulnerability

Open a private report if GitHub Security Advisories are enabled for the repository. If private reporting is not available yet, open a minimal public issue that says a security report is available, without including secrets or exploit details.

Please include:

- Affected version or commit
- Operating system
- Short description of the impact
- Reproduction steps without real credentials

## Local Threat Model

Squirrel Switch is a local-first tool. It does not need a remote service to manage accounts. The main risks are accidental disclosure of credential files, unsafe backups, unsafe logs, or malicious local access to the user's machine.

## 中文说明

Squirrel Switch 会处理敏感本地凭据。请不要公开发布真实 `auth.json`、token、API key、数据库、主密钥、账号备份或包含敏感信息的日志。

如果仓库启用了 GitHub Security Advisories，请优先私下报告安全问题；如果暂未启用，可以先开一个不含细节和密钥的公开 issue，说明有安全报告需要私下沟通。
