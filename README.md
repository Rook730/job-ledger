# Job Ledger

Obsidian plugin (desktop only). Builds a weekly note from Clockify time entries and one or more ICS calendars, keyed by job code (`CE-26002`, `CW-OH`, ...).

## What it writes

`Job Ledger/Job Ledger YYYY.MM.DD.md` (date = the week's Sunday), with:

- **Summary:** available hours, uncoded commitments, planned, actual, outside-window, on-plan %, deep-block %, switches per day, median block.
- **Plan vs actual per code:** planned = calendar events whose title contains a job code; actual = Clockify entries whose project name contains a job code; on-plan = actual time that overlaps a planned block of the same code.
- **Fragmentation by day and by division:** same-code entries less than the merge gap apart form one block.
- **Next week:** coded hours already blocked, commitments, unscheduled window time, and an overcommit warning.
- **Data issues:** failed calendar fetches, entries without a job code. Failures are listed, never silent.

Frontmatter carries the headline numbers, so `Job Ledger.base` can trend them week over week.

## Runs

- On startup: writes last week's note if it is missing or was written mid-week.
- Commands: *Generate last week*, *Generate this week (to date)*, *Test connections*.
- *Test connections* writes `Job Ledger/Connection Test.md` and opens it: Clockify status, projects without a job code, Clockify projects and vault notes whose names don't match exactly, this week's entries, and per-calendar status with sample coded events.
- From Templater: `await app.plugins.plugins["job-ledger"].generateWeek(someDateInTheWeek)`.

## Settings

- **Clockify API key** (Profile settings > API). Workspace defaults to your active one.
- **Calendars:** any number of ICS links, each with a name and an on/off toggle.
  - Proton: Settings > Calendars > (calendar) > Share with anyone > Create link.
  - Google: calendar > Settings and sharing > Secret address in iCal format.
  - Treat these links like passwords. Keys and links are stored in this plugin's `data.json`, which Obsidian Sync syncs.
- **Availability:** working days, day start and end (default Mon to Fri, 08:30 to 14:30).
- **Deep block** (default 90 min), **merge gap** (default 5 min), **folder**, **auto-run**.

## API usage

About 4 to 5 Clockify calls per run (user, projects, entries). The free plan allows 30 per hour per workspace.

## Release (GitHub web UI)

1. Upload the repo files (not `node_modules`).
2. Create a release with a new tag matching `manifest.json` version (e.g. `0.1.0`).
3. The Release workflow tests, builds, and attaches `main.js` and `manifest.json`. Or attach the prebuilt files yourself.
4. BRAT: add this repo.

## Develop

```
npm install
npm test        # parser and metrics tests, TZ=America/New_York
npm run build   # main.js
```
