# Inventory Database Architecture (MongoDB)

**Pattern:** café Inventory V3 companion collections (`INVENTORY_ARCHITECTURE.md` §0).
- Every new schema uses `strict: "throw"`, `autoCreate: false`, `autoIndex: false` and `timestamps: true`.
- Collections and indexes are created only by a manual, dry-run-first setup script that requires an explicit URI and database name.
- Money is stored as integer **paise**. Quantities and rates are **decimal strings** (≤ 6 dp), handled by one calculation module using BigInt.
- An unknown cost is `null`, never 0.

## 0. Prerequisite: Phase 0-A (atomic legacy persistence)

Today every save deletes and re-inserts all 8 legacy collections from memory (`repository.ts:47-50`).

**Phase 0-A replaces this with per-document Mongoose operations:**
- `Product.findOneAndUpdate({id, stock: {$gte}}, {$inc})`, `Order.updateOne`, etc.
- Run inside `session.withTransaction()` on Atlas, which is a replica set.
- Existing route paths and response shapes stay identical.
- The 12 existing API tests must pass, once the test harness is fixed so it cannot touch Atlas.
- No data migration is needed: the same collections, the same documents.

**Until 0-A is done, no new code may write `products`.**

## 1. Reused existing collections

| Collection | Change |
|---|---|
| `users` | Add `phone`. It is missing from the schema, so phone is dropped on save today. Also add `isActive`, `tokenVersion` and `permissions` overrides. All are additive. |
| `products` | **Unchanged fields.** `stock` and `reservedStock` become the cached FG totals, maintained only by the inventory service. Extra attributes live in `InventoryProductConfig`. |
| `orders` | Additive: `dispatchLocationId`, `dispatchedAt`, `deliveredAt`, ledger refs |
| `customers`, `invoices`, `businesssettings`, `auditlogs` | Unchanged |
| `inventorymovements` | **Frozen.** Read-only legacy history, shown in History with a "legacy" badge. Never rewritten. |
| `Erp*` (8 collections) | Untouched and unused by new code. An optional dry-run copy script exists for any data they hold. |

## 2. New collections

### Control

| Collection | Key fields | Indexes |
|---|---|---|
| `InventoryV3Settings` (`_id:"default"`) | enabled, storageVersion, revision, costingMethod (locked), negativeStockAllowed=false, approval policies `{purchaseApprovalLimitPaise, adjustmentApprovalLimitPaise, wastageAlwaysApprove, countAlwaysApprove, selfApprovalAllowed=false}`, countPolicy `{blindDefault, intervalDays|null}`, reorder defaults, numbering prefixes, FY start month (4) | — |
| `InventoryV3Operation` | requestKey, payloadHash (sha256), kind, resultRef, createdBy | `requestKey` unique |
| `InventoryV3Audit` | event, sourceRef, actor, before/after snapshot, amountPaise, calculationVersion | `sourceRef.id + createdAt` |
| `DocumentCounter` (`_id: "PO:2026-27"`) | seq | — (atomic `$inc` inside the transaction, so numbers have no gaps on commit) |

### Masters

| Collection | Key fields | Indexes |
|---|---|---|
| `InventoryCategory` | name, code, itemType, parentId, active, sortOrder | `code` unique; `itemType+name` unique |
| `UnitDefinition` | code, dimension, factorToBase (fixed units only) | `code` unique |
| `StockLocation` | code, name, type, active, system | `code` unique |
| `StockItem` | see raw §4: itemCode, sku, barcode, itemType, categoryId, spec, stockUnit, purchaseUnits[{unit,factor,version}], onHandQty, reservedQty, min/max/reorderLevel/reorderQty, leadTimeDays, preferredSupplierId, defaultLocationId, lastPurchaseRate, averageCost, hsn, gstRateBps, images[], status, revision | `itemCode` unique; `sku`, `barcode` unique partial; `itemType+categoryId+status`; text on name/code/sku |
| `InventoryProductConfig` | productId (→ `products.id`), productModelId, designId, door/drawer counts, H/W/D, thickness, material, colour, finish, lockType, handleType, weight, specs, costPrice (manufacturing cost, derived), hsn, gstRateBps, min/max, images[], status | `productId` unique |
| `ProductModel` | code, name, categoryId, doorCount, drawerCount, H/W/D (in), features[], gallery[], activeBomId, stageTemplateId, sourceRef `{file,page}` | `code` unique |
| `Design` | series, code, name, images[], sourceRef, status | `series+code` unique |
| `Supplier` | supplierCode, name, contactPerson, phone, email, address, state(+code), gstin, category, paymentTermsDays, openingBalancePaise, bank `{name, accountMasked, ifsc}` (Admin/Accountant only), notes, status | `supplierCode` unique; `gstin` unique partial; text on name |
| `SupplierItem` | supplierId, itemId, supplierItemCode, lastRate, leadTimeDays, preferred | `supplierId+itemId` unique |

### Stock

| Collection | Key fields | Indexes |
|---|---|---|
| `StockBalance` | itemKind (`STOCK_ITEM`/`PRODUCT`), itemId, locationId, qty | `itemKind+itemId+locationId` unique |
| `StockLedger` (v3) | `STOCK_LEDGER_RULES.md` §2 | `idempotencyKey` unique; `reversalOf` unique partial; `itemId+createdAt`; `refType+refId`; `type+createdAt`; `locationId+createdAt` |

### Documents

| Collection | Key fields | Indexes |
|---|---|---|
| `PurchaseOrder` | number, supplierId, status, lines[{lineNo, itemId, qty, unit, factor, rate, discountBps, gstRateBps, receivedQty, rejectedQty, returnedQty, billedQty}], freightPaise, otherChargesPaise, interState, totals, expectedDate, paymentTermsDays, notes, attachments[], submittedBy/At, approvedBy/At, rejectReason, revision | `number` unique; `supplierId+status`; `status+expectedDate` |
| `GoodsReceipt` | number, poId, supplierId, supplierInvoiceNo, receivedAt, locationId, lines[{poLineNo, itemId, receivedQty, acceptedQty, rejectedQty, rejectReason, unitCost}], status `DRAFT/POSTED/REVERSED`, inspectedBy, postedBy/At | `number` unique; `poId` |
| `PurchaseBill` | number, supplierId, supplierInvoiceNo, invoiceDate, dueDate, grnIds[], lines, taxes, freight, totalPaise, paidPaise, status `DRAFT/POSTED/PARTIALLY_PAID/PAID/CANCELLED`, attachment, importId | `supplierId + normalisedInvoiceNo + fy` unique (duplicate-invoice guard) |
| `BillImport` | file `{url, publicId, sha256, mime, pages}`, extraction `{provider, status, raw, fields, warnings, confidence}`, review state, resultingBillId/poId | `file.sha256` unique |
| `PurchaseReturn` | number, supplierId, grnId, lines[{itemId, qty, unitCost, reason}], status, debitNotePaise | `number` unique |
| `SupplierLedgerEntry` | supplierId, type `OPENING/BILL/RETURN/PAYMENT/PAYMENT_VOID/ADJUSTMENT`, amountPaise (signed), refType/refId, date, balanceAfterPaise, createdBy | `supplierId+date`; `refType+refId+type` unique |
| `SupplierPayment` | number, supplierId, amountPaise, method, reference, date, allocations[{billId, amountPaise}], proof, status `POSTED/VOID` | `number` unique |
| `Bom` | productModelId (or productId for a variant-specific BOM), version, status `DRAFT/PENDING_APPROVAL/APPROVED/ACTIVE/INACTIVE`, outputQty (yield basis), lines[{itemId, qty, unit, plannedWastageBps, isOptional, notes}], labourPerUnitPaise, overheadPerUnitPaise, otherCosts[], approvedBy/At, supersedes | `productModelId+version` unique; one ACTIVE per model (partial unique) |
| `ProductionStageTemplate` | name, stages[{code, name, order, requiresQc}] | `name` unique |
| `ProductionOrder` | `PRODUCTION_WORKFLOW.md` §3 | `number` unique; `status+expectedDate`; `productId` |
| `MaterialIssue` | number, productionOrderId, kind `ISSUE/RETURN/ADDITIONAL`, lines[{itemId, qty, locationId, unitCost}], status `REQUESTED/APPROVED/POSTED/REJECTED` | `number` unique; `productionOrderId` |
| `ProductionOutput` | productionOrderId, batchNo, producedQty, acceptedQty, reworkQty, rejectedQty, qcBy/At, qcNotes, unitCostPaise, postedAt | `productionOrderId+batchNo` unique |
| `WastageRecord` | number, itemKind/itemId, qty, unit, wastageType, reason, productionOrderId?, grnId?, source `STORE/PRODUCTION`, images[], costPaise (on approval), status `PENDING/APPROVED/REJECTED`, reportedBy, approvedBy | `number` unique; `status+createdAt`; `productionOrderId` |
| `StockCountSession` | number, scope `FULL/CATEGORY/LOCATION/ITEMS`, blind, assignedTo[], status `DRAFT/IN_PROGRESS/SUBMITTED/APPROVED/REJECTED/POSTED`, lines[{itemKind, itemId, locationId, systemQtyAtStart, watermarkLedgerId, countedQty, varianceQty, reason}], approvedBy | `number` unique; `requestKey` unique |
| `StockAdjustment` | number, type `INCREASE/DECREASE/DAMAGED/MISSING/OPENING_CORRECTION/DATA_CORRECTION/FOUND/OTHER`, lines[{item, location, currentQty, adjustQty, newQty}], reason (required), attachment, status `PENDING/APPROVED/REJECTED/POSTED`, requestedBy, approvedBy, sourceCountId? | `number` unique |
| `StockTransfer` | number, fromLocationId, toLocationId, lines[{item, qty, dispatchedQty, receivedQty}], status `REQUESTED/APPROVED/DISPATCHED/PARTIALLY_RECEIVED/RECEIVED/CANCELLED` | `number` unique |

## 3. Integrity mechanisms

1. **`transact(req, kind, fn)`**, copied from café V3. It does the following:
   - Requires a `requestKey`.
   - Hashes the payload; a replay returns the first result, and a different payload under the same key returns 409.
   - Runs a `withTransaction` that re-checks the feature switch, performs the change, writes the ledger and audit rows, and records the operation.
2. **Guarded decrements:**
   - `StockBalance.findOneAndUpdate({.., qty: {$gte: q}}, {$inc: {qty: -q}})`.
   - Item totals: `{onHandQty − reservedQty ≥ q}` for issues and dispatch.
   - If the guard fails, the transaction aborts with a 409 that lists the shortages.
3. **Document-state guards.** Every transition is a conditional update on the current status, e.g. `{_id, status: "APPROVED"}` → `POSTED`. The second of two concurrent posts finds nothing and fails, so double posting is impossible.
4. **Ledger idempotency key** per line, e.g. `GRN:<id>:<line>`, `ISSUE:<id>:<line>`, `OUTPUT:<poId>:<batch>`, `WASTE:<id>`, `COUNT:<id>:<line>`, `XFER:<id>:<line>:OUT|IN:<seq>`, `DISPATCH:<orderId>:<line>`. A unique index makes a duplicate physically impossible.
5. **Optimistic locking** (`revision`) on masters and draft documents.
6. **Count watermark:** approval fails if any ledger row for the item and location is newer than the session's watermark (café V3).
7. **Nightly reconciliation (read-only report):**
   - Σ ledger qty per item and location = `StockBalance`.
   - Σ balances = item totals.
   - Mismatches raise an alert. Nothing is auto-fixed.

## 4. Migrations (all non-destructive; each needs your approval and an Atlas snapshot plus `mongodump` first)

| # | Migration | Method |
|---|---|---|
| M0 | Read-only inventory of current Atlas data (counts per collection, sample shapes) | Script prints counts only |
| M1 | Setup script creates the new collections and indexes | Dry run, then apply (staging first) |
| M2 | For each existing product, create a `StockBalance` at Main Warehouse = current `stock`, plus one `OPENING` v3 ledger row referencing "migrated from legacy" | Idempotent (`MIGRATE:<productId>`) and dry-run first. Legacy rows untouched. |
| M3 | Optional: copy any `ErpRawMaterial`/`ErpBom` docs into `StockItem`/`Bom` as DRAFT | Dry-run diff first |
| M4 | Seed categories, units, system locations, stage template, the 8 body models and the design series (names/specs only) | Only after you approve the seed list |

**Out of scope:** no collection is ever dropped, renamed or bulk-rewritten.

## 5. API layout

All routes sit under `/api/inventory/v3/…` and are mounted **after** helmet, CORS and the rate limiter. They are gated by `requireV3` plus permission middleware. The legacy `/api/inventory/movements` route is kept.

| Group | Endpoints |
|---|---|
| `dashboard` | Dashboard |
| `items` | `GET` (filters, paging), `POST`, `PATCH /:id`, `POST /:id/deactivate`, `GET /:id/history` |
| Masters | `categories`, `units`, `locations`, `suppliers` (+`/:id/ledger`, `/:id/statement`), `supplier-items` |
| Purchasing | `purchase-orders` (+ `/submit`, `/approve`, `/reject`, `/cancel`, `/close`), `goods-receipts` (+`/post`), `purchase-bills` (+`/post`), `bill-imports` (+`/extract`, `/confirm`), `purchase-returns` (+`/post`), `supplier-payments` (+`/void`) |
| Manufacturing | `boms` (+`/submit`, `/approve`, `/activate`, `/cost-preview`), `production-orders` (+ transitions, `/requirements`, `/stages/:code`), `material-issues` (+`/approve`, `/post`), `production-outputs` (+`/qc`, `/post`) |
| Stock control | `wastage` (+`/approve`, `/reject`), `stock-counts` (+`/submit`, `/approve`, `/post`), `adjustments` (+`/approve`, `/post`), `transfers` (+`/approve`, `/dispatch`, `/receive`), `ledger` (+`/:id/reverse`) |
| Reporting & config | `alerts`, `reports/:report?format=json\|csv`, `settings` (GET; PATCH with revision, Admin only) |

**Conventions:**
- Every list endpoint is paginated (`page`, `limit ≤ 100`, `X-Total-Count`).
- Validation uses zod.
- Errors come back as `{error, code, details?}`.
- Every mutation requires `requestKey`.
