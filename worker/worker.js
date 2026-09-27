/**
 * FO76 companion server (Cloudflare Worker).
 *
 * Does two jobs the static GitHub page can't:
 *   1. Stores each person's builds, inventory, and ticks in a small database, synced across their devices.
 *   2. Reads build links (Nukes & Dragons, FalloutBuilds, Reddit, guides, YouTube descriptions)
 *      and turns them into a structured build with Claude. The API key stays here, never in the page.
 *
 * Setup (Cloudflare dashboard):
 *   - D1 database bound as  DB  (run schema.sql in its console once)
 *   - Secret  ANTHROPIC_API_KEY
 *   - Secret  GROUP_KEY        (the passphrase you and your friend type into the site once)
 *   - Variable ALLOWED_ORIGIN  (your site, e.g. https://yourname.github.io)
 *   - Optional variable MODEL (defaults below)
 */

const DEFAULT_MODEL = "claude-sonnet-5";
const MAX_PAGE_CHARS = 60000;
const PARSE_LIMIT_PER_HOUR = 30;

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    try {
      if (!authorized(request, env)) return json({ error: "Wrong or missing group key." }, 401, cors);
      const url = new URL(request.url);
      const parts = url.pathname.replace(/^\/+|\/+$/g, "").split("/"); // ["api", "builds", id]
      if (parts[0] !== "api") return json({ error: "Not found" }, 404, cors);
      const [, resource, id] = parts;

      if (resource === "ping") return json({ ok: true, now: Date.now() }, 200, cors);
      if (resource === "sync" && request.method === "GET") return handleSync(url, env, cors);
      if (resource === "marks" && request.method === "PUT") return handleMarks(request, env, cors);
      if (resource === "builds" && id && (request.method === "PUT" || request.method === "DELETE")) return handleBuild(request, env, safeId(id), cors);
      if (resource === "parse" && request.method === "POST") return handleParse(request, env, cors);
      return json({ error: "Not found" }, 404, cors);
    } catch (e) {
      const status = e.status || 500;
      return json({ error: e.message || "Server error" }, status, cors);
    }
  },
};

// ---------- helpers ----------

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = (env.ALLOWED_ORIGIN || "").split(",").map(s => s.trim()).filter(Boolean);
  const ok = !allowed.length || allowed.includes(origin);
  return {
    "Access-Control-Allow-Origin": ok ? origin || "*" : allowed[0],
    "Access-Control-Allow-Methods": "GET, PUT, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Group-Key",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function authorized(request, env) {
  if (request.method === "OPTIONS") return true;
  const key = request.headers.get("X-Group-Key") || "";
  return env.GROUP_KEY && key.length > 0 && key === env.GROUP_KEY;
}

function json(data, status, headers) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...headers, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function safeId(id) {
  const s = decodeURIComponent(id || "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 60);
  if (!s) throw Object.assign(new Error("Missing id"), { status: 400 });
  return s;
}

async function readBody(request, limit = 500000) {
  const text = await request.text();
  if (text.length > limit) throw new Error("Too large");
  return JSON.parse(text || "{}");
}

// ---------- storage ----------

const personOf = v => safeId(v || "");

/** Everything for one person that changed since `since` (server clock). */
async function handleSync(url, env, cors) {
  const person = personOf(url.searchParams.get("person"));
  const since = parseInt(url.searchParams.get("since") || "0", 10) || 0;
  const now = Date.now();
  const [builds, marks] = await Promise.all([
    env.DB.prepare("SELECT id, data, version, updated, deleted, rev FROM builds WHERE person = ? AND rev > ? ORDER BY rev").bind(person, since).all(),
    env.DB.prepare("SELECT kind, key, value, updated, rev FROM marks WHERE person = ? AND rev > ? ORDER BY rev LIMIT 5000").bind(person, since).all(),
  ]);
  const b = builds.results.map(r => ({ id: r.id, data: JSON.parse(r.data), version: r.version, updated: r.updated, deleted: !!r.deleted }));
  const m = marks.results.map(r => ({ kind: r.kind, key: r.key, value: r.value == null ? null : JSON.parse(r.value), updated: r.updated }));
  // If we hit the row cap, tell the client to ask again from the last row we sent.
  const next = marks.results.length === 5000 ? marks.results[marks.results.length - 1].rev : now;
  return json({ now: next, builds: b, marks: m }, 200, cors);
}

/** Save ticks. Each tick is its own row; newer edits win, older ones are ignored. */
async function handleMarks(request, env, cors) {
  const body = await readBody(request);
  const person = personOf(body.person);
  const list = Array.isArray(body.marks) ? body.marks.slice(0, 500) : [];
  const rev = Date.now();
  const stmt = env.DB.prepare(`INSERT INTO marks (person, kind, key, value, updated, rev) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (person, kind, key) DO UPDATE SET value = excluded.value, updated = excluded.updated, rev = excluded.rev
    WHERE excluded.updated >= marks.updated`);
  const batch = [];
  for (const m of list) {
    const kind = String(m.kind || "").slice(0, 20), key = String(m.key || "").slice(0, 300);
    if (!kind || !key) continue;
    const value = m.value == null ? null : JSON.stringify(m.value).slice(0, 20000);
    batch.push(stmt.bind(person, kind, key, value, parseInt(m.updated, 10) || rev, rev));
  }
  if (batch.length) await env.DB.batch(batch);
  return json({ ok: true, saved: batch.length, rev }, 200, cors);
}

/**
 * Save or delete a build. The client sends the version it last saw; if the build has
 * changed since (say, edited on another device), nothing is written and the current
 * copy comes back with status 409 so the client can merge.
 */
async function handleBuild(request, env, id, cors) {
  const body = await readBody(request);
  const person = personOf(body.person);
  const base = parseInt(body.base_version, 10) || 0;
  const rev = Date.now();
  const row = await env.DB.prepare("SELECT person, data, version, updated, deleted FROM builds WHERE id = ?").bind(id).first();

  if (row && row.person !== person) return json({ error: "That build belongs to someone else." }, 403, cors);
  if (row && row.version !== base) {
    return json({ error: "conflict", current: { id, data: JSON.parse(row.data), version: row.version, updated: row.updated, deleted: !!row.deleted } }, 409, cors);
  }
  const deleting = request.method === "DELETE";
  const data = deleting ? (row ? row.data : "{}") : JSON.stringify(body.data || {});
  if (data.length > 400000) return json({ error: "Build is too large." }, 413, cors);

  if (!row) {
    if (deleting) return json({ ok: true, version: 0 }, 200, cors);
    await env.DB.prepare("INSERT INTO builds (id, person, data, version, updated, rev, deleted) VALUES (?, ?, ?, 1, ?, ?, 0)")
      .bind(id, person, data, rev, rev).run();
    return json({ ok: true, version: 1, updated: rev }, 200, cors);
  }
  const res = await env.DB.prepare("UPDATE builds SET data = ?, version = version + 1, updated = ?, rev = ?, deleted = ? WHERE id = ? AND version = ?")
    .bind(data, rev, rev, deleting ? 1 : 0, id, base).run();
  if (!res.meta || res.meta.changes !== 1) {
    const cur = await env.DB.prepare("SELECT data, version, updated, deleted FROM builds WHERE id = ?").bind(id).first();
    return json({ error: "conflict", current: { id, data: JSON.parse(cur.data), version: cur.version, updated: cur.updated, deleted: !!cur.deleted } }, 409, cors);
  }
  return json({ ok: true, version: base + 1, updated: rev }, 200, cors);
}

// ---------- build parsing ----------

async function handleParse(request, env, cors) {
  await rateLimit(env);
  const body = await readBody(request, 300000);
  const refs = body.refs || {};
  let source = (body.text || "").slice(0, MAX_PAGE_CHARS);
  let sourceUrl = (body.url || "").trim();
  const notes = [];

  if (sourceUrl) {
    const fetched = await fetchSource(sourceUrl, notes);
    source = (fetched + "\n\n" + source).slice(0, MAX_PAGE_CHARS);
  }
  if (source.trim().length < 40) {
    return json({ error: "Couldn't read enough from that link. Paste the build text or the video's description instead.", notes }, 422, cors);
  }
  const build = await askClaude(env, source, refs);
  build.source_url = sourceUrl || null;
  build.parse_notes = notes;
  return json(build, 200, cors);
}

async function rateLimit(env) {
  const hour = Math.floor(Date.now() / 3600000);
  const row = await env.DB.prepare(`INSERT INTO ratelimit (hour, n) VALUES (?, 1)
    ON CONFLICT (hour) DO UPDATE SET n = n + 1 RETURNING n`).bind(hour).first();
  await env.DB.prepare("DELETE FROM ratelimit WHERE hour < ?").bind(hour - 48).run();
  if (row && row.n > PARSE_LIMIT_PER_HOUR) throw Object.assign(new Error("Too many build imports this hour. Try again later."), { status: 429 });
}

async function fetchPage(url) {
  const r = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; FO76CompanionBot/1.0; personal use)",
      "Accept": "text/html,application/json;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
    redirect: "follow",
  });
  if (!r.ok) throw new Error(`The site returned ${r.status}`);
  return await r.text();
}

async function fetchSource(url, notes) {
  let u;
  try { u = new URL(url); } catch { throw new Error("That doesn't look like a link."); }
  const host = u.hostname.replace(/^www\./, "");

  // YouTube: read the video description, then follow any build planner link in it.
  if (host === "youtube.com" || host === "m.youtube.com" || host === "youtu.be") {
    const html = await fetchPage(url);
    const m = html.match(/"shortDescription":"((?:[^"\\]|\\.)*)"/);
    const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1] || "";
    if (!m) { notes.push("Couldn't read the video description. Paste the description or transcript instead."); return title; }
    const desc = JSON.parse(`"${m[1]}"`);
    notes.push("Read the video description (videos themselves can't be watched).");
    const planner = desc.match(/https?:\/\/(?:www\.)?(?:nukesdragons\.com|falloutbuilds\.com)\/[^\s"')]+/);
    let extra = "";
    if (planner) {
      notes.push("Found a planner link in the description and read it too.");
      try { extra = pageToText(await fetchPage(planner[0])); } catch (e) { notes.push("The planner link failed to load."); }
    }
    return `Video: ${title}\n\nDescription:\n${desc}\n\n${extra}`;
  }

  // Reddit: the .json view has the post text without the page clutter.
  if (host.endsWith("reddit.com")) {
    try {
      const jsonUrl = url.replace(/\/?(\?.*)?$/, "/.json");
      const data = JSON.parse(await fetchPage(jsonUrl));
      const post = data?.[0]?.data?.children?.[0]?.data;
      if (post) return `${post.title}\n\n${post.selftext}`;
    } catch (e) {
      notes.push("Reddit blocked the request. Paste the post text instead if the result looks empty.");
    }
  }

  return pageToText(await fetchPage(url));
}

function pageToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h\d|\/tr)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim()
    .slice(0, MAX_PAGE_CHARS);
}

function buildPrompt(source, refs) {
  const list = (name, arr) => arr && arr.length ? `${name}: ${arr.join(", ")}` : "";
  return `You turn Fallout 76 build guides into structured data.

The source below may be a Nukes & Dragons or FalloutBuilds planner page (perk cards appear as rank number, card name, then "lvl" and a description, grouped under the SPECIAL letter and its point total), a Reddit post, a guide, or a YouTube description or transcript. Extract what the build actually uses. Do not invent items the source doesn't mention.

Use names exactly from these lists when a match exists:
${list("Perk cards", refs.perks)}
${list("Legendary perks", refs.legendaryPerks)}
${list("Mutations", refs.mutations)}
${list("Legendary effects", refs.effects)}
${list("Armor sets", refs.armorSets)}
${list("Power armor sets", refs.paSets)}

Return ONLY a JSON object, no other text:
{
  "name": "short build name (from the source, or describe it, e.g. 'Bloodied Commando')",
  "summary": "one or two plain sentences on how the build plays",
  "special": {"S":0,"P":0,"E":0,"C":0,"I":0,"A":0,"L":0},
  "perks": [{"name": "Tank Killer", "special": "P", "rank": 2}],
  "legendary_perks": [{"name": "Legendary Strength", "rank": 4}],
  "mutations": ["Marsupial"],
  "weapons": [{"name": "Handmade Rifle", "effects": ["Bloodied", "Rapid", "V.A.T.S. Optimized", ""], "notes": ""}],
  "armor": {"set": "Secret Service", "effects": ["Unyielding", "Agility", "Sentinel's", ""], "notes": ""},
  "power_armor": {"set": "", "notes": ""},
  "consumables": ["Berry Mentats"],
  "notes": "anything important that doesn't fit above"
}

Rules: special values are integers (0 if unknown). Perk rank is the card rank (1 if unknown). Weapon effects are in star order, blank string for empty slots. Use "" or [] for anything the source doesn't cover.

SOURCE:
${source}`;
}

async function askClaude(env, source, refs) {
  if (!env.ANTHROPIC_API_KEY) throw new Error("The server has no Anthropic API key set.");
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: env.MODEL || DEFAULT_MODEL,
      max_tokens: 4000,
      messages: [{ role: "user", content: buildPrompt(source, refs) }],
    }),
  });
  if (!r.ok) throw new Error(`Claude API error ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const data = await r.json();
  const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("");
  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  if (start < 0 || end < 0) throw new Error("Claude didn't return a build. Try pasting the text instead.");
  return JSON.parse(text.slice(start, end + 1));
}
