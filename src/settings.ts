/* Exposes the small set of portable plugin settings in Obsidian. */

import { App, PluginSettingTab, Setting } from "obsidian";
import type StudyPlannerPlugin from "./main";
import { cleanRootFolder } from "./utils";

export class PlannerSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: StudyPlannerPlugin) { super(app, plugin); }
  display(): void {
    this.containerEl.empty();
    new Setting(this.containerEl).setName("Study Planner").setHeading();
    new Setting(this.containerEl).setName("Study root folder").setDesc("Changing this does not move existing notes.").addText(text => text.setValue(this.plugin.settings.rootFolder).onChange(async value => { this.plugin.settings.rootFolder = cleanRootFolder(value); await this.plugin.saveSettings(); }));
    new Setting(this.containerEl).setName("Default meeting time").addText(text => text.setValue(this.plugin.settings.defaultMeetingTime).onChange(async value => { this.plugin.settings.defaultMeetingTime = value; await this.plugin.saveSettings(); }));
  }
}
