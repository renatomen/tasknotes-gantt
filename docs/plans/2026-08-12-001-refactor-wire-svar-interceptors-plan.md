---
title: "refactor: Extract the SVAR interceptor wiring out of the view"
date: 2026-08-12
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
---

# refactor: Extract the SVAR interceptor wiring out of the view

## Summary

Audit Tier-1 item 4 asks for the `api.intercept` registrations to move into
`wireSvarInterceptors(api, deps)`. Measured against the code, that is not a
move: `initGantt` is **327 lines with 10 intercepts and 22 outer bindings**,
and the handlers *write* several of them — `syncing`, `ephemeralSort`,
`pendingSingleClick`, `pointerButtonDown`, `lastCtrlMeta`, `hostGeneration`,
`collapsedIds`. Primitives captured in a `deps` object are copies, so a naive
extraction compiles, passes a smoke test, and silently stops suppressing echo
re-entry the first time a handler sets `syncing = true`.

So this ships as two units. U1 gives the mutable interaction state one owner
with a real name; U2 moves the wiring, which by then only needs that owner plus
the read-only collaborators.

**Not a line-count exercise.** The reach argument from #416 and #418 applies:
ten interception policies — echo suppression, drag veto, reorder blocking,
selection semantics, link authoring — are today provable only by launching
Obsidian. Behind a plain function they become jest-reachable.

---

## Requirements

- **R1** — A named state holder owns what the handlers mutate. Fields are
  accessed through it (`interaction.syncing = true`), never copied into locals,
  so a handler's write is visible to the next handler and to the view.
- **R2** — Behaviour is identical. No e2e spec is edited. The echo-suppression
  and drag-veto specs are the oracle: they already fail loudly when `syncing`
  or the veto stops working.
- **R3** — `wireSvarInterceptors(api, state, deps)` registers all ten and
  returns a teardown. `deps` carries only what the handlers READ (executors,
  `activateBar`, `restoreBaseOrder`, `readOnly`, `mode`, `cellEditColumnIds`,
  `OG_ECHO_SOURCE`).
- **R4** — Unit tests pin the policies that today have no unit coverage at all:
  an echo-sourced event is ignored while `syncing`; a derived-geometry row
  vetoes drag; `show-editor` is refused in read-only; a reorder is blocked when
  an ephemeral sort is active. A fake `api` recording `intercept` handlers is
  enough — the `themeResolver` fake-globals pattern is the precedent.
- **R5** — Each unit is mutation-checked: deleting a veto or an echo guard must
  fail a named test, not merely change a count.

---

## Key Technical Decisions

- **KTD1** — Two units, not one. The state extraction is the risky half and is
  worth reviewing on its own; bundling it with a 327-line move produces a diff
  nobody can read, and (measured today) one too large for the peer reviewer's
  30,000-byte ceiling.
- **KTD2** — A state OBJECT rather than getter/setter callbacks. Callbacks would
  preserve the current shape at the cost of twelve closures; an object states
  the truth — these fields are one piece of interaction state that several
  handlers share.
- **KTD3** — The intercepts stay registered from `initGantt`; only their bodies
  and the state move. Re-ordering registration risks changing which handler sees
  an event first, which is not a refactor.

---

## Implementation Units

### U1. Give the mutable interaction state an owner

**Files:** `src/bases/ganttInteractionState.ts` (new), `src/bases/GanttContainer.svelte`, `test/unit/ganttInteractionState.test.ts` (new).
**Approach:** define the holder, replace the seven mutable locals with fields, leave every handler in place. Nothing moves out of the view yet.
**Test scenarios:** a write through the holder is visible to a later reader; the initial state matches today's declarations.

### U2. Move the ten registrations

**Files:** `src/bases/wireSvarInterceptors.ts` (new), `src/bases/GanttContainer.svelte`, `test/unit/wireSvarInterceptors.test.ts` (new).
**Approach:** move handler bodies behind a fake-`api` seam; the view keeps a single call and the teardown.
**Test scenarios:** R4's four policies, each mutation-checked per R5.

---

## Verification Contract

Full jest; `npm run e2e:local` in full, with **no spec edited** — the echo,
drag-veto, column-sort and dependency specs are the behaviour oracle. Grep gate:
no `api.intercept` remains in `GanttContainer.svelte`.

## Definition of Done

Both units merged behind green CI, R1–R5 hold, residuals recorded.

## Scope Boundaries

- No change to what any interceptor decides — only where the code lives.
- No re-ordering of registrations (KTD3).
- The 1,440-line style block is slice 3, not this.

## Deferred to Implementation

- Whether `collapsedIds` belongs in the interaction holder or stays view-owned;
  it is read by rendering as well as by handlers.
