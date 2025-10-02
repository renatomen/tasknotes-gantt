#!/usr/bin/env node
/**
 * OG-45: Upload Real Features to AssertThat
 * 
 * Initial upload of all feature files from the repository to AssertThat.
 * This establishes AssertThat as the master source.
 */

import dotenv from "dotenv";
import { AssertThatApiClient } from "./api/AssertThatApiClient.mjs";
import { FeatureUploader } from "./api/FeatureUploader.mjs";
import { EventEmitter } from "events";
import fs from "fs/promises";
import path from "path";
import { glob } from "glob";

// Load environment variables
dotenv.config();

const COLORS = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
};

function log(message, color = COLORS.reset) {
  console.log(`${color}${message}${COLORS.reset}`);
}

function logSection(title) {
  console.log("\n" + "=".repeat(70));
  log(title, COLORS.cyan);
  console.log("=".repeat(70));
}

/**
 * Find all .feature files in the repository
 */
async function findFeatureFiles() {
  logSection("1. Discovering Feature Files");
  
  const featuresDir = "features";
  const pattern = `${featuresDir}/**/*.feature`;
  
  log(`Searching for: ${pattern}`, COLORS.blue);
  
  const files = await glob(pattern, { 
    ignore: ['**/node_modules/**', '**/dist/**'],
    windowsPathsNoEscape: true 
  });
  
  log(`\n✅ Found ${files.length} feature files:`, COLORS.green);
  files.forEach((file, index) => {
    log(`   ${index + 1}. ${file}`, COLORS.blue);
  });
  
  return files;
}

/**
 * Read feature file content
 */
async function readFeatureFile(filePath) {
  const content = await fs.readFile(filePath, "utf8");
  const name = path.basename(filePath);
  
  return {
    name,
    content,
    path: filePath,
  };
}

/**
 * Load all feature files
 */
async function loadFeatures(filePaths) {
  logSection("2. Loading Feature Files");
  
  const features = [];
  
  for (const filePath of filePaths) {
    try {
      const feature = await readFeatureFile(filePath);
      features.push(feature);
      log(`✅ Loaded: ${feature.name}`, COLORS.green);
    } catch (error) {
      log(`❌ Failed to load ${filePath}: ${error.message}`, COLORS.red);
    }
  }
  
  log(`\n✅ Loaded ${features.length} features successfully`, COLORS.green);
  return features;
}

/**
 * Upload features to AssertThat
 */
async function uploadFeatures(features) {
  logSection("3. Uploading Features to AssertThat");
  
  // Initialize API client
  const config = {
    projectId: process.env.ASSERTTHAT_PROJECT_ID,
    accessKey: process.env.ASSERTTHAT_ACCESS_KEY,
    secretKey: process.env.ASSERTTHAT_SECRET_KEY,
  };
  
  log(`Project ID: ${config.projectId}`, COLORS.blue);
  log(`Features to upload: ${features.length}`, COLORS.blue);

  // Create event bus for progress tracking
  const eventBus = new EventEmitter();
  
  // Listen to upload events
  eventBus.on("UPLOAD_STARTED", (data) => {
    log(`\n⏳ Uploading: ${data.featureName}`, COLORS.yellow);
  });
  
  eventBus.on("UPLOAD_COMPLETED", (data) => {
    log(`   ✅ Success: ${data.featureName}`, COLORS.green);
  });
  
  eventBus.on("UPLOAD_FAILED", (data) => {
    log(`   ❌ Failed: ${data.featureName} - ${data.error}`, COLORS.red);
  });
  
  eventBus.on("BATCH_UPLOAD_PROGRESS", (data) => {
    const percentage = Math.round((data.current / data.total) * 100);
    log(`   📊 Progress: ${data.current}/${data.total} (${percentage}%) - Uploaded: ${data.uploaded}, Failed: ${data.failed}`, COLORS.cyan);
  });
  
  // Create uploader
  const apiClient = new AssertThatApiClient(config);
  const uploader = new FeatureUploader(apiClient, config, eventBus);
  
  // Upload in batch
  log("\n🚀 Starting batch upload...\n", COLORS.magenta);
  
  const result = await uploader.uploadBatch(features, {
    tagAsImported: true,
    override: true,
  });
  
  return result;
}

/**
 * Display results
 */
function displayResults(result) {
  logSection("4. Upload Results");
  
  log(`Total Uploaded: ${result.uploaded}`, result.uploaded > 0 ? COLORS.green : COLORS.yellow);
  log(`Total Failed: ${result.failed}`, result.failed > 0 ? COLORS.red : COLORS.green);
  log(`Overall Success: ${result.success ? "YES" : "NO"}`, result.success ? COLORS.green : COLORS.red);
  
  if (result.errors.length > 0) {
    log("\n❌ Errors:", COLORS.red);
    result.errors.forEach((error, index) => {
      log(`   ${index + 1}. ${error.feature}: ${error.error}`, COLORS.red);
    });
  }
  
  if (result.success) {
    log("\n🎉 All features uploaded successfully!", COLORS.green);
    log("AssertThat is now the master source for BDD scenarios.", COLORS.cyan);
  } else {
    log("\n⚠️  Some features failed to upload. Check errors above.", COLORS.yellow);
  }
}

/**
 * Confirm before upload
 */
async function confirmUpload(featureCount) {
  const readline = await import("readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  
  return new Promise((resolve) => {
    log(`\n⚠️  You are about to upload ${featureCount} features to AssertThat.`, COLORS.yellow);
    log("This will establish AssertThat as the master source.", COLORS.yellow);
    
    rl.question("\nDo you want to continue? (yes/no): ", (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "yes" || answer.toLowerCase() === "y");
    });
  });
}

/**
 * Main execution
 */
async function main() {
  console.log("\n");
  log("╔══════════════════════════════════════════════════════════════════╗", COLORS.cyan);
  log("║     Upload Real Features to AssertThat - OG-45                  ║", COLORS.cyan);
  log("║     Initial Sync: GitHub → AssertThat                           ║", COLORS.cyan);
  log("╚══════════════════════════════════════════════════════════════════╝", COLORS.cyan);
  
  try {
    // Step 1: Find feature files
    const filePaths = await findFeatureFiles();
    
    if (filePaths.length === 0) {
      log("\n❌ No feature files found!", COLORS.red);
      process.exit(1);
    }
    
    // Step 2: Load features
    const features = await loadFeatures(filePaths);
    
    if (features.length === 0) {
      log("\n❌ No features loaded!", COLORS.red);
      process.exit(1);
    }
    
    // Step 3: Confirm upload
    const confirmed = await confirmUpload(features.length);
    
    if (!confirmed) {
      log("\n❌ Upload cancelled by user.", COLORS.yellow);
      process.exit(0);
    }
    
    // Step 4: Upload features
    const result = await uploadFeatures(features);
    
    // Step 5: Display results
    displayResults(result);
    
    // Exit with appropriate code
    process.exit(result.success ? 0 : 1);
    
  } catch (error) {
    logSection("Fatal Error");
    log(`❌ ${error.message}`, COLORS.red);
    console.error(error);
    process.exit(1);
  }
}

// Run the script
main();

