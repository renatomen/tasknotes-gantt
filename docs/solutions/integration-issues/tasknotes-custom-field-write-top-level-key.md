---
title: Writing a TaskNotes custom date field — top-level frontmatter key, not userFields/id
date: 2026-06-17
category: docs/solutions/integration-issues
module: datasource/TaskNotesSource
problem_type: integration_issue
component: service_object
symptoms:
  - "Dragging a Gantt bar whose start mapped to a TaskNotes custom date field didn't persist; the property never changed (survived restart)"
  - "Canonical scheduled/due edits persisted fine — only the custom user field silently failed"
  - "getFieldConfig() returned no custom date fields at all, so the mapping fell back to scheduled (invalid-mapping banner shown)"
  - "No error/Notice on the failing write — api.tasks.update accepted the payload and reported success"
root_cause: wrong_api
resolution_type: code_fix
severity: medium
tags: [tasknotes, integration, write-back, user-fields, frontmatter, public-api, silent-failure]
---

# Writing a TaskNotes custom date field — top-level frontmatter key, not userFields/id

## Problem

Mapping a Gantt bar's start date to a TaskNotes **custom user field** (type `date`) did not persist on drag, while canonical `scheduled`/`due` worked. The write reached TaskNotes' `api.tasks.update` with what looked like a correct payload, succeeded without error, and changed nothing. Reaching the working write took three sequential corrections, each a wrong assumption about TaskNotes' API/data shape.

## Symptoms

- Dragging the bar's start edge changed nothing in the note's custom date field (`start`), even after restart.
- `due`/`scheduled` (canonical fields) persisted correctly the whole time.
- Before the final fix, `getFieldConfig()` returned **zero** custom date fields, so the start mapping was treated as invalid and fell back to `scheduled` (the view showed the "Start date mapping isn't a TaskNotes date field" banner, and reads/writes both used `scheduled`).
- The failing write produced no exception and no failure Notice — TaskNotes accepted `{ userFields: { <id>: value } }` and silently ignored it.

## What Didn't Work

1. **Required `userFields[].enabled === true`.** Persisted TaskNotes settings (`.obsidian/plugins/tasknotes/data.json`) store user fields as `{ displayName, id, key, type }` — **no `enabled` key**. The `enabled` flag came from a *UI validity-check* function in `main.js`, not the stored shape. Requiring `enabled === true` dropped every field, so the custom date field was never recognized. (Fix: `enabled !== false`.)
2. **Wrote `{ userFields: { <fieldId>: value } }`.** TaskNotes' parsing/in-memory paths key user fields by `id` (`task.userFields[field.id]`, `getUserField(id)`), so id looked right. But the **frontmatter writer ignores that shape entirely** — see Why This Works. The payload was accepted and dropped.
3. (Both above passed the unit tests because the **test fixtures encoded the same wrong assumptions** — `enabled: true` and a `userFields`/`id` write shape — the identical mock-vs-reality gap that caused the related read-path bug.)

## Solution

Write a custom user field as a **top-level key on the update object, keyed by the field's frontmatter `key`** (not nested under `userFields`, not by `id`):

```ts
// src/datasource/TaskNotesSource.ts — mutate(), applying resolved DateWriteTargets
if (write.target.kind === 'scheduled')      updates.scheduled = value;     // canonical
else if (write.target.kind === 'due')       updates.due = value;           // canonical
else /* userField */                        updates[write.target.key] = value; // e.g. updates.start = '2026-06-08'

await api.tasks.update(path, updates, context);
```

And recognize the field in the first place (`getFieldConfig`):

```ts
// include any enabled-or-unspecified date field; persisted settings omit `enabled`
if (f && f.enabled !== false && f.type === 'date' && typeof f.key === 'string') {
  dateFields.push({ key: f.key, id: f.id ?? f.key, displayName: f.displayName ?? f.key });
}
```

Confirmed end-to-end in-vault: a start drag now updates the `start` frontmatter and survives reload.

## Why This Works

The write flows `api.tasks.update(path, updates) → taskService.updateTask → (merge {...originalTask, ...updates}) → mapToFrontmatter`. The frontmatter writer's user-field loop is:

```js
let c = e.customProperties, d = e;            // d = the (merged) task object itself
for (let u of a)                              // a = the configured user-field definitions
  hasOwnProperty(d, u.key) && d[u.key] !== undefined
    ? i[u.key] = d[u.key]                      // reads TOP-LEVEL task[field.key]
    : c && hasOwnProperty(c, u.key) && ... ;
```

It reads each field's value from `task[field.key]` — the **top level**, keyed by the frontmatter **`key`**. A `userFields` sub-object keyed by `id` is never consulted on the write path, so the value is silently discarded. Canonical `scheduled`/`due` work because they go through the separate field-mapping branch (`i[mapping.due] = e.due`). The deeper cause: **TaskNotes keys the same data differently on its read/parse path (by `id`) versus its frontmatter-write path (top-level by `key`)** — an internal inconsistency, not something inferable from one representative code path.

## Prevention

- **Trace the *exact* call chain your input takes through an external boundary**, not a representative-looking one. Reading the parse path here (id-keyed) actively misled the write. Follow `update → merge → mapToFrontmatter` to the line that actually touches frontmatter.
- **Read/parse and write paths may key the same data differently — verify each direction independently; do not assume symmetry.** (New rule beyond the sibling learning.)
- **Verify against the persisted artifact, not your reading of the code.** `data.json` (no `enabled` key) and the shipped `main.js` writer loop were the ground truth; the assumptions that fixtures encoded were not.
- **A mock that shares your assumption hides the bug.** Both wrong shapes passed unit tests because the fixtures were authored from the same belief. For an undocumented boundary, derive fixtures from the real artifact's shape.
- **Temporary partition diagnostics pinpoint the layer fast.** Three logs (resolution / read / write) immediately proved the read was already correct and isolated the bug to the write payload — cheaper than more static reading.

## Related Issues

- Supersedes/closes GitHub #70 (start-date drags didn't persist — write targeted `scheduled` while the Base read the mapped property). Part of the U8 write-back work (#61), under the TaskNotes-companion repositioning (#53).
- Matched-pair sibling: [[tasknotes-status-palette-wrong-api-path]] — the **read-path** `wrong_api` at the same TaskNotes boundary. Same root cause and verification method; this is the **write-path** counterpart. See it for the "verify against the shipped artifact / guards hide wrong-path bugs / silently-does-nothing is a real failure" rules, which apply here too.
- Plan: `docs/plans/2026-06-17-003-feat-gantt-tasknotes-field-mapping-plan.md`.
