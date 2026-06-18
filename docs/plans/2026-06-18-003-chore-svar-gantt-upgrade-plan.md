---
title: "chore: Upgrade SVAR Gantt 2.3.0 → 2.7.0 + revalidate"
status: completed
date: 2026-06-18
depth: standard
---

# chore: Upgrade SVAR Gantt 2.3.0 → 2.7.0 + revalidate

## Summary

Upgrade `@svar-ui/svelte-gantt` from **2.3.0 to 2.7.0**, fix whatever compatibility breakage surfaces, and revalidate the Gantt's load-bearing behaviors. This is prerequisite infrastructure that unblocks `docs/plans/2026-06-18-002-feat-gantt-frozen-columns-and-divider-plan.md` — that feature needs 2.7.0's `gridWidth` prop + `resize-grid` action/event for divider persistence. **No new features here**: it's a dependency bump, compatibility fixes, and a revalidation pass.

---

## Problem Frame

The plugin pins `@svar-ui/svelte-gantt: ^2.3.0`; the sanctioned grid-width API (`gridWidth` prop, `resize-grid`/`resize-chart` actions/events) that plan 002 depends on landed in a later 2.x minor (latest is 2.7.0). The Gantt rides heavily on exact SVAR behavior — the zoom/scroll-preservation diff-sync (PR #73, seed-once props + `api.exec`), non-summary parent rendering + subtree-move + gated ancestor extend (PR #75), drag/resize write-back, status coloring, and the just-shipped grid-columns feature (PR #77) — so a minor-version bump across four releases carries real regression risk that automated tests alone don't fully cover (the SVAR-store interaction seams are exercised by e2e + in-vault, not unit tests).

Two facts from research shape the approach:

- **Dependency fan-out is automatic.** `@svar-ui/svelte-gantt`'s `package.json` **exact-pins** its `@svar-ui/*` deps (`gantt-store: "2.3.0"`, `svelte-grid: "2.3.0"`, `svelte-core: "2.3.1"`, etc.). Bumping the one direct dep pulls the matching 2.7.0 transitive set; we don't hand-bump siblings. The only other direct `@svar-ui` dep, `@svar-ui/svelte-toolbar`, is not currently imported in `src/` (the toolbar was removed in the zoom-fix work) — but a toolbar is planned in the near future, so it is **retained and bumped to `^2.7.0` in lockstep** rather than dropped (avoids drop-then-re-add churn and keeps the toolbar version aligned with the gantt for when it returns).
- **The changelog ships inside the package.** `@svar-ui/svelte-gantt` includes `whatsnew.md` in its published `files`, with a per-release `### Breaking changes` section (the GitHub repo and docs site don't surface it, which is why the first pass missed it — caught in doc-review). Reading the 2.7.0 `whatsnew.md` enumerates the 2.4–2.7 breaks, and cross-checking them against our code (below) shows a **small actual surface** — most breaks are in features we don't use. So the plan pre-enumerates from the changelog and uses the typecheck→build→test→in-vault funnel as the *net*, not the primary discovery mechanism.

### Confirmed 2.4–2.7 breaking changes and their impact on this plugin

From `whatsnew.md` (2.7.0 tarball), cross-checked against `src/`:

| Change (version) | Impact here |
|---|---|
| `expand-scale` action removed (2.6.0) | **None** — we never call `expand-scale` (grep-confirmed; it's SVAR-internal `Layout`). |
| Tooltip content receives `{ api, data }` not `{ task, segmentIndex }` (2.7.0) | **None** — we use no custom tooltip (grep-confirmed). |
| Calendar defined by plain config, not instance (2.7.0) | **None** — we use no `Calendar`. |
| Auto-conversion of parent tasks to summary tasks (2.5.0) | **PRO feature** — our community (MIT) build shouldn't auto-convert, so the non-summary parent model (#75) should hold. **Verify-first** — load-bearing for the cascade. |
| Community license GPL-3.0 → MIT (2.4.3) | Favorable; confirm no PRO-tagged 2.4–2.7 surface is relied on. |
| (Suspect, unconfirmed) scale format-string semantics | `GanttContainer.svelte` `zoomConfig` hard-codes date-fns tokens (`yyyy`, `QQQ`, `'W'w`, `EEE d`, …). A scale-format change wouldn't fail typecheck/build/unit and would garble scale headers at runtime — **verify-first suspect site** (flagged in doc-review; not confirmed in `whatsnew.md`, so treat as a known-fragile spot to check, not an asserted break). |

---

## Key Technical Decisions

- **Bump the direct deps; let npm resolve the family.** Set `@svar-ui/svelte-gantt` to `^2.7.0` and `@svar-ui/svelte-toolbar` to `^2.7.0` (kept for a planned toolbar), reinstall, and let the exact-pinned transitive `@svar-ui/*` packages move to their 2.7.0 set. Avoids hand-managing a dozen sibling versions.
- **Breaking changes are pre-enumerated from `whatsnew.md`, then funnel-verified.** Read the 2.7.0 `whatsnew.md` for the 2.4–2.7 `### Breaking changes`, cross-check each against our usage (the table above), and pre-seed the compat-fix checklist. The typecheck→build→unit→e2e→in-vault funnel is the *net* that catches anything the changelog didn't flag or that we mis-assessed — not the primary discovery mechanism.
- **Big-bang to 2.7.0 (latest), not incremental stepping.** Justified because the changelog is now known (not a black box) and the confirmed break surface against our code is small (the table above). Incremental 2.3→2.4→…→2.7 stepping is the **fallback** only if an in-vault regression resists attribution — the per-minor changelog lets us attribute most regressions without bisecting.
- **Revalidation net = existing unit suite + a targeted echo-seam characterization test + in-vault checklist (e2e is render-only).** Correction from doc-review: the e2e suite asserts *what renders*, not interactions — it does **not** exercise drag/zoom/cascade. The pure logic (`ganttSync`, `cascadeGate`, `gridColumns`, `propertyValues`) is already unit-tested and version-independent (stays the lock). For the highest-risk SVAR-store seam — the cascade's `update-task`/`move-task` **echo classification** (`classifyUpdateEvent` + `eventSource`), which `cascadeGate.ts` itself flags "re-verify against the store on a SVAR upgrade" — add **one targeted characterization test** that exec's actions through a mounted `<Gantt>` store and asserts the echo is classified correctly (if jsdom mounting proves feasible; else document why and lean on in-vault). The remaining integration behaviors (pixel drag, zoom preservation, status coloring) stay on the in-vault checklist.
- **Confirm the unblock as an acceptance gate.** Part of "done" is statically confirming the installed 2.7.0 exposes the `gridWidth` prop + `resize-grid` action/event, so plan 002 can build on them.

---

## Requirements

- R1. `@svar-ui/svelte-gantt` is at `2.7.0` (with its transitive `@svar-ui/*` set) and `@svar-ui/svelte-toolbar` bumped to `^2.7.0` in lockstep (retained for a planned toolbar), and `npm install` + `npm run typecheck` + `npm run build` are clean.
- R2. Any breaking API / type / CSS-class changes (props, actions, events, `wx-`-prefixed classes the plugin styles against) are surfaced and fixed so the Gantt renders and existing features behave.
- R3. The full unit suite (357 tests) and the e2e suite pass, after any legitimate assertion updates that reflect intended SVAR changes (not masking regressions).
- R4. The SVAR-interaction behaviors are revalidated in-vault: zoom/scroll preservation across refresh (#73), parent drag moves subtree + gated ancestor extend (#75), drag/resize write-back, status bar-coloring, and grid-columns (render/order/type-cells/`columnSize` resize-persist/zoom-survive, #77).
- R5. The installed 2.7.0 exposes the `gridWidth` prop + `resize-grid` action/event (unblocks plan 002).
- R6. No new features — the divider/freeze work is out of scope (plan 002).

---

## Implementation Units

### U1. Bump SVAR to 2.7.0 and restore the build

- **Goal:** `@svar-ui/svelte-gantt` is at 2.7.0 with a clean install/typecheck/build; the toolbar dep is bumped in lockstep; compile-time breakage is fixed.
- **Requirements:** R1, R2, R5, R6.
- **Dependencies:** none.
- **Execution note:** Capture a green baseline first — run the unit suite + build on 2.3.0 and confirm the current in-vault state — so post-bump diffs are attributable to the upgrade.
- **Files:** `package.json` (`@svar-ui/svelte-gantt` → `^2.7.0`; `@svar-ui/svelte-toolbar` → `^2.7.0`), `package-lock.json` (regenerated), and any `src/` files needing compatibility fixes — most likely `src/bases/GanttContainer.svelte` and `src/bases/ganttSync.ts` if SVAR types/actions/props changed (discovered, not assumed).
- **Approach:** (1) **Read the changelog first** — after install, read `node_modules/@svar-ui/svelte-gantt/whatsnew.md` for the 2.4–2.7 `### Breaking changes` and reconcile against the impact table in Problem Frame (catch anything new). (2) Bump both direct deps (keep `svelte-toolbar` — a toolbar is planned soon, so align its version now); reinstall so the exact-pinned transitive `@svar-ui/*` packages resolve to their 2.7.0-aligned set. Note the `@svar-ui/*` family is **not** uniformly "2.7.0" — the `svelte-*`/`gantt-*` packages move to their 2.7.0-aligned versions while `lib-*`/`*-locales`/`svelte-core` ride independent trains at whatever 2.7.0 exact-pins; verify resolution, not a uniform version. (3) Run `npm ls @svar-ui/svelte-core` to confirm a **single deduped** `svelte-core` (the retained `svelte-toolbar` and `svelte-gantt` must agree on it; two copies = a duplicate-reactive-context footgun — if it appears, align or drop `svelte-toolbar` for this chore). (4) Run `npm run typecheck` and `npm run build`; fix what they surface — SVAR is Svelte 5 in both versions (installed 5.39.6), so breakage is API/type-shape drift, not a framework migration. (5) Statically confirm the unblock: `gridWidth` is a real `<Gantt>` prop and `resize-grid`/`resize-chart` exist as store actions in the installed 2.7.0 (R5). Dev env: fnm Node 20 + `NODE_EXTRA_CA_CERTS` (see Dependencies).
- **Patterns to follow:** the existing SVAR imports/usage in `src/bases/GanttContainer.svelte` (`Gantt`, `Willow`, `defaultTaskTypes`, `api.exec`/`api.on`/`api.intercept`, `api.getTable`); `src/bases/ganttSync.ts` for the task/action shapes.
- **Test scenarios:** `Test expectation: none` — this unit is a dependency bump + compile-time compatibility; behavioral coverage is U2/U3. (Any code change made to satisfy a SVAR API change is validated by the existing suite in U2.)
- **Verification:** `npm install` clean; `npm run typecheck` 0 errors; `npm run build` succeeds; installed `@svar-ui/svelte-gantt` is 2.7.0; `gridWidth` + `resize-grid` confirmed present in the installed package.

### U2. Revalidate the automated suite + pin the cascade echo seam

- **Goal:** The unit suite and e2e pass on 2.7.0; the highest-risk SVAR-store seam (cascade echo classification) gains a characterization test so it's no longer manual-only.
- **Requirements:** R3.
- **Dependencies:** U1.
- **Execution note:** Write the echo-seam characterization test against 2.3.0 **first** (it should pass on the baseline), then re-run after the bump — that's what makes it a regression net rather than a post-hoc rationalization.
- **Files:** a new characterization test (e.g. `test/unit/cascadeEcho.characterization.test.ts` or an integration spec) that mounts `<Gantt>` and drives the store; test files only where an assertion legitimately changes for an intended SVAR behavior (e.g. `test/unit/ganttSync.test.ts`, `test/specs/*.e2e.ts`).
- **Approach:** Run `npx jest` (the baseline jest count — treat the actual baseline run as authoritative, not a hardcoded number) and the e2e suite (`npm run e2e` with `OBSIDIAN_TEST_VAULT`). The pure-logic unit tests are version-independent and should pass untouched — a failure there means our code changed, not SVAR. **Correction (doc-review):** the e2e suite asserts *what renders* (mount, bar/link render counts, status classes) — it does **not** exercise drag/resize/zoom/reparent/cascade, so it is not the net for #73/#75/#77. To convert the highest-risk seam from manual-only to automated, add **one characterization test**: mount `<Gantt>` with a small fixture, `api.exec('move-task'/'update-task', { eventSource: OG_ECHO_SOURCE })` and a user-gesture variant, and assert `classifyUpdateEvent` / `CASCADE_EVENT_SOURCES` classify echo vs. gesture as expected (the contract `cascadeGate.ts` flags for re-verification on upgrade). **Verify-first:** confirm `<Gantt>` mounts under the jest/jsdom setup; if it can't, document why and leave this seam to the in-vault checklist (U3). Triage every failure: intended SVAR contract change (update assertion + one-line rationale) vs. regression (fix code). Do not weaken assertions to force green.
- **Patterns to follow:** existing `test/unit/cascadeGate.test.ts` (pure classify tests — the characterization test extends these through the real store); `test/specs/*.e2e.ts`; dev-run-config env (fnm Node 20, `NODE_EXTRA_CA_CERTS`, `@swc/core-win32-x64-msvc` for jest).
- **Test scenarios:**
  - The existing unit tests pass unchanged (version-independent pure logic); any required change is an intended-SVAR-change update with a one-line rationale.
  - Characterization (if jsdom-feasible): a programmatic `move-task`/`update-task` tagged `OG_ECHO_SOURCE` is classified as an echo (ignored), and an untagged user-gesture update is classified as a gesture — on both 2.3.0 baseline and 2.7.0.
  - e2e passes (mount + render assertions); triage any failure per the approach.
- **Verification:** `npx jest` green (incl. the new characterization test, or a documented reason it couldn't mount); e2e green; any assertion change justified in its diff.

### U3. In-vault revalidation of the SVAR-interaction seams

- **Goal:** Manually confirm in the test vault that the behaviors only fully exercised at runtime still work on 2.7.0.
- **Requirements:** R4.
- **Dependencies:** U1 (U2 ideally green first).
- **Files:** none (verification); CSS/compat fixes only if a regression is found, in `src/bases/GanttContainer.svelte`.
- **Approach:** `npm run build` (postbuild installs to the test vault), reload the Gantt, and walk the checklist below — these are the integration seams the unit suite cannot cover:
  - **Zoom/scroll preservation (#73):** zoom + scroll, then trigger a plain data refresh (edit a date, drag a bar, change a Base filter) → view state survives (no re-init).
  - **Parent renders as a non-summary bar (#75 foundation):** confirm parents still render as ordinary draggable bars at their own dates — i.e. the 2.5.0 PRO "auto-conversion of parent tasks to summary tasks" did **not** silently activate on the community build. If parents became summaries, the cascade design breaks (see Risks).
  - **Parent-date cascade (#75):** drag a parent → subtree moves with it; a child pushed outside an ancestor triggers the gated extend (Ask/Auto/Never); resize a parent below its children offers the per-edge shrink-fit.
  - **Drag/resize write-back:** drag/resize a bar → persists to the mapped TaskNotes fields.
  - **Status coloring:** bars colored by TaskNotes status palette.
  - **Scale headers render correctly (2.4.x suspect):** at all 6 zoom levels, the timescale header labels read correctly (year/quarter/month/week/day) — guards the `zoomConfig` date-fns format tokens against a scale-format change. A garbled or blank label is the signal to migrate the tokens to SVAR's 2.7.0 scale-format scheme.
  - **Grid columns (#77):** columns render in Base order with type-aware cells; column resize persists to `columnSize` and round-trips; zoom survives a plain refresh with columns present.
- **Test scenarios:** `Test expectation: none` — runtime/visual revalidation, not unit-testable; the checklist above is the acceptance evidence.
- **Verification:** every checklist item behaves as on 2.3.0; any regression is fixed (or, if a genuine SVAR behavior change, documented and assessed against the affected feature).

---

## Scope Boundaries

**In scope**
- Upgrading `@svar-ui/svelte-gantt` to 2.7.0, the compatibility fixes it requires, bumping `@svar-ui/svelte-toolbar` in lockstep (retained for a planned toolbar), and revalidating the existing Gantt behaviors.

**Deferred to Follow-Up Work**
- The frozen-columns + divider feature itself (`docs/plans/2026-06-18-002-...`) — this upgrade only unblocks it.
- Adopting any *other* new 2.4–2.7 capabilities surfaced during the bump (e.g. new APIs beyond `gridWidth`/`resize-grid`) — note them, don't build on them here.

**Out of scope**
- *Broad* characterization tests across all SVAR-interaction seams — only the one cascade echo-classification test is in scope (U2); pixel-drag/zoom/status remain in-vault.
- Upgrading non-`@svar-ui` dependencies.

---

## Risks & Dependencies

- **2.5.0 "auto-conversion of parent tasks to summary tasks" vs. the non-summary #75 model (load-bearing).** Our whole parent-date cascade depends on parents being **non-summary** (summaries reject asymmetric date writes — see `svar-summary-gotchas`). The 2.5.0 auto-conversion is tagged **PRO**, so the community build should be unaffected — but this is the single most consequential assumption in the upgrade. Mitigation: explicit verify-first in U3 (parent renders as a draggable non-summary bar); if it converts, the cascade needs rework and that's surfaced, not forced into this chore.
- **Residual breaking-change risk is small but non-zero.** The confirmed 2.4–2.7 breaks (`expand-scale` removed, tooltip content shape, calendar config) don't touch our code (grep-confirmed); the live suspect is the `zoomConfig` date-fns scale tokens (U3 scale-header check). Mitigation: the changelog pre-seed (U1) + the funnel; the green baseline (U1) makes any regression attributable to a specific minor via `whatsnew.md`.
- **The automated net does NOT cover the interaction seams; in-vault is load-bearing.** Doc-review correction: e2e asserts render only — drag/zoom/cascade are exercised solely by U3's manual checklist (plus the one echo-seam characterization test from U2). This is a single non-repeatable pass, not CI coverage. Mitigation: the echo-seam test (U2) automates the highest-risk contract; the rest stays in-vault and is accepted for a one-time upgrade.
- **Transitive resolution / duplicate `svelte-core`.** The retained `svelte-toolbar@^2.7.0` and `svelte-gantt@^2.7.0` must agree on one `svelte-core`; two copies = duplicate reactive context. Mitigation: `npm ls @svar-ui/svelte-core` dedupe check in U1; align or drop `svelte-toolbar` if it splits.
- **Dependencies / environment:** dev-run config (fnm Node 20, `NODE_EXTRA_CA_CERTS=C:/Users/renat/norton-ca.pem`, `@swc/core-win32-x64-msvc` for jest, `OBSIDIAN_TEST_VAULT` for e2e); installed Svelte 5.39.6; the merged #73/#75/#77 behaviors are the revalidation targets.

---

## Sources & Research

- SVAR resizer/grid-width API (latest 2.7.0): https://docs.svar.dev/svelte/gantt/guides/resizer/ — `gridWidth` prop, `resize-grid`/`resize-chart` actions + events. Column freezing remains undocumented in 2.7.0 (columns API: `id, width, align, flexgrow, resize, sort, header, footer, template, cell, editor, options, getter`). See memory `svar-grid-resize-api-and-version-gap`.
- Local dep inventory (this session): `@svar-ui/svelte-gantt@2.3.0` exact-pins its `@svar-ui/*` deps; only `svelte-gantt` is currently imported in `src/` (`@svar-ui/svelte-toolbar` is unused *now* but retained + bumped for a planned toolbar); Svelte 5.39.6; latest svelte-gantt = 2.7.0 (npm).
- Changelog ships **in the npm package**: `node_modules/@svar-ui/svelte-gantt/whatsnew.md` (in the published `files`), with per-release `### Breaking changes`. The 2.7.0 tarball's `whatsnew.md` was read this session for the 2.4–2.7 entries (the GitHub repo/docs site don't surface it — the first pass wrongly concluded none existed; corrected in doc-review). Confirmed breaks: `expand-scale` removed (2.6.0), tooltip content `{api,data}` (2.7.0), calendar plain-config (2.7.0), parent→summary auto-conversion (2.5.0, **PRO**), license GPL-3.0→MIT (2.4.3, favorable — confirm no PRO surface relied on).
- Unblocked plan: `docs/plans/2026-06-18-002-feat-gantt-frozen-columns-and-divider-plan.md`. Related learnings: `docs/solutions/tooling-decisions/svar-gantt-summary-type-constraints.md`; memories `svar-summary-gotchas`, `svar-grid-resize-api-and-version-gap`, `dev-run-config`.
- Revalidation targets: PR #73 (zoom/scroll diff-sync — `src/bases/ganttSync.ts`, `GanttContainer.svelte`), PR #75 (parent-date cascade — `src/bases/cascadeGate.ts`), PR #77 (grid columns — `src/bases/gridColumns.ts`, `PropertyCell.svelte`, `propertyValues.ts`).
