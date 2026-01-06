---
type: "manual"
---

Safe refactoring practices

# Refactoring Guidelines

## Before Refactoring

- Ensure comprehensive test coverage for existing functionality
- Create a backup branch or commit current state
- Document current behavior that must be preserved

## Refactoring Process

- Make small, incremental changes
- Run tests after each change
- Refactor in separate commits from feature additions
- Use IDE refactoring tools when available

## Code Improvement Targets

- Extract magic numbers into named constants
- Replace long parameter lists with configuration objects
- Convert complex conditionals into guard clauses
- Extract reusable logic into utility functions

## Breaking Changes

- Only introduce breaking changes with explicit approval
- Document migration path for API changes
- Maintain backward compatibility when possible
- Version bump appropriately (semver)
