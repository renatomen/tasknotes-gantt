/**
 * OG-87: PropertyMappingService Unit Tests
 *
 * Tests for transforming BasesEntry[] to SVARTask[] using field mappings
 * Following TDD principles - tests written before implementation
 */

import { describe, it, expect, beforeEach } from "@jest/globals";
import { PropertyMappingService } from "../../src/bases/services/PropertyMappingService";
import type { FieldMappings, SVARTask } from "../../src/bases/types/field-mapping";
import type { BasesEntry } from "../../src/bases/register";

describe("PropertyMappingService", () => {
  let service: PropertyMappingService;
  let fieldMappings: FieldMappings;

  beforeEach(() => {
    service = new PropertyMappingService();
    fieldMappings = {
      textProperty: "note:title",
      startProperty: "note:start",
      endProperty: "note:due",
      progressProperty: "note:progress",
    };
  });

  describe("transformEntries", () => {
    it("should transform BasesEntry with all fields to SVARTask", () => {
      // Arrange - Using correct Bases Value object structure
      const mockEntry: BasesEntry = {
        file: { path: "tasks/project-a.md", name: "project-a.md", basename: "project-a" },
        getValue: (propertyId: string) => {
          const values: Record<string, any> = {
            "note:title": { data: "Project A Task" },
            "note:start": { date: new Date("2024-01-15") },
            "note:due": { date: new Date("2024-01-20") },
            "note:progress": { data: 50 },
          };
          return values[propertyId] || null;
        },
      };

      // Act
      const result = service.transformEntries([mockEntry], fieldMappings);

      // Assert
      expect(result.tasks).toHaveLength(1);
      expect(result.errors).toHaveLength(0);

      const task = result.tasks[0];
      expect(task.id).toBe("tasks/project-a.md");
      expect(task.text).toBe("Project A Task");
      expect(task.start).toBeInstanceOf(Date);
      expect(task.end).toBeInstanceOf(Date);
      expect(task.progress).toBe(50);
      expect(task.custom?.obsidianPath).toBe("tasks/project-a.md");
      expect(task.custom?.isUnscheduled).toBe(false);
    });

    it("should use file.basename when textProperty is empty string", () => {
      // Arrange
      const mappings: FieldMappings = {
        textProperty: "",
        startProperty: "note:start",
        endProperty: "note:due",
        progressProperty: "note:progress",
      };

      const mockEntry: BasesEntry = {
        file: { path: "notes/meeting.md", name: "meeting.md", basename: "meeting" },
        getValue: (propertyId: string) => ({
          date: new Date("2024-02-01"),
        }),
      };

      // Act
      const result = service.transformEntries([mockEntry], mappings);

      // Assert
      expect(result.tasks).toHaveLength(1);
      expect(result.tasks[0].text).toBe("meeting");
    });

    it("should create unscheduled task (red bar at today) when dates are missing", () => {
      // Arrange
      const mockEntry: BasesEntry = {
        file: { path: "backlog/feature-x.md", name: "feature-x.md", basename: "feature-x" },
        getValue: (propertyId: string) => null,
      };

      // Mock today's date
      const today = new Date();
      const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0, 0);
      const endOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);

      // Act
      const result = service.transformEntries([mockEntry], fieldMappings);

      // Assert
      expect(result.tasks).toHaveLength(1);
      expect(result.errors).toHaveLength(0);

      const task = result.tasks[0];
      expect(task.id).toBe("backlog/feature-x.md");
      expect(task.text).toBe("feature-x");
      expect(task.start.getTime()).toBeGreaterThanOrEqual(startOfToday.getTime());
      expect(task.start.getTime()).toBeLessThanOrEqual(startOfToday.getTime() + 1000); // Allow 1s tolerance
      expect(task.end.getTime()).toBeGreaterThanOrEqual(endOfToday.getTime() - 1000); // Allow 1s tolerance
      expect(task.end.getTime()).toBeLessThanOrEqual(endOfToday.getTime());
      expect(task.custom?.isUnscheduled).toBe(true);
    });

    it("should create unscheduled task when only start date is missing", () => {
      // Arrange
      const mockEntry: BasesEntry = {
        file: { path: "tasks/task-b.md", name: "task-b.md", basename: "task-b" },
        getValue: (propertyId: string) => {
          const values: Record<string, any> = {
            "note:due": { date: new Date("2024-03-01") },
          };
          return values[propertyId] || null;
        },
      };

      // Act
      const result = service.transformEntries([mockEntry], fieldMappings);

      // Assert
      expect(result.tasks).toHaveLength(1);
      expect(result.tasks[0].custom?.isUnscheduled).toBe(true);
    });

    it("should create unscheduled task when only end date is missing", () => {
      // Arrange
      const mockEntry: BasesEntry = {
        file: { path: "tasks/task-c.md", name: "task-c.md", basename: "task-c" },
        getValue: (propertyId: string) => {
          const values: Record<string, any> = {
            "note:start": { date: new Date("2024-03-01") },
          };
          return values[propertyId] || null;
        },
      };

      // Act
      const result = service.transformEntries([mockEntry], fieldMappings);

      // Assert
      expect(result.tasks).toHaveLength(1);
      expect(result.tasks[0].custom?.isUnscheduled).toBe(true);
    });

    it("should handle progress value of 0", () => {
      // Arrange
      const mockEntry: BasesEntry = {
        file: { path: "tasks/new-task.md", name: "new-task.md", basename: "new-task" },
        getValue: (propertyId: string) => {
          const values: Record<string, any> = {
            "note:start": { date: new Date("2024-04-01") },
            "note:due": { date: new Date("2024-04-10") },
            "note:progress": { data: 0 },
          };
          return values[propertyId] || null;
        },
      };

      // Act
      const result = service.transformEntries([mockEntry], fieldMappings);

      // Assert
      expect(result.tasks).toHaveLength(1);
      expect(result.tasks[0].progress).toBe(0);
    });

    it("should handle missing progress property gracefully", () => {
      // Arrange
      const mockEntry: BasesEntry = {
        file: { path: "tasks/task-d.md", name: "task-d.md", basename: "task-d" },
        getValue: (propertyId: string) => {
          const values: Record<string, any> = {
            "note:start": { date: new Date("2024-05-01") },
            "note:due": { date: new Date("2024-05-10") },
          };
          return values[propertyId] || null;
        },
      };

      // Act
      const result = service.transformEntries([mockEntry], fieldMappings);

      // Assert
      expect(result.tasks).toHaveLength(1);
      expect(result.tasks[0].progress).toBeUndefined();
    });

    it("should transform multiple entries correctly", () => {
      // Arrange
      const entries: BasesEntry[] = [
        {
          file: { path: "task-1.md", name: "task-1.md", basename: "task-1" },
          getValue: () => ({
            date: new Date("2024-06-01"),
          }),
        },
        {
          file: { path: "task-2.md", name: "task-2.md", basename: "task-2" },
          getValue: () => ({
            date: new Date("2024-06-05"),
          }),
        },
      ];

      // Act
      const result = service.transformEntries(entries, fieldMappings);

      // Assert
      expect(result.tasks).toHaveLength(2);
      expect(result.errors).toHaveLength(0);
      expect(result.tasks[0].id).toBe("task-1.md");
      expect(result.tasks[1].id).toBe("task-2.md");
    });

    it("should preserve originalEntry reference in custom metadata", () => {
      // Arrange
      const mockEntry: BasesEntry = {
        file: { path: "test.md", name: "test.md", basename: "test" },
        getValue: () => ({
          date: new Date("2024-07-01"),
        }),
      };

      // Act
      const result = service.transformEntries([mockEntry], fieldMappings);

      // Assert
      expect(result.tasks).toHaveLength(1);
      expect(result.tasks[0].custom?.originalEntry).toBe(mockEntry);
    });

    it("should set parent field when parentProperty is configured", () => {
      // Arrange
      const mappings: FieldMappings = {
        textProperty: "note:title",
        startProperty: "note:start",
        endProperty: "note:due",
        progressProperty: "note:progress",
        parentProperty: "note:parent",
      };

      const mockEntry: BasesEntry = {
        file: { path: "tasks/child.md", name: "child.md", basename: "child" },
        getValue: (propertyId: string) => {
          const values: Record<string, any> = {
            "note:title": { data: "Child Task" },
            "note:start": { date: new Date("2024-08-01") },
            "note:due": { date: new Date("2024-08-05") },
            "note:parent": { data: "projects/parent.md" },
          };
          return values[propertyId] || null;
        },
      };

      // Act
      const result = service.transformEntries([mockEntry], mappings);

      // Assert
      expect(result.tasks).toHaveLength(1);
      expect(result.tasks[0].parent).toBe("projects/parent.md");
    });

    it("should not set parent field when parentProperty is not configured", () => {
      // Arrange
      const mappings: FieldMappings = {
        textProperty: "note:title",
        startProperty: "note:start",
        endProperty: "note:due",
        progressProperty: "note:progress",
        // parentProperty not set
      };

      const mockEntry: BasesEntry = {
        file: { path: "tasks/orphan.md", name: "orphan.md", basename: "orphan" },
        getValue: (propertyId: string) => {
          const values: Record<string, any> = {
            "note:title": { data: "Orphan Task" },
            "note:start": { date: new Date("2024-08-01") },
            "note:due": { date: new Date("2024-08-05") },
          };
          return values[propertyId] || null;
        },
      };

      // Act
      const result = service.transformEntries([mockEntry], mappings);

      // Assert
      expect(result.tasks).toHaveLength(1);
      expect(result.tasks[0].parent).toBeUndefined();
    });

    it("should not set parent field when parent value is empty", () => {
      // Arrange
      const mappings: FieldMappings = {
        textProperty: "note:title",
        startProperty: "note:start",
        endProperty: "note:due",
        progressProperty: "note:progress",
        parentProperty: "note:parent",
      };

      const mockEntry: BasesEntry = {
        file: { path: "tasks/orphan.md", name: "orphan.md", basename: "orphan" },
        getValue: (propertyId: string) => {
          const values: Record<string, any> = {
            "note:title": { data: "Orphan Task" },
            "note:start": { date: new Date("2024-08-01") },
            "note:due": { date: new Date("2024-08-05") },
            "note:parent": null,
          };
          return values[propertyId];
        },
      };

      // Act
      const result = service.transformEntries([mockEntry], mappings);

      // Assert
      expect(result.tasks).toHaveLength(1);
      expect(result.tasks[0].parent).toBeUndefined();
    });

    it("should handle multiple parents by using first parent only", () => {
      // Arrange
      const mappings: FieldMappings = {
        textProperty: "note:title",
        startProperty: "note:start",
        endProperty: "note:due",
        progressProperty: "note:progress",
        parentProperty: "note:parents",
      };

      // Mock ListValue for multiple parents
      const parentsListValue = {
        length: () => 2,
        at: (i: number) => {
          const items = [
            { data: "projects/parent-a.md" },
            { data: "projects/parent-b.md" },
          ];
          return items[i];
        },
      };

      const mockEntry: BasesEntry = {
        file: { path: "tasks/multi-parent.md", name: "multi-parent.md", basename: "multi-parent" },
        getValue: (propertyId: string) => {
          const values: Record<string, any> = {
            "note:title": { data: "Multi-Parent Task" },
            "note:start": { date: new Date("2024-08-01") },
            "note:due": { date: new Date("2024-08-05") },
            "note:parents": parentsListValue,
          };
          return values[propertyId] || null;
        },
      };

      // Act
      const result = service.transformEntries([mockEntry], mappings);

      // Assert
      expect(result.tasks).toHaveLength(1);
      // For now, we only use the first parent (Phase 1: single parent support)
      // Phase 2 will implement virtual duplication for multiple parents
      expect(result.tasks[0].parent).toBe("projects/parent-a.md");
    });
  });

  describe("createUnscheduledTask", () => {
    it("should create task spanning today with red bar flag", () => {
      // Arrange
      const filePath = "unscheduled.md";
      const text = "Unscheduled Task";

      // Mock today
      const today = new Date();
      const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0, 0);
      const endOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);

      // Act
      const task = service.createUnscheduledTask(filePath, text, {} as BasesEntry);

      // Assert
      expect(task.id).toBe(filePath);
      expect(task.text).toBe(text);
      expect(task.start.getTime()).toBeGreaterThanOrEqual(startOfToday.getTime());
      expect(task.start.getTime()).toBeLessThanOrEqual(startOfToday.getTime() + 1000);
      expect(task.end.getTime()).toBeGreaterThanOrEqual(endOfToday.getTime() - 1000);
      expect(task.end.getTime()).toBeLessThanOrEqual(endOfToday.getTime());
      expect(task.custom?.isUnscheduled).toBe(true);
      expect(task.custom?.obsidianPath).toBe(filePath);
    });
  });
});
