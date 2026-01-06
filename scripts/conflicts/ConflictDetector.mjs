/**
 * Conflict Detector - Focused on conflict detection logic only
 * Extracted from oversized ConflictResolver class (312 lines → ~100 lines)
 */

import { syncEvents, SYNC_EVENTS } from "../events/SyncEvents.mjs";
import { cacheManager } from "../cache/CacheManager.mjs";
import { GitOperationError } from "../errors/SyncErrors.mjs";

export class ConflictDetector {
  constructor(gitExecutor = null) {
    this.gitExecutor = gitExecutor;
    this._initialized = false;
  }

  async initialize() {
    if (!this._initialized && !this.gitExecutor) {
      const { execSync } = await import("child_process");
      this.gitExecutor = execSync;
      this._initialized = true;
    }
  }

  /**
   * Analyze conflict type and determine resolution strategy
   */
  async analyzeConflictType(githubFile, assertThatFile) {
    await this.initialize();
    try {
      // Check cache first
      const cached = cacheManager.gitCache.getDiff(githubFile, assertThatFile, {
        type: "conflict-analysis",
      });
      if (cached) {
        syncEvents.emit(SYNC_EVENTS.CACHE_HIT, {
          type: "conflict-analysis",
          files: [githubFile, assertThatFile],
        });
        return cached;
      }

      syncEvents.emit(SYNC_EVENTS.CONFLICTS_DETECTED, {
        type: "analysis-started",
        files: [githubFile, assertThatFile],
      });

      // Get diff between files
      const diffOutput = await this.generateDiff(githubFile, assertThatFile);

      // Analyze the diff to determine conflict type
      const analysis = {
        isSimple: false,
        reason: "",
        confidence: 0,
        diffLines: diffOutput.split("\n").length,
        changeType: "unknown",
      };

      // Check for different types of simple conflicts
      if (await this.isWhitespaceOnlyChange(diffOutput)) {
        analysis.isSimple = true;
        analysis.reason = "whitespace-only";
        analysis.confidence = 0.95;
        analysis.changeType = "formatting";
      } else if (await this.isCommentOnlyChange(diffOutput)) {
        analysis.isSimple = true;
        analysis.reason = "comments-only";
        analysis.confidence = 0.9;
        analysis.changeType = "documentation";
      } else if (await this.isFormattingChange(diffOutput)) {
        analysis.isSimple = true;
        analysis.reason = "formatting-only";
        analysis.confidence = 0.85;
        analysis.changeType = "formatting";
      } else if (await this.isMinorChange(diffOutput)) {
        analysis.isSimple = true;
        analysis.reason = "minor-change";
        analysis.confidence = 0.7;
        analysis.changeType = "minor";
      } else {
        analysis.isSimple = false;
        analysis.reason = "complex-change";
        analysis.confidence = 0.95;
        analysis.changeType = "structural";
      }

      // Cache the result
      cacheManager.gitCache.cacheDiff(
        githubFile,
        assertThatFile,
        { type: "conflict-analysis" },
        analysis
      );

      syncEvents.emit(SYNC_EVENTS.CONFLICTS_DETECTED, {
        type: "analysis-completed",
        files: [githubFile, assertThatFile],
        isSimple: analysis.isSimple,
        reason: analysis.reason,
      });

      return analysis;
    } catch (error) {
      syncEvents.emit(SYNC_EVENTS.CONFLICTS_DETECTED, {
        type: "analysis-failed",
        files: [githubFile, assertThatFile],
        error: error.message,
      });

      throw new GitOperationError(
        `Failed to analyze conflict between ${githubFile} and ${assertThatFile}`,
        "conflict-analysis",
        error.message
      );
    }
  }

  /**
   * Generate diff between two files
   */
  async generateDiff(file1, file2) {
    try {
      const command = `git diff --no-index --no-prefix "${file1}" "${file2}"`;
      const result = this.gitExecutor(command, { encoding: "utf8" });
      return result.toString();
    } catch (error) {
      // git diff returns exit code 1 when files differ, which is expected
      if (error.status === 1 && error.stdout) {
        return error.stdout.toString();
      }
      throw error;
    }
  }

  /**
   * Check if changes are whitespace-only
   */
  async isWhitespaceOnlyChange(diffOutput) {
    try {
      const diffLines = diffOutput.split("\n");
      const contentLines = diffLines
        .filter((line) => line.startsWith("+") || line.startsWith("-"))
        .filter((line) => !line.startsWith("+++") && !line.startsWith("---"));

      if (contentLines.length === 0) return false;

      // Group lines into pairs (removed/added) and check if they're the same when normalized
      const removedLines = [];
      const addedLines = [];

      for (const line of contentLines) {
        const content = line.substring(1); // Remove +/- prefix
        if (line.startsWith("-")) {
          removedLines.push(content);
        } else if (line.startsWith("+")) {
          addedLines.push(content);
        }
      }

      // Must have same number of removed and added lines
      if (removedLines.length !== addedLines.length) return false;

      // Check if each pair has the same content when whitespace is normalized
      for (let i = 0; i < removedLines.length; i++) {
        const normalizedRemoved = removedLines[i].replace(/\s+/g, " ").trim();
        const normalizedAdded = addedLines[i].replace(/\s+/g, " ").trim();

        if (normalizedRemoved !== normalizedAdded) {
          return false;
        }
      }

      return true;
    } catch (error) {
      console.error("Error checking whitespace-only change:", error.message);
      return false;
    }
  }

  /**
   * Check if changes are comment-only
   */
  async isCommentOnlyChange(diffOutput) {
    try {
      const diffLines = diffOutput.split("\n");
      const contentLines = diffLines.filter(
        (line) =>
          (line.startsWith("+") || line.startsWith("-")) &&
          !line.startsWith("+++") &&
          !line.startsWith("---")
      );

      if (contentLines.length === 0) return false;

      // Check if all changes are in comments
      for (const line of contentLines) {
        const content = line.substring(1).trim(); // Remove +/- prefix and trim

        if (content === "") continue; // Empty lines are OK

        // Check for common comment patterns
        const isComment =
          content.startsWith("#") || // Gherkin comments
          content.startsWith("//") || // C-style comments
          content.startsWith("/*") || // Block comment start
          content.startsWith("*/") || // Block comment end
          content.startsWith("*") || // Block comment middle
          /^\s*#/.test(content); // Indented comments

        if (!isComment) {
          return false;
        }
      }

      return true;
    } catch (error) {
      console.error("Error checking comment-only change:", error.message);
      return false;
    }
  }

  /**
   * Check if changes are formatting-only
   */
  async isFormattingChange(diffOutput) {
    try {
      const diffLines = diffOutput.split("\n");
      const contentLines = diffLines.filter(
        (line) =>
          (line.startsWith("+") || line.startsWith("-")) &&
          !line.startsWith("+++") &&
          !line.startsWith("---")
      );

      if (contentLines.length === 0) return false;

      // Group lines by pairs (removed/added)
      const pairs = [];
      for (let i = 0; i < contentLines.length; i += 2) {
        if (i + 1 < contentLines.length) {
          const removed = contentLines[i];
          const added = contentLines[i + 1];

          if (removed.startsWith("-") && added.startsWith("+")) {
            pairs.push([removed.substring(1), added.substring(1)]);
          }
        }
      }

      // Check if paired lines have same content when normalized
      for (const [removed, added] of pairs) {
        const normalizedRemoved = this.normalizeFormatting(removed);
        const normalizedAdded = this.normalizeFormatting(added);

        if (normalizedRemoved !== normalizedAdded) {
          return false;
        }
      }

      return pairs.length > 0;
    } catch (error) {
      console.error("Error checking formatting change:", error.message);
      return false;
    }
  }

  /**
   * Check if changes are minor (small additions/modifications)
   */
  async isMinorChange(diffOutput) {
    try {
      const diffLines = diffOutput.split("\n");
      const addedLines = diffLines.filter(
        (line) => line.startsWith("+") && !line.startsWith("+++")
      ).length;
      const removedLines = diffLines.filter(
        (line) => line.startsWith("-") && !line.startsWith("---")
      ).length;

      // Consider minor if:
      // - Less than 5 lines changed
      // - No structural changes (no Feature/Scenario/Given/When/Then keyword changes)
      const totalChanges = addedLines + removedLines;
      if (totalChanges > 5) return false;

      // Check for structural keyword changes
      const structuralKeywords = [
        "Feature:",
        "Scenario:",
        "Given",
        "When",
        "Then",
        "And",
        "But",
      ];
      const hasStructuralChanges = diffLines.some((line) => {
        if (!line.startsWith("+") && !line.startsWith("-")) return false;
        const content = line.substring(1).trim();
        return structuralKeywords.some((keyword) => content.includes(keyword));
      });

      return !hasStructuralChanges;
    } catch (error) {
      console.error("Error checking minor change:", error.message);
      return false;
    }
  }

  /**
   * Normalize formatting for comparison
   */
  normalizeFormatting(text) {
    return text
      .replace(/\s+/g, " ") // Normalize whitespace
      .replace(/\t/g, " ") // Convert tabs to spaces
      .replace(/\s*:\s*/g, ":") // Normalize spaces around colons
      .replace(/\s*,\s*/g, ",") // Normalize spaces around commas
      .trim() // Remove leading/trailing whitespace
      .toLowerCase(); // Case insensitive comparison
  }

  /**
   * Get conflict detection statistics
   */
  getStats() {
    return {
      cache: cacheManager.gitCache.getStats(),
      // Could add detection accuracy stats, etc.
    };
  }

  /**
   * Clear detection cache
   */
  clearCache() {
    cacheManager.gitCache.clear();
  }
}
