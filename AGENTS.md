# AGENTS.md

Always-apply contract for every agent and human working in this repo. This file is deliberately short — it loads into every session — and defers depth to the linked documents. Rule of the house, owned by the engineering charter: **mechanism, not memory** — an always-rule kept only by remembering it will eventually lose to momentum; invariants earn mechanical guards.

## Project

**TaskNotes Gantt** — an Obsidian plugin that renders a Gantt timeline as a Bases view, built on SVAR Svelte Gantt. It works standalone as a read-only timeline over any Base, and acts as a companion to **TaskNotes** (enrichment: dependency edges, task editing via TaskNotes' modal/menus). See [README.md](README.md) for the full picture.

- Plugin id: `tasknotes-gantt`. Bases view type: `obsidianGantt`. SVAR is bundled into `main.js` at build time (single-file plugin output).
- `project_tracker: github` — issues tracked on `renatomen/tasknotes-gantt` (GitHub Issues).
- **Project-local slash commands use a `tng-` prefix** (e.g. `/tng-release`, `/tng-demo`). Match the existing `tng-` / `tngantt_` code namespace when adding new ones.
- The maintainer is a **product manager supervising AI-agent developers**: peer review means one agent reviewing another agent's code, and the human sits at strategic arbitration points — product decisions, finding arbitration, principle changes — by exception, never as another developer in the loop.

## Where truth lives

- [STRATEGY.md](STRATEGY.md) — product strategy, audiences in order, hard boundaries, deferrals
- [CONCEPTS.md](CONCEPTS.md) — canonical vocabulary; use these names, map synonyms back
- [docs/architecture/principles.md](docs/architecture/principles.md) — seven governing principles, each with a governance test
- [docs/architecture/architecture.md](docs/architecture/architecture.md) — structural decisions and their rationale; [overview.md](docs/architecture/overview.md) is the *where*, [standards-alignment.md](docs/architecture/standards-alignment.md) the *what-must-hold*, [calendar-rfc-mapping.md](docs/architecture/calendar-rfc-mapping.md) the lossless-boundary proof
- [docs/engineering/practices.md](docs/engineering/practices.md) — the engineering charter (E1–E12) and this repo's binding: review layers, named divergences, operational stopping rules, landing cadence
- `docs/plans/` — execution specifications; `docs/brainstorms/` — requirements
- `docs/solutions/` — durable learnings: **check before solving, write after solving** (category folders, YAML frontmatter for searching)
- [docs/backlogs/backlog.md](docs/backlogs/backlog.md) — parked work (not GitHub Issues, by choice while solo); promote to an issue when picked up, then delete the entry

## How we work

This project uses the **compound-engineering** flow: brainstorm → plan → work → review. **Every implementation plan declares a landing strategy; the default is one PR per unit or named unit-cluster, merged on green before the next starts — typically shippable within ~2 hours, 4 hours is the re-slice trigger. Slicing finer than a unit is always autonomous; landing coarser — one PR spanning multiple units — needs a written cohesion reason, or maintainer consultation, by exception** (charter E2/E3 binding). The same rule bounds agent working sessions: **a session ends at its first merged PR (one unit or sanctioned unit-cluster) — or its first primary work product when nothing merges — and aborts at the nearest green checkpoint on context compaction or a state-class error; handover by mechanism (git, the plan on main, backlog), never by pushing a degraded context onward** (charter session cadence, same binding).

**Agent skills** — Pinned in `skills-lock.json` (committed); fetched content in `.agents/skills/` and `.claude/skills/` (gitignored). Managed by the [`skills`](https://github.com/vercel-labs/skills) CLI. Restore after a fresh clone: `npx skills experimental_install` (experimental) or `npx skills add svar-widgets/skills --skill svar-svelte` (always works).

## Always-apply standards

**Testing** — Test-first (red→green→refactor). Jest unit tests (`*.test.ts`) AND **WebdriverIO e2e against real Obsidian — a first-class verification gate, not optional.** Run it with **`npm run e2e:local`**; for any change to e2e-observable behavior, **run the relevant spec rather than deferring it — never claim e2e is unrunnable** (only driving the full real production vault *through* WDIO is walled). Verify at the fastest reliable tier first (principle 5). Mock Obsidian APIs via dependency injection — the DI-seamed mock is the charter's **named E9 divergence** (practices.md § Repo divergences, ruled 2026-08-14): a full facade would wrap the very surface the plugin exists to serve. One behavior per test, descriptive names, AAA. → [testing.md](docs/conventions/testing.md)

**TypeScript** — `strict` on, no `any`, interfaces for complex objects, barrel exports. Type Obsidian API interactions properly. → [typescript.md](docs/conventions/typescript.md)

**Architecture** — Modular, low-coupling, dependency injection over globals. **Data adapters extract raw values; views format for display.** **Calendar-domain semantics must map losslessly to the iCalendar standards family (RFC 5545 / 7953 / 9253) at every boundary.** The seven governing principles carry the tests — consult them before structural decisions; new to `src/`? Start with the [source topology map](docs/architecture/overview.md). → [architecture.md](docs/conventions/architecture.md), [data-formatting.md](docs/conventions/data-formatting.md)

**Naming** — Code as communication: intention-revealing names, verb-based function names, no cryptic abbreviations, named constants over magic values. → [naming.md](docs/conventions/naming.md)

**Code quality** — Single responsibility, short functions, ≤3–4 params (else an options object), guard clauses over deep nesting. Cognitive complexity ≤15 is a mechanized hard stop (charter E8/E2 binding). → [code-quality.md](docs/conventions/code-quality.md)

**Obsidian plugin structure** — No god-`main.ts`; factories + DI for commands/views; correct `onload`/`onunload`. → [obsidian-plugin.md](docs/conventions/obsidian-plugin.md)

**Git** — Conventional commits, atomic, **branch first (never commit to `main` unprompted)**, **squash-merge** PRs behind green gates, and **no AI attribution** on commits/PRs/issues. Merge on green is the default (CI + both local receipts + zero unresolved final-gate threads); the maintainer intervenes by exception. → [git-workflow.md](docs/conventions/git-workflow.md)

**Refactoring & documentation** — Test-covered, incremental, separate commits; extract-and-test, never extract-and-move. **Comments are rare: default to none — a *what/how* comment is a smell; keep only a *why/caveat* a refactor can't express (JSDoc public APIs is fine); never cite volatile refs in comments.** A pre-commit hook flags volatile refs mechanically. → [refactoring.md](docs/conventions/refactoring.md), [documentation.md](docs/conventions/documentation.md)

**Visual assets** — UI-change images/GIFs live in `docs/media/`, feature-named, referenced by pinned `raw.githubusercontent` markdown URLs (never catbox, never raw HTML). → [visual-assets.md](docs/conventions/visual-assets.md)

## Review guidelines

This section is the shared rubric: every agent review layer — spec-time ce-doc-review, the local two-layer pre-push gate (ce-code-review + the independent cross-model peer), the hosted final PR gate — and the human review by it; SonarCloud is the separately-configured mechanical backstop, not a rubric reader. One text; tightening it tightens every reviewer that reads it.

- **Purpose:** find defects that matter — correctness, security, data integrity, principle violations. Style belongs to linters, not reviewers.
- **Review against:** the governing plan's requirements and test scenarios; the governance tests in [docs/architecture/principles.md](docs/architecture/principles.md); the charter's practice tests (E4/E5 especially). Specifically check: no weakened, skipped, or mocked-out assertions; **a test's name is a claim — could it pass while the guard it names is broken?**; **a rule whose member list is maintained by hand is a list, not a rule — can a new member appear without editing it?** (CONCEPTS.md § Derived member list); no hardcoded property names (principle 1); derivation stays visibility-free (principle 2); no second mechanism for a job one already does (principle 4); does the PR span multiple plan units without a written cohesion reason (landing cadence)?
- **Ranked-defect files** ([CONCEPTS.md](CONCEPTS.md) § Pillar measurement; full rules and the exception-record shape in [practices.md](docs/engineering/practices.md) § Charter-owned practice items). The three checks below are repository contract, not any persona's territory: they bind **every** reviewer of a plan or diff that names a ranked-defect file, whatever persona, lens, or scoping instructions the reviewer was dispatched with — "belongs to another persona" never suppresses them. A `session-settled` label on a plan decision does not clear a conflict with them: the placement rule is a binding repository constraint, so a plan that argues instrumentation into a ranked-defect file is a P1 finding at full severity even when that decision is labeled settled — the plan is what every later gate reviews against, so spec time is the last chance to catch it.
  - **Invariant:** no PR moves a diagnostics or instrumentation concern into a ranked-defect file except through its seam module, and a PR that grows a ranked-defect file's line count or concern count states the reason in its description — read it against the trend measurement's output (the independent peer's review input, the author's PR-body paste, the CI artifact — channels mechanized by plan `2026-08-23-001` U3). A growth with no stated reason, or a new debug-log import into a junction file without the exception record, is a P1. A shrink states its improvement claim as well: metric deltas are bookkeeping, never the claim itself, and a source-level relocation is not a seam extraction — its concern delta carries that annotation (see the 2026-08-27 Farley alignment audit in `docs/reports/`).
  - **Placement rule:** instrumentation and diagnostics live in their own module behind a seam; views and junction files keep only the call hooks; the lifecycle-capture names of the debug-log module are imported only by the seam, keyed on the names from any path and any import form (in `src/`; consumers import the seam's declared public names — re-exported types included — from the seam itself, which is the sanctioned path; test code consuming the diagnostics API to assert on traces is outside the rule). Diagnostic call sites added directly to a ranked-defect file are a P1 placement violation — *a plan that argues for them is the same P1*, because every later layer reviews against the plan.
  - **Plan-contract citation:** a plan whose Files touch a ranked-defect file must cite its ranking entry, carry the invariant and the placement rule in its review contract, argue the touch, and state in its Definition of Done that no ranked-file metric regresses, or name the regression and its reason backed by the dated trend report — the exception record is additionally required only for a boundary change. A ranked-defect file listed without the citation and argument is a P1 finding at spec time.
- **Severity:** P0 — correctness, security, or data loss; P1 — will bite users or maintainers in practice; P2 — worth fixing, non-blocking.
- **Settled outcomes are receipts, not verdict strings:** a review settles clean, or with maintainer-acknowledged findings whose acceptance is recorded (see [CONCEPTS.md](CONCEPTS.md) § Review gate). Findings are judged by class, not round count (charter binding, operational stopping rules). Zero unresolved final-gate threads before merge.
