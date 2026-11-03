# Inventory & Manufacturing Implementation Plan

**Status:** awaiting your approval. No code has been written.
**Codebase:** this MongoDB project (option A), built on the café Inventory V3 pattern.
**Scope:** merges the phase lists of both inventory prompts. Sales, targets and activity work is in `IMPLEMENTATION_ROADMAP.md` and follows after this plan or interleaves with it, as you prefer.

## 1. Gate after every phase

- Backend and frontend typecheck pass.
- Build passes.
- Phase unit and integration tests pass against a **local or staging replica set**, never Atlas production.
- Browser check at 1440 px and 390 px.
- A report covering: completed, files created, files modified, DB changes, API changes, tests run with their actual output, known issues, remaining work.

**Stop rule:** any failing stock-integrity test blocks the next phase.

## 2. Phases

| # | Phase | Deliverables | Tests (the scenario numbers refer to your prompt §25) |
|---|---|---|---|
| 0 | Safety | Atlas password rotated **by you**; placeholder `.env.example`; local env guard; production auto-seed removed; backend test harness fixed (vitest + env before imports) and the existing 12 tests run | Existing tests pass; a guard test refuses a non-local URI |
| 0-A | Atomic legacy persistence | Replace the rewrite-all repository with per-document transactional writes. Same routes and response shapes. Fix ERP route order, claims and mass assignment; add `User.phone`; fix the `/api/me` shape. | Existing tests; concurrent-approval test; no regression in salesman ordering |
| 1 | Foundation | Calculation module, `transact()`, settings/capabilities, permission keys, setup script (dry run), feature flags, document counters | Calculation unit tests (rounding, conversions, null cost); idempotent replay; switch-off returns 409 |
| 2 | Inventory shell + Overview UI | Inventory nav entry, page header, 5 quick-action cards, tab bar, Overview built from real queries (empty states until data exists), completeness widget, "How stock changes" panel, date filter | Dashboard numbers equal seeded-fixture sums; no hard-coded figures (grep) |
| 3 | Items, categories, units, locations | Stock tab (all item types + Accessories & Components view), Add Stock Item with opening ledger, item detail and history, deactivate rules, seed lists (after approval) | Duplicate code/SKU rejected; opening writes a ledger row; stock unit locked after first movement; invalid conversion rejected |
| 4 | Suppliers | Supplier CRUD, supplier ↔ item mapping, ledger, statement, deactivate rules | Supplier with history can't be deleted; ledger balance math |
| 5 | Purchases + GRN + bills + returns + payments | PO lifecycle and approval; GRN with inspection; purchase bills with 3-way match; returns; payments; unbilled receipts | **S1, S2, S7**; PO creates no stock; GRN double post blocked; duplicate invoice blocked; payment double post blocked |
| 6 | Bill import | Upload (Cloudinary, private), hash duplicate guard, review screen with matching and warnings, DRAFT bill/PO creation; extraction provider per decision U15 (manual by default) | **S10**: stock unchanged until GRN; no silent item creation |
| 7 | BOM & costing | BOM versions and approval, cost preview and breakdown, suggested price, history diff | Costing formulas; wastage counted once; historical cost unchanged after a price change |
| 8 | Production + stages + WIP | Production orders, reservation, issue/return/additional request, stages, output batches with QC, completion/cancel, WIP board | **S3**; double issue blocked; output only after QC; cancel releases reservations; partial completion 12/20 = 60% |
| 9 | Wastage + adjustments | Wastage (store and production) with approval, adjustment requests and approval | **S4**; pending has no effect; self-approval blocked |
| 10 | Stock count | Sessions (full/category/location/items, blind, assignment), variance, approval, posting | **S5**; stale watermark refused; double post blocked |
| 11 | Locations + transfers | Locations, transfers with in-transit and partial receipt, transit loss | **S6**; totals unchanged; duplicate receipt blocked |
| 12 | Ledger + valuation | History screen and export, reversals, valuation views, reconciliation report | Reversal once only; reversal can't go negative; reconciliation passes on fixtures |
| 13 | Alerts + reports | Low/out/below-minimum alerts, "create purchase draft", all 18+ reports with filters and CSV export (PDF after a dependency decision) | Report totals = fixture sums |
| 14 | Products, sales, accounts integration | Finished-goods companion config and images (Cloudinary), migration M2, order dispatch/return via the ledger, salesman catalogue images and availability, supplier payables in Accounts | **S8**: dispatch decreases exactly once; salesman payload has no cost |
| 15 | Security + E2E | Permission sweep over every route, concurrency tests (20 parallel), invalid quantities, auth bypass attempts, browser E2E for every workflow | **S9** |
| 16 | Final UI/UX + business walkthrough | Consistency, loading/empty/error states, mobile layouts, accessibility pass, walkthrough of the complete lifecycle | Full lifecycle E2E: supplier → … → dispatch → ledger |

**Rough effort (one developer):**
- Phases 0–0-A: ~1 week.
- Phases 1–16: ~7–9 weeks.

This depends on the decisions below and how quickly the business data arrives.

## 3. Navigation

The two prompts propose 10 and 14 tabs, and I have merged them. An **Inventory** item is added to the existing admin sidebar, and the old Products page stays until the switch-over.

| Tab | Sub-tabs |
|---|---|
| Overview | — |
| Stock | Raw Materials · Accessories & Components · Consumables & Packaging · Semi-finished · Finished Products · Locations & Transfers |
| Purchases | Purchase Orders · Goods Receipts · Bills · Returns · Import a Bill |
| Suppliers | List · Ledger / Statement · Payments |
| Production | Orders · Work in Progress · BOM & Costing |
| Wastage | — |
| Count & Adjust | Stock Counts · Adjustments |
| History | Stock ledger |
| Reports | — |
| Settings | Categories · Units & conversions · Locations · Stages · Approvals & limits · Numbering · Costing method |

## 4. UI (reference design)

- **Palette:** taken from the café reference (`docs/inventory-reference.html`): `--bg #120c22`, `--surface #1a1430`, `--card #211a3d`, `--line #2e2653`, `--accent #7c5cfc → #8b5cf6` gradient, `--text #ECE9F7`, `--muted #A9A3C9`, status colours green `#34d399`, amber `#f5b73b`, red `#f26d6d`.
  - This project's `styles.css` already uses nearly identical tokens, so the change is consistent with the existing Admin look.
  - The light theme keeps working.
  - Your screenshot didn't come through in this chat. Send it if it differs from the café reference.
- **Header:** "Inventory", with the description from your prompt.
- **Quick actions:** five cards: Record Purchase, Log Wastage, Count Stock, Import a Bill, Add Stock Item. Each opens its workflow.
- **Overview layout:**
  1. Metric row: total value (raw, WIP, finished), finished-goods value, purchase cost, production cost, wastage cost, low-stock materials, pending production, pending POs, pending approvals, movements today.
  2. **Inventory Cost Control** panel: purchase cost, material consumption, wastage cost, stock on hand, movements today. Each has a link to its tab.
  3. **Record completeness** widget: checks passed / total, %, failing checks with "Fix" links. Calculated live.
     - Checks: valid units, cost basis, reorder levels, supplier contacts, GRN for received POs, BOM for producible products, product images, references on movements, reasons on adjustments, production orders with material records.
  4. "How stock changes" panel.
  5. Alerts.
  6. Recent movements.
- **Shared components:** data table (search, filters, paging, column sort), searchable select, date-range picker, modal with confirmation, toast, skeleton loading, empty and error states. Mobile layouts use row cards.
  - These are built in-house, with no new UI library, unless you approve one.

## 5. Decisions needed

Business unknowns U1–U16 are listed in `ALMARI_MANUFACTURING_BUSINESS_AUDIT.md` §4. The ones that block a phase:

| Needed by | Decision |
|---|---|
| Phase 0 | You rotate the Atlas password. Approve Phase 0-A and the Atlas snapshot/backup before it. |
| Phase 1 | Confirm **option A (this MongoDB project)** |
| Phase 3 | Approve the seed lists (categories, system locations, default stages, 8 body models, design series). Provide your raw-material list (U2) when ready. |
| Phase 5 | GST details (U10), approval limits (U9), FY numbering (U11) |
| Phase 6 | Extraction provider (U15): manual / vision API / self-hosted OCR |
| Phase 7 | BOM quantities (U4), labour/overhead method (U5, U6), target margin (D9), whether prints are in-house (U3) |
| Phase 11 | Your real storage locations (U7) |
| Phase 13 | PDF export library: yes/no |
| Phase 14 | Cloudinary credentials in the backend env (set by you); image rights (U1) |

## 6. Inventory permission keys (backend-enforced)

| Key | Admin | Accountant (default; Admin can grant) | Salesman |
|---|---|---|---|
| `inventory.view`, `inventory.valuation.view`, `ledger.view`, `reports.inventory` | ✔ | ✔ | ✘ |
| `item.manage`, `category.manage`, `location.manage` | ✔ | grantable | ✘ |
| `supplier.manage`, `supplierPayment.record` | ✔ | ✔ | ✘ |
| `purchase.create`, `grn.post`, `bill.post`, `purchase.return` | ✔ | ✔ | ✘ |
| `purchase.approve` | ✔ | grantable | ✘ |
| `bom.manage`, `bom.approve`, `production.*` | ✔ | grantable (view production cost: ✔) | ✘ |
| `wastage.report` / `wastage.approve` | ✔ | ✔ / grantable | ✘ |
| `adjustment.request` / `adjustment.approve`, `count.approve`, `transfer.approve` | ✔ | ✔ / grantable | ✘ |
| `ledger.reverse`, `inventory.settings` | ✔ | **never** | ✘ |
| `catalogue.view` (sellable products, images, available qty only) | ✔ | ✔ | ✔ |

## 7. Rules I will follow

- No commits, pushes or deploys without your approval.
- No connection to production Atlas. Migrations run only after a backup and your approval, dry-run first.
- No deleting or resetting data.
- No fake figures or fake history.
- No new packages without asking.
- Tests are reported only with their actual output.
