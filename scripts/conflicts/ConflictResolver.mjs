/**
 * Conflict Resolver - Focused on resolution strategies only
 * Extracted from oversized ConflictResolver class (312 lines → ~100 lines)
 */

import { syncEvents, SYNC_EVENTS } from "../events/SyncEvents.mjs";
import { cacheManager } from "../cache/CacheManager.mjs";
import { GitOperationError } from "../errors/SyncErrors.mjs";
import { ConflictDetector } from "./ConflictDetector.mjs";

export class ConflictResolver {
  constructor(detector = null, gitExecutor = null, fileSystem = null) {
    this.detector = detector || new ConflictDetector();
    this.gitExecutor = gitExecutor;
    this.fs = fileSystem;
    this._initialized = false;
  }

  async initialize() {
    if (!this._initialized) {
      if (!this.gitExecutor) {
        const { execSync } = await import("child_process");
        this.gitExecutor = execSync;
      }
      if (!this.fs) {
        this.fs = await import("fs/promises");
      }
      this._initialized = true;
    }
  }

  /**
   * Resolve conflicts between GitHub and AssertThat versions
   */
  async resolveConflicts(conflicts) {
    await this.initialize();
    const results = {
      autoResolved: [],
      requiresManual: [],
      failed: [],
    };

    syncEvents.emit(SYNC_EVENTS.CONFLICTS_DETECTED, {
      type: "resolution-started",
      conflictCount: conflicts.length,
    });

    for (const conflict of conflicts) {
      try {
        const resolution = await this.resolveConflict(conflict);

        if (resolution.success) {
          if (resolution.method === "auto") {
            results.autoResolved.push({
              filename: conflict.filename,
              method: resolution.strategy,
              reason: resolution.reason,
            });
          } else {
            results.requiresManual.push({
              filename: conflict.filename,
              method: resolution.strategy,
              conflictMarkers: resolution.conflictMarkers,
            });
          }
        } else {
          results.failed.push({
            filename: conflict.filename,
            error: resolution.error,
          });
        }
      } catch (error) {
        results.failed.push({
          filename: conflict.filename,
          error: error.message,
        });
      }
    }

    syncEvents.emit(SYNC_EVENTS.CONFLICTS_RESOLVED, {
      autoResolved: results.autoResolved.length,
      requiresManual: results.requiresManual.length,
      failed: results.failed.length,
    });

    return results;
  }

  /**
   * Resolve a single conflict
   */
  async resolveConflict(conflict) {
    try {
      // Analyze the conflict type
      const analysis = await this.detector.analyzeConflictType(
        conflict.githubFile,
        conflict.assertThatFile
      );

      // Choose resolution strategy based on analysis
      if (analysis.isSimple && analysis.confidence > 0.8) {
        return await this.autoResolveConflict(conflict, analysis);
      } else {
        return await this.createConflictMarkers(conflict, analysis);
      }
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Automatically resolve simple conflicts
   */
  async autoResolveConflict(conflict, analysis) {
    try {
      let resolvedContent;
      let strategy;

      switch (analysis.reason) {
        case "whitespace-only":
          resolvedContent = await this.resolveWhitespaceConflict(conflict);
          strategy = "whitespace-normalization";
          break;

        case "comments-only":
          resolvedContent = await this.resolveCommentConflict(conflict);
          strategy = "comment-merge";
          break;

        case "formatting-only":
          resolvedContent = await this.resolveFormattingConflict(conflict);
          strategy = "formatting-normalization";
          break;

        case "minor-change":
          resolvedContent = await this.resolveMinorConflict(conflict);
          strategy = "minor-merge";
          break;

        default:
          throw new Error(`Unknown simple conflict type: ${analysis.reason}`);
      }

      // Write resolved content to staging file
      await this.fs.writeFile(conflict.stagingFile, resolvedContent, "utf8");

      syncEvents.emit(SYNC_EVENTS.CONFLICTS_AUTO_RESOLVED, {
        filename: conflict.filename,
        strategy,
        reason: analysis.reason,
      });

      return {
        success: true,
        method: "auto",
        strategy,
        reason: analysis.reason,
      };
    } catch (error) {
      throw new GitOperationError(
        `Failed to auto-resolve conflict for ${conflict.filename}`,
        "auto-resolution",
        error.message
      );
    }
  }

  /**
   * Create conflict markers for manual resolution
   */
  async createConflictMarkers(conflict, analysis) {
    try {
      const githubContent = await this.fs.readFile(conflict.githubFile, "utf8");
      const assertThatContent = await this.fs.readFile(
        conflict.assertThatFile,
        "utf8"
      );

      const conflictMarkers = this.generateConflictMarkers(
        githubContent,
        assertThatContent,
        conflict.filename
      );

      // Write conflict markers to staging file
      await this.fs.writeFile(conflict.stagingFile, conflictMarkers, "utf8");

      syncEvents.emit(SYNC_EVENTS.CONFLICTS_REQUIRE_MANUAL, {
        filename: conflict.filename,
        reason: analysis.reason,
        confidence: analysis.confidence,
      });

      return {
        success: true,
        method: "manual",
        strategy: "conflict-markers",
        conflictMarkers: true,
      };
    } catch (error) {
      throw new GitOperationError(
        `Failed to create conflict markers for ${conflict.filename}`,
        "conflict-markers",
        error.message
      );
    }
  }

  /**
   * Resolve whitespace-only conflicts
   */
  async resolveWhitespaceConflict(conflict) {
    // Prefer GitHub version for whitespace conflicts (more likely to be standardized)
    const githubContent = await this.fs.readFile(conflict.githubFile, "utf8");
    return githubContent;
  }

  /**
   * Resolve comment-only conflicts
   */
  async resolveCommentConflict(conflict) {
    // Merge comments from both versions
    const githubContent = await this.fs.readFile(conflict.githubFile, "utf8");
    const assertThatContent = await this.fs.readFile(
      conflict.assertThatFile,
      "utf8"
    );

    // Simple strategy: prefer GitHub content but could be enhanced to merge comments
    return githubContent;
  }

  /**
   * Resolve formatting-only conflicts
   */
  async resolveFormattingConflict(conflict) {
    // Prefer GitHub version for formatting consistency
    const githubContent = await this.fs.readFile(conflict.githubFile, "utf8");
    return githubContent;
  }

  /**
   * Resolve minor conflicts
   */
  async resolveMinorConflict(conflict) {
    // For minor conflicts, prefer GitHub version
    const githubContent = await this.fs.readFile(conflict.githubFile, "utf8");
    return githubContent;
  }

  /**
   * Generate Git-style conflict markers
   */
  generateConflictMarkers(githubContent, assertThatContent, filename) {
    const lines = [];

    lines.push(`<<<<<<< GitHub (${filename})`);
    lines.push(githubContent);
    lines.push("=======");
    lines.push(assertThatContent);
    lines.push(`>>>>>>> AssertThat (${filename})`);

    return lines.join("\n");
  }

  /**
   * Check if file has unresolved conflict markers
   */
  async hasConflictMarkers(filePath) {
    try {
      const content = await this.fs.readFile(filePath, "utf8");
      return (
        content.includes("<<<<<<<") ||
        content.includes(">>>>>>>") ||
        content.includes("=======")
      );
    } catch (error) {
      return false;
    }
  }

  /**
   * Get resolution statistics
   */
  getStats() {
    return {
      detector: this.detector.getStats(),
      cache: cacheManager.gitCache.getStats(),
    };
  }

  /**
   * Clear resolution cache
   */
  clearCache() {
    this.detector.clearCache();
  }
}
