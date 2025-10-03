/**
 * OG-47: GitHub API Client
 * 
 * Handles GitHub API operations for PR automation
 * - Create pull requests
 * - Add labels
 * - Update PR properties
 * 
 * Uses dependency injection for testability
 */

import https from 'https';

/**
 * GitHubApiClient - Handles GitHub API operations
 */
export class GitHubApiClient {
  /**
   * Constructor with dependency injection
   * 
   * @param {Object} options - Configuration options
   * @param {string} options.token - GitHub token (GITHUB_TOKEN)
   * @param {string} options.owner - Repository owner
   * @param {string} options.repo - Repository name
   * @param {Object} options.logger - Logger instance (optional)
   */
  constructor(options = {}) {
    this.validateOptions(options);
    
    this.token = options.token;
    this.owner = options.owner;
    this.repo = options.repo;
    this.logger = options.logger || console;
    this.baseUrl = 'api.github.com';
  }

  /**
   * Validate constructor options
   */
  validateOptions(options) {
    if (!options.token) {
      throw new Error('GitHub token required');
    }
    if (!options.owner) {
      throw new Error('Repository owner required');
    }
    if (!options.repo) {
      throw new Error('Repository name required');
    }
  }

  /**
   * Make a GitHub API request
   * 
   * @param {Object} options - Request options
   * @param {string} options.method - HTTP method
   * @param {string} options.path - API path
   * @param {Object} options.body - Request body (optional)
   * @returns {Promise<Object>} Response data
   */
  async makeRequest({ method, path, body }) {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: this.baseUrl,
        port: 443,
        path,
        method,
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Accept': 'application/vnd.github+json',
          'User-Agent': 'obsidian-gantt-sync',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      };

      if (body) {
        const bodyString = JSON.stringify(body);
        options.headers['Content-Type'] = 'application/json';
        options.headers['Content-Length'] = Buffer.byteLength(bodyString);
      }

      const req = https.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              const parsed = data ? JSON.parse(data) : {};
              resolve(parsed);
            } catch (error) {
              reject(new Error(`Failed to parse response: ${error.message}`));
            }
          } else {
            let errorMessage = `GitHub API error: ${res.statusCode}`;
            try {
              const errorData = JSON.parse(data);
              errorMessage += ` - ${errorData.message || data}`;
            } catch {
              errorMessage += ` - ${data}`;
            }
            reject(new Error(errorMessage));
          }
        });
      });

      req.on('error', (error) => {
        reject(new Error(`Request failed: ${error.message}`));
      });

      if (body) {
        req.write(JSON.stringify(body));
      }

      req.end();
    });
  }

  /**
   * Create a pull request
   * 
   * @param {Object} options - PR options
   * @param {string} options.title - PR title
   * @param {string} options.body - PR description
   * @param {string} options.head - Head branch
   * @param {string} options.base - Base branch (default: main)
   * @param {boolean} options.draft - Create as draft (default: false)
   * @returns {Promise<Object>} Created PR data
   */
  async createPullRequest({ title, body, head, base = 'main', draft = false }) {
    this.logger.info(`Creating PR: ${title}`);
    this.logger.info(`  Owner: ${this.owner}`);
    this.logger.info(`  Repo: ${this.repo}`);
    this.logger.info(`  Head: ${head}`);
    this.logger.info(`  Base: ${base}`);

    const path = `/repos/${this.owner}/${this.repo}/pulls`;
    this.logger.info(`  API Path: ${path}`);
    
    const prData = {
      title,
      body,
      head,
      base,
      draft,
    };

    try {
      const response = await this.makeRequest({
        method: 'POST',
        path,
        body: prData,
      });

      this.logger.info(`✅ PR created: #${response.number}`);
      this.logger.info(`   URL: ${response.html_url}`);

      return {
        number: response.number,
        url: response.html_url,
        nodeId: response.node_id,
      };
    } catch (error) {
      this.logger.error(`❌ Failed to create PR: ${error.message}`);
      throw error;
    }
  }

  /**
   * Add labels to a pull request
   * 
   * @param {number} prNumber - PR number
   * @param {string[]} labels - Labels to add
   * @returns {Promise<void>}
   */
  async addLabels(prNumber, labels) {
    if (!labels || labels.length === 0) {
      return;
    }

    this.logger.info(`Adding labels to PR #${prNumber}: ${labels.join(', ')}`);

    const path = `/repos/${this.owner}/${this.repo}/issues/${prNumber}/labels`;

    try {
      await this.makeRequest({
        method: 'POST',
        path,
        body: { labels },
      });

      this.logger.info(`✅ Labels added`);
    } catch (error) {
      this.logger.error(`❌ Failed to add labels: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get repository information
   * 
   * @returns {Promise<Object>} Repository data
   */
  async getRepository() {
    const path = `/repos/${this.owner}/${this.repo}`;
    
    try {
      const response = await this.makeRequest({
        method: 'GET',
        path,
      });

      return {
        name: response.name,
        fullName: response.full_name,
        defaultBranch: response.default_branch,
      };
    } catch (error) {
      this.logger.error(`❌ Failed to get repository: ${error.message}`);
      throw error;
    }
  }

  /**
   * Check if a pull request exists for a branch
   *
   * @param {string} head - Head branch
   * @param {string} base - Base branch (default: main)
   * @returns {Promise<Object|null>} PR data or null if not found
   */
  async findPullRequest(head, base = 'main') {
    const path = `/repos/${this.owner}/${this.repo}/pulls?head=${this.owner}:${head}&base=${base}&state=open`;

    try {
      const response = await this.makeRequest({
        method: 'GET',
        path,
      });

      if (response.length > 0) {
        return {
          number: response[0].number,
          url: response[0].html_url,
        };
      }

      return null;
    } catch (error) {
      this.logger.error(`❌ Failed to find PR: ${error.message}`);
      throw error;
    }
  }

  /**
   * Enable auto-merge for a pull request
   *
   * @param {number} prNumber - PR number
   * @param {string} mergeMethod - Merge method (merge, squash, rebase)
   * @returns {Promise<void>}
   */
  async enableAutoMerge(prNumber, mergeMethod = 'squash') {
    this.logger.info(`🤖 Enabling auto-merge for PR #${prNumber} (${mergeMethod})`);

    const path = `/repos/${this.owner}/${this.repo}/pulls/${prNumber}/merge`;

    try {
      // Note: GitHub's auto-merge API requires GraphQL
      // For now, we'll just log that auto-merge would be enabled
      // The user can enable it manually or we can implement GraphQL later
      this.logger.info(`ℹ️  Auto-merge requires GraphQL API (not implemented yet)`);
      this.logger.info(`   You can enable it manually at: https://github.com/${this.owner}/${this.repo}/pull/${prNumber}`);

      // TODO: Implement GraphQL mutation for enablePullRequestAutoMerge
      // For now, just return success without actually enabling auto-merge

    } catch (error) {
      this.logger.error(`❌ Failed to enable auto-merge: ${error.message}`);
      throw error;
    }
  }
}

