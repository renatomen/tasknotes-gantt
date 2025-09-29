#!/usr/bin/env node

/**
 * GitHub to AssertThat BDD Sync Script
 * Implements staging folder approach for bidirectional sync
 */

import fs from "fs/promises";
import path from "path";
import { execSync } from "child_process";
import inquirer from "inquirer";

// Configuration
const CONFIG = {
  FEATURES_DIR: "features",
  STAGING_DIR: "featureSyncStage",
  SYNC_BRANCH_PREFIX: "sync/assertthat",
  COMMIT_PREFIX: "chore/sync",
  ASSERTTHAT_PROJECT_ID: process.env.ASSERTTHAT_PROJECT_ID,
  ASSERTTHAT_ACCESS_KEY: process.env.ASSERTTHAT_ACCESS_KEY,
  ASSERTTHAT_SECRET_KEY: process.env.ASSERTTHAT_SECRET_KEY,
  ASSERTTHAT_TOKEN: process.env.ASSERTTHAT_TOKEN,
  JIRA_SERVER_URL: process.env.JIRA_SERVER_URL,
};

/**
 * Staging Area Manager
 * Handles creation, management, and cleanup of the featureSyncStage directory
 */
class StagingAreaManager {
  constructor() {
    this.stagingPath = path.resolve(CONFIG.STAGING_DIR);
    this.featuresPath = path.resolve(CONFIG.FEATURES_DIR);
  }

  /**
   * Creates and initializes the staging directory
   */
  async createStagingArea() {
    try {
      console.log("📁 Creating staging area...");

      // Remove existing staging area if it exists
      await this.cleanStagingArea();

      // Create new staging directory
      await fs.mkdir(this.stagingPath, { recursive: true });

      console.log(`✅ Staging area created at: ${this.stagingPath}`);
      return true;
    } catch (error) {
      console.error("❌ Failed to create staging area:", error.message);
      throw error;
    }
  }

  /**
   * Downloads features from AssertThat to staging area
   */
  async downloadAssertThatFeatures() {
    try {
      console.log("⬇️ Downloading features from AssertThat...");

      // TODO: Implement AssertThat API download
      // For now, create a placeholder structure to test the staging system

      // Create subdirectories to match GitHub structure
      const testDirs = ["bases-integration", "bdd-framework", "data-sources"];
      for (const dir of testDirs) {
        await fs.mkdir(path.join(this.stagingPath, dir), { recursive: true });
      }

      // Create some test features in AssertThat format
      const testFeatures = {
        "test-feature.feature": `Feature: Test Feature from AssertThat
  As a user
  I want to test the sync system
  So that I can verify it works

  Scenario: Test scenario
    Given I have a test scenario
    When I run the sync
    Then it should work correctly`,

        "bases-integration/data-mapping.feature": `Feature: Data Mapping (AssertThat Version)
  As a developer
  I want to map data from AssertThat
  So that I can sync with GitHub

  Scenario: Map data correctly
    Given I have AssertThat data
    When I map it to GitHub format
    Then it should be correctly formatted`,
      };

      for (const [filePath, content] of Object.entries(testFeatures)) {
        await fs.writeFile(path.join(this.stagingPath, filePath), content);
      }

      console.log("✅ Features downloaded to staging area");
      return true;
    } catch (error) {
      console.error(
        "❌ Failed to download AssertThat features:",
        error.message
      );
      throw error;
    }
  }

  /**
   * Cleans up the staging area
   */
  async cleanStagingArea() {
    try {
      await fs.rm(this.stagingPath, { recursive: true, force: true });
      console.log("🧹 Staging area cleaned");
    } catch (error) {
      // Ignore errors if directory doesn't exist
      if (error.code !== "ENOENT") {
        console.warn(
          "⚠️ Warning: Could not clean staging area:",
          error.message
        );
      }
    }
  }

  /**
   * Gets list of feature files in staging area (recursively)
   */
  async getStagingFeatures() {
    try {
      const features = [];
      await this._scanDirectory(this.stagingPath, features);
      return features;
    } catch (error) {
      console.error("❌ Failed to read staging area:", error.message);
      return [];
    }
  }

  /**
   * Gets list of feature files in main features directory (recursively)
   */
  async getGitHubFeatures() {
    try {
      const features = [];
      await this._scanDirectory(this.featuresPath, features);
      return features;
    } catch (error) {
      console.error("❌ Failed to read features directory:", error.message);
      return [];
    }
  }

  /**
   * Recursively scans directory for .feature files
   */
  async _scanDirectory(dirPath, features, relativePath = "") {
    try {
      const items = await fs.readdir(dirPath, { withFileTypes: true });

      for (const item of items) {
        const fullPath = path.join(dirPath, item.name);
        const relPath = relativePath
          ? path.join(relativePath, item.name)
          : item.name;

        if (item.isDirectory()) {
          await this._scanDirectory(fullPath, features, relPath);
        } else if (item.name.endsWith(".feature")) {
          features.push(relPath);
        }
      }
    } catch (error) {
      console.warn(
        `⚠️ Warning: Could not scan directory ${dirPath}:`,
        error.message
      );
    }
  }
}

/**
 * Gherkin Parser and Validator
 * Handles parsing and validation of .feature files using @cucumber/gherkin
 */
class GherkinValidator {
  constructor() {
    // Initialize the official Cucumber Gherkin parser components
    this.uuidFn = () => Math.random().toString(36).substring(2, 15);
  }

  /**
   * Validates a feature file's Gherkin syntax
   */
  async validateFeatureFile(filePath) {
    try {
      const content = await fs.readFile(filePath, "utf8");
      return this.validateFeatureContent(content, filePath);
    } catch (error) {
      return {
        isValid: false,
        errors: [`Failed to read file: ${error.message}`],
        warnings: [],
        metadata: null,
      };
    }
  }

  /**
   * Validates Gherkin content string using @cucumber/gherkin AST parser
   */
  async validateFeatureContent(content, sourcePath = "unknown") {
    const result = {
      isValid: true,
      errors: [],
      warnings: [],
      metadata: null,
    };

    try {
      // Import Gherkin components dynamically
      const gherkin = await import("@cucumber/gherkin");
      const { generateMessages, makeSourceEnvelope } = gherkin;

      // Create source envelope and parse the feature file
      const sourceEnvelope = makeSourceEnvelope(content, sourcePath);
      const messages = generateMessages(
        sourceEnvelope.source.data,
        sourceEnvelope.source.uri,
        sourceEnvelope.source.mediaType,
        {
          includeSource: false,
          includeGherkinDocument: true,
          newId: this.uuidFn,
        }
      );

      // Find the GherkinDocument message
      const gherkinDocumentMessage = messages.find(
        (message) => message.gherkinDocument
      );
      const gherkinDocument = gherkinDocumentMessage?.gherkinDocument;

      // Extract feature information from AST
      if (gherkinDocument && gherkinDocument.feature) {
        result.metadata = this.extractFeatureDataFromAST(
          gherkinDocument.feature
        );

        // Validate feature structure
        this.validateFeatureStructure(gherkinDocument.feature, result);
      } else {
        result.isValid = false;
        result.errors.push("No valid feature found in file");
      }
    } catch (error) {
      result.isValid = false;
      result.errors.push(`Gherkin parse error: ${error.message}`);
    }

    return result;
  }

  /**
   * Extracts feature data from Gherkin AST
   */
  extractFeatureDataFromAST(feature) {
    const metadata = {
      name: feature.name || "",
      description: feature.description || "",
      tags: feature.tags ? feature.tags.map((tag) => tag.name) : [],
      scenarios: [],
      language: feature.language || "en",
    };

    // Extract scenarios from AST
    if (feature.children) {
      feature.children.forEach((child) => {
        if (child.scenario) {
          const scenario = child.scenario;
          metadata.scenarios.push({
            name: scenario.name || "",
            tags: scenario.tags ? scenario.tags.map((tag) => tag.name) : [],
            steps: scenario.steps ? scenario.steps.length : 0,
            type: "scenario",
          });
        } else if (child.rule) {
          // Handle rules containing scenarios
          const rule = child.rule;
          if (rule.children) {
            rule.children.forEach((ruleChild) => {
              if (ruleChild.scenario) {
                const scenario = ruleChild.scenario;
                metadata.scenarios.push({
                  name: scenario.name || "",
                  tags: scenario.tags
                    ? scenario.tags.map((tag) => tag.name)
                    : [],
                  steps: scenario.steps ? scenario.steps.length : 0,
                  type: "scenario",
                  rule: rule.name,
                });
              }
            });
          }
        }
      });
    }

    return metadata;
  }

  /**
   * Validates feature structure from AST
   */
  validateFeatureStructure(feature, result) {
    // Check if feature has a name
    if (!feature.name || feature.name.trim() === "") {
      result.warnings.push("Feature should have a descriptive name");
    }

    // Check for scenarios
    let scenarioCount = 0;
    if (feature.children) {
      feature.children.forEach((child) => {
        if (child.scenario) {
          scenarioCount++;
          this.validateScenarioFromAST(child.scenario, result);
        } else if (child.rule && child.rule.children) {
          child.rule.children.forEach((ruleChild) => {
            if (ruleChild.scenario) {
              scenarioCount++;
              this.validateScenarioFromAST(ruleChild.scenario, result);
            }
          });
        }
      });
    }

    if (scenarioCount === 0) {
      result.warnings.push("Feature should contain at least one scenario");
    }
  }

  /**
   * Validates a scenario from AST
   */
  validateScenarioFromAST(scenario, result) {
    // Check if scenario has a name
    if (!scenario.name || scenario.name.trim() === "") {
      result.warnings.push("Scenario should have a descriptive name");
    }

    // Check if scenario has steps
    if (!scenario.steps || scenario.steps.length === 0) {
      result.warnings.push(`Scenario "${scenario.name}" has no steps`);
    } else {
      // Validate step structure
      const stepKeywords = scenario.steps.map((step) => step.keyword.trim());
      this.validateStepFlow(stepKeywords, scenario.name, result);
    }
  }

  /**
   * Validates the Given-When-Then flow in steps
   */
  validateStepFlow(stepKeywords, scenarioName, result) {
    const hasGiven = stepKeywords.some((keyword) =>
      keyword.startsWith("Given")
    );
    const hasWhen = stepKeywords.some((keyword) => keyword.startsWith("When"));
    const hasThen = stepKeywords.some((keyword) => keyword.startsWith("Then"));

    if (!hasGiven) {
      result.warnings.push(
        `Scenario "${scenarioName}" should have at least one Given step`
      );
    }
    if (!hasWhen) {
      result.warnings.push(
        `Scenario "${scenarioName}" should have at least one When step`
      );
    }
    if (!hasThen) {
      result.warnings.push(
        `Scenario "${scenarioName}" should have at least one Then step`
      );
    }
  }

  /**
   * Transforms parsed Gherkin data into AssertThat API-compatible format
   */
  transformToAssertThatFormat(metadata, filePath) {
    if (!metadata) {
      return null;
    }

    const assertThatFeature = {
      name: metadata.name,
      description: metadata.description,
      tags: metadata.tags,
      scenarios: metadata.scenarios.map((scenario) => ({
        name: scenario.name,
        tags: scenario.tags,
        steps: [], // Steps would be extracted from AST if needed
        type: scenario.type || "scenario",
        rule: scenario.rule || null,
      })),
      source: {
        file: filePath,
        type: "github",
      },
    };

    return assertThatFeature;
  }

  /**
   * Processes multiple feature files efficiently (batch processing)
   */
  async processMultipleFiles(filePaths) {
    const results = [];

    for (const filePath of filePaths) {
      try {
        const validationResult = await this.validateFeatureFile(filePath);

        if (validationResult.isValid && validationResult.metadata) {
          const transformedData = this.transformToAssertThatFormat(
            validationResult.metadata,
            filePath
          );

          results.push({
            filePath,
            valid: true,
            data: transformedData,
            errors: validationResult.errors,
            warnings: validationResult.warnings,
          });
        } else {
          results.push({
            filePath,
            valid: false,
            data: null,
            errors: validationResult.errors,
            warnings: validationResult.warnings,
          });
        }
      } catch (error) {
        results.push({
          filePath,
          valid: false,
          data: null,
          errors: [`Processing error: ${error.message}`],
          warnings: [],
        });
      }
    }

    return results;
  }

  /**
   * Provides clear error messages for invalid or malformed feature files
   */
  formatErrorReport(validationResult) {
    const report = {
      file: validationResult.filePath || "unknown",
      status: validationResult.isValid ? "VALID" : "INVALID",
      summary: "",
      details: [],
    };

    if (validationResult.errors.length > 0) {
      report.summary = `${validationResult.errors.length} error(s) found`;
      report.details.push(
        ...validationResult.errors.map((error) => ({
          type: "ERROR",
          message: error,
        }))
      );
    }

    if (validationResult.warnings.length > 0) {
      if (report.summary) {
        report.summary += `, ${validationResult.warnings.length} warning(s)`;
      } else {
        report.summary = `${validationResult.warnings.length} warning(s) found`;
      }
      report.details.push(
        ...validationResult.warnings.map((warning) => ({
          type: "WARNING",
          message: warning,
        }))
      );
    }

    if (
      validationResult.isValid &&
      validationResult.errors.length === 0 &&
      validationResult.warnings.length === 0
    ) {
      report.summary = "Feature file is valid";
    }

    return report;
  }

  /**
   * Validates multiple feature files and returns summary (batch processing)
   */
  async validateFeatureFiles(filePaths) {
    const results = {
      totalFiles: filePaths.length,
      validFiles: 0,
      invalidFiles: 0,
      totalErrors: 0,
      totalWarnings: 0,
      details: [],
    };

    // Use batch processing for efficiency
    const batchResults = await this.processMultipleFiles(filePaths);

    for (const result of batchResults) {
      const formattedReport = this.formatErrorReport({
        filePath: result.filePath,
        isValid: result.valid,
        errors: result.errors,
        warnings: result.warnings,
      });

      results.details.push({
        file: result.filePath,
        isValid: result.valid,
        errors: result.errors,
        warnings: result.warnings,
        metadata: result.data,
        report: formattedReport,
      });

      if (result.valid) {
        results.validFiles++;
      } else {
        results.invalidFiles++;
      }

      results.totalErrors += result.errors.length;
      results.totalWarnings += result.warnings.length;
    }

    return results;
  }
}

/**
 * Conflict Resolver
 * Handles conflict detection and resolution using Git's built-in functionality
 */
class ConflictResolver {
  constructor(gitExecutor = execSync, fileSystem = fs) {
    this.gitExecutor = gitExecutor;
    this.fs = fileSystem;
  }

  /**
   * Resolves conflicts for a list of changed files
   */
  async resolveConflicts(changes, stagingPath, featuresPath) {
    const results = {
      autoResolved: [],
      requiresManual: [],
      failed: [],
    };

    console.log("\n🔧 Starting conflict resolution...");

    // Process modifications (files that exist in both places but differ)
    for (const filename of changes.modifications) {
      try {
        const resolution = await this.resolveFileConflict(
          filename,
          stagingPath,
          featuresPath
        );

        if (resolution.autoResolved) {
          results.autoResolved.push(filename);
          console.log(`✅ Auto-resolved: ${filename} (${resolution.strategy})`);
        } else {
          results.requiresManual.push(filename);
          console.log(`⚠️ Manual resolution required: ${filename}`);
        }
      } catch (error) {
        results.failed.push({ filename, error: error.message });
        console.error(`❌ Failed to resolve ${filename}: ${error.message}`);
      }
    }

    return results;
  }

  /**
   * Attempts to resolve conflicts for a single file using Git strategies
   */
  async resolveFileConflict(filename, stagingPath, featuresPath) {
    const githubFile = path.join(featuresPath, filename);
    const stagingFile = path.join(stagingPath, filename);
    const tempFile = path.join(stagingPath, `${filename}.temp`);

    // Try auto-resolution strategies in order of preference
    const strategies = [
      { name: "ignore-space-change", flag: "--ignore-space-change" },
      { name: "ignore-all-space", flag: "--ignore-all-space" },
      { name: "ignore-blank-lines", flag: "--ignore-blank-lines" },
    ];

    for (const strategy of strategies) {
      try {
        // Use git merge-file for 3-way merge with strategy
        const mergeResult = await this.attemptGitMerge(
          stagingFile,
          githubFile,
          tempFile,
          strategy.flag
        );

        if (mergeResult.success) {
          // Copy resolved content back to staging file
          await this.fs.copyFile(tempFile, stagingFile);
          await this.fs.unlink(tempFile);

          return { autoResolved: true, strategy: strategy.name };
        }
      } catch (error) {
        // Strategy failed, try next one
        continue;
      }
    }

    // If auto-resolution failed, check if it's a simple conflict type
    const conflictType = await this.analyzeConflictType(
      githubFile,
      stagingFile
    );

    if (conflictType.isSimple) {
      return { autoResolved: true, strategy: conflictType.reason };
    }

    // Complex conflict - requires manual resolution
    return { autoResolved: false, conflictType };
  }

  /**
   * Attempts Git merge using merge-file command
   */
  async attemptGitMerge(baseFile, theirFile, outputFile, strategy = "") {
    try {
      // Create a temporary "original" file for 3-way merge
      // Since we don't have a true common ancestor, use the staging file as base
      const originalFile = `${baseFile}.orig`;
      await this.fs.copyFile(baseFile, originalFile);

      const command = `git merge-file ${strategy} -p "${baseFile}" "${originalFile}" "${theirFile}"`;

      const mergedContent = this.gitExecutor(command, {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      });

      // Write merged content to output file
      await this.fs.writeFile(outputFile, mergedContent);

      // Clean up temporary file
      await this.fs.unlink(originalFile);

      // Check if merge was successful (no conflict markers)
      const hasConflicts = await this.hasConflictMarkers(outputFile);

      return { success: !hasConflicts, content: mergedContent };
    } catch (error) {
      // Git merge-file returns non-zero exit code for conflicts
      // This is expected behavior, not necessarily an error
      if (error.stdout) {
        await this.fs.writeFile(outputFile, error.stdout);
        const hasConflicts = await this.hasConflictMarkers(outputFile);
        return { success: !hasConflicts, content: error.stdout };
      }

      throw new Error(`Git merge failed: ${error.message}`);
    }
  }

  /**
   * Checks if a file contains Git conflict markers
   */
  async hasConflictMarkers(filePath) {
    try {
      const content = await this.fs.readFile(filePath, "utf8");
      return (
        content.includes("<<<<<<<") ||
        content.includes("=======") ||
        content.includes(">>>>>>>")
      );
    } catch (error) {
      return true; // Assume conflicts if we can't read the file
    }
  }

  /**
   * Analyzes the type of conflict to determine if it's simple enough for auto-resolution
   */
  async analyzeConflictType(githubFile, stagingFile) {
    try {
      // Use git diff to analyze the differences
      const diffCommand = `git diff --no-index --ignore-space-change "${stagingFile}" "${githubFile}"`;

      try {
        this.gitExecutor(diffCommand, { encoding: "utf8" });
        // No differences when ignoring space changes - it's a whitespace-only conflict
        return { isSimple: true, reason: "whitespace-only" };
      } catch (error) {
        // Files still differ, check for comment-only changes
        if (await this.isCommentOnlyChange(error.stdout || "")) {
          return { isSimple: true, reason: "comments-only" };
        }
      }

      return { isSimple: false, reason: "content-changes" };
    } catch (error) {
      return { isSimple: false, reason: "analysis-failed" };
    }
  }

  /**
   * Determines if changes are only in comments (Gherkin # comments)
   */
  async isCommentOnlyChange(diffOutput) {
    if (!diffOutput) return false;

    const lines = diffOutput.split("\n");
    const changeLines = lines.filter(
      (line) => line.startsWith("+") || line.startsWith("-")
    );

    // Remove diff markers and check if all changes are comments
    const contentChanges = changeLines.filter((line) => {
      const content = line.substring(1).trim();
      return content && !content.startsWith("#");
    });

    return contentChanges.length === 0;
  }

  /**
   * Handles interactive resolution for complex conflicts
   */
  async promptUserResolution(filename, stagingPath, featuresPath) {
    const githubFile = path.join(featuresPath, filename);
    const stagingFile = path.join(stagingPath, filename);

    console.log(`\n🔍 Manual resolution required for: ${filename}`);

    // Show diff to help user understand the conflict
    await this.showDetailedDiff(stagingFile, githubFile);

    const choices = [
      { name: "Use GitHub version (newer)", value: "github" },
      { name: "Use AssertThat version (current)", value: "assertthat" },
      { name: "Create conflict markers for manual editing", value: "markers" },
      { name: "Skip this file for now", value: "skip" },
      { name: "Show diff again", value: "diff" },
    ];

    let resolution;
    do {
      const answer = await inquirer.prompt([
        {
          type: "list",
          name: "choice",
          message: `How would you like to resolve the conflict in ${filename}?`,
          choices,
        },
      ]);

      resolution = answer.choice;

      if (resolution === "diff") {
        await this.showDetailedDiff(stagingFile, githubFile);
        resolution = null; // Continue the loop
      }
    } while (!resolution);

    return await this.applyResolution(
      filename,
      resolution,
      stagingPath,
      featuresPath
    );
  }

  /**
   * Shows detailed diff between two files
   */
  async showDetailedDiff(file1, file2) {
    try {
      console.log("\n📋 Detailed diff:");
      console.log("─".repeat(60));

      const diffCommand = `git diff --no-index --color=never "${file1}" "${file2}"`;

      try {
        const diffOutput = this.gitExecutor(diffCommand, { encoding: "utf8" });
        console.log(diffOutput);
      } catch (error) {
        // git diff returns non-zero exit code when files differ
        if (error.stdout) {
          console.log(error.stdout);
        } else {
          console.log("Files are different but diff could not be generated");
        }
      }

      console.log("─".repeat(60));
    } catch (error) {
      console.error(`❌ Failed to show diff: ${error.message}`);
    }
  }

  /**
   * Applies the user's resolution choice
   */
  async applyResolution(filename, choice, stagingPath, featuresPath) {
    const githubFile = path.join(featuresPath, filename);
    const stagingFile = path.join(stagingPath, filename);

    try {
      switch (choice) {
        case "github":
          await this.fs.copyFile(githubFile, stagingFile);
          console.log(`✅ Applied GitHub version for ${filename}`);
          return { resolved: true, method: "github-version" };

        case "assertthat":
          // Keep the current staging file (AssertThat version)
          console.log(`✅ Kept AssertThat version for ${filename}`);
          return { resolved: true, method: "assertthat-version" };

        case "markers":
          await this.createConflictMarkers(filename, stagingPath, featuresPath);
          console.log(
            `✅ Created conflict markers in ${filename} for manual editing`
          );
          return { resolved: true, method: "conflict-markers" };

        case "skip":
          console.log(`⏭️ Skipped ${filename} - will need resolution later`);
          return { resolved: false, method: "skipped" };

        default:
          throw new Error(`Unknown resolution choice: ${choice}`);
      }
    } catch (error) {
      console.error(
        `❌ Failed to apply resolution for ${filename}: ${error.message}`
      );
      return { resolved: false, method: "failed", error: error.message };
    }
  }

  /**
   * Creates Git-style conflict markers in a file
   */
  async createConflictMarkers(filename, stagingPath, featuresPath) {
    const githubFile = path.join(featuresPath, filename);
    const stagingFile = path.join(stagingPath, filename);

    try {
      const githubContent = await this.fs.readFile(githubFile, "utf8");
      const stagingContent = await this.fs.readFile(stagingFile, "utf8");

      const conflictContent = [
        "<<<<<<< GitHub (incoming changes)",
        githubContent.trim(),
        "=======",
        stagingContent.trim(),
        ">>>>>>> AssertThat (current version)",
      ].join("\n");

      await this.fs.writeFile(stagingFile, conflictContent);
    } catch (error) {
      throw new Error(`Failed to create conflict markers: ${error.message}`);
    }
  }
}

/**
 * Git Diff Manager
 * Handles git diff operations and change detection
 */
class GitDiffManager {
  constructor(stagingManager, conflictResolver = null) {
    this.stagingManager = stagingManager;
    this.conflictResolver = conflictResolver || new ConflictResolver();
  }

  /**
   * Detects changes between GitHub features and AssertThat staging area
   */
  async detectChanges() {
    try {
      console.log("🔍 Detecting changes between GitHub and AssertThat...");

      const stagingFeatures = await this.stagingManager.getStagingFeatures();
      const githubFeatures = await this.stagingManager.getGitHubFeatures();

      const changes = {
        additions: [], // Files in GitHub but not in AssertThat
        modifications: [], // Files that exist in both but differ
        deletions: [], // Files in AssertThat but not in GitHub
        conflicts: [], // Files that have been modified in both places
      };

      // Check for additions and modifications
      for (const githubFile of githubFeatures) {
        if (!stagingFeatures.includes(githubFile)) {
          changes.additions.push(githubFile);
        } else {
          // File exists in both, check if they differ
          const isDifferent = await this.compareFiles(githubFile);
          if (isDifferent) {
            changes.modifications.push(githubFile);
          }
        }
      }

      // Check for deletions
      for (const stagingFile of stagingFeatures) {
        if (!githubFeatures.includes(stagingFile)) {
          changes.deletions.push(stagingFile);
        }
      }

      console.log("📊 Change detection results:");
      console.log(`  Additions: ${changes.additions.length}`);
      console.log(`  Modifications: ${changes.modifications.length}`);
      console.log(`  Deletions: ${changes.deletions.length}`);

      return changes;
    } catch (error) {
      console.error("❌ Failed to detect changes:", error.message);
      throw error;
    }
  }

  /**
   * Compares a feature file between GitHub and staging area
   */
  async compareFiles(filename) {
    try {
      const githubPath = path.join(this.stagingManager.featuresPath, filename);
      const stagingPath = path.join(this.stagingManager.stagingPath, filename);

      const githubContent = await fs.readFile(githubPath, "utf8");
      const stagingContent = await fs.readFile(stagingPath, "utf8");

      return githubContent.trim() !== stagingContent.trim();
    } catch (error) {
      console.error(`❌ Failed to compare file ${filename}:`, error.message);
      return true; // Assume different if we can't compare
    }
  }

  /**
   * Uses git diff to show differences between files
   */
  async showDiff(filename) {
    try {
      const githubPath = path.join(CONFIG.FEATURES_DIR, filename);
      const stagingPath = path.join(CONFIG.STAGING_DIR, filename);

      console.log(`\n📋 Diff for ${filename}:`);
      console.log("─".repeat(50));

      try {
        const diffOutput = execSync(
          `git diff --no-index --color=never "${stagingPath}" "${githubPath}"`,
          { encoding: "utf8" }
        );
        console.log(diffOutput);
      } catch (error) {
        // git diff returns non-zero exit code when files differ
        if (error.stdout) {
          console.log(error.stdout);
        } else {
          console.log("Files are different but diff could not be generated");
        }
      }

      console.log("─".repeat(50));
    } catch (error) {
      console.error(`❌ Failed to show diff for ${filename}:`, error.message);
    }
  }

  /**
   * Classifies changes as simple or complex using ConflictResolver
   */
  async classifyChanges(changes) {
    const classified = {
      simple: [], // Auto-resolvable changes
      complex: [], // Require manual resolution
      autoResolved: [], // Successfully auto-resolved
    };

    console.log("\n🔍 Classifying changes for conflict resolution...");

    // Additions and deletions are generally straightforward
    classified.simple.push(...changes.additions);
    classified.simple.push(...changes.deletions);

    // Use ConflictResolver to analyze modifications
    if (changes.modifications.length > 0) {
      try {
        const resolutionResults = await this.conflictResolver.resolveConflicts(
          changes,
          this.stagingManager.stagingPath,
          this.stagingManager.featuresPath
        );

        classified.autoResolved.push(...resolutionResults.autoResolved);
        classified.complex.push(...resolutionResults.requiresManual);

        // Log failed resolutions as complex
        resolutionResults.failed.forEach((failure) => {
          classified.complex.push(failure.filename);
          console.warn(
            `⚠️ Resolution failed for ${failure.filename}: ${failure.error}`
          );
        });
      } catch (error) {
        console.error("❌ Error during conflict resolution:", error.message);
        // Fallback: treat all modifications as complex
        classified.complex.push(...changes.modifications);
      }
    }

    // Summary
    console.log(`📊 Classification results:`);
    console.log(`  ✅ Simple: ${classified.simple.length} files`);
    console.log(`  🔧 Auto-resolved: ${classified.autoResolved.length} files`);
    console.log(`  ⚠️ Complex: ${classified.complex.length} files`);

    return classified;
  }
}

/**
 * Main sync orchestrator
 */
class SyncOrchestrator {
  constructor() {
    this.stagingManager = new StagingAreaManager();
    this.conflictResolver = new ConflictResolver();
    this.diffManager = new GitDiffManager(
      this.stagingManager,
      this.conflictResolver
    );
    this.gherkinValidator = new GherkinValidator();
  }

  /**
   * Validates configuration and prerequisites
   */
  validateConfig() {
    console.log("🔧 Debug: Validating configuration...");

    // Log all environment variables for debugging
    const envVars = [
      "ASSERTTHAT_PROJECT_ID",
      "ASSERTTHAT_ACCESS_KEY",
      "ASSERTTHAT_SECRET_KEY",
      "ASSERTTHAT_TOKEN",
      "JIRA_SERVER_URL",
    ];

    envVars.forEach((varName) => {
      const value = CONFIG[varName];
      console.log(
        `🔧 Debug: CONFIG.${varName}:`,
        value ? "[SET]" : "[NOT SET]"
      );
    });

    // Validate required environment variables
    const missingVars = [];

    if (!CONFIG.ASSERTTHAT_PROJECT_ID) {
      missingVars.push("ASSERTTHAT_PROJECT_ID");
    }

    // Either access/secret key pair OR token is required
    const hasAccessKeyPair =
      CONFIG.ASSERTTHAT_ACCESS_KEY && CONFIG.ASSERTTHAT_SECRET_KEY;
    const hasToken = CONFIG.ASSERTTHAT_TOKEN;

    if (!hasAccessKeyPair && !hasToken) {
      missingVars.push(
        "ASSERTTHAT_ACCESS_KEY & ASSERTTHAT_SECRET_KEY (or ASSERTTHAT_TOKEN)"
      );
    }

    // For production mode, require all variables
    if (process.env.NODE_ENV === "production" && missingVars.length > 0) {
      throw new Error(
        `Missing required environment variables: ${missingVars.join(", ")}`
      );
    }

    // For development/testing, allow demo mode with warnings
    if (missingVars.length > 0) {
      console.log("⚠️ Warning: Missing environment variables, using demo mode");
      console.log("⚠️ Missing:", missingVars.join(", "));

      // Set demo values
      if (!CONFIG.ASSERTTHAT_PROJECT_ID) {
        CONFIG.ASSERTTHAT_PROJECT_ID = "DEMO";
      }
      if (!hasAccessKeyPair && !hasToken) {
        CONFIG.ASSERTTHAT_ACCESS_KEY = "DEMO";
        CONFIG.ASSERTTHAT_SECRET_KEY = "DEMO";
      }
    }
  }

  /**
   * Validates feature files involved in the sync
   */
  async validateFeatureFiles(changes) {
    try {
      console.log("🔍 Validating feature files...");

      // Collect all files that need validation
      const filesToValidate = [...changes.additions, ...changes.modifications];

      if (filesToValidate.length === 0) {
        console.log("✅ No files to validate");
        return;
      }

      // Validate GitHub features
      console.log("📝 Validating GitHub features...");
      const githubFiles = filesToValidate.map((file) =>
        path.join(this.stagingManager.featuresPath, file)
      );
      const githubValidation =
        await this.gherkinValidator.validateFeatureFiles(githubFiles);

      // Validate staging features (AssertThat)
      console.log("📝 Validating AssertThat features...");
      const stagingFiles = filesToValidate
        .filter((file) => !changes.additions.includes(file)) // Only files that exist in staging
        .map((file) => path.join(this.stagingManager.stagingPath, file));
      const stagingValidation =
        await this.gherkinValidator.validateFeatureFiles(stagingFiles);

      // Report validation results
      this.reportValidationResults("GitHub", githubValidation);
      this.reportValidationResults("AssertThat", stagingValidation);

      // Check if we should proceed with invalid files
      const totalErrors =
        githubValidation.totalErrors + stagingValidation.totalErrors;
      if (totalErrors > 0) {
        console.log("⚠️ Warning: Found validation errors. Sync may fail.");
        // TODO: Add interactive prompt to continue or abort
      }
    } catch (error) {
      console.error("❌ Feature validation failed:", error.message);
      throw error;
    }
  }

  /**
   * Reports validation results in a formatted way
   */
  reportValidationResults(source, validation) {
    console.log(`\n📊 ${source} Validation Results:`);
    console.log(`  Total files: ${validation.totalFiles}`);
    console.log(`  Valid files: ${validation.validFiles}`);
    console.log(`  Invalid files: ${validation.invalidFiles}`);
    console.log(`  Total errors: ${validation.totalErrors}`);
    console.log(`  Total warnings: ${validation.totalWarnings}`);

    // Show details for invalid files
    const invalidFiles = validation.details.filter((detail) => !detail.isValid);
    if (invalidFiles.length > 0) {
      console.log(`\n❌ Invalid files in ${source}:`);
      invalidFiles.forEach((detail) => {
        console.log(`  📄 ${detail.file}:`);
        detail.errors.forEach((error) => console.log(`    ❌ ${error}`));
        detail.warnings.forEach((warning) => console.log(`    ⚠️ ${warning}`));
      });
    }

    // Show warnings for valid files
    const filesWithWarnings = validation.details.filter(
      (detail) => detail.isValid && detail.warnings.length > 0
    );
    if (filesWithWarnings.length > 0) {
      console.log(`\n⚠️ Valid files with warnings in ${source}:`);
      filesWithWarnings.forEach((detail) => {
        console.log(`  📄 ${detail.file}:`);
        detail.warnings.forEach((warning) => console.log(`    ⚠️ ${warning}`));
      });
    }
  }

  /**
   * Main sync execution
   */
  async execute() {
    try {
      console.log("🚀 Starting GitHub ↔ AssertThat sync...");

      // Validate configuration
      this.validateConfig();

      // Create staging area and download AssertThat features
      await this.stagingManager.createStagingArea();
      await this.stagingManager.downloadAssertThatFeatures();

      // Detect changes
      const changes = await this.diffManager.detectChanges();

      // Validate feature files before proceeding
      await this.validateFeatureFiles(changes);

      // Classify changes and attempt auto-resolution
      const classified = await this.diffManager.classifyChanges(changes);

      // Handle remaining complex conflicts interactively
      if (classified.complex.length > 0) {
        console.log(
          "\n⚠️ Interactive resolution required for complex conflicts..."
        );

        const resolutionResults = await this.handleInteractiveResolution(
          classified.complex
        );

        console.log("\n📊 Interactive resolution summary:");
        console.log(
          `  ✅ Resolved: ${resolutionResults.resolved.length} files`
        );
        console.log(`  ⏭️ Skipped: ${resolutionResults.skipped.length} files`);
        console.log(`  ❌ Failed: ${resolutionResults.failed.length} files`);

        if (resolutionResults.skipped.length > 0) {
          console.log(
            "\n⚠️ Skipped files will need manual resolution before next sync:"
          );
          resolutionResults.skipped.forEach((file) =>
            console.log(`  - ${file}`)
          );
        }
      } else {
        console.log(
          "✅ All conflicts resolved automatically - sync can proceed"
        );
      }

      // Clean up staging area
      await this.stagingManager.cleanStagingArea();

      console.log("✅ Sync process completed");
    } catch (error) {
      console.error("❌ Sync failed:", error.message);

      // Clean up on error
      try {
        await this.stagingManager.cleanStagingArea();
      } catch (cleanupError) {
        console.error("❌ Cleanup failed:", cleanupError.message);
      }

      process.exit(1);
    }
  }

  /**
   * Handles interactive resolution for complex conflicts
   */
  async handleInteractiveResolution(complexFiles) {
    const results = {
      resolved: [],
      skipped: [],
      failed: [],
    };

    console.log(
      `\n🔧 Starting interactive resolution for ${complexFiles.length} files...`
    );

    for (const filename of complexFiles) {
      try {
        console.log(
          `\n📁 Processing: ${filename} (${complexFiles.indexOf(filename) + 1}/${complexFiles.length})`
        );

        const resolution = await this.conflictResolver.promptUserResolution(
          filename,
          this.stagingManager.stagingPath,
          this.stagingManager.featuresPath
        );

        if (resolution.resolved) {
          results.resolved.push(filename);
        } else {
          results.skipped.push(filename);
        }
      } catch (error) {
        console.error(`❌ Failed to resolve ${filename}: ${error.message}`);
        results.failed.push(filename);
      }
    }

    return results;
  }
}

// Main execution
console.log("🔧 Debug: Script loaded...");
console.log("🔧 Debug: import.meta.url:", import.meta.url);
console.log("🔧 Debug: process.argv[1]:", process.argv[1]);

if (import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  console.log("🔧 Debug: Script starting...");
  const orchestrator = new SyncOrchestrator();
  orchestrator.execute().catch((error) => {
    console.error("💥 Unhandled error:", error);
    process.exit(1);
  });
} else {
  console.log("🔧 Debug: Script imported as module");
}

export {
  StagingAreaManager,
  GitDiffManager,
  ConflictResolver,
  SyncOrchestrator,
};
