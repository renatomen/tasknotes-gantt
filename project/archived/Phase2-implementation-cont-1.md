## Next implementation steps (per the plan and project rules)

Here’s the focused set of next steps coming out of Phase 2 progress, aligned with the rules in
.augment/rules (architecture, testing, git workflow, obsidian plugin best practices, typeScript
standards).

### Progress update (2025-09-23)

- Completed: Dynamic Column Generation utility and DI integration in basesGanttViewFactory
  - Real-time column regeneration on Bases property selection changes
  - Common property types formatted (text, date, number, boolean, array/link)
  - Persistence of user-resized widths deferred to a later task
- Completed: Integration tests for Bases→mapping pipeline
  - Cases: missing dates retained, multi-parents duplicated with same noteId, invalid config
    surfaces inline error, refresh/onDataUpdated recomputes
  - All unit + integration tests passing locally; typecheck OK
- Built and installed to test vault successfully

### NEXT PRIORITY: Column visibility and ordering synced to Bases selection

- Goal: Control which columns are visible in the task tree and their order, based on the selected
  properties and the order configured in Bases settings
- Deliverables:
  - Read selected property list and their order from container.query.properties (or equivalent view
    config)
  - Generate columns only for selected properties, in the same order
  - Plumb columns into GanttContainer’s task tree (no global state)
  - Unit tests verifying visibility and ordering; integration test exercising recompute on selection
    re-order
- Acceptance Criteria:
  - Only selected properties appear as columns in the task tree
  - Column order matches Bases settings order and updates live when order changes
  - No console errors; re-rendering is stable
- Suggested branch: feat/phase2-columns-visibility-order

### 1) Dynamic Column Generation (Phase 2.3)

- Implement BasesColumnGenerator utility
  - Input: Bases property selection/schema from the active view
  - Output: SVAR column definitions with sensible defaults
  - Formatting: dates, numbers, booleans, arrays/links, text; handle null/empty gracefully
- Integrate into basesGanttViewFactory via DI (no global state)
- Real-time updates: re-generate columns when property selection changes
- Persistence: store user-resized widths; prefer Obsidian workspace state; defer to later if needed
- Acceptance criteria
  - Columns reflect selected properties automatically
  - All supported types render with correct formatting
  - No console errors; zero re-render loops
- Rules alignment
  - Obsidian plugin best practices: modular command/feature factories and DI
  - Architecture: event-based update from Bases selection change

### 2) Integration tests for the mapping pipeline

- Add tests under test/integration/ for Bases + mapping flow
  - Mock Bases controller.runQuery and property schemas
  - Cover: missing-dates behavior (no exclusions), multi-parents duplication, invalid mappings error
    surfaces, reactive refresh path
- Keep unit tests for DataMapper/ValidationEngine; add integration layer tests over the view factory
  boundaries
- Acceptance criteria
  - Deterministic tests passing on CI (Windows runner)
  - Clear Arrange-Act-Assert; mocks injected via DI
- Rules alignment
  - Testing standards: TDD where feasible; isolate external deps; descriptive tests

### 3) UX for missing dates (non-exclusion already done)

- Visual indicators for tasks with missing dates
  - Use a style variant (e.g., dashed/outlined bar) and tooltip prompting user to add dates
  - Zero-length bars must remain visible/selectable
- Config flag wiring: showMissingDateIndicators default true
- Acceptance criteria
  - Indicators visible on tasks with missing start/end
  - No crash when toggling indicators; renders across zoom levels
- Rules alignment
  - Event-based architecture; clean props through GanttContainer

### 4) Type hygiene and ESLint cleanup

- Replace any with structural types for:
  - BasesDataSource inputs/outputs
  - DataMapper/VirtualTaskManager item shapes
  - basesGanttViewFactory controller shape
- Remove or underscore-prefix unused vars to satisfy no-unused-vars rule
- Acceptance criteria
  - Lint warnings reduced to near-zero without disabling rules
- Rules alignment
  - TypeScript-specific coding standards; Clean code principles

### 5) Error UX improvements

- Inline configuration error panel component (distinct from ErrorBoundary)
  - Shows actionable guidance for invalid mappings/missing required fields
  - Non-blocking for non-critical warnings
- Acceptance criteria
  - Clear, localized error messages; link to “open Properties” or docs
- Rules alignment
  - Fail-fast validation; user-friendly errors

### 6) Performance baselining

- Benchmark dataset generator and basic measurements
  - Initial render time, scroll FPS, memory snapshot
- Targets
  - Desktop: <2s for 1k tasks; Mobile goal noted for Phase 3
- Acceptance criteria
  - Report captured and noted in plan; regressions tracked in PRs
- Rules alignment
  - Performance & polish phase prep; measurable metrics

### 7) CI polish

- Add concurrency cancellation so newer commits cancel older runs
- Add node_modules/cache with actions/setup-node cache
- Only run on pull_request (already done)
- Acceptance criteria
  - No duplicate runs per PR; stable durations; artifacts uploaded for e2e

## Suggested branching and PR cadence (Git workflow standards)

- Branches
  - feat/phase2-columns-generator
  - test/phase2-integration-mapping
  - feat/phase2-missing-dates-ux
  - chore/types-eslint-cleanup
  - feat/phase2-error-panel
  - chore/ci-concurrency-cache
- Conventional commits and atomic PRs, rebase before merge, tests on every commit

## Definition of Done (per rules)

- Tests: unit + integration for new logic; e2e updated if UX changes are visible
- Types: no new any; unused vars addressed; strict TS passes
- Lint: no new warnings in touched files
- Docs: update Implementation Plan changelog with decisions
- CI: PR checks green

If you’d like, I can create the first follow-up branch now for “feat/phase2-columns-generator” and
scaffold the BasesColumnGenerator interface and a minimal integration point, following TDD with a
failing test to start.
