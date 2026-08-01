import { createDragPromptResolver } from '../../src/bases/dragPromptResolver';
import type { InferredDragChoice } from '../../src/bases/InferredDragModal';

describe('createDragPromptResolver', () => {
  it('maps inferred-drag cancellation without persisting a mode', async () => {
    const persistInferredDragMode = jest.fn();
    const resolvePrompt = createDragPromptResolver({
      openInferredDragPrompt: async () => null,
      openCascadePrompt: async () => false,
      persistInferredDragMode,
    });

    const answer = await resolvePrompt({ kind: 'inferred-drag' });

    expect(answer).toEqual({ kind: 'inferred-drag', choice: null });
    expect(persistInferredDragMode).not.toHaveBeenCalled();
  });

  it.each<InferredDragChoice>([
    { action: 'estimate-only', dontAskAgain: false },
    { action: 'estimate-and-dates', dontAskAgain: false },
  ])('maps inferred-drag action $action without persisting it', async (choice) => {
    const persistInferredDragMode = jest.fn();
    const resolvePrompt = createDragPromptResolver({
      openInferredDragPrompt: async () => choice,
      openCascadePrompt: async () => false,
      persistInferredDragMode,
    });

    const answer = await resolvePrompt({ kind: 'inferred-drag' });

    expect(answer).toEqual({
      kind: 'inferred-drag',
      choice: { action: choice.action },
    });
    expect(persistInferredDragMode).not.toHaveBeenCalled();
  });

  it('persists a remembered inferred-drag choice before resolving the answer', async () => {
    const events: string[] = [];
    const resolvePrompt = createDragPromptResolver({
      openInferredDragPrompt: async () => {
        events.push('modal');
        return { action: 'estimate-only', dontAskAgain: true };
      },
      openCascadePrompt: async () => false,
      persistInferredDragMode: (action) => {
        events.push(`persist:${action}`);
      },
    });

    const answer = await resolvePrompt({ kind: 'inferred-drag' });
    events.push(`answer:${answer?.kind}`);

    expect(events).toEqual([
      'modal',
      'persist:estimate-only',
      'answer:inferred-drag',
    ]);
  });

  it('maps a remembered inferred-drag choice when persistence is unavailable', async () => {
    const resolvePrompt = createDragPromptResolver({
      openInferredDragPrompt: async () => ({
        action: 'estimate-and-dates',
        dontAskAgain: true,
      }),
      openCascadePrompt: async () => false,
    });

    const answer = await resolvePrompt({ kind: 'inferred-drag' });

    expect(answer).toEqual({
      kind: 'inferred-drag',
      choice: { action: 'estimate-and-dates' },
    });
  });

  it('settles an inferred answer in the modal continuation turn', async () => {
    const events: string[] = [];
    const modalResult = Promise.resolve<InferredDragChoice>({
      action: 'estimate-only',
      dontAskAgain: false,
    });
    const resolvePrompt = createDragPromptResolver({
      openInferredDragPrompt: () => modalResult,
      openCascadePrompt: async () => false,
    });

    const answerPromise = resolvePrompt({ kind: 'inferred-drag' });
    const modalTurns = modalResult
      .then(() => {
        events.push('modal-settled');
      })
      .then(() => {
        events.push('next-modal-turn');
      });
    const answerTurn = answerPromise.then(() => {
      events.push('answer-settled');
    });

    await Promise.all([modalTurns, answerTurn]);

    expect(events).toEqual([
      'modal-settled',
      'answer-settled',
      'next-modal-turn',
    ]);
  });

  it('opens the shrink-fit prompt with unchanged copy and maps confirmation to adjust', async () => {
    const attempted = {
      start: new Date(2026, 0, 5),
      end: new Date(2026, 0, 7),
    };
    const fit = {
      start: new Date(2026, 0, 3),
      end: new Date(2026, 0, 9),
    };
    const openCascadePrompt = jest.fn(async () => true);
    const resolvePrompt = createDragPromptResolver({
      openInferredDragPrompt: async () => null,
      openCascadePrompt,
    });

    const answer = await resolvePrompt({
      kind: 'shrink-fit',
      name: 'Parent task',
      attempted,
      fit,
    });

    expect(openCascadePrompt).toHaveBeenCalledWith({
      title: 'Parent is smaller than its children',
      body:
        'Resizing "Parent task" leaves it smaller than the tasks inside it. ' +
        'Adjust it to wrap its children, or undo the resize.',
      confirmText: 'Adjust to fit',
      cancelText: 'Undo resize',
      rows: [
        {
          name: 'Parent task',
          oldStart: attempted.start,
          oldEnd: attempted.end,
          newStart: fit.start,
          newEnd: fit.end,
        },
      ],
    });
    expect(answer).toEqual({ kind: 'shrink-fit', choice: 'adjust' });
  });

  it('maps shrink-fit cancellation to undo', async () => {
    const resolvePrompt = createDragPromptResolver({
      openInferredDragPrompt: async () => null,
      openCascadePrompt: async () => false,
    });

    const answer = await resolvePrompt({
      kind: 'shrink-fit',
      name: 'Parent task',
      attempted: {
        start: new Date(2026, 0, 5),
        end: new Date(2026, 0, 7),
      },
      fit: {
        start: new Date(2026, 0, 3),
        end: new Date(2026, 0, 9),
      },
    });

    expect(answer).toEqual({ kind: 'shrink-fit', choice: 'undo' });
  });

  it('settles a cascade answer after the dispatcher adopts the modal branch', async () => {
    const events: string[] = [];
    const modalResult = Promise.resolve(true);
    const resolvePrompt = createDragPromptResolver({
      openInferredDragPrompt: async () => null,
      openCascadePrompt: () => modalResult,
    });

    const answerPromise = resolvePrompt({
      kind: 'shrink-fit',
      name: 'Parent task',
      attempted: {
        start: new Date(2026, 0, 5),
        end: new Date(2026, 0, 7),
      },
      fit: {
        start: new Date(2026, 0, 3),
        end: new Date(2026, 0, 9),
      },
    });
    const modalTurns = modalResult
      .then(() => {
        events.push('modal-settled');
      })
      .then(() => {
        events.push('next-modal-turn');
      });
    const answerTurn = answerPromise.then(() => {
      events.push('answer-settled');
    });

    await Promise.all([modalTurns, answerTurn]);

    expect(events).toEqual([
      'modal-settled',
      'next-modal-turn',
      'answer-settled',
    ]);
  });

  it.each([true, false])(
    'opens the extend prompt with unchanged copy and preserves approval %s',
    async (approved) => {
      const extensions = [
        {
          name: 'Ancestor',
          oldStart: new Date(2026, 0, 1),
          oldEnd: new Date(2026, 0, 8),
          newStart: new Date(2026, 0, 1),
          newEnd: new Date(2026, 0, 10),
        },
      ];
      const openCascadePrompt = jest.fn(async () => approved);
      const resolvePrompt = createDragPromptResolver({
        openInferredDragPrompt: async () => null,
        openCascadePrompt,
      });

      const answer = await resolvePrompt({
        kind: 'extend',
        name: 'Moved task',
        extensions,
      });

      expect(openCascadePrompt).toHaveBeenCalledWith({
        title: 'Extend parent dates?',
        body:
          'Moving "Moved task" carries it outside the planned window of the task(s) below. ' +
          "Its new dates are already saved — this only extends them to include it, and can't be undone.",
        confirmText: 'Extend all',
        rows: extensions,
      });
      expect(answer).toEqual({ kind: 'extend', approved });
    },
  );
});
