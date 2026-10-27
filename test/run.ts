// Run: npm test   (TZ=America/New_York)
import assert from "node:assert/strict";
import { parseIcs, dedupe } from "../src/ics.ts";
import { weekReport, blocks } from "../src/metrics.ts";
import { render } from "../src/render.ts";
import { Clockify } from "../src/clockify.ts";
import { DEFAULT_SETTINGS, Interval, weekStart, addDays } from "../src/model.ts";

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
    { id: "p1", name: "CE-26002 Tandem machine" }, { id: "p2", name: "BZ-OH Shared admin" }, { id: "p3", name: "Old stuff" }] };
  if (url.includes("/projects")) return { status: 200, text: "", json: [] };
  if (url.includes("/time-entries")) return { status: 200, text: "", json: [
    { projectId: "p1", timeInterval: { start: at(19, 9), end: at(19, 11) } },          // 2h on plan
    { projectId: "p1", timeInterval: { start: at(19, 11, 3), end: at(19, 12) } },       // merges (3 min gap)
    { projectId: "p2", timeInterval: { start: at(20, 9), end: at(20, 9, 30) } },        // switch
    { projectId: "p1", timeInterval: { start: at(20, 9, 30), end: at(20, 10, 30) } },   // switch
    { projectId: "p2", timeInterval: { start: at(20, 10, 30), end: at(20, 10, 45) } },  // switch
    { projectId: "p3", timeInterval: { start: at(21, 16), end: at(21, 17) } },          // uncoded, outside window
    { projectId: null, timeInterval: { start: at(22, 8), end: at(22, 8, 20) } },        // no project
  ] };
  throw new Error("unexpected " + url);
};
const entries: Interval[] = await new Clockify(fake as any, "k").entries(mon, addDays(mon, 7), new Date(2026, 10, 1));
assert.equal(entries.length, 7);

const bl = blocks(entries, 5);
assert.equal(bl.length, 6, "two Monday entries merge into one block");
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
assert.equal(Math.round(r.actualOutside * 60), 60 + 20);   // 16-17 on Wed, 08:00-08:20 Thu

const md = render(r, DEFAULT_SETTINGS, new Date(2026, 10, 1));
assert.ok(!md.includes("—"), "no em dashes");
console.log("\n" + md);
console.log("ALL TESTS PASSED");
