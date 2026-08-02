import { expect, it, jest } from '@jest/globals';
import type { App, Plugin } from 'obsidian';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PluginLifetime } from '../../src/bases/createCalendarNote';
import { createCalendarComposition } from '../../src/calendarComposition';

it('shares one plugin lifetime across Bases registration and calendar creation', async () => {
  const app = {} as App;
  const plugin = { app } as Plugin;
  const lifetime: PluginLifetime = {
    isActive: () => true,
    scope: () => ({
      own: (source, subscribe) => {
        subscribe(source);
      },
      defer: () => {},
      close: () => {},
    }),
  };
  const createLifetime = jest.fn(() => lifetime);
  const unregisterBases = jest.fn();
  const registerBases = jest.fn(() => unregisterBases);
  const createNote = jest.fn(async () => {});

  const composition = createCalendarComposition(plugin, {
    createLifetime,
    registerBases,
    createNote,
  });
  const unregister = composition.registerBases();
  await composition.createNote('calendar');

  expect(createLifetime).toHaveBeenCalledTimes(1);
  expect(createLifetime).toHaveBeenCalledWith(plugin);
  expect(registerBases).toHaveBeenCalledWith(plugin, lifetime);
  expect(createNote).toHaveBeenCalledWith(app, 'calendar', lifetime);
  expect(unregister).toBe(unregisterBases);
});

it('creates the calendar composition inside each plugin load', () => {
  const mainSource = readFileSync(resolve(process.cwd(), 'src/main.ts'), 'utf8');
  const onloadIndex = mainSource.indexOf('async onload()');
  const compositionIndex = mainSource.indexOf(
    'const calendarComposition = createCalendarComposition(this);',
  );

  expect(onloadIndex).toBeGreaterThan(-1);
  expect(compositionIndex).toBeGreaterThan(onloadIndex);
  expect(mainSource.slice(0, onloadIndex)).not.toContain('createCalendarComposition(this)');
});
