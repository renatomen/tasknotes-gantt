import { expect, it, jest } from '@jest/globals';
import type { App, Plugin } from 'obsidian';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import type { CalendarNoteKind, PluginLifetime } from '../../src/bases/createCalendarNote';
import { createCalendarComposition } from '../../src/calendarComposition';

function isCalendarCompositionCall(node: ts.Node): node is ts.CallExpression {
  return (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'createCalendarComposition' &&
    node.arguments.length === 1 &&
    node.arguments[0]?.kind === ts.SyntaxKind.ThisKeyword
  );
}

function countDirectOnloadCalls(node: ts.Node): number {
  if (
    !ts.isMethodDeclaration(node) ||
    !ts.isIdentifier(node.name) ||
    node.name.text !== 'onload'
  ) {
    return 0;
  }
  const declarations = (node.body?.statements ?? []).flatMap((statement) =>
    ts.isVariableStatement(statement) ? [...statement.declarationList.declarations] : [],
  );
  return declarations.filter(
    (declaration) =>
      declaration.initializer && isCalendarCompositionCall(declaration.initializer),
  ).length;
}

function calendarCompositionCallLocations(source: string): {
  directOnloadStatements: number;
  total: number;
} {
  const sourceFile = ts.createSourceFile(
    'main.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  let total = 0;
  let directOnloadStatements = 0;
  const visit = (node: ts.Node): void => {
    if (isCalendarCompositionCall(node)) total += 1;
    directOnloadStatements += countDirectOnloadCalls(node);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { directOnloadStatements, total };
}

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
  const createLifetime = jest.fn<(plugin: Plugin) => PluginLifetime>(() => lifetime);
  const unregisterBases = jest.fn();
  const registerBases = jest.fn<(plugin: Plugin, lifetime: PluginLifetime) => () => void>(
    () => unregisterBases,
  );
  const createNote = jest.fn<
    (app: App, kind: CalendarNoteKind, lifetime: PluginLifetime) => Promise<void>
  >(async () => {});

  const composition = createCalendarComposition(plugin, {
    createLifetime,
    registerBases,
    createNote,
  });
  const unregister = composition.registerBases();
  await composition.createNote('calendar');

  expect(createLifetime).toHaveBeenCalledTimes(1);
  // `mock.calls` + `toEqual` sidesteps TS2589: obsidian's recursive `Plugin`
  // type blows up `toHaveBeenCalledWith`'s deep matcher expansion. Same claim.
  expect(createLifetime.mock.calls).toEqual([[plugin]]);
  expect(registerBases.mock.calls).toEqual([[plugin, lifetime]]);
  expect(createNote.mock.calls).toEqual([[app, 'calendar', lifetime]]);
  expect(unregister).toBe(unregisterBases);
});

it('creates the calendar composition inside each plugin load', () => {
  const mainSource = readFileSync(resolve(process.cwd(), 'src/main.ts'), 'utf8');
  expect(calendarCompositionCallLocations(mainSource)).toEqual({
    directOnloadStatements: 1,
    total: 1,
  });
});

it('rejects calendar composition creation deferred to an onload callback', () => {
  const nestedCall = `
    class Plugin {
      onload() {
        this.app.workspace.onLayoutReady(() => {
          const composition = createCalendarComposition(this);
        });
      }
    }
  `;

  expect(calendarCompositionCallLocations(nestedCall)).toEqual({
    directOnloadStatements: 0,
    total: 1,
  });
});
