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
  function toggle(label, path, opts) {
    const val = !!getPath(S(), path);
    const remount = opts && opts.remount ? ' data-remount="1"' : "";
    return (
      '<label class="switch"><input type="checkbox" data-path="' + path + '" data-type="bool"' + remount + (val ? " checked" : "") + "> " + label + "</label>"
    );
  }
  function card(title, valueHtml, sub) {
    return '<div class="metric"><div class="metric-title">' + title + '</div><div class="metric-value">' + valueHtml + "</div>" + (sub ? '<div class="metric-sub">' + sub + "</div>" : "") + "</div>";
  }
  // Debounce for expensive computations (earliest/coast/barista ages run a
  // full projection per candidate age — don't do that on every keystroke).
  function debounce(fn, ms) {
    let t = null;
    return function () {
      const args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  }

  const KINDS = [
    ["cash", "Cash"], ["money_market", "Money market"], ["taxable", "Taxable brokerage"],
    ["study_fund", "Keren Hishtalmut"], ["pension", "Pension"], ["rsu", "RSU / equity"], ["custom", "Custom"],
  ];
  function kindLabel(k) { const f = KINDS.find((x) => x[0] === k); return f ? f[1] : k; }

  // Current combined monthly mortgage payment — shown as a read-only spending
  // item when the mortgage is part of the plan and the user hasn't opted out.
  function mortgageMonthlyNow(st) {
    if (!st.realEstate || st.realEstate.includeInPlan === false) return 0;
    return (st.realEstate.loans || []).reduce((s, l) => s + FIRE.engine.loanSchedule(l, st.assumptions.inflation, st.realEstate.scenario || {}).payNow, 0);
  }

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
          '<div class="panel"><h3>Net worth over time</h3><canvas id="dash-nw" height="260"></canvas></div>' +
          '<div class="panel"><h3>Current allocation</h3><canvas id="dash-alloc" height="260"></canvas></div>' +
        "</div>" +
        '<div class="grid-2">' +
          '<div class="panel"><h3 id="dash-alloc-fire-title">Allocation at retirement</h3><canvas id="dash-alloc-fire" height="260"></canvas></div>' +
          '<div class="panel"><h3>Liquid vs pension over time</h3><canvas id="dash-lp" height="260"></canvas></div>' +
        "</div>" +
        '<div class="panel"><h3>Retirement readiness</h3>' +
          '<div class="toolbar"><button class="btn small" data-action="find-earliest" data-target="dash-earliest">🔎 Find earliest retirement age</button></div>' +
          '<div id="dash-earliest"></div>' +
          '<div style="margin-bottom:10px">' + toggle("Auto-calculate earliest possible retirement age", "assumptions.showMinFireAge") + "</div>" +
          '<div id="dash-minfire"></div>' +
          '<div id="dash-fire"></div></div>';
      this.update(el);
    },
    update(el) {
      const st = S();
      const p = FIRE.engine.project(st);
      const snap = p.snapshot;
      const real = st.assumptions.realMode;
      const adj = (v, k) => (real ? v / Math.pow(1 + st.assumptions.inflation / 100, k) : v);

      const retLbl = eventLabel(st, st.profile.fireAge); // e.g. "2041 (age 45y 3m)"
      const m = el.querySelector("#dash-metrics");
      m.innerHTML =
        card("Current net worth", money(snap.total), "incl. pension, vested RSU" + (snap.reEquity ? " & real estate" : "")) +
        card("Liquid (excl. pension)", money(snap.nonPension), "spendable before pension access") +
        card("Pension", money(snap.pension), "locked until " + eventLabel(st, st.profile.pensionAccessAge)) +
        (snap.reValue || snap.reDebt
          ? card("Real estate equity", money(snap.reEquity), money(snap.reValue) + " value − " + money(snap.reDebt) + " debt")
          : "") +
        (function () {
          const faR = Math.round(st.profile.fireAge);
          const spMo = FIRE.engine.monthlySpend(st, faR);
          return card("Retirement spend", money(spMo) + "/mo", "your real modeled spend in " + retLbl);
        })() +
        card("Plan status", p.survives ? '<span class="ok">Survives to ' + st.profile.endAge + "</span>" : '<span class="bad">Depletes ' + eventLabel(st, p.depletionAge) + "</span>", "retiring " + retLbl) +
        (function () {
          const yrs = p.endAge - p.A0;
          const nom = p.endNetWorth, rl = nom / Math.pow(1 + st.assumptions.inflation / 100, yrs);
          return card("Net worth @ " + st.profile.endAge, money(real ? rl : nom),
            real ? ("nominal " + money(nom)) : ("≈ " + money(rl) + " in today's ₪"));
        })() +
        (function () {
          const togo = st.profile.fireAge - st.profile.currentAge;
          return card("Time to retirement", togo <= 0 ? "0" : fmtAgeYM(togo), "retiring " + retLbl);
        })() +
        (function () {
          const r0 = p.rows[0]; const inc = r0.salary + r0.extra;
          const sr = inc > 0 ? ((inc - r0.spend) / inc) * 100 : 0;
          return card("Savings rate (now)", (sr > 0 ? sr.toFixed(0) : "0") + "%", "of current take-home income");
        })() +
        (function () {
          const fr = p.fireRow; const nom = fr ? fr.total : 0;
          const rl = fr ? nom / Math.pow(1 + st.assumptions.inflation / 100, fr.k) : 0;
          return card("Net worth @ retirement", money(real ? rl : nom), retLbl + (real ? " (today's ₪)" : ""));
        })() +
        (function () {
          const fr = p.fireRow; const nom = fr ? fr.nonPension : 0;
          const rl = fr ? nom / Math.pow(1 + st.assumptions.inflation / 100, fr.k) : 0;
          return card("Liquid (excl. pension) @ retirement", money(real ? rl : nom), retLbl + (real ? " (today's ₪)" : ""));
        })() +
        (function () {
          const fr = p.fireRow; const spYr = FIRE.engine.monthlySpend(st, Math.round(st.profile.fireAge)) * 12;
          const wr = fr && fr.nonPension > 0 ? (spYr / fr.nonPension) * 100 : 0;
          return card("Withdrawal rate @ retirement", wr > 0 ? wr.toFixed(1) + "%" : "–", "real spend ÷ non-pension assets");
        })();

      // Net worth line (x-axis = calendar years; tooltip shows the year)
      const labels = p.rows.map((r) => r.year);
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

      // Allocation at retirement (by kind, from the retirement-year row)
      const afTitle = el.querySelector("#dash-alloc-fire-title");
      if (afTitle) afTitle.textContent = "Allocation at retirement — " + retLbl;
      const frAlloc = el.querySelector("#dash-alloc-fire");
      if (frAlloc) {
        const fr = p.fireRow;
        const kindById = {};
        p.accountsMeta.forEach((a) => (kindById[a.id] = a.kind));
        const byKindFire = {};
        if (fr) Object.keys(fr.perAccount).forEach((id) => {
          const k = kindById[id] || "custom";
          byKindFire[k] = (byKindFire[k] || 0) + fr.perAccount[id];
        });
        C.pie(frAlloc, {
          doughnut: true,
          slices: Object.keys(byKindFire).map((k) => ({ name: kindLabel(k), value: byKindFire[k] })),
        });
      }

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
        "<p>Retiring in <b>" + retLbl + "</b>, projected non-pension assets are <b>" + money(nonPen) + "</b>.</p>" +
        "<p>Your modeled spending that year is <b>" + money(spMo) + "/mo</b> (" + money(spYr) + "/yr) — from your real categories &amp; steps.</p>" +
        "<p>That pot alone covers ≈ <b>" + runway.toFixed(0) + "×</b> your first retirement year (before further growth &amp; pension).</p>" +
        '<div class="callout">' + (p.survives ? '<span class="ok">✓ Plan survives to ' + st.profile.endAge + "</span>" : '<span class="bad">✕ Depletes ' + eventLabel(st, p.depletionAge) + "</span>") + " when retiring " + retLbl + ", using your real spending.</div>" +
        "<p>Pension from " + eventLabel(st, p.pension.accessAge) + ": " +
        (p.pension.mode === "annuity"
          ? "gross <b>" + money(p.pension.grossMonthly) + "/mo</b>, net after tax <b>" + money(p.pension.netMonthly) + "/mo</b> (≈ " + money(p.pension.netMonthlyReal) + "/mo in today's ₪)."
          : "lump-sum withdrawal <b>" + money(p.pension.lumpGross) + "</b>, tax <b>" + money(p.pension.lumpTax) + "</b>, net deposited <b>" + money(p.pension.lumpNet) + "</b> (≈ " + money(p.pension.lumpNetReal) + " in today's ₪).") +
        "</p>" +
        '<p class="hint">The theoretical SWR portfolio target (fixed spend ÷ SWR) lives on the <b>🔥 FIRE</b> tab.</p>';

      // Optional: earliest survivable retirement age (debounced — it runs a
      // projection per candidate age).
      const mf = el.querySelector("#dash-minfire");
      if (mf) {
        if (st.assumptions.showMinFireAge) {
          mf.innerHTML = '<p class="hint">Computing earliest retirement age…</p>';
          this._minfire = this._minfire || debounce((host) => this.renderMinFire(host), 350);
          this._minfire(mf);
        } else {
          mf.innerHTML = "";
        }
      }
    },
    renderMinFire(mf) {
      const st = S();
      if (mf) {
        if (st.assumptions.showMinFireAge) {
          const e = FIRE.engine.earliestFireAge(st);
          if (e.found) {
            const isNow = e.yearsAway <= 0;
            mf.innerHTML =
              '<div class="callout"><b>Earliest possible retirement: age ' + e.age + " — " + eventLabel(st, e.age) + "</b> " +
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
          ctl("Pension access age (earliest 60 by law)", "profile.pensionAccessAge", { min: 60, max: 70, step: 1, type: "int" }) +
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
          '<p class="hint">Used when salary is entered as <b>gross</b> on the Income page. 2026 references: credit point ≈ ₪242/mo; employee NI+health <b>4.27%</b> up to ₪7,703/mo then <b>12.17%</b> up to the ₪51,910/mo insurable ceiling; pension 6% + 6.5% + severance 6% (mandatory minimum — 8.33% severance is common in tech); Keren Hishtalmut 2.5% + 7.5% (tax-exempt salary ceiling ₪15,712/mo). Note: a <b>comprehensive</b> pension fund (קרן פנסיה מקיפה) only accepts deposits up to ₪5,645/mo (20.5% × twice the average wage ≈ salary of ₪27,538/mo) — set the pension ceiling to ₪27,538 if your employer doesn\'t route the excess to a complementary fund. Verify with your payslip.</p>' +
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
          '<div class="table-wrap"><table class="grid"><thead><tr><th>Name</th><th>Symbol</th><th>Cur</th><th>Price</th><th>Growth %</th><th>Vested sh.</th><th>Sh./yr</th><th>Basis</th><th>Ord. tax %</th><th>CG %</th><th>Vest from</th><th>Vest until</th><th>Schedule</th><th></th></tr></thead><tbody id="income-grants"></tbody></table></div>' +
          '<div id="income-vests"></div>' +
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
      this.renderVests(el);
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
        // Either/or: a grant with a dated schedule ignores the flat model
        // entirely — vested shares are computed from past-dated events, and
        // Sh./yr + the vest window are ignored. Grey all of them out.
        const hasSched = (g.vests || []).length > 0;
        const schedCell = '<span class="hint" title="This grant uses its dated 📅 schedule — this field is ignored.">— 📅</span>';
        const vestedCell = hasSched
          ? '<span class="hint vested-comp" data-grant="' + g.id + '" title="Computed from the 📅 schedule: events dated on/before today count as already vested.">' + FIRE.state.vestedSharesOf(st, g) + " (📅)</span>"
          : f("vestedShares", g.vestedShares, 1, "int");
        return "<tr>" +
          '<td><input data-arr="income.grants" data-id="' + g.id + '" data-field="name" data-type="text" style="width:120px" value="' + escapeHtml(g.name) + '"></td>' +
          '<td><input data-arr="income.grants" data-id="' + g.id + '" data-field="symbol" data-type="text" style="width:64px" value="' + escapeHtml(g.symbol || "") + '"></td>' +
          "<td>" + curSel + "</td>" +
          "<td>" + f("sharePrice", g.sharePrice, 0.5) + "</td>" +
          "<td>" + f("expectedGrowthPct", g.expectedGrowthPct, 0.1) + "</td>" +
          "<td>" + vestedCell + "</td>" +
          "<td>" + (hasSched ? schedCell : f("sharesPerYear", g.sharesPerYear, 1, "int")) + "</td>" +
          "<td>" + f("grantBasisUsd", g.grantBasisUsd, 1) + "</td>" +
          "<td>" + f("ordinaryTaxRate", g.ordinaryTaxRate, 1) + "</td>" +
          "<td>" + f("capGainsRate", g.capGainsRate, 1) + "</td>" +
          "<td>" + (hasSched ? schedCell : f("startAge", g.startAge, 1, "int")) + "</td>" +
          "<td>" +
            (hasSched ? schedCell :
              (g.vestUntilRetire
                ? '<span class="hint" title="Tied to your retirement age">= ' + Math.round(st.profile.fireAge) + "</span>"
                : f("stopAge", g.stopAge, 1, "int")) +
              '<label class="acc-chk" style="margin-top:4px" title="Tie vest-until to your retirement age; updates automatically when you change it"><input type="checkbox" data-arr="income.grants" data-id="' + g.id + '" data-field="vestUntilRetire" data-type="bool" data-remount="1"' + (g.vestUntilRetire ? " checked" : "") + "> ret age</label>") +
          "</td>" +
          '<td><button class="btn small' + (this.selGrantId === g.id ? "" : " ghost") + '" data-action="grant-vests" data-id="' + g.id + '" title="Edit this grant\'s dated vesting schedule">📅 ' + ((g.vests || []).length || "add") + "</button></td>" +
          '<td><button class="btn danger small" data-action="del-grant" data-id="' + g.id + '">✕</button></td>' +
          "</tr>";
      }).join("") || '<tr><td colspan="14" style="text-align:center;color:var(--muted)">No grants — click “+ Add grant” if you have RSUs/options.</td></tr>';
    },
    // Dated vesting-schedule editor for the selected grant. Each event is a
    // (date, shares) pair; when a grant has any, they replace the flat
    // "Sh./yr within [from, until)" model for its FUTURE vests.
    selGrantId: null,
    renderVests(el) {
      const host = el.querySelector("#income-vests");
      if (!host) return;
      const st = S();
      const g = (st.income.grants || []).find((x) => x.id === this.selGrantId);
      if (!g) { host.innerHTML = ""; return; }
      const asOf = FIRE.state.refDate(st);
      const retireY = yearForAge(st, st.profile.fireAge);
      const events = (g.vests || []).slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
      const rows = events.map((v) => {
        const d = new Date(v.date);
        const past = !isNaN(d.getTime()) && d <= asOf;
        const postRet = !past && !isNaN(d.getTime()) && d.getFullYear() >= retireY;
        return "<tr>" +
          '<td><input type="date" data-vestg="' + g.id + '" data-vestid="' + v.id + '" data-vfield="date" value="' + escapeHtml(v.date || "") + '"></td>' +
          '<td><input class="num" type="number" step="1" min="0" data-vestg="' + g.id + '" data-vestid="' + v.id + '" data-vfield="shares" value="' + (v.shares || 0) + '"></td>' +
          '<td class="hint vest-when" data-grant="' + g.id + '" data-vest="' + v.id + '">' + (past ? "already vested ✓ (counted)" : postRet ? '<span class="bad">after retirement (' + retireY + "+) — not counted ✗</span>" : "future vest") + "</td>" +
          '<td><button class="btn danger small" data-action="del-vest" data-grant="' + g.id + '" data-id="' + v.id + '">✕</button></td>' +
          "</tr>";
      }).join("") || '<tr><td colspan="4" class="hint" style="text-align:center">No dated vests yet — this grant still uses the flat “Sh./yr” model.</td></tr>';
      host.innerHTML =
        '<div class="panel" style="margin-top:12px">' +
          '<div class="acc-group-head"><h4 style="margin:6px 0">Vesting schedule — ' + escapeHtml(g.name) + "</h4>" +
            '<button class="btn ghost small" data-action="grant-vests" data-id="' + g.id + '">Close</button></div>' +
          '<p class="hint" style="margin-top:0">Add each vest date with its share count (a grant can vest different amounts on different dates, past or future). A dated schedule <b>replaces</b> the “Vested sh. / Sh./yr / vest window” model entirely: events dated on or before today count as <b>already vested</b>, future ones vest on their date (priced at the grant\'s growth) and stop at your retirement year. Everything updates as you type.</p>' +
          '<div class="toolbar"><button class="btn small" data-action="add-vest" data-grant="' + g.id + '">+ Add vest date</button></div>' +
          '<div class="table-wrap" style="max-width:560px"><table class="grid"><thead><tr><th>Date</th><th>Shares</th><th></th><th></th></tr></thead><tbody>' + rows + "</tbody></table></div>" +
        "</div>";
    },
    // Live refresh of everything derived from one grant's schedule — the
    // computed vested-count cell, the 📅 button, and each event's past/future
    // tag — without rebuilding the inputs (keeps focus while typing).
    refreshVestDerived(el, grantId) {
      const st = S();
      const g = (st.income.grants || []).find((x) => x.id === grantId);
      if (!g || !el) return;
      const btn = el.querySelector('[data-action="grant-vests"][data-id="' + grantId + '"]');
      if (btn && btn.textContent.indexOf("Close") < 0) btn.textContent = "📅 " + ((g.vests || []).length || "add");
      const vc = el.querySelector('.vested-comp[data-grant="' + grantId + '"]');
      if (vc) vc.textContent = FIRE.state.vestedSharesOf(st, g) + " (📅)";
      const asOf = FIRE.state.refDate(st);
      const retireY = yearForAge(st, st.profile.fireAge);
      (g.vests || []).forEach((v) => {
        const cell = el.querySelector('.vest-when[data-grant="' + grantId + '"][data-vest="' + v.id + '"]');
        if (!cell) return;
        const d = new Date(v.date);
        const past = !isNaN(d.getTime()) && d <= asOf;
        if (past) cell.textContent = "already vested ✓ (counted)";
        else if (!isNaN(d.getTime()) && d.getFullYear() >= retireY) cell.innerHTML = '<span class="bad">after retirement (' + retireY + "+) — not counted ✗</span>";
        else cell.textContent = "future vest";
      });
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
    // Which list's categories are shown in the editor below (independent of
    // the ACTIVE list that projections use).
    editListId: null,
    mount(el) {
      const st = S();
      if (!this.editListId || !(st.spending.lists || []).some((l) => l.id === this.editListId)) {
        this.editListId = st.spending.activeListId;
      }
      const editList = (st.spending.lists || []).find((l) => l.id === this.editListId);
      el.innerHTML =
        "<h1>Spending</h1>" +
        '<p class="lead">Keep multiple named <b>lists</b> of spending categories (e.g. “Current”, “With kids”, “Lean”), toggle which one is active, and use step-changes to switch lists or override the total from a given age.</p>' +
        '<div class="grid-2">' +
        '<div class="panel"><h3>Spending lists</h3>' +
          '<div class="control"><label>Active list <span class="suffix">(drives projections &amp; the tracker)</span></label><div class="ctl-row">' +
            '<select data-path="spending.activeListId" data-type="text" data-remount="1">' +
              (st.spending.lists || []).map((l) => '<option value="' + l.id + '"' + (l.id === st.spending.activeListId ? " selected" : "") + ">" + escapeHtml(l.name) + "</option>").join("") +
            "</select></div></div>" +
          '<div class="control"><label>Edit list</label><div class="toolbar" style="margin-bottom:6px">' +
            (st.spending.lists || []).map((l) =>
              '<button class="btn small' + (l.id === this.editListId ? "" : " ghost") + '" data-action="sp-edit-list" data-id="' + l.id + '">' + escapeHtml(l.name) + (l.id === st.spending.activeListId ? " ✓" : "") + "</button>").join("") +
          "</div></div>" +
          '<div class="toolbar">' +
            '<button class="btn small" data-action="add-list">+ New list</button>' +
            '<button class="btn small ghost" data-action="dup-list" data-id="' + this.editListId + '">⧉ Duplicate</button>' +
            '<button class="btn danger small" data-action="del-list" data-id="' + this.editListId + '"' + ((st.spending.lists || []).length <= 1 ? " disabled" : "") + ">✕ Delete list</button>" +
          "</div>" +
          '<div class="control"><label>Rename “' + escapeHtml(editList ? editList.name : "") + '”</label><div class="ctl-row">' +
            '<input data-arr="spending.lists" data-id="' + this.editListId + '" data-field="name" data-type="text" value="' + escapeHtml(editList ? editList.name : "") + '"></div></div>' +
          ctl("Default category growth / yr", "spending.growthPct", { min: 0, max: 10, step: 0.1, suffix: "%" }) +
          '<p class="hint">Projections use the <b>active</b> list (or the list a step-change selects). The theoretical fixed-spend FIRE target lives on the <b>🔥 FIRE</b> tab.</p>' +
        "</div>" +
        '<div class="panel"><h3 id="sp-pie-title">Spending mix (at current age)</h3><canvas id="sp-pie" height="240"></canvas></div>' +
        "</div>" +
        '<div class="panel"><h3>Categories — list “' + escapeHtml(editList ? editList.name : "") + '”' + (this.editListId === st.spending.activeListId ? " (active)" : "") + "</h3>" +
          '<div class="toolbar"><button class="btn small" data-action="add-cat">+ Add category</button></div>' +
          '<div class="table-wrap"><table class="grid"><thead><tr><th>Name</th><th>Amount</th><th>Per</th><th>Start age</th><th>End age</th><th>Growth %</th><th>Inflate</th><th></th></tr></thead><tbody id="sp-cats"></tbody></table></div>' +
          '<div id="sp-total" class="callout"></div>' +
          ((st.realEstate && (st.realEstate.loans || []).length && st.realEstate.includeInPlan !== false)
            ? '<div style="margin-top:10px">' + toggle("Show the mortgage payment as a spending item here (it's always paid in the cashflow either way)", "spending.showMortgage", { remount: 1 }) + "</div>"
            : "") +
        "</div>" +
        '<div class="panel"><h3>Step changes (differential spending)</h3>' +
          '<div class="toolbar"><button class="btn small" data-action="add-step">+ Add step</button></div>' +
          '<p class="hint">A step takes effect from a given age. <b>Fixed amount</b> overrides the total (grows by default category growth); <b>Use list</b> switches the plan to another category list from that age (e.g. from age 35 use “With kids”).</p>' +
          '<div class="table-wrap"><table class="grid"><thead><tr><th>From age</th><th>Mode</th><th>Amount</th><th>Per</th><th>List</th><th>Note</th><th></th></tr></thead><tbody id="sp-steps"></tbody></table></div>' +
        "</div>" +
        '<div class="panel"><h3>Spending used by age (which rule wins)</h3><div id="sp-preview"></div></div>' +
        '<div class="panel"><h3>Projected spending over time</h3><canvas id="sp-line" height="240"></canvas></div>';
      this.renderCats(el);
      this.renderSteps(el);
      this.update(el);
    },
    renderCats(el) {
      const st = S();
      const cats = FIRE.state.listCategories(st, this.editListId);
      el.querySelector("#sp-cats").innerHTML = cats.map((c) => {
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
      }).join("") || '<tr><td colspan="8" class="hint" style="text-align:center">This list is empty — click “+ Add category”.</td></tr>';
      // Read-only mortgage row (driven by the Mortgage tab; opt-out below).
      const mortNow = st.spending.showMortgage !== false ? mortgageMonthlyNow(st) : 0;
      if (mortNow > 0) {
        el.querySelector("#sp-cats").innerHTML +=
          '<tr class="trk-subtotal"><td>🏠 Mortgage <span class="hint">(auto — edit on the Mortgage tab)</span></td>' +
          "<td><b>" + money(mortNow) + "</b></td><td>/ month</td>" +
          '<td colspan="4" class="hint">until payoff · follows the rate scenario &amp; CPI linkage</td><td></td></tr>';
      }
    },
    renderSteps(el) {
      const st = S();
      el.querySelector("#sp-steps").innerHTML = (st.spending.steps || []).map((s) => {
        const f = (field, val, step, type) => '<input class="num" data-arr="spending.steps" data-id="' + s.id + '" data-field="' + field + '" data-type="' + (type || "float") + '" type="number" step="' + (step || 1) + '" value="' + val + '">';
        const mode = s.mode || "amount";
        const modeSel = '<select data-arr="spending.steps" data-id="' + s.id + '" data-field="mode" data-type="text">' +
          [["amount", "Fixed amount"], ["list", "Use list"]].map((m) => '<option value="' + m[0] + '"' + (mode === m[0] ? " selected" : "") + ">" + m[1] + "</option>").join("") + "</select>";
        // Always clickable — picking a list switches the step to "Use list".
        const listSel = '<select data-arr="spending.steps" data-id="' + s.id + '" data-field="listId" data-type="text" title="Picking a list switches this step to Use-list mode">' +
          '<option value=""' + (!s.listId ? " selected" : "") + ">—</option>" +
          (st.spending.lists || []).map((l) => '<option value="' + l.id + '"' + (s.listId === l.id ? " selected" : "") + ">" + escapeHtml(l.name) + "</option>").join("") + "</select>";
        const dis = mode === "list" ? " disabled" : "";
        return "<tr>" +
          "<td>" + f("fromAge", s.fromAge, 1, "int") + "</td>" +
          "<td>" + modeSel + "</td>" +
          '<td><input class="num" data-arr="spending.steps" data-id="' + s.id + '" data-field="monthly" data-type="float" type="number" step="250" value="' + s.monthly + '"' + dis + "></td>" +
          "<td>" + (mode === "list" ? '<span class="hint">—</span>' : freqSelect("spending.steps", s.id, s.freq)) + "</td>" +
          "<td>" + listSel + "</td>" +
          '<td><input data-arr="spending.steps" data-id="' + s.id + '" data-field="note" data-type="text" value="' + escapeHtml(s.note || "") + '"></td>' +
          '<td><button class="btn danger small" data-action="del-step" data-id="' + s.id + '">✕</button></td>' +
          "</tr>";
      }).join("");
    },
    update(el) {
      const st = S();
      const age = Math.round(st.profile.currentAge);
      const bd = FIRE.engine.spendBreakdown(st, age);
      const mortNow = st.spending.showMortgage !== false ? mortgageMonthlyNow(st) : 0;
      const slices = bd.map((b) => ({ name: b.name, value: b.monthly }));
      if (mortNow > 0) slices.push({ name: "🏠 Mortgage", value: mortNow, color: "#9c755f" });
      C.pie(el.querySelector("#sp-pie"), { doughnut: true, slices });

      // Total of the list being EDITED (categories active at the current age,
      // yearly items amortized to monthly) — follows the Edit-list chips, not
      // just the active list.
      const editId = this.editListId || st.spending.activeListId;
      const editList = (st.spending.lists || []).find((l) => l.id === editId);
      const isActive = editId === st.spending.activeListId;
      const editCats = FIRE.state.listCategories(st, editId)
        .filter((c) => age >= c.startAge && age <= c.endAge);
      const totMonthly = editCats.reduce((s, c) => s + (c.freq === "yearly" ? (c.monthly || 0) / 12 : (c.monthly || 0)), 0);
      const totEl = el.querySelector("#sp-total");
      if (totEl) {
        totEl.innerHTML = "<b>Total of list “" + escapeHtml(editList ? editList.name : "?") + "”:</b> " +
          money(totMonthly) + "/month · " + money(totMonthly * 12) + "/year" +
          " (across " + editCats.length + " active " + (editCats.length === 1 ? "category" : "categories") + ")." +
          (isActive && mortNow > 0 ? " Plus <b>🏠 mortgage " + money(mortNow) + "/mo</b> → <b>" + money(totMonthly + mortNow) + "/mo</b> all-in." : "") +
          (isActive ? "" : ' <span class="hint">Not the active list — projections &amp; the doughnut use the active one.</span>') +
          " Yearly items are shown as their monthly-equivalent here.";
      }
      const p = FIRE.engine.project(st);
      C.line(el.querySelector("#sp-line"), {
        labels: p.rows.map((r) => r.year),
        series: [{ name: "Annual spend", data: p.rows.map((r) => r.spend), color: "#e15759" }],
      });

      // Preview: which rule decides spending across age ranges. Grouped into
      // contiguous segments — and when a step is in force, segments break per
      // individual step, so every step you defined shows as its own range.
      const prev = el.querySelector("#sp-preview");
      if (prev) {
        const A0 = Math.round(st.profile.currentAge), end = st.profile.endAge;
        const listName = (lid) => { const l = (st.spending.lists || []).find((x) => x.id === lid); return l ? l.name : "?"; };
        const segs = [];
        for (let a = A0; a <= end; a++) {
          const src = FIRE.engine.spendSourceAt(st, a);
          const step = (src === "step" || src === "list") ? FIRE.engine.stepAt(st, a) : null;
          const key = src + "|" + (step ? step.id : "");
          const last = segs[segs.length - 1];
          if (last && last.key === key) last.a1 = a;
          else segs.push({ key: key, src: src, step: step, a0: a, a1: a });
        }
        const rows = segs.map((sg) => {
          const y0 = yearForAge(st, sg.a0), y1 = yearForAge(st, sg.a1);
          const whenLbl = sg.a0 === sg.a1 ? yearAgeLabel(st, y0, sg.a0) : yearAgeLabel(st, y0, sg.a0) + " → " + yearAgeLabel(st, y1, sg.a1);
          const m0 = FIRE.engine.monthlySpend(st, sg.a0), m1 = FIRE.engine.monthlySpend(st, sg.a1);
          const amt = sg.a0 === sg.a1 ? money(m0) + "/mo" : money(m0) + " → " + money(m1) + "/mo";
          let decided;
          if (sg.src === "step") {
            decided = '<span class="bad">step override</span>' + (sg.step ? " — from " + eventLabel(st, sg.step.fromAge) + (sg.step.note ? " (" + escapeHtml(sg.step.note) + ")" : "") : "");
          } else if (sg.src === "list") {
            decided = '<span class="ok">list “' + escapeHtml(listName(sg.step && sg.step.listId)) + "”</span>" + (sg.step ? " — from " + eventLabel(st, sg.step.fromAge) + (sg.step.note ? " (" + escapeHtml(sg.step.note) + ")" : "") : "");
          } else {
            decided = sg.src === "headline" ? "fixed FIRE spend" : "categories (list “" + escapeHtml(listName(st.spending.activeListId)) + "”)";
          }
          return "<tr><td>" + whenLbl + "</td><td>" + amt + "</td><td>" + decided + "</td></tr>";
        }).join("");
        prev.innerHTML =
          '<table class="grid"><thead><tr><th>When</th><th>Monthly spend</th><th>Decided by</th></tr></thead><tbody>' + rows + "</tbody></table>" +
          '<p class="hint">Priority: the <b>latest step</b> whose age you\'ve passed wins (each step persists until the next one; a “Use list” step switches category lists) → in retirement, <b>fixed FIRE spend</b> if enabled on the <b>🔥 FIRE</b> tab → otherwise the <b>active list</b>\'s categories.</p>';
      }
    },
  };

  /* ============================ TRACKER ================================= */
  const tracker = {
    selMonthId: null,
    selYearId: null,
    budgetFor(c) { return c.freq === "yearly" ? (c.monthly || 0) / 12 : (c.monthly || 0); },
    // Budget categories come from the ACTIVE spending list only.
    monthlyCats(st) { return FIRE.state.listCategories(st, st.spending.activeListId).filter((c) => c.freq !== "yearly"); },
    yearlyCats(st) { return FIRE.state.listCategories(st, st.spending.activeListId).filter((c) => c.freq === "yearly"); },
    // A category can be excluded from one specific month/year (e.g. an item
    // that only applies from July onward) without touching the budget list.
    isExcluded(item, c) { return !!(item && item.excluded && item.excluded[c.id]); },

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
      const nowYm = FIRE.state.refDate(st).toISOString().slice(0, 7);
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
      const nowYm = FIRE.state.refDate(st).toISOString().slice(0, 7);
      const months = (st.tracker.months || []).slice().sort((a, b) => b.ym.localeCompare(a.ym));
      if (!months.length) { grid.innerHTML = '<p class="hint">No months yet — pick a month above and click “Add / open month”.</p>'; return; }
      grid.innerHTML = months.map((m) => {
        const inc = cats.filter((c) => !this.isExcluded(m, c));
        const budget = inc.reduce((s, c) => s + this.budgetFor(c), 0);
        const act = inc.reduce((s, c) => s + ((m.entries && m.entries[c.id]) || 0), 0);
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
      const nowYear = FIRE.state.refDate(st).getFullYear();
      const years = (st.tracker.years || []).slice().sort((a, b) => b.year - a.year);
      if (!years.length) { grid.innerHTML = '<p class="hint">No years yet — pick a year above and click “Add / open year”.</p>'; return; }
      grid.innerHTML = years.map((y) => {
        const inc = cats.filter((c) => !this.isExcluded(y, c));
        const budget = inc.reduce((s, c) => s + (c.monthly || 0), 0); // annual budget
        const act = inc.reduce((s, c) => s + ((y.entries && y.entries[c.id]) || 0), 0);
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
        rows = '<tr><td colspan="5" class="hint" style="text-align:center">No ' + opts.kind + " categories on the Spending page (active list).</td></tr>";
      } else {
        rows = cats.map((c) => {
          const b = opts.budgetOf(c);
          const a = (item.entries && item.entries[c.id]) || 0;
          const ex = this.isExcluded(item, c);
          const exBtn = '<button class="btn small' + (ex ? "" : " ghost") + '" data-action="trk-excl" data-kind="' + opts.exKind + '" data-item="' + item.id + '" data-cat="' + c.id + '" title="' + (ex ? "Include this category in " + opts.title : "Exclude this category from " + opts.title + " only (stays in the budget list)") + '">' + (ex ? "↩ include" : "🚫 skip") + "</button>";
          return '<tr class="' + (ex ? "trk-excl" : "") + '"><td>' + escapeHtml(c.name) + "</td><td>" + money(b) + "</td>" +
            '<td><input class="num" ' + opts.inputAttr(c) + ' data-type="float" type="number" step="' + opts.step + '" min="0" value="' + a + '"' + (ex ? " disabled" : "") + "></td>" +
            '<td class="td-delta" data-c="' + c.id + '"></td>' +
            "<td>" + exBtn + "</td></tr>";
        }).join("");
      }
      return '<div class="acc-group-head"><h4 style="margin:6px 0">' + opts.title + "</h4>" +
          '<button class="btn danger small" data-action="' + opts.delAction + '" data-id="' + item.id + '" title="Delete">✕ ' + opts.delLabel + "</button></div>" +
        '<input class="acc-notes" data-arr="' + opts.arr + '" data-id="' + item.id + '" data-field="note" data-type="text" placeholder="' + opts.notePh + '" value="' + escapeHtml(item.note || "") + '">' +
        '<div class="table-wrap"><table class="grid"><thead><tr><th>Category</th><th>' + opts.budgetHdr + '</th><th>Actual</th><th>Δ vs budget</th><th></th></tr></thead><tbody>' +
          rows +
          '<tr class="trk-subtotal"><td><b>Total</b></td><td class="trk-sum" data-fld="b"></td><td class="trk-sum" data-fld="a"></td><td class="trk-sum" data-fld="d"></td><td></td></tr>' +
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
        exKind: "m",
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
        exKind: "y",
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
        const cell = host.querySelector('.td-delta[data-c="' + c.id + '"]');
        if (this.isExcluded(item, c)) { if (cell) { cell.textContent = "—"; cell.style.color = "var(--muted)"; } return; }
        const b = budgetOf(c), a = (item.entries && item.entries[c.id]) || 0;
        bTot += b; aTot += a;
        put(cell, a - b, true);
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

      // Budget vs actual over time (monthly categories only; per-month
      // budgets respect that month's exclusions).
      const cats = this.monthlyCats(st);
      const months = (st.tracker.months || []).slice().sort((a, b) => a.ym.localeCompare(b.ym));
      const mInc = (m) => cats.filter((c) => !this.isExcluded(m, c));
      C.line(el.querySelector("#trk-line"), {
        labels: months.map((m) => m.ym),
        series: [
          { name: "Budget", data: months.map((m) => mInc(m).reduce((s, c) => s + this.budgetFor(c), 0)), color: "#4e79a7" },
          { name: "Actual", data: months.map((m) => mInc(m).reduce((s, c) => s + ((m.entries && m.entries[c.id]) || 0), 0)), color: "#e15759" },
        ],
      });

      // Budget vs actual over time (yearly one-off categories).
      const ycats = this.yearlyCats(st);
      const years = (st.tracker.years || []).slice().sort((a, b) => a.year - b.year);
      const yInc = (y) => ycats.filter((c) => !this.isExcluded(y, c));
      const yCanvas = el.querySelector("#trk-year-line");
      if (yCanvas) {
        C.line(yCanvas, {
          labels: years.map((y) => y.year),
          series: [
            { name: "Budget", data: years.map((y) => yInc(y).reduce((s, c) => s + (c.monthly || 0), 0)), color: "#4e79a7" },
            { name: "Actual", data: years.map((y) => yInc(y).reduce((s, c) => s + ((y.entries && y.entries[c.id]) || 0), 0)), color: "#e15759" },
          ],
        });
      }
    },
  };

  /* ============================ PROJECTIONS ============================== */
  const projections = {
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
          cur = { sig: s, a0: r.age, a1: r.age, y0: r.year, y1: r.year, working: r.working, n: 0, sal: 0, pen: 0, wdNet: 0, wdTax: 0, bySrc: {} };
          phases.push(cur);
        }
        cur.a1 = r.age; cur.y1 = r.year; cur.n++;
        cur.sal += r.salary + r.extra; cur.pen += r.pensionNet;
        cur.wdNet += r.withdrawalNet; cur.wdTax += r.withdrawalTax;
        Object.keys(r.sources || {}).forEach((id) => { const g = p.groupOf[id] || id; cur.bySrc[g] = (cur.bySrc[g] || 0) + r.sources[id]; });
      });
      const items = phases.map((ph) => {
        const yr = ph.y0 === ph.y1 ? String(ph.y0) : ph.y0 + "–" + ph.y1;
        const aEnd0 = ageAtYearEnd(st, ph.y0), aEnd1 = ageAtYearEnd(st, ph.y1);
        const ages = aEnd0 != null
          ? (ph.y0 === ph.y1 ? "age " + fmtAgeYM(aEnd0) : "ages " + fmtAgeYM(aEnd0) + "–" + fmtAgeYM(aEnd1) + " at year-end")
          : (ph.a0 === ph.a1 ? "age " + ph.a0 : "ages " + ph.a0 + "–" + ph.a1);
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
      const dep = p.depletionAge ? '<p class="hint" style="color:var(--bad)">⚠ Liquid assets are projected to run out in ' + eventLabel(st, p.depletionAge) + ".</p>" : "";
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
      const labels = p.rows.map((r) => r.year);
      const groups = p.groupsMeta; // aggregate holdings by account group
      const gVal = (r, g) => g.ids.reduce((s, id) => s + (r.perAccount[id] || 0), 0);

      // Stacked per-group (e.g. one "Brokerage", one "Bank", one "Pension"…)
      const series = groups.map((g, i) => ({
        name: g.name,
        color: C.PALETTE[i % C.PALETTE.length],
        data: p.rows.map((r) => adj(gVal(r, g), r.k)),
      }));
      C.bar(el.querySelector("#pr-stack"), { labels, stacked: true, series });

      // Income vs spending (incl. pension income and living withdrawals).
      // Optional series only appear when they exist in the plan.
      const hasOldAge = p.rows.some((r) => r.oldAge > 0);
      const hasRent = p.rows.some((r) => r.rentIncome > 0);
      const hasMortgage = p.rows.some((r) => r.mortgagePay > 0);
      const ioSeries = [
        { name: "Salary + extra", data: p.rows.map((r) => adj(r.salary + r.extra, r.k)), color: "#4e79a7" },
        { name: "Pension (net)", data: p.rows.map((r) => adj(r.pensionNet, r.k)), color: "#b07aa1" },
      ];
      if (hasOldAge) ioSeries.push({ name: "Old-age (BL)", data: p.rows.map((r) => adj(r.oldAge, r.k)), color: "#59a14f" });
      if (hasRent) ioSeries.push({ name: "Rent", data: p.rows.map((r) => adj(r.rentIncome, r.k)), color: "#8cd17d" });
      if (hasMortgage) ioSeries.push({ name: "Mortgage payments", data: p.rows.map((r) => adj(r.mortgagePay, r.k)), color: "#9c755f" });
      ioSeries.push({ name: "Withdrawn for living (net)", data: p.rows.map((r) => adj(r.withdrawalNet, r.k)), color: "#f28e2b" });
      ioSeries.push({ name: "Spending", data: p.rows.map((r) => adj(r.spend, r.k)), color: "#e15759" });
      C.line(el.querySelector("#pr-io"), { labels, series: ioSeries });

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

      // Table — one column per group. Each row = END of that calendar year,
      // so the age column shows your exact age (y+m) at year-end. Real-estate
      // and old-age columns only appear when the plan uses them.
      const hasRE = p.rows.some((r) => r.reValue > 0 || r.reDebt > 0);
      let head = "<thead><tr><th>Year</th><th>Age (at year-end)</th><th>Phase</th><th>Salary+extra</th><th>" + (hasOldAge ? "Pension+BL net" : "Pension net") + "</th><th>Withdrawn</th><th>Spend" + (hasMortgage ? "+mortg." : "") + "</th>" +
        groups.map((g) => "<th>" + escapeHtml(shortName(g.name)) + "</th>").join("") +
        (hasRE ? "<th>RE equity</th>" : "") +
        "<th>Total</th><th>Liquid</th></tr></thead>";
      let body = "<tbody>" + p.rows.map((r) => {
        const cls = r.age === Math.round(st.profile.fireAge) ? ' class="fire-row"' : (p.depletionAge && r.age === p.depletionAge ? ' class="dep-row"' : "");
        const aEnd = ageAtYearEnd(st, r.year);
        return "<tr" + cls + "><td>" + r.year + '</td><td class="pay-date">' + (aEnd != null ? fmtAgeYM(aEnd) : r.age) + "</td><td>" + (r.working ? "work" : "retire") + "</td>" +
          "<td>" + money(adj(r.salary + r.extra, r.k)) + "</td>" +
          "<td>" + money(adj(r.pensionNet + r.oldAge, r.k)) + "</td>" +
          "<td>" + money(adj(r.withdrawalNet, r.k)) + "</td>" +
          "<td>" + money(adj(r.spend + r.mortgagePay, r.k)) + "</td>" +
          groups.map((g) => "<td>" + money(adj(gVal(r, g), r.k)) + "</td>").join("") +
          (hasRE ? "<td>" + money(adj(r.reEquity, r.k)) + "</td>" : "") +
          "<td><b>" + money(adj(r.total, r.k)) + "</b></td><td>" + money(adj(r.liquid, r.k)) + "</td></tr>";
      }).join("") + "</tbody>";
      el.querySelector("#pr-table").innerHTML = head + body;
    },
    exportCSV() {
      const st = S();
      const p = FIRE.engine.project(st);
      const groups = p.groupsMeta;
      const gVal = (r, g) => g.ids.reduce((s, id) => s + (r.perAccount[id] || 0), 0);
      const cols = ["year", "age_at_year_end", "phase", "salary_extra", "pension_net", "old_age", "rent", "mortgage_pay", "withdrawn_net", "withdrawn_tax", "spend"].concat(groups.map((g) => g.name)).concat(["re_equity", "total", "liquid", "pension_pot"]);
      const lines = [cols.join(",")];
      p.rows.forEach((r) => {
        const aEnd = ageAtYearEnd(st, r.year);
        const row = [r.year, aEnd != null ? aEnd.toFixed(2) : r.age, r.working ? "work" : "retire", Math.round(r.salary + r.extra), Math.round(r.pensionNet), Math.round(r.oldAge), Math.round(r.rentIncome), Math.round(r.mortgagePay), Math.round(r.withdrawalNet), Math.round(r.withdrawalTax), Math.round(r.spend)]
          .concat(groups.map((g) => Math.round(gVal(r, g))))
          .concat([Math.round(r.reEquity), Math.round(r.total), Math.round(r.liquid), Math.round(r.pension)]);
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
    // All calendar years shown: baseline years ∪ recorded-actual years.
    allYears(pr) {
      const set = {};
      (pr.years || []).forEach((r) => (set[r.year] = true));
      Object.keys(pr.actuals || {}).forEach((y) => (set[y] = true));
      return Object.keys(set).map(Number).sort((a, b) => a - b);
    },
    // Accounts to show in the detail table: the baseline's meta if saved,
    // otherwise the current plan's accounts (incl. computed grants).
    accountList(st, pr) {
      if (pr.accounts && pr.accounts.length) return pr.accounts;
      return FIRE.engine.snapshot(st).accounts.map((a) => ({ id: a.id, name: a.name }));
    },
    mount(el) {
      const st = S();
      const pr = st.predictions;
      const nowYear = FIRE.state.refDate(st).getFullYear();
      const hasBaseline = pr.years && pr.years.length;
      const explain =
        '<div class="panel"><h3>How this works</h3><ol style="margin:6px 0 0;padding-left:20px">' +
        "<li><b>Save a baseline</b> — freezes a copy of today's projection, one box per <b>calendar year</b>. This is the prediction you'll be measured against (it doesn't change when you tweak the plan — until you update it).</li>" +
        "<li><b>Record actuals</b> — for any calendar year (including past years): one click records this year's real balances, or add a year and type the balances yourself.</li>" +
        "<li><b>Compare</b> — each box shows predicted vs actual; select one for the per-account breakdown.</li>" +
        "</ol></div>";
      el.innerHTML =
        "<h1>Predictions</h1>" +
        '<p class="lead">Everything here is per <b>calendar year</b>' + (hasBaseline && pr.baselineSavedAt ? " — baseline saved <b>" + pr.baselineSavedAt.slice(0, 10) + "</b>." : ".") + "</p>" +
        explain +
        '<div class="toolbar">' +
          '<button class="btn small" data-action="save-baseline">📌 ' + (hasBaseline ? "Update baseline (overwrite with today's projection)" : "Save current projection as baseline") + "</button>" +
          '<button class="btn small" data-action="record-actual">✅ Record ' + nowYear + " actuals from current balances</button>" +
          '<input type="number" id="pred-add-year" min="1990" max="2200" step="1" value="' + (nowYear - 1) + '" style="width:90px">' +
          '<button class="btn small ghost" data-action="add-actual-year">➕ Add year to fill manually</button>' +
        "</div>" +
        '<div id="pred-grid" class="pred-grid"></div>' +
        '<div class="panel"><h3>Selected year — per-account prediction vs actual</h3><div id="pred-detail"></div></div>' +
        '<div class="panel"><h3>Predicted vs actual net worth</h3><canvas id="pred-chart" height="240"></canvas></div>';
      if (this.selYear == null) this.selYear = nowYear;
      this.update(el);
    },
    update(el) {
      this.renderGrid(el);
      this.renderDetail(el);
      this.renderChart(el);
    },
    // Grid + chart carry no inputs → safe to rebuild on every keystroke; the
    // detail table has editable Actual inputs → only its derived cells are
    // refreshed in place while typing (see refreshLight).
    refreshLight(el) {
      this.renderGrid(el);
      this.refreshDetailDeltas(el);
      this.renderChart(el);
    },
    baseByYear(pr) {
      const map = {};
      (pr.years || []).forEach((r) => (map[r.year] = r));
      return map;
    },
    renderGrid(el) {
      const st = S();
      const pr = st.predictions;
      const nowYear = FIRE.state.refDate(st).getFullYear();
      const years = this.allYears(pr);
      const baseByYear = this.baseByYear(pr);
      const grid = el.querySelector("#pred-grid");
      if (grid) {
        grid.innerHTML = years.map((y) => {
          const row = baseByYear[y];
          const act = (pr.actuals || {})[y];
          const isNow = y === nowYear;
          let delta = "";
          if (act && row && row.total) {
            const d = (act.total - row.total) / row.total * 100;
            delta = '<div class="pred-delta ' + (d >= 0 ? "ok" : "bad") + '">' + (d >= 0 ? "+" : "") + d.toFixed(1) + "%</div>";
          }
          return '<div class="pred-box' + (isNow ? " now" : "") + (act ? " has-actual" : "") + (y === this.selYear ? " sel" : "") + '" data-action="pred-year" data-year="' + y + '">' +
            '<div class="pred-year">' + y + "</div>" +
            '<div class="pred-total">' + (row ? C.fmt(row.total) : "—") + "</div>" +
            (act ? '<div class="pred-actual">act ' + C.fmt(act.total) + "</div>" : "") + delta +
            "</div>";
        }).join("") || '<p class="hint">No years yet — save a baseline and/or add a year manually above.</p>';
      }
    },
    // Detail table for selected year (Actual column is editable).
    renderDetail(el) {
      const st = S();
      const pr = st.predictions;
      const nowYear = FIRE.state.refDate(st).getFullYear();
      const years = this.allYears(pr);
      const baseByYear = this.baseByYear(pr);
      const det = el.querySelector("#pred-detail");
      if (det) {
        const y = years.indexOf(this.selYear) >= 0 ? this.selYear : (years[years.length - 1] || nowYear);
        this.selYear = y;
        const row = baseByYear[y] || null;
        const act = (pr.actuals || {})[y];
        const accs = this.accountList(st, pr);
        let rows = accs.map((a) => {
          const pv = row ? (row.perAccount[a.id] || 0) : null;
          const av = act && act.perAccount ? act.perAccount[a.id] : null;
          const d = (av != null && pv) ? (av - pv) / pv * 100 : null;
          return "<tr><td>" + escapeHtml(a.name) + "</td><td>" + (pv != null ? money(pv) : "—") + "</td>" +
            '<td><input class="num" type="number" step="100" data-predy="' + y + '" data-predacc="' + a.id + '" value="' + (av != null ? av : "") + '" placeholder="—"></td>' +
            '<td class="td-pdelta" data-acc="' + a.id + '" style="color:' + (d == null ? "inherit" : d >= 0 ? "var(--ok)" : "var(--bad)") + '">' + (d == null ? "—" : (d >= 0 ? "+" : "") + d.toFixed(1) + "%") + "</td></tr>";
        }).join("");
        const gd = (act && row && row.total) ? (act.total - row.total) / row.total * 100 : null;
        det.innerHTML = "<p>Year <b>" + y + "</b>" +
          (row ? "" : ' — <span class="hint">not in the saved baseline (no prediction; actuals only)</span>') +
          (act ? " — actuals last edited " + (act.savedAt ? act.savedAt.slice(0, 10) : "?") + ' <button class="btn danger small" data-action="del-actual" data-year="' + y + '">✕ Remove actuals</button>' : " — type actual balances below (or use the record button for the current year)") + ".</p>" +
          '<div class="table-wrap"><table class="grid"><thead><tr><th>Account</th><th>Predicted (baseline)</th><th>Actual</th><th>Δ</th></tr></thead><tbody>' + rows +
          '<tr class="fire-row"><td><b>Total</b></td><td id="pred-tot-p">' + (row ? money(row.total) : "—") + '</td><td id="pred-tot-a">' + (act ? money(act.total) : "—") + '</td><td id="pred-tot-d" style="color:' + (gd == null ? "inherit" : gd >= 0 ? "var(--ok)" : "var(--bad)") + '"><b>' + (gd == null ? "—" : (gd >= 0 ? "+" : "") + gd.toFixed(1) + "%") + "</b></td></tr></tbody></table></div>";
      }
    },
    // In-place refresh of the detail's derived cells (Δ, totals) so the
    // Actual inputs keep focus while typing.
    refreshDetailDeltas(el) {
      const st = S();
      const pr = st.predictions;
      const det = el.querySelector("#pred-detail");
      if (!det) return;
      const y = this.selYear;
      const row = this.baseByYear(pr)[y] || null;
      const act = (pr.actuals || {})[y];
      const accs = this.accountList(st, pr);
      accs.forEach((a) => {
        const cell = det.querySelector('.td-pdelta[data-acc="' + a.id + '"]');
        if (!cell) return;
        const pv = row ? (row.perAccount[a.id] || 0) : null;
        const av = act && act.perAccount ? act.perAccount[a.id] : null;
        const d = (av != null && pv) ? (av - pv) / pv * 100 : null;
        cell.textContent = d == null ? "—" : (d >= 0 ? "+" : "") + d.toFixed(1) + "%";
        cell.style.color = d == null ? "inherit" : d >= 0 ? "var(--ok)" : "var(--bad)";
      });
      const totA = det.querySelector("#pred-tot-a");
      if (totA) totA.textContent = act ? money(act.total) : "—";
      const totD = det.querySelector("#pred-tot-d");
      if (totD) {
        const gd = (act && row && row.total) ? (act.total - row.total) / row.total * 100 : null;
        totD.innerHTML = "<b>" + (gd == null ? "—" : (gd >= 0 ? "+" : "") + gd.toFixed(1) + "%") + "</b>";
        totD.style.color = gd == null ? "inherit" : gd >= 0 ? "var(--ok)" : "var(--bad)";
      }
    },
    // Chart: predicted line + actual points, across all years.
    renderChart(el) {
      const st = S();
      const pr = st.predictions;
      const years = this.allYears(pr);
      const baseByYear = this.baseByYear(pr);
      const cv = el.querySelector("#pred-chart");
      if (cv && years.length) {
        C.line(cv, {
          labels: years,
          series: [
            { name: "Predicted", data: years.map((y) => (baseByYear[y] ? baseByYear[y].total : null)), color: "#2f7ed8" },
            { name: "Actual", data: years.map((y) => ((pr.actuals || {})[y] ? pr.actuals[y].total : null)), color: "#59a14f" },
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
      const auto = st.assumptions.pensionExemptionAuto !== false;
      el.innerHTML =
        "<h1>Pension (Israel)</h1>" +
        '<p class="lead">Income from your pension after retirement, modeled on Israeli rules. Two modes:<br>' +
        '<b>Annuity (קצבה)</b> — at access age the pot is exchanged for a guaranteed lifelong monthly income (pot ÷ coefficient); the pot goes to ₪0.<br>' +
        '<b>Lump sum (היוון/משיכה)</b> — the statutory <b>minimum annuity (קצבה מזערית)</b> is secured first; only the pot above it can be withdrawn (tax-free up to the exempt-capital ceiling, the rest at marginal rates). Net proceeds go to your default liquid account.</p>' +
        '<div class="grid-2">' +
        '<div class="panel"><h3>Pension settings</h3>' +
          '<div class="control"><label>Payout mode</label><div class="ctl-row">' + modeSel + "</div></div>" +
          ctl("Pension access age (earliest 60 by law)", "profile.pensionAccessAge", { min: 60, max: 70, step: 1, type: "int" }) +
          ctl("Conversion coefficient (מקדם המרה)", "assumptions.pensionAnnuityCoefficient", { min: 150, max: 260, step: 1, type: "int" }) +
          ctl("Entitling pension ceiling (today ₪/mo)", "assumptions.pensionEntitlingCeiling", { min: 5000, max: 15000, step: 10 }) +
          '<div style="margin:6px 0 10px">' + toggle("Exemption % follows the statutory schedule (57.5% in 2026 → 67% from 2028)", "assumptions.pensionExemptionAuto", { remount: 1 }) + "</div>" +
          (auto ? "" : ctl("Tax-exempt portion of ceiling (manual)", "assumptions.pensionExemptionPct", { min: 0, max: 100, step: 0.5, suffix: "%" })) +
          ctl("Exemption applies from age (גיל הזכאות)", "assumptions.pensionExemptionFromAge", { min: 60, max: 70, step: 1, type: "int" }) +
          ctl("Minimum annuity — קצבה מזערית (today ₪/mo)", "assumptions.pensionMinAnnuity", { min: 0, max: 10000, step: 10 }) +
          '<div style="margin-top:10px">' + toggle("Annuity indexed to inflation (CPI)", "assumptions.pensionCpiLinked") + "</div>" +
          '<p class="hint">2026 references: entitling ceiling <b>₪9,430/mo</b>; exemption <b>57.5%</b> of it, rising to <b>62.5%</b> (2027) and <b>67%</b> (2028+) — and it only applies from the official retirement age (67 for men), so an annuity drawn at 60 is fully taxable until then. Minimum annuity <b>₪5,306/mo</b>. Conversion coefficient at 67 ≈ <b>186–200</b> (married, 60% survivor); drawing at 60 means a higher coefficient (~215–235) and a smaller monthly pension. <b>Management fees</b> are set per pension / study-fund account on the <b>Accounts</b> page (legal max 6% deposit / 0.5% balance; state-selected default funds charge 1% / 0.22%). Verify with your provider — estimate, not advice.</p>' +
        "</div>" +
        '<div class="panel"><h3>Projected monthly pension at access age</h3><div id="pen-breakdown"></div></div>' +
        "</div>" +
        '<div class="panel"><h3>🇮🇱 Bituach Leumi old-age pension (קצבת אזרח ותיק)</h3>' +
          '<div style="margin-bottom:10px">' + toggle("Include the state old-age pension as retirement income", "assumptions.oldAge.enabled") + "</div>" +
          '<div class="grid-2"><div>' +
            ctl("Monthly amount (today's ₪)", "assumptions.oldAge.monthly", { min: 0, max: 6000, step: 10 }) +
          "</div><div>" +
            ctl("From age", "assumptions.oldAge.fromAge", { min: 62, max: 75, step: 1, type: "int" }) +
          "</div></div>" +
          '<div id="pen-oldage-out" class="callout"></div>' +
          '<p class="hint">2026 basic rates: single <b>₪1,838/mo</b> (₪1,941 at 80+), couple ₪2,762. Add the seniority increment yourself: +2% per insured year, up to +50% (max single ≈ ₪2,757), plus +5%/yr if you defer between retirement age and 70. From the official retirement age (67) it\'s income-tested; from <b>70</b> it\'s unconditional — hence the default. Modeled as CPI-linked, untaxed income.</p>' +
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
          bd.innerHTML =
            '<div class="callout">Lump-sum in ' + eventLabel(st, pi.accessAge) + ': the statutory <b>minimum annuity</b> is secured first (קצבה מזערית — the pot needed for it is annuitized); only the remainder is withdrawn and deposited into your default liquid account.</div>' +
            '<table class="grid"><tbody>' +
            row2("Pot at access — " + eventLabel(st, pi.accessAge), money(pi.potAtAccess)) +
            row2("Minimum annuity (inflated to access)", money(pi.minAnnuityMonthly) + "/mo") +
            row2("Pot annuitized to secure it (× " + pi.coefficient + ")", "−" + money(pi.annuitizedPot)) +
            row2("→ forced annuity (gross)", money(pi.minAnnuityGrossMonthly) + "/mo (≈ " + money(pi.minAnnuityGrossMonthlyReal) + "/mo today's ₪)") +
            row2("Gross lump withdrawal", "<b>" + money(pi.lumpGross) + "</b>") +
            (pi.lumpExemptionEligible
              ? row2("Exempt-capital ceiling (היוון פטור, " + pi.exemptionPct + "% × ceiling × 180)", money(pi.lumpExemptCapital))
              : row2("Exempt capital", '<span class="bad">none — access before age ' + pi.exemptionFromAge + "</span>")) +
            row2("Estimated income tax on the lump", "−" + money(pi.lumpTax)) +
            row2("<b>Net deposited to liquid</b>", "<b>" + money(pi.lumpNet) + "</b>") +
            row2("Net in today's ₪", money(pi.lumpNetReal)) +
            "</tbody></table>" +
            '<p class="hint">Israeli law only allows capitalizing (היוון) the pot <b>above</b> the minimum annuity. The lump is tax-free up to the exempt-capital ceiling (only from age ' + pi.exemptionFromAge + '; using it consumes the ongoing annuity exemption) and the rest is taxed at marginal income-tax brackets. The forced minimum annuity then pays out monthly like a regular annuity.</p>';
        } else {
          bd.innerHTML =
            '<table class="grid"><tbody>' +
            row2("Pot at access — " + eventLabel(st, pi.accessAge), money(pi.potAtAccess)) +
            row2("Conversion coefficient", pi.coefficient) +
            row2("Gross monthly annuity", "<b>" + money(pi.grossMonthly) + "</b>") +
            row2("Entitling ceiling (at access, inflated)", money(pi.entitlingCeilingAtAccess)) +
            (pi.exemptionEligibleAtAccess
              ? row2("Tax-exempt portion (" + pi.exemptionPct + "%)", money(pi.exemptMonthly))
              : row2("Tax-exempt portion", '<span class="bad">₪0 until age ' + pi.exemptionFromAge + "</span> (" + pi.exemptionStartYear + "); then " + pi.exemptionPct + "%")) +
            row2("Taxable portion (at access)", money(pi.taxableMonthly)) +
            row2("Estimated income tax (at access)", "−" + money(pi.taxMonthly)) +
            row2("<b>Net monthly pension (at access)</b>", "<b>" + money(pi.netMonthly) + "</b> (≈ " + money(pi.netMonthlyReal) + " today's ₪)") +
            (pi.exemptionEligibleAtAccess ? "" :
              row2("<b>Net monthly from age " + pi.exemptionFromAge + "</b> (exemption applies)", "<b>" + money(pi.netMonthlyFromEligibility) + "</b> (≈ " + money(pi.netMonthlyFromEligibilityReal) + " today's ₪)")) +
            "</tbody></table>" +
            '<p class="hint">Gross = pot ÷ coefficient. The exemption is ' + pi.exemptionPct + "% × the entitling ceiling (statutory schedule when auto is on) and applies only from age " + pi.exemptionFromAge + " (קיבוע זכויות) — an annuity drawn earlier is fully taxable until then; the projection models this year by year. Annuity is CPI-linked if enabled.</p>";
        }
      }
      // Old-age pension summary line.
      const oaOut = el.querySelector("#pen-oldage-out");
      if (oaOut) {
        const oa = st.assumptions.oldAge || {};
        if (oa.enabled) {
          const row = p.rows.find((r) => r.oldAge > 0);
          oaOut.innerHTML = row
            ? "From <b>" + eventLabel(st, oa.fromAge || 70) + "</b>: <b>" + money((oa.monthly || 0)) + "/mo</b> in today's ₪ (≈ " + money(row.oldAge / 12) + "/mo nominal in " + row.year + "), added to retirement income in every projection."
            : "Enabled, but the start age is beyond the projection horizon.";
        } else {
          oaOut.innerHTML = "Not included. Tick the box above to add it to retirement income.";
        }
      }

      const real = st.assumptions.realMode;
      const adj = (v, k) => (real ? v / Math.pow(1 + st.assumptions.inflation / 100, k) : v);

      // Pension account balance (pot) over time.
      const pot = el.querySelector("#pen-pot");
      if (pot) {
        C.line(pot, {
          labels: p.rows.map((r) => r.year),
          series: [{ name: "Pension pot", data: p.rows.map((r) => adj(r.pension, r.k)), color: "#4e79a7" }],
        });
      }

      const pl = el.querySelector("#pen-line");
      if (pl) {
        C.line(pl, {
          labels: p.rows.map((r) => r.year),
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
        '<p class="lead">See what happens if you <b>sell one holding and reinvest the net into another</b>. It pays the tax up front, then compares the two paths under each holding\'s growth — so you can judge whether a faster-growing target beats the tax drag and a slower one. Use <b>Custom</b> to model something you don\'t own yet — a future RSU grant or a <b>🏠 property</b> (appreciation + rent yield, purchase costs, מס שבח). Properties from the Mortgage tab appear as sources too (growth shown as total return incl. rent; attached mortgages aren\'t netted here).</p>' +
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
        [["stock", "Stock / ETF"], ["rsu", "RSU / grant"], ["property", "🏠 Property / real estate"]].map((k) => '<option value="' + k[0] + '"' + (def.kind === k[0] ? " selected" : "") + ">" + k[1] + "</option>").join("") + "</select></div></div>";
      const nameF = '<div class="control"><label>Name</label><div class="ctl-row"><input data-path="' + base + '.name" data-type="text" value="' + escapeHtml(def.name || "") + '"></div></div>';
      if (role === "target") {
        if (def.kind === "property") {
          // Buying a property: purchase costs eat into the invested amount;
          // growth = appreciation + net rent yield; sale tax on gain at exit.
          return kindSel + nameF +
            ctl("Appreciation / yr", base + ".growth", { min: -5, max: 15, step: 0.1, suffix: "%" }) +
            ctl("Net rent yield / yr", base + ".rentYieldPct", { min: 0, max: 10, step: 0.1, suffix: "%" }) +
            ctl("Purchase costs (מס רכישה + fees)", base + ".purchaseCostPct", { min: 0, max: 15, step: 0.5, suffix: "%" }) +
            ctl("Sale tax on gain (מס שבח; 0 = exempt)", base + ".capGainsRate", { min: 0, max: 50, step: 1, suffix: "%" }) +
            '<p class="hint">Total return = appreciation + rent yield. Purchase costs are lost up front — that\'s the hurdle the property must beat. Mortgage leverage isn\'t modeled here (compare cash-vs-cash).</p>';
        }
        // Buying into the target: only growth & cap-gains matter.
        return kindSel + nameF +
          ctl("Expected growth / yr", base + ".growth", { min: -5, max: 25, step: 0.1, suffix: "%" }) +
          ctl("Capital-gains tax %", base + ".capGainsRate", { min: 0, max: 50, step: 1, suffix: "%" });
      }
      if (def.kind === "property") {
        // Selling a property you own (hypothetically or really).
        return kindSel + nameF +
          ctl("Market value", base + ".value", { min: 0, max: 20000000, step: 10000 }) +
          ctl("What you paid (basis)", base + ".costBasis", { min: 0, max: 20000000, step: 10000 }) +
          ctl("Appreciation / yr", base + ".growth", { min: -5, max: 15, step: 0.1, suffix: "%" }) +
          ctl("Net rent yield / yr", base + ".rentYieldPct", { min: 0, max: 10, step: 0.1, suffix: "%" }) +
          ctl("Sale tax on gain (מס שבח; 0 = exempt)", base + ".capGainsRate", { min: 0, max: 50, step: 1, suffix: "%" });
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
        (sc.purchaseCost > 0 ? '<div class="pay-row"><span>Purchase costs (מס רכישה + fees)</span><span>−' + money(sc.purchaseCost) + "</span></div>" : "") +
        '<div class="pay-row pay-sum"><span>' + (sc.purchaseCost > 0 ? "Actually invested in " : "Net reinvested into ") + escapeHtml(sc.tgt.name) + "</span><span>" + money(sc.purchaseCost > 0 ? sc.invested : sc.netReinvest) + "</span></div></div>" +
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

  /* ================= MONTE CARLO (section inside 🔥 FIRE) ================= */
  const montecarlo = {
    mount(el) {
      el.innerHTML =
        '<h1 style="font-size:22px;margin-top:26px">🎲 Monte Carlo</h1>' +
        '<p class="lead">Fixed-return projections hide <b>sequence-of-returns risk</b> — a crash early in retirement hurts far more than the same crash later. This section re-runs your full plan hundreds of times with randomized yearly returns (per account type) and reports how often it survives.</p>' +
        '<div class="grid-2">' +
        '<div class="panel"><h3>Simulation settings</h3>' +
          ctl("Simulations per run", "assumptions.mc.sims", { min: 100, max: 2000, step: 50, type: "int" }) +
          ctl("Target confidence", "assumptions.mc.confidence", { min: 50, max: 99, step: 1, suffix: "%" }) +
          '<h3 style="margin-top:16px">Annual volatility by type (std dev %)</h3>' +
          '<div class="grid-2"><div>' +
            ctl("Cash", "assumptions.mc.vol.cash", { min: 0, max: 10, step: 0.1, suffix: "%", slider: false }) +
            ctl("Money market", "assumptions.mc.vol.money_market", { min: 0, max: 15, step: 0.1, suffix: "%", slider: false }) +
            ctl("Taxable brokerage", "assumptions.mc.vol.taxable", { min: 0, max: 50, step: 0.5, suffix: "%", slider: false }) +
            ctl("Keren Hishtalmut", "assumptions.mc.vol.study_fund", { min: 0, max: 40, step: 0.5, suffix: "%", slider: false }) +
          "</div><div>" +
            ctl("Pension", "assumptions.mc.vol.pension", { min: 0, max: 40, step: 0.5, suffix: "%", slider: false }) +
            ctl("RSU / equity", "assumptions.mc.vol.rsu", { min: 0, max: 80, step: 1, suffix: "%", slider: false }) +
            ctl("Custom", "assumptions.mc.vol.custom", { min: 0, max: 50, step: 0.5, suffix: "%", slider: false }) +
          "</div></div>" +
          '<p class="hint">Reference (long-run annual std dev): global equities ~15–18%, bond-heavy funds ~5–8%, a single tech stock 30%+. Each year every account <b>type</b> gets one shared random shock (all your equity funds move together). FX, inflation, salary, spending, vest pricing, and property growth stay deterministic — so real risk is somewhat higher than shown.</p>' +
        "</div>" +
        '<div class="panel"><h3>Results</h3><div id="mc-headline"><p class="hint">Running simulations…</p></div><div id="mc-safe"></div></div>' +
        "</div>" +
        '<div class="panel"><h3>Net worth percentile fan</h3><canvas id="mc-fan" height="280"></canvas>' +
          '<p class="hint">Each line is a percentile across all simulated paths: 10% of paths end below the p10 line, half below the median, and so on.</p></div>' +
        '<div class="panel"><h3>Distribution of final net worth (at age ' + S().profile.endAge + ')</h3><canvas id="mc-hist" height="240"></canvas></div>';
      this.update(el);
    },
    update(el) {
      const head = el.querySelector("#mc-headline");
      if (head) head.innerHTML = '<p class="hint">Running ' + ((S().assumptions.mc || {}).sims || 500) + " simulations…</p>";
      const safe = el.querySelector("#mc-safe");
      if (safe) safe.innerHTML = "";
      this._heavy = this._heavy || debounce((elh) => this.run(elh), 400);
      this._heavy(el);
    },
    run(el) {
      const st = S();
      const mc = st.assumptions.mc || {};
      const real = st.assumptions.realMode;
      const infl = st.assumptions.inflation / 100;
      const adj = (v, k) => (real ? v / Math.pow(1 + infl, k) : v);
      const r = FIRE.engine.monteCarlo(st, {});

      const head = el.querySelector("#mc-headline");
      if (head) {
        const s = r.successRate;
        const cls = s >= (mc.confidence || 90) ? "ok" : s >= 75 ? "" : "bad";
        const endYears = r.years ? r.years.length - 1 : 0;
        head.innerHTML =
          '<div class="metric-grid" style="margin-bottom:10px">' +
          card("Success rate", '<span class="' + cls + '">' + s.toFixed(1) + "%</span>", "of " + r.sims + " paths survive to " + st.profile.endAge + " retiring " + eventLabel(st, st.profile.fireAge)) +
          card("Median final net worth", money(adj(r.finalP50, endYears)), real ? "today's ₪" : "nominal") +
          card("Pessimistic (p10) / optimistic (p90)", money(adj(r.finalP10, endYears)) + " / " + money(adj(r.finalP90, endYears)), "final net worth range") +
          "</div>" +
          (r.depletions.length
            ? '<p class="hint">When paths fail, the money typically runs out around <b>' + eventLabel(st, r.medianDepletionAge) + "</b> (median of " + r.depletions.length + " failing paths).</p>"
            : '<p class="hint">No simulated path ran out of money 🎉</p>');
      }

      // Percentile fan chart.
      const fan = el.querySelector("#mc-fan");
      if (fan && r.bands) {
        C.line(fan, {
          labels: r.years,
          series: [
            { name: "p90 (lucky)", data: r.bands.p90.map((v, i) => adj(v, i)), color: "#59a14f" },
            { name: "p75", data: r.bands.p75.map((v, i) => adj(v, i)), color: "#8cd17d" },
            { name: "median", data: r.bands.p50.map((v, i) => adj(v, i)), color: "#2f7ed8" },
            { name: "p25", data: r.bands.p25.map((v, i) => adj(v, i)), color: "#f28e2b" },
            { name: "p10 (unlucky)", data: r.bands.p10.map((v, i) => adj(v, i)), color: "#e15759" },
          ],
        });
      }

      // Final net-worth histogram (clip outliers to the 2–98% range).
      const hist = el.querySelector("#mc-hist");
      if (hist && r.finals.length) {
        const endYears = r.years ? r.years.length - 1 : 0;
        const f = r.finals.map((v) => adj(v, endYears));
        const lo = f[Math.floor(f.length * 0.02)], hi = f[Math.min(f.length - 1, Math.floor(f.length * 0.98))];
        const bins = 12, span = Math.max(1, hi - lo), counts = new Array(bins).fill(0);
        f.forEach((v) => {
          const b = Math.max(0, Math.min(bins - 1, Math.floor(((v - lo) / span) * bins)));
          counts[b]++;
        });
        C.bar(hist, {
          labels: counts.map((_, b) => C.fmt(lo + (b + 0.5) * (span / bins))),
          series: [{ name: "Paths", data: counts, color: "#4e79a7" }],
        });
      }

      // Safe retirement age at the target confidence — a heavier search, run
      // after the first paint so the page feels instant.
      const safe = el.querySelector("#mc-safe");
      if (safe) {
        safe.innerHTML = '<p class="hint">Searching for the earliest retirement age at ' + (mc.confidence || 90) + "% confidence…</p>";
        setTimeout(() => {
          if (!safe.isConnected) return;
          const sa = FIRE.engine.safeFireAge(st, mc.confidence || 90, 200);
          safe.innerHTML = sa.found
            ? '<div class="callout"><b>Safe retirement age at ' + (mc.confidence || 90) + "% confidence: age " + sa.age + " — " + eventLabel(st, sa.age) + "</b> (" + sa.successRate.toFixed(0) + "% of 200 test paths survive)." +
              (sa.age !== Math.round(st.profile.fireAge) ? ' <button class="btn small" data-action="set-fire-age" data-age="' + sa.age + '">Set retirement age to ' + sa.age + "</button>" : " Already set.") + "</div>"
            : '<div class="callout"><span class="bad">No retirement age up to ' + st.profile.endAge + " reaches " + (mc.confidence || 90) + "% confidence</span> — lower spending, the confidence bar, or volatility.</div>";
        }, 30);
      }
    },
  };

  /* ====================== MORTGAGE & REAL ESTATE ========================= */
  const mortgage = {
    mount(el) {
      const st = S();
      el.innerHTML =
        "<h1>🏠 Mortgage &amp; Real Estate</h1>" +
        '<p class="lead">A mortgage <b>simulator with Israeli tracks (מסלולים)</b> — build the mix (קל"צ / קבועה צמודה / פריים / משתנה כל 5), pick Spitzer or equal-principal (קרן שווה), stress the rates, and watch the payment path. It works both for a mortgage you <b>have</b> and one you\'re only <b>considering</b>.</p>' +
        '<div class="panel" style="padding:12px 18px">' +
          toggle("<b>Include in my plan</b> — equity in net worth, rent as income, payments as outgoings, all projections & survival checks. Untick to use this tab as a pure what-if simulator that touches nothing.", "realEstate.includeInPlan") +
        "</div>" +
        '<div class="metric-grid" id="re-metrics"></div>' +
        '<div class="panel"><h3>Properties</h3>' +
          '<div class="toolbar"><button class="btn small" data-action="add-property">+ Add property</button></div>' +
          '<div class="table-wrap"><table class="grid"><thead><tr><th>Name</th><th>Value today</th><th>Appreciation %/yr</th><th>Rent ₪/mo (0 = you live there)</th><th>Rent growth %/yr</th><th></th></tr></thead><tbody id="re-props"></tbody></table></div>' +
        "</div>" +
        '<div class="panel"><h3>Mortgage — one row per track (מסלול)</h3>' +
          '<div class="toolbar"><button class="btn small" data-action="add-loan">+ Add track</button></div>' +
          '<p class="hint" style="margin-top:0">Enter each track\'s <b>remaining</b> principal, current rate, and years left. CPI-linked tracks follow the plan\'s inflation assumption; variable tracks follow the rate scenario below. <b>Method</b>: Spitzer (constant payment) or קרן שווה (equal principal — starts higher, declines).</p>' +
          '<div class="table-wrap"><table class="grid"><thead><tr><th>Name</th><th>Property</th><th>Track (מסלול)</th><th>Method</th><th>Remaining principal</th><th>Rate %/yr</th><th>Years left</th><th>Payment now</th><th>Peak payment</th><th>Total interest ahead</th><th>Paid off</th><th></th></tr></thead><tbody id="re-loans"></tbody></table></div>' +
          '<div id="re-mix"></div>' +
        "</div>" +
        '<div class="grid-2">' +
          '<div class="panel"><h3>Rate scenario (stress test)</h3>' +
            ctl("Prime change over the horizon", "realEstate.scenario.primeChangePp", { min: -4, max: 4, step: 0.25, suffix: "pp" }) +
            ctl("…spread over how many years", "realEstate.scenario.primeYears", { min: 1, max: 15, step: 1, type: "int" }) +
            ctl("Every-5-yr tracks: step per reset", "realEstate.scenario.resetStepPp", { min: -2, max: 2, step: 0.25, suffix: "pp" }) +
            '<p class="hint">Prime = Bank-of-Israel rate + 1.5%. Set +2pp to simulate rate hikes, negative for cuts. משתנה-כל-5 tracks re-anchor to bond yields at each reset — the step approximates that drift. CPI linkage uses the plan\'s inflation (' + S().assumptions.inflation + "%).</p>" +
          "</div>" +
          '<div class="panel"><h3>Monthly payment over time</h3><canvas id="re-paychart" height="260"></canvas>' +
            '<p class="hint">Total monthly payment across all tracks (sampled at the start of each year) under the scenario — the key stress-test view: CPI-linked and variable tracks make it climb, קרן-שווה makes it fall.</p></div>' +
        "</div>" +
        '<div class="grid-2">' +
          '<div class="panel"><h3>Value vs debt vs equity over time</h3><canvas id="re-line" height="260"></canvas></div>' +
          '<div class="panel"><h3>Annual rent vs mortgage payments</h3><canvas id="re-cash" height="260"></canvas></div>' +
        "</div>" +
        '<div class="panel"><h3>What this does to the plan</h3><div id="re-impact"></div></div>';
      this.renderProps(el);
      this.renderLoans(el);
      this.update(el);
    },
    renderProps(el) {
      const st = S();
      el.querySelector("#re-props").innerHTML = (st.realEstate.properties || []).map((p) => {
        const f = (field, val, step) => '<input class="num" data-arr="realEstate.properties" data-id="' + p.id + '" data-field="' + field + '" data-type="float" type="number" step="' + step + '" value="' + val + '">';
        return "<tr>" +
          '<td><input data-arr="realEstate.properties" data-id="' + p.id + '" data-field="name" data-type="text" style="width:130px" value="' + escapeHtml(p.name) + '"></td>' +
          "<td>" + f("value", p.value, 10000) + "</td>" +
          "<td>" + f("growthPct", p.growthPct, 0.1) + "</td>" +
          "<td>" + f("rentMonthly", p.rentMonthly, 250) + "</td>" +
          "<td>" + f("rentGrowthPct", p.rentGrowthPct, 0.1) + "</td>" +
          '<td><button class="btn danger small" data-action="del-property" data-id="' + p.id + '">✕</button></td>' +
          "</tr>";
      }).join("") || '<tr><td colspan="6" class="hint" style="text-align:center">No properties — click “+ Add property” (a home, a rental flat, land…).</td></tr>';
    },
    renderLoans(el) {
      const st = S();
      const TRACKS = FIRE.engine.LOAN_TRACKS;
      el.querySelector("#re-loans").innerHTML = (st.realEstate.loans || []).map((l) => {
        const f = (field, val, step) => '<input class="num" style="width:92px" data-arr="realEstate.loans" data-id="' + l.id + '" data-field="' + field + '" data-type="float" type="number" step="' + step + '" value="' + val + '">';
        const propSel = '<select data-arr="realEstate.loans" data-id="' + l.id + '" data-field="propertyId" data-type="text">' +
          '<option value=""' + (!l.propertyId ? " selected" : "") + ">—</option>" +
          (st.realEstate.properties || []).map((p) => '<option value="' + p.id + '"' + (l.propertyId === p.id ? " selected" : "") + ">" + escapeHtml(p.name) + "</option>").join("") + "</select>";
        const track = FIRE.engine.loanTrackOf(l);
        const trackSel = '<select data-arr="realEstate.loans" data-id="' + l.id + '" data-field="track" data-type="text">' +
          Object.keys(TRACKS).map((t) => '<option value="' + t + '"' + (track === t ? " selected" : "") + ">" + TRACKS[t].label + "</option>").join("") + "</select>";
        const methodSel = '<select data-arr="realEstate.loans" data-id="' + l.id + '" data-field="method" data-type="text">' +
          [["spitzer", "Spitzer"], ["equal", "קרן שווה"]].map((m) => '<option value="' + m[0] + '"' + ((l.method || "spitzer") === m[0] ? " selected" : "") + ">" + m[1] + "</option>").join("") + "</select>";
        return "<tr>" +
          '<td><input data-arr="realEstate.loans" data-id="' + l.id + '" data-field="name" data-type="text" style="width:90px" value="' + escapeHtml(l.name) + '"></td>' +
          "<td>" + propSel + "</td>" +
          "<td>" + trackSel + "</td>" +
          "<td>" + methodSel + "</td>" +
          "<td>" + f("principal", l.principal, 10000) + "</td>" +
          "<td>" + f("annualRatePct", l.annualRatePct, 0.05) + "</td>" +
          "<td>" + f("years", l.years, 0.5) + "</td>" +
          '<td class="re-pay" data-loan="' + l.id + '"></td>' +
          '<td class="re-peak" data-loan="' + l.id + '"></td>' +
          '<td class="re-int" data-loan="' + l.id + '"></td>' +
          '<td class="re-off" data-loan="' + l.id + '"></td>' +
          '<td><button class="btn danger small" data-action="del-loan" data-id="' + l.id + '">✕</button></td>' +
          "</tr>";
      }).join("") || '<tr><td colspan="12" class="hint" style="text-align:center">No tracks — click “+ Add track” to build a mortgage mix.</td></tr>';
    },
    update(el) {
      const st = S();
      const p = FIRE.engine.project(st);
      const inPlan = st.realEstate.includeInPlan !== false;
      const r0 = p.rows[0];

      // Everything below is computed from the tab's own simulation, so it
      // works identically whether or not the mortgage is part of the plan.
      const scenario = st.realEstate.scenario || {};
      const props = st.realEstate.properties || [];
      const loansArr = st.realEstate.loans || [];
      let reValue = 0, reDebt = 0, rentNow = 0;
      props.forEach((pr) => { reValue += pr.value || 0; rentNow += pr.rentMonthly || 0; });
      loansArr.forEach((l) => (reDebt += l.principal || 0));
      const scheds = {};
      let payNow = 0, totalPaid = 0, totalInterest = 0, payoffMonths = 0;
      loansArr.forEach((l) => {
        const s = FIRE.engine.loanSchedule(l, st.assumptions.inflation, scenario);
        scheds[l.id] = s;
        payNow += s.payNow;
        totalPaid += s.totalPaid;
        totalInterest += s.totalInterest;
        if (s.months > payoffMonths) payoffMonths = s.months;
      });
      // Rent collected until the last track is paid off (with rent growth).
      const payoffYears = Math.ceil(payoffMonths / 12);
      let rentUntilPayoff = 0;
      props.forEach((pr) => {
        for (let y = 0; y < payoffYears; y++) rentUntilPayoff += (pr.rentMonthly || 0) * 12 * Math.pow(1 + (pr.rentGrowthPct || 0) / 100, y);
      });
      el.querySelector("#re-metrics").innerHTML =
        card("Property value", money(reValue), props.length + " propert" + (props.length === 1 ? "y" : "ies")) +
        card("Mortgage debt", money(reDebt), loansArr.length + " track(s)") +
        card("Total repayment", money(totalPaid), "principal " + money(reDebt) + " + interest " + money(totalInterest)) +
        card("…of which interest", money(totalInterest), reDebt > 0 ? ((totalInterest / reDebt) * 100).toFixed(0) + "% of the principal" : "") +
        card("Rent until payoff", money(rentUntilPayoff), payoffYears + " years of rent (with growth)") +
        card("Net cost after rent", money(totalPaid - rentUntilPayoff), "total repayment − rent collected") +
        card("Net equity", money(reValue - reDebt), inPlan ? "counts toward net worth" : '<span class="bad">simulation only — not in the plan</span>') +
        card("Mortgage payments", money(payNow) + "/mo", "now — see peak per track below");

      // Per-track computed cells.
      (st.realEstate.loans || []).forEach((l) => {
        const s = scheds[l.id];
        const put = (cls, html) => { const c = el.querySelector("." + cls + '[data-loan="' + l.id + '"]'); if (c) c.innerHTML = html; };
        put("re-pay", "<b>" + money(s.payNow) + "</b>");
        put("re-peak", money(s.payMax) + (s.payMax > s.payNow * 1.02 ? ' <span class="bad">▲</span>' : ""));
        put("re-int", money(s.totalInterest));
        put("re-off", "~" + (FIRE.state.refDate(st).getFullYear() + Math.ceil(s.months / 12)));
      });

      // Track-mix composition + Bank-of-Israel rule check
      // (≥ 1/3 fixed-rate, prime ≤ 2/3 of the mix).
      const mix = el.querySelector("#re-mix");
      if (mix) {
        const loans = st.realEstate.loans || [];
        const tot = loans.reduce((s, l) => s + (l.principal || 0), 0);
        if (!tot) {
          mix.innerHTML = "";
        } else {
          const share = (pred) => loans.filter(pred).reduce((s, l) => s + (l.principal || 0), 0) / tot * 100;
          const trk = (l) => FIRE.engine.loanTrackOf(l);
          const fixedPct = share((l) => trk(l) === "fixed" || trk(l) === "fixed_cpi");
          const primePct = share((l) => trk(l) === "prime");
          const cpiPct = share((l) => trk(l) === "fixed_cpi" || trk(l) === "var5");
          const warns = [];
          if (fixedPct < 33.3) warns.push('<span class="bad">⚠ fixed-rate share is below the Bank-of-Israel minimum of ⅓</span>');
          if (primePct > 66.7) warns.push('<span class="bad">⚠ prime share exceeds the ⅔ cap</span>');
          mix.innerHTML = '<div class="callout"><b>Mix:</b> fixed ' + fixedPct.toFixed(0) + "% · prime " + primePct.toFixed(0) + "% · variable-5yr " + (100 - fixedPct - primePct).toFixed(0) + "% · CPI-linked " + cpiPct.toFixed(0) + "%" +
            (warns.length ? "<br>" + warns.join(" · ") + " — a bank wouldn't approve this mix." : ' · <span class="ok">✓ meets the BoI composition rule</span>') + "</div>";
        }
      }

      // Monthly payment over time (per track + total, sampled yearly).
      const payChart = el.querySelector("#re-paychart");
      if (payChart) {
        const loans = st.realEstate.loans || [];
        const y0 = FIRE.state.refDate(st).getFullYear();
        const maxYears = Math.max(1, ...loans.map((l) => (scheds[l.id].payByYear || []).length));
        const labels = Array.from({ length: maxYears }, (_, i) => y0 + i);
        const series = loans.map((l, i) => ({
          name: shortName(l.name),
          color: C.PALETTE[(i + 1) % C.PALETTE.length],
          data: labels.map((_, yi) => (scheds[l.id].payByYear || [])[yi] || 0),
        }));
        series.unshift({
          name: "Total /mo",
          color: "#2f7ed8",
          data: labels.map((_, yi) => loans.reduce((s, l) => s + ((scheds[l.id].payByYear || [])[yi] || 0), 0)),
        });
        C.line(payChart, { labels, series });
      }

      // Value / debt / equity + rent-vs-payments — computed locally from the
      // simulation so they render even in simulation-only mode.
      const real = st.assumptions.realMode;
      const adj = (v, k) => (real ? v / Math.pow(1 + st.assumptions.inflation / 100, k) : v);
      const y0 = FIRE.state.refDate(st).getFullYear();
      const H = Math.max(payoffYears + 1, 30);
      const yearsLbl = Array.from({ length: H }, (_, i) => y0 + i);
      const valAt = (i) => props.reduce((s, pr) => s + (pr.value || 0) * Math.pow(1 + (pr.growthPct || 0) / 100, i), 0);
      const debtAt = (i) => loansArr.reduce((s, l) => s + ((scheds[l.id].balByYear || [])[i] != null ? scheds[l.id].balByYear[i] : 0), 0);
      const rentAt = (i) => props.reduce((s, pr) => s + (pr.rentMonthly || 0) * 12 * Math.pow(1 + (pr.rentGrowthPct || 0) / 100, i), 0);
      const payAt = (i) => loansArr.reduce((s, l) => s + (((scheds[l.id].payByYear || [])[i] || 0) * 12), 0);
      C.line(el.querySelector("#re-line"), {
        labels: yearsLbl,
        series: [
          { name: "Property value", data: yearsLbl.map((_, i) => adj(valAt(i), i)), color: "#4e79a7" },
          { name: "Debt", data: yearsLbl.map((_, i) => adj(debtAt(i), i)), color: "#e15759" },
          { name: "Equity", data: yearsLbl.map((_, i) => adj(valAt(i) - debtAt(i), i)), color: "#59a14f" },
        ],
      });
      C.bar(el.querySelector("#re-cash"), {
        labels: yearsLbl,
        series: [
          { name: "Rent /yr", data: yearsLbl.map((_, i) => adj(rentAt(i), i)), color: "#8cd17d" },
          { name: "Mortgage /yr", data: yearsLbl.map((_, i) => adj(payAt(i), i)), color: "#9c755f" },
        ],
      });

      // Impact summary.
      const imp = el.querySelector("#re-impact");
      if (imp) {
        if (!props.length && !loansArr.length) {
          imp.innerHTML = '<p class="hint">Nothing modeled yet. Add a property/mortgage above — with “Include in my plan” ticked it feeds equity into net worth, rent into income, and payments into spending across the Dashboard, Projections, and survival checks; unticked it\'s a pure simulator.</p>';
        } else if (!inPlan) {
          imp.innerHTML =
            '<div class="callout"><b>Simulation only</b> — this mortgage/property is <b>not</b> part of your plan (net worth, spending, and survival are unaffected). Tick “Include in my plan” above to commit it and see the impact here.</div>' +
            "<p>If committed: payments would start at <b>" + money(payNow) + "/mo</b>, total repayment <b>" + money(totalPaid) + "</b> (interest " + money(totalInterest) + "), offset by <b>" + money(rentUntilPayoff) + "</b> rent until payoff ~<b>" + (y0 + payoffYears) + "</b>.</p>";
        } else {
          const lastPay = p.rows.filter((r) => r.mortgagePay > 1).slice(-1)[0];
          imp.innerHTML =
            "<p>First projection year: rent <b>" + money(r0 ? r0.rentIncome : 0) + "</b>, mortgage payments <b>" + money(r0 ? r0.mortgagePay : 0) + "</b>, equity <b>" + money(r0 ? r0.reEquity : 0) + "</b>.</p>" +
            (lastPay ? "<p>Mortgage payments end in <b>" + lastPay.year + "</b> (" + yearAgeLabel(st, lastPay.year, lastPay.age) + ") — after that the cashflow drag disappears from the plan.</p>" : "") +
            '<div class="callout">' + (p.survives ? '<span class="ok">✓ Plan survives to ' + st.profile.endAge + "</span>" : '<span class="bad">✕ Depletes ' + eventLabel(st, p.depletionAge) + "</span>") + " with the mortgage &amp; property included.</div>";
        }
      }
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

  /* ---- Time & age labels ---------------------------------------------------
   * The projection's rows are calendar-year aligned (each row = end of that
   * calendar year), so we always pair an ABSOLUTE year with the EXACT age
   * (years + months, from the birth date) at that moment — never a rounded
   * "2026 · age 29" that can be off by most of a year.
   *-------------------------------------------------------------------------*/
  // "31y 4m" from a fractional age (months rounded).
  function fmtAgeYM(a) {
    if (a == null || isNaN(a)) return "–";
    let y = Math.floor(a), m = Math.round((a - y) * 12);
    if (m >= 12) { y += 1; m = 0; }
    return y + "y " + m + "m";
  }
  // Exact age at the END of a calendar year (row values are end-of-year).
  function ageAtYearEnd(st, year) { return FIRE.state.exactAgeAt(st, new Date(year, 11, 31)); }
  // Exact age at the START of a calendar year (events like retirement /
  // depletion take effect from the start of their row's year).
  function ageAtYearStart(st, year) { return FIRE.state.exactAgeAt(st, new Date(year, 0, 1)); }
  // Row label: "2033 · 32y 4m" (falls back to the integer age without a DOB).
  function yearAgeLabel(st, year, intAge) {
    const a = ageAtYearEnd(st, year);
    return String(year) + " · " + (a != null ? fmtAgeYM(a) : "age " + intAge);
  }
  // Calendar year in which a given integer projection age is reached.
  function yearForAge(st, age) {
    const now = FIRE.state.refDate(st);
    return now.getFullYear() + (Math.round(age) - Math.round(st.profile.currentAge));
  }
  // Label for an age-milestone event (retirement, depletion, pension access):
  // "2041 (age 45y 3m)" — the year the plan applies it, with your exact age
  // at the start of that year.
  function eventLabel(st, age) {
    const y = yearForAge(st, age);
    const a = ageAtYearStart(st, y);
    return String(y) + (a != null ? " (age " + fmtAgeYM(a) + ")" : " (age " + Math.round(age) + ")");
  }
  // Backwards-compatible per-row date label used in the projections table/CSV.
  function ageDateLabel(st, age) {
    return yearAgeLabel(st, yearForAge(st, age), Math.round(age));
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
        '<div class="grid-2">' +
          '<div class="panel"><h3>🏖️ Coast FIRE</h3>' +
            '<p class="hint" style="margin-top:0">The earliest age you could <b>stop saving entirely</b> — keep working just to cover expenses, let the portfolio compound untouched — and still retire at your configured retirement age with the plan surviving.</p>' +
            '<div id="fire-coast"></div>' +
          "</div>" +
          '<div class="panel"><h3>☕ Barista FIRE</h3>' +
            '<p class="hint" style="margin-top:0">Leave full-time work earlier by keeping a <b>part-time net income</b> until a given age.</p>' +
            ctl("Part-time net income", "assumptions.barista.monthly", { min: 0, max: 30000, step: 250, suffix: "₪/mo" }) +
            ctl("Keep it until age", "assumptions.barista.untilAge", { min: 30, max: 75, step: 1, type: "int" }) +
            '<div id="fire-barista"></div>' +
          "</div>" +
        "</div>" +
        '<div class="panel"><h3>Sensitivity: years to FIRE target vs return</h3><canvas id="fire-sens" height="240"></canvas>' +
          '<p class="hint">For a range of expected taxable / money-market returns, the years until your projected non-pension assets reach the fixed-spend FIRE target above.</p></div>' +
        '<div id="fire-mc"></div>';
      montecarlo.mount(el.querySelector("#fire-mc"));
      this.update(el);
    },
    update(el) {
      const st = S();
      const mcHost = el.querySelector("#fire-mc");
      if (mcHost && mcHost.firstChild) montecarlo.update(mcHost);
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
        cov.innerHTML =
          "<p>Retiring in <b>" + eventLabel(st, st.profile.fireAge) + "</b>, projected non-pension assets are <b>" + money(fr ? fr.nonPension : 0) + "</b> — <b>" + coverage.toFixed(0) + "%</b> of the " + money(t.target) + " target.</p>" +
          '<div class="bar-track"><div class="bar-fill ' + (coverage >= 100 ? "ok" : "warn") + '" style="width:' + Math.min(100, coverage) + '%"></div></div>' +
          '<p id="fire-earliest" class="hint">Computing earliest retirement age…</p>';
      }
      const coast = el.querySelector("#fire-coast");
      if (coast) coast.innerHTML = '<p class="hint">Computing…</p>';
      const barista = el.querySelector("#fire-barista");
      if (barista) barista.innerHTML = '<p class="hint">Computing…</p>';
      // The search helpers run a full projection per candidate age — debounce
      // them so sliders stay responsive, and fill the placeholders when done.
      this._heavy = this._heavy || debounce((elh) => this.heavyUpdate(elh), 350);
      this._heavy(el);
    },
    heavyUpdate(el) {
      const st = S();
      // Earliest full-retirement age.
      const eOut = el.querySelector("#fire-earliest");
      if (eOut) {
        const e = FIRE.engine.earliestFireAge(st);
        eOut.className = "";
        eOut.innerHTML = e.found
          ? "<b>Earliest retirement at your real spending: age " + e.age + " — " + eventLabel(st, e.age) + "</b> " + (e.yearsAway <= 0 ? "(you could retire now 🎉)" : "(" + e.yearsAway + " year" + (e.yearsAway === 1 ? "" : "s") + " away)") + ". This uses your actual categories/steps and requires the plan to survive to " + st.profile.endAge + "." + (e.age !== Math.round(st.profile.fireAge) ? ' <button class="btn small" data-action="set-fire-age" data-age="' + e.age + '">Set retirement age to ' + e.age + "</button>" : "")
          : '<span class="bad">No retirement age up to ' + st.profile.endAge + " survives</span> at your current real spending &amp; assumptions. Lower spending, raise returns/income, or extend the horizon.";
      }
      // Coast FIRE.
      const coast = el.querySelector("#fire-coast");
      if (coast) {
        const c = FIRE.engine.coastFireAge(st);
        coast.innerHTML = c.found
          ? '<div class="callout"><b>Coast from age ' + c.age + " — " + eventLabel(st, c.age) + "</b> " +
            (c.yearsAway <= 0 ? "(you've already coasted past it 🎉)" : "(" + c.yearsAway + " year" + (c.yearsAway === 1 ? "" : "s") + " away)") +
            ": stop all contributions/savings then, cover expenses from income only, and retiring in " + eventLabel(st, st.profile.fireAge) + " still survives to " + st.profile.endAge + ".</div>"
          : '<div class="callout"><span class="bad">Not coastable</span> — even saving until retirement, the plan doesn\'t survive at the current retirement age. Lower spending or retire later.</div>';
      }
      // Barista FIRE.
      const barista = el.querySelector("#fire-barista");
      if (barista) {
        const bcfg = st.assumptions.barista || {};
        const b = FIRE.engine.baristaFireAge(st, bcfg.monthly || 0, bcfg.untilAge || 60);
        barista.innerHTML = b.found
          ? '<div class="callout"><b>Leave full-time at age ' + b.age + " — " + eventLabel(st, b.age) + "</b> " +
            (b.yearsAway <= 0 ? "(you could switch now 🎉)" : "(" + b.yearsAway + " year" + (b.yearsAway === 1 ? "" : "s") + " away)") +
            ", keeping <b>" + money(bcfg.monthly || 0) + "/mo</b> net part-time income (inflation-grown) until age " + (bcfg.untilAge || 60) + " — the plan survives to " + st.profile.endAge + ".</div>"
          : '<div class="callout"><span class="bad">No age works</span> with this part-time income — raise it, extend it, or cut spending.</div>';
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
    pages: { dashboard, accounts, assumptions, income, spending, fire, tracker, pension, mortgage, projections, predictions, whatif, data },
    money, pct, escapeHtml, fmtAgeYM, ageAtYearEnd, ageAtYearStart, yearAgeLabel, yearForAge, eventLabel,
  };
})();
