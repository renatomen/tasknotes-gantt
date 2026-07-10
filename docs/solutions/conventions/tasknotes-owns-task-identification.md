---
title: TaskNotes owns task identification — consume it via the API, never infer it
date: 2026-07-11
category: conventions
module: bases-gantt
problem_type: convention
component: tooling
severity: high
applies_when:
  - "Any code path needs to know whether a note is a TaskNotes task (editability, write gating, enrichment, filtering)"
  - "A new feature is tempted to check tags or frontmatter to decide taskness"
tags: [tasknotes, task-identification, api, datasource, no-handrolling]
---

# TaskNotes owns task identification — consume it via the API, never infer it

## Context

TaskNotes lets users decide what makes a note a task: **by tag** (a configured task tag) or **by property** (a chosen frontmatter property plus the value that marks a note as a task). The mechanism is user-configurable and computed by TaskNotes; its APIs (`api.tasks.list()`, `api.tasks.get(path)`) and enrichment results already answer "is this a task" with resolved TaskInfo. During the inline-editing series, a per-row editability helper was briefly hand-rolled in the view layer (guarded `app.plugins` access + per-path lookups) and a session-level explanation mis-described identification as tag-only — the maintainer corrected both.

## Guidance

- Any "is this row/note a TaskNotes task" question resolves through TaskNotes: `api.tasks.get`/`api.tasks.list` or the enrichment data already flowing through the plugin's pipeline. Never grep tags or frontmatter to decide taskness — that breaks for property-identified vaults.
- Surface such knowledge as a **DataSource capability**, mirroring the existing ones: `TaskNotesSource` implements it from the API, `CompositeSource` delegates to the enrichment, the controller exposes a source-agnostic accessor and caches it with the other enrichment caches (invalidated on the `enrichmentDirty` signal). `getManagedPaths()` (PR #227) is the worked example, shaped exactly like `getStatusColors()`/`getPriorityColors()`.
- More broadly: TaskNotes owns the whole task CRUD surface, including identification, canonical frontmatter mapping, and value sets (statuses/priorities). Before building on any TaskNotes or SVAR behavior, check this repo's reference docs (docs/architecture/overview.md, docs/solutions/) — the seam has usually been established once already.

## Why This Matters

Hand-rolled identification silently misclassifies every vault configured differently from the author's, and a second identification path drifts from the one the write gate enforces — the view could offer an editor the write would refuse. Consuming the API keeps one truth, and the datasource-capability shape keeps the view layer free of plugin-registry reach-arounds.

## When to Apply

- Adding any per-row or per-note behavior gated on taskness (editing, styling, filtering, context menus).
- Reviewing code that touches `app.plugins.getPlugin('tasknotes')` outside the datasource layer — that placement is the smell.

## Examples

Before: a view-layer module resolving managed paths via per-path `tasks.get` sweeps behind its own plugin-registry access. After: `DataSource.getManagedPaths()` consuming `api.tasks.list()` verbatim, delegated through `CompositeSource` and cached in the controller (`src/datasource/TaskNotesSource.ts`, `src/datasource/CompositeSource.ts`, `src/controller/GanttController.ts`).

## Related

- docs/solutions/architecture-patterns/property-agnostic-field-resolution.md — the sibling rule for field/property names.
- docs/solutions/integration-issues/tasknotes-status-palette-wrong-api-path.md — verify TaskNotes surfaces against the shipped artifact.
