---
module: bases-gantt
date: 2026-07-03
problem_type: integration_issue
component: frontend_stimulus
severity: medium
category: integration-issues
title: "Injected CSS loses the cascade to SVAR's Svelte-scoped component styles"
tags:
  - svar-gantt
  - css-specificity
  - svelte-scoped-styles
  - bar-treatment
  - theme-primitives
  - z-index
  - cascade
  - important
symptoms:
  - "Bar label rendered white where dark --text-normal was intended (SVAR .wx-task color won)"
  - ".wx-content left padding ignored because the component's scoped padding out-specified the injected rule"
  - "Left accent strip (::before) hidden behind SVAR's .wx-progress-wrapper fill as progress grew"
  - "Neutral strip-mode bar bodies invisible in low-contrast themes when surface vars collapsed onto the transparent chart background"
root_cause: scope_issue
resolution_type: code_fix
related_components:
  - tooling
  - documentation
---

# Injected CSS loses the cascade to SVAR's Svelte-scoped component styles

## Problem

Restyling SVAR Svelte Gantt bars from a plugin-injected stylesheet repeatedly failed *silently*: our rules load later in the document but still lose the cascade to SVAR's own component CSS. Svelte compiles SVAR's styles with a per-component hash class that raises their specificity above an un-hashed injected rule, so the fix reads as a render bug, not a CSS bug. It surfaced as a run of visual regressions while building the per-view bar color/icon feature (`src/bases/barTreatment.ts`).

## Symptoms

- Bar label rendered **white** where dark `--text-normal` was intended — SVAR's hashed `.wx-task:not(.wx-split)` color won.
- `.wx-content` left **padding ignored** — the component's scoped padding out-specified the injected rule.
- The left accent **strip (`::before`) disappeared** once progress grew — SVAR's `.wx-progress-wrapper` painted over it.
- Neutral strip-mode **bar bodies invisible** in low-contrast themes (Obsidian default, light *and* dark) — theme surface vars collapsed onto the chart background.

## What Didn't Work

- **Plain (non-`!important`) rules.** `.og-bases-gantt .wx-bar { color: var(--text-normal) }` — specificity `(0,2,0)` — was overridden by SVAR's hashed `.wx-task:not(.wx-split)` `(≈0,3,0)`, leaving white text on the light body. Same loss on `.wx-content` padding and `.wx-progress-percent` fill.
- **Assuming a `::before` paints above later siblings.** The strip was a `::before`, but SVAR's `.wx-progress-wrapper` is a *real child* at `z-index: auto` and a later sibling in paint order, so it painted over the strip. "It works at 0% progress" masked the bug.
- **Assuming theme surface vars differ from the editor background.** Coloring the body with `--background-secondary` / `--background-modifier-border` produced invisible bars where those vars collapse onto `--background-primary` — which is also the transparent chart's backdrop. Zero perceptual delta = no visible pill.
- **Fixed named palette hues for the theme source.** Hardcoded green/blue ignored the user's chosen accent and clashed with themes; replaced by deriving from `--interactive-accent`.
- **Guessing which rule won.** Round-trips of "add `!important` here, reload, still white?" without evidence. It only landed once we read `getComputedStyle(el)` and saw *which* selector actually supplied the value.

## Solution

The stylesheet is injected dynamically (a literal `<style>` in Svelte markup would be compiled to scoped component CSS and stripped of its dynamic content), anchored to one un-hashed selector — so every rule starts a specificity rung below SVAR:

```ts
// GanttContainer.svelte — one <style data-og-treatment> appended to the view root
let styleEl = rootEl.querySelector('style[data-og-treatment]') as HTMLStyleElement | null;
if (!styleEl) { styleEl = document.createElement('style'); styleEl.setAttribute('data-og-treatment', ''); rootEl.appendChild(styleEl); }
styleEl.textContent = css;

// barTreatment.ts
const BAR_SELECTOR = '.og-bases-gantt .wx-bar';   // (0,2,0) — one rung below SVAR's hashed rules
```

**1. `!important` on any property that fights a SVAR scoped rule** — the pragmatic way to beat Svelte's hash from an un-hashed sheet (`color`, `background-color`, `border`, `padding`):

```ts
function stripBodyRule(): string {
  return `${BAR_SELECTOR} { background-color: ${STRIP_BODY_COLOR} !important; ` +
         `color: ${STRIP_TEXT_COLOR} !important; ` +
         `border: 1px solid ${STRIP_BORDER_COLOR} !important; }`;
}
function stripContentPadRule(): string {
  return `${BAR_SELECTOR} .wx-content { padding-left: ${STRIP_CONTENT_PADDING_PX}px !important; }`;
}
```

**2. Set an explicit `z-index` on a pseudo-element layered over SVAR bars** — don't trust sibling/paint order. SVAR's real children sit in a defined stack (`.wx-progress-wrapper` at `z-index: auto`, `.wx-content` at `z-index: 2`); place the strip above progress, below content:

```ts
function stripRule(color: string): string {
  return `::before { content: ""; position: absolute; left: -1px; top: -1px; bottom: -1px; z-index: 1; ` +
         `width: ${STRIP_WIDTH_PX}px; background-color: ${color}; /* … */ }`;
}
```

**3. Derive colors from theme *primitives*, never surface vars** — anchor to `--text-normal` and `--background-primary` (which never collapse onto each other) for a guaranteed delta, and to `--interactive-accent` for the theme's own hue:

```ts
// fixed delta from the background → body/outline/progress always visible
function mixNeutral(pct: number): string {
  return `color-mix(in srgb, var(--text-normal) ${pct}%, var(--background-primary))`;
}
// tonal shift that keeps the hue (darker in light themes, lighter in dark)
function shiftToward(color: string, pct: number): string {
  return `color-mix(in srgb, ${color}, var(--text-normal) ${pct}%)`;
}
```

Parent vs child from a single accent is **one hue, two tones** (`THEME_CHILD_COLOR = var(--interactive-accent)`, `THEME_PARENT_COLOR = shiftToward(accent, 30)`) — not two named palette hues.

**4. Debug from ground truth: read `getComputedStyle(el)`.** When the user says "no change," open DevTools and read the *computed* value and which rule supplied it, instead of guessing. This revealed both root causes (the white-text specificity loss and the matching-background collapse) that blind iteration never surfaced.

## Why This Works

- **Specificity beats source order.** Both sheets target `.wx-bar`, but Svelte's hash class lifts SVAR to `(0,3,0)` while the injected rule sits at `(0,2,0)`; loading later doesn't help. `!important` jumps the injected declaration above normal-weight rules regardless of the hash. (It also lets treatment fills coexist with the date-status flag's own `!important` background.)
- **Paint order is defined, not incidental.** A pseudo-element paints as its host's first child, so a later real sibling (`.wx-progress-wrapper`) covers it. An explicit `z-index: 1` slots the strip into the exact layer between progress (`auto` → 0) and content (`2`).
- **`--text-normal` and `--background-primary` are opposite by definition**, so a `color-mix` between them yields a fixed perceptual delta in *any* theme — unlike `--background-secondary`, which is only coincidentally distinct from the primary background in some themes.

## Prevention

- **Any time you inject CSS to restyle SVAR `.wx-*` elements from outside its component CSS, expect to lose the cascade** — reach for `!important` (or a more specific anchor) on the contested property from the start.
- **Whenever you add a `::before`/`::after` over SVAR bars, set an explicit `z-index`** relative to SVAR's known layers (`.wx-progress-wrapper` auto, `.wx-content` 2) — never rely on sibling order.
- **Whenever a color must survive arbitrary Obsidian themes, build it from `color-mix` against `--text-normal` / `--background-primary`** (guaranteed delta) and `--interactive-accent` (theme hue). Never use `--background-secondary` / `--background-modifier-*` for something that must stay visible. Test at least one low-contrast theme (Obsidian default).
- **When a style "doesn't apply," confirm with `getComputedStyle` before changing code** — one read beats several reload cycles.
- This is the CSS instance of the standing rule *"don't deviate from SVAR's documented API without sign-off"*: prefer the documented component; when you must inject over SVAR, out-specify it deliberately rather than swapping its patterns (see the "heavy lines" cautionary precedent below).

## Related Issues

- [`tasknotes-status-palette-wrong-api-path.md`](tasknotes-status-palette-wrong-api-path.md) — the feature ancestor; its `og-status-*` injection mechanism and `statusColor.ts` are what `barTreatment.ts` generalizes. Different root cause (wrong API path), same injected-stylesheet subsystem.
- [`gantt-theme-toggle-bases-refresh-loop.md`](gantt-theme-toggle-bases-refresh-loop.md) — records a *rejected* hand-rolled CSS-class theme swap that caused a "heavy lines" regression by deviating from SVAR's documented theme component. This doc is the disciplined counterpart: fight the scoped selector with `!important`, don't swap SVAR's patterns.
- [`../tooling-decisions/svar-gantt-summary-type-constraints.md`](../tooling-decisions/svar-gantt-summary-type-constraints.md) — the parent/child bar story from the SVAR-`type` side; `og-parent` role classing and parent/child tone differentiation are its styling half.
- Adjacent: GitHub issue **#183** (open) — CSP blocks the injected `<style>` in some environments. Same injection subsystem, different failure mode (loading, not specificity).
