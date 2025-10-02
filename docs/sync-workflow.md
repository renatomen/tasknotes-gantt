# AssertThat Sync Workflow

## Overview

The AssertThat sync workflow automates the bidirectional synchronization of BDD scenarios between GitHub and AssertThat BDD plugin in Jira. This workflow creates pull requests for review, handles conflict detection, and supports auto-merge for clean syncs.

## Workflow Triggers

### Scheduled Sync
- **Schedule**: Daily at 2 AM UTC
- **Cron**: `0 2 * * *`
- **Auto-merge**: Enabled by default for conflict-free syncs

### Manual Dispatch
- **Location**: Actions tab → "Sync BDD Scenarios with AssertThat" → Run workflow
- **Options**:
  - `auto_merge`: Enable/disable auto-merge (default: true)

## Workflow Steps

### 1. Sync Execution
```bash
npm run sync:assertthat
```
- Downloads features from AssertThat to `featureSyncStage/`
- Compares with local `features/` directory
- Detects conflicts and changes

### 2. Change Detection
- Checks for differences between `features/` and `featureSyncStage/`
- Skips PR creation if no changes detected

### 3. PR Creation
- Creates sync branch: `sync/assertthat-YYYY-MM-DD-HHMMSS`
- Commits changes with OG-47 reference
- Opens PR with:
  - Descriptive title with timestamp
  - Detailed body with sync information
  - Labels: `sync`, `automated`
  - Additional label: `conflicts` (if conflicts detected)

### 4. Auto-merge (Optional)
- Enabled for conflict-free syncs
- Uses squash merge strategy
- Requires passing CI checks

### 5. Cleanup
- On failure: Deletes sync branches
- Creates GitHub issue for failed syncs

## PR Automation Script

### PRAutomation Class

Located in `scripts/automation/PRAutomation.mjs`

#### Key Methods

**Branch Management**
```javascript
generateBranchName()  // Creates timestamped branch name
createSyncBranch(branchName)  // Creates and switches to branch
deleteBranch(branchName)  // Cleanup after merge
```

**Commit Operations**
```javascript
createCommit(message, options)  // Creates commit with OG-47 reference
pushBranch(branchName)  // Pushes to remote
```

**PR Operations**
```javascript
createPullRequest(prData)  // Creates PR using GitHub CLI
buildPRDescription(prData)  // Generates PR description
determineLabels(prData)  // Determines appropriate labels
```

**Conflict Handling**
```javascript
hasConflicts(syncResult)  // Detects conflicts
shouldAutoMerge(hasConflicts)  // Determines auto-merge eligibility
```

**Cleanup**
```javascript
cleanupStagingArea()  // Removes staging directory
```

### Usage Example

```javascript
import { PRAutomation } from './scripts/automation/PRAutomation.mjs';
import { SyncConfiguration } from './scripts/config/SyncConfiguration.mjs';

const config = SyncConfiguration.fromEnvironment();
const prAutomation = new PRAutomation({ config });

const syncResult = {
  additions: [],
  modifications: [{ file: 'test.feature', hasConflict: false }],
  deletions: [],
};

const result = await prAutomation.executeWorkflow(syncResult);
console.log(`PR created: #${result.prNumber}`);
```

## Local Testing

### Test PR Creation
```bash
npm run sync:pr
```

### Test Without PR Creation
```bash
CREATE_PR=false npm run sync:assertthat
```

### Dry Run Mode
```javascript
const prAutomation = new PRAutomation({ 
  config, 
  dryRun: true  // Logs commands without executing
});
```

## Configuration

### Required Secrets

Configure in GitHub Settings → Secrets and variables → Actions:

- `ASSERTTHAT_PROJECT_ID`: AssertThat project identifier
- `ASSERTTHAT_ACCESS_KEY`: AssertThat API access key
- `ASSERTTHAT_SECRET_KEY`: AssertThat API secret key
- `ASSERTTHAT_TOKEN`: Alternative to access/secret keys
- `JIRA_SERVER_URL`: Jira server URL

### Environment Variables

```bash
# AssertThat Configuration
ASSERTTHAT_PROJECT_ID=your-project-id
ASSERTTHAT_ACCESS_KEY=your-access-key
ASSERTTHAT_SECRET_KEY=your-secret-key
# OR
ASSERTTHAT_TOKEN=your-token

# Jira Configuration
JIRA_SERVER_URL=https://your-domain.atlassian.net

# PR Creation (optional)
CREATE_PR=true  # Set to false to skip PR creation
```

## Conflict Resolution

### Automatic Resolution
- Whitespace differences
- Comment-only changes
- Formatting differences

### Manual Resolution Required
- Content conflicts in scenarios
- Structural changes to features
- Deletion conflicts

### Conflict PR Workflow
1. PR created with `conflicts` label
2. Auto-merge disabled
3. Team notified via PR
4. Manual review and resolution required
5. Approve and merge after resolution

## Monitoring

### Workflow Status
- Check Actions tab for workflow runs
- Review PR descriptions for sync details
- Monitor GitHub issues for failures

### Sync Statistics
Available in workflow logs:
- Number of changes detected
- Conflict count
- Validation errors
- Sync duration

## Troubleshooting

### Sync Fails
1. Check workflow logs in Actions tab
2. Review error messages
3. Verify secrets are configured
4. Check AssertThat API connectivity

### PR Creation Fails
1. Verify GitHub CLI is available
2. Check GITHUB_TOKEN permissions
3. Ensure branch doesn't already exist
4. Review git configuration

### Auto-merge Not Working
1. Verify CI checks are passing
2. Check branch protection rules
3. Ensure no conflicts detected
4. Verify auto-merge is enabled

## Best Practices

1. **Review PRs Promptly**: Don't let sync PRs accumulate
2. **Resolve Conflicts Quickly**: Address conflicts as soon as detected
3. **Monitor Failures**: Check GitHub issues for failed syncs
4. **Test Locally**: Use `npm run sync:pr` before pushing changes
5. **Keep Secrets Updated**: Rotate API keys regularly

## Related Documentation

- [BDD Best Practices](../project/BDD-Best-Practices.md)
- [Infrastructure Setup Guide](../project/Infrastructure-Setup-Guide.md)
- [Sync Configuration](../scripts/config/SyncConfiguration.mjs)
- [Feature Sync Orchestrator](../scripts/orchestration/FeatureSyncOrchestrator.mjs)

