#!/usr/bin/env node

/**
 * GitHub ↔ AssertThat BDD Feature Sync
 * Entry point for bidirectional feature file synchronization
 *
 * Uses ID-based matching for reliable bidirectional sync:
 * - Matches scenarios by @assertthat-scenario-id comments
 * - Handles new scenarios (in AssertThat but not in GitHub)
 * - Handles deleted scenarios (in GitHub but not in AssertThat)
 * - Handles renamed scenarios (same ID, different name)
 * - Detects conflicts when both sides have changes
 */

import dotenv from "dotenv";
import { AssertThatApiClient } from "./api/AssertThatApiClient.mjs";
import { SyncConfiguration } from "./config/SyncConfiguration.mjs";
import { FeatureMetadataManager } from "./metadata/FeatureMetadataManager.mjs";
import fs from "fs/promises";
import path from "path";

// Load environment variables
dotenv.config();

/**
 * Load all GitHub feature files with content
 */
async function loadGitHubFeatures(featuresDir) {
  const features = [];
  const files = await fs.readdir(featuresDir);

  for (const file of files) {
    if (file.endsWith(".feature")) {
      const filePath = path.join(featuresDir, file);
      const content = await fs.readFile(filePath, "utf-8");
      features.push({
        name: file,
        path: filePath,
        content,
      });
    }
  }

  return features;
}

/**
 * Main execution
 */
async function main() {
  try {
    console.log("🚀 Starting ID-based GitHub ↔ AssertThat feature sync...\n");

    // Initialize configuration
    const config = new SyncConfiguration();

    // Validate environment variables
    const validation = config.validateConfiguration();
    if (!validation.isValid) {
      console.error("❌ Configuration validation failed:");
      console.error(`Missing fields: ${validation.missingFields.join(", ")}`);
      process.exit(1);
    }

    console.log("✅ Configuration validated\n");

    // Initialize API client
    const apiClient = new AssertThatApiClient({
      projectId: config.assertThat.projectId,
      accessKey: config.assertThat.accessKey,
      secretKey: config.assertThat.secretKey,
      token: config.assertThat.token,
      jiraServerUrl: undefined, // Use AssertThat Cloud
    });

    console.log(`🔗 Using API: ${apiClient.baseUrl}\n`);

    // Initialize metadata manager
    const metadataManager = new FeatureMetadataManager();

    // Step 1: Load GitHub features
    console.log("📂 Step 1: Loading GitHub feature files...");
    const featuresPath = path.resolve(config.featuresDir);
    const githubFeatures = await loadGitHubFeatures(featuresPath);
    console.log(`   Found ${githubFeatures.length} GitHub feature files\n`);

    // Step 2: Fetch AssertThat scenarios with IDs
    console.log("📥 Step 2: Fetching scenarios from AssertThat V2 API...");
    const assertThatScenarios = await apiClient.getAllScenarios();
    console.log(`   Found ${assertThatScenarios.length} AssertThat scenarios\n`);

    // Step 3: Create ID-based mapping
    console.log("🔗 Step 3: Creating ID-based scenario mapping...");
    const mapping = metadataManager.createScenarioMapping(
      githubFeatures,
      assertThatScenarios
    );
    console.log(`   Created mapping for ${mapping.size} scenarios\n`);

    // Step 4: Analyze mapping
    console.log("🔍 Step 4: Analyzing sync status...\n");

    const stats = {
      inSync: 0,
      newInAssertThat: 0,
      deletedInAssertThat: 0,
      renamedInAssertThat: 0,
      conflicts: 0,
    };

    const newScenarios = [];
    const deletedScenarios = [];
    const renamedScenarios = [];

    for (const [scenarioId, { github, assertThat }] of mapping) {
      if (!github && assertThat) {
        // New scenario in AssertThat
        stats.newInAssertThat++;
        newScenarios.push(assertThat);
      } else if (github && !assertThat) {
        // Deleted scenario in AssertThat
        stats.deletedInAssertThat++;
        deletedScenarios.push({ id: scenarioId, name: github.scenarioName });
      } else if (github && assertThat) {
        // Existing scenario - check for rename
        if (github.scenarioName !== assertThat.name) {
          stats.renamedInAssertThat++;
          renamedScenarios.push({
            id: scenarioId,
            oldName: github.scenarioName,
            newName: assertThat.name,
            feature: assertThat.feature,
          });
        } else {
          stats.inSync++;
        }
      }
    }

    // Display statistics
    console.log("📊 Sync Statistics:");
    console.log(`   ✅ In sync: ${stats.inSync}`);
    console.log(`   🆕 New in AssertThat: ${stats.newInAssertThat}`);
    console.log(`   🗑️  Deleted in AssertThat: ${stats.deletedInAssertThat}`);
    console.log(`   ✏️  Renamed in AssertThat: ${stats.renamedInAssertThat}`);
    console.log("");

    // Display details
    if (newScenarios.length > 0) {
      console.log("🆕 New scenarios in AssertThat:");
      newScenarios.forEach((s) =>
        console.log(`   - ${s.feature}: ${s.name}`)
      );
      console.log("");
    }

    if (deletedScenarios.length > 0) {
      console.log("🗑️  Scenarios deleted in AssertThat:");
      deletedScenarios.forEach((s) => console.log(`   - ${s.name} (ID: ${s.id})`));
      console.log("");
    }

    if (renamedScenarios.length > 0) {
      console.log("✏️  Scenarios renamed in AssertThat:");
      renamedScenarios.forEach((s) =>
        console.log(`   - "${s.oldName}" → "${s.newName}" (${s.feature})`)
      );
      console.log("");
    }

    // Step 5: Determine if sync is needed
    const syncNeeded =
      stats.newInAssertThat > 0 ||
      stats.deletedInAssertThat > 0 ||
      stats.renamedInAssertThat > 0;

    if (!syncNeeded) {
      console.log("✅ All scenarios are in sync - no changes needed!\n");
      process.exit(0);
    }

    console.log("⚠️  Sync needed - changes detected in AssertThat\n");
    console.log("📝 Next steps:");
    console.log("   1. This is a PREVIEW - no changes have been made yet");
    console.log("   2. To implement sync, we need to:");
    console.log("      - Download updated features from AssertThat");
    console.log("      - Update GitHub files with new/renamed scenarios");
    console.log("      - Handle deleted scenarios appropriately");
    console.log("   3. For now, use the assign:ids workflow to update IDs");
    console.log("");

    console.log("✅ Sync analysis completed successfully!");
    process.exit(0);
  } catch (error) {
    console.error("\n❌ Sync failed:", error.message);
    if (error.stack) {
      console.error("\nStack trace:");
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Execute main function
main();

export { main };

