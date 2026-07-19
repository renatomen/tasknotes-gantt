/**
 * Calendar resolution: enumerate the vault's calendar/set notes into a
 * registry, then resolve each task's association wikilink to its effective
 * calendars and identity. Pure — vault access is injected, so the module
 * unit-tests without Obsidian and the wiring layer stays thin.
 *
 * Fail-visible contract: an association that does not resolve to a valid
 * calendar or set (dangling link, wrong-type target, invalid note) is
 * flagged, keeps the built-in default's display behaviour, and suspends
 * stretch/scheduling for that task — dates render as authored, never
 * silently recomputed. A set member that is not a valid calendar is dropped
 * with a flag while the remaining members still take effect.
 */

import type { AvailabilitySource } from '../availability';
import {
  parseCalendarFrontmatter,
  type CalendarDefinition,
  type CalendarSetDefinition,
} from './schema';

export interface CalendarNoteInput {
  path: string;
  basename: string;
  frontmatter: unknown;
}

export interface CalendarRecord {
  path: string;
  name: string;
  definition: CalendarDefinition;
}

export interface CalendarSetRecord {
  path: string;
  name: string;
  definition: CalendarSetDefinition;
  memberPaths: string[];
  flags: string[];
}

export interface CalendarRegistry {
  calendars: Map<string, CalendarRecord>;
  sets: Map<string, CalendarSetRecord>;
  invalid: Map<string, { name: string; reasons: string[] }>;
}

/** Resolves link text (wikilink/markdown/path) to a vault path, or null. */
export type LinkResolver = (linkText: string, fromPath: string) => string | null;

export function buildCalendarRegistry(
  notes: readonly CalendarNoteInput[],
  resolveLink: LinkResolver,
): CalendarRegistry {
  const registry: CalendarRegistry = { calendars: new Map(), sets: new Map(), invalid: new Map() };
  const parsedSets: { note: CalendarNoteInput; definition: CalendarSetDefinition }[] = [];

  for (const note of notes) {
    const parsed = parseCalendarFrontmatter(note.frontmatter);
    if (parsed === null) continue;
    if (parsed.kind === 'calendar') {
      registry.calendars.set(note.path, { path: note.path, name: note.basename, definition: parsed });
    } else if (parsed.kind === 'calendar-set') {
      parsedSets.push({ note, definition: parsed });
    } else {
      registry.invalid.set(note.path, { name: note.basename, reasons: parsed.reasons });
    }
  }

  // Members resolve after every calendar is known; sets are flat, so a member
  // that is itself a set (or invalid, or missing) drops with a flag while the
  // rest still union.
  for (const { note, definition } of parsedSets) {
    const memberPaths: string[] = [];
    const flags = definition.diagnostics.map((d) => `${d.path}: ${d.message}`);
    for (const memberLink of definition.members) {
      const memberPath = resolveLink(stripSubpath(memberLink), note.path);
      if (memberPath === null) {
        flags.push(`member does not resolve: ${memberLink}`);
      } else if (registry.calendars.has(memberPath)) {
        memberPaths.push(memberPath);
      } else {
        flags.push(`member is not a valid calendar (sets are flat): ${memberLink}`);
      }
    }
    registry.sets.set(note.path, {
      path: note.path,
      name: note.basename,
      definition,
      memberPaths,
      flags,
    });
  }

  return registry;
}

export interface CalendarIdentity {
  id: string;
  name: string;
  color: string | undefined;
}

export interface ResolvedAssociation {
  /** Undefined = the built-in display-only default. */
  identity: CalendarIdentity | undefined;
  /** Effective member calendars: one for a direct link, N for a set, none otherwise. */
  calendars: CalendarRecord[];
  flags: string[];
  /** True when the association is broken: dates render as authored. */
  schedulingSuspended: boolean;
}

const DEFAULT_ASSOCIATION: ResolvedAssociation = {
  identity: undefined,
  calendars: [],
  flags: [],
  schedulingSuspended: false,
};

export function resolveTaskCalendar(
  registry: CalendarRegistry,
  associationValue: unknown,
  taskPath: string,
  resolveLink: LinkResolver,
): ResolvedAssociation {
  if (associationValue === undefined || associationValue === null) return DEFAULT_ASSOCIATION;
  if (typeof associationValue !== 'string' || associationValue.trim() === '') {
    return associationValue === ''
      ? DEFAULT_ASSOCIATION
      : broken(`calendar association is not a link: ${String(associationValue)}`);
  }

  const linkText = stripSubpath(associationValue.trim());
  const path = resolveLink(linkText, taskPath);
  if (path === null) return broken(`calendar link does not resolve: ${associationValue.trim()}`);

  const calendar = registry.calendars.get(path);
  if (calendar) {
    return {
      identity: { id: calendar.path, name: calendar.name, color: calendar.definition.color },
      calendars: [calendar],
      flags: [],
      schedulingSuspended: false,
    };
  }

  const set = registry.sets.get(path);
  if (set) {
    // The set's own colour wins for set-linked tasks.
    return {
      identity: { id: set.path, name: set.name, color: set.definition.color },
      calendars: set.memberPaths
        .map((memberPath) => registry.calendars.get(memberPath))
        .filter((record): record is CalendarRecord => record !== undefined),
      flags: set.flags,
      schedulingSuspended: false,
    };
  }

  const invalid = registry.invalid.get(path);
  if (invalid) return broken(`calendar note is invalid: ${invalid.reasons.join('; ')}`);
  return broken(`linked note is not a calendar: ${path}`);
}

function broken(flag: string): ResolvedAssociation {
  return { identity: undefined, calendars: [], flags: [flag], schedulingSuspended: true };
}

/**
 * Drop a `#heading` / `#^block` subpath from link text — association is
 * note-level, and the shared link resolver splits aliases but passes a
 * fragment through to the cache lookup, where it fails.
 */
export function stripSubpath(linkText: string): string {
  if (linkText.startsWith('[[') && linkText.endsWith(']]')) {
    const inner = linkText.slice(2, -2);
    const pipeIndex = inner.indexOf('|');
    const target = pipeIndex === -1 ? inner : inner.slice(0, pipeIndex);
    const alias = pipeIndex === -1 ? '' : inner.slice(pipeIndex);
    const hashIndex = target.indexOf('#');
    const cleanTarget = hashIndex === -1 ? target : target.slice(0, hashIndex);
    return `[[${cleanTarget}${alias}]]`;
  }
  const hashIndex = linkText.indexOf('#');
  return hashIndex === -1 ? linkText : linkText.slice(0, hashIndex);
}

/**
 * Blocking source over a calendar's dated non-working spans, queried by LOCAL
 * calendar day (matching the availability seam's all-day semantics). The
 * weekly pattern's blocking complement is windowed and composes at the
 * consumer, where the shared evaluation window lives.
 */
export function datedBlockingSource(definition: CalendarDefinition): AvailabilitySource {
  const days = new Set<string>();
  for (const span of definition.nonWorking) {
    for (let day = span.startDate; day < span.endDateExclusive; day = nextDay(day)) {
      days.add(day);
    }
  }
  return {
    isNonWorking: (date: Date) => days.has(localIso(date)),
  };
}

function localIso(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function nextDay(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number) as [number, number, number];
  const shifted = new Date(Date.UTC(year, month - 1, day) + 86_400_000);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
