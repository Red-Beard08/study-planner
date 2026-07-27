# Study Planner

Study Planner is a Markdown-first Obsidian plugin for running a men's Bible study across multiple seasons. It plans recurring and one-off lessons, assigns teachers, tracks season goals, manages members, and records attendance without Dataview or an external service.

Version `1.0.0` is the first public beta. Test with sample data before adopting it for an established study.

## Features

- Permanent dashboard for seasons, members, teachers, goals, and meetings
- Weekly, biweekly, ordinal-monthly, first-and-third, second-and-fourth, and last-weekday recurrence
- Date pickers for seasons, lessons, goals, and rescheduling
- Recurring lesson slots plus independent events and lessons
- Member profiles, active/inactive status, demographics, and attendance summaries
- Central attendance data projected into lessons, profiles, season summaries, and reports
- Portable Markdown files that remain usable without the plugin
- Responsive desktop, iPhone, and iPad interfaces

## Installation

### GitHub release

1. Open the repository's **Releases** page.
2. Download `manifest.json`, `main.js`, and `styles.css` from the same release.
3. Create `<vault>/.obsidian/plugins/study-planner/`.
4. Copy the three files into that folder.
5. Reload Obsidian and enable **Study Planner** under **Community plugins**.

### Development build

```bash
npm ci
npm run build
```

Copy `manifest.json`, `main.js`, and `styles.css` into the plugin folder shown above.

## How to use

### Create a season

Open Study Planner from the book-check ribbon icon or run **Study Planner: Open dashboard**. Choose **Create season**, select start and end dates, a meeting weekday, recurrence, and default meeting time.

The season plan immediately lists every calculated recurring date. Each slot remains unplanned until you create its lesson. Opening a season dashboard shows its goals, attendance, recurring dates, and specific events.

### Add members and teachers

Use **Add member** to record a member's name, marital status, whether he has children, and home church. The dashboard shows active members and their attendance across the three latest completed events.

Use **Manage members** to edit details or mark a member active or inactive. Use **Members report** for first attendance, latest attendance, totals, and separate active and inactive reports.

Teachers are separate records. Use **Add teacher** to make someone available in lesson-planning forms.

### Plan meetings

Choose **Plan next meeting** from a season dashboard to select an unplanned recurring date. Enter the lesson title, passage, and teachers.

Choose **Create specific event/lesson** for an event outside the recurrence. Planned meetings can be opened, rescheduled, cancelled, or completed without losing their original schedule date.

### Record attendance

Choose **Take attendance** on a meeting. Mark members present, absent, or excused and add optional guests. Saving attendance completes the meeting and rebuilds the season, member, and report summaries from the same structured data.

### Track goals

Use **Add goal** for a season outcome and optional target date. **Manage goals** completes, reopens, and records progress notes for existing goals.

## Generated files

The default root folder is `Study Planner/` and can be changed in settings:

```text
Study Planner/
|-- Members/
|-- Teachers/
|-- Seasons/
|   `-- Season Name/
|       |-- Season Plan.md
|       |-- Goals/
|       `-- Meetings/
|-- Templates/
`-- Members Report.md
```

Open, search, link, and edit these notes normally. Preserve each note's `type` and stable identifier properties. Content between `study-planner:*` markers is managed by the plugin; keep permanent notes outside those blocks.

Changing the configured root does not move existing records.

## Mobile support

Study Planner uses Obsidian's cross-platform Vault and FileManager APIs and has no Node.js or Electron runtime dependency. On iOS, allow the plugin files and vault records to finish syncing before editing the same study from another device.

## Limitations

- Supports one study group, multiple seasons, and one active season at a time.
- Does not synchronize with external calendars or send notifications.
- Members and teachers are separate records and are not deduplicated automatically.
- Recurrence exceptions are represented by cancelled or rescheduled meeting records.
- Simultaneous offline edits depend on the vault's synchronization provider.
- Directly removing required YAML fields can make records disappear from dashboards.

## Development and release

```bash
npm ci
npm test
```

`npm test` type-checks, builds, exercises recurrence and path behavior, validates release assets, checks mobile constraints, and scans for private or machine-specific references.

The **Release** GitHub workflow validates the requested version, creates its numeric tag, and publishes `main.js`, `manifest.json`, and `styles.css`.

## License

MIT
