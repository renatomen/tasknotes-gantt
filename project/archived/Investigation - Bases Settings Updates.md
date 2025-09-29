## Goal

Investigate how Obsidian Bases persists configuration and column widths in:

- “.base” files
- “base” code blocks in Markdown Then outline how the Obsidian Gantt plugin can programmatically
  update those settings.

Below are precise answers with concrete references from your provided project/app.js.

## 1) Persisting YAML configuration in a “.base” file

- The Bases view class Qj parses the file contents into a query model `mq` and wires a save
  function.
- The non‑markdown view base class Zj implements the actual file persistence via
  `app.vault.modify(file, string)` using the view’s `getViewData()`.

Key call chain for “.base” files:

- Parse: `mq.fromString(content)` → assign `saveFn` to `Qj.saveQuery`
- Trigger save: `Qj.saveQuery` → `this.requestSave()` (debounced) → Zj.save()
- Persist: Zj.save() → `vault.modify(file, this.getViewData())`

Code excerpts:

```javascript path=project/app.js mode=EXCERPT
// Qj sets up the query and save function
// ...
(n = mq.fromString(e)).saveFn = (q) => i.saveQuery(q);
// ...
```

```javascript path=project/app.js mode=EXCERPT
// Zj.save performs the actual write for non-markdown views
// ...
await r.modify(n, o); // r = this.app.vault; n = file; o = getViewData()
// ...
```

Also, the `mq` model serializes to YAML:

```javascript path=project/app.js mode=EXCERPT
// mq.toString: YAML stringification
// ...
return Object.keys(e).length > 0 ? Xy(e) : "";
```

Summary: YAML is parsed via `Zy(...)` and serialized via `Xy(...)`. Persistence uses
`app.vault.modify(file, query.toString())`.

## 2) Persisting column sizes in a “.base” file

- Table view collects user-resized widths into a map and writes them into the current view config
  under key `columnSize`, then saves the query.
- Writing to config is done via `config.set("columnSize", map)`; that calls `this.query.save()`
  which ultimately triggers the view’s save to file as above.

Code excerpts:

```javascript path=project/app.js mode=EXCERPT
t.prototype.saveColumnSizes = function () {
  // build { [propName]: customWidth }
  this.config.set("columnSize", t);
};
```

```javascript path=project/app.js mode=EXCERPT
// ViewConfig.set – persists by saving the query
e.prototype.set = function (key, value) {
  this.data || (this.data = {});
  value === null ? delete this.data[key] : (this.data[key] = value);
  this.query.save();
};
```

Net result in .base files: `columnSize` is serialized into that view’s YAML and written via
`vault.modify(...)`.

## 3) Persisting YAML configuration in a “base” code block (single instance)

- The Markdown code block post-processor registers for language "base".
- It parses the code block content into `mq`, assigns a save function, and on save replaces the
  contents of that specific code block using the post‑processor context `replaceCode(...)`.

Code excerpt:

````javascript path=project/app.js mode=EXCERPT
// Code-block processor for ```base
const l = mq.fromString(t);
const c = fc((q) => r.replaceCode(q.toString()), 100);
l.saveFn = function () {
  a.setQuery(l);
  c(l);
}; // replace only this block
````

Summary: In code blocks, persistence edits the fenced block contents in-place via
`replaceCode(...)`.

## 4) Persisting column sizes in a “base” code block (single instance)

- Same mechanism as #2 and #3 combined:
  - User drag sets `columnInfo[prop].customWidth` and calls `saveColumnSizes()`.
  - `saveColumnSizes()` → `config.set("columnSize", map)` → `query.save()` → `saveFn` (for code
    blocks) → `replaceCode(serializedYaml)` for that block.

Relevant parts when user drags header:

```javascript path=project/app.js mode=EXCERPT
// End of drag: persist widths
// ...
n.saveColumnSizes();
// ...
```

## 5) Multiple “base” code blocks in a single Markdown file

- Obsidian invokes the code block post-processor separately for each block.
- Each invocation receives its own context `r` (with its own `replaceCode`) and constructs its own
  `mq` instance with a distinct `saveFn` closure bound to that block.
- Therefore, `replaceCode(...)` targets only the block currently being processed, ensuring the
  correct instance is updated even when multiple blocks exist.

This scoping is visible in the processor:

```javascript path=project/app.js mode=EXCERPT
// i(t, i, r) is called per block; 'r.replaceCode' affects only this block
const l = mq.fromString(t);
l.saveFn = function () {
  a.setQuery(l);
  c(l);
}; // uses this r.replaceCode
```

## 6) How Obsidian Gantt can update a base instance’s settings

You have two distinct storage modes to handle:

A) .base files (standalone)

- Preferred approach:
  1. Read file: `const raw = await app.vault.read(file)`
  2. Parse: `const query = mq.fromString(raw)` (if you can access the internal class; otherwise
     parse YAML and manipulate its structure)
  3. Locate view: `const view = query.getViewConfig(viewName)` (or first view)
  4. Update: `view.set("columnSize", { title: 240, status: 180, ... })`
  5. Persist: Either rely on `query.save()` if you have wired a `saveFn`, or directly write:
     `await app.vault.modify(file, query.toString())`

Example skeleton (types optional):

```ts mode=EXCERPT
const raw = await app.vault.read(file);
const query = mq.fromString(raw); // or YAML.parse(raw)
const view = query.getViewConfig(name); // or default
view.set("columnSize", { title: 240 });
await app.vault.modify(file, query.toString()); // if no saveFn wired
```

Notes if mq is not accessible:

- Parse the YAML to a plain object.
- Update the correct view object (matching `views[i].name`), add/update `columnSize` directly on
  that view (serializer flattens extra `data` keys to top-level on serialize).
- Re-serialize to YAML and write via `vault.modify(...)`.

B) base code blocks (inline in Markdown) Options:

- If you’re operating during rendering (as a Markdown code block post-processor):
  - Use the provided `MarkdownPostProcessorContext.replaceCode(...)` just like the built‑in handler:
    re-serialize the updated query and call `replaceCode(yaml)`; this will only replace that block.

- If you’re updating outside of rendering (e.g., command or background):
  - Read the note text via `app.vault.read(note)`.
  - Locate the Nth fenced block with language `base` that corresponds to the target block (e.g., by
    block index, by a known header in the YAML, or by previous content match).
  - Parse that block’s YAML, update `columnSize` (or other settings), re-serialize, and replace just
    that fenced region; then `app.vault.modify(note, newContent)`.

Minimal algorithm:

- Tokenize Markdown to find code fences: look for lines matching /^`base(\s|$)/ and the closing `
  fence.
- Choose the correct instance (e.g., by index or a unique marker in the YAML like a view name).
- Replace only the matched span.

Example skeleton:

````ts mode=EXCERPT
const raw = await app.vault.read(note);
const { start, end, yamlStr } = findNthBaseBlock(raw, n);
const obj = YAML.parse(yamlStr);
const view = getView(obj, viewName);
view.columnSize = { title: 240 };
const updated = raw.slice(0, start) + "```base\n" + YAML.stringify(obj) + "\n```" + raw.slice(end);
await app.vault.modify(note, updated);
````

Tips for correctness with multiple blocks:

- Use an index or a unique “view name” inside the block to disambiguate the correct instance.
- Avoid heuristic global replaces; always replace only within the exact fenced block range you
  located.

## Recap of the core APIs and data flow

- YAML parse/stringify for Base query:
  - Parse: `Zy(string)` (internal) → externally, YAML.parse
  - Stringify: `Xy(obj)` (internal) → externally, YAML.stringify
- Persistence engines:
  - .base file: `app.vault.modify(file, query.toString())` via Zj.save
  - Code block: `MarkdownPostProcessorContext.replaceCode(query.toString())` for that block
- Column size writes:
  - `tableView.saveColumnSizes() → config.set("columnSize", map) → query.save() → saveFn(...)`
  - saveFn then routes to the correct persistence path (file modify or code block replace),
    depending on context.

This is how Obsidian both captures and persists the column widths and other per-view settings in
Bases, and how you can safely update them from the Gantt plugin, with or without typings.
