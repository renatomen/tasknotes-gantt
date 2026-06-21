/**
 * OG-87: PropertyMappingService Unit Tests
 *
 * Tests for transforming BasesEntry[] to SVARTask[] using field mappings
 * Following TDD principles - tests written before implementation
 */

import { describe, it, expect, beforeEach } from "@jest/globals";
import type { App } from "obsidian";
import { PropertyMappingService } from "../../src/bases/services/PropertyMappingService";
import type { FieldMappings, SVARTask } from "../../src/bases/types/field-mapping";
import type { BasesEntryLike } from "../../src/bases/types/bases-entry";

describe("PropertyMappingService", () => {
  let service: PropertyMappingService;
  let fieldMappings: FieldMappings;

  beforeEach(() => {
    // PropertyMappingService requires an App for parent-link resolution
    // (metadataCache / vault). Provide a minimal mock that echoes the link
    // path back as the resolved file path, which is sufficient for these
    // mapping tests.
    const mockApp = {
      metadataCache: {
        getFirstLinkpathDest: (linkpath: string) => ({ path: linkpath }),
      },
      vault: {
        getAbstractFileByPath: () => null,
      },
    } as unknown as App;
    service = new PropertyMappingService(mockApp);
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
      const mockEntry: BasesEntryLike = {
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

      const mockEntry: BasesEntryLike = {
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
      const mockEntry: BasesEntryLike = {
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

    it("should create an inferred-start task (scheduled, not unscheduled) when only the start date is missing", () => {
      // Arrange — only a due date; start is missing
      const mockEntry: BasesEntryLike = {
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

      // Assert — a partial date is INFERRED into a single-day scheduled task,
      // not treated as unscheduled (only a task with no dates is unscheduled).
      expect(result.tasks).toHaveLength(1);
      expect(result.tasks[0].custom?.isUnscheduled).toBe(false);
      expect(result.tasks[0].custom?.dateStatus).toBe("inferred-start");
    });

    it("should create an inferred-end task (scheduled, not unscheduled) when only the end date is missing", () => {
      // Arrange — only a start date; end is missing
      const mockEntry: BasesEntryLike = {
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

      // Assert — partial date inferred into a single-day scheduled task.
      expect(result.tasks).toHaveLength(1);
      expect(result.tasks[0].custom?.isUnscheduled).toBe(false);
      expect(result.tasks[0].custom?.dateStatus).toBe("inferred-end");
    });

    it("should handle progress value of 0", () => {
      // Arrange
      const mockEntry: BasesEntryLike = {
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
      const mockEntry: BasesEntryLike = {
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
      const entries: BasesEntryLike[] = [
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

    it("should not include originalEntry in custom metadata (avoids SVAR circular reference)", () => {
      // Arrange
      const mockEntry: BasesEntryLike = {
        file: { path: "test.md", name: "test.md", basename: "test" },
        getValue: () => ({
          date: new Date("2024-07-01"),
        }),
      };

      // Act
      const result = service.transformEntries([mockEntry], fieldMappings);

      // Assert — originalEntry is deliberately omitted to avoid a circular
      // reference that crashes SVAR; obsidianPath carries the identity instead.
      expect(result.tasks).toHaveLength(1);
      expect((result.tasks[0].custom as { originalEntry?: unknown })?.originalEntry).toBeUndefined();
      expect(result.tasks[0].custom?.obsidianPath).toBe("test.md");
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

      const mockEntry: BasesEntryLike = {
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

      const mockEntry: BasesEntryLike = {
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

      const mockEntry: BasesEntryLike = {
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

      const mockEntry: BasesEntryLike = {
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
      const task = service.createUnscheduledTask(filePath, text, {} as unknown as BasesEntryLike);

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

    it("includes progress and parent when provided", () => {
      const task = service.createUnscheduledTask(
        "u.md",
        "U",
        {} as unknown as BasesEntryLike,
        42,
        "projects/p.md"
      );
      expect(task.progress).toBe(42);
      expect(task.parent).toBe("projects/p.md");
      expect(task.custom?.isUnscheduled).toBe(true);
    });

    it("adds unmapped visible properties and skips built-in column ids", () => {
      const entry: BasesEntryLike = {
        file: { path: "u.md", name: "u.md", basename: "u" },
        getValue: (propertyId: string) => {
          const values: Record<string, any> = {
            "note:priority": { data: "high" },
            "file.basename": { data: "u" },
          };
          return values[propertyId] ?? null;
        },
      };
      const task = service.createUnscheduledTask("u.md", "U", entry, null, undefined, [
        "note:priority",
        "file.basename",
      ]);
      expect((task as any)["note:priority"]).toBe("high");
      // file.basename is a skipped built-in (used for text), not added as a column
      expect((task as any)["file.basename"]).toBeUndefined();
    });
  });

  describe("resolveParentLink — parent reference formats", () => {
    const baseMappings: FieldMappings = {
      textProperty: "note:title",
      startProperty: "note:start",
      endProperty: "note:due",
      progressProperty: "note:progress",
      parentProperty: "note:parent",
    };

    function entryWithParent(parentRaw: unknown): BasesEntryLike {
      return {
        file: { path: "tasks/child.md", name: "child.md", basename: "child" },
        getValue: (propertyId: string) => {
          const values: Record<string, any> = {
            "note:title": { data: "Child" },
            "note:start": { date: new Date("2024-08-01") },
            "note:due": { date: new Date("2024-08-05") },
            "note:parent": parentRaw,
          };
          return values[propertyId] ?? null;
        },
      };
    }

    it("resolves a [[Page]] wikilink reference", () => {
      const result = service.transformEntries([entryWithParent({ data: "[[Parent Page]]" })], baseMappings);
      expect(result.tasks[0].parent).toBe("Parent Page");
    });

    it("strips the alias from a [[Page|Alias]] wikilink", () => {
      const result = service.transformEntries([entryWithParent({ data: "[[Parent Page|Shown]]" })], baseMappings);
      expect(result.tasks[0].parent).toBe("Parent Page");
    });

    it("extracts the path from a [text](path) markdown link", () => {
      const result = service.transformEntries([entryWithParent({ data: "[Parent](projects/p.md)" })], baseMappings);
      expect(result.tasks[0].parent).toBe("projects/p.md");
    });

    it("falls back to a direct vault path when the metadata cache misses", () => {
      const app = {
        metadataCache: { getFirstLinkpathDest: () => null },
        vault: { getAbstractFileByPath: (p: string) => ({ path: p }) },
      } as unknown as App;
      const svc = new PropertyMappingService(app);
      const result = svc.transformEntries([entryWithParent({ data: "projects/direct.md" })], baseMappings);
      expect(result.tasks[0].parent).toBe("projects/direct.md");
    });

    it("yields no parent when the reference cannot be resolved", () => {
      const app = {
        metadataCache: { getFirstLinkpathDest: () => null },
        vault: { getAbstractFileByPath: () => null },
      } as unknown as App;
      const svc = new PropertyMappingService(app);
      const result = svc.transformEntries([entryWithParent({ data: "[[Missing]]" })], baseMappings);
      expect(result.tasks[0].parent).toBeUndefined();
    });
  });

  describe("visible properties on scheduled tasks", () => {
    const mappings: FieldMappings = {
      textProperty: "note:title",
      startProperty: "note:start",
      endProperty: "note:due",
      progressProperty: "note:progress",
    };

    function scheduledEntry(): BasesEntryLike {
      return {
        file: { path: "tasks/t.md", name: "t.md", basename: "t" },
        getValue: (propertyId: string) => {
          const values: Record<string, any> = {
            "note:title": { data: "T" },
            "note:start": { date: new Date("2024-08-01") },
            "note:due": { date: new Date("2024-08-05") },
            "note:priority": { data: "high" },
          };
          return values[propertyId] ?? null;
        },
      };
    }

    it("adds an unmapped visible property to the task", () => {
      const result = service.transformEntries([scheduledEntry()], mappings, ["note:priority"]);
      expect((result.tasks[0] as any)["note:priority"]).toBe("high");
    });

    it("does not re-add a visible property already mapped to a gantt field", () => {
      const result = service.transformEntries([scheduledEntry()], mappings, ["note:start"]);
      // note:start is the startProperty → consumed as the bar date, not added as a column key
      expect((result.tasks[0] as any)["note:start"]).toBeUndefined();
      expect(result.tasks[0].start).toBeInstanceOf(Date);
    });
  });
});
