#!/usr/bin/env node
/**
 * OG-45: AssertThat API Integration Test
 * 
 * Tests real API connectivity with actual credentials from .env file
 */

import dotenv from "dotenv";
import { AssertThatApiClient } from "./api/AssertThatApiClient.mjs";
import fs from "fs/promises";

// Load environment variables
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

function logSection(title) {
  console.log("\n" + "=".repeat(60));
  log(title, COLORS.cyan);
  console.log("=".repeat(60));
}

async function testConfiguration() {
  logSection("1. Configuration Validation");

  const config = {
    projectId: process.env.ASSERTTHAT_PROJECT_ID,
    accessKey: process.env.ASSERTTHAT_ACCESS_KEY,
    secretKey: process.env.ASSERTTHAT_SECRET_KEY,
  };

  log(`Project ID: ${config.projectId || "❌ MISSING"}`, config.projectId ? COLORS.green : COLORS.red);
  log(`Access Key: ${config.accessKey ? "✅ Set (" + config.accessKey.substring(0, 10) + "...)" : "❌ MISSING"}`, config.accessKey ? COLORS.green : COLORS.red);
  log(`Secret Key: ${config.secretKey ? "✅ Set (" + config.secretKey.substring(0, 10) + "...)" : "❌ MISSING"}`, config.secretKey ? COLORS.green : COLORS.red);

  if (!config.projectId || !config.accessKey || !config.secretKey) {
    log("\n❌ Missing required credentials in .env file", COLORS.red);
    process.exit(1);
  }

  log("\n✅ All credentials configured", COLORS.green);
  return config;
}

async function testApiClient(config) {
  logSection("2. API Client Initialization");

  try {
    const client = new AssertThatApiClient(config);
    log("✅ API Client created successfully", COLORS.green);
    log(`   Base URL: https://bdd.assertthat.app`, COLORS.blue);
    log(`   Project ID: ${config.projectId}`, COLORS.blue);
    return client;
  } catch (error) {
    log(`❌ Failed to create API client: ${error.message}`, COLORS.red);
    throw error;
  }
}

async function testDownload(client) {
  logSection("3. Download Features Test");

  try {
    log("Attempting to download features from AssertThat...", COLORS.yellow);
    
    const zipBuffer = await client.downloadFeatures({
      mode: "automated",
    });

    log(`✅ Download successful!`, COLORS.green);
    log(`   ZIP size: ${zipBuffer.length} bytes`, COLORS.blue);
    
    // Save to temp file for inspection
    const tempPath = "./test-download.zip";
    await fs.writeFile(tempPath, zipBuffer);
    log(`   Saved to: ${tempPath}`, COLORS.blue);
    
    return { success: true, size: zipBuffer.length };
  } catch (error) {
    log(`❌ Download failed: ${error.message}`, COLORS.red);
    if (error.statusCode) {
      log(`   HTTP Status: ${error.statusCode}`, COLORS.red);
    }
    return { success: false, error: error.message };
  }
}

async function testUpload(client) {
  logSection("4. Upload Feature Test");

  try {
    // Create a simple test feature
    const testFeature = {
      name: "test-integration.feature",
      content: `Feature: Integration Test
  This is a test feature uploaded from the integration test script
  
  @integration-test @automated
  Scenario: Verify API connectivity
    Given the AssertThat API is accessible
    When I upload a feature file
    Then the upload should succeed
`,
    };

    log("Attempting to upload test feature to AssertThat...", COLORS.yellow);
    log(`   Feature: ${testFeature.name}`, COLORS.blue);
    
    await client.uploadFeature(testFeature, { override: true });

    log(`✅ Upload successful!`, COLORS.green);
    log(`   Feature uploaded: ${testFeature.name}`, COLORS.blue);
    
    return { success: true };
  } catch (error) {
    log(`❌ Upload failed: ${error.message}`, COLORS.red);
    if (error.statusCode) {
      log(`   HTTP Status: ${error.statusCode}`, COLORS.red);
    }
    return { success: false, error: error.message };
  }
}

async function testBatchUpload(client) {
  logSection("5. Batch Upload Test");

  try {
    const features = [
      {
        name: "test-batch-1.feature",
        content: `Feature: Batch Test 1
  @batch-test @automated
  Scenario: First batch test
    Given this is the first test
    Then it should pass
`,
      },
      {
        name: "test-batch-2.feature",
        content: `Feature: Batch Test 2
  @batch-test @automated
  Scenario: Second batch test
    Given this is the second test
    Then it should also pass
`,
      },
    ];

    log(`Attempting to upload ${features.length} features in batch...`, COLORS.yellow);
    
    const result = await client.uploadFeatures(features);

    log(`✅ Batch upload completed!`, COLORS.green);
    log(`   Uploaded: ${result.uploaded}`, COLORS.blue);
    log(`   Failed: ${result.failed}`, COLORS.blue);
    
    if (result.errors.length > 0) {
      log(`   Errors:`, COLORS.yellow);
      result.errors.forEach((err) => {
        log(`     - ${err.feature}: ${err.error}`, COLORS.yellow);
      });
    }
    
    return { success: result.success, uploaded: result.uploaded, failed: result.failed };
  } catch (error) {
    log(`❌ Batch upload failed: ${error.message}`, COLORS.red);
    return { success: false, error: error.message };
  }
}

async function cleanup() {
  logSection("6. Cleanup");

  try {
    const tempFile = "./test-download.zip";
    await fs.unlink(tempFile);
    log(`✅ Cleaned up temporary file: ${tempFile}`, COLORS.green);
  } catch (_error) {
    // Ignore cleanup errors
    log(`⚠️  Cleanup skipped (file may not exist)`, COLORS.yellow);
  }
}

async function main() {
  console.log("\n");
  log("╔════════════════════════════════════════════════════════════╗", COLORS.cyan);
  log("║     AssertThat API Integration Test - OG-45               ║", COLORS.cyan);
  log("╚════════════════════════════════════════════════════════════╝", COLORS.cyan);

  const results = {
    config: false,
    client: false,
    download: false,
    upload: false,
    batchUpload: false,
  };

  try {
    // Test 1: Configuration
    const config = await testConfiguration();
    results.config = true;

    // Test 2: API Client
    const client = await testApiClient(config);
    results.client = true;

    // Test 3: Download
    const downloadResult = await testDownload(client);
    results.download = downloadResult.success;

    // Test 4: Upload
    const uploadResult = await testUpload(client);
    results.upload = uploadResult.success;

    // Test 5: Batch Upload
    const batchResult = await testBatchUpload(client);
    results.batchUpload = batchResult.success;

    // Cleanup
    await cleanup();

    // Summary
    logSection("Test Summary");
    log(`Configuration:  ${results.config ? "✅ PASS" : "❌ FAIL"}`, results.config ? COLORS.green : COLORS.red);
    log(`API Client:     ${results.client ? "✅ PASS" : "❌ FAIL"}`, results.client ? COLORS.green : COLORS.red);
    log(`Download:       ${results.download ? "✅ PASS" : "❌ FAIL"}`, results.download ? COLORS.green : COLORS.red);
    log(`Upload:         ${results.upload ? "✅ PASS" : "❌ FAIL"}`, results.upload ? COLORS.green : COLORS.red);
    log(`Batch Upload:   ${results.batchUpload ? "✅ PASS" : "❌ FAIL"}`, results.batchUpload ? COLORS.green : COLORS.red);

    const allPassed = Object.values(results).every((r) => r === true);
    
    console.log("\n" + "=".repeat(60));
    if (allPassed) {
      log("🎉 ALL TESTS PASSED! AssertThat API integration is working!", COLORS.green);
    } else {
      log("⚠️  Some tests failed. Check the output above for details.", COLORS.yellow);
    }
    console.log("=".repeat(60) + "\n");

    process.exit(allPassed ? 0 : 1);
  } catch (error) {
    logSection("Fatal Error");
    log(`❌ ${error.message}`, COLORS.red);
    console.error(error);
    process.exit(1);
  }
}

// Run the tests
main();

