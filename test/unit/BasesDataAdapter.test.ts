/**
 * OG-87: BasesDataAdapter Unit Tests
 *
 * Tests for extracting and converting BasesEntry values to native JavaScript types
 * Following TDD principles - tests written before implementation
 */

import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import type { BasesEntry } from "obsidian";
import { BasesDataAdapter, type BasesEntryLike } from "../../src/bases/services/BasesDataAdapter";

describe("BasesDataAdapter", () => {
  let adapter: BasesDataAdapter;

  beforeEach(() => {
    adapter = new BasesDataAdapter();
  });

  describe("extractValue", () => {
    it("should extract string value from BasesValue", () => {
      // Arrange - PrimitiveValue uses .data property
      const mockEntry: BasesEntryLike = {
        file: { path: "test.md", name: "test.md", basename: "test" },
        getValue: (propertyId: string) => ({
          data: "Task Name",
        }),
      };

      // Act
      const result = adapter.extractValue(mockEntry, "note:title");

      // Assert
      expect(result).toBe("Task Name");
    });

    it("should return null for empty BasesValue", () => {
      // Arrange - NullValue
      const mockEntry: BasesEntryLike = {
        file: { path: "test.md", name: "test.md", basename: "test" },
        getValue: (propertyId: string) => null,
      };

      // Act
      const result = adapter.extractValue(mockEntry, "note:missing");

      // Assert
      expect(result).toBeNull();
    });

    it("should return null for undefined BasesValue", () => {
      // Arrange - undefined value
      const mockEntry: BasesEntryLike = {
        file: { path: "test.md", name: "test.md", basename: "test" },
        getValue: (propertyId: string) => undefined,
      };

      // Act
      const result = adapter.extractValue(mockEntry, "note:undefined");

      // Assert
      expect(result).toBeNull();
    });

    // --- Characterization tests (added before S3776 refactor) ---
    it("reads a note. (dot) frontmatter property directly without getValue", () => {
      const mockEntry: any = {
        file: { path: "test.md", name: "test.md", basename: "test" },
        frontmatter: { start: "2024-01-01" },
        getValue: () => { throw new Error("should not be called"); },
      };
      expect(adapter.extractValue(mockEntry, "note.start" as any)).toBe("2024-01-01");
    });

    it("returns null for a note. property that is an empty string", () => {
      const mockEntry: any = {
        file: { path: "test.md", name: "test.md", basename: "test" },
        frontmatter: { start: "" },
        getValue: () => null,
      };
      expect(adapter.extractValue(mockEntry, "note.start" as any)).toBeNull();
    });

    it("falls back to entry.properties when frontmatter is absent for note. prefix", () => {
      const mockEntry: any = {
        file: { path: "test.md", name: "test.md", basename: "test" },
        properties: { start: "via-properties" },
        getValue: () => null,
      };
      expect(adapter.extractValue(mockEntry, "note.start" as any)).toBe("via-properties");
    });

    it("reads file.ctime/mtime/size from file.stat", () => {
      const mockEntry: any = {
        file: {
          path: "test.md",
          name: "test.md",
          basename: "test",
          stat: { ctime: 111, mtime: 222, size: 333 },
        },
        getValue: () => null,
      };
      expect(adapter.extractValue(mockEntry, "file.ctime" as any)).toBe(111);
      expect(adapter.extractValue(mockEntry, "file.mtime" as any)).toBe(222);
      expect(adapter.extractValue(mockEntry, "file.size" as any)).toBe(333);
    });

    it("reads file.folder from the parent folder name", () => {
      const mockEntry: any = {
        file: {
          path: "projects/test.md",
          name: "test.md",
          basename: "test",
          parent: { name: "projects" },
        },
        getValue: () => null,
      };
      expect(adapter.extractValue(mockEntry, "file.folder" as any)).toBe("projects");
    });

    it("reads a direct file. property (e.g. basename)", () => {
      const mockEntry: any = {
        file: { path: "test.md", name: "test.md", basename: "test" },
        getValue: () => null,
      };
      expect(adapter.extractValue(mockEntry, "file.basename" as any)).toBe("test");
    });

    it("returns null for a direct file. property that is empty", () => {
      const mockEntry: any = {
        file: { path: "test.md", name: "test.md", basename: "" },
        getValue: () => null,
      };
      expect(adapter.extractValue(mockEntry, "file.basename" as any)).toBeNull();
    });

    it("uses getValue() for computed/formula properties (non note./file. prefix)", () => {
      const mockEntry: any = {
        file: { path: "test.md", name: "test.md", basename: "test" },
        getValue: (propId: string) => (propId === "formula.x" ? { data: "computed" } : null),
      };
      expect(adapter.extractValue(mockEntry, "formula.x" as any)).toBe("computed");
    });

    it("returns null and warns when getValue() throws", () => {
      const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
      const mockEntry: any = {
        file: { path: "test.md", name: "test.md", basename: "test" },
        getValue: () => { throw new Error("boom"); },
      };
      expect(adapter.extractValue(mockEntry, "formula.x" as any)).toBeNull();
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });

    // Faithful-double guard (plan 2026-06-21-001, U3 / P0 risk). The double is
    // typed against the OFFICIAL `BasesEntry` (file + getValue only), and the
    // adapter's loose boundary (`BasesEntryLike`) must still read the runtime
    // `frontmatter` member that Obsidian populates but does not declare. This
    // proves the `note.*` fast path returns the real non-null value end-to-end
    // and can't pass by silently re-encoding a wrong assumption.
    it("reads note.* off the runtime frontmatter of an officially-typed BasesEntry double", () => {
      // Only the official members are declared; `frontmatter` is the undeclared
      // runtime member the adapter deliberately relies on (cast through the
      // public type to model how Obsidian hands us the real entry).
      const officialDouble = {
        file: { path: "task.md", name: "task.md", basename: "task" },
        getValue: () => {
          throw new Error("note.* must not route through getValue()");
        },
      } as unknown as BasesEntry;

      // Attach the undeclared-but-present runtime member exactly as Obsidian does.
      (officialDouble as unknown as { frontmatter: Record<string, unknown> }).frontmatter = {
        start: "2026-01-15",
      };

      const result = adapter.extractValue(
        officialDouble as unknown as BasesEntryLike,
        "note.start",
      );

      expect(result).toBe("2026-01-15");
    });
  });

  describe("convertToDate", () => {
    it("should convert ISO date string to Date object", () => {
      // Arrange
      const isoString = "2024-01-15";

      // Act
      const result = adapter.convertToDate(isoString);

      // Assert
      expect(result).toBeInstanceOf(Date);
      expect(result?.getFullYear()).toBe(2024);
      expect(result?.getMonth()).toBe(0); // January (0-indexed)
      expect(result?.getDate()).toBe(15);
    });

    it("should convert timestamp to Date object", () => {
      // Arrange
      const timestamp = new Date("2024-06-20").getTime();

      // Act
      const result = adapter.convertToDate(timestamp);

      // Assert
      expect(result).toBeInstanceOf(Date);
      expect(result?.getFullYear()).toBe(2024);
      expect(result?.getMonth()).toBe(5); // June (0-indexed)
      expect(result?.getDate()).toBe(20);
    });

    it("should return null for invalid date string", () => {
      // Arrange
      const invalidDate = "not-a-date";

      // Act
      const result = adapter.convertToDate(invalidDate);

      // Assert
      expect(result).toBeNull();
    });

    it("should return null for null input", () => {
      // Act
      const result = adapter.convertToDate(null);

      // Assert
      expect(result).toBeNull();
    });

    it("should return null for undefined input", () => {
      // Act
      const result = adapter.convertToDate(undefined);

      // Assert
      expect(result).toBeNull();
    });

    it("should handle Date objects passthrough", () => {
      // Arrange
      const dateObj = new Date("2024-03-10");

      // Act
      const result = adapter.convertToDate(dateObj);

      // Assert
      expect(result).toBeInstanceOf(Date);
      expect(result?.getTime()).toBe(dateObj.getTime());
    });
  });

  describe("convertToNumber", () => {
    it("should convert numeric string to number", () => {
      // Arrange
      const numString = "42";

      // Act
      const result = adapter.convertToNumber(numString);

      // Assert
      expect(result).toBe(42);
    });

    it("should convert float string to number", () => {
      // Arrange
      const floatString = "75.5";

      // Act
      const result = adapter.convertToNumber(floatString);

      // Assert
      expect(result).toBe(75.5);
    });

    it("should handle number input passthrough", () => {
      // Arrange
      const num = 100;

      // Act
      const result = adapter.convertToNumber(num);

      // Assert
      expect(result).toBe(100);
    });

    it("should return null for non-numeric string", () => {
      // Arrange
      const invalidNum = "not-a-number";

      // Act
      const result = adapter.convertToNumber(invalidNum);

      // Assert
      expect(result).toBeNull();
    });

    it("should return null for null input", () => {
      // Act
      const result = adapter.convertToNumber(null);

      // Assert
      expect(result).toBeNull();
    });

    it("should clamp progress value to 0-100 range", () => {
      // Arrange - Test value above 100
      const aboveMax = 150;

      // Act
      const result = adapter.convertToNumber(aboveMax, { min: 0, max: 100 });

      // Assert
      expect(result).toBe(100);
    });

    it("should clamp progress value to 0-100 range for negative", () => {
      // Arrange - Test negative value
      const belowMin = -10;

      // Act
      const result = adapter.convertToNumber(belowMin, { min: 0, max: 100 });

      // Assert
      expect(result).toBe(0);
    });
  });

  describe("extractText", () => {
    it("should extract text property value", () => {
      // Arrange - PrimitiveValue uses .data property
      const mockEntry: BasesEntryLike = {
        file: { path: "test.md", name: "test.md", basename: "test" },
        getValue: (propertyId: string) => ({
          data: "My Task",
        }),
      };

      // Act
      const result = adapter.extractText(mockEntry, "note:title");

      // Assert
      expect(result).toBe("My Task");
    });

    it("should fallback to file.basename when property is empty", () => {
      // Arrange - NullValue
      const mockEntry: BasesEntryLike = {
        file: { path: "folder/task.md", name: "task.md", basename: "task" },
        getValue: (propertyId: string) => null,
      };

      // Act
      const result = adapter.extractText(mockEntry, "");

      // Assert
      expect(result).toBe("task");
    });

    it("should use file.basename when textProperty is empty string", () => {
      // Arrange - This shouldn't call getValue when textProperty is ""
      const mockEntry: BasesEntryLike = {
        file: { path: "notes/meeting.md", name: "meeting.md", basename: "meeting" },
        getValue: (propertyId: string) => ({
          data: "Should be ignored",
        }),
      };

      // Act
      const result = adapter.extractText(mockEntry, "");

      // Assert
      expect(result).toBe("meeting");
    });
  });

  describe("extractStatus", () => {
    it("should extract the raw status string", () => {
      const mockEntry: BasesEntryLike = {
        file: { path: "test.md", name: "test.md", basename: "test" },
        getValue: (_propertyId: string) => ({ data: "11🟥Active = Now" }),
      };

      expect(adapter.extractStatus(mockEntry, "note:status")).toBe("11🟥Active = Now");
    });

    it("should return null when statusProperty is undefined", () => {
      const mockEntry: BasesEntryLike = {
        file: { path: "test.md", name: "test.md", basename: "test" },
        getValue: (_propertyId: string) => ({ data: "ignored" }),
      };

      expect(adapter.extractStatus(mockEntry, undefined)).toBeNull();
    });

    it("should return null when statusProperty is empty", () => {
      const mockEntry: BasesEntryLike = {
        file: { path: "test.md", name: "test.md", basename: "test" },
        getValue: (_propertyId: string) => ({ data: "ignored" }),
      };

      expect(adapter.extractStatus(mockEntry, "")).toBeNull();
    });

    it("should return null when the status value is missing (no basename fallback)", () => {
      const mockEntry: BasesEntryLike = {
        file: { path: "test.md", name: "test.md", basename: "test" },
        getValue: (_propertyId: string) => null,
      };

      expect(adapter.extractStatus(mockEntry, "note:missing")).toBeNull();
    });
  });

  describe("extractDate", () => {
    it("should extract and convert date property", () => {
      // Arrange - DateValue uses .date property
      const mockEntry: BasesEntryLike = {
        file: { path: "test.md", name: "test.md", basename: "test" },
        getValue: (propertyId: string) => ({
          date: new Date("2024-05-15"),
        }),
      };

      // Act
      const result = adapter.extractDate(mockEntry, "note:start");

      // Assert
      expect(result).toBeInstanceOf(Date);
      expect(result?.getFullYear()).toBe(2024);
      expect(result?.getMonth()).toBe(4); // May (0-indexed)
    });

    it("should return null for missing date property", () => {
      // Arrange - NullValue
      const mockEntry: BasesEntryLike = {
        file: { path: "test.md", name: "test.md", basename: "test" },
        getValue: (propertyId: string) => null,
      };

      // Act
      const result = adapter.extractDate(mockEntry, "note:missing");

      // Assert
      expect(result).toBeNull();
    });

    it("warns when a mapped date value is present but unparseable (returns null)", () => {
      // Arrange - a present value that does not parse to a date.
      const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
      const mockEntry: BasesEntryLike = {
        file: { path: "test.md", name: "test.md", basename: "test" },
        getValue: (_propertyId: string) => "not-a-date",
      };

      // Act
      const result = adapter.extractDate(mockEntry, "note:start");

      // Assert
      expect(result).toBeNull();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("did not parse to a date"),
        "not-a-date",
      );
      warn.mockRestore();
    });
  });

  describe("extractProgress", () => {
    it("should extract and convert progress value", () => {
      // Arrange - PrimitiveValue (number) uses .data property
      const mockEntry: BasesEntryLike = {
        file: { path: "test.md", name: "test.md", basename: "test" },
        getValue: (propertyId: string) => ({
          data: 75,
        }),
      };

      // Act
      const result = adapter.extractProgress(mockEntry, "note:progress");

      // Assert
      expect(result).toBe(75);
    });

    it("should return null for missing progress property", () => {
      // Arrange - NullValue
      const mockEntry: BasesEntryLike = {
        file: { path: "test.md", name: "test.md", basename: "test" },
        getValue: (propertyId: string) => null,
      };

      // Act
      const result = adapter.extractProgress(mockEntry, "note:missing");

      // Assert
      expect(result).toBeNull();
    });

    it("should clamp progress value above 100", () => {
      // Arrange - PrimitiveValue (number) uses .data property
      const mockEntry: BasesEntryLike = {
        file: { path: "test.md", name: "test.md", basename: "test" },
        getValue: (propertyId: string) => ({
          data: 150,
        }),
      };

      // Act
      const result = adapter.extractProgress(mockEntry, "note:progress");

      // Assert
      expect(result).toBe(100);
    });

    it("should clamp negative progress value to 0", () => {
      // Arrange - PrimitiveValue (number) uses .data property
      const mockEntry: BasesEntryLike = {
        file: { path: "test.md", name: "test.md", basename: "test" },
        getValue: (propertyId: string) => ({
          data: -10,
        }),
      };

      // Act
      const result = adapter.extractProgress(mockEntry, "note:progress");

      // Assert
      expect(result).toBe(0);
    });
  });

  describe("extractParents", () => {
    it("should extract single parent reference (string)", () => {
      // Arrange - PrimitiveValue uses .data property
      const mockEntry: BasesEntryLike = {
        file: { path: "tasks/child.md", name: "child.md", basename: "child" },
        getValue: (propertyId: string) => ({
          data: "projects/parent.md",
        }),
      };

      // Act
      const result = adapter.extractParents(mockEntry, "note:parent");

      // Assert
      expect(result).toEqual(["projects/parent.md"]);
    });

    it("should return empty array when parent property is empty", () => {
      // Arrange - NullValue
      const mockEntry: BasesEntryLike = {
        file: { path: "tasks/orphan.md", name: "orphan.md", basename: "orphan" },
        getValue: (propertyId: string) => null,
      };

      // Act
      const result = adapter.extractParents(mockEntry, "note:parent");

      // Assert
      expect(result).toEqual([]);
    });

    it("should return empty array when parent property is not configured", () => {
      // Arrange
      const mockEntry: BasesEntryLike = {
        file: { path: "tasks/task.md", name: "task.md", basename: "task" },
        getValue: (propertyId: string) => null,
      };

      // Act
      const result = adapter.extractParents(mockEntry, "");

      // Assert
      expect(result).toEqual([]);
    });

    it("should extract multiple parent references (array)", () => {
      // Arrange - ListValue with .length() and .at() methods
      const items = [
        { data: "projects/parent-a.md" },
        { data: "projects/parent-b.md" },
      ];
      const mockEntry: BasesEntryLike = {
        file: { path: "tasks/multi-parent.md", name: "multi-parent.md", basename: "multi-parent" },
        getValue: (propertyId: string) => ({
          length: () => items.length,
          at: (i: number) => items[i],
        }),
      };

      // Act
      const result = adapter.extractParents(mockEntry, "note:parents");

      // Assert
      expect(result).toEqual(["projects/parent-a.md", "projects/parent-b.md"]);
    });

    it("should handle single-item array", () => {
      // Arrange - ListValue with one item
      const items = [{ data: "projects/parent.md" }];
      const mockEntry: BasesEntryLike = {
        file: { path: "tasks/task.md", name: "task.md", basename: "task" },
        getValue: (propertyId: string) => ({
          length: () => items.length,
          at: (i: number) => items[i],
        }),
      };

      // Act
      const result = adapter.extractParents(mockEntry, "note:parent");

      // Assert
      expect(result).toEqual(["projects/parent.md"]);
    });

    it("should filter out null/undefined values from array", () => {
      // Arrange - ListValue with mixed null/undefined values
      const items = [
        { data: "projects/parent-a.md" },
        null,
        { data: "projects/parent-b.md" },
        undefined,
        { data: "" },
      ];
      const mockEntry: BasesEntryLike = {
        file: { path: "tasks/task.md", name: "task.md", basename: "task" },
        getValue: (propertyId: string) => ({
          length: () => items.length,
          at: (i: number) => items[i],
        }),
      };

      // Act
      const result = adapter.extractParents(mockEntry, "note:parents");

      // Assert
      expect(result).toEqual(["projects/parent-a.md", "projects/parent-b.md"]);
    });

    it("should handle FileValue objects in array", () => {
      // Arrange - ListValue with FileValue items
      const items = [
        { file: { path: "projects/parent-a.md" } },
        { file: { path: "projects/parent-b.md" } },
      ];
      const mockEntry: BasesEntryLike = {
        file: { path: "tasks/task.md", name: "task.md", basename: "task" },
        getValue: (propertyId: string) => ({
          length: () => items.length,
          at: (i: number) => items[i],
        }),
      };

      // Act
      const result = adapter.extractParents(mockEntry, "note:parents");

      // Assert
      expect(result).toEqual(["projects/parent-a.md", "projects/parent-b.md"]);
    });

    it("should handle mixed array of strings and FileValue objects", () => {
      // Arrange - ListValue with mixed PrimitiveValue and FileValue
      const items = [
        { data: "projects/parent-a.md" },
        { file: { path: "projects/parent-b.md" } },
      ];
      const mockEntry: BasesEntryLike = {
        file: { path: "tasks/task.md", name: "task.md", basename: "task" },
        getValue: (propertyId: string) => ({
          length: () => items.length,
          at: (i: number) => items[i],
        }),
      };

      // Act
      const result = adapter.extractParents(mockEntry, "note:parents");

      // Assert
      expect(result).toEqual(["projects/parent-a.md", "projects/parent-b.md"]);
    });
  });
});
