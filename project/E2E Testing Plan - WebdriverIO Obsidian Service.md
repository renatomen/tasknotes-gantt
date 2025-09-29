# End-to-End Testing Plan (WebdriverIO + wdio-obsidian-service)

This document defines guidance, principles, and an implementation plan to add E2E tests for
obsidian-gantt using WebdriverIO (WDIO) and wdio-obsidian-service. The plugin uses **SVAR Svelte
Gantt** (@svar-ui/svelte-gantt) with Svelte 5 architecture. It adheres to our repository standards:
architecture, code quality, testing, and git workflow.

## Objectives

- Validate core user journeys in a real Obsidian runtime (desktop, optionally mobile
  emulation/Android).
- Test SVAR Svelte Gantt component interactions and Svelte 5 reactive behavior.
- Verify Bases integration and data mapping functionality.
- Keep tests fast, deterministic, and maintainable.
- Exercise integration points (e.g., task editing, Bases data sync) without brittle coupling.

## Principles (aligned with our rules)

- Architecture: clear boundaries; tests target public/plugin-level behaviors, not internals. DI for
  test utilities.
- Code quality: TypeScript strict, small helpers/utilities, consistent naming, minimal flake.
- Testing standards: acceptance-style specs, Arrange–Act–Assert, isolated state via vault fixtures;
  fast path uses resetVault.
- Git workflow: conventional commits, run tests on every commit in CI, trunk-based with short-lived
  branches.

## Tooling Stack

- WebdriverIO (Mocha runner + @wdio/globals expect)
- wdio-obsidian-service (launch Obsidian, manage vaults, helpers)
- wdio-obsidian-reporter (reports Obsidian app version)
- Optional: Appium for Android (later phase)

## Repository Layout (tests)

- test/
  - e2e/
    - features/ … BDD step definitions and support files
      - step-definitions/ … gantt-steps.ts, task-steps.ts, bases-steps.ts, common-steps.ts
      - support/ … world.ts, hooks.ts, helpers.ts
      - fixtures/ … vaults/ and data/
    - specs/ … Technical E2E specs (e.g., \*.e2e.ts)
  - utils/ … selectors, page helpers, data builders
  - vaults/ … baseline vault fixtures (tasks/, bases-tasks/, simple-tasks/)
  - wdio/
    - wdio.conf.mts (desktop)
    - wdio.mobile.conf.mts (optional)
    - wdio.cucumber.conf.mts (BDD scenarios)
- features/ … Official BDD requirements (business-readable)

## Dependency and Config Setup (guidance)

Do not install yet; these are the required dev deps:

- wdio-obsidian-service, wdio-obsidian-reporter, mocha, @types/mocha, webdriverio core packages

tsconfig additions (types must include WDIO and the service): <augment_code_snippet mode="EXCERPT">

```json
{
  "compilerOptions": {
    "types": ["@wdio/globals/types", "@wdio/mocha-framework", "wdio-obsidian-service"]
  }
}
```

</augment_code_snippet>

Minimal WDIO config (desktop): <augment_code_snippet mode="EXCERPT">

```ts
export const config = {
  runner: "local",
  framework: "mocha",
  specs: ["./test/specs/**/*.e2e.ts"],
  capabilities: [
    {
      browserName: "obsidian",
      browserVersion: "latest",
      "wdio:obsidianOptions": { plugins: ["."], vault: "test/vaults/simple" },
    },
  ],
  services: ["obsidian"],
  reporters: ["obsidian"],
};
```

</augment_code_snippet>

## Vault Fixtures Strategy

- Store minimal, readable fixtures in test/vaults/\* (markdown + .obsidian config as needed).
- Each spec should either:
  - Use obsidianPage.resetVault() for fast resets, or
  - Use browser.reloadObsidian({ vault }) for full clean boot (slower, use sparingly: before all
    tests or when testing startup behavior).
- Keep fixtures focused per journey:
  - `tasks/`: Basic task notes for general testing
  - `bases-tasks/`: Bases-integrated tasks for data mapping tests
  - `simple-tasks/`: Simple task structure for smoke tests
- Align with BDD feature file organization and tag-based vault selection

## Authoring Tests

- **Stable Selectors**: Use consistent CSS classes and data attributes:
  - `.gantt_container`: Main Gantt wrapper
  - `.gantt_task_row`: Task rows in grid
  - Add `data-testid` attributes to custom components
  - Follow BDD step definition patterns for selector consistency
- **BDD Integration**: Align with Cucumber step definitions and world objects
- **Synchronization**: rely on WDIO waiters/expect; avoid arbitrary sleeps
- **Tag-based Organization**: Use BDD tags for test categorization and vault selection
- Keep specs focused; one behavior per test; consistent naming
- Example basic spec following BDD patterns: <augment_code_snippet mode="EXCERPT">

```ts
import { browser } from "@wdio/globals";

describe("obsidian-gantt smoke", () => {
  before(async () => await browser.reloadObsidian({ vault: "test/vaults/tasks" }));
  it("loads plugin and shows gantt view", async () => {
    await browser.executeObsidianCommand("obsidian-gantt:open");
    // Use consistent selectors from BDD step definitions
    await expect($(".gantt_container")).toExist();
    // Check for task rows in the grid
    await expect($(".gantt_task_row")).toExist();
  });
});
```

</augment_code_snippet>

### Task Interaction E2E (BDD-aligned)

- Precondition: have a vault with task notes and obsidian-gantt configured.
- Happy path scenarios:
  1. Double-click a task row in Gantt -> task editor opens.
  2. Edit task properties -> Gantt updates.
  3. Save changes -> task data persists.
- Example skeleton following BDD patterns: <augment_code_snippet mode="EXCERPT">

```ts
it("opens task editor from gantt double-click", async () => {
  await browser.reloadObsidian({ vault: "test/vaults/tasks" });
  // Wait for Gantt to load with tasks
  await expect($(".gantt_container")).toExist();
  // Double-click on a task row (consistent with BDD steps)
  await $(".gantt_task_row").doubleClick();
  // Verify task editor opens
  await expect($(".modal-container .task-editor")).toExist();
});

it("updates task title through editor", async () => {
  await browser.reloadObsidian({ vault: "test/vaults/tasks" });
  await $(".gantt_task_row").doubleClick();

  const titleInput = $('.task-editor input[data-testid="task-title"]');
  await titleInput.clearValue();
  await titleInput.setValue("Updated Task Title");

  await $('.task-editor button[data-testid="save-task"]').click();

  // Verify update in Gantt (consistent with BDD expectations)
  await expect($(".gantt_task_row*=Updated Task Title")).toExist();
});
```

</augment_code_snippet>

## Obsidian Versions Matrix

- Default matrix: earliest (minAppVersion), latest.
- Optional: latest-beta if Insiders creds present.
- Keep cache dir (.obsidian-cache) between runs to speed downloads (CI cache).

## Mobile Testing

- Emulation (easy): enable emulateMobile capability and Chrome device metrics. <augment_code_snippet
  mode="EXCERPT">

```ts
capabilities: [
  {
    browserName: "obsidian",
    browserVersion: "latest",
    "wdio:obsidianOptions": { emulateMobile: true },
    "goog:chromeOptions": { mobileEmulation: { deviceMetrics: { width: 390, height: 844 } } },
  },
];
```

</augment_code_snippet>

- Android (accurate, slower): use Appium + AVD per service docs (later phase).

## BDD Integration Patterns

### Cucumber Framework Integration

- **Feature Files**: Business-readable requirements in `/features/` directory
- **Step Definitions**: Technical implementation in `/test/e2e/features/step-definitions/`
- **World Object**: Shared context and helper methods across scenarios
- **Tag-based Execution**: Run specific test suites using Cucumber tags

### Selector Consistency with BDD

```typescript
// Standard selectors used in both BDD and E2E tests
".gantt_container"; // Main Gantt wrapper
".gantt_task_row"; // Task rows in grid
".modal-container"; // Modal dialogs
".task-editor"; // Task editing interface
'[data-testid="task-title"]'; // Task title input
'[data-testid="save-task"]'; // Save button
```

### BDD-E2E Alignment Patterns

```typescript
// E2E test that mirrors BDD step definitions
it("follows BDD task editing pattern", async () => {
  // Given: I have a vault with task notes
  await browser.reloadObsidian({ vault: "test/vaults/tasks" });

  // And: I can see a task in the Gantt
  await browser.executeObsidianCommand("obsidian-gantt:open");
  await expect($(".gantt_task_row*=My Task")).toExist();

  // When: I double-click on the task
  await $(".gantt_task_row*=My Task").doubleClick();

  // Then: a task editor should open
  await expect($(".modal-container .task-editor")).toExist();

  // When: I change the title and save
  const titleInput = $('.task-editor input[data-testid="task-title"]');
  await titleInput.clearValue();
  await titleInput.setValue("Updated Task");
  await $('.task-editor button[data-testid="save-task"]').click();

  // Then: the task title should update in the Gantt
  await expect($(".gantt_task_row*=Updated Task")).toExist();
});
```

### Tag-based Vault Selection

```typescript
// Align E2E vault selection with BDD tag patterns
const getVaultForTags = (tags: string[]) => {
  if (tags.includes("@bases-integration")) return "test/vaults/bases-tasks";
  if (tags.includes("@task-management")) return "test/vaults/simple-tasks";
  return "test/vaults/tasks";
};
```

## CI Guidance

- Run E2E on push/PR, matrix over app/installer versions when feasible.
- Cache .obsidian-cache and node_modules to reduce CI time.
- Export WDIO logs/artifacts as CI artifacts on failure (screenshots/logs).
- Gate merges on green (unit + E2E) per git workflow.

## Implementation Plan (Phased)

1. Bootstrap
   - Add test skeleton folders and baseline vaults (tasks/, bases-tasks/, simple-tasks/).
   - Add tsconfig types for WDIO; add minimal wdio.conf.mts (desktop only).
   - Add npm scripts: "e2e": "wdio run ./test/wdio/wdio.conf.mts", "bdd": "wdio run
     ./test/wdio/wdio.cucumber.conf.mts".
   - Set up BDD framework integration with Cucumber.
2. BDD Foundation
   - Create feature files in `/features/` directory as official requirements.
   - Implement step definitions following BDD best practices.
   - Set up world object and hooks for test context management.
   - Establish tag-based test organization and execution.
3. Smoke Tests (BDD + E2E)
   - Verify Obsidian launches, plugin loads, Gantt renders.
   - Implement both BDD scenarios and technical E2E tests.
   - Keep fast using resetVault where possible.
4. Task Management Path
   - Create task editing scenarios in BDD format.
   - Implement corresponding step definitions.
   - Write E2E tests that mirror BDD patterns.
5. Bases Integration Path
   - Create bases-tasks vault fixture with Bases plugin and configured views.
   - Write BDD scenarios for data mapping and synchronization.
   - Implement E2E tests following BDD selector patterns.
6. Cross-Version Matrix
   - Add earliest + latest; optionally latest-beta when creds exist.
   - Stabilize selectors/timeouts consistent with BDD patterns.
7. Mobile Emulation
   - Add emulation job; run subset of smoke and interaction tests.
   - Ensure BDD scenarios work on mobile platforms.
8. CI Hardening
   - Cache, retries (Mocha-level), flaky test triage; split long specs.
   - Integrate BDD reporting with CI pipeline.

## Quality and Maintainability

- Keep tests < 1 minute each; parallelize via maxInstances.
- Small page helpers in test/utils (aligned with BDD world object):
  - `openGanttView()`: Open Gantt view (consistent with BDD steps)
  - `waitForGanttLoad()`: Wait for Gantt component to fully render
  - `selectTask(taskTitle)`: Select task by title
  - `editTask(taskTitle, properties)`: Edit task properties
  - `setupTestVault(vaultType)`: Set up vault based on BDD tags
- **BDD-aligned helpers**:
  - `getTaskElement(taskTitle)`: Get task element by title (consistent with BDD)
  - `waitForModalOpen()`: Wait for task editor modal
  - `saveTaskChanges()`: Save task editor changes
- Data locality: fixtures live with tests; avoid magical cross-coupling.
- Document selectors consistent with BDD step definitions; avoid brittle DOM assumptions.
- Maintain selector consistency between BDD and E2E tests.

## Risks & Mitigations

- **Flaky UI timings** → prefer expect-based waits; use resetVault; avoid global reloads.
- **BDD-E2E selector drift** → maintain consistency between step definitions and E2E tests;
  centralize selectors.
- **Gantt rendering delays** → wait for `.gantt_container` element and task data loading.
- **Version drift in Obsidian** → matrix & reporter pin deltas; keep selectors resilient.
- **BDD step definition complexity** → keep steps simple and reusable; avoid overly specific
  scenarios.
- **Plugin ID/naming changes** → centralize in constants shared between BDD and E2E.
- **Vault fixture maintenance** → align vault structures with BDD tag organization; automate setup.

## Developer Workflow

- Run unit tests locally first; then run fast subset of E2E (smoke).
- Commit atomically: feat(test): add TaskNotes E2E smoke, etc.
- Keep branches short-lived; rebase before merge.

## Next Steps

- Approve plan → I’ll scaffold test folders, sample vaults, minimal configs (no installs).
- Then, with permission, I’ll add the exact devDeps and wire CI.
