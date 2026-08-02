import type { App, Plugin } from 'obsidian';
import { registerBasesGantt } from './bases/register';
import {
  createAndOpenCalendarNote,
  pluginLifetime,
  type CalendarNoteKind,
  type PluginLifetime,
} from './bases/createCalendarNote';

interface CalendarCompositionDependencies {
  createLifetime(plugin: Plugin): PluginLifetime;
  registerBases(plugin: Plugin, lifetime: PluginLifetime): () => void;
  createNote(app: App, kind: CalendarNoteKind, lifetime: PluginLifetime): Promise<void>;
}

export interface CalendarComposition {
  registerBases(): () => void;
  createNote(kind: CalendarNoteKind): Promise<void>;
}

const DEFAULT_DEPENDENCIES: CalendarCompositionDependencies = {
  createLifetime: pluginLifetime,
  registerBases: registerBasesGantt,
  createNote: createAndOpenCalendarNote,
};

export function createCalendarComposition(
  plugin: Plugin,
  dependencies: CalendarCompositionDependencies = DEFAULT_DEPENDENCIES,
): CalendarComposition {
  const lifetime = dependencies.createLifetime(plugin);
  return {
    registerBases: () => dependencies.registerBases(plugin, lifetime),
    createNote: (kind) => dependencies.createNote(plugin.app, kind, lifetime),
  };
}
