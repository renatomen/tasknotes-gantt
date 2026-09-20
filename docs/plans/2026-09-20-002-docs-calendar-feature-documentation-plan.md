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
- **Why now:** `0.1.0-beta.10` shipped 2026-07-13. 213 commits have merged since, including the entire working-time calendar feature set, none of which the site documents — while three settings the site *does* document no longer exist. The maintainer ruled on 2026-09-20 that the tag waits for the documentation rather than shipping ahead of it.
- **Authority:** AGENTS.md and the engineering charter bind. This plan operationalizes R14 of `docs/plans/2026-07-13-001-docs-user-documentation-site-plan.md` — "a release is not done until shipped behavior is reflected in the docs" — for the beta.11 change set.
- **Execution profile:** **one PR per unit**, squash-merged on green, in the order below. U1 first because wrong documentation actively misleads while missing documentation only disappoints. U2–U5 are independent of each other and may be reordered; U6 depends on U2–U5 existing to link into; U7 and U8 are last and gate the tag.
- **Stop conditions:** a red `mkdocs build --strict` outranks new prose. A screenshot that cannot be staged from a committed `test/vaults/*` fixture is parked in `docs/backlogs/backlog.md` rather than faked, cropped from a stale capture, or taken from any real vault.

### Resuming this campaign

**The tree is the index, because artifacts cannot lie about themselves.** Every unit below names the exact file it creates or the exact heading it adds; a unit has landed when that artifact is on `main` and not before:

```bash
ls website/docs/features/            # calendars.md, calendar-editor.md, calendar-sets.md, legend.md
git log --oneline --diff-filter=A -- docs/media/   # which captures exist, and when
grep -c '^## ' website/docs/settings/appearance.md # U1's headings
mkdocs build --strict -f website/mkdocs.yml        # the gate
```

**Every unit's PR description should also cite this plan path and its unit id**, which makes `git log --grep 2026-09-20-002 main` a convenient secondary index. Treat it as convenience, not proof: measured on 2026-09-20, that grep returns **0 hits for `2026-07-13-001` and `2026-08-27-002`, whose work is demonstrably merged**, because nothing enforces the citation — no workflow or hook reads `plans/`. A unit missing from the grep may still have landed; check the artifacts. Adding a real guard is a candidate ratchet, not part of this plan.

This plan is never mutated into a status document (charter session cadence, `[[one-session-one-pr-discipline]]`).

---

## Measurement

Derived from the code at `fe3d3380` on 2026-09-20, not from PR descriptions. The 0.1.0-beta.11 release-notes draft on the same branch is a fact-checked inventory of what shipped (four review rounds, ~25 corrections) and is the source material for U2–U5 prose — but it is an input to be re-verified, not an authority.

**Reproduce the settings inventory — and note what a naive grep misses:**

```bash
grep -n "displayName: '" src/bases/viewOptions.ts src/bases/calendarItemOptions.ts
grep -o "^#\{2,3\} .*" website/docs/settings/*.md
```

⚠️ **A source grep for `displayName:` is not the settings inventory and must not be used as a completeness gate.** Seven shipped controls are built through helpers and carry no literal — `familyToggle(...)` (`calendarItemOptions.ts:118,131-133`) produces *Show recurring tasks*, *Show time entries*, *Show timeblocks*; `eventPropertyPicker(...)` (`:134,139,144`) produces the event-property pickers; per-feed external toggles are dynamic (`:247`). The same grep also counts five group and section *labels* as if they were settings. Any completeness claim must walk the **returned option objects** from `ganttViewOptions()` and the calendar-items group, not the source text (see U1 DoD).

### Wrong — the site documents controls that do not exist

| Page | Documents | Reality |
|---|---|---|
| `settings/appearance.md:6` | **Bar color mode** | Removed by #312 (`git log -S tngantt_barColorMode` → `5a7cdde1`) |
| `settings/appearance.md:15` | **Bar color source** | Replaced by `Bar fill` + `Bar strip` (#312) |
| `settings/appearance.md:52` | **Theme mode** | No longer a view option; persisted from the toolbar (`viewOptions.ts:414-418`) |

### Missing settings

`Bar fill` (:376), `Bar strip` (:390), `Default legend position` (:427) — Appearance; `Estimate meaning` (:273), `Non-working-day rendering` (:285), `Inferred date drag` (:334) — Timeline; `Calendar Property` (:84), `Estimate meaning override` (:232) — Fields. **Eight, not nine.** `Progress Property` is *not* missing: `viewOptions.ts:504,517,523` deliberately removes it from Fields and places it in the Progress group, where `website/docs/settings/progress.md:6` already documents it. Do not add it to `fields.md`.

### Missing feature documentation

Working-time calendars · calendar notes and the visual editor · calendar sets, union and conflicts · availability blocks · **the legend, which no page of the site mentions at all** (`grep -rlin legend website/docs/` → no match).

### Already correct — do not rewrite

- `features/calendar-items.md` (156 lines) documents #386 accurately, including the opt-in default and the recorded-occupancy exception.
- `features/appearance.md:98-117` **already documents the torn edge**, the both-ends case, the narrow-bar caveat and the orange swapped treatment, and mentions no red border. An earlier draft of this plan claimed otherwise; that claim was false. `features/scheduling.md:40-50` is likewise fine.

### Genuinely stale feature prose

`features/appearance.md:121-134` "Weekend shading" predates calendars superseding weekend-only shading and does not mention them. That is the only confirmed stale section; it rides U2, which is where calendars get explained.

---

## Product Contract

### Requirements

- **R1.** No page describes a control that does not ship.
- **R2.** Every shipped setting is documented on the settings page **for its own group** (Fields, Relationships, Progress, Timeline, Appearance, Calendar items) — exactly once, on one page.
- **R3.** Each new feature page explains what the feature is *for* before how to drive it, and gives at least one realistic worked example — a real planning situation, never `foo`/`bar`.
- **R4.** Each feature page carries step-by-step instructions naming the exact control labels and where they live.
- **R5.** Every screenshot depicts behaviour as shipped at the commit that adds it.
- **R6.** Images follow `docs/conventions/visual-assets.md`: markdown syntax only, absolute `raw.githubusercontent.com` URLs. **Website pages pin to `main`** — verified across all 15 existing site image references. That rule is real by observation but is written nowhere; U1 adds it to `docs/conventions/visual-assets.md` § pinning so the next author is not guessing. Release notes pin to the release tag. Never catbox, never relative paths, never raw HTML.
- **R7.** Chart screenshots carrying colour meaning ship as a **light + dark pair** (`bars-*-light.png` / `bars-*-dark.png` precedent). Settings-panel and modal shots may be single.
- **R8.** Granularity is stated wherever a reader could infer hour-level scheduling: a calendar authors working hours and **the Week preview displays them**, but nothing schedules or shades by them yet (`workingDays.ts:5-11`, `weekPreviewLayout.ts:3-9`). "Nothing reads them" is too strong and must not be written.
- **R9.** Accepted gaps are disclosed where a user would otherwise be confused: a swapped task under split rendering has no cue; a bar too narrow to carry a tooth shows no date-status signal; rewriting a frontmatter field drops comments inside that field.
- **R10.** `mkdocs build --strict -f website/mkdocs.yml` passes on every unit **that touches `website/`**. The CI gate (`.github/workflows/docs.yml`) is path-filtered to `website/**`, so it does **not** run on U7; U7 is gated by the release-index check instead.
- **R11.** New pages are added to `nav:` in `website/mkdocs.yml` in a reading order that puts concept before control.
- **R12.** Interoperability is described accurately: working patterns are authored as **RFC 5545 RRULE values**, which is why the syntax is familiar and portable. There is **no iCalendar import or export** — a calendar note is plugin frontmatter in Markdown, and `rfcMapping.ts` is consumed by `schema.ts` and a round-trip test, not by any `.ics` path. Do not write that another RFC client can read the note.

### Key decisions

- **KD1 — Capture from committed in-repo fixture vaults only (`test/vaults/*`). Never the live `OBSIDIAN_TEST_VAULT`, and never any real vault.** This is verbatim `docs/conventions/visual-assets.md:67-71` ("fixture-only, never private … so no private information can ever flow into a demo"). An earlier draft of this plan permitted `OBSIDIAN_TEST_VAULT` and was wrong; that variable points at a live vault. Fixtures hold synthetic, committed data.
- **KD2 — Each unit names the fixture(s) it captures from.** One is typical, several are fine where a unit spans several scenes; what matters is that a named, committed fixture backs every image so the next session can re-stage it.
- **KD3 — Screenshots live in `docs/media/`, feature-named**, per the existing convention; not duplicated under `website/`.
- **KD4 — Release notes get no new screenshots. Bug fixes get none at all** (maintainer direction, 2026-09-20). Feature imagery lives on the site; U7's notes link to it.
- **KD5 — The legend is its own feature page**, not a subsection of Appearance: it explains every other visual channel, so burying it under one of them inverts the dependency.

### Scope boundaries

- **In:** `website/docs/**`, `website/mkdocs.yml`, `docs/media/**`, new capture spec modules under `test/`, `docs/conventions/visual-assets.md` (R6 only), and in U7 only, `docs/releases/**`.
- **Out:** production behaviour in `src/`. A unit that finds a defect files it in `docs/backlogs/backlog.md` and documents the shipped behaviour as it is. Documentation never becomes the fix.
- **Out:** the README (already demoted by the 2026-07-13 plan).

### Ranked-defect review contract

**`test/specs/gantt-calendar-editor.e2e.ts` is ranked-defect entry 6** (`docs/reports/2026-08-15-001-maintainability-rediagnosis.md:234`): 5.0% churn — the highest of any spec — 1,606 lines, four separable suites serially mutating one fixture vault, whose ordering coupling makes every addition risk the 40 tests before it. Its prescribed remedy is helper extraction then a four-way split.

**No unit in this plan edits that file.** U3 captures the calendar editor from a **new, separate spec module** (`test/specs/gantt-calendar-editor-shots.e2e.ts`) reusing the existing `test/vaults/*` fixture, precisely so this campaign does not add a 41st test to a file whose measured pain is that every addition risks the 40 before it. Appending capture steps to the ranked spec would grow its line count and concern count for a reason unrelated to its purpose — a P1 under the AGENTS.md invariant.

**Binding on every unit:** no PR in this campaign grows a ranked-defect file's line count or concern count. A unit that finds itself editing one has escaped its scope and stops for re-planning. No other ranked-defect file appears in any unit's Files.

---

## Implementation Units

Each unit: its files, its capture fixture, its Definition of Done. Landing: one unit, one PR.

### U1. Correct the settings pages, and write down the image-pinning rule

- **Why first:** a user following `settings/appearance.md` today looks for "Bar color mode" and does not find it. Wrong instructions cost more than absent ones.
- **Files:** `website/docs/settings/appearance.md`, `website/docs/settings/timeline.md`, `website/docs/settings/fields.md`, `docs/conventions/visual-assets.md`.
- **Work:** delete **Bar color mode**, **Bar color source**, **Theme mode**; add **Bar fill**, **Bar strip**, **Default legend position** (Appearance), **Estimate meaning**, **Non-working-day rendering**, **Inferred date drag** (Timeline), **Calendar Property**, **Estimate meaning override** (Fields). Leave `Progress Property` where it is. Add the website-pins-to-`main` rule to the convention per R6.
- **Capture fixture:** the Appearance and Timeline view-option panels, staged from any committed `test/vaults/*` fixture (single shots, `view-settings-groups-light.png` precedent).
- **DoD — checkable, and not by a source grep:** a scratch script walks the option objects returned by `ganttViewOptions()` and the calendar-items group, collects every `displayName`, and diffs that set against the `##`/`###` headings across `website/docs/settings/*.md`.
  - **Direction that must be empty: every shipped control has a heading.** This is the direction that catches an undocumented setting, and it is the one U1 is accountable for.
  - The reverse direction is *not* empty and must not be asserted to be. Settings pages legitimately carry non-control headings (`## Related`, `## Not a view setting: the quick source switcher`, `## The groups`, `## Companion vs. standalone`), three controls are deliberately collapsed into one `### Event start / end / title property` heading, and per-feed external toggles are named after the user's own feeds. The script therefore carries an **explicit, commented allow-list of non-control headings** plus the collapsed-heading and dynamic-feed rules; any heading matching none of them and no shipped control is reported for a human decision rather than silently ignored.
  - **Prove the check works before trusting it:** delete the `Show recurring tasks` heading and confirm it fails; restore it by inverse edit, never `git checkout`.
  - `mkdocs build --strict` green.

### U2. Calendars and working time

- **Files:** `website/docs/features/calendars.md` (new), `website/docs/features/appearance.md` (Weekend shading section only), `website/mkdocs.yml` nav.
- **Content:** what a calendar note is; **Select calendars…**; non-working days as background shading; **Estimate meaning → Working days** stretching a worked-out span, and that it is opt-in (ships as *Calendar days*); that **Non-working-day rendering → Split segments** *adds* segments over shading rather than replacing it; that authored dates never move and a fully dateless placeholder does not stretch; granularity per R8; RRULE values per R12.
- **Capture fixtures:** `test/specs/gantt-calendar-shading.e2e.ts` and `test/specs/gantt-calendar-stretch.e2e.ts`, with their `test/vaults/*` fixtures. Light + dark pairs per R7.
- **DoD:** the page contains a numbered procedure from "no calendar" to a shaded, stretched chart, naming each control by its shipped label; every behavioural claim cites a path under `src/controller/calendar/` or `src/bases/calendarShading.ts` in the PR body; the Weekend shading section links to this page.

### U3. Calendar notes and the visual editor

- **Files:** `website/docs/features/calendar-editor.md` (new), `test/specs/gantt-calendar-editor-shots.e2e.ts` (new — see the ranked-defect contract), nav.
- **Content:** **Create calendar** / **Create calendar set**; the form; the working-pattern (RRULE) builder; the year-grid, week and Gantt-strip preview tabs — noting the Week preview is the one surface that shows authored hours (R8); the timezone picker with live UTC offsets; the colour picker; the sticky header, unsaved-changes cue and close guard; renaming from the Name field; **Open calendar note as markdown**; availability blocks as *added* working time with `non_working` for days off; the frontmatter-comment caveat (R9).
- **Capture fixture:** the new shots spec, reusing the existing calendar-editor `test/vaults/*` fixture. `test/specs/_local-calendar-editor-shots.e2e.ts` is an uncommitted local probe — mine it for technique, do not depend on it, and leave it alone (`_local-*` specs are gitignored and hang `e2e:local`).
- **DoD:** every tab and top-level control in `src/editor/CalendarEditorForm.svelte` is either documented or listed in the PR body as deliberately out of scope with a reason; `git diff --stat` shows `gantt-calendar-editor.e2e.ts` untouched.

### U4. Calendar sets, union and conflicts

- **Files:** `website/docs/features/calendar-sets.md` (new), nav.
- **Content:** a set as a list of **wikilinks to calendar notes** — never feeds, which are calendar items, and the distinction matters; union semantics; conflict surfacing and hover explanations; the calendar-status banner; the picker modal; calendar as a bar colour source; markers and the today line.
- **Capture fixtures:** `test/specs/gantt-calendar-picker.e2e.ts`, `gantt-calendar-colour.e2e.ts`, `gantt-calendar-markers.e2e.ts`.
- **DoD:** the page states the set-vs-feed distinction explicitly and links to `features/calendar-items.md` for feeds; membership rules match `src/controller/calendar/schema.ts:168-187`.

### U5. The legend, and the bar treatment channels

- **Files:** `website/docs/features/legend.md` (new), nav; cross-links from `features/appearance.md`.
- **Content:** the legend as the chart explaining itself; right/bottom positions, live move for the current opening vs **Default legend position** for future ones; the catalogue of semantics; **Bar fill** / **Bar strip** / **Task icon** as independent channels; the disclosed gaps in R9.
- **Capture fixture:** `test/specs/gantt-legend.e2e.ts`. **`docs/media/gantt-legend-right.png` and `-bottom.png` are STALE** — added 2026-08-08 by `c9b1d9be`, never modified, and they still render a "Date border — A red border marks a task…" row that #402/#412 retired. Capture under **new filenames**; do not overwrite (older releases pin those bytes to their own tags, `visual-assets.md:38-44`).
- **DoD:** no legend image referenced by any page or release note predates #412, verified by opening each referenced file.

### U6. Getting started with working time — a worked example

- **Files:** `website/docs/getting-started.md` (extended with a new walkthrough section — **decided: not a new page**, so nav is unchanged and the site's documented entry point stays the entry point).
- **Content:** one realistic situation carried end to end — a small team on a four-day week with a public holiday and one person on an on-call Saturday — from creating the calendar note, to the set, to selecting it, to reading the chart. Links into U2–U5 rather than restating them.
- **Capture fixture:** the U2 fixtures, reused for one end-state image.
- **DoD:** the section exists; every step names a shipped control label; it links to each of `calendars.md`, `calendar-editor.md`, `calendar-sets.md` and `legend.md`; it carries at least one image; `mkdocs build --strict` green.

### U7. Slim the release notes

- **Files:** `docs/releases/0.1.0-beta.11.md`, `docs/releases.md` (regenerated).
- **Work:** rewrite each feature entry as a short summary plus a link to its new page. Keep the Fixed section substantive — no docs pages back it, and bug fixes get no imagery (KD4). Keep the @donaldwdci credit, keep #311 linked with its open residual stated. **Reset the `<!-- release-date: -->` comment**, which currently reads `2026-09-20`, the drafting day.
- **DoD:** `node scripts/update-release-index.mjs --check` exits 0; every `https://tngantt.com/...` link in the file resolves against the built site (check the paths against `website/docs/` — `mkdocs --strict` does **not** see this file, R10); no manifest change in this PR.

### U8. Cut the tag

- **Work:** `npm version 0.1.0-beta.11` on a throwaway `release/*` branch cut from `main`, per `docs/releases/RELEASING.md`. Separate from U7 by construction — the manifest bump never rides the notes PR, and CI's clean-manifest guard enforces that on `main`.
- **DoD:** the tag exists, the GitHub release is published with the notes body, and the in-app What's New bundle regenerated from notes present on `main`. #311 is left open for the maintainer to close.

---

## Verification Contract

Per unit, before push:

```bash
pip install -r website/requirements.txt          # mkdocs is not installed by default on this machine
mkdocs build --strict -f website/mkdocs.yml      # R10; units touching website/
node scripts/update-release-index.mjs --check    # U7, and any PR touching docs/releases/
npx jest                                          # full suite when a unit adds or changes a *.test.ts
npm run e2e:local -- --spec test/specs/<the-new-spec>.e2e.ts   # U3: see below
```

⚠️ **`npx jest` does not run a WDIO spec.** `jest.config.mjs:32` is `testMatch: ["**/*.test.ts"]`, so U3's new `gantt-calendar-editor-shots.e2e.ts` would pass every gate listed above while being entirely broken — a bad selector, a failed assertion or an unload failure would go unseen. Any unit that adds or edits a `*.e2e.ts` must run that spec through `e2e:local` and report its result.

Plus the repo's standing two-layer pre-push review gate (`ce-code-review` + the independent cross-model peer, both receipts recorded) and the hosted final gate. **Run the layers sequentially and do not commit while the peer is running** — the wrapper binds its receipt to the exact head and refuses when HEAD moves underneath it. This was learned the expensive way on 2026-09-20: three rounds were wasted to a moving head.

**Screenshot review is visual, by a human or an agent opening the file.** The stale legend PNGs passed every mechanical check and were still wrong.

## Definition of Done (campaign)

1. No page documents a control that does not ship, and every shipped setting is documented exactly once on its own group's page — proven by the U1 option-walking check, not a source grep.
2. Working-time calendars, the calendar editor, calendar sets, and the legend each have a page with imagery.
3. Every image referenced anywhere depicts post-#412 behaviour, confirmed by opening it.
4. `mkdocs build --strict` green; nav reads concept-before-control.
5. The beta.11 notes are short and linked, dated to the real tag day, and `0.1.0-beta.11` is tagged and published.

## Appendix — Sources

- Gap measurement and reproduce commands: § Measurement, derived at `fe3d3380`.
- Fact-checked inventory of the change set: `docs/releases/0.1.0-beta.11.md` as drafted on `docs/release-notes-0.1.0-beta.11` — an input to re-verify, not an authority.
- Site contract and R14: `docs/plans/2026-07-13-001-docs-user-documentation-site-plan.md`.
- Image and capture conventions, including the fixture-only vault rule: `docs/conventions/visual-assets.md`.
- Ranked defect list: `docs/reports/2026-08-15-001-maintainability-rediagnosis.md`.
- Release procedure: `docs/releases/RELEASING.md`.
- Parked captures and the `ce-demo-reel` availability note: `docs/backlogs/backlog.md` § Visual assets.
