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

export class App {}

export class Component {
  load(): void {}
  onload(): void {}
  unload(): void {}
  onunload(): void {}
  registerEvent(): void {}
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
