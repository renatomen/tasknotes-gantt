---
title: Assertion-preserving type-repair idioms for the jest tree — and the fake-timer capture trap
date: 2026-08-17
category: conventions
module: jest test tree (tsconfig.test-unit program)
problem_type: convention
component: testing_framework
severity: high
applies_when:
  - "Repairing type errors in test/unit, test/__mocks__, or test/perf/generator (the tsconfig.test-unit program)"
  - "A jest matcher generic like toEqual<T>(y) fails TS2558 under the merged jest/wdio ambient types"
  - "A test needs mock-only surface the real obsidian types lack (FakeElement, Notice.created, WorkspaceLeaf.lastState)"
  - "A test aliases or wraps a global timer function"
tags: [jest, typecheck, assertion-preserving, mock-bridge, satisfies, fake-timers, type-repair]
---

# Assertion-preserving type-repair idioms for the jest tree — and the fake-timer capture trap

## Context

U2 of the test-tree typecheck plan (PR #432) repaired 132 latent type errors across 36 jest-tree files under the plan's R3 rule: every repair preserves or strengthens what the test asserts. Four idioms did almost all of that work, and one plausible-looking repair shape turned out to *create* the false-green class the campaign exists to close — caught by the local review layer and proven by mutation-check. These are the idioms U3/U4 and any future test-tree type repair should reach for first.

## Guidance

**1. Matcher generics → `satisfies`.** The unit program merges `@types/jest` with expect-webdriverio's global `expect` (via the R1-mandated `@wdio/globals/types` entry — see the partition doc below), and the wdio matcher signature wins, so `expect(x).toEqual<T>(y)` fails TS2558. The sanctioned rewrite is:

```ts
expect(chips).toEqual(expected satisfies ListChip[]);
```

`satisfies` performs the identical compile-time check the generic did, with zero runtime change. Do not delete the type argument without replacing it — that silently drops the static shape check.

**2. Mock-only surface → type-only import + narrow bridge.** Properties that exist on the manual mock but not the real obsidian types (`FakeElement`, `Notice.created`, `WorkspaceLeaf.lastState`) are typed against the mock's *real exported type*, keeping the runtime import from `'obsidian'` so jest's moduleNameMapper still applies:

```ts
import type * as MockObsidian from '../__mocks__/obsidian';
const MockNotice = Notice as unknown as typeof MockObsidian.Notice;
```

Never a hand-written inline shape (it duplicates the mock and drifts), never `any`. The bridge types the same runtime object jest already substitutes.

**3. Closure-narrowing false-`never` → call-time function read.** A `let queued: Plan | null = null` assigned only inside callbacks narrows top-level reads to `null`, so `queued?.writes` lands on `never` (TS2339). Restore the declared type with a call-time read, not a cast:

```ts
const plannedQueued = () => queuedPlan;
expect(plannedQueued()?.writes).toEqual([...]);
```

Runtime-identical — it reads the same closure variable at the same point in execution.

**4. THE TRAP — never alias a timer global at module scope.** This looks like a harmless typing fix and is the one repair shape that vacates assertions:

```ts
// WRONG: captures the NATIVE setTimeout at module load, BEFORE
// jest.useFakeTimers() installs fakes — timers become invisible to
// jest.runAllTimers(), and `expect(stale).not.toHaveBeenCalled()`
// passes even with the production clear-guard deleted.
const scheduleTimeout: (cb: () => void, ms: number) => ReturnType<typeof setTimeout> = setTimeout;

// RIGHT: call-time wrapper — resolves the global at invocation,
// after fake timers are installed. Same overload pin.
const scheduleTimeout = (cb: () => void, ms: number): ReturnType<typeof setTimeout> =>
  setTimeout(cb, ms);
```

Caught live in `test/unit/svarInterceptors.test.ts` on PR #432 (review finding #1) and proven by mutation-check: with the alias, all tests stayed green after neutering the production `clearTimeout` guard in `src/bases/svarInterceptors.ts`; with the wrapper, four tests fail. Any repair that touches a timer, clock, or scheduler binding gets this mutation-check before it is trusted.

## Why This Matters

Type repairs sit exactly on the seam the typecheck campaign polices: a repair that satisfies the compiler by weakening what a test proves converts a loud gap into a silent one. Idioms 1–3 are mechanical and safe; the trap in idiom 4 shows why "compiles and stays green" is not the acceptance bar — the mutation-check ("can this test still fail when the guard it names is broken?") is.

## When to Apply

- Any type-error remediation batch in the test tree (U3's e2e repairs, drift repairs after U4 wires the gate).
- Any new test that needs mock-only obsidian surface or aliases a global.
- Review of such diffs: an inline mock shape, a bare `any`, a deleted matcher generic, or a module-scope timer alias is a finding.

## Examples

All four idioms in applied form are in PR #432's diff: `test/unit/propertyValues.test.ts` (satisfies), `test/unit/externalCalendarDegradeNotice.test.ts` (mock bridge), `test/unit/dragExecutor.test.ts` (call-time reads), `test/unit/svarInterceptors.test.ts` (the trap and its fix).

## Related

- `docs/solutions/tooling-decisions/test-tree-typecheck-three-program-partition.md` — why the ambient type worlds are merged in the unit program and which `types` entries are load-bearing.
- `docs/solutions/best-practices/a-test-name-is-a-claim-verify-the-mutation.md` — the mutation-check discipline idiom 4's proof followed.
