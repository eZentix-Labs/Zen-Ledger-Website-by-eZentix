# BOM and Costing Rules

All arithmetic runs on the server, in one calculation module (as in café V3):
- BigInt.
- Money is stored as integer paise.
- Quantities are decimal strings, up to 6 dp.
- Rounding is **half away from zero**, done once per line. Totals are sums of the rounded lines.
- Every stored figure carries a `calculationVersion`.

**A missing cost is `null`.** Any total that depends on it is reported as **incomplete** and lists what is missing. It is never shown as ₹0.

## 1. BOM structure

- **Belongs to:**
  - A **body model** (Eco 2, Classic 3…). The door design normally changes only the printed panel.
  - Or, for a design that changes materials, to a specific **finished variant** (`productId`). A variant BOM overrides the model BOM.
- **Header fields:**
  - version
  - status: `DRAFT → PENDING_APPROVAL → APPROVED → ACTIVE`, or `INACTIVE`
  - **outputQty** (yield basis, usually 1)
  - labourPerUnitPaise, overheadPerUnitPaise
  - otherCosts[{label, perUnitPaise}]
  - notes, approvedBy/At
- **Lines:** item (raw material, component, consumable or packaging), qty in the item's stock unit, **plannedWastageBps**, optional flag, notes.
- **Every quantity is entered by you.** The PDFs contain none. A BOM with any missing line cost shows "estimated cost: incomplete".

## 2. Versioning and approval

- Editing an APPROVED or ACTIVE BOM creates **version n+1 as DRAFT**. Old versions become read-only.
- Only one version is ACTIVE per model or variant (partial unique index).
- Activating a version needs `bom.approve`. The approver cannot be the author, unless the setting allows it.
- Production orders store the **BOM version and a cost snapshot taken at approval**. Changing a BOM or a material price later **never changes historical production cost**.
- **BOM history** shows the versions with a line-by-line diff, who made each and when.

## 3. Yield and wastage: counted once

- **Effective qty per unit** = `qty / outputQty × (1 + plannedWastageBps/10000)`.
- Planned wastage is included in the **requirement and the estimated cost**, once.
- During production, **actual** wastage is recorded against the *issued* material (production §6). It is **not added again** to cost: actual material cost is based on **issued − returned** material value, which already contains whatever was wasted.
- **Variance:**
  - Actual wastage − planned wastage, as qty and value.
  - Actual consumption − standard consumption.
  - Both are reported separately; neither is added to cost a second time.

## 4. Estimated (standard) cost per unit

```
Material cost      = Σ_lines ( effectiveQtyPerUnit × currentAverageCost(item) )
Labour             = labourPerUnitPaise
Overhead           = overheadPerUnitPaise
Other approved     = Σ otherCosts.perUnitPaise
Estimated cost/unit = Material + Labour + Overhead + Other
```

- The UI shows a **cost breakdown** table: per line, qty, cost basis (with "as of" date), amount and share %. It also shows the subtotals and any lines with incomplete cost.
- **Suggested minimum selling price** at your target margin is rounded **up** to your rounding increment (café V3 `targetPrice` rule):
  `ceil(estimatedCost / (1 − targetMarginBps/10000))`. The target margin is a setting with no default (D9).

## 5. Weighted average cost, event by event

Average cost is kept **per item, business-wide**. Transfers never change it. Each ledger row stores `unitCostPaise` and `valuePaise` at posting time, so **history is preserved**.

| Event | Quantity | Cost used / effect on average |
|---|---|---|
| Opening stock | +qty | Entered opening cost. `null` if not entered, with the item flagged "cost basis missing". |
| GRN posted | +accepted qty | Line landed cost = (taxable value + apportioned freight/other charges) ÷ accepted qty. **GST is excluded** when input credit is claimable (setting; default claimable). `newAvg = (oldQty×oldAvg + inQty×inCost) / (oldQty+inQty)`. If oldQty ≤ 0 or oldAvg is null, newAvg = inCost. |
| Purchase return | −qty | Valued at the **original GRN line cost**. Average recomputed as `(oldValue − returnValue)/(oldQty − retQty)` when the remaining qty > 0; otherwise unchanged. Never negative; if it would be, the average stays and the difference is logged as a variance. |
| Bill price differs from GRN after posting | — | The difference is posted as a **cost adjustment** to the item's value (qty unchanged) if the stock is still on hand. Otherwise it goes to a purchase price variance. Average recalculated. |
| Material issue / store wastage / adjustment out / count shortage | −qty | Current average |
| Material return from production | +qty | The **issue** cost of that material (average recalculated) |
| Adjustment in / found / count surplus | +qty | Current average. `OPENING_CORRECTION` may carry an entered cost. |
| Production output | +accepted qty | Actual unit cost (§6). Updates the finished variant's average. |
| Sales dispatch | −qty | Current finished-goods average (this is the COGS) |
| Sales return accepted | +qty | Cost on the **original dispatch** row |

The method is locked once costed movements exist (setting `costingMethod`). FIFO is not mixed in.

## 6. Actual production cost (per production order)

```
Actual material   = Σ issue value − Σ return value             (wastage already inside)
Labour            = recorded labour for the order (or standard × output if only standard is configured; labelled)
Overhead          = standard overhead × output (labelled "standard")  — actual overhead allocation only after U6
Other             = approved other costs
Total cost        = Actual material + Labour + Overhead + Other
Unit cost (batch) = Total cost attributable so far ÷ accepted output qty
```

- **Batch costing with partial output:**
  - Each output batch takes `material issued per planned unit × batch qty` plus the labour and overhead for that batch.
  - The final batch absorbs the remainder.
  - Rejected units' cost is absorbed by the good units (normal loss). The rejected value is shown separately in reports.
- **Variance report:** estimated vs actual per order, split into material, wastage, labour and overhead.
- **Product manufacturing cost** on the finished product = the finished goods' current average cost. It is shown to Admin, and to Accountant if permitted, and **never to salesmen**.

## 7. Dashboard cost terms (kept distinct)

| Term | Definition | Source |
|---|---|---|
| Material purchase cost | Σ landed value of **GRNs posted** in the period (excluding GST) | Ledger `PURCHASE_RECEIPT` |
| Purchase bills | Σ posted bill totals incl. GST in the period | Bills |
| Production material consumption | Σ issue value − return value in the period | Ledger `MATERIAL_ISSUE/RETURN` |
| Production cost | Σ actual cost of output posted in the period | `ProductionOutput` |
| Wastage cost | Σ approved wastage value (store + production) in the period | Wastage records |
| Stock on hand | Σ balance × current average (raw / WIP / finished shown separately) | Balances. Incomplete if any cost is null. |
| COGS | Σ `SALES_DISPATCH` value | Ledger |
| Sales revenue | From invoices. **Never** labelled as profit. | Sales |

**Profit:** shown only in the Reports module, and only when revenue, COGS and the period's expenses are all complete. Otherwise it is shown as "incomplete" with the reasons.
