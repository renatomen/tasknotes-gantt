#!/usr/bin/env node

/**
 * GitHub ↔ AssertThat BDD Feature Sync
 * Entry point for bidirectional feature file synchronization
 * Uses event-driven modular architecture from OG-50/OG-51
 */

import dotenv from "dotenv";
import { FeatureSyncOrchestrator } from "./orchestration/FeatureSyncOrchestrator.mjs";
import { SyncConfiguration } from "./config/SyncConfiguration.mjs";

// Load environment variables
dotenv.config();

/**
 * Main execution
 */
async function main() {
  try {
    console.log("🚀 Starting GitHub ↔ AssertThat feature sync...\n");

    // Initialize configuration
    const config = new SyncConfiguration();

    // Validate environment variables
    const validation = config.validateConfiguration();
    if (!validation.isValid) {
      console.error("❌ Configuration validation failed:");
      validation.missingFields.forEach((field) => console.error(`  - ${field}`));
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

// Execute main
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

export { main };

