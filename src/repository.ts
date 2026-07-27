/* Owns the portable Markdown data model and all vault reads and writes. */

import { App, TFile, normalizePath } from "obsidian";
import type { AttendanceStatus, DashboardSummary, GoalInput, GoalRecord, MeetingInput, MeetingRecord, MemberInput, MemberRecord, MemberReportRow, MemberUpdateInput, PersonInput, PlannerSettings, SeasonInput, SeasonRecord, TeacherRecord } from "./types";
import { cleanRootFolder, formatIso, nextScheduledDate, safeName, scheduledDates, todayIso, uniqueId, yamlString } from "./utils";

type Frontmatter = Record<string, unknown>;

export class StudyRepository {
  constructor(private app: App, private settings: PlannerSettings) {}

  get root(): string { return normalizePath(cleanRootFolder(this.settings.rootFolder)); }
  get membersReportPath(): string { return normalizePath(`${this.root}/Members Report.md`); }
  updateSettings(settings: PlannerSettings): void { this.settings = settings; }

  async initialize(): Promise<void> {
    for (const path of [this.root, `${this.root}/Members`, `${this.root}/Teachers`, `${this.root}/Seasons`, `${this.root}/Templates`]) {
      if (!this.app.vault.getAbstractFileByPath(path)) await this.app.vault.createFolder(path);
    }
  }

  private files(): TFile[] { return this.app.vault.getMarkdownFiles().filter(file => file.path.startsWith(`${this.root}/`)); }
  private fm(file: TFile): Frontmatter { return (this.app.metadataCache.getFileCache(file)?.frontmatter ?? {}) as Frontmatter; }
  private text(fm: Frontmatter, key: string): string { const value = fm[key]; return typeof value === "string" || typeof value === "number" ? String(value) : ""; }
  private list(fm: Frontmatter, key: string): string[] { const value = fm[key]; return Array.isArray(value) ? value.map(String) : []; }
  private attendance(fm: Frontmatter): Record<string, AttendanceStatus> {
    const value = fm.attendance;
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, status]) => [key, String(status) as AttendanceStatus]));
  }

  getMembers(): MemberRecord[] {
    return this.files().filter(file => file.name !== "Members Hub.md" && this.fm(file).type === "mens-study-member").map(file => {
      const fm = this.fm(file); const childrenValue = fm.has_children;
      return { id: this.text(fm, "member_id"), name: this.text(fm, "name"), status: this.text(fm, "status") || "active", maritalStatus: (this.text(fm, "marital_status") || "single") as MemberRecord["maritalStatus"], hasChildren: childrenValue === true || String(childrenValue).toLowerCase() === "true" || String(childrenValue).toLowerCase() === "yes", homeChurch: this.text(fm, "home_church"), path: file.path };
    }).sort((a, b) => a.name.localeCompare(b.name));
  }

  getTeachers(): TeacherRecord[] {
    return this.files().filter(file => this.fm(file).type === "mens-study-teacher").map(file => {
      const fm = this.fm(file); return { id: this.text(fm, "teacher_id"), name: this.text(fm, "name"), status: this.text(fm, "status") || "active", path: file.path };
    }).sort((a, b) => a.name.localeCompare(b.name));
  }

  getMemberReport(): MemberReportRow[] {
    const meetings = this.getMeetings().filter(meeting => meeting.status === "completed");
    return this.getMembers().map(member => {
      const attended = meetings.filter(meeting => meeting.attendance[member.id] === "present").map(meeting => meeting.date).sort();
      return { ...member, firstAttendance: attended[0] ?? "", lastAttendance: attended[attended.length - 1] ?? "", attendanceCount: attended.length };
    });
  }

  getSeasons(): SeasonRecord[] {
    return this.files().filter(file => this.fm(file).type === "mens-study-season").map(file => {
      const fm = this.fm(file);
      return {
        id: this.text(fm, "season_id"), name: this.text(fm, "name"), status: this.text(fm, "status") || "planned",
        startDate: this.text(fm, "start_date"), endDate: this.text(fm, "end_date"), recurrence: (this.text(fm, "recurrence") || "weekly") as SeasonRecord["recurrence"],
        weekday: Number(fm.weekday ?? 0), meetingTime: this.text(fm, "meeting_time"), folderPath: file.parent?.path ?? "", planPath: file.path
      };
    }).sort((a, b) => b.startDate.localeCompare(a.startDate));
  }

  getMeetings(seasonId?: string): MeetingRecord[] {
    return this.files().filter(file => this.fm(file).type === "mens-study-meeting").map(file => {
      const fm = this.fm(file);
      return {
        id: this.text(fm, "meeting_id"), seasonId: this.text(fm, "season_id"), date: this.text(fm, "date"), originalDate: this.text(fm, "original_date"), scheduleKind: (this.text(fm, "schedule_kind") || "recurring") as MeetingRecord["scheduleKind"],
        status: this.text(fm, "status") || "planned", title: this.text(fm, "title"), passage: this.text(fm, "passage"), primaryTeacher: this.text(fm, "primary_teacher"),
        supportingTeacher: this.text(fm, "supporting_teacher"), attendance: this.attendance(fm), guests: this.list(fm, "guests"), goals: this.list(fm, "goals"), path: file.path
      };
    }).filter(meeting => !seasonId || meeting.seasonId === seasonId).sort((a, b) => a.date.localeCompare(b.date));
  }

  getGoals(seasonId?: string): GoalRecord[] {
    return this.files().filter(file => this.fm(file).type === "mens-study-goal").map(file => {
      const fm = this.fm(file); return { id: this.text(fm, "goal_id"), title: this.text(fm, "title"), status: this.text(fm, "status") || "active", targetDate: this.text(fm, "target_date"), path: file.path };
    }).filter(goal => !seasonId || this.text(this.fm(this.app.vault.getAbstractFileByPath(goal.path) as TFile), "season_id") === seasonId);
  }

  getPotentialMeetingDates(seasonId: string): string[] {
    const season = this.getSeasons().find(item => item.id === seasonId); if (!season) return [];
    const occupied = new Set(this.getMeetings(seasonId).filter(meeting => meeting.scheduleKind === "recurring").map(meeting => meeting.originalDate || meeting.date));
    return scheduledDates(season.startDate, season.endDate, season.recurrence, season.weekday).filter(date => !occupied.has(date));
  }

  activeSeason(): SeasonRecord | null { return this.getSeasons().find(season => season.status === "active") ?? this.getSeasons()[0] ?? null; }

  async dashboard(seasonId?: string): Promise<DashboardSummary> {
    const seasons = this.getSeasons();
    const season = seasonId ? seasons.find(item => item.id === seasonId) ?? null : this.activeSeason();
    const meetings = season ? this.getMeetings(season.id) : [];
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1); const yesterdayIso = formatIso(yesterday);
    const baseline = meetings.filter(meeting => meeting.scheduleKind === "recurring").map(meeting => meeting.originalDate || meeting.date).sort().pop() ?? yesterdayIso;
    const after = baseline < yesterdayIso ? yesterdayIso : baseline;
    return { seasons, season, nextDate: season ? nextScheduledDate(season.startDate, season.endDate, season.recurrence, season.weekday, after) : "", meetings, members: this.getMembers(), teachers: this.getTeachers(), goals: season ? this.getGoals(season.id) : [] };
  }

  async createMember(input: MemberInput): Promise<TFile> {
    await this.initialize(); const id = uniqueId("MBR"); const path = normalizePath(`${this.root}/Members/${safeName(input.name)}.md`);
    return this.app.vault.create(path, `---\ntype: mens-study-member\nmember_id: ${yamlString(id)}\nname: ${yamlString(input.name)}\nstatus: active\nmarital_status: ${input.maritalStatus}\nhas_children: ${input.hasChildren}\nhome_church: ${yamlString(input.homeChurch)}\ncreated: ${todayIso()}\n---\n\n# ${input.name}\n\n## Notes\n\n<!-- study-planner:member:start -->\nMember summary will be generated by the plugin.\n<!-- study-planner:member:end -->\n`);
  }

  async updateMember(path: string, input: MemberUpdateInput): Promise<void> {
    await this.setFrontmatter(path, fm => { fm.status = input.status; fm.marital_status = input.maritalStatus; fm.has_children = input.hasChildren; fm.home_church = input.homeChurch; });
  }

  async setMemberStatus(path: string, active: boolean): Promise<void> {
    await this.setFrontmatter(path, fm => { fm.status = active ? "active" : "inactive"; });
  }

  async createTeacher(input: PersonInput): Promise<TFile> {
    await this.initialize(); const id = uniqueId("TCH"); const path = normalizePath(`${this.root}/Teachers/${safeName(input.name)}.md`);
    return this.app.vault.create(path, `---\ntype: mens-study-teacher\nteacher_id: ${yamlString(id)}\nname: ${yamlString(input.name)}\nstatus: active\ncreated: ${todayIso()}\n---\n\n# ${input.name}\n\n## Teaching strengths\n\n## Notes\n`);
  }

  async createSeason(input: SeasonInput): Promise<TFile> {
    await this.initialize();
    const id = uniqueId("SEA"); const folder = normalizePath(`${this.root}/Seasons/${safeName(input.name)}`);
    for (const path of [folder, `${folder}/Goals`, `${folder}/Meetings`]) if (!this.app.vault.getAbstractFileByPath(path)) await this.app.vault.createFolder(path);
    for (const season of this.getSeasons().filter(item => item.status === "active")) await this.setFrontmatter(season.planPath, fm => { fm.status = "completed"; });
    const path = `${folder}/Season Plan.md`;
    const schedule = scheduledDates(input.startDate, input.endDate, input.recurrence, input.weekday).map(date => `- [ ] ${date} — Not yet planned`).join("\n") || "No recurring dates fall within this season.";
    return this.app.vault.create(path, `---\ntype: mens-study-season\nseason_id: ${yamlString(id)}\nname: ${yamlString(input.name)}\nstatus: active\nstart_date: ${input.startDate}\nend_date: ${input.endDate}\nrecurrence: ${input.recurrence}\nweekday: ${input.weekday}\nmeeting_time: ${yamlString(input.meetingTime)}\ncreated: ${todayIso()}\n---\n\n# ${input.name}\n\n## Season vision\n\n## Key Scripture\n\n<!-- study-planner:summary:start -->\n## Lesson schedule\n\n${schedule}\n\n## Season summary\n\n- Meetings completed: 0\n- Meetings planned: 0\n- Active goals: 0\n<!-- study-planner:summary:end -->\n`);
  }

  async createGoal(input: GoalInput): Promise<TFile> {
    const season = this.getSeasons().find(item => item.id === input.seasonId); if (!season) throw new Error("Season not found.");
    const id = uniqueId("GOAL"); const path = normalizePath(`${season.folderPath}/Goals/${safeName(input.title)}.md`);
    return this.app.vault.create(path, `---\ntype: mens-study-goal\ngoal_id: ${yamlString(id)}\nseason_id: ${yamlString(season.id)}\ntitle: ${yamlString(input.title)}\nstatus: active\ntarget_date: ${input.targetDate || "null"}\ncreated: ${todayIso()}\ncompleted: null\n---\n\n# ${input.title}\n\n## Desired outcome\n\n## Progress\n`);
  }

  async createMeeting(input: MeetingInput): Promise<TFile> {
    const season = this.getSeasons().find(item => item.id === input.seasonId); if (!season) throw new Error("Season not found.");
    const existing = input.scheduleKind === "recurring" ? this.getMeetings(season.id).find(item => item.scheduleKind === "recurring" && item.originalDate === input.date && item.status !== "cancelled") : undefined;
    if (existing) return this.app.vault.getAbstractFileByPath(existing.path) as TFile;
    const id = uniqueId("MTG"); const base = `${input.date} - ${safeName(input.title || "Bible Study")}`; let path = normalizePath(`${season.folderPath}/Meetings/${base}.md`); let n = 2;
    while (this.app.vault.getAbstractFileByPath(path)) path = normalizePath(`${season.folderPath}/Meetings/${base} ${n++}.md`);
    const attendance = Object.fromEntries(this.getMembers().filter(member => member.status === "active").map(member => [member.id, "absent"]));
    const attendanceYaml = Object.entries(attendance).map(([key, value]) => `  ${JSON.stringify(key)}: ${value}`).join("\n");
    const attendanceBlock = attendanceYaml ? `attendance:\n${attendanceYaml}` : "attendance: {}";
    return this.app.vault.create(path, `---\ntype: mens-study-meeting\nmeeting_id: ${yamlString(id)}\nseason_id: ${yamlString(season.id)}\nschedule_kind: ${input.scheduleKind}\ndate: ${input.date}\noriginal_date: ${input.date}\nstatus: planned\ntitle: ${yamlString(input.title)}\npassage: ${yamlString(input.passage)}\nprimary_teacher: ${yamlString(input.primaryTeacher)}\nsupporting_teacher: ${yamlString(input.supportingTeacher)}\n${attendanceBlock}\nguests: []\ngoals: []\n---\n\n# ${input.title || "Bible Study"}\n\n## Passage\n${input.passage}\n\n## Big idea\n\n## Lesson outline\n\n## Discussion questions\n\n## Resources\n\n## Preparation notes\n\n## Meeting notes\n\n## Goal progress\n`);
  }

  async recordAttendance(path: string, attendance: Record<string, AttendanceStatus>, guests: string[]): Promise<void> {
    await this.setFrontmatter(path, fm => { fm.attendance = attendance; fm.guests = guests; fm.status = "completed"; });
  }

  async updateGoal(path: string, completed: boolean, note: string, meetingPath?: string): Promise<void> {
    await this.setFrontmatter(path, fm => { fm.status = completed ? "completed" : "active"; fm.completed = completed ? todayIso() : null; });
    if (note.trim()) {
      const file = this.app.vault.getAbstractFileByPath(path); if (!(file instanceof TFile)) return;
      await this.app.vault.append(file, `\n- ${todayIso()}: ${note.trim()}${meetingPath ? ` ([[${meetingPath.replace(/\.md$/, "")}|meeting]])` : ""}\n`);
    }
  }

  async cancelMeeting(path: string): Promise<void> { await this.setFrontmatter(path, fm => { fm.status = "cancelled"; }); }
  async rescheduleMeeting(path: string, date: string): Promise<void> { await this.setFrontmatter(path, fm => { fm.date = date; fm.status = "planned"; }); }

  async rebuildSeasonSummary(seasonId: string): Promise<void> {
    const season = this.getSeasons().find(item => item.id === seasonId); if (!season) return;
    const meetings = this.getMeetings(seasonId); const goals = this.getGoals(seasonId); const members = this.getMembers();
    const completed = meetings.filter(item => item.status === "completed"); const teacherCounts = new Map<string, number>();
    for (const meeting of completed) if (meeting.primaryTeacher) teacherCounts.set(meeting.primaryTeacher, (teacherCounts.get(meeting.primaryTeacher) ?? 0) + 1);
    const attendanceLines = members.map(member => {
      const eligible = completed.filter(meeting => Object.prototype.hasOwnProperty.call(meeting.attendance, member.id));
      const present = eligible.filter(meeting => meeting.attendance[member.id] === "present").length;
      return `- [[${member.path.replace(/\.md$/, "")}|${member.name}]]: ${present}/${eligible.length} present`;
    });
    const recurringMeetings = meetings.filter(meeting => meeting.scheduleKind === "recurring");
    const scheduleLines = scheduledDates(season.startDate, season.endDate, season.recurrence, season.weekday).map(date => {
      const meeting = recurringMeetings.find(item => (item.originalDate || item.date) === date);
      if (!meeting) return `- [ ] ${date} — Not yet planned`;
      const checked = meeting.status === "completed" ? "x" : " ";
      const moved = meeting.date !== date ? `; rescheduled to ${meeting.date}` : "";
      return `- [${checked}] ${date} — [[${meeting.path.replace(/\.md$/, "")}|${meeting.title || "Bible Study"}]] — ${meeting.status}${moved}`;
    });
    const specificEvents = meetings.filter(meeting => meeting.scheduleKind === "specific").sort((a, b) => a.date.localeCompare(b.date));
    const body = ["## Lesson schedule", "", ...(scheduleLines.length ? scheduleLines : ["No recurring dates fall within this season."]), "", "## Specific events and lessons", "", ...(specificEvents.length ? specificEvents.map(meeting => `- ${meeting.date} — [[${meeting.path.replace(/\.md$/, "")}|${meeting.title || "Special Event"}]] — ${meeting.status}`) : ["No specific events recorded."]), "", `## Season summary`, "", `- Meetings completed: ${completed.length}`, `- Meetings planned: ${meetings.filter(item => item.status === "planned").length}`, `- Active goals: ${goals.filter(goal => goal.status !== "completed").length}`, "", "## Goals", "", ...(goals.length ? goals.map(goal => `- [[${goal.path.replace(/\.md$/, "")}|${goal.title}]] — ${goal.status}`) : ["No goals recorded."]), "", "## Attendance", "", ...(attendanceLines.length ? attendanceLines : ["No members recorded."]), "", "## Teaching", "", ...(teacherCounts.size ? [...teacherCounts].map(([name, count]) => `- ${name}: ${count}`) : ["No completed teaching assignments."])].join("\n");
    const file = this.app.vault.getAbstractFileByPath(season.planPath); if (!(file instanceof TFile)) return;
    const current = await this.app.vault.read(file); const start = "<!-- study-planner:summary:start -->"; const end = "<!-- study-planner:summary:end -->";
    const replacement = `${start}\n${body}\n${end}`; const regex = new RegExp(`${start}[\\s\\S]*?${end}`);
    const next = regex.test(current) ? current.replace(regex, replacement) : `${current.trim()}\n\n${replacement}\n`;
    if (next !== current) await this.app.vault.process(file, () => next);
  }

  async rebuildMembersReport(): Promise<TFile> {
    await this.initialize();
    const existing = this.app.vault.getAbstractFileByPath(this.membersReportPath);
    const file: TFile = existing instanceof TFile ? existing : await this.app.vault.create(this.membersReportPath, `---\ntype: mens-study-members-report\nupdated: ${todayIso()}\n---\n\n# Members Report\n\n<!-- study-planner:members-report:start -->\nReport will be generated by the plugin.\n<!-- study-planner:members-report:end -->\n`);
    const rows = this.getMemberReport(); const activeRows = rows.filter(row => row.status === "active"); const inactiveRows = rows.filter(row => row.status !== "active");
    const tableFor = (group: MemberReportRow[], empty: string): string[] => group.length ? ["| Member | First attended | Last attended | Attendances |", "|---|---|---|---:|", ...group.map(row => `| [[${row.path.replace(/\.md$/, "")}|${row.name.replace(/\|/g, "\\|")}]] | ${row.firstAttendance || "—"} | ${row.lastAttendance || "—"} | ${row.attendanceCount} |`)] : [empty];
    const graphFor = (group: MemberReportRow[], empty: string): string[] => { const max = Math.max(1, ...group.map(row => row.attendanceCount)); return group.length ? group.map(row => { const width = row.attendanceCount ? Math.max(1, Math.round((row.attendanceCount / max) * 20)) : 0; return `- [[${row.path.replace(/\.md$/, "")}|${row.name}]] ${"█".repeat(width)}${"░".repeat(20 - width)} ${row.attendanceCount}`; }) : [empty]; };
    const body = ["## Overview", "", `- Total members: ${rows.length}`, `- Active members: ${activeRows.length}`, `- Inactive members: ${inactiveRows.length}`, `- Recorded attendances: ${rows.reduce((sum, row) => sum + row.attendanceCount, 0)}`, "", "## Active members", "", ...tableFor(activeRows, "No active members."), "", "### Active attendance graph", "", "Each bar shows total meetings attended relative to the highest count in this group.", "", ...graphFor(activeRows, "No active attendance to graph."), "", "## Inactive members", "", ...tableFor(inactiveRows, "No inactive members."), "", "### Inactive attendance graph", "", ...graphFor(inactiveRows, "No inactive attendance to graph.")].join("\n");
    const current = await this.app.vault.read(file); const start = "<!-- study-planner:members-report:start -->"; const end = "<!-- study-planner:members-report:end -->"; const replacement = `${start}\n${body}\n${end}`; const regex = new RegExp(`${start}[\\s\\S]*?${end}`);
    const next = regex.test(current) ? current.replace(regex, replacement) : `${current.trim()}\n\n${replacement}\n`;
    if (next !== current) await this.app.vault.process(file, () => next);
    await this.setFrontmatter(file.path, fm => { fm.updated = todayIso(); });
    return file;
  }

  async rebuildMemberProfiles(): Promise<void> {
    const meetings = this.getMeetings().filter(meeting => meeting.status === "completed").sort((a, b) => b.date.localeCompare(a.date));
    for (const member of this.getMembers()) {
      await this.removeLegacyMemberSections(member.path);
      const recorded = meetings.filter(meeting => Object.prototype.hasOwnProperty.call(meeting.attendance, member.id));
      const present = recorded.filter(meeting => meeting.attendance[member.id] === "present");
      const absent = recorded.filter(meeting => meeting.attendance[member.id] === "absent").length;
      const excused = recorded.filter(meeting => meeting.attendance[member.id] === "excused").length;
      const body = ["## Attendance summary", "", `- First attended: ${present[present.length - 1]?.date || "—"}`, `- Last attended: ${present[0]?.date || "—"}`, `- Attendance totals: ${present.length} present, ${absent} absent, ${excused} excused`, "", "## Recent attendance", "", ...(recorded.length ? recorded.slice(0, 10).map(meeting => `- ${meeting.date} — [[${meeting.path.replace(/\.md$/, "")}|${meeting.title || "Bible Study"}]] — ${meeting.attendance[member.id]}`) : ["No attendance recorded."])].join("\n");
      await this.replaceManagedBlock(member.path, "<!-- study-planner:member:start -->", "<!-- study-planner:member:end -->", body);
    }
  }

  async rebuildMeetingAttendanceSections(): Promise<void> {
    const members = this.getMembers();
    for (const meeting of this.getMeetings()) {
      const lines = members.map(member => `- [[${member.path.replace(/\.md$/, "")}|${member.name}]] — ${meeting.attendance[member.id] ?? "not recorded"}`);
      const guestLines = meeting.guests.length ? meeting.guests.map(guest => `- ${guest}`) : ["No guests recorded."];
      const body = ["## Attendance", "", ...(lines.length ? lines : ["No members recorded."]), "", "### Guests", "", ...guestLines].join("\n");
      await this.replaceManagedBlock(meeting.path, "<!-- study-planner:attendance:start -->", "<!-- study-planner:attendance:end -->", body);
    }
  }

  async rebuildAll(): Promise<void> { await this.rebuildMeetingAttendanceSections(); await this.rebuildMemberProfiles(); for (const season of this.getSeasons()) await this.rebuildSeasonSummary(season.id); await this.rebuildMembersReport(); }

  private async replaceManagedBlock(path: string, start: string, end: string, body: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path); if (!(file instanceof TFile)) return;
    const current = await this.app.vault.read(file); const replacement = `${start}\n${body}\n${end}`; const regex = new RegExp(`${start.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${end.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`); const next = regex.test(current) ? current.replace(regex, replacement) : `${current.trim()}\n\n${replacement}\n`;
    if (next !== current) await this.app.vault.process(file, () => next);
  }

  private async removeLegacyMemberSections(path: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path); if (!(file instanceof TFile)) return;
    const current = await this.app.vault.read(file); const next = current.replace(/\n## Family\s*\n[\s\S]*?\n## Notes\s*\n/, "\n## Notes\n\n");
    if (next !== current) await this.app.vault.process(file, () => next);
  }

  private async setFrontmatter(path: string, mutate: (fm: Frontmatter) => void): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path); if (!(file instanceof TFile)) throw new Error(`File not found: ${path}`);
    await this.app.fileManager.processFrontMatter(file, mutate);
  }
}
