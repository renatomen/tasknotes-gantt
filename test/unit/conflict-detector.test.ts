import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";

// Import actual class from refactored architecture
import { ConflictDetector } from "../../scripts/conflicts/ConflictDetector.mjs";
import { cacheManager } from "../../scripts/cache/CacheManager.mjs";

/** Interface for git command errors with exit status and output */
interface GitCommandError extends Error {
  status: number;
  stdout: string;
}

/** Helper to create a typed git command error */
function createGitError(message: string, status: number, stdout: string): GitCommandError {
  const error = new Error(message) as GitCommandError;
  error.status = status;
  error.stdout = stdout;
  return error;
}

// Mock dependencies
const mockGitExecutor = jest.fn();

describe("ConflictDetector", () => {
  let conflictDetector: ConflictDetector;

  beforeEach(() => {
    conflictDetector = new ConflictDetector(mockGitExecutor);
    jest.clearAllMocks();
    // Clear cache to prevent test interference
    cacheManager.gitCache.clear();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe("analyzeConflictType", () => {
    it("should identify whitespace-only conflicts", async () => {
      const diffOutput = `--- a/staging/file.feature
+++ b/github/file.feature
@@ -1,3 +1,3 @@
 Feature: Test
-  Scenario: Test  
+  Scenario: Test
   Given something`;

      const error = createGitError("Files differ", 1, diffOutput);

      mockGitExecutor.mockImplementationOnce(() => {
        throw error;
      });

      const result = await conflictDetector.analyzeConflictType(
        "/github/file.feature",
        "/staging/file.feature"
      );

      expect(result.isSimple).toBe(true);
      expect(result.reason).toBe("whitespace-only");
    });

    it("should identify comment-only conflicts", async () => {
      const diffOutput = `--- a/staging/file.feature
+++ b/github/file.feature
@@ -1,4 +1,4 @@
 Feature: Test
-# This is the old comment explaining the feature
+# This is the new comment explaining the feature
 Scenario: Test
   Given something`;

      const error = createGitError("Files differ", 1, diffOutput);

      mockGitExecutor.mockImplementationOnce(() => {
        throw error;
      });

      const result = await conflictDetector.analyzeConflictType(
        "/github/file.feature",
        "/staging/file.feature"
      );

      expect(result.isSimple).toBe(true);
      expect(result.reason).toBe("comments-only");
    });

    it("should identify complex content conflicts", async () => {
      const diffOutput = `--- a/staging/file.feature
+++ b/github/file.feature
@@ -1,4 +1,4 @@
 Feature: Test
-Scenario: Old scenario name
+Scenario: New scenario name
   Given something
   When action`;

      const error = createGitError("Files differ", 1, diffOutput);

      mockGitExecutor.mockImplementationOnce(() => {
        throw error;
      });

      const result = await conflictDetector.analyzeConflictType(
        "/github/file.feature",
        "/staging/file.feature"
      );

      expect(result.isSimple).toBe(false);
      expect(result.reason).toBe("complex-change");
    });
  });

  describe("isCommentOnlyChange", () => {
    it("should return true for comment-only changes", async () => {
      const diffOutput = `--- a/file.feature
+++ b/file.feature
@@ -1,4 +1,4 @@
 Feature: Test
-# Old comment
+# New comment
-  # Another old comment
+  # Another new comment`;

      const result = await conflictDetector.isCommentOnlyChange(diffOutput);

      expect(result).toBe(true);
    });

    it("should return false for content changes", async () => {
      const diffOutput = `--- a/file.feature
+++ b/file.feature
@@ -1,4 +1,4 @@
 Feature: Test
-Scenario: Old
+Scenario: New
 # Comment`;

      const result = await conflictDetector.isCommentOnlyChange(diffOutput);

      expect(result).toBe(false);
    });

    it("should return false for empty diff output", async () => {
      const result = await conflictDetector.isCommentOnlyChange("");

      expect(result).toBe(false);
    });
  });

  describe("isWhitespaceOnlyChange", () => {
    it("should return true for whitespace-only changes", async () => {
      const diffOutput = `--- a/file.feature
+++ b/file.feature
@@ -1,3 +1,3 @@
 Feature: Test
-  Scenario: Test  
+  Scenario: Test
   Given something`;

      const result = await conflictDetector.isWhitespaceOnlyChange(diffOutput);

      expect(result).toBe(true);
    });

    it("should return false for content changes", async () => {
      const diffOutput = `--- a/file.feature
+++ b/file.feature
@@ -1,3 +1,3 @@
 Feature: Test
-Scenario: Old
+Scenario: New
  Given something`;

      const result = await conflictDetector.isWhitespaceOnlyChange(diffOutput);

      expect(result).toBe(false);
    });
  });

  describe("isFormattingChange", () => {
    it("should return true for formatting-only changes", async () => {
      const diffOutput = `--- a/file.feature
+++ b/file.feature
@@ -1,3 +1,3 @@
 Feature: Test
-Scenario:Test
+Scenario: Test
  Given something`;

      const result = await conflictDetector.isFormattingChange(diffOutput);

      expect(result).toBe(true);
    });

    it("should return false for content changes", async () => {
      const diffOutput = `--- a/file.feature
+++ b/file.feature
@@ -1,3 +1,3 @@
 Feature: Test
-Scenario: Old
+Scenario: New
  Given something`;

      const result = await conflictDetector.isFormattingChange(diffOutput);

      expect(result).toBe(false);
    });
  });

  describe("isMinorChange", () => {
    it("should return true for minor changes (< 5 lines)", async () => {
      const diffOutput = `--- a/file.feature
+++ b/file.feature
@@ -1,3 +1,3 @@
 Feature: Test
-  # Old comment
+  # New comment
  Scenario: Test`;

      const result = await conflictDetector.isMinorChange(diffOutput);

      expect(result).toBe(true);
    });

    it("should return false for major changes (> 5 lines)", async () => {
      const diffOutput = `--- a/file.feature
+++ b/file.feature
@@ -1,10 +1,10 @@
 Feature: Test
-  # Comment 1
-  # Comment 2
-  # Comment 3
-  # Comment 4
-  # Comment 5
-  # Comment 6
+  # New comment 1
+  # New comment 2
+  # New comment 3
+  # New comment 4
+  # New comment 5
+  # New comment 6
  Scenario: Test`;

      const result = await conflictDetector.isMinorChange(diffOutput);

      expect(result).toBe(false);
    });

    it("should return false for structural keyword changes", async () => {
      const diffOutput = `--- a/file.feature
+++ b/file.feature
@@ -1,3 +1,3 @@
 Feature: Test
-Scenario: Old
+Scenario: New
  Given something`;

      const result = await conflictDetector.isMinorChange(diffOutput);

      expect(result).toBe(false);
    });
  });
});

