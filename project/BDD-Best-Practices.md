# BDD Best Practices for Obsidian Gantt Plugin

## Overview

This document defines the best practices for implementing Behavior-Driven Development (BDD) in the
Obsidian Gantt plugin project. BDD scenarios will serve as our **official requirements** and living
documentation, ensuring alignment between business needs and technical implementation.

## Philosophy

- **BDD scenarios are the single source of truth** for requirements
- **Feature files are living documentation** that stays current with implementation
- **Executable specifications** validate that implementation meets business needs
- **Stakeholder-readable format** enables collaboration across technical and non-technical team
  members

## Repository Structure

### Dual-Purpose Organization

```
obsidian-gantt/
├── features/                           # 📋 Official Requirements (Business-Readable)
│   ├── gantt-visualization/
│   │   ├── task-rendering.feature
│   │   ├── column-management.feature
│   │   ├── responsive-design.feature
│   │   └── performance.feature
│   ├── task-management/
│   │   ├── task-editing.feature
│   │   ├── task-creation.feature
│   │   ├── task-validation.feature
│   │   └── task-lifecycle.feature
│   ├── bases-integration/
│   │   ├── data-mapping.feature
│   │   ├── column-selection.feature
│   │   ├── real-time-sync.feature
│   │   └── configuration.feature
│   ├── data-sources/
│   │   ├── dataview-integration.feature
│   │   ├── yaml-frontmatter.feature
│   │   └── multi-source-support.feature
│   └── user-experience/
│       ├── accessibility.feature
│       ├── mobile-support.feature
│       └── keyboard-navigation.feature
├── test/
│   ├── e2e/
│   │   ├── features/                   # 🧪 Executable BDD Tests
│   │   │   ├── step-definitions/
│   │   │   │   ├── gantt-steps.ts
│   │   │   │   ├── task-steps.ts
│   │   │   │   ├── bases-steps.ts
│   │   │   │   └── common-steps.ts
│   │   │   ├── support/
│   │   │   │   ├── world.ts
│   │   │   │   ├── hooks.ts
│   │   │   │   └── helpers.ts
│   │   │   └── fixtures/
│   │   │       ├── vaults/
│   │   │       └── data/
│   │   └── specs/                      # 🔧 Technical E2E Tests
│   │       └── *.e2e.ts
│   └── wdio/
│       ├── wdio.conf.mts
│       └── wdio.cucumber.conf.mts      # 🥒 Cucumber Config
```

## Integration with WebdriverIO

### Package Dependencies

```json
{
  "devDependencies": {
    "@wdio/cucumber-framework": "^9.19.2",
    "@cucumber/cucumber": "^10.3.1",
    "@types/cucumber": "^7.0.0"
  },
  "scripts": {
    "bdd": "wdio run ./test/wdio/wdio.cucumber.conf.mts",
    "bdd:local": "OBSIDIAN_TEST_VAULT=C:/Users/renato/obsidian-test-vaults/obsidian-gantt-test-vault npm run bdd",
    "bdd:smoke": "wdio run ./test/wdio/wdio.cucumber.conf.mts --cucumberOpts.tagExpression='@smoke'",
    "bdd:critical": "wdio run ./test/wdio/wdio.cucumber.conf.mts --cucumberOpts.tagExpression='@critical'"
  }
}
```

### WebdriverIO Cucumber Configuration

```typescript
// test/wdio/wdio.cucumber.conf.mts
import { config as baseConfig } from "./wdio.conf.mts";
import type { Options } from "@wdio/types";

export const config: Options.Testrunner = {
  ...baseConfig,
  framework: "cucumber",
  specs: ["../../features/**/*.feature"],
  cucumberOpts: {
    require: ["./test/e2e/features/step-definitions/**/*.ts"],
    backtrace: false,
    requireModule: [],
    dryRun: false,
    failFast: false,
    snippets: true,
    source: true,
    strict: false,
    tagExpression: "",
    timeout: 60000,
    ignoreUndefinedDefinitions: false,
  },
  reporters: [
    "spec",
    [
      "cucumber-json",
      {
        outputDir: "./test-results/cucumber/",
        filename: "cucumber-report.json",
      },
    ],
  ],
};
```

## Feature File Standards

### Structure and Format

```gherkin
Feature: [Clear, business-focused title]
  As a [user type]
  I want [functionality]
  So that [business value]

  Background:
    Given [common setup for all scenarios]

  @tag1 @tag2
  Scenario: [Specific behavior description]
    Given [initial context]
    When [action performed]
    Then [expected outcome]
    And [additional verification]

  @tag1 @tag3
  Scenario Outline: [Template for multiple similar scenarios]
    Given [context with <parameter>]
    When [action with <parameter>]
    Then [outcome with <parameter>]

    Examples:
      | parameter | expected_result |
      | value1    | result1        |
      | value2    | result2        |
```

### Example Feature File

```gherkin
Feature: Task Editing in Gantt View
  As an Obsidian user
  I want to edit tasks directly in the Gantt chart
  So that I can quickly update task information without leaving the view

  Background:
    Given I have a vault with task notes
    And the Obsidian Gantt plugin is enabled
    And I have opened a Gantt view with tasks

  @critical @task-editing @smoke
  Scenario: Edit task title via double-click
    Given I can see a task "Write documentation" in the Gantt
    When I double-click on the task
    Then a task editor should open
    When I change the title to "Write comprehensive documentation"
    And I save the changes
    Then the task title should update in the Gantt
    And the underlying note should be updated

  @task-editing @validation
  Scenario: Validate required fields when editing
    Given I can see a task "Review code" in the Gantt
    When I double-click on the task
    And I clear the task title
    And I try to save the changes
    Then I should see a validation error
    And the task should not be updated

  @task-editing @bases-integration
  Scenario: Edit task through Bases integration
    Given I have a Bases view configured for tasks
    And I can see tasks in the Gantt from Bases
    When I double-click on a Bases-sourced task
    Then the appropriate editor should open
    When I update the task properties
    And I save the changes
    Then the Gantt should reflect the changes
    And the Bases data should be updated
```

## Step Definition Standards

### File Organization

- **One step definition file per domain** (gantt-steps.ts, task-steps.ts, etc.)
- **Common steps** in shared files (common-steps.ts)
- **Page objects** for complex UI interactions
- **Helper functions** for data setup and verification

### Example Step Definitions

```typescript
// test/e2e/features/step-definitions/task-steps.ts
import { Given, When, Then } from "@cucumber/cucumber";
import { browser, expect, $ } from "@wdio/globals";

Given("I have a vault with task notes", async function () {
  await browser.reloadObsidian({
    vault: process.env.OBSIDIAN_TEST_VAULT || "test/vaults/tasks",
  });
});

Given("I can see a task {string} in the Gantt", async function (taskTitle: string) {
  await browser.executeObsidianCommand("obsidian-gantt:open");
  await expect($(`.gantt_task_row*=${taskTitle}`)).toExist();
  this.currentTask = taskTitle;
});

When("I double-click on the task", async function () {
  await $(`.gantt_task_row*=${this.currentTask}`).doubleClick();
});

Then("a task editor should open", async function () {
  await expect($(".modal-container .task-editor")).toExist();
});

When("I change the title to {string}", async function (newTitle: string) {
  const titleInput = $('.task-editor input[data-testid="task-title"]');
  await titleInput.clearValue();
  await titleInput.setValue(newTitle);
  this.newTaskTitle = newTitle;
});

When("I save the changes", async function () {
  await $('.task-editor button[data-testid="save-task"]').click();
});

Then("the task title should update in the Gantt", async function () {
  await expect($(`.gantt_task_row*=${this.newTaskTitle}`)).toExist();
});
```

## Tagging Strategy

### Tag Categories

- **Priority**: `@critical`, `@high`, `@medium`, `@low`
- **Test Type**: `@smoke`, `@regression`, `@integration`
- **Domain**: `@task-management`, `@gantt-visualization`, `@bases-integration`
- **Platform**: `@desktop`, `@mobile`, `@cross-platform`
- **Performance**: `@performance`, `@load-test`
- **Accessibility**: `@accessibility`, `@keyboard-nav`

### Tag Usage Examples

```gherkin
@critical @smoke @task-management
Scenario: Basic task creation

@bases-integration @data-mapping @regression
Scenario: Map Bases properties to Gantt columns

@mobile @responsive @accessibility
Scenario: Navigate Gantt on mobile device

@performance @load-test
Scenario: Render 1000+ tasks efficiently
```

## World Object and Context Management

### World Configuration

```typescript
// test/e2e/features/support/world.ts
import { setWorldConstructor, World, IWorldOptions } from "@cucumber/cucumber";
import { browser } from "@wdio/globals";

export interface CustomWorld extends World {
  currentTask?: string;
  newTaskTitle?: string;
  testVault?: string;
  ganttConfig?: any;
  basesView?: any;
}

export class CustomWorldConstructor extends World implements CustomWorld {
  currentTask?: string;
  newTaskTitle?: string;
  testVault?: string;
  ganttConfig?: any;
  basesView?: any;

  constructor(options: IWorldOptions) {
    super(options);
  }

  async setupTestVault(vaultName: string) {
    this.testVault = `test/vaults/${vaultName}`;
    await browser.reloadObsidian({ vault: this.testVault });
  }

  async openGanttView() {
    await browser.executeObsidianCommand("obsidian-gantt:open");
    await browser.waitUntil(async () => await $(".gantt_container").isExisting(), {
      timeout: 10000,
      timeoutMsg: "Gantt view did not open",
    });
  }
}

setWorldConstructor(CustomWorldConstructor);
```

### Hooks for Setup and Cleanup

```typescript
// test/e2e/features/support/hooks.ts
import { Before, After, BeforeAll, AfterAll } from "@cucumber/cucumber";
import { browser } from "@wdio/globals";

BeforeAll(async function () {
  // Global setup
  console.log("Starting BDD test suite");
});

Before(async function (scenario) {
  // Reset state before each scenario
  this.currentTask = undefined;
  this.newTaskTitle = undefined;

  // Tag-based setup
  if (scenario.pickle.tags.some((tag) => tag.name === "@bases-integration")) {
    await this.setupTestVault("bases-tasks");
  } else if (scenario.pickle.tags.some((tag) => tag.name === "@task-management")) {
    await this.setupTestVault("simple-tasks");
  }
});

After(async function (scenario) {
  // Cleanup after each scenario
  if (scenario.result?.status === "FAILED") {
    // Take screenshot on failure
    const screenshot = await browser.takeScreenshot();
    this.attach(screenshot, "image/png");
  }

  // Reset Obsidian state
  await browser.executeObsidianCommand("app:reload");
});

AfterAll(async function () {
  // Global cleanup
  console.log("BDD test suite completed");
});
```

## Vault Fixtures Management

### Vault Structure

```
test/e2e/features/fixtures/vaults/
├── simple-tasks/
│   ├── .obsidian/
│   │   ├── plugins/
│   │   │   └── obsidian-gantt/
│   │   │       ├── data.json
│   │   │       └── manifest.json
│   │   └── config.json
│   ├── Task 1.md
│   ├── Task 2.md
│   └── Project Overview.md
├── bases-tasks/
│   ├── .obsidian/
│   │   ├── plugins/
│   │   │   ├── obsidian-gantt/
│   │   │   └── bases/
│   │   └── config.json
│   └── [Bases-configured notes]
└── complex-project/
    ├── .obsidian/
    ├── Projects/
    ├── Tasks/
    └── Archive/
```

### Data Builders

```typescript
// test/e2e/features/support/helpers.ts
export class TaskBuilder {
  private task: any = {};

  withTitle(title: string): TaskBuilder {
    this.task.title = title;
    return this;
  }

  withDueDate(date: string): TaskBuilder {
    this.task.dueDate = date;
    return this;
  }

  withStatus(status: string): TaskBuilder {
    this.task.status = status;
    return this;
  }

  build(): any {
    return { ...this.task };
  }
}

export class VaultBuilder {
  private notes: any[] = [];

  addTask(task: any): VaultBuilder {
    this.notes.push({
      filename: `${task.title}.md`,
      content: this.generateTaskContent(task),
    });
    return this;
  }

  private generateTaskContent(task: any): string {
    return `---
title: ${task.title}
dueDate: ${task.dueDate || ""}
status: ${task.status || "todo"}
---

# ${task.title}

Task content here.
`;
  }

  async createInVault(vaultPath: string): Promise<void> {
    // Implementation to create notes in test vault
  }
}
```

## CI/CD Integration

### GitHub Actions Workflow

```yaml
# .github/workflows/bdd.yml
name: BDD Tests

on:
  pull_request:
  push:
    branches: [main]

jobs:
  bdd-tests:
    runs-on: windows-latest
    strategy:
      matrix:
        test-suite: [smoke, critical, regression]

    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"

      - name: Install dependencies
        run: npm ci

      - name: Build plugin
        run: npm run build

      - name: Setup test vault
        shell: pwsh
        run: |
          $vault = "$Env:RUNNER_TEMP\\bdd-vault"
          echo "OBSIDIAN_TEST_VAULT=$vault" | Out-File -FilePath $Env:GITHUB_ENV -Encoding utf8 -Append
          New-Item -ItemType Directory -Force -Path $vault | Out-Null

      - name: Run BDD tests
        run: npm run bdd:${{ matrix.test-suite }}

      - name: Upload BDD reports
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: bdd-reports-${{ matrix.test-suite }}
          path: |
            test-results/
            screenshots/
```

## Development Workflow

### Writing New Features

1. **Start with Feature File**: Write `.feature` file in appropriate domain folder
2. **Define Scenarios**: Use Given/When/Then format with clear business language
3. **Add Tags**: Apply appropriate tags for organization and execution
4. **Implement Steps**: Create step definitions in TypeScript
5. **Run Tests**: Execute BDD scenarios to validate implementation
6. **Iterate**: Refine scenarios and implementation together

### Example Workflow Commands

```bash
# Run all BDD scenarios
npm run bdd

# Run only smoke tests
npm run bdd:smoke

# Run specific domain tests
npm run bdd -- --cucumberOpts.tagExpression='@task-management'

# Run tests excluding slow scenarios
npm run bdd -- --cucumberOpts.tagExpression='not @slow'

# Generate step definition snippets for new scenarios
npm run bdd -- --cucumberOpts.dryRun=true
```

## Quality Standards

### Feature File Quality

- **Clear business language**: Avoid technical jargon
- **Focused scenarios**: One behavior per scenario
- **Reusable steps**: Common steps across multiple scenarios
- **Meaningful tags**: Consistent tagging strategy
- **Living documentation**: Keep scenarios current with implementation

### Step Definition Quality

- **Single responsibility**: Each step does one thing
- **Robust selectors**: Use data-testid attributes where possible
- **Proper waits**: Use WebdriverIO expectations, avoid arbitrary sleeps
- **Error handling**: Clear error messages for debugging
- **Maintainable code**: Follow TypeScript and testing best practices

### Reporting and Metrics

- **Scenario coverage**: Track which requirements have BDD scenarios
- **Execution reports**: Generate HTML reports from Cucumber JSON
- **Trend analysis**: Monitor scenario success rates over time
- **Performance tracking**: Monitor scenario execution times

## Benefits of This Approach

### ✅ **Living Requirements**

- Feature files serve as official, always-current requirements
- Business stakeholders can read and validate requirements
- Requirements and tests evolve together

### ✅ **Improved Collaboration**

- Common language between business and technical teams
- Clear traceability from requirements to implementation
- Stakeholder involvement in requirement validation

### ✅ **Quality Assurance**

- Executable specifications ensure implementation matches requirements
- Comprehensive test coverage through scenario-driven development
- Early detection of requirement gaps or misunderstandings

### ✅ **Documentation**

- Self-documenting system through feature files
- Examples of expected behavior for new team members
- Historical record of requirement changes

This BDD approach transforms requirements from static documents into living, executable
specifications that drive development and ensure quality throughout the project lifecycle.
