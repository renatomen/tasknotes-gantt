# @assertthat-feature-id: Task Editing and Interaction
Feature: Task Editing and Interaction

    @AUTOMATED @critical @task-selection @task-editing @imported-from-github
    # @assertthat-scenario-id: 82f2f0b6c28783d0b1cae69bd11d1c31
    Scenario: Select tasks by clicking on task bars
        Given I have multiple tasks displayed in the Gantt chart
        When I click on a task bar for "Project Planning"
        Then the task "Project Planning" should be visually selected
        And the selection should be highlighted
        And any previously selected task should be deselected
        And task selection events should be triggered

    @AUTOMATED @critical @task-editing @double-click-editing @imported-from-github
    # @assertthat-scenario-id: 39eaa95468aed69f486c696183536a2d
    Scenario: Open task editor by double-clicking task bar
        Given I have a task "Development Phase" displayed in the Gantt
        When I double-click on the task bar for "Development Phase"
        Then a task editor should open
        And the editor should display the current task properties
        And I should be able to modify task details
        And the editor should be focused and ready for input

    @AUTOMATED @property-editing @basic-properties @task-editing @imported-from-github
    # @assertthat-scenario-id: 5f74a24f77bcb129bf40f35eac1cc9b5
    Scenario: Edit basic task properties
        Given I have a task editor open for "Research Task"
        When I change the task title to "Updated Research Task"
        And I change the start date to "2025-01-15"
        And I change the end date to "2025-01-20"
        And I save the changes
        Then the task should be updated in the Gantt chart
        And the task bar should reflect the new dates
        And the task title should be updated in the grid

    @AUTOMATED @progress-editing @task-editing @imported-from-github
    # @assertthat-scenario-id: 288be578f696e48a47b9d5965df03004
    Scenario: Edit task progress
        Given I have a task editor open for "Development"
        When I set the progress to 75%
        And I save the changes
        Then the task bar should show 75% completion
        And the progress should be visually indicated
        And the underlying note should be updated with the new progress

    @AUTOMATED @drag-resize @date-editing @task-editing @imported-from-github
    # @assertthat-scenario-id: cc84156fd8d6b5f0a917b316f26ed4a5
    Scenario: Resize task duration by dragging task bar edges
        Given I have a task "Planning" with duration from "2025-01-01" to "2025-01-05"
        When I drag the right edge of the task bar to "2025-01-10"
        Then the task duration should be extended to "2025-01-10"
        And the task bar should visually reflect the new duration
        And the underlying note should be updated with the new end date
        And the change should be saved automatically

    @AUTOMATED @date-editing @task-editing @drag-move @imported-from-github
    # @assertthat-scenario-id: 418160f7f622c7dc220fd57a5492b08a
    Scenario: Move task by dragging the entire task bar
        Given I have a task "Implementation" scheduled from "2025-01-05" to "2025-01-10"
        When I drag the entire task bar to start on "2025-01-08"
        Then the task should be rescheduled to "2025-01-08" to "2025-01-13"
        And the task duration should remain the same
        And the underlying note should be updated with the new dates
        And the change should be saved automatically

    @AUTOMATED @keyboard-interaction @task-editing @imported-from-github
    # @assertthat-scenario-id: 1164259ebf0a34c9187fd09e0a54d92c
    Scenario: Navigate and edit tasks using keyboard
        Given I have multiple tasks in the Gantt view
        When I use arrow keys to navigate between tasks
        Then the selection should move to the next/previous task
        And the selected task should be visually highlighted
        When I press Enter on a selected task
        Then the task editor should open for that task
        And I should be able to edit using keyboard input

    @AUTOMATED @multi-selection @bulk-editing @task-editing @imported-from-github
    # @assertthat-scenario-id: d4a36fbb58ab38b7304a539c89b58e01
    Scenario: Select and edit multiple tasks
        Given I have multiple tasks in the Gantt view
        When I select multiple tasks using Ctrl+click
        Then all selected tasks should be highlighted
        When I perform a bulk operation (like changing status)
        Then all selected tasks should be updated
        And the changes should be applied to all underlying notes
        And the Gantt should reflect all changes

    @AUTOMATED @date-validation @validation @task-editing @imported-from-github
    # @assertthat-scenario-id: 7952eaf4c3a21263b08bc1bffe362b85
    Scenario: Validate task edits before saving
        Given I have a task editor open
        When I set an invalid end date that is before the start date
        And I attempt to save the changes
        Then I should see a validation error message
        And the save operation should be prevented
        And I should be guided to fix the validation error
        And the original task data should remain unchanged

    @AUTOMATED @undo-redo @task-editing @imported-from-github
    # @assertthat-scenario-id: a052ee43acd8bc3305346f48869a3d27
    Scenario: Undo and redo task edits
        Given I have made changes to a task "Planning"
        When I trigger an undo operation
        Then the task should revert to its previous state
        And the Gantt should reflect the reverted changes
        When I trigger a redo operation
        Then the task should return to the edited state
        And the change history should be maintained

    @AUTOMATED @real-time-sync @collaborative-editing @task-editing @imported-from-github
    # @assertthat-scenario-id: a4b7e13c80ada3806cf8db4d3cc84086
    Scenario: Handle concurrent edits to the same task
        Given I have a task open for editing
        And the underlying note is modified externally
        When I attempt to save my changes
        Then I should be notified of the conflict
        And I should be given options to resolve the conflict
        And data integrity should be maintained
        And no changes should be lost

    @AUTOMATED @multi-parent-editing @task-editing @virtual-tasks @imported-from-github
    # @assertthat-scenario-id: acd97954b8befd7a26006595f2827d0d
    Scenario: Edit virtual tasks with multiple parents
        Given I have a task "Shared Resource" that appears under multiple parents
        When I edit the task from one parent context
        Then the changes should apply to all virtual instances
        And all instances should reflect the updated information
        And the underlying note should be updated once
        And the synchronization should be immediate

    @AUTOMATED @custom-properties @task-editing @imported-from-github
    # @assertthat-scenario-id: 4646ee49dc19071622822491b97b9440
    Scenario: Edit custom task properties
        Given I have a task with custom properties like "priority" and "assignee"
        When I open the task editor
        Then I should see all custom properties available for editing
        When I modify custom properties
        And I save the changes
        Then the custom properties should be updated in the underlying note
        And the Gantt columns should reflect the changes if displayed

    @AUTOMATED @save-failures @task-editing @error-handling @imported-from-github
    # @assertthat-scenario-id: 67a0f7fb18ccf106246d1859fa99fcd3
    Scenario: Handle save failures gracefully
        Given I have made changes to a task
        When a save operation fails due to file system issues
        Then I should be notified of the failure
        And my changes should be preserved in the editor
        And I should be given options to retry or save elsewhere
        And the Gantt should not show unsaved changes as committed

    @AUTOMATED @screen-reader @task-editing @accessibility @imported-from-github
    # @assertthat-scenario-id: 6243ec7c2a3d8ecf78a5ba999f23572f
    Scenario: Support screen reader accessibility for task editing
        Given I am using a screen reader
        When I navigate to a task in the Gantt
        Then the task information should be announced clearly
        When I activate task editing
        Then the editor should be accessible via screen reader
        And all form fields should have appropriate labels
        And the editing workflow should be navigable without a mouse
