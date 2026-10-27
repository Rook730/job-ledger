import {
  Interval, Settings, addDays, clip, divisionOf, dur, hrs, median, overlap, total, windows, ymd,
} from "./model.ts";

export interface CodeRow { code: string; planned: number; actual: number; onPlan: number; label: string; project: string | null }
export interface DayRow { date: string; hours: number; blocks: number; switches: number; medianMin: number; deepPct: number }
export interface DivRow { division: string; hours: number; blocks: number; medianMin: number; deepPct: number }
export interface Block { code: string; start: Date; end: Date }

export interface WeekReport {
  monday: Date;
  sunday: Date;
  through: Date;                 // end of measured period (now, for a week in progress)
  available: number;             // h
  planned: number;               // coded calendar h (union per code, summed)
  actual: number;                // Clockify h
  actualInWindow: number;
  actualOutside: number;
  commitments: number;           // uncoded calendar h inside working windows
  adherencePct: number;          // on-plan h / planned h
  codes: CodeRow[];
  days: DayRow[];
  divisions: DivRow[];
  deepPct: number;
  switchesPerDay: number;
  medianBlockMin: number;
  next: { available: number; commitments: number; planned: number; free: number; overcommitted: boolean; byCode: { code: string; planned: number }[] };
  issues: string[];
}

const KEY_NONE = "(no code)";
/** Coded entries group by code; uncoded entries group by their own project name, so switches between them count. */
const keyOf = (e: Interval) => e.code ?? `${KEY_NONE} ${e.label}`;

/** Group same-code entries into blocks when the gap between them is small. */
export function blocks(entries: Interval[], gapMin: number): Block[] {
  const s = [...entries].sort((a, b) => a.start.getTime() - b.start.getTime());
  const out: Block[] = [];
  for (const e of s) {
    const code = keyOf(e);
    const last = out[out.length - 1];
    const sameDay = last && last.start.toDateString() === e.start.toDateString();
    if (last && sameDay && last.code === code && e.start.getTime() - last.end.getTime() <= gapMin * 60_000) {
      if (e.end > last.end) last.end = e.end;
    } else out.push({ code, start: e.start, end: e.end });
  }
  return out;
}

const pct = (a: number, b: number) => (b > 0 ? Math.round((1000 * a) / b) / 10 : 0);

export function weekReport(
  monday: Date, now: Date, entriesAll: Interval[], eventsAll: Interval[], nextEventsAll: Interval[], st: Settings, issues: string[],
): WeekReport {
  const nextMonday = addDays(monday, 7);
  const through = now < nextMonday ? now : nextMonday;
  const entries = clip(entriesAll, monday, through);
  const events = clip(eventsAll, monday, nextMonday);
  const win = windows(monday, st);

  const coded = events.filter(e => e.code);
  const uncoded = events.filter(e => !e.code);

  // ---- plan vs actual per code ----
  const codeSet = new Set<string>([...coded.map(e => e.code!), ...entries.map(keyOf)]);
  const codes: CodeRow[] = [...codeSet].sort().map(code => {
    const p = coded.filter(e => e.code === code);
    const a = entries.filter(e => keyOf(e) === code);
    const label = a[0]?.label ?? p[0]?.label ?? "";
    return { code, label, project: a[0]?.label ?? null, planned: hrs(total(p)), actual: hrs(total(a)), onPlan: hrs(overlap(p, a)) };
  });
  const planned = codes.reduce((s, r) => s + r.planned, 0);
  const onPlan = codes.reduce((s, r) => s + r.onPlan, 0);

  const actual = hrs(entries.reduce((s, e) => s + dur(e), 0));
  const actualInWindow = hrs(overlap(entries, win));
  const commitments = hrs(overlap(uncoded, win));
  const available = hrs(win.reduce((s, w) => s + dur(w), 0));

  // ---- fragmentation ----
  const bl = blocks(entries, st.mergeGapMinutes);
  const deepMs = st.deepMinutes * 60_000;
  const byDay = new Map<string, Block[]>();
  for (const b of bl) {
    const k = ymd(b.start);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k)!.push(b);
  }
  const days: DayRow[] = [...byDay.entries()].sort().map(([date, bs]) => {
    const t = bs.reduce((s, b) => s + dur(b), 0);
    let sw = 0;
    for (let i = 1; i < bs.length; i++) if (bs[i].code !== bs[i - 1].code) sw++;
    return {
      date, hours: hrs(t), blocks: bs.length, switches: sw,
      medianMin: median(bs.map(b => dur(b) / 60_000)),
      deepPct: pct(bs.filter(b => dur(b) >= deepMs).reduce((s, b) => s + dur(b), 0), t),
    };
  });
  const divMap = new Map<string, Block[]>();
  for (const b of bl) {
    const d = b.code.startsWith(KEY_NONE) ? KEY_NONE : divisionOf(b.code);
    if (!divMap.has(d)) divMap.set(d, []);
    divMap.get(d)!.push(b);
  }
  const divisions: DivRow[] = [...divMap.entries()].sort().map(([division, bs]) => {
    const t = bs.reduce((s, b) => s + dur(b), 0);
    return {
      division, hours: hrs(t), blocks: bs.length,
      medianMin: median(bs.map(b => dur(b) / 60_000)),
      deepPct: pct(bs.filter(b => dur(b) >= deepMs).reduce((s, b) => s + dur(b), 0), t),
    };
  });
  const allT = bl.reduce((s, b) => s + dur(b), 0);

  // ---- next week ----
  const nm = nextMonday, nn = addDays(nm, 7);
  const nEvents = clip(nextEventsAll, nm, nn);
  const nWin = windows(nm, st);
  const nCoded = nEvents.filter(e => e.code);
  const nByCode = [...new Set(nCoded.map(e => e.code!))].sort()
    .map(code => ({ code, planned: hrs(total(nCoded.filter(e => e.code === code))) }));
  const nAvail = hrs(nWin.reduce((s, w) => s + dur(w), 0));
  const nCommit = hrs(overlap(nEvents.filter(e => !e.code), nWin));
  const nPlanned = nByCode.reduce((s, r) => s + r.planned, 0);
  const nFree = nAvail - hrs(overlap(nEvents, nWin));

  // ---- data issues ----
  const noProj = entries.filter(e => !e.code);
  if (noProj.length) {
    const labels = [...new Set(noProj.map(e => e.label))].join(", ");
    issues.push(`${noProj.length} Clockify entr${noProj.length === 1 ? "y has" : "ies have"} no job code (${hrs(noProj.reduce((s, e) => s + dur(e), 0)).toFixed(1)} h): ${labels}`);
  }

  return {
    monday, sunday: addDays(monday, 6), through,
    available, planned, actual, actualInWindow, actualOutside: actual - actualInWindow, commitments,
    adherencePct: pct(onPlan, planned),
    codes, days, divisions,
    deepPct: pct(bl.filter(b => dur(b) >= deepMs).reduce((s, b) => s + dur(b), 0), allT),
    switchesPerDay: days.length ? Math.round((10 * days.reduce((s, d) => s + d.switches, 0)) / days.length) / 10 : 0,
    medianBlockMin: Math.round(median(bl.map(b => dur(b) / 60_000))),
    next: { available: nAvail, commitments: nCommit, planned: nPlanned, free: nFree, overcommitted: nPlanned + nCommit > nAvail, byCode: nByCode },
    issues,
  };
}

