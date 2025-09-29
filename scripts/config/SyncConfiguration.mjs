/**
 * Centralized configuration management for sync operations
 * Replaces global CONFIG object with injectable configuration
 */

export class SyncConfiguration {
  constructor(overrides = {}) {
    // Default configuration
    const defaults = {
      featuresDir: "features",
      stagingDir: "featureSyncStage",
      syncBranchPrefix: "sync/assertthat",
      commitPrefix: "chore/sync",
      assertThat: {
        projectId: process.env.ASSERTTHAT_PROJECT_ID,
        accessKey: process.env.ASSERTTHAT_ACCESS_KEY,
        secretKey: process.env.ASSERTTHAT_SECRET_KEY,
        token: process.env.ASSERTTHAT_TOKEN,
      },
      jira: {
        serverUrl: process.env.JIRA_SERVER_URL,
      },
      git: {
        ignoreSpaceChange: "--ignore-space-change",
        ignoreAllSpace: "--ignore-all-space",
        ignoreBlankLines: "--ignore-blank-lines",
      },
      ui: {
        icons: {
          debug: "🔧",
          success: "✅",
          error: "❌",
          warning: "⚠️",
          info: "ℹ️",
        },
      },
    };

    // Merge defaults with overrides
    this.featuresDir = overrides.featuresDir ?? defaults.featuresDir;
    this.stagingDir = overrides.stagingDir ?? defaults.stagingDir;
    this.syncBranchPrefix =
      overrides.syncBranchPrefix ?? defaults.syncBranchPrefix;
    this.commitPrefix = overrides.commitPrefix ?? defaults.commitPrefix;

    this.assertThat = {
      projectId:
        overrides.assertThat?.projectId ?? defaults.assertThat.projectId,
      accessKey:
        overrides.assertThat?.accessKey ?? defaults.assertThat.accessKey,
      secretKey:
        overrides.assertThat?.secretKey ?? defaults.assertThat.secretKey,
      token: overrides.assertThat?.token ?? defaults.assertThat.token,
    };

    this.jira = {
      serverUrl: overrides.jira?.serverUrl ?? defaults.jira.serverUrl,
    };

    this.git = {
      ignoreSpaceChange:
        overrides.git?.ignoreSpaceChange ?? defaults.git.ignoreSpaceChange,
      ignoreAllSpace:
        overrides.git?.ignoreAllSpace ?? defaults.git.ignoreAllSpace,
      ignoreBlankLines:
        overrides.git?.ignoreBlankLines ?? defaults.git.ignoreBlankLines,
    };

    this.ui = {
      icons: {
        debug: overrides.ui?.icons?.debug ?? defaults.ui.icons.debug,
        success: overrides.ui?.icons?.success ?? defaults.ui.icons.success,
        error: overrides.ui?.icons?.error ?? defaults.ui.icons.error,
        warning: overrides.ui?.icons?.warning ?? defaults.ui.icons.warning,
        info: overrides.ui?.icons?.info ?? defaults.ui.icons.info,
      },
    };
  }

  /**
   * Validates that required configuration is present
   */
  validateConfiguration() {
    const missingFields = [];

    // Check for required AssertThat configuration
    if (!this.assertThat.projectId) {
      missingFields.push("ASSERTTHAT_PROJECT_ID");
    }

    // Check for authentication (either access/secret keys OR token)
    const hasAccessKeys =
      this.assertThat.accessKey && this.assertThat.secretKey;
    const hasToken = this.assertThat.token;

    if (!hasAccessKeys && !hasToken) {
      missingFields.push(
        "ASSERTTHAT_ACCESS_KEY & ASSERTTHAT_SECRET_KEY (or ASSERTTHAT_TOKEN)"
      );
    }

    return {
      isValid: missingFields.length === 0,
      missingFields,
    };
  }

  /**
   * Creates a configuration for demo/testing mode
   */
  static createDemoConfiguration() {
    return new SyncConfiguration({
      assertThat: {
        projectId: "demo-project",
        token: "demo-token",
      },
      jira: {
        serverUrl: "https://demo.atlassian.net",
      },
    });
  }

  /**
   * Creates configuration from environment variables
   */
  static fromEnvironment() {
    return new SyncConfiguration();
  }
}
