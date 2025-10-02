/**
 * OG-45 Phase 3: Feature Downloader
 * 
 * Handles downloading feature files from AssertThat to GitHub:
 * - Download features as ZIP from AssertThat
 * - Extract ZIP to local filesystem
 * - Preserve metadata (source, timestamp)
 * - File organization options
 * - Progress tracking via event emissions
 */

import AdmZip from "adm-zip";
import path from "path";
import fs from "fs/promises";

/**
 * FeatureDownloader - Downloads features from AssertThat to GitHub
 */
export class FeatureDownloader {
  /**
   * Constructor with dependency injection
   *
   * @param {Object} apiClient - AssertThatApiClient instance
   * @param {Object} config - Configuration object
   * @param {Object} eventBus - Event bus for progress tracking
   * @param {Object} fsModule - File system module (for testing)
   */
  constructor(apiClient, config, eventBus, fsModule = null) {
    this.validateDependencies(apiClient, config);

    this.apiClient = apiClient;
    this.config = config;
    this.eventBus = eventBus;
    this.fs = fsModule || fs;
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
   * Download features from AssertThat
   * 
   * @param {string} destination - Destination directory path
   * @param {Object} options - Download options
   * @param {string} options.mode - Filter mode: automated/manual/both
   * @param {string} options.tags - Tag expression filter
   * @param {string} options.jql - JQL query filter
   * @param {boolean} options.preserveMetadata - Preserve download metadata
   * @param {boolean} options.organizeByFolder - Organize files by folder structure
   * @returns {Promise<Object>} Download result
   */
  async downloadFeatures(destination, options = {}) {
    const {
      mode = "automated",
      tags,
      jql,
      preserveMetadata = true,
      organizeByFolder = false,
    } = options;

    try {
      // Emit download started event
      this.emitEvent("DOWNLOAD_STARTED", {
        destination,
        mode,
        tags,
        jql,
      });

      // Download features as ZIP from AssertThat
      const downloadOptions = { mode };
      if (tags) downloadOptions.tags = tags;
      if (jql) downloadOptions.jql = jql;

      const zipBuffer = await this.apiClient.downloadFeatures(downloadOptions);

      // Extract ZIP to destination
      const extractionResult = await this.extractZip(
        zipBuffer,
        destination,
        { organizeByFolder }
      );

      // Prepare metadata
      const metadata = {
        source: "assertthat",
        downloadedAt: new Date().toISOString(),
        mode,
        tags,
        jql,
        filesExtracted: extractionResult.filesExtracted,
      };

      // Emit download completed event
      this.emitEvent("DOWNLOAD_COMPLETED", {
        success: true,
        filesExtracted: extractionResult.filesExtracted,
        destination,
      });

      return {
        success: true,
        filesExtracted: extractionResult.filesExtracted,
        metadata: preserveMetadata ? metadata : undefined,
      };
    } catch (error) {
      // Emit failure event
      this.emitEvent("DOWNLOAD_FAILED", {
        error: error.message,
        destination,
      });

      return {
        success: false,
        error: error.message,
        metadata: {
          source: "assertthat",
          downloadedAt: new Date().toISOString(),
        },
      };
    }
  }

  /**
   * Extract ZIP buffer to destination directory
   * 
   * @param {Buffer} zipBuffer - ZIP file buffer
   * @param {string} destination - Destination directory
   * @param {Object} options - Extraction options
   * @returns {Promise<Object>} Extraction result
   */
  async extractZip(zipBuffer, destination, options = {}) {
    const { organizeByFolder = false } = options;

    try {
      // Emit extraction started event
      this.emitEvent("EXTRACTION_STARTED", {
        destination,
      });

      // Create destination directory
      await this.fs.mkdir(destination, { recursive: true });

      // Parse ZIP buffer
      const zip = new AdmZip(zipBuffer);
      const zipEntries = zip.getEntries();

      let filesExtracted = 0;

      // Extract feature files
      for (const entry of zipEntries) {
        if (!entry.isDirectory && entry.entryName.endsWith(".feature")) {
          const content = entry.getData().toString("utf8");
          const fileName = organizeByFolder
            ? entry.entryName
            : path.basename(entry.entryName);

          const filePath = path.join(destination, fileName);

          // Create subdirectories if needed
          if (organizeByFolder) {
            const fileDir = path.dirname(filePath);
            await this.fs.mkdir(fileDir, { recursive: true });
          }

          // Write feature file
          await this.fs.writeFile(filePath, content, "utf8");
          filesExtracted++;

          // Emit file extracted event
          this.emitEvent("FILE_EXTRACTED", {
            fileName,
            filePath,
          });
        }
      }

      // Emit extraction completed event
      this.emitEvent("EXTRACTION_COMPLETED", {
        filesExtracted,
        destination,
      });

      return {
        filesExtracted,
      };
    } catch (error) {
      // Emit extraction failed event
      this.emitEvent("EXTRACTION_FAILED", {
        error: error.message,
        destination,
      });

      throw error;
    }
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
   * Get downloader statistics
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

