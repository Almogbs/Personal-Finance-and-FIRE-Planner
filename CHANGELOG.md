# Changelog

All notable changes are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/).

## 1.x

A standalone, offline personal-finance & FIRE planner for Israel. Highlights:

- **Accounts** — cash, money market, taxable brokerage, Keren Hishtalmut, pension, and equity
  grants, in ILS or USD; per-account returns, contributions, access age, notes, and management fees
  (deposit + balance for pension; balance for study funds).
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
- **Tracker** — log actual monthly spend vs budget per category.
- **What-if / Switch** — model selling a holding and reinvesting the net into another (custom holdings
  supported), with tax-aware keep-vs-switch analysis.
- **Dashboard** — net worth to end age, allocation, FIRE target coverage, earliest-FIRE age, pension
  annuity estimate.
- **Extras** — dark mode, age from date of birth (with optional network/manual as-of date), optional
  live USD/ILS and stock-price fetch, and JSON save/load (your data stays in your browser and in files
  you export).

> Educational model only — not financial, tax, or investment advice.
