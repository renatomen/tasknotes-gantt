/**
 * OG-45: AssertThat API Client Tests
 * Test-driven development for AssertThat BDD Jira Cloud V2 REST API client
 */

import { describe, it, expect, beforeEach, beforeAll, jest } from "@jest/globals";
import type { Mock } from "jest-mock";
import { AssertThatApiClient } from "../../scripts/api/AssertThatApiClient.mjs";
import { AssertThatApiError } from "../../scripts/errors/SyncErrors.mjs";

// Mock https module
const mockRequest = jest.fn();
jest.mock("https", () => ({
  default: {
    request: mockRequest,
  },
  request: mockRequest,
}));

describe("AssertThatApiClient", () => {
  let client: any;
  let mockResponse: any;
  let mockRequestObj: any;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Setup mock response
    mockResponse = {
      statusCode: 200,
      on: jest.fn(),
    };

    mockRequestObj = {
      on: jest.fn(),
      write: jest.fn(),
      end: jest.fn(),
    };

    (mockRequest as Mock).mockReturnValue(mockRequestObj);
  });

  describe("Authentication", () => {
    it("should authenticate with access key and secret key", () => {
      client = new AssertThatApiClient({
        projectId: "10001",
        accessKey: "test-access-key",
        secretKey: "test-secret-key",
      });

      expect(client).toBeDefined();
      expect(client.getAuthHeader()).toContain("Basic");
    });

    it("should authenticate with token", () => {
      client = new AssertThatApiClient({
        projectId: "10001",
        token: "test-token",
      });

      expect(client).toBeDefined();
      expect(client.getAuthHeader()).toContain("Bearer");
    });

    it("should throw error when no authentication provided", () => {
      expect(() => {
        new AssertThatApiClient({
          projectId: "10001",
        });
      }).toThrow("Authentication required");
    });

    it("should throw error when project ID is missing", () => {
      expect(() => {
        new AssertThatApiClient({
          accessKey: "test-key",
          secretKey: "test-secret",
        });
      }).toThrow("Project ID required");
    });
  });

  describe("Download Features", () => {
    beforeEach(() => {
      client = new AssertThatApiClient({
        projectId: "10001",
        accessKey: "test-access-key",
        secretKey: "test-secret-key",
      });
    });

    it("should download features successfully", async () => {
      const mockData = Buffer.from("feature file content");

      mockResponse.on.mockImplementation((event: string, callback: Function) => {
        if (event === "data") {
          callback(mockData);
        } else if (event === "end") {
          callback();
        }
        return mockResponse;
      });

      (mockRequest as Mock).mockImplementation((options, callback) => {
        callback(mockResponse);
        return mockRequestObj;
      });

      const result = await client.downloadFeatures();

      expect(result).toBeDefined();
      expect(mockRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "GET",
          path: expect.stringContaining("/rest/api/1/project/10001/features"),
        }),
        expect.any(Function)
      );
    });

    it("should download features with filters", async () => {
      const mockData = Buffer.from("filtered features");

      mockResponse.on.mockImplementation((event: string, callback: Function) => {
        if (event === "data") callback(mockData);
        else if (event === "end") callback();
        return mockResponse;
      });

      (mockRequest as Mock).mockImplementation((options, callback) => {
        callback(mockResponse);
        return mockRequestObj;
      });

      await client.downloadFeatures({
        mode: "automated",
        tags: "@smoke",
        jql: "project = TEST",
      });

      expect(mockRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          path: expect.stringContaining("mode=automated"),
        }),
        expect.any(Function)
      );
    });

    it("should handle download errors", async () => {
      mockResponse.statusCode = 404;
      mockResponse.on.mockImplementation((event: string, callback: Function) => {
        if (event === "data") callback(Buffer.from("Not found"));
        else if (event === "end") callback();
        return mockResponse;
      });

      (mockRequest as Mock).mockImplementation((options, callback) => {
        callback(mockResponse);
        return mockRequestObj;
      });

      await expect(client.downloadFeatures()).rejects.toThrow(AssertThatApiError);
    });
  });

  describe("Upload Features", () => {
    beforeEach(() => {
      client = new AssertThatApiClient({
        projectId: "10001",
        accessKey: "test-access-key",
        secretKey: "test-secret-key",
      });
    });

    it("should upload single feature successfully", async () => {
      mockResponse.statusCode = 200;
      mockResponse.on.mockImplementation((event: string, callback: Function) => {
        if (event === "data") {
          callback(Buffer.from("Upload successful"));
        } else if (event === "end") {
          callback();
        }
        return mockResponse;
      });

      (mockRequest as Mock).mockImplementation((options, callback) => {
        callback(mockResponse);
        return mockRequestObj;
      });

      const feature = {
        name: "test.feature",
        content: "Feature: Test\n  Scenario: Test scenario",
      };

      const result = await client.uploadFeatures([feature]);

      expect(result.success).toBe(true);
      expect(result.uploaded).toBe(1);
      expect(mockRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "POST",
          path: expect.stringContaining("/rest/api/1/project/10001/feature"),
        }),
        expect.any(Function)
      );
    });

    it("should upload multiple features in batch", async () => {
      mockResponse.statusCode = 200;
      mockResponse.on.mockImplementation((event: string, callback: Function) => {
        if (event === "data") {
          callback(Buffer.from("Upload successful"));
        } else if (event === "end") {
          callback();
        }
        return mockResponse;
      });

      (mockRequest as Mock).mockImplementation((options, callback) => {
        callback(mockResponse);
        return mockRequestObj;
      });

      const features = [
        { name: "test1.feature", content: "Feature: Test 1" },
        { name: "test2.feature", content: "Feature: Test 2" },
        { name: "test3.feature", content: "Feature: Test 3" },
      ];

      const result = await client.uploadFeatures(features);

      expect(result.uploaded).toBe(3);
      expect(result.success).toBe(true);
      expect(result.failed).toBe(0);
    });

    it("should upload feature with form data", async () => {
      mockResponse.statusCode = 200;
      mockResponse.on.mockImplementation((event: string, callback: Function) => {
        if (event === "data") {
          callback(Buffer.from("Upload successful"));
        } else if (event === "end") {
          callback();
        }
        return mockResponse;
      });

      (mockRequest as Mock).mockImplementation((options, callback) => {
        callback(mockResponse);
        return mockRequestObj;
      });

      const feature = {
        name: "test.feature",
        content: "Feature: Test",
      };

      await client.uploadFeatures([feature]);

      // Verify multipart form data was sent
      expect(mockRequestObj.write).toHaveBeenCalled();
      const writtenData = (mockRequestObj.write as Mock).mock.calls[0][0];
      expect(writtenData).toContain("Content-Disposition");
      expect(writtenData).toContain("test.feature");
    });
  });

  describe("Retry Logic", () => {
    beforeEach(() => {
      client = new AssertThatApiClient({
        projectId: "10001",
        accessKey: "test-access-key",
        secretKey: "test-secret-key",
        maxRetries: 3,
        retryDelay: 100,
      });
    });

    it("should retry on network errors", async () => {
      let attemptCount = 0;

      (mockRequest as Mock).mockImplementation((options, callback) => {
        attemptCount++;
        if (attemptCount < 3) {
          mockRequestObj.on.mockImplementation((event: string, cb: Function) => {
            if (event === "error") {
              cb(new Error("Network error"));
            }
            return mockRequestObj;
          });
        } else {
          callback(mockResponse);
          mockResponse.on.mockImplementation((event: string, cb: Function) => {
            if (event === "data") cb(Buffer.from("success"));
            else if (event === "end") cb();
            return mockResponse;
          });
        }
        return mockRequestObj;
      });

      await client.downloadFeatures();

      expect(attemptCount).toBe(3);
    });

    it("should fail after max retries", async () => {
      (mockRequest as Mock).mockImplementation(() => {
        mockRequestObj.on.mockImplementation((event: string, cb: Function) => {
          if (event === "error") {
            cb(new Error("Persistent network error"));
          }
          return mockRequestObj;
        });
        return mockRequestObj;
      });

      await expect(client.downloadFeatures()).rejects.toThrow(
        "Persistent network error"
      );
    });
  });
});

