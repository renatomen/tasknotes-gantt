# Refactoring

Safe refactoring practices.

## Before Refactoring

- Ensure comprehensive test coverage for the behavior you're about to change.
- Commit the current working state first (clean checkpoint to return to).
- Document the current behavior that must be preserved.

## Process

- Make small, incremental changes; run tests after each.
- Keep refactoring commits separate from feature additions.
- Use IDE/automated refactoring tools when available.

## Common Targets

- Extract magic numbers into named constants.
- Replace long parameter lists with configuration objects.
- Convert complex conditionals into guard clauses.
- Extract reusable logic into utility functions.

## Breaking Changes

- Only introduce breaking changes with explicit approval.
- Document the migration path for any API change.
- Maintain backward compatibility when feasible.
- Bump the version appropriately (semver).
