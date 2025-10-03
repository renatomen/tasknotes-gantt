#!/usr/bin/env node

/**
 * Debug script to show all scenarios for a specific feature
 * Helps diagnose sync issues
 */

import dotenv from "dotenv";
import { AssertThatApiClient } from "./api/AssertThatApiClient.mjs";
import { SyncConfiguration } from "./config/SyncConfiguration.mjs";

dotenv.config();

async function debugScenarios() {
  try {
    console.log("🔍 Debugging AssertThat Scenarios\n");
    console.log("=" .repeat(60));
    console.log("");

    // Initialize
    const config = new SyncConfiguration();
    config.validateConfiguration();

    const apiClient = new AssertThatApiClient({
      projectId: config.assertThat.projectId,
      accessKey: config.assertThat.accessKey,
      secretKey: config.assertThat.secretKey,
      token: config.assertThat.token,
      jiraServerUrl: undefined,
    });

    // Fetch all scenarios
    console.log("📥 Fetching all scenarios from AssertThat...\n");
    const allScenarios = await apiClient.getAllScenarios();
    
    console.log(`✅ Found ${allScenarios.length} total scenarios\n`);
    console.log("=" .repeat(60));
    console.log("");

    // Group by feature
    const byFeature = new Map();
    const byMode = new Map();

    for (const scenario of allScenarios) {
      // By feature
      if (!byFeature.has(scenario.feature)) {
        byFeature.set(scenario.feature, []);
      }
      byFeature.get(scenario.feature).push(scenario);

      // By mode
      const mode = scenario.mode || "unknown";
      if (!byMode.has(mode)) {
        byMode.set(mode, 0);
      }
      byMode.set(mode, byMode.get(mode) + 1);
    }

    // Show by mode
    console.log("📊 Scenarios by Mode:");
    for (const [mode, count] of byMode) {
      console.log(`   ${mode}: ${count}`);
    }
    console.log("");
    console.log("=" .repeat(60));
    console.log("");

    // Show BDD Framework Validation in detail
    console.log("🔍 BDD Framework Validation Feature (detailed):\n");
    
    const bddScenarios = byFeature.get("BDD Framework Validation") || [];
    console.log(`   Total scenarios: ${bddScenarios.length}\n`);

    for (const scenario of bddScenarios) {
      console.log(`   📝 Scenario: "${scenario.name}"`);
      console.log(`      ID: ${scenario.id}`);
      console.log(`      Mode: ${scenario.mode}`);
      console.log(`      Created: ${scenario.created_at}`);
      console.log(`      Updated: ${scenario.updated_at}`);
      console.log(`      Deleted: ${scenario.deleted}`);
      console.log(`      Tags: ${scenario.tags.join(", ") || "none"}`);
      console.log("");
    }

    console.log("=" .repeat(60));
    console.log("");

    // Show all features with counts
    console.log("📋 All Features:");
    const sortedFeatures = Array.from(byFeature.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    
    for (const [feature, scenarios] of sortedFeatures) {
      console.log(`   ${feature}: ${scenarios.length} scenarios`);
    }

    console.log("");
    console.log("=" .repeat(60));
    console.log("✅ Debug complete!");

  } catch (error) {
    console.error("\n❌ Error:", error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

debugScenarios();

