# @assertthat-feature-id: Virtual Task Handling for Multi-Parent Scenarios
Feature: Virtual Task Handling for Multi-Parent Scenarios
  As a project manager working with complex project structures
  I want tasks to appear under multiple parent projects when they have multiple parents
  So that I can see shared resources and dependencies across different project contexts

  Background:
    Given I have a vault with task notes
    And the Obsidian Gantt plugin is enabled
    And I have Bases integration configured

  @critical @task-management @multi-parent @virtual-tasks
    # @assertthat-scenario-id: d71e5eff87aa23931cbca4fa87f540a4
  Scenario: Create virtual duplicates for tasks with multiple parents
    Given I have a task note "Shared Resource" with properties:
      | property | value                    |
      | title    | Shared Resource          |
      | parents  | [project-alpha, project-beta] |
      | start    | 2025-01-01               |
      | due      | 2025-01-05               |
    When I open the Gantt view
    Then I should see "Shared Resource" under "project-alpha"
    And I should see "Shared Resource" under "project-beta"
    And both instances should have the same dates and properties
    And both instances should reference the same original note ID

  @task-management @virtual-tasks @unique-ids
    # @assertthat-scenario-id: 20eaa2354b5ab2367e23768833f7b752
  Scenario: Generate unique IDs for virtual task duplicates
    Given I have a task note "Multi-Parent Task" with properties:
      | property | value                      |
      | parents  | [parent-1, parent-2, parent-3] |
    When I open the Gantt view
    Then the original task should have ID "multi-parent-task.md"
    And the first virtual duplicate should have ID ending with "::v1"
    And the second virtual duplicate should have ID ending with "::v2"
    And all instances should preserve the original note ID for reference

  @task-management @virtual-tasks @data-consistency
    # @assertthat-scenario-id: 3fb143dfb95508d373ad75159c1ee089
  Scenario: Maintain data consistency across virtual duplicates
    Given I have a task note "Consistent Task" with properties:
      | property | value                    |
      | title    | Consistent Task          |
      | parents  | [team-a, team-b]         |
      | start    | 2025-01-01               |
      | due      | 2025-01-10               |
      | progress | 0.5                      |
      | priority | High                     |
    When I open the Gantt view
    Then both virtual instances should show:
      | property | value           |
      | title    | Consistent Task |
      | start    | 2025-01-01      |
      | due      | 2025-01-10      |
      | progress | 0.5             |
      | priority | High            |

  @task-management @virtual-tasks @single-parent-fallback
    # @assertthat-scenario-id: ccfdafa17018dca7c960fbeb52709036
  Scenario: Handle tasks with single parent normally
    Given I have a task note "Single Parent Task" with properties:
      | property | value             |
      | title    | Single Parent Task|
      | parent   | project-main      |
      | start    | 2025-01-01        |
      | due      | 2025-01-05        |
    When I open the Gantt view
    Then I should see only one instance of "Single Parent Task"
    And it should appear under "project-main"
    And no virtual duplicates should be created

  @task-management @virtual-tasks @no-parent-handling
    # @assertthat-scenario-id: 38f56b09e4eb484455957799c3950205
  Scenario: Handle tasks with no parents
    Given I have a task note "Orphan Task" with properties:
      | property | value       |
      | title    | Orphan Task |
      | start    | 2025-01-01  |
      | due      | 2025-01-05  |
    And the task has no parent or parents property
    When I open the Gantt view
    Then I should see "Orphan Task" at the root level
    And no virtual duplicates should be created
    And the task should be displayed normally

  @task-management @virtual-tasks @empty-parents-array
    # @assertthat-scenario-id: 786df0ca12ca3995f07fd775e4438a2b
  Scenario: Handle tasks with empty parents array
    Given I have a task note "Empty Parents Task" with properties:
      | property | value             |
      | title    | Empty Parents Task|
      | parents  | []                |
      | start    | 2025-01-01        |
      | due      | 2025-01-05        |
    When I open the Gantt view
    Then I should see "Empty Parents Task" at the root level
    And no virtual duplicates should be created
    And the task should be treated as having no parents

  @task-management @virtual-tasks @mixed-parent-types
    # @assertthat-scenario-id: 36b26732ccb3bc473b7603a17721fe4b
  Scenario: Handle tasks with both single parent and parents array
    Given I have a task note "Mixed Parents Task" with properties:
      | property | value                    |
      | title    | Mixed Parents Task       |
      | parent   | primary-project          |
      | parents  | [secondary-a, secondary-b] |
      | start    | 2025-01-01               |
      | due      | 2025-01-05               |
    When I open the Gantt view
    Then the parents array should take precedence
    And I should see "Mixed Parents Task" under "secondary-a"
    And I should see "Mixed Parents Task" under "secondary-b"
    And the single parent property should be ignored

  @task-management @virtual-tasks @performance
    # @assertthat-scenario-id: 020fa15183f0c9e08b3096cfd3dc9925
  Scenario: Handle large numbers of virtual duplicates efficiently
    Given I have task notes with extensive multi-parent relationships:
      | title    | parents                                    |
      | Task A   | [p1, p2, p3, p4, p5]                      |
      | Task B   | [p1, p3, p5, p7, p9]                      |
      | Task C   | [p2, p4, p6, p8, p10]                     |
    When I open the Gantt view
    Then all virtual duplicates should be created efficiently
    And the Gantt should render without performance degradation
    And each task should appear under all its specified parents

  @task-management @virtual-tasks @data-integrity
    # @assertthat-scenario-id: a80da357d68c4317938c4ca1538dfcf6
  Scenario: Preserve original note reference in virtual tasks
    Given I have a task note "Reference Task" with properties:
      | property | value                    |
      | parents  | [project-x, project-y]   |
    When I open the Gantt view
    Then each virtual duplicate should maintain a reference to "reference-task.md"
    And the original note ID should be preserved for data synchronization
    And any updates to the original note should affect all virtual instances

  @task-management @virtual-tasks @hierarchy-display
    # @assertthat-scenario-id: 6254fe21cff417e0d7b51e09b27d0a48
  Scenario: Display virtual tasks correctly in hierarchical view
    Given I have a project structure with virtual tasks:
      | title        | parents              | start      | due        |
      | Project X    |                      | 2025-01-01 | 2025-01-20 |
      | Project Y    |                      | 2025-01-01 | 2025-01-25 |
      | Shared Work  | [project-x, project-y] | 2025-01-05 | 2025-01-15 |
    When I open the Gantt view
    Then I should see the hierarchy:
      """
      Project X
        └── Shared Work
      Project Y
        └── Shared Work
      """
    And both instances of "Shared Work" should be visually indented under their parents
