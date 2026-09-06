# Backlog — deferred & residual work

Single source of truth for work that was **deliberately deferred** out of a plan/PR but is still
plausibly wanted. Lightweight alternative to opening GitHub issues prematurely (solo-dev friendly).

**How to use:**
- When you start an item, run `gh issue create` from its entry (copy the description + source link),
  then **delete the entry here**. The issue tracker holds *active* work; this file holds *parked* work.
- Each entry links its **source plan** — the full context (KTDs, scope, test scenarios) lives there.
- `→ #N` means "would nest under existing issue/epic #N if promoted."
- Last swept: **2026-06-29** (from all of `docs/plans/` + `docs/brainstorms/`). Already-tracked items
  (dependency M3/M4 #86–90, agent-parity #62, scheduling #63/#88, upstream `tasknotes#10`) and
  already-shipped/non-goal items are intentionally **not** listed here.

---

## High priority

### P1 — Schedule validation (errors & warnings), with swapped dates as the first slice (2026-08-10)
Per-task validation with two severities, surfaced as a badge **left of the gantt bar**
(hover for a description naming what's wrong). Example warnings: subtask ends beyond
its parent, subtask starts before its parent, finish-later-than-start against an FS
dependency. **Swapped dates (start after due) are the first ERROR** and the walking
skeleton for the whole seam: the one rule computable from a single task in isolation,
yet forcing every layer end-to-end — rule → severity → badge → description → the
"don't render the bar" consequence. Maintainer decision: inverted dates are *not
supported*; the bar is suppressed and the row shows the badge ("not rendering this
until you fix it"). This supersedes the U4 diagonal half-fill, whose branch was
deleted unpushed after a vault screenshot showed it neither matched the intended
design (one-cell diagonal, not whole-bar) nor kept the bar's extent legible.

Settled design constraints (session 2026-08-10):
- Badge renders **declaratively in `taskTemplate`** (`BarContent`), `position:absolute;
  right:100%` + a clearance offset — verified live: `.wx-bar` computes
  `overflow:visible`, and a template child rides SVAR's own positioning through
  drag/zoom/re-render (an imperatively injected element demonstrably does not).
- Clearance offset is a **named constant derived from SVAR's link-handle/elbow
  offsets**, clearing the arrowhead + hover handle; the thin horizontal approach
  segment of an incoming arrow will still pass behind the badge at any offset —
  accepted, badge is opaque/rounded and sits above it. Probe-screenshot the worst
  cases before shipping: incoming FS arrow, and a short predecessor gap (~30px).
- **Unconditional** — not gated by "Show date-status indicators" (that toggle governs
  the zigzag cosmetics; unrepresentable data is not a cosmetic).
- Badge **replaces** the decorative status/priority chip on that row; explanation via
  the badge's own `title` until the tooltip system is fixed; click-to-open stays (it
  is the repair path); the suppressed-bar row is non-draggable on the timeline.
- Icon: lucide `calendar-x` (red) covers the swapped case without a composite overlay.
- A grid-side twin (for gantt-collapsed workspaces) reads the **same per-task
  validation payload** later — one rule registry, two surfaces; fits the
  semantic-descriptor-registry direction in the 2026-08-10 architecture audit.
- U6's remaining swapped-related deletions (the orange fill constant, `datestatus-flagged`
  type and its ~2× task-type registry bloat) ride this slice — deleting the treatment
  before its replacement exists would break product coherence. The red-border half
  shipped early by maintainer direction; until this slice lands, a swapped bar under
  Split rendering shows no visible cue (transparent host, no border — accepted interim
  gap; an orange outline was considered and declined because an undocumented cue
  variant recreates the legend-incoherence defect class).

Prerequisites — status at parking time: tooltip root-cause SHIPPED (#404: the
library suppressed all tooltips on touch-point-reporting hardware; fixed and
covered by probe + unit + e2e), `test/probe` screenshot gate SHIPPED (#405: runs
in CI). Still open: bar-hoverability re-measurement scoped to the active leaf,
and live-vault hover confirmation is human-or-WDIO only (injected events do not
drive hover UI there).
- Source: plan `docs/plans/2026-08-09-001-feat-missing-date-zigzag-semantics-plan.md`
  (U4 superseded); audit `docs/reports/2026-08-10-svar-conformance-and-maintainability-audit.md`.

### P2 — Existence-only e2e assertions are the next tier down (2026-07-29)
The assertion gate makes a case with NO assertion impossible; it says nothing about
weak ones. Eleven `toBeGreaterThan(0)`-shaped checks remain across the calendar and
field-mapping specs — they assert that something rendered, not that the right thing
did. Two conflict cases in `gantt-calendar-editor.e2e.ts` were tightened this way
(count -> the weekday rows the conflicts actually fall on, which fails for a misparse
a count waves through); the same treatment applies to the rest. Out of scope for the
gate unit deliberately: that unit's job was cases asserting nothing at all.
- Source: layer-2 review of the assertion-gate branch; a `grep` for the pattern after
  fixing the first instance is what surfaced them.

### P1 — Behavior defects preserved during the maintainability campaign (2026-07-30)
These six nonurgent behaviors were characterized and deliberately left unchanged.
They are not decomposition work. Once the maintainability closeout lands, promote
any fix as its own test-first unit. If new evidence makes one urgent before then,
stop the project and consult the maintainer before changing production behavior.

- The cell-edit path uses reject-at-timeout (`withTimeout`), releasing its gate
  while the underlying write continues. A late write can therefore overtake a
  subsequent edit.
- Two render instances of one source have separate cell-edit gates but share
  property and render records. Their writes can overlap; if a later write succeeds
  before an earlier one rejects, the earlier rollback restores its original
  baseline and temporarily clobbers the later value in the grid.
- A mixed incremental refresh clears the current grid selection, while identical
  and width-only refreshes preserve it.
- Moving an existing task beneath a parent added by the same incremental refresh
  sends the move before the parent exists. SVAR rejects that command asynchronously
  while local bookkeeping can advance, leaving the displayed hierarchy stale.
- If an ephemeral column sort is active and the Base sort descriptor changes
  without changing its row-order fingerprint, the incremental path clears the sort
  arrow but skips replaying Base order. The chart can retain the old ephemeral
  visual order.
- If a column/editor signature and the Base sort descriptor change in the same
  refresh while an ephemeral sort is active, the earlier column-reseed path
  rebaselines the Base descriptor and reasserts the old ephemeral sort.
- Sources: PR #349 review record; plan
  `docs/plans/2026-07-27-001-refactor-drag-derivation-authority-plan.md`; real-SVAR
  characterization during #354.

### P1 — A stale mount can register its paths onto a live mount's calendar watch (2026-09-03)
Found while reviewing `docs/plans/2026-09-03-001-refactor-register-render-data-characterization-plan.md`;
not fixed there, because that plan changes no production behaviour. The render-data assembly reads the calendar watch after
its controller fan-out. If one mount is awaiting those reads while a second mount replaces the
watch and completes, the first mount resumes and registers its now-stale known paths and
associations onto the second mount's watch — the association map is cleared and refilled with
stale data, and the association snapshot is overwritten — before the mount-token check discards
the stale pass. A mount-token comparison is **not** sufficient, and an earlier draft of this entry said it was.
Two refreshes of the *same* mount race the same way and carry the same valid token: the
coalescer runs its callback without awaiting it (`src/bases/coalesce.ts`), the controller's change
notification launches `refreshData()` fire-and-forget behind only a token check, and `refreshData`
has no latest-wins guard before `store.set`. If build A stalls in the fan-out while build B
completes, A resumes and overwrites B's associations *and* B's store data. The fix is a per-build
generation guard checked immediately before the watch mutations and before `store.set`, of which
the mount-token check is only the coarser outer half; it is a behaviour change and belongs in its
own test-first unit. The superseding plan
extracts the projection as a pure function and therefore plans no test that observes the watch at
all, so nothing in it pins or blocks this fix — and nothing in it would catch a regression here
either. Whoever takes this writes the first test that can see the registration timing.

### P2 — The calendar alias reconcile couples to its consumers through config, not a value (2026-09-03)
Found while reviewing `docs/plans/2026-09-03-001-refactor-register-render-data-characterization-plan.md`.
`reconcileCalendarSelectionAlias()` runs at
the head of the render pass and may write `tngantt_displayCalendars`, which `buildCalendarShading`
and the highlight field then read back out of config. The ordering is therefore temporal and
implicit, and nothing observes it: `reconcileLegacyFlip` writes only when a stored selection is
paired with a defined `tngantt_highlightWeekends`, and no tracked fixture sets both — one stores a
selection with no legacy key, another sets the legacy key with no stored selection. An edit that
dropped the call, or moved it after the shading call, would therefore keep every gate green while
the stored calendar selection and the legacy highlight toggle silently diverged. The fix is to make the
dependency explicit — have the reconcile return the reconciled selection and have its consumers
take it as an argument — so the compiler enforces the order that comment and convention enforce
today. That is a production behaviour change and belongs in its own test-first unit; plan
`2026-09-03-001` therefore leaves the call untouched and treats its position as a review
obligation on the U1 diff.

### P2 — The capabilities brand is minted from an object literal, so a new required field would slip through (2026-09-04)
Found by the cross-model peer while reviewing the nominal-branding learning, and verified by
compiling. `GanttController.capabilities` mints its brand as
`(this.activeSource?.capabilities ?? { write: false }) as SourceCapabilities`. A cast to a branded type is checked only for
comparability in either direction, so it **drops the missing-field check**: if
`DataSourceCapabilities` ever gains a required field, that fallback literal still compiles and the
no-source path yields the new field as `undefined` rather than failing the build. The repair is
the one already applied at the other three mint sites in PR #480 — assign to a
`DataSourceCapabilities` local, then brand the local — and it is two lines. It is parked rather
than folded into the docs PR that found it because `src/controller/GanttController.ts` is
ranked-defect entry 4, and touching it carries the ranking citation and argument that a
documentation change should not be smuggling in. Whoever takes it should sweep the other brand
readers for the same shape at the same time.

### P2 — `buildCalendarShading` is a value builder that also registers watches (2026-09-04)
Parked at U1 of `docs/plans/2026-09-03-001-refactor-register-render-data-characterization-plan.md`,
which its Files list requires. `ObsidianGanttBasesView.buildCalendarShading()` computes the shading
values the render contract publishes **and**, in the same call, registers the marked calendar notes
and the per-task associations with the calendar watch and refreshes
`this.lastAssociationTaskPaths` for the picker. Two concerns, one entry point: the values are pure
and now testable through the projection's signature, while the registrations are side effects no
tier observes at all — deleting one keeps `GanttData` byte-identical and every gate green, while a
renamed or deleted calendar note stops refreshing the chart. U1 neither moves nor edits those lines
(the host calls the builder exactly where it did before), so this plan adds no risk to them and
closes none of it either. The fix is to split the registrations out of the builder so each is
testable at the unit tier; it is a structural change with its own test-first unit, and it is the
prerequisite for the P1 stale-mount registration race above rather than a duplicate of it.

### P2 — Nothing proves the render pass still consults the dependency-arrow option (2026-09-03)
Found while reviewing `docs/plans/2026-09-03-001-refactor-register-render-data-characterization-plan.md`.
The view reads
`tngantt_dependencyArrowMode` once per pass and hands the result to the links read and to the
render contract. Every tier tests around that read and none tests it: the reader's own coercion
is unit-testable, the projection asserts the field it was given, and no tracked fixture sets the
option to `all`. So an edit that substitutes a literal for the read, or reads the wrong key,
leaves the user's `all` setting silently ineffective with every gate green. Branding the mode
type was measured and rejected as the remedy: `LinkRewriteMode` is shared by the controller's
link API, the expansion rewriter, the sync layer and `GanttViewData`, so guarding one host call
site would ripple through four modules. The proportionate fix is a fixture with the option set to
`all` over recurring instances with dependencies, asserting the expanded edges reach the
contract. Plan `2026-09-03-001` U4 therefore leaves the coercion inlined rather than lifting it
to `viewOptions.ts` beside its siblings: the lift is a wiring change and this plan does not change
what it cannot verify. Whoever writes that fixture takes the lift with it — arrow-mode work, for
whoever next touches that path.

### P2 — Executor residuals from the #349 review chain (documented, deliberate)
Accepted trade-offs and tail risks the seven local review cycles documented rather than fixed;
revisit if any bites in practice:
- A dequeue landing inside the 500ms Bases refresh debounce can read a pre-write row; fully
  closing it needs the executor to overlay its own persisted patches.
- A permanently hung persist parks its source's queue (deduplicated notice shown); recovery is
  view remount. The fence deadline equals the slow-write notice threshold, so a 10–15s write
  gets its cascade deferred to the next drag.
- Remount epoch-0 window: the marked-notes memo survives on the controller while the calendar
  watch is torn down and recreated at epoch 0; an edit in the unwired gap could serve stale
  marked notes for one transient build.
- Settlement-observer failures are swallowed silently (why-comment present); route to the gated
  debugLog if diagnostics are ever needed.
- Source: PR #349 review threads + local review artifacts, 2026-07-28.

### P1 — e2e: exercise pointer drags with stock WebdriverIO actions
The single most-repeated residual. Multiple deferred e2e tests need reliable
pointer-drag coverage in real Obsidian (drag-to-persist, drag-to-resize,
drag-to-link). Use WebdriverIO's supported browser/action APIs and existing e2e
fixtures; do not build a custom drag simulator, runner, or harness. If the stock
API cannot express a case reliably, prefer an upstream-supported route or
reassess the test boundary before adding project-specific tooling.
- Deferred e2es waiting on it: drag→cascade-modal→persist, grid-column resize persistence,
  FS link drag-create, non-FS link drag-create.
- Sources: `docs/plans/2026-06-17-005-feat-parent-date-cascade-confirmation-plan.md`,
  `docs/plans/2026-06-18-001-feat-gantt-grid-bases-columns-plan.md`,
  `docs/plans/2026-06-19-001-feat-gantt-fs-link-authoring-plan.md`,
  `docs/plans/2026-06-20-001-feat-gantt-non-fs-dependency-authoring-plan.md`

### ~~P2 — Open render/index residuals (#161 tail)~~ — RETIRED 2026-07-14, both closed

Kept as a record of what these entries got wrong, because the same wrong story was
propagated into the learnings docs before anyone checked the PR that closed it.

- **(a) U6 toolbar-search re-poke** — claimed that clearing a Bases toolbar search
  disarms both loop-breakers and triggers "an unguarded bulk `getValue()` re-poke".
  **This is not what the bug was.** PR #172 fixed it and states plainly that *Bases is
  untouched — it delivers a constant matched set; the cost was our diff-sync*: each
  resultset swing re-applied the whole companion-expanded set per-instance (~114k DOM
  mutations, ~25s). Bulk-reseed bounded it to 781 mutations. Issue #161 is closed, and
  the maintainer validated it in the real vault. Not reproducible on the released build.
- **(b) Direct-frontmatter read** — mostly moot. `BasesDataAdapter.extractValue` has
  fast-pathed every `note.*` / `file.*` property straight from frontmatter since
  January 2026, so a `note.*`-mapped Base never routes a bulk read through
  `entry.getValue()`. Only an *unprefixed* or `formula.*` column id still does — a perf
  characteristic, not a bug: the real vault runs exactly that shape with no storm.

### Reliability incident record — windows since the 2026-08-26 fold (fold per R3 at next plan close)
New instances land here per the incident-record method of
`docs/reports/2026-08-19-001-reliability-rediagnosis.md` (window-specific denominators from
summed `run_attempt`, never pooled across windows; symptoms named per spec, cited by run id).
That report's table is immutable; ruling R3 (PR #455) folds this entry into the next
reliability report at plan close. The 2026-08-25 window (PRs #454–#456, 7 executions,
2 failed) folded into
`docs/reports/2026-08-26-001-reliability-column-sort-diagnosis.md` at the column-sort
diagnosis plan's close, with its ranked-list observations preserved there.

_No instances recorded in the current window yet._

### Column-sort on-recurrence procedure (standing; rank 3 open, probe armed)
On any red `gantt-column-sort.e2e.ts` CI run: (1) download the `og-lifecycle` envelope
from that run's `e2e-artifacts` upload BEFORE any rerun; (2) one same-commit
`gh run rerun --failed` as the pre-registered control supply — verify the rerun checked
out the identical merge SHA, else it does not qualify; (3) match the control digest
mechanically and certify the operator facts from the ring slice; (4) classify per the
binding rules in `docs/reports/2026-08-26-001-reliability-column-sort-diagnosis.md` and
fold the verdict per ruling R3. `probe-failure` outcomes trend in their own bucket and
prompt a probe-health fix, never a cause verdict. Contingency if no organic trace by 40
instrumented ordinary-CI executions or six weeks from the seam-observation merge: one
`e2e-repeat.yml` dispatch (`executions=24`) at a pinned instrumented SHA is
pre-authorized (window-cutoff convention).

---

## Medium priority

### ⭐ NEXT FEATURE — Availability: authoring (P2g) + hour granularity
The **day-level half shipped 2026-07-22 (#308)**: availability blocks now drive shading, conflicts, and the
real Gantt chart at day granularity via the shared `src/controller/calendar/workingDays.ts` seam ([[P2i]]
resolved). What remains, in order of user value:
- **P2g** — the calendar editor form still can't *edit* availability blocks (authored via raw YAML /
  markdown round-trip only). Now that availability actually does something, the nested block editor is the
  natural next user-facing step. Start it with a `ce-brainstorm`/`ce-plan` pass.
- **Hour granularity** — block `hours` are still ignored (sub-day rendering, hourly conflicts, RFC 9253
  working-time lag). Deferred until the Gantt renders hourly — see
  the bundled, day-granularity calendar decision.
- **P2b** — runtime-invalid block/pattern RRULEs are silently inert; a bad block contributes nothing rather
  than flagging (shared fail-visible wiring).

### P2b — Calendar: runtime-invalid RRULEs are silently inert (fail-visible gap)
Source: `docs/plans/2026-07-19-001-feat-multi-calendar-working-time-plan.md` (KTD11). Found during the
U10 review; pre-dates U10 (present since the S1 shading path).

A calendar `pattern` is validated at parse time only (`FREQ` present; anchored grammar needs
`pattern_start`). A pattern that passes those checks but still throws inside the rrule wrapper at
evaluation time — e.g. a malformed `BYDAY` code — yields a *valid* calendar whose pattern then
silently contributes nothing to shading, conflicts, or task blocking: no banner count, no flagged
picker row. That contradicts the documented fail-visible contract.

`validatePattern` (`src/controller/calendar/patternWindow.ts`) exists precisely to catch this and is
currently unused in production. Wiring it into `buildCalendarRegistry` so a runtime-invalid pattern
lands in `registry.invalid` (banner + disabled picker row with the reason) is the fix.

**Status (2026-07-24):** the *evaluator* half shipped in #323 (freeze/DoS + floating-rule guards, so
`validatePattern`/`evaluatePattern` reject those before expansion). This registry-propagation half was
split back out of #323 because an 8-round Codex review surfaced design decisions worth settling on
purpose rather than round-by-round. Resolve these before implementing:

1. **"Matches no days" policy.** `validatePattern` treats an evaluable rule that matches no day in the
   4-year probe as invalid ("pattern matches no days"). For a *working* pattern that's the right
   signal (a schedule working one day per decade isn't a schedule, and the preview already flags it),
   but a valid sparse recurrence (`FREQ=YEARLY;INTERVAL=10`, first occurrence beyond the probe) should
   NOT be flagged. Decide: keep "matches no days" for working rules (parity with the preview) and use
   an evaluable-only check for events, OR relax both (and change the preview to match).
2. **Working-rule vs display-event granularity** (per the `schema.ts` fail-granularity contract): an
   invalid working pattern/availability block invalidates the whole calendar; a runtime-invalid
   *recurring event* is a display entry and must be dropped-with-a-diagnostic, NOT suspend scheduling
   for every linked task.
3. **Event-diagnostic surfacing.** No production consumer reads calendar-*definition* diagnostics
   (only set flags + `registry.invalid` surface in the picker/banner). To make a dropped bad event
   actually fail-visible, add a registry field/flag the picker or banner renders — otherwise the
   diagnostic is silent.
4. **Startup cost.** Probing every calendar at registry build runs a 4-year `between()` per rule; the
   #323 guards cap the pathological cases, but confirm the aggregate cost is acceptable (or probe
   lazily / cache).

### P2c — Calendar: per-calendar colour for column shading (decide after U12/U13)
Source: `docs/plans/2026-07-19-001-feat-multi-calendar-working-time-plan.md`. Maintainer question
during S2 review: shaded columns all paint the same neutral colour regardless of each calendar's
configured `color`.

Current behaviour is deliberate — shading paints `--wx-gantt-holiday-background` so it matches the
weekend look in every theme. Calendar colour currently reaches only the picker's row swatches;
U11 (markers), U12 (bar colour source) and U13 (row tint) are where it reaches the chart.

**Mechanically cheap** (~30–60 lines + tests): the pipeline is already per-date — the frozen
`highlightTime` closure stamps a static `og-d-<date>` class and the injected stylesheet assigns
meaning, so `computeCalendarShadingCss` would group dates by owning calendar and emit one rule per
colour instead of one rule for all. It already holds the displayed records with their colours.

**Constraint:** SVAR renders one overlay cell per date column, so overlapping calendars share a
single paint surface — an overlap must resolve to one value (pick by order, `color-mix` blend, or a
new treatment; stripes are already spent on conflicts).

**Open decisions:** saturation (authored colours at full strength would swamp bars/text — wants a
low-percentage `color-mix` tint through the existing `isSafeColor` guard); overlap resolution; and
whether it applies at all below two displayed calendars.

**Why deferred:** U12 and U13 both encode calendar identity as colour (bars, rows). Adding columns
makes three surfaces competing on the same channel. Judge it once those are on screen. If wanted
then, the likely shape is a low-percentage tint applied only at 2+ displayed calendars, plus
conflict stripes upgraded to the two disagreeing calendars' colours.

### P2d — Calendar: per-task association problems have nowhere to surface
Source: `docs/plans/2026-07-19-001-feat-multi-calendar-working-time-plan.md` (R27, KTD11). Found while
answering a maintainer question about multi-calendar association.

`resolveTaskCalendar` produces flags per task — a dangling link, a link to a non-calendar or invalid
note, a set member dropped for being itself a set, and now "only the first entry of a multi-entry
list is used". Those flags are returned and then **discarded**: the calendar-status banner counts
invalid calendar *notes* and unresolved *display-selection* links, never per-task association
problems. So a task whose calendar link is broken silently renders as unassociated — dates unchanged
and scheduling suspended, with no notice anywhere.

KTD11 promises these are fail-visible. Options: fold an association-flag count into the banner
(cheapest, consistent with the existing notice), and/or a per-bar cue for the affected tasks. Needs a
decision on which, since the banner is view-level and the problem is task-level.

### P2e — Bar colouring: mode/source combinations render the wrong treatment
Maintainer-reported 2026-07-20 while testing the calendar work; raised for triage **after** plan
2026-07-19-001 completes, at the maintainer's request. Two symptoms, observed in a real vault:

1. **Strip + By status colours the whole bar** instead of only the left accent strip. Non-calendar,
   and predates the calendar work — `buildTreatmentStyle`'s strip path emits `stripBodyRule()` (a
   neutral body) plus a `::before` accent; something is filling the body with the accent instead.
2. **Fill + By calendar also draws a strip.** Calendar-scoped, so possibly a U12 regression: the
   calendar branch emits the default role rules as a base and then per-calendar rules on top, so a
   strip could leak in if the base is built for the wrong mode, or the observed "strip" may be the
   progress fill taking the default child colour rather than the calendar's.

Investigate together — they may share one cause in how the role base and per-value rules compose.
The maintainer's standing constraint: do not alter non-calendar bar styling as a side effect.

### P2f — Calendar: per-row shading (U13) DROPPED — what a future attempt must solve
Source: `docs/plans/2026-07-19-001-feat-multi-calendar-working-time-plan.md` (U13, R25, AE10). Dropped
2026-07-20 under the unit's own **pre-authorized drop rule** ("destabilizes virtualization → drop,
record the finding, waive AE10, continue"). **AE10 is waived.** Implemented, reviewed, then reverted;
nothing of it remains on `main`.

It was buildable — row geometry *is* reachable (`_tasks[].$y`/`.$h`, the same fields SVAR positions
its own bars from) and the pure geometry was straightforward (9 unit tests, e2e verified AE10 in real
Obsidian). Two defects found in review make the *design* wrong, not the code:

1. **It defeats virtualization.** `_tasks` is the FULL task array; SVAR virtualizes by slicing it
   with `state.area.start`/`.end` (see `Bars.svelte`'s `$rTasks.slice(...)`). An overlay built from
   the whole array is O(all rows × span days) and mounts one node per blocked run per row — tens of
   thousands of un-virtualized nodes at the ~3300-instance scale the perf harness already tracks.
   A future attempt must slice on `area` and re-measure at that scale.
2. **It silently desyncs from the rows it labels.** Row `$y` moves on expand/collapse, sort, filter
   and hide-top-level — all `api.exec` paths internal to SVAR that never touch the plugin's data
   store, so no recompute fires and the tint stays put while the bars move. But a reliable signal
   does exist: `api.getReactiveState()._tasks` is the collapse-aware visible-row set (the plugin
   already subscribes to it for the row count), and `_tasks[].$y`/`.$h` carry per-row geometry — so
   a future attempt can key the overlay off that reactive state rather than a bespoke geometry
   fingerprint or a mutation-path intercept. A tint sitting on the wrong row asserts something false
   about that task's non-working days — worse than no shading at all.

Two lesser findings to carry over: `buildTaskBlocking`'s single-slot memo thrashes when stretch and
row shading are both on (two call sites compute different windows and evict each other every pass —
give row shading its own slot or share one result); and the overlay was appended after `.wx-bars`,
so at equal stacking it painted *above* the bars rather than below.

**Prerequisite for revisiting:** the treatment-channel redesign in
`docs/brainstorms/2026-07-20-date-provenance-and-treatment-channels-requirements.md`. Row shading
would be a fourth surface encoding calendar identity by colour (after bars, columns and markers);
whether it earns that channel is a question that redesign should answer first.

## Deferred Codex review threads (2026-07-25 backlog resolution)

Left open deliberately during the Codex-backlog resolution pass — acknowledged, not fixed:

- **Refresh the evaluated-date stylesheet on viewport pan/zoom** (#266, plan-doc thread) — a
  viewport-driven refresh of the calendar shading sheet; acknowledged deferral.

Also deferred to their own units: fetched-bar calendar colour + its shading refresh (#281, U5d),
and the P3 timezone-offset DST-staleness recompute (#297).

### P2g — Calendar editor: availability-block editing
Source: `docs/plans/2026-07-19-001-feat-multi-calendar-working-time-plan.md` (U15). The editor form
edits every calendar field EXCEPT per-pattern `availability` blocks (pattern + hours per block). They
are **preserved** across a save (carried verbatim as `availabilityRaw`) and the form shows a
read-only "edit as markdown" row when present, so nothing is lost — but they are not yet editable in
the form. Deferred to keep the form PR small; add the nested block editor (pattern + hours list per
block) as its own unit. Flagged by Codex during U15 review.

### P2h — Calendar editor: slow `fileManager.renameFile` while the editor is open
Source: `docs/plans/2026-07-19-001-feat-multi-calendar-working-time-plan.md` (U15). Renaming an open
calendar note via `fileManager.renameFile` (backlink rewriting + open custom-view update) is very slow
— it exceeds WebDriver's script timeout in e2e; `vault.rename` is fast. Unsaved edits are already
preserved and the save retargets the new path (the U15 rename fix), so no data is lost, but the rename
itself may stutter for the user. Investigate the setViewState-routing interaction; likely a
`suspendRouting` window around the leaf update. Discovered during U15 review.

### ~~P2i — Calendar-set union preview: availability-only members ignored~~ — RESOLVED 2026-07-22 (day granularity)
Fixed: availability blocks now drive working/non-working **at day granularity** everywhere. A shared
`src/controller/calendar/workingDays.ts` (`workingComplement`) is the single source — a day is working if the
top-level `pattern` OR any availability block covers it — and `calendarDayFacts.blockingFacts`,
`calendarConflicts.dayFacts`, and `calendarShading.collectShadedDates` (the real chart) all read it. So an
availability-only member now blocks its off-days and conflicts correctly, and the previews match the chart.
Block **hours** are still ignored (day-granularity only, by decision — see the bundled, day-granularity calendar decision).

Remaining, deferred: the **hour-granularity** work (sub-day rendering, hourly conflicts, RFC 9253 working-time
lag) waits for Gantt hourly rendering; authoring availability in the form is [[P2g]]; and runtime-invalid
block patterns are still inert (P2b) — a bad block contributes nothing rather than flagging.

### P3 — Status-coloring follow-ups
Source: `docs/plans/2026-06-17-002-feat-gantt-status-coloring-plan.md` (Deferred to Follow-Up Work).
- Live config-change reactivity for status-palette changes (currently read on (re)mount only; no event subscription).
- Completed-status visual treatment beyond color (progress fill / muted / checkmark) — `isCompleted` is exposed but unused.
- Status-driven progress derivation; status legend/filter UI; priority coloring.

### P4 — Progress persistence (gated)
Progress is **read** today (`progressProperty` field mapping + `ganttSync`) but **not written back**.
Gated on a user-configured TaskNotes field mapping for progress.
- Sources: `docs/plans/2026-06-16-001-feat-tasknotes-companion-gantt-plan.md`,
  `docs/plans/2026-06-17-003-feat-gantt-tasknotes-field-mapping-plan.md`.

### P5 — Community plugin-store submission
The scorecard-compliance plan made the repo submission-ready; the actual PR to
`obsidianmd/obsidian-releases` is the separate, still-pending step.
- Source: `docs/plans/2026-06-20-002-chore-plugin-scorecard-compliance-plan.md`.

### P5b — Focus-on-task (search → reveal) — designed, gated on select-first
Crosshair button in the floating control stack **+** a "Gantt: Focus on task…" command → native
Obsidian `FuzzySuggestModal` listing every chart instance (matched **and** extended; search over
**name + path**, show path as secondary). On pick: **expand only the necessary ancestors** → step
the **best-fit zoom ladder** so the bar is fully visible and ≤50% of the chart width → **scroll x+y
into view** → **highlight** (navigation only, no note activation). Date-less/partial tasks
(milestone, no end, unscheduled) are revealed at the **current** zoom centred on `start`.
- **Design decisions (agreed 2026-06-29):** best-fit ladder, *not* continuous zoom; highlight-only
  (no activation); FuzzySuggestModal; dedupe results by source → target the primary instance; entry
  via floating crosshair **+** command-palette command; Lucide `crosshair` icon (not a `wxi-*` font
  icon — those render blank here).
- **Enabling primitive:** `docs/brainstorms/2026-06-29-gantt-bar-click-select-first-requirements.md`
  — once select-first ships, focus reuses "select = highlight without activation" and drops the
  earlier activation-suppression workaround.
- **Pure decision module to plan:** ancestor-chain + best-fit-level selection (`focusController`),
  unit-testable without SVAR/Obsidian. e2e mirrors `gantt-fullscreen.e2e.ts`.
- Source: focus-on-task brainstorm session (2026-06-29).

### Visual assets — capture for shipped features
These features shipped without a convention-compliant `docs/media/` asset; capture each via
`/tng-demo` against its e2e fixture and drop the pinned `![]()` into the release notes for the
version each shipped in. No Obsidian-recording tier is wired into ce-demo-reel yet (P1-adjacent) —
needs an interactive WDIO capture session. Convention: `docs/conventions/visual-assets.md`.
- **Visual assets — capture for select-first task-bar click (0.1.0-beta.3)** — first click highlights,
  second click / double-click opens. Fixture: `test/specs/gantt-bar-click.e2e.ts`. Source: PR #188.
- **Visual assets — capture for focus-on-task (0.1.0-beta.3)** — crosshair → fuzzy search → expand →
  zoom → scroll → highlight. Fixture: `test/specs/gantt-focus-task.e2e.ts`. Source: PR #189.
  (The earlier #189 PR GIF was catbox-hosted, which the convention now bans.)
- **Visual assets — capture for markdown property cells (0.1.0-beta.8)** — wikilinks as clickable
  internal links, tag values as pills. Fixture: `test/specs/gantt-markdown-cells.e2e.ts`. Source: PR #222.
- **Visual assets — capture for chips list editor (0.1.0-beta.8)** — editing a list cell as removable
  chips with the `[[` suggester; read-mode count badge. Fixture: `gantt-inline-edit.e2e.ts`. Source: PR #236.
- **Visual assets — capture for Time Estimate ⇄ duration sync (0.1.0-beta.8)** — an estimate driving a
  dateless bar's length, and a resize writing the span back. Source: PR #221.

---

## Low priority

### P6 — Dependency authoring residuals  → #91
- Per-reltype visual styling (color/dash per reltype, beyond anchor geometry). Source:
  `docs/plans/2026-06-18-004-feat-gantt-dependency-read-fidelity-plan.md`.
- Lead (negative gap) support — M3 ships lag only. Source:
  `docs/plans/2026-06-20-001-feat-gantt-non-fs-dependency-authoring-plan.md`.
- Keyboard/command dependency authoring (SVAR authoring is drag-only). Sources:
  `docs/plans/2026-06-19-001-feat-gantt-fs-link-authoring-plan.md`,
  `docs/plans/2026-06-20-001-feat-gantt-non-fs-dependency-authoring-plan.md`.

### P7 — Viewport / grid persistence polish
- Persist user's current zoom as a view setting. Source:
  `docs/plans/2026-06-19-001-fix-gantt-default-scale-plan.md`.
- Persist per-view full-screen default; max-height in rows (vs px); animate full-screen transition.
  Source: `docs/plans/2026-06-21-003-feat-gantt-viewport-sizing-plan.md`.
- True divider min-width guard / tune SVAR's hard-coded 50–800px clamp (frozen-columns alternative).
  Source: `docs/plans/2026-06-18-002-feat-gantt-frozen-columns-and-divider-plan.md`.
- Column sorting persistence. Source:
  `docs/plans/2026-06-18-001-feat-gantt-grid-bases-columns-plan.md`.

### P8 — e2e / CI infra
- The scheduled #161 storm perf case "Show-undated tasks off still bounds evaluation under a noisy
  Base" fails unchanged before and after the maintainability refactor: `fireToggle` reports the
  setting and config changed, but the generated vault then has zero visible bars while the test
  expects at least one. Reproduced against unchanged `main` behavior on 2026-07-30. The
  maintainability campaign deliberately preserved it; promote diagnosis and any fix as a separate
  post-campaign unit rather than folding it into the closeout.
- `vault-as-code verify` does not inspect secret values when a captured TaskNotes `data.json` is
  malformed: extraction retains the raw bytes, generation writes the same bytes, and verification
  swallows the JSON parse failure after the round trip matches. This is nonurgent because the tool
  is manual/local, its private fixture is gitignored, and it is not shipped or CI-invoked. Promote
  a separate post-campaign unit to make extraction and verification fail closed before any fixture
  can be treated as redacted. Source: #354 verifier characterization, 2026-07-30.
- Commit the `vault-as-code` fixture (real frontmatter, secrets redacted) for CI, then wire the #161
  repro in as a gated job. Privacy decision the maintainer flagged as separate. Source:
  `docs/plans/2026-06-28-002-fix-gantt-diff-sync-bulk-reseed-plan.md`.
- Generalize the per-column readiness helper into shared e2e harness utils if other specs hit the
  property-column-header race. Source:
  `docs/plans/2026-06-29-001-fix-gantt-column-sort-e2e-flake-plan.md`.
- CI `--check` index guard for release-index staleness. Source:
  `docs/plans/2026-06-23-001-feat-community-release-pipeline-plan.md`.
- Generate the in-app "What's New" bundle from release **tags** instead of the working tree, so the
  bundle is correct regardless of which notes files a branch happens to carry (the tags are the
  immutable source of truth). Would make the notes-to-`main`-first discipline belt-and-suspenders
  rather than load-bearing. Source:
  `docs/solutions/workflow-issues/release-notes-belong-on-main-not-release-branches.md`.

---

## Verify before promoting
These may already be shipped — confirm against current code before opening an issue.
- **U8b editor-modal Save/Delete** — code now delegates to TaskNotes' own modal via
  `openTaskEditModal` (`src/bases/taskNotesInteractions.ts`); may already be covered by #61/#71.
  Sources: `docs/plans/2026-06-17-003-feat-gantt-tasknotes-field-mapping-plan.md`, memory `gantt-u8-write-field-asymmetry`.
- **Add-Task-from-Gantt** — the toolbar "Add Task" was deliberately removed in PR #71, deferred until
  the write path matured. Source: `docs/plans/2026-06-17-004-feat-native-tasknotes-edit-interaction-plan.md`.

---

## Parked — revisit only on a trigger
Low-value or condition-gated; kept here so nothing is lost. Not actionable until the trigger fires.
- **Mechanical maintainability gate** — compute churn share and separable-concern
  count in CI instead of manual re-measures. Referenced by STRATEGY.md's
  maintainability metric. **Trigger fired 2026-08-21:** PR #446 grew the rank-1
  file (`src/bases/GanttContainer.svelte`) by a net 678 lines and 37 diagnostic
  call sites with every gate green, while the reliability plan's text had paused
  the trend report. Its churn-in-CI half lands as R8 of plan `2026-08-23-001`
  (the per-PR trend measurement: churn share, ranked-file sizes, at-ceiling
  count, ranked files touched — informs, never fails). The blocking half — a CI
  gate on concern counts — stays parked: concern counts cannot be mechanized
  (they are enumerated by the dated per-session report), and the informs/blocks
  decision (placement is the blocking invariant; size is feedback) and the
  2026-07-30 ruling "file length is not a quality gate" hold. Trigger for the
  remaining half: the trend artifact shows a regression that review missed.
- **Validate upgraded release Actions on the next real release** — confirm checkout/setup,
  provenance attestation, and release publication complete. The pre-upgrade workflow base was
  `e6a2e742cf58d0243cf8c41607a1993f24f3a84a`; PR validation covers the shared build path but cannot
  synthesize the tag-triggered publication sequence.
- **Validate upgraded perf Actions on the next scheduled/manual run** — confirm checkout/setup and
  performance artifact publication complete. The pre-upgrade workflow base was
  `e6a2e742cf58d0243cf8c41607a1993f24f3a84a`; PR validation covers the shared Windows build path but
  does not exercise this production workflow trigger.
- **manifest `minAppVersion` bump** (1.5.0 → 1.10.0+) vs keeping the runtime Bases version guard — `2026-06-16-001`.
- **Controller targeted-refresh → full diff-based update** if remount proves too coarse — `2026-06-16-001`.
- **Per-ancestor selection in extend dialog**; **auto-mode undo notice** — `2026-06-17-005`.
- **Toolbar jump/scroll-to-today** control (not implemented) — `2026-06-21-002`.
- **`columnSize` × overall grid-pane width** (`tableWidth`) / horizontal-scroll interaction — `2026-06-18-001`.
- **Multi-parent duplicate-bar de-duplication** / hide-top-level-subtasks default decision —
  `2026-06-17-001`, `docs/brainstorms/2026-06-22-gantt-bases-relationship-expansion-and-sorting-requirements.md`.
- **Multi-select rows** (Ctrl/Cmd-toggle and/or Shift-range) for highlighting several tasks at once —
  split out of the select-first click change where Ctrl/Cmd was kept as the new-tab modifier; needs
  a non-conflicting modifier (SVAR has native toggle/range selection) —
  `docs/brainstorms/2026-06-29-gantt-bar-click-select-first-requirements.md`.
- **Re-route value extraction through official `getValue()` API** once Bases Value subclasses are exported — `2026-06-21-001`.
- **Adopt newer Bases capabilities** (formula evaluation, sort config, summary values) — `2026-06-21-001`.
- **SVAR `onScroll` null-property crashes** — re-file upstream only if seen on normal use (not during freeze/rebuild) — `2026-06-24-001`.
- **`metadataCache.on('resolved')` readiness accelerant** + **"Loading relationships…" UX** during the readiness window — `2026-06-28-001`.
- **Collapse-toggle diff churn `untrack()` integration** — pull in only if load-bearing — `2026-06-22-002`.
- **CI job-split for release secret isolation**; **beta-notes lifecycle on promotion** (retain vs delete `-beta.N`) — `2026-06-23-001`.
- **Tighten Sonar gate threshold** above Sonar-way defaults; **SonarCloud project-key rename** (cosmetic) — `2026-06-20-004`.
- **Full plugin-guidelines code-pattern refactor** (sentence-case UI text); **mobile polish** — `2026-06-20-002`.
- **Dependabot deferred re-evaluations** — vite/svelte-plugin majors (#163), js-yaml 3.x istanbul instance — revisit when upstreams ship non-breaking patched lines — `2026-06-28-003`, `2026-06-29-002`.
- **Update #161 bug report** stale SVAR version refs (2.3.0 → 2.7.0) — `2026-06-25-001` (#161 closed; low value).
- **Tier-2 scheduling** (critical path/chain, capacity); **NLP task entry**; **webhook/calendar recompute triggers** — `2026-06-16-001` (already recorded as #53 scope wall; long-horizon).
- **Visual assets — day-scale before/after** (0.1.0-beta.10, #252): a short before/after (wide vs compact day columns) for the "Day opens at its narrowest columns" change; skipped in the release-notes draft as marginal/subtle, capture with the deferred motion-GIF batch (maximized window).

### Whole-bar move of an inferred task silently materialises the derived edge
Source: the drag-path refactor plan's flow analysis (2026-07-27). Moving the whole
bar of a task with an inferred edge writes both dates and the estimate without the
prompt the resize gesture gets — the modal only covers resizes on the matching
inferred edge. Today's behaviour is pinned by the planner's test table (the refactor
preserves it); whether a move should route through the prompt gate is a product
decision. Wants a maintainer call before any behaviour change.

### Inferred-edge undo: authorship vs appearance
Source: the inferred-edge drag review. Undoing a shrink-cascade after an
**Estimate and dates** choice restores the pre-drag dates and (now) the pre-drag
estimate — but the pre-drag end of an inferred-end task was *derived*, so writing
it back authors a date that was not authored before. A fully faithful undo would
un-author the edge the choice materialised, which needs a patch path that can
clear a frontmatter field rather than set one. Deliberately deferred: the
alternative (dropping the date silently) is equally a guess, so this wants a
maintainer decision on what "undo" means for a derived edge.

The same applies to the estimate: a task with **no** authored estimate had its edge
derived from the view default, so the undo writes an explicit estimate equal to what
was implicit — the appearance is restored exactly, the authorship is not. Restoring
absence needs a patch path that can *clear* a field (today `applyEstimateWrite`
only writes numbers, and TaskNotes-field clearing semantics are unverified).

## The peer-review gate is roughly 7x the size its purpose needs

Measured on `main` at 018cbb0: **763 lines (473 shell + 290 node), 21 distinct
exit codes, 44 refusal points** — to run a reviewer over a diff, confirm it
actually read it, and record that it happened. Each round costs 9-15 minutes
against 30-45 for a GitHub round trip, so the loop does deliver the feedback
speed it was built for. The question is what the other 660 lines buy.

Sorting the refusals by the threat they answer is the argument:

- **Accident** — the review died, the reviewer never saw the diff, no verdict or
  a hedged one, the tree does not match the commit, HEAD moved. This is the real
  threat for a solo maintainer and it produced few defects, all cheap.
- **Distributed-git correctness** — ancestry, divergence, backwards resets,
  upstream freshness, tracking-remote validation, base-ahead-of-pushed-state.
  **Nearly every defect in this file came from here**: three separate tracking-ref
  corruptions, an inverted exit status that locked out any repo whose remote
  lacks `main`, and two fetch-fallback fail-opens. It defends force-push and
  multi-remote scenarios that a single maintainer with one origin does not have.
- **An adversary who owns the machine** — replace refs, submodule pointer moves,
  `-diff` gitattribute suppression, attestation forging. Unachievable by
  construction; the file's own header concedes that anyone who can set the env
  var can edit the script.

The bug density is empirical evidence, not taste: complexity that answers a
threat outside the system's context is where the defects live. A second signal
points the same way — repeated hand traces of the middle category were wrong,
twice contradicted by the comment sitting directly above the line. Code the
author cannot reason about is too complex whether or not it is correct.

**Proposal: delete rather than extend.** Keep the accident guards, drop the
other two categories, and move what survives into `check-review-receipts.mjs`
where it is natively testable — the shell exists only because `codex` is a CLI.
Estimate: ~100 lines and about six exit codes (review did not run, did not see
the diff, no verdict, tree does not match the commit, HEAD moved, recording
failed).

Deliberately NOT scheduled. It is more work on the tool, and a full session was
already lost to exactly that. The 28 tests in `test/unit/crossModelPeerReview.test.ts`
make the deletion safe whenever it is picked up.

## Peer-wrapper guards still without a test

Source: the clearance review of the wrapper's own suite. The suite pins 28
cases and no vacuous assertion survives mutation, but the wrapper has ~20 exit
codes and these are asserted nowhere. Listed so the gap is a decision rather
than an assumption:

- **exit 16, both directions** — the upstream moving forward past the reviewed
  commit, and the backwards reset a force-push would ride on. The comment
  calling the backwards case an escape the forward check misses is the strongest
  argument for testing it.
- **exit 11** — an explicit base ahead of the last pushed state, the guard
  against narrowing the reviewed range by hand.
- **exit 15** — a worktree already dirty when the review starts (only the
  mid-review sibling, exit 17, is covered).
- **exit 10 on the raw diff**, the capture-not-pipe defence, and the
  binary-hunks half of exit 14.
- **exit 20 as the wrapper reaches it** — `sha256_of` is tested in isolation but
  `digest=${digest_line%% *}` and the empty-digest refusal are not.
- **exits 8, 3, 21, 7, 12, 2**, and `--acknowledge` without `--record`.

Two prompt instructions are also unpinned — "begin your response with that
line" and the VERDICT-line instruction. Deleting either leaves the suite green
because the stub recovers both from elsewhere; the cost is a wasted model call
rather than a false pass, since both fail closed at runtime.

Related: the suite takes ~137s for one file and `sonar.yml` runs it on the
PR-gating path, so it is a candidate for the slow-suite budget. And the stub is
written under `os.tmpdir()` and executed, which a `noexec` /tmp would break
opaquely — not a GitHub runner today.

## Review receipts are not bound to the range they reviewed

Source: PR #419's own review, by both layers and the external reviewer, three
times over. A receipt names the commit that was reviewed. A review covers a
RANGE, and the tip alone cannot say which one.

So a receipt earned for `B..H` also satisfies a push of `H` to a remote sitting
at an earlier `A`, sending `A..B` along unread; and it satisfies a force-push
that discards whatever the remote gained since. Neither needs anything unusual
— another clone pushing while a review runs is enough.

`scripts/check-review-receipts.mjs` already has the missing input in its hand:
`parsePushedRefLines` validates `tokens[3]`, the destination sha git supplies on
the pre-push line, and then discards it. The fix is to record `BASE_SHA` beside
each receipt and, in `check`, refuse a push whose destination is not contained
in the reviewed base. A brand-new ref reports an all-zero destination and needs
`origin/main` as the honest stand-in.

Every base guard in `cross-model-peer-review.sh` is review-time defence around
this gap — the wrapper cannot see the push destination and the gate can. A first
attempt inside the mechanism branch broke 13 tests and could not record at all
in a repo with no upstream, so it wants its own branch and its own plan.

## Peer review reads the live worktree, not the commit

Source: the same review, twice. The wrapper checks worktree cleanliness before
and after Codex runs, but the review is deliberately backgrounded: a tracked
file saved during it and restored before it ends passes both checks, and the
receipt then blesses a verdict formed on content the reviewed commit does not
contain.

Running `codex exec` from a `git worktree add` pinned to the reviewed sha closes
it structurally — the tree cannot disagree with the commit if it IS the commit —
and deletes the whole dirty-check apparatus along with it, plus the residual
that a stray untracked file can reach the reviewer as context.

## Smaller accepted findings on the peer wrapper

All from PR #419, accepted rather than fixed so the review loop could terminate:

- ~~**Sentinel entropy is 15 bits** / **`.peer-review-diff.tmp` is not
  gitignored and its path is fixed**~~ — consolidated 2026-08-25 into the
  "Peer-gate hardening" entry below, which carries the current state: the
  staging files ARE gitignored now, while the fixed paths and the 15-bit
  sentinel remain open and parked there. Promote only that entry.
- ~~**`branch.<name>.remote = "."`**~~ — fixed: `tracking_remote` now accepts
  only a configured remote NAME, and `default_base` accepts an upstream only
  when it resolves under `refs/remotes/`. Left here as the record of what the
  first attempt got wrong: it refused the value at the FETCH, while the base is
  chosen in `default_base`, so the defect survived its own fix.
- **The refresh guarantees `main`, but `default_base` prefers `@{upstream}`.**
  So on a branch that HAS a remote-tracking upstream, the ref actually consumed
  is not the one the by-name fetch guaranteed fresh — a narrowed
  `remote.<name>.fetch` that excludes it leaves the same staleness the by-name
  fetch was added to close, one ref over. Re-fetch the resolved upstream by name
  too, with the same treatment: failure with a surviving local copy is a refusal.
- **`base_ref` is resolved twice per run**, once by `refresh_upstream` and once
  by `default_base`. With `fetch.prune` and the upstream branch deleted on the
  remote mid-run, the ref that was refreshed and the ref the base is read from
  can differ — the invariant the resolution was unified to establish. Resolve it
  once at top level and thread it through both.
- **The `sha256_of` fallback is tested in isolation, not through the recording
  path.** Codex proved it: reverting the wrapper's call site to a bare
  `sha256sum` leaves all tests green, because on Linux and Windows the
  end-to-end acknowledgement uses `sha256sum` while the direct tests exercise an
  orphaned helper — so a macOS acknowledgement could exit 20 again unnoticed.
  The honest test runs an acknowledged-findings flow with `sha256sum` absent,
  which needs a shim directory of real executables (git, node, shasum) plus
  spawning bash by absolute path, since `/usr/bin` holds both bash and
  sha256sum. Recorded rather than fixed because the fallback only matters on a
  platform nobody here develops on — the unbounded class by this repo's own
  rule.
- **Recording now needs the network** on branches that were previously
  offline-safe. The refusal is right, but it is a NEW exit 19 on that path, not
  a pre-existing one, and an offline maintainer who cannot push is the road to
  `--no-verify`. Either make the trade explicit or record a stale-base marker in
  the receipt instead of leaving an invisible bypass as the only way through.

## Accepted gate findings from PR #420's final-gate review (2026-08-14)

Recorded per the stopping rule in
`docs/solutions/workflow-issues/bound-work-on-the-review-tool-itself.md`;
both threads were resolved on the PR with this destination named. Neither
breaks the everyday path.

- **Layer-1 acknowledgements are recorded clean-shaped in practice.** The
  receipts script parses `--acknowledged <digest>` generically for any layer,
  but no wrapper computes a layer-1 digest and the hook's printed remediation
  omits the flag — so a maintainer accepting a layer-1 finding has no guided
  path and records what `acknowledgedFindings()` reads as clean; later pushes
  will not announce it. In practice layer-1 findings have been fixed, not
  acknowledged. Fix belongs to any future scheduled gate work, not a side
  quest.
- **The peer wrapper's `[out-file]` accepts unprotected in-repo paths.** Only
  three root-level gitignore patterns guard review outputs; a legal path like
  `notes/codex.md` could be staged by a bulk add and then wedge later reviews
  at the final worktree check. The documented default (mktemp, outside the
  repo) and the stage-explicit-paths rule guard the everyday path.

## Candidate ratchet — import-boundary lint gate (parked; adopt on trigger)

A dependency-cruiser-class check enforcing module boundaries (e.g. views never
import the data layer directly) — "mechanism, not memory" for the layering the
governing docs now name. Deliberately NOT built with the docs port (no new
enforcement mechanisms shipped with it). **First instance landing:** the
lifecycle-capture placement boundary — the ranked junction files may not import
the debug-log module's lifecycle-capture names, or the seam module's non-public
names, in any import form — lands as R4 of plan `2026-08-23-001` (U2), expressed
with ESLint core `no-restricted-imports` + `no-restricted-syntax` in
registry-derived per-file overrides, no new script or plugin. The broader
candidate here — views never import the data layer — stays parked with its
existing **trigger:** adopt when the maintainability campaign's extractions
define stable module boundaries worth mechanically enforcing — likely after the
GanttController/register.ts slices.

## Per-calendar diagnostics are recorded but never surfaced

Found by the governing-docs port's peer review tracing the degradation
posture: `schema.ts` records diagnostics for dropped entries and unknown
timezones, but `resolveCalendars.ts` promotes only calendar-SET diagnostics to
resolved flags — a linked calendar with `timezone: Mars/Phobos` stays valid
with the timezone silently removed and the user never sees a flag. Product
defect candidate: propagate `calendar.definition.diagnostics` into resolved
flags. The architecture record documents this as a tracked gap against its
degradation posture.

## BasesDataAdapter still display-formats — adapter/view boundary lag

`BasesDataAdapter.ts` formats dates/booleans/arrays in
`convertGroupKeyToString` and returns display-formatted values from
`extractPropertyValue` — violating the adapters-extract/views-format boundary
the architecture record names as the norm. Queue as an extraction candidate in
the maintainability campaign (the file is already on the >500-line list);
fix by extract-and-test, moving display transforms to the view layer.

## Label-only edits are invisible to the entry signature (stale task names)

Found by the governing-docs port's exhaustive claim sweep: `BasesSource.ts`
builds the task label from `mappings.textProperty` (also used by
`sortKeyMapping.ts`), but `entrySignature.ts`'s `watchedMappingValues` never
includes it. With the title role mapped to a `note.*` frontmatter property,
editing only that property leaves the signature unchanged, the #161 gate
reuses cached tasks, and the bar/grid label stays stale until some other
watched field or the entry set changes. (`mappingSignatureTag` catches
re-mapping the role; the value edit is what is invisible.) Fix shape: add
`viewMappings.textProperty` to `watchedMappingValues`. Sibling nit for the
same entry: `progressProperty` is watched only on the view side, unlike
start/end/status/priority/calendar which watch view+resolved pairs.

## Calendar colour accepts values RFC 7986 COLOR does not permit

Found by the governing-docs follow-up review: the persisted calendar `color`
field maps to RFC 7986 `COLOR` per `docs/architecture/calendar-rfc-mapping.md`,
but RFC 7986 §5.9 requires a CSS3 colour NAME while the schema accepts any
non-empty string and `rfcMapping.ts` copies it verbatim — so every accepted
value that is not a CSS3 name (hex like `#2a9d8f`, functional forms like
`rgb()`/`rgba()`/`hsl()`/`hsla()`, anything else) round-trips as a
nonconforming COLOR value. Decide: constrain input to CSS3 names, or record
the any-string acceptance as a documented deviation in the mapping doc — a nearest-name mapping is off the table because it rewrites the stored
value irreversibly, which principle 6 forbids for stores. Until decided, the
mapping doc's lossless claim carries this known exception.

## Refine the unset-role resolution wording by role class

Acknowledged peer finding (receipt d6a20e99a4bb, PR #423): the glossary and
principle 1 state unset-role resolution as date/status-priority/standalone
cases, but some roles resolve without property mappings at all — name falls
back to `file.basename` (already tolerated in the same paragraph), progress
can derive from checklist computation, parents from project edges. If the
sentence family keeps attracting precision findings, restate it as a
per-role-class table instead of prose qualifiers.

## Mechanize the session-cadence guard

`docs/engineering/practices.md` § Session cadence is deliberately unmechanized:
repo gates cannot observe session identity, so the one-merge-per-session rule
is enforced by transcript inspection. Candidate mechanisms if it starts losing
to momentum: stamp a session identifier into the review-receipt metadata and
have the receipt checker refuse a second same-session merge receipt, or a
merge-time check comparing the receipt's session stamp against the last merged
one. Search the installed toolchain before building anything.

## Community-store submission — the distribution milestone, parked

The submission gate lives at
`docs/releases/obsidian-submission-checklist.md`: the must-pass code-rule
audit, the obsidian-releases listing prerequisites, and the open
confirmations. Parked until the maintainer schedules the submission. Known
state at parking time: the code-rule audit is dated **2026-06-20 and is
STALE** — it predates the maintainability campaign and every major merge
since, so it must be re-run before listing; the `minAppVersion` (`1.10.0`)
confirmation is still open. (The checklist's README-screenshot item was
stale — README.md already embeds Gantt screenshots; ticked 2026-08-16.)
The strategy track "Grow the standalone side" should point at this entry
when STRATEGY.md's tracks are next amended (maintainer-approved edit). When
picked up, promote to a GitHub issue and delete this entry.

## Scheduled perf job red since 2026-07-13: Show-undated storm chart-alive assertion

Discovered during U3 of the test-tree typecheck plan (2026-08-17): the weekly
`perf.yml` full-stack job has concluded `failure` on every run since at least
2026-07-13, and the 2026-08-10 run's log (SHA `2af3648`, predating the U3
branch) fails on exactly one test — `gantt-resultset-storm.perf.e2e.ts:248`,
"a Show-undated toggle does NOT ignite a re-render storm (#161 U5)", where the
post-toggle chart-alive check `expect(bars).toBeGreaterThan(0)` receives 0.
Reproduced locally at the U3 tip: deterministic (fails on same-SHA rerun, so
NOT the never-became-ready flake class), while the Hide-top twin test in the
same file and the fullstack spec's own storm test both pass. The recompute
bound itself passes — the chart renders zero bars after the Show-undated
toggle at storm scale, which may be a real presentation-layer regression of
the #161 U5 contract or a stale spec expectation. Diagnosis was out of scope
for U3 (pre-existing on main, unrelated to type repair). When picked up,
promote to a GitHub issue and delete this entry.

## Peer-gate hardening: per-run staging paths and a stronger read receipt

Two acknowledged findings from PR #454's cross-model peer review of the
staging-pattern learning, parked by maintainer call on 2026-08-25 (campaign
focus: finish the quality campaigns and return to feature work). Both are
deliberate-evasion or concurrent-operation residuals outside the gate's
operating model of a single maintainer running one review at a time:
(1) `scripts/cross-model-peer-review.sh` stages the reviewed diff and trend
block at fixed paths, so two overlapping invocations in one checkout could
cross-stamp — fix is per-run unique staging paths with an overlapping-run
regression test; (2) the diff-read sentinel uses bash `$RANDOM` (15 bits)
and is accepted anywhere in the reviewer's output — fix is a high-entropy
token and first-nonblank-line enforcement. The staging-pattern learning in
`docs/solutions/tooling-decisions/stage-peer-review-content-as-data-files.md`
records both at their honest strength. When picked up, promote to a GitHub
issue and delete this entry.

## Mechanize the trend block's path to the hosted reviewer as a CI-posted comment

Maintainer-settled on 2026-08-25: the hosted PR reviewer can read PR
comments when its instruction text explicitly directs it to, so the
author-paste ritual (copy the pre-push hook's trend print into the PR body)
can be replaced by mechanism. Implementation when picked up: the required
`build` job already publishes the trend output as an artifact; a separate
trusted `workflow_run`-triggered workflow posts it as the PR comment —
granting `pull-requests: write` on the build job itself would 403 on fork
and Dependabot PRs, whose `pull_request` runs get a read-only token, so the
artifact-then-publisher split is the shape GitHub documents for this
pattern. The privileged publisher must not republish PR-produced values:
it recomputes the trend with the default branch's script and registry
against the merge-base of the PR's head with main, and the head — the same
merge-base the CI trend step and the peer wrapper already compute, since a
tip-of-base two-dot range would misreport ranked-file deltas once main
advances past the branch point (and the same trusted-side rule the peer
wrapper's staging already applies), treating the PR-run artifact as a
presence signal at most. Ordering matters: a hosted review requested
before the publisher posts would settle without the trend context, so the
paste ritual retires only when the workflow guarantees the comment exists
before the review is solicited — solicit after the publisher completes, or
retrigger the review on publication. The AGENTS.md review-guidelines line that names
"the author's PR-body paste" as the hosted gate's trend source changes to
name the CI-posted comment, with an explicit read-the-trend-comment
direction for the hosted reviewer; the pre-push print stays for the human
author. Until then the paste ritual stands. When picked up, promote to a
GitHub issue and delete this entry.

## Duplicated touch-rule group rides verbatim in the extracted GanttContainer stylesheet (2026-08-27)

The `.wx-reorder-task` / `.wx-chart` / `.wx-bar` touch-action rules appear twice in
`src/bases/GanttContainer.css` (formerly `GanttContainer.svelte` ~2784–2797 and ~2960–2969).
The style-block extraction moved bytes exactly per its zero-rule-edit contract, so the
duplicate was carried, not fixed. Dedupe as its own tiny slice; note the byte-identity
receipt no longer applies once rules change — verify via the computed-style e2e quartet
(`gantt-calendar-items-recurring`, `gantt-legend`, `gantt-collapse-chevron-contrast`,
`gantt-resizer-arrow-contrast`) instead.
Source: docs/plans/2026-08-27-001-refactor-ganttcontainer-style-extraction-plan.md (R3).

## Campaign method: add a testability-pressure input to the maintainability ranking (2026-08-27)

From the Modern Software Engineering alignment audit (docs/reports/2026-08-27-001-farley-alignment-audit.md): the ranking
(churn × concerns × complexity pressure) lacks the book's primary early quality signal —
how hard a file is to test. The repo already names the proxy (principle 5: a behavior
reachable only through a >5-minute loop is a design defect): count behaviors per ranked
file provable only at the e2e tier. This scores relocation slices as zero-design-gain and
weld extractions (the `initGantt` closure set, diff-sync coordination) as the high-value
ones. Needs a maintainer ruling at the next re-measure.
Source: docs/plans/2026-08-27-001-refactor-ganttcontainer-style-extraction-plan.md (U2).

## Campaign method: tie one trend-report success claim to an outcome class (2026-08-27)

Same audit (docs/reports/2026-08-27-001-farley-alignment-audit.md): trend reports claim success via structural deltas (line counts, concern
counts, at-ceiling counts). The book's yardstick is stability/throughput — tie at least
one claim per future trend report to an outcome class: incident cost, measured flake
instances, or false-greens surfaced. Needs a maintainer ruling at the next re-measure.
Source: docs/plans/2026-08-27-001-refactor-ganttcontainer-style-extraction-plan.md (U2).

### P2 — Nothing compiles the TypeScript in `docs/solutions/`, so a durable learning can rot silently (2026-09-05)
Raised by two independent reviewers while reviewing the nominal-branding learning. That document's
central claims rest on two self-contained programs that were compiled by hand at TS 5.9.2 and are
not compiled by anything again. A TypeScript release that changed assertion comparability, or the
`null & object` reduction, would falsify the document with no build signal — and the same review
found a quoted source comment that had already drifted out of step with the file it quotes, caught
by a reader rather than by a mechanism. The repo's rule of the house is mechanism, not memory, and
this is an invariant with no guard.

Parked rather than built here under the standing ruling that code and bug fixes outrank tooling
unless the harness is the measured bottleneck; it is not. Whoever takes it should extract every
fenced `ts` block under `docs/solutions/` and typecheck it, treating a block's `@ts-expect-error`
directives as part of the assertion — and should decide whether quoted source snippets are worth
pinning to their files at the same time.

### P1 — Replace the type-level assertion tower with declaration assignability (2026-09-05)
Nine successive reviews found the same defect in `src/bases/ganttRenderContract.ts`, each inside
the fix for the one before: a guard that used `extends` where it meant equality, then a self-test
checking one direction, then helpers accepting `never`, then `boolean`/`unknown`/`any`, then an
unobserved `IsExactly`, then a tuple accepting an `any` answer, then a one-token widening of
`AssertTrue` that disabled every assertion then in the file, then `Exact` accepting `any` operands, and finally
an answer matrix that pinned every case but the empty type. Every level now self-detects under
mutation.

**Corrected 2026-09-05:** this entry previously said eight levels and repeated a reviewer's finding
that there was no ninth inside the tower. A later round in the same session found one — the matrix
gap above — so that closing claim was falsified and is withdrawn. The separate coverage finding of
the same session (a contract key with no fabricate case) is not a tower level and is not counted
here. The entry is left with its correction visible rather than silently renumbered, because a
confident closing claim disproven by later work is the exact failure this entry exists to remove.

The measured alternative asserts with the compiler's own assignability check on DECLARED VALUES
rather than by computing a boolean and asserting the boolean:

**Derive this set, do not copy it.** Two review rounds each found a different missing member of a
block I had twice called complete — first `UnbrandedException`, then `keyof GanttData` — which is the
evidence that an enumerated list is the wrong shape for this, exactly as
`workflow-issues/state-the-rule-derive-the-list` says. The procedure, which is what actually binds:

> For each declaration, take the EVALUATED type on each side — what that side actually resolves to,
> not every name spelled inside it. `keyof GanttData` is one operand, a key union; so is
> `InterchangeableFieldPairs<InterchangeabilityProbe>`, a tuple. The names within a type expression
> are not separate operands, because the declaration asserts nothing about them individually; they
> reach the assertion only through the type they evaluate to, and guarding a name whose evaluated
> form is an object is what would break the healthy build. Choose each sentinel by the kind of that
> evaluated type — `0 &` for a union of string literals, `null &` for a tuple. Each evaluated
> operand needs its own sentinel declaration, unless that side's
> expected type is `never`, which rejects the escape-hatch type unaided. That exemption is only from
> the sentinel: an expected `never` is SILENT on an operand that has collapsed to `never`, since the
> declaration then reads `never = never` — measured — so anything whose contract an always-empty
> implementation would violate still needs a positive probe naming something it must contain. A name
> can resolve to something other than what you read; a literal written in place cannot, and is the
> only exemption.

The block below is that procedure applied to the operands present today, compiled against the real
module at TS 5.9.2 — silent on the healthy build, with a planted canary confirming the build was
being checked. If the implementation adds, renames, or re-sites an operand, re-run the procedure
rather than pattern-matching against these names.

```ts
// The coverage assertion, both directions. Neither direction alone is enough: one accepts a
// derived set that is a strict subset, the other accepts a listed name that is no key at all.
const _derivedIsListed: UnbrandedException = null as unknown as UnbrandedInputFields;
const _listedIsDerived: UnbrandedInputFields = null as unknown as UnbrandedException;
// Both operands are type NAMES, so both carry a sentinel. Omitting either one leaves that side
// free to degenerate with all the mutual assignments still compiling.
const _derivationIsNotAny: never = null as unknown as (0 & UnbrandedInputFields);
const _exceptionIsNotAny: never = null as unknown as (0 & UnbrandedException);

// No sentinel here, and this is the one real exception: an expectation of the empty type admits
// nothing, so it rejects a degenerate operand unaided.
const _noPairs: never = null as unknown as InterchangeableFieldPairs<RenderContractInput>;

// The pair derivation still needs a positive probe, and the key union still needs a
// non-emptiness check; both currently go through `IsExactly`, so both need a declaration
// form too or deleting it takes them with it.
const _probeFindsThePair: ['wide', 'narrow'] =
  null as unknown as InterchangeableFieldPairs<InterchangeabilityProbe>;
const _pairIsThatProbe: InterchangeableFieldPairs<InterchangeabilityProbe> =
  null as unknown as ['wide', 'narrow'];
// `null &`, not `0 &`: the operand is a tuple, and `0 &` does not reduce for one, so that
// sentinel would fail on the healthy build. Pick the sentinel by the operand's kind.
const _pairProbeIsNotAny: never =
  null as unknown as (null & InterchangeableFieldPairs<InterchangeabilityProbe>);

const _namedKeysAreContractFields: keyof GanttData = null as unknown as NamedContractKeys;
// `GanttData` is a name too, and it is the container on the EXPECTED side. Without this, widening
// it leaves the subset check, the witness and the key-union sentinel all green while the declared
// contract has gone: `keyof` of a degenerate container is `string | number | symbol`, which admits
// every key rather than none.
const _contractKeysAreNotAny: never = null as unknown as (0 & keyof GanttData);
// A witness, not a tautology: `NamedContractKeys = NamedContractKeys` compiles even when both
// sides are `never`, so the check has to name a key it must contain.
const _namedKeysAreNonEmpty: NamedContractKeys = null as unknown as 'links';
// The subset check and the witness both accept a degenerate operand, so this one is needed too.
const _namedKeysAreNotAny: never = null as unknown as (0 & NamedContractKeys);

// Referencing every declaration is what makes DELETING one an error. Measured: without this,
// removing a guard leaves typecheck and lint green, because the declarations are unreferenced,
// `noUnusedLocals` is off and the lint config ignores `_`-prefixed names; with it, the same
// deletion is `TS2304: Cannot find name`. The anchor is part of the guard, not decoration.
export const _guardAnchor = [
  _derivedIsListed, _listedIsDerived, _derivationIsNotAny, _exceptionIsNotAny,
  _noPairs, _probeFindsThePair, _pairIsThatProbe, _pairProbeIsNotAny,
  _namedKeysAreContractFields, _contractKeysAreNotAny, _namedKeysAreNonEmpty,
  _namedKeysAreNotAny,
];
```

`UnbrandedException` is the exception union, which is inlined in the guard today and would have to
be lifted to a named alias first.

The escape-hatch rejections above replace `IsAny`, which comes out with the rest. Keeping it would
leave one computed checker standing with nothing observing it — weaken it to a constant and the guard
is green while broken, which is the whole defect this entry exists to remove. The declaration form
asserts instead that the operand intersected with a disjoint sentinel is empty.

One of these per named operand, not one in total.

Residual risk, stated rather than claimed away. Deletion is caught only because of the anchor: on
its own a declaration is unreferenced, and removing it leaves the build green — measured, and the
reason the anchor is in the block. Weakening is not caught at all, because a sentinel declaration is
still a computed type expression —
changing the sentinel `0` to `never` leaves the healthy build green, and then a degenerated operand
satisfies `never & any` against a `never` target. That is the same deletion/weakening split the
learning records: declarations buy observability, not immunity. The mutation coverage is what closes
it, so re-run each sentinel's own mutation whenever one is edited. Each declaration above has two sides, and a
guard on one says nothing about the other: measured, if `UnbrandedException` degenerates instead,
both mutual assignments AND `_derivationIsNotAny` compile, and a removed brand goes undetected —
the same false-green by a different door. The rule, rather than the list: **every operand that is a
TYPE NAME carries its own sentinel-disjointness guard**, because the intersection tests exactly the operand it
names and nothing else.

Called a sentinel-disjointness guard, because that is what it tests: whether the operand still
intersects the sentinel to nothing. It rejects the escape-hatch type and the top type alike — with
an operand of the top type the intersection reduces to the sentinel itself, which is not empty —
and it does NOT detect emptiness, since an operand collapsed to the empty type intersects to empty
and passes. Rejecting
the escape-hatch type and proving a set still has members are two obligations, and this mechanism
discharges only the first — so an operand that must contain something needs a witness declaration
as well, naming a member it cannot lose. Name, not "computed" — the distinction that matters is whether the operand
can resolve to something other than what you read, and a hand-written union like the exception set
can, because someone can redefine it. Only a literal written in place is exempt, since there is
nothing to resolve.

Two things the rule does not excuse you from checking, both measured:

- **Guard the computed side, not the literal one.** For the pair probe that is
  `InterchangeableFieldPairs<InterchangeabilityProbe>`, never the expected tuple written beside it —
  a literal cannot degenerate, and a guard on it is silent while the derivation is `any`.
- **The sentinel must be disjoint from the operand's own kind.** `0 &` works for a union of string
  literals and is WRONG for a tuple: `0 & ['wide','narrow']` does not reduce, so that guard fails on
  the healthy build. Use `null &` for the tuple operands here. Pick the sentinel by what the
  operand is, then confirm the guard is silent on the healthy type before trusting it to speak on a
  degenerate one. **Object-valued operands are out of scope for this entry.** The guard set has
  none, and three attempts to specify a recipe for one were each measured false-green by the next
  review: a witness instead of the sentinel reopens the escape-hatch case; witness plus sentinel
  misses a dropped optional member, since an optional property is satisfiable by absence; the
  object and key-set assignability pairs together still miss a property whose value type
  degenerates. Two facts are worth keeping for whoever meets a real one. The sentinel does not
  apply: `0 & { ... }` does not reduce to the empty type, so that declaration fails on the HEALTHY
  build — which is why the procedure above is written for operands that are unions or tuples.
  And mutual assignability is the wrong primitive on objects for the reason just given. Design that
  case against a real operand, and measure it, rather than extending this recipe to it.

For a union of string-literal keys the intersection is `never` and the declaration holds; if the
derivation degenerates to `any` the intersection is `any`, which is not assignable to `never`, and
it fails. Measured. Mutual assignability alone does NOT supply this: if `UnbrandedInputFields` degenerates to `any`, both assignments
compile, because `any` is assignable in both directions. The `never` declaration protects only the
pairs derivation — which is why the `any` rejection above is needed, and why it is written as a
declaration. With `_derivationIsNotAny` in place, `IsAny` goes with everything else: keeping it
would leave one computed checker standing that nothing observes, which is the defect this entry
exists to remove. Delete `AssertTrue`, `IsExactly`, `Exact`, the tuple AND `IsAny`.

**Measured, 2026-09-05, TS 5.9.2 under the project `tsconfig`.** The guard set above was compiled
rather than reasoned about: a copy of the module with these declarations appended, mutated one axis
at a time. On the healthy build every declaration in the block is silent — including `null &` on the tuple
operand and `0 &` on the unions — while a planted `const _canary: number = "s"` errors, so the
silence is the guards holding and not the compiler idling. Each mutation then fired exactly the
declarations naming the operand it degenerated, and no others: the derivation degenerated to the escape-hatch type fired
`_derivationIsNotAny`; the exception union degenerated fired `_exceptionIsNotAny`; a removed brand
fired `_derivedIsListed`; the pair derivation degenerated fired `_noPairs` and `_pairProbeIsNotAny`;
the CONTAINER widened — `GanttData` itself, not its key union — fired `_contractKeysAreNotAny`, which
is the guard whose absence the review found.
The surviving tower fired on all of those EXCEPT the container widening, where it is silent:
`[NamedContractKeys] extends [keyof GanttData]` holds when the container is the escape-hatch type,
because `keyof` of it admits every key, and the non-emptiness assertion is unaffected. So the
replacement gives up no coverage and `_contractKeysAreNotAny` adds some — measured, not inferred.

Two limits on that result, both worth carrying into the implementation. The mutations exercised the
operands this guard set actually has, which are unions of string-literal keys and one tuple; the
object-operand case was measured separately, against a synthetic pair rather than a real operand,
and is the reason that case is scoped OUT above rather than given a recipe. And a passing declaration set is not the same as a deleted tower: removing
`AssertTrue`, `IsExactly`, `Exact` and `IsAny` is the change this entry asks for, and the measurement
covers only that the declarations catch what the tower caught, not that nothing else read them.

Every right-hand side must be a concrete expression, not a `declare const` binding. TypeScript erases
the declaration but emits the initialized constant, so `declare const x: T;` followed by
`const _a: U = x;` compiles and then throws `ReferenceError: x is not defined` the moment the module
is imported. Verified by reading the emitted JavaScript: the declared form emits
`export const _derivedIsListed = derivedUnbranded;`, the form above emits `= null`. A
typecheck-only `.d.ts` would also work, at the cost of splitting the guard from what it guards.

Measured RED for a removed brand, a stale exception name, an interchangeable pair, a derivation
degenerated to `never`, and one degenerated to all keys — and the `never` declaration rejects
`any` for free. What it deletes is listed once, above; this paragraph does not restate it, because a
second copy of that list is how the entry contradicted itself before. The reason it is safe to
delete them: every level of the tower stops existing, because
those levels existed only to reject a degenerate ANSWER and a variable declaration has no answer to
degenerate. It also produces actionable error text instead of "Type 'false' does not satisfy the
constraint 'true'".

Explicitly NOT the jest-plus-`tsc` mutation harness first proposed: that is a second mechanism for
what the `@ts-expect-error` cases already do (principle 4), costs a compiler subprocess per
mutation, and its mutation set would be a hand-kept list — reintroducing "a list is not a rule"
at the layer meant to end the regress.

Residual the replacement does NOT fix, and no further level would: the assertions are deletable.
Removing an assertion and then weakening what it guarded is two edits and leaves both typechecks
green. That is diff-visible rather than silent, so it is review surface, not a hole. Only
`NamedContractKeys` is load-bearing on production code today.

### P1 — A nested boolean swap in the render-contract wiring compiles and passes (2026-09-05)
Pre-existing on `main`; the fields arrived with PR #480 and this is not a regression from the
branding work. Found by the cross-model peer while reviewing that branch.

`RenderContractInput` carries `calendarItems: { showRecurring: boolean }` and
`externalCalendars: { enabled: boolean; representativeColor: string | null }`. The two enclosing
object types differ, so the pairwise interchangeability guard correctly reports `never` — but the
guard is top-level only, and the two LEAF booleans are interchangeable. Swapping the values assigned
to them in `src/bases/register.ts` is a clean compile AND a green unit suite: measured, zero
typecheck diagnostics and 21/21 passing. With recurring enabled and external calendars disabled,
the legend then receives the opposite state and selects external-event treatment.

Two reasons nothing catches it. The brands protect top-level fields, and a value nested one level
down is outside the derivation — a limit the branding learning states but does not close. And the
projection fixture assigns `true` to both, so even a test that exercised the swap could not see it:
a fixture with identical values cannot detect a crossing.

Whoever takes it should do both halves: give the leaves distinguishing values in the fixture
(`true`/`false`), and add a register-level wiring assertion, since the projection's own test builds
its input directly and structurally cannot catch a miswire in the caller that assembles it. Branding
the leaf values, or having the reader mint the bundle, is the design fix behind both.
