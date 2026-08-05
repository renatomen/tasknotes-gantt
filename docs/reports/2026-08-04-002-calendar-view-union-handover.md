# Handover — calendar-view union (PR #386), final leg

**Date:** 2026-08-04
**Branch:** `feat/calendar-view-union`
**Head:** `da586dc`
**PR:** [#386](https://github.com/renatomen/tasknotes-gantt/pull/386) — open, CI green, **not merged**
**Plan (authoritative):** [`docs/plans/2026-08-03-001-feat-calendar-view-union-plan.md`](../plans/2026-08-03-001-feat-calendar-view-union-plan.md)
**Companion report:** [`2026-08-04-001-pr386-codex-review-verification.md`](2026-08-04-001-pr386-codex-review-verification.md)

You are picking up the last leg: deciding and executing on 12 verified review
findings, then closing out the PR. Everything before that is done, shipped to a
branch, and mechanically gated. Read this document, then the plan's Product
Contract, then the companion report. Nothing else is required reading.

---

## 1. What we are building

An Obsidian plugin (`tasknotes-gantt`) renders a Gantt timeline as a Bases view.
This feature makes it a **union with the TaskNotes calendar view**: every item
family a user can see on a TaskNotes calendar becomes renderable in the Gantt,
governed by per-view settings that mirror the calendar's own toggles.

Item families in scope:

| Family | Source of truth | Gantt representation |
|--------|-----------------|----------------------|
| Recurring task instances | RRULE projection + recorded/materialized history | One task row, one bar per instance (occupancy pieces) |
| Time entries | TaskNotes tracked intervals | Flat event rows |
| Timeblocks | Daily-note frontmatter | Flat event rows |
| Property-based events | Any date-valued frontmatter property | Flat event rows |
| External calendars | ICS subscriptions + Google/Microsoft providers | Flat event rows; recurring series collapse to one row |
| Task date events (scheduled/due/span) | — | **Already the existing task bars** (deliberate; see finding #7) |

### The decisions that shape everything

These came from the maintainer during brainstorming and are recorded as
`session-settled` decisions in the plan. **Do not relitigate them.**

- **Parity through identity.** Same toggle names, same semantics as the calendar.
  Equal toggles must produce the same underlying dataset. This is the core
  promise the feature is judged against.
- **Opt-in per view.** Every family defaults off. One documented exception: the
  AE3 amendment (below).
- **Day is the minimum unit.** Sub-day items round to one day. Derived rows are
  read-only.
- **Gantt stays a separate view.** This is not a calendar replacement.
- **Floating time semantics for v1** — local-day parity, no timezone conversion.
- **Their engine now, upstream API later.** The recurring parity engine runs on
  the exact-pinned public `@tasknotes/model` package; external calendars reach
  TaskNotes' *internal* services behind structural guards, with an upstream
  public-API proposal drafted but **not filed** (needs maintainer sign-off).

### The AE3 amendment (made during implementation, flagged for review)

The plan originally asserted "a fresh view shows zero calendar items." That
conflicted with dataset parity: the TaskNotes calendar shows completed, skipped,
and materialized recurring instances **even with its recurring toggle off**.
Parity won — those instances render at default-off; everything else stays
opt-in-dark. The amendment is written into the plan and disclosed in the PR body.

This amendment is load-bearing for findings #4 and #5 in the companion report: it
turned a rare case into a universal one.

---

## 2. Status

### Delivered

All 14 implementation units, 27 commits, 84 files, ~14.5k lines. Implemented
test-first with observed red at each step.

**Gates, all green at `da586dc`:**

- 3,142 unit tests / 157 suites (`npm test`)
- 13/13 live end-to-end scenarios in **real Obsidian** via WDIO, across
  `test/specs/gantt-calendar-items-{recurring,sources,external}.e2e.ts`
- `npx tsc --noEmit`, `npx svelte-check`, `npm run lint` (cognitive complexity
  ceiling 15, enforced including `.svelte`)
- CI on PR #386: build, e2e, Test + coverage, Analyze, SonarCloud — all pass

### Review layers already run

1. **`ce-simplify-code`** — 6 fixes applied, 1 correctly skipped (a `toYmd`/
   `formatLocalDay` year-padding difference that was not behavior-preserving).
2. **`ce-code-review` mode:agent** — 6 personas plus an independent cross-model
   Codex peer; 12 validated findings, all fixed.
3. **Six internal adversarial rounds** on the drag/echo/cascade write-safety
   chain during implementation. Each round's defect was reproduced by executing
   the production chain and pinned as a regression test. This chain is the most
   expensive thing in the PR to break — treat it with care (see finding #4).
4. **Five attestation rounds** on external-event identity, converging when both
   review models independently agreed the scheme is provably collision-free.
   The final scheme: feed-scoped ids, namespaced discriminators (`i:` explicit /
   `t:` generated), an unconditional `~<int>` ordinal suffix, ordinals assigned
   after a canonical content sort, and a JSON-structured grouping key.
5. **GitHub Codex bot review on the PR** — 12 comments, all verified. **This is
   the open work.**

### The pre-push receipt gate (important operational detail)

`scripts/check-review-receipts.mjs`, wired to `.husky/pre-push`, makes an
unreviewed push mechanically impossible. Both layers must record a clean receipt
for the pushed head:

```bash
node scripts/check-review-receipts.mjs record ce-code-review
node scripts/check-review-receipts.mjs record cross-model-peer
```

Receipts live in `.git/review-receipts.json` (local, not committed). A receipt
attests that the review chain ending at that commit ran clean; reviews diff
against the previously receipted state, so the tip receipt covers ancestors
pushed with it. **You will not be able to push without recording both.** That is
by design — do not bypass the hook.

---

## 3. The open work: 12 GitHub-Codex findings

Full evidence, failing scenarios, and fix directions are in the companion report
[`2026-08-04-001-pr386-codex-review-verification.md`](2026-08-04-001-pr386-codex-review-verification.md).
Verdicts: **10 real, 1 real with corrected scope, 1 decided.**

Condensed:

| # | Location | Verdict | One-line |
|---|----------|---------|----------|
| 4 | `src/bases/eventRowGuards.ts:79` | REAL | Overlay-only rows wrongly lose drag/resize/link editing |
| 1 | `src/controller/calendarItemUnion.ts:30` | REAL | Window ends ~62 days out, not the mandated today + 1 year |
| 2 | `src/controller/GanttController.ts:1778` | REAL | Batch cache ignores the window axis (timeblocks go stale) |
| 12 | `src/bases/register.ts:1083` | REAL | Daily Notes settings changes don't invalidate timeblocks |
| 5 | `src/bases/sourceSwitcher.ts:169` | REAL | Hidden rows can be stranded with no way to unhide |
| 9 | `src/bases/register.ts:1027` | REAL | Calendar sources keep a retired TaskNotes API after reload |
| 8 | `src/datasource/calendarItems/externalCalendarSource.ts:268` | REAL | Timed DTEND at midnight occupies an extra day |
| 11 | `src/datasource/calendarItems/timeEntrySource.ts:49` | REAL | Midnight stop instant spans an extra day (same class as #8) |
| 6 | `src/datasource/calendarItems/propertyEventSource.ts:104` | REAL | `2026-02-30` accepted, silently rolls to March 2 |
| 10 | `src/datasource/calendarItems/externalCalendarSource.ts:695` | REAL* | Empty warm feed shows false loading (bounded, not permanent) |
| 3 | `src/bases/ganttSync.ts:438` | REAL | `CalendarItem.color` populated but never rendered |
| 7 | `src/bases/calendarItemOptions.ts:118` | **DECIDED** | Task-date toggles are absent by design — reply, don't fix |

### What matters most, and why

**#4 is the priority.** It is the only finding that removes an interaction that
previously worked. `hasDerivedBarGeometry` refuses on any non-empty
`occupancyRuns`, but a recurring task with a completed instance inside its own
authored span gets overlay pieces *without* an envelope — its bar start/end are
still the authored scheduled→due dates. So ordinary task bars refuse drag,
resize, and link editing in a fresh default view, contradicting R9. The AE3
amendment made this universal rather than rare.

Two cautions on #4:

- A test currently **pins the wrong behavior** (`test/unit/eventRowGuards.test.ts:143`,
  "refuses a family-off overlay row"). Inverting it is correct but must be
  deliberate and stated.
- This is the write-safety chain that took six adversarial rounds. Genuinely
  derived **envelope** rows must still refuse every mutating gesture. Add a test
  proving that, and verify the echo/cascade paths are untouched.

**#1, #2, #12** share a failure shape: items the user expects are silently
absent. That is the quietest way a parity feature fails, and parity is the
feature's core promise.

**#8 and #11** are currently listed as accepted residuals in the PR body. I
believe that acceptance is wrong: AGENTS.md makes lossless RFC 5545 mapping a
standing mandate, DTEND is non-inclusive, and the all-day path in that same file
already implements the exclusivity correctly. One shared helper in
`normalizers.ts` closes both. Your call, but the residual and the mandate cannot
both stand.

**#7 needs a reply, not a fix.** The plan decided task-date events *are* the
existing task bars, following the maintainer's own framing ("scheduled, due,
scheduled-due span are tasks"). Only the dangling unused `'task-date-event'`
union member (`types.ts:46`) deserves cleanup.

### Suggested sequencing

1. #4 — restore lost editing
2. #1, #2, #12 — dataset correctness and staleness
3. #5, #9 — recoverable-but-confusing lifecycle states
4. #8 + #11 — one shared exclusive-midnight helper
5. #6, #10, #3 — narrow validation, bounded false indicator, dead field
6. #7 — reply on the PR

The four fix workers were scoped with **disjoint file ownership** so they can run
in parallel without conflicts. That grouping still holds:

- **A:** `src/controller/calendarItemUnion.ts`, `src/controller/GanttController.ts` → #1, #2
- **B:** `src/bases/eventRowGuards.ts`, `src/bases/sourceSwitcher.ts`, `src/bases/ganttSync.ts` → #4, #5, #3
- **C:** `src/datasource/calendarItems/*` → #6, #8, #10, #11
- **D:** `src/bases/register.ts`, `calendarItemSources.ts`, `dailyNoteAccess.ts` → #9, #12

---

## 4. Working rules you must follow

These are project standards and hard-won lessons, not preferences.

**Test-first is mandatory.** Write the failing test, *run* it, quote the red
output, then fix. A fix without observed red is not accepted here.

**Reuse the mechanism, never imitate it.** Roughly 30 review rounds on this
project taught this the expensive way: every imitation of an existing mechanism
drifted and spawned another review round; every fix that reused the real
mechanism ended its thread. Findings #6, #9, and #12 all name an existing
mechanism to reuse — use it.

**Search for the existing tool before building one.** Before writing any checker,
analyzer, or helper, check the installed toolchain and the codebase. A bespoke
1,168-line analyzer once duplicated a single eslint rule already in the repo.

**Cognitive complexity ≤ 15 everywhere**, including `.svelte`. Enforced by eslint
and pre-commit. Extract real helpers; never game the metric.

**No volatile references in comments.** The pre-commit hook rejects plan IDs, unit
IDs, requirement IDs (`R#`, `U#`, `KTD#`), and `file:line` citations in comments.
Note that merge and cherry-pick commits skip pre-commit — that is how five
violations escaped into an earlier round.

**No AI attribution** on commits, PRs, or issues.

**Never merge without the Codex gate.** Green CI is necessary but not sufficient:
the PR must have zero unresolved Codex review comments, each resolved as fixed,
superseded, moot, or refuted-with-reasoning. **Merging is the maintainer's call,
not yours.**

**Assert values, not absences.** Mutation-check every gate: would it actually fail
if the behavior broke? A `waitUntil` is not an assertion.

**Run e2e rather than deferring it.** `npm run e2e:local -- --spec <path>`. Move
the gitignored `test/specs/_local-*.e2e.ts` probes aside first (they get swept
into the glob and hang the run) and restore them after. Run every `obsidian` CLI
command from PowerShell, never Git Bash — they exit 127 and fail silently.

**Never touch the configured test vault's settings**, and never write to any vault
outside `OBSIDIAN_TEST_VAULT`.

---

## 5. Definition of done for this leg

1. Each of the 12 findings resolved: fixed with a regression test, or answered on
   the PR with reasoning, or explicitly deferred to `docs/backlog.md`.
2. The PR body's Known Residuals section revised — at minimum, entries for #4,
   #5, #8, and #11 are understated as written.
3. All gates green: full jest, tsc, svelte-check, lint, and the relevant e2e
   specs re-run if any change touches e2e-observable behavior.
4. Both review receipts recorded against the new head; branch pushed.
5. CI green on the new head; zero unresolved Codex comments.
6. **Stop there.** The maintainer merges.

## 6. Post-merge follow-ups (recorded, not now)

- `docs/solutions/conventions/svar-gantt-bar-geometry-and-fill-conventions.md` is
  stale on the tiling gate — this PR's `minUnit` fix corrects it.
- Capture a new learning: the guarded-internal-service + fetch-free-tick pattern
  used by the external-calendar adapter.
- File the upstream TaskNotes public calendar read API proposal (drafted, needs
  maintainer sign-off before filing).
- Three files remain over the 500-LOC remediation line and grew here:
  `register.ts`, `GanttContainer.svelte`, `GanttController.ts`. Extractions belong
  to the standing remediation campaign; concrete targets are in the review
  artifact. (`ganttSync.ts` was brought back under 1,000 lines in this PR.)
