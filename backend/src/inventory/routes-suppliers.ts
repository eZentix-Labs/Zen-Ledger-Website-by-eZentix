import type {Express} from 'express';
import mongoose from 'mongoose';
import {z} from 'zod';
import {requireAuth, requirePerm} from '../auth.js';
import {Inv} from './models.js';
import {escapeRegex, fail, paging, parse, route, sendPage} from './http.js';
import {mutate, nextNumber} from './txn.js';

const text = (max = 200) => z.string().trim().max(max);
export const SUPPLIER_CATEGORIES = ['STEEL', 'HARDWARE', 'PAINT', 'PACKAGING', 'CHEMICALS', 'GENERAL'] as const;
const gstin = z.string().trim().toUpperCase().regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, 'GSTIN must be 15 characters in the standard format').or(z.literal(''));
const body = z.object({
  supplierCode: text(20).optional().default(''), name: text(160).min(2), category: z.enum(SUPPLIER_CATEGORIES).default('GENERAL'),
  contactPerson: text(120).optional().default(''), phone: z.string().trim().regex(/^[0-9+\-\s]{6,20}$/, 'Enter a valid phone number'),
  email: z.string().trim().email().or(z.literal('')).optional().default(''), address: text(500).optional().default(''),
  state: text(60).optional().default(''), gstin: gstin.optional().default(''),
  paymentTermsDays: z.number().int().min(0).max(365).default(0),
  bankName: text(120).optional().default(''), bankAccount: text(40).optional().default(''), ifsc: text(20).optional().default(''),
  notes: text(1000).optional().default(''),
});

/** Running balance: + = we owe the supplier. */
export async function supplierBalance(supplierId: string) {
  const [r] = await Inv.SupplierLedger.aggregate([{$match: {supplierId}}, {$group: {_id: null, total: {$sum: '$amountPaise'}}}]);
  return r?.total ?? 0;
}

export function registerSupplierRoutes(app: Express) {
  app.get('/api/inventory/suppliers', requireAuth, requirePerm('inventory.view'), route(async (req, res) => {
    const {page, limit, skip} = paging(req);
    const filter: any = {};
    if (req.query.status !== 'all') filter.status = req.query.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE';
    if (req.query.category) filter.category = String(req.query.category);
    const q = String(req.query.q || '').trim();
    if (q) filter.$or = ['name', 'supplierCode', 'phone', 'gstin', 'contactPerson'].map(f => ({[f]: {$regex: escapeRegex(q), $options: 'i'}}));
    const [total, docs] = await Promise.all([Inv.Supplier.countDocuments(filter), Inv.Supplier.find(filter).sort({name: 1}).skip(skip).limit(limit).lean()]);
    const ids = docs.map((d: any) => String(d._id));
    const [balances, pending] = await Promise.all([
      Inv.SupplierLedger.aggregate([{$match: {supplierId: {$in: ids}}}, {$group: {_id: '$supplierId', total: {$sum: '$amountPaise'}}}]),
      Inv.Bill.aggregate([{$match: {supplierId: {$in: ids}, status: {$in: ['POSTED', 'PARTIALLY_PAID']}}}, {$group: {_id: '$supplierId', count: {$sum: 1}}}]),
    ]);
    const bm = new Map(balances.map(b => [b._id, b.total])), pm = new Map(pending.map(b => [b._id, b.count]));
    sendPage(res, docs.map((d: any) => ({...d, _id: String(d._id), outstandingPaise: bm.get(String(d._id)) ?? 0, pendingBills: pm.get(String(d._id)) ?? 0})), total, page, limit);
  }));

  app.get('/api/inventory/suppliers/:id', requireAuth, requirePerm('inventory.view'), route(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) fail(404, 'Supplier not found');
    const s: any = await Inv.Supplier.findById(req.params.id).lean();
    if (!s) fail(404, 'Supplier not found');
    const id = String(s._id);
    const [ledger, pos, bills, payments, returns, items] = await Promise.all([
      Inv.SupplierLedger.find({supplierId: id}).sort({date: 1, createdAt: 1}).lean(),
      Inv.PurchaseOrder.find({supplierId: id}).sort({createdAt: -1}).limit(50).select('number status totalPaise orderDate expectedDate').lean(),
      Inv.Bill.find({supplierId: id}).sort({invoiceDate: -1}).limit(50).lean(),
      Inv.SupplierPayment.find({supplierId: id}).sort({date: -1}).limit(50).lean(),
      Inv.PurchaseReturn.find({supplierId: id}).sort({createdAt: -1}).limit(50).lean(),
      Inv.Item.find({preferredSupplierId: id}).select('name code stockUnit').lean(),
    ]);
    let running = 0;
    const statement = ledger.map((e: any) => ({...e, balancePaise: (running += e.amountPaise)}));
    const now = Date.now();
    const sum = (types: string[]) => ledger.filter((e: any) => types.includes(e.type)).reduce((a: number, e: any) => a + e.amountPaise, 0);
    res.json({
      ...s, _id: id, statement, purchaseOrders: pos, bills, payments, returns, suppliedItems: items,
      summary: {
        openingPaise: sum(['OPENING']), purchasesPaise: sum(['BILL']), returnsPaise: -sum(['RETURN']), paymentsPaise: -sum(['PAYMENT', 'PAYMENT_VOID']), outstandingPaise: running,
        pendingBills: bills.filter((b: any) => ['POSTED', 'PARTIALLY_PAID'].includes(b.status)).length,
        overdueBills: bills.filter((b: any) => ['POSTED', 'PARTIALLY_PAID'].includes(b.status) && b.dueDate && new Date(b.dueDate).getTime() < now).length,
      },
    });
  }));

  app.post('/api/inventory/suppliers', requireAuth, requirePerm('supplier.manage'), route(async (req, res) => {
    const b = parse(body.extend({openingBalanceRupees: z.number().finite().min(-1e10).max(1e10).optional().default(0)}), req.body);
    const r = await mutate(req, 'SUPPLIER_CREATE', async ({session, actor}) => {
      const phone = b.phone.replace(/\D/g, '');
      const dup: any = await Inv.Supplier.findOne({$or: [{name: {$regex: `^${escapeRegex(b.name)}$`, $options: 'i'}}, ...(b.gstin ? [{gstin: b.gstin}] : []), {phone: {$regex: `${escapeRegex(phone.slice(-10))}$`}}]}).session(session).lean();
      if (dup) fail(409, `A supplier with the same ${dup.gstin && dup.gstin === b.gstin ? 'GSTIN' : dup.name.toLowerCase() === b.name.toLowerCase() ? 'name' : 'phone number'} already exists (${dup.supplierCode} ${dup.name})`);
      const code = b.supplierCode ? b.supplierCode.toUpperCase() : await nextNumber('SUP', session, false);
      if (await Inv.Supplier.exists({supplierCode: code}).session(session)) fail(409, `Supplier code ${code} already exists`);
      const openingBalancePaise = Math.round(b.openingBalanceRupees * 100);
      const [s] = await Inv.Supplier.create([{...b, gstin: b.gstin || undefined, supplierCode: code, openingBalancePaise}], {session});
      if (openingBalancePaise) await Inv.SupplierLedger.create([{supplierId: String(s._id), date: new Date(), type: 'OPENING', amountPaise: openingBalancePaise, notes: 'Opening balance', key: `OPENING:${s._id}`, createdBy: actor}], {session});
      return {id: String(s._id), supplierCode: code};
    });
    res.status(r.replayed ? 200 : 201).json(r);
  }));

  app.patch('/api/inventory/suppliers/:id', requireAuth, requirePerm('supplier.manage'), route(async (req, res) => {
    const b = parse(body.extend({revision: z.number().int().min(0)}), req.body);
    const {revision, supplierCode, ...rest} = b;
    if (b.gstin && await Inv.Supplier.exists({gstin: b.gstin, _id: {$ne: req.params.id}})) fail(409, 'Another supplier already has this GSTIN');
    const s = await Inv.Supplier.findOneAndUpdate({_id: req.params.id, revision}, {$set: {...rest, gstin: rest.gstin || undefined}, $inc: {revision: 1}}, {returnDocument: 'after', runValidators: true}).lean();
    if (!s) fail(409, 'This supplier was changed by someone else, or no longer exists. Refresh and try again.');
    res.json(s);
  }));

  app.post('/api/inventory/suppliers/:id/status', requireAuth, requirePerm('supplier.manage'), route(async (req, res) => {
    const {status} = parse(z.object({status: z.enum(['ACTIVE', 'INACTIVE'])}), req.body);
    if (status === 'INACTIVE' && await Inv.PurchaseOrder.exists({supplierId: req.params.id, status: {$in: ['DRAFT', 'SUBMITTED', 'APPROVED', 'PARTIALLY_RECEIVED']}})) fail(409, 'This supplier has open purchase orders');
    const r = await Inv.Supplier.updateOne({_id: req.params.id}, {$set: {status}, $inc: {revision: 1}});
    if (!r.matchedCount) fail(404, 'Supplier not found');
    res.json({ok: true});
  }));

  app.delete('/api/inventory/suppliers/:id', requireAuth, requirePerm('supplier.manage'), route(async (req, res) => {
    const id = String(req.params.id);
    if (await Inv.SupplierLedger.exists({supplierId: id, type: {$ne: 'OPENING'}}) || await Inv.PurchaseOrder.exists({supplierId: id})) fail(409, 'Suppliers with purchase history cannot be deleted. Deactivate instead.');
    const r = await Inv.Supplier.deleteOne({_id: id});
    if (!r.deletedCount) fail(404, 'Supplier not found');
    await Inv.SupplierLedger.deleteMany({supplierId: id, type: 'OPENING'});
    res.json({ok: true});
  }));
}
