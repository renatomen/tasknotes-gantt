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
- **Why now:** `0.1.0-beta.10` shipped 2026-07-13. 213 commits have merged since, including the entire working-time calendar feature set, none of which the site documents — while two settings the site *does* document no longer exist. The maintainer ruled on 2026-09-20 that the tag waits for the documentation rather than shipping ahead of it.
- **Authority:** AGENTS.md and the engineering charter bind. This plan operationalizes R14 of `docs/plans/2026-07-13-001-docs-user-documentation-site-plan.md` — "a release is not done until shipped behavior is reflected in the docs" — for the beta.11 change set.
- **Execution profile:** **one PR per unit**, squash-merged on green, in the order below. U1 first because wrong documentation actively misleads while missing documentation only disappoints; U1b makes that correction hold and may land any time after U1. U2–U5 are independent of each other and may be reordered; U6 depends on U2–U5 existing to link into; U7 and U8 are last and gate the tag.
- **Stop conditions:** a red `mkdocs build --strict` outranks new prose. A screenshot that cannot be staged from a committed `test/vaults/*` fixture is parked in `docs/backlogs/backlog.md` rather than faked, cropped from a stale capture, or taken from any real vault.

### Resuming this campaign

**The tree is the index, because artifacts cannot lie about themselves.** Every unit below names the exact file it creates or the exact heading it adds; a unit has landed when that artifact is on `main` and not before:

Every probe below reads **`origin/main` after a fetch**, never the working tree and
never local `main`. A resume run from an abandoned branch would otherwise record its
own unmerged work as landed — and local `main` does not advance on its own while you
sit on a feature branch, so a unit merged remotely would read as *absent* and be done
twice:

```bash
git fetch --quiet origin main
git ls-tree --name-only origin/main website/docs/features/   # calendars.md, calendar-editor.md, calendar-sets.md, legend.md
git log --oneline --diff-filter=A origin/main -- docs/media/ # captures, campaign-added ones mixed with 11 pre-existing
# U1 is the one unit whose artifact is not a new file, so probe its CONTENT, not a
# heading count: a count moves 9 -> 10, which an unrelated edit could also produce.
# Absence of the deleted pair and presence of the added trio is what only U1 produces.
git show origin/main:website/docs/settings/appearance.md | grep -cE '^## (Bar color mode|Bar color source)'  # 0 once U1 landed
git show origin/main:website/docs/settings/appearance.md | grep -cE '^## (Bar fill|Bar strip|Default legend position)'  # 3 once U1 landed
```

⚠️ **`mkdocs build` is not a resume probe.** It reads the **working tree**, so on an
abandoned branch it reports on that branch's unmerged state, not on what landed — it
can pass or fail for reasons unrelated to the campaign. It is the gate for the work in
front of you. To build what is actually on `origin/main`, do it in a throwaway worktree:

```bash
git worktree add --detach /tmp/og-main origin/main || exit 1
python3 -m mkdocs build --strict -f /tmp/og-main/website/mkdocs.yml; rc=$?
git worktree remove --force /tmp/og-main
exit "$rc"
```

⚠️ **Capture the build's status before cleaning up.** Chaining the removal with `;`
hands the recipe's exit code to `git worktree remove`, so a red build followed by a
successful cleanup exits 0 — silently defeating this plan's own "a red `mkdocs build
--strict` outranks new prose" stop condition. Same failure as piping a gate through
`grep`: the last command's status wins. Keep `rc`.

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

⚠️ **A source grep for `displayName:` is not the settings inventory and must not be used as a completeness gate.** Seven shipped controls are built through helpers and carry no literal — `familyToggle(...)` (`calendarItemOptions.ts:118,131,132,133`) produces *Show recurring tasks*, *Show time entries*, *Show timeblocks* and *Show property-based events*; `eventPropertyPicker(...)` (`:134,139,144`) produces the event-property pickers; per-feed external toggles are dynamic (`:247`). Four helper toggles plus three pickers is where the seven comes from — an earlier draft named only three toggles, leaving the count unexplained. The same grep also counts five group and section *labels* as if they were settings.

⚠️ **Nor is walking `ganttViewOptions()` and `calendarItemOptionsGroup()` the inventory.** The registered set is *assembled*, not returned: `register.ts:1849-1875` calls `calendarItemOptionsGroup()` and then **mutates** it — `calendarItems.items.push(...externalCalendarOptionEntries(...))` and, when the session degraded, `push(externalCalendarDegradedEntry())` — before returning it beside `ganttViewOptions(isTaskNotesPresent(app), hasProgressProperty)`. A script calling those two builders directly never sees the pushed entries, so every external-calendar control is structurally outside its denominator, and any control added to that callback in future is invisible to it forever. The single source of truth is the registered `options:` callback itself (see U1b).

### Wrong — the site documents controls that do not exist

| Page | Documents | Reality |
|---|---|---|
| `settings/appearance.md:6` | **Bar color mode** | Removed by #312 (`git log -S tngantt_barColorMode` → `5a7cdde1`); `grep -rn barColorMode src/` → no match |
| `settings/appearance.md:15` | **Bar color source** | Replaced by `Bar fill` + `Bar strip` (#312); `grep -rn barColorSource src/` → no match |

**Two, not three. `Theme mode` belongs in the next section, not this one.** An
earlier draft of this table listed it here; that was wrong and would have cost a
shipped control its documentation. The control ships — `themeResolver.ts`,
`GanttToolbar.svelte`, `GanttContainer.svelte:2228` — and `appearance.md:52-56`
already states the one thing a reader needs: *"(Set from the toolbar, not this
menu — enable **Show toolbar** first.)"*. What is true of it is narrower than
"removed": it is not a **view option** (`viewOptions.ts:414-418` says so in
terms), and the page already says so. Deleting that section would violate R1/R2
from the opposite direction — a shipped control documented nowhere.

### Missing settings

`Bar fill` (:376), `Bar strip` (:390), `Default legend position` (:427) — Appearance; `Estimate meaning` (:273), `Non-working-day rendering` (:285), `Inferred date drag` (:334) — Timeline; `Calendar Property` (:84), `Estimate meaning override` (:232) — Fields. **Eight, not nine.** `Progress Property` is *not* missing: `viewOptions.ts:504,516,523` deliberately removes it from Fields and places it in the Progress group, where `website/docs/settings/progress.md:6` already documents it. Do not add it to `fields.md`.

⚠️ **One shipped control's heading already carries a MkDocs attribute list:** `website/docs/settings/fields.md:52` is `## Time Estimate Property { #time-estimate-property }`, against `displayName: 'Time Estimate Property'` (`viewOptions.ts:216`). An exact set-diff reports it undocumented on the first run. The repair is to strip a trailing attribute list before comparing — **not** to loosen matching generally (see U1b).

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
- **R6.** Images follow `docs/conventions/visual-assets.md`: markdown syntax only, absolute `raw.githubusercontent.com` URLs. **Website pages pin to `main`** — verified across all **27** existing site image references (25 distinct files over 8 pages), re-measured 2026-09-20 with `grep -rho 'https://raw.githubusercontent.com/renatomen/tasknotes-gantt/[^)]*' website/docs/ | wc -l`. All 27 carry `/main/`; the rule holds. (An earlier draft said 15 — the rule was right, the denominator was not, in a plan whose whole premise is that asserted inventories mislead. Cite the command, not a remembered number.) That rule is real by observation but is written nowhere; U1 adds it to `docs/conventions/visual-assets.md` under `## How assets are referenced` so the next author is not guessing. Release notes pin to the release tag. Never catbox, never relative paths, never raw HTML.
- **R7.** Chart screenshots carrying colour meaning ship as a **light + dark pair** (`bars-*-light.png` / `bars-*-dark.png` precedent). Settings-panel and modal shots may be single.
- **R8.** Granularity is stated wherever a reader could infer hour-level scheduling: a calendar authors working hours and **the Week preview displays them**, but nothing schedules or shades by them yet (`workingDays.ts:5-11`, `weekPreviewLayout.ts:3-9`). "Nothing reads them" is too strong and must not be written.
- **R9.** Accepted gaps are disclosed where a user would otherwise be confused: a swapped task under split rendering has no cue; a bar too narrow to carry a tooth shows no date-status signal; rewriting a frontmatter field drops comments inside that field.
- **R10.** `mkdocs build --strict -f website/mkdocs.yml` passes on every unit **that touches `website/`**. The CI gate (`.github/workflows/docs.yml`) is path-filtered to `website/**`, so it does **not** run on U7; U7 is gated by the release-index check instead.
- **R11.** New pages are added to `nav:` in `website/mkdocs.yml` in a reading order that puts concept before control. ⚠️ **`--strict` does not currently enforce this.** `website/mkdocs.yml` has no `validation:` key, so `validation.nav.omitted_files` keeps its MkDocs ≥1.5 default of INFO, which `--strict` does not escalate — a page left out of `nav` builds green. The first unit to add a page (U2) also adds `validation: {nav: {omitted_files: warn, not_found: warn}, links: {absolute_links: warn}}` to `website/mkdocs.yml`, which `--strict` then turns into a failure.
- **R12.** Interoperability is described accurately: working patterns are authored as **RFC 5545 RRULE values**, which is why the syntax is familiar and portable. There is **no iCalendar import or export** — a calendar note is plugin frontmatter in Markdown, and `rfcMapping.ts` *projects* the model onto RFC shapes — it imports **from** `schema.ts`, and its only importer repo-wide is `test/unit/calendarRfcRoundTrip.test.ts`. No module under `src/` consumes it and there is no `.ics` path (`grep -rln '\.ics\b' src/` → no match). (An earlier draft had this dependency backwards, saying `schema.ts` consumed it; `schema.ts` imports nothing at all.) Do not write that another RFC client can read the note.

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

**State it as a command that can fail, base-pinned:**

```bash
test -z "$(git diff --stat origin/main...HEAD -- test/specs/gantt-calendar-editor.e2e.ts)"
```

A bare `git diff --stat` compares the worktree to the index, so on any committed tree it prints nothing and the guard passes for a PR that rewrote the file line by line. The `origin/main...HEAD` form is the one that can actually go red.

---

## Implementation Units

Each unit: its files, its capture fixture, its Definition of Done. Landing: one unit, one PR.

### U1. Correct the settings pages, and write down the image-pinning rule

- **Why first:** a user following `settings/appearance.md` today looks for "Bar color mode" and does not find it. Wrong instructions cost more than absent ones.
- **Scope note (decided 2026-09-20, after six peer rounds):** the settings-coverage *guard* is **U1b**, not U1. Bundling a docs correction with a completeness-checking mechanism made this unit un-specifiable — six review rounds found successive holes in a prose description of that script while the documentation work itself was never in doubt. Slicing finer than a unit is autonomous under the charter's landing cadence.
- **Files:** `website/docs/settings/appearance.md`, `website/docs/settings/timeline.md`, `website/docs/settings/fields.md`, `docs/conventions/visual-assets.md`. No ranked-defect file appears in this list.
- **Work:** delete **Bar color mode** and **Bar color source** — **and only those two**; **leave `Theme mode` exactly where it is** (§ Measurement: it ships from the toolbar and the page already says so). Add **Bar fill**, **Bar strip**, **Default legend position** (Appearance), **Estimate meaning**, **Non-working-day rendering**, **Inferred date drag** (Timeline), **Calendar Property**, **Estimate meaning override** (Fields) — the eight from § Measurement, each on its own group's page. Leave `Progress Property` where it is. Add the website-pins-to-`main` rule to the convention per R6, under `## How assets are referenced`, beside the existing PR-body and release-notes bullets (there is **no** `§ pinning` heading; an earlier draft of R6 named one that does not exist).
- **Capture fixture:** the Appearance and Timeline view-option panels, staged from **`test/vaults/gantt-calendar`** (named per KD2 — "any committed fixture" is not a name). Single shots, `view-settings-groups-light.png` precedent. **Run the capture as `OBSIDIAN_TEST_VAULT="$(pwd)/.wdio-vault" npm run e2e:local -- --spec <spec>`** — an explicit throwaway path, and **never the cleared form**. ⚠️ `OBSIDIAN_TEST_VAULT=` does *not* enforce KD1: `scripts/e2e-local.mjs:16-17` is `process.env.OBSIDIAN_TEST_VAULT || LOCAL_VAULT`, so an empty value is falsy and gets replaced by a hardcoded fallback, and the Vite build **installs the plugin into whatever that resolves to** (`closeBundle` → `install-to-vault.mjs`). `.env` also defines the variable. A non-empty explicit path survives that `||`, is what `wdio.conf.mts:12-13` then copies from, and is gitignored (`.gitignore:20`).
- **DoD:**
  - `grep -cE '^## (Bar color mode|Bar color source)' website/docs/settings/appearance.md` is 0; `grep -c '^## Theme mode' website/docs/settings/appearance.md` is **1** (the deletion guard and the do-not-delete guard, stated as commands).
  - Each of the eight added controls has exactly one `##`/`###` heading, on its own group's page, matching its `displayName` in § Measurement exactly.
  - `python3 -m mkdocs build --strict -f website/mkdocs.yml` green (the bare `mkdocs` binary is not on PATH here); `npx jest` green.
  - Both captured panels opened and looked at before being referenced — a green gate is not a reviewed image.

### U1b. A committed settings-coverage guard

- **Why separate:** U1 corrects the pages once; this unit makes the correction hold. It is a script, a CI wiring, two test files and a source constant — a unit's worth of mechanism, and the source of every finding in peer rounds 1–6 while it was buried inside a documentation unit.
- **Files:** `scripts/check-settings-coverage.mjs` (new), `.github/workflows/ci.yml`, `test/unit/checkSettingsCoverage.test.ts` (new), `test/unit/settingsCoverageParity.test.ts` (new), `src/bases/themeResolver.ts` (one exported constant — **not** a ranked-defect file; verified absent from `docs/reports/2026-08-15-001-maintainability-rediagnosis.md`), `src/bases/calendarItemOptions.ts` (export one ordered provider registry — likewise not ranked), and `website/docs/settings/calendar-items.md` if the guard's provider matrix surfaces a genuinely undocumented control. **U1b does not touch `src/bases/register.ts` (ranked entry 2).**
- **Design is settled during implementation, against real code — not here.** What follows is the contract, not a specification of the script: the property it must enforce, the traps already measured, and the mutation set that is its acceptance test. An implementation that reddens every mutation satisfies this unit however it is written; one that cannot is not rescued by matching this prose.

- **DoD — the mutation set is the contract.**
  - **Compose what `register.ts` composes — and do not edit `register.ts` to do it.** `register.ts:1849-1875` assembles the real set: it calls `calendarItemOptionsGroup()`, **mutates** it with `externalCalendarOptionEntries(...)` and `externalCalendarDegradedEntry()`, and returns that beside `ganttViewOptions(companionAvailable, hasProgressProperty)`. Walking the first two builders alone misses every pushed entry, so the script imports **all four** exported builders and composes them in that same order.
    - ⚠️ **`src/bases/register.ts` is ranked-defect entry 2** (`docs/reports/2026-08-15-001-maintainability-rediagnosis.md:230` — 14.9% churn × 14 concerns in 1,872 lines). It is **not** in U1's Files and U1 must not touch it. An earlier revision of this DoD said to "extract an exported builder from that callback" — that authorized an uncontracted ranked-file edit with no ranking citation, no touch argument and no non-regression DoD, which is itself a P1 under the AGENTS.md invariant.
    - **A mirrored reconstruction cannot police the thing it mirrors, so pin it with a parity test.** A control added *directly* to the array the callback returns changes the shipped options without changing any builder the script imports — the guard stays green and the control escapes R1/R2. U1 therefore adds `test/unit/settingsCoverageParity.test.ts`, which **captures the real registered callback** and asserts it matches the script's composition across the whole argument matrix. **Compare `(group displayName, control displayName, key)` triples, not a flat set of names** — a bare name set discards ownership and cardinality exactly as the coverage check did before mutation (6)/(7): if the callback moved `Estimate meaning` from Timeline to Appearance, or appended a second option reusing an existing label, the name sets would still be equal and the parity test would pass while the shipped UI disagreed with the docs. Reuse the mock already proven in `test/unit/externalCalendarDegradeNotice.test.ts:83-104`: pass a stub plugin whose `registerBasesView(_id, opts)` captures `opts`, call `registerBasesGantt(plugin, lifetime)`, then invoke `opts.options(config)`. Reuse that mechanism; do not write a second one.
    - This is what makes mutation (5) below satisfiable and keeps `register.ts` untouched: the parity test observes the callback's *output*, so it needs no source parsing and no seam extraction.
    - **Known residual, stated rather than hidden:** the script still mirrors the callback's assembly order, and the parity test is what detects drift rather than preventing it. The preventive remedy is extracting that assembly into its own module so the callback becomes a single delegating call — ranked entry 2's *own* prescribed remedy ("the ~20 option readers and the calendar/picker cluster are clean extract candidates") — which needs its own unit carrying the full ranked-file contract. Filed in `docs/backlogs/backlog.md`; until it lands, the script carries a comment naming `register.ts:1849-1875` as the assembly it mirrors.
  - **Pin the argument matrix, because it is the denominator.** Union the collected `displayName`s over: `companionAvailable` ∈ {true, false} × `hasProgressProperty` ∈ {true, false}, with an injected handle supplying **one feed per provider in `EXTERNAL_PROVIDER_ORDER` / `EXTERNAL_PROVIDER_SECTIONS`** (`calendarItemOptions.ts:173,194`), and the degraded signal both set and clear. **Derive that provider list from one exported, type-exhaustive ordered registry that production itself iterates — never hardcode ICS/Google/Microsoft, and do not assume the current registries are exhaustive.** Measured: `EXTERNAL_PROVIDER_SECTIONS` is a `Record<ExternalCalendarProviderKind, …>` and so is complete by type, but `EXTERNAL_PROVIDER_ORDER` (`calendarItemOptions.ts:194`) is a **non-exported plain `readonly ExternalCalendarProviderKind[]`** — and production iterates *that*. Adding `caldav` to the union and to `SECTIONS` while omitting it from `ORDER` compiles, drops its options in production, and leaves a fixture derived from `ORDER` green on both checks. U1b therefore exports a single ordered registry derived from the `Record`'s keys and has production consume it, so order and completeness cannot diverge. A hardcoded triple would leave a new provider's controls undocumented with both the guard and the parity test green (CONCEPTS.md § Derived member list; `docs/solutions/best-practices/derive-the-member-list-from-keyof-not-a-runtime-probe.md`). Left unstated, a bare `ganttViewOptions()` silently drops the companion-gated Relationships, Progress mode and Time Estimate Update.
  - **Exempt the per-feed toggles by key shape, never by name.** `externalCalendarOptionEntries` sets `displayName: feed.name` (`calendarItemOptions.ts:247`) — that is the *user's* calendar name, so a feed called "Payroll" puts `Payroll` in the denominator and no static heading can ever match it. Exempt those entries by testing their key against the exported `externalCalendarToggleKey` helper's prefix, not by matching names or maintaining a list. The static section headings (`ICS calendars`, `Google calendars`, `Microsoft calendars`) and the degraded entry (`External calendars`) are **not** exempt — they are fixed strings and must be documented.
  - **The guard's domain is view-options controls, and `Theme mode` is outside it — so guard it separately.** Theme mode is persisted from the toolbar and never appears in the `options:` callback (`viewOptions.ts:414-418`), so deleting `## Theme mode` from `appearance.md` would pass this check unnoticed — leaving unguarded the very control this plan rescued. U1 therefore also exports a `TOOLBAR_PERSISTED_CONTROLS` constant from `src/bases/themeResolver.ts` (not a ranked file), unions it into the script's inventory, and adds a unit test asserting the toolbar's rendered labels match it — so adding a toolbar control without documenting it fails, and the constant cannot silently fall out of date. ⚠️ **Each entry needs three fields, not one string: the rendered `uiLabel`, the `docHeading`, and the owning page.** They genuinely differ — `GanttToolbar.svelte:53` renders `Theme`, while the documentation heading is `## Theme mode` (`appearance.md:52`) — so a single-string constant cannot satisfy both the rendered-label assertion and the exact heading match, and whichever one it is written for makes the other fail.
  - **Normalization is narrow and stated:** strip a trailing MkDocs attribute list (`/\s*\{[^}]*\}\s*$/`) and trim; then match **exactly and case-sensitively**. No substring, prefix or fuzzy matching — a loosened matcher would let one `## Bar fill and strip` heading satisfy both `Bar fill` and `Bar strip`.
  - **Assert R2's actual property, which is cardinality and ownership — not set membership.** R2 says each control is documented *on its own group's page, exactly once*. Two set-differences cannot express that: putting `## Estimate meaning` in `appearance.md` instead of `timeline.md`, or in **both**, leaves both differences empty and the guard green. So for each shipped control the check asserts **exactly one** matching heading exists across all of `website/docs/settings/*.md`, and that it is on the page owned by the control's group.
    - **Ownership is derivable, not a maintained mapping.** The top-level groups are `Fields`, `Progress`, `Relationships`, `Timeline`, `Appearance` (`viewOptions.ts:522-528`) and `Calendar items` (`calendarItemOptions.ts:116`); the pages are exactly their kebab-case slugs — `fields.md`, `progress.md`, `relationships.md`, `timeline.md`, `appearance.md`, `calendar-items.md`. Derive the filename from the group's `displayName`; a new group with no matching page must fail loudly rather than be added to a list.
  - **Direction that must be empty: every shipped control has exactly one heading, on its own group's page.** This is the direction that catches an undocumented, duplicated or misfiled setting, and it is the one U1 is accountable for.
  - The reverse direction is *not* empty and must not be asserted to be. Settings pages legitimately carry non-control headings (`## Related`, `## Not a view setting: the quick source switcher`, `## The groups`, `## Companion vs. standalone`, `## External calendars`), three controls are deliberately collapsed into one `### Event start / end / title property` heading, and per-feed external toggles are named after the user's own feeds. The allow-list lives **in the committed script**, one comment per entry saying why that heading is not a control; any heading matching neither it nor a shipped control is **reported and exits non-zero** for a human decision, never silently ignored.
  - **Prove the check works with a mutation SET, one per class § Measurement warns about** — **all seven** must fail before the check is trusted, each restored by inverse edit, never `git checkout`: (1) `## Show recurring tasks` (static, exact); (2) `## Time Estimate Property { #time-estimate-property }` (attribute-list heading); (3) `### Event start / end / title property` (collapsed — must name all three); (4) a companion-gated heading such as `## Expanded relationships`; (5) a throwaway control added directly to the array `register.ts`'s options callback returns — this one must turn **`settingsCoverageParity.test.ts`** red, not the script, because the script composes builders from outside and structurally cannot see it; (6) **move** one heading to the wrong group's page (e.g. `## Estimate meaning` from `timeline.md` to `appearance.md`); (7) **duplicate** one heading onto a second page. Mutations (6) and (7) are what prove R2 rather than mere membership — a set-difference check passes both. One mutant proves only the easiest path.

  ⚠️ **This DoD states the property and the mutations that prove it; it deliberately stops short of specifying the script's internals.** Three peer rounds each found a fresh hole in a prose specification of a program, which is the wrong artifact for the job. **The mutation set is the specification** — an implementation that turns all seven red satisfies U1b however it is written, and one that cannot is not saved by matching this prose.
  - **It runs on every PR, or it is memory rather than mechanism** (AGENTS.md, rule of the house). Wire it into **`.github/workflows/ci.yml`**, which has no `paths:` filter — **not** `docs.yml`, which is filtered to `website/**` and so would never fire on the PR that adds a control in `src/`, the exact drift this guard exists to catch. Cover the script with `test/unit/checkSettingsCoverage.test.ts` so `npx jest` exercises its allow-list branch too.
  - `python3 -m mkdocs build --strict -f website/mkdocs.yml` green (the bare `mkdocs` binary is not on PATH here); `npx jest` green.

### U2. Calendars and working time

- **Files:** `website/docs/features/calendars.md` (new), `website/docs/features/appearance.md` (Weekend shading section only), `website/mkdocs.yml` nav.
- **Content:** what a calendar note is; **Select calendars…**; non-working days as background shading; **Estimate meaning → Working days** stretching a worked-out span, and that it is opt-in (ships as *Calendar days*); that **Non-working-day rendering → Split segments** *adds* segments over shading rather than replacing it; that authored dates never move and a fully dateless placeholder does not stretch; granularity per R8; RRULE values per R12.
- **Capture fixtures:** `test/specs/gantt-calendar-shading.e2e.ts` and `test/specs/gantt-calendar-stretch.e2e.ts`, with their `test/vaults/*` fixtures. Light + dark pairs per R7.
- **DoD:** the page contains a numbered procedure from "no calendar" to a shaded, stretched chart, naming each control by its shipped label; every behavioural claim cites a path under `src/controller/calendar/` or `src/bases/calendarShading.ts` in the PR body; the Weekend shading section links to this page.

### U3. Calendar notes and the visual editor

- **Files:** `website/docs/features/calendar-editor.md` (new), `test/specs/gantt-calendar-editor-shots.e2e.ts` (new — see the ranked-defect contract), nav.
- **Content:** **Create calendar** / **Create calendar set**; the form; the working-pattern (RRULE) builder; the year-grid, week and Gantt-strip preview tabs — noting the Week preview is the one surface that shows authored hours (R8); the timezone picker with live UTC offsets; the colour picker; the sticky header, unsaved-changes cue and close guard; renaming from the Name field; **Open calendar note as markdown**; availability blocks as *added* working time with `non_working` for days off; the frontmatter-comment caveat (R9).
- **Capture fixture:** the new shots spec, reusing the existing calendar-editor `test/vaults/*` fixture. `test/specs/_local-calendar-editor-shots.e2e.ts` is an uncommitted local probe — mine it for technique, do not depend on it, and leave it alone (`_local-*` specs are gitignored and hang `e2e:local`).
- **DoD:** every tab and top-level control in `src/editor/CalendarEditorForm.svelte` is either documented or listed in the PR body as deliberately out of scope with a reason — **"top-level control" means every element the form's own markup renders directly in a tab panel (button, input, select, toggle), not elements nested inside a child component**; enumerate them from the file and list the enumeration in the PR body so the denominator is reviewable. `test -z "$(git diff --stat origin/main...HEAD -- test/specs/gantt-calendar-editor.e2e.ts)"` passes (base-pinned; a bare `git diff --stat` is empty on any committed tree and proves nothing).
- **Ordering independence, because the ranked concern is shared mutable fixture state, not line count.** Entry 6's measured pain is "four separable suites serially mutating one fixture vault"; a fifth suite on the same `test/vaults/gantt-calendar` fixture reproduces it while the file-scoped guard stays green. Run `OBSIDIAN_TEST_VAULT="$(pwd)/.wdio-vault" npm run e2e:local` over both `gantt-calendar-editor.e2e.ts` and the new shots spec in **both orders**, report both results, and state in the PR body whether the shots spec mutates shared vault state and cleans up after itself.

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

- **Files:** `docs/releases/0.1.0-beta.11.md`, `docs/releases.md` (regenerated), `scripts/check-release-note-links.mjs` (new — the gate below has to exist somewhere), `test/unit/checkReleaseNoteLinks.test.ts` (new), `.github/workflows/ci.yml` (wire it; `docs.yml` is path-filtered to `website/**` and never sees `docs/releases/`).
- **Work:** rewrite each feature entry as a short summary plus a link to its new page. Keep the Fixed section substantive — no docs pages back it, and bug fixes get no imagery (KD4). Keep the @donaldwdci credit, keep #311 linked with its open residual stated. Leave the `<!-- release-date: -->` comment as an explicitly non-final placeholder — **U8 sets it**, because U7 runs first and cannot know the tag day (`releaseFiles.mjs:220` throws only on an *absent* date line, never a stale one, and `generate-release-notes-import.mjs:9` bakes whatever it finds into the in-app What's New bundle).
- **DoD:** `node scripts/update-release-index.mjs --check` exits 0 — **but note it is green before, during and after U7**: it reads only filenames (`update-release-index.mjs:57` is the whole per-release payload) and U7 renames nothing, so it cannot fail on anything U7 does. It is a supplement, not the gate. **The gate U7 must add and pass** is an executable link check with a non-zero exit: resolve every `https://tngantt.com/<path>` in the changed release file against `website/docs/<path>.md` or `<path>/index.md`, and every `raw.githubusercontent.com` URL against a file present in `docs/media/` (Material serves directory-style URLs, so accept both the `.md` and the `index.md` form). ⚠️ **It must also assert each image ref equals this note's own version.** The existing validator only requires a *release-shaped* ref (`releaseFiles.mjs:168` `isReleaseRef`) and then checks asset presence "against the current tree rather than its ref" (`:176-177`), so a beta.11 note pinning an image to `0.1.0-beta.10` passes every gate today and renders that older tag's bytes — an R6 violation no check sees. Parse each ref and require it to equal `0.1.0-beta.11`. `mkdocs --strict` does **not** see this file (R10). No manifest change in this PR.

### U8. Cut the tag

- **Work:** `npm version 0.1.0-beta.11` on a throwaway `release/*` branch cut from `main`, per `docs/releases/RELEASING.md`. Separate from U7 by construction — the manifest bump never rides the notes PR, and CI's clean-manifest guard enforces that on `main`.
- **DoD:** the tag exists, the GitHub release is published with the notes body, and the in-app What's New bundle regenerated from notes present on `main`. **Set `<!-- release-date: -->` to the tag day on `main`, in its own small PR, *before* cutting the release branch** — then cut `release/*` from that commit. `docs/releases/RELEASING.md:105-106` says the `release/*` branch is **never merged**, so a date correction committed there is stranded: `main` and every regenerated What's New bundle keep the provisional date, while leaving it uncommitted makes `npm version` refuse a dirty tree. Verify afterwards against `git log -1 --format=%ad --date=short <tag>`. **After the tag exists, confirm every `raw.githubusercontent.com/.../<tag>/...` URL in `docs/releases/0.1.0-beta.11.md` returns HTTP 200** — until the tag is cut those URLs 404 by design (`visual-assets.md`: release notes pin to the release tag), and this is the only point at which that can be checked. #311 is left open for the maintainer to close.

---

## Verification Contract

Per unit, before push:

```bash
pip install -r website/requirements.txt              # mkdocs is not installed by default on this machine
python3 -m mkdocs build --strict -f website/mkdocs.yml  # R10; units touching website/ (bare `mkdocs` is not on PATH)
node scripts/update-release-index.mjs --check        # U7, and any PR touching docs/releases/
node scripts/check-settings-coverage.mjs             # from U1b on, every unit — the completeness guard
npx jest                                              # EVERY unit, always — see below
OBSIDIAN_TEST_VAULT="$(pwd)/.wdio-vault" npm run e2e:local -- --spec test/specs/<the-new-spec>.e2e.ts  # U3; an EXPLICIT throwaway path, never the cleared form — see U1

```

⚠️ **`npx jest` does not run a WDIO spec.** `jest.config.mjs:32` is `testMatch: ["**/*.test.ts"]`, so U3's new `gantt-calendar-editor-shots.e2e.ts` would pass every gate listed above while being entirely broken — a bad selector, a failed assertion or an unload failure would go unseen. Any unit that adds or edits a `*.e2e.ts` must run that spec through `e2e:local` and report its result.

⚠️ **Run `npx jest` on every unit, not only when a unit touches a `*.test.ts`.** An earlier draft of this contract triggered it on changed test files, which is the same false-pass shape one line up: six committed suites — `releaseImages`, `releaseNoteLinks`, `releaseIndex`, `releaseNotesBundle`, `releaseCI`, `visualAssets` — assert directly on `docs/releases/**` and `docs/media/**`, so a units that changes only documentation can still break them. Measured 2026-09-20: the full suite is 184 suites / 4,183 tests in ~80s. It is cheap; run it.

⚠️ **A green mechanical gate is not a reviewed image.** Every unit that references an image opens each referenced file and looks at it. The two stale legend PNGs passed every check in this list.

Plus the repo's standing two-layer pre-push review gate (`ce-code-review` + the independent cross-model peer, both receipts recorded) and the hosted final gate. **Run the layers sequentially and do not commit while the peer is running** — the wrapper binds its receipt to the exact head and refuses when HEAD moves underneath it. This was learned the expensive way on 2026-09-20: three rounds were wasted to a moving head.

**Screenshot review is visual, by a human or an agent opening the file.** The stale legend PNGs passed every mechanical check and were still wrong.

## Definition of Done (campaign)

1. No page documents a control that does not ship, and every shipped setting is documented exactly once on its own group's page — proven by re-running `node scripts/check-settings-coverage.mjs` (U1b) on the tag commit and observing exit 0, not by a source grep and not by a measurement taken once in U1 and discarded.
2. Working-time calendars, the calendar editor, calendar sets, and the legend each have a page with imagery.
3. Every image referenced by `website/docs/**` or `docs/releases/**` depicts post-#412 behaviour, confirmed by opening it. **Scoped deliberately to what this campaign owns.** `README.md:45` still renders `gantt-legend-right.png` and `gantt-legend-bottom.png`, whose alt text names the retired *date-border* semantic, and the README is explicitly **out** of scope (§ Scope boundaries) — so "referenced anywhere" was a gate no unit could satisfy. The README's two stale references are parked in `docs/backlogs/backlog.md` instead.
4. `mkdocs build --strict` green — with the `validation:` block R11 requires, without which a page missing from `nav` builds green; nav reads concept-before-control.
5. The beta.11 notes are short and linked, dated to the real tag day, and `0.1.0-beta.11` is tagged and published.

## Appendix — Sources

- Gap measurement and reproduce commands: § Measurement, derived at `fe3d3380`.
- Fact-checked inventory of the change set: `docs/releases/0.1.0-beta.11.md` as drafted on `docs/release-notes-0.1.0-beta.11` — an input to re-verify, not an authority.
- Site contract and R14: `docs/plans/2026-07-13-001-docs-user-documentation-site-plan.md`.
- Image and capture conventions, including the fixture-only vault rule: `docs/conventions/visual-assets.md`.
- Ranked defect list: `docs/reports/2026-08-15-001-maintainability-rediagnosis.md`.
- Release procedure: `docs/releases/RELEASING.md`.
- Parked captures and the `ce-demo-reel` availability note: `docs/backlogs/backlog.md` § Visual assets.
