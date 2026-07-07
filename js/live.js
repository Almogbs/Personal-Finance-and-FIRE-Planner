/* =============================================================================
 * live.js  —  Optional live market data (only runs when you press a button)
 * -----------------------------------------------------------------------------
 * Keeps the app offline by default. Each function makes a single user-initiated
 * GET request to a public API. No personal/plan data is ever sent — only a
 * currency pair or a stock symbol.
 *
 *  - USD/ILS: frankfurter.dev (ECB), falling back to open.er-api.com. No key.
 *  - Stock quote: Finnhub (finnhub.io) — requires a free API key (CORS-enabled).
 * ===========================================================================*/
(function () {
  "use strict";
  const FIRE = (window.FIRE = window.FIRE || {});

  async function fetchUsdIls() {
    // Primary: frankfurter.dev
    try {
      const r = await fetch("https://api.frankfurter.dev/v1/latest?base=USD&symbols=ILS");
      if (r.ok) {
        const d = await r.json();
        const v = d && d.rates && d.rates.ILS;
        if (v) return { value: v, source: "frankfurter.dev (ECB)", date: d.date };
      }
    } catch (e) { /* fall through */ }
    // Fallback: open.er-api.com
    const r2 = await fetch("https://open.er-api.com/v6/latest/USD");
    if (!r2.ok) throw new Error("FX request failed (HTTP " + r2.status + ")");
    const d2 = await r2.json();
    const v2 = d2 && d2.rates && d2.rates.ILS;
    if (!v2) throw new Error("USD/ILS not found in response");
    return { value: v2, source: "exchangerate-api.com", date: d2.time_last_update_utc };
  }

  async function yahooQuote(symbol, proxy) {
    const base = "https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(symbol) + "?interval=1d&range=1d";
    const url = proxy ? (proxy + encodeURIComponent(base)) : base;
    const r = await fetch(url);
    if (!r.ok) throw new Error("HTTP " + r.status);
    const d = await r.json();
    const m = d && d.chart && d.chart.result && d.chart.result[0] && d.chart.result[0].meta;
    const px = m && m.regularMarketPrice;
    if (px) return { price: px, source: "yahoo" + (proxy ? " (proxy)" : ""), currency: m.currency };
    throw new Error("no Yahoo data");
  }

  async function finnhubQuote(symbol, apiKey) {
    const url = "https://finnhub.io/api/v1/quote?symbol=" + encodeURIComponent(symbol) + "&token=" + encodeURIComponent(apiKey);
    const r = await fetch(url);
    if (!r.ok) throw new Error("HTTP " + r.status);
    const d = await r.json();
    if (d && typeof d.c === "number" && d.c > 0) return { price: d.c, source: "finnhub" };
    throw new Error("no quote for " + symbol);
  }

  // Try Yahoo via the configured proxy, then a built-in proxy, then direct;
  // finally Finnhub if a key is supplied. `opts = { apiKey, corsProxy }`.
  async function fetchQuote(symbol, opts) {
    opts = opts || {};
    symbol = (symbol || "").trim().toUpperCase();
    if (!symbol) throw new Error("no symbol");
    const proxies = [];
    if ((opts.corsProxy || "").trim()) proxies.push(opts.corsProxy.trim());
    if (proxies.indexOf("https://api.allorigins.win/raw?url=") < 0) proxies.push("https://api.allorigins.win/raw?url=");
    proxies.push(""); // direct (works only where CORS isn't enforced)
    let last = null;
    for (const px of proxies) {
      try { return await yahooQuote(symbol, px); } catch (e) { last = e; }
    }
    if (opts.apiKey) {
      try { return await finnhubQuote(symbol, opts.apiKey); }
      catch (e) { throw new Error("Finnhub failed (" + e.message + ")"); }
    }
    throw new Error("Yahoo/proxy blocked. Try another CORS proxy or add a free Finnhub key. [" + (last ? last.message : "?") + "]");
  }

  // Current date from a public time API (optional; browser clock works offline).
  async function fetchDate() {
    try {
      const r = await fetch("https://worldtimeapi.org/api/timezone/Asia/Jerusalem");
      if (r.ok) { const d = await r.json(); if (d && d.datetime) return { date: d.datetime.slice(0, 10), source: "worldtimeapi" }; }
    } catch (e) { /* fall through */ }
    const r2 = await fetch("https://timeapi.io/api/time/current/zone?timeZone=Asia/Jerusalem");
    if (!r2.ok) throw new Error("time request failed (HTTP " + r2.status + ")");
    const d2 = await r2.json();
    const iso = d2.dateTime || (d2.date && d2.date);
    if (iso) {
      const ds = /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : new Date(iso).toISOString().slice(0, 10);
      return { date: ds, source: "timeapi.io" };
    }
    throw new Error("no date in response");
  }

  FIRE.live = { fetchUsdIls, fetchQuote, yahooQuote, finnhubQuote, fetchDate };
})();
