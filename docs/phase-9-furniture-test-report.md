# Phase 9 — Furniture Test Data and Salesperson Login Report

Date: 2026-10-29
Project: `D:\Business-Management-System`

## Safety

All work stayed inside `D:\Business-Management-System`. No production database, unknown MongoDB service, migration, importer, deployment, commit, push, or unrelated project was accessed. Existing local JSON files were not overwritten. A separate file was created: `data/furniture-test-store.json`.

## Salesperson login root cause

The login endpoint is `POST /api/auth/login` with JSON `{email,password}`. The frontend calls it through the Vite proxy. The current source provisions development-only Accounts and Salesperson users in `ensureDevelopmentUsers()` during non-production JSON repository loading, and the authentication path accepts the `salesman` role.

The failure was reproduced against the actual local listeners:

```text
port 4000: Accounts login HTTP 401; Salesperson login HTTP 401
port 4001: Accounts login HTTP 200; Salesperson login HTTP 200
port 4002: Accounts login HTTP 200; Salesperson login HTTP 200
```

Port 4000 was owned by an older Node process started on the previous day and was serving stale code/data. The current development account provisioning was present in the newer isolated process, not in the stale runtime state. This was an environment/process mismatch, not a password hashing or JWT role defect.

No passwords, JWTs, or credentials are printed in this report. Development-only accounts remain blocked from production seeding by the existing production guard.

## Fixes and files changed

- `apps/api/src/auth-api.test.ts` — regression coverage for idempotent development role provisioning.
- `apps/web/vite.config.ts` — added `VITE_API_TARGET` support, retaining port 4000 as the default.
- `.env.example` — documented optional `VITE_API_TARGET`.
- `scripts/seed-furniture.ts` — protected, repeatable, development-only furniture fixture seed.
- `package.json` — added `seed:furniture`.
- `data/furniture-test-store.json` — dedicated fictional local development dataset.
- `docs/phase-9-furniture-test-report.md` — this report.

No production security guard or business rule was weakened.

## Furniture seed data

The seed uses the existing Product schema: name, SKU, category, unit, selling price, stock, reorder level, and status. Description and cost price were not added because the current schema does not support them.

Actual counts:

```text
Products: 20
Customers: 9 seeded, plus 1 salesperson-created test customer through the API
Suppliers: 0 — supplier model/workflow is not implemented
Opening inventory movements: 20
Orders: 0 from the seed script; 5 created through the supported API workflow
```

The catalog contains normal-stock, low-stock, out-of-stock, and high-price furniture products. All seed records use stable `furn-test-*` identifiers and fictional labels/contact values.

The seed was executed twice. The first write added 20 products, 9 customers, and 20 opening movements. The second write added zero products, zero customers, and zero movements. It preserves existing non-test records and refuses conflicting test IDs/SKUs or unsafe targets.

## Isolated API workflow verification

The API was started on port 4002 with development JSON persistence using only `data/furniture-test-store.json`; it was not connected to MongoDB.

Verified against the real HTTP API:

- Salesperson and Accounts Staff login succeeded.
- Furniture catalog returned 20 products.
- Salesperson customer visibility was restricted to their own customer records.
- Salesperson created one fictional customer.
- Five orders were submitted through the API: pending, approved/then-dispatched, rejected with a reason, insufficient-stock pending, and multi-product pending.
- Exact retry of the same idempotency key returned HTTP 200 and the original order.
- Reusing that key with a changed payload returned HTTP 409.
- Approval succeeded once for available stock.
- Dispatch succeeded once and repeated dispatch returned HTTP 409.
- Rejection returned the order with its reason.
- Insufficient-stock approval returned HTTP 409.
- Tested stock values preserved `available = stock - reservedStock`:
  - first almirah: stock 12, reserved 0, available 12;
  - dispatched 3-door almirah: stock 7, reserved 0, available 7;
  - sliding wardrobe: stock 0, reserved 0, available 0.

Final order statuses were three Pending, one Rejected, and one Dispatched. No impossible status was inserted directly.

## Role results

Salesperson: passed isolated login, catalog access, customer creation, order submission, idempotent retry, own-order visibility, status/reason retrieval, and stock/error behavior through the API.

Accounts Staff: passed isolated login, all-order visibility, approval/rejection/dispatch operations, and stock verification through the API.

Owner/Admin: existing isolated authorization tests pass owner dashboard and owner-only settings mutation. A separate Owner session was not executed against the furniture API.

## Verification commands and results

```text
npm.cmd run seed:furniture -- --dry-run -> passed; no additions on the already-seeded target
npm.cmd run typecheck -> passed
npm.cmd test -> passed, 2 files / 17 tests
npm.cmd run build -> passed
```

The existing Vite/Vitest config-loader warning remained non-fatal. The initial `tsx` invocation encountered a machine-level Node `uv_os_get_passwd ENOMEM` error; the seed command was adjusted to use the installed TypeScript compiler and Node runtime, after which the documented dry-run command passed.

## Local startup commands

Use a new terminal and do not reuse an unknown/stale API process on port 4000:

```powershell
Set-Location D:\Business-Management-System
$env:PORT='4002'
$env:NODE_ENV='development'
$env:PERSISTENCE='json'
$env:DATA_FILE='D:\Business-Management-System\data\furniture-test-store.json'
$env:APP_ORIGIN='http://localhost:5174'
npm.cmd run dev:api
```

In a second terminal:

```powershell
Set-Location D:\Business-Management-System
$env:VITE_API_TARGET='http://127.0.0.1:4002'
npm.cmd run dev:web -- --port 5174
```

Preview or seed the dedicated file:

```powershell
Set-Location D:\Business-Management-System
$env:FURNITURE_DATA_FILE='D:\Business-Management-System\data\furniture-test-store.json'
npm.cmd run seed:furniture -- --dry-run
$env:FURNITURE_TEST_CONFIRM='YES'
npm.cmd run seed:furniture
```

The local development account details remain in the existing setup documentation; passwords are intentionally not repeated here.

## Incomplete or blocked

- Browser E2E remains blocked because no browser automation dependency or usable browser session is available.
- MongoDB persistence and transaction verification remain blocked. The existing MongoDB service on port 27017 is not known to be disposable and was not accessed.
- Suppliers, purchases, payments, expenses, daily closing, returns, reports/exports, GST/tax calculations, unit conversions, printing, and user-management UI remain incomplete.
- Structured order status history and first-run owner provisioning/password rotation remain incomplete.
- JSON persistence is suitable only for isolated local testing, not real business data or concurrent production traffic.

## Conclusion

Salesperson login works when the frontend targets the current API process and matching dedicated dataset. The observed failure was caused by a stale port-4000 API process. Furniture test data and order workflows are reproducible on isolated port 4002, while browser, MongoDB, financial modules, and production readiness remain unverified or incomplete.
