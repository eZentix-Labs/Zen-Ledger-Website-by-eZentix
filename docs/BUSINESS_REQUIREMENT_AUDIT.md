# Business Requirement Audit

**Date:** 2026-11-03
**Scope:** `D:\Business-Management-System\Zen-Ledger-Website-by-eZentix` (branch `main` @ `b2e43a1` plus the uncommitted working tree), the four reference PDFs in `resorce/`, and a read-only look at the sibling worktree `D:\Business-Management-System\Zen-Ledger-rebuild` (branch `feature/rebuild`).
**Method:** Read-only. I read every backend and frontend source file, type-checked both apps, built the frontend into a scratch folder, read the existing OCR output and inspected rendered PDF pages. I did **not** run the backend or its tests. The reason is in §7. No database was contacted.

Related documents: `INVENTORY_ARCHITECTURE.md`, `SALESMAN_TARGET_ARCHITECTURE.md`, `IMPLEMENTATION_ROADMAP.md`. This builds on the earlier `docs/AUDIT.md` (same date). I re-checked its key claims against the code but did not repeat its runtime experiments.

---

## 0. Decision needed before any implementation

**There are two codebases, and they point in opposite directions.**

| | A. Legacy app (this folder) | B. Rebuild (`../Zen-Ledger-rebuild`, branch `feature/rebuild`) |
|---|---|---|
| Database | MongoDB (Atlas) via Mongoose | PostgreSQL 17 via Prisma |
| Size | ~120 KB of source in 11 backend and 11 frontend files, written as very long single lines | 32 tables, layered modules, shared money/GST package |
| Inventory/ERP | Disconnected stubs (§3) | Suppliers, purchases, raw materials + ledger, recipes, production runs, stock ledger, billing, receipts, sales orders, monthly targets, expenses, audit log (schema present; Phase B API + admin screens committed today) |
| Tests | 12 API tests that are not runnable as configured (§7) | Its commit log reports 98 unit/integration tests + 15 E2E. **I have not re-run these.** |
| Fits your prompt's rule "reuse the existing MongoDB" | Yes | **No.** Following B means approving an exception to that rule. |

> **Update (same day):** You asked for this project's inventory to be built like the café project's **Inventory V3** (`D:\Adds_cafe\Restaurant-Management-System`, branch `feature/inventory-v3`), using your real almirah data. V3 is a MongoDB design: companion collections, idempotent transactions and feature switches with rollback. It ports directly to this codebase and delivers the integrity guarantees that were my main reason for preferring B. **I now recommend option A built on the V3 pattern** (see `INVENTORY_ARCHITECTURE.md` §0). Phase 0-A (atomic writes for the legacy core) is still mandatory first. Please confirm that "here" means this Mongo project and not the rebuild.

*Original recommendation, kept for the record:* **My recommendation is B.** Your prompt says not to create a new project, so I'm stating this plainly. My reasons:

1. The legacy persistence layer keeps the whole database in memory. On **every** write it deletes and re-inserts every collection (`backend/src/repository.ts:47-50`). Transaction-safe, idempotent inventory (prompt §11) can't be built on top of that. Under option A, Phase 0 replaces it under every route, which amounts to a rebuild anyway.
2. B already contains roughly 60–70% of the entities your prompt lists, with integrity rules: integer paise, CHECK constraints, append-only ledgers.
3. Nothing in A's data needs to be lost. B plans a read-only Mongo export and import (its Phase G).

**Option A is viable if you prefer Mongo.** Atlas clusters are replica sets, so multi-document transactions *are* available, even though the code comment in `repository.ts:45` says otherwise. Phase 0 of the roadmap then becomes "replace the persistence layer with per-document atomic updates inside transactions".

The architecture documents describe the domain (entities, state machines, rules, calculations) independently of the database. Where it matters, each one maps the design to both A and B.

Other decisions are listed at the end of `IMPLEMENTATION_ROADMAP.md`.

---

## 1. Immediate security actions (independent of the decision)

1. **A real MongoDB Atlas username and password are committed to git** in `backend/.env.example` (tracked file). Rotate the Atlas password, then purge the file from history. Deleting the file does not remove it from history.
2. `backend/.env` and the root `.env` set `NODE_ENV=production` + `PERSISTENCE=mongo` + the Atlas URI. Running `npm run dev` or the tests locally therefore targets the real cluster (see §7).
3. On an **empty** database, `MongoRepository.load` seeds `owner@example.com / ChangeMe123!` plus two fake customers with fake balances, **in production as well** (`repository.ts:41,70`). That is a known default admin password, and it is fake financial data.
4. Your prompt mentions a "newly rotated Cloudinary API secret". No Cloudinary configuration exists anywhere in either codebase, so nothing has leaked from the code. Please confirm the old secret was rotated wherever it was exposed.

---

## 2. Reference PDFs (`resorce/` — note the spelling; there is no `resources/` folder)

All four PDFs are image-only. OCR output from an earlier session is in `tmp/pdfs/ocr-*.json`. I verified pages visually from `tmp/pdfs/*.png`.

| File | Pages | What it actually contains |
|---|---:|---|
| `STEEL RAJ CATALOG1.pdf` | 6 | Brand "STEEL RAJ — Bond of Happiness", Bhattanagar, Liluah, Howrah 711203, steelrajalmirah.com. *"Manufacturer of Powder coated Steel Almirah with Hot Phospheting."* **8 body models with specifications** and **16 door-print designs (SRH-xx)**. |
| `FM 901-1000.pdf` | 100 | "PREMIUM DESIGN" door prints FM901–FM1000, each shown on a 1-door and a 2-door body. |
| `Luxury photo 01-100.pdf` | 100 | "Luxury Photo" front designs NO-01…NO-100, rendered as finished almirahs. OCR found no code on pages 29, 30, 48, 68, 69 and 70; those pages need a visual check. |
| `SDH-100.pdf` | 100 | SDH-01…SDH-100 print designs rendered on a 3-door almirah body. |

### 2.1 Steel Raj body models (verified from page images)

| Model | H × W × D (inches) | Listed features |
|---|---|---|
| Heavy 3 | 78 × 54 × 20 | Panel door, shelve-chamber, 1 locker, E.D.D quality sheet, churi stand, light, Maruti lock, 7-tank treatment, hot phosphating |
| Eco 2 | 78 × 34 × 20 | Panel door, shelve-chamber, 1 locker, churi stand, light, Maruti lock, 7-tank, hot phosphating (**no** E.D.D sheet listed) |
| Classic 2 | 78 × 37 × 20 | As Eco 2 |
| Classic 3 | 78 × 48 × 20 | Shelve-chamber, 1 locker, E.D.D sheet, churi stand, light, Maruti lock, 7-tank, hot phosphating (no "panel door" listed) |
| Eco 3 | 78 × 48 × 20 | Panel door, shelve-chamber, 1 locker, E.D.D sheet, churi stand, light, Maruti lock, 7-tank, hot phosphating |
| Classic SPL 2 | 78 × 37 × 20 | Panel door, **2 drawers**, 1 locker, E.D.D sheet, churi stand, light, Maruti lock, 7-tank, hot phosphating |
| Premium 2(L) | 78 × 42 × 20 | Panel door, 1 back chamber, 1 locker + 1 drawer, E.D.D sheet, churi stand, light, Maruti lock, 7-tank, hot phosphating |
| Premium 2 | 78 × 42 × 20 | Panel door, 2 drawers, 1 locker + 1 back chamber, E.D.D sheet, churi stand, light, Maruti lock, 7-tank, hot phosphating |

The numeric suffix (2/3) *probably* means door count; Heavy 3 is shown with three internal sections. **To confirm with you.**

### 2.2 What the PDFs do **not** contain

There are no prices, costs, GST rates, weights, colour names, gauge/thickness values, stock levels, or raw-material quantities. **Every BOM quantity and every price must come from you.** I will not invent them.

### 2.3 What the PDFs tell us about manufacturing (usable as raw-material *categories*, not quantities)

- Steel sheet ("E.D.D quality sheet", where E.D.D = extra deep drawing grade).
- Surface treatment: 7-tank pre-treatment chemicals, hot phosphating, powder coating.
- Hardware: Maruti locks, churi (bangle) stand, internal light, drawers, locker unit, hinges and handles (visible in photos).
- Decorative door print/laminate panels: SRH, FM, Luxury Photo and SDH codes.

### 2.4 Product modelling consequence

The catalogues describe **body model × door design**. A sellable item is, for example, *Eco 2 body with SRH-52 print*. The current `backend/src/catalog.ts` (uncommitted) instead creates **316 separate products**, all with price 0 and stock 0. The 16 SRH entries are treated as standalone products, and the 8 body models appear as products with no designs. That must be re-modelled before import (see `INVENTORY_ARCHITECTURE.md` §4).

### 2.5 Product imagery

The PDFs contain about 300 high-quality, on-brand almirah renders. These are the right "demo" images. They are better than stock photos because they show the products the business actually sells. The PDFs contain **no** office cabinets, lockers or glass-door cabinets. I recommend not creating those categories unless you confirm the business sells them.

---

## 3. What exists today (legacy app, option A)

### 3.1 Stack

- Express + Mongoose + zod + JWT (bcrypt).
- React 19 + Vite, with no component library and no router usage (state-switched pages).
- Deployed as Render (API) + Vercel (web).
- All dependencies are pinned to `"latest"`.

### 3.2 Data models

| Collection (`models.ts`) | Used by the app | Notes |
|---|---|---|
| User | Yes | Roles `owner/accounts/salesman`. The schema has **no `phone` field**, so phone is dropped on save to Mongo. Salesman login still works through the synthetic `<phone>@phone.local` email. No active flag. |
| Product | Yes | name, sku, category (string), unit, price, stock, reservedStock, reorder, status. **No images, GST, cost, dimensions or variants.** |
| Customer | Yes | name, phone, balance (`min:0`, so advances/credits are impossible), createdBy |
| Order | Yes | Embedded lines, status, idempotency key, `stockReserved` |
| Invoice | Yes | **No lines and no GST.** `paid` is never updated by anything. |
| BusinessSettings, AuditLog, InventoryMovement, MutationLock | Yes | The audit log is free text |

| ERP collections (`erp-models.ts`) | Reachable | Notes |
|---|---|---|
| ErpCategory | API only | Not linked to Product.category |
| ErpRawMaterial | API only | Stock fields exist but **nothing changes them** |
| ErpBom | API only | Versioned, wastage %. Not linked to Product ids in the core store. |
| ErpStockLedger | API only | **Broken:** the POST route sends `adjustment_in/adjustment_out`, which the schema enum rejects. It also writes `createdBy`, which isn't in the schema. Nothing updates material stock. |
| ErpProduction | API only | Any status can be set to any other. No consumption and no finished-goods output. |
| ErpPayment | API only | Not applied to invoices or customer balances. No UI. |
| ErpAssignment | API only | Never enforced on the catalogue |
| ErpCatalogueSource | API only | Never populated |

### 3.3 API and authorization

- Core routes are in `server.ts:42-63`. ERP routes are in `erp-routes.ts`.
- Authorization is role-only (`allow('owner','accounts')`). There is **no permission matrix**.
- ERP routes treat `accounts` exactly like the owner, and they accept a non-existent `admin` role (`erp-routes.ts:27`).
- **ERP routes are mounted before helmet, CORS and the rate limiter** (`server.ts:20` vs `:22`), so they bypass those protections.
- ERP `auth` does not validate the JWT claims shape (`erp-routes.ts:16-25`).
- `PATCH /api/erp/categories/:id` and `/materials/:id` apply `$set: req.body` with no validation (`erp-routes.ts:63,78`). That is mass assignment: anyone with accounts access can set `availableStock` directly.
- `GET /api/dashboard` is declared twice (`server.ts:47-48`). Only the first ("today" figures) is ever reached.
- `GET /api/users` and `POST /api/users` are **owner-only** (`server.ts:45-46`). **The Accountant cannot create salesmen** (your §4 complaint is confirmed). Salesmen also cannot be edited, deactivated or have their password reset, and have no profile fields.
- There is no product edit, archive or image endpoint.
- There is no customer edit endpoint and no customer assignment.

### 3.4 Order workflow

`Pending → Approved | Rejected | Cancelled; Approved → Processing | Dispatched | Rejected | Cancelled; Processing → Dispatched | Cancelled; Dispatched → Delivered` (`server.ts:57`).

- A stock policy (reserve at submission, approval or dispatch) is implemented in `stock.ts` and is sound in concept.
- An invoice can be created from an *Approved* order before dispatch (`server.ts:60`). It adds the order total to the customer balance, and nothing reduces it.
- There is no "Completed" status and no link between payment and order.
- The admin UI only offers Approve/Reject (`main.tsx:12`). Dispatch, Deliver and Cancel have no buttons.

### 3.5 Frontend

- **Admin** (`main.tsx`): Overview, Products, Orders, Invoices, Customers, Salesmen, Settings.
  - The Accountant gets the same menu, including Salesmen, which then returns 403.
  - The header date is hard-coded ("MONDAY, 28 OCTOBER 2026") and the greeting says "Good morning, owner".
  - Errors are shown with `alert()`.
  - Products show a coloured dot and no image.
  - There is no paging, filtering or detail view.
- **Session bug:** `/api/me` returns `{user}`, but `App` stores the whole response as the user (`main.tsx:8`). After a page reload, `user.role` is undefined, so a salesman token renders the **admin shell**. The API still blocks the data, but the UI is wrong.
- **Salesman** (`salesman.tsx`):
  - Catalogue, cart, own customers, submit order and own orders work.
  - Missing: images, product detail, targets, dashboard, collections and an order timeline.
  - The cart sits at the bottom of a very long page.
- There are **three duplicate salesman-admin pages**: the Salesmen tab, `salesmen-admin.html` and `admin-salesman-management.html` (uncommitted). `salesman-portal.tsx` is never rendered and reads fields that don't exist.
- The default API base differs between entry points (`:4000` vs `:10000`).

---

## 4. Requirement-by-requirement status

Legend: ✅ exists and usable · 🟡 partial/incomplete · ❌ missing.
The "Rebuild (B)" column is based on its schema and commit log. I have not verified it by running it.

| # | Requirement (prompt §) | Legacy (A) | Rebuild (B) |
|---|---|---|---|
| 1 | Inventory dashboard (2.1) | ❌ | 🟡 low stock/valuation planned (B2), dashboard Phase E |
| 2 | Supplier management + ledger (2.2) | ❌ | 🟡 Supplier, SupplierPayment; no category/payment terms |
| 3 | Raw materials (2.3) | 🟡 model only, stock never moves | ✅ RawMaterial + append-only ledger; units KG/SHEET/PIECE/LITRE/METRE/SET; no min/max/location/preferred supplier/conversion |
| 4 | Purchase workflow PO → approval → GRN → stock (2.4) | ❌ | 🟡 Purchase = direct stock-in; no PO approval, partial receipt or purchase return |
| 5 | Finished products with images, dimensions, GST, variants (2.5) | 🟡 bare product | 🟡 designCode/series/doorCount/size/colour/GST/HSN/cost; single `imageUrl`; no variant structure |
| 6 | BOM with versions + wastage (2.6) | 🟡 model only | 🟡 `ProductRecipe` flat (qty per unit), no version/wastage |
| 7 | Production workflow DRAFT…COMPLETED (2.7) | 🟡 status field only | 🟡 `ProductionRun` is single-step (consume + produce); no states/reservation |
| 8 | Unified stock ledger with before/after, reversal (2.8) | 🟡 finished goods only (InventoryMovement); materials in a broken separate ledger | ✅ StockLedger + RawMaterialLedger, append-only triggers; reversal types partial |
| 9 | Adjustments + wastage with approval (2.9) | ❌ | 🟡 adjustments with reason; no approval/wastage record |
| 10 | Inventory alerts (2.10) | 🟡 low-stock count | 🟡 Notification model (Phase C5) |
| 11 | Product catalogue with Cloudinary images (3) | ❌ | ❌ single URL, no upload |
| 12 | Salesman create/edit/deactivate/reset (4.1) | 🟡 create only, owner only | 🟡 Users CRUD with `isActive`, `tokenVersion`; no employeeId/territory/joining date |
| 13 | Salesman dashboard (4.2) | ❌ | ❌ (Phase F) |
| 14 | Salesman catalogue (4.3) | 🟡 no images/variants | ❌ (Phase F) |
| 15 | Order workflow incl. dispatch/delivery/payment/completed (4.4) | 🟡 no UI beyond approve/reject; no completion | 🟡 PLACED→CONFIRMED→DISPATCHED→DELIVERED with history (Phase C) |
| 16 | Activity dashboard + timeline (5) | ❌ free-text audit only | 🟡 AuditLog (structured) + OrderStatusHistory |
| 17 | Targets: types, periods, history (6) | ❌ | 🟡 `SalesTarget` = monthly amount only, no history |
| 18 | Accountant permissions configurable by Admin (7, 9) | ❌ role-only | 🟡 role-based permissions in shared package; not admin-configurable |
| 19 | Business overview + reports + export (8) | ❌ | 🟡 Phases D/E |
| 20 | Customer payments/collections (4.4, 7) | 🟡 ErpPayment stub | ✅ Receipt + allocation + void |
| 21 | Expenses / P&L only with complete costs (8) | ❌ (`expenses:0` hard-coded) | 🟡 Expense model; Phase D |

---

## 5. What can be reused (either option)

- **Concepts:** the reserve/release/finalize stock semantics in `stock.ts`, the order idempotency-key pattern, and the configurable reservation policy.
- **Data:** existing users, salesmen, customers, products and orders in Atlas. Migrate them; never drop them.
- **Content:** the Hindi/Bengali strings in `i18n.tsx` and the colour palette, if you want to keep the look.
- **Reference data:** the verified Steel Raj specs in §2.1 and the design-code ranges.

## 6. What must change (either option)

1. Persistence must use atomic per-document or per-row writes inside transactions. Drop the load-all/rewrite-all pattern.
2. Product modelling must become body model × design variant (§2.4).
3. Authorization must use a permission matrix enforced in middleware, with salesman serializers that strip cost, supplier and margin data.
4. Raw-material and finished-goods stock must change only through ledgered service functions.
5. Payments must apply to invoices and balances, so "Collected" and "Outstanding" are real numbers.
6. Remove the production auto-seed, fake customers and hard-coded UI text.

## 7. Verification actually performed

| Check | Result |
|---|---|
| Backend `tsc --noEmit` | **Pass** (test files are excluded by tsconfig) |
| Frontend `tsc --noEmit` | **Fail, 2 errors**, both in tooling: `vitest` types missing in `api-response.test.ts`; `process` untyped in `vite.config.ts`. No app-code errors. |
| Frontend `vite build` (output to scratch dir) | **Pass** |
| Backend tests | **Not run.** `vitest` is not in `backend/package.json`. `auth-api.test.ts` sets `PERSISTENCE=json` *after* its hoisted imports have already loaded `config.ts`, which reads `backend/.env` (production + Atlas URI). Running it could touch the real database. |
| Rebuild tests | Not run by me. The figures in §0 come from its own commit log and `TASKS.md`. |
| Browser workflows | Not run (audit phase) |
