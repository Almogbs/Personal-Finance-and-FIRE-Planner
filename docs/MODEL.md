# The Model — math & assumptions

This document explains exactly what `js/engine.js` computes. It is intentionally a **simplified**
deterministic model. It is **not** tax advice and does not attempt to reproduce Israeli tax law precisely.

## Units & currency

- All internal math is in **nominal ILS**.
- USD accounts are converted at a **constant** `market.usdIls` for the whole projection (no FX drift).
- A **real mode** toggle divides displayed values by `(1 + inflation)^years` to show today's ₪.

## Time axis

The engine integrates in **calendar months** and then aggregates each calendar year into one
annual row. Both are returned: `rows` (one per calendar year — the series every chart, table and
CSV uses) and `monthly` (one per month, the raw series behind them).

- The month loop runs from the **as-of month** through December of the final year, so the first
  calendar year is naturally partial (start in September → a 4-month first row). There is no
  year-fraction fudge factor.
- Every **rate** is converted to its monthly equivalent `(1+r)^(1/12) − 1`, so twelve months compound
  to exactly the stated annual rate. Annual balance fees are likewise taken as `(1−fee)^(1/12)` a month.
- Every **boundary** is tested against your **exact fractional age** each month, so it lands on your
  real birthday instead of snapping to 1 January. This governs retirement (`fireAge`), pension access,
  per-account `accessAge`, spending-category windows, extra-income windows, grant vesting windows and
  the old-age pension start. The retirement year is therefore **split**: you earn salary up to your
  birthday and draw down after it, and the annual row reports `workingMonths` (0–12) alongside `working`.
- **Contributions are deposited monthly**, so money saved in January compounds for the rest of that
  year. In the previous yearly model a whole year of contributions was added after that year's growth
  and earned nothing until the following year.
- Annual rows are built by **summing flows** (salary, spend, withdrawals, rent, mortgage, pension) over
  the year's months and **snapshotting balances** at the final month. `monthly` sums exactly to `rows`.
- `rows` keeps its `age` as the whole projection age and `k` as the year index, unchanged, so real-mode
  deflation (`value / (1+inflation)^k`) and every existing consumer behave as before. The UI pairs the
  row's absolute `year` with your exact age in years + months from the birth date — "2033 · 32y 4m".
  Age-milestone labels (retirement, pension access, depletion) show the year they take effect and your
  exact age at the start of it.

### What still settles annually

Israeli tax is defined on annual totals, so some things cannot be computed a month at a time:

- **Income-tax brackets, credit points and the NI/health ceilings.** Net salary is already a monthly
  payroll calculation, and it is applied monthly.
- **The pension annuity's entitling-pension exemption** (Amendment 190) is one allowance per calendar
  year. The engine accrues annuity gross **year-to-date**, recomputes the year's tax each month and
  charges the increment, which keeps the allowance exact even when the annuity starts mid-year.
- **Section-102 ordinary income** from selling grant shares stacks on a year-to-date base (taxable
  salary + taxable pension + ordinary already realized that year), so a sale in March is priced below
  one in November — the brackets settle per calendar year even though the cash moves monthly.
- **The lump-sum היוון exempt capital** (`pct × ceiling × 180`) is a one-off statutory calculation.

### Cash flow within a year

Each month's income minus outgoings lands in a **cash float**:

- a **negative** float is funded immediately by selling, because that is a real cash need in that month;
- a **positive** float accumulates and is invested at **year end** via the allocation rules, which keeps
  the established convention that a year's surplus starts compounding the following year.

This is why monthly stepping does **not** cause spurious selling: a surplus month builds the float that
a later deficit month spends, so no year that was net-positive overall sells anything.

## Accounts

Each account has:

| Field | Meaning |
|---|---|
| `kind` | cash / money_market / taxable / study_fund / pension / rsu / custom |
| `currency` | ILS or USD (USD converted at `usdIls`) |
| `balance` | current balance in its currency |
| `expectedReturn` | nominal annual return % |
| `monthlyContribution` | recurring deposit while working |
| `contributionGrowthPct` | annual growth of that contribution |
| `accessAge` | age before which the account is **locked** (pension = 60) |
| `liquid` | may be drawn to fund spending shortfalls |
| `includeInFire` | counts toward FIRE-eligible assets |
| `capGainsRate` | capital-gains tax % applied to the **gain** when sold |
| `costBasis` / `gainPct` | buying value used to size the taxable gain. Taxable accounts can set **gain vs buy value %** instead of an absolute basis: `basis = balance / (1 + gainPct/100)` (a negative `gainPct` models a position at a loss → no gain → no CG tax) |

### Yearly update order

For each age:

1. **Growth:** `balance *= (1 + expectedReturn/100)`.
2. **Contributions** (working years only): `balance += monthlyContribution*12*(1+contributionGrowthPct/100)^k`, where `k` is years since start.
3. **RSU vests** (see below) are added to the RSU account.
4. **Cash flow:** compute take-home income minus spending.
   - **Surplus** → distributed via **allocation rules** (see below); the remainder goes to the
     **default account** (`income.defaultAccountId`, typically your checking account).
   - **Shortfall** → withdrawn from liquid accounts in a **configurable order**
     (`assumptions.withdrawalOrder`, default
     `cash → money_market → taxable → rsu → study_fund → custom → pension`, editable on the
     Market & Assumptions page), skipping any account still under its `accessAge`.
   - If a shortfall cannot be covered, the first such age is recorded as the **depletion age**.

> Employer pension and study-fund deposits are modeled **only** as an account's `monthlyContribution`
> (step 2) — there is no separate income field for them, so they are never double-counted. The salary
> you enter is **net take-home**.

### Surplus allocation

`income.allocations` is a list of rules, each routing part of the annual surplus to an account:

```
mode = 'percent' → amount = surplus * value/100
mode = 'amount'  → amount = value * 12        (value is ₪/month)
```

Rules are applied in order, each capped by the remaining surplus. Whatever is left after all rules
goes to `income.defaultAccountId`. With no rules, the entire surplus goes to the default account.

## Income

- **Salary:** `monthlyNetSalary*12*(1+salaryGrowthPct/100)^k`. Zero after FIRE if `stopSalaryAtFire`.
- **Extra streams:** each `{monthlyAmount, startAge, endAge, growthPct}` contributes within its age window.
- **Pension payout:** not modeled as a separate income line — instead the pension account becomes
  liquid at `pensionAccessAge` and is drawn down like any other pot. A separate **annuity estimate**
  is shown = `pensionPotAtAccess / pensionAnnuityCoefficient`.

## RSU (Section-102 capital-gains track, modeled)

The taxable event is the **sale** (release from the trustee), not the vest. Shares enter the grant
account **gross** and carry a deferred tax liability; nothing is paid until they are sold.

```
grossILS     = shares * sharePrice * usdIls
ordinaryBase = shares * grantBasisUsd * usdIls     ← pinned to grant date, never grows
appreciation = max(0, grossILS - ordinaryBase)
```

At the moment of sale, on a pro-rata share of the account:

```
ordinaryTax  = marginal income tax on ordinaryBase, STACKED on the sale year's
               other ordinary taxable income (salary + taxable pension)
capGainsTax  = appreciation * capGainsRate
```

So the grant-basis slice is priced with the real progressive brackets (`TAX_BRACKETS`, the same table
used for salary and pension), not a flat rate. Selling two grants in one year pushes the second slice
into higher brackets, exactly as a tax return would.

- **Currently vested shares** seed a virtual, per-grant **gross**-value account. Each grant also
  appears as a **computed (read-only) card on the Accounts page** — edit it via the Income page.
- **Future vests** (while working — i.e. before the retirement/FIRE age) use a share price grown at the
  grant's own expected-return assumption: `sharePrice * (1 + expectedGrowthPct/100)^k`. Their **gross**
  value is added to the grant account, which then compounds at that return (models "hold the shares").
  New vesting is bounded by each grant's own `[startAge, stopAge)` window (see the grants section below).
- **Reported balances are net of the deferred tax.** Net worth, liquid, and the FIRE-eligible pot all
  subtract the tax that would fall due if the account were sold in that year, so the plan is never
  flattered by money owed to the tax authority. Each projection row also carries `rsuDeferredTax`.
- Because the tax is no longer taken years early, the amount that would have gone to tax at vest keeps
  compounding until the sale — which is what actually happens when you hold Section-102 shares.

The per-grant `ordinaryTaxRate` field is now only a **fallback flat rate for the what-if switch tool**,
which compares holding vs switching at a horizon and has no modeled sale year to stack onto.

This is still a simplification: it does not model per-lot holding periods, the 24-month trustee holding
requirement, exact trustee mechanics, National Insurance / health tax on the ordinary slice, the 3%
surtax,
US-Israel treaty interactions, or partial sales.

## Spending

Monthly spend at a given age is resolved as:

Categories are organized into named **lists** (`spending.lists`; each category carries a `listId`).
The **active list** (`spending.activeListId`) drives projections and the tracker; a step-change can
switch the plan to a different list from a given age.

1. **Step override** — if any `steps[].fromAge <= age`, the latest one wins:
   - `mode = 'amount'` (default): `step.monthly * (1 + growthPct/100)^(age - step.fromAge)`.
   - `mode = 'list'`: the step selects `step.listId` as the category list from that age on
     (spending is then the sum of that list's active categories, rule 3).
2. Else if retired and `useHeadlineSpending = true` (opt-in on the FIRE tab):
   `fireMonthly * (1 + inflation)^(age - fireAge)`.
3. Else **sum of active categories of the list in force**. Amounts are **today's money**; if
   `inflate`, they grow from the *current age* forward: `monthly * (1 + growth)^(max(0, age - currentAge))`.

Annual spend = monthly × 12.

The expense tracker budgets against the **active list**; individual categories can be excluded from
one specific tracked month/year (`tracker.months[].excluded`) without touching the budget list.

## Salary & payroll (Israel, gross mode)

When `income.salaryMode === 'gross'`, net take-home and the pension/study-fund deposits are computed
from gross:

```
incomeTax   = max(0, brackets(gross×12)/12 − creditPoints × creditPointValue)
niHealth    = niReducedRate% × min(gross, threshold) + niFullRate% × clamp(gross−threshold, 0, ceiling−threshold)
empPension  = pensionEmployeePct% × pensionable
empKH       = khEmployeePct% × min(gross, khCeiling)
net         = gross − incomeTax − niHealth − empPension − empKH

pensionDeposit = (pensionEmployeePct + pensionEmployerPct + severancePct)% × pensionable
khDeposit      = (khEmployeePct + khEmployerPct)% × min(gross, khCeiling)
```

The computed pension/study-fund deposits replace those accounts' manual contributions during the
projection. Net take-home then grows by `salaryGrowthPct`. All rates are editable and are estimates
(this is not payroll advice).

## RSU / equity grants

`state.income.grants` is a list (zero, one, or many). Each grant is a virtual, computed equity account
holding **gross** share value plus a deferred Section-102 liability:

```
fx        = grant.currency === 'ILS' ? 1 : usdIls
gross     = shares × price × fx
ordinary  = shares × grantBasisUsd × fx      ← deferred; taxed at marginal rate on sale
apprec    = max(0, gross − ordinary)         ← taxed at capGainsRate on sale
```

- Already-vested shares (`vestedShares` at `sharePrice`) seed the account's balance.
- **Dated vesting schedule** (`grant.vests = [{date, shares}]`): when a grant has explicit vest
  events, each event vests its own share count on its own date (a grant can vest different amounts
  on different dates, past or future), priced at `sharePrice × (1 + expectedGrowthPct)^(yearsFromToday)`.
  Events dated **on or before the as-of date count as already vested** (they define the grant's
  current vested shares; the manual `vestedShares` field is ignored); future events vest on their
  date and stop at the retirement year. Dated events **replace** the flat model below entirely.
- Otherwise, new vests (`sharesPerYear`) are added each year while employed **and** within the grant's
  `[startAge, stopAge)` window, priced at `sharePrice × (1 + expectedGrowthPct)^k`. This lets you start a
  grant later, stop a grant early, or remove grants entirely (an empty list = no RSU).
- The account then compounds at the grant's `expectedGrowthPct`. Because the ordinary slice is pinned to
  grant-date value, all of that growth is capital gain. Selling pays both components at once (see the
  withdrawal model); the gross sale needed to deliver a given net amount is solved by bisection, since
  progressive brackets make the effective rate a function of the sale size.

## Pension income (Israeli rules)

`state.assumptions.pensionMode` selects how the pension is used after `pensionAccessAge`
(earliest 60 by law):

- **`annuity` (default):** each pension pot converts to a monthly קצבה = `pot / coefficient` at its
  access age, optionally CPI-linked. Tax follows the Israeli entitling-pension rules:
  ```
  exemptionPct(year) = statutory schedule when pensionExemptionAuto:      // Amendment 190, rescheduled
                       52% ≤2024 · 57% 2025 · 57.5% 2026 · 62.5% 2027 · 67% 2028+
  exemptMonthly  = age ≥ pensionExemptionFromAge (default 67, גיל הזכאות)
                     ? exemptionPct% × entitlingCeiling(inflated)
                     : 0            // an annuity drawn at 60 is fully taxable until 67
  taxableMonthly = max(0, grossMonthly − exemptMonthly)
  tax            = incomeTaxAnnual(taxableMonthly × 12)   // scaled brackets
  netMonthly     = grossMonthly − tax
  ```
  The projection applies this year by year, so the same annuity nets less before age 67 and more from
  the year the exemption kicks in. **Management fees** reduce the pot: a % is skimmed from every
  deposit (per-account `feeDeposit`, pension only) and an annual % from the balance (per-account
  `feeBalance`, pension and study-fund); legal caps 6% / 0.5%, state-selected default funds 1% / 0.22%.
  2026 reference figures: entitling ceiling ₪9,430/mo, coefficient ≈186–200 at 67 (higher when drawing
  at 60). All editable on the Pension page — estimate, not advice.
- **`lump` (היוון):** Israeli law only allows capitalizing the pot **above** the statutory minimum
  annuity (`pensionMinAnnuity`, קצבה מזערית ≈ ₪5,306/mo in 2026, CPI-indexed in the model):
  ```
  requiredPot = minAnnuity(inflated) × coefficient        // annuitized first (forced minimum annuity)
  lumpGross   = pot − requiredPot                          // 0 if the pot can't even fund the minimum
  exemptCap   = age ≥ exemptionFromAge ? exemptionPct% × ceiling(inflated) × 180 : 0
  tax         = incomeTaxAnnual(max(0, lumpGross − exemptCap))
  ```
  The net lump lands in the default liquid account; the forced minimum annuity pays out monthly like
  a regular annuity (with no further exemption if the lump consumed the exempt capital).

The tax is computed **once on the combined annuity** of all pension accounts — one exemption per
person, no matter how many pots pay it.

Not modeled: severance-vs-annuity trade-offs (רצף קצבה / the 1.35 offset formula), קצבה מוכרת,
survivor/disability insurance premiums inside the fund, and the comprehensive-fund 30%
assured-yield mechanism.

## Bituach Leumi old-age pension (קצבת אזרח ותיק)

Optional (`assumptions.oldAge`): a CPI-linked, untaxed income of `monthly` (today's ₪, default the
2026 single basic rate ₪1,838) from `fromAge` (default 70 — unconditional; from 67 it's
income-tested). Seniority increments (+2%/insured year up to +50%) and deferral bonuses are the
user's to fold into the amount.

## Real estate & mortgages

`state.realEstate.properties` appreciate at their own rate and may pay rent (own growth rate);
`state.realEstate.loans` amortize **monthly**, one row per Israeli track (מסלול):

| track | linkage | rate path |
|---|---|---|
| `fixed` (קל"צ) | none | constant |
| `fixed_cpi` (קבועה צמודה) | CPI (plan inflation) on principal | constant |
| `prime` (פריים) | none | drifts by `scenario.primeChangePp` linearly over `scenario.primeYears` |
| `var5` (משתנה צמודה) | CPI | +`scenario.resetStepPp` every 60 months |
| `var5ni` (משתנה לא צמודה) | none | +`scenario.resetStepPp` every 60 months |

Methods: `spitzer` (annuity — the payment is recomputed each month from the current balance, rate
and remaining term, which equals the classic constant payment for fixed unlinked loans and handles
rate changes/linkage correctly) or `equal` (קרן שווה — equal principal, declining payments). The
UI checks the Bank-of-Israel composition rule (≥⅓ fixed-rate, prime ≤⅔). Per projection year:

- **Equity** (Σ value − Σ remaining principal) is added to **net worth** — never to liquid or
  FIRE-eligible assets (the house can't fund spending in the model).
- **Rent** adds to income; **mortgage payments** add to outgoings
  (`net = income − spend − mortgagePay`).

No purchase/sale events, purchase tax, rental tax (up to the exemption ceiling this is roughly
right), or vacancy are modeled.

## Monte Carlo

`monteCarlo(state)` re-runs the projection `assumptions.mc.sims` times. Each run draws, per
**account type per year**, a return shock `N(0, vol_type)` added to the expected return (one shock
per type — all taxable accounts move together; grants' post-vest accounts shock as `rsu`). FX,
inflation, salary, spending, vest pricing, and property growth stay deterministic, so true risk is
somewhat understated. Outputs: success rate (share of paths surviving to `endAge`), net-worth
percentile bands per year (p10/p25/p50/p75/p90), the final-net-worth distribution, and the median
depletion age of failing paths. `safeFireAge(state, confidence)` finds the earliest retirement age
whose success rate meets the target confidence (200 paths per candidate age). A grant's vested
shares come from its dated schedule when it has one (events dated on/before the as-of date count as
vested; the manual `vestedShares` field is ignored).

## Coast & Barista FIRE

- `coastFireAge`: the earliest age `c` such that, if all saving stops at `c` (no contributions, no
  vests, no surplus — income assumed to exactly cover spending; balances only compound), retiring
  at the configured retirement age still survives to `endAge`.
- `baristaFireAge(monthly, untilAge)`: the earliest full-retirement age if a part-time net income
  (inflation-grown) continues from that age until `untilAge`.

## Withdrawals & capital-gains tax

When retirement spending exceeds income (salary + extra + net pension), the shortfall is withdrawn from
liquid accounts in the **configurable order** `assumptions.withdrawalOrder` (reorder it on the
Market & Assumptions page). Accounts with `includeInFire = false` are **never** drawn down (that money is
earmarked outside the FIRE plan). Selling from an account with unrealized gains pays capital-gains tax
on the gain portion, so the **gross sale exceeds the net cash delivered**:

```
gainFrac  = (value − basis) / value
effRate   = gainFrac × capGainsRate
grossSale = netNeeded / (1 − effRate)
tax       = grossSale − netNeeded
```

Cost basis is tracked per account (deposits raise basis; growth is unrealized). For taxable holdings the
basis can be entered directly or derived from the **gain vs buy value %** (`gainPct`) on the Accounts
page, so capital-gains tax applies to the gains only. Each row records the net withdrawn, the tax, and
the **source account/group** of the withdrawal.

Income-tax brackets used (annual, nominal ₪, ~2026, thresholds scaled by inflation in future years):
10% / 14% / 20% / 31% / 35% / 47% / 50%.

## FIRE targets

From the headline `fireMonthly`:

```
target(swr) = fireMonthly * 12 / (swr/100)
```

The dashboard shows targets at the configured SWR plus the classic 4% / 3.5% / 3% rules, and the
**coverage** = projected non-pension assets at retirement age ÷ target.

## Earliest retirement age

`earliestFireAge(state)` searches every candidate retirement age from the current age to the end age.
For each, it re-runs the projection with that retirement age and returns the **first age that survives** to
the end age (liquid never runs out before pension access; nothing depletes). It uses the actual
projected spending (categories/steps), so it reflects the plan you've modeled rather than the headline
`fireMonthly`.

## Known simplifications

- Single fixed return per account (no volatility / sequence-of-returns risk).
- Constant FX.
- Monthly stepping resolves *timing* within a year, not sub-monthly behaviour: a month is the smallest
  unit, and a flat `sharesPerYear` grant vests a twelfth each month rather than on a real quarterly
  schedule (use a dated vesting schedule for exact vest dates).
- Monte Carlo draws **one shock per account type per year** and applies it to all twelve months of that
  year, so it models year-to-year sequence risk, not month-to-month noise.
- Spending-category and extra-income `endAge` keeps its inclusive-whole-year meaning (`< endAge + 1`),
  so window *durations* are unchanged from the yearly model — only the month they start and stop moves
  onto the birthday.
- Capital-gains tax on taxable-account drawdowns is modeled on the **gain portion only** (basis from
  `costBasis`/`gainPct`); it does not model per-lot holding periods, loss harvesting, or the exact
  Israeli reporting rules.
- RSU Section-102 ordinary income is stacked on the sale year's **salary and taxable pension** only.
  In net salary mode the take-home figure is used as the stacking base (gross mode knows the real
  taxable base), which understates the bracket while still working.
- No capital-gains surtax: `capGainsRate` is flat, so it ignores the extra surtax on capital-source
  income above the top threshold.
- No Bituach Leumi / health tax modeling on income, including on the Section-102 ordinary slice (which
  is employment income in reality) or during early retirement.
- Pension drawdown treated as liquid from access age; annuity shown only as an estimate.

These are deliberate: the goal is a fast, transparent, tweakable planning tool, not a tax engine.
