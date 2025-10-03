Feature: Bases Data Mapping
  As a knowledge worker using Obsidian Bases
  I want my note properties to be automatically mapped to Gantt chart data
  So that I can visualize my structured notes as project timelines

  Background:
    Given I have a vault with the Bases plugin enabled
    And the Obsidian Gantt plugin is enabled
    And I have a Bases view configured

  @critical @bases-integration @data-mapping
  Scenario: Map basic note properties to Gantt tasks
    Given I have notes with frontmatter properties:
      | filename    | title        | start      | due        |
      | task-1.md   | First Task   | 2025-01-01 | 2025-01-05 |
      | task-2.md   | Second Task  | 2025-01-03 | 2025-01-08 |
    And I have a Bases view that includes these notes
    When I open the Gantt view through Bases
    Then I should see 2 tasks in the Gantt chart
    And task "First Task" should span from "2025-01-01" to "2025-01-05"
    And task "Second Task" should span from "2025-01-03" to "2025-01-08"

  @critical @bases-integration @field-mappings
  Scenario: Use custom field mappings for task properties
    Given I have notes with custom property names:
      | filename    | task_name    | begin_date | end_date   |
      | project.md  | My Project   | 2025-01-01 | 2025-01-10 |
    And I have configured field mappings:
      | gantt_field | note_property |
      | text        | task_name     |
      | start       | begin_date    |
      | end         | end_date      |
    When I open the Gantt view through Bases
    Then I should see a task "My Project"
    And the task should span from "2025-01-01" to "2025-01-10"

  @bases-integration @data-mapping @file-properties
  Scenario: Map file-based properties to Gantt data
    Given I have notes with file properties:
      | filename      | created    | modified   |
      | document.md   | 2025-01-01 | 2025-01-05 |
    And I have configured field mappings to use file properties:
      | gantt_field | note_property |
      | text        | file.basename |
      | start       | file.created  |
      | end         | file.modified |
    When I open the Gantt view through Bases
    Then I should see a task "document"
    And the task should span from "2025-01-01" to "2025-01-05"

  @bases-integration @data-mapping @hierarchical-tasks
  Scenario: Map parent-child relationships from note properties
    Given I have notes with parent relationships:
      | filename    | title      | parent     | start      | due        |
      | project.md  | Project    |            | 2025-01-01 | 2025-01-20 |
      | phase1.md   | Phase 1    | project    | 2025-01-01 | 2025-01-10 |
      | phase2.md   | Phase 2    | project    | 2025-01-11 | 2025-01-20 |
    When I open the Gantt view through Bases
    Then I should see "Project" as a parent task
    And I should see "Phase 1" as a child of "Project"
    And I should see "Phase 2" as a child of "Project"
    And the hierarchy should be visually represented in the Gantt

  @bases-integration @data-mapping @multi-parent-tasks
  Scenario: Handle tasks with multiple parents using virtual duplicates
    Given I have a note with multiple parents:
      | filename     | title        | parents           | start      | due        |
      | shared.md    | Shared Task  | [project-a, project-b] | 2025-01-01 | 2025-01-05 |
    When I open the Gantt view through Bases
    Then I should see "Shared Task" under "project-a"
    And I should see "Shared Task" under "project-b"
    And both instances should reference the same original note
    And both instances should have the same dates and properties

  @bases-integration @data-mapping @property-flattening
  Scenario: Access nested properties through dot notation
    Given I have notes with nested properties accessible through Bases
    And the properties include file metadata like "file.backlinks"
    When I configure columns to show "file.backlinks"
    Then the Gantt should display backlink information in the column
    And the data should be properly formatted for display

  @bases-integration @data-mapping @date-handling
  Scenario: Handle various date formats from note properties
    Given I have notes with different date formats:
      | filename    | title    | start_date           | due_date    |
      | task1.md    | Task 1   | 2025-01-01           | 2025-01-05  |
      | task2.md    | Task 2   | 2025-01-03T10:30:00Z | 2025-01-08  |
      | task3.md    | Task 3   | January 1, 2025      | 2025-01-10  |
    When I open the Gantt view through Bases
    Then all tasks should be displayed with properly parsed dates
    And the timeline should show correct positioning for all tasks
    And date formatting should be consistent across all tasks

  @bases-integration @data-mapping @missing-data-handling
  Scenario: Handle notes with missing required properties
    Given I have notes with incomplete data:
      | filename    | title      | start      | due |
      | complete.md | Complete   | 2025-01-01 | 2025-01-05 |
      | partial.md  | Partial    | 2025-01-03 |     |
      | minimal.md  | Minimal    |            |     |
    When I open the Gantt view through Bases
    Then all 3 tasks should be displayed
    And "Complete" should show the specified date range
    And "Partial" should show inferred end date equal to start date
    And "Minimal" should show placeholder dates for today

  @bases-integration @data-mapping @real-time-sync
  Scenario: Reflect changes when note properties are updated
    Given I have a note "Dynamic Task" with initial properties:
      | property | value      |
      | start    | 2025-01-01 |
      | due      | 2025-01-05 |
    And I have the Gantt view open through Bases
    When I update the note's "due" property to "2025-01-10"
    And the Bases data is refreshed
    Then the Gantt should automatically update
    And "Dynamic Task" should now span to "2025-01-10"

  @bases-integration @data-mapping @configuration-validation
  Scenario: Validate Gantt configuration from Bases view settings
    Given I have a Bases view with invalid Gantt configuration:
      | setting           | value    |
      | fieldMappings.id  |          |
      | fieldMappings.text|          |
    When I try to open the Gantt view
    Then I should see a configuration error message
    And the error should specify which required fields are missing
    And the Gantt should not render until configuration is fixed
