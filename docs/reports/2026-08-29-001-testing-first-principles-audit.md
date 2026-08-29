# Testing Posture — First-Principles Audit

**Date:** 2026-08-29
**Measured at:** `26c341f` (branch `docs/register-render-data-extraction-plan`; source-identical to `main` at `90b2470` — the only diff is a `.md` file)
**Method:** 55 agents across five phases — eight measurement dimensions, four independent from-scratch designs, three gap lenses, three adversarial refutation lenses per gap, and a prosecution/defence pair on the central question. 6.3M tokens, ~104 minutes. Two agents died to an API safeguard error; the affected gaps were decided on two votes instead of three and are marked below.

**Trigger.** Plan `2026-08-29-001` claimed `ObsidianGanttBasesView` (1,547 lines) had "no unit-level coverage" because no test imported it. That was false: `test/unit/blockingBuilders.test.ts` constructs a real instance under Jest by handing the real `registerBasesGantt` a fake plugin that pockets the view factory, then casts past `private` to drive five methods. The maintainer's response set this audit's brief: *challenge every assumption about why we cannot unit test everything; start from first principles; every unit test can be simple, and if it is not, we are missing something.*

**Scope note.** This report is a measurement record, not tracked work. It supersedes no plan. Its corrections to `2026-08-29-001` are applied in that plan directly.

---

## Headline

**The testing posture is largely sound, and the defect is narrower than the trigger suggested.** Nine of twelve candidate gaps were refuted on re-measurement, several because the repo has already recorded and executed the decision being proposed. What survived is three items and two experimental results — and the experiments are worth more than the gaps.

The maintainer's premise is confirmed: **every behaviour of this plugin can be proven by a fast unit test.** The residual is not behaviour; it is our beliefs about systems we do not own.

---

## Measurement 1 — the purity census

Mechanical AST classification over 185 code files / 44,716 lines, using the repo's own TypeScript 5.9.2 compiler API.

| Bucket | Files | Lines | Share |
|---|---|---|---|
| A — pure domain (no framework contact) | 123 | 24,741 | 55.3% |
| B — thin adapter (no decisions of its own) | 32 | 3,631 | 8.1% |
| C — mixed: decisions **and** third-party contact | 30 | 16,344 | 36.6% |

Inside the 54 AST-coupled files: **541 lines actually name a third-party symbol; 6,459 are logic.** A 12:1 ratio of decision to translation, inside the files that exist to translate.

**The finding that reframes the problem.** Of 3,678 trapped decision lines, only **567** are genuinely interleaved with third-party calls. The other **3,289 are whole framework-free functions** (260 of them) sitting on the wrong side of an access modifier or a closure:

| Reachability | Lines | Share |
|---|---|---|
| MODULE_PRIVATE | 936 | 22.6% |
| CLOSURE_LOCAL | 884 | 21.3% |
| EXPORTED | 879 | 21.2% |
| PRIVATE_METHOD | 782 | 18.9% |
| PUBLIC_METHOD | 664 | 16.0% |

`CLOSURE_LOCAL + PRIVATE_METHOD` = **1,666 lines reachable only by casting past encapsulation**. And 2,374 of the 4,145 framework-free lines are stateless — a move-and-export refactor with no design work.

> They are not entangled with Obsidian; they are hidden behind it. The seam already exists, it has not been cut.

Sharpest single instance: `src/datasource/TaskNotesSource.ts` (1,193 lines) imports `obsidian` **type-only** and dereferences `app` at exactly **one line** — `:961`, `this.app.metadataCache.getFirstLinkpathDest`. That one line puts 32 decision methods behind a class that must be handed an `App`.

## Measurement 2 — the X-ray count was wrong

The audit was triggered partly by "134 `as unknown as` casts in the unit suite." Classified properly:

- **106** are ordinary test-double construction against third-party nominal types — exactly what Ch. 12 prescribes. Not a smell.
- **24** are type-system friction with no encapsulation content.
- **5** are genuine encapsulation breaks, naming **8 production members in 2 files**, every one inside an Obsidian-facing class.

Corroborated independently: 0.054 `jest.fn()` per test, one `jest.mock()` across 176 files, one file reaching past `private`. **Any remediation premised on "the repo is over-mocked" or "we X-ray everything" would spend effort where no defect exists.**

The counterexample is in-repo: `test/unit/ganttLifecycleDiagnostics.test.ts` tests deep view-lifecycle behaviour with **zero** encapsulation breaks, because `ganttLifecycleDiagnostics.ts:70` exports a real access port. Where the port exists, the X-ray disappears and the test gets *simpler*.

## Measurement 3 — test quality

**392 of 3,503 tests (11.2%) never assert a value.** Five real behavioural mutations were planted; **four kept the entire suite green** — an entire click handler opening the wrong note, a diff-sync fingerprint that stopped being a function of its inputs, and two independent sets of user-facing error strings replaced with wrong ones. The one that was caught was caught by a single assertion (`ganttSync.test.ts:235`), whose form is the repair pattern for all five.

---

## Experiment A — SVAR's store is importable into plain Jest

`@svar-ui/gantt-store` 2.7.0 is a **separate npm package**: "Internal state management used by SVAR Gantt component", dependencies `date-fns` + `@svar-ui/lib-state`, no DOM, no Svelte. Its `DataStore` constructor takes a `TWritableCreator` that a six-line hand-written writable satisfies.

Four contract tests against the **real vendor object**, in this repo's existing `testEnvironment: "node"` Jest:

```
√ the real SVAR DataStore constructs in jest/node with no DOM   (7 ms)
√ update-task mutates the real vendor store in place            (2 ms)
√ the vendor really has a nullable _sort                        (6 ms)
√ move-task reorders rows in the real store                     (2 ms)
Tests: 4 passed, 4 total.  Time: 0.166 s
```

One config line: `transformIgnorePatterns: ["node_modules/(?!@svar-ui)"]`. Mutation-checked — swapping `update-task` for `add-task` turns test B red, so these are falsifiable claims about the vendor, not tautologies about a fake.

**Significance.** "`api.exec('update-task')` really mutates SVAR's store without re-initialising it" is the founding premise of `src/bases/ganttSync.ts` (1,032 lines). Every from-scratch design listed it as structurally unprovable by unit test. It runs in 2ms.

**Bounded honestly:** this settles SVAR's *store*, not its *renderer*. `@svar-ui/svelte-gantt` compiles to DOM; fractional bar placement, cascade resolution, `::before`, `mask-image` and `getBoundingClientRect` remain unreachable from a node environment. The browser probe tier keeps its job.

## Experiment B — four real defects, zero signal

In an isolated worktree at `26c341f` (baseline: 179 suites / 3,947 tests / all pass / 78.4s), four mutations were applied, each a genuine product defect:

| # | Mutation | Product consequence |
|---|---|---|
| M1 | deleted `public focus()` (`register.ts:558-563`) | plugin crashes on startup / view restoration |
| M2 | `VIEW_TYPE_ID` → `'obsidianGanttMUTANT'` (`register.ts:196`) | the view ceases to exist; every saved `.base` breaks |
| M3 | `z-index` → `-1` (`GanttContainer.css:34`) | maximize paints the chart behind the page |
| M4 | one `$effect` read wrapped in `untrack` (`GanttContainer.svelte:713`) | the opacity slider stops updating live |

**All four live simultaneously: jest 3,947/3,947 pass, `svelte-check` 0 errors / 24 warnings, `eslint src --max-warnings 0` exit 0 — identical to baseline.**

M1 is not hypothetical. `git show b0244f7` — *"fix: add focus() method to Bases view to prevent startup crash (#41)"* — is a two-line commit whose entire content is that stub. A production crash, learned once from the real host, is preserved today by a JSDoc comment. That is the "mechanism, not memory" rule with no mechanism available below the integration tier.

---

## The boundary

All four independent designs converged on one category, and the prosecution/defence pair sharpened it:

> A unit test proves an implication: *given that the vendor behaves as our double behaves, our code does X.* It cannot prove the antecedent. The limit is **epistemic, not technical** — a unit test can encode knowledge about the world outside its process; it cannot acquire it, and cannot detect when it goes stale.

Every design explicitly **refused** the conventional entries. Not on the list: Svelte components (a file-placement problem — 8 of 25 runtime-`obsidian` importers already sit at 100% line coverage); Obsidian-facing classes; "hard" code of any kind. Farley Ch. 14 is quoted against difficulty as a reason: *"You can always do this… For these 'edges of the system', it is nearly always worth the effort."*

Experiment A then shrank the category further by showing one of the two vendors is importable. The residual is what Experiment B measured: registration contracts, required lifecycle callbacks, CSS layering, framework reactivity — facts about hosts, not behaviours of ours.

---

## Surviving gaps

Three of twelve, each upheld 2/3 by adversarial refutation.

1. **(P0; severity votes P0/P1/P2) The render-model seam has exactly one producer** — a private async method on the Obsidian-instantiated view. The layer turning host facts into the render model is the plugin's essential complexity and has no measurement point. *This is what plan `2026-08-29-001` already targets.*
2. **(P0 as filed; severity votes P1/P1/P2 — treat as P1) Obsidian is globally mocked instead of bounded by a port.** `practices.md:87` (E9) states *"Third-party code is wrapped behind thin facades we own, never mocked directly"* with a governance test at `:89`; `jest.config.mjs:38` aliases a 449-line hand-written imitation for all 179 suites. **The charter's own governance test fails on the repo's own config.** Aggravating: the `BasesView` stub (`obsidian.ts:149-155`) invents a wiring rule the published `QueryController` does not contain, and a test asserts against the invention.
3. **(P1) 69% of the e2e step is scaffolding.** The tier cannot be made cheap by trimming tests — `gantt-locale-dates`' two tests cost 18ms of the 2,691ms they occupy. Any budget expressed in *tests* is meaningless; it must be expressed in **specs and Obsidian boots**.

## Refuted gaps — recorded so they are not re-litigated

Nine were refuted, several because the repo has already decided and executed the proposal. The cost measurements in these were largely exact; the *classifications* and *prescribed actions* failed.

- **"46% of gated e2e re-asserts pure decisions Jest covers" — refuted 3/3.** Cost arithmetic re-derived exactly (60× premium, 19,989 spec LOC). But the cited e2e tests assert **composition**, not the pure decision: `src/release/ReleaseNotesView.ts` has *zero* unit coverage, so its e2e is the only thing covering it. Seven of the fourteen "wholly-reducible" specs are not reducible. And the governance rule proposed is a restatement of a live applied decision — `docs/solutions/tooling-decisions/test-at-the-fastest-level-not-redundant-e2e.md` (2026-06-23), already executed retrospectively in plan `2026-07-28-001`, which cut a spec from ten cases to three with a coverage ledger per retired case.
- **"`.svelte` is a configured testability wall" — refuted 2/3.** `jest.config.mjs:39`'s comment is stale shorthand inside a config file, contradicted by `principles.md:45`, which already states a **three**-tier map including the vitest-browser probe. Causation is inverted, proven by git: every source-text test file was *added by* an extraction PR (`8b12ead`/#453, `5ef95fa`/#459), so extractions are already self-evidencing.
- **"`testing.md:52` is the licence for e2e-first" — refuted 2/3; a P2 doc nit survives.** The claim that config exclusions cite it as precedent is inverted by the cited lines themselves: `jest.config.mjs:56-59` reads *"Logic-dense files (register.ts, views) are NOT excluded — their logic is being extracted into tested modules, not hidden."* The config explicitly fences exclusions **away** from `register.ts`.
- **"Principle 5 places tests by kind-of-behaviour, not by who-owns-the-answer" — refuted 2/2** (one lens lost to the API error). Counting honest; the load-bearing exemplar was **fabricated** — `git show --stat 7eafe7f` (#157) contains both the extraction and its e2e in the same commit, so the claimed "extraction that left its motivating e2e behind" never occurred.
- Also refuted: the trend-instrument testability columns (3/3); the two-drifting-mocks fix as filed (2/3, though its factual core feeds surviving gap 2); the coverage-exclusion re-keying (2/3); the middle-tier documentation gap (2/2); ambient timers (2/3).

**Method note.** That nine of twelve fell is itself a result. Findings assembled from correct measurements can still carry false classifications and unaffordable prescriptions; the refutation lenses — *evidence*, *already-settled*, *cost-benefit* — caught all three failure modes. Measurements in this report are cited only where they were independently re-derived.

---

## Recommended sequence

**Step 0 — harden the mutation-proven blind assertions. Before anything else.**
Test-only: `taskNotesInteractions.test.ts` (count-only sites at `:116,:128,:140,:151,:172,:182,:183,:193` — `:114/:115/:204` already show the correct form), `patternWindow.test.ts` (12 `not.toBeNull()` on a user-visible reason string), `calendarEditorState.test.ts` (11 `toBeDefined()` on inline field errors), and the `ganttSync`/`entrySignature` fingerprint family. Zero `src` changes, so it collides with neither campaign and does not drift plan anchors. **Definition of done is the mutation receipt** — apply, observe red, revert, print the diff — not the assertion counts.

**Steps 1–3 — plan `2026-08-29-001` U1/U2/U3, as written.** The plan's target survived; its corrections are applied in the plan itself.

**Step 4 — recommended follow-up unit (not yet promoted):** `test/perf/generator/buildGanttData.ts` exports `assembleGanttData`, a **second producer of the render contract** — principle 4, second mechanism. Its own docstring states the justification: *"harness-local assembly, NOT a mirror of `register.ts`'s private `buildGanttData` — that method reaches into `app.vault` / `app.metadataCache` / `config.get`, which the in-memory harness lacks"*, so only perf-load-bearing fields are populated and the Obsidian-dependent ones are stubbed. **U3 removes that justification**: once the assembly sits behind the two ports, the harness supplies in-memory adapters and calls the real one, taking producers from 2 to 1. *(Verified here: the file, the export, and the docstring. The sequencer's field-level counts — 23 hardcoded literals, 12 fields absent — are its own and are not re-derived in this report; re-measure when the unit is picked up.)*

**Not recommended now:** the full port campaign (surviving gap 2). The charter violation is real and undisputed; the disagreement is sequencing. Steps 1–4 pay down its measured core. If the predicted movement does not materialise, the campaign argument gets stronger and should be re-raised **with that evidence**.

## Open items for maintainer arbitration

- **The E9 contradiction is live and should be reconciled in the docs**: `practices.md:87` forbids mocking third-party code directly; `testing.md:17/:51` endorses the Obsidian mock. One of them is wrong. This is a doc decision, not a code change.
- **Severity of surviving gap 2** — filed P0, voted P1/P1/P2.
- **Whether Step 4 becomes U4** of the standing plan or its own unit.
- **`obsidian-integration-testing`** (`mnaoumov`, v10.4.0, MIT, wraps `webdriverio@9.27` + `puppeteer-core`) is aimed precisely at Experiment B's residual — owned isolated instance, version pinning/matrix, `evalInObsidian`. Evaluating it is a sensible spike **after** the port work, not before; adopting it first would optimise the tier that should shrink. Version-compatible with this repo today (`webdriverio ^9.19.2`, Node 22.23.2, vitest 4.1.9). Risk to weigh: ten majors in five months.

---

## Sources

- Workflow run `wf_1a9df325-80a`; per-agent returns in the session's `journal.jsonl`.
- `docs/reports/2026-08-15-001-maintainability-rediagnosis.md` — the ranked list this audit's gaps were tested against.
- `docs/reports/2026-08-27-001-farley-alignment-audit.md` — the relocation-vs-extraction drift-guard.
- `docs/solutions/tooling-decisions/test-at-the-fastest-level-not-redundant-e2e.md` — the recorded decision that refuted the e2e-duplication gap.
- Dave Farley, *Modern Software Engineering*: Ch. 7 (Guided by Reality), Ch. 9 (The Importance of Testability; measurement points), Ch. 11 (Essential vs Accidental; Ports & Adapters), Ch. 12 (Fear of Over-Engineering; Isolate Third-Party Systems and Code), Ch. 14 (Measurement Points; Testing at the Edges).
