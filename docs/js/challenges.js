/* Challenges & Events tab: today's dailies, this week's weeklies, seasonal and weekend events. */
(() => {
  const { $, esc, icon } = App;
  const Store = App.store;
  let wired = false, timer = null, view = "challenges", logFilter = "all", mineOnly = false;

  const data = () => App.data.challenges || null;
  const until = iso => {
    const ms = new Date(iso) - Date.now();
    if (ms <= 0) return "now";
    const h = Math.floor(ms / 3600000), m = Math.floor(ms % 3600000 / 60000);
    return h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${h}h ${m}m`;
  };
  const day = s => s ? new Date(s + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
  const today = () => new Date().toISOString().slice(0, 10);

  function listBlock(kind, label, block) {
    if (!block) return "";
    const stale = new Date(block.resets_at) <= Date.now();
    const items = stale ? [] : block.items;
    const done = items.filter(i => Store.isChecked(`chal:${i.id}`)).length;
    const pct = items.length ? Math.round(done / items.length * 100) : 0;
    return `<div class="sechead"><h2>${label}</h2><span class="small">${stale ? "Reset, waiting for the new list" : `Resets in <span data-until="${esc(block.resets_at)}">${until(block.resets_at)}</span>`}</span></div>
      ${stale ? `<div class="notice small">This list has reset. The new one shows up after the next daily update (usually early afternoon Eastern).</div>` : ""}
      ${items.length ? `<div class="small">${done} of ${items.length} done</div><div class="progress"><span style="width:${pct}%"></span></div>` : ""}
      ${items.map(i => {
        const k = `chal:${i.id}`, d = Store.isChecked(k);
        return `<div class="ck ${d ? "done" : ""}">
          <input type="checkbox" data-ck="${esc(k)}" ${d ? "checked" : ""} aria-label="Done: ${esc(i.title)}">
          <div class="body"><div class="name">${esc(i.title)}</div>
            ${i.detail ? `<div class="small">${esc(i.detail)}</div>` : ""}
            <div class="links">${i.score ? `<span class="tag">${i.score.toLocaleString()} SCORE</span>` : ""}
              <a href="${App.wiki(i.title)}" target="_blank" rel="noopener">Wiki ${icon("ext")}</a>
              <a href="${App.MAP_URL}" target="_blank" rel="noopener">Ghoul Earth ${icon("ext")}</a></div>
          </div></div>`;
      }).join("") || (stale ? "" : `<p class="empty">No ${kind} challenges found yet.</p>`)}`;
  }

  function eventsBlock(events) {
    const t = today();
    const now = events.filter(e => (!e.starts || e.starts <= t) && (!e.ends || e.ends >= t));
    const soon = events.filter(e => e.starts && e.starts > t);
    const row = e => {
      const k = `event:${e.id}`, d = Store.isChecked(k);
      const when = e.starts && e.ends ? `${day(e.starts)} to ${day(e.ends)}` : e.ends ? `until ${day(e.ends)}` : day(e.starts);
      return `<div class="ck ${d ? "done" : ""}">
        <input type="checkbox" data-ck="${esc(k)}" ${d ? "checked" : ""} aria-label="Done: ${esc(e.name)}">
        <div class="body"><div class="name">${esc(e.name)}</div>
          <div class="small">${esc(when)}${e.type && e.type !== "other" ? `, ${esc(e.type)} event` : ""}</div>
          ${e.description ? `<div class="small">${esc(e.description)}</div>` : ""}
          <div class="links"><a href="${App.wiki(e.name)}" target="_blank" rel="noopener">Wiki ${icon("ext")}</a></div>
        </div></div>`;
    };
    return `<h2>Events</h2>
      <h3>Happening now</h3>${now.map(row).join("") || `<p class="small">Nothing listed right now.</p>`}
      <h3>Coming up</h3>${soon.map(row).join("") || `<p class="small">Nothing announced yet.</p>`}`;
  }

  function renderLog() {
    const log = App.data.changes || { patches: [], changes: [] };
    const q = App.norm($("pl-q") ? $("pl-q").value : "").split(" ").filter(Boolean);
    const mine = mineOnly ? App.tabs.builds.changeIdsInBuilds() : null;
    const keep = c => (logFilter === "all" || c.direction === logFilter || (logFilter === "addrem" && (c.direction === "added" || c.direction === "removed")))
      && (!mine || mine.has(c.id)) && q.every(w => App.norm(c.name + " " + c.summary + " " + c.kind).includes(w));
    const byPatch = log.patches.map(p => ({ p, items: log.changes.filter(c => c.patch_id === p.id && keep(c)) })).filter(x => x.items.length);
    const filters = [["all", "All"], ["buff", "Buffs"], ["nerf", "Nerfs"], ["fix", "Fixes"], ["change", "Changes"], ["addrem", "Added or removed"]];
    return `
      <p class="small">Every change to named weapons, perks, legendary effects, mutations, armor, quests, and events from Bethesda's patch notes (via the Fallout wiki) and from the game files after each update. Changes that touch your builds are also noted inside each build.</p>
      <div class="searchrow"><input type="search" id="pl-q" placeholder="Search changes" value="${esc($("pl-q") ? $("pl-q").value : "")}" autocomplete="off"></div>
      <div class="chips">${filters.map(([k, l]) => `<button class="chip" data-lf="${k}" aria-pressed="${k === logFilter}">${esc(l)}</button>`).join("")}</div>
      <label class="small" style="display:flex;gap:8px;align-items:center;margin:4px 0 10px"><input type="checkbox" id="pl-mine" ${mineOnly ? "checked" : ""}> Only things in my builds</label>
      ${byPatch.map(({ p, items }) => `<h3>${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.title)}</a>` : esc(p.title)} <span class="small">${esc(p.date || "")}</span></h3>
        ${items.map(c => App.changeLine(c, true, false)).join("")}`).join("")
        || `<p class="empty">${log.changes.length ? "No changes match." : "No patch changes logged yet. They appear after the daily job reads the next patch notes."}</p>`}`;
  }

  function render() {
    const toggle = `<div class="subtabs" id="ch-view">
      <button class="btn small" data-v="challenges" aria-pressed="${view === "challenges"}">Challenges &amp; events</button>
      <button class="btn small" data-v="log" aria-pressed="${view === "log"}">Patch log</button></div>`;
    if (view === "log") {
      const hadFocus = document.activeElement && document.activeElement.id === "pl-q";
      $("ch-root").innerHTML = `<h2 style="margin:0 0 8px">Challenges &amp; events</h2>${toggle}${renderLog()}`;
      if (hadFocus) { const i = $("pl-q"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
      return;
    }
    const d = data();
    if (!d) {
      $("ch-root").innerHTML = `<h2 style="margin:0 0 8px">Challenges &amp; events</h2>${toggle}
        <p class="empty">No challenge data yet. It appears after the "Challenges and events" job runs on GitHub (daily, early afternoon Eastern).</p>`;
      return;
    }
    const s = d.season || {};
    $("ch-root").innerHTML = `
      <h2 style="margin:0 0 8px">Challenges &amp; events</h2>${toggle}
      <p class="small">${s.name ? `Season${s.number ? " " + esc(s.number) : ""}: ${esc(s.name)}${s.ends ? `, ends ${esc(day(s.ends))}` : ""}. ` : ""}Updated ${new Date(d.updated).toLocaleString()}. Your ticks are your own.</p>
      ${(d.notes || []).map(n => `<div class="notice small">${esc(n)}</div>`).join("")}
      ${listBlock("daily", "Daily", d.daily)}
      ${listBlock("weekly", "Weekly", d.weekly)}
      ${eventsBlock(d.events || [])}
      <p class="small" style="margin-top:24px">Sources: ${(d.sources || []).map(x => `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.name)}</a>${x.ok ? "" : " (failed today)"}`).join(", ")}. Route guides for each challenge: <a href="https://fo76challenges.com/" target="_blank" rel="noopener">fo76challenges.com</a>.</p>`;
  }

  App.tabs.challenges = {
    render() {
      if (!wired) {
        wired = true;
        $("ch-root").addEventListener("click", e => {
          const b = e.target.closest("button"); if (!b) return;
          if (b.closest("#ch-view")) { view = b.dataset.v; render(); }
          else if (b.dataset.lf) { logFilter = b.dataset.lf; render(); }
        });
        $("ch-root").addEventListener("input", e => { if (e.target.id === "pl-q") render(); });
        $("ch-root").addEventListener("change", e => {
          if (e.target.id === "pl-mine") { mineOnly = e.target.checked; render(); return; }
          if (!e.target.dataset.ck) return;
          Store.setCheck(e.target.dataset.ck, e.target.checked);
          // Finishing a whole list gets a bigger burst.
          const d = data();
          if (e.target.checked && d && App.confetti) {
            for (const block of [d.daily, d.weekly]) {
              const items = block && new Date(block.resets_at) > Date.now() ? block.items : [];
              if (items.some(i => `chal:${i.id}` === e.target.dataset.ck) && items.every(i => Store.isChecked(`chal:${i.id}`)))
                setTimeout(() => App.confetti(innerWidth / 2, innerHeight / 3, true), 150);
            }
          }
          render();
        });
      }
      render();
      clearInterval(timer);
      timer = setInterval(() => {
        if (App.current !== "challenges") return clearInterval(timer);
        document.querySelectorAll("#ch-root [data-until]").forEach(el => el.textContent = until(el.dataset.until));
      }, 30000);
    },
    refresh() { render(); },
  };
})();
