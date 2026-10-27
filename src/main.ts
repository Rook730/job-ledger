import { App, Notice, Plugin, PluginSettingTab, Setting, TFile, normalizePath, requestUrl } from "obsidian";
import { Clockify, Http } from "./clockify.ts";
import { dedupe, parseIcs } from "./ics.ts";
import { weekReport } from "./metrics.ts";
import { DEFAULT_SETTINGS, Interval, Settings, addDays, weekStart, ymdDots } from "./model.ts";
import { render } from "./render.ts";

const http: Http = async (url, init) => {
  const r = await requestUrl({ url, method: init.method ?? "GET", headers: init.headers, body: init.body, throw: false });
  let json: any = null;
  try { json = r.json; } catch { /* not JSON */ }
  return { status: r.status, json, text: r.text };
};

const icsUrl = (u: string) => u.trim().replace(/^webcal:\/\//i, "https://");

export default class JobLedger extends Plugin {
  settings!: Settings;

  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.addSettingTab(new LedgerSettings(this.app, this));

    this.addCommand({ id: "generate-last-week", name: "Generate last week", callback: () => this.run(addDays(new Date(), -7)) });
    this.addCommand({ id: "generate-this-week", name: "Generate this week (to date)", callback: () => this.run(new Date()) });
    this.addCommand({ id: "test-connections", name: "Test connections", callback: () => this.test() });

    this.app.workspace.onLayoutReady(() => { if (this.settings.autoRun) void this.autoRun(); });
  }

  async saveSettings() { await this.saveData(this.settings); }

  pathFor(monday: Date): string {
    return normalizePath(`${this.settings.folder}/Job Ledger ${ymdDots(addDays(monday, 6))}.md`);
  }

  /** Startup: make sure last week's note exists and is final. */
  private async autoRun() {
    const last = weekStart(addDays(new Date(), -7));
    const f = this.app.vault.getAbstractFileByPath(this.pathFor(last));
    const complete = f instanceof TFile && this.app.metadataCache.getFileCache(f)?.frontmatter?.complete === true;
    if (!complete) await this.run(last, true);
  }

  private async run(anyDay: Date, quiet = false) {
    try {
      const f = await this.generateWeek(anyDay);
      if (!quiet) new Notice(`Job Ledger: wrote ${f.basename}`);
    } catch (e) {
      new Notice(`Job Ledger failed: ${(e as Error).message}`, 10000);
    }
  }

  async fetchCalendars(from: Date, to: Date, issues: string[]): Promise<Interval[]> {
    const all: Interval[] = [];
    for (const c of this.settings.calendars.filter(c => c.enabled && c.url.trim())) {
      try {
        const r = await requestUrl({ url: icsUrl(c.url), throw: false });
        if (r.status >= 400) throw new Error(`HTTP ${r.status}`);
        if (!r.text.includes("BEGIN:VCALENDAR")) throw new Error("response is not an ICS calendar (link expired or revoked?)");
        all.push(...parseIcs(r.text, c.name, from, to));
      } catch (e) {
        issues.push(`Calendar "${c.name}" failed: ${(e as Error).message}. Plan figures exclude it.`);
      }
    }
    return dedupe(all);
  }

  /** Public: build and write the ledger note for the week containing anyDay. Usable from Templater. */
  async generateWeek(anyDay: Date): Promise<TFile> {
    const st = this.settings;
    const monday = weekStart(anyDay);
    const now = new Date();
    const issues: string[] = [];

    let entries: Interval[] = [];
    if (!st.clockifyKey) issues.push("Clockify API key not set. Actuals are empty.");
    else {
      try { entries = await new Clockify(http, st.clockifyKey, st.workspaceId).entries(monday, addDays(monday, 7), now); }
      catch (e) { issues.push(`Clockify failed: ${(e as Error).message}. Actuals are empty.`); }
    }
    if (!st.calendars.some(c => c.enabled && c.url.trim())) issues.push("No calendars configured. Plan figures are empty.");
    const events = await this.fetchCalendars(monday, addDays(monday, 14), issues);

    const report = weekReport(monday, now, entries, events, events, st, issues);
    const text = render(report, st, now);

    const path = this.pathFor(monday);
    const folder = normalizePath(st.folder);
    if (!this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder);
    const existing = this.app.vault.getAbstractFileByPath(path);
    const file = existing instanceof TFile ? existing : await this.app.vault.create(path, text);
    if (existing instanceof TFile) await this.app.vault.modify(existing, text);
    if (issues.length) new Notice(`Job Ledger: ${issues.length} data issue(s). See "${file.basename}".`, 8000);
    return file;
  }

  async test() {
    const lines: string[] = [];
    if (!this.settings.clockifyKey) lines.push("Clockify: no API key");
    else {
      try {
        const me = await new Clockify(http, this.settings.clockifyKey, this.settings.workspaceId).whoami();
        lines.push(`Clockify: OK (${me.name}, workspace ${me.workspaceId})`);
      } catch (e) { lines.push(`Clockify: ${(e as Error).message}`); }
    }
    const from = weekStart(new Date()), to = addDays(from, 14);
    for (const c of this.settings.calendars.filter(c => c.enabled)) {
      const issues: string[] = [];
      const saved = this.settings.calendars;
      this.settings.calendars = [c];
      const ev = await this.fetchCalendars(from, to, issues);
      this.settings.calendars = saved;
      lines.push(issues.length ? `${c.name}: ${issues[0]}` : `${c.name}: OK (${ev.length} timed events this week and next)`);
    }
    new Notice(lines.join("\n"), 15000);
  }
}

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

class LedgerSettings extends PluginSettingTab {
  constructor(app: App, private plugin: JobLedger) { super(app, plugin); }

  display(): void {
    const { containerEl } = this;
    const st = this.plugin.settings;
    const save = () => this.plugin.saveSettings();
    containerEl.empty();

    new Setting(containerEl).setName("Clockify").setHeading();
    new Setting(containerEl).setName("API key").setDesc("Clockify > Profile settings > API.")
      .addText(t => { t.inputEl.type = "password"; t.setValue(st.clockifyKey).onChange(v => { st.clockifyKey = v.trim(); void save(); }); });
    new Setting(containerEl).setName("Workspace ID").setDesc("Leave blank to use your active workspace.")
      .addText(t => t.setValue(st.workspaceId).onChange(v => { st.workspaceId = v.trim(); void save(); }));

    new Setting(containerEl).setName("Calendars (ICS links)").setHeading()
      .setDesc("Proton: Settings > Calendars > Share with anyone. Google: Settings and sharing > Secret address in iCal format. Treat these links like passwords.");
    st.calendars.forEach((c, i) => {
      new Setting(containerEl)
        .addText(t => t.setPlaceholder("Name").setValue(c.name).onChange(v => { c.name = v; void save(); }))
        .addText(t => { t.inputEl.type = "password"; t.inputEl.style.width = "18em"; t.setPlaceholder("https://...").setValue(c.url).onChange(v => { c.url = v.trim(); void save(); }); })
        .addToggle(t => t.setTooltip("Enabled").setValue(c.enabled).onChange(v => { c.enabled = v; void save(); }))
        .addExtraButton(b => b.setIcon("trash").setTooltip("Remove").onClick(async () => { st.calendars.splice(i, 1); await save(); this.display(); }));
    });
    new Setting(containerEl).addButton(b => b.setButtonText("Add calendar").onClick(async () => {
      st.calendars.push({ name: `Calendar ${st.calendars.length + 1}`, url: "", enabled: true }); await save(); this.display();
    }));

    new Setting(containerEl).setName("Availability").setHeading();
    const days = new Setting(containerEl).setName("Working days");
    for (const d of [1, 2, 3, 4, 5, 6, 0]) {
      days.addToggle(t => t.setTooltip(DOW[d]).setValue(st.workdays.includes(d)).onChange(v => {
        st.workdays = v ? [...new Set([...st.workdays, d])] : st.workdays.filter(x => x !== d); void save();
      }));
    }
    days.setDesc("Mon, Tue, Wed, Thu, Fri, Sat, Sun");
    const hhmm = /^\d{2}:\d{2}$/;
    new Setting(containerEl).setName("Day start").addText(t => t.setValue(st.dayStart).onChange(v => { if (hhmm.test(v)) { st.dayStart = v; void save(); } }));
    new Setting(containerEl).setName("Day end").addText(t => t.setValue(st.dayEnd).onChange(v => { if (hhmm.test(v)) { st.dayEnd = v; void save(); } }));

    new Setting(containerEl).setName("Report").setHeading();
    new Setting(containerEl).setName("Folder").addText(t => t.setValue(st.folder).onChange(v => { st.folder = v.trim() || "Job Ledger"; void save(); }));
    new Setting(containerEl).setName("Deep block (min)").setDesc("Blocks this long or longer count as deep work.")
      .addText(t => t.setValue(String(st.deepMinutes)).onChange(v => { const n = parseInt(v); if (n > 0) { st.deepMinutes = n; void save(); } }));
    new Setting(containerEl).setName("Merge gap (min)").setDesc("Same-code entries closer than this are one block.")
      .addText(t => t.setValue(String(st.mergeGapMinutes)).onChange(v => { const n = parseInt(v); if (n >= 0) { st.mergeGapMinutes = n; void save(); } }));
    new Setting(containerEl).setName("Generate last week on startup").setDesc("Skipped if last week's note is already final.")
      .addToggle(t => t.setValue(st.autoRun).onChange(v => { st.autoRun = v; void save(); }));
    new Setting(containerEl).addButton(b => b.setButtonText("Test connections").setCta().onClick(() => this.plugin.test()));
  }
}
