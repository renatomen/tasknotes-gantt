---
title: "Fullscreen in an Obsidian plugin: maximize within Obsidian, not the native Fullscreen API"
date: 2026-07-01
category: docs/solutions/architecture-patterns
module: bases-gantt
problem_type: architecture_pattern
component: gantt-view
severity: high
root_cause: wrong_api
resolution_type: code_fix
applies_when:
  - "Building a fullscreen / maximize affordance for an Obsidian plugin view or panel"
  - "Obsidian modals, the command palette, context menus, or Notices are hidden behind your fullscreen UI"
  - "Choosing between the native browser Fullscreen API (or a library component that wraps it) and a CSS overlay"
  - "A position:fixed overlay fills only the workspace leaf instead of the whole window"
  - "One Escape press both closes a popup AND toggles your own view state"
tags: [obsidian, fullscreen, maximize, svar-gantt, stacking-context, top-layer, reparent, escape-capture]
---

# Fullscreen in an Obsidian plugin: maximize within Obsidian, not the native Fullscreen API

## Context

The Gantt view had a "Full screen" toggle built on SVAR's `<Fullscreen>` component (`@svar-ui/svelte-core`), which drives the **native browser Fullscreen API**. In full screen, every Obsidian popup vanished: double-clicking a bar to open the TaskNotes Edit Modal appeared to do nothing, and the command palette / context menus were unreachable. The only escape was to un-maximize first — paid on every edit.

This reverses an earlier decision. A prior iteration hand-rolled a CSS-overlay fullscreen, then replaced it with SVAR's official `<Fullscreen>` component under the principle "prefer the documented SVAR component; don't hand-roll." That principle is right *most* of the time — but it did not account for the popup-occlusion requirement, which the component structurally cannot satisfy. See the "when NOT to deviate" counter-case in [gantt-theme-toggle-bases-refresh-loop.md](../integration-issues/gantt-theme-toggle-bases-refresh-loop.md).

## Guidance

For a plugin "fullscreen" affordance, **maximize within Obsidian** instead of using the native Fullscreen API:

1. **Fill the Obsidian window with a CSS overlay in Obsidian's own stacking context** — `position: fixed; inset: 0` with a z-index anchored to Obsidian's modal-layer token, just beneath it: `z-index: calc(var(--layer-modal, 100) - 1)`. Include the fallback — `calc()` over an undefined var collapses to `auto`, which (as the last body child) would paint *above* modals, the exact opposite of the goal. This puts the view below Obsidian's modal/menu/notice/tooltip layers, so every popup renders above it for free.

2. **Promote the view's OWN root node to `document.body`** while maximized, and restore it on exit/teardown. A plain `position: fixed` overlay left in place is trapped when an Obsidian ancestor applies `transform`/`filter`/`contain` (then `fixed` resolves against that ancestor, filling only the leaf, not the window). Move only *your own* node — never Obsidian's modal/popover DOM.

3. **Auto-exit maximize when your leaf stops being active.** Because the root now lives on `document.body`, Obsidian's normal "hide the inactive leaf" no longer covers it — without this, switching tabs leaves the full-window view painted over a *different* tab. Subscribe to `active-leaf-change` and exit when a genuine other leaf becomes active. This also keeps only one view maximized at a time.

4. **Guard Escape in the CAPTURE phase, and let the chart flex below any toolbar** (see gotchas below).

## Why This Matters

The native Fullscreen API promotes one element's subtree to the browser **top layer** and paints *only* that subtree (plus its `::backdrop`). Obsidian's popups are plain high-`z-index` elements appended to `document.body` — **outside** the fullscreen subtree — so the browser does not render them at all. This is structural, not a `z-index` ordering bug you can out-stack. A library component that wraps the native API inherits this limitation no matter how it is styled.

A plugin almost never needs true OS/monitor fullscreen; filling the Obsidian window is enough. Once that is the goal, the native API earns nothing and costs popup visibility. Staying in Obsidian's own stacking context means the modal layer (already above the workspace by design) covers popups for free — the problem stops existing rather than being worked around per-popup.

## When to Apply

- Any "fullscreen / maximize / distraction-free" affordance in an Obsidian plugin view, panel, or leaf.
- When popups (Edit modals, command palette, suggesters, context menus, Notices) must remain usable while the view is maximized.
- Not when you genuinely need monitor-filling presentation mode that hides Obsidian's own chrome — that is the one case the native API is for, and it accepts the popup tradeoff.

## Examples

**Layering (CSS) — anchor to Obsidian's token, with a fallback:**

```css
.my-view.is-maximized {
  position: fixed;
  inset: 0;
  z-index: calc(var(--layer-modal, 100) - 1); /* below modals, above workspace */
  background-color: var(--background-primary);
}
```

**Promote own node to body to escape ancestor containment (capture the node so teardown restores even if `bind:this` nulled the ref; skip re-insert into a detached parent):**

```ts
function applyMaximizeDom(max: boolean): void {
  if (max) {
    const el = rootEl;
    if (!el || promotedEl) return;
    promotedEl = el;
    restoreParent = el.parentElement;
    restoreNextSibling = el.nextElementSibling;
    document.body.appendChild(el);
  } else {
    const el = promotedEl, parent = restoreParent, next = restoreNextSibling;
    promotedEl = restoreParent = restoreNextSibling = null;
    if (el && parent && parent.isConnected) parent.insertBefore(el, next); // no orphan
  }
}
```

**Gotcha — auto-exit on leaf deactivation, but ignore transient `null` leaves.** Obsidian emits `active-leaf-change` with `leaf = null` during modal-open / focus transitions; treating that as a tab switch exits maximize the instant a modal opens.

```ts
app.workspace.on('active-leaf-change', (leaf) => {
  if (!isMaximized()) return;
  const activeContainer = leaf?.view?.containerEl ?? null;
  if (!activeContainer) return;                          // transient/null — not a real switch
  if (restoreParent && activeContainer.contains(restoreParent)) return; // still our leaf
  exitMaximize();
});
```

**Gotcha — the modal-aware Escape guard must run in the CAPTURE phase.** A bubble-phase document listener is the *last* to see the event, by which point Obsidian has already closed the popup and removed `.modal-container` — so a "is a popup open right now?" check reads false and you exit maximize too. Capture runs first, top-down, while the popup is still in the DOM:

```ts
const handler = (e: KeyboardEvent) => {
  if (e.key !== 'Escape') return;
  if (document.querySelector('.modal-container, .menu, .suggestion-container, .hover-popover')) return;
  exitMaximize();
};
document.addEventListener('keydown', handler, true); // true = capture
```

**Gotcha — the maximized content must flex below any chrome, not take `height: 100%`.** If a toolbar sits above the chart in the fixed-height column and the chart is `height: 100%`, the two exceed the viewport and push the bottom (timeline + controls) off-screen. Drop the fixed height while maximized and let it take the remaining space: `.is-maximized .chart-area { flex: 1 1 0; min-height: 0; }`.

## Related

- Origin: [2026-06-30-gantt-maximize-popup-visibility-requirements.md](../../brainstorms/2026-06-30-gantt-maximize-popup-visibility-requirements.md) and [2026-06-30-002-feat-gantt-maximize-popup-visibility-plan.md](../../plans/2026-06-30-002-feat-gantt-maximize-popup-visibility-plan.md).
- The "when NOT to deviate from a SVAR component" counter-case: [gantt-theme-toggle-bases-refresh-loop.md](../integration-issues/gantt-theme-toggle-bases-refresh-loop.md).
- Shipped in PR #191 (commit `c42238d`); implementation in `src/bases/GanttContainer.svelte` and `src/bases/maximizeController.ts` (a DI, unit-tested state machine for enter/exit/Esc/teardown).
