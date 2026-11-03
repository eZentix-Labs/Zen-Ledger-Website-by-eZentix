import type {Express} from 'express';
import mongoose from 'mongoose';
import {z} from 'zod';
import {permissionsFor, requireAuth, requirePerm, sessionUser, setGrantsCache, DELEGABLE} from '../auth.js';
import {Models} from '../models.js';
import {Inv} from './models.js';
import {qtyToM} from './units.js';
import {escapeRegex, fail, paging, parse, route, sendPage} from './http.js';
import {Actor, mutate, nextNumber} from './txn.js';
import {post, reverse} from './stock.js';
import {DEFAULT_STAGES} from './routes-production.js';

const text = (max = 200) => z.string().trim().max(max);
const fileRef = z.object({id: z.string().optional().default(''), url: z.string().min(1).max(2048), publicId: z.string().optional().default(''), name: z.string().max(200).optional(), mime: z.string().max(80).optional(), size: z.number().optional()});
export const WASTAGE_TYPES = ['CUTTING_WASTE', 'DAMAGED_STEEL', 'WELDING_WASTE', 'GRINDING_WASTE', 'PAINT_WASTE', 'DEFECTIVE_COMPONENT', 'DAMAGED_FINISHED_PRODUCT', 'PACKAGING_DAMAGE', 'EXPIRED_UNUSABLE', 'OTHER'] as const;

async function loadSubject(kind: 'ITEM' | 'PRODUCT', id: string, session?: mongoose.ClientSession) {
  if (kind === 'ITEM') {
    const it: any = mongoose.isValidObjectId(id) ? await Inv.Item.findById(id).session(session ?? null).lean() : null;
    if (!it) fail(404, 'Stock item not found');
    return {name: it.name, code: it.code, unit: it.stockUnit, onHandM: it.onHandM, reservedM: it.reservedM, avg: it.avgCostPaise ?? null, categoryId: it.categoryId, location: it.location};
  }
  const p: any = await Models.products.findOne({id}).session(session ?? null).lean();
  if (!p) fail(404, 'Product not found');
  const prof: any = await Inv.ProductProfile.findOne({productId: id}).session(session ?? null).lean();
  return {name: p.name, code: p.sku, unit: 'pcs', onHandM: p.stock * 1000, reservedM: (p.reservedStock || 0) * 1000, avg: prof?.avgCostPaise ?? null, categoryId: p.category, location: ''};
}
async function settingsDoc() { return (await Inv.Settings.findById('default').lean() as any) || {adjustmentApprovalLimitPaise: 0, selfApprovalAllowed: false}; }
async function canApproveOwn(actor: Actor, createdBy?: {id?: string}) { const s = await settingsDoc(); if (createdBy?.id === actor.id && !s.selfApprovalAllowed && actor.role !== 'owner') fail(403, 'You cannot approve a record you created'); }

export function registerControlRoutes(app: Express) {
  // ---------------- Wastage ----------------
  const wBody = z.object({itemKind: z.enum(['ITEM', 'PRODUCT']).default('ITEM'), itemId: z.string().min(1), qty: z.number().positive(), wastageType: z.enum(WASTAGE_TYPES), reason: text(300).min(2), notes: text(1000).optional().default(''), productionOrderId: z.string().optional().nullable(), grnId: z.string().optional().nullable(), images: z.array(fileRef).max(6).optional().default([])});
  app.get('/api/inventory/wastage', requireAuth, requirePerm('inventory.view'), route(async (req, res) => {
    const {page, limit, skip} = paging(req);
    const filter: any = {};
    if (req.query.status) filter.status = String(req.query.status);
    if (req.query.wastageType) filter.wastageType = String(req.query.wastageType);
    if (req.query.source) filter.source = String(req.query.source);
    if (req.query.productionOrderId) filter.productionOrderId = String(req.query.productionOrderId);
    if (req.query.from || req.query.to) filter.createdAt = {...(req.query.from ? {$gte: new Date(String(req.query.from))} : {}), ...(req.query.to ? {$lte: new Date(String(req.query.to) + 'T23:59:59.999Z')} : {})};
    if (req.query.categoryId) filter.itemId = {$in: (await Inv.Item.find({categoryId: String(req.query.categoryId)}).select('_id').lean()).map((i: any) => String(i._id))};
    const [total, items, sums] = await Promise.all([Inv.Wastage.countDocuments(filter), Inv.Wastage.find(filter).sort({createdAt: -1}).skip(skip).limit(limit).lean(), Inv.Wastage.aggregate([{$match: {...filter, status: 'APPROVED'}}, {$group: {_id: '$wastageType', cost: {$sum: {$ifNull: ['$costPaise', 0]}}, count: {$sum: 1}}}])]);
    res.set('X-Total-Count', String(total)).json({items, total, page, limit, approvedByType: sums});
  }));
  app.post('/api/inventory/wastage', requireAuth, requirePerm('wastage.report'), route(async (req, res) => {
    const b = parse(wBody, req.body);
    const r = await mutate(req, 'WASTAGE_REPORT', async ({session, actor}) => {
      const s = await loadSubject(b.itemKind, b.itemId, session);
      const qtyM = qtyToM(b.qty, s.unit);
      let prod: any = null;
      if (b.productionOrderId) {
        prod = mongoose.isValidObjectId(b.productionOrderId) ? await Inv.Production.findById(b.productionOrderId).session(session).lean() : null;
        if (!prod) fail(400, 'Production order not found');
        const l = prod.lines.find((x: any) => x.itemId === b.itemId);
        if (!l) fail(400, 'This material was not issued to that production order');
        const unaccounted = l.issuedM - l.returnedM - l.wastedM - l.consumedM;
        if (qtyM > unaccounted) fail(409, `Only ${unaccounted / 1000} ${l.unit} of issued ${l.itemName} is unaccounted for on ${prod.number}`);
      } else if (qtyM > s.onHandM - s.reservedM) fail(409, `Only ${(s.onHandM - s.reservedM) / 1000} ${s.unit} of ${s.name} is available`);
      const number = await nextNumber('WST', session);
      const [w] = await Inv.Wastage.create([{number, itemKind: b.itemKind, itemId: b.itemId, itemName: s.name, unit: s.unit, qtyM, wastageType: b.wastageType, reason: b.reason, notes: b.notes, source: prod ? 'PRODUCTION' : 'STORE', productionOrderId: prod ? String(prod._id) : undefined, productionNumber: prod?.number, grnId: b.grnId || undefined, images: b.images, status: 'PENDING', reportedBy: actor}], {session});
      return {id: String(w._id), number, status: 'PENDING'};
    });
    res.status(r.replayed ? 200 : 201).json(r);
  }));
  app.put('/api/inventory/wastage/:id', requireAuth, requirePerm('wastage.report'), route(async (req, res) => {
    const b = parse(wBody.pick({qty: true, wastageType: true, reason: true, notes: true, images: true}), req.body);
    const w: any = await Inv.Wastage.findOne({_id: req.params.id, status: 'PENDING'}).lean();
    if (!w) fail(409, 'Only pending wastage can be edited');
    await Inv.Wastage.updateOne({_id: w._id, status: 'PENDING'}, {$set: {qtyM: qtyToM(b.qty, w.unit), wastageType: b.wastageType, reason: b.reason, notes: b.notes, images: b.images}});
    res.json({ok: true});
  }));
  app.post('/api/inventory/wastage/:id/approve', requireAuth, requirePerm('wastage.approve'), route(async (req, res) => {
    const r = await mutate(req, 'WASTAGE_APPROVE', async ({session, actor}) => {
      const w: any = await Inv.Wastage.findOne({_id: req.params.id}).session(session).lean();
      if (!w) fail(404, 'Wastage record not found');
      if (w.status !== 'PENDING') fail(409, `This wastage record is already ${w.status.toLowerCase()}`);
      await canApproveOwn(actor, w.reportedBy);
      let cost: number | null;
      if (w.source === 'PRODUCTION') {
        // Material already left stock when it was issued; approval only classifies part of it as wastage.
        const prod: any = await Inv.Production.findById(w.productionOrderId).session(session).lean();
        const lines = prod.lines.map((l: any) => ({...l}));
        const l = lines.find((x: any) => x.itemId === w.itemId);
        const unaccounted = l.issuedM - l.returnedM - l.wastedM - l.consumedM;
        if (w.qtyM > unaccounted) fail(409, `Only ${unaccounted / 1000} ${l.unit} of issued material is still unaccounted for`);
        const issueCost = l.issuedM ? l.issuedValuePaise / (l.issuedM / 1000) : null;
        cost = issueCost == null ? null : Math.round(w.qtyM / 1000 * issueCost);
        l.wastedM += w.qtyM;
        await Inv.Production.updateOne({_id: prod._id}, {$set: {lines}, $push: {history: {at: new Date(), by: actor.name, action: 'WASTAGE_APPROVED', notes: `${w.number}: ${w.qtyM / 1000} ${l.unit} ${l.itemName}`}}}, {session});
      } else {
        const mv = await post(session, actor, {kind: w.itemKind, itemId: w.itemId, type: 'WASTAGE', dOnM: -w.qtyM, ref: {type: 'WASTAGE', id: String(w._id), number: w.number}, key: `WASTE:${w._id}`, reason: `${w.wastageType}: ${w.reason}`, approvedBy: actor});
        cost = mv.valuePaise;
      }
      const u = await Inv.Wastage.updateOne({_id: w._id, status: 'PENDING'}, {$set: {status: 'APPROVED', approvedBy: actor, approvedAt: new Date(), costPaise: cost}}, {session});
      if (!u.modifiedCount) fail(409, 'This wastage record was already processed');
      return {id: String(w._id), status: 'APPROVED', costPaise: cost};
    });
    res.json(r);
  }));
  app.post('/api/inventory/wastage/:id/reject', requireAuth, requirePerm('wastage.approve'), route(async (req, res) => {
    const {reason} = parse(z.object({reason: text(300).min(2)}), req.body);
    const u = await Inv.Wastage.updateOne({_id: req.params.id, status: 'PENDING'}, {$set: {status: 'REJECTED', rejectReason: reason, approvedBy: {id: sessionUser(req).id, name: sessionUser(req).name, role: sessionUser(req).role}, approvedAt: new Date()}});
    if (!u.modifiedCount) fail(409, 'Only pending wastage can be rejected');
    res.json({ok: true});
  }));

  // ---------------- Stock counts ----------------
  const latestTxn = async (itemId: string, session?: mongoose.ClientSession) => String(((await Inv.Ledger.findOne({itemId}).sort({_id: -1}).select('_id').session(session ?? null).lean()) as any)?._id || '');
  app.get('/api/inventory/stock-counts', requireAuth, requirePerm('inventory.view'), route(async (req, res) => {
    const {page, limit, skip} = paging(req);
    const filter: any = req.query.status ? {status: String(req.query.status)} : {};
    const [total, items] = await Promise.all([Inv.Count.countDocuments(filter), Inv.Count.find(filter).sort({createdAt: -1}).skip(skip).limit(limit).select('-lines').lean()]);
    sendPage(res, items, total, page, limit);
  }));
  app.get('/api/inventory/stock-counts/:id', requireAuth, requirePerm('inventory.view'), route(async (req, res) => {
    const c: any = mongoose.isValidObjectId(req.params.id) ? await Inv.Count.findById(req.params.id).lean() : null;
    if (!c) fail(404, 'Stock count not found');
    const canApprove = (await permissionsFor(sessionUser(req).role)).includes('count.approve');
    const hide = c.blind && c.status === 'IN_PROGRESS' && !canApprove;
    res.json({...c, lines: c.lines.map((l: any) => hide ? {...l, systemM: null, varianceM: null} : l)});
  }));
  app.post('/api/inventory/stock-counts', requireAuth, requirePerm('count.manage'), route(async (req, res) => {
    const b = parse(z.object({scope: z.enum(['FULL', 'CATEGORY', 'LOCATION', 'ITEMS']), scopeValue: text(80).optional().default(''), itemIds: z.array(z.string()).max(2000).optional().default([]), includeFinishedGoods: z.boolean().default(false), blind: z.boolean().default(false), assignedTo: text(120).optional().default(''), notes: text(500).optional().default('')}), req.body);
    const r = await mutate(req, 'COUNT_CREATE', async ({session, actor}) => {
      const filter: any = {status: 'ACTIVE'};
      if (b.scope === 'CATEGORY') { if (!b.scopeValue) fail(400, 'Choose a category'); filter.categoryId = b.scopeValue; }
      if (b.scope === 'LOCATION') { if (!b.scopeValue) fail(400, 'Choose a location'); filter.location = b.scopeValue; }
      if (b.scope === 'ITEMS') filter._id = {$in: b.itemIds.filter(id => mongoose.isValidObjectId(id))};
      const items: any[] = b.scope === 'ITEMS' && !b.itemIds.some(id => mongoose.isValidObjectId(id)) ? [] : await Inv.Item.find(filter).sort({name: 1}).session(session).lean();
      const lines = await Promise.all(items.map(async i => ({itemKind: 'ITEM', itemId: String(i._id), itemCode: i.code, itemName: i.name, unit: i.stockUnit, location: i.location, systemM: i.onHandM, watermark: await latestTxn(String(i._id), session), countedM: null})));
      const productIds = b.scope === 'ITEMS' ? b.itemIds.filter(id => !mongoose.isValidObjectId(id)) : [];
      if (b.includeFinishedGoods || productIds.length) {
        const prods: any[] = await Models.products.find(productIds.length ? {id: {$in: productIds}} : {status: 'active'}).session(session).lean();
        for (const p of prods) lines.push({itemKind: 'PRODUCT', itemId: p.id, itemCode: p.sku, itemName: p.name, unit: 'pcs', location: '', systemM: p.stock * 1000, watermark: await latestTxn(p.id, session), countedM: null});
      }
      if (!lines.length) fail(400, 'No items match this count scope');
      const number = await nextNumber('CNT', session);
      const [c] = await Inv.Count.create([{number, scope: b.scope, scopeValue: b.scopeValue, blind: b.blind, assignedTo: b.assignedTo, notes: b.notes, status: 'IN_PROGRESS', lines, createdBy: actor}], {session});
      return {id: String(c._id), number, lines: lines.length};
    });
    res.status(r.replayed ? 200 : 201).json(r);
  }));
  app.put('/api/inventory/stock-counts/:id/lines', requireAuth, requirePerm('count.manage'), route(async (req, res) => {
    const b = parse(z.object({lines: z.array(z.object({itemId: z.string(), countedQty: z.number().min(0).nullable(), reason: text(300).optional().default('')})).max(5000)}), req.body);
    const c: any = await Inv.Count.findOne({_id: req.params.id, status: 'IN_PROGRESS'}).lean();
    if (!c) fail(409, 'This count is no longer open for entry');
    const lines = c.lines.map((l: any) => {
      const x = b.lines.find(y => y.itemId === l.itemId);
      if (!x) return l;
      const countedM = x.countedQty == null ? null : qtyToM(x.countedQty, l.unit, {allowZero: true});
      return {...l, countedM, varianceM: countedM == null ? null : countedM - l.systemM, reason: x.reason};
    });
    await Inv.Count.updateOne({_id: c._id, status: 'IN_PROGRESS'}, {$set: {lines}});
    res.json({ok: true});
  }));
  app.post('/api/inventory/stock-counts/:id/submit', requireAuth, requirePerm('count.manage'), route(async (req, res) => {
    const c: any = await Inv.Count.findOne({_id: req.params.id, status: 'IN_PROGRESS'}).lean();
    if (!c) fail(409, 'This count is not open');
    const missing = c.lines.filter((l: any) => l.countedM == null);
    if (missing.length) fail(400, `${missing.length} item(s) have not been counted yet`);
    const noReason = c.lines.filter((l: any) => l.varianceM && !l.reason);
    if (noReason.length) fail(400, `Give a reason for every difference (${noReason.map((l: any) => l.itemName).slice(0, 5).join(', ')})`);
    await Inv.Count.updateOne({_id: c._id, status: 'IN_PROGRESS'}, {$set: {status: 'SUBMITTED', submittedAt: new Date()}});
    res.json({ok: true, status: 'SUBMITTED'});
  }));
  app.post('/api/inventory/stock-counts/:id/approve', requireAuth, requirePerm('count.approve'), route(async (req, res) => {
    const r = await mutate(req, 'COUNT_APPROVE', async ({session, actor}) => {
      const c: any = await Inv.Count.findOne({_id: req.params.id}).session(session).lean();
      if (!c) fail(404, 'Stock count not found');
      if (c.status !== 'SUBMITTED') fail(409, c.status === 'POSTED' ? 'This count was already posted' : 'Submit the count before approving it');
      await canApproveOwn(actor, c.createdBy);
      const stale: string[] = [];
      for (const l of c.lines) {
        const s = await loadSubject(l.itemKind, l.itemId, session);
        if (s.onHandM !== l.systemM || await latestTxn(l.itemId, session) !== (l.watermark || '')) stale.push(l.itemName);
      }
      if (stale.length) fail(409, `Stock moved after counting started for: ${stale.slice(0, 10).join(', ')}. Start a fresh count for these items.`, {stale});
      let posted = 0;
      for (const l of c.lines) {
        if (!l.varianceM) continue;
        await post(session, actor, {kind: l.itemKind, itemId: l.itemId, type: 'COUNT_ADJUSTMENT', dOnM: l.varianceM, ref: {type: 'STOCK_COUNT', id: String(c._id), number: c.number}, key: `COUNT:${c._id}:${l.itemId}`, reason: l.reason, approvedBy: actor, ...(l.varianceM > 0 ? {unitCostPaise: (await loadSubject(l.itemKind, l.itemId, session)).avg} : {})});
        posted++;
      }
      const u = await Inv.Count.updateOne({_id: c._id, status: 'SUBMITTED'}, {$set: {status: 'POSTED', approvedBy: actor, approvedAt: new Date()}}, {session});
      if (!u.modifiedCount) fail(409, 'This count was already posted');
      return {id: String(c._id), status: 'POSTED', adjustments: posted};
    });
    res.json(r);
  }));
  app.post('/api/inventory/stock-counts/:id/reject', requireAuth, requirePerm('count.approve'), route(async (req, res) => {
    const {reason} = parse(z.object({reason: text(300).min(2)}), req.body);
    const u = await Inv.Count.updateOne({_id: req.params.id, status: {$in: ['SUBMITTED', 'IN_PROGRESS']}}, {$set: {status: 'REJECTED', rejectReason: reason}});
    if (!u.modifiedCount) fail(409, 'This count cannot be rejected');
    res.json({ok: true});
  }));

  // ---------------- Adjustments ----------------
  const ALWAYS_APPROVE = ['MISSING', 'DAMAGED', 'DATA_CORRECTION'];
  app.get('/api/inventory/adjustments', requireAuth, requirePerm('inventory.view'), route(async (req, res) => {
    const {page, limit, skip} = paging(req);
    const filter: any = req.query.status ? {status: String(req.query.status)} : {};
    const [total, items] = await Promise.all([Inv.Adjustment.countDocuments(filter), Inv.Adjustment.find(filter).sort({createdAt: -1}).skip(skip).limit(limit).lean()]);
    sendPage(res, items, total, page, limit);
  }));
  async function postAdjustment(session: mongoose.ClientSession, actor: Actor, a: any) {
    const s = await loadSubject(a.itemKind, a.itemId, session);
    const incoming = a.adjustM > 0;
    await post(session, actor, {kind: a.itemKind, itemId: a.itemId, type: incoming ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT', dOnM: a.adjustM, ...(incoming ? {unitCostPaise: a.unitCostPaise ?? s.avg} : {}), ref: {type: 'ADJUSTMENT', id: String(a._id), number: a.number}, key: `ADJ:${a._id}`, reason: `${a.type}: ${a.reason}`, approvedBy: actor});
  }
  app.post('/api/inventory/adjustments', requireAuth, requirePerm('adjustment.request'), route(async (req, res) => {
    const b = parse(z.object({type: z.enum(['INCREASE', 'DECREASE', 'DAMAGED', 'MISSING', 'OPENING_CORRECTION', 'DATA_CORRECTION', 'FOUND', 'OTHER']), itemKind: z.enum(['ITEM', 'PRODUCT']).default('ITEM'), itemId: z.string().min(1), qty: z.number().positive(), direction: z.enum(['IN', 'OUT']).optional(), unitCostRupees: z.number().min(0).nullable().optional(), reason: text(500).min(3), attachment: fileRef.nullable().optional()}), req.body);
    const r = await mutate(req, 'ADJUSTMENT', async ({session, actor}) => {
      const s = await loadSubject(b.itemKind, b.itemId, session);
      const dir = b.type === 'INCREASE' || b.type === 'FOUND' ? 'IN' : ['DECREASE', 'DAMAGED', 'MISSING'].includes(b.type) ? 'OUT' : b.direction;
      if (!dir) fail(400, 'Choose whether this adjustment increases or decreases stock');
      const qM = qtyToM(b.qty, s.unit), adjustM = dir === 'IN' ? qM : -qM;
      if (adjustM < 0 && -adjustM > s.onHandM - s.reservedM) fail(409, `Only ${(s.onHandM - s.reservedM) / 1000} ${s.unit} is available to adjust down`);
      const unitCostPaise = b.unitCostRupees == null ? null : Math.round(b.unitCostRupees * 100 * 10000) / 10000;
      const value = Math.abs(adjustM) / 1000 * (unitCostPaise ?? s.avg ?? 0);
      const st = await settingsDoc();
      const perms = await permissionsFor(actor.role as any);
      const needsApproval = !perms.includes('adjustment.approve') && (ALWAYS_APPROVE.includes(b.type) || !st.adjustmentApprovalLimitPaise || value > st.adjustmentApprovalLimitPaise);
      const number = await nextNumber('ADJ', session);
      const [a] = await Inv.Adjustment.create([{number, type: b.type, itemKind: b.itemKind, itemId: b.itemId, itemName: s.name, unit: s.unit, currentM: s.onHandM, adjustM, newM: s.onHandM + adjustM, unitCostPaise, reason: b.reason, attachment: b.attachment || undefined, status: 'PENDING', requestedBy: actor}], {session});
      if (!needsApproval) { await postAdjustment(session, actor, a.toObject()); await Inv.Adjustment.updateOne({_id: a._id}, {$set: {status: 'POSTED', approvedBy: actor, approvedAt: new Date()}}, {session}); }
      return {id: String(a._id), number, status: needsApproval ? 'PENDING' : 'POSTED'};
    });
    res.status(r.replayed ? 200 : 201).json(r);
  }));
  app.post('/api/inventory/adjustments/:id/approve', requireAuth, requirePerm('adjustment.approve'), route(async (req, res) => {
    const r = await mutate(req, 'ADJUSTMENT_APPROVE', async ({session, actor}) => {
      const a: any = await Inv.Adjustment.findById(req.params.id).session(session).lean();
      if (!a) fail(404, 'Adjustment not found');
      if (a.status !== 'PENDING') fail(409, `This adjustment is already ${a.status.toLowerCase()}`);
      await canApproveOwn(actor, a.requestedBy);
      await postAdjustment(session, actor, a);
      await Inv.Adjustment.updateOne({_id: a._id, status: 'PENDING'}, {$set: {status: 'POSTED', approvedBy: actor, approvedAt: new Date()}}, {session});
      return {id: String(a._id), status: 'POSTED'};
    });
    res.json(r);
  }));
  app.post('/api/inventory/adjustments/:id/reject', requireAuth, requirePerm('adjustment.approve'), route(async (req, res) => {
    const {reason} = parse(z.object({reason: text(300).min(2)}), req.body);
    const u = await Inv.Adjustment.updateOne({_id: req.params.id, status: 'PENDING'}, {$set: {status: 'REJECTED', rejectReason: reason}});
    if (!u.modifiedCount) fail(409, 'Only pending adjustments can be rejected');
    res.json({ok: true});
  }));

  // ---------------- Stock history (ledger) ----------------
  app.get('/api/inventory/ledger', requireAuth, requirePerm('ledger.view'), route(async (req, res) => {
    const {page, limit, skip} = paging(req);
    const f: any = {};
    for (const k of ['itemId', 'itemKind', 'type', 'categoryId', 'itemType', 'location']) if (req.query[k]) f[k] = String(req.query[k]);
    if (req.query.userId) f['performedBy.id'] = String(req.query.userId);
    if (req.query.ref) f.$or = [{refNumber: {$regex: escapeRegex(String(req.query.ref)), $options: 'i'}}, {txnNo: {$regex: escapeRegex(String(req.query.ref)), $options: 'i'}}];
    if (req.query.q) f.$and = [{$or: [{itemName: {$regex: escapeRegex(String(req.query.q)), $options: 'i'}}, {itemCode: {$regex: escapeRegex(String(req.query.q)), $options: 'i'}}]}];
    if (req.query.from || req.query.to) f.createdAt = {...(req.query.from ? {$gte: new Date(String(req.query.from))} : {}), ...(req.query.to ? {$lte: new Date(String(req.query.to) + 'T23:59:59.999Z')} : {})};
    const [total, items] = await Promise.all([Inv.Ledger.countDocuments(f), Inv.Ledger.find(f).sort({_id: -1}).skip(skip).limit(limit).lean()]);
    const canCost = (await permissionsFor(sessionUser(req).role)).includes('inventory.valuation');
    sendPage(res, canCost ? items : items.map((i: any) => ({...i, unitCostPaise: undefined, valuePaise: undefined, avgBeforePaise: undefined, avgAfterPaise: undefined})), total, page, limit);
  }));
  app.post('/api/inventory/ledger/:id/reverse', requireAuth, requirePerm('ledger.reverse'), route(async (req, res) => {
    const {reason} = parse(z.object({reason: text(300).min(3)}), req.body);
    const r = await mutate(req, 'LEDGER_REVERSE', async ({session, actor}) => { const rev = await reverse(session, actor, String(req.params.id), reason); return {id: String(rev._id), txnNo: rev.txnNo}; });
    res.json(r);
  }));

  // ---------------- Settings ----------------
  app.get('/api/inventory/settings', requireAuth, requirePerm('inventory.view'), route(async (_req, res) => {
    const s: any = await Inv.Settings.findById('default').lean();
    res.json({purchaseApprovalLimitPaise: 0, adjustmentApprovalLimitPaise: 0, selfApprovalAllowed: false, overReceiptToleranceBps: 0, companyStateCode: '', accountantGrants: [], salesCountAt: 'APPROVED', revision: 0, ...(s || {}), stages: s?.stages?.length ? s.stages : DEFAULT_STAGES, delegable: DELEGABLE});
  }));
  app.put('/api/inventory/settings', requireAuth, requirePerm('inventory.settings'), route(async (req, res) => {
    const b = parse(z.object({revision: z.number().int().min(0), purchaseApprovalLimitRupees: z.number().min(0).max(1e9), adjustmentApprovalLimitRupees: z.number().min(0).max(1e9), selfApprovalAllowed: z.boolean(), overReceiptTolerancePct: z.number().min(0).max(20), companyStateCode: z.string().regex(/^(\d{2})?$/), stages: z.array(z.object({name: text(60).min(2)})).min(1).max(30), accountantGrants: z.array(z.enum(DELEGABLE)).max(DELEGABLE.length), salesCountAt: z.enum(['APPROVED', 'DISPATCHED']).default('APPROVED')}), req.body);
    const set = {purchaseApprovalLimitPaise: Math.round(b.purchaseApprovalLimitRupees * 100), adjustmentApprovalLimitPaise: Math.round(b.adjustmentApprovalLimitRupees * 100), selfApprovalAllowed: b.selfApprovalAllowed, overReceiptToleranceBps: Math.round(b.overReceiptTolerancePct * 100), companyStateCode: b.companyStateCode, stages: b.stages.map((s, i) => ({code: s.name.toUpperCase().replace(/[^A-Z]+/g, '_').replace(/^_|_$/g, ''), name: s.name, order: i + 1})), accountantGrants: b.accountantGrants, salesCountAt: b.salesCountAt};
    const existing = await Inv.Settings.findById('default').lean();
    const doc = existing ? await Inv.Settings.findOneAndUpdate({_id: 'default', revision: b.revision}, {$set: set, $inc: {revision: 1}}, {returnDocument: 'after'}).lean() : (await Inv.Settings.create({_id: 'default', ...set, revision: 1})).toObject();
    if (!doc) fail(409, 'Settings were changed by someone else. Refresh and try again.');
    setGrantsCache(b.accountantGrants);
    res.json(doc);
  }));
}
