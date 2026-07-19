# Usage — page by page

Open `index.html`. Your plan **autosaves** to the browser as you go. The header always shows current
net worth, the FIRE target, and whether the plan survives to 80.

## 📊 Dashboard
Read-only overview. Metric cards — current net worth, liquid, pension, **retirement spend at your
retirement age**, plan status, net worth at 80, **years to retirement**, **savings rate now**, **net
worth at retirement**, and the **withdrawal rate you'd need at retirement** — plus a net-worth-to-80 line,
current allocation doughnut, liquid-vs-pension stacked chart, and a **Retirement readiness** panel. All of
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
- **Withdrawal order in retirement** — reorder (↑/↓) which account types are drained first to cover a
  retirement spending shortfall. Pension is only tapped after its access age (or when not annuitized),
  and accounts you un-tick from **Count in FIRE** on the Accounts page are never drawn down.
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
  - **↻ Fetch live prices** (optional) pulls current quotes from Finnhub by each grant's **Symbol** —
    requires a free Finnhub API key entered in the panel. Only runs on click.
- **Extra income streams**: rent, side income, a partner's income, one-off windows, etc.
- **Surplus allocation**: pick a default account for "the rest," then add rules like "50% → money
  market" or "₪2,000/month → pension." A live line shows how this year's surplus is split.

## 🛒 Spending
Two complementary ways to model spend:
- **Categories** — Housing, Food, Transport, … each with an amount, a **per month / per year**
  frequency (yearly items like vacations/insurance are amortized to a monthly-equivalent), age window,
  own growth %, and an *inflate* toggle. A **total** line sums all active categories (monthly & yearly).
  The doughnut shows the mix.
- **Step changes (differential spending)** — override total spend from a given age, also with a
  month/year frequency. Example: from age 31, ₪13,000/month. A step **persists from its age onward**.
- **Spending used by age** — a preview table showing, as **age ranges**, which rule decides your spend
  (step override → categories, or the fixed FIRE spend if enabled on the 🔥 FIRE tab).
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
- Everything **refreshes as you type** — deltas, subtotals and totals update live without losing your place.
- Charts track **budget vs actual** over time — one for monthly spending and one for yearly costs.
  History is saved with your plan.

## 👵 Pension (Israel)
Models pension income after the access age using Israeli rules.
- **Payout mode**: *annuity* (monthly קצבה = pot ÷ conversion coefficient, with a tax-exempt portion of
  the entitling-pension ceiling and the rest taxed) or *lump* (drawdown).
- Edit the **conversion coefficient**, **entitling ceiling**, **exempt %**, CPI-linking, and access age.
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
- **Year-by-year table**: one row per age with income, spend, each group's balance, total, and liquid.
  The retirement-age row is highlighted; a depletion year (if any) is flagged red.
- **Income & withdrawals by phase** — a plain-language list that groups consecutive years with the same
  income/withdrawal pattern into ranges, e.g. "2037–2045 (ages 41–49) — Retired: withdraw ~₪X/yr net from
  Brokerage …", showing per-year averages, the phase total, capital-gains tax, and when pension begins.
- **Real (today's ₪)** toggle and **Export CSV** (also grouped).

## 🎯 Predictions
Its own page. Save the current projection as a **baseline** (one box per year, kept for every future
year). The current year is highlighted. Each year, click **Record this year's actuals** to snapshot your
real account balances; the boxes then show the **delta vs prediction** (global %), and selecting a year
shows a per-account predicted-vs-actual table plus a predicted-vs-actual net-worth chart. Future boxes
are never deleted — re-saving the baseline just refreshes the predicted path. A selected year with an
actual can be cleared via **Remove recorded actual**.

## 🔀 What-if / Switch
Compare **selling one holding and reinvesting the net into another**. Pick a source holding and how
much to sell, a target holding, each one's expected growth, and a horizon. The tool pays the tax up
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
