// Run: npm test   (TZ=America/New_York)
import assert from "node:assert/strict";
import { parseIcs, dedupe } from "../src/ics.ts";
import { weekReport, blocks } from "../src/metrics.ts";
import { render } from "../src/render.ts";
import { Clockify } from "../src/clockify.ts";
import { DEFAULT_SETTINGS, Interval, weekStart, addDays } from "../src/model.ts";
import { planSync, defaultBillable, renderPlan, parseTagTable } from "../src/sync.ts";
import { readFileSync } from "node:fs";

const ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:test
BEGIN:VTIMEZONE
TZID:America/New_York
BEGIN:DAYLIGHT
TZOFFSETFROM:-0500
TZOFFSETTO:-0400
TZNAME:EDT
DTSTART:19700308T020000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU
END:DAYLIGHT
BEGIN:STANDARD
TZOFFSETFROM:-0400
TZOFFSETTO:-0500
TZNAME:EST
DTSTART:19701101T020000
RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU
END:STANDARD
END:VTIMEZONE
BEGIN:VEVENT
UID:rec-1
SUMMARY:CE-26002 PLC logic
DTSTART;TZID=America/New_York:20261019T090000
DTEND;TZID=America/New_York:20261019T120000
RRULE:FREQ=DAILY;COUNT=5
EXDATE;TZID=America/New_York:20261021T090000
END:VEVENT
BEGIN:VEVENT
UID:rec-1
RECURRENCE-ID;TZID=America/New_York:20261022T090000
SUMMARY:CE-26002 PLC logic (moved)
DTSTART;TZID=America/New_York:20261022T100000
DTEND;TZID=America/New_York:20261022T110000
END:VEVENT
BEGIN:VEVENT
UID:appt
SUMMARY:Dentist
DTSTART:20261020T170000Z
DTEND:20261020T180000Z
END:VEVENT
BEGIN:VEVENT
UID:allday
SUMMARY:CW-26003 Market day
DTSTART;VALUE=DATE:20261024
DTEND;VALUE=DATE:20261025
END:VEVENT
BEGIN:VEVENT
UID:cancel
SUMMARY:KS-26005 cancelled walk
STATUS:CANCELLED
DTSTART:20261023T140000Z
DTEND:20261023T150000Z
END:VEVENT
BEGIN:VEVENT
UID:next
SUMMARY:KS-26005 site visit
DTSTART;TZID=America/New_York:20261027T090000
DTEND;TZID=America/New_York:20261027T113000
END:VEVENT
END:VCALENDAR`;

const mon = weekStart(new Date(2026, 9, 21));           // Mon Oct 19 2026
assert.equal(mon.getDate(), 19);
const ev = dedupe([...parseIcs(ICS, "Work", mon, addDays(mon, 14)), ...parseIcs(ICS, "Dup", mon, addDays(mon, 14))]);
const titles = ev.map(e => `${e.start.getDate()} ${e.start.getHours()}:${String(e.start.getMinutes()).padStart(2, "0")} ${e.label}`).sort();
console.log("events:", titles);
// rec-1: 19, 20, 22 (moved to 10:00, 1h), 23; 21 excluded; dentist 13:00 local; all-day + cancelled excluded; next-week visit
assert.deepEqual(titles, [
  "19 9:00 CE-26002 PLC logic",
  "20 13:00 Dentist",
  "20 9:00 CE-26002 PLC logic",
  "22 10:00 CE-26002 PLC logic (moved)",
  "23 9:00 CE-26002 PLC logic",
  "27 9:00 KS-26005 site visit",
]);

// Clockify via fake HTTP
const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).toISOString();
const fake = async (url: string) => {
  if (url.endsWith("/user")) return { status: 200, text: "", json: { id: "u1", activeWorkspace: "w1", name: "Nick" } };
  if (url.includes("/projects?archived=false")) return { status: 200, text: "", json: [
    { id: "p1", name: "CE-26002 Tandem machine" }, { id: "p2", name: "BZ-OH Shared admin" }, { id: "p3", name: "Old stuff" },
    { id: "p4", name: "KS-26005 Kitchen renovation" }, { id: "p5", name: "CW-26005 Kitchen renovation" }, { id: "p6", name: "PR-26005 Shed" }] };
  if (url.includes("/tags")) return { status: 200, text: "", json: [{ id: "t1", name: "Travel" }, { id: "t2", name: "Install" }, { id: "t3", name: "PM" }] };
  if (url.includes("/projects")) return { status: 200, text: "", json: [] };
  if (url.includes("/time-entries")) return { status: 200, text: "", json: [
    { projectId: "p1", timeInterval: { start: at(19, 9), end: at(19, 11) } },          // 2h on plan
    { projectId: "p1", timeInterval: { start: at(19, 11, 3), end: at(19, 12) } },       // merges (3 min gap)
    { projectId: "p2", timeInterval: { start: at(20, 9), end: at(20, 9, 30) } },        // switch
    { projectId: "p1", timeInterval: { start: at(20, 9, 30), end: at(20, 10, 30) } },   // switch
    { projectId: "p2", timeInterval: { start: at(20, 10, 30), end: at(20, 10, 45) } },  // switch
    { projectId: "p3", timeInterval: { start: at(21, 16), end: at(21, 17) } },          // uncoded, outside window
    { projectId: null, timeInterval: { start: at(22, 8), end: at(22, 8, 20) } },        // no project
    { projectId: "p4", tagIds: ["t3"], timeInterval: { start: at(23, 9), end: at(23, 10) } },        // KS-26005 PM 1h
    { projectId: "p5", tagIds: ["t2"], timeInterval: { start: at(23, 10), end: at(23, 12) } },       // CW-26005 Install 2h
    { projectId: "p5", tagIds: ["t1", "t2"], timeInterval: { start: at(23, 12), end: at(23, 12, 30) } }, // two tags
    { projectId: "p6", timeInterval: { start: at(24, 9), end: at(24, 10) } },                        // PR-26005: must not roll up
  ] };
  throw new Error("unexpected " + url);
};
const entries: Interval[] = await new Clockify(fake as any, "k").entries(mon, addDays(mon, 7), new Date(2026, 10, 1));
assert.equal(entries.length, 11);

const bl = blocks(entries, 5);
assert.equal(bl.length, 9, "two Monday entries merge; KS/CW switch on Fri; Sat separate");
// Two different uncoded projects back to back must stay separate blocks
const u = (h0: number, h1: number, name: string): Interval => ({ start: new Date(2026, 9, 23, h0), end: new Date(2026, 9, 23, h1), code: null, label: name, source: "Clockify" });
assert.equal(blocks([u(9, 10, "Travel"), u(10, 12, "Kitchen")], 5).length, 2, "uncoded projects do not merge");

const r = weekReport(mon, new Date(2026, 10, 1), entries, ev, ev, DEFAULT_SETTINGS, []);
console.log(JSON.stringify({ ...r, codes: r.codes, days: r.days, divisions: r.divisions }, (k, v) => typeof v === "number" ? Math.round(v * 100) / 100 : v, 1).slice(0, 2500));

const row = (c: string) => r.codes.find(x => x.code === c)!;
assert.equal(r.available, 30);
assert.equal(row("CE-26002").planned, 3 + 3 + 1 + 3);   // 10h planned
assert.equal(Math.round(row("CE-26002").actual * 60), 177 + 60); // 2h + 57m + 1h
assert.equal(Math.round(row("CE-26002").onPlan * 60), 177 + 60);
assert.equal(r.commitments, 1);                            // dentist 13:00-14:00 in window
assert.equal(r.next.planned, 2.5);
assert.equal(r.days.find(d => d.date === "2026-10-20")!.switches, 2);
assert.ok(r.issues.some(i => i.includes("no job code")));
assert.ok(r.codes.some(c => c.code === "(no code) Old stuff") && r.codes.some(c => c.code === "(no code) (no project)"), "uncoded rows split by project");
assert.equal(Math.round(r.actualOutside * 60), 60 + 20 + 60);   // 16-17 Wed, 08:00-08:20 Thu, Sat 9-10

// Job rollup: 26005 = KS 1h + CW 2.5h; PR-26005 excluded; CE-26002 single
const j = r.jobs.find(x => x.job === "26005")!;
assert.equal(j.split.length, 2);
assert.equal(j.actual, 3.5);
assert.equal(j.name, "Kitchen renovation");
assert.ok(!r.jobs.some(x => x.split.some(s => s.code.startsWith("PR"))), "PR never rolls up with work");
// Activities: Install = 2h + 0.5h, Travel = 0.5h, PM = 1h, two-tag entry counted in both
const act = (t: string) => r.activities.find(a => a.tag === t)!;
assert.equal(act("Install").hours, 2.5);
assert.equal(act("Travel").hours, 0.5);
assert.equal(act("PM").hours, 1);
assert.equal(r.activities[r.activities.length - 1].tag, "(untagged)");

// Sync planning
assert.equal(defaultBillable("KS-26005"), true);
assert.equal(defaultBillable("CW-OH"), false);
assert.equal(defaultBillable("PR-26001"), false);
assert.equal(defaultBillable("CK-26001"), false);
const plan = planSync(
  [
    { name: "KS-26005 Kitchen renovation", code: "KS-26005", client: "Hotch", billable: null },   // present
    { name: "CW-26005 Kitchen renovation", code: "CW-26005", client: "Hotch", billable: null },   // missing, client exists
    { name: "CW-26006 Box build", code: "CW-26006", client: "Borg Warner", billable: null },      // missing, new client
    { name: "CW-26003 Winter market", code: "CW-26003", client: "Fernleaf", billable: false },    // explicit false
    { name: "CE-26002 Tandem machine", code: "CE-26002", client: "MGM Brakes", billable: null },  // archived match
    { name: "CW-OH Overhead", code: "CW-OH", client: "", billable: null },                         // case mismatch
    { name: "PR-26001 West side yard", code: "PR-26001", client: "", billable: null },
  ],
  [
    { id: "a", name: "KS-26005 Kitchen renovation", archived: false },
    { id: "b", name: "CE-26002 Tandem machine", archived: true },
    { id: "c", name: "CW-OH overhead", archived: false },
  ],
  [{ id: "c1", name: "hotch", archived: false }],
  [{ id: "t1", name: "travel", archived: false }],
  ["Travel", "Install", "Install", " "],
);
assert.equal(plan.alreadyPresent, 1);
assert.deepEqual(plan.createProjects.map(p => `${p.name}|${p.client}|${p.billable}`), [
  "CW-26003 Winter market|Fernleaf|false",
  "CW-26005 Kitchen renovation|Hotch|true",
  "CW-26006 Box build|Borg Warner|true",
  "PR-26001 West side yard||false",
]);
assert.deepEqual(plan.createClients.sort(), ["Borg Warner", "Fernleaf"]);
assert.deepEqual(plan.createTags, ["Install"]);
assert.deepEqual(plan.archivedMatches, ["CE-26002 Tandem machine"]);
assert.equal(plan.caseMismatches.length, 1);
console.log("\n" + renderPlan(plan, "Clockify sync: preview"));

// Tag table parsing: the user's convention note (Obsidian-formatted table with padding and alignment)
const conv = readFileSync(new URL("./fixtures/convention.md", import.meta.url), "utf8");
assert.deepEqual(parseTagTable(conv), ["Project Management", "Consultation", "Design", "Estimating", "Site visit", "Fabrication",
  "Install", "Service", "Preventative maintenance", "Concierge", "Administrative", "Travel"]);
assert.deepEqual(parseTagTable("## Activity tags\n\n| Tag | Use |\n| :--- | ---: |\n| `Travel` | x |\n| **PM** | y |\n\nText\n| Stray | z |"), ["Travel", "PM"]);
assert.deepEqual(parseTagTable("# Other\n| Tag |\n|---|\n| X |"), []);

const md = render(r, DEFAULT_SETTINGS, new Date(2026, 10, 1));
assert.ok(!md.includes("—"), "no em dashes");
console.log("\n" + md);
console.log("ALL TESTS PASSED");
