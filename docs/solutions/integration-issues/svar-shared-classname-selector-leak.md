---
module: bases-gantt
date: 2026-07-03
problem_type: integration_issue
component: frontend_stimulus
severity: medium
category: integration-issues
title: "Unscoped .wx-*/.wxi-* selectors leak across SVAR components that reuse the class"
tags:
  - svar-gantt
  - css-selector-scope
  - class-name-collision
  - tree-toggle
  - resizer
  - dark-mode
  - theming
symptoms:
  - "Collapsed parent-task chevron nearly invisible in dark mode; fine in light mode"
  - "Collapsed chevron a different colour/contrast than the expanded chevron (asymmetric)"
  - "getComputedStyle on the collapsed toggle shows a hardcoded stroke='%235f6368' background-image at 20px (the Resizer size), not the 16px themed tree glyph"
root_cause: scope_issue
resolution_type: code_fix
related_components:
  - documentation
---

# Unscoped `.wx-*`/`.wxi-*` selectors leak across SVAR components that reuse the class

## Problem

SVAR Svelte Gantt reuses the same icon class name across unrelated components. A plugin CSS rule written for one component — anchored only on the shared class (`.og-bases-gantt :global(.wxi-menu-right)`) — silently also styles the *other* component. The collapsed grid tree toggle picked up a hardcoded, non-theme-adaptive gray chevron meant for the grid Resizer's panel-collapse arrow, making it low-contrast in dark mode and mismatched with the expanded toggle.

## Symptoms

- In **dark mode**, the collapse chevron on collapsed parent tasks was almost indistinguishable from the background.
- Its colour/contrast differed from the **expanded** chevron — an asymmetry, since both are the same control in different states.
- In **light mode** the two matched, so the bug read as dark-mode-only.

## What Didn't Work

- **Reading the two tree-toggle rules in isolation.** `.wxi-menu-down::before` and `.wxi-menu-right::before` are symmetric (same technique, only the SVG path differs), so the CSS *looked* like it should render both chevrons identically. The asymmetry was invisible until the search was widened to *every* rule matching `wxi-menu-right`.
- **Theorizing about `currentColor` in a data-URI `background-image`.** Time went into whether `stroke='currentColor'` inside a background-image SVG themes or resolves to black. It was a red herring: the reported fact that the *expanded* chevron renders correctly in dark mode already proves the themed `::before` path works — so the only thing that could differ was an *extra* rule on the collapsed state.

## Solution

The collapsed tree toggle and the Resizer arrow are both `<i class="… wxi-menu-right">`, but in different containers:

```
grid tree toggle : <i class="wx-toggle-icon wxi-menu-{down|right}">   (TextCell.svelte)
resizer arrow    : .wx-button-expand-content > <i class="wxi-menu-right">   (Resizer.svelte)
```

The OG-82 Resizer rule was unscoped, so it matched both:

```css
/* BEFORE — matches the tree toggle too, painting a hardcoded gray element background */
.og-bases-gantt :global(.wxi-menu-right) {
  background-image: url("data:image/svg+xml,…stroke='%235f6368'…");  /* fixed, non-theme */
}
```

Scope the Resizer rules to the Resizer's own container so they can't reach the tree toggle, which then renders through the SAME themed `::before` path as the expanded toggle:

```css
/* AFTER — Resizer-only; the tree toggle falls through to its themed ::before */
.og-bases-gantt :global(.wx-button-expand-content .wxi-menu-right) {
  background-image: url("data:image/svg+xml,…stroke='%235f6368'…");
}
```

The expanded toggle (`wxi-menu-down`, which the Resizer never uses) was never affected — which is exactly why the bug was asymmetric.

## Why This Works

- The fix reduces the collapsed toggle to the **identical rendering path as the already-correct expanded toggle**. Whatever makes `wxi-menu-down` render right in both themes now also governs `wxi-menu-right`, so correctness follows by construction — no need to resolve *how* the themed `::before` inherits its colour.
- The hardcoded `#5f6368` reads similar to muted text on a light background (coincidental match) but is low-contrast on a dark one — so removing the leak, not recolouring it, is the root-cause fix.

## Prevention

- **Scope every `:global(.wx-*)` / `:global(.wxi-*)` rule to a container** (`.wx-button-expand-content …`, `.wx-toggle-icon …`, etc.), never to a bare SVAR class. SVAR reuses class names (`wxi-menu-right`, `wx-icon`, `wx-content`) across unrelated components; a bare-class selector is a latent cross-component leak. This file has dozens of such rules — audit them for breadth, not just specificity.
- **When a symptom is asymmetric between two states of the same control, widen the search to _every_ rule matching the varying class**, not just the obvious pair. The extra, unintended match is usually the culprit.
- **Regression-test CSS cascade in the real renderer.** A Jest/jsdom test can't evaluate stylesheets; the fastest reliable level is an e2e that injects the exact glyph classes into the live `.og-bases-gantt` and reads `getComputedStyle(...).backgroundImage`. See [`test/specs/gantt-collapse-chevron-contrast.e2e.ts`](../../../test/specs/gantt-collapse-chevron-contrast.e2e.ts) — it asserts the collapsed element carries no `5f6368` leak and resolves to the same element background as the expanded one.

## Related Issues

- [`svar-gantt-injected-css-scoped-specificity.md`](svar-gantt-injected-css-scoped-specificity.md) — the complementary SVAR-CSS failure mode: an injected un-hashed rule losing the *specificity* cascade to SVAR's Svelte-hashed styles. That doc is about a selector being too *weak*; this one is about a selector being too *broad*. Same subsystem (restyling SVAR `.wx-*` from the plugin stylesheet), different root cause.
- [`svar-gantt-gridwidth-divider-persistence.md`](svar-gantt-gridwidth-divider-persistence.md) — the Resizer (`.wx-button-expand-content`) from its behaviour/persistence side.
