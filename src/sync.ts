// Pure planning for "Sync projects to Clockify". No Obsidian or network imports, so it is testable.
import { WORK_DIVISIONS } from "./model.ts";

export interface CodedNote {
  name: string;              // note basename, which is the Clockify project name ("CW-26005 Kitchen renovation")
  code: string;              // "CW-26005"
  client: string;            // may be blank
  billable: boolean | null;  // explicit `billable` property, or null for the default
}
export interface Named { id: string; name: string; archived: boolean }

export interface SyncPlan {
  createClients: string[];
  createProjects: { name: string; client: string; billable: boolean }[];
  createTags: string[];
  archivedMatches: string[];     // a project with this exact name exists but is archived: left alone
  caseMismatches: { note: string; clockify: string }[];  // same name except case: left alone
  alreadyPresent: number;
}

/** Billable by default for client work; never for overhead, personal, or chickens. */
export function defaultBillable(code: string): boolean {
  return WORK_DIVISIONS.includes(code.slice(0, 2)) && !code.endsWith("-OH");
}

export function planSync(notes: CodedNote[], projects: Named[], clients: Named[], tags: Named[], wantTags: string[]): SyncPlan {
  const active = new Set(projects.filter(p => !p.archived).map(p => p.name));
  const archived = new Set(projects.filter(p => p.archived).map(p => p.name));
  const lower = new Map(projects.filter(p => !p.archived).map(p => [p.name.toLowerCase(), p.name] as const));
  const clientNames = new Set(clients.filter(c => !c.archived).map(c => c.name.toLowerCase()));
  const tagNames = new Set(tags.filter(t => !t.archived).map(t => t.name.toLowerCase()));

  const plan: SyncPlan = { createClients: [], createProjects: [], createTags: [], archivedMatches: [], caseMismatches: [], alreadyPresent: 0 };
  const seen = new Set<string>();
  for (const n of [...notes].sort((a, b) => a.name.localeCompare(b.name))) {
    if (seen.has(n.name)) continue;
    seen.add(n.name);
    if (active.has(n.name)) { plan.alreadyPresent++; continue; }
    if (archived.has(n.name)) { plan.archivedMatches.push(n.name); continue; }
    const near = lower.get(n.name.toLowerCase());
    if (near) { plan.caseMismatches.push({ note: n.name, clockify: near }); continue; }
    const client = n.client.trim();
    if (client && !clientNames.has(client.toLowerCase())) {
      clientNames.add(client.toLowerCase());
      plan.createClients.push(client);
    }
    plan.createProjects.push({ name: n.name, client, billable: n.billable ?? defaultBillable(n.code) });
  }
  for (const t of wantTags.map(t => t.trim()).filter(Boolean)) {
    if (!tagNames.has(t.toLowerCase())) { tagNames.add(t.toLowerCase()); plan.createTags.push(t); }
  }
  return plan;
}

export const planIsEmpty = (p: SyncPlan) => !p.createClients.length && !p.createProjects.length && !p.createTags.length;

export function renderPlan(p: SyncPlan, heading: string, results?: string[]): string {
  const list = (xs: string[]) => (xs.length ? xs.map(x => `- ${x}`).join("\n") : "- None");
  const L = ["---", "type: ledger-sync", "---", `# ${heading}`, ""];
  if (results) L.push("## Results", list(results), "");
  L.push(
    `Projects already in Clockify with matching names: ${p.alreadyPresent}`, "",
    "## Projects to create", p.createProjects.length
      ? ["| Project | Client | Billable |", "|---|---|---|", ...p.createProjects.map(x => `| ${x.name} | ${x.client || "(none)"} | ${x.billable ? "Yes" : "No"} |`)].join("\n")
      : "- None",
    "", "## Clients to create", list(p.createClients),
    "", "## Tags to create", list(p.createTags),
    "", "## Left alone (fix by hand)",
    "### Archived in Clockify under the same name", list(p.archivedMatches),
    "### Name differs only in case", list(p.caseMismatches.map(m => `note "${m.note}" vs Clockify "${m.clockify}"`)),
    "");
  return L.join("\n");
}
