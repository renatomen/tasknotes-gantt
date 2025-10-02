#!/usr/bin/env node

/**
 * GitHub ↔ AssertThat BDD Feature Sync
 * Entry point for bidirectional feature file synchronization
 * Uses event-driven modular architecture from OG-50/OG-51
 */

import { FeatureSyncOrchestrator } from "./orchestration/FeatureSyncOrchestrator.mjs";
import { SyncConfiguration } from "./config/SyncConfiguration.mjs";

/**
 * Main execution
 */
async function main() {
  try {
    console.log("🚀 Starting GitHub ↔ AssertThat feature sync...\n");

    // Initialize configuration
    const config = new SyncConfiguration();
    
    // Validate environment variables
    const validation = config.validate();
    if (!validation.isValid) {
      console.error("❌ Configuration validation failed:");
      validation.errors.forEach((error) => console.error(`  - ${error}`));
      process.exit(1);
    }

    // Create and execute orchestrator
    const orchestrator = new FeatureSyncOrchestrator({ config });
    await orchestrator.execute();

    console.log("\n✅ Sync completed successfully!");
    process.exit(0);
  } catch (error) {
    console.error("\n❌ Sync failed:", error.message);
    if (error.stack) {
      console.error("\nStack trace:");
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Execute if run directly
if (import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}`) {
  main();
}

export { main };

