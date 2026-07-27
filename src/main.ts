/* Plugin entry point registering the dashboard, commands, forms, and refresh events. */

import { Notice, Plugin, TFile } from "obsidian";
import { DASHBOARD_VIEW, StudyDashboardView } from "./dashboard";
import { AttendanceModal, GoalManagerModal, GoalModal, MeetingModal, MemberEditModal, MemberManagerModal, MemberModal, PersonModal, RescheduleModal, SchedulePickerModal, SeasonModal } from "./modals";
import { StudyRepository } from "./repository";
import { PlannerSettingTab } from "./settings";
import { DEFAULT_SETTINGS, type MeetingKind, type MeetingRecord, type MemberRecord, type PlannerSettings } from "./types";
import { todayIso } from "./utils";

export default class StudyPlannerPlugin extends Plugin {
  settings: PlannerSettings = DEFAULT_SETTINGS;
  repository!: StudyRepository;
  private refreshTimer: number | null = null;
  private summaryTimer: number | null = null;

  async onload(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<PlannerSettings> | null);
    this.repository = new StudyRepository(this.app, this.settings);
    this.registerView(DASHBOARD_VIEW, leaf => new StudyDashboardView(leaf, this));
    this.addSettingTab(new PlannerSettingTab(this.app, this));
    this.addRibbonIcon("book-open-check", "Open Study Planner", () => void this.openDashboard());
    this.addCommand({ id: "open-dashboard", name: "Open dashboard", callback: () => void this.openDashboard() });
    this.addCommand({ id: "create-season", name: "Create study season", callback: () => this.openSeason() });
    this.addCommand({ id: "plan-next-lesson", name: "Plan next meeting", callback: () => this.openRecurringMeetingPicker() });
    this.addCommand({ id: "create-specific-event", name: "Create specific event or lesson", callback: () => void this.openMeeting(todayIso(), undefined, "specific") });
    this.addCommand({ id: "add-member", name: "Add roster member", callback: () => this.openMember() });
    this.addCommand({ id: "manage-members", name: "Manage members", callback: () => this.openMemberManager() });
    this.addCommand({ id: "open-members-report", name: "Open members report", callback: () => void this.openMembersReport() });
    this.addCommand({ id: "add-teacher", name: "Add teacher", callback: () => this.openTeacher() });
    this.addCommand({ id: "add-season-goal", name: "Add season goal", callback: () => this.openGoal() });
    this.addCommand({ id: "manage-season-goals", name: "Manage season goals", callback: () => this.openGoalManager() });
    this.addCommand({ id: "rebuild-summaries", name: "Rebuild season summaries", callback: async () => { await this.repository.rebuildAll(); new Notice("Season summaries rebuilt."); await this.refreshDashboard(); } });
    this.registerEvent(this.app.metadataCache.on("changed", file => { if (file.path.startsWith(`${this.repository.root}/`)) this.scheduleRefresh(); if (this.isSummarySource(file.path)) this.scheduleSummaryRebuild(); }));
    this.registerEvent(this.app.vault.on("delete", file => { if (file.path.startsWith(`${this.repository.root}/`)) this.scheduleRefresh(); if (this.isSummarySource(file.path)) this.scheduleSummaryRebuild(); }));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => { if (file.path.startsWith(`${this.repository.root}/`) || oldPath.startsWith(`${this.repository.root}/`)) this.scheduleRefresh(); if (this.isSummarySource(file.path) || this.isSummarySource(oldPath)) this.scheduleSummaryRebuild(); }));
  }

  async onunload(): Promise<void> { if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer); if (this.summaryTimer !== null) window.clearTimeout(this.summaryTimer); this.app.workspace.detachLeavesOfType(DASHBOARD_VIEW); }
  async saveSettings(): Promise<void> { await this.saveData(this.settings); this.repository.updateSettings(this.settings); await this.refreshDashboard(); }

  async openDashboard(): Promise<void> {
    await this.repository.initialize(); await this.repository.rebuildAll();
    let leaf = this.app.workspace.getLeavesOfType(DASHBOARD_VIEW)[0];
    if (!leaf) { leaf = this.app.workspace.getLeaf("tab"); await leaf.setViewState({ type: DASHBOARD_VIEW, active: true }); }
    await this.app.workspace.revealLeaf(leaf);
  }

  openSeason(): void { new SeasonModal(this.app, this.settings.defaultMeetingTime, async input => this.run("Season created.", async () => { await this.repository.createSeason(input); })).open(); }
  openMember(): void { new MemberModal(this.app, async input => this.run("Member added.", async () => { await this.repository.createMember(input); })).open(); }
  openMemberManager(): void {
    new MemberManagerModal(this.app, this.repository.getMemberReport(), member => void this.openFile(member.path), member => this.openMemberEditor(member), async (member, active) => this.run(active ? "Member marked active." : "Member marked inactive.", async () => { await this.repository.setMemberStatus(member.path, active); await this.repository.rebuildAll(); })).open();
  }
  openMemberEditor(member: MemberRecord): void { new MemberEditModal(this.app, member, async input => this.run("Member details updated.", async () => { await this.repository.updateMember(member.path, input); await this.repository.rebuildAll(); })).open(); }
  async openMembersReport(): Promise<void> { await this.run("Members report updated.", async () => { const file = await this.repository.rebuildMembersReport(); await this.openFile(file.path); }); }
  openTeacher(): void { new PersonModal(this.app, "Add teacher", async input => this.run("Teacher added.", async () => { await this.repository.createTeacher(input); })).open(); }

  async openMeeting(date?: string, seasonId?: string, kind: MeetingKind = "recurring"): Promise<void> {
    const summary = await this.repository.dashboard(seasonId);
    if (!summary.season) { new Notice("Create a study season first."); this.openSeason(); return; }
    if (kind === "recurring" && !date) { this.openRecurringMeetingPicker(summary.season.id); return; }
    const plannedDate = date || todayIso();
    if (!plannedDate) { new Notice("No remaining recurring dates in this season."); return; }
    new MeetingModal(this.app, summary.season, plannedDate, kind, summary.teachers, async input => this.run(kind === "specific" ? "Specific event created." : "Lesson created.", async () => { const file = await this.repository.createMeeting(input); await this.repository.rebuildSeasonSummary(summary.season!.id); await this.openFile(file.path); })).open();
  }

  openRecurringMeetingPicker(seasonId?: string): void {
    const season = seasonId ? this.repository.getSeasons().find(item => item.id === seasonId) : this.repository.activeSeason();
    if (!season) { new Notice("Create a study season first."); this.openSeason(); return; }
    new SchedulePickerModal(this.app, season, this.repository.getPotentialMeetingDates(season.id), date => void this.openMeeting(date, season.id, "recurring")).open();
  }

  openGoal(seasonId?: string): void {
    const season = seasonId ? this.repository.getSeasons().find(item => item.id === seasonId) : this.repository.activeSeason(); if (!season) { new Notice("Create a study season first."); return; }
    new GoalModal(this.app, season.id, async input => this.run("Season goal created.", async () => { await this.repository.createGoal(input); await this.repository.rebuildSeasonSummary(season.id); })).open();
  }

  openGoalManager(seasonId?: string): void {
    const season = seasonId ? this.repository.getSeasons().find(item => item.id === seasonId) : this.repository.activeSeason(); if (!season) { new Notice("Create a study season first."); return; }
    const goals = this.repository.getGoals(season.id);
    new GoalManagerModal(this.app, goals, goal => void this.openFile(goal.path), async (goal, complete, note) => this.run(complete ? "Goal completed." : "Goal reopened.", async () => {
      const meeting = [...this.repository.getMeetings(season.id)].filter(item => item.status === "completed").sort((a, b) => b.date.localeCompare(a.date))[0];
      await this.repository.updateGoal(goal.path, complete, note, meeting?.path); await this.repository.rebuildSeasonSummary(season.id);
    })).open();
  }

  openAttendance(meeting: MeetingRecord): void {
    new AttendanceModal(this.app, this.repository.getMembers(), meeting.attendance, meeting.guests, async (attendance, guests) => this.run("Attendance saved.", async () => {
      await this.repository.recordAttendance(meeting.path, attendance, guests); await this.repository.rebuildSeasonSummary(meeting.seasonId);
    })).open();
  }

  async cancelMeeting(meeting: MeetingRecord): Promise<void> { await this.run("Meeting cancelled.", async () => { await this.repository.cancelMeeting(meeting.path); await this.repository.rebuildSeasonSummary(meeting.seasonId); }); }
  rescheduleMeeting(meeting: MeetingRecord): void {
    new RescheduleModal(this.app, meeting.date, async date => this.run("Meeting rescheduled.", async () => { await this.repository.rescheduleMeeting(meeting.path, date); await this.repository.rebuildSeasonSummary(meeting.seasonId); })).open();
  }

  async openFile(path: string): Promise<void> { const file = this.app.vault.getAbstractFileByPath(path); if (file instanceof TFile) await this.app.workspace.getLeaf("tab").openFile(file); }

  private async run(message: string, action: () => Promise<void>): Promise<void> {
    try { await action(); new Notice(message); await this.refreshDashboard(); } catch (error) { console.error(error); new Notice(error instanceof Error ? error.message : "The operation could not be completed."); }
  }
  private scheduleRefresh(): void {
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      void this.refreshDashboard().catch(error => this.reportError("Could not refresh the dashboard", error));
    }, 350);
  }
  private scheduleSummaryRebuild(): void {
    if (this.summaryTimer !== null) window.clearTimeout(this.summaryTimer);
    this.summaryTimer = window.setTimeout(() => {
      this.summaryTimer = null;
      void this.repository.rebuildAll()
        .then(() => this.refreshDashboard())
        .catch(error => this.reportError("Could not rebuild summaries", error));
    }, 600);
  }
  private isSummarySource(path: string): boolean { return path.startsWith(`${this.repository.root}/`) && (/\/(Meetings|Goals)\//.test(path) || /\/(Members|Teachers)\//.test(path)); }
  private async refreshDashboard(): Promise<void> { const view = this.app.workspace.getLeavesOfType(DASHBOARD_VIEW)[0]?.view; if (view instanceof StudyDashboardView) await view.render(); }
  private reportError(prefix: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[Study Planner] ${prefix}`, error);
    new Notice(`${prefix}: ${message}`);
  }
}
