import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";

// Import actual classes from refactored architecture
import { ConflictDetector } from "../../scripts/conflicts/ConflictDetector.mjs";
import { ConflictResolver } from "../../scripts/conflicts/ConflictResolver.mjs";
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
const mockFileSystem = {
  readFile: jest.fn(),
  writeFile: jest.fn(),
  copyFile: jest.fn(),
  unlink: jest.fn(),
};

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
@@ -1,3 +1,3 @@
 Feature: Test
-# Old comment
+# New comment
 Scenario: Test`;

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
@@ -1,3 +1,3 @@
 Feature: Test
-Scenario: Old scenario
+Scenario: New scenario
  Given something`;

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
  });
});

describe("ConflictResolver", () => {
  let conflictResolver: ConflictResolver;
  let conflictDetector: ConflictDetector;

  beforeEach(() => {
    conflictDetector = new ConflictDetector(mockGitExecutor);
    conflictResolver = new ConflictResolver(
      conflictDetector,
      mockGitExecutor,
      mockFileSystem
    );
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe("resolveConflicts", () => {
    it("should auto-resolve whitespace-only conflicts", async () => {
      const conflicts = [
        {
          filename: "test.feature",
          githubFile: "/test/github/test.feature",
          assertThatFile: "/test/staging/test.feature",
          stagingFile: "/test/staging/test.feature",
        },
      ];

      // Mock whitespace-only diff
      const diffOutput = `--- a/staging/test.feature
+++ b/github/test.feature
@@ -1,3 +1,3 @@
 Feature: Test
-  Scenario: Test
+  Scenario: Test
   Given something`;

      const error = createGitError("Files differ", 1, diffOutput);
      mockGitExecutor.mockImplementationOnce(() => {
        throw error;
      });

      // Mock file reads for resolution
      mockFileSystem.readFile.mockResolvedValue("Feature: Test\n  Scenario: Test\n  Given something");
      mockFileSystem.writeFile.mockResolvedValue(undefined);

      const result = await conflictResolver.resolveConflicts(conflicts);

      expect(result.autoResolved).toHaveLength(1);
      expect(result.autoResolved[0].filename).toBe("test.feature");
      expect(result.autoResolved[0].method).toBe("whitespace-normalization");
      expect(result.requiresManual).toHaveLength(0);
    });

    it("should detect complex conflicts requiring manual resolution", async () => {
      const conflicts = [
        {
          filename: "complex.feature",
          githubFile: "/test/github/complex.feature",
          assertThatFile: "/test/staging/complex.feature",
          stagingFile: "/test/staging/complex.feature",
        },
      ];

      // Mock complex diff (structural changes)
      const diffOutput = `--- a/staging/complex.feature
+++ b/github/complex.feature
@@ -1,5 +1,5 @@
 Feature: Test
-Scenario: Old scenario
-  Given old precondition
+Scenario: New scenario
+  Given new precondition
   When action
   Then result`;

      const error = createGitError("Files differ", 1, diffOutput);
      mockGitExecutor.mockImplementationOnce(() => {
        throw error;
      });

      // Mock file reads for conflict markers
      mockFileSystem.readFile.mockResolvedValue("Feature: Test\nScenario: Test");
      mockFileSystem.writeFile.mockResolvedValue(undefined);

      const result = await conflictResolver.resolveConflicts(conflicts);

      expect(result.autoResolved).toHaveLength(0);
      expect(result.requiresManual).toHaveLength(1);
      expect(result.requiresManual[0].filename).toBe("complex.feature");
      expect(result.requiresManual[0].method).toBe("conflict-markers");
    });

    it("should handle git command failures gracefully", async () => {
      const conflicts = [
        {
          filename: "failing.feature",
          githubFile: "/test/github/failing.feature",
          assertThatFile: "/test/staging/failing.feature",
          stagingFile: "/test/staging/failing.feature",
        },
      ];

      // Mock git command failure
      mockGitExecutor.mockImplementation(() => {
        throw new Error("Git command failed");
      });

      const result = await conflictResolver.resolveConflicts(conflicts);

      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].filename).toBe("failing.feature");
    });
  });



  describe("hasConflictMarkers", () => {
    it("should detect Git conflict markers", async () => {
      const contentWithConflicts = `Feature: Test
<<<<<<< HEAD
Some content
=======
Other content
>>>>>>> branch`;

      mockFileSystem.readFile.mockResolvedValueOnce(contentWithConflicts);

      const hasConflicts =
        await conflictResolver.hasConflictMarkers("/test/file.feature");

      expect(hasConflicts).toBe(true);
    });

    it("should return false for content without conflict markers", async () => {
      const cleanContent = `Feature: Test
Scenario: Clean scenario
  Given something
  When action
  Then result`;

      mockFileSystem.readFile.mockResolvedValueOnce(cleanContent);

      const hasConflicts =
        await conflictResolver.hasConflictMarkers("/test/file.feature");

      expect(hasConflicts).toBe(false);
    });

    it("should handle file read errors gracefully", async () => {
      mockFileSystem.readFile.mockRejectedValueOnce(
        new Error("File not found")
      );

      const hasConflicts = await conflictResolver.hasConflictMarkers(
        "/nonexistent/file.feature"
      );

      expect(hasConflicts).toBe(false); // Returns false on error
    });
  });

  describe("generateConflictMarkers", () => {
    it("should create Git-style conflict markers", async () => {
      const githubContent = "Feature: GitHub version";
      const assertThatContent = "Feature: AssertThat version";
      const filename = "test.feature";

      const result = conflictResolver.generateConflictMarkers(
        githubContent,
        assertThatContent,
        filename
      );

      expect(result).toContain("<<<<<<< GitHub (test.feature)");
      expect(result).toContain("Feature: GitHub version");
      expect(result).toContain("=======");
      expect(result).toContain("Feature: AssertThat version");
      expect(result).toContain(">>>>>>> AssertThat (test.feature)");
    });
  });

  describe("createConflictMarkers", () => {
    it("should create conflict markers for manual resolution", async () => {
      const conflict = {
        filename: "test.feature",
        githubFile: "/test/github/test.feature",
        assertThatFile: "/test/staging/test.feature",
        stagingFile: "/test/staging/test.feature",
      };

      const analysis = {
        isSimple: false,
        reason: "complex-change",
        confidence: 0.95,
        changeType: "structural",
      };

      const githubContent = "Feature: GitHub version";
      const assertThatContent = "Feature: AssertThat version";

      mockFileSystem.readFile
        .mockResolvedValueOnce(githubContent)
        .mockResolvedValueOnce(assertThatContent);
      mockFileSystem.writeFile.mockResolvedValueOnce(undefined);

      const result = await conflictResolver.createConflictMarkers(
        conflict,
        analysis
      );

      expect(result.success).toBe(true);
      expect(result.method).toBe("manual");
      expect(result.strategy).toBe("conflict-markers");
      expect(mockFileSystem.writeFile).toHaveBeenCalledWith(
        conflict.stagingFile,
        expect.stringContaining("<<<<<<< GitHub"),
        "utf8"
      );
    });

    it("should handle file read errors", async () => {
      const conflict = {
        filename: "test.feature",
        githubFile: "/test/github/test.feature",
        assertThatFile: "/test/staging/test.feature",
        stagingFile: "/test/staging/test.feature",
      };

      const analysis = {
        isSimple: false,
        reason: "complex-change",
        confidence: 0.95,
        changeType: "structural",
      };

      mockFileSystem.readFile.mockRejectedValueOnce(
        new Error("File not found")
      );

      await expect(
        conflictResolver.createConflictMarkers(conflict, analysis)
      ).rejects.toThrow("Failed to create conflict markers");
    });
  });
});
