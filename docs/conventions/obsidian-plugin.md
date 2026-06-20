# Obsidian Plugin Best Practices

## Project Structure

- **Separate concerns** — move beyond a single `main.ts`.
  - Good: `src/commands/`, `src/settings/`, `src/ui/`, `src/utils/`, with a thin `src/main.ts` wiring them together.
  - Bad: everything in one large `main.ts`.

- **Factory functions + dependency injection** for registrable units (commands, views).
  - Pass the plugin instance into factories rather than reaching for global state.

- **Modular command registration** — build commands in factories, register them in a loop:

  ```typescript
  // Factory returns the command list
  export const getEditorCommands = (plugin: MyPlugin) => [
    buildGenerateNoteCommand(plugin),
    buildFormatTextCommand(plugin),
  ];

  // Clean registration in main.ts
  private addEditorCommands() {
    for (const command of getEditorCommands(this)) {
      this.addCommand(command);
    }
  }
  ```

## Lifecycle & API

- Implement `onload`/`onunload` correctly; tear down listeners, intervals, and registered views on unload.
- Register Bases views via the official `plugin.registerBasesView()` API (requires `minAppVersion` ≥ 1.10.0).
- Type Obsidian API interactions properly — see [typescript.md](./typescript.md).

## Bundling

- Third-party libraries (e.g. the SVAR Svelte Gantt) are bundled into `main.js` at build time — the plugin ships a single `main.js` + `manifest.json` (+ `styles.css`), with no runtime `node_modules`/vendor folder.
