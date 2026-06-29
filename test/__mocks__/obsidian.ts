/**
 * Minimal Jest mock for the `obsidian` runtime module.
 *
 * Obsidian is provided by the host app at runtime, not by an npm package, so
 * unit tests can't import its real exports. Most tests use `import type` (erased
 * at compile time) and need nothing here. This mock exists for the few units
 * that extend an Obsidian class at runtime — e.g. `FocusTaskModal extends
 * FuzzySuggestModal` — so they can be constructed and exercised in isolation.
 *
 * Add exports here only as units under test require them.
 */

/** Stub host app. */
export class App {}

/**
 * Stub of Obsidian's generic fuzzy picker. Subclasses override getItems /
 * getItemText / renderSuggestion / onChooseItem; this base only needs to be
 * constructible and to accept the wiring the subclass calls in its constructor.
 */
export class FuzzySuggestModal<T> {
  app: App;
  private placeholder = '';
  constructor(app: App) {
    this.app = app;
  }
  setPlaceholder(text: string): void {
    this.placeholder = text;
  }
}
