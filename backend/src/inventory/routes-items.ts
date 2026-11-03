import type {Express, Request} from 'express';
import mongoose from 'mongoose';
import {z} from 'zod';
import {requireAuth, requirePerm, sessionUser, permissionsFor} from '../auth.js';
import {Models} from '../models.js';
import {ErpModels} from '../erp-models.js';
import {Inv, ITEM_TYPES} from './models.js';
import {UNITS, UNIT_CODES, factorToStock, qtyToM} from './units.js';
import {escapeRegex, fail, paging, parse, route, sendPage} from './http.js';
import {mutate} from './txn.js';
import {post} from './stock.js';
import {destroyStored} from './files.js';

const fileRef = z.object({id: z.string().optional().default(''), url: z.string().min(1).max(2048), publicId: z.string().optional().default(''), name: z.string().max(200).optional(), mime: z.string().max(80).optional(), size: z.number().optional()});
const num = z.number().finite().min(0).max(1e9);
const optNum = num.nullable().optional();
const text = (max = 200) => z.string().trim().max(max);

export const itemBody = z.object({
  name: text(160).min(2), code: text(40).min(1), sku: text(60).optional().default(''), barcode: text(60).optional().default(''),
  itemType: z.enum(ITEM_TYPES), categoryId: z.string().max(40).nullable().optional(), description: text(2000).optional().default(''),
  grade: text(80).optional().default(''), thicknessMm: optNum, lengthMm: optNum, widthMm: optNum, diameterMm: optNum, weightKg: optNum,
  specs: z.array(z.object({key: text(60).min(1), value: text(200)})).max(30).optional().default([]),
  stockUnit: z.enum(UNIT_CODES), purchaseUnits: z.array(z.object({unit: z.enum(UNIT_CODES), factor: z.number().positive().max(1e7)})).max(6).optional().default([]),
  minStock: optNum, maxStock: optNum, reorderLevel: optNum, reorderQty: optNum, leadTimeDays: z.number().int().min(0).max(365).nullable().optional(),
  preferredSupplierId: z.string().max(40).nullable().optional(), location: text(80).optional().default(''),
  images: z.array(fileRef).max(10).optional().default([]),
});
const createBody = itemBody.extend({openingQty: num.optional().default(0), openingCostRupees: num.nullable().optional()});

const mOrNull = (v: number | null | undefined, unit: string) => v == null ? null : qtyToM(v, unit, {allowZero: true});
function shapeItem(b: z.infer<typeof itemBody>) {
  for (const p of b.purchaseUnits) if (p.unit === b.stockUnit) fail(400, 'A purchase unit cannot be the stock unit itself');
  for (const p of b.purchaseUnits) factorToStock(p.unit, b.stockUnit, b.purchaseUnits);
  if (b.maxStock != null && b.minStock != null && b.maxStock < b.minStock) fail(400, 'Maximum stock cannot be below minimum stock');
  return {
    name: b.name, code: b.code.toUpperCase(), sku: b.sku || undefined, barcode: b.barcode || undefined, itemType: b.itemType, categoryId: b.categoryId || null,
    description: b.description, grade: b.grade, thicknessMm: b.thicknessMm ?? null, lengthMm: b.lengthMm ?? null, widthMm: b.widthMm ?? null, diameterMm: b.diameterMm ?? null, weightKg: b.weightKg ?? null,
    specs: b.specs, stockUnit: b.stockUnit, purchaseUnits: b.purchaseUnits,
    minStockM: mOrNull(b.minStock, b.stockUnit), maxStockM: mOrNull(b.maxStock, b.stockUnit), reorderLevelM: mOrNull(b.reorderLevel, b.stockUnit), reorderQtyM: mOrNull(b.reorderQty, b.stockUnit),
    leadTimeDays: b.leadTimeDays ?? null, preferredSupplierId: b.preferredSupplierId || null, location: b.location, images: b.images,
  };
}

export function stockStatus(it: {onHandM: number; reservedM: number; reorderLevelM?: number | null; minStockM?: number | null}) {
  const avail = (it.onHandM || 0) - (it.reservedM || 0);
  if (avail <= 0) return 'OUT';
  const level = it.reorderLevelM ?? it.minStockM;
  if (level != null && avail <= level) return 'LOW';
  return 'OK';
}
export const itemView = (it: any, canSeeCost: boolean) => ({
  ...it, _id: String(it._id), availableM: (it.onHandM || 0) - (it.reservedM || 0), stockStatus: stockStatus(it),
  valuePaise: it.avgCostPaise == null ? null : Math.round((it.onHandM || 0) / 1000 * it.avgCostPaise),
  ...(canSeeCost ? {} : {avgCostPaise: undefined, lastPurchaseRatePaise: undefined, valuePaise: undefined}),
});

const GROUPS: Record<string, string[]> = {raw: ['RAW_MATERIAL'], materials: ['RAW_MATERIAL', 'CONSUMABLE', 'PACKAGING', 'SPARE_PART', 'SEMI_FINISHED', 'OTHER'], accessories: ['COMPONENT'], consumables: ['CONSUMABLE', 'PACKAGING', 'SPARE_PART', 'SEMI_FINISHED', 'OTHER']};

/** Suggested categories (from the reference PDFs + the client brief). Created only when an Admin asks. */
const SUGGESTED_CATEGORIES: Array<[string, string]> = [
  ['RAW_MATERIAL', 'Steel Sheets (E.D.D)'], ['RAW_MATERIAL', 'MS Sheets'], ['RAW_MATERIAL', 'CR Sheets'], ['RAW_MATERIAL', 'GI Sheets'], ['RAW_MATERIAL', 'Steel Pipes'], ['RAW_MATERIAL', 'Square Pipes'], ['RAW_MATERIAL', 'Aluminium'], ['RAW_MATERIAL', 'Flat Bars & Angles'],
  ['COMPONENT', 'Locks'], ['COMPONENT', 'Hinges'], ['COMPONENT', 'Handles'], ['COMPONENT', 'Screws'], ['COMPONENT', 'Nuts & Bolts'], ['COMPONENT', 'Brackets'], ['COMPONENT', 'Magnetic Fittings'], ['COMPONENT', 'Churi Stands'], ['COMPONENT', 'Internal Lights'], ['COMPONENT', 'Drawer Fittings'], ['COMPONENT', 'Door Panels / Prints'],
  ['CONSUMABLE', 'Pre-treatment Chemicals (7-tank)'], ['CONSUMABLE', 'Powder Coating'], ['CONSUMABLE', 'Paint'], ['CONSUMABLE', 'Primer'], ['CONSUMABLE', 'Welding Consumables'], ['CONSUMABLE', 'Cutting Discs'], ['CONSUMABLE', 'Grinding Discs'],
  ['PACKAGING', 'Packaging Materials'], ['SPARE_PART', 'Machine Spares'],
];

export function registerItemRoutes(app: Express) {
  app.get('/api/inventory/meta', requireAuth, requirePerm('inventory.view'), route(async (req, res) => {
    res.json({units: Object.entries(UNITS).map(([code, u]) => ({code, ...u})), itemTypes: ITEM_TYPES, permissions: await permissionsFor(sessionUser(req).role)});
  }));

  // ----- Categories (inventory scope) -----
  app.get('/api/inventory/categories', requireAuth, requirePerm('inventory.view'), route(async (req, res) => {
    const filter: any = {scope: 'inventory'};
    if (req.query.itemType) filter.itemType = String(req.query.itemType);
    if (req.query.active !== 'all') filter.active = true;
    res.json(await ErpModels.Category.find(filter).sort({itemType: 1, sortOrder: 1, name: 1}).lean());
  }));
  const catBody = z.object({name: text(80).min(2), itemType: z.enum(ITEM_TYPES), active: z.boolean().optional()});
  app.post('/api/inventory/categories', requireAuth, requirePerm('item.manage'), route(async (req, res) => {
    const b = parse(catBody, req.body);
    const slug = `inv-${b.itemType.toLowerCase()}-${b.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    if (await ErpModels.Category.exists({slug})) fail(409, 'This category already exists');
    res.status(201).json(await ErpModels.Category.create({name: b.name, slug, scope: 'inventory', itemType: b.itemType, active: b.active ?? true}));
  }));
  app.patch('/api/inventory/categories/:id', requireAuth, requirePerm('item.manage'), route(async (req, res) => {
    const b = parse(catBody.partial(), req.body);
    if (b.active === false && await Inv.Item.exists({categoryId: req.params.id, status: 'ACTIVE'})) fail(409, 'Deactivate or move the active items in this category first');
    const doc = await ErpModels.Category.findOneAndUpdate({_id: req.params.id, scope: 'inventory'}, {$set: b}, {returnDocument: 'after', runValidators: true});
    if (!doc) fail(404, 'Category not found');
    res.json(doc);
  }));
  app.post('/api/inventory/categories/load-suggested', requireAuth, requirePerm('item.manage'), route(async (_req, res) => {
    let created = 0;
    for (const [i, [itemType, name]] of SUGGESTED_CATEGORIES.entries()) {
      const slug = `inv-${itemType.toLowerCase()}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
      const r = await ErpModels.Category.updateOne({slug}, {$setOnInsert: {name, slug, scope: 'inventory', itemType, active: true, sortOrder: i}}, {upsert: true});
      created += r.upsertedCount;
    }
    res.json({created});
  }));

  // ----- Stock items -----
  app.get('/api/inventory/items', requireAuth, requirePerm('inventory.view'), route(async (req, res) => {
    const {page, limit, skip} = paging(req);
    const filter: any = {};
    const group = String(req.query.group || '');
    if (GROUPS[group]) filter.itemType = {$in: GROUPS[group]};
    if (req.query.itemType) filter.itemType = String(req.query.itemType);
    if (req.query.categoryId) filter.categoryId = String(req.query.categoryId);
    if (req.query.supplierId) filter.preferredSupplierId = String(req.query.supplierId);
    if (req.query.location) filter.location = String(req.query.location);
    filter.status = req.query.status === 'all' ? {$in: ['ACTIVE', 'INACTIVE']} : (req.query.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE');
    const q = String(req.query.q || '').trim();
    if (q) filter.$or = ['name', 'code', 'sku', 'barcode'].map(f => ({[f]: {$regex: escapeRegex(q), $options: 'i'}}));
    const sortKey = String(req.query.sort || 'name');
    const sort: any = sortKey === 'stock' ? {onHandM: 1} : sortKey === 'code' ? {code: 1} : sortKey === 'updated' ? {updatedAt: -1} : {name: 1};
    let docs: any[] = await Inv.Item.find(filter).sort(sort).lean();
    const ss = String(req.query.stockStatus || '');
    if (ss) docs = docs.filter(d => stockStatus(d) === ss);
    const canSeeCost = (await permissionsFor(sessionUser(req).role)).includes('inventory.valuation');
    const minV = Number(req.query.minValue), maxV = Number(req.query.maxValue);
    let views = docs.map(d => itemView(d, canSeeCost));
    if (canSeeCost && (Number.isFinite(minV) || Number.isFinite(maxV))) views = views.filter(v => v.valuePaise != null && (!Number.isFinite(minV) || v.valuePaise >= minV * 100) && (!Number.isFinite(maxV) || v.valuePaise <= maxV * 100));
    const pageItems = views.slice(skip, skip + limit);
    const lastMoves = await Inv.Ledger.aggregate([{$match: {itemKind: 'ITEM', itemId: {$in: pageItems.map(v => v._id)}}}, {$sort: {createdAt: -1}}, {$group: {_id: '$itemId', at: {$first: '$createdAt'}, type: {$first: '$type'}}}]);
    const lm = new Map(lastMoves.map(x => [x._id, {at: x.at, type: x.type}]));
    sendPage(res, pageItems.map(v => ({...v, lastMovement: lm.get(v._id) || null})), views.length, page, limit);
  }));

  app.get('/api/inventory/items/:id', requireAuth, requirePerm('inventory.view'), route(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) fail(404, 'Item not found');
    const it: any = await Inv.Item.findById(req.params.id).lean();
    if (!it) fail(404, 'Item not found');
    const canSeeCost = (await permissionsFor(sessionUser(req).role)).includes('inventory.valuation');
    const [purchases, consumption, supplier, category] = await Promise.all([
      Inv.GoodsReceipt.find({'lines.itemId': String(it._id)}).sort({createdAt: -1}).limit(20).lean(),
      Inv.Ledger.find({itemId: String(it._id), type: {$in: ['MATERIAL_ISSUE', 'MATERIAL_RETURN']}}).sort({createdAt: -1}).limit(20).lean(),
      it.preferredSupplierId && mongoose.isValidObjectId(it.preferredSupplierId) ? Inv.Supplier.findById(it.preferredSupplierId).select('name supplierCode').lean() : null,
      it.categoryId && mongoose.isValidObjectId(it.categoryId) ? ErpModels.Category.findById(it.categoryId).select('name').lean() : null,
    ]);
    res.json({...itemView(it, canSeeCost), supplier, category, purchaseHistory: purchases.map((g: any) => ({_id: g._id, number: g.number, date: g.receivedDate || g.createdAt, supplierName: g.supplierName, line: g.lines.find((l: any) => l.itemId === String(it._id))})), consumptionHistory: consumption});
  }));

  app.post('/api/inventory/items', requireAuth, requirePerm('item.manage'), route(async (req, res) => {
    const b = parse(createBody, req.body);
    const shaped = shapeItem(b);
    const openingM = b.openingQty ? qtyToM(b.openingQty, b.stockUnit) : 0;
    const openingCost = b.openingCostRupees == null ? null : Math.round(b.openingCostRupees * 100 * 10000) / 10000;
    const result = await mutate(req, 'ITEM_CREATE', async ({session, actor}) => {
      if (await Inv.Item.exists({code: shaped.code}).session(session)) fail(409, `Item code ${shaped.code} already exists`);
      if (shaped.sku && await Inv.Item.exists({sku: shaped.sku}).session(session)) fail(409, `SKU ${shaped.sku} already exists`);
      const [doc] = await Inv.Item.create([{...shaped, onHandM: 0, reservedM: 0, avgCostPaise: null}], {session});
      if (openingM > 0) await post(session, actor, {kind: 'ITEM', itemId: String(doc._id), type: 'OPENING', dOnM: openingM, unitCostPaise: openingCost, ref: {type: 'ITEM', id: String(doc._id), number: doc.code}, key: `OPENING:${doc._id}`, reason: 'Opening stock'});
      return {id: String(doc._id), code: doc.code};
    });
    res.status(result.replayed ? 200 : 201).json(result);
  }));

  app.patch('/api/inventory/items/:id', requireAuth, requirePerm('item.manage'), route(async (req, res) => {
    const b = parse(itemBody.extend({revision: z.number().int().min(0)}), req.body);
    const shaped = shapeItem(b);
    const current: any = await Inv.Item.findById(req.params.id).lean();
    if (!current) fail(404, 'Item not found');
    if (current.stockUnit !== shaped.stockUnit && await Inv.Ledger.exists({itemKind: 'ITEM', itemId: String(current._id)})) fail(409, 'The stock unit cannot change after stock has moved; it would corrupt history');
    if (shaped.code !== current.code && await Inv.Item.exists({code: shaped.code, _id: {$ne: current._id}})) fail(409, `Item code ${shaped.code} already exists`);
    const removed = (current.images || []).filter((i: any) => !shaped.images.some(n => n.url === i.url));
    const updated = await Inv.Item.findOneAndUpdate({_id: current._id, revision: b.revision}, {$set: shaped, $inc: {revision: 1}}, {returnDocument: 'after', runValidators: true}).lean();
    if (!updated) fail(409, 'This item was changed by someone else. Refresh and try again.');
    for (const f of removed) await destroyStored(f);
    res.json(itemView(updated, true));
  }));

  app.post('/api/inventory/items/:id/status', requireAuth, requirePerm('item.manage'), route(async (req, res) => {
    const {status} = parse(z.object({status: z.enum(['ACTIVE', 'INACTIVE'])}), req.body);
    const it: any = await Inv.Item.findById(req.params.id).lean();
    if (!it) fail(404, 'Item not found');
    if (status === 'INACTIVE') {
      const blockers: string[] = [];
      if (it.onHandM > 0) blockers.push(`${it.onHandM / 1000} ${it.stockUnit} still in stock (adjust or consume it first)`);
      if (it.reservedM > 0) blockers.push('stock is reserved for production');
      if (await Inv.PurchaseOrder.exists({status: {$in: ['DRAFT', 'SUBMITTED', 'APPROVED', 'PARTIALLY_RECEIVED']}, 'lines.itemId': String(it._id)})) blockers.push('open purchase orders include it');
      if (await Inv.Bom.exists({status: 'ACTIVE', 'lines.itemId': String(it._id)})) blockers.push('an active BOM uses it');
      if (blockers.length) fail(409, `Cannot deactivate: ${blockers.join('; ')}`, {blockers});
    }
    await Inv.Item.updateOne({_id: it._id}, {$set: {status}, $inc: {revision: 1}});
    res.json({ok: true});
  }));

  app.delete('/api/inventory/items/:id', requireAuth, requirePerm('item.manage'), route(async (req, res) => {
    const id = String(req.params.id);
    if (await Inv.Ledger.exists({itemKind: 'ITEM', itemId: id})) fail(409, 'Items with stock history cannot be deleted. Deactivate it instead.');
    if (await Inv.PurchaseOrder.exists({'lines.itemId': id}) || await Inv.Bom.exists({'lines.itemId': id})) fail(409, 'This item is used in purchases or BOMs. Deactivate it instead.');
    const it: any = await Inv.Item.findByIdAndDelete(id).lean();
    if (!it) fail(404, 'Item not found');
    for (const f of it.images || []) await destroyStored(f);
    res.json({ok: true});
  }));

  // Finished-product routes live in ./routes-products.ts
}
