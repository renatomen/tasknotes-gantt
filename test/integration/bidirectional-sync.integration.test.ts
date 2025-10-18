/**
 * OG-45: Bidirectional Sync Integration Tests
 * 
 * Tests the complete bidirectional sync workflow with real AssertThat API:
 * - Download features from AssertThat
 * - Upload features to AssertThat
 * - Round-trip sync (upload → download → verify)
 * - Modification detection and sync
 * - Transaction rollback on failures
 * 
 * These tests use REAL API calls with credentials from .env
 */

import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { AssertThatApiClient } from "../../scripts/api/AssertThatApiClient.mjs";
import { FeatureUploader } from "../../scripts/api/FeatureUploader.mjs";
import { FeatureDownloader } from "../../scripts/api/FeatureDownloader.mjs";
import { SyncTransaction } from "../../scripts/api/SyncTransaction.mjs";
import { EventEmitter } from "events";
import fs from "fs/promises";
import path from "path";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

describe("Bidirectional Sync Integration Tests", () => {
  let apiClient: any;
  let uploader: any;
  let downloader: any;
  let eventBus: EventEmitter;
  let testDir: string;

  const config = {
    projectId: process.env.ASSERTTHAT_PROJECT_ID,
    accessKey: process.env.ASSERTTHAT_ACCESS_KEY,
    secretKey: process.env.ASSERTTHAT_SECRET_KEY,
    sync: {
      backupPath: "./test-backups",
      transactionLogPath: "./test-transaction-log.json",
    },
  };

  beforeAll(async () => {
    // Verify credentials are available
    if (!config.projectId || !config.accessKey || !config.secretKey) {
      throw new Error(
        "Missing AssertThat credentials. Please set ASSERTTHAT_PROJECT_ID, ASSERTTHAT_ACCESS_KEY, and ASSERTTHAT_SECRET_KEY in .env"
      );
    }

    // Initialize components
    apiClient = new AssertThatApiClient(config);
    eventBus = new EventEmitter();
    uploader = new FeatureUploader(apiClient, config, eventBus);
    downloader = new FeatureDownloader(apiClient, config, eventBus, fs);

    // Create test directory
    testDir = path.join(process.cwd(), "test-temp", "sync-integration");
    await fs.mkdir(testDir, { recursive: true });
  });

  afterAll(async () => {
    // Cleanup test directory
    try {
      await fs.rm(testDir, { recursive: true, force: true });
      await fs.rm("./test-backups", { recursive: true, force: true });
      await fs.unlink("./test-transaction-log.json").catch(() => {});
    } catch (_error) {
      // Ignore cleanup errors
    }
  });

  describe("Download from AssertThat", () => {
    it("should download features from AssertThat as ZIP", async () => {
      const result = await downloader.downloadFeatures(testDir, {
        mode: "automated",
      });

      expect(result.success).toBe(true);
      expect(result.filesExtracted).toBeGreaterThan(0);
      expect(result.metadata.source).toBe("assertthat");
      expect(result.metadata.downloadedAt).toBeDefined();
    }, 30000);

    it("should extract .feature files to destination directory", async () => {
      const downloadDir = path.join(testDir, "download-test");
      await fs.mkdir(downloadDir, { recursive: true });

      const result = await downloader.downloadFeatures(downloadDir);

      expect(result.success).toBe(true);
      expect(result.filesExtracted).toBeGreaterThan(0);

      // Verify files exist
      const files = await fs.readdir(downloadDir);
      const featureFiles = files.filter((f) => f.endsWith(".feature"));
      expect(featureFiles.length).toBeGreaterThan(0);
    }, 30000);

    it("should download features with valid Gherkin syntax", async () => {
      const downloadDir = path.join(testDir, "gherkin-test");
      await fs.mkdir(downloadDir, { recursive: true });

      await downloader.downloadFeatures(downloadDir);

      // Read first feature file
      const files = await fs.readdir(downloadDir);
      const featureFile = files.find((f) => f.endsWith(".feature"));
      expect(featureFile).toBeDefined();

      const content = await fs.readFile(
        path.join(downloadDir, featureFile!),
        "utf8"
      );

      // Verify Gherkin structure
      expect(content).toContain("Feature:");
      expect(content).toMatch(/Scenario:|Scenario Outline:/);
    }, 30000);

    it("should preserve @imported-from-github tags on download", async () => {
      const downloadDir = path.join(testDir, "tag-preservation-test");
      await fs.mkdir(downloadDir, { recursive: true });

      await downloader.downloadFeatures(downloadDir);

      // Read files and check for tags
      const files = await fs.readdir(downloadDir);
      const featureFiles = files.filter((f) => f.endsWith(".feature"));

      let foundImportTag = false;
      for (const file of featureFiles) {
        const content = await fs.readFile(
          path.join(downloadDir, file),
          "utf8"
        );
        if (content.includes("@imported-from-github")) {
          foundImportTag = true;
          break;
        }
      }

      expect(foundImportTag).toBe(true);
    }, 30000);
  });

  describe("Round-Trip Sync", () => {
    it("should upload and download the same feature successfully", async () => {
      const testFeature = {
        name: "round-trip-test.feature",
        content: `Feature: Round Trip Test
  This feature tests the complete upload-download cycle
  
  @round-trip-test @automated
  Scenario: Upload and download should preserve content
    Given a feature is uploaded to AssertThat
    When the feature is downloaded back
    Then the content should match the original
`,
      };

      // Upload
      const uploadResult = await uploader.uploadFeature(testFeature, {
        tagAsImported: true,
        override: true,
      });
      expect(uploadResult.success).toBe(true);

      // Wait a bit for AssertThat to process
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Download
      const downloadDir = path.join(testDir, "round-trip");
      await fs.mkdir(downloadDir, { recursive: true });
      const downloadResult = await downloader.downloadFeatures(downloadDir);

      expect(downloadResult.success).toBe(true);

      // Verify files were downloaded
      const files = await fs.readdir(downloadDir);
      const featureFiles = files.filter((f) => f.endsWith(".feature"));
      expect(featureFiles.length).toBeGreaterThan(0);

      // Find our test feature (might have different name in AssertThat)
      let foundTestFeature = false;
      for (const file of featureFiles) {
        const content = await fs.readFile(
          path.join(downloadDir, file),
          "utf8"
        );
        if (content.includes("Feature: Round Trip Test")) {
          foundTestFeature = true;
          expect(content).toContain("@imported-from-github");
          break;
        }
      }
      expect(foundTestFeature).toBe(true);
    }, 60000);

    it("should handle batch upload and download correctly", async () => {
      const features = [
        {
          name: "batch-test-1.feature",
          content: `Feature: Batch Test 1
  @batch-test @automated
  Scenario: First batch test
    Given this is test 1
    Then it should work
`,
        },
        {
          name: "batch-test-2.feature",
          content: `Feature: Batch Test 2
  @batch-test @automated
  Scenario: Second batch test
    Given this is test 2
    Then it should also work
`,
        },
      ];

      // Upload batch
      const uploadResult = await uploader.uploadBatch(features);
      expect(uploadResult.success).toBe(true);
      expect(uploadResult.uploaded).toBe(2);

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Download
      const downloadDir = path.join(testDir, "batch-round-trip");
      await fs.mkdir(downloadDir, { recursive: true });
      const downloadResult = await downloader.downloadFeatures(downloadDir);

      expect(downloadResult.success).toBe(true);

      // Verify files were downloaded and contain our batch tests
      const files = await fs.readdir(downloadDir);
      const featureFiles = files.filter((f) => f.endsWith(".feature"));
      expect(featureFiles.length).toBeGreaterThan(0);

      // Check if our batch test features are present
      let foundBatchTests = 0;
      for (const file of featureFiles) {
        const content = await fs.readFile(
          path.join(downloadDir, file),
          "utf8"
        );
        if (
          content.includes("Feature: Batch Test 1") ||
          content.includes("Feature: Batch Test 2")
        ) {
          foundBatchTests++;
        }
      }
      expect(foundBatchTests).toBeGreaterThanOrEqual(2);
    }, 60000);
  });

  describe("Transaction Rollback", () => {
    it("should create transaction and backup files", async () => {
      const transaction = new SyncTransaction(config, eventBus, fs);

      await transaction.begin();
      expect(transaction.isActive()).toBe(true);

      // Create a test file to backup
      const testFile = path.join(testDir, "test-backup.feature");
      await fs.writeFile(testFile, "Original content");

      await transaction.backupFile(testFile);
      expect(transaction.getBackupCount()).toBe(1);

      await transaction.commit();
      expect(transaction.isCommitted()).toBe(true);
    }, 30000);

    it("should rollback changes on failure", async () => {
      const transaction = new SyncTransaction(config, eventBus, fs);
      const testFile = path.join(testDir, "rollback-test.feature");

      // Create original file
      const originalContent = "Original content for rollback test";
      await fs.writeFile(testFile, originalContent);

      // Start transaction and backup
      await transaction.begin();
      await transaction.backupFile(testFile);

      // Modify file
      await fs.writeFile(testFile, "Modified content");

      // Rollback
      await transaction.rollback();

      // Verify original content restored
      const restoredContent = await fs.readFile(testFile, "utf8");
      expect(restoredContent).toBe(originalContent);
    }, 30000);
  });

  describe("Error Handling", () => {
    it("should handle download errors gracefully", async () => {
      // Create downloader with invalid credentials
      const badConfig = {
        ...config,
        accessKey: "invalid-key",
      };
      const badClient = new AssertThatApiClient(badConfig);
      const badDownloader = new FeatureDownloader(
        badClient,
        badConfig,
        eventBus,
        fs
      );

      const downloadDir = path.join(testDir, "error-test");
      await fs.mkdir(downloadDir, { recursive: true });

      // FeatureDownloader returns error object instead of throwing
      const result = await badDownloader.downloadFeatures(downloadDir);
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    }, 30000);

    it("should handle upload errors gracefully", async () => {
      const badConfig = {
        ...config,
        secretKey: "invalid-secret",
      };
      const badClient = new AssertThatApiClient(badConfig);
      const badUploader = new FeatureUploader(badClient, badConfig, eventBus);

      const testFeature = {
        name: "error-test.feature",
        content: "Feature: Error Test\n  Scenario: Test\n    Given test",
      };

      const result = await badUploader.uploadFeature(testFeature);
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    }, 30000);
  });
});

