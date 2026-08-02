import { expect, it, jest } from '@jest/globals';
import type { App, Plugin } from 'obsidian';
import type { PluginLifetime } from '../../src/bases/createCalendarNote';
import { createCalendarComposition } from '../../src/calendarComposition';

it('shares one plugin lifetime across Bases registration and calendar creation', async () => {
  const app = {} as App;
  const plugin = { app } as Plugin;
  const lifetime: PluginLifetime = {
    isActive: () => true,
    scope: () => ({ own: () => {}, defer: () => {}, close: () => {} }),
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
