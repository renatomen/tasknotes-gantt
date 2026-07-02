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

### P2 — Open render/index residuals (#161 tail)
Both flagged OPEN in maintainer notes after the #161 render-loop work.
- **(a) U6 toolbar-search re-poke** — clearing a Bases toolbar search (e.g. `6 → 261` rows) disarms
  both #161 loop-breakers and triggers an unguarded bulk `getValue()` re-poke. Local repro spec:
  `test/specs/_local-clone-search.e2e.ts`. Source:
  `docs/plans/2026-06-27-001-fix-view-option-render-churn-plan.md` (U6).
- **(b) Direct-frontmatter read** — read frontmatter directly to avoid bulk `entry.getValue()`
  entirely (the renotify-storm's deeper follow-up). Source:
  `docs/plans/2026-06-28-002-fix-gantt-diff-sync-bulk-reseed-plan.md`.

---

## Medium priority

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
- Inline cell editing of property values; column sorting persistence. Source:
  `docs/plans/2026-06-18-001-feat-gantt-grid-bases-columns-plan.md`.

### P8 — e2e / CI infra
- Commit the `vault-as-code` fixture (real frontmatter, secrets redacted) for CI, then wire the #161
  repro in as a gated job. Privacy decision the maintainer flagged as separate. Source:
  `docs/plans/2026-06-28-002-fix-gantt-diff-sync-bulk-reseed-plan.md`.
- Generalize the per-column readiness helper into shared e2e harness utils if other specs hit the
  property-column-header race. Source:
  `docs/plans/2026-06-29-001-fix-gantt-column-sort-e2e-flake-plan.md`.
- **Harden `gantt-bar-treatments.e2e.ts` theme-accent flake.** The spec `"injects theme rules driven
  by the theme's own accent (interactive-accent)"` intermittently fails: `activeTreatmentCss()` is
  read before the theme-source view has fully mounted (log shows `WebDriverError: No tab group found`
  mount hiccups), so the injected stylesheet lacks `var(--interactive-accent)` and the assertion
  fails. Confirmed a flake — passed on a plain CI re-run with **zero** code changes (PR #204,
  2026-07-02), and the unit test for the identical assertion (`barTreatment.test.ts`) is stable. Same
  mount/readiness-timing family as the column-sort and dependency e2e flakes, both fixed with a
  **specific-element readiness gate** — mirror that here: wait for the theme treatment rule (e.g. a
  `.wx-bar` accent rule in the injected `<style data-og-status>`) to be present before reading the
  CSS, instead of reading eagerly. Refs: `docs/solutions/integration-issues/svar-gantt-injected-css-scoped-specificity.md`,
  memory `gantt-column-sort-e2e-flake-worsening`, `dependency-e2e-flake`.
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
