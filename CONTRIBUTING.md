# Contributing

Thanks for your interest in improving TaskNotes Gantt.

## Prerequisites

- **Node.js 20** (the toolchain targets Node 20; a version manager such as `fnm`/`nvm` is recommended).
- npm (the repo uses `package-lock.json`).

## Setup

```bash
npm ci
```

## Common tasks

| Task | Command |
|------|---------|
| Build the plugin (outputs to `dist/`) | `npm run build` |
| Watch build | `npm run dev` |
| Type-check (svelte-check) | `npm run typecheck` |
| Lint (ESLint) | `npm run lint` |
| Format (Prettier) | `npm run format` |
| Unit tests (Jest) | `npm test` |
| End-to-end tests (WebdriverIO + Obsidian) | `npm run e2e` |

`npm run build` also installs the built plugin into a local vault via `scripts/install-to-vault.cjs`, which reads `OBSIDIAN_TEST_VAULT` from a `.env` file (see `.env.example` if present). Set it to your test vault path for in-Obsidian iteration.

The e2e suite downloads Obsidian and the TaskNotes release through `wdio-obsidian-service`; set `GITHUB_TOKEN` in the environment to avoid GitHub API rate limits during that download.

## Conventions

- **Conventional Commits** (`feat:`, `fix:`, `chore:`, `docs:`, `test:`, …). Commit scopes are optional (e.g. `feat(gantt): …`).
- A **pre-commit hook** (Husky) runs `npm run lint && npm run typecheck`; both must pass. Do not bypass it with `--no-verify`.
- Changes that alter behavior should come with unit and/or e2e tests.
- Follow the existing code style and the patterns in neighboring files.

## Pull requests

1. Branch from `main` with a descriptive name (`feat/…`, `fix/…`, `chore/…`).
2. Keep PRs focused; reference any related issue.
3. Ensure `npm run lint`, `npm run typecheck`, `npm test`, and the build pass locally.
4. Describe what changed and how you verified it.

## Reporting bugs and requesting features

Open a [GitHub issue](../../issues) with steps to reproduce (for bugs) or a clear use case (for features).
