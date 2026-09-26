// Engine tests. Run with:  node --test tests/
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { load, stateFrom, sampleState } = require("./load.js");

const FIRE = load();
const E = FIRE.engine;
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= (tol == null ? 1 : tol), (msg || "") + ` expected ${b}, got ${a}`);

// A minimal plan: one cash account, no salary, no spending, no grants, no RE.
function bareState(mutate) {
  const st = stateFrom(FIRE);
  st.accounts = [];
  st.income.grants = [];
  st.income.extra = [];
  st.income.allocations = [];
  st.income.salaryMode = "net";
  st.income.monthlyNetSalary = 0;
  st.realEstate = { includeInPlan: false, properties: [], loans: [] };
  st.assumptions.oldAge = { enabled: false };
  st.spending.steps = [];
  (st.spending.lists || []).forEach((l) => (l.categories = []));
  st.spending.categories = [];
  if (mutate) mutate(st);
  return stateFrom(FIRE, st);
}
function acct(kind, balance, extra) {
  return Object.assign({
    id: "a-" + kind + "-" + Math.round(balance), name: kind, group: kind, kind, currency: "ILS", balance,
    expectedReturn: 0, monthlyContribution: 0, contributionGrowthPct: 0, liquid: kind !== "pension",
    includeInFire: true, costBasis: balance, capGainsRate: 0, accessAge: kind === "pension" ? 60 : 0,
    feeDeposit: 0, feeBalance: 0, notes: "",
  }, extra || {});
}

test("projection runs and the default/sample plans survive", () => {
  for (const st of [stateFrom(FIRE), sampleState(FIRE)]) {
    const p = E.project(st);
    assert.ok(p.rows.length > 10);
    assert.equal(p.survives, true);
  }
});

test("monthly series sums to the annual rows", () => {
  const p = E.project(stateFrom(FIRE));
  for (const r of p.rows) {
    const ms = p.monthly.filter((m) => m.year === r.year);
    const sum = (f) => ms.reduce((s, m) => s + m[f], 0);
    near(sum("salary"), r.salary, 1e-6);
    near(sum("spend"), r.spend, 1e-6);
    near(sum("withdrawalNet"), r.withdrawalNet, 1e-6);
  }
});

test("snapshot: grants are shown before tax; total = all gross accounts + RE equity", () => {
  const st = stateFrom(FIRE);
  const snap = E.snapshot(st);
  const g = snap.accounts.find((a) => a.id.startsWith("grant-"));
  assert.ok(g, "default plan has a vested grant");
  const pg = snap.grants.per[0];
  near(g.valueILS, pg.gross, 1e-6);
  const sumAcc = snap.accounts.reduce((s, a) => s + a.valueILS, 0);
  near(snap.total, sumAcc + snap.reEquity, 1e-6);
});

test("snapshot: liquid is after-tax and excludes pension and real estate", () => {
  const st = bareState((s) => {
    s.accounts = [
      acct("cash", 10000),
      acct("taxable", 120000, { costBasis: 100000, capGainsRate: 25 }),
      acct("pension", 500000),
    ];
    s.realEstate = { includeInPlan: true, properties: [{ id: "p1", value: 1000000 }], loans: [] };
  });
  const snap = E.snapshot(st);
  near(snap.total, 10000 + 120000 + 500000 + 1000000);
  near(snap.liquidTax, 20000 * 0.25);
  near(snap.liquid, 10000 + 120000 - 5000);
  near(snap.pension, 500000);
});

test("snapshot: grant sale tax reduces liquid by exactly the Section-102 tax", () => {
  const st = stateFrom(FIRE);
  const snap = E.snapshot(st);
  const gv = snap.grants;
  const nonGrant = snap.accounts.filter((a) => a.kind !== "pension" && !a.id.startsWith("grant-"));
  const nonGrantNet = nonGrant.reduce((s, a) => s + a.valueILS - a.saleTax, 0);
  near(snap.liquid, nonGrantNet + gv.net);
  assert.ok(gv.tax > 0);
});

test("rows: perAccount grant balance is gross; liquid = nonPension − liquidTax", () => {
  const p = E.project(stateFrom(FIRE));
  const r = p.rows[3];
  const gid = Object.keys(r.perAccount).find((id) => id.startsWith("grant-"));
  assert.ok(r.perAccount[gid] > 0);
  const sumAcc = Object.values(r.perAccount).reduce((s, v) => s + v, 0);
  near(r.total, sumAcc + r.reEquity, 1e-3);
  near(r.liquid, r.nonPension - r.liquidTax, 1e-3);
  assert.ok(r.liquidTax >= r.rsuDeferredTax);
});

test("rows: a fresh deposit at cost adds exactly its amount to liquid", () => {
  const base = bareState((s) => { s.accounts = [acct("taxable", 100000, { capGainsRate: 25 })]; });
  const r0 = E.project(base).rows[0];
  near(r0.liquid, 100000, 1e-6);
  near(r0.liquidTax, 0, 1e-6);
});

test("start-of-month timing: a deposit earns the month's return in the same month", () => {
  const st = bareState((s) => {
    s.accounts = [acct("taxable", 0, { expectedReturn: 12, monthlyContribution: 1000 })];
  });
  const p = E.project(st);
  const m = Math.pow(1.12, 1 / 12) - 1;
  const firstRow = p.rows[0];
  const months = p.monthly.filter((x) => x.year === firstRow.year).length;
  // Annuity-due: each deposit compounds from its own month, inclusive.
  let expected = 0;
  for (let i = 0; i < months; i++) expected = (expected + 1000) * (1 + m);
  near(firstRow.perAccount[st.accounts[0].id], expected, 1e-6);
});

test("start-of-month timing: surplus is invested in the month it arises", () => {
  const st = bareState((s) => {
    s.accounts = [acct("money_market", 0, { expectedReturn: 12 })];
    s.income.defaultAccountId = s.accounts[0].id;
    s.income.monthlyNetSalary = 1000;
    s.income.salaryGrowthPct = 0;
  });
  const p = E.project(st);
  const m = Math.pow(1.12, 1 / 12) - 1;
  const r = p.rows[0];
  const months = p.monthly.filter((x) => x.year === r.year).length;
  let expected = 0;
  for (let i = 0; i < months; i++) expected = (expected + 1000) * (1 + m);
  near(r.perAccount[st.accounts[0].id], expected, 1e-6);
});

test("no net-positive year sells anything, across plan shapes", () => {
  const shapes = [];
  for (const fireAge of [40, 45, 55]) {
    for (const salary of [15000, 30000, 60000]) {
      for (const mode of ["annuity", "lump"]) {
        shapes.push((s) => {
          s.profile.fireAge = fireAge;
          s.income.salaryMode = "net";
          s.income.monthlyNetSalary = salary;
          s.assumptions.pensionMode = mode;
        });
      }
    }
  }
  for (const mut of shapes) {
    const st = stateFrom(FIRE);
    mut(st);
    const p = E.project(stateFrom(FIRE, st));
    for (const r of p.rows) {
      if (r.net > 1) assert.equal(Math.round(r.withdrawalGross), 0, `year ${r.year} net ${Math.round(r.net)} sold ${Math.round(r.withdrawalGross)}`);
    }
  }
});

test("a same-year deficit pulls back that year's surplus before selling", () => {
  const st = bareState((s) => {
    s.profile.birthDate = "";
    s.accounts = [
      acct("taxable", 100000, { costBasis: 50000, capGainsRate: 25 }),
      acct("money_market", 0),
    ];
    s.assumptions.withdrawalOrder = ["taxable", "money_market", "cash", "rsu", "study_fund", "custom", "pension"];
    s.income.defaultAccountId = s.accounts[1].id;
    s.income.monthlyNetSalary = 2000;
    s.income.salaryGrowthPct = 0;
    s.spending.growthPct = 0;
    const A = s.profile.currentAge;
    // Spending jumps from 0 to 3000/mo partway through a year: +2000/mo
    // surplus first, then −1000/mo deficits.
    s.spending.steps = [
      { id: "s0", fromAge: A, mode: "amount", monthly: 0 },
      { id: "s1", fromAge: A + 1.5, mode: "amount", monthly: 3000 },
    ];
  });
  const p = E.project(st);
  const row = p.rows.find((r) => {
    const ms = p.monthly.filter((m) => m.year === r.year);
    return ms.some((m) => m.net > 0) && ms.some((m) => m.net < 0);
  });
  assert.ok(row, "a year with both surplus and deficit months exists");
  const ms = p.monthly.filter((m) => m.year === row.year);
  const surplus = ms.filter((m) => m.net > 0).reduce((t, m) => t + m.net, 0);
  const deficit = -ms.filter((m) => m.net < 0).reduce((t, m) => t + m.net, 0);
  // Only the part of the deficit NOT covered by this year's surplus is sold.
  assert.ok(surplus > 0 && deficit > 0);
  near(row.withdrawalNet, Math.max(0, deficit - surplus), 1e-3);
  assert.ok(row.withdrawalNet < deficit);
});

/* ---- Tax-rule tests ---------------------------------------------------- */

// Gross-mode payslip with every deduction but income tax switched off.
function payStateFor(gross, mutate) {
  return bareState((s) => {
    s.income.salaryMode = "gross";
    s.income.grossMonthly = gross;
    s.income.taxableExtrasMonthly = 0;
    s.income.taxableImputationsMonthly = 0;
    s.income.creditPoints = 0;
    Object.assign(s.assumptions.payroll, {
      niReducedRate: 0, niFullRate: 0, pensionEmployeePct: 0, pensionEmployerPct: 0,
      severancePct: 0, khEmployeePct: 0, khEmployerPct: 0, pensionCeilingMonthly: 0, khCeilingMonthly: 0,
    });
    if (mutate) mutate(s);
  });
}

test("2026 income-tax brackets (20% to ₪228,000, 31% to ₪301,200, 35% to ₪560,280)", () => {
  // Annual tax at the top of each band, from the 2026 thresholds.
  const cases = [
    [228000 / 12, 8412 + 36600 * 0.14 + 107280 * 0.20],
    [301200 / 12, 8412 + 36600 * 0.14 + 107280 * 0.20 + 73200 * 0.31],
    [560280 / 12, 8412 + 36600 * 0.14 + 107280 * 0.20 + 73200 * 0.31 + 259080 * 0.35],
  ];
  for (const [gross, annual] of cases) {
    const pay = E.computePayroll(payStateFor(gross));
    near(pay.incomeTax, annual / 12, 0.01, "gross " + gross);
  }
  // Published effect of the 2026 widening: ≈ ₪420/mo saved above ₪25,100.
  const oldTax = (x) => { let t = 0, p = 0; for (const [th, r] of [[84120, .1], [120720, .14], [193800, .2], [269280, .31], [558960, .35], [721560, .47], [Infinity, .5]]) { const sp = Math.min(x, th) - p; if (sp > 0) t += sp * r; if (x <= th) break; p = th; } return t; };
  near(oldTax(30000 * 12) / 12 - E.computePayroll(payStateFor(30000)).incomeTax, 420, 1);
});

test("35% credit on the employee pension deposit (up to 7% of salary, capped)", () => {
  const s1 = payStateFor(10000, (s) => { s.assumptions.payroll.pensionEmployeePct = 6; });
  near(E.computePayroll(s1).pensionCredit, 0.35 * 600, 1e-6);            // 6% < 7% of 9,700
  const s2 = payStateFor(40000, (s) => { s.assumptions.payroll.pensionEmployeePct = 7; });
  near(E.computePayroll(s2).pensionCredit, 0.35 * 0.07 * 9700, 1e-6);     // capped at the ceiling
  const base = E.computePayroll(payStateFor(40000));
  const withCredit = E.computePayroll(s2);
  near(withCredit.incomeTax, base.incomeTax - withCredit.pensionCredit, 1e-6);
});

test("salary growth is taxed progressively in gross mode", () => {
  const st = payStateFor(30000, (s) => { s.assumptions.inflation = 0; s.income.salaryGrowthPct = 5; });
  const p0 = E.computePayroll(st), p10 = E.computePayroll(st, { growth: Math.pow(1.05, 10), factor: 1 });
  assert.ok(p10.net / p0.net < Math.pow(1.05, 10) - 1e-6, "take-home grows slower than gross");
  // Pure inflation does not raise the real tax rate.
  const pInf = E.computePayroll(st, { growth: 1.3, factor: 1.3 });
  near(pInf.incomeTax / 1.3, p0.incomeTax, 1e-6);
  // The projection uses the grown payslip.
  const p = E.project(st);
  const r = p.rows[5];
  const m = p.monthly.find((x) => x.year === r.year);
  near(m.salary, E.computePayroll(st, { growth: Math.pow(1.05, r.k), factor: 1 }).net, 1e-6);
});

// A retiree drawing a 20,000/mo annuity (pot = 220 × 20,000), no inflation.
function pensionState(age, mutate) {
  return bareState((s) => {
    s.profile.birthDate = "";
    s.profile.currentAge = age;
    s.profile.fireAge = 40;
    s.profile.pensionAccessAge = 60;
    s.assumptions.inflation = 0;
    s.assumptions.pensionMode = "annuity";
    s.assumptions.pensionAnnuityCoefficient = 220;
    s.assumptions.pensionExemptionAuto = false;
    s.assumptions.pensionExemptionPct = 57.5;
    s.assumptions.pensionEntitlingCeiling = 9430;
    s.assumptions.pensionExemptionFromAge = 67;
    s.assumptions.pensionCpiLinked = false;
    s.income.creditPoints = 2.25;
    s.assumptions.payroll.creditPointValue = 242;
    s.accounts = [acct("pension", 220 * 20000), acct("cash", 0)];
    s.income.defaultAccountId = s.accounts[1].id;
    if (mutate) mutate(s);
  });
}
const tax26 = (x) => { let t = 0, p = 0; for (const [th, r] of [[84120, .1], [120720, .14], [228000, .2], [301200, .31], [560280, .35], [721560, .47], [Infinity, .5]]) { const sp = Math.min(x, th) - p; if (sp > 0) t += sp * r; if (x <= th) break; p = th; } return t; };

test("pension tax applies credit points in retirement", () => {
  const p = E.project(pensionState(70));
  const r = p.rows[1]; // a full calendar year
  const taxable = (20000 - 0.575 * 9430) * 12;
  near(r.pensionTax, tax26(taxable) - 2.25 * 242 * 12, 0.5);
  near(p.pension.taxMonthly, (tax26(taxable) - 2.25 * 242 * 12) / 12, 0.05);
});

test("pension exemption is monthly: only months past the exemption age get it", () => {
  const p = E.project(pensionState(66.5));
  const row = p.rows.find((r) => {
    const ms = p.monthly.filter((m) => m.year === r.year);
    return ms.length === 12 && ms.some((m) => m.exactAge < 67) && ms.some((m) => m.exactAge >= 67);
  });
  assert.ok(row, "a full year that crosses age 67");
  const ms = p.monthly.filter((m) => m.year === row.year);
  const taxable = ms.reduce((t, m) => t + 20000 - (m.exactAge >= 67 ? 0.575 * 9430 : 0), 0);
  near(row.pensionTax, Math.max(0, tax26(taxable) - 2.25 * 242 * 12), 0.5);
});

test("capital gains: shekel assets are taxed on the real gain, USD on the nominal", () => {
  const mk = (currency) => bareState((s) => {
    s.assumptions.inflation = 3;
    s.accounts = [acct("taxable", 100000, { currency, expectedReturn: 3, capGainsRate: 25 })];
  });
  const rIls = E.project(mk("ILS")).rows[8];
  const rUsd = E.project(mk("USD")).rows[8];
  near(rIls.liquidTax, 0, 1);                           // growth = inflation → no real gain
  assert.ok(rUsd.liquidTax > 1000, "USD basis stays nominal (constant FX)");
  // With 7% growth vs 3% inflation, tax is on the gain above the indexed basis.
  const st = bareState((s) => {
    s.assumptions.inflation = 3;
    s.accounts = [acct("taxable", 100000, { expectedReturn: 7, capGainsRate: 25 })];
  });
  const p = E.project(st);
  const r = p.rows[p.rows.length - 1];
  const months = p.monthly.length;
  const bal = r.perAccount[st.accounts[0].id];
  const indexedBasis = 100000 * Math.pow(1.03, months / 12);
  near(r.liquidTax, (bal - indexedBasis) * 0.25, 1);
});
