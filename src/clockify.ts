import { Interval, codeOf } from "./model.ts";

export type Http = (url: string, init: { method?: string; headers?: Record<string, string>; body?: string }) =>
  Promise<{ status: number; json: any; text: string }>;

const API = "https://api.clockify.me/api/v1";

export class Clockify {
  constructor(private http: Http, private key: string, private workspaceOverride = "") {}

  private async call(method: string, path: string, body?: unknown): Promise<any> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const headers: Record<string, string> = { "X-Api-Key": this.key };
      if (body !== undefined) headers["Content-Type"] = "application/json";
      const r = await this.http(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      if (r.status === 429) { await new Promise(res => setTimeout(res, 2000 * (attempt + 1))); continue; }
      if (r.status === 401 || r.status === 403) throw new Error("Clockify rejected the API key");
      if (r.status >= 400) throw new Error(`Clockify ${r.status} on ${method} ${path.split("?")[0]}: ${r.text.slice(0, 200)}`);
      return r.json;
    }
    throw new Error("Clockify rate limit (429) persisted after retries");
  }
  private get(path: string) { return this.call("GET", path); }
  private post(path: string, body: unknown) { return this.call("POST", path, body); }

  private async pages(path: string, size = 200): Promise<any[]> {
    const out: any[] = [];
    const sep = path.includes("?") ? "&" : "?";
    for (let page = 1; page < 50; page++) {
      const xs: any[] = await this.get(`${path}${sep}page=${page}&page-size=${size}`);
      out.push(...xs);
      if (xs.length < size) break;
    }
    return out;
  }

  async clients(ws: string): Promise<{ id: string; name: string; archived: boolean }[]> {
    return (await this.pages(`/workspaces/${ws}/clients`)).map(c => ({ id: c.id, name: c.name, archived: !!c.archived }));
  }
  async tags(ws: string): Promise<{ id: string; name: string; archived: boolean }[]> {
    return (await this.pages(`/workspaces/${ws}/tags`)).map(t => ({ id: t.id, name: t.name, archived: !!t.archived }));
  }
  async createClient(ws: string, name: string): Promise<string> {
    return (await this.post(`/workspaces/${ws}/clients`, { name })).id;
  }
  async createTag(ws: string, name: string): Promise<string> {
    return (await this.post(`/workspaces/${ws}/tags`, { name })).id;
  }
  async createProject(ws: string, p: { name: string; clientId?: string; billable: boolean }): Promise<string> {
    return (await this.post(`/workspaces/${ws}/projects`, { name: p.name, clientId: p.clientId, billable: p.billable, isPublic: false })).id;
  }

  async whoami(): Promise<{ userId: string; workspaceId: string; name: string }> {
    const u = await this.get("/user");
    return { userId: u.id, workspaceId: this.workspaceOverride || u.activeWorkspace || u.defaultWorkspace, name: u.name };
  }

  /** All projects in the workspace, active and archived. */
  async projects(workspaceId: string): Promise<{ id: string; name: string; archived: boolean; clientName: string }[]> {
    const out: { id: string; name: string; archived: boolean; clientName: string }[] = [];
    for (const archived of [false, true]) {
      for (const p of await this.pages(`/workspaces/${workspaceId}/projects?archived=${archived}`))
        out.push({ id: p.id, name: p.name, archived, clientName: p.clientName ?? "" });
    }
    return out;
  }

  /** Time entries starting in [from, to), as intervals. Running timers end at `now`. */
  async entries(
    from: Date, to: Date, now: Date,
    pre?: { userId: string; workspaceId: string; projects: Map<string, string>; tags?: Map<string, string> },
  ): Promise<Interval[]> {
    const { userId, workspaceId } = pre ?? await this.whoami();
    const ws = `/workspaces/${workspaceId}`;
    const projects = pre?.projects ?? new Map((await this.projects(workspaceId)).map(p => [p.id, p.name] as const));
    const tags = pre?.tags ?? new Map((await this.tags(workspaceId)).map(t => [t.id, t.name] as const));

    const out: Interval[] = [];
    const size = 1000;
    for (let page = 1; page < 50; page++) {
      const q = `start=${encodeURIComponent(from.toISOString())}&end=${encodeURIComponent(to.toISOString())}&page=${page}&page-size=${size}`;
      const es: any[] = await this.get(`${ws}/user/${userId}/time-entries?${q}`);
      for (const e of es) {
        const start = new Date(e.timeInterval.start);
        const end = e.timeInterval.end ? new Date(e.timeInterval.end) : now;
        const name = e.projectId ? projects.get(e.projectId) ?? "(unknown project)" : "(no project)";
        const tagNames = ((e.tagIds ?? []) as string[]).map(id => tags.get(id) ?? "(unknown tag)");
        out.push({ start, end, code: codeOf(name), label: name, source: "Clockify", tags: tagNames });
      }
      if (es.length < size) break;
    }
    return out;
  }
}
