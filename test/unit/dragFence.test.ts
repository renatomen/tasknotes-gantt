import { fenceWithinDeadline } from '../../src/bases/dragFence';
import { createSourceQueues } from '../../src/bases/dragSourceQueues';

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function hungSource(queues: ReturnType<typeof createSourceQueues>, source: string): void {
  void queues.join([source], () => new Promise<void>(() => {}));
}

describe('fenceWithinDeadline', () => {
  it('a successor fence proceeds while an abandoned round\'s stale hold is still queued', async () => {
    const queues = createSourceQueues();
    hungSource(queues, 'hung.md');
    const firstBody = jest.fn(async () => {});

    await fenceWithinDeadline({
      queues,
      sources: ['hung.md', 'free.md'],
      deadlineMs: 20,
      body: firstBody,
    });
    expect(firstBody).not.toHaveBeenCalled();

    const secondBody = jest.fn(async () => {});
    await fenceWithinDeadline({ queues, sources: ['free.md'], deadlineMs: 1000, body: secondBody });

    expect(secondBody).toHaveBeenCalledTimes(1);
  });

  it('runs the body exactly once for duplicated sources instead of abandoning every round', async () => {
    const queues = createSourceQueues();
    const body = jest.fn(async () => {});

    await fenceWithinDeadline({
      queues,
      sources: ['a.md', 'a.md'],
      deadlineMs: 1000,
      body,
    });

    expect(body).toHaveBeenCalledTimes(1);
  });

  it('a synchronously throwing body rejects the caller and releases every fenced queue', async () => {
    const queues = createSourceQueues();

    await expect(
      fenceWithinDeadline({
        queues,
        sources: ['a.md', 'b.md'],
        deadlineMs: 1000,
        body: () => {
          throw new Error('broken body');
        },
      }),
    ).rejects.toThrow('broken body');

    const after = jest.fn(async () => {});
    await queues.join(['a.md', 'b.md'], after);
    await flush();
    expect(after).toHaveBeenCalledTimes(1);
  });
});
