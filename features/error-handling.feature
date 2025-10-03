Feature: Error Handling and Recovery
  As a user of the Gantt plugin
  I want clear error messages and graceful recovery from problems
  So that I can understand and resolve issues without losing my work

  Background:
    Given I have the Obsidian Gantt plugin enabled

  @critical @error-handling @configuration-errors
  Scenario: Display clear error for invalid Gantt configuration
    Given I have a Bases view with invalid obsidianGantt configuration:
      | setting              | value |
      | fieldMappings.id     |       |
      | fieldMappings.text   |       |
    When I try to open the Gantt view
    Then I should see a clear error message stating "Invalid obsidianGantt config"
    And the error should specify "fieldMappings.id and fieldMappings.text are required"
    And the Gantt should not attempt to render
    And I should be given guidance on how to fix the configuration

  @error-handling @data-loading @missing-data
  Scenario: Handle missing or corrupted data gracefully
    Given I have a Bases view that returns corrupted data
    When the Gantt view attempts to load
    Then the plugin should not crash
    And I should see an informative error message
    And the error should indicate the nature of the data problem
    And I should be able to retry loading after fixing the data

  @error-handling @plugin-dependencies @bases-unavailable
  Scenario: Handle missing Bases plugin gracefully
    Given the Bases plugin is not installed or disabled
    When the Obsidian Gantt plugin loads
    Then it should log a warning about Bases unavailability
    And it should not crash or throw errors
    And other plugin functionality should remain available
    And I should be informed about the missing dependency

  @error-handling @api-compatibility @version-mismatch
  Scenario: Handle Obsidian API version incompatibility
    Given the Obsidian API version is below the required minimum
    When the plugin attempts to use advanced features
    Then it should detect the version incompatibility
    And it should log a clear warning message
    And it should gracefully degrade functionality
    And I should be informed about the version requirement

  @error-handling @file-system @permission-errors
  Scenario: Handle file system permission errors
    Given I have read-only permissions on some note files
    When I attempt to edit a task that would modify a protected file
    Then I should receive a clear permission error message
    And the error should specify which file cannot be modified
    And the Gantt should remain functional for other tasks
    And I should be guided on how to resolve the permission issue

  @error-handling @memory-limits @resource-exhaustion
  Scenario: Handle memory or resource exhaustion gracefully
    Given I have an extremely large dataset that exceeds memory limits
    When the Gantt view attempts to load all data
    Then the plugin should detect the resource constraint
    And it should implement graceful degradation
    And I should be informed about the limitation
    And alternative approaches should be suggested

  @error-handling @network-issues @offline-operation
  Scenario: Maintain functionality during network issues
    Given I am working offline or have network connectivity issues
    When I use the Gantt plugin
    Then all functionality should work without network dependencies
    And no network-related errors should occur
    And the plugin should operate entirely from local data
    And performance should not be affected by network status

  @error-handling @data-corruption @recovery
  Scenario: Recover from data corruption
    Given some of my note files have corrupted frontmatter
    When the Gantt view processes the data
    Then corrupted entries should be skipped with warnings
    And valid entries should be processed normally
    And I should be informed about which files have issues
    And the Gantt should remain functional with available data

  @error-handling @concurrent-access @file-conflicts
  Scenario: Handle concurrent file access conflicts
    Given multiple processes are accessing the same note files
    When the Gantt plugin attempts to read or write data
    Then file access conflicts should be handled gracefully
    And appropriate retry mechanisms should be employed
    And I should be informed if conflicts cannot be resolved
    And data integrity should be maintained

  @error-handling @plugin-conflicts @compatibility
  Scenario: Handle conflicts with other plugins
    Given I have other plugins that might conflict with Gantt functionality
    When both plugins attempt to modify the same data
    Then conflicts should be detected and handled appropriately
    And I should be warned about potential compatibility issues
    And the Gantt plugin should attempt to work around conflicts
    And fallback behavior should be implemented where possible

  @error-handling @user-feedback @error-reporting
  Scenario: Provide helpful error reporting and feedback
    Given an unexpected error occurs in the Gantt plugin
    When the error is encountered
    Then a user-friendly error message should be displayed
    And technical details should be available for debugging
    And the error should be logged appropriately
    And I should be given options for reporting or resolving the issue

  @error-handling @graceful-degradation @partial-functionality
  Scenario: Maintain partial functionality when components fail
    Given a non-critical component of the Gantt plugin fails
    When I continue to use the plugin
    Then core functionality should remain available
    And I should be informed about the reduced functionality
    And the plugin should not become completely unusable
    And recovery should be possible without restarting Obsidian

  @error-handling @validation @input-validation
  Scenario: Validate user input and provide helpful feedback
    Given I am editing task properties in the Gantt
    When I enter invalid data (like text in a date field)
    Then the input should be validated before processing
    And I should receive immediate feedback about the invalid input
    And the error message should explain what input is expected
    And I should be prevented from saving invalid data

  @error-handling @recovery @automatic-recovery
  Scenario: Automatically recover from transient errors
    Given a transient error occurs (like temporary file lock)
    When the Gantt plugin encounters the error
    Then it should attempt automatic recovery with retries
    And the retry attempts should use exponential backoff
    And I should be informed if automatic recovery fails
    And manual recovery options should be provided

  @error-handling @debugging @development-support
  Scenario: Provide debugging support for development and troubleshooting
    Given I am experiencing issues with the Gantt plugin
    When I enable debug mode or verbose logging
    Then detailed diagnostic information should be available
    And the information should help identify the root cause
    And debug data should be formatted for easy analysis
    And sensitive information should be excluded from logs
