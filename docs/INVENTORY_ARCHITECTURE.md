# Inventory, Purchasing and Manufacturing Architecture

> **Superseded (2026-11-03)** by the detailed inventory document set listed in `ALMARI_MANUFACTURING_BUSINESS_AUDIT.md`. This file is kept for history. §0 (the café V3 pattern) still describes the approach.

**Status:** Proposal for approval. No code has been written.
**Companion docs:** `BUSINESS_REQUIREMENT_AUDIT.md` (facts), `SALESMAN_TARGET_ARCHITECTURE.md`, `IMPLEMENTATION_ROADMAP.md`.

The design is described per domain entity. §9 maps each entity to the **legacy Mongo app (A)** and the **Postgres rebuild (B)**, so the same design applies whichever you choose.

---

## 0. Pattern: built like the café project's Inventory V3

**Reference:** `D:\Adds_cafe\Restaurant-Management-System`, branch `feature/inventory-v3`. I read its models, write operations, read service and UI tabs. I made no changes there.

The almirah inventory reuses V3's **engineering pattern**. It does **not** reuse V3's restaurant data: there are no dishes, food cost, gas, staff meals or cooking units. All master data comes from your catalogues (§0.4).

### 0.1 What is carried over unchanged

| Café V3 mechanism | Where it lives there | Used here for |
|---|---|---|
| **Companion collections.** New collections sit alongside the legacy ones. Legacy schemas, routes and response shapes are not changed. | `config/inventoryV3Models.js` | Everything new (suppliers, raw materials, POs, BOM, production, counts) is added without touching `users/products/orders/invoices` |
| **Two-switch feature gate.** The server env `INVENTORY_V3_ENABLED`, the runtime setting `enabled` (with `revision`) and the admin build flag `VITE_INVENTORY_V3`. The old page stays selectable for instant rollback. | `inventoryV3SettingsService.js`, `useInventoryV3Flag.js` | The current Products/Overview pages stay intact until you switch over |
| **`transact()` wrapper.** It requires a `requestKey` and stores a SHA-256 of `{kind, path, user, body}` in an `Operation` record. A replay returns the first result; the same key with different data returns 409. One Mongo transaction re-checks the switch, runs the mutation and writes the operation record. | `inventoryV3Operations.js:45-73` | Every stock or money write: GRN, production completion, adjustments, counts, payments |
| **Guarded stock updates.** `findOneAndUpdate({_id, stock: {$gte: q}}, {$inc: …})` writes the ledger row with `balanceAfter` in the same transaction. | `adjustStock`, `saveWastage` | Negative stock is impossible, even under concurrent requests |
| **Optimistic concurrency.** Edits must send the `updatedAt`/`revision` they read. A stale edit returns 409 ("Refresh before editing"). | `saveItem`, settings PATCH | Material, product and BOM edits |
| **Count sessions with a ledger watermark.** A count records the latest ledger id per item. Approval is rejected if stock has moved since then. | `submitCount` / `approveCount` | Physical stock-taking of sheets, locks and finished almirahs |
| **Exact calculation module.** Uses BigInt, paise and micro-quantities, rounds once per line and stamps every figure with a `CALCULATION_VERSION`. **An unknown cost is `null`, not 0**, so totals that depend on it show as "incomplete". | `utils/inventoryV3Calculations.js` | This matters here: the PDFs have no prices, so until you enter costs the UI shows "cost not entered" and never ₹0 |
| **Manual setup script.** `autoCreate`/`autoIndex` are false. It runs dry-run by default, needs an explicit URI, refuses a mismatched database name, never drops indexes and never backfills. | `scripts/setup-inventory-v3.js` | Creating the new collections and indexes on Atlas only when you run it |
| **One workspace read per screen.** The server computes all money, and financial fields are blanked for non-admin roles. | `inventoryV3ReadService.js:workspaceData` | The overview and tab payloads. Salesmen never receive cost data. |
| **"Needs attention" checklist.** It shows what's missing, e.g. "count due" or "days with no purchase entered", instead of guessing. | `books.checks` | Missing costs, unpriced variants, models without a BOM, overdue POs, counts due |
| **Bill photo as proof.** Only `https://res.cloudinary.com/...` URLs are accepted. There is no OCR. | `attachment()` | Supplier invoice photo on a GRN |
| **Reversals instead of deletes**, with partial unique index `reversalOf`. | financial entries | Ledger rows, supplier payments, expenses |

### 0.2 What is different for an almirah factory

| Café V3 | Almirah version | Why |
|---|---|---|
| Recipe per menu dish | **BOM per body model**, versioned, with wastage % (§7.1) | A body is manufactured. Designs only change the print panel. |
| Sale deducts ingredients automatically | **Production order** consumes materials and outputs finished almirahs. A sale deducts **finished goods** through the existing order reservation flow. | Two-stage stock: raw materials, then finished goods |
| Purchase = immediate stock-in | **PO → approval → GRN** (partial allowed), and only the GRN moves stock (§6) | Your prompt §2.4 |
| Food-cost % vs target (35%) | **Material-cost % of selling price** per variant vs a target margin you set. A minimum selling price is suggested by rounding **up**, exactly like V3's `targetPrice`. | Same maths, different meaning |
| Loss kinds: waste / staff free meal | **Scrap (cutting/production), damaged (handling/transit), defective finish, missing, count variance (unexplained)** | Factory losses |
| Units g/kg/ml/l/pcs/dozen/packet/box | **sheet, kg, g, litre, ml, metre, feet, sqft, piece, set, box**, with material-specific conversions (1 sheet = N kg) | Steel is bought by weight and used by sheet |
| Expense categories: Rent, Gas, Electricity… | **Factory expenses:** electricity, labour/wages, rent, transport/freight, machine repair, powder-coating job work, packaging, other. These feed production overhead and (later) P&L. | Business-specific |
| Count every 4 days | Count interval is configurable. **No default is assumed**; you choose, e.g. monthly for raw materials. | Business-specific |

### 0.3 Collections (option A, Mongo)

Following V3, every new collection uses `strict: "throw"`, `autoCreate: false` and `autoIndex: false`, and is registered only when the feature switch is on.

| Collection | Purpose | Key unique indexes |
|---|---|---|
| `InventoryV3Settings` (`_id:"default"`) | enabled, storageVersion, revision, countIntervalDays, materialCostTargetBps (null until set), adjustmentApprovalThresholdPaise, overReceiptToleranceBps | — |
| `InventoryV3Operation` | requestKey, payloadHash, kind, resultRef | `requestKey` |
| `InventoryV3Audit` | sourceRef, event, amountPaise, calculationVersion, actor, snapshot | — |
| `Supplier` | §3 fields | `gstin` (partial), `phone` |
| `RawMaterial` | §5 fields; `stockQty`/`reservedQty` as decimal strings | `code` |
| `ProductModel`, `Design` | §4 | `code`; `series+code` |
| `InventoryProductV3Config` | **Companion to legacy `products`** (like V3's `itemConfig`): modelId, designId, costPricePaise, gstRateBps, hsn, minStock, images[] | `productId` |
| `Bom` | model, version, lines, active | `modelId+version`; one active per model (partial) |
| `PurchaseOrder`, `GoodsReceipt`, `PurchaseReturn`, `SupplierPayment` | §6 | `number`; `requestKey` |
| `ProductionOrder` | §7.2 | `number` |
| `StockLedgerV3` | Unified ledger (§8.1) for raw materials **and** finished goods | `idempotencyKey`; `reversalOf` (partial) |
| `CountSession` | Submit/approve with watermark | `requestKey` |
| `AdjustmentRequest` | §8.3 | `requestKey` |
| `FactoryExpense` (+ recurring rule) | Overhead and P&L inputs | `requestKey`, `occurrenceKey` |

**Left untouched:** the unused `Erp*` collections. They stay read-only. If they contain data, it is copied into the new collections by an explicit, dry-run-first script, and the originals are never altered.

### 0.4 Real master data from your catalogues (seeded as names/specs only; no prices, costs or quantities)

- **Category:** Steel Almirah.
- **Body models:** Heavy 3, Eco 2, Classic 2, Classic 3, Eco 3, Classic SPL 2, Premium 2(L), Premium 2, with the verified dimensions and feature lists from the audit §2.1.
- **Design series:**
  - SRH (16 codes listed on Steel Raj p.2)
  - FM 901–1000 ("Premium Design")
  - Luxury Photo NO-01–100 (6 pages need a visual check)
  - SDH-01–100
  - Each design keeps its source file and page.
- **Raw-material categories:** E.D.D steel sheet, pre-treatment (7-tank) chemicals, phosphating chemicals, powder coat, locks (Maruti), hinges, handles, churi stand, internal light, drawer fittings, door print panels, fasteners, packaging. The **items** (sizes, gauges, suppliers, rates) are entered by you.
- **Finished-goods variants:** none are pre-created. You enable the model × design combinations you actually stock. Each one maps onto a legacy `products` row (existing ids are kept) plus its companion config.

Anything unknown stays **null and is flagged on the "Needs attention" list**. It is never shown as 0 and never invented.

### 0.5 Screens (same tab layout as V3; old pages stay until switched)

**Overview · Stock** (Raw materials | Finished goods) **· BOM & cost · Production · Purchases & expenses · Losses & counts · Suppliers**

- **Overview:**
  - Stock value, split raw/finished, null-aware.
  - This week's spend by material group.
  - Low/out-of-stock items.
  - Earliest "days of material left" (V3's `stockDays`: null when consumption is unknown).
  - Pending POs and approvals.
  - The "Needs attention" checklist.
- **BOM & cost:** per model, material cost per unit (or "incomplete"), material-cost % of each variant's price against your target, and a suggested minimum price.
- **Losses & counts:** recorded scrap, damage and defects are kept **separate** from unexplained count variance, exactly as V3 separates known waste from unexplained shortage.

### 0.6 Hard prerequisite in this project

V3 works because the café backend writes each document atomically. **This project's backend does not:** it rewrites every legacy collection from memory after each change (`repository.ts:47-50`). The new collections are not affected, because the legacy save never touches them. But any V3 write to **finished-goods stock in legacy `products`** (production output, finished-goods adjustments or counts) would be **overwritten by the next legacy save**.

Phase 0-A (atomic writes for the legacy core) must therefore be completed before any V3 operation touches `products`. Raw-material, supplier, PO and BOM work can begin before then.

---

## 1. Principles (non-negotiable)

1. **Stock changes only through one inventory service.** No route, script or UI may write `stockQty`/`reservedQty` directly. The service writes the ledger row and the balance in the same transaction.
2. **Ledgers are append-only.** Corrections are made with `REVERSAL` rows that reference the original entry. Nothing is ever deleted or updated.
3. **Stock is never negative.** The service checks with a conditional update (`stock >= qty`). The database enforces it as well (CHECK in B; `$gte` guarded update in A).
4. **Idempotent operations.** Every stock-moving command carries an idempotency key. In practice the key is derived from the source document, e.g. `GRN:<id>:line:<n>`, and is unique in the ledger. A retry returns the existing result.
5. **Money is stored as integer paise; quantities as decimals with a fixed scale** (3 dp for materials, integer pieces for finished goods).
6. **Every figure comes from records.** There are no hard-coded dashboard numbers, and no seeded fake data in production.

---

## 2. Units of measure

**Allowed units:** `PIECE`, `SET`, `KG`, `G`, `LITRE`, `ML`, `METRE`, `FEET`, `SQFT`, `SHEET`, `BOX`.

- Each raw material has **one stock unit**.
- A purchase line may use a different **purchase unit** only if a conversion exists:
  - **Fixed conversions** (built in): `G↔KG` ×1000, `ML↔LITRE` ×1000, `FEET↔METRE` ×0.3048.
  - **Material-specific conversions** (per material, entered by Admin): for example `1 BOX = 100 PIECE` for screws, or `1 SHEET = 32 SQFT` or `= 38.5 KG` for a given sheet size and gauge. These are stored on the material as `{fromUnit, factor}` and are versioned via the audit log.
- Conversion happens **once**, at goods receipt, into the stock unit. The ledger stores both the original purchase qty/unit and the converted stock qty.
- BOM lines are always expressed in the material's stock unit.
- Validation:
  - A unit with no conversion path is rejected.
  - PIECE, SET, SHEET and BOX quantities must be whole numbers.
  - KG, LITRE, METRE and SQFT allow 3 dp.

---

## 3. Suppliers

**Fields:** name, contact person, phone, email, address, GSTIN (validated format + state code), supplier category (steel, hardware, chemicals/paint, packaging, print/laminate, other), payment terms (days), opening balance, status (active/inactive), notes.

**Supplier ledger** (derived, not stored): opening balance + received GRN values − purchase returns − supplier payments = outstanding payable. The supplier detail page shows the ledger with running balance, purchase history and payment history.

A supplier can be deactivated. Deletion is only allowed if no documents reference it.

---

## 4. Products: body model × design

Based on the reference PDFs (audit §2):

```
Category      e.g. "Steel Almirah"
 └─ ProductModel   body: Eco 2, Classic 3, Premium 2(L)…   ← specs, dimensions, BOM
     └─ ProductVariant  model + design (+ colour/finish)   ← SKU, price, stock, images
Design            print/front code: SRH-52, FM950, NO-50, SDH-50 (with its own image)
DesignSeries      SRH (Steel Raj), FM (Premium Design), NO (Luxury Photo), SDH
```

- **ProductModel** holds:
  - name and model code
  - category
  - door count
  - H/W/D in inches (from PDF where available)
  - feature list (panel door, locker, drawers, churi stand, light, lock type, treatment)
  - material description, weight, HSN (default 9403), GST rate
  - description, status
  - gallery images
  - active BOM
- **Design** holds the code, series, image(s), status and a source reference (`file`, `page`).
- **ProductVariant** is the **stock-keeping and sellable unit**. It holds:
  - SKU, e.g. `ECO2-SRH52`
  - modelId, designId, optional colour/finish
  - selling price, cost price (admin/accountant only), MRP, GST override
  - min stock, `stockQty`, `reservedQty`
  - status, images (inherits the design image if it has none of its own)
- **Pricing is configured by you.** The PDFs contain none. A pricing helper can set `price = model base price + series surcharge` as a *default*, which can be overridden per variant. Nothing is priced automatically without your confirmation.
- **Variants are not pre-generated** for all combinations (8 models × 316 designs would create 2,528 SKUs). Admin creates the combinations that are actually stocked, or "enables" a design for a set of models.

> Open question for you: can any design go on any body, or are some series tied to specific bodies (e.g. SDH only on 3-door)? The PDFs show FM on 1-door and 2-door bodies and SDH on a 3-door body.

---

## 5. Raw materials

**Fields:**

- code (unique), name, category, specification (gauge, grade, size, colour)
- stock unit, purchase-unit conversions
- last purchase price, **weighted average cost** (recomputed on each receipt: `(oldQty×oldAvg + inQty×inCost) / (oldQty+inQty)`)
- `stockQty`, `reservedQty`, `available = stock − reserved`
- min stock, max stock, preferred supplier, storage location, image (optional), status

**Seed categories, taken from the Steel Raj catalogue** (names only; no quantities):

- Steel sheet (E.D.D grade)
- Pre-treatment chemicals (7-tank / phosphating)
- Powder coat
- Locks (Maruti)
- Hinges
- Handles
- Churi stand
- Internal light
- Drawer channels/fittings
- Door print/laminate panels
- Fasteners (screws, nuts and bolts)
- Packaging

You add the actual items.

---

## 6. Purchasing

### 6.1 Purchase order states

```
DRAFT ──submit──▶ SUBMITTED ──approve──▶ APPROVED ──(GRN)──▶ PARTIALLY_RECEIVED ──(GRN)──▶ RECEIVED ──▶ CLOSED
  │                  │ reject                │ cancel (only if nothing received)
  └─ edit/delete     ▼                       ▼
                  REJECTED               CANCELLED
```

- **PO lines:** material (or finished variant, for traded goods), qty + purchase unit, rate, discount %, GST rate.
- **Header:** shipping charges, expected delivery date.
- **Totals:** taxable = Σ(qty×rate − discount); GST split into CGST+SGST (same state) or IGST (inter-state, from the supplier GSTIN state code vs company state); shipping; round-off.
- **Approval:** only roles with `purchase.approve` may approve. The creator may not approve their own PO above a configurable amount.
- **Creating or approving a PO never touches stock.**

### 6.2 Goods receipt (GRN)

- A GRN references an APPROVED or PARTIALLY_RECEIVED PO.
- It records supplier invoice no./date and, per line, received qty, accepted qty and rejected qty with a reason.
- Accepted qty may not exceed `ordered − already received` (over-receipt tolerance is configurable, default 0%).
- **Confirming the GRN is the only event that increases stock.** In one transaction it:
  1. Converts to the stock unit.
  2. Adds a `PURCHASE_RECEIPT` ledger row per line (idempotency key `GRN:<id>:<line>`).
  3. Updates the weighted average cost.
  4. Updates the PO received quantities and status.
  5. Posts the payable to the supplier ledger.
  6. Writes an audit entry.
- A confirmed GRN cannot be edited. It is corrected through a purchase return or a reversal.

### 6.3 Purchase return

A purchase return references a GRN. It writes a `PURCHASE_RETURN` ledger row, which reduces stock and fails if stock is insufficient, and reduces the supplier payable (debit note).

### 6.4 Supplier payments

Fields: amount, mode, reference and date. Optionally allocated to GRNs. A payment can be voided with a reason, but never deleted.

---

## 7. BOM and production

### 7.1 BOM

- A BOM belongs to a **ProductModel**. If you want designs to carry their own print-panel material, a variant-level override line can be added.
- **Lines:** material, qty per unit (stock unit), wastage %, notes.
- **Effective qty per unit** = `qty × (1 + wastage%/100)`.
- **Versioning:** editing an active BOM creates version *n+1*. Old versions are read-only and stay attached to the production orders that used them. Exactly one version per model is ACTIVE.
- **Estimated cost per unit** = Σ effective qty × current average cost. It is labelled "estimated" and shown with the date of the cost basis.

### 7.2 Production order states

```
DRAFT → SUBMITTED → APPROVED → MATERIAL_RESERVED → IN_PROGRESS → COMPLETED
   └──────────────┴───────────┴────────────┴──────────▶ CANCELLED
```

| Transition | Effect (all in one transaction) |
|---|---|
| create | Choose variant (or model + design), BOM version is frozen, planned qty, requirement table = effective qty × planned qty, shortage list shown (no stock effect) |
| APPROVED → MATERIAL_RESERVED | For every line: conditional `reservedQty += req` only where `stock − reserved ≥ req`. If any line fails, the whole step fails and returns the shortage list. A `RESERVATION` ledger row is written per line. |
| → IN_PROGRESS | No stock effect, timestamp only |
| → COMPLETED | Input: actual good qty produced, actual consumed qty per material (defaults to reserved), wastage qty per material with reason. Writes `PRODUCTION_CONSUMPTION` (stock −actual, reserved −reserved), `WASTAGE` rows for recorded scrap, a `RESERVATION_RELEASE` for any unused reservation, and `PRODUCTION_OUTPUT` (+good qty on the finished variant at the computed unit cost). Stores actual material cost, labour and overhead (optional, entered), and variance against the estimate. |
| → CANCELLED | Releases any reservation (`RESERVATION_RELEASE`). Not allowed after COMPLETED; use reversal instead. |

- Idempotency key per transition: `PROD:<id>:<transition>`. A second call returns the same result, so material can never be deducted twice.
- **Finished-goods unit cost** = (actual material cost + labour + overhead) / good qty. It feeds the variant's average cost.

---

## 8. Stock ledger, adjustments, wastage, alerts

### 8.1 Unified ledger entry

`itemType` (RAW_MATERIAL | FINISHED_VARIANT), itemId, movementType, qty (signed, stock unit), stockBefore, stockAfter, reservedBefore, reservedAfter, unitCost, sourceType + sourceId + sourceNumber, reason, actor, approvedBy/approvedAt (when applicable), idempotencyKey (unique), createdAt.

**Movement types:** `OPENING`, `PURCHASE_RECEIPT`, `PURCHASE_RETURN`, `PRODUCTION_CONSUMPTION`, `PRODUCTION_OUTPUT`, `RESERVATION`, `RESERVATION_RELEASE`, `SALES_DISPATCH`, `SALES_RETURN`, `ADJUSTMENT_IN`, `ADJUSTMENT_OUT`, `WASTAGE`, `REVERSAL`.

Physically this can be one table/collection or two (raw and finished) with an identical shape. The UI shows one unified view either way.

### 8.2 Reversal

Admin selects a ledger row and gives a reason. The service writes an equal and opposite `REVERSAL` row that references it. The reversal fails if it would make stock negative, and a row can be reversed only once. Document-level reversals (e.g. cancelling a GRN) are made of line reversals.

### 8.3 Adjustments and wastage

- **Request fields:** item, direction, qty, reason code (`DAMAGED`, `MANUFACTURING_SCRAP`, `UNUSABLE`, `MISSING`, `COUNT_CORRECTION`, `FOUND`), notes, optional attachment.
- **Approval:**
  - Requests above a configurable value threshold, or any `MISSING`, go to `PENDING_APPROVAL`.
  - Admin (or a holder of `inventory.adjust.approve`) approves or rejects. The requester cannot approve their own request.
  - Below the threshold, the request applies immediately but is still audited.
- **Wastage** is an adjustment with a wastage reason, so wastage reports read from the ledger. There is no separate source of truth.

### 8.4 Alerts (computed on read, cached briefly)

- Raw material or variant with `available ≤ minStock` (low) or `= 0` (out).
- PO past expected delivery date and not received.
- Production order with shortage at reservation.
- Adjustment pending approval.
- **Unusual adjustment:** value above threshold, or above 3× the item's trailing 90-day average adjustment.
- PO pending approval for more than N days.

Shown on the inventory dashboard and in a bell menu. No email/SMS unless requested.

### 8.5 Inventory dashboard (all from queries)

**Cards:**
- Item counts (raw, finished variants), supplier count
- Stock value (Σ stock × avg cost, split raw/finished)
- Low and out-of-stock counts
- Pending POs, pending approvals

**Lists:** recent movements, recent GRNs, recent production, wastage this month.

**Charts:** inventory value trend (from daily ledger aggregates), raw vs finished stock value, monthly purchases (GRN value), monthly production output, monthly consumption, wastage trend.

---

## 9. Mapping to each codebase

> For option A, §0.3 (café V3 pattern) takes precedence over the "Option A" column below. New companion collections are used, and the `Erp*` collections are left untouched rather than reused. The column is kept to show the alternative.

| Entity | Option A (Mongo, legacy) | Option B (Postgres rebuild) |
|---|---|---|
| Supplier | **new** collection `suppliers` | extend `Supplier` (+category, paymentTermsDays) |
| RawMaterial | **reuse** `ErpRawMaterial` (rename fields, add max/location/preferredSupplier/conversions) | extend `RawMaterial` (+min/max, location, preferredSupplierId, conversions, specs; add units G/ML/FEET/SQFT/BOX) |
| Category | **reuse** `ErpCategory`; migrate `Product.category` strings into it | reuse `Category` |
| ProductModel / Design / Variant | **new** `productModels`, `designs`; **existing `products` becomes the variant collection** (ids preserved so old orders still resolve) | **new** `ProductModel`, `Design`; **existing `Product` becomes the variant** (it already has designCode/doorCount/size); add `ProductImage` |
| BOM | **reuse** `ErpBom` (key by modelId) | replace flat `ProductRecipe` with `Bom` + `BomLine` (version, wastage) |
| PurchaseOrder / GRN / PurchaseReturn | **new** | **new** `PurchaseOrder(+Line)`, `GoodsReceipt(+Line)`; existing `Purchase` remains as the posted bill (created from a GRN) |
| ProductionOrder | **reuse** `ErpProduction` with a new status set + transition table | extend `ProductionRun` with status/reservation fields, or a new `ProductionOrder` wrapping it |
| Stock ledger | **replace** both `InventoryMovement` and `ErpStockLedger` with one `stockLedger` collection; migrate old rows with `legacy:true` | reuse `StockLedger` + `RawMaterialLedger`; add movement types, before/after reserved, approval fields |
| Adjustment request | **new** | **new** `StockAdjustmentRequest` |
| Supplier payment | **new** | reuse `SupplierPayment` (+void) |
| Transactions | `session.withTransaction()` on Atlas (replica set); conditional `findOneAndUpdate({_id, stockQty:{$gte:q}}, {$inc})`; unique index on `idempotencyKey` | Prisma `$transaction` + CHECK constraints + append-only triggers (already present) |

**Existing behaviour to preserve:**
- The order reservation policy (submission/approval/dispatch), including its "cannot change while active orders exist" rule.
- Order idempotency.
- The rule that a sale dispatch must be backed by a reservation.

---

## 10. Product images (Cloudinary)

- **Server-side only.** The backend uses the `cloudinary` Node SDK with `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY` and `CLOUDINARY_API_SECRET` from server env, never from `VITE_*`. In option B the env file is `backend/.env.local`. The prompt's `server/.env` path does not exist in either codebase.
- **Upload flow:**
  1. Admin selects files.
  2. `POST /products/:id/images` (multipart via `multer` memory storage).
  3. Validation: JPEG/PNG/WebP only, checked by magic bytes as well as MIME type; ≤ 5 MB each; ≤ 10 per product.
  4. Upload to folder `zen-ledger/<env>/products/<modelId|variantId>`.
  5. Store `{url, publicId, width, height, bytes, sortOrder, isPrimary, sourceRef}`.
- **Replace** uploads the new image first and only then deletes the old `publicId`. **Delete** removes the DB row and then calls Cloudinary `destroy`. A failed destroy is logged and retried; the record is never orphaned.
- **Delivery:** URLs are built with transformations (`f_auto,q_auto,c_fill`) at 160/480/960 px widths for thumbnails, cards and detail views, with `srcset`.
- **Salesmen** receive image URLs only. Cloudinary credentials never leave the server.
- **Demo/real imagery from the PDFs:**
  1. A one-off script renders each PDF page (PyMuPDF, already used in `tmp/pdf_ocr.py`) and crops the product area.
  2. Output goes to `assets/catalogue-source/<series>/<code>.webp` with a manifest `{code, file, page}`.
  3. Admin reviews the result. Six Luxury pages had no OCR code, so they need a manual check.
  4. An import action uploads the reviewed images to Cloudinary and attaches them to `Design` records.
  5. Steel Raj model pages are cropped per model and attached to the `ProductModel` gallery.
  - This needs your confirmation that you hold the rights to these catalogues (see roadmap decisions).
- **No placeholder boxes:** if an image is missing, the card shows the design image, then the model image, then a neutral illustrated almirah silhouette (one SVG asset). Never an empty box.
