import type { BasesAllOptions, BasesViewConfig, Plugin } from 'obsidian';
import { registerBasesGantt } from '../../src/bases/register';
import type { PluginLifetime } from '../../src/bases/createCalendarNote';

export type OptionsCallback = (config: BasesViewConfig) => BasesAllOptions[];

/**
 * Capture the REAL registration's `options` callback over an app whose
 * TaskNotes lookup returns `taskNotesHandle` (`null` = TaskNotes absent).
 */
export function captureOptionsCallback(taskNotesHandle: Record<string, unknown> | null): OptionsCallback {
  const app = {
    plugins: { getPlugin: (id: string) => (id === 'tasknotes' ? taskNotesHandle : null) },
  };
  let captured: { options?: OptionsCallback } | null = null;
  const plugin = {
    app,
    registerBasesView: (_id: string, opts: { options?: OptionsCallback }) => {
      captured = opts;
      return true;
    },
  } as unknown as Plugin;
  const calendarLifetime: PluginLifetime = {
    isActive: () => true,
    scope: () => ({
      own: (source, subscribe) => {
        subscribe(source);
      },
      defer: () => {},
      close: () => {},
    }),
  };
  registerBasesGantt(plugin, calendarLifetime);
  const options = (captured as { options?: OptionsCallback } | null)?.options;
  if (!options) throw new Error('options callback was not captured');
  return options;
}
