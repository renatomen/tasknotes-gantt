---
title: "Heavy diagnostic instrumentation on hot paths freezes the host (and masquerades as a scale problem)"
date: 2026-06-27
category: developer-experience
module: gantt-bases-register
problem_type: developer_experience
component: tooling
severity: high
applies_when:
  - "Adding temporary diagnostics to trace an Obsidian/Bases freeze, hang, or render loop"
  - "Tempted to call new Error().stack or JSON.stringify on a per-event or per-write path"
  - "Wrapping or replacing a host-app method (e.g. Bases config.set) to log its callers"
  - "A bug reproduces only on a large production vault, not the test vault or unit/e2e suite"
  - "About to defend a freeze as pre-existing scale before reading the actual base config"
symptoms:
  - "Obsidian freezes / becomes unresponsive when opening a page containing the view"
  - "Rows don't render (only indistinct text); mouse barely moves; eventually crashes"
  - "Freeze only on the large production vault; smaller test vault and CI suites are clean"
  - "Symptom amplified with DevTools open (F1 recurrence signature)"
resolution_type: code_fix
tags:
  - diagnostics
  - instrumentation
  - error-stack
  - hot-path
  - obsidian-bases
  - devtools-freeze
  - issue-161
  - guardrail
---

# Heavy diagnostic instrumentation on hot paths freezes the host (and masquerades as a scale problem)

## Context

While chasing a render-loop suspicion in the Gantt Bases view (#161), a prior session left **heavy diagnostic instrumentation in the working tree** — never committed, but carried into the installed build. The plugin then froze Obsidian on the maintainer's large real-world vault: rows wouldn't render (just indistinct text), the mouse barely moved, and Obsidian eventually crashed. It did **not** reproduce on the small test vault, in unit tests, or in e2e. The freeze *looked* like a scale/rendering problem but was caused entirely by the instrumentation.

The offending code in `src/bases/register.ts`:
- A wrapper replacing `config.set` to run `new Error().stack` + `JSON.stringify(value)` on **every** config write — and it lived for the config object's lifetime, so it fired on Bases' *own* internal writes during its persist/reload churn.
- `new Error().stack` on every view construct, every unload, and the first several `onDataUpdated` calls.

`new Error().stack` synchronously walks and string-formats the entire call stack; `JSON.stringify` of an unknown config value can be arbitrarily large. The real vault drives Bases to write config repeatedly during its persist/reload cycle, so these costs accumulated until the main thread was pegged. DevTools open made it worse.

This is the **second occurrence of the same class** — see the bug report's **F1** (a prior all-elements `console.log` dump that froze Obsidian only with DevTools open, with the standing warning "Never reinstate an all-elements `console.log`"). A class that recurs deserves a guardrail, not another one-off fix.

## Guidance

**Never ship or leave per-event diagnostic instrumentation that does expensive work in the hot path.** The cost of instrumentation is `O(expensive-operation) × O(event-frequency)`, and the event frequency is set by **real data volume**, not by your fixtures. Treat these as red flags inside any per-event handler, config hook, or wrapped third-party method:

- `new Error().stack` — synchronously captures and formats the full call stack. Cheap once; catastrophic per-event.
- `JSON.stringify` of large or unknown values — unbounded cost, and the value you stringify on a real vault is not the value you stringify on a fixture.
- Wrapping a hot third-party method (`config.set`, store setters, `emit`/`dispatch`) — you inherit *their* call frequency, including internal calls you don't control (Bases persist/reload churn).

Rules:
1. **Default off.** If you need this instrumentation, gate it behind an explicit, off-by-default debug flag — don't rely on remembering to remove it. (See `[[use-npm-run-build-installs-to-vault]]`-style "enforce with a mechanism, not memory".)
2. **Strip before install and before commit.** Diagnostics that escape into an installed build or a commit become the next person's mystery freeze.
3. **Prefer cheap, bounded signals.** A monotonic counter (`recompute seq`, `onDataUpdated #N`) makes a real loop observable *without* per-event stack capture or stringify.
4. **Assume the real vault exercises paths fixtures don't.** Event-volume-sensitive costs are invisible until real churn drives them.

```ts
// BEFORE — fires on every config write for the config's whole lifetime,
// including Bases' own internal writes during persist/reload.
const origSet = config.set.bind(config);
config.set = (key, value) => {
  console.log("[gantt] config.set", key, JSON.stringify(value), new Error().stack);
  return origSet(key, value);
};

// AFTER — wrapper removed entirely. Keep only a cheap, bounded counter
// elsewhere so a genuine loop is still visible:
console.log(`[gantt] onDataUpdated #${++this.dataUpdateSeq}`);
```

## Why This Matters

Per-event `new Error().stack` / `JSON.stringify` pegs the main thread, and the resulting freeze **looks exactly like a scale or rendering problem** — so you chase the wrong root cause. In this incident the first instinct was to blame the pre-existing "P2 render-scale freeze"; the actual cause was the instrumentation. The cost scales with real-vault event churn, not with code correctness, so it stays hidden in every test until a user hits it.

There is also a **debugging-discipline half**: when a freeze appears only on the real vault, *evidence beats theory*. Two cheap checks cracked this case faster than any scale hypothesis:
1. **Read the user's actual `.base` config** — every feature toggle was at its default, so the new feature code was provably inert and could not be the cause.
2. **Check git** — the heavy diagnostics were **uncommitted** working-tree leftovers, i.e. not part of the last build that worked.

Read the real config and diff committed-vs-working-tree **before** building a scale theory.

## When to Apply

- Writing or reviewing any diagnostic instrumentation, especially inside per-event handlers, config/store hooks, or wrappers around third-party methods.
- Immediately before `npm run build` / installing to a real vault, and before committing — strip or flag-gate diagnostics.
- When a "freeze" reproduces only on the real vault and not in fixtures/tests — suspect instrumentation cost and check `git status`/diff for uncommitted working-tree changes before theorizing about scale.

## Examples

**The offending wrapper (removed):** the before/after above — a `config.set` override doing `new Error().stack` + `JSON.stringify(value)` per write, plus `new Error().stack` at every construct/unload and the first ~6 `onDataUpdated` calls. Fix: delete the wrapper and all four stack-capture sites; keep only cheap counter logs; rebuild → Gantt loads, no freeze (user-confirmed).

**The contrast — cheap gated flags are fine.** The data-layer triangulation in `gantt-bases-getvalue-renotify-storm.md` used in-plugin diagnostic *flags* (`__OG_FREEZE`, `__OG_REUSE_TASKS`) as its durable artifact. Those are cheap and gated; the ban here is specifically on **heavy per-event capture** (`new Error().stack`, large `JSON.stringify`, hot-method wrappers), not on diagnostics in general.

## Related

- `../../bug-reports/2026-06-24-resultset-render-loop-161.md` — the prior occurrence: **F1** (§5, the 45k-element `console.log` dump) + §4 (DevTools-open amplification) + §13 ("`[OGDBG]` … strip before commit"). This doc generalizes that F1 footnote into a named recurring failure mode.
- `../architecture-patterns/view-display-options-in-presentation-not-derivation.md` — its "Diagnostic strip … DEFERRED" item names the exact `config.set` log wrapper that caused this freeze; this doc is why that deferred strip mattered.
- `match-harness-execution-model-to-bug-trigger.md` — sibling: a *false pass* from a harness aimed at the wrong trigger (the instrument lies to you).
- `gate-e2e-on-cold-index-before-measuring-render.md` — sibling: a *false failure* (cold-scan wait masquerading as a freeze). Same family — something non-bug presenting as a freeze.
- GitHub `#161` — the umbrella issue.
