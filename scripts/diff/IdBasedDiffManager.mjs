/**
 * OG-47 Phase 8: ID-Based Diff Manager
 * 
 * Detects changes between GitHub and AssertThat using scenario IDs
 * Compatible with FeatureSyncOrchestrator interface
 */

import fs from "fs/promises";
import path from "path";
import { FeatureMetadataManager } from "../metadata/FeatureMetadataManager.mjs";

export class IdBasedDiffManager {
  constructor({ config, apiClient, featuresDir }) {
    this.config = config;
    this.apiClient = apiClient;
    this.featuresDir = featuresDir || config.featuresDir;
    this.metadataManager = new FeatureMetadataManager();
  }

  async loadGitHubFeatures() {
    const featuresPath = path.resolve(this.featuresDir);
    const features = [];

    // Recursive function to find all .feature files
    async function findFeatureFiles(dir) {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          await findFeatureFiles(fullPath);
        } else if (entry.name.endsWith(".feature")) {
          const content = await fs.readFile(fullPath, "utf-8");
          features.push({ filename: entry.name, content });
        }
      }
    }

    await findFeatureFiles(featuresPath);

    console.log(`📂 Loaded ${features.length} GitHub feature files`);
    return features;
  }

  async detectChanges() {
    const githubFeatures = await this.loadGitHubFeatures();
    const assertThatScenarios = await this.apiClient.getAllScenarios();
    console.log(`📥 Fetched ${assertThatScenarios.length} AssertThat scenarios`);

    const mapping = this.metadataManager.createScenarioMapping(
      githubFeatures,
      assertThatScenarios
    );
    console.log(`🔗 Created mapping for ${mapping.size} scenarios`);

    const additions = [];
    const modifications = [];
    const deletions = [];

    for (const [scenarioId, { github, assertThat }] of mapping) {
      if (!github && assertThat) {
        additions.push({
          scenarioId,
          scenarioName: assertThat.name,
          feature: assertThat.feature,
          type: "new",
        });
      } else if (github && !assertThat) {
        deletions.push({
          scenarioId,
          scenarioName: github.scenarioName,
          feature: github.featureName,
          type: "deleted",
        });
      } else if (github && assertThat) {
        if (github.scenarioName !== assertThat.name) {
          modifications.push({
            scenarioId,
            oldName: github.scenarioName,
            newName: assertThat.name,
            feature: assertThat.feature,
            type: "renamed",
          });
        }
      }
    }

    console.log(`\n📊 Changes detected:`);
    console.log(`   🆕 Additions: ${additions.length}`);
    console.log(`   ✏️  Modifications: ${modifications.length}`);
    console.log(`   🗑️  Deletions: ${deletions.length}`);

    return { additions, modifications, deletions };
  }

  async classifyChanges(changes) {
    const simple = [];
    const complex = [];
    const autoResolved = [];

    simple.push(...changes.additions);
    simple.push(...changes.modifications);
    complex.push(...changes.deletions);

    console.log(`\n🔍 Change classification:`);
    console.log(`   ✅ Simple (auto-accept): ${simple.length}`);
    console.log(`   ⚠️  Complex (needs review): ${complex.length}`);
    console.log(`   🤖 Auto-resolved: ${autoResolved.length}`);

    return { simple, complex, autoResolved };
  }

  getStats() {
    return {
      githubFeatures: 0,
      assertThatScenarios: 0,
      inSync: 0,
      needsUpdate: 0,
    };
  }
}
