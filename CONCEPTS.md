# Concepts

Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## Calendar availability

### Calendar note
A vault note a user marks as a calendar, declaring its own availability: a recurring working schedule — a single working pattern, or per-day availability blocks — plus dated exceptions (holidays, extra working days, display-only events). The calendar is the authority on when work can happen; views decide only how that availability is applied.

### Non-working day
A date on which work is not expected to occur, at whole-day granularity in local calendar dates (iCalendar all-day semantics). Declared by a calendar note — as the complement of its working schedule (working pattern or availability blocks) or as a dated exception.

### Calendar association
The link from a task to a specific calendar note, carried by a user-mapped property. A task with no association has no calendar of its own — its availability seam is empty, so no day is blocked for it and a working-time stretch never applies. There is no view-wide default calendar.

### Estimate meaning
The per-view default for what a duration estimate counts. A working-day estimate excludes the task calendar's non-working days, so an inferred edge extends until the required working time fits. A calendar-day estimate counts elapsed days, including working and non-working time, so non-working time does not extend the span. A task may override the view default.

### Non-working-day rendering
The independent per-view choice for how non-working time appears. Shaded rendering keeps task bars continuous and marks non-working time in the background. Split rendering marks non-working runs inside applicable bars without changing their dates or implying whether those days count toward the estimate.

### Working-time stretch
The extension of a bar whose span is derived from a working-duration estimate: blocked days consume none of the estimate, so the bar stretches across them until the working time fits. Only inferred dates move — an authored date is an anchor and always renders as authored — and a stretch that reaches its safety ceiling falls back to the unstretched span and is flagged.

### Ghost run
A contiguous run of non-working days inside a bar under Split rendering, shown as a dimmed piece without changing the bar's dates. Ghost runs are interpretation-neutral and may appear on authored, calendar-day-derived, or working-day-derived spans. At zoom levels where faithful piece tiling cannot be guaranteed, the bar renders in its continuous form instead.

### Availability seam
The internal query boundary that answers "is this date blocked?" without a consumer inspecting a calendar note directly. It is not one shared query: task-level blocking (stretching, scheduling decisions later) is answered per task from that task's associated calendar, while background shading is the union of the view's displayed calendars. The two paths derive from the same calendar definitions but are resolved separately, so a day can be shaded in the background without blocking an unassociated task.

## Date status

### Non-authored edge
A bar edge (start or due) whose date the user did not author — inferred from the other edge and an estimate, or, when neither date exists, given by a placeholder span anchored at today. Signaled by a zigzag cut into that side of the bar; one signal replaces the single color treatment that previously covered every non-complete date status.

### Swapped dates
The date-status state in which both dates are authored but inverted (start after due). Not a missing edge, and never signaled by the zigzag: today it carries the legacy colour treatment (orange fill) over a display range corrected by swapping. Slated to become the first *error* of the schedule-validation feature, which suppresses the bar and marks the row with a badge instead — inverted dates are data to fix, not a range to draw.

## Drag commit

### Echo
An optimistic correction written to the chart's own store so the bar shows where a gesture will land before — or instead of — the vault agreeing. An echo is display truth, never data: when the write behind it cannot land, the echo is reverted, and reverting one never undoes a write that did land. Echoes carrying geometry are what a queued gesture reads to tell "someone else moved this bar" from "this is my own drag's position"; echoes carrying only progress say nothing about geometry.

### Cascade
The propagation of a parent's committed move to its subtree, run after the parent's own write settles. A cascade is displacement, not assignment: children shift by the parent's delta rather than adopting its dates. Only pure moves cascade — a resize changes shape and owes the subtree nothing.

### Fence
A cascade round's claim on the source queues it is about to write, held so no other gesture can persist underneath it mid-round. Acquisition is deadline-bounded and each source is held independently: a round that cannot assemble its whole fence in time abandons rather than waiting, and abandoning releases every source as soon as that source's own prior work settles, so one stuck write cannot park the others.

### Origin stash
The pre-drag position a halted cascade leaves behind so its unpaid displacement survives to the next attempt. Any pre-delivery halt stashes — capability loss, supersession, exhausted rounds — and a successor inherits the stash and measures from it, so the subtree receives the cumulative shift rather than only the newest one. A delivered cascade settles the account and stashes nothing.

### Settled facts
The authored values a write is known to have persisted, remembered per source because the plugin suppresses its own recompute and the rows it reads therefore still show pre-write values. A settled fact overlays a stale row only until a vault re-read that began after the write has delivered; a read that merely reuses cached tasks proves nothing and cannot retire it.

## Extraction seams

### Live accessor bridge
The seam by which logic extracted out of the view keeps reading and writing the view's own mutable state: the view hands the extracted module an object of getter/setter properties closed over its component scope, so every read and write crosses live and the state never moves or gets copied. It exists because a value handed across a seam is a snapshot — a snapshot of a flag like the echo-suppression guard silently stops tracking the view the moment it changes — and because reactive state cannot leave the component without losing its reactivity. Members the extracted logic only reads are getter-only; a write made through the bridge is immediately visible to the view's effects, template, and every other handler.

## Review gate

### Review receipt
An attestation that a named review layer ran against one exact commit and reached a settled outcome, recorded in the current worktree's resolved Git metadata and never committed. Linked worktrees have separate receipt stores. Within the maintainer and repository-agent workflow, the installed pre-push hook uses receipts to gate each non-deletion ref tip it processes; a tip receipt attests the chain of reviews ending there rather than each commit behind it. The hook is local and can be absent or explicitly bypassed, so it is not remote proof of review. Because a receipt names a commit, any new commit — including the fix for a review finding — starts with none and must earn its own. A receipt is earned either clean or as an acknowledgement of findings.

### Acknowledged findings
The settled outcome in which a review produced findings and the maintainer accepted them rather than fixing them, so the receipt records the acceptance instead of a clean verdict. It exists because a reviewer whose purpose is to find things will find something on any sufficiently examined change, and a gate that only recognises "nothing found" is one no change can pass — which invites bypassing the gate entirely, a worse outcome than accepting a known finding in the open. The acknowledgement carries a digest of the review text it accepted, which labels it — two acknowledgements can be told apart, and a stale one is visible — but nothing re-reads that text later, so the digest identifies rather than verifies; what makes the acknowledgement unforgeable is the same attestation that makes any receipt so. It is announced whenever a push is gated on it, so an accepted finding does not quietly become a forgotten one. Accepting is a judgement about scope, never about whether the review ran: every check that the review genuinely happened still has to pass first.

### Design-contract preamble
A short pre-implementation record for a change to concurrency, ordering, or invalidation contracts that names the waits and contracts being changed, the resulting wait or lock graph, and the failure direction of a false positive.

### False-green
A test that stays green while the guard its name claims to enforce is broken — the assertion cannot fail for the defect it exists to catch. The classic causes are a check the toolchain never runs (a test file outside every typecheck program), a comparison of unawaited promises, and a timer or clock captured before the test fakes are installed. A false-green is worse than a missing test because it actively reports coverage that does not exist; the antidote is the mutation-check: break the guarded behavior on purpose and observe the test fail before trusting it. A statically reported cause — a type checker claiming an assertion compares an unawaited value — is a hypothesis of vacuity, not a diagnosis: the declared types and the runtime can diverge, so whether the assertion is actually vacuous is settled by runtime evidence before choosing a repair.

### Assertion-preserving repair
The rule governing any mechanical repair to an existing test — a type fix, a lint fix, a harness migration: after the repair, the test must assert at least what it asserted before, provably. A repair that deletes or loosens an assertion, hides drift behind a cast, or rebinds the test away from the real behavior (creating a false-green) is a review finding, not a fix. When a repair cannot preserve the assertion because the asserted behavior itself changed, that is a stale-assertion or product-defect decision to surface, never a silent adjustment.

## Field mapping

### Field mapping
The user's per-view assignment of one of their own Obsidian properties to a gantt field role (start, end, status, priority, progress, time estimate, parent, name). No property name is ever assumed: a role has meaning only through the property mapped to it.

### Effective field mappings
The resolved field mappings — the view's own choices with each unset field filled in from the backing system's configured property, so an unset field behaves exactly as if the user had selected it; when a backing system is present, date roles bottom out at its documented default properties (still writable), while a role whose persistence the backing system owns through its own configuration (status, priority) stays unset and read-only when unconfigured (see round-trip symmetry); standalone — no backing system — leaves every unset role unresolved and read-only. This is the single answer to "which property IS this field?", and every consumer reads it rather than the raw view config. Distinct from the view config, which answers only "what did the user choose?" — the right question for gates about the user's intent, and the wrong one for identifying a field.

### Round-trip symmetry
The property a field's value is written to is the same one it is read from. It is the license to edit a field inline: the backing system persists status and priority through *its own* configured property, so a view mapped to a different property can only be read. Without symmetry an edit would land where the edited column cannot show it — appearing to save while changing nothing visible — so the field is read-only instead.

## Refresh

### Entry signature
A fingerprint of the current Base result — the matched notes' paths plus the frontmatter values of the fields the view actually reads — recomputed on every notify and compared with the last one. Deliberately derived without touching the Base's value system, because reading through that system is itself what provokes the host into another notify.

### Task reuse
The decision, taken from an unchanged entry signature, to skip re-reading the Base and reuse the cached tasks — the loop-breaker for the host's re-notify storm. It releases (and a full re-read runs) whenever the signature moves, which makes the signature's watched-field set load-bearing: a field the signature does not watch is a field whose edits the chart will not see.

## Inline cell editing

### Managed row
A row whose note the backing system recognizes as a task. Only managed rows are editable inline — an unmanaged note matched by the same Base still renders and is read, but offers no editor and accepts no write.

### Grid cell-edit bridge
The path by which the embedded grid re-emits an inline cell commit as a whole-row task update carrying a single, type-coerced field — there is no dedicated cell-edit event.
*Avoid:* "the bridge" (when the context is ambiguous).

The re-emitted value is lossy: numeric-looking strings, booleans, and empty lists all coerce to numbers, and a multi-value (list) cannot be represented at all — the field holds a single scalar. A lone wikilink string rides through unharmed (single-value fields commit their raw `[[Note]]` this way); it is the list shape that can't survive. Both the edited column and the original value type are therefore unrecoverable from the event alone — which is why bridge-carried edits are attributed by diffing against stored per-column values, and why a list editor bypasses the bridge entirely and commits through the direct path.

### Direct path
The write that persists an edited value straight to the note's property by its known column id, bypassing the grid cell-edit bridge. Used by an editor whose value the bridge cannot represent — notably a wikilink list; the whole value is written at once rather than a single coerced field.

### Raw entry
A list or property value in its verbatim stored form, including wikilink brackets and any alias (`[[Note|Alias]]`). The form that must round-trip unchanged on commit so a link is never reduced to plain text.

### Display form
The human-facing rendering of a stored value with wikilink brackets stripped and aliases resolved to their label. Distinct from the raw entry: seeding or committing an editor from the display form silently discards the underlying link, so raw entries are the source of truth for editing.

## Calendar-view union

### Item family
One of the kinds of calendar item the TaskNotes calendar can display and the gantt can ingest: task date events (scheduled, due, scheduled-to-due span), recurring task instances, time entries, timeblocks, property-based events, and external calendar events (ICS, Google, Microsoft). Each family has its own access path, datetime dialect, and per-view visibility toggles.

### Dataset parity
The union contract with the TaskNotes calendar: with equivalent toggles set, the gantt's underlying item set matches what the calendar shows for the same vault and window. Presentation may differ — day-granularity bars versus calendar cells — the data may not.

### Quick source switcher
A display-time affordance that shows or hides an active item source immediately — keyboard operable, per view, without a settings round-trip. The clutter control that lets flat event rows replace a grouping hierarchy.

### Floating time
A stored datetime with no timezone (all TaskNotes-native date fields), interpreted per RFC 5545 as "this wall-clock time wherever the observer currently is". The gantt attributes floating values to the observer's local day, matching calendar behavior; a zone-carrying DATE-TIME (ICS UTC, offset-stamped time entries) is an absolute instant, converted to local time first.

An all-day boundary is the exception: it denotes a zone-independent calendar date (RFC 5545 DATE semantics), so it is read verbatim by its date prefix even when a feed serializes it as a UTC- or offset-stamped midnight — the zone on an all-day midnight is a serialization artifact, and the date never shifts across a timezone boundary.

### Projected instance
A recurring-task occurrence computed from the parent note's recurrence rule for the visible window — display-only, existing in no note. Distinct from a recorded instance (a date the parent lists as completed or skipped) and suppressed for any date owned by a materialized occurrence.

### Materialized occurrence
A real task note representing one occurrence of a recurring task, linked to its parent and date. Wherever it exists, it replaces the projected instance for that parent/date pair — in the calendar and therefore in the gantt.

### Occupancy run
The inverse of a ghost run: a contiguous run of days a recurring series actually occupies inside its envelope bar, rendered as a solid per-instance piece while the gaps between instances render nothing. Same segment engine as ghost runs, opposite emphasis.

### Series spine
The honest degraded form of a recurring row at zoom levels where per-instance pieces cannot tile faithfully: a dashed line spanning first-to-last instance, asserting only the series' extent — never a solid bar, which would claim continuous occupancy.

## Governing docs

### Engineering charter
The durable process document at `docs/engineering/practices.md`: philosophy, practices E1–E12 (each as principle → mechanism → governance test), named divergences, and the binding that ties them to this repo's real gates. The charter owns practice-shaped rules; the principles doc owns structural ones — one owner per rule, cross-cited, never restated.

### Governance test
The concrete recognition rule attached to a principle or practice: how to spot a violation by direct inspection — of code, config, or artifacts — without re-deriving design intent or history. A principle without one is an aspiration; the test is what makes it reviewable, so every review layer checks against them.

### Named divergence
A recorded, argued departure from the charter's source teaching or from a practice's letter — carrying its rationale and a revisit trigger — instead of a silent edit. The charter's own honesty pattern: nothing is smuggled; divergences are visible, argued, and falsifiable, dated where the record supplies the ruling.

## Maintainability measurement

### Churn share
The fraction of all commits in the measured window that touch a given file, measured rename-aware. One of principle 7's two violation-recognition metrics: a high share marks a file that participates in most changes, which is where maintenance pain concentrates regardless of its size.

### Separable concern
A named responsibility inside a file that has its own reason to change and could be owned elsewhere, counted by enumeration with evidence (a symbol or line-range), never asserted as a bare number. Principle 7's second metric — and its stopping rule: decomposition ends when no further split would improve cohesion, not at a size target.

### Re-measure
The named event at which the strategy's maintainability metric is taken: churn share and separable-concern counts recorded with the commands, date, and commit that produced them, so the numbers are reproducible and comparable across measurements. Manual today; a mechanical gate is a parked candidate.

## Reliability measurement

### Never-became-ready class
The e2e failure class in which a readiness or interactability wait times out — the spec never observed the application reach the state it gates on (bars present, header clickable, view maximized). It is a class, not a spec concentration: the recorded instances span unrelated specs and, within one spec, distinct symptoms, so a fix aimed at one error string or one spec misses the class.

### Flake
A nondeterministic failure: the same SHA fails and then passes with no change. The word carries no causal verdict — a same-SHA pass proves nondeterminism, never that the diff or the codebase is innocent, and "flake" never means "not a code defect". Harness-vs-src attribution for a flake stays open until evidence distinguishes them.

### Honest denominator
The execution count a failure rate is stated over, counted exactly from its source of record: `run_attempt` summed across the window's CI runs for ordinary-CI incident windows, and the enumerated matrix-leg conclusions for repeat-run executions — re-derived from that source on every recount. Rates are stated with this denominator, never as bare instance counts; a rerun counted as evidence is counted in the denominator, and a leg that ran fewer than the expected specs is excluded as invalid with its exclusion reported, never counted as a pass.

## Flagged ambiguities

- "Calendar role" had been used for plugin-assigned semantics layered over passive calendar sources — retired: a calendar note declares its own availability, and the view's calendar mode chooses how that availability is applied.
- "Calendar" spans two unrelated features: calendar availability (working-time shading and stretch, from calendar notes) and the calendar-view union (TaskNotes calendar items as bars). Qualify the word when context does not disambiguate.
