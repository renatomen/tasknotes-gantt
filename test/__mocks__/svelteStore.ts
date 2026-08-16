// Jest stub for `svelte/store` in unit tests: a minimal writable/get pair so a
// Node unit test that transitively imports view wiring (e.g. bases/register.ts)
// can load without Svelte's ESM entry. Store reactivity is e2e-tested.
type Subscriber<T> = (value: T) => void;

export interface WritableStub<T> {
  set(next: T): void;
  update(fn: (value: T) => T): void;
  subscribe(run: Subscriber<T>): () => void;
}

export function writable<T>(initial: T): WritableStub<T> {
  let value = initial;
  const subscribers = new Set<Subscriber<T>>();
  return {
    set(next: T): void {
      value = next;
      for (const run of subscribers) run(value);
    },
    update(fn: (value: T) => T): void {
      this.set(fn(value));
    },
    subscribe(run: Subscriber<T>): () => void {
      subscribers.add(run);
      run(value);
      return () => {
        subscribers.delete(run);
      };
    },
  };
}

export function get<T>(store: { subscribe(run: Subscriber<T>): () => void }): T {
  let value!: T;
  store.subscribe((current) => {
    value = current;
  })();
  return value;
}
