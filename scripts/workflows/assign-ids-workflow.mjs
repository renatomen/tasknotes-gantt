#!/usr/bin/env node

/**
 * Complete ID Assignment Workflow
 * 
 * This script performs the complete workflow to assign AssertThat IDs to GitHub feature files:
 * 1. Upload all GitHub features to AssertThat
 * 2. Fetch scenarios with IDs from V2 API
 * 3. Update GitHub feature files with IDs
 * 4. Show diff for review
 * 
 * Usage: node scripts/workflows/assign-ids-workflow.mjs
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import dotenv from 'dotenv';
import { AssertThatApiClient } from '../api/AssertThatApiClient.mjs';
import { FeatureMetadataManager } from '../metadata/FeatureMetadataManager.mjs';
import { SyncConfiguration } from '../config/SyncConfiguration.mjs';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');
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
 * Match feature files to AssertThat features by name
 */
function matchFeaturesByName(githubFeatures, metadataByFeature) {
  const matches = new Map();
  
  for (const ghFeature of githubFeatures) {
    // Extract feature name from file content
    const featureNameMatch = ghFeature.content.match(/^Feature:\s*(.+)$/m);
    if (!featureNameMatch) {
      console.warn(`   ⚠️  Could not extract feature name from ${ghFeature.name}`);
      continue;
    }
    
    const featureName = featureNameMatch[1].trim();
    
    // Find matching AssertThat metadata
    const metadata = metadataByFeature.get(featureName);
    if (metadata) {
      matches.set(ghFeature.path, {
        githubFeature: ghFeature,
        metadata,
      });
    } else {
      console.warn(`   ⚠️  No AssertThat match for feature: ${featureName}`);
    }
  }
  
  return matches;
}

/**
 * Update feature files with IDs
 */
async function updateFeatureFiles(matches, metadataManager) {
  console.log(`✏️  Updating ${matches.size} feature files with IDs...\n`);
  
  let updated = 0;
  let failed = 0;
  
  for (const [filePath, { githubFeature, metadata }] of matches) {
    try {
      console.log(`   Updating: ${githubFeature.name}`);
      
      // Update content with metadata
      const updatedContent = metadataManager.updateMetadata(githubFeature.content, metadata);
      
      // Write updated content
      await fs.writeFile(filePath, updatedContent, 'utf-8');
      
      updated++;
      console.log(`   ✅ Updated: ${githubFeature.name} (${metadata.scenarioIds.size} scenarios)`);
    } catch (error) {
      failed++;
      console.error(`   ❌ Failed: ${githubFeature.name} - ${error.message}`);
    }
  }
  
  console.log('');
  console.log(`📊 Update Results:`);
  console.log(`   ✅ Updated: ${updated}`);
  console.log(`   ❌ Failed: ${failed}`);
  
  return { updated, failed };
}

/**
 * Show git diff
 */
function showDiff() {
  console.log('\n📋 Changes made to feature files:\n');
  console.log('=' .repeat(60));
  
  try {
    const diff = execSync('git diff features/', { encoding: 'utf-8', cwd: rootDir });
    
    if (diff.trim()) {
      console.log(diff);
    } else {
      console.log('No changes detected.');
    }
  } catch (error) {
    console.error('Could not generate diff:', error.message);
  }
  
  console.log('=' .repeat(60));
}

/**
 * Main workflow
 */
async function assignIds() {
  console.log('🔑 AssertThat ID Assignment Workflow\n');
  console.log('=' .repeat(60));
  console.log('');

  try {
    // Load configuration
    console.log('📋 Step 1: Loading configuration...\n');
    const config = new SyncConfiguration();
    config.validateConfiguration();

    // Initialize API client and metadata manager
    const apiClient = new AssertThatApiClient({
      projectId: config.assertThat.projectId,
      accessKey: config.assertThat.accessKey,
      secretKey: config.assertThat.secretKey,
      token: config.assertThat.token,
      jiraServerUrl: undefined, // Use AssertThat Cloud
    });
    
    const metadataManager = new FeatureMetadataManager();

    // Load GitHub features
    console.log('📂 Step 2: Loading GitHub feature files...\n');
    const features = await loadFeatureFiles();
    console.log(`   Found ${features.length} feature files\n`);

    // Upload to AssertThat
    console.log('📤 Step 3: Uploading features to AssertThat...\n');
    const uploadResults = await uploadFeatures(apiClient, features);
    
    if (uploadResults.failed > 0) {
      console.log('\n⚠️  Some uploads failed. Continuing with ID assignment for successful uploads...\n');
    }

    // Wait for AssertThat to process uploads
    console.log('\n⏳ Waiting 5 seconds for AssertThat to process uploads...\n');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Fetch scenarios with IDs
    console.log('📥 Step 4: Fetching scenarios with IDs from V2 API...\n');
    const allScenarios = await apiClient.getAllScenarios();
    console.log(`   Found ${allScenarios.length} scenarios with IDs\n`);

    // Extract metadata
    console.log('🔍 Step 5: Extracting metadata...\n');
    const metadataByFeature = metadataManager.extractFromApiResponse({ scenarios: allScenarios });
    console.log(`   Extracted metadata for ${metadataByFeature.size} features\n`);

    // Match features
    console.log('🔗 Step 6: Matching GitHub features to AssertThat features...\n');
    const matches = matchFeaturesByName(features, metadataByFeature);
    console.log(`   Matched ${matches.size} features\n`);

    // Update feature files
    console.log('✏️  Step 7: Updating feature files with IDs...\n');
    const updateResults = await updateFeatureFiles(matches, metadataManager);

    // Show diff
    if (updateResults.updated > 0) {
      showDiff();
    }

    // Summary
    console.log('\n\n' + '=' .repeat(60));
    console.log('✅ ID Assignment Workflow Complete\n');
    
    console.log('📊 Summary:');
    console.log(`   Features uploaded: ${uploadResults.uploaded}`);
    console.log(`   Scenarios fetched: ${allScenarios.length}`);
    console.log(`   Features updated: ${updateResults.updated}`);
    
    if (updateResults.updated > 0) {
      console.log('\n📝 Next steps:');
      console.log('   1. Review changes: git diff features/');
      console.log('   2. Test a feature file to verify IDs are correct');
      console.log('   3. Commit: git add features/ && git commit -m "OG-26 feat: Add AssertThat IDs to feature files"');
    } else {
      console.log('\n⚠️  No features were updated. Check warnings above.');
    }
    
    console.log('');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error('\n📋 Stack trace:');
    console.error(error.stack);
    console.error('');
    process.exit(1);
  }
}

// Run
assignIds();

