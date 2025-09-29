Feature: BDD Framework Validation
  As a developer
  I want to validate that the BDD framework is working correctly
  So that I can write executable specifications for the Obsidian Gantt plugin

  Background:
    Given a Gantt chart is initialized

  Scenario: Basic task creation and rendering
    Given a task with title "Sample Task"
    When I add the task to the chart
    And the Gantt chart is rendered
    Then the task should be visible
    And the chart should display 1 task
    And the task should have title "Sample Task"

  Scenario: Multiple tasks rendering
    Given a task with title "First Task"
    When I add the task to the chart
    Given a task with title "Second Task"
    When I add the task to the chart
    And the Gantt chart is rendered
    Then the chart should display 2 tasks
