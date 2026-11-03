// Product management on the ONE shared catalogue: legacy `products` (name, SKU, category, price,
// stock, reserved, status — used by orders, reservations and dispatch) + the inventory product profile
// (specs, images, pricing, variants). Stock history comes only from the unified ledger.
import crypto from 'node:crypto';
import type {Express, Request} from 'express';
import {z} from 'zod';
import {permissionsFor, requireAuth, requirePerm, sessionUser} from '../auth.js';
import {Models} from '../models.js';
import {ErpModels} from '../erp-models.js';
import {Inv} from './models.js';
import {escapeRegex, fail, paging, parse, route} from './http.js';
import {mutate} from './txn.js';
import {post} from './stock.js';
import {destroyStored} from './files.js';
import {bomCost} from './routes-production.js';
import {progress} from './routes-production.js';

const text = (max = 200) => z.string().trim().max(max);
const optNum = z.number().finite().min(0).max(1e9).nullable().optional();
const VIEWS = ['MAIN', 'FRONT', 'SIDE', 'INTERIOR', 'DOOR', 'DETAIL'] as const;
const fileRef = z.object({id: z.string().optional().default(''), url: z.string().min(1).max(2048), publicId: z.string().optional().default(''), name: z.string().max(200).optional(), mime: z.string().max(80).optional(), size: z.number().optional(), view: z.enum(VIEWS).optional()});
const rupeesOrNull = z.number().finite().min(0).max(1e8).nullable().optional();

const masterBody = z.object({name: text(160).min(2), sku: text(60).min(2), category: text(80).min(1), unit: text(20).optional().default('piece'), price: z.number().finite().min(0).max(1e8), reorder: z.number().int().min(0).max(1e6).optional().default(0), status: z.enum(['active', 'archived']).optional().default('active')});
export const profileBody = z.object({
  productCode: text(60).optional(), barcode: text(60).optional(), brand: text(80).optional(), model: text(80).optional(), design: text(80).optional(), doorDesign: text(120).optional(),
  doorCount: z.number().int().min(0).max(12).nullable().optional(), drawerCount: z.number().int().min(0).max(30).nullable().optional(), internalShelves: z.number().int().min(0).max(40).nullable().optional(),
  heightIn: optNum, widthIn: optNum, depthIn: optNum, thicknessMm: optNum, weightKg: optNum,
  material: text(120).optional(), colour: text(60).optional(), finish: text(80).optional(), lockType: text(60).optional(), handleType: text(60).optional(),
  features: z.array(text(80)).max(30).optional(), description: text(3000).optional(), specs: z.array(z.object({key: text(60).min(1), value: text(200)})).max(30).optional(),
  hsnCode: text(12).optional(), gstRateBps: z.number().int().min(0).max(2800).nullable().optional(),
  wholesalePriceRupees: rupeesOrNull, retailPriceRupees: rupeesOrNull, discountPct: z.number().min(0).max(100).nullable().optional(),
  warehouseLocation: text(80).optional(), variantLabel: text(120).optional(),
  images: z.array(fileRef).max(12).optional(),
});
function profileSet(b: z.infer<typeof profileBody>) {
  const {wholesalePriceRupees, retailPriceRupees, discountPct, ...rest} = b;
  const set: any = {...rest};
  if (wholesalePriceRupees !== undefined) set.wholesalePricePaise = wholesalePriceRupees == null ? null : Math.round(wholesalePriceRupees * 100);
  if (retailPriceRupees !== undefined) set.retailPricePaise = retailPriceRupees == null ? null : Math.round(retailPriceRupees * 100);
  if (discountPct !== undefined) set.discountBps = discountPct == null ? null : Math.round(discountPct * 100);
  for (const k of Object.keys(set)) if (set[k] === undefined) delete set[k];
  return set;
}
const newId = () => `p_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
async function canCost(req: Request) { return (await permissionsFor(sessionUser(req).role)).includes('inventory.valuation'); }
function mainImage(prof: any) { const imgs = prof?.images || []; return (imgs.find((i: any) => i.view === 'MAIN') || imgs[0])?.url || null; }

function view(p: any, prof: any, extra: any, cost: boolean) {
  const avail = p.stock - (p.reservedStock || 0);
  const mfg = prof?.avgCostPaise ?? null, sellPaise = Math.round((p.price || 0) * 100);
  return {
    id: p.id, name: p.name, sku: p.sku, category: p.category, unit: p.unit, price: p.price, status: p.status, reorder: p.reorder,
    stock: p.stock, reservedStock: p.reservedStock || 0, available: avail,
    stockStatus: avail <= 0 ? 'OUT' : avail <= (p.reorder || 0) ? 'LOW' : 'OK',
    image: mainImage(prof),
    profile: prof ? {...prof, _id: undefined, avgCostPaise: cost ? prof.avgCostPaise : undefined} : null,
    manufacturingCostPaise: cost ? mfg : undefined,
    marginPct: cost && mfg != null && sellPaise > 0 ? Math.round((sellPaise - mfg) / sellPaise * 1000) / 10 : undefined,
    valuePaise: cost && mfg != null ? Math.round(p.stock * mfg) : undefined,
    createdAt: p.createdAt, updatedAt: p.updatedAt, ...extra,
  };
}

/** Same rules the legacy order code uses; a product with orders, stock history, BOMs or production is archived, never deleted. */
async function references(id: string) {
  const [orders, ledger, boms, prods] = await Promise.all([Models.orders.countDocuments({'items.productId': id}), Inv.Ledger.countDocuments({itemKind: 'PRODUCT', itemId: id}), Inv.Bom.countDocuments({productId: id}), Inv.Production.countDocuments({productId: id})]);
  return {orders, ledger, boms, prods, any: orders + ledger + boms + prods > 0};
}

export function registerProductRoutes(app: Express) {
  // ---------- list ----------
  app.get('/api/inventory/products', requireAuth, requirePerm('inventory.view'), route(async (req, res) => {
    const {page, limit, skip} = paging(req);
    const filter: any = {};
    filter.status = req.query.status === 'all' ? {$in: ['active', 'archived']} : req.query.status === 'archived' ? 'archived' : 'active';
    const q = String(req.query.q || '').trim();
    if (q) filter.$or = ['name', 'sku', 'category'].map(f => ({[f]: {$regex: escapeRegex(q), $options: 'i'}}));
    if (req.query.category) filter.category = String(req.query.category);
    const minP = Number(req.query.minPrice), maxP = Number(req.query.maxPrice);
    if (Number.isFinite(minP) || Number.isFinite(maxP)) filter.price = {...(Number.isFinite(minP) ? {$gte: minP} : {}), ...(Number.isFinite(maxP) ? {$lte: maxP} : {})};
    const sortKey = String(req.query.sort || 'catalogue');
    const sort: any = sortKey === 'name' ? {name: 1} : sortKey === 'price' ? {price: 1} : sortKey === 'price-desc' ? {price: -1} : sortKey === 'stock' ? {stock: -1} : sortKey === 'newest' ? {createdAt: -1} : {sortOrder: 1, name: 1};
    let products: any[] = await Models.products.find(filter).sort(sort).lean();
    const ss = String(req.query.stockStatus || '');
    if (ss === 'OUT') products = products.filter(p => p.stock - (p.reservedStock || 0) <= 0);
    if (ss === 'IN') products = products.filter(p => p.stock - (p.reservedStock || 0) > 0);
    if (ss === 'LOW') products = products.filter(p => { const a = p.stock - (p.reservedStock || 0); return a > 0 && a <= (p.reorder || 0); });
    if (req.query.images === 'missing' || req.query.bom === 'missing') {
      const ids = products.map(p => p.id);
      if (req.query.images === 'missing') { const withImg = new Set((await Inv.ProductProfile.find({productId: {$in: ids}, 'images.0': {$exists: true}}).select('productId').lean()).map((x: any) => x.productId)); products = products.filter(p => !withImg.has(p.id)); }
      if (req.query.bom === 'missing') { const withBom = new Set((await Inv.Bom.find({productId: {$in: ids}, status: 'ACTIVE'}).select('productId').lean()).map((x: any) => x.productId)); products = products.filter(p => !withBom.has(p.id)); }
    }
    const slice = products.slice(skip, skip + limit), ids = slice.map(p => p.id);
    const [profiles, boms] = await Promise.all([Inv.ProductProfile.find({productId: {$in: ids}}).lean(), Inv.Bom.find({productId: {$in: ids}, status: 'ACTIVE'}).select('productId version').lean()]);
    const pm = new Map(profiles.map((x: any) => [x.productId, x])), bm = new Map(boms.map((x: any) => [x.productId, x]));
    const groups = [...new Set(profiles.map((x: any) => x.variantGroupId || x.productId))];
    const counts = await Inv.ProductProfile.aggregate([{$match: {variantGroupId: {$in: groups}}}, {$group: {_id: '$variantGroupId', n: {$sum: 1}}}]);
    const cm = new Map(counts.map(c => [c._id, c.n]));
    const cost = await canCost(req);
    const categories = ((await Models.products.distinct('category', {status: {$in: ['active', 'archived']}})) as string[]).sort();
    res.set('X-Total-Count', String(products.length)).json({
      items: slice.map(p => { const prof = pm.get(p.id); const n = cm.get(prof?.variantGroupId || p.id) || 0; return view(p, prof, {bom: bm.get(p.id) ? {version: (bm.get(p.id) as any).version, status: 'ACTIVE'} : null, variantCount: n ? n + 1 : 0}, cost); }),
      total: products.length, page, limit, categories,
    });
  }));

  // ---------- detail (all sections) ----------
  app.get('/api/inventory/products/:id', requireAuth, requirePerm('inventory.view'), route(async (req, res) => {
    const p: any = await Models.products.findOne({id: req.params.id}).lean();
    if (!p) fail(404, 'Product not found');
    const cost = await canCost(req);
    const prof: any = await Inv.ProductProfile.findOne({productId: p.id}).lean();
    const group = prof?.variantGroupId || p.id;
    const [activeBom, bomVersions, productions, ledgerAgg, recentLedger, orders, siblingsProf, damaged] = await Promise.all([
      Inv.Bom.findOne({productId: p.id, status: 'ACTIVE'}).lean(),
      Inv.Bom.find({productId: p.id}).select('version status createdAt createdBy approvedBy approvedAt').sort({version: -1}).lean(),
      Inv.Production.find({productId: p.id}).sort({createdAt: -1}).lean(),
      Inv.Ledger.aggregate([{$match: {itemKind: 'PRODUCT', itemId: p.id}}, {$group: {_id: '$type', in: {$sum: '$qtyInM'}, out: {$sum: '$qtyOutM'}, n: {$sum: 1}}}]),
      Inv.Ledger.find({itemKind: 'PRODUCT', itemId: p.id}).sort({_id: -1}).limit(30).lean(),
      Models.orders.find({'items.productId': p.id}).sort({createdAt: -1}).lean(),
      Inv.ProductProfile.find({$or: [{variantGroupId: group}, {productId: group}]}).lean(),
      Inv.Wastage.aggregate([{$match: {itemKind: 'PRODUCT', itemId: p.id, status: 'APPROVED'}}, {$group: {_id: null, q: {$sum: '$qtyM'}}}]),
    ]);
    const L = (t: string) => ledgerAgg.find(x => x._id === t) || {in: 0, out: 0, n: 0};
    const net = ledgerAgg.reduce((a, x) => a + x.in - x.out, 0) / 1000;
    const stock = {
      opening: L('OPENING').in / 1000, productionReceipts: L('PRODUCTION_OUTPUT').in / 1000, dispatched: L('SALES_DISPATCH').out / 1000, salesReturns: L('SALES_RETURN').in / 1000,
      adjustments: (L('ADJUSTMENT_IN').in - L('ADJUSTMENT_OUT').out + L('COUNT_ADJUSTMENT').in - L('COUNT_ADJUSTMENT').out + L('REVERSAL').in - L('REVERSAL').out) / 1000,
      damaged: (damaged[0]?.q || 0) / 1000, reserved: p.reservedStock || 0, onHand: p.stock, available: p.stock - (p.reservedStock || 0),
      // Stock that existed before movements were recorded in the ledger (e.g. entered on the old product form).
      unrecordedBeforeHistory: Math.round((p.stock - net) * 1000) / 1000,
      totalManufactured: L('PRODUCTION_OUTPUT').in / 1000,
    };
    const siblingIds = siblingsProf.map((x: any) => x.productId).filter((x: string) => x !== p.id);
    const siblings: any[] = siblingIds.length ? await Models.products.find({id: {$in: siblingIds}}).lean() : [];
    const sm = new Map(siblingsProf.map((x: any) => [x.productId, x]));
    const counted = ['Approved', 'Processing', 'Dispatched', 'Delivered'];
    const lineQty = (o: any) => o.items.filter((i: any) => i.productId === p.id).reduce((a: number, i: any) => a + i.qty, 0);
    const lineValue = (o: any) => o.items.filter((i: any) => i.productId === p.id).reduce((a: number, i: any) => a + i.qty * i.price, 0);
    const salesmen = new Map((await Models.users.find({id: {$in: [...new Set(orders.map((o: any) => o.createdBy).filter(Boolean))]}}).select('id name').lean()).map((u: any) => [u.id, u.name]));
    res.json({
      ...view(p, prof, {}, cost),
      stock,
      stockHistory: recentLedger.map((r: any) => ({_id: r._id, txnNo: r.txnNo, at: r.createdAt, type: r.type, refNumber: r.refNumber, refType: r.refType, prevM: r.prevM, newM: r.newM, qtyInM: r.qtyInM, qtyOutM: r.qtyOutM, prevReservedM: r.prevReservedM, newReservedM: r.newReservedM, by: r.performedBy?.name, reason: r.reason})),
      variants: siblings.map(s => ({id: s.id, name: s.name, sku: s.sku, price: s.price, status: s.status, stock: s.stock, available: s.stock - (s.reservedStock || 0), variantLabel: sm.get(s.id)?.variantLabel, image: mainImage(sm.get(s.id)), isRoot: s.id === group})),
      variantGroupId: group,
      manufacturing: await (async () => {
        if (!activeBom) return {bom: null, bomVersions, configured: false, availability: [], maxBuildable: null};
        const bc = await bomCost(activeBom);
        // How many almirahs current (unreserved) stock could make, from the active BOM incl. planned wastage.
        const availability = bc.lines.map((l: any) => ({itemId: l.itemId, itemName: l.itemName, unit: l.unit, perUnit: l.effectiveQtyPerUnit, available: l.available, canMake: l.effectiveQtyPerUnit > 0 ? Math.floor(l.available / l.effectiveQtyPerUnit + 1e-9) : null}));
        const caps = (availability as Array<{canMake: number | null}>).map(a => a.canMake).filter((x): x is number => x != null);
        return {bom: {...activeBom, cost: cost ? bc : undefined}, bomVersions, configured: true, availability, maxBuildable: caps.length ? Math.max(0, Math.min(...caps)) : null};
      })(),
      production: {
        orders: productions.length,
        manufactured: productions.reduce((a: number, o: any) => a + o.completedQty, 0),
        inProduction: productions.filter((o: any) => ['APPROVED', 'MATERIALS_RESERVED', 'IN_PROGRESS', 'QUALITY_CHECK'].includes(o.status)).reduce((a: number, o: any) => a + Math.max(0, o.plannedQty - o.completedQty - o.rejectedQty), 0),
        completed: productions.filter((o: any) => o.status === 'COMPLETED').reduce((a: number, o: any) => a + o.completedQty, 0),
        rejected: productions.reduce((a: number, o: any) => a + o.rejectedQty, 0),
        recent: productions.slice(0, 20).map((o: any) => ({_id: o._id, number: o.number, status: o.status, plannedQty: o.plannedQty, completedQty: o.completedQty, rejectedQty: o.rejectedQty, createdAt: o.createdAt, completedAt: o.completedAt, progress: progress(o), unitCosts: cost ? o.outputs.map((b: any) => ({batchNo: b.batchNo, acceptedQty: b.acceptedQty, unitCostPaise: b.unitCostPaise, postedAt: b.postedAt})) : undefined})),
      },
      sales: {
        orders: orders.length,
        countedOrders: orders.filter((o: any) => counted.includes(o.status)).length,
        unitsSold: orders.filter((o: any) => counted.includes(o.status)).reduce((a: number, o: any) => a + lineQty(o), 0),
        valuePaise: Math.round(orders.filter((o: any) => counted.includes(o.status)).reduce((a: number, o: any) => a + lineValue(o), 0) * 100),
        recent: orders.slice(0, 20).map((o: any) => ({id: o.id, createdAt: o.createdAt, customerName: o.customerName, status: o.status, qty: lineQty(o), valuePaise: Math.round(lineValue(o) * 100), salesman: salesmen.get(o.createdBy) || '—'})),
      },
    });
  }));

  // ---------- create / update ----------
  const createBody = z.object({master: masterBody, profile: profileBody.optional().default({}), openingQty: z.number().int().min(0).max(1e6).optional().default(0), openingCostRupees: z.number().min(0).max(1e8).nullable().optional(), variantOf: z.string().optional()});
  async function createProduct(req: Request, b: z.infer<typeof createBody>, kind: string) {
    return mutate(req, kind, async ({session, actor}) => {
      const sku = b.master.sku.trim();
      if (await Models.products.exists({sku}).session(session)) fail(409, `SKU ${sku} already exists`);
      if (b.profile.barcode && await Inv.ProductProfile.exists({barcode: b.profile.barcode}).session(session)) fail(409, 'Another product already has this barcode');
      let variantGroupId: string | null = null;
      if (b.variantOf) {
        const root: any = await Inv.ProductProfile.findOne({productId: b.variantOf}).session(session).lean();
        if (!await Models.products.exists({id: b.variantOf}).session(session)) fail(404, 'The model to add a variant to was not found');
        variantGroupId = root?.variantGroupId || b.variantOf;
        if (!root) await Inv.ProductProfile.create([{productId: b.variantOf}], {session});
      }
      const id = newId();
      await Models.products.create([{id, ...b.master, sku, stock: 0, reservedStock: 0}], {session});
      await Inv.ProductProfile.create([{productId: id, ...profileSet(b.profile), variantGroupId}], {session});
      if (b.openingQty > 0) await post(session, actor, {kind: 'PRODUCT', itemId: id, type: 'OPENING', dOnM: b.openingQty * 1000, unitCostPaise: b.openingCostRupees == null ? null : Math.round(b.openingCostRupees * 100 * 10000) / 10000, ref: {type: 'PRODUCT', id, number: sku}, key: `OPENING:${id}`, reason: 'Opening stock'});
      return {id, sku};
    });
  }
  app.post('/api/inventory/products', requireAuth, requirePerm('item.manage'), route(async (req, res) => {
    const r = await createProduct(req, parse(createBody, req.body), 'PRODUCT_CREATE');
    res.status(r.replayed ? 200 : 201).json(r);
  }));
  // Product master fields live in the shared catalogue; edits go through the shared lock + transaction.
  app.patch('/api/inventory/products/:id', requireAuth, requirePerm('item.manage'), route(async (req, res) => {
    const b = parse(masterBody.partial(), req.body);
    const r = await mutate(req, 'PRODUCT_UPDATE', async ({session}) => {
      if (b.sku && await Models.products.exists({sku: b.sku, id: {$ne: req.params.id}}).session(session)) fail(409, `SKU ${b.sku} already exists`);
      const p = await Models.products.findOneAndUpdate({id: req.params.id}, {$set: b}, {session, returnDocument: 'after'}).lean();
      if (!p) fail(404, 'Product not found');
      return {id: String(req.params.id)};
    });
    res.json(r);
  }));
  app.put('/api/inventory/products/:id/profile', requireAuth, requirePerm('item.manage'), route(async (req, res) => {
    const b = parse(profileBody, req.body);
    if (!await Models.products.exists({id: req.params.id})) fail(404, 'Product not found');
    if (b.barcode && await Inv.ProductProfile.exists({barcode: b.barcode, productId: {$ne: req.params.id}})) fail(409, 'Another product already has this barcode');
    const before: any = await Inv.ProductProfile.findOne({productId: req.params.id}).lean();
    const doc = await Inv.ProductProfile.findOneAndUpdate({productId: req.params.id}, {$set: profileSet(b), $inc: {revision: 1}, $setOnInsert: {productId: req.params.id}}, {upsert: true, returnDocument: 'after', runValidators: true}).lean();
    if (b.images) for (const f of (before?.images || []).filter((i: any) => !b.images!.some(n => n.url === i.url))) await destroyStored(f);
    res.json(doc);
  }));

  // ---------- duplicate / variant ----------
  app.post('/api/inventory/products/:id/duplicate', requireAuth, requirePerm('item.manage'), route(async (req, res) => {
    const b = parse(z.object({sku: text(60).min(2), name: text(160).min(2), asVariant: z.boolean().default(false), variantLabel: text(120).optional(), overrides: profileBody.optional().default({}), price: z.number().min(0).max(1e8).optional()}), req.body);
    const p: any = await Models.products.findOne({id: req.params.id}).lean();
    if (!p) fail(404, 'Product not found');
    const prof: any = await Inv.ProductProfile.findOne({productId: p.id}).lean() || {};
    const {_id, productId, createdAt, updatedAt, revision, avgCostPaise, variantGroupId, wholesalePricePaise, retailPricePaise, discountBps, barcode, ...copy} = prof;
    const profile: any = {...copy, wholesalePriceRupees: wholesalePricePaise == null ? null : wholesalePricePaise / 100, retailPriceRupees: retailPricePaise == null ? null : retailPricePaise / 100, discountPct: discountBps == null ? null : discountBps / 100, ...b.overrides, variantLabel: b.variantLabel ?? b.overrides.variantLabel};
    delete profile.sourceRef;
    // Manufacturing cost is never copied: the new product has its own production history.
    const r = await createProduct(req, {master: {name: b.name, sku: b.sku, category: p.category, unit: p.unit || 'piece', price: b.price ?? p.price, reorder: p.reorder || 0, status: 'active'}, profile: parse(profileBody, profile), openingQty: 0, openingCostRupees: null, variantOf: b.asVariant ? p.id : undefined}, b.asVariant ? 'PRODUCT_VARIANT' : 'PRODUCT_DUPLICATE');
    res.status(r.replayed ? 200 : 201).json(r);
  }));

  // ---------- archive / delete ----------
  app.delete('/api/inventory/products/:id', requireAuth, requirePerm('item.manage'), route(async (req, res) => {
    const id = String(req.params.id);
    const refs = await references(id);
    if (refs.any) fail(409, `This product has history (${[refs.orders && `${refs.orders} order(s)`, refs.ledger && `${refs.ledger} stock movement(s)`, refs.boms && `${refs.boms} BOM version(s)`, refs.prods && `${refs.prods} production order(s)`].filter(Boolean).join(', ')}). Archive it instead.`, refs);
    const r = await mutate(req, 'PRODUCT_DELETE', async ({session}) => {
      const p: any = await Models.products.findOneAndDelete({id, stock: 0, reservedStock: 0}, {session}).lean();
      if (!p) fail(409, 'Only products with no stock can be deleted');
      await Inv.ProductProfile.deleteOne({productId: id}, {session});
      return {id};
    });
    res.json(r);
  }));

  // ---------- bulk (safe fields only: never stock, never cost) ----------
  app.post('/api/inventory/products/bulk', requireAuth, requirePerm('item.manage'), route(async (req, res) => {
    const b = parse(z.object({ids: z.array(z.string()).min(1).max(500), category: text(80).min(1).optional(), status: z.enum(['active', 'archived']).optional(), reorder: z.number().int().min(0).max(1e6).optional(), warehouseLocation: text(80).optional(), gstRateBps: z.number().int().min(0).max(2800).optional()}), req.body);
    const master: any = {}, prof: any = {};
    if (b.category) master.category = b.category; if (b.status) master.status = b.status; if (b.reorder != null) master.reorder = b.reorder;
    if (b.warehouseLocation !== undefined) prof.warehouseLocation = b.warehouseLocation; if (b.gstRateBps != null) prof.gstRateBps = b.gstRateBps;
    if (!Object.keys(master).length && !Object.keys(prof).length) fail(400, 'Choose at least one field to update');
    const r = await mutate(req, 'PRODUCT_BULK', async ({session}) => {
      let n = 0;
      if (Object.keys(master).length) n = (await Models.products.updateMany({id: {$in: b.ids}}, {$set: master}, {session})).matchedCount;
      if (Object.keys(prof).length) for (const id of b.ids) { await Inv.ProductProfile.updateOne({productId: id}, {$set: prof, $setOnInsert: {productId: id}}, {upsert: true, session}); }
      return {updated: Object.keys(master).length ? n : b.ids.length};
    });
    res.json(r);
  }));

  // ---------- import (CSV rows parsed in the browser; preview first, then apply) ----------
  const importRow = z.object({sku: text(60).min(2), name: text(160).optional(), category: text(80).optional(), price: z.coerce.number().min(0).max(1e8).optional(), reorder: z.coerce.number().int().min(0).optional(), doorCount: z.coerce.number().int().min(0).max(12).optional(), drawerCount: z.coerce.number().int().min(0).max(30).optional(), heightIn: z.coerce.number().min(0).optional(), widthIn: z.coerce.number().min(0).optional(), depthIn: z.coerce.number().min(0).optional(), thicknessMm: z.coerce.number().min(0).optional(), colour: text(60).optional(), finish: text(80).optional(), material: text(120).optional(), lockType: text(60).optional(), handleType: text(60).optional(), brand: text(80).optional(), description: text(3000).optional()});
  app.post('/api/inventory/products/import', requireAuth, requirePerm('item.manage'), route(async (req, res) => {
    const b = parse(z.object({rows: z.array(z.record(z.string(), z.unknown())).min(1).max(2000), apply: z.boolean().default(false)}), req.body);
    const existing = new Map(((await Models.products.find({sku: {$in: b.rows.map(r => String(r.sku || '').trim())}}).select('id sku').lean()) as any[]).map(p => [p.sku, p.id]));
    const seen = new Set<string>();
    const report = b.rows.map((raw, i) => {
      const clean = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== '' && v != null));
      const r = importRow.safeParse(clean);
      if (!r.success) return {row: i + 2, sku: String(raw.sku || ''), action: 'ERROR', message: r.error.issues.map(x => `${x.path.join('.')}: ${x.message}`).join('; ')};
      if (seen.has(r.data.sku)) return {row: i + 2, sku: r.data.sku, action: 'ERROR', message: 'Duplicate SKU in the file'};
      seen.add(r.data.sku);
      if (!existing.has(r.data.sku) && (!r.data.name || !r.data.category || r.data.price == null)) return {row: i + 2, sku: r.data.sku, action: 'ERROR', message: 'New products need name, category and price'};
      return {row: i + 2, sku: r.data.sku, action: existing.has(r.data.sku) ? 'UPDATE' : 'CREATE', data: r.data};
    });
    if (!b.apply) return res.json({report, applied: false});
    if (report.some(r => r.action === 'ERROR')) fail(400, 'Fix the rows with errors before importing');
    const result = await mutate(req, 'PRODUCT_IMPORT', async ({session}) => {
      let created = 0, updated = 0;
      for (const r of report as any[]) {
        const {sku, name, category, price, reorder, ...prof} = r.data;
        const master: any = {}; if (name) master.name = name; if (category) master.category = category; if (price != null) master.price = price; if (reorder != null) master.reorder = reorder;
        let id = existing.get(sku);
        // Stock is never imported: it changes only through the ledger.
        if (!id) { id = newId(); await Models.products.create([{id, sku, name, category, price, reorder: reorder ?? 0, unit: 'piece', stock: 0, reservedStock: 0, status: 'active'}], {session}); created++; }
        else { if (Object.keys(master).length) await Models.products.updateOne({id}, {$set: master}, {session}); updated++; }
        if (Object.keys(prof).length) await Inv.ProductProfile.updateOne({productId: id}, {$set: prof, $setOnInsert: {productId: id}}, {upsert: true, session});
      }
      return {created, updated};
    });
    res.json({...result, applied: true});
  }));

  // ---------- categories (catalogue scope; product records keep the category name) ----------
  app.get('/api/inventory/product-categories', requireAuth, requirePerm('inventory.view'), route(async (_req, res) => {
    const [defined, counts] = await Promise.all([ErpModels.Category.find({scope: {$ne: 'inventory'}}).sort({name: 1}).lean(), Models.products.aggregate([{$group: {_id: '$category', total: {$sum: 1}, active: {$sum: {$cond: [{$eq: ['$status', 'active']}, 1, 0]}}}}])]);
    const cm = new Map(counts.map(c => [c._id, c]));
    const names = new Set([...defined.map((c: any) => c.name), ...counts.map(c => c._id)]);
    res.json([...names].sort().map(name => { const d: any = defined.find((c: any) => c.name === name); const c = cm.get(name); return {name, _id: d?._id || null, managed: Boolean(d), active: d ? d.active !== false : true, products: c?.total || 0, activeProducts: c?.active || 0}; }));
  }));
  app.post('/api/inventory/product-categories', requireAuth, requirePerm('item.manage'), route(async (req, res) => {
    const {name} = parse(z.object({name: text(80).min(2)}), req.body);
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (await ErpModels.Category.exists({$or: [{slug}, {name, scope: {$ne: 'inventory'}}]})) fail(409, 'This category already exists');
    res.status(201).json(await ErpModels.Category.create({name, slug, scope: 'product', active: true}));
  }));
  // Rename moves every product in the category with it, inside the shared lock + transaction.
  app.post('/api/inventory/product-categories/rename', requireAuth, requirePerm('item.manage'), route(async (req, res) => {
    const b = parse(z.object({from: text(80).min(1), to: text(80).min(2)}), req.body);
    if (b.from === b.to) fail(400, 'Choose a different name');
    const r = await mutate(req, 'PRODUCT_CATEGORY_RENAME', async ({session}) => {
      if (await Models.products.exists({category: b.to}).session(session) || await ErpModels.Category.exists({name: b.to, scope: {$ne: 'inventory'}}).session(session)) fail(409, `A category called ${b.to} already exists`);
      const moved = (await Models.products.updateMany({category: b.from}, {$set: {category: b.to}}, {session})).modifiedCount;
      const slug = b.to.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const cat = await ErpModels.Category.findOneAndUpdate({name: b.from, scope: {$ne: 'inventory'}}, {$set: {name: b.to, slug}}, {session});
      if (!cat) await ErpModels.Category.create([{name: b.to, slug, scope: 'product', active: true}], {session});
      return {moved};
    });
    res.json(r);
  }));
  app.post('/api/inventory/product-categories/status', requireAuth, requirePerm('item.manage'), route(async (req, res) => {
    const b = parse(z.object({name: text(80).min(1), active: z.boolean()}), req.body);
    if (!b.active && await Models.products.exists({category: b.name, status: 'active'})) fail(409, 'Archive or move the active products in this category first');
    const slug = b.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    await ErpModels.Category.updateOne({name: b.name, scope: {$ne: 'inventory'}}, {$set: {active: b.active}, $setOnInsert: {name: b.name, slug, scope: 'product'}}, {upsert: true});
    res.json({ok: true});
  }));
}
