#!/usr/bin/env node
/**
 * Manual Download Test - Download features for manual verification
 */

import dotenv from "dotenv";
import { AssertThatApiClient } from "./api/AssertThatApiClient.mjs";
import { FeatureDownloader } from "./api/FeatureDownloader.mjs";
import { EventEmitter } from "events";
import fs from "fs/promises";
import path from "path";

dotenv.config();

const COLORS = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
};

function log(message, color = COLORS.reset) {
  console.log(`${color}${message}${COLORS.reset}`);
}

async function main() {
  console.log("\n");
  log("╔══════════════════════════════════════════════════════════════════╗", COLORS.cyan);
  log("║     Manual Download Test - Download Features for Verification   ║", COLORS.cyan);
  log("╚══════════════════════════════════════════════════════════════════╝", COLORS.cyan);

  try {
    // Configuration
    const config = {
      projectId: process.env.ASSERTTHAT_PROJECT_ID,
      accessKey: process.env.ASSERTTHAT_ACCESS_KEY,
      secretKey: process.env.ASSERTTHAT_SECRET_KEY,
    };

    log("\n📋 Configuration:", COLORS.cyan);
    log(`   Project ID: ${config.projectId}`, COLORS.blue);

    // Initialize components
    const apiClient = new AssertThatApiClient(config);
    const eventBus = new EventEmitter();
    const downloader = new FeatureDownloader(apiClient, config, eventBus, fs);

    // Download directory
    const downloadDir = "./manual-verification";
    await fs.mkdir(downloadDir, { recursive: true });

    log("\n🔽 Downloading features from AssertThat...", COLORS.yellow);
    log(`   Destination: ${downloadDir}`, COLORS.blue);

    // Download
    const result = await downloader.downloadFeatures(downloadDir, {
      mode: "automated",
    });

    if (result.success) {
      log("\n✅ Download successful!", COLORS.green);
      log(`   Files extracted: ${result.filesExtracted}`, COLORS.blue);
      log(`   Source: ${result.metadata.source}`, COLORS.blue);
      log(`   Downloaded at: ${result.metadata.downloadedAt}`, COLORS.blue);

      // List downloaded files
      log("\n📁 Downloaded files:", COLORS.cyan);
      const files = await fs.readdir(downloadDir);
      const featureFiles = files.filter((f) => f.endsWith(".feature"));

      for (const file of featureFiles) {
        const filePath = path.join(downloadDir, file);
        const content = await fs.readFile(filePath, "utf8");
        const lines = content.split("\n").length;
        const hasImportTag = content.includes("@imported-from-github");

        log(`   ${hasImportTag ? "✅" : "⚠️ "} ${file} (${lines} lines)${hasImportTag ? " - has @imported-from-github" : ""}`, COLORS.blue);
      }

      // Verification checklist
      log("\n" + "=".repeat(70), COLORS.cyan);
      log("📋 Manual Verification Checklist:", COLORS.cyan);
      log("=".repeat(70), COLORS.cyan);

      log("\n1️⃣  Check Jira AssertThat:", COLORS.yellow);
      log("   □ Go to Jira → Apps → AssertThat BDD", COLORS.blue);
      log("   □ Verify all 11 features are visible", COLORS.blue);
      log("   □ Check that scenarios are readable", COLORS.blue);
      log("   □ Verify @imported-from-github tags are visible", COLORS.blue);

      log("\n2️⃣  Modify a Feature in Jira:", COLORS.yellow);
      log("   □ Select a feature (e.g., error-handling.feature)", COLORS.blue);
      log("   □ Click Edit", COLORS.blue);
      log("   □ Add a new scenario or modify existing one", COLORS.blue);
      log("   □ Add a tag like @modified-in-jira", COLORS.blue);
      log("   □ Save changes", COLORS.blue);

      log("\n3️⃣  Download Again to See Changes:", COLORS.yellow);
      log("   □ Run this script again: node scripts/manual-download-test.mjs", COLORS.blue);
      log("   □ Check ./manual-verification/ for updated files", COLORS.blue);
      log("   □ Verify your Jira changes are present", COLORS.blue);

      log("\n4️⃣  Verify Downloaded Files:", COLORS.yellow);
      log("   □ Open files in ./manual-verification/", COLORS.blue);
      log("   □ Check Gherkin syntax is valid", COLORS.blue);
      log("   □ Verify @imported-from-github tags are present", COLORS.blue);
      log("   □ Check for any corruption or encoding issues", COLORS.blue);

      log("\n5️⃣  Compare with Original:", COLORS.yellow);
      log("   □ Compare downloaded files with features/ directory", COLORS.blue);
      log("   □ Verify content matches (except for tags)", COLORS.blue);
      log("   □ Check that modifications from Jira are synced", COLORS.blue);

      log("\n" + "=".repeat(70), COLORS.cyan);
      log("\n✅ Files ready for manual verification in: ./manual-verification/", COLORS.green);
      log("   You can now inspect the files and verify the sync worked correctly.", COLORS.cyan);
      log("\n");

    } else {
      log("\n❌ Download failed!", COLORS.red);
      log(`   Error: ${result.error}`, COLORS.red);
      process.exit(1);
    }

  } catch (error) {
    log("\n❌ Error:", COLORS.red);
    log(`   ${error.message}`, COLORS.red);
    console.error(error);
    process.exit(1);
  }
}

main();

