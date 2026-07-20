// Jest stub for the `svelte` runtime in unit tests: mount/unmount are no-ops
// (component rendering is e2e-tested). Keeps a Node unit test that transitively
// imports a view from loading Svelte's ESM entry.
export function mount() {
  return {};
}
export function unmount() {}
export function tick() {
  return Promise.resolve();
}
