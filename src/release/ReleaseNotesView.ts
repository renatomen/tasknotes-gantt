/**
 * The in-app "What's New" view: a registered workspace view that renders the
 * bundled per-version release notes (src/releaseNotes.ts) as collapsible
 * sections. Opened automatically once after an update (see src/main.ts) and on
 * demand via the "Show release notes" command.
 *
 * Interaction states are explicit so the view never renders ambiguously: an empty
 * bundle shows a fallback line; expand defaults degrade for single-entry / no-
 * current bundles; the same full bundle renders regardless of how it was opened.
 * Collapsible sections use native <details>/<summary> for keyboard + screen-reader
 * support. Raw HTML in notes content is stripped upstream (the generator), so the
 * markdown rendered here cannot smuggle live markup.
 *
 * @module release/ReleaseNotesView
 */
import { ItemView, MarkdownRenderer, WorkspaceLeaf } from "obsidian";
import { RELEASE_NOTES_BUNDLE, type ReleaseNoteVersion } from "../releaseNotes";
import { REPO_URL, transformReleaseNoteIssueLinks } from "./releaseNoteLinks";

export const RELEASE_NOTES_VIEW_TYPE = "tasknotes-gantt-release-notes";

export class ReleaseNotesView extends ItemView {
  private readonly bundle: ReleaseNoteVersion[];

  constructor(leaf: WorkspaceLeaf, bundle: ReleaseNoteVersion[] = RELEASE_NOTES_BUNDLE) {
    super(leaf);
    this.bundle = bundle;
  }

  getViewType(): string {
    return RELEASE_NOTES_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "TaskNotes Gantt — What's New";
  }

  getIcon(): string {
    return "scroll-text";
  }

  /** Indices to expand by default: current + first prior, with degenerate fallbacks. */
  private expandedIndices(): Set<number> {
    const expanded = new Set<number>();
    if (this.bundle.length === 0) return expanded;
    const currentIdx = this.bundle.findIndex((v) => v.isCurrent);
    if (this.bundle.length === 1 || currentIdx === -1) {
      expanded.add(0);
    } else {
      expanded.add(currentIdx);
      if (currentIdx + 1 < this.bundle.length) expanded.add(currentIdx + 1);
    }
    return expanded;
  }

  override async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("tng-release-notes");
    const container = root.createDiv({ cls: "tng-release-notes-body" });

    if (this.bundle.length === 0) {
      container.createEl("p", { text: "No release notes available." });
      return;
    }

    const expanded = this.expandedIndices();
    for (let i = 0; i < this.bundle.length; i++) {
      const v = this.bundle[i];
      if (!v) continue;
      const details = container.createEl("details", { cls: "tng-release-version" });
      if (expanded.has(i)) details.setAttribute("open", "");
      const summary = details.createEl("summary", { cls: "tng-release-summary" });
      summary.createSpan({ cls: "tng-release-version-name", text: v.version });
      if (v.date) {
        const dateEl = summary.createSpan({ cls: "tng-release-version-date", text: v.date });
        dateEl.style.marginLeft = "0.5em";
        dateEl.style.opacity = "0.7";
      }
      if (v.isCurrent) {
        const badge = summary.createSpan({ cls: "tng-release-version-current", text: "Current" });
        badge.style.marginLeft = "0.5em";
        badge.style.fontSize = "0.8em";
        badge.style.opacity = "0.8";
      }
      const body = details.createDiv({ cls: "tng-release-version-content" });
      await MarkdownRenderer.render(this.app, transformReleaseNoteIssueLinks(v.content), body, "", this);
    }

    const footer = container.createDiv({ cls: "tng-release-footer" });
    footer.style.marginTop = "1em";
    footer.style.opacity = "0.8";
    footer.createEl("a", { text: "View all releases on GitHub", attr: { href: `${REPO_URL}/releases` } });
    footer.createSpan({
      text: '  ·  Reopen anytime via the command palette: "Show release notes".',
    });
  }

  override async onClose(): Promise<void> {
    this.contentEl.empty();
  }
}
