# Contributing

The project is licensed under [Apache License 2.0](LICENSE). Contributions are provided under the same license. Preserve the existing third-party copyright and license notices.

Use Node 24+ and pnpm 12.14.0. Install with `pnpm install --frozen-lockfile`; copy `.env.example` to `.env.local` for local settings. Never commit credentials, real inventory, recordings, or event-specific prize artwork.

Before submitting a change:

```sh
pnpm verify
pnpm exec playwright install chromium
pnpm test:ui
```

Format changed source and documentation with Prettier. Keep English and Chinese UI copy together. Use readable conversational English. Preserve user-authored inventory names and operation reasons verbatim.

Test behavior at public seams: HTTP, real SQLite, the Agora SDK request boundary, browser media events, and the restore CLI. Cloud and hardware tests require separate credentials and equipment; do not claim the automated suite covers them.

Gift allocation, stock, and timing belong to the server. Games are prompt-based; do not add per-utterance LLM observers or scoring without explaining the product change. See [the one-pager](docs/one-pager.md) and [tutorial](docs/ai/RECIPE.md).
