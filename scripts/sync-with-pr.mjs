#!/usr/bin/env node

/**
 * OG-47: Sync with PR Creation
 * 
 * Entry point for automated sync with PR creation
 * Combines sync operation with PR automation
 */

import { FeatureSyncOrchestrator } from './orchestration/FeatureSyncOrchestrator.mjs';
import { PRAutomation } from './automation/PRAutomation.mjs';
import { SyncConfiguration } from './config/SyncConfiguration.mjs';

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

    // Run sync operation
    console.log('📥 Running sync operation...');
    const orchestrator = new FeatureSyncOrchestrator({ config });
    await orchestrator.execute();

    // Get sync results
    const stats = orchestrator.getStats();
    console.log('\n📊 Sync Statistics:');
    console.log(`   - Conflicts: ${stats.conflicts?.total || 0}`);
    console.log(`   - Validation errors: ${stats.validation?.errors || 0}`);

    // Determine if we should create a PR
    const shouldCreatePR = process.env.CREATE_PR !== 'false';
    
    if (!shouldCreatePR) {
      console.log('\n⏭️  Skipping PR creation (CREATE_PR=false)');
      process.exit(0);
    }

    // Create PR automation instance
    console.log('\n🔀 Creating pull request...');
    const prAutomation = new PRAutomation({ config });

    // Build sync result for PR creation
    const syncResult = {
      additions: [],
      modifications: stats.conflicts?.complex || [],
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

// Execute if run directly
if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`) {
  main();
}

export { main };

