# AGENTS.md

Project guidelines for both AI agents and human collaborators. This is the always-apply core; the detailed conventions live in [`docs/conventions/`](docs/conventions/) and are linked per section.

## Project

**TaskNotes Gantt** — an Obsidian plugin that renders a Gantt timeline as a Bases view, built on SVAR Svelte Gantt. It works standalone as a read-only timeline over any Base, and acts as a companion to **TaskNotes** (enrichment: dependency edges, task editing via TaskNotes' modal/menus). See [README.md](README.md) for the full picture.

- Plugin id: `tasknotes-gantt`. Bases view type: `obsidianGantt`.
- The SVAR Gantt library is bundled into `main.js` at build time (single-file plugin output).
- `project_tracker: github` — issues tracked on `renatomen/tasknotes-gantt` (GitHub Issues).
- **Project-local slash commands use a `tng-` prefix** (e.g. `/tng-release`, `/tng-demo`) so they're distinguishable from external plugin commands. Match the existing `tng-` / `tngantt_` code namespace when adding new ones.

## How we work

This project uses the **compound-engineering** flow: brainstorm → plan → work → review.
- Requirements live in `docs/brainstorms/`, plans in `docs/plans/`, durable learnings in `docs/solutions/`.
- Check `docs/solutions/` for prior learnings before starting work in a documented area — organized by category (e.g. `integration-issues/`, `logic-errors/`) with YAML frontmatter (`module`, `tags`, `problem_type`) for searching.
- Shared domain vocabulary lives in [`CONCEPTS.md`](CONCEPTS.md) (repo root) — entities, named processes, and status concepts with project-specific meaning; relevant when orienting or discussing domain terms.
- **Deferred & residual work** is parked in [`docs/backlog.md`](docs/backlog.md) (not GitHub Issues, by choice while solo). Check it before starting new work; promote an entry to a GitHub issue when you pick it up, then delete it from the backlog. GitHub Issues = active work; the backlog = parked work.

**Agent skills** — Pinned in `skills-lock.json` (committed); the fetched content lives in `.agents/skills/` and `.claude/skills/` (gitignored, like `node_modules`). Managed by the [`skills`](https://github.com/vercel-labs/skills) CLI. After a fresh clone, restore with:

```bash
# Restore everything pinned in skills-lock.json (npm-ci style).
# Note: lockfile restore is experimental in the current skills CLI.
npx skills experimental_install

# Explicit fallback (always works) — re-add the pinned skill directly:
npx skills add svar-widgets/skills --skill svar-svelte
```

## Always-apply standards

**Testing** — Test-first (red→green→refactor). Jest unit tests (`*.test.ts`) AND **WebdriverIO e2e against real Obsidian — a first-class verification gate, not optional.** The e2e harness is wired and verified on dev machines; run it with **`npm run e2e:local`** (builds + installs + drives a real Obsidian). For any change to e2e-observable behavior, **run the relevant spec rather than deferring it — never claim e2e is unrunnable** (only driving the full real production vault *through* WDIO is walled; use a manual install + maintainer review for that one case). Mock Obsidian APIs via dependency injection. One behavior per test, descriptive names, AAA. → [testing.md](docs/conventions/testing.md)

**TypeScript** — `strict` on, no `any`, interfaces for complex objects, barrel exports. Type Obsidian API interactions properly. → [typescript.md](docs/conventions/typescript.md)

**Architecture** — Modular, low-coupling, dependency injection over globals. **Data adapters extract raw values; views format for display.** **Calendar-domain semantics (dependencies, dates, availability, scheduling) must map losslessly to the iCalendar standards family (RFC 5545 / 7953 / 9253) at every boundary** — see [standards-alignment.md](docs/architecture/standards-alignment.md). New to the `src/` tree? Start with the [source topology map](docs/architecture/overview.md). → [architecture.md](docs/conventions/architecture.md), [data-formatting.md](docs/conventions/data-formatting.md)

**Naming** — Code as communication: intention-revealing names, verb-based function names, no cryptic abbreviations, named constants over magic values. → [naming.md](docs/conventions/naming.md)

**Code quality** — Single responsibility, short functions, ≤3–4 params (else an options object), guard clauses over deep nesting. → [code-quality.md](docs/conventions/code-quality.md)

**Obsidian plugin structure** — No god-`main.ts`; factories + DI for commands/views; correct `onload`/`onunload`. → [obsidian-plugin.md](docs/conventions/obsidian-plugin.md)

**Git** — Conventional commits, atomic, **branch first (never commit to `main` unprompted)**, **squash-merge** PRs behind green CI, and **no AI attribution** on commits/PRs/issues. Commit/push when the work calls for it or the maintainer asks. → [git-workflow.md](docs/conventions/git-workflow.md)

**Refactoring & documentation** — Test-covered, incremental, separate commits. **Comments are rare: default to none — a *what/how* comment is a smell, so refactor for readability; keep only a *why/caveat* a refactor can't express (JSDoc public APIs is fine); never cite volatile refs (plan/issue IDs, `file:line`, `see docs/…`) in comments.** A pre-commit hook flags volatile refs; the rest is a review-time judgment. → [refactoring.md](docs/conventions/refactoring.md), [documentation.md](docs/conventions/documentation.md)

**Visual assets** — UI-change images/GIFs live in `docs/media/`, feature-named, referenced by pinned `raw.githubusercontent` markdown URLs (never catbox, never raw HTML). Stage demos with the in-Obsidian maximize + base-theme config via WDIO. → [visual-assets.md](docs/conventions/visual-assets.md)
