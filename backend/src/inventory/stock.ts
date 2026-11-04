// THE central inventory service. Every change to stock quantities (raw materials, components,
// consumables, packaging AND finished almirahs) goes through post(), which updates the balance
// with a guarded atomic $inc and writes exactly one immutable ledger row in the same transaction.
import mongoose from 'mongoose';
import {Models} from '../models.js';
import {Inv} from './models.js';
import {fail} from './http.js';
import {Actor, nextNumber} from './txn.js';

export type ItemKind = 'ITEM' | 'PRODUCT';
export type Move = {
  kind: ItemKind; itemId: string; type: string;
  dOnM: number;               // signed change to on-hand (milli-units)
  dResM?: number;             // signed change to reserved (milli-units)
  unitCostPaise?: number | null; // incoming: cost of the units received; outgoing: override (default current average)
  valuePaise?: number;        // explicit value for non-quantity ledger entries, such as production variance
  ref: {type: string; id: string; number?: string; line?: number};
  key: string;                // idempotency key, unique in the ledger
  reason?: string; notes?: string; location?: string;
  approvedBy?: Actor | null; reversalOf?: string;
};

const round4 = (n: number) => Math.round(n * 10000) / 10000;
const qtyLabel = (m: number) => `${m / 1000}`;

/** Weighted average after a movement. Outflows at a different cost (returns) re-derive the average from value. */
export function nextAverage(prevOnM: number, prevAvg: number | null, dOnM: number, cost: number | null): number | null {
  if (dOnM > 0) {
    if (cost == null) return prevAvg;
    if (prevAvg == null || prevOnM <= 0) return round4(cost);
    return round4((prevOnM * prevAvg + dOnM * cost) / (prevOnM + dOnM));
  }
  if (dOnM < 0 && cost != null && prevAvg != null && cost !== prevAvg) {
    const newOn = prevOnM + dOnM;
    if (newOn <= 0) return prevAvg;
    const v = (prevOnM * prevAvg + dOnM * cost) / newOn;
    return v >= 0 ? round4(v) : prevAvg;
  }
  return prevAvg;
}

export async function post(session: mongoose.ClientSession, actor: Actor, mv: Move) {
  const dOn = mv.dOnM, dRes = mv.dResM ?? 0;
  if (!Number.isInteger(dOn) || !Number.isInteger(dRes)) fail(400, 'Quantities must be in whole thousandths');
  const valueOnlyProductionEntry = mv.kind === 'PRODUCT' && ['PRODUCTION_VARIANCE', 'PRODUCTION_COST_ADJUSTMENT'].includes(mv.type)
    && Number.isSafeInteger(mv.valuePaise) && (mv.valuePaise as number) >= 0;
  if (dOn === 0 && dRes === 0 && !valueOnlyProductionEntry) fail(400, 'Movement has no quantity');
  const isItem = mv.kind === 'ITEM';
  if (!isItem && (dOn % 1000 || dRes % 1000)) fail(400, 'Finished products move in whole pieces');
  const onF = isItem ? 'onHandM' : 'stock', resF = isItem ? 'reservedM' : 'reservedStock', scale = isItem ? 1 : 1000;
  const filter: any = isItem ? {_id: mv.itemId} : {id: mv.itemId};
  if (dOn < 0) filter[onF] = {$gte: -dOn / scale};
  if (dRes < 0) filter[resF] = {$gte: -dRes / scale};
  if (dRes - dOn > 0) filter.$expr = {$gte: [{$subtract: [`$${onF}`, `$${resF}`]}, (dRes - dOn) / scale]};
  const Model: any = isItem ? Inv.Item : Models.products;
  const prev: any = await Model.findOneAndUpdate(filter, {$inc: {[onF]: dOn / scale, [resF]: dRes / scale}}, {session, returnDocument: 'before'}).lean();
  if (!prev) {
    const exists: any = await Model.findOne(isItem ? {_id: mv.itemId} : {id: mv.itemId}).session(session).lean();
    if (!exists) fail(404, 'Stock item not found');
    const on = (exists[onF] || 0) * scale, res = (exists[resF] || 0) * scale;
    fail(409, `Insufficient stock for ${exists.name}: on hand ${qtyLabel(on)}, reserved ${qtyLabel(res)}, available ${qtyLabel(on - res)}; requested ${qtyLabel(Math.max(-dOn, dRes - dOn))}`,
      {itemId: mv.itemId, onHandM: on, reservedM: res, availableM: on - res, requestedM: Math.max(-dOn, dRes - dOn)});
  }
  const prevOn = (prev[onF] || 0) * scale, prevRes = (prev[resF] || 0) * scale;
  let prevAvg: number | null, profile: any = null;
  if (isItem) prevAvg = prev.avgCostPaise ?? null;
  else { profile = await Inv.ProductProfile.findOne({productId: mv.itemId}).session(session).lean(); prevAvg = profile?.avgCostPaise ?? null; }
  const cost = mv.unitCostPaise !== undefined ? mv.unitCostPaise : (dOn < 0 ? prevAvg : null);
  let newAvg = nextAverage(prevOn, prevAvg, dOn, cost);
  if (mv.type === 'PRODUCTION_COST_ADJUSTMENT' && (mv.valuePaise || 0) > 0) {
    if (prevOn <= 0 || prevAvg == null) fail(409, 'Cannot allocate final production cost because accepted finished stock is no longer on hand');
    newAvg = round4((prevAvg as number) + (mv.valuePaise as number) / (prevOn / 1000));
  }
  if (newAvg !== prevAvg) {
    if (isItem) await Inv.Item.updateOne({_id: mv.itemId}, {$set: {avgCostPaise: newAvg}}, {session});
    else await Inv.ProductProfile.updateOne({productId: mv.itemId}, {$set: {avgCostPaise: newAvg}, $setOnInsert: {productId: mv.itemId}}, {session, upsert: true});
  }
  if (isItem && dOn > 0 && mv.type === 'PURCHASE_RECEIPT' && cost != null) await Inv.Item.updateOne({_id: mv.itemId}, {$set: {lastPurchaseRatePaise: round4(cost)}}, {session});
  const txnNo = await nextNumber('TXN', session, false);
  const [row] = await Inv.Ledger.create([{
    txnNo, itemKind: mv.kind, itemId: mv.itemId,
    itemCode: isItem ? prev.code : prev.sku, itemName: prev.name, itemType: isItem ? prev.itemType : 'FINISHED_GOOD', categoryId: isItem ? prev.categoryId : prev.category,
    unit: isItem ? prev.stockUnit : (prev.unit || 'pcs'),
    type: mv.type, qtyInM: Math.max(0, dOn), qtyOutM: Math.max(0, -dOn),
    prevM: prevOn, newM: prevOn + dOn, prevReservedM: prevRes, newReservedM: prevRes + dRes,
    unitCostPaise: cost == null ? null : round4(cost), valuePaise: mv.valuePaise ?? (cost == null || dOn === 0 ? (dOn === 0 ? 0 : null) : Math.round(Math.abs(dOn) / 1000 * cost)),
    avgBeforePaise: prevAvg, avgAfterPaise: newAvg,
    refType: mv.ref.type, refId: mv.ref.id, refNumber: mv.ref.number, refLine: mv.ref.line,
    location: mv.location ?? (isItem ? prev.location : ''), reason: mv.reason, notes: mv.notes,
    performedBy: actor, approvedBy: mv.approvedBy ?? null, approvedAt: mv.approvedBy ? new Date() : undefined,
    idempotencyKey: mv.key, reversalOf: mv.reversalOf ?? null,
  }], {session});
  return row.toObject();
}

/** Types that can be reversed directly from History; document-driven movements are corrected from their document. */
export const DIRECTLY_REVERSIBLE = ['OPENING', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'COUNT_ADJUSTMENT', 'WASTAGE'];

export async function reverse(session: mongoose.ClientSession, actor: Actor, ledgerId: string, reason: string) {
  const row: any = await Inv.Ledger.findById(ledgerId).session(session).lean();
  if (!row) fail(404, 'Ledger entry not found');
  if (row.type === 'REVERSAL') fail(409, 'A reversal cannot itself be reversed');
  if (row.reversedBy) fail(409, 'This entry has already been reversed');
  if (!DIRECTLY_REVERSIBLE.includes(row.type)) fail(409, `${row.type} entries are corrected from their source document, not reversed directly`);
  const rev = await post(session, actor, {
    kind: row.itemKind, itemId: row.itemId, type: 'REVERSAL',
    dOnM: -(row.qtyInM - row.qtyOutM), dResM: -((row.newReservedM ?? 0) - (row.prevReservedM ?? 0)),
    unitCostPaise: row.unitCostPaise, ref: {type: 'LEDGER', id: String(row._id), number: row.txnNo},
    key: `REV:${row._id}`, reason, reversalOf: String(row._id), approvedBy: actor,
  });
  const marked = await Inv.Ledger.updateOne({_id: row._id, reversedBy: null}, {$set: {reversedBy: String(rev._id)}}, {session});
  if (marked.modifiedCount !== 1) fail(409, 'This entry has already been reversed');
  return rev;
}
