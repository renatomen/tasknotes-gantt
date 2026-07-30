import {
  counterpartDate,
  resolveCellEditCommit,
  violatesDateOrder,
  type DatedRowLike,
  type ShippedEditorKind,
} from './cellEditCommit';
import type { TypedValue } from './propertyValues';

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
