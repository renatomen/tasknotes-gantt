/**
 * OG-45 Phase 2: Feature Uploader
 * 
 * Handles uploading feature files from GitHub to AssertThat BDD plugin:
 * - Single feature upload
 * - Batch upload operations
 * - Import tagging (marks scenarios as imported from GitHub)
 * - Progress tracking via event emissions
 * - Error handling with partial failure support
 */

/**
 * FeatureUploader - Uploads features from GitHub to AssertThat
 */
export class FeatureUploader {
  /**
   * Constructor with dependency injection
   * 
   * @param {Object} apiClient - AssertThatApiClient instance
   * @param {Object} config - Configuration object
   * @param {Object} eventBus - Event bus for progress tracking
   */
  constructor(apiClient, config, eventBus) {
    this.validateDependencies(apiClient, config);

    this.apiClient = apiClient;
    this.config = config;
    this.eventBus = eventBus;
  }

  /**
   * Validate constructor dependencies
   */
  validateDependencies(apiClient, config) {
    if (!apiClient) {
      throw new Error("API client required");
    }
    if (!config) {
      throw new Error("Configuration required");
    }
  }

  /**
   * Upload a single feature to AssertThat
   * 
   * @param {Object} feature - Feature object {name, content, path}
   * @param {Object} options - Upload options
   * @param {boolean} options.tagAsImported - Add @imported-from-github tag
   * @param {boolean} options.override - Override existing feature (default: true)
   * @returns {Promise<Object>} Upload result {success, error}
   */
  async uploadFeature(feature, options = {}) {
    const { tagAsImported = true, override = true } = options;

    try {
      // Emit upload started event
      this.emitEvent("UPLOAD_STARTED", {
        featureName: feature.name,
        path: feature.path,
      });

      // Process feature content (add import tag if requested)
      let processedContent = feature.content;
      if (tagAsImported) {
        processedContent = this.addImportTag(feature.content);
      }

      // Prepare feature for upload
      const featureToUpload = {
        name: feature.name,
        content: processedContent,
      };

      // Prepare metadata
      const uploadOptions = {
        override,
        metadata: {
          source: "github",
          timestamp: new Date().toISOString(),
          originalPath: feature.path,
        },
      };

      // Upload to AssertThat
      await this.apiClient.uploadFeature(featureToUpload, uploadOptions);

      // Emit success event
      this.emitEvent("UPLOAD_COMPLETED", {
        featureName: feature.name,
        success: true,
      });

      return { success: true };
    } catch (error) {
      // Emit failure event
      this.emitEvent("UPLOAD_FAILED", {
        featureName: feature.name,
        error: error.message,
      });

      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Upload multiple features in batch
   * 
   * @param {Array} features - Array of feature objects
   * @param {Object} options - Upload options
   * @returns {Promise<Object>} Batch result {success, uploaded, failed, errors}
   */
  async uploadBatch(features, options = {}) {
    const results = {
      success: true,
      uploaded: 0,
      failed: 0,
      errors: [],
    };

    // Emit batch started event
    this.emitEvent("BATCH_UPLOAD_STARTED", {
      totalFeatures: features.length,
    });

    // Upload features sequentially to avoid rate limiting
    for (let i = 0; i < features.length; i++) {
      const feature = features[i];

      try {
        const result = await this.uploadFeature(feature, options);

        if (result.success) {
          results.uploaded++;
        } else {
          results.failed++;
          results.success = false;
          results.errors.push({
            feature: feature.name,
            error: result.error,
          });
        }

        // Emit progress event
        this.emitEvent("BATCH_UPLOAD_PROGRESS", {
          current: i + 1,
          total: features.length,
          uploaded: results.uploaded,
          failed: results.failed,
        });
      } catch (error) {
        results.failed++;
        results.success = false;
        results.errors.push({
          feature: feature.name,
          error: error.message,
        });
      }
    }

    // Emit batch completed event
    this.emitEvent("BATCH_UPLOAD_COMPLETED", {
      uploaded: results.uploaded,
      failed: results.failed,
      errors: results.errors,
    });

    return results;
  }

  /**
   * Add @imported-from-github tag to feature content
   * 
   * @param {string} content - Original feature content
   * @returns {string} Content with import tag added
   */
  addImportTag(content) {
    // Check if tag already exists
    if (content.includes("@imported-from-github")) {
      return content;
    }

    // Find the first scenario line
    const lines = content.split("\n");
    const scenarioIndex = lines.findIndex((line) =>
      line.trim().match(/^Scenario:|^Scenario Outline:/)
    );

    if (scenarioIndex === -1) {
      // No scenario found, return original content
      return content;
    }

    // Find existing tags on the line before scenario
    const previousLineIndex = scenarioIndex - 1;
    const previousLine = lines[previousLineIndex];

    if (previousLine && previousLine.trim().startsWith("@")) {
      // Add to existing tags line
      lines[previousLineIndex] = previousLine + " @imported-from-github";
    } else {
      // Insert new tag line before scenario
      const indent = this.getIndentation(lines[scenarioIndex]);
      lines.splice(scenarioIndex, 0, `${indent}@imported-from-github`);
    }

    return lines.join("\n");
  }

  /**
   * Get indentation from a line
   * 
   * @param {string} line - Line to analyze
   * @returns {string} Indentation string (spaces)
   */
  getIndentation(line) {
    const match = line.match(/^(\s*)/);
    return match ? match[1] : "";
  }

  /**
   * Emit event if event bus is available
   * 
   * @param {string} eventName - Event name
   * @param {Object} data - Event data
   */
  emitEvent(eventName, data) {
    if (this.eventBus && typeof this.eventBus.emit === "function") {
      this.eventBus.emit(eventName, data);
    }
  }

  /**
   * Get uploader statistics
   * 
   * @returns {Object} Statistics
   */
  getStats() {
    return {
      projectId: this.config.assertThat?.projectId,
      hasEventBus: !!this.eventBus,
    };
  }
}

