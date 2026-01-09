/**
 * FeatureMetadataManager - Manages AssertThat ID metadata in feature files
 * 
 * Stores AssertThat unique IDs as comments in feature files for reliable tracking:
 * - Feature-level ID for the entire feature file
 * - Scenario-level IDs for each scenario
 * 
 * This enables resilient sync even when feature/scenario names change.
 */

import fs from 'fs/promises';

export class FeatureMetadataManager {
  /**
   * Extract AssertThat metadata from feature file content
   * 
   * @param {string} content - Feature file content
   * @returns {Object} Metadata object with feature and scenario IDs
   */
  extractMetadata(content) {
    const metadata = {
      featureId: null,
      scenarioIds: new Map(), // Map<scenarioName, id>
    };

    const lines = content.split('\n');
    let pendingScenarioId = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Extract feature-level ID
      // Format: # assertthat-feature-id: abc123
      const featureIdMatch = line.match(/^#\s*assertthat-feature-id:\s*(.+)$/);
      if (featureIdMatch) {
        metadata.featureId = featureIdMatch[1].trim();
        continue;
      }

      // Extract scenario-level ID (appears BEFORE Scenario line, may be indented)
      // Format:   # assertthat-scenario-id: xyz789
      const scenarioIdMatch = line.match(/^\s*#\s*assertthat-scenario-id:\s*(.+)$/);
      if (scenarioIdMatch) {
        pendingScenarioId = scenarioIdMatch[1].trim();
        continue;
      }

      // Find Scenario line and associate with pending ID
      const scenarioMatch = line.match(/^\s*(?:@\S+\s+)*Scenario(?:\s+Outline)?:\s*(.+)$/);
      if (scenarioMatch && pendingScenarioId) {
        const scenarioName = scenarioMatch[1].trim();
        metadata.scenarioIds.set(scenarioName, pendingScenarioId);
        pendingScenarioId = null;
      }
    }

    return metadata;
  }

  /**
   * Add or update AssertThat metadata in feature file content
   * 
   * @param {string} content - Original feature file content
   * @param {Object} metadata - Metadata to add/update
   * @param {string} metadata.featureId - AssertThat feature ID
   * @param {Map<string, string>} metadata.scenarioIds - Map of scenario names to IDs
   * @returns {string} Updated feature file content
   */
  updateMetadata(content, metadata) {
    const lines = content.split('\n');
    const updatedLines = [];
    let featureIdAdded = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Skip existing metadata comments (we'll re-add them)
      if (line.match(/^\s*#\s*assertthat-(feature|scenario)-id:/)) {
        continue;
      }

      // Add feature ID before Feature declaration
      if (!featureIdAdded && line.match(/^Feature:/)) {
        if (metadata.featureId) {
          updatedLines.push(`# assertthat-feature-id: ${metadata.featureId}`);
        }
        featureIdAdded = true;
      }

      // Add scenario ID before Scenario declaration
      const scenarioMatch = line.match(/^\s*(?:@\S+\s+)*Scenario(?:\s+Outline)?:\s*(.+)$/);
      if (scenarioMatch) {
        const scenarioName = scenarioMatch[1].trim();
        const scenarioId = metadata.scenarioIds?.get(scenarioName);
        if (scenarioId) {
          // Preserve indentation
          const indent = line.match(/^(\s*)/)[1];
          updatedLines.push(`${indent}# assertthat-scenario-id: ${scenarioId}`);
        }
      }

      updatedLines.push(line);
    }

    return updatedLines.join('\n');
  }

  /**
   * Read feature file and extract metadata
   * 
   * @param {string} filePath - Path to feature file
   * @returns {Promise<Object>} Metadata object
   */
  async readMetadata(filePath) {
    const content = await fs.readFile(filePath, 'utf-8');
    return this.extractMetadata(content);
  }

  /**
   * Write metadata to feature file
   * 
   * @param {string} filePath - Path to feature file
   * @param {Object} metadata - Metadata to write
   */
  async writeMetadata(filePath, metadata) {
    const content = await fs.readFile(filePath, 'utf-8');
    const updated = this.updateMetadata(content, metadata);
    await fs.writeFile(filePath, updated, 'utf-8');
  }

  /**
   * Extract metadata from AssertThat V2 API response
   *
   * V2 API Response Format:
   * {
   *   "page": 0,
   *   "size": 100,
   *   "total": 137,
   *   "scenarios": [
   *     {
   *       "id": "b9369f7ed1840a2099e9e40ea0477c90",
   *       "name": "Scenario name",
   *       "feature": "Feature name",
   *       "mode": "automated",
   *       "steps": "...",
   *       "created_at": "2025-10-02T08:11:02",
   *       "updated_at": "2025-10-03T03:26:00",
   *       "tags": [],
   *       "deleted": false
   *     }
   *   ]
   * }
   *
   * @param {Object} apiResponse - AssertThat V2 API response with scenarios
   * @returns {Map<string, Object>} Map of feature name to metadata {featureId, scenarioIds}
   */
  extractFromApiResponse(apiResponse) {
    const metadataByFeature = new Map();

    if (!apiResponse.scenarios || !Array.isArray(apiResponse.scenarios)) {
      return metadataByFeature;
    }

    // Group scenarios by feature
    for (const scenario of apiResponse.scenarios) {
      const featureName = scenario.feature;

      if (!metadataByFeature.has(featureName)) {
        metadataByFeature.set(featureName, {
          featureId: featureName, // V2 API doesn't provide feature-level IDs, use name
          scenarioIds: new Map(),
        });
      }

      const metadata = metadataByFeature.get(featureName);
      metadata.scenarioIds.set(scenario.name, scenario.id);
    }

    return metadataByFeature;
  }

  /**
   * Create a mapping between GitHub features and AssertThat features
   * based on stored IDs
   * 
   * @param {Array<Object>} githubFeatures - GitHub feature files with metadata
   * @param {Array<Object>} assertThatScenarios - AssertThat scenarios from API
   * @returns {Map<string, Object>} Map of scenario IDs to {github, assertThat} pairs
   */
  createScenarioMapping(githubFeatures, assertThatScenarios) {
    const mapping = new Map();

    // Index AssertThat scenarios by ID
    const atScenariosById = new Map();
    for (const scenario of assertThatScenarios) {
      atScenariosById.set(scenario.id, scenario);
    }

    // Match GitHub scenarios to AssertThat scenarios by ID
    for (const ghFeature of githubFeatures) {
      const metadata = this.extractMetadata(ghFeature.content);
      
      for (const [scenarioName, scenarioId] of metadata.scenarioIds) {
        const atScenario = atScenariosById.get(scenarioId);
        
        mapping.set(scenarioId, {
          github: {
            feature: ghFeature,
            scenarioName,
          },
          assertThat: atScenario || null,
        });
      }
    }

    // Add AssertThat scenarios that don't exist in GitHub (new scenarios)
    for (const atScenario of assertThatScenarios) {
      if (!mapping.has(atScenario.id)) {
        mapping.set(atScenario.id, {
          github: null,
          assertThat: atScenario,
        });
      }
    }

    return mapping;
  }
}

