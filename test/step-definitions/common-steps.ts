/**
 * OG-19: Common BDD Step Definitions
 *
 * Shared step definitions that can be used across multiple features
 * Following Given-When-Then structure
 */

import { Given, When, Then } from "@cucumber/cucumber";

// Common Given steps
Given("a task with title {string}", function (title: string) {
  this.currentTask = {
    title,
    id: `task-${Date.now()}`,
    startDate: new Date(),
    endDate: new Date(Date.now() + 24 * 60 * 60 * 1000), // 1 day later
  };
});

Given("a Gantt chart is initialized", function () {
  this.ganttChart = {
    tasks: [],
    links: [],
    scales: [],
  };
});

// Common When steps
When("the Gantt chart is rendered", function () {
  // Mock rendering logic
  this.renderResult = {
    success: true,
    tasksRendered: this.ganttChart?.tasks?.length || 0,
  };
});

When("I add the task to the chart", function () {
  if (!this.ganttChart) {
    throw new Error("Gantt chart not initialized");
  }

  if (!this.currentTask) {
    throw new Error("No current task to add");
  }

  this.ganttChart.tasks.push(this.currentTask);
});

// Common Then steps
Then("the task should be visible", function () {
  if (!this.renderResult?.success) {
    throw new Error("Gantt chart rendering failed");
  }

  // In a real implementation, this would check the DOM or component state
  // For now, we'll just verify the task exists in our mock data
  const taskExists = this.ganttChart?.tasks?.some(
    (task: { title: string }) => task.title === this.currentTask?.title
  );

  if (!taskExists) {
    throw new Error(
      `Task "${this.currentTask?.title}" is not visible in the chart`
    );
  }
});

Then(
  "the chart should display {int} task(s)",
  function (expectedCount: number) {
    const actualCount = this.ganttChart?.tasks?.length || 0;

    if (actualCount !== expectedCount) {
      throw new Error(
        `Expected ${expectedCount} tasks, but found ${actualCount}`
      );
    }
  }
);

Then("the task should have title {string}", function (expectedTitle: string) {
  if (!this.currentTask) {
    throw new Error("No current task to verify");
  }

  if (this.currentTask.title !== expectedTitle) {
    throw new Error(
      `Expected task title "${expectedTitle}", but got "${this.currentTask.title}"`
    );
  }
});
