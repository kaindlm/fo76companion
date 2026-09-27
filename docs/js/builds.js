/* Builds tab: import a build from a link or text, then track it as a checklist. */
(() => {
  const { $, esc, icon, fmt } = App;
  const Store = App.store;
  let openId = null, refs = null, importBusy = false;

  // ---------- reference lists ----------
  function buildRefs() {
    const perks = App.data.perks.filter(p => p.special !== "Legendary");
    const bySpecial = {};
    for (const s of App.SPECIAL) bySpecial[s] = perks.filter(p => p.special === s).map(p => p.name).sort();
    const legendary = App.data.perks.filter(p => p.special === "Legendary").map(p => p.name).sort();
    const cat = App.data.catalog.items;
    const mutations = cat.filter(i => i.cat === "serum").map(i => i.name.replace(/ Serum$/, "")).sort();
    const weapons = cat.filter(i => i.cat === "weapon" && i.tradable).sort((a, b) => a.name.localeCompare(b.name));
    const consumables = cat.filter(i => ["chem", "food_drink", "consumable", "magazine", "bobblehead"].includes(i.cat)).map(i => i.name);
    const fx = kind => {
      const ok = kind === "weapon" ? ["Weapon", "Both"] : ["Armor", "Both", "Power armor"];
      return [1, 2, 3, 4].map(s => App.data.effects.filter(e => e.stars === s && e.applies.some(a => ok.includes(a))).map(e => e.name));
    };
    return {
      bySpecial, perkSpecial: Object.fromEntries(perks.map(p => [p.name.toLowerCase(), p.special])),
      legendary, mutations, weapons, consumables,
      weaponFx: fx("weapon"), armorFx: fx("armor"),
      armorSets: deriveSets("armor"), paSets: deriveSets("power_armor"),
    };
  }

  const SLOT_RE = / (Helmet|Helm|Chest Piece|Torso|Left Arm|Right Arm|Left Leg|Right Leg)$/;
  const SLOT_ORDER = ["Helmet", "Helm", "Chest Piece", "Torso", "Left Arm", "Right Arm", "Left Leg", "Right Leg"];
  function deriveSets(cat) {
    const sets = {};
    for (const i of App.data.catalog.items) {
      if (i.cat !== cat) continue;
      const m = i.name.match(SLOT_RE);
      if (!m) continue;
      const set = i.name.slice(0, m.index);
      (sets[set] ||= {})[m[1]] = i.name;
    }
    for (const k of Object.keys(sets)) if (Object.keys(sets[k]).length < 4) delete sets[k];
    return sets;
  }
  const pieces = (sets, set) => sets[set] ? SLOT_ORDER.filter(s => sets[set][s]).map(s => ({ slot: s, name: sets[set][s] })) : [];

  function planFor(itemName) {
    const tries = [`Plan: ${itemName}`, `Plan: ${itemName.replace(/ Helmet$/, " Helm")}`, `Recipe: ${itemName}`];
    return tries.find(t => App.catalogByName.has(t.toLowerCase())) || null;
  }

  // ---------- model ----------
  const matchName = (name, list) => {
    if (!name) return "";
    const hit = list.find(x => x.toLowerCase() === String(name).toLowerCase());
    return hit || String(name);
  };

  /** Turn whatever Claude returned into our build shape. */
  function normalize(raw) {
    const r = refs;
    const special = {};
    for (const s of App.SPECIAL) special[s] = Math.max(0, Math.min(15, parseInt((raw.special || {})[s], 10) || 0));
    const allPerks = Object.values(r.bySpecial).flat();
    const perks = (raw.perks || []).filter(p => p && p.name).map(p => {
      const name = matchName(p.name, allPerks);
      return { id: App.uid(), name, special: r.perkSpecial[name.toLowerCase()] || p.special || "S", rank: Math.max(1, Math.min(5, parseInt(p.rank, 10) || 1)) };
    });
    const weapons = (raw.weapons || []).filter(w => w && w.name).map(w => ({
      id: App.uid(),
      name: matchName(w.name, r.weapons.map(x => x.name)),
      effects: [0, 1, 2, 3].map(i => matchName((w.effects || [])[i] || "", r.weaponFx[i])),
      notes: w.notes || "",
    }));
    const armor = raw.armor || {};
    return {
      id: App.uid(),
      name: raw.name || "Imported build",
      summary: raw.summary || "",
      source_url: raw.source_url || "",
      owner: App.meLabel(),
      created: Date.now(),
      special, perks,
      legendary_perks: (raw.legendary_perks || []).filter(p => p && p.name).map(p => ({ id: App.uid(), name: matchName(p.name, r.legendary), rank: Math.max(1, Math.min(4, parseInt(p.rank, 10) || 1)) })),
      mutations: (raw.mutations || []).filter(Boolean).map(m => ({ id: App.uid(), name: matchName(String(m).replace(/ Serum$/i, ""), r.mutations) })),
      weapons,
      armor: { set: matchName(armor.set || "", Object.keys(r.armorSets)), effects: [0, 1, 2, 3].map(i => matchName((armor.effects || [])[i] || "", r.armorFx[i])), notes: armor.notes || "" },
      power_armor: { set: matchName((raw.power_armor || {}).set || "", Object.keys(r.paSets)), notes: (raw.power_armor || {}).notes || "" },
      consumables: (raw.consumables || []).filter(Boolean).map(c => ({ id: App.uid(), name: String(c) })),
      notes: raw.notes || "",
      parse_notes: raw.parse_notes || [],
    };
  }

  function blankBuild() {
    return normalize({ name: "New build", special: { S: 8, P: 8, E: 8, C: 8, I: 8, A: 8, L: 8 } });
  }

  /*
   * Ticks go to your personal inventory, keyed by what the item IS (name + rank or effects),
   * not by which build row it sits in. So a Bloodied/Rapid Handmade you tick in one build
   * shows as owned in every build, and swapping a row to something else never erases it.
   */
  const fxKey = fx => (fx || []).filter(Boolean).join("/");
  const INV = {
    perk: p => p.name && { key: `perk|${p.name}|${p.rank}`, label: `${p.name} (rank ${p.rank})`, type: "Perk cards" },
    lp: p => p.name && { key: `lp|${p.name}|${p.rank}`, label: `${p.name} (rank ${p.rank})`, type: "Legendary perks" },
    mut: m => m.name && { key: `mut|${m.name}`, label: m.name, type: "Mutations" },
    weap: w => w.name && { key: `weap|${w.name}|${fxKey(w.effects)}`, label: `${fxKey(w.effects) ? fxKey(w.effects) + " " : ""}${w.name}`, type: "Weapons" },
    armor: (name, fx) => ({ key: `armor|${name}|${fxKey(fx)}`, label: `${fxKey(fx) ? fxKey(fx) + " " : ""}${name}`, type: "Armor" }),
    pa: name => ({ key: `pa|${name}`, label: name, type: "Power armor" }),
    cons: c => c.name && { key: `cons|${c.name}`, label: c.name, type: "Consumables" },
  };
  function checkItems(b) {
    const out = [];
    b.perks.forEach(p => out.push(INV.perk(p)));
    b.legendary_perks.forEach(p => out.push(INV.lp(p)));
    b.mutations.forEach(m => out.push(INV.mut(m)));
    b.weapons.forEach(w => out.push(INV.weap(w)));
    pieces(refs.armorSets, b.armor.set).forEach(p => out.push(INV.armor(p.name, b.armor.effects)));
    pieces(refs.paSets, b.power_armor.set).forEach(p => out.push(INV.pa(p.name)));
    b.consumables.forEach(c => out.push(INV.cons(c)));
    return out.filter(Boolean);
  }
  const owned = key => !!Store.getMark("inv", key);
  function progressFor(b) {
    const items = checkItems(b);
    return { done: items.filter(i => owned(i.key)).length, total: items.length };
  }

  // ---------- game changes that touch this build ----------
  const ALERT_WINDOW = 180 * 86400; // only pop up changes found in the last ~6 months
  const chgs = (names, prefix = false, max = 3) => {
    const list = App.changesFor(names, prefix).slice(0, max);
    return list.length ? `<div class="chgs">${list.map(c => App.changeLine(c)).join("")}</div>` : "";
  };
  function buildChanges(b) {
    const names = [
      ...b.perks.map(p => p.name), ...b.legendary_perks.map(p => p.name), ...b.mutations.map(m => m.name),
      ...b.weapons.flatMap(w => [w.name, ...w.effects]), ...b.armor.effects, ...b.consumables.map(c => c.name),
      ...pieces(refs.armorSets, b.armor.set).map(p => p.name), ...pieces(refs.paSets, b.power_armor.set).map(p => p.name),
    ];
    const sets = [b.armor.set, b.power_armor.set];
    const all = new Map();
    [...App.changesFor(names), ...App.changesFor(sets, true)].forEach(c => all.set(c.id, c));
    return [...all.values()];
  }
  function unseenChanges(b) {
    const ack = Store.getMark("ack", b.id) || 0;
    const cutoff = Date.now() / 1000 - ALERT_WINDOW;
    return buildChanges(b).filter(c => c.found > ack && c.found > cutoff);
  }
  let popupShownFor = null;
  function maybePopup(b) {
    if (popupShownFor === b.id) return;
    const list = unseenChanges(b);
    if (!list.length) return;
    popupShownFor = b.id;
    $("chg-list").innerHTML = list.map(c => App.changeLine(c, true)).join("");
    $("chg-ok").onclick = () => {
      Store.setMark("ack", b.id, Math.floor(Date.now() / 1000));
      $("chg-dialog").close();
      renderKeepScroll();
    };
    $("chg-dialog").showModal();
  }

  // ---------- small render helpers ----------
  function select(options, value, attrs, blank = "") {
    const opts = [...options];
    if (value && !opts.some(o => (Array.isArray(o) ? o[0] : o) === value)) opts.unshift([value, `${value} (not in list)`]);
    const html = opts.map(o => {
      const [v, l] = Array.isArray(o) ? o : [o, o];
      return `<option value="${esc(v)}" ${v === value ? "selected" : ""}>${esc(l)}</option>`;
    }).join("");
    return `<select ${attrs}>${blank ? `<option value="">${esc(blank)}</option>` : ""}${html}</select>`;
  }
  const check = inv => inv
    ? `<input type="checkbox" data-inv="${esc(inv.key)}" data-label="${esc(inv.label)}" data-type="${esc(inv.type)}" ${owned(inv.key) ? "checked" : ""} aria-label="Have it: ${esc(inv.label)}">`
    : `<input type="checkbox" disabled aria-label="Pick something first">`;
  const del = (list, id) => `<button class="btn icon small" data-del="${list}" data-id="${id}" aria-label="Remove">${icon("trash")}</button>`;
  const link = (href, text) => `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(text)}</a>`;

  function modCost(effects) {
    let total = 0, priced = 0;
    const named = effects.filter(Boolean);
    for (const e of named) {
      const it = App.findPrice(e, [e]) || App.findPrice(e);
      const p = it && it.category === "legendary_mod" && (it.prices.selling_caps || it.prices.buying_caps);
      if (p) { total += p.median; priced++; }
    }
    return named.length && priced ? `Mod boxes to craft it: ~${fmt(total)} caps (${priced} of ${named.length} priced)` : "";
  }

  // ---------- list view ----------
  function renderList() {
    const builds = Store.myBuilds().sort((a, b) => (b.updated || 0) - (a.updated || 0));
    const invCount = Store.marksOf("inv").length;
    const canImport = Store.mode === "server";
    $("b-root").innerHTML = `
      <div class="bar"><h2 style="margin:0">Builds</h2>
        <span><button class="btn small" id="b-inv">${icon("check")} My inventory (${invCount})</button>
        <button class="btn small" id="b-new">${icon("plus")} Blank build</button></span></div>
      <div class="box">
        <strong>Import a build</strong>
        <p class="small" style="margin:4px 0 8px">Paste a Nukes &amp; Dragons or FalloutBuilds planner link, a Reddit or guide link, or a YouTube link (it reads the description). You can also paste the build text or a video transcript.</p>
        <input type="url" id="b-url" placeholder="https://nukesdragons.com/fallout-76/character?…" style="width:100%;margin-bottom:8px" ${canImport ? "" : "disabled"}>
        <textarea id="b-text" placeholder="Or paste build text, a Reddit post, or a video transcript" ${canImport ? "" : "disabled"}></textarea>
        <div class="bar"><span class="small" id="b-status">${canImport ? "" : "Importing needs the server. Set it up in sync settings (top right). You can still make builds by hand."}</span>
          <button class="btn primary" id="b-import" ${canImport ? "" : "disabled"}>${icon("import")} Import</button></div>
      </div>
      ${builds.length ? builds.map(b => {
        const mine = progressFor(b);
        const pct = mine.total ? Math.round(mine.done / mine.total * 100) : 0;
        return `<button class="buildcard" data-open="${b.id}">
          <div class="bar" style="margin:0"><span class="name">${esc(b.name)}</span><span class="small">${(() => { const n = unseenChanges(b).length; return n ? `<span class="tag alert">${n} game change${n === 1 ? "" : "s"}</span> ` : ""; })()}${pct}%</span></div>
          ${b.summary ? `<div class="small">${esc(b.summary)}</div>` : ""}
          <div class="progress"><span style="width:${pct}%"></span></div>
          <div class="small">You have ${mine.done} of ${mine.total} pieces</div>
        </button>`;
      }).join("") : `<p class="empty">No builds yet. Import one above or start a blank build.</p>`}`;
  }

  async function doImport() {
    if (importBusy) return;
    const url = $("b-url").value.trim(), text = $("b-text").value.trim();
    if (!url && !text) { $("b-status").textContent = "Paste a link or some build text first."; return; }
    importBusy = true;
    $("b-import").disabled = true;
    $("b-status").textContent = "Reading the build… this can take 20–40 seconds.";
    try {
      const raw = await Store.api("POST", "/api/parse", {
        url, text,
        refs: {
          perks: Object.values(refs.bySpecial).flat(), legendaryPerks: refs.legendary, mutations: refs.mutations,
          effects: App.data.effects.map(e => e.name), armorSets: Object.keys(refs.armorSets), paSets: Object.keys(refs.paSets),
        },
      });
      const b = normalize(raw);
      Store.saveBuild(b);
      openId = b.id;
      render();
    } catch (e) {
      $("b-status").textContent = `Import failed: ${e.message}`;
    } finally {
      importBusy = false;
      if ($("b-import")) $("b-import").disabled = false;
    }
  }

  // ---------- detail view ----------
  function renderDetail(b) {
    const mine = progressFor(b);
    const pct = mine.total ? Math.round(mine.done / mine.total * 100) : 0;
    const used = {};
    for (const s of App.SPECIAL) used[s] = b.perks.filter(p => p.special === s).reduce((a, p) => a + (+p.rank || 1), 0);
    const specialTotal = App.SPECIAL.reduce((a, s) => a + (+b.special[s] || 0), 0);

    const perkSection = App.SPECIAL.map(s => {
      const rows = b.perks.filter(p => p.special === s);
      return `<div class="sechead"><h3>${App.SPECIAL_NAME[s]} <span class="small">${used[s]} of ${b.special[s] || 0} points used</span></h3>
          <button class="btn small" data-add="perks" data-special="${s}">${icon("plus")} Card</button></div>
        ${rows.map(p => `<div class="brow">${check(INV.perk(p))}
            ${select(refs.bySpecial[s], p.name, `data-list="perks" data-id="${p.id}" data-k="name" aria-label="Perk card"`, "Choose a card")}
            ${select([1, 2, 3, 4, 5].map(n => [String(n), `Rank ${n}`]), String(p.rank), `class="rank" data-list="perks" data-id="${p.id}" data-k="rank" aria-label="Rank"`)}
            <a class="btn icon small" href="${App.wiki(p.name)}" target="_blank" rel="noopener" aria-label="Wiki: ${esc(p.name)}">${icon("book")}</a>
            ${del("perks", p.id)}${chgs([p.name])}</div>`).join("") || `<p class="small">No ${App.SPECIAL_NAME[s]} cards.</p>`}`;
    }).join("");

    const weaponSection = b.weapons.map(w => {
      const it = App.findPrice(w.name, w.effects);
      const plan = planFor(w.name);
      return `<div class="brow">${check(INV.weap(w))}
        ${select(refs.weapons.map(x => [x.name, x.sub ? `${x.name} (${x.sub})` : x.name]), w.name, `data-list="weapons" data-id="${w.id}" data-k="name" aria-label="Weapon"`, "Choose a weapon")}
        ${del("weapons", w.id)}
        <div class="fxrow">${[0, 1, 2, 3].map(i => select(refs.weaponFx[i], w.effects[i], `data-list="weapons" data-id="${w.id}" data-k="fx${i}" aria-label="${i + 1} star effect"`, `${i + 1}★ any`)).join("")}</div>
        <span class="meta small">${it ? `This roll: ${esc(App.priceText(it))}` : "No listings for this exact roll"}${modCost(w.effects) ? `. ${esc(modCost(w.effects))}` : ""}
          ${plan ? `<br>${esc(plan)} ${App.priceTag(plan)}` : ""}<br>${link(App.wiki(w.name), "Wiki")} · <span data-market="${esc(w.name)}" role="link" tabindex="0" style="color:var(--accent);cursor:pointer">Market</span></span>
        ${chgs([w.name, ...w.effects], false, 4)}
      </div>`;
    }).join("");

    const armorPieces = pieces(refs.armorSets, b.armor.set);
    const paPieces = pieces(refs.paSets, b.power_armor.set);

    $("b-root").innerHTML = `
      <div class="bar"><button class="btn small" data-back>${icon("back")} All builds</button>
        <button class="btn small" data-delete-build>${icon("trash")} Delete</button></div>
      <input type="text" data-f="name" value="${esc(b.name)}" aria-label="Build name" style="width:100%;font-weight:600;font-size:1.05rem;margin-top:8px">
      <textarea data-f="summary" placeholder="What the build is about" style="min-height:50px;margin-top:6px">${esc(b.summary)}</textarea>
      <div class="small" style="margin-top:4px">
        ${b.source_url ? `${link(b.source_url, "Original source")} · ` : ""}${link(App.PLANNER_URL, "Nukes & Dragons planner")} · ${link(App.MAP_URL, "Ghoul Earth map")}
      </div>
      ${(b.parse_notes || []).length ? `<div class="notice small">${b.parse_notes.map(esc).join("<br>")}</div>` : ""}
      ${(() => { const all = buildChanges(b); return all.length ? `<div class="notice small">${all.length} logged game change${all.length === 1 ? "" : "s"} touch this build. They're noted on each row below.</div>` : ""; })()}
      <div class="box">
        <div class="bar" style="margin:0"><strong>What you have</strong><span class="small">${mine.done} of ${mine.total} (${pct}%)</span></div>
        <div class="progress"><span style="width:${pct}%"></span></div>
        <div class="small">Tick things you already have. Swap anything with the dropdowns. Ticks go to your inventory, so they carry over to every build that uses the same item. ${Store.mode === "server" ? "Everything syncs to your other devices." : "Saved on this device only until you connect a server."}</div>
      </div>

      <h2>S.P.E.C.I.A.L. <span class="small">${specialTotal} of 56 points</span></h2>
      <div class="special">${App.SPECIAL.map(s => `<label class="${used[s] > (b.special[s] || 0) ? "over" : ""}">${s}
        <input type="number" min="1" max="15" data-sp="${s}" value="${b.special[s] || 0}" aria-label="${App.SPECIAL_NAME[s]}">
        <span class="used">${used[s]} used</span></label>`).join("")}</div>

      <h2>Perk cards</h2>${perkSection}

      <div class="sechead"><h2>Legendary perks</h2><button class="btn small" data-add="legendary_perks">${icon("plus")} Add</button></div>
      ${b.legendary_perks.map(p => `<div class="brow">${check(INV.lp(p))}
        ${select(refs.legendary, p.name, `data-list="legendary_perks" data-id="${p.id}" data-k="name" aria-label="Legendary perk"`, "Choose")}
        ${select([1, 2, 3, 4].map(n => [String(n), `Rank ${n}`]), String(p.rank), `class="rank" data-list="legendary_perks" data-id="${p.id}" data-k="rank" aria-label="Rank"`)}
        <a class="btn icon small" href="${App.wiki(p.name)}" target="_blank" rel="noopener" aria-label="Wiki: ${esc(p.name)}">${icon("book")}</a>
        ${del("legendary_perks", p.id)}${chgs([p.name])}</div>`).join("") || `<p class="small">None.</p>`}

      <div class="sechead"><h2>Mutations</h2><button class="btn small" data-add="mutations">${icon("plus")} Add</button></div>
      ${b.mutations.map(m => `<div class="brow">${check(INV.mut(m))}
        ${select(refs.mutations, m.name, `data-list="mutations" data-id="${m.id}" data-k="name" aria-label="Mutation"`, "Choose")}
        ${del("mutations", m.id)}
        <span class="meta small">Serum ${App.priceTag(m.name + " Serum") || "no listings"} · ${link(App.wiki(m.name), "Wiki")}</span>${chgs([m.name])}</div>`).join("") || `<p class="small">None.</p>`}

      <div class="sechead"><h2>Weapons</h2><button class="btn small" data-add="weapons">${icon("plus")} Add</button></div>
      ${weaponSection || `<p class="small">None.</p>`}

      <h2>Armor</h2>
      <div class="brow" style="border:0">
        ${select(Object.keys(refs.armorSets).sort(), b.armor.set, `data-f="armor.set" aria-label="Armor set"`, "No regular armor")}
      </div>
      ${b.armor.set ? `<div class="fxrow" style="padding-left:0">${[0, 1, 2, 3].map(i => select(refs.armorFx[i], b.armor.effects[i], `data-f="armor.fx${i}" aria-label="${i + 1} star effect"`, `${i + 1}★ any`)).join("")}</div>
        ${chgs([b.armor.set, ...b.armor.effects], false, 4)}
        ${armorPieces.map(p => {
          const plan = planFor(p.name);
          const it = App.findPrice(p.name, b.armor.effects);
          return `<div class="brow">${check(INV.armor(p.name, b.armor.effects))}<span style="flex:1">${esc(p.name)}</span>
            <span class="meta small">${it ? `This roll: ${esc(App.priceText(it))}` : "No listings for this roll"}${plan ? ` · ${esc(plan)} ${App.priceTag(plan)}` : ""} · ${link(App.wiki(p.name), "Wiki")}</span>${chgs([p.name])}</div>`;
        }).join("")}` : ""}

      <h2>Power armor</h2>
      <div class="brow" style="border:0">
        ${select(Object.keys(refs.paSets).sort(), b.power_armor.set, `data-f="power_armor.set" aria-label="Power armor set"`, "No power armor")}
      </div>
      ${b.power_armor.set ? chgs([b.power_armor.set], false, 3) : ""}
      ${paPieces.map(p => {
        const plan = planFor(p.name);
        return `<div class="brow">${check(INV.pa(p.name))}<span style="flex:1">${esc(p.name)}</span>
          <span class="meta small">${plan ? `${esc(plan)} ${App.priceTag(plan) || "no listings"} · ` : ""}${link(App.wiki(p.name), "Wiki")}</span>${chgs([p.name])}</div>`;
      }).join("")}

      <div class="sechead"><h2>Consumables</h2><button class="btn small" data-add="consumables">${icon("plus")} Add</button></div>
      <datalist id="b-cons">${refs.consumables.map(c => `<option value="${esc(c)}">`).join("")}</datalist>
      ${b.consumables.map(c => `<div class="brow">${check(INV.cons(c))}
        <input type="text" list="b-cons" value="${esc(c.name)}" data-list="consumables" data-id="${c.id}" data-k="name" style="flex:1" aria-label="Consumable">
        ${del("consumables", c.id)}<span class="meta small">${App.priceTag(c.name)} ${link(App.wiki(c.name), "Wiki")}</span>${chgs([c.name])}</div>`).join("") || `<p class="small">None.</p>`}

      <h2>Notes</h2>
      <textarea data-f="notes" placeholder="Anything else">${esc(b.notes)}</textarea>`;
  }

  // ---------- editing ----------
  const INV_VIEW = "__inventory";
  function current() { return openId && openId !== INV_VIEW ? Store.build(openId) : null; }

  function renderInventory() {
    const items = Store.marksOf("inv").map(m => ({ key: m.key, ...(typeof m.value === "object" ? m.value : { label: m.key, type: "Other" }) }));
    const groups = {};
    items.forEach(i => (groups[i.type || "Other"] ||= []).push(i));
    $("b-root").innerHTML = `
      <div class="bar"><button class="btn small" data-back>${icon("back")} All builds</button></div>
      <h2>My inventory</h2>
      <p class="small">Everything you've ticked in any build. Untick here if you sold or scrapped something; every build updates.</p>
      ${Object.keys(groups).sort().map(g => `<h3>${esc(g)} <span class="small">${groups[g].length}</span></h3>
        ${groups[g].sort((a, b) => a.label.localeCompare(b.label)).map(i => `<div class="ck">
          <input type="checkbox" checked data-inv="${esc(i.key)}" data-label="${esc(i.label)}" data-type="${esc(i.type)}" aria-label="Have it: ${esc(i.label)}">
          <div class="body"><div class="name">${esc(i.label)}</div>${i.found ? `<div class="small">Added ${new Date(i.found).toLocaleDateString()}</div>` : ""}</div></div>`).join("")}`).join("")
        || `<p class="empty">Nothing yet. Tick items in a build and they show up here.</p>`}`;
  }

  function onChange(e) {
    if (e.target.dataset.inv && openId === INV_VIEW) {
      Store.setMark("inv", e.target.dataset.inv, e.target.checked ? { label: e.target.dataset.label, type: e.target.dataset.type, found: Date.now() } : null);
      return;
    }
    const b = current(); if (!b) return;
    const t = e.target;
    if (t.dataset.inv) {
      Store.setMark("inv", t.dataset.inv, t.checked ? { label: t.dataset.label, type: t.dataset.type, found: Date.now() } : null);
      renderKeepScroll(); return;
    }
    if (t.dataset.sp) { b.special[t.dataset.sp] = Math.max(0, Math.min(15, parseInt(t.value, 10) || 0)); }
    else if (t.dataset.f) {
      const f = t.dataset.f;
      if (f === "armor.set") b.armor.set = t.value;
      else if (f === "power_armor.set") b.power_armor.set = t.value;
      else if (f.startsWith("armor.fx")) b.armor.effects[+f.slice(8)] = t.value;
      else b[f] = t.value;
    } else if (t.dataset.list) {
      const row = b[t.dataset.list].find(r => r.id === t.dataset.id); if (!row) return;
      const k = t.dataset.k;
      if (k === "rank") row.rank = +t.value;
      else if (k.startsWith("fx")) row.effects[+k.slice(2)] = t.value;
      else row[k] = t.value;
    } else return;
    Store.saveBuild(b);
    renderKeepScroll();
  }

  function onClick(e) {
    const t = e.target.closest("button, [data-market]");
    if (!t) return;
    if (t.dataset.open) { openId = t.dataset.open; render(); window.scrollTo(0, 0); return; }
    if (t.id === "b-inv") { openId = INV_VIEW; render(); window.scrollTo(0, 0); return; }
    if (t.id === "b-new") { const b = blankBuild(); Store.saveBuild(b); openId = b.id; render(); return; }
    if (t.id === "b-import") { doImport(); return; }
    if (t.dataset.market) { App.show("market"); App.tabs.market.search(t.dataset.market); return; }
    if (t.hasAttribute("data-back")) { openId = null; render(); return; }
    const b = current(); if (!b) return;
    if (t.hasAttribute("data-delete-build")) {
      if (confirm(`Delete "${b.name}"? Your inventory stays as it is.`)) { Store.deleteBuild(b.id); openId = null; render(); }
      return;
    }
    if (t.dataset.add) {
      const list = t.dataset.add, id = App.uid();
      if (list === "perks") b.perks.push({ id, name: "", special: t.dataset.special, rank: 1 });
      else if (list === "legendary_perks") b.legendary_perks.push({ id, name: "", rank: 1 });
      else if (list === "weapons") b.weapons.push({ id, name: "", effects: ["", "", "", ""], notes: "" });
      else b[list].push({ id, name: "" });
      Store.saveBuild(b); renderKeepScroll(); return;
    }
    if (t.dataset.del) {
      // Removing a row from the build doesn't touch your inventory.
      b[t.dataset.del] = b[t.dataset.del].filter(r => r.id !== t.dataset.id);
      Store.saveBuild(b); renderKeepScroll();
    }
  }

  function renderKeepScroll() { const y = window.scrollY; render(); window.scrollTo(0, y); }

  function render() {
    if (!refs) refs = buildRefs();
    if (openId === INV_VIEW) { renderInventory(); return; }
    const b = current();
    if (openId && !b) openId = null;
    if (b) { renderDetail(b); maybePopup(b); } else renderList();
  }

  let wired = false;
  App.tabs.builds = {
    render() {
      if (!wired) {
        wired = true;
        $("b-root").addEventListener("change", onChange);
        $("b-root").addEventListener("click", onClick);
      }
      render();
    },
    refresh() {
      // Don't yank the page while someone is typing.
      const a = document.activeElement;
      if (a && $("b-root").contains(a) && /INPUT|TEXTAREA|SELECT/.test(a.tagName)) return;
      renderKeepScroll();
    },
    _normalize: raw => { if (!refs) refs = buildRefs(); return normalize(raw); },
    /** Ids of every logged game change that touches any of your builds. */
    changeIdsInBuilds: () => { if (!refs) refs = buildRefs(); return new Set(Store.myBuilds().flatMap(b => buildChanges(b).map(c => c.id))); },
  };
})();
