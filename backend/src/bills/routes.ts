// Bills (admin): GST tax invoices with payment status.
//
// A BILL is an order that reached the sales policy's billing stage (COUNTED: approved-or-later, or
// dispatched-or-later), dated on its countedDate. An order cancelled after approval is a CANCELLED bill.
// Per-bill money (total, paid, due, payment status) comes from orderFacts(), the same function behind the
// Order desk and Admin Insights, and every total below goes through billTotals(): one definition per number.
//
// Not recorded in this app (so never invented here): due dates / credit terms, line or bill discounts,
// customer GSTIN / state. "Overdue" therefore means "money still due on a bill older than OVERDUE_DAYS",
// and the GST split shown on a bill is ESTIMATED by backing out each design's GST rate from the
// GST-inclusive price, assuming an intra-state (CGST + SGST) sale.
import type {Express, Request} from 'express';
import {z} from 'zod';
import {permissionsFor, requireAuth, sessionUser} from '../auth.js';
import {Inv} from '../inventory/models.js';
import {fail, parse, route} from '../inventory/http.js';
import {Models} from '../models.js';
import {Sales} from '../sales/models.js';
import {COUNTED, type Data, countedDate, daysIn, loadData, paise, previousRange, today, ymd} from '../sales/routes.js';
import {bucketOf, buckets, context, keyOf, orderFacts, sum, type Bucket, type Facts} from '../overview/routes.js';

/** A bill with money still due becomes "overdue" this many days after its bill date. */
export const OVERDUE_DAYS = 30;
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date');

export type Bill = Facts & {billDate: string; billed: boolean; cancelled: boolean; ageDays: number; overdue: boolean; invoiceNumber: string | null; qty: number};

/** Every bill (counted or cancelled-after-approval order) with its facts. */
export async function allBills(d: Data) {
  const ctx = await context(d);
  const invoices: any[] = await Models.invoices.find().select('id number').lean();
  const invNo = new Map(invoices.map(i => [i.id, i.number]));
  const now = today();
  const bills: Bill[] = [];
  for (const o of d.orders) {
    const billed = COUNTED[d.policy].includes(o.status);
    const cancelled = o.status === 'Cancelled' && !!o.approvedAt;
    if (!billed && !cancelled) continue;
    const f = orderFacts(d, ctx, o);
    const billDate = billed ? ymd(countedDate(o, d.policy)) : ymd(o.approvedAt);
    const ageDays = daysIn(billDate, now) - 1;
    bills.push({...f, billDate, billed, cancelled, ageDays, overdue: billed && f.duePaise > 0 && ageDays > OVERDUE_DAYS, invoiceNumber: invNo.get(o.id) || null, qty: f.qty});
  }
  return {bills, ctx};
}

/**
 * The one definition for bill totals. Cancelled bills count as bills but carry no money.
 * billed = Σ bill total · collected = Σ verified payments on these bills · due = Σ (total − collected).
 */
export function billTotals(bills: Bill[]) {
  const live = bills.filter(b => b.billed);
  const billedPaise = sum(live.map(b => b.totalPaise));
  const overdue = live.filter(b => b.overdue);
  return {
    count: bills.length, activeCount: live.length, billedPaise,
    collectedPaise: sum(live.map(b => b.paidPaise)), duePaise: sum(live.map(b => b.duePaise)),
    avgPaise: live.length ? Math.round(billedPaise / live.length) : 0,
    overduePaise: sum(overdue.map(b => b.duePaise)), overdueCount: overdue.length,
  };
}

const filterShape = {
  from: isoDay.optional(), to: isoDay.optional(), q: z.string().trim().max(100).optional(),
  tab: z.enum(['all', 'PAID', 'PARTIAL', 'UNPAID', 'overdue', 'cancelled']).default('all'),
  salesman: z.string().max(80).optional(), customer: z.string().max(80).optional(),
  min: z.coerce.number().min(0).optional(), max: z.coerce.number().min(0).optional(),
};
const listQuery = z.object({
  ...filterShape,
  sort: z.enum(['billDate', 'number', 'customer', 'total', 'paid', 'due', 'items']).default('billDate'),
  dir: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(200).default(25),
  format: z.enum(['json', 'csv']).default('json'),
});
type Filter = z.infer<z.ZodObject<typeof filterShape>>;
const clean = (req: Request) => Object.fromEntries(Object.entries(req.query).filter(([, v]) => v !== ''));

/** Everything except the payment tab. Tab counts are computed on this so each tab shows what it would hold. */
function baseFilter(bills: Bill[], q: Filter, range?: {from?: string; to?: string}) {
  const from = range ? range.from : q.from, to = range ? range.to : q.to;
  let out = bills;
  if (from) out = out.filter(b => b.billDate >= from);
  if (to) out = out.filter(b => b.billDate <= to);
  if (q.salesman) out = out.filter(b => b.salesmanId === q.salesman);
  if (q.customer) out = out.filter(b => b.customerId === q.customer);
  if (q.min != null) out = out.filter(b => b.totalPaise >= Math.round(q.min! * 100));
  if (q.max != null) out = out.filter(b => b.totalPaise <= Math.round(q.max! * 100));
  if (q.q) {
    const s = q.q.toLowerCase();
    out = out.filter(b => b.number.toLowerCase().includes(s) || (b.invoiceNumber || '').toLowerCase().includes(s) || b.customerName.toLowerCase().includes(s) || b.customerPhone.includes(s) || b.itemNames.some((n: string) => n.toLowerCase().includes(s)));
  }
  return out;
}
const TAB: Record<Filter['tab'], (b: Bill) => boolean> = {
  all: () => true, PAID: b => b.billed && b.payStatus === 'PAID', PARTIAL: b => b.billed && b.payStatus === 'PARTIAL',
  UNPAID: b => b.billed && b.payStatus === 'UNPAID', overdue: b => b.overdue, cancelled: b => b.cancelled,
};
const applyTab = (bills: Bill[], tab: Filter['tab']) => bills.filter(TAB[tab]);

async function scope(req: Request, d: Data) {
  const me = sessionUser(req);
  if (me.role === 'salesman') d.orders = d.orders.filter(o => o.createdBy === me.id);
  else if (!(await permissionsFor(me.role)).includes('reports.view')) fail(403, 'You do not have permission for this action');
  return me;
}

/** Bills grouped into chart buckets by bill date (hour of approval for a single day). */
function series(bills: Bill[], from: string, to: string, b: Bucket, d: Data) {
  const keys = buckets(from, to, b), idx = new Map(keys.map((k, i) => [k, i]));
  const billed = keys.map(() => 0), collected = keys.map(() => 0), count = keys.map(() => 0);
  const byId = new Map(d.orders.map(o => [o.id, o]));
  for (const x of bills.filter(x => x.billed)) {
    const o = byId.get(x.id);
    const i = idx.get(b === 'hour' ? keyOf(countedDate(o, d.policy), b) : keyOf(x.billDate, b));
    if (i == null) continue;
    billed[i] += x.totalPaise; collected[i] += x.paidPaise; count[i]++;
  }
  return {keys, billed, collected, count};
}

const GST_FALLBACK_BPS = 1800; // HSN 9403 metal furniture; used only when a design has no GST rate recorded

export function registerBillRoutes(app: Express) {
  app.get('/api/admin/bills', requireAuth, route(async (req, res) => {
    const q = parse(listQuery, clean(req));
    const d = await loadData(); await scope(req, d);
    const {bills, ctx} = await allBills(d);
    const base = baseFilter(bills, q);
    const tabs = Object.fromEntries((Object.keys(TAB) as Filter['tab'][]).map(t => [t, applyTab(base, t).length]));
    const rows = applyTab(base, q.tab);
    const dir = q.dir === 'asc' ? 1 : -1;
    const key: Record<string, (b: Bill) => string | number> = {billDate: b => b.billDate + b.createdAt, number: b => b.invoiceNumber || b.number, customer: b => b.customerName.toLowerCase(), total: b => b.totalPaise, paid: b => b.paidPaise, due: b => b.duePaise, items: b => b.lines};
    rows.sort((a, b) => { const x = key[q.sort](a), y = key[q.sort](b); return (x < y ? -1 : x > y ? 1 : 0) * dir; });
    const totals = billTotals(rows);
    if (q.format === 'csv') {
      const esc = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
      const out = [['Bill no.', 'Bill date', 'Customer', 'Phone', 'Salesman', 'Items', 'Qty', 'Total (₹)', 'Paid (₹)', 'Due (₹)', 'Payment status', 'Order status', 'Overdue'],
        ...rows.map(b => [b.invoiceNumber || b.number, b.billDate, b.customerName, b.customerPhone, b.salesmanName || '', b.lines, b.qty, b.totalPaise / 100, b.paidPaise / 100, b.duePaise / 100, b.cancelled ? 'Cancelled' : b.payStatus, b.status, b.overdue ? 'Yes' : '']),
        ['Total', '', '', '', '', '', '', totals.billedPaise / 100, totals.collectedPaise / 100, totals.duePaise / 100, '', '', '']];
      res.set('Content-Type', 'text/csv; charset=utf-8').set('Content-Disposition', `attachment; filename="bills-${today()}.csv"`).send('﻿' + out.map(r => r.map(esc).join(',')).join('\r\n'));
      return;
    }
    const start = (q.page - 1) * q.limit;
    const customers = new Map<string, string>(); for (const b of bills) customers.set(b.customerId, b.customerName);
    res.json({
      items: rows.slice(start, start + q.limit), total: rows.length, page: q.page, limit: q.limit,
      totals, tabs, overdueDays: OVERDUE_DAYS, policy: d.policy,
      salesmen: ctx.userList.filter(u => bills.some(b => b.salesmanId === u.id)).map(u => ({id: u.id, name: u.name})),
      customers: [...customers].map(([id, name]) => ({id, name})).sort((a, b) => a.name.localeCompare(b.name)),
    });
  }));

  app.get('/api/admin/bills/insights', requireAuth, route(async (req, res) => {
    const q = parse(z.object(filterShape), clean(req));
    const d = await loadData(); await scope(req, d);
    const {bills} = await allBills(d);
    const rows = applyTab(baseFilter(bills, q), q.tab);
    const totals = billTotals(rows);
    const ranged = q.from && q.to;
    const prev = ranged ? previousRange(q.from!, q.to!) : null;
    const prevRows = prev ? applyTab(baseFilter(bills, q, prev), q.tab) : null;
    const b = ranged ? bucketOf(q.from!, q.to!) : null;
    const cur = b ? series(rows, q.from!, q.to!, b, d) : null;
    const old = b && prev && prevRows ? series(prevRows, prev.from, prev.to, b, d) : null;
    const live = rows.filter(x => x.billed);
    const byCustomer = new Map<string, {id: string; name: string; duePaise: number; bills: number}>();
    for (const x of live.filter(x => x.duePaise > 0)) {
      const c = byCustomer.get(x.customerId) || {id: x.customerId, name: x.customerName, duePaise: 0, bills: 0};
      c.duePaise += x.duePaise; c.bills++; byCustomer.set(x.customerId, c);
    }
    const bySalesman = new Map<string, {id: string | null; name: string; billedPaise: number; collectedPaise: number}>();
    for (const x of live) {
      const k = x.salesmanId || '—';
      const s = bySalesman.get(k) || {id: x.salesmanId, name: x.salesmanName || 'Unassigned', billedPaise: 0, collectedPaise: 0};
      s.billedPaise += x.totalPaise; s.collectedPaise += x.paidPaise; bySalesman.set(k, s);
    }
    const age = (lo: number, hi: number) => { const xs = live.filter(x => x.duePaise > 0 && x.ageDays >= lo && x.ageDays <= hi); return {duePaise: sum(xs.map(x => x.duePaise)), bills: xs.length}; };
    res.json({
      period: ranged ? {from: q.from, to: q.to, bucket: b} : null, previous: prev,
      totals, previousTotals: prevRows ? billTotals(prevRows) : null,
      series: cur && {keys: cur.keys, billed: cur.billed, collected: cur.collected, count: cur.count, previousBilled: old?.billed || null, previousCollected: old?.collected || null},
      status: {PAID: live.filter(x => x.payStatus === 'PAID').length, PARTIAL: live.filter(x => x.payStatus === 'PARTIAL').length, UNPAID: live.filter(x => x.payStatus === 'UNPAID').length, cancelled: rows.filter(x => x.cancelled).length},
      statusValue: {PAID: sum(live.filter(x => x.payStatus === 'PAID').map(x => x.totalPaise)), PARTIAL: sum(live.filter(x => x.payStatus === 'PARTIAL').map(x => x.totalPaise)), UNPAID: sum(live.filter(x => x.payStatus === 'UNPAID').map(x => x.totalPaise))},
      topCustomersByDue: [...byCustomer.values()].sort((a, c) => c.duePaise - a.duePaise).slice(0, 5),
      salesmen: [...bySalesman.values()].sort((a, c) => c.billedPaise - a.billedPaise).slice(0, 8),
      ageing: [{bucket: '0-7', ...age(0, 7)}, {bucket: '8-30', ...age(8, 30)}, {bucket: '31-60', ...age(31, 60)}, {bucket: '60+', ...age(61, 100000)}],
      overdueDays: OVERDUE_DAYS,
    });
  }));

  // ---------- New bill form data (read-only) ----------
  /** Sellable designs for the item search: design no., price (GST inclusive), GST rate, available stock, image. */
  app.get('/api/admin/bills/catalogue', requireAuth, route(async (req, res) => {
    const d = await loadData(); await scope(req, d);
    const products: any[] = await Models.products.find({status: 'active'}).select('id name sku category unit price stock reservedStock').lean();
    const profiles: any[] = await Inv.ProductProfile.find({productId: {$in: products.map(p => p.id)}}).select('productId design productCode gstRateBps images').lean();
    const prof = new Map(profiles.map(p => [p.productId, p]));
    res.json(products.map(p => {
      const f = prof.get(p.id);
      return {id: p.id, name: p.name, sku: p.sku, category: p.category, unit: p.unit || 'piece', design: f?.design || f?.productCode || '', pricePaise: paise(p.price), gstRateBps: f?.gstRateBps ?? null, available: Math.max(0, (p.stock || 0) - (p.reservedStock || 0)), image: f?.images?.[0]?.url || null};
    }).sort((a, b) => (a.design || a.name).localeCompare(b.design || b.name)));
  }));
  /** Customers for the bill: balance, assigned salesman, last bill date. */
  app.get('/api/admin/bills/customers', requireAuth, route(async (req, res) => {
    const d = await loadData(); await scope(req, d);
    const {bills, ctx} = await allBills(d);
    const last = new Map<string, string>();
    for (const b of bills.filter(b => b.billed)) if ((last.get(b.customerId) || '') < b.billDate) last.set(b.customerId, b.billDate);
    res.json(d.customers.map((c: any) => ({id: c.id, name: c.name, phone: c.phone || '', address: c.address || '', balancePaise: paise(c.balance || 0), salesmanName: ctx.users.get(c.assignedSalesmanId || c.createdBy)?.name || null, lastBillDate: last.get(c.id) || null})).sort((a: any, b: any) => a.name.localeCompare(b.name)));
  }));

  app.get('/api/admin/bills/:id', requireAuth, route(async (req, res) => {
    const d = await loadData(); const me = await scope(req, d);
    const {bills, ctx} = await allBills(d);
    const found = bills.find(b => b.id === req.params.id);
    if (!found) fail(404, 'Bill not found');
    const bill = found as Bill;
    const o = d.orders.find(x => x.id === bill.id);
    const ids = o.items.map((i: any) => i.productId);
    const [products, profiles, timeline] = await Promise.all([
      Models.products.find({id: {$in: ids}}).select('id sku').lean() as Promise<any[]>,
      Inv.ProductProfile.find({productId: {$in: ids}}).select('productId design productCode hsnCode gstRateBps').lean() as Promise<any[]>,
      Sales.Activity.find({orderId: bill.id}).sort({at: 1}).lean() as Promise<any[]>,
    ]);
    const pm = new Map(products.map(p => [p.id, p])), prof = new Map(profiles.map(p => [p.productId, p]));
    // GST is included in the price: taxable = total × 100 / (100 + rate). Estimated, split CGST/SGST equally.
    const lines = o.items.map((l: any) => {
      const p = prof.get(l.productId), rateBps = p?.gstRateBps ?? null, totalPaise = paise(l.qty * l.price);
      const r = rateBps ?? GST_FALLBACK_BPS, taxablePaise = Math.round(totalPaise * 10000 / (10000 + r)), gstPaise = totalPaise - taxablePaise;
      return {productId: l.productId, name: l.name, design: p?.design || p?.productCode || '', sku: pm.get(l.productId)?.sku || '', hsn: p?.hsnCode || '', qty: l.qty, unit: l.unit || '', ratePaise: paise(l.price), totalPaise, gstRateBps: r, gstRateKnown: rateBps != null, taxablePaise, cgstPaise: Math.floor(gstPaise / 2), sgstPaise: gstPaise - Math.floor(gstPaise / 2)};
    });
    const customer: any = d.customers.find((c: any) => c.id === bill.customerId) || null;
    const perms = await permissionsFor(me.role);
    res.json({
      ...bill, lines,
      tax: {taxablePaise: sum(lines.map((l: any) => l.taxablePaise)), cgstPaise: sum(lines.map((l: any) => l.cgstPaise)), sgstPaise: sum(lines.map((l: any) => l.sgstPaise)), estimated: true, missingRates: lines.filter((l: any) => !l.gstRateKnown).length},
      customer: customer && {id: customer.id, name: customer.name, phone: customer.phone || '', address: customer.address || '', balancePaise: paise(customer.balance || 0)},
      payments: d.payments.filter(p => p.orderId === bill.id).sort((a, b) => String(a.paymentDate).localeCompare(String(b.paymentDate))).map(p => ({id: String(p._id), amountPaise: paise(p.amount), method: p.method, status: p.status, paymentDate: p.paymentDate, reference: p.reference || '', recordedBy: ctx.users.get(p.recordedBy)?.name || ''})),
      timeline: timeline.map(a => ({at: a.at, type: a.type, by: a.actor?.name || null, description: a.description})),
      stamps: {createdAt: o.createdAt, approvedAt: o.approvedAt || null, dispatchedAt: o.dispatchedAt || null, deliveredAt: o.deliveredAt || null, reason: o.reason || null},
      can: {recordPayment: bill.billed && bill.duePaise > 0 && perms.includes('payment.record'), cancel: me.role !== 'salesman' && ['Approved', 'Processing'].includes(o.status)},
    });
  }));
}
