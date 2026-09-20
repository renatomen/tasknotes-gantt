---
title: Calendar & Working-Time Feature Documentation - Plan
type: docs
date: 2026-09-20
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: maintainer-direction-2026-09-20
execution: docs
---

# Calendar & Working-Time Feature Documentation - Plan

## Goal Capsule

- **Objective:** a user who opens [tngantt.com](https://tngantt.com/) can set up a working-time calendar, author or edit a calendar note, combine calendars into a set, and read every control the plugin actually ships — with screenshots of shipped behaviour beside each one. On completion the `0.1.0-beta.11` release notes shrink to short, linked entries and the tag is cut.
- **Why now:** `0.1.0-beta.10` shipped 2026-07-13. 214 commits and 85 user-facing PRs have merged since, including the entire working-time calendar feature set, none of which the site documents — while three settings the site *does* document no longer exist. The maintainer ruled on 2026-09-20 that the tag waits for the documentation rather than shipping ahead of it.
- **Authority:** AGENTS.md and the engineering charter bind. This plan operationalizes R14 of `docs/plans/2026-07-13-001-docs-user-documentation-site-plan.md` — "a release is not done until shipped behavior is reflected in the docs" — for the beta.11 change set.
- **Execution profile:** **one PR per unit**, squash-merged on green, units in the order below. U1 first because wrong documentation actively misleads while missing documentation only disappoints; U2–U5 are independent of each other after U1 and may be reordered; U6 depends on U2–U4 existing to link into; U7 is last and gates the tag.
- **Landing strategy:** one unit, one PR. A unit that exceeds ~4 hours to shippable is re-sliced. No unit bundles another's pages.
- **Stop conditions:** a red `mkdocs build --strict` outranks new prose. A screenshot that cannot be staged from a committed fixture is parked in `docs/backlogs/backlog.md` rather than faked, cropped from a stale capture, or taken from the maintainer's real vault.

### Resuming this campaign (mechanism, not memory)

This plan is never mutated into a status document. A session resumes by asking git what has landed:

```bash
git log --oneline --grep '2026-09-20-002' main      # every unit PR cites this plan path
ls website/docs/features/ website/docs/settings/    # which pages exist
git log --oneline --diff-filter=A -- docs/media/    # which captures exist
mkdocs build --strict -f website/mkdocs.yml         # the gate
```

**Every unit's PR description must cite `docs/plans/2026-09-20-002-docs-calendar-feature-documentation-plan.md` and its unit id (`U3`), so the `--grep` above is a complete index.** A unit with no matching commit has not landed, whatever any summary claims.

---

## Measurement

Derived from the code at `fe3d3380` on 2026-09-20, not from PR descriptions. The 0.1.0-beta.11 release-notes draft on the same branch is a fact-checked inventory of what shipped (three review rounds, ~20 corrections) and is the source material for U2–U5 prose.

**Reproduce the settings inventory:**

```bash
grep -n "displayName: '" src/bases/viewOptions.ts src/bases/calendarItemOptions.ts
grep -o "^## .*" website/docs/settings/*.md
```

41 shipped settings. Diffed against the site:

### Wrong — the site documents controls that do not exist

| Page | Documents | Reality |
|---|---|---|
| `settings/appearance.md` | **Bar color mode** | Removed by #312 |
| `settings/appearance.md` | **Bar color source** | Replaced by `Bar fill` + `Bar strip` (#312) |
| `settings/appearance.md` | **Theme mode** | No longer a view option; persisted from the toolbar switch (`viewOptions.ts:417` comment) |

### Missing settings

`Bar fill`, `Bar strip`, `Default legend position` (Appearance); `Estimate meaning`, `Non-working-day rendering`, `Inferred date drag` (Timeline); `Calendar Property`, `Estimate meaning override`, `Progress Property` (Fields).

### Missing feature documentation

Working-time calendars · calendar notes and the visual editor · calendar sets, union and conflicts · availability blocks · **the legend, which no page of the site mentions at all** (`grep -rln legend website/docs/` → no match).

### Already correct — do not rewrite

`features/calendar-items.md` (156 lines) documents #386 accurately, including the opt-in default and the recorded-occupancy exception. U2–U5 link to it; they do not restate it.

### Stale feature prose

`features/appearance.md` "Date-status indicators" predates #412 (red border removed) and #395–#398 (torn edge); its "Weekend shading" section predates calendars superseding weekend-only shading. `features/scheduling.md` "Missing and partial dates" predates the torn edge.

---

## Product Contract

### Requirements

- **R1.** No page describes a control that does not ship. Every documented setting resolves to a `displayName` in `viewOptions.ts` or `calendarItemOptions.ts`.
- **R2.** Every shipped setting is documented on the settings page for its group (Fields, Relationships, Progress, Timeline, Appearance, Calendar items).
- **R3.** Each new feature page explains what the feature is *for* before how to drive it, and gives at least one realistic worked example — a real planning situation, never `foo`/`bar`.
- **R4.** Each feature page carries step-by-step instructions naming the exact control labels and where they live, so a reader can follow them without guessing.
- **R5.** Every screenshot depicts behaviour as shipped at the commit that adds it, staged from a committed fixture.
- **R6.** Images follow `docs/conventions/visual-assets.md`: markdown syntax only, absolute `raw.githubusercontent.com` URLs. **Website pages pin to `main`** (the established site convention — the site tracks main); release notes pin to the release tag. Never catbox, never relative paths, never raw HTML.
- **R7.** Chart screenshots that carry colour meaning ship as a **light + dark pair**, matching the existing `bars-*-light.png` / `bars-*-dark.png` convention. Settings-panel and modal shots may be single.
- **R8.** Day-granularity is stated wherever a reader could infer hour-level scheduling. A calendar can record working hours; nothing reads them yet (`workingDays.ts:5-11`).
- **R9.** Accepted gaps are disclosed where a user would otherwise be confused: a swapped task under split rendering has no cue; a bar too narrow to carry a tooth shows no date-status signal; rewriting a frontmatter field drops comments inside that field.
- **R10.** `mkdocs build --strict -f website/mkdocs.yml` passes on every unit (the gate `.github/workflows/docs.yml` runs on PRs).
- **R11.** New pages are added to `nav:` in `website/mkdocs.yml` in a reading order that puts concept before control.

### Key decisions

- **KD1 — Capture from committed fixtures, never the real vault.** `OBSIDIAN_TEST_VAULT` and the e2e fixture vaults only. The maintainer's production vault is a hard boundary.
- **KD2 — One capture fixture per unit, named in that unit.** A unit that needs a scene no fixture stages adds the fixture in the same PR, so the capture is reproducible by the next session.
- **KD3 — Screenshots live in `docs/media/`, feature-named**, per the existing convention; they are not duplicated under `website/`.
- **KD4 — Release notes get no new screenshots.** Bug fixes get none at all (maintainer direction, 2026-09-20). Feature imagery lives on the site; U7's notes link to it.
- **KD5 — The legend is documented as its own feature page**, not as a subsection of Appearance: it explains every other visual channel, so burying it under one of them inverts the dependency.

### Scope boundaries

- **In:** `website/docs/**`, `website/mkdocs.yml`, `docs/media/**`, capture fixtures under `test/`, and in U7 only, `docs/releases/0.1.0-beta.11.md`.
- **Out:** production behaviour in `src/`. If a unit finds a defect, it files it in `docs/backlogs/backlog.md` and documents the shipped behaviour as it is. Documentation never becomes the fix.
- **Out:** the README (already demoted to a front door by the 2026-07-13 plan).
- **Out:** the ranked-defect files. **No unit in this plan touches a ranked-defect file**, so no ranked-file review contract applies; a unit that finds itself editing one has escaped its scope and stops.

---

## Implementation Units

Each unit: its pages, its capture fixture, its Definition of Done. Every PR description cites this plan and the unit id.

### U1. Correct the pages that are wrong

- **Why first:** a user following `settings/appearance.md` today looks for "Bar color mode" and does not find it. Wrong instructions cost more than absent ones.
- **Files:** `website/docs/settings/appearance.md`, `website/docs/settings/timeline.md`, `website/docs/settings/fields.md`, `website/docs/features/appearance.md`, `website/docs/features/scheduling.md`.
- **Work:** replace Bar color mode / Bar color source with **Bar fill**, **Bar strip**, **Task icon** as three independent channels; remove or correct **Theme mode**; add **Default legend position**, **Estimate meaning**, **Non-working-day rendering**, **Inferred date drag**, **Calendar Property**, **Estimate meaning override**, **Progress Property**. Correct the date-status prose for the torn edge and the removed red border; point Weekend shading at calendars as the fuller mechanism.
- **Captures:** the Appearance and Timeline view-option panels (single shots, following `view-settings-groups-light.png`).
- **DoD:** every `## ` heading on each settings page resolves to a shipped `displayName`, and every shipped `displayName` in those groups has a heading — both directions checked by the greps in § Measurement. `mkdocs build --strict` green.

### U2. Calendars and working time

- **Files:** `website/docs/features/calendars.md` (new), `website/mkdocs.yml` nav.
- **Content:** what a calendar note is; selecting calendars with **Select calendars…**; non-working days as background shading; **Estimate meaning → Working days** stretching a worked-out span across blocked days, and that it is opt-in (ships as *Calendar days*); **Non-working-day rendering** adding split segments *over* shading rather than replacing it; that authored dates never move; day-granularity per R8; RFC 5545 patterns.
- **Capture fixture:** `test/specs/gantt-calendar-shading.e2e.ts` (shading) and `test/specs/gantt-calendar-stretch.e2e.ts` (stretch). Light + dark pairs per R7.
- **DoD:** a reader can go from no calendar to a shaded, stretched chart using only this page. Every claim traced to `src/controller/calendar/` or `src/bases/calendarShading.ts`.

### U3. Calendar notes and the visual editor

- **Files:** `website/docs/features/calendar-editor.md` (new), nav.
- **Content:** **Create calendar** / **Create calendar set**; the form; the working-pattern (RRULE) builder; the year-grid, week and Gantt-strip preview tabs; the searchable timezone picker with live UTC offsets; the colour picker; the sticky header, unsaved-changes cue and close guard; renaming from the Name field; **Open calendar note as markdown**; availability blocks as *added* working time with `non_working` for days off (R8/R9); the frontmatter-comment caveat.
- **Capture fixture:** `test/specs/gantt-calendar-editor.e2e.ts`; `test/specs/_local-calendar-editor-shots.e2e.ts` already exists as a local capture spec — promote what is reusable into a committed fixture per KD2 (note: `_local-*` specs are gitignored and hang `e2e:local`; move aside rather than delete).
- **DoD:** every tab and control in `src/editor/CalendarEditorForm.svelte` is either documented or deliberately out of scope with a stated reason.

### U4. Calendar sets, union and conflicts

- **Files:** `website/docs/features/calendar-sets.md` (new), nav.
- **Content:** a set as a list of **wikilinks to calendar notes** (never feeds — that is calendar items, and the distinction matters); union semantics; conflict surfacing and hover explanations; the calendar-status banner; the picker modal; calendar as a bar colour source; markers and the today line.
- **Capture fixture:** `test/specs/gantt-calendar-picker.e2e.ts`, `gantt-calendar-colour.e2e.ts`, `gantt-calendar-markers.e2e.ts`.
- **DoD:** the set-vs-feed distinction is explicit; `src/controller/calendar/schema.ts` membership rules match the page.

### U5. The legend, and the bar treatment channels

- **Files:** `website/docs/features/legend.md` (new), nav; cross-links from `features/appearance.md`.
- **Content:** the legend as the chart explaining itself; right/bottom positions and live move for the current opening vs **Default legend position** for future ones; the catalogue of semantics it covers; **Bar fill** / **Bar strip** / **Task icon** as independent channels; the torn edge and the both-ends case; the disclosed gaps in R9.
- **Capture fixture:** `test/specs/gantt-legend.e2e.ts`. **The existing `docs/media/gantt-legend-right.png` and `-bottom.png` are STALE** — captured 2026-08-08, they still show the "Date border" row that #402/#412 retired. Capture under new filenames; do not overwrite (older releases pin those bytes to their own tags).
- **DoD:** no legend image in use predates #412.

### U6. Getting started with working time — a worked example

- **Files:** `website/docs/getting-started.md` (extended) or a new walkthrough page, nav.
- **Content:** one realistic situation carried end to end — e.g. a small team on a four-day week with a public holiday and one person on an on-call Saturday — from creating the calendar note, to the set, to selecting it, to reading the resulting chart. Links into U2–U5 rather than restating them.
- **DoD:** a reader who has never used TaskNotes reaches a working, calendar-aware Gantt using only this page and its links (the 2026-07-13 plan's acceptance criterion).

### U7. Slim the release notes, then tag

- **Files:** `docs/releases/0.1.0-beta.11.md`, `docs/releases.md` (regenerate).
- **Work:** rewrite each feature entry as a short summary plus a link to its new page; keep the Fixed section substantive (no docs pages back it, and bug fixes get no imagery per KD4); keep the @donaldwdci credit; keep #311 linked and its open residual stated. **Reset the `<!-- release-date: -->` comment to the real tag date** — it currently reads `2026-09-20`, the drafting day.
- **Then:** `npm version 0.1.0-beta.11` on a throwaway `release/*` branch cut from main, per `docs/releases/RELEASING.md`. Notes land on main first; the manifest bump never rides the notes PR.
- **DoD:** `node scripts/update-release-index.mjs --check` exits 0; every link resolves in `mkdocs build --strict`; #311 stays open until the maintainer closes it after the release.

---

## Verification Contract

Per unit, before push:

```bash
mkdocs build --strict -f website/mkdocs.yml     # R10; the PR gate runs this
node scripts/update-release-index.mjs --check   # U7 only, and any PR touching docs/releases/
npx jest                                         # full suite if a unit adds a fixture
```

Plus the repo's standing two-layer pre-push review gate (`ce-code-review` + the independent cross-model peer, both receipts recorded) and the hosted final gate. **Run the layers sequentially and do not commit while the peer is running** — the wrapper binds its receipt to the exact head and refuses when HEAD moves underneath it.

Screenshot review is human-or-agent visual inspection of the actual file before it is referenced: **open every image and confirm it shows current behaviour.** The stale legend PNGs passed every mechanical check and were still wrong.

## Definition of Done (campaign)

1. No page documents a control that does not ship, and every shipped setting is documented (R1, R2).
2. Working-time calendars, the calendar editor, calendar sets, and the legend each have a page with imagery (R3–R7).
3. Every image in use depicts post-#412 behaviour.
4. `mkdocs build --strict` is green and the site nav reads concept-before-control.
5. The beta.11 notes are short and linked, dated to the real tag day, and `0.1.0-beta.11` is tagged and published.

## Appendix — Sources

- Gap measurement and reproduce commands: § Measurement, derived at `fe3d3380`.
- Fact-checked inventory of the change set: `docs/releases/0.1.0-beta.11.md` as drafted on `docs/release-notes-0.1.0-beta.11`.
- Site contract and R14: `docs/plans/2026-07-13-001-docs-user-documentation-site-plan.md`.
- Image convention: `docs/conventions/visual-assets.md`.
- Release procedure: `docs/releases/RELEASING.md`.
- Parked captures and the `ce-demo-reel` availability note: `docs/backlogs/backlog.md` § Visual assets.
