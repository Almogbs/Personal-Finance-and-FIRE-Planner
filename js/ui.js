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
          '<div class="panel"><h3>FIRE target coverage</h3>' +
            '<div style="margin-bottom:10px">' + toggle("Auto-calculate earliest possible FIRE age", "assumptions.showMinFireAge") + "</div>" +
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
        card("FIRE target @ " + p.targets.swr + "%", money(p.targets.target), "portfolio needed for ₪" + Math.round(st.spending.fireMonthly).toLocaleString() + "/mo") +
        card("Plan status", p.survives ? '<span class="ok">Survives to 80</span>' : '<span class="bad">Depletes @ ' + p.depletionAge + "</span>", "at FIRE age " + st.profile.fireAge) +
        (function () {
          const yrs = p.endAge - p.A0;
          const nom = p.endNetWorth, rl = nom / Math.pow(1 + st.assumptions.inflation / 100, yrs);
          return card("Net worth @ 80", money(real ? rl : nom),
            real ? ("nominal " + money(nom)) : ("≈ " + money(rl) + " in today's ₪"));
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

      // FIRE coverage
      const fireRow = p.fireRow;
      const cov = fireRow ? (fireRow.nonPension / p.targets.target) * 100 : 0;
      el.querySelector("#dash-fire").innerHTML =
        '<p>At FIRE age <b>' + st.profile.fireAge + "</b>, projected non-pension assets are <b>" + money(fireRow ? fireRow.nonPension : 0) + "</b>.</p>" +
        '<div class="bar-track"><div class="bar-fill ' + (cov >= 100 ? "ok" : "warn") + '" style="width:' + Math.min(100, cov) + '%"></div></div>' +
        "<p>That is <b>" + cov.toFixed(0) + "%</b> of the ₪" + Math.round(p.targets.target).toLocaleString() + " target (" + p.targets.swr + "% rule).</p>" +
        '<table class="mini"><tr><th>Rule</th><th>Target</th></tr>' +
        "<tr><td>4.0%</td><td>" + money(p.targets.target4) + "</td></tr>" +
        "<tr><td>3.5%</td><td>" + money(p.targets.target35) + "</td></tr>" +
        "<tr><td>3.0%</td><td>" + money(p.targets.target3) + "</td></tr></table>" +
        "<p>Pension at " + p.pension.accessAge + ": gross <b>" + money(p.pension.grossMonthly) + "/mo</b>, net after tax <b>" + money(p.pension.netMonthly) + "/mo</b> (≈ " + money(p.pension.netMonthlyReal) + "/mo in today's ₪). See the Pension page for the breakdown.</p>";

      // Optional: earliest survivable FIRE age.
      const mf = el.querySelector("#dash-minfire");
      if (mf) {
        if (st.assumptions.showMinFireAge) {
          const e = FIRE.engine.earliestFireAge(st);
          if (e.found) {
            const isNow = e.yearsAway <= 0;
            mf.innerHTML =
              '<div class="callout"><b>Earliest possible FIRE age: ' + e.age + "</b> " +
              (isNow ? "(you could retire now 🎉)" : "(" + e.yearsAway + " year" + (e.yearsAway === 1 ? "" : "s") + " from now)") +
              " — earliest age at which the plan survives to " + st.profile.endAge + " at current spending & assumptions." +
              (e.age !== Math.round(st.profile.fireAge) ? ' <button class="btn small" data-action="set-fire-age" data-age="' + e.age + '">Set FIRE age to ' + e.age + "</button>" : "") +
              "</div>";
          } else {
            mf.innerHTML = '<div class="callout"><span class="bad">No FIRE age up to ' + st.profile.endAge + " survives</span> with current spending & assumptions. Lower spending, raise returns/income, or extend the horizon.</div>";
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
            A("capGainsRate", "Cap-gains % (info)", a.capGainsRate, 1) +
            (a.kind === "pension" ? A("feeDeposit", "Mgmt fee — deposit %", a.feeDeposit, 0.01) : "") +
            (a.kind === "pension" || a.kind === "study_fund" ? A("feeBalance", "Mgmt fee — balance %/yr", a.feeBalance, 0.01) : "") +
            '<label class="acc-f"><span>Group</span><input data-arr="accounts" data-id="' + a.id + '" data-field="group" data-type="text" value="' + escapeHtml(a.group || "") + '"></label>' +
          "</div>" +
          '<div class="acc-flags">' + chk("liquid", "Liquid", a.liquid) + chk("includeInFire", "Count in FIRE", a.includeInFire) + "</div>" +
          '<input class="acc-notes" data-arr="accounts" data-id="' + a.id + '" data-field="notes" data-type="text" placeholder="Notes…" value="' + escapeHtml(a.notes || "") + '">' +
        "</div>"
      );
    },
    update(el) {
      const snap = FIRE.engine.snapshot(S());
      C.pie(el.querySelector("#acc-pie"), { slices: snap.accounts.map((a) => ({ name: a.name, value: a.valueILS })) });
      const byKind = {};
      snap.accounts.forEach((a) => (byKind[a.kind] = (byKind[a.kind] || 0) + a.valueILS));
      C.pie(el.querySelector("#acc-kind"), { doughnut: true, slices: Object.keys(byKind).map((k) => ({ name: kindLabel(k), value: byKind[k] })) });
    },
  };

  /* ==================== MARKET & ASSUMPTIONS ============================= */
  const assumptions = {
    mount(el) {
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
          ctl("FIRE age", "profile.fireAge", { min: 30, max: 70, step: 1, type: "int" }) +
          ctl("Pension access age", "profile.pensionAccessAge", { min: 55, max: 70, step: 1, type: "int" }) +
          ctl("Projection end age", "profile.endAge", { min: 70, max: 100, step: 1, type: "int" }) +
        "</div>" +
        "</div>" +
        '<div class="grid-2">' +
        '<div class="panel"><h3>Economy</h3>' +
          ctl("Inflation (annual)", "assumptions.inflation", { min: 0, max: 10, step: 0.1, suffix: "%" }) +
          ctl("Safe withdrawal rate", "assumptions.swr", { min: 2, max: 6, step: 0.1, suffix: "%" }) +
          ctl("Pension annuity coefficient", "assumptions.pensionAnnuityCoefficient", { min: 150, max: 260, step: 1, type: "int" }) +
          '<div style="margin-top:10px">' + toggle("Show values in real (today's ₪) terms", "assumptions.realMode") + "</div>" +
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
        '<div class="panel"><h3>Sensitivity: years to FIRE target vs return</h3><canvas id="asm-sens" height="240"></canvas></div>';
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
      // Simple sensitivity: for a range of taxable returns, re-project and find
      // the first working age where non-pension >= target.
      const base = FIRE.state.clone(st);
      const returns = [2, 3, 4, 5, 6, 7, 8, 9, 10];
      const years = returns.map((r) => {
        const t = FIRE.state.clone(base);
        t.accounts.forEach((a) => { if (a.kind === "taxable" || a.kind === "money_market") a.expectedReturn = r; });
        (t.income.grants || []).forEach((g) => { g.expectedGrowthPct = r + 1; });
        const p = FIRE.engine.project(t);
        const hit = p.rows.find((row) => row.nonPension >= p.targets.target);
        return hit ? hit.age - p.A0 : null;
      });
      C.bar(el.querySelector("#asm-sens"), {
        labels: returns.map((r) => r + "%"),
        series: [{ name: "Years to target", data: years.map((y) => (y == null ? 0 : y)), color: "#f28e2b" }],
      });
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
          '<div style="margin-top:10px">' + toggle("Stop salary at FIRE age", "income.stopSalaryAtFire") + "</div>" +
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
            '<input data-path="live.stockApiKey" data-type="text" placeholder="Finnhub API key (optional)" style="width:210px">' +
            '<input data-path="live.corsProxy" data-type="text" placeholder="CORS proxy URL (optional)" style="width:210px">' +
            '<span id="grants-status" class="hint"></span></div>' +
          '<div class="table-wrap"><table class="grid"><thead><tr><th>Name</th><th>Symbol</th><th>Cur</th><th>Price</th><th>Growth %</th><th>Vested sh.</th><th>Sh./yr</th><th>Basis</th><th>Ord. tax %</th><th>CG %</th><th>Vest from</th><th>Vest until</th><th></th></tr></thead><tbody id="income-grants"></tbody></table></div>' +
          '<div id="income-rsu-out" class="callout"></div>' +
          '<p class="hint">Live prices fetch by <b>Symbol</b> (e.g. AMZN, GOOG). It tries keyless Yahoo first; browsers usually block that (CORS), so either add a free <a href="https://finnhub.io/register" target="_blank" rel="noopener">Finnhub key</a> or a CORS-proxy URL prefix (e.g. <code>https://api.allorigins.win/raw?url=</code>). Only runs on click; keys are stored in your local plan.</p>' +
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
          "<td>" + f("stopAge", g.stopAge, 1, "int") + "</td>" +
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
        ? "Total vested equity: <b>" + money(gv.gross) + "</b> gross · tax <b>" + money(gv.tax) + "</b> · net <b>" + money(gv.net) + "</b> (eff. " + (gv.effectiveRate * 100).toFixed(1) + "%). Each grant appears as a computed account on the Accounts page; vesting stops at each grant's 'vest until' age or your FIRE age, whichever comes first."
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
        '<div class="panel"><h3>Headline</h3>' +
          ctl("FIRE monthly spend (headline target)", "spending.fireMonthly", { min: 0, max: 60000, step: 250 }) +
          ctl("Default category growth / yr", "spending.growthPct", { min: 0, max: 10, step: 0.1, suffix: "%" }) +
          '<div style="margin-top:10px">' + toggle("Use categories in retirement (else flat headline)", "spending.useCategoriesInRetirement") + "</div>" +
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

      // Preview: which rule decides spending at key ages.
      const prev = el.querySelector("#sp-preview");
      if (prev) {
        const A0 = Math.round(st.profile.currentAge), fa = Math.round(st.profile.fireAge);
        const stepAges = (st.spending.steps || []).map((s) => s.fromAge);
        const ages = Array.from(new Set([A0, fa - 1, fa].concat(stepAges).concat([60, st.profile.endAge])))
          .filter((a) => a >= A0 && a <= st.profile.endAge).sort((a, b) => a - b);
        const label = { step: '<span class="bad">step override</span>', headline: "flat headline", categories: "categories" };
        const rows = ages.map((a) => {
          const src = FIRE.engine.spendSourceAt(st, a);
          return "<tr><td>" + a + "</td><td>" + money(FIRE.engine.monthlySpend(st, a)) + "/mo</td><td>" + label[src] + "</td></tr>";
        }).join("");
        // If a step decides spending at the FIRE age, the retirement toggle is inert there.
        const stepInRetire = FIRE.engine.spendSourceAt(st, fa) === "step";
        prev.innerHTML =
          '<table class="grid"><thead><tr><th>Age</th><th>Monthly spend</th><th>Decided by</th></tr></thead><tbody>' + rows + "</tbody></table>" +
          '<p class="hint">Priority: <b>step override</b> → (in retirement) <b>flat headline</b> if "use categories in retirement" is off → otherwise <b>categories</b>.' +
          (stepInRetire ? ' <span class="bad">A step currently covers your retirement years, so the "use categories in retirement" toggle has no effect until you end/remove that step.</span>' : "") + "</p>";
      }
    },
  };

  /* ============================ TRACKER ================================= */
  const tracker = {
    budgetFor(c) { return c.freq === "yearly" ? (c.monthly || 0) / 12 : (c.monthly || 0); },
    mount(el) {
      el.innerHTML =
        "<h1>Expense Tracker</h1>" +
        '<p class="lead">Log what you actually spent each month and compare it to your budget (the category amounts from the Spending page). See which categories ran over or under. History is saved with your plan.</p>' +
        '<div class="toolbar"><input type="month" id="trk-month"><button class="btn small" data-action="add-month">+ Add month</button></div>' +
        '<div class="panel"><h3>Budget vs actual — total over time</h3><canvas id="trk-line" height="220"></canvas></div>' +
        '<div id="trk-months"></div>';
      this.renderMonths(el);
      this.update(el);
    },
    renderMonths(el) {
      const st = S();
      const cats = st.spending.categories || [];
      const months = (st.tracker.months || []).slice().sort((a, b) => b.ym.localeCompare(a.ym));
      el.querySelector("#trk-months").innerHTML = months.map((m) => {
        let bTot = 0, aTot = 0;
        const rows = cats.map((c) => {
          const bud = this.budgetFor(c);
          const act = (m.entries && m.entries[c.id]) || 0;
          const v = act - bud; bTot += bud; aTot += act;
          return "<tr><td>" + escapeHtml(c.name) + "</td><td>" + money(bud) + "</td>" +
            '<td><input class="num" data-trkm="' + m.id + '" data-trkc="' + c.id + '" data-type="float" type="number" step="10" value="' + act + '"></td>' +
            '<td style="color:' + (v > 0 ? "var(--bad)" : "var(--ok)") + '">' + (v > 0 ? "+" : "") + money(v) + "</td></tr>";
        }).join("");
        const vt = aTot - bTot;
        return '<div class="panel"><div class="acc-group-head"><h3>' + m.ym + '</h3><button class="btn danger small" data-action="del-month" data-id="' + m.id + '">✕</button></div>' +
          '<div class="table-wrap"><table class="grid"><thead><tr><th>Category</th><th>Budget</th><th>Actual</th><th>Δ vs budget</th></tr></thead><tbody>' + rows +
          '<tr class="fire-row"><td><b>Total</b></td><td>' + money(bTot) + "</td><td>" + money(aTot) + '</td><td style="color:' + (vt > 0 ? "var(--bad)" : "var(--ok)") + '"><b>' + (vt > 0 ? "+" : "") + money(vt) + "</b></td></tr>" +
          "</tbody></table></div></div>";
      }).join("") || '<p class="hint">No months yet — pick a month above and click “Add month”.</p>';
    },
    update(el) {
      const st = S();
      const cats = st.spending.categories || [];
      const budget = cats.reduce((s, c) => s + this.budgetFor(c), 0);
      const months = (st.tracker.months || []).slice().sort((a, b) => a.ym.localeCompare(b.ym));
      C.line(el.querySelector("#trk-line"), {
        labels: months.map((m) => m.ym),
        series: [
          { name: "Budget", data: months.map(() => budget), color: "#4e79a7" },
          { name: "Actual", data: months.map((m) => cats.reduce((s, c) => s + ((m.entries && m.entries[c.id]) || 0), 0)), color: "#e15759" },
        ],
      });
    },
  };

  /* ============================ PROJECTIONS ============================== */
  const projections = {
    mount(el) {
      el.innerHTML = "<h1>Projections</h1>" +
        '<p class="lead">Year-by-year balance until age ' + S().profile.endAge + ', <b>aggregated by account group</b> (one Brokerage, one Bank, one Pension…). The first row is the <b>current calendar year prorated</b> from today (partial income/vests/growth), so it won\'t double-count what already happened this year. Edit individual accounts on the Accounts page.</p>' +
        '<div class="toolbar">' +
          toggle("Real (today's ₪)", "assumptions.realMode") +
          '<button class="btn small" data-action="export-csv">⬇ Export CSV</button>' +
        "</div>" +
        '<div class="panel"><h3>All entities over time (stacked)</h3><canvas id="pr-stack" height="300"></canvas></div>' +
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
      '<p class="hint">Google sign-in configuration is loaded automatically from the server.</p>' +
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

  FIRE.ui = {
    pages: { dashboard, accounts, assumptions, income, spending, tracker, pension, projections, predictions, whatif, data },
    money, pct, escapeHtml,
  };
})();
