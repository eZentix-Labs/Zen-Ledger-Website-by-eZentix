# Production Workflow (Manufacturing, Stages, WIP, QC)

## 1. Process this models (audit §3.4)

Raw materials are issued and the body is fabricated (cut → bend → weld → grind). It then goes through surface preparation (7-tank pre-treatment, hot phosphating) and powder coating. Next come assembly and fittings (locks, lights, churi stand, drawers), quality inspection and packaging. Finished almirahs then go into finished-goods stock.

## 2. Stages

- **Stage template:** an ordered list of stages, each with a code, a name and a `requiresQc` flag. Admin can edit templates, and each body model points to one template.
- **Default template** (from your prompt; editable, nothing assumed beyond it):
  1. Material Preparation
  2. Cutting
  3. Bending
  4. Welding
  5. Grinding
  6. Surface Preparation (7-tank / phosphating)
  7. Painting / Powder Coating
  8. Assembly
  9. Fittings Installation
  10. Quality Inspection
  11. Packaging
  12. Finished Goods Storage
- **Stage records:** when a production order is approved, the template is **copied** onto it. Later template edits therefore don't rewrite running orders. Each stage record holds:
  - status `PENDING / IN_PROGRESS / COMPLETED / SKIPPED(reason)`
  - `qtyCompleted`
  - team or employee (free text until a staff module exists)
  - startedAt, completedAt
  - notes
- **Stage ordering:**
  - A stage's `qtyCompleted` may not exceed the previous stage's `qtyCompleted`. This keeps partial batches consistent.
  - Stages update **progress only and never move stock**.

## 3. Production order

**Fields:**
- number, productId (finished variant) or productModelId + designId
- bomId + **bomVersion (frozen)**, plus a **cost snapshot** of the BOM at approval
- plannedQty, completedQty (QC-passed and posted), rejectedQty, reworkQty
- startDate, expectedDate, actualCompletionDate
- team, priority, notes
- requirement lines[{itemId, requiredQty, reservedQty, issuedQty, returnedQty, consumedQty, wastedQty}]
- labourCostPaise, overheadPaise, otherCostsPaise
- status, history

**States:**

```
DRAFT → SUBMITTED → APPROVED → MATERIALS_RESERVED → IN_PROGRESS → QUALITY_CHECK → COMPLETED
          │ reject → REJECTED          │ cancel (any state before COMPLETED, with rules §7) → CANCELLED
```

Partial output is posted while the order is `IN_PROGRESS`/`QUALITY_CHECK`. The order becomes `COMPLETED` when completedQty + rejectedQty = plannedQty, or when it is closed short with a reason.

| Transition | Who | Effect |
|---|---|---|
| create / edit DRAFT | `production.create` | Requirements computed (§4). Shortage report shown. No stock effect. |
| submit | creator | Locked for editing |
| approve / reject | `production.approve` (not the creator, unless allowed) | Freezes BOM version and cost snapshot; copies stages |
| reserve materials | `production.manage` | Per line: `reservedQty += required`, guarded so `available ≥ required`. **All-or-nothing:** if one line fails, nothing is reserved and the shortages are returned. Writes `RESERVATION` rows (reserved only, on-hand unchanged). |
| issue materials (one or more `MaterialIssue` docs) | `production.issue` | `MATERIAL_ISSUE` ledger rows: on-hand −qty and reserved −qty (guarded), from a chosen location, at the current average cost. Issue qty ≤ reserved − issued, unless it is an approved **additional material request**. |
| start | `production.manage` | Status IN_PROGRESS; stage 1 can start |
| update stages | `production.stage.update` | Progress only |
| record output batch → QC | `production.manage`, QC by `production.qc` | §5 |
| return unused material | `production.issue` | `MATERIAL_RETURN` ledger rows: stock +qty back at the **issue cost** |
| complete / close short | `production.approve` | §6 |

## 4. Material requirements

- **Per BOM line:** `requiredQty = bomQty × plannedQty / bomOutputQty × (1 + plannedWastageBps/10000)`, rounded **up** to the item's precision (whole numbers for COUNT units).
- **Shortage** = `max(0, required − (onHand − reservedByOthers))`. It is shown per line with "Create purchase draft" (inventory workflow §1).
- Requirements are recomputed while the order is DRAFT and **frozen at approval**.

## 5. Output, quality inspection and finished goods

1. The supervisor records an **output batch**: the producedQty that has reached the end of the stages.
2. **QC** splits it into acceptedQty, reworkQty (stays in WIP) and rejectedQty (scrap, with a reason, plus an optional `WastageRecord` of type `DEFECTIVE_FINISHED`).
3. **Posting the batch** writes `PRODUCTION_OUTPUT` (FG stock **+acceptedQty**) into the FG warehouse, or into `QC_HOLD` if the setting asks for a separate release step. The unit cost comes from costing rules §6.
4. Each batch creates a finished-goods **batch record** (production order, manufacturing date, qty, unit cost). This gives the traceability your prompt asks for ("manufacturing date, production order"), without lot-level stock unless U8 says so.
5. Idempotency key `OUTPUT:<orderId>:<batchNo>`. A batch posts once.

**Progress shown** (two separate numbers, never mixed):
- **Output progress** = completedQty / plannedQty. Example: 12 of 20 = 60%.
- **Stage progress** = which stages are complete for the quantity in process. This is a stage tracker, not a percentage of output.

## 6. Consumption and wastage without double deduction

Material leaves stock **once**, at **issue**. From then on, the production order accounts for what happened to the issued qty:

```
issuedQty = consumedQty + wastedQty + returnedQty + stillInWipQty
```

- **Wastage during production** (cutting, welding, grinding, paint, defective component) is recorded on the order and approved through the wastage workflow. Approval moves qty from `stillInWip` to `wastedQty`. **It writes no stock movement**, because the stock already left at issue.
- **At completion or close:**
  - `consumedQty` = issued − returned − wasted. The supervisor may enter actual consumption; any difference must be explained as wastage or returned.
  - Unused issued material must be **returned** (`MATERIAL_RETURN`) or declared as wastage.
  - Remaining reservations are released (`RESERVATION_RELEASE`).
- **Planned vs actual wastage** per line: plannedWastage = `bomQty × output × wastage%` vs approved wastage. Shown on the order and in the Wastage report.

## 7. Cancellation

| State when cancelled | What happens |
|---|---|
| DRAFT / SUBMITTED / APPROVED | Status only |
| MATERIALS_RESERVED | `RESERVATION_RELEASE` for every reserved qty |
| IN_PROGRESS (material issued) | Cancellation needs a disposition for issued material: **return to store**, **record as wastage**, or **move to SEMI_FINISHED item** (if enabled). It is blocked until every issued unit is accounted for. Already-posted output batches stay posted; finished goods are corrected only by adjustment or reversal. |
| COMPLETED | Not allowed. Use ledger reversals with approval. |

## 8. Work-in-progress board (Production → Work in Progress)

**Cards:** one per open order (APPROVED, MATERIALS_RESERVED, IN_PROGRESS, QUALITY_CHECK), showing:
- product image
- name and variant
- planned, completed and pending qty
- current stage (the first not-completed stage)
- start date and expected date (overdue in red)
- team
- output progress bar
- production cost so far (issued material value + recorded labour/overhead)

Clicking a card opens the stage timeline, for example: Cutting ✔ · Bending ✔ · Welding ● in progress · Painting ○ · Assembly ○ · QC ○.

**WIP value** (shown on Overview) = Σ issued value − returned value − value of consumption already moved into posted output − approved production wastage value.
