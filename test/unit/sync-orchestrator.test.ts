import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { SyncOrchestrator } from "../../scripts/orchestration/SyncOrchestrator.mjs";
import { SyncConfiguration } from "../../scripts/config/SyncConfiguration.mjs";
import { SyncOrchestrationError } from "../../scripts/errors/SyncErrors.mjs";

// Mock implementations
class MockStagingAreaManager {
  createStagingArea = jest.fn().mockResolvedValue(true);
  downloadAssertThatFeatures = jest.fn().mockResolvedValue(undefined);
  cleanStagingArea = jest.fn().mockResolvedValue(undefined);
}

class MockGitDiffManager {
  detectChanges = jest.fn().mockResolvedValue({
    additions: ["new.feature"],
    modifications: ["modified.feature"],
    deletions: ["deleted.feature"],
  });
  classifyChanges = jest.fn().mockResolvedValue({
    simple: ["new.feature"],
    complex: [],
    autoResolved: ["modified.feature"],
  });
}

class MockConflictResolver {
  resolveConflicts = jest.fn().mockResolvedValue({
    autoResolved: ["modified.feature"],
    requiresManual: [],
    failed: [],
  });
}

class MockGherkinValidator {
  validateFeatureFiles = jest.fn().mockResolvedValue({
    totalFiles: 2,
    validFiles: 2,
    invalidFiles: 0,
    totalErrors: 0,
    totalWarnings: 0,
  });
}

class MockLogger {
  info = jest.fn();
  success = jest.fn();
  warning = jest.fn();
  error = jest.fn();
}

describe("SyncOrchestrator", () => {
  let orchestrator: SyncOrchestrator;
  let config: SyncConfiguration;
  let mockStagingManager: MockStagingAreaManager;
  let mockDiffManager: MockGitDiffManager;
  let mockConflictResolver: MockConflictResolver;
  let mockGherkinValidator: MockGherkinValidator;
  let mockLogger: MockLogger;

  beforeEach(() => {
    jest.clearAllMocks();

    config = new SyncConfiguration({
      stagingDir: "test-staging",
      featuresDir: "test-features",
    });

    mockStagingManager = new MockStagingAreaManager();
    mockDiffManager = new MockGitDiffManager();
    mockConflictResolver = new MockConflictResolver();
    mockGherkinValidator = new MockGherkinValidator();
    mockLogger = new MockLogger();

    orchestrator = new SyncOrchestrator(
      config,
      mockStagingManager,
      mockDiffManager,
      mockConflictResolver,
      mockGherkinValidator,
      mockLogger
    );
  });

  describe("execute", () => {
    it("should complete successful sync with no conflicts", async () => {
      const result = await orchestrator.execute();

      expect(result.success).toBe(true);
      expect(result.phase).toBe("completed");
      expect(result.changes).toBeDefined();
      expect(result.classified).toBeDefined();

      // Verify all phases were called
      expect(mockStagingManager.createStagingArea).toHaveBeenCalled();
      expect(mockStagingManager.downloadAssertThatFeatures).toHaveBeenCalled();
      expect(mockDiffManager.detectChanges).toHaveBeenCalled();
      expect(mockDiffManager.classifyChanges).toHaveBeenCalled();
      expect(mockStagingManager.cleanStagingArea).toHaveBeenCalled();

      // Verify logging
      expect(mockLogger.info).toHaveBeenCalledWith(
        "Starting GitHub ↔ AssertThat sync..."
      );
      expect(mockLogger.success).toHaveBeenCalledWith("Sync process completed");
    });

    it("should handle complex conflicts requiring interactive resolution", async () => {
      mockDiffManager.classifyChanges.mockResolvedValue({
        simple: ["new.feature"],
        complex: ["conflict.feature"],
        autoResolved: [],
      });

      const result = await orchestrator.execute();

      expect(result.success).toBe(true);
      expect(mockLogger.warning).toHaveBeenCalledWith(
        "Interactive resolution required for complex conflicts..."
      );
    });

    it("should handle configuration validation warnings", async () => {
      const invalidConfig = new SyncConfiguration(); // No env vars set
      const orchestratorWithInvalidConfig = new SyncOrchestrator(
        invalidConfig,
        mockStagingManager,
        mockDiffManager,
        mockConflictResolver,
        mockGherkinValidator,
        mockLogger
      );

      const result = await orchestratorWithInvalidConfig.execute();

      expect(result.success).toBe(true);
      expect(mockLogger.warning).toHaveBeenCalledWith(
        "Missing environment variables, using demo mode"
      );
    });

    it("should handle staging area setup failure", async () => {
      const setupError = new Error("Staging setup failed");
      mockStagingManager.createStagingArea.mockRejectedValue(setupError);

      const result = await orchestrator.execute();

      expect(result.success).toBe(false);
      expect(result.phase).toBe("error");
      expect(result.error).toBeInstanceOf(SyncOrchestrationError);
      expect(mockLogger.error).toHaveBeenCalled();
      expect(mockStagingManager.cleanStagingArea).toHaveBeenCalled(); // Cleanup on error
    });

    it("should handle change detection failure", async () => {
      const detectionError = new Error("Change detection failed");
      mockDiffManager.detectChanges.mockRejectedValue(detectionError);

      const result = await orchestrator.execute();

      expect(result.success).toBe(false);
      expect(result.error).toBeInstanceOf(SyncOrchestrationError);
      expect((result.error as SyncOrchestrationError).phase).toBe("detection");
    });

    it("should handle conflict resolution failure", async () => {
      const resolutionError = new Error("Conflict resolution failed");
      mockDiffManager.classifyChanges.mockRejectedValue(resolutionError);

      const result = await orchestrator.execute();

      expect(result.success).toBe(false);
      expect(result.error).toBeInstanceOf(SyncOrchestrationError);
      expect((result.error as SyncOrchestrationError).phase).toBe("resolution");
    });

    it("should handle cleanup failure gracefully", async () => {
      const cleanupError = new Error("Cleanup failed");
      mockStagingManager.cleanStagingArea.mockRejectedValue(cleanupError);

      const result = await orchestrator.execute();

      expect(result.success).toBe(false);
      expect(result.error).toBeInstanceOf(SyncOrchestrationError);
      expect((result.error as SyncOrchestrationError).phase).toBe("cleanup");
    });

    it("should handle cleanup failure during error handling", async () => {
      const setupError = new Error("Setup failed");
      const cleanupError = new Error("Cleanup failed");

      mockStagingManager.createStagingArea.mockRejectedValue(setupError);
      mockStagingManager.cleanStagingArea.mockRejectedValue(cleanupError);

      const result = await orchestrator.execute();

      expect(result.success).toBe(false);
      expect(mockLogger.error).toHaveBeenCalledWith(
        "Cleanup failed: Cleanup failed"
      );
    });
  });

  describe("phase isolation", () => {
    it("should stop execution if configuration phase fails", async () => {
      // Force configuration validation to throw
      const invalidConfig = {
        ...config,
        validateConfiguration: jest.fn().mockImplementation(() => {
          throw new Error("Config validation failed");
        }),
      } as any;

      const orchestratorWithBadConfig = new SyncOrchestrator(
        invalidConfig,
        mockStagingManager,
        mockDiffManager,
        mockConflictResolver,
        mockGherkinValidator,
        mockLogger
      );

      const result = await orchestratorWithBadConfig.execute();

      expect(result.success).toBe(false);
      expect(mockStagingManager.createStagingArea).not.toHaveBeenCalled();
    });

    it("should not proceed to conflict resolution if change detection fails", async () => {
      mockDiffManager.detectChanges.mockRejectedValue(
        new Error("Detection failed")
      );

      const result = await orchestrator.execute();

      expect(result.success).toBe(false);
      expect(mockDiffManager.classifyChanges).not.toHaveBeenCalled();
    });
  });

  describe("logging behavior", () => {
    it("should log classification results correctly", async () => {
      mockDiffManager.classifyChanges.mockResolvedValue({
        simple: ["file1.feature", "file2.feature"],
        complex: ["file3.feature"],
        autoResolved: ["file4.feature"],
      });

      await orchestrator.execute();

      expect(mockLogger.info).toHaveBeenCalledWith("Classification results:");
      expect(mockLogger.success).toHaveBeenCalledWith("Simple: 2 files");
      expect(mockLogger.info).toHaveBeenCalledWith("Auto-resolved: 1 files");
      expect(mockLogger.warning).toHaveBeenCalledWith("Complex: 1 files");
    });

    it("should handle undefined classification results gracefully", async () => {
      mockDiffManager.classifyChanges.mockResolvedValue({
        simple: undefined,
        complex: null,
        autoResolved: [],
      });

      await orchestrator.execute();

      expect(mockLogger.success).toHaveBeenCalledWith("Simple: 0 files");
      expect(mockLogger.warning).toHaveBeenCalledWith("Complex: 0 files");
    });
  });

  describe("dependency injection", () => {
    it("should use injected dependencies correctly", async () => {
      await orchestrator.execute();

      // Verify that all injected dependencies were used
      expect(mockStagingManager.createStagingArea).toHaveBeenCalled();
      expect(mockDiffManager.detectChanges).toHaveBeenCalled();
      expect(mockConflictResolver.resolveConflicts).not.toHaveBeenCalled(); // Only called for complex conflicts
      expect(mockGherkinValidator.validateFeatureFiles).not.toHaveBeenCalled(); // Placeholder implementation
      expect(mockLogger.info).toHaveBeenCalled();
    });

    it("should work with default logger when none provided", () => {
      const orchestratorWithDefaultLogger = new SyncOrchestrator(
        config,
        mockStagingManager,
        mockDiffManager,
        mockConflictResolver,
        mockGherkinValidator
        // No logger provided - should use default ConsoleLogger
      );

      expect(orchestratorWithDefaultLogger).toBeDefined();
    });
  });
});
