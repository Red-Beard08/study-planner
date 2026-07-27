/* Small date, path, YAML, and identifier helpers shared by the plugin. */

export function cleanRootFolder(value: string): string {
  const candidate = value.trim().replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/+|\/+$/g, "");
  const unsafe = !candidate || candidate === "." || candidate.split("/").some(part => part === "..");
  return unsafe ? "Study Planner" : candidate;
}

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function safeName(value: string): string {
  return value.trim().replace(/[\\/:*?"<>|#[\]]/g, "-").replace(/\s+/g, " ").slice(0, 90) || "Untitled";
}

export function slug(value: string): string {
  return safeName(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function uniqueId(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${random}`;
}

export function yamlString(value: string): string {
  return JSON.stringify(value ?? "");
}

export function yamlList(values: string[]): string {
  return values.length ? values.map(value => `  - ${yamlString(value)}`).join("\n") : "  []";
}

export function parseDate(value: string): Date {
  return new Date(`${value}T12:00:00`);
}

export function formatIso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function nextScheduledDate(start: string, end: string, recurrence: string, weekday: number, after: string): string {
  const first = parseDate(start);
  while (first.getDay() !== weekday) first.setDate(first.getDate() + 1);
  let cursor = parseDate(after);
  cursor.setDate(cursor.getDate() + 1);
  if (cursor < first) cursor = new Date(first);
  const finish = parseDate(end);
  const legacyOrdinal = Math.floor((first.getDate() - 1) / 7) + 1;
  while (cursor <= finish) {
    if (cursor.getDay() === weekday && matchesRecurrence(cursor, first, recurrence, legacyOrdinal)) return formatIso(cursor);
    cursor.setDate(cursor.getDate() + 1);
  }
  return "";
}

export function scheduledDates(start: string, end: string, recurrence: string, weekday: number): string[] {
  const beforeStart = parseDate(start); beforeStart.setDate(beforeStart.getDate() - 1);
  const dates: string[] = [];
  let next = nextScheduledDate(start, end, recurrence, weekday, formatIso(beforeStart));
  while (next) {
    dates.push(next);
    next = nextScheduledDate(start, end, recurrence, weekday, next);
  }
  return dates;
}

function matchesRecurrence(date: Date, first: Date, recurrence: string, legacyOrdinal: number): boolean {
  const dayDifference = Math.round((date.valueOf() - first.valueOf()) / 86400000);
  if (recurrence === "weekly") return dayDifference >= 0 && dayDifference % 7 === 0;
  if (recurrence === "biweekly") return dayDifference >= 0 && dayDifference % 14 === 0;
  const ordinal = Math.floor((date.getDate() - 1) / 7) + 1;
  const isLast = date.getDate() + 7 > new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  if (recurrence === "monthly-first") return ordinal === 1;
  if (recurrence === "monthly-second") return ordinal === 2;
  if (recurrence === "monthly-third") return ordinal === 3;
  if (recurrence === "monthly-fourth") return ordinal === 4;
  if (recurrence === "monthly-last") return isLast;
  if (recurrence === "monthly-first-third") return ordinal === 1 || ordinal === 3;
  if (recurrence === "monthly-second-fourth") return ordinal === 2 || ordinal === 4;
  return ordinal === legacyOrdinal;
}

export function recurrenceLabel(recurrence: string, weekday: number): string {
  const day = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][weekday] ?? "meeting day";
  const labels: Record<string, string> = {
    weekly: `Every ${day}`,
    biweekly: `Every other ${day}`,
    monthly: `Monthly on the start-date occurrence of ${day}`,
    "monthly-first": `First ${day} of each month`,
    "monthly-second": `Second ${day} of each month`,
    "monthly-third": `Third ${day} of each month`,
    "monthly-fourth": `Fourth ${day} of each month`,
    "monthly-last": `Last ${day} of each month`,
    "monthly-first-third": `First and third ${day}s`,
    "monthly-second-fourth": `Second and fourth ${day}s`
  };
  return labels[recurrence] ?? recurrence;
}
