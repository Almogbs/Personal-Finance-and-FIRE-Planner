/* =============================================================================
 * app.js  —  Init, routing, and delegated event handling
 * -----------------------------------------------------------------------------
 * Wires the UI pages to the state. Inputs update state live; structural
 * actions (add/remove/reset/load) re-mount the active page.
 * ===========================================================================*/
(function () {
  "use strict";
  const FIRE = (window.FIRE = window.FIRE || {});
  const state = FIRE.state;
  FIRE.auth = FIRE.auth || { user: null, idToken: "", status: "Not signed in" };
  FIRE.cloudConfig = FIRE.cloudConfig || {};

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
function getCloudConfig() {
  return FIRE.cloudConfig || {
    googleClientId: "",
    cloudApiBaseUrl: ""
  };
}

  async function loadCloudConfig() {
  try {
    const res = await fetch("https://quiet-salad-4bc4.almogbs1.workers.dev/config");
    if (!res.ok) throw new Error("Failed to load cloud config");

    const cfg = await res.json();

    FIRE.cloudConfig = {
      googleClientId: cfg.googleClientId || "",
      cloudApiBaseUrl: cfg.workerUrl || ""
    };

    const status = document.getElementById("cloud-config-status");
    if (status) {
      status.textContent = "Cloud configuration loaded.";
    }

  } catch (e) {
    console.error("Cloud config error:", e);

    const status = document.getElementById("cloud-config-status");
    if (status) {
      status.textContent = "Unable to load cloud configuration.";
    }
  }
}
  
  function saveCloudConfig(next) {
    const cfg = Object.assign(getCloudConfig(), next || {});
    FIRE.cloudConfig = cfg;
    try { localStorage.setItem("fire-planner-cloud-config", JSON.stringify(cfg)); } catch (e) {}
    return cfg;
  }
  function setCloudConfig(key, value) {
    const cfg = saveCloudConfig({ [key === "googleClientId" ? "googleClientId" : "cloudApiBaseUrl"]: value || "" });
    if (key === "googleClientId") initGoogleAuth();
    updateCloudUi();
    return cfg;
  }
  function setCloudStatus(msg, cls) {
    const el = document.getElementById("cloud-status");
    if (!el) return;
    el.className = "hint" + (cls ? " " + cls : "");
    el.innerHTML = msg;
  }
  function decodeJwtPayload(token) {
    try {
      const parts = token.split(".");
      if (parts.length < 2) return null;
      const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      return JSON.parse(atob(payload));
    } catch (e) {
      return null;
    }
  }
  function updateCloudUi() {
    const cfg = getCloudConfig();
    const workerInput = document.getElementById("cloud-worker-url");
    if (workerInput && workerInput.value !== cfg.cloudApiBaseUrl) workerInput.value = cfg.cloudApiBaseUrl;
    const clientInput = document.getElementById("cloud-google-client-id");
    if (clientInput && clientInput.value !== cfg.googleClientId) clientInput.value = cfg.googleClientId;
    const btnHost = document.getElementById("google-signin");
    if (!btnHost) return;
    if (!cfg.googleClientId) {
      btnHost.innerHTML = '<p class="hint">Add a Google Client ID to enable sign-in.</p>';
      setCloudStatus("Loading cloud configuration...", "");
      return;
    }
    if (FIRE.auth && FIRE.auth.user) {
      setCloudStatus('Signed in as <b>' + escapeHtml(FIRE.auth.user.email || FIRE.auth.user.name || "Google user") + '</b> — ready to sync.', "ok");
    } else {
      setCloudStatus("Sign in with Google to load or save your plan from the cloud.", "");
    }
  }
  async function requestCloud(method, path, body) {
    const cfg = getCloudConfig();
    const baseUrl = (cfg.cloudApiBaseUrl || "").replace(/\/$/, "");
    if (!baseUrl) throw new Error("Set your Cloudflare Worker URL first.");
    const headers = { Accept: "application/json" };
    if (FIRE.auth && FIRE.auth.idToken) headers.Authorization = "Bearer " + FIRE.auth.idToken;
    const init = { method, headers };
    if (body != null) { headers["Content-Type"] = "application/json"; init.body = JSON.stringify(body); }
    const res = await fetch(baseUrl + path, init);
    const text = await res.text();
    let data = null;
    if (text) {
      try { data = JSON.parse(text); } catch (e) { data = text; }
    }
    if (!res.ok) {
      const msg = data && (data.error || data.message) ? data.error || data.message : "Cloud request failed";
      throw new Error(msg);
    }
    return data;
  }
  async function loadPlanFromCloud() {
    if (!FIRE.auth || !FIRE.auth.idToken) {
      setCloudStatus("Sign in with Google before loading your saved plan.", "bad");
      return;
    }
    try {
      setCloudStatus("Loading your plan from the cloud…", "");
      const data = await requestCloud("GET", "/plan");
      if (!data || !data.plan) throw new Error("The worker returned no plan.");
      state.importJSON(JSON.stringify(data.plan));
      remountPage();
      setCloudStatus("✓ Loaded your cloud-saved plan.", "ok");
    } catch (e) {
      setCloudStatus("✕ " + e.message, "bad");
    }
  }
  async function savePlanToCloud() {
    if (!FIRE.auth || !FIRE.auth.idToken) {
      setCloudStatus("Sign in with Google before saving your plan.", "bad");
      return;
    }
    try {
      setCloudStatus("Saving your plan to the cloud…", "");
      await requestCloud("PUT", "/plan", { plan: state.get() });
      setCloudStatus("✓ Saved your plan to the cloud.", "ok");
    } catch (e) {
      setCloudStatus("✕ " + e.message, "bad");
    }
  }
function promptGoogleLogin() {
  const host = document.getElementById("google-signin");

  if (!host) {
    setCloudStatus("Google sign-in button is unavailable.", "bad");
    return;
  }

  host.scrollIntoView({ behavior: "smooth", block: "center" });
  setCloudStatus("Use the Google button above to sign in.", "");
}
  function signOutFromCloud() {
    FIRE.auth.user = null; FIRE.auth.idToken = ""; FIRE.auth.status = "Signed out";
    updateCloudUi();
  }
  function initGoogleAuth() {
    const cfg = getCloudConfig();
    const host = document.getElementById("google-signin");
    if (!cfg.googleClientId) {
      if (host) host.innerHTML = '<p class="hint">Loading Google sign-in configuration...</p>';
      updateCloudUi();
      return;
    }
    if (!window.google || !window.google.accounts || !window.google.accounts.id) {
      if (host) host.innerHTML = '<p class="hint">Loading Google sign-in…</p>';
      window.addEventListener("load", initGoogleAuth, { once: true });
      return;
    }
    window.google.accounts.id.initialize({
      client_id: cfg.googleClientId,
      callback: (response) => {
        FIRE.auth.idToken = response.credential;
        FIRE.auth.user = decodeJwtPayload(response.credential);
        FIRE.auth.status = "Signed in";
        updateCloudUi();
      },
      auto_select: false,
    });
    if (host) {
      host.innerHTML = "";
      window.google.accounts.id.renderButton(host, { theme: "outline", size: "large", text: "signin_with" });
    }
    if (!host) {
  console.log("Google sign-in container not mounted yet");
  return;
}
    
    updateCloudUi();
  }

  const NAV = [
    ["dashboard", "📊 Dashboard"],
    ["accounts", "🏦 Accounts"],
    ["assumptions", "⚙️ Market & Assumptions"],
    ["income", "💰 Income"],
    ["spending", "🛒 Spending"],
    ["tracker", "🧾 Tracker"],
    ["pension", "👵 Pension"],
    ["projections", "📈 Projections"],
    ["predictions", "🎯 Predictions"],
    ["whatif", "🔀 What-if / Switch"],
    ["data", "💾 Save / Load"],
  ];

  let current = "dashboard";
  let pageEl = null;

  /* ---- Path write with coercion ------------------------------------------ */
  function coerce(el, type) {
    if (type === "bool") return !!el.checked;
    if (type === "int") { const n = parseInt(el.value, 10); return isNaN(n) ? 0 : n; }
    if (type === "float") { const n = parseFloat(el.value); return isNaN(n) ? 0 : n; }
    return el.value;
  }
  function setPath(obj, path, value) {
    const parts = path.split(".");
    let o = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      if (o[parts[i]] == null) o[parts[i]] = {};
      o = o[parts[i]];
    }
    o[parts[parts.length - 1]] = value;
  }
  function getArr(obj, path) {
    return path.split(".").reduce((o, k) => (o == null ? o : o[k]), obj);
  }

  /* ---- Rendering ---------------------------------------------------------- */
  function syncViewportClass() {
    document.body.classList.toggle("mobile-nav", window.innerWidth <= 1100);
  }
  function renderNav() {
    const nav = document.getElementById("nav");
    nav.innerHTML = NAV.map(([id, label]) =>
      '<button class="nav-btn' + (id === current ? " active" : "") + '" data-nav="' + id + '">' + label + "</button>"
    ).join("");
    syncViewportClass();
  }
function mountPage() {
  pageEl = document.getElementById("page");
  const page = FIRE.ui.pages[current];
  page.mount(pageEl);

  if (current === "data") {
    initGoogleAuth();
  }
}
  function updatePage() {
    const page = FIRE.ui.pages[current];
    if (page && page.update && pageEl) page.update(pageEl);
    // Header live readouts
    updateHeader();
  }
  function remountPage() {
    mountPage();
    updateHeader();
  }
  function updateHeader() {
    const st = state.get();
    const p = FIRE.engine.project(st);
    const snap = p.snapshot;
    const badge = document.getElementById("header-status");
    if (badge) {
      badge.innerHTML =
        '<span class="hdr-metric">Net worth <b>' + FIRE.ui.money(snap.total) + "</b></span>" +
        '<span class="hdr-metric">FIRE target <b>' + FIRE.ui.money(p.targets.target) + "</b></span>" +
        '<span class="hdr-metric">' + (p.survives ? '<span class="ok">✓ survives to 80</span>' : '<span class="bad">✕ depletes @ ' + p.depletionAge + "</span>") + "</span>";
    }
    const nameEl = document.getElementById("header-name");
    if (nameEl) nameEl.textContent = st.meta.name;
  }

  function go(id) {
    if (!FIRE.ui.pages[id]) return;
    current = id;
    renderNav();
    mountPage();
    updateHeader();
    window.scrollTo(0, 0);
  }

  window.addEventListener("resize", syncViewportClass);
  window.addEventListener("DOMContentLoaded", syncViewportClass);

  /* ---- Structural actions ------------------------------------------------- */
  function handleAction(action, el) {
    const st = state.get();
    switch (action) {
      case "add-account": {
        const acc = state.newAccount(el.dataset.kind);
        st.accounts.push(acc); state.update(() => {}); remountPage(); break;
      }
      case "del-account": {
        st.accounts = st.accounts.filter((a) => a.id !== el.dataset.id); state.update(() => {}); remountPage(); break;
      }
      case "add-cat": {
        st.spending.categories.push({ id: state.uid("cat"), name: "New category", freq: "monthly", monthly: 500, startAge: Math.round(st.profile.currentAge), endAge: st.profile.endAge, growthPct: st.spending.growthPct, inflate: true });
        state.update(() => {}); remountPage(); break;
      }
      case "del-cat": {
        st.spending.categories = st.spending.categories.filter((c) => c.id !== el.dataset.id); state.update(() => {}); remountPage(); break;
      }
      case "add-step": {
        st.spending.steps = st.spending.steps || [];
        st.spending.steps.push({ id: state.uid("step"), fromAge: Math.round(st.profile.currentAge) + 2, monthly: st.spending.fireMonthly, freq: "monthly", note: "" });
        state.update(() => {}); remountPage(); break;
      }
      case "del-step": {
        st.spending.steps = (st.spending.steps || []).filter((s) => s.id !== el.dataset.id); state.update(() => {}); remountPage(); break;
      }
      case "add-extra": {
        st.income.extra = st.income.extra || [];
        st.income.extra.push({ id: state.uid("inc"), name: "New income", monthlyAmount: 1000, startAge: Math.round(st.profile.currentAge), endAge: st.profile.endAge, growthPct: 0 });
        state.update(() => {}); remountPage(); break;
      }
      case "del-extra": {
        st.income.extra = (st.income.extra || []).filter((s) => s.id !== el.dataset.id); state.update(() => {}); remountPage(); break;
      }
      case "add-grant": {
        st.income.grants = st.income.grants || [];
        st.income.grants.push(state.newGrant(st));
        state.update(() => {}); remountPage(); break;
      }
      case "del-grant": {
        st.income.grants = (st.income.grants || []).filter((g) => g.id !== el.dataset.id); state.update(() => {}); remountPage(); break;
      }
      case "add-alloc": {
        st.income.allocations = st.income.allocations || [];
        const first = st.accounts[0] ? st.accounts[0].id : null;
        st.income.allocations.push({ id: state.uid("alloc"), accountId: first, mode: "percent", value: 10 });
        state.update(() => {}); remountPage(); break;
      }
      case "del-alloc": {
        st.income.allocations = (st.income.allocations || []).filter((a) => a.id !== el.dataset.id); state.update(() => {}); remountPage(); break;
      }
      case "toggle-theme": {
        st.meta.theme = st.meta.theme === "dark" ? "light" : "dark";
        state.update(() => {}); applyTheme(); updatePage(); break;
      }
      case "set-fire-age": {
        const age = parseInt(el.dataset.age, 10);
        if (!isNaN(age)) { st.profile.fireAge = age; state.update(() => {}); remountPage(); }
        break;
      }
      case "save-file": state.download(sanitizeName(st.meta.name) + ".json"); break;
      case "load-file": document.getElementById("data-file").click(); break;
      case "load-sample": loadSample(); break;
      case "reset":
        if (confirm("Reset everything to the default plan? Your current state will be overwritten.")) { state.reset(); remountPage(); }
        break;
      case "export-csv": FIRE.ui.pages.projections.exportCSV(); break;
      case "add-month": {
        const inp = document.getElementById("trk-month");
        let ym = inp && inp.value ? inp.value : new Date().toISOString().slice(0, 7);
        st.tracker.months = st.tracker.months || [];
        if (!st.tracker.months.some((m) => m.ym === ym)) {
          st.tracker.months.push({ id: state.uid("mo"), ym: ym, entries: {}, note: "" });
          state.update(() => {}); remountPage();
        }
        break;
      }
      case "del-month": {
        st.tracker.months = (st.tracker.months || []).filter((m) => m.id !== el.dataset.id);
        state.update(() => {}); remountPage(); break;
      }
      case "save-baseline": savePredictionBaseline(); break;
      case "record-actual": recordActualYear(); break;
      case "del-actual": {
        const y = el.dataset.year;
        if (st.predictions && st.predictions.actuals) { delete st.predictions.actuals[y]; state.update(() => {}); remountPage(); }
        break;
      }
      case "pred-year": FIRE.ui.pages.predictions.selYear = parseInt(el.dataset.year, 10); FIRE.ui.pages.predictions.update(pageEl); break;
      case "fetch-fx": fetchFx(); break;
      case "fetch-date": fetchDate(); break;
      case "fetch-prices": fetchPrices(); break;
      case "cloud-sign-in": promptGoogleLogin(); break;
      case "cloud-sign-out": signOutFromCloud(); break;
      case "cloud-load": loadPlanFromCloud(); break;
      case "cloud-save": savePlanToCloud(); break;
    }
  }

  /* ---- Predictions: baseline snapshot & yearly actuals -------------------- */
  function yearForAge(st, age) {
    const bs = st.profile.birthDate;
    if (bs) { const b = new Date(bs); if (!isNaN(b.getTime())) return b.getFullYear() + age; }
    const now = FIRE.state.refDate(st);
    return now.getFullYear() + (age - Math.round(st.profile.currentAge));
  }
  function savePredictionBaseline() {
    const st = state.get();
    const p = FIRE.engine.project(st);
    const nowYear = FIRE.state.refDate(st).getFullYear();
    const years = [];
    p.rows.forEach((r) => {
      const y = yearForAge(st, r.age);
      if (y >= nowYear && years.length < 30) {
        years.push({ year: y, age: r.age, total: Math.round(r.total), perAccount: Object.assign({}, r.perAccount) });
      }
    });
    st.predictions.baselineSavedAt = new Date().toISOString();
    st.predictions.accounts = p.accountsMeta.map((a) => ({ id: a.id, name: a.name }));
    st.predictions.years = years;
    state.update(() => {});
    remountPage();
  }
  function recordActualYear() {
    const st = state.get();
    const snap = FIRE.engine.snapshot(st);
    const y = FIRE.state.refDate(st).getFullYear();
    const perAccount = {};
    snap.accounts.forEach((a) => (perAccount[a.id] = Math.round(a.valueILS)));
    st.predictions.actuals = st.predictions.actuals || {};
    st.predictions.actuals[y] = { total: Math.round(snap.total), perAccount: perAccount, savedAt: new Date().toISOString() };
    state.update(() => {});
    remountPage();
  }

  /* ---- Live data (optional, user-initiated network requests) -------------- */
  function setStatus(id, msg, cls) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = ' <span class="' + (cls || "") + '">' + msg + "</span>";
  }
  async function fetchDate() {
    if (!FIRE.live) return;
    setStatus("date-status", "fetching…");
    try {
      const res = await FIRE.live.fetchDate();
      state.get().profile.dateOverride = res.date;
      state.update(() => {});
      remountPage();
      setStatus("date-status", "✓ " + res.date + " (" + res.source + ")", "ok");
    } catch (e) {
      setStatus("date-status", "✕ " + e.message + " — using your device clock.", "bad");
    }
  }
  async function fetchFx() {
    if (!FIRE.live) return;
    setStatus("fx-status", "fetching…");
    try {
      const res = await FIRE.live.fetchUsdIls();
      state.get().market.usdIls = Math.round(res.value * 10000) / 10000;
      state.update(() => {});
      remountPage();
      setStatus("fx-status", "✓ " + res.value.toFixed(4) + " (" + res.source + ")", "ok");
    } catch (e) {
      setStatus("fx-status", "✕ " + e.message + " — check your connection or set it manually.", "bad");
    }
  }
  async function fetchPrices() {
    if (!FIRE.live) return;
    const st = state.get();
    const key = (st.live && st.live.stockApiKey) || "";
    const proxy = (st.live && st.live.corsProxy) || "";
    const grants = (st.income.grants || []).filter((g) => (g.symbol || "").trim());
    if (!grants.length) { setStatus("grants-status", "add a Symbol (e.g. AMZN) to a grant first", "bad"); return; }
    setStatus("grants-status", "fetching " + grants.length + "…");
    let ok = 0; const errs = [];
    for (const g of grants) {
      try { const q = await FIRE.live.fetchQuote(g.symbol, { apiKey: key, corsProxy: proxy }); g.sharePrice = Math.round(q.price * 100) / 100; ok++; }
      catch (e) { errs.push(g.symbol + ": " + e.message); }
    }
    state.update(() => {});
    remountPage();
    const link = ' <a href="https://finnhub.io/register" target="_blank" rel="noopener">get a free key</a>';
    setStatus("grants-status", (ok ? "✓ updated " + ok : "✕ none updated") + (errs.length ? " · " + errs.join(" · ") + (key ? "" : link) : ""), errs.length ? "bad" : "ok");
  }

  function sanitizeName(n) { return String(n || "fire-plan").replace(/[^a-z0-9\-_]+/gi, "-").toLowerCase(); }

  function loadSample() {
    fetch("data/sample-state.json")
      .then((r) => r.text())
      .then((t) => { state.importJSON(t); remountPage(); })
      .catch(() => alert("Could not load sample. If opened via file://, some browsers block fetch. Use 'Load from file' instead."));
  }

  /* ---- Delegated events --------------------------------------------------- */
  function onInput(e) {
    const el = e.target;
    if (el.id === "cloud-worker-url") { setCloudConfig("cloudApiBaseUrl", el.value); return; }
    if (el.id === "cloud-google-client-id") { setCloudConfig("googleClientId", el.value); return; }
    // Expense-tracker cell (month × category).
    if (el.dataset && el.dataset.trkm) {
      const st = state.get();
      const m = (st.tracker.months || []).find((x) => x.id === el.dataset.trkm);
      if (m) { m.entries = m.entries || {}; m.entries[el.dataset.trkc] = coerce(el, "float"); state.update(() => {}); updatePage(); }
      return;
    }
    if (el.dataset && el.dataset.path) {
      const st = state.get();
      setPath(st, el.dataset.path, coerce(el, el.dataset.type));
      state.update(() => {});
      // sync sibling slider/number
      const row = el.closest(".ctl-row");
      if (row) row.querySelectorAll('[data-path="' + cssEscape(el.dataset.path) + '"]').forEach((sib) => { if (sib !== el) sib.value = el.value; });
      updatePage();
      return;
    }
    if (el.dataset && el.dataset.arr && el.dataset.id) {
      const st = state.get();
      const arr = getArr(st, el.dataset.arr);
      const item = arr && arr.find((x) => x.id === el.dataset.id);
      if (item) {
        item[el.dataset.field] = coerce(el, el.dataset.type);
        state.update(() => {});
        updatePage();
      }
      return;
    }
  }

  function onChange(e) {
    const el = e.target;
    // What-if source/target selects: set id, prefill that holding's growth, remount.
    if (el.tagName === "SELECT" && el.dataset && el.dataset.whatif) {
      const role = el.dataset.whatif; // 'source' | 'target'
      const st = state.get();
      const h = FIRE.engine.holdings(st).find((x) => x.id === el.value);
      st.whatif[role + "Id"] = el.value;
      if (h) st.whatif[role + "Growth"] = h.growth;
      state.update(() => {});
      remountPage();
      return;
    }
    // Inputs/selects that change layout or derived values -> remount.
    if (el.dataset && el.dataset.path && el.dataset.remount) {
      const st = state.get();
      setPath(st, el.dataset.path, coerce(el, el.dataset.type));
      state.update(() => {});
      remountPage();
      return;
    }
    // Selects that change labels/derived structure -> remount to refresh.
    if (el.tagName === "SELECT" && el.dataset && el.dataset.arr) {
      const st = state.get();
      const arr = getArr(st, el.dataset.arr);
      const item = arr && arr.find((x) => x.id === el.dataset.id);
      if (item) { item[el.dataset.field] = el.value; state.update(() => {}); remountPage(); }
      return;
    }
    // Path-bound selects (e.g. default allocation account) -> update, no remount.
    if (el.tagName === "SELECT" && el.dataset && el.dataset.path) {
      const st = state.get();
      setPath(st, el.dataset.path, coerce(el, el.dataset.type));
      state.update(() => {});
      if (el.dataset.remount) remountPage(); else updatePage();
    }
  }

  function onClick(e) {
    const nav = e.target.closest("[data-nav]");
    if (nav) { go(nav.dataset.nav); return; }
    const act = e.target.closest("[data-action]");
    if (act) { handleAction(act.dataset.action, act); return; }
  }

  function onFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try { state.importJSON(String(reader.result)); remountPage(); }
      catch (err) { alert("Invalid plan file: " + err.message); }
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  function cssEscape(s) { return s.replace(/"/g, '\\"'); }

  function applyTheme() {
    const t = state.get().meta.theme === "dark" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", t);
    const btn = document.getElementById("btn-theme");
    if (btn) btn.textContent = t === "dark" ? "☀️ Light" : "🌙 Dark";
  }

  /* ---- Boot --------------------------------------------------------------- */
  async function init() {
    state.load();
    applyTheme();
    renderNav();
    mountPage();
    updateHeader();
    await loadCloudConfig();
    updateCloudUi();
    initGoogleAuth();

    const app = document.getElementById("app");
    app.addEventListener("input", onInput);
    app.addEventListener("change", onChange);
    document.addEventListener("click", onClick);
    document.addEventListener("change", (e) => { if (e.target && e.target.id === "data-file") onFile(e); });

    // Header quick buttons
    document.getElementById("btn-save").addEventListener("click", () => state.download(sanitizeName(state.get().meta.name) + ".json"));
    document.getElementById("btn-load").addEventListener("click", () => { current = "data"; go("data"); });
    const themeBtn = document.getElementById("btn-theme");
    if (themeBtn) themeBtn.addEventListener("click", () => handleAction("toggle-theme", themeBtn));
  }

  FIRE.app = { init, go, updatePage, remountPage };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
