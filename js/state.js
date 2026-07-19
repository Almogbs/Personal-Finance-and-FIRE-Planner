/* =============================================================================
 * state.js  —  Data model, defaults, and persistence ("the DB")
 * -----------------------------------------------------------------------------
 * Classic (non-module) script so the app runs from file:// with no server.
 * Everything hangs off the global `FIRE` namespace.
 * ===========================================================================*/
(function () {
  "use strict";
  const FIRE = (window.FIRE = window.FIRE || {});

  const SCHEMA_VERSION = 1;
  const STORAGE_KEY = "fire-planner-state-v1";

  /* ---- Helpers ------------------------------------------------------------ */
  function uid(prefix) {
    return (prefix || "id") + "-" + Math.random().toString(36).slice(2, 9);
  }
  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  /* ---- Cost basis ---------------------------------------------------------
   * A taxable holding's capital-gains tax applies to the GAIN only. Users can
   * express the gain as a percentage vs. their buying value (`gainPct`) instead
   * of typing an absolute cost basis — e.g. gainPct = 20 means the position is
   * up 20% from what they paid, so basis = balance / 1.20. A negative gainPct
   * models a position that is currently at a loss (no gain → no CG tax).
   * Returns the cost basis in the account's OWN currency.
   *-----------------------------------------------------------------------*/
  function costBasisOf(a) {
    if (a && a.gainPct != null && a.gainPct !== "" && isFinite(a.gainPct)) {
      const denom = 1 + Number(a.gainPct) / 100;
      const bal = a.balance || 0;
      return denom > 0 ? bal / denom : bal;
    }
    return a && a.costBasis != null ? a.costBasis : (a ? a.balance : 0);
  }

  /* ---------------------------------------------------------------------------
   * Account types. `kind` drives how the engine treats the account.
   *   cash          – no growth by default, fully liquid
   *   money_market  – low yield, liquid
   *   taxable       – brokerage, grows, liquid, capital-gains tax on withdrawal
   *   study_fund    – Keren Hishtalmut, liquid after seasoning
   *   pension       – locked until accessAge (default 60)
   *   rsu           – employer equity; valued from share price x FX
   *   custom        – anything else
   * currency: 'ILS' or 'USD'. USD accounts are converted with usdIls.
   *-------------------------------------------------------------------------*/
  function defaultState() {
    // Generic, anonymous demo plan (no personal data). Load your own JSON via
    // Save/Load → "Load from file" to use your real numbers.
    const accounts = [
      { id: uid("acc"), name: "Checking", group: "Bank", kind: "cash", currency: "ILS", balance: 20000, expectedReturn: 0, monthlyContribution: 0, contributionGrowthPct: 0, liquid: true, includeInFire: true, costBasis: 20000, capGainsRate: 0, accessAge: 0, feeDeposit: 0, feeBalance: 0, notes: "" },
      { id: uid("acc"), name: "Savings / money market", group: "Bank", kind: "money_market", currency: "ILS", balance: 80000, expectedReturn: 3.5, monthlyContribution: 0, contributionGrowthPct: 0, liquid: true, includeInFire: true, costBasis: 80000, capGainsRate: 25, accessAge: 0, feeDeposit: 0, feeBalance: 0, notes: "" },
      { id: uid("acc"), name: "Keren Hishtalmut", group: "Study fund", kind: "study_fund", currency: "ILS", balance: 40000, expectedReturn: 6, monthlyContribution: 0, contributionGrowthPct: 1, liquid: true, includeInFire: true, costBasis: 40000, capGainsRate: 0, accessAge: 0, feeDeposit: 0, feeBalance: 0.5, notes: "" },
      { id: uid("acc"), name: "Brokerage (S&P 500 ETF)", group: "Brokerage", kind: "taxable", currency: "ILS", balance: 120000, expectedReturn: 7, monthlyContribution: 0, contributionGrowthPct: 0, liquid: true, includeInFire: true, costBasis: 100000, capGainsRate: 25, accessAge: 0, feeDeposit: 0, feeBalance: 0, notes: "" },
      { id: uid("acc"), name: "Pension", group: "Pension", kind: "pension", currency: "ILS", balance: 150000, expectedReturn: 6, monthlyContribution: 0, contributionGrowthPct: 1, liquid: false, includeInFire: true, costBasis: 150000, capGainsRate: 0, accessAge: 60, feeDeposit: 1, feeBalance: 0.15, notes: "" },
    ];
    const investDefault = (accounts.find((a) => a.kind === "taxable") || accounts[0]).id;

    return {
      meta: {
        schema: SCHEMA_VERSION,
        name: "My FIRE Plan",
        savedAt: new Date().toISOString(),
        note: "Educational model only — not financial advice.",
        theme: "light",
      },

      live: {
        corsProxy: "https://api.allorigins.win/raw?url=",
      },

      // "What-if" holding-switch analyzer parameters.
      whatif: {
        sourceId: "", sellPct: 100, sourceGrowth: null,
        targetId: "", targetGrowth: null, years: 20, afterTax: true,
        customSource: { kind: "stock", name: "Custom source", value: 200000, costBasis: 100000, capGainsRate: 25, growth: 7, currency: "USD", sharePrice: 100, vestedShares: 500, grantBasisUsd: 40, ordinaryTaxRate: 47 },
        customTarget: { kind: "stock", name: "Custom target", growth: 8, capGainsRate: 25 },
      },

      tracker: { months: [], years: [] },
      predictions: { baselineSavedAt: null, accounts: [], years: [], actuals: {} },

      profile: {
        birthDate: "",     // set your date of birth to derive age
        dateOverride: "",  // "" = use today's date
        currentAge: 30,
        fireAge: 45,
        endAge: 80,
        pensionAccessAge: 60,
      },

      market: {
        usdIls: 3.5,
      },

      assumptions: {
        inflation: 2.5,
        realMode: false,
        showMinFireAge: false,
        defaultReturns: {
          cash: 0,
          money_market: 3.5,
          taxable: 7,
          study_fund: 6,
          pension: 6,
          rsu: 8,
          custom: 5,
        },
        pensionAnnuityCoefficient: 220,
        swr: 4,
        // Order in which account types are drained to cover a retirement
        // shortfall (first = spent first). Pension is only ever drawn after its
        // access age / when not annuitized, regardless of position.
        withdrawalOrder: ["cash", "money_market", "taxable", "rsu", "study_fund", "custom", "pension"],
        pensionMode: "annuity",
        pensionEntitlingCeiling: 9430,
        pensionExemptionPct: 52,
        pensionCpiLinked: true,
        pensionFeeDeposit: 1,
        pensionFeeBalance: 0.15,
        studyFundFeeBalance: 0.5,
        // Israeli payroll rates for computing net salary & deposits from gross.
        payroll: {
          creditPointValue: 242,
          niReducedRate: 3.5,
          niFullRate: 12,
          niThresholdMonthly: 7522,
          niCeilingMonthly: 49030,
          pensionEmployeePct: 6,
          pensionEmployerPct: 6.5,
          severancePct: 8.33,
          pensionCeilingMonthly: 0,
          khEmployeePct: 2.5,
          khEmployerPct: 7.5,
          khCeilingMonthly: 0,
        },
      },

      income: {
        salaryMode: "gross",
        grossMonthly: 30000,
        taxableExtrasMonthly: 0,
        taxableImputationsMonthly: 0,
        creditPoints: 2.25,
        monthlyNetSalary: 18000,
        salaryGrowthPct: 2,
        stopSalaryAtFire: true,
        allocations: [],
        defaultAccountId: investDefault,
        grants: [
          { id: uid("grant"), name: "Company RSU", symbol: "", currency: "USD", sharePrice: 150, expectedGrowthPct: 8, vestedShares: 100, sharesPerYear: 100, grantBasisUsd: 80, ordinaryTaxRate: 47, capGainsRate: 25, startAge: 30, stopAge: 45, vestUntilRetire: false },
        ],
        extra: [],
      },

      spending: {
        growthPct: 2,
        fireMonthly: 12000,
        useCategoriesInRetirement: true,
        // When true, retirement projections use the fixed FIRE monthly spend
        // above instead of your real categories/steps. Default false = use real.
        useHeadlineSpending: false,
        categories: [
          { id: uid("cat"), name: "Housing", freq: "monthly", monthly: 4000, startAge: 0, endAge: 80, growthPct: 2, inflate: true },
          { id: uid("cat"), name: "Food & groceries", freq: "monthly", monthly: 2000, startAge: 0, endAge: 80, growthPct: 2, inflate: true },
          { id: uid("cat"), name: "Transport", freq: "monthly", monthly: 1000, startAge: 0, endAge: 80, growthPct: 2, inflate: true },
          { id: uid("cat"), name: "Utilities & bills", freq: "monthly", monthly: 700, startAge: 0, endAge: 80, growthPct: 2, inflate: true },
          { id: uid("cat"), name: "Insurance & health", freq: "monthly", monthly: 600, startAge: 0, endAge: 80, growthPct: 2, inflate: true },
          { id: uid("cat"), name: "Leisure & misc", freq: "monthly", monthly: 1500, startAge: 0, endAge: 80, growthPct: 2, inflate: true },
          { id: uid("cat"), name: "Annual (vacations, etc.)", freq: "yearly", monthly: 20000, startAge: 0, endAge: 80, growthPct: 2, inflate: true },
        ],
        steps: [],
      },

      accounts: accounts,
    };
  }

  /* ---- Equity grants as virtual accounts ---------------------------------
   * A grant's value depends on live share price and FX, so we compute it
   * rather than storing a static balance. Section-102 capital-gains model:
   * the grant-basis value is taxed at the ordinary rate and the appreciation
   * above basis at the capital-gains rate.
   *-----------------------------------------------------------------------*/
  function grantNet(grant, usdIls, shares, price) {
    const fx = grant.currency === "ILS" ? 1 : usdIls;
    const p = price != null ? price : grant.sharePrice;
    const gross = (shares || 0) * p * fx;
    const ordinary = (shares || 0) * (grant.grantBasisUsd || 0) * fx;
    const apprec = Math.max(0, gross - ordinary);
    const tax = ordinary * ((grant.ordinaryTaxRate || 0) / 100) + apprec * ((grant.capGainsRate || 0) / 100);
    return { gross, tax, net: gross - tax, effectiveRate: gross > 0 ? tax / gross : 0 };
  }
  // Aggregate after-tax value of all currently-vested grant shares.
  function grantsVested(state) {
    const usdIls = state.market.usdIls;
    let gross = 0, tax = 0, net = 0;
    const per = [];
    (state.income.grants || []).forEach((g) => {
      const r = grantNet(g, usdIls, g.vestedShares || 0, g.sharePrice);
      gross += r.gross; tax += r.tax; net += r.net;
      per.push({ grant: g, gross: r.gross, tax: r.tax, net: r.net });
    });
    return { gross, tax, net, effectiveRate: gross > 0 ? tax / gross : 0, per };
  }
  function newGrant(state) {
    const st = state || get();
    return {
      id: uid("grant"), name: "New grant", symbol: "", currency: "USD",
      sharePrice: 100, expectedGrowthPct: (st.assumptions.defaultReturns.rsu || 8),
      vestedShares: 0, sharesPerYear: 0, grantBasisUsd: 0,
      ordinaryTaxRate: 47, capGainsRate: 25,
      startAge: Math.round(st.profile.currentAge), stopAge: st.profile.fireAge, vestUntilRetire: false,
    };
  }

  /* ---- Persistence -------------------------------------------------------- */
  let _state = null;
  const _listeners = [];

  function get() {
    if (!_state) load();
    return _state;
  }
  function set(next) {
    _state = next;
    normalizeAge(_state);
    autosave();
    emit();
  }
  function update(mutator) {
    mutator(get());
    normalizeAge(_state);
    autosave();
    emit();
  }
  function subscribe(fn) {
    _listeners.push(fn);
    return () => {
      const i = _listeners.indexOf(fn);
      if (i >= 0) _listeners.splice(i, 1);
    };
  }
  function emit() {
    _listeners.forEach((fn) => {
      try { fn(_state); } catch (e) { console.error(e); }
    });
  }

  function autosave() {
    try {
      _state.meta.savedAt = new Date().toISOString();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(_state));
    } catch (e) {
      /* localStorage may be unavailable on file:// in some browsers */
    }
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        _state = migrate(JSON.parse(raw));
        normalizeAge(_state);
        return _state;
      }
    } catch (e) {
      console.warn("Could not load saved state, using defaults.", e);
    }
    _state = defaultState();
    normalizeAge(_state);
    return _state;
  }

  function reset() {
    _state = defaultState();
    autosave();
    emit();
  }

  function migrate(s) {
    // Basic forward-compatible migration hook.
    if (!s.meta) s.meta = { schema: SCHEMA_VERSION };
    if (s.meta.schema == null) s.meta.schema = SCHEMA_VERSION;
    if (!s.meta.theme) s.meta.theme = "light";
    if (!s.live) s.live = { corsProxy: "" };
    if (!s.whatif) s.whatif = { sourceId: "", sellPct: 100, sourceGrowth: null, targetId: "", targetGrowth: null, years: 20, afterTax: true };
    if (!s.whatif.customSource) s.whatif.customSource = { kind: "stock", name: "Custom source", value: 200000, costBasis: 100000, capGainsRate: 25, growth: 7, currency: "USD", sharePrice: 100, vestedShares: 500, grantBasisUsd: 40, ordinaryTaxRate: 47 };
    if (!s.whatif.customTarget) s.whatif.customTarget = { kind: "stock", name: "Custom target", growth: 8, capGainsRate: 25 };
    if (!s.tracker) s.tracker = { months: [], years: [] };
    if (!Array.isArray(s.tracker.months)) s.tracker.months = [];
    if (!Array.isArray(s.tracker.years)) s.tracker.years = [];
    if (!s.predictions) s.predictions = { baselineSavedAt: null, accounts: [], years: [], actuals: {} };
    if (s.profile) {
      if (s.profile.birthDate == null) s.profile.birthDate = "";
      if (s.profile.dateOverride == null) s.profile.dateOverride = "";
    }
    if (s.live.corsProxy == null) s.live.corsProxy = "";
    // Ensure new fields exist if loading an older export.
    const d = defaultState();
    s.assumptions = Object.assign({}, d.assumptions, s.assumptions || {});
    s.assumptions.defaultReturns = Object.assign({}, d.assumptions.defaultReturns, (s.assumptions || {}).defaultReturns || {});
    s.assumptions.payroll = Object.assign({}, d.assumptions.payroll, (s.assumptions || {}).payroll || {});
    // Ensure the withdrawal order exists and lists every known account kind
    // exactly once (append any missing kinds so nothing becomes undrawable).
    const ALL_KINDS = ["cash", "money_market", "taxable", "rsu", "study_fund", "custom", "pension"];
    if (!Array.isArray(s.assumptions.withdrawalOrder)) s.assumptions.withdrawalOrder = d.assumptions.withdrawalOrder.slice();
    s.assumptions.withdrawalOrder = s.assumptions.withdrawalOrder.filter((k) => ALL_KINDS.indexOf(k) >= 0);
    ALL_KINDS.forEach((k) => { if (s.assumptions.withdrawalOrder.indexOf(k) < 0) s.assumptions.withdrawalOrder.push(k); });
    const priorSp = s.spending || {};
    s.spending = Object.assign({}, d.spending, priorSp);
    // Derive the new "use fixed FIRE spending" flag from the old retirement
    // toggle for plans saved before this field existed.
    if (priorSp.useHeadlineSpending == null) s.spending.useHeadlineSpending = priorSp.useCategoriesInRetirement === false;
    const priorIncome = s.income || {};
    const hadGrants = Array.isArray(priorIncome.grants);
    const legacy = priorIncome.rsu;
    s.income = Object.assign({}, d.income, priorIncome);
    // Convert a legacy single RSU block into the grants list (only when the
    // loaded plan didn't already carry a grants array).
    if (!hadGrants) {
      if (legacy && (legacy.vestedShares || legacy.currentVestedShares || legacy.sharesPerYear)) {
        s.income.grants = [{
          id: uid("grant"), name: "RSU", currency: "USD",
          sharePrice: (s.market && s.market.amznPrice) || 100,
          expectedGrowthPct: (s.assumptions.defaultReturns && s.assumptions.defaultReturns.rsu) || 8,
          vestedShares: legacy.currentVestedShares || legacy.vestedShares || 0,
          sharesPerYear: legacy.sharesPerYear || 0,
          grantBasisUsd: legacy.grantBasisUsd || 0,
          ordinaryTaxRate: legacy.ordinaryTaxRate != null ? legacy.ordinaryTaxRate : 47,
          capGainsRate: legacy.capGainsRate != null ? legacy.capGainsRate : 25,
          startAge: Math.round(s.profile.currentAge), stopAge: s.profile.fireAge,
        }];
      } else {
        s.income.grants = []; // old plan with no RSU → no grants
      }
    }
    delete s.income.rsu;
    if (s.market) delete s.market.amznPrice;
    (s.income.grants || []).forEach((g) => { if (g.symbol == null) g.symbol = ""; if (g.vestUntilRetire == null) g.vestUntilRetire = false; });
    // Salary mode: older plans only had a net figure — keep them on 'net'.
    if (!s.income.salaryMode) s.income.salaryMode = "net";
    if (s.income.grossMonthly == null) s.income.grossMonthly = s.income.monthlyNetSalary || 0;
    if (s.income.taxableExtrasMonthly == null) s.income.taxableExtrasMonthly = 0;
    if (s.income.taxableImputationsMonthly == null) s.income.taxableImputationsMonthly = 0;
    if (s.income.creditPoints == null) s.income.creditPoints = 2.25;
    if (!Array.isArray(s.income.allocations)) s.income.allocations = [];
    // Backfill spending frequency (monthly by default) on older exports.
    (s.spending.categories || []).forEach((c) => { if (!c.freq) c.freq = "monthly"; });
    (s.spending.steps || []).forEach((st2) => { if (!st2.freq) st2.freq = "monthly"; });
    // Backfill per-account fields on older exports.
    (s.accounts || []).forEach((a) => {
      if (a.group == null) a.group = kindGroup(a.kind);
      if (a.notes == null) a.notes = "";
      if (a.feeDeposit == null) a.feeDeposit = a.kind === "pension" ? (s.assumptions.pensionFeeDeposit || 0) : 0;
      if (a.feeBalance == null) a.feeBalance = a.kind === "pension" ? (s.assumptions.pensionFeeBalance || 0) : (a.kind === "study_fund" ? (s.assumptions.studyFundFeeBalance || 0.5) : 0);
      // Derive gain% vs buying value for taxable holdings from any stored cost
      // basis, so the new percentage input starts from the existing plan.
      if (a.gainPct == null) {
        if (a.kind === "taxable" && a.costBasis != null && a.costBasis > 0 && a.balance != null) {
          a.gainPct = Math.round(((a.balance / a.costBasis) - 1) * 10000) / 100;
        } else {
          a.gainPct = a.kind === "taxable" ? 0 : null;
        }
      }
    });
    // Default allocation bucket must point at a real account.
    if (!s.income.defaultAccountId || !(s.accounts || []).some((a) => a.id === s.income.defaultAccountId)) {
      const bank = (s.accounts || []).find((a) => a.kind === "cash") || (s.accounts || [])[0];
      s.income.defaultAccountId = bank ? bank.id : null;
    }
    return s;
  }

  /* ---- Import / Export (save file like a DB) ------------------------------ */
  function exportJSON() {
    return JSON.stringify(get(), null, 2);
  }
  function download(filename) {
    const blob = new Blob([exportJSON()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename || ("fire-plan-" + new Date().toISOString().slice(0, 10) + ".json");
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
  function importJSON(text) {
    const parsed = JSON.parse(text);
    set(migrate(parsed));
  }

  /* ---- Account factory ---------------------------------------------------- */
  function newAccount(kind) {
    kind = kind || "custom";
    const a = get().assumptions;
    const ret = (a.defaultReturns[kind]) || 5;
    return {
      id: uid("acc"),
      name: "New " + kind.replace("_", " ") + " account",
      group: kindGroup(kind),
      kind: kind,
      currency: "ILS",
      balance: 0,
      expectedReturn: ret,
      monthlyContribution: 0,
      contributionGrowthPct: 0,
      liquid: kind !== "pension",
      includeInFire: true,
      costBasis: 0,
      capGainsRate: kind === "taxable" ? 25 : 0,
      // Gain/loss vs buying value (%). Drives cost basis for CG tax on taxable
      // holdings; null for non-taxable accounts (no capital-gains modeling).
      gainPct: kind === "taxable" ? 0 : null,
      accessAge: kind === "pension" ? 60 : 0,
      // Management fees (%): deposit fee only for pension; balance fee for both.
      feeDeposit: kind === "pension" ? (a.pensionFeeDeposit || 0) : 0,
      feeBalance: kind === "pension" ? (a.pensionFeeBalance || 0) : (kind === "study_fund" ? (a.studyFundFeeBalance || 0) : 0),
      notes: "",
    };
  }
  function kindGroup(kind) {
    return ({ cash: "Bank", money_market: "Bank", taxable: "Brokerage", study_fund: "Study fund", pension: "Pension", rsu: "Equity" }[kind]) || "Other";
  }

  /* ---- Age from birth date -----------------------------------------------
   * The reference ("as-of") date is a manual override if set, else today.
   * profile.currentAge is kept in sync so the engine can keep using it.
   *-----------------------------------------------------------------------*/
  function refDate(state) {
    const o = state.profile && state.profile.dateOverride;
    const d = o ? new Date(o) : new Date();
    return isNaN(d.getTime()) ? new Date() : d;
  }
  function ageFromDob(state) {
    const bs = state.profile && state.profile.birthDate;
    if (!bs) return state.profile.currentAge;
    const b = new Date(bs);
    if (isNaN(b.getTime())) return state.profile.currentAge;
    const years = (refDate(state) - b) / (365.25 * 24 * 3600 * 1000);
    return years > 0 ? years : state.profile.currentAge;
  }
  function normalizeAge(state) {
    if (state && state.profile && state.profile.birthDate) {
      const a = ageFromDob(state);
      if (isFinite(a) && a > 0) state.profile.currentAge = Math.round(a * 100) / 100;
    }
  }

  /* ---- Public API --------------------------------------------------------- */
  FIRE.state = {
    SCHEMA_VERSION,
    STORAGE_KEY,
    uid,
    clone,
    costBasisOf,
    defaultState,
    get,
    set,
    update,
    subscribe,
    load,
    reset,
    exportJSON,
    importJSON,
    download,
    newAccount,
    grantNet,
    grantsVested,
    newGrant,
    ageFromDob,
    refDate,
  };
})();
