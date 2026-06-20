# Testing

Core testing principles for the plugin. Test-first, behavior-focused, isolated.

## Test-Driven Development

- Write tests **before** implementation (red → green → refactor).
- Every new feature starts with a failing test.
- Tests must be fast, reliable, and isolated — runnable in any order, no shared state.
- Aim for meaningful coverage over a coverage number; prioritize behavior that can break.

## Test Structure

- **Jest** for unit and integration tests.
- File naming: `*.test.ts` for unit tests, `*.integration.test.ts` for integration tests.
- E2E runs through **WebdriverIO** against a real Obsidian instance (`test/specs/*.e2e.ts`, fixtures under `test/vaults/`).
- Mock external dependencies via **dependency injection** (pass collaborators in, don't reach for globals) — this is what makes the Obsidian API mockable.
- Group related tests in `describe` blocks with clear names.

## Test Quality

- One specific behavior per test.
- Descriptive names that state the expectation: `"should return error when invalid data provided"`.
- Arrange-Act-Assert structure.
- Clean up resources in `afterEach`/`afterAll`.

## Writing Behavior-Focused Tests

Describe **what** the system does from the caller's perspective, not **how** it does it — tests stay stable across refactors.

- Frame each test as a behavior/outcome, not a sequence of internal calls.
- Use **Given–When–Then** thinking: set up state, trigger one action, assert one outcome.
- Use concrete, realistic data rather than vague placeholders; cover edge cases as their own tests.
- Prefer outcome-oriented names (`"user can access their account"`) over implementation-oriented ones (`"clicks login button"`).
- Avoid asserting on private internals — couple to the public contract so the test survives implementation change.

## Obsidian-Specific

- Mock Obsidian APIs (`TFile`, `Vault`, etc.) — inject them so unit tests need no running app.
- Cover error handling and edge cases explicitly (missing/partial dates, undated tasks, invalid config).
- For the Bases view path, exercise the real filtered-entry → field-mapping → render chain in e2e rather than mocking it away.
