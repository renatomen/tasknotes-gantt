/**
 * Gherkin Parser - Focused on AST parsing and data extraction
 * Extracted from oversized GherkinValidator class (343 lines → ~100 lines)
 */

import { syncEvents, SYNC_EVENTS } from "../events/SyncEvents.mjs";
import { cacheManager } from "../cache/CacheManager.mjs";
import { GherkinParseError } from "../errors/SyncErrors.mjs";

export class GherkinParser {
  constructor() {
    this.uuidFn = () => Math.random().toString(36).substring(2, 15);
  }

  /**
   * Parse Gherkin content and extract AST data
   */
  async parseFeatureContent(content, sourcePath = "unknown") {
    try {
      // Check cache first
      const fileHash = this.generateContentHash(content);
      const cached = cacheManager.validationCache.getFeatureData(
        sourcePath,
        fileHash
      );
      if (cached) {
        syncEvents.emit(SYNC_EVENTS.CACHE_HIT, {
          type: "feature-data",
          sourcePath,
        });
        return cached;
      }

      syncEvents.emit(SYNC_EVENTS.VALIDATION_STARTED, {
        sourcePath,
        type: "parsing",
      });

      // Import Gherkin components dynamically
      const gherkin = await import("@cucumber/gherkin");
      const { generateMessages, makeSourceEnvelope } = gherkin;

      // Create source envelope and parse the feature file
      const sourceEnvelope = makeSourceEnvelope(content, sourcePath);
      const messages = generateMessages(
        sourceEnvelope.source.data,
        sourceEnvelope.source.uri,
        sourceEnvelope.source.mediaType,
        {
          includeSource: false,
          includeGherkinDocument: true,
          newId: this.uuidFn,
        }
      );

      // Find the GherkinDocument message
      const gherkinDocumentMessage = messages.find(
        (message) => message.gherkinDocument
      );
      const gherkinDocument = gherkinDocumentMessage?.gherkinDocument;

      if (!gherkinDocument || !gherkinDocument.feature) {
        throw new GherkinParseError(
          "No valid feature found in file",
          sourcePath,
          "Missing feature definition"
        );
      }

      // Extract feature data from AST
      const featureData = this.extractFeatureDataFromAST(
        gherkinDocument.feature
      );

      // Cache the result
      cacheManager.validationCache.cacheFeatureData(
        sourcePath,
        fileHash,
        featureData
      );

      syncEvents.emit(SYNC_EVENTS.VALIDATION_COMPLETED, {
        sourcePath,
        type: "parsing",
        scenarioCount: featureData.scenarios.length,
      });

      return featureData;
    } catch (error) {
      syncEvents.emit(SYNC_EVENTS.VALIDATION_FAILED, {
        sourcePath,
        type: "parsing",
        error: error.message,
      });

      if (error instanceof GherkinParseError) {
        throw error;
      }

      throw new GherkinParseError(
        `Gherkin parse error in ${sourcePath}`,
        sourcePath,
        error.message
      );
    }
  }

  /**
   * Extract feature data from Gherkin AST
   */
  extractFeatureDataFromAST(feature) {
    const metadata = {
      name: feature.name || "",
      description: feature.description || "",
      tags: this.extractTags(feature.tags),
      scenarios: [],
      language: feature.language || "en",
      background: null,
    };

    // Extract children (scenarios, rules, background)
    if (feature.children) {
      for (const child of feature.children) {
        if (child.scenario) {
          metadata.scenarios.push(this.extractScenario(child.scenario));
        } else if (child.background) {
          metadata.background = this.extractBackground(child.background);
        } else if (child.rule) {
          metadata.scenarios.push(...this.extractRuleScenarios(child.rule));
        }
      }
    }

    return metadata;
  }

  /**
   * Extract scenario data from AST
   */
  extractScenario(scenario) {
    return {
      name: scenario.name || "",
      tags: this.extractTags(scenario.tags),
      steps: this.extractSteps(scenario.steps),
      type:
        scenario.keyword?.toLowerCase() === "scenario outline"
          ? "outline"
          : "scenario",
      examples: scenario.examples
        ? this.extractExamples(scenario.examples)
        : [],
    };
  }

  /**
   * Extract background data from AST
   */
  extractBackground(background) {
    return {
      name: background.name || "",
      steps: this.extractSteps(background.steps),
    };
  }

  /**
   * Extract scenarios from rule
   */
  extractRuleScenarios(rule) {
    const scenarios = [];

    if (rule.children) {
      for (const child of rule.children) {
        if (child.scenario) {
          const scenario = this.extractScenario(child.scenario);
          scenario.rule = rule.name;
          scenarios.push(scenario);
        }
      }
    }

    return scenarios;
  }

  /**
   * Extract tags from AST
   */
  extractTags(tags) {
    return tags ? tags.map((tag) => tag.name) : [];
  }

  /**
   * Extract steps from AST
   */
  extractSteps(steps) {
    return steps
      ? steps.map((step) => ({
          keyword: step.keyword?.trim(),
          text: step.text || "",
          docString: step.docString?.content,
          dataTable: step.dataTable
            ? this.extractDataTable(step.dataTable)
            : null,
        }))
      : [];
  }

  /**
   * Extract data table from AST
   */
  extractDataTable(dataTable) {
    return {
      headers: dataTable.rows[0]?.cells?.map((cell) => cell.value) || [],
      rows: dataTable.rows
        .slice(1)
        .map((row) => row.cells?.map((cell) => cell.value) || []),
    };
  }

  /**
   * Extract examples from scenario outline
   */
  extractExamples(examples) {
    return examples.map((example) => ({
      name: example.name || "",
      tags: this.extractTags(example.tags),
      table: example.tableHeader
        ? this.extractDataTable({
            rows: [example.tableHeader, ...example.tableBody],
          })
        : null,
    }));
  }

  /**
   * Generate content hash for caching
   */
  generateContentHash(content) {
    // Simple hash function - could use crypto for better hashing
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString(36);
  }

  /**
   * Validate AST structure for common issues
   */
  validateASTStructure(featureData) {
    const issues = [];

    // Check for empty feature
    if (!featureData.name.trim()) {
      issues.push({
        type: "warning",
        message: "Feature should have a descriptive name",
      });
    }

    // Check for scenarios
    if (featureData.scenarios.length === 0) {
      issues.push({
        type: "error",
        message: "Feature must contain at least one scenario",
      });
    }

    // Check scenarios for issues
    featureData.scenarios.forEach((scenario, index) => {
      if (!scenario.name.trim()) {
        issues.push({
          type: "warning",
          message: `Scenario ${index + 1} should have a descriptive name`,
        });
      }

      if (scenario.steps.length === 0) {
        issues.push({
          type: "warning",
          message: `Scenario "${scenario.name}" has no steps`,
        });
      }
    });

    return issues;
  }
}
