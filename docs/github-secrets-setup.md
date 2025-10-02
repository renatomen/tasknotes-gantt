# GitHub Secrets Setup Guide

## Overview

This guide walks you through configuring GitHub Actions secrets required for the automated AssertThat sync workflow.

## Prerequisites

1. Repository admin access to `renatomen/obsidian-gantt`
2. AssertThat BDD plugin installed in Jira
3. AssertThat API credentials (access key and secret key)
4. Jira API token

## Required Secrets

The following secrets must be configured in GitHub Actions:

| Secret Name | Description | How to Obtain |
|-------------|-------------|---------------|
| `ASSERTTHAT_PROJECT_ID` | Jira project ID | Found in Jira project settings |
| `ASSERTTHAT_ACCESS_KEY` | AssertThat API access key | AssertThat plugin configuration in Jira |
| `ASSERTTHAT_SECRET_KEY` | AssertThat API secret key | AssertThat plugin configuration in Jira |
| `ASSERTTHAT_TOKEN` | Alternative to access/secret keys | AssertThat plugin configuration (optional) |
| `JIRA_SERVER_URL` | Your Jira instance URL | e.g., `https://renatomen.atlassian.net` |

## Step-by-Step Setup

### Step 1: Obtain AssertThat Credentials

1. **Navigate to Jira**
   - Go to your Jira instance: `https://your-domain.atlassian.net`

2. **Access AssertThat Configuration**
   - Click on **Apps** → **Manage your apps**
   - Find **AssertThat BDD** in the list
   - Click **Configure**

3. **Get API Credentials**
   - Look for **API Configuration** or **Integration** section
   - Copy the **Access Key**
   - Copy the **Secret Key**
   - Note: Some versions use a single **Token** instead

4. **Get Project ID**
   - Navigate to your project (e.g., "Obsidian Gantt")
   - Click **Project Settings** → **Details**
   - The Project ID is usually visible in the URL or project details
   - Example: `https://your-domain.atlassian.net/browse/OG` → Project ID might be `10000`

### Step 2: Configure GitHub Secrets

1. **Navigate to Repository Settings**
   ```
   https://github.com/renatomen/obsidian-gantt/settings/secrets/actions
   ```

2. **Add Each Secret**
   - Click **New repository secret**
   - Enter the **Name** (exactly as shown in the table above)
   - Enter the **Value** (paste the credential)
   - Click **Add secret**

3. **Repeat for All Secrets**
   - `ASSERTTHAT_PROJECT_ID`
   - `ASSERTTHAT_ACCESS_KEY`
   - `ASSERTTHAT_SECRET_KEY`
   - `ASSERTTHAT_TOKEN` (if using token-based auth)
   - `JIRA_SERVER_URL`

### Step 3: Verify Configuration

1. **Run Verification Script Locally**
   ```bash
   # Create .env file from example
   cp .env.example .env
   
   # Edit .env with your credentials
   # Then run verification
   npm run verify:secrets
   ```

2. **Check GitHub Secrets**
   - Go to: `https://github.com/renatomen/obsidian-gantt/settings/secrets/actions`
   - Verify all 5 secrets are listed
   - Note: You cannot view secret values, only names

### Step 4: Test the Workflow

1. **Manual Dispatch Test**
   - Go to: `https://github.com/renatomen/obsidian-gantt/actions`
   - Click **Sync BDD Scenarios with AssertThat**
   - Click **Run workflow**
   - Select branch: `main` (or your current branch)
   - Set **auto_merge**: `false` (for first test)
   - Click **Run workflow**

2. **Monitor Execution**
   - Click on the running workflow
   - Watch the logs for each step
   - Check for any errors

3. **Review Created PR**
   - If successful, a PR will be created
   - Review the changes in the PR
   - Check that labels are correct (`sync`, `automated`)
   - Verify the PR description is complete

## Troubleshooting

### Secret Not Found Error

**Error**: `Error: Secret ASSERTTHAT_ACCESS_KEY not found`

**Solution**:
1. Verify secret name is exactly correct (case-sensitive)
2. Check that secret was added to **Actions** secrets, not **Dependabot** secrets
3. Re-add the secret if necessary

### Authentication Failed

**Error**: `401 Unauthorized` or `403 Forbidden`

**Solution**:
1. Verify credentials are correct
2. Check that AssertThat plugin is properly installed
3. Ensure API access is enabled in AssertThat settings
4. Try regenerating API credentials

### Project ID Not Found

**Error**: `Project with ID 10000 not found`

**Solution**:
1. Verify the project ID is correct
2. Check project permissions
3. Ensure the project exists in Jira
4. Try using the project key instead (e.g., "OG")

### Workflow Doesn't Trigger

**Solution**:
1. Check that workflow file is on the `main` branch
2. Verify workflow syntax is correct
3. Check repository Actions settings are enabled
4. Review workflow permissions

## Security Best Practices

### 1. Rotate Credentials Regularly
- Change API keys every 90 days
- Update GitHub secrets when credentials change

### 2. Limit Secret Access
- Only grant repository admin access to trusted team members
- Use environment-specific secrets for different branches

### 3. Monitor Secret Usage
- Review workflow logs regularly
- Check for unauthorized access attempts
- Enable GitHub security alerts

### 4. Never Commit Secrets
- Always use `.env` for local development
- Verify `.env` is in `.gitignore`
- Use `git log` to check for accidentally committed secrets

## Verification Checklist

Before running the workflow, verify:

- [ ] All 5 secrets are configured in GitHub Actions
- [ ] Secret names match exactly (case-sensitive)
- [ ] Credentials are valid and not expired
- [ ] AssertThat plugin is installed and configured
- [ ] Project ID is correct
- [ ] Jira server URL is correct (with https://)
- [ ] Local `.env` file works with `npm run sync:assertthat`
- [ ] GitHub Actions are enabled for the repository

## Next Steps

After configuring secrets:

1. **Test Locally First**
   ```bash
   npm run sync:assertthat
   ```

2. **Test Manual Workflow**
   - Run workflow manually with auto-merge disabled
   - Review the created PR
   - Verify all changes are correct

3. **Enable Scheduled Runs**
   - Once manual test succeeds, scheduled runs will work automatically
   - Monitor the first scheduled run (2 AM UTC)

4. **Configure Auto-merge**
   - After successful manual tests, enable auto-merge
   - Set up branch protection rules if needed

## Support

If you encounter issues:

1. Check workflow logs in GitHub Actions
2. Review error messages carefully
3. Verify all secrets are configured correctly
4. Test locally with `.env` file first
5. Check AssertThat plugin documentation
6. Review Jira API documentation

## Related Documentation

- [Sync Workflow Guide](./sync-workflow.md)
- [AssertThat BDD Plugin Documentation](https://www.assertthat.com/docs)
- [GitHub Actions Secrets Documentation](https://docs.github.com/en/actions/security-guides/encrypted-secrets)
- [Jira API Documentation](https://developer.atlassian.com/cloud/jira/platform/rest/v3/)

