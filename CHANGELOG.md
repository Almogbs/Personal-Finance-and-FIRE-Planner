# Changelog

All notable changes are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/).

## 1.22.4

- **Live stock prices are now keyless** — removed the Finnhub API-key path (and the key input). Quotes
  come from Yahoo Finance through a public CORS proxy; no sign-up or key required.
- **Projections** — moved "Income & withdrawals by phase" up, directly below the stacked all-entities chart.
- **Equity grants** — each grant gets a **“ret age”** checkbox that ties its *vest-until* to your
  retirement age; toggling the retirement age anywhere updates the grant's vesting (and every downstream
  number) automatically.

## 1.22.3

- **"FIRE age" renamed to "Retirement age"** across the UI (the FIRE tab and FIRE target keep their name).
- **Shared Retirement-age control** — the same value is now editable on the Dashboard, Market &
  Assumptions, **and Projections** pages; change it anywhere and the whole plan updates.
- **🔎 Find earliest retirement age** button on the Dashboard, Market & Assumptions, and Projections
  pages — computes the earliest survivable retirement age (from your real spending) and applies it in one click.
- **More dashboard stats** — added metric cards for years to retirement, current savings rate, net worth
  at retirement, and the withdrawal rate you'd need at retirement.

## 1.22.0

- **Theoretical FIRE target confined to the 🔥 FIRE tab** — the `fixed spend ÷ SWR` portfolio target (and
  the 4/3.5/3% variants and the returns-sensitivity chart) now appear **only** on the FIRE tab. The
  dashboard's old "FIRE target coverage" is replaced by a **Retirement readiness** panel driven by your
  real projected spending (non-pension assets at FIRE age, modeled retirement spend, years covered, and
  whether the plan survives), and the header's "FIRE target" metric was removed.
- **Dedicated 🔥 FIRE tab** — the theoretical FIRE maths (fixed monthly spend, safe withdrawal rate,
  portfolio target at SWR / 4% / 3.5% / 3%, coverage, and earliest-FIRE age) moved off the Spending and
  Market pages into their own tab. **Projections now use your real Spending categories & step-changes by
  default**; a checkbox on the FIRE tab opts into using the fixed FIRE spend for the retirement phase.
- **Income & withdrawals by phase** moved from Predictions to the **Projections** tab.
- **Withdrawal order** now skips accounts you un-tick from **“Count in FIRE”** — that money is never
  drawn down in retirement.
- **“Spending used by age”** preview now shows contiguous **age ranges** per rule, so a single step (which
  persists forward) no longer looks like a step at every later checkpoint age.

## 1.21.1

- **Per-holding gain vs buy value %** on taxable/brokerage accounts — capital-gains tax now applies to
  the gain portion only (cost basis is derived from the gain%). A card hint shows the implied buy value
  and taxable gain.
- **Configurable retirement withdrawal order** — reorder which account types are drained first to cover
  a spending shortfall, on the Market & Assumptions page.
- **Brokerage pie charts** on the Accounts page: a brokerage-accounts breakdown and a cost-basis-vs-gains split.
- **Tracker redesign** (Predictions-style): click a **month tile** to load and log that month's recurring
  spending, and log **one-off / annual** costs once per **year** in a separate year-tile section (no
  longer duplicated inside every month). Live-updating variance/subtotals, per-entry notes, and monthly
  and yearly budget-vs-actual charts.
- **Header decluttered** — removed the Save/Load buttons (use the Save / Load page) and made the banner
  compact on mobile.
- **Google sign-in** no longer gets stuck on an old account — sign-out revokes the grant and disables
  auto-select, so the account chooser reappears.

## 1.x

A standalone, offline personal-finance & FIRE planner for Israel. Highlights:

- **Accounts** — cash, money market, taxable brokerage, Keren Hishtalmut, pension, and equity
  grants, in ILS or USD; per-account returns, contributions, access age, notes, management fees
  (deposit + balance for pension; balance for study funds), and a per-holding gain-vs-buy-value % so
  capital-gains tax applies to gains only. A configurable withdrawal order controls drawdown priority.
- **Income** — gross-salary mode computes net take-home and infers pension & Keren Hishtalmut deposits
  via Israeli payroll rules (income tax with credit points, National Insurance + health, taxable
  imputations), or enter net directly. Editable contribution rates (employee/employer/severance).
- **Equity grants** — zero, one, or many RSU/option grants, each with its own price, growth, vesting
  window, basis, and Section-102 tax treatment. Optional live price fetch.
- **Spending** — categories (monthly or yearly) with growth and age windows, life-stage step changes,
  a total, and a "which rule decides spend at each age" preview.
- **Pension (Israel)** — monthly קצבה = pot ÷ conversion coefficient, with the entitling-pension tax
  exemption, bracketed tax, CPI-linking, and a lump/drawdown alternative.
- **Projections** — year-by-year balances to the end age, aggregated by account group, with a
  month-prorated current year, real/nominal toggle, and CSV export.
- **Predictions** — save a baseline and compare recorded yearly actuals vs prediction, per account.
- **Tracker** — log actual spend vs budget with a **month/year tile picker** (like Predictions): click a
  month to log recurring spending and a year to log one-off/annual costs; live-updating variance,
  subtotals, and per-entry notes.
- **What-if / Switch** — model selling a holding and reinvesting the net into another (custom holdings
  supported), with tax-aware keep-vs-switch analysis.
- **Dashboard** — net worth to end age, allocation, FIRE target coverage, earliest-FIRE age, pension
  annuity estimate.
- **Extras** — dark mode, age from date of birth (with optional network/manual as-of date), optional
  live USD/ILS and stock-price fetch, and JSON save/load (your data stays in your browser and in files
  you export).

> Educational model only — not financial, tax, or investment advice.
