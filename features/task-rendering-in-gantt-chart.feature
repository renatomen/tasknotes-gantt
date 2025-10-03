# @assertthat-feature-id: Task Rendering in Gantt Chart
Feature: Task Rendering in Gantt Chart

    @AUTOMATED @gantt-visualization @smoke @critical @imported-from-github
    # @assertthat-scenario-id: 8d98feb5a6dedcd448c98fa9387b8c1e
    Scenario: Display basic task with start and end dates
        Given I have a task note "Project Planning" with properties:
        | property | value      |
        | start    | 2025-01-01 |
        | due      | 2025-01-05 |
        When I open the Gantt view
        Then I should see a task bar for "Project Planning"
        And the task bar should span from "2025-01-01" to "2025-01-05"
        And the task should display the title "Project Planning"

    @AUTOMATED @gantt-visualization @critical @data-mapping @imported-from-github
    # @assertthat-scenario-id: 1bec8c8b66cdcbf8fad1d72a3b46d1bb
    Scenario: Display task with missing start date
        Given I have a task note "Research Phase" with properties:
        | property | value      |
        | due      | 2025-01-10 |
        When I open the Gantt view
        Then I should see a task bar for "Research Phase"
        And the task bar should start and end on "2025-01-10"
        And the task should be marked as having inferred dates

    @AUTOMATED @gantt-visualization @critical @data-mapping @imported-from-github
    # @assertthat-scenario-id: 72608714d15f0c7fb7ff7b4ac1468df8
    Scenario: Display task with missing end date
        Given I have a task note "Development" with properties:
        | property | value      |
        | start    | 2025-01-15 |
        When I open the Gantt view
        Then I should see a task bar for "Development"
        And the task bar should start and end on "2025-01-15"
        And the task should be marked as having inferred dates

    @AUTOMATED @gantt-visualization @data-mapping @imported-from-github
    # @assertthat-scenario-id: 016cda90a5f64cfa099b4a5b995ea6e0
    Scenario: Display task with no dates
        Given I have a task note "Future Task" with no date properties
        When I open the Gantt view
        Then I should see a task bar for "Future Task"
        And the task bar should start and end on today's date
        And the task should be marked as having placeholder dates

    @AUTOMATED @gantt-visualization @data-mapping @imported-from-github
    # @assertthat-scenario-id: a208cbd1e0dca560bfa4d27816413c66
    Scenario: Handle inverted date ranges
        Given I have a task note "Backwards Task" with properties:
        | property | value      |
        | start    | 2025-01-10 |
        | due      | 2025-01-05 |
        When I open the Gantt view
        Then I should see a task bar for "Backwards Task"
        And the task bar should span from "2025-01-05" to "2025-01-10"
        And the task should be marked as having swapped dates

    @AUTOMATED @gantt-visualization @task-types @imported-from-github
    # @assertthat-scenario-id: 156e70e495f9e98b5e0dc4ad653fd1ea
    Scenario: Display different task types
        Given I have task notes with different types:
        | title    | type      | start      | due        |
        | Planning | task      | 2025-01-01 | 2025-01-05 |
        | Phase 1  | summary   | 2025-01-01 | 2025-01-15 |
        | Deadline | milestone | 2025-01-15 | 2025-01-15 |
        When I open the Gantt view
        Then I should see "Planning" displayed as a regular task bar
        And I should see "Phase 1" displayed as a summary task
        And I should see "Deadline" displayed as a milestone marker

    @AUTOMATED @gantt-visualization @progress @imported-from-github
    # @assertthat-scenario-id: 936bc646b235e560fccab4b4f09be5a4
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

    @AUTOMATED @gantt-visualization @empty-state @imported-from-github
    # @assertthat-scenario-id: 663eb265afad324c005aa297f3494fc5
    Scenario: Display empty state when no tasks exist
        Given I have a vault with no task notes
        When I open the Gantt view
        Then I should see an empty state message
        And the message should indicate "No items match"

    @AUTOMATED @gantt-visualization @error-handling @imported-from-github
    # @assertthat-scenario-id: 4c7cb7633e45b483e84a2624a96fc373
    Scenario: Handle tasks with invalid data gracefully
        Given I have a task note "Invalid Task" with properties:
        | property | value        |
        | start    | invalid-date |
        | due      | 2025-01-10   |
        When I open the Gantt view
        Then I should see a task bar for "Invalid Task"
        And the task should use fallback date handling
        And no error should be displayed to the user
