# Implementation Status

## Completed in this implementation pass

- Added protected ERP backend routes under `/api/erp`.
- Added category management persistence.
- Added raw-material model and Admin CRUD endpoints.
- Added immutable BOM version creation and estimated material-cost calculation.
- Added production planning/status persistence.
- Added payment persistence with idempotency-key protection.
- Added salesman category/product assignment persistence with ownership checks.
- Added catalogue-source metadata model without inventing PDF product data.
- Preserved the existing backend architecture and existing API routes.

## Not yet complete

- Admin UI for the new ERP endpoints.
- Mobile Salesman UI integration with the new assignment/catalogue endpoints.
- Atomic material reservation/consumption against production completion.
- Finished-goods stock integration.
- PDF OCR/rendered-page review and approved import.
- Payment balance aggregation against existing invoices/orders.
- Production browser verification.
- Production build and browser E2E verification.

## Verification

Backend typecheck must be rerun after the new files are added. No production database was intentionally queried or mutated.
