/**
 * Daily-note access behind the timeblock calendar-item family.
 *
 * Resolves which vault notes are daily notes from the daily-notes core
 * plugin's own folder/format options (guarded — the plugin off or absent means
 * no daily notes, never a throw) and lists the notes whose day falls inside a
 * derivation window, carrying their raw frontmatter `timeblocks` value for the
 * timeblock source to validate per block.
 *
 * The basename→day parse is strict against the configured format via
 * Obsidian's bundled moment (`window.moment`, always present in the real
 * runtime). Without a moment surface only the default ISO format parses — a
 * custom format then honestly yields no daily notes rather than guessing. A
 * format containing folder segments (e.g. `YYYY/MM/YYYY-MM-DD`) parses
 * naturally because the whole folder-relative path is the candidate.
 *
 * Pure core + thin wiring: config read, parser, and listing take injected
 * seams so every rule is unit-testable without Obsidian; only
 * {@link createDailyNoteAccess} touches the live app (metadata cache reads,
 * never the Bases value system).
 *
 * @module bases/dailyNoteAccess
 */

import { TFile, type App } from 'obsidian';
import type {
  CalendarDerivationWindow,
  DailyNoteTimeblocks,
  LocalDay,
} from '../datasource/calendarItems';

/** The daily-notes core plugin options this accessor consumes. */
export interface DailyNotesConfig {
  /** Vault-relative folder holding daily notes; `''` = vault root. */
  folder: string;
  /** Moment filename format the note names follow. */
  format: string;
}

export const DEFAULT_DAILY_NOTE_FORMAT = 'YYYY-MM-DD';

const DAILY_NOTES_PLUGIN_ID = 'daily-notes';

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * The enabled daily-notes core plugin's folder/format, or `null` when the
 * plugin is absent or disabled (→ no daily notes exist for this vault).
 * Unset options adopt the plugin's own defaults: vault root, ISO format.
 */
export function readDailyNotesConfig(app: unknown): DailyNotesConfig | null {
  const internalPlugins = asRecord(asRecord(app)?.internalPlugins);
  const getPluginById = internalPlugins?.getPluginById;
  if (typeof getPluginById !== 'function') return null;
  let plugin: Record<string, unknown> | undefined;
  try {
    plugin = asRecord(getPluginById.call(internalPlugins, DAILY_NOTES_PLUGIN_ID));
  } catch {
    return null;
  }
  if (!plugin || plugin.enabled !== true) return null;
  const options = asRecord(asRecord(plugin.instance)?.options);
  const folder = typeof options?.folder === 'string' ? options.folder.replace(/\/+$/, '') : '';
  const format =
    typeof options?.format === 'string' && options.format.trim() !== ''
      ? options.format
      : DEFAULT_DAILY_NOTE_FORMAT;
  return { folder, format };
}

/** Strict candidate→day parse for the configured format; `null` = not a daily note. */
export type DayParser = (candidate: string) => LocalDay | null;

/** The moment slice the parser needs (Obsidian bundles the real thing on `window`). */
export interface MomentDayFactory {
  (input: string, format: string, strict: boolean): {
    isValid(): boolean;
    format(outputFormat: string): string;
  };
}

const ISO_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Build the strict day parser for one daily-note format. With a moment
 * surface every format parses strictly; without one only the default ISO
 * format is recognised (pattern match) — a custom format degrades to
 * "no daily notes" rather than a lossy hand-rolled parse.
 */
export function createDayParser(format: string, momentLike?: MomentDayFactory): DayParser {
  if (momentLike) {
    return (candidate) => {
      const parsed = momentLike(candidate, format, true);
      return parsed.isValid() ? parsed.format(DEFAULT_DAILY_NOTE_FORMAT) : null;
    };
  }
  if (format === DEFAULT_DAILY_NOTE_FORMAT) {
    return (candidate) => (ISO_DAY_PATTERN.test(candidate) ? candidate : null);
  }
  return () => null;
}

/**
 * The calendar day a vault path denotes as a daily note, or `null` when the
 * path lies outside the configured folder, is not markdown, or its
 * folder-relative name fails the strict format parse.
 */
export function dailyNoteDayOfPath(
  path: string,
  folder: string,
  parseDay: DayParser,
): LocalDay | null {
  if (!path.endsWith('.md')) return null;
  const prefix = folder === '' ? '' : `${folder}/`;
  if (!path.startsWith(prefix)) return null;
  const candidate = path.slice(prefix.length, -'.md'.length);
  return parseDay(candidate);
}

/** The injected seams one daily-note listing walks over. */
export interface DailyNoteListingDeps {
  /** The resolved daily-notes config; `null` = the plugin is off → empty. */
  config: DailyNotesConfig | null;
  listMarkdownFiles(): ReadonlyArray<{ path: string }>;
  /** Cache-safe frontmatter read for one path (metadata cache, never Bases). */
  frontmatterOf(path: string): Record<string, unknown> | null | undefined;
  parseDay: DayParser;
}

/**
 * Every daily note whose day falls inside the derivation window (start
 * inclusive, end exclusive — ISO local days order lexically), carrying its raw
 * `timeblocks` frontmatter value. Notes without the key are still listed so
 * the timeblock watch can track them for later deletion/first-edit relevance.
 */
export function listDailyNoteTimeblocks(
  deps: DailyNoteListingDeps,
  window: CalendarDerivationWindow,
): DailyNoteTimeblocks[] {
  const config = deps.config;
  if (config === null) return [];
  const notes: DailyNoteTimeblocks[] = [];
  for (const file of deps.listMarkdownFiles()) {
    const day = dailyNoteDayOfPath(file.path, config.folder, deps.parseDay);
    if (day === null || day < window.startDate || day >= window.endDateExclusive) continue;
    notes.push({
      date: day,
      path: file.path,
      timeblocks: deps.frontmatterOf(file.path)?.timeblocks,
    });
  }
  return notes;
}

/** The live accessor the timeblock family wiring holds per mount. */
export interface DailyNoteAccess {
  listDailyNotes(window: CalendarDerivationWindow): DailyNoteTimeblocks[];
  /** Daily-note relevance probe for the timeblock watch (config-fresh). */
  isDailyNote(path: string): boolean;
}

function resolveMoment(): MomentDayFactory | undefined {
  const candidate = (globalThis as { moment?: unknown }).moment;
  return typeof candidate === 'function' ? (candidate as MomentDayFactory) : undefined;
}

/**
 * The Obsidian wiring: config and parser are re-resolved on every call so a
 * daily-notes settings change (folder/format, plugin toggled) applies without
 * a remount; frontmatter reads go through the metadata cache.
 */
export function createDailyNoteAccess(app: App): DailyNoteAccess {
  const currentParser = (config: DailyNotesConfig): DayParser =>
    createDayParser(config.format, resolveMoment());
  return {
    listDailyNotes: (window) => {
      const config = readDailyNotesConfig(app);
      return listDailyNoteTimeblocks(
        {
          config,
          listMarkdownFiles: () => app.vault.getMarkdownFiles(),
          frontmatterOf: (path) => {
            const file = app.vault.getAbstractFileByPath(path);
            if (!(file instanceof TFile)) return null;
            return app.metadataCache.getFileCache(file)?.frontmatter ?? null;
          },
          parseDay: config === null ? () => null : currentParser(config),
        },
        window,
      );
    },
    isDailyNote: (path) => {
      const config = readDailyNotesConfig(app);
      if (config === null) return false;
      return dailyNoteDayOfPath(path, config.folder, currentParser(config)) !== null;
    },
  };
}
