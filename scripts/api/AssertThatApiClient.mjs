/**
 * OG-45: AssertThat BDD Jira Cloud V2 REST API Client
 * 
 * Provides bidirectional sync operations with AssertThat BDD plugin:
 * - Download features from AssertThat
 * - Upload features to AssertThat
 * - Authentication (access/secret keys or token)
 * - Retry logic with exponential backoff
 * - Comprehensive error handling
 */

import https from "https";
import { AssertThatApiError } from "../errors/SyncErrors.mjs";

/**
 * AssertThat API Client Configuration
 */
export class AssertThatApiClient {
  constructor(config) {
    this.validateConfig(config);

    this.projectId = config.projectId;
    this.accessKey = config.accessKey;
    this.secretKey = config.secretKey;
    this.token = config.token;
    this.jiraServerUrl = config.jiraServerUrl;
    this.maxRetries = config.maxRetries || 3;
    this.retryDelay = config.retryDelay || 1000;
    this.timeout = config.timeout || 30000;

    // Determine API base URL
    // For AssertThat Cloud: use bdd.assertthat.app
    // For Jira Server/DC: jiraServerUrl should be the base URL (e.g., https://jira.company.com)
    // The API paths already include /rest/api/1/... so we don't add it here
    this.baseUrl = this.jiraServerUrl || "https://bdd.assertthat.app";
  }

  /**
   * Validate configuration
   */
  validateConfig(config) {
    if (!config.projectId) {
      throw new Error("Project ID required");
    }

    const hasAccessKeys = config.accessKey && config.secretKey;
    const hasToken = config.token;

    if (!hasAccessKeys && !hasToken) {
      throw new Error(
        "Authentication required: provide either accessKey/secretKey or token"
      );
    }
  }

  /**
   * Get authentication header
   */
  getAuthHeader() {
    if (this.token) {
      return `Bearer ${this.token}`;
    }

    const credentials = Buffer.from(
      `${this.accessKey}:${this.secretKey}`
    ).toString("base64");
    return `Basic ${credentials}`;
  }

  /**
   * Download features from AssertThat
   *
   * @param {Object} options - Download options
   * @param {string} options.mode - Filter mode: automated/manual/both (default: automated)
   * @param {string} options.tags - Tag expression filter (e.g., "@app1 and not(@smoke)")
   * @param {string} options.jql - JQL query filter (e.g., "project=XXX")
   * @returns {Promise<Buffer>} ZIP file containing features
   */
  async downloadFeatures(options = {}) {
    const queryParams = new URLSearchParams();

    if (options.mode) queryParams.append("mode", options.mode);
    if (options.tags) queryParams.append("tags", options.tags);
    if (options.jql) queryParams.append("jql", options.jql);

    const queryString = queryParams.toString();
    // API v1 endpoint: GET /rest/api/1/project/{projectId}/features
    const path = `/rest/api/1/project/${this.projectId}/features${
      queryString ? `?${queryString}` : ""
    }`;

    return this.makeRequest({
      method: "GET",
      path,
      expectBinary: true,
    });
  }

  /**
   * Upload a single feature file to AssertThat
   *
   * @param {Object} feature - Feature object {name, content}
   * @param {Object} options - Upload options
   * @param {boolean} options.override - Whether to override existing feature (default: true)
   * @returns {Promise<Object>} Upload result
   */
  async uploadFeature(feature, options = {}) {
    const override = options.override !== undefined ? options.override : true;

    // API v1 endpoint: POST /rest/api/1/project/{projectId}/feature?override=true
    const path = `/rest/api/1/project/${this.projectId}/feature?override=${override}`;

    // Create form data with file
    const boundary = `----WebKitFormBoundary${Date.now()}`;
    const formData = this.createFormData(feature, boundary);

    return this.makeRequest({
      method: "POST",
      path,
      body: formData,
      headers: {
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
    });
  }

  /**
   * Upload multiple features to AssertThat (batch operation)
   *
   * @param {Array} features - Array of feature objects {name, content}
   * @param {Object} options - Upload options
   * @returns {Promise<Object>} Upload result {success, uploaded, failed, errors}
   */
  async uploadFeatures(features, options = {}) {
    const results = {
      success: true,
      uploaded: 0,
      failed: 0,
      errors: [],
    };

    // Upload features sequentially to avoid rate limiting
    for (const feature of features) {
      try {
        await this.uploadFeature(feature, options);
        results.uploaded++;
      } catch (error) {
        results.failed++;
        results.success = false;
        results.errors.push({
          feature: feature.name,
          error: error.message,
        });
      }
    }

    return results;
  }

  /**
   * Create multipart form data for file upload
   *
   * @param {Object} feature - Feature object {name, content}
   * @param {string} boundary - Multipart boundary string
   * @returns {string} Form data string
   */
  createFormData(feature, boundary) {
    const parts = [];

    parts.push(`--${boundary}`);
    parts.push(`Content-Disposition: form-data; name="file"; filename="${feature.name}"`);
    parts.push('Content-Type: text/plain');
    parts.push('');
    parts.push(feature.content);
    parts.push(`--${boundary}--`);

    return parts.join('\r\n');
  }

  /**
   * Make HTTP request with retry logic
   * 
   * @param {Object} options - Request options
   * @returns {Promise<any>} Response data
   */
  async makeRequest(options, retryCount = 0) {
    return new Promise((resolve, reject) => {
      const url = new URL(this.baseUrl + options.path);

      // Debug logging
      console.log(`🌐 API Request: ${options.method} ${url.href}`);

      const requestOptions = {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method: options.method,
        headers: {
          Authorization: this.getAuthHeader(),
          Accept: options.expectBinary
            ? "application/zip"
            : "application/json",
          ...options.headers,
        },
        timeout: this.timeout,
      };

      const req = https.request(requestOptions, (res) => {
        const chunks = [];

        res.on("data", (chunk) => {
          chunks.push(chunk);
        });

        res.on("end", () => {
          const data = Buffer.concat(chunks);

          if (res.statusCode >= 200 && res.statusCode < 300) {
            if (options.expectBinary) {
              resolve(data);
            } else {
              try {
                const json = JSON.parse(data.toString());
                resolve(json);
              } catch (error) {
                reject(
                  new AssertThatApiError(
                    "Invalid JSON response",
                    options.path,
                    res.statusCode,
                    data.toString()
                  )
                );
              }
            }
          } else {
            // Handle HTTP errors
            const errorMessage = data.toString();
            const error = new AssertThatApiError(
              `HTTP ${res.statusCode}: ${errorMessage}`,
              options.path,
              res.statusCode,
              errorMessage
            );

            // Retry on 5xx errors or rate limiting
            if (
              (res.statusCode >= 500 || res.statusCode === 429) &&
              retryCount < this.maxRetries
            ) {
              this.retryRequest(options, retryCount, resolve, reject);
            } else {
              reject(error);
            }
          }
        });
      });

      req.on("error", (error) => {
        // Retry on network errors
        if (retryCount < this.maxRetries) {
          this.retryRequest(options, retryCount, resolve, reject);
        } else {
          reject(error);
        }
      });

      req.on("timeout", () => {
        req.destroy();
        const error = new AssertThatApiError(
          "Request timeout",
          options.path,
          0,
          "Request exceeded timeout"
        );

        if (retryCount < this.maxRetries) {
          this.retryRequest(options, retryCount, resolve, reject);
        } else {
          reject(error);
        }
      });

      if (options.body) {
        req.write(options.body);
      }

      req.end();
    });
  }

  /**
   * Retry request with exponential backoff
   */
  async retryRequest(options, retryCount, resolve, reject) {
    const delay = this.retryDelay * Math.pow(2, retryCount);

    setTimeout(async () => {
      try {
        const result = await this.makeRequest(options, retryCount + 1);
        resolve(result);
      } catch (error) {
        reject(error);
      }
    }, delay);
  }

  /**
   * Get scenarios from AssertThat using V2 API
   *
   * @param {Object} options - Query options
   * @param {number} options.page - Page number (default: 0)
   * @param {number} options.size - Page size (default: 100)
   * @returns {Promise<Object>} Scenarios data with IDs
   */
  async getScenarios(options = {}) {
    const page = options.page !== undefined ? options.page : 0;
    const size = options.size || 100;

    // API v2 endpoint: GET /rest/api/2/project/{projectId}/report/scenarios
    const path = `/rest/api/2/project/${this.projectId}/report/scenarios?page=${page}&size=${size}`;

    return this.makeRequest({
      method: 'GET',
      path,
      expectBinary: false,
    });
  }

  /**
   * Get all scenarios with pagination
   *
   * Automatically handles pagination to fetch all scenarios from AssertThat.
   *
   * @returns {Promise<Array>} All scenarios with IDs
   */
  async getAllScenarios() {
    const allScenarios = [];
    let page = 0;
    let hasMore = true;

    while (hasMore) {
      const response = await this.getScenarios({ page, size: 100 });

      // Handle different possible response formats
      // The actual format will be determined by testing
      const scenarios = response.content || response.scenarios || response.data || [];

      if (scenarios.length > 0) {
        allScenarios.push(...scenarios);
      }

      // Check if there are more pages
      // Common pagination indicators: last, hasMore, totalPages
      hasMore = !response.last && scenarios.length > 0;

      if (response.totalPages && page >= response.totalPages - 1) {
        hasMore = false;
      }

      page++;

      // Safety limit to prevent infinite loops
      if (page > 100) {
        console.warn('⚠️  Reached pagination safety limit (100 pages)');
        break;
      }
    }

    return allScenarios;
  }

  /**
   * Get deleted scenarios from AssertThat using V2 API
   *
   * @param {Object} options - Query options
   * @param {number} options.page - Page number (default: 0)
   * @param {number} options.size - Page size (default: 100)
   * @returns {Promise<Object>} Deleted scenarios data
   */
  async getDeletedScenarios(options = {}) {
    const page = options.page !== undefined ? options.page : 0;
    const size = options.size || 100;

    // API v2 endpoint: GET /rest/api/2/project/{projectId}/report/scenarios/deleted
    const path = `/rest/api/2/project/${this.projectId}/report/scenarios/deleted?page=${page}&size=${size}`;

    return this.makeRequest({
      method: 'GET',
      path,
      expectBinary: false,
    });
  }

  /**
   * Get client statistics
   */
  getStats() {
    return {
      projectId: this.projectId,
      baseUrl: this.baseUrl,
      maxRetries: this.maxRetries,
      timeout: this.timeout,
    };
  }
}

