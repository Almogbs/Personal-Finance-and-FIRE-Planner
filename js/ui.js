/* =============================================================================
 * ui.js  —  Rendering: controls, pages, tables, charts wiring
 * -----------------------------------------------------------------------------
 * Each page is { mount(el), update(el) }:
 *   mount  = build the controls once (on page switch / structural change)
 *   update = recompute projection, refresh outputs + charts (on every input)
 * Inputs carry data-path (dot path into state) and data-type for a delegated
 * handler in app.js. Arrays use data-arr/data-id/data-field.
 * ===========================================================================*/
(function () {
  "use strict";
  const FIRE = (window.FIRE = window.FIRE || {});
  const S = () => FIRE.state.get();
  const C = FIRE.charts;

  /* ---- Formatting --------------------------------------------------------- */
  function money(n, cur) {
    if (n == null || isNaN(n)) return "–";
    const s = Math.round(n).toLocaleString("en-US");
    return (cur === "USD" ? "$" : "₪") + s;
  }
  function pct(n) { return (n == null || isNaN(n)) ? "–" : n.toFixed(1) + "%"; }

  /* ---- Path helpers ------------------------------------------------------- */
  function getPath(obj, path) {
    return path.split(".").reduce((o, k) => (o == null ? o : o[k]), obj);
  }

  /* ---- Control builders (return HTML strings) ----------------------------- */
  function ctl(label, path, opts) {
    opts = opts || {};
    const min = opts.min != null ? opts.min : 0;
    const max = opts.max != null ? opts.max : 100;
    const step = opts.step != null ? opts.step : 1;
    const type = opts.type || "float";
    const suffix = opts.suffix || "";
    const val = getPath(S(), path);
    const slider = opts.slider !== false;
    return (
      '<div class="control">' +
        '<label>' + label + (suffix ? ' <span class="suffix">(' + suffix + ")</span>" : "") + "</label>" +
        '<div class="ctl-row">' +
          (slider ? '<input type="range" data-path="' + path + '" data-type="' + type + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + val + '">' : "") +
          '<input type="number" class="num" data-path="' + path + '" data-type="' + type + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + val + '">' +
        "</div>" +
      "</div>"
    );
  }
  function toggle(label, path) {
    const val = !!getPath(S(), path);
    return (
      '<label class="switch"><input type="checkbox" data-path="' + path + '" data-type="bool"' + (val ? " checked" : "") + "> " + label + "</label>"
    );
  }
  function card(title, valueHtml, sub) {
    return '<div class="metric"><div class="metric-title">' + title + '</div><div class="metric-value">' + valueHtml + "</div>" + (sub ? '<div class="metric-sub">' + sub + "</div>" : "") + "</div>";
  }

  const KINDS = [
    ["cash", "Cash"], ["money_market", "Money market"], ["taxable", "Taxable brokerage"],
    ["study_fund", "Keren Hishtalmut"], ["pension", "Pension"], ["rsu", "RSU / equity"], ["custom", "Custom"],
  ];
  function kindLabel(k) { const f = KINDS.find((x) => x[0] === k); return f ? f[1] : k; }

  // A monthly/yearly frequency dropdown bound to an array item's `freq` field.
  function freqSelect(arr, id, freq) {
    return '<select data-arr="' + arr + '" data-id="' + id + '" data-field="freq" data-type="text">' +
      [["monthly", "month"], ["yearly", "year"]].map((o) =>
        '<option value="' + o[0] + '"' + ((freq || "monthly") === o[0] ? " selected" : "") + ">/ " + o[1] + "</option>").join("") +
      "</select>";
  }

  /* ============================ DASHBOARD ================================= */
  const dashboard = {
    mount(el) {
      el.innerHTML =
        '<h1>Dashboard</h1>' +
        '<p class="lead">Your personal-finance workbench — track <b>expenses</b>, manage your <b>portfolio &amp; allocation</b>, and project <b>FIRE</b>. Tweak anything on the other pages and watch this update.</p>' +
        '<div class="metric-grid" id="dash-metrics"></div>' +
        '<div class="grid-2">' +
          '<div class="panel"><h3>Net worth to age 80</h3><canvas id="dash-nw" height="260"></canvas></div>' +
          '<div class="panel"><h3>Current allocation</h3><canvas id="dash-alloc" height="260"></canvas></div>' +
        "</div>" +
        '<div class="grid-2">' +
          '<div class="panel"><h3>Liquid vs pension over time</h3><canvas id="dash-lp" height="260"></canvas></div>' +
          '<div class="panel"><h3>Retirement readiness</h3>' +
            '<div class="toolbar"><button class="btn small" data-action="find-earliest" data-target="dash-earliest">🔎 Find earliest retirement age</button></div>' +
            '<div id="dash-earliest"></div>' +
            '<div style="margin-bottom:10px">' + toggle("Auto-calculate earliest possible retirement age", "assumptions.showMinFireAge") + "</div>" +
            '<div id="dash-minfire"></div>' +
            '<div id="dash-fire"></div></div>' +
        "</div>";
      this.update(el);
    },
    update(el) {
      const st = S();
      const p = FIRE.engine.project(st);
      const snap = p.snapshot;
      const real = st.assumptions.realMode;
      const adj = (v, k) => (real ? v / Math.pow(1 + st.assumptions.inflation / 100, k) : v);

      const m = el.querySelector("#dash-metrics");
      m.innerHTML =
        card("Current net worth", money(snap.total), "incl. pension & vested RSU") +
        card("Liquid (excl. pension)", money(snap.nonPension), "spendable before 60") +
        card("Pension", money(snap.pension), "locked until " + st.profile.pensionAccessAge) +
        (function () {
          const faR = Math.round(st.profile.fireAge);
          const spMo = FIRE.engine.monthlySpend(st, faR);
          return card("Retirement spend @ " + st.profile.fireAge, money(spMo) + "/mo", "your real modeled spend at that age");
        })() +
        card("Plan status", p.survives ? '<span class="ok">Survives to 80</span>' : '<span class="bad">Depletes @ ' + p.depletionAge + "</span>", "at retirement age " + st.profile.fireAge) +
        (function () {
          const yrs = p.endAge - p.A0;
          const nom = p.endNetWorth, rl = nom / Math.pow(1 + st.assumptions.inflation / 100, yrs);
          return card("Net worth @ 80", money(real ? rl : nom),
            real ? ("nominal " + money(nom)) : ("≈ " + money(rl) + " in today's ₪"));
        })() +
        card("Years to retirement", String(Math.max(0, Math.round(st.profile.fireAge) - p.A0)), "from age " + p.A0 + " to " + Math.round(st.profile.fireAge)) +
        (function () {
          const r0 = p.rows[0]; const inc = r0.salary + r0.extra;
          const sr = inc > 0 ? ((inc - r0.spend) / inc) * 100 : 0;
          return card("Savings rate (now)", (sr > 0 ? sr.toFixed(0) : "0") + "%", "of current take-home income");
        })() +
        (function () {
          const fr = p.fireRow; const nom = fr ? fr.total : 0;
          const rl = fr ? nom / Math.pow(1 + st.assumptions.inflation / 100, fr.k) : 0;
          return card("Net worth @ retirement", money(real ? rl : nom), "age " + Math.round(st.profile.fireAge) + (real ? " (today's ₪)" : ""));
        })() +
        (function () {
          const fr = p.fireRow; const spYr = FIRE.engine.monthlySpend(st, Math.round(st.profile.fireAge)) * 12;
          const wr = fr && fr.nonPension > 0 ? (spYr / fr.nonPension) * 100 : 0;
          return card("Withdrawal rate @ retirement", wr > 0 ? wr.toFixed(1) + "%" : "–", "real spend ÷ non-pension assets");
        })();

      // Net worth line
      const labels = p.rows.map((r) => r.age);
      C.line(el.querySelector("#dash-nw"), {
        labels,
        series: [
          { name: real ? "Total (real)" : "Total", data: p.rows.map((r) => adj(r.total, r.k)), color: "#2f7ed8" },
          { name: "Liquid", data: p.rows.map((r) => adj(r.liquid, r.k)), color: "#59a14f" },
        ],
      });

      // Allocation pie (by kind)
      const byKind = {};
      snap.accounts.forEach((a) => (byKind[a.kind] = (byKind[a.kind] || 0) + a.valueILS));
      C.pie(el.querySelector("#dash-alloc"), {
        doughnut: true,
        slices: Object.keys(byKind).map((k) => ({ name: kindLabel(k), value: byKind[k] })),
      });

      // Liquid vs pension stacked
      C.bar(el.querySelector("#dash-lp"), {
        labels,
        stacked: true,
        series: [
          { name: "Liquid/non-pension", data: p.rows.map((r) => adj(r.nonPension, r.k)), color: "#76b7b2" },
          { name: "Pension", data: p.rows.map((r) => adj(r.pension, r.k)), color: "#b07aa1" },
        ],
      });

      // Retirement readiness — based on your REAL projected spending, not a
      // theoretical SWR target (that lives on the FIRE tab).
      const fireRow = p.fireRow;
      const faR = Math.round(st.profile.fireAge);
      const spMo = FIRE.engine.monthlySpend(st, faR);
      const spYr = spMo * 12;
      const nonPen = fireRow ? fireRow.nonPension : 0;
      const runway = spYr > 0 ? nonPen / spYr : 0;
      el.querySelector("#dash-fire").innerHTML =
        "<p>At retirement age <b>" + st.profile.fireAge + "</b>, projected non-pension assets are <b>" + money(nonPen) + "</b>.</p>" +
        "<p>Your modeled spending that year is <b>" + money(spMo) + "/mo</b> (" + money(spYr) + "/yr) — from your real categories &amp; steps.</p>" +
        "<p>That pot alone covers ≈ <b>" + runway.toFixed(0) + "×</b> your first retirement year (before further growth &amp; pension).</p>" +
        '<div class="callout">' + (p.survives ? '<span class="ok">✓ Plan survives to ' + st.profile.endAge + "</span>" : '<span class="bad">✕ Depletes at age ' + p.depletionAge + "</span>") + " at retirement age " + st.profile.fireAge + ", using your real spending.</div>" +
        "<p>Pension at " + p.pension.accessAge + ": gross <b>" + money(p.pension.grossMonthly) + "/mo</b>, net after tax <b>" + money(p.pension.netMonthly) + "/mo</b> (≈ " + money(p.pension.netMonthlyReal) + "/mo in today's ₪). See the Pension page for the breakdown.</p>" +
        '<p class="hint">The theoretical SWR portfolio target (fixed spend ÷ SWR) lives on the <b>🔥 FIRE</b> tab.</p>';

      // Optional: earliest survivable retirement age.
      const mf = el.querySelector("#dash-minfire");
      if (mf) {
        if (st.assumptions.showMinFireAge) {
          const e = FIRE.engine.earliestFireAge(st);
          if (e.found) {
            const isNow = e.yearsAway <= 0;
            mf.innerHTML =
              '<div class="callout"><b>Earliest possible retirement age: ' + e.age + "</b> " +
              (isNow ? "(you could retire now 🎉)" : "(" + e.yearsAway + " year" + (e.yearsAway === 1 ? "" : "s") + " from now)") +
              " — earliest age at which the plan survives to " + st.profile.endAge + " at current spending & assumptions." +
              (e.age !== Math.round(st.profile.fireAge) ? ' <button class="btn small" data-action="set-fire-age" data-age="' + e.age + '">Set retirement age to ' + e.age + "</button>" : "") +
              "</div>";
          } else {
            mf.innerHTML = '<div class="callout"><span class="bad">No retirement age up to ' + st.profile.endAge + " survives</span> with current spending & assumptions. Lower spending, raise returns/income, or extend the horizon.</div>";
          }
        } else {
          mf.innerHTML = "";
        }
      }
    },
  };

  /* ============================ ACCOUNTS ================================= */
  const accounts = {
    mount(el) {
      const st = S();
      const snap = FIRE.engine.snapshot(st);
      const valById = {};
      snap.accounts.forEach((a) => (valById[a.id] = a.valueILS));

      // Group accounts by their group field (preserve first-seen order).
      const groups = [];
      const gmap = {};
      st.accounts.forEach((a) => {
        const g = a.group || kindLabel(a.kind);
        if (!gmap[g]) { gmap[g] = []; groups.push(g); }
        gmap[g].push(a);
      });

      let groupsHtml = groups.map((g) => {
        const items = gmap[g];
        const gTotal = items.reduce((s, a) => s + (valById[a.id] || 0), 0);
        return (
          '<div class="acc-group">' +
            '<div class="acc-group-head"><h3>' + escapeHtml(g) + "</h3><span class=\"acc-group-total\">" + money(gTotal) + "</span></div>" +
            '<div class="acc-cards">' + items.map((a) => this.card(a, valById[a.id] || 0)).join("") + "</div>" +
          "</div>"
        );
      }).join("");

      // Computed grant cards (read-only; driven by the Income page).
      const gv = snap.grants;
      const rsuCard = gv && gv.per.some((pg) => pg.gross > 0) ? (
        '<div class="acc-group">' +
          '<div class="acc-group-head"><h3>Equity — grants (computed)</h3><span class="acc-group-total">' + money(gv.net) + "</span></div>" +
          '<div class="acc-cards">' +
            gv.per.filter((pg) => pg.gross > 0).map((pg) =>
              '<div class="acc-card computed">' +
                '<div class="acc-head"><b>' + escapeHtml(pg.grant.name) + " (vested net)</b><span class=\"acc-val\">" + money(pg.net) + "</span></div>" +
                '<p class="hint">Gross ' + money(pg.gross) + " · tax " + money(pg.tax) + ". " +
                (pg.grant.vestedShares || 0).toLocaleString() + " vested shares @ " + (pg.grant.currency === "ILS" ? "₪" : "$") + pg.grant.sharePrice + ". " +
                "Edit on the <b>Income</b> page; future vests added automatically.</p>" +
              "</div>").join("") +
          "</div>" +
        "</div>"
      ) : "";

      el.innerHTML =
        "<h1>Accounts</h1>" +
        '<p class="lead">Every pot of money, grouped and individually controlled. Edit balances, return predictions, contributions, notes — or add/remove accounts.</p>' +
        '<div class="toolbar">' +
          KINDS.map((k) => '<button class="btn small" data-action="add-account" data-kind="' + k[0] + '">+ ' + k[1] + "</button>").join("") +
        "</div>" +
        groupsHtml + rsuCard +
        '<div class="grid-2">' +
          '<div class="panel"><h3>Allocation by account</h3><canvas id="acc-pie" height="280"></canvas></div>' +
          '<div class="panel"><h3>Allocation by type</h3><canvas id="acc-kind" height="280"></canvas></div>' +
        "</div>" +
        '<div class="grid-2">' +
          '<div class="panel"><h3>Brokerage accounts</h3><canvas id="acc-brokerage" height="280"></canvas><p class="hint" id="acc-brokerage-empty"></p></div>' +
          '<div class="panel"><h3>Brokerage: cost basis vs gains</h3><canvas id="acc-brokerage-gain" height="280"></canvas><p class="hint" id="acc-brokerage-gain-empty"></p></div>' +
        "</div>";
      this.update(el);
    },
    card(a, valILS) {
      const A = (field, label, val, step, opts) => {
        opts = opts || {};
        return '<label class="acc-f"><span>' + label + "</span>" +
          '<input class="num" data-arr="accounts" data-id="' + a.id + '" data-field="' + field + '" data-type="' + (opts.type || "float") + '" type="number" step="' + (step || 1) + '" value="' + val + '"></label>';
      };
      const kindSel = '<select data-arr="accounts" data-id="' + a.id + '" data-field="kind" data-type="text">' +
        KINDS.map((k) => '<option value="' + k[0] + '"' + (a.kind === k[0] ? " selected" : "") + ">" + k[1] + "</option>").join("") + "</select>";
      const curSel = '<select data-arr="accounts" data-id="' + a.id + '" data-field="currency" data-type="text">' +
        ["ILS", "USD"].map((c) => "<option" + (a.currency === c ? " selected" : "") + ">" + c + "</option>").join("") + "</select>";
      const chk = (field, label, on) => '<label class="acc-chk"><input type="checkbox" data-arr="accounts" data-id="' + a.id + '" data-field="' + field + '" data-type="bool"' + (on ? " checked" : "") + "> " + label + "</label>";
      // Taxable holdings: show the buying value implied by the gain% and the
      // gain that capital-gains tax will apply to (losses => no CG tax).
      let cgHint = "";
      if (a.kind === "taxable") {
        const cur = a.currency;
        const basisOwn = FIRE.state.costBasisOf(a);
        const gain = (a.balance || 0) - basisOwn;
        const taxGain = Math.max(0, gain);
        cgHint = '<p class="hint">Buy value ≈ ' + money(basisOwn, cur) + " · " +
          (gain >= 0 ? "gain " : "loss ") + money(Math.abs(gain), cur) +
          " · CG tax on " + money(taxGain, cur) + " @ " + (a.capGainsRate || 0) + "%.</p>";
      }
      return (
        '<div class="acc-card">' +
          '<div class="acc-head">' +
            '<input class="acc-name" data-arr="accounts" data-id="' + a.id + '" data-field="name" data-type="text" value="' + escapeHtml(a.name) + '">' +
            '<span class="acc-val">' + money(valILS) + (a.currency === "USD" ? ' <span class="sub">($' + Math.round(a.balance).toLocaleString() + ")</span>" : "") + "</span>" +
            '<button class="btn danger small" data-action="del-account" data-id="' + a.id + '" title="Delete">✕</button>' +
          "</div>" +
          '<div class="acc-fields">' +
            '<label class="acc-f"><span>Type</span>' + kindSel + "</label>" +
            '<label class="acc-f"><span>Currency</span>' + curSel + "</label>" +
            A("balance", "Balance", a.balance, 100) +
            A("expectedReturn", "Return % (prediction)", a.expectedReturn, 0.1) +
            A("monthlyContribution", "Monthly contribution", a.monthlyContribution, 50) +
            A("contributionGrowthPct", "Contrib growth %/yr", a.contributionGrowthPct, 0.1) +
            A("accessAge", "Access age", a.accessAge, 1, { type: "int" }) +
            A("capGainsRate", "Cap-gains %", a.capGainsRate, 1) +
            (a.kind === "taxable" ? A("gainPct", "Gain vs buy value %", a.gainPct == null ? 0 : a.gainPct, 1) : "") +
            (a.kind === "pension" ? A("feeDeposit", "Mgmt fee — deposit %", a.feeDeposit, 0.01) : "") +
            (a.kind === "pension" || a.kind === "study_fund" ? A("feeBalance", "Mgmt fee — balance %/yr", a.feeBalance, 0.01) : "") +
            '<label class="acc-f"><span>Group</span><input data-arr="accounts" data-id="' + a.id + '" data-field="group" data-type="text" value="' + escapeHtml(a.group || "") + '"></label>' +
          "</div>" +
          '<div class="acc-flags">' + chk("liquid", "Liquid", a.liquid) + chk("includeInFire", "Count in FIRE", a.includeInFire) + "</div>" +
          cgHint +
          '<input class="acc-notes" data-arr="accounts" data-id="' + a.id + '" data-field="notes" data-type="text" placeholder="Notes…" value="' + escapeHtml(a.notes || "") + '">' +
        "</div>"
      );
    },
    update(el) {
      const st = S();
      const snap = FIRE.engine.snapshot(st);
      C.pie(el.querySelector("#acc-pie"), { slices: snap.accounts.map((a) => ({ name: a.name, value: a.valueILS })) });
      const byKind = {};
      snap.accounts.forEach((a) => (byKind[a.kind] = (byKind[a.kind] || 0) + a.valueILS));
      C.pie(el.querySelector("#acc-kind"), { doughnut: true, slices: Object.keys(byKind).map((k) => ({ name: kindLabel(k), value: byKind[k] })) });

      // Brokerage-only breakdown: value per taxable account, and the split of
      // total brokerage value into invested cost basis vs. taxable gains.
      const usdIls = st.market.usdIls;
      const taxable = st.accounts.filter((a) => a.kind === "taxable");
      const brokCanvas = el.querySelector("#acc-brokerage");
      const brokEmpty = el.querySelector("#acc-brokerage-empty");
      const gainCanvas = el.querySelector("#acc-brokerage-gain");
      const gainEmpty = el.querySelector("#acc-brokerage-gain-empty");
      const brokSlices = taxable
        .map((a) => ({ name: a.name, value: a.currency === "USD" ? a.balance * usdIls : (a.balance || 0) }))
        .filter((s) => s.value > 0);
      if (brokSlices.length) {
        if (brokEmpty) brokEmpty.textContent = "";
        C.pie(brokCanvas, { doughnut: true, slices: brokSlices });
        let basisTot = 0, gainTot = 0;
        taxable.forEach((a) => {
          const fx = a.currency === "USD" ? usdIls : 1;
          const val = (a.balance || 0) * fx;
          const basis = FIRE.state.costBasisOf(a) * fx;
          basisTot += Math.min(basis, val);
          gainTot += Math.max(0, val - basis);
        });
        C.pie(gainCanvas, { doughnut: true, slices: [
          { name: "Cost basis (invested)", value: basisTot, color: "#4e79a7" },
          { name: "Taxable gains", value: gainTot, color: "#59a14f" },
        ] });
        if (gainEmpty) gainEmpty.textContent = gainTot > 0
          ? "Capital-gains tax applies only to the green slice when you sell."
          : "No unrealized gains — no capital-gains tax on a sale right now.";
      } else {
        if (brokCanvas) brokCanvas.getContext("2d").clearRect(0, 0, brokCanvas.width, brokCanvas.height);
        if (gainCanvas) gainCanvas.getContext("2d").clearRect(0, 0, gainCanvas.width, gainCanvas.height);
        if (brokEmpty) brokEmpty.textContent = "No brokerage (taxable) accounts yet. Add one above to see the breakdown.";
        if (gainEmpty) gainEmpty.textContent = "";
      }
    },
  };

  /* ==================== MARKET & ASSUMPTIONS ============================= */
  const assumptions = {
    mount(el) {
      const wdOrder = (S().assumptions.withdrawalOrder || []);
      const wdHtml =
        '<div class="panel"><h3>Withdrawal order in retirement</h3>' +
          '<p class="hint">When spending exceeds income in retirement, your accounts are drained in this order — the top is spent first. Drag priority with the arrows. <b>Pension</b> is only ever tapped after its access age (or when not annuitized), and accounts you un-tick from <b>“Count in FIRE”</b> on the Accounts page are never drawn down.</p>' +
          '<ol class="wd-order">' +
            wdOrder.map((k, i) =>
              '<li><span class="wd-kind">' + kindLabel(k) + "</span>" +
                '<span class="wd-btns">' +
                  '<button class="btn small" data-action="wd-up" data-kind="' + k + '"' + (i === 0 ? " disabled" : "") + ' title="Move up">↑</button>' +
                  '<button class="btn small" data-action="wd-down" data-kind="' + k + '"' + (i === wdOrder.length - 1 ? " disabled" : "") + ' title="Move down">↓</button>' +
                "</span></li>").join("") +
          "</ol>" +
        "</div>";
      el.innerHTML =
        "<h1>Market & Assumptions</h1>" +
        '<p class="lead">Global levers. Drag the sliders — the whole plan recalculates instantly.</p>' +
        '<div class="grid-2">' +
        '<div class="panel"><h3>Market</h3>' +
          ctl("USD / ILS exchange rate", "market.usdIls", { min: 2.5, max: 4.5, step: 0.001 }) +
          '<div class="toolbar"><button class="btn small" data-action="fetch-fx">↻ Fetch live USD/ILS</button><span id="fx-status" class="hint"></span></div>' +
          '<p class="hint">Live fetch is optional and only runs when you click. Share prices for equity grants are set per grant on the Income page.</p>' +
        "</div>" +
        '<div class="panel"><h3>Ages</h3>' +
          '<div class="control"><label>Date of birth</label><div class="ctl-row"><input type="date" data-path="profile.birthDate" data-type="text" data-remount="1" value="' + escapeHtml(S().profile.birthDate || "") + '"></div></div>' +
          '<div class="control"><label>As-of date <span class="suffix">(blank = today)</span></label><div class="ctl-row">' +
            '<input type="date" data-path="profile.dateOverride" data-type="text" data-remount="1" value="' + escapeHtml(S().profile.dateOverride || "") + '">' +
            '<button class="btn small" data-action="fetch-date">↻ From internet</button></div>' +
            '<span id="date-status" class="hint"></span></div>' +
          '<div class="callout" id="age-out"></div>' +
          ctl("Retirement age", "profile.fireAge", { min: 30, max: 70, step: 1, type: "int" }) +
          '<div class="toolbar"><button class="btn small" data-action="find-earliest" data-target="asm-earliest">🔎 Find earliest retirement age</button></div>' +
          '<div id="asm-earliest"></div>' +
          ctl("Pension access age", "profile.pensionAccessAge", { min: 55, max: 70, step: 1, type: "int" }) +
          ctl("Projection end age", "profile.endAge", { min: 70, max: 100, step: 1, type: "int" }) +
        "</div>" +
        "</div>" +
        '<div class="grid-2">' +
        '<div class="panel"><h3>Economy</h3>' +
          ctl("Inflation (annual)", "assumptions.inflation", { min: 0, max: 10, step: 0.1, suffix: "%" }) +
          ctl("Pension annuity coefficient", "assumptions.pensionAnnuityCoefficient", { min: 150, max: 260, step: 1, type: "int" }) +
          '<div style="margin-top:10px">' + toggle("Show values in real (today's ₪) terms", "assumptions.realMode") + "</div>" +
          '<p class="hint">The safe withdrawal rate now lives on the <b>🔥 FIRE</b> tab.</p>' +
        "</div>" +
        '<div class="panel"><h3>Default expected returns by type (%)</h3>' +
          ctl("Cash", "assumptions.defaultReturns.cash", { min: 0, max: 10, step: 0.1, suffix: "%" }) +
          ctl("Money market", "assumptions.defaultReturns.money_market", { min: 0, max: 10, step: 0.1, suffix: "%" }) +
          ctl("Taxable brokerage", "assumptions.defaultReturns.taxable", { min: 0, max: 15, step: 0.1, suffix: "%" }) +
          ctl("Keren Hishtalmut", "assumptions.defaultReturns.study_fund", { min: 0, max: 15, step: 0.1, suffix: "%" }) +
          ctl("Pension", "assumptions.defaultReturns.pension", { min: 0, max: 12, step: 0.1, suffix: "%" }) +
          ctl("RSU / equity appreciation", "assumptions.defaultReturns.rsu", { min: 0, max: 20, step: 0.1, suffix: "%" }) +
          '<p class="hint">These seed new accounts and drive future RSU vest valuation. Existing accounts keep their own return on the Accounts page.</p>' +
        "</div>" +
        "</div>" +
        '<div class="panel"><h3>Israeli payroll rates (gross → net)</h3>' +
          '<div class="grid-2">' +
          "<div>" +
          ctl("Credit-point value ₪/mo", "assumptions.payroll.creditPointValue", { min: 0, max: 400, step: 1 }) +
          ctl("NI+health reduced rate", "assumptions.payroll.niReducedRate", { min: 0, max: 15, step: 0.1, suffix: "%" }) +
          ctl("NI+health full rate", "assumptions.payroll.niFullRate", { min: 0, max: 20, step: 0.1, suffix: "%" }) +
          ctl("NI reduced-rate threshold ₪/mo", "assumptions.payroll.niThresholdMonthly", { min: 0, max: 20000, step: 10 }) +
          ctl("NI ceiling ₪/mo", "assumptions.payroll.niCeilingMonthly", { min: 0, max: 80000, step: 10 }) +
          "</div><div>" +
          ctl("Pension employee %", "assumptions.payroll.pensionEmployeePct", { min: 0, max: 12, step: 0.1, suffix: "%" }) +
          ctl("Pension employer %", "assumptions.payroll.pensionEmployerPct", { min: 0, max: 12, step: 0.1, suffix: "%" }) +
          ctl("Severance %", "assumptions.payroll.severancePct", { min: 0, max: 12, step: 0.1, suffix: "%" }) +
          ctl("Pension ceiling ₪/mo (0 = none)", "assumptions.payroll.pensionCeilingMonthly", { min: 0, max: 80000, step: 100 }) +
          ctl("Keren Hishtalmut employee %", "assumptions.payroll.khEmployeePct", { min: 0, max: 5, step: 0.1, suffix: "%" }) +
          ctl("Keren Hishtalmut employer %", "assumptions.payroll.khEmployerPct", { min: 0, max: 10, step: 0.1, suffix: "%" }) +
          ctl("Keren Hishtalmut ceiling ₪/mo (0 = none)", "assumptions.payroll.khCeilingMonthly", { min: 0, max: 60000, step: 10 }) +
          "</div></div>" +
          '<p class="hint">Used when salary is entered as <b>gross</b> on the Income page. Public 2026 references: credit point ≈ ₪242/mo; NI+health ≈ 3.5% up to ~₪7,522/mo then ≈ 12% to ~₪49,030; pension 6%+6.5%+6%; Keren Hishtalmut 2.5%+7.5% (ceiling ₪15,712). Verify with your payslip.</p>' +
        "</div>" +
        wdHtml;
      this.update(el);
    },
    update(el) {
      const st = S();
      // Computed-age readout.
      const ageOut = el.querySelector("#age-out");
      if (ageOut) {
        if (st.profile.birthDate) {
          const asOf = FIRE.state.refDate(st);
          const a = FIRE.state.ageFromDob(st);
          ageOut.innerHTML = "Current age: <b>" + a.toFixed(2) + "</b> (as of " + asOf.toISOString().slice(0, 10) +
            (st.profile.dateOverride ? ", manual" : ", today") + "). Projections start at age " + Math.round(a) + ".";
        } else {
          ageOut.innerHTML = "No birth date set — using current age <b>" + st.profile.currentAge + "</b>. Add a date of birth above to derive it.";
        }
      }
    },
  };

  /* ============================ INCOME =================================== */
  const income = {
    mount(el) {
      const st = S();
      el.innerHTML =
        "<h1>Income</h1>" +
        '<p class="lead">Salary, RSUs, extra income, and how each year\'s surplus is split across your accounts.</p>' +
        '<div class="grid-2">' +
        '<div class="panel"><h3>Salary</h3>' +
          '<div class="control"><label>Salary input mode</label><div class="ctl-row"><select data-path="income.salaryMode" data-type="text" data-remount="1">' +
            [["gross", "Gross → compute net & deposits"], ["net", "Net take-home (manual deposits)"]].map((m) => '<option value="' + m[0] + '"' + (st.income.salaryMode === m[0] ? " selected" : "") + ">" + m[1] + "</option>").join("") +
          "</select></div></div>" +
          (st.income.salaryMode === "gross"
            ? ctl("Gross monthly salary", "income.grossMonthly", { min: 0, max: 120000, step: 100 }) +
              ctl("Taxable cash extras / mo (travel, phone…)", "income.taxableExtrasMonthly", { min: 0, max: 20000, step: 50 }) +
              ctl("Taxable imputations / mo (זקיפות)", "income.taxableImputationsMonthly", { min: 0, max: 20000, step: 50 }) +
              ctl("Credit points (נקודות זיכוי)", "income.creditPoints", { min: 0, max: 10, step: 0.25 }) +
              '<h3 style="margin-top:16px">Contribution rates</h3>' +
              '<p class="hint" style="margin-top:0">What you pay vs what your employer adds (of gross).</p>' +
              ctl("Pension — you pay", "assumptions.payroll.pensionEmployeePct", { min: 0, max: 12, step: 0.1, suffix: "%" }) +
              ctl("Pension — employer pays", "assumptions.payroll.pensionEmployerPct", { min: 0, max: 12, step: 0.1, suffix: "%" }) +
              ctl("Severance — employer pays", "assumptions.payroll.severancePct", { min: 0, max: 12, step: 0.1, suffix: "%" }) +
              ctl("Keren Hishtalmut — you pay", "assumptions.payroll.khEmployeePct", { min: 0, max: 5, step: 0.1, suffix: "%" }) +
              ctl("Keren Hishtalmut — employer pays", "assumptions.payroll.khEmployerPct", { min: 0, max: 10, step: 0.1, suffix: "%" })
            : ctl("Monthly net salary", "income.monthlyNetSalary", { min: 0, max: 80000, step: 100 })) +
          ctl("Salary growth / year", "income.salaryGrowthPct", { min: 0, max: 10, step: 0.1, suffix: "%" }) +
          '<div style="margin-top:10px">' + toggle("Stop salary at retirement age", "income.stopSalaryAtFire") + "</div>" +
          '<div id="income-pay-out" class="callout"></div>' +
          '<p class="hint">In <b>gross</b> mode, net take-home, income tax, national insurance/health, and the <b>pension & Keren Hishtalmut deposits</b> are computed from gross via Israeli payroll rules (edit rates on Market & Assumptions). In <b>net</b> mode you enter take-home and set deposits per account. Estimate only — not payroll advice.</p>' +
        "</div>" +
        '<div class="panel"><h3>Extra income streams</h3>' +
          '<div class="toolbar"><button class="btn small" data-action="add-extra">+ Add income stream</button></div>' +
          '<div class="table-wrap"><table class="grid"><thead><tr><th>Name</th><th>Monthly</th><th>Start age</th><th>End age</th><th>Growth %</th><th></th></tr></thead><tbody id="income-extra"></tbody></table></div>' +
          '<p class="hint">Rental income, side gigs, partner income, one-off windows, etc. Pension payout is handled automatically at access age.</p>' +
        "</div>" +
        "</div>" +
        '<div class="panel"><h3>Equity grants (RSUs / options)</h3>' +
          '<p class="hint">Zero, one, or many grants — e.g. RSUs from different companies. Each has its own share price, growth, vesting, basis, tax rates, and a vesting window (<b>start</b>–<b>stop</b> age) so you can start, stop, or drop grants. No RSU? Just remove them all. Modeled on the Israeli Section-102 capital-gains track.</p>' +
          '<div class="toolbar"><button class="btn small" data-action="add-grant">+ Add grant</button>' +
            '<button class="btn small" data-action="fetch-prices">↻ Fetch live prices</button>' +
            '<input data-path="live.corsProxy" data-type="text" placeholder="CORS proxy URL (optional)" style="width:210px">' +
            '<span id="grants-status" class="hint"></span></div>' +
          '<div class="table-wrap"><table class="grid"><thead><tr><th>Name</th><th>Symbol</th><th>Cur</th><th>Price</th><th>Growth %</th><th>Vested sh.</th><th>Sh./yr</th><th>Basis</th><th>Ord. tax %</th><th>CG %</th><th>Vest from</th><th>Vest until</th><th></th></tr></thead><tbody id="income-grants"></tbody></table></div>' +
          '<div id="income-rsu-out" class="callout"></div>' +
          '<p class="hint">Live prices fetch by <b>Symbol</b> (e.g. AMZN, GOOG) from <b>Yahoo Finance</b> — <b>no API key needed</b>. Browsers block Yahoo directly (CORS), so it goes through a public CORS proxy; the default usually works, or set another proxy URL prefix (e.g. <code>https://corsproxy.io/?</code>). Only runs on click; nothing but the ticker is sent.</p>' +
        "</div>" +
        '<div class="panel"><h3>Surplus allocation — where your savings go</h3>' +
          '<p class="hint">Each year, income minus spending is your surplus. Route parts of it to specific accounts (a % of surplus, or a fixed ₪/month); whatever is left lands in your default account.</p>' +
          '<div class="control" style="max-width:520px"><label>Default account for "the rest"</label>' +
            '<select data-path="income.defaultAccountId" data-type="text">' + this.accountOptions(st, st.income.defaultAccountId) + "</select></div>" +
          '<div class="toolbar"><button class="btn small" data-action="add-alloc">+ Add allocation rule</button></div>' +
          '<div class="table-wrap"><table class="grid"><thead><tr><th>To account</th><th>Mode</th><th>Value</th><th></th></tr></thead><tbody id="income-alloc"></tbody></table></div>' +
          '<div id="income-alloc-out" class="callout"></div>' +
        "</div>";
      this.renderExtra(el);
      this.renderGrants(el);
      this.renderAlloc(el);
      this.update(el);
    },
    renderGrants(el) {
      const st = S();
      const body = el.querySelector("#income-grants");
      body.innerHTML = (st.income.grants || []).map((g) => {
        const f = (field, val, step, type) => '<input class="num" style="width:82px" data-arr="income.grants" data-id="' + g.id + '" data-field="' + field + '" data-type="' + (type || "float") + '" type="number" step="' + (step || 1) + '" value="' + val + '">';
        const curSel = '<select data-arr="income.grants" data-id="' + g.id + '" data-field="currency" data-type="text">' +
          ["USD", "ILS"].map((c) => "<option" + (g.currency === c ? " selected" : "") + ">" + c + "</option>").join("") + "</select>";
        return "<tr>" +
          '<td><input data-arr="income.grants" data-id="' + g.id + '" data-field="name" data-type="text" style="width:120px" value="' + escapeHtml(g.name) + '"></td>' +
          '<td><input data-arr="income.grants" data-id="' + g.id + '" data-field="symbol" data-type="text" style="width:64px" value="' + escapeHtml(g.symbol || "") + '"></td>' +
          "<td>" + curSel + "</td>" +
          "<td>" + f("sharePrice", g.sharePrice, 0.5) + "</td>" +
          "<td>" + f("expectedGrowthPct", g.expectedGrowthPct, 0.1) + "</td>" +
          "<td>" + f("vestedShares", g.vestedShares, 1, "int") + "</td>" +
          "<td>" + f("sharesPerYear", g.sharesPerYear, 1, "int") + "</td>" +
          "<td>" + f("grantBasisUsd", g.grantBasisUsd, 1) + "</td>" +
          "<td>" + f("ordinaryTaxRate", g.ordinaryTaxRate, 1) + "</td>" +
          "<td>" + f("capGainsRate", g.capGainsRate, 1) + "</td>" +
          "<td>" + f("startAge", g.startAge, 1, "int") + "</td>" +
          "<td>" +
            (g.vestUntilRetire
              ? '<span class="hint" title="Tied to your retirement age">= ' + Math.round(st.profile.fireAge) + "</span>"
              : f("stopAge", g.stopAge, 1, "int")) +
            '<label class="acc-chk" style="margin-top:4px" title="Tie vest-until to your retirement age; updates automatically when you change it"><input type="checkbox" data-arr="income.grants" data-id="' + g.id + '" data-field="vestUntilRetire" data-type="bool" data-remount="1"' + (g.vestUntilRetire ? " checked" : "") + "> ret age</label>" +
          "</td>" +
          '<td><button class="btn danger small" data-action="del-grant" data-id="' + g.id + '">✕</button></td>' +
          "</tr>";
      }).join("") || '<tr><td colspan="13" style="text-align:center;color:var(--muted)">No grants — click “+ Add grant” if you have RSUs/options.</td></tr>';
    },
    accountOptions(st, selectedId) {
      return st.accounts.map((a) => '<option value="' + a.id + '"' + (a.id === selectedId ? " selected" : "") + ">" + escapeHtml(a.name) + "</option>").join("");
    },
    renderAlloc(el) {
      const st = S();
      const body = el.querySelector("#income-alloc");
      body.innerHTML = (st.income.allocations || []).map((al) => {
        const accSel = '<select data-arr="income.allocations" data-id="' + al.id + '" data-field="accountId" data-type="text">' + this.accountOptions(st, al.accountId) + "</select>";
        const modeSel = '<select data-arr="income.allocations" data-id="' + al.id + '" data-field="mode" data-type="text">' +
          ["percent", "amount"].map((m) => '<option value="' + m + '"' + (al.mode === m ? " selected" : "") + ">" + (m === "percent" ? "% of surplus" : "₪ / month") + "</option>").join("") + "</select>";
        const valInp = '<input class="num" data-arr="income.allocations" data-id="' + al.id + '" data-field="value" data-type="float" type="number" step="' + (al.mode === "percent" ? 1 : 100) + '" value="' + al.value + '">';
        return "<tr><td>" + accSel + "</td><td>" + modeSel + "</td><td>" + valInp + '</td><td><button class="btn danger small" data-action="del-alloc" data-id="' + al.id + '">✕</button></td></tr>';
      }).join("");
    },
    renderExtra(el) {
      const st = S();
      const body = el.querySelector("#income-extra");
      body.innerHTML = (st.income.extra || []).map((s) => {
        const f = (field, val, step, type) => '<input class="num" data-arr="income.extra" data-id="' + s.id + '" data-field="' + field + '" data-type="' + (type || "float") + '" type="number" step="' + (step || 1) + '" value="' + val + '">';
        return "<tr>" +
          '<td><input data-arr="income.extra" data-id="' + s.id + '" data-field="name" data-type="text" value="' + escapeHtml(s.name) + '"></td>' +
          "<td>" + f("monthlyAmount", s.monthlyAmount, 100) + "</td>" +
          "<td>" + f("startAge", s.startAge, 1, "int") + "</td>" +
          "<td>" + f("endAge", s.endAge, 1, "int") + "</td>" +
          "<td>" + f("growthPct", s.growthPct, 0.1) + "</td>" +
          '<td><button class="btn danger small" data-action="del-extra" data-id="' + s.id + '">✕</button></td>' +
          "</tr>";
      }).join("");
    },
    update(el) {
      const st = S();
      // Payroll breakdown (gross mode).
      const po = el.querySelector("#income-pay-out");
      if (po) {
        if (st.income.salaryMode === "gross") {
          const pay = FIRE.engine.computePayroll(st);
          const row = (label, val, cls) => '<div class="pay-row' + (cls ? " " + cls : "") + '"><span>' + label + "</span><span>" + val + "</span></div>";
          po.innerHTML =
            '<div class="pay-block"><div class="pay-title">Payments</div>' +
              row("Base salary", money(st.income.grossMonthly)) +
              row("Cash extras (travel, phone…)", money(st.income.taxableExtrasMonthly)) +
              row("Taxable imputations (זקיפות)", money(pay.imputations)) +
              row("Taxable base", money(pay.taxableBase), "pay-sum") +
            "</div>" +
            '<div class="pay-block"><div class="pay-title">Deductions</div>' +
              row("Income tax", "−" + money(pay.incomeTax)) +
              row("National insurance + health", "−" + money(pay.niHealth)) +
              row("Pension (you)", "−" + money(pay.empPension)) +
              row("Keren Hishtalmut (you)", "−" + money(pay.empKH)) +
              row("Net take-home", money(pay.net), "pay-sum") +
            "</div>" +
            '<div class="pay-block"><div class="pay-title">Deposits to savings</div>' +
              row("Pension total", money(pay.pensionDeposit), "pay-sum") +
              row("↳ you / employer / severance", money(pay.empPension) + " / " + money(pay.employerPension) + " / " + money(pay.severance)) +
              row("Keren Hishtalmut total", money(pay.khDeposit), "pay-sum") +
              row("↳ you / employer", money(pay.empKH) + " / " + money(pay.employerKH)) +
            "</div>";
        } else {
          po.innerHTML = "Net mode: take-home is used directly; pension/KH deposits come from each account's monthly contribution on the Accounts page.";
        }
      }
      const gv = FIRE.state.grantsVested(st);
      const out = el.querySelector("#income-rsu-out");
      if (out) out.innerHTML = gv.per.length
        ? "Total vested equity: <b>" + money(gv.gross) + "</b> gross · tax <b>" + money(gv.tax) + "</b> · net <b>" + money(gv.net) + "</b> (eff. " + (gv.effectiveRate * 100).toFixed(1) + "%). Each grant appears as a computed account on the Accounts page; vesting stops at each grant's 'vest until' age or your retirement age, whichever comes first."
        : "No equity grants configured.";

      // Live allocation preview against this year's surplus.
      const ao = el.querySelector("#income-alloc-out");
      if (ao) {
        const p = FIRE.engine.project(st);
        const r0 = p.rows[0];
        const surplus = Math.max(0, (r0.salary + r0.extra) - r0.spend);
        const nameById = {}; st.accounts.forEach((a) => (nameById[a.id] = a.name));
        let remaining = surplus, lines = [], pctSum = 0;
        (st.income.allocations || []).forEach((al) => {
          let amt = al.mode === "percent" ? surplus * (al.value / 100) : al.value * 12;
          if (al.mode === "percent") pctSum += al.value;
          amt = Math.max(0, Math.min(amt, remaining));
          remaining -= amt;
          lines.push((nameById[al.accountId] || "?") + ": <b>" + money(amt) + "</b>/yr");
        });
        const defName = nameById[st.income.defaultAccountId] || "(none)";
        let warn = pctSum > 100 ? ' <span class="bad">⚠ percentages exceed 100%</span>' : "";
        ao.innerHTML = "This year's surplus ≈ <b>" + money(surplus) + "</b>/yr. " +
          (lines.length ? lines.join(" · ") + " · " : "") +
          "rest → <b>" + escapeHtml(defName) + "</b>: <b>" + money(Math.max(0, remaining)) + "</b>/yr." + warn;
      }
    },
  };

  /* ============================ SPENDING ================================= */
  const spending = {
    mount(el) {
      el.innerHTML =
        "<h1>Spending</h1>" +
        '<p class="lead">Break spending into categories with their own growth, or set step-changes at specific ages.</p>' +
        '<div class="grid-2">' +
        '<div class="panel"><h3>Category defaults</h3>' +
          ctl("Default category growth / yr", "spending.growthPct", { min: 0, max: 10, step: 0.1, suffix: "%" }) +
          '<p class="hint">Projections use your <b>real</b> categories &amp; step-changes below. The theoretical fixed-spend FIRE target lives on the <b>🔥 FIRE</b> tab.</p>' +
        "</div>" +
        '<div class="panel"><h3>Spending mix (at current age)</h3><canvas id="sp-pie" height="240"></canvas></div>' +
        "</div>" +
        '<div class="panel"><h3>Categories</h3>' +
          '<div class="toolbar"><button class="btn small" data-action="add-cat">+ Add category</button></div>' +
          '<div class="table-wrap"><table class="grid"><thead><tr><th>Name</th><th>Amount</th><th>Per</th><th>Start age</th><th>End age</th><th>Growth %</th><th>Inflate</th><th></th></tr></thead><tbody id="sp-cats"></tbody></table></div>' +
          '<div id="sp-total" class="callout"></div>' +
        "</div>" +
        '<div class="panel"><h3>Step changes (differential spending)</h3>' +
          '<div class="toolbar"><button class="btn small" data-action="add-step">+ Add step</button></div>' +
          '<p class="hint">A step overrides total spend from a given age (grows by default category growth). Example: from age 31, set ₪13,000/month.</p>' +
          '<div class="table-wrap"><table class="grid"><thead><tr><th>From age</th><th>Amount</th><th>Per</th><th>Note</th><th></th></tr></thead><tbody id="sp-steps"></tbody></table></div>' +
        "</div>" +
        '<div class="panel"><h3>Spending used by age (which rule wins)</h3><div id="sp-preview"></div></div>' +
        '<div class="panel"><h3>Projected spending to 80</h3><canvas id="sp-line" height="240"></canvas></div>';
      this.renderCats(el);
      this.renderSteps(el);
      this.update(el);
    },
    renderCats(el) {
      const st = S();
      el.querySelector("#sp-cats").innerHTML = (st.spending.categories || []).map((c) => {
        const f = (field, val, step, type) => '<input class="num" data-arr="spending.categories" data-id="' + c.id + '" data-field="' + field + '" data-type="' + (type || "float") + '" type="number" step="' + (step || 1) + '" value="' + val + '">';
        return "<tr>" +
          '<td><input data-arr="spending.categories" data-id="' + c.id + '" data-field="name" data-type="text" value="' + escapeHtml(c.name) + '"></td>' +
          "<td>" + f("monthly", c.monthly, 50) + "</td>" +
          "<td>" + freqSelect("spending.categories", c.id, c.freq) + "</td>" +
          "<td>" + f("startAge", c.startAge, 1, "int") + "</td>" +
          "<td>" + f("endAge", c.endAge, 1, "int") + "</td>" +
          "<td>" + f("growthPct", c.growthPct, 0.1) + "</td>" +
          '<td style="text-align:center"><input type="checkbox" data-arr="spending.categories" data-id="' + c.id + '" data-field="inflate" data-type="bool"' + (c.inflate ? " checked" : "") + "></td>" +
          '<td><button class="btn danger small" data-action="del-cat" data-id="' + c.id + '">✕</button></td>' +
          "</tr>";
      }).join("");
    },
    renderSteps(el) {
      const st = S();
      el.querySelector("#sp-steps").innerHTML = (st.spending.steps || []).map((s) => {
        const f = (field, val, step, type) => '<input class="num" data-arr="spending.steps" data-id="' + s.id + '" data-field="' + field + '" data-type="' + (type || "float") + '" type="number" step="' + (step || 1) + '" value="' + val + '">';
        return "<tr>" +
          "<td>" + f("fromAge", s.fromAge, 1, "int") + "</td>" +
          "<td>" + f("monthly", s.monthly, 250) + "</td>" +
          "<td>" + freqSelect("spending.steps", s.id, s.freq) + "</td>" +
          '<td><input data-arr="spending.steps" data-id="' + s.id + '" data-field="note" data-type="text" value="' + escapeHtml(s.note || "") + '"></td>' +
          '<td><button class="btn danger small" data-action="del-step" data-id="' + s.id + '">✕</button></td>' +
          "</tr>";
      }).join("");
    },
    update(el) {
      const st = S();
      const age = Math.round(st.profile.currentAge);
      const bd = FIRE.engine.spendBreakdown(st, age);
      C.pie(el.querySelector("#sp-pie"), { doughnut: true, slices: bd.map((b) => ({ name: b.name, value: b.monthly })) });

      // Total of all active categories at the current age (monthly-equivalent).
      const totMonthly = bd.reduce((s, b) => s + b.monthly, 0);
      const totEl = el.querySelector("#sp-total");
      if (totEl) {
        totEl.innerHTML = "<b>Total spending now:</b> " + money(totMonthly) + "/month · " + money(totMonthly * 12) + "/year" +
          " (across " + bd.length + " active " + (bd.length === 1 ? "category" : "categories") + "). Yearly items are shown as their monthly-equivalent here.";
      }
      const p = FIRE.engine.project(st);
      C.line(el.querySelector("#sp-line"), {
        labels: p.rows.map((r) => r.age),
        series: [{ name: "Annual spend", data: p.rows.map((r) => r.spend), color: "#e15759" }],
      });

      // Preview: which rule decides spending across age ranges. Grouped into
      // contiguous segments — and when a step is in force, segments break per
      // individual step, so every step you defined shows as its own range.
      const prev = el.querySelector("#sp-preview");
      if (prev) {
        const A0 = Math.round(st.profile.currentAge), end = st.profile.endAge;
        const label = { step: "step override", headline: "fixed FIRE spend", categories: "categories" };
        const stepAt = (a) => (st.spending.steps || []).filter((s) => a >= s.fromAge).sort((x, y) => y.fromAge - x.fromAge)[0] || null;
        const segs = [];
        for (let a = A0; a <= end; a++) {
          const src = FIRE.engine.spendSourceAt(st, a);
          const step = src === "step" ? stepAt(a) : null;
          const key = src + "|" + (step ? step.id : "");
          const last = segs[segs.length - 1];
          if (last && last.key === key) last.a1 = a;
          else segs.push({ key: key, src: src, step: step, a0: a, a1: a });
        }
        const rows = segs.map((sg) => {
          const ageLbl = sg.a0 === sg.a1 ? "age " + sg.a0 : "ages " + sg.a0 + "–" + sg.a1;
          const m0 = FIRE.engine.monthlySpend(st, sg.a0), m1 = FIRE.engine.monthlySpend(st, sg.a1);
          const amt = sg.a0 === sg.a1 ? money(m0) + "/mo" : money(m0) + " → " + money(m1) + "/mo";
          let decided = sg.src === "step"
            ? '<span class="bad">step override</span>' + (sg.step ? " — from age " + sg.step.fromAge + (sg.step.note ? " (" + escapeHtml(sg.step.note) + ")" : "") : "")
            : label[sg.src];
          return "<tr><td>" + ageLbl + "</td><td>" + amt + "</td><td>" + decided + "</td></tr>";
        }).join("");
        prev.innerHTML =
          '<table class="grid"><thead><tr><th>Ages</th><th>Monthly spend</th><th>Decided by</th></tr></thead><tbody>' + rows + "</tbody></table>" +
          '<p class="hint">Priority: the <b>latest step</b> whose age you\'ve passed wins (each step persists until the next one) → in retirement, <b>fixed FIRE spend</b> if enabled on the <b>🔥 FIRE</b> tab → otherwise your <b>categories</b>.</p>';
      }
    },
  };

  /* ============================ TRACKER ================================= */
  const tracker = {
    selMonthId: null,
    selYearId: null,
    budgetFor(c) { return c.freq === "yearly" ? (c.monthly || 0) / 12 : (c.monthly || 0); },
    monthlyCats(st) { return (st.spending.categories || []).filter((c) => c.freq !== "yearly"); },
    yearlyCats(st) { return (st.spending.categories || []).filter((c) => c.freq === "yearly"); },

    mount(el) {
      const st = S();
      const months = st.tracker.months || [];
      const years = st.tracker.years || [];
      // Resolve/repair selections (default to the most recent entry).
      if (this.selMonthId == null || !months.some((m) => m.id === this.selMonthId)) {
        const latest = months.slice().sort((a, b) => b.ym.localeCompare(a.ym))[0];
        this.selMonthId = latest ? latest.id : null;
      }
      if (this.selYearId == null || !years.some((y) => y.id === this.selYearId)) {
        const latestY = years.slice().sort((a, b) => b.year - a.year)[0];
        this.selYearId = latestY ? latestY.id : null;
      }
      const nowYm = new Date().toISOString().slice(0, 7);
      const nowYear = FIRE.state.refDate(st).getFullYear();
      el.innerHTML =
        "<h1>Expense Tracker</h1>" +
        '<p class="lead">Compare what you actually spent against your budget (the category amounts from the Spending page). Click a <b>month</b> tile to log that month\'s recurring spending; log <b>one-off / annual</b> costs once per <b>year</b>. Totals refresh as you type; history is saved with your plan.</p>' +
        '<div class="panel"><h3>Budget vs actual — monthly, over time</h3><canvas id="trk-line" height="220"></canvas></div>' +
        '<div class="panel">' +
          "<h3>Monthly tracking</h3>" +
          '<div class="toolbar"><input type="month" id="trk-month" value="' + nowYm + '"><button class="btn small" data-action="add-month">+ Add / open month</button></div>' +
          '<div id="trk-months-grid" class="pred-grid"></div>' +
          '<div id="trk-month-detail"></div>' +
        "</div>" +
        '<div class="panel">' +
          "<h3>Yearly tracking</h3>" +
          '<p class="hint">One-off / annual costs (vacations, insurance, taxes) are recorded once per year — not tied to a specific month.</p>' +
          '<div class="toolbar"><input type="number" id="trk-year" min="1990" max="2200" step="1" value="' + nowYear + '"><button class="btn small" data-action="add-year">+ Add / open year</button></div>' +
          '<div id="trk-years-grid" class="pred-grid"></div>' +
          '<div id="trk-year-detail"></div>' +
          '<h4 style="margin:18px 0 8px">Budget vs actual — yearly, over time</h4>' +
          '<canvas id="trk-year-line" height="220"></canvas>' +
        "</div>";
      this.renderMonthDetail(el);
      this.renderYearDetail(el);
      this.update(el);
    },

    renderMonthsGrid(el) {
      const grid = el.querySelector("#trk-months-grid");
      if (!grid) return;
      const st = S();
      const cats = this.monthlyCats(st);
      const budget = cats.reduce((s, c) => s + this.budgetFor(c), 0);
      const nowYm = new Date().toISOString().slice(0, 7);
      const months = (st.tracker.months || []).slice().sort((a, b) => b.ym.localeCompare(a.ym));
      if (!months.length) { grid.innerHTML = '<p class="hint">No months yet — pick a month above and click “Add / open month”.</p>'; return; }
      grid.innerHTML = months.map((m) => {
        const act = cats.reduce((s, c) => s + ((m.entries && m.entries[c.id]) || 0), 0);
        const d = act - budget;
        return '<div class="pred-box' + (m.ym === nowYm ? " now" : "") + (act > 0 ? " has-actual" : "") + (m.id === this.selMonthId ? " sel" : "") + '" data-action="trk-month-sel" data-id="' + m.id + '">' +
          '<div class="pred-year">' + m.ym + "</div>" +
          '<div class="pred-total">' + C.fmt(act) + "</div>" +
          (act > 0 ? '<div class="pred-delta ' + (d > 0 ? "bad" : "ok") + '">' + (d > 0 ? "+" : "") + C.fmt(d) + "</div>" : "") +
          "</div>";
      }).join("");
    },
    renderYearsGrid(el) {
      const grid = el.querySelector("#trk-years-grid");
      if (!grid) return;
      const st = S();
      const cats = this.yearlyCats(st);
      const budget = cats.reduce((s, c) => s + (c.monthly || 0), 0); // annual budget
      const nowYear = FIRE.state.refDate(st).getFullYear();
      const years = (st.tracker.years || []).slice().sort((a, b) => b.year - a.year);
      if (!years.length) { grid.innerHTML = '<p class="hint">No years yet — pick a year above and click “Add / open year”.</p>'; return; }
      grid.innerHTML = years.map((y) => {
        const act = cats.reduce((s, c) => s + ((y.entries && y.entries[c.id]) || 0), 0);
        const d = act - budget;
        return '<div class="pred-box' + (y.year === nowYear ? " now" : "") + (act > 0 ? " has-actual" : "") + (y.id === this.selYearId ? " sel" : "") + '" data-action="trk-year-sel" data-id="' + y.id + '">' +
          '<div class="pred-year">' + y.year + "</div>" +
          '<div class="pred-total">' + C.fmt(act) + "</div>" +
          (act > 0 ? '<div class="pred-delta ' + (d > 0 ? "bad" : "ok") + '">' + (d > 0 ? "+" : "") + C.fmt(d) + "</div>" : "") +
          "</div>";
      }).join("");
    },

    // Detail table (with inputs) for the selected month / year. Rebuilt only on
    // mount and on selection change — never during typing — to preserve focus.
    detailTable(item, cats, opts) {
      let rows;
      if (!cats.length) {
        rows = '<tr><td colspan="4" class="hint" style="text-align:center">No ' + opts.kind + " categories on the Spending page.</td></tr>";
      } else {
        rows = cats.map((c) => {
          const b = opts.budgetOf(c);
          const a = (item.entries && item.entries[c.id]) || 0;
          return "<tr><td>" + escapeHtml(c.name) + "</td><td>" + money(b) + "</td>" +
            '<td><input class="num" ' + opts.inputAttr(c) + ' data-type="float" type="number" step="' + opts.step + '" min="0" value="' + a + '"></td>' +
            '<td class="td-delta" data-c="' + c.id + '"></td></tr>';
        }).join("");
      }
      return '<div class="acc-group-head"><h4 style="margin:6px 0">' + opts.title + "</h4>" +
          '<button class="btn danger small" data-action="' + opts.delAction + '" data-id="' + item.id + '" title="Delete">✕ ' + opts.delLabel + "</button></div>" +
        '<input class="acc-notes" data-arr="' + opts.arr + '" data-id="' + item.id + '" data-field="note" data-type="text" placeholder="' + opts.notePh + '" value="' + escapeHtml(item.note || "") + '">' +
        '<div class="table-wrap"><table class="grid"><thead><tr><th>Category</th><th>' + opts.budgetHdr + "</th><th>Actual</th><th>Δ vs budget</th></tr></thead><tbody>" +
          rows +
          '<tr class="trk-subtotal"><td><b>Total</b></td><td class="trk-sum" data-fld="b"></td><td class="trk-sum" data-fld="a"></td><td class="trk-sum" data-fld="d"></td></tr>' +
        "</tbody></table></div>" +
        '<div class="callout trk-month-total"></div>';
    },
    renderMonthDetail(el) {
      const host = el.querySelector("#trk-month-detail");
      if (!host) return;
      const st = S();
      const m = (st.tracker.months || []).find((x) => x.id === this.selMonthId);
      if (!m) { host.innerHTML = '<p class="hint">Select or add a month to log monthly spending.</p>'; return; }
      host.innerHTML = this.detailTable(m, this.monthlyCats(st), {
        kind: "monthly", title: m.ym, delAction: "del-month", delLabel: "Delete month",
        arr: "tracker.months", notePh: "Note for this month…", budgetHdr: "Budget (₪/mo)", step: 10,
        budgetOf: (c) => this.budgetFor(c),
        inputAttr: (c) => 'data-trkm="' + m.id + '" data-trkc="' + c.id + '"',
      });
    },
    renderYearDetail(el) {
      const host = el.querySelector("#trk-year-detail");
      if (!host) return;
      const st = S();
      const y = (st.tracker.years || []).find((x) => x.id === this.selYearId);
      if (!y) { host.innerHTML = '<p class="hint">Select or add a year to log yearly one-off costs.</p>'; return; }
      host.innerHTML = this.detailTable(y, this.yearlyCats(st), {
        kind: "yearly", title: String(y.year), delAction: "del-year", delLabel: "Delete year",
        arr: "tracker.years", notePh: "Note for this year…", budgetHdr: "Budget (₪/yr)", step: 100,
        budgetOf: (c) => (c.monthly || 0),
        inputAttr: (c) => 'data-trky="' + y.id + '" data-trkyc="' + c.id + '"',
      });
    },

    // In-place refresh of the derived cells of one detail table (Δ, subtotal,
    // total) without recreating inputs, so focus/cursor are preserved on typing.
    refreshDetail(el, sel, cats, item, budgetOf) {
      const host = el.querySelector(sel);
      if (!host || !item) return;
      const put = (node, val, isDelta) => {
        if (!node) return;
        node.textContent = (isDelta && val > 0 ? "+" : "") + money(val);
        if (isDelta) node.style.color = val > 0 ? "var(--bad)" : "var(--ok)";
      };
      let bTot = 0, aTot = 0;
      cats.forEach((c) => {
        const b = budgetOf(c), a = (item.entries && item.entries[c.id]) || 0;
        bTot += b; aTot += a;
        put(host.querySelector('.td-delta[data-c="' + c.id + '"]'), a - b, true);
      });
      put(host.querySelector('.trk-sum[data-fld="b"]'), bTot);
      put(host.querySelector('.trk-sum[data-fld="a"]'), aTot);
      put(host.querySelector('.trk-sum[data-fld="d"]'), aTot - bTot, true);
      const tot = host.querySelector(".trk-month-total");
      if (tot) {
        const v = aTot - bTot;
        tot.innerHTML = "<b>Total:</b> budget " + money(bTot) + " · actual " + money(aTot) +
          ' · <span style="color:' + (v > 0 ? "var(--bad)" : "var(--ok)") + '"><b>' + (v > 0 ? "+" : "") + money(v) + "</b></span> vs budget.";
      }
    },

    update(el) {
      const st = S();
      // Tiles carry no inputs, so rebuilding them on each keystroke is safe and
      // keeps the selected tile's total/variance live.
      this.renderMonthsGrid(el);
      this.renderYearsGrid(el);
      this.refreshDetail(el, "#trk-month-detail", this.monthlyCats(st), (st.tracker.months || []).find((x) => x.id === this.selMonthId), (c) => this.budgetFor(c));
      this.refreshDetail(el, "#trk-year-detail", this.yearlyCats(st), (st.tracker.years || []).find((x) => x.id === this.selYearId), (c) => (c.monthly || 0));

      // Budget vs actual over time (monthly categories only).
      const cats = this.monthlyCats(st);
      const budget = cats.reduce((s, c) => s + this.budgetFor(c), 0);
      const months = (st.tracker.months || []).slice().sort((a, b) => a.ym.localeCompare(b.ym));
      C.line(el.querySelector("#trk-line"), {
        labels: months.map((m) => m.ym),
        series: [
          { name: "Budget", data: months.map(() => budget), color: "#4e79a7" },
          { name: "Actual", data: months.map((m) => cats.reduce((s, c) => s + ((m.entries && m.entries[c.id]) || 0), 0)), color: "#e15759" },
        ],
      });

      // Budget vs actual over time (yearly one-off categories).
      const ycats = this.yearlyCats(st);
      const ybudget = ycats.reduce((s, c) => s + (c.monthly || 0), 0); // annual budget
      const years = (st.tracker.years || []).slice().sort((a, b) => a.year - b.year);
      const yCanvas = el.querySelector("#trk-year-line");
      if (yCanvas) {
        C.line(yCanvas, {
          labels: years.map((y) => y.year),
          series: [
            { name: "Budget", data: years.map(() => ybudget), color: "#4e79a7" },
            { name: "Actual", data: years.map((y) => ycats.reduce((s, c) => s + ((y.entries && y.entries[c.id]) || 0), 0)), color: "#e15759" },
          ],
        });
      }
    },
  };

  /* ============================ PROJECTIONS ============================== */
  const projections = {
    // Calendar year in which you reach a given (integer) age.
    yearForAge(st, age) {
      const bs = st.profile.birthDate;
      if (bs) { const b = new Date(bs); if (!isNaN(b.getTime())) return b.getFullYear() + Math.round(age); }
      const now = FIRE.state.refDate(st);
      return now.getFullYear() + Math.round(age - st.profile.currentAge);
    },
    // Plain-language timeline: consecutive years sharing the same income /
    // withdrawal regime are grouped into one phase ("From 2027–2030 …").
    phasesPanel(st) {
      const p = FIRE.engine.project(st);
      const rows = p.rows;
      if (!rows.length) return "";
      const sig = (r) => {
        const groups = Array.from(new Set(Object.keys(r.sources || {}).map((id) => p.groupOf[id] || id))).sort();
        return (r.working ? "work" : "retire") + "|" + (r.pensionNet > 1 ? "pen" : "") + "|" + (r.withdrawalNet > 1 ? "wd:" + groups.join("+") : "");
      };
      const phases = [];
      let cur = null;
      rows.forEach((r) => {
        const s = sig(r);
        if (!cur || cur.sig !== s) {
          cur = { sig: s, a0: r.age, a1: r.age, working: r.working, n: 0, sal: 0, pen: 0, wdNet: 0, wdTax: 0, bySrc: {} };
          phases.push(cur);
        }
        cur.a1 = r.age; cur.n++;
        cur.sal += r.salary + r.extra; cur.pen += r.pensionNet;
        cur.wdNet += r.withdrawalNet; cur.wdTax += r.withdrawalTax;
        Object.keys(r.sources || {}).forEach((id) => { const g = p.groupOf[id] || id; cur.bySrc[g] = (cur.bySrc[g] || 0) + r.sources[id]; });
      });
      const items = phases.map((ph) => {
        const y0 = this.yearForAge(st, ph.a0), y1 = this.yearForAge(st, ph.a1);
        const yr = y0 === y1 ? String(y0) : y0 + "–" + y1;
        const ages = ph.a0 === ph.a1 ? "age " + ph.a0 : "ages " + ph.a0 + "–" + ph.a1;
        const avg = (v) => v / ph.n;
        const parts = [];
        if (avg(ph.sal) > 1) parts.push((ph.working ? "earn" : "income") + " ~" + money(avg(ph.sal)) + "/yr");
        if (avg(ph.pen) > 1) parts.push("pension net ~" + money(avg(ph.pen)) + "/yr");
        if (ph.wdNet > 1) {
          const srcs = Object.keys(ph.bySrc).sort((a, b) => ph.bySrc[b] - ph.bySrc[a])
            .map((g) => escapeHtml(g) + " ~" + money(ph.bySrc[g] / ph.n) + "/yr");
          parts.push("withdraw ~" + money(avg(ph.wdNet)) + "/yr net from " + srcs.join(", ") +
            " (phase total " + money(ph.wdNet) + (ph.wdTax > 1 ? ", CG tax " + money(ph.wdTax) : "") + ")");
        }
        if (!parts.length) parts.push(ph.working ? "saving from income; portfolio grows" : "income covers spending");
        return "<li><b>" + yr + "</b> (" + ages + ", " + ph.n + " yr) — <b>" + (ph.working ? "Working" : "Retired") + ":</b> " + parts.join(" · ") + ".</li>";
      }).join("");
      const dep = p.depletionAge ? '<p class="hint" style="color:var(--bad)">⚠ Liquid assets are projected to run out at age ' + p.depletionAge + " (" + this.yearForAge(st, p.depletionAge) + ").</p>" : "";
      return '<div class="panel"><h3>Income &amp; withdrawals by phase</h3>' +
        '<p class="hint">Consecutive years with the same income/withdrawal pattern, grouped. Amounts are nominal ₪, averaged per year within each phase.</p>' +
        '<ul class="phase-list">' + items + "</ul>" + dep + "</div>";
    },
    mount(el) {
      el.innerHTML = "<h1>Projections</h1>" +
        '<p class="lead">Year-by-year balance until age ' + S().profile.endAge + ', <b>aggregated by account group</b> (one Brokerage, one Bank, one Pension…). The first row is the <b>current calendar year prorated</b> from today (partial income/vests/growth), so it won\'t double-count what already happened this year. Edit individual accounts on the Accounts page.</p>' +
        '<div class="panel"><h3>Retirement age</h3>' +
          ctl("Retirement age", "profile.fireAge", { min: 30, max: 70, step: 1, type: "int" }) +
          '<div class="toolbar"><button class="btn small" data-action="find-earliest" data-target="pr-earliest">🔎 Find earliest retirement age</button></div>' +
          '<div id="pr-earliest"></div>' +
          '<p class="hint">Same value as the retirement age on the Dashboard and Market &amp; Assumptions pages — change it here and the whole projection updates.</p>' +
        "</div>" +
        '<div class="toolbar">' +
          toggle("Real (today's ₪)", "assumptions.realMode") +
          '<button class="btn small" data-action="export-csv">⬇ Export CSV</button>' +
        "</div>" +
        '<div class="panel"><h3>All entities over time (stacked)</h3><canvas id="pr-stack" height="300"></canvas></div>' +
        this.phasesPanel(S()) +
        '<div class="panel"><h3>Income vs spending</h3><canvas id="pr-io" height="260"></canvas>' +
          '<p class="hint">Income = net salary + extra + <b>net pension</b> (after tax). "Withdrawn for living" is the net cash pulled from your portfolio to cover the rest of spending; selling from taxable/RSU pots pays capital-gains tax, so the gross sale is larger.</p>' +
          '<div id="pr-io-note" class="callout"></div>' +
        "</div>" +
        '<div class="panel"><h3>Year-by-year table</h3><div class="table-wrap tall"><table class="grid tiny" id="pr-table"></table></div></div>';
      this.update(el);
    },
    update(el) {
      const st = S();
      const p = FIRE.engine.project(st);
      const real = st.assumptions.realMode;
      const adj = (v, k) => (real ? v / Math.pow(1 + st.assumptions.inflation / 100, k) : v);
      const labels = p.rows.map((r) => r.age);
      const groups = p.groupsMeta; // aggregate holdings by account group
      const gVal = (r, g) => g.ids.reduce((s, id) => s + (r.perAccount[id] || 0), 0);

      // Stacked per-group (e.g. one "Brokerage", one "Bank", one "Pension"…)
      const series = groups.map((g, i) => ({
        name: g.name,
        color: C.PALETTE[i % C.PALETTE.length],
        data: p.rows.map((r) => adj(gVal(r, g), r.k)),
      }));
      C.bar(el.querySelector("#pr-stack"), { labels, stacked: true, series });

      // Income vs spending (incl. pension income and living withdrawals)
      C.line(el.querySelector("#pr-io"), {
        labels,
        series: [
          { name: "Salary + extra", data: p.rows.map((r) => adj(r.salary + r.extra, r.k)), color: "#4e79a7" },
          { name: "Pension (net)", data: p.rows.map((r) => adj(r.pensionNet, r.k)), color: "#b07aa1" },
          { name: "Withdrawn for living (net)", data: p.rows.map((r) => adj(r.withdrawalNet, r.k)), color: "#f28e2b" },
          { name: "Spending", data: p.rows.map((r) => adj(r.spend, r.k)), color: "#e15759" },
        ],
      });

      // Withdrawal-source note: aggregate net withdrawals by group across all
      // retirement years, and total taxes paid on pension + withdrawals.
      const note = el.querySelector("#pr-io-note");
      if (note) {
        const bySrc = {};
        let totWd = 0, totWdTax = 0, totPenTax = 0;
        p.rows.forEach((r) => {
          totWd += r.withdrawalNet; totWdTax += r.withdrawalTax; totPenTax += r.pensionTax;
          Object.keys(r.sources || {}).forEach((id) => {
            const g = p.groupOf[id] || id;
            bySrc[g] = (bySrc[g] || 0) + r.sources[id];
          });
        });
        const srcList = Object.keys(bySrc).sort((a, b) => bySrc[b] - bySrc[a])
          .map((g) => escapeHtml(g) + ": <b>" + money(bySrc[g]) + "</b>").join(" · ");
        note.innerHTML =
          "<b>Lifetime living withdrawals by source:</b> " + (srcList || "none — income covers spending") + ".<br>" +
          "Total net withdrawn for living: <b>" + money(totWd) + "</b> · capital-gains tax on withdrawals: <b>" + money(totWdTax) + "</b> · pension income tax: <b>" + money(totPenTax) + "</b>.";
      }

      // Table — one column per group
      let head = "<thead><tr><th>Age</th><th>Date</th><th>Phase</th><th>Salary+extra</th><th>Pension net</th><th>Withdrawn</th><th>Spend</th>" +
        groups.map((g) => "<th>" + escapeHtml(shortName(g.name)) + "</th>").join("") +
        "<th>Total</th><th>Liquid</th></tr></thead>";
      let body = "<tbody>" + p.rows.map((r) => {
        const cls = r.age === Math.round(st.profile.fireAge) ? ' class="fire-row"' : (p.depletionAge && r.age === p.depletionAge ? ' class="dep-row"' : "");
        return "<tr" + cls + "><td>" + r.age + '</td><td class="pay-date">' + ageDateLabel(st, r.age) + "</td><td>" + (r.working ? "work" : "retire") + "</td>" +
          "<td>" + money(adj(r.salary + r.extra, r.k)) + "</td>" +
          "<td>" + money(adj(r.pensionNet, r.k)) + "</td>" +
          "<td>" + money(adj(r.withdrawalNet, r.k)) + "</td>" +
          "<td>" + money(adj(r.spend, r.k)) + "</td>" +
          groups.map((g) => "<td>" + money(adj(gVal(r, g), r.k)) + "</td>").join("") +
          "<td><b>" + money(adj(r.total, r.k)) + "</b></td><td>" + money(adj(r.liquid, r.k)) + "</td></tr>";
      }).join("") + "</tbody>";
      el.querySelector("#pr-table").innerHTML = head + body;
    },
    exportCSV() {
      const st = S();
      const p = FIRE.engine.project(st);
      const groups = p.groupsMeta;
      const gVal = (r, g) => g.ids.reduce((s, id) => s + (r.perAccount[id] || 0), 0);
      const cols = ["age", "date", "phase", "salary_extra", "pension_net", "withdrawn_net", "withdrawn_tax", "spend"].concat(groups.map((g) => g.name)).concat(["total", "liquid", "pension_pot"]);
      const lines = [cols.join(",")];
      p.rows.forEach((r) => {
        const row = [r.age, ageDateLabel(st, r.age), r.working ? "work" : "retire", Math.round(r.salary + r.extra), Math.round(r.pensionNet), Math.round(r.withdrawalNet), Math.round(r.withdrawalTax), Math.round(r.spend)]
          .concat(groups.map((g) => Math.round(gVal(r, g))))
          .concat([Math.round(r.total), Math.round(r.liquid), Math.round(r.pension)]);
        lines.push(row.join(","));
      });
      const blob = new Blob([lines.join("\n")], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "fire-projection.csv"; document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },
  };

  /* ============================ PREDICTIONS ============================= */
  const predictions = {
    selYear: null,
    mount(el) {
      const st = S();
      const pr = st.predictions;
      const nowYear = FIRE.state.refDate(st).getFullYear();
      if (!pr.years || !pr.years.length) {
        el.innerHTML =
          "<h1>Predictions</h1>" +
          '<p class="lead">Save your current projection as a <b>baseline</b>. You get a box per year (kept forever, including future years). Each year you can record your <b>actual</b> balances and see how you\'re tracking vs the prediction — globally and per account.</p>' +
          '<div class="panel"><button class="btn" data-action="save-baseline">📌 Save current projection as baseline</button></div>';
        return;
      }
      el.innerHTML =
        "<h1>Predictions</h1>" +
        '<p class="lead">Baseline saved ' + (pr.baselineSavedAt ? pr.baselineSavedAt.slice(0, 10) : "") + '. Boxes are kept for every year; the <b>current year</b> is highlighted. Record actuals to compare vs the prediction.</p>' +
        '<div class="toolbar">' +
          '<button class="btn small" data-action="save-baseline">📌 Update baseline</button>' +
          '<button class="btn small" data-action="record-actual">✅ Record this year\'s actuals (' + nowYear + ")</button>" +
        "</div>" +
        '<div id="pred-grid" class="pred-grid"></div>' +
        '<div class="panel"><h3>Selected year — per-account prediction vs actual</h3><div id="pred-detail"></div></div>' +
        '<div class="panel"><h3>Predicted vs actual net worth</h3><canvas id="pred-chart" height="240"></canvas></div>';
      if (this.selYear == null) this.selYear = nowYear;
      this.update(el);
    },
    update(el) {
      const st = S();
      const pr = st.predictions;
      if (!pr.years || !pr.years.length) return;
      const nowYear = FIRE.state.refDate(st).getFullYear();
      const grid = el.querySelector("#pred-grid");
      if (grid) {
        grid.innerHTML = pr.years.map((row) => {
          const act = pr.actuals[row.year];
          const isNow = row.year === nowYear;
          let delta = "";
          if (act) {
            const d = row.total ? (act.total - row.total) / row.total * 100 : 0;
            delta = '<div class="pred-delta ' + (d >= 0 ? "ok" : "bad") + '">' + (d >= 0 ? "+" : "") + d.toFixed(1) + "%</div>";
          }
          return '<div class="pred-box' + (isNow ? " now" : "") + (act ? " has-actual" : "") + (row.year === this.selYear ? " sel" : "") + '" data-action="pred-year" data-year="' + row.year + '">' +
            '<div class="pred-year">' + row.year + " · age " + row.age + "</div>" +
            '<div class="pred-total">' + C.fmt(row.total) + "</div>" +
            (act ? '<div class="pred-actual">act ' + C.fmt(act.total) + "</div>" : "") + delta +
            "</div>";
        }).join("");
      }
      // Detail table for selected year.
      const det = el.querySelector("#pred-detail");
      if (det) {
        const row = pr.years.find((r) => r.year === this.selYear) || pr.years[0];
        const act = pr.actuals[row.year];
        let rows = pr.accounts.map((a) => {
          const pv = row.perAccount[a.id] || 0;
          const av = act ? (act.perAccount[a.id] || 0) : null;
          const d = (av != null && pv) ? (av - pv) / pv * 100 : null;
          return "<tr><td>" + escapeHtml(a.name) + "</td><td>" + money(pv) + "</td><td>" + (av != null ? money(av) : "—") + '</td><td style="color:' + (d == null ? "inherit" : d >= 0 ? "var(--ok)" : "var(--bad)") + '">' + (d == null ? "—" : (d >= 0 ? "+" : "") + d.toFixed(1) + "%") + "</td></tr>";
        }).join("");
        const gd = (act && row.total) ? (act.total - row.total) / row.total * 100 : null;
        det.innerHTML = "<p>Year <b>" + row.year + "</b> (age " + row.age + ")" + (act ? " — actuals recorded " + act.savedAt.slice(0, 10) + ' <button class="btn danger small" data-action="del-actual" data-year="' + row.year + '">✕ Remove recorded actual</button>' : " — no actuals yet") + ".</p>" +
          '<div class="table-wrap"><table class="grid"><thead><tr><th>Account</th><th>Predicted</th><th>Actual</th><th>Δ</th></tr></thead><tbody>' + rows +
          '<tr class="fire-row"><td><b>Total</b></td><td>' + money(row.total) + "</td><td>" + (act ? money(act.total) : "—") + '</td><td style="color:' + (gd == null ? "inherit" : gd >= 0 ? "var(--ok)" : "var(--bad)") + '"><b>' + (gd == null ? "—" : (gd >= 0 ? "+" : "") + gd.toFixed(1) + "%") + "</b></td></tr></tbody></table></div>";
      }
      // Chart: predicted line + actual points.
      const cv = el.querySelector("#pred-chart");
      if (cv) {
        C.line(cv, {
          labels: pr.years.map((r) => r.year),
          series: [
            { name: "Predicted", data: pr.years.map((r) => r.total), color: "#2f7ed8" },
            { name: "Actual", data: pr.years.map((r) => (pr.actuals[r.year] ? pr.actuals[r.year].total : null)), color: "#59a14f" },
          ],
        });
      }
    },
  };

  /* ============================ PENSION ================================== */
  const pension = {
    mount(el) {
      const st = S();
      const modeSel = '<select data-path="assumptions.pensionMode" data-type="text">' +
        [["annuity", "Monthly annuity (קצבה)"], ["lump", "Lump / drawdown"]].map((m) => '<option value="' + m[0] + '"' + (st.assumptions.pensionMode === m[0] ? " selected" : "") + ">" + m[1] + "</option>").join("") + "</select>";
      el.innerHTML =
        "<h1>Pension (Israel)</h1>" +
        '<p class="lead">Income from your pension after retirement, modeled on Israeli rules: monthly קצבה = pot ÷ conversion coefficient, with a tax-exempt portion of the entitling-pension ceiling and the rest taxed at income-tax rates.</p>' +
        '<div class="grid-2">' +
        '<div class="panel"><h3>Pension settings</h3>' +
          '<div class="control"><label>Payout mode</label><div class="ctl-row">' + modeSel + "</div></div>" +
          ctl("Pension access age", "profile.pensionAccessAge", { min: 55, max: 70, step: 1, type: "int" }) +
          ctl("Conversion coefficient (מקדם המרה)", "assumptions.pensionAnnuityCoefficient", { min: 150, max: 260, step: 1, type: "int" }) +
          ctl("Entitling pension ceiling (today ₪/mo)", "assumptions.pensionEntitlingCeiling", { min: 5000, max: 15000, step: 10 }) +
          ctl("Tax-exempt portion of ceiling", "assumptions.pensionExemptionPct", { min: 0, max: 100, step: 1, suffix: "%" }) +
          '<div style="margin-top:10px">' + toggle("Annuity indexed to inflation (CPI)", "assumptions.pensionCpiLinked") + "</div>" +
          '<p class="hint">Public references: entitling-pension ceiling ≈ ₪9,430/mo; exempt portion currently ~52% (was slated to rise to 67%). Conversion coefficient typically ~200–225. <b>Management fees</b> (deposit & balance) are now set per pension / study-fund account on the <b>Accounts</b> page. Verify with your provider — this is an estimate, not advice.</p>' +
        "</div>" +
        '<div class="panel"><h3>Projected monthly pension at access age</h3><div id="pen-breakdown"></div></div>' +
        "</div>" +
        '<div class="panel"><h3>Pension account balance over time</h3><canvas id="pen-pot" height="240"></canvas></div>' +
        '<div class="panel"><h3>Net pension income over time</h3><canvas id="pen-line" height="240"></canvas></div>';
      this.update(el);
    },
    update(el) {
      const st = S();
      const p = FIRE.engine.project(st);
      const pi = p.pension;
      const bd = el.querySelector("#pen-breakdown");
      if (bd) {
        if (pi.mode === "lump") {
          bd.innerHTML = '<div class="callout">Lump / drawdown mode: the pension pot (≈ <b>' + money(pi.potAtAccess) + '</b> at age ' + pi.accessAge + ") becomes available at the access age and is drawn to fund spending like any other account. Switch to <b>annuity</b> mode to see a monthly קצבה with tax breakdown.</div>";
        } else {
          bd.innerHTML =
            '<table class="grid"><tbody>' +
            row2("Pot at access age " + pi.accessAge, money(pi.potAtAccess)) +
            row2("Conversion coefficient", pi.coefficient) +
            row2("Gross monthly annuity", "<b>" + money(pi.grossMonthly) + "</b>") +
            row2("Entitling ceiling (at access, inflated)", money(pi.entitlingCeilingAtAccess)) +
            row2("Tax-exempt portion (" + pi.exemptionPct + "%)", money(pi.exemptMonthly)) +
            row2("Taxable portion", money(pi.taxableMonthly)) +
            row2("Estimated income tax", "−" + money(pi.taxMonthly)) +
            row2("<b>Net monthly pension</b>", "<b>" + money(pi.netMonthly) + "</b>") +
            row2("Net monthly in today's ₪", money(pi.netMonthlyReal)) +
            "</tbody></table>" +
            '<p class="hint">Gross = pot ÷ coefficient. Exempt = ' + pi.exemptionPct + "% × (entitling ceiling, inflated to the access year). The taxable remainder is taxed at Israeli income-tax brackets. Annuity is CPI-linked in projections if enabled.</p>";
        }
      }
      const real = st.assumptions.realMode;
      const adj = (v, k) => (real ? v / Math.pow(1 + st.assumptions.inflation / 100, k) : v);

      // Pension account balance (pot) over time.
      const pot = el.querySelector("#pen-pot");
      if (pot) {
        C.line(pot, {
          labels: p.rows.map((r) => r.age),
          series: [{ name: "Pension pot", data: p.rows.map((r) => adj(r.pension, r.k)), color: "#4e79a7" }],
        });
      }

      const pl = el.querySelector("#pen-line");
      if (pl) {
        C.line(pl, {
          labels: p.rows.map((r) => r.age),
          series: [
            { name: "Pension gross/yr", data: p.rows.map((r) => adj(r.pensionGross, r.k)), color: "#b07aa1" },
            { name: "Pension net/yr", data: p.rows.map((r) => adj(r.pensionNet, r.k)), color: "#59a14f" },
          ],
        });
      }
    },
  };
  function row2(a, b) { return "<tr><td>" + a + '</td><td style="text-align:right">' + b + "</td></tr>"; }

  /* ============================ WHAT-IF ================================== */
  const whatif = {
    mount(el) {
      const st = S();
      const hs = FIRE.engine.holdings(st);
      // Resolve defaults ("__custom__" is always valid).
      if (st.whatif.sourceId !== "__custom__" && !hs.some((h) => h.id === st.whatif.sourceId)) st.whatif.sourceId = hs[0] ? hs[0].id : "";
      if (st.whatif.targetId !== "__custom__" && !hs.some((h) => h.id === st.whatif.targetId)) st.whatif.targetId = (hs.find((h) => h.id !== st.whatif.sourceId) || hs[0] || {}).id || "";
      const src = hs.find((h) => h.id === st.whatif.sourceId);
      const tgt = hs.find((h) => h.id === st.whatif.targetId);
      if (st.whatif.sourceGrowth == null && src) st.whatif.sourceGrowth = src.growth;
      if (st.whatif.targetGrowth == null && tgt) st.whatif.targetGrowth = tgt.growth;

      const opts = (sel) => hs.map((h) => '<option value="' + h.id + '"' + (h.id === sel ? " selected" : "") + ">" + escapeHtml(h.name) + " (" + money(h.value) + ")</option>").join("") +
        '<option value="__custom__"' + (sel === "__custom__" ? " selected" : "") + ">➕ Custom (not in my holdings)…</option>";
      const isCustomSrc = st.whatif.sourceId === "__custom__";
      const isCustomTgt = st.whatif.targetId === "__custom__";
      el.innerHTML =
        "<h1>What-if / Switch a holding</h1>" +
        '<p class="lead">See what happens if you <b>sell one holding and reinvest the net into another</b>. It pays the tax up front, then compares the two paths under each holding\'s growth — so you can judge whether a faster-growing target beats the tax drag and a slower one. Use <b>Custom</b> to model a holding you don\'t own yet (e.g. a future RSU grant).</p>' +
        '<div class="grid-2">' +
        '<div class="panel"><h3>Sell (source)</h3>' +
          '<div class="control"><label>Holding to sell</label><div class="ctl-row"><select data-whatif="source" data-type="text">' + opts(st.whatif.sourceId) + "</select></div></div>" +
          ctl("Sell how much", "whatif.sellPct", { min: 0, max: 100, step: 1, suffix: "%" }) +
          (isCustomSrc ? this.customEditor("customSource", st.whatif.customSource, "source")
                       : ctl("Its expected growth / yr", "whatif.sourceGrowth", { min: -5, max: 20, step: 0.1, suffix: "%" })) +
        "</div>" +
        '<div class="panel"><h3>Buy (target)</h3>' +
          '<div class="control"><label>Reinvest net into</label><div class="ctl-row"><select data-whatif="target" data-type="text">' + opts(st.whatif.targetId) + "</select></div></div>" +
          (isCustomTgt ? this.customEditor("customTarget", st.whatif.customTarget, "target")
                       : ctl("Its expected growth / yr", "whatif.targetGrowth", { min: -5, max: 20, step: 0.1, suffix: "%" })) +
          ctl("Horizon (years)", "whatif.years", { min: 1, max: 50, step: 1, type: "int" }) +
          '<div style="margin-top:10px">' + toggle("Account for capital-gains tax at the horizon (fair comparison)", "whatif.afterTax") + "</div>" +
        "</div>" +
        "</div>" +
        '<div class="panel"><h3>Result</h3><div id="wi-out"></div></div>' +
        '<div class="panel"><h3>Keep vs switch over time</h3><canvas id="wi-chart" height="280"></canvas></div>' +
        '<div class="panel"><h3>Year-by-year</h3><div class="table-wrap tall"><table class="grid tiny" id="wi-table"></table></div></div>';
      this.update(el);
    },
    customEditor(path, def, role) {
      const base = "whatif." + path;
      const kindSel = '<div class="control"><label>Type</label><div class="ctl-row"><select data-path="' + base + '.kind" data-type="text" data-remount="1">' +
        [["stock", "Stock / ETF"], ["rsu", "RSU / grant"]].map((k) => '<option value="' + k[0] + '"' + (def.kind === k[0] ? " selected" : "") + ">" + k[1] + "</option>").join("") + "</select></div></div>";
      const nameF = '<div class="control"><label>Name</label><div class="ctl-row"><input data-path="' + base + '.name" data-type="text" value="' + escapeHtml(def.name || "") + '"></div></div>';
      if (role === "target") {
        // Buying into the target: only growth & cap-gains matter.
        return kindSel + nameF +
          ctl("Expected growth / yr", base + ".growth", { min: -5, max: 25, step: 0.1, suffix: "%" }) +
          ctl("Capital-gains tax %", base + ".capGainsRate", { min: 0, max: 50, step: 1, suffix: "%" });
      }
      if (def.kind === "rsu") {
        return kindSel + nameF +
          '<div class="control"><label>Currency</label><div class="ctl-row"><select data-path="' + base + '.currency" data-type="text">' +
            ["USD", "ILS"].map((c) => "<option" + (def.currency === c ? " selected" : "") + ">" + c + "</option>").join("") + "</select></div></div>" +
          ctl("Share price", base + ".sharePrice", { min: 0, max: 5000, step: 0.5 }) +
          ctl("Vested shares", base + ".vestedShares", { min: 0, max: 100000, step: 1, type: "int" }) +
          ctl("Grant basis / share", base + ".grantBasisUsd", { min: 0, max: 5000, step: 1 }) +
          ctl("Ordinary tax % (on basis)", base + ".ordinaryTaxRate", { min: 0, max: 60, step: 1, suffix: "%" }) +
          ctl("Capital-gains % (appreciation)", base + ".capGainsRate", { min: 0, max: 50, step: 1, suffix: "%" }) +
          ctl("Expected growth / yr", base + ".growth", { min: -5, max: 25, step: 0.1, suffix: "%" });
      }
      return kindSel + nameF +
        ctl("Current value", base + ".value", { min: 0, max: 10000000, step: 1000 }) +
        ctl("Cost basis", base + ".costBasis", { min: 0, max: 10000000, step: 1000 }) +
        ctl("Capital-gains tax %", base + ".capGainsRate", { min: 0, max: 50, step: 1, suffix: "%" }) +
        ctl("Expected growth / yr", base + ".growth", { min: -5, max: 25, step: 0.1, suffix: "%" });
    },
    update(el) {
      const st = S();
      const sc = FIRE.engine.switchScenario(st);
      const out = el.querySelector("#wi-out");
      if (!sc) { if (out) out.innerHTML = "Add at least two holdings to compare."; return; }
      const at = st.whatif.afterTax;
      const nowYear = FIRE.state.refDate(st).getFullYear();
      const keepArr = sc.rows.map((r) => (at ? r.keepAT : r.keep));
      const swArr = sc.rows.map((r) => (at ? r.swAT : r.sw));
      const cross = at ? sc.crossoverAT : sc.crossover;
      const endKeep = keepArr[keepArr.length - 1], endSw = swArr[swArr.length - 1];
      const verdict = cross != null
        ? '<span class="ok">Switching overtakes keeping in year ' + cross + " (" + (nowYear + cross) + ")</span> and ends ~" + money(endSw - endKeep) + " ahead."
        : '<span class="bad">Keeping stays ahead the whole ' + sc.years + " years</span> — the upfront tax isn\u2019t recovered at these growth rates (ends ~" + money(endKeep - endSw) + " behind).";
      if (out) out.innerHTML =
        '<div class="pay-block"><div class="pay-row"><span>Sell ' + st.whatif.sellPct + "% of <b>" + escapeHtml(sc.src.name) + "</b></span><span>" + money(sc.sellGross) + "</span></div>" +
        '<div class="pay-row"><span>Tax to sell now</span><span>−' + money(sc.taxNow) + "</span></div>" +
        '<div class="pay-row pay-sum"><span>Net reinvested into ' + escapeHtml(sc.tgt.name) + "</span><span>" + money(sc.netReinvest) + "</span></div></div>" +
        "<p>Source grows " + sc.srcG.toFixed(1) + "%/yr, target " + sc.tgtG.toFixed(1) + "%/yr" + (at ? ", both shown after capital-gains tax at the horizon" : ", before any exit tax") + ".</p>" +
        "<p>" + verdict + "</p>";

      C.line(el.querySelector("#wi-chart"), {
        labels: sc.rows.map((r) => nowYear + r.t),
        series: [
          { name: "Keep " + shortName(sc.src.name), data: keepArr, color: "#e15759" },
          { name: "Switch → " + shortName(sc.tgt.name), data: swArr, color: "#59a14f" },
        ],
      });
      let head = "<thead><tr><th>Year</th><th>Keep</th><th>Switch</th><th>Difference</th></tr></thead>";
      let body = "<tbody>" + sc.rows.map((r) => {
        const k = at ? r.keepAT : r.keep, s = at ? r.swAT : r.sw, d = s - k;
        const cls = (cross != null && r.t === cross) ? ' class="fire-row"' : "";
        return "<tr" + cls + "><td>" + (nowYear + r.t) + "</td><td>" + money(k) + "</td><td>" + money(s) + '</td><td style="color:' + (d >= 0 ? "var(--ok)" : "var(--bad)") + '">' + (d >= 0 ? "+" : "") + money(d) + "</td></tr>";
      }).join("") + "</tbody>";
      el.querySelector("#wi-table").innerHTML = head + body;
    },
  };

  /* ============================ DATA ===================================== */
  const data = {
mount(el) {
  el.innerHTML =
    "<h1>Save / Load (your DB)</h1>" +
    '<p class="lead">State autosaves to this browser. Export a <code>.json</code> file to keep a portable snapshot, or load one back. You can also use Google sign-in with a Cloudflare Worker to store and retrieve your own plan.</p>' +
    '<div class="panel">' +
      "<h3>Plan name</h3>" +
      '<input id="data-name" data-path="meta.name" data-type="text" value="' + escapeHtml(S().meta.name) + '" style="width:100%;max-width:480px">' +
      '<div class="toolbar" style="margin-top:14px">' +
        '<button class="btn" data-action="save-file">⬇ Save to file</button>' +
        '<button class="btn" data-action="load-file">⬆ Load from file</button>' +
        '<button class="btn" data-action="load-sample">Load sample plan</button>' +
        '<button class="btn danger" data-action="reset">Reset to defaults</button>' +
        '<input type="file" id="data-file" accept="application/json" style="display:none">' +
      "</div>" +
      '<p class="hint">Last saved: <span id="data-saved">' + S().meta.savedAt + "</span></p>" +
    "</div>" +
    '<div class="panel">' +
      '<h3>Cloud sync with Google + Cloudflare Worker</h3>' +
      '<p class="hint">Google sign-in configuration is loaded automatically from the server. Signed in with the wrong account? Click <b>Sign out</b> to clear it and pick another.</p>' +
      '<p id="cloud-config-status" class="hint">Loading configuration...</p>' +
      '<div class="toolbar" style="margin-top:12px">' +
        '<button class="btn ghost" data-action="cloud-load">☁️ Load from cloud</button>' +
        '<button class="btn" data-action="cloud-save">☁️ Save to cloud</button>' +
        '<button class="btn ghost" data-action="cloud-sign-out">Sign out</button>' +
      "</div>" +
      '<div id="google-signin"></div>' +
      '<p id="cloud-status" class="hint">Loading cloud sync...</p>' +
    "</div>" +
    '<div class="panel"><h3>Raw state (read-only)</h3><textarea id="data-raw" rows="18" readonly></textarea></div>';

  this.update(el);
},
    update(el) {
      const raw = el.querySelector("#data-raw");
      if (raw) raw.value = FIRE.state.exportJSON();
      const sv = el.querySelector("#data-saved");
      if (sv) sv.textContent = S().meta.savedAt;
    },
  };

  /* ---- Misc helpers ------------------------------------------------------- */
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function shortName(n) { return n.length > 14 ? n.slice(0, 12) + "…" : n; }
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  // Calendar label (e.g. "Jul/33") for the year you reach a given age.
  function ageDateLabel(st, age) {
    const bs = st.profile.birthDate;
    if (bs) {
      const b = new Date(bs);
      if (!isNaN(b.getTime())) return MONTHS[b.getMonth()] + "/" + String(b.getFullYear() + age).slice(-2);
    }
    const now = FIRE.state.refDate(st);
    return String(now.getFullYear() + (age - Math.round(st.profile.currentAge)));
  }

  /* ============================ FIRE ==================================== */
  const fire = {
    mount(el) {
      el.innerHTML =
        "<h1>🔥 FIRE target</h1>" +
        '<p class="lead">The theoretical FIRE maths: how big a portfolio you need to live off a chosen <b>fixed</b> monthly spend at a safe withdrawal rate. Your <b>projections use your real Spending categories &amp; step-changes</b> — only tick the box below if you want them to assume this fixed spend instead.</p>' +
        '<div class="grid-2">' +
          '<div class="panel"><h3>Fixed spending &amp; withdrawal rate</h3>' +
            ctl("FIRE monthly spend (fixed target)", "spending.fireMonthly", { min: 0, max: 60000, step: 250 }) +
            ctl("Safe withdrawal rate (SWR)", "assumptions.swr", { min: 2, max: 6, step: 0.1, suffix: "%" }) +
            '<div style="margin-top:10px">' + toggle("Use this fixed spend for projections (instead of my real categories &amp; steps)", "spending.useHeadlineSpending") + "</div>" +
            '<p class="hint">SWR is the share of the portfolio you withdraw each year; the classic <b>4% rule</b> ≈ 25× your annual spend. Leave the box <b>unticked</b> to keep projections driven by your actual Spending page.</p>' +
          "</div>" +
          '<div class="panel"><h3>Portfolio target (theoretical)</h3><div id="fire-target"></div></div>' +
        "</div>" +
        '<div class="panel"><h3>Coverage &amp; earliest retirement age</h3><div id="fire-cover"></div></div>' +
        '<div class="panel"><h3>Sensitivity: years to FIRE target vs return</h3><canvas id="fire-sens" height="240"></canvas>' +
          '<p class="hint">For a range of expected taxable / money-market returns, the years until your projected non-pension assets reach the fixed-spend FIRE target above.</p></div>';
      this.update(el);
    },
    update(el) {
      const st = S();
      const p = FIRE.engine.project(st);
      const t = p.targets;
      const annual = st.spending.fireMonthly * 12;
      const tgt = el.querySelector("#fire-target");
      if (tgt) {
        tgt.innerHTML =
          "<p>For a fixed <b>" + money(st.spending.fireMonthly) + "/mo</b> (" + money(annual) + "/yr) at <b>" + t.swr + "%</b> you need:</p>" +
          '<div class="metric-value">' + money(t.target) + "</div>" +
          '<table class="mini"><tr><th>Rule</th><th>Portfolio needed</th><th>× annual</th></tr>' +
          "<tr><td>" + t.swr + "%</td><td>" + money(t.target) + "</td><td>" + (100 / t.swr).toFixed(0) + "×</td></tr>" +
          "<tr><td>4.0%</td><td>" + money(t.target4) + "</td><td>25×</td></tr>" +
          "<tr><td>3.5%</td><td>" + money(t.target35) + "</td><td>29×</td></tr>" +
          "<tr><td>3.0%</td><td>" + money(t.target3) + "</td><td>33×</td></tr></table>" +
          '<p class="hint">Flipped around: at <b>' + t.swr + "%</b>, your current net worth of <b>" + money(p.snapshot.total) + "</b> could sustain ≈ <b>" + money(p.snapshot.total * (t.swr / 100) / 12) + "/mo</b> forever (≈ " + money(p.snapshot.nonPension * (t.swr / 100) / 12) + "/mo from non-pension assets alone).</p>";
      }
      const cov = el.querySelector("#fire-cover");
      if (cov) {
        const fr = p.fireRow;
        const coverage = fr && t.target ? (fr.nonPension / t.target) * 100 : 0;
        const e = FIRE.engine.earliestFireAge(st);
        cov.innerHTML =
          "<p>At retirement age <b>" + st.profile.fireAge + "</b>, projected non-pension assets are <b>" + money(fr ? fr.nonPension : 0) + "</b> — <b>" + coverage.toFixed(0) + "%</b> of the " + money(t.target) + " target.</p>" +
          '<div class="bar-track"><div class="bar-fill ' + (coverage >= 100 ? "ok" : "warn") + '" style="width:' + Math.min(100, coverage) + '%"></div></div>' +
          (e.found
            ? "<p><b>Earliest retirement age at your real spending: " + e.age + "</b> " + (e.yearsAway <= 0 ? "(you could retire now 🎉)" : "(" + e.yearsAway + " year" + (e.yearsAway === 1 ? "" : "s") + " away)") + ". This uses your actual categories/steps and requires the plan to survive to " + st.profile.endAge + "." + (e.age !== Math.round(st.profile.fireAge) ? ' <button class="btn small" data-action="set-fire-age" data-age="' + e.age + '">Set retirement age to ' + e.age + "</button>" : "") + "</p>"
            : '<p class="hint" style="color:var(--bad)">No retirement age up to ' + st.profile.endAge + " survives at your current real spending &amp; assumptions. Lower spending, raise returns/income, or extend the horizon.</p>");
      }
      // Sensitivity: years until non-pension assets reach the fixed-spend target.
      const sens = el.querySelector("#fire-sens");
      if (sens) {
        const base = FIRE.state.clone(st);
        const returns = [2, 3, 4, 5, 6, 7, 8, 9, 10];
        const years = returns.map((r) => {
          const tt = FIRE.state.clone(base);
          tt.accounts.forEach((a) => { if (a.kind === "taxable" || a.kind === "money_market") a.expectedReturn = r; });
          (tt.income.grants || []).forEach((g) => { g.expectedGrowthPct = r + 1; });
          const pp = FIRE.engine.project(tt);
          const hit = pp.rows.find((row) => row.nonPension >= pp.targets.target);
          return hit ? hit.age - pp.A0 : null;
        });
        C.bar(sens, {
          labels: returns.map((r) => r + "%"),
          series: [{ name: "Years to target", data: years.map((y) => (y == null ? 0 : y)), color: "#f28e2b" }],
        });
      }
    },
  };

  FIRE.ui = {
    pages: { dashboard, accounts, assumptions, income, spending, fire, tracker, pension, projections, predictions, whatif, data },
    money, pct, escapeHtml,
  };
})();
