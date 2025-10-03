#!/usr/bin/env node

/**
 * Create File Mapping Between GitHub and AssertThat
 * 
 * AssertThat uses numbered filenames as stable identifiers:
 * - 1-virtual-task-handling-for-multi-parent-scenarios.feature
 * - 2-task-rendering-in-gantt-chart.feature
 * - etc.
 * 
 * This script creates a mapping file that maps GitHub feature files
 * to AssertThat numbered files based on feature name matching.
 * 
 * Usage: node scripts/create-file-mapping.mjs
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const featuresDir = path.join(rootDir, 'features');
const stagingDir = path.join(rootDir, 'featureSyncStage');

/**
 * Extract feature name from feature file content
 */
function extractFeatureName(content) {
  const match = content.match(/^Feature:\s*(.+)$/m);
  return match ? match[1].trim() : null;
}

/**
 * Load feature files from a directory
 */
async function loadFeatureFiles(dir) {
  const files = await fs.readdir(dir);
  const features = [];

  for (const file of files) {
    if (file.endsWith('.feature')) {
      const filePath = path.join(dir, file);
      const content = await fs.readFile(filePath, 'utf-8');
      const featureName = extractFeatureName(content);
      
      features.push({
        filename: file,
        path: filePath,
        featureName,
        content,
      });
    }
  }

  return features;
}

/**
 * Create mapping between GitHub and AssertThat files
 */
function createMapping(githubFeatures, assertThatFeatures) {
  const mapping = [];
  const unmapped = {
    github: [],
    assertThat: [],
  };

  // Create a map of AssertThat features by feature name
  const atByName = new Map();
  for (const atFeature of assertThatFeatures) {
    atByName.set(atFeature.featureName, atFeature);
  }

  // Match GitHub features to AssertThat features
  for (const ghFeature of githubFeatures) {
    const atFeature = atByName.get(ghFeature.featureName);
    
    if (atFeature) {
      mapping.push({
        github: ghFeature.filename,
        assertThat: atFeature.filename,
        featureName: ghFeature.featureName,
      });
      atByName.delete(ghFeature.featureName);
    } else {
      unmapped.github.push(ghFeature);
    }
  }

  // Remaining AssertThat features are unmapped
  unmapped.assertThat = Array.from(atByName.values());

  return { mapping, unmapped };
}

/**
 * Main workflow
 */
async function createFileMapping() {
  console.log('🗺️  Create File Mapping Between GitHub and AssertThat\n');
  console.log('='.repeat(60));
  console.log('');

  // Load GitHub features
  console.log('📂 Loading GitHub feature files...\n');
  const githubFeatures = await loadFeatureFiles(featuresDir);
  console.log(`   Found ${githubFeatures.length} GitHub features\n`);

  // Load AssertThat features from staging
  console.log('📂 Loading AssertThat feature files from staging...\n');
  const assertThatFeatures = await loadFeatureFiles(stagingDir);
  console.log(`   Found ${assertThatFeatures.length} AssertThat features\n`);

  // Create mapping
  console.log('🔗 Creating mapping...\n');
  const { mapping, unmapped } = createMapping(githubFeatures, assertThatFeatures);

  // Display mapping
  console.log(`📊 Mapping Results:\n`);
  console.log(`   ✅ Mapped: ${mapping.length}`);
  console.log(`   ⚠️  Unmapped GitHub: ${unmapped.github.length}`);
  console.log(`   ⚠️  Unmapped AssertThat: ${unmapped.assertThat.length}\n`);

  if (mapping.length > 0) {
    console.log('📋 File Mapping:\n');
    for (const map of mapping) {
      console.log(`   ${map.github}`);
      console.log(`      → ${map.assertThat}`);
      console.log(`      Feature: ${map.featureName}\n`);
    }
  }

  if (unmapped.github.length > 0) {
    console.log('⚠️  Unmapped GitHub Features:\n');
    for (const feature of unmapped.github) {
      console.log(`   ${feature.filename} - "${feature.featureName}"`);
    }
    console.log('');
  }

  if (unmapped.assertThat.length > 0) {
    console.log('⚠️  Unmapped AssertThat Features (new from AssertThat):\n');
    for (const feature of unmapped.assertThat) {
      console.log(`   ${feature.filename} - "${feature.featureName}"`);
    }
    console.log('');
  }

  // Save mapping to JSON file
  const mappingFile = path.join(rootDir, '.assertthat-mapping.json');
  const mappingData = {
    version: '1.0',
    createdAt: new Date().toISOString(),
    mapping: mapping.map(m => ({
      github: m.github,
      assertThat: m.assertThat,
      featureName: m.featureName,
    })),
    unmapped: {
      github: unmapped.github.map(f => ({
        filename: f.filename,
        featureName: f.featureName,
      })),
      assertThat: unmapped.assertThat.map(f => ({
        filename: f.filename,
        featureName: f.featureName,
      })),
    },
  };

  await fs.writeFile(mappingFile, JSON.stringify(mappingData, null, 2), 'utf-8');
  console.log(`💾 Mapping saved to: .assertthat-mapping.json\n`);

  // Recommendations
  console.log('📝 Recommendations:\n');
  
  if (unmapped.assertThat.length > 0) {
    console.log('   1. Review new features from AssertThat:');
    for (const feature of unmapped.assertThat) {
      console.log(`      - ${feature.featureName}`);
    }
    console.log('   2. Decide whether to keep or remove them');
    console.log('   3. Update GitHub features accordingly\n');
  }

  if (unmapped.github.length > 0) {
    console.log('   1. GitHub features not found in AssertThat:');
    for (const feature of unmapped.github) {
      console.log(`      - ${feature.featureName}`);
    }
    console.log('   2. These may have been deleted or renamed in AssertThat');
    console.log('   3. Re-upload if needed\n');
  }

  console.log('✅ Next steps:');
  console.log('   1. Review the mapping file: .assertthat-mapping.json');
  console.log('   2. Rename GitHub files to match AssertThat numbered format');
  console.log('   3. Or update sync logic to use the mapping file');
  console.log('   4. Commit the mapping file to track the relationship\n');
}

// Run
createFileMapping().catch(error => {
  console.error('\n❌ Error:', error.message);
  console.error(error.stack);
  process.exit(1);
});

