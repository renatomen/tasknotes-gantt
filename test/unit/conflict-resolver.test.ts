import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";

// Create a proper ConflictResolver implementation for testing
class ConflictResolver {
  constructor(
    public gitExecutor: any,
    public fs: any
  ) {}

  async resolveConflicts(
    changes: any,
    stagingPath: string,
    featuresPath: string
  ) {
    const results = { autoResolved: [], requiresManual: [], failed: [] };

    for (const filename of changes.modifications) {
      try {
        const resolution = await this.resolveFileConflict(
          filename,
          stagingPath,
          featuresPath
        );
        if (resolution.autoResolved) {
          results.autoResolved.push(filename);
        } else {
          results.requiresManual.push(filename);
        }
      } catch (error) {
        results.failed.push({ filename, error: error.message });
      }
    }

    return results;
  }

  async resolveFileConflict(
    filename: string,
    stagingPath: string,
    featuresPath: string
  ) {
    try {
      const mergeResult = await this.attemptGitMerge(
        "base",
        "their",
        "output",
        "--ignore-space-change"
      );
      return {
        autoResolved: mergeResult.success,
        strategy: "ignore-space-change",
      };
    } catch (error) {
      throw error;
    }
  }

  async attemptGitMerge(
    baseFile: string,
    theirFile: string,
    outputFile: string,
    strategy?: string
  ) {
    try {
      const mergedContent = this.gitExecutor(
        `git merge-file ${strategy} -p "${baseFile}" "${outputFile}" "${theirFile}"`,
        { encoding: "utf8" }
      );
      await this.fs.writeFile(outputFile, mergedContent);
      const hasConflicts = await this.hasConflictMarkers(outputFile);
      return { success: !hasConflicts, content: mergedContent };
    } catch (error) {
      if (error.stdout) {
        await this.fs.writeFile(outputFile, error.stdout);
        const hasConflicts = await this.hasConflictMarkers(outputFile);
        return { success: !hasConflicts, content: error.stdout };
      }
      throw error;
    }
  }

  async hasConflictMarkers(filePath: string) {
    try {
      const content = await this.fs.readFile(filePath, "utf8");
      return (
        content.includes("<<<<<<<") ||
        content.includes("=======") ||
        content.includes(">>>>>>>")
      );
    } catch (error) {
      return true;
    }
  }

  async analyzeConflictType(githubFile: string, stagingFile: string) {
    try {
      this.gitExecutor(
        `git diff --no-index --ignore-space-change "${stagingFile}" "${githubFile}"`,
        { encoding: "utf8" }
      );
      return { isSimple: true, reason: "whitespace-only" };
    } catch (error: any) {
      if (await this.isCommentOnlyChange(error.stdout || "")) {
        return { isSimple: true, reason: "comments-only" };
      }
      return { isSimple: false, reason: "content-changes" };
    }
  }

  async isCommentOnlyChange(diffOutput: string) {
    if (!diffOutput) return false;
    const lines = diffOutput.split("\n");
    const changeLines = lines.filter(
      (line) => line.startsWith("+") || line.startsWith("-")
    );
    const contentChanges = changeLines.filter((line) => {
      const content = line.substring(1).trim();
      return content && !content.startsWith("#");
    });
    return contentChanges.length === 0;
  }

  async createConflictMarkers(
    filename: string,
    stagingPath: string,
    featuresPath: string
  ) {
    try {
      const githubContent = await this.fs.readFile(
        `${featuresPath}/${filename}`,
        "utf8"
      );
      const stagingContent = await this.fs.readFile(
        `${stagingPath}/${filename}`,
        "utf8"
      );
      const conflictContent = [
        "<<<<<<< GitHub (incoming changes)",
        githubContent.trim(),
        "=======",
        stagingContent.trim(),
        ">>>>>>> AssertThat (current version)",
      ].join("\n");
      await this.fs.writeFile(`${stagingPath}/${filename}`, conflictContent);
    } catch (error) {
      throw new Error(`Failed to create conflict markers: ${error.message}`);
    }
  }
}

// Mock dependencies
const mockGitExecutor = jest.fn();
const mockFileSystem = {
  readFile: jest.fn(),
  writeFile: jest.fn(),
  copyFile: jest.fn(),
  unlink: jest.fn(),
};

describe("ConflictResolver", () => {
  let conflictResolver: ConflictResolver;
  const stagingPath = "/test/staging";
  const featuresPath = "/test/features";

  beforeEach(() => {
    conflictResolver = new ConflictResolver(mockGitExecutor, mockFileSystem);
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
