# The Model — math & assumptions

This document explains exactly what `js/engine.js` computes. It is intentionally a **simplified**
deterministic model. It is **not** tax advice and does not attempt to reproduce Israeli tax law precisely.

## Units & currency

- All internal math is in **nominal ILS**.
- USD accounts are converted at a **constant** `market.usdIls` for the whole projection (no FX drift).
- A **real mode** toggle divides displayed values by `(1 + inflation)^years` to show today's ₪.

## Time axis

- Projection runs yearly from `round(profile.currentAge)` to `profile.endAge` (default 80).
- "Working" years are ages `< profile.fireAge`; "retired" years are `>= fireAge`.

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

Given `sharesPerYear`, `grantBasisUsd`, `ordinaryTaxRate`, `capGainsRate`:

```
grossILS     = shares * sharePrice * usdIls
ordinaryBase = shares * grantBasisUsd * usdIls
appreciation = max(0, grossILS - ordinaryBase)
tax          = ordinaryBase * ordinaryTaxRate + appreciation * capGainsRate
netILS       = grossILS - tax
```

- **Currently vested shares** seed a virtual, per-grant net-value account. Each grant also appears as a
  **computed (read-only) card on the Accounts page** — edit it via the Income page.
- **Future vests** (while working — i.e. before the retirement/FIRE age) use a share price grown at the
  grant's own expected-return assumption: `sharePrice * (1 + expectedGrowthPct/100)^k`. Their after-tax
  value is added to the grant account, which then compounds at that return (models "hold the shares").
  New vesting is bounded by each grant's own `[startAge, stopAge)` window (see the grants section below).

This is a simplification: it does not model per-lot holding periods, exact trustee rules, the 3% surtax,
US-Israel treaty interactions, or partial sales.

## Spending

Monthly spend at a given age is resolved as:

1. **Step override** — if any `steps[].fromAge <= age`, use the latest one:
   `step.monthly * (1 + growthPct/100)^(age - step.fromAge)`.
2. Else if retired and `useHeadlineSpending = true` (opt-in on the FIRE tab):
   `fireMonthly * (1 + inflation)^(age - fireAge)`.
3. Else **sum of active categories**. Amounts are **today's money**; if `inflate`, they grow from the
   *current age* forward: `monthly * (1 + growth)^(max(0, age - currentAge))`.

Annual spend = monthly × 12.

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

`state.income.grants` is a list (zero, one, or many). Each grant is a virtual, computed equity account:

```
fx        = grant.currency === 'ILS' ? 1 : usdIls
gross     = shares × price × fx
ordinary  = shares × grantBasisUsd × fx
tax       = ordinary × ordinaryTaxRate + max(0, gross − ordinary) × capGainsRate
net       = gross − tax
```

- Already-vested shares (`vestedShares` at `sharePrice`) seed the account's balance.
- New vests (`sharesPerYear`) are added each year while employed **and** within the grant's
  `[startAge, stopAge)` window, priced at `sharePrice × (1 + expectedGrowthPct)^k`. This lets you start a
  grant later, stop a grant early, or remove grants entirely (an empty list = no RSU).
- The account then compounds at the grant's `expectedGrowthPct`; selling it later pays capital-gains tax
  on the appreciation (per the withdrawal model).

## Pension income (Israeli rules)

`state.assumptions.pensionMode` selects how the pension is used after `pensionAccessAge`:

- **`annuity` (default):** each pension pot converts to a monthly קצבה = `pot / coefficient` at its
  access age, optionally CPI-linked. Tax follows the Israeli entitling-pension rules:
  ```
  exemptMonthly  = exemptionPct% × entitlingCeiling(inflated to access year)
  taxableMonthly = max(0, grossMonthly − exemptMonthly)
  tax            = incomeTaxAnnual(taxableMonthly × 12)   // scaled brackets
  netMonthly     = grossMonthly − tax
  ```
  The pot is drawn down as it pays the gross annuity; net pension is added to retirement income.
  **Management fees** reduce the pot: a % is skimmed from every deposit (per-account `feeDeposit`,
  pension only) and an annual % from the balance (per-account `feeBalance`, pension and study-fund).
  These are edited on the Accounts page.
  Public reference figures: entitling ceiling ≈ ₪9,430/mo, exempt portion ~52% (was slated to reach
  67%), coefficient ~200–220. All are editable on the Pension page — this is an estimate, not advice.
- **`lump`:** the pot becomes drawable at the access age and is withdrawn to fund spending like any
  other liquid account (no annuity).

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
- Capital-gains tax on taxable-account drawdowns is modeled on the **gain portion only** (basis from
  `costBasis`/`gainPct`); it does not model per-lot holding periods, loss harvesting, or the exact
  Israeli reporting rules.
- No Bituach Leumi / health tax modeling on income.
- Pension drawdown treated as liquid from access age; annuity shown only as an estimate.

These are deliberate: the goal is a fast, transparent, tweakable planning tool, not a tax engine.
