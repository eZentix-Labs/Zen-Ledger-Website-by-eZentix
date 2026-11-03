# Zen Ledger: Technical Audit

**Date:** 2026-11-03
**Scope:** Whole repository at `main` @ `b2e43a1`, plus the uncommitted working-tree changes (`backend/src/catalog.ts`, `repository.ts`, frontend files) as they existed during the audit.
**Method:** Read-only. I read every source file (~970 lines in total), installed dependencies, type-checked, built, ran the tests, and ran **three isolated backend instances**: one with a JSON store and two in Mongo mode against a disposable in-memory MongoDB 7. All of them ran on scratch ports with scratch data, and none touched the real Atlas cluster. I called every API with scripted HTTP probes and drove the UI with Playwright (Chromium) at 1440×900 desktop and 390×844 mobile. Every WORKS/BROKEN verdict below comes from an observed result, not from reading code alone.

> **Bottom line:** This is not a billing/inventory system for an almirah manufacturer. It is a generic grocery-style "order approval" demo (the seed data used to be rice and mustard oil) with a thin manufacturing/ERP layer bolted on that is not wired to anything. Six of the ten required capabilities are **MISSING** outright. The persistence layer **deletes and re-inserts the entire database on every write**, and I reproduced **silent data loss** with two instances. A clean rebuild is faster and safer than patching. See §9.

---

## 0. Immediate action required (do today)

1. **Rotate the MongoDB Atlas password now.** `backend/.env.example` is committed to git (commits `2b96a19`, `0d63e7f`) and contains a real `mongodb+srv://<user>:<password>@cluster0.mkalv.mongodb.net/...` connection string. Anyone with repo access, or anyone at all if the repo is public, can read and write the database. Rotating is the fix. Deleting the file does not remove it from history. After rotating, purge the file from history (`git filter-repo`) and restrict Atlas network access to Render's egress IPs.
2. **Do not point any second instance, preview deploy, or local dev server at the production `MONGODB_URI`.** Because of the full-store rewrite (§4.2, C2), whichever instance writes last overwrites everything the others wrote. Render zero-downtime deploys briefly run old and new instances side by side, which is the same situation.
3. The root `.env` sets `NODE_ENV=production` + `PERSISTENCE=mongo` + the Atlas URI. Running `npm run dev` from the repo root with that file therefore writes to the real database.

---

## 1. Stack and structure

| Layer | Detected | Notes |
|---|---|---|
| Frontend | React 19.3, Vite 8.3 (rolldown), TypeScript 7.0, react-router-dom 7 (imported but **not used for routing**), lucide-react | Hand-written CSS, no component library, no form library, no state/data library |
| Backend | Node 22, Express 5.3, TypeScript 7 run via `tsx` (also in prod: `"start": "tsx src/server.ts"`) | `npm run build` emits `dist/` but production never uses it |
| DB | MongoDB via Mongoose 9.11 (prod); JSON file (dev fallback) | Whole dataset held in process memory; see §4.2 |
| Auth | JWT HS256 (8 h) in `localStorage`, bcryptjs | No refresh, no revocation, no user-active check |
| Validation | zod 4 on core routes; partial on ERP routes | ERP PATCH routes pass `req.body` straight to `$set` |
| Package manager | npm (two separate lockfiles, no workspace) | **Every dependency is pinned to `"latest"`** in both `package.json` files |
| Tests | vitest is imported by 3 test files but is **not a dependency** | `npm test` does not exist |
| Deploy | Render (`render.yaml` ×2, root and `backend/`), Vercel (`vercel.json` ×2) | Duplicated, slightly different configs |
| Lint/format | None | Code is minified-style, with entire components on single 2–5 KB lines |

```
/
├── .env                      # real prod-mode config (gitignored) – see §0
├── render.yaml, vercel.json  # duplicates of backend/render.yaml, frontend/vercel.json
├── resorce/*.pdf             # 4 supplier catalogue PDFs committed to git (typo "resorce")
├── tmp/pdfs/*.png            # untracked page renders
├── docs/                     # 7 planning docs + this audit
├── backend/src
│   ├── server.ts (72 lines)  # ALL core routes, auth, locking, bootstrap
│   ├── erp-routes.ts         # categories/materials/BOM/production/payments/assignments (Mongo-only)
│   ├── models.ts, erp-models.ts, types.ts
│   ├── repository.ts         # JSON + Mongo "repositories" (load-all / save-all)
│   ├── stock.ts              # reserve/release/finalize (the only decent module)
│   ├── catalog.ts            # (uncommitted) seeds 324 SKUs with price 0 / stock 0
│   └── *.test.ts
└── frontend
    ├── index.html, salesman.html, salesmen-admin.html, admin-salesman-management.html
    └── src
        ├── main.tsx (21 lines, ~25 KB)  # entire admin app
        ├── salesman.tsx                 # salesman UI (used by both index.html and salesman.html)
        ├── salesman-main.tsx            # separate salesman entry (phone login)
        ├── salesman-portal.tsx, erp-api.ts      # DEAD CODE – never rendered
        ├── admin-salesmen-main.tsx, admin-salesman-management-main.tsx  # two more duplicate "salesmen" pages
        ├── api.ts            # monkey-patches window.fetch globally
        └── i18n.tsx          # en/bn/hi (partial)
```

---

## 2. Data model

### 2.1 Core collections (`backend/src/models.ts`)

All of these use a string `id` field alongside Mongo's `_id`. There are **no `ref`s, no foreign keys, and no embedded validation**. Money is stored as JS `Number` (float rupees).

| Model | Fields | Problems |
|---|---|---|
| **User** | id, name, email (unique), password, role ∈ owner/accounts/salesman | No `phone` field in the schema, although the API writes `phone`. Mongoose strict mode **silently drops it**, so phone login only works through the synthetic `"<digits>@phone.local"` email hack. No `active`, no `lastLogin`. The spec's **"admin" role does not exist** (owner/accounts only). |
| **Product** | id, name, sku (unique), category (free string), unit, price, stock, reservedStock, reorder, status | **No GST rate, no HSN code, no cost price, no MRP, no size/colour/door-count/gauge variant**, no image, no dealer price. `category` is free text, unrelated to `ErpCategory`. |
| **Customer** | id, name, phone, balance (min 0), createdBy | No unique phone (duplicates accepted, verified). No GSTIN, address, state (needed for CGST/SGST vs IGST), or customer type. **There is no dealer concept**: dealers, retail customers and walk-ins are all "customers". |
| **Order** | id, customerId, customerName, createdBy, items[{productId,name,qty,price,unit}], total, status (free string, no enum), reason, idempotencyKey (unique sparse), requestFingerprint, stockReserved | No tax, discount, delivery address, or dates per stage (placed/approved/dispatched/delivered). `qty` accepts fractions (0.37 almirah accepted). |
| **Invoice** | id (= order id), number (unique), customerName, total, paid, status | **No line items, no tax, no GSTIN, no customerId, no orderId field** (it relies on `id === order.id`), no place of supply, no due date. `paid` is never updated by anything. |
| **BusinessSettings** | businessName, currency, stockPolicy, taxEnabled | `taxEnabled` has **no effect anywhere** (verified). No company GSTIN, address, bank details, or invoice prefix. |
| **AuditLog** | id, action (free text), actor, at | Records no entity id, before/after, or IP. Grows forever, and the whole log is reloaded and re-saved on every write. |
| **InventoryMovement** | product movement ledger with before/after on-hand and reserved | Only types used are opening / reservation / reservation_release / sale. **No purchase-receipt, return, or adjustment endpoint exists.** |
| **MutationLock** | `_id: 'global'`, owner, lockedUntil | Global lock. It does not prevent the lost update in §4.2 because instances never reload state after taking it. |

### 2.2 ERP collections (`backend/src/erp-models.ts`), not connected to the core

ErpCategory, ErpRawMaterial, ErpBom, ErpStockLedger, ErpProduction, ErpPayment, ErpAssignment, ErpCatalogueSource. These use `_id` (ObjectId) while the core uses string `id`, so the two halves cannot reference each other properly.

* `ErpStockLedger.movementType` enum = `adjustment` but the route accepts `adjustment_in`/`adjustment_out`. **Every adjustment returns 500** (verified).
* The route writes `createdBy`/`referenceType`, but the schema has `userId` and no `referenceType`, so **the actor is silently discarded from every ledger row** (verified: `userId` undefined).
* `ErpAssignment` declares the index on `salesmanId` twice. Mongoose prints a duplicate-index warning on every boot.
* ErpPayment links to an `orderId` string that is never validated.

### 2.3 Missing indexes and constraints

* `orders`: no compound `{createdBy, createdAt}` or `{status, createdAt}`, which reports by salesperson or period would need. Irrelevant today because every query runs in JS over an in-memory array.
* `customers.phone` not unique; `invoices.number` unique but generated as `count+1` (§5).
* No check constraint `reservedStock ≤ stock` at DB level (only checked in JS on load).
* No collection at all for: dealers, purchases/suppliers, GRNs, expenses, expense categories, payments against invoices (core), credit notes, cash/day close, invoice lines, tax rates, HSN master, delivery/challan.

---

## 3. Routes and pages

### 3.1 Core API (`backend/src/server.ts`)

| Method & path | Roles | What it does | Observed |
|---|---|---|---|
| GET `/api/health` | public | liveness | 200 |
| POST `/api/auth/login` | public | email or phone + password → JWT (8 h) | 200/401; no lockout (30 bad attempts all 401, none throttled beyond 240 req/min/IP) |
| GET `/api/me` | any | returns `{user: claims}` | Shape mismatch with the UI, which causes the refresh bug (§6) |
| GET `/api/users` | owner | list **salesmen only** | 200 |
| POST `/api/users` | owner | create salesman (name, phone, password) | 201; no edit/disable/reset/delete endpoint |
| GET `/api/dashboard` | owner, accounts | **defined twice** (L47 and L48); the first wins, the second is dead code | Counts invoices of cancelled orders as sales |
| GET `/api/products` | any authenticated | search + page (default 50, max 100) | `limit=abc` returns `[]` |
| POST `/api/products` | owner, accounts | create product with opening stock | Accepts fractional stock (2.5 almirahs) and price ₹0.001 |
| — | — | **No update, archive, delete, price change, or stock-in for products** | PATCH/PUT/DELETE → 404 |
| GET `/api/customers` | owner, accounts | all customers | |
| GET `/api/my-customers` | salesman | own customers | |
| POST `/api/customers` | all | create | Duplicate phone accepted; phone "12345" accepted |
| GET `/api/inventory/movements` | owner, accounts | last 500 movements | |
| GET `/api/orders` | all (salesman: own) | list | No pagination |
| POST `/api/orders` | owner, salesman | create order (Pending) | **No stock check under default policy**; accountant cannot create orders |
| PATCH `/api/orders/:id/status` | owner, accounts | state machine | Salesman cannot cancel own order |
| GET `/api/invoices` | owner, accounts | list | |
| POST `/api/invoices/from-order/:id` | owner, accounts | invoice = copy of order total | Allowed **before dispatch** (stock not yet deducted) |
| GET/PATCH `/api/settings` | read owner+accounts / write owner | settings | Currency "XYZ" accepted |
| GET `/api/audit` | owner, accounts | last 100 | |

### 3.2 ERP API (`backend/src/erp-routes.ts`, Mongo only; **in JSON mode every call hangs 10 s then 500**)

`GET/POST/PATCH /api/erp/categories`, `GET/POST/PATCH /api/erp/materials`, `GET/POST /api/erp/materials/:id/ledger`, `GET/POST /api/erp/boms`, `GET/POST /api/erp/productions`, `PATCH /api/erp/productions/:id/status`, `GET/POST /api/erp/payments`, `GET/PUT /api/erp/salesmen/:id/assignment`, `GET /api/erp/catalogue-sources`.

**No frontend screen calls any of them.** The only caller, `salesman-portal.tsx`/`erp-api.ts`, is dead code. The ERP layer is therefore unreachable from the product. It also has its own `auth` and `roleIs` implementation (duplicated from server.ts) that references a non-existent `admin` role. It is registered **before** `helmet`, `cors` and `rateLimit`, so ERP routes get **no security headers and no rate limiting** (verified: no `X-Content-Type-Options` and no `RateLimit-*` headers on `/api/erp/*`).

### 3.3 Frontend pages

| URL | Entry | Purpose | State |
|---|---|---|---|
| `/` | `main.tsx` | Admin shell (Overview, Products, Orders, Invoices, Customers, Salesmen, Settings) **and** salesman UI if a salesman logs in with email | Works partially (see §4, §6) |
| `/salesman.html` | `salesman-main.tsx` | Phone-login salesman app | Login URL logic differs from the rest (`localhost:4000` default vs `localhost:10000` in `api.ts`) |
| `/salesmen-admin.html` | `admin-salesmen-main.tsx` | Duplicate "create salesman" page #2 | Unstyled; no login of its own |
| `/admin-salesman-management.html` | `admin-salesman-management-main.tsx` | Duplicate "create salesman" page #3 | **Not in Vite `rollupOptions.input`, so it does not exist in production builds** |

There are three implementations of salesman management, two salesman entry points, and two API-client implementations (`api.ts`, `erp-api.ts`) plus inline `fetch` calls in four files.

---

## 4. Install, build, run, and feature verification

### 4.1 Install, build, and run log

| Step | Result |
|---|---|
| `npm ci` (backend, frontend) | **Failed with EPERM**: the user's own `tsx`/`vite` dev servers were running and locking `esbuild.exe` and the rolldown `.node` binary. I restored with `npm install` against the unchanged lockfiles (verified byte-identical with `cmp`), and `npm ls` is clean. Lesson for the team: don't run `npm ci` with dev servers open on Windows. |
| `npm audit` | 0 known vulnerabilities (both) |
| Dependency versions | All `"latest"`, so builds are not reproducible without the lockfile; TS 7 / Vite 8 / Express 5 / Mongoose 9 majors could change on any reinstall |
| Backend `tsc` | Passes |
| Frontend `tsc --noEmit` | **2 errors**: `Cannot find module 'vitest'` (api-response.test.ts) and `Cannot find name 'process'` (vite.config.ts, missing @types/node) |
| Frontend `vite build` | Passes (63 KB main + 220 KB shared chunk). `admin-salesman-management.html` not emitted. |
| Backend boot (Mongo mode) | Warning: `Duplicate schema index on {"salesmanId":1} for model "ErpAssignment"` |
| Backend boot (`server.ts` L3) | `dns.setServers(["1.1.1.1","8.8.8.8"])` is hard-coded, which overrides system DNS for the whole process |
| Seed (uncommitted `catalog.ts`) | 324 catalogue SKUs, **all with price ₹0 and stock 0**. No API can ever change price or stock, so on a fresh DB **nothing can ever be sold** |

### 4.2 Architecture defect that underlies everything

`server.ts` loads the **entire database into a module-level variable `db` at startup** and never re-reads it. Every mutation edits that in-memory object and then calls `repo.save(db)`. For Mongo, `save()` is:

```ts
await Promise.all([Models.users.deleteMany({}), Models.products.deleteMany({}), ... 8 collections]);
await Promise.all([Models.users.insertMany(store.users), ... 8 collections]);
```

That design produces these consequences:

* **Lost updates across instances (reproduced).** Two instances on the same DB: instance A created customer "A", then instance B created customer "B". Result in MongoDB: **A = false, B = true**. A's write was erased, with no error shown to anyone. The "mutation lock" does not help because neither instance reloads state after acquiring it.
* **Total data loss on crash or network blip.** Between the `deleteMany` and `insertMany` phases, the database is empty. There is no transaction (the code comment admits the deployment is not a replica set). A process kill, an Atlas failover, or one failed `insertMany` in that window leaves you with an empty or partial database. The next boot then refuses to start ("partial dataset") or, if the database is fully empty, **re-seeds over it**.
* **Every write costs O(whole database)**: 16 round-trips plus a `structuredClone(db)` per request. Measured on localhost: ~45 ms per customer insert with ~600 docs. On Atlas over the network, with audit and movements growing forever, this degrades linearly and will become unusable within months of real billing.
* Reads never see changes made directly in the DB (Compass, scripts, a second instance) until restart.

You cannot fix this layer by refactoring; it has to be replaced.

### 4.3 Checklist

| # | Requirement | Verdict | Evidence (observed) |
|---|---|---|---|
| 1 | **Stock-gated billing** (no stock = no bill, atomic deduction, no negative stock) | **BROKEN** | (a) Default policy `approval`: a salesman order for **50 units when 3 are in stock was accepted** (201, "Pending", ₹6,25,000), and an order for a **stock-0, price-₹0** product was accepted. The salesman UI also let me put **9 units of a 1-in-stock item** in the cart. The gate exists only at approval (409, correct). (b) **An invoice can be created for an Approved order before any stock is deducted** (`INV-2026-0001` issued, stock still 3), so "no stock = no bill" is not enforced at billing. (c) Cancelling an order **after it was invoiced** succeeds and leaves the invoice "Due" and the customer balance inflated (balance ₹37,500 included the cancelled ₹12,500). (d) Deduction is atomic only within one process (in-memory clone and rollback); across instances it is not (§4.2). (e) There is **no counter-billing flow** at all: the admin can't raise a bill without a salesman order. `server.ts:56-60`, `stock.ts` |
| 2 | **Inventory**: current stock, ledger, purchases, low-stock | **PARTIAL / mostly MISSING** | Current stock: shown (first 50 products only, no paging UI). Product ledger: API only (`/api/inventory/movements`), **no UI**. **Purchases: MISSING.** There is no stock-in, GRN, supplier, or adjustment endpoint for products (PATCH/PUT/POST purchase → 404); stock can only be set once, at product creation. The ERP raw-material ledger exists but **does not change `availableStock`** (purchase of 100 → stock still 0), allows **consumption of 500 from 0**, adjustments 500, and `PATCH /materials/:id {availableStock: 99999}` **bypasses the ledger** (200). Low-stock alert: list only. With `reorder` defaulting to 0, **325 of 327 products show as "low stock"**, which makes the list meaningless. No notifications. |
| 3 | **Dealers and salespersons management** | **PARTIAL** (salespersons) / **MISSING** (dealers) | Salesman: create and list only (owner). No edit, deactivate, password reset, target, commission, or territory. Accountant cannot manage them. The salesman↔product assignment API exists (ERP) but nothing enforces it and there's no UI. **No dealer entity, no dealer pricing, no dealer ledger, no credit limit.** Salesmen can place orders for any customer id, including ones they don't own (`c1` → 201). |
| 4 | **Sales reports** by dealer and salesperson (monthly/quarterly/half-yearly/yearly) | **MISSING** | No report endpoint (`/api/reports/*` → 404), no report screen, no date filter anywhere, no export. Orders and invoices do not even store a salesperson on the invoice. |
| 5 | **Expenses** with an "extra/unnecessary" category | **MISSING** | No model, route, or screen. Dashboard returns hard-coded `expenses: 0`. |
| 6 | **Order lifecycle** (placed → delivered) and salesperson order placement | **PARTIAL** | API state machine works: Pending→Approved→(Processing)→Dispatched→Delivered, illegal jumps 409, double-dispatch 409. **The admin UI only offers Approve/Reject on Pending orders.** There is no button for Processing, Dispatched, Delivered, or Cancel, so the lifecycle beyond approval is **API-only**. No returns after delivery (Delivered→Cancelled 409, no return flow). Salesman cannot cancel their own order (403). Salesman placement works (cart → customer → submit, idempotency key OK). Fractional quantities accepted. Duplicate lines of the same product accepted. No dispatch details (vehicle, challan, delivery address). |
| 7 | **End-of-day report** | **MISSING** | Nothing. The "Sales billed today" tile is the closest thing, and it counts invoices of cancelled orders. |
| 8 | **Printable invoice** (GST-ready, INR, A4) | **MISSING** | No invoice detail, view, print, or PDF. The invoice record holds only number, customer name, total, and paid; it has **no line items**. No GSTIN, HSN, taxable value, CGST/SGST/IGST, place of supply, amount in words, or bank details. `taxEnabled=true` changes nothing (order for ₹12,500 → total ₹12,500). Numbering `INV-<calendar year>-<count+1>` is not Indian-FY based and never resets. Money is shown as "INR 37,500" rather than "₹37,500.00". |
| 9 | **Role-based access** on UI and API | **PARTIAL** | Core API matrix is consistent (owner/accounts/salesman/anon checked on 10 endpoints, all as designed). Gaps: (a) **No admin role**; "accounts" has the same powers as owner for products, approvals and invoicing, and only owner can manage salesmen. (b) ERP routes: `accounts` can mass-assign any field (`PATCH /erp/categories/:id {slug:"HACKED"}` → 200; materials `availableStock` → 200), and **salesmen can read BOM cost prices** (`GET /erp/boms` → 200 with `costBasis` 2400). (c) **UI**: after a page refresh, a **salesman is shown the admin shell** (sidebar, Overview, Products, Invoices…), with an uncaught "Permission denied" error. The API still blocks the data, but the UI gate is broken. (d) Tokens stay valid for 8 h after a user should be removed (no user lookup per request, no revocation). (e) Admin and salesman apps share the `localStorage.token` key on the same origin, so logging into one logs out the other. |
| 10 | **Dashboard with charts** | **PARTIAL (no charts)** | 4 number tiles + 3 CSS progress bars + a low-stock table. No charts, trends, period filter, or comparison. Hard-coded header date "**MONDAY, 28 OCTOBER 2026**" and greeting "Good morning, owner". "Collected today" is always ₹0 because no code path ever sets `invoice.paid`; ERP payments (₹18,000 + ₹9,99,999 overpay + a payment for a non-existent order, all accepted) don't touch invoices. "Outstanding dues" includes fake seed balances (₹12,450 + ₹3,200). |

---

## 5. Code quality

### 5.1 Wrong business logic

| Finding | Location | Observed |
|---|---|---|
| No GST anywhere; `taxEnabled` is a no-op | settings, order, invoice | ₹12,500 → ₹12,500 with tax on |
| Order not stock-checked at submission under default policy | `server.ts:56` | 50 vs 3 accepted |
| Invoice allowed before stock deduction; cancellation after invoicing leaves invoice and receivable | `server.ts:58,60` | Orphan "Due" invoice, inflated balance |
| Payments not applied to invoices or customer balance; no overpayment check; no order existence check | `erp-routes.ts:147` | Invoice `paid` stays 0 after ₹10,17,999 recorded |
| Fractional quantities for countable goods | `orderBody` (`qty: positive()`), product `stock: nonnegative()` | 0.37 almirah ordered, 2.5 in stock |
| Float rupees; no rounding, no paise | everywhere | `price: 0.001` accepted |
| Invoice number = `count + 1`, calendar year, not FY | `server.ts:60` | Will collide if any invoice is ever removed; not GST-compliant series |
| "Sales today" includes cancelled orders' invoices | `server.ts:47` | ₹37,500 shown, ₹12,500 of it cancelled |
| Low stock uses `available <= reorder` with reorder 0, so every out-of-stock seed item is "low" | `server.ts:47` | 325/327 flagged |
| Raw-material ledger never updates material stock; allows negative consumption | `erp-routes.ts:85-109` | purchase 100 → stock 0; consume 500 accepted |
| Production "completed" consumes nothing and produces nothing; any status → any status | `erp-routes.ts:135` | completed → planned → 200 |
| Seed products all price 0 / stock 0 with no way to edit them | `catalog.ts`, no PATCH route | Salesman catalogue: 50 visible, 3 addable |
| Audit default actor uses `userContext`, which is never assigned | `server.ts:29-30` | Dead variable |

### 5.2 Security

| Sev | Finding |
|---|---|
| **Critical** | Live Atlas credentials committed in `backend/.env.example` (§0). |
| High | ERP routes mounted before helmet/CORS/rate-limit (no headers, no throttling). |
| High | Mass assignment: `findByIdAndUpdate(id, {$set: req.body})` on categories and materials. Any schema field can be overwritten, including `availableStock` and `averageCost`. |
| High | Data-loss design (§4.2), which is also an availability and integrity issue. |
| Medium | JWT in `localStorage` (XSS-exfiltratable), 8 h lifetime, no revocation, no user-active check, roles trusted from the token. |
| Medium | No login throttling per account; only a global 240 req/min/IP limiter. |
| Medium | Disallowed CORS origin returns **500 "Unexpected server error"** instead of a clean rejection; it pollutes error logs and masks real errors. |
| Medium | Invalid ObjectId on ERP routes returns 500 (CastError not handled). Duplicate category name returns 500 (E11000 not handled). |
| Low | Hard-coded Vercel preview origins in CORS; hard-coded public DNS servers; hard-coded production API URL fallbacks in three frontend files. |
| Low | Development accounts with known passwords (`AccountsTest123!`, `SalesTest123!`) are auto-created whenever `NODE_ENV !== 'production'`. A staging deploy that forgets NODE_ENV exposes them. |
| Low | `api.ts` monkey-patches the global `window.fetch`, which affects every library on the page. |
| Info | Injection: no raw query strings are built, and Mongoose casts protect the core. XSS: React escapes output; no `dangerouslySetInnerHTML`. |

### 5.3 Performance

* O(database) per write plus a full `structuredClone` per mutation (§4.2). Audit and movements are never pruned.
* All reads are linear scans over in-memory arrays. That's acceptable at this size but scales with the whole history, and all of history is held in RAM on a Render free instance.
* No pagination on orders, invoices, customers, or audit. Products are paginated, but the UI never requests page 2, so **products 51–327 are invisible in both the admin and salesman UIs**.
* The salesman catalogue fires a request on every keystroke (no debounce) and refetches customers and orders each time.

### 5.4 Maintainability, duplication, dead code

* Code is written as minified one-liners: `main.tsx` is 21 lines and 25 KB, and `server.ts` has 3 KB lines. It can't be reviewed, diffed, or debugged sensibly.
* Duplicates: 2× `/api/dashboard` handler, 2× `express.json`, 2× auth/role middleware, 3× salesman-management pages, 2× salesman entry points, 3 API-base-URL defaults (`:4000`, `:10000`, the Render URL), 2× render.yaml, 2× vercel.json, duplicated CSS block (`styles.css` lines 6 and 7 identical).
* Dead code: `salesman-portal.tsx`, `erp-api.ts`, the second dashboard handler, `userContext`, `react-router-dom` (BrowserRouter wraps the app but no routes exist), `repository.legacy.js` in `dist`, README sections about `npm run import:json` (the script doesn't exist).
* Error handling: UI calls such as `api('/api/dashboard').then(setD)` have no `.catch`, so failures become uncaught promise rejections (observed). `alert()` is used for errors and success.
* Type safety: `any` throughout the admin UI; `as Product` casts hide the extra `source`/`sortOrder` fields.

---

## 6. UI/UX review

I captured screenshots with Playwright at 1440×900 and 390×844. They are in the audit scratch folder listed in the chat summary and are not committed, per the read-only rule.

| Screen | Problems |
|---|---|
| **Login** (`/`) | Dark marketing splash with a generic "Clarity for every business decision". Mojibake in the eyebrow: `ZEN LEDGER Â· ADMIN` (UTF-8 BOM/encoding bug in `main.tsx`). Email-only login, while salesmen use phone. |
| **Overview** | Hard-coded date "MONDAY, 28 OCTOBER 2026" and "Good morning, owner". **"New transaction" opens "Add product"**, which is misleading. Tick icons on every tile regardless of value. "Customers count" rendered as a progress bar against an arbitrary max of 10. Low-stock table lists 50 identical "0 pieces" rows that fill the page (3,400 px tall). No charts. |
| **Products** | 50 of 327 shown, no pagination. No edit, stock-in, or archive. All prices "INR 0 / piece". No images, although the catalogue PDFs are the whole product range. |
| **Orders** | Order "ID" shown as the last 10 characters of an internal id (`920_en3o25`). **Cancelled and Delivered use the same green "success" badge.** No actions after approval. No order detail view (can't see items or quantities). Errors shown with `alert()`. |
| **Invoices** | Read-only list. No view, print, PDF, record-payment, filters, or search. |
| **Customers** | No edit, no ledger, no "who created", no search. Chevron icons suggest a detail page that doesn't exist. |
| **Salesmen** | Card list with name and phone only. No status, edit, or reset. |
| **Settings** | Free-text currency. A "tax" checkbox that does nothing. `alert('Settings saved')`. |
| **Modals** | Esc does not close them (verified). No focus trap. |
| **i18n** | Hindi/Bengali switch translates nav and a few headings only; most body text stays English (see Hindi screenshot). |
| **Admin on mobile** | No overflow (0 px), but the sidebar collapses to icons only, the 4-column table is cut to 3 columns, and the low-stock list makes the page 4,400 px tall. Admin is desktop-first, so this is acceptable, but it's not polished. |
| **Salesman (mobile)** | Page is **12,700 px tall**: 50 product cards come before the cart, so the salesperson has to scroll the entire catalogue to reach checkout. No sticky cart button. No product images. Add button disabled with no explanation. **Cart quantity is not capped at available stock** (9 added with 1 available). Customer select plus inline "new customer" form is confusing. Theme toggle resets to light on reload in `salesman.html`. |
| **Salesman after refresh** | **Shows the admin shell** (sidebar, Overview, Products, Invoices…) with zeros and a console "Permission denied" error, because `/api/me` returns `{user}` and `main.tsx` stores the wrapper. Owner refresh also loses the avatar initial. |
| **salesmen-admin.html** | Unstyled page. No sign-in of its own; just shows "Please sign in as the owner/admin first." |
| **admin-salesman-management.html** | A third, differently styled version of the same page (its own purple theme CSS). **404 in production builds.** |
| Overall | Dark-purple "crypto dashboard" look is a poor fit for an accountant doing 8 hours of data entry: low-contrast grey text (`--faint #635C7D` on `#1A1730`), 10–12 px labels, italic badges. There are three different visual styles across the four HTML entry points. |

---

## 7. Tests

| Suite | Content | Result |
|---|---|---|
| `backend/src/stock.test.ts` | 5 unit tests of reserve/release/finalize | **5/5 pass** |
| `backend/src/auth-api.test.ts` | 12 API tests (auth, RBAC, idempotency, reservation, concurrent approval, dispatch) | **Cannot run as shipped**: `vitest` isn't installed, and `config.ts` is evaluated (static import of `repository.ts`) **before** the test sets `process.env`, so it throws "Invalid environment configuration". With env vars supplied externally: **11/12 pass, 1 fails** (expects "Incorrect email or password", the API now says "Incorrect phone/email or password"). |
| `frontend/src/api-response.test.ts` | 4 tests of `readApiResponse` | **Cannot run**: `ReferenceError: window is not defined` (`api.ts` patches `window.fetch` at import time); also breaks `tsc`. |

**Coverage (backend, v8, with env supplied):** statements 48.8%, branches 42.5%, functions 43.2%, lines 50.6%. By file: `stock.ts` 90%, `server.ts` 62%, `erp-routes.ts` 21%, `repository.ts` 11% (the most dangerous file is effectively untested), `config.ts` 46%. Frontend: 0%. There are no tests against MongoDB, no E2E tests, and no CI.

The concurrency tests pass only because they use one in-process instance. They give false confidence: the real failure mode is multi-instance and crash-during-save (§4.2).

---

## 8. Prioritized gap list

Effort: **S** < 1 day, **M** 1–5 days, **L** > 1 week (one experienced developer).

### Critical (blocks any real use)

| # | Gap | Effort |
|---|---|---|
| C1 | Rotate the leaked Atlas password, purge it from git history, and restrict Atlas IPs | S |
| C2 | Replace the load-all/delete-all/insert-all persistence with per-document atomic writes in transactions (replica set) or a relational DB | L (rewrite) |
| C3 | Stock-gated billing: check stock at order submission and at invoice; deduct atomically (`$inc` with `stock >= qty` guard, or SQL `UPDATE … WHERE stock >= qty`) in the same transaction as invoice creation; integer quantities only | M |
| C4 | Stock-in / purchase (GRN) with supplier, product edit (price, reorder, archive), and stock adjustment with reason; all via ledger | M |
| C5 | GST invoice model: line items, HSN, rate, taxable value, CGST/SGST vs IGST by place of supply, company and customer GSTIN, FY-based gapless numbering, amount in words, rounding in paise | M |
| C6 | Printable A4 invoice (HTML print CSS or server PDF), ₹ formatting | M |
| C7 | Payments against invoices (partial/full), updating invoice status and customer/dealer ledger; prevent cancel-after-invoice without a credit note | M |
| C8 | Fix role model: owner/admin, accountant, salesman, with a clear permission matrix; fix the UI gate (`/api/me` shape) | S–M |

### Important

| # | Gap | Effort |
|---|---|---|
| I1 | Dealer entity (GSTIN, state, credit limit, price list, ledger) separate from walk-in customers | M |
| I2 | Sales reports by dealer and salesperson: month / quarter / half-year / year, with CSV/Excel export | M |
| I3 | Expenses module with categories including "Extra/Unnecessary", plus monthly totals | S–M |
| I4 | End-of-day report: invoices, collections by mode, expenses, stock movements, cash in hand; day close | M |
| I5 | Full order lifecycle UI: approve → processing → dispatch (challan, vehicle) → delivered; returns and credit notes; salesman cancel-while-pending | M |
| I6 | Counter billing (admin creates a bill directly for walk-in or dealer) | M |
| I7 | Dashboard charts (sales trend, top products, dealer and salesperson ranking, receivables ageing) | M |
| I8 | Salesman management: edit, deactivate, reset password, assigned dealers/territory | S |
| I9 | Real test suite (API tests against a real DB, E2E for billing), CI, lint/format, pinned dependency versions | M |
| I10 | Proper error handling (400/404/409 for Cast/duplicate errors, clean CORS rejection), structured logging | S |

### Nice-to-have

| # | Gap | Effort |
|---|---|---|
| N1 | Product images and variants (size/doors/gauge/colour) from the supplier catalogues | M |
| N2 | Complete Hindi/Bengali translations | S–M |
| N3 | WhatsApp/SMS share of invoice PDF | S |
| N4 | Raw-material/BOM/production (only if they really manufacture in-house; currently disconnected) | L |
| N5 | Offline-tolerant salesman app (PWA) | M |
| N6 | Low-stock notifications | S |

---

## 9. Recommendation by layer

| Layer | Verdict | Reason |
|---|---|---|
| **Database schema** | **REBUILD** | Wrong domain (no GST, HSN, dealer, purchase, expense, or invoice lines), two disconnected id schemes (`id` vs `_id`), money as floats, no relations, and a schema that silently drops fields the API writes (`User.phone`, ledger `createdBy`). For an accounting system with relational data (invoices→lines→products, ledgers, FY series, reports by period), I recommend **PostgreSQL + Prisma/Drizzle** with integer paise. Transactions and `CHECK (stock >= 0)` give you atomic stock-gated billing with no extra effort. |
| **Backend/API** | **REBUILD** | The persistence pattern (in-memory DB, rewrite-everything save) is the foundation of every route and can't be refactored away; I reproduced data loss with it. Routes are crammed into 3 KB lines, the ERP half is unreachable, and middleware order is wrong. Keep only `stock.ts`'s reserve/release/finalize idea and the idempotency-key approach as reference. |
| **Business logic** | **REBUILD** | GST, purchases, payments application, reports, EOD, and expenses are absent. What exists has the wrong rules (no gate at submission or billing, invoice before deduction, cancel after invoice, fractional almirahs). |
| **Admin UI** | **REBUILD** | One 25 KB-per-line file, no routing, no tables with paging or filtering, no detail views, `alert()` errors, hard-coded dates, and a dark styling that is a poor fit for accounting work. Rebuild with a proper component library (e.g. Mantine or shadcn/ui), a data-table component, React Query, and react-router. The colour palette can be reused if the owner likes it. |
| **Salesperson UI** | **REBUILD** | Wrong flow for mobile (12,700 px page, cart at the bottom), no images, no stock caps, a broken refresh/role gate, and two competing entry points. Rebuild as a mobile-first PWA: search → product card with image and availability → sticky cart → dealer pick → submit → order status. |
| **Auth** | **REFACTOR** (small) | JWT + bcrypt + zod-validated claims is a reasonable base. Needed: httpOnly cookie or short-lived access + refresh token, per-request user-active check, account lockout, and a real role/permission matrix. Credential rotation is mandatory (§0). |

### Verdict

**A clean rebuild is faster than patching.** About 970 lines exist. Roughly 150 of them (stock math, idempotency, zod schemas, i18n strings) are worth carrying over as reference. Everything else either has to change (persistence, data model, every route touching money) or doesn't exist yet (6 of 10 required capabilities). Patching would mean rewriting the persistence layer underneath every route, re-modelling every collection, and then still building GST invoicing, purchases, dealers, reports, expenses, and EOD from scratch, while keeping a codebase that's written as one-line minified files.

A focused rebuild on a relational DB (Postgres + Prisma, Express or Fastify/NestJS, React + a component library, two front-ends sharing one typed API client) is roughly **5–7 developer-weeks** to reach the Critical and Important items above. That is less than the patch path, and the result can be maintained.

What is worth keeping: the supplier catalogue PDFs and SKU list (`catalog.ts`), the stock reservation concepts in `stock.ts`, the idempotency-key pattern for salesman submissions, the Hindi/Bengali strings, and the deployment split (Vercel + Render). Render should get a paid instance and a replica-set or managed Postgres.
