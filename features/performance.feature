Feature: Performance and Scalability
  As a project manager working with large datasets
  I want the Gantt chart to perform well with hundreds or thousands of tasks
  So that I can manage complex projects without performance degradation

  Background:
    Given I have the Obsidian Gantt plugin enabled
    And I have Bases integration configured

  @critical @performance @large-datasets
  Scenario: Render 1000+ tasks efficiently
    Given I have 1000 task notes with complete properties
    When I open the Gantt view
    Then the initial render should complete within 2 seconds
    And scrolling should remain smooth
    And memory usage should be reasonable
    And the interface should remain responsive

  @performance @virtual-scrolling
  Scenario: Use virtual scrolling for large task lists
    Given I have 5000 tasks in the Gantt view
    When I scroll through the task list
    Then only visible tasks should be rendered in the DOM
    And scrolling should be smooth without lag
    And memory usage should remain constant regardless of total task count
    And the scroll position should be accurately maintained

  @performance @data-loading @incremental-loading
  Scenario: Load large datasets incrementally
    Given I have a Bases view with 2000+ notes
    When I open the Gantt view
    Then the initial batch of tasks should load quickly
    And additional tasks should load as needed
    And the user should see a loading indicator for subsequent batches
    And the interface should remain usable during loading

  @performance @svelte-reactivity @efficient-updates
  Scenario: Update tasks efficiently using Svelte reactivity
    Given I have 500 tasks loaded in the Gantt view
    When I update a single task's properties
    Then only the affected task should re-render
    And other tasks should remain unchanged
    And the update should complete within 100ms
    And the Svelte reactivity system should minimize DOM operations

  @performance @memory-management @cleanup
  Scenario: Manage memory efficiently with proper cleanup
    Given I have multiple Gantt views open with large datasets
    When I close a Gantt view
    Then all associated Svelte components should be destroyed
    And event listeners should be removed
    And memory should be freed appropriately
    And there should be no memory leaks

  @performance @column-rendering @dynamic-columns
  Scenario: Render dynamic columns efficiently
    Given I have 1000 tasks with 20 different properties each
    And I have 10 columns configured for display
    When the Gantt view renders
    Then column data should be computed efficiently
    And only visible columns should be processed
    And column formatters should be optimized
    And the rendering should complete within reasonable time

  @performance @virtual-tasks @multi-parent-efficiency
  Scenario: Handle virtual task duplicates efficiently
    Given I have 200 tasks where 50% have multiple parents
    And the average task has 3 parents
    When virtual duplicates are created
    Then the expansion should complete quickly
    And memory usage should scale linearly with virtual task count
    And rendering performance should not degrade significantly
    And virtual task management should be optimized

  @performance @date-processing @bulk-operations
  Scenario: Process date transformations efficiently in bulk
    Given I have 1500 tasks with various date formats
    When the data is transformed to SVAR format
    Then date parsing should be optimized for bulk operations
    And the transformation should complete within 1 second
    And memory allocation should be minimized
    And the process should handle edge cases without performance impact

  @performance @timeline-rendering @zoom-levels
  Scenario: Maintain performance across different timeline zoom levels
    Given I have 800 tasks spanning 2 years
    When I change the timeline zoom level
    Then the zoom operation should complete within 500ms
    And task positioning should be recalculated efficiently
    And the timeline should remain responsive
    And memory usage should not increase significantly

  @performance @search-filtering @real-time-filtering
  Scenario: Filter large datasets in real-time
    Given I have 2000 tasks loaded in the Gantt view
    When I apply a filter to show only high-priority tasks
    Then the filtering should complete within 200ms
    And the view should update smoothly
    And filtered tasks should be hidden efficiently
    And the filter should work with virtual scrolling

  @performance @concurrent-operations @multi-instance
  Scenario: Handle multiple Gantt instances efficiently
    Given I have 3 different Gantt views open simultaneously
    And each view has 300+ tasks
    When I interact with any of the views
    Then each instance should maintain independent performance
    And operations in one view should not affect others
    And memory usage should scale appropriately
    And CPU usage should remain reasonable

  @performance @data-updates @incremental-updates
  Scenario: Handle data updates efficiently
    Given I have 1000 tasks loaded in the Gantt view
    When the underlying Bases data changes for 10 tasks
    Then only the changed tasks should be reprocessed
    And the update should complete within 300ms
    And unchanged tasks should not be re-rendered
    And the Svelte reactivity should optimize the update process

  @performance @initialization @cold-start
  Scenario: Optimize initial plugin loading time
    Given the Obsidian Gantt plugin is not yet loaded
    When Obsidian starts up
    Then the plugin should initialize within 1 second
    And Bases registration should complete quickly
    And the plugin should not block Obsidian startup
    And subsequent Gantt view creation should be fast

  @performance @mobile-optimization @resource-constraints
  Scenario: Optimize performance for mobile devices
    Given I am using a mobile device with limited resources
    And I have 500 tasks in the Gantt view
    When I interact with the chart
    Then rendering should be optimized for mobile GPUs
    And touch interactions should remain responsive
    And battery usage should be minimized
    And the interface should adapt to performance constraints

  @performance @caching @intelligent-caching
  Scenario: Use intelligent caching for computed data
    Given I have complex task hierarchies and dependencies
    When I navigate between different views of the same data
    Then computed values should be cached appropriately
    And cache invalidation should be precise
    And repeated calculations should be avoided
    And memory usage for caching should be reasonable

  @performance @error-recovery @graceful-degradation
  Scenario: Maintain performance during error conditions
    Given I have a large dataset with some corrupted entries
    When the Gantt view processes the data
    Then error handling should not impact overall performance
    And valid tasks should render normally
    And the system should recover gracefully from errors
    And performance should not degrade due to error processing
