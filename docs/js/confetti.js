/* A small confetti burst from any checkbox you tick. Skipped if the device asks for reduced motion. */
(() => {
  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)");
  const COLORS = ["#f5c518", "#1d3f7d", "#4f86d9", "#ffffff", "#f5c518"];
  let canvas, ctx, parts = [], running = false;

  function ensureCanvas() {
    if (canvas) return;
    canvas = document.createElement("canvas");
    canvas.id = "confetti";
    canvas.setAttribute("aria-hidden", "true");
    document.body.appendChild(canvas);
    ctx = canvas.getContext("2d");
    const size = () => { const r = window.devicePixelRatio || 1; canvas.width = innerWidth * r; canvas.height = innerHeight * r; ctx.setTransform(r, 0, 0, r, 0, 0); };
    size();
    addEventListener("resize", size);
  }

  function burst(x, y, big) {
    ensureCanvas();
    const n = big ? 90 : 36;
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.3;
      const v = (big ? 7 : 5) + Math.random() * 5;
      parts.push({
        x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        w: 5 + Math.random() * 5, h: 3 + Math.random() * 4,
        r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.4,
        c: COLORS[i % COLORS.length], life: 0, max: 55 + Math.random() * 30,
      });
    }
    if (!running) { running = true; requestAnimationFrame(tick); }
  }

  function tick() {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    parts = parts.filter(p => p.life < p.max);
    for (const p of parts) {
      p.life++; p.vy += 0.28; p.vx *= 0.985; p.x += p.vx; p.y += p.vy; p.r += p.vr;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - p.life / p.max);
      ctx.translate(p.x, p.y); ctx.rotate(p.r);
      ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (parts.length) requestAnimationFrame(tick);
    else { running = false; ctx.clearRect(0, 0, innerWidth, innerHeight); }
  }

  // Capture phase: runs before the tab re-renders, while the checkbox is still on screen.
  document.addEventListener("change", e => {
    const t = e.target;
    if (!(t instanceof HTMLInputElement) || t.type !== "checkbox" || !t.checked) return;
    if (!t.closest("#b-root, #c-root, #ch-root")) return;
    if (!(t.dataset.ck || t.dataset.inv || t.dataset.task)) return; // items only, not filters
    if (reduce && reduce.matches) return;
    const r = t.getBoundingClientRect();
    burst(r.left + r.width / 2, r.top + r.height / 2, false);
  }, true);

  window.App && (App.confetti = burst);
})();
