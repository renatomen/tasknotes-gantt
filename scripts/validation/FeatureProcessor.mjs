/**
 * Feature Processor - Focused on file processing operations
 * Extracted from oversized GherkinValidator class (343 lines → ~100 lines)
 */

import { syncEvents, SYNC_EVENTS } from "../events/SyncEvents.mjs";
import { cacheManager } from "../cache/CacheManager.mjs";
import { FileSystemError } from "../errors/SyncErrors.mjs";
import { GherkinValidator } from "./GherkinValidator.mjs";

export class FeatureProcessor {
  constructor(validator = null) {
    this.validator = validator || new GherkinValidator();
  }

  /**
   * Process multiple feature files and return aggregated results
   */
  async validateFeatureFiles(featureFiles) {
    const results = {
      totalFiles: featureFiles.length,
      validFiles: 0,
      invalidFiles: 0,
      totalErrors: 0,
      totalWarnings: 0,
      files: [],
      summary: {
        features: 0,
        scenarios: 0,
        tags: new Set(),
        languages: new Set(),
      },
    };

    syncEvents.emit(SYNC_EVENTS.VALIDATION_STARTED, {
      type: "batch",
      fileCount: featureFiles.length,
    });

    // Process files in parallel with concurrency limit
    const concurrency = 5;
    const chunks = this.chunkArray(featureFiles, concurrency);

    for (const chunk of chunks) {
      const chunkResults = await Promise.allSettled(
        chunk.map((filePath) => this.processFeatureFile(filePath))
      );

      // Aggregate results
      chunkResults.forEach((result, index) => {
        const filePath = chunk[index];

        if (result.status === "fulfilled") {
          const fileResult = result.value;
          results.files.push(fileResult);

          if (fileResult.isValid) {
            results.validFiles++;
          } else {
            results.invalidFiles++;
          }

          results.totalErrors += fileResult.errors.length;
          results.totalWarnings += fileResult.warnings.length;

          // Update summary
          if (fileResult.metadata) {
            this.updateSummary(results.summary, fileResult.metadata);
          }
        } else {
          results.invalidFiles++;
          results.totalErrors++;
          results.files.push({
            filePath,
            isValid: false,
            errors: [result.reason.message],
            warnings: [],
            metadata: null,
          });
        }
      });

      // Emit progress update
      const processed = results.files.length;
      const progress = Math.round((processed / featureFiles.length) * 100);
      syncEvents.emit(SYNC_EVENTS.PROGRESS_UPDATE, {
        phase: "validation",
        progress,
        message: `Processed ${processed}/${featureFiles.length} files`,
      });
    }

    // Convert Set to Array for summary
    results.summary.tags = Array.from(results.summary.tags);
    results.summary.languages = Array.from(results.summary.languages);

    syncEvents.emit(SYNC_EVENTS.VALIDATION_COMPLETED, {
      type: "batch",
      ...results,
    });

    return results;
  }

  /**
   * Process a single feature file
   */
  async processFeatureFile(filePath) {
    try {
      const result = await this.validator.validateFeatureFile(filePath);
      return {
        filePath,
        ...result,
      };
    } catch (error) {
      throw new FileSystemError(
        `Failed to process feature file: ${filePath}`,
        filePath,
        error.message
      );
    }
  }

  /**
   * Scan directory for feature files
   */
  async scanForFeatureFiles(directory, recursive = true) {
    try {
      const fs = await import("fs/promises");
      const path = await import("path");

      const featureFiles = [];

      const scanDirectory = async (dir) => {
        const entries = await fs.readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);

          if (entry.isDirectory() && recursive) {
            await scanDirectory(fullPath);
          } else if (entry.isFile() && entry.name.endsWith(".feature")) {
            featureFiles.push(fullPath);
          }
        }
      };

      await scanDirectory(directory);

      syncEvents.emit(SYNC_EVENTS.VALIDATION_STARTED, {
        type: "scan",
        directory,
        fileCount: featureFiles.length,
      });

      return featureFiles;
    } catch (error) {
      throw new FileSystemError(
        `Failed to scan directory for feature files: ${directory}`,
        directory,
        error.message
      );
    }
  }

  /**
   * Filter feature files by criteria
   */
  filterFeatureFiles(files, criteria = {}) {
    return files.filter((file) => {
      // Filter by tags
      if (criteria.tags && file.metadata) {
        const fileTags = [
          ...file.metadata.tags,
          ...file.metadata.scenarios.flatMap((s) => s.tags),
        ];

        const hasRequiredTags = criteria.tags.every((tag) =>
          fileTags.includes(tag)
        );
        if (!hasRequiredTags) return false;
      }

      // Filter by scenario count
      if (criteria.minScenarios && file.metadata) {
        if (file.metadata.scenarios.length < criteria.minScenarios)
          return false;
      }

      // Filter by validity
      if (criteria.validOnly && !file.isValid) return false;

      return true;
    });
  }

  /**
   * Generate validation report
   */
  generateReport(results, format = "text") {
    switch (format) {
      case "json":
        return JSON.stringify(results, null, 2);

      case "csv":
        return this.generateCSVReport(results);

      case "text":
      default:
        return this.generateTextReport(results);
    }
  }

  /**
   * Generate text report
   */
  generateTextReport(results) {
    const lines = [];

    lines.push("=".repeat(60));
    lines.push("FEATURE VALIDATION REPORT");
    lines.push("=".repeat(60));
    lines.push("");

    // Summary
    lines.push(`Total Files: ${results.totalFiles}`);
    lines.push(`Valid Files: ${results.validFiles}`);
    lines.push(`Invalid Files: ${results.invalidFiles}`);
    lines.push(`Total Errors: ${results.totalErrors}`);
    lines.push(`Total Warnings: ${results.totalWarnings}`);
    lines.push("");

    // Feature summary
    lines.push(`Features: ${results.summary.features}`);
    lines.push(`Scenarios: ${results.summary.scenarios}`);
    lines.push(`Languages: ${results.summary.languages.join(", ")}`);
    lines.push(`Common Tags: ${results.summary.tags.slice(0, 10).join(", ")}`);
    lines.push("");

    // File details
    if (results.invalidFiles > 0) {
      lines.push("INVALID FILES:");
      lines.push("-".repeat(40));

      results.files
        .filter((file) => !file.isValid)
        .forEach((file) => {
          lines.push(`\n${file.filePath}`);
          file.errors.forEach((error) => lines.push(`  ERROR: ${error}`));
          file.warnings.forEach((warning) =>
            lines.push(`  WARNING: ${warning}`)
          );
        });
    }

    return lines.join("\n");
  }

  /**
   * Generate CSV report
   */
  generateCSVReport(results) {
    const headers = [
      "File Path",
      "Valid",
      "Errors",
      "Warnings",
      "Scenarios",
      "Tags",
    ];
    const rows = [headers];

    results.files.forEach((file) => {
      const scenarioCount = file.metadata ? file.metadata.scenarios.length : 0;
      const tags = file.metadata
        ? [
            ...file.metadata.tags,
            ...file.metadata.scenarios.flatMap((s) => s.tags),
          ].join(";")
        : "";

      rows.push([
        file.filePath,
        file.isValid ? "Yes" : "No",
        file.errors.length.toString(),
        file.warnings.length.toString(),
        scenarioCount.toString(),
        tags,
      ]);
    });

    return rows
      .map((row) => row.map((cell) => `"${cell}"`).join(","))
      .join("\n");
  }

  /**
   * Update summary statistics
   */
  updateSummary(summary, metadata) {
    summary.features++;
    summary.scenarios += metadata.scenarios.length;
    summary.languages.add(metadata.language);

    // Collect tags
    metadata.tags.forEach((tag) => summary.tags.add(tag));
    metadata.scenarios.forEach((scenario) => {
      scenario.tags.forEach((tag) => summary.tags.add(tag));
    });
  }

  /**
   * Split array into chunks for parallel processing
   */
  chunkArray(array, chunkSize) {
    const chunks = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }

  /**
   * Get processing statistics
   */
  getStats() {
    return {
      cache: this.validator.getValidationStats(),
      // Could add processing time stats, etc.
    };
  }
}
