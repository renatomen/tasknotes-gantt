/**
 * Abstract base class for Gantt Bases views.
 * Extends Component to inherit load/unload lifecycle from Obsidian.
 *
 * Per official API: BasesView extends Component
 * - Override onload() to mount your UI
 * - Override onunload() to cleanup your UI
 * - Override onDataUpdated() to react to data changes
 */

import { Component, type App } from 'obsidian';
import type { BasesViewConfig, BasesQueryResult, QueryController, BasesPropertyId } from './register';

export abstract class GanttBasesView extends Component {
  /** View type identifier */
  abstract readonly type: string;
  /** Obsidian App instance */
  readonly app: App;
  /** View configuration */
  config!: BasesViewConfig;
  /** Query result data */
  data!: BasesQueryResult;
  /** All available properties */
  allProperties: BasesPropertyId[] = [];

  constructor(protected controller: QueryController) {
    super();
    // App is accessed via controller which is a Component
    this.app = (controller as unknown as { app: App }).app;
  }

  /** Called when data changes - must be implemented by subclass */
  abstract onDataUpdated(): void;
}
