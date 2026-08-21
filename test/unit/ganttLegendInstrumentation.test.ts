import { expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

const RENDERER_ACTION_HELPERS = {
  clickFullscreenToggle: 'toggle',
  clickRendererAction: 'target',
} as const;
const LAYOUT_READ_METHODS = new Set([
  'elementFromPoint',
  'elementsFromPoint',
  'getBoundingClientRect',
  'getClientRects',
  'getComputedStyle',
]);
const LAYOUT_READ_PROPERTIES = new Set([
  'clientHeight',
  'clientLeft',
  'clientTop',
  'clientWidth',
  'offsetHeight',
  'offsetLeft',
  'offsetTop',
  'offsetWidth',
  'scrollHeight',
  'scrollLeft',
  'scrollTop',
  'scrollWidth',
]);

type RendererActionHelper = keyof typeof RENDERER_ACTION_HELPERS;

interface LayoutRead {
  helper: RendererActionHelper;
  member: string;
}

function memberName(node: ts.Node): string | null {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (
    ts.isElementAccessExpression(node) &&
    node.argumentExpression &&
    ts.isStringLiteral(node.argumentExpression)
  ) {
    return node.argumentExpression.text;
  }
  return null;
}

function isBrowserExecute(node: ts.Node): node is ts.CallExpression {
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === 'browser' &&
    node.expression.name.text === 'execute'
  );
}

function browserExecuteCallback(
  declaration: ts.FunctionDeclaration,
): ts.ArrowFunction | ts.FunctionExpression | null {
  let callback: ts.ArrowFunction | ts.FunctionExpression | null = null;
  const visit = (node: ts.Node): void => {
    if (callback) return;
    if (isBrowserExecute(node)) {
      const candidate = node.arguments[0];
      if (candidate && (ts.isArrowFunction(candidate) || ts.isFunctionExpression(candidate))) {
        callback = candidate;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(declaration.body!);
  return callback;
}

function rendererActionHelper(node: ts.Node): RendererActionHelper | null {
  if (!ts.isFunctionDeclaration(node) || !node.name || !node.body) return null;
  const name = node.name.text as RendererActionHelper;
  return name in RENDERER_ACTION_HELPERS ? name : null;
}

function collectExecutableNodes(
  callback: ts.ArrowFunction | ts.FunctionExpression,
): ts.Node[] {
  const nodes: ts.Node[] = [];
  const visit = (node: ts.Node): void => {
    if (
      node !== callback &&
      (ts.isArrowFunction(node) ||
        ts.isFunctionExpression(node) ||
        ts.isFunctionDeclaration(node))
    ) {
      return;
    }
    nodes.push(node);
    ts.forEachChild(node, visit);
  };
  visit(callback);
  return nodes;
}

function rendererDispatchPosition(
  nodes: ts.Node[],
  receiver: string,
  sourceFile: ts.SourceFile,
): number | null {
  const dispatch = nodes.find((node) =>
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === receiver &&
    node.expression.name.text === 'click');
  return dispatch?.getStart(sourceFile) ?? null;
}

function layoutReadsBefore(
  nodes: ts.Node[],
  dispatchPosition: number,
  sourceFile: ts.SourceFile,
  helper: RendererActionHelper,
): LayoutRead[] {
  return nodes.flatMap((node) => {
    if (node.getStart(sourceFile) >= dispatchPosition) return [];
    const member = memberName(node);
    const globalMethod =
      ts.isCallExpression(node) && ts.isIdentifier(node.expression)
        ? node.expression.text
        : null;
    const layoutMember = member ?? globalMethod;
    return layoutMember &&
      (LAYOUT_READ_METHODS.has(layoutMember) || LAYOUT_READ_PROPERTIES.has(layoutMember))
      ? [{ helper, member: layoutMember }]
      : [];
  });
}

function inspectRendererActionPreludes(source: string): {
  helpersFound: RendererActionHelper[];
  dispatchesFound: RendererActionHelper[];
  layoutReads: LayoutRead[];
} {
  const sourceFile = ts.createSourceFile(
    'gantt-legend.e2e.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const helpersFound: RendererActionHelper[] = [];
  const dispatchesFound: RendererActionHelper[] = [];
  const layoutReads: LayoutRead[] = [];

  const visit = (node: ts.Node): void => {
    const helper = rendererActionHelper(node);
    if (!helper) {
      ts.forEachChild(node, visit);
      return;
    }
    helpersFound.push(helper);

    const callback = browserExecuteCallback(node as ts.FunctionDeclaration);
    if (!callback) return;
    const executableNodes = collectExecutableNodes(callback);
    const dispatchPosition = rendererDispatchPosition(
      executableNodes,
      RENDERER_ACTION_HELPERS[helper],
      sourceFile,
    );
    if (dispatchPosition === null) return;
    dispatchesFound.push(helper);
    layoutReads.push(...layoutReadsBefore(
      executableNodes,
      dispatchPosition,
      sourceFile,
      helper,
    ));
  };

  visit(sourceFile);
  return {
    helpersFound: helpersFound.sort(),
    dispatchesFound: dispatchesFound.sort(),
    layoutReads,
  };
}

const expectedHelpers = Object.keys(RENDERER_ACTION_HELPERS).sort();

it('keeps renderer action helpers free of layout reads before click dispatch', () => {
  const source = readFileSync(
    resolve(process.cwd(), 'test/specs/gantt-legend.e2e.ts'),
    'utf8',
  );

  expect(inspectRendererActionPreludes(source)).toEqual({
    helpersFound: expectedHelpers,
    dispatchesFound: expectedHelpers,
    layoutReads: [],
  });
});

it('detects nested and discarded layout reads before both renderer dispatches', () => {
  const mutatedSource = `
    async function clickRendererAction(): Promise<void> {
      await browser.execute(() => {
        const target = document.querySelector('button')!;
        target.getBoundingClientRect();
        document.elementFromPoint(0, 0);
        target.click();
      });
    }
    async function clickFullscreenToggle(): Promise<void> {
      await browser.execute(() => {
        const toggle = document.querySelector('button')!;
        document.elementsFromPoint(toggle.offsetLeft, toggle.offsetTop);
        toggle.click();
      });
    }
  `;

  expect(inspectRendererActionPreludes(mutatedSource)).toEqual({
    helpersFound: expectedHelpers,
    dispatchesFound: expectedHelpers,
    layoutReads: [
      { helper: 'clickRendererAction', member: 'getBoundingClientRect' },
      { helper: 'clickRendererAction', member: 'elementFromPoint' },
      { helper: 'clickFullscreenToggle', member: 'elementsFromPoint' },
      { helper: 'clickFullscreenToggle', member: 'offsetLeft' },
      { helper: 'clickFullscreenToggle', member: 'offsetTop' },
    ],
  });
});

it('allows geometry observed only after renderer click dispatch', () => {
  const source = `
    async function clickRendererAction(): Promise<void> {
      await browser.execute(() => {
        const target = document.querySelector('button')!;
        target.addEventListener('click', () => target.getBoundingClientRect());
        target.click();
        document.elementFromPoint(0, 0);
      });
    }
    async function clickFullscreenToggle(): Promise<void> {
      await browser.execute(() => {
        const toggle = document.querySelector('button')!;
        toggle.click();
        toggle.getClientRects();
      });
    }
  `;

  expect(inspectRendererActionPreludes(source)).toEqual({
    helpersFound: expectedHelpers,
    dispatchesFound: expectedHelpers,
    layoutReads: [],
  });
});
