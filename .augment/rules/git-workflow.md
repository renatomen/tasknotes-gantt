---
type: "always_apply"
---

Version control best practices

# Git Workflow Standards

## Commit Guidelines

- Use conventional commit format: feat/fix/docs/refactor/test
- Make atomic commits (one logical change per commit)
- Write descriptive commit messages explaining the change
- Commit frequently (at least every 15 minutes during active development)

## Branch Strategy

- Use trunk-based development
- Create feature branches for complex changes
- Keep branches short-lived (max 2-3 days)
- Rebase before merging to maintain linear history

## CI/CD Integration

- Run tests on every commit
- Use GitHub Actions for automated testing
- Require passing tests before merge
- Automate linting and type checking
