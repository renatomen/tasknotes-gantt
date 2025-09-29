## Recommended next implementation steps for phase 2

Phase 2 – Bases data integration (read-only), minimal viable path first:

### Progress so far (2025-09-23)

- ValidationEngine implemented with sensible defaults and clear errors; unit tests passing
- DataMapper implemented; date policy changed to safe placeholders (no inference, never exclude)
- Robust date coercion (supports Date, moment-like toDate/toJSDate, string/number)
- BasesDataSource implemented and wired via basesGanttViewFactory; real Bases data rendered
- VirtualTaskManager implemented for multiple parents (virtual duplicates retain original noteId)
- Minimal UI feedback done: inline config error + "No items match" empty state
- CI local: tests/typecheck/build passing; plugin installed to test vault
- Decision: keep settings from Bases view config (YAML parser deferred)

1. Config schema and validation (ValidationEngine)

- Define GanttConfig schema (align with plan)
- Validate FieldMappings: require id and text; others optional
- Add helpful error messages and defaults:
  - defaultDuration, showMissingDates, missingStart/End behavior
- Tests: unit tests for validator with good/bad configs

2. Data mapping pipeline (DataMapper)

- Implement DataMapper to transform Bases rows to SVAR tasks/links using FieldMappings
- Handle missing dates via policy:
  - If only start provided, compute end from defaultDuration
  - If only end provided, backfill start from defaultDuration
  - Optional flags for indicators of missing dates
- Tests: mapping edge-cases, date coercion, invalid types

3. Bases adapter (BasesDataSource)

- Implement BasesDataSource using the factory’s container/controller
  - initialize(): capture controller
  - queryData(): await controller.runQuery() and normalize results
  - mapToSVARFormat(): delegate to DataMapper
  - validateConfig(): delegate to ValidationEngine
- Wire the factory to call adapter + mapper and render real tasks
- Tests: adapter unit tests with mocked controller results

4. Virtual tasks for multi-parents (VirtualTaskManager)

- Duplicate tasks that have multiple parents while preserving original note ID
- Ensure consistent linking and sorting
- Tests: multiple parent scenarios and link integrity

5. Minimal UI feedback paths

- If config invalid: render inline error (ErrorBoundary-friendly message)
- If query empty: render “No items match” state

6. Integration tests

- Mock Bases controller and verify:
  - real data replaces dummy
  - reactive refresh paths call adapter again
  - ephemeral state persists

7. Optional: Dynamic columns groundwork (defer width persistence if needed)

- Start a thin ColumnGenerator that uses selected properties
- Leave resizer/persistence for later per plan

### Next steps (proposed)

1. Integration tests for Bases adapter and reactive refresh paths (mock controller.runQuery)
2. Dynamic ColumnGenerator (property-based columns); defer width persistence
3. Visual indicators for missing dates (style/marker) and tooltip prompting users to add dates
4. Reduce ESLint any/unused warnings by adding structural types for Bases controller/results
5. Improve error UX: inline config error panel with actionable tips
6. Performance baseline checks (large dataset) and ensure zero-length bars remain visible
7. Optional later: YAML parser for obsidianGantt config if/when we move beyond Bases view config
8. Prepare PR: docs updates, change log entries, and review

Nice-to-have (can be parallelized later):

- Concurrency in CI (cancel in progress on newer pushes)
- React DevTools hook in dev mode only

If you’d like, I can start a new branch for Phase 2 (e.g., feat/phase2-bases-mapping-adapter),
implement “Config + DataMapper + Bases adapter” with tests first, and keep dummy data as a fallback
behind a feature flag during the transition.

Also, please confirm how you want to handle the project/ docs in git:

- Keep ignored (no commits), or
- Track them (I’ll force-add this updated plan or adjust .gitignore).
