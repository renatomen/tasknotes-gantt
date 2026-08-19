# Reliability Re-Diagnosis — the baseline flake rate and the ranked defect list

**Date:** 2026-08-19
**Measured at:** `a386c4a245ae3d60cc1ded152777e82f221d473a` (main) — the repeat-run baseline SHA; incident windows carry their own SHAs
**Commissions:** the reliability pillar per [STRATEGY.md](../../STRATEGY.md) § Software craftsmanship; shape precedent [2026-08-15-001-maintainability-rediagnosis.md](2026-08-15-001-maintainability-rediagnosis.md)

This report is the reliability campaign's Phase 0 deliverable and its measured baseline: a flake rate with an honest denominator ([CONCEPTS.md](../../CONCEPTS.md) § Honest denominator), the accumulated incident record folded in from `docs/backlogs/backlog.md`, and a ranked defect list worked top-down afterward. "Flake" throughout means nondeterministic, never "not a code defect" (CONCEPTS.md § Flake). Rank = measured failure frequency weighted by what the evidence says about cause class; any rank can be disputed by re-measuring.

The diagnosis's stopping rule: this report ends at the ranked list. Dimensions not measured here (the scheduled perf workflow's deterministic red, unit-test nondeterminism, local-environment flake, a scheduled repeat-run cadence) are out of scope by decision, not oversight — see § Not measured.

---

## Method

All numbers reproduce from these commands. The instruments are the repeat-run workflow (`.github/workflows/e2e-repeat.yml`), the reusable e2e workflow it calls (`.github/workflows/e2e.yml` — the identical definition the PR gate runs), the per-spec JSON reporter (`@wdio/json-reporter`, wired in `test/wdio/wdio.conf.mts`), and the aggregation script (`scripts/aggregate-e2e-results.mjs`).

**Committed-tooling divergence, argued.** The maintainability re-diagnosis added no committed tooling; this one commissions four pieces (the two workflows, the reporter wiring, the aggregation script — PRs #436, #439, #440, #441). The divergence is deliberate: STRATEGY.md makes establishing a true per-spec flake rate the re-diagnosis's first job, ordinary CI supplies only per-diff executions plus occasional demand-driven same-SHA reruns — never a controlled N-execution sample of one SHA — and the WDIO config previously emitted no machine-readable per-spec results — the rate is unmeasurable without instruments that persist.

**Repeat-run baseline** — N executions ("legs", CONCEPTS.md § Leg) of the full 39-spec suite against one pinned main SHA, in the environment where every recorded failure occurred (windows-latest, step-identical to the PR gate via the shared `e2e.yml`):

```bash
gh workflow run e2e-repeat.yml -f sha=a386c4a245ae3d60cc1ded152777e82f221d473a -f executions=12
gh run download <run-id> -D <download-dir>        # attempt 1 only — reruns mix artifact generations
node scripts/aggregate-e2e-results.mjs <download-dir> 12
```

Additional same-SHA dispatches pool into one denominator by appending `<dir2> <executions2>` pairs. The execution count per dispatch is mandatory: legs whose artifact never uploaded surface as `missing-artifact` exclusions instead of vanishing. The artifacts carry **no SHA receipt** — same-SHA provenance across pooled dispatches is the operator's contract, discharged by recording each pooled run id and its SHA in § Measurement 1 (see [docs/solutions/conventions/wdio-json-reporter-output-contract.md](../solutions/conventions/wdio-json-reporter-output-contract.md); the reporter's output contract is recorded there, not re-derived here).

**Leg validity** — a leg enters the product denominator only if its merged results file records exactly 39 distinct specs and every session ran at least one test; anything less is excluded with a named reason and reported beside the rate, never counted as a pass. The zero-test-session class (a worker that launched and ran nothing — the failure mode diagnosed on PR #437, `docs/solutions/test-failures/wdio-config-reimport-wipes-cross-session-state.md`) lands in exclusions, never in the numerator or denominator of the product rate.

**Merge-commit nuance.** The PR gate runs `refs/pull/N/merge` — a synthetic merge of the PR head into its base — while the repeat-run checks out the pinned SHA itself. A repeat-run against a PR head therefore measures the gate's tree only when the base has not advanced past the merge base (the merge result then has the head's tree); once the base moves, the gate tests a tree no head-SHA measurement reproduces. The baseline here sidesteps the nuance: its SHA is a main commit, dispatched directly, with no merge synthesis involved.

**Incident-window denominators** — `run_attempt` summed over every CI run in the window, from the API as source of record:

```bash
for id in <run-ids>; do gh api repos/renatomen/tasknotes-gantt/actions/runs/$id --jq .run_attempt; done
# denominator = sum; every figure below was re-derived this way at reporting time
```

**The six method requirements (binding, R11)** — adopted from the incident record's own correction history; later campaign sessions inherit them from here:

1. Enumerate every failing spec in a run before characterising any distribution.
2. Never read a passing same-SHA rerun as exonerating a code-changing diff.
3. Never infer "environmental" from an inert diff.
4. No harness-vs-src verdict without distinguishing evidence.
5. Reruns counted as evidence are counted in the denominator.
6. Recount from the source of record; never adjust a remembered number.

---

## Measurement 1 — the baseline repeat-run rate

Two dispatches pooled into one denominator (KTD4), both pinning the same SHA; provenance recorded per the operator contract, and spot-verified from a leg's checkout log (`HEAD is now at a386c4a`):

| Dispatch | Run id | SHA (pinned via `sha` input) | Legs | Attempt used |
|---|---|---|---|---|
| smoke (`executions=2`) | 32193474859 | `a386c4a245ae3d60cc1ded152777e82f221d473a` | 2 | 1 |
| baseline (`executions=12`) | 32194797116 | `a386c4a245ae3d60cc1ded152777e82f221d473a` | 12 | 1 |

(The GitHub UI shows a later `head_sha` on the second run — that is the ref the workflow *file* was read from; the measured tree is the `sha` input the legs check out, which is what the log receipt above verifies.)

**14 of 14 legs valid; 0 legs excluded.** No missing artifacts, no malformed or truncated results, no zero-test sessions — the infrastructure class recorded **zero occurrences** in this measurement. The exclusion report is empty, stated here beside the rate per the honest-denominator contract.

**Headline: 3 failing executions / 14 valid legs ≈ 21.4%** (each failing leg failed exactly one spec file, 38/39 passing). A 3-in-14 observation is consistent with the incident-window 1-in-3 to within small-sample noise; what it retires is any reading of the PR #437 three-consecutive-failures run as a *worsened steady state* — 14 same-SHA legs did not reproduce a >50% rate. It also confirms the incident rate is not an artifact of PR-gate merge commits: these legs ran the plain main tree.

The numbers reproduce with (AE3):

```bash
gh run download 32193474859 -D <dir1> && gh run download 32194797116 -D <dir2>
node scripts/aggregate-e2e-results.mjs <dir1> 2 <dir2> 12
```

## Measurement 2 — per-spec rates and clustering

Per-spec failure rates over the 14 valid legs — every spec not listed measured 0/14:

| Spec | Failures / 14 | Rate |
|---|---|---|
| `gantt-legend.e2e.ts` | 1 | 7.1% |
| `gantt-column-sort.e2e.ts` | 1 | 7.1% |
| `gantt-calendar-items-sources.e2e.ts` | 1 | 7.1% |

Per-execution enumeration — every failing spec in every failing execution, named with its symptom (AE1):

- **Smoke leg 1** (run 32193474859): `gantt-legend.e2e.ts` — the "Gantt (OG) context-aware legend" `before all` hook failed with `Error: Gantt did not maximize for the overlay scenarios`; no test in that describe ran (session recorded passed 0 / failed 1).
- **Baseline leg 6** (run 32194797116): `gantt-column-sort.e2e.ts` — AE1 "sorts matched + fetched rows when a property column header is clicked" failed with `Column header "note.due" did not become clickable`.
- **Baseline leg 10** (run 32194797116): `gantt-calendar-items-sources.e2e.ts` — `before each` hook failed in `ensureGanttReady` with `not ready: Gantt bars missing: ["Standup 2026-03-23.md"]`.

Observations the ranked list uses:

- **The baseline reproduced exactly the incident record's top three specs** — the same three spec files that dominate the incident record below are the only three that failed in 14 controlled legs. The flake surface is concentrated, not diffuse.
- **No within-execution clustering in this measurement**: each failing leg failed exactly one spec. The incident record holds three two-spec executions — runs 31750064985 (`gantt-calendar-items-sources` + `gantt-dependency-types`), 31909561031 (`gantt-column-sort` + `gantt-default-field-mappings`), and 31997862224 (`gantt-legend` + `gantt-calendar-items-sources`) — so clustering exists in ordinary CI but did not appear in these 14 legs.
- **No spec failed twice in 14 legs** — per-spec rates are low individually (~7%) and the execution-level rate (~21%) is their union. A fix aimed at any single spec addresses at most a third of the measured obstruction.
- All three baseline failures are of the **never-became-ready class** ([CONCEPTS.md](../../CONCEPTS.md) § Never-became-ready class); the state-preservation symptom (PR #437 attempt 1) did not recur.

---

## Incident record (fold-in, verify-first)

Folded from `docs/backlogs/backlog.md` per R3; every denominator below was recounted from `run_attempt` at reporting time and matched the backlog's figure unless noted. Instances are grouped by window because denominators are window-specific and never pool across windows. Two diagnostic leads carried from the folded entries: the suite is strictly sequential (`maxInstances: 1`), so worker contention is ruled out as a cause class; and `WebDriverError: javascript error: No tab group found` recurs as a WARN on specs that then pass — noise, not a cause, but noise that could mask a real signal in exactly the never-became-ready area.

| Window | Runs (ids) | Executions (`run_attempt` sum) | Failed | Failing specs |
|---|---|---|---|---|
| PR #420 (2026-08-14, docs/gate-only diff) | 31750064985 | 2 | 1 | `gantt-calendar-items-sources` (beforeEach: `Gantt bars missing: ["Standup 2026-03-23.md"]`), `gantt-dependency-types` (tooltip hover) — one run, two spec failures |
| Governing-docs port (recorded 2026-08-15; runs dated 2026-08-14, docs-only) | 31842006155, 31845072266, 31795160791 | 2+2+1 = 5 | 3 | Enumerated from the attempt-1 logs at reporting time (the backlog had not captured the breakdown): run 31795160791 — `gantt-calendar-items-sources` `before each` → `Gantt bars missing: ["Standup 2026-03-23.md"]`, the record's recurring signature (never same-SHA re-run). Runs 31842006155 and 31845072266 — **no spec failed**: the WDIO step exited nonzero after `Spec Files: 39 passed, 39 total` with no failure line anywhere in the step log — a distinct launcher-exit failure class, invisible at spec level, predating the per-spec reporter (no artifacts to consult). A fourth same-day instance was recorded with no run id — unverifiable by construction, carried outside every denominator |
| PR #425 (2026-08-15, docs-only) | 31872079256 | 2 | 1 | `gantt-dependency-types` |
| PR #427 (2026-08-16, src-touching) | 31909561031 | 2 | 1 | `gantt-column-sort` ("did not become clickable"), `gantt-default-field-mappings` (status cell never editable) — corroborated by local pass on identical code |
| PR #435 (2026-08-17, docs-only) | 31994474738, 31995840304, 31997862224, 32000640719, 32005598340, 32010463010 | 1+1+2+2+1+2 = **9** | **3** | run 31997862224: `gantt-legend` (`.og-legend-toggle` not interactable) + `gantt-calendar-items-sources` (beforeEach bars missing); run 32000640719: `gantt-column-sort` (`note.due` not clickable); run 32010463010: `gantt-legend` ("did not maximize") |
| PR #437 (2026-08-17) | 32075292739 (attempts 1–4) | **4** | **3** | att1: `gantt-legend` (state-preservation: `scaleLabel` 2→3 — a distinct symptom class); att2: `gantt-default-field-mappings` (picker + beforeEach); att3: `gantt-calendar-items-sources` (beforeEach); att4: 39/39 |
| Reliability-campaign PRs #439–#443 (2026-08-18/19) | 32095901273 (1), 32113805668 (2), 32127127689 (1), 32129856022 (1), 32131983798 (1), 32135340081 (1), 32177921660 (1), 32193605515 (1), 32197558150 (2), 32200114557 (1), 32204158681 (3) | **15** | **4** | run 32113805668 attempt 1: `gantt-column-sort` AE1, error `not ready: Expected B before A on due-desc; saw A@0 B@-1` — the sort outcome never materialised and row B was absent (`B@-1`), a **different symptom** from the prior "did not become clickable" instances of the same spec. Run 32197558150 attempt 1 (this report's own PR #443, docs-only): `gantt-inferred-drag-write` `before all` hook — `ensureGanttReady` reported **all nine** fixture bars missing, followed by `invalid session id` — never-became-ready class, a spec new to the record, and the first instance where the whole chart (not one element) never materialised. Run 32204158681 (same PR): attempt 1 `gantt-column-sort` ("did not become clickable"), attempt 2 `gantt-legend` ("did not maximize"), attempt 3 green — two consecutive failures, a different ranked spec each time. **Window cutoff:** counted through run 32204158681; CI executions of this report's own later pushes fall to the trend metrics, not this table |

Corrections surfaced by the recount: the PR #440 attempt-1 failure was remembered as the header-clickability symptom; the log shows the AE1 sort-order wait with row B absent — recorded as measured. The #441-era window counted "3-for-3 green" from memory; the source of record shows **four** single-attempt green runs on that branch (plus the rest of the campaign window above).

**The separate evidentiary category (R4).** PR #430's instance — run 31929397025 (2 attempts), `gantt-context-aware-legend` "before all" hook, 2026-08-16 — stays outside every rate above and below. Its PR changed `src/` (the interceptor extraction), so its passing rerun proves nondeterminism without proving the diff uninvolved; a race *introduced by* that PR produces the identical sequence. It is carried cause-unresolved, never counted as confirmed environmental flake, and never folded into any docs-only window's rate. The baseline SHA contains PR #430's changes; if it introduced a race, Measurement 1 surfaces it as a ranked defect.

**Incident-window headline.** The best-attributed window (PR #435, docs-only, diff provably uninvolved) measured **3 failures / 9 executions**; the adjacent PR #437 run measured 3/4 with three consecutive failures. Diff-uninvolved never means environmental: a latent race in `src/` or the harness on the base SHA fits the same evidence (method requirements 2–4).

---

## The ranked defect list

Rank = measured failure frequency (baseline + incident record) weighted by what the evidence says about cause class. Each entry carries its numbers, a reproduce command, a KTD7 four-way classification — (a) no readiness gate, (b) gate on a signal the assertion doesn't consume, (c) infrastructure, (d) genuine product nondeterminism — and harness-vs-src attribution, which stays **open** on every entry: no distinguishing evidence has landed for any of them (method requirement 4). The common reproduce instrument for every entry is the repeat-run:

```bash
gh workflow run e2e-repeat.yml -f sha=<full-40-hex-sha> -f executions=12
# then download + aggregate per § Method; failing legs' logs: gh run view --job <job-id> --log-failed
```

1. **`gantt-legend.e2e.ts`** — 5 measured instances (4 incident + 1 baseline) across **three distinct symptoms**: `.og-legend-toggle` never interactable (run 31997862224); "Gantt did not maximize for the overlay scenarios" in the context-aware-legend `before all` hook (runs 32010463010 and 32204158681 attempt 2, and baseline smoke leg 1 — three occurrences); `scaleLabel` 2→3 on a state-preservation assertion (run 32075292739 attempt 1). Classification: the two never-became-ready symptoms are (b)-vs-(d) **open** — the maximize wait and the toggle-interactable wait both gate on signals whose later invalidation is undiagnosed; the state-preservation symptom fits none of (a)–(c) and is the record's strongest (d) candidate. One spec, three symptoms is this list's clearest argument that no single error message is *the* bug. Evidentiary note for the separate category: the baseline's maximize failure is the same hook and symptom as PR #430's cause-unresolved instance, and the baseline SHA contains PR #430's `src/` changes — consistent with, but not probative of, that PR's open introduced-race hypothesis (no pre-#430 instance of the symptom exists in the record, though the record before #430 is also thinner). First diagnostic step: instrument the maximize path and re-dispatch legs.
2. **`gantt-calendar-items-sources.e2e.ts`** — 5 measured instances (runs 31750064985, 31795160791, 31997862224, 32075292739 attempt 3; baseline leg 10), **all the identical symptom**: `before each` → `ensureGanttReady` → `not ready: Gantt bars missing: ["Standup 2026-03-23.md"]`, always the same fixture note. The most consistent signature in the record: one hook, one missing bar, five occurrences. Classification: (a)/(b) **open** — the gate is present and correctly reports unreadiness, so either the wait budget precedes a slow cold-index path (the `gate-e2e-on-cold-index-before-measuring-render.md` ancestor class) or the readiness signal keys on something other than what materialises that bar. Harness-vs-src open. Highest fix-tractability: single deterministic-looking symptom, known fixture.
3. **`gantt-column-sort.e2e.ts`** — 5 measured instances in **two symptom shapes**: `Column header "note.due" did not become clickable` (runs 31909561031, 32000640719, 32204158681 attempt 1; baseline leg 6) and `not ready: Expected B before A on due-desc; saw A@0 B@-1` — the sort outcome never materialised and row B was absent from the grid (run 32113805668 attempt 1, PR #440's gate). Classification: (b)-vs-(d) **open**, sharpened by the prior diagnosis (`column-sort-e2e-first-mount-header-race.md`, PR #182): the specific-header readiness gate is in place and passed, and `clickColumnHeader` returns on click-landing, so "did not become clickable" means no click landed in 10s *after* a passed gate — either the gate samples a weaker condition than the click needs (b), or an application re-render drops and recreates the header/rows (d, a real product defect the spec is correctly reporting). The `B@-1` shape (a row absent post-readiness) leans the same way. PR #182's deferred post-click hardening does **not** address either shape — no click ever landed. Diagnose header/row lifecycle before writing any fix.
4. **`gantt-default-field-mappings.e2e.ts`** — 2 incident instances, 0/14 baseline: "the managed row's status cell never became editable" (run 31909561031) and the configured-statuses picker + `before each` failure (run 32075292739 attempt 2). Classification: never-became-ready, (a)/(b)/(d) **open**; too few instances to characterise further. Watch via per-spec trend; no dedicated unit until it recurs.
5. **`gantt-dependency-types.e2e.ts`** — 2 incident instances (runs 31750064985, 31872079256, both the tooltip-hover test), 0/14 baseline, none since 2026-08-15. A previously root-caused flake in this spec (starter-note steals the active leaf, PR #99) was fixed; whether these instances share that cause was never verified — that fix's own solutions doc records a residual exposure (a post-readiness custom wait that does not re-invoke the heal per poll), a concrete first check when this recurs. Classification: (a)/(b)/(d) **open** — never-became-interactable on a hover target, no distinguishing evidence; not (c), the harness ran the suite. Same watch-only posture as rank 4.
6. **`gantt-inferred-drag-write.e2e.ts`** — 1 measured instance, 0/14 baseline: run 32197558150 attempt 1 (this report's own PR #443, docs-only), `before all` hook — `ensureGanttReady` reported **all nine** fixture bars missing, then `invalid session id`. New to the record, and the first instance where the whole chart, not one element, never materialised. Classification: (a)/(b)/(d) **open**, with the whole-chart shape also compatible with a view that never mounted (adjacent to (c) but the session was live enough to poll); harness-vs-src open. Watch-only until it recurs; reproduce via the repeat-run command above.
7. **The infrastructure class (c) — zero repeat-run occurrences, two incident-window instances, kept visible.** In 14 legs: no zero-test sessions (the PR #437 worker-reimport class, `wdio-config-reimport-wipes-cross-session-state.md`), no missing artifacts, no TaskNotes-download rate-limit failures (`ci.yml`'s known CI-only nondeterminism source). The incident record now also carries a **launcher-exit** member of this class: runs 31842006155 and 31845072266 attempt 1 each failed the WDIO step after a fully green `39 passed` suite with no failure line in the log (enumerated in the incident table above) — a green-suite nonzero exit that predates the per-spec reporter and has not recurred since it landed. These never enter the product rate — they land in the exclusion report — but the class stays on the list because a single bad hour can dominate a window, and the exclusion count is a named trend metric below.

The PR #430 instance (`gantt-context-aware-legend` `before all`, run 31929397025) remains in its **separate evidentiary category** (§ Incident record) and takes no rank: cause-unresolved, diff-involvement open. Its evidence now lives with rank 1, which is where any base-vs-changed SHA comparison would be commissioned if the campaign decides it is worth the legs.

---

## Not measured — out of scope by decision

- **The scheduled perf workflow's red** (`gantt-resultset-storm.perf.e2e.ts`, failing deterministically since 2026-07-13) is an adjacent unmeasured signal, referenced, not folded: it is deterministic (fails same-SHA rerun), so it is not flake, and its backlog entry remains where it is.
- **`src/` runtime error-handling / retry / degradation surfaces** — enter the list only through flake root-cause evidence (KD1), not through a separate audit.
- **Unit-test (jest) nondeterminism** — one local flake candidate is on record (`crossModelPeerReview.test.ts` under parallelism); no measured instance in CI. Unmeasured here.
- **Local-environment e2e flake** — the baseline measures the CI environment where every recorded failure occurred.
- **A scheduled repeat-run cadence** — the baseline used manual dispatch; scheduling is a trend-mechanism decision nominated below, not adopted here.

## Baseline and trend

This report is time-zero for the pillar's trend reporting. The trend metrics, re-measured at each reliability campaign session's end:

- **Repeat-run flake rate** — failing executions / valid legs at a pinned SHA, from a fresh `e2e-repeat.yml` dispatch aggregated by `scripts/aggregate-e2e-results.mjs`, exclusions reported beside the rate. The baseline figures above are the comparison point.
- **Per-spec failure frequency** — the per-spec table above, re-derived the same way; the trend question is whether ranked entries' frequencies fall as their units land.
- **Incident-window rate** — failures / executions via summed `run_attempt` over each session's PR CI runs (the ordinary-merge tax the pillar exists to remove). Every ordinary CI e2e run now uploads per-spec results in its `e2e-artifacts`, so per-spec attribution for any window is recoverable after the fact.
- **Exclusion count** — infrastructure-class legs (zero-test sessions, missing artifacts, malformed results) per measurement, tracked so infrastructure defects are worked as their own class rather than inflating or hiding the product rate.

**Mechanical-gate nomination (KD4/R10).** The nominated candidate is a two-part guard, both parts "mechanism, not memory": (1) a CI assertion that the completed e2e job's merged results file records exactly the expected spec count — the aggregation script's leg-validity check promoted into the ordinary gate, so a zero-test or truncated session fails visibly instead of passing silently (the class `docs/solutions/developer-experience/windows-build-and-e2e-environment-setup.md` records); (2) a mechanical check that no retry/rerun-masking configuration (`specFileRetries` or equivalent) exists in the WDIO or CI configs — the Scope Boundaries prohibition enforced by tooling rather than memory. Adoption is a campaign unit, not this report's change.

**Scheduled cadence** — nominated as a trend mechanism (a periodic `e2e-repeat.yml` dispatch on main), deliberately not adopted here: the manual-dispatch baseline is sufficient until the ranked list's top entries land, and a cadence adopted before fixes begin would measure a known-bad steady state at 2× billed minutes per leg.
