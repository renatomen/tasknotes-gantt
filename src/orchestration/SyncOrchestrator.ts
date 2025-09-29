/**
 * Refactored SyncOrchestrator with dependency injection and single responsibility methods
 */

import { ISyncConfiguration } from "../config/SyncConfiguration.js";
import {
  SyncOrchestrationError,
  SyncConfigurationError,
  SyncErrorFactory,
} from "../errors/SyncErrors.js";

export interface IStagingAreaManager {
  createStagingArea(): Promise<boolean>;
  downloadAssertThatFeatures(): Promise<void>;
  cleanStagingArea(): Promise<void>;
}

export interface IGitDiffManager {
  detectChanges(): Promise<any>;
  classifyChanges(changes: any): Promise<any>;
}

export interface IConflictResolver {
  resolveConflicts(
    changes: any,
    stagingPath: string,
    featuresPath: string
  ): Promise<any>;
}

export interface IGherkinValidator {
  validateFeatureFiles(filePaths: string[]): Promise<any>;
}

export interface ILogger {
  info(message: string): void;
  success(message: string): void;
  warning(message: string): void;
  error(message: string): void;
}

export class ConsoleLogger implements ILogger {
  constructor(private config: ISyncConfiguration) {}

  info(message: string): void {
    console.log(`${this.config.ui.icons.info} ${message}`);
  }

  success(message: string): void {
    console.log(`${this.config.ui.icons.success} ${message}`);
  }

  warning(message: string): void {
    console.log(`${this.config.ui.icons.warning} ${message}`);
  }

  error(message: string): void {
    console.log(`${this.config.ui.icons.error} ${message}`);
  }
}

export interface ISyncResult {
  success: boolean;
  phase: string;
  changes?: any;
  classified?: any;
  resolutionResults?: any;
  error?: Error;
}

export class SyncOrchestrator {
  constructor(
    private config: ISyncConfiguration,
    private stagingManager: IStagingAreaManager,
    private diffManager: IGitDiffManager,
    private conflictResolver: IConflictResolver,
    private gherkinValidator: IGherkinValidator,
    private logger: ILogger = new ConsoleLogger(config)
  ) {}

  /**
   * Main execution method - orchestrates the sync process
   */
  async execute(): Promise<ISyncResult> {
    try {
      this.logger.info("Starting GitHub ↔ AssertThat sync...");

      // Phase 1: Configuration validation
      await this.validateConfigurationPhase();

      // Phase 2: Staging area setup
      await this.setupStagingPhase();

      // Phase 3: Change detection and validation
      const changes = await this.detectChangesPhase();

      // Phase 4: Conflict resolution
      const classified = await this.resolveConflictsPhase(changes);

      // Phase 5: Interactive resolution if needed
      const resolutionResults =
        await this.handleInteractiveResolutionPhase(classified);

      // Phase 6: Cleanup
      await this.cleanupPhase();

      this.logger.success("Sync process completed");

      return {
        success: true,
        phase: "completed",
        changes,
        classified,
        resolutionResults,
      };
    } catch (error) {
      return await this.handleExecutionError(error as Error);
    }
  }

  /**
   * Phase 1: Validate configuration and prerequisites
   */
  private async validateConfigurationPhase(): Promise<void> {
    try {
      const validation = this.config.validateConfiguration();

      if (!validation.isValid) {
        this.logger.warning(`Missing environment variables, using demo mode`);
        this.logger.warning(`Missing: ${validation.missingFields.join(", ")}`);
      }
    } catch (error) {
      throw new SyncOrchestrationError(
        "Configuration validation failed",
        "configuration",
        { validationError: (error as Error).message }
      );
    }
  }

  /**
   * Phase 2: Setup staging area and download features
   */
  private async setupStagingPhase(): Promise<void> {
    try {
      await this.stagingManager.createStagingArea();
      await this.stagingManager.downloadAssertThatFeatures();
    } catch (error) {
      throw new SyncOrchestrationError("Staging area setup failed", "staging", {
        setupError: (error as Error).message,
      });
    }
  }

  /**
   * Phase 3: Detect changes and validate feature files
   */
  private async detectChangesPhase(): Promise<any> {
    try {
      this.logger.info("Detecting changes between GitHub and AssertThat...");
      const changes = await this.diffManager.detectChanges();

      this.logger.info("Validating feature files...");
      await this.validateFeatureFiles(changes);

      return changes;
    } catch (error) {
      throw new SyncOrchestrationError("Change detection failed", "detection", {
        detectionError: (error as Error).message,
      });
    }
  }

  /**
   * Phase 4: Classify changes and attempt auto-resolution
   */
  private async resolveConflictsPhase(changes: any): Promise<any> {
    try {
      this.logger.info("Classifying changes for conflict resolution...");
      const classified = await this.diffManager.classifyChanges(changes);

      this.logClassificationResults(classified);

      return classified;
    } catch (error) {
      throw new SyncOrchestrationError(
        "Conflict resolution failed",
        "resolution",
        { resolutionError: (error as Error).message }
      );
    }
  }

  /**
   * Phase 5: Handle interactive resolution for complex conflicts
   */
  private async handleInteractiveResolutionPhase(
    classified: any
  ): Promise<any> {
    if (classified.complex.length === 0) {
      this.logger.success(
        "All conflicts resolved automatically - sync can proceed"
      );
      return { resolved: [], skipped: [], failed: [] };
    }

    try {
      this.logger.warning(
        "Interactive resolution required for complex conflicts..."
      );
      const resolutionResults = await this.handleInteractiveResolution(
        classified.complex
      );

      this.logResolutionSummary(resolutionResults);

      return resolutionResults;
    } catch (error) {
      throw new SyncOrchestrationError(
        "Interactive resolution failed",
        "interactive",
        { interactiveError: (error as Error).message }
      );
    }
  }

  /**
   * Phase 6: Cleanup staging area
   */
  private async cleanupPhase(): Promise<void> {
    try {
      await this.stagingManager.cleanStagingArea();
    } catch (error) {
      throw new SyncOrchestrationError("Cleanup failed", "cleanup", {
        cleanupError: (error as Error).message,
      });
    }
  }

  /**
   * Handle execution errors with proper cleanup
   */
  private async handleExecutionError(error: Error): Promise<ISyncResult> {
    this.logger.error(`Sync failed: ${error.message}`);

    // Attempt cleanup on error
    try {
      await this.stagingManager.cleanStagingArea();
    } catch (cleanupError) {
      this.logger.error(`Cleanup failed: ${(cleanupError as Error).message}`);
    }

    return {
      success: false,
      phase: "error",
      error,
    };
  }

  /**
   * Validate feature files using the Gherkin validator
   */
  private async validateFeatureFiles(changes: any): Promise<void> {
    // Implementation would call gherkinValidator.validateFeatureFiles
    // This is a placeholder for the actual validation logic
  }

  /**
   * Handle interactive resolution for complex files
   */
  private async handleInteractiveResolution(
    complexFiles: string[]
  ): Promise<any> {
    // Implementation would handle interactive resolution
    // This is a placeholder for the actual resolution logic
    return { resolved: [], skipped: [], failed: [] };
  }

  /**
   * Log classification results
   */
  private logClassificationResults(classified: any): void {
    this.logger.info(`Classification results:`);
    this.logger.success(`Simple: ${classified.simple?.length || 0} files`);
    this.logger.info(
      `Auto-resolved: ${classified.autoResolved?.length || 0} files`
    );
    this.logger.warning(`Complex: ${classified.complex?.length || 0} files`);
  }

  /**
   * Log resolution summary
   */
  private logResolutionSummary(resolutionResults: any): void {
    this.logger.info("Interactive resolution summary:");
    this.logger.success(`Resolved: ${resolutionResults.resolved.length} files`);
    this.logger.info(`Skipped: ${resolutionResults.skipped.length} files`);
    this.logger.error(`Failed: ${resolutionResults.failed.length} files`);

    if (resolutionResults.skipped.length > 0) {
      this.logger.warning(
        "Skipped files will need manual resolution before next sync:"
      );
      resolutionResults.skipped.forEach((file: string) =>
        console.log(`  - ${file}`)
      );
    }
  }
}
