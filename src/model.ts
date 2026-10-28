// Pure data model and helpers. No Obsidian imports, so this file is testable in Node.

export const CODE_RE = /\b(CE|CW|KS|CK|PR|BZ)-(\d{5}|OH)\b/;
export const WORK_DIVISIONS = ["CE", "CW", "KS"];

export interface Interval {
  start: Date;
  end: Date;
  code: string | null;   // e.g. "CW-25002", null if none found
  label: string;         // project name or event title
  source: string;        // "Clockify" or calendar name
  tags?: string[];       // Clockify tag names (activity)
}

export interface Settings {
  clockifyKey: string;
  workspaceId: string;           // blank = user's active workspace
  calendars: { name: string; url: string; enabled: boolean }[];
  workdays: number[];            // JS getDay(): 1 = Mon ... 5 = Fri
  dayStart: string;              // "08:30"
  dayEnd: string;                // "14:30"
  folder: string;
  deepMinutes: number;           // a block this long or longer counts as deep work
  mergeGapMinutes: number;       // same-code entries this close are one block
  autoRun: boolean;
  tags: string[];                // activity tags to keep in Clockify
}

export const DEFAULT_SETTINGS: Settings = {
  clockifyKey: "",
  workspaceId: "",
  calendars: [],
  workdays: [1, 2, 3, 4, 5],
  dayStart: "08:30",
  dayEnd: "14:30",
  folder: "Job Ledger",
  deepMinutes: 90,
  mergeGapMinutes: 5,
  autoRun: true,
  tags: ["Travel", "Install", "Fab", "Site visit", "Design", "PM", "Concierge", "Admin", "Estimating"],
};

export const codeOf = (s: string | null | undefined): string | null => {
  const m = (s ?? "").match(CODE_RE);
  return m ? m[0] : null;
};
/** Work codes share one number per job; PR and CK have their own sequences and never roll up. */
export const jobNumberOf = (code: string | null): string | null => {
  const m = (code ?? "").match(/^(CE|CW|KS)-(\d{5})$/);
  return m ? m[2] : null;
};
export const divisionOf = (code: string | null): string => (code ? code.slice(0, 2) : "(none)");

// ---------- time ----------
const HOUR = 3600_000;
export const hrs = (ms: number) => ms / HOUR;
export const dur = (i: { start: Date; end: Date }) => Math.max(0, i.end.getTime() - i.start.getTime());

/** Monday 00:00 local of the week containing d. */
export function weekStart(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const back = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - back);
  return x;
}
export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
export const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const ymdDots = (d: Date) => ymd(d).replace(/-/g, ".");

/** Clip intervals to [from, to). */
export function clip<T extends { start: Date; end: Date }>(xs: T[], from: Date, to: Date): T[] {
  const out: T[] = [];
  for (const x of xs) {
    const s = Math.max(x.start.getTime(), from.getTime());
    const e = Math.min(x.end.getTime(), to.getTime());
    if (e > s) out.push({ ...x, start: new Date(s), end: new Date(e) });
  }
  return out;
}

/** Merge overlapping intervals into a sorted, non-overlapping list. */
export function union(xs: { start: Date; end: Date }[]): { start: Date; end: Date }[] {
  const s = [...xs].sort((a, b) => a.start.getTime() - b.start.getTime());
  const out: { start: Date; end: Date }[] = [];
  for (const x of s) {
    const last = out[out.length - 1];
    if (last && x.start.getTime() <= last.end.getTime()) {
      if (x.end > last.end) last.end = x.end;
    } else out.push({ start: x.start, end: x.end });
  }
  return out;
}
export const total = (xs: { start: Date; end: Date }[]) => union(xs).reduce((a, x) => a + dur(x), 0);

/** Total overlap between two interval sets (each unioned first). */
export function overlap(a: { start: Date; end: Date }[], b: { start: Date; end: Date }[]): number {
  const A = union(a), B = union(b);
  let i = 0, j = 0, sum = 0;
  while (i < A.length && j < B.length) {
    const s = Math.max(A[i].start.getTime(), B[j].start.getTime());
    const e = Math.min(A[i].end.getTime(), B[j].end.getTime());
    if (e > s) sum += e - s;
    if (A[i].end < B[j].end) i++; else j++;
  }
  return sum;
}

/** Available working windows for the 7 days starting at monday. */
export function windows(monday: Date, st: Settings): { start: Date; end: Date }[] {
  const [sh, sm] = st.dayStart.split(":").map(Number);
  const [eh, em] = st.dayEnd.split(":").map(Number);
  const out: { start: Date; end: Date }[] = [];
  for (let k = 0; k < 7; k++) {
    const d = addDays(monday, k);
    if (!st.workdays.includes(d.getDay())) continue;
    out.push({
      start: new Date(d.getFullYear(), d.getMonth(), d.getDate(), sh, sm),
      end: new Date(d.getFullYear(), d.getMonth(), d.getDate(), eh, em),
    });
  }
  return out;
}

export const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
