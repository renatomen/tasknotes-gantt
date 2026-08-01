// Jest stub for `svelte/store` in unit tests: a minimal writable/get pair so a
// Node unit test that transitively imports view wiring (e.g. bases/register.ts)
// can load without Svelte's ESM entry. Store reactivity is e2e-tested.
export function writable(initial) {
  let value = initial;
  const subscribers = new Set();
  return {
    set(next) {
      value = next;
      for (const run of subscribers) run(value);
    },
    update(fn) {
      this.set(fn(value));
    },
    subscribe(run) {
      subscribers.add(run);
      run(value);
      return () => subscribers.delete(run);
    },
  };
}

export function get(store) {
  let value;
  store.subscribe((current) => {
    value = current;
  })();
  return value;
}
