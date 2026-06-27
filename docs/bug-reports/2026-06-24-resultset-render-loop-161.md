# Bug Report — Render loop + freeze on resultset change (#161)

**Status:** Two distinct problems were entangled under this issue. **Both are now resolved — issue #161 is CLOSED.**
- **(P1) The re-render LOOP — FIXED & verified in-vault.** Root cause was *not* the originally-hypothesised O(N²)/starvation; it was Bases re-firing `onDataUpdated` in a burst (with the persisted view-option value oscillating) plus a full view remount, which our synchronous-recompute-per-fire amplified. Fixed by a trailing debounce + `isConnected` skip (matching TaskNotes' `BasesViewBase`). The user confirmed "no loop in any case."
- **(P2) The render FREEZE / Obsidian CRASH with large instance counts — RESOLVED (not an independent bug).** Re-assessed 2026-06-28: P2 was the *visible symptom* of three now-fixed causes, not a distinct static-render-scale defect. See the **P2 resolution** box below.

**Date opened:** 2026-06-24 · **Last revised:** 2026-06-28 (P2 resolved — see resolution box; superseding the 2026-06-25 "P2 still open" framing). The prior static-analysis root cause in §7 was already superseded by §8.
**Component:** `src/bases/register.ts` (notification handling — P1 fix) · `src/bases/coalesce.ts` (debounce) · `src/bases/GanttContainer.svelte` (SVAR render/diff-sync — P2) · `src/controller/GanttController.ts` (`buildSnapshot`) · `src/controller/InstanceExpansion.ts` (instance count).
**Severity:** ~~High~~ → **Resolved** (Show-all renders without freezing at production scale; see resolution box).

> **P2 RESOLUTION (2026-06-28).** P2 was a **composite symptom of three now-fixed causes**, not a genuine "SVAR can't render at scale" bug:
> 1. **F1 — a leftover debug `console.log` enumerating ~45,298 `wx-*` strings** in the scroll-reset block → the "48-second freeze" (`focuschange took 48367ms`), catastrophic **only with DevTools open**. *Removed.* The famous "45k DOM nodes / not virtualizing" evidence (§2, §8) came from **that dump's own enumeration under DevTools** — a confounded observation, not the live render.
> 2. **O(N²) `getSubtasks` per-node build** → replaced by the O(N) bulk relationship index (a4bdd52). Build dropped to ~200ms (§6).
> 3. **P1 render loop** (resultset-change re-render feedback) → fixed (coalescer + idempotent backstop + enrichment cache + `reuseTasks`). A sustained loop pegs CPU and grows memory — exactly the "freezes, then crashes after a while" signature.
>
> The **perf harness (PR #162)** then empirically **answered §8's gating question** ("is SVAR virtualizing?") with **yes**: virtualization holds at **3,332 instances** (isolated, headless Chromium) and **~3,710 instances** in real Obsidian + TaskNotes (~5.5s render, ~15 rows materialized, no freeze). The static-render-scale theory did not reproduce.
>
> Three independent confirmations: drivers removed → harness green at larger scale → **maintainer cannot reproduce on the production vault (2026-06-28)**. Honest caveat: the crash was never isolated to a single line and watched to vanish; it was resolved by removing its likely drivers, which is the expected outcome for a DevTools-confounded heisenbug. **No open issue tracks P2; do not re-open it as a blocker without a fresh, DevTools-closed reproduction.** §5/§8 below are retained as the investigation record.

> **Reading note for the next agent:** §5 lists hypotheses **invalidated by in-vault evidence** — do not re-try them. The static-analysis conclusions in the *original* report (an O(N²) `getSubtasks` freeze + a thread-starvation loop) are **superseded**: instrumentation proved the data pipeline is fast (~200ms). Trust the measured numbers in §6. Per the P2 resolution box above, the §8 "freeze is open" framing is also superseded.

---

## 1. Summary

The Gantt (OG) Bases view, on a real-sized vault, misbehaves on any resultset-changing action (clear a Bases search, change a filter, toggle a view option like "Hide top-level subtasks"). Investigation separated this into **two independent problems**:

- **P1 — Loop (FIXED):** the view re-rendered endlessly. Mechanism (confirmed by clean instrumented trace, §6/§7): a single toggle makes Bases fire `onDataUpdated` several times in a burst while it persists+reloads its config; during that burst the value our code reads live (`hideTopLevelSubtasks`) **oscillates** (`true→true→false`), and Bases **fully remounts** the view. Our code recomputed+rendered **synchronously on every fire**, reading the oscillating value each time → the burst was amplified into a self-sustaining loop. The idempotent backstop alone could not stop it (the value genuinely flips). **Fix:** debounce `onDataUpdated` (500ms trailing) + skip when the view is disconnected — exactly TaskNotes' `BasesViewBase.onDataUpdated` discipline. Verified: no endless climb on toggle / search-clear / filter.

- **P2 — Render freeze / crash (OPEN):** the production vault expands **261 Base rows → 1000 instances (Inherit) / 2660 instances (Show-all)** via multi-parent `projects` path expansion. Rendering that many instances freezes the chart before it finishes and eventually crashes Obsidian. The data build is fast (~200ms, §6) — so this is in the **SVAR render / DOM layer**, not our pipeline. The exact mechanism (is SVAR virtualizing? is it the DOM node count? a memory crash?) is **not yet confirmed** — see §8.

---

## 2. Symptoms

- **P1 (pre-fix):** `[OGDBG] onDataUpdated #N` and `recompute seq=N` climbed without settling; `Entries` count oscillated while the *Base* result count stayed constant (e.g. 261); CPU pegged.
- **P2 (current):** On loading/reloading Show-all, the chart renders partially then freezes; mouse barely moves; Obsidian crashes "after a while." First screenshot of the chart showed broken/overlapping rows and a console dump enumerating **45,298** `wx-*` DOM elements (≈ 2660 rows × ~17 nodes/row).
- Collateral (downstream of a freeze, not causes): SVAR `onScroll` null `scrollLeft`/`scrollTop`; a `periodic-notes` `onLayoutChange` `firstChild` crash; `[Violation] 'focuschange' handler took 48367ms` (see §5 — this 48s was the console dump, not our render).

## 3. Reproduction

1. Open the Gantt (OG) view over a Base returning ~261 TaskNotes tasks **with multi-parent `projects` relationships**, **Expanded relationships = Show all**.
2. P1: toggle "Hide top-level subtasks", or search→clear, or change a filter.
3. P2: simply load/reload the Show-all view on the production vault.

**Does NOT reproduce:** small test vault (low instance count); native Bases Table/Cards over the same Base; an empty rendered set.

## 4. Environment

- Plugin `tasknotes-gantt` (Bases view `obsidianGantt`); SVAR Svelte Gantt **2.3.0** bundled into `main.js` (note: 2.7.0 upgrade is planned separately).
- TaskNotes present as enrichment (`bases-scoped` strategy). Obsidian Bases custom-view API.
- Production-vault view config at time of capture: `tngantt_minHeight: 422`, `tngantt_maxHeight: 412` (so `resolveHostHeight` → **422px**, a *bounded* host — see §5 row "tall maxHeight").
- The investigator debugged with **DevTools open**, which materially affected P2 symptoms (the 45k-element `console.log`, §5).

---

## 5. Hypotheses — INVALIDATED (with evidence)

Do not re-try these. Each was killed by evidence, mostly in-vault instrumented runs.

| # | Hypothesis | Verdict | Disproving evidence |
|---|------------|---------|---------------------|
| 1 | Unguarded `config.set('columnSize', …)` re-enters `onDataUpdated` (original #161 theory) | **Invalidated** | Instrumented `onColumnResize`; it **never fires** during the loop. Only 3 `config.set` sites exist, all user-gesture-only. |
| 2 | `columnSize` write → `gridColumnsKey` change → SVAR reseed loop | **Invalidated (code-read)** | `gridColumnsKey` is `id:header` only — **width is deliberately excluded** (PR #73 guard, `gridColumns.ts:118-131`). A width write cannot force a reseed. |
| 3 | **O(N²) Show-all `getSubtasks` per-node = 1.5s freeze + thread starvation re-stream** (the *original report's* root cause) | **Invalidated (superseded)** | The O(N) index fix (a4bdd52) landed; instrumentation now shows `buildSnapshot` **total = 166–212ms** (`companion` stage incl. the full-vault index fetch = 146–183ms; `expand` = 1–5ms). The build is **fast** and is **not** the freeze. No 1.5s block in the data pipeline. |
| 4 | Enrichment-cache (cache relationship index + deps; refetch only on TaskNotes change) stops the loop | **Invalidated** | Implemented + 730 tests green, but **still looped in-vault**. (Kept — it's a correct perf improvement, just not the loop fix.) |
| 5 | Tall/unbounded `maxHeight` defeats SVAR virtualization → all rows render | **Invalidated** | User config is `minHeight=422 > maxHeight=412` → `resolveHostHeight` returns **422px (bounded)**. The host is *not* tall, yet it still freezes. So a tall host is not the cause. |
| 6 | The 48-second freeze is SVAR rendering 2660 rows | **Invalidated** | The 48s was a `[Violation] 'focuschange' handler took 48367ms` driven by a leftover debug `console.log('…', Array.from(wxElements).map(el=>el.className))` dumping **45,298** strings — catastrophic **only with DevTools open**. Removing that dump made fresh-mount captures show no 48s block. |
| 7 | A genuine config-value oscillation is impossible ("Bases is used by millions") | **Invalidated** | Clean trace (§7) shows `hideTop` read as `true, true, false` across one toggle's `onDataUpdated` burst — Bases' persist+reload genuinely exposes a transient oscillation; we rode it. (TaskNotes avoids it by debouncing + rendering from cached data.) |
| 8 | The current P2 freeze is the incremental diff-sync (`syncToGantt` per-`api.exec`) being O(N²) | **Likely invalidated** | After fixing the timer bug (below), the user reports the freeze happens **"before the gantt fully renders"** and the instrumented `[OGDBG] sync applied …ms` log **never appears** — so the diff-apply path isn't even reached. P2 is in the **initial render**, not the diff. (Still worth hardening — see §9.) |

### Bugs found and FIXED during the investigation (keep these)
- **(F1) The 45k-element console dump** in `GanttContainer.svelte`'s scroll-reset block — removed (it buried logs and froze DevTools). Never reinstate an all-elements `console.log`. **Recurred 2026-06-27** (a `config.set` wrapper doing `new Error().stack` + `JSON.stringify` per write froze the production vault) — the generalized guardrail is now `docs/solutions/developer-experience/no-heavy-diagnostics-on-hot-paths.md`.
- **(F2) `Illegal invocation` in the debounce scheduler.** `coalesce.ts` default scheduler was `{ setTimeout, clearTimeout }`; calling `scheduler.setTimeout(...)` invokes the global timer **as a method of the object literal**, which throws `TypeError: Illegal invocation` in Electron's renderer (the built-ins require `this === window`). The thrown error was **hidden by the `OGDBG` console filter**, and unit tests passed because they inject a *fake* arrow-function scheduler. Symptom: the debounced refresh **never fired → "data doesn't refresh."** Fixed by wrapping the globals in arrows (free-function call) + a real-timer (`jest.useFakeTimers`) regression test.

---

## 6. Confirmed facts (in-vault instrumented — trust these numbers)

Measured via `[OGDBG]` timing in `buildSnapshot`, `mount()`, and `syncToGantt`:

- **Data pipeline is fast.**
  - Inherit: `build total=166–205ms` (`getTasks=1–2`, `companion=146–183`, `expand=1–2`, `deps=18–22`), `mount()=39–69ms`, **tasks=261, instances=1000**.
  - Show-all: `build total=212ms` (`getTasks=2`, `companion=165`, `expand=5`, `deps=42`), `mount()=114ms`, **tasks=604, instances=2660**.
  - The dominant build cost (`companion` 146–183ms) is the **one-time full-vault relationship-index fetch** (`getRelationshipIndex` → `api.tasks.list`); with the enrichment cache it is `companion=0ms` on subsequent recomputes (`fetchedIndex=false`). So the O(N) index + cache work as intended.
- **Instance explosion is real and is the scale driver:** 261 Base rows → **1000 (Inherit) / 2660 (Show-all)** render instances — a 3.8–4.4× multiplier from multi-parent `projects` path expansion + `alsoTopLevel` doubling. `expandInstances` itself is cheap (`expand=1–5ms`) — it's the resulting *count* that stresses the render.
- **The loop (P1) mechanism, from a clean trace** (toggle hide-top, Inherit):
  ```
  onDataUpdated #1 → build hideTop=true  instances=416  → recompute seq=2 changed=true  → sync DIFF deletes=584 updates=163
  onDataUpdated #2 → build hideTop=true  instances=416  → recompute seq=3 changed=FALSE (idempotent backstop)
  onDataUpdated #3 → build hideTop=FALSE instances=1000 → recompute seq=4 changed=true  → sync DIFF adds=584
                   → GanttView onunload #1 → GanttView constructed #2 (REMOUNT) → dirty=true full refetch → recompute seq=1 …
  ```
  i.e. (a) the value oscillates `true→true→false` across the burst, and (b) the view fully remounts. Our `sync DIFF` uses `eventSource: OG_ECHO_SOURCE` and does **not** write Bases config — so the re-fires + remount come from **Bases itself** persisting/reloading the oscillating config.
- **P1 is fixed:** with the 500ms debounce + `isConnected` skip, `recompute seq` no longer climbs; user confirmed "no loop in any case."
- **P2 freeze is in the render, not our code:** build+mount are fast (above), but the chart still freezes "before it fully renders" / crashes; `[OGDBG] sync applied` never logs.

---

## 7. P1 (loop) — confirmed root cause & fix (DONE)

**Root cause:** Bases fires `onDataUpdated` in a rapid burst during a view-option persist+reload (the value can momentarily oscillate), and remounts the view. The old `onDataUpdated → refreshSource()` recomputed **synchronously on every fire**, re-reading the live (oscillating) config, amplifying the burst into an endless loop.

**Fix (implemented):**
- `src/bases/coalesce.ts` — a trailing-debounce coalescer (`createCoalescer`, injectable scheduler for tests). Unit-tested (7 tests, incl. a real-timer test guarding F2).
- `src/bases/register.ts` `onDataUpdated()`:
  - `if (!this.containerEl?.isConnected) return;` — skip the detaching view during a remount (kills the "old instance still recomputing" half).
  - First mount stays immediate; refresh-in-place is routed through `this.refreshCoalescer.schedule()` (500ms), which re-checks `isConnected` at fire time.
  - `refreshCoalescer.cancel()` on unload.
  - Debounce window `GANTT_REFRESH_DEBOUNCE_MS = 500` — matches TaskNotes' `scheduleBasesDataUpdateRender`.
- Reference implementation copied in spirit from TaskNotes `../tasknotes/src/bases/basesRefreshLifecycle.ts` + `BasesViewBase.ts` (`scheduleBasesDataUpdateRender`, 500ms + `isConnected`).

This is the correct, proven discipline; **keep it.**

---

## 8. P2 (render freeze / crash) — root-cause understanding (RESOLVED — see the P2 RESOLUTION box at the top)

> **Superseded (2026-06-28):** the "OPEN / is SVAR virtualizing?" framing below was answered **yes** by the perf harness (PR #162) and P2 is resolved as a composite of F1 + O(N²) + P1 (see the resolution box at the top). The section is kept as the investigation record.

**What we know:** data build + `mount()` are fast; the freeze is in SVAR's render/layout of **1000–2660 instances**, before the chart fully paints, and degrades to an Obsidian crash. The first screenshot showed **~45k `wx-*` DOM nodes** for the Show-all set.

**The central open question: is SVAR actually virtualizing?**
- The host is **bounded at 422px** (§5 row 5), so by SVAR's model it *should* virtualize and paint only ~visible rows. If so, 2660 instances should be cheap and something *else* freezes.
- But the 45k-DOM-node observation suggests it may **not** be virtualizing (at least the grid pane, or in SVAR 2.3.0). 2660 rows × ~17 nodes ≈ 45k — i.e. **all** rows materialised. Tens of thousands of DOM nodes → expensive layout/reflow → freeze; sustained re-renders → memory growth → crash.
- These two are mutually exclusive and **must be disambiguated empirically** (count actual rendered `.wx-row`/grid-row nodes for a known instance count; check whether the grid pane and chart pane each virtualize).

**Contributing factor (independent of virtualization):** the **4.4× instance explosion** (261 → 2660). Even with virtualization, SVAR still builds an in-memory tree/scale model for all 2660 nodes, and any non-virtualized pane pays full DOM cost. Reducing the instance count would lower the ceiling regardless.

**Honest gap:** we have not yet measured *where inside SVAR* the time goes (the freeze is past our instrumented boundaries). The next step is a DOM-node count + a DevTools performance profile (or a headless reproduction) — not another guess.

---

## 9. Suggested fix plan (P2)

Do these in order; **measure before and after each** (don't stack guesses).

1. **Disambiguate virtualization (the gating question).** With a known instance count (e.g. Show-all = 2660), count rendered grid rows and chart rows in the DOM (`.og-bases-gantt .wx-row` / grid cells). Two outcomes:
   - **Not virtualizing** → fix that first (it dominates everything). Verify the SVAR scroll container has a bounded height *and overflow* in the Bases embed; check whether SVAR 2.3.0 virtualizes the **grid** pane (the 45k count is grid-cell-heavy); consider the **planned 2.3.0 → 2.7.0 upgrade** (see memory `svar-grid-resize-api-and-version-gap`) if 2.3.0's virtualization is the limitation.
   - **Virtualizing fine** → the cost is SVAR's per-instance model build or our per-instance reactive work (status-color stylesheet, `idToSourcePath`, collapse maps); profile and reduce.
2. **Tame the instance explosion (independent win).** Audit the 261 → 1000/2660 multiplier in `InstanceExpansion.ts` + `companionResolve.ts` (multi-parent path duplication + `alsoTopLevel`). Options: cap/warn beyond a threshold; reconsider whether every multi-parent path needs a distinct instance; dedupe. Likely shares a root with the "Show all renders empty until indexed" bug (§11).
3. **Harden the diff-sync for large refreshes (defense-in-depth).** Even though P2 is the *initial* render, a large refresh (search-clear over 2660) would hit `syncToGantt`'s per-`api.exec` path. SVAR exposes bulk actions — **`provide-data`**, **`parse`**, **`filter-tasks`** (confirmed in `node_modules/@svar-ui`); prefer a bulk replace over hundreds of individual `add/delete/move-task` execs when the diff is large. (Per the project's SVAR rule, use the documented bulk API rather than hand-rolling.)
4. **Re-verify P1 still holds** after any render change (toggle/search-clear with `OGDBG` filter; `recompute seq` must not climb).

**Keep (already correct):** the P1 debounce + `isConnected` (§7), F1 (dump removal), F2 (scheduler fix), the enrichment cache + idempotent recompute + synchronous `resolveCompanionTree(index)` (all green, 730+ tests).

### Immediate user workaround
Use **Inherit** (not Show-all) and/or a Base filter to keep the rendered instance count low (well under ~1000). Lower counts render without freezing.

---

## 10. Open questions / residual gaps
1. **Is SVAR virtualizing the 1000–2660-instance render?** (§8 — the gating question; resolve with a DOM-node count.)
2. **Why did some fresh-mount captures look fast (mount 114ms, small reflows) while the user also sees a pre-render freeze/crash?** Hypotheses: the freeze is in SVAR's *post-`mount()`* async layout (past our boundaries); or it's threshold/variance-dependent at ~2660; or memory accumulates across reloads → crash. Needs a perf profile.
3. **Does P1's debounce interact badly with the remount** (the toggle remounts, then the debounced refresh corrects 500ms later against the settled config)? Confirm the corrected refresh lands and rows update (was blocked by F2; re-verify now that F2 is fixed).

## 11. Related / separate issues
- **"Show all" renders an empty chart** until TaskNotes finishes indexing — likely shares a root with the instance/expansion path. Separate bug.
- **SVAR `onScroll` null crashes** — library-internal; should disappear once the render is bounded.

## 12. Key code locations
- `src/bases/register.ts` — `onDataUpdated()` (debounce + `isConnected` — P1 fix); `mountGantt()` creates the coalescer; `[OGDBG]` instance/timing logs.
- `src/bases/coalesce.ts` (+ `test/unit/coalesce.test.ts`) — trailing-debounce coalescer (P1).
- `src/bases/GanttContainer.svelte` — `<Gantt>` mount; `syncToGantt` (diff-sync, `api.exec` per change — P2/§9.3); `resolveHostHeight` wiring (`hostHeightPx`, lines ~793-833); scroll-reset block (F1 removed); `[OGDBG]` `initGantt`/`sync` timing.
- `src/bases/ganttHeight.ts` — `resolveHostHeight` (bounded-host math; `DEFAULT_MAX_HEIGHT=400`).
- `src/bases/gridColumns.ts` — `gridColumnsKey` (`id:header`, width excluded — invalidates H#2).
- `src/controller/GanttController.ts` — `buildSnapshot()` (`[OGDBG]` stage timing; enrichment cache `enrichmentDirty`/`relationshipIndex`/`dependencyCache`); `recompute()` (idempotent backstop, `[OGDBG]` reason).
- `src/controller/InstanceExpansion.ts` — `expandInstances` (cheap, but defines the 1000/2660 instance count — P2/§9.2).
- `src/datasource/companionResolve.ts` — `resolveCompanionTree(matched, opts, index)` (now synchronous, O(1) index lookups; the O(N²) per-node `getSubtasks` is gone).
- TaskNotes reference: `../tasknotes/src/bases/basesRefreshLifecycle.ts` + `BasesViewBase.ts` — the proven debounce + `isConnected` pattern.

## 13. Working-tree state (branch `fix/resultset-render-loop`, uncommitted)
- **Fixes (keep):** P1 debounce (`coalesce.ts` + wiring), F1 (dump removal), F2 (scheduler arrows + test), enrichment cache + idempotent recompute + synchronous `resolveCompanionTree(index)`, updated `companionResolve.test.ts` / `GanttController.test.ts` (cache regression) / `coalesce.test.ts`.
- **Still present (strip before commit):** `[OGDBG]` instrumentation in `register.ts`, `GanttController.ts`, `GanttContainer.svelte` (`performance.now()` timing — currently 7 eslint `no-undef` errors that vanish on strip); a leftover unused `getComputedStyle` reference in `GanttContainer.svelte` (1 warning).
- Tests green at last full run (732); typecheck 0/0; build OK + installs to vault.
- **Not yet committed** — P2 is unresolved, so the branch is not PR-ready. Once P2 is fixed and `[OGDBG]` stripped: full green → commit → PR (`Fixes #161`).

## 14. Appendix — decisive traces

**P1 loop (pre-fix, Inherit toggle) — oscillation + remount:**
```
onDataUpdated #1 build hideTop=true  instances=416  recompute seq=2 changed=true  sync DIFF deletes=584 updates=163
onDataUpdated #2 build hideTop=true  instances=416  recompute seq=3 changed=false  (idempotent backstop)
onDataUpdated #3 build hideTop=false instances=1000 recompute seq=4 changed=true  sync DIFF adds=584
                 GanttView onunload #1 → GanttView constructed #2  (Bases remount)  build dirty=true total=196ms  recompute seq=1
```

**Stage timing (post-fixes, fast pipeline — proves build is NOT the freeze):**
```
Show-all : build total=212ms (getTasks=2 companion=165 expand=5 deps=42)  mount()=114ms  tasks=604 instances=2660
Inherit  : build total=166ms (getTasks=1 companion=146 expand=1 deps=18)  mount()=47ms   tasks=261 instances=1000
```

**F2 (Illegal invocation) — debounce never fired:**
```
onDataUpdated #1 entries=261
onDataUpdated #2 entries=261
(30+ seconds, no [OGDBG] coalescer fired / build / recompute — schedule() threw, hidden by OGDBG filter)
```
