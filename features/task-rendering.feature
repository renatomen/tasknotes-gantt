Feature: Task Rendering in Gantt Chart
  As a project manager
  I want to see my tasks displayed as visual bars in a Gantt chart
  So that I can understand project timelines and dependencies at a glance

  Background:
    Given I have a vault with task notes
    And the Obsidian Gantt plugin is enabled
    And I have Bases integration configured

  @critical @smoke @gantt-visualization
  Scenario: Display basic task with start and end dates
    Given I have a task note "Project Planning" with properties:
      | property | value      |
      | start    | 2025-01-01 |
      | due      | 2025-01-05 |
    When I open the Gantt view
    Then I should see a task bar for "Project Planning"
    And the task bar should span from "2025-01-01" to "2025-01-05"
    And the task should display the title "Project Planning"

  @critical @gantt-visualization @data-mapping
  Scenario: Display task with missing start date
    Given I have a task note "Research Phase" with properties:
      | property | value      |
      | due      | 2025-01-10 |
    When I open the Gantt view
    Then I should see a task bar for "Research Phase"
    And the task bar should start and end on "2025-01-10"
    And the task should be marked as having inferred dates

  @critical @gantt-visualization @data-mapping
  Scenario: Display task with missing end date
    Given I have a task note "Development" with properties:
      | property | value      |
      | start    | 2025-01-15 |
    When I open the Gantt view
    Then I should see a task bar for "Development"
    And the task bar should start and end on "2025-01-15"
    And the task should be marked as having inferred dates

  @gantt-visualization @data-mapping
  Scenario: Display task with no dates
    Given I have a task note "Future Task" with no date properties
    When I open the Gantt view
    Then I should see a task bar for "Future Task"
    And the task bar should start and end on today's date
    And the task should be marked as having placeholder dates

  @gantt-visualization @data-mapping
  Scenario: Handle inverted date ranges
    Given I have a task note "Backwards Task" with properties:
      | property | value      |
      | start    | 2025-01-10 |
      | due      | 2025-01-05 |
    When I open the Gantt view
    Then I should see a task bar for "Backwards Task"
    And the task bar should span from "2025-01-05" to "2025-01-10"
    And the task should be marked as having swapped dates

  @gantt-visualization @task-types
  Scenario: Display different task types
    Given I have task notes with different types:
      | title     | type      | start      | due        |
      | Planning  | task      | 2025-01-01 | 2025-01-05 |
      | Phase 1   | summary   | 2025-01-01 | 2025-01-15 |
      | Deadline  | milestone | 2025-01-15 | 2025-01-15 |
    When I open the Gantt view
    Then I should see "Planning" displayed as a regular task bar
    And I should see "Phase 1" displayed as a summary task
    And I should see "Deadline" displayed as a milestone marker

  @gantt-visualization @progress
  Scenario: Display task progress
    Given I have a task note "Development" with properties:
      | property | value      |
      | start    | 2025-01-01 |
      | due      | 2025-01-10 |
      | progress | 0.6        |
    When I open the Gantt view
    Then I should see a task bar for "Development"
    And the task bar should show 60% completion
    And the progress should be visually indicated within the task bar

  @gantt-visualization @empty-state
  Scenario: Display empty state when no tasks exist
    Given I have a vault with no task notes
    When I open the Gantt view
    Then I should see an empty state message
    And the message should indicate "No items match"

  @gantt-visualization @error-handling
  Scenario: Handle tasks with invalid data gracefully
    Given I have a task note "Invalid Task" with properties:
      | property | value        |
      | start    | invalid-date |
      | due      | 2025-01-10   |
    When I open the Gantt view
    Then I should see a task bar for "Invalid Task"
    And the task should use fallback date handling
    And no error should be displayed to the user
