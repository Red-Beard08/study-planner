/* Owns the portable Markdown data model and all vault reads and writes. */

import { App, TFile, normalizePath } from "obsidian";
import type { AttendanceStatus, DashboardSummary, GoalInput, GoalRecord, GoalUpdateInput, MeetingInput, MeetingRecord, MemberInput, MemberRecord, MemberReportRow, MemberUpdateInput, PersonInput, PlannerSettings, SeasonInput, SeasonRecord, TeacherRecord, TeacherUpdateInput } from "./types";
import { cleanRootFolder, displayWikilink, formatIso, nameKey, nextScheduledDate, normalizedLabels, safeName, scheduledDates, todayIso, uniqueId, yamlList, yamlString } from "./utils";

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
  private teacherAttendance(fm: Frontmatter): Record<string, AttendanceStatus> {
    const value = fm.leader_attendance;
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, status]) => [key, String(status) as AttendanceStatus]));
  }

  getMembers(): MemberRecord[] {
    return this.files().filter(file => file.name !== "Members Hub.md" && this.fm(file).type === "mens-study-member").map(file => {
      const fm = this.fm(file); const childrenValue = fm.has_children;
      return { id: this.text(fm, "member_id"), name: this.text(fm, "name"), status: this.text(fm, "status") || "active", memberType: (this.text(fm, "member_type") === "guest" ? "guest" : "member") as MemberRecord["memberType"], maritalStatus: (this.text(fm, "marital_status") || "single") as MemberRecord["maritalStatus"], hasChildren: childrenValue === true || String(childrenValue).toLowerCase() === "true" || String(childrenValue).toLowerCase() === "yes", homeChurch: this.text(fm, "home_church"), path: file.path };
    }).sort((a, b) => a.name.localeCompare(b.name));
  }

  getTeachers(): TeacherRecord[] {
    return this.files().filter(file => this.fm(file).type === "mens-study-teacher").map(file => {
      const fm = this.fm(file); return { id: this.text(fm, "teacher_id"), name: this.text(fm, "name"), status: this.text(fm, "status") || "active", strengths: normalizedLabels(this.list(fm, "teaching_strengths")), path: file.path };
    }).sort((a, b) => a.name.localeCompare(b.name));
  }

  getMemberReport(): MemberReportRow[] {
    const meetings = this.getMeetings().filter(meeting => meeting.attendanceRecorded && meeting.date <= todayIso());
    return this.getMembers().map(member => {
      const recorded = meetings.filter(meeting => Object.prototype.hasOwnProperty.call(meeting.attendance, member.id) || (member.memberType === "guest" && meeting.guests.some(guest => nameKey(displayWikilink(guest)) === nameKey(member.name))));
      const attended = recorded.filter(meeting => meeting.attendance[member.id] === "present").map(meeting => meeting.date).sort();
      const guestAttended = member.memberType === "guest" ? recorded.filter(meeting => meeting.guests.some(guest => nameKey(displayWikilink(guest)) === nameKey(member.name))).map(meeting => meeting.date) : [];
      const allAttended = [...new Set([...attended, ...guestAttended])].sort();
      return { ...member, firstAttendance: allAttended[0] ?? "", lastAttendance: allAttended[allAttended.length - 1] ?? "", attendanceCount: allAttended.length, absentCount: recorded.filter(meeting => meeting.attendance[member.id] === "absent").length, excusedCount: recorded.filter(meeting => meeting.attendance[member.id] === "excused").length, recordedCount: recorded.length };
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
        primaryTeacherId: this.text(fm, "primary_teacher_id"), supportingTeacher: this.text(fm, "supporting_teacher"), supportingTeacherId: this.text(fm, "supporting_teacher_id"), attendance: this.attendance(fm), leaderAttendance: this.teacherAttendance(fm), attendanceRecorded: fm.attendance_recorded === true || String(fm.attendance_recorded ?? "").toLowerCase() === "true" || this.text(fm, "status") === "completed", guests: this.list(fm, "guests"), goals: this.list(fm, "goal_ids").length ? this.list(fm, "goal_ids") : this.list(fm, "goals"), path: file.path
      };
    }).filter(meeting => !seasonId || meeting.seasonId === seasonId).sort((a, b) => a.date.localeCompare(b.date));
  }

  getGoals(seasonId?: string): GoalRecord[] {
    return this.files().filter(file => this.fm(file).type === "mens-study-goal").map(file => {
      const fm = this.fm(file); return { id: this.text(fm, "goal_id"), title: this.text(fm, "title"), status: this.text(fm, "status") || "active", targetDate: this.text(fm, "target_date"), focusAreas: normalizedLabels(this.list(fm, "focus_areas")), path: file.path };
    }).filter(goal => !seasonId || this.text(this.fm(this.app.vault.getAbstractFileByPath(goal.path) as TFile), "season_id") === seasonId);
  }

  getFocusAreas(): string[] { return normalizedLabels([...this.getTeachers().flatMap(teacher => teacher.strengths), ...this.getGoals().flatMap(goal => goal.focusAreas)]); }
  teacherForMeeting(meeting: MeetingRecord, role: "primary" | "supporting"): TeacherRecord | undefined {
    const id = role === "primary" ? meeting.primaryTeacherId : meeting.supportingTeacherId;
    const label = role === "primary" ? meeting.primaryTeacher : meeting.supportingTeacher;
    return this.getTeachers().find(teacher => teacher.id === id || (!id && nameKey(teacher.name) === nameKey(label)));
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
    return this.app.vault.create(path, `---\ntype: mens-study-member\nmember_id: ${yamlString(id)}\nmember_type: member\nname: ${yamlString(input.name)}\nstatus: active\nmarital_status: ${input.maritalStatus}\nhas_children: ${input.hasChildren}\nhome_church: ${yamlString(input.homeChurch)}\ncreated: ${todayIso()}\n---\n\n# ${input.name}\n\n## Notes\n\n<!-- study-planner:member:start -->\nMember summary will be generated by the plugin.\n<!-- study-planner:member:end -->\n`);
  }

  async updateMember(path: string, input: MemberUpdateInput): Promise<void> {
    await this.setFrontmatter(path, fm => { fm.status = input.status; fm.marital_status = input.maritalStatus; fm.has_children = input.hasChildren; fm.home_church = input.homeChurch; });
  }

  async setMemberStatus(path: string, active: boolean): Promise<void> {
    await this.setFrontmatter(path, fm => { fm.status = active ? "active" : "inactive"; });
  }

  async createTeacher(input: PersonInput): Promise<TFile> {
    await this.initialize(); const id = uniqueId("TCH"); const path = normalizePath(`${this.root}/Teachers/${safeName(input.name)}.md`);
    const strengths = normalizedLabels(input.strengths);
    return this.app.vault.create(path, `---\ntype: mens-study-teacher\nteacher_id: ${yamlString(id)}\nname: ${yamlString(input.name)}\nstatus: active\nteaching_strengths:\n${yamlList(strengths)}\ncreated: ${todayIso()}\n---\n\n# ${input.name}\n\n## Notes\n\n<!-- study-planner:teacher:start -->\nLeader summary will be generated by the plugin.\n<!-- study-planner:teacher:end -->\n`);
  }

  async updateTeacher(path: string, input: TeacherUpdateInput): Promise<void> {
    await this.setFrontmatter(path, fm => { fm.status = input.status; fm.teaching_strengths = normalizedLabels(input.strengths); });
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
    const focusAreas = normalizedLabels(input.focusAreas);
    return this.app.vault.create(path, `---\ntype: mens-study-goal\ngoal_id: ${yamlString(id)}\nseason_id: ${yamlString(season.id)}\ntitle: ${yamlString(input.title)}\nstatus: active\ntarget_date: ${input.targetDate || "null"}\nfocus_areas:\n${yamlList(focusAreas)}\ncreated: ${todayIso()}\ncompleted: null\n---\n\n# ${input.title}\n\n## Desired outcome\n\n## Progress\n\n<!-- study-planner:goal:start -->\nGoal connections will be generated by the plugin.\n<!-- study-planner:goal:end -->\n`);
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
    const goals = input.goalIds; const goalLabels = goals.map(goalId => this.getGoals(season.id).find(goal => goal.id === goalId)?.title ?? goalId);
    return this.app.vault.create(path, `---\ntype: mens-study-meeting\nmeeting_id: ${yamlString(id)}\nseason_id: ${yamlString(season.id)}\nschedule_kind: ${input.scheduleKind}\ndate: ${input.date}\noriginal_date: ${input.date}\nstatus: planned\ntitle: ${yamlString(input.title)}\npassage: ${yamlString(input.passage)}\nprimary_teacher: ${yamlString(input.primaryTeacher)}\nprimary_teacher_id: ${yamlString(input.primaryTeacherId)}\nsupporting_teacher: ${yamlString(input.supportingTeacher)}\nsupporting_teacher_id: ${yamlString(input.supportingTeacherId)}\n${attendanceBlock}\nleader_attendance: {}\nguests: []\ngoal_ids:\n${yamlList(goals)}\ngoals:\n${yamlList(goalLabels)}\n---\n\n# ${input.title || "Bible Study"}\n\n## Passage\n${input.passage}\n\n## Big idea\n\n## Lesson outline\n\n## Discussion questions\n\n## Resources\n\n## Preparation notes\n\n## Meeting notes\n\n## Goal progress\n`);
  }

  async recordAttendance(path: string, attendance: Record<string, AttendanceStatus>, guests: string[], leaderAttendance: Record<string, AttendanceStatus>): Promise<void> {
    const guestLinks: string[] = []; const seen = new Set<string>();
    for (const raw of guests) {
      const name = displayWikilink(raw).replace(/^[-•]\s*/, "").trim(); const key = nameKey(name); if (!key || seen.has(key)) continue; seen.add(key);
      const existing = this.getMembers().find(member => nameKey(member.name) === key); const profile = existing ?? await this.createGuestProfile(name);
      guestLinks.push(`[[${profile.path.replace(/\.md$/, "")}|${profile.name}]]`);
    }
    await this.setFrontmatter(path, fm => { fm.attendance = attendance; fm.guests = guestLinks; fm.leader_attendance = leaderAttendance; fm.attendance_recorded = true; fm.status = "completed"; });
    const meeting = this.getMeetings().find(item => item.path === path); if (meeting) await this.rebuildMeetingAttendanceSections();
  }

  private async createGuestProfile(name: string): Promise<MemberRecord> {
    await this.initialize(); const id = uniqueId("MBR"); const base = normalizePath(`${this.root}/Members/${safeName(name)}.md`); let path = base; let suffix = 2;
    while (this.app.vault.getAbstractFileByPath(path)) path = normalizePath(`${this.root}/Members/${safeName(name)} (Guest ${suffix++}).md`);
    await this.app.vault.create(path, `---\ntype: mens-study-member\nmember_id: ${yamlString(id)}\nmember_type: guest\nname: ${yamlString(name)}\nstatus: guest\nmarital_status: unknown\nhas_children: false\nhome_church: \"\"\ncreated: ${todayIso()}\nsource: attendance-guest\n---\n\n# ${name}\n\n> Guest profile created from attendance. Add details if this person becomes part of the regular roster.\n\n<!-- study-planner:member:start -->\nGuest profile. Attendance summary will be generated by the plugin.\n<!-- study-planner:member:end -->\n`);
    return { id, name, status: "guest", memberType: "guest", maritalStatus: "unknown", hasChildren: false, homeChurch: "", path };
  }

  async updateGoal(path: string, completed: boolean, note: string, meetingPath?: string): Promise<void> {
    await this.setFrontmatter(path, fm => { fm.status = completed ? "completed" : "active"; fm.completed = completed ? todayIso() : null; });
    if (note.trim()) {
      const file = this.app.vault.getAbstractFileByPath(path); if (!(file instanceof TFile)) return;
      await this.app.vault.append(file, `\n- ${todayIso()}: ${note.trim()}${meetingPath ? ` ([[${meetingPath.replace(/\.md$/, "")}|meeting]])` : ""}\n`);
    }
  }

  async updateGoalDetails(path: string, input: GoalUpdateInput): Promise<void> {
    await this.setFrontmatter(path, fm => { fm.target_date = input.targetDate || null; fm.focus_areas = normalizedLabels(input.focusAreas); });
  }

  async cancelMeeting(path: string): Promise<void> { await this.setFrontmatter(path, fm => { fm.status = "cancelled"; }); }
  async rescheduleMeeting(path: string, date: string): Promise<void> { await this.setFrontmatter(path, fm => { fm.date = date; fm.status = "planned"; }); }

  async rebuildSeasonSummary(seasonId: string): Promise<void> {
    const season = this.getSeasons().find(item => item.id === seasonId); if (!season) return;
    const meetings = this.getMeetings(seasonId); const goals = this.getGoals(seasonId);
    const completed = meetings.filter(item => item.attendanceRecorded && item.date <= todayIso()); const teacherCounts = new Map<string, number>();
    for (const meeting of completed) if (meeting.primaryTeacher) teacherCounts.set(meeting.primaryTeacher, (teacherCounts.get(meeting.primaryTeacher) ?? 0) + 1);
    const recordedAttendance = completed.flatMap(meeting => Object.values(meeting.attendance));
    const presentAttendance = recordedAttendance.filter(status => status === "present").length;
    const recurringMeetings = meetings.filter(meeting => meeting.scheduleKind === "recurring");
    const scheduleLines = scheduledDates(season.startDate, season.endDate, season.recurrence, season.weekday).map(date => {
      const meeting = recurringMeetings.find(item => (item.originalDate || item.date) === date);
      if (!meeting) return `- [ ] ${date} — Not yet planned`;
      const checked = meeting.status === "completed" ? "x" : " ";
      const moved = meeting.date !== date ? `; rescheduled to ${meeting.date}` : "";
      return `- [${checked}] ${date} — [[${meeting.path.replace(/\.md$/, "")}|${meeting.title || "Bible Study"}]] — ${meeting.status}${moved}`;
    });
    const specificEvents = meetings.filter(meeting => meeting.scheduleKind === "specific").sort((a, b) => a.date.localeCompare(b.date));
    const body = ["## Season snapshot", "", `- Events held: ${completed.length}`, `- Events planned: ${meetings.filter(item => item.status === "planned").length}`, `- Active goals: ${goals.filter(goal => goal.status !== "completed").length}`, `- Attendance: ${presentAttendance}/${recordedAttendance.length} present across recorded events`, "", "## Lesson schedule", "", ...(scheduleLines.length ? scheduleLines : ["No recurring dates fall within this season."]), "", "## Specific events and lessons", "", ...(specificEvents.length ? specificEvents.map(meeting => `- ${meeting.date} — [[${meeting.path.replace(/\.md$/, "")}|${meeting.title || "Special Event"}]] — ${meeting.status}`) : ["No specific events recorded." ]), "", "## Goals", "", ...(goals.length ? goals.map(goal => { const lessons = meetings.filter(meeting => meeting.goals.includes(goal.id)).length; const areas = goal.focusAreas.length ? ` · ${goal.focusAreas.join(", ")}` : ""; return `- [[${goal.path.replace(/\.md$/, "")}|${goal.title}]] — ${goal.status} · ${lessons} linked lesson${lessons === 1 ? "" : "s"}${areas}`; }) : ["No goals recorded."]), "", "## Teaching", "", ...(teacherCounts.size ? [...teacherCounts].map(([name, count]) => `- ${name}: ${count}`) : ["No completed teaching assignments."])].join("\n");
    const file = this.app.vault.getAbstractFileByPath(season.planPath); if (!(file instanceof TFile)) return;
    const current = await this.app.vault.read(file); const start = "<!-- study-planner:summary:start -->"; const end = "<!-- study-planner:summary:end -->";
    const replacement = `${start}\n${body}\n${end}`; const removeCanonical = new RegExp(`${start.replace(/[.*+?^${}()|[\]\\\\]/g, "\\\\$&")}[\\s\\S]*?${end.replace(/[.*+?^${}()|[\]\\\\]/g, "\\\\$&")}`, "g"); const legacyMarker = "mens-" + "study-planner"; const removeLegacy = new RegExp(`<!-- ${legacyMarker}:summary:start -->[\\s\\S]*?<!-- ${legacyMarker}:summary:end -->`, "g");
    const base = current.replace(removeLegacy, "").replace(removeCanonical, "").trimEnd(); const next = `${base}\n\n${replacement}\n`;
    if (next !== current) { await this.app.vault.process(file, () => next); await this.setFrontmatter(file.path, fm => { fm.updated = new Date().toISOString().slice(0, 16); }); }
  }

  async rebuildMembersReport(): Promise<TFile> {
    await this.initialize();
    const existing = this.app.vault.getAbstractFileByPath(this.membersReportPath);
    const file: TFile = existing instanceof TFile ? existing : await this.app.vault.create(this.membersReportPath, `---\ntype: mens-study-members-report\nupdated: ${todayIso()}\n---\n\n# Members Report\n\n<!-- study-planner:members-report:start -->\nReport will be generated by the plugin.\n<!-- study-planner:members-report:end -->\n`);
    const rows = this.getMemberReport(); const activeRows = rows.filter(row => row.status === "active"); const inactiveRows = rows.filter(row => row.status !== "active");
    const tableFor = (group: MemberReportRow[], empty: string): string[] => group.length ? ["| Member | Type | Status | First attended | Last attended | Present | Absent | Excused |", "|---|---|---|---|---|---:|---:|---:|", ...group.map(row => `| [[${row.path.replace(/\.md$/, "")}\\|${row.name.replace(/\|/g, "\\|")}]] | ${row.memberType === "guest" ? "Guest" : "Member"} | ${row.status} | ${row.firstAttendance || "—"} | ${row.lastAttendance || "—"} | ${row.attendanceCount} | ${row.absentCount} | ${row.excusedCount} |`)] : [empty];
    const season = this.activeSeason(); const eventDates = season ? scheduledDates(season.startDate, season.endDate, season.recurrence, season.weekday) : []; const seasonMeetings = season ? this.getMeetings(season.id) : []; const events = [...eventDates.map(date => ({ date, meeting: seasonMeetings.find(item => item.scheduleKind === "recurring" && (item.originalDate || item.date) === date) })), ...seasonMeetings.filter(item => item.scheduleKind === "specific").map(meeting => ({ date: meeting.date, meeting }))].sort((a, b) => a.date.localeCompare(b.date));
    const eventLabels = events.map(event => { const parsed = new Date(`${event.date}T12:00:00`); if (Number.isNaN(parsed.valueOf())) return event.date; const month = parsed.toLocaleDateString("en-US", { month: "short" }); const day = String(parsed.getDate()).padStart(2, "0"); const year = parsed.getFullYear() === new Date().getFullYear() ? "" : `/${String(parsed.getFullYear()).slice(-2)}`; return `${month}/${day}${year}`; });
    const graphFor = (group: MemberReportRow[], empty: string): string[] => { if (!group.length) return [`<p class="study-planner-attendance-empty">${empty}</p>`]; if (!events.length) return ["<p class=\"study-planner-attendance-empty\">No scheduled events in the current season.</p>"]; const today = todayIso(); const escapeHtml = (value: string): string => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;"); const statusFor = (row: MemberReportRow, event: typeof events[number]): { key: string; label: string } => { if (event.date > today || !event.meeting?.attendanceRecorded) return { key: "future", label: "Future or not recorded" }; const status = event.meeting.attendance[row.id]; if (status === "present") return { key: "present", label: "Attended" }; if (status === "excused") return { key: "excused", label: "Excused" }; if (status === "absent") return { key: "absent", label: "Absent" }; if (row.memberType === "guest" && event.meeting.guests.some(guest => nameKey(displayWikilink(guest)) === nameKey(row.name))) return { key: "present", label: "Attended as guest" }; return { key: "absent", label: "Absent" }; }; const labels = `<div class="study-planner-attendance-event-labels" style="--study-event-count:${events.length}">${eventLabels.map(label => `<span>${escapeHtml(label)}</span>`).join("")}</div>`; const rowsHtml = group.map(row => `<div class="study-planner-attendance-graph-row"><span class="study-planner-attendance-graph-name">${escapeHtml(row.name)}</span><span class="study-planner-attendance-dots" style="--study-event-count:${events.length}">${events.map(event => { const status = statusFor(row, event); return `<span class="study-planner-attendance-dot is-${status.key}" title="${escapeHtml(event.date)}: ${escapeHtml(status.label)}"></span>`; }).join("")}</span></div>`); return [`<div class="study-planner-attendance-graph">${labels}${rowsHtml.join("")}</div>`]; };
    const body = ["## Overview", "", `- Total profiles: ${rows.length}`, `- Active roster profiles: ${activeRows.length}`, `- Inactive and guest profiles: ${inactiveRows.length}`, `- Recorded attendance entries: ${rows.reduce((sum, row) => sum + row.recordedCount, 0)}`, "", "## Active members", "", ...tableFor(activeRows, "No active members."), "", "## Inactive and guest profiles", "", ...tableFor(inactiveRows, "No inactive or guest profiles."), "", "### Active attendance graph", "", `Current season: ${season?.name ?? "No active season"}`, "Legend: green = attended · red = absent · yellow = excused · gray = future/not recorded", "", ...graphFor(activeRows, "No active attendance to graph."), "", "### Inactive and guest attendance graph", "", ...graphFor(inactiveRows, "No inactive or guest attendance to graph.")].join("\n");
    const current = await this.app.vault.read(file); const start = "<!-- study-planner:members-report:start -->"; const end = "<!-- study-planner:members-report:end -->"; const replacement = `${start}\n${body}\n${end}`; const removeCanonical = new RegExp(`${start.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}[\\s\\S]*?${end.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}`, "g"); const legacyMarker = "mens-" + "study-planner"; const removeLegacy = new RegExp(`<!-- ${legacyMarker}:members-report:start -->[\\s\\S]*?<!-- ${legacyMarker}:members-report:end -->`, "g");
    const base = current.replace(removeLegacy, "").replace(removeCanonical, "").trimEnd(); const next = `${base}\n\n${replacement}\n`;
    if (next !== current) await this.app.vault.process(file, () => next);
    await this.setFrontmatter(file.path, fm => { fm.updated = todayIso(); });
    return file;
  }

  async rebuildMemberProfiles(): Promise<void> {
    const meetings = this.getMeetings().filter(meeting => meeting.attendanceRecorded && meeting.date <= todayIso()).sort((a, b) => b.date.localeCompare(a.date));
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
      const leaders = (["primary", "supporting"] as const).map(role => ({ role, teacher: this.teacherForMeeting(meeting, role) })).filter((item): item is { role: "primary" | "supporting"; teacher: TeacherRecord } => Boolean(item.teacher));
      const leaderLines = leaders.length ? leaders.map(item => `- [[${item.teacher.path.replace(/\.md$/, "")}|${item.teacher.name}]] — ${item.role} leader · ${meeting.leaderAttendance[item.teacher.id] ?? "not recorded"}`) : ["No assigned leaders."];
      const goalLines = meeting.goals.length ? meeting.goals.map(id => { const goal = this.getGoals(meeting.seasonId).find(item => item.id === id); return goal ? `- [[${goal.path.replace(/\.md$/, "")}|${goal.title}]]` : `- ${id}`; }) : ["No goals linked to this lesson."];
      const body = ["## Attendance", "", ...(lines.length ? lines : ["No members recorded."]), "", "### Assigned leaders", "", ...leaderLines, "", "### Guests", "", ...guestLines, "", "## Goals advanced", "", ...goalLines].join("\n");
      await this.replaceManagedBlock(meeting.path, "<!-- study-planner:attendance:start -->", "<!-- study-planner:attendance:end -->", body);
    }
  }

  async rebuildTeacherProfiles(): Promise<void> {
    const meetings = this.getMeetings().sort((a, b) => b.date.localeCompare(a.date));
    for (const teacher of this.getTeachers()) {
      await this.ensureArrayFrontmatter(teacher.path, "teaching_strengths");
      const assigned = meetings.flatMap(meeting => (["primary", "supporting"] as const).map(role => ({ meeting, role })).filter(item => this.teacherForMeeting(item.meeting, item.role)?.id === teacher.id));
      const upcoming = assigned.filter(item => item.meeting.date >= todayIso() && item.meeting.status === "planned");
      const led = assigned.filter(item => item.meeting.date <= todayIso() && item.meeting.status !== "cancelled");
      const body = ["## Leader summary", "", `- Teaching strengths: ${teacher.strengths.length ? teacher.strengths.join(", ") : "None recorded"}`, "", "## Upcoming assignments", "", ...(upcoming.length ? upcoming.map(item => `- ${item.meeting.date} — [[${item.meeting.path.replace(/\.md$/, "")}|${item.meeting.title || "Bible Study"}]] — ${item.role}`) : ["No upcoming assignments."]), "", "## Lessons led", "", ...(led.length ? led.map(item => `- ${item.meeting.date} — [[${item.meeting.path.replace(/\.md$/, "")}|${item.meeting.title || "Bible Study"}]] — ${item.role} leader`) : ["No lessons led yet."]), "", "## Attendance at assigned lessons", "", ...(led.length ? led.map(item => `- ${item.meeting.date} — [[${item.meeting.path.replace(/\.md$/, "")}|${item.meeting.title || "Bible Study"}]] — ${item.meeting.leaderAttendance[teacher.id] ?? "not recorded"}`) : ["No assigned-lesson attendance recorded."])].join("\n");
      await this.replaceManagedBlock(teacher.path, "<!-- study-planner:teacher:start -->", "<!-- study-planner:teacher:end -->", body);
    }
  }

  async rebuildGoalProfiles(): Promise<void> {
    const teachers = this.getTeachers(); const meetings = this.getMeetings();
    for (const goal of this.getGoals()) {
      await this.ensureArrayFrontmatter(goal.path, "focus_areas");
      const linked = meetings.filter(meeting => meeting.goals.includes(goal.id));
      const matching = teachers.filter(teacher => teacher.strengths.some(strength => goal.focusAreas.some(area => nameKey(area) === nameKey(strength))));
      const body = ["## Goal connections", "", `- Status: ${goal.status}`, `- Target date: ${goal.targetDate || "—"}`, `- Focus areas: ${goal.focusAreas.length ? goal.focusAreas.join(", ") : "None recorded"}`, "", "## Lessons advancing this goal", "", ...(linked.length ? linked.map(meeting => `- ${meeting.date} — [[${meeting.path.replace(/\.md$/, "")}|${meeting.title || "Bible Study"}]] — ${meeting.status}`) : ["No lessons linked yet."]), "", "## Leaders with matching strengths", "", ...(matching.length ? matching.map(teacher => `- [[${teacher.path.replace(/\.md$/, "")}|${teacher.name}]] — ${teacher.strengths.filter(strength => goal.focusAreas.some(area => nameKey(area) === nameKey(strength))).join(", ")}`) : ["No matching leader strengths recorded."])].join("\n");
      await this.replaceManagedBlock(goal.path, "<!-- study-planner:goal:start -->", "<!-- study-planner:goal:end -->", body);
    }
  }

  async rebuildAll(): Promise<void> { await this.rebuildMeetingAttendanceSections(); await this.rebuildMemberProfiles(); await this.rebuildTeacherProfiles(); await this.rebuildGoalProfiles(); for (const season of this.getSeasons()) await this.rebuildSeasonSummary(season.id); await this.rebuildMembersReport(); }

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

  private async ensureArrayFrontmatter(path: string, key: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path); if (!(file instanceof TFile)) return;
    if (Array.isArray(this.fm(file)[key])) return;
    await this.setFrontmatter(path, fm => { if (!Array.isArray(fm[key])) fm[key] = []; });
  }
}
