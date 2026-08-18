# Usage — page by page

Open `index.html`. Your plan **autosaves** to the browser as you go. The header always shows your plan
name, current net worth, **retirement year (with your exact age)**, **net worth at retirement**,
**time to retirement (years + months)**, and whether the plan survives to your end age.

**Dates & ages**: projection rows are calendar-year aligned, so the app always pairs an **absolute
year** with your **exact age (years + months)** from your date of birth — e.g. "2033 · 32y 4m". Set
your birth date on Market & Assumptions to enable this (without it, integer ages are shown).

## 📊 Dashboard
Read-only overview. Metric cards — current net worth, liquid, pension, **retirement spend**, plan
status, net worth at the end age, **time to retirement (y+m)**, **savings rate now**, **net worth at
retirement**, **liquid (excl. pension) at retirement**, and the **withdrawal rate you'd need at
retirement** — plus a net-worth line, current allocation doughnut, an **allocation-at-retirement**
doughnut, liquid-vs-pension stacked chart, and a **Retirement readiness** panel. All of
it is based on your **real** projected spending: your non-pension assets at retirement age, your modeled
retirement spend that year, how many years that pot covers, and whether the plan survives to your end age.
(The theoretical fixed-spend / SWR portfolio target lives on the 🔥 FIRE tab, not here.)

**Earliest retirement age**: click **🔎 Find earliest retirement age** to compute the lowest retirement
age at which the plan still survives to your end age (using your real categories/steps), with a one-click
button to apply it. (The same button is on the Market & Assumptions and Projections pages.) You can also
tick "Auto-calculate earliest possible retirement age" to keep it always shown.

## 🏦 Accounts
The heart of the model. Accounts are shown as **cards grouped** by their group (Bank, Brokerage,
Study fund, Pension, …), each individually controllable.
- Edit **name, type, currency, balance, expected return (prediction), monthly contribution,
  contribution growth, access age, cap-gains %, group, and notes** per card.
- **Taxable/brokerage accounts** also have a **Gain vs buy value %** field: enter how much the holding
  is up (or down) from what you paid, and capital-gains tax is applied to the **gains only** on any
  future sale (basis = balance ÷ (1 + gain%/100)). A card hint shows the implied buy value and taxable gain.
- **Liquid** = can be spent from during retirement. **Count in FIRE** = counts toward FIRE-eligible assets.
- Change the **Group** field to reorganize how accounts are grouped (e.g. put several ETFs under "Brokerage").
- Click the **+ buttons** to add a Cash / Money market / Taxable / Keren Hishtalmut / Pension / RSU /
  Custom account. **✕** deletes a card.
- **RSU** appears here as a **computed, read-only card** (driven by the Income page) so nothing is
  double-counted. Pies show allocation **by account**, **by type**, a **brokerage-accounts** breakdown,
  and brokerage **cost basis vs taxable gains**.

Tip: pension accounts default to `accessAge = 60` and non-liquid until then.

## 🌙 Dark mode
Use the **🌙 Dark / ☀️ Light** button in the header. Your choice is saved with the plan.

## ⚙️ Market & Assumptions
Global levers (drag the sliders):
- **USD/ILS** — drives USD-denominated accounts (RSU/grant share prices are set per grant on the
  Income page, not here).
- **Ages** — current, **retirement age** (a.k.a. FIRE age, shared with the Dashboard and Projections
  pages), pension access, and projection end. A **🔎 Find earliest retirement age** button computes and can
  apply the earliest survivable age.
- **Inflation** and **pension annuity coefficient**.
- **Real mode** — show everything in today's ₪.
- **Default expected returns by type** — seed new accounts and drive future RSU vest pricing.
- **Withdrawal order in retirement** — drag rows by the ⠿ handle (or use ↑/↓) to set which account
  types are drained first to cover a retirement spending shortfall. Types with no "Count in FIRE"
  account are hidden (shown in a small note) and reappear in place when one becomes eligible. Pension
  is only tapped after its access age (or when not annuitized).
- **Israeli payroll rates** — used when salary is entered as gross on the Income page.
- **↻ Fetch live USD/ILS** (optional) pulls the current rate from a public API (frankfurter.dev / ECB,
  with a fallback) — only when you click. No data is sent, just a currency pair.
- The **safe withdrawal rate** lives on the **🔥 FIRE** tab.

## 🔥 FIRE
The theoretical FIRE target maths, kept separate from your real spending:
- Set a **fixed FIRE monthly spend** and a **safe withdrawal rate (SWR)**; see the portfolio you'd need at
  your SWR and at the classic 4% / 3.5% / 3% rules (and the equivalent ×-annual multiples), plus what your
  current net worth could sustain per month at that rate.
- A **coverage bar** compares your projected non-pension assets at your retirement age to the target, and
  the **earliest retirement age** (computed from your *real* categories/steps) is shown with a one-click
  apply button.
- A **sensitivity chart** shows years-to-target across a range of expected returns.
- By default, **projections and every calculation use your real Spending categories & step-changes**. Tick
  **“Use this fixed spend for projections”** only if you want the retirement years to assume the fixed FIRE
  monthly spend instead.
- **🏖️ Coast FIRE** — the earliest age you could **stop saving entirely** (keep working just to cover
  expenses, let the portfolio compound) and still retire at your configured retirement age.
- **☕ Barista FIRE** — set a part-time net income and until-age; shows the earliest age you could
  leave full-time work with that income bridging the gap.
- **📈 Show projection** (per scenario, collapsed by default) — unfolds a Projections-style view of
  the coast/barista path: an age slider (defaults to the earliest computed age), a
  baseline-vs-scenario net-worth chart, and a year-by-year table with a "coast" phase marker.
- The earliest-age searches and sensitivity chart compute in the background (a short "computing…"
  appears while sliders move).

### 🎲 Monte Carlo (section at the bottom of the 🔥 FIRE tab)
Sequence-of-returns risk: the plan is re-run hundreds of times with randomized yearly returns.
- **Settings** — simulations per run, target confidence, and annual volatility (std dev %) per
  account type (reference: global equities ~15–18%, bond-heavy ~5–8%, single stock 30%+). Each year
  every account *type* gets one shared shock, so all your equity funds move together.
- **Results** — **success rate** (share of paths surviving to your end age), median / p10 / p90
  final net worth, the typical depletion age of failing paths, a **percentile fan chart** of net
  worth, and a **final-net-worth distribution**.
- **Safe retirement age** — the earliest retirement age whose success rate meets your target
  confidence, with a one-click apply button. Heavy computations are debounced and run in the
  background.

## 💰 Income
- **Salary**: choose **gross** or **net** mode.
  - *Gross mode* (default): enter gross salary, taxable extras (travel, etc.), and credit points; the app
    computes **net take-home** and your **pension + Keren Hishtalmut deposits** via Israeli payroll rules
    (income tax with credit points, National Insurance + health, employee pension & study-fund). Those
    deposits automatically feed your pension and study-fund accounts — no hardcoding.
  - *Net mode*: enter take-home directly and set deposits per account.
  - Payroll rates are editable on **Market & Assumptions → Israeli payroll rates**.
- **Equity grants (RSUs / options)**: a table of grants — **zero, one, or many**. Each has its own
  ticker/name, currency, share price, expected growth, currently-vested shares, new shares/year, grant
  basis, ordinary + capital-gains rates, and a **vesting window (vest from → vest until age)**. So you
  can add grants from different companies, stop a grant's vesting early, start one later, or remove them
  all if you have no RSUs. Tick a grant's **“ret age”** box to tie its vest-until to your retirement age —
  it then follows the retirement age automatically wherever you change it. Each grant shows as a computed
  account on the Accounts page.
  - **📅 Vesting schedule (dated vests)**: click a grant's Schedule button to list explicit vest events —
    each with its own **date** and **share count** (a grant can vest different amounts on different
    dates, past or future). A schedule **replaces** the flat model entirely: events dated on/before
    today count as **already vested** (the Vested sh. cell becomes computed and greyed out, like
    Sh./yr and the vest window), future events vest on their date, and vesting stops at your
    retirement year. Everything — vested count, totals, charts — updates live as you type.
  - **↻ Fetch live prices** (optional) pulls current quotes from Yahoo Finance by each grant's
    **Symbol** — no API key needed (goes through a public CORS proxy). Only runs on click.
- **Extra income streams**: rent, side income, a partner's income, one-off windows, etc.
- **Surplus allocation**: pick a default account for "the rest," then add rules like "50% → money
  market" or "₪2,000/month → pension." A live line shows how this year's surplus is split.

## 🛒 Spending
- **Spending lists** — categories live in named lists (e.g. "Default", "With kids", "Lean"). The
  **active list** drives projections and the tracker; switch it with the Active-list dropdown. Use the
  **Edit list** chips to view/edit another list, and the toolbar to **create, duplicate, rename, or
  delete** lists (the last list can't be deleted).
- **Categories** — Housing, Food, Transport, … each with an amount, a **per month / per year**
  frequency (yearly items like vacations/insurance are amortized to a monthly-equivalent), age window,
  own growth %, and an *inflate* toggle. **Drag rows by the ⠿ handle** to reorder (or use ↑/↓), and
  **drop a row onto an "Edit list" chip to move it to that list**. A **total** line sums all active categories (monthly & yearly).
  The doughnut shows the mix.
- **Step changes (differential spending)** — take effect from a given age and persist onward. Two modes:
  - **Fixed amount** — override total spend (e.g. from age 31, ₪13,000/month), month/year frequency.
  - **Use list** — switch the plan to another category list from that age (e.g. from age 35 use the
    "With kids" list).
- **Spending used by age** — a preview table showing, as **year + exact-age ranges**, which rule decides
  your spend (step override / list switch → categories of the active list, or the fixed FIRE spend if
  enabled on the 🔥 FIRE tab).
- **🏠 Mortgage row** — when a mortgage is part of the plan, its current monthly payment appears as a
  read-only item in the categories table, the mix doughnut, and an "all-in" total (a toggle hides the
  display; the cashflow always pays the mortgage either way).
- **Category defaults** — the default per-year growth applied to new categories. The theoretical
  fixed-spend FIRE target now lives on the **🔥 FIRE** tab.
- A line chart projects total annual spend to 80.

## 🧾 Tracker
Compare what you actually spent against your budget (the category amounts from the Spending page). It
works like the Predictions page — a grid of clickable **tiles**, and you load one at a time:
- **Monthly tracking** — pick a month (top of the section) and click **+ Add / open month**, or click any
  existing **month tile** to load it. The selected month shows a table of your **monthly** categories
  with budget, an editable **actual**, and a colour-coded **Δ vs budget**, plus a subtotal, month total,
  and a free-text note. The tile shows that month's actual total (and variance once you've logged some).
- **Yearly tracking** — one-off / annual costs (vacations, insurance, taxes) are logged **once per year**,
  not tied to a month. Add/open a **year tile** the same way; the detail table lists your **yearly**
  categories with their annual budget, actual, and variance, plus a note.
- **Per-month exclusions** — every category row has a **🚫 skip** button that excludes that category
  from *that month/year only* (e.g. an item you added in July that isn't relevant to April). Excluded
  rows are struck through and drop out of the budget, totals, tiles, and charts; click **↩ include** to
  restore. The budget itself (Spending page) is untouched.
- The tracker budgets against the **active spending list**.
- Everything **refreshes as you type** — deltas, subtotals and totals update live without losing your place.
- Charts track **budget vs actual** over time — one for monthly spending and one for yearly costs.
  History is saved with your plan.

## 🏠 Mortgage & Real Estate
A mortgage **simulator with Israeli tracks (מסלולים)** — for a mortgage you **have** or one you're
only **considering**:
- **Include in my plan** toggle — ticked: equity feeds net worth, rent feeds income, payments feed
  outgoings and survival checks everywhere. Unticked: the tab becomes a **pure what-if simulator**
  that touches nothing in the plan (all charts and totals still work).
- **Deal economics cards** — total repayment (principal + interest), interest as % of principal,
  rent collected until payoff, and the **net cost after rent** — the numbers that answer "is this
  mortgage a good idea?".
- **Properties** — value today, appreciation %/yr, monthly rent (0 if you live there), rent growth.
- **Mortgage tracks** — one row per מסלול: קל"צ (fixed, unlinked), קבועה צמודה (fixed, CPI-linked),
  פריים (variable prime), משתנה כל 5 (rate resets every 5 years, linked or not). Each row has its
  remaining principal, current rate, years left, and a **method**: Spitzer (constant payment) or
  קרן שווה (equal principal — starts higher, declines). Computed per track: **payment now, peak
  payment, total interest ahead, payoff year**.
- **Rate scenario (stress test)** — drift the prime rate by ±pp over N years and step the
  every-5-yr tracks at each reset; CPI linkage follows the plan's inflation. The **monthly-payment-
  over-time chart** shows the resulting payment path per track and in total.
- A **mix summary** checks the Bank-of-Israel composition rule (≥⅓ fixed-rate, prime ≤⅔).
- **Charts** — property value vs debt vs equity over time, and annual rent vs mortgage payments.
- **Integration** — equity (value − debt) counts toward net worth everywhere (Dashboard card,
  Projections table/CSV, header), rent adds to income, payments to outgoings and the survival
  check — but the house is never treated as liquid/FIRE-spendable money. Play with rates, terms,
  and appreciation; everything recalculates instantly.

## 👵 Pension (Israel)
Models pension income after the access age (earliest 60 by law) using current Israeli rules.
- **Payout mode**: *annuity* (monthly קצבה = pot ÷ conversion coefficient) or *lump* (היוון — the
  statutory **minimum annuity** is secured first; only the pot above it is withdrawn).
- **Tax exemption**: follows the statutory schedule by default (57.5% of the entitling ceiling in
  2026 → 62.5% in 2027 → 67% from 2028) and **only applies from age 67** (גיל הזכאות) — an annuity
  drawn at 60 is modeled as fully taxable until then, and the page shows net both at access and
  from 67. Untick the auto toggle to set a manual %.
- Edit the **conversion coefficient** (≈186–200 at 67; higher when drawing at 60), **entitling
  ceiling** (₪9,430/mo), **minimum annuity** (₪5,306/mo, 2026), **exemption start age**,
  CPI-linking, and access age.
- **Bituach Leumi old-age pension (קצבת אזרח ותיק)** — tick the box to add the state pension to
  retirement income (default ₪1,838/mo in today's ₪ from age 70, CPI-linked, untaxed). Fold
  seniority increments (+2%/insured year, up to +50%) into the amount yourself.
- **Management fees (דמי ניהול)**: a fee from every **deposit** (legal cap 6%, typical ~1.5%) and an
  annual fee from the **balance** (legal cap 0.5%, typical ~0.15%). Both reduce the pot; a note shows
  what they cost on your current balance and monthly deposit.
- A breakdown table shows gross → exempt → taxable → tax → **net monthly** pension (and today's-₪
  equivalent), a **pension-pot-over-time** chart, and a net-income chart.

## 📈 Projections
Holdings are **aggregated by account group** here (e.g. all brokerage ETFs shown as one "Brokerage", all
bank accounts as one "Bank"), so the chart and table stay readable. Edit individual accounts on the
Accounts page; change an account's **Group** field to control how it's aggregated.
- A **Retirement age** control (the same value as on the Dashboard and Market & Assumptions pages) plus a
  **🔎 Find earliest retirement age** button — change it here and the whole projection updates.
- **Stacked chart** of each group's balance across all years.
Income vs spending line — now shows **salary+extra**, **net pension**, **withdrawn for living (net)**,
and **spending**, with a note listing lifetime withdrawals by **source group** and total taxes
(capital-gains on withdrawals + pension income tax).
- **Year-by-year table**: one row per **calendar year** (with your exact age at year-end) with income,
  spend, each group's balance, total, and liquid. The retirement-year row is highlighted (readable in
  both light and dark mode); a depletion year (if any) is flagged red.
- **Income & withdrawals by phase** — a plain-language list that groups consecutive years with the same
  income/withdrawal pattern into ranges, e.g. "2037–2045 (ages 41–49) — Retired: withdraw ~₪X/yr net from
  Brokerage …", showing per-year averages, the phase total, capital-gains tax, and when pension begins.
- **Real (today's ₪)** toggle and **Export CSV** (also grouped).

## 🎯 Predictions
Everything is keyed by **calendar year**. Three-step flow (explained on-page):
1. **Save a baseline** — freezes a copy of today's projection, one box per calendar year. That's the
   prediction you're measured against; it only changes when you explicitly click **Update baseline**.
2. **Record actuals** — for the current year, one click snapshots your real balances. For **any other
   year (including past years)**, type the year and click **➕ Add year to fill manually**, then enter
   each account's actual balance in the detail table (totals and deltas update as you type).
3. **Compare** — boxes show predicted vs actual with a global %, the selected year gets a per-account
   predicted-vs-actual table, and a chart plots both lines. Years that exist only as actuals (e.g. past
   years) show "—" for the prediction. **Remove actuals** clears a year's recorded values.


## 🔀 What-if / Switch
Compare **selling one holding and reinvesting the net into another**. Pick a source holding and how
much to sell, a target holding, each one's expected growth, and a horizon. **Properties** work on
both sides: plan properties appear as sources (growth = appreciation + rent yield, total return), and
a **custom 🏠 property** source/target adds rent yield, purchase costs (מס רכישה + fees, lost up
front) and sale tax on the gain (מס שבח; 0 = exempt) — so "sell ETF, buy a flat" and "sell the flat,
buy ETFs" are both one dropdown away. The tool pays the tax up
front (capital gains, or full Section-102 tax for a grant), reinvests the net, and charts **Keep vs
Switch** over time — with a crossover year and verdict. Toggle "account for capital-gains tax at the
horizon" for a fair after-tax comparison (a kept grant is taxed at sale too). Helps you avoid switching
into a similar-growth asset just to eat a tax bill, or spot when a faster target is worth it.

## 💾 Save / Load (your DB)
- Rename the plan.
- **Save to file** downloads a `.json` snapshot (your database). **Load from file** restores one.
- **Load sample plan** loads `data/sample-state.json` (needs a local server on some browsers).
- **Reset to defaults** wipes back to the built-in plan.
- **Cloud sync (optional)** — sign in with Google to load/save your plan via a Cloudflare Worker.
  Signed in with the wrong account? Click **Sign out** to clear it and pick another (sign-out revokes
  the previous grant and never auto-reselects, so the account chooser reappears next time).
- The raw state JSON is shown read-only for inspection.

### Portability
The exported JSON is the single source of truth. Back it up, version it in git, or move it between
machines/browsers. Files matching `my-state*.json` / `*.local.json` are git-ignored so you can keep
private snapshots inside the repo without committing them.
