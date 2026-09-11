/* Mobile-friendly modal forms for seasons, people, meetings, attendance, and goals. */

import { App, Modal, Setting } from "obsidian";
import type { AttendanceStatus, GoalInput, GoalRecord, GoalUpdateInput, MeetingInput, MeetingKind, MemberInput, MemberRecord, MemberReportRow, MemberUpdateInput, PersonInput, SeasonInput, SeasonRecord, TeacherRecord, TeacherUpdateInput } from "./types";
import { displayWikilink, normalizedLabels, todayIso } from "./utils";

function submitButton(modal: Modal, label: string, onSubmit: () => Promise<void>): void {
  new Setting(modal.contentEl).addButton(button => button.setButtonText(label).setCta().onClick(async () => { button.setDisabled(true); try { await onSubmit(); modal.close(); } finally { button.setDisabled(false); } }));
}

function labelPicker(parent: HTMLElement, title: string, description: string, choices: string[], initial: string[] = []): () => string[] {
  parent.createEl("h3", { text: title }); parent.createEl("p", { text: description, cls: "study-planner-muted" });
  const selected = new Set(initial.map(value => value.toLocaleLowerCase())); const labels = new Map(initial.map(value => [value.toLocaleLowerCase(), value]));
  const filter = parent.createEl("input", { type: "search", placeholder: `Filter existing ${title.toLocaleLowerCase()}` }); const list = parent.createDiv({ cls: "study-planner-label-picker" });
  for (const choice of choices) { const row = list.createEl("label", { cls: "study-planner-label-option" }); const check = row.createEl("input", { type: "checkbox" }); check.checked = selected.has(choice.toLocaleLowerCase()); row.createSpan({ text: choice }); check.onchange = () => { const key = choice.toLocaleLowerCase(); if (check.checked) { selected.add(key); labels.set(key, choice); } else { selected.delete(key); labels.delete(key); } }; }
  filter.oninput = () => { const query = filter.value.toLocaleLowerCase(); for (const row of Array.from(list.children) as HTMLElement[]) row.style.display = row.textContent?.toLocaleLowerCase().includes(query) ? "" : "none"; };
  let extra = ""; new Setting(parent).setName(`Add new ${title.toLocaleLowerCase()}`).setDesc("Comma-separated values are accepted.").addText(text => text.onChange(value => extra = value));
  return () => normalizedLabels([...labels.values(), ...extra.split(",")]);
}

export class PersonModal extends Modal {
  private name = "";
  constructor(app: App, private titleText: string, private areas: string[], private onSubmit: (input: PersonInput) => Promise<void>) { super(app); }
  onOpen(): void {
    this.contentEl.addClass("study-planner-modal"); this.setTitle(this.titleText);
    new Setting(this.contentEl).setName("Name").addText(text => text.onChange(value => this.name = value));
    const strengths = labelPicker(this.contentEl, "Teaching strengths", "Use strengths to connect leaders with season goals.", this.areas);
    submitButton(this, "Create", async () => { if (!this.name.trim()) throw new Error("Name is required."); await this.onSubmit({ name: this.name.trim(), strengths: strengths() }); });
  }
}

export class TeacherEditModal extends Modal {
  private status: string; private strengths: () => string[] = () => [];
  constructor(app: App, private teacher: TeacherRecord, private areas: string[], private onSubmit: (input: TeacherUpdateInput) => Promise<void>) { super(app); this.status = teacher.status; }
  onOpen(): void { this.contentEl.addClass("study-planner-modal"); this.setTitle(`Edit ${this.teacher.name}`); new Setting(this.contentEl).setName("Name").setDesc("Edit the profile note directly to rename a leader.").addText(text => text.setValue(this.teacher.name).setDisabled(true)); new Setting(this.contentEl).setName("Status").addDropdown(dropdown => dropdown.addOptions({ active: "Active", inactive: "Inactive" }).setValue(this.status).onChange(value => this.status = value)); this.strengths = labelPicker(this.contentEl, "Teaching strengths", "Use strengths to connect leaders with season goals.", this.areas, this.teacher.strengths); submitButton(this, "Save leader", () => this.onSubmit({ name: this.teacher.name, status: this.status, strengths: this.strengths() })); }
}

export class TeacherManagerModal extends Modal {
  constructor(app: App, private teachers: TeacherRecord[], private openTeacher: (teacher: TeacherRecord) => void, private editTeacher: (teacher: TeacherRecord) => void, private setStatus: (teacher: TeacherRecord, active: boolean) => Promise<void>) { super(app); }
  onOpen(): void { this.contentEl.addClass("study-planner-modal"); this.setTitle("Manage leaders"); if (!this.teachers.length) this.contentEl.createEl("p", { text: "No leaders have been added yet." }); for (const teacher of this.teachers) { const row = this.contentEl.createDiv({ cls: "study-planner-manager-row" }); row.createEl("strong", { text: teacher.name }); row.createEl("span", { text: `${teacher.status} · ${teacher.strengths.length ? teacher.strengths.join(", ") : "no strengths recorded"}` }); const actions = row.createDiv({ cls: "study-planner-actions" }); actions.createEl("button", { text: "Open profile" }).onclick = () => this.openTeacher(teacher); actions.createEl("button", { text: "Edit" }).onclick = () => this.editTeacher(teacher); const active = teacher.status !== "active"; actions.createEl("button", { text: active ? "Mark active" : "Mark inactive", cls: active ? "mod-cta" : "" }).onclick = async () => { await this.setStatus(teacher, active); this.close(); }; } }
}

export class MemberModal extends Modal {
  private input: MemberInput = { name: "", maritalStatus: "single", hasChildren: false, homeChurch: "" };
  constructor(app: App, private onSubmit: (input: MemberInput) => Promise<void>) { super(app); }
  onOpen(): void {
    this.contentEl.addClass("study-planner-modal"); this.setTitle("Add roster member");
    new Setting(this.contentEl).setName("Name").addText(text => text.onChange(value => this.input.name = value));
    new Setting(this.contentEl).setName("Marital status").addDropdown(dropdown => dropdown.addOptions({ single: "Single", married: "Married", divorced: "Divorced" }).setValue(this.input.maritalStatus).onChange(value => this.input.maritalStatus = value as MemberInput["maritalStatus"]));
    new Setting(this.contentEl).setName("Children").addDropdown(dropdown => dropdown.addOptions({ no: "No children", yes: "Has children" }).setValue("no").onChange(value => this.input.hasChildren = value === "yes"));
    new Setting(this.contentEl).setName("Home church").addText(text => text.setPlaceholder("Church name").onChange(value => this.input.homeChurch = value));
    submitButton(this, "Add member", async () => { if (!this.input.name.trim()) throw new Error("Name is required."); await this.onSubmit({ ...this.input, name: this.input.name.trim(), homeChurch: this.input.homeChurch.trim() }); });
  }
}

export class MemberManagerModal extends Modal {
  constructor(app: App, private members: MemberReportRow[], private openMember: (member: MemberReportRow) => void, private editMember: (member: MemberReportRow) => void, private setStatus: (member: MemberReportRow, active: boolean) => Promise<void>) { super(app); }
  onOpen(): void {
    this.contentEl.addClass("study-planner-modal"); this.setTitle("Manage members");
    if (!this.members.length) this.contentEl.createEl("p", { text: "No members have been added yet." });
    const renderGroup = (title: string, members: MemberReportRow[]) => {
      if (!members.length) return;
      this.contentEl.createEl("h3", { text: title, cls: "study-planner-manager-heading" });
      const section = this.contentEl.createDiv({ cls: "study-planner-manager-section" });
      for (const member of members) {
        const row = section.createDiv({ cls: "study-planner-manager-row" });
        const heading = row.createDiv({ cls: "study-planner-card-heading" }); heading.createEl("strong", { text: member.name }); heading.createEl("span", { text: member.status, cls: `study-planner-badge study-planner-${member.status}` });
        row.createEl("span", { text: `First: ${member.firstAttendance || "—"} · Last: ${member.lastAttendance || "—"} · Attendances: ${member.attendanceCount}` });
        const actions = row.createDiv({ cls: "study-planner-actions" }); actions.createEl("button", { text: "Open profile" }).onclick = () => this.openMember(member); actions.createEl("button", { text: "Edit details" }).onclick = () => this.editMember(member);
        const activate = member.status !== "active"; actions.createEl("button", { text: activate ? "Mark active" : "Mark inactive", cls: activate ? "mod-cta" : "" }).onclick = async () => { await this.setStatus(member, activate); this.close(); };
      }
    };
    renderGroup("Active members", this.members.filter(member => member.status === "active"));
    renderGroup("Inactive members", this.members.filter(member => member.status !== "active"));
  }
}

export class MemberEditModal extends Modal {
  private input: MemberUpdateInput;
  constructor(app: App, private member: MemberRecord, private onSubmit: (input: MemberUpdateInput) => Promise<void>) {
    super(app); this.input = { name: member.name, maritalStatus: member.maritalStatus, hasChildren: member.hasChildren, homeChurch: member.homeChurch, status: member.status };
  }
  onOpen(): void {
    this.contentEl.addClass("study-planner-modal"); this.setTitle(`Edit ${this.member.name}`);
    new Setting(this.contentEl).setName("Name").setDesc("Edit the profile note directly to rename a member.").addText(text => text.setValue(this.member.name).setDisabled(true));
    new Setting(this.contentEl).setName("Status").addDropdown(dropdown => dropdown.addOptions({ active: "Active", inactive: "Inactive" }).setValue(this.input.status).onChange(value => this.input.status = value));
    new Setting(this.contentEl).setName("Marital status").addDropdown(dropdown => dropdown.addOptions({ single: "Single", married: "Married", divorced: "Divorced" }).setValue(this.input.maritalStatus).onChange(value => this.input.maritalStatus = value as MemberUpdateInput["maritalStatus"]));
    new Setting(this.contentEl).setName("Children").addDropdown(dropdown => dropdown.addOptions({ no: "No children", yes: "Has children" }).setValue(this.input.hasChildren ? "yes" : "no").onChange(value => this.input.hasChildren = value === "yes"));
    new Setting(this.contentEl).setName("Home church").addText(text => text.setValue(this.input.homeChurch).onChange(value => this.input.homeChurch = value));
    submitButton(this, "Save member", () => this.onSubmit({ ...this.input, homeChurch: this.input.homeChurch.trim() }));
  }
}

export class SeasonModal extends Modal {
  private input: SeasonInput;
  constructor(app: App, defaultTime: string, private onSubmit: (input: SeasonInput) => Promise<void>) {
    super(app); const date = new Date();
    this.input = { name: `${date.getFullYear()} Study Season`, startDate: todayIso(), endDate: todayIso(), recurrence: "weekly", weekday: date.getDay(), meetingTime: defaultTime };
  }
  onOpen(): void {
    this.contentEl.addClass("study-planner-modal"); this.setTitle("Create study season");
    new Setting(this.contentEl).setName("Season name").addText(text => text.setValue(this.input.name).onChange(value => this.input.name = value));
    new Setting(this.contentEl).setName("Start date").addText(text => { text.inputEl.type = "date"; text.setValue(this.input.startDate).onChange(value => { this.input.startDate = value; const parsed = new Date(`${value}T12:00:00`); if (!Number.isNaN(parsed.valueOf())) this.input.weekday = parsed.getDay(); }); });
    new Setting(this.contentEl).setName("End date").addText(text => { text.inputEl.type = "date"; text.setValue(this.input.endDate).onChange(value => this.input.endDate = value); });
    new Setting(this.contentEl).setName("Frequency").addDropdown(dropdown => dropdown.addOptions({
      weekly: "Every week",
      biweekly: "Every two weeks",
      "monthly-first": "First weekday of each month",
      "monthly-second": "Second weekday of each month",
      "monthly-third": "Third weekday of each month",
      "monthly-fourth": "Fourth weekday of each month",
      "monthly-last": "Last weekday of each month",
      "monthly-first-third": "First and third weekdays",
      "monthly-second-fourth": "Second and fourth weekdays"
    }).setValue(this.input.recurrence).onChange(value => this.input.recurrence = value as SeasonInput["recurrence"]));
    new Setting(this.contentEl).setName("Meeting weekday").addDropdown(dropdown => dropdown.addOptions({ "0": "Sunday", "1": "Monday", "2": "Tuesday", "3": "Wednesday", "4": "Thursday", "5": "Friday", "6": "Saturday" }).setValue(String(this.input.weekday)).onChange(value => this.input.weekday = Number(value)));
    new Setting(this.contentEl).setName("Meeting time").addText(text => text.setValue(this.input.meetingTime).onChange(value => this.input.meetingTime = value));
    submitButton(this, "Create season", async () => { if (!this.input.name.trim() || !this.input.startDate || !this.input.endDate) throw new Error("Name and dates are required."); await this.onSubmit(this.input); });
  }
}

export class MeetingModal extends Modal {
  private input: MeetingInput;
  constructor(app: App, season: SeasonRecord, date: string, kind: MeetingKind, teachers: TeacherRecord[], goals: GoalRecord[], private onSubmit: (input: MeetingInput) => Promise<void>) {
    super(app); this.input = { seasonId: season.id, date, scheduleKind: kind, title: kind === "specific" ? "Special Event" : "Bible Study", passage: "", primaryTeacher: "", primaryTeacherId: "", supportingTeacher: "", supportingTeacherId: "", goalIds: [] }; this.teachers = teachers; this.goals = goals;
  }
  private teachers: TeacherRecord[]; private goals: GoalRecord[];
  onOpen(): void {
    this.contentEl.addClass("study-planner-modal"); this.setTitle(this.input.scheduleKind === "specific" ? "Create specific event or lesson" : "Plan recurring lesson");
    if (this.input.scheduleKind === "specific") new Setting(this.contentEl).setName("Date").addText(text => { text.inputEl.type = "date"; text.setValue(this.input.date).onChange(value => this.input.date = value); });
    else new Setting(this.contentEl).setName("Scheduled date").setDesc(this.input.date);
    new Setting(this.contentEl).setName("Lesson title").addText(text => text.setValue(this.input.title).onChange(value => this.input.title = value));
    new Setting(this.contentEl).setName("Bible passage").addText(text => text.setPlaceholder("Romans 8:1–17").onChange(value => this.input.passage = value));
    const options = Object.fromEntries([["", "Unassigned"], ...this.teachers.filter(item => item.status === "active").map(item => [item.id, item.name])]);
    new Setting(this.contentEl).setName("Primary leader").addDropdown(dropdown => dropdown.addOptions(options).onChange(value => { const teacher = this.teachers.find(item => item.id === value); this.input.primaryTeacherId = value; this.input.primaryTeacher = teacher?.name ?? ""; }));
    new Setting(this.contentEl).setName("Supporting leader").addDropdown(dropdown => dropdown.addOptions(options).onChange(value => { const teacher = this.teachers.find(item => item.id === value); this.input.supportingTeacherId = value; this.input.supportingTeacher = teacher?.name ?? ""; }));
    this.contentEl.createEl("h3", { text: "Goals this lesson advances" });
    for (const goal of this.goals.filter(goal => goal.status !== "completed")) { const row = this.contentEl.createEl("label", { cls: "study-planner-label-option" }); const check = row.createEl("input", { type: "checkbox" }); row.createSpan({ text: `${goal.title}${goal.focusAreas.length ? ` · ${goal.focusAreas.join(", ")}` : ""}` }); check.onchange = () => { this.input.goalIds = check.checked ? [...this.input.goalIds, goal.id] : this.input.goalIds.filter(id => id !== goal.id); }; }
    submitButton(this, "Create lesson", async () => { if (!this.input.date || !this.input.title.trim()) throw new Error("Date and title are required."); await this.onSubmit(this.input); });
  }
}

export class SchedulePickerModal extends Modal {
  constructor(app: App, private season: SeasonRecord, private dates: string[], private onSelect: (date: string) => void) { super(app); }
  onOpen(): void {
    this.contentEl.addClass("study-planner-modal"); this.setTitle("Plan next meeting");
    this.contentEl.createEl("p", { text: `Choose an unplanned date from ${this.season.name}.` });
    if (!this.dates.length) this.contentEl.createEl("p", { text: "Every recurring date in this season is already planned, completed, cancelled, or rescheduled." });
    const list = this.contentEl.createDiv({ cls: "study-planner-schedule-picker" });
    for (const date of this.dates) {
      const parsed = new Date(`${date}T12:00:00`); const friendly = Number.isNaN(parsed.valueOf()) ? date : parsed.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
      const row = list.createDiv({ cls: "study-planner-manager-row study-planner-schedule-option" }); row.createEl("strong", { text: friendly }); row.createEl("span", { text: date < todayIso() ? "Past scheduled date" : "Available scheduled date" });
      row.createEl("button", { text: "Plan this meeting", cls: "mod-cta" }).onclick = () => { this.close(); this.onSelect(date); };
    }
  }
}

export class GoalModal extends Modal {
  private input: GoalInput;
  constructor(app: App, seasonId: string, private areas: string[], private onSubmit: (input: GoalInput) => Promise<void>) { super(app); this.input = { seasonId, title: "", targetDate: "", focusAreas: [] }; }
  onOpen(): void {
    this.contentEl.addClass("study-planner-modal"); this.setTitle("Add season goal");
    new Setting(this.contentEl).setName("Goal").addText(text => text.onChange(value => this.input.title = value));
    new Setting(this.contentEl).setName("Target date").addText(text => { text.inputEl.type = "date"; text.onChange(value => this.input.targetDate = value); });
    const areas = labelPicker(this.contentEl, "Focus areas", "Shared with leader strengths to suggest leaders who can contribute.", this.areas);
    submitButton(this, "Create goal", async () => { if (!this.input.title.trim()) throw new Error("Goal is required."); await this.onSubmit({ ...this.input, focusAreas: areas() }); });
  }
}

export class AttendanceModal extends Modal {
  private attendance: Record<string, AttendanceStatus>; private guests: string; private leaderAttendance: Record<string, AttendanceStatus>;
  constructor(app: App, private members: MemberRecord[], private leaders: TeacherRecord[], existing: Record<string, AttendanceStatus>, leaderExisting: Record<string, AttendanceStatus>, guests: string[], private onSubmit: (attendance: Record<string, AttendanceStatus>, guests: string[], leaderAttendance: Record<string, AttendanceStatus>) => Promise<void>) {
    super(app); this.attendance = { ...existing }; this.leaderAttendance = { ...leaderExisting }; this.guests = guests.map(displayWikilink).join(", ");
  }
  onOpen(): void {
    this.contentEl.addClass("study-planner-modal"); this.setTitle("Record attendance");
    for (const member of this.members.filter(item => item.status === "active" || item.status === "guest" || Object.prototype.hasOwnProperty.call(this.attendance, item.id))) {
      if (!Object.prototype.hasOwnProperty.call(this.attendance, member.id)) this.attendance[member.id] = "absent";
      new Setting(this.contentEl).setName(member.memberType === "guest" ? `${member.name} (Guest)` : member.name).addDropdown(dropdown => dropdown.addOptions({ present: "Present", absent: "Absent", excused: "Excused" }).setValue(this.attendance[member.id] ?? "absent").onChange(value => this.attendance[member.id] = value as AttendanceStatus));
    }
    if (this.leaders.length) { this.contentEl.createEl("h3", { text: "Assigned leaders" }); for (const leader of this.leaders) { new Setting(this.contentEl).setName(leader.name).setDesc("Leader attendance for this lesson.").addDropdown(dropdown => dropdown.addOptions({ present: "Present", absent: "Absent", excused: "Excused" }).setValue(this.leaderAttendance[leader.id] ?? "present").onChange(value => this.leaderAttendance[leader.id] = value as AttendanceStatus)); if (!this.leaderAttendance[leader.id]) this.leaderAttendance[leader.id] = "present"; } }
    new Setting(this.contentEl).setName("Guests").setDesc("Comma-separated names").addTextArea(text => text.setValue(this.guests).onChange(value => this.guests = value));
    submitButton(this, "Save attendance", () => this.onSubmit(this.attendance, this.guests.split(",").map(value => value.trim()).filter(Boolean), this.leaderAttendance));
  }
}

export class GoalEditModal extends Modal {
  private targetDate: string; private areas: () => string[] = () => [];
  constructor(app: App, private goal: GoalRecord, private choices: string[], private onSubmit: (input: GoalUpdateInput) => Promise<void>) { super(app); this.targetDate = goal.targetDate; }
  onOpen(): void { this.contentEl.addClass("study-planner-modal"); this.setTitle(`Edit ${this.goal.title}`); new Setting(this.contentEl).setName("Goal").setDesc("Edit the goal note directly to rename it.").addText(text => text.setValue(this.goal.title).setDisabled(true)); new Setting(this.contentEl).setName("Target date").addText(text => { text.inputEl.type = "date"; text.setValue(this.targetDate); text.onChange(value => this.targetDate = value); }); this.areas = labelPicker(this.contentEl, "Focus areas", "Shared with leader strengths to suggest contributors.", this.choices, this.goal.focusAreas); submitButton(this, "Save goal", () => this.onSubmit({ targetDate: this.targetDate, focusAreas: this.areas() })); }
}

export class RescheduleModal extends Modal {
  private date: string;
  constructor(app: App, currentDate: string, private onSubmit: (date: string) => Promise<void>) { super(app); this.date = currentDate; }
  onOpen(): void {
    this.contentEl.addClass("study-planner-modal"); this.setTitle("Reschedule meeting");
    new Setting(this.contentEl).setName("Replacement date").addText(text => { text.inputEl.type = "date"; text.setValue(this.date).onChange(value => this.date = value); });
    submitButton(this, "Reschedule", async () => { if (!/^\d{4}-\d{2}-\d{2}$/.test(this.date)) throw new Error("Enter the date as YYYY-MM-DD."); await this.onSubmit(this.date); });
  }
}

export class GoalManagerModal extends Modal {
  constructor(app: App, private goals: GoalRecord[], private openGoal: (goal: GoalRecord) => void, private editGoal: (goal: GoalRecord) => void, private update: (goal: GoalRecord, complete: boolean, note: string) => Promise<void>) { super(app); }
  onOpen(): void {
    this.contentEl.addClass("study-planner-modal"); this.setTitle("Manage season goals");
    if (!this.goals.length) this.contentEl.createEl("p", { text: "No goals have been created for this season." });
    for (const goal of this.goals) {
      const row = this.contentEl.createDiv({ cls: "study-planner-manager-row" }); row.createEl("strong", { text: goal.title }); row.createEl("span", { text: `${goal.status}${goal.focusAreas.length ? ` · ${goal.focusAreas.join(", ")}` : ""}` });
      const note = row.createEl("input", { type: "text", placeholder: "Optional progress note" });
      const actions = row.createDiv({ cls: "study-planner-actions" }); actions.createEl("button", { text: "Open note" }).onclick = () => this.openGoal(goal); actions.createEl("button", { text: "Edit" }).onclick = () => this.editGoal(goal);
      const complete = goal.status !== "completed"; actions.createEl("button", { text: complete ? "Complete" : "Reopen", cls: complete ? "mod-cta" : "" }).onclick = async () => { await this.update(goal, complete, note.value); this.close(); };
    }
  }
}
