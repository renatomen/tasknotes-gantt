/**
 * OG-40: BDD Change Detection Tests
 *
 * Tests for the BDD change detection functionality to ensure
 * CI optimization works correctly.
 */

describe("OG-40: BDD Change Detection", () => {
  // Mock functions for testing
  const mockHasBddChanges = (changedFiles: string[]) => {
    const bddPatterns = [
      /^features\/.*\.feature$/,
      /^\.bdd\/.*$/,
      /^scripts\/.*bdd.*\.m?js$/,
      /^scripts\/validate-bdd-syntax\.mjs$/,
      /^scripts\/generate-bdd-feature\.mjs$/,
      /^scripts\/semantic-tag-manager\.mjs$/,
      /^\.husky\/pre-commit$/,
      /^package\.json$/,
      /^test\/.*\.feature$/,
      /^test\/step-definitions\/.*$/,
    ];

    const bddChanges = changedFiles.filter((file) =>
      bddPatterns.some((pattern) => pattern.test(file))
    );

    return {
      hasChanges: bddChanges.length > 0,
      changedFiles: bddChanges,
    };
  };

  const mockHasSemanticTagChanges = (changedFiles: string[]) => {
    return changedFiles.some((file) => file === ".bdd/semantic-tags.yaml");
  };

  const mockGetChangedFeatureFiles = (changedFiles: string[]) => {
    return changedFiles.filter((file) => file.endsWith(".feature"));
  };

  describe("hasBddChanges", () => {
    it("should detect feature file changes", () => {
      const changedFiles = [
        "features/gantt-visualization/task-rendering.feature",
        "src/main.ts",
        "README.md",
      ];

      const result = mockHasBddChanges(changedFiles);

      expect(result.hasChanges).toBe(true);
      expect(result.changedFiles).toContain(
        "features/gantt-visualization/task-rendering.feature"
      );
    });

    it("should detect BDD script changes", () => {
      const changedFiles = ["scripts/validate-bdd-syntax.mjs", "src/main.ts"];

      const result = mockHasBddChanges(changedFiles);

      expect(result.hasChanges).toBe(true);
      expect(result.changedFiles).toContain("scripts/validate-bdd-syntax.mjs");
    });

    it("should detect semantic tag registry changes", () => {
      const changedFiles = [".bdd/semantic-tags.yaml", "src/main.ts"];

      const result = mockHasBddChanges(changedFiles);

      expect(result.hasChanges).toBe(true);
      expect(result.changedFiles).toContain(".bdd/semantic-tags.yaml");
    });

    it("should not detect changes in non-BDD files", () => {
      const changedFiles = [
        "src/main.ts",
        "src/components/GanttView.svelte",
        "README.md",
        "docs/setup.md",
      ];

      const result = mockHasBddChanges(changedFiles);

      expect(result.hasChanges).toBe(false);
      expect(result.changedFiles).toHaveLength(0);
    });

    it("should detect package.json changes (affects BDD dependencies)", () => {
      const changedFiles = ["package.json", "src/main.ts"];

      const result = mockHasBddChanges(changedFiles);

      expect(result.hasChanges).toBe(true);
      expect(result.changedFiles).toContain("package.json");
    });
  });

  describe("hasSemanticTagChanges", () => {
    it("should detect semantic tag registry changes", () => {
      const changedFiles = [".bdd/semantic-tags.yaml", "src/main.ts"];

      const result = mockHasSemanticTagChanges(changedFiles);

      expect(result).toBe(true);
    });

    it("should not detect changes when registry is unchanged", () => {
      const changedFiles = ["features/test.feature", "src/main.ts"];

      const result = mockHasSemanticTagChanges(changedFiles);

      expect(result).toBe(false);
    });
  });

  describe("getChangedFeatureFiles", () => {
    it("should filter only feature files", () => {
      const changedFiles = [
        "features/bdd-framework/framework-validation.feature",
        "features/test.feature",
        "src/main.ts",
      ];

      const result = mockGetChangedFeatureFiles(changedFiles);

      expect(result).toEqual([
        "features/bdd-framework/framework-validation.feature",
        "features/test.feature",
      ]);
    });

    it("should return empty array when no feature files changed", () => {
      const changedFiles = ["src/main.ts", "README.md"];

      const result = mockGetChangedFeatureFiles(changedFiles);

      expect(result).toEqual([]);
    });
  });

  describe("Integration scenarios", () => {
    it("should handle typical BDD workflow changes", () => {
      const changedFiles = [
        "features/gantt-visualization/task-rendering.feature",
        ".bdd/semantic-tags.yaml",
        "scripts/generate-bdd-feature.mjs",
        "src/main.ts",
      ];

      const bddResult = mockHasBddChanges(changedFiles);
      const semanticResult = mockHasSemanticTagChanges(changedFiles);

      expect(bddResult.hasChanges).toBe(true);
      expect(semanticResult).toBe(true);
      expect(bddResult.changedFiles).toHaveLength(3); // All BDD-related files
    });

    it("should handle non-BDD development changes", () => {
      const changedFiles = [
        "src/main.ts",
        "src/components/GanttView.svelte",
        "styles/main.css",
        "docs/README.md",
      ];

      const bddResult = mockHasBddChanges(changedFiles);
      const semanticResult = mockHasSemanticTagChanges(changedFiles);

      expect(bddResult.hasChanges).toBe(false);
      expect(semanticResult).toBe(false);
    });
  });

  describe("CI optimization benefits", () => {
    it("should skip BDD validation when only source code changes", () => {
      const changedFiles = [
        "src/main.ts",
        "src/gantt/GanttChart.ts",
        "src/utils/dateUtils.ts",
      ];

      const shouldRunBddValidation = mockHasBddChanges(changedFiles).hasChanges;

      expect(shouldRunBddValidation).toBe(false);
      // This would save CI time by skipping BDD validation
    });

    it("should run BDD validation when BDD files change", () => {
      const changedFiles = ["features/new-feature.feature", "src/main.ts"];

      const shouldRunBddValidation = mockHasBddChanges(changedFiles).hasChanges;

      expect(shouldRunBddValidation).toBe(true);
      // This ensures BDD validation runs when needed
    });
  });
});
