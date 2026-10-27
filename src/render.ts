import { WeekReport } from "./metrics.ts";
import { Settings, addDays, ymd } from "./model.ts";

const h = (n: number) => n.toFixed(1);
const signed = (n: number) => (n > 0.05 ? "+" : "") + n.toFixed(1);
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const md = (d: Date) => `${MON[d.getMonth()]} ${d.getDate()}`;
const pad = (s: string) => s.replace(/\|/g, "\\|");

export function render(r: WeekReport, st: Settings, generated: Date): string {
  const inProgress = r.through < addDays(r.monday, 7);
  const days = st.workdays.map(d => DOW[d]).join(", ");
  const L: string[] = [];

  L.push("---",
    "type: ledger",
    "uplink: []",
    `week_start: ${ymd(r.monday)}`,
    `week_end: ${ymd(r.sunday)}`,
    `complete: ${!inProgress}`,
    `available_h: ${h(r.available)}`,
    `planned_h: ${h(r.planned)}`,
    `actual_h: ${h(r.actual)}`,
    `outside_window_h: ${h(r.actualOutside)}`,
    `commitments_h: ${h(r.commitments)}`,
    `adherence_pct: ${r.adherencePct}`,
    `deep_pct: ${r.deepPct}`,
    `switches_per_day: ${r.switchesPerDay}`,
    `median_block_min: ${r.medianBlockMin}`,
    `generated: ${generated.toISOString()}`,
    "---",
    `# Job Ledger: ${md(r.monday)} to ${md(r.sunday)} ${r.sunday.getFullYear()}`,
    "");
  if (inProgress) L.push(`> [!note] Week in progress. Actuals through ${generated.toLocaleString()}.`, "");

  L.push("## Summary",
    "| Measure | Value |", "|---|---|",
    `| Available (${days} ${st.dayStart} to ${st.dayEnd}) | ${h(r.available)} h |`,
    `| Uncoded commitments in window | ${h(r.commitments)} h |`,
    `| Planned (coded blocks) | ${h(r.planned)} h |`,
    `| Actual (Clockify) | ${h(r.actual)} h |`,
    `| Actual outside window | ${h(r.actualOutside)} h |`,
    `| On-plan (actual inside a block of the same code) | ${r.adherencePct}% of planned |`,
    `| Time in blocks ≥ ${st.deepMinutes} min | ${r.deepPct}% |`,
    `| Switches per working day | ${r.switchesPerDay} |`,
    `| Median block | ${r.medianBlockMin} min |`,
    "");

  L.push("## Plan vs actual",
    "| Code | Name | Planned | Actual | Δ | On-plan |", "|---|---|--:|--:|--:|--:|");
  for (const c of r.codes) {
    const name = c.label.replace(c.code, "").trim();
    const cell = c.project && c.project.startsWith(c.code) ? `[[${c.project}\\|${c.code}]]` : c.code;
    const flag = c.planned === 0 ? " (unplanned)" : c.actual === 0 ? " (skipped)" : "";
    L.push(`| ${cell} | ${pad(name)}${flag} | ${h(c.planned)} | ${h(c.actual)} | ${signed(c.actual - c.planned)} | ${h(c.onPlan)} |`);
  }
  L.push(`| **Total** | | **${h(r.planned)}** | **${h(r.actual)}** | **${signed(r.actual - r.planned)}** | |`, "");

  L.push("## Fragmentation",
    `Blocks merge same-code entries less than ${st.mergeGapMinutes} min apart. A switch is a change of code between consecutive blocks.`,
    "",
    "### By day",
    "| Day | Hours | Blocks | Switches | Median block | ≥ " + st.deepMinutes + " min |", "|---|--:|--:|--:|--:|--:|");
  for (const d of r.days) {
    const dt = new Date(d.date + "T12:00:00");
    L.push(`| ${DOW[dt.getDay()]} ${md(dt)} | ${h(d.hours)} | ${d.blocks} | ${d.switches} | ${Math.round(d.medianMin)} min | ${d.deepPct}% |`);
  }
  if (!r.days.length) L.push("| (no entries) | | | | | |");
  L.push("", "### By division",
    "| Division | Hours | Blocks | Median block | ≥ " + st.deepMinutes + " min |", "|---|--:|--:|--:|--:|");
  for (const d of r.divisions) L.push(`| ${d.division} | ${h(d.hours)} | ${d.blocks} | ${Math.round(d.medianMin)} min | ${d.deepPct}% |`);
  L.push("");

  const n = r.next;
  L.push("## Next week",
    "| Measure | Hours |", "|---|--:|",
    `| Available | ${h(n.available)} |`,
    `| Uncoded commitments in window | ${h(n.commitments)} |`,
    `| Planned (coded blocks) | ${h(n.planned)} |`,
    `| Unscheduled window time | ${h(n.free)} |`,
    "");
  if (n.overcommitted) L.push(`> [!warning] Planned plus commitments (${h(n.planned + n.commitments)} h) exceed available (${h(n.available)} h).`, "");
  if (n.byCode.length) L.push(n.byCode.map(c => `- ${c.code}: ${h(c.planned)} h`).join("\n"), "");
  else L.push("- No coded blocks scheduled yet.", "");

  L.push("## Data issues");
  L.push(r.issues.length ? r.issues.map(i => `- ${i}`).join("\n") : "- None");
  L.push("");
  return L.join("\n");
}
