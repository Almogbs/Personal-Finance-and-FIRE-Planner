# Changelog

All notable changes are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/).

## 1.26.1

- **Spending total follows the Edit-list chips** — the line under the categories table now sums the
  list you're viewing ("Total of list “Lean”: …") instead of always showing the active list, with a
  hint when the viewed list isn't the active one (the doughnut and projections still use the active
  list; the 🏠 mortgage all-in suffix shows only for the active list).
- **Vest editor marks post-retirement events** — vests dated in/after your retirement year were
  already excluded from the projection (employment ends), but were labeled "future vest"; they now
  show "after retirement — not counted ✗".

## 1.26.0

- **Monte Carlo moved into the 🔥 FIRE tab** (own nav entry removed) — all risk analysis now lives
  with the rest of the FIRE maths.
- **Mortgage payment shows up in Spending** — a read-only 🏠 row in the categories table, a slice in
  the mix doughnut, and an "all-in" monthly total; opt-out toggle (display only — the cashflow always
  pays the mortgage).
- **Mortgage tab works as a pure what-if simulator** — new **"Include in my plan"** toggle: unticked,
  nothing touches net worth/income/spending/survival, while all simulator outputs still render. New
  **deal-economics cards**: total repayment (principal + interest), interest as % of principal, rent
  collected until payoff, and **net cost after rent**. The value/debt/equity and rent-vs-payments
  charts are computed from the tab's own simulation, so they work in both modes.
- **What-if supports properties** — plan properties appear as sell-side holdings (growth = appreciation
  + rent yield), and a custom **🏠 property** source/target models rent yield, purchase costs
  (מס רכישה + fees, shown as an up-front deduction in the result), and sale tax on the gain (מס שבח).

## 1.25.0

- **🎲 New Monte Carlo tab** — sequence-of-returns risk analysis: N randomized runs of the full plan
  (one return shock per account type per year, volatility editable per type), reporting the
  **success rate**, a **net-worth percentile fan chart** (p10–p90), the **final-net-worth
  distribution**, the typical depletion age of failing paths, and the **safe retirement age at your
  target confidence** (with one-click apply). Zero volatility reproduces the deterministic
  projection exactly.
- **🏠 Mortgage tab is now a maslulim simulator** — one row per Israeli track: קל"צ, קבועה צמודה,
  פריים, משתנה כל 5 (linked/unlinked), each with **Spitzer or קרן שווה** amortization; a **rate
  scenario** panel (prime drift over N years, step per 5-yr reset) drives a **monthly-payment-over-
  time chart** per track and in total; per-track **peak payment** and total interest; and a mix
  summary that checks the **Bank-of-Israel composition rule** (≥⅓ fixed, prime ≤⅔). Existing loans
  migrate (CPI-linked → קבועה צמודה).
- **RSU schedule is now fully either/or** — a grant with a dated 📅 schedule derives its
  **currently-vested shares from past-dated events** (the Vested sh. cell becomes computed and
  greyed out alongside Sh./yr and the vest window), and every schedule edit updates the vested
  count, totals, and charts **live while typing** — no reload needed.

## 1.24.0

- **🏠 New Mortgage & Real Estate tab** — model properties (value, appreciation, rent) and mortgages
  (remaining principal, rate, years left, CPI-linked; one row per track for mixed Israeli loans).
  Monthly Spitzer amortization with computed payment / total interest / payoff year, value-vs-debt-
  vs-equity and rent-vs-payments charts. Fully integrated into the plan: equity counts in net worth
  (never as liquid/FIRE money), rent adds to income, payments to outgoings — Dashboard, Projections,
  CSV, and survival checks all include it.
- **🇮🇱 Bituach Leumi old-age pension built-in** — opt-in on the Pension tab (default ₪1,838/mo
  today's ₪ from age 70, CPI-linked, untaxed); flows into retirement income everywhere.
- **🏖️/☕ Coast & Barista FIRE on the FIRE tab** — earliest age to stop saving entirely (and still
  retire on schedule), and earliest age to drop to part-time given a configurable net income until a
  given age.
- **Bug fixes**
  - Pension annuity tax is now computed once on the **combined** annuity — multiple pension pots no
    longer each claim a full entitling-pension exemption.
  - Step-changes: the **List selector is always clickable** — picking a list switches the step to
    "Use list" mode automatically (previously it rendered disabled).
  - Grants: when a grant has a dated 📅 schedule, the now-ignored **Sh./yr and vest-window cells are
    greyed out** ("— 📅") so the either/or is obvious; *Vested sh.* (shares you already hold) still applies.
  - Pie-chart legends no longer clip long labels (ellipsized to fit; compact rows for many slices).
  - FIRE tab / Dashboard earliest-age searches and the sensitivity chart are **debounced** — sliders
    stay responsive.
  - The Tracker's "current month" now respects the as-of date override.
  - Cloud-sync config failures (offline/local) no longer spam the console; added a favicon.
  - Removed the dead `useCategoriesInRetirement` field.
- **UI**
  - **₪ Real / Nominal toggle in the header** — flip the whole app between today's ₪ and nominal.
  - Compact header on narrow screens (secondary metrics hide under 700px).
  - Number inputs show a thousands-separated tooltip for values ≥ 1,000.
  - Dashboard gains a **Real-estate equity** card when property is modeled; the vest-count button
    updates live while editing a schedule.

## 1.23.0

- **Accurate dates & ages everywhere** — every projection row now carries its **calendar year**, and
  the UI pairs it with your **exact age in years + months** from your birth date ("2033 · 32y 4m")
  instead of the old rounded "2033 · age 32". Milestones (retirement, pension access, depletion,
  earliest-retirement) show "2041 (age 45y 3m)". Charts' x-axes are calendar years.
- **Header overhaul** — the tagline is gone (plan name stays); the header now shows net worth,
  **retirement year + exact age**, **net worth at retirement**, and **time to retirement (y+m)**.
- **Dashboard** — new metric card for **Liquid (excl. pension) at retirement**, plus a new
  **Allocation at retirement** pie next to the current-allocation one.
- **RSU vesting schedules** — each grant can now carry explicit **dated vest events** (date + share
  count, several per grant with different amounts). Dated vests replace the flat "shares/yr" model
  for that grant, price each vest at the grant's growth compounded to its date, and stop at
  retirement. Edit via the new 📅 Schedule column on the Income page.
- **Multiple spending lists** — categories now live in named lists ("Default", "With kids", "Lean"…).
  Toggle the **active list** (drives projections & tracker), duplicate/rename/delete lists, and use a
  **step-change in "Use list" mode** to switch the plan to a different list from a given age.
- **Tracker: per-month exclusions** — skip a category in one specific month/year (🚫 skip) without
  removing it from the budget; totals, tiles, and charts respect the exclusion. The tracker budgets
  against the active spending list.
- **Predictions rebuilt around calendar years** — boxes are per **calendar year** (no age labels),
  you can **add past years and type actuals manually** (per account, editable in the detail table),
  and the baseline/record flow is explained on-page ("Save a baseline → record actuals → compare").
- **Dark-mode fix** — the highlighted retirement/depletion rows in the year-by-year table were
  unreadable in dark mode.
- **Pension model corrected against current Israeli law** (2026 figures):
  - The annuity tax exemption now follows the **actual statutory schedule** — 52% ≤2024, 57% 2025,
    **57.5% 2026, 62.5% 2027, 67% from 2028** (the old "67% from 2025" plan was rescheduled). Auto by
    default, manual override available.
  - The exemption **only applies from age 67** (גיל הזכאות / קיבוע זכויות): an annuity drawn at 60 is
    modeled as fully taxable until 67, then the exemption kicks in — the Pension page shows net both
    at access and from 67.
  - **Lump-sum mode now enforces the minimum-annuity rule** (קצבה מזערית ₪5,306/mo, 2026): the pot
    needed to secure it is annuitized; only the excess is withdrawn, tax-free up to the exempt-capital
    ceiling (exemption% × ceiling × 180 months, from age 67) and at marginal rates beyond.
  - Pension access age minimum raised to the legal **60**; coefficient guidance updated (~186–200 at
    67, higher at 60); default balance fee aligned with the state-selected default funds (0.22%/yr).
  - Payroll defaults refreshed to 2026: employee NI+health **4.27% / 12.17%**, threshold ₪7,703/mo,
    ceiling ₪51,910/mo (auto-migrated only if you never changed them), plus a hint about the
    comprehensive-fund deposit cap (₪5,645/mo ≈ salary ₪27,538/mo).

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
