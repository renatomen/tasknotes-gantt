# Relationships

*(The whole Relationships group is **companion only** — it's shown only when
TaskNotes is installed.)*

## Expanded relationships

TaskNotes lets you link one task to another as **parent and child** — a project
and its subtasks, or a phase and the work inside it. If that's new to you, the
[TaskNotes docs](https://tasknotes.dev) explain how these relationships work.

Your Base has a **filter** that decides which tasks appear. But a related task —
say a subtask of something you're viewing — might live *outside* that filter and
never show up, leaving a gap. This setting decides whether the Gantt fills it.

| Value | Behavior |
| --- | --- |
| **Inherit** *(default)* | Show only the tasks your Base's filter matches — don't pull in related tasks from outside it. |
| **Show all** | Also pull in related tasks that fall outside your filter, drawn as faded **context rows** so you see the full structure without losing track of what actually matched. |

## Expanded items opacity (%)

When **Show all** is on, this tunes how faint those pulled-in context rows look,
so they read as background rather than competing with your matched tasks. Lower =
fainter. **Default:** 55%. **Range:** 10%–100% (they never fully disappear). No
effect under **Inherit**.

## Hide top-level subtasks

When a subtask appears **twice** — once nested under its parent and once as its
own top-level row — turning this on hides the duplicate top-level copy. The
subtask still appears under its parent. **Default:** off.
