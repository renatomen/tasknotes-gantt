/**
 * OG-47: PR Automation for Sync Operations
 * 
 * Handles automated PR creation, branch management, and GitHub integration
 * for bidirectional sync between GitHub and AssertThat
 */

import { execSync } from 'child_process';
import { SyncConfiguration } from '../config/SyncConfiguration.mjs';

export class PRAutomation {
  constructor(dependencies = {}) {
    this.config = dependencies.config || new SyncConfiguration();
    this.logger = dependencies.logger || console;
    this.dryRun = dependencies.dryRun || false;
  }

  /**
   * Generate a unique branch name with timestamp
   */
  generateBranchName() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');

    const timestamp = `${year}-${month}-${day}-${hours}${minutes}${seconds}`;

    return `${this.config.syncBranchPrefix}-${timestamp}`;
  }

  /**
   * Create a new sync branch from main
   */
  createSyncBranch(branchName) {
    try {
      this.logger.info(`📌 Creating sync branch: ${branchName}`);

      // Switch to main and pull latest
      this.execGit('git checkout main');
      this.execGit('git pull origin main');

      // Create new branch
      this.execGit(`git checkout -b ${branchName}`);

      this.logger.info(`✅ Branch created: ${branchName}`);
      return branchName;
    } catch (error) {
      this.logger.error(`❌ Failed to create branch: ${error.message}`);
      throw error;
    }
  }

  /**
   * Create a commit with sync changes
   */
  createCommit(message, options = {}) {
    try {
      this.logger.info(`💾 Creating commit: ${message}`);

      // Stage features and staging directories
      this.execGit(`git add ${this.config.featuresDir}/`);
      this.execGit(`git add ${this.config.stagingDir}/`);

      // Create commit with proper format
      const includeJiraRef = options.includeJiraRef !== false;
      const jiraRef = includeJiraRef ? 'OG-47 ' : '';
      const commitMessage = `${this.config.commitPrefix}: ${jiraRef}${message}`;
      this.execGit(`git commit -m "${commitMessage}"`);

      this.logger.info(`✅ Commit created`);
      return commitMessage;
    } catch (error) {
      this.logger.error(`❌ Failed to create commit: ${error.message}`);
      throw error;
    }
  }

  /**
   * Push branch to remote
   */
  pushBranch(branchName) {
    try {
      this.logger.info(`⬆️  Pushing branch: ${branchName}`);
      this.execGit(`git push -u origin ${branchName}`);
      this.logger.info(`✅ Branch pushed`);
    } catch (error) {
      this.logger.error(`❌ Failed to push branch: ${error.message}`);
      throw error;
    }
  }

  /**
   * Create a pull request using GitHub CLI
   */
  createPullRequest(prData) {
    try {
      this.logger.info(`🔀 Creating pull request: ${prData.title}`);

      // Build PR description
      const description = this.buildPRDescription(prData);

      // Determine labels
      const labels = this.determineLabels(prData);

      // Create PR using GitHub CLI
      const command = [
        'gh pr create',
        `--title "${prData.title}"`,
        `--body "${description}"`,
        `--label "${labels.join(',')}"`,
        '--base main',
      ].join(' ');

      const output = this.execGit(command);
      
      // Extract PR number from output
      const prNumber = this.extractPRNumber(output.toString());

      this.logger.info(`✅ Pull request created: #${prNumber}`);
      return prNumber;
    } catch (error) {
      this.logger.error(`❌ Failed to create PR: ${error.message}`);
      
      // Rollback: switch back to main
      try {
        this.execGit('git checkout main');
      } catch (rollbackError) {
        this.logger.error(`⚠️  Rollback failed: ${rollbackError.message}`);
      }
      
      throw error;
    }
  }

  /**
   * Build PR description with conflict information
   */
  buildPRDescription(prData) {
    let description = prData.body || 'Automated sync of BDD scenarios between GitHub and AssertThat';

    if (prData.conflicts && prData.conflicts.length > 0) {
      description += '\n\n## ⚠️ Conflicts Detected\n\n';
      description += 'The following files have conflicts that require manual resolution:\n\n';
      
      prData.conflicts.forEach(conflict => {
        description += `- \`${conflict.file}\` (${conflict.type})\n`;
      });

      description += '\n**Action Required:** Please review and resolve conflicts before merging.';
    } else {
      description += '\n\n## ✅ Clean Sync\n\n';
      description += 'No conflicts detected. This PR can be auto-merged.';
    }

    // Add sync statistics
    if (prData.stats) {
      description += '\n\n## 📊 Sync Statistics\n\n';
      description += `- **Additions:** ${prData.stats.additions || 0}\n`;
      description += `- **Modifications:** ${prData.stats.modifications || 0}\n`;
      description += `- **Deletions:** ${prData.stats.deletions || 0}\n`;
    }

    return description;
  }

  /**
   * Determine PR labels based on sync result
   */
  determineLabels(prData) {
    const labels = ['sync', 'automated'];

    if (prData.conflicts && prData.conflicts.length > 0) {
      labels.push('conflicts');
    } else {
      labels.push('clean');
    }

    return labels;
  }

  /**
   * Extract PR number from GitHub CLI output
   */
  extractPRNumber(output) {
    const match = output.match(/\/pull\/(\d+)/);
    return match ? parseInt(match[1], 10) : null;
  }

  /**
   * Check if sync result has conflicts
   */
  hasConflicts(syncResult) {
    if (!syncResult) return false;

    const hasModificationConflicts = syncResult.modifications?.some(
      mod => mod.hasConflict === true
    );

    return hasModificationConflicts || false;
  }

  /**
   * Enable auto-merge for PR
   */
  enableAutoMerge(prNumber) {
    try {
      this.logger.info(`🤖 Enabling auto-merge for PR #${prNumber}`);
      
      this.execGit(`gh pr merge ${prNumber} --auto --squash`);
      
      this.logger.info(`✅ Auto-merge enabled`);
    } catch (error) {
      this.logger.error(`❌ Failed to enable auto-merge: ${error.message}`);
      throw error;
    }
  }

  /**
   * Determine if PR should be auto-merged
   */
  shouldAutoMerge(hasConflicts) {
    return !hasConflicts;
  }

  /**
   * Clean up staging area
   */
  cleanupStagingArea() {
    try {
      this.logger.info(`🧹 Cleaning staging area`);
      this.execGit(`git rm -rf ${this.config.stagingDir}`);
      this.execGit(`git commit -m "${this.config.commitPrefix}: OG-47 Clean up staging area"`);
      this.logger.info(`✅ Staging area cleaned`);
    } catch (error) {
      this.logger.error(`⚠️  Failed to clean staging area: ${error.message}`);
      // Don't throw - cleanup is not critical
    }
  }

  /**
   * Delete a branch
   */
  deleteBranch(branchName) {
    try {
      this.logger.info(`🗑️  Deleting branch: ${branchName}`);
      this.execGit('git checkout main');
      this.execGit(`git branch -D ${branchName}`);
      this.logger.info(`✅ Branch deleted`);
    } catch (error) {
      this.logger.error(`⚠️  Failed to delete branch: ${error.message}`);
      // Don't throw - cleanup is not critical
    }
  }

  /**
   * Execute git command
   */
  execGit(command) {
    if (this.dryRun) {
      this.logger.info(`[DRY RUN] ${command}`);
      return '';
    }

    const result = execSync(command, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return result || '';
  }

  /**
   * Complete PR workflow
   */
  async executeWorkflow(syncResult) {
    try {
      // Generate branch name
      const branchName = this.generateBranchName();

      // Create branch
      this.createSyncBranch(branchName);

      // Create commit
      const message = 'Sync BDD scenarios with AssertThat';
      this.createCommit(message);

      // Push branch
      this.pushBranch(branchName);

      // Detect conflicts
      const hasConflicts = this.hasConflicts(syncResult);

      // Create PR
      const prData = {
        title: `OG-47: ${message}`,
        body: 'Automated bidirectional sync of BDD scenarios',
        conflicts: hasConflicts ? syncResult.modifications.filter(m => m.hasConflict) : [],
        stats: {
          additions: syncResult.additions?.length || 0,
          modifications: syncResult.modifications?.length || 0,
          deletions: syncResult.deletions?.length || 0,
        },
      };

      const prNumber = this.createPullRequest(prData);

      // Enable auto-merge if no conflicts
      if (this.shouldAutoMerge(hasConflicts)) {
        this.enableAutoMerge(prNumber);
      }

      return {
        success: true,
        branchName,
        prNumber,
        hasConflicts,
      };
    } catch (error) {
      this.logger.error(`❌ PR workflow failed: ${error.message}`);
      throw error;
    }
  }
}

