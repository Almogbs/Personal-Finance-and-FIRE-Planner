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
    // Expected when running locally / offline (CORS or no network) — cloud
    // sync is optional, so stay quiet in the console.
    console.warn("Cloud config unavailable (offline/local?):", e && e.message);

    const status = document.getElementById("cloud-config-status");
    if (status) {
      status.textContent = "Cloud sync unavailable (offline or running locally) — everything else works normally.";
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
    const email = FIRE.auth && FIRE.auth.user ? FIRE.auth.user.email : null;
    FIRE.auth.user = null; FIRE.auth.idToken = ""; FIRE.auth.status = "Signed out";
    try {
      if (window.google && window.google.accounts && window.google.accounts.id) {
        // Stop Google from silently re-selecting the same account next time.
        window.google.accounts.id.disableAutoSelect();
        // Revoke the previous grant so the account chooser is shown again
        // (fixes being "stuck" on an old/irrelevant Google account).
        if (email) window.google.accounts.id.revoke(email, () => {});
      }
    } catch (e) { /* GIS not loaded — nothing to clear */ }
    // Re-render a fresh sign-in button.
    initGoogleAuth();
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
    // Never silently reuse a previously chosen account — the user must pick,
    // so the button can't get "stuck" on an old/irrelevant Google account.
    try { window.google.accounts.id.disableAutoSelect(); } catch (e) {}
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
    ["assumptions", "⚙️ Market & Assumptions"],
    ["income", "💰 Income"],
    ["spending", "🛒 Spending"],
    ["accounts", "🏦 Accounts"],
    ["mortgage", "🏠 Mortgage & Real Estate"],
    ["pension", "👵 Pension"],
    ["tracker", "🧾 Tracker"],
    ["projections", "📈 Projections"],
    ["predictions", "🎯 Predictions"],
    ["fire", "🔥 FIRE"],
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
  refreshNumTooltips();

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
      const togo = st.profile.fireAge - st.profile.currentAge;
      const togoLbl = togo <= 0 ? "retired 🎉" : FIRE.ui.fmtAgeYM(togo) + " to go";
      badge.innerHTML =
        '<span class="hdr-metric">Total assets <b>' + FIRE.ui.money(snap.total) + "</b></span>" +
        '<span class="hdr-metric">Liquid (after tax) <b>' + FIRE.ui.money(snap.liquid) + "</b></span>" +
        '<span class="hdr-metric">Retire <b>' + FIRE.ui.eventLabel(st, st.profile.fireAge) + "</b></span>" +
        '<span class="hdr-metric hdr-hide-sm">Total @ retirement <b>' + FIRE.ui.money(p.fireRow ? p.fireRow.total : 0) + "</b></span>" +
        '<span class="hdr-metric hdr-hide-sm"><b>' + togoLbl + "</b></span>" +
        '<span class="hdr-metric">' + (p.survives ? '<span class="ok">✓ survives to ' + st.profile.endAge + "</span>" : '<span class="bad">✕ depletes ' + FIRE.ui.eventLabel(st, p.depletionAge) + "</span>") + "</span>";
    }
    const nameEl = document.getElementById("header-name");
    if (nameEl) nameEl.textContent = st.meta.name;
    applyRealButton();
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
        const lid = FIRE.ui.pages.spending.editListId || st.spending.activeListId;
        st.spending.categories.push({ id: state.uid("cat"), name: "New category", freq: "monthly", monthly: 500, startAge: Math.round(st.profile.currentAge), endAge: st.profile.endAge, growthPct: st.spending.growthPct, inflate: true, listId: lid });
        state.update(() => {}); remountPage(); break;
      }
      case "del-cat": {
        st.spending.categories = st.spending.categories.filter((c) => c.id !== el.dataset.id); state.update(() => {}); remountPage(); break;
      }
      case "sp-edit-list": {
        FIRE.ui.pages.spending.editListId = el.dataset.id; remountPage(); break;
      }
      case "add-list": {
        const l = { id: state.uid("list"), name: "New list" };
        st.spending.lists = st.spending.lists || [];
        st.spending.lists.push(l);
        FIRE.ui.pages.spending.editListId = l.id;
        state.update(() => {}); remountPage(); break;
      }
      case "dup-list": {
        const src = (st.spending.lists || []).find((l) => l.id === el.dataset.id);
        if (!src) break;
        const copy = { id: state.uid("list"), name: src.name + " (copy)" };
        st.spending.lists.push(copy);
        state.listCategories(st, src.id).forEach((c) => {
          const c2 = state.clone(c); c2.id = state.uid("cat"); c2.listId = copy.id;
          st.spending.categories.push(c2);
        });
        FIRE.ui.pages.spending.editListId = copy.id;
        state.update(() => {}); remountPage(); break;
      }
      case "del-list": {
        const lid = el.dataset.id;
        const lists = st.spending.lists || [];
        if (lists.length <= 1) break; // always keep one list
        const doomed = lists.find((l) => l.id === lid);
        const n = state.listCategories(st, lid).length;
        if (!doomed || !confirm('Delete list "' + doomed.name + '" and its ' + n + " categor" + (n === 1 ? "y" : "ies") + "? Steps that pointed to it fall back to the active list.")) break;
        st.spending.lists = lists.filter((l) => l.id !== lid);
        st.spending.categories = st.spending.categories.filter((c) => c.listId !== lid);
        (st.spending.steps || []).forEach((s) => { if (s.listId === lid) s.listId = ""; });
        if (st.spending.activeListId === lid) st.spending.activeListId = st.spending.lists[0].id;
        FIRE.ui.pages.spending.editListId = st.spending.activeListId;
        state.update(() => {}); remountPage(); break;
      }
      case "add-step": {
        st.spending.steps = st.spending.steps || [];
        st.spending.steps.push({ id: state.uid("step"), fromAge: Math.round(st.profile.currentAge) + 2, mode: "amount", listId: "", monthly: st.spending.fireMonthly, freq: "monthly", note: "" });
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
        st.income.grants = (st.income.grants || []).filter((g) => g.id !== el.dataset.id);
        if (FIRE.ui.pages.income.selGrantId === el.dataset.id) FIRE.ui.pages.income.selGrantId = null;
        state.update(() => {}); remountPage(); break;
      }
      case "grant-vests": {
        const pg = FIRE.ui.pages.income;
        pg.selGrantId = pg.selGrantId === el.dataset.id ? null : el.dataset.id;
        remountPage(); break;
      }
      case "add-vest": {
        const g = (st.income.grants || []).find((x) => x.id === el.dataset.grant);
        if (!g) break;
        g.vests = g.vests || [];
        // Default the new event to one year after the latest one (or 1 month
        // from today), same share count as the previous event.
        const last = g.vests.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)))[g.vests.length - 1];
        let d = new Date(FIRE.state.refDate(st));
        if (last && last.date && !isNaN(new Date(last.date).getTime())) { d = new Date(last.date); d.setFullYear(d.getFullYear() + 1); }
        else { d.setMonth(d.getMonth() + 1); }
        g.vests.push({ id: state.uid("vest"), date: d.toISOString().slice(0, 10), shares: last ? (last.shares || 0) : 0 });
        state.update(() => {}); remountPage(); break;
      }
      case "del-vest": {
        const g = (st.income.grants || []).find((x) => x.id === el.dataset.grant);
        if (!g) break;
        g.vests = (g.vests || []).filter((v) => v.id !== el.dataset.id);
        state.update(() => {}); remountPage(); break;
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
      case "toggle-real": {
        st.assumptions.realMode = !st.assumptions.realMode;
        state.update(() => {}); applyRealButton(); remountPage(); break;
      }
      case "add-property": {
        st.realEstate.properties.push(state.newProperty());
        state.update(() => {}); remountPage(); break;
      }
      case "del-property": {
        st.realEstate.properties = st.realEstate.properties.filter((p) => p.id !== el.dataset.id);
        // Loans pointing at the deleted property become standalone.
        st.realEstate.loans.forEach((l) => { if (l.propertyId === el.dataset.id) l.propertyId = ""; });
        state.update(() => {}); remountPage(); break;
      }
      case "add-loan": {
        st.realEstate.loans.push(state.newLoan(st));
        state.update(() => {}); remountPage(); break;
      }
      case "del-loan": {
        st.realEstate.loans = st.realEstate.loans.filter((l) => l.id !== el.dataset.id);
        state.update(() => {}); remountPage(); break;
      }
      case "set-fire-age": {
        const age = parseInt(el.dataset.age, 10);
        if (!isNaN(age)) { st.profile.fireAge = age; state.update(() => {}); remountPage(); }
        break;
      }
      case "fire-scn-toggle": {
        const pg = FIRE.ui.pages.fire;
        if (el.dataset.kind === "coast") pg.showCoastProj = !pg.showCoastProj;
        else pg.showBaristaProj = !pg.showBaristaProj;
        pg.renderScenarioBlock(el.dataset.kind, pageEl);
        // Refresh the toggle button label without recomputing everything.
        el.textContent = "📈 " + ((el.dataset.kind === "coast" ? pg.showCoastProj : pg.showBaristaProj) ? "Hide" : "Show") + " projection";
        el.classList.toggle("ghost");
        break;
      }
      case "find-earliest": {
        const e = FIRE.engine.earliestFireAge(st);
        const out = document.getElementById(el.dataset.target || "earliest-out");
        if (out) {
          if (e.found) {
            const same = e.age === Math.round(st.profile.fireAge);
            out.innerHTML = '<div class="callout"><b>Earliest retirement: age ' + e.age + " — " + FIRE.ui.eventLabel(st, e.age) + "</b> " +
              (e.yearsAway <= 0 ? "(you could retire now 🎉)" : "(" + e.yearsAway + " year" + (e.yearsAway === 1 ? "" : "s") + " away)") +
              " — earliest age at which the plan survives to " + st.profile.endAge + " using your real spending." +
              (same ? " Already set." : ' <button class="btn small" data-action="set-fire-age" data-age="' + e.age + '">Set retirement age to ' + e.age + "</button>") +
              "</div>";
          } else {
            out.innerHTML = '<div class="callout"><span class="bad">No retirement age up to ' + st.profile.endAge + " survives</span> at current spending & assumptions.</div>";
          }
        }
        break;
      }
      case "wd-up":
      case "wd-down": {
        // Swap with the nearest VISIBLE neighbor — kinds hidden from the list
        // (no FIRE-counted account) keep their stored position untouched.
        const kind = el.dataset.kind;
        const ord = st.assumptions.withdrawalOrder || [];
        const eligible = FIRE.ui.fireEligibleKinds(st);
        const visible = ord.filter((k) => eligible[k]);
        const vi = visible.indexOf(kind);
        if (vi < 0) break;
        const vj = action === "wd-up" ? vi - 1 : vi + 1;
        if (vj < 0 || vj >= visible.length) break;
        const i = ord.indexOf(kind), j = ord.indexOf(visible[vj]);
        const tmp = ord[i]; ord[i] = ord[j]; ord[j] = tmp;
        state.update(() => {}); remountPage(); break;
      }
      case "cat-up":
      case "cat-down": {
        // Swap a category with its neighbor WITHIN the same list (positions in
        // the global array are swapped, which preserves every other list's
        // internal order).
        const cats = st.spending.categories || [];
        const cat = cats.find((c) => c.id === el.dataset.id);
        if (!cat) break;
        const lid = cat.listId || st.spending.activeListId;
        const inList = cats.filter((c) => (c.listId || st.spending.activeListId) === lid);
        const vi = inList.indexOf(cat);
        const vj = action === "cat-up" ? vi - 1 : vi + 1;
        if (vj < 0 || vj >= inList.length) break;
        const i = cats.indexOf(cat), j = cats.indexOf(inList[vj]);
        const tmp = cats[i]; cats[i] = cats[j]; cats[j] = tmp;
        state.update(() => {}); remountPage(); break;
      }
      case "save-file": state.download(sanitizeName(st.meta.name) + ".json"); break;
      case "load-file": document.getElementById("data-file").click(); break;
      case "load-sample": loadSample(); break;
      case "reset":
        if (confirm("Reset everything to the default plan? Your current state will be overwritten.")) { state.reset(); remountPage(); }
        break;
      case "export-csv": FIRE.ui.pages.projections.exportCSV(); break;
      case "export-csv-monthly": FIRE.ui.pages.projections.exportMonthlyCSV(); break;
      case "add-month": {
        const inp = document.getElementById("trk-month");
        let ym = inp && inp.value ? inp.value : new Date().toISOString().slice(0, 7);
        st.tracker.months = st.tracker.months || [];
        let m = st.tracker.months.find((x) => x.ym === ym);
        if (!m) { m = { id: state.uid("mo"), ym: ym, entries: {}, note: "" }; st.tracker.months.push(m); }
        FIRE.ui.pages.tracker.selMonthId = m.id;
        state.update(() => {}); remountPage();
        break;
      }
      case "del-month": {
        if (FIRE.ui.pages.tracker.selMonthId === el.dataset.id) FIRE.ui.pages.tracker.selMonthId = null;
        st.tracker.months = (st.tracker.months || []).filter((m) => m.id !== el.dataset.id);
        state.update(() => {}); remountPage(); break;
      }
      case "add-year": {
        const inp = document.getElementById("trk-year");
        const yr = inp && inp.value ? parseInt(inp.value, 10) : FIRE.state.refDate(st).getFullYear();
        if (isNaN(yr)) break;
        st.tracker.years = st.tracker.years || [];
        let y = st.tracker.years.find((x) => x.year === yr);
        if (!y) { y = { id: state.uid("yr"), year: yr, entries: {}, note: "" }; st.tracker.years.push(y); }
        FIRE.ui.pages.tracker.selYearId = y.id;
        state.update(() => {}); remountPage();
        break;
      }
      case "del-year": {
        if (FIRE.ui.pages.tracker.selYearId === el.dataset.id) FIRE.ui.pages.tracker.selYearId = null;
        st.tracker.years = (st.tracker.years || []).filter((y) => y.id !== el.dataset.id);
        state.update(() => {}); remountPage(); break;
      }
      case "trk-month-sel": FIRE.ui.pages.tracker.selMonthId = el.dataset.id; remountPage(); break;
      case "trk-year-sel": FIRE.ui.pages.tracker.selYearId = el.dataset.id; remountPage(); break;
      case "trk-excl": {
        // Toggle a category's exclusion for one specific month/year only.
        const arr = el.dataset.kind === "y" ? st.tracker.years : st.tracker.months;
        const item = (arr || []).find((x) => x.id === el.dataset.item);
        if (!item) break;
        item.excluded = item.excluded || {};
        if (item.excluded[el.dataset.cat]) delete item.excluded[el.dataset.cat];
        else item.excluded[el.dataset.cat] = true;
        state.update(() => {}); remountPage(); break;
      }
      case "save-baseline": savePredictionBaseline(); break;
      case "record-actual": recordActualYear(); break;
      case "add-actual-year": {
        const inp = document.getElementById("pred-add-year");
        const y = inp && inp.value ? parseInt(inp.value, 10) : NaN;
        if (isNaN(y)) break;
        st.predictions.actuals = st.predictions.actuals || {};
        if (!st.predictions.actuals[y]) st.predictions.actuals[y] = { total: 0, perAccount: {}, savedAt: new Date().toISOString() };
        FIRE.ui.pages.predictions.selYear = y;
        state.update(() => {}); remountPage(); break;
      }
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
  function savePredictionBaseline() {
    const st = state.get();
    const p = FIRE.engine.project(st);
    const nowYear = FIRE.state.refDate(st).getFullYear();
    const years = [];
    p.rows.forEach((r) => {
      // Rows are calendar-year aligned — key the baseline by r.year directly.
      if (r.year >= nowYear && years.length < 30) {
        years.push({ year: r.year, age: r.age, total: Math.round(r.total), perAccount: Object.assign({}, r.perAccount) });
      }
    });
    st.predictions.baselineSavedAt = new Date().toISOString();
    st.predictions.accounts = p.accountsMeta.map((a) => ({ id: a.id, name: a.name, kind: a.kind }));
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
    const proxy = (st.live && st.live.corsProxy) || "";
    const grants = (st.income.grants || []).filter((g) => (g.symbol || "").trim());
    if (!grants.length) { setStatus("grants-status", "add a Symbol (e.g. AMZN) to a grant first", "bad"); return; }
    setStatus("grants-status", "fetching " + grants.length + "…");
    let ok = 0; const errs = [];
    for (const g of grants) {
      try { const q = await FIRE.live.fetchQuote(g.symbol, { corsProxy: proxy }); g.sharePrice = Math.round(q.price * 100) / 100; ok++; }
      catch (e) { errs.push(g.symbol + ": " + e.message); }
    }
    state.update(() => {});
    remountPage();
    setStatus("grants-status", (ok ? "✓ updated " + ok : "✕ none updated") + (errs.length ? " · " + errs.join(" · ") : ""), errs.length ? "bad" : "ok");
  }

  function sanitizeName(n) { return String(n || "fire-plan").replace(/[^a-z0-9\-_]+/gi, "-").toLowerCase(); }

  function loadSample() {
    fetch("data/sample-state.json")
      .then((r) => r.text())
      .then((t) => { state.importJSON(t); remountPage(); })
      .catch(() => alert("Could not load sample. If opened via file://, some browsers block fetch. Use 'Load from file' instead."));
  }

  /* ---- Delegated events --------------------------------------------------- */
  // Big numbers are hard to read in a bare <input type=number> — mirror a
  // thousands-separated version into the tooltip.
  function numTooltip(el) {
    if (!el || el.type !== "number") return;
    const n = parseFloat(el.value);
    el.title = isFinite(n) && Math.abs(n) >= 1000 ? "= " + n.toLocaleString("en-US") : "";
  }
  function refreshNumTooltips() {
    if (!pageEl) return;
    pageEl.querySelectorAll('input[type="number"]').forEach(numTooltip);
  }

  function onInput(e) {
    const el = e.target;
    numTooltip(el);
    if (el.id === "cloud-worker-url") { setCloudConfig("cloudApiBaseUrl", el.value); return; }
    // Coast/Barista scenario-age slider (FIRE tab) — page-local, not in state.
    if (el.dataset && el.dataset.fireproj) {
      const v = parseInt(el.value, 10);
      // sync the twin range/number input
      pageEl.querySelectorAll('[data-fireproj="' + el.dataset.fireproj + '"]').forEach((sib) => { if (sib !== el) sib.value = el.value; });
      FIRE.ui.pages.fire.setScenarioAge(el.dataset.fireproj, v, pageEl);
      return;
    }
    // Predictions chart: include/exclude pension toggle (display-only).
    if (el.dataset && el.dataset.predpension != null) {
      FIRE.ui.pages.predictions.showPension = el.checked;
      FIRE.ui.pages.predictions.renderChart(pageEl);
      return;
    }
    // Projections stacked chart: include/exclude pension (display-only).
    if (el.dataset && el.dataset.stackpension != null) {
      FIRE.ui.pages.projections.showPension = el.checked;
      updatePage();
      return;
    }
    // Coast/Barista scenario stacked chart: include/exclude pension.
    if (el.dataset && el.dataset.scnpension) {
      const k = el.dataset.scnpension;
      FIRE.ui.pages.fire.scnShowPension[k] = el.checked;
      const host = pageEl.querySelector(k === "coast" ? "#fire-coast-proj" : "#fire-barista-proj");
      if (host) FIRE.ui.pages.fire.renderScenarioBody(k, host);
      return;
    }
    if (el.id === "cloud-google-client-id") { setCloudConfig("googleClientId", el.value); return; }
    // Expense-tracker cell (month × category).
    if (el.dataset && el.dataset.trkm) {
      const st = state.get();
      const m = (st.tracker.months || []).find((x) => x.id === el.dataset.trkm);
      if (m) { m.entries = m.entries || {}; m.entries[el.dataset.trkc] = coerce(el, "float"); state.update(() => {}); updatePage(); }
      return;
    }
    // Expense-tracker yearly cell (year × category).
    if (el.dataset && el.dataset.trky) {
      const st = state.get();
      const y = (st.tracker.years || []).find((x) => x.id === el.dataset.trky);
      if (y) { y.entries = y.entries || {}; y.entries[el.dataset.trkyc] = coerce(el, "float"); state.update(() => {}); updatePage(); }
      return;
    }
    // Grant vesting-schedule cell (grant × vest event).
    if (el.dataset && el.dataset.vestg) {
      const st = state.get();
      const g = (st.income.grants || []).find((x) => x.id === el.dataset.vestg);
      const v = g && (g.vests || []).find((x) => x.id === el.dataset.vestid);
      if (v) {
        v[el.dataset.vfield] = el.dataset.vfield === "shares" ? coerce(el, "float") : el.value;
        state.update(() => {});
        // Live-refresh everything derived from the schedule (vested count,
        // 📅 button, past/future tags) plus totals/charts — no manual reload.
        if (FIRE.ui.pages.income.refreshVestDerived) FIRE.ui.pages.income.refreshVestDerived(pageEl, g.id);
        updatePage();
      }
      return;
    }
    // Predictions: manually-entered actual balance (year × account).
    if (el.dataset && el.dataset.predy) {
      const st = state.get();
      const y = el.dataset.predy;
      st.predictions.actuals = st.predictions.actuals || {};
      const act = st.predictions.actuals[y] || (st.predictions.actuals[y] = { total: 0, perAccount: {}, savedAt: new Date().toISOString() });
      act.perAccount = act.perAccount || {};
      if (el.value === "") delete act.perAccount[el.dataset.predacc];
      else act.perAccount[el.dataset.predacc] = coerce(el, "float");
      act.total = Object.keys(act.perAccount).reduce((s, k) => s + (act.perAccount[k] || 0), 0);
      act.savedAt = new Date().toISOString();
      state.update(() => {});
      // In-place refresh so the input keeps focus while typing.
      FIRE.ui.pages.predictions.refreshLight(pageEl);
      updateHeader();
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
        if (el.dataset.remount) remountPage(); else updatePage();
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
      if (item) {
        item[el.dataset.field] = el.value;
        // Picking a list on a spending step implies "Use list" mode — the
        // select is always clickable, no need to switch the mode first.
        if (el.dataset.arr === "spending.steps" && el.dataset.field === "listId" && el.value) item.mode = "list";
        state.update(() => {}); remountPage();
      }
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

  /* ---- Drag & drop: spending categories + withdrawal order ----------------
   * Only the ⠿ handles are draggable (so text selection inside inputs still
   * works). Categories can be dropped on another category row (reorder within
   * the list) or on an "Edit list" chip (move to that list). Withdrawal kinds
   * reorder within the visible list.
   *-------------------------------------------------------------------------*/
  let dragCatId = null, dragWdKind = null, dropTargetEl = null;

  function clearDropTarget() {
    if (dropTargetEl) { dropTargetEl.classList.remove("drop-target"); dropTargetEl = null; }
  }
  function dropTargetFor(e) {
    if (dragCatId) {
      return e.target.closest("[data-catrow]") || e.target.closest('[data-action="sp-edit-list"]');
    }
    if (dragWdKind) return e.target.closest("[data-wdrow]");
    return null;
  }
  function onDragStart(e) {
    const cat = e.target.closest && e.target.closest("[data-dragcat]");
    const wd = e.target.closest && e.target.closest("[data-dragwd]");
    if (cat) { dragCatId = cat.dataset.dragcat; }
    else if (wd) { dragWdKind = wd.dataset.dragwd; }
    else return;
    if (e.dataTransfer) { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", dragCatId || dragWdKind); }
    const row = e.target.closest("[data-catrow],[data-wdrow]");
    if (row) row.classList.add("dragging");
  }
  function onDragOver(e) {
    const t = dropTargetFor(e);
    if (!t) { clearDropTarget(); return; }
    e.preventDefault(); // allow dropping here
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    if (t !== dropTargetEl) { clearDropTarget(); dropTargetEl = t; t.classList.add("drop-target"); }
  }
  function onDrop(e) {
    const t = dropTargetFor(e);
    clearDropTarget();
    if (!t) return;
    e.preventDefault();
    const st = state.get();
    if (dragCatId) {
      const cats = st.spending.categories || [];
      const cat = cats.find((c) => c.id === dragCatId);
      dragCatId = null; dragWdKind = null;
      if (!cat) return;
      const chip = t.closest && t.closest('[data-action="sp-edit-list"]');
      if (chip) {
        // Move the category to the dropped-on list.
        if (cat.listId !== chip.dataset.id) { cat.listId = chip.dataset.id; state.update(() => {}); remountPage(); }
        return;
      }
      const targetCat = cats.find((c) => c.id === t.dataset.catrow);
      if (!targetCat || targetCat === cat) return;
      // Reorder: pull the dragged category out and re-insert next to the
      // target — after it when dragging down, before it when dragging up.
      // Moving one item never disturbs the other lists' relative order.
      const fromIdx = cats.indexOf(cat), toIdx = cats.indexOf(targetCat);
      cats.splice(fromIdx, 1);
      cats.splice(cats.indexOf(targetCat) + (fromIdx < toIdx ? 1 : 0), 0, cat);
      state.update(() => {}); remountPage();
      return;
    }
    if (dragWdKind) {
      const ord = st.assumptions.withdrawalOrder || [];
      const from = ord.indexOf(dragWdKind);
      const to = ord.indexOf(t.dataset.wdrow);
      dragCatId = null; dragWdKind = null;
      if (from < 0 || to < 0 || from === to) return;
      const [k] = ord.splice(from, 1);
      ord.splice(to, 0, k);
      state.update(() => {}); remountPage();
    }
  }
  function onDragEnd() {
    clearDropTarget();
    dragCatId = null; dragWdKind = null;
    document.querySelectorAll(".dragging").forEach((n) => n.classList.remove("dragging"));
  }

  function applyTheme() {
    const t = state.get().meta.theme === "dark" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", t);
    const btn = document.getElementById("btn-theme");
    if (btn) btn.textContent = t === "dark" ? "☀️ Light" : "🌙 Dark";
  }
  function applyRealButton() {
    const btn = document.getElementById("btn-real");
    if (btn) btn.textContent = state.get().assumptions.realMode ? "₪ Real (today's)" : "₪ Nominal";
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
    app.addEventListener("dragstart", onDragStart);
    app.addEventListener("dragover", onDragOver);
    app.addEventListener("drop", onDrop);
    app.addEventListener("dragend", onDragEnd);
    document.addEventListener("click", onClick);
    document.addEventListener("change", (e) => { if (e.target && e.target.id === "data-file") onFile(e); });

    // Header quick buttons
    const themeBtn = document.getElementById("btn-theme");
    if (themeBtn) themeBtn.addEventListener("click", () => handleAction("toggle-theme", themeBtn));
    const realBtn = document.getElementById("btn-real");
    if (realBtn) realBtn.addEventListener("click", () => handleAction("toggle-real", realBtn));
    applyRealButton();
  }

  FIRE.app = { init, go, updatePage, remountPage };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
