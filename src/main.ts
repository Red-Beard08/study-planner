/* Plugin entry point registering the dashboard, commands, forms, and refresh events. */

import { App, Notice, Plugin, TFile } from "obsidian";
import { registerDashboardModule, registerDashboardWidget } from "./dashboard-bridge";
import { DASHBOARD_VIEW, StudyDashboardView } from "./dashboard";
import { AttendanceModal, GoalEditModal, GoalManagerModal, GoalModal, MeetingModal, MemberEditModal, MemberManagerModal, MemberModal, PersonModal, RescheduleModal, SchedulePickerModal, SeasonModal, TeacherEditModal, TeacherManagerModal } from "./modals";
import { StudyRepository } from "./repository";
import { PlannerSettingTab } from "./settings";
import { DEFAULT_SETTINGS, type GoalRecord, type MeetingKind, type MeetingRecord, type MemberRecord, type PlannerSettings, type TeacherRecord } from "./types";
import { todayIso } from "./utils";

function dashboardCommand(app: App): string {
  const current = "study-planner:open-dashboard";
  const commandApi = (app as App & { commands?: { commands?: Record<string, { name?: string }> } }).commands;
  const alternate = Object.keys(commandApi?.commands ?? {}).find(id =>
    id !== current && id.endsWith(":open-dashboard") && /study[- ]planner/i.test(`${id} ${commandApi?.commands?.[id]?.name ?? ""}`)
  );
  return alternate ?? current;
}

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
    this.addCommand({ id: "refresh-active-season-plan", name: "Refresh active season plan", callback: () => void this.openSeasonPlan() });
    this.addCommand({ id: "add-teacher", name: "Add teacher", callback: () => this.openTeacher() });
    this.addCommand({ id: "manage-teachers", name: "Manage leaders", callback: () => this.openTeacherManager() });
    this.addCommand({ id: "refresh-leader-goal-summaries", name: "Refresh leader and goal summaries", callback: () => void this.refreshLeaderGoalSummaries() });
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
  async openMembersReport(): Promise<void> { await this.run("Members report refreshed.", async () => { await this.repository.rebuildAll(); const file = this.app.vault.getAbstractFileByPath(this.repository.membersReportPath); if (file instanceof TFile) await this.openFile(file.path); else throw new Error("Members Report could not be created."); }); }
  async openSeasonPlan(seasonId?: string): Promise<void> {
    const season = seasonId ? this.repository.getSeasons().find(item => item.id === seasonId) : this.repository.activeSeason();
    if (!season) { new Notice("Create a study season first."); this.openSeason(); return; }
    await this.run("Season plan refreshed.", async () => { await this.repository.rebuildSeasonSummary(season.id); await this.openFile(season.planPath); });
  }
  openTeacher(): void { new PersonModal(this.app, "Add leader", this.repository.getFocusAreas(), async input => this.run("Leader added.", async () => { await this.repository.createTeacher(input); await this.repository.rebuildAll(); })).open(); }
  openTeacherManager(): void { new TeacherManagerModal(this.app, this.repository.getTeachers(), teacher => void this.openTeacherProfile(teacher), teacher => this.openTeacherEditor(teacher), async (teacher, active) => this.run(active ? "Leader marked active." : "Leader marked inactive.", async () => { await this.repository.updateTeacher(teacher.path, { name: teacher.name, strengths: teacher.strengths, status: active ? "active" : "inactive" }); await this.repository.rebuildAll(); })).open(); }
  openTeacherEditor(teacher: TeacherRecord): void { new TeacherEditModal(this.app, teacher, this.repository.getFocusAreas(), async input => this.run("Leader updated.", async () => { await this.repository.updateTeacher(teacher.path, input); await this.repository.rebuildAll(); })).open(); }
  async openTeacherProfile(teacher: TeacherRecord): Promise<void> { await this.run("Leader profile refreshed.", async () => { await this.repository.rebuildTeacherProfiles(); await this.openFile(teacher.path); }); }
  async refreshLeaderGoalSummaries(): Promise<void> { await this.run("Leader and goal summaries refreshed.", async () => { await this.repository.rebuildTeacherProfiles(); await this.repository.rebuildGoalProfiles(); for (const season of this.repository.getSeasons()) await this.repository.rebuildSeasonSummary(season.id); }); }

  async openMeeting(date?: string, seasonId?: string, kind: MeetingKind = "recurring"): Promise<void> {
    const summary = await this.repository.dashboard(seasonId);
    if (!summary.season) { new Notice("Create a study season first."); this.openSeason(); return; }
    if (kind === "recurring" && !date) { this.openRecurringMeetingPicker(summary.season.id); return; }
    const plannedDate = date || todayIso();
    if (!plannedDate) { new Notice("No remaining recurring dates in this season."); return; }
    new MeetingModal(this.app, summary.season, plannedDate, kind, summary.teachers, summary.goals, async input => this.run(kind === "specific" ? "Specific event created." : "Lesson created.", async () => { const file = await this.repository.createMeeting(input); await this.repository.rebuildAll(); await this.openFile(file.path); })).open();
  }

  openRecurringMeetingPicker(seasonId?: string): void {
    const season = seasonId ? this.repository.getSeasons().find(item => item.id === seasonId) : this.repository.activeSeason();
    if (!season) { new Notice("Create a study season first."); this.openSeason(); return; }
    new SchedulePickerModal(this.app, season, this.repository.getPotentialMeetingDates(season.id), date => void this.openMeeting(date, season.id, "recurring")).open();
  }

  openGoal(seasonId?: string): void {
    const season = seasonId ? this.repository.getSeasons().find(item => item.id === seasonId) : this.repository.activeSeason(); if (!season) { new Notice("Create a study season first."); return; }
    new GoalModal(this.app, season.id, this.repository.getFocusAreas(), async input => this.run("Season goal created.", async () => { await this.repository.createGoal(input); await this.repository.rebuildAll(); })).open();
  }

  openGoalManager(seasonId?: string): void {
    const season = seasonId ? this.repository.getSeasons().find(item => item.id === seasonId) : this.repository.activeSeason(); if (!season) { new Notice("Create a study season first."); return; }
    const goals = this.repository.getGoals(season.id);
    new GoalManagerModal(this.app, goals, goal => void this.openGoalProfile(goal), goal => this.openGoalEditor(goal), async (goal, complete, note) => this.run(complete ? "Goal completed." : "Goal reopened.", async () => {
      const meeting = [...this.repository.getMeetings(season.id)].filter(item => item.status === "completed").sort((a, b) => b.date.localeCompare(a.date))[0];
      await this.repository.updateGoal(goal.path, complete, note, meeting?.path); await this.repository.rebuildSeasonSummary(season.id);
    })).open();
  }
  openGoalEditor(goal: GoalRecord): void { new GoalEditModal(this.app, goal, this.repository.getFocusAreas(), async input => this.run("Goal updated.", async () => { await this.repository.updateGoalDetails(goal.path, input); await this.repository.rebuildAll(); })).open(); }
  async openGoalProfile(goal: GoalRecord): Promise<void> { await this.run("Goal profile refreshed.", async () => { await this.repository.rebuildGoalProfiles(); await this.openFile(goal.path); }); }

  openAttendance(meeting: MeetingRecord): void {
    const leaders = (["primary", "supporting"] as const).map(role => this.repository.teacherForMeeting(meeting, role)).filter((teacher): teacher is TeacherRecord => Boolean(teacher));
    new AttendanceModal(this.app, this.repository.getMembers(), leaders, meeting.attendance, meeting.leaderAttendance, meeting.guests, async (attendance, guests, leaderAttendance) => this.run("Attendance saved.", async () => {
      await this.repository.recordAttendance(meeting.path, attendance, guests, leaderAttendance); await this.repository.rebuildAll();
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
// Red-Beard Dashboard integration: launcher module and independent summary widget.
const rbDisposals = new WeakMap<object, () => void>();
const rbOnload = StudyPlannerPlugin.prototype.onload;
StudyPlannerPlugin.prototype.onload = async function(this: StudyPlannerPlugin) {
  await rbOnload.call(this);
  const disposals = [
    registerDashboardModule(this.app, { id: "study-planner", name: "Study Planner", command: dashboardCommand(this.app), icon: "book-open-check", description: "Current season, lessons, and attendance.", order: 20 }),
    registerDashboardWidget(this.app, { id: "study-planner/overview", name: "Study Planner", description: "Current season, lessons, and attendance.", icon: "book-open-check", defaultLayout: { w: 4, mobileW: 12, h: 2, order: 40 }, mobile: "responsive", render: (_ctx, container) => {
      container.createEl("p", { text: "Current season, lessons, and attendance." });
      const button = container.createEl("button", { text: "Open Study Planner" });
      button.onclick = () => {
        const commandId = dashboardCommand(this.app);
        const commands = (this.app as typeof this.app & { commands?: { executeCommandById?: (id: string) => boolean } }).commands;
        if (!commands?.executeCommandById?.(commandId)) void this.openDashboard();
      };
    } })
  ];
  rbDisposals.set(this, () => disposals.forEach(dispose => dispose()));
};
const rbOnunload = StudyPlannerPlugin.prototype.onunload;
StudyPlannerPlugin.prototype.onunload = function(this: StudyPlannerPlugin) {
  rbDisposals.get(this)?.();
 return rbOnunload ? rbOnunload.call(this) : undefined;
};
