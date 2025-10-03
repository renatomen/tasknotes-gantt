Feature: Bases View Registration and Integration
  As an Obsidian user with the Bases plugin
  I want the Gantt plugin to integrate seamlessly with Bases views
  So that I can visualize my structured data as Gantt charts directly within Bases

  Background:
    Given I have Obsidian with the Bases plugin installed
    And the Obsidian Gantt plugin is installed and enabled

  @critical @bases-integration @plugin-loading
  Scenario: Register Gantt view type with Bases on plugin load
    Given the Obsidian API version is 1.9.12 or higher
    When the Obsidian Gantt plugin loads
    Then it should register a custom view type "obsidianGantt" with Bases
    And the view should be named "Gantt (OG)"
    And the view should have a calendar-gantt icon
    And the registration should complete successfully

  @bases-integration @plugin-loading @api-version-check
  Scenario: Handle insufficient Obsidian API version gracefully
    Given the Obsidian API version is below 1.9.12
    When the Obsidian Gantt plugin loads
    Then it should log a warning about insufficient API version
    And it should not attempt to register with Bases
    And the plugin should continue loading without errors

  @bases-integration @plugin-loading @bases-unavailable
  Scenario: Handle missing Bases plugin gracefully
    Given the Bases plugin is not installed or enabled
    When the Obsidian Gantt plugin loads
    Then it should attempt to find the Bases plugin with retries
    And after 5 retry attempts, it should log a warning about Bases unavailability
    And it should return a no-op unregister function
    And the plugin should continue functioning for other features

  @bases-integration @view-factory @container-creation
  Scenario: Create Gantt view from Bases container
    Given I have a Bases view configured with data
    And the Obsidian Gantt plugin is registered with Bases
    When Bases creates a Gantt view instance
    Then it should receive a BasesContainerLike object
    And it should return a BasesViewLike object with required methods
    And the view should have load, refresh, and onDataUpdated capabilities

  @bases-integration @view-lifecycle @mounting
  Scenario: Mount Svelte Gantt component in Bases container
    Given I have a Bases view with task data
    When the Gantt view is loaded
    Then it should mount a Svelte GanttContainer component
    And the component should be attached to the Bases viewContainerEl
    And the component should receive task data as props
    And the component should render the SVAR Gantt chart

  @bases-integration @view-lifecycle @unmounting
  Scenario: Clean up Gantt view when Bases view is destroyed
    Given I have a Gantt view loaded in Bases
    When the Bases view is closed or destroyed
    Then the Gantt view should call its unmount function
    And the Svelte component should be properly destroyed
    And all event listeners should be removed
    And memory should be freed appropriately

  @bases-integration @data-flow @query-integration
  Scenario: Integrate with Bases query system
    Given I have a Bases view with a configured query
    And the query returns note data
    When the Gantt view loads
    Then it should access the query results through container.results
    And it should transform the Bases data to SVAR format
    And it should render the transformed data in the Gantt chart

  @bases-integration @configuration @view-config
  Scenario: Read Gantt configuration from Bases view settings
    Given I have a Bases view with obsidianGantt configuration:
      | setting              | value    |
      | fieldMappings.id     | path     |
      | fieldMappings.text   | title    |
      | fieldMappings.start  | start    |
      | fieldMappings.end    | due      |
      | viewMode             | Week     |
      | defaultDuration      | 3        |
    When the Gantt view loads
    Then it should read the configuration from the Bases container
    And it should apply the field mappings to the data transformation
    And it should use the specified view mode and duration settings

  @bases-integration @error-handling @configuration-errors
  Scenario: Handle invalid Gantt configuration gracefully
    Given I have a Bases view with invalid obsidianGantt configuration:
      | setting              | value |
      | fieldMappings.id     |       |
      | fieldMappings.text   |       |
    When the Gantt view attempts to load
    Then it should validate the configuration
    And it should display an error message about missing required fields
    And it should not crash or break the Bases view
    And it should provide guidance on fixing the configuration

  @bases-integration @data-updates @reactive-updates
  Scenario: Respond to Bases data updates
    Given I have a Gantt view loaded with initial data
    When the underlying Bases data changes
    And the container.query triggers a data update event
    Then the Gantt view should receive the onDataUpdated callback
    And it should recompute the task data
    And it should update the Gantt display with new data
    And the update should happen without full page reload

  @bases-integration @debug-support @e2e-integration
  Scenario: Support debugging and E2E testing
    Given I have a Gantt view loaded in Bases
    And E2E testing is configured with debug collection
    When the view processes data
    Then it should capture debug information including:
      | debug_data           |
      | properties keys      |
      | view configuration   |
      | results size         |
      | results entries      |
      | raw items            |
    And the debug data should be available for E2E test inspection

  @bases-integration @plugin-unload @cleanup
  Scenario: Clean up Bases registration on plugin unload
    Given the Obsidian Gantt plugin is loaded and registered with Bases
    When the plugin is unloaded or disabled
    Then it should call the unregister function
    And it should remove the "obsidianGantt" view type from Bases
    And it should clean up any remaining view instances
    And Bases should no longer offer Gantt as a view option
