# Implementation Roadmap

## P0 — Client demonstration

1. Resolve deployed Render CORS and environment URL configuration.
2. Fix frontend typecheck dependencies/errors (`vitest`, Node typing for Vite config).
3. Verify Admin/accounts/salesman browser login.
4. Connect Admin product/category forms to the existing APIs.
5. Connect Salesman mobile catalogue to active product/category data.
6. Verify customer creation and order submission end to end.
7. Verify Admin order review/status updates and Salesman status tracking.
8. Add browser workflow tests with isolated test data.

## P1 — Core ERP

1. Complete raw-material stock ledger operations.
2. Add Admin UI for BOM creation/versioning.
3. Add production reservation and consumption transactions.
4. Add payment UI and outstanding balance aggregation.
5. Add salesman assignment UI and ownership tests.
6. Add reviewed PDF catalogue import with duplicate detection.

## P2 — Business insights

1. Finished-goods stock integration.
2. Production cost and variance reporting.
3. Salesman/product/category reports.
4. Expense and profit/loss reporting with incomplete-cost indicators.
5. Low-stock alerts and dashboard aggregations.

## P3 — Future

1. PWA installability/offline catalogue cache.
2. Realtime order notifications.
3. Supplier purchasing workflow.
4. Advanced reporting exports.
