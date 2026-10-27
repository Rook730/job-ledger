import ICAL from "ical.js";
import { Interval, codeOf } from "./model.ts";

/**
 * Parse ICS text and return timed events overlapping [from, to), with recurrences expanded.
 * All-day events are skipped (they are not hours). Cancelled events are skipped.
 */
export function parseIcs(text: string, source: string, from: Date, to: Date): Interval[] {
  const root = new ICAL.Component(ICAL.parse(text));
  for (const tz of root.getAllSubcomponents("vtimezone")) {
    try { ICAL.TimezoneService.register(tz); } catch { /* already registered */ }
  }
  const vevents = root.getAllSubcomponents("vevent");
  const masters = new Map<string, ICAL.Event>();
  const exceptions: ICAL.Component[] = [];
  for (const v of vevents) {
    if (v.hasProperty("recurrence-id")) exceptions.push(v);
    else masters.set(String(v.getFirstPropertyValue("uid")), new ICAL.Event(v));
  }
  for (const x of exceptions) {
    const m = masters.get(String(x.getFirstPropertyValue("uid")));
    if (m) m.relateException(x);
    else masters.set(`${x.getFirstPropertyValue("uid")}#${x.getFirstPropertyValue("recurrence-id")}`, new ICAL.Event(x));
  }

  const out: Interval[] = [];
  const add = (summary: string, s: ICAL.Time, e: ICAL.Time, status: string | null) => {
    if (s.isDate || (status ?? "").toUpperCase() === "CANCELLED") return;
    const start = s.toJSDate(), end = e.toJSDate();
    if (end <= from || start >= to || end <= start) return;
    out.push({ start, end, code: codeOf(summary), label: summary, source });
  };

  for (const ev of masters.values()) {
    const status = ev.component.getFirstPropertyValue("status") as string | null;
    if (!ev.isRecurring()) {
      add(ev.summary ?? "", ev.startDate, ev.endDate ?? ev.startDate, status);
      continue;
    }
    const it = ev.iterator();
    let guard = 0;
    for (let next = it.next(); next && guard < 5000; next = it.next(), guard++) {
      if (next.toJSDate() >= to) break;
      const occ = ev.getOccurrenceDetails(next);
      const st = occ.item.component.getFirstPropertyValue("status") as string | null;
      add(occ.item.summary ?? "", occ.startDate, occ.endDate, st ?? status);
    }
  }
  return out;
}

/** De-duplicate the same event appearing in more than one calendar. */
export function dedupe(xs: Interval[]): Interval[] {
  const seen = new Set<string>();
  return xs.filter(x => {
    const k = `${x.label}|${x.start.getTime()}|${x.end.getTime()}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
