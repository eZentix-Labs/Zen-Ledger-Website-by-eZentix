import type {Express} from 'express';
import mongoose from 'mongoose';
import {z} from 'zod';
import {requireAuth, requirePerm, permissionsFor, sessionUser} from '../auth.js';
import {Models} from '../models.js';
import {Inv} from './models.js';
import {UNITS, qtyToM} from './units.js';
import {fail, paging, parse, route, sendPage} from './http.js';
import {Actor, mutate, nextNumber} from './txn.js';
import {post} from './stock.js';
import {settleProductionCost} from './production-cost.js';

const text = (max = 200) => z.string().trim().max(max);
export const DEFAULT_STAGES = ['Material Preparation', 'Cutting', 'Bending', 'Welding', 'Grinding', 'Painting / Powder Coating', 'Assembly', 'Fittings Installation', 'Quality Check', 'Packaging', 'Finished Goods'].map((name, i) => ({code: name.toUpperCase().replace(/[^A-Z]+/g, '_').replace(/_$/, ''), name, order: i + 1}));
const OPEN = ['DRAFT', 'SUBMITTED', 'APPROVED', 'MATERIALS_RESERVED', 'IN_PROGRESS', 'QUALITY_CHECK'];

export async function stageTemplate() { const s: any = await Inv.Settings.findById('default').lean(); return s?.stages?.length ? s.stages : DEFAULT_STAGES; }

/** BOM cost: effective qty per unit (incl. planned wastage, once) × current average cost. Null-aware. */
export async function bomCost(bom: any, session?: mongoose.ClientSession) {
  const items: any[] = await Inv.Item.find({_id: {$in: bom.lines.map((l: any) => l.itemId)}}).session(session ?? null).lean();
  const im = new Map(items.map(i => [String(i._id), i]));
  const out = Math.max(1, bom.outputQty || 1);
  const lines = bom.lines.map((l: any) => {
    const it = im.get(l.itemId);
    const effM = l.qtyM / out * (1 + (l.wastageBps || 0) / 10000);
    const cost = it?.avgCostPaise ?? null;
    return {...l, itemType: it?.itemType, effectiveQtyPerUnit: effM / 1000, unitCostPaise: cost, costPerUnitPaise: cost == null ? null : Math.round(effM / 1000 * cost), available: it ? (it.onHandM - it.reservedM) / 1000 : 0, missingCost: cost == null};
  });
  const material = lines.some((l: any) => l.costPerUnitPaise == null) ? null : lines.reduce((a: number, l: any) => a + l.costPerUnitPaise, 0);
  const other = (bom.otherCosts || []).reduce((a: number, o: any) => a + (o.perUnitPaise || 0), 0);
  return {lines, materialPerUnitPaise: material, labourPerUnitPaise: bom.labourPerUnitPaise || 0, overheadPerUnitPaise: bom.overheadPerUnitPaise || 0, otherPerUnitPaise: other,
    estimatedPerUnitPaise: material == null ? null : material + (bom.labourPerUnitPaise || 0) + (bom.overheadPerUnitPaise || 0) + other,
    incomplete: lines.filter((l: any) => l.missingCost).map((l: any) => l.itemName)};
}

const bomBody = z.object({
  productId: z.string().min(1), outputQty: z.number().int().min(1).max(1000).default(1), notes: text(2000).optional().default(''),
  lines: z.array(z.object({itemId: z.string().min(1), qty: z.number().positive().max(1e7), wastagePct: z.number().min(0).max(100).default(0), notes: text(200).optional().default('')})).min(1).max(100),
  labourRupees: z.number().min(0).max(1e8).default(0), overheadRupees: z.number().min(0).max(1e8).default(0),
  otherCosts: z.array(z.object({label: text(80).min(1), rupees: z.number().min(0).max(1e8)})).max(10).default([]),
});
/** BOM quantities may be fractional for any unit (e.g. 1.5 sheets per almirah); production rounds requirements up to whole units. */
const bomQtyM = (qty: number) => { const m = Math.round(qty * 1000); if (Math.abs(m - qty * 1000) > 1e-6 || m <= 0) fail(400, 'BOM quantities need at most 3 decimal places'); return m; };
async function bomData(b: z.infer<typeof bomBody>, session: mongoose.ClientSession) {
  const p: any = await Models.products.findOne({id: b.productId}).session(session).lean();
  if (!p) fail(400, 'Choose a finished product');
  const seen = new Set<string>();
  const lines = [];
  for (const l of b.lines) {
    if (seen.has(l.itemId)) fail(400, 'Each material may appear once per BOM');
    seen.add(l.itemId);
    const it: any = mongoose.isValidObjectId(l.itemId) ? await Inv.Item.findById(l.itemId).session(session).lean() : null;
    if (!it || it.status !== 'ACTIVE') fail(400, 'A BOM line refers to an inactive or unknown item');
    lines.push({itemId: String(it._id), itemCode: it.code, itemName: it.name, unit: it.stockUnit, qtyM: bomQtyM(l.qty), wastageBps: Math.round(l.wastagePct * 100), notes: l.notes});
  }
  return {productId: p.id, productName: p.name, outputQty: b.outputQty, lines, labourPerUnitPaise: Math.round(b.labourRupees * 100), overheadPerUnitPaise: Math.round(b.overheadRupees * 100), otherCosts: b.otherCosts.map(o => ({label: o.label, perUnitPaise: Math.round(o.rupees * 100)})), notes: b.notes};
}

function requirement(bom: any, plannedQty: number) {
  return bom.lines.map((l: any) => {
    const raw = l.qtyM * plannedQty / Math.max(1, bom.outputQty) * (1 + (l.wastageBps || 0) / 10000);
    const planned = l.qtyM * plannedQty / Math.max(1, bom.outputQty);
    const whole = UNITS[l.unit]?.dimension === 'COUNT';
    const requiredM = whole ? Math.ceil(raw / 1000 - 1e-9) * 1000 : Math.ceil(raw - 1e-9);
    return {itemId: l.itemId, itemCode: l.itemCode, itemName: l.itemName, unit: l.unit, requiredM, plannedWastageM: Math.max(0, requiredM - Math.round(planned)), reservedM: 0, issuedM: 0, returnedM: 0, wastedM: 0, consumedM: 0, issuedValuePaise: 0, returnedValuePaise: 0};
  });
}

async function withAvailability(order: any) {
  const items: any[] = await Inv.Item.find({_id: {$in: order.lines.map((l: any) => l.itemId)}}).lean();
  const im = new Map(items.map(i => [String(i._id), i]));
  return order.lines.map((l: any) => {
    const it = im.get(l.itemId); const availableM = it ? it.onHandM - it.reservedM : 0;
    const stillNeeded = Math.max(0, l.requiredM - l.reservedM - Math.max(0, l.issuedM - l.reservedM));
    return {...l, availableM, shortageM: l.reservedM >= l.requiredM ? 0 : Math.max(0, stillNeeded - availableM), netIssuedM: l.issuedM - l.returnedM, unaccountedM: l.issuedM - l.returnedM - l.wastedM - l.consumedM};
  });
}

export function progress(o: any) {
  const done = (o.completedQty || 0) + (o.rejectedQty || 0);
  const stages = o.stages || [];
  const current = stages.find((s: any) => s.status !== 'COMPLETED' && s.status !== 'SKIPPED');
  const issued = (o.lines || []).reduce((a: number, l: any) => a + (l.issuedValuePaise || 0) - (l.returnedValuePaise || 0), 0);
  return {
    outputPct: o.plannedQty ? Math.round(done / o.plannedQty * 1000) / 10 : 0, remainingQty: Math.max(0, o.plannedQty - done),
    currentStage: current ? current.name : (stages.length ? 'All stages complete' : null),
    stagesDone: stages.filter((s: any) => s.status === 'COMPLETED' || s.status === 'SKIPPED').length, stagesTotal: stages.length,
    overdue: Boolean(o.expectedDate && OPEN.includes(o.status) && new Date(o.expectedDate).getTime() < Date.now()),
    materialCostPaise: issued, costSoFarPaise: issued + (o.labourCostPaise || 0) + (o.overheadCostPaise || 0) + (o.otherCostPaise || 0),
  };
}

async function transition(id: string, from: string[], set: any, session: mongoose.ClientSession, actor: Actor, action: string, notes = '') {
  const o: any = await Inv.Production.findOneAndUpdate({_id: id, status: {$in: from}}, {$set: set, $push: {history: {at: new Date(), by: actor.name, action, notes}}}, {session, returnDocument: 'after'}).lean();
  if (!o) { const cur: any = await Inv.Production.findById(id).session(session).lean(); fail(cur ? 409 : 404, cur ? `Cannot ${action.toLowerCase()} a production order that is ${cur.status.toLowerCase().replace(/_/g, ' ')}` : 'Production order not found'); }
  return o;
}

export function registerProductionRoutes(app: Express) {
  // ---------- BOM ----------
  app.get('/api/inventory/boms', requireAuth, requirePerm('production.view'), route(async (req, res) => {
    const filter: any = {};
    if (req.query.productId) filter.productId = String(req.query.productId);
    if (req.query.status) filter.status = String(req.query.status);
    const boms: any[] = await Inv.Bom.find(filter).sort({productName: 1, version: -1}).limit(500).lean();
    const canCost = (await permissionsFor(sessionUser(req).role)).includes('inventory.valuation');
    res.json(await Promise.all(boms.map(async b => ({...b, cost: canCost ? await bomCost(b) : undefined}))));
  }));
  app.get('/api/inventory/boms/:id', requireAuth, requirePerm('production.view'), route(async (req, res) => {
    const b: any = mongoose.isValidObjectId(req.params.id) ? await Inv.Bom.findById(req.params.id).lean() : null;
    if (!b) fail(404, 'BOM not found');
    const versions = await Inv.Bom.find({productId: b.productId}).select('version status createdAt createdBy approvedBy approvedAt').sort({version: -1}).lean();
    const canCost = (await permissionsFor(sessionUser(req).role)).includes('inventory.valuation');
    res.json({...b, cost: canCost ? await bomCost(b) : undefined, versions});
  }));
  app.post('/api/inventory/boms', requireAuth, requirePerm('bom.manage'), route(async (req, res) => {
    const b = parse(bomBody, req.body);
    const r = await mutate(req, 'BOM_CREATE', async ({session, actor}) => {
      const data = await bomData(b, session);
      const latest: any = await Inv.Bom.findOne({productId: data.productId}).sort({version: -1}).session(session).lean();
      if (latest && ['DRAFT', 'PENDING_APPROVAL'].includes(latest.status)) fail(409, `Version ${latest.version} of this BOM is still a draft; edit or approve it first`);
      const [bom] = await Inv.Bom.create([{...data, version: (latest?.version || 0) + 1, status: 'DRAFT', createdBy: actor}], {session});
      return {id: String(bom._id), version: bom.version};
    });
    res.status(r.replayed ? 200 : 201).json(r);
  }));
  app.put('/api/inventory/boms/:id', requireAuth, requirePerm('bom.manage'), route(async (req, res) => {
    const b = parse(bomBody, req.body);
    const r = await mutate(req, 'BOM_EDIT', async ({session}) => {
      const data = await bomData(b, session);
      const bom: any = await Inv.Bom.findOneAndUpdate({_id: req.params.id, status: 'DRAFT', productId: data.productId}, {$set: data}, {session, returnDocument: 'after'}).lean();
      if (!bom) fail(409, 'Only draft BOMs can be edited. Create a new version instead.');
      return {id: String(bom._id), version: bom.version};
    });
    res.json(r);
  }));
  for (const action of ['submit', 'approve', 'deactivate']) app.post(`/api/inventory/boms/:id/${action}`, requireAuth, requirePerm('bom.manage'), route(async (req, res) => {
    if (action === 'approve' && !(await permissionsFor(sessionUser(req).role)).includes('production.approve')) fail(403, 'You do not have permission to approve BOMs');
    const r = await mutate(req, `BOM_${action.toUpperCase()}`, async ({session, actor}) => {
      const bom: any = await Inv.Bom.findById(req.params.id).session(session).lean();
      if (!bom) fail(404, 'BOM not found');
      if (action === 'submit') { const u = await Inv.Bom.updateOne({_id: bom._id, status: 'DRAFT'}, {$set: {status: 'PENDING_APPROVAL'}}, {session}); if (!u.modifiedCount) fail(409, 'Only draft BOMs can be submitted'); return {id: String(bom._id), status: 'PENDING_APPROVAL'}; }
      if (action === 'approve') {
        if (!['PENDING_APPROVAL', 'DRAFT', 'INACTIVE'].includes(bom.status)) fail(409, 'This BOM is already active');
        const s: any = await Inv.Settings.findById('default').session(session).lean();
        if (!s?.selfApprovalAllowed && bom.createdBy?.id === actor.id && actor.role !== 'owner') fail(403, 'You cannot approve a BOM you created');
        await Inv.Bom.updateMany({productId: bom.productId, status: 'ACTIVE'}, {$set: {status: 'INACTIVE'}}, {session});
        await Inv.Bom.updateOne({_id: bom._id}, {$set: {status: 'ACTIVE', approvedBy: actor, approvedAt: new Date()}}, {session});
        return {id: String(bom._id), status: 'ACTIVE'};
      }
      const u = await Inv.Bom.updateOne({_id: bom._id, status: 'ACTIVE'}, {$set: {status: 'INACTIVE'}}, {session});
      if (!u.modifiedCount) fail(409, 'Only the active BOM can be deactivated');
      return {id: String(bom._id), status: 'INACTIVE'};
    });
    res.json(r);
  }));

  // ---------- Production orders ----------
  app.get('/api/inventory/productions', requireAuth, requirePerm('production.view'), route(async (req, res) => {
    const {page, limit, skip} = paging(req);
    const filter: any = {};
    if (req.query.status === 'OPEN') filter.status = {$in: OPEN};
    else if (req.query.status === 'WIP') filter.status = {$in: ['APPROVED', 'MATERIALS_RESERVED', 'IN_PROGRESS', 'QUALITY_CHECK']};
    else if (req.query.status) filter.status = String(req.query.status);
    if (req.query.productId) filter.productId = String(req.query.productId);
    const [total, items] = await Promise.all([Inv.Production.countDocuments(filter), Inv.Production.find(filter).sort({createdAt: -1}).skip(skip).limit(limit).lean()]);
    const profiles: any[] = await Inv.ProductProfile.find({productId: {$in: items.map((i: any) => i.productId)}}).select('productId images').lean();
    const img = new Map(profiles.map(p => [p.productId, p.images?.[0]?.url || null]));
    const wastage = await Inv.Wastage.aggregate([{$match: {productionOrderId: {$in: items.map((i: any) => String(i._id))}, status: 'APPROVED'}}, {$group: {_id: '$productionOrderId', cost: {$sum: {$ifNull: ['$costPaise', 0]}}}}]);
    const wm = new Map(wastage.map(w => [w._id, w.cost]));
    sendPage(res, items.map((o: any) => ({...o, image: img.get(o.productId) || null, progress: progress(o), wastageCostPaise: wm.get(String(o._id)) || 0, bomSnapshot: undefined})), total, page, limit);
  }));
  app.get('/api/inventory/productions/:id', requireAuth, requirePerm('production.view'), route(async (req, res) => {
    const o: any = mongoose.isValidObjectId(req.params.id) ? await Inv.Production.findById(req.params.id).lean() : null;
    if (!o) fail(404, 'Production order not found');
    const [lines, wastage, ledger, prof] = await Promise.all([withAvailability(o), Inv.Wastage.find({productionOrderId: String(o._id)}).sort({createdAt: -1}).lean(), Inv.Ledger.find({refType: 'PRODUCTION', refId: String(o._id)}).sort({createdAt: 1}).lean(), Inv.ProductProfile.findOne({productId: o.productId}).select('images').lean()]);
    res.json({...o, lines, wastage, ledger, image: (prof as any)?.images?.[0]?.url || null, progress: progress(o)});
  }));
  const createBody = z.object({productId: z.string().min(1), plannedQty: z.number().int().min(1).max(10000), startDate: z.string().optional().nullable(), expectedDate: z.string().optional().nullable(), assignedTo: text(120).optional().default(''), priority: z.enum(['LOW', 'NORMAL', 'HIGH']).default('NORMAL'), notes: text(2000).optional().default(''), submit: z.boolean().default(false)});
  app.post('/api/inventory/productions', requireAuth, requirePerm('production.manage'), route(async (req, res) => {
    const b = parse(createBody, req.body);
    const r = await mutate(req, 'PRODUCTION_CREATE', async ({session, actor}) => {
      const p: any = await Models.products.findOne({id: b.productId}).session(session).lean();
      if (!p) fail(400, 'Choose a finished product');
      const bom: any = await Inv.Bom.findOne({productId: p.id, status: 'ACTIVE'}).session(session).lean();
      if (!bom) fail(409, `${p.name} has no approved (active) BOM. Create and approve a BOM first.`);
      const number = await nextNumber('PRD', session);
      const [o] = await Inv.Production.create([{number, productId: p.id, productName: p.name, bomId: String(bom._id), bomVersion: bom.version, plannedQty: b.plannedQty, status: b.submit ? 'SUBMITTED' : 'DRAFT', startDate: b.startDate ? new Date(b.startDate) : null, expectedDate: b.expectedDate ? new Date(b.expectedDate) : null, assignedTo: b.assignedTo, priority: b.priority, notes: b.notes, lines: requirement(bom, b.plannedQty), createdBy: actor, history: [{at: new Date(), by: actor.name, action: 'CREATED', notes: `BOM v${bom.version}`}]}], {session});
      return {id: String(o._id), number};
    });
    res.status(r.replayed ? 200 : 201).json(r);
  }));

  const act = (name: string, perm: 'production.manage' | 'production.approve', handler: (o: any, b: any, ctx: {session: mongoose.ClientSession; actor: Actor}) => Promise<any>) =>
    app.post(`/api/inventory/productions/:id/${name}`, requireAuth, requirePerm(perm), route(async (req, res) => {
      const r = await mutate(req, `PRODUCTION_${name.toUpperCase()}`, async (ctx) => {
        const o: any = mongoose.isValidObjectId(req.params.id) ? await Inv.Production.findById(req.params.id).session(ctx.session).lean() : null;
        if (!o) fail(404, 'Production order not found');
        return {id: String(o._id), ...(await handler(o, req.body || {}, ctx))};
      });
      res.json(r);
    }));

  act('submit', 'production.manage', async (o, _b, {session, actor}) => { await transition(o._id, ['DRAFT'], {status: 'SUBMITTED'}, session, actor, 'SUBMITTED'); return {status: 'SUBMITTED'}; });
  act('approve', 'production.approve', async (o, _b, {session, actor}) => {
    const s: any = await Inv.Settings.findById('default').session(session).lean();
    if (!s?.selfApprovalAllowed && o.createdBy?.id === actor.id && actor.role !== 'owner') fail(403, 'You cannot approve a production order you created');
    const bom: any = await Inv.Bom.findById(o.bomId).session(session).lean();
    const cost = await bomCost(bom, session);
    const stages = (await stageTemplate()).map((st: any) => ({...st, status: 'PENDING', qtyDone: 0}));
    await transition(o._id, ['SUBMITTED'], {status: 'APPROVED', approvedBy: actor, approvedAt: new Date(), stages, bomSnapshot: {version: bom.version, outputQty: bom.outputQty, lines: bom.lines, labourPerUnitPaise: bom.labourPerUnitPaise, overheadPerUnitPaise: bom.overheadPerUnitPaise, otherCosts: bom.otherCosts, estimatedPerUnitPaise: cost.estimatedPerUnitPaise, materialPerUnitPaise: cost.materialPerUnitPaise}, labourCostPaise: (bom.labourPerUnitPaise || 0) * o.plannedQty, overheadCostPaise: (bom.overheadPerUnitPaise || 0) * o.plannedQty, otherCostPaise: (bom.otherCosts || []).reduce((a: number, x: any) => a + x.perUnitPaise, 0) * o.plannedQty}, session, actor, 'APPROVED');
    return {status: 'APPROVED'};
  });
  act('reject', 'production.approve', async (o, b, {session, actor}) => { const {reason} = parse(z.object({reason: text(300).min(2)}), b); await transition(o._id, ['SUBMITTED'], {status: 'REJECTED', rejectReason: reason}, session, actor, 'REJECTED', reason); return {status: 'REJECTED'}; });
  // All-or-nothing: any shortage aborts the whole transaction and nothing is reserved.
  act('reserve', 'production.manage', async (o, _b, {session, actor}) => {
    if (o.status !== 'APPROVED') fail(409, 'Materials can be reserved only after approval');
    const shortages: any[] = [];
    const lines = o.lines.map((l: any) => ({...l}));
    for (const l of lines) {
      const need = l.requiredM - l.reservedM;
      if (need <= 0) continue;
      try { await post(session, actor, {kind: 'ITEM', itemId: l.itemId, type: 'RESERVATION', dOnM: 0, dResM: need, unitCostPaise: null, ref: {type: 'PRODUCTION', id: String(o._id), number: o.number}, key: `RES:${o._id}:${l.itemId}:${l.reservedM}`, reason: 'Reserved for production'}); l.reservedM += need; }
      catch (e: any) { if (e?.status === 409 && e.details) shortages.push({itemName: l.itemName, unit: l.unit, requiredM: need, availableM: e.details.availableM}); else throw e; }
    }
    if (shortages.length) fail(409, `Not enough material to reserve: ${shortages.map(s => `${s.itemName} needs ${s.requiredM / 1000} ${s.unit}, available ${s.availableM / 1000}`).join('; ')}`, {shortages});
    await transition(o._id, ['APPROVED'], {status: 'MATERIALS_RESERVED', lines}, session, actor, 'MATERIALS_RESERVED');
    return {status: 'MATERIALS_RESERVED'};
  });
  act('issue', 'production.manage', async (o, b, {session, actor}) => {
    const body = parse(z.object({lines: z.array(z.object({itemId: z.string(), qty: z.number().positive()})).min(1), additionalReason: text(300).optional().default('')}), b);
    if (!['MATERIALS_RESERVED', 'IN_PROGRESS', 'QUALITY_CHECK'].includes(o.status)) fail(409, 'Issue materials after they are reserved');
    const lines = o.lines.map((l: any) => ({...l}));
    for (const x of body.lines) {
      const l = lines.find((y: any) => y.itemId === x.itemId);
      if (!l) fail(400, 'That material is not on this production order');
      const qM = qtyToM(x.qty, l.unit);
      const fromReserve = Math.min(qM, Math.max(0, l.reservedM - l.issuedM));
      if (qM > fromReserve && !body.additionalReason) fail(400, `${l.itemName}: issuing more than reserved needs a reason (additional material request)`);
      const mv = await post(session, actor, {kind: 'ITEM', itemId: l.itemId, type: 'MATERIAL_ISSUE', dOnM: -qM, dResM: -fromReserve, ref: {type: 'PRODUCTION', id: String(o._id), number: o.number}, key: `ISSUE:${o._id}:${l.itemId}:${l.issuedM}`, reason: qM > fromReserve ? `Additional material: ${body.additionalReason}` : 'Issued to production'});
      l.issuedM += qM; l.issuedValuePaise += mv.valuePaise || 0;
    }
    await Inv.Production.updateOne({_id: o._id}, {$set: {lines}, $push: {history: {at: new Date(), by: actor.name, action: 'MATERIAL_ISSUED', notes: body.lines.length + ' line(s)'}}}, {session});
    return {status: o.status};
  });
  act('return', 'production.manage', async (o, b, {session, actor}) => {
    const body = parse(z.object({lines: z.array(z.object({itemId: z.string(), qty: z.number().positive()})).min(1)}), b);
    const lines = o.lines.map((l: any) => ({...l}));
    for (const x of body.lines) {
      const l = lines.find((y: any) => y.itemId === x.itemId);
      if (!l) fail(400, 'That material is not on this production order');
      const qM = qtyToM(x.qty, l.unit);
      const unaccounted = l.issuedM - l.returnedM - l.wastedM - l.consumedM;
      if (qM > unaccounted) fail(409, `${l.itemName}: only ${unaccounted / 1000} ${l.unit} of issued material is unaccounted for`);
      const issueCost = l.issuedM ? l.issuedValuePaise / (l.issuedM / 1000) : null;
      const mv = await post(session, actor, {kind: 'ITEM', itemId: l.itemId, type: 'MATERIAL_RETURN', dOnM: qM, unitCostPaise: issueCost, ref: {type: 'PRODUCTION', id: String(o._id), number: o.number}, key: `RETURN:${o._id}:${l.itemId}:${l.returnedM}`, reason: 'Unused material returned to store'});
      l.returnedM += qM; l.returnedValuePaise += mv.valuePaise || 0;
    }
    await Inv.Production.updateOne({_id: o._id}, {$set: {lines}, $push: {history: {at: new Date(), by: actor.name, action: 'MATERIAL_RETURNED'}}}, {session});
    return {status: o.status};
  });
  act('start', 'production.manage', async (o, _b, {session, actor}) => {
    if (!o.lines.some((l: any) => l.issuedM > 0)) fail(409, 'Issue materials before starting production');
    await transition(o._id, ['MATERIALS_RESERVED'], {status: 'IN_PROGRESS', startDate: o.startDate || new Date()}, session, actor, 'STARTED');
    return {status: 'IN_PROGRESS'};
  });
  act('stage', 'production.manage', async (o, b, {session, actor}) => {
    const body = parse(z.object({code: z.string(), qtyDone: z.number().int().min(0).optional(), status: z.enum(['PENDING', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED']).optional(), assignedTo: text(120).optional(), notes: text(500).optional()}), b);
    if (!['IN_PROGRESS', 'QUALITY_CHECK'].includes(o.status)) fail(409, 'Stages can be updated while production is in progress');
    const stages = o.stages.map((s: any) => ({...s}));
    const i = stages.findIndex((s: any) => s.code === body.code);
    if (i < 0) fail(400, 'Unknown stage');
    const st = stages[i];
    if (body.qtyDone != null) {
      const prevDone = i === 0 ? o.plannedQty : (stages[i - 1].status === 'SKIPPED' ? o.plannedQty : stages[i - 1].qtyDone);
      if (body.qtyDone > o.plannedQty) fail(400, 'Cannot exceed the planned quantity');
      if (body.qtyDone > prevDone) fail(400, `Only ${prevDone} unit(s) have finished the previous stage (${stages[i - 1].name})`);
      st.qtyDone = body.qtyDone;
      st.status = body.qtyDone >= o.plannedQty ? 'COMPLETED' : body.qtyDone > 0 ? 'IN_PROGRESS' : 'PENDING';
    }
    if (body.status) { if (body.status === 'SKIPPED' && !body.notes) fail(400, 'Give a reason for skipping a stage'); st.status = body.status; if (body.status === 'COMPLETED') st.qtyDone = Math.max(st.qtyDone, i === 0 ? o.plannedQty : stages[i - 1].qtyDone); }
    if (st.status !== 'PENDING' && !st.startedAt) st.startedAt = new Date();
    if (st.status === 'COMPLETED') st.completedAt = new Date();
    if (body.assignedTo !== undefined) st.assignedTo = body.assignedTo;
    if (body.notes) st.notes = body.notes;
    await Inv.Production.updateOne({_id: o._id}, {$set: {stages}, $push: {history: {at: new Date(), by: actor.name, action: `STAGE ${st.name}`, notes: `${st.status} ${st.qtyDone}/${o.plannedQty}`}}}, {session});
    return {status: o.status};
  });
  act('quality-check', 'production.manage', async (o, _b, {session, actor}) => { await transition(o._id, ['IN_PROGRESS'], {status: 'QUALITY_CHECK'}, session, actor, 'SENT_TO_QC'); return {status: 'QUALITY_CHECK'}; });
  // Output batch: only QC-accepted units enter finished stock.
  act('output', 'production.manage', async (o, b, {session, actor}) => {
    const body = parse(z.object({producedQty: z.number().int().min(1), acceptedQty: z.number().int().min(0), qcNotes: text(500).optional().default('')}), b);
    if (!['IN_PROGRESS', 'QUALITY_CHECK'].includes(o.status)) fail(409, 'Record output while production is in progress');
    if (body.acceptedQty > body.producedQty) fail(400, 'Accepted units cannot exceed produced units');
    const done = o.completedQty + o.rejectedQty;
    if (done + body.producedQty > o.plannedQty) fail(409, `Only ${o.plannedQty - done} unit(s) remain on this order`);
    const rejected = body.producedQty - body.acceptedQty;
    if (rejected > 0 && !body.qcNotes) fail(400, 'Explain why units were rejected at quality inspection');
    const issuedValue = o.lines.reduce((a: number, l: any) => a + l.issuedValuePaise - l.returnedValuePaise, 0);
    const totalCost = issuedValue + o.labourCostPaise + o.overheadCostPaise + o.otherCostPaise;
    const settlement = settleProductionCost({totalCostPaise: totalCost, plannedQty: o.plannedQty, producedQty: done + body.producedQty, acceptedQty: o.completedQty + body.acceptedQty, previouslyAllocatedPaise: o.costAbsorbedPaise || 0, closed: done + body.producedQty === o.plannedQty});
    const batchCost = settlement.additionalAllocatedPaise;
    const unitCost = body.acceptedQty ? Math.round(batchCost / body.acceptedQty * 10000) / 10000 : null;
    const batchNo = (o.outputs?.length || 0) + 1;
    if (body.acceptedQty > 0) await post(session, actor, {kind: 'PRODUCT', itemId: o.productId, type: 'PRODUCTION_OUTPUT', dOnM: body.acceptedQty * 1000, unitCostPaise: unitCost, ref: {type: 'PRODUCTION', id: String(o._id), number: o.number, line: batchNo}, key: `OUTPUT:${o._id}:${batchNo}`, reason: `Production batch ${batchNo} passed QC`, approvedBy: actor});
    else if (batchCost > 0 && o.completedQty > 0) await post(session, actor, {kind: 'PRODUCT', itemId: o.productId, type: 'PRODUCTION_COST_ADJUSTMENT', dOnM: 0, unitCostPaise: null, valuePaise: batchCost, ref: {type: 'PRODUCTION', id: String(o._id), number: o.number, line: batchNo}, key: `OUTPUT_COST_ADJUSTMENT:${o._id}:${batchNo}`, reason: `Rejected final batch cost allocated to ${o.completedQty} previously accepted unit(s)`, approvedBy: actor});
    await Inv.Production.updateOne({_id: o._id, completedQty: o.completedQty, rejectedQty: o.rejectedQty}, {$inc: {completedQty: body.acceptedQty, rejectedQty: rejected, costAbsorbedPaise: batchCost}, $push: {outputs: {batchNo, producedQty: body.producedQty, acceptedQty: body.acceptedQty, rejectedQty: rejected, qcNotes: body.qcNotes, unitCostPaise: unitCost, valuePaise: body.acceptedQty ? batchCost : 0, postedAt: new Date(), postedBy: actor}, history: {at: new Date(), by: actor.name, action: `OUTPUT batch ${batchNo}`, notes: `${body.acceptedQty} accepted, ${rejected} rejected`}}}, {session});
    return {status: o.status, batchNo, acceptedQty: body.acceptedQty};
  });
  // Completion: every issued unit must be accounted for (consumed / returned / approved wastage).
  act('complete', 'production.approve', async (o, b, {session, actor}) => {
    const body = parse(z.object({notes: text(500).optional().default(''), closeShort: z.boolean().default(false)}), b);
    if (!['IN_PROGRESS', 'QUALITY_CHECK'].includes(o.status)) fail(409, 'Only production in progress can be completed');
    const done = o.completedQty + o.rejectedQty;
    if (done < o.plannedQty && !body.closeShort) fail(409, `${o.plannedQty - done} unit(s) have not been output yet. Record the output or close the order short.`);
    if (done < o.plannedQty && !body.notes) fail(400, 'Give a reason for closing short');
    if (await Inv.Wastage.exists({productionOrderId: String(o._id), status: 'PENDING'}).session(session)) fail(409, 'Approve or reject the pending wastage records for this order first');
    const issuedValue = o.lines.reduce((a: number, l: any) => a + l.issuedValuePaise - l.returnedValuePaise, 0);
    const totalCost = issuedValue + o.labourCostPaise + o.overheadCostPaise + o.otherCostPaise;
    const settlement = settleProductionCost({totalCostPaise: totalCost, plannedQty: o.plannedQty, producedQty: done, acceptedQty: o.completedQty, previouslyAllocatedPaise: o.costAbsorbedPaise || 0, closed: true});
    if (settlement.variancePaise > 0) await post(session, actor, {kind: 'PRODUCT', itemId: o.productId, type: 'PRODUCTION_VARIANCE', dOnM: 0, unitCostPaise: null, valuePaise: settlement.variancePaise, ref: {type: 'PRODUCTION', id: String(o._id), number: o.number}, key: `VARIANCE:${o._id}`, reason: body.closeShort ? `Unabsorbed cost on short close: ${body.notes}` : 'No accepted finished units to absorb production cost', approvedBy: actor});
    const lines = o.lines.map((l: any) => ({...l}));
    for (const l of lines) {
      l.consumedM = l.issuedM - l.returnedM - l.wastedM;   // material leaves stock once (at issue); this only classifies it
      const leftover = l.reservedM - Math.min(l.reservedM, l.issuedM);
      if (leftover > 0) { await post(session, actor, {kind: 'ITEM', itemId: l.itemId, type: 'RESERVATION_RELEASE', dOnM: 0, dResM: -leftover, unitCostPaise: null, ref: {type: 'PRODUCTION', id: String(o._id), number: o.number}, key: `RELEASE:${o._id}:${l.itemId}`, reason: 'Unused reservation released at completion'}); l.reservedM -= leftover; }
    }
    await transition(o._id, ['IN_PROGRESS', 'QUALITY_CHECK'], {status: 'COMPLETED', completedAt: new Date(), lines}, session, actor, 'COMPLETED', body.notes);
    return {status: 'COMPLETED'};
  });
  act('cancel', 'production.manage', async (o, b, {session, actor}) => {
    const body = parse(z.object({reason: text(300).min(2)}), b);
    if (!OPEN.includes(o.status)) fail(409, 'This production order can no longer be cancelled');
    if (o.completedQty > 0) fail(409, 'Finished units were already posted; complete the order (close short) instead');
    const lines = o.lines.map((l: any) => ({...l}));
    for (const l of lines) {
      const unaccounted = l.issuedM - l.returnedM - l.wastedM - l.consumedM;
      if (unaccounted > 0) fail(409, `${l.itemName}: ${unaccounted / 1000} ${l.unit} issued to this order must be returned to the store or recorded as wastage before cancelling`);
      const leftover = l.reservedM - Math.min(l.reservedM, l.issuedM);
      if (leftover > 0) { await post(session, actor, {kind: 'ITEM', itemId: l.itemId, type: 'RESERVATION_RELEASE', dOnM: 0, dResM: -leftover, unitCostPaise: null, ref: {type: 'PRODUCTION', id: String(o._id), number: o.number}, key: `RELEASE:${o._id}:${l.itemId}`, reason: 'Reservation released on cancellation'}); l.reservedM -= leftover; }
    }
    await transition(o._id, OPEN, {status: 'CANCELLED', cancelReason: body.reason, lines}, session, actor, 'CANCELLED', body.reason);
    return {status: 'CANCELLED'};
  });
}
