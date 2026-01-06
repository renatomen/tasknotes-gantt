# Quick Start: AssertThat Sync Setup

## 🚀 Get Started in 5 Minutes

This guide will help you set up and test the automated AssertThat sync workflow.

## Prerequisites

- [x] OG-47 implementation complete
- [ ] AssertThat BDD plugin installed in Jira
- [ ] Repository admin access
- [ ] AssertThat API credentials

## Step 1: Local Setup (2 minutes)

### 1.1 Create Environment File

```bash
# Copy the example file
cp .env.example .env
```

### 1.2 Edit .env File

Open `.env` and fill in your credentials:

```bash
# Required for sync
ASSERTTHAT_PROJECT_ID=10000  # Your Jira project ID
ASSERTTHAT_ACCESS_KEY=your-access-key
ASSERTTHAT_SECRET_KEY=your-secret-key
JIRA_SERVER_URL=https://renatomen.atlassian.net

# Optional: Alternative to access/secret keys
ASSERTTHAT_TOKEN=your-token
```

### 1.3 Verify Configuration

```bash
npm run verify:secrets
```

Expected output:
```
✅ All required secrets are configured!
```

## Step 2: Test Locally (1 minute)

### 2.1 Test Basic Sync

```bash
npm run sync:assertthat
```

This will:
- Download features from AssertThat
- Compare with local features
- Show sync results
- **NOT create a PR** (local test only)

### 2.2 Test PR Creation (Optional)

```bash
npm run sync:pr
```

This will:
- Run the sync
- Create a branch
- Commit changes
- Open a PR
- **Use only for testing!**

## Step 3: Configure GitHub Secrets (2 minutes)

### 3.1 Navigate to Secrets Settings

Go to: https://github.com/renatomen/obsidian-gantt/settings/secrets/actions

### 3.2 Add Required Secrets

Click **New repository secret** for each:

| Secret Name | Value |
|-------------|-------|
| `ASSERTTHAT_PROJECT_ID` | Your project ID (e.g., `10000`) |
| `ASSERTTHAT_ACCESS_KEY` | Your access key from AssertThat |
| `ASSERTTHAT_SECRET_KEY` | Your secret key from AssertThat |
| `JIRA_SERVER_URL` | `https://renatomen.atlassian.net` |

Optional (if using token auth):
| Secret Name | Value |
|-------------|-------|
| `ASSERTTHAT_TOKEN` | Your AssertThat token |

### 3.3 Verify Secrets

After adding all secrets, you should see 4-5 secrets listed in:
https://github.com/renatomen/obsidian-gantt/settings/secrets/actions

## Step 4: Test GitHub Actions (1 minute)

### 4.1 Manual Workflow Dispatch

1. Go to: https://github.com/renatomen/obsidian-gantt/actions
2. Click **Sync BDD Scenarios with AssertThat**
3. Click **Run workflow**
4. Select branch: `main`
5. Set **auto_merge**: `false` (for first test)
6. Click **Run workflow**

### 4.2 Monitor Execution

1. Click on the running workflow
2. Watch the logs
3. Check for errors

### 4.3 Review PR

If successful:
1. A PR will be created automatically
2. Check the PR title: `OG-47: Sync BDD scenarios with AssertThat (timestamp)`
3. Review the changes
4. Check labels: `sync`, `automated`
5. Approve and merge if everything looks good

## Step 5: Enable Scheduled Runs

Once manual test succeeds:

1. **Scheduled runs are already enabled!**
   - Runs daily at 2 AM UTC
   - Defined in `.github/workflows/sync-assertthat.yml`

2. **Monitor first scheduled run**
   - Check Actions tab next day
   - Review created PR
   - Verify auto-merge works (if enabled)

## Troubleshooting

### ❌ "Secret not found" error

**Solution**: Verify secret names are exactly correct (case-sensitive)

```bash
# Should be:
ASSERTTHAT_PROJECT_ID  ✅
# Not:
assertthat_project_id  ❌
AssertThat_Project_ID  ❌
```

### ❌ "401 Unauthorized" error

**Solution**: Check credentials are valid

1. Verify access key and secret key
2. Check AssertThat plugin is installed
3. Try regenerating API credentials

### ❌ "No changes detected"

**Solution**: This is normal if features are already in sync

1. Make a change in AssertThat
2. Run workflow again
3. PR will be created with changes

### ❌ Workflow doesn't run

**Solution**: Check workflow file is on main branch

```bash
git checkout main
git pull origin main
```

## Next Steps

After successful setup:

### 1. Configure Auto-merge (Optional)

Enable auto-merge for conflict-free syncs:

1. Go to repository settings
2. Enable branch protection for `main`
3. Require status checks to pass
4. Enable auto-merge in workflow (already enabled by default)

### 2. Set Up Notifications

Get notified of sync failures:

1. Watch the repository
2. Enable Actions notifications in GitHub settings
3. Check email for workflow failures

### 3. Monitor Sync Activity

Regular monitoring:

1. Check Actions tab weekly
2. Review sync PRs promptly
3. Address conflicts quickly
4. Monitor for failed runs

## Useful Commands

```bash
# Verify configuration
npm run verify:secrets

# Test sync locally (no PR)
npm run sync:assertthat

# Test sync with PR creation (local)
npm run sync:pr

# Run tests
npm test -- test/unit/pr-automation.test.ts

# Check workflow syntax
cat .github/workflows/sync-assertthat.yml
```

## Documentation

- [GitHub Secrets Setup Guide](./github-secrets-setup.md) - Detailed setup instructions
- [Sync Workflow Guide](./sync-workflow.md) - Complete workflow documentation
- [BDD Best Practices](../project/BDD-Best-Practices.md) - BDD guidelines

## Support

If you encounter issues:

1. Run `npm run verify:secrets` to check configuration
2. Check workflow logs in GitHub Actions
3. Review error messages
4. See [GitHub Secrets Setup Guide](./github-secrets-setup.md) for troubleshooting

## Summary Checklist

- [ ] Created `.env` file with credentials
- [ ] Ran `npm run verify:secrets` successfully
- [ ] Tested `npm run sync:assertthat` locally
- [ ] Configured all GitHub Actions secrets
- [ ] Tested manual workflow dispatch
- [ ] Reviewed and merged first sync PR
- [ ] Verified scheduled run works

**Estimated time**: 5-10 minutes

**Status**: Ready to use! 🎉

