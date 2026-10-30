# Phase 5B — Safety and Integration Audit

Audit date: 2026-10-28

Scope: read-only review of `D:\Business-Management-System` after Phase 5A. No database connection, importer, migration, deployment, commit, or production action was performed.

## Current state

- Project is not a Git repository (`git status` was not available).
- `node_modules` and `package-lock.json` are present.
- Generated `dist/` output and local npm/Vitest caches are present; they are build artifacts, not source changes.
- Installed versions include Express 5.3.0, Mongoose 9.11.4, TypeScript 7.0.2, Vite 8.3.5, and Vitest 5.0.5.
- Existing Zen OS-inspired frontend was not modified during this audit.

## Findings

### High — MongoDB persistence is still snapshot replacement

Evidence: `apps/api/src/repository.ts`, `MongoRepository.save()`.

Every mutation loads the full in-memory store, then deletes and reinserts the application collections inside a transaction. A MongoDB lease lock is acquired by `runExclusive()` in `apps/api/src/server.ts`, which reduces concurrent-writer races, but it is not an atomic product-level stock update. The lock has a 120-second lease and the design remains vulnerable to lease expiry during an unexpectedly long mutation or to operational failures around lock ownership.

Transactions require a replica set or sharded MongoDB topology; startup rejects a standalone topology. This topology was not verified during this audit. The current design should not be called production-safe for multi-instance or high-volume use until stock updates and ledger writes use atomic conditional operations.

### High — Known seed credentials remain usable

Evidence: `apps/api/src/repository.ts`, `makeSeed()`, and `apps/web/src/main.tsx`, `Login()`.

An empty datastore is seeded with `owner@example.com` / `ChangeMe123!`, and the same credentials are displayed in the login UI. Documentation says to change them, but the application does not force a password change or disable the seed account. This is not acceptable for real business data until first-run credential rotation or an equivalent setup gate exists.

### High — Core business workflows are not implemented end to end

Evidence: `apps/api/src/server.ts` and `apps/web/src/main.tsx`.

Implemented API pieces include login, product creation, customer creation, order submission, approval/rejection/cancellation, dispatch transition, invoice creation, settings, and stock movement storage. Missing or incomplete workflows include purchases/receiving, suppliers, payments, split payments, expenses, daily closing, returns, reports/exports, printing, user management, and a salesman mobile catalog/cart/order screen.

Several frontend controls are non-functional placeholders: Add product, Add customer, New invoice, Quick actions, and View report do not call the API. The frontend does not submit orders, does not send `Idempotency-Key`, and only exposes approve/reject actions for orders.

### High — Financial and stock integration remains unverified

Evidence: `apps/api/src/stock.test.ts`, `vitest.config.ts`, and the API routes.

Only pure stock unit tests are present. There are no API integration tests for authentication, role boundaries, order idempotency, concurrent mutations, Mongo transactions, invoice eligibility, or migration safety. The passing 5/5 stock tests do not verify the HTTP handlers, persistence, or database behavior.

### Medium — Structured order status history is missing

Evidence: `apps/api/src/types.ts`, `models.ts`, and `server.ts`.

Orders store current status, reason, timestamps, and a generic audit message, but there is no `OrderStatusHistory` collection or structured per-transition actor/timestamp record. This does not meet the requested traceable order-history requirement.

### Medium — Frontend displays on-hand stock where available stock is required

Evidence: `apps/api/src/server.ts`, `/api/products`, and `apps/web/src/main.tsx`, `LowStock()` and `Products()`.

The API returns `available`, but the frontend filters and displays `stock` against reorder thresholds. With reservations active, this can overstate stock availability and mislabel low-stock products.

### Medium — Dashboard “today” metrics are not date-filtered

Evidence: `apps/api/src/server.ts`, `/api/dashboard`.

The dashboard labels sales and collections as today’s values, but sums all invoices in the loaded store. This is a business-reporting correctness issue.

### Medium — Invoice timing is not fully defined

Evidence: `POST /api/invoices/from-order/:id` in `apps/api/src/server.ts`.

Invoices may be created for `Approved` and `Processing` orders before dispatch/sale finalization. Whether this is valid depends on the confirmed business rule. It must be explicitly decided before financial use, especially under the `dispatch` stock policy.

### Medium — Salesman customer access is safe but incomplete

Evidence: `GET /api/customers` and `POST /api/customers` in `apps/api/src/server.ts`.

Salesmen can create customers but cannot list the directory. This avoids exposing all customer balances and contacts, but there is no assignment/visibility model for permitted customer selection.

### Medium — JSON fallback writes are not crash-atomic

Evidence: `JsonRepository.save()` in `apps/api/src/repository.ts`.

The fallback writes directly to `data/store.json`. It is documented as development-only, but a process interruption during write could leave a truncated file. It must not be used for real data.

### Low — Vite config warning remains

Evidence: `apps/web/vite.config.ts` and `vitest.config.ts`.

Build and tests pass, but Vite/Vitest warn that ESM syntax in TypeScript config files is being loaded through CommonJS and that native config loading behavior will change in a future major version. This is not currently a functional failure.

## Authorization review

Verified from server route declarations:

- Owner/accounts: dashboard, invoices, settings read, inventory movements, audit log, approvals, invoice creation.
- Owner only: settings changes.
- Owner/accounts: product creation and customer directory read.
- Owner/salesman: order creation.
- Authenticated roles: product catalog and own/all order listing according to role.
- Salesmen see only orders where `createdBy` matches their user id.

No route was exercised over HTTP during this audit. Authorization conclusions are based on source inspection, not runtime integration tests.

## Stock behavior reviewed

- `available()` returns `stock - reservedStock`.
- Submission policy reserves at order creation.
- Approval policy reserves at approval.
- Dispatch policy deducts on-hand stock at dispatch.
- Rejection/cancellation releases only when `stockReserved` is true.
- Invalid status transitions are rejected by the transition map.
- Repeated dispatch is rejected because `Dispatched` has no self-transition.
- Idempotency keys are fingerprinted and conflicting reuse returns 409.
- Mutation rollback restores the in-memory snapshot if the operation throws or persistence fails.

These behaviors are supported by source inspection and pure stock tests only. Concurrent HTTP requests and MongoDB transactions were not executed.

## Business functionality matrix

| Area | Status | Evidence |
|---|---|---|
| Authentication and role middleware | Implemented, unverified over HTTP | `server.ts` |
| Products/catalog | Partially implemented | API exists; frontend create flow is placeholder |
| Stock reservation/finalization | Partially implemented | Pure stock tests pass; no API/Mongo tests |
| Orders/approval | Partially implemented | API transitions exist; salesman UI missing |
| Invoices | Partially implemented | Creation/list API exists; payments/printing missing |
| Purchases/suppliers | Missing | No routes/models/UI |
| Payments/customer dues | Missing | No payment routes/models/UI |
| Expenses/daily closing | Missing | Dashboard reports expenses as zero |
| Returns/adjustments | Missing | No routes or workflows |
| Reports/exports | Missing | Dashboard View report is non-functional |
| GST/tax | Configuration flag only | No centralized tax calculation |
| Unit conversions | Missing | Product unit is a display string only |
| Salesman mobile app | Missing/incomplete | No catalog/cart/order screen |
| Printing | Missing | No print layouts or print CSS workflow |
| Mongo migration | Implemented but unverified | Importer is guarded; not executed |

## Verification executed

Executed from `D:\Business-Management-System`:

```text
npm run typecheck  -> passed
npm test           -> passed, 1 file / 5 tests
npm run build      -> passed, frontend bundle generated
npm ls --depth=0   -> passed, dependencies resolved
```

The test and build commands emitted only the Vite/Vitest config-loader warning described above. No MongoDB connection, importer, migration, API server, or browser workflow was executed.

## Test coverage gaps

High-risk missing tests:

- HTTP authentication and authorization by role.
- Salesman cross-user order access.
- Idempotency-key reuse with changed payload.
- Duplicate order and invoice requests over HTTP.
- Multi-line reservation rollback.
- Concurrent orders competing for the same product.
- MongoDB replica-set transaction commit/abort behavior.
- Lease expiry and lock recovery.
- Migration refusal for non-empty or production-like databases.
- Dashboard date filtering.
- Frontend/API response contract tests.
- Invoice timing and dispatch-policy reconciliation.

## Prioritized remediation plan

1. Force first-run credential rotation and remove demo credentials from the production UI.
2. Add API integration tests with disposable local MongoDB replica-set infrastructure.
3. Replace snapshot stock mutation with atomic conditional product updates and append-only ledger writes.
4. Add structured order status history and explicit invoice timing rules.
5. Correct frontend use of `available` stock and implement actual product/customer/order/invoice actions.
6. Implement payments, expenses, daily closing, returns, reports, printing, tax, units, and salesman mobile workflows.
7. Make the JSON fallback crash-atomic or disable it outside development.

## Safety conclusion

The TypeScript, unit-test, and frontend build checks pass, but the application is not production-ready and must not be used with real business data. MongoDB behavior, HTTP authorization, concurrent requests, migration behavior, financial reconciliation, and the majority of business workflows remain unverified or incomplete.
