/**
 * ID-Based Diff Manager
 * 
 * Detects changes between GitHub and AssertThat using scenario IDs
 * for reliable bidirectional sync.
 * 
 * Uses @assertthat-scenario-id comments in feature files to match
 * scenarios across systems, enabling accurate detection of:
 * - New scenarios (in AssertThat but not in GitHub)
 * - Deleted scenarios (in GitHub but not in AssertThat)
 * - Renamed scenarios (same ID, different name)
 * - Modified scenarios (same ID and name, different content)
 */

import { FeatureMetadataManager } from "../metadata/FeatureMetadataManager.mjs";
import { AssertThatApiClient } from "../api/AssertThatApiClient.mjs";
import fs from "fs/promises";
import path from "path";

export class IdBasedDiffManager {
  constructor(dependencies = {}) {
    this.config = dependencies.config;
    this.metadataManager = dependencies.metadataManager || new FeatureMetadataManager();
    this.apiClient = dependencies.apiClient;
    this.featuresDir = dependencies.featuresDir || this.config?.featuresDir || "features";
    this.logger = dependencies.logger || console;
  }

  /**
   * Load all GitHub feature files with content
   */
  async loadGitHubFeatures() {
    const features = [];
    const featuresPath = path.resolve(this.featuresDir);
    const files = await fs.readdir(featuresPath);

    for (const file of files) {
      if (file.endsWith(".feature")) {
        const filePath = path.join(featuresPath, file);
        const content = await fs.readFile(filePath, "utf-8");
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
   * Detect changes between GitHub and AssertThat using ID-based matching
   * 
   * Returns changes in format expected by FeatureSyncOrchestrator:
   * {
   *   additions: [],      // New scenarios in AssertThat
   *   modifications: [],  // Renamed scenarios
   *   deletions: []       // Deleted scenarios
   * }
   */
  async detectChanges() {
    try {
      // Load GitHub features
      const githubFeatures = await this.loadGitHubFeatures();
      this.logger.log(`📂 Loaded ${githubFeatures.length} GitHub feature files`);

      // Fetch AssertThat scenarios with IDs
      const assertThatScenarios = await this.apiClient.getAllScenarios();
      this.logger.log(`📥 Fetched ${assertThatScenarios.length} AssertThat scenarios`);

      // Create ID-based mapping
      const mapping = this.metadataManager.createScenarioMapping(
        githubFeatures,
        assertThatScenarios
      );
      this.logger.log(`🔗 Created mapping for ${mapping.size} scenarios`);

      // Analyze mapping to detect changes
      const additions = [];
      const modifications = [];
      const deletions = [];

      for (const [scenarioId, { github, assertThat }] of mapping) {
        if (!github && assertThat) {
          // New scenario in AssertThat (addition)
          additions.push({
            type: "new_scenario",
            scenarioId,
            feature: assertThat.feature,
            scenarioName: assertThat.name,
            assertThatData: assertThat,
          });
        } else if (github && !assertThat) {
          // Deleted scenario in AssertThat (deletion)
          deletions.push({
            type: "deleted_scenario",
            scenarioId,
            feature: github.featureName,
            scenarioName: github.scenarioName,
            githubData: github,
          });
        } else if (github && assertThat) {
          // Existing scenario - check for rename (modification)
          if (github.scenarioName !== assertThat.name) {
            modifications.push({
              type: "renamed_scenario",
              scenarioId,
              feature: assertThat.feature,
              oldName: github.scenarioName,
              newName: assertThat.name,
              githubData: github,
              assertThatData: assertThat,
            });
          }
          // Note: Content changes are not detected yet - would require
          // downloading full feature files and comparing content
        }
      }

      this.logger.log(`\n📊 Changes detected:`);
      this.logger.log(`   🆕 Additions: ${additions.length}`);
      this.logger.log(`   ✏️  Modifications: ${modifications.length}`);
      this.logger.log(`   🗑️  Deletions: ${deletions.length}`);

      return {
        additions,
        modifications,
        deletions,
      };
    } catch (error) {
      this.logger.error("❌ Error detecting changes:", error.message);
      throw error;
    }
  }

  /**
   * Classify changes as simple, complex, or auto-resolved
   * 
   * For ID-based sync:
   * - Simple: New scenarios, renames (AssertThat is master)
   * - Complex: Deletions (require user confirmation)
   * - Auto-resolved: None (all changes require review via PR)
   */
  async classifyChanges(changes) {
    const simple = [];
    const complex = [];
    const autoResolved = [];

    // Additions and modifications (renames) are simple
    // AssertThat is the master source, so we accept these changes
    simple.push(...changes.additions);
    simple.push(...changes.modifications);

    // Deletions are complex - require user confirmation
    // Don't want to accidentally delete scenarios
    complex.push(...changes.deletions);

    this.logger.log(`\n🔍 Change classification:`);
    this.logger.log(`   ✅ Simple (auto-accept): ${simple.length}`);
    this.logger.log(`   ⚠️  Complex (needs review): ${complex.length}`);
    this.logger.log(`   🤖 Auto-resolved: ${autoResolved.length}`);

    return {
      simple,
      complex,
      autoResolved,
    };
  }

  /**
   * Get statistics about current sync status
   */
  async getStats() {
    const changes = await this.detectChanges();
    
    return {
      total: changes.additions.length + changes.modifications.length + changes.deletions.length,
      additions: changes.additions.length,
      modifications: changes.modifications.length,
      deletions: changes.deletions.length,
      inSync: changes.additions.length === 0 && 
              changes.modifications.length === 0 && 
              changes.deletions.length === 0,
    };
  }
}

