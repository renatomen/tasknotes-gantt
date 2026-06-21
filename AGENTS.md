# AGENTS.md

Project guidelines for both AI agents and human collaborators. This is the always-apply core; the detailed conventions live in [`docs/conventions/`](docs/conventions/) and are linked per section.

## Project

**TaskNotes Gantt** — an Obsidian plugin that renders a Gantt timeline as a Bases view, built on SVAR Svelte Gantt. It works standalone as a read-only timeline over any Base, and acts as a companion to **TaskNotes** (enrichment: dependency edges, task editing via TaskNotes' modal/menus). See [README.md](README.md) for the full picture.

- Plugin id: `tasknotes-gantt`. Bases view type: `obsidianGantt`.
- The SVAR Gantt library is bundled into `main.js` at build time (single-file plugin output).
- `project_tracker: github` — issues tracked on `renatomen/tasknotes-gantt` (GitHub Issues).

## How we work

This project uses the **compound-engineering** flow: brainstorm → plan → work → review.
- Requirements live in `docs/brainstorms/`, plans in `docs/plans/`, durable learnings in `docs/solutions/`.
- Check `docs/solutions/` for prior learnings before starting work in a documented area — organized by category (e.g. `integration-issues/`, `logic-errors/`) with YAML frontmatter (`module`, `tags`, `problem_type`) for searching.

**Agent skills** — Pinned in `skills-lock.json` (committed); the fetched content lives in `.agents/skills/` and `.claude/skills/` (gitignored, like `node_modules`). Managed by the [`skills`](https://github.com/vercel-labs/skills) CLI. After a fresh clone, restore with:

```bash
# Restore everything pinned in skills-lock.json (npm-ci style).
# Note: lockfile restore is experimental in the current skills CLI.
npx skills experimental_install

# Explicit fallback (always works) — re-add the pinned skill directly:
npx skills add svar-widgets/skills --skill svar-svelte
```

## Always-apply standards

**Testing** — Test-first (red→green→refactor). Jest unit tests (`*.test.ts`), WebdriverIO e2e against real Obsidian. Mock Obsidian APIs via dependency injection. One behavior per test, descriptive names, AAA. → [testing.md](docs/conventions/testing.md)

**TypeScript** — `strict` on, no `any`, interfaces for complex objects, barrel exports. Type Obsidian API interactions properly. → [typescript.md](docs/conventions/typescript.md)

**Architecture** — Modular, low-coupling, dependency injection over globals. **Data adapters extract raw values; views format for display.** → [architecture.md](docs/conventions/architecture.md), [data-formatting.md](docs/conventions/data-formatting.md)

**Naming** — Code as communication: intention-revealing names, verb-based function names, no cryptic abbreviations, named constants over magic values. → [naming.md](docs/conventions/naming.md)

**Code quality** — Single responsibility, short functions, ≤3–4 params (else an options object), guard clauses over deep nesting. → [code-quality.md](docs/conventions/code-quality.md)

**Obsidian plugin structure** — No god-`main.ts`; factories + DI for commands/views; correct `onload`/`onunload`. → [obsidian-plugin.md](docs/conventions/obsidian-plugin.md)

**Git** — Conventional commits, atomic, **branch first (never commit to `main` unprompted)**, **squash-merge** PRs behind green CI, and **no AI attribution** on commits/PRs/issues. Commit/push when the work calls for it or the maintainer asks. → [git-workflow.md](docs/conventions/git-workflow.md)

**Refactoring & documentation** — Test-covered, incremental, separate commits; JSDoc public APIs and explain *why*. → [refactoring.md](docs/conventions/refactoring.md), [documentation.md](docs/conventions/documentation.md)
