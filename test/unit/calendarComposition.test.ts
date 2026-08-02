import { expect, it, jest } from '@jest/globals';
import type { App, Plugin } from 'obsidian';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
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
  const sourceFile = ts.createSourceFile(
    'main.ts',
    mainSource,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const compositionCalls: boolean[] = [];
  const visit = (node: ts.Node, insideOnload: boolean): void => {
    const inOnloadMethod =
      insideOnload ||
      (ts.isMethodDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === 'onload');
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'createCalendarComposition' &&
      node.arguments.length === 1 &&
      node.arguments[0]?.kind === ts.SyntaxKind.ThisKeyword
    ) {
      compositionCalls.push(inOnloadMethod);
    }
    ts.forEachChild(node, (child) => visit(child, inOnloadMethod));
  };
  visit(sourceFile, false);

  expect(compositionCalls).toEqual([true]);
});
