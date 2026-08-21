# Legend reliability diagnosis — fixed window did not reproduce the target symptoms

**Date:** 2026-08-22
**Measured at:** `27d0c711ef3450394ed1b6a97b7305ded355bbd2` (U1 squash merge, PR #446)
**Commission:** U2 of [the Legend diagnosis plan](../plans/2026-08-20-0752-chore-reliability-legend-diagnosis-plan.md), following the ranked defect record in [the reliability re-diagnosis](2026-08-19-001-reliability-rediagnosis.md)

The pre-registered two-by-24 window produced no recurrence of any of the three target `gantt-legend.e2e.ts` symptoms. Each symptom therefore remains **open**: this bounded opportunity supplies passing controls, but no failure trace from which to distinguish a weak e2e gate/proxy, class (b), from product nondeterminism, class (d). No fix is commissioned by this report.

All 48 requested legs were valid and none was excluded. Seven executions failed because of three non-target specs; those failures are retained in the product denominator and enumerated below. The target spec passed all 28 of its tests in every leg: 1,344 passed, 0 failed, 0 skipped.

---

## Method and immutable window

This report applies the fixed-window and attempt rules in [the self-referential measurement-report convention](../solutions/conventions/window-cutoff-pattern-self-referential-measurement-reports.md):

- exactly two sequential dispatches, each requesting 24 legs;
- each returned run URL/ID was bound and verified before the next dispatch;
- attempt 1 only, with no rerun, replacement, or top-up;
- both dispatches measured the same full U1 merge SHA;
- the downloaded artifacts entered fresh directories and the U1 aggregation script ran exactly once;
- the measurement cutoff is dispatch 2, run `32483108735`, attempt 1. Later CI for this report is outside the fixed window and belongs only to trend metrics.

The exact dispatch command was run twice:

```powershell
gh workflow run e2e-repeat.yml --repo renatomen/tasknotes-gantt --ref main -f sha=27d0c711ef3450394ed1b6a97b7305ded355bbd2 -f executions=24
```

Identity receipts, recorded around each command at GitHub's whole-second `created_at` precision:

| Dispatch | Pre-command repeat-run IDs | UTC cutoff | Command returned | Bound run | `created_at` | Attempt |
|---|---|---|---|---|---|---|
| 1 | `32194797116`, `32193474859` | `2026-08-21T12:28:44Z` | `2026-08-21T12:28:46.4549272Z` | [32482076419](https://github.com/renatomen/tasknotes-gantt/actions/runs/32482076419) | `2026-08-21T12:28:47Z` | 1 |
| 2 | `32482076419`, `32194797116`, `32193474859` | `2026-08-21T12:41:43Z` | `2026-08-21T12:41:45.4064956Z` | [32483108735](https://github.com/renatomen/tasknotes-gantt/actions/runs/32483108735) | `2026-08-21T12:41:46Z` | 1 |

Each returned ID was absent from its pre-command inventory. Both exact runs reported `workflow_dispatch`, workflow id `336807410`, workflow path `.github/workflows/e2e-repeat.yml`, input `executions=24`, input `sha=27d0c711ef3450394ed1b6a97b7305ded355bbd2`, and `run_attempt=1`. Dispatch 1 completed at `2026-08-21T12:40:24Z`; dispatch 2 completed at `2026-08-21T12:55:02Z`.

Each dispatch contained one successful setup job and 24 e2e jobs, plus exactly 24 non-expired artifacts named for legs 1–24. The artifacts were downloaded into fresh directories under `C:\Users\renat\AppData\Local\Temp\tasknotes-gantt-u2-20260821T122842Z`. The one and only aggregation invocation was:

```powershell
node scripts/aggregate-e2e-results.mjs 'C:\Users\renat\AppData\Local\Temp\tasknotes-gantt-u2-20260821T122842Z\run-32482076419' 24 'C:\Users\renat\AppData\Local\Temp\tasknotes-gantt-u2-20260821T122842Z\run-32483108735' 24
```

The aggregate reported 48 valid legs and 0 exclusions. Job logs were then read without changing the aggregate through:

```powershell
gh api --allow-escape-sequences repos/renatomen/tasknotes-gantt/actions/jobs/<job-id>/logs
```

The API log endpoint is material here: it preserves the complete single-line `[OG-LIFECYCLE]` terminal payload that a rendered or size-limited console view may elide.

## SHA, workflow, and runtime receipts

Every leg's log recorded both `HEAD is now at 27d0c71` and the reusable workflow resolution:

```text
Uses: renatomen/tasknotes-gantt/.github/workflows/e2e.yml@refs/heads/main (27d0c711ef3450394ed1b6a97b7305ded355bbd2)
```

All 48 legs had one runtime fingerprint:

| Dimension | Resolved value | Receipt |
|---|---|---|
| Runner | GitHub Actions runner `2.336.0`; provisioner `20260729.566` | every job log |
| Platform | Microsoft Windows Server 2025 `10.0.26100` Datacenter; x64 | every job log; Node and Electron driver paths resolve `x64` / `win32-x64` |
| Runner image | `windows-2025-vs2026`, image version `20260818.207.1` | every job log |
| Node | `22.23.2` x64 | every job log's tool-cache receipt |
| Obsidian installer | `1.5.8` | every job log |
| Obsidian app | `1.13.7` | every job log |
| Electron | `28.2.3` | every job log |
| Chromium / ChromeDriver | `120.0.6099.283` | every job log and every reporter capability |
| Reporter platform | `windows` | every merged reporter capability |
| TaskNotes | `4.11.0` | the measured SHA's pinned `test/wdio/wdio.conf.mts` plugin entry; TaskNotes readiness was exercised by the suite |

No causal comparison crosses a SHA, workflow version, runtime fingerprint, action attempt, or dispatch attempt.

## Target verdicts

| Historical symptom | Fixed-window result | Verdict | Reason |
|---|---|---|---|
| `.og-legend-toggle` never interactable | 0 / 48 legs | **Open** | No recurrence. All 48 traces recorded 28 Legend handler deliveries, 28 rendered-open events, and zero WDIO click failures per leg. Passing controls alone cannot distinguish class (b) from class (d). |
| `Gantt did not maximize for the overlay scenarios` | 0 / 48 legs | **Open** | No recurrence. Every trace recorded the owning-mount/controller spine and 17 maximize handler deliveries with the requested rendered state. There is no failure trace to pair with a control. |
| AE4/AE5 `scaleLabel` changes from `2` to `3` across `openLegend()` | 0 / 48 legs | **Open** | No recurrence. The logical and rendered scale label was `3` at both the baseline and immediate post-open checkpoint in every leg, on the same mount and SVAR generation. A stable `3→3` is a pass; it is not evidence about the historical `2→3` cause. |

This is the plan's pre-registered stopping condition: 48 opportunities without a recurrence remain open. Buying more legs would change the measurement after seeing its outcome.

## Legend trace reconciliation

This section and § Complete leg accounting are the durable normalized trace ledger. They preserve every per-leg field needed to audit the three open verdicts after the Actions logs expire: original and diagnostic outcomes, bounded-trace completeness, target handler/click delivery, AE4/AE5 settlement and label identity, reporter outcome, WDIO exit ownership, and the two deviations from the common checkpoint state. The full 500/502-record passing payloads are not copied wholesale: no target recurrence produced a causal failure trace, so there is no failure/control pair whose full event sequence could support a class-(b) or class-(d) verdict.

Every `gantt-legend.e2e.ts` reporter session recorded `passed=28`, `failed=0`, `skipped=0`. The normalized extract from every raw terminal payload records:

- `origin="suite-after"`, `originalOutcome="passed"`, and `diagnosticOutcome="captured"`;
- trace capacity 512, `collectorFailure=false`, `overflow=false`, and a contiguous `nextSequence` one greater than the stored record count;
- 500 or 502 records, with `nextSequence` equal to the stored record count plus one;
- 17 owning-mount maximize handler deliveries and 28 Legend handler deliveries;
- 58 WDIO click-attempt records and zero WDIO click failures;
- the AE4 expected-state and after-open checkpoints on the same mount token and SVAR generation, with source generation 3 and delivered generation 3;
- logical and rendered label `3` before open and `3` after open.

In 46 legs, `pendingViewportSourceCount=0` and `viewportObservationPending=false` at the baseline. Two legs whose Legend sessions passed—dispatch 1 leg 22 and dispatch 2 leg 1—had source count 0 and matching generation 3/delivery 3 but `viewportObservationPending=true` at the baseline; both were false immediately after open, and both retained logical/rendered `3→3`. Had the historical scale-label failure occurred there, the plan would have forbidden a class-(d) verdict because pre-open terminal settlement was incomplete. It did not occur, so these are passing but non-distinguishing Legend observations and do not alter the open verdict.

There are no target failure traces and therefore no matched target failure/control pairs to embed. The plan's complete causal-trace requirement cannot be satisfied by substituting raw passing payloads for the missing failures: those payloads are controls, not evidence that distinguishes the historical cause. The decision-relevant facts from every bounded passing trace are preserved above and per leg below; a non-open verdict is unavailable by construction.

## Complete leg accounting

`Reporter red` names every reporter-red spec in the leg. `Raw tail` is the WDIO `Spec Files` summary and exit. `Legend` abbreviates `28 passed / 0 failed / 0 skipped; original passed; diagnostic captured; complete trace`. `AE4/AE5` is logical/rendered label before→after; `pending→settled` marks the two observation-pending baselines described above.

| Dispatch / leg | Job id | Reporter red | Raw tail | Trace records | Legend | AE4/AE5 |
|---|---:|---|---|---:|---|---|
| 1 / 1 | `96770456910` | `gantt-calendar-items-sources` | 38/39; exit 1 | 502 | pass/captured/complete | `3→3`, settled |
| 1 / 2 | `96770456833` | — | 39/39; exit 0 | 502 | pass/captured/complete | `3→3`, settled |
| 1 / 3 | `96770456900` | — | 39/39; exit 0 | 502 | pass/captured/complete | `3→3`, settled |
| 1 / 4 | `96770456933` | — | 39/39; exit 0 | 502 | pass/captured/complete | `3→3`, settled |
| 1 / 5 | `96770457139` | — | 39/39; exit 0 | 502 | pass/captured/complete | `3→3`, settled |
| 1 / 6 | `96770456593` | — | 39/39; exit 0 | 502 | pass/captured/complete | `3→3`, settled |
| 1 / 7 | `96770456847` | — | 39/39; exit 0 | 502 | pass/captured/complete | `3→3`, settled |
| 1 / 8 | `96770457004` | — | 39/39; exit 0 | 500 | pass/captured/complete | `3→3`, settled |
| 1 / 9 | `96770456651` | — | 39/39; exit 0 | 502 | pass/captured/complete | `3→3`, settled |
| 1 / 10 | `96770456689` | — | 39/39; exit 0 | 502 | pass/captured/complete | `3→3`, settled |
| 1 / 11 | `96770456999` | — | 39/39; exit 0 | 502 | pass/captured/complete | `3→3`, settled |
| 1 / 12 | `96770456977` | — | 39/39; exit 0 | 502 | pass/captured/complete | `3→3`, settled |
| 1 / 13 | `96770456903` | — | 39/39; exit 0 | 502 | pass/captured/complete | `3→3`, settled |
| 1 / 14 | `96770456973` | — | 39/39; exit 0 | 500 | pass/captured/complete | `3→3`, settled |
| 1 / 15 | `96770457029` | — | 39/39; exit 0 | 502 | pass/captured/complete | `3→3`, settled |
| 1 / 16 | `96770457053` | — | 39/39; exit 0 | 500 | pass/captured/complete | `3→3`, settled |
| 1 / 17 | `96770456804` | — | 39/39; exit 0 | 502 | pass/captured/complete | `3→3`, settled |
| 1 / 18 | `96770456849` | — | 39/39; exit 0 | 502 | pass/captured/complete | `3→3`, settled |
| 1 / 19 | `96770456857` | — | 39/39; exit 0 | 502 | pass/captured/complete | `3→3`, settled |
| 1 / 20 | `96770456683` | — | 39/39; exit 0 | 502 | pass/captured/complete | `3→3`, settled |
| 1 / 21 | `96770456742` | — | 39/39; exit 0 | 502 | pass/captured/complete | `3→3`, settled |
| 1 / 22 | `96770456614` | — | 39/39; exit 0 | 500 | pass/captured/complete | `3→3`, pending→settled |
| 1 / 23 | `96770456877` | — | 39/39; exit 0 | 502 | pass/captured/complete | `3→3`, settled |
| 1 / 24 | `96770456596` | — | 39/39; exit 0 | 502 | pass/captured/complete | `3→3`, settled |
| 2 / 1 | `96773627386` | `gantt-calendar-items-sources`; `gantt-column-sort` | 37/39; exit 1 | 500 | pass/captured/complete | `3→3`, pending→settled |
| 2 / 2 | `96773627298` | — | 39/39; exit 0 | 502 | pass/captured/complete | `3→3`, settled |
| 2 / 3 | `96773627136` | `gantt-divergent-status-mapping` | 38/39; exit 1 | 502 | pass/captured/complete | `3→3`, settled |
| 2 / 4 | `96773627174` | — | 39/39; exit 0 | 502 | pass/captured/complete | `3→3`, settled |
| 2 / 5 | `96773627147` | — | 39/39; exit 0 | 502 | pass/captured/complete | `3→3`, settled |
| 2 / 6 | `96773627275` | — | 39/39; exit 0 | 502 | pass/captured/complete | `3→3`, settled |
| 2 / 7 | `96773627020` | — | 39/39; exit 0 | 502 | pass/captured/complete | `3→3`, settled |
| 2 / 8 | `96773627168` | — | 39/39; exit 0 | 502 | pass/captured/complete | `3→3`, settled |
| 2 / 9 | `96773627233` | — | 39/39; exit 0 | 500 | pass/captured/complete | `3→3`, settled |
| 2 / 10 | `96773627313` | — | 39/39; exit 0 | 502 | pass/captured/complete | `3→3`, settled |
| 2 / 11 | `96773627514` | — | 39/39; exit 0 | 502 | pass/captured/complete | `3→3`, settled |
| 2 / 12 | `96773626994` | — | 39/39; exit 0 | 502 | pass/captured/complete | `3→3`, settled |
| 2 / 13 | `96773627090` | — | 39/39; exit 0 | 502 | pass/captured/complete | `3→3`, settled |
| 2 / 14 | `96773627064` | — | 39/39; exit 0 | 502 | pass/captured/complete | `3→3`, settled |
| 2 / 15 | `96773627273` | `gantt-calendar-items-sources` | 38/39; exit 1 | 502 | pass/captured/complete | `3→3`, settled |
| 2 / 16 | `96773627293` | — | 39/39; exit 0 | 502 | pass/captured/complete | `3→3`, settled |
| 2 / 17 | `96773627155` | — | 39/39; exit 0 | 502 | pass/captured/complete | `3→3`, settled |
| 2 / 18 | `96773627032` | — | 39/39; exit 0 | 500 | pass/captured/complete | `3→3`, settled |
| 2 / 19 | `96773627291` | `gantt-calendar-items-sources` | 38/39; exit 1 | 502 | pass/captured/complete | `3→3`, settled |
| 2 / 20 | `96773627232` | — | 39/39; exit 0 | 502 | pass/captured/complete | `3→3`, settled |
| 2 / 21 | `96773627414` | `gantt-calendar-items-sources` | 38/39; exit 1 | 502 | pass/captured/complete | `3→3`, settled |
| 2 / 22 | `96773627014` | — | 39/39; exit 0 | 502 | pass/captured/complete | `3→3`, settled |
| 2 / 23 | `96773627091` | — | 39/39; exit 0 | 502 | pass/captured/complete | `3→3`, settled |
| 2 / 24 | `96773627408` | `gantt-calendar-items-sources` | 38/39; exit 1 | 500 | pass/captured/complete | `3→3`, settled |

Every reporter-red leg has a matching nonzero raw exit, and every reporter-green leg has a zero exit. There are no diagnostic-only corrections, green-reporter/nonzero-exit ambiguities, or infrastructure exclusions.

## Non-target product failures retained in the denominator

**Headline: 7 failing executions / 48 valid legs = 14.6%.** One execution failed two specs, so the seven red legs contain eight reporter-red spec sessions.

| Spec | Failures / 48 | Rate | Legs and symptom |
|---|---:|---:|---|
| `gantt-calendar-items-sources.e2e.ts` | 6 | 12.5% | dispatch 1 leg 1; dispatch 2 legs 1, 15, 19, 21, 24 — `before each` for “renders daily-note timeblocks…”: `not ready: Gantt bars missing: ["Standup 2026-03-23.md"]` |
| `gantt-column-sort.e2e.ts` | 1 | 2.1% | dispatch 2 leg 1 — “sorts matched + fetched rows…”: `Column header "note.due" did not become clickable` |
| `gantt-divergent-status-mapping.e2e.ts` | 1 | 2.1% | dispatch 2 leg 3 — “opens no editor on the divergently-mapped status cell”: expected `true`, received `false` |
| `gantt-legend.e2e.ts` | 0 | 0.0% | all 48 sessions passed 28/28 |

The other 35 specs each measured 0/48. These non-target failures are observations, not a mandate to expand U2: they neither correct nor exclude a leg, and this diagnosis unit changes no product, harness, timeout, retry, or workflow behavior.

## Conclusion and stopping rule

The fixed U2 window is valid and exhausted. It found no failure trace for the Legend toggle, maximize, or AE4/AE5 scale-label symptoms; all three remain open. A class-(b), class-(d), or single-cause fix would mark the evidence beyond what it says. U2 therefore ends with this report and no fix.
