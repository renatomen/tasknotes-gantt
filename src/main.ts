
import { Plugin } from 'obsidian';
import { registerBasesGantt } from './bases/register';

export default class ObsidianGanttPlugin extends Plugin {
  private unregisterBases: (() => void) | null = null;

  async onload() {
    console.log('Loading TaskNotes Gantt plugin');

    // MVP: Register Obsidian Bases custom view "Gantt (OG)" (no chart yet)
    try {
      this.unregisterBases = registerBasesGantt(this);
    } catch (e) {
      console.warn('[Gantt] Failed to start Bases registration', e);
    }
  }

  onunload() {
    console.log('Unloading TaskNotes Gantt plugin');
    try { this.unregisterBases?.(); } catch {}
  }
}
