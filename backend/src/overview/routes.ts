// Admin Overview + Order desk aggregates.
// "One definition per number": every money/count figure on the Overview, the Orders KPI strip, the Orders
// table footer, the Orders mini-charts and the order drawer comes from orderFacts() and the sales-policy
// helpers already used by salesman targets/insights (sales/routes.ts). Nothing here writes data.
import type {Express, Request} from 'express';
import {z} from 'zod';
import {permissionsFor, requireAuth, requirePerm, sessionUser} from '../auth.js';
import {Models} from '../models.js';
import {Inv} from '../inventory/models.js';
import {Sales} from '../sales/models.js';
import {fail, parse, route} from '../inventory/http.js';
import {COUNTED, Data, SLIP_DAYS, countedDate, daysIn, hourOf, inRange, loadData, paise, previousRange, shiftIso, targetProgress, today, tz, ymd} from '../sales/routes.js';
import {transitions} from '../order-rules.js';

/** An order still Pending after this many hours, or Approved/Processing after DELAY_ACTIVE_H, is "delayed". */
export const DELAY_PENDING_H = 24, DELAY_ACTIVE_H = 72;
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date').refine(s => { const t = Date.parse(s + 'T00:00:00Z'); return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s; }, 'Not a real date');
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const dowOf = (d: Date | string) => DOW.indexOf(new Intl.DateTimeFormat('en-GB', {timeZone: tz, weekday: 'short'}).format(new Date(d)));
export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export type PayStatus = 'PAID' | 'PARTIAL' | 'UNPAID' | 'NA';
/** Per-order facts. Due exists only for counted (approved-or-later) orders; rejected/cancelled/pending owe nothing yet. */
export function orderFacts(d: Data, ctx: {paid: Map<string, number>; methods: Map<string, Set<string>>; users: Map<string, any>; phones: Map<string, string>}, o: any, now = Date.now()) {
  const totalPaise = paise(o.total), paidPaise = ctx.paid.get(o.id) || 0;
  const counted = COUNTED[d.policy].includes(o.status);
  const duePaise = counted ? Math.max(0, totalPaise - paidPaise) : 0;
  const payStatus: PayStatus = !counted ? 'NA' : paidPaise >= totalPaise && totalPaise > 0 ? 'PAID' : paidPaise > 0 ? 'PARTIAL' : 'UNPAID';
  const since = o.status === 'Pending' ? o.createdAt : ['Approved', 'Processing'].includes(o.status) ? (o.approvedAt || o.createdAt) : null;
  const ageH = since ? (now - new Date(since).getTime()) / 3600000 : 0;
  const delayed = since != null && ageH > (o.status === 'Pending' ? DELAY_PENDING_H : DELAY_ACTIVE_H);
  const s = o.createdBy ? ctx.users.get(o.createdBy) : null;
  return {
    id: o.id, number: o.id.slice(-10).toUpperCase(), createdAt: new Date(o.createdAt).toISOString(), updatedAt: o.updatedAt ? new Date(o.updatedAt).toISOString() : null, status: o.status,
    customerId: o.customerId, customerName: o.customerName, customerPhone: ctx.phones.get(o.customerId) || '',
    salesmanId: o.createdBy || null, salesmanName: s?.name || null, salesmanRole: s?.role || null,
    lines: o.items.length, qty: sum(o.items.map((i: any) => i.qty)), firstItem: o.items[0]?.name || '', itemNames: o.items.map((i: any) => i.name),
    totalPaise, paidPaise, duePaise, payStatus, methods: [...(ctx.methods.get(o.id) || [])],
    counted, countedOn: counted ? ymd(countedDate(o, d.policy)) : null, delayed, ageHours: Math.round(ageH),
  };
}
export type Facts = ReturnType<typeof orderFacts>;

export async function context(d: Data) {
  const users: any[] = await Models.users.find().select('id name role active').lean();
  const paid = new Map<string, number>(), methods = new Map<string, Set<string>>();
  for (const p of d.payments.filter(p => p.status === 'VERIFIED')) {
    paid.set(p.orderId, (paid.get(p.orderId) || 0) + paise(p.amount));
    if (!methods.has(p.orderId)) methods.set(p.orderId, new Set()); methods.get(p.orderId)!.add(p.method);
  }
  return {users: new Map(users.map(u => [u.id, u])), userList: users, paid, methods, phones: new Map(d.customers.map((c: any) => [c.id, c.phone || '']))};
}
/** Salesmen only ever see their own orders. */
async function scope(req: Request, d: Data) {
  const me = sessionUser(req);
  if (me.role === 'salesman') d.orders = d.orders.filter(o => o.createdBy === me.id);
  else if (!(await permissionsFor(me.role)).includes('reports.view')) fail(403, 'You do not have permission for this action');
  return me;
}

export type Bucket = 'hour' | 'day' | 'month';
export const bucketOf = (from: string, to: string): Bucket => from === to ? 'hour' : daysIn(from, to) <= 62 ? 'day' : 'month';
export function buckets(from: string, to: string, b: Bucket): string[] {
  if (b === 'hour') return Array.from({length: 24}, (_, h) => String(h));
  if (b === 'day') return Array.from({length: daysIn(from, to)}, (_, i) => shiftIso(from, i));
  const out: string[] = []; let ym = from.slice(0, 7);
  while (ym <= to.slice(0, 7)) { out.push(ym); const y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7)); ym = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`; }
  return out;
}
export const keyOf = (date: Date | string, b: Bucket) => b === 'hour' ? String(hourOf(date)) : b === 'day' ? ymd(date) : ymd(date).slice(0, 7);

/** Period KPIs + per-bucket series (used for sparklines and the trend chart). */
export function periodStats(d: Data, ctx: Awaited<ReturnType<typeof context>>, from: string, to: string, b: Bucket) {
  const keys = buckets(from, to, b), idx = new Map(keys.map((k, i) => [k, i]));
  const z = () => keys.map(() => 0);
  const s = {sales: z(), orders: z(), counted: z(), collected: z(), cancelled: z(), customers: keys.map(() => new Set<string>())};
  const counted = d.orders.filter(o => COUNTED[d.policy].includes(o.status) && inRange(countedDate(o, d.policy), from, to));
  for (const o of counted) { const i = idx.get(keyOf(countedDate(o, d.policy), b)); if (i == null) continue; s.sales[i] += paise(o.total); s.counted[i]++; s.customers[i].add(o.customerId); }
  const created = d.orders.filter(o => inRange(o.createdAt, from, to));
  for (const o of created) { const i = idx.get(keyOf(o.createdAt, b)); if (i == null) continue; s.orders[i]++; if (['Rejected', 'Cancelled'].includes(o.status)) s.cancelled[i]++; }
  const orderIds = new Set(d.orders.map(o => o.id));
  const pays = d.payments.filter(p => p.status === 'VERIFIED' && inRange(p.paymentDate, from, to) && orderIds.has(p.orderId));
  for (const p of pays) { const i = idx.get(keyOf(p.paymentDate, b)); if (i != null) s.collected[i] += paise(p.amount); }
  // New vs repeat: a customer is "new" when their first-ever counted order falls in this period.
  const first = new Map<string, string>();
  for (const o of d.orders.filter(o => COUNTED[d.policy].includes(o.status))) { const k = ymd(countedDate(o, d.policy)); if (!first.has(o.customerId) || k < first.get(o.customerId)!) first.set(o.customerId, k); }
  const buyers = new Set(counted.map(o => o.customerId));
  const newC = [...buyers].filter(c => (first.get(c) || '') >= from).length;
  const salesPaise = sum(s.sales), countedN = counted.length;
  return {
    keys, series: {sales: s.sales, orders: s.orders, aov: keys.map((_, i) => s.counted[i] ? Math.round(s.sales[i] / s.counted[i]) : 0), collected: s.collected, customers: s.customers.map(x => x.size), cancelledPct: keys.map((_, i) => s.orders[i] ? Math.round(s.cancelled[i] / s.orders[i] * 1000) / 10 : 0)},
    kpi: {salesPaise, ordersCreated: created.length, countedOrders: countedN, aovPaise: countedN ? Math.round(salesPaise / countedN) : 0, collectedPaise: sum(s.collected), buyers: buyers.size, newCustomers: newC, repeatCustomers: buyers.size - newC, cancelled: sum(s.cancelled), cancelledPct: created.length ? Math.round(sum(s.cancelled) / created.length * 1000) / 10 : 0},
    counted, created,
  };
}

export const range = (req: Request) => {
  const q = parse(z.object({from: isoDay.optional(), to: isoDay.optional()}), {from: req.query.from || undefined, to: req.query.to || undefined});
  const to = q.to || today(), from = q.from || to;
  if (from > to) fail(400, 'The start date must be before the end date');
  if (daysIn(from, to) > 800) fail(400, 'Choose a range of at most two years');
  return {from, to};
};

export function registerAdminRoutes(app: Express) {
  // ---------------- Overview ----------------
  app.get('/api/admin/overview', requireAuth, requirePerm('reports.view'), route(async (req, res) => {
    const {from, to} = range(req);
    const d = await loadData(); await scope(req, d);
    const ctx = await context(d), b = bucketOf(from, to), prev = previousRange(from, to);
    const cur = periodStats(d, ctx, from, to, b), before = periodStats(d, ctx, prev.from, prev.to, b);
    const facts = d.orders.map(o => orderFacts(d, ctx, o));
    const fm = new Map(facts.map(f => [f.id, f]));
    const products: any[] = await Models.products.find().select('id name category stock reservedStock reorder status').lean();
    const pm = new Map(products.map(p => [p.id, p]));

    const statusCounts: Record<string, number> = {};
    for (const o of cur.created) statusCounts[o.status] = (statusCounts[o.status] || 0) + 1;
    const cat = new Map<string, number>(), prod = new Map<string, {name: string; valuePaise: number; qty: number}>();
    for (const o of cur.counted) for (const l of o.items) {
      const v = paise(l.qty * l.price), c = pm.get(l.productId)?.category || 'Uncategorised';
      cat.set(c, (cat.get(c) || 0) + v);
      const p = prod.get(l.productId) || {name: l.name, valuePaise: 0, qty: 0}; p.valuePaise += v; p.qty += l.qty; prod.set(l.productId, p);
    }
    const methods = new Map<string, number>();
    for (const p of d.payments.filter(p => p.status === 'VERIFIED' && inRange(p.paymentDate, from, to) && fm.has(p.orderId))) methods.set(p.method, (methods.get(p.method) || 0) + paise(p.amount));
    // Heatmap needs enough history to show a pattern: at least the 28 days ending on `to`.
    const hmFrom = daysIn(from, to) >= 28 ? from : shiftIso(to, -27);
    const heat = Array.from({length: 7}, () => Array(24).fill(0));
    for (const o of d.orders.filter(o => inRange(o.createdAt, hmFrom, to))) { const w = dowOf(o.createdAt); if (w >= 0) heat[w][hourOf(o.createdAt)]++; }

    // Target vs achieved: active SALES_AMOUNT targets overlapping the period (same achievement rule as the Targets page).
    const targets: any[] = await Sales.Target.find({status: 'ACTIVE', type: 'SALES_AMOUNT', startDate: {$lte: to}, endDate: {$gte: from}}).lean();
    let target = null;
    if (targets.length) {
      const pr = targets.map(t => ({t, p: targetProgress(t, d)}));
      const targetPaise = sum(targets.map(t => t.targetValue)), achievedPaise = sum(pr.map(x => Math.min(x.p.achieved, Number.MAX_SAFE_INTEGER)));
      const end = targets.map(t => t.endDate).sort().pop()!, daysLeft = Math.max(0, daysIn(today(), end));
      const remainingPaise = Math.max(0, targetPaise - achievedPaise);
      target = {count: targets.length, targetPaise, achievedPaise, remainingPaise, endDate: end, daysLeft, perDayPaise: daysLeft ? Math.ceil(remainingPaise / daysLeft) : remainingPaise};
    }

    const salesmen = ctx.userList.filter(u => u.role === 'salesman');
    const bySalesman = new Map<string, number>();
    for (const o of cur.counted) if (o.createdBy && ctx.users.get(o.createdBy)?.role === 'salesman') bySalesman.set(o.createdBy, (bySalesman.get(o.createdBy) || 0) + paise(o.total));
    const topId = [...bySalesman.entries()].sort((a, b) => b[1] - a[1])[0];
    const lastBuy = new Map<string, string>();
    for (const o of d.orders.filter(o => COUNTED[d.policy].includes(o.status))) { const k = ymd(countedDate(o, d.policy)); if (k > (lastBuy.get(o.customerId) || '')) lastBuy.set(o.customerId, k); }
    const slipCut = shiftIso(today(), -SLIP_DAYS);
    const slipping = [...lastBuy.entries()].filter(([, k]) => k < slipCut).length;

    const now = today(), due = facts.filter(f => f.duePaise > 0);
    const oldestDue = due.slice().sort((a, b) => (a.countedOn || '').localeCompare(b.countedOn || ''))[0];
    const lowStock = products.filter(p => p.status === 'active' && p.reorder > 0 && p.stock - (p.reservedStock || 0) <= p.reorder);
    const delayed = facts.filter(f => f.delayed).sort((a, b) => b.ageHours - a.ageHours);
    const unverified = d.payments.filter(p => p.status === 'UNVERIFIED' && fm.has(p.orderId));
    const pctDelta = (a: number, b2: number) => b2 ? Math.round((a - b2) / b2 * 1000) / 10 : null;

    res.json({
      from, to, previous: prev, bucket: b, keys: cur.keys, policy: d.policy,
      kpi: cur.kpi, previousKpi: before.kpi, series: cur.series, previousSeries: before.series,
      deltas: Object.fromEntries(Object.keys(cur.kpi).map(k => [k, pctDelta((cur.kpi as any)[k], (before.kpi as any)[k])])),
      duePaise: sum(due.map(f => f.duePaise)),
      statusCounts,
      categories: [...cat.entries()].map(([name, valuePaise]) => ({name, valuePaise})).sort((a, b2) => b2.valuePaise - a.valuePaise),
      topProducts: [...prod.entries()].map(([id, p]) => ({id, ...p})).sort((a, b2) => b2.valuePaise - a.valuePaise).slice(0, 5),
      paymentMethods: [...methods.entries()].map(([method, valuePaise]) => ({method, valuePaise})).sort((a, b2) => b2.valuePaise - a.valuePaise),
      heatmap: {from: hmFrom, to, days: DOW, cells: heat},
      busiestHour: (() => { const h = Array(24).fill(0); for (const o of cur.created) h[hourOf(o.createdAt)]++; const m = Math.max(...h); return m ? h.indexOf(m) : null; })(),
      target,
      operations: {pending: facts.filter(f => f.status === 'Pending').length, inProgress: facts.filter(f => ['Approved', 'Processing'].includes(f.status)).length, dispatched: facts.filter(f => f.status === 'Dispatched').length, delayed: delayed.length, lowStock: lowStock.length, delayRule: {pendingHours: DELAY_PENDING_H, activeHours: DELAY_ACTIVE_H}},
      management: {salesmen: salesmen.length, activeSalesmen: salesmen.filter(s => s.active !== false).length, topPerformer: topId ? {id: topId[0], name: ctx.users.get(topId[0])?.name, salesPaise: topId[1]} : null, slippingCustomers: slipping, slipDays: SLIP_DAYS, customers: d.customers.length},
      finance: {duePaise: sum(due.map(f => f.duePaise)), dueTodayPaise: sum(due.filter(f => f.countedOn === now).map(f => f.duePaise)), dueOlderPaise: sum(due.filter(f => f.countedOn !== now).map(f => f.duePaise)), dueOrders: due.length, oldestDue: oldestDue ? {id: oldestDue.id, number: oldestDue.number, customerName: oldestDue.customerName, duePaise: oldestDue.duePaise, since: oldestDue.countedOn, days: oldestDue.countedOn ? daysIn(oldestDue.countedOn, now) - 1 : null} : null, collectedTodayPaise: sum(d.payments.filter(p => p.status === 'VERIFIED' && inRange(p.paymentDate, now, now) && fm.has(p.orderId)).map(p => paise(p.amount))), unverifiedPaise: sum(unverified.map(p => paise(p.amount))), unverifiedCount: unverified.length},
      recent: facts.slice().sort((a, b2) => b2.createdAt.localeCompare(a.createdAt)).slice(0, 10),
      alerts: {
        delayed: delayed.slice(0, 5).map(f => ({id: f.id, number: f.number, customerName: f.customerName, status: f.status, ageHours: f.ageHours})),
        lowStock: lowStock.slice(0, 5).map(p => ({id: p.id, name: p.name, available: p.stock - (p.reservedStock || 0), reorder: p.reorder})),
        oldDues: due.filter(f => f.countedOn && daysIn(f.countedOn, now) > 30).sort((a, b2) => (a.countedOn || '').localeCompare(b2.countedOn || '')).slice(0, 5).map(f => ({id: f.id, number: f.number, customerName: f.customerName, duePaise: f.duePaise, days: daysIn(f.countedOn!, now) - 1})),
        unverifiedPayments: unverified.length,
      },
    });
  }));

  // ---------------- Order desk: filtered list + totals + analytics of exactly that result ----------------
  const listQuery = z.object({
    from: isoDay.optional(), to: isoDay.optional(), q: z.string().trim().max(100).optional(),
    status: z.string().max(200).optional(), pay: z.string().max(60).optional(), method: z.string().max(100).optional(), salesman: z.string().max(80).optional(),
    min: z.coerce.number().min(0).optional(), max: z.coerce.number().min(0).optional(), delayed: z.enum(['1']).optional(),
    sort: z.enum(['createdAt', 'total', 'due', 'customer', 'status', 'number']).default('createdAt'), dir: z.enum(['asc', 'desc']).default('desc'),
    page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(200).default(25), format: z.enum(['json', 'csv']).default('json'),
  });
  app.get('/api/admin/orders', requireAuth, route(async (req, res) => {
    const q = parse(listQuery, Object.fromEntries(Object.entries(req.query).filter(([, v]) => v !== '')));
    const d = await loadData(); await scope(req, d);
    const ctx = await context(d);
    let facts = d.orders.map(o => orderFacts(d, ctx, o));
    if (q.from) facts = facts.filter(f => ymd(f.createdAt) >= q.from!);
    if (q.to) facts = facts.filter(f => ymd(f.createdAt) <= q.to!);
    if (q.q) { const s = q.q.toLowerCase(); facts = facts.filter(f => f.id.toLowerCase().includes(s) || f.number.toLowerCase().includes(s) || f.customerName.toLowerCase().includes(s) || f.customerPhone.includes(s) || f.itemNames.some((n: string) => n.toLowerCase().includes(s))); }
    if (q.pay) { const set = new Set(q.pay.split(',')); facts = facts.filter(f => set.has(f.payStatus)); }
    if (q.method) { const set = new Set(q.method.split(',')); facts = facts.filter(f => f.methods.some(m => set.has(m))); }
    if (q.salesman) facts = facts.filter(f => f.salesmanId === q.salesman);
    if (q.min != null) facts = facts.filter(f => f.totalPaise >= q.min! * 100);
    if (q.max != null) facts = facts.filter(f => f.totalPaise <= q.max! * 100);
    if (q.delayed) facts = facts.filter(f => f.delayed);
    // Tab counts ignore the status filter so every tab shows how many it would hold.
    const statusCounts: Record<string, number> = {};
    for (const f of facts) statusCounts[f.status] = (statusCounts[f.status] || 0) + 1;
    if (q.status) { const set = new Set(q.status.split(',')); facts = facts.filter(f => set.has(f.status)); }
    const dir = q.dir === 'asc' ? 1 : -1;
    const key: Record<string, (f: Facts) => string | number> = {createdAt: f => f.createdAt, total: f => f.totalPaise, due: f => f.duePaise, customer: f => f.customerName.toLowerCase(), status: f => f.status, number: f => f.number};
    facts.sort((a, b) => { const x = key[q.sort](a), y = key[q.sort](b); return (x < y ? -1 : x > y ? 1 : 0) * dir; });
    const totals = {count: facts.length, valuePaise: sum(facts.map(f => f.totalPaise)), paidPaise: sum(facts.map(f => f.paidPaise)), duePaise: sum(facts.map(f => f.duePaise)), countedValuePaise: sum(facts.filter(f => f.counted).map(f => f.totalPaise)), countedOrders: facts.filter(f => f.counted).length, pending: facts.filter(f => f.status === 'Pending').length, inProgress: facts.filter(f => ['Approved', 'Processing', 'Dispatched'].includes(f.status)).length, completed: facts.filter(f => f.status === 'Delivered').length, cancelled: facts.filter(f => ['Rejected', 'Cancelled'].includes(f.status)).length, delayed: facts.filter(f => f.delayed).length};
    if (q.format === 'csv') {
      const esc = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
      const rows = [['Order', 'Created', 'Customer', 'Phone', 'Salesman', 'Lines', 'Items', 'Total', 'Paid', 'Due', 'Payment status', 'Payment modes', 'Status'], ...facts.map(f => [f.number, f.createdAt, f.customerName, f.customerPhone, f.salesmanName || '', f.lines, f.itemNames.join('; '), f.totalPaise / 100, f.paidPaise / 100, f.duePaise / 100, f.payStatus, f.methods.join(' '), f.status])];
      res.set('Content-Type', 'text/csv; charset=utf-8').set('Content-Disposition', `attachment; filename="orders-${today()}.csv"`).send('﻿' + rows.map(r => r.map(esc).join(',')).join('\n'));
      return;
    }
    const byHour = Array(24).fill(0);
    for (const f of facts) byHour[hourOf(f.createdAt)]++;
    const split: Record<string, number> = {};
    for (const f of facts) split[f.status] = (split[f.status] || 0) + 1;
    const ids = new Set(facts.map(f => f.id)), methods: Record<string, number> = {};
    for (const p of d.payments.filter(p => p.status === 'VERIFIED' && ids.has(p.orderId))) methods[p.method] = (methods[p.method] || 0) + paise(p.amount);
    const start = (q.page - 1) * q.limit;
    res.json({
      items: facts.slice(start, start + q.limit), page: q.page, limit: q.limit, total: facts.length,
      totals, statusCounts, analytics: {byHour, status: split, methods},
      salesmen: ctx.userList.filter(u => u.role === 'salesman' || d.orders.some(o => o.createdBy === u.id)).map(u => ({id: u.id, name: u.name, role: u.role})),
      delayRule: {pendingHours: DELAY_PENDING_H, activeHours: DELAY_ACTIVE_H},
    });
  }));

  app.get('/api/admin/orders/:id', requireAuth, route(async (req, res) => {
    const d = await loadData(); const me = await scope(req, d);
    const o = d.orders.find(x => x.id === req.params.id);
    if (!o) fail(404, 'Order not found');
    const ctx = await context(d);
    const products: any[] = await Models.products.find({id: {$in: o.items.map((i: any) => i.productId)}}).select('id sku category').lean();
    const pm = new Map(products.map(p => [p.id, p]));
    const [timeline, invoice] = await Promise.all([Sales.Activity.find({orderId: o.id}).sort({at: 1}).lean(), Models.invoices.findOne({id: o.id}).lean()]);
    const customer: any = d.customers.find(c => c.id === o.customerId) || null;
    const perms = await permissionsFor(me.role);
    res.json({
      ...orderFacts(d, ctx, o),
      lines: o.items.map((l: any) => ({...l, sku: pm.get(l.productId)?.sku || '', category: pm.get(l.productId)?.category || '', lineTotalPaise: paise(l.qty * l.price)})),
      customer: customer && {id: customer.id, name: customer.name, phone: customer.phone, address: customer.address || '', balance: customer.balance},
      payments: d.payments.filter(p => p.orderId === o.id).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).map(p => ({id: String(p._id), amountPaise: paise(p.amount), method: p.method, status: p.status, paymentDate: p.paymentDate, reference: p.reference, recordedBy: ctx.users.get(p.recordedBy)?.name || p.recordedBy || null, createdAt: p.createdAt})),
      timeline: timeline.map((a: any) => ({at: a.at, type: a.type, by: a.actor?.name || null, description: a.description})),
      stamps: {createdAt: o.createdAt, approvedAt: o.approvedAt || null, dispatchedAt: o.dispatchedAt || null, deliveredAt: o.deliveredAt || null, closedAt: o.closedAt || null, reason: o.reason || null, statusBy: o.statusBy || null},
      invoice: invoice ? {id: (invoice as any).id, number: (invoice as any).number, total: (invoice as any).total, paid: (invoice as any).paid, status: (invoice as any).status, createdAt: (invoice as any).createdAt} : null,
      next: me.role === 'salesman' ? [] : transitions[o.status as keyof typeof transitions] || [],
      can: {changeStatus: me.role !== 'salesman', recordPayment: me.role === 'salesman' || perms.includes('payment.record'), invoice: me.role !== 'salesman' && !invoice && ['Approved', 'Processing', 'Dispatched', 'Delivered'].includes(o.status), duplicate: me.role === 'owner'},
    });
  }));
}
