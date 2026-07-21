/**
 * The shared calendar-note creator: it scaffolds the right skeleton at a unique
 * Calendars/ path and opens the note. Exercised against a hand-rolled app fake
 * (the vault/workspace surface it touches is small); the routing that turns the
 * opened note into the editor is e2e-tested.
 */
import { describe, expect, it, jest } from '@jest/globals';
import { App, TFile } from 'obsidian';
import { createAndOpenCalendarNote } from '../../src/bases/createCalendarNote';

function fakeApp(existingPaths: string[] = [], createImpl?: () => Promise<TFile>) {
  const paths = new Set(existingPaths);
  const created: { path: string; text: string }[] = [];
  const opened: unknown[] = [];
  const foldersCreated: string[] = [];
  const app = {
    vault: {
      getAbstractFileByPath: (p: string) => (paths.has(p) ? ({ path: p } as unknown) : null),
      createFolder: async (p: string) => {
        foldersCreated.push(p);
        paths.add(p);
      },
      create: async (p: string, text: string) => {
        if (createImpl) return createImpl();
        created.push({ path: p, text });
        const file = new TFile();
        file.path = p;
        return file;
      },
    },
    workspace: {
      getLeaf: () => ({
        openFile: async (file: unknown) => {
          opened.push(file);
        },
      }),
    },
    // The creator waits for the marker to be indexed before opening; a fresh
    // note reads back its marker at once here, so the wait resolves immediately.
    metadataCache: {
      getFileCache: () => ({ frontmatter: { tngantt: 'calendar' } }),
      on: () => ({}),
      offref: () => {},
    },
  };
  return { app: app as unknown as App, created, opened, foldersCreated };
}

describe('createAndOpenCalendarNote', () => {
  it('scaffolds and opens a calendar note with the calendar skeleton', async () => {
    const { app, created, opened } = fakeApp();
    await createAndOpenCalendarNote(app, 'calendar');
    expect(created).toHaveLength(1);
    expect(created[0]!.path).toBe('Calendars/New Calendar.md');
    expect(created[0]!.text).toContain('tngantt: calendar');
    expect(opened).toHaveLength(1);
  });

  it('scaffolds and opens an empty calendar-set note', async () => {
    const { app, created, opened } = fakeApp();
    await createAndOpenCalendarNote(app, 'calendar-set');
    expect(created[0]!.path).toBe('Calendars/New Calendar Set.md');
    expect(created[0]!.text).toContain('tngantt: calendar-set');
    expect(opened).toHaveLength(1);
  });

  it('creates the Calendars folder only when it is absent', async () => {
    const missing = fakeApp();
    await createAndOpenCalendarNote(missing.app, 'calendar');
    expect(missing.foldersCreated).toContain('Calendars');

    const present = fakeApp(['Calendars']);
    await createAndOpenCalendarNote(present.app, 'calendar');
    expect(present.foldersCreated).toHaveLength(0);
  });

  it('waits for the marker to be indexed before opening the note', async () => {
    // getFileCache returns no marker until a metadata 'changed' fires, so the
    // creator must park on the cache listener rather than open too early.
    let indexed = false;
    let changedCb: ((f: { path: string }) => void) | null = null;
    const opened: unknown[] = [];
    const app = {
      vault: {
        getAbstractFileByPath: () => null,
        createFolder: async () => undefined,
        create: async (p: string) => {
          const file = new TFile();
          file.path = p;
          return file;
        },
      },
      workspace: {
        getLeaf: () => ({
          openFile: async (file: unknown) => {
            opened.push(file);
          },
        }),
      },
      metadataCache: {
        getFileCache: () => (indexed ? { frontmatter: { tngantt: 'calendar' } } : null),
        on: (_event: string, cb: (f: { path: string }) => void) => {
          changedCb = cb;
          return {};
        },
        offref: () => {},
      },
    } as unknown as App;

    const promise = createAndOpenCalendarNote(app, 'calendar');
    // Let the create + listener registration settle, then simulate indexing.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(opened).toHaveLength(0); // parked, not yet opened
    indexed = true;
    changedCb?.({ path: 'Calendars/New Calendar.md' });
    await promise;
    expect(opened).toHaveLength(1);
  });

  it('surfaces a Notice and rethrows when creation fails', async () => {
    const { app } = fakeApp([], () => Promise.reject(new Error('disk full')));
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(createAndOpenCalendarNote(app, 'calendar')).rejects.toThrow('disk full');
    jest.restoreAllMocks();
  });
});
