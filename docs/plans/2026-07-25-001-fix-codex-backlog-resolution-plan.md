---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
type: fix
title: Codex backlog resolution — reconcile, fix, and close out
date: 2026-07-25
product_contract_source: ce-plan-bootstrap
origin: docs/codex-review-backlog.md
---

# Codex backlog resolution — reconcile, fix, and close out

## Goal Capsule

The Codex review backlog (`docs/codex-review-backlog.md`) captured ~78 review
threads across the calendar-stack PRs (#264–#324). Most were logged before the
`#318–#324` calendar-stack merges and the `#321` availability-union rewrite
landed. A four-agent reconciliation pass against current `main` (tip after
#324) classified every thread as **superseded / real / wrong / deferred**. The
result: **45 superseded**, **27 real code/doc fixes** (22 code + 5 docs; 0 P1
after spot-check, 1 security-adjacent, the rest P2/P3), **2 push-backs**
(by-design), and **4 deferred** (plan-doc threads + documented limitations).
These five classes sum to the ~78 threads in the backlog (45 + 27 + 2 + 4 = 78).

This plan does three things, in Codex-gated fix-PRs:
1. **Fix** the 27 real findings, grouped by file affinity into small PRs.
2. **Bulk-resolve** the 45 superseded threads, each with a reply naming the
   superseding change.
3. **Push back** on the 2 by-design findings with justification, and record
   the 4 deferrals.

**Definition of done:** every backlog thread reaches a terminal state (fixed /
superseded-and-resolved / pushed-back / deferred-with-record), Codex re-reviews
each fix-PR to zero unresolved comments, and `docs/codex-review-backlog.md` is
emptied or reduced to only the recorded deferrals.

## Scope Boundaries (non-goals)

- **No new features.** Every unit closes an existing review thread; nothing here
  adds behavior beyond what a finding calls for.
- **The deferred registry fail-visible propagation (backlog P2b)** stays
  deferred — it is tracked separately and is not part of this plan.
- **Hourly-granularity work** (rendering, conflicts, range→units quantization)
  remains out of scope, per the day-granularity project decision.
- **The 4 deferred plan-doc / WDIO-limitation threads** are recorded, not fixed.
- **CI v8-coverage false-negative** (a maintainer-infra item) is noted as a
  recommendation, not implemented here.

## Reconciliation Result (source of truth for the units)

Verified against `main` by four read-only agents (clusters A/F, C, D, G/J/E/K),
plus a spot-check of the two highest-severity findings.

| Class | Count | Handling |
|-------|-------|----------|
| Superseded | 45 | U9 — bulk thread-resolution with superseding-change citation |
| Real (code) | 22 | U1–U6 — grouped fix-PRs |
| Real (docs) | 5 | U7 — doc corrections (incl. #264 probe check) |
| Wrong / by-design | 2 | U8 — push-back replies |
| Deferred | 4 | U8 — recorded in backlog, threads left open with a note |

Counts are **threads**, not findings: a finding can cover two threads (U6's
routing-race groups #304 + #305), so U1–U6 enumerate 21 findings across 22 code
threads. The five classes sum to 78 (45 + 22 + 5 + 2 + 4).

**Spot-check reversal (important):** Agent 4 flagged #312-P1 (legacy
bar-treatment settings not migrated) as the only surviving P1. Spot-checking
`test/unit/viewOptions.test.ts:632–663` showed the read-time migration was
**deliberately removed and codified with tests** ("ignores the legacy keys
entirely — a legacy-only view falls back to the default"). It is **by-design**,
not a bug → moved to U8 push-back. Net surviving P1 count: **0**.

## Key Technical Decisions

- **KTD1 — Verify-before-fix is mandatory per finding.** The #312-P1 reversal
  proves a reconciliation agent can misread a deliberate, test-codified decision
  as a regression. Every unit's first step is: re-read the cited code **and any
  test that asserts current behavior**; if a test documents the behavior as
  intentional, stop and reclassify as push-back rather than "fixing" it.
- **KTD2 — Group by file affinity, not by PR-of-origin.** Findings from
  different original PRs that touch the same module ship together (e.g. all
  `ganttStripLayout.ts` findings in one unit) to minimize merge churn and
  Codex re-review rounds. The churn-reduction rationale only holds when the
  grouped findings share a module; where a unit groups thematically across
  distinct files (U5, U6), it carries a split contingency instead.
- **KTD3 — Each unit is its own gated PR.** Per the standing rule, no PR merges
  until Codex has zero unresolved comments on it. Units are independent and can
  be sequenced by priority; security first.
  *Granularity trade-off:* KTD2 groups by file affinity to minimize Codex
  re-review rounds, yet one gated PR per unit means ~7 code rounds. A
  consolidation (security-alone + one grouped-correctness PR + one docs/cosmetic
  PR) would cut rounds but bundle unrelated findings so a churn in one blocks the
  rest, and it breaks the campaign's established small-independent-PR pattern
  that keeps each fix's Codex review clean. We keep one-PR-per-unit as the
  default and lean on the U5/U6 split contingencies if a heavy unit churns.
- **KTD4 — Duplicate threads share one fix.** The createCalendarNote routing
  race is logged as two threads (#304 + #305); one fix resolves both. Same for
  any finding pair pointing at identical code.
- **KTD5 — Push-backs are replies, not silent closes.** By-design findings get a
  threaded reply citing the code/test that establishes intent, then the thread
  is resolved. Deferred findings get a reply naming where the deferral is
  recorded (backlog), and the thread is left open.
- **KTD6 — Verify-before-resolve is mandatory for the superseded bucket.** KTD1
  guards the *fix* set, but the 45 superseded threads are the larger bucket and
  a false-negative here (a still-real bug wrongly classed "superseded") is
  irreversible — U9 would close it forever. The reconciliation's own spot-check
  found 1 of 2 sampled classifications wrong, so before resolving each superseded
  thread, U9 re-reads the cited code and confirms the named superseding change
  makes the original condition impossible. Any thread that does not clearly
  verify is **promoted to a real-fix unit**, not resolved. This mirrors KTD1's
  discipline on the bucket that would otherwise get none.
- **KTD7 — Re-baseline each unit against the live main tip.** The reconciliation
  fixed every line anchor against one snapshot (main after #324), but the 9 PRs
  merge over time and shift line numbers — a later fix can even collide with or
  supersede a pending finding. Each unit's first step re-resolves its cited
  locations by **symbol/content, not raw line number**, against the current main
  tip, and re-confirms the finding still holds after earlier units merged.

## Implementation Units

Sequencing, not a priority gradient (after the #312 reversal every code unit is
P2): **U1 first** (security); **U2–U6 are independent** and parallelizable;
**U7–U9** (docs, push-backs, bulk-resolution) can run anytime alongside the code
units.

---

### U1. Sanitize the ColorField preview (security)

- **Goal:** Stop unvalidated calendar `color` frontmatter from being piped raw
  into an inline `style=` binding, closing a CSS-injection / remote-fetch vector.
- **Finding:** #303 (P2, security-adjacent). A malicious calendar note's
  `color: "url(https://attacker/pixel)"` fires a remote GET on editor open;
  `color: "red;position:fixed;inset:0;z-index:9999"` injects an overlay.
- **Files:**
  - Modify: `src/editor/ColorField.svelte` (line 26 `previewCss` derivation;
    consumers at lines 91, 94)
  - Test: `test/unit/ColorField.test.ts` (create if absent) — or extend the
    existing editor component test.
- **Approach:** `isHexColor` and `hexForCss3Name` are already imported (line 11)
  but unused for the preview. Gate `previewCss` so it only emits `value.trim()`
  when it is a recognized hex or CSS3 keyword; otherwise fall back to
  `'transparent'`. Prefer the shared `isValidCalendarColor` helper
  (`src/bases/css3Colors.ts`, = `isHexColor || isCss3ColorName`) over
  re-deriving the check inline, so every colour sink validates identically.
  **Emit the same string you validated** — the injection returns if the gated
  value and the painted value diverge. Consider extracting a single
  `paintableColor(value)` reused by `ColorField`, the U3 strip preview, and any
  future inline preview so the bug class cannot recur per-component.
- **Test scenarios:** valid hex → painted; valid CSS3 keyword → painted; empty →
  `transparent`; `url(...)` → `transparent` (no remote token in output);
  `red;position:fixed` → `transparent` (no injected declarations); leading/
  trailing whitespace around a valid value → painted.
- **Verification:** jest unit green; grep the rendered `style` attribute for the
  absence of `url(`/`;` when given a hostile value. `npm run e2e:local` not
  required (pure component logic).
- **Thread:** `PRRT_kwDOPzV6wM6SdS8Z` (comment `3619403675`).
- **Execution note:** proof-first — write the hostile-input test red, then gate.

---

### U2. Schema & RFC-mapping correctness

- **Goal:** Reject impossible dates, stop silently discarding a marker flag on
  recurring entries, and stop reusing an AVAILABLE anchor as a recurrence
  DTSTART.
- **Findings (all #267, P2):**
  1. `schema.ts:352` — `toIsoDate` accepts `2026-02-30` / `2026-13-01`
     (`Date.UTC` normalizes instead of `NaN`), feeding bad span math.
  2. `schema.ts:141` — an `events` entry with `marker:true` **and**
     `pattern`/`rrule` silently becomes a recurring event; the marker flag is
     dropped with no diagnostic.
  3. `rfcMapping.ts:105` — an anchorless recurring event reuses `pattern_start`
     as its `DTSTART`, shifting the recurrence set (contradicts the module's own
     doc). Projection-only; low live impact.
- **Files:**
  - Modify: `src/controller/calendar/schema.ts`, `src/controller/calendar/rfcMapping.ts`
  - Test: `test/unit/schema.test.ts`, `test/unit/rfcMapping.test.ts` (extend)
- **Approach:**
  1. Round-trip guard: `addDaysIso(text, 0) === text` (or explicit month/day
     range check), drop with a diagnostic on mismatch.
  2. In the rrule branch, if `entry.marker` is truthy, emit a diagnostic that
     the marker is ignored for recurring events.
  3. Leave `dtstart` undefined for anchorless recurrences (do not synthesize
     from `pattern_start`).
- **Test scenarios:** `2026-02-30` / `2026-13-01` / `2026-00-10` rejected with
  diagnostic; valid boundary dates (`2026-02-28`, leap `2028-02-29`) accepted;
  marker+rrule entry produces a diagnostic and does not silently drop the flag;
  anchorless recurring export omits DTSTART; anchored recurring export keeps it.
- **Verification:** jest green; both modules' existing tests still pass.
- **Threads:** `PRRT_kwDOPzV6wM6SFhW_` (3610705829), `PRRT_kwDOPzV6wM6SFhXC`
  (3610705832), `PRRT_kwDOPzV6wM6SFhXF` (3610705835).
- **Execution note:** characterize current (wrong) behavior first, then correct.

---

### U3. Year-grid / strip preview fidelity & the span-iteration freeze

- **Goal:** Fix the editor-freeze on long spans and three strip-preview fidelity
  gaps (marker colour, same-date overlap, old-anchor truncation).
- **Findings (all P2):**
  1. #290 `calendarDayFacts.ts:92-94` — `addSpanDays` iterates a full span
     day-by-day; a `1970→9999` span = millions of `addDaysIso` calls → freeze.
     Clip the loop to `max(span.start, window.start)`..`min(spanEnd, window.end)`.
  2. #294 `GanttStripPreview.svelte:115,125` + `ganttStripLayout.ts:28-33` —
     `StripMarker` carries no colour; markers hardcode `var(--text-accent)`
     instead of `definition.color`. Thread the colour through and apply inline.
     **Security (do not omit):** this newly inlines untrusted `definition.color`
     frontmatter into a `style=` binding — the exact CSS-injection / remote-fetch
     sink U1 closes in `ColorField`. The inlined value **must** pass the same
     allowlist before emission (reuse `isValidCalendarColor` / `isSafeColor`,
     fall back to `var(--text-accent)` on reject), mirroring how
     `markerOverlay.ts` already guards the runtime union path via `safeColor()`.
     Because U1 and U3 are separate PRs, the U3 reviewer will see only a
     "cosmetic colour" change and could ship the sink unguarded.
  3. #294 `ganttStripLayout.ts:82-88` — same-date markers on a single calendar
     get identical `xFraction` and overlap; group/offset them as
     `buildMarkerOverlay` already does on the union path.
  4. #299 `ganttStripLayout.ts:150-161,171` — an old `pattern_start` anchors the
     window at the earliest content, capped at `STRIP_MAX_DAYS`, truncating
     recent markers. When the span exceeds the cap, anchor on the **latest**
     authored content.
- **Files:**
  - Modify: `src/editor/calendarDayFacts.ts`, `src/editor/ganttStripLayout.ts`,
    `src/editor/GanttStripPreview.svelte`
  - Test: `test/unit/calendarDayFacts.test.ts`, `test/unit/ganttStripLayout.test.ts`
- **Test scenarios:** a 1970→9999 span resolves in bounded time and shades only
  in-window days; marker renders `definition.color` not the theme accent; two
  markers on one date render at distinct offsets; a calendar with a 2020 anchor
  and a 2026 marker keeps the 2026 marker visible; **a hostile marker colour
  (`url(...)`, `red;position:fixed`) renders as `var(--text-accent)`, not the
  raw value** (mirrors U1's hostile-input test).
- **Verification:** jest green; the span-clip test asserts a bounded call count
  (or completes under a timeout). Optional `npm run e2e:local` strip-preview
  spec if visual regression is a concern — otherwise unit is sufficient.
- **Threads:** `PRRT_kwDOPzV6wM6STpl4` (3615793426), `PRRT_kwDOPzV6wM6SWFDp`
  (3616685036), `PRRT_kwDOPzV6wM6SWFDw` (3616685045), `PRRT_kwDOPzV6wM6SZtH1`
  (3618020440).
- **Execution note:** the freeze (finding 1) is proof-first — write a
  bounded-work test that currently hangs/blows the call budget, then clip.

---

### U4. Bar-treatment: quadratic registry + strip ghost halo

- **Goal:** Bound the treatment-type registration cost and remove the 1px border
  halo on strip-mode stretched bars.
- **Findings (P2):**
  1. #312-P2 `ganttSync.ts:427-433` + `barTreatment.ts:426-427` —
     `buildTreatmentTaskTypes` nests `classes × classes`; the registry adds a
     slug per whole-vault palette entry, so N calendars → ~N² SVAR types →
     potential freeze in calendar-heavy vaults. Register only occurring pairs,
     or bound the palette.
  2. #283 `barTreatment.ts:693` + `GanttContainer.svelte:3451` — `.wx-bar.wx-split`
     zeroes only `background`; `stripBodyRule` still emits `border:1px solid
     !important` and `.og-ghost-runs` is inset by that border → 1px halo.
     Reset border width for ghost hosts. Cosmetic.
- **Files:**
  - Modify: `src/bases/ganttSync.ts`, `src/bases/barTreatment.ts`,
    `src/bases/GanttContainer.svelte`
  - Test: `test/unit/ganttSync.test.ts`, `test/unit/barTreatment.test.ts`
- **Test scenarios:** with N calendars the registered type count is O(N) (or
  bounded), not O(N²); occurring pairs still register; a strip-mode stretched
  bar emits no `border` width on the ghost host.
- **Verification:** jest green; a registry-size assertion over a synthetic
  multi-calendar fixture. The halo fix is visual → optional e2e/screenshot, but
  the rule-emission can be unit-asserted.
- **Threads:** `PRRT_kwDOPzV6wM6TDcXw` (3633500651), `PRRT_kwDOPzV6wM6SJVbF`
  (3612074700).

---

### U5. Calendar selection, picker & watch robustness

- **Goal:** Persist folder-qualified links, surface removable stale rows, offer
  a create action when only stale rows remain, re-resolve on delete, colour
  fetched-context bars, and attribute conflicts.
- **Findings (all P2):**
  1. #276 `register.ts:760` — persisted selection strips the folder to a bare
     basename; two same-named calendars in different folders collide. Persist
     the vault-relative path.
  2. #276 `CalendarPickerModal.ts:57` — `calendarsPresent` counts a flagged
     dangling row as a calendar, hiding the empty-state create action after the
     last real calendar is deleted. Count only `calendar`/`set` rows.
  3. #270 `calendarWatch.ts:82` — deleting a calendar never edited-in-view
     schedules no re-resolve (`knownPaths` seeded lazily, empty at mount). Seed
     `knownPaths` from the calendar notes in use at mount.
  4. #277 `calendarPickerModel.ts:126` — a selection pointing at a retagged
     (now non-calendar) note is counted "unresolved" in the banner but gets no
     removable picker row. Also flag entries whose `registryTarget` is null.
  5. #281 `register.ts:1290` — fetched-context (Show-all descendant) bars get
     the default role colour, not their calendar's, because associations are
     built only from `this.data?.data`. Also derive associations from rendered
     instance source paths (deduped).
  6. #277 `calendarConflicts.ts:91` — the conflict banner shows only a day count,
     not which calendars disagree. Thread the disagreeing-calendar names into
     the notice (the `conflictSources`/`buildConflictTooltip` machinery already
     exists for the set-editor preview).
- **Files:**
  - Modify: `src/bases/register.ts`, `src/bases/CalendarPickerModal.ts`,
    `src/bases/calendarWatch.ts`, `src/bases/calendarPickerModel.ts`,
    `src/bases/calendarConflicts.ts`
  - Test: `test/unit/calendarPickerModel.test.ts`, `test/unit/calendarWatch.test.ts`,
    `test/unit/calendarConflicts.test.ts`, plus register/picker coverage
- **Test scenarios:** two same-name calendars in different folders resolve
  distinctly after persist+reload; deleting the last calendar shows the create
  action; deleting an un-opened calendar triggers a re-resolve; a retagged note
  yields a removable flagged row; a fetched descendant bar renders its
  calendar's colour; the conflict banner names the disagreeing calendars.
- **Verification:** jest green across the five modules; the delete/re-resolve
  and fetched-colour paths may warrant an `npm run e2e:local` spec if they are
  e2e-observable and not already covered — check first (test at the fastest
  reliable level).
- **Threads:** `PRRT_kwDOPzV6wM6SGqcR` (3611112583), `PRRT_kwDOPzV6wM6SGqcT`
  (3611112587), `PRRT_kwDOPzV6wM6SFzic` (3610806300), `PRRT_kwDOPzV6wM6SHekI`
  (3611403972), `PRRT_kwDOPzV6wM6SIOSS` (3611677260), `PRRT_kwDOPzV6wM6SHekH`
  (3611403970).
- **Note:** this is the largest unit; if Codex re-review churns, split the
  conflict-attribution (finding 6) and fetched-colour (finding 5) into their
  own follow-up PRs.

---

### U6. Note creation, rename & editor save/discard races

- **Goal:** Handle the create-calendar command rejection, stop double-`.md` on
  rename, address the create→open routing race, honour a save in flight over a
  discard, and apply "don't ask again" to the very next drag.
- **Findings (P2):**
  1. #304 `main.ts:146,153` — `void createAndOpenCalendarNote(...)` discards a
     rethrown rejection (unhandled promise). Add `.catch` (mirror the
     open-as-markdown path at line 132).
  2. #305 `noteName.ts:35` — `renameTargetPath` appends `.md` unconditionally;
     `validateNoteName` doesn't strip → "Cal.md" becomes "Cal.md.md". Strip a
     trailing `.md` (mirror `noteBasename`).
  3. #304 + #305 (dup) `createCalendarNote.ts:42,60-61` — `waitForMarkerIndexed`
     resolves on the 2s timeout even when unindexed, routing a new note to
     markdown; the later cache update never re-routes the open leaf. Re-route
     the open leaf when the marker indexes after the timeout (keep the
     never-hang guarantee).
  4. #301 `UnsavedCalendarModal.ts:62` + `CalendarEditorView.ts:190-202` — a
     Discard is honoured while a save is in flight. Disable Discard while saving,
     or await the in-flight save in `confirmClose`.
  5. #314 `GanttContainer.svelte:2385,2405` — "Don't ask again" writes async via
     `onInferredDragModeChange?.(action)` but the mode is re-read from
     `$data.inferredDragMode`, so an immediate next gesture still sees `ask`.
     Keep a local in-memory mode synced on choice.
- **Files:**
  - Modify: `src/main.ts`, `src/editor/noteName.ts`,
    `src/bases/createCalendarNote.ts`, `src/editor/UnsavedCalendarModal.ts`,
    `src/editor/CalendarEditorView.ts`, `src/bases/GanttContainer.svelte`
  - Test: `test/unit/noteName.test.ts`, `test/unit/createCalendarNote.test.ts`,
    plus UnsavedCalendarModal / editor-view unit coverage
- **Test scenarios:** a rejected create command is caught (no unhandled
  rejection); "Cal.md" renames to "Cal.md" not "Cal.md.md"; a marker indexed
  after the timeout re-routes the open leaf; Discard during an in-flight save
  is blocked or waits; a second drag immediately after "don't ask again" uses
  the chosen mode.
- **Verification:** jest green; the modal save/discard race and the inferred-drag
  mode are unit-testable via the DI'd obsidian mock (Setting/Button/Toggle
  stand-ins). The routing race may need a fake-timer test.
- **Threads:** `PRRT_kwDOPzV6wM6SjlI6` (3621707589), `PRRT_kwDOPzV6wM6SlcXV`
  (3622385225), `PRRT_kwDOPzV6wM6SjlI3` (3621707585), `PRRT_kwDOPzV6wM6SlcXN`
  (3622385213), `PRRT_kwDOPzV6wM6SaW-b` (3618266927), `PRRT_kwDOPzV6wM6TYylV`
  (3641483460).
- **Note:** like U5, this is a heavy unit (5 findings across 6 modify files) and
  these findings do **not** share a module, so KTD2's "same-module = fewer
  rounds" rationale does not apply — the grouping is thematic, not file-affinity.
  If Codex re-review churns, split along the natural seams: the note-creation
  race (#304/#305, `main.ts` + `createCalendarNote.ts` + `noteName.ts`), the
  editor save/discard race (#301), and the inferred-drag mode (#314) are three
  independent follow-up PRs.

---

### U7. Documentation + trivial corrections

- **Goal:** Correct two CONCEPTS.md claims that no longer match the code, fix a
  dead wikilink, and fix the trivial DST-offset staleness.
- **Findings (P2/P3):**
  1. #274 `CONCEPTS.md:14` — "unassociated task follows the view default
     calendar" is false; `resolveTaskCalendar` returns an empty calendar set for
     a null association (never stretches, no view-default exists). Reword.
  2. #274 `CONCEPTS.md:26` — "one availability seam composed from both sources"
     is false; task blocking (per-association) and shading (union of displayed
     calendars) are separate paths. Reword to match.
  3. #309 `docs/backlog.md:61` — dead wikilink
     `[[calendar-bundled-keep-extractable-day-granularity]]` has no target.
     Point it at an existing learning or add the doc.
  4. #297 `CalendarEditorForm.svelte:185-186` (P3) — `timezoneOffset` derives
     only on `form.timezone`, so the "Currently …" label can show a pre-DST
     offset if the form stays open across a transition. Add a time dependency or
     recompute on focus. Trivial edge.
- **Files:** `CONCEPTS.md`, `docs/backlog.md`, `src/editor/CalendarEditorForm.svelte`
  (+ a small unit test for the offset recompute if practical)
- **Verification:** doc changes reviewed for accuracy against the cited code;
  the DST fix (if code) gets a unit test; jest green.
- **Threads:** `PRRT_kwDOPzV6wM6SGddf` (3611038885), `PRRT_kwDOPzV6wM6SGddi`
  (3611038890), `PRRT_kwDOPzV6wM6S2-P-` (3628904861), `PRRT_kwDOPzV6wM6SZB0e`
  (3617769817).
- **Note:** #264 (`test/probe/fixtures.ts` split-segment shape, low-confidence,
  probe-harness only) is folded here as an optional empirical check — verify
  whether the probe forces `splitTasks` disabled; if it does, the finding is
  moot and the thread resolves without a change. Thread
  `PRRT_kwDOPzV6wM6R_NZ_` (3608407030).

---

### U8. Push-backs and deferrals (no code)

- **Goal:** Close the by-design findings with justification and record the
  deferrals, so the backlog reaches zero open real items.
- **Push-backs (reply + resolve):**
  1. #312-P1 `viewOptions.ts:611-623` — the read-time migration of legacy
     `barColorMode`/`barColorSource` was **deliberately removed and codified**
     in `test/unit/viewOptions.test.ts:632-663` ("ignores the legacy keys
     entirely"). Reply citing the test; note this is a product decision the
     maintainer can revisit if upgrade-continuity is desired. Thread
     `PRRT_kwDOPzV6wM6TGJXl` (3634521897).
  2. #276 `main.ts:115-118` + `focusController.ts:311` — the command is
     intentionally enabled while any Gantt view is mounted (documented
     `pickActiveFocusEntry` most-recent fallback, `focusController.ts:290-292`),
     not only on the active leaf. Behaves as designed. Thread
     `PRRT_kwDOPzV6wM6SGqcS` (3611112585).
- **Deferrals (reply naming the record, leave open):**
  - #266 plan-doc:295 — refresh evaluated-date stylesheet on pan/zoom
    (`PRRT_kwDOPzV6wM6SFc9i`, 3610681433).
  - #266 plan-doc:303 — preserve explicit "Open as markdown" routing bypass
    (shipped as `suspendRouting`, but the thread is on the plan doc)
    (`PRRT_kwDOPzV6wM6SFc9k`, 3610681435).
  - #314 `GanttContainer.svelte:2492-2495` — cascade stand-down after an
    inferred-edge decision is a documented deliberate deferral
    (`PRRT_kwDOPzV6wM6TKkaR`, 3636185779).
  - #314 `gantt-inferred-date-drag.e2e.ts:14-22` — WDIO doesn't exercise the
    resize/modal/write round-trip; documented harness limitation
    (`PRRT_kwDOPzV6wM6TKkaU`, 3636185782).
- **Files:** `docs/backlog.md` (record the 4 deferrals if not already present;
  the #266 items may already be there).
- **Verification:** each push-back thread resolved on GitHub with a citation;
  each deferral has a backlog entry and a thread reply. No code change.

---

### U9. Bulk-resolve the 45 superseded threads (no code)

- **Goal:** Resolve every superseded thread with a one-line reply naming the
  superseding change, so Codex's re-review sees a clean slate.
- **Approach:** For each of the 45 thread IDs classified `SUPERSEDED`, first
  apply **KTD6 (verify-before-resolve)** — re-read the cited code and confirm the
  named superseding change makes the original condition impossible. Only then
  post a threaded reply (`gh api --method POST
  repos/renatomen/tasknotes-gantt/pulls/<PR>/comments/<id>/replies`) citing the
  superseding PR/rewrite (e.g. "Superseded by #321 availability-union rewrite —
  `workingDayRules` now unions availability blocks") and resolve the thread via
  the `resolveReviewThread` GraphQL mutation. A thread that does **not** verify
  is promoted to a real-fix unit, not resolved.
- **Superseded thread IDs (by cluster):**
  - A+F (23): from the cluster-A/F reconciliation output — editor/frontmatter/
    save findings resolved by the post-#289/#301 editor rework.
  - C (11): `PRRT_kwDOPzV6wM6STekQ`, `…STekW`, `…STekY`, `…SUKPO`, `…SUrNo`,
    `…SUrNr`, `…SU3Rm`, `…SVYmF`, `…SV71z`, `…SV717`, `…SZmrT`.
  - D (4): `PRRT_kwDOPzV6wM6SLgU5`, `…So8f5`, `…So8f7`, `…S1IkG`.
  - G/J/E/K (7): `PRRT_kwDOPzV6wM6SGSFu`, `…SGSFw`, `…SYV02`, `…TGrxR`,
    `…TPduI`, `…TZErd`, `…SJ-Yk`.
- **Verification:** all 45 threads show `isResolved: true` via the
  `reviewThreads` GraphQL query; a reply is attached to each.
- **Recovering the 23 A+F thread node IDs (do not depend on the session
  artifact).** `docs/codex-review-backlog.md` carries only the numeric
  `discussion_r…` comment IDs, and the transient reconciliation output
  (`tasks/…output`) is not committed and may be gone by execution time. Derive
  the `PRRT_…` thread node IDs directly: for each A+F-cluster PR (#287, #288,
  #289, #301), query its review threads via GraphQL —
  `repository.pullRequest(number:).reviewThreads` exposing each thread's `id`
  (the `PRRT_…` node), `isResolved`, and its `comments.nodes.databaseId` — then
  map the backlog's A+F comment IDs to their owning thread `id`. This makes all
  45 superseded IDs recoverable and auditable without the ephemeral file.

---

## Verification Contract

- **Per unit:** re-baseline first (KTD7 — re-resolve cited sites by symbol/
  content against the live main tip). Then jest unit tests green for the touched
  modules; new tests added for each behavior-bearing fix (proof-first or
  characterization-first per the unit's execution note). `npm run e2e:local` for
  any e2e-observable change not already covered at a faster level.
- **Per superseded thread (U9):** KTD6 verify-before-resolve — the cited code is
  re-read and the superseding change confirmed to cover the finding before the
  thread is resolved; non-verifying threads are promoted to a fix unit.
- **Per fix-PR:** green CI **and** Codex re-review to zero unresolved comments
  before merge (the hard rule). Arm a Monitor on each PR for CI + Codex state.
- **Overall DoD:** `docs/codex-review-backlog.md` emptied or reduced to only the
  recorded deferrals; every thread terminal.

## Definition of Done

1. U1–U7 merged, each Codex-clean and CI-green.
2. U8 push-backs resolved with citations; deferrals recorded.
3. U9: all 45 superseded threads verified (KTD6), replied-to, and resolved; any
   thread that failed verification promoted to a fix unit rather than closed.
4. Backlog file reflects only the deferred items (or is emptied).
5. No regression in the existing jest suite or e2e specs.

## Dependencies & Sequencing

- **U1 first** (security).
- **U2, U3, U4, U5, U6** are independent by file affinity — parallelizable,
  but each is its own gated PR; cap concurrent review rounds to stay on top of
  Codex.
- **U7, U8, U9** (docs / push-backs / bulk-resolution) can run anytime, in
  parallel with the code units.
- **U5 and U6** are the heaviest (thematic, cross-file); each carries a split
  contingency in its unit note — invoke it if Codex churns.

## Deferred to Implementation

- Exact A+F superseded thread node IDs — recover via the `reviewThreads` GraphQL
  query over PRs #287/#288/#289/#301 at execution start (see U9's recovery note),
  not from the transient session artifact.
- Whether U3's strip-preview visual fixes need an e2e spec or unit assertion is
  sufficient — decide per fix after seeing the geometry.
- Whether the #264 probe finding is moot — verify empirically whether the probe
  forces `splitTasks` disabled before deciding to change or resolve-as-moot.
- Whether #312-P1 becomes a maintainer product-decision (revisit migration) or
  stays a pure push-back — surface the trade-off in the push-back reply.
