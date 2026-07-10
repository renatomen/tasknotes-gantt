---
title: Rendering Obsidian markdown (wikilinks, tag pills) inside SVAR Gantt grid cells
date: 2026-07-10
category: design-patterns
module: bases-gantt
problem_type: design_pattern
component: frontend_stimulus
severity: medium
applies_when:
  - "Embedding Obsidian rich rendering (MarkdownRenderer) into a third-party UI library's mounted cells/components"
  - "A library component (e.g. a SVAR grid cell) receives a fixed prop set and cannot take the Obsidian App as a prop"
  - "Rendered links/tags must be clickable and Ctrl-hover previewable without triggering the host row/select handler"
  - "A classified/display value has lost the raw source needed to rebuild markdown"
  - "Render-type resolution must distinguish frontmatter columns from computed file./formula. columns with colliding names"
tags: [svar-gantt, obsidian, markdownrenderer, grid-cell, svelte-context, hover-link, wikilink, tag-pill]
---

# Rendering Obsidian markdown (wikilinks, tag pills) inside SVAR Gantt grid cells

## Context

SVAR Svelte Gantt renders each grid property cell through a small Svelte component that SVAR itself instantiates. We wanted those cells to show live Obsidian markdown — clickable wikilinks and tag pills — instead of the flat display text the grid already computed. That goal collides with three realities of the SVAR grid: (a) SVAR owns the cell component's props and passes almost nothing through, (b) the grid's classified value has already thrown away the raw markdown source, and (c) SVAR intercepts cell clicks to drive row selection and the app's activate handler. Getting Obsidian's `MarkdownRenderer`, link navigation, tag search, and Page Preview to work *inside* a foreign grid's virtualized cell required threading each of these needles. This note is the durable recipe for anyone integrating Obsidian rich rendering into a SVAR-mounted grid cell in this repo.

## Guidance

**1. Reach `app` through Svelte context, per-row data through `row.custom`.**
SVAR instantiates each cell component (`PropertyCell.svelte`) with only `{ api, row, column, onaction }`. There is no prop channel for the Obsidian `App`. Publish it once from the component that *does* own `app` — `GanttContainer` receives `app` as a prop — via Svelte context, and read it in the cell:

```ts
// GanttContainer.svelte (init)
setContext(GRID_APP_CONTEXT_KEY, app);

// PropertyCell.svelte
const app = getContext<App>(GRID_APP_CONTEXT_KEY);
```

Context crosses SVAR's mount boundary (verified by e2e). Anything that varies per row or per view — the source note path, the precomputed render descriptor — cannot ride on context; put it on `row.custom`, the one payload channel SVAR reliably passes through to the cell.

**2. Preserve the RAW value; build the markdown source from it, not from the typed value.**
The grid classifies each value into a `TypedValue` that keeps only display text (`"Sarah"`), having discarded the raw `[[Sarah]]`. `MarkdownRenderer` cannot rebuild a link from `"Sarah"`. So the render descriptor's markdown source must come from the raw extracted value, upstream of classification. Do it in a single build pass that emits *both* the render descriptor (for display) and the typed value (which still feeds the diff-sync fingerprint) — don't run classification twice.

**3. Intercept anchor clicks before SVAR sees them; run the native action yourself.**
A click inside a cell bubbles to SVAR's row handling, which fires `select-task` → the app's `onBarActivate` → the task modal. Left alone, clicking a rendered link opens the modal instead of navigating. The cell adds its own `click` listener and, when the target is inside `a.internal-link` or `a.tag`, calls `preventDefault()` + `stopPropagation()` (so the row handler never runs) and performs the action directly:

```ts
el.addEventListener('click', (event) => {
  const anchor = (event.target as HTMLElement).closest('a.internal-link, a.tag');
  if (!anchor) return; // fall through to SVAR row handler → modal
  event.preventDefault();
  event.stopPropagation();
  if (anchor.classList.contains('tag')) {
    const tag = anchor.textContent!.replace(/^#/, '');
    app.internalPlugins.getPluginById('global-search')
      ?.instance.openGlobalSearch(`tag:#${tag}`);
  } else {
    const linktext = anchor.getAttribute('href')!;
    app.workspace.openLinkText(linktext, sourcePath, event.ctrlKey || event.metaKey);
  }
});
```

Also swallow the anchor's `mousedown` (`stopPropagation`) so SVAR can't begin a row selection or drag on press. Non-anchor clicks are deliberately left alone — they fall through and open the modal, which is correct.

**4. Fire `hover-link` yourself for Page Preview.**
Ctrl-hover Page Preview only fires automatically for markdown inside a registered markdown view. For markdown rendered in a grid cell, add a `mouseover` listener that triggers the workspace event, passing the raw event through:

```ts
el.addEventListener('mouseover', (event) => {
  const anchor = (event.target as HTMLElement).closest('a.internal-link');
  if (!anchor) return;
  app.workspace.trigger('hover-link', {
    event, source: HOVER_SOURCE, hoverParent: { hoverPopover: null },
    targetEl: anchor, linktext: anchor.getAttribute('href'), sourcePath,
  });
});
```

Do not gate on `event.ctrlKey` yourself — the Page Preview plugin applies the user's configured modifier. Passing the raw event lets it decide.

**5. Gate frontmatter type-resolution to `note.*` columns.**
The decision of markdown-vs-conventional rendering, and tag-pill treatment, consults TaskNotes field types plus Obsidian's `metadataTypeManager` widget — but that lookup is keyed by property name, so it must apply ONLY to `note.*` (or unprefixed) columns. A `file.*` or `formula.*` computed column whose bare name collides with a frontmatter property (e.g. `formula.assignee` vs a frontmatter `assignee`) would otherwise inherit the frontmatter renderer and mis-render its computed value. Computed columns must resolve their treatment by value shape, never by name-based frontmatter lookup.

**6. Render into a fresh child each pass; clamp the row height.**
Own a per-cell Obsidian `Component`; unload it on teardown. Render with `MarkdownRenderer.render(app, source, el, sourcePath, ownerComponent)`. Because SVAR reuses cell DOM nodes across virtualized scroll, a render into the cell's own element can have a stale in-flight async render resolve into (and blank) a now-recycled live cell. Render into a *fresh child element* created each pass, so a stale render resolves into a detached child instead. Sanitize embeds/images/headings/code out of the source as the first line of defense, and clamp the cell to the fixed row height in CSS as the guarantee — so multi-value lists or stray block markdown can't grow the row.

## Why This Matters

Each of these is a silent trap, not a compile error. Skip the context bridge and there is simply no path to `app`. Render from the typed value and links quietly degrade to dead text. Miss the click interception and every link opens the wrong modal. Miss the `hover-link` trigger and preview silently never appears. Miss the frontmatter gate and a computed column silently mis-renders. Miss the fresh-child render and cells intermittently blank on scroll — the hardest of all to reproduce. The cost of getting each wrong is a subtly broken feature that passes unit tests, so the recipe has to be followed as a whole.

## When to Apply

Apply whenever you render Obsidian-owned content (markdown, links, tags, previews) inside a component that a third-party library mounts and controls — SVAR grid cells here, but the pattern generalizes to any foreign-mounted surface. Reach for it when: the cell needs `app` but the host won't pass it; the value you display and the value you must render differ; the host library has its own click/drag semantics on the same element; or the rendered content must participate in Obsidian navigation/preview. If you only need static text, none of this applies — keep the plain-text path.

## Examples

- **Link cell:** raw `[[Sarah Chen|Sarah]]` → descriptor source `[[Sarah Chen|Sarah]]`, typed value `"Sarah"`. Renders an `a.internal-link`; click → `openLinkText('Sarah Chen', sourcePath, false)`; ctrl-hover → `hover-link` → Page Preview popover.
- **Tag cell:** raw `area/work` (frontmatter tags store without `#`) → source `#area/work` → renders `a.tag`; click → `openGlobalSearch('tag:#area/work')`.
- **Computed collision:** a `formula.assignee` column with numeric output renders as its computed value, NOT as a frontmatter link, because the frontmatter type lookup is skipped for the `formula.*` prefix.

## Gotchas / Prevention

- **Two obsidian test doubles diverge.** This repo has a jest mock (`test/__mocks__/obsidian.ts`) AND a separate vitest isolated-perf shim (`test/perf/isolated/obsidian-shim.ts`) that the perf gate aliases `obsidian` to while mounting the real component. Adding a module-scope `import { MarkdownRenderer } from 'obsidian'` to a mounted component broke the perf gate (the shim lacked that export) while jest and typecheck stayed green — CI build failed. **Rule:** any obsidian value imported at module scope by the mounted-component graph must also be exported by the perf shim. Run `npm run perf:isolated` before pushing Svelte changes that add obsidian imports.
- **Don't gate hover on ctrl** — let Page Preview apply the user's modifier.
- **Don't forget `mousedown` suppression** on anchors — click interception alone lets SVAR still start a drag on press.
- **Verification that held:** 1165 jest tests, clean typecheck, and a real-Obsidian e2e (`test/specs/gantt-markdown-cells.e2e.ts`) asserting link→navigate, tag→search, and hover-link fires. Fresh-eyes + Codex-bot code review caught both the virtualized-scroll render race and the frontmatter-gate collision before merge — cheap to catch in review, expensive to catch in the field.

## Related

- [svar-gantt-diff-sync-interactions](../integration-issues/svar-gantt-diff-sync-interactions.md) — sibling SVAR-interaction doc; the `select-task`/`onBarActivate` modal path this cell-level click interception guards against, seen from the reseed-echo angle.
- [svar-gantt-column-sort-property-values-and-typing](../integration-issues/svar-gantt-column-sort-property-values-and-typing.md) — same `PropertyCell`/property-column surface (sorting + typing rather than rendering).
- [property-agnostic-field-resolution](../architecture-patterns/property-agnostic-field-resolution.md) — the field-resolution constraint the frontmatter type gate must honor (resolve via FieldMappings, never hardcode).
- [headless-e2e-verification-for-ui-work](../developer-experience/headless-e2e-verification-for-ui-work.md) — the WDIO verification methodology used to prove the click/hover behavior in real Obsidian.
- Shipped in PR #222 (squash `7022dc9`).
