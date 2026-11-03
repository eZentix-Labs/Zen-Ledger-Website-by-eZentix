# Inventory Workflows

Each workflow lists its states, who may act, and the **exact stock effect**. "No stock effect" means no ledger row is written. Ledger mechanics are in `STOCK_LEDGER_RULES.md`. Production is in `PRODUCTION_WORKFLOW.md`.

## 0. "How stock changes" panel (shown on Overview; the text is final copy)

| Event | Stock effect |
|---|---|
| Purchase receipt | Stock **increases** when goods are physically received, inspected and **accepted**, and the GRN is posted. A purchase order never changes stock. |
| Material issue to production | Raw-material stock **decreases** when material is issued against an **approved** production order. |
| Production output | Finished-goods stock **increases** only for units that **passed quality inspection** and were posted. |
| Sales dispatch | Finished-goods stock **decreases once**, when the order is dispatched. Draft or pending orders only reserve stock, according to your stock policy. |
| Wastage | Stock **decreases** only when a wastage record is **approved**. |
| Purchase return | Stock **decreases** when accepted material is returned to the supplier. |
| Sales return | Stock **increases** only after the returned goods are inspected and accepted. Damaged returns go to the Damaged location. |
| Stock adjustment | Stock changes only through an **authorised, documented** adjustment, including approved stock-count differences. |
| Stock transfer | Stock moves between locations. The **business-wide total does not change**. |

## 1. Purchase order

```
DRAFT ─submit→ SUBMITTED ─approve→ APPROVED ─GRN→ PARTIALLY_RECEIVED ─GRN→ FULLY_RECEIVED ─close→ CLOSED
  │edit/delete     │reject→ REJECTED   │cancel (nothing received)→ CANCELLED
                                       └ close short (remaining qty cancelled, reason) → CLOSED
```

**Creating a PO:**
- **Lines:** item, qty (in the purchase unit, converted with the item's factor), rate, discount %, GST %.
- **Header:** freight, other charges, expected date, payment terms, notes, attachments.
- **Totals:**
  - Line taxable = qty × rate − discount, rounded once per line.
  - GST is split CGST + SGST if the supplier's state = company state, else IGST.
  - Grand total = Σ lines + freight + other charges, with round-off shown.
  - Freight and other charges are **apportioned to line cost by taxable value** when the GRN posts (costing §5).
- **Inline actions:** "Add new supplier" and "Add new item" open their quick forms.

**Approval rules:**
- Totals ≤ `purchaseApprovalLimitPaise` may be auto-approved if the setting allows it. Otherwise approval needs `purchase.approve`.
- The creator cannot approve their own PO, unless the setting allows it.
- Approval freezes the lines.

**Stock effect:** none, at any PO state.

## 2. Goods receipt (GRN), with inspection

```
DRAFT (enter received qty) → inspect (accepted / rejected + reason per line) → POSTED   (correction only by REVERSAL)
```

- A GRN needs an `APPROVED` or `PARTIALLY_RECEIVED` PO.
- Per line: accepted ≤ ordered − already accepted (tolerance setting, default 0%), and rejected + accepted = received.
- **Posting does the following in one transaction:**
  1. Writes a `PURCHASE_RECEIPT` ledger row per line, for the **accepted** qty only, into the GRN's location.
  2. Updates the weighted average cost.
  3. Updates the PO line's `receivedQty`/`rejectedQty` and the PO status.
  4. Writes an audit row.
- **Rejected quantity** never enters stock. It stays on the GRN as "rejected at inspection", and the supplier is expected to take it back. It does not appear on the bill.
- **Duplicate guard:** a GRN moves `DRAFT→POSTED` by a conditional update, and the ledger key is `GRN:<id>:<line>`.
- **Example:** order 100 sheets → GRN 1 accepts 60 (stock +60, PO partially received) → GRN 2 accepts 40 (stock +40, PO fully received). Re-posting either GRN returns the first result. No third increase is possible.

## 3. Purchase bill (supplier invoice), the accounting event

- **The PO is not a payable.** A payable arises only when a **purchase bill** is posted, which writes a `BILL` entry to the supplier ledger.
- A bill links to one or more posted GRNs. Billed qty per line ≤ accepted qty (3-way match: PO, GRN, bill).
- **Price or qty differences** against the PO are shown as variances and need `purchase.approve` to post.
- **Duplicate invoice guard:** a unique index on (supplier, normalised invoice number, financial year), plus the file hash for imports.
- **Due date** = invoice date + payment terms. The bill is **overdue** if unpaid after the due date.
- **Unbilled receipts:** a report of posted GRNs with no bill, i.e. goods received but not yet invoiced.

## 4. Import a bill (PDF / JPG / PNG)

```
upload → store original (Cloudinary, private/authenticated type) → extract (if a provider is configured) → editable review → match items → confirm → DRAFT purchase bill (+ optional DRAFT PO if none exists)
```

**Upload:**
- Accepted: PDF, JPEG, PNG and WebP, ≤ 10 MB, checked by magic bytes.
- A SHA-256 hash prevents importing the same file twice.

**Extraction provider (decision U15):**

| Option | What it means | Notes |
|---|---|---|
| **None / manual (default, always available)** | The review screen opens empty beside the bill image, and the user types the fields | Works on day one. No third party. |
| Vision LLM API (e.g. Claude) | The server sends the bill image to the provider and gets structured fields back | Needs an API key, per-bill cost, and your consent to send supplier invoices to a third party |
| Self-hosted OCR (e.g. RapidOCR, as used in `tmp/pdf_ocr.py`) | Text only, then rule-based parsing | Python service; too heavy for the current Render instance; weak on table layouts |

The provider is pluggable behind one interface. Its output is **always** a suggestion.

**Review screen:**
- Supplier match: by GSTIN, then name. Can create a new supplier.
- Invoice number and date.
- Per line: extracted name, qty, unit, rate, GST, amount, and the matched item with a reason. Matching uses `SupplierItem` code, exact item code, then fuzzy name. A fuzzy match is only a suggestion; the user must confirm it.
- Freight, discount and totals.
- **Warnings:**
  - unmatched item ("Create new item" opens a prefilled form; **nothing is created silently**)
  - possible duplicate item (similar name exists)
  - unit with no conversion
  - qty differs from the open PO
  - tax total ≠ Σ line tax
  - grand total ≠ computed
  - duplicate invoice
  - low-confidence fields, when the provider reports them

**Stock effect: none.** Confirming creates only DRAFT records. Stock changes later, at GRN posting.

## 5. Purchase return

- A return references a posted GRN, and lines are limited to accepted qty minus already-returned qty.
- **Posting** writes a `PURCHASE_RETURN` ledger row (stock out, guarded so stock can't go negative) at the **original GRN unit cost**. It also writes a `RETURN` entry (debit note) to the supplier ledger if the goods had already been billed. If they were not yet billed, it reduces the billable qty instead.

## 6. Supplier payments and ledger

- **Supplier ledger running balance** = opening + bills − returns − payments ± approved adjustments.
- **Payment fields:** amount, method (cash, bank, UPI, cheque), reference, date, proof attachment, and allocations to bills (manual, or oldest-first FIFO).
- **Partial payments:** bill status becomes `PARTIALLY_PAID`, then `PAID`.
- **Duplicate guard:** `requestKey` + unique ledger key `PAYMENT:<id>`.
- **Void:** with a reason and `supplierPayment.void`, it writes a reversing `PAYMENT_VOID` entry. Payments are never deleted.
- **Accounts integration:** this project has no accounts module for payables yet. Supplier ledger and payments **are** the payables records, and the Accounts nav points to them.

## 7. Wastage

```
PENDING (no stock effect; editable by the reporter) → APPROVED (stock effect) | REJECTED
```

- **Wastage types:** damaged material, cutting, welding, grinding, paint, defective component, damaged finished product, packaging damage, expired/unusable, other.
- **Store wastage** (`source: STORE`): on approval, writes a `WASTAGE` ledger row, stock out at the current average cost (guarded).
- **Production wastage** (`source: PRODUCTION`, linked to a production order): material has already left the store at issue. Approval therefore **allocates part of the issued qty to wastage** on the production order, and writes **no second stock deduction**. See production §6.
- Approval needs `wastage.approve`, and the reporter cannot approve their own record.
- Cost impact is calculated at approval and stored on the record. Approved records are never deleted; a mistake is corrected by reversal.

## 8. Stock count (physical inventory)

```
DRAFT (scope: full / category / location / items; blind?; assign counters) → IN_PROGRESS → SUBMITTED → APPROVED → POSTED
```

- **Starting** the count snapshots `systemQtyAtStart` and a **watermark** (latest ledger id) per item and location. A blind count hides system qty from the counters.
- Counters enter physical qty. Variance = counted − system, and **a reason is required for every non-zero variance**.
- **Approval** needs `count.approve`. Then:
  - If any watermark is stale (stock moved meanwhile), approval is refused and those lines must be recounted (café V3 rule).
  - Otherwise, approval creates one `StockAdjustment` (type `COUNT_VARIANCE`), and posting writes `COUNT_ADJUSTMENT` ledger rows.
- **Example:** system 100, counted 94 → variance −6 with reason → after approval, stock = 94 and one ledger row of −6. Posting twice is impossible (status guard + key `COUNT:<id>:<line>`).
- **Variance report:** qty and value per item, by count.

## 9. Stock adjustment

- **Fields:** type, item, location, current qty (read at request time), adjust qty, resulting qty, reason (required), attachment, requested by.
- **Approval:**
  - Required when the type is MISSING, DAMAGED or DATA_CORRECTION, when the value is above `adjustmentApprovalLimitPaise`, or always if the setting says so.
  - Otherwise the adjustment posts at once, still audited.
- **Posting:** an `ADJUSTMENT_IN`/`ADJUSTMENT_OUT` ledger row. Decreases are guarded. Increases are costed at the current average, or at an entered cost for OPENING_CORRECTION.
- **No balance is ever overwritten.** "Set to X" is converted into a ± movement.

## 10. Stock transfer

```
REQUESTED → APPROVED → DISPATCHED (from → IN_TRANSIT) → PARTIALLY_RECEIVED → RECEIVED (IN_TRANSIT → to)  | CANCELLED (before dispatch)
```

- **Dispatch:** `TRANSFER_OUT` from the source and `TRANSFER_IN` to the IN_TRANSIT location. Received qty ≤ dispatched − already received.
- **Receive:** `TRANSFER_OUT` from IN_TRANSIT and `TRANSFER_IN` to the destination.
- A shortfall on receipt is closed with a reason, which posts a `TRANSIT_LOSS` adjustment from IN_TRANSIT and needs approval.
- **Item totals and value never change on a transfer.** The test asserts Σ before = Σ after.
- Receipts are keyed per receipt sequence, so the same receipt can't be posted twice.

## 11. Sales dispatch and return (integration with existing orders)

- The existing order flow and stock policy are **kept**. The `reserve`, `release` and `finalizeSale` calls are re-implemented in the inventory service:
  - `RESERVATION` / `RESERVATION_RELEASE` change reserved qty only.
  - On **dispatch**, the user picks a dispatch location (default FG Warehouse), and `SALES_DISPATCH` posts stock out once, at the current average cost.
- **Sales return:** the return goes first to `QC_HOLD` (`SALES_RETURN` ledger row at the original dispatch cost). Inspection then transfers it to FG (accepted) or DAMAGED. A credit note is handled in sales (`SALESMAN_TARGET_ARCHITECTURE.md` §3).
- **Salesmen** see only sellable availability. They never see cost, supplier, raw-material or ledger data (permission plus serializer).
