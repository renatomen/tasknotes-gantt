import { expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

const RENDERER_ACTION_HELPERS = {
  clickFullscreenToggle: 'toggle',
  clickRendererAction: 'target',
} as const;
const LAYOUT_READ_METHODS = new Set([
  'caretPositionFromPoint',
  'caretRangeFromPoint',
  'checkVisibility',
  'elementFromPoint',
  'elementsFromPoint',
  'getBoxQuads',
  'getBoundingClientRect',
  'getClientRects',
  'getComputedStyle',
  'scrollIntoView',
]);
const LAYOUT_READ_PROPERTIES = new Set([
  'clientHeight',
  'clientLeft',
  'clientTop',
  'clientWidth',
  'offsetHeight',
  'offsetLeft',
  'offsetParent',
  'offsetTop',
  'offsetWidth',
  'scrollHeight',
  'scrollLeft',
  'scrollTop',
  'scrollWidth',
  'innerText',
]);
const DEFERRED_CALLBACK_METHODS = new Set([
  'addEventListener',
  'catch',
  'finally',
  'queueMicrotask',
  'requestAnimationFrame',
  'requestIdleCallback',
  'setInterval',
  'setTimeout',
  'then',
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
  if (ts.isBindingElement(node)) {
    const key = node.propertyName ?? node.name;
    if (ts.isIdentifier(key) || ts.isStringLiteral(key)) return key.text;
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

function browserExecuteCallbacks(
  declaration: ts.FunctionDeclaration,
): Array<ts.ArrowFunction | ts.FunctionExpression> {
  const callbacks: Array<ts.ArrowFunction | ts.FunctionExpression> = [];
  const visit = (node: ts.Node): void => {
    if (isBrowserExecute(node)) {
      const candidate = node.arguments[0];
      if (candidate && (ts.isArrowFunction(candidate) || ts.isFunctionExpression(candidate))) {
        callbacks.push(candidate);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(declaration.body!);
  return callbacks;
}

function rendererActionHelper(node: ts.Node): RendererActionHelper | null {
  if (!ts.isFunctionDeclaration(node) || !node.name || !node.body) return null;
  const name = node.name.text as RendererActionHelper;
  return name in RENDERER_ACTION_HELPERS ? name : null;
}

function isDeferredCallback(node: ts.Node): boolean {
  if (
    !ts.isArrowFunction(node) &&
    !ts.isFunctionExpression(node)
  ) {
    return false;
  }
  const call = node.parent;
  if (!ts.isCallExpression(call)) return false;
  const method = memberName(call.expression);
  const globalMethod = ts.isIdentifier(call.expression) ? call.expression.text : null;
  return DEFERRED_CALLBACK_METHODS.has(method ?? globalMethod ?? '');
}

function collectExecutableNodes(
  callback: ts.ArrowFunction | ts.FunctionExpression,
): ts.Node[] {
  const nodes: ts.Node[] = [];
  const visit = (node: ts.Node): void => {
    if (node !== callback && isDeferredCallback(node)) return;
    nodes.push(node);
    ts.forEachChild(node, visit);
  };
  visit(callback);
  return nodes;
}

function rendererDispatchPositions(
  nodes: ts.Node[],
  receiver: string,
  sourceFile: ts.SourceFile,
): number[] {
  return nodes.filter((node) =>
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === receiver &&
    node.expression.name.text === 'click')
    .map((node) => node.getStart(sourceFile));
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
  shapeViolations: string[];
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
  const shapeViolations: string[] = [];
  const layoutReads: LayoutRead[] = [];

  const visit = (node: ts.Node): void => {
    const helper = rendererActionHelper(node);
    if (!helper) {
      ts.forEachChild(node, visit);
      return;
    }
    helpersFound.push(helper);

    const callbacks = browserExecuteCallbacks(node as ts.FunctionDeclaration);
    if (callbacks.length !== 1) {
      shapeViolations.push(`${helper}:browser-execute-count:${callbacks.length}`);
    }
    for (const callback of callbacks) {
      const executableNodes = collectExecutableNodes(callback);
      if (executableNodes.some(ts.isFunctionDeclaration)) {
        shapeViolations.push(`${helper}:local-function-declaration`);
      }
      const dispatchPositions = rendererDispatchPositions(
        executableNodes,
        RENDERER_ACTION_HELPERS[helper],
        sourceFile,
      );
      if (dispatchPositions.length !== 1) {
        shapeViolations.push(`${helper}:receiver-click-count:${dispatchPositions.length}`);
      }
      const dispatchPosition = dispatchPositions[0];
      if (dispatchPosition === undefined) continue;
      layoutReads.push(...layoutReadsBefore(
        executableNodes,
        dispatchPosition,
        sourceFile,
        helper,
      ));
    }
  };

  visit(sourceFile);
  return {
    helpersFound: helpersFound.sort(),
    shapeViolations,
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
    shapeViolations: [],
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
        (() => target.getClientRects())();
        target.click();
      });
    }
    async function clickFullscreenToggle(): Promise<void> {
      await browser.execute(() => {
        const toggle = document.querySelector('button')!;
        document.elementsFromPoint(toggle.offsetLeft, toggle.offsetTop);
        toggle.checkVisibility();
        toggle.offsetParent;
        const { offsetWidth } = toggle;
        const { elementFromPoint } = document;
        toggle.click();
      });
    }
  `;

  expect(inspectRendererActionPreludes(mutatedSource)).toEqual({
    helpersFound: expectedHelpers,
    shapeViolations: [],
    layoutReads: [
      { helper: 'clickRendererAction', member: 'getBoundingClientRect' },
      { helper: 'clickRendererAction', member: 'elementFromPoint' },
      { helper: 'clickRendererAction', member: 'getClientRects' },
      { helper: 'clickFullscreenToggle', member: 'elementsFromPoint' },
      { helper: 'clickFullscreenToggle', member: 'offsetLeft' },
      { helper: 'clickFullscreenToggle', member: 'offsetTop' },
      { helper: 'clickFullscreenToggle', member: 'checkVisibility' },
      { helper: 'clickFullscreenToggle', member: 'offsetParent' },
      { helper: 'clickFullscreenToggle', member: 'offsetWidth' },
      { helper: 'clickFullscreenToggle', member: 'elementFromPoint' },
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
    shapeViolations: [],
    layoutReads: [],
  });
});

it('fails closed when renderer callback execution order is ambiguous', () => {
  const source = `
    async function clickRendererAction(): Promise<void> {
      await browser.execute(() => target.click());
      await browser.execute(() => target.click());
    }
    async function clickFullscreenToggle(): Promise<void> {
      await browser.execute(() => {
        function measure(): void {}
        toggle.click();
        toggle.click();
      });
    }
  `;

  expect(inspectRendererActionPreludes(source)).toEqual({
    helpersFound: expectedHelpers,
    shapeViolations: [
      'clickRendererAction:browser-execute-count:2',
      'clickFullscreenToggle:local-function-declaration',
      'clickFullscreenToggle:receiver-click-count:2',
    ],
    layoutReads: [],
  });
});
