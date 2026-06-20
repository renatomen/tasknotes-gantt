# Code Quality

Clean-code principles and design patterns. (Naming has its own doc — see [naming.md](./naming.md).)

## Single Responsibility

- Each class/function should have one reason to change.
- Split large classes into focused, smaller components.
- Separate concerns: UI, business logic, data access.

## Functions

- Keep functions short (a good target is under ~50 lines).
- Max 3–4 parameters; pass an options object beyond that.
- One level of abstraction per function.
- Avoid nesting conditionals deeper than two levels — prefer guard clauses.

## Dependency Management

- Use dependency injection instead of reaching for global imports.
- Pass dependencies explicitly to constructors/functions.
- Define interfaces for external dependencies so they can be mocked in tests.
