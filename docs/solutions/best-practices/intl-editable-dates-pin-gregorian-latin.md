---
title: "Editable date surfaces must pin Intl to calendar: gregory and numberingSystem: latn"
date: 2026-07-11
category: best-practices
module: bases-gantt
problem_type: best_practice
component: frontend_stimulus
severity: medium
applies_when:
  - "A date is both DISPLAYED and PARSED/EDITED through Intl with the user's locale"
  - "Stored values are Gregorian (ISO YYYY-MM-DD frontmatter) but the display locale's Intl defaults may not be"
tags: [intl, locale, dates, i18n, gregorian, numbering-system, round-trip]
---

# Editable date surfaces must pin Intl to calendar: gregory and numberingSystem: latn

## Context

The gantt grid formats dates per the user's regional locale and parses typed input against a pattern derived from `Intl.DateTimeFormat(locale).formatToParts`. Some locales' Intl defaults are non-Gregorian or non-Latin: `th-TH` renders March 20, 2026 as `20/3/2569` (Buddhist calendar), and `ar-EG` uses Arabic-Indic digits. Deriving both the display and the parse pattern from raw defaults breaks the round-trip — a Buddhist year parses as Gregorian 2569, and Arabic digits fail ASCII digit groups. Caught by external review on PR #228 before ship.

## Guidance

Pin both sides of any editable date surface:

```ts
new Intl.DateTimeFormat(locale, {
  year: 'numeric', month: 'numeric', day: 'numeric',
  calendar: 'gregory',
  numberingSystem: 'latn',
})
```

Apply the same options to the display formatter and to the `formatToParts` call the parser pattern derives from — the pattern must describe what the cell actually shows. Order and separators stay locale-shaped (day-first for de-DE, month-first for en-US), so the regional feel survives; only the calendar arithmetic and digit glyphs are normalized to match storage.

## Why This Matters

Display-only surfaces tolerate any calendar, but the moment typed input round-trips into stored Gregorian dates, a non-pinned surface either saves the wrong year silently (worst case) or rejects the user's exactly-as-displayed input. Pinning is one options-bag line on each side; the failure is invisible on Western-locale test machines.

## When to Apply

- Any new Intl-based date formatter whose output can be typed back (editors, search filters, quick-entry parsing).
- Read-only display can keep raw locale defaults if desired — but if the same formatter feeds an editable surface, pin it.

## Examples

`src/bases/dateLocale.ts` (display formatter) and `src/bases/dateEditParse.ts` (parse-pattern derivation) pin both; `test/unit/dateEditParse.test.ts` pins th-TH and ar-EG round-trips.

## Related

- docs/solutions/design-patterns/svar-custom-inline-editor-pattern.md — the editor these surfaces feed.
