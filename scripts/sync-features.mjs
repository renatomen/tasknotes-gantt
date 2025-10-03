#!/usr/bin/env node

/**
 * GitHub ↔ AssertThat BDD Feature Sync
 * Entry point for bidirectional feature file synchronization
 *
 * TEMPORARY IMPLEMENTATION: Uses FeatureDownloader directly until
 * StagingAreaManager and DiffManager are properly implemented
 */

import dotenv from "dotenv";
import { FeatureDownloader } from "./api/FeatureDownloader.mjs";
import { AssertThatApiClient } from "./api/AssertThatApiClient.mjs";
import { SyncConfiguration } from "./config/SyncConfiguration.mjs";
import { syncEvents, SYNC_EVENTS } from "./events/SyncEvents.mjs";
import fs from "fs/promises";
import path from "path";

// Load environment variables
dotenv.config();

/**
 * Main execution
 */
async function main() {
  try {
    console.log("🚀 Starting GitHub ↔ AssertThat feature sync...\n");

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

    // Initialize API client with flattened config
    const apiClient = new AssertThatApiClient({
      projectId: config.assertThat.projectId,
      accessKey: config.assertThat.accessKey,
      secretKey: config.assertThat.secretKey,
      token: config.assertThat.token,
      jiraServerUrl: config.jira.serverUrl,
    });

    // Initialize downloader
    const downloader = new FeatureDownloader(apiClient, config, syncEvents);

    // Create staging directory
    const stagingPath = path.resolve(config.stagingDir);
    console.log(`📁 Creating staging area at: ${stagingPath}`);
    await fs.rm(stagingPath, { recursive: true, force: true });
    await fs.mkdir(stagingPath, { recursive: true });

    // Download features
    console.log("⬇️  Downloading features from AssertThat...");
    const result = await downloader.downloadFeatures(stagingPath, {
      mode: "automated",
      organizeByFolder: true,
    });

    console.log(`✅ Downloaded ${result.filesExtracted} feature files`);

    // Copy to features directory (overwrite)
    const featuresPath = path.resolve(config.featuresDir);
    console.log(`📋 Copying features to: ${featuresPath}`);

    // Copy all files from staging to features
    await copyDirectory(stagingPath, featuresPath);

    console.log("✅ Features copied successfully");

    // Cleanup staging
    console.log("🧹 Cleaning up staging area...");
    await fs.rm(stagingPath, { recursive: true, force: true });

    console.log("\n✅ Sync completed successfully!");
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

/**
 * Recursively copy directory contents
 */
async function copyDirectory(src, dest) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDirectory(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

// Execute main function
main();

export { main };

