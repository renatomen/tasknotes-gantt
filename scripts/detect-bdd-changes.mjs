#!/usr/bin/env node

/**
 * OG-40: BDD Change Detection Script
 *
 * Detects changes to BDD feature files and related scripts to optimize CI pipeline.
 * Only runs BDD validation and processing when relevant files have changed.
 */

import { execSync } from "child_process";
import { existsSync } from "fs";

/**
 * Get list of changed files from git
 */
function getChangedFiles() {
  try {
    // Get changed files between current branch and main/master
    let baseBranch = "main";

    // Check if main branch exists, fallback to master
    try {
      execSync("git rev-parse --verify origin/main", { stdio: "pipe" });
    } catch {
      try {
        execSync("git rev-parse --verify origin/master", { stdio: "pipe" });
        baseBranch = "master";
      } catch {
        // If neither main nor master exists, compare with HEAD~1
        baseBranch = "HEAD~1";
      }
    }

    // Get changed files
    const output = execSync(
      `git diff --name-only origin/${baseBranch}...HEAD`,
      {
        encoding: "utf8",
        stdio: "pipe",
      }
    );

    return output
      .trim()
      .split("\n")
      .filter((file) => file.length > 0);
  } catch (error) {
    console.warn(
      "⚠️  Could not detect changed files, assuming all files changed"
    );
    console.warn(`Error: ${error.message}`);
    return ["**/*"]; // Fallback to process everything
  }
}

/**
 * Check if BDD-related files have changed
 */
function hasBddChanges(changedFiles) {
  const bddPatterns = [
    /^features\/.*\.feature$/, // Feature files
    /^\.bdd\/.*$/, // BDD configuration
    /^scripts\/.*bdd.*\.m?js$/, // BDD scripts
    /^scripts\/validate-bdd-syntax\.mjs$/, // BDD validation script
    /^scripts\/generate-bdd-feature\.mjs$/, // BDD generator
    /^scripts\/semantic-tag-manager\.mjs$/, // Semantic tag manager
    /^\.husky\/pre-commit$/, // Pre-commit hooks
    /^package\.json$/, // Dependencies
    /^test\/.*\.feature$/, // Test feature files
    /^test\/step-definitions\/.*$/, // Step definitions
  ];

  const bddChanges = changedFiles.filter((file) =>
    bddPatterns.some((pattern) => pattern.test(file))
  );

  return {
    hasChanges: bddChanges.length > 0,
    changedFiles: bddChanges,
  };
}

/**
 * Check if semantic tag registry has changed
 */
function hasSemanticTagChanges(changedFiles) {
  return changedFiles.some((file) => file === ".bdd/semantic-tags.yaml");
}

/**
 * Get list of changed feature files specifically
 */
function getChangedFeatureFiles(changedFiles) {
  return changedFiles.filter(
    (file) => file.endsWith(".feature") && existsSync(file)
  );
}

/**
 * Main execution
 */
function main() {
  console.log("🔍 OG-40: Detecting BDD file changes...\n");

  const changedFiles = getChangedFiles();
  console.log(`📋 Total changed files: ${changedFiles.length}`);

  if (changedFiles.includes("**/*")) {
    console.log(
      "⚠️  Could not determine specific changes, processing all BDD files"
    );
    process.exit(0); // Exit with success to run all BDD checks
  }

  const bddResult = hasBddChanges(changedFiles);
  const semanticTagChanges = hasSemanticTagChanges(changedFiles);
  const changedFeatures = getChangedFeatureFiles(changedFiles);

  console.log(`\n📊 BDD Change Detection Results:`);
  console.log(
    `   🏷️  Semantic tags changed: ${semanticTagChanges ? "Yes" : "No"}`
  );
  console.log(`   📝 Feature files changed: ${changedFeatures.length}`);
  console.log(
    `   🔧 BDD tooling changed: ${bddResult.hasChanges ? "Yes" : "No"}`
  );

  if (bddResult.hasChanges) {
    console.log(`\n✅ BDD-related changes detected:`);
    bddResult.changedFiles.forEach((file) => {
      console.log(`   - ${file}`);
    });

    if (changedFeatures.length > 0) {
      console.log(`\n📝 Changed feature files:`);
      changedFeatures.forEach((file) => {
        console.log(`   - ${file}`);
      });
    }

    console.log(`\n🚀 BDD validation and processing will run`);
    process.exit(0); // Exit with success to run BDD checks
  } else {
    console.log(
      `\n⏭️  No BDD-related changes detected, skipping BDD validation`
    );
    process.exit(1); // Exit with failure to skip BDD checks
  }
}

// Export for testing
export {
  getChangedFiles,
  hasBddChanges,
  hasSemanticTagChanges,
  getChangedFeatureFiles,
};

// Run if called directly
if (
  import.meta.url.endsWith(process.argv[1]) ||
  process.argv[1].endsWith("detect-bdd-changes.mjs")
) {
  main();
}
