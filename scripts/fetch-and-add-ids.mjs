#!/usr/bin/env node

/**
 * Fetch AssertThat IDs and Add to Feature Files
 * 
 * This script:
 * 1. Calls AssertThat API to get all scenarios with IDs
 * 2. Maps scenarios to GitHub feature files by name
 * 3. Adds @assertthat-scenario-id comments to feature files
 * 4. Shows diff for review
 * 
 * Usage: node scripts/fetch-and-add-ids.mjs
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';
import dotenv from 'dotenv';
import { FeatureMetadataManager } from './metadata/FeatureMetadataManager.mjs';
import { SyncConfiguration } from './config/SyncConfiguration.mjs';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const featuresDir = path.join(rootDir, 'features');

/**
 * Fetch scenarios from AssertThat API
 * Note: This uses an undocumented endpoint that returns scenario metadata
 */
async function fetchScenariosFromApi(config) {
  return new Promise((resolve, reject) => {
    const auth = Buffer.from(
      `${config.assertThat.accessKey}:${config.assertThat.secretKey}`
    ).toString('base64');

    const options = {
      hostname: 'bdd.assertthat.app',
      path: `/rest/api/1/project/${config.assertThat.projectId}/scenarios`,
      method: 'GET',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Accept': 'application/json',
      },
    };

    console.log(`🌐 API Request: GET https://${options.hostname}${options.path}`);

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const json = JSON.parse(data);
            resolve(json);
          } catch (error) {
            reject(new Error(`Failed to parse JSON: ${error.message}`));
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.end();
  });
}

/**
 * Load feature files from features/ directory
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
 * Extract feature name from feature file content
 */
function extractFeatureName(content) {
  const match = content.match(/^Feature:\s*(.+)$/m);
  return match ? match[1].trim() : null;
}

/**
 * Extract scenario names from feature file content
 */
function extractScenarioNames(content) {
  const scenarios = [];
  const lines = content.split('\n');

  for (const line of lines) {
    const match = line.match(/^\s*(?:@\S+\s+)*Scenario(?:\s+Outline)?:\s*(.+)$/);
    if (match) {
      scenarios.push(match[1].trim());
    }
  }

  return scenarios;
}

/**
 * Main workflow
 */
async function fetchAndAddIds() {
  console.log('🔑 Fetch AssertThat IDs and Add to Feature Files\n');
  console.log('='.repeat(60));
  console.log('');

  // Load configuration
  console.log('📋 Loading configuration...\n');
  const config = new SyncConfiguration();
  config.validateConfiguration();

  // Fetch scenarios from API
  console.log('📥 Fetching scenarios from AssertThat API...\n');
  
  let apiResponse;
  try {
    apiResponse = await fetchScenariosFromApi(config);
    console.log(`✅ Fetched ${apiResponse.scenarios?.length || 0} scenarios\n`);
  } catch (error) {
    console.error(`❌ API Error: ${error.message}\n`);
    console.log('⚠️  The /scenarios endpoint may not be available.');
    console.log('   Trying alternative approach: parsing downloaded features...\n');
    
    // Alternative: Parse the downloaded features from staging
    console.log('📂 Reading downloaded features from staging area...\n');
    const stagingDir = path.join(rootDir, 'featureSyncStage');
    
    try {
      const stagingFiles = await fs.readdir(stagingDir);
      console.log(`   Found ${stagingFiles.filter(f => f.endsWith('.feature')).length} feature files in staging\n`);
      
      console.log('⚠️  Note: Downloaded features do not contain AssertThat IDs.');
      console.log('   AssertThat IDs are only available through the API response.');
      console.log('   We need to use a different approach.\n');
      
      console.log('💡 Recommended approach:');
      console.log('   1. Use the numbered filenames from AssertThat as stable identifiers');
      console.log('   2. Create a mapping file that maps GitHub files to AssertThat numbered files');
      console.log('   3. Use this mapping for sync operations\n');
      
      process.exit(1);
    } catch (error) {
      console.error(`❌ Error reading staging: ${error.message}`);
      process.exit(1);
    }
  }

  // Load GitHub features
  console.log('📂 Loading GitHub feature files...\n');
  const features = await loadFeatureFiles();
  console.log(`   Found ${features.length} feature files\n`);

  // Create metadata manager
  const manager = new FeatureMetadataManager();

  // Map scenarios to features
  console.log('🔗 Mapping scenarios to feature files...\n');
  
  const updates = [];
  
  for (const feature of features) {
    const featureName = extractFeatureName(feature.content);
    const scenarioNames = extractScenarioNames(feature.content);
    
    console.log(`   ${feature.name}:`);
    console.log(`      Feature: ${featureName}`);
    console.log(`      Scenarios: ${scenarioNames.length}`);
    
    // Find matching scenarios from API
    const matchingScenarios = apiResponse.scenarios.filter(
      s => s.feature === featureName
    );
    
    if (matchingScenarios.length > 0) {
      console.log(`      ✅ Found ${matchingScenarios.length} matching scenarios in AssertThat`);
      
      // Create metadata
      const metadata = {
        featureId: featureName,
        scenarioIds: new Map(),
      };
      
      for (const scenario of matchingScenarios) {
        metadata.scenarioIds.set(scenario.name, scenario.id);
      }
      
      // Update feature content
      const updatedContent = manager.updateMetadata(feature.content, metadata);
      
      updates.push({
        path: feature.path,
        name: feature.name,
        content: updatedContent,
        scenarioCount: matchingScenarios.length,
      });
    } else {
      console.log(`      ⚠️  No matching scenarios found in AssertThat`);
    }
    
    console.log('');
  }

  // Write updates
  if (updates.length > 0) {
    console.log(`\n📝 Writing updates to ${updates.length} files...\n`);
    
    for (const update of updates) {
      await fs.writeFile(update.path, update.content, 'utf-8');
      console.log(`   ✅ Updated: ${update.name} (${update.scenarioCount} scenarios)`);
    }
    
    console.log('\n✅ All files updated with AssertThat IDs!');
    console.log('\n📝 Next steps:');
    console.log('   1. Review changes: git diff features/');
    console.log('   2. Commit changes: git add features/ && git commit -m "OG-26 feat: Add AssertThat IDs to feature files"');
    console.log('   3. Push changes: git push');
  } else {
    console.log('\n⚠️  No files were updated.');
  }
}

// Run
fetchAndAddIds().catch(error => {
  console.error('\n❌ Error:', error.message);
  console.error(error.stack);
  process.exit(1);
});

