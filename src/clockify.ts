import { Interval, codeOf } from "./model.ts";

export type Http = (url: string, init: { method?: string; headers?: Record<string, string>; body?: string }) =>
  Promise<{ status: number; json: any; text: string }>;

const API = "https://api.clockify.me/api/v1";

export class Clockify {
  constructor(private http: Http, private key: string, private workspaceOverride = "") {}

  private async get(path: string): Promise<any> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = await this.http(API + path, { headers: { "X-Api-Key": this.key } });
      if (r.status === 429) { await new Promise(res => setTimeout(res, 2000 * (attempt + 1))); continue; }
      if (r.status === 401 || r.status === 403) throw new Error("Clockify rejected the API key");
      if (r.status >= 400) throw new Error(`Clockify ${r.status} on ${path.split("?")[0]}: ${r.text.slice(0, 200)}`);
      return r.json;
    }
    throw new Error("Clockify rate limit (429) persisted after retries");
  }

  async whoami(): Promise<{ userId: string; workspaceId: string; name: string }> {
    const u = await this.get("/user");
    return { userId: u.id, workspaceId: this.workspaceOverride || u.activeWorkspace || u.defaultWorkspace, name: u.name };
  }

  /** All projects in the workspace, active and archived. */
  async projects(workspaceId: string): Promise<{ id: string; name: string; archived: boolean }[]> {
    const out: { id: string; name: string; archived: boolean }[] = [];
    for (const archived of [false, true]) {
      for (let page = 1; page < 20; page++) {
        const ps: any[] = await this.get(`/workspaces/${workspaceId}/projects?archived=${archived}&page=${page}&page-size=200`);
        for (const p of ps) out.push({ id: p.id, name: p.name, archived });
        if (ps.length < 200) break;
      }
    }
    return out;
  }

  /** Time entries starting in [from, to), as intervals. Running timers end at `now`. */
  async entries(
    from: Date, to: Date, now: Date,
    pre?: { userId: string; workspaceId: string; projects: Map<string, string> },
  ): Promise<Interval[]> {
    const { userId, workspaceId } = pre ?? await this.whoami();
    const ws = `/workspaces/${workspaceId}`;
    const projects = pre?.projects ?? new Map((await this.projects(workspaceId)).map(p => [p.id, p.name] as const));

    const out: Interval[] = [];
    const size = 1000;
    for (let page = 1; page < 50; page++) {
      const q = `start=${encodeURIComponent(from.toISOString())}&end=${encodeURIComponent(to.toISOString())}&page=${page}&page-size=${size}`;
      const es: any[] = await this.get(`${ws}/user/${userId}/time-entries?${q}`);
      for (const e of es) {
        const start = new Date(e.timeInterval.start);
        const end = e.timeInterval.end ? new Date(e.timeInterval.end) : now;
        const name = e.projectId ? projects.get(e.projectId) ?? "(unknown project)" : "(no project)";
        out.push({ start, end, code: codeOf(name), label: name, source: "Clockify" });
      }
      if (es.length < size) break;
    }
    return out;
  }
}
