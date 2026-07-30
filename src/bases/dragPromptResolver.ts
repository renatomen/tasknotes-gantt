import type { CascadeConfirmOpts } from './CascadeConfirmModal';
import type { PromptRequest } from './dragCommitPlan';
import type { PromptAnswer } from './dragExecutionLifecycle';
import type { InferredDragAction } from './inferredDragGate';
import type { InferredDragChoice } from './InferredDragModal';

export interface DragPromptPorts {
  openInferredDragPrompt(): Promise<InferredDragChoice | null>;
  openCascadePrompt(options: CascadeConfirmOpts): Promise<boolean>;
  persistInferredDragMode?(action: InferredDragAction): void;
}

export type DragPromptResolver = (
  prompt: PromptRequest,
) => Promise<PromptAnswer | null>;

function resolveInferredDragChoice(
  ports: DragPromptPorts,
  choice: InferredDragChoice | null,
): PromptAnswer {
  if (choice?.dontAskAgain) {
    // Preference-write failure policy stays at the port: an unstored mode
    // remains `ask`, so the next gesture prompts again without compensation.
    ports.persistInferredDragMode?.(choice.action);
  }
  return {
    kind: 'inferred-drag',
    choice: choice ? { action: choice.action } : null,
  };
}

async function resolveShrinkFitPrompt(
  ports: DragPromptPorts,
  prompt: Extract<PromptRequest, { kind: 'shrink-fit' }>,
): Promise<PromptAnswer> {
  const adjust = await ports.openCascadePrompt({
    title: 'Parent is smaller than its children',
    body:
      `Resizing "${prompt.name}" leaves it smaller than the tasks inside it. ` +
      'Adjust it to wrap its children, or undo the resize.',
    confirmText: 'Adjust to fit',
    cancelText: 'Undo resize',
    rows: [
      {
        name: prompt.name,
        oldStart: prompt.attempted.start,
        oldEnd: prompt.attempted.end,
        newStart: prompt.fit.start,
        newEnd: prompt.fit.end,
      },
    ],
  });
  return {
    kind: 'shrink-fit',
    choice: adjust ? 'adjust' : 'undo',
  };
}

async function resolveExtendPrompt(
  ports: DragPromptPorts,
  prompt: Extract<PromptRequest, { kind: 'extend' }>,
): Promise<PromptAnswer> {
  const approved = await ports.openCascadePrompt({
    title: 'Extend parent dates?',
    body:
      `Moving "${prompt.name}" carries it outside the planned window of the task(s) below. ` +
      `Its new dates are already saved — this only extends them to include it, and can't be undone.`,
    confirmText: 'Extend all',
    rows: prompt.extensions,
  });
  return { kind: 'extend', approved };
}

export function createDragPromptResolver(
  ports: DragPromptPorts,
): DragPromptResolver {
  return async (prompt) => {
    if (prompt.kind === 'inferred-drag') {
      const choice = await ports.openInferredDragPrompt();
      return resolveInferredDragChoice(ports, choice);
    }
    if (prompt.kind === 'shrink-fit') {
      return resolveShrinkFitPrompt(ports, prompt);
    }
    return resolveExtendPrompt(ports, prompt);
  };
}
