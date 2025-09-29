---
type: "always_apply"
---

# Obsidian Plugin Development Best Practices

## Project Structure and Architecture

### File Organization

- **Separate Concerns**: Move beyond single `main.ts` file structure
  - GOOD: `src/commands/`, `src/settings/`, `src/ui/`, `src/utils/`
  - GOOD: `src/main.ts`, `src/settings-tab.ts`, `src/commands.ts`
  - BAD: Everything in one large `main.ts` file

- **Use Factory Functions and Dependency Injection**
  - GOOD: `getEditorCommands(plugin: MyPlugin)` returning array of commands
  - GOOD: Pass plugin instance as parameter to command factories
  - BAD: Global state access or tight coupling between components

- **Modular Command Registration**

  // GOOD: Factory pattern for commands export const getEditorCommands = (plugin: MyPlugin) => [
  buildGenerateNoteCommand(plugin), buildFormatTextCommand(plugin) ];

  // GOOD: Clean registration in main.ts private addEditorCommands() { for (const command of
  getEditorCommands(this)) { this.addCommand(command); } }
