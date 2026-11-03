# Raw Material & Item Master Architecture

Covers every stockable item. Movement rules are in `STOCK_LEDGER_RULES.md`. Schemas are in `INVENTORY_DATABASE_ARCHITECTURE.md`.

## 1. Item types

| itemType | Examples (from your prompt / PDFs) | Stocked in | Can be in a BOM | Sold to customers |
|---|---|---|---|---|
| `RAW_MATERIAL` | E.D.D steel sheet, CR/GI sheet, pipes, flat bars, angles | `StockItem` | ✔ | ✘ |
| `COMPONENT` (Accessories & Components tab) | Maruti locks, hinges, handles, churi stand, light, drawer channels, magnetic catchers, printed door panels (if bought, see U3) | `StockItem` | ✔ | ✘ |
| `CONSUMABLE` | Welding rods/wire, cutting/grinding discs, 7-tank chemicals, phosphating chemicals, powder coat, primer, thinner | `StockItem` | ✔ (as BOM line or overhead) | ✘ |
| `PACKAGING` | Cardboard, bubble wrap, foam, stretch film, tape | `StockItem` | ✔ | ✘ |
| `SPARE_PART` | Machine spares | `StockItem` | ✘ | ✘ |
| `SEMI_FINISHED` | Painted body awaiting fittings (only if U13 = yes) | `StockItem` | ✔ (multi-level, later phase) | ✘ |
| `FINISHED_GOOD` | Almirah variants (body model × design) | **Existing `products`** + companion config | output only | ✔ |
| `OTHER` | Anything else | `StockItem` | ✘ | ✘ |

Finished goods stay in `products`, so there is **no duplicate catalogue**. Salesman ordering, reservations and invoices keep working unchanged. Every screen that lists "items" (Stock, History, Count, Adjust) runs one query across both sources, so an operator does not see two systems.

## 2. Categories

- Categories are admin-configurable. Each has a name, code, `itemType`, an optional parent, active status and a sort order.
- They are seeded once, only after you approve, from the PDFs and your prompt:
  - **Metal:** steel sheet (E.D.D), CR sheet, GI sheet, pipes, angles/flats.
  - **Hardware & accessories:** locks, hinges, handles, churi stands, lights, drawer fittings, fasteners, door panels/prints.
  - **Surface treatment & coating:** pre-treatment chemicals, phosphating, powder coat, primer/thinner.
  - **Welding & abrasives:** welding consumables and abrasives.
  - **Packaging.**
  - **Spares.**
- You can deactivate any seeded category you don't use. A category with active items cannot be deactivated.

## 3. Units and conversions

Every unit belongs to exactly one **dimension**. Conversions *within* a dimension are fixed. Conversions *across* dimensions exist only as material-specific factors you enter.

| Dimension | Units (base first) | Fixed factors |
|---|---|---|
| COUNT | piece (pcs), set, box, bundle, roll, sheet | none built in. A box, bundle, roll or set is a *pack*, so its size must be defined per item, e.g. 1 box = 100 pcs. |
| MASS | kg, g | 1 kg = 1000 g |
| LENGTH | m, mm, cm, ft, inch | 1 m = 1000 mm = 100 cm; 1 ft = 0.3048 m; 1 in = 0.0254 m |
| AREA | sq m, sq ft | 1 sq ft = 0.09290304 sq m |
| VOLUME | litre, ml | 1 L = 1000 ml |

**Rules:**
1. Each item has one **stock unit**. All balances, BOM lines and the ledger use it.
2. An item may have extra **purchase units**, each `{unit, factorToStockUnit}`. Example:
   - E.D.D sheet with stock unit `sheet`, purchased in `kg` at 1 sheet = 21.4 kg (your number).
   - Screws with stock unit `pcs`, purchased in `box` at 1 box = 200 pcs.
3. A cross-dimension factor (sheet ↔ kg) **must** be entered per item. It is never inferred. Changing a factor creates a new factor version, and past documents keep the factor they used.
4. COUNT units need whole numbers in the stock unit. Other dimensions allow 3 decimals for display (6 internally, as in café V3).
5. A conversion with no defined path is rejected with a clear message: "No conversion from kg to pcs for Hinge 4 in".
6. The stock unit is locked once the item has any ledger rows. That rule is copied from café V3's `saveItem`.

## 4. Item master fields

| Group | Fields |
|---|---|
| Identity | name, itemCode (unique), sku (unique, optional), barcode (unique if set), itemType, categoryId, description, image(s) (Cloudinary `{url, publicId}`), status ACTIVE/INACTIVE |
| Specification | grade, thicknessMm, lengthMm, widthMm, diameterMm, weightKg (per stock unit), colour/finish, free-form `specs[]` `{key, value}` |
| Units | stockUnit, purchaseUnits[] |
| Stock (cached totals; the per-location truth is `StockBalance`) | onHandQty, reservedQty, available (computed) |
| Planning | minStock, maxStock, reorderLevel, reorderQty, leadTimeDays, preferredSupplierId, defaultLocationId |
| Cost | lastPurchaseRate, averageCost (`null` = unknown), costUpdatedAt |
| Tax | hsnCode, gstRateBps |
| Audit | createdBy, updatedBy, revision (optimistic lock) |

**Deactivation rules:**
- Deactivate instead of delete: an item with ledger rows can never be deleted.
- Deactivation is blocked while the item has stock, open POs, open production orders or reservations. The UI lists those blockers.

## 5. Locations and balances

- **Location:** code, name, type, active.
  - Types: `STORE` (raw), `PRODUCTION` (shop floor), `FG_WAREHOUSE`, `DISPATCH`, `QC_HOLD`, `DAMAGED`, `IN_TRANSIT` (system).
- **Seeded:** only **Main Warehouse (STORE + FG)**, plus the system locations `IN_TRANSIT`, `QC_HOLD` and `DAMAGED`. More are added when U7 is answered.
- **`StockBalance` `{itemRef, locationId, qty}`** is the per-location truth. Item-level `onHandQty` (and `products.stock`) is the **sum over all non-transit locations**, updated in the same transaction. Item totals therefore always equal the sum of locations.
- **Sellable finished goods** = qty in `FG_WAREHOUSE`/`DISPATCH` locations − reserved. `QC_HOLD` and `DAMAGED` stock is counted in on-hand value but is **not sellable**. That is how the finished-goods statuses Available, Reserved, Quality Hold and Damaged are derived. "In production" comes from open production orders. "Dispatched" is a ledger fact, not stock.
- **Reservations stay item-level**, as today. The location is chosen at issue or dispatch.

## 6. Reorder management

- **Low stock:** `available ≤ reorderLevel`.
- **Out of stock:** `available ≤ 0`.
- **Below minimum:** `available < minStock`, flagged red.
- **Suggested purchase qty** = `maxStock − (available + openPoQty)`, floored at 0 and rounded **up** to the item's purchase pack. Your prompt's formula (`max − available`) is shown alongside it. Open PO quantity is subtracted so the same shortage isn't ordered twice. If `maxStock` isn't set, the suggestion falls back to `reorderQty`, or else "not configured".
- The Alerts panel has a **"Create purchase draft"** action. It groups suggestions by preferred supplier into **DRAFT** POs. Nothing is sent or approved automatically.
- **Lead time** is shown as the expected arrival date. A "Materials requiring purchase" list also counts open production requirements (reserved, not yet issued).

## 7. Valuation

The system uses **weighted average cost (perpetual)**, business-wide per item. Reasons:
- Steel sheet and hardware are fungible.
- The existing data has no lots.
- FIFO would need receipt layers on every movement, and you have not asked for lot tracking (U8).

The method is a setting that is **locked once any costed movement exists**, so methods are never mixed. Every formula is in `BOM_AND_COSTING_RULES.md` §5.

## 8. Raw material dashboard (Stock → Raw Materials header)

All figures come from queries:
- item count, stock value, low and out-of-stock counts
- recently purchased (last GRNs)
- most consumed (issues in the last 30 days)
- materials requiring purchase (§6)
- pending supplier deliveries (approved POs not fully received, with overdue ones highlighted)
