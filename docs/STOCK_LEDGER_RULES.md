# Stock Ledger Rules

One append-only `StockLedger` (v3) covers every item kind: stock items and finished products.

## 1. Invariants

1. **Only the inventory service writes stock.** Every change to `StockBalance`, to item totals (`onHandQty`/`reservedQty`) or to `products.stock`/`reservedStock` happens in the same transaction as its ledger row.
2. **No negative stock.** Decrements use guarded conditional updates. `negativeStockAllowed` exists as a setting but is false and Admin-only. Even if enabled, it would apply per item with an audit flag.
3. **Ledger rows are immutable.** There is no update or delete endpoint. Corrections are made by **reversal** (§6).
4. **Exactly once.** Every row has a unique `idempotencyKey` derived from its source document line. Every mutation goes through `transact()` with a request key and payload hash.
5. **Balances reconcile.** Σ ledger qty per item and location = `StockBalance.qty`, and Σ balances (excluding IN_TRANSIT) = item on-hand. A nightly read-only check reports any mismatch.
6. **The backend is the source of truth.** The frontend never computes balances or values; it only formats what the server returns.

## 2. Ledger row

| Field | Notes |
|---|---|
| `_id` | Transaction ID, also shown as a readable `txnNo` |
| itemKind, itemId, itemCode, itemName, itemType, categoryId | Denormalised at posting time for reports |
| type | §3 |
| refType, refId, refNumber, refLine | Source document (GRN, issue, wastage, count, …). **Required.** |
| qtyIn, qtyOut | Exactly one is > 0, in the stock unit |
| prevQty, newQty | Location balance before and after |
| prevReserved, newReserved | For reservation types |
| itemPrevQty, itemNewQty | Item total before and after |
| unit | Stock unit |
| unitCostPaise, valuePaise | At posting. `null` if the cost is unknown. |
| avgCostBefore, avgCostAfter | For auditability of the weighted average |
| fromLocationId, toLocationId | The relevant one(s) |
| performedBy {id, name, role}, approvedBy, approvedAt | |
| reason, notes | Reason is required for adjustments, wastage, counts and reversals |
| idempotencyKey (unique), reversalOf (unique, partial), reversedBy | |
| operationId, calculationVersion, createdAt | |

## 3. Movement types

| Type | Qty | Reserved | Source document | Approval |
|---|---|---|---|---|
| `OPENING` | in | — | Item create / migration | — |
| `PURCHASE_RECEIPT` | in (accepted only) | — | GRN posted | PO approved earlier |
| `PURCHASE_RETURN` | out | — | Purchase return | `purchase.return` |
| `RESERVATION` | — | + | Production order / sales order | per workflow |
| `RESERVATION_RELEASE` | — | − | Cancel / reject / complete | — |
| `MATERIAL_ISSUE` (= production consumption) | out | − | Material issue | `production.issue` |
| `MATERIAL_RETURN` | in | — | Return of unused material | `production.issue` |
| `PRODUCTION_OUTPUT` | in (QC-accepted) | — | Output batch | `production.qc` |
| `SALES_DISPATCH` | out | − (if reserved) | Order dispatched | order flow |
| `SALES_RETURN` | in (to QC_HOLD) | — | Sales return | `order.review` |
| `WASTAGE` | out | — | Approved store wastage | `wastage.approve` |
| `ADJUSTMENT_IN` / `ADJUSTMENT_OUT` | in / out | — | Approved adjustment | per policy |
| `COUNT_ADJUSTMENT` | in / out | — | Approved count | `count.approve` |
| `TRANSFER_OUT` / `TRANSFER_IN` | out / in | — | Transfer dispatch / receipt (paired via IN_TRANSIT) | `transfer.approve` |
| `COST_ADJUSTMENT` | 0 qty, value ± | — | Bill price variance | `purchase.approve` |
| `REVERSAL` | opposite of original | opposite | Any posted row | `ledger.reverse` (Admin) |
| `LEGACY_IMPORT` | in | — | Migration M2 | — |

**Production wastage and consumption are not stock movements.** They allocate already-issued quantity on the production order (production §6). That is how double deduction is prevented. The **Wastage report** combines `WASTAGE` ledger rows with approved production wastage records, and labels which is which.

## 4. Posting algorithm (all inside one transaction)

1. Check permission and the feature switch. Validate the request key and replay.
2. Conditionally move the source document from its expected status to POSTED. If that fails, return 409.
3. For each line, in a **stable order** (sorted by itemId, then locationId) to avoid deadlocks or write conflicts:
   - Guarded `$inc` on `StockBalance` (upsert for incoming movements).
   - Guarded `$inc` on the item totals (+ the average-cost recompute for incoming movements).
   - Insert the ledger row with prev/new values read from the post-update documents.
4. Write the audit row and the operation record. Commit.
5. On a write conflict, MongoDB's `withTransaction` retries **the whole transaction**, so the idempotency keys keep retries safe.

## 5. Concurrency

- Two people issuing the last 5 sheets at the same time: one guard succeeds and the other fails with "insufficient available stock". This is tested with 20 parallel requests.
- Approving a count while a GRN posts for the same item: the count's watermark is stale, so approval is refused and that line must be recounted.
- Editing a master record with a stale `revision` returns 409 "refresh before editing".

## 6. Reversal

- Only **posted** rows can be reversed. Each row can be reversed once (unique `reversalOf`).
- A reversal writes an equal and opposite row:
  - **Same cost** as the original.
  - Location balance and item total reverted.
  - Weighted average recalculated: the reversed value is removed, using the same formula as a return.
- **A reversal that would make stock negative is refused.** Example: you can't reverse a receipt whose material has already been issued. In that case the dependent movements must be reversed first, or a documented adjustment used instead.
- **Document-level corrections** reverse all of that document's lines in one transaction and mark the document `REVERSED`. Examples: un-posting a GRN, an output batch or a wastage record.
- A reason and `ledger.reverse` are required. The reversal shows on both rows in History.

## 7. History screen

- **Filters:** item, category, item type, transaction type, user, location, date range, reference number.
- **Columns:** txn ID, date/time, item, type, reference (link), qty in, qty out, previous, new, unit, unit cost, value, from/to location, performed by, approved by, notes.
- **Export:** CSV with no new dependency. PDF needs a library, which will be proposed before it is installed.
- Legacy `inventorymovements` rows appear in the same list with a **Legacy** badge, read-only.
