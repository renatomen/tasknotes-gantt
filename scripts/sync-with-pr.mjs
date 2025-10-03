#!/usr/bin/env node

/**
 * OG-47: Sync with PR Creation
 *
 * Entry point for automated sync with PR creation
 * Combines sync operation with PR automation
 */

import dotenv from 'dotenv';
import { PRAutomation } from './automation/PRAutomation.mjs';
import { SyncConfiguration } from './config/SyncConfiguration.mjs';
import { AssertThatApiClient } from './api/AssertThatApiClient.mjs';
import { IdBasedDiffManager } from './diff/IdBasedDiffManager.mjs';
import { FeatureFileUpdater } from './updater/FeatureFileUpdater.mjs';
import { FeatureFileComposer } from './composer/FeatureFileComposer.mjs';

// Load environment variables
dotenv.config();

async function main() {
  console.log('🔄 Starting automated sync with PR creation...\n');

  try {
    // Create configuration
    const config = SyncConfiguration.fromEnvironment();

    // Validate configuration
    const validation = config.validateConfiguration();
    if (!validation.isValid) {
      console.error('❌ Configuration validation failed:');
      validation.missingFields.forEach(field => {
        console.error(`   - Missing: ${field}`);
      });
      process.exit(1);
    }

    console.log('✅ Configuration validated\n');

    // Step 1: Use ID-based diff to detect changes
    console.log('🔍 Detecting changes using V2 API...');

    const apiClient = new AssertThatApiClient({
      projectId: config.assertThat.projectId,
      accessKey: config.assertThat.accessKey,
      secretKey: config.assertThat.secretKey,
      token: config.assertThat.token,
    });

    const diffManager = new IdBasedDiffManager({
      config,
      apiClient,
      featuresDir: config.featuresDir,
    });

    // Detect changes
    const changes = await diffManager.detectChanges();

    const totalChanges = changes.additions.length + changes.modifications.length + changes.deletions.length;

    console.log(`\n📊 Changes detected:`);
    console.log(`   🆕 Additions: ${changes.additions.length}`);
    console.log(`   ✏️  Modifications: ${changes.modifications.length}`);
    console.log(`   🗑️  Deletions: ${changes.deletions.length}`);
    console.log(`   📝 Total: ${totalChanges}`);

    if (totalChanges === 0) {
      console.log('\n✅ No changes detected');
      process.exit(0);
    }

    // Step 2: Fetch all scenarios from V2 API (includes full content with steps)
    console.log('\n📥 Fetching all scenarios from AssertThat V2 API...');
    const allScenarios = await apiClient.getAllScenarios();
    console.log(`✅ Fetched ${allScenarios.length} scenarios`);

    // Step 3: Check if we have existing feature files or need to create from scratch
    const fs = await import('fs/promises');
    const existingFiles = await fs.readdir(config.featuresDir);
    const hasFeatureFiles = existingFiles.some(f => f.endsWith('.feature'));

    let stats;

    if (!hasFeatureFiles) {
      // No existing files - create all from V2 API (baseline reset)
      console.log('\n📝 Creating all feature files from V2 API (baseline reset)...');

      const composer = new FeatureFileComposer();
      const featureFiles = composer.composeAllFeatures(allScenarios);
      stats = await composer.writeFeatureFiles(featureFiles, config.featuresDir);

      console.log(`✅ Created ${stats.filesWritten} files with ${stats.totalScenarios} scenarios`);
    } else {
      // Existing files - update only changed scenarios
      const changedScenarioIds = new Set([
        ...changes.modifications.map(m => m.scenarioId),
        ...changes.additions.map(a => a.scenarioId),
      ]);

      const changedScenarios = allScenarios.filter(s => changedScenarioIds.has(s.id));

      console.log(`\n📝 Updating ${changedScenarios.length} changed scenarios...`);

      const updater = new FeatureFileUpdater();
      stats = await updater.updateFeatureFiles(config.featuresDir, changedScenarios);

      console.log(`✅ Updated ${stats.filesUpdated} files, ${stats.scenariosUpdated} scenarios changed`);
      console.log(`   ${stats.filesUnchanged} files unchanged`);
    }

    // Step 4: Check git diff to see what actually changed
    const { execSync } = await import('child_process');
    const gitStatus = execSync('git status --porcelain features/', { encoding: 'utf-8' }).trim();

    if (!gitStatus) {
      console.log('\n✅ No file changes after processing');
      process.exit(0);
    }

    console.log('\n📝 File changes:');
    console.log(gitStatus);

    // Determine if we should create a PR
    const shouldCreatePR = process.env.CREATE_PR !== 'false';
    
    if (!shouldCreatePR) {
      console.log('\n⏭️  Skipping PR creation (CREATE_PR=false)');
      process.exit(0);
    }

    // Create PR automation instance
    console.log('\n🔀 Creating pull request...');
    const prAutomation = new PRAutomation({ config });

    // Build sync result for PR creation (empty since we just downloaded all features)
    const syncResult = {
      additions: [],
      modifications: [],
      deletions: [],
    };

    // Execute PR workflow
    const prResult = await prAutomation.executeWorkflow(syncResult);

    console.log('\n✅ PR workflow completed:');
    console.log(`   - Branch: ${prResult.branchName}`);
    console.log(`   - PR Number: #${prResult.prNumber}`);
    console.log(`   - Has Conflicts: ${prResult.hasConflicts}`);
    console.log(`   - Auto-merge: ${!prResult.hasConflicts}`);

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Sync with PR creation failed:', error.message);
    if (error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Execute main function
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

export { main };

