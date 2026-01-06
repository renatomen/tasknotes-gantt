/**
 * OG-45 Phase 3: Feature Downloader Tests
 * Test-driven development for AssertThat → GitHub download operations
 */

import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import type { Mock } from "jest-mock";
import { FeatureDownloader } from "../../scripts/api/FeatureDownloader.mjs";
import AdmZip from "adm-zip";

// Mock dependencies
const mockApiClient = {
  downloadFeatures: jest.fn(),
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

const mockFs = {
  mkdir: jest.fn(),
  writeFile: jest.fn(),
  readdir: jest.fn(),
};

// Helper function to create a valid ZIP buffer
function createMockZipBuffer(files: { name: string; content: string }[] = []): Buffer {
  const zip = new AdmZip();

  if (files.length === 0) {
    // Add a default feature file
    zip.addFile("test.feature", Buffer.from("Feature: Test\n  Scenario: Test scenario"));
  } else {
    for (const file of files) {
      zip.addFile(file.name, Buffer.from(file.content));
    }
  }

  return zip.toBuffer();
}

describe("FeatureDownloader", () => {
  let downloader: any;

  beforeEach(() => {
    jest.clearAllMocks();
    downloader = new FeatureDownloader(mockApiClient, mockConfig, mockEventBus, mockFs);
  });

  describe("Constructor", () => {
    it("should create downloader with dependencies", () => {
      expect(downloader).toBeDefined();
      expect(downloader.apiClient).toBe(mockApiClient);
      expect(downloader.config).toBe(mockConfig);
      expect(downloader.eventBus).toBe(mockEventBus);
    });

    it("should throw error when apiClient is missing", () => {
      expect(() => {
        new FeatureDownloader(null, mockConfig, mockEventBus, mockFs);
      }).toThrow("API client required");
    });

    it("should throw error when config is missing", () => {
      expect(() => {
        new FeatureDownloader(mockApiClient, null, mockEventBus, mockFs);
      }).toThrow("Configuration required");
    });
  });

  describe("Download Features", () => {
    it("should download features as ZIP and extract", async () => {
      const mockZipBuffer = createMockZipBuffer();
      mockApiClient.downloadFeatures.mockResolvedValue(mockZipBuffer);
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);

      const result = await downloader.downloadFeatures("./staging");

      expect(mockApiClient.downloadFeatures).toHaveBeenCalledWith({
        mode: "automated",
      });
      expect(result.success).toBe(true);
    });

    it("should emit download started event", async () => {
      const mockZipBuffer = createMockZipBuffer();
      mockApiClient.downloadFeatures.mockResolvedValue(mockZipBuffer);
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);

      await downloader.downloadFeatures("./staging");

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        "DOWNLOAD_STARTED",
        expect.objectContaining({
          destination: "./staging",
        })
      );
    });

    it("should emit download completed event", async () => {
      const mockZipBuffer = createMockZipBuffer();
      mockApiClient.downloadFeatures.mockResolvedValue(mockZipBuffer);
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);

      await downloader.downloadFeatures("./staging");

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        "DOWNLOAD_COMPLETED",
        expect.objectContaining({
          success: true,
        })
      );
    });

    it("should handle download errors gracefully", async () => {
      const error = new Error("Download failed");
      mockApiClient.downloadFeatures.mockRejectedValue(error);

      const result = await downloader.downloadFeatures("./staging");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Download failed");
      expect(mockEventBus.emit).toHaveBeenCalledWith(
        "DOWNLOAD_FAILED",
        expect.objectContaining({
          error: "Download failed",
        })
      );
    });

    it("should support filtering options", async () => {
      const mockZipBuffer = createMockZipBuffer();
      mockApiClient.downloadFeatures.mockResolvedValue(mockZipBuffer);
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);

      await downloader.downloadFeatures("./staging", {
        mode: "manual",
        tags: "@smoke",
        jql: "project = TEST",
      });

      expect(mockApiClient.downloadFeatures).toHaveBeenCalledWith({
        mode: "manual",
        tags: "@smoke",
        jql: "project = TEST",
      });
    });
  });

  describe("Extract ZIP", () => {
    it("should extract feature files from ZIP buffer", async () => {
      const mockZipBuffer = createMockZipBuffer([
        { name: "test.feature", content: "Feature: Test" },
      ]);
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);

      const result = await downloader.extractZip(mockZipBuffer, "./staging");

      expect(result.filesExtracted).toBe(1);
    });

    it("should create destination directory if it doesn't exist", async () => {
      const mockZipBuffer = createMockZipBuffer();
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);

      await downloader.extractZip(mockZipBuffer, "./staging");

      expect(mockFs.mkdir).toHaveBeenCalledWith(
        "./staging",
        expect.objectContaining({ recursive: true })
      );
    });

    it("should only extract .feature files", async () => {
      const mockZipBuffer = createMockZipBuffer([
        { name: "test.feature", content: "Feature: Test" },
        { name: "readme.txt", content: "Not a feature" },
      ]);
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);

      await downloader.extractZip(mockZipBuffer, "./staging");

      // Verify that only .feature files are written
      expect(mockFs.writeFile).toHaveBeenCalledTimes(1);
      const filePath = (mockFs.writeFile as Mock).mock.calls[0][0];
      expect(filePath).toMatch(/\.feature$/);
    });
  });

  describe("Metadata Preservation", () => {
    it("should preserve feature metadata during download", async () => {
      const mockZipBuffer = createMockZipBuffer();
      mockApiClient.downloadFeatures.mockResolvedValue(mockZipBuffer);
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);

      const result = await downloader.downloadFeatures("./staging", {
        preserveMetadata: true,
      });

      expect(result.metadata).toBeDefined();
      expect(result.metadata.downloadedAt).toBeDefined();
      expect(result.metadata.source).toBe("assertthat");
    });

    it("should include download timestamp in metadata", async () => {
      const mockZipBuffer = createMockZipBuffer();
      mockApiClient.downloadFeatures.mockResolvedValue(mockZipBuffer);
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);

      const result = await downloader.downloadFeatures("./staging");

      expect(result.metadata.downloadedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  describe("File Organization", () => {
    it("should organize files by feature structure", async () => {
      const mockZipBuffer = createMockZipBuffer();
      mockApiClient.downloadFeatures.mockResolvedValue(mockZipBuffer);
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);

      await downloader.downloadFeatures("./staging", {
        organizeByFolder: true,
      });

      // Verify directory structure is created
      expect(mockFs.mkdir).toHaveBeenCalled();
    });

    it("should flatten structure when organizeByFolder is false", async () => {
      const mockZipBuffer = createMockZipBuffer();
      mockApiClient.downloadFeatures.mockResolvedValue(mockZipBuffer);
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);

      await downloader.downloadFeatures("./staging", {
        organizeByFolder: false,
      });

      // All files should be in root staging directory
      expect(mockFs.mkdir).toHaveBeenCalledWith(
        "./staging",
        expect.any(Object)
      );
    });
  });

  describe("Progress Tracking", () => {
    it("should emit extraction progress events", async () => {
      const mockZipBuffer = createMockZipBuffer();
      mockApiClient.downloadFeatures.mockResolvedValue(mockZipBuffer);
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);

      await downloader.downloadFeatures("./staging");

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        "EXTRACTION_STARTED",
        expect.any(Object)
      );

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        "EXTRACTION_COMPLETED",
        expect.any(Object)
      );
    });
  });
});

