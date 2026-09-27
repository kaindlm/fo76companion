/* Market tab: trade prices and the full item database. */
(() => {
  const { $, esc, icon, fmt, ago, norm } = App;
  const LEGENDARY_CATS = new Set(["", "weapon", "armor", "power_armor", "legendary_mod"]);
  const PAGE = 50;
  const SORTS = {
    prices: [["recent", "Most recent"], ["posts", "Most posts"], ["high", "Highest caps price"], ["low", "Lowest caps price"], ["name", "Name"]],
    db: [["name", "Name"], ["value", "Highest vendor value"], ["priced", "Has prices first"]],
  };
  let view = "prices", cat = "", stars = "", shown = PAGE, openKey = null, pricedIds = new Set(), wired = false;

  const data = () => view === "prices" ? App.data.prices.items : App.data.catalog.items;
  const catOf = it => view === "prices" ? it.category : it.cat;

  function fillSelect(el, options, keep) {
    const prev = el.value;
    el.innerHTML = options.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("");
    if (keep && options.some(o => o[0] === prev)) el.value = prev;
  }

  function refreshControls() {
    document.querySelectorAll("#tab-market .prices-only").forEach(e => e.hidden = view !== "prices");
    document.querySelectorAll("#tab-market .db-only").forEach(e => e.hidden = view !== "db");
    document.querySelectorAll("#tab-market .legendary-only").forEach(e => e.hidden = !(view === "prices" && LEGENDARY_CATS.has(cat)));
    fillSelect($("m-sort"), SORTS[view], $("m-sort").dataset.view === view);
    $("m-sort").dataset.view = view;
    const subs = [...new Set(data().filter(it => !cat || catOf(it) === cat).map(it => it.sub).filter(Boolean))].sort();
    fillSelect($("m-sub"), [["", "All types"], ...subs.map(s => [s, s])], true);
    const applies = cat === "weapon" ? ["Weapon", "Both"] : (cat === "armor" || cat === "power_armor") ? ["Armor", "Both", "Power armor"] : null;
    for (let s = 1; s <= 4; s++) {
      const list = App.data.effects.filter(e => e.stars === s && (!applies || e.applies.some(a => applies.includes(a))));
      fillSelect($("m-fx" + s), [["", "Any"], ...list.map(e => [e.name, e.name])], true);
    }
    const counts = {};
    data().forEach(it => { const c = catOf(it); counts[c] = (counts[c] || 0) + 1; });
    const all = [["", "All", data().length], ...App.CATS.filter(([k]) => counts[k]).map(([k, l]) => [k, l, counts[k]])];
    $("m-chips").innerHTML = all.map(([k, l, n]) =>
      `<button class="chip" data-cat="${k}" aria-pressed="${k === cat}">${icon(k || "all")}${esc(l)} <span class="n">${fmt(n)}</span></button>`).join("");
    document.querySelectorAll("#m-view .btn").forEach(b => b.setAttribute("aria-pressed", b.dataset.v === view));
  }

  function activeFilters() {
    let n = 0;
    ["m-sub", "m-fx1", "m-fx2", "m-fx3", "m-fx4", "m-side", "m-cur"].forEach(id => { if ($(id).value && !$(id).closest("[hidden]")) n++; });
    if (stars && view === "prices") n++;
    if (view === "prices" && $("m-minPosts").value !== "1") n++;
    if (view === "db" && $("m-hasPrice").checked) n++;
    return n;
  }

  const totalPosts = it => Object.values(it.prices).reduce((a, p) => a + p.count, 0) || it.recent.length;
  function priceFor(it, side, cur) {
    const keys = [];
    for (const s of side ? [side] : ["selling", "buying"])
      for (const c of cur && cur !== "other" ? [cur] : ["caps", "leaders"]) keys.push(`${s}_${c}`);
    return keys.map(k => it.prices[k]).filter(Boolean);
  }

  function filterPrices() {
    const words = norm($("m-q").value).split(" ").filter(Boolean);
    const sub = $("m-sub").value, side = $("m-side").value, cur = $("m-cur").value, min = +$("m-minPosts").value;
    const fx = [1, 2, 3, 4].map(s => $("m-fx" + s).value).filter(Boolean);
    const rows = App.data.prices.items.filter(it => {
      if (cat && it.category !== cat) return false;
      if (sub && it.sub !== sub) return false;
      if (stars === "0" && it.stars) return false;
      if (stars && stars !== "0" && it.stars !== +stars) return false;
      if (fx.length && !fx.every(f => it.effects.includes(f))) return false;
      if (cur === "other" && !it.recent.some(r => r.currency === "other")) return false;
      if ((side || (cur && cur !== "other")) && !priceFor(it, side, cur).length) return false;
      if (totalPosts(it) < min) return false;
      const hay = norm(it.item + " " + it.effects.join(" ") + " " + (it.sub || ""));
      return words.every(w => hay.includes(w));
    });
    const capsMed = it => (it.prices.selling_caps || it.prices.buying_caps || {}).median;
    const sort = $("m-sort").value;
    if (sort === "posts") rows.sort((a, b) => totalPosts(b) - totalPosts(a));
    else if (sort === "high") rows.sort((a, b) => (capsMed(b) ?? -1) - (capsMed(a) ?? -1));
    else if (sort === "low") rows.sort((a, b) => (capsMed(a) ?? Infinity) - (capsMed(b) ?? Infinity));
    else if (sort === "name") rows.sort((a, b) => a.item.localeCompare(b.item));
    else rows.sort((a, b) => b.last_seen - a.last_seen);
    return rows;
  }

  function headline(it) {
    const order = [["selling_caps", "caps", "ask"], ["selling_leaders", "leaders", "ask"], ["buying_caps", "caps", "offer"], ["buying_leaders", "leaders", "offer"]];
    const side = $("m-side").value, cur = $("m-cur").value;
    const hit = order.find(([k]) => it.prices[k] && (!side || k.startsWith(side)) && (!cur || cur === "other" || k.endsWith(cur)));
    if (!hit) return `<span class="small">Item trades</span>`;
    const p = it.prices[hit[0]];
    const old = p.window === "older";
    return `<b>${fmt(p.median)} ${hit[1]}</b><span class="small">median ${hit[2]}, ${p.count} post${p.count === 1 ? "" : "s"}</span>${old ? `<span class="tag old">Older: ${ago(p.last_seen)}</span>` : ""}`;
  }

  function priceRows(it) {
    const label = { selling_caps: "Sellers ask (caps)", selling_leaders: "Sellers ask (leaders)", buying_caps: "Buyers offer (caps)", buying_leaders: "Buyers offer (leaders)" };
    return Object.entries(label).filter(([k]) => it.prices[k]).map(([k, l]) => {
      const p = it.prices[k];
      let v = `${fmt(p.median)} median, range ${fmt(p.low)}–${fmt(p.high)}, ${p.count} post${p.count === 1 ? "" : "s"}`;
      if (p.window === "older") v += `. No posts in the last 30 days; these are the most recent, last seen ${ago(p.last_seen)}`;
      if (p.median_7d != null && p.median_7d !== p.median) v += `. Last 7 days: ${fmt(p.median_7d)}`;
      return `<dt>${l}</dt><dd>${v}</dd>`;
    }).join("");
  }

  const examples = it => it.recent.map(r => `<div class="ex">
      <span class="tag ${r.side === "buying" ? "buy" : "sell"}">${r.side === "buying" ? "Buying" : "Selling"}</span>
      <strong>${esc(r.price || "")}</strong> <span class="small">${ago(r.seen_at)}</span>
      ${r.quote ? `<q>${esc(r.quote)}</q>` : ""}
      ${r.title ? `<div class="small">${esc(r.title)}</div>` : ""}
      ${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">Open post ${icon("ext")}</a>` : ""}
    </div>`).join("");

  function priceCard(it, key) {
    const db = it.catalog_id && App.catalogById.get(it.catalog_id);
    const open = openKey === key;
    const title = (it.stars ? "★".repeat(it.stars) + " " : "") + it.item;
    const pr = priceRows(it);
    return `<div class="row">
      <button aria-expanded="${open}" data-key="${esc(key)}">
        <span class="ico">${icon(it.category)}</span>
        <span class="body"><span class="name">${esc(title)}</span>
          ${it.effects.length && it.category !== "legendary_mod" ? `<div class="fx">${esc(it.effects.join(" / "))}</div>` : ""}
          <div class="small">${esc(App.CAT_LABEL[it.category] || "Misc")}${it.sub ? ", " + esc(it.sub) : ""}. Last seen ${ago(it.last_seen)}</div>
        </span>
        <span class="price">${headline(it)}</span>
      </button>
      <div class="detail" ${open ? "" : "hidden"}>
        ${pr ? `<dl class="grid">${pr}</dl>` : `<p class="small">Only item-for-item trades so far.</p>`}
        ${db ? `<p class="small">Vendor value ${fmt(db.value)} caps, weight ${fmt(db.weight)}${db.tradable ? "" : ". Marked untradable in game files"}</p>` : ""}
        <p class="small"><a href="${App.wiki(it.item)}" target="_blank" rel="noopener">Wiki ${icon("ext")}</a></p>
        <strong>Recent posts</strong>
        ${examples(it)}
      </div>
    </div>`;
  }

  function filterDb() {
    const words = norm($("m-q").value).split(" ").filter(Boolean);
    const sub = $("m-sub").value, tradable = $("m-tradable").checked, hasPrice = $("m-hasPrice").checked;
    const rows = App.data.catalog.items.filter(it => {
      if (cat && it.cat !== cat) return false;
      if (sub && it.sub !== sub) return false;
      if (tradable && !it.tradable) return false;
      if (hasPrice && !pricedIds.has(it.id)) return false;
      const hay = norm(it.name + " " + (it.sub || "") + " " + (it.region || "") + " " + (it.effect || ""));
      return words.every(w => hay.includes(w));
    });
    const sort = $("m-sort").value;
    if (sort === "value") rows.sort((a, b) => (b.value || 0) - (a.value || 0));
    else if (sort === "priced") rows.sort((a, b) => pricedIds.has(b.id) - pricedIds.has(a.id) || a.name.localeCompare(b.name));
    return rows;
  }

  function dbCard(it, key) {
    const open = openKey === key;
    const priced = pricedIds.has(it.id);
    const extra = [it.sub, it.region, it.glowing ? "Glowing" : null].filter(Boolean).join(", ");
    return `<div class="row">
      <button aria-expanded="${open}" data-key="${esc(key)}">
        <span class="ico">${icon(it.cat)}</span>
        <span class="body"><span class="name">${esc(it.name)}</span>
          <div class="small">${esc(App.CAT_LABEL[it.cat] || "Misc")}${extra ? ", " + esc(extra) : ""}</div>
        </span>
        <span class="price">${priced ? `<span class="tag sell">Has prices</span>` : ""} ${it.tradable ? "" : `<span class="tag no">Untradable</span>`}</span>
      </button>
      <div class="detail" ${open ? "" : "hidden"}>
        <dl class="grid">
          <dt>Vendor value</dt><dd>${fmt(it.value)} caps</dd>
          <dt>Weight</dt><dd>${fmt(it.weight)}</dd>
          <dt>Tradable</dt><dd>${it.tradable ? "Yes" : "No (game flag)"}</dd>
          ${it.stars ? `<dt>Stars</dt><dd>${it.stars}</dd>` : ""}
          <dt>Form ID</dt><dd>${esc(it.id)}</dd>
        </dl>
        <p class="small"><a href="${App.wiki(it.name)}" target="_blank" rel="noopener">Wiki ${icon("ext")}</a> &nbsp;
          <a href="${App.MAP_URL}" target="_blank" rel="noopener">Ghoul Earth map ${icon("ext")}</a></p>
        ${priced ? `<button class="btn small" data-goto="${esc(it.name)}">See market prices</button>` : `<p class="small">No trade posts seen for this in the last 30 days.</p>`}
      </div>
    </div>`;
  }

  function render() {
    const rows = view === "prices" ? filterPrices() : filterDb();
    const n = activeFilters();
    $("m-filterBtn").innerHTML = `${icon("filter")} Filters${n ? ` (${n})` : ""}`;
    const one = rows.length === 1;
    $("m-count").textContent = `${rows.length.toLocaleString()} ${view === "prices" ? (one ? "priced item" : "priced items") : (one ? "item" : "items")}`;
    if (!rows.length) {
      $("m-list").innerHTML = view === "prices" && !App.data.prices.items.length
        ? `<p class="empty">No price data yet. Run the daily update from the Actions tab on GitHub.</p>`
        : `<p class="empty">Nothing matches. Try fewer words or clear filters.</p>`;
      $("m-more").hidden = true;
      return;
    }
    $("m-list").innerHTML = rows.slice(0, shown).map(it => {
      const key = view === "prices" ? it.item + "|" + it.effects.join("/") : it.cat + "|" + it.id;
      return view === "prices" ? priceCard(it, key) : dbCard(it, key);
    }).join("");
    $("m-more").hidden = rows.length <= shown;
    $("m-more").textContent = `Show more (${(rows.length - shown).toLocaleString()} left)`;
  }
  const rerender = () => { shown = PAGE; render(); };

  function setView(v) { view = v; cat = ""; openKey = null; refreshControls(); rerender(); }

  function wire() {
    wired = true;
    pricedIds = new Set(App.data.prices.items.map(i => i.catalog_id).filter(Boolean));
    const p = App.data.prices;
    $("m-meta").textContent = (p.items.length ? `${fmt(p.item_count)} priced items${p.sample ? " (SAMPLE DATA)" : `, updated ${new Date(p.updated * 1000).toLocaleString()}`}` : "No price data yet")
      + `. ${fmt(App.data.catalog.count || App.data.catalog.items.length)} items in database.`;
    $("m-view").onclick = e => { const b = e.target.closest(".btn"); if (b) setView(b.dataset.v); };
    $("m-q").addEventListener("input", rerender);
    $("m-filterBtn").onclick = () => { const pn = $("m-panel"); pn.hidden = !pn.hidden; $("m-filterBtn").setAttribute("aria-pressed", !pn.hidden); };
    $("m-chips").onclick = e => { const b = e.target.closest(".chip"); if (!b) return; cat = b.dataset.cat; $("m-sub").value = ""; refreshControls(); rerender(); };
    $("m-stars").onclick = e => {
      const b = e.target.closest(".btn"); if (!b) return;
      stars = b.dataset.v;
      $("m-stars").querySelectorAll(".btn").forEach(x => x.setAttribute("aria-pressed", x === b));
      rerender();
    };
    ["m-sub", "m-sort", "m-fx1", "m-fx2", "m-fx3", "m-fx4", "m-side", "m-cur", "m-minPosts", "m-tradable", "m-hasPrice"].forEach(id => $(id).addEventListener("change", rerender));
    $("m-reset").onclick = () => {
      ["m-sub", "m-fx1", "m-fx2", "m-fx3", "m-fx4", "m-side", "m-cur"].forEach(id => $(id).value = "");
      $("m-minPosts").value = "1"; $("m-hasPrice").checked = false; $("m-tradable").checked = true;
      stars = ""; $("m-stars").querySelectorAll(".btn").forEach(x => x.setAttribute("aria-pressed", x.dataset.v === ""));
      rerender();
    };
    $("m-list").onclick = e => {
      const go = e.target.closest("[data-goto]");
      if (go) { setView("prices"); $("m-q").value = go.dataset.goto; rerender(); window.scrollTo(0, 0); return; }
      const b = e.target.closest("button[data-key]"); if (!b) return;
      openKey = openKey === b.dataset.key ? null : b.dataset.key;
      render();
    };
    $("m-more").onclick = () => { shown += PAGE; render(); };
    refreshControls();
  }

  App.tabs.market = {
    render() { if (!wired) wire(); render(); },
    refresh() { /* market data doesn't change from sync */ },
    search(text) { if (!wired) wire(); setView("prices"); $("m-q").value = text; rerender(); },
  };
})();
