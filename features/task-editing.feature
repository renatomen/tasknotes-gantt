Feature: Task Editing and Interaction
  As a project manager
  I want to interact with tasks directly in the Gantt chart
  So that I can quickly update project information without leaving the visual context

  Background:
    Given I have a vault with task notes
    And the Obsidian Gantt plugin is enabled
    And I have task data loaded in the Gantt view

  @critical @task-editing @task-selection
  Scenario: Select tasks by clicking on task bars
    Given I have multiple tasks displayed in the Gantt chart
    When I click on a task bar for "Project Planning"
    Then the task "Project Planning" should be visually selected
    And the selection should be highlighted
    And any previously selected task should be deselected
    And task selection events should be triggered

  @critical @task-editing @double-click-editing
  Scenario: Open task editor by double-clicking task bar
    Given I have a task "Development Phase" displayed in the Gantt
    When I double-click on the task bar for "Development Phase"
    Then a task editor should open
    And the editor should display the current task properties
    And I should be able to modify task details
    And the editor should be focused and ready for input

  @task-editing @property-editing @basic-properties
  Scenario: Edit basic task properties
    Given I have a task editor open for "Research Task"
    When I change the task title to "Updated Research Task"
    And I change the start date to "2025-01-15"
    And I change the end date to "2025-01-20"
    And I save the changes
    Then the task should be updated in the Gantt chart
    And the task bar should reflect the new dates
    And the task title should be updated in the grid

  @task-editing @progress-editing
  Scenario: Edit task progress
    Given I have a task editor open for "Development"
    When I set the progress to 75%
    And I save the changes
    Then the task bar should show 75% completion
    And the progress should be visually indicated
    And the underlying note should be updated with the new progress

  @task-editing @date-editing @drag-resize
  Scenario: Resize task duration by dragging task bar edges
    Given I have a task "Planning" with duration from "2025-01-01" to "2025-01-05"
    When I drag the right edge of the task bar to "2025-01-10"
    Then the task duration should be extended to "2025-01-10"
    And the task bar should visually reflect the new duration
    And the underlying note should be updated with the new end date
    And the change should be saved automatically

  @task-editing @date-editing @drag-move
  Scenario: Move task by dragging the entire task bar
    Given I have a task "Implementation" scheduled from "2025-01-05" to "2025-01-10"
    When I drag the entire task bar to start on "2025-01-08"
    Then the task should be rescheduled to "2025-01-08" to "2025-01-13"
    And the task duration should remain the same
    And the underlying note should be updated with the new dates
    And the change should be saved automatically

  @task-editing @keyboard-interaction
  Scenario: Navigate and edit tasks using keyboard
    Given I have multiple tasks in the Gantt view
    When I use arrow keys to navigate between tasks
    Then the selection should move to the next/previous task
    And the selected task should be visually highlighted
    When I press Enter on a selected task
    Then the task editor should open for that task
    And I should be able to edit using keyboard input

  @task-editing @bulk-editing @multi-selection
  Scenario: Select and edit multiple tasks
    Given I have multiple tasks in the Gantt view
    When I select multiple tasks using Ctrl+click
    Then all selected tasks should be highlighted
    When I perform a bulk operation (like changing status)
    Then all selected tasks should be updated
    And the changes should be applied to all underlying notes
    And the Gantt should reflect all changes

  @task-editing @validation @date-validation
  Scenario: Validate task edits before saving
    Given I have a task editor open
    When I set an invalid end date that is before the start date
    And I attempt to save the changes
    Then I should see a validation error message
    And the save operation should be prevented
    And I should be guided to fix the validation error
    And the original task data should remain unchanged

  @task-editing @undo-redo
  Scenario: Undo and redo task edits
    Given I have made changes to a task "Planning"
    When I trigger an undo operation
    Then the task should revert to its previous state
    And the Gantt should reflect the reverted changes
    When I trigger a redo operation
    Then the task should return to the edited state
    And the change history should be maintained

  @task-editing @real-time-sync @collaborative-editing
  Scenario: Handle concurrent edits to the same task
    Given I have a task open for editing
    And the underlying note is modified externally
    When I attempt to save my changes
    Then I should be notified of the conflict
    And I should be given options to resolve the conflict
    And data integrity should be maintained
    And no changes should be lost

  @task-editing @virtual-tasks @multi-parent-editing
  Scenario: Edit virtual tasks with multiple parents
    Given I have a task "Shared Resource" that appears under multiple parents
    When I edit the task from one parent context
    Then the changes should apply to all virtual instances
    And all instances should reflect the updated information
    And the underlying note should be updated once
    And the synchronization should be immediate

  @task-editing @custom-properties
  Scenario: Edit custom task properties
    Given I have a task with custom properties like "priority" and "assignee"
    When I open the task editor
    Then I should see all custom properties available for editing
    When I modify custom properties
    And I save the changes
    Then the custom properties should be updated in the underlying note
    And the Gantt columns should reflect the changes if displayed

  @task-editing @error-handling @save-failures
  Scenario: Handle save failures gracefully
    Given I have made changes to a task
    When a save operation fails due to file system issues
    Then I should be notified of the failure
    And my changes should be preserved in the editor
    And I should be given options to retry or save elsewhere
    And the Gantt should not show unsaved changes as committed

  @task-editing @accessibility @screen-reader
  Scenario: Support screen reader accessibility for task editing
    Given I am using a screen reader
    When I navigate to a task in the Gantt
    Then the task information should be announced clearly
    When I activate task editing
    Then the editor should be accessible via screen reader
    And all form fields should have appropriate labels
    And the editing workflow should be navigable without a mouse
