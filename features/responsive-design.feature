Feature: Responsive Design and Mobile Support
  As a user accessing Obsidian on various devices
  I want the Gantt chart to work well on different screen sizes
  So that I can manage my projects effectively regardless of the device I'm using

  Background:
    Given I have a vault with task notes
    And the Obsidian Gantt plugin is enabled
    And I have task data loaded in the Gantt view

  @responsive-design @mobile @touch-interaction
  Scenario: Support touch interactions on mobile devices
    Given I am using a mobile device with touch input
    And I have the Gantt view open
    When I tap on a task bar
    Then the task should be selected
    And touch feedback should be provided
    And the interaction should feel responsive

  @responsive-design @mobile @touch-interaction
  Scenario: Support touch scrolling in timeline area
    Given I am using a mobile device
    And I have a Gantt chart with a wide timeline
    When I perform a horizontal swipe gesture on the timeline
    Then the timeline should scroll horizontally
    And the scrolling should be smooth and responsive
    And momentum scrolling should be supported

  @responsive-design @mobile @touch-interaction
  Scenario: Support pinch-to-zoom for timeline scale
    Given I am using a mobile device with multi-touch support
    And I have the Gantt view open
    When I perform a pinch gesture on the timeline
    Then the timeline scale should zoom in or out
    And the zoom should be centered on the pinch point
    And the zoom level should be constrained to reasonable limits

  @responsive-design @layout @small-screens
  Scenario: Adapt layout for small screen sizes
    Given I am using a device with a small screen (width < 768px)
    When I open the Gantt view
    Then the column widths should be optimized for the screen size
    And non-essential columns should be hidden or collapsed
    And the timeline should remain usable
    And horizontal scrolling should be available when needed

  @responsive-design @layout @tablet-screens
  Scenario: Optimize layout for tablet screens
    Given I am using a tablet device (width 768px - 1024px)
    When I open the Gantt view
    Then the layout should use the available space efficiently
    And both grid and timeline areas should be visible
    And column widths should be appropriate for the screen size
    And touch targets should be sized appropriately

  @responsive-design @layout @desktop-screens
  Scenario: Provide full functionality on desktop screens
    Given I am using a desktop device (width > 1024px)
    When I open the Gantt view
    Then all columns should be displayed with optimal widths
    And the timeline should show an appropriate time range
    And all interactive features should be available
    And the layout should make full use of the available space

  @responsive-design @columns @adaptive-columns
  Scenario: Adapt column visibility based on screen width
    Given I have a Gantt view with multiple columns configured
    When I view the Gantt on different screen sizes
    Then on mobile devices, only essential columns should be shown
    And on tablet devices, important columns should be visible
    And on desktop devices, all configured columns should be displayed
    And column priority should determine visibility order

  @responsive-design @timeline @scale-adaptation
  Scenario: Adapt timeline scale for different screen sizes
    Given I have a Gantt chart with tasks spanning several months
    When I view the chart on different devices
    Then on mobile devices, the timeline should show a focused time range
    And on tablet devices, the timeline should show a moderate time range
    And on desktop devices, the timeline should show a comprehensive view
    And users should be able to navigate to see all time periods

  @responsive-design @navigation @mobile-navigation
  Scenario: Provide mobile-friendly navigation controls
    Given I am using a mobile device
    And I have a large Gantt chart
    When I need to navigate through the chart
    Then I should have access to navigation controls optimized for touch
    And I should be able to quickly jump to specific time periods
    And I should be able to zoom to fit all tasks
    And navigation should not interfere with task interactions

  @responsive-design @performance @mobile-performance
  Scenario: Maintain performance on mobile devices
    Given I am using a mobile device with limited processing power
    And I have a Gantt chart with 100+ tasks
    When I interact with the chart
    Then scrolling should remain smooth
    And task selection should be responsive
    And the chart should render without significant delays
    And memory usage should be optimized for mobile constraints

  @responsive-design @orientation @orientation-changes
  Scenario: Handle device orientation changes gracefully
    Given I am using a mobile device
    And I have the Gantt view open in portrait mode
    When I rotate the device to landscape mode
    Then the Gantt layout should adapt to the new orientation
    And the timeline should take advantage of the increased width
    And column layout should adjust appropriately
    And the current view state should be preserved

  @responsive-design @accessibility @touch-targets
  Scenario: Ensure touch targets meet accessibility guidelines
    Given I am using a touch device
    When I interact with Gantt elements
    Then all interactive elements should have minimum touch target size of 44px
    And touch targets should have adequate spacing between them
    And accidental touches should be minimized
    And the interface should be usable with various finger sizes

  @responsive-design @text @text-scaling
  Scenario: Support system text scaling preferences
    Given I have system text scaling set to a larger size
    When I open the Gantt view
    Then text in the Gantt should scale appropriately
    And the layout should accommodate larger text
    And readability should be maintained
    And the interface should remain functional

  @responsive-design @dark-mode @theme-adaptation
  Scenario: Adapt to system dark mode preferences
    Given I have dark mode enabled in my system or Obsidian
    When I open the Gantt view
    Then the Gantt colors should adapt to the dark theme
    And text should remain readable against dark backgrounds
    And task bars should have appropriate contrast
    And the overall appearance should be consistent with Obsidian's dark theme
