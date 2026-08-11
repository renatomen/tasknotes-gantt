/* global Element */
/**
 * hostBarStamp unit tests.
 *
 * The re-assertion contract has broken twice in production and was provable
 * only by launching real Obsidian, because it lived in a `.svelte` file jest
 * cannot reach. It lives in a plain module now, so the contract is pinned here
 * and the e2e keeps the one claim only real SVAR can make: that SVAR rewrites
 * the class list at all.
 *
 * The env is `node` (no jsdom): a minimal element stand-in and a recording
 * MutationObserver, following the themeResolver precedent, keep the observer
 * callback synchronous — jsdom would deliver it on a microtask and add a flush
 * to every assertion without testing anything more. The fakes RECORD calls
 * rather than only their end state, because the guard that suppresses a
 * redundant `add` is invisible in the resulting class set.
 */

import { describe, it, expect } from '@jest/globals';
import { findHostBar, stampOnHostBar } from '../../src/bases/hostBarStamp';

/** A class list over a real Set that also records every add it is asked for. */
class FakeClassList {
  readonly addCalls: string[] = [];
  private readonly tokens: Set<string>;
  constructor(initial: string[] = []) {
    this.tokens = new Set(initial);
  }
  add(token: string): void {
    this.addCalls.push(token);
    this.tokens.add(token);
  }
  remove(token: string): void {
    this.tokens.delete(token);
  }
  contains(token: string): boolean {
    return this.tokens.has(token);
  }
  /** Stand-in for SVAR re-applying a bar's whole class list from `task.type`. */
  replaceAll(next: string[]): void {
    this.tokens.clear();
    for (const token of next) this.tokens.add(token);
  }
}

interface FakeObserverRecord {
  target: FakeElement;
  options: { attributes?: boolean; attributeFilter?: string[] };
}

class FakeMutationObserver {
  static instances: FakeMutationObserver[] = [];
  observed: FakeObserverRecord[] = [];
  disconnectCount = 0;
  constructor(public readonly callback: () => void) {
    FakeMutationObserver.instances.push(this);
  }
  observe(target: FakeElement, options: FakeObserverRecord['options']): void {
    this.observed.push({ target, options });
  }
  disconnect(): void {
    this.disconnectCount += 1;
  }
}

class FakeElement {
  readonly classList: FakeClassList;
  constructor(
    classes: string[] = [],
    private readonly ancestor: FakeElement | null = null,
  ) {
    this.classList = new FakeClassList(classes);
  }
  /**
   * Matches a CLASS selector only, so the leading dot is load-bearing: passing
   * a bare class name finds nothing, exactly as it would in a real document.
   */
  closest(selector: string): FakeElement | null {
    if (!selector.startsWith('.')) return null;
    const wanted = selector.slice(1);
    if (this.classList.contains(wanted)) return this;
    return this.ancestor?.closest(selector) ?? null;
  }
}

const realObserver = (globalThis as Record<string, unknown>).MutationObserver;

function installObserver(): void {
  FakeMutationObserver.instances = [];
  (globalThis as Record<string, unknown>).MutationObserver = FakeMutationObserver;
}

afterEach(() => {
  (globalThis as Record<string, unknown>).MutationObserver = realObserver;
});

const asElement = (element: FakeElement): Element => element as unknown as Element;

describe('stampOnHostBar', () => {
  it('stamps every token on the host bar when it attaches', () => {
    installObserver();
    const bar = new FakeElement(['wx-bar']);

    stampOnHostBar(asElement(bar), ['datestatus-zigzag-start', 'wx-split']);

    expect(bar.classList.contains('datestatus-zigzag-start')).toBe(true);
    expect(bar.classList.contains('wx-split')).toBe(true);
  });

  it('re-asserts every token from ONE observer after the class list is rewritten', () => {
    installObserver();
    const bar = new FakeElement(['wx-bar']);
    stampOnHostBar(asElement(bar), ['datestatus-zigzag-both', 'wx-split']);

    // SVAR re-applies the whole class list from task.type on an update-task,
    // dropping both imperatively-added classes at once.
    bar.classList.replaceAll(['wx-bar', 'og-status-active']);
    expect(FakeMutationObserver.instances).toHaveLength(1);
    FakeMutationObserver.instances[0]!.callback();

    expect(bar.classList.contains('datestatus-zigzag-both')).toBe(true);
    expect(bar.classList.contains('wx-split')).toBe(true);
    expect(bar.classList.contains('og-status-active')).toBe(true);
  });

  it('watches only the class attribute', () => {
    installObserver();
    const bar = new FakeElement(['wx-bar']);

    stampOnHostBar(asElement(bar), ['wx-split']);

    const record = FakeMutationObserver.instances[0]!.observed[0]!;
    expect(record.target).toBe(bar);
    expect(record.options.attributes).toBe(true);
    // A style filter would re-enter on SVAR's per-frame width rewrites; the
    // geometry that once needed it is gone.
    expect(record.options.attributeFilter).toEqual(['class']);
  });

  it('performs NO add at all for a token already on the bar', () => {
    installObserver();
    const bar = new FakeElement(['wx-bar', 'wx-split']);

    stampOnHostBar(asElement(bar), ['wx-split']);
    FakeMutationObserver.instances[0]!.callback();

    // A real DOMTokenList.add re-serializes the class attribute even when the
    // token is present, queueing another mutation record — so an unguarded add
    // inside the observer feeds itself forever. The end state cannot show that;
    // the absence of the call can.
    expect(bar.classList.addCalls).toEqual([]);
    expect(bar.classList.contains('wx-split')).toBe(true);
  });

  it('disconnects the observer and removes every token on teardown', () => {
    installObserver();
    const bar = new FakeElement(['wx-bar']);
    const teardown = stampOnHostBar(asElement(bar), ['datestatus-zigzag-end', 'wx-split']);

    teardown();

    expect(FakeMutationObserver.instances[0]!.disconnectCount).toBe(1);
    expect(bar.classList.contains('datestatus-zigzag-end')).toBe(false);
    expect(bar.classList.contains('wx-split')).toBe(false);
    expect(bar.classList.contains('wx-bar')).toBe(true);
  });

  it('converges a co-owned token: one owner tears down, the survivor re-asserts it', () => {
    installObserver();
    const bar = new FakeElement(['wx-bar']);
    // A torn bar that is also stretched: the date-status stamp and the
    // ghost-run stamp both own wx-split.
    const tornTeardown = stampOnHostBar(asElement(bar), ['datestatus-zigzag-end', 'wx-split']);
    stampOnHostBar(asElement(bar), ['wx-split']);
    const survivor = FakeMutationObserver.instances[1]!;

    // The torn owner goes away — dates authored — taking the shared class with
    // it, which the survivor still needs for its pieces.
    tornTeardown();
    expect(bar.classList.contains('wx-split')).toBe(false);
    survivor.callback();

    expect(bar.classList.contains('wx-split')).toBe(true);
    expect(bar.classList.contains('datestatus-zigzag-end')).toBe(false);
  });
});

describe('findHostBar', () => {
  it('resolves the host bar from a descendant node', () => {
    const bar = new FakeElement(['wx-bar']);
    const wrapper = new FakeElement(['og-ghost-runs'], bar);

    expect(findHostBar(asElement(wrapper), 'wx-bar')).toBe(bar as unknown as Element);
  });

  it('looks the class up as a CLASS selector, not a bare name', () => {
    // A missing dot would make this a type selector matching nothing, silently
    // disabling every attachment that walks to its host.
    const bar = new FakeElement(['wx-bar']);
    const wrapper = new FakeElement(['og-ghost-runs'], bar);

    expect(wrapper.closest('wx-bar')).toBeNull();
    expect(findHostBar(asElement(wrapper), 'wx-bar')).not.toBeNull();
  });

  it('returns null when the node has no host bar', () => {
    const orphan = new FakeElement(['og-ghost-runs']);

    expect(findHostBar(asElement(orphan), 'wx-bar')).toBeNull();
  });
});
