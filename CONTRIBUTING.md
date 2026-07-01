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

Any build — `npm run build`, `vite build`, or `npm run dev` (watch) — **optionally** installs the built plugin into a local Obsidian vault for in-app iteration. To opt in, set `OBSIDIAN_TEST_VAULT` to an existing vault path in a gitignored `.env` (see `.env.example`); each machine can use its own path. If it is unset or the path doesn't exist, the install is skipped and the build still succeeds — so this is never required to contribute, and CI is unaffected. (You can also run it manually: `npm run install:vault`.)

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

## Releasing

Releases are cut by the maintainer. Release notes live one file per version under
`docs/releases/` (see [`docs/releases/unreleased.md`](docs/releases/unreleased.md)
for the format), are drafted by the `/tng-release` command, and feed the GitHub release
body, the in-app "What's New" view, and the [`docs/releases.md`](docs/releases.md)
index. The full procedure (beta → prod, the review/publish gate) is in
[`docs/RELEASING.md`](docs/RELEASING.md).

## Reporting bugs and requesting features

Open a [GitHub issue](../../issues) with steps to reproduce (for bugs) or a clear use case (for features).
