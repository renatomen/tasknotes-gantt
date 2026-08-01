/**
 * The per-source promise-chain primitive, driven directly: same-source
 * serialization, independent sources, multi-source fencing, rejection
 * isolation, and tail cleanup semantics.
 */
import { describe, it, expect } from '@jest/globals';
import { createSourceQueues } from '../../src/bases/dragSourceQueues';
import { deferred, flushMicrotasks } from './dragExecutorTestKit';

describe('createSourceQueues', () => {
  it('serializes tasks joined on the same source, in submission order', async () => {
    const queues = createSourceQueues();
    const gate = deferred();
    const log: string[] = [];

    const first = queues.join(['a.md'], () => {
      log.push('first:start');
      return gate.promise.then(() => log.push('first:end')).then(() => undefined);
    });
    const second = queues.join(['a.md'], async () => {
      log.push('second');
    });
    await flushMicrotasks();

    expect(log).toEqual(['first:start']);
    gate.resolve();
    await Promise.all([first, second]);
    expect(log).toEqual(['first:start', 'first:end', 'second']);
  });

  it('lets tasks on distinct sources proceed independently', async () => {
    const queues = createSourceQueues();
    const gate = deferred();
    const log: string[] = [];

    const a = queues.join(['a.md'], () => gate.promise.then(() => log.push('a')).then(() => undefined));
    const b = queues.join(['b.md'], async () => {
      log.push('b');
    });
    await b;

    expect(log).toEqual(['b']);
    gate.resolve();
    await a;
    expect(log).toEqual(['b', 'a']);
  });

  it('fences ALL joined sources: later work on any of them waits for the multi-source task', async () => {
    const queues = createSourceQueues();
    const gate = deferred();
    const log: string[] = [];

    const multi = queues.join(['a.md', 'b.md'], () =>
      gate.promise.then(() => log.push('multi')).then(() => undefined),
    );
    const onA = queues.join(['a.md'], async () => {
      log.push('a');
    });
    const onB = queues.join(['b.md'], async () => {
      log.push('b');
    });
    await flushMicrotasks();

    expect(log).toEqual([]);
    gate.resolve();
    await Promise.all([multi, onA, onB]);
    expect(log).toEqual(['multi', 'a', 'b']);
  });

  it('propagates a rejection to the submitter without breaking the queue behind it', async () => {
    const queues = createSourceQueues();
    const log: string[] = [];

    const failing = queues.join(['a.md'], () => Promise.reject(new Error('boom')));
    const trailing = queues.join(['a.md'], async () => {
      log.push('after');
    });

    await expect(failing).rejects.toThrow('boom');
    await trailing;
    expect(log).toEqual(['after']);
  });
});
