/**
 * Gherkin Validator - Focused on validation logic only
 * Extracted from oversized GherkinValidator class (343 lines → ~100 lines)
 */

import { syncEvents, SYNC_EVENTS } from "../events/SyncEvents.mjs";
import { cacheManager } from "../cache/CacheManager.mjs";
import { FeatureValidationError } from "../errors/SyncErrors.mjs";
import { GherkinParser } from "./GherkinParser.mjs";

export class GherkinValidator {
  constructor(parser = null) {
    this.parser = parser || new GherkinParser();
  }

  /**
   * Validate a single feature file
   */
  async validateFeatureFile(filePath) {
    try {
      const fs = await import("fs/promises");
      const content = await fs.readFile(filePath, "utf8");
      return await this.validateFeatureContent(content, filePath);
    } catch (error) {
      throw new FeatureValidationError(
        `Failed to read feature file: ${filePath}`,
        filePath,
        [error.message]
      );
    }
  }

  /**
   * Validate feature content
   */
  async validateFeatureContent(content, sourcePath = "unknown") {
    const result = {
      isValid: true,
      errors: [],
      warnings: [],
      metadata: null,
    };

    try {
      // Check cache first
      const fileHash = this.parser.generateContentHash(content);
      const cached = cacheManager.validationCache.getValidation(
        sourcePath,
        fileHash
      );
      if (cached) {
        syncEvents.emit(SYNC_EVENTS.CACHE_HIT, {
          type: "validation",
          sourcePath,
        });
        return cached;
      }

      syncEvents.emit(SYNC_EVENTS.VALIDATION_STARTED, {
        sourcePath,
        type: "validation",
      });

      // Parse the feature content
      const featureData = await this.parser.parseFeatureContent(
        content,
        sourcePath
      );
      result.metadata = featureData;

      // Validate the parsed data
      const validationIssues = this.validateFeatureData(featureData);

      // Categorize issues
      for (const issue of validationIssues) {
        if (issue.type === "error") {
          result.errors.push(issue.message);
          result.isValid = false;
        } else if (issue.type === "warning") {
          result.warnings.push(issue.message);
        }
      }

      // Additional business rule validations
      this.validateBusinessRules(featureData, result);

      // Cache the result
      cacheManager.validationCache.cacheValidation(
        sourcePath,
        fileHash,
        result
      );

      syncEvents.emit(SYNC_EVENTS.VALIDATION_COMPLETED, {
        sourcePath,
        type: "validation",
        isValid: result.isValid,
        errorCount: result.errors.length,
        warningCount: result.warnings.length,
      });

      return result;
    } catch (error) {
      result.isValid = false;
      result.errors.push(error.message);

      syncEvents.emit(SYNC_EVENTS.VALIDATION_FAILED, {
        sourcePath,
        type: "validation",
        error: error.message,
      });

      return result;
    }
  }

  /**
   * Validate feature data structure
   */
  validateFeatureData(featureData) {
    const issues = [];

    // Use parser's AST validation
    issues.push(...this.parser.validateASTStructure(featureData));

    // Additional validation rules
    this.validateFeatureNaming(featureData, issues);
    this.validateScenarios(featureData, issues);
    this.validateTags(featureData, issues);
    this.validateSteps(featureData, issues);

    return issues;
  }

  /**
   * Validate feature naming conventions
   */
  validateFeatureNaming(featureData, issues) {
    const name = featureData.name.trim();

    if (name.length < 5) {
      issues.push({
        type: "warning",
        message:
          "Feature name should be more descriptive (at least 5 characters)",
      });
    }

    if (name.toLowerCase().includes("test")) {
      issues.push({
        type: "warning",
        message: "Feature name should describe business value, not testing",
      });
    }
  }

  /**
   * Validate scenarios
   */
  validateScenarios(featureData, issues) {
    const scenarioNames = new Set();

    featureData.scenarios.forEach((scenario, _index) => {
      // Check for duplicate scenario names
      if (scenarioNames.has(scenario.name)) {
        issues.push({
          type: "warning",
          message: `Duplicate scenario name: "${scenario.name}"`,
        });
      }
      scenarioNames.add(scenario.name);

      // Validate scenario structure
      if (scenario.type === "outline" && scenario.examples.length === 0) {
        issues.push({
          type: "error",
          message: `Scenario Outline "${scenario.name}" must have examples`,
        });
      }

      // Check for overly long scenarios
      if (scenario.steps.length > 10) {
        issues.push({
          type: "warning",
          message: `Scenario "${scenario.name}" has many steps (${scenario.steps.length}). Consider breaking it down.`,
        });
      }
    });
  }

  /**
   * Validate tags
   */
  validateTags(featureData, issues) {
    const allTags = [
      ...featureData.tags,
      ...featureData.scenarios.flatMap((s) => s.tags),
    ];

    // Check for malformed tags
    allTags.forEach((tag) => {
      if (!tag.startsWith("@")) {
        issues.push({
          type: "error",
          message: `Invalid tag format: "${tag}". Tags must start with @`,
        });
      }

      if (tag.includes(" ")) {
        issues.push({
          type: "warning",
          message: `Tag "${tag}" contains spaces. Consider using hyphens or underscores.`,
        });
      }
    });
  }

  /**
   * Validate steps
   */
  validateSteps(featureData, issues) {
    featureData.scenarios.forEach((scenario) => {
      let hasGiven = false;
      let hasWhen = false;
      let hasThen = false;

      scenario.steps.forEach((step) => {
        const keyword = step.keyword?.toLowerCase();

        if (keyword?.includes("given")) hasGiven = true;
        if (keyword?.includes("when")) hasWhen = true;
        if (keyword?.includes("then")) hasThen = true;

        // Check for overly long step text
        if (step.text.length > 100) {
          issues.push({
            type: "warning",
            message: `Step text is very long (${step.text.length} chars). Consider breaking it down.`,
          });
        }
      });

      // Check for complete Given-When-Then structure
      if (scenario.steps.length > 0 && (!hasGiven || !hasWhen || !hasThen)) {
        issues.push({
          type: "warning",
          message: `Scenario "${scenario.name}" should follow Given-When-Then structure`,
        });
      }
    });
  }

  /**
   * Validate business rules
   */
  validateBusinessRules(featureData, result) {
    // Check for critical tags
    const criticalTags = ["@critical", "@smoke", "@regression"];
    const hasCriticalTag = featureData.scenarios.some((scenario) =>
      scenario.tags.some((tag) => criticalTags.includes(tag))
    );

    if (!hasCriticalTag && featureData.scenarios.length > 5) {
      result.warnings.push(
        "Large feature without critical scenarios. Consider adding @critical tags."
      );
    }

    // Check for missing descriptions
    if (!featureData.description.trim()) {
      result.warnings.push(
        "Feature should have a description explaining its business value."
      );
    }
  }

  /**
   * Get validation statistics
   */
  getValidationStats() {
    return cacheManager.validationCache.getStats();
  }

  /**
   * Clear validation cache
   */
  clearCache() {
    cacheManager.validationCache.clear();
  }
}
