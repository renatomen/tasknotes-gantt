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
        // Check if name changed
        const nameChanged = github.scenarioName !== assertThat.name;

        // Check if content (steps) changed
        const contentChanged = this.hasContentChanged(github, assertThat);

        if (nameChanged || contentChanged) {
          modifications.push({
            scenarioId,
            oldName: github.scenarioName,
            newName: assertThat.name,
            feature: assertThat.feature,
            type: nameChanged ? "renamed" : "content-changed",
            nameChanged,
            contentChanged,
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

  /**
   * Check if scenario content (steps) has changed
   *
   * @param {Object} github - GitHub scenario data
   * @param {Object} assertThat - AssertThat scenario data
   * @returns {boolean} True if content changed
   */
  hasContentChanged(github, assertThat) {
    // Extract steps from GitHub scenario
    const githubSteps = this.extractStepsFromGitHub(github);

    // Extract steps from AssertThat scenario
    const assertThatSteps = this.extractStepsFromAssertThat(assertThat);

    // Compare normalized steps
    return githubSteps !== assertThatSteps;
  }

  /**
   * Extract and normalize steps from GitHub scenario
   *
   * @param {Object} github - GitHub scenario data
   * @returns {string} Normalized steps string
   */
  extractStepsFromGitHub(github) {
    // GitHub scenario data has feature.content (full file) and scenarioName
    if (!github.feature || !github.feature.content) return '';

    const content = github.feature.content;
    const scenarioName = github.scenarioName;

    // Find the scenario by name in the content
    const lines = content.split('\n');
    let scenarioIndex = -1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes('Scenario:') && line.includes(scenarioName)) {
        scenarioIndex = i;
        break;
      }
    }

    if (scenarioIndex === -1) return '';

    // Get all lines after scenario until next scenario or end
    const steps = [];
    for (let i = scenarioIndex + 1; i < lines.length; i++) {
      const line = lines[i].trim();

      // Stop at next scenario, tag, or ID comment
      if (line.startsWith('Scenario:') ||
          line.startsWith('@') ||
          line.startsWith('# assertthat-scenario-id:')) {
        break;
      }

      if (line.length > 0) {
        steps.push(line);
      }
    }

    return steps.join('\n');
  }

  /**
   * Extract and normalize steps from AssertThat scenario
   *
   * @param {Object} assertThat - AssertThat scenario data
   * @returns {string} Normalized steps string
   */
  extractStepsFromAssertThat(assertThat) {
    if (!assertThat.steps) return '';

    // AssertThat steps come as a string with newlines
    return assertThat.steps
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .join('\n');
  }
}
