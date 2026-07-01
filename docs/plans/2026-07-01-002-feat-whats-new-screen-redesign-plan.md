---
date: 2026-07-01
topic: whats-new-screen-redesign
status: active
type: feat
origin: docs/brainstorms/2026-07-01-whats-new-screen-redesign-requirements.md
---

# feat: What's New screen redesign (TaskNotes-style release cards + history backfill)

## Summary

Rework the in-app "What's New" view ([src/release/ReleaseNotesView.ts](../../src/release/ReleaseNotesView.ts)) into TaskNotes-style collapsible release cards — prominent version, right-aligned chevron, human-formatted date, filled "Current" pill, short GitHub/star intro — styled from Obsidian theme variables in a real stylesheet rather than imperative inline styles. Backfill release-notes files for `0.1.0-beta.1/2/3` so the generated bundle carries the full `0.1.x` history newest-first.

---

## Problem Frame

The maintainer recorded TaskNotes' "What's New" screen as a reference and asked the Gantt plugin's screen to match it (see origin: [requirements](../../docs/brainstorms/2026-07-01-whats-new-screen-redesign-requirements.md)). The view already exists and already uses native `<details>`/`<summary>` collapsible sections, so this is visual-parity + content work, not a rebuild:

- **Formatting.** The view styles itself with imperative inline `el.style.*` assignments and unbacked `tng-release-*` classes — no stylesheet exists. The native disclosure triangle sits on the left, the "Current" state is faded text, and the date renders as a raw ISO string. The reference uses bordered cards, a right-aligned chevron, a filled accent "Current" pill, and a formatted date.
- **History.** Only `docs/releases/0.1.0-beta.4.md` exists, so the generated bundle has a single entry — nothing to scroll. The earlier betas have git tags but no release-notes files.

---

## Requirements

Carried from origin (R-IDs preserved):

- **R1** Bordered, collapsible cards matching the reference: summary row with prominent version, date, right-aligned chevron. → U3, U4
- **R2** Collapsible mechanism stays accessible (native disclosure, restyled not replaced). → U4
- **R3** Card styling derives from Obsidian theme variables; no hardcoded colors. → U3
- **R4** Exactly one release marked "Current", shown as a filled badge/pill. → U3, U4
- **R5** Each card shows its date, human-formatted (`Month D, YYYY`) from the stored ISO date. → U2, U4
- **R6** Releases ordered newest-first (semver-aware); older collapsed by default, current + first prior expanded. → U1 (bundle order), U4 (expand)
- **R7** View lists every release in the bundle, scrollable newest→earliest. → U1, U4
- **R8** Release-notes files exist for `0.1.0-beta.1/2/3` (beta.4 exists), authored in the generator's format. → U1
- **R9** Short intro paragraph above the cards with feedback / GitHub / star links. → U4
- **R10** Existing footer ("View all releases on GitHub" + reopen hint) retained. → U4

---

## Key Technical Decisions

- **Keep the native `<details>` disclosure; restyle with CSS.** Preserves the keyboard/screen-reader support the view deliberately chose ([ReleaseNotesView.ts](../../src/release/ReleaseNotesView.ts) header comment). The right-aligned chevron is achieved by hiding the default marker and drawing a themed chevron via CSS on `summary`, not by replacing the element.
- **Styling lives in a stylesheet keyed on `tng-release-*` classes, driven by Obsidian theme tokens.** Move the imperative inline styles into CSS. Use `--background-modifier-border` (card border/dividers), `--background-secondary`/`--background-primary` (surfaces), `--text-muted` (date) / `--text-normal` (body), `--interactive-accent` + `--text-on-accent` (the "Current" pill and chevron accent), `--radius-m`/`--radius-s`. This follows the data-formatting/presentation conventions and — critically — avoids the documented "heavy lines" regression that hand-picked border styling caused before (see origin + docs/solutions/integration-issues/gantt-theme-toggle-bases-refresh-loop.md). Border weight is the known risk; keep it token-driven and have the maintainer eyeball it before merge.
- **Format the date in a pure module, keep ISO raw in the bundle.** Add `formatReleaseDate(iso)` as a standalone, unit-tested function ([data-formatting.md](../../docs/conventions/data-formatting.md): adapters extract raw, views format). The generator continues to emit the raw ISO `date` (or `null`); the view formats for display.
- **Backfill is `0.1.x`-complete, not cross-minor.** The generator's `selectBundle` only bundles the current minor + previous minor. All betas are minor `1`, so backfilling `beta.1/2/3` fully satisfies "history back to the earliest beta" today. Widening the window so history survives across future minors is out of scope (see Scope Boundaries).
- **Do not hand-edit `src/releaseNotes.ts`.** It is generated at Vite `buildStart` and staged by `npm version`; author `docs/releases/*.md` and regenerate via `node scripts/generate-release-notes-import.mjs`.

---

## High-Level Technical Design

Source-of-truth fan-out — where each unit lands in the existing pipeline:

```mermaid
flowchart LR
  A["docs/releases/*.md<br/>(+ backfill beta.1/2/3)  ·U1"] --> B["generate-release-notes-import.mjs<br/>selectBundle: minor-window, newest-first, isCurrent"]
  B --> C["src/releaseNotes.ts<br/>RELEASE_NOTES_BUNDLE (generated)"]
  C --> D["ReleaseNotesView.onOpen<br/>intro + cards + footer  ·U4"]
  F["formatReleaseDate(iso)  ·U2"] --> D
  E["release-notes.css<br/>tng-release-* + theme tokens  ·U3"] -.Vite→styles.css.-> D
  D --> G["Rendered What's New<br/>e2e asserts DOM  ·U5"]
```

Prose is authoritative where it and the diagram disagree.

---

## Implementation Units

### U1. Backfill release-notes files for beta.1–beta.3

- **Goal:** Give the bundle real history so the cards are scrollable back to the earliest beta.
- **Requirements:** R7, R8; supports R6 ordering.
- **Dependencies:** none.
- **Files:** `docs/releases/0.1.0-beta.1.md`, `docs/releases/0.1.0-beta.2.md`, `docs/releases/0.1.0-beta.3.md` (new); regenerates `src/releaseNotes.ts` via the build/script.
- **Approach:** Mirror the exact shape of [docs/releases/0.1.0-beta.4.md](../../docs/releases/0.1.0-beta.4.md): first line `<!-- release-date: YYYY-MM-DD -->` using the tag dates (beta.1 → 2026-06-23, beta.2 → 2026-06-28, beta.3 → 2026-06-30), then `# TaskNotes Gantt <version>` and `## Added`/`## Fixed` sections. Reconstruct content from merged PRs/commits between the corresponding tags. The parser ([scripts/releaseFiles.mjs](../../scripts/releaseFiles.mjs)) hard-rejects a missing date comment, raw HTML, and non-tag-pinned or missing image refs — so keep these files text-only (no images) unless a committed, tag-pinned asset under `docs/media/` is referenced. Regenerate the bundle with `node scripts/generate-release-notes-import.mjs` (do not hand-edit `src/releaseNotes.ts`).
- **Patterns to follow:** existing `0.1.0-beta.4.md`; `docs/releases.md` index (regenerated by `scripts/update-release-index.mjs`).
- **Test scenarios:**
  - `Covers R6, R7.` Extend [test/unit/releaseNotesBundle.test.ts](../../test/unit/releaseNotesBundle.test.ts): given a temp `docs/releases` dir with all four `0.1.0-beta.*` files, `selectBundle` returns all four, ordered newest-first (beta.4 → beta.1), with `isCurrent` only on the version matching manifest.
  - Each backfilled file passes the release-file gates: `readReleaseEntries` extracts the date, strips the comment, and raises no raw-HTML / invalid-image error.
- **Verification:** `node scripts/generate-release-notes-import.mjs` produces a 4-entry `RELEASE_NOTES_BUNDLE`; a full build succeeds (release-file validation is part of `buildStart`); `docs/releases.md` index lists all four.

### U2. Pure `formatReleaseDate` module

- **Goal:** Human-format the release date for display without coupling to Obsidian.
- **Requirements:** R5.
- **Dependencies:** none.
- **Files:** `src/release/formatReleaseDate.ts` (new), `test/unit/formatReleaseDate.test.ts` (new).
- **Approach:** `formatReleaseDate(iso: string | null): string` → `Month D, YYYY` (e.g. `"2026-07-01"` → `"July 1, 2026"`). Parse the `YYYY-MM-DD` string explicitly (do not rely on `new Date(iso)` timezone parsing, which can shift the day); map month index to a name constant. Return `""` for `null`/empty/malformed input so the view can guard. Strict types, no `any`.
- **Execution note:** Test-first — write the formatter's unit tests red before implementing.
- **Patterns to follow:** the split-for-testability modules [src/release/releaseNotesExpand.ts](../../src/release/releaseNotesExpand.ts) and [src/release/whatsNewVersion.ts](../../src/release/whatsNewVersion.ts).
- **Test scenarios:**
  - `Covers AE2.` `"2026-07-01"` → `"July 1, 2026"`; `"2026-06-23"` → `"June 23, 2026"`.
  - Day is not off-by-one across timezones (assert `"2026-01-01"` → `"January 1, 2026"`, not December 31).
  - `null` → `""`; `""` → `""`; malformed (`"not-a-date"`) → `""`.

### U3. Release-view stylesheet + bundling into `styles.css`

- **Goal:** Provide theme-adaptive card/pill/chevron styling in CSS and get it into the built `styles.css`.
- **Requirements:** R1 (visual), R3, R4 (visual).
- **Dependencies:** none (defines classes U4 will populate).
- **Files:** `src/release/release-notes.css` (new); an import site so Vite bundles it (e.g. `import "./release-notes.css"` in [src/release/ReleaseNotesView.ts](../../src/release/ReleaseNotesView.ts) or a single import in [src/main.ts](../../src/main.ts)); verify against build output `dist/styles.css`.
- **Approach:** Author rules on the existing hooks — `.tng-release-notes`, `.tng-release-notes-body`, `.tng-release-version` (`<details>` card), `.tng-release-summary` (row), `.tng-release-version-name`, `.tng-release-version-date`, `.tng-release-version-current` (pill), `.tng-release-chevron`, `.tng-release-version-content`, `.tng-release-footer` — using only Obsidian theme variables (see Key Technical Decisions). Card = border + radius + padding; summary = flex row with the chevron pushed right (chevron span is the **last child**, `margin-left:auto`); hide the native marker (`summary::-webkit-details-marker { display:none }` and `list-style:none`); pill = `--interactive-accent` background, `--text-on-accent` text, small radius.
  - **Chevron rotation (specified, not left to invent):** resting `rotate(0deg)` (pointing right, matching the reference), open state via `details[open] .tng-release-chevron { transform: rotate(90deg) }` (pointing down), with `transition: transform 0.15s ease`.
  - **Keyboard focus (accessibility — R2):** add `.tng-release-summary:focus-visible { outline: 2px solid var(--interactive-accent); outline-offset: 2px; }`. Removing the marker with `list-style:none` must not also drop the focus ring; verify Obsidian's base styles don't force `outline:none` on `summary` (scope more specifically if they do). Keep native disclosure semantics — do not add ARIA roles that conflict with `<details>`.
  - **Live theme re-resolution (R3 / AE4):** all color references must be pure CSS custom-property references (`var(--…)`); do **not** read token values in JS (`getComputedStyle`) at render time. The view stays mounted across theme toggles, so pure-CSS tokens are what make AE4 hold without a theme-change listener.
- **Technical design (directional, not spec):** the current plugin CSS all comes from Svelte component `<style>` blocks extracted by Vite; a plain `ItemView` has no such path. A bare `import "./release-notes.css"` from TS is the least-invasive route, **but whether Vite lib-mode extracts it into the `styles.css` asset is an execution-time unknown** — the implementer must confirm the rules appear in `dist/styles.css` after `npm run build`. **Fallback if not extracted:** move the release-view body into a tiny Svelte component (so its `<style>` extracts like [src/bases/GanttContainer.svelte](../../src/bases/GanttContainer.svelte)), or add a repo-root source `styles.css` wired into the build. Decide by the verification result, not upfront.
- **Patterns to follow:** theme-token usage; the "heavy lines" caution (token-driven borders only).
- **Test scenarios:** `Test expectation: none — pure styling.` Structural/class presence is asserted via U5's e2e; border-weight/visual polish is maintainer review (functional harness does not do pixel diffing).
- **Verification:** after `npm run build`, `dist/styles.css` contains the `.tng-release-*` rules; the view renders with cards/right-chevron/pill in a real vault (covered functionally by U5).

### U4. Rework `ReleaseNotesView` rendering

- **Goal:** Emit the card DOM structure, formatted date, intro, and pill — class-based, no inline styles.
- **Requirements:** R1, R2, R4, R5, R6, R9, R10.
- **Dependencies:** U2 (formatter), U3 (CSS classes).
- **Files:** [src/release/ReleaseNotesView.ts](../../src/release/ReleaseNotesView.ts).
- **Approach:** In `onOpen`: (1) add a short intro paragraph above the cards with feedback text + links, built from `REPO_URL` ([releaseNoteLinks.ts](../../src/release/releaseNoteLinks.ts)) — R9. Use explicit, screen-reader-meaningful link labels (not "click here"): "open an issue" → `${REPO_URL}/issues`, "the repository" → `${REPO_URL}`, "star it on GitHub" → `${REPO_URL}`. Stub copy (adjust wording freely): *"Thanks for using TaskNotes Gantt. Found a bug or have an idea? [open an issue], browse [the repository], or [star it on GitHub]."* (2) keep the per-version `<details class="tng-release-version">` with `open` set from the existing `defaultExpandedIndices` — R2, R6; (3) build the summary row with version name, the date, and a chevron span as the last child for CSS to place/rotate — R1, R5. Render the date **only when `formatReleaseDate(v.date)` is non-empty** (guard the empty-string return so no blank date span appears); (4) render the "Current" state as a dedicated pill span (`.tng-release-version-current`) rather than faded inline text — R4; (5) remove all imperative `el.style.*` assignments now handled by CSS; (6) keep the existing footer — R10; (7) preserve the empty-bundle fallback and the DI constructor (`bundle` param) so tests can inject a synthetic bundle. Do not change `defaultExpandedIndices` or `transformReleaseNoteIssueLinks` (unit-locked contracts).
- **Single-release state (no special variant):** a one-entry bundle still renders as a collapsible `<details>` card, expanded by default (`defaultExpandedIndices` already handles this), with the "Current" pill if `isCurrent`. Do not invent a flat/non-collapsible layout for the single-card case — keep the component model uniform.
- **Patterns to follow:** existing `onOpen` structure; DI via constructor; `MarkdownRenderer.render` for body content.
- **Test scenarios:** (behavioral DOM assertions run in U5's e2e against a non-empty bundle)
  - `Covers AE1.` Newest/current card shows the pill and is expanded; the next-older card is expanded; remaining cards collapsed.
  - `Covers R1.` Each card is a `.tng-release-version` with a summary containing version name, date, and chevron element.
  - `Covers R9, R10.` Intro paragraph with GitHub/star links renders above the cards; footer renders below.
  - Empty bundle still renders the "No release notes available." fallback (existing behavior preserved).

### U5. Extend e2e coverage for the redesigned cards

- **Goal:** Lock the rendered card structure and ordering in real Obsidian.
- **Requirements:** R6, R7; AE1–AE3. (AE4 — light/dark legibility — is **maintainer visual review at the U3 checkpoint**, not harness-automatable; see Test scenarios.)
- **Dependencies:** U1, U4.
- **Files:** [test/specs/whats-new.e2e.ts](../../test/specs/whats-new.e2e.ts); [src/main.ts](../../src/main.ts) (test-only hook).
- **Approach:** The existing spec asserts the empty-state because the harness manifest (`0.0.1`) has minor `0`, so `selectBundle`'s minor-window excludes every `0.1.x` release → empty bundle. The DI constructor cannot be reached from `browser.executeObsidian` (the `ReleaseNotesView` class is a private symbol inside the bundled `main.js`, not on `window` or the plugin instance; the registered view factory hardwires `RELEASE_NOTES_BUNDLE`). **Commit to a guarded test-only hook:** expose a small opener on the plugin instance (e.g. `plugin.__test.openReleaseNotesWithBundle(bundle)`), gated so it is inert outside the e2e/dev context, that constructs `new ReleaseNotesView(leaf, bundle)` and reveals the leaf. The e2e calls it via `browser.executeObsidian(({app}) => app.plugins.plugins['tasknotes-gantt'].__test.openReleaseNotesWithBundle(FIXTURE_BUNDLE))`, then asserts the DOM. This is the accepted minimal production surface — do not assert "no production surface." (Alternative considered: bumping the harness manifest to `0.1.x` so the real baked bundle is non-empty — rejected because it perturbs other specs' `shouldShowWhatsNew` behavior.)
- **Execution note:** Extend the spec first (red) against the intended DOM, then wire whatever seeding hook it needs.
- **Test scenarios:**
  - `Covers AE1, R6.` Given a 3+ entry bundle with the newest flagged current: the current card carries `.tng-release-version-current` and is `open`; the next-older is `open`; the rest are collapsed; cards appear newest-first.
  - `Covers AE3, R7.` The earliest card in the list is the earliest bundle entry (scroll-to-bottom reachable).
  - `Covers AE2.` A card's date text is the formatted form (e.g. "June 23, 2026"), not the ISO string.
  - Keep an assertion for the empty-bundle fallback so both states stay covered.
  - `AE4 — not automated.` Light/dark theme legibility is verified by maintainer visual review at the U3 checkpoint (the functional harness does not switch themes or diff pixels). Pure-CSS token references (U3) are what make it hold; there is no e2e assertion for it.
- **Verification:** `npm run e2e:local` passes the new assertions against the real Obsidian harness.

---

## Scope Boundaries

- **In scope:** the "What's New" release-notes view, its stylesheet, the `formatReleaseDate` module, and backfilled `0.1.0-beta.1/2/3` notes.
- **Out of scope:** the Gantt chart/view; the release/versioning pipeline mechanics beyond authoring the backfill files and regenerating the bundle; pixel-for-pixel cloning of TaskNotes' exact colors/spacing (theme-adaptive parity only).

### Deferred to Follow-Up Work

- **Widen `selectBundle`'s minor-window** so in-app history survives across future minors (today it drops releases older than the previous minor). Fine while everything is `0.1.x`; revisit before `0.2.x`.
- **Screenshot/pixel regression coverage** for the card visuals (the functional e2e harness does not diff pixels).
- **Backfilled-note depth:** first pass is a concise reconstructed changelog per beta; richer historical detail can be filled later.

---

## Assumptions

- A bare `import "./release-notes.css"` from TypeScript is extracted by this Vite lib-mode build into `dist/styles.css`. If the build proves otherwise (U3 verification), the documented fallback (Svelte-component `<style>` or a wired root stylesheet) is taken — the requirement (theme-adaptive CSS in `styles.css`) is unchanged.
- Tag dates are the correct authored `release-date` values for the backfilled files.
- Reconstructed historical content is documentation-grade (from tags/PRs), not the verbatim notes that would have shipped at the time — acceptable per origin.
- A small guarded test-only opener on the plugin instance is an acceptable minimal production surface for e2e bundle seeding (the DI constructor is not reachable from the WDIO execution context).

---

## Risks & Dependencies

- **"Heavy lines" theming regression (medium).** Hand-picked border styling caused a visible regression before. Mitigation: token-driven borders (`--background-modifier-border`), maintainer eyeball before merge.
- **CSS-bundling uncertainty (medium).** A plain CSS import may not be extracted in lib mode. Mitigation: U3 verification checkpoint + explicit fallback; no requirement change either way.
- **e2e seeding (medium).** Asserting card DOM needs a non-empty bundle in a `0.0.1`-manifest harness, and the DI constructor is **not** reachable from `browser.executeObsidian` (the view class is private in the bundled `main.js`). Mitigation: a guarded test-only opener on the plugin instance (U5) constructs the view with a fixture bundle; unit tests remain the guaranteed coverage for formatting/expand/ordering if the hook proves impractical.
- **Unit-locked contracts.** `defaultExpandedIndices`, `transformReleaseNoteIssueLinks`, generator ordering/`isCurrent`, and `whatsNewVersion` logic must stay green — do not alter their contracts.

---

## Sources & Research

- Current view + pure helpers: [src/release/ReleaseNotesView.ts](../../src/release/ReleaseNotesView.ts), [src/release/releaseNotesExpand.ts](../../src/release/releaseNotesExpand.ts), [src/release/releaseNoteLinks.ts](../../src/release/releaseNoteLinks.ts), [src/release/whatsNewVersion.ts](../../src/release/whatsNewVersion.ts).
- Bundle + generation: [src/releaseNotes.ts](../../src/releaseNotes.ts) (generated), [scripts/generate-release-notes-import.mjs](../../scripts/generate-release-notes-import.mjs) (`selectBundle` window/order/`isCurrent`), [scripts/releaseFiles.mjs](../../scripts/releaseFiles.mjs) (date/raw-HTML/image gates), [vite.config.ts](../../vite.config.ts) (`assetFileNames: "styles.css"`, `buildStart` generation).
- CSS model precedent: [src/bases/GanttContainer.svelte](../../src/bases/GanttContainer.svelte) (component `<style>` extraction).
- Tests: [test/specs/whats-new.e2e.ts](../../test/specs/whats-new.e2e.ts), [test/unit/releaseNotesBundle.test.ts](../../test/unit/releaseNotesBundle.test.ts), [test/unit/whatsNewVersion.test.ts](../../test/unit/whatsNewVersion.test.ts).
- Conventions: [docs/conventions/data-formatting.md](../../docs/conventions/data-formatting.md) (extract-raw / format-in-view).
- Learnings: `docs/solutions/integration-issues/gantt-theme-toggle-bases-refresh-loop.md` ("heavy lines"), `docs/solutions/architecture-patterns/view-display-options-in-presentation-not-derivation.md` (styling in presentation/CSS), `docs/solutions/developer-experience/headless-e2e-verification-for-ui-work.md` (assert DOM, not pixels).
- Feedback evidence: [docs/brainstorms/riffrec-feedback/whats-new-screen-redesign/](../../docs/brainstorms/riffrec-feedback/whats-new-screen-redesign/) (transcript, problem-analysis, reference frames).
- Release history: git tags `0.1.0-beta.1` (2026-06-23), `beta.2` (2026-06-28), `beta.3` (2026-06-30), `beta.4` (2026-07-01).
