# Architecture Principles

Durable design philosophy for TaskNotes Gantt. These principles outlive any plan or implementation unit; changes here are maintainer-level decisions. Each principle carries its governance test — how to recognize a violation without reading code — and cites its depth record in the solutions layer, which stays authoritative for the full story.

## 1. Property-agnostic field resolution, at exactly one seam

No Obsidian or TaskNotes property name is ever hardcoded. Field roles (start, due, status, priority, progress, estimate, parent, name) resolve from the user-configured field mappings; defaults are computed at one seam — unset resolves from the backing system's own configuration, else stays unset, never an assumed property name — and every consumer reads the resolved value. The raw view config keeps one narrow job: it answers "what did the user choose?", never "which property IS this field?". The only tolerated literals are the Obsidian built-ins `file.name` / `file.basename` as the name-column fallback.

**Test:** a string literal like `'note.due'` in field-handling code; two call sites answering "which property is X?" from different sources.

*Source: [property-agnostic-field-resolution](../solutions/architecture-patterns/property-agnostic-field-resolution.md), [resolve-config-defaults-at-one-seam](../solutions/architecture-patterns/resolve-config-defaults-at-one-seam.md).*

## 2. Derivation is pure and visibility-free; display lives in presentation

The derived instance set is a pure function of the matched data plus data-shaping config (field mappings, expansion mode, default duration). It tags every row with what the view needs and drops nothing. Every row-visibility option is a presentation-layer predicate over that stable array — so a persisted-config re-fire is a no-op sync plus a cheap filter re-apply, and structurally cannot churn.

**Test:** a view-option toggle that changes the derived array (visible as diff churn or a re-render loop); a visibility field appearing in a derivation config type.

*Source: [view-display-options-in-presentation-not-derivation](../solutions/architecture-patterns/view-display-options-in-presentation-not-derivation.md).*

## 3. One derivation authority; a parsed-but-inert field is a defect

Every behavior-bearing value has one shared derivation, and every surface reads it — preview, render, conflicts, legend. Per-surface handling lets surfaces silently disagree, most dangerously a preview that says one thing while the real render does another; a single shared derivation makes that divergence unrepresentable. A field that parses, validates, and round-trips but changes no shared output is dead code wearing a type. The proof a field works is a test that authors it and asserts an effect on a shared surface — a round-trip test proves survival, not behavior.

**Test:** a new schema field with round-trip tests but no shared-surface effect test; two routines deriving the same fact; a preview disagreeing with the render.

*Source: [shared-derivation-prevents-inert-schema-fields](../solutions/architecture-patterns/shared-derivation-prevents-inert-schema-fields.md).*

## 4. Reuse the owner's mechanism — never imitate, infer, or rebuild it

Three boundaries, one rule:

- **SVAR** — assume it already ships the feature; search its docs and source first; any deviation from the documented API requires maintainer sign-off.
- **TaskNotes** — task identity, CRUD, canonical field mapping, and value sets (statuses, priorities) come from its API; never grep tags or frontmatter to decide taskness.
- **The installed toolchain** — search it (eslint, Jest, TypeScript, WDIO, SonarJS, existing repo scripts) before building any checker, ratchet, or runner.

The exception test is capability against the requirement, never built-in versus home-grown. The two sanctioned hand-rolls prove it: fullscreen (SVAR's component uses the native browser top layer, which escapes Obsidian's stacking context and hides its popups — CSS-overlay + reparent won, with sign-off) and Pro-gated features (the MIT build force-nulls the entire Pro surface — there is no API being declined). Imitating a mechanism instead of reusing it drifts and multiplies: the audit found four parallel implementations of one job, each a regression seed.

**Test:** a second parallel mechanism for a job one already does; a comment saying "exactly as X does"; `app.plugins.getPlugin('tasknotes')` outside the datasource layer; a bespoke checker duplicating an installed lint rule.

*Source: [orchestrate-existing-tool-over-rebuilding](../solutions/tooling-decisions/orchestrate-existing-tool-over-rebuilding.md), [tasknotes-owns-task-identification](../solutions/conventions/tasknotes-owns-task-identification.md), [2026-08-10 audit](../reports/2026-08-10-svar-conformance-and-maintainability-audit.md).*

## 5. Verify at the fastest reliable level; testability is design feedback

The tier map: Jest unit tests (fastest — most behavior lives here via extract-and-test) → the vitest-browser SVAR probe (`npm run probe:svar` — the middle tier for bar-visual and render behavior against a real mounted Gantt) → WDIO e2e against real Obsidian (the integration tier for what only the real host proves: vault writes, menus, Bases config — a first-class gate, not optional). Order: fastest reliable evidence first, then the mapped integration journey the changed boundary requires. "No e2e for X" does not mean X is under-tested — coverage is behavior verified at the right level. A behavior reachable only through a >5-minute loop is a design defect: extract the decision into a pure function and test it fast. Coverage failures in view/registration code are fixed by extract-and-test, never by exclusion.

**Test:** a new e2e for behavior already provable at a faster tier; a "missing e2e" residual closed by writing that e2e without checking faster coverage; a coverage failure fixed by exclusion.

*Source: [test-at-the-fastest-level-not-redundant-e2e](../solutions/tooling-decisions/test-at-the-fastest-level-not-redundant-e2e.md).*

## 6. Calendar semantics map losslessly to the iCalendar RFC family; route by semantic role, not serialization shape

RFC 5545 / 7953 / 9253 are the named, exclusive authority for dates, availability, and dependencies — no other standard, and no component library's own calendar shape, becomes a boundary contract. Internal models may be pragmatic; boundary shapes may not, and every standards-bearing shape names its mapping when introduced, proven by test. The semantic role decides the code path: an all-day boundary is an RFC 5545 DATE even when a feed serializes it as a zone-stamped midnight — the zone stamp is a serialization artifact, not an instant. Lossy VIEWS (day-granularity projections) are permitted; lossy STORES never are.

**Test:** date/dependency/availability code that cannot name its RFC mapping; a round-trip that drops COUNT or a reltype; day-attribution that branches on the presence of a time suffix.

*Source: [standards-alignment](standards-alignment.md) (the governing what-must-hold doc), [all-day-event-boundaries-floating-not-instant](../solutions/logic-errors/all-day-event-boundaries-floating-not-instant.md).*

## 7. File size is judged by semantic cohesion — never line count alone — and the judgment is falsifiable

A file is too big when it holds separable concerns, not when it crosses a line threshold; decomposition ends at semantic cohesion, not a size target — and never starts just to move a line count. The judgment must be measurable so a "decomposition finished" claim is itself testable. The violation-recognition metrics: churn share (a file edited in a large fraction of all commits) and separable-concern count. The metrics have teeth — one closeout's "cohesive composition root" verdict was overturned by measurement: edited in 19% of every commit ever made, seventeen separable concerns.

**Test:** a closeout claim with no churn/concern measurement behind it; a split performed only to move a line count; a file whose concern list keeps growing while its "cohesive" label stands.

*Source: [run-behavior-neutral-refactoring-as-releasable-reviewed-slices](../solutions/workflow-issues/run-behavior-neutral-refactoring-as-releasable-reviewed-slices.md), [2026-08-10 audit](../reports/2026-08-10-svar-conformance-and-maintainability-audit.md).*

## Practice-owned rules (cross-references)

Four rules live in the engineering charter ([practices.md](../engineering/practices.md)) because they are practices, not architecture — cite, never restate:

- A test's name is a claim the test must prove (charter E4/E5 binding).
- The cognitive-complexity ceiling of 15, mechanized in eslint (charter E8/E2 binding).
- Mechanism over memory — the charter's meta-principle.
- The per-unit-PR landing cadence (charter E2/E3 binding).
