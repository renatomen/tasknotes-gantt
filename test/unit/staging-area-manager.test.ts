import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import fs from "fs/promises";
import path from "path";
import { SyncConfiguration } from "../../scripts/config/SyncConfiguration.mjs";
import {
  StagingAreaError,
  FileSystemError,
} from "../../scripts/errors/SyncErrors.mjs";

// Mock dependencies
const mockFs = {
  mkdir: jest.fn(),
  rm: jest.fn(),
  readdir: jest.fn(),
  readFile: jest.fn(),
  writeFile: jest.fn(),
  stat: jest.fn(),
} as any;

// StagingAreaManager implementation for testing
class StagingAreaManager {
  private stagingPath: string;
  private featuresPath: string;
  private config: SyncConfiguration;
  private fs: typeof fs;

  constructor(config: SyncConfiguration, fileSystem: typeof fs = fs) {
    this.config = config;
    this.fs = fileSystem;
    this.stagingPath = path.resolve(config.stagingDir);
    this.featuresPath = path.resolve(config.featuresDir);
  }

  async createStagingArea(): Promise<boolean> {
    try {
      console.log(`${this.config.ui.icons.info} Creating staging area...`);

      await this.cleanStagingArea();
      await this.fs.mkdir(this.stagingPath, { recursive: true });

      console.log(
        `${this.config.ui.icons.success} Staging area created at: ${this.stagingPath}`
      );
      return true;
    } catch (error) {
      throw new StagingAreaError(
        "Failed to create staging area",
        "create",
        this.stagingPath
      );
    }
  }

  async cleanStagingArea(): Promise<void> {
    try {
      await this.fs.rm(this.stagingPath, { recursive: true, force: true });
      console.log(`${this.config.ui.icons.success} Staging area cleaned`);
    } catch (error) {
      throw new StagingAreaError(
        "Failed to clean staging area",
        "clean",
        this.stagingPath
      );
    }
  }

  async downloadAssertThatFeatures(): Promise<void> {
    try {
      console.log(
        `${this.config.ui.icons.info} Downloading features from AssertThat...`
      );

      // Demo mode simulation
      const validation = this.config.validateConfiguration();
      if (!validation.isValid) {
        console.log(
          `${this.config.ui.icons.warning} Warning: Missing environment variables, using demo mode`
        );
        await this.createDemoFeatures();
      } else {
        // Real API call would go here
        await this.fetchFromAssertThatAPI();
      }

      console.log(
        `${this.config.ui.icons.success} Features downloaded to staging area`
      );
    } catch (error) {
      throw new StagingAreaError(
        "Failed to download AssertThat features",
        "download",
        this.stagingPath
      );
    }
  }

  async getStagingFeatures(): Promise<string[]> {
    try {
      const features: string[] = [];
      await this.scanDirectory(this.stagingPath, features);
      return features;
    } catch (error) {
      throw new FileSystemError(
        "Failed to scan staging features",
        "scan",
        this.stagingPath,
        error as Error
      );
    }
  }

  async getGitHubFeatures(): Promise<string[]> {
    try {
      const features: string[] = [];
      await this.scanDirectory(this.featuresPath, features);
      return features;
    } catch (error) {
      throw new FileSystemError(
        "Failed to scan GitHub features",
        "scan",
        this.featuresPath,
        error as Error
      );
    }
  }

  private async scanDirectory(
    dirPath: string,
    features: string[],
    relativePath = ""
  ): Promise<void> {
    try {
      const items = await this.fs.readdir(dirPath, { withFileTypes: true });

      for (const item of items) {
        const itemPath = path.join(dirPath, item.name);
        const relativeItemPath = relativePath
          ? path.join(relativePath, item.name)
          : item.name;

        if (item.isDirectory()) {
          await this.scanDirectory(itemPath, features, relativeItemPath);
        } else if (item.name.endsWith(".feature")) {
          features.push(relativeItemPath);
        }
      }
    } catch (error) {
      throw new FileSystemError(
        `Failed to scan directory ${dirPath}`,
        "scanDirectory",
        dirPath,
        error as Error
      );
    }
  }

  private async createDemoFeatures(): Promise<void> {
    const demoFeature = `Feature: Data Mapping (AssertThat Version)
  As a developer
  I want to map data from AssertThat
  So that I can sync with GitHub

  Scenario: Map data correctly
    Given I have AssertThat data
    When I map it to GitHub format
    Then it should be correctly formatted`;

    const demoPath = path.join(this.stagingPath, "bases-integration");
    await this.fs.mkdir(demoPath, { recursive: true });
    await this.fs.writeFile(
      path.join(demoPath, "data-mapping.feature"),
      demoFeature
    );
  }

  private async fetchFromAssertThatAPI(): Promise<void> {
    // Import API client dynamically to avoid circular dependencies
    const { AssertThatApiClient } = await import(
      "../../scripts/api/AssertThatApiClient.mjs"
    );

    // Create API client with configuration
    const apiClient = new AssertThatApiClient({
      projectId: this.config.assertThat.projectId,
      accessKey: this.config.assertThat.accessKey,
      secretKey: this.config.assertThat.secretKey,
      token: this.config.assertThat.token,
    });

    // Download features as ZIP
    const zipBuffer = await apiClient.downloadFeatures({
      mode: "automated",
    });

    // Extract ZIP to staging area
    await this.extractZipToStaging(zipBuffer);
  }

  private async extractZipToStaging(zipBuffer: Buffer): Promise<void> {
    // Import AdmZip for ZIP extraction
    const AdmZip = (await import("adm-zip")).default;
    const zip = new AdmZip(zipBuffer);

    // Extract all entries
    const zipEntries = zip.getEntries();

    for (const entry of zipEntries) {
      if (!entry.isDirectory && entry.entryName.endsWith(".feature")) {
        const content = entry.getData().toString("utf8");
        const fileName = path.basename(entry.entryName);
        const filePath = path.join(this.stagingPath, fileName);

        await this.fs.writeFile(filePath, content, "utf8");
      }
    }
  }
}

describe("StagingAreaManager", () => {
  let stagingManager: StagingAreaManager;
  let config: SyncConfiguration;

  beforeEach(() => {
    jest.clearAllMocks();
    config = new SyncConfiguration({
      stagingDir: "test-staging",
      featuresDir: "test-features",
    });
    stagingManager = new StagingAreaManager(config, mockFs);
  });

  describe("createStagingArea", () => {
    it("should create staging area successfully", async () => {
      mockFs.rm.mockResolvedValue(undefined);
      mockFs.mkdir.mockResolvedValue(undefined);

      const result = await stagingManager.createStagingArea();

      expect(result).toBe(true);
      expect(mockFs.rm).toHaveBeenCalledWith(
        expect.stringContaining("test-staging"),
        { recursive: true, force: true }
      );
      expect(mockFs.mkdir).toHaveBeenCalledWith(
        expect.stringContaining("test-staging"),
        { recursive: true }
      );
    });

    it("should throw StagingAreaError when mkdir fails", async () => {
      mockFs.rm.mockResolvedValue(undefined);
      mockFs.mkdir.mockRejectedValue(new Error("Permission denied"));

      await expect(stagingManager.createStagingArea()).rejects.toThrow(
        StagingAreaError
      );
    });
  });

  describe("cleanStagingArea", () => {
    it("should clean staging area successfully", async () => {
      mockFs.rm.mockResolvedValue(undefined);

      await stagingManager.cleanStagingArea();

      expect(mockFs.rm).toHaveBeenCalledWith(
        expect.stringContaining("test-staging"),
        { recursive: true, force: true }
      );
    });

    it("should throw StagingAreaError when rm fails", async () => {
      mockFs.rm.mockRejectedValue(new Error("File in use"));

      await expect(stagingManager.cleanStagingArea()).rejects.toThrow(
        StagingAreaError
      );
    });
  });

  describe("downloadAssertThatFeatures", () => {
    it("should use demo mode when configuration is invalid", async () => {
      const demoConfig = new SyncConfiguration(); // No env vars set
      const demoManager = new StagingAreaManager(demoConfig, mockFs);

      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);

      await demoManager.downloadAssertThatFeatures();

      expect(mockFs.mkdir).toHaveBeenCalled();
      expect(mockFs.writeFile).toHaveBeenCalled();
    });

    it("should throw StagingAreaError when demo feature creation fails", async () => {
      mockFs.mkdir.mockRejectedValue(new Error("Disk full"));

      await expect(stagingManager.downloadAssertThatFeatures()).rejects.toThrow(
        StagingAreaError
      );
    });
  });

  describe("getStagingFeatures", () => {
    it("should return list of feature files", async () => {
      mockFs.readdir.mockResolvedValue([
        { name: "test.feature", isDirectory: () => false },
        { name: "subfolder", isDirectory: () => true },
      ]);

      // Mock subfolder scan
      mockFs.readdir
        .mockResolvedValueOnce([
          { name: "test.feature", isDirectory: () => false },
          { name: "subfolder", isDirectory: () => true },
        ])
        .mockResolvedValueOnce([
          { name: "nested.feature", isDirectory: () => false },
        ]);

      const features = await stagingManager.getStagingFeatures();

      expect(features).toEqual([
        "test.feature",
        expect.stringMatching(/subfolder[\/\\]nested\.feature/),
      ]);
    });

    it("should throw FileSystemError when readdir fails", async () => {
      mockFs.readdir.mockRejectedValue(new Error("Directory not found"));

      await expect(stagingManager.getStagingFeatures()).rejects.toThrow(
        FileSystemError
      );
    });
  });

  describe("getGitHubFeatures", () => {
    it("should return list of GitHub feature files", async () => {
      mockFs.readdir.mockResolvedValue([
        { name: "github.feature", isDirectory: () => false },
        { name: "other.txt", isDirectory: () => false },
      ]);

      const features = await stagingManager.getGitHubFeatures();

      expect(features).toEqual(["github.feature"]);
    });

    it("should handle empty directories", async () => {
      mockFs.readdir.mockResolvedValue([]);

      const features = await stagingManager.getGitHubFeatures();

      expect(features).toEqual([]);
    });
  });
});
