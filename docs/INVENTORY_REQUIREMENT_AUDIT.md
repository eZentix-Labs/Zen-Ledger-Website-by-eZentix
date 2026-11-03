# Inventory Requirement Audit

**Date:** 2026-11-03.
**Coverage:** both inventory prompts (the "Enterprise Inventory" prompt and the "Almari Manufacturing ERP" prompt).
**Legend:** ✅ exists and usable · 🟡 partial · ❌ missing. File references point to this repository.

## 1. Existing inventory-related code (inspected)

| Area | What exists | Usable as-is? |
|---|---|---|
| Inventory page | **There is none.** The admin nav has Overview, Products, Orders, Invoices, Customers, Salesmen, Settings (`frontend/src/main.tsx:8`). Products is a plain table with a coloured dot instead of an image. | ❌ |
| Finished-goods stock | `products.stock`, `reservedStock`, `reorder` (`backend/src/models.ts:5`); `available = stock − reserved` (`stock.ts:3`) | 🟡 Logic is sound but has no locations, cost or images |
| Finished-goods ledger | `InventoryMovement` with types `opening, reservation, reservation_release, sale` (plus unused `purchase_receipt, return, adjustment`) and before/after on-hand and reserved (`types.ts:9`, `stock.ts`) | 🟡 A good shape to extend. Has no cost, location or approval. |
| Stock policy | Reserve at submission, approval or dispatch, and it can't be changed while orders are active (`server.ts:56-62`) | ✅ Must be preserved |
| Raw materials | `ErpRawMaterial` model + CRUD API (`erp-models.ts:14`, `erp-routes.ts:68-84`) | ❌ Stock never changes. PATCH writes the raw request body (mass assignment). |
| Raw-material ledger | `ErpStockLedger` + POST route | ❌ **Broken:** route types `adjustment_in/out` are not in the schema enum, and it writes `createdBy`, which the schema doesn't have. It never updates the balance. |
| BOM | `ErpBom` with versioning and wastage % | 🟡 Model is reusable. Keyed to a product id, not a body model. No approval and no UI. |
| Production | `ErpProduction` with free status changes | ❌ No transition rules, consumption or output |
| Suppliers / purchases / GRN / returns | — | ❌ |
| Locations / transfers / counts / adjustments / wastage | — | ❌ |
| Valuation / costing | — (`products` has no cost field) | ❌ |
| Reports / settings | Settings has only businessName, currency, stockPolicy, taxEnabled | ❌ |
| Cloudinary / uploads | — (no code; `grep` finds nothing) | ❌ |
| Permissions | Role checks only. ERP routes treat Accountant like the owner and accept a non-existent `admin` role. They are mounted **before** helmet, CORS and the rate limiter (`server.ts:20` vs `:22`). | ❌ |
| Persistence | Whole-database rewrite on every save (`repository.ts:47-50`) | ❌ **Blocks all transactional inventory work** until Phase 0-A |

## 2. Requirement matrix

| Requirement (prompt section) | Status | What has to happen |
|---|---|---|
| Item types: raw, finished, semi-finished, consumables, packaging, spare parts, other (E§4, A§3) | ❌ | New `StockItem` master with an `itemType` |
| Admin-configurable categories (A§3) | 🟡 `ErpCategory` exists for products | New `InventoryCategory` scoped by item type, seeded from the PDFs (raw §5) |
| Material dimensions: grade, thickness, length, width, diameter, weight (A§3) | ❌ | Structured `spec` fields |
| Units + valid conversions (E§4, A§3) | ❌ | Unit dimensions + material-specific factors (raw §3) |
| Accessories & components as a separate tab (A§4) | ❌ | A filtered view of itemType `COMPONENT` |
| Add Stock Item with opening-stock ledger (E§5) | 🟡 Product create writes an opening movement | Generalise for all item types |
| Stock list with filters and actions (E§4) | ❌ | Stock tab |
| Deactivate rather than delete items with history (E§4) | ❌ | Enforced in the service |
| Suppliers + ledger + statement (E§6, A§5, E§18) | ❌ | `Supplier`, `SupplierLedgerEntry` |
| Supplier ↔ material mapping (A§5) | ❌ | `SupplierItem` (rate, lead time, preferred) |
| PO with 8 statuses, approval, GST/discount/freight (E§7, A§6) | ❌ | `PurchaseOrder` |
| GRN with inspection accept/reject and partial receipt (E§7, A§6) | ❌ | `GoodsReceipt` |
| Purchase bill as the accounting event (E§18) | ❌ | `PurchaseBill`, matched to GRNs |
| Purchase returns (E§7) | ❌ | `PurchaseReturn` |
| Bill import from PDF or image with review (E§8, A§7) | ❌ | Attachment + review screen. The extraction provider is a decision (workflow §4). |
| BOM with accessories, labour, overhead, versions, approval (E§9, A§9) | 🟡 | Extend into `Bom` (header + versions + approval) |
| Production orders with 9 statuses, issue, partial completion, QC (E§10, A§10) | ❌ | `ProductionOrder`, `MaterialIssue`, `ProductionOutput` |
| Configurable manufacturing stages + WIP board (A§10–11) | ❌ | `ProductionStageTemplate` + stage progress per order |
| Wastage with approval and planned-vs-actual (E§11, A§12) | ❌ | `WastageRecord` |
| Physical count: blind, assigned, by category or location (E§12, A§14) | ❌ | `StockCountSession` (café V3 watermark pattern) |
| Adjustments with approval (E§13) | ❌ | `StockAdjustment` |
| Locations + transfers with in-transit and partial receipt (E§14) | ❌ | `StockLocation`, `StockBalance`, `StockTransfer` |
| Finished-goods statuses: Available / Reserved / Quality Hold / Damaged / Dispatched (A§13) | 🟡 Reserved exists | Location types for hold and damaged; "In production" comes from WIP |
| Unified stock ledger with in/out, before/after, cost, locations, approver (E§15, A§15) | 🟡 Finished goods only | `StockLedger` v3 (ledger rules) |
| Reversals instead of deletes (E§15) | ❌ | Ledger rules §6 |
| Reorder: min, max, reorder level/qty, lead time, suggested qty, "Create purchase draft" (E§16) | 🟡 `reorder` on products only | Raw §6 |
| Valuation method (WAC or FIFO), consistent, with historical cost kept (E§17) | ❌ | Weighted average, recommended (costing §5) |
| Finished goods linked to the existing Products module, with images and specs (E§19, A§8, A§13) | 🟡 | Keep `products` as the finished-goods item + companion config |
| Dispatch decreases stock exactly once (E§19, A§13) | ✅ (`finalizeSale`) | Route through the new ledger; keep the semantics |
| Dashboard: metrics, cost control, completeness, "how stock changes" panel, date filters (E§3, A§16) | ❌ | Overview tab (plan §4) |
| 18 reports with filters and CSV/PDF export (E§20, A§18) | ❌ | Reports tab. CSV needs no new package; PDF needs a dependency, to be decided. |
| Inventory settings (E§21) | ❌ | `InventoryV3Settings` + master lists |
| Role and permission management, backend-enforced (E§22, A§17) | ❌ | Permission matrix (`SALESMAN_TARGET_ARCHITECTURE.md` §1) + inventory keys (plan §6) |
| Transactions, idempotency, concurrency, single source of truth (E§23, A§19) | ❌ | Café V3 `transact()` + guarded `$inc` |
| `/api/inventory/*` route groups (E§24) | ❌ | New routes under `/api/inventory/v3/*`, following café V3. Legacy `/api/inventory/movements` is kept. |
| Reference UI: dark navy/purple, quick actions, tabs (E§2, A§16) | 🟡 The existing `styles.css` already uses an almost identical palette | Plan §4 |

## 3. What must be reused, modified, or added

**Reused unchanged:**
- `users` and authentication (JWT + bcrypt)
- `customers`
- `orders` and their status flow
- the stock-policy setting
- the reservation semantics in `stock.ts`
- the order idempotency key
- the i18n strings
- the colour palette

**Modified:**
- `products`: becomes the finished-goods item. It keeps its id, sku, price, stock and reservedStock fields and its API shape. New attributes go into a companion config.
- `InventoryMovement`: frozen as legacy history and shown read-only in History. New rows go to the v3 ledger.
- `repository.ts`: replaced by atomic per-document writes (Phase 0-A).
- The order dispatch, cancel and reject paths: call the inventory service instead of mutating the in-memory store.
- `server.ts`: fix middleware order; remove the duplicate `/api/dashboard`.

**Added:** everything marked ❌ above, as companion collections (`INVENTORY_DATABASE_ARCHITECTURE.md`).

**Not reused:** the `Erp*` collections and routes. They stay untouched and unmounted from the UI. If Atlas holds any `Erp*` records, a dry-run script copies them into the new collections; the originals are never altered.

## 4. Verification behind this audit

| Check | Result |
|---|---|
| Backend `tsc --noEmit` | Pass (run earlier today) |
| Frontend `tsc --noEmit` | 2 errors, both tooling-only (run earlier today) |
| Frontend `vite build` into a scratch folder | Pass (run earlier today) |
| Backend tests | **Not run.** `vitest` is missing, and the test file loads the production `.env` before switching to test settings. |
| Database | **Not contacted** |
