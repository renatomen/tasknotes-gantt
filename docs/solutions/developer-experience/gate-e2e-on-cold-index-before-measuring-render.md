---
title: "Gate real-Obsidian e2e on cold-index completion before measuring render"
date: 2026-06-25
category: developer-experience
module: gantt-perf-harness / e2e testing
problem_type: developer_experience
component: testing_framework
severity: medium
applies_when:
  - Writing a real-Obsidian WDIO e2e or perf spec that opens a view over a freshly-generated or large vault
  - The vault is regenerated every run (rmSync + emit) so the metadataCache scan and TaskNotes index are always cold
  - Asserting render output or timing after enabling plugins that index asynchronously (Bases, TaskNotes)
symptoms:
  - Spec renders zero .wx-bar within a 150-240s timeout and looks like a render freeze
  - The same render path passes fine on a small (5-note) fixture
  - The timeout scales with vault size — a tell that the wait is racing the cold scan, not a real hang
related_components:
  - development_workflow
  - tooling
tags:
  - e2e
  - wdio-obsidian
  - metadatacache
  - cold-index
  - async-timing
  - tasknotes
  - perf-harness
  - render-freeze
---

# Gate real-Obsidian e2e on cold-index completion before measuring render

## Context

The perf-harness full-stack spec (`test/specs/gantt-perf-fullstack.perf.e2e.ts`) runs the Gantt over a **generated** vault that is rebuilt from scratch on every run — the `before` hook does `fs.rmSync` and re-emits thousands of notes, with no persisted `.obsidian` workspace or cache. The consequence is structural, not incidental: Obsidian's `metadataCache` scan and TaskNotes' index build are **always cold**, and for a multi-thousand-note vault that cold pass costs *minutes*, not milliseconds. A warm vault resolves these sub-second — but a hermetic, regenerated vault is never warm.

The trap is the **false signal**. A timeout while waiting for `.wx-bar` to appear looks identical to a render freeze: same selector, same `waitUntil`, same red. The original spec opened the `.base` immediately after enabling Bases and waited a single blind 240s for bars. The Gantt takes a **one-shot, open-time snapshot** of its data; opening mid-index meant it snapshotted a half-built cache (0 matched tasks / partial relationships), rendered nothing, and never backfilled. The wait then expired *mid-scan* and presented as a render freeze — which fooled the author into half-attributing it to the known Electron `#161` freeze the harness exists to surface. The conflated measurement manufactured a false performance verdict.

## Guidance

**Gate on indexing-complete BEFORE starting any render/assertion clock. Never reuse one blind timeout for both indexing and rendering.** Split the wait into two phases with two budgets: a *generous* index budget and a *tight* render budget.

Use two observable signals that indexing is genuinely done:

- **Signal 1 — TaskNotes API is up** (`api.lifecycle.ready()` resolves). Necessary but **not** sufficient: "ready" does not mean the metadata cache behind it has finished building.
- **Signal 2 — Obsidian's cold metadataCache scan has finished**: every markdown file has a resolved cache entry. `getFileCache(f)` stays `null` until that file is indexed, so `getMarkdownFiles().every(f => getFileCache(f) !== null)` is a reliable "the cold scan completed" gate.

Only after both hold do you open the base and start the render clock against a tight budget. A timeout *there* now means a real render problem — cleanly separated from cold-scan latency.

The actual two-phase `before` hook (commit `80b5f3c`):

```ts
const INDEX_TIMEOUT_MS  = Number(process.env.PERF_INDEX_TIMEOUT_MS  ?? 420000); // generous
const RENDER_TIMEOUT_MS = Number(process.env.PERF_RENDER_TIMEOUT_MS ?? 60000);  // tight

// ---- Phase 1: wait out COLD indexing (NOT yet on the render clock) ----
const indexStart = Date.now();

// Step 1: TaskNotes API up.
await browser.waitUntil(
  async () => browser.executeObsidian(async ({ app }) => {
    const tn = (app as any).plugins?.getPlugin?.("tasknotes");
    if (!tn?.api) return false;
    try { await tn.api.lifecycle?.ready?.(); return true; } catch { return false; }
  }),
  { timeout: INDEX_TIMEOUT_MS, interval: 1000, timeoutMsg: "TaskNotes API did not become ready" }
);

// Step 2: cold metadataCache scan finished — every md file has a resolved entry.
await browser.waitUntil(
  async () => browser.executeObsidian(({ app }) => {
    const files = app.vault.getMarkdownFiles();
    if (files.length === 0) return false;
    return files.every((f) => app.metadataCache.getFileCache(f) !== null);
  }),
  { timeout: INDEX_TIMEOUT_MS, interval: 1000, timeoutMsg: "metadataCache cold scan did not finish in time" }
);
console.log(`[PERF-E2E] cold index complete in ${Date.now() - indexStart}ms`);

// ---- Phase 2: NOW measure RENDER against a tight budget ----
const renderStart = Date.now();
await browser.executeObsidian(async ({ app }) => {
  const file = app.vault.getAbstractFileByPath("Generated.base");
  if (file) await app.workspace.getLeaf(true).openFile(file as never);
});
await browser.waitUntil(
  async () => (await $$(".og-bases-gantt .wx-bar")).length > 0,
  { timeout: RENDER_TIMEOUT_MS,
    timeoutMsg: `Indexing finished but the Gantt rendered no bars within ${RENDER_TIMEOUT_MS}ms — a real render problem, not a cold scan.` }
);
console.log(`[PERF-E2E] time-to-first-render (post-index): ${Date.now() - renderStart}ms`);
```

Gate on the signal your assertion **actually consumes**, not merely on "API ready." This render spec gates on "all files cached" — and, once Show-all expansion became part of what it measures, it earned a **third** gate: it now also waits until TaskNotes' `relationships` resolve, because a warm metadataCache does not imply a warm relationship index. Each new thing the assertion consumes earns its own gate. The sibling `gantt-dependency-types.e2e.ts` needs a deeper signal for the same reason — it waits until TaskNotes' `relationships.dependencies` resolve each dependent's `blockedBy` wikilink to a real predecessor *path*, because (per its own comment) "the metadata cache finishes building **asynchronously** after the API reports ready."

## Why This Matters

- **A conflated measurement manufactures false verdicts.** One blind timeout spanning cold-scan + render cannot distinguish "still indexing" from "frozen" — both expire identically. Here it cost real diagnostic effort and nearly mis-filed the result against an unrelated Electron freeze (`#161`).
- **A tight, post-index render budget makes a *real* freeze detectable.** Once indexing is provably done, a 60s render timeout *means something* — it can only be a render problem. The measurement becomes load-bearing instead of noise. (Verdict at 2000 tasks / 4000 notes: cold index ~25s, render ~3s, virtualization holds at a 15-row window — no freeze.)
- **Hermetic, regenerated vaults are always cold by construction.** Because the harness `rmSync`s and rebuilds every run with no persisted cache, this is not a one-off startup hiccup you can sleep past — it is a permanent property of the test design, so the gate must be structural too.

## When to Apply

Any WDIO / real-Obsidian e2e that:

- opens a `.base` or a view over a **generated or large** vault, especially one regenerated per run (`rmSync` + emit, no persisted `.obsidian`); or
- asserts **render output or timing** after enabling plugins that index **asynchronously** (Bases, TaskNotes — anything built off `metadataCache`); or
- consumes data (bars, dependency arrows, matched sets) from a component that takes a **one-shot open-time snapshot** rather than continuously backfilling.

If any hold, separate the index-wait phase from the render/assertion phase with two distinct budgets.

## Examples

**Before** — one blind wait; base opened too early; the snapshot races a half-built cache:

```ts
const RENDER_TIMEOUT_MS = Number(process.env.PERF_RENDER_TIMEOUT_MS ?? 240000);
const start = Date.now();
await browser.executeObsidian(async ({ app }) => {
  const file = app.vault.getAbstractFileByPath("Generated.base");
  if (file) await app.workspace.getLeaf(true).openFile(file as never); // opens mid-index
});
await browser.waitUntil(
  async () => (await $$(".og-bases-gantt .wx-bar")).length > 0,
  { timeout: RENDER_TIMEOUT_MS,
    timeoutMsg: `... did not render any task bars within ${RENDER_TIMEOUT_MS}ms (TaskNotes indexing too slow?)` }
);
firstRenderMs = Date.now() - start; // cold-scan latency + render, conflated → reads as a freeze
```

**After** — index-wait phase (generous budget, two signals) → tight render phase. See the Guidance code block. The canonical precedent is `test/specs/gantt-dependency-types.e2e.ts` (the `before` hook ~lines 146–198): Step 1 `lifecycle.ready()`, Step 2 a de-flake gate that waits until `blockedBy` edges resolve to predecessor paths before opening the base.

## Related

- [match-harness-execution-model-to-bug-trigger.md](./match-harness-execution-model-to-bug-trigger.md) — sibling from the same #161/PR #162 harness work, the complementary failure mode: this doc is a false *failure* (a still-indexing wait masquerades as a freeze — measurement contamination); that one is a false *pass* (a clean run on a trigger the harness can't even exercise).
- [headless-e2e-verification-for-ui-work.md](../developer-experience/headless-e2e-verification-for-ui-work.md) — sibling: what the WDIO harness *can* verify; this doc supplies the missing precondition (gate the clock) that makes those assertions trustworthy over large/generated vaults.
- [windows-build-and-e2e-environment-setup.md](../developer-experience/windows-build-and-e2e-environment-setup.md) — prerequisite: getting the WDIO + `wdio-obsidian-service` harness running (Node 20, AV cert, `OBSIDIAN_TEST_VAULT`).
- [gantt-theme-toggle-bases-refresh-loop.md](../integration-issues/gantt-theme-toggle-bases-refresh-loop.md) — same instrument-the-boundary discipline (log each boundary, drive real Obsidian) used here to tell a cold scan apart from a real freeze.
- [test-at-the-fastest-level-not-redundant-e2e.md](../tooling-decisions/test-at-the-fastest-level-not-redundant-e2e.md) — counterbalance: push coverage to the fastest reliable level; when a real-Obsidian e2e genuinely *is* the right level, this is how to keep it deterministic.
- [readiness-signal-keys-on-data-its-consumer-reads.md](../design-patterns/readiness-signal-keys-on-data-its-consumer-reads.md) — the in-product generalization of this doc's "gate on the signal your assertion actually consumes" rule: a product-logic readiness signal must key on exactly the data its (mode-conditional) consumer reads, not an OR across sources.
- GitHub `#161` (open) — the render-freeze investigation that motivated the harness. `#98` (closed) — the canonical sibling: e2e racing TaskNotes indexing; documented as the leaf-steal de-flake (auto memory [claude] `dependency-e2e-flake`), same async-metadataCache root family as this learning.
