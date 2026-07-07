# 📊 Personal Finance & FIRE Planner

A **standalone, offline, interactive** personal-finance app for Israel. Several tools in one:

1. **💸 Budget / expense manager** — categories (monthly or yearly), growth, life-stage step-changes, totals.
2. **📊 Portfolio & allocation manager** — every account (cash, money market, brokerage, study fund,
   pension, equity grants) in ILS or USD, with allocation pies by account and by type.
3. **🧾 Salary & tax** — enter **gross** salary and it computes net take-home plus your pension and
   Keren Hishtalmut deposits via Israeli payroll rules (or enter net directly).
4. **👵 Pension** — Israeli קצבה modeling with tax exemption, management fees, and drawdown.
5. **🔥 FIRE / retirement projection** — year-by-year net worth to age 80, earliest-FIRE age, survival.

Open `index.html` in any modern browser — no server, no build step, no external dependencies, no data
leaves your machine.

Tailored for Israel (shekel salary, Keren Hishtalmut, Section-102 RSUs, pension locked until 60), but
**fully general**: every number is editable and you can add/remove any account or income/spending
stream. Use it purely for **budgeting** or **portfolio tracking** even if early retirement isn't your goal.

> ⚠️ **Not financial advice.** This is an educational model. Verify everything with a licensed
> professional and your official statements.

---

## Quick start

```bash
# Just open it — it runs from file://
xdg-open index.html    # Linux
open index.html        # macOS
# or double-click index.html
```

Optional (only needed for the "Load sample plan" button, because some browsers block `fetch()` on `file://`):

```bash
cd fire-planner
python3 -m http.server 8000
# visit http://localhost:8000
```

Everything else — including **Save to file** and **Load from file** — works fine directly from `file://`.

---

## Features

- **Fully interactive** — sliders + number inputs for every parameter; the whole plan recalculates live.
- **Dark mode** — one-click theme toggle, saved with your plan.
- **Multi-page UI**, one page per purpose:
  - **📊 Dashboard** — headline metrics, net-worth-to-80 chart, allocation doughnut, liquid-vs-pension, FIRE target coverage.
  - **🏦 Accounts** — every pot of money as **individually-controllable cards grouped** by category; edit balance / return prediction / contributions / notes; **add or remove** pensions, brokerage accounts, cash, study funds, RSU/equity, or custom accounts. RSU shows as a computed card so nothing is double-counted.
  - **⚙️ Market & Assumptions** — USD/ILS, AMZN price, inflation, safe withdrawal rate, per-type expected returns, ages, pension annuity coefficient, real/nominal toggle, plus a returns-sensitivity chart.
  - **💰 Income** — salary + growth, full RSU (Section-102 capital-gains) modeling, arbitrary extra income streams, and **surplus allocation rules** (route savings to chosen accounts by % or ₪/month, rest to a default).
  - **🛒 Spending** — break spending into **categories** (each with its own growth and age window) and set **step-changes** at specific ages (differential spending). Pie + projection chart.
  - **📈 Projections** — **year-by-year table of every entity to age 80**, stacked chart of all accounts over time, income-vs-spending, CSV export.
  - **💾 Save / Load** — export/import your plan as a `.json` file (your "database"); autosaves to browser `localStorage`.
- **Differential income & spending** — e.g. salary +1%/yr while spending +2%/yr; or "from age 31, monthly spend jumps to ₪13,000".
- **Charts** — line, bar, stacked bar, and pie/doughnut, all rendered with a tiny built-in canvas library (zero dependencies) with hover tooltips.
- **Save state like a DB** — a portable JSON file you can version, back up, or share.

---

## Repository layout

```
fire-planner/
├── index.html            # entry point (loads css + js)
├── css/
│   └── styles.css
├── js/
│   ├── state.js           # data model, defaults, persistence, import/export
│   ├── charts.js          # zero-dependency canvas charts (line/bar/pie)
│   ├── engine.js          # year-by-year projection engine (pure functions)
│   ├── live.js            # optional live data (USD/ILS + stock quotes) on button press
│   ├── ui.js              # pages, controls, tables, chart wiring
│   └── app.js             # init, routing, delegated event handling
├── data/
│   └── sample-state.json  # example plan (Load sample plan)
├── docs/
│   ├── MODEL.md           # the math & assumptions in detail
│   └── USAGE.md           # how to use each page
├── LICENSE                # MIT + not-advice disclaimer
├── CHANGELOG.md
└── README.md
```

## Architecture notes

- **No modules / no bundler.** Scripts are classic `<script>` tags so the app runs from `file://`
  (ES modules would trigger CORS errors there). Everything hangs off a single global `FIRE` namespace.
- **Separation of concerns:** `engine.js` is pure (no DOM) and unit-testable in Node; `ui.js` only renders;
  `app.js` wires events; `state.js` owns persistence.
- **Persistence:** autosave to `localStorage` on every change, plus explicit JSON export/import.

See **[docs/MODEL.md](docs/MODEL.md)** for the calculation details and **[docs/USAGE.md](docs/USAGE.md)** for a page-by-page guide.

---

## Ideas / roadmap

- Multiple named scenarios side-by-side (baseline vs aggressive vs conservative).
- Monte-Carlo / historical-sequence simulation instead of a single fixed return.
- FX drift for USD accounts (currently constant USD/ILS across the projection).
- Tax-aware withdrawals (capital-gains tax on taxable-account drawdowns).
- Per-scenario notes and a printable one-page summary.

Contributions welcome — it's a single-folder static app, easy to hack on.
