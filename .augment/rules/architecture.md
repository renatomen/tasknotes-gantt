---
type: "agent_requested"
description: "Structural guidelines for maintainable architecture"
---

# Architecture Guidelines

## Modular Design

- Organize code into logical modules with clear boundaries
- Use events/emitters instead of direct coupling between components
- Implement facade pattern for complex subsystems

## Error Handling

- Use explicit error types instead of generic Error
- Implement fail-fast pattern: validate inputs early
- Add comprehensive logging for debugging
- Use try-catch blocks with specific error handling

## State Management

- Avoid global state where possible
- Use StateManager pattern with clear interfaces
- Implement observer pattern for state change notifications
- Make state changes atomic and reversible

## Performance Considerations

- Lazy load components when possible
- Debounce user input operations
- Cache expensive computations
- Profile before optimizing
