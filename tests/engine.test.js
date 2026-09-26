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
