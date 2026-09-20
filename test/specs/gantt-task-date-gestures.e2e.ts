import { browser, expect } from '@wdio/globals';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { waitUntilOrExplain } from './helpers/waitReady';
import { performGanttGesture } from '../helpers/ganttGesture';

const baseName = 'Report.base';


async function openBase(): Promise<void> {
  await browser.executeObsidian(async ({ app }) => {
    app.workspace.getLeavesOfType('markdown').forEach(leaf => leaf.detach());
    let leaf = app.workspace.getLeavesOfType('bases')[0];
    if (!leaf) {
      const file = app.vault.getFileByPath('Report.base');
      if (!file) throw new Error('Missing report fixture');
      leaf = app.workspace.getLeaf(true);
      await leaf.openFile(file);
    }
    app.workspace.setActiveLeaf(leaf, { focus: true });
    app.workspace.revealLeaf(leaf);
  });
  await waitUntilOrExplain(async () => {
    await browser.executeObsidian(({ app }) => {
      const leaf = app.workspace.getLeavesOfType('bases')[0];
      if (leaf) app.workspace.setActiveLeaf(leaf, { focus: true });
    });
    return browser.execute(() => document.querySelectorAll('.og-bases-gantt .wx-bars > .wx-bar').length >= 3);
  }, () => 'Report Base must render its three tasks', { timeout: 30000 });
}

async function observe(name?: string) {
  return browser.executeObsidian(async ({ app }, name?: string) => {
    const leaf = app.workspace.getLeavesOfType('bases')[0];
    if (leaf) app.workspace.setActiveLeaf(leaf, { focus: true });
    const names = name ? [name] : ['Approval', 'Create Deviation', 'Parent'];
    const root = document.querySelector('.og-bases-gantt');
    const rows = root?.querySelectorAll('.wx-scale .wx-row');
    const cells = Array.from(rows?.[rows.length - 1]?.querySelectorAll('.wx-cell') ?? []).map(cell => ({
      text: cell.textContent, x: cell.getBoundingClientRect().left, width: cell.getBoundingClientRect().width,
    }));
    const bars = Array.from(root?.querySelectorAll('.wx-bars > .wx-bar') ?? []).map(bar => ({
      id: bar.getAttribute('data-id'), x: bar.getBoundingClientRect().left, width: bar.getBoundingClientRect().width,
      text: bar.textContent,
    }));
    const notes = await Promise.all(names.map(async name => {
      const file = app.vault.getFileByPath(`${name}.md`);
      if (!file) throw new Error(`Missing ${name}`);
      return { name, text: await app.vault.read(file) };
    }));
    const grid = Array.from(root?.querySelectorAll('[data-row-id][data-col-id]') ?? []).map(cell => ({
      row: cell.getAttribute('data-row-id')?.replace(/^:/, ''),
      column: cell.getAttribute('data-col-id')?.replace(/^:/, ''), text: cell.textContent?.trim(),
    }));
    return { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, offset: new Date(2026, 8, 20).getTimezoneOffset(), cells, bars, notes, grid };
  }, name);
}

async function expectDates(name: string, first: number, last: number): Promise<void> {
  let observed = '';
  await waitUntilOrExplain(async () => {
    const state = await observe(name);
    observed = JSON.stringify(state);
    const firstCell = state.cells.find(cell => cell.text === String(first));
    const bars = state.bars.filter(bar => bar.id === `:${name}.md` || bar.id?.startsWith(`:${name}.md#`));
    const note = state.notes.find(note => note.name === name)?.text ?? '';
    const gridDate = (column: string) => state.grid.find(cell => cell.row === `${name}.md` && cell.column === column)?.text;
    return !!firstCell && bars.length === (name === 'Create Deviation' ? 2 : 1) &&
      bars.every(bar => Math.abs(bar.x - firstCell.x) < 1 && Math.abs(bar.width - (last - first + 1) * firstCell.width) < 1) &&
      note.includes(`scheduled: 2026-09-${first}`) && note.includes(`due: 2026-09-${last}`) &&
      gridDate('note.scheduled') === `${first}/09/2026` && gridDate('note.due') === `${last}/09/2026`;
  }, () => `${name}: expected saved and rendered September ${first}–${last}; observed ${observed}`, { timeout: 15000, interval: 100 });
}

describe('Task calendar dates in PDT', () => {
  before(async () => {
    const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'og-311-'));
    fs.writeFileSync(path.join(vault, baseName), `filters:\n  and:\n    - 'file.hasTag("report311")'\nviews:\n  - type: obsidianGantt\n    name: Report\n    tngantt_startDateProperty: note.scheduled\n    tngantt_endDateProperty: note.due\n    tngantt_parentProperty: note.projects\n    tngantt_parentDateCascade: auto\n    tngantt_defaultScale: day\n    tngantt_maxHeight: 900\n    order:\n      - file.name\n      - note.scheduled\n      - note.due\n`);
    for (const [name, start, end, parent] of [
      ['Approval', '10', '11', ''], ['Create Deviation', '21', '23', 'Parent'], ['Parent', '18', '26', ''],
    ]) {
      fs.writeFileSync(path.join(vault, `${name}.md`), `---\ntags: [task, report311]\nstatus: open\nscheduled: 2026-09-${start}\ndue: 2026-09-${end}\n${parent ? `projects: ["[[${parent}]]"]\n` : ''}---\n# ${name}\n`);
    }
    await browser.reloadObsidian({ vault, plugins: ['tasknotes-gantt', 'tasknotes'] });
    await browser.sendCommand('Emulation.setTimezoneOverride', { timezoneId: 'America/Los_Angeles' });
    await browser.execute(() => {
      (window as unknown as { __tnGanttDebug: { localeOverride: string } }).__tnGanttDebug = { localeOverride: 'en-GB' };
    });
    const runtime = await browser.execute(() => ({ zone: Intl.DateTimeFormat().resolvedOptions().timeZone, offset: new Date(2026, 8, 20).getTimezoneOffset() }));
    expect(runtime).toEqual({ zone: 'America/Los_Angeles', offset: 420 });
    await browser.executeObsidian(async ({ app }) => {
      const plugins = (app as unknown as { internalPlugins: { getPluginById: (id: string) => { enabled: boolean; enable: (options: object) => Promise<void> } } }).internalPlugins;
      const bases = plugins.getPluginById('bases');
      if (!bases.enabled) await bases.enable({ reloadApp: false });
    });
    await openBase();
    let previous = '';
    await waitUntilOrExplain(async () => {
      const current = await browser.execute(() => JSON.stringify(Array.from(document.querySelectorAll('.og-bases-gantt .wx-bars > .wx-bar')).map(bar => {
        const rect = bar.getBoundingClientRect();
        return [bar.getAttribute('data-id'), rect.left, rect.width];
      })));
      const stable = current === previous;
      previous = current;
      return stable;
    }, () => `Report bars must settle; observed ${previous}`, { timeout: 15000, interval: 250 });

  });

  it('keeps authored dates, parent and child bars, and saved gesture dates aligned after reopen', async () => {
    await expectDates('Approval', 10, 11);
    await expectDates('Parent', 18, 26);
    await expectDates('Create Deviation', 21, 23);

    await browser.execute(performGanttGesture, { notePath: 'Create Deviation.md', edge: 'move' as const, days: -1 });
    await expectDates('Create Deviation', 20, 22);
    await browser.execute(performGanttGesture, { notePath: 'Create Deviation.md', edge: 'start' as const, days: 1 });
    await expectDates('Create Deviation', 21, 22);
    await browser.execute(performGanttGesture, { notePath: 'Create Deviation.md', edge: 'end' as const, days: 1 });
    await expectDates('Create Deviation', 21, 23);

    await browser.executeObsidian(({ app }) => app.workspace.getLeavesOfType('bases').forEach(leaf => leaf.detach()));
    await openBase();
    await expectDates('Create Deviation', 21, 23);
    await expectDates('Approval', 10, 11);
    await expectDates('Parent', 18, 26);
    expect((await observe()).timezone).toBe('America/Los_Angeles');
  });
});
