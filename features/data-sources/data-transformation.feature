# @assertthat-feature-id: Data Transformation and Mapping
Feature: Data Transformation and Mapping
  As a developer integrating various data sources
  I want consistent data transformation from any source to SVAR Gantt format
  So that the Gantt chart can display data regardless of the original source structure

  Background:
    Given I have the Obsidian Gantt plugin enabled
    And I have various data sources available

  @critical @data-transformation @field-mapping
    # @assertthat-scenario-id: ee31ec10e660247c9b7cb493daf083f1
  Scenario: Transform basic note data to SVAR task format
    Given I have raw note data:
      | path        | title      | start      | due        |
      | task-1.md   | First Task | 2025-01-01 | 2025-01-05 |
    And I have field mappings configured:
      | gantt_field | source_field |
      | id          | path         |
      | text        | title        |
      | start       | start        |
      | end         | due          |
    When the data is transformed to SVAR format
    Then I should get a task with:
      | property | value      |
      | id       | task-1.md  |
      | text     | First Task |
      | start    | 2025-01-01 |
      | end      | 2025-01-05 |

  @data-transformation @date-conversion
    # @assertthat-scenario-id: 215fde7d9ead539322e2530fca9e0ef9
  Scenario: Convert various date formats to Date objects
    Given I have raw data with different date formats:
      | task | start_date           | end_date             |
      | A    | 2025-01-01           | 2025-01-05           |
      | B    | 2025-01-03T10:30:00Z | 2025-01-08T15:45:00Z |
      | C    | January 1, 2025      | January 10, 2025     |
    When the data is transformed to SVAR format
    Then all start and end dates should be JavaScript Date objects
    And all dates should be correctly parsed and positioned
    And timezone information should be handled appropriately

  @data-transformation @missing-data @date-inference
    # @assertthat-scenario-id: 3399a5c06c2eff19722d35f05a671358
  Scenario: Handle missing dates with inference strategy
    Given I have raw data with missing dates:
      | task | start      | end        |
      | A    | 2025-01-01 |            |
      | B    |            | 2025-01-05 |
      | C    |            |            |
    And the missing date behavior is set to "infer"
    When the data is transformed to SVAR format
    Then task A should have end date equal to start date
    And task B should have start date equal to end date
    And task C should have both dates set to today
    And all tasks should be marked with missing date indicators

  @data-transformation @date-validation @inverted-ranges
    # @assertthat-scenario-id: 0d63d6e39667ef65f774b41bbdb49096
  Scenario: Handle inverted date ranges by swapping
    Given I have raw data with inverted dates:
      | task | start      | end        |
      | A    | 2025-01-10 | 2025-01-05 |
    When the data is transformed to SVAR format
    Then the task should have start date "2025-01-05"
    And the task should have end date "2025-01-10"
    And the task should be marked as having swapped dates

  @data-transformation @property-preservation
    # @assertthat-scenario-id: cd1817711bb11549d8719f680e25f039
  Scenario: Preserve all source properties in transformed tasks
    Given I have raw data with custom properties:
      | path      | title | start      | priority | assignee | custom_field |
      | task.md   | Task  | 2025-01-01 | High     | John     | Special      |
    When the data is transformed to SVAR format
    Then the resulting task should include all original properties
    And custom properties should be accessible for column display
    And reserved SVAR properties should not be overwritten

  @data-transformation @multi-parent @virtual-expansion
    # @assertthat-scenario-id: 10e915946ef97a11445c7be832a8cca3
  Scenario: Expand tasks with multiple parents into virtual duplicates
    Given I have raw data with multi-parent tasks:
      | path        | title        | parents           | start      |
      | shared.md   | Shared Task  | [proj-a, proj-b] | 2025-01-01 |
    When the data is transformed and virtual tasks are expanded
    Then I should get 2 tasks in the result
    And the first task should have parent "proj-a"
    And the second task should have parent "proj-b"
    And both tasks should have the same noteId "shared.md"
    And the second task should have ID ending with "::v1"

  @data-transformation @type-mapping
    # @assertthat-scenario-id: 6466952ec94fefad983431beb9ddc840
  Scenario: Map task types to SVAR format
    Given I have raw data with task types:
      | task | type      | start      | end        |
      | A    | task      | 2025-01-01 | 2025-01-05 |
      | B    | summary   | 2025-01-01 | 2025-01-15 |
      | C    | milestone | 2025-01-15 | 2025-01-15 |
    When the data is transformed to SVAR format
    Then task A should have type "task"
    And task B should have type "summary"
    And task C should have type "milestone"

  @data-transformation @progress-normalization
    # @assertthat-scenario-id: 7c16b0bf78f7712c8552a8c3c154977b
  Scenario: Normalize progress values to 0-1 range
    Given I have raw data with various progress formats:
      | task | progress |
      | A    | 0.5      |
      | B    | 50       |
      | C    | 75%      |
    When the data is transformed to SVAR format
    Then task A should have progress 0.5
    And task B should have progress 0.5 (assuming 50 means 50%)
    And task C should have progress 0.75

  @data-transformation @duration-calculation
    # @assertthat-scenario-id: 59eb847b100ebba56bcadf52ed169549
  Scenario: Calculate duration from start and end dates
    Given I have raw data with date ranges:
      | task | start      | end        |
      | A    | 2025-01-01 | 2025-01-05 |
      | B    | 2025-01-03 | 2025-01-03 |
    When the data is transformed to SVAR format
    Then task A should have a calculated duration
    And task B should have a duration representing a single day
    And duration should be consistent with the date range

  @data-transformation @validation @config-validation
    # @assertthat-scenario-id: b79664037d5449835182cfe67c52c88f
  Scenario: Validate transformation configuration
    Given I have a transformation configuration with missing required fields:
      | field_mapping | value |
      | id            |       |
      | text          | title |
    When I attempt to validate the configuration
    Then validation should fail
    And I should receive an error about missing required field mappings
    And the error should specify which fields are required

  @data-transformation @error-handling @malformed-data
    # @assertthat-scenario-id: 31f421e937527a04d3ade53b71a276e4
  Scenario: Handle malformed source data gracefully
    Given I have raw data with malformed entries:
      | entry | data                    |
      | 1     | { "title": "Valid" }    |
      | 2     | null                    |
      | 3     | { "title": 123 }        |
    When the data is transformed to SVAR format
    Then valid entries should be transformed successfully
    And malformed entries should be handled gracefully
    And the transformation should not fail completely
    And appropriate fallback values should be used for invalid data

  @data-transformation @performance @large-datasets
    # @assertthat-scenario-id: 479f557c9fcfe8c65eef306ea48b2345
  Scenario: Transform large datasets efficiently
    Given I have a dataset with 1000 task entries
    And each entry has 10 custom properties
    When the data is transformed to SVAR format
    Then the transformation should complete in under 1 second
    And memory usage should remain reasonable
    And all 1000 tasks should be correctly transformed
