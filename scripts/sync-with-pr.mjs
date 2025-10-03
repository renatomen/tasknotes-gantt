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
import fs from 'fs/promises';
import path from 'path';

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

    // Step 2: Download changed scenarios and update feature files
    console.log('\n📥 Fetching updated scenarios from AssertThat...');
    const allScenarios = await apiClient.getAllScenarios();
    console.log(`✅ Fetched ${allScenarios.length} scenarios`);

    // Step 3: Update feature files with changes
    console.log('\n📝 Updating feature files...');

    for (const addition of changes.additions) {
      console.log(`   🆕 Adding: ${addition.scenarioName} (${addition.feature})`);
      // Find the scenario in allScenarios
      const scenario = allScenarios.find(s => s.id === addition.scenarioId);
      if (scenario) {
        // Find or create the feature file
        const featureFileName = `${addition.feature.toLowerCase().replace(/\s+/g, '-')}.feature`;
        const featureFilePath = path.join(config.featuresDir, featureFileName);

        // For now, just log - we'll need to implement proper feature file creation
        console.log(`      → Would create/update: ${featureFilePath}`);
      }
    }

    for (const modification of changes.modifications) {
      console.log(`   ✏️  Renaming: ${modification.oldName} → ${modification.newName}`);
      // Find the feature file containing this scenario ID
      const featureFiles = await fs.readdir(config.featuresDir);
      for (const file of featureFiles) {
        if (!file.endsWith('.feature')) continue;

        const filePath = path.join(config.featuresDir, file);
        let content = await fs.readFile(filePath, 'utf-8');

        // Check if this file contains the scenario ID
        if (content.includes(`# @assertthat-scenario-id: ${modification.scenarioId}`)) {
          // Update the scenario name in the file
          const scenarioRegex = new RegExp(
            `(# @assertthat-scenario-id: ${modification.scenarioId}\\s+Scenario: )${modification.oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
            'g'
          );
          content = content.replace(scenarioRegex, `$1${modification.newName}`);
          await fs.writeFile(filePath, content, 'utf-8');
          console.log(`      → Updated: ${file}`);
          break;
        }
      }
    }

    // Step 4: Check if there are actual file changes
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

