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
    // NOTE: For AssertThat Cloud, leave jiraServerUrl undefined to use bdd.assertthat.app
    // For Jira Server/DC with AssertThat plugin, provide the Jira base URL
    const apiClient = new AssertThatApiClient({
      projectId: config.assertThat.projectId,
      accessKey: config.assertThat.accessKey,
      secretKey: config.assertThat.secretKey,
      token: config.assertThat.token,
      jiraServerUrl: undefined, // Force use of bdd.assertthat.app for now
    });

    console.log(`🔗 Using API: ${apiClient.baseUrl}`);

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

    console.log(`✅ Downloaded ${result.filesExtracted || result.extractedFiles || 'unknown'} feature files`);
    console.log(`📊 Download result:`, JSON.stringify(result, null, 2));

    // List what was downloaded
    const stagingFiles = await listFeatureFiles(stagingPath);
    console.log(`\n📁 Files in staging (${stagingFiles.length}):`);
    stagingFiles.forEach(f => console.log(`   - ${f}`));

    // Copy to features directory (overwrite)
    const featuresPath = path.resolve(config.featuresDir);
    console.log(`\n📋 Copying features to: ${featuresPath}`);

    // Copy all files from staging to features
    await copyDirectory(stagingPath, featuresPath);

    console.log("✅ Features copied successfully");

    // Check for git changes (both tracked and untracked files)
    console.log("\n🔍 Checking for changes...");
    const { execSync } = await import('child_process');

    let hasChanges = false;

    // Check for modifications to tracked files
    try {
      execSync('git diff --quiet features/', { cwd: process.cwd() });
    } catch (error) {
      hasChanges = true;
      console.log("✅ Modified files detected");
    }

    // Check for untracked files
    const untrackedOutput = execSync('git ls-files --others --exclude-standard features/', {
      cwd: process.cwd(),
      encoding: 'utf-8'
    }).trim();

    if (untrackedOutput) {
      hasChanges = true;
      const untrackedFiles = untrackedOutput.split('\n');
      console.log(`✅ Untracked files detected (${untrackedFiles.length}):`);
      untrackedFiles.forEach(f => console.log(`   - ${f}`));
    }

    if (!hasChanges) {
      console.log("❌ No changes detected - features are identical to GitHub");
    } else {
      console.log("\n🎉 Changes detected! Run 'git status features/' to see them");
    }

    // Cleanup staging (DISABLED for debugging)
    console.log("🧹 Keeping staging area for inspection...");
    console.log(`📂 Staging directory: ${stagingPath}`);
    // await fs.rm(stagingPath, { recursive: true, force: true });

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

/**
 * Recursively list all .feature files in a directory
 */
async function listFeatureFiles(dir, baseDir = dir) {
  const files = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFeatureFiles(fullPath, baseDir));
    } else if (entry.name.endsWith('.feature')) {
      files.push(path.relative(baseDir, fullPath));
    }
  }

  return files.sort();
}

// Execute main function
main();

export { main };

