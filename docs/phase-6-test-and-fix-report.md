# Phase 6 — Test, Fix, and Regression Report

Audit date: 2026-10-29
Project: `D:\Business-Management-System`

## Scope and safety

This phase stayed inside the project directory. No commit, push, deployment, migration, JSON import, production database connection, or real business data was used. Existing local files and application data were preserved. The API workflow tests use an in-memory repository and an ephemeral localhost port; they do not connect to MongoDB.

## Baseline and verification results

The project is not a Git repository, so Git status could not be used as a change-detection mechanism. `node_modules`, `package-lock.json`, local `data/`, and generated `dist/` were present. The installed dependency tree resolved with `npm.cmd ls --depth=0`.

Commands executed from the project root:

```text
npm run typecheck  -> could not start in PowerShell: npm.ps1 is blocked by the machine execution policy
npm.cmd run typecheck -> passed
npm.cmd test -> passed, 2 test files / 16 tests
npm.cmd run build -> passed; API TypeScript emitted and Vite produced dist/web
npm.cmd ls --depth=0 -> passed; dependencies resolved
```

The test and build commands emitted the existing non-fatal Vite warning that ESM syntax in TypeScript configuration files is currently loaded through CommonJS. No command was bypassed to hide a failure; `npm.cmd` was used because the PowerShell shim was blocked.

## Files inspected

Inspected the prior audit and security reports, README, architecture, testing, setup, and known-limitations documentation; package scripts and lockfile; API configuration, server routes, repository, models, stock service, types, tests; and web API handling, login, admin screens, and salesperson workspace.

## Files changed

- `apps/api/src/auth-api.test.ts` — extended isolated HTTP coverage for invalid credentials, invalid quantities, order idempotency, reservation release, approval oversell prevention, concurrent approval requests, and duplicate dispatch.
- `apps/web/src/main.tsx` — corrected admin product and low-stock views to use the backend `available` quantity, while retaining a safe fallback for older responses.
- `docs/phase-6-test-and-fix-report.md` — this report.

No business rule, route contract, authentication protection, or production configuration guard was weakened.

## Tests executed

The existing authorization suite still passes for missing/malformed/expired authentication, owner and accounts dashboard access, salesperson order ownership, restricted financial/settings/audit/movement/customer/approval routes, owner-only settings mutation, and catalog access.

The new isolated HTTP workflow coverage passes for:

- Controlled JSON errors for invalid credentials and invalid order quantities.
- Exact idempotent order retry returning the original order.
- Reusing an idempotency key with a changed payload returning HTTP 409.
- Submission-policy reservation and one-time reservation release on rejection.
- Approval-policy oversell prevention for two pending orders competing for one unit.
- Concurrent approval requests producing one success and one conflict.
- Dispatch-policy sale finalization occurring once; repeated dispatch is rejected and only one sale movement is recorded.

Pure stock tests continue to pass for available-stock calculation, overselling rejection, reservation mismatch, release/finalization, and dispatch stock checks. Frontend response tests continue to pass for valid JSON, backend JSON errors, empty responses, and HTML/malformed gateway responses.

## Confirmed defect and fix

The API returns both `stock` (on-hand) and `available` (`stock - reservedStock`). The admin `LowStock()` and `Products()` components compared and displayed `stock`. With a reservation active, the UI could therefore overstate sellable inventory and fail to show a low-stock warning. The fixed code uses `available` and only falls back to `stock` for compatibility with older responses. The salesperson catalog already used available stock.

## Business behavior verified from source and isolated HTTP tests

- Submission policy reserves at order submission; rejection/cancellation releases the recorded reservation.
- Approval policy creates the reservation at approval and rejects competing approvals when available stock is insufficient.
- Dispatch policy consumes on-hand stock at dispatch; repeated dispatch is rejected by the transition map.
- `availableStock = onHandStock - reservedStock` is returned by the product API and is now also used by the admin UI.
- Orders are protected by per-user idempotency keys and request fingerprints.
- Salespeople receive only their own order list and cannot access restricted financial, settings, audit, movement, directory, or approval endpoints under the tested roles.
- The API serializes JSON-mode mutations with its process lock. The concurrent test verifies this behavior in the isolated in-memory/JSON-compatible repository path.

## Implemented status

Implemented and verified locally: authentication and tested role boundaries; product catalog reads; customer creation for salesperson flow; salesperson catalog/cart/customer/order-history UI; order submission; configured submission/approval/dispatch stock policy behavior; approval/rejection; idempotency; inventory movement recording for tested operations; invoice eligibility/list/create API; settings validation; audit entries; theme-aware UI; safe frontend API parsing.

Implemented but partially verified: JSON persistence; MongoDB repository and transaction code; migration safeguards; invoice creation and balance increment; frontend admin order approval/rejection; local salesperson login and order flow. MongoDB and browser verification were not performed in this phase.

Incomplete: suppliers and purchases/receiving/returns; payments, split payments, receipts, and customer due reconciliation; expenses; daily cash closing; reporting and CSV exports; centralized GST/tax calculations; configurable units/conversions; invoice print layouts; user management UI; structured order status history; full cancellation/processing/dispatch UI; first-run owner provisioning and password rotation. Several admin buttons remain visual placeholders.

Awaiting business decisions: invoice timing relative to dispatch/sale finalization; tax/GST registration and rates; payment and due-date rules; unit conversion factors; return and correction policy; printer formats and hardware integration; production owner provisioning.

## Database and concurrency limitations

No MongoDB connection was attempted. MongoDB startup requires a replica set or sharded topology for transactions, but that topology was not available for safe isolated verification. The current Mongo adapter uses a lease lock and transaction around snapshot delete/reinsert persistence. This was source-reviewed but not proven against a replica set, lease expiry, multi-instance deployment, transaction retry, or process failure. It should not be described as production-grade concurrent inventory persistence.

The JSON fallback is explicitly local-development-only and is not suitable for concurrent production traffic or financial truth. The importer and migrations were not executed.

## Browser and responsive testing

No browser automation or visual responsive session was executed in this phase. Frontend TypeScript compilation and production bundling passed, and source review covered login, API error parsing, role navigation, salesperson catalog/cart/order handling, and available-stock rendering. Actual browser login, console, network, mobile viewport, and refresh/session behavior remain partially unverified.

## Remaining risks

- Critical: Do not use real business data until MongoDB replica-set verification, atomic stock persistence design review, production provisioning, and financial workflow implementation are complete.
- High: Payments, expenses, closing, returns, reports, tax, printing, purchases, suppliers, units/conversions, and user management are incomplete.
- High: Mongo snapshot replacement and lease locking have not been validated under multi-instance or failure conditions.
- Medium: Dashboard values labeled “today” currently aggregate all loaded invoices rather than applying a business-timezone date filter.
- Medium: Invoice eligibility before dispatch is configurable only by code path today and requires an explicit business rule.
- Medium: Structured per-transition order history is not implemented.
- Low: Vite/Vitest config-loader warning remains non-fatal.

## Reproduction commands

From `D:\Business-Management-System` with dependencies installed:

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd ls --depth=0
```

These checks use isolated test repositories and do not require MongoDB. Do not run the importer or point the application at a production database.

## Safest next step

Review and approve the remaining business decisions, then create a dedicated disposable MongoDB replica-set test environment. Use it to verify transaction commit/abort, lease recovery, import refusal, and concurrent stock behavior before implementing the missing financial modules.
