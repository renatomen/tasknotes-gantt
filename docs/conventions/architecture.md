# Architecture

Structural guidelines for maintainable architecture.

## Modular Design

- Organize code into logical modules with clear boundaries.
- Prefer events/emitters over direct coupling between components.
- Use a facade for complex subsystems.

## Separation of Concerns

- Keep data, business logic, and presentation in distinct layers.
- **Data adapters extract raw values; views format for display.** See [data-formatting.md](./data-formatting.md).

## Standards alignment (calendar domain)

- **Every calendar-domain semantic — dependencies, dates, availability, scheduling — must map losslessly to the iCalendar standards family (RFC 5545 / 7953 / 9253).** Internal models may be pragmatic; boundary shapes (persisted config, imports, subscriptions, exports) must have a documented standards mapping established when introduced, and proven with a test. Foundational statement + worked precedents: [standards-alignment.md](../architecture/standards-alignment.md).

## Error Handling

- Use explicit error types instead of a generic `Error`.
- Fail fast: validate inputs early.
- Add logging that aids debugging.
- Use `try`/`catch` with specific handling, not blanket swallows.

## State Management

- Avoid global state where possible.
- Use a clear state-manager interface; notify on change via the observer pattern.
- Make state changes atomic and reversible where feasible.

## Performance

- Lazy-load components when possible.
- Debounce user-input-driven operations.
- Cache expensive computations.
- Profile before optimizing.
