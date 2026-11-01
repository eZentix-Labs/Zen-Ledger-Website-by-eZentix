# Product and Material Data Model

The implementation extends the existing Mongoose backend without replacing the current User, Product, Customer, Order, Invoice, Settings, AuditLog, and InventoryMovement models.

## Added ERP models

- `ErpCategory`: hierarchical categories, slug, image, active state.
- `ErpRawMaterial`: code, unit, purchase/average cost, available/reserved stock, minimum stock, supplier reference.
- `ErpBom`: product, immutable incrementing version, material lines, quantities, wastage, cost basis, active state.
- `ErpStockLedger`: append-only movement records with movement type, reference, user, notes, and idempotency key.
- `ErpProduction`: BOM version, planned/actual quantity, status, estimated/actual cost, labour, overhead, consumption.
- `ErpPayment`: order association, amount, method, date, reference, recorder, idempotency key.
- `ErpAssignment`: salesman category/product access lists.
- `ErpCatalogueSource`: PDF filename, page count, extraction/review state, review notes.

## API surface

- `GET/POST/PATCH /api/erp/categories`
- `GET/POST/PATCH /api/erp/materials`
- `GET/POST /api/erp/boms`
- `GET /api/erp/productions`
- `POST /api/erp/productions`
- `PATCH /api/erp/productions/:id/status`
- `GET/POST /api/erp/payments`
- `GET/PUT /api/erp/salesmen/:salesmanId/assignment`
- `GET /api/erp/catalogue-sources`

All routes require JWT authentication. Admin-only writes are restricted to `owner`, `accounts`, and `admin`; salesman assignment reads are ownership checked.

## Cost rules

Estimated material cost is calculated from BOM quantity, planned production quantity, wastage percentage, and configured line cost basis. It is not presented as actual cost. Actual material, labour, and overhead costs are stored separately.
