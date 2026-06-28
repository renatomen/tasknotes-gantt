
import { Plugin, WorkspaceLeaf } from 'obsidian';
import { registerBasesGantt } from './bases/register';
import { ReleaseNotesView, RELEASE_NOTES_VIEW_TYPE } from './release/ReleaseNotesView';
import { RELEASE_NOTES_BUNDLE } from './releaseNotes';
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  planWhatsNew,
  type GanttPluginSettings,
} from './release/settings';
import { GanttSettingTab } from './release/GanttSettingTab';

/** Delay before the post-update "What's New" check, so the UI is ready first. */
const WHATS_NEW_AUTO_OPEN_DELAY_MS = 1500;

export default class ObsidianGanttPlugin extends Plugin {
  private unregisterBases: (() => void) | null = null;
  settings: GanttPluginSettings = { ...DEFAULT_SETTINGS };
  /** Overridable so tests/e2e don't race the real timer. */
  whatsNewAutoOpenDelayMs = WHATS_NEW_AUTO_OPEN_DELAY_MS;
  private versionCheckTimer: number | null = null;
  private versionChecked = false;

  async onload() {
    console.log('Loading TaskNotes Gantt plugin');

    this.settings = normalizeSettings(await this.loadData());

    // MVP: Register Obsidian Bases custom view "Gantt (OG)" (no chart yet)
    try {
      this.unregisterBases = registerBasesGantt(this);
    } catch (e) {
      console.warn('[Gantt] Failed to start Bases registration', e);
    }

    // In-app "What's New": register the view + a command to open it on demand.
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
    this.addSettingTab(new GanttSettingTab(this.app, this));

    // Auto-open once after an update, after the layout settles.
    this.app.workspace.onLayoutReady(() => {
      this.versionCheckTimer = window.setTimeout(() => {
        void this.checkForVersionUpdate();
      }, this.whatsNewAutoOpenDelayMs);
    });
  }

  onunload() {
    console.log('Unloading TaskNotes Gantt plugin');
    if (this.versionCheckTimer !== null) {
      window.clearTimeout(this.versionCheckTimer);
      this.versionCheckTimer = null;
    }
    try { this.unregisterBases?.(); } catch {}
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  /**
   * Show the "What's New" view once when the installed version has increased
   * since it was last seen, then record the current version. Guarded so it runs
   * at most once per load and never writes redundantly. Best-effort: a failure is
   * logged, never thrown, so plugin load is unaffected.
   */
  async checkForVersionUpdate(): Promise<void> {
    if (this.versionChecked) return;
    this.versionChecked = true;
    try {
      const current = this.manifest.version;
      const plan = planWhatsNew({
        lastSeen: this.settings.lastSeenVersion,
        current,
        showReleaseNotesOnUpdate: this.settings.showReleaseNotesOnUpdate,
      });
      if (plan.showView) {
        await this.activateReleaseNotesView();
      }
      if (plan.recordVersion && this.settings.lastSeenVersion !== current) {
        this.settings.lastSeenVersion = current;
        await this.saveSettings();
      }
    } catch (e) {
      console.warn('[Gantt] version-update check failed', e);
    }
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
