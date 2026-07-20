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

### P1 — e2e: pointer-drag simulation harness
The single most-repeated residual. Multiple deferred e2e tests are all blocked on the same missing
capability: simulating pointer-drag in headless WDIO (drag-to-persist, drag-to-resize, drag-to-link).
Building it once unblocks all of them.
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

---

## Medium priority

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
   store, so no recompute fires and the tint stays put while the bars move. This is the harder
   problem: SVAR's own collapse UI never notifies the plugin, so correctness needs a reliable
   row-geometry change signal (a geometry fingerprint checked per tick, or an intercept covering
   every mutation path). A tint sitting on the wrong row asserts something false about that task's
   non-working days — worse than no shading at all.

Two lesser findings to carry over: `buildTaskBlocking`'s single-slot memo thrashes when stretch and
row shading are both on (two call sites compute different windows and evict each other every pass —
give row shading its own slot or share one result); and the overlay was appended after `.wx-bars`,
so at equal stacking it painted *above* the bars rather than below.

**Prerequisite for revisiting:** the treatment-channel redesign in
`docs/brainstorms/2026-07-20-date-provenance-and-treatment-channels-requirements.md`. Row shading
would be a fourth surface encoding calendar identity by colour (after bars, columns and markers);
whether it earns that channel is a question that redesign should answer first.

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
