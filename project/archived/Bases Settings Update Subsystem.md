# Bases Settings Update Subsystem

## Recommendation Overview

A top 1% solution should be robust, testable, and decoupled from Bases’ internal, unstable
internals. We’ll implement a small, typed “Bases Settings Update” subsystem that:

- Works on both targets: “.base” files and “base” code blocks
- Uses only stable Obsidian APIs (Vault read/modify, Markdown post-processor context when available)
- Treats Bases query as plain YAML data (do not depend on internal mq/model)
- Is modular, DI-friendly, and fully covered by tests

This plan strictly follows your rules in .augment/rules (architecture, code-quality, typescript,
plugin best practices, testing, git-workflow).

## Architecture and Module Layout

- src/bases/
  - parser/
    - fenceLocator.ts (find Nth “```base” fence in Markdown deterministically)
    - yaml.ts (safe YAML load/dump; injection ready)
  - model/
    - types.ts (interfaces for serialized Bases YAML shape)
  - updater/
    - updateBaseFile.ts (update a .base TFile)
    - updateBaseCodeBlock.ts (update a specific fenced code block inside a Markdown file)
    - selectors.ts (find view by name/index; ensure view exists)
    - merge.ts (merge/patch helpers for settings like columnSize)
  - id/
    - identity.ts (stable per-instance IDs for code blocks via an “id” or “ganttId” YAML key)
  - api/
    - BasesSettingsUpdater.ts (facade; dependency-injected YAML, Vault, logger)

Key patterns

- Separate concerns and DI: Vault access, YAML parsing, fence scanning are injected; easy to mock
  (code-quality + testing-standards).
- Facade pattern: a small facade exposes a clean API (architecture).
- No reliance on internal Bases classes; we operate purely on serialized YAML (robust against
  Obsidian updates).

## Data Model (minimal typed view of serialized YAML)

Define only what we need; keep extensible and resilient to unknown fields.

```ts mode=EXCERPT
export interface BasesQuery {
  views?: BasesView[];
  // global fields (filters, formulas, properties) omitted here for brevity
  [k: string]: unknown; // keep unrecognized keys
}
export interface BasesView {
  name: string;
  type: string; // e.g., "table"
  columnSize?: Record<string, number>;
  [k: string]: unknown; // retain unknown, preserved by Bases
}
```

## Public Facade API

- Update a .base file by view name or index
- Update a “base” code block by file + fence identifier (index or stable id)
- All operations are transactional (re-read -> transform -> write), with validation and conflict
  checks

```ts mode=EXCERPT
export interface ColumnSizePatch {
  [prop: string]: number;
}
export interface BasesSettingsUpdater {
  updateBaseFile(opts: {
    file: TFile;
    view?: string | number;
    columnSize?: ColumnSizePatch;
  }): Promise<void>;
  updateBaseCodeBlock(opts: {
    file: TFile;
    fence: number | string;
    view?: string | number;
    columnSize?: ColumnSizePatch;
  }): Promise<void>;
}
```

Notes

- fence can be: an index (Nth base block) or a stable id (see below).

## Robust Identification for Multiple Code Blocks

- Add a stable per-instance key to the YAML (e.g., id: "gantt-...") when we first touch a block.
  Bases preserves unknown YAML keys (unrecognizedData) so this is safe and future-proof.
- Allow selecting by id (preferred), else fall back to Nth “```base” fence.

```ts mode=EXCERPT
function ensureBlockId(q: BasesQuery, gen: () => string): string {
  if (typeof (q as any).id === "string") return (q as any).id;
  const id = gen();
  (q as any).id = id;
  return id;
}
```

## Algorithms

### A) .base file update

- Read -> YAML.parse -> locate view -> merge changes -> YAML.stringify -> vault.modify
- Validate: YAML structure, view existence, numeric widths
- Re-read-and-compare before write (optimistic concurrency) if needed for safety

```ts mode=EXCERPT
const raw = await vault.read(file);
const q = yaml.load(raw) as BasesQuery;
const v = selectView(q, opts.view); // by name or index
v.columnSize = { ...(v.columnSize || {}), ...opts.columnSize };
await vault.modify(file, yaml.dump(q));
```

### B) “base” code block update

- Read Markdown -> locate fenced region for “```base” (by id or index) -> parse -> mutate -> replace
  only that fence -> write
- The fence locator must handle:
  - Fences with language tag “base” followed by attrs/comments
  - Nested backticks inside YAML strings (rare, but guard)
  - Windows/Mac line endings
- Consider adding/ensuring id the first time we touch the block

```ts mode=EXCERPT
const text = await vault.read(mdFile);
const fence = findBaseFence(text, opts.fence); // returns {start,end,code}
const q = yaml.load(fence.code) as BasesQuery;
const v = selectView(q, opts.view);
v.columnSize = { ...(v.columnSize || {}), ...opts.columnSize };
const updated = spliceFence(text, fence, yaml.dump(q));
await vault.modify(mdFile, updated);
```

## Using Obsidian APIs and Typings

- Obsidian APIs used:
  - app.vault.read/modify (stable and supported)
  - Optionally register a markdown post-processor to offer an “Update this block” action using
    context.replaceCode(yaml) when you are already inside render (mirrors Bases’ own behavior).
- With typings:
  - Type App, TFile, MarkdownPostProcessorContext, etc.
  - Strongly type facade, DI interfaces, and YAML shapes
- Without typings:
  - Same logic in JS; pass the global app and a YAML lib instance
  - Keep runtime guards and explicit error messages

## Error Handling and Safety (Architecture)

- Define explicit error types: InvalidYamlError, ViewNotFoundError, FenceNotFoundError,
  WriteConflictError
- Validate inputs early (fail-fast), log meaningful context (file path, view, fence)
- Debounce batch updates if triggered by rapid UI interactions
- Optional: Write-protect guard (read → transform → if unchanged, skip write)

## Testing Strategy (Testing Standards)

- TDD: start with failing tests for each scenario
- Unit tests:
  - fenceLocator: single fence, multiple fences, missing end fence, CRLF/LF, edge cases
  - yaml.merge: merging columnSize maps; validation of numeric widths
  - selectors: select by name, by index, behavior when missing
- Integration tests (mock Vault and TFile):
  - .base file update: full cycle read->transform->write
  - Markdown code blocks: correct fence replaced, others unchanged; id creation/selection
- File naming: _.test.ts for unit, _.integration.test.ts for integration
- Mock via DI: pass fake vault, fake yaml; no real Obsidian dependency in tests

## Clean Code and TypeScript Rules

- Strict mode, no any; union types where appropriate (typescript.md)
- Functions under 50 lines; SRP and descriptive names (code-quality.md, naming-conventions.md)
- Barrel exports under src/bases/index.ts for ergonomics (typescript.md)
- Facade + small modules (architecture.md)

## Git Workflow

- Feature branch: feat/bases-settings-updater
- Conventional commits: test:, feat:, refactor:
- PR gated by tests + lint + type-check (git-workflow.md)

## Where to leverage existing Obsidian/Bases behavior

- Do not call internal Bases classes; instead:
  - Persist exactly how Bases does: write YAML for .base; replace code block contents for fenced
    blocks
  - Use the same shape for per-view settings like columnSize
- You get full compatibility without relying on internal, minified APIs.

## Rollout and Backward Compatibility

- Make updates opt-in and reversible:
  - If a target block lacks id, add it (and persist); otherwise respect existing id
  - Never remove unknown YAML keys; always merge
- Add a dry-run mode for previewing changes in logs (no write)

## Minimal Command Surface for the Plugin

- Command: “Bases: Set column size for current view”
- Command options:
  - target: Active .base file | Current markdown code block by cursor
  - view: by name or default
  - columns: via JSON prompt or derived from UI action
- Internally delegate to the facade

## Summary

- Use a small, typed, dependency-injected subsystem that edits only the serialized YAML via stable
  Obsidian APIs.
- Identify code blocks reliably (prefer stable id inside YAML).
- Keep design modular and fully tested per your house rules.
- This maximizes robustness today, even without an official Bases API, and remains easy to adapt
  if/when an API is released.

If you want, I can draft the skeleton files and the first TDD tests for fenceLocator and
updateBaseFile to kickstart implementation.

#########################################

# IMPLEMENTATION PLAN

## Plan

I’ll propose a complete, ready-to-paste draft for project/Bases Settings Update Subsystem.md that:

- Aligns with your rules in .augment/rules
- Leverages existing Obsidian APIs/typings
- Fits your current code (see src/bases/views/gantt-view.ts already persisting column sizes) No
  files will be modified. If you approve, I’ll apply it (small, reviewable commit). Note: your path
  used “projects/…”, but the repo has “project/…”. I will target project/Bases Settings Update
  Subsystem.md unless you prefer otherwise.

## Recommended document content (ready to paste)

Title: Bases Settings Update Subsystem

1. Purpose and scope

- Goal: Provide a robust, testable, DI-friendly subsystem to update Bases query settings in two
  storage forms:
  - .base files
  - base fenced code blocks in Markdown
- Constraints: No reliance on Bases internal non-public classes; operate on serialized YAML via
  stable Obsidian APIs.
- Primary settings: columnSize (map), but design supports any per-view settings (filters, sort,
  obsidianGantt settings, etc.).

2. Design principles (from our rules)

- Architecture: Facade + small modules; no global state; fail-fast errors; logging (architecture.md)
- Code quality: SRP, small functions, descriptive names, DI for Vault/YAML (code-quality.md)
- TypeScript: strict types; interfaces for YAML shape; no any (typescript.md)
- Obsidian plugin best practices: modular commands, factory/DI patterns
  (obsidian-plugin-best-practices.md)
- Testing: TDD, unit + integration with mocked Vault; clear Arrange-Act-Assert
  (testing-standards.md)
- Git workflow: small atomic commits, conventional messages (git-workflow.md)

3. Public API (facade)

- Update .base file and base code block settings by view name or index. Fence selection by index or
  a stable id stored in YAML.

```ts mode=EXCERPT
export interface ColumnSizePatch {
  [prop: string]: number;
}
export interface BasesSettingsUpdater {
  updateBaseFile(opts: {
    file: TFile;
    view?: string | number;
    columnSize?: ColumnSizePatch;
  }): Promise<void>;
  updateBaseCodeBlock(opts: {
    file: TFile;
    fence: number | string;
    view?: string | number;
    columnSize?: ColumnSizePatch;
  }): Promise<void>;
}
```

Notes:

- fence can be a number (Nth base fence) or string id we add to the YAML (preferred).
- Future-friendly: add more fields (e.g., sort, filters) with the same merge strategy.

4. Minimal YAML model (resilient to unknown fields)

- Only type the fields we touch; preserve everything else.

```ts mode=EXCERPT
export interface BasesQuery {
  views?: BasesView[];
  [k: string]: unknown;
}
export interface BasesView {
  name?: string;
  type?: string;
  columnSize?: Record<string, number>;
  [k: string]: unknown;
}
```

5. Algorithms A) .base file update

- Read with app.vault.read(file)
- YAML.parse -> find view -> merge settings -> YAML.stringify -> app.vault.modify(file, text)
- Validate numeric widths, view existence; no destructive changes.

```ts mode=EXCERPT
const raw = await vault.read(file);
const q = yaml.load(raw) as BasesQuery;
const v = selectView(q, opts.view);
v.columnSize = { ...(v.columnSize || {}), ...opts.columnSize };
await vault.modify(file, yaml.dump(q));
```

B) base fenced code block update

- Read Markdown note; find base fence by id or index; parse YAML; merge settings; replace only that
  fence; write back.

```ts mode=EXCERPT
const text = await vault.read(note);
const fence = findBaseFence(text, opts.fence);
const q = yaml.load(fence.code) as BasesQuery;
const v = selectView(q, opts.view);
v.columnSize = { ...(v.columnSize || {}), ...opts.columnSize };
await vault.modify(note, spliceFence(text, fence, yaml.dump(q)));
```

C) Stable identification for multiple code blocks

- When first touching a block, ensure an id field inside YAML (e.g., id: "gantt-…") and prefer
  selecting by id thereafter.

```ts mode=EXCERPT
function ensureId(q: BasesQuery, gen: () => string): string {
  const id = (q as Record<string, unknown>).id;
  if (typeof id === "string") return id;
  const v = gen();
  (q as Record<string, unknown>).id = v;
  return v;
}
```

6. Error handling and safety (architecture.md)

- Fail-fast with explicit errors: InvalidYamlError, ViewNotFoundError, FenceNotFoundError,
  WriteConflictError.
- Validate inputs (view selector, numeric widths).
- Preserve unknown YAML keys; no destructive rewrites.
- Optional: optimistic concurrency (re-read and compare before write) when large team edits are
  likely.
- Logging: concise debug lines; user-friendly error summaries.

7. Testing strategy (testing-standards.md) Unit tests:

- fenceLocator: single/multiple fences, CRLF/LF, missing end fence
- selectors: by name, by index, fallback behavior
- merge: numeric validation, partial merges, preservation of unknown keys

Integration tests (mock Vault + TFile):

- .base round-trip: read -> transform -> write; unchanged input => no write
- Markdown fences: replace only the targeted fence; id creation; multiple fences unaffected

Naming: _.test.ts (unit), _.integration.test.ts (integration)

8. Integration with existing code

- src/bases/views/gantt-view.ts already implements column size persistence using three strategies:
  - controller/query.setViewConfig if present
  - query.saveFn with updated views
  - processFrontMatter fallback
- This subsystem complements that by providing a reusable, typed service that:
  - Works outside render contexts (e.g., commands)
  - Supports code block fence updates (not only frontmatter/.base)
  - Centralizes error handling, YAML parsing, and fence selection

9. Module layout

- src/bases/settings/
  - parser/fenceLocator.ts
  - parser/yaml.ts
  - model/types.ts
  - updater/updateBaseFile.ts
  - updater/updateBaseCodeBlock.ts
  - updater/selectors.ts
  - updater/merge.ts
  - id/identity.ts
  - api/BasesSettingsUpdater.ts (facade)
- Tests in test/unit/bases-settings/ and test/integration/bases-settings/

10. Using Obsidian APIs and typings

- Stable APIs: app.vault.read/modify, app.fileManager.processFrontMatter for .base
  files/frontmatter.
- For code blocks: operate on raw Markdown text; only replace within the exact fence range.
- With typings: TFile, App, MarkdownPostProcessorContext types used for safety; subsystem is
  DI-based so vault/yaml are easily mocked.

11. Permissions and UX

- Provide “dry-run” mode (log-only) for preview.
- Offer commands:
  - Bases: Set column size for current view (active .base or current base code block)
  - Bases: Assign/update block id for current code block
- Debounce UI-triggered mass updates to avoid churn.

12. Future compatibility

- If/when an official Bases API arrives:
  - Add a new adapter behind the facade that uses official methods
  - Keep the YAML route as fallback

13. Open questions

- Preferred id key name in YAML? (e.g., id vs ganttId)
- Should we normalize column width ranges (min/max) or respect any numeric?

14. Implementation checklist

- [ ] fenceLocator with tests
- [ ] YAML DI wrapper and strict types
- [ ] selectors + merge utility with validation
- [ ] updateBaseFile + updateBaseCodeBlock implementations + tests
- [ ] Facade + initial commands wiring
- [ ] Integration with gantt-view and manual test in vault
- [ ] Docs: README snippet and user-facing notes

## Notes and next step

- I see project/Bases Settings Update Subsystem.md exists. I can insert this content there in a
  single, small commit.
- Would you like me to:
  - Paste this into project/Bases Settings Update Subsystem.md,
  - Or would you prefer to test manually first and then I commit?
- Also, please confirm: use project/ (existing) rather than projects/ (typo).

#####################################

## Update: Bases Settings Update Subsystem implemented

I implemented the first slice of the subsystem per the plan, in small units and fully typed, with
tests. I have not committed anything yet so you can manually test first.

### What I added

- New modular subsystem under src/bases/settings/:
  - model/types.ts: minimal typed YAML model (resilient to unknown keys)
  - parser/yaml.ts: YAMLCodec interface + JsonLikeCodec (for tests)
  - parser/fenceLocator.ts: find/replace a specific ```base fenced block (by index or id)
  - updater/selectors.ts: select a view by name or index with safe defaults
  - updater/merge.ts: strict, validated merge for columnSize
  - updater/updateBaseFile.ts: update .base files via Vault read/modify and YAMLCodec
  - updater/updateBaseCodeBlock.ts: update base code blocks in .md using fence locator and YAMLCodec
  - id/identity.ts: stable id generator and ensureQueryId helper
  - api/BasesSettingsUpdater.ts: DI-friendly facade

- Exported the API
  - src/bases/index.ts now exports BasesSettingsUpdater and related types

- Unit tests (Jest, passing):
  - test/unit/bases-settings/fence-locator.test.ts
  - test/unit/bases-settings/update-base-file.test.ts

All tests pass:

- Test Suites: 10 passed
- Tests: 26 passed

### How to use in plugin code

- With Obsidian typings and runtime, use Obsidian’s built-in YAML utilities so no extra deps are
  needed.

Example

```ts mode=EXCERPT
import { parseYaml, stringifyYaml, type TFile } from "obsidian";
import { BasesSettingsUpdater } from "@bases";

const yaml = { parse: parseYaml, stringify: stringifyYaml };
const updater = new BasesSettingsUpdater(app.vault, yaml);

// .base file
await updater.updateBaseFile({ file: someBaseFile as TFile, columnSize: { title: 240 } });

// base fenced block (2nd fence, ensure an id is added if missing)
await updater.updateBaseCodeBlock({
  file: note,
  fence: 1,
  ensureId: true,
  columnSize: { status: 180 },
});
```

### Notes on standards compliance

- Architecture: Facade + small modules, SRP, fail-fast errors
- TypeScript: strict types, no any, small functions
- Testing: unit tests for fence locator and file updater; DI-friendly vault/YAML for easy mocking
- Plugin best practices: no reliance on Bases internals; uses stable Vault APIs
- Git workflow: kept changes modular and small; ready for small commits

### Next suggested steps (small, reviewable)

- Add unit tests for updateBaseCodeBlock (by index and by id)
- Add a simple “id-first” fence selector helper to prefer stable ids
- Optionally wire a convenience command that updates the current base (via active file or cursor
  context) and uses this facade

Would you like me to:

- Run a quick manual integration in your test vault (no commit), or
- Open a small PR containing only this subsystem + tests, so you can test in your vault before
  merging?

If you want further granularity, I can split commits by module and by tests.
