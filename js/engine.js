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
 *  - RSU: already-vested shares are a virtual equity account held at gross
 *    value; future vests are added while working and below vestUntilAge.
 *    Section-102 tax is paid on sale.
 *  - Cash flows happen at the start of each month, then the month's growth.
 *  - Balances are reported before tax (`total`); `liquid` is the after-tax
 *    value of selling every non-pension account at that point.
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

  // Marginal cost of stacking `amount` of ordinary income on top of `base`
  // (both annual, nominal ₪). This is what a slice of income actually costs at
  // the taxpayer's real bracket, rather than at a guessed flat rate.
  function marginalTaxOn(amount, base, factor) {
    if (amount <= 0) return 0;
    base = Math.max(0, base || 0);
    return incomeTaxAnnual(base + amount, factor) - incomeTaxAnnual(base, factor);
  }

  /* ---- Progressive pricing for Section-102 ordinary income ----------------
   * Returns a resolver for `state.grantNet`'s `ordinaryTax` hook. It is
   * STATEFUL on purpose: each slice it prices is added to the running stack, so
   * selling several grants in one year pushes later slices into higher brackets
   * exactly as a real tax return would. `base` is the year's other ordinary
   * taxable income (salary, taxable pension).
   *-----------------------------------------------------------------------*/
  function ordinaryTaxStacker(base, factor) {
    let stacked = Math.max(0, base || 0);
    return function (amount) {
      const tax = marginalTaxOn(amount, stacked, factor);
      stacked += Math.max(0, amount);
      return tax;
    };
  }

  // The year's ordinary taxable income from salary, for stacking. Gross mode
  // knows the real taxable base; net mode only stores take-home, which
  // understates it — documented in docs/MODEL.md.
  function taxableSalaryAnnual(state, payroll) {
    if (payroll) return payroll.taxableBase * 12;
    return (state.income.monthlyNetSalary || 0) * 12;
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

  /* ---- Section-102 ordinary tax resolver for "sell today" views -----------
   * Prices the ordinary slice of a grant sale at the marginal rate, stacked on
   * this year's salary. Used by the dashboard snapshot so its RSU figure agrees
   * with the projection's; the projection builds its own stacker per year (it
   * also has pension income to stack on).
   *-----------------------------------------------------------------------*/
  function grantOrdinaryTaxFor(state) {
    const payroll = state.income.salaryMode === "gross" ? computePayroll(state) : null;
    return ordinaryTaxStacker(taxableSalaryAnnual(state, payroll), 1);
  }

  /* ---- Current-state snapshot (t0), for the dashboard --------------------- */
  function snapshot(state) {
    const usdIls = state.market.usdIls;
    const accounts = state.accounts.map((a) => {
      const valueILS = toILS(a, usdIls);
      const basisOwn = FIRE.state.costBasisOf(a);
      const basis = a.currency === "USD" ? basisOwn * usdIls : basisOwn;
      return {
        id: a.id, name: a.name, kind: a.kind, currency: a.currency,
        valueILS, liquid: a.liquid, includeInFire: a.includeInFire,
        accessAge: a.accessAge || 0,
        saleTax: saleTaxOf(a.kind, valueILS, basis, a.capGainsRate || 0),
      };
    });

    // Each grant is a virtual, computed equity account, shown at its GROSS
    // value like every other balance. Its Section-102 tax (the ordinary slice
    // at your real marginal rate on top of this year's salary, plus capital
    // gains on the appreciation) only reduces the after-tax Liquid figure.
    const gv = FIRE.state.grantsVested(state, grantOrdinaryTaxFor(state));
    gv.per.forEach((pg) => {
      if (pg.gross > 0) {
        accounts.push({ id: "grant-" + pg.grant.id, name: pg.grant.name + " (vested)", kind: "rsu", currency: pg.grant.currency, valueILS: pg.gross, liquid: true, includeInFire: true, accessAge: 0, saleTax: pg.tax });
      }
    });

    // total/nonPension/pension are BEFORE tax. `liquid` is AFTER tax: what
    // selling every non-pension account today would put in your hand.
    let total = 0, nonPension = 0, pension = 0, liquid = 0, liquidTax = 0, drawable = 0;
    accounts.forEach((a) => {
      total += a.valueILS;
      if (a.kind === "pension") pension += a.valueILS;
      else {
        nonPension += a.valueILS;
        liquid += a.valueILS - a.saleTax;
        liquidTax += a.saleTax;
      }
      if (a.liquid) drawable += a.valueILS;
    });

    // Real-estate equity (value − remaining mortgage principal) counts in
    // net worth, but not in liquid / non-pension financial assets. Skipped
    // entirely when the Mortgage tab is in simulation-only mode.
    let reValue = 0, reDebt = 0;
    if (!(state.realEstate && state.realEstate.includeInPlan === false)) {
      (((state.realEstate || {}).properties) || []).forEach((p) => (reValue += p.value || 0));
      (((state.realEstate || {}).loans) || []).forEach((l) => (reDebt += l.principal || 0));
    }
    total += reValue - reDebt;

    return { usdIls, accounts, total, liquid, liquidTax, drawable, nonPension, pension, reValue, reDebt, reEquity: reValue - reDebt, grants: gv };
  }

  // Capital-gains tax due on selling a whole (non-grant) account. Cash and the
  // study fund are sold tax-free; pension is never part of the liquid figure.
  function saleTaxOf(kind, value, basis, cgPct) {
    if (kind === "pension" || kind === "cash" || kind === "study_fund") return 0;
    return Math.max(0, value - (basis || 0)) * ((cgPct || 0) / 100);
  }

  /* ---- Spending helpers --------------------------------------------------- */
  // Amounts may be entered per-month or per-year; normalize to a monthly figure.
  function catMonthly(c) { return (c.freq === "yearly" ? (c.monthly || 0) / 12 : (c.monthly || 0)); }
  function stepMonthly(s) { return (s.freq === "yearly" ? (s.monthly || 0) / 12 : (s.monthly || 0)); }

  /* ---- Spending for a given age ------------------------------------------- */
  // The latest step whose fromAge you've passed (or null).
  function stepAt(state, age) {
    const steps = state.spending.steps || [];
    return steps.filter((s) => age >= s.fromAge).sort((a, b) => b.fromAge - a.fromAge)[0] || null;
  }
  // Which category list applies at this age: a 'list'-mode step wins,
  // otherwise the active list.
  function listIdAt(state, age) {
    const sp = state.spending;
    const s = stepAt(state, age);
    if (s && (s.mode || "amount") === "list" && s.listId && (sp.lists || []).some((l) => l.id === s.listId)) return s.listId;
    return sp.activeListId;
  }
  function categoriesAt(state, age) {
    return FIRE.state.listCategories(state, listIdAt(state, age));
  }
  // Which rule decides spending at a given age:
  // 'step' (fixed-amount step) | 'list' (list-switch step) | 'headline' | 'categories'.
  function spendSourceAt(state, age) {
    const sp = state.spending;
    const s = stepAt(state, age);
    if (s) return (s.mode || "amount") === "list" ? "list" : "step";
    if (age >= state.profile.fireAge && sp.useHeadlineSpending) return "headline";
    return "categories";
  }

  function monthlySpend(state, age) {
    const sp = state.spending;
    const infl = state.assumptions.inflation / 100;

    // Step override wins if one applies at this age. A fixed-amount step sets
    // the total; a list-mode step switches the category list (handled below).
    const applicable = stepAt(state, age);
    if (applicable && (applicable.mode || "amount") === "amount") {
      const yrs = age - applicable.fromAge;
      return stepMonthly(applicable) * Math.pow(1 + (sp.growthPct / 100), yrs);
    }

    const retired = age >= state.profile.fireAge;
    if (!applicable && retired && sp.useHeadlineSpending) {
      const yrs = age - state.profile.fireAge;
      return sp.fireMonthly * Math.pow(1 + infl, yrs);
    }

    // Sum active categories of the list in force at this age. Amounts are
    // "today's money" and (optionally) grow with inflation/own rate from the
    // CURRENT age forward. `endAge` is compared as `< endAge + 1` so it keeps
    // its inclusive-whole-year meaning: identical for integer ages, and for the
    // fractional ages the monthly engine passes it runs through the birthday
    // after endAge rather than truncating the window by up to a year.
    const nowAge = state.profile.currentAge;
    let sum = 0;
    categoriesAt(state, age).forEach((c) => {
      if (age >= c.startAge && age < (c.endAge || 0) + 1) {
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
    categoriesAt(state, age).forEach((c) => {
      if (age >= c.startAge && age < (c.endAge || 0) + 1) {
        const g = c.inflate ? (c.growthPct != null ? c.growthPct : sp.growthPct) / 100 : 0;
        const yrs = Math.max(0, age - nowAge);
        out.push({ name: c.name, monthly: catMonthly(c) * Math.pow(1 + g, yrs) });
      }
    });
    return out;
  }

  /* ---- Israeli mortgage tracks (מסלולים) & amortization ---------------------
   * Tracks:
   *   fixed     קל"צ   — fixed rate, not CPI-linked (payment constant)
   *   fixed_cpi ק"צ    — fixed rate, CPI-linked principal & payment
   *   prime     פריים  — variable (BoI + margin), not linked; the rate drifts
   *                      per the scenario (primeChangePp over primeYears)
   *   var5      משתנה צמודה     — rate resets every 60 months (+resetStepPp),
   *                               CPI-linked
   *   var5ni    משתנה לא צמודה  — rate resets every 60 months, not linked
   * Methods: 'spitzer' (annuity — payment recomputed from balance/rate/term
   * each month, which equals the classic constant payment for fixed unlinked
   * loans and handles rate changes/linkage correctly) or 'equal' (קרן שווה —
   * equal principal, declining payments).
   *-------------------------------------------------------------------------*/
  const LOAN_TRACKS = {
    fixed: { label: 'קל"צ — fixed, not linked', cpi: false },
    fixed_cpi: { label: "קבועה צמודה — fixed, CPI-linked", cpi: true },
    prime: { label: "פריים — variable (prime)", cpi: false },
    var5: { label: "משתנה כל 5 — CPI-linked", cpi: true },
    var5ni: { label: "משתנה כל 5 — not linked", cpi: false },
  };
  function loanTrackOf(l) {
    if (l.track && LOAN_TRACKS[l.track]) return l.track;
    return l.cpiLinked ? "fixed_cpi" : "fixed"; // legacy loans
  }
  function initLoan(l, scenario) {
    const n = Math.max(1, Math.round((l.years || 0) * 12));
    const track = loanTrackOf(l);
    return {
      id: l.id, bal: l.principal || 0, rate0: l.annualRatePct || 0,
      monthsLeft: n, m: 0, track, cpi: LOAN_TRACKS[track].cpi,
      method: l.method === "equal" ? "equal" : "spitzer",
      scenario: scenario || {}, totalInterest: 0, lastPay: 0,
    };
  }
  // Annual rate (%) of a loan at month index m, under the rate scenario.
  function loanRateAt(L, m) {
    const sc = L.scenario;
    let r = L.rate0;
    if (L.track === "prime") {
      const horizon = Math.max(0.01, sc.primeYears != null ? sc.primeYears : 5);
      r = L.rate0 + (sc.primeChangePp || 0) * Math.min(1, (m / 12) / horizon);
    } else if (L.track === "var5" || L.track === "var5ni") {
      r = L.rate0 + Math.floor(m / 60) * (sc.resetStepPp || 0);
    }
    return Math.max(0, r);
  }
  // Advance a loan by up to `months` months. Returns the cash paid.
  function stepLoan(L, months, inflMonthly) {
    let paid = 0;
    for (let i = 0; i < months && L.monthsLeft > 0 && L.bal > 1e-6; i++) {
      if (L.cpi && inflMonthly) L.bal *= 1 + inflMonthly; // linkage on the principal
      const rm = loanRateAt(L, L.m) / 100 / 12;
      const interest = L.bal * rm;
      let pay;
      if (L.method === "equal") {
        pay = L.bal / L.monthsLeft + interest; // equal principal, declining payment
      } else {
        pay = rm > 0 ? L.bal * rm / (1 - Math.pow(1 + rm, -L.monthsLeft)) : L.bal / L.monthsLeft;
      }
      pay = Math.min(Math.max(pay, interest), L.bal + interest); // final payment clears the loan
      L.bal = Math.max(0, L.bal - (pay - interest));
      L.monthsLeft--; L.m++;
      L.totalInterest += interest;
      L.lastPay = pay;
      paid += pay;
    }
    return paid;
  }
  // Full lifetime stats + a yearly payment/balance series for one loan.
  function loanSchedule(l, inflationPct, scenario) {
    const L = initLoan(l, scenario);
    const inflM = Math.pow(1 + (inflationPct || 0) / 100, 1 / 12) - 1;
    let months = 0, totalPaid = 0, payNow = 0, payMax = 0;
    const payByYear = [], balByYear = [];
    while (L.monthsLeft > 0 && L.bal > 1e-6 && months < 12000) {
      const p = stepLoan(L, 1, inflM);
      if (months === 0) payNow = p;
      if (p > payMax) payMax = p;
      totalPaid += p;
      months++;
      // Sample the payment at the first month of each year (year 0, 1, 2, …).
      if ((months - 1) % 12 === 0) { payByYear.push(p); balByYear.push(L.bal); }
    }
    return { payMonthly: payNow, payNow, payMax, months, totalPaid, totalInterest: L.totalInterest, payByYear, balByYear };
  }

  /* ---- One year's vest for a grant, at projection year k -------------------
   * Returns the GROSS value and the ordinary-income slice. No tax is taken
   * here: under the Section-102 capital-gains track the tax event is the sale,
   * so the shares enter the grant account gross and the ordinary slice is
   * carried as a deferred liability until they are sold.
   *-----------------------------------------------------------------------*/
  function grantVestAtYear(grant, usdIls, k) {
    const shares = grant.sharesPerYear || 0;
    if (shares <= 0) return { gross: 0, ordinary: 0 };
    const price = grant.sharePrice * Math.pow(1 + (grant.expectedGrowthPct || 0) / 100, k);
    const r = FIRE.state.grantNet(grant, usdIls, shares, price);
    return { gross: r.gross, ordinary: r.ordinary };
  }

  /* ---- Full projection ----------------------------------------------------
   * opts.returnOverride(acc, k) — optional hook returning the annual return %
   * for a working account in projection year k (used by Monte Carlo).
   *-------------------------------------------------------------------------*/
  function project(state, opts) {
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
    // GROSS value; it compounds at the grant's own expected growth. Section-102
    // tax is deferred to the sale, so each account also carries `ord` — the
    // ordinary-income slice (shares × grant basis, in ₪). That slice is pinned
    // to grant-date value and never grows; everything above it is capital gain.
    // `basis` mirrors `ord` so the generic gain-fraction readers stay correct.
    const grantAccs = [];
    (state.income.grants || []).forEach((g) => {
      const gnow = FIRE.state.grantNet(g, usdIls, FIRE.state.vestedSharesOf(state, g), g.sharePrice);
      const acc = {
        id: "grant-" + g.id, name: g.name, kind: "rsu", group: "RSU / equity",
        ret: g.expectedGrowthPct || 0, contrib: 0, contribGrowth: 0,
        liquid: true, includeInFire: true, accessAge: 0, bal: gnow.gross,
        basis: gnow.ordinary, ord: gnow.ordinary, isGrant: true,
        cg: g.capGainsRate || 25, annuityGrossAnnual: null,
      };
      accs.push(acc);
      grantAccs.push({ acc, grant: g });
    });

    // Real estate: properties appreciate & pay rent; mortgages amortize
    // monthly (Spitzer), optionally CPI-linked. Equity counts in net worth
    // but is never liquid/FIRE-eligible; rent adds to income, payments to
    // outgoings. When the Mortgage tab is in simulation-only mode
    // (includeInPlan = false) none of this touches the plan.
    const reOn = !(state.realEstate && state.realEstate.includeInPlan === false);
    const props = (reOn && ((state.realEstate && state.realEstate.properties) || []) || []).map((p) => ({
      id: p.id, val: p.value || 0, growth: p.growthPct || 0,
      rent: p.rentMonthly || 0, rentGrowth: p.rentGrowthPct || 0,
    }));
    const loans = (reOn && ((state.realEstate && state.realEstate.loans) || []) || []).map((l) => initLoan(l, (state.realEstate || {}).scenario || {}));

    // Coast-FIRE what-if: from `_coastFrom` (exclusive of retirement) stop all
    // new savings — no contributions, no vests, no surplus — income is assumed
    // to exactly cover spending; balances only compound.
    const coastFrom = state._coastFrom != null ? state._coastFrom : null;

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
    // Vesting shares into a grant account: gross grows the balance, the
    // ordinary slice grows the deferred Section-102 liability. Untaxed here —
    // nothing is owed until the shares are sold.
    function depositGrant(acc, gross, ordinary) {
      if (!acc || !(gross > 0)) return;
      acc.bal += gross;
      acc.ord += Math.max(0, ordinary || 0);
      acc.basis = acc.ord;
    }
    // Invest one month's surplus at the start of that month. Fixed allocation
    // rules are ₪/mo. Each deposit is recorded in `ledger` (this calendar
    // year's surplus deposits per account) so a later deficit in the same year
    // can pull that money back before anything is sold.
    function distributeSurplus(surplus, ledger) {
      let remaining = surplus;
      const put = (acc, amt) => {
        if (!acc || !(amt > 0)) return;
        deposit(acc, amt);
        if (ledger) ledger.set(acc, (ledger.get(acc) || 0) + amt);
      };
      allocations.forEach((al) => {
        const target = accs.find((a) => a.id === al.accountId);
        if (!target || remaining <= 0) return;
        let amt = al.mode === "percent" ? surplus * (al.value / 100) : al.value; // ₪/mo
        amt = Math.max(0, Math.min(amt, remaining));
        put(target, amt);
        remaining -= amt;
      });
      put(defaultAcc, remaining); // "the rest" → your default account
    }
    // Take back up to `need` of this year's own surplus deposits, at cost
    // basis and untaxed — as if that surplus had simply been kept as cash.
    // Most recent deposits are reversed first. Returns what is still needed.
    function pullBackSurplus(need, ledger) {
      const entries = Array.from(ledger.entries()).reverse();
      for (const [acc, amt] of entries) {
        if (need <= 1e-6) break;
        const take = Math.min(need, amt, Math.max(0, acc.bal));
        if (!(take > 0)) continue;
        acc.bal -= take;
        acc.basis = Math.max(0, acc.basis - take);
        ledger.set(acc, amt - take);
        need -= take;
      }
      return Math.max(0, need);
    }

    // ---- Section-102 sale pricing for grant accounts ----------------------
    // Tax due on selling `gross` from a grant account: its pro-rata ordinary
    // slice at the MARGINAL rate on top of `stackBase` (the year's other
    // ordinary taxable income), plus capital gains on the appreciation above it.
    function grantSaleTax(a, gross, stackBase, factor) {
      if (!(gross > 0) || !(a.bal > 0)) return 0;
      const frac = Math.min(1, gross / a.bal);
      const ord = a.ord * frac;
      const gain = Math.max(0, gross - ord);
      return marginalTaxOn(ord, stackBase, factor) + gain * (a.cg / 100);
    }
    // Gross sale that nets exactly `wantNet`. Tax rises monotonically with the
    // sale size (progressive brackets + capital gains), so bisect rather than
    // trying to invert a piecewise rate.
    function grantGrossForNet(a, wantNet, stackBase, factor) {
      let lo = Math.min(wantNet, a.bal), hi = a.bal;
      for (let i = 0; i < 48 && hi - lo > 0.5; i++) {
        const mid = (lo + hi) / 2;
        if (mid - grantSaleTax(a, mid, stackBase, factor) < wantNet) lo = mid;
        else hi = mid;
      }
      return Math.min(a.bal, hi);
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
      exemptionAuto: state.assumptions.pensionExemptionAuto !== false,
      exemptionPct: state.assumptions.pensionExemptionPct != null ? state.assumptions.pensionExemptionPct : 57.5,
      // The exemption (קיבוע זכויות) only applies from the official retirement
      // age — an annuity drawn at 60 is fully taxable until this age.
      exemptionFromAge: state.assumptions.pensionExemptionFromAge || 67,
      // קצבה מזערית (today's ₪/mo): lump-sum allowed only above the pot that
      // secures this minimum annuity.
      minAnnuity: state.assumptions.pensionMinAnnuity != null ? state.assumptions.pensionMinAnnuity : 5306,
      cpiLinked: state.assumptions.pensionCpiLinked !== false,
    };
    // Statutory exemption % of the entitling ceiling for a calendar year
    // (Amendment 190 as rescheduled: 52% ≤2024 → 67% from 2028).
    function exemptionPctAt(year) {
      if (!pcfg.exemptionAuto) return pcfg.exemptionPct;
      if (year >= 2028) return 67;
      if (year === 2027) return 62.5;
      if (year === 2026) return 57.5;
      if (year === 2025) return 57;
      return 52;
    }
    // Taxable portion of an annual gross pension, given the year's inflation
    // factor. The exemption applies only from `exemptionFromAge` and can be
    // turned off (e.g. when the exempt capital was already used by a lump-sum
    // היוון). Split out from pensionTaxAnnual because the taxable figure is also
    // the stacking base for other ordinary income in the same year.
    function pensionTaxableAnnual(grossAnnual, factor, atAge, year, useExemption) {
      const eligible = useExemption !== false && (atAge == null || atAge >= pcfg.exemptionFromAge);
      const exemptAnnual = eligible ? (exemptionPctAt(year) / 100) * (pcfg.ceiling * factor) * 12 : 0;
      return Math.max(0, grossAnnual - exemptAnnual);
    }
    function pensionTaxAnnual(grossAnnual, factor, atAge, year, useExemption) {
      return incomeTaxAnnual(pensionTaxableAnnual(grossAnnual, factor, atAge, year, useExemption), factor);
    }
    const pensionConv = { potAtAccess: 0, grossAnnual: 0, annuitizedPot: 0, factor: 1, age: null, year: null };
    // Lump-mode bookkeeping across pension accounts: how much pot has been
    // annuitized toward the statutory minimum, and how much of the exempt
    // capital (היוון פטור: pct × ceiling × 180 months) has been consumed.
    let lumpSecuredPot = 0, lumpExemptUsed = 0, lumpUsedExemption = false;

    /* ---- Monthly time base -------------------------------------------------
     * The projection advances in CALENDAR MONTHS, from the as-of month through
     * December of the final year, and aggregates each calendar year into one
     * annual row — the shape every UI consumer expects. Starting at the as-of
     * month is what makes the first year partial, so the old `firstYearFrac`
     * fudge is gone.
     *
     * Everything that is a RATE converts to its monthly equivalent
     * ((1+r)^(1/12)−1, so twelve months compound to exactly the annual rate).
     * Everything that is a BOUNDARY (retirement, pension access, account
     * access, category/stream/grant windows) is tested against the exact
     * fractional age each month, so it lands on the real birthday instead of
     * snapping to 1 January.
     *----------------------------------------------------------------------*/
    const asOf = FIRE.state.refDate(state);
    const startYear = asOf.getFullYear();
    const startMonth = asOf.getMonth();                  // 0 = January
    const nYears = Math.max(1, Math.round(endAge - A0) + 1);
    const totalMonths = nYears * 12 - startMonth;
    const inflM = Math.pow(1 + infl, 1 / 12) - 1;
    const monthlyRate = (annualPct) => Math.pow(1 + (annualPct || 0) / 100, 1 / 12) - 1;
    const collectMonthly = !opts || opts.collectMonthly !== false;

    // Exact age on the first day of a projection month. Uses the birth date
    // when one is set (so boundaries land on the real birthday); otherwise
    // advances `currentAge` one twelfth at a time.
    const baseAge = state.profile.currentAge != null ? state.profile.currentAge : A0;
    function exactAgeAtMonth(y, m, mi) {
      const a = FIRE.state.exactAgeAt(state, new Date(y, m, 1));
      return a != null ? a : baseAge + mi / 12;
    }

    const drawOrder = (state.assumptions.withdrawalOrder && state.assumptions.withdrawalOrder.length)
      ? state.assumptions.withdrawalOrder
      : WITHDRAW_PRIORITY;

    /* Sell `needNet` of net cash from the liquid accounts in priority order.
     * `Y` carries the year-to-date tax state, so a Section-102 ordinary slice
     * realized in March stacks under one realized in November — the brackets
     * settle per calendar year even though the cash moves monthly.
     * Returns the amount still unfunded (0 when fully covered). */
    function withdrawNet(needNet, exAge, Y, factor) {
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
            if (exAge < access) continue;          // lump mode: locked until access
          } else {
            if (!a.liquid) continue;
            if (a.accessAge && exAge < a.accessAge) continue;
          }
          if (a.isGrant) {
            // Section-102 capital-gains track: the tax falls due HERE, on the
            // sale. Ordinary slice at the marginal rate on this year's stack;
            // appreciation above it at the grant's capital-gains rate.
            const fullTax = grantSaleTax(a, a.bal, Y.ordStack, factor);
            const deliverable = Math.max(0, a.bal - fullTax);
            if (deliverable <= 1e-6) continue;
            const takeNet = Math.min(needNet, deliverable);
            const grossSale = takeNet >= deliverable - 1e-6
              ? a.bal
              : grantGrossForNet(a, takeNet, Y.ordStack, factor);
            const ordSold = a.ord * (grossSale / a.bal);
            const tax = grantSaleTax(a, grossSale, Y.ordStack, factor);
            const netGot = Math.max(0, grossSale - tax);
            a.bal -= grossSale;
            a.ord = Math.max(0, a.ord - ordSold);
            a.basis = a.ord;
            Y.ordStack += ordSold;                 // later sales stack on top
            needNet -= netGot;
            Y.withdrawalNet += netGot;
            Y.withdrawalGross += grossSale;
            Y.withdrawalTax += tax;
            Y.sources[a.id] = (Y.sources[a.id] || 0) + netGot;
            continue;
          }
          const gainFrac = a.bal > 0 ? Math.max(0, (a.bal - a.basis) / a.bal) : 0;
          const effRate = gainFrac * (a.cg / 100);  // effective tax per ₪ sold
          const deliverable = a.bal * (1 - effRate);
          const takeNet = Math.min(needNet, deliverable);
          const grossSale = effRate < 1 ? takeNet / (1 - effRate) : takeNet;
          a.bal -= grossSale;
          a.basis = Math.max(0, a.basis - grossSale * (1 - gainFrac));
          needNet -= takeNet;
          Y.withdrawalNet += takeNet;
          Y.withdrawalGross += grossSale;
          Y.withdrawalTax += grossSale - takeNet;
          Y.sources[a.id] = (Y.sources[a.id] || 0) + takeNet;
        }
      }
      return Math.max(0, needNet);
    }

    // Fresh per-calendar-year accumulator: flows sum over the year, tax state
    // accrues year-to-date and settles within the year.
    function newYear(k, year, age) {
      return {
        k, year, age, workingMonths: 0, months: 0,
        salary: 0, extra: 0, spend: 0, incomeTotal: 0, net: 0,
        pensionGross: 0, pensionTax: 0, pensionNet: 0, oldAge: 0,
        pensionLumpGross: 0, pensionLumpTax: 0, pensionLumpNet: 0,
        rentIncome: 0, mortgagePay: 0,
        withdrawalNet: 0, withdrawalGross: 0, withdrawalTax: 0, sources: {},
        // year-to-date tax state
        ordStack: 0, pensionGrossYTD: 0, pensionTaxYTD: 0,
        // this year's surplus deposits per account (for same-year pull-back)
        surplusDeposits: new Map(),
      };
    }

    const rows = [];
    const monthly = [];
    let depletionAge = null, depletionExactAge = null;
    // Cash float kept for the monthly series' `buffer` field. With surplus now
    // invested in the month it arises and deficits funded immediately, it is
    // always 0 at month end.
    let buffer = 0;
    let Y = null;

    for (let mi = 0; mi < totalMonths; mi++) {
      const absMonth = startMonth + mi;
      const year = startYear + Math.floor(absMonth / 12);
      const month = absMonth % 12;                       // 0..11
      const k = year - startYear;
      const age = A0 + k;                                // integer age: row contract
      const exAge = exactAgeAtMonth(year, month, mi);
      const inflFactor = Math.pow(1 + infl, k);          // statutory year factor
      const isYearEnd = month === 11 || mi === totalMonths - 1;

      if (!Y || Y.k !== k) {
        Y = newYear(k, year, age);
        // CPI-link the running annuity once per calendar year.
        if (k > 0 && pcfg.cpiLinked) {
          accs.forEach((a) => {
            if (a.kind === "pension" && a.annuityGrossAnnual != null) a.annuityGrossAnnual *= 1 + infl;
          });
        }
      }
      Y.months++;

      const working = exAge < fireAge;
      const coasting = coastFrom != null && working && exAge >= coastFrom;
      if (working) Y.workingMonths++;

      // Every cash flow of the month (contributions, vests, income, spending,
      // surplus deposits, withdrawals) happens on its FIRST day; the month's
      // growth is applied last (step 7), so money deposited this month earns
      // this month's return and money withdrawn does not.

      // 2) Auto/employer contributions — one month's worth, deposited monthly
      //    so they start compounding in the month they are made.
      if (working && !coasting) {
        accs.forEach((a) => {
          if (a.contrib > 0) deposit(a, a.contrib * Math.pow(1 + a.contribGrowth / 100, k));
        });
      }

      // 3) Grant vests. Shares enter GROSS with their ordinary slice recorded
      //    as deferred Section-102 tax — nothing is owed until they are sold.
      //    Dated events vest in their own month; a flat sharesPerYear grant
      //    vests a twelfth each month while inside its [startAge, stopAge) window.
      if (working && !coasting) {
        grantAccs.forEach(({ acc, grant }) => {
          const events = (grant.vests || []).filter((v) => v && v.date && (v.shares || 0) > 0);
          if (events.length) {
            events.forEach((v) => {
              const d = new Date(v.date);
              if (isNaN(d.getTime())) return;
              if (d.getFullYear() !== year || d.getMonth() !== month) return;
              if (d <= asOf) return;             // already in the vested seed
              const yrs = Math.max(0, (d - asOf) / (365.25 * 24 * 3600 * 1000));
              const price = grant.sharePrice * Math.pow(1 + (grant.expectedGrowthPct || 0) / 100, yrs);
              const r = FIRE.state.grantNet(grant, usdIls, v.shares, price);
              depositGrant(acc, r.gross, r.ordinary);
            });
          } else {
            const start = grant.startAge != null ? grant.startAge : A0;
            const stop = grant.vestUntilRetire ? fireAge : (grant.stopAge != null ? grant.stopAge : fireAge);
            if (exAge >= start && exAge < stop) {
              const v = grantVestAtYear(grant, usdIls, k);
              depositGrant(acc, v.gross / 12, v.ordinary / 12);
            }
          }
        });
      }

      // 4) One month of take-home pay. `netMonthly` is already a monthly figure.
      const salaryM = (state.income.stopSalaryAtFire && !working)
        ? 0
        : netMonthly * Math.pow(1 + state.income.salaryGrowthPct / 100, k);

      // 4a) Extra income streams inside their own age window. `endAge` keeps its
      //     inclusive-year meaning (< endAge+1) so stream durations are unchanged
      //     — only the month they start and stop moves onto the birthday.
      let extraM = 0;
      (state.income.extra || []).forEach((s) => {
        if (exAge >= s.startAge && exAge < (s.endAge || 0) + 1) {
          extraM += s.monthlyAmount * Math.pow(1 + (s.growthPct || 0) / 100, Math.max(0, exAge - s.startAge));
        }
      });

      // 4b) Real estate: one month of appreciation, rent, and amortization.
      //     stepLoan is already a monthly engine, so it advances exactly one month.
      let rentM = 0, mortgageM = 0;
      props.forEach((p) => {
        p.val *= 1 + monthlyRate(p.growth);
        rentM += p.rent * Math.pow(1 + p.rentGrowth / 100, k);
      });
      loans.forEach((L) => { mortgageM += stepLoan(L, 1, inflM); });

      // 4c) Bituach Leumi old-age pension (today's ₪, CPI-grown, untaxed).
      const oa = state.assumptions.oldAge || {};
      const oldAgeM = oa.enabled && exAge >= (oa.fromAge || 70)
        ? (oa.monthly || 0) * Math.pow(1 + infl, k) : 0;

      // 5) One month of spending, resolved at the exact age.
      const spendM = monthlySpend(state, exAge);

      // 5b) Pension. The annuity conversion and the lump-sum היוון are one-off
      //     events that now fire in the month the access age is actually
      //     reached. The annuity pays monthly; its tax accrues year-to-date and
      //     is charged as the increment each month, which keeps the annual
      //     exemption exact even when the annuity starts mid-year.
      let pensionGrossM = 0, pensionLumpGrossM = 0, pensionLumpTaxM = 0, pensionLumpNetM = 0;
      accs.forEach((a) => {
        if (a.kind !== "pension") return;
        const access = a.accessAge || state.profile.pensionAccessAge;
        if (exAge < access) return;

        if (pcfg.mode === "annuity") {
          if (a.annuityGrossAnnual == null) {
            a.annuityGrossAnnual = (a.bal / pcfg.coefficient) * 12;
            pensionConv.potAtAccess += a.bal;
            pensionConv.annuitizedPot += a.bal;
            pensionConv.grossAnnual += a.annuityGrossAnnual;
            pensionConv.factor = inflFactor;
            pensionConv.age = age;
            pensionConv.year = year;
            a.bal = 0; a.basis = 0; a.contrib = 0;
          }
          pensionGrossM += a.annuityGrossAnnual / 12;
        } else {
          if (!a._lumpProcessed) {
            a._lumpProcessed = true;
            const minMonthly = pcfg.minAnnuity * inflFactor;
            const requiredPot = Math.max(0, minMonthly * pcfg.coefficient - lumpSecuredPot);
            const toAnnuitize = Math.min(a.bal, requiredPot);
            if (toAnnuitize > 0) {
              a.annuityGrossAnnual = (toAnnuitize / pcfg.coefficient) * 12;
              lumpSecuredPot += toAnnuitize;
            }
            const gross = a.bal - toAnnuitize;
            if (gross > 0) {
              const eligible = exAge >= pcfg.exemptionFromAge;
              const capLeft = eligible ? Math.max(0, (exemptionPctAt(year) / 100) * (pcfg.ceiling * inflFactor) * 180 - lumpExemptUsed) : 0;
              const exemptPart = Math.min(gross, capLeft);
              lumpExemptUsed += exemptPart;
              if (exemptPart > 0) lumpUsedExemption = true;
              const tax = incomeTaxAnnual(gross - exemptPart, inflFactor);
              pensionLumpGrossM += gross;
              pensionLumpTaxM += tax;
              pensionLumpNetM += gross - tax;
              deposit(defaultAcc, gross - tax);
            }
            pensionConv.potAtAccess += a.bal;
            pensionConv.annuitizedPot += toAnnuitize;
            pensionConv.grossAnnual += a.annuityGrossAnnual || 0;
            pensionConv.factor = inflFactor;
            pensionConv.age = age;
            pensionConv.year = year;
            a.bal = 0; a.basis = 0; a.contrib = 0;
          }
          if (a.annuityGrossAnnual != null) pensionGrossM += a.annuityGrossAnnual / 12;
        }
      });

      // Tax the annuity on a year-to-date basis: one entitling-pension
      // exemption per calendar year, shared across pots, charged as the
      // month-on-month increment.
      let pensionTaxM = 0;
      if (pensionGrossM > 0) {
        const useEx = pcfg.mode === "annuity" ? true : !lumpUsedExemption;
        Y.pensionGrossYTD += pensionGrossM;
        const taxYTD = pensionTaxAnnual(Y.pensionGrossYTD, inflFactor, exAge, year, useEx);
        pensionTaxM = Math.max(0, taxYTD - Y.pensionTaxYTD);
        Y.pensionTaxYTD = taxYTD;
      }
      const pensionNetM = pensionGrossM - pensionTaxM;

      // Ordinary taxable income realized this month, for Section-102 stacking.
      Y.ordStack += (working ? taxableSalaryAnnual(state, payroll) / 12 * Math.pow(1 + (state.income.salaryGrowthPct || 0) / 100, k) : 0)
        + pensionTaxableAnnual(pensionGrossM * 12, inflFactor, exAge, year, pcfg.mode === "annuity" ? true : !lumpUsedExemption) / 12;

      // 6) Cash flow for the month.
      const incomeM = salaryM + extraM + pensionNetM + oldAgeM + rentM;
      let netM = incomeM - spendM - mortgageM;
      if (coasting) netM = 0; // coast: income is assumed to exactly cover outgoings
      let wdNetBefore = Y.withdrawalNet;
      buffer = 0;
      if (!coasting) {
        if (netM > 1e-6) {
          // Surplus is invested at the start of the month it arises.
          distributeSurplus(netM, Y.surplusDeposits);
        } else if (netM < -1e-6) {
          // A deficit first reverses this year's own surplus deposits (so a
          // year that is net-positive overall never sells anything), then
          // sells from the withdrawal order.
          const left = pullBackSurplus(-netM, Y.surplusDeposits);
          const unmet = left > 0 ? withdrawNet(left, exAge, Y, inflFactor) : 0;
          if (unmet > 0.5 && depletionAge == null) { depletionAge = age; depletionExactAge = exAge; }
          // An unfunded shortfall is not carried forward.
        }
      }

      // 7) Growth for the month, plus a twelfth of the annual balance fee —
      //    applied after the month's flows (start-of-month timing).
      accs.forEach((a) => {
        const ret = opts && opts.returnOverride ? Math.max(-95, opts.returnOverride(a, k)) : a.ret;
        a.bal *= 1 + monthlyRate(ret);
        if ((a.kind === "pension" || a.kind === "study_fund") && a.feeBalance) {
          a.bal *= Math.pow(1 - a.feeBalance / 100, 1 / 12);
        }
      });

      // Accumulate the calendar year's flows.
      Y.salary += salaryM; Y.extra += extraM; Y.spend += spendM;
      Y.pensionGross += pensionGrossM; Y.pensionTax += pensionTaxM; Y.pensionNet += pensionNetM;
      Y.oldAge += oldAgeM; Y.rentIncome += rentM; Y.mortgagePay += mortgageM;
      Y.pensionLumpGross += pensionLumpGrossM; Y.pensionLumpTax += pensionLumpTaxM; Y.pensionLumpNet += pensionLumpNetM;
      Y.incomeTotal += incomeM; Y.net += netM;

      if (collectMonthly) {
        monthly.push({
          mi, k, year, month, age, exactAge: exAge, working, coasting,
          salary: salaryM, extra: extraM, spend: spendM,
          incomeTotal: incomeM, net: netM,
          pensionGross: pensionGrossM, pensionTax: pensionTaxM, pensionNet: pensionNetM,
          oldAge: oldAgeM, rentIncome: rentM, mortgagePay: mortgageM,
          pensionLumpGross: pensionLumpGrossM, pensionLumpTax: pensionLumpTaxM, pensionLumpNet: pensionLumpNetM,
          withdrawalNet: Y.withdrawalNet - wdNetBefore,
          buffer,
        });
      }

      // 8) Year end: snapshot balances (after December's growth) and emit the
      //    annual row.
      if (isYearEnd) {

        const perAccount = {};
        let total = 0, liquid = 0, liquidTax = 0, drawable = 0, nonPension = 0, pension = 0, fireEligible = 0;
        let rsuDeferredTax = 0, reportStack = Y.ordStack;
        accs.forEach((a) => {
          const v = Math.max(0, a.bal);
          // Balances are reported BEFORE tax. The after-tax `liquid` figure is
          // what selling every non-pension account this year would deliver:
          // grants pay Section-102 (ordinary slice stacked on the year's other
          // income, then capital gains); other accounts pay capital gains on
          // the gain above cost basis.
          let saleTax = 0;
          if (a.kind !== "pension" && v > 0) {
            if (a.isGrant) {
              saleTax = grantSaleTax(a, v, reportStack, inflFactor);
              reportStack += a.ord;
              rsuDeferredTax += saleTax;
            } else {
              saleTax = saleTaxOf(a.kind, v, a.basis, a.cg);
            }
          }
          perAccount[a.id] = v;
          total += v;
          if (a.kind === "pension") pension += v;
          else { nonPension += v; liquid += v - saleTax; liquidTax += saleTax; }
          const canDraw = a.kind === "pension"
            ? (pcfg.mode === "lump" && exAge >= (a.accessAge || state.profile.pensionAccessAge))
            : (a.liquid && (!a.accessAge || exAge >= a.accessAge));
          if (canDraw) drawable += v;
          if (a.includeInFire) fireEligible += v;
        });

        let reValue = 0, reDebt = 0;
        props.forEach((p) => { reValue += p.val; });
        loans.forEach((L) => { reDebt += L.bal; });
        const reEquity = reValue - reDebt;
        total += reEquity; // equity counts in net worth but is never liquid

        rows.push({
          age: Y.age, k: Y.k, year: Y.year,
          working: Y.workingMonths > 0, workingMonths: Y.workingMonths, months: Y.months,
          salary: Y.salary, extra: Y.extra, spend: Y.spend, net: Y.net,
          incomeTotal: Y.incomeTotal,
          pensionGross: Y.pensionGross, pensionTax: Y.pensionTax, pensionNet: Y.pensionNet,
          oldAge: Y.oldAge,
          pensionLumpGross: Y.pensionLumpGross, pensionLumpTax: Y.pensionLumpTax, pensionLumpNet: Y.pensionLumpNet,
          reValue, reDebt, reEquity, rentIncome: Y.rentIncome, mortgagePay: Y.mortgagePay,
          withdrawalNet: Y.withdrawalNet, withdrawalGross: Y.withdrawalGross,
          withdrawalTax: Y.withdrawalTax, sources: Y.sources, rsuDeferredTax,
          perAccount, total, liquid, liquidTax, drawable, nonPension, pension, fireEligible,
          realFactor: Math.pow(1 + infl, Y.k),
        });
      }
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

    // Pension summary info (Israeli law).
    const pf = pensionConv.factor || 1;
    const accessAgeEff = pensionConv.age != null ? pensionConv.age : state.profile.pensionAccessAge;
    const accessYear = pensionConv.year != null ? pensionConv.year : asOf.getFullYear() + Math.max(0, state.profile.pensionAccessAge - A0);
    const exemptionEligibleAtAccess = accessAgeEff >= pcfg.exemptionFromAge;
    // Year (and inflation factor) at which the exemption starts applying.
    const eligYear = exemptionEligibleAtAccess ? accessYear : accessYear + (pcfg.exemptionFromAge - accessAgeEff);
    const eligFactor = Math.pow(1 + infl, eligYear - asOf.getFullYear());
    let pensionInfo;
    if (pcfg.mode === "annuity") {
      // Annuity: pot ÷ coefficient. The tax-exempt portion (exemption% of the
      // entitling ceiling, per the statutory schedule) applies only from
      // exemptionFromAge — an annuity drawn earlier is fully taxable at first.
      const grossMonthly = pensionConv.grossAnnual / 12;
      const ceilingMonthly = pcfg.ceiling * pf;
      const pctAtElig = exemptionPctAt(eligYear);
      const exemptMonthly = exemptionEligibleAtAccess
        ? Math.min(grossMonthly, (pctAtElig / 100) * ceilingMonthly) : 0;
      const taxableMonthly = Math.max(0, grossMonthly - exemptMonthly);
      const taxMonthly = pensionTaxAnnual(pensionConv.grossAnnual, pf, accessAgeEff, accessYear, true) / 12;
      // What the same annuity nets once the exemption kicks in (from age 67):
      // the annuity is CPI-grown to that year when linked.
      const growTo = pcfg.cpiLinked ? eligFactor / pf : 1;
      const grossAnnualAtElig = pensionConv.grossAnnual * growTo;
      const taxMonthlyAtElig = pensionTaxAnnual(grossAnnualAtElig, eligFactor, pcfg.exemptionFromAge, eligYear, true) / 12;
      pensionInfo = {
        mode: pcfg.mode,
        accessAge: state.profile.pensionAccessAge,
        accessYear,
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
        exemptionPct: pctAtElig,
        exemptionFromAge: pcfg.exemptionFromAge,
        exemptionEligibleAtAccess,
        exemptionStartYear: eligYear,
        netMonthlyFromEligibility: grossAnnualAtElig / 12 - taxMonthlyAtElig,
        netMonthlyFromEligibilityReal: (grossAnnualAtElig / 12 - taxMonthlyAtElig) / eligFactor,
      };
    } else {
      // Lump sum: the statutory minimum annuity is secured first; only the
      // remainder is withdrawn (exempt capital up to pct × ceiling × 180).
      const lumpRow = rows.find((r) => r.pensionLumpGross > 0);
      const minAnnuityGrossMonthly = pensionConv.grossAnnual / 12;
      pensionInfo = {
        mode: pcfg.mode,
        accessAge: state.profile.pensionAccessAge,
        accessYear,
        coefficient: pcfg.coefficient,
        potAtAccess: pensionConv.potAtAccess,
        annuitizedPot: pensionConv.annuitizedPot,
        minAnnuityMonthly: pcfg.minAnnuity * pf,
        minAnnuityGrossMonthly,
        minAnnuityGrossMonthlyReal: minAnnuityGrossMonthly / pf,
        lumpGross: lumpRow ? lumpRow.pensionLumpGross : 0,
        lumpTax: lumpRow ? lumpRow.pensionLumpTax : 0,
        lumpNet: lumpRow ? lumpRow.pensionLumpNet : 0,
        lumpGrossReal: lumpRow ? lumpRow.pensionLumpGross / pf : 0,
        lumpNetReal: lumpRow ? lumpRow.pensionLumpNet / pf : 0,
        lumpExemptCapital: (exemptionPctAt(accessYear) / 100) * (pcfg.ceiling * pf) * 180,
        lumpExemptionEligible: exemptionEligibleAtAccess,
        exemptionPct: exemptionPctAt(accessYear),
        exemptionFromAge: pcfg.exemptionFromAge,
        exemptionEligibleAtAccess,
        // Annuity-summary fields (the forced minimum annuity).
        grossMonthly: minAnnuityGrossMonthly, exemptMonthly: 0, taxableMonthly: minAnnuityGrossMonthly,
        taxMonthly: 0, netMonthly: 0, grossMonthlyReal: minAnnuityGrossMonthly / pf, netMonthlyReal: 0,
        entitlingCeilingAtAccess: pcfg.ceiling * pf,
      };
    }

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
      // Monthly series behind the annual rows. Same flow fields plus `exactAge`,
      // `month` (0-11) and the running cash `buffer`. Suppressed when
      // opts.collectMonthly === false (Monte Carlo and the age searches, which
      // only read the annual aggregates and run the projection thousands of times).
      monthly,
      monthsPerYear: 12,
      depletionAge,
      depletionExactAge,
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
      const r = FIRE.state.grantNet(g, usdIls, FIRE.state.vestedSharesOf(state, g), g.sharePrice);
      if (r.gross <= 0) return;
      out.push({ id: "grant-" + g.id, name: g.name + " (grant)", kind: "rsu", value: r.gross, net: r.net, taxNow: r.tax, basis: r.gross, cg: g.capGainsRate || 25, growth: g.expectedGrowthPct || 0, _grant: g, _shares: FIRE.state.vestedSharesOf(state, g) });
    });
    // Properties that are part of the plan can be a what-if source. Growth is
    // TOTAL return = appreciation + gross rent yield; sale is modeled tax-free
    // (single-home מס שבח exemption) and any attached mortgage is ignored here.
    if (!(state.realEstate && state.realEstate.includeInPlan === false)) {
      ((state.realEstate && state.realEstate.properties) || []).forEach((p) => {
        const value = p.value || 0;
        if (value <= 0) return;
        const rentYield = value > 0 ? ((p.rentMonthly || 0) * 12 / value) * 100 : 0;
        out.push({ id: "prop-" + p.id, name: p.name + " (property)", kind: "property", value, net: value, taxNow: 0, basis: value, cg: 0, growth: (p.growthPct || 0) + rentYield });
      });
    }
    return out;
  }

  // Build a holding from a custom (hypothetical) definition.
  function buildCustom(def, usdIls, role) {
    def = def || {};
    if (role === "target") {
      if (def.kind === "property") {
        // Buying a property: purchase costs (מס רכישה, fees) reduce the amount
        // that actually becomes property; growth = appreciation + net rent
        // yield; capGainsRate models sale tax on the gain at the horizon
        // (0 = single-home מס שבח exemption).
        return { id: "__custom__", name: def.name || "Property", kind: "property", value: 0, net: 0, taxNow: 0, basis: 0, cg: def.capGainsRate || 0, growth: (def.growth || 0) + (def.rentYieldPct || 0), _purchaseCostPct: def.purchaseCostPct || 0 };
      }
      // Only growth & cap-gains rate matter for the target you buy into.
      return { id: "__custom__", name: def.name || "Custom target", kind: def.kind || "stock", value: 0, net: 0, taxNow: 0, basis: 0, cg: def.capGainsRate || 0, growth: def.growth || 0 };
    }
    if (def.kind === "property") {
      // Selling a property you (hypothetically) own: sale tax on the gain vs
      // cost basis (0 = exempt); keep-path growth = appreciation + rent yield.
      const value = def.value || 0, basis = def.costBasis || 0;
      const taxNow = Math.max(0, value - basis) * (def.capGainsRate || 0) / 100;
      return { id: "__custom__", name: def.name || "Property", kind: "property", value, net: value - taxNow, taxNow, basis: Math.min(basis, value), cg: def.capGainsRate || 0, growth: (def.growth || 0) + (def.rentYieldPct || 0) };
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
    // Buying into a property costs purchase tax/fees up front — only the
    // remainder becomes the appreciating asset.
    const purchaseCost = netReinvest * ((tgt._purchaseCostPct || 0) / 100);
    const invested = netReinvest - purchaseCost;

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
      const sw = invested * Math.pow(1 + tgtG, t);
      const swAT = sw - (tgt.cg / 100) * Math.max(0, sw - invested);
      if (crossover == null && sw > keep) crossover = t;
      if (crossoverAT == null && swAT > keepAT) crossoverAT = t;
      rows.push({ t, keep, sw, keepAT, swAT });
    }
    return { src, tgt, srcG: srcG * 100, tgtG: tgtG * 100, sellGross, taxNow, netReinvest, purchaseCost, invested, years, rows, crossover, crossoverAT };
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
      const p = project(t, { collectMonthly: false });
      if (p.survives) return { found: true, age: fa, yearsAway: fa - start };
    }
    return { found: false, age: null, yearsAway: null };
  }

  /* ---- Monte Carlo -----------------------------------------------------------
   * Sequence-of-returns risk: run the projection many times, each year drawing
   * every account TYPE's return from a normal distribution around its expected
   * return (one shock per type per year — all taxable accounts move together,
   * which is closer to reality than independent draws). FX, inflation, salary,
   * spending, vest pricing, and property growth stay deterministic.
   *-------------------------------------------------------------------------*/
  const MC_DEFAULT_VOL = { cash: 0.5, money_market: 1, taxable: 15, study_fund: 10, pension: 8, rsu: 30, custom: 10 };
  function randn() { // Box-Muller
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  function monteCarlo(state, opts) {
    opts = opts || {};
    const mc = state.assumptions.mc || {};
    const sims = Math.max(10, opts.sims || mc.sims || 500);
    const vol = Object.assign({}, MC_DEFAULT_VOL, mc.vol || {});
    const collectBands = opts.collectBands !== false;

    let years = null, ages = null, perYear = null;
    const finals = [], depletions = [];
    let survived = 0;

    for (let s = 0; s < sims; s++) {
      const shocks = {}; // kind -> shock per projection year
      const override = (acc, k) => {
        let arr = shocks[acc.kind];
        if (!arr) arr = shocks[acc.kind] = [];
        if (arr[k] == null) arr[k] = randn() * (vol[acc.kind] != null ? vol[acc.kind] : 0);
        return (acc.ret || 0) + arr[k];
      };
      const p = project(state, { returnOverride: override, collectMonthly: false });
      if (collectBands) {
        if (!perYear) {
          years = p.rows.map((r) => r.year);
          ages = p.rows.map((r) => r.age);
          perYear = p.rows.map(() => []);
        }
        p.rows.forEach((r, i) => perYear[i].push(r.total));
      }
      finals.push(p.endNetWorth);
      if (p.survives) survived++; else depletions.push(p.depletionAge);
    }

    const pct = (arr, q) => arr[Math.max(0, Math.min(arr.length - 1, Math.floor(q * arr.length)))];
    let bands = null;
    if (collectBands) {
      perYear.forEach((a) => a.sort((x, y) => x - y));
      bands = {
        p10: perYear.map((a) => pct(a, 0.10)),
        p25: perYear.map((a) => pct(a, 0.25)),
        p50: perYear.map((a) => pct(a, 0.50)),
        p75: perYear.map((a) => pct(a, 0.75)),
        p90: perYear.map((a) => pct(a, 0.90)),
      };
    }
    finals.sort((a, b) => a - b);
    depletions.sort((a, b) => a - b);
    return {
      sims,
      successRate: (survived / sims) * 100,
      years, ages, bands,
      finals,
      finalP10: pct(finals, 0.10), finalP50: pct(finals, 0.50), finalP90: pct(finals, 0.90),
      depletions,
      medianDepletionAge: depletions.length ? pct(depletions, 0.5) : null,
    };
  }
  // Earliest retirement age whose Monte Carlo success rate meets the target
  // confidence. Success is monotonic in the retirement age — retiring later
  // always means more accumulation and less drawdown — so this bisects the age
  // range instead of scanning it, and starts from the DETERMINISTIC earliest
  // age (below that the median path already fails, so no high confidence bar
  // can be met). A coarse pass finds the boundary cheaply, then the answer is
  // confirmed at the full sim count. Without this the monthly engine would run
  // ~40 candidates x `sims` full projections and freeze the tab.
  function safeFireAge(state, confidencePct, sims) {
    const start = Math.round(state.profile.currentAge);
    const full = sims || 200;
    const coarse = Math.max(40, Math.min(full, 60));
    const det = earliestFireAge(state);
    let lo = det.found ? Math.max(start, det.age) : start;
    const hi0 = state.profile.endAge;

    const rateAt = (fa, n) => {
      const t = FIRE.state.clone(state);
      t.profile.fireAge = fa;
      return monteCarlo(t, { sims: n, collectBands: false }).successRate;
    };

    // Is the bar reachable at all?
    if (rateAt(hi0, coarse) < confidencePct) return { found: false, age: null, yearsAway: null, successRate: null };

    // Bisect for the smallest age that clears the bar.
    let hi = hi0;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (rateAt(mid, coarse) >= confidencePct) hi = mid; else lo = mid + 1;
    }

    // Confirm at the full sim count; the coarse pass can land one age early on
    // a noisy boundary, so step up until it holds (bounded by endAge).
    for (let fa = lo; fa <= hi0; fa++) {
      const r = rateAt(fa, full);
      if (r >= confidencePct) return { found: true, age: fa, yearsAway: fa - start, successRate: r };
    }
    return { found: false, age: null, yearsAway: null, successRate: null };
  }

  /* ---- Coast FIRE -----------------------------------------------------------
   * Earliest age at which you can STOP SAVING entirely (keep working just to
   * cover expenses; balances only compound) and the plan — retiring at the
   * configured retirement age — still survives to endAge.
   *-------------------------------------------------------------------------*/
  function coastFireAge(state) {
    const start = Math.round(state.profile.currentAge);
    const fa = Math.round(state.profile.fireAge);
    for (let c = start; c <= fa; c++) {
      const t = FIRE.state.clone(state);
      t._coastFrom = c;
      if (project(t, { collectMonthly: false }).survives) return { found: true, age: c, yearsAway: c - start };
    }
    return { found: false, age: null, yearsAway: null };
  }

  /* ---- Barista FIRE ----------------------------------------------------------
   * Earliest age to leave full-time work if a part-time NET income of
   * `monthly` ₪/mo continues from that age until `untilAge`.
   *-------------------------------------------------------------------------*/
  function baristaFireAge(state, monthly, untilAge) {
    const start = Math.round(state.profile.currentAge);
    for (let f = start; f <= state.profile.endAge; f++) {
      const t = FIRE.state.clone(state);
      t.profile.fireAge = f;
      t.income.extra = (t.income.extra || []).concat([{
        id: "__barista__", name: "Part-time (barista)", monthlyAmount: monthly || 0,
        startAge: f, endAge: untilAge || f, growthPct: t.assumptions.inflation || 0,
      }]);
      if (project(t, { collectMonthly: false }).survives) return { found: true, age: f, yearsAway: f - start };
    }
    return { found: false, age: null, yearsAway: null };
  }

  FIRE.engine = { project, snapshot, monthlySpend, spendSourceAt, stepAt, listIdAt, categoriesAt, spendBreakdown, grantVestAtYear, grantOrdinaryTaxFor, earliestFireAge, coastFireAge, baristaFireAge, monteCarlo, safeFireAge, MC_DEFAULT_VOL, loanSchedule, loanTrackOf, LOAN_TRACKS, computePayroll, holdings, switchScenario, WITHDRAW_PRIORITY };
})();
