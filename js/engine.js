/* =============================================================================
 * engine.js  —  Year-by-year projection engine (to age 80)
 * -----------------------------------------------------------------------------
 * Pure functions: given a state object, produce a projection. No DOM here.
 *
 * MODEL SUMMARY (see docs/MODEL.md for full details):
 *  - Works in nominal ILS. USD accounts converted at a constant usdIls.
 *  - Each account grows by its own expected annual return.
 *  - Employer/auto contributions are deposited while "working" (age < fireAge).
 *  - Net salary is take-home; extra income streams apply within age windows.
 *  - RSU: already-vested shares are a virtual equity account; future vests are
 *    added (after modeled Section-102 tax) while working and below vestUntilAge.
 *  - Spending: sum of active categories (each with own growth/age window),
 *    unless a step override applies for that age.
 *  - Surplus is reinvested into a chosen sink; shortfalls are withdrawn from
 *    liquid accounts in priority order (pension only after its accessAge).
 * ===========================================================================*/
(function () {
  "use strict";
  const FIRE = (window.FIRE = window.FIRE || {});

  const WITHDRAW_PRIORITY = ["cash", "money_market", "taxable", "rsu", "study_fund", "custom", "pension"];

  // Israeli individual income-tax brackets (annual, nominal ₪, ~2026).
  // 47% top rate + 3% surtax above the last threshold ≈ 50%.
  const TAX_BRACKETS = [
    [84120, 0.10], [120720, 0.14], [193800, 0.20], [269280, 0.31],
    [558960, 0.35], [721560, 0.47], [Infinity, 0.50],
  ];
  // Progressive tax on annual taxable income. `factor` scales the bracket
  // thresholds to the projection year so nominal growth doesn't inflate rates.
  function incomeTaxAnnual(taxable, factor) {
    if (taxable <= 0) return 0;
    factor = factor || 1;
    let tax = 0, prev = 0;
    for (const [thr, rate] of TAX_BRACKETS) {
      const t = thr === Infinity ? Infinity : thr * factor;
      const span = Math.min(taxable, t) - prev;
      if (span > 0) tax += span * rate;
      if (taxable <= t) break;
      prev = t;
    }
    return tax;
  }

  function toILS(acc, usdIls) {
    return acc.currency === "USD" ? acc.balance * usdIls : acc.balance;
  }

  /* ---- Israeli payroll: gross → net + pension/study-fund deposits --------- */
  function computePayroll(state) {
    const s = state.income;
    const pr = state.assumptions.payroll || {};
    const grossCash = (s.grossMonthly || 0) + (s.taxableExtrasMonthly || 0); // paid in cash
    const imputations = s.taxableImputationsMonthly || 0; // זקיפות: taxed, not cash
    const taxableBase = grossCash + imputations;
    const pensionable = pr.pensionCeilingMonthly > 0 ? Math.min(s.grossMonthly || 0, pr.pensionCeilingMonthly) : (s.grossMonthly || 0);
    const khBase = pr.khCeilingMonthly > 0 ? Math.min(s.grossMonthly || 0, pr.khCeilingMonthly) : (s.grossMonthly || 0);
    const empPension = (pr.pensionEmployeePct || 0) / 100 * pensionable;
    const empKH = (pr.khEmployeePct || 0) / 100 * khBase;
    const incomeTax = Math.max(0, incomeTaxAnnual(taxableBase * 12, 1) / 12 - (s.creditPoints || 0) * (pr.creditPointValue || 0));
    const ceil = pr.niCeilingMonthly != null ? pr.niCeilingMonthly : Infinity;
    const thr = pr.niThresholdMonthly || 0;
    const capped = Math.min(taxableBase, ceil);
    const lower = Math.min(capped, thr);
    const upper = Math.max(0, capped - thr);
    const niHealth = (pr.niReducedRate || 0) / 100 * lower + (pr.niFullRate || 0) / 100 * upper;
    // Net cash = cash gross minus deductions (imputations are not cash).
    const net = grossCash - incomeTax - niHealth - empPension - empKH;
    const employerPension = (pr.pensionEmployerPct || 0) / 100 * pensionable;
    const severance = (pr.severancePct || 0) / 100 * pensionable;
    const employerKH = (pr.khEmployerPct || 0) / 100 * khBase;
    const pensionDeposit = empPension + employerPension + severance;
    const khDeposit = empKH + employerKH;
    return { grossCash, imputations, taxableBase, gross: grossCash, pensionable, khBase, incomeTax, niHealth, empPension, empKH, employerPension, severance, employerKH, net, pensionDeposit, khDeposit };
  }

  /* ---- Current-state snapshot (t0), for the dashboard --------------------- */
  function snapshot(state) {
    const usdIls = state.market.usdIls;
    const accounts = state.accounts.map((a) => ({
      id: a.id, name: a.name, kind: a.kind, currency: a.currency,
      valueILS: toILS(a, usdIls), liquid: a.liquid, includeInFire: a.includeInFire,
      accessAge: a.accessAge || 0,
    }));

    // Each grant is a virtual, computed equity account (vested value, net).
    const gv = FIRE.state.grantsVested(state);
    gv.per.forEach((pg) => {
      if (pg.net > 0 || pg.gross > 0) {
        accounts.push({ id: "grant-" + pg.grant.id, name: pg.grant.name + " (vested net)", kind: "rsu", currency: pg.grant.currency, valueILS: pg.net, liquid: true, includeInFire: true, accessAge: 0 });
      }
    });

    let total = 0, liquid = 0, nonPension = 0, pension = 0;
    accounts.forEach((a) => {
      total += a.valueILS;
      if (a.kind === "pension") pension += a.valueILS; else nonPension += a.valueILS;
      if (a.liquid) liquid += a.valueILS;
    });

    return { usdIls, accounts, total, liquid, nonPension, pension, grants: gv };
  }

  /* ---- Spending helpers --------------------------------------------------- */
  // Amounts may be entered per-month or per-year; normalize to a monthly figure.
  function catMonthly(c) { return (c.freq === "yearly" ? (c.monthly || 0) / 12 : (c.monthly || 0)); }
  function stepMonthly(s) { return (s.freq === "yearly" ? (s.monthly || 0) / 12 : (s.monthly || 0)); }

  /* ---- Spending for a given age ------------------------------------------- */
  // Which rule decides spending at a given age: 'step' | 'headline' | 'categories'.
  function spendSourceAt(state, age) {
    const sp = state.spending;
    if (sp.steps && sp.steps.length && sp.steps.some((s) => age >= s.fromAge)) return "step";
    if (age >= state.profile.fireAge && sp.useHeadlineSpending) return "headline";
    return "categories";
  }

  function monthlySpend(state, age) {
    const sp = state.spending;
    const infl = state.assumptions.inflation / 100;

    // Step override wins if one applies at this age.
    if (sp.steps && sp.steps.length) {
      const applicable = sp.steps
        .filter((s) => age >= s.fromAge)
        .sort((a, b) => b.fromAge - a.fromAge)[0];
      if (applicable) {
        const yrs = age - applicable.fromAge;
        return stepMonthly(applicable) * Math.pow(1 + (sp.growthPct / 100), yrs);
      }
    }

    const retired = age >= state.profile.fireAge;
    if (retired && sp.useHeadlineSpending) {
      const yrs = age - state.profile.fireAge;
      return sp.fireMonthly * Math.pow(1 + infl, yrs);
    }

    // Sum active categories. Amounts are "today's money" and (optionally)
    // grow with inflation/own rate from the CURRENT age forward.
    const nowAge = state.profile.currentAge;
    let sum = 0;
    (sp.categories || []).forEach((c) => {
      if (age >= c.startAge && age <= c.endAge) {
        const g = c.inflate ? (c.growthPct != null ? c.growthPct : sp.growthPct) / 100 : 0;
        const yrs = Math.max(0, age - nowAge);
        sum += catMonthly(c) * Math.pow(1 + g, yrs);
      }
    });
    return sum;
  }

  function spendBreakdown(state, age) {
    const sp = state.spending;
    const nowAge = state.profile.currentAge;
    const out = [];
    (sp.categories || []).forEach((c) => {
      if (age >= c.startAge && age <= c.endAge) {
        const g = c.inflate ? (c.growthPct != null ? c.growthPct : sp.growthPct) / 100 : 0;
        const yrs = Math.max(0, age - nowAge);
        out.push({ name: c.name, monthly: catMonthly(c) * Math.pow(1 + g, yrs) });
      }
    });
    return out;
  }

  /* ---- After-tax value of one year's vest for a grant, at projection year k */
  function grantVestNetAtYear(grant, usdIls, k) {
    const shares = grant.sharesPerYear || 0;
    if (shares <= 0) return 0;
    const price = grant.sharePrice * Math.pow(1 + (grant.expectedGrowthPct || 0) / 100, k);
    return FIRE.state.grantNet(grant, usdIls, shares, price).net;
  }

  /* ---- Full projection ---------------------------------------------------- */
  function project(state) {
    const usdIls = state.market.usdIls;
    const A0 = Math.round(state.profile.currentAge);
    const endAge = state.profile.endAge;
    const fireAge = state.profile.fireAge;
    const infl = state.assumptions.inflation / 100;

    // Build working accounts (balances in ILS). Track cost basis & cap-gains
    // rate so drawdown withdrawals can be taxed on the gain portion.
    const accs = state.accounts.map((a) => {
      const bal = toILS(a, usdIls);
      const basisOwn = FIRE.state.costBasisOf(a);
      const basis = a.currency === "USD" ? basisOwn * usdIls : basisOwn;
      return {
        id: a.id, name: a.name, kind: a.kind, group: a.group || a.kind, ret: a.expectedReturn || 0,
        contrib: a.monthlyContribution || 0, contribGrowth: a.contributionGrowthPct || 0,
        liquid: !!a.liquid, includeInFire: a.includeInFire !== false,
        accessAge: a.accessAge || 0, bal: bal, basis: Math.min(basis, bal) || 0,
        cg: a.capGainsRate || 0, annuityGrossAnnual: null,
        feeDeposit: a.feeDeposit || 0, feeBalance: a.feeBalance || 0,
      };
    });

    // Each equity grant is a virtual account seeded with its currently-vested
    // net value; it compounds at the grant's own expected growth. We keep a
    // parallel list of { acc, grant } so the yearly loop can add new vests.
    const grantAccs = [];
    (state.income.grants || []).forEach((g) => {
      const gnow = FIRE.state.grantNet(g, usdIls, g.vestedShares || 0, g.sharePrice);
      const acc = {
        id: "grant-" + g.id, name: g.name + " (net)", kind: "rsu", group: "RSU / equity",
        ret: g.expectedGrowthPct || 0, contrib: 0, contribGrowth: 0,
        liquid: true, includeInFire: true, accessAge: 0, bal: gnow.net,
        basis: gnow.net, cg: g.capGainsRate || 25, annuityGrossAnnual: null,
      };
      accs.push(acc);
      grantAccs.push({ acc, grant: g });
    });

    // Reinvestment sink: prefer money_market, then taxable, then cash.
    const sink =
      accs.find((a) => a.kind === "money_market") ||
      accs.find((a) => a.kind === "taxable") ||
      accs.find((a) => a.kind === "cash") ||
      accs[0];

    // Surplus router: apply allocation rules, remainder to the default bucket.
    // Deposits increase cost basis (they are after-tax money going in).
    const allocations = state.income.allocations || [];
    const defaultAcc = accs.find((a) => a.id === state.income.defaultAccountId) || sink;
    function deposit(acc, amt) {
      if (!acc || !amt) return;
      // Pension funds skim a management fee off every deposit.
      if (acc.kind === "pension" && acc.feeDeposit) amt *= 1 - acc.feeDeposit / 100;
      acc.bal += amt; acc.basis += amt;
    }
    function distributeSurplus(surplus) {
      let remaining = surplus;
      allocations.forEach((al) => {
        const target = accs.find((a) => a.id === al.accountId);
        if (!target || remaining <= 0) return;
        let amt = al.mode === "percent" ? surplus * (al.value / 100) : al.value * 12; // ₪/mo → /yr
        amt = Math.max(0, Math.min(amt, remaining));
        deposit(target, amt);
        remaining -= amt;
      });
      deposit(defaultAcc, remaining); // "the rest" → your default account
    }

    // Salary: gross mode computes net + infers pension/study-fund deposits;
    // net mode uses the entered take-home and each account's own contribution.
    let netMonthly = state.income.monthlyNetSalary || 0;
    let payroll = null;
    if (state.income.salaryMode === "gross") {
      payroll = computePayroll(state);
      netMonthly = payroll.net;
      const pAcc = accs.find((a) => a.kind === "pension");
      if (pAcc) { pAcc.contrib = payroll.pensionDeposit; pAcc.contribGrowth = state.income.salaryGrowthPct || 0; }
      const kAcc = accs.find((a) => a.kind === "study_fund");
      if (kAcc) { kAcc.contrib = payroll.khDeposit; kAcc.contribGrowth = state.income.salaryGrowthPct || 0; }
    }

    // Pension configuration (Israeli law-based, all editable).
    const pcfg = {
      mode: state.assumptions.pensionMode || "annuity", // 'annuity' | 'lump'
      coefficient: state.assumptions.pensionAnnuityCoefficient || 220,
      ceiling: state.assumptions.pensionEntitlingCeiling || 9430, // תקרת קצבה מזכה (today ₪/mo)
      exemptionPct: state.assumptions.pensionExemptionPct != null ? state.assumptions.pensionExemptionPct : 52,
      cpiLinked: state.assumptions.pensionCpiLinked !== false,
    };
    // Tax on an annual gross pension, given the year's inflation factor.
    function pensionTaxAnnual(grossAnnual, factor) {
      const exemptAnnual = (pcfg.exemptionPct / 100) * (pcfg.ceiling * factor) * 12;
      const taxable = Math.max(0, grossAnnual - exemptAnnual);
      return incomeTaxAnnual(taxable, factor);
    }
    const pensionConv = { potAtAccess: 0, grossAnnual: 0, factor: 1, age: null };

    // The current year is partial: count only the whole MONTHS still ahead so
    // deposits/vests line up with reality (e.g. mid-July → 6 monthly deposits
    // left, and one RSU vest, not a full year). First row = end of this year.
    const asOf = FIRE.state.refDate(state);
    const monthsLeft = Math.max(0, Math.min(12, 12 - asOf.getMonth())); // Jan=0 → 12; Jul=6 → 6
    const firstYearFrac = monthsLeft / 12;

    const rows = [];
    let depletionAge = null;

    for (let age = A0; age <= endAge; age++) {
      const yf = age === A0 ? firstYearFrac : 1; // prorate the current (partial) year
      const k = age - A0;
      const working = age < fireAge;

      // 1) Growth on existing balances (partial in the current year). Pension &
      //    study funds also skim an annual management fee off the balance.
      accs.forEach((a) => {
        a.bal *= Math.pow(1 + a.ret / 100, yf);
        if ((a.kind === "pension" || a.kind === "study_fund") && a.feeBalance) a.bal *= Math.pow(1 - a.feeBalance / 100, yf);
      });

      // 2) Auto/employer contributions while working (prorated in year 0).
      if (working) {
        accs.forEach((a) => {
          if (a.contrib > 0) deposit(a, a.contrib * 12 * Math.pow(1 + a.contribGrowth / 100, k) * yf);
        });
      }

      // 3) New grant vests (after tax). A grant vests while employed
      //    (age < fireAge) AND within its own [startAge, stopAge) window, so
      //    you can stop specific grants earlier or start them later.
      if (working) {
        grantAccs.forEach(({ acc, grant }) => {
          const start = grant.startAge != null ? grant.startAge : A0;
          const stop = grant.vestUntilRetire ? fireAge : (grant.stopAge != null ? grant.stopAge : fireAge);
          if (age >= start && age < stop) deposit(acc, grantVestNetAtYear(grant, usdIls, k) * yf);
        });
      }

      // 4) Take-home cash income (prorated in year 0).
      const salary = (working && state.income.stopSalaryAtFire
        ? netMonthly * 12 * Math.pow(1 + state.income.salaryGrowthPct / 100, k)
        : (!state.income.stopSalaryAtFire
            ? netMonthly * 12 * Math.pow(1 + state.income.salaryGrowthPct / 100, k)
            : 0)) * yf;

      let extra = 0;
      (state.income.extra || []).forEach((s) => {
        if (age >= s.startAge && age <= s.endAge) {
          extra += s.monthlyAmount * 12 * Math.pow(1 + (s.growthPct || 0) / 100, age - s.startAge);
        }
      });
      extra *= yf;

      // 5) Spending (prorated in year 0).
      const spend = monthlySpend(state, age) * 12 * yf;

      // 5b) Pension annuity income (annuity mode): convert each pension pot to a
      //     (CPI-linked) lifelong annuity at its access age, taxed per Israeli law.
      const inflFactor = Math.pow(1 + infl, k);
      let pensionGross = 0, pensionTax = 0, pensionNet = 0;
      if (pcfg.mode === "annuity") {
        accs.forEach((a) => {
          if (a.kind !== "pension") return;
          const access = a.accessAge || state.profile.pensionAccessAge;
          if (age < access) return;
          if (a.annuityGrossAnnual == null) {
            a.annuityGrossAnnual = (a.bal / pcfg.coefficient) * 12;
            pensionConv.potAtAccess += a.bal;
            pensionConv.grossAnnual += a.annuityGrossAnnual;
            pensionConv.factor = inflFactor;
            pensionConv.age = age;
          } else if (pcfg.cpiLinked) {
            a.annuityGrossAnnual *= 1 + infl;
          }
          const payGross = Math.min(a.bal, a.annuityGrossAnnual * yf);
          a.bal -= payGross;
          const tax = pensionTaxAnnual(payGross, inflFactor);
          pensionGross += payGross; pensionTax += tax; pensionNet += payGross - tax;
        });
      }

      // 6) Cash flow. Income = take-home + extra + net pension annuity.
      //    Surplus is reinvested; a shortfall is withdrawn NET from liquid
      //    accounts (selling from taxable pots incurs capital-gains tax, so the
      //    gross sale exceeds the net cash needed). We track the source of each
      //    withdrawal.
      const incomeTotal = salary + extra + pensionNet;
      let net = incomeTotal - spend;
      const sources = {}; // accountId -> net ₪ drawn for living this year
      let withdrawalNet = 0, withdrawalGross = 0, withdrawalTax = 0;
      if (net >= 0) {
        distributeSurplus(net);
      } else {
        let needNet = -net;
        const drawOrder = (state.assumptions.withdrawalOrder && state.assumptions.withdrawalOrder.length)
          ? state.assumptions.withdrawalOrder
          : WITHDRAW_PRIORITY;
        for (const kind of drawOrder) {
          if (needNet <= 1e-6) break;
          for (const a of accs) {
            if (needNet <= 1e-6) break;
            if (a.kind !== kind) continue;
            if (a.bal <= 0) continue;
            // Money earmarked as NOT part of FIRE is never spent down in retirement.
            if (!a.includeInFire) continue;
            if (a.kind === "pension") {
              if (pcfg.mode === "annuity") continue; // annuitized: not drawable
              const access = a.accessAge || state.profile.pensionAccessAge;
              if (age < access) continue; // lump mode: locked until access
            } else {
              if (!a.liquid) continue;
              if (a.accessAge && age < a.accessAge) continue;
            }
            const gainFrac = a.bal > 0 ? Math.max(0, (a.bal - a.basis) / a.bal) : 0;
            const effRate = gainFrac * (a.cg / 100); // effective tax per ₪ sold
            const deliverable = a.bal * (1 - effRate); // net if fully liquidated
            const takeNet = Math.min(needNet, deliverable);
            const grossSale = effRate < 1 ? takeNet / (1 - effRate) : takeNet;
            a.bal -= grossSale;
            a.basis = Math.max(0, a.basis - grossSale * (1 - gainFrac));
            needNet -= takeNet;
            withdrawalNet += takeNet;
            withdrawalGross += grossSale;
            withdrawalTax += grossSale - takeNet;
            sources[a.id] = (sources[a.id] || 0) + takeNet;
          }
        }
        if (needNet > 0.5 && depletionAge == null) depletionAge = age;
      }

      // 7) Record.
      const perAccount = {};
      let total = 0, liquid = 0, nonPension = 0, pension = 0, fireEligible = 0;
      accs.forEach((a) => {
        const v = Math.max(0, a.bal);
        perAccount[a.id] = v;
        total += v;
        if (a.kind === "pension") pension += v; else nonPension += v;
        const drawable = a.kind === "pension"
          ? (pcfg.mode === "lump" && age >= (a.accessAge || state.profile.pensionAccessAge))
          : (a.liquid && (!a.accessAge || age >= a.accessAge));
        if (drawable) liquid += v;
        if (a.includeInFire) fireEligible += v;
      });

      const realFactor = Math.pow(1 + infl, k);
      rows.push({
        age, k, working, salary, extra, spend, net,
        incomeTotal, pensionGross, pensionTax, pensionNet,
        withdrawalNet, withdrawalGross, withdrawalTax, sources,
        perAccount, total, liquid, nonPension, pension, fireEligible,
        realFactor,
      });
    }

    // FIRE targets from headline monthly spend.
    const annualFire = state.spending.fireMonthly * 12;
    const swr = state.assumptions.swr / 100;
    const targets = {
      swr: state.assumptions.swr,
      target: annualFire / swr,
      target4: annualFire / 0.04,
      target35: annualFire / 0.035,
      target3: annualFire / 0.03,
    };

    // Pension annuity (Israeli law): pot ÷ coefficient, split into a tax-exempt
    // portion (exemptionPct of the entitling ceiling) and a taxable remainder.
    const pf = pensionConv.factor || 1;
    const grossMonthly = pensionConv.grossAnnual / 12;
    const ceilingMonthly = pcfg.ceiling * pf;
    const exemptMonthly = Math.min(grossMonthly, (pcfg.exemptionPct / 100) * ceilingMonthly);
    const taxableMonthly = Math.max(0, grossMonthly - exemptMonthly);
    const taxMonthly = pensionTaxAnnual(pensionConv.grossAnnual, pf) / 12;
    const pensionInfo = {
      mode: pcfg.mode,
      accessAge: state.profile.pensionAccessAge,
      coefficient: pcfg.coefficient,
      potAtAccess: pensionConv.potAtAccess,
      grossMonthly,
      exemptMonthly,
      taxableMonthly,
      taxMonthly,
      netMonthly: grossMonthly - taxMonthly,
      // today's-₪ equivalents at the access year
      grossMonthlyReal: grossMonthly / pf,
      netMonthlyReal: (grossMonthly - taxMonthly) / pf,
      entitlingCeilingAtAccess: ceilingMonthly,
      exemptionPct: pcfg.exemptionPct,
    };

    const snap = snapshot(state);
    const accountsMeta = accs.map((a) => ({ id: a.id, name: a.name, kind: a.kind, group: a.group }));

    // Grouped view: aggregate accounts sharing the same group (for projections).
    const groupOrder = [];
    const groupIds = {};
    accs.forEach((a) => {
      const g = a.group || a.name;
      if (!groupIds[g]) { groupIds[g] = []; groupOrder.push(g); }
      groupIds[g].push(a.id);
    });
    const groupsMeta = groupOrder.map((g) => ({ name: g, ids: groupIds[g] }));
    // Map each account id -> its group name (for withdrawal-source labeling).
    const groupOf = {};
    accs.forEach((a) => (groupOf[a.id] = a.group || a.name));

    return {
      A0, endAge, fireAge,
      rows, accountsMeta, groupsMeta, groupOf,
      depletionAge,
      survives: depletionAge == null,
      targets,
      pension: pensionInfo,
      payroll: payroll,
      snapshot: snap,
      endNetWorth: rows.length ? rows[rows.length - 1].total : 0,
      fireRow: rows.find((r) => r.age === Math.round(fireAge)) || null,
    };
  }

  /* ---- Holdings list + "what-if" switch analysis -------------------------
   * Each holding: current market value, sell-now net (after tax), basis, the
   * capital-gains rate, and its expected growth. Used by the What-if page.
   *-----------------------------------------------------------------------*/
  function holdings(state) {
    const usdIls = state.market.usdIls;
    const out = [];
    state.accounts.forEach((a) => {
      const value = toILS(a, usdIls);
      if (value <= 0) return;
      const basisOwn = FIRE.state.costBasisOf(a);
      const basis = a.currency === "USD" ? basisOwn * usdIls : basisOwn;
      const gain = Math.max(0, value - basis);
      const taxNow = gain * (a.capGainsRate || 0) / 100;
      out.push({ id: a.id, name: a.name, kind: a.kind, value: value, net: value - taxNow, taxNow: taxNow, basis: Math.min(basis, value), cg: a.capGainsRate || 0, growth: a.expectedReturn || 0 });
    });
    (state.income.grants || []).forEach((g) => {
      const r = FIRE.state.grantNet(g, usdIls, g.vestedShares || 0, g.sharePrice);
      if (r.gross <= 0) return;
      out.push({ id: "grant-" + g.id, name: g.name + " (grant)", kind: "rsu", value: r.gross, net: r.net, taxNow: r.tax, basis: r.gross, cg: g.capGainsRate || 25, growth: g.expectedGrowthPct || 0, _grant: g, _shares: g.vestedShares || 0 });
    });
    return out;
  }

  // Build a holding from a custom (hypothetical) definition.
  function buildCustom(def, usdIls, role) {
    def = def || {};
    if (role === "target") {
      // Only growth & cap-gains rate matter for the target you buy into.
      return { id: "__custom__", name: def.name || "Custom target", kind: def.kind || "stock", value: 0, net: 0, taxNow: 0, basis: 0, cg: def.capGainsRate || 0, growth: def.growth || 0 };
    }
    if (def.kind === "rsu") {
      const g = { sharePrice: def.sharePrice || 0, vestedShares: def.vestedShares || 0, grantBasisUsd: def.grantBasisUsd || 0, currency: def.currency || "USD", ordinaryTaxRate: def.ordinaryTaxRate || 0, capGainsRate: def.capGainsRate || 25, expectedGrowthPct: def.growth || 0 };
      const r = FIRE.state.grantNet(g, usdIls, g.vestedShares, g.sharePrice);
      return { id: "__custom__", name: def.name || "Custom RSU", kind: "rsu", value: r.gross, net: r.net, taxNow: r.tax, basis: r.gross, cg: g.capGainsRate, growth: def.growth || 0, _grant: g, _shares: g.vestedShares };
    }
    const value = def.value || 0, basis = def.costBasis || 0;
    const gain = Math.max(0, value - basis);
    const taxNow = gain * (def.capGainsRate || 0) / 100;
    return { id: "__custom__", name: def.name || "Custom stock", kind: "taxable", value: value, net: value - taxNow, taxNow: taxNow, basis: Math.min(basis, value), cg: def.capGainsRate || 0, growth: def.growth || 0 };
  }

  function switchScenario(state) {
    const w = state.whatif || {};
    const usdIls = state.market.usdIls;
    const hs = holdings(state);
    const byId = {}; hs.forEach((h) => (byId[h.id] = h));
    const src = w.sourceId === "__custom__" ? buildCustom(w.customSource, usdIls, "source") : (byId[w.sourceId] || hs[0]);
    const tgt = w.targetId === "__custom__" ? buildCustom(w.customTarget, usdIls, "target") : (byId[w.targetId] || hs.find((h) => h.id !== (src && src.id)) || hs[0]);
    if (!src || !tgt) return null;
    const f = Math.max(0, Math.min(1, (w.sellPct != null ? w.sellPct : 100) / 100));
    const isCustomSrc = w.sourceId === "__custom__";
    const isCustomTgt = w.targetId === "__custom__";
    const srcG = ((isCustomSrc ? src.growth : (w.sourceGrowth != null ? w.sourceGrowth : src.growth))) / 100;
    const tgtG = ((isCustomTgt ? tgt.growth : (w.targetGrowth != null ? w.targetGrowth : tgt.growth))) / 100;
    const years = w.years || 20;

    const sellGross = src.value * f;
    const taxNow = src.taxNow * f;
    const netReinvest = src.net * f;
    const srcBasis = src.basis * f;

    const rows = [];
    let crossover = null, crossoverAT = null;
    const srcGrant = src._grant;
    const srcShares = (src._shares || 0) * f;
    for (let t = 0; t <= years; t++) {
      let keep, keepAT;
      if (srcGrant) {
        // A kept grant still owes its Section-102 tax when sold at the horizon.
        const price = srcGrant.sharePrice * Math.pow(1 + srcG, t);
        const r = FIRE.state.grantNet(srcGrant, usdIls, srcShares, price);
        keep = r.gross; keepAT = r.net;
      } else {
        keep = sellGross * Math.pow(1 + srcG, t);
        keepAT = keep - (src.cg / 100) * Math.max(0, keep - srcBasis);
      }
      const sw = netReinvest * Math.pow(1 + tgtG, t);
      const swAT = sw - (tgt.cg / 100) * Math.max(0, sw - netReinvest);
      if (crossover == null && sw > keep) crossover = t;
      if (crossoverAT == null && swAT > keepAT) crossoverAT = t;
      rows.push({ t, keep, sw, keepAT, swAT });
    }
    return { src, tgt, srcG: srcG * 100, tgtG: tgtG * 100, sellGross, taxNow, netReinvest, years, rows, crossover, crossoverAT };
  }

  /* ---- Earliest FIRE age --------------------------------------------------
   * Find the lowest retirement age at which the plan still survives to endAge
   * (liquid never runs out before pension access, nothing depletes). Returns
   * { found, age, yearsAway }.
   *-----------------------------------------------------------------------*/
  function earliestFireAge(state) {
    const start = Math.round(state.profile.currentAge);
    const end = state.profile.endAge;
    for (let fa = start; fa <= end; fa++) {
      const t = FIRE.state.clone(state);
      t.profile.fireAge = fa;
      const p = project(t);
      if (p.survives) return { found: true, age: fa, yearsAway: fa - start };
    }
    return { found: false, age: null, yearsAway: null };
  }

  FIRE.engine = { project, snapshot, monthlySpend, spendSourceAt, spendBreakdown, grantVestNetAtYear, earliestFireAge, computePayroll, holdings, switchScenario, WITHDRAW_PRIORITY };
})();
