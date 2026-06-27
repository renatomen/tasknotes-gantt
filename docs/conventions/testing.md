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

## Running e2e (a first-class gate — run it, don't punt)

WebdriverIO e2e against real Obsidian is central to this project's verification, not an afterthought. The harness is wired and verified on dev machines.

- **One command:** `npm run e2e:local` — builds, installs the plugin into the test vault, and drives a real Obsidian (`scripts/e2e-local.mjs` sets the local-vault default and respects `OBSIDIAN_TEST_VAULT` if exported). Target one spec with WDIO's `--spec` to keep iterations fast.
- **Machine prerequisites** (this Windows dev box): Node 20 via fnm, `NODE_EXTRA_CA_CERTS` pointed at the Norton root CA, a disposable `OBSIDIAN_TEST_VAULT` (never the live Drive vault), and kill any stale `Obsidian.exe` first. See the maintainer's run-config notes.
- **Two tiers, two tools:**
  - **Fast-fixture + synthetic specs** (`gantt-resultset-loop`, `gantt-column-sort`, the `.perf.e2e.ts` storm/perf specs over generated vaults) — **runnable in WDIO; run them.** When a change touches e2e-observable behavior, run the relevant spec rather than deferring it. Do **not** report e2e as "unrunnable."
  - **The full real production vault driven *through* WDIO** is the one walled path (AV-scan + cold-index dead-ends) — verify *that* vault by a manual install (`npm run build` installs to `OBSIDIAN_TEST_VAULT`) plus maintainer review, not WDIO.
- **Loop/notify diagnosis:** the plugin's `[OGDBG]` lifecycle markers are gated off by default; set `window.__tnGanttDebug = true` (in a spec via `executeObsidian`, or by hand in the console) to observe `recompute`/`onDataUpdated`/`coalescer` flow and the `onDataUpdated`-stack (Bases-internal frames ⇒ autonomous re-notify; our-plugin frames ⇒ a feedback loop). Keep such instrumentation cheap and default-off — see `docs/solutions/developer-experience/no-heavy-diagnostics-on-hot-paths.md`.

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
