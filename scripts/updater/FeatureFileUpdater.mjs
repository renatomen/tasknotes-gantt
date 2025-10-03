/**
 * FeatureFileUpdater - Updates existing feature files with changes from V2 API
 * 
 * Preserves file structure, formatting, comments, and descriptions while
 * updating only the scenarios that have changed in AssertThat.
 */

import fs from 'fs/promises';
import path from 'path';

export class FeatureFileUpdater {
  /**
   * Update feature files with changes from V2 API
   * 
   * @param {string} featuresDir - Directory containing feature files
   * @param {Array} allScenarios - All scenarios from V2 API
   * @returns {Promise<Object>} Update statistics
   */
  async updateFeatureFiles(featuresDir, allScenarios) {
    const stats = {
      filesUpdated: 0,
      scenariosUpdated: 0,
      filesUnchanged: 0,
    };
    
    // Group scenarios by feature
    const scenariosByFeature = this.groupScenariosByFeature(allScenarios);
    
    // Find all existing feature files
    const files = await fs.readdir(featuresDir);
    const featureFiles = files.filter(f => f.endsWith('.feature'));
    
    for (const file of featureFiles) {
      const filePath = path.join(featuresDir, file);
      const originalContent = await fs.readFile(filePath, 'utf-8');
      
      // Extract feature name from file
      const featureMatch = originalContent.match(/Feature:\s*(.+)/);
      if (!featureMatch) continue;
      
      const featureName = featureMatch[1].trim();
      const scenarios = scenariosByFeature.get(featureName) || [];
      
      if (scenarios.length === 0) continue;
      
      // Update file content
      const updatedContent = this.updateFileContent(originalContent, scenarios);
      
      if (updatedContent !== originalContent) {
        await fs.writeFile(filePath, updatedContent, 'utf-8');
        stats.filesUpdated++;
        
        // Count updated scenarios
        const updatedCount = this.countUpdatedScenarios(originalContent, updatedContent);
        stats.scenariosUpdated += updatedCount;
      } else {
        stats.filesUnchanged++;
      }
    }
    
    // Handle new features (scenarios for features that don't have files yet)
    for (const [featureName, scenarios] of scenariosByFeature) {
      const filename = this.featureNameToFilename(featureName);
      const filePath = path.join(featuresDir, filename);
      
      try {
        await fs.access(filePath);
        // File exists, already processed above
      } catch {
        // File doesn't exist, create it
        const content = this.createNewFeatureFile(featureName, scenarios);
        await fs.writeFile(filePath, content, 'utf-8');
        stats.filesUpdated++;
        stats.scenariosUpdated += scenarios.length;
      }
    }
    
    return stats;
  }

  /**
   * Update file content with new scenario data
   * 
   * @param {string} content - Original file content
   * @param {Array} scenarios - Scenarios from V2 API
   * @returns {string} Updated content
   */
  updateFileContent(content, scenarios) {
    let updatedContent = content;
    
    for (const scenario of scenarios) {
      updatedContent = this.updateScenario(updatedContent, scenario);
    }
    
    return updatedContent;
  }

  /**
   * Update a single scenario in the file content
   * 
   * @param {string} content - File content
   * @param {Object} scenario - Scenario from V2 API
   * @returns {string} Updated content
   */
  updateScenario(content, scenario) {
    // Find the scenario by ID
    const idPattern = new RegExp(
      `(\\s*# @assertthat-scenario-id: ${scenario.id}\\s*\\n\\s*Scenario:[^\\n]+\\n)([\\s\\S]*?)(?=\\n\\s*(?:@|# @assertthat-scenario-id:|Scenario:|$))`,
      'm'
    );
    
    const match = content.match(idPattern);
    if (!match) {
      // Scenario not found in file, skip
      return content;
    }
    
    // Extract the scenario header (tags + ID + Scenario line)
    const headerMatch = content.match(
      new RegExp(
        `((?:^|\\n)\\s*(?:@[^\\n]+\\n)?\\s*# @assertthat-scenario-id: ${scenario.id}\\s*\\n\\s*Scenario:)\\s*([^\\n]+)`,
        'm'
      )
    );
    
    if (!headerMatch) return content;
    
    const header = headerMatch[1];
    const oldName = headerMatch[2].trim();
    const newName = scenario.name;
    
    // Parse new steps
    const newSteps = this.parseSteps(scenario.steps);
    const newStepsText = newSteps.map(step => `        ${step}`).join('\n');
    
    // Build the new scenario block
    const newScenarioBlock = `${header} ${newName}\n${newStepsText}`;
    
    // Replace the old scenario block
    const scenarioBlockPattern = new RegExp(
      `(\\s*# @assertthat-scenario-id: ${scenario.id}\\s*\\n\\s*Scenario:[^\\n]+\\n)([\\s\\S]*?)(?=\\n\\s*(?:@|# @assertthat-scenario-id:|Scenario:|$))`,
      'm'
    );
    
    return content.replace(scenarioBlockPattern, newScenarioBlock + '\n');
  }

  /**
   * Parse steps string into array
   * 
   * @param {string} stepsString - Steps from V2 API
   * @returns {Array} Array of step lines
   */
  parseSteps(stepsString) {
    if (!stepsString) return [];
    
    return stepsString.split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);
  }

  /**
   * Group scenarios by feature name
   * 
   * @param {Array} scenarios - All scenarios
   * @returns {Map} Map of feature name to scenarios array
   */
  groupScenariosByFeature(scenarios) {
    const map = new Map();
    
    for (const scenario of scenarios) {
      if (!map.has(scenario.feature)) {
        map.set(scenario.feature, []);
      }
      map.get(scenario.feature).push(scenario);
    }
    
    return map;
  }

  /**
   * Count how many scenarios were updated
   * 
   * @param {string} oldContent - Original content
   * @param {string} newContent - Updated content
   * @returns {number} Number of scenarios updated
   */
  countUpdatedScenarios(oldContent, newContent) {
    // Simple heuristic: count scenario blocks that changed
    const oldScenarios = (oldContent.match(/Scenario:/g) || []).length;
    const newScenarios = (newContent.match(/Scenario:/g) || []).length;
    
    // If count changed, return the difference, otherwise return 1 (at least one changed)
    return oldScenarios !== newScenarios ? Math.abs(oldScenarios - newScenarios) : 1;
  }

  /**
   * Create a new feature file
   * 
   * @param {string} featureName - Feature name
   * @param {Array} scenarios - Scenarios for this feature
   * @returns {string} Feature file content
   */
  createNewFeatureFile(featureName, scenarios) {
    const lines = [];
    
    lines.push(`# @assertthat-feature-id: ${featureName}`);
    lines.push(`Feature: ${featureName}`);
    lines.push('');
    
    for (const scenario of scenarios) {
      // Add tags
      const tags = this.extractTags(scenario);
      if (tags.length > 0) {
        lines.push(`    ${tags.join(' ')}`);
      }
      
      // Add scenario ID and name
      lines.push(`    # @assertthat-scenario-id: ${scenario.id}`);
      lines.push(`    Scenario: ${scenario.name}`);
      
      // Add steps
      const steps = this.parseSteps(scenario.steps);
      for (const step of steps) {
        lines.push(`        ${step}`);
      }
      
      lines.push('');
    }
    
    return lines.join('\n');
  }

  /**
   * Extract tags from scenario
   * 
   * @param {Object} scenario - Scenario object
   * @returns {Array} Array of tags
   */
  extractTags(scenario) {
    const tags = [];
    
    if (scenario.mode === 'automated') {
      tags.push('@AUTOMATED');
    }
    
    if (scenario.tags && Array.isArray(scenario.tags)) {
      for (const tag of scenario.tags) {
        tags.push(`@${tag}`);
      }
    }
    
    tags.push('@imported-from-github');
    
    return tags;
  }

  /**
   * Convert feature name to filename
   * 
   * @param {string} featureName - Feature name
   * @returns {string} Filename
   */
  featureNameToFilename(featureName) {
    return featureName
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
      + '.feature';
  }
}

