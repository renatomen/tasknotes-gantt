---
title: "Extract Svelte coordination logic through a live accessor bridge"
date: 2026-08-29
category: docs/solutions/architecture-patterns
module: bases-gantt
problem_type: architecture_pattern
component: frontend_stimulus
severity: high
applies_when:
  - "A large Svelte view (e.g. GanttContainer.svelte) has accreted coordination logic that needs unit tests Svelte itself can't host"
  - "Extracting logic that must keep reading and writing the view's own reactive state (flags, caches, rebindable handles) rather than a copy of it"
  - "A ranked-defect file's concern count or line count must shrink without moving state ownership out of the component"
  - "Choosing between a getter/setter accessor bridge and passing state by value across an extraction boundary"
  - "Writing a liveness-pin test to prove a seam tracks the view's CURRENT state rather than a snapshot taken at construction"
tags:
  - "live-accessor-bridge"
  - "extraction-seam"
  - "svelte-component"
  - "gantt-container"
  - "gantt-sync-orchestrator"
  - "liveness-pin"
  - "ranked-defect-file"
  - "unit-testable-seam"
related_components:
  - "GanttContainer.svelte"
  - "ganttSyncOrchestrator"
  - "interceptor-seam"
---

# Extract Svelte coordination logic through a live accessor bridge

Extracting coordination logic from a large Svelte 5 component into a unit-testable seam module without moving state ownership — refined across four merged extractions: the SVAR interceptor seam (PR #427) and the three diff-sync orchestrator units (PR #461, PR #462, PR #463, closing plan `2026-08-27-002`).

## Context

`GanttContainer.svelte` was the repo's rank-1 maintainability defect: a 4,000+-line view holding orchestration logic — echo suppression, ephemeral-sort coordination, the reseed family, the whole diff-sync branch tree — coupled by closure capture to the component's own mutable state: Svelte `$state` (`collapsedIds`, the seed props), plain component `let`s (the echo-suppression `syncing` flag, a rebindable `api`), and a shared applied-state object whose Map identities other staying code aliases. Only e2e could observe any of that behavior.

Two constraints ruled out the obvious moves:

- **State ownership could not leave the component.** Reactive `$state` loses its reactivity outside the component; the `syncing` flag is read by interceptors, effects, and the template; the `api` binding is rebound on remount. Moving the state would have been a rewrite, not a refactor.
- **Copied values are silently wrong.** A value handed across a seam is a snapshot. A snapshot of `syncing` "would silently stop bracketing echo suppression the moment the flag changes, and a wiring-time api capture would exec into a torn-down store after a remount" (`src/bases/ganttSyncOrchestrator.ts:13-16`). These are not hypothetical failure modes — they are exactly what naive parameter-passing produces.

The answer is the **live accessor bridge**, the canonical term in `CONCEPTS.md` (§ Extraction seams): the view hands the extracted module an object of getter/setter properties closed over its component scope, so every read and write crosses live and the state never moves or gets copied. The logic moves; the state stays; the coupling becomes a named, typed, structurally-testable surface.

The pattern was established for event-handler policies in `src/bases/svarInterceptors.ts` (PR #427) and then carried, with two additional reactive contracts, through the diff-sync orchestrator in `src/bases/ganttSyncOrchestrator.ts` (PRs #461–#463), whose caller is not an event handler but a Svelte `$effect` — which is what makes the read discipline load-bearing. Before the diff-sync plan was written, a dedicated flow analysis pinned the sync effect's implicit dependency on synchronous transitive reads, the branch-dependent read sets, and the two incompatible `syncing` conventions, producing the test scenarios the units were built against — the coupling census came before the move, not after (session history).

## Guidance

### 1. The bridge shape: access + deps + init

The component passes the factory three arguments with three distinct contracts (`createGanttSyncOrchestrator(access, deps, init)` in `src/bases/ganttSyncOrchestrator.ts`, called from `GanttContainer.svelte`).

**The access object: bare accessor properties, never copied values.** Every mutable binding crosses as a `get`/`set` pair whose body is a bare read or bare assignment of the same-named component binding:

```ts
// GanttContainer.svelte — the real literal, verbatim shape
const syncOrchestratorAccess: SyncOrchestratorAccess<SvarGridColumn> = {
  get syncing() { return syncing; },
  set syncing(value) { syncing = value; },
  get ephemeralSort() { return ephemeralSort; },
  set ephemeralSort(value) { ephemeralSort = value; },
  get api() { return api; },            // getter-only: module never rebinds it
  // ... columns / initialTasks / initialLinks get+set ...
  get collapsedIds() { return collapsedIds; },  // getter-only
};
```

Members the module only reads are **getter-only** — the interface says so (`readonly api`, `readonly collapsedIds` in `SyncOrchestratorAccess`), so a write the module was never meant to make is a compile error, and the read/write census is visible in the type. The same convention governs the interceptor bridge (`InterceptorAccess` in `src/bases/svarInterceptors.ts`: `readonly syncing`, writable `ephemeralSort`).

The anti-pattern, for contrast:

```ts
// WRONG — every one of these is a snapshot that desyncs:
const access = {
  syncing,                        // copies the boolean at wiring time
  api: api,                       // captures the pre-remount api forever
  collapsedIds: new Set(collapsedIds),  // clone: later toggles invisible
};
```

A handler's write through the bridge is immediately visible to the next handler, the view's effects, and the template — that is the whole point.

**The deps object: stable function collaborators.** Things the module *calls* but never assigns cross as functions in a second object (`SyncOrchestratorDeps`). Two flavors live here:

- Stable view closures called for their effect: `applyPersistedGridWidth`, `applyDisplayFilters`, `buildSvarColumns` — behaviors that deliberately stay in the view (dual-homed or view-owned concerns) and cross as plain calls.
- **Live reads wrapped as suppliers**, evaluated at call time, never at wiring time: `currentData: () => get(data)`, `cellEditColumnIds: () => cellEditColumnIds`, `hiddenSources: () => sourceSwitcher?.hiddenSources()`, `getSort: () => config?.getSort?.()`. The interceptor seam documents why this form is mandatory for `$derived` values: "a capabilities flip or a grid-column edit changes them without a SVAR re-init, so they must be read at event time, never captured at wiring" (`src/bases/svarInterceptors.ts`).

Mutable *reference* state whose identity must survive crosses once by reference in deps: `appliedSyncState` is "aliased — the same reference the incremental sync and the echo baseline mutate"; the unit suite pins that a reseed mutates it in place and never replaces the object or its inner Maps, because staying-side `applyEchoToBaseline` and `interceptorDeps.lookupAppliedLink` alias them.

**The init argument: immutable mount-time baselines, by value.** Module-private state seeded from mount-time facts (`appliedColumnsKey`, `appliedEditorAttachKey`, `appliedGridWidth`) is initialized from a small readonly object of values (`SyncOrchestratorInit`) — "passed by value at construction — never read through live accessors, which would break the bridge's no-eager-dereference contract." The split matters: some state genuinely *is* captured once at construction, and pinning which state that is — rather than assuming uniform "everything is live" — is part of the seam's contract (session history). **The module must not read any live accessor or call any dep at construction.** The factory runs at component setup, *outside* any effect frame — an eager read there is never tracked, so the caller effect silently misses the dependency it should have gained, and the eagerly-cached value goes stale the moment the backing state changes. The unit suite pins construction to exactly zero accessor reads and asserts every deps mock — suppliers and collaborators alike — uncalled at factory time (`test/unit/ganttSyncOrchestrator.test.ts`); a census that pins only some deps tolerates an eager read through the ones it skips (peer review caught exactly that gap while this doc was being written).

### 2. The two reactive contracts when the caller is a framework effect

When the bridged module's entry point is called from a Svelte `$effect`, the module's *reads are the effect's dependencies* — Svelte tracks transitive synchronous reads through ordinary function calls. Two contracts keep that tracking correct (both stated in the module doc comment of `src/bases/ganttSyncOrchestrator.ts`):

**(a) Synchronous-read.** Every dependency-establishing read executes within the sync entry point's call frame. The sync `$effect`'s dependency on `collapsedIds` exists only because `toInputs` reads `access.collapsedIds` synchronously inside `syncToGantt`'s frame — defer that read to a microtask or cache it and the effect silently stops re-running on collapse changes, while every runtime behavior test stays green. Corollary: sync-path functions stay synchronous — no `async`/`await`/microtask hops — because the `syncing` window and the no-reentrancy property depend on it.

**(b) Branch-scoped reads.** No accessor dereference outside the branch that needs it, because *widening the read set changes when the effect re-runs*. The NOOP branch performs zero `ephemeralSort` reads — a "harmless" hoisted read at the top of `syncToGantt` would make every ephemeral-sort toggle re-trigger the whole sync effect, and could replay a reorder after `restoreBaseOrder`'s catch path. Guard-order is part of this: `reassertEphemeralSort` checks the override before touching the api, and the test pins the short-circuit's api-read count at zero.

**The deliberate carve-out: timer callbacks read lazily at fire time.** The post-reseed reassert timer captures nothing at schedule time; at fire time it re-reads `access.ephemeralSort` (the staleness guard) and `access.api` (so a deferred exec deliberately lands on the *re-bound* api after a theme-flip remount). Raw scheduling by design: no handle, no cancellation, no destroy gate; the fire-time guard and the catch are the staleness mechanism (pinned in the unit suite, including "fires without throwing after component teardown while the api stays assigned — no destroy gate"). Fire-time reads are non-tracking (they run outside the effect frame), which is exactly why they are exempt from contract (a).

### 3. Test strategy: owned measurement points, no component-mount rig

Do not build a mounted-component harness to test the extracted logic. That path was rejected twice during planning — first by feasibility review (the repo's jest tier mocks Svelte and runs in a node env, so a mounted-harness proof cannot run at all), then re-litigated by the maintainer against Modern Software Engineering's Ch. 9 instrument: building bespoke jest-Svelte-mount infrastructure re-tests third-party behavior, and "dependencies are the calipers" — so the injected bridge itself becomes the measurement point (session history; plan KTD6, session-settled — do not re-propose). Three layers replace the rig:

**(1) A spy access object in the unit suite.** Counting getters, recording setters, and one ordered event log across every observable emission:

```ts
// test/unit/ganttSyncOrchestrator.test.ts (excerpt)
const reads = { syncing: 0, ephemeralSort: 0, api: 0, /* ... */ collapsedIds: 0 };
const access: SyncOrchestratorAccess<TestColumn> = {
  get syncing() { reads.syncing += 1; return backing.syncing; },
  set syncing(value) { syncingWrites.push(value); backing.syncing = value; },
  get ephemeralSort() { reads.ephemeralSort += 1; return backing.ephemeralSort; },
  set ephemeralSort(value) { events.push({ kind: 'set-ephemeral-sort', value }); backing.ephemeralSort = value; },
  get api() { reads.api += 1; return backing.api; },
  // ...
};
```

The counting getters double as the **read census**: what the module reads inside one synchronous call frame is exactly what the view's effect depends on, so `expect(f.reads.ephemeralSort).toBe(0)` on the NOOP path *is* the branch-scoped-reads proof, and `expect(f.reads.collapsedIds).toBeGreaterThanOrEqual(1)` inside a sync call is the synchronous-read proof. The single ordered event log, with a `syncingDuring` snapshot on every emission, makes ordering contracts directly assertable — "null the override before the restore replays", "the reassert timer fires before the display-filter timer", "one raise for the whole incremental pass". A `clearLog()` helper zeroes every counter and mock between a baseline pass and the scenario — see the liveness pitfall below for why that reset is load-bearing.

**(2) Source-shape pins over the component.** `test/unit/ganttSyncEffectShape.test.ts` reads `GanttContainer.svelte` as text and pins the component's side of the contract — the part no runtime unit test can see. Crucially, the component holds **two** access literals (`interceptorAccess` is the other), so every assertion extracts the `syncOrchestratorAccess` literal **by name** rather than pattern-matching "an access literal". The pins:

- every census getter/setter is a *bare* read/assignment of the same-named binding;
- no value capture, caching, spread, or `$state.snapshot` anywhere in the literal;
- **exactly** the census members — a widened read set fails red;
- the calling `$effect` body is a statement census: `const d = $data; void switcherRevision; if (!api) return; syncOrchestrator.syncToGantt(d);` and nothing else, with exactly one call site — using comment-tolerant per-read assertions rather than one monolithic regex (session history: feasibility-round implementer guidance);
- the moved functions are not re-defined in the view and the module-owned collaborators are not re-imported;
- and the pins carry **mutation self-tests**: planted drift (a snapshotted getter, a widened census, a re-inlined function, a second call site) must trip the matchers — the test's name is a claim, and these prove it could fail.

**Scope the pin as a tripwire for accidental drift, not a fortress against sabotage.** The pin shares the guarding with the compiler: the literal is assigned to a *typed* const, so TypeScript's excess-property check already rejects any member not on the access interface — a captured extra member is a type error before any test runs. What the compiler cannot see is an *existing* member's accessor quietly becoming a capture (`get syncing() { return syncing; }` "simplified" to `syncing,` — a cleanup a linter might even suggest), and the bare-accessor matchers fail red on exactly that, because the canonical accessor text disappears. That division of labor is the whole design. Deliberately crafted evasions — decoy literals in comments, keyword swaps, adversarial member spellings — are outside any test's power to refute (their author could as easily delete the test); code review owns that class. Hardening the pin against them grows a bespoke parser inside a test — accidental complexity guarding an imagined threat, the "future-proofing" and shiny-fortress failure Modern Software Engineering warns against — while adding nothing for the accidents that actually happen.

**(3) One e2e assertion for the composed behavior.** Framework tracking of synchronous transitive reads is not re-tested; a single e2e check that collapse state survives a reseed (the path where seeds recompute `open` from `collapsedIds` through the bridge) covers the composition (landed in PR #463 in `test/specs/gantt-expansion-sorting.e2e.ts`). Pick the scenario that can actually falsify the bridge: adversarial plan review found the originally proposed incremental-path collapse assertion could not fail on a broken bridge — only the reseed path recomputes `open` through it — so the scenario was retargeted before execution (session history).

### 4. Sequencing and discipline

One PR per coherent cluster, per the landing cadence: PR #461 moved the ephemeral-sort coordination cluster, PR #462 the reseed family plus applied-key state, PR #463 the sync orchestration itself — leaves first, orchestrator last, dependency-ordered. For each move: **write the module unit tests against current behavior before deleting the component-side originals**, so red/green brackets each move — the tests characterize what the closure-captured code does today, then the move must keep them green. Mutation-check the critical pins before trusting them: break the guarded behavior on purpose (snapshot a getter, cache a read, reorder a clear), observe red, revert — the shape suite bakes the most important of these in as permanent self-tests.

### Pitfalls (each caught the hard way)

**Liveness pins must mutate the live supplier or backing state *between* calls.** An init-vs-live mismatch alone — fixture wired with value A, assertion expects value B — tolerates a caching implementation that happened to read at the right moment. Peer review caught this in U2 (PR #462), and again in U3 (PR #463) in a sharper form: *a read census that counts factory-construction reads tolerates eager-read-and-cache*. The fix is threefold, all visible in the merged suite: pin **zero** accessor reads and supplier calls at factory time; zero the log after construction before counting per-call reads — the suite says why in place: "a factory that eagerly read and cached these would otherwise satisfy the counts without any per-call read"; and drive real between-call mutation — swap `backing.api` and assert the second call's execs land on the rebound label, change the `cellEditColumnIds` supplier's backing array between calls and assert the reseed triggers, swap `currentData` between two restores and assert the replay uses the new rows.

**Pin the behavior that exists, not the behavior you assume.** A draft test scenario for the grid-width deferral asserted the width was read at fire time; the actual behavior resolves the width at *schedule* time and only the api at fire time. Plan-stage feasibility review caught the wrong pin before it could enshrine the wrong contract (session history). Characterize first — the flow analysis exists so the pins assert observed behavior, not designed-in-the-head behavior.

**Mount-time circularity: export the shared projection as a pure function.** The component must build its mount seed *before* the orchestrator factory can run, because the applied-state baseline the seed feeds is itself a factory dependency — but the task-shaping projection belongs to the module. Resolution: export the projection pure (`toSvarTaskInputs` in `src/bases/ganttSyncOrchestrator.ts`) for the view's mount-time seed, and have the module wrap it with its own bridge reads for every later call — "so there is exactly one projection". One implementation, no second mechanism (principle 4); this closed the task-source asymmetry residual in U3.

**Never DRY-unify deliberately distinct conventions during the move — pin them instead.** The two `syncing` bracket conventions look like duplication: the incremental path calls the reassert *bare* inside its already-raised window; the post-reseed timer wraps its reassert in its *own* raise/`finally`. A unifying "guarded reassert" helper would drop the flag mid-`applyIncrementalGanttSync` and let SVAR-internal echoes persist to notes as user edits (`syncing` is a boolean, not a counter). Both conventions are pinned: the bare convention as "one raise for the whole incremental pass — a wrapped reassert would interleave its own raise/release here", the timer's own `[true, false]` bracket separately, and standalone calls never write `syncing` at all — callers own the bracket.

**One access literal per seam — do not merge them.** Merging `syncOrchestratorAccess` with `interceptorAccess` was proposed and rejected: each seam's access surface evolves independently across units, and merging hands each seam members it doesn't need (session history). The corollary is that source-shape pins must target their literal by name, since more than one literal legitimately exists.

**Close data-source asymmetries when the move makes them natural — and pin the closure.** `restoreBaseOrder` re-derives rows from the live `currentData()` supplier because its callers are UI gestures with no data argument. `reseedSeedsFromData(d)`, whose callers all pass same-frame data, derives tasks *and* links from that `d` — "rows and links both derive from the same `d`, so a reseed can never mix two payload generations". The regression pin sets a divergent `currentData` and asserts the reseed never calls the supplier.

**Reword volatile refs in moved comments.** Moved code carries its comments, and the pre-commit guard greps *added* lines for volatile references — so a comment that survived for years in place can block the extraction commit. Reword to durable phrasing while moving (e.g. the orchestrator cites a verified vendor-version fact with a single-call-site rationale rather than a bare issue or line citation).

**Keep component-side facts out of the bridge when the contract says they don't matter.** The test fixture's `backing.destroyed` flag is deliberately *not* exposed through the access object — "the module's raw scheduling carries no destroy gate, so the teardown test pins that a pending timer ignores this flag entirely". A bridge member you don't add is a dependency the effect can't accidentally grow.

## Why This Matters

The improvement claim of a bridge extraction is never the line count. It is:

- **Coupling becomes an explicit, named surface.** What was implicit closure capture over mutable flags and `$state` is now three typed interfaces (`SyncOrchestratorAccess` / `Deps` / `Init`) whose read/write census is visible in the declarations and enforced by source-shape pins. The component states its side of the contract in a comment at the literal; the module states its side in its doc comment.
- **Unit coverage where none could exist.** Branch orderings, the `syncing` bracket, echo tagging, timer conventions, identity preservation across reseeds — all previously observable only through e2e — are now provable in jest through the spy bridge, without Obsidian or a mounted component.
- **Metric deltas are bookkeeping, never the claim.** The 2026-08-27 Farley alignment audit's drift-guard is binding here: a source-level relocation is *not* a seam extraction, and any merely-relocated part of a move (the `dlog` call hooks, for instance) is annotated as relocation, not claimed as extraction. The genuine claim is the coupling cut plus the testability gain; GanttContainer shrinking from 4,000+ lines toward 2,500 across PRs #459–#463 is the receipt trail, not the argument.

## When to Apply

Use the live-accessor bridge when extracting **behavior-preserving coordination logic** out of a component that owns mutable state the logic must see live — flags read by multiple parties, rebindable handles, reactive `$state` that cannot leave the component — and when the caller may be a framework effect whose dependency tracking rides on the module's reads.

Do **not** use it for pure logic. If the logic can take data in and return decisions out, extract a pure module instead: `ganttSyncCoordinator.ts` is the standing counter-example — the dependency-free planning core beside the orchestrator, sanctioned by the division "the pure planning core stays in `ganttSyncCoordinator.ts`; what belongs here is the orchestration that carries timers, api access, and view-state reads". A bridge wrapped around pure logic is ceremony; live state crossing a pure seam is a bug. Split first, bridge only what's left.

## Examples

**Bare accessor vs snapshotting accessor** — the difference is one expression, and the failure is silent:

```ts
// RIGHT — live: every read sees the current flag, every write lands in the view
get syncing() { return syncing; },
set syncing(value) { syncing = value; },

// WRONG — snapshot: caught red by the shape pin's bareGetter matcher
get syncing() { return $state.snapshot(syncing); },
```

(`test/unit/ganttSyncEffectShape.test.ts` plants exactly this mutation and proves the matcher catches it.)

**Counting-getter fixture excerpt** — the bridge as calipers:

```ts
const reads = { syncing: 0, ephemeralSort: 0, api: 0, collapsedIds: 0 /* ... */ };
const access: SyncOrchestratorAccess<TestColumn> = {
  get ephemeralSort() { reads.ephemeralSort += 1; return backing.ephemeralSort; },
  set ephemeralSort(value) { events.push({ kind: 'set-ephemeral-sort', value }); backing.ephemeralSort = value; },
  get api() { reads.api += 1; return backing.api; },
  get collapsedIds() { reads.collapsedIds += 1; return backing.collapsedIds; },
  // ...
};
// NOOP branch = zero override reads; sync frame = at least one collapsedIds read:
expect(f.reads.ephemeralSort).toBe(0);
expect(f.reads.collapsedIds).toBeGreaterThanOrEqual(1);
```

**A liveness test that mutates the live supplier between calls** — the shape every liveness pin must take:

```ts
it('replays the live current data read at call time, not a wiring-time capture', () => {
  const f = makeFixture();
  f.orchestrator.restoreBaseOrder();                            // call 1: baseline data
  f.setCurrentData(syncSource({ instances: [inst('x'), inst('y')] }));  // mutate BETWEEN calls
  f.orchestrator.restoreBaseOrder();                            // call 2 must see the new rows
  const lastMove = f.execEvents().at(-1);
  expect(lastMove).toMatchObject({ action: 'move-task', payload: { id: 'y', target: 'x' } });
});
```

(The api-rebind twins in the same suite follow the same call–mutate–call rhythm.)

## Related

- `CONCEPTS.md` § Extraction seams — the canonical "live accessor bridge" vocabulary this doc elaborates.
- `docs/solutions/workflow-issues/run-behavior-neutral-refactoring-as-releasable-reviewed-slices.md` — the campaign process (slicing, landing cadence, characterization-first) this recipe's PRs followed; that doc covers *how units land*, this one covers *the bridge mechanics inside a unit*.
- `docs/solutions/integration-issues/svar-gantt-diff-sync-interactions.md` — the behavioral contract of the moved diff-sync code (echo semantics, bulk-reseed branch); note its code-location citations predate the extractions.
- `docs/solutions/architecture-patterns/resolve-config-defaults-at-one-seam.md` — the adjacent one-seam philosophy for config resolution.
- GitHub issue #354 — the Farley-aligned remediation campaign umbrella these extractions descend from (closed).
- Exemplars in source: `src/bases/svarInterceptors.ts` (PR #427), `src/bases/ganttSyncOrchestrator.ts` (PRs #461–#463), `test/unit/ganttSyncOrchestrator.test.ts`, `test/unit/ganttSyncEffectShape.test.ts`.
