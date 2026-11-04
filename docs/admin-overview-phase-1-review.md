# Zen Ledger Admin Overview — Phase 1 review and proposal

**Scope:** Admin Overview in frontend/src/main.tsx, for the owner/admin, accountant and sales manager. Inventory Overview was not selected as the target page. This is a proposal only; no application code has been changed.

## Verification boundary

I inspected the frontend component, the API route implementations and their calculation helpers. I did not connect to MongoDB or use live business data. The local .env contains a MongoDB Atlas URI whose database path is business_management_dev. That is not explicitly named production, but its isolation cannot be established from the URI alone; I treated it as untrusted and did not connect. Therefore, “verified” below means verified against current source/API logic, not reconciled against actual records. Phase 2 calculations should be tested with a clean isolated database or mongodb-memory-server before any runtime data review.

## 1. Existing Overview widgets and data accuracy

| Widget | Current source / fields | Assessment |
|---|---|---|
| Greeting, explanatory copy, New transaction | Static copy; click emits open-product | The action opens Add product. It is wrong for the label and is a context-breaking primary action. Rename it to Add product or route it to the intended transaction flow. |
| Sales billed today | GET /api/dashboard; sums legacy db.invoices where invoice.createdAt falls on business day; totals invoice.total | Not a reliable measure of sales today. It follows invoice creation date rather than the configured sales-count policy and the counted date (approved/dispatched). It can omit counted sales without an invoice and attribute late-created invoices to the wrong day. Use the canonical counted-order definition and label whether totals include GST. |
| Collected today | GET /api/dashboard; sums invoice.paid only for invoices created today | Incorrect for cash received today: it groups by invoice creation date, not paymentDate, and doesn’t explicitly require verified payments. The canonical overview already sums verified payments by paymentDate. |
| Outstanding dues | GET /api/dashboard; sums Customer.balance | A denormalized customer balance may be useful, but it is not reconciled here to counted orders less verified payments, and it has no age breakdown. The owner needs a receivable total from one documented definition, with unverified collections excluded and reconciliation tests. |
| Orders awaiting approval | GET /api/dashboard; counts orders with status Pending | Count is exact for Pending in this API snapshot. It omits amount, age, ready-to-dispatch, dispatched-but-undelivered and unverified collections, so it is not a complete action queue. |
| Inventory health bars | GET /api/dashboard fields products, lowStock, customers | “In stock” is computed as product count minus low-stock count; this is a count of SKUs, not units or stock value. Backend products/lowStock include archived records, and lowStock counts items with available <= reorder even where reorder is zero. “Customers count” is unrelated to inventory. “View orders” navigates to Orders rather than stock detail. |
| Quick actions | Add product, Review orders, New invoice, Add customer | The four destinations generally match their labels. “New invoice” opens a selector for eligible orders; that empty state should be clear if no order qualifies. The separate New transaction button is the mismatch. |
| Low stock list | GET /api/products, default page 1 / limit 50; frontend filters available <= reorder | The displayed rows are limited to the first 50 active finished goods and can omit later low-stock products. It does not cover raw materials/accessories. Loading, request failure and retry are absent; an empty list can be mistaken for a complete “all clear.” |
| Low stock grid semantics | Header and rows are div.tr elements in main.tsx | No table header/row/cell semantics. The trailing chevron is decorative and rows are not keyboard-operable links. Use a semantic table or labelled mobile cards with real drill-down buttons. |
| Global feedback and freshness | Dashboard request has no loading/error/retry state or updated time | Initial fallback zeros appear to be real data; failed requests have no visible recovery. Add per-widget skeletons, error + Retry, empty states and a last-updated timestamp. |

Relevant implementation sources: [frontend/src/main.tsx](../frontend/src/main.tsx), [backend/src/server.ts](../backend/src/server.ts), [backend/src/overview/routes.ts](../backend/src/overview/routes.ts), [frontend/src/admin/ui.tsx](../frontend/src/admin/ui.tsx).

### Existing backend data worth reusing

- GET /api/admin/overview?from=YYYY-MM-DD&to=YYYY-MM-DD already calculates sales/counting policy, previous-period values and deltas, sales/collection series, top five products, target summary, operation counts, low-stock and delayed alerts, receivables and unverified-payment summaries. It uses approved-or-later or dispatched-or-later dates according to business settings.
- GET /api/admin/insights already calculates GST-rate coverage, cost coverage, gross-profit-like results for costed sales, distributor rankings, salesman target performance, ageing buckets and inventory alerts. It explicitly returns null for missing cost/expense data in several places and marks its GST output estimated.
- GET /api/admin/bills/insights has paged bill rows, verified collections, due balances and ageing buckets. Its “age” is based on bill date because customer credit terms/due dates are not recorded; it is not true days-past-due.
- GET /api/inventory/overview, /api/inventory/alerts and /api/inventory/completeness expose stock value coverage, reorder suggestions, overdue purchase orders, production shortages and BOM/configuration checks.

Important limitation: these handlers currently call loadData(), which reads entire orders, customers, invoices and payments collections into application memory before calculating summaries. They bound returned alert/detail arrays but not the database work. They are a good source of business rules, not yet an efficient single-page dashboard implementation at scale.

## 2. CTO view: owner decision data

### Prioritized levels

**Level 1 — first screen, five KPIs**

1. Sales for the chosen period (Today / This week / This month / Custom) and percent change versus the immediately preceding equal-length period. Define sales by the configured counted-order policy; include “incl. GST” or “excl. GST (estimated)” in the label.
2. Verified collections received during the period, grouped by paymentDate, compared with the previous period.
3. Customer receivables outstanding now, with a short age summary (for example 0–30 / 31–60 / 60+ bill-age buckets) and a clear note that bill age is not days past due until due dates/credit terms are captured.
4. Orders requiring action, with the total split into approval, dispatch, delivery follow-up and payment verification. Count actionable work items, not a sum that double-counts an order and payment without explanation.
5. Stock alerts: low-stock and out-of-stock counts, with finished goods and raw materials/accessories distinguishable. Link the KPI to filtered stock details.

Gross profit should not displace a fully supported KPI yet. If shown on Level 1, label it “Estimated gross profit on costed sales,” show cost coverage beside it, and show “Not recorded” for expenses/overheads. Never present operating/net profit as gross profit or as zero.

**Level 2 — needs attention and trends**

- Put the actionable queue first: oldest Pending approval; approved/processing orders ready to dispatch; dispatched orders not delivered; unverified collections; low/out-of-stock items and reorder recommendation; overdue supplier POs; production orders past expected date; customer receivables by bill age; missing BOM/cost/GST configuration.
- Show daily sales and verified collection trend for the selected range, with previous-period series for comparison.
- Include production WIP count and delayed count, supplier payable due, stock value completeness, and a cost-coverage warning. Keep the user’s next action visible on each row.

**Level 3 — detail and analysis**

- Top products by counted sales value/units; top distributors by counted sales and open balance; salesman target versus achieved; receivable ageing detail; low-stock/reorder table; supplier bills/payables; WIP/late production table; data-quality detail.
- Paginate/filter detail lists on their respective pages. The overview should return a short, useful sample and totals, not every record.

### Keep / add / defer assessment

| Metric | Decision | Can current data support it? | Qualification |
|---|---|---|---|
| Sales today/week/month vs previous | Keep and correct | Yes, through COUNTED sales policy, countedDate, periodStats and previousRange | Use counted orders; current /api/dashboard invoice-created-date metric is not equivalent. Previous-period percent is undefined when comparison value is zero; show “No comparison,” not 0%. |
| Verified collections vs receivables | Keep and correct | Yes for verified payment sums and order-level due in overview/bills helpers | Unverified submissions must be separate. Customer.balance should be reconciled to canonical order due before it is used as the single source. |
| Receivable ageing 0–30 / 31–60 / 60+ | Add | Partly | Bill-age can be calculated from counted/bill date. True overdue ageing needs dueDate/payment terms; not currently reliable as “past due.” Label buckets “bill age” until terms exist. |
| Orders needing action | Add | Mostly | Statuses and unverified payments exist. Delivery follow-up and delay need an agreed SLA/expected-delivery date; dispatched-but-not-delivered count is available, but “late” may not be. |
| Low/reorder, out-of-stock | Add | Yes for finished goods and inventory items | Combine separate collections carefully; use available stock (on hand minus reserved) and consistent threshold rules. Do not count archived products. |
| Stock value | Add at Level 2/3 | Partly | Weighted-average cost exists. Unknown-cost stock is currently effectively omitted from the numeric sum; expose known-cost subtotal plus uncosted item count/coverage, and never imply it is a complete valuation. Define whether WIP is included. |
| Production in progress, WIP, delayed | Add | Mostly | Production statuses, stage progress and expectedDate exist. Confirm the business definition of active WIP and “delayed”; exclude completed/cancelled and use expectedDate consistently. |
| Supplier payables due | Add at Level 2 | Mostly | Supplier bills and payment statuses exist; dueDate is available for supplier-bill reporting. Missing due dates need a “due date not recorded” bucket, not an invented overdue date. |
| Gross profit/margin and cost coverage | Add with visible qualification | Partial / estimated | Current weighted-average product cost can estimate margin for costed lines. It is not historical cost-at-sale. Show “Estimated, costed sales only” and coverage; missing BOM/cost is not zero. Salaries and operating expenses are not recorded. |
| Top products/distributors/salesman target vs achieved | Add at Level 3 | Yes, with qualifications | Existing endpoint helpers provide these. Rank products/dealers consistently by counted sales; target achievement must use the same configured counting policy. |
| Missing BOM / GST / negative stock | Add as data-quality alerts | Partly | BOM and missing GST-rate/cost checks exist. Negative on-hand can be detected by a query but is not surfaced in the current overview; add it as an anomaly count and link to stock history. |

### Definitions to approve before implementation

- “Sales” follows the configured APPROVED or DISPATCHED policy. Pending, rejected and cancelled orders do not count. Display the policy in a compact explanatory hint.
- “Collections received” means VERIFIED payment records in the selected paymentDate range. UNVERIFIED collections are an action queue, not received cash.
- “Receivable” is counted order total less verified payments, floored at zero per order. Reconcile against customer ledger balances and handle overpayments explicitly.
- Age buckets use counted/bill date until customer credit terms and due dates are consistently captured. The UI must say “bill age,” not “overdue,” for this proxy.
- Gross profit shown from current avgCostPaise is an estimate for cost-covered lines only. Missing costs, BOM, salaries and expenses remain “Not recorded.”

## 3. UI/UX proposal

### Desktop wireframe

~~~text
┌──────────────────────────────────────────────────────────────────────────────────┐
│ ☰  Overview                     Today | This week | This month | Custom   ↻  Updated│
│     Sales policy: counted when approved                                           │
├──────────────────────────────────────────────────────────────────────────────────┤
│ [Sales ₹…  ↑/↓ vs prev] [Collected ₹… vs prev] [Receivables ₹…  60+ ₹…]          │
│ [Orders needing action …] [Low / out of stock …]                                 │
├──────────────────────────────────────────────────────────────────────────────────┤
│ NEEDS ATTENTION (highest priority)                   │ Sales & collections trend  │
│ • 4 orders awaiting approval · oldest 2d  [Review]   │ ── sales  ·· previous      │
│ • 2 ready to dispatch                  [Dispatch]     │ ── collections             │
│ • 3 collections to verify              [Verify]       │                            │
│ • 5 low-stock items · 1 out of stock   [Reorder]      │                            │
├──────────────────────────────────────────────────────────────────────────────────┤
│ Production: 8 active / 2 late │ Supplier bills: ₹… due │ Cost known for …% of sales │
├──────────────────────────────────────────────────────────────────────────────────┤
│ Top products / distributors / target progress / stock and payable detail tables  │
└──────────────────────────────────────────────────────────────────────────────────┘
~~~

Use one consistent KPI card: clear label, formatted value, explicit comparison period, arrow plus words (“up”/“down”), and an optional short sparkline. For money, use ₹ and Indian grouping; compact lakh/crore values should retain the exact amount in accessible text or a tooltip. Use DD/MM/YYYY in filters and detail rows. Avoid using green/red alone to convey status.

### Mobile wireframe (390px)

~~~text
┌──────────────────────────┐
│ ☰  Overview      ↻       │
│ This month  ▾   Updated   │
├──────────────────────────┤
│ Sales                    │
│ ₹…     ↑ 12% vs last mo. │
├──────────────────────────┤
│ Collected                │
│ ₹…     ↓ 4% vs last mo.  │
├──────────────────────────┤
│ Receivables              │
│ ₹…   31–60: ₹…  60+: ₹… │
├──────────────────────────┤
│ Orders needing action  9 │
│ 4 approvals       Review │
│ 2 dispatches      Open   │
│ 3 payments        Verify │
├──────────────────────────┤
│ Stock alerts  6     Open │
│ Trend chart (swipe/zoom) │
│ Production / Payables    │
│ Detail tables → pages    │
└──────────────────────────┘
~~~

On mobile, put a menu button in the top bar and open navigation as a labelled drawer; do not reserve a permanent 64px rail. Stack KPI cards, keep Needs attention above long charts/tables, and make table containers horizontally scrollable with a visible “Swipe to see columns” hint and sticky first column where practical.

### State, accessibility and interaction requirements

- Every widget has loading skeleton, meaningful empty state, and error state with Retry. Preserve previously loaded data while refreshing and mark it as updating.
- Header has selected date range, last successful update time and Refresh button. Do not show an update time for a failed refresh as if it succeeded.
- Entire KPI cards are buttons/links to filtered detail pages, with descriptive accessible names. Use visible focus rings and restore focus after dialogs.
- Use semantic tables (caption, thead, th scope, tbody) on desktop; use labelled cards or a scroll region on narrow screens.
- Target WCAG 2.1 AA: 4.5:1 for normal text, 3:1 for large text and meaningful non-text UI. Current dark --faint (#635C7D) on --bg (#08070C) is about 3.21:1; raise it (e.g. #8F88A5 is about 5.96:1) and verify all themes/state colors. Ensure statuses include icon and text, not color only.
- Ensure keyboard access for navigation drawer, date filter, refresh, every KPI, alert CTA, tables, and dialogs. Add aria-labels only where visible text does not already name the control; announce refresh errors/success politely.
- Consistent labels: choose “Distributor” for trade partners throughout owner-facing screens, or “Customer” if that is the preferred accounting term; do not mix them in adjacent areas.

## 4. Backend proposal

### Endpoint shape

Change/extend existing GET /api/admin/overview?from=…&to=… as the single Overview payload rather than adding another competing summary route. Preserve current permission checks. The payload should contain:

- period, previousPeriod, salesPolicy, generatedAt/lastUpdatedAt;
- KPIs with value, previousValue, deltaPct (nullable), and explicit estimate/coverage metadata;
- short trend arrays for sales and verified collections;
- needsAttention counts plus capped top 5–10 records per category with stable IDs and destination filters;
- bounded stock, production, supplier payable and data-quality summaries;
- explicit completeness: known stock value and uncosted counts, estimated gross profit and costed-sales coverage, GST-rate coverage;
- no fabricated zero for missing inputs: return null/status “not recorded” where unavailable.

Keep detail tables on existing paginated endpoints (Orders, Bills, Inventory reports, Production, Sales performance). Add or standardize filters rather than embedding full collections in the overview response.

### Aggregation plan

1. **Orders/sales:** apply the configured status policy; derive counted date from approvedAt/dispatchedAt (with the same fallback as countedDate); match selected and previous windows; group by day and sum order total/count. Use the same pipeline for KPI and chart to avoid definition drift.
2. **Payments:** match status VERIFIED and paymentDate range; group total/count by day and method. Separately match UNVERIFIED payments for the verification queue.
3. **Receivables:** match counted orders; aggregate verified payments by order ID; compute non-negative due per order and bucket by bill age. Because dueDate/terms are absent for customer bills, call this bill-age ageing until that data is added.
4. **Stock:** aggregate active finished products and active inventory items separately; calculate available = on-hand − reserved; count out-of-stock and below-reorder. Sum only rows with known avg cost and return uncosted count/coverage separately.
5. **Payables:** match supplier bills in POSTED/PARTIALLY_PAID; group total less posted payments and due-date age. Keep records without dueDate in a separate unknown-due-date count.
6. **Production:** group active statuses for WIP; separately count expectedDate < today and return top 5 late orders. Agree status/SLA definitions with the operations owner.
7. **Targets/products/distributors:** sum period sales by product, customer and salesman; apply targetProgress’s exact existing policy and cap results to top 5–10.
8. **Data quality:** count active products lacking BOM, missing GST rate/cost; query negative finished/raw stock; limit examples to a small number with links.

Add supporting indexes after inspecting existing indexes: orders by status and policy date field; payments by status/paymentDate/orderId; supplier bills by status/dueDate; inventory items/products by active status and stock fields; production by status/expectedDate; targets by status/type/date and salesman. Avoid loading all orders/payments/customers in Node for each dashboard request.

### Performance expectation

The target should be a bounded response (roughly under 200 KB) and an indexed aggregate path whose cost grows with matching records rather than transferring all documents to the app server. A reasonable initial target is p95 under 500 ms for a moderate deployment (up to ~100k orders and ~20k payments), but this is an engineering target, not a measured guarantee; validate with representative isolated data. If indexed aggregation is still too slow at larger volumes, add daily summary/materialized collections maintained by the existing mutation/event path. Use pagination/limits for detail and attention samples, not for KPI totals.

## Phase 1 recommendation

Proceed in Phase 2 by replacing the current Admin Overview’s /api/dashboard + /api/products data flow with the existing /api/admin/overview contract expanded for bounded stock/production/payables/completeness data. Preserve established calculation helpers, fix misleading labels and ranges, then test calculations against known isolated fixtures. Before inspecting runtime records, provide an isolated MongoDB test URI or use mongodb-memory-server; do not use the current remote URI until its isolation is confirmed.
