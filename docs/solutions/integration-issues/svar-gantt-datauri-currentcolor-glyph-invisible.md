---
module: bases-gantt
date: 2026-07-03
problem_type: integration_issue
component: frontend_stimulus
severity: medium
category: integration-issues
title: "currentColor in a data-URI background-image SVG ignores the host color, so themed glyphs render black"
tags:
  - svar-gantt
  - currentcolor
  - data-uri-svg
  - background-image
  - css-mask
  - dark-mode
  - tree-toggle-chevron
  - panel-resizer
symptoms:
  - "Grid tree-toggle chevrons (parent expand/collapse) render near-black/invisible on the dark chart surface in dark mode"
  - "Panel Resizer arrows render near-black/invisible in dark mode"
  - "Setting color: var(--text-normal) on the element has no effect on the glyph — it stays black"
  - "Side-by-side proof: identical SVG paints BLACK via background-image+stroke='currentColor' but LIME via -webkit-mask+background-color: currentColor"
root_cause: wrong_api
resolution_type: code_fix
related_components:
  - documentation
---

# currentColor in a data-URI background-image SVG ignores the host color, so themed glyphs render black

## Problem

In dark mode, the SVAR Gantt grid tree-toggle chevrons (parent expand/collapse) and the panel Resizer arrows rendered near-black and invisible against the dark chart surface, and no amount of CSS `color` on the element fixed it. Because SVAR's icon webfont is disabled (`<Willow fonts={false}>`, CSP — see [`gantt-svar-icon-shortlist`](../../../CLAUDE.md)), the plugin re-implements these glyphs in CSS, and the chevrons used an inline-SVG data-URI as a `background-image` — a technique that structurally ignores the element's `color`.

## Symptoms

- Grid tree-toggle chevrons (`.wx-toggle-icon.wxi-menu-right` / `wxi-menu-down`) appeared black/invisible on the dark chart in dark mode.
- Panel Resizer arrows (`.wx-button-expand-content .wxi-menu-left/right`) had the same black-on-dark invisibility.
- Setting `color: var(--text-normal)` (or any other value) on the glyph element produced **zero** visible change.
- `getComputedStyle(el).color` reported the expected light value (e.g. `rgb(218,218,218)`) even though the painted glyph was still black — the property and the pixels disagreed.

## What Didn't Work

- **Changing the element `color` repeatedly** (`--text-muted` → SVAR's `#9fa1ae` → `--text-normal`): no visible effect, because a glyph painted via `background-image` never reads the element's `color`. (Side note: `#9fa1ae` is actually *darker* — luminance ~0.34 — than `--text-muted` `#b3b3b3` at ~0.45; `--text-normal` `#dadada` is ~0.69. The colour choices were also working against us.)
- **Trusting `getComputedStyle(el).color`:** reading `rgb(218,218,218)` was misleading — that reports the element's `color` *property*, not the painted fill of the glyph, which was black.
- **Assuming `currentColor` inside a `background-image` data-URI themes correctly in Obsidian's Chromium:** it does not. This exact theory was earlier waved away as a "red herring" in [`svar-shared-classname-selector-leak.md`](svar-shared-classname-selector-leak.md) (reasoning that the expanded chevron "already themes"); the side-by-side proof below shows it genuinely does not inherit.

## Solution

Paint the glyph as an alpha **mask** filled with the element's colour, not as a coloured background image.

**Before** (broken — `background-image` + `stroke='currentColor'`, ignores `color`):

```css
.wx-toggle-icon.wxi-menu-right::before {
  content: '';
  display: inline-block; width: 16px; height: 16px;
  background-image: url("data:image/svg+xml,%3Csvg ... stroke='currentColor' ... %3Cpath d='m9 18 6-6-6-6'/%3E%3C/svg%3E");
  background-size: contain; background-repeat: no-repeat; background-position: center;
  /* element sets color: var(--text-normal) — has no effect on the glyph */
}
```

**After** (fixed — `-webkit-mask` + `background-color: currentColor`, honours `color`):

```css
.wx-toggle-icon.wxi-menu-right::before {
  content: '';
  display: inline-block; width: 16px; height: 16px;
  background-color: currentColor;            /* the fill = element color (themed) */
  -webkit-mask-image: url("data:image/svg+xml,%3Csvg ... stroke='%23000' ... %3Cpath d='m9 18 6-6-6-6'/%3E%3C/svg%3E");
  mask-image: url("...same...");             /* stroke colour is irrelevant; mask uses alpha only */
  -webkit-mask-size: contain;     mask-size: contain;
  -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat;
  -webkit-mask-position: center;  mask-position: center;
}
/* element still sets color: var(--text-normal); the mask picks it up via currentColor */
```

The SVG's stroke can be any opaque colour (`%23000` is fine) — the mask consumes only the alpha channel, so the drawn colour is discarded and replaced by `background-color`.

**`::before` for chipped elements:** for an element that already carries its own background — such as SVAR's Resizer arrow chip (`background-color: var(--wx-gantt-border-color)`) — apply the masked glyph on a `::before` rather than masking the element itself, so the chip is preserved and only the glyph is recoloured.

Obsidian runs on Chromium, so `-webkit-mask` alpha masking is reliable. This is the **same** technique the plugin's `.wx-sort .wxi-arrow-*` sort-arrow rules already used (with the comment *"Mask (not background-image) so it inherits the themed text colour"*) — the lesson simply hadn't been generalised to the chevrons and Resizer.

## Why This Works

`currentColor` inside an SVG loaded as a `background-image` (or `mask-image`) resolves within the **SVG's own** document context, not the host HTML element's. A data-URI SVG referenced this way is an isolated document, so `currentColor` falls back to its initial value (black) and never sees the element's `color`. That is why setting `color` on the element did nothing.

The mask technique sidesteps this: the SVG is used only for its **alpha shape** (`mask-image`), and the visible pixels come from `background-color: currentColor`, which **is** a real CSS property on the host element and therefore does resolve `currentColor` to the element's themed `color`. `color: var(--text-normal)` then flows through to the painted fill, so the glyph tracks the Obsidian theme in both light and dark mode.

## Prevention

- **To recolour an inline-SVG glyph to a themed colour, use `mask-image` + `background-color: currentColor` — never `background-image` + `stroke='currentColor'`.** The latter cannot inherit the element's `color`; the former can.
- **When the host element has its own background** (button/Resizer chip), mask the glyph on a `::before` so the background is preserved.
- **Verify by the painted fill, not the `color` property.** `getComputedStyle(el).color` lies about what is on screen. Render both techniques side-by-side on a dark box with a known bright colour (e.g. `color: lime`) — the `background-image`+`currentColor` version stays black, the `mask`+`background-color: currentColor` version turns lime — and assert the `::before` `background-color` resolves to a real, non-transparent themed `rgb(...)` (a check the background-image approach structurally cannot pass). See `test/specs/gantt-collapse-chevron-contrast.e2e.ts` and `test/specs/gantt-resizer-arrow-contrast.e2e.ts`.
- **Reference implementation:** the existing `.wx-sort .wxi-arrow-*` rules in `src/bases/GanttContainer.svelte` are the canonical in-repo example of the correct mask pattern; match them for any new CSS-reimplemented glyph.
- **Scope caveat:** `background-image`+`currentColor` is acceptable *only* where the glyph sits on a light/white surface whose contrast is theme-independent (e.g. the toolbar `+`/`−`/zoom/edit/delete icons on white button chips). Anything that must adapt to the theme surface needs the mask.

## Related Issues

- [`svar-shared-classname-selector-leak.md`](svar-shared-classname-selector-leak.md) — the immediate predecessor on the SAME chevrons/Resizer arrows: it scoped the leaking selector but dismissed the `currentColor`-in-`background-image` theory as a red herring. This doc confirms that theory and switches the glyph paint to `mask` + `background-color: currentColor`.
- [`svar-gantt-injected-css-scoped-specificity.md`](svar-gantt-injected-css-scoped-specificity.md) — companion SVAR-CSS restyling learning (specificity + theme-primitive colours); this doc adds the paint-mechanism rule for recolouring inline-SVG glyphs. Together the two are the "restyle SVAR `.wx-*` from an injected stylesheet" pair: one about a selector too *weak* (beat with `!important`), one about the *paint mechanism* (`currentColor` unreachable in background-image → switch to mask).
- [`gantt-theme-toggle-bases-refresh-loop.md`](gantt-theme-toggle-bases-refresh-loop.md) — adjacent dark/light-mode SVAR issue (a refresh loop, not a colour bug).
- [`svar-gantt-gridwidth-divider-persistence.md`](svar-gantt-gridwidth-divider-persistence.md) — the Resizer (`.wx-button-expand-content`) from its behaviour/persistence side; this doc recolours its arrow glyph. Shipped together in PR #207.
