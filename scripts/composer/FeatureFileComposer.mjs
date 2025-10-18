/**
 * FeatureFileComposer - Composes feature files from V2 API scenario data
 * 
 * Builds .feature files from AssertThat V2 API scenarios, preserving:
 * - Scenario IDs as metadata comments
 * - Feature structure and formatting
 * - Tags and annotations
 * - Gherkin syntax
 */

import fs from 'fs/promises';
import path from 'path';

export class FeatureFileComposer {
  /**
   * Compose a feature file from V2 API scenarios
   * 
   * @param {string} featureName - Name of the feature
   * @param {Array} scenarios - Array of scenario objects from V2 API
   * @returns {string} Complete feature file content
   */
  composeFeatureFile(featureName, scenarios) {
    if (!scenarios || scenarios.length === 0) {
      throw new Error(`No scenarios provided for feature: ${featureName}`);
    }

    const lines = [];
    
    // Add feature-level ID comment
    lines.push(`# @assertthat-feature-id: ${featureName}`);
    
    // Add feature header
    lines.push(`Feature: ${featureName}`);
    lines.push('');
    
    // Add scenarios
    for (const scenario of scenarios) {
      this.addScenario(lines, scenario);
      lines.push(''); // Blank line between scenarios
    }
    
    return lines.join('\n');
  }

  /**
   * Add a scenario to the feature file lines
   * 
   * @param {Array} lines - Array of file lines
   * @param {Object} scenario - Scenario object from V2 API
   */
  addScenario(lines, scenario) {
    // Extract tags from the scenario
    const tags = this.extractTags(scenario);
    
    // Add tags line if present
    if (tags.length > 0) {
      lines.push(`    ${tags.join(' ')}`);
    }
    
    // Add scenario ID comment
    lines.push(`    # @assertthat-scenario-id: ${scenario.id}`);
    
    // Add scenario name
    lines.push(`    Scenario: ${scenario.name}`);
    
    // Add scenario steps
    const steps = this.parseSteps(scenario.steps);
    for (const step of steps) {
      lines.push(`        ${step}`);
    }
  }

  /**
   * Extract tags from scenario
   * 
   * @param {Object} scenario - Scenario object
   * @returns {Array} Array of tag strings (e.g., ['@tag1', '@tag2'])
   */
  extractTags(scenario) {
    const tags = [];
    
    // Add mode tag if automated
    if (scenario.mode === 'automated') {
      tags.push('@AUTOMATED');
    }
    
    // Add custom tags
    if (scenario.tags && Array.isArray(scenario.tags)) {
      for (const tag of scenario.tags) {
        tags.push(`@${tag}`);
      }
    }
    
    // Add imported-from-github tag (to match existing format)
    tags.push('@imported-from-github');
    
    return tags;
  }

  /**
   * Parse steps string into array of step lines
   * 
   * @param {string} stepsString - Steps as a single string from V2 API
   * @returns {Array} Array of step lines
   */
  parseSteps(stepsString) {
    if (!stepsString) {
      return [];
    }
    
    // Split by newlines and filter out empty lines
    const lines = stepsString.split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);
    
    return lines;
  }

  /**
   * Compose all feature files from V2 API scenarios
   * 
   * @param {Array} allScenarios - All scenarios from V2 API
   * @returns {Map} Map of feature name to file content
   */
  composeAllFeatures(allScenarios) {
    // Group scenarios by feature
    const featureMap = new Map();
    
    for (const scenario of allScenarios) {
      if (!featureMap.has(scenario.feature)) {
        featureMap.set(scenario.feature, []);
      }
      featureMap.get(scenario.feature).push(scenario);
    }
    
    // Compose each feature file
    const featureFiles = new Map();
    
    for (const [featureName, scenarios] of featureMap) {
      const content = this.composeFeatureFile(featureName, scenarios);
      featureFiles.set(featureName, content);
    }
    
    return featureFiles;
  }

  /**
   * Write composed feature files to disk
   *
   * @param {Map} featureFiles - Map of feature name to content
   * @param {string} outputDir - Output directory path
   * @returns {Promise<Object>} Statistics about written files
   */
  async writeFeatureFiles(featureFiles, outputDir) {
    const stats = {
      filesWritten: 0,
      totalScenarios: 0,
    };

    // Ensure output directory exists
    await fs.mkdir(outputDir, { recursive: true });

    // Build filename mapping from existing files
    const filenameMapping = await this.buildFilenameMapping(outputDir);

    for (const [featureName, content] of featureFiles) {
      // Use existing filename if available, otherwise generate new one
      const filename = filenameMapping.get(featureName) || this.featureNameToFilename(featureName);
      const filePath = path.join(outputDir, filename);

      // Write file
      await fs.writeFile(filePath, content, 'utf-8');

      stats.filesWritten++;

      // Count scenarios in this file
      const scenarioCount = (content.match(/Scenario:/g) || []).length;
      stats.totalScenarios += scenarioCount;
    }

    return stats;
  }

  /**
   * Build mapping of feature names to existing filenames
   *
   * @param {string} dir - Directory to scan
   * @returns {Promise<Map>} Map of feature name to filename
   */
  async buildFilenameMapping(dir) {
    const mapping = new Map();

    try {
      const files = await fs.readdir(dir);

      for (const file of files) {
        if (!file.endsWith('.feature')) continue;

        const filePath = path.join(dir, file);
        const content = await fs.readFile(filePath, 'utf-8');

        // Extract feature name from content
        const featureMatch = content.match(/Feature:\s*(.+)/);
        if (featureMatch) {
          const featureName = featureMatch[1].trim();
          mapping.set(featureName, file);
        }
      }
    } catch (_error) {
      // Directory doesn't exist or can't be read, return empty mapping
    }

    return mapping;
  }

  /**
   * Convert feature name to filename
   * 
   * @param {string} featureName - Feature name
   * @returns {string} Filename (e.g., "my-feature.feature")
   */
  featureNameToFilename(featureName) {
    return featureName
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
      + '.feature';
  }
}

