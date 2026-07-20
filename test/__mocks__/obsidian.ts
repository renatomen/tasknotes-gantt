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

/** Stub of Obsidian's toast; records the message for assertions. */
export class Notice {
  message: string;
  constructor(message = '') {
    this.message = message;
  }
}

/**
 * Stub of Obsidian's `WorkspaceLeaf` — just enough for the calendar editor's
 * `setViewState` prototype patch to capture, replace and restore the method.
 * Records the last state each instance received.
 */
export class WorkspaceLeaf {
  lastState: unknown = null;
  private root: unknown;
  constructor(root?: unknown) {
    this.root = root;
  }
  setViewState(state: unknown): Promise<void> {
    this.lastState = state;
    return Promise.resolve();
  }
  getRoot(): unknown {
    return this.root;
  }
}

/**
 * Stub of Obsidian's `ItemView`, enough to let `CalendarEditorView` extend it
 * and be imported in a Node test (the view's own behaviour is e2e-tested).
 */
export class ItemView {
  leaf: WorkspaceLeaf;
  app: App;
  contentEl = new FakeElement('div');
  constructor(leaf: WorkspaceLeaf) {
    this.leaf = leaf;
    this.app = (leaf as unknown as { app?: App }).app ?? new App();
  }
  registerEvent(): void {}
  getState(): Record<string, unknown> {
    return {};
  }
}

/** Stub host app. */
export class App {
  /** Marker so the mock isn't an empty class (S2094); the real App has many members. */
  readonly isMock = true;
}

/**
 * Stub of Obsidian's `TFile` so runtime `instanceof TFile` checks (e.g.
 * `resolveNoteProgress`, `computeEntrySignature`) can be exercised in unit tests:
 * a test's fake file must be a real instance of this class to pass the guard.
 */
export class TFile {
  path = '';
}

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
  /** Subclasses override this; declared here so the generic `T` is load-bearing. */
  getItems(): T[] {
    return [];
  }
}

interface FakeElementInfo {
  cls?: string | string[];
  text?: string;
  attr?: Record<string, string | number | boolean | null>;
  type?: string;
}

/**
 * Recording stand-in for Obsidian's `createEl`-augmented elements, so modal
 * DOM wiring can be exercised (and traversed by tests) in the node test env.
 */
export class FakeElement {
  tagName: string;
  cls: string[];
  text: string;
  attrs: Record<string, unknown> = {};
  children: FakeElement[] = [];
  listeners: Record<string, ((event: { target: FakeElement }) => void)[]> = {};
  checked = false;
  indeterminate = false;
  disabled = false;
  focused = false;

  constructor(tag = 'div', info?: FakeElementInfo) {
    this.tagName = tag.toUpperCase();
    this.cls =
      typeof info?.cls === 'string' ? info.cls.split(/\s+/).filter(Boolean) : [...(info?.cls ?? [])];
    this.text = info?.text ?? '';
    if (info?.attr) this.attrs = { ...info.attr };
    if (info?.type) this.attrs.type = info.type;
  }

  createEl(tag: string, info?: FakeElementInfo): FakeElement {
    const el = new FakeElement(tag, info);
    this.children.push(el);
    return el;
  }

  createDiv(info?: FakeElementInfo): FakeElement {
    return this.createEl('div', info);
  }

  empty(): void {
    this.children = [];
  }

  setText(text: string): void {
    this.text = text;
  }

  addEventListener(type: string, listener: (event: { target: FakeElement }) => void): void {
    (this.listeners[type] ??= []).push(listener);
  }

  focus(): void {
    this.focused = true;
  }

  /** Test helper: fire listeners of a type as the browser would. */
  trigger(type: string): void {
    for (const listener of this.listeners[type] ?? []) listener({ target: this });
  }

  /** Test helper: depth-first search of the rendered tree. */
  query(predicate: (el: FakeElement) => boolean): FakeElement | null {
    for (const child of this.children) {
      if (predicate(child)) return child;
      const nested = child.query(predicate);
      if (nested) return nested;
    }
    return null;
  }

  /** Test helper: depth-first collection over the rendered tree. */
  queryAll(predicate: (el: FakeElement) => boolean): FakeElement[] {
    const out: FakeElement[] = [];
    for (const child of this.children) {
      if (predicate(child)) out.push(child);
      out.push(...child.queryAll(predicate));
    }
    return out;
  }
}

/**
 * Stub of Obsidian's `Modal`: constructible, open/close call the subclass
 * lifecycle hooks, and `contentEl` is a recording FakeElement tree.
 */
export class Modal {
  app: App;
  contentEl = new FakeElement('div');
  titleEl = new FakeElement('div');
  closed = false;

  constructor(app: App) {
    this.app = app;
  }

  setTitle(title: string): this {
    this.titleEl.setText(title);
    return this;
  }

  open(): void {
    (this as unknown as { onOpen?: () => void }).onOpen?.();
  }

  close(): void {
    this.closed = true;
    (this as unknown as { onClose?: () => void }).onClose?.();
  }
}

interface CachedMetadataLike {
  frontmatter?: Record<string, unknown>;
  tags?: Array<{ tag?: unknown }>;
}

/** A single fuzzy-match span `[start, end)` over the searched text. */
type SearchMatchPart = [number, number];

interface SearchResultLike {
  score: number;
  matches: SearchMatchPart[];
}

/**
 * Flatten a note's `#`-prefixed tags the way the real `getAllTags` does — from
 * frontmatter `tags` (string or array) plus inline `tags` entries — so the vault
 * fetcher's candidate build can be exercised offline.
 */
export function getAllTags(cache: CachedMetadataLike | null | undefined): string[] | null {
  if (!cache) return null;
  const tags: string[] = [];
  const fmTags = cache.frontmatter?.tags;
  if (Array.isArray(fmTags)) {
    for (const tag of fmTags) {
      if (typeof tag === 'string' && tag !== '') tags.push(tag.startsWith('#') ? tag : `#${tag}`);
    }
  } else if (typeof fmTags === 'string' && fmTags !== '') {
    tags.push(fmTags.startsWith('#') ? fmTags : `#${fmTags}`);
  }
  if (Array.isArray(cache.tags)) {
    for (const entry of cache.tags) {
      if (entry && typeof entry.tag === 'string') tags.push(entry.tag);
    }
  }
  return tags;
}

/** Normalize the `aliases`/`alias` frontmatter key to a string array (or null). */
export function parseFrontMatterAliases(
  frontmatter: Record<string, unknown> | null | undefined,
): string[] | null {
  if (!frontmatter || typeof frontmatter !== 'object') return null;
  const raw = frontmatter.aliases ?? frontmatter.alias;
  if (raw === null || raw === undefined) return null;
  if (Array.isArray(raw)) return raw.filter((alias): alias is string => typeof alias === 'string');
  if (typeof raw === 'string') {
    return raw
      .split(',')
      .map((alias) => alias.trim())
      .filter((alias) => alias !== '');
  }
  return null;
}

/**
 * Deterministic stand-in for the real `prepareFuzzySearch`: a contiguous
 * substring scores highest (earlier is better), a scattered subsequence scores
 * lower (tighter is better), and a miss returns `null`. Enough to prove the
 * fetcher ranks by score and includes alias matches; the real matcher runs in
 * e2e.
 */
export function prepareFuzzySearch(
  query: string,
): (text: string) => SearchResultLike | null {
  const needle = query.toLowerCase();
  return (text: string): SearchResultLike | null => {
    if (needle === '') return null;
    const haystack = text.toLowerCase();
    const contiguous = haystack.indexOf(needle);
    if (contiguous !== -1) {
      return { score: 100 - contiguous, matches: [[contiguous, contiguous + needle.length]] };
    }
    const matches: SearchMatchPart[] = [];
    let needleIndex = 0;
    for (let i = 0; i < haystack.length && needleIndex < needle.length; i++) {
      if (haystack[i] === needle[needleIndex]) {
        matches.push([i, i + 1]);
        needleIndex++;
      }
    }
    if (needleIndex < needle.length) return null;
    const spread = matches.length > 0 ? matches[matches.length - 1][0] - matches[0][0] : 0;
    return { score: 50 - spread, matches };
  };
}
