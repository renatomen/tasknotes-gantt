# TypeScript

TypeScript-specific coding standards.

## Type Safety

- Enable `strict` mode in `tsconfig.json`.
- Avoid `any` — use proper type definitions.
- Prefer union types over loose typing.
- Define interfaces for complex objects.

## Code Organization

- Use barrel exports (`index.ts`) for clean imports.
- Group related types in dedicated files.
- Use enums (or string-literal unions) for semantically meaningful constants.
- Use generics for genuinely reusable components.

## Obsidian Plugin Specific

- Type Obsidian API interactions properly rather than casting to `any`.
- Extend the `Plugin` class correctly; implement `onload`/`onunload` lifecycle methods.
- Handle async operations with proper error catching.
