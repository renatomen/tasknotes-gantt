#!/usr/bin/env node

/**
 * OG-47: ID-Based Sync with PR Creation
 * 
 * Entry point for automated ID-based sync with PR creation
 * Uses V2 API and scenario IDs for reliable bidirectional sync
 */

import dotenv from "dotenv";
import { AssertThatApiClient } from "./api/AssertThatApiClient.mjs";
import { SyncConfiguration } from "./config/SyncConfiguration.mjs";
import { IdBasedDiffManager } from "./diff/IdBasedDiffManager.mjs";
import { PRAutomation } from "./automation/PRAutomation.mjs";
import { FeatureDownloader } from "./api/FeatureDownloader.mjs";
import fs from "fs/promises";
import path from "path";

// Load environment variables
dotenv.config();

console.log("DEBUG: Script loaded successfully");

async function main() {
  console.log("DEBUG: main() function called");
  console.log("🔄 Starting ID-based sync with PR creation...\n");

  try {
    // Step 1: Configuration
    console.log("⚙️  Step 1: Validating configuration...");
    const config = new SyncConfiguration();
    const validation = config.validateConfiguration();
    
    if (!validation.isValid) {
      console.error("❌ Configuration validation failed:");
      validation.missingFields.forEach((field) => {
        console.error(`   - Missing: ${field}`);
      });
      process.exit(1);
    }
    console.log("✅ Configuration validated\n");

    // Step 2: Initialize components
    console.log("🔧 Step 2: Initializing components...");
    
    const apiClient = new AssertThatApiClient({
      projectId: config.assertThat.projectId,
      accessKey: config.assertThat.accessKey,
      secretKey: config.assertThat.secretKey,
      token: config.assertThat.token,
      jiraServerUrl: undefined, // Use AssertThat Cloud
    });

    const diffManager = new IdBasedDiffManager({
      config,
      apiClient,
      featuresDir: config.featuresDir,
    });

    const featureDownloader = new FeatureDownloader(
      apiClient,
      config,
      null // eventBus - not needed for now
    );

    console.log(`✅ Components initialized\n`);
    console.log(`🔗 Using API: ${apiClient.baseUrl}\n`);

    // Step 3: Detect changes
    console.log("🔍 Step 3: Detecting changes...");
    const changes = await diffManager.detectChanges();

    const totalChanges =
      changes.additions.length +
      changes.modifications.length +
      changes.deletions.length;

    if (totalChanges === 0) {
      console.log("\n✅ No changes detected - everything is in sync!");
      console.log("   No PR needed.\n");
      process.exit(0);
    }

    console.log(`\n⚠️  ${totalChanges} change(s) detected!\n`);

    // Display changes
    if (changes.additions.length > 0) {
      console.log("🆕 New scenarios in AssertThat:");
      changes.additions.forEach((change) => {
        console.log(`   - ${change.feature}: ${change.scenarioName}`);
      });
      console.log("");
    }

    if (changes.modifications.length > 0) {
      console.log("✏️  Renamed scenarios:");
      changes.modifications.forEach((change) => {
        console.log(`   - "${change.oldName}" → "${change.newName}" (${change.feature})`);
      });
      console.log("");
    }

    if (changes.deletions.length > 0) {
      console.log("🗑️  Deleted scenarios:");
      changes.deletions.forEach((change) => {
        console.log(`   - ${change.scenarioName} (${change.feature})`);
      });
      console.log("");
    }

    // Step 4: Download updated features from AssertThat
    console.log("📥 Step 4: Downloading updated features from AssertThat...");
    
    const downloadResult = await featureDownloader.downloadFeatures({
      mode: "automated",
    });

    const featuresPath = path.resolve(config.featuresDir);
    
    // Extract features to features directory
    const extractedFiles = await featureDownloader.extractZip(
      downloadResult.zipBuffer,
      featuresPath,
      { flatten: true }
    );

    console.log(`✅ Downloaded and extracted ${extractedFiles.length} feature files\n`);

    // Step 5: Check if we should create PR
    const shouldCreatePR = process.env.CREATE_PR !== "false";

    if (!shouldCreatePR) {
      console.log("⏭️  Skipping PR creation (CREATE_PR=false)");
      console.log("   Features have been updated in the working directory.");
      console.log("   Review changes and commit manually.\n");
      process.exit(0);
    }

    // Step 6: Classify changes for PR
    console.log("🔍 Step 5: Classifying changes...");
    const classification = await diffManager.classifyChanges(changes);

    const hasConflicts = classification.complex.length > 0;

    console.log(`\n📋 Change classification:`);
    console.log(`   ✅ Simple changes: ${classification.simple.length}`);
    console.log(`   ⚠️  Complex changes: ${classification.complex.length}`);
    console.log(`   🤖 Auto-resolved: ${classification.autoResolved.length}`);
    console.log(`   ${hasConflicts ? "⚠️  Has conflicts - manual review required" : "✅ No conflicts - can auto-merge"}\n`);

    // Step 7: Create PR
    console.log("🔀 Step 6: Creating pull request...");
    
    const prAutomation = new PRAutomation({ config });

    const syncResult = {
      additions: changes.additions,
      modifications: changes.modifications,
      deletions: changes.deletions,
      hasConflicts,
    };

    const prResult = await prAutomation.executeWorkflow(syncResult);

    console.log("\n✅ PR workflow completed successfully!");
    console.log(`   📝 Branch: ${prResult.branchName}`);
    console.log(`   🔗 PR: #${prResult.prNumber}`);
    console.log(`   ${hasConflicts ? "⚠️  Has conflicts - review required" : "✅ No conflicts - ready to merge"}`);
    console.log(`   ${prResult.autoMerged ? "🎉 Auto-merged!" : "⏳ Awaiting review"}\n`);

    process.exit(0);
  } catch (error) {
    console.error("\n❌ Sync with PR creation failed:", error.message);
    if (error.stack) {
      console.error("\nStack trace:");
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Execute main function
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

export { main };

