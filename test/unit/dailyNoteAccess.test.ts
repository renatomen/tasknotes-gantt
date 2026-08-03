/**
 * Unit tests for the daily-note accessor behind the timeblock family: the
 * guarded daily-notes core-plugin config read, the strict basename→day parse
 * (Obsidian's bundled moment when present, an ISO fallback for the default
 * format), folder scoping, and derivation-window filtering. All seams are
 * injected, so no Obsidian runtime is required.
 */

import { describe, expect, it } from '@jest/globals';
import {
  DEFAULT_DAILY_NOTE_FORMAT,
  createDayParser,
  dailyNotesConfigTag,
  dailyNoteDayOfPath,
  listDailyNoteTimeblocks,
  readDailyNotesConfig,
  type MomentDayFactory,
} from '../../src/bases/dailyNoteAccess';

/** An app-shaped object exposing the daily-notes internal plugin. */
function appWithDailyNotes(options: {
  enabled?: boolean;
  folder?: unknown;
  format?: unknown;
} | null): unknown {
  return {
    internalPlugins: {
      getPluginById: (id: string) =>
        id === 'daily-notes' && options !== null
          ? {
              enabled: options.enabled ?? true,
              instance: { options: { folder: options.folder, format: options.format } },
            }
          : undefined,
    },
  };
}

/** A strict moment-like stand-in for the `DD.MM.YYYY` custom format. */
const dotFormatMoment: MomentDayFactory = (input, format, strict) => {
  const match =
    strict && format === 'DD.MM.YYYY' ? /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(input) : null;
  return {
    isValid: () => match !== null,
    format: () => (match ? `${match[3]}-${match[2]}-${match[1]}` : 'Invalid date'),
  };
};

describe('readDailyNotesConfig', () => {
  it('reads the folder and format from the enabled daily-notes core plugin', () => {
    const config = readDailyNotesConfig(
      appWithDailyNotes({ folder: 'Journal', format: 'DD.MM.YYYY' }),
    );
    expect(config).toEqual({ folder: 'Journal', format: 'DD.MM.YYYY' });
  });

  it('defaults an unset folder to the vault root and an unset format to ISO', () => {
    const config = readDailyNotesConfig(appWithDailyNotes({}));
    expect(config).toEqual({ folder: '', format: DEFAULT_DAILY_NOTE_FORMAT });
  });

  it('strips a trailing slash from the configured folder', () => {
    const config = readDailyNotesConfig(appWithDailyNotes({ folder: 'Journal/' }));
    expect(config?.folder).toBe('Journal');
  });

  it('returns null when the daily-notes plugin is absent', () => {
    expect(readDailyNotesConfig(appWithDailyNotes(null))).toBeNull();
  });

  it('returns null when the daily-notes plugin is disabled', () => {
    expect(readDailyNotesConfig(appWithDailyNotes({ enabled: false }))).toBeNull();
  });

  it('returns null for an app without the internal-plugins surface', () => {
    expect(readDailyNotesConfig({})).toBeNull();
  });
});

describe('dailyNotesConfigTag', () => {
  it('distinguishes disabled, folder, and format changes', () => {
    expect(dailyNotesConfigTag(null)).not.toBe(
      dailyNotesConfigTag({ folder: '', format: DEFAULT_DAILY_NOTE_FORMAT }),
    );
    expect(dailyNotesConfigTag({ folder: 'Daily', format: DEFAULT_DAILY_NOTE_FORMAT })).not.toBe(
      dailyNotesConfigTag({ folder: 'Journal', format: DEFAULT_DAILY_NOTE_FORMAT }),
    );
    expect(dailyNotesConfigTag({ folder: 'Daily', format: DEFAULT_DAILY_NOTE_FORMAT })).not.toBe(
      dailyNotesConfigTag({ folder: 'Daily', format: 'DD.MM.YYYY' }),
    );
  });
});

describe('createDayParser', () => {
  it('parses the default ISO format without moment', () => {
    const parse = createDayParser(DEFAULT_DAILY_NOTE_FORMAT);
    expect(parse('2026-03-06')).toBe('2026-03-06');
  });

  it('rejects a non-date basename under the default format', () => {
    const parse = createDayParser(DEFAULT_DAILY_NOTE_FORMAT);
    expect(parse('Weekly Standup')).toBeNull();
    expect(parse('2026-03-06 extra')).toBeNull();
  });

  it('parses a custom format strictly through the moment seam', () => {
    const parse = createDayParser('DD.MM.YYYY', dotFormatMoment);
    expect(parse('06.03.2026')).toBe('2026-03-06');
    expect(parse('2026-03-06')).toBeNull();
  });

  it('parses nothing for a custom format when no moment is available (honest degrade)', () => {
    const parse = createDayParser('DD.MM.YYYY');
    expect(parse('06.03.2026')).toBeNull();
  });
});

describe('dailyNoteDayOfPath', () => {
  const parse = createDayParser(DEFAULT_DAILY_NOTE_FORMAT);

  it('resolves a root-folder daily note to its day', () => {
    expect(dailyNoteDayOfPath('2026-03-06.md', '', parse)).toBe('2026-03-06');
  });

  it('resolves a note inside the configured folder and rejects one outside it', () => {
    expect(dailyNoteDayOfPath('Journal/2026-03-06.md', 'Journal', parse)).toBe('2026-03-06');
    expect(dailyNoteDayOfPath('Elsewhere/2026-03-06.md', 'Journal', parse)).toBeNull();
  });

  it('rejects a nested note when the format has no folder segments', () => {
    expect(dailyNoteDayOfPath('Journal/Nested/2026-03-06.md', 'Journal', parse)).toBeNull();
  });

  it('rejects non-markdown files and non-date basenames', () => {
    expect(dailyNoteDayOfPath('2026-03-06.canvas', '', parse)).toBeNull();
    expect(dailyNoteDayOfPath('Tasks/Weekly.md', '', parse)).toBeNull();
  });
});

describe('listDailyNoteTimeblocks', () => {
  const window = { startDate: '2026-03-01', endDateExclusive: '2026-04-01' };
  const timeblocks = [{ id: 'tb-1', startTime: '09:00', endTime: '10:00' }];

  function listingDeps(paths: readonly string[], folder = '') {
    return {
      config: { folder, format: DEFAULT_DAILY_NOTE_FORMAT },
      listMarkdownFiles: () => paths.map((path) => ({ path })),
      frontmatterOf: (path: string) =>
        path.includes('2026-03-06') ? { timeblocks } : { other: true },
      parseDay: createDayParser(DEFAULT_DAILY_NOTE_FORMAT),
    };
  }

  it('lists only daily notes whose day falls inside the derivation window', () => {
    const notes = listDailyNoteTimeblocks(
      listingDeps(['2026-02-27.md', '2026-03-06.md', '2026-04-01.md', 'Tasks/Weekly.md']),
      window,
    );
    expect(notes).toEqual([
      { date: '2026-03-06', path: '2026-03-06.md', timeblocks },
    ]);
  });

  it('carries the raw frontmatter timeblocks value through, absent included', () => {
    const notes = listDailyNoteTimeblocks(
      listingDeps(['2026-03-06.md', '2026-03-07.md']),
      window,
    );
    expect(notes).toHaveLength(2);
    expect(notes[0]!.timeblocks).toEqual(timeblocks);
    expect(notes[1]!.timeblocks).toBeUndefined();
  });

  it('scopes the walk to the configured folder', () => {
    const notes = listDailyNoteTimeblocks(
      listingDeps(['Journal/2026-03-06.md', '2026-03-06.md'], 'Journal'),
      window,
    );
    expect(notes.map((note) => note.path)).toEqual(['Journal/2026-03-06.md']);
  });

  it('returns empty without a daily-notes config', () => {
    const deps = { ...listingDeps(['2026-03-06.md']), config: null };
    expect(listDailyNoteTimeblocks(deps, window)).toEqual([]);
  });
});
