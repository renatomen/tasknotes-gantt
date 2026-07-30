import type { IApi, ILink, TMethodsConfig } from '@svar-ui/svelte-gantt';
import { withAlignedFlatKeys } from './cellEditCommit';
import type { GanttSyncPort } from './ganttSyncPort';

type SvarGanttCommandApi = Pick<IApi, 'exec'> & {
  getTask?: (id: string) => unknown;
};

interface SvarGanttAdapterOptions {
  echoSource: string;
  cellEditColumnIds: ReadonlyArray<string>;
}

type EchoPayload<Action extends keyof TMethodsConfig> =
  TMethodsConfig[Action] & {
    eventSource: string;
  };

export function createSvarGanttAdapter(
  api: SvarGanttCommandApi,
  options: SvarGanttAdapterOptions,
): GanttSyncPort {
  const { echoSource, cellEditColumnIds } = options;
  return {
    hasTask(id): boolean {
      try {
        return !!api.getTask?.(id);
      } catch {
        return false;
      }
    },
    moveTaskToParent(id, parentId): void {
      const params: EchoPayload<'move-task'> = {
        id,
        target: parentId,
        mode: 'child',
        eventSource: echoSource,
      };
      void api.exec('move-task', params);
    },
    updateTask(id, task): void {
      const params: TMethodsConfig['update-task'] = {
        id,
        task: withAlignedFlatKeys(task, cellEditColumnIds),
        eventSource: echoSource,
      };
      void api.exec('update-task', params);
    },
    deleteLink(id): void {
      const params: EchoPayload<'delete-link'> = {
        id,
        eventSource: echoSource,
      };
      void api.exec('delete-link', params);
    },
    deleteTask(id): void {
      const params: EchoPayload<'delete-task'> = {
        id,
        eventSource: echoSource,
      };
      void api.exec('delete-task', params);
    },
    addTask(task): void {
      const params: TMethodsConfig['add-task'] = {
        task,
        eventSource: echoSource,
      };
      void api.exec('add-task', params);
    },
    addLink(link): void {
      const params: TMethodsConfig['add-link'] = {
        // RenderLink carries SVAR values, but its public type is wider than ILink.
        link: link as ILink,
        eventSource: echoSource,
      };
      void api.exec('add-link', params);
    },
    moveTaskAfter(id, previousSiblingId): void {
      const params: EchoPayload<'move-task'> = {
        id,
        target: previousSiblingId,
        mode: 'after',
        eventSource: echoSource,
      };
      void api.exec('move-task', params);
    },
  };
}
