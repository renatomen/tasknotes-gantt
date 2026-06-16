---
title: Verify Obsidian UI/view work with the headless E2E harness, not manual checking
date: 2026-06-16
category: developer-experience
module: testing / Gantt view
problem_type: developer_experience
component: testing_framework
severity: medium
applies_when:
  - "Implementing or refactoring an Obsidian view or any plugin UI"
  - "Tempted to defer 'does it render / behave correctly' to manual checking"
  - "Writing acceptance criteria or verification for a view-bearing unit"
related_components:
  - development_workflow
  - tooling
tags:
  - e2e
  - wdio-obsidian
  - webdriverio
  - headless-testing
  - ui-verification
  - obsidian
---

# Verify Obsidian UI/view work with the headless E2E harness, not manual checking

## Context

While implementing a view-bearing unit (rewiring the SVAR Gantt view), an agent hesitated and proposed that the view's acceptance criteria — "real data renders," "multi-parent rows appear," "read-only affordances behave" — needed a human running Obsidian to verify, and recommended pausing for manual checking.

That was wrong, and it's an easy trap: "it's UI, so a human has to look at it." This repo already ships a **real headless Obsidian end-to-end harness** — WebdriverIO + `wdio-obsidian-service` (`test/wdio/wdio.conf.mts`, specs in `test/specs/*.e2e.ts`, run via `npm run e2e`). It downloads and boots the **actual Obsidian Electron app**, opens a vault, enables the built plugin, and lets WebDriver query the DOM and drive interactions. Functional UI acceptance is automatable here — it should not be punted to manual checking.

## Guidance

For UI/view work, write E2E specs that assert functional acceptance headlessly instead of deferring it to a human.

**What the harness CAN verify headlessly:**
- The view registers and renders **real data** (the Bases read-only path needs no TaskNotes; sample notes in the test vault suffice).
- DOM structure and counts — rows, SVAR bars (`.wx-bar`), columns, dependency link elements.
- **Multi-parent duplication** — a task with two visible parents renders as two rows (assert row count / instance ids).
- **Read-only affordances** — "Add Task" hidden, the editor modal gated, drag not persisting.
- Pointer-driven interactions via the WebDriver Actions API (drag/resize), and — once write-back exists — that the note's frontmatter actually changed (a true end-to-end assertion).

**What it genuinely CAN'T verify well (the only bits a human/extra tooling adds):**
- Real **touch-device gesture feel** (the `touch-action` CSS fix is about physical touch hardware; chromedriver fires synthetic pointer events, not real touch).
- **Pixel-level visual polish** — automatable only with screenshot diffing, which is extra scaffolding, not part of the functional harness.

So scope manual verification to those slivers only; everything functional gets an E2E spec.

## Why This Matters

The harness was set up at real cost (see the related setup doc — Norton cert, Node 20, vault env, Obsidian download). Treating UI acceptance as "manual only" wastes that investment, leaves view units unverified in CI, and lets regressions land. It also misleads planning: a unit's verification section should say "E2E spec asserts X" rather than "user confirms in Obsidian," because the former is real, repeatable, and CI-enforceable.

## When to Apply

- Implementing or refactoring any Obsidian view or plugin UI surface.
- Writing the `Verification` / `Test scenarios` for a view-bearing implementation unit — prefer an E2E spec over a manual-check note.
- The **Bases read-only path** needs no TaskNotes installed; the **TaskNotes path** needs the TaskNotes plugin present in the test vault.

## Examples

A read-only render spec (sketch) asserting multi-parent duplication, instead of "user checks the chart":

```ts
// test/specs/gantt-readonly-render.e2e.ts (sketch)
// Given a .base view with a task that has two visible parents,
// When the Gantt view renders,
// Then that task appears as two rows and "Add Task" is absent.
const rows = await browser.$$('.og-bases-gantt .wx-bar');
expect(rows.length).toBeGreaterThan(0);
// assert the multi-parent task's instance ids appear twice, etc.
```

Run-env caveats (from the setup doc): use Node 20 via fnm + the AV root cert; point `OBSIDIAN_TEST_VAULT` at a **disposable local copy** (never the live Google-Drive vault) for E2E; first run downloads Obsidian.

## Related

- `docs/solutions/developer-experience/windows-build-and-e2e-environment-setup.md` — how to get the build + E2E harness running (the prerequisite for these specs).
- `project/E2E Testing Plan - WebdriverIO Obsidian Service.md` — the E2E harness plan.
- `docs/plans/2026-06-16-001-feat-tasknotes-companion-gantt-plan.md` — U7 calls for a "new read-only render spec"; this learning is why that verification is headless, not manual.
