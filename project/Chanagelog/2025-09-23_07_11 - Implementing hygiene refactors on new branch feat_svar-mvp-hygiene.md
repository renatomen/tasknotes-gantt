# Implementing hygiene refactors on new branch: feat/svar-mvp-hygiene

Plan:

- Create a new branch feat/svar-mvp-hygiene.
- Add ErrorBoundary and mountReact helpers; create GanttContainer component (moved from GanttMvp).
- Update basesGanttViewFactory to use the helpers and new component.
- Add stub interfaces FieldMappings and DataSourceAdapter for Phase 2.
- Update package.json description; add .eslintignore to ignore project/.
- Remove old GanttMvp file.
- Run type-checks, unit tests, and build to validate.

Executing branch creation, file additions, edits, and validation.

## Refactor complete on new branch: feat/svar-mvp-hygiene

I implemented the agreed hygiene refactors without changing runtime behavior, created a new branch
locally, and validated via type-checks, unit tests, and build. No commits were made, per your
preference to verify in the test vault first.

### What changed

- Added React robustness and reuse
  - Error boundary component for safe failure handling
  - Reusable mount helper to centralize React mount/unmount

- Renamed MVP component to align with planned architecture
  - Moved/renamed GanttMvp → GanttContainer (same dummy data)
  - Updated Bases view factory to use ErrorBoundary + mount helper

- Prepared for Phase 2
  - Introduced stubs for FieldMappings and DataSourceAdapter interfaces (no functional changes)

- Metadata and lint
  - Updated package description to reflect SVAR React Gantt
  - Added .eslintignore for project/ as requested

### Files added

- src/ui/ErrorBoundary.tsx
- src/ui/mountReact.tsx
- src/components/GanttContainer.tsx
- src/mapping/FieldMappings.ts
- src/data-sources/DataSourceAdapter.ts
- .eslintignore

Example excerpts

- ErrorBoundary:

```tsx path=src/ui/ErrorBoundary.tsx mode=EXCERPT
export class ErrorBoundary extends React.Component<any, { hasError: boolean }> {
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    return this.state?.hasError ? (
      <div className="ogantt-error">Render error in Gantt view</div>
    ) : (
      this.props.children
    );
  }
}
```

- mountReact:

```tsx path=src/ui/mountReact.tsx mode=EXCERPT
export function mountReact(el: HTMLElement, node: React.ReactNode): () => void {
  const root = createRoot(el);
  root.render(node);
  return () => {
    try {
      root.unmount();
    } catch {}
  };
}
```

- Factory integration:

```ts path=src/views/basesGanttViewFactory.ts mode=EXCERPT
unmount = mountReact(
  hostEl,
  React.createElement(ErrorBoundary, null, React.createElement(GanttContainer))
);
```

### Files updated

- src/views/basesGanttViewFactory.ts
- package.json description updated
- Removed: src/ui/GanttMvp.tsx

### Validation

- Branch created locally
  - git checkout -b feat/svar-mvp-hygiene

- Type-checks, unit tests, and build
  - npm run typecheck → OK
  - npm test → OK (existing unit tests pass)
  - npm run build → OK; postbuild installed to your test vault path reported in scripts

Key log lines:

- [build] Done
- [install] Installed plugin to ... obsidian-gantt-test-vault\.obsidian\plugins\obsidian-gantt

No commits were made (in line with your preference to test in the vault first).

## What you can verify now

- Open your test vault and ensure the Bases view “Gantt (OG)” continues to render the dummy timeline
  as before.
- Intentionally trigger an error inside the component (optional) to see the ErrorBoundary message,
  if you want to test robustness.

## Suggested next steps

- If the vault verification looks good, I can:
  - Make atomic commits on feat/svar-mvp-hygiene and open a PR for your review.
  - Or keep the branch uncommitted until you give the green light.

- Next branch proposal (after this PR is merged/approved):
  - feat/phase2-field-mapping-and-adapter
    - Add mapping/DataMapper.ts and validation engine based on PRD FieldMappings
    - Introduce Bases adapter skeleton (no real data yet)
    - Unit tests for mapping/validation

Would you like me to commit these changes on feat/svar-mvp-hygiene and open a PR, or would you
prefer to test in your vault first and then signal me to commit?
