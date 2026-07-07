# Usage — page by page

Open `index.html`. Your plan **autosaves** to the browser as you go. The header always shows current
net worth, the FIRE target, and whether the plan survives to 80.

## 📊 Dashboard
Read-only overview. Metric cards, net-worth-to-80 line, current allocation doughnut, liquid-vs-pension
stacked chart, and a FIRE target coverage bar with 4% / 3.5% / 3% targets and a pension annuity estimate.

**Earliest possible FIRE age** (optional): tick "Auto-calculate earliest possible FIRE age" to have the
app find the lowest retirement age at which the plan still survives to your end age (at current spending
& assumptions), with a one-click button to apply it. It searches every age from now to your end age and
uses your **actual projected spending** (categories/steps), which may differ from the headline FIRE
monthly figure.

## 🏦 Accounts
The heart of the model. Accounts are shown as **cards grouped** by their group (Bank, Brokerage,
Study fund, Pension, …), each individually controllable.
- Edit **name, type, currency, balance, expected return (prediction), monthly contribution,
  contribution growth, access age, group, and notes** per card.
- **Liquid** = can be spent from during retirement. **Count in FIRE** = counts toward FIRE-eligible assets.
- Change the **Group** field to reorganize how accounts are grouped (e.g. put several ETFs under "Brokerage").
- Click the **+ buttons** to add a Cash / Money market / Taxable / Keren Hishtalmut / Pension / RSU /
  Custom account. **✕** deletes a card.
- **RSU** appears here as a **computed, read-only card** (driven by the Income page) so nothing is
  double-counted. Two pies show allocation by account and by type.

Tip: pension accounts default to `accessAge = 60` and non-liquid until then.

## 🌙 Dark mode
Use the **🌙 Dark / ☀️ Light** button in the header. Your choice is saved with the plan.

## ⚙️ Market & Assumptions
Global levers (drag the sliders):
- **USD/ILS** and **AMZN price** — drive USD accounts and RSU valuation.
- **Ages** — current, FIRE, pension access, projection end.
- **Inflation**, **safe withdrawal rate**, **pension annuity coefficient**.
- **Real mode** — show everything in today's ₪.
- **Default expected returns by type** — seed new accounts and drive future RSU vest pricing.
- A sensitivity chart shows years-to-target across a range of returns.

## ⚙️ Market & Assumptions
Global levers (drag the sliders): USD/ILS, ages, inflation, SWR, per-type expected returns, pension
coefficient, real/nominal toggle, plus a returns-sensitivity chart.
- **↻ Fetch live USD/ILS** (optional) pulls the current rate from a public API (frankfurter.dev / ECB,
  with a fallback) — only when you click. No data is sent, just a currency pair.

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
  all if you have no RSUs. Each grant shows as a computed account on the Accounts page.
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
  month/year frequency. Example: from age 31, ₪13,000/month.
- **Headline**: `FIRE monthly spend` sets the target used for FIRE portfolio math;
  `useCategoriesInRetirement` decides whether retirement spend follows categories or the flat headline.
- A line chart projects total annual spend to 80.

## 🧾 Tracker
Log what you actually spent each month per category. Pick a month, click **+ Add month**, then enter
the actual amount for each category. The table shows **budget vs actual** with a colour-coded variance
(over = red, under = green) and a monthly total; a chart tracks budget-vs-actual over time. Saved with
your plan.

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
- **Stacked chart** of each group's balance across all years.
Income vs spending line — now shows **salary+extra**, **net pension**, **withdrawn for living (net)**,
and **spending**, with a note listing lifetime withdrawals by **source group** and total taxes
(capital-gains on withdrawals + pension income tax).
- **Year-by-year table**: one row per age with income, spend, each group's balance, total, and liquid.
  The FIRE-age row is highlighted; a depletion year (if any) is flagged red.
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
- The raw state JSON is shown read-only for inspection.

### Portability
The exported JSON is the single source of truth. Back it up, version it in git, or move it between
machines/browsers. Files matching `my-state*.json` / `*.local.json` are git-ignored so you can keep
private snapshots inside the repo without committing them.
