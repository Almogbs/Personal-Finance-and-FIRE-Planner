/* =============================================================================
 * charts.js  —  Tiny zero-dependency canvas charts (line, bar, stacked, pie)
 * -----------------------------------------------------------------------------
 * No external libraries so the app is 100% standalone/offline. Each chart
 * supports high-DPI rendering and lightweight hover tooltips.
 * ===========================================================================*/
(function () {
  "use strict";
  const FIRE = (window.FIRE = window.FIRE || {});

  const PALETTE = [
    "#2f7ed8", "#f28e2b", "#59a14f", "#e15759", "#76b7b2",
    "#edc948", "#b07aa1", "#ff9da7", "#9c755f", "#bab0ac",
    "#4e79a7", "#8cd17d", "#d37295", "#b6992d", "#499894",
  ];

  // Theme-aware colors, read straight from the active CSS variables so chart
  // text always matches the current theme (light or dark).
  function theme() {
    try {
      const cs = getComputedStyle(document.documentElement);
      const v = (n, fb) => { const x = (cs.getPropertyValue(n) || "").trim(); return x || fb; };
      return { grid: v("--line", "#e6e6e6"), tick: v("--muted", "#888"), label: v("--ink", "#333") };
    } catch (e) {
      return { grid: "#e6e6e6", tick: "#888", label: "#333" };
    }
  }

  function fmt(n) {
    if (n == null || isNaN(n)) return "–";
    const abs = Math.abs(n);
    if (abs >= 1e9) return (n / 1e9).toFixed(2) + "B";
    if (abs >= 1e6) return (n / 1e6).toFixed(2) + "M";
    if (abs >= 1e3) return (n / 1e3).toFixed(1) + "k";
    return Math.round(n).toString();
  }

  function setupCanvas(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = rect.width || canvas.clientWidth || 600;
    const h = rect.height || canvas.clientHeight || 300;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h };
  }

  function ensureTooltip() {
    let tip = document.getElementById("fire-chart-tooltip");
    if (!tip) {
      tip = document.createElement("div");
      tip.id = "fire-chart-tooltip";
      tip.className = "chart-tooltip";
      tip.style.display = "none";
      document.body.appendChild(tip);
    }
    return tip;
  }
  function showTip(html, x, y) {
    const tip = ensureTooltip();
    tip.innerHTML = html;
    tip.style.display = "block";
    tip.style.left = x + 12 + "px";
    tip.style.top = y + 12 + "px";
  }
  function hideTip() {
    const tip = ensureTooltip();
    tip.style.display = "none";
  }

  /* ---- Line / multi-series line ------------------------------------------
   * cfg = { labels:[...], series:[{name, data:[...], color?}], yLabel? }
   *-----------------------------------------------------------------------*/
  function line(canvas, cfg) {
    const { ctx, w, h } = setupCanvas(canvas);
    ctx.clearRect(0, 0, w, h);
    const padL = 58, padR = 16, padT = 16, padB = 34;
    const plotW = w - padL - padR, plotH = h - padT - padB;
    const labels = cfg.labels || [];
    const series = cfg.series || [];

    let max = -Infinity, min = Infinity;
    series.forEach((s) => s.data.forEach((v) => { if (v == null || isNaN(v)) return; if (v > max) max = v; if (v < min) min = v; }));
    if (!isFinite(max)) { max = 1; min = 0; }
    if (min > 0) min = 0;
    if (max === min) max = min + 1;
    const pad = (max - min) * 0.05;
    max += pad;

    const x = (i) => padL + (labels.length <= 1 ? 0 : (i / (labels.length - 1)) * plotW);
    const y = (v) => padT + plotH - ((v - min) / (max - min)) * plotH;

    // grid + y ticks
    const TH = theme();
    ctx.strokeStyle = TH.grid; ctx.fillStyle = TH.tick; ctx.font = "11px system-ui, sans-serif";
    ctx.textAlign = "right"; ctx.textBaseline = "middle";
    const ticks = cfg.yTicks || 5;
    for (let t = 0; t <= ticks; t++) {
      const v = min + (t / ticks) * (max - min);
      const yy = y(v);
      ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(w - padR, yy); ctx.stroke();
      ctx.fillText(fmt(v), padL - 6, yy);
    }
    // x labels (sparse)
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    const step = Math.ceil(labels.length / 10) || 1;
    labels.forEach((lb, i) => {
      if (i % step === 0 || i === labels.length - 1) ctx.fillText(String(lb), x(i), h - padB + 6);
    });

    // lines (skip null/NaN points, drawing dots for isolated values)
    series.forEach((s, si) => {
      const color = s.color || PALETTE[si % PALETTE.length];
      ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 2; ctx.beginPath();
      let pen = false;
      s.data.forEach((v, i) => {
        if (v == null || isNaN(v)) { pen = false; return; }
        const xx = x(i), yy = y(v);
        if (pen) ctx.lineTo(xx, yy); else ctx.moveTo(xx, yy);
        pen = true;
      });
      ctx.stroke();
      // dots for points whose neighbors are missing (so lone actuals show)
      s.data.forEach((v, i) => {
        if (v == null || isNaN(v)) return;
        const prev = s.data[i - 1], next = s.data[i + 1];
        const lone = (prev == null || isNaN(prev)) && (next == null || isNaN(next));
        if (lone) { ctx.beginPath(); ctx.arc(x(i), y(v), 3, 0, Math.PI * 2); ctx.fill(); }
      });
    });

    // hover (tooltip only — avoids canvas redraw artifacts)
    attachHover(canvas, (mx, my, evt) => {
      let best = null, bestd = Infinity;
      labels.forEach((_, i) => { const d = Math.abs(x(i) - mx); if (d < bestd) { bestd = d; best = i; } });
      if (best == null || bestd > 40) { hideTip(); return; }
      let html = "<b>" + labels[best] + "</b>";
      series.forEach((s, si) => {
        const color = s.color || PALETTE[si % PALETTE.length];
        html += "<br><span style='color:" + color + "'>&#9632;</span> " + s.name + ": " + fmt(s.data[best]);
      });
      showTip(html, evt.clientX, evt.clientY);
    });

    return { max, min };
  }

  /* ---- Bar (grouped or stacked) ------------------------------------------
   * cfg = { labels, series:[{name,data,color?}], stacked?:bool, horizontal?:bool }
   *-----------------------------------------------------------------------*/
  function bar(canvas, cfg) {
    const { ctx, w, h } = setupCanvas(canvas);
    ctx.clearRect(0, 0, w, h);
    const padL = 58, padR = 16, padT = 16, padB = 34;
    const plotW = w - padL - padR, plotH = h - padT - padB;
    const labels = cfg.labels || [];
    const series = cfg.series || [];
    const stacked = !!cfg.stacked;

    let max = 0;
    if (stacked) {
      labels.forEach((_, i) => { let sum = 0; series.forEach((s) => (sum += s.data[i] || 0)); if (sum > max) max = sum; });
    } else {
      series.forEach((s) => s.data.forEach((v) => { if (v > max) max = v; }));
    }
    if (max === 0) max = 1;

    const y = (v) => padT + plotH - (v / max) * plotH;
    const TH = theme();
    ctx.strokeStyle = TH.grid; ctx.fillStyle = TH.tick; ctx.font = "11px system-ui, sans-serif";
    ctx.textAlign = "right"; ctx.textBaseline = "middle";
    for (let t = 0; t <= 5; t++) { const v = (t / 5) * max, yy = y(v); ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(w - padR, yy); ctx.stroke(); ctx.fillText(fmt(v), padL - 6, yy); }

    const groupW = plotW / labels.length;
    const rects = [];
    labels.forEach((lb, i) => {
      const gx = padL + i * groupW;
      if (stacked) {
        let acc = 0;
        series.forEach((s, si) => {
          const v = s.data[i] || 0;
          const bw = groupW * 0.7, bx = gx + groupW * 0.15;
          const y0 = y(acc), y1 = y(acc + v);
          ctx.fillStyle = s.color || PALETTE[si % PALETTE.length];
          ctx.fillRect(bx, y1, bw, y0 - y1);
          rects.push({ x: bx, y: y1, w: bw, h: y0 - y1, name: s.name, v, label: lb, color: ctx.fillStyle });
          acc += v;
        });
      } else {
        const bw = (groupW * 0.7) / series.length;
        series.forEach((s, si) => {
          const v = s.data[i] || 0;
          const bx = gx + groupW * 0.15 + si * bw;
          const yy = y(v);
          ctx.fillStyle = s.color || PALETTE[si % PALETTE.length];
          ctx.fillRect(bx, yy, bw * 0.9, padT + plotH - yy);
          rects.push({ x: bx, y: yy, w: bw * 0.9, h: padT + plotH - yy, name: s.name, v, label: lb, color: ctx.fillStyle });
        });
      }
    });

    ctx.fillStyle = TH.tick; ctx.textAlign = "center"; ctx.textBaseline = "top";
    const step = Math.ceil(labels.length / 12) || 1;
    labels.forEach((lb, i) => { if (i % step === 0 || i === labels.length - 1) ctx.fillText(String(lb), padL + i * groupW + groupW / 2, h - padB + 6); });

    attachHover(canvas, (mx, my, evt) => {
      const r = rects.find((rr) => mx >= rr.x && mx <= rr.x + rr.w && my >= rr.y && my <= rr.y + rr.h);
      if (r) showTip("<b>" + r.label + "</b><br><span style='color:" + r.color + "'>&#9632;</span> " + r.name + ": " + fmt(r.v), evt.clientX, evt.clientY);
      else hideTip();
    });
  }

  /* ---- Pie / doughnut -----------------------------------------------------
   * cfg = { slices:[{name,value,color?}], doughnut?:bool }
   *-----------------------------------------------------------------------*/
  function pie(canvas, cfg) {
    const { ctx, w, h } = setupCanvas(canvas);
    ctx.clearRect(0, 0, w, h);
    const slices = (cfg.slices || []).filter((s) => s.value > 0);
    const total = slices.reduce((a, s) => a + s.value, 0) || 1;
    const cx = w * 0.36, cy = h / 2, r = Math.min(w * 0.34, h * 0.42);
    let a0 = -Math.PI / 2;
    const arcs = [];
    slices.forEach((s, i) => {
      const frac = s.value / total, a1 = a0 + frac * Math.PI * 2;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r, a0, a1); ctx.closePath();
      ctx.fillStyle = s.color || PALETTE[i % PALETTE.length]; ctx.fill();
      arcs.push({ a0, a1, name: s.name, value: s.value, frac, color: ctx.fillStyle });
      a0 = a1;
    });
    if (cfg.doughnut) { ctx.globalCompositeOperation = "destination-out"; ctx.beginPath(); ctx.arc(cx, cy, r * 0.55, 0, Math.PI * 2); ctx.fill(); ctx.globalCompositeOperation = "source-over"; }

    // legend — shrink row height/font when there are many slices, and
    // ellipsize names so rows never run off the right edge of the canvas.
    const TH = theme();
    const rowH = slices.length > 10 ? 15 : 19;
    const fontPx = slices.length > 10 ? 11 : 13;
    ctx.font = "600 " + fontPx + "px system-ui, sans-serif"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
    const lx = w * 0.68;
    const maxTextW = Math.max(40, w - lx - 18 - 8);
    let ly = Math.max(rowH / 2 + 2, cy - (slices.length * rowH) / 2 + rowH / 2);
    slices.forEach((s, i) => {
      ctx.fillStyle = s.color || PALETTE[i % PALETTE.length];
      ctx.fillRect(lx, ly - 6, 12, 12);
      ctx.fillStyle = TH.label;
      const pct = ((s.value / total) * 100).toFixed(1) + "%";
      let name = s.name;
      let label = name + "  " + pct;
      while (name.length > 1 && ctx.measureText(label).width > maxTextW) {
        name = name.slice(0, -1);
        label = name + "…  " + pct;
      }
      ctx.fillText(label, lx + 18, ly);
      ly += rowH;
    });

    attachHover(canvas, (mx, my, evt) => {
      const dx = mx - cx, dy = my - cy, dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > r || (cfg.doughnut && dist < r * 0.55)) { hideTip(); return; }
      let ang = Math.atan2(dy, dx); if (ang < -Math.PI / 2) ang += Math.PI * 2;
      const arc = arcs.find((a) => ang >= a.a0 && ang < a.a1);
      if (arc) showTip("<b>" + arc.name + "</b><br>" + fmt(arc.value) + " (" + (arc.frac * 100).toFixed(1) + "%)", evt.clientX, evt.clientY);
      else hideTip();
    });
  }

  function attachHover(canvas, handler) {
    canvas.onmousemove = (e) => {
      const rect = canvas.getBoundingClientRect();
      handler(e.clientX - rect.left, e.clientY - rect.top, e);
    };
    canvas.onmouseleave = hideTip;
  }

  FIRE.charts = { line, bar, pie, fmt, PALETTE };
})();
