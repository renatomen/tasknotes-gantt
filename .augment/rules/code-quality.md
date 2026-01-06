---
type: "agent_requested"
description: "Clean code principles and design patterns"
---

# Code Quality Standards

## Single Responsibility Principle

- Each class/function should have one reason to change
- Split large classes into focused, smaller components
- Separate concerns (UI, business logic, data access)

## Naming Conventions

- Use descriptive names: `sourceEntityData` instead of `dragData`
- Functions should start with verbs: `processUserInput`, `validateConfiguration`
- Classes use PascalCase, functions use camelCase
- Constants use UPPER_SNAKE_CASE

## Function Guidelines

- Keep functions under 50 lines
- Maximum 3-4 parameters (use objects for more)
- Single level of abstraction per function
- Avoid nested conditionals deeper than 2 levels

## Dependency Management

- Use dependency injection instead of global imports
- Pass dependencies explicitly to constructors/functions
- Create interfaces for external dependencies to enable mocking
