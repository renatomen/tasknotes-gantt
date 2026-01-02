# AssertThat ↔ GitHub Sync Guide

Complete guide for bidirectional synchronization of BDD scenarios between GitHub and AssertThat BDD plugin in Jira.

## Table of Contents

- [Overview](#overview)
- [Quick Reference](#quick-reference)
- [Sync Directions](#sync-directions)
- [Commands Reference](#commands-reference)
- [PR Creation Options](#pr-creation-options)
- [Environment Configuration](#environment-configuration)
- [GitHub Actions Workflow](#github-actions-workflow)
- [Troubleshooting](#troubleshooting)

---

## Overview

The sync system enables bidirectional synchronization:

```
┌─────────────────┐                    ┌─────────────────┐
│                 │  ──── Upload ────▶ │                 │
│     GitHub      │                    │   AssertThat    │
│   (features/)   │  ◀── Download ──── │     (Jira)      │
│                 │                    │                 │
└─────────────────┘                    └─────────────────┘
```

**Key Features:**
- **Bidirectional**: Changes flow both ways
- **ID-based tracking**: Uses `@assertthat-feature-id` and `@assertthat-scenario-id` tags
- **Conflict detection**: Identifies when both sides have changes
- **PR-based review**: All syncs create PRs for review
- **Auto-merge**: Clean syncs can be auto-merged

---

## Quick Reference

| Task | Command |
|------|---------|
| Download from AssertThat (no PR) | `npm run sync:assertthat` |
| Download + create PR | `npm run sync:pr` |
| Upload to AssertThat | `node scripts/assign-assertthat-ids.mjs` |
| Verify configuration | `npm run verify:secrets` |

---

## Sync Directions

### 1. Download: AssertThat → GitHub

Downloads BDD scenarios from AssertThat and updates local feature files.

```bash
# Download only (no PR, for testing)
npm run sync:assertthat

# Download and create PR
npm run sync:pr
```

**What happens:**
1. Connects to AssertThat API
2. Downloads all scenarios for the project
3. Compares with local `features/` directory
4. Identifies additions, modifications, deletions
5. Updates local files
6. (Optional) Creates PR for review

### 2. Upload: GitHub → AssertThat

Uploads local feature files to AssertThat. This also assigns AssertThat IDs to new scenarios.

```bash
# Upload all features and assign IDs
node scripts/assign-assertthat-ids.mjs
```

**What happens:**
1. Reads all `.feature` files from `features/` directory
2. Uploads each file to AssertThat
3. AssertThat assigns IDs to new features/scenarios
4. Downloads the IDs back
5. Updates local files with the new IDs

### 3. Bidirectional: Full Round-Trip

For a complete sync that handles both directions:

```bash
# Step 1: Upload local changes to AssertThat
node scripts/assign-assertthat-ids.mjs

# Step 2: Download any changes from AssertThat
npm run sync:assertthat

# Step 3: Review and commit changes
git add features/
git commit -m "chore: sync BDD scenarios with AssertThat"
```

---

## Commands Reference

### `npm run sync:assertthat`

Downloads features from AssertThat and compares with local files.

```bash
npm run sync:assertthat
```

**Options via environment variables:**
- `CREATE_PR=false` - Disable PR creation (default for local testing)
- `DRY_RUN=true` - Show what would happen without making changes

**Output:**
- Downloads to `featureSyncStage/` (temporary)
- Shows diff between local and remote
- Updates `features/` directory

### `npm run sync:pr`

Downloads features AND creates a PR for review.

```bash
npm run sync:pr
```

**What it creates:**
- Branch: `sync/assertthat-YYYY-MM-DD-HHMMSS`
- Commit: `chore/sync: OG-47 Sync BDD scenarios with AssertThat`
- PR with labels: `sync`, `automated`
- Auto-merge enabled for conflict-free syncs

### `node scripts/assign-assertthat-ids.mjs`

Uploads all local features to AssertThat and assigns IDs.

```bash
node scripts/assign-assertthat-ids.mjs
```

**Use when:**
- Adding new feature files locally
- Initial setup of a new project
- Resetting AssertThat to match GitHub

### `npm run verify:secrets`

Validates that all required environment variables are configured.

```bash
npm run verify:secrets
```

**Expected output:**
```
✅ All required secrets are configured!
```

---

## PR Creation Options

### Automatic PR Creation (GitHub Actions)

The workflow creates PRs automatically with these options:

| Option | Description | Default |
|--------|-------------|---------|
| `auto_merge` | Enable auto-merge for clean syncs | `true` |

**To trigger manually:**
1. Go to Actions → "Sync BDD Scenarios with AssertThat"
2. Click "Run workflow"
3. Configure options
4. Click "Run workflow"

### Local PR Creation

```bash
npm run sync:pr
```

**PR includes:**
- Title: `OG-47: Sync BDD scenarios with AssertThat`
- Body: Sync statistics and conflict information
- Labels: `sync`, `automated`, optionally `conflicts`

### PR Labels

| Label | Meaning |
|-------|---------|
| `sync` | PR is from sync workflow |
| `automated` | PR was created automatically |
| `clean` | No conflicts detected |
| `conflicts` | Conflicts detected, manual review required |

---

## Environment Configuration

### Required Environment Variables

Create a `.env` file in the project root:

```bash
# AssertThat API credentials (required)
ASSERTTHAT_PROJECT_ID=OG         # Jira project key
ASSERTTHAT_ACCESS_KEY=your-key   # From AssertThat settings
ASSERTTHAT_SECRET_KEY=your-secret # From AssertThat settings

# Optional: Alternative authentication
ASSERTTHAT_TOKEN=your-token      # API token (alternative to access/secret)

# Jira configuration
JIRA_SERVER_URL=https://your-org.atlassian.net
```

### GitHub Secrets (for Actions)

Configure these in: Settings → Secrets and variables → Actions

| Secret | Description |
|--------|-------------|
| `ASSERTTHAT_PROJECT_ID` | Jira project key (e.g., `OG`) |
| `ASSERTTHAT_ACCESS_KEY` | AssertThat access key |
| `ASSERTTHAT_SECRET_KEY` | AssertThat secret key |
| `ASSERTTHAT_TOKEN` | (Optional) API token |
| `JIRA_SERVER_URL` | Jira server URL |

### Getting AssertThat Credentials

1. Open Jira project
2. Go to Project Settings → AssertThat
3. Navigate to "API Keys" section
4. Generate or copy existing keys

---

## GitHub Actions Workflow

### Scheduled Sync

Runs automatically:
- **Schedule**: Daily at 2 AM UTC
- **Cron**: `0 2 * * *`

### Manual Trigger

1. Go to Actions tab
2. Select "Sync BDD Scenarios with AssertThat"
3. Click "Run workflow"
4. Set options:
   - `auto_merge`: Enable/disable auto-merge
5. Click "Run workflow"

### Workflow Steps

```
1. Checkout repository
2. Setup Node.js
3. Install dependencies
4. Configure Git
5. Run sync script (npm run sync:assertthat)
6. Check for changes
7. Create sync branch and PR (if changes detected)
8. Enable auto-merge (if configured and no conflicts)
9. Cleanup on failure
10. Generate summary
```

### Workflow Permissions

The workflow requires:
- `contents: write` - To create branches and commits
- `pull-requests: write` - To create PRs

---

## Troubleshooting

### Common Issues

#### "Authentication failed"

```bash
# Verify your credentials
npm run verify:secrets

# Check if token is valid
node scripts/debug-auth.mjs
```

#### "No changes detected"

The sync only creates PRs when there are actual differences. Check:
```bash
# Compare local vs remote manually
npm run sync:assertthat
git diff features/
```

#### "Conflicts detected"

When both GitHub and AssertThat have changes to the same scenario:

1. Review the PR carefully
2. Check conflict markers in feature files
3. Decide which version to keep
4. Manually edit and commit

#### "Pre-commit hooks failing"

Use `--no-verify` to bypass hooks for sync commits:
```bash
git commit --no-verify -m "chore: sync BDD scenarios"
```

### Debug Commands

```bash
# Test API connectivity
node scripts/debug-auth.mjs

# View all scenarios from AssertThat
node scripts/debug-scenarios.mjs

# Test download without making changes
DRY_RUN=true npm run sync:assertthat
```

### Log Locations

- **Local**: Console output during sync
- **GitHub Actions**: Actions tab → workflow run → job logs

---

## Best Practices

1. **Review PRs promptly** - Don't let sync PRs accumulate
2. **Resolve conflicts quickly** - Address conflicts as soon as detected
3. **Test locally first** - Use `npm run sync:assertthat` before pushing
4. **Keep credentials secure** - Rotate API keys regularly
5. **Monitor failures** - Check GitHub Actions for failed syncs
6. **Use ID tags** - Never remove `@assertthat-*-id` tags manually

---

## Related Documentation

- [Quick Start Guide](./QUICKSTART-SYNC.md)
- [Sync Workflow Details](./sync-workflow.md)
- [ID Tracking Guide](./assertthat-id-tracking.md)
- [BDD Best Practices](../project/BDD-Best-Practices.md)

