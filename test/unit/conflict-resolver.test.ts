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

      const error: any = new Error("Files differ");
      error.status = 1;
      error.stdout = diffOutput;

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

      const error: any = new Error("Files differ");
      error.status = 1;
      error.stdout = diffOutput;

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

      const error: any = new Error("Files differ");
      error.status = 1;
      error.stdout = diffOutput;

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
  const stagingPath = "/test/staging";
  const featuresPath = "/test/features";

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
      const changes = {
        modifications: ["test.feature"],
        additions: [],
        deletions: [],
      };

      // Mock successful git merge with ignore-space-change
      mockGitExecutor.mockReturnValueOnce("merged content without conflicts");
      mockFileSystem.readFile.mockResolvedValueOnce(
        "merged content without conflicts"
      );
      mockFileSystem.copyFile.mockResolvedValueOnce(undefined);
      mockFileSystem.unlink.mockResolvedValueOnce(undefined);

      const result = await conflictResolver.resolveConflicts(
        changes,
        stagingPath,
        featuresPath
      );

      expect(result.autoResolved).toContain("test.feature");
      expect(result.requiresManual).toHaveLength(0);
      expect(mockGitExecutor).toHaveBeenCalledWith(
        expect.stringContaining("git merge-file --ignore-space-change"),
        expect.any(Object)
      );
    });

    it("should detect complex conflicts requiring manual resolution", async () => {
      const changes = {
        modifications: ["complex.feature"],
        additions: [],
        deletions: [],
      };

      // Mock git merge failure for all strategies
      mockGitExecutor.mockImplementation(() => {
        const error = new Error("Merge conflict");
        error.stdout = "content with <<<<<<< conflict markers";
        throw error;
      });

      mockFileSystem.readFile.mockResolvedValue(
        "content with <<<<<<< conflict markers"
      );
      mockFileSystem.writeFile.mockResolvedValue(undefined);

      const result = await conflictResolver.resolveConflicts(
        changes,
        stagingPath,
        featuresPath
      );

      expect(result.autoResolved).toHaveLength(0);
      expect(result.requiresManual).toContain("complex.feature");
    });

    it("should handle git command failures gracefully", async () => {
      const changes = {
        modifications: ["failing.feature"],
        additions: [],
        deletions: [],
      };

      mockGitExecutor.mockImplementation(() => {
        throw new Error("Git command failed");
      });

      const result = await conflictResolver.resolveConflicts(
        changes,
        stagingPath,
        featuresPath
      );

      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].filename).toBe("failing.feature");
    });
  });

  describe("attemptGitMerge", () => {
    it("should successfully merge files without conflicts", async () => {
      const mergedContent = "successfully merged content";
      mockGitExecutor.mockReturnValueOnce(mergedContent);
      mockFileSystem.copyFile.mockResolvedValueOnce(undefined);
      mockFileSystem.writeFile.mockResolvedValueOnce(undefined);
      mockFileSystem.unlink.mockResolvedValueOnce(undefined);
      mockFileSystem.readFile.mockResolvedValueOnce(mergedContent);

      const result = await conflictResolver.attemptGitMerge(
        "/base/file.feature",
        "/their/file.feature",
        "/output/file.feature",
        "--ignore-space-change"
      );

      expect(result.success).toBe(true);
      expect(result.content).toBe(mergedContent);
    });

    it("should detect conflict markers in merged content", async () => {
      const conflictContent = `Feature: Test
<<<<<<< HEAD
Scenario: GitHub version
=======
Scenario: AssertThat version
>>>>>>> branch`;

      const error = new Error("Merge conflict");
      error.stdout = conflictContent;
      mockGitExecutor.mockImplementationOnce(() => {
        throw error;
      });

      mockFileSystem.writeFile.mockResolvedValueOnce(undefined);
      mockFileSystem.readFile.mockResolvedValueOnce(conflictContent);

      const result = await conflictResolver.attemptGitMerge(
        "/base/file.feature",
        "/their/file.feature",
        "/output/file.feature"
      );

      expect(result.success).toBe(false);
      expect(result.content).toBe(conflictContent);
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

      expect(hasConflicts).toBe(true); // Assume conflicts if can't read
    });
  });

  describe("analyzeConflictType", () => {
    it("should identify whitespace-only conflicts", async () => {
      // Mock git diff with ignore-space-change succeeding (no output)
      mockGitExecutor.mockReturnValueOnce("");

      const result = await conflictResolver.analyzeConflictType(
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

      const error = new Error("Files differ") as any;
      error.stdout = diffOutput;

      // First call (ignore-space-change) should fail, second call should use the stdout
      mockGitExecutor
        .mockImplementationOnce(() => {
          throw error;
        }) // First call fails
        .mockImplementationOnce(() => {
          throw error;
        }); // Second call provides diff output

      const result = await conflictResolver.analyzeConflictType(
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

      const error = new Error("Files differ");
      error.stdout = diffOutput;
      mockGitExecutor.mockImplementationOnce(() => {
        throw error;
      });

      const result = await conflictResolver.analyzeConflictType(
        "/github/file.feature",
        "/staging/file.feature"
      );

      expect(result.isSimple).toBe(false);
      expect(result.reason).toBe("content-changes");
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

      const result = await conflictResolver.isCommentOnlyChange(diffOutput);

      expect(result).toBe(true);
    });

    it("should return false for content changes", async () => {
      const diffOutput = `--- a/file.feature
+++ b/file.feature
@@ -1,3 +1,3 @@
-Scenario: Old
+Scenario: New
-# Comment
+# Comment`;

      const result = await conflictResolver.isCommentOnlyChange(diffOutput);

      expect(result).toBe(false);
    });

    it("should handle empty diff output", async () => {
      const result = await conflictResolver.isCommentOnlyChange("");

      expect(result).toBe(false);
    });
  });

  describe("createConflictMarkers", () => {
    it("should create Git-style conflict markers", async () => {
      const githubContent = "GitHub version content";
      const stagingContent = "AssertThat version content";

      mockFileSystem.readFile
        .mockResolvedValueOnce(githubContent)
        .mockResolvedValueOnce(stagingContent);
      mockFileSystem.writeFile.mockResolvedValueOnce(undefined);

      await conflictResolver.createConflictMarkers(
        "test.feature",
        stagingPath,
        featuresPath
      );

      expect(mockFileSystem.writeFile).toHaveBeenCalledWith(
        expect.stringContaining("test.feature"),
        expect.stringContaining("<<<<<<< GitHub (incoming changes)")
      );
      expect(mockFileSystem.writeFile).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining(">>>>>>> AssertThat (current version)")
      );
    });

    it("should handle file read errors", async () => {
      mockFileSystem.readFile.mockRejectedValueOnce(
        new Error("File not found")
      );

      await expect(
        conflictResolver.createConflictMarkers(
          "test.feature",
          stagingPath,
          featuresPath
        )
      ).rejects.toThrow("Failed to create conflict markers");
    });
  });
});
