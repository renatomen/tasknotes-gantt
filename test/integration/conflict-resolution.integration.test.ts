import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import fs from "fs/promises";
import path from "path";
import { execSync } from "child_process";

// Mock implementations for integration testing
class ConflictResolver {
  constructor(
    public gitExecutor = execSync,
    public fileSystem = fs
  ) {}

  async resolveConflicts(
    changes: any,
    stagingPath: string,
    featuresPath: string
  ) {
    const results = {
      autoResolved: [] as string[],
      requiresManual: [] as string[],
      failed: [] as any[],
    };

    for (const filename of changes.modifications) {
      try {
        const githubFile = path.join(featuresPath, filename);
        const stagingFile = path.join(stagingPath, filename);

        // Simple heuristic: if files are very similar, auto-resolve
        const githubContent = await this.fileSystem.readFile(
          githubFile,
          "utf8"
        );
        const stagingContent = await this.fileSystem.readFile(
          stagingFile,
          "utf8"
        );

        // Check for whitespace-only differences
        if (
          githubContent.replace(/\s/g, "") === stagingContent.replace(/\s/g, "")
        ) {
          results.autoResolved.push(filename);
        }
        // Check for comment-only differences
        else if (this.isCommentOnlyDifference(githubContent, stagingContent)) {
          results.autoResolved.push(filename);
        }
        // Complex differences require manual resolution
        else {
          results.requiresManual.push(filename);
        }
      } catch (error) {
        results.failed.push({ filename, error: error.message });
      }
    }

    return results;
  }

  isCommentOnlyDifference(content1: string, content2: string): boolean {
    const lines1 = content1
      .split("\n")
      .filter((line) => !line.trim().startsWith("#"));
    const lines2 = content2
      .split("\n")
      .filter((line) => !line.trim().startsWith("#"));
    return lines1.join("\n") === lines2.join("\n");
  }

  async createConflictMarkers(
    filename: string,
    stagingPath: string,
    featuresPath: string
  ) {
    const githubFile = path.join(featuresPath, filename);
    const stagingFile = path.join(stagingPath, filename);

    const githubContent = await this.fileSystem.readFile(githubFile, "utf8");
    const stagingContent = await this.fileSystem.readFile(stagingFile, "utf8");

    const conflictContent = [
      "<<<<<<< GitHub (incoming changes)",
      githubContent.trim(),
      "=======",
      stagingContent.trim(),
      ">>>>>>> AssertThat (current version)",
    ].join("\n");

    await this.fileSystem.writeFile(stagingFile, conflictContent);
  }
}

class StagingAreaManager {
  constructor(
    public stagingPath = "",
    public featuresPath = ""
  ) {}

  async getStagingFeatures() {
    try {
      const files = await fs.readdir(this.stagingPath);
      return files.filter((file) => file.endsWith(".feature"));
    } catch {
      return [];
    }
  }

  async getGitHubFeatures() {
    try {
      const files = await fs.readdir(this.featuresPath);
      return files.filter((file) => file.endsWith(".feature"));
    } catch {
      return [];
    }
  }
}

class GitDiffManager {
  constructor(
    public stagingManager: StagingAreaManager,
    public conflictResolver: ConflictResolver
  ) {}

  async detectChanges() {
    const stagingFeatures = await this.stagingManager.getStagingFeatures();
    const githubFeatures = await this.stagingManager.getGitHubFeatures();

    const changes = {
      additions: [],
      modifications: [],
      deletions: [],
    };

    // Find modifications (files that exist in both but might differ)
    for (const githubFile of githubFeatures) {
      if (stagingFeatures.includes(githubFile)) {
        const isDifferent = await this.compareFiles(githubFile);
        if (isDifferent) {
          changes.modifications.push(githubFile);
        }
      } else {
        changes.additions.push(githubFile);
      }
    }

    // Find deletions (files in staging but not in GitHub)
    for (const stagingFile of stagingFeatures) {
      if (!githubFeatures.includes(stagingFile)) {
        changes.deletions.push(stagingFile);
      }
    }

    return changes;
  }

  async compareFiles(filename: string) {
    try {
      const githubPath = path.join(this.stagingManager.featuresPath, filename);
      const stagingPath = path.join(this.stagingManager.stagingPath, filename);

      const githubContent = await fs.readFile(githubPath, "utf8");
      const stagingContent = await fs.readFile(stagingPath, "utf8");

      return githubContent.trim() !== stagingContent.trim();
    } catch {
      return true;
    }
  }

  async classifyChanges(changes: any) {
    const classified = {
      simple: [...changes.additions, ...changes.deletions] as string[],
      complex: [] as string[],
      autoResolved: [] as string[],
    };

    if (changes.modifications.length > 0) {
      const resolutionResults = await this.conflictResolver.resolveConflicts(
        changes,
        this.stagingManager.stagingPath,
        this.stagingManager.featuresPath
      );

      classified.autoResolved.push(...resolutionResults.autoResolved);
      classified.complex.push(...resolutionResults.requiresManual);
    }

    return classified;
  }
}

describe("Conflict Resolution Integration", () => {
  let conflictResolver: ConflictResolver;
  let gitDiffManager: GitDiffManager;
  let stagingManager: StagingAreaManager;
  let testDir: string;
  let stagingPath: string;
  let featuresPath: string;

  beforeEach(async () => {
    // Create temporary test directories
    testDir = path.join(
      process.cwd(),
      "test-temp",
      `conflict-test-${Date.now()}`
    );
    stagingPath = path.join(testDir, "staging");
    featuresPath = path.join(testDir, "features");

    await fs.mkdir(testDir, { recursive: true });
    await fs.mkdir(stagingPath, { recursive: true });
    await fs.mkdir(featuresPath, { recursive: true });

    // Initialize components
    conflictResolver = new ConflictResolver();
    stagingManager = new StagingAreaManager();
    gitDiffManager = new GitDiffManager(stagingManager, conflictResolver);

    // Override paths for testing
    stagingManager.stagingPath = stagingPath;
    stagingManager.featuresPath = featuresPath;
  });

  afterEach(async () => {
    // Clean up test directories
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (error) {
      console.warn("Failed to clean up test directory:", error.message);
    }
  });

  describe("Whitespace Conflict Resolution", () => {
    it("should auto-resolve whitespace-only differences", async () => {
      // Create files with whitespace differences
      const githubContent = `Feature: Test Feature
  Scenario: Test scenario
    Given something
    When action
    Then result`;

      const stagingContent = `Feature: Test Feature
	Scenario: Test scenario
		Given something
		When action
		Then result`;

      await fs.writeFile(
        path.join(featuresPath, "whitespace.feature"),
        githubContent
      );
      await fs.writeFile(
        path.join(stagingPath, "whitespace.feature"),
        stagingContent
      );

      const changes = {
        modifications: ["whitespace.feature"],
        additions: [],
        deletions: [],
      };

      const result = await conflictResolver.resolveConflicts(
        changes,
        stagingPath,
        featuresPath
      );

      expect(result.autoResolved).toContain("whitespace.feature");
      expect(result.requiresManual).toHaveLength(0);
    });
  });

  describe("Comment-Only Conflict Resolution", () => {
    it("should auto-resolve comment-only differences", async () => {
      const githubContent = `Feature: Test Feature
# Updated comment from GitHub
Scenario: Test scenario
  # Another GitHub comment
  Given something
  When action
  Then result`;

      const stagingContent = `Feature: Test Feature
# Original comment from AssertThat
Scenario: Test scenario
  # Another AssertThat comment
  Given something
  When action
  Then result`;

      await fs.writeFile(
        path.join(featuresPath, "comments.feature"),
        githubContent
      );
      await fs.writeFile(
        path.join(stagingPath, "comments.feature"),
        stagingContent
      );

      const changes = {
        modifications: ["comments.feature"],
        additions: [],
        deletions: [],
      };

      const result = await conflictResolver.resolveConflicts(
        changes,
        stagingPath,
        featuresPath
      );

      expect(result.autoResolved).toContain("comments.feature");
      expect(result.requiresManual).toHaveLength(0);
    });
  });

  describe("Content Conflict Detection", () => {
    it("should detect complex content conflicts", async () => {
      const githubContent = `Feature: Test Feature
Scenario: GitHub scenario
  Given GitHub precondition
  When GitHub action
  Then GitHub result`;

      const stagingContent = `Feature: Test Feature
Scenario: AssertThat scenario
  Given AssertThat precondition
  When AssertThat action
  Then AssertThat result`;

      await fs.writeFile(
        path.join(featuresPath, "content.feature"),
        githubContent
      );
      await fs.writeFile(
        path.join(stagingPath, "content.feature"),
        stagingContent
      );

      const changes = {
        modifications: ["content.feature"],
        additions: [],
        deletions: [],
      };

      const result = await conflictResolver.resolveConflicts(
        changes,
        stagingPath,
        featuresPath
      );

      expect(result.autoResolved).toHaveLength(0);
      expect(result.requiresManual).toContain("content.feature");
    });
  });

  describe("Mixed Conflict Types", () => {
    it("should handle multiple files with different conflict types", async () => {
      // Whitespace-only conflict
      const whitespaceGithub = `Feature: Whitespace\n  Scenario: Test\n    Given something`;
      const whitespaceStaging = `Feature: Whitespace\n\tScenario: Test\n\t\tGiven something`;

      // Comment-only conflict
      const commentGithub = `Feature: Comments\n# GitHub comment\nScenario: Test`;
      const commentStaging = `Feature: Comments\n# AssertThat comment\nScenario: Test`;

      // Content conflict
      const contentGithub = `Feature: Content\nScenario: GitHub version`;
      const contentStaging = `Feature: Content\nScenario: AssertThat version`;

      await fs.writeFile(
        path.join(featuresPath, "whitespace.feature"),
        whitespaceGithub
      );
      await fs.writeFile(
        path.join(stagingPath, "whitespace.feature"),
        whitespaceStaging
      );
      await fs.writeFile(
        path.join(featuresPath, "comments.feature"),
        commentGithub
      );
      await fs.writeFile(
        path.join(stagingPath, "comments.feature"),
        commentStaging
      );
      await fs.writeFile(
        path.join(featuresPath, "content.feature"),
        contentGithub
      );
      await fs.writeFile(
        path.join(stagingPath, "content.feature"),
        contentStaging
      );

      const changes = {
        modifications: [
          "whitespace.feature",
          "comments.feature",
          "content.feature",
        ],
        additions: [],
        deletions: [],
      };

      const result = await conflictResolver.resolveConflicts(
        changes,
        stagingPath,
        featuresPath
      );

      expect(result.autoResolved).toHaveLength(2); // whitespace and comments
      expect(result.requiresManual).toHaveLength(1); // content
      expect(result.requiresManual).toContain("content.feature");
    });
  });

  describe("GitDiffManager Integration", () => {
    it("should integrate conflict resolution with change classification", async () => {
      // Create test files - make simple file have whitespace differences
      const simpleGithub = `Feature: Simple\n  Scenario: Test\n    Given something`;
      const simpleStaging = `Feature: Simple\n\tScenario: Test\n\t\tGiven something`;
      const complexGithub = `Feature: Complex\nScenario: GitHub version`;
      const complexStaging = `Feature: Complex\nScenario: AssertThat version`;

      await fs.writeFile(
        path.join(featuresPath, "simple.feature"),
        simpleGithub
      );
      await fs.writeFile(
        path.join(stagingPath, "simple.feature"),
        simpleStaging
      );
      await fs.writeFile(
        path.join(featuresPath, "complex.feature"),
        complexGithub
      );
      await fs.writeFile(
        path.join(stagingPath, "complex.feature"),
        complexStaging
      );

      // Mock the staging manager methods
      stagingManager.getStagingFeatures = async () => [
        "simple.feature",
        "complex.feature",
      ];
      stagingManager.getGitHubFeatures = async () => [
        "simple.feature",
        "complex.feature",
      ];

      const changes = await gitDiffManager.detectChanges();
      const classified = await gitDiffManager.classifyChanges(changes);

      // Simple file should be auto-resolved due to whitespace-only differences
      expect(classified.autoResolved).toContain("simple.feature");
      expect(classified.complex).toContain("complex.feature");
    });
  });

  describe("Error Handling", () => {
    it("should handle missing files gracefully", async () => {
      const changes = {
        modifications: ["nonexistent.feature"],
        additions: [],
        deletions: [],
      };

      const result = await conflictResolver.resolveConflicts(
        changes,
        stagingPath,
        featuresPath
      );

      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].filename).toBe("nonexistent.feature");
    });

    it("should handle invalid Git operations gracefully", async () => {
      // Create files in a non-Git directory
      const invalidGithub = `Feature: Invalid`;
      const invalidStaging = `Feature: Invalid Different`;

      await fs.writeFile(
        path.join(featuresPath, "invalid.feature"),
        invalidGithub
      );
      await fs.writeFile(
        path.join(stagingPath, "invalid.feature"),
        invalidStaging
      );

      const changes = {
        modifications: ["invalid.feature"],
        additions: [],
        deletions: [],
      };

      // This should not crash, but may not auto-resolve
      const result = await conflictResolver.resolveConflicts(
        changes,
        stagingPath,
        featuresPath
      );

      expect(result).toBeDefined();
      expect(Array.isArray(result.autoResolved)).toBe(true);
      expect(Array.isArray(result.requiresManual)).toBe(true);
      expect(Array.isArray(result.failed)).toBe(true);
    });
  });

  describe("Conflict Marker Creation", () => {
    it("should create proper Git-style conflict markers", async () => {
      const githubContent = `Feature: GitHub Feature
Scenario: GitHub scenario
  Given GitHub condition`;

      const stagingContent = `Feature: AssertThat Feature
Scenario: AssertThat scenario
  Given AssertThat condition`;

      await fs.writeFile(
        path.join(featuresPath, "markers.feature"),
        githubContent
      );
      await fs.writeFile(
        path.join(stagingPath, "markers.feature"),
        stagingContent
      );

      await conflictResolver.createConflictMarkers(
        "markers.feature",
        stagingPath,
        featuresPath
      );

      const resultContent = await fs.readFile(
        path.join(stagingPath, "markers.feature"),
        "utf8"
      );

      expect(resultContent).toContain("<<<<<<< GitHub (incoming changes)");
      expect(resultContent).toContain("=======");
      expect(resultContent).toContain(">>>>>>> AssertThat (current version)");
      expect(resultContent).toContain("GitHub Feature");
      expect(resultContent).toContain("AssertThat Feature");
    });
  });
});
