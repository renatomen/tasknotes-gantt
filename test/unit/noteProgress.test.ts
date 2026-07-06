/**
 * resolveNoteProgress: path-based, mode-aware progress read for companion-fetched
 * tasks (relationship-expanded descendants that aren't matched Base entries, so
 * they have no Bases entry). tasknotes → checklist compute; property → frontmatter
 * Progress Property, clamped 0–100.
 */
import { describe, it, expect } from '@jest/globals';
import { App, TFile } from 'obsidian';
import { resolveNoteProgress } from '../../src/datasource/noteProgress';

/**
 * App double: `files` maps path → cache ({ listItems?, frontmatter? }); a path in
 * the map resolves to a TFile instance (so `instanceof TFile` holds), others null.
 */
function makeApp(files: Record<string, { listItems?: unknown[]; frontmatter?: Record<string, unknown> }>): App {
  return {
    vault: {
      getAbstractFileByPath: (p: string) => {
        if (!(p in files)) return null;
        const f = new TFile();
        f.path = p;
        return f;
      },
    },
    metadataCache: {
      getFileCache: (file: TFile) => files[file.path] ?? {},
    },
  } as unknown as App;
}

const topLevel = (task: string) => ({ task, parent: -1 });

describe('resolveNoteProgress', () => {
  it('computes checklist progress in tasknotes mode', () => {
    const app = makeApp({ 'a.md': { listItems: [topLevel('x'), topLevel(' '), topLevel(' ')] } });
    expect(resolveNoteProgress(app, 'a.md', 'tasknotes', null)).toBe(33);
  });

  it('computes checklist progress when mode is undefined (defaults to tasknotes)', () => {
    const app = makeApp({ 'a.md': { listItems: [topLevel('x'), topLevel('x')] } });
    expect(resolveNoteProgress(app, 'a.md', undefined, null)).toBe(100);
  });

  it('reads the frontmatter Progress Property in property mode', () => {
    const app = makeApp({ 'a.md': { frontmatter: { pct: 42 } } });
    expect(resolveNoteProgress(app, 'a.md', 'property', 'pct')).toBe(42);
  });

  it('clamps a property value to 0–100 and coerces numeric strings', () => {
    const app = makeApp({ 'hi.md': { frontmatter: { pct: 150 } }, 'lo.md': { frontmatter: { pct: -5 } }, 's.md': { frontmatter: { pct: '73' } } });
    expect(resolveNoteProgress(app, 'hi.md', 'property', 'pct')).toBe(100);
    expect(resolveNoteProgress(app, 'lo.md', 'property', 'pct')).toBe(0);
    expect(resolveNoteProgress(app, 's.md', 'property', 'pct')).toBe(73);
  });

  it('returns null in property mode when the property is missing or non-numeric', () => {
    const app = makeApp({ 'a.md': { frontmatter: { other: 1 } }, 'b.md': { frontmatter: { pct: 'nope' } } });
    expect(resolveNoteProgress(app, 'a.md', 'property', 'pct')).toBeNull();
    expect(resolveNoteProgress(app, 'b.md', 'property', 'pct')).toBeNull();
  });

  it('returns null in property mode when no property key is configured', () => {
    const app = makeApp({ 'a.md': { frontmatter: { pct: 42 } } });
    expect(resolveNoteProgress(app, 'a.md', 'property', null)).toBeNull();
  });

  it('returns null when the file is not found', () => {
    const app = makeApp({});
    expect(resolveNoteProgress(app, 'missing.md', 'tasknotes', null)).toBeNull();
    expect(resolveNoteProgress(app, 'missing.md', 'property', 'pct')).toBeNull();
  });
});
