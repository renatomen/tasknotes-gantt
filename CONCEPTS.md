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

## Diff-sync

### Diff-sync
The refresh strategy in which the chart's store is seeded once and every later data change is applied as targeted store actions computed by an id-keyed diff against the last-applied state — chosen so the user's zoom and scroll survive an incremental refresh. Explicit reseeds are the exemptions that deliberately re-initialize the store instead: the Bulk reseed, and the column-config and theme-flip reseeds that rewrite the seeds for reasons no targeted action can express. Its two blind spots are named and owned: a pure reorder is expressed as an explicit per-branch replay of move steps (a whole-branch chain keyed on an order fingerprint, deliberately simple rather than a minimal move set), because an id-keyed diff cannot reorder existing rows; and a structurally large diff routes through a Bulk reseed.

### Echo-suppression window
The bracket during which the view pushes its own programmatic store actions, marked by a flag that every interceptor with user-facing side effects must consult, so a synchronous programmatic echo is not handled as a user gesture. Events a store re-init emits asynchronously after the window closes are outside its cover — one reason targeted store actions are preferred over re-inits in the first place. The flag is a boolean, not a counter: two call conventions coexist by design — a path already inside the window re-asserts bare, while an independently scheduled callback raises and releases its own bracket — and unifying them would drop the window mid-pass. The flag is never retained across a seam as a snapshot: a wiring-time or held capture stops suppressing the moment the flag changes. Reading it at event time and passing that same-event value to a synchronous classifier is fine — the value is consumed within the event it was read in.

### Bulk reseed
The deliberate escape hatch for a diff too structurally large to apply incrementally: past a structural-op threshold (adds, deletes, reparenting moves, and link ops count; in-place updates and the sibling-reorder replay never do, so a pure reorder of unchanged rows never trips the threshold, however large — whether a given refresh replays the Base order, reasserts an ephemeral override, or does neither is the reorder-reconciliation contract owned and pinned by the coordinator's unit suite, not restated here), the seed props are reassigned so the store re-initializes once, virtualized, instead of applying thousands of per-instance mutations. The threshold is absolute, chosen from the incremental path's cost ceiling, not a proportional wholesale-change test — so it intentionally spends zoom and scroll whenever it trips, which usually but not necessarily coincides with a view changing beyond recognition. The deliberate inverse of Diff-sync's default preference for targeted actions: match the store operation to the size of the change.

## Extraction seams

### Live accessor bridge
The seam by which logic extracted out of the view keeps reading and writing the view's own mutable state: the view hands the extracted module an object of getter/setter properties closed over its component scope, so every read and write crosses live and the state never moves or gets copied. It exists because a value handed across a seam is a snapshot — a snapshot of a flag like the echo-suppression guard silently stops tracking the view the moment it changes — and because reactive state cannot leave the component without losing its reactivity. Members the extracted logic only reads are getter-only; a write made through the bridge is immediately visible to the view's effects, template, and every other handler.

When the bridged module's entry point is called from a reactive effect, the module's reads are the effect's dependencies, and three rules keep that tracking correct: every dependency-establishing read executes synchronously within the entry point's call frame; no accessor is dereferenced outside the branch that needs it, because widening the read set changes when the effect re-runs; and the module reads nothing through the bridge at construction — mount-time baselines cross by value in a separate immutable init argument. Timer callbacks are the deliberate carve-out: they capture nothing at schedule time and re-read the bridge lazily at fire time, which is what lets a deferred action land on a re-bound handle after a remount. Each seam owns its own bridge literal; access surfaces are never merged across seams, so no seam holds members it does not need.

### Read census
The proof of a bridged module's dependency set, taken at the bridge itself: a test fixture whose getters count and whose setters record, so what the module read within one call frame — and on which branch — is directly assertable. Because the module's synchronous reads are exactly what the calling effect depends on, a census assertion is a reactive-dependency proof, not a mock-interaction detail. A census only counts honestly when it is scoped per call: construction-time reads are zeroed out before counting, or an implementation that eagerly reads and caches satisfies the count without any live read.

### Liveness pin
A test that proves a seam reads current state rather than a capture, by mutating the live supplier or backing state between two calls and asserting the second call observed the new value. A fixture whose initial wiring merely differs from the asserted value is not a liveness pin — that shape tolerates an implementation that cached a read at the right moment. The call–mutate–call rhythm is the defining feature.

### Source-shape pin
A structural test that reads a source file as text and pins a contract no runtime test can observe — that an access literal's properties are bare reads and assignments with no capture or caching, that a calling effect's body is exactly a guard plus one call, that a moved concern has not been re-inlined. It targets its subject by name, since a file can legitimately hold several similar surfaces, and it carries mutation self-tests: planted drift must trip the matchers, proving the pin can fail. Ordinary behavior tests stay green across exactly the drift a source-shape pin exists to catch.

Its threat model is accidental drift, shared with the compiler (the type system already rejects members a typed literal does not declare); deliberately crafted evasion is code review's to catch, and hardening the pin against it trades a simple tripwire for a bespoke parser guarding an imagined threat.

### Minted value
A value whose validity is *which* value it is — which collaborator produced it, which sibling it belongs to — carried by a nominal brand that one authorized producing reader alone is meant to construct, so a plausible substitute assembled anywhere else fails to compile instead of failing at run time. The single-producer half is convention held by review rather than a compiler guarantee — any module that can name the brand can cast to it — so it is the part a reviewer has to check. It is the guard for a seam that takes values rather than live accessors: a pure function never sees the literal its caller assembles, so two same-shaped arguments crossed there are invisible to the function's own tests and to any behavioural test whose fixture agrees with both readings.

The brand goes on the producing reader's declared return type, never on the shared domain type it wraps: a branded value stays assignable to what it brands, so every downstream reader of the plain type is untouched, whereas branding the domain type breaks every site that constructs one. Construction sites, not reference counts, are what measure that cost: a type read widely and built once is cheap to brand however often it is named. The invariant is one *reader*, not one cast expression — a reader with a cache legitimately mints on both its hit and miss paths, and a rule phrased per-cast fires falsely on it. A pair that must agree is minted by the producer that takes the deciding input once and returns both parts; a bundle the caller fills field by field is not a mint, because the caller can still fill it inconsistently. A mint written as a direct cast of an object literal is the weakest available form, since a cast is checked only for comparability in either direction and so drops the missing-field check entirely; the repair is to type the literal on the unbranded shape first, as a local or as a parameter, and cast that. Coverage is asserted over the fields deliberately left unbranded rather than over the brands themselves: a brand that collides with nothing and that no fabricate case names can be deleted with no diagnostic at all, so a guard enumerating the brands is a hand-maintained list in the sense the derived-member-list rule names.

## Review gate

### Review receipt
An attestation that a named review layer ran against one exact commit and reached a settled outcome, recorded in the current worktree's resolved Git metadata and never committed. Linked worktrees have separate receipt stores. Within the maintainer and repository-agent workflow, the installed pre-push hook uses receipts to gate each non-deletion ref tip it processes, with one named exception: refs under the archival review-subject namespace (`refs/e11-subjects/*`) carry the reviewer benchmark corpus's subject commits — review *subjects*, not reviewed code — and are validated instead of receipted (each a write-once pin named by the full object id of the commit it carries; the first 31, created before that rule, carry 7-character abbreviations and stay as they are); a tip receipt attests the chain of reviews ending there rather than each commit behind it. The hook is local and can be absent or explicitly bypassed, so it is not remote proof of review. Because a receipt names a commit, any new commit — including the fix for a review finding — starts with none and must earn its own. A receipt is earned either clean or as an acknowledgement of findings.

### Acknowledged findings
The settled outcome in which a review produced findings and the maintainer accepted them rather than fixing them, so the receipt records the acceptance instead of a clean verdict. It exists because a reviewer whose purpose is to find things will find something on any sufficiently examined change, and a gate that only recognises "nothing found" is one no change can pass — which invites bypassing the gate entirely, a worse outcome than accepting a known finding in the open. The acknowledgement carries a digest of the review text it accepted, which labels it — two acknowledgements can be told apart, and a stale one is visible — but nothing re-reads that text later, so the digest identifies rather than verifies; what makes the acknowledgement unforgeable is the same attestation that makes any receipt so. It is announced whenever a push is gated on it, so an accepted finding does not quietly become a forgotten one. Accepting is a judgement about scope, never about whether the review ran: every check that the review genuinely happened still has to pass first.

### Staged review data
The form in which content the reviewed change could influence — the diff itself, or a measurement derived from the branch — reaches an independent reviewer: a named, uncommitted data file the review prompt explicitly disclaims of instruction force, never text interpolated into the prompt itself, so an injected directive inside the change is denied the prompt's own voice — though once the file is opened its content still reaches the reviewer, so the disclaimer biases rather than guarantees. The file that is the review's own subject carries a per-run token the reviewer must echo verbatim, narrowing "the reviewer claims it read the change" to proof the file was at least opened; supporting context carries no token, keeping the receipt signal undiluted. A measurement staged this way is computed with the trusted side's tooling once that tooling exists on the trusted side — before then it necessarily runs branch-side — and a change the trusted-side measurement cannot see is announced to the reviewer rather than silently measured. Staging closes only the prompt channel: a reviewer that runs inside the reviewed checkout still reads that checkout's own instruction files as instructions, a separate channel guarded by review of any instruction-file change rather than by the staging itself.

### Design-contract preamble
A short pre-implementation record for a change to concurrency, ordering, or invalidation contracts that names the waits and contracts being changed, the resulting wait or lock graph, and the failure direction of a false positive.

### False-green
A test that stays green while the guard its name claims to enforce is broken — the assertion cannot fail for the defect it exists to catch. The classic causes are a check the toolchain never runs (a test file outside every typecheck program), a comparison of unawaited promises, and a timer or clock captured before the test fakes are installed. A compile-time assertion has its own cause, and it is not that nothing references the assertion — an unreferenced assertion still fails when its check fails. It is that a constraint loose enough to accept the answer the check now returns reports nothing, so the assertion survives as text while asserting nothing — see Degenerate answer. Unreferencedness is a separate exposure: it means such an assertion can also be deleted outright without any other code noticing. A false-green is worse than a missing test because it actively reports coverage that does not exist; the antidote is the mutation-check: break the guarded behavior on purpose and observe the test fail before trusting it. A statically reported cause — a type checker claiming an assertion compares an unawaited value — is a hypothesis of vacuity, not a diagnosis: the declared types and the runtime can diverge, so whether the assertion is actually vacuous is settled by runtime evidence before choosing a repair. Distinct from a Frozen-evidence guard, which fails precisely and for the wrong target rather than failing to fail: the mutation-check clears a frozen-evidence guard, because it does break when its subject changes.

### Degenerate answer
A value a type-level check returns that is neither of the two answers it was written to produce — the empty type, the escape-hatch type, or the whole boolean — each of which satisfies a constraint written to exclude it, so an assertion built on that check passes while the property it names is broken.

The empty type satisfies every constraint, the escape-hatch type is assignable in both directions, and the boolean is a supertype of each answer, so a check that widens or distributes where it meant to compare exactly produces one of them rather than failing. Hardening the check in place does not close this: the repair is written in the same construct being verified, so the new checker is a fresh candidate for the same defect and needs a checker of its own. Two tells mark the regress rather than a single instance of it — the fix is written in the construct being verified, and the verifier needs a verifier. The terminating move is to change primitive: assert by declaring a value and letting the type system's own assignability check be the assertion, because a declaration has no computed answer to degenerate. Mutual assignability cannot reject the escape-hatch type wherever the expected type admits it, so that case needs a declaration of its own rather than a surviving computed check — keeping one would leave a checker standing that nothing observes. The exception is an expectation of the empty type, which admits nothing and so rejects the escape-hatch type unaided; and a non-emptiness check must name a member it expects rather than restate the set, which is a tautology precisely when the set has collapsed. Confirming any of this by counting diagnostics is unsound — read which assertion fired and confirm it is the one that was mutated.

### Frozen-evidence guard
A guard that asserts the evidence a decision rested on rather than the claim the decision made, so it turns red exactly when the implementation improves and its redness argues for reverting the fix. It arises when a justification of the form "this cannot cost anything *because* the implementation currently does X" is written down and the guard asserts X: the because-clause is promoted to a requirement, and the claim it was supporting is never tested at all.

Its recognition rule is that fixing a genuine defect requires deleting or inverting a test whose name states a safety property — before assuming the fix is wrong, ask whether the guard was ever aimed at the property or only at the mechanism that happened to satisfy it. The repair is to assert the claim and let the mechanism move: where the claim is a negative — cannot, never, costs nothing — measure the quantity and assert a bound, since absence-of-one-mechanism is the weakest available proxy for a budget and inverts the moment that mechanism becomes the requirement. A decision recorded but genuinely unmeasured is labelled as a characterization rather than dressed as a design choice; the honest label costs a sentence and invites the fix instead of defending against it.

### Assertion-preserving repair
The rule governing any mechanical repair to an existing test — a type fix, a lint fix, a harness migration: after the repair, the test must assert at least what it asserted before, provably. A repair that deletes or loosens an assertion, hides drift behind a cast, or rebinds the test away from the real behavior (creating a false-green) is a review finding, not a fix. When a repair cannot preserve the assertion because the asserted behavior itself changed, that is a stale-assertion or product-defect decision to surface, never a silent adjustment.

### Derived member list
The property that makes a specification rule converge under review: its members come from a source that changes with the code — the fields a type declares, a census the unit commits and asserts complete against the code it measures (a widened set fails red), a complete key set compared against a contract, a derivation asserted against the field it derives from — rather than from an enumeration the author maintains by hand. A source OBSERVED at run time does not qualify however closely it resembles one — a probe, a spy, a reflection over a single call: observing what a call touched reports that execution, not the declaration, so it silently omits a member the shape regroups out of view, one a consumer reads that the producer never supplies, and one behind a branch the observation never entered. Deriving from the declaration closes those evasions for the members of the declaration it keys on — a narrower guarantee than closing them outright, and the narrowing matters wherever a contract spans more than one declaration: a member the consumer accepts that the keyed producer never declares is outside the key set, so that case is bounded by the choice of key, not by the technique. What this excludes is observation, not runtime data that is genuinely authoritative: where the members are determined at run time by construction — a user's configured properties, a plugin registry, a parsed schema — the declaration cannot know them, that data is the source of truth, and the guard belongs on it rather than on a type. A hand-maintained list is complete only for the members its author happened to think of, so review finds the next one, the author patches the list, and the cycle repeats: every round locally productive and the sequence non-convergent. The recognition rule is a round naming a **new member of a class an earlier round already fixed**; the repair is to restate the rule around its source of truth, with any members left in the text marked illustrative — the ones easiest to get wrong — never as the set. Its test is whether a new member is covered without editing the rule, or else trips a guard: if covering it requires editing the rule's text, it is a list wearing a rule's clothes, which is the always-rule failure this repository's opening constraint names.

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

## Column sort

### Ephemeral column sort
A display-time ordering applied by clicking a grid column header, held only in the view and never written to the Base or any note. It survives data refreshes — including a bulk reseed — by being re-asserted after each sync, is cleared by the sort cycle's third click or the reset pill (restoring the Base order), and yields when the Base's own sort changes: that clear drops the override without replaying the old order, letting the new Base order land. Distinct from the Base's own sort, which is data the view receives.

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

### Leg
One matrix execution of the full e2e suite inside a repeat-run measurement dispatch, carrying its own results artifact. A leg is either valid — it demonstrably recorded every spec in the suite, with every session's results well-formed — or excluded with a named reason (artifact never uploaded, results missing, corrupt, or malformed, a session that ran nothing, or recorded specs disagreeing with the suite). Excluded legs never enter the valid-leg denominator and never count as passes; their exclusion reasons are part of the measurement's output, not noise. Legs from additional dispatches against the same commit pool into one denominator; that the pooled dispatches measured the same commit is the operator's contract, recorded alongside the result.

### Window cutoff
The explicitly stated boundary that closes a measurement window whose subject includes the process producing the record — the identifier of the last counted execution together with each counted execution's attempt count, stated in the record itself (an identifier alone drifts, because a later rerun keeps the identifier while adding attempts). Executions and attempts after the cutoff are excluded by definition and fall to trend metrics, never folded back in; without one, a self-referential record has no fixed point, because each fold-in edit spawns a new execution eligible for folding in.

### Honest denominator
The execution count a failure rate is stated over, counted exactly from its source of record: `run_attempt` summed across the window's CI runs for ordinary-CI incident windows, and the enumerated matrix-leg conclusions for repeat-run executions — re-derived from that source on every recount. Rates are stated with this denominator, never as bare instance counts; a rerun counted as evidence is counted in the denominator, and a leg that ran fewer than the expected specs is excluded as invalid with its exclusion reported, never counted as a pass.

## Reliability diagnosis

### Lifecycle envelope
The terminal diagnostic record that keeps the original test outcome separate from the best-effort diagnostic outcome while carrying the bounded page-local trace gathered for the same failure.

A diagnostic retrieval failure may make the trace incomplete, but it never replaces or downgrades the primary test failure.

### Matched control
A passing observation that is comparable to a failing trace because it shares every relevant causal input and boundary and supplies complete evidence for the distinction being tested.

A later pass is not automatically a matched control; comparison is unavailable when configuration, journey, ownership, mount, checkpoint, or trace completeness differs.

### Organic recurrence
A later occurrence of a known symptom during ordinary verification or product work, rather than through a commissioned repeat-run or measurement top-up.

It may activate a deeper diagnostic boundary, but it does not enter or reopen the historical measurement denominator.

### Open diagnosis
A settled diagnostic outcome that withholds causal attribution because the available evidence does not distinguish the candidate causes completely.

An open diagnosis is a valid bounded result, including when the diagnostic mechanism is verified but the symptom does not recur organically.

## Pillar measurement

### Ranked-defect file
A file that holds a measured entry in a pillar's ranked defect list — today the maintainability report's ranked list, with the metrics its entry records (typically line count, enumerated concern count, and complexity-band membership; some entries record fewer). The record is the reference every later change is judged against: a PR that grows such a file's measured metrics regresses the pillar unless its governing plan argues the growth, and instrumentation or diagnostics never live inside one — they sit in their own module behind a seam, leaving only call hooks behind.

### Placement boundary
The lint-gate rule that a ranked-defect junction file may not import the lifecycle-capture API of the debug-log module or touch the lifecycle global: instrumentation and diagnostics live in their own seam module, and junction files keep only the call hooks. It encodes the cohesion invariant directly — the first visible act of the 2026-08-21 regression was that import — so it is binary, not gameable by formatting, and fails mechanically at pre-commit and CI: the allowed names live in a committed registry from which the lint overrides are derived, and the statically expressible forms are pinned by a standing mutation harness that re-proves the gate on every run. Computed-name access to the lifecycle global is the gate's documented static limit — no lint selector can close dynamic name construction — so that form stays guarded by review — any in-file diagnostics are a P1 under the ranked-defect invariant — not by the linter. A new allowed import is a boundary exception: a dated, structured allowance with its record (delta, why the seam cannot carry it, alternatives, the maintainer's approval), never a sentence. File size is not a gate (the 2026-07-30 ruling stands); it is published for review by the trend measurement.

## Flagged ambiguities

- "Calendar role" had been used for plugin-assigned semantics layered over passive calendar sources — retired: a calendar note declares its own availability, and the view's calendar mode chooses how that availability is applied.
- "Calendar" spans two unrelated features: calendar availability (working-time shading and stretch, from calendar notes) and the calendar-view union (TaskNotes calendar items as bars). Qualify the word when context does not disambiguate.
