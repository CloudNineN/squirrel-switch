# Contributing

Thanks for helping improve Squirrel Switch.

## Before You Start

- Do not include real credentials, `auth.json`, API keys, database files, logs, or account backups in issues or pull requests.
- Keep changes focused. Small pull requests are easier to review.
- Match the existing TypeScript, React, and CSS style.
- For UI text, update both Simplified Chinese and English entries in `apps/web/src/i18n.tsx`.

## Development

```bash
corepack pnpm install
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm build
```

## Pull Request Checklist

- The change is scoped to one feature or fix.
- `corepack pnpm typecheck` passes.
- User-facing text is bilingual where applicable.
- Sensitive data is not logged, committed, or shown in screenshots.

## 中文说明

欢迎贡献 Squirrel Switch。

- 不要在 issue 或 pull request 中包含真实凭据、`auth.json`、API key、数据库、日志或账号备份。
- 尽量保持改动聚焦，便于 review。
- UI 文案需要同步更新 `apps/web/src/i18n.tsx` 中的中英文。
- 提交前建议运行 `corepack pnpm typecheck`。
