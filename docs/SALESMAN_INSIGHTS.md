# Salesman Insights

One page for the salesman that shows how their business is doing: a one-sentence summary, a target ladder, a sales-vs-target chart, top products and customers, health cards, and three things to do this week.

## Where it lives
- **Salesman app tab "Insights"** (`salesman.html#insights`). It sits between Dashboard and Catalogue.
- The old `#targets`, `#target` and `#performance` links redirect to `#insights`.
- The salesman Dashboard's "My targets" cards moved into Insights (bottom card: "All my targets in this period"). The Dashboard now shows a one-line target summary with an "Open Insights" button.
- The admin **Targets** and **Performance** pages are unchanged. Admins still set targets there.

## Backend: `GET /api/sales/me/insights?from=YYYY-MM-DD&to=YYYY-MM-DD[&format=csv]`
- Requires the `sales.self` permission and only returns the signed-in salesman's own data. Other roles get 403.
- **One definition per number:** it reuses `metricsFor`, `targetProgress` and `COUNTED[policy]`. These are the same functions behind `/api/sales/me/dashboard`, `/api/targets` and `/api/sales/performance`. A test checks that `metrics` equals the dashboard's `thisMonth` exactly.
- Comparison period: month-to-date compares with the same days of last month, year-to-date with the same span last year, and anything else with the same number of days just before.
- Chart granularity: 1 day → by hour, up to 62 days → by day, longer → by month.
- `format=csv` powers the Export button (it reuses `downloadCsv`).

## Data used
| Card | Fields |
|---|---|
| Summary / ladder | `salesPaise`, `countedOrders`, previous-period `salesPaise`, the active `SALES_AMOUNT` target that overlaps the period (pro-rated to the period), `progress.achieved/remaining/daysLeft` |
| Chart | counted orders bucketed by `approvedAt`/`dispatchedAt` (per the sales policy); target pace = target ÷ target days |
| Splits | verified payments by `method` (cash vs UPI/bank/card vs cheque/other); buyers new vs repeat (first counted order before or within the period) |
| Products / customers | lines of counted orders in the period (qty, value) |
| Customers card | repeat %, new vs repeat, "slipping away" = customers with no counted order in 45+ days (`SLIP_DAYS` in `sales/routes.ts`) |
| Dues card | as of today, same formula as `outstandingPaise`; split ≤30 / >30 days since dispatch; oldest due |
| Data complete % | share of this period's orders and collections that are not still pending approval or verification |

## Placeholders and fallbacks (no data source yet)
- **Profit quadrant:** replaced by "Top products by sales". Product cost is deliberately never sent to salesmen, and a test enforces this.
- **Returns/discounts row and incentive row:** not shown. There's no returns/discount ledger and no incentive rules.
- **Visits / coverage:** "Coming soon" card. Visits aren't recorded.
- **My rank:** "Not available" card. Team data isn't shared with salesmen.
- **Hindi:** no translations yet, so it falls back to English. Bengali is complete (`src/insights/strings.ts`).

## Files
`frontend/src/insights/`: `InsightsPage` (lazy-loaded), `SummaryCard`, `TargetLadder`, `SalesTargetChart`, `SplitBar`, `TopProductsChart`, `RankedTable`, `MiniCard`, `ActionList`, `TargetList`, `derive.ts` (pure calculations), `period.ts`, `useI.tsx` (translation with `{placeholders}`), `strings.ts`, `insights.css`. New tokens (`--iv-ac2`, `--iv-cy`, `--iv-surface`, `--iv-hero`, `--iv-mono`, `--iv-bn`) are in `inventory/inventory.css` for both dark and light themes.
