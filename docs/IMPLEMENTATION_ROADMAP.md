# Implementation Roadmap

**Status:** Awaiting approval. Nothing below has been started.
This supersedes `docs/implementation-roadmap.md` (older, lowercase file, kept unchanged for history).

Each phase ends with a gate:
- typecheck, lint and build pass
- unit and integration tests for the phase pass against an **isolated local database** (never Atlas)
- browser check at 1440 px and 390 px
- a phase report covering functionality, files, DB changes, API changes, test output, known issues and remaining work

If a gate has a failing critical test, the next phase does not start.

---

## Decisions I need from you

| # | Decision | Options | My recommendation |
|---|---|---|---|
| D1 | **Which codebase** | A: extend the legacy Mongo app here · B: continue `../Zen-Ledger-rebuild` (Postgres), importing Mongo data | **A, built on the café Inventory V3 pattern** (updated after your instruction). Please confirm "here" means this Mongo project. |
| D9 | Target material-cost % / margin and count interval | Your numbers; V3's café defaults (35%, 4 days) don't apply to almirahs | Left blank until you set them. Screens show "not set". |
| D2 | Whose catalogues are these? | Is the business Steel Raj (Liluah, Howrah), or a dealer selling Steel Raj + FM/Luxury/SDH designs? Do you have rights to use the PDF images? | Needed before importing images to Cloudinary |
| D3 | Design ↔ body compatibility | Any design on any body, or restricted per series? | Affects variant creation (inventory doc §4) |
| D4 | When a sale counts toward targets | Dispatch (recommended) · Invoice paid · Delivery | Dispatch |
| D5 | Accountant default permissions | Table in salesman doc §1 | Accept the defaults; adjust later in Settings |
| D6 | Cloudinary account | Provide cloud name / key / **rotated** secret in the server env yourself. I will never put them in code or chat. | — |
| D7 | Prices, costs, GST rate, BOM quantities | Must come from you. The PDFs have none. | Use a price list spreadsheet; I'll build the import |
| D8 | Product types absent from the PDFs (office cabinet, locker, glass-door) | Create or not | Not until you confirm the business sells them |

---

## Phase 0: Safety (both options, ~0.5 day)

1. You rotate the Atlas password. I then remove `backend/.env.example` credentials and give you the history-purge commands. I don't run them; rewriting history needs your approval.
2. Local env isolation: tests and dev never load a production URI. Add a guard that refuses non-local DB hosts outside production.
3. Remove the production auto-seed of `owner@example.com` and fake customers.
4. Make the backend tests runnable (add `vitest`, fix env-before-import) and run them.

**Phase 0-A (option A only, ~3–4 days).** Replace the load-all/rewrite-all repository with per-entity Mongoose access:
- atomic `$inc` with guards inside `withTransaction`
- unique idempotency indexes
- fix ERP route order (behind helmet/CORS/rate limit), claims validation and mass assignment
- add the missing `User.phone` field and fix the `/api/me` shape bug
- every existing endpoint keeps its path and response shape, and the existing 12 API tests must pass

The data migration is non-destructive: new collections are written alongside the old ones and verified on a copy before cutover. It needs your approval and a backup (Atlas snapshot + `mongodump`).

**Option B instead:** verify the rebuild's claimed state by running its lint, typecheck, tests and E2E, and report the actual results.

## Inventory delivery in café-V3 style (option A)

Inventory goes behind `INVENTORY_V3_ENABLED`, a runtime setting and `VITE_INVENTORY_V3`. The current pages stay intact and selectable throughout. Collections are created only by the manual setup script (dry-run first), and only against a staging database before Atlas.

| Step | Contents | Can start before Phase 0-A? |
|---|---|---|
| V3-P1 Foundation | Calculation module (paise, micros, units incl. sheet↔kg, null-aware costs, `CALCULATION_VERSION`), companion schemas, settings + capabilities endpoints, `transact()` wrapper, setup script, feature flags, tests without a DB | Yes |
| V3-P2 Stock + suppliers | Suppliers, raw materials with opening stock via ledger, product models + designs seeded from your PDFs (names/specs only), finished-goods companion config, Stock and Suppliers tabs | Yes for raw materials and suppliers; **finished-goods stock writes need 0-A** |
| V3-P3 Purchases + expenses | PO → approval → GRN (partial) with Cloudinary bill photo, returns, supplier payables/settlement, factory expenses + recurring rules | Yes |
| V3-P4 BOM, production, counts, losses | Versioned BOM with cost preview, production orders (reserve → consume → output), count sessions with watermark approval, scrap/damage/defect records, adjustments with approval | Needs 0-A (output writes `products`) |
| V3-P5 Overview | Valuation, spend by group, days of material left, material-cost % vs target, "Needs attention" checklist, switch-back link to the old pages | Needs 0-A |

These map onto your phases 3–7 in the table below.

## Phases mapped to your 15

| Your phase | Deliverables | Key tests |
|---|---|---|
| 1–2 Audit + architecture | **These four documents** (done) | — |
| 3 Suppliers + raw materials | Supplier CRUD/ledger view, material CRUD with units/conversions/min-max/location, opening stock via ledger | unit conversion, duplicate code, opening stock writes ledger |
| 4 Purchases + GRN | PO states, approval, GRN (partial), purchase return, supplier payments, payable ledger | stock unchanged by PO; GRN increases once (retry idempotent); partial receipts; over-receipt blocked; return can't go negative |
| 5 Product catalogue + Cloudinary | ProductModel/Design/Variant, migration of existing products to variants (ids kept), Cloudinary upload/replace/delete, PDF crop + review + import tool, grid/list/filters/paging, product detail | secret never in bundle (grep build); file type/size rejected; salesman payload has no cost |
| 6 BOM + production | Versioned BOM with wastage and cost estimate, production order states, reservation, completion with consumption/wastage/output | shortage blocks reservation; double-complete deducts once; cancel releases; finished goods only on completion; cost math |
| 7 Ledger, adjustments, wastage, alerts | Unified ledger view, reversal, adjustment requests + approval, wastage reports, alert list, inventory dashboard + charts | reversal once only; negative prevented under 20 concurrent requests; self-approval blocked |
| 8 Salesman accounts | Single management page for Admin + Accountant, profile fields, temp password + forced change, reset, deactivate, customer/category assignment; remove the duplicate pages | accountant can create; accountant cannot reset (default); duplicate phone/employeeId rejected; deactivated user's token rejected |
| 9 Salesman mobile app | Dashboard (targets, orders by status, collections, customers, activity), catalogue with images/variants, sticky cart, own orders timeline, field collection entry | salesman sees only own data; price not editable; 390 px layout |
| 10 Activity monitoring | Event writes in all transactions, admin dashboard + filters, per-salesman timeline and performance page | event exists only when action committed; correct actor; salesman can't read others |
| 11 Targets | Target CRUD with revisions, six types, progress per §4.2 policy, admin and salesman views | rejected/cancelled/draft don't count; returns reduce; zero target; >100%; history preserved |
| 12 Accountant permissions + finance | Permission matrix + Admin grant UI, payment verify/void, receivables/payables views | every route returns 403 without permission (generated test over the route table) |
| 13 Business overview + reports | Sales/inventory/manufacturing/finance/salesman sections, date filters, CSV/Excel export; P&L shown only when costs and expenses for the period are complete, otherwise labelled "incomplete" | report totals equal sums of source records in seeded tests |
| 14 Integration + security | Full workflow E2E, authorization sweep, dependency audit, secret scan | — |
| 15 UI/UX + E2E | Consistency pass, empty/loading/error states, accessibility check, final walkthrough report | — |

**Suggested navigation** (inside the existing admin shell, with role-filtered menus; the server still enforces access):
- Dashboard
- Business Overview
- Inventory: Dashboard, Suppliers, Raw Materials, Products, Purchases, Goods Receipts, Returns, BOM, Production, Stock Ledger, Adjustments & Wastage, Alerts
- Sales: Salesmen, Customers, Orders, Dispatch, Collections
- Performance: Activity, Targets, Sales Performance
- Accounts: Payments, Receivables, Payables, Expenses, Reports
- Settings

## Rough effort (one developer)

| | Option A | Option B |
|---|---|---|
| Phase 0 | 3–5 days | 0.5–1 day (verification) |
| Phases 3–7 inventory/manufacturing | 12–15 days | 7–9 days (extends existing models) |
| Phases 8–12 sales/targets/activity/permissions | 10–12 days | 8–10 days |
| Phases 13–15 | 6–8 days | 5–7 days |
| Data migration from Mongo | none | 2–3 days (already planned as rebuild Phase G) |

These are estimates, not commitments. They depend on D2–D7.

## Rules I will follow throughout

- No commits, pushes or deploys without your explicit approval.
- No contact with the production database. Destructive migrations only with your approval and a verified backup.
- No fake statistics or fake performance records. Demo data is used only in local/test databases and is clearly marked.
- Tests are reported as passed only when I have actually run them.
