---
type: "agent_requested"
description: "Conventions for interacting with Jira Work Items and Integration with GitHub"
---

# Jira Development Integration Standards

## Work Item Key Referencing

- Always use work item keys in UPPERCASE format (e.g., "JRA-123", not "jra-123")
- Include work item keys in all development activities to maintain traceability
- Work item keys can be found:
  - On board cards (bottom of the card)
  - In work item details (breadcrumb navigation at top)

## Branch Naming Conventions

- **REQUIRED**: Include work item key in branch name when creating branches
- Format: `git checkout -b JRA-123-<descriptive-branch-name>`
- Examples:
  - `git checkout -b JRA-123-fix-login-bug`
  - `git checkout -b PROJ-456-add-user-dashboard`
- This automatically links the branch to the Jira work item

## Commit Message Standards

- **REQUIRED**: Include work item key at the beginning of commit messages
- Format: `git commit -m "JRA-123 <descriptive commit message>"`
- Examples:
  - `git commit -m "JRA-123 Fix authentication timeout issue"`
  - `git commit -m "PROJ-456 Add user profile validation"`
- This links commits to the development panel in Jira work items

## Pull Request Requirements

- **REQUIRED**: Include work item key in pull request title
- Alternative: Ensure source branch name includes the key
- Format: "JRA-123 <descriptive PR title>"
- Examples:
  - "JRA-123 Implement user authentication flow"
  - "PROJ-456 Add responsive design for mobile"
- For Bitbucket Cloud: Include commit with key in PR (non-merge commit)

## Build Integration

- For Bamboo: Build automatically links if commit includes work item key
- For Bitbucket Pipelines: Include key in branch name
- Key must be in commit message to activate build linking

## Deployment Tracking

- Deployments link automatically if associated commits contain work item keys
- Works with Bamboo and Bitbucket Pipelines by default
- Key must be in commit message for deployment association

## Code Review Integration

- Include work item key at beginning of review title
- Format: "JRA-123 <review summary>"
- Example: "JRA-123 Review authentication implementation"
- Works with Crucible integration

## Development Panel Visibility

- Push changes to connected repository for sync recognition
- Allow few minutes for complete synchronization
- Development icons appear on Jira board when:
  - At least one work item has linked development data
  - Board contains less than 100 work items

## Best Practices

- Create branches directly from Jira work items when possible (auto-adds key)
- Use consistent key formatting across all development activities
- Verify development information appears in Jira after pushing changes
- Leverage smart commits for additional automation (if enabled by admin)

## Required Permissions

- Must have "View development tools" project permission
- Admin must connect development tools (Bitbucket, GitHub, GitLab, etc.)
- Atlassian Government environments limited to GitHub only

## Troubleshooting

- Verify work item key formatting (uppercase required)
- Check repository connection to Jira
- Ensure proper project permissions
- Allow time for synchronization after pushing changes
