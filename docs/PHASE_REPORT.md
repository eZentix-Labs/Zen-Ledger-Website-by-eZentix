# Implementation Report: Inventory, Manufacturing & Sales Performance

**Date:** 2026-11-03.
**Status:** implemented and verified locally. Nothing is committed, pushed or deployed.

## Verification actually run

| Check | Result |
|---|---|
| Backend type-check (`tsc --noEmit --singleThreaded`) | Pass |
| Backend tests (`npx vitest run`, throwaway local MongoDB 7 replica set) | **45 / 45 pass** across 5 files |
| Frontend type-check | Pass |
| Frontend production build (`vite build`) | Pass |
| Read-only backup of the database in `backend/.env` (`business_management_dev`) | Taken and **verified** (17 collections, 327 products) → `D:\Business-Management-System\backups\…` |
| New persistence layer against a **local restore of that backup** (`scripts/verify-backup-locally.ts`) | 13 / 13 checks pass, including unrelated collections being byte-for-byte unchanged after a write |
| Browser check (local API + local restored data, Chrome) | Inventory overview, Finished Goods grid with catalogue images, salesman dashboard and catalogue render; no console errors |
| Browser check at 390 px | **Not verified.** The browser window did not resize. The responsive CSS exists but has not been seen at phone width. |
| Atlas | Read-only backup only. **No writes.** |

### What the 45 tests cover

**Phase 1: persistence safety**
- Writes from another process are no longer erased.
- Only changed documents are written.
- Deletes are refused.
- A failed commit rolls back fully.
- Data is identical after a restart; phone numbers are persisted.
- 20 concurrent orders across two app instances never oversell.
- Reservations, dispatch-once and movement history work through the full order lifecycle.
- A failed request leaves the database unchanged.

**Backup:** export, verification, and tamper detection.

**Business workflows** (your prompt's scenarios)
- S1 / S2 purchase and partial receipt: idempotent replay, over-receipt blocked, landed cost.
- S10 bill import: creates a draft only; duplicate invoices are blocked.
- Supplier ledger, bill and payment.
- S7 purchase return.
- S3 production:
  - BOM approval rights.
  - Reserve, issue and stage ordering.
  - Production wastage is not deducted twice.
  - Partial output (60%) and QC.
  - Completion and cost absorption.
- S4 store wastage: pending changes nothing; approval deducts exactly once.
- S5 counts: blind count; posts only after approval; stale counts refused.
- Adjustments: approval rules and a single reversal.
- S9 security: concurrent decrements never go negative; invalid quantities rejected; salesmen blocked from inventory; ledger reconciles with stock.
- S8 dispatch: decreases stock once and is mirrored into the unified ledger.
- Salesmen and targets:
  - An Accountant creates a salesman; the temporary password is hashed; the change is forced at first login.
  - Deactivation ends sessions and blocks login.
  - Targets count approved orders only: never pending or cancelled.
  - Revision history is kept; salesmen see only their own data.
- Collections stay unverified until verified, then update balances.
- The catalogue never exposes cost.
- The dashboard and CSV reports come from real records.

## What was built

| Area | Backend | Frontend |
|---|---|---|
| Persistence fix | `repository.ts`: lock + reload + diff commit in a transaction, no deletes, mirroring hook | — |
| Backup | `src/backup.ts`, `scripts/backup-mongo.ts`, `scripts/verify-backup-locally.ts` | — |
| Auth & permissions | `src/auth.ts`: claim validation, active-account + token-version check, Accountant defaults + Admin grants | Menus and buttons hide by permission; the server enforces everything |
| Inventory | `src/inventory/*`: items, suppliers, purchases/GRN/bills/payments/returns/import, BOM, production + stages, wastage, counts, adjustments, ledger + reversal, dashboard, completeness, alerts, 15 reports + CSV, settings, files | `src/inventory/*`: Inventory page with quick actions and 12 tabs |
| Products & images | Product profiles (specs, gallery) on the existing Products; uploads to Cloudinary when configured, otherwise GridFS | Finished Goods grid/list, detail gallery, image upload |
| Sales | `src/sales/*`: salesman CRUD, password reset, targets with revisions, performance, activity timeline, collections, self-service dashboard, catalogue | `src/sales/SalesAdmin.tsx` (Salesmen, Targets, Performance); `salesman.tsx` (mobile dashboard, catalogue, orders, collections, password change) |
| Catalogue images | `scripts/render-catalogue.py`, `scripts/import-catalogue-images.ts` (dry run by default) | — |
| Local dev | `scripts/dev-db.ts` (persistent local replica set, restore from backup) | — |

## Deviations from the architecture documents (deliberate)

1. **Persistence:** instead of rewriting every legacy route, mutations take the shared lock, reload, and commit only the diff in a transaction. Legacy order logic is unchanged.
2. **One ledger:** the repaired `ErpStockLedger` collection is the single ledger for all new movements, because you asked not to create a second ledger. Legacy order movements are mirrored into it inside the same transaction.
3. **No stock locations or transfers yet.** Items have a location field, and counts can be scoped by location, but stock is held as one balance per item.
4. **No feature flags.** The old Products page still exists alongside the new Inventory page.

## Before deploying (needs you)

1. **Rotate the Atlas password.** It is still committed in `backend/.env.example`.
2. Take a fresh backup of the **production** database:
   `npx tsx scripts/backup-mongo.ts --uri-env MONGODB_URI`, with Render's URI in that variable.
   The backup I took is of `business_management_dev`, from `backend/.env`.
3. Add `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY` and `CLOUDINARY_API_SECRET` (the rotated secret) to Render. Until then, uploads go to MongoDB GridFS.
4. Optional: put the catalogue images on production with `import-catalogue-images.ts <dir> --allow-remote`. Run the dry run first, and only after the backup.
5. Settings to fill in the app: company GST state code, approval limits, Accountant grants, stages, and the target counting rule (approved vs dispatched).
6. Business data still needed: real materials, prices, BOM quantities and labour costs (see `ALMARI_MANUFACTURING_BUSINESS_AUDIT.md` §4).

## Round 2 (2026-11-03): Inventory workspace matched to the reference

**Reference:** `docs/ui-reference/almirah-inventory.html`, copied from `../Zen-Ledger-rebuild/docs/ui-reference/`. The requested `inventory-reference.png` does not exist anywhere on disk, so the HTML was used.

**Changes**
- One **Inventory** sidebar entry. All 12 sections are internal tabs, in the requested order, and the selected tab is remembered.
- Header: eyebrow, title and description as specified. The shell's duplicate header is hidden on module pages.
- Five text-only quick-action cards with the specified wording.
- Reference design tokens in dark and light (Bricolage Grotesque + Inter, `#120c22` background, `#211a3d` cards, `#7c5cfc` accent), plus the reference's card, tile, tab, table, modal and toast styling.
- Overview:
  - Manufacturing cost control: six real-data tiles and a date filter.
  - Inventory records complete: the seven requested checks. An empty list now fails instead of counting as complete.
  - How inventory changes stock.
  - Needs attention.
  - Recent movements.
- Purchases: Drafts / Pending / Partially received / Completed filters, a payment-status column (from posted bills) and an invoice-attachment column.
- Raw Materials: a location column and a category manager (add, rename, activate/deactivate).
- Finished Goods: dimensions and colour in grid and list views.
- The owner may approve their own purchase orders, consistent with BOM and production approval. Others still cannot unless Settings allows it.
- Removed a duplicate `ErpAssignment` index definition.

**Verified (local API + local copy of the backed-up data, Chrome)**
- All 12 tabs load with no error states and no console errors.
- All 5 quick actions open their forms.
- Workflow through the UI:
  - Add Stock Item (50 sheets @ ₹950) posts an opening ledger entry.
  - Record Purchase → submit → approve → receive 100 / accept 98 / reject 2 with a reason. Stock 148, average cost ₹956.62, PO partially received.
- Accountant role:
  - Single Inventory sidebar entry.
  - "Add Stock Item" disabled; Settings hidden.
  - Closing a PO refused by the server (403).
- Light theme renders with the reference light palette.
- Backend 45/45 tests, both type-checks and the production build pass.
- **Not verified:** phone-width layout, because the browser window could not be resized in this session.

## Round 3 (2026-11-03): Almari Product Management page

**Verification run:** frontend `tsc --noEmit` clean; `npm run build` passes; backend `npx vitest run` gives **52/52 passing** (6 files, including the 7 new tests in `products.mongo.test.ts`). Browser check against the local dev DB (127.0.0.1:27027, never Atlas):
- grid with real catalogue photos (324 products);
- create a product: discount and GST maths shown, blue double-door illustration while it has no photo;
- add a variant (own SKU), archive it, delete it, delete the test product (count back to 324);
- all 9 detail sections render;
- image manager shows 8 distinct type illustrations.

Accountant and Salesman restrictions were verified by backend tests, not in the browser: the restored DB has no dev role accounts.

**Backend:** `inventory/routes-products.ts`
- list with filters and sorts;
- 9-section detail: stock breakdown from the existing ledger, variants, BOM availability and maxBuildable, production and sales history;
- create with an OPENING ledger entry, edit, profile, duplicate or variant, guarded delete (409 if there is any history; archive instead), bulk on safe fields only;
- CSV import with preview (stock never imported);
- product categories: create, rename (moves products), activate/deactivate.

Also:
- the `product-catalogue` CSV export; cost columns are included only for roles with `inventory.valuation`;
- shared images are protected from deletion while another product references them;
- the salesman catalogue puts the MAIN image first.

No new stock model, ledger or product collection: products stay in the existing `products` collection plus `InvProductProfile`.

**Frontend:**
- `products/ProductsPage.tsx`: header, the 5 top actions, filters, grid/list, bulk, categories, image manager, import;
- `products/ProductDetail.tsx`: the form, gallery with views (upload, replace, remove), variants and duplicates, the 9 sections, BOM create/edit, production order;
- `products/art.ts`: 8 type illustrations, used **only** when a product has no photo.
- Inventory › Finished Goods and the salesman catalogue now use the same detail view and illustration fallback.

**Cloudinary:** still not configured locally or in Render. Uploads use signed server-side REST once `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY` and `CLOUDINARY_API_SECRET` (the newly rotated secret) are set in Render; the secret never reaches the browser. Until then, files go to MongoDB GridFS. The 324 catalogue photos are attached only in the local dev DB (`scripts/import-catalogue-images.ts`). Run that script against production only after you approve it.

## Dependencies added

Backend devDependencies only, pinned: `vitest@3.2.4` and `mongodb-memory-server@10.2.3`. No runtime dependencies were added.
