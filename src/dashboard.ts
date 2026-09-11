/* Renders the permanent all-seasons dashboard and selected season detail. */

import { ItemView, WorkspaceLeaf } from "obsidian";
import type StudyPlannerPlugin from "./main";
import type { MeetingRecord, SeasonRecord } from "./types";
import { recurrenceLabel, scheduledDates, todayIso } from "./utils";

export const DASHBOARD_VIEW = "study-planner-dashboard";

export class StudyDashboardView extends ItemView {
  private selectedSeasonId: string | null = null;
  constructor(leaf: WorkspaceLeaf, private plugin: StudyPlannerPlugin) { super(leaf); }
  getViewType(): string { return DASHBOARD_VIEW; }
  getDisplayText(): string { return "Study Planner"; }
  getIcon(): string { return "book-open-check"; }
  async onOpen(): Promise<void> { await this.render(); }

  async render(): Promise<void> {
    const root = this.containerEl.children[1] as HTMLElement; root.empty(); root.addClass("study-planner-dashboard");
    const overview = await this.plugin.repository.dashboard();
    const hero = root.createDiv({ cls: "study-planner-hero" });
    hero.createEl("div", { text: "MEN'S BIBLE STUDY", cls: "study-planner-eyebrow" });
    hero.createEl("h1", { text: "Study Planner" });
    hero.createEl("p", { text: "Plan seasons, recurring lessons, special events, teachers, goals, and attendance." });

    const globalActions = root.createDiv({ cls: "study-planner-actions study-planner-toolbar" });
    this.button(globalActions, "Create season", () => this.plugin.openSeason());
    this.button(globalActions, "Add member", () => this.plugin.openMember());
    this.button(globalActions, "Manage members", () => this.plugin.openMemberManager());
    this.button(globalActions, "Members report", () => void this.plugin.openMembersReport());
    this.button(globalActions, "Add leader", () => this.plugin.openTeacher());
    this.button(globalActions, "Manage leaders", () => this.plugin.openTeacherManager());

    root.createEl("h2", { text: "Seasons" });
    const seasonGrid = root.createDiv({ cls: "study-planner-grid study-planner-season-grid" });
    if (!overview.seasons.length) seasonGrid.createDiv({ cls: "study-planner-empty", text: "No seasons yet. Create the first season above." });
    for (const season of overview.seasons) this.seasonCard(seasonGrid, season);
    // Reserve this position so an opened season dashboard appears before the member roster.
    const seasonDetailRoot = this.selectedSeasonId ? root.createDiv({ cls: "study-planner-season-detail-slot" }) : null;

    root.createEl("h2", { text: "Members" });
    const roster = root.createDiv({ cls: "study-planner-member-roster" });
    const activeMembers = overview.members.filter(member => member.status === "active");
    if (!activeMembers.length) roster.createDiv({ cls: "study-planner-empty", text: overview.members.length ? "No active members. Use Manage members to reactivate someone." : "No members yet. Add the first roster member above." });
    const recentEvents = this.plugin.repository.getMeetings().filter(meeting => meeting.status === "completed").sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3);
    for (const member of activeMembers) {
      const row = roster.createDiv({ cls: "study-planner-member-row" });
      const identity = row.createDiv({ cls: "study-planner-member-identity" }); identity.createEl("strong", { text: member.name }); identity.createEl("span", { text: member.status, cls: `study-planner-badge study-planner-${member.status}` });
      const attendance = row.createDiv({ cls: "study-planner-recent-attendance" });
      for (const event of recentEvents) {
        const status = event.attendance[member.id]; const label = status === "present" ? "P" : status === "absent" ? "A" : status === "excused" ? "E" : "—";
        attendance.createEl("span", { text: label, cls: `study-planner-attendance-chip study-planner-attendance-${status ?? "none"}`, attr: { title: `${event.date}: ${event.title || "Bible Study"} — ${status ?? "not recorded"}` } });
      }
      if (!recentEvents.length) attendance.createEl("span", { text: "No completed events", cls: "study-planner-muted" });
      const actions = row.createDiv({ cls: "study-planner-actions study-planner-member-actions" }); this.button(actions, "Edit details", () => this.plugin.openMemberEditor(member)); this.button(actions, "See more", () => void this.plugin.openFile(member.path));
    }
    if (overview.season) this.attendanceByEvent(root, overview.season, overview.meetings, activeMembers.length);

    if (!this.selectedSeasonId) {
      const prompt = root.createDiv({ cls: "study-planner-empty study-planner-season-prompt" });
      prompt.createEl("strong", { text: "Choose a season" });
      prompt.createEl("p", { text: "Open a season dashboard above to manage its lessons, events, goals, and attendance." });
      return;
    }

    const summary = await this.plugin.repository.dashboard(this.selectedSeasonId);
    if (!summary.season) { this.selectedSeasonId = null; await this.render(); return; }
    const season = summary.season;
    const detail = (seasonDetailRoot ?? root).createDiv({ cls: "study-planner-season-detail" });
    const detailHeading = detail.createDiv({ cls: "study-planner-detail-heading" });
    const headingText = detailHeading.createDiv();
    headingText.createEl("div", { text: "SEASON DASHBOARD", cls: "study-planner-eyebrow" });
    headingText.createEl("h2", { text: season.name });
    headingText.createEl("p", { text: `${recurrenceLabel(season.recurrence, season.weekday)} · ${season.startDate} to ${season.endDate}` });
    this.button(detailHeading, "Close season view", () => { this.selectedSeasonId = null; void this.render(); });

    const actions = detail.createDiv({ cls: "study-planner-actions study-planner-toolbar" });
    this.button(actions, "Plan next meeting", () => this.plugin.openRecurringMeetingPicker(season.id));
    this.button(actions, "Create specific event/lesson", () => this.plugin.openMeeting(todayIso(), season.id, "specific"));
    this.button(actions, "Add goal", () => this.plugin.openGoal(season.id));
    this.button(actions, "Manage goals", () => this.plugin.openGoalManager(season.id));
    this.button(actions, "Refresh & open season plan", () => void this.plugin.openSeasonPlan(season.id));

    const metrics = detail.createDiv({ cls: "study-planner-metrics" });
    this.metric(metrics, String(summary.members.filter(item => item.status === "active").length), "Active members");
    this.metric(metrics, String(summary.meetings.filter(item => item.status === "completed").length), "Meetings held");
    this.metric(metrics, String(summary.goals.filter(item => item.status !== "completed").length), "Active goals");
    const completed = summary.meetings.filter(item => item.status === "completed");
    const recorded = completed.flatMap(meeting => Object.values(meeting.attendance));
    const present = recorded.filter(status => status === "present").length;
    this.metric(metrics, recorded.length ? `${Math.round((present / recorded.length) * 100)}%` : "—", "Season attendance");
    this.metric(metrics, summary.nextDate || "—", "Next recurring date");
    const recurringDates = scheduledDates(season.startDate, season.endDate, season.recurrence, season.weekday);
    const specificCount = summary.meetings.filter(meeting => meeting.scheduleKind === "specific").length;
    this.metric(metrics, String(recurringDates.length + specificCount), "Calendar events");
    const goalPanel = detail.createDiv({ cls: "study-planner-goal-panel" }); goalPanel.createEl("h3", { text: "Season goals" });
    if (!summary.goals.length) goalPanel.createEl("p", { text: "No season goals yet.", cls: "study-planner-muted" });
    for (const goal of summary.goals) { const row = goalPanel.createDiv({ cls: "study-planner-goal-row" }); row.createEl("strong", { text: goal.title }); row.createEl("span", { text: `${goal.status}${goal.focusAreas.length ? ` · ${goal.focusAreas.join(", ")}` : ""}`, cls: "study-planner-muted" }); const linked = summary.meetings.filter(meeting => meeting.goals.includes(goal.id)).length; row.createEl("small", { text: `${linked} linked lesson${linked === 1 ? "" : "s"}` }); this.button(row, "Open goal", () => void this.plugin.openGoalProfile(goal)); }
    this.seasonCalendar(detail, season, recurringDates, summary.meetings);
  }

  private seasonCard(parent: HTMLElement, season: SeasonRecord): void {
    const card = parent.createDiv({ cls: `study-planner-card study-planner-season-card${this.selectedSeasonId === season.id ? " is-selected" : ""}` });
    const heading = card.createDiv({ cls: "study-planner-card-heading" }); heading.createEl("h3", { text: season.name }); heading.createEl("span", { text: season.status, cls: `study-planner-badge study-planner-${season.status}` });
    card.createEl("p", { text: `${season.startDate} to ${season.endDate}` });
    card.createEl("p", { text: recurrenceLabel(season.recurrence, season.weekday) });
    const actions = card.createDiv({ cls: "study-planner-actions" });
    this.button(actions, "Open season dashboard", () => { this.selectedSeasonId = season.id; void this.render(); });
    this.button(actions, "Refresh & open plan", () => void this.plugin.openSeasonPlan(season.id));
  }

  private attendanceByEvent(root: HTMLElement, season: SeasonRecord, meetings: MeetingRecord[], activeMemberCount: number): void {
    const recurringDates = scheduledDates(season.startDate, season.endDate, season.recurrence, season.weekday);
    const recurring = recurringDates.map(date => meetings.find(meeting => meeting.scheduleKind === "recurring" && (meeting.originalDate || meeting.date) === date)).map((meeting, index) => ({ date: recurringDates[index], meeting }));
    const specific = meetings.filter(meeting => meeting.scheduleKind === "specific").map(meeting => ({ date: meeting.date, meeting }));
    const events = [...recurring, ...specific].sort((a, b) => a.date.localeCompare(b.date));
    root.createEl("h3", { text: `Overall attendance · ${season.name}` });
    const intro = root.createEl("p", { cls: "study-planner-muted", text: `${events.length} scheduled events in this season. Each bar shows people present for that event.` });
    intro.setAttr("aria-live", "polite");
    const chart = root.createDiv({ cls: "study-planner-report-chart study-planner-event-attendance-chart" });
    if (!events.length) { chart.createEl("span", { text: "No scheduled events fall within this season.", cls: "study-planner-muted" }); return; }
    const denominator = Math.max(1, activeMemberCount, ...events.map(item => Object.keys(item.meeting?.attendance ?? {}).length));
    for (const item of events) {
      const present = Object.values(item.meeting?.attendance ?? {}).filter(status => status === "present").length;
      const recorded = Object.keys(item.meeting?.attendance ?? {}).length;
      const date = new Date(`${item.date}T12:00:00`); const label = Number.isNaN(date.valueOf()) ? item.date : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
      const row = chart.createDiv({ cls: "study-planner-report-chart-row study-planner-event-attendance-row" });
      const details = row.createDiv({ cls: "study-planner-report-event-details" }); details.createEl("span", { text: label, cls: "study-planner-report-label" }); details.createEl("small", { text: item.meeting?.title || (item.meeting ? "Bible Study" : "Not yet planned") });
      row.createEl("progress", { cls: "study-planner-report-progress", attr: { max: String(denominator), value: String(present), title: `${present} present${recorded ? ` · ${recorded} recorded` : ""}` } });
      row.createEl("strong", { text: `${present}/${activeMemberCount || recorded || 0}` });
    }
  }

  private seasonCalendar(root: HTMLElement, season: SeasonRecord, recurringDates: string[], meetings: MeetingRecord[]): void {
    const specific = meetings.filter(meeting => meeting.scheduleKind === "specific");
    const items: Array<{ date: string; originalDate: string; kind: "recurring" | "specific"; meeting?: MeetingRecord }> = recurringDates.map(date => ({ date: meetings.find(meeting => meeting.scheduleKind === "recurring" && (meeting.originalDate || meeting.date) === date)?.date ?? date, originalDate: date, kind: "recurring", meeting: meetings.find(meeting => meeting.scheduleKind === "recurring" && (meeting.originalDate || meeting.date) === date) }));
    items.push(...specific.map(meeting => ({ date: meeting.date, originalDate: meeting.originalDate || meeting.date, kind: "specific" as const, meeting })));
    items.sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind));
    const heading = root.createDiv({ cls: "study-planner-calendar-heading" }); heading.createEl("h3", { text: "Season calendar" }); heading.createEl("span", { text: `${items.length} events · ${recurringDates.length} recurring · ${specific.length} specific`, cls: "study-planner-muted" });
    const list = root.createDiv({ cls: "study-planner-season-calendar" });
    for (const item of items) {
      const row = list.createDiv({ cls: "study-planner-calendar-row" });
      const date = new Date(`${item.date}T12:00:00`); const friendly = Number.isNaN(date.valueOf()) ? item.date : date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
      row.createEl("strong", { text: friendly, cls: "study-planner-calendar-date" });
      const details = row.createDiv({ cls: "study-planner-calendar-details" }); details.createEl("span", { text: item.meeting?.title || (item.kind === "specific" ? "Specific event" : "Not yet planned") });
      const status = item.meeting?.status || "unplanned"; const moved = item.meeting && item.date !== item.originalDate ? ` · originally ${item.originalDate}` : "";
      details.createEl("small", { text: `${item.kind === "specific" ? "Specific" : "Recurring"} · ${status}${moved}` });
      const actions = row.createDiv({ cls: "study-planner-actions study-planner-calendar-actions" });
      if (!item.meeting) this.button(actions, "Plan", () => void this.plugin.openMeeting(item.originalDate, season.id, "recurring"));
      else {
        this.button(actions, "Open", () => void this.plugin.openFile(item.meeting!.path));
        if (item.meeting.status !== "cancelled") this.button(actions, item.meeting.status === "completed" ? "Attendance" : "Take attendance", () => this.plugin.openAttendance(item.meeting!));
        if (item.meeting.status === "planned") { this.button(actions, "Reschedule", () => this.plugin.rescheduleMeeting(item.meeting!)); this.button(actions, "Cancel", () => void this.plugin.cancelMeeting(item.meeting!)); }
      }
    }
  }

  private button(parent: HTMLElement, label: string, action: () => void): void { parent.createEl("button", { text: label, cls: label === "Create season" || label === "Plan next meeting" ? "mod-cta" : "" }).onclick = action; }
  private metric(parent: HTMLElement, value: string, label: string): void { const box = parent.createDiv({ cls: "study-planner-metric" }); box.createEl("strong", { text: value }); box.createEl("span", { text: label }); }
}
