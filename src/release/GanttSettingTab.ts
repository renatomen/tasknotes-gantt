/**
 * The plugin's settings tab. Currently exposes the "What's New" toggle; this is
 * the repo's first PluginSettingTab, structured so future settings slot in as
 * additional `new Setting(containerEl)` blocks.
 *
 * @module release/GanttSettingTab
 */
import { App, PluginSettingTab, Setting } from "obsidian";
import type ObsidianGanttPlugin from "../main";

export class GanttSettingTab extends PluginSettingTab {
  private readonly plugin: ObsidianGanttPlugin;

  constructor(app: App, plugin: ObsidianGanttPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Show release notes on update")
      .setDesc("Open the What's New panel automatically after the plugin updates.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.showReleaseNotesOnUpdate).onChange(async (value) => {
          this.plugin.settings.showReleaseNotesOnUpdate = value;
          await this.plugin.saveSettings();
        }),
      );
  }
}
