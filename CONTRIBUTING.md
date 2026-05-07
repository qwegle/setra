# Contributing

Thanks for contributing to Setra.

## Workflow

1. Fork the repository.
2. Create a branch from `main` with a descriptive name.
3. Make focused changes with tests or validation where relevant.
4. Open a pull request with a clear summary, screenshots or logs if helpful, and linked issues.

## Development setup

```bash
git clone https://github.com/qwegle/setra
cd setra
cp .env.example .env
pnpm install
pnpm --filter @setra/server build
```

Requirements:

- Node.js 20+
- pnpm 9+
- Bun is optional for local workflows, but not required
- Configure any provider keys you need in `.env` or in the Settings UI after startup

## Code style

- Run `pnpm lint` before opening a PR
- Format and lint with Biome
- Keep TypeScript strict and prefer typed interfaces over `any`
- Keep changes scoped; avoid unrelated refactors in the same PR

## Questions

- Open a GitHub issue for bugs or unclear behavior
- Use GitHub Discussions (or an issue if Discussions are not enabled) for setup questions and design conversations
