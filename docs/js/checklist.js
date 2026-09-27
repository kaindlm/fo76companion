/* Checklist tab: collectibles, fish, plans, and your own tasks. Progress is per person. */
(() => {
  const { $, esc, icon, fmt, norm } = App;
  const Store = App.store;
  let section = "legendary_fish", hideDone = false, shown = 60, wired = false;

  const natural = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true });
  const SECTIONS = [
    { id: "legendary_fish", label: "Legendary fish", icon: "fish", items: () => byCat("fish").filter(i => /Local Legend/.test(i.region || "")),
      note: "Local Legend fish. Some only appear in certain seasons." },
    { id: "fish", label: "All fish", icon: "fish", items: () => byCat("fish") },
    { id: "magazine", label: "Magazines", icon: "magazine", items: () => byCat("magazine") },
    { id: "bobblehead", label: "Bobbleheads", icon: "bobblehead", items: () => byCat("bobblehead").filter(i => !/^Glowing/.test(i.name)) },
    { id: "collectible", label: "Collectibles", icon: "collectible", items: () => byCat("collectible") },
    { id: "plan", label: "Plans learned", icon: "plan", items: () => byCat("plan").filter(i => i.tradable),
      note: "Every tradable plan. Use search to find the ones you care about." },
    { id: "recipe", label: "Recipes learned", icon: "recipe", items: () => byCat("recipe") },
    { id: "tasks", label: "My tasks", icon: "checklist", items: null },
  ];
  const cache = {};
  const byCat = c => (cache[c] ||= App.data.catalog.items.filter(i => i.cat === c).sort(natural));
  const sectionItems = s => (s.items ? s.items() : []);
  const keyFor = (s, it) => `ck:${s.id === "legendary_fish" ? "fish" : s.id}:${it.id}`;

  const tasks = () => Store.marksOf("task").map(m => ({ id: m.key, ...m.value })).sort((a, b) => (a.created || 0) - (b.created || 0));

  function renderChips() {
    return SECTIONS.map(s => {
      let count = "";
      if (s.items) { const items = sectionItems(s); const done = items.filter(i => Store.isChecked(keyFor(s, i))).length; count = `${done}/${items.length}`; }
      else { const t = tasks(); count = `${t.filter(x => x.done).length}/${t.length}`; }
      return `<button class="chip" data-sec="${s.id}" aria-pressed="${s.id === section}">${icon(s.icon)}${esc(s.label)} <span class="n">${count}</span></button>`;
    }).join("");
  }

  function renderItems(s) {
    const words = norm($("c-q") ? $("c-q").value : "").split(" ").filter(Boolean);
    const all = sectionItems(s);
    const doneCount = all.filter(i => Store.isChecked(keyFor(s, i))).length;
    let rows = all.filter(i => {
      if (hideDone && Store.isChecked(keyFor(s, i))) return false;
      const hay = norm(i.name + " " + (i.sub || "") + " " + (i.region || ""));
      return words.every(w => hay.includes(w));
    });
    const pct = all.length ? Math.round(doneCount / all.length * 100) : 0;
    const total = rows.length;
    rows = rows.slice(0, shown);
    return `
      ${s.note ? `<p class="small">${esc(s.note)}</p>` : ""}
      <div class="bar" style="margin-top:4px"><span class="small">${doneCount} of ${all.length} done (${pct}%)</span>
        <label class="small"><input type="checkbox" id="c-hide" ${hideDone ? "checked" : ""}> Hide done</label></div>
      <div class="progress"><span style="width:${pct}%"></span></div>
      ${rows.map(i => {
        const k = keyFor(s, i), done = Store.isChecked(k);
        const extra = [i.sub, i.region, i.glowing ? "Glowing" : null].filter(Boolean).join(", ");
        const tag = App.priceTag(i.name);
        return `<div class="ck ${done ? "done" : ""}">
          <input type="checkbox" data-ck="${esc(k)}" ${done ? "checked" : ""} aria-label="Done: ${esc(i.name)}">
          <div class="body"><div class="name">${esc(i.name)}</div>
            ${extra ? `<div class="small">${esc(extra)}</div>` : ""}
            <div class="links"><a href="${App.wiki(i.name)}" target="_blank" rel="noopener">Wiki ${icon("ext")}</a>
              <a href="${App.MAP_URL}" target="_blank" rel="noopener">Ghoul Earth ${icon("ext")}</a>${tag ? ` ${tag}` : ""}</div>
          </div></div>`;
      }).join("") || `<p class="empty">Nothing here${hideDone ? " that isn't done" : ""}.</p>`}
      ${total > shown ? `<button class="btn more" id="c-more">Show more (${fmt(total - shown)} left)</button>` : ""}`;
  }

  function renderTasks() {
    const t = tasks();
    return `
      <p class="small">Your own goals. Only you see these.</p>
      <div class="box">
        <input type="text" id="c-task" placeholder="e.g. Catch Wavy Willard, finish the Burning Springs questline" style="width:100%;margin-bottom:6px">
        <input type="url" id="c-tasklink" placeholder="Optional link (wiki, Ghoul Earth, video)" style="width:100%;margin-bottom:6px">
        <button class="btn primary" id="c-add">${icon("plus")} Add task</button>
      </div>
      ${t.map(x => `<div class="ck ${x.done ? "done" : ""}">
          <input type="checkbox" data-task="${esc(x.id)}" ${x.done ? "checked" : ""} aria-label="Done: ${esc(x.text)}">
          <div class="body"><div class="name">${esc(x.text)}</div>
            <div class="links">${x.link ? `<a href="${esc(x.link)}" target="_blank" rel="noopener">Link ${icon("ext")}</a>` : ""}
              <a href="${App.wiki(x.text)}" target="_blank" rel="noopener">Search wiki ${icon("ext")}</a>
              <button class="btn small" data-deltask="${esc(x.id)}">${icon("trash")} Remove</button></div>
          </div></div>`).join("") || `<p class="empty">No tasks yet.</p>`}`;
  }

  function render() {
    const s = SECTIONS.find(x => x.id === section);
    const q = $("c-q") ? $("c-q").value : "";
    $("c-root").innerHTML = `
      <h2 style="margin:0">Checklist</h2>
      <div class="chips">${renderChips()}</div>
      ${s.items ? `<div class="searchrow"><input type="search" id="c-q" placeholder="Search ${esc(s.label.toLowerCase())}" value="${esc(q)}" autocomplete="off"></div>` : ""}
      <div id="c-body">${s.items ? renderItems(s) : renderTasks()}</div>`;
  }

  function renderBody() {
    const s = SECTIONS.find(x => x.id === section);
    $("c-body").innerHTML = s.items ? renderItems(s) : renderTasks();
    document.querySelector("#c-root .chips").innerHTML = renderChips();
  }

  function wire() {
    wired = true;
    const root = $("c-root");
    root.addEventListener("input", e => { if (e.target.id === "c-q") { shown = 60; renderBody(); } });
    root.addEventListener("change", e => {
      const t = e.target;
      if (t.id === "c-hide") { hideDone = t.checked; renderBody(); return; }
      if (t.dataset.ck) { Store.setCheck(t.dataset.ck, t.checked); renderBody(); return; }
      if (t.dataset.task) {
        const x = Store.getMark("task", t.dataset.task); if (!x) return;
        Store.setMark("task", t.dataset.task, { ...x, done: t.checked ? Date.now() : 0 });
        renderBody();
      }
    });
    root.addEventListener("click", e => {
      const t = e.target.closest("button"); if (!t) return;
      if (t.dataset.sec) { section = t.dataset.sec; shown = 60; if ($("c-q")) $("c-q").value = ""; render(); return; }
      if (t.id === "c-more") { shown += 60; renderBody(); return; }
      if (t.id === "c-add") {
        const text = $("c-task").value.trim(); if (!text) return;
        Store.setMark("task", App.uid(), { text, link: $("c-tasklink").value.trim(), created: Date.now(), done: 0 });
        renderBody(); return;
      }
      if (t.dataset.deltask) {
        if (!confirm("Remove this task?")) return;
        Store.setMark("task", t.dataset.deltask, null);
        renderBody();
      }
    });
  }

  App.tabs.checklist = {
    render() { if (!wired) wire(); render(); },
    refresh() {
      const a = document.activeElement;
      if (a && $("c-root").contains(a) && /INPUT|TEXTAREA/.test(a.tagName) && a.type !== "checkbox") return;
      renderBody();
    },
  };
})();
