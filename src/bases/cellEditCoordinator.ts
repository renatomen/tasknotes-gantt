/**
 * Owns the optimistic apply, persistence, rollback, and editor gate for inline
 * cell edits. Bridge commits arrive after SVAR applies the flat value; direct
 * chips commits bypass that bridge and refresh the flat value themselves.
 *
 * The gate is per render instance and is consulted when an editor opens, not a
 * source-wide commit lock. Sibling instances can therefore overlap on their
 * shared source records. Persistence timeouts revert and release the gate
 * without cancelling the underlying write.
 *
 * Dependency-free: persistence, rendering, notices, and store access are ports.
 *
 * @module bases/cellEditCoordinator
 */

import {
  counterpartDate,
  resolveCellEditCommit,
  storedFlatValue,
  violatesDateOrder,
  type DatedRowLike,
  type ShippedEditorKind,
} from './cellEditCommit';
import type { CellRender } from './cellRender';
import {
  classifyTypedValue,
  EMPTY_TYPED_VALUE,
  listsEqual,
  type TypedValue,
} from './propertyValues';
import { normalizeStoredList } from './taskNotesSuggest';

export interface BridgeCellEditRequest {
  instanceId: string;
  columnId: string;
  kind: ShippedEditorKind;
  rawValue: unknown;
  storedValue: TypedValue;
  choiceValues?: readonly string[];
  dateRole?: 'start' | 'end';
  datedRow?: DatedRowLike;
}

export interface BridgeCellEditActions {
  applyAndPersist(instanceId: string, columnId: string, value: unknown): void;
  notify(message: string): void;
}

/** Whether SVAR's optimistic apply may stand; `false` blocks a noop or invalid commit. */
export function commitBridgeCellEdit(
  request: BridgeCellEditRequest,
  actions: BridgeCellEditActions,
): boolean {
  const outcome = resolveCellEditCommit(
    request.kind,
    request.rawValue,
    request.storedValue,
    { choiceValues: request.choiceValues },
  );
  if (outcome.action === 'noop') return false;
  if (outcome.action === 'reject') {
    actions.notify(`Couldn't save — ${outcome.reason}`);
    return false;
  }
  // A cell edit validates the counterpart but never reshuffles it or starts a subtree cascade.
  if (
    outcome.value instanceof Date &&
    request.dateRole &&
    violatesDateOrder(
      request.dateRole,
      outcome.value,
      counterpartDate(request.datedRow, request.dateRole),
    )
  ) {
    actions.notify(invalidDateOrderMessage(request.dateRole));
    return false;
  }
  actions.applyAndPersist(request.instanceId, request.columnId, outcome.value);
  return true;
}

function invalidDateOrderMessage(role: 'start' | 'end'): string {
  return role === 'start'
    ? "Couldn't save — the start date must not be after the end date."
    : "Couldn't save — the end date must not be before the start date.";
}

export type BridgeCellEditIntent = Omit<BridgeCellEditRequest, 'storedValue'>;

export interface ChipsCellEditIntent {
  instanceId: string;
  columnId: string;
  raw: string[];
}

export type CellEditPersistence = (
  instanceId: string,
  columnId: string,
  value: unknown,
) => Promise<void>;

export interface CellEditCoordinatorOptions {
  getPersistence(): CellEditPersistence | undefined;
  storedPropertiesOf(instanceId: string): Record<string, TypedValue> | undefined;
  cellRendersOf(instanceId: string): Record<string, CellRender> | undefined;
  rawStoredValueOf(instanceId: string, columnId: string): unknown;
  renderText(value: TypedValue): string;
  refreshFlatCell(instanceId: string, columnId: string, value: unknown): void;
  notify(message: string): void;
  reportPersistenceFailure(error: unknown): void;
  persistenceTimeoutMs: number;
}

export interface CellEditCoordinator {
  isPending(instanceId: string): boolean;
  commitBridge(intent: BridgeCellEditIntent): boolean;
  commitChips(intent: ChipsCellEditIntent): void;
}

interface AppliedCellEdit {
  instanceId: string;
  columnId: string;
  value: unknown;
  previous: TypedValue;
  previousRender: CellRender | undefined;
}

interface AcceptedCellEdit {
  persist: CellEditPersistence;
  instanceId: string;
  columnId: string;
  value: unknown;
  /** Direct editors bypass SVAR's bridge and need one flat refresh before persistence. */
  refreshFlatCellBeforePersist?: boolean;
}

export function createCellEditCoordinator(
  options: CellEditCoordinatorOptions,
): CellEditCoordinator {
  // Per render instance, not source note: this blocks re-entry on one row and
  // drops its direct chips commits, but sibling rows sharing records can overlap.
  // A same-row second edit would capture optimistic state as its rollback baseline.
  const pendingInstanceIds = new Set<string>();

  function applyAcceptedEdit(edit: AcceptedCellEdit): void {
    const properties = options.storedPropertiesOf(edit.instanceId);
    const previous = properties?.[edit.columnId] ?? EMPTY_TYPED_VALUE;
    const typed = classifyTypedValue(edit.value);
    if (properties) properties[edit.columnId] = typed;

    const renders = options.cellRendersOf(edit.instanceId);
    const previousRender = renders?.[edit.columnId];
    // Cells render this descriptor, not the flat key. The confirming data pass
    // restores any configured markdown descriptor after the optimistic text.
    if (renders) {
      renders[edit.columnId] = {
        mode: 'text',
        text: options.renderText(typed),
      };
    }

    pendingInstanceIds.add(edit.instanceId);
    if (edit.refreshFlatCellBeforePersist) {
      options.refreshFlatCell(
        edit.instanceId,
        edit.columnId,
        storedFlatValue(typed),
      );
    }
    void persistAppliedEdit(edit.persist, {
      instanceId: edit.instanceId,
      columnId: edit.columnId,
      value: edit.value,
      previous,
      previousRender,
    });
  }

  async function persistAppliedEdit(
    persist: CellEditPersistence,
    edit: AppliedCellEdit,
  ): Promise<void> {
    try {
      await withTimeout(
        persist(edit.instanceId, edit.columnId, edit.value),
        options.persistenceTimeoutMs,
      );
    } catch (error) {
      options.reportPersistenceFailure(error);
      const properties = options.storedPropertiesOf(edit.instanceId);
      if (properties) properties[edit.columnId] = edit.previous;
      const renders = options.cellRendersOf(edit.instanceId);
      if (renders) {
        if (edit.previousRender) {
          renders[edit.columnId] = edit.previousRender;
        } else {
          delete renders[edit.columnId];
        }
      }
      // A bridge already applied the failed flat value, so every rollback must
      // re-assert the baseline; only direct editors need the optimistic refresh.
      options.refreshFlatCell(
        edit.instanceId,
        edit.columnId,
        storedFlatValue(edit.previous),
      );
      options.notify("Couldn't save the change — check TaskNotes is running.");
    } finally {
      pendingInstanceIds.delete(edit.instanceId);
    }
  }

  return {
    isPending(instanceId): boolean {
      return pendingInstanceIds.has(instanceId);
    },
    commitBridge(intent): boolean {
      const persist = options.getPersistence();
      if (!persist) return false;
      const storedValue =
        options.storedPropertiesOf(intent.instanceId)?.[intent.columnId] ??
        EMPTY_TYPED_VALUE;
      return commitBridgeCellEdit(
        { ...intent, storedValue },
        {
          applyAndPersist(instanceId, columnId, value) {
            applyAcceptedEdit({
              persist,
              instanceId,
              columnId,
              value,
            });
          },
          notify: options.notify,
        },
      );
    },
    commitChips(intent): void {
      if (pendingInstanceIds.has(intent.instanceId)) return;
      // Typed values retain display forms only; raw storage preserves wikilink
      // spelling for the lossless whole-list comparison and write.
      const current = normalizeStoredList(
        options.rawStoredValueOf(intent.instanceId, intent.columnId),
      );
      if (listsEqual(current, intent.raw)) return;
      const persist = options.getPersistence();
      if (!persist) return;
      applyAcceptedEdit({
        persist,
        instanceId: intent.instanceId,
        columnId: intent.columnId,
        value: intent.raw,
        refreshFlatCellBeforePersist: true,
      });
    },
  };
}

/**
 * Rejects the wait so a hung write reverts and releases the editor gate; the
 * underlying write is not cancelled and may still land.
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = globalThis.setTimeout(
      () => reject(new Error('write timed out')),
      timeoutMs,
    );
    promise.then(
      (value) => {
        globalThis.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        globalThis.clearTimeout(timer);
        reject(error);
      },
    );
  });
}
