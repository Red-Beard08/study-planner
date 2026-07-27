/* Mobile-friendly modal forms for seasons, people, meetings, attendance, and goals. */

import { App, Modal, Setting } from "obsidian";
import type { AttendanceStatus, GoalInput, GoalRecord, MeetingInput, MeetingKind, MemberInput, MemberRecord, MemberReportRow, MemberUpdateInput, PersonInput, SeasonInput, SeasonRecord, TeacherRecord } from "./types";
import { todayIso } from "./utils";

function submitButton(modal: Modal, label: string, onSubmit: () => Promise<void>): void {
  new Setting(modal.contentEl).addButton(button => button.setButtonText(label).setCta().onClick(async () => { button.setDisabled(true); try { await onSubmit(); modal.close(); } finally { button.setDisabled(false); } }));
}

export class PersonModal extends Modal {
  private name = "";
  constructor(app: App, private titleText: string, private onSubmit: (input: PersonInput) => Promise<void>) { super(app); }
  onOpen(): void {
    this.contentEl.addClass("study-planner-modal"); this.setTitle(this.titleText);
    new Setting(this.contentEl).setName("Name").addText(text => text.onChange(value => this.name = value));
    submitButton(this, "Create", async () => { if (!this.name.trim()) throw new Error("Name is required."); await this.onSubmit({ name: this.name.trim() }); });
  }
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
  constructor(app: App, season: SeasonRecord, date: string, kind: MeetingKind, teachers: TeacherRecord[], private onSubmit: (input: MeetingInput) => Promise<void>) {
    super(app); this.input = { seasonId: season.id, date, scheduleKind: kind, title: kind === "specific" ? "Special Event" : "Bible Study", passage: "", primaryTeacher: "", supportingTeacher: "" }; this.teachers = teachers;
  }
  private teachers: TeacherRecord[];
  onOpen(): void {
    this.contentEl.addClass("study-planner-modal"); this.setTitle(this.input.scheduleKind === "specific" ? "Create specific event or lesson" : "Plan recurring lesson");
    if (this.input.scheduleKind === "specific") new Setting(this.contentEl).setName("Date").addText(text => { text.inputEl.type = "date"; text.setValue(this.input.date).onChange(value => this.input.date = value); });
    else new Setting(this.contentEl).setName("Scheduled date").setDesc(this.input.date);
    new Setting(this.contentEl).setName("Lesson title").addText(text => text.setValue(this.input.title).onChange(value => this.input.title = value));
    new Setting(this.contentEl).setName("Bible passage").addText(text => text.setPlaceholder("Romans 8:1–17").onChange(value => this.input.passage = value));
    const options = Object.fromEntries([["", "Unassigned"], ...this.teachers.filter(item => item.status === "active").map(item => [item.name, item.name])]);
    new Setting(this.contentEl).setName("Primary teacher").addDropdown(dropdown => dropdown.addOptions(options).onChange(value => this.input.primaryTeacher = value));
    new Setting(this.contentEl).setName("Supporting teacher").addDropdown(dropdown => dropdown.addOptions(options).onChange(value => this.input.supportingTeacher = value));
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
  constructor(app: App, seasonId: string, private onSubmit: (input: GoalInput) => Promise<void>) { super(app); this.input = { seasonId, title: "", targetDate: "" }; }
  onOpen(): void {
    this.contentEl.addClass("study-planner-modal"); this.setTitle("Add season goal");
    new Setting(this.contentEl).setName("Goal").addText(text => text.onChange(value => this.input.title = value));
    new Setting(this.contentEl).setName("Target date").addText(text => { text.inputEl.type = "date"; text.onChange(value => this.input.targetDate = value); });
    submitButton(this, "Create goal", async () => { if (!this.input.title.trim()) throw new Error("Goal is required."); await this.onSubmit(this.input); });
  }
}

export class AttendanceModal extends Modal {
  private attendance: Record<string, AttendanceStatus>; private guests: string;
  constructor(app: App, private members: MemberRecord[], existing: Record<string, AttendanceStatus>, guests: string[], private onSubmit: (attendance: Record<string, AttendanceStatus>, guests: string[]) => Promise<void>) {
    super(app); this.attendance = { ...existing }; this.guests = guests.join(", ");
  }
  onOpen(): void {
    this.contentEl.addClass("study-planner-modal"); this.setTitle("Record attendance");
    for (const member of this.members.filter(item => item.status === "active" || Object.prototype.hasOwnProperty.call(this.attendance, item.id))) {
      new Setting(this.contentEl).setName(member.name).addDropdown(dropdown => dropdown.addOptions({ present: "Present", absent: "Absent", excused: "Excused" }).setValue(this.attendance[member.id] ?? "absent").onChange(value => this.attendance[member.id] = value as AttendanceStatus));
    }
    new Setting(this.contentEl).setName("Guests").setDesc("Comma-separated names").addTextArea(text => text.setValue(this.guests).onChange(value => this.guests = value));
    submitButton(this, "Save attendance", () => this.onSubmit(this.attendance, this.guests.split(",").map(value => value.trim()).filter(Boolean)));
  }
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
  constructor(app: App, private goals: GoalRecord[], private openGoal: (goal: GoalRecord) => void, private update: (goal: GoalRecord, complete: boolean, note: string) => Promise<void>) { super(app); }
  onOpen(): void {
    this.contentEl.addClass("study-planner-modal"); this.setTitle("Manage season goals");
    if (!this.goals.length) this.contentEl.createEl("p", { text: "No goals have been created for this season." });
    for (const goal of this.goals) {
      const row = this.contentEl.createDiv({ cls: "study-planner-manager-row" }); row.createEl("strong", { text: goal.title }); row.createEl("span", { text: goal.status });
      const note = row.createEl("input", { type: "text", placeholder: "Optional progress note" });
      const actions = row.createDiv({ cls: "study-planner-actions" }); actions.createEl("button", { text: "Open note" }).onclick = () => this.openGoal(goal);
      const complete = goal.status !== "completed"; actions.createEl("button", { text: complete ? "Complete" : "Reopen", cls: complete ? "mod-cta" : "" }).onclick = async () => { await this.update(goal, complete, note.value); this.close(); };
    }
  }
}
