Feature: Column Management in Gantt View
  As a project manager
  I want to customize which columns are displayed in the Gantt grid
  So that I can see the most relevant task information for my workflow

  Background:
    Given I have a vault with task notes
    And the Obsidian Gantt plugin is enabled
    And I have Bases integration configured

  @critical @column-management @bases-integration
  Scenario: Display default columns when no configuration exists
    Given I have task notes with basic properties
    And no column configuration is set
    When I open the Gantt view
    Then I should see the default columns:
      | column    | header      |
      | text      | Task name   |
      | start     | Start date  |
      | duration  | Duration    |

  @critical @column-management @bases-integration
  Scenario: Display columns based on Bases property selection
    Given I have task notes with various properties:
      | title     | start      | due        | status     | priority |
      | Task A    | 2025-01-01 | 2025-01-05 | In Progress| High     |
      | Task B    | 2025-01-03 | 2025-01-08 | Planned    | Medium   |
    And I have selected these columns in Bases:
      | column   |
      | title    |
      | start    |
      | status   |
      | priority |
    When I open the Gantt view
    Then I should see columns for:
      | column   | header   |
      | title    | Title    |
      | start    | Start    |
      | status   | Status   |
      | priority | Priority |

  @column-management @data-types
  Scenario: Display different data types in columns
    Given I have a task note "Complex Task" with properties:
      | property    | value           | type    |
      | title       | Complex Task    | text    |
      | start       | 2025-01-01      | date    |
      | effort      | 40              | number  |
      | completed   | true            | boolean |
      | tags        | [work, urgent]  | array   |
      | link        | [[Related]]     | link    |
    And I have selected all these columns in Bases
    When I open the Gantt view
    Then the "title" column should display "Complex Task"
    And the "start" column should display "2025-01-01" formatted as a date
    And the "effort" column should display "40"
    And the "completed" column should display a checkmark
    And the "tags" column should display "work, urgent"
    And the "link" column should display "Related"

  @column-management @column-widths
  Scenario: Apply custom column widths from Bases configuration
    Given I have task notes with properties
    And I have configured column widths in Bases:
      | column | width |
      | title  | 300   |
      | start  | 120   |
      | status | 100   |
    When I open the Gantt view
    Then the "title" column should have width 300 pixels
    And the "start" column should have width 120 pixels
    And the "status" column should have width 100 pixels

  @column-management @column-ordering
  Scenario: Respect column order from Bases configuration
    Given I have task notes with properties
    And I have ordered columns in Bases as:
      | order | column   |
      | 1     | priority |
      | 2     | title    |
      | 3     | status   |
      | 4     | start    |
    When I open the Gantt view
    Then the columns should appear in this order:
      | position | column   |
      | 1        | priority |
      | 2        | title    |
      | 3        | status   |
      | 4        | start    |

  @column-management @file-basename
  Scenario: Use file basename as task name column
    Given I have task notes:
      | filename        | title property |
      | Project-A.md    | Different Name |
      | Task-B.md       |                |
    And Bases is configured to show "file.basename" column
    When I open the Gantt view
    Then the task name column should display "Project-A" for the first task
    And the task name column should display "Task-B" for the second task
    And the column header should reflect the Bases display name for "file.basename"

  @column-management @empty-columns
  Scenario: Hide grid when no columns are selected
    Given I have task notes with properties
    And no columns are selected in Bases configuration
    When I open the Gantt view
    Then the grid area should be hidden
    And only the timeline area should be visible
    And tasks should still be displayed in the timeline

  @column-management @column-formatting
  Scenario: Format column values according to data type
    Given I have a task note with properties:
      | property     | value                    |
      | start        | 2025-01-01T10:30:00Z     |
      | effort       | 42.5                     |
      | completed    | false                    |
      | tags         | []                       |
      | description  | null                     |
    When I open the Gantt view with these columns
    Then the "start" column should display the date in locale format
    And the "effort" column should display "42.5"
    And the "completed" column should display empty (no checkmark)
    And the "tags" column should display empty
    And the "description" column should display empty

  @column-management @dynamic-properties
  Scenario: Automatically detect available properties for column selection
    Given I have task notes with varying properties:
      | note   | title | start      | priority | assignee |
      | Task 1 | A     | 2025-01-01 | High     |          |
      | Task 2 | B     | 2025-01-02 |          | John     |
    When I access the Bases column configuration
    Then the available properties should include:
      | property |
      | title    |
      | start    |
      | priority |
      | assignee |
    And each property should have appropriate type detection
