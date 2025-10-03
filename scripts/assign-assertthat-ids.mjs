#!/usr/bin/env node

/**
 * Assign AssertThat IDs to Feature Files
 * 
 * This script performs the initial ID assignment workflow:
 * 1. Upload all GitHub features to AssertThat
 * 2. Download features from AssertThat (now with IDs)
 * 3. Extract IDs from AssertThat API response
 * 4. Update GitHub feature files with IDs
 * 5. Show diff for review
 * 
 * Usage: node scripts/assign-assertthat-ids.mjs
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { AssertThatApiClient } from './api/AssertThatApiClient.mjs';
import { FeatureMetadataManager } from './metadata/FeatureMetadataManager.mjs';
import { SyncConfiguration } from './config/SyncConfiguration.mjs';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const featuresDir = path.join(rootDir, 'features');

/**
 * Load all feature files from features/ directory
 */
async function loadFeatureFiles() {
  const files = await fs.readdir(featuresDir);
  const features = [];

  for (const file of files) {
    if (file.endsWith('.feature')) {
      const filePath = path.join(featuresDir, file);
      const content = await fs.readFile(filePath, 'utf-8');
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
 * Upload features to AssertThat
 */
async function uploadFeatures(apiClient, features) {
  console.log(`📤 Uploading ${features.length} features to AssertThat...\n`);

  const results = {
    uploaded: 0,
    failed: 0,
    errors: [],
  };

  for (const feature of features) {
    try {
      console.log(`   Uploading: ${feature.name}`);
      await apiClient.uploadFeature(feature, { override: true });
      results.uploaded++;
      console.log(`   ✅ Success: ${feature.name}`);
    } catch (error) {
      results.failed++;
      results.errors.push({
        feature: feature.name,
        error: error.message,
      });
      console.error(`   ❌ Failed: ${feature.name} - ${error.message}`);
    }
  }

  console.log('');
  console.log(`📊 Upload Results:`);
  console.log(`   ✅ Uploaded: ${results.uploaded}`);
  console.log(`   ❌ Failed: ${results.failed}`);
  
  if (results.failed > 0) {
    console.log('\n❌ Errors:');
    for (const error of results.errors) {
      console.log(`   ${error.feature}: ${error.error}`);
    }
  }

  return results;
}

/**
 * Get scenarios from AssertThat API
 */
async function getAssertThatScenarios(apiClient) {
  console.log('\n📥 Fetching scenarios from AssertThat API...\n');

  // Note: AssertThat API doesn't have a direct "get scenarios" endpoint
  // We need to use the download endpoint and parse the response
  // For now, we'll use a workaround by downloading features and parsing them
  
  // TODO: Implement proper API call to get scenarios with IDs
  // For now, return empty array - this will be implemented when we have
  // the actual API endpoint or response format
  
  console.log('⚠️  Note: Direct scenario API endpoint not yet implemented');
  console.log('   Using download + parse approach instead\n');
  
  return [];
}

/**
 * Main workflow
 */
async function assignIds() {
  console.log('🔑 AssertThat ID Assignment Workflow\n');
  console.log('=' .repeat(60));
  console.log('');

  // Load configuration
  console.log('📋 Loading configuration...\n');
  const config = new SyncConfiguration();
  config.validateConfiguration();

  // Initialize API client
  const apiClient = new AssertThatApiClient({
    projectId: config.assertThat.projectId,
    accessKey: config.assertThat.accessKey,
    secretKey: config.assertThat.secretKey,
    token: config.assertThat.token,
    jiraServerUrl: undefined, // Use AssertThat Cloud
  });

  // Load GitHub features
  console.log('📂 Loading GitHub feature files...\n');
  const features = await loadFeatureFiles();
  console.log(`   Found ${features.length} feature files\n`);

  // Upload to AssertThat
  const uploadResults = await uploadFeatures(apiClient, features);
  
  if (uploadResults.failed > 0) {
    console.log('\n⚠️  Some uploads failed. Please fix errors and try again.');
    process.exit(1);
  }

  console.log('\n✅ All features uploaded successfully!');
  console.log('\n📝 Next Steps:');
  console.log('   1. Wait a few seconds for AssertThat to process uploads');
  console.log('   2. Go to AssertThat in Jira to verify features are uploaded');
  console.log('   3. Make changes in AssertThat if needed');
  console.log('   4. Run sync to download features with IDs: npm run sync:assertthat');
  console.log('   5. Extract IDs from downloaded features');
  console.log('   6. Update GitHub files with IDs');
  console.log('   7. Commit changes: git add features/ && git commit -m "OG-26 feat: Add AssertThat IDs to feature files"');
  console.log('');
  console.log('⚠️  Note: Automatic ID extraction from API is not yet implemented.');
  console.log('   You will need to manually extract IDs from AssertThat or use the sync workflow.');
  console.log('');
}

// Run
assignIds().catch(error => {
  console.error('\n❌ Error:', error.message);
  console.error(error.stack);
  process.exit(1);
});

