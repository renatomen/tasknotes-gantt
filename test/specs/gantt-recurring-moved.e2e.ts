import { browser, expect } from '@wdio/globals';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { waitUntilOrExplain } from './helpers/waitReady';
import { performGanttGesture } from '../helpers/ganttGesture';

/**
 * A moved occurrence renders once, and dragging a recurring bar records the
 * move through TaskNotes. Drags run with recurring pieces hidden: an occupancy
 * envelope refuses the gesture. The drag task keeps a recorded day inside its
 * scheduled-to-due span before and after the move, so the bar stays the
 * authored span.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixtureVault = path.resolve(__dirname, '../vaults/gantt-recurring-moved');
const BASE = 'Moved.base';
const MOVED = 'Moved.md';
const DRAG = 'Drag.md';

async function frontBase(): Promise<void> {
  await browser.executeObsidian(async ({ app }, basePath) => {
    const ws = app.workspace as unknown as {
      iterateAllLeaves: (cb: (leaf: { view?: { getViewType?: () => string }; detach?: () => void }) => void) => void;
      getLeavesOfType: (type: string) => unknown[];
      getLeaf: (newLeaf?: boolean) => { openFile: (file: unknown) => Promise<void> };
      setActiveLeaf: (leaf: unknown, opts?: { focus?: boolean }) => void;
      revealLeaf: (leaf: unknown) => void;
    };
    const markdown: Array<{ detach?: () => void }> = [];
    ws.iterateAllLeaves((leaf) => {
      if (leaf.view?.getViewType?.() === 'markdown') markdown.push(leaf);
    });
    markdown.forEach((leaf) => leaf.detach?.());
    let baseLeaf = ws.getLeavesOfType('bases')[0];
    if (!baseLeaf) {
      const file = app.vault.getAbstractFileByPath(basePath);
      if (!file) return;
      const leaf = ws.getLeaf(false);
      await leaf.openFile(file as never);
      baseLeaf = leaf;
    }
    ws.setActiveLeaf(baseLeaf, { focus: true });
    ws.revealLeaf(baseLeaf);
  }, BASE);
}

async function waitForGantt(): Promise<void> {
  await waitUntilOrExplain(async () => {
    await frontBase();
    return browser.execute(() => !!document.querySelector('.og-bases-gantt .wx-bar'));
  }, () => 'the moved-occurrence base did not mount a bar', { timeout: 90000 });
}

async function setShowRecurring(on: boolean): Promise<void> {
  await waitForGantt();
  const fired = await browser.executeObsidian(({ app }, value) => {
    const ws = app.workspace as unknown as {
      getLeavesOfType: (type: string) => Array<{ view?: Record<string, unknown> }>;
    };
    const skip = new Set(['app', 'vault', 'workspace', 'containerEl', 'contentEl', 'leaf']);
    const seen = new Set<unknown>();
    let set = false;
    let configChanged = false;
    const visit = (obj: unknown, depth: number): void => {
      if (!obj || typeof obj !== 'object' || seen.has(obj) || depth > 6) return;
      seen.add(obj);
      const rec = obj as Record<string, unknown>;
      const config = rec.config as { set?: (key: string, next: unknown) => void } | undefined;
      if (!set && config && typeof config.set === 'function' && typeof rec.onDataUpdated === 'function') {
        config.set('tngantt_showRecurring', value);
        set = true;
      }
      if (!configChanged && typeof rec.onConfigChanged === 'function') {
        try {
          (rec.onConfigChanged as () => void).call(rec);
          configChanged = true;
        } catch {
          /* a view that cannot reload is reported by the return value */
        }
      }
      for (const key of Object.keys(rec)) {
        if (skip.has(key)) continue;
        try {
          const child = rec[key];
          if (child && typeof child === 'object') visit(child, depth + 1);
        } catch {
          /* getters that throw are not the view */
        }
      }
    };
    for (const leaf of ws.getLeavesOfType('bases')) if (leaf.view) visit(leaf.view, 0);
    return { set, configChanged };
  }, on);
  expect(fired.set && fired.configChanged).toBe(true);
}

async function noteText(name: string): Promise<string> {
  return browser.executeObsidian(async ({ app }, note) => {
    const file = app.vault.getAbstractFileByPath(note);
    if (!file) return '<missing>';
    return app.vault.read(file as never);
  }, name);
}

async function barState(name: string): Promise<{ found: boolean; envelope: boolean }> {
  return browser.execute((note) => {
    const bar = Array.from(document.querySelectorAll('.og-bases-gantt .wx-bar')).find((element) =>
      (element.getAttribute('data-id') ?? '').endsWith(note),
    ) as HTMLElement | undefined;
    if (!bar) return { found: false, envelope: false };
    return { found: true, envelope: bar.classList.contains('wx-split') };
  }, name);
}

/** How many occurrence pieces of one state, or of any state, sit on this day. */
async function piecesOn(name: string, day: string, state: 'next' | 'any'): Promise<number> {
  return browser.execute((note, iso, wanted) => {
    const bar = Array.from(document.querySelectorAll('.og-bases-gantt .wx-bar')).find((element) =>
      (element.getAttribute('data-id') ?? '').endsWith(note),
    );
    if (!bar) return 0;
    const selector = wanted === 'next' ? '.og-instance-next' : '.og-instance';
    return Array.from(bar.querySelectorAll(selector)).filter((piece) =>
      piece.getAttribute('data-og-instance') === iso,
    ).length;
  }, name, day, state);
}

describe('moved recurring occurrences', () => {
  before(async () => {
    const vault = path.join(os.tmpdir(), 'og-gantt-recurring-moved-e2e');
    fs.rmSync(vault, { recursive: true, force: true });
    fs.cpSync(fixtureVault, vault, { recursive: true });
    await browser.reloadObsidian({ vault, plugins: ['tasknotes-gantt', 'tasknotes'] });
    await browser.executeObsidian(async ({ app }) => {
      const plugins = (app as unknown as {
        internalPlugins?: {
          getPluginById?: (id: string) => { enabled?: boolean; enable?: (opts?: unknown) => unknown } | undefined;
          enablePluginAndSave?: (id: string) => unknown;
        };
      }).internalPlugins;
      const bases = plugins?.getPluginById?.('bases');
      if (bases && !bases.enabled) {
        await (plugins?.enablePluginAndSave?.('bases') ?? bases.enable?.({ reloadApp: false }));
      }
    });
    await browser.waitUntil(
      async () => browser.executeObsidian(async ({ app }) => {
        const tasknotes = (app as unknown as {
          plugins?: { getPlugin?: (id: string) => { api?: { lifecycle?: { ready?: () => Promise<void> } } } | undefined };
        }).plugins?.getPlugin?.('tasknotes');
        if (!tasknotes?.api) return false;
        try {
          await tasknotes.api.lifecycle?.ready?.();
          return true;
        } catch {
          return false;
        }
      }),
      { timeout: 60000, timeoutMsg: 'TaskNotes API did not become ready' },
    );
  });

  it('draws a moved occurrence on its new day and not on its rule day', async () => {
    await waitForGantt();
    await setShowRecurring(true);
    let onNewDay = -1;
    let onRuleDay = -1;
    await waitUntilOrExplain(async () => {
      await frontBase();
      onNewDay = await piecesOn(MOVED, '2026-03-12', 'next');
      onRuleDay = await piecesOn(MOVED, '2026-03-18', 'any');
      return onNewDay === 1 && onRuleDay === 0;
    }, () => `moved next pieces: 12 March=${onNewDay}, 18 March=${onRuleDay}`, { timeout: 90000 });
    expect(onNewDay).toBe(1);
    expect(onRuleDay).toBe(0);
  });

  it('records a bar drag as a moved occurrence and clears it on the way back', async () => {
    await setShowRecurring(false);
    let bar = { found: false, envelope: true };
    await waitUntilOrExplain(async () => {
      await frontBase();
      bar = await barState(DRAG);
      return bar.found && !bar.envelope;
    }, () => `drag bar was not an authored span: ${JSON.stringify(bar)}`, { timeout: 30000 });

    await browser.execute((note) => {
      const bar = Array.from(document.querySelectorAll('.og-bases-gantt .wx-bars > .wx-bar')).find((element) =>
        (element.getAttribute('data-id') ?? '').endsWith(note),
      );
      bar?.scrollIntoView({ block: 'center', inline: 'center' });
    }, DRAG);
    await browser.execute(performGanttGesture, { notePath: DRAG, edge: 'move' as const, days: 2 });
    let text = '';
    await waitUntilOrExplain(async () => {
      text = await noteText(DRAG);
      return text.includes('scheduled: 2026-03-16')
        && text.includes('due: 2026-03-17')
        && text.includes('recurrence_original_date: 2026-03-14');
    }, () => `drag did not record the move; note was:\n${text}`, { timeout: 20000 });

    await setShowRecurring(true);
    let onNewDay = -1;
    let onOldDay = -1;
    await waitUntilOrExplain(async () => {
      await frontBase();
      onNewDay = await piecesOn(DRAG, '2026-03-16', 'next');
      onOldDay = await piecesOn(DRAG, '2026-03-14', 'any');
      return onNewDay === 1 && onOldDay === 0;
    }, () => `dragged next pieces: 16 March=${onNewDay}, 14 March=${onOldDay}`, { timeout: 20000 });

    await setShowRecurring(false);
    await waitUntilOrExplain(async () => {
      await frontBase();
      bar = await barState(DRAG);
      return bar.found && !bar.envelope;
    }, () => `return drag bar was not an authored span: ${JSON.stringify(bar)}`, { timeout: 20000 });

    await browser.execute(performGanttGesture, { notePath: DRAG, edge: 'move' as const, days: -2 });
    await waitUntilOrExplain(async () => {
      text = await noteText(DRAG);
      return text.includes('scheduled: 2026-03-14')
        && text.includes('due: 2026-03-15')
        && !text.includes('recurrence_original_date');
    }, () => `dragging back did not clear the move; note was:\n${text}`, { timeout: 20000 });

    await setShowRecurring(true);
    let restored = -1;
    await waitUntilOrExplain(async () => {
      await frontBase();
      restored = await piecesOn(DRAG, '2026-03-14', 'next');
      return restored === 1;
    }, () => `the next piece did not return to 14 March (saw ${restored})`, { timeout: 20000 });
  });
});
