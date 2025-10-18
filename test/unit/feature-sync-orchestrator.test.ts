/**
 * Tests for FeatureSyncOrchestrator
 * Validates event-driven architecture and component composition
 */

import { FeatureSyncOrchestrator } from "../../scripts/orchestration/FeatureSyncOrchestrator.mjs";
import { syncEvents, SYNC_EVENTS } from "../../scripts/events/SyncEvents.mjs";
import { SyncConfiguration } from "../../scripts/config/SyncConfiguration.mjs";

// Mock dependencies
class MockStagingManager {
  createStagingArea = jest.fn().mockResolvedValue(true);
  downloadAssertThatFeatures = jest.fn().mockResolvedValue(undefined);
  cleanStagingArea = jest.fn().mockResolvedValue(undefined);
  getStagingFeatures = jest.fn().mockResolvedValue(["test.feature"]);
  stagingPath = "/test/staging";
}

class MockDiffManager {
  detectChanges = jest.fn().mockResolvedValue({
    additions: ["new.feature"],
    modifications: ["modified.feature"],
    deletions: [],
  });
  classifyChanges = jest.fn().mockResolvedValue({
    simple: ["new.feature"],
    complex: [],
    autoResolved: ["modified.feature"],
  });
}

class MockFeatureProcessor {
  validateFeatureFiles = jest.fn().mockResolvedValue({
    totalFiles: 1,
    validFiles: 1,
    invalidFiles: 0,
    totalErrors: 0,
    totalWarnings: 0,
  });
  getStats = jest.fn().mockReturnValue({ processed: 1 });
  validator = {
    clearCache: jest.fn(),
  };
}

class MockConflictResolver {
  resolveConflicts = jest.fn().mockResolvedValue({
    autoResolved: [],
    requiresManual: [],
    failed: [],
  });
  getStats = jest.fn().mockReturnValue({ resolved: 0 });
  clearCache = jest.fn();
}

class MockUserInteraction {
  close = jest.fn();
  getStats = jest.fn().mockReturnValue({ interactions: 0 });
  clearCache = jest.fn();
}

class MockCacheManager {
  getStats = jest.fn().mockReturnValue({ enabled: true });
  clearAll = jest.fn();
}

class MockLogger {
  info = jest.fn();
  warn = jest.fn();
  error = jest.fn();
  debug = jest.fn();
}

describe("FeatureSyncOrchestrator", () => {
  let orchestrator: FeatureSyncOrchestrator;
  let mockDependencies: any;
  let eventSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    syncEvents.removeAllListeners();
    syncEvents.clearHistory();

    mockDependencies = {
      config: new SyncConfiguration({
        stagingDir: "test-staging",
        assertThat: {
          projectId: "test-project",
          accessKey: "test-key",
          secretKey: "test-secret",
        },
      }),
      stagingManager: new MockStagingManager(),
      diffManager: new MockDiffManager(),
      featureProcessor: new MockFeatureProcessor(),
      conflictResolver: new MockConflictResolver(),
      userInteraction: new MockUserInteraction(),
      cacheManager: new MockCacheManager(),
      logger: new MockLogger(),
    };

    orchestrator = new FeatureSyncOrchestrator(mockDependencies);
    eventSpy = jest.spyOn(syncEvents, "emit");
  });

  afterEach(() => {
    syncEvents.removeAllListeners();
    eventSpy.mockRestore();
  });

  describe("execute", () => {
    it("should complete successful sync with all phases", async () => {
      await orchestrator.execute();

      // Verify all phases were executed
      expect(
        mockDependencies.stagingManager.createStagingArea
      ).toHaveBeenCalled();
      expect(
        mockDependencies.stagingManager.downloadAssertThatFeatures
      ).toHaveBeenCalled();
      expect(mockDependencies.diffManager.detectChanges).toHaveBeenCalled();
      expect(
        mockDependencies.featureProcessor.validateFeatureFiles
      ).toHaveBeenCalled();
      expect(
        mockDependencies.stagingManager.cleanStagingArea
      ).toHaveBeenCalled();

      // Verify events were emitted
      expect(eventSpy).toHaveBeenCalledWith(
        SYNC_EVENTS.SYNC_STARTED,
        expect.any(Object)
      );
      expect(eventSpy).toHaveBeenCalledWith(
        SYNC_EVENTS.SYNC_COMPLETED,
        expect.any(Object)
      );
      expect(eventSpy).toHaveBeenCalledWith(
        SYNC_EVENTS.PHASE_STARTED,
        expect.any(Object)
      );
      expect(eventSpy).toHaveBeenCalledWith(
        SYNC_EVENTS.PHASE_COMPLETED,
        expect.any(Object)
      );
    });

    it("should handle conflicts when modifications exist", async () => {
      mockDependencies.diffManager.detectChanges.mockResolvedValue({
        additions: [],
        modifications: ["conflict.feature"],
        deletions: [],
      });

      await orchestrator.execute();

      expect(mockDependencies.diffManager.classifyChanges).toHaveBeenCalled();
      expect(
        mockDependencies.conflictResolver.resolveConflicts
      ).toHaveBeenCalled();
    });

    it("should skip conflict resolution when no modifications", async () => {
      mockDependencies.diffManager.detectChanges.mockResolvedValue({
        additions: ["new.feature"],
        modifications: [],
        deletions: [],
      });

      await orchestrator.execute();

      expect(
        mockDependencies.diffManager.classifyChanges
      ).not.toHaveBeenCalled();
      expect(
        mockDependencies.conflictResolver.resolveConflicts
      ).not.toHaveBeenCalled();
    });

    it("should handle phase failures gracefully", async () => {
      const error = new Error("Staging setup failed");
      mockDependencies.stagingManager.createStagingArea.mockRejectedValue(
        error
      );

      await expect(orchestrator.execute()).rejects.toThrow(
        "Phase staging-setup failed"
      );

      // Verify cleanup was attempted
      expect(
        mockDependencies.stagingManager.cleanStagingArea
      ).toHaveBeenCalled();
      expect(mockDependencies.userInteraction.close).toHaveBeenCalled();

      // Verify failure event was emitted
      expect(eventSpy).toHaveBeenCalledWith(
        SYNC_EVENTS.SYNC_FAILED,
        expect.any(Object)
      );
    });

    it("should handle cleanup failure during error handling", async () => {
      const setupError = new Error("Setup failed");
      const cleanupError = new Error("Cleanup failed");

      mockDependencies.stagingManager.createStagingArea.mockRejectedValue(
        setupError
      );
      mockDependencies.stagingManager.cleanStagingArea.mockRejectedValue(
        cleanupError
      );

      await expect(orchestrator.execute()).rejects.toThrow(
        "Phase staging-setup failed"
      );

      expect(mockDependencies.logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Cleanup failed")
      );
    });
  });

  describe("executePhase", () => {
    it("should emit phase events correctly", async () => {
      const mockPhaseFunction = jest
        .fn()
        .mockResolvedValue({ result: "success" });

      const result = await orchestrator.executePhase(
        "test-phase",
        mockPhaseFunction
      );

      expect(result).toEqual({ result: "success" });
      expect(eventSpy).toHaveBeenCalledWith(
        SYNC_EVENTS.PHASE_STARTED,
        expect.objectContaining({ phase: "test-phase" })
      );
      expect(eventSpy).toHaveBeenCalledWith(
        SYNC_EVENTS.PHASE_COMPLETED,
        expect.objectContaining({
          phase: "test-phase",
          result: { result: "success" },
        })
      );
    });

    it("should handle phase function failures", async () => {
      const error = new Error("Phase function failed");
      const mockPhaseFunction = jest.fn().mockRejectedValue(error);

      await expect(
        orchestrator.executePhase("test-phase", mockPhaseFunction)
      ).rejects.toThrow("Phase test-phase failed");

      expect(eventSpy).toHaveBeenCalledWith(
        SYNC_EVENTS.PHASE_FAILED,
        expect.objectContaining({
          phase: "test-phase",
          error: "Phase function failed",
        })
      );
    });
  });

  describe("configuration validation", () => {
    it("should validate configuration successfully", async () => {
      const validation = await orchestrator.validateConfiguration();

      expect(validation.isValid).toBe(true);
      expect(eventSpy).toHaveBeenCalledWith(
        SYNC_EVENTS.CONFIG_VALIDATED,
        expect.objectContaining({ isValid: true })
      );
    });

    it("should handle configuration validation failure", async () => {
      // Explicitly create config without credentials (ignore env vars)
      const invalidConfig = new SyncConfiguration({
        projectId: "",
        accessKey: "",
        secretKey: "",
      });
      orchestrator.config = invalidConfig;

      await expect(orchestrator.validateConfiguration()).rejects.toThrow(
        "Configuration validation failed"
      );
    });
  });

  describe("event listeners", () => {
    it("should log progress updates", () => {
      syncEvents.emit(SYNC_EVENTS.PROGRESS_UPDATE, {
        message: "Test progress",
        progress: 50,
      });

      expect(mockDependencies.logger.info).toHaveBeenCalledWith(
        "📊 Test progress (50%)"
      );
    });

    it("should log cache hits", () => {
      syncEvents.emit(SYNC_EVENTS.CACHE_HIT, {
        type: "test-cache",
      });

      expect(mockDependencies.logger.debug).toHaveBeenCalledWith(
        "🎯 Cache hit: test-cache"
      );
    });

    it("should log phase failures", () => {
      syncEvents.emit(SYNC_EVENTS.PHASE_FAILED, {
        phase: "test-phase",
        duration: 1000,
        error: "Test error",
      });

      expect(mockDependencies.logger.error).toHaveBeenCalledWith(
        "💥 Phase test-phase failed in 1000ms: Test error"
      );
    });
  });

  describe("statistics and cache management", () => {
    it("should return comprehensive stats", () => {
      const stats = orchestrator.getStats();

      expect(stats).toHaveProperty("cache");
      expect(stats).toHaveProperty("events");
      expect(stats).toHaveProperty("conflicts");
      expect(stats).toHaveProperty("validation");
      expect(stats).toHaveProperty("userInteraction");
    });

    it("should clear all caches", () => {
      orchestrator.clearCaches();

      expect(mockDependencies.cacheManager.clearAll).toHaveBeenCalled();
      expect(mockDependencies.conflictResolver.clearCache).toHaveBeenCalled();
      expect(mockDependencies.userInteraction.clearCache).toHaveBeenCalled();
    });
  });

  describe("dependency injection", () => {
    it("should work with minimal dependencies", () => {
      const minimalOrchestrator = new FeatureSyncOrchestrator({
        config: new SyncConfiguration({
          stagingDir: "test",
          assertThat: {
            projectId: "test",
            accessKey: "test",
            secretKey: "test",
          },
        }),
      });

      expect(minimalOrchestrator.config).toBeDefined();
      expect(minimalOrchestrator.featureProcessor).toBeDefined();
      expect(minimalOrchestrator.conflictResolver).toBeDefined();
    });

    it("should use injected dependencies correctly", () => {
      expect(orchestrator.config).toBe(mockDependencies.config);
      expect(orchestrator.stagingManager).toBe(mockDependencies.stagingManager);
      expect(orchestrator.diffManager).toBe(mockDependencies.diffManager);
    });
  });
});
