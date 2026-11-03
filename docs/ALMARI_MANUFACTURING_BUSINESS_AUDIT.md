# Almari Manufacturing — Business Audit

**Date:** 2026-11-03 · **Status:** audit only, awaiting approval
**Sources:** this repository (read in full earlier today, see `BUSINESS_REQUIREMENT_AUDIT.md`), the four PDFs in `resorce/` (OCR output in `tmp/pdfs/` plus visual checks of rendered pages), and the café project's Inventory V3 and its reference design (`D:\Adds_cafe\Restaurant-Management-System`, read-only).

**Document set for this inventory audit:**

| Document | Answers |
|---|---|
| `ALMARI_MANUFACTURING_BUSINESS_AUDIT.md` (this) | What the business does, what the documents prove, and what is still unknown |
| `INVENTORY_REQUIREMENT_AUDIT.md` | Every requested inventory feature: exists, partial, or missing in this code |
| `RAW_MATERIAL_INVENTORY_ARCHITECTURE.md` | Item master: types, categories, units, locations, reorder, valuation |
| `INVENTORY_DATABASE_ARCHITECTURE.md` | Collections, fields, indexes, reuse vs new, migrations, transactions |
| `INVENTORY_WORKFLOW.md` | Purchase, GRN, bill import, returns, wastage, count, adjustment, transfer, dispatch |
| `PRODUCTION_WORKFLOW.md` | Production orders, stages, WIP, issue, consumption, QC, output |
| `BOM_AND_COSTING_RULES.md` | BOM structure and every costing formula |
| `STOCK_LEDGER_RULES.md` | Movement types, invariants, idempotency, reversals |
| `IMPLEMENTATION_PLAN.md` | Phases, gates, tests, UI layout, decisions. `INVENTORY_IMPLEMENTATION_PLAN.md` points to it. |

These documents **supersede `INVENTORY_ARCHITECTURE.md`** for inventory. `SALESMAN_TARGET_ARCHITECTURE.md` remains valid for sales, targets and permissions.

---

## 1. Codebase decision

Both of your latest prompts specify this project, MongoDB and MERN. I am therefore treating **option A (extend this MongoDB app, built on the café Inventory V3 pattern)** as decided. The PostgreSQL rebuild in `../Zen-Ledger-rebuild` is not used. **Tell me if that is wrong.**

---

## 2. The business process vs. what the software supports today

| # | Real step (your prompt) | Supported today? |
|---|---|---|
| 1 | Purchase raw materials from suppliers | ❌ No supplier or purchase records exist |
| 2 | Receive and inspect materials | ❌ |
| 3 | Store in warehouse | ❌ No raw-material stock movement; no locations |
| 4 | Manufacturing requirements | 🟡 `ErpBom` model + API; not usable from the UI |
| 5 | Issue materials to production | ❌ |
| 6–9 | Cut, bend, weld, paint, fit accessories | ❌ No stages |
| 10 | Quality inspection | ❌ (`quality_check` exists as a free status value only) |
| 11 | Complete manufacturing | ❌ Completing does not consume materials or add finished goods |
| 12 | Store finished almirahs | 🟡 `products.stock` / `reservedStock` with a movement log |
| 13 | Customer orders | ✅ Salesman ordering with idempotency and reservation policy |
| 14 | Invoices | 🟡 Total-only invoices; no lines or GST |
| 15 | Dispatch | 🟡 API only; no UI button. Stock deducted once on dispatch. |
| 16 | Payments and dues | 🟡 `ErpPayment` stub, not applied to balances |

**Conclusion:** only the *sales* half of the lifecycle exists. The entire procurement → manufacturing half has to be built.

---

## 3. What the reference documents prove

### 3.1 Products: Steel Raj, "Manufacturer of Powder coated Steel Almirah with Hot Phospheting"

Bhattanagar, Liluah, Howrah 711203 · steelrajalmirah.com · tagline "Bond of Happiness".

| Body model | H × W × D (inches) | Interior / fittings listed |
|---|---|---|
| Heavy 3 | 78 × 54 × 20 | Panel door, shelve-chamber, 1 locker, E.D.D sheet, churi stand, light, Maruti lock |
| Eco 2 | 78 × 34 × 20 | Panel door, shelve-chamber, 1 locker, churi stand, light, Maruti lock |
| Classic 2 | 78 × 37 × 20 | Same as Eco 2 |
| Classic 3 | 78 × 48 × 20 | Shelve-chamber, 1 locker, E.D.D sheet, churi stand, light, Maruti lock |
| Eco 3 | 78 × 48 × 20 | Panel door, shelve-chamber, 1 locker, E.D.D sheet, churi stand, light, Maruti lock |
| Classic SPL 2 | 78 × 37 × 20 | Panel door, 2 drawers, 1 locker, E.D.D sheet, churi stand, light, Maruti lock |
| Premium 2(L) | 78 × 42 × 20 | Panel door, 1 back chamber, 1 locker + 1 drawer, E.D.D sheet, churi stand, light, Maruti lock |
| Premium 2 | 78 × 42 × 20 | Panel door, 2 drawers, 1 locker + 1 back chamber, E.D.D sheet, churi stand, light, Maruti lock |

All eight list **7-tank treatment** and **hot phosphating**.

### 3.2 Door designs

| Series | Codes | Shown on |
|---|---|---|
| SRH (Steel Raj) | 16 codes on catalogue p.2 | Various bodies |
| FM, "Premium Design" | FM901–FM1000 | 1-door and 2-door bodies |
| Luxury Photo | NO-01–NO-100 | Finished fronts. Pages 29, 30, 48, 68, 69 and 70 had no readable code. |
| SDH | SDH-01–SDH-100 | 3-door body |

A sellable product is therefore **body model × door design**.

### 3.3 Materials the documents name (categories only, no quantities)

- E.D.D (extra-deep-drawing) quality steel sheet
- 7-tank pre-treatment and phosphating chemicals
- Powder coat
- Maruti locks
- Churi (bangle) stand
- Internal light
- Drawer parts
- Locker unit
- Hinges and handles (visible in photos)
- Printed door panels or prints

### 3.4 Process stages the documents imply

The catalogue confirms only that sheet-metal fabrication, **7-tank pre-treatment, hot phosphating and powder coating** happen, followed by the fitting of locks, lights and churi stands.

Your prompt's default stages (cutting → bending → welding → grinding → surface prep → coating → assembly → fittings → QC → packaging) fit this well. They will ship as **editable defaults**.

### 3.5 What the documents do **not** contain

There are no prices, costs, GST rates, sheet gauges or sizes, weights, colours, suppliers, BOM quantities, labour rates or stock levels.

### 3.6 Product images

About 300 on-brand renders exist in the PDFs. These become the product and design images, uploaded to Cloudinary after you review them. **Cloudinary is not configured in this project.** Your prompt says it is, but `grep` finds no Cloudinary or upload code here; the café project has it. Credentials must be added to this backend's environment by you.

---

## 4. Unknown business information (needed before or during build)

Nothing in this list will be invented. Each item becomes a setting, a form field, or a decision.

| # | Unknown | Needed by | Default until answered |
|---|---|---|---|
| U1 | Is the business Steel Raj itself? Do you hold rights to the catalogue images? | Product import, images | Images stay local and are not uploaded |
| U2 | Actual raw-material list: sheet grades, gauges, sheet sizes, buying unit (kg or sheet), suppliers | Raw materials | Empty item list with seeded categories |
| U3 | Are door prints made in-house (printing/lamination) or bought as finished printed panels? | BOM, materials | Treated as a purchased component |
| U4 | BOM quantities per body model | BOM | BOM shows "incomplete" |
| U5 | Labour costing: per unit, per stage, or monthly wages spread over output? | Costing | Manual labour cost per production order |
| U6 | Overhead allocation: electricity, gas for the curing oven, rent, and so on | Costing | Optional rate per unit; otherwise excluded and labelled |
| U7 | Physical locations: one store, or raw store, shop floor and finished-goods godown? | Locations, transfers | One location, "Main Warehouse" |
| U8 | Is stock tracked per lot/batch for finished almirahs, or by quantity only? | Finished goods | Quantity plus a production-batch reference |
| U9 | Approval limits for POs, adjustments and wastage, and who approves | Settings | Everything needs Admin approval |
| U10 | GST registration type, state, and HSN codes for products and materials | Purchases, bills | GST fields optional; HSN 9403 suggested for almirahs |
| U11 | Financial-year numbering (April–March assumed for India) | Document numbers | FY April–March |
| U12 | Stock-count frequency | Count reminders | None |
| U13 | Are semi-finished goods held between stages, e.g. painted bodies awaiting fittings? | Item types, multi-level BOM | Supported as an item type; single-level BOM first |
| U14 | Product types not in the PDFs (single-door, four-door, office cabinet, custom size) | Catalogue | Not created |
| U15 | Which bill-import extraction provider to use, if any (see `INVENTORY_WORKFLOW.md` §4) | Bill import | Manual entry plus attachment |
| U16 | Current data in Atlas: how many products, orders and customers exist | Migration | Read-only count, with your approval, before Phase 0-A |
