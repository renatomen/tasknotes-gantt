---
type: "agent_requested"
description: "TypeScript-specific coding standards"
---

# TypeScript Standards

## Type Safety

- Enable strict mode in tsconfig.json
- Avoid `any` type - use proper type definitions
- Use union types instead of loose typing
- Define interfaces for complex objects

## Code Organization

- Use barrel exports (index.ts) for clean imports
- Group related types in separate files
- Use enums for constants with semantic meaning
- Implement generic types for reusable components

## Obsidian Plugin Specific

- Properly type Obsidian API interactions
- Use Plugin class extension correctly
- Handle async operations with proper error catching
- Implement proper lifecycle methods (onload, onunload)
