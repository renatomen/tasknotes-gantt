/**
 * Integration tests for BasesDataAdapter
 * Based on TaskNotes' actual data extraction patterns
 *
 * These tests verify that our adapter extracts data from Bases
 * exactly as TaskNotes does for the TaskListView.
 */

import { describe, it, expect, beforeEach } from "@jest/globals";
import { BasesDataAdapter } from "../../src/bases/services/BasesDataAdapter";

describe("BasesDataAdapter - Integration Tests", () => {
  let mockBasesView: any;
  let adapter: BasesDataAdapter;

  beforeEach(() => {
    // Mock a minimal BasesView structure (Obsidian 1.10.0+ public API)
    mockBasesView = {
      data: {
        data: [], // Will be populated per test
        groupedData: [],
      },
      config: {
        getOrder: () => ["note.title", "note.due"],
        getDisplayName: (propId: string) => propId.split(".").pop() || propId,
      },
    };

    adapter = new BasesDataAdapter(mockBasesView);
  });

  describe("extractDataItems", () => {
    it("should extract basic data items from Bases entries", () => {
      // Arrange - Mock Bases entries with frontmatter
      mockBasesView.data.data = [
        {
          file: {
            path: "tasks/task-1.md",
            name: "task-1.md",
            basename: "task-1",
          },
          frontmatter: {
            title: "Task 1",
            due: "2024-01-15",
            status: "open",
          },
          getValue: (propId: string) => null,
        },
        {
          file: {
            path: "tasks/task-2.md",
            name: "task-2.md",
            basename: "task-2",
          },
          frontmatter: {
            title: "Task 2",
            due: "2024-01-20",
            status: "in-progress",
          },
          getValue: (propId: string) => null,
        },
      ];

      // Act
      const result = adapter.extractDataItems();

      // Assert
      expect(result).toHaveLength(2);
      expect(result[0].path).toBe("tasks/task-1.md");
      expect(result[0].properties?.title).toBe("Task 1");
      expect(result[0].properties?.due).toBe("2024-01-15");
      expect(result[1].path).toBe("tasks/task-2.md");
    });

    it("should extract file metadata properties", () => {
      // Arrange
      mockBasesView.data.data = [
        {
          file: {
            path: "tasks/task.md",
            name: "task.md",
            basename: "task",
            extension: "md",
            stat: {
              size: 1024,
              ctime: 1704067200000,
              mtime: 1704153600000,
            },
          },
          frontmatter: {},
          getValue: (propId: string) => null,
        },
      ];

      // Act
      const result = adapter.extractDataItems();

      // Assert
      expect(result[0].properties?.["file.name"]).toBe("task.md");
      expect(result[0].properties?.["file.basename"]).toBe("task");
      expect(result[0].properties?.["file.extension"]).toBe("md");
      expect(result[0].properties?.["file.size"]).toBe(1024);
      expect(result[0].properties?.["file.ctime"]).toBe(1704067200000);
      expect(result[0].properties?.["file.mtime"]).toBe(1704153600000);
    });

    it("should handle entries without frontmatter", () => {
      // Arrange
      mockBasesView.data.data = [
        {
          file: {
            path: "notes/note.md",
            name: "note.md",
            basename: "note",
          },
          // No frontmatter property
          getValue: (propId: string) => null,
        },
      ];

      // Act
      const result = adapter.extractDataItems();

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0].path).toBe("notes/note.md");
      expect(result[0].properties).toBeDefined();
    });

    it("should preserve basesData reference for computed properties", () => {
      // Arrange
      const mockEntry = {
        file: {
          path: "tasks/task.md",
          name: "task.md",
          basename: "task",
        },
        frontmatter: { title: "Task" },
        getValue: (propId: string) => ({ data: "test" }),
      };
      mockBasesView.data.data = [mockEntry];

      // Act
      const result = adapter.extractDataItems();

      // Assert
      expect(result[0].basesData).toBe(mockEntry);
    });
  });

  describe("getGroupedData", () => {
    it("should return grouped data from Bases", () => {
      // Arrange
      mockBasesView.data.groupedData = [
        {
          key: { data: "2024-01-15" },
          entries: [{ file: { path: "task1.md" } }],
        },
        {
          key: { data: "2024-01-20" },
          entries: [{ file: { path: "task2.md" } }],
        },
      ];

      // Act
      const result = adapter.getGroupedData();

      // Assert
      expect(result).toHaveLength(2);
      expect(result[0].key.data).toBe("2024-01-15");
      expect(result[1].key.data).toBe("2024-01-20");
    });
  });

  describe("isGrouped", () => {
    it("should return true for multiple groups", () => {
      // Arrange
      mockBasesView.data.groupedData = [
        { key: { data: "Group 1" }, entries: [], hasKey: () => true },
        { key: { data: "Group 2" }, entries: [], hasKey: () => true },
      ];

      // Act
      const result = adapter.isGrouped();

      // Assert
      expect(result).toBe(true);
    });

    it("should return false for single group without key", () => {
      // Arrange
      mockBasesView.data.groupedData = [
        { key: null, entries: [], hasKey: () => false },
      ];

      // Act
      const result = adapter.isGrouped();

      // Assert
      expect(result).toBe(false);
    });

    it("should return true for single group with valid key", () => {
      // Arrange
      mockBasesView.data.groupedData = [
        { key: { data: "Only Group" }, entries: [], hasKey: () => true },
      ];

      // Act
      const result = adapter.isGrouped();

      // Assert
      expect(result).toBe(true);
    });
  });

  describe("getPropertyValue", () => {
    it("should get property value using getValue", () => {
      // Arrange
      const mockEntry = {
        file: { path: "test.md", name: "test.md", basename: "test" },
        getValue: (propId: string) => {
          if (propId === "note.title") return { data: "Test Title" };
          return null;
        },
      };

      // Act
      const result = adapter.getPropertyValue(mockEntry, "note.title");

      // Assert
      expect(result).toBe("Test Title");
    });

    it("should convert Date values to native", () => {
      // Arrange
      const mockEntry = {
        file: { path: "test.md", name: "test.md", basename: "test" },
        getValue: (propId: string) => ({
          date: new Date("2024-01-15"),
        }),
      };

      // Act
      const result = adapter.getPropertyValue(mockEntry, "note.due");

      // Assert
      expect(result).toMatch(/2024-01-15/); // ISO string format
    });

    it("should handle ListValue with multiple items", () => {
      // Arrange
      const items = [{ data: "item1" }, { data: "item2" }];
      const mockEntry = {
        file: { path: "test.md", name: "test.md", basename: "test" },
        getValue: (propId: string) => ({
          length: () => items.length,
          at: (i: number) => items[i],
        }),
      };

      // Act
      const result = adapter.getPropertyValue(mockEntry, "note.tags");

      // Assert
      expect(Array.isArray(result)).toBe(true);
      expect(result).toEqual(["item1", "item2"]);
    });

    it("should return null for NullValue", () => {
      // Arrange
      const mockEntry = {
        file: { path: "test.md", name: "test.md", basename: "test" },
        getValue: (propId: string) => null,
      };

      // Act
      const result = adapter.getPropertyValue(mockEntry, "note.missing");

      // Assert
      expect(result).toBeNull();
    });
  });

  describe("convertGroupKeyToString", () => {
    it("should convert date key to YYYY-MM-DD format", () => {
      // Arrange
      const dateKey = {
        date: new Date("2024-01-15"),
        hasKey: () => true,
      };

      // Act
      const result = adapter.convertGroupKeyToString(dateKey);

      // Assert
      expect(result).toBe("2024-01-15");
    });

    it("should convert string key", () => {
      // Arrange
      const stringKey = {
        data: "Group Name",
        hasKey: () => true,
      };

      // Act
      const result = adapter.convertGroupKeyToString(stringKey);

      // Assert
      expect(result).toBe("Group Name");
    });

    it("should convert file path key", () => {
      // Arrange
      const fileKey = {
        file: { path: "projects/project-a.md" },
        hasKey: () => true,
      };

      // Act
      const result = adapter.convertGroupKeyToString(fileKey);

      // Assert
      expect(result).toBe("projects/project-a.md");
    });

    it("should return 'Unknown' for null key", () => {
      // Arrange
      const nullKey = null;

      // Act
      const result = adapter.convertGroupKeyToString(nullKey);

      // Assert
      expect(result).toBe("Unknown");
    });

    it("should return 'None' for missing key", () => {
      // Arrange
      const missingKey = {
        hasKey: () => false,
      };

      // Act
      const result = adapter.convertGroupKeyToString(missingKey);

      // Assert
      expect(result).toBe("Unknown");
    });

    // --- Characterization tests (added before S3776 refactor) ---
    it("should return 'None' when extracted .data is null", () => {
      expect(adapter.convertGroupKeyToString({ data: null, hasKey: () => true })).toBe("None");
    });

    it("should return 'None' for an empty-string .data value", () => {
      expect(adapter.convertGroupKeyToString({ data: "", hasKey: () => true })).toBe("None");
    });

    it("should stringify a numeric .data value", () => {
      expect(adapter.convertGroupKeyToString({ data: 42, hasKey: () => true })).toBe("42");
    });

    it("should render boolean .data values as True/False", () => {
      expect(adapter.convertGroupKeyToString({ data: true, hasKey: () => true })).toBe("True");
      expect(adapter.convertGroupKeyToString({ data: false, hasKey: () => true })).toBe("False");
    });

    it("should join non-empty array .data values with commas", () => {
      expect(adapter.convertGroupKeyToString({ data: ["a", "b"], hasKey: () => true })).toBe("a, b");
    });

    it("should return 'None' for an empty array .data value", () => {
      expect(adapter.convertGroupKeyToString({ data: [], hasKey: () => true })).toBe("None");
    });

    it("should format a top-level Date key as YYYY-MM-DD via .data branch", () => {
      // A Date arriving through .data (not .date) still gets date-formatted.
      const d = new Date("2024-03-10");
      expect(adapter.convertGroupKeyToString({ data: d, hasKey: () => true })).toBe("2024-03-10");
    });

    it("should fall back to String() when no recognized shape is present", () => {
      // No .file/.date/.data — uses the key object directly, then String().
      const key = { hasKey: () => true, toString: () => "raw-key" };
      expect(adapter.convertGroupKeyToString(key)).toBe("raw-key");
    });

    it("should treat a bare string key (no hasKey) as its own value", () => {
      // key has no hasKey and no .data/.date/.file -> falls through to actualValue = key
      expect(adapter.convertGroupKeyToString("plain")).toBe("plain");
    });
  });

  describe("getComputedProperty", () => {
    it("should lazily fetch computed property", () => {
      // Arrange
      const mockEntry = {
        file: { path: "test.md", name: "test.md", basename: "test" },
        getValue: (propId: string) => {
          if (propId === "file.backlinks") {
            return {
              length: () => 3,
              at: (i: number) => ({ data: `backlink-${i}.md` }),
            };
          }
          return null;
        },
      };

      // Act
      const result = adapter.getComputedProperty(mockEntry, "file.backlinks");

      // Assert
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(3);
    });

    it("should return null on error", () => {
      // Arrange
      const mockEntry = {
        file: { path: "test.md", name: "test.md", basename: "test" },
        getValue: (propId: string) => {
          throw new Error("Property not available");
        },
      };

      // Act
      const result = adapter.getComputedProperty(mockEntry, "file.invalid");

      // Assert
      expect(result).toBeNull();
    });
  });
});
