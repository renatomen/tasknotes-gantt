/**
 * The in-app "What's New" view: a registered workspace view that renders the
 * bundled per-version release notes (src/releaseNotes.ts) as collapsible
 * cards. Opened automatically once after an update (see src/main.ts) and on
 * demand via the "Show release notes" command.
 *
 * Interaction states are explicit so the view never renders ambiguously: an empty
 * bundle shows a fallback line; expand defaults degrade for single-entry / no-
 * current bundles; the same full bundle renders regardless of how it was opened.
 * Collapsible sections use native <details>/<summary> for keyboard + screen-reader
 * support; all visual styling lives in release-notes.css (theme-adaptive, no inline
 * styles). Raw HTML in notes content is stripped upstream (the generator), so the
 * markdown rendered here cannot smuggle live markup.
 *
 * @module release/ReleaseNotesView
 */
import { ItemView, MarkdownRenderer, WorkspaceLeaf } from "obsidian";
import { RELEASE_NOTES_BUNDLE, type ReleaseNoteVersion } from "../releaseNotes";
import { REPO_URL, transformReleaseNoteIssueLinks } from "./releaseNoteLinks";
import { defaultExpandedIndices } from "./releaseNotesExpand";
import { formatReleaseDate } from "./formatReleaseDate";
import "./release-notes.css";

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

  override async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("tng-release-notes");
    const container = root.createDiv({ cls: "tng-release-notes-body" });

    if (this.bundle.length === 0) {
      container.createEl("p", { text: "No release notes available." });
      return;
    }

    this.renderIntro(container);

    const expanded = defaultExpandedIndices(this.bundle);
    for (let i = 0; i < this.bundle.length; i++) {
      const v = this.bundle[i];
      if (!v) continue;
      const details = container.createEl("details", { cls: "tng-release-version" });
      if (expanded.has(i)) details.setAttribute("open", "");

      const summary = details.createEl("summary", { cls: "tng-release-summary" });
      summary.createSpan({ cls: "tng-release-version-name", text: v.version });
      const formattedDate = formatReleaseDate(v.date);
      if (formattedDate) {
        summary.createSpan({ cls: "tng-release-version-date", text: formattedDate });
      }
      if (v.isCurrent) {
        summary.createSpan({ cls: "tng-release-version-current", text: "Current" });
      }
      // Chevron is the last child so `margin-left: auto` pushes it to the right edge.
      summary.createSpan({ cls: "tng-release-chevron" });

      const body = details.createDiv({ cls: "tng-release-version-content" });
      await MarkdownRenderer.render(this.app, transformReleaseNoteIssueLinks(v.content), body, "", this);
    }

    this.renderFooter(container);
  }

  /** Intro paragraph inviting feedback, with GitHub / issues / star links (R9). */
  private renderIntro(container: HTMLElement): void {
    const intro = container.createEl("p", { cls: "tng-release-intro" });
    intro.appendText("Thanks for using TaskNotes Gantt. Found a bug or have an idea? ");
    intro.createEl("a", { text: "Open an issue", attr: { href: `${REPO_URL}/issues` } });
    intro.appendText(", browse ");
    intro.createEl("a", { text: "the repository", attr: { href: REPO_URL } });
    intro.appendText(", or ");
    intro.createEl("a", { text: "star it on GitHub", attr: { href: REPO_URL } });
    intro.appendText(".");
  }

  private renderFooter(container: HTMLElement): void {
    const footer = container.createDiv({ cls: "tng-release-footer" });
    footer.createEl("a", { text: "View all releases on GitHub", attr: { href: `${REPO_URL}/releases` } });
    footer.createSpan({
      text: '  ·  Reopen anytime via the command palette: "Show release notes".',
    });
  }

  override async onClose(): Promise<void> {
    this.contentEl.empty();
  }
}
