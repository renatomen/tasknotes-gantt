/**
 * OG-19: Feature File Loader Implementation
 *
 * Handles loading and validation of Gherkin feature files
 * Follows single responsibility principle
 */

import { readdir, readFile } from "fs/promises";
import { join, basename } from "path";
import { FeatureMetadata } from "./BDDFramework";

/**
 * Loads and validates Gherkin feature files
 */
export class FeatureFileLoader {
  /**
   * Load all feature files from the specified directory
   */
  async loadFeatureFiles(featuresPath: string): Promise<string[]> {
    try {
      const featureFiles: string[] = [];
      await this.scanDirectory(featuresPath, featureFiles);
      return featureFiles;
    } catch (error) {
      throw new Error(
        `Failed to load feature files from ${featuresPath}: ${error}`
      );
    }
  }

  /**
   * Recursively scan directory for .feature files
   */
  private async scanDirectory(
    dirPath: string,
    featureFiles: string[]
  ): Promise<void> {
    try {
      const entries = await readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(dirPath, entry.name);

        if (entry.isDirectory()) {
          await this.scanDirectory(fullPath, featureFiles);
        } else if (entry.isFile() && entry.name.endsWith(".feature")) {
          featureFiles.push(fullPath);
        }
      }
    } catch (error) {
      // Directory might not exist yet, which is fine for initial setup
      const nodeError = error as { code?: string };
      if (nodeError.code !== "ENOENT") {
        throw error;
      }
    }
  }

  /**
   * Validate Gherkin syntax in feature file content
   */
  async validateGherkinSyntax(featureContent: string): Promise<boolean> {
    try {
      // Basic Gherkin syntax validation
      const lines = featureContent
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line);

      if (lines.length === 0) {
        return false;
      }

      // Must start with Feature:
      const firstLine = lines[0];
      if (!firstLine || !firstLine.startsWith("Feature:")) {
        return false;
      }

      // Check for valid Gherkin keywords
      const validKeywords = [
        "Feature:",
        "Scenario:",
        "Given",
        "When",
        "Then",
        "And",
        "But",
        "Background:",
        "Scenario Outline:",
        "Examples:",
      ];

      for (const line of lines) {
        if (line.startsWith("#") || line === "") {
          continue; // Comments and empty lines are valid
        }

        const hasValidKeyword = validKeywords.some(
          (keyword) => line.startsWith(keyword) || line.includes(keyword)
        );

        if (!hasValidKeyword && !this.isDescriptionLine(line)) {
          return false;
        }
      }

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if a line is a description line (not starting with a keyword)
   */
  private isDescriptionLine(line: string): boolean {
    const keywords = [
      "Feature:",
      "Scenario:",
      "Given",
      "When",
      "Then",
      "And",
      "But",
      "Background:",
      "Scenario Outline:",
      "Examples:",
    ];
    return !keywords.some((keyword) => line.trim().startsWith(keyword));
  }

  /**
   * Extract metadata from a feature file
   */
  async getFeatureMetadata(featurePath: string): Promise<FeatureMetadata> {
    try {
      const content = await readFile(featurePath, "utf-8");
      const lines = content.split("\n").map((line: string) => line.trim());

      let title = "";
      let description = "";
      const scenarios: string[] = [];

      let inDescription = false;
      let descriptionLines: string[] = [];

      for (const line of lines) {
        if (line.startsWith("Feature:")) {
          title = line.replace("Feature:", "").trim();
          inDescription = true;
        } else if (line.startsWith("Scenario:")) {
          inDescription = false;
          if (descriptionLines.length > 0) {
            description = descriptionLines.join(" ").trim();
            descriptionLines = [];
          }
          scenarios.push(line.replace("Scenario:", "").trim());
        } else if (inDescription && line && !line.startsWith("#")) {
          descriptionLines.push(line);
        }
      }

      // If we haven't set description yet, use the accumulated lines
      if (!description && descriptionLines.length > 0) {
        description = descriptionLines.join(" ").trim();
      }

      return {
        title: title || basename(featurePath, ".feature"),
        description: description || "No description provided",
        scenarios,
      };
    } catch (error) {
      throw new Error(
        `Failed to extract metadata from ${featurePath}: ${error}`
      );
    }
  }
}
