/* Shared pieces used by all three tabs: data, settings, sync, helpers. */
const App = window.App = { tabs: {}, data: { catalog: { items: [] }, effects: [], perks: [], prices: { items: [] } } };

// ---------- helpers ----------
App.$ = id => document.getElementById(id);
App.esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
App.icon = k => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICONS[k] || ICONS.misc}</svg>`;
App.fmt = n => n == null ? "–" : Number(n).toLocaleString();
App.ago = t => { const d = Math.floor((Date.now() / 1000 - t) / 86400); return d <= 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`; };
App.norm = s => String(s || "").toLowerCase().replace(/[^a-z0-9★ ]+/g, " ");
App.uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
App.personId = name => String(name || "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 60);
App.wiki = name => `https://fallout.fandom.com/wiki/Special:Search?search=${encodeURIComponent(name + " (Fallout 76)")}&go=Go`;
App.wikiExact = title => `https://fallout.fandom.com/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;
App.MAP_URL = "https://ghoul-earth.com/";
App.PLANNER_URL = "https://nukesdragons.com/fallout-76/character";
App.CATS = [
  ["weapon", "Weapons"], ["armor", "Armor"], ["power_armor", "Power armor"], ["legendary_mod", "Legendary mods"],
  ["weapon_mod", "Weapon mods"], ["armor_mod", "Armor mods"], ["pa_mod", "PA mods"], ["plan", "Plans"],
  ["recipe", "Recipes"], ["apparel", "Apparel"], ["serum", "Serums"], ["chem", "Chems"], ["food_drink", "Food & drink"],
  ["fish", "Fish"], ["fishing", "Fishing gear"], ["bobblehead", "Bobbleheads"], ["magazine", "Magazines"],
  ["collectible", "Collectibles"], ["ammo", "Ammo"], ["junk_flux", "Junk & flux"], ["consumable", "Other aid"], ["misc", "Misc"],
];
App.CAT_LABEL = Object.fromEntries(App.CATS);
App.SPECIAL = ["S", "P", "E", "C", "I", "A", "L"];
App.SPECIAL_NAME = { S: "Strength", P: "Perception", E: "Endurance", C: "Charisma", I: "Intelligence", A: "Agility", L: "Luck" };

// ---------- market lookups used by builds and checklist ----------
App.priceItemsByName = new Map();
App.indexPrices = () => {
  App.priceItemsByName = new Map();
  for (const it of App.data.prices.items) {
    const k = it.item.toLowerCase();
    if (!App.priceItemsByName.has(k)) App.priceItemsByName.set(k, []);
    App.priceItemsByName.get(k).push(it);
  }
};
/** Best market match for an item, optionally with legendary effects. */
App.findPrice = (name, effects = []) => {
  const list = App.priceItemsByName.get(String(name || "").toLowerCase()) || [];
  const want = effects.filter(Boolean);
  if (!list.length) return null;
  if (want.length) {
    const same = it => it.effects.length === want.length && want.every(e => it.effects.includes(e));
    return list.find(same) || null;
  }
  return list.find(it => !it.effects.length) || list[0];
};
App.priceText = it => {
  if (!it) return "";
  const order = [["selling_caps", "caps"], ["selling_leaders", "leaders"], ["buying_caps", "caps offered"], ["buying_leaders", "leaders offered"]];
  const hit = order.find(([k]) => it.prices[k]);
  if (!hit) return "item trades only";
  const p = it.prices[hit[0]];
  const age = p.window === "older" ? `, last seen ${App.ago(p.last_seen)}` : "";
  return `~${App.fmt(p.median)} ${hit[1]} (${p.count} post${p.count === 1 ? "" : "s"}${age})`;
};
App.priceTag = (name, effects) => {
  const it = App.findPrice(name, effects);
  if (!it) return "";
  const old = Object.values(it.prices).some(p => p.window === "older") && !Object.values(it.prices).some(p => p.window === "30d");
  return `<span class="tag ${old ? "old" : "sell"}">${App.esc(App.priceText(it))}</span>`;
};

// ---------- game changes (patch notes and game-file updates) ----------
const cnorm = s => String(s || "").toLowerCase().replace(/ serum$/, "").replace(/[^a-z0-9]+/g, " ").trim();
App.indexChanges = () => {
  const d = App.data.changes;
  App.patchById = new Map(d.patches.map(p => [p.id, p]));
  App.changeIndex = new Map();
  for (const c of d.changes) {
    const k = cnorm(c.name);
    if (!App.changeIndex.has(k)) App.changeIndex.set(k, []);
    App.changeIndex.get(k).push(c);
  }
  App.changeKeys = [...App.changeIndex.keys()];
};
/** Changes that touch any of these names. prefix: also match longer names that start with one (armor sets). */
App.changesFor = (names, prefix = false) => {
  const out = new Map();
  for (const n of names.filter(Boolean)) {
    const k = cnorm(n);
    (App.changeIndex.get(k) || []).forEach(c => out.set(c.id, c));
    if (prefix) App.changeKeys.filter(x => x.startsWith(k + " ")).forEach(x => App.changeIndex.get(x).forEach(c => out.set(c.id, c)));
  }
  return [...out.values()].sort((a, b) => (App.patchDate(b) || "").localeCompare(App.patchDate(a) || "") || b.found - a.found);
};
App.patchDate = c => (App.patchById.get(c.patch_id) || {}).date || "";
App.DIRECTION_LABEL = { buff: "Buffed", nerf: "Nerfed", fix: "Fixed", change: "Changed", added: "Added", removed: "Removed" };
App.changeLine = (c, withName = false, showSource = true) => {
  const p = App.patchById.get(c.patch_id) || {};
  return `<div class="chg ${c.direction}"><span class="chg-tag">${App.DIRECTION_LABEL[c.direction] || "Changed"}</span>
    ${withName ? `<strong>${App.esc(c.name)}:</strong> ` : ""}${App.esc(c.summary)}
    ${showSource ? `<span class="small">${p.url ? `<a href="${App.esc(p.url)}" target="_blank" rel="noopener">${App.esc(p.title || "Source")}</a>` : App.esc(p.title || "")}${p.date ? `, ${App.esc(p.date)}` : ""}</span>` : ""}</div>`;
};

// ---------- settings ----------
const SETTINGS_KEY = "fo76.settings";
App.settings = (() => { try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch { return {}; } })();
App.saveSettings = () => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(App.settings)); } catch {} };
App.me = () => App.personId(App.settings.person) || "me";
App.meLabel = () => App.settings.person || "Me";

// ---------- store: server sync or this-device-only ----------
/*
 * Data model (per person):
 *   builds: { id: { id, data, version, deleted } }   whole build, versioned
 *   marks:  { kind: { key: { value, updated } } }     one entry per tick
 *     kind "inv"  = inventory (items you own, shared by all your builds)
 *     kind "ck"   = checklist and challenge ticks
 *     kind "task" = your own tasks
 * Every change goes into an outbox saved on the device first, then to the server.
 * Nothing leaves the outbox until the server confirms it.
 */
const LOCAL_KEY = "fo76.v2";
const clone = o => o == null ? o : JSON.parse(JSON.stringify(o));
const Store = App.store = {
  mode: "local", online: false, builds: {}, marks: {}, outbox: [], lastRev: 0, lastError: "", flushing: false,

  hasServer() { return !!(App.settings.server && App.settings.key && App.settings.person); },
  key() { return `${LOCAL_KEY}.${App.me()}`; },

  async api(method, path, body) {
    const r = await fetch(App.settings.server.replace(/\/+$/, "") + path, {
      method, headers: { "Content-Type": "application/json", "X-Group-Key": App.settings.key },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await r.json().catch(() => null);
    if (!r.ok) { const e = new Error((data && data.error) || `Server error ${r.status}`); e.status = r.status; e.data = data; throw e; }
    return data;
  },

  loadLocal() {
    try {
      const d = JSON.parse(localStorage.getItem(this.key())) || {};
      this.builds = d.builds || {}; this.marks = d.marks || {}; this.outbox = d.outbox || []; this.lastRev = d.lastRev || 0;
    } catch {}
  },
  saveLocal() {
    try { localStorage.setItem(this.key(), JSON.stringify({ builds: this.builds, marks: this.marks, outbox: this.outbox, lastRev: this.lastRev })); }
    catch (e) { this.lastError = "This device is out of storage space."; }
  },

  async init() {
    this.loadLocal();
    if (!this.hasServer()) { this.mode = "local"; return; }
    this.mode = "server";
    await this.flush();
    await this.pull();
    setInterval(() => { if (document.visibilityState === "visible") this.sync(); }, 20000);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") this.sync(); });
    window.addEventListener("online", () => this.sync());
  },
  async sync() { await this.flush(); await this.pull(); },

  // ---- reading ----
  myBuilds() { return Object.values(this.builds).filter(b => !b.deleted).map(b => b.data); },
  build(id) { const b = this.builds[id]; return b && !b.deleted ? b.data : null; },
  getMark(kind, key) { const m = this.marks[kind] && this.marks[kind][key]; return m ? m.value : null; },
  marksOf(kind) { return Object.entries(this.marks[kind] || {}).filter(([, m]) => m.value != null).map(([key, m]) => ({ key, value: m.value, updated: m.updated })); },
  isChecked(key) { return !!this.getMark("ck", key); },

  // ---- writing ----
  setMark(kind, key, value) {
    const updated = Date.now();
    (this.marks[kind] ||= {})[key] = { value, updated };
    this.outbox.push({ t: "mark", kind, key, value, updated });
    this.saveLocal();
    this.scheduleFlush();
  },
  setCheck(key, on) { this.setMark("ck", key, on ? 1 : null); },

  saveBuild(data) {
    data.updated = Date.now();
    const cur = this.builds[data.id] || { id: data.id, version: 0, base: null };
    // Remember what the server last had, so a conflicting save can be merged field by field.
    // Outbox entries hold their own copies, so later edits can't change what's already queued.
    const pending = this.outbox.find(o => o.t === "build" && o.id === data.id);
    if (pending) { pending.data = clone(data); pending.del = false; }
    else this.outbox.push({ t: "build", id: data.id, data: clone(data), base_version: cur.version, base: clone(cur.serverData) || null });
    this.builds[data.id] = { ...cur, data, deleted: false };
    this.saveLocal();
    this.scheduleFlush();
  },
  deleteBuild(id) {
    const cur = this.builds[id]; if (!cur) return;
    cur.deleted = true;
    this.outbox = this.outbox.filter(o => !(o.t === "build" && o.id === id));
    this.outbox.push({ t: "build", id, del: true, base_version: cur.version });
    this.saveLocal();
    this.scheduleFlush();
  },

  scheduleFlush() {
    App.updateSyncBadge();
    if (this.mode !== "server") { this.outbox = []; this.saveLocal(); return; }
    clearTimeout(this._t);
    this._t = setTimeout(() => this.flush(), 600);
  },

  /** Send everything waiting in the outbox. Stops (and keeps the rest) on network errors. */
  async flush() {
    if (this.mode !== "server" || this.flushing || !this.outbox.length) return;
    this.flushing = true;
    try {
      while (this.outbox.length) {
        const marks = this.outbox.filter(o => o.t === "mark");
        if (marks.length) {
          const send = marks.slice(0, 400);
          await this.api("PUT", "/api/marks", { person: App.me(), marks: send.map(({ kind, key, value, updated }) => ({ kind, key, value, updated })) });
          this.outbox = this.outbox.filter(o => !send.includes(o));
          this.saveLocal();
          continue;
        }
        const op = this.outbox[0];
        const done = await this.sendBuild(op);
        if (done) this.outbox = this.outbox.filter(o => o !== op);
        this.saveLocal();
      }
      this.online = true; this.lastError = "";
    } catch (e) {
      this.online = false; this.lastError = e.message;
    } finally {
      this.flushing = false;
      App.updateSyncBadge();
    }
  },

  /** Returns true when the op is fully saved; false if a newer edit arrived mid-save and needs another round. */
  async sendBuild(op) {
    const method = op.del ? "DELETE" : "PUT";
    const sent = op.data;
    try {
      const r = await this.api(method, `/api/builds/${op.id}`, { person: App.me(), base_version: op.base_version, data: sent });
      const b = this.builds[op.id] || { id: op.id };
      b.version = r.version; b.serverData = op.del ? null : clone(sent);
      this.builds[op.id] = b;
      if (!op.del && op.data !== sent) { op.base_version = r.version; op.base = b.serverData; return false; }
      return true;
    } catch (e) {
      if (e.status !== 409 || !e.data || !e.data.current) throw e;
      // Someone (you, on another device) saved this build first. Keep their changes and
      // re-apply only the parts you changed here, then try again.
      const cur = e.data.current;
      if (op.del) { op.base_version = cur.version; return this.sendBuild(op); }
      const merged = mergeBuild(op.base, op.data, cur.data);
      op.base = clone(cur.data); op.base_version = cur.version; op.data = merged;
      this.builds[op.id] = { id: op.id, data: clone(merged), version: cur.version, serverData: clone(cur.data), deleted: false };
      App.refresh("merge");
      return this.sendBuild(op);
    }
  },

  /** Get what changed on the server since last time (from your other devices). */
  async pull() {
    if (this.mode !== "server") return;
    try {
      const r = await this.api("GET", `/api/sync?person=${encodeURIComponent(App.me())}&since=${this.lastRev}`);
      let changed = false;
      const waiting = new Set(this.outbox.filter(o => o.t === "build").map(o => o.id));
      for (const b of r.builds) {
        if (waiting.has(b.id)) continue; // our unsaved edit goes first, then merges on conflict
        const cur = this.builds[b.id];
        if (!cur || b.version > (cur.version || 0)) {
          this.builds[b.id] = { id: b.id, data: b.data, version: b.version, serverData: clone(b.data), deleted: b.deleted };
          changed = true;
        }
      }
      for (const m of r.marks) {
        const local = this.marks[m.kind] && this.marks[m.kind][m.key];
        if (!local || m.updated > local.updated) { (this.marks[m.kind] ||= {})[m.key] = { value: m.value, updated: m.updated }; changed = true; }
      }
      this.lastRev = r.now;
      this.online = true; this.lastError = "";
      this.saveLocal();
      if (changed) App.refresh("remote");
    } catch (e) {
      this.online = false; this.lastError = e.message;
    }
    App.updateSyncBadge();
  },
};

/** Three-way merge by top-level field: fields changed locally win, everything else comes from the server. */
function mergeBuild(base, mine, theirs) {
  if (!base) return clone({ ...theirs, ...mine });
  const out = clone(theirs);
  for (const k of Object.keys(mine)) {
    if (JSON.stringify(mine[k]) !== JSON.stringify(base[k])) out[k] = clone(mine[k]);
  }
  return out;
}
App.mergeBuild = mergeBuild;

App.updateSyncBadge = () => {
  const el = App.$("sync"); if (!el) return;
  let icon = "cloud-off", text = "Not synced";
  if (Store.mode === "server") {
    if (Store.online) { icon = "cloud"; text = Store.outbox.length ? "Saving…" : "Synced"; }
    else { icon = "cloud-off"; text = Store.outbox.length ? `Offline, ${Store.outbox.length} waiting` : "Offline"; }
  }
  el.innerHTML = `${App.icon(icon)} ${text}`;
  el.title = Store.lastError || "Sync settings";
};

// ---------- tabs ----------
App.current = "builds";
App.show = (name, push = true) => {
  if (!App.tabs[name]) name = "builds";
  App.current = name;
  document.querySelectorAll("[data-tab]").forEach(b => b.setAttribute("aria-selected", b.dataset.tab === name));
  document.querySelectorAll("section[data-panel]").forEach(s => s.hidden = s.dataset.panel !== name);
  if (push) history.replaceState(null, "", "#" + name);
  App.tabs[name].render();
};
App.refresh = reason => { const t = App.tabs[App.current]; if (t) (t.refresh || t.render)(reason); };

// ---------- settings dialog ----------
App.openSettings = () => {
  const d = App.$("settings");
  App.$("set-server").value = App.settings.server || "";
  App.$("set-key").value = App.settings.key || "";
  App.$("set-person").value = App.settings.person || "";
  App.$("set-status").textContent = Store.mode === "server"
    ? (Store.online ? "Connected." : `Not connected: ${Store.lastError || "unknown error"}`)
    : "Not connected. Builds and checklists are saved on this device only.";
  if (Store.outbox.length) App.$("set-status").textContent += ` ${Store.outbox.length} change(s) waiting to upload; they're kept on this device until then.`;
  d.showModal();
};
App.initSettings = () => {
  App.$("sync").onclick = App.openSettings;
  App.$("set-cancel").onclick = () => App.$("settings").close();
  App.$("set-save").onclick = async () => {
    App.settings.server = App.$("set-server").value.trim();
    App.settings.key = App.$("set-key").value.trim();
    App.settings.person = App.$("set-person").value.trim();
    App.saveSettings();
    App.$("set-status").textContent = "Checking…";
    if (Store.hasServer()) {
      try { await Store.api("GET", "/api/ping"); App.$("set-status").textContent = "Connected. Reloading…"; }
      catch (e) { App.$("set-status").textContent = `Couldn't connect: ${e.message}`; return; }
    }
    location.reload();
  };
};

// ---------- boot ----------
App.boot = async (inline) => {
  const get = f => inline ? Promise.resolve(inline[f] || null)
    : fetch("data/" + f, { cache: "no-store" }).then(r => r.ok ? r.json() : null).catch(() => null);
  const [prices, catalog, effects, perks, challenges, changes] = await Promise.all(["prices.json", "catalog.json", "effects.json", "perks.json", "challenges.json", "changes.json"].map(get));
  App.data.challenges = challenges;
  App.data.changes = changes || { patches: [], changes: [] };
  App.indexChanges();
  if (prices) App.data.prices = prices;
  if (catalog) App.data.catalog = catalog;
  if (effects) App.data.effects = effects.effects;
  if (perks) App.data.perks = perks.perks;
  App.catalogById = new Map(App.data.catalog.items.map(i => [i.id, i]));
  App.catalogByName = new Map(App.data.catalog.items.map(i => [i.name.toLowerCase(), i]));
  App.indexPrices();

  App.initSettings();
  document.querySelectorAll("[data-tab]").forEach(b => b.onclick = () => App.show(b.dataset.tab));
  await Store.init();
  App.updateSyncBadge();
  App.show((location.hash || "#builds").slice(1), false);
};
