# @assertthat-feature-id: BDD Framework Validation
Feature: BDD Framework Validation
  As a developer
  I want to validate that the BDD framework is working correctly
  So that I can write executable specifications for the Obsidian Gantt plugin

  Background:
    Given a Gantt chart is initialized

    # @assertthat-scenario-id: 0e35e68f664b0a2aec4cd33289a19889
  Scenario: Basic task creation and rendering
    Given a task with title "Sample Task"
    When I add the task to the chart
    And the Gantt chart is rendered
    Then the task should be visible
    And the chart should display 1 task
    And the task should have title "Sample Task"

    # @assertthat-scenario-id: b4fec64791865708204844c196194258
  Scenario: Multiple tasks rendering
    Given a task with title "First Task"
    When I add the task to the chart
    Given a task with title "Second Task"
    When I add the task to the chart
    And the Gantt chart is rendered
    Then the chart should display 2 tasks
