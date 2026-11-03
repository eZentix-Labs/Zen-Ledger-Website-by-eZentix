import type {Express} from 'express';
import mongoose from 'mongoose';
import {z} from 'zod';
import {permissionsFor, requireAuth, requirePerm, sessionUser} from '../auth.js';
import {Inv} from './models.js';
import {UNITS, factorToStock, qtyToM} from './units.js';
import {escapeRegex, fail, paging, parse, route, sendPage} from './http.js';
import {Actor, mutate, nextNumber} from './txn.js';
import {post} from './stock.js';

const text = (max = 200) => z.string().trim().max(max);
const money = z.number().finite().min(0).max(1e10);
const fileRef = z.object({id: z.string().optional().default(''), url: z.string().min(1).max(2048), publicId: z.string().optional().default(''), name: z.string().max(200).optional(), mime: z.string().max(80).optional(), size: z.number().optional()});
const OPEN = ['DRAFT', 'SUBMITTED', 'APPROVED', 'PARTIALLY_RECEIVED'];

const lineIn = z.object({itemId: z.string().min(1), unit: z.string().min(1), qty: z.number().positive().max(1e8), rateRupees: money, discountPct: z.number().min(0).max(100).default(0), gstPct: z.number().min(0).max(28).default(0)});
const poBody = z.object({
  supplierId: z.string().min(1), expectedDate: z.string().optional().nullable(), paymentTermsDays: z.number().int().min(0).max(365).optional(),
  lines: z.array(lineIn).min(1).max(100), freightRupees: money.default(0), otherChargesRupees: money.default(0),
  supplierInvoiceNo: text(60).optional().default(''), notes: text(2000).optional().default(''), attachments: z.array(fileRef).max(10).optional().default([]),
  submit: z.boolean().optional().default(false),
});

async function settings() { return (await Inv.Settings.findById('default').lean() as any) || {purchaseApprovalLimitPaise: 0, selfApprovalAllowed: false, overReceiptToleranceBps: 0, companyStateCode: ''}; }
const stateOf = (gstin?: string) => (gstin && /^\d{2}/.test(gstin) ? gstin.slice(0, 2) : '');

/** Server-side purchase maths. Each line is rounded once; totals are sums of rounded lines. */
export async function buildLines(lines: z.infer<typeof lineIn>[], session?: mongoose.ClientSession) {
  const seen = new Set<string>();
  const out = [];
  for (const [i, l] of lines.entries()) {
    if (seen.has(l.itemId)) fail(400, 'Each item may appear only once per purchase order; combine the quantities');
    seen.add(l.itemId);
    if (!mongoose.isValidObjectId(l.itemId)) fail(400, 'Unknown item');
    const it: any = await Inv.Item.findById(l.itemId).session(session ?? null).lean();
    if (!it || it.status !== 'ACTIVE') fail(400, `Item on line ${i + 1} is not an active stock item`);
    const factor = factorToStock(l.unit, it.stockUnit, it.purchaseUnits);
    qtyToM(l.qty, l.unit);
    const orderedM = Math.round(l.qty * factor * 1000);
    if (orderedM <= 0) fail(400, `Line ${i + 1}: quantity is too small`);
    if (UNITS[it.stockUnit].dimension === 'COUNT' && orderedM % 1000) fail(400, `Line ${i + 1}: ${l.qty} ${l.unit} converts to ${orderedM / 1000} ${it.stockUnit}; ${it.stockUnit} must be whole numbers. Order in ${it.stockUnit} instead.`);
    const ratePaise = Math.round(l.rateRupees * 100 * 100) / 100;
    const taxablePaise = Math.round(l.qty * ratePaise * (1 - l.discountPct / 100));
    const gstRateBps = Math.round(l.gstPct * 100);
    const taxPaise = Math.round(taxablePaise * gstRateBps / 10000);
    out.push({lineNo: i + 1, itemId: String(it._id), itemCode: it.code, itemName: it.name, stockUnit: it.stockUnit, unit: l.unit, factor, qty: l.qty, orderedM, ratePaise, discountBps: Math.round(l.discountPct * 100), gstRateBps, taxablePaise, taxPaise, totalPaise: taxablePaise + taxPaise, receivedM: 0, acceptedM: 0, rejectedM: 0, returnedM: 0});
  }
  return out;
}
export function totals(lines: Array<{taxablePaise: number; taxPaise: number}>, freightPaise: number, otherChargesPaise: number, interState: boolean) {
  const taxablePaise = lines.reduce((a, l) => a + l.taxablePaise, 0), tax = lines.reduce((a, l) => a + l.taxPaise, 0);
  const cgstPaise = interState ? 0 : Math.floor(tax / 2), sgstPaise = interState ? 0 : tax - Math.floor(tax / 2), igstPaise = interState ? tax : 0;
  const gross = taxablePaise + tax + freightPaise + otherChargesPaise;
  const roundOffPaise = Math.round(gross / 100) * 100 - gross;
  return {taxablePaise, cgstPaise, sgstPaise, igstPaise, roundOffPaise, totalPaise: gross + roundOffPaise};
}
/** Landed cost per STOCK unit for a PO line: taxable value + its share of freight/other charges (GST excluded: input credit). */
export function landedUnitCost(po: any, line: any) {
  const share = po.taxablePaise > 0 ? (po.freightPaise + po.otherChargesPaise) * line.taxablePaise / po.taxablePaise : 0;
  return Math.round((line.taxablePaise + share) / (line.orderedM / 1000) * 10000) / 10000;
}

async function poData(b: z.infer<typeof poBody>, session: mongoose.ClientSession) {
  if (!mongoose.isValidObjectId(b.supplierId)) fail(400, 'Choose a supplier');
  const supplier: any = await Inv.Supplier.findById(b.supplierId).session(session).lean();
  if (!supplier || supplier.status !== 'ACTIVE') fail(400, 'Choose an active supplier');
  const s = await settings();
  const interState = Boolean(s.companyStateCode && stateOf(supplier.gstin) && stateOf(supplier.gstin) !== s.companyStateCode);
  const lines = await buildLines(b.lines, session);
  const freightPaise = Math.round(b.freightRupees * 100), otherChargesPaise = Math.round(b.otherChargesRupees * 100);
  return {supplier, data: {supplierId: String(supplier._id), supplierName: supplier.name, lines, freightPaise, otherChargesPaise, interState, ...totals(lines, freightPaise, otherChargesPaise, interState), expectedDate: b.expectedDate ? new Date(b.expectedDate) : null, paymentTermsDays: b.paymentTermsDays ?? supplier.paymentTermsDays, supplierInvoiceNo: b.supplierInvoiceNo, notes: b.notes, attachments: b.attachments}};
}

async function submitOrApprove(po: any, actor: Actor, session: mongoose.ClientSession) {
  const s = await settings();
  const auto = s.purchaseApprovalLimitPaise > 0 && po.totalPaise <= s.purchaseApprovalLimitPaise;
  const set: any = {status: auto ? 'APPROVED' : 'SUBMITTED', submittedAt: new Date()};
  if (auto) Object.assign(set, {approvedBy: {id: 'policy', name: `Auto-approved (within ₹${s.purchaseApprovalLimitPaise / 100} limit)`, role: 'system'}, approvedAt: new Date()});
  const r = await Inv.PurchaseOrder.updateOne({_id: po._id, status: 'DRAFT'}, {$set: set, $inc: {revision: 1}}, {session});
  if (!r.modifiedCount) fail(409, 'Only draft purchase orders can be submitted');
  return set.status;
}

export function registerPurchaseRoutes(app: Express) {
  // ----- Purchase orders -----
  app.get('/api/inventory/purchase-orders', requireAuth, requirePerm('inventory.view'), route(async (req, res) => {
    const {page, limit, skip} = paging(req);
    const filter: any = {};
    const GROUP: Record<string, string[]> = {OPEN, PENDING: ['SUBMITTED', 'APPROVED'], COMPLETED: ['FULLY_RECEIVED', 'CLOSED']};
    if (GROUP[String(req.query.status)]) filter.status = {$in: GROUP[String(req.query.status)]};
    else if (req.query.status) filter.status = String(req.query.status);
    if (req.query.supplierId) filter.supplierId = String(req.query.supplierId);
    const q = String(req.query.q || '').trim();
    if (q) filter.$or = [{number: {$regex: escapeRegex(q), $options: 'i'}}, {supplierName: {$regex: escapeRegex(q), $options: 'i'}}, {supplierInvoiceNo: {$regex: escapeRegex(q), $options: 'i'}}];
    if (req.query.from || req.query.to) filter.createdAt = {...(req.query.from ? {$gte: new Date(String(req.query.from))} : {}), ...(req.query.to ? {$lte: new Date(String(req.query.to))} : {})};
    const [total, items] = await Promise.all([Inv.PurchaseOrder.countDocuments(filter), Inv.PurchaseOrder.find(filter).sort({createdAt: -1}).skip(skip).limit(limit).lean()]);
    // Payment status comes from posted supplier bills linked to each order (a PO itself is never a payable).
    const bills = await Inv.Bill.aggregate([{$match: {poId: {$in: items.map((p: any) => String(p._id))}, status: {$in: ['POSTED', 'PARTIALLY_PAID', 'PAID']}}}, {$group: {_id: '$poId', billed: {$sum: '$totalPaise'}, paid: {$sum: '$paidPaise'}, attachments: {$sum: {$cond: [{$ifNull: ['$attachment.url', false]}, 1, 0]}}}}]);
    const bm = new Map(bills.map(b => [b._id, b]));
    sendPage(res, items.map((p: any) => { const b = bm.get(String(p._id)); return {...p, billedPaise: b?.billed ?? 0, paidPaise: b?.paid ?? 0, paymentStatus: !b ? 'NOT_BILLED' : b.paid <= 0 ? 'UNPAID' : b.paid < b.billed ? 'PARTIALLY_PAID' : 'PAID', invoiceAttachments: (p.attachments?.length || 0) + (b?.attachments ?? 0)}; }), total, page, limit);
  }));
  app.get('/api/inventory/purchase-orders/:id', requireAuth, requirePerm('inventory.view'), route(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) fail(404, 'Purchase order not found');
    const po: any = await Inv.PurchaseOrder.findById(req.params.id).lean();
    if (!po) fail(404, 'Purchase order not found');
    const id = String(po._id);
    const [grns, bills, returns] = await Promise.all([Inv.GoodsReceipt.find({poId: id}).sort({createdAt: 1}).lean(), Inv.Bill.find({poId: id}).lean(), Inv.PurchaseReturn.find({poId: id}).lean()]);
    res.json({...po, grns, bills, returns, lines: po.lines.map((l: any) => ({...l, landedUnitCostPaise: landedUnitCost(po, l), pendingM: Math.max(0, l.orderedM - l.acceptedM)}))});
  }));
  app.post('/api/inventory/purchase-orders', requireAuth, requirePerm('purchase.create'), route(async (req, res) => {
    const b = parse(poBody, req.body);
    const r = await mutate(req, 'PO_CREATE', async ({session, actor}) => {
      const {data} = await poData(b, session);
      const number = await nextNumber('PO', session);
      const [po] = await Inv.PurchaseOrder.create([{...data, number, status: 'DRAFT', orderDate: new Date(), createdBy: actor}], {session});
      const status = b.submit ? await submitOrApprove(po, actor, session) : 'DRAFT';
      return {id: String(po._id), number, status};
    });
    res.status(r.replayed ? 200 : 201).json(r);
  }));
  app.put('/api/inventory/purchase-orders/:id', requireAuth, requirePerm('purchase.create'), route(async (req, res) => {
    const b = parse(poBody.extend({revision: z.number().int().min(0)}), req.body);
    const r = await mutate(req, 'PO_EDIT', async ({session, actor}) => {
      const {data} = await poData(b, session);
      const po = await Inv.PurchaseOrder.findOneAndUpdate({_id: req.params.id, status: 'DRAFT', revision: b.revision}, {$set: data, $inc: {revision: 1}}, {session, returnDocument: 'after'});
      if (!po) fail(409, 'Only the latest version of a draft purchase order can be edited. Refresh and try again.');
      const status = b.submit ? await submitOrApprove(po, actor, session) : 'DRAFT';
      return {id: String(po!._id), number: po!.number, status};
    });
    res.json(r);
  }));
  app.delete('/api/inventory/purchase-orders/:id', requireAuth, requirePerm('purchase.create'), route(async (req, res) => {
    const r = await Inv.PurchaseOrder.deleteOne({_id: req.params.id, status: 'DRAFT'});
    if (!r.deletedCount) fail(409, 'Only draft purchase orders can be deleted');
    res.json({ok: true});
  }));
  app.post('/api/inventory/purchase-orders/:id/submit', requireAuth, requirePerm('purchase.create'), route(async (req, res) => {
    const r = await mutate(req, 'PO_SUBMIT', async ({session, actor}) => {
      const po: any = await Inv.PurchaseOrder.findById(req.params.id).session(session).lean();
      if (!po) fail(404, 'Purchase order not found');
      return {id: String(po._id), status: await submitOrApprove(po, actor, session)};
    });
    res.json(r);
  }));
  const decide = (action: 'approve' | 'reject' | 'cancel' | 'close') => route(async (req, res) => {
    const {reason} = parse(z.object({reason: text(500).optional().default('')}), req.body || {});
    if (action !== 'approve' && !reason) fail(400, 'A reason is required');
    const r = await mutate(req, `PO_${action.toUpperCase()}`, async ({session, actor}) => {
      const po: any = await Inv.PurchaseOrder.findById(req.params.id).session(session).lean();
      if (!po) fail(404, 'Purchase order not found');
      const s = await settings();
      let from: string[], set: any;
      if (action === 'approve') { from = ['SUBMITTED']; if (!s.selfApprovalAllowed && po.createdBy?.id === actor.id && actor.role !== 'owner') fail(403, 'You cannot approve a purchase order you created'); set = {status: 'APPROVED', approvedBy: actor, approvedAt: new Date()}; }
      else if (action === 'reject') { from = ['SUBMITTED']; set = {status: 'REJECTED', rejectReason: reason, approvedBy: actor, approvedAt: new Date()}; }
      else if (action === 'cancel') { from = ['DRAFT', 'SUBMITTED', 'APPROVED']; if (po.lines.some((l: any) => l.acceptedM > 0 || l.rejectedM > 0)) fail(409, 'Goods were already received; close the order short instead'); set = {status: 'CANCELLED', cancelReason: reason}; }
      else { from = ['PARTIALLY_RECEIVED', 'FULLY_RECEIVED', 'APPROVED']; set = {status: 'CLOSED', closedReason: reason}; }
      const u = await Inv.PurchaseOrder.updateOne({_id: po._id, status: {$in: from}}, {$set: set, $inc: {revision: 1}}, {session});
      if (!u.modifiedCount) fail(409, `Cannot ${action} a purchase order that is ${po.status.toLowerCase().replace('_', ' ')}`);
      return {id: String(po._id), status: set.status};
    });
    res.json(r);
  });
  app.post('/api/inventory/purchase-orders/:id/approve', requireAuth, requirePerm('purchase.approve'), decide('approve'));
  app.post('/api/inventory/purchase-orders/:id/reject', requireAuth, requirePerm('purchase.approve'), decide('reject'));
  app.post('/api/inventory/purchase-orders/:id/cancel', requireAuth, requirePerm('purchase.create'), decide('cancel'));
  app.post('/api/inventory/purchase-orders/:id/close', requireAuth, requirePerm('purchase.approve'), decide('close'));

  // ----- Goods receipt: the ONLY event that increases purchased stock -----
  const grnBody = z.object({
    receivedDate: z.string().optional(), supplierInvoiceNo: text(60).optional().default(''), notes: text(1000).optional().default(''), attachments: z.array(fileRef).max(10).optional().default([]),
    lines: z.array(z.object({lineNo: z.number().int().positive(), receivedQty: z.number().min(0), acceptedQty: z.number().min(0), rejectReason: text(300).optional().default('')})).min(1),
  });
  app.post('/api/inventory/purchase-orders/:id/receive', requireAuth, requirePerm('purchase.receive'), route(async (req, res) => {
    const b = parse(grnBody, req.body);
    const r = await mutate(req, 'GRN_POST', async ({session, actor}) => {
      const po: any = await Inv.PurchaseOrder.findById(req.params.id).session(session).lean();
      if (!po) fail(404, 'Purchase order not found');
      if (!['APPROVED', 'PARTIALLY_RECEIVED'].includes(po.status)) fail(409, `Goods can only be received against an approved purchase order (this one is ${po.status.toLowerCase().replace('_', ' ')})`);
      const s = await settings();
      const number = await nextNumber('GRN', session);
      const grnId = new mongoose.Types.ObjectId();
      const lines: any[] = [];
      const poLines = po.lines.map((l: any) => ({...l}));
      for (const g of b.lines) {
        const pl = poLines.find((l: any) => l.lineNo === g.lineNo);
        if (!pl) fail(400, `Line ${g.lineNo} is not on this purchase order`);
        if (g.acceptedQty > g.receivedQty) fail(400, `Line ${g.lineNo}: accepted quantity cannot exceed received quantity`);
        const receivedM = g.receivedQty ? qtyToM(g.receivedQty, pl.unit, {allowZero: true}) * pl.factor : 0, acceptedM = Math.round(g.acceptedQty * pl.factor * 1000);
        const recM = Math.round(receivedM), rejM = recM - acceptedM;
        if (UNITS[pl.stockUnit].dimension === 'COUNT' && (acceptedM % 1000 || recM % 1000)) fail(400, `Line ${g.lineNo}: quantities must convert to whole ${pl.stockUnit}`);
        if (recM === 0) continue;
        if (rejM > 0 && !g.rejectReason) fail(400, `Line ${g.lineNo}: give a reason for the rejected quantity`);
        const limitM = Math.floor(pl.orderedM * (1 + (s.overReceiptToleranceBps || 0) / 10000));
        if (pl.acceptedM + acceptedM > limitM) fail(409, `Line ${g.lineNo} (${pl.itemName}): accepting ${acceptedM / 1000} ${pl.stockUnit} would exceed the ordered quantity (${pl.orderedM / 1000}, already accepted ${pl.acceptedM / 1000})`);
        const unitCostPaise = landedUnitCost(po, pl);
        if (acceptedM > 0) await post(session, actor, {kind: 'ITEM', itemId: pl.itemId, type: 'PURCHASE_RECEIPT', dOnM: acceptedM, unitCostPaise, ref: {type: 'GRN', id: String(grnId), number, line: pl.lineNo}, key: `GRN:${grnId}:${pl.lineNo}`, reason: `Goods receipt against ${po.number}`});
        pl.receivedM += recM; pl.acceptedM += acceptedM; pl.rejectedM += rejM;
        lines.push({lineNo: pl.lineNo, itemId: pl.itemId, itemName: pl.itemName, stockUnit: pl.stockUnit, receivedM: recM, acceptedM, rejectedM: rejM, rejectReason: g.rejectReason, unitCostPaise, valuePaise: Math.round(acceptedM / 1000 * unitCostPaise)});
      }
      if (!lines.length) fail(400, 'Enter the received quantity for at least one line');
      const complete = poLines.every((l: any) => l.acceptedM >= l.orderedM);
      const u = await Inv.PurchaseOrder.updateOne({_id: po._id, revision: po.revision}, {$set: {lines: poLines, status: complete ? 'FULLY_RECEIVED' : 'PARTIALLY_RECEIVED', ...(b.supplierInvoiceNo && !po.supplierInvoiceNo ? {supplierInvoiceNo: b.supplierInvoiceNo} : {})}, $inc: {revision: 1}}, {session});
      if (!u.modifiedCount) fail(409, 'The purchase order changed while receiving. Refresh and try again.');
      await Inv.GoodsReceipt.create([{_id: grnId, number, poId: String(po._id), poNumber: po.number, supplierId: po.supplierId, supplierName: po.supplierName, supplierInvoiceNo: b.supplierInvoiceNo || po.supplierInvoiceNo, receivedDate: b.receivedDate ? new Date(b.receivedDate) : new Date(), lines, totalValuePaise: lines.reduce((a, l) => a + l.valuePaise, 0), notes: b.notes, attachments: b.attachments, postedBy: actor}], {session});
      return {id: String(grnId), number, poStatus: complete ? 'FULLY_RECEIVED' : 'PARTIALLY_RECEIVED'};
    });
    res.status(r.replayed ? 200 : 201).json(r);
  }));
  app.get('/api/inventory/goods-receipts', requireAuth, requirePerm('inventory.view'), route(async (req, res) => {
    const {page, limit, skip} = paging(req);
    const filter: any = req.query.supplierId ? {supplierId: String(req.query.supplierId)} : {};
    const [total, items] = await Promise.all([Inv.GoodsReceipt.countDocuments(filter), Inv.GoodsReceipt.find(filter).sort({createdAt: -1}).skip(skip).limit(limit).lean()]);
    sendPage(res, items, total, page, limit);
  }));

  // ----- Purchase returns (stock out at original GRN cost; debit note to supplier) -----
  app.post('/api/inventory/purchase-returns', requireAuth, requirePerm('purchase.return'), route(async (req, res) => {
    const b = parse(z.object({grnId: z.string().min(1), notes: text(1000).optional().default(''), lines: z.array(z.object({lineNo: z.number().int().positive(), qty: z.number().positive(), reason: text(300).min(2)})).min(1)}), req.body);
    const r = await mutate(req, 'PURCHASE_RETURN', async ({session, actor}) => {
      const grn: any = await Inv.GoodsReceipt.findById(b.grnId).session(session).lean();
      if (!grn || grn.status !== 'POSTED') fail(404, 'Goods receipt not found');
      const po: any = await Inv.PurchaseOrder.findById(grn.poId).session(session).lean();
      const prior = await Inv.PurchaseReturn.find({grnId: String(grn._id)}).session(session).lean();
      const number = await nextNumber('PRN', session);
      const retId = new mongoose.Types.ObjectId();
      const lines: any[] = [];
      for (const l of b.lines) {
        const gl = grn.lines.find((x: any) => x.lineNo === l.lineNo);
        if (!gl) fail(400, `Line ${l.lineNo} is not on this goods receipt`);
        const qtyM = qtyToM(l.qty, gl.stockUnit);
        const already = prior.flatMap((p: any) => p.lines).filter((x: any) => x.lineNo === l.lineNo).reduce((a: number, x: any) => a + x.qtyM, 0);
        if (already + qtyM > gl.acceptedM) fail(409, `Line ${l.lineNo}: cannot return more than was accepted (${(gl.acceptedM - already) / 1000} ${gl.stockUnit} remaining)`);
        await post(session, actor, {kind: 'ITEM', itemId: gl.itemId, type: 'PURCHASE_RETURN', dOnM: -qtyM, unitCostPaise: gl.unitCostPaise, ref: {type: 'PURCHASE_RETURN', id: String(retId), number, line: l.lineNo}, key: `PRN:${retId}:${l.lineNo}`, reason: l.reason});
        lines.push({lineNo: l.lineNo, itemId: gl.itemId, itemName: gl.itemName, qtyM, unitCostPaise: gl.unitCostPaise, valuePaise: Math.round(qtyM / 1000 * gl.unitCostPaise), reason: l.reason});
        if (po) { const pl = po.lines.find((x: any) => x.lineNo === l.lineNo); if (pl) pl.returnedM += qtyM; }
      }
      const value = lines.reduce((a, l) => a + l.valuePaise, 0);
      // Debit note includes the GST that was charged on the returned value.
      const gstShare = po ? lines.reduce((a, l) => { const pl = po.lines.find((x: any) => x.lineNo === l.lineNo); return a + Math.round(l.valuePaise * (pl?.gstRateBps || 0) / 10000); }, 0) : 0;
      await Inv.PurchaseReturn.create([{_id: retId, number, grnId: String(grn._id), grnNumber: grn.number, poId: grn.poId, supplierId: grn.supplierId, supplierName: grn.supplierName, lines, totalValuePaise: value + gstShare, notes: b.notes, createdBy: actor}], {session});
      if (po) await Inv.PurchaseOrder.updateOne({_id: po._id}, {$set: {lines: po.lines}, $inc: {revision: 1}}, {session});
      await Inv.SupplierLedger.create([{supplierId: grn.supplierId, date: new Date(), type: 'RETURN', amountPaise: -(value + gstShare), refType: 'PURCHASE_RETURN', refId: String(retId), refNumber: number, notes: `Debit note for ${grn.number}`, key: `RETURN:${retId}`, createdBy: actor}], {session});
      return {id: String(retId), number};
    });
    res.status(r.replayed ? 200 : 201).json(r);
  }));
  app.get('/api/inventory/purchase-returns', requireAuth, requirePerm('inventory.view'), route(async (req, res) => {
    const {page, limit, skip} = paging(req);
    const [total, items] = await Promise.all([Inv.PurchaseReturn.countDocuments(), Inv.PurchaseReturn.find().sort({createdAt: -1}).skip(skip).limit(limit).lean()]);
    sendPage(res, items, total, page, limit);
  }));

  // ----- Supplier bills (the payable) -----
  const billBody = z.object({
    supplierId: z.string().min(1), supplierInvoiceNo: text(60).min(1), invoiceDate: z.string().min(8), poId: z.string().optional().nullable(),
    lines: z.array(z.object({description: text(200).min(1), itemId: z.string().optional().nullable(), qty: z.number().min(0), unit: text(10).optional().default(''), rateRupees: money, gstPct: z.number().min(0).max(28).default(0)})).max(200).default([]),
    discountRupees: money.default(0), freightRupees: money.default(0), totalRupees: money, notes: text(2000).optional().default(''), attachment: fileRef.nullable().optional(), source: z.enum(['MANUAL', 'IMPORT']).default('MANUAL'),
  });
  const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
  app.get('/api/inventory/bills', requireAuth, requirePerm('inventory.view'), route(async (req, res) => {
    const {page, limit, skip} = paging(req);
    const filter: any = {};
    if (req.query.status === 'UNPAID') filter.status = {$in: ['POSTED', 'PARTIALLY_PAID']};
    else if (req.query.status) filter.status = String(req.query.status);
    if (req.query.supplierId) filter.supplierId = String(req.query.supplierId);
    const [total, items] = await Promise.all([Inv.Bill.countDocuments(filter), Inv.Bill.find(filter).sort({createdAt: -1}).skip(skip).limit(limit).lean()]);
    const now = Date.now();
    sendPage(res, items.map((b: any) => ({...b, overdue: ['POSTED', 'PARTIALLY_PAID'].includes(b.status) && b.dueDate && new Date(b.dueDate).getTime() < now})), total, page, limit);
  }));
  /** Pre-flight checks for a bill (also used by Import a Bill): duplicates, totals, PO match. */
  async function billWarnings(b: z.infer<typeof billBody>, excludeId?: string) {
    const warnings: string[] = [];
    const dup: any = await Inv.Bill.findOne({supplierId: b.supplierId, invoiceNoNorm: norm(b.supplierInvoiceNo), status: {$ne: 'CANCELLED'}, ...(excludeId ? {_id: {$ne: excludeId}} : {})}).lean();
    if (dup) warnings.push(`DUPLICATE: invoice ${b.supplierInvoiceNo} from this supplier is already recorded as ${dup.number}`);
    if (b.attachment?.id) { const f: any = await Inv.File.findById(b.attachment.id).lean().catch(() => null); if (f) { const same = await Inv.File.find({sha256: f.sha256, _id: {$ne: f._id}}).select('_id').lean(); if (same.length && await Inv.Bill.exists({'attachment.id': {$in: same.map((x: any) => String(x._id))}})) warnings.push('DUPLICATE_FILE: this exact file was already attached to another bill'); } }
    const lineTotal = b.lines.reduce((a, l) => a + Math.round(l.qty * l.rateRupees * 100 * (1 + l.gstPct / 100)), 0);
    if (b.lines.length) { const computed = lineTotal - Math.round(b.discountRupees * 100) + Math.round(b.freightRupees * 100); if (Math.abs(computed - Math.round(b.totalRupees * 100)) > 100) warnings.push(`TOTAL_MISMATCH: lines add up to ₹${(computed / 100).toFixed(2)} but the bill total is ₹${b.totalRupees.toFixed(2)}`); }
    for (const [i, l] of b.lines.entries()) if (!l.itemId) warnings.push(`UNMATCHED: line ${i + 1} "${l.description}" is not matched to a stock item`);
    if (b.poId && mongoose.isValidObjectId(b.poId)) {
      const po: any = await Inv.PurchaseOrder.findById(b.poId).lean();
      if (!po) warnings.push('PO_NOT_FOUND');
      else {
        if (po.supplierId !== b.supplierId) warnings.push('PO_SUPPLIER_MISMATCH: the purchase order is for a different supplier');
        for (const l of b.lines.filter(x => x.itemId)) { const pl = po.lines.find((p: any) => p.itemId === l.itemId); if (!pl) warnings.push(`NOT_ON_PO: ${l.description} is not on ${po.number}`); else if (Math.round(l.qty * pl.factor * 1000) > pl.acceptedM) warnings.push(`QTY_MISMATCH: ${l.description} billed ${l.qty} ${l.unit || pl.unit} but only ${pl.acceptedM / pl.factor / 1000} ${pl.unit} accepted so far`); }
      }
    }
    return warnings;
  }
  app.post('/api/inventory/bills/check', requireAuth, requirePerm('bill.manage'), route(async (req, res) => {
    const b = parse(billBody, req.body);
    res.json({warnings: await billWarnings(b)});
  }));
  app.post('/api/inventory/bills', requireAuth, requirePerm('bill.manage'), route(async (req, res) => {
    const b = parse(billBody, req.body);
    const r = await mutate(req, 'BILL_CREATE', async ({session, actor}) => {
      const supplier: any = mongoose.isValidObjectId(b.supplierId) ? await Inv.Supplier.findById(b.supplierId).session(session).lean() : null;
      if (!supplier) fail(400, 'Choose a supplier');
      const warnings = await billWarnings(b);
      if (warnings.some(w => w.startsWith('DUPLICATE:'))) fail(409, warnings.find(w => w.startsWith('DUPLICATE:'))!.slice(11));
      const invoiceDate = new Date(b.invoiceDate);
      if (Number.isNaN(invoiceDate.getTime())) fail(400, 'Invalid invoice date');
      const lines = b.lines.map(l => ({description: l.description, itemId: l.itemId || undefined, qty: l.qty, unit: l.unit, ratePaise: Math.round(l.rateRupees * 100), gstRateBps: Math.round(l.gstPct * 100), amountPaise: Math.round(l.qty * l.rateRupees * 100)}));
      const taxablePaise = lines.reduce((a, l) => a + l.amountPaise, 0), taxPaise = lines.reduce((a, l) => a + Math.round(l.amountPaise * l.gstRateBps / 10000), 0);
      const number = await nextNumber('BILL', session);
      const [bill] = await Inv.Bill.create([{number, supplierId: String(supplier._id), supplierName: supplier.name, supplierInvoiceNo: b.supplierInvoiceNo, invoiceNoNorm: norm(b.supplierInvoiceNo), invoiceDate, dueDate: new Date(invoiceDate.getTime() + (supplier.paymentTermsDays || 0) * 86400000), poId: b.poId || undefined, grnIds: b.poId ? (await Inv.GoodsReceipt.find({poId: b.poId}).session(session).select('_id').lean()).map((g: any) => String(g._id)) : [], lines, taxablePaise, taxPaise, discountPaise: Math.round(b.discountRupees * 100), freightPaise: Math.round(b.freightRupees * 100), totalPaise: Math.round(b.totalRupees * 100), status: 'DRAFT', attachment: b.attachment || undefined, notes: b.notes, warnings, createdBy: actor, importId: b.source === 'IMPORT' ? 'manual-review' : undefined}], {session});
      return {id: String(bill._id), number, warnings};
    });
    res.status(r.replayed ? 200 : 201).json(r);
  }));
  app.post('/api/inventory/bills/:id/post', requireAuth, requirePerm('bill.manage'), route(async (req, res) => {
    const r = await mutate(req, 'BILL_POST', async ({session, actor}) => {
      const bill: any = await Inv.Bill.findOneAndUpdate({_id: req.params.id, status: 'DRAFT'}, {$set: {status: 'POSTED', postedBy: actor, postedAt: new Date()}}, {session, returnDocument: 'after'}).lean();
      if (!bill) fail(409, 'Only draft bills can be posted');
      await Inv.SupplierLedger.create([{supplierId: bill.supplierId, date: bill.invoiceDate, type: 'BILL', amountPaise: bill.totalPaise, refType: 'BILL', refId: String(bill._id), refNumber: bill.number, notes: `Supplier invoice ${bill.supplierInvoiceNo}`, key: `BILL:${bill._id}`, createdBy: actor}], {session});
      return {id: String(bill._id), status: 'POSTED'};
    });
    res.json(r);
  }));
  app.post('/api/inventory/bills/:id/cancel', requireAuth, requirePerm('bill.manage'), route(async (req, res) => {
    const u = await Inv.Bill.updateOne({_id: req.params.id, status: 'DRAFT'}, {$set: {status: 'CANCELLED'}});
    if (!u.modifiedCount) fail(409, 'Only draft bills can be cancelled; posted bills are corrected with a debit note');
    res.json({ok: true});
  }));

  // ----- Import a bill: no extraction provider is configured, so this is assisted manual entry -----
  app.get('/api/inventory/bill-import/config', requireAuth, requirePerm('bill.manage'), route(async (_req, res) => {
    res.json({extraction: process.env.BILL_EXTRACTION_PROVIDER || null, message: process.env.BILL_EXTRACTION_PROVIDER ? 'Extraction enabled' : 'Automatic extraction is not configured. Upload the bill and type the details beside it; nothing reaches stock until goods are received.'});
  }));
  app.post('/api/inventory/bill-import/match', requireAuth, requirePerm('bill.manage'), route(async (req, res) => {
    const {supplierId, descriptions} = parse(z.object({supplierId: z.string().optional(), descriptions: z.array(text(200)).max(200)}), req.body);
    const items: any[] = await Inv.Item.find({status: 'ACTIVE'}).select('name code sku stockUnit purchaseUnits').lean();
    const tokens = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 1));
    const matches = descriptions.map(d => {
      const exact = items.find(i => [i.code, i.sku].filter(Boolean).some(c => d.toUpperCase().includes(String(c).toUpperCase())));
      if (exact) return {description: d, itemId: String(exact._id), name: exact.name, confidence: 'CODE'};
      const t = tokens(d); let best: any = null, score = 0;
      for (const i of items) { const it = tokens(i.name); const common = [...t].filter(x => it.has(x)).length; const s = common / Math.max(1, Math.max(t.size, it.size)); if (s > score) { score = s; best = i; } }
      return score >= 0.5 ? {description: d, itemId: String(best._id), name: best.name, confidence: 'SUGGESTED'} : {description: d, itemId: null, name: null, confidence: 'NONE'};
    });
    const openPos = supplierId ? await Inv.PurchaseOrder.find({supplierId, status: {$in: ['APPROVED', 'PARTIALLY_RECEIVED', 'FULLY_RECEIVED']}}).select('number status totalPaise').sort({createdAt: -1}).limit(20).lean() : [];
    res.json({matches, openPurchaseOrders: openPos});
  }));

  // ----- Supplier payments -----
  const payBody = z.object({supplierId: z.string().min(1), amountRupees: z.number().positive().max(1e10), method: z.enum(['CASH', 'BANK', 'UPI', 'CHEQUE', 'OTHER']), reference: text(80).optional().default(''), date: z.string().optional(), notes: text(500).optional().default(''), allocations: z.array(z.object({billId: z.string(), amountRupees: z.number().positive()})).optional(), proof: fileRef.nullable().optional()});
  app.get('/api/inventory/supplier-payments', requireAuth, requirePerm('inventory.view'), route(async (req, res) => {
    const {page, limit, skip} = paging(req);
    const filter: any = req.query.supplierId ? {supplierId: String(req.query.supplierId)} : {};
    const [total, items] = await Promise.all([Inv.SupplierPayment.countDocuments(filter), Inv.SupplierPayment.find(filter).sort({createdAt: -1}).skip(skip).limit(limit).lean()]);
    sendPage(res, items, total, page, limit);
  }));
  app.post('/api/inventory/supplier-payments', requireAuth, requirePerm('supplierPayment.record'), route(async (req, res) => {
    const b = parse(payBody, req.body);
    const r = await mutate(req, 'SUPPLIER_PAYMENT', async ({session, actor}) => {
      if (!await Inv.Supplier.exists({_id: b.supplierId}).session(session)) fail(400, 'Choose a supplier');
      const amountPaise = Math.round(b.amountRupees * 100);
      const open: any[] = await Inv.Bill.find({supplierId: b.supplierId, status: {$in: ['POSTED', 'PARTIALLY_PAID']}}).sort({invoiceDate: 1, createdAt: 1}).session(session).lean();
      let allocations: {billId: string; amountPaise: number}[] = [];
      if (b.allocations?.length) {
        allocations = b.allocations.map(a => ({billId: a.billId, amountPaise: Math.round(a.amountRupees * 100)}));
        if (allocations.reduce((s, a) => s + a.amountPaise, 0) > amountPaise) fail(400, 'Allocations exceed the payment amount');
        for (const a of allocations) { const bill = open.find(x => String(x._id) === a.billId); if (!bill) fail(400, 'An allocated bill is not open for this supplier'); if (a.amountPaise > bill.totalPaise - bill.paidPaise) fail(400, `Allocation exceeds the balance of ${bill.number}`); }
      } else {
        let left = amountPaise;
        for (const bill of open) { if (left <= 0) break; const take = Math.min(left, bill.totalPaise - bill.paidPaise); if (take > 0) { allocations.push({billId: String(bill._id), amountPaise: take}); left -= take; } }
      }
      for (const a of allocations) {
        const bill = open.find(x => String(x._id) === a.billId);
        const paid = bill.paidPaise + a.amountPaise;
        const u = await Inv.Bill.updateOne({_id: a.billId, paidPaise: bill.paidPaise}, {$set: {paidPaise: paid, status: paid >= bill.totalPaise ? 'PAID' : 'PARTIALLY_PAID'}}, {session});
        if (!u.modifiedCount) fail(409, 'A bill changed while paying. Refresh and try again.');
      }
      const number = await nextNumber('SPAY', session);
      const [p] = await Inv.SupplierPayment.create([{number, supplierId: b.supplierId, amountPaise, method: b.method, reference: b.reference, date: b.date ? new Date(b.date) : new Date(), allocations, proof: b.proof || undefined, notes: b.notes, createdBy: actor}], {session});
      await Inv.SupplierLedger.create([{supplierId: b.supplierId, date: p.date, type: 'PAYMENT', amountPaise: -amountPaise, refType: 'PAYMENT', refId: String(p._id), refNumber: number, notes: `${b.method}${b.reference ? ` ${b.reference}` : ''}`, key: `PAYMENT:${p._id}`, createdBy: actor}], {session});
      return {id: String(p._id), number};
    });
    res.status(r.replayed ? 200 : 201).json(r);
  }));
  app.post('/api/inventory/supplier-payments/:id/void', requireAuth, requirePerm('supplierPayment.record'), route(async (req, res) => {
    const {reason} = parse(z.object({reason: text(300).min(3)}), req.body);
    if (sessionUser(req).role !== 'owner' && !(await permissionsFor(sessionUser(req).role)).includes('purchase.approve')) fail(403, 'Only an Admin can void a supplier payment');
    const r = await mutate(req, 'SUPPLIER_PAYMENT_VOID', async ({session, actor}) => {
      const p: any = await Inv.SupplierPayment.findOneAndUpdate({_id: req.params.id, status: 'POSTED'}, {$set: {status: 'VOID', voidReason: reason}}, {session, returnDocument: 'after'}).lean();
      if (!p) fail(409, 'Payment not found or already void');
      for (const a of p.allocations) {
        const bill: any = await Inv.Bill.findById(a.billId).session(session).lean();
        const paid = bill.paidPaise - a.amountPaise;
        await Inv.Bill.updateOne({_id: a.billId}, {$set: {paidPaise: paid, status: paid <= 0 ? 'POSTED' : 'PARTIALLY_PAID'}}, {session});
      }
      await Inv.SupplierLedger.create([{supplierId: p.supplierId, date: new Date(), type: 'PAYMENT_VOID', amountPaise: p.amountPaise, refType: 'PAYMENT', refId: String(p._id), refNumber: p.number, notes: `Void: ${reason}`, key: `PAYMENT_VOID:${p._id}`, createdBy: actor}], {session});
      return {id: String(p._id), status: 'VOID'};
    });
    res.json(r);
  }));
}
