# Maintainability Re-Diagnosis — the ranked defect list

**Date:** 2026-08-15
**Measured at:** `7949fd1135ed32017cb72aafdb92c4f09caf8267` (main), 477 commits total
**Supersedes:** the "12 files >500 LOC" target list (LOC-only framing, inadmissible under [principle 7](../architecture/principles.md)); updates the [2026-08-10 audit](2026-08-10-svar-conformance-and-maintainability-audit.md), whose churn/concern figures recorded no method and are re-measured here

This report is the maintainability campaign's Phase 0 deliverable and its measured baseline: every later trend report compares against these numbers. It lives in `docs/reports/` because it is a measurement record like the 2026-08-10 audit, not tracked work — backlog entries it ranks are promoted to issues only when picked up, per the backlog's own promotion rule. Rank = argued maintenance pain (the "few lines of CSS = 4 hours" cost class), from the recorded measurements; any rank can be disputed by re-measuring.

The diagnosis's stopping rule: this report ends at the ranked list. Dimensions not measured here (duplication, coverage distribution, dependency graphs) are out of scope by decision, not oversight.

---

## Method

All numbers reproduce from these commands at the recorded commit. No committed tooling was added; the instruments are git and the installed ESLint (9.36.0, flat config).

**Churn share** — full repository history (the repo is two months old; a single window), rename-aware via git's `--follow` heuristic, so the recorded sha plus the recorded loop is the reproducibility contract. Population: every tracked file under `src/`, `test/`, and `scripts/` (590 files) — the code-and-engineering-infrastructure breadth the plan's candidate-set decision names; root configs and `.github/workflows/` sit outside it (known blind spot, accepted: the backlog fold-in carries infrastructure defects in by evidence).

```bash
total=$(git rev-list --count 7949fd1135ed32017cb72aafdb92c4f09caf8267)   # 477
git ls-tree -r -z --name-only 7949fd1135ed32017cb72aafdb92c4f09caf8267 -- src test scripts | while IFS= read -r -d '' f; do
  n=$(git log --follow --format=%H 7949fd1135ed32017cb72aafdb92c4f09caf8267 -- "$f" | wc -l)
  printf '%s %s\n' "$n" "$f"
done | sort -rn
```

The population is enumerated from the recorded commit's tree (`git ls-tree`, not the live index, so a later add/delete/rename cannot shift the 590-file population), and the loop is NUL-delimited because 93 tracked paths (test-vault fixtures) contain spaces, which a word-splitting `for f in $(...)` loop fragments. Both properties were verified at recording time: the pinned-tree and live-index enumerations were identical at this sha, as were the split-safe and word-splitting loops for every file in the tables below.

**Separable-concern counts** — by enumeration with evidence (symbol or line-range), per principle 7: a count you cannot enumerate is a count you cannot dispute. Full lists below.

**Complexity-gate pressure** — the gate is `sonarjs/cognitive-complexity` at 15, in all three blocks of `eslint.config.mjs` (TS, JS, `.svelte`). Zero suppressions exist (`grep -rn "eslint-disable.*cognitive-complexity" src test scripts` → none), so pressure means functions *near* the ceiling, found by a threshold-lowered run with no config edit (`warn` severity — an `error` override would exit nonzero and look like a broken run):

```bash
npx eslint . --rule '{"sonarjs/cognitive-complexity": ["warn", 10]}'
```

---

## Measurement 1 — churn share

Top of the table (commits touching file / 477; test companions inline):

| File | Commits | Share |
|---|---|---|
| `src/bases/GanttContainer.svelte` | 89 | 18.7% |
| `src/bases/register.ts` | 71 | 14.9% |
| `src/controller/GanttController.ts` | 35 | 7.3% |
| `src/bases/types/gantt-view-data.ts` | 30 | 6.3% |
| `src/bases/ganttSync.ts` | 30 | 6.3% |
| `test/unit/ganttSync.test.ts` | 24 | 5.0% |
| `test/specs/gantt-calendar-editor.e2e.ts` | 24 | 5.0% |
| `test/unit/GanttController.test.ts` | 23 | 4.8% |
| `src/bases/viewOptions.ts` | 22 | 4.6% |
| `src/datasource/TaskNotesSource.ts` | 20 | 4.2% |
| `test/unit/viewOptions.test.ts` | 19 | 4.0% |
| `src/editor/CalendarEditorForm.svelte` | 16 | 3.4% |
| `src/controller/InstanceExpansion.ts` | 16 | 3.4% |
| `test/unit/TaskNotesSource.test.ts` | 15 | 3.1% |
| `src/main.ts` | 14 | 2.9% |
| `src/bases/barTreatment.ts` | 13 | 2.7% |
| `src/bases/BarContent.svelte` | 13 | 2.7% |
| `test/__mocks__/obsidian.ts` | 12 | 2.5% |
| `src/bases/services/BasesDataAdapter.ts` | 12 | 2.5% |
| `src/bases/calendarShading.ts` | 12 | 2.5% |

The table is every file with 12 or more commits, in recorded command order.

Reference points for the ranked list: `src/bases/entrySignature.ts` 9, `src/bases/cellEditCommit.ts` 7, `scripts/check-review-receipts.mjs` 6, `src/controller/calendar/resolveCalendars.ts` 5, `src/bases/ganttSyncCoordinator.ts` 4, `scripts/cross-model-peer-review.sh` 2, `src/datasource/calendarItems/externalCalendarSource.ts` **1** (0.2% — the audit's "large but stable" verdict, now measured).

The two-file concentration is the headline: `GanttContainer.svelte` and `register.ts` together appear in 116 of 477 commits — nearly a quarter of every commit ever made (44 commits touch both).

---

## Measurement 2 — separable concerns

Concern = a named responsibility with its own reason to change that could be owned elsewhere; a cohesive cluster that must change together counts once. Counts are enumerations — dispute any entry by its evidence.

### `src/bases/GanttContainer.svelte` — 30 concerns (4,176 lines: 2,527 script / 280 markup / 1,369 style; 59 imports)

Script: theme resolution + flip reseed (`handleThemeModeChange`, 311–375) · diff-sync coordination (`syncToGantt` + plan/apply helpers, 810–1282) · echo suppression (`OG_ECHO_SOURCE` + `syncing`, 630/958/2282–2289) · ephemeral column sort (`sort-tasks` intercept + reassert/restore, 1835–1858, 1164–1220) · collapse/expand state (`collapsedIds`, 872, 1869–1882) · row-visibility display filters (`applyDisplayFilters`, 996–1039) · TaskNotes click-activation routing (capture listeners + `show-editor`/`select-task`, 700–796, 1907–1987) · drag/resize commit + cascade execution (`handleUserBarGesture` family, 2165–2323) · dependency authoring (`add-link`/`delete-link`, 2053–2105) · derived-geometry refusal policy (`rowHasDerivedGeometry`, 2348–2355) · inline cell editing (editor kinds → commit bridge, 1561–1654, 2325–2424) · grid column building + width persistence (`buildSvarColumns`, 1529–1700, 1717–1739) · divider-width persistence + re-assert (1748–1798) · viewport height auto-fit (1337–1377) · maximize (1388–1476, 2796–2806) · marker overlay (404–460) · legend (471–542) · toolbar wiring (461–466) · injected dynamic stylesheets (640–689) · notice banners (800–808, 2588–2648) · weekend/calendar cell classing (857–861) · focus-on-task (2434–2510) · zoom config + floating controls (2429–2447, 2741–2758) · task-type registration (920–943) · tooltip hover capability (1311–1324) · initial-scroll fix (2107–2129) · lifecycle/generation tracking (1326–1335) · grid-cell context provisioning (305, 866, 1605). Style: zigzag/occupancy visual system (3254–3977) · SVAR icon-font replacement (3074–3252, 3979–4075).

Structure facts: `initGantt` is 327 lines (1804–2130) holding 9 intercept call sites / 14 action registrations that close over **at least nine** outer mutable dependencies — the handlers write `ephemeralSort`, `pendingSingleClick`, and `collapsedIds`; they read `syncing`, `pointerButtonDown`, and `lastCtrlMeta` (the latter two written by the outer capture listeners at 704/710/731); `initGantt`'s own body bumps `hostGeneration` and assigns the mutable outer `api` (declared 1309, assigned 1807, read 1958); and the handlers also read `suppressSelectActivation` (declared 1499, read 1947, written by focus-on-task at 2497/2501) and `lastPieceActivation`, plus the `dbgInitCount` counter. This is the measured extraction trap the slice-2 plan carries: every intercept is a closure over component-scope mutable state, mixing reads and writes across the component boundary — and the slice-2 plan must re-enumerate this dependency set at planning time rather than trust any fixed name list, since this measurement has already grown twice under review. The two style concerns (~1,000 of 1,369 style lines) have zero script coupling.

### `src/bases/register.ts` — 14 concerns (1,872 lines, 6 exports)

Bases view registration + options panel (~1802–1872) · view-contract lifecycle (~409–561, 1739–1782) · refresh-storm governance, #161 (~480–519, 623–655, 1205–1237) · mount orchestration + controller DI assembly (`mountGantt`, ~1055–1425) · render-data assembly (`buildGanttData`, ~1428–1620) · ~20 per-view option readers (~792–1040) · field-mapping resolution raw-vs-effective (~743–790) · date-policy + estimate-meaning wiring (~798–833) · grid columns/cells/width persistence (~665–730, 1443–1514) · calendar shading + associations + picker (~839–973, 1632–1719) · liveness watches (~1075–1094, 1243–1251) · external-calendar feed state (~249–273, 590–621) · per-view command registries + source switcher (~217–242, 923–941) · TaskNotes interaction delegation (~1253, 1332–1337).

### `src/controller/GanttController.ts` — 14 concerns (2,431 lines)

Source selection + memoization (1177–1339) · field-mapping/write-target resolution — including an ~80-line mapping block living *inside* `selectSource` (1206–1272), the clearest extract candidate · mutation API (929–1142) · echo-suppression correlation lifecycle (1145–1163, 1483–1492) · recompute orchestration (1536–1602) · snapshot build pipeline (`buildSnapshot`, 1615–1750) · enrichment caching (504–531, 1645–1652) · companion expansion + readiness (1662–1703) · date-policy read pass (1839–1925) · write-path derivation authority (1938–2112) · calendar-item union (1757–1827) · snapshot value-equality (2286–2431) · facade/query surface + listener lifecycle (794–913, 1418–1515) · #161 debug instrumentation, removable as a unit (1620–1624, 1704–1743).

### `src/bases/ganttSync.ts` — 8 concerns (1,032 lines, 25 exports)

SVAR task shaping (130–541) · task-type registry composition (605–670) · task state fingerprinting (673–779) · task/link diff planning (804–928, 973–984) · sibling reorder planning (868–888) · executor echo patching (543–586) · Base sort descriptor (930–958) · bulk-reseed policy (986–1032). Correction to carry: PR #418 moved the composed diff into `src/bases/ganttSyncCoordinator.ts`, not out of this file — ganttSync.ts remains the dependency-free primitive layer, and its 8 concerns are one coherent domain (SVAR projection). Splitting it would be line-count-driven; principle 7's stopping rule says leave it.

### `src/bases/types/gantt-view-data.ts` — 3 concerns (323 lines)

`GanttData` render contract (63–323) · legend input contract (35–61) · write-path derivation callbacks riding the display-data interface (134–165, 258) — a distinct reason to change (write semantics vs render data) hosted on a display contract.

### `src/bases/services/BasesDataAdapter.ts` — 6 concerns (675 lines)

Bases view/group access (212–253) · Value unwrapping (392–432) · raw property extraction routing (360–384) · scalar conversion (442–499) · Gantt field extraction (508–674) · **display formatting — the adapters-extract/views-format violation, confirmed at line level:** `convertGroupKeyToString` (274–302) formats dates/booleans/arrays into display strings, `extractPropertyValue` (596–620) is documented "for display in grid columns", and `formatDateYmd` (62–67) is a pure formatter living in the adapter.

### Test companions

- `test/unit/ganttSync.test.ts` (1,420 lines) — healthy companion; 15 top-level suites, each a separable concern named by its describe with its line anchor: `resolveDateStatusStateToken` (109) · `isNonAuthoredEdgeToken` (119) · `hasNonAuthoredEdgeInstance` (130) · `buildSvarTasks` (140, plus grid-property-values 1019 and row-editability 1035 sub-suites) · `buildTreatmentTaskTypes` (498) · instance cues (638) · `planTaskSync` (930) · `taskStateKey` (1072) · `planLinkSync` (1139) · `planReorder` (1157) · `baseSortDescriptor` (1188) · `shouldBulkReseed` (1235) · `echoTaskPatch` (1314). It would split cleanly along whatever lines its subject splits.
- `test/unit/GanttController.test.ts` (2,461 lines) — 23 describes mirroring the controller's own concern list ~1:1 (source selection 173 · managed paths 204 · choice options 227 · reactive re-selection 255 · recompute race guard 300 · recomputeGeneration 335 · getInstances expansion 489 · gated debug log 526 · getLinks 566 · capabilities 643 · onChange + idempotent backstop 664 · date policy + stable instance set 810 · composite strategy 1271 · status colors 1439 · priority colors 1476 · companion expansion 1521 · settings freshness 1661 · memoization + dependency batching 1708 · readiness re-check 1944 · resultset-change burst 2176 · safe-partial interleave 2276 · `computeRecomputeReason` 2405 · `buildSourceLinks` 2432). Its size is the controller's symptom; one shared `FakeSource` fixture any controller split drags into a shared test util. The last two suites test exported free functions and are separable today.
- `test/specs/gantt-calendar-editor.e2e.ts` (1,606 lines, 40 tests in one describe) — NOT a single-subject companion: four separable suites (view routing/healing 163–343, form editing/validation 345–535, dirty-state/external-edit races 712–1050, set preview/conflict UI 1193–1587) sharing one serially-mutated fixture vault — ordering coupling a split must untangle, plus repeated `browser.execute` probe blocks wanting helper extraction first.

### Remaining defect-targeted files (per the concern-cutoff decision)

- `src/bases/entrySignature.ts` — 262 lines, 4 concerns: per-entry value signatures (`entryValueSignature` 55, `frontmatterSignatureKeys` 81) · the watched-mapping slice (`watchedMappingValues` 104, `mappingSignatureTag` 145 — the defect site: `textProperty` absent) · entry composition + note-cache contract (`composeEntrySignature` 205, `EntryNoteCache` 153) · set-level signature (`entriesSignature` 252). Cohesive; the defect is an omission inside concern 2, not a decomposition target.
- `src/controller/calendar/resolveCalendars.ts` — 258 lines, 4 concerns: registry build (`buildCalendarRegistry` 58 — the defect site: plain-calendar diagnostics unpromoted) · task-association resolution (`resolveTaskCalendar` 144) · link normalization (`stripSubpath` 212) · blocking-source projection (`datedBlockingSource` 232). Cohesive; the ranked fix must extract because two of these functions sit at complexity 15/13.
- `src/controller/calendar/schema.ts` — 386 lines, 4 concerns: definition types (9–70) · note parsing (`matchesCalendarMarker` 79, `parseCalendar` 97, `parseCalendarSet` 167 — the COLOR defect site at 113/185) · field readers with diagnostics (`readPattern` 191 through `readDatedEntry` 306) · date/span helpers (339–386). Cohesive.
- `scripts/check-review-receipts.mjs` — 291 lines, 5 concerns: git/receipt-store plumbing (59–90) · pushed-ref parsing (`parsePushedRefLines` 91) · receipt evaluation (`evaluateReceipts` 113, `acknowledgedFindings` 172) · recording (`record` 129) · CLI check/report shell (233–276). Ranked as part of the gate cluster.
- `tsconfig.json` — 26-line config file; concern enumeration is not applicable to it — its defect is an absence (`test/` outside `include`), and the measurement is the false-green instance count carried on ranked entry 3.

### `scripts/cross-model-peer-review.sh` — 10 concerns (490 lines today; companion `check-review-receipts.mjs` 291, enumerated above)

Arg parsing (36–47) · preflight (49–50) · git anti-tamper primitives (`git_nr` 55, `sha256_of` 62–67, `worktree_changes` 69–77) · remote/upstream resolution (`tracking_remote` 83–95, `base_ref` 103–124, `refresh_upstream` 126–184, `default_base` 190–204 — the densest, most defect-history-laden cluster) · pre-review state guards (209–268) · diff production + content guards (272–306, 374–378) · sentinel/canary anti-spoof (308–324, 394–401) · reviewer prompt (326–367) · invocation + verdict parsing (380–416) · record-time re-validation + receipts delegation (418–489). **Honest correction:** the backlog measured 763 lines / 44 refusal points at an older commit; today it is 490 lines, 21 distinct exit codes, ~39 refusal sites — already shrunk ~36%, so the backlog's deletion proposal starts from a smaller base than it recorded.

---

## Measurement 3 — complexity-gate pressure

69 functions sit in the 11–15 band (threshold-10 sweep; zero suppressions, so nothing can exceed 15 on main). ESLint locates each finding by `file:line` (the function is the one whose body starts at that location; the rule's message does not carry names). The full measured set, highest pressure first — the 16 **at exactly 15** are where any complexity-*increasing* edit trips the hard gate (a neutral or reducing edit still passes; the pressure is that there is zero headroom for the ordinary fix shape of adding a branch):

| Function location | Complexity |
|---|---|
| `src/bases/GanttContainer.svelte:2450` | 15 |
| `src/bases/calendarSelection.ts:215` | 15 |
| `src/bases/dragCascadeLane.ts:286` | 15 |
| `src/bases/ganttSync.ts:340` | 15 |
| `src/bases/ganttSync.ts:419` | 15 |
| `src/controller/calendar/resolveCalendars.ts:58` | 15 |
| `src/controller/calendar/stretch.ts:49` | 15 |
| `src/datasource/calendarItems/externalCalendarSource.ts:663` | 15 |
| `test/__mocks__/obsidian.ts:375` | 15 |
| `test/specs/gantt-calendar-items-external.e2e.ts:134` | 15 |
| `test/specs/gantt-calendar-items-recurring.e2e.ts:179` | 15 |
| `test/specs/gantt-calendar-items-sources.e2e.ts:148` | 15 |
| `test/specs/gantt-perf-fullstack.perf.e2e.ts:131` | 15 |
| `test/specs/gantt-resultset-loop.e2e.ts:134` | 15 |
| `test/specs/gantt-resultset-storm.perf.e2e.ts:67` | 15 |
| `test/unit/calendarItemSources.test.ts:98` | 15 |
| `scripts/releaseFiles.mjs:207` | 14 |
| `src/bases/calendarItemSources.ts:377` | 14 |
| `src/bases/fileFilter.ts:51` | 14 |
| `src/controller/GanttController.ts:1536` | 14 |
| `src/datasource/calendarItems/externalCalendarSource.ts:507` | 14 |
| `src/editor/workingPatternModel.ts:50` | 14 |
| `scripts/update-release-index.mjs:28` | 13 |
| `src/bases/checklistProgress.ts:40` | 13 |
| `src/bases/dragCascadeLane.ts:422` | 13 |
| `src/bases/dragCommitPlan.ts:281` | 13 |
| `src/controller/GanttController.ts:1615` | 13 |
| `src/controller/GanttController.ts:1757` | 13 |
| `src/controller/calendar/resolveCalendars.ts:144` | 13 |
| `src/datasource/TaskNotesSource.ts:1128` | 13 |
| `src/datasource/calendarItems/externalCalendarSource.ts:244` | 13 |
| `test/perf/generator/generate.ts:93` | 13 |
| `test/perf/generator/graph.ts:174` | 13 |
| `test/specs/gantt-inferred-drag-write.e2e.ts:238` | 13 |
| `src/bases/GanttContainer.svelte:1939` | 12 |
| `src/bases/calendarShading.ts:219` | 12 |
| `src/bases/cellEditCommit.ts:211` | 12 |
| `src/bases/dragCommitPlanner.ts:166` | 12 |
| `src/bases/services/BasesDataAdapter.ts:98` | 12 |
| `src/bases/services/BasesDataAdapter.ts:274` | 12 |
| `src/bases/services/BasesDataAdapter.ts:468` | 12 |
| `src/controller/GanttController.ts:979` | 12 |
| `src/datasource/parentLink.ts:21` | 12 |
| `src/editor/calendarEditorState.ts:109` | 12 |
| `src/editor/calendarEditorState.ts:142` | 12 |
| `src/editor/weekPreviewLayout.ts:230` | 12 |
| `test/perf/generator/emitVault.ts:72` | 12 |
| `test/probe/svar-features.probe.ts:46` | 12 |
| `src/bases/GanttContainer.svelte:1612` | 11 |
| `src/bases/GanttContainer.svelte:2008` | 11 |
| `src/bases/barTreatment.ts:359` | 11 |
| `src/bases/calendarConflicts.ts:156` | 11 |
| `src/bases/ganttSync.ts:804` | 11 |
| `src/bases/legendCatalog.ts:290` | 11 |
| `src/bases/propertyValues.ts:184` | 11 |
| `src/bases/retainedAncestorNotice.ts:84` | 11 |
| `src/controller/calendar/workingDays.ts:52` | 11 |
| `src/controller/sortKeyMapping.ts:75` | 11 |
| `src/datasource/BasesSource.ts:174` | 11 |
| `src/datasource/TaskNotesSource.ts:584` | 11 |
| `src/datasource/TaskNotesSource.ts:723` | 11 |
| `src/datasource/calendarItems/externalCalendarSource.ts:970` | 11 |
| `src/datasource/calendarItems/recurringSource.ts:322` | 11 |
| `test/perf/generator/generate.test.ts:120` | 11 |
| `test/specs/gantt-calendar-items-external.e2e.ts:180` | 11 |
| `test/specs/gantt-calendar-items-sources.e2e.ts:194` | 11 |
| `test/unit/calendarRfcRoundTrip.test.ts:38` | 11 |
| `test/unit/dragCommitPlanner.test.ts:447` | 11 |
| `test/unit/dragCommitPlanner.test.ts:484` | 11 |

Concentrations worth naming: `ganttSync.ts` carries two at-ceiling functions plus one at 11; `externalCalendarSource.ts` carries 15/14/13/11 (stable file, but the day someone edits it, the gate bites immediately); `resolveCalendars.ts` (15 + 13) is also a ranked defect target below, so its fix will collide with the ceiling.

---

## Backlog verification (fold-in, verify-first)

Checked against live code before ranking; entries reference their backlog headings rather than restating them.

| Backlog entry | Verdict at `7949fd1` |
|---|---|
| BasesDataAdapter still display-formats | **Live** — line refs above |
| Label-only edits invisible to entry signature | **Live** — `textProperty` appears nowhere in `src/bases/entrySignature.ts` |
| Test code is never typechecked | **Live** — `tsconfig.json` includes only `src` and `**/*.svelte` |
| Per-calendar diagnostics recorded but never surfaced | **Live, refined** — `resolveCalendars.ts:82` promotes diagnostics for calendar *sets*; plain calendars (`:69`) store `definition.diagnostics` unpromoted |
| Calendar colour accepts values RFC 7986 COLOR does not permit | **Live, half resolved** — `schema.ts:113/:185` still read `color` as any string, but the deviation is already documented as tracked in `docs/architecture/calendar-rfc-mapping.md:11`; only the constrain-to-CSS3-names decision remains open |
| Peer-review gate ~7× oversized | **Stale numbers, live substance** — 490 lines today (was 763); 21 exit codes; deletion proposal stands from a smaller base |
| Peer-wrapper guards without tests; receipts not bound to reviewed range; review reads live worktree | **Carried as recorded** — wrapper/receipts files exist as described; no contrary evidence found |
| Mechanical churn/concern CI gate | **Parked, trigger not fired** — this report is the manual re-measure the strategy names; not proposed here |

Honest negative: no queued maintainability entry was found obsoleted outright; the only correction is the peer-gate size.

---

## The ranked defect list

Rank = measured maintenance pain. Each entry carries its numbers; dispute by re-measuring.

1. **`src/bases/GanttContainer.svelte`** — 18.7% churn × 30 concerns × 4 functions in the pressure band × the `initGantt` weld (5 concerns' handlers closed over at least nine outer mutable dependencies — the Measurement 2 inventory). Nearly every fifth commit ever made navigates this file; the maintainer's "few lines of CSS = 4 hours" incident lives in its 1,369-line style block. Pain is compounding: each new feature adds a concern, and each concern multiplies the reading cost of the next change. Next slices are already sequenced — interceptors (slice 2, fresh plan next session, seven-bindings trap carried), then the style block (~1,000 separable CSS lines with zero script coupling), then diff-sync coordination.
2. **`src/bases/register.ts`** — 14.9% churn × 14 concerns in 1,872 lines. The junction box every view-level feature passes through: mount orchestration (~370 lines) and `buildGanttData` (~190 lines) are the welds; the ~20 option readers and the calendar/picker cluster are clean extract candidates. Second because its churn is nearly GanttContainer's with half the concern count.
3. **Test tree is never typechecked** — tooling defect with a proven false-green: four committed tests called a function with the wrong arity and stayed green (backlog: "Test code is never typechecked"). No churn or concern metric applies — the defect is a configuration absence (`tsconfig.json` includes only `src` and `**/*.svelte`); the measurement is the false-green instance count. Pain class: silent assertion rot across 160+ suites — every suite the campaign will lean on while refactoring ranks 1–2. Its own pass, sized by the unknown number of latent arity/shape drifts it will surface.
4. **`src/controller/GanttController.ts`** — 7.3% churn × 14 concerns × 4 functions at 12–14. Tension with the 2026-08-10 audit's "controller sound" verdict, resolved by scope: the audit judged layering/correctness, this report judges decomposition pressure — both hold. Clearest first slice: the ~80-line mapping-resolution block inside `selectSource` (1206–1272), then the removable #161 debug instrumentation.
5. **`src/bases/services/BasesDataAdapter.ts` display formatting** — 2.5% churn, 6 concerns, 3 functions at 12, and the repo's clearest named boundary violation (adapters extract, views format). Extract-and-test: move `convertGroupKeyToString`'s formatting, `extractPropertyValue`'s display path, and `formatDateYmd` to the view layer.
6. **`test/specs/gantt-calendar-editor.e2e.ts`** — 5.0% churn (highest of any spec), 1,606 lines, four separable suites serially mutating one fixture vault. Pain: ordering coupling makes every addition risk the 40 tests before it. (The backlog's measured flake instances name other specs — `gantt-calendar-items-sources` and `gantt-dependency-types` — so flake is not part of this rank's argument.) Helper extraction first, then a four-way split.
7. **The peer-review gate cluster** — `cross-model-peer-review.sh` (490 lines, 21 exit codes, ~39 refusal sites) + `check-review-receipts.mjs` (291) + three linked backlog defects (untested guards, receipts not range-bound, worktree-not-commit reads). The backlog's own analysis stands: defect density concentrates in the distributed-git cluster that defends threats a solo-maintainer repo does not have; the deletion proposal (keep accident guards, ~100-line target) is deliberately unscheduled but ranked here because every campaign PR pays this gate's complexity twice per push.
8. **`src/bases/entrySignature.ts` textProperty gap** — 1.9% churn, point defect, user-visible: rename a task via its mapped title property and the bar label stays stale until an unrelated refresh. Ranked above bigger items on pain-per-fix — the fix shape is one watched-mapping addition plus tests. Classification note: this and rank 9 are backlog-queued coupling/boundary defects whose *fixes* change behavior — they are not from the excluded preserved-behavior list, and each fix is its own test-first unit per that list's rule.
9. **Per-calendar diagnostics never surfaced** — `resolveCalendars.ts` (two functions at 15/13 — an inline fix that adds any branch trips the gate, so extraction is the practical fix shape). Fail-visible contract gap: a calendar with `timezone: Mars/Phobos` stays silently valid. Same classification note as rank 8.
10. **`src/bases/types/gantt-view-data.ts` write-callbacks on the display contract** — 6.3% churn on a 323-line types file is the signal: the contract changes with almost every feature because write-path plumbing rides it. Fold into whichever of ranks 1–2's slices touches the seam; not its own unit.
11. **RFC 7986 COLOR deviation** — tiny, decision-shaped, and half done: the deviation is already recorded as tracked in `docs/architecture/calendar-rfc-mapping.md:11` (`schema.ts:113/:185` read any string; 3 commits / 0.6% churn). The tracked deviation is interim by construction — principle 6 permits no permanently lossy store, so the open decision is the conformance *mechanism* (constrain input to CSS3 names, or another mapping that restores §5.9 conformance without rewriting stored values, which principle 6 also forbids), not whether to conform. Until it lands, the mapping row is not a lossless proof — its own text says so.

## Not debt — verified endpoints

- `src/datasource/calendarItems/externalCalendarSource.ts` — 1,109 lines, **1 commit (0.2% churn)**: the audit's "large but stable, correctly factored" verdict, now measured. Its four pressure-band functions bite only if it starts churning.
- `src/controller/calendar/rfcMapping.ts` — RETAIN per the audit: executable RFC proof.
- `src/bases/ganttSync.ts` — 8 concerns, one coherent projection domain; two at-ceiling functions are watch-signals, not split-triggers. Decomposing further would optimize line count over cohesion (principle 7's stopping rule).
- `src/bases/ganttSyncCoordinator.ts` — the #418 extraction landed; 4 commits since, no pressure.

## Baseline

This report is time-zero for the campaign's trend reporting. Full-history churn share is the wrong trend instrument — an extraction commit *touches* the file it shrinks, so the share ticks up on every slice, and a newly extracted module is diluted by the 477 commits that predate it. The trend metrics, re-measured at each campaign session's end, are therefore:

- **Windowed churn share** — commits since this baseline only, counted in one pass over the window's own log so every path touched inside the window is included (also files created and later deleted within it, which no endpoint tree holds). Semantics stated, not hidden: counts are per *path* with no rename chaining — a rename commit touches both its old and its new path, one touch each. Share = touches / window commits:

  ```bash
  range=7949fd1135ed32017cb72aafdb92c4f09caf8267..HEAD
  win=$(git rev-list --count $range)
  git log --format= --name-only $range -- src test scripts |
  awk -v w="$win" 'NF {c[$0]++} END {for (f in c) printf "%d %.1f%% %s\n", c[f], c[f]*100/w, f}' |
  sort -rn
  ```

  The trend question: does new churn share concentrate in owned extracted modules rather than the top-two junction files?
- **Enumerated concern counts** — 30 (`GanttContainer.svelte`) / 14 (`register.ts`) / 14 (`GanttController.ts`); these fall only when a slice genuinely moves a concern out.
- **At-ceiling function count** — 16 at complexity 15.

The full-history shares (18.7% / 14.9%) remain the baseline record, not the trend signal. The strategy's maintainability metric ("measured manually today at each re-measure") reads from here.
