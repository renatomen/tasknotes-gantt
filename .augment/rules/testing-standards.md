---
type: "always_apply"
---

# Testing Standards - Core testing principles following TDD approach

## Test-Driven Development

- Write tests BEFORE implementation (red-green-refactor cycle)
- Every new feature must start with a failing test
- Tests should be fast, reliable, and isolated
- Aim for 80%+ code coverage but prioritize meaningful tests over metrics

## Test Structure

- Use Jest for unit and integration testing
- Mock external dependencies using dependency injection
- Test file naming: `*.test.ts` for unit tests, `*.integration.test.ts` for integration tests
- Group related tests using `describe` blocks with clear naming

## Test Quality

- Each test should test one specific behavior
- Use descriptive test names: "should return error when invalid data provided"
- Arrange-Act-Assert pattern for test structure
- Clean up resources in afterEach/afterAll hooks

## Integration Testing

- Mock Obsidian APIs (TFile, vault) for testing plugin functionality
- Test cross-board moves and sublane reordering scenarios
- Verify error handling and edge cases
