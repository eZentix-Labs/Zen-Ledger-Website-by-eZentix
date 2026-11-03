import type {Express, Request} from 'express';
import {z} from 'zod';
import {permissionsFor, requireAuth, requirePerm, sessionUser} from '../auth.js';
import {Models} from '../models.js';
import {ErpModels} from '../erp-models.js';
import {Inv} from './models.js';
import {UNITS} from './units.js';
import {fail, parse, route} from './http.js';
import {mutate, nextNumber} from './txn.js';
import {stockStatus} from './routes-items.js';
import {progress} from './routes-production.js';
import {buildLines, totals} from './routes-purchases.js';

const ACTIVE_PROD = ['APPROVED', 'MATERIALS_RESERVED', 'IN_PROGRESS', 'QUALITY_CHECK'];
const OPEN_PO = ['SUBMITTED', 'APPROVED', 'PARTIALLY_RECEIVED'];
const tz = process.env.BUSINESS_TIMEZONE || 'Asia/Kolkata';
const dayStart = (d = new Date()) => { const s = new Intl.DateTimeFormat('en-CA', {timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit'}).format(d); return new Date(`${s}T00:00:00+05:30`); };

function period(req: Request) {
  const to = req.query.to ? new Date(`${req.query.to}T23:59:59.999+05:30`) : new Date();
  const from = req.query.from ? new Date(`${req.query.from}T00:00:00+05:30`) : new Date(dayStart().getTime() - 29 * 86400000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) fail(400, 'Invalid date range');
  return {from, to};
}
const sumLedger = async (types: string[], from: Date, to: Date) => {
  const [r] = await Inv.Ledger.aggregate([{$match: {type: {$in: types}, createdAt: {$gte: from, $lte: to}}}, {$group: {_id: null, value: {$sum: {$ifNull: ['$valuePaise', 0]}}, unknown: {$sum: {$cond: [{$eq: ['$valuePaise', null]}, 1, 0]}}, count: {$sum: 1}}}]);
  return {valuePaise: r?.value ?? 0, uncostedMovements: r?.unknown ?? 0, count: r?.count ?? 0};
};

async function stockValues() {
  const items: any[] = await Inv.Item.find({status: 'ACTIVE'}).select('itemType onHandM reservedM avgCostPaise reorderLevelM minStockM').lean();
  const val = (types: string[]) => { const xs = items.filter(i => types.includes(i.itemType)); return {valuePaise: xs.reduce((a, i) => a + (i.avgCostPaise == null ? 0 : Math.round(i.onHandM / 1000 * i.avgCostPaise)), 0), uncosted: xs.filter(i => i.onHandM > 0 && i.avgCostPaise == null).length, items: xs.length}; };
  const products: any[] = await Models.products.find({status: 'active'}).select('id stock reservedStock reorder').lean();
  const profiles: any[] = await Inv.ProductProfile.find({productId: {$in: products.map(p => p.id)}}).select('productId avgCostPaise').lean();
  const pm = new Map(profiles.map(p => [p.productId, p.avgCostPaise]));
  const fg = {valuePaise: products.reduce((a, p) => a + (pm.get(p.id) == null ? 0 : Math.round(p.stock * pm.get(p.id))), 0), uncosted: products.filter(p => p.stock > 0 && pm.get(p.id) == null).length, items: products.length, units: products.reduce((a, p) => a + p.stock, 0)};
  return {items, products, raw: val(['RAW_MATERIAL']), accessories: val(['COMPONENT']), other: val(['CONSUMABLE', 'PACKAGING', 'SPARE_PART', 'SEMI_FINISHED', 'OTHER']), fg};
}

async function completeness() {
  const [items, suppliers, products, profiles, activeBoms, prodOrders, unrefLedger] = await Promise.all([
    Inv.Item.find({status: 'ACTIVE'}).select('name itemType stockUnit avgCostPaise lastPurchaseRatePaise reorderLevelM').lean(),
    Inv.Supplier.find({status: 'ACTIVE'}).select('name phone contactPerson address').lean(),
    Models.products.find({status: 'active'}).select('id name').lean(),
    Inv.ProductProfile.find({'images.0': {$exists: true}}).select('productId').lean(),
    Inv.Bom.find({status: 'ACTIVE'}).select('productId').lean(),
    Inv.Production.find({status: {$in: ['IN_PROGRESS', 'QUALITY_CHECK', 'COMPLETED']}}).select('number lines').lean(),
    Inv.Ledger.countDocuments({$or: [{refId: {$in: [null, '']}}, {refType: {$in: [null, '']}}]}),
  ]);
  const withImg = new Set(profiles.map((p: any) => p.productId)), withBom = new Set(activeBoms.map((b: any) => b.productId));
  const important = (items as any[]).filter(i => ['RAW_MATERIAL', 'COMPONENT'].includes(i.itemType));
  void unrefLedger;
  // A list with nothing in it is not "complete": an empty material list fails rather than counting as 100%.
  const none = (n: number, what: string) => n === 0 ? [`No ${what} added yet`] : null;
  const checks = [
    {key: 'units', label: 'Materials have valid units', total: items.length, failing: none(items.length, 'stock items') ?? (items as any[]).filter(i => !UNITS[i.stockUnit]).map(i => i.name), action: {tab: 'raw'}},
    {key: 'costs', label: 'Materials have purchase costs', total: items.length, failing: none(items.length, 'stock items') ?? (items as any[]).filter(i => i.avgCostPaise == null && i.lastPurchaseRatePaise == null).map(i => i.name), action: {tab: 'raw'}},
    {key: 'reorder', label: 'Reorder levels configured', total: important.length, failing: none(important.length, 'raw materials or accessories') ?? important.filter(i => i.reorderLevelM == null).map(i => i.name), action: {tab: 'raw'}},
    {key: 'suppliers', label: 'Suppliers configured', total: suppliers.length, failing: none(suppliers.length, 'suppliers') ?? (suppliers as any[]).filter(s => !s.phone || !s.contactPerson || !s.address).map(s => `${s.name} (contact details missing)`), action: {tab: 'suppliers'}},
    {key: 'images', label: 'Products have images', total: products.length, failing: (products as any[]).filter(p => !withImg.has(p.id)).map(p => p.name), action: {tab: 'finished'}},
    {key: 'boms', label: 'BOM configured', total: products.length, failing: (products as any[]).filter(p => !withBom.has(p.id)).map(p => p.name), action: {tab: 'production', sub: 'bom'}},
    {key: 'production', label: 'Production records complete', total: prodOrders.length, failing: (prodOrders as any[]).filter(o => !o.lines.some((l: any) => l.issuedM > 0)).map(o => `${o.number} has no material issue`), action: {tab: 'production'}},
  ].map(c => ({...c, failingCount: c.failing.length, failing: c.failing.slice(0, 8), passed: c.failing.length === 0}));
  const passed = checks.filter(c => c.passed).length;
  return {checks, passed, total: checks.length, pct: Math.round(passed / checks.length * 100)};
}

async function openPoQty() {
  const pos: any[] = await Inv.PurchaseOrder.find({status: {$in: OPEN_PO}}).select('lines').lean();
  const m = new Map<string, number>();
  for (const po of pos) for (const l of po.lines) m.set(l.itemId, (m.get(l.itemId) || 0) + Math.max(0, l.orderedM - l.acceptedM));
  return m;
}
export async function reorderSuggestions() {
  const onOrder = await openPoQty();
  const items: any[] = await Inv.Item.find({status: 'ACTIVE'}).lean();
  const suppliers: any[] = await Inv.Supplier.find({}).select('name').lean();
  const sm = new Map(suppliers.map(s => [String(s._id), s.name]));
  return items.filter(i => stockStatus(i) !== 'OK' || (i.minStockM != null && i.onHandM - i.reservedM < i.minStockM)).map(i => {
    const available = i.onHandM - i.reservedM, open = onOrder.get(String(i._id)) || 0;
    const target = i.maxStockM ?? (i.reorderQtyM != null ? available + open + i.reorderQtyM : null);
    let suggestM = target == null ? null : Math.max(0, target - (available + open));
    if (suggestM != null && UNITS[i.stockUnit]?.dimension === 'COUNT') suggestM = Math.ceil(suggestM / 1000) * 1000;
    return {itemId: String(i._id), name: i.name, code: i.code, itemType: i.itemType, unit: i.stockUnit, status: stockStatus(i), availableM: available, reorderLevelM: i.reorderLevelM, minStockM: i.minStockM, maxStockM: i.maxStockM, onOrderM: open, suggestedM: suggestM, simpleSuggestedM: i.maxStockM == null ? null : Math.max(0, i.maxStockM - available), preferredSupplierId: i.preferredSupplierId, preferredSupplierName: sm.get(i.preferredSupplierId) || null, leadTimeDays: i.leadTimeDays, lastRatePaise: i.lastPurchaseRatePaise};
  });
}

const csvCell = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const rupee = (p: number | null | undefined) => p == null ? '' : (p / 100).toFixed(2);
const qty = (m: number | null | undefined) => m == null ? '' : String(m / 1000);
const dt = (d: any) => d ? new Date(d).toISOString().slice(0, 10) : '';

type Report = {title: string; perm: 'inventory.view' | 'inventory.valuation'; build: (req: Request) => Promise<{columns: string[]; rows: unknown[][]}>};
const REPORTS: Record<string, Report> = {
  'raw-material-stock': {title: 'Raw material & accessories stock', perm: 'inventory.view', build: async () => { const items: any[] = await Inv.Item.find({status: 'ACTIVE'}).sort({itemType: 1, name: 1}).lean(); return {columns: ['Code', 'Name', 'Type', 'Unit', 'On hand', 'Reserved', 'Available', 'Reorder level', 'Status', 'Location'], rows: items.map(i => [i.code, i.name, i.itemType, i.stockUnit, qty(i.onHandM), qty(i.reservedM), qty(i.onHandM - i.reservedM), qty(i.reorderLevelM), stockStatus(i), i.location])}; }},
  'product-catalogue': {title: 'Product catalogue (export)', perm: 'inventory.view', build: async req => {
    const cost = (await permissionsFor(sessionUser(req).role)).includes('inventory.valuation');
    const ps: any[] = await Models.products.find({}).sort({sortOrder: 1, name: 1}).lean();
    const prof: any[] = await Inv.ProductProfile.find({}).lean(); const pm = new Map(prof.map(p => [p.productId, p]));
    const r = (p: number | null | undefined) => p == null ? '' : (p / 100).toFixed(2);
    return {columns: ['sku', 'name', 'category', 'status', 'price', 'wholesalePrice', 'retailPrice', 'gstPct', ...(cost ? ['manufacturingCost'] : []), 'stock', 'reserved', 'available', 'reorder', 'productCode', 'barcode', 'brand', 'model', 'doorDesign', 'doorCount', 'drawerCount', 'internalShelves', 'heightIn', 'widthIn', 'depthIn', 'thicknessMm', 'material', 'colour', 'finish', 'lockType', 'handleType', 'weightKg', 'warehouseLocation', 'variantLabel', 'features', 'images'],
      rows: ps.map(p => { const x = pm.get(p.id) || {}; return [p.sku, p.name, p.category, p.status, p.price, r(x.wholesalePricePaise), r(x.retailPricePaise), x.gstRateBps == null ? '' : x.gstRateBps / 100, ...(cost ? [r(x.avgCostPaise)] : []), p.stock, p.reservedStock || 0, p.stock - (p.reservedStock || 0), p.reorder, x.productCode || '', x.barcode || '', x.brand || '', x.model || '', x.doorDesign || x.design || '', x.doorCount ?? '', x.drawerCount ?? '', x.internalShelves ?? '', x.heightIn ?? '', x.widthIn ?? '', x.depthIn ?? '', x.thicknessMm ?? '', x.material || '', x.colour || '', x.finish || '', x.lockType || '', x.handleType || '', x.weightKg ?? '', x.warehouseLocation || '', x.variantLabel || '', (x.features || []).join('; '), (x.images || []).length]; })};
  }},
  'finished-goods-stock': {title: 'Finished goods stock', perm: 'inventory.view', build: async () => { const ps: any[] = await Models.products.find({status: 'active'}).sort({name: 1}).lean(); return {columns: ['SKU', 'Product', 'Category', 'On hand', 'Reserved', 'Available', 'Reorder level'], rows: ps.map(p => [p.sku, p.name, p.category, p.stock, p.reservedStock || 0, p.stock - (p.reservedStock || 0), p.reorder])}; }},
  'stock-valuation': {title: 'Stock valuation (weighted average cost)', perm: 'inventory.valuation', build: async () => { const items: any[] = await Inv.Item.find({status: 'ACTIVE'}).sort({itemType: 1, name: 1}).lean(); const ps: any[] = await Models.products.find({status: 'active'}).lean(); const prof: any[] = await Inv.ProductProfile.find({}).lean(); const pm = new Map(prof.map(p => [p.productId, p.avgCostPaise])); return {columns: ['Type', 'Code', 'Name', 'Qty', 'Unit', 'Avg cost (₹)', 'Value (₹)'], rows: [...items.map(i => [i.itemType, i.code, i.name, qty(i.onHandM), i.stockUnit, rupee(i.avgCostPaise), i.avgCostPaise == null ? 'cost missing' : rupee(Math.round(i.onHandM / 1000 * i.avgCostPaise))]), ...ps.filter(p => p.stock > 0).map(p => ['FINISHED_GOOD', p.sku, p.name, p.stock, 'pcs', rupee(pm.get(p.id)), pm.get(p.id) == null ? 'cost missing' : rupee(Math.round(p.stock * pm.get(p.id)))])]}; }},
  'low-stock': {title: 'Low & out of stock', perm: 'inventory.view', build: async () => { const s = await reorderSuggestions(); return {columns: ['Code', 'Item', 'Status', 'Available', 'Unit', 'Reorder level', 'On order', 'Suggested purchase', 'Preferred supplier'], rows: s.map(x => [x.code, x.name, x.status, qty(x.availableM), x.unit, qty(x.reorderLevelM), qty(x.onOrderM), qty(x.suggestedM), x.preferredSupplierName || ''])}; }},
  purchases: {title: 'Purchases (goods received)', perm: 'inventory.valuation', build: async req => { const {from, to} = period(req); const g: any[] = await Inv.GoodsReceipt.find({createdAt: {$gte: from, $lte: to}}).sort({createdAt: 1}).lean(); return {columns: ['Date', 'GRN', 'PO', 'Supplier', 'Supplier invoice', 'Item', 'Received', 'Accepted', 'Rejected', 'Unit cost (₹)', 'Value (₹)'], rows: g.flatMap(x => x.lines.map((l: any) => [dt(x.receivedDate || x.createdAt), x.number, x.poNumber, x.supplierName, x.supplierInvoiceNo || '', l.itemName, qty(l.receivedM), qty(l.acceptedM), qty(l.rejectedM), rupee(l.unitCostPaise), rupee(l.valuePaise)]))}; }},
  suppliers: {title: 'Supplier purchase summary', perm: 'inventory.valuation', build: async () => { const s: any[] = await Inv.Supplier.find({}).sort({name: 1}).lean(); const led = await Inv.SupplierLedger.aggregate([{$group: {_id: {s: '$supplierId', t: '$type'}, v: {$sum: '$amountPaise'}}}]); const get = (id: string, t: string) => led.find(x => x._id.s === id && x._id.t === t)?.v || 0; return {columns: ['Code', 'Supplier', 'Category', 'Phone', 'GSTIN', 'Opening (₹)', 'Bills (₹)', 'Returns (₹)', 'Payments (₹)', 'Outstanding (₹)'], rows: s.map(x => { const id = String(x._id); const o = get(id, 'OPENING'), b = get(id, 'BILL'), r = get(id, 'RETURN'), p = get(id, 'PAYMENT') + get(id, 'PAYMENT_VOID'); return [x.supplierCode, x.name, x.category, x.phone, x.gstin || '', rupee(o), rupee(b), rupee(-r), rupee(-p), rupee(o + b + r + p)]; })}; }},
  'supplier-outstanding': {title: 'Supplier outstanding bills', perm: 'inventory.valuation', build: async () => { const b: any[] = await Inv.Bill.find({status: {$in: ['POSTED', 'PARTIALLY_PAID']}}).sort({dueDate: 1}).lean(); const now = Date.now(); return {columns: ['Supplier', 'Bill', 'Supplier invoice', 'Invoice date', 'Due date', 'Total (₹)', 'Paid (₹)', 'Balance (₹)', 'Overdue days'], rows: b.map(x => [x.supplierName, x.number, x.supplierInvoiceNo, dt(x.invoiceDate), dt(x.dueDate), rupee(x.totalPaise), rupee(x.paidPaise), rupee(x.totalPaise - x.paidPaise), x.dueDate && new Date(x.dueDate).getTime() < now ? Math.floor((now - new Date(x.dueDate).getTime()) / 86400000) : 0])}; }},
  production: {title: 'Production summary', perm: 'inventory.view', build: async req => { const {from, to} = period(req); const o: any[] = await Inv.Production.find({createdAt: {$gte: from, $lte: to}}).sort({createdAt: 1}).lean(); return {columns: ['Order', 'Product', 'Status', 'Planned', 'Completed', 'Rejected', 'Progress %', 'Current stage', 'Assigned to', 'Expected', 'Completed on'], rows: o.map(x => { const p = progress(x); return [x.number, x.productName, x.status, x.plannedQty, x.completedQty, x.rejectedQty, p.outputPct, p.currentStage || '', x.assignedTo || '', dt(x.expectedDate), dt(x.completedAt)]; })}; }},
  wip: {title: 'Work in progress', perm: 'inventory.view', build: async () => { const o: any[] = await Inv.Production.find({status: {$in: ACTIVE_PROD}}).sort({expectedDate: 1}).lean(); return {columns: ['Order', 'Product', 'Status', 'Planned', 'Done', 'Remaining', 'Current stage', 'Stages done', 'Assigned to', 'Expected', 'Overdue'], rows: o.map(x => { const p = progress(x); return [x.number, x.productName, x.status, x.plannedQty, x.completedQty + x.rejectedQty, p.remainingQty, p.currentStage || '', `${p.stagesDone}/${p.stagesTotal}`, x.assignedTo || '', dt(x.expectedDate), p.overdue ? 'YES' : '']; })}; }},
  'material-consumption': {title: 'Material consumption (issued to production)', perm: 'inventory.valuation', build: async req => { const {from, to} = period(req); const r = await Inv.Ledger.aggregate([{$match: {type: {$in: ['MATERIAL_ISSUE', 'MATERIAL_RETURN']}, createdAt: {$gte: from, $lte: to}}}, {$group: {_id: {id: '$itemId', name: '$itemName', unit: '$unit'}, out: {$sum: '$qtyOutM'}, back: {$sum: '$qtyInM'}, issueValue: {$sum: {$cond: [{$eq: ['$type', 'MATERIAL_ISSUE']}, {$ifNull: ['$valuePaise', 0]}, 0]}}, returnValue: {$sum: {$cond: [{$eq: ['$type', 'MATERIAL_RETURN']}, {$ifNull: ['$valuePaise', 0]}, 0]}}}}, {$sort: {issueValue: -1}}]); return {columns: ['Item', 'Unit', 'Issued', 'Returned', 'Net consumed', 'Net value (₹)'], rows: r.map(x => [x._id.name, x._id.unit, qty(x.out), qty(x.back), qty(x.out - x.back), rupee(x.issueValue - x.returnValue)])}; }},
  wastage: {title: 'Wastage analysis', perm: 'inventory.valuation', build: async req => { const {from, to} = period(req); const w: any[] = await Inv.Wastage.find({createdAt: {$gte: from, $lte: to}}).sort({createdAt: 1}).lean(); return {columns: ['Date', 'Number', 'Item', 'Qty', 'Unit', 'Type', 'Source', 'Production order', 'Reason', 'Status', 'Cost (₹)', 'Reported by', 'Approved by'], rows: w.map(x => [dt(x.createdAt), x.number, x.itemName, qty(x.qtyM), x.unit, x.wastageType, x.source, x.productionNumber || '', x.reason, x.status, rupee(x.costPaise), x.reportedBy?.name, x.approvedBy?.name || ''])}; }},
  'manufacturing-cost': {title: 'Manufacturing cost by production order', perm: 'inventory.valuation', build: async req => { const {from, to} = period(req); const o: any[] = await Inv.Production.find({createdAt: {$gte: from, $lte: to}, status: {$nin: ['DRAFT', 'REJECTED']}}).lean(); return {columns: ['Order', 'Product', 'Status', 'Good units', 'Material (₹)', 'Labour (₹)', 'Overhead (₹)', 'Other (₹)', 'Total (₹)', 'Actual / unit (₹)', 'BOM estimate / unit (₹)'], rows: o.map(x => { const mat = x.lines.reduce((a: number, l: any) => a + l.issuedValuePaise - l.returnedValuePaise, 0); const tot = mat + x.labourCostPaise + x.overheadCostPaise + x.otherCostPaise; return [x.number, x.productName, x.status, x.completedQty, rupee(mat), rupee(x.labourCostPaise), rupee(x.overheadCostPaise), rupee(x.otherCostPaise), rupee(tot), x.completedQty ? rupee(Math.round(tot / x.completedQty)) : '', rupee(x.bomSnapshot?.estimatedPerUnitPaise)]; })}; }},
  'bom-costing': {title: 'BOM costing', perm: 'inventory.valuation', build: async () => { const {bomCost} = await import('./routes-production.js'); const b: any[] = await Inv.Bom.find({status: 'ACTIVE'}).lean(); const rows: unknown[][] = []; for (const x of b) { const c = await bomCost(x); rows.push([x.productName, x.version, rupee(c.materialPerUnitPaise), rupee(c.labourPerUnitPaise), rupee(c.overheadPerUnitPaise), rupee(c.otherPerUnitPaise), c.estimatedPerUnitPaise == null ? `incomplete: ${c.incomplete.join(', ')}` : rupee(c.estimatedPerUnitPaise)]); } return {columns: ['Product', 'BOM version', 'Material (₹)', 'Labour (₹)', 'Overhead (₹)', 'Other (₹)', 'Estimated / unit (₹)'], rows}; }},
  'stock-ledger': {title: 'Stock ledger', perm: 'inventory.valuation', build: async req => { const {from, to} = period(req); const l: any[] = await Inv.Ledger.find({createdAt: {$gte: from, $lte: to}}).sort({_id: 1}).limit(20000).lean(); return {columns: ['Txn', 'Date/time', 'Item', 'Type', 'Reference', 'Previous', 'In', 'Out', 'New', 'Unit', 'Unit cost (₹)', 'Value (₹)', 'User', 'Approved by', 'Reason'], rows: l.map(x => [x.txnNo, new Date(x.createdAt).toISOString(), x.itemName, x.type, x.refNumber || x.refId, qty(x.prevM), qty(x.qtyInM), qty(x.qtyOutM), qty(x.newM), x.unit, rupee(x.unitCostPaise), rupee(x.valuePaise), x.performedBy?.name, x.approvedBy?.name || '', x.reason || ''])}; }},
  adjustments: {title: 'Stock adjustments', perm: 'inventory.view', build: async req => { const {from, to} = period(req); const a: any[] = await Inv.Adjustment.find({createdAt: {$gte: from, $lte: to}}).sort({createdAt: 1}).lean(); return {columns: ['Date', 'Number', 'Item', 'Type', 'Before', 'Change', 'After', 'Unit', 'Reason', 'Status', 'Requested by', 'Approved by'], rows: a.map(x => [dt(x.createdAt), x.number, x.itemName, x.type, qty(x.currentM), qty(x.adjustM), qty(x.newM), x.unit, x.reason, x.status, x.requestedBy?.name, x.approvedBy?.name || ''])}; }},
  'count-variance': {title: 'Physical stock variance', perm: 'inventory.view', build: async req => { const {from, to} = period(req); const c: any[] = await Inv.Count.find({createdAt: {$gte: from, $lte: to}, status: {$in: ['SUBMITTED', 'POSTED']}}).sort({createdAt: 1}).lean(); return {columns: ['Count', 'Date', 'Status', 'Item', 'Unit', 'System', 'Counted', 'Difference', 'Reason'], rows: c.flatMap(x => x.lines.filter((l: any) => l.varianceM).map((l: any) => [x.number, dt(x.createdAt), x.status, l.itemName, l.unit, qty(l.systemM), qty(l.countedM), qty(l.varianceM), l.reason]))}; }},
};

export function registerReportRoutes(app: Express) {
  app.get('/api/inventory/dashboard', requireAuth, requirePerm('inventory.view'), route(async (req, res) => {
    const {from, to} = period(req);
    const canCost = (await permissionsFor(sessionUser(req).role)).includes('inventory.valuation');
    const v = await stockValues();
    const today = dayStart();
    const [pendingPOs, poApprovals, wastagePending, adjPending, countsPending, bomPending, prodPending, activeProd, suppliers, todayMoves, purchase, issues, returns, wastageAgg, recentMoves, recentGrns, recentProd, monthly] = await Promise.all([
      Inv.PurchaseOrder.countDocuments({status: {$in: OPEN_PO}}), Inv.PurchaseOrder.countDocuments({status: 'SUBMITTED'}),
      Inv.Wastage.countDocuments({status: 'PENDING'}), Inv.Adjustment.countDocuments({status: 'PENDING'}), Inv.Count.countDocuments({status: 'SUBMITTED'}), Inv.Bom.countDocuments({status: 'PENDING_APPROVAL'}), Inv.Production.countDocuments({status: 'SUBMITTED'}),
      Inv.Production.countDocuments({status: {$in: ACTIVE_PROD}}), Inv.Supplier.countDocuments({status: 'ACTIVE'}),
      Inv.Ledger.aggregate([{$match: {createdAt: {$gte: today}}}, {$group: {_id: '$type', n: {$sum: 1}}}]),
      sumLedger(['PURCHASE_RECEIPT'], from, to), sumLedger(['MATERIAL_ISSUE'], from, to), sumLedger(['MATERIAL_RETURN'], from, to),
      Inv.Wastage.aggregate([{$match: {status: 'APPROVED', approvedAt: {$gte: from, $lte: to}}}, {$group: {_id: null, v: {$sum: {$ifNull: ['$costPaise', 0]}}, n: {$sum: 1}, unknown: {$sum: {$cond: [{$eq: ['$costPaise', null]}, 1, 0]}}}}]),
      Inv.Ledger.find().sort({_id: -1}).limit(10).lean(), Inv.GoodsReceipt.find().sort({createdAt: -1}).limit(5).lean(), Inv.Production.find().sort({updatedAt: -1}).limit(5).lean(),
      Inv.Ledger.aggregate([{$match: {createdAt: {$gte: new Date(Date.now() - 183 * 86400000)}, type: {$in: ['PURCHASE_RECEIPT', 'MATERIAL_ISSUE', 'MATERIAL_RETURN', 'PRODUCTION_OUTPUT', 'WASTAGE']}}}, {$group: {_id: {m: {$dateToString: {format: '%Y-%m', date: '$createdAt', timezone: tz}}, t: '$type'}, v: {$sum: {$ifNull: ['$valuePaise', 0]}}, q: {$sum: {$add: ['$qtyInM', '$qtyOutM']}}}}]),
    ]);
    const prodOut: any[] = await Inv.Production.aggregate([{$unwind: '$outputs'}, {$match: {'outputs.postedAt': {$gte: from, $lte: to}}}, {$group: {_id: null, v: {$sum: '$outputs.valuePaise'}, units: {$sum: '$outputs.acceptedQty'}}}]);
    const months = [...new Set(monthly.map(m => m._id.m))].sort();
    const mv = (m: string, t: string) => monthly.find(x => x._id.m === m && x._id.t === t)?.v || 0;
    const low = v.items.filter(i => stockStatus(i) === 'LOW').length, out = v.items.filter(i => stockStatus(i) === 'OUT').length;
    const hide = (x: number | null) => canCost ? x : null;
    res.json({
      period: {from, to},
      metrics: {rawMaterialValuePaise: hide(v.raw.valuePaise), accessoriesValuePaise: hide(v.accessories.valuePaise), otherItemsValuePaise: hide(v.other.valuePaise), finishedGoodsValuePaise: hide(v.fg.valuePaise), rawMaterialItems: v.raw.items, accessoryItems: v.accessories.items, totalStockItems: v.items.length, finishedProducts: v.fg.items, finishedUnits: v.fg.units, pendingPurchases: pendingPOs, lowStock: low, outOfStock: out, activeProduction: activeProd, suppliers, pendingApprovals: poApprovals + wastagePending + adjPending + countsPending + bomPending + prodPending, approvals: {purchaseOrders: poApprovals, wastage: wastagePending, adjustments: adjPending, stockCounts: countsPending, boms: bomPending, production: prodPending}, uncostedStockItems: v.raw.uncosted + v.accessories.uncosted + v.other.uncosted + v.fg.uncosted},
      costControl: canCost ? {
        purchaseCostPaise: purchase.valuePaise, purchaseReceipts: purchase.count,
        materialConsumptionPaise: issues.valuePaise - returns.valuePaise,
        productionCostPaise: prodOut[0]?.v ?? 0, unitsProduced: prodOut[0]?.units ?? 0,
        wastageCostPaise: wastageAgg[0]?.v ?? 0, wastageRecords: wastageAgg[0]?.n ?? 0,
        stockValuePaise: v.raw.valuePaise + v.accessories.valuePaise + v.other.valuePaise + v.fg.valuePaise,
        incomplete: {uncostedMovements: purchase.uncostedMovements + issues.uncostedMovements + returns.uncostedMovements, uncostedWastage: wastageAgg[0]?.unknown ?? 0, uncostedStockItems: v.raw.uncosted + v.accessories.uncosted + v.other.uncosted + v.fg.uncosted},
      } : null,
      movementsToday: {total: todayMoves.reduce((a, x) => a + x.n, 0), byType: Object.fromEntries(todayMoves.map(x => [x._id, x.n]))},
      completeness: await completeness(),
      trends: canCost ? months.map(m => ({month: m, purchasesPaise: mv(m, 'PURCHASE_RECEIPT'), consumptionPaise: mv(m, 'MATERIAL_ISSUE') - mv(m, 'MATERIAL_RETURN'), productionPaise: mv(m, 'PRODUCTION_OUTPUT'), wastagePaise: mv(m, 'WASTAGE')})) : [],
      recentMovements: recentMoves.map((x: any) => ({_id: x._id, txnNo: x.txnNo, at: x.createdAt, itemName: x.itemName, type: x.type, qtyInM: x.qtyInM, qtyOutM: x.qtyOutM, unit: x.unit, refNumber: x.refNumber})),
      recentPurchases: recentGrns.map((g: any) => ({_id: g._id, number: g.number, supplierName: g.supplierName, at: g.createdAt, valuePaise: canCost ? g.totalValuePaise : null, lines: g.lines.length})),
      recentProduction: recentProd.map((o: any) => ({_id: o._id, number: o.number, productName: o.productName, status: o.status, progress: progress(o)})),
    });
  }));

  app.get('/api/inventory/completeness', requireAuth, requirePerm('inventory.view'), route(async (_req, res) => { res.json(await completeness()); }));
  app.get('/api/inventory/alerts', requireAuth, requirePerm('inventory.view'), route(async (_req, res) => {
    const [suggestions, overduePOs, shortages] = await Promise.all([
      reorderSuggestions(),
      Inv.PurchaseOrder.find({status: {$in: ['APPROVED', 'PARTIALLY_RECEIVED']}, expectedDate: {$lt: new Date()}}).select('number supplierName expectedDate status').lean(),
      Inv.Production.find({status: 'APPROVED'}).select('number productName lines').lean(),
    ]);
    const items: any[] = await Inv.Item.find({_id: {$in: shortages.flatMap((o: any) => o.lines.map((l: any) => l.itemId))}}).select('onHandM reservedM').lean();
    const im = new Map(items.map(i => [String(i._id), i.onHandM - i.reservedM]));
    res.json({reorder: suggestions, overduePurchaseOrders: overduePOs, productionShortages: shortages.map((o: any) => ({number: o.number, productName: o.productName, _id: o._id, short: o.lines.filter((l: any) => (im.get(l.itemId) ?? 0) < l.requiredM - l.reservedM).map((l: any) => ({itemName: l.itemName, unit: l.unit, neededM: l.requiredM - l.reservedM, availableM: im.get(l.itemId) ?? 0}))})).filter(o => o.short.length)});
  }));
  // Groups reorder suggestions into DRAFT purchase orders per preferred supplier. Never submits or sends anything.
  app.post('/api/inventory/alerts/purchase-drafts', requireAuth, requirePerm('purchase.create'), route(async (req, res) => {
    const {itemIds} = parse(z.object({itemIds: z.array(z.string()).min(1).max(200)}), req.body);
    const r = await mutate(req, 'REORDER_DRAFTS', async ({session, actor}) => {
      const sugg = (await reorderSuggestions()).filter(s => itemIds.includes(s.itemId));
      const skipped = sugg.filter(s => !s.preferredSupplierId || !s.suggestedM).map(s => `${s.name}: ${!s.preferredSupplierId ? 'no preferred supplier' : 'set a maximum stock or reorder quantity'}`);
      const bySupplier = new Map<string, typeof sugg>();
      for (const s of sugg.filter(x => x.preferredSupplierId && x.suggestedM)) bySupplier.set(s.preferredSupplierId!, [...(bySupplier.get(s.preferredSupplierId!) || []), s]);
      const created: string[] = [];
      for (const [supplierId, list] of bySupplier) {
        const supplier: any = await Inv.Supplier.findById(supplierId).session(session).lean();
        if (!supplier || supplier.status !== 'ACTIVE') { skipped.push(...list.map(s => `${s.name}: preferred supplier inactive`)); continue; }
        const lines = await buildLines(list.map(s => ({itemId: s.itemId, unit: s.unit, qty: s.suggestedM! / 1000, rateRupees: (s.lastRatePaise || 0) / 100, discountPct: 0, gstPct: 0})), session);
        const number = await nextNumber('PO', session);
        await Inv.PurchaseOrder.create([{number, supplierId, supplierName: supplier.name, status: 'DRAFT', orderDate: new Date(), paymentTermsDays: supplier.paymentTermsDays, interState: false, lines, freightPaise: 0, otherChargesPaise: 0, ...totals(lines, 0, 0, false), notes: 'Draft created from low-stock alerts. Check quantities, rates and GST before submitting.', source: 'REORDER', createdBy: actor}], {session});
        created.push(number);
      }
      return {created, skipped};
    });
    res.json(r);
  }));

  app.get('/api/inventory/reports', requireAuth, requirePerm('reports.view'), route(async (_req, res) => { res.json(Object.entries(REPORTS).map(([key, r]) => ({key, title: r.title, needsValuation: r.perm === 'inventory.valuation'}))); }));
  app.get('/api/inventory/reports/:key', requireAuth, requirePerm('reports.view'), route(async (req, res) => {
    const rep = REPORTS[String(req.params.key)];
    if (!rep) fail(404, 'Unknown report');
    if (!(await permissionsFor(sessionUser(req).role)).includes(rep.perm)) fail(403, 'You do not have permission for this report');
    const data = await rep.build(req);
    if (req.query.format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${String(req.params.key)}-${new Date().toISOString().slice(0, 10)}.csv"`);
      return res.send('﻿' + [data.columns, ...data.rows].map(r => r.map(csvCell).join(',')).join('\r\n'));
    }
    res.json({title: rep.title, ...data, generatedAt: new Date()});
  }));
  app.get('/api/inventory/categories/all-names', requireAuth, requirePerm('inventory.view'), route(async (_req, res) => { res.json(await ErpModels.Category.find({scope: 'inventory'}).select('name itemType').lean()); }));
}
