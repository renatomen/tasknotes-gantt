#!/usr/bin/env node

/**
 * OG-47: ID Assignment Workflow
 * 
 * Assigns AssertThat scenario IDs to all feature files
 * Workflow:
 * 1. Upload all features to AssertThat
 * 2. Fetch scenarios with IDs from V2 API
 * 3. Update feature files with ID metadata
 */

import dotenv from "dotenv";
import fs from "fs/promises";
import path from "path";
import { AssertThatApiClient } from "../api/AssertThatApiClient.mjs";
import { FeatureUploader } from "../api/FeatureUploader.mjs";
import { FeatureMetadataManager } from "../metadata/FeatureMetadataManager.mjs";
import { SyncConfiguration } from "../config/SyncConfiguration.mjs";

dotenv.config();

async function main() {
  console.log("🔄 Starting ID assignment workflow...\n");

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
      jiraServerUrl: undefined,
    });

    const uploader = new FeatureUploader(apiClient, config);
    const metadataManager = new FeatureMetadataManager();
    
    console.log("✅ Components initialized\n");

    // Step 3: Upload all features to AssertThat
    console.log("📤 Step 3: Uploading features to AssertThat...");
    
    const featuresPath = path.resolve(config.featuresDir);
    const featureFiles = await findFeatureFiles(featuresPath);
    
    console.log(`   Found ${featureFiles.length} feature files`);
    
    let uploadedCount = 0;
    for (const file of featureFiles) {
      try {
        await uploader.uploadFeature(file.path, {
          mode: "automated",
        });
        uploadedCount++;
        console.log(`   ✅ Uploaded: ${file.name}`);
      } catch (error) {
        console.error(`   ⚠️  Failed to upload ${file.name}: ${error.message}`);
      }
    }
    
    console.log(`\n✅ Uploaded ${uploadedCount}/${featureFiles.length} features\n`);

    // Step 4: Fetch scenarios with IDs
    console.log("📥 Step 4: Fetching scenarios with IDs from AssertThat...");
    
    const scenarios = await apiClient.getAllScenarios();
    console.log(`✅ Fetched ${scenarios.length} scenarios with IDs\n`);

    // Step 5: Update feature files with IDs
    console.log("✏️  Step 5: Updating feature files with IDs...");
    
    let updatedCount = 0;
    for (const file of featureFiles) {
      const content = await fs.readFile(file.path, "utf-8");
      
      // Extract feature name from content
      const featureMatch = content.match(/Feature:\s*(.+)/);
      if (!featureMatch) {
        console.log(`   ⚠️  Skipping ${file.name}: No feature name found`);
        continue;
      }
      
      const featureName = featureMatch[1].trim();
      
      // Find scenarios for this feature
      const featureScenarios = scenarios.filter(s => s.feature === featureName);
      
      if (featureScenarios.length === 0) {
        console.log(`   ⚠️  No scenarios found for feature: ${featureName}`);
        continue;
      }
      
      // Update content with IDs
      let updatedContent = content;
      
      // Add feature-level ID if not present
      if (!updatedContent.includes("@assertthat-feature-id")) {
        const featureLineMatch = updatedContent.match(/(Feature:.+)/);
        if (featureLineMatch) {
          updatedContent = updatedContent.replace(
            featureLineMatch[1],
            `# @assertthat-feature-id: ${featureName}\n${featureLineMatch[1]}`
          );
        }
      }
      
      // Add scenario-level IDs
      for (const scenario of featureScenarios) {
        const scenarioPattern = new RegExp(
          `(Scenario(?:\\s+Outline)?:\\s*${escapeRegex(scenario.name)})`,
          "m"
        );
        
        if (scenarioPattern.test(updatedContent) && 
            !updatedContent.includes(`@assertthat-scenario-id: ${scenario.id}`)) {
          updatedContent = updatedContent.replace(
            scenarioPattern,
            `  # @assertthat-scenario-id: ${scenario.id}\n  $1`
          );
        }
      }
      
      // Write updated content
      if (updatedContent !== content) {
        await fs.writeFile(file.path, updatedContent, "utf-8");
        updatedCount++;
        console.log(`   ✅ Updated: ${file.name} (${featureScenarios.length} scenarios)`);
      } else {
        console.log(`   ℹ️  No changes: ${file.name}`);
      }
    }
    
    console.log(`\n✅ Updated ${updatedCount}/${featureFiles.length} feature files\n`);

    // Step 6: Summary
    console.log("📊 Summary:");
    console.log(`   - Features uploaded: ${uploadedCount}`);
    console.log(`   - Scenarios fetched: ${scenarios.length}`);
    console.log(`   - Files updated: ${updatedCount}`);
    console.log("\n✅ ID assignment workflow completed successfully!\n");

    process.exit(0);
  } catch (error) {
    console.error("\n❌ ID assignment workflow failed:", error.message);
    if (error.stack) {
      console.error("\nStack trace:");
      console.error(error.stack);
    }
    process.exit(1);
  }
}

/**
 * Find all feature files recursively
 */
async function findFeatureFiles(dir) {
  const files = [];
  
  async function scan(currentDir) {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      
      if (entry.isDirectory()) {
        await scan(fullPath);
      } else if (entry.name.endsWith(".feature")) {
        files.push({
          name: entry.name,
          path: fullPath,
        });
      }
    }
  }
  
  await scan(dir);
  return files;
}

/**
 * Escape special regex characters
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Execute main
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

