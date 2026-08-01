import type { RenderLink } from '../controller/InstanceExpansion';
import type { SvarTask } from './ganttSync';

export interface GanttSyncPort {
  hasTask(id: string): boolean;
  moveTaskToParent(id: string, parentId: string | 0): void;
  updateTask(id: string, task: SvarTask): void;
  deleteLink(id: string): void;
  deleteTask(id: string): void;
  addTask(task: SvarTask): void;
  addLink(link: RenderLink): void;
  moveTaskAfter(id: string, previousSiblingId: string): void;
}
