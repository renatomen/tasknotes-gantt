// Jest stub for the `svelte` runtime in unit tests: mount/unmount are no-ops
// (component rendering is e2e-tested). Keeps a Node unit test that transitively
// imports a view from loading Svelte's ESM entry.
export function mount(): object {
  return {};
}
export function unmount(): void {}
export function tick(): Promise<void> {
  return Promise.resolve();
}
