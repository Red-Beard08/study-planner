/* Shared settings and Markdown record shapes for the study planner. */

export type Recurrence = "weekly" | "biweekly" | "monthly" | "monthly-first" | "monthly-second" | "monthly-third" | "monthly-fourth" | "monthly-last" | "monthly-first-third" | "monthly-second-fourth";
export type AttendanceStatus = "present" | "absent" | "excused";
export type MeetingKind = "recurring" | "specific";
export type MaritalStatus = "single" | "married" | "divorced" | "unknown";

export interface PlannerSettings {
  rootFolder: string;
  defaultMeetingTime: string;
}

export const DEFAULT_SETTINGS: PlannerSettings = {
  rootFolder: "Study Planner",
  defaultMeetingTime: "19:00"
};

export interface MemberRecord { id: string; name: string; status: string; memberType: "member" | "guest"; maritalStatus: MaritalStatus; hasChildren: boolean; homeChurch: string; path: string; }
export interface MemberReportRow extends MemberRecord { firstAttendance: string; lastAttendance: string; attendanceCount: number; absentCount: number; excusedCount: number; recordedCount: number; }
export interface TeacherRecord { id: string; name: string; status: string; strengths: string[]; path: string; }
export interface GoalRecord { id: string; title: string; status: string; targetDate: string; focusAreas: string[]; path: string; }

export interface SeasonRecord {
  id: string;
  name: string;
  status: string;
  startDate: string;
  endDate: string;
  recurrence: Recurrence;
  weekday: number;
  meetingTime: string;
  folderPath: string;
  planPath: string;
}

export interface MeetingRecord {
  id: string;
  seasonId: string;
  date: string;
  originalDate: string;
  scheduleKind: MeetingKind;
  status: string;
  title: string;
  passage: string;
  primaryTeacher: string;
  primaryTeacherId: string;
  supportingTeacher: string;
  supportingTeacherId: string;
  attendance: Record<string, AttendanceStatus>;
  leaderAttendance: Record<string, AttendanceStatus>;
  attendanceRecorded: boolean;
  guests: string[];
  goals: string[];
  path: string;
}

export interface SeasonInput {
  name: string;
  startDate: string;
  endDate: string;
  recurrence: Recurrence;
  weekday: number;
  meetingTime: string;
}

export interface PersonInput { name: string; strengths: string[]; }
export interface TeacherUpdateInput extends PersonInput { status: string; }
export interface MemberInput { name: string; maritalStatus: MaritalStatus; hasChildren: boolean; homeChurch: string; }
export interface MemberUpdateInput extends MemberInput { status: string; }
export interface GoalInput { seasonId: string; title: string; targetDate: string; focusAreas: string[]; }
export interface GoalUpdateInput { targetDate: string; focusAreas: string[]; }
export interface MeetingInput {
  seasonId: string;
  date: string;
  scheduleKind: MeetingKind;
  title: string;
  passage: string;
  primaryTeacher: string;
  primaryTeacherId: string;
  supportingTeacher: string;
  supportingTeacherId: string;
  goalIds: string[];
}

export interface DashboardSummary {
  seasons: SeasonRecord[];
  season: SeasonRecord | null;
  nextDate: string;
  meetings: MeetingRecord[];
  members: MemberRecord[];
  teachers: TeacherRecord[];
  goals: GoalRecord[];
}
