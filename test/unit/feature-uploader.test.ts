/**
 * OG-45 Phase 2: Feature Uploader Tests
 * Test-driven development for GitHub → AssertThat upload operations
 */

import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import type { Mock } from "jest-mock";
import { FeatureUploader } from "../../scripts/api/FeatureUploader.mjs";

// Mock dependencies
const mockApiClient = {
  uploadFeature: jest.fn(),
  uploadFeatures: jest.fn(),
};

const mockEventBus = {
  emit: jest.fn(),
};

const mockConfig = {
  assertThat: {
    projectId: "10000",
    accessKey: "test-key",
    secretKey: "test-secret",
  },
};

describe("FeatureUploader", () => {
  let uploader: FeatureUploader;

  beforeEach(() => {
    jest.clearAllMocks();
    uploader = new FeatureUploader(mockApiClient, mockConfig, mockEventBus);
  });

  describe("Constructor", () => {
    it("should create uploader with dependencies", () => {
      expect(uploader).toBeDefined();
      expect(uploader.apiClient).toBe(mockApiClient);
      expect(uploader.config).toBe(mockConfig);
      expect(uploader.eventBus).toBe(mockEventBus);
    });

    it("should throw error when apiClient is missing", () => {
      expect(() => {
        new FeatureUploader(null, mockConfig, mockEventBus);
      }).toThrow("API client required");
    });

    it("should throw error when config is missing", () => {
      expect(() => {
        new FeatureUploader(mockApiClient, null, mockEventBus);
      }).toThrow("Configuration required");
    });
  });

  describe("Upload Single Feature", () => {
    it("should upload single feature successfully", async () => {
      mockApiClient.uploadFeature.mockResolvedValue({ success: true });

      const feature = {
        name: "login.feature",
        content: "Feature: Login\n  Scenario: Successful login",
        path: "features/login.feature",
      };

      const result = await uploader.uploadFeature(feature, { tagAsImported: false });

      expect(result.success).toBe(true);
      expect(mockApiClient.uploadFeature).toHaveBeenCalledWith(
        { name: "login.feature", content: feature.content },
        expect.any(Object)
      );
    });

    it("should emit upload started event", async () => {
      mockApiClient.uploadFeature.mockResolvedValue({ success: true });

      const feature = {
        name: "test.feature",
        content: "Feature: Test",
        path: "features/test.feature",
      };

      await uploader.uploadFeature(feature);

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        "UPLOAD_STARTED",
        expect.objectContaining({
          featureName: "test.feature",
        })
      );
    });

    it("should emit upload completed event", async () => {
      mockApiClient.uploadFeature.mockResolvedValue({ success: true });

      const feature = {
        name: "test.feature",
        content: "Feature: Test",
        path: "features/test.feature",
      };

      await uploader.uploadFeature(feature);

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        "UPLOAD_COMPLETED",
        expect.objectContaining({
          featureName: "test.feature",
          success: true,
        })
      );
    });

    it("should handle upload errors gracefully", async () => {
      const error = new Error("Upload failed");
      mockApiClient.uploadFeature.mockRejectedValue(error);

      const feature = {
        name: "test.feature",
        content: "Feature: Test",
        path: "features/test.feature",
      };

      const result = await uploader.uploadFeature(feature);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Upload failed");
      expect(mockEventBus.emit).toHaveBeenCalledWith(
        "UPLOAD_FAILED",
        expect.objectContaining({
          featureName: "test.feature",
          error: "Upload failed",
        })
      );
    });
  });

  describe("Batch Upload", () => {
    it("should upload multiple features successfully", async () => {
      mockApiClient.uploadFeature.mockResolvedValue({ success: true });

      const features = [
        { name: "login.feature", content: "Feature: Login", path: "features/login.feature" },
        { name: "signup.feature", content: "Feature: Signup", path: "features/signup.feature" },
        { name: "logout.feature", content: "Feature: Logout", path: "features/logout.feature" },
      ];

      const result = await uploader.uploadBatch(features);

      expect(result.success).toBe(true);
      expect(result.uploaded).toBe(3);
      expect(result.failed).toBe(0);
      expect(mockApiClient.uploadFeature).toHaveBeenCalledTimes(3);
    });

    it("should track progress during batch upload", async () => {
      mockApiClient.uploadFeature.mockResolvedValue({ success: true });

      const features = [
        { name: "test1.feature", content: "Feature: Test 1", path: "features/test1.feature" },
        { name: "test2.feature", content: "Feature: Test 2", path: "features/test2.feature" },
      ];

      await uploader.uploadBatch(features);

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        "BATCH_UPLOAD_STARTED",
        expect.objectContaining({
          totalFeatures: 2,
        })
      );

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        "BATCH_UPLOAD_PROGRESS",
        expect.objectContaining({
          current: 1,
          total: 2,
        })
      );

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        "BATCH_UPLOAD_COMPLETED",
        expect.objectContaining({
          uploaded: 2,
          failed: 0,
        })
      );
    });

    it("should handle partial failures in batch upload", async () => {
      mockApiClient.uploadFeature
        .mockResolvedValueOnce({ success: true })
        .mockRejectedValueOnce(new Error("Upload failed"))
        .mockResolvedValueOnce({ success: true });

      const features = [
        { name: "test1.feature", content: "Feature: Test 1", path: "features/test1.feature" },
        { name: "test2.feature", content: "Feature: Test 2", path: "features/test2.feature" },
        { name: "test3.feature", content: "Feature: Test 3", path: "features/test3.feature" },
      ];

      const result = await uploader.uploadBatch(features);

      expect(result.success).toBe(false);
      expect(result.uploaded).toBe(2);
      expect(result.failed).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].feature).toBe("test2.feature");
    });

    it("should continue uploading after individual failures", async () => {
      mockApiClient.uploadFeature
        .mockRejectedValueOnce(new Error("First failed"))
        .mockResolvedValueOnce({ success: true });

      const features = [
        { name: "test1.feature", content: "Feature: Test 1", path: "features/test1.feature" },
        { name: "test2.feature", content: "Feature: Test 2", path: "features/test2.feature" },
      ];

      const result = await uploader.uploadBatch(features);

      expect(result.uploaded).toBe(1);
      expect(result.failed).toBe(1);
      expect(mockApiClient.uploadFeature).toHaveBeenCalledTimes(2);
    });
  });

  describe("Import Tagging", () => {
    it("should tag uploaded features as imported from GitHub", async () => {
      mockApiClient.uploadFeature.mockResolvedValue({ success: true });

      const feature = {
        name: "test.feature",
        content: "Feature: Test\n  @smoke\n  Scenario: Test scenario",
        path: "features/test.feature",
      };

      await uploader.uploadFeature(feature, { tagAsImported: true });

      expect(mockApiClient.uploadFeature).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining("@imported-from-github"),
        }),
        expect.any(Object)
      );
    });

    it("should preserve existing tags when adding import tag", async () => {
      mockApiClient.uploadFeature.mockResolvedValue({ success: true });

      const feature = {
        name: "test.feature",
        content: "Feature: Test\n  @smoke @regression\n  Scenario: Test scenario",
        path: "features/test.feature",
      };

      await uploader.uploadFeature(feature, { tagAsImported: true });

      const uploadedContent = (mockApiClient.uploadFeature as Mock).mock.calls[0][0].content;
      expect(uploadedContent).toContain("@smoke");
      expect(uploadedContent).toContain("@regression");
      expect(uploadedContent).toContain("@imported-from-github");
    });

    it("should not add duplicate import tags", async () => {
      mockApiClient.uploadFeature.mockResolvedValue({ success: true });

      const feature = {
        name: "test.feature",
        content: "Feature: Test\n  @imported-from-github\n  Scenario: Test scenario",
        path: "features/test.feature",
      };

      await uploader.uploadFeature(feature, { tagAsImported: true });

      const uploadedContent = (mockApiClient.uploadFeature as Mock).mock.calls[0][0].content;
      const tagCount = (uploadedContent.match(/@imported-from-github/g) || []).length;
      expect(tagCount).toBe(1);
    });
  });

  describe("Metadata Handling", () => {
    it("should include source metadata in uploads", async () => {
      mockApiClient.uploadFeature.mockResolvedValue({ success: true });

      const feature = {
        name: "test.feature",
        content: "Feature: Test",
        path: "features/test.feature",
      };

      await uploader.uploadFeature(feature);

      expect(mockApiClient.uploadFeature).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          metadata: expect.objectContaining({
            source: "github",
          }),
        })
      );
    });

    it("should include timestamp in metadata", async () => {
      mockApiClient.uploadFeature.mockResolvedValue({ success: true });

      const feature = {
        name: "test.feature",
        content: "Feature: Test",
        path: "features/test.feature",
      };

      await uploader.uploadFeature(feature);

      expect(mockApiClient.uploadFeature).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          metadata: expect.objectContaining({
            timestamp: expect.any(String),
          }),
        })
      );
    });
  });
});

