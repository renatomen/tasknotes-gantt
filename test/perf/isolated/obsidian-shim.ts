/**
 * Inert `obsidian` module shim for the isolated render harness (#161 perf plan,
 * KD2 / U3). `GanttContainer.svelte` imports `Notice`/`setIcon` at module scope
 * and pulls `CascadeConfirmModal`, which imports `App`/`Modal`/`Setting` — none
 * of which exist outside Obsidian. The Vitest browser config aliases `obsidian`
 * to this file so the module graph loads and mounts in plain Chromium.
 *
 * These are the ONLY runtime-value `obsidian` imports reachable from the mounted
 * graph (verified in the plan). They are stubs: nothing here is exercised by a
 * read-only render (Notice/setIcon fire on user actions; the Modal subclass is
 * only constructed on a drag-cascade confirm). Keep this minimal — if a mount
 * fails with "X is not a constructor/function", add the missing export here.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export class Notice {
  constructor(_message?: string, _timeout?: number) {}
  setMessage(_message: string): this {
    return this;
  }
  hide(): void {}
}

export function setIcon(_parent: any, _iconId: string): void {}

// `vaultWikilinkSuggest.ts` (reached through GanttContainer) imports these at
// module scope. They fire only while a `[[` token is open — never on a
// read-only render — so inert stubs keep the module graph loading.
export function getAllTags(_cache: any): string[] | null {
  return null;
}

export function parseFrontMatterAliases(_frontmatter: any): string[] | null {
  return null;
}

export function prepareFuzzySearch(_query: string): (text: string) => any {
  return (_text: string) => null;
}

// `wikilinkInputSuggest.ts` (reached through GanttContainer once the cell
// editors host it) extends this and calls `renderResults` at module scope.
// The suggester only wakes on real focus/keystroke events, never on a
// read-only render, so a constructible stub with no-op methods is enough.
export class AbstractInputSuggest<T> {
  app: any;
  limit = 100;
  constructor(app?: any, _inputEl?: any) {
    this.app = app;
  }
  setValue(_value: string): void {}
  getValue(): string {
    return '';
  }
  open(): void {}
  close(): void {}
  renderSuggestion(_value: T, _el: any): void {}
  selectSuggestion(_value: T, _evt?: any): void {}
  onSelect(_cb: (value: T, evt: any) => any): this {
    return this;
  }
}

export function renderResults(_el: any, _text: string, _result: any, _offset?: number): void {}

export class App {}

/**
 * Runtime stub for `TFile`. The controller's progress resolver (`noteProgress`)
 * does `instanceof TFile`, so the isolated perf host — which imports the
 * controller — needs a constructible `TFile` at eval time.
 */
export class TFile {
  path = '';
}

export class Component {
  load(): void {}
  onload(): void {}
  unload(): void {}
  onunload(): void {}
  registerEvent(): void {}
}

/**
 * Runtime stub for `MarkdownRenderer`. `PropertyCell.svelte` imports it at module
 * scope for markdown grid cells; the isolated perf host mounts with empty
 * `cellRenders`, so `render` is never invoked — the export only needs to exist.
 */
export class MarkdownRenderer {
  static async render(
    _app: any,
    _markdown: string,
    _el: any,
    _sourcePath: string,
    _component: any,
  ): Promise<void> {}
}

export class Modal {
  app: any;
  containerEl: any;
  contentEl: any = { empty() {}, createDiv: () => ({}), createEl: () => ({}) };
  titleEl: any = {};
  constructor(app?: any) {
    this.app = app;
  }
  open(): void {}
  close(): void {}
  onOpen(): void {}
  onClose(): void {}
}

export class Setting {
  constructor(_containerEl?: any) {}
  setName(_name: string): this {
    return this;
  }
  setDesc(_desc: string): this {
    return this;
  }
  addButton(_cb?: (b: any) => any): this {
    return this;
  }
  addText(_cb?: (t: any) => any): this {
    return this;
  }
  addToggle(_cb?: (t: any) => any): this {
    return this;
  }
}

// FocusTaskModal (src/bases/FocusTaskModal.ts) extends this; the isolated perf
// harness imports GanttContainer transitively, so the class must exist at module
// eval time. (`FuzzyMatch` is a type-only import and needs no runtime export.)
export class FuzzySuggestModal<T> {
  app: any;
  constructor(app?: any) {
    this.app = app;
  }
  setPlaceholder(_text: string): void {
    /* no-op shim */
  }
  getItems(): T[] {
    return [];
  }
  getItemText(_item: T): string {
    return '';
  }
  onChooseItem(_item: T, _evt?: any): void {
    /* no-op shim */
  }
  open(): void {
    /* no-op shim */
  }
  close(): void {
    /* no-op shim */
  }
}
