
import { Plugin, WorkspaceLeaf } from 'obsidian';
import { registerBasesGantt } from './bases/register';
import { ReleaseNotesView, RELEASE_NOTES_VIEW_TYPE } from './release/ReleaseNotesView';
import { RELEASE_NOTES_BUNDLE } from './releaseNotes';

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

    // In-app "What's New": register the view + a command to open it on demand.
    // (The once-per-update auto-open is wired in checkForVersionUpdate — U6.)
    this.registerView(
      RELEASE_NOTES_VIEW_TYPE,
      (leaf) => new ReleaseNotesView(leaf, RELEASE_NOTES_BUNDLE),
    );
    this.addCommand({
      id: 'show-release-notes',
      name: 'Show release notes',
      callback: () => {
        void this.activateReleaseNotesView();
      },
    });
  }

  onunload() {
    console.log('Unloading TaskNotes Gantt plugin');
    try { this.unregisterBases?.(); } catch {}
  }

  /**
   * Reveal the "What's New" view, reusing an existing leaf or opening a new tab.
   * The composition root owns this so both the command (U7) and the version-update
   * check (U6) share one activation path.
   */
  async activateReleaseNotesView(): Promise<void> {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | undefined = workspace.getLeavesOfType(RELEASE_NOTES_VIEW_TYPE)[0];
    if (!leaf) {
      leaf = workspace.getLeaf(true);
      await leaf.setViewState({ type: RELEASE_NOTES_VIEW_TYPE, active: true });
    }
    await workspace.revealLeaf(leaf);
  }
}
