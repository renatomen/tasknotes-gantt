/**
 * Unit tests for FocusTaskModal — the fuzzy "focus on task" picker.
 *
 * `obsidian` is mocked (test/__mocks__/obsidian.ts) so the modal can be
 * constructed and its item/render/choose wiring exercised without a real
 * Obsidian app. The dedupe + match-text logic itself is the pure helpers from
 * focusController (tested separately); these tests cover the modal's wiring.
 */

import { describe, it, expect, jest } from '@jest/globals';
import { App } from 'obsidian';
import { FocusTaskModal } from '../../src/bases/FocusTaskModal';
import type { FocusInstance } from '../../src/bases/focusController';

function inst(overrides: Partial<FocusInstance> & { id: string; sourcePath: string }): FocusInstance {
  return { text: overrides.id, start: null, end: null, ...overrides };
}

function makeModal(instances: FocusInstance[], onChoose: (id: string) => void): FocusTaskModal {
  return new FocusTaskModal(new App(), instances, onChoose);
}

describe('FocusTaskModal', () => {
  it('getItems dedupes by sourcePath (multi-parent → one entry, order preserved)', () => {
    const instances = [
      inst({ id: 'a1', sourcePath: 'shared.md', text: 'first' }),
      inst({ id: 'b1', sourcePath: 'other.md', text: 'other' }),
      inst({ id: 'a2', sourcePath: 'shared.md', text: 'dup' }),
    ];
    const modal = makeModal(instances, () => {});

    const items = modal.getItems();

    expect(items).toHaveLength(2);
    expect(items[0]?.id).toBe('a1');
    expect(items[1]?.id).toBe('b1');
  });

  it('getItemText returns the name + source path (for fuzzy matching)', () => {
    const modal = makeModal([], () => {});
    const text = modal.getItemText(inst({ id: 't', sourcePath: 'folder/Task.md', text: 'My Task' }));

    expect(text).toContain('My Task');
    expect(text).toContain('folder/Task.md');
  });

  it('onChooseItem invokes the callback with the instance id', () => {
    const onChoose = jest.fn();
    const modal = makeModal([], onChoose);
    modal.onChooseItem(inst({ id: 'task-42', sourcePath: 'p.md' }));

    expect(onChoose).toHaveBeenCalledWith('task-42');
  });

  it('renderSuggestion renders the task name and the source path', () => {
    const modal = makeModal([], () => {});
    const created: { tag: string; text?: string }[] = [];
    const el = {
      createEl: (tag: string, opts?: { text?: string }) => {
        created.push({ tag, text: opts?.text });
        return {};
      },
    } as unknown as HTMLElement;

    modal.renderSuggestion(
      { item: inst({ id: 'x', sourcePath: 'dir/note.md', text: 'Bar' }), match: { score: 0, matches: [] } },
      el,
    );

    const texts = created.map((c) => c.text);
    expect(texts).toContain('Bar');
    expect(texts).toContain('dir/note.md');
  });
});
