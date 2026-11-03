import crypto from 'node:crypto';
import type {Express, Request} from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import {z} from 'zod';
import {config} from '../config.js';
import {permissionsFor, requireAuth, requirePerm, sessionUser} from '../auth.js';
import {Models} from '../models.js';
import {ErpModels} from '../erp-models.js';
import {Inv} from '../inventory/models.js';
import {escapeRegex, fail, paging, parse, route, sendPage} from '../inventory/http.js';
import {mutate} from '../inventory/txn.js';
import {MONEY_TARGETS, Sales, TARGET_TYPES} from './models.js';

const text = (max = 200) => z.string().trim().max(max);
export const tz = process.env.BUSINESS_TIMEZONE || 'Asia/Kolkata';
export const ymd = (d: Date | string | number) => new Intl.DateTimeFormat('en-CA', {timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date(d));
export const today = () => ymd(new Date());
export const inRange = (d: string | Date | undefined | null, from: string, to: string) => { if (!d) return false; const k = ymd(d); return k >= from && k <= to; };
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date');

// ---------------- Achievement policy (single source of truth) ----------------
// An order counts as a sale once it reaches the configured stage (default: APPROVED — i.e. approved,
// processing, dispatched or delivered). Pending, rejected and cancelled orders never count, and a
// counted order that is later cancelled stops counting. Duplicates are prevented by idempotency keys.
export const COUNTED: Record<'APPROVED' | 'DISPATCHED', string[]> = {APPROVED: ['Approved', 'Processing', 'Dispatched', 'Delivered'], DISPATCHED: ['Dispatched', 'Delivered']};
export async function salesPolicy(): Promise<'APPROVED' | 'DISPATCHED'> { const s: any = await Inv.Settings.findById('default').select('salesCountAt').lean(); return s?.salesCountAt === 'DISPATCHED' ? 'DISPATCHED' : 'APPROVED'; }
export const countedDate = (o: any, policy: 'APPROVED' | 'DISPATCHED') => policy === 'APPROVED' ? (o.approvedAt || o.dispatchedAt || o.updatedAt) : (o.dispatchedAt || o.updatedAt);

export type Data = {orders: any[]; customers: any[]; invoices: any[]; payments: any[]; policy: 'APPROVED' | 'DISPATCHED'};
export async function loadData(): Promise<Data> {
  const [orders, customers, invoices, payments, policy] = await Promise.all([Models.orders.find().lean(), Models.customers.find().lean(), Models.invoices.find().lean(), ErpModels.Payment.find().lean(), salesPolicy()]);
  return {orders, customers, invoices, payments, policy};
}
export const paise = (rupees: number) => Math.round((rupees || 0) * 100);
const ownerOf = (d: Data, orderId: string) => d.orders.find(o => o.id === orderId)?.createdBy;
const paymentSalesman = (d: Data, p: any) => p.salesmanId || ownerOf(d, p.orderId);

export function metricsFor(d: Data, salesmanId: string, from: string, to: string) {
  const mine = d.orders.filter(o => o.createdBy === salesmanId);
  const counted = mine.filter(o => COUNTED[d.policy].includes(o.status) && inRange(countedDate(o, d.policy), from, to));
  const created = mine.filter(o => inRange(o.createdAt, from, to));
  const verified = d.payments.filter(p => p.status === 'VERIFIED' && paymentSalesman(d, p) === salesmanId);
  const paidByOrder = new Map<string, number>();
  for (const p of verified) paidByOrder.set(p.orderId, (paidByOrder.get(p.orderId) || 0) + paise(p.amount));
  const billable = mine.filter(o => ['Dispatched', 'Delivered'].includes(o.status));
  const myCustomers = d.customers.filter(c => c.createdBy === salesmanId || c.assignedSalesmanId === salesmanId);
  const everCounted = new Set(mine.filter(o => COUNTED[d.policy].includes(o.status)).map(o => o.customerId));
  const salesPaise = counted.reduce((a, o) => a + paise(o.total), 0);
  return {
    salesPaise,
    revenuePaise: d.invoices.filter(i => mine.some(o => o.id === i.id) && inRange(i.createdAt, from, to)).reduce((a, i) => a + paise(i.total), 0),
    countedOrders: counted.length,
    ordersCreated: created.length,
    successfulOrders: created.filter(o => ['Dispatched', 'Delivered'].includes(o.status)).length,
    approvedOrders: created.filter(o => ['Approved', 'Processing'].includes(o.status)).length,
    pendingOrders: created.filter(o => o.status === 'Pending').length,
    cancelledOrders: created.filter(o => ['Rejected', 'Cancelled'].includes(o.status)).length,
    avgOrderValuePaise: counted.length ? Math.round(salesPaise / counted.length) : 0,
    collectedPaise: verified.filter(p => inRange(p.paymentDate, from, to)).reduce((a, p) => a + paise(p.amount), 0),
    unverifiedCollectionsPaise: d.payments.filter(p => p.status === 'UNVERIFIED' && paymentSalesman(d, p) === salesmanId).reduce((a, p) => a + paise(p.amount), 0),
    outstandingPaise: billable.reduce((a, o) => a + Math.max(0, paise(o.total) - (paidByOrder.get(o.id) || 0)), 0),
    newCustomers: myCustomers.filter(c => inRange(c.createdAt, from, to) && everCounted.has(c.id)).length,
    deliveries: mine.filter(o => o.status === 'Delivered' && inRange(o.deliveredAt || o.updatedAt, from, to)).length,
    assignedCustomers: myCustomers.length,
  };
}
const ACHIEVED: Record<string, (m: ReturnType<typeof metricsFor>) => number> = {SALES_AMOUNT: m => m.salesPaise, REVENUE: m => m.revenuePaise, ORDER_COUNT: m => m.countedOrders, COLLECTION_AMOUNT: m => m.collectedPaise, NEW_CUSTOMERS: m => m.newCustomers, DELIVERIES: m => m.deliveries};
export function targetProgress(t: any, d: Data) {
  const achieved = ACHIEVED[t.type](metricsFor(d, t.salesmanId, t.startDate, t.endDate));
  const now = today();
  const pct = t.targetValue > 0 ? Math.round(achieved / t.targetValue * 1000) / 10 : null;
  const state = t.status === 'CANCELLED' ? 'CANCELLED' : achieved >= t.targetValue && t.targetValue > 0 ? 'COMPLETED' : now < t.startDate ? 'UPCOMING' : now > t.endDate ? 'OVERDUE' : 'ACTIVE';
  return {achieved, remaining: Math.max(0, t.targetValue - achieved), pct, state, money: MONEY_TARGETS.includes(t.type), daysLeft: Math.max(0, Math.round((Date.parse(t.endDate) - Date.parse(now)) / 86400000))};
}

// ---------------- Date helpers for insights (YYYY-MM-DD strings, business timezone) ----------------
export const SLIP_DAYS = 45; // a customer who has not bought for this long is "slipping away"
export const shiftIso = (iso: string, n: number) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
export const daysIn = (a: string, b: string) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000) + 1; // inclusive
const lastDay = (ym: string) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();
const nextMonth = (ym: string) => { const y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7)); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`; };
export const hourOf = (d: Date | string) => Number(new Intl.DateTimeFormat('en-GB', {timeZone: tz, hour: '2-digit', hourCycle: 'h23'}).format(new Date(d)));
/** Comparison period: month-to-date → same days of last month; year-to-date → same span last year; otherwise the same number of days just before. */
export function previousRange(from: string, to: string) {
  const sameMonth = from.slice(0, 7) === to.slice(0, 7), sameYear = from.slice(0, 4) === to.slice(0, 4);
  const clampDay = (ym: string, day: string) => `${ym}-${String(Math.min(Number(day), lastDay(ym))).padStart(2, '0')}`;
  if (from.endsWith('-01') && sameMonth && to !== from) {
    const y = Number(from.slice(0, 4)), m = Number(from.slice(5, 7)), pm = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
    return {from: pm + '-01', to: clampDay(pm, to.slice(8))};
  }
  if (from.endsWith('-01-01') && sameYear && !sameMonth) {
    const py = String(Number(from.slice(0, 4)) - 1);
    return {from: py + '-01-01', to: clampDay(`${py}-${to.slice(5, 7)}`, to.slice(8))};
  }
  const len = daysIn(from, to);
  return {from: shiftIso(from, -len), to: shiftIso(from, -1)};
}

function periodDates(period: string, start: string) {
  const d = new Date(`${start}T00:00:00Z`);
  if (period === 'DAILY') return start;
  if (period === 'WEEKLY') return new Date(d.getTime() + 6 * 86400000).toISOString().slice(0, 10);
  if (period === 'MONTHLY') return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  return null;
}
async function activity(e: any, session?: mongoose.ClientSession) { await Sales.Activity.create([{at: new Date(), ...e, key: e.key || `${e.type}:${crypto.randomUUID()}`}], {session}); }
export async function recordLogin(userId: string, role: string, name: string) {
  if (role !== 'salesman') return;
  try { await activity({type: 'LOGIN', salesmanId: userId, salesmanName: name, actor: {id: userId, name, role}, description: 'Signed in'}); } catch (e) { console.error('activity log failed', e); }
}
const genPassword = () => { const a = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'; return Array.from(crypto.randomBytes(12), b => a[b % a.length]).join(''); };
const safeUser = (u: any) => { const {password: _p, _id, ...rest} = u; return rest; };

export function registerSalesRoutes(app: Express) {
  // ---------------- Own password (any role) ----------------
  app.post('/api/auth/change-password', requireAuth, route(async (req, res) => {
    const b = parse(z.object({currentPassword: z.string().min(1), newPassword: z.string().min(10, 'Use at least 10 characters').max(128)}), req.body);
    const me = sessionUser(req);
    const r = await mutate(req, 'CHANGE_PASSWORD', async ({session}) => {
      const u: any = await Models.users.findOne({id: me.id}).session(session).lean();
      if (!u || !bcrypt.compareSync(b.currentPassword, u.password)) fail(400, 'Your current password is incorrect');
      if (bcrypt.compareSync(b.newPassword, u.password)) fail(400, 'Choose a password different from the current one');
      const tv = (u.tokenVersion || 0) + 1;
      await Models.users.updateOne({id: me.id}, {$set: {password: bcrypt.hashSync(b.newPassword, 10), tokenVersion: tv, mustChangePassword: false}}, {session});
      return {token: jwt.sign({id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role, tv}, config.JWT_SECRET, {expiresIn: '8h'})};
    });
    res.json(r);
  }));

  // ---------------- Salesmen ----------------
  const profile = z.object({
    name: text(120).min(2), phone: z.string().trim().regex(/^[0-9+\-\s]{10,15}$/, 'Enter a valid 10-digit phone number'), email: z.string().trim().email().or(z.literal('')).optional().default(''),
    address: text(500).optional().default(''), employeeId: text(30).optional().default(''), joiningDate: isoDay.or(z.literal('')).optional().default(''), territory: text(120).optional().default(''),
    categoryIds: z.array(z.string()).max(200).optional(), customerIds: z.array(z.string()).max(2000).optional(),
  });
  app.get('/api/salesmen', requireAuth, requirePerm('salesman.view'), route(async (req, res) => {
    const from = String(req.query.from || today().slice(0, 8) + '01'), to = String(req.query.to || today());
    const users: any[] = await Models.users.find({role: 'salesman'}).sort({name: 1}).lean();
    const q = String(req.query.q || '').toLowerCase();
    const d = await loadData();
    const targets: any[] = await Sales.Target.find({status: 'ACTIVE', startDate: {$lte: to}, endDate: {$gte: from}}).lean();
    const rows = users.filter(u => !q || `${u.name} ${u.phone} ${u.employeeId || ''} ${u.territory || ''}`.toLowerCase().includes(q)).filter(u => req.query.status === 'all' || (req.query.status === 'INACTIVE' ? u.active === false : u.active !== false)).map(u => {
      const m = metricsFor(d, u.id, from, to);
      const t = targets.filter(x => x.salesmanId === u.id).map(x => ({...x, progress: targetProgress(x, d)}));
      const main = t.find(x => x.type === 'SALES_AMOUNT') || t[0];
      return {...safeUser(u), phone: u.phone || (u.email?.endsWith('@phone.local') ? u.email.slice(0, -12) : ''), active: u.active !== false, metrics: m, mainTarget: main || null, targetCount: t.length};
    });
    res.json({items: rows, period: {from, to}, policy: d.policy});
  }));
  app.get('/api/salesmen/:id', requireAuth, requirePerm('salesman.view'), route(async (req, res) => {
    const u: any = await Models.users.findOne({id: req.params.id, role: 'salesman'}).lean();
    if (!u) fail(404, 'Salesman not found');
    const d = await loadData();
    const now = today(), monthStart = now.slice(0, 8) + '01';
    const [targets, activities, assignment] = await Promise.all([Sales.Target.find({salesmanId: u.id}).sort({startDate: -1}).limit(100).lean(), Sales.Activity.find({salesmanId: u.id}).sort({at: -1}).limit(50).lean(), ErpModels.Assignment.findOne({salesmanId: u.id}).lean()]);
    const history = Array.from({length: 6}, (_, i) => { const dt = new Date(); dt.setUTCDate(1); dt.setUTCMonth(dt.getUTCMonth() - (5 - i)); const s = dt.toISOString().slice(0, 8) + '01'; const e = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).toISOString().slice(0, 10); return {month: s.slice(0, 7), ...metricsFor(d, u.id, s, e)}; });
    res.json({
      ...safeUser(u), phone: u.phone || (u.email?.endsWith('@phone.local') ? u.email.slice(0, -12) : ''), active: u.active !== false,
      thisMonth: metricsFor(d, u.id, monthStart, now), allTime: metricsFor(d, u.id, '2000-01-01', now), history,
      targets: targets.map(t => ({...t, progress: targetProgress(t, d)})),
      completedTargets: targets.filter(t => targetProgress(t, d).state === 'COMPLETED').length,
      activities, assignment,
      customers: d.customers.filter(c => c.createdBy === u.id || c.assignedSalesmanId === u.id).map(c => ({id: c.id, name: c.name, phone: c.phone, balance: c.balance, assigned: c.assignedSalesmanId === u.id})),
      orders: d.orders.filter(o => o.createdBy === u.id).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 50).map(o => ({id: o.id, customerName: o.customerName, total: o.total, status: o.status, createdAt: o.createdAt})),
    });
  }));
  app.post('/api/salesmen', requireAuth, requirePerm('salesman.manage'), route(async (req, res) => {
    const b = parse(profile.extend({password: z.string().min(8).max(128).optional().or(z.literal('')), generatePassword: z.boolean().default(false)}), req.body);
    if (!b.password && !b.generatePassword) fail(400, 'Enter a temporary password or choose "Generate"');
    const temp = b.password || genPassword();
    const r = await mutate(req, 'SALESMAN_CREATE', async ({session, actor}) => {
      const phone = b.phone.replace(/\D/g, '').slice(-10);
      const email = b.email ? b.email.toLowerCase() : `${phone}@phone.local`;
      const clash: any = await Models.users.findOne({$or: [{phone: {$regex: `${phone}$`}}, {email: `${phone}@phone.local`}, {email}, ...(b.employeeId ? [{employeeId: b.employeeId}] : [])]}).session(session).lean();
      if (clash) fail(409, clash.employeeId && clash.employeeId === b.employeeId ? `Employee ID ${b.employeeId} is already used by ${clash.name}` : `An account with this phone number or email already exists (${clash.name})`);
      const id = `u_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
      await Models.users.create([{id, name: b.name, email, phone, password: bcrypt.hashSync(temp, 10), role: 'salesman', active: true, tokenVersion: 0, mustChangePassword: true, employeeId: b.employeeId || undefined, address: b.address, territory: b.territory, joiningDate: b.joiningDate || undefined, createdBy: actor.id}], {session});
      if (b.categoryIds) await ErpModels.Assignment.updateOne({salesmanId: id}, {$set: {categoryIds: b.categoryIds, productIds: [], active: true, updatedBy: actor.id}}, {upsert: true, session});
      if (b.customerIds?.length) await Models.customers.updateMany({id: {$in: b.customerIds}}, {$set: {assignedSalesmanId: id}}, {session});
      await activity({type: 'SALESMAN_CREATED', salesmanId: id, salesmanName: b.name, actor, description: `Account created by ${actor.name}`, key: `SALESMAN_CREATED:${id}`}, session);
      return {id};
    });
    // The temporary password is shown once and never stored in plain text.
    res.status(r.replayed ? 200 : 201).json({...r, temporaryPassword: r.replayed ? undefined : temp, loginWith: b.phone.replace(/\D/g, '').slice(-10)});
  }));
  app.patch('/api/salesmen/:id', requireAuth, requirePerm('salesman.manage'), route(async (req, res) => {
    const b = parse(profile, req.body);
    const r = await mutate(req, 'SALESMAN_EDIT', async ({session, actor}) => {
      const u: any = await Models.users.findOne({id: req.params.id, role: 'salesman'}).session(session).lean();
      if (!u) fail(404, 'Salesman not found');
      const phone = b.phone.replace(/\D/g, '').slice(-10);
      const email = b.email ? b.email.toLowerCase() : (u.email?.endsWith('@phone.local') ? `${phone}@phone.local` : u.email);
      const clash: any = await Models.users.findOne({id: {$ne: u.id}, $or: [{phone: {$regex: `${phone}$`}}, {email}, ...(b.employeeId ? [{employeeId: b.employeeId}] : [])]}).session(session).lean();
      if (clash) fail(409, `Another account already uses this phone, email or employee ID (${clash.name})`);
      await Models.users.updateOne({id: u.id}, {$set: {name: b.name, phone, email, address: b.address, employeeId: b.employeeId || undefined, territory: b.territory, joiningDate: b.joiningDate || undefined}}, {session});
      if (b.categoryIds) await ErpModels.Assignment.updateOne({salesmanId: u.id}, {$set: {categoryIds: b.categoryIds, updatedBy: actor.id}}, {upsert: true, session});
      if (b.customerIds) {
        await Models.customers.updateMany({assignedSalesmanId: u.id, id: {$nin: b.customerIds}}, {$unset: {assignedSalesmanId: ''}}, {session});
        await Models.customers.updateMany({id: {$in: b.customerIds}}, {$set: {assignedSalesmanId: u.id}}, {session});
        await activity({type: 'CUSTOMERS_ASSIGNED', salesmanId: u.id, salesmanName: b.name, actor, description: `${b.customerIds.length} customer(s) assigned by ${actor.name}`}, session);
      }
      return {id: u.id};
    });
    res.json(r);
  }));
  app.post('/api/salesmen/:id/status', requireAuth, requirePerm('salesman.deactivate'), route(async (req, res) => {
    const {active, reason} = parse(z.object({active: z.boolean(), reason: text(300).optional().default('')}), req.body);
    if (!active && !reason) fail(400, 'Give a reason for deactivating');
    const r = await mutate(req, 'SALESMAN_STATUS', async ({session, actor}) => {
      const u: any = await Models.users.findOneAndUpdate({id: req.params.id, role: 'salesman'}, {$set: {active}, ...(active ? {} : {$inc: {tokenVersion: 1}})}, {session, returnDocument: 'after'}).lean();
      if (!u) fail(404, 'Salesman not found');
      await activity({type: active ? 'SALESMAN_ACTIVATED' : 'SALESMAN_DEACTIVATED', salesmanId: u.id, salesmanName: u.name, actor, description: active ? `Reactivated by ${actor.name}` : `Deactivated by ${actor.name}: ${reason}`}, session);
      return {id: u.id, active};
    });
    res.json(r);
  }));
  app.post('/api/salesmen/:id/reset-password', requireAuth, requirePerm('salesman.resetPassword'), route(async (req, res) => {
    const temp = genPassword();
    const r = await mutate(req, 'SALESMAN_RESET', async ({session, actor}) => {
      const u: any = await Models.users.findOneAndUpdate({id: req.params.id, role: 'salesman'}, {$set: {password: bcrypt.hashSync(temp, 10), mustChangePassword: true}, $inc: {tokenVersion: 1}}, {session, returnDocument: 'after'}).lean();
      if (!u) fail(404, 'Salesman not found');
      await activity({type: 'PASSWORD_RESET', salesmanId: u.id, salesmanName: u.name, actor, description: `Password reset by ${actor.name}; all sessions signed out`}, session);
      return {id: u.id};
    });
    res.json({...r, temporaryPassword: r.replayed ? undefined : temp});
  }));

  // ---------------- Targets ----------------
  const targetBody = z.object({name: text(120).min(2), salesmanId: z.string().min(1), type: z.enum(TARGET_TYPES), period: z.enum(['DAILY', 'WEEKLY', 'MONTHLY', 'CUSTOM']), startDate: isoDay, endDate: isoDay.optional(), targetValue: z.number().positive().max(1e10), description: text(1000).optional().default(''), instructions: text(1000).optional().default('')});
  const normTarget = (b: z.infer<typeof targetBody>) => {
    const endDate = b.period === 'CUSTOM' ? b.endDate : periodDates(b.period, b.startDate);
    if (!endDate) fail(400, 'Choose an end date');
    if (endDate! < b.startDate) fail(400, 'The end date is before the start date');
    if (!MONEY_TARGETS.includes(b.type) && !Number.isInteger(b.targetValue)) fail(400, 'Count targets must be whole numbers');
    return {name: b.name, type: b.type, period: b.period, startDate: b.startDate, endDate: endDate!, targetValue: MONEY_TARGETS.includes(b.type) ? Math.round(b.targetValue * 100) : b.targetValue, description: b.description, instructions: b.instructions};
  };
  app.get('/api/targets', requireAuth, route(async (req, res) => {
    const me = sessionUser(req), perms = await permissionsFor(me.role);
    const filter: any = {};
    if (me.role === 'salesman') filter.salesmanId = me.id;
    else { if (!perms.includes('target.view')) fail(403, 'You do not have permission for this action'); if (req.query.salesmanId) filter.salesmanId = String(req.query.salesmanId); }
    if (req.query.type) filter.type = String(req.query.type);
    if (req.query.from) filter.endDate = {$gte: String(req.query.from)};
    if (req.query.to) filter.startDate = {$lte: String(req.query.to)};
    const d = await loadData();
    let items = (await Sales.Target.find(filter).sort({startDate: -1, salesmanName: 1}).limit(1000).lean()).map((t: any) => ({...t, progress: targetProgress(t, d)}));
    if (req.query.state) items = items.filter(t => t.progress.state === req.query.state);
    const summary = {total: items.length, completed: items.filter(t => t.progress.state === 'COMPLETED').length, active: items.filter(t => t.progress.state === 'ACTIVE').length, overdue: items.filter(t => t.progress.state === 'OVERDUE').length, upcoming: items.filter(t => t.progress.state === 'UPCOMING').length};
    res.json({items, summary, policy: d.policy});
  }));
  app.post('/api/targets', requireAuth, requirePerm('target.manage'), route(async (req, res) => {
    const b = parse(targetBody.extend({salesmanIds: z.array(z.string()).max(200).optional()}), req.body);
    const ids = b.salesmanIds?.length ? b.salesmanIds : [b.salesmanId];
    const data = normTarget(b);
    const r = await mutate(req, 'TARGET_CREATE', async ({session, actor}) => {
      const created: string[] = [];
      for (const sid of ids) {
        const u: any = await Models.users.findOne({id: sid, role: 'salesman'}).session(session).lean();
        if (!u) fail(400, 'Choose a salesman');
        const [t] = await Sales.Target.create([{...data, salesmanId: u.id, salesmanName: u.name, assignedBy: actor, version: 1}], {session});
        await activity({type: 'TARGET_ASSIGNED', salesmanId: u.id, salesmanName: u.name, actor, description: `Target "${data.name}" assigned (${data.startDate} to ${data.endDate})`, amountPaise: MONEY_TARGETS.includes(data.type) ? data.targetValue : undefined, key: `TARGET_ASSIGNED:${t._id}`}, session);
        created.push(String(t._id));
      }
      return {created};
    });
    res.status(r.replayed ? 200 : 201).json(r);
  }));
  // Targets are never silently changed: every edit stores a revision with the reason and before/after values.
  app.put('/api/targets/:id', requireAuth, requirePerm('target.manage'), route(async (req, res) => {
    const b = parse(targetBody.extend({version: z.number().int().min(1), reason: text(300).min(3)}), req.body);
    const data = normTarget(b);
    const r = await mutate(req, 'TARGET_REVISE', async ({session, actor}) => {
      const t: any = await Sales.Target.findById(req.params.id).session(session).lean();
      if (!t) fail(404, 'Target not found');
      if (t.status === 'CANCELLED') fail(409, 'Cancelled targets cannot be changed');
      if (t.salesmanId !== b.salesmanId) fail(400, 'Create a new target to assign a different salesman');
      const before = {name: t.name, type: t.type, period: t.period, startDate: t.startDate, endDate: t.endDate, targetValue: t.targetValue, description: t.description, instructions: t.instructions};
      const u = await Sales.Target.updateOne({_id: t._id, version: b.version}, {$set: data, $inc: {version: 1}, $push: {revisions: {version: t.version + 1, at: new Date(), by: actor, reason: b.reason, before, after: data}}}, {session});
      if (!u.modifiedCount) fail(409, 'This target was changed by someone else. Refresh and try again.');
      await activity({type: 'TARGET_REVISED', salesmanId: t.salesmanId, salesmanName: t.salesmanName, actor, description: `Target "${data.name}" revised: ${b.reason}`}, session);
      return {id: String(t._id), version: t.version + 1};
    });
    res.json(r);
  }));
  app.post('/api/targets/:id/cancel', requireAuth, requirePerm('target.manage'), route(async (req, res) => {
    const {reason} = parse(z.object({reason: text(300).min(3)}), req.body);
    const r = await mutate(req, 'TARGET_CANCEL', async ({session, actor}) => {
      const t: any = await Sales.Target.findOneAndUpdate({_id: req.params.id, status: 'ACTIVE'}, {$set: {status: 'CANCELLED'}, $inc: {version: 1}, $push: {revisions: {at: new Date(), by: actor, reason, before: {status: 'ACTIVE'}, after: {status: 'CANCELLED'}}}}, {session, returnDocument: 'after'}).lean();
      if (!t) fail(409, 'Only active targets can be cancelled');
      await activity({type: 'TARGET_CANCELLED', salesmanId: t.salesmanId, salesmanName: t.salesmanName, actor, description: `Target "${t.name}" cancelled: ${reason}`}, session);
      return {id: String(t._id)};
    });
    res.json(r);
  }));

  // ---------------- Business performance ----------------
  app.get('/api/sales/performance', requireAuth, requirePerm('salesman.view'), route(async (req, res) => {
    const from = String(req.query.from || today().slice(0, 8) + '01'), to = String(req.query.to || today());
    const d = await loadData();
    const users: any[] = await Models.users.find({role: 'salesman'}).sort({name: 1}).lean();
    const targets: any[] = await Sales.Target.find({status: 'ACTIVE', startDate: {$lte: to}, endDate: {$gte: from}}).lean();
    const rows = users.filter(u => !req.query.salesmanId || u.id === req.query.salesmanId).filter(u => !req.query.territory || (u.territory || '') === req.query.territory).map(u => {
      const m = metricsFor(d, u.id, from, to);
      const ts = targets.filter(t => t.salesmanId === u.id).map(t => ({id: String(t._id), name: t.name, type: t.type, targetValue: t.targetValue, startDate: t.startDate, endDate: t.endDate, progress: targetProgress(t, d)}));
      return {id: u.id, name: u.name, territory: u.territory || '', active: u.active !== false, ...m, targets: ts};
    });
    const sum = (k: keyof ReturnType<typeof metricsFor>) => rows.reduce((a, r) => a + (r[k] as number), 0);
    const productSales = new Map<string, {name: string; qty: number; valuePaise: number}>();
    const customerSales = new Map<string, {name: string; orders: number; valuePaise: number}>();
    for (const o of d.orders.filter(o => COUNTED[d.policy].includes(o.status) && inRange(countedDate(o, d.policy), from, to) && (!req.query.salesmanId || o.createdBy === req.query.salesmanId))) {
      for (const l of o.items) { const x = productSales.get(l.productId) || {name: l.name, qty: 0, valuePaise: 0}; x.qty += l.qty; x.valuePaise += paise(l.qty * l.price); productSales.set(l.productId, x); }
      const c = customerSales.get(o.customerId) || {name: o.customerName, orders: 0, valuePaise: 0}; c.orders++; c.valuePaise += paise(o.total); customerSales.set(o.customerId, c);
    }
    res.json({
      period: {from, to}, policy: d.policy,
      totals: {salesmen: users.length, active: users.filter(u => u.active !== false).length, inactive: users.filter(u => u.active === false).length, ordersCreated: sum('ordersCreated'), salesPaise: sum('salesPaise'), revenuePaise: sum('revenuePaise'), collectedPaise: sum('collectedPaise'), outstandingPaise: sum('outstandingPaise'), unverifiedCollectionsPaise: sum('unverifiedCollectionsPaise'), successfulOrders: sum('successfulOrders'), pendingOrders: sum('pendingOrders'), cancelledOrders: sum('cancelledOrders'), newCustomers: sum('newCustomers')},
      salesmen: rows,
      products: [...productSales.values()].sort((a, b) => b.valuePaise - a.valuePaise).slice(0, 20),
      customers: [...customerSales.values()].sort((a, b) => b.valuePaise - a.valuePaise).slice(0, 20),
      territories: [...new Set(users.map(u => u.territory).filter(Boolean))].sort(),
    });
  }));
  app.get('/api/sales/activities', requireAuth, route(async (req, res) => {
    const me = sessionUser(req), perms = await permissionsFor(me.role);
    const {page, limit, skip} = paging(req);
    const filter: any = {};
    if (me.role === 'salesman') filter.salesmanId = me.id;
    else { if (!perms.includes('salesman.view')) fail(403, 'You do not have permission for this action'); if (req.query.salesmanId) filter.salesmanId = String(req.query.salesmanId); }
    if (req.query.type) filter.type = String(req.query.type);
    if (req.query.from || req.query.to) filter.at = {...(req.query.from ? {$gte: new Date(`${req.query.from}T00:00:00+05:30`)} : {}), ...(req.query.to ? {$lte: new Date(`${req.query.to}T23:59:59.999+05:30`)} : {})};
    if (req.query.customer) filter.customerName = {$regex: escapeRegex(String(req.query.customer)), $options: 'i'};
    const [total, items] = await Promise.all([Sales.Activity.countDocuments(filter), Sales.Activity.find(filter).sort({at: -1}).skip(skip).limit(limit).lean()]);
    sendPage(res, items, total, page, limit);
  }));

  // ---------------- Customer payments / collections ----------------
  const payBody = z.object({orderId: z.string().min(1), amount: z.number().positive().max(1e9), method: z.enum(['cash', 'bank_transfer', 'upi', 'card', 'cheque', 'other']), paymentDate: isoDay.optional(), reference: text(80).optional().default(''), notes: text(500).optional().default('')});
  async function applyPayment(session: mongoose.ClientSession, p: any, sign: 1 | -1) {
    const order: any = await Models.orders.findOne({id: p.orderId}).session(session).lean();
    if (order) await Models.customers.updateOne({id: order.customerId}, {$inc: {balance: -sign * p.amount}}, {session});
    const inv: any = await Models.invoices.findOne({id: p.orderId}).session(session).lean();
    if (inv) { const paid = Math.round((inv.paid + sign * p.amount) * 100) / 100; await Models.invoices.updateOne({id: inv.id}, {$set: {paid, status: paid >= inv.total ? 'Paid' : paid > 0 ? 'Partial' : 'Due'}}, {session}); }
  }
  app.get('/api/sales/payments', requireAuth, route(async (req, res) => {
    const me = sessionUser(req);
    const {page, limit, skip} = paging(req);
    const filter: any = {};
    if (me.role === 'salesman') filter.$or = [{salesmanId: me.id}, {orderId: {$in: (await Models.orders.find({createdBy: me.id}).select('id').lean()).map((o: any) => o.id)}}];
    else if (!(await permissionsFor(me.role)).includes('payment.record')) fail(403, 'You do not have permission for this action');
    if (req.query.status) filter.status = String(req.query.status);
    const [total, items] = await Promise.all([ErpModels.Payment.countDocuments(filter), ErpModels.Payment.find(filter).sort({createdAt: -1}).skip(skip).limit(limit).lean()]);
    const orders: any[] = await Models.orders.find({id: {$in: items.map((p: any) => p.orderId)}}).select('id customerName total createdBy').lean();
    const om = new Map(orders.map(o => [o.id, o]));
    sendPage(res, items.map((p: any) => ({...p, customerName: om.get(p.orderId)?.customerName, orderTotal: om.get(p.orderId)?.total})), total, page, limit);
  }));
  app.post('/api/sales/payments', requireAuth, route(async (req: Request, res) => {
    const me = sessionUser(req), perms = await permissionsFor(me.role);
    if (me.role !== 'salesman' && !perms.includes('payment.record')) fail(403, 'You do not have permission for this action');
    const b = parse(payBody, req.body);
    const r = await mutate(req, 'CUSTOMER_PAYMENT', async ({session, actor}) => {
      const order: any = await Models.orders.findOne({id: b.orderId}).session(session).lean();
      if (!order) fail(404, 'Order not found');
      if (me.role === 'salesman' && order.createdBy !== me.id) fail(403, 'You can only record collections for your own orders');
      if (['Pending', 'Rejected', 'Cancelled'].includes(order.status)) fail(409, `Payments cannot be recorded against a ${order.status.toLowerCase()} order`);
      const verified = me.role !== 'salesman' && perms.includes('payment.verify');
      const [p] = await ErpModels.Payment.create([{orderId: order.id, customerId: order.customerId, salesmanId: order.createdBy, amount: b.amount, method: b.method, paymentDate: b.paymentDate ? new Date(`${b.paymentDate}T12:00:00+05:30`) : new Date(), reference: b.reference, notes: b.notes, idempotencyKey: String(req.header('Idempotency-Key')), recordedBy: actor.id, status: verified ? 'VERIFIED' : 'UNVERIFIED', ...(verified ? {verifiedBy: actor.id, verifiedAt: new Date()} : {})}], {session});
      if (verified) await applyPayment(session, p, 1);
      const owner: any = order.createdBy ? await Models.users.findOne({id: order.createdBy}).select('id name role').lean() : null;
      await activity({type: verified ? 'PAYMENT_RECORDED' : 'COLLECTION_SUBMITTED', salesmanId: owner?.role === 'salesman' ? owner.id : undefined, salesmanName: owner?.role === 'salesman' ? owner.name : undefined, actor, customerId: order.customerId, customerName: order.customerName, orderId: order.id, amountPaise: paise(b.amount), status: p.status, description: verified ? `Payment of ₹${b.amount} recorded (${b.method})` : `Collection of ₹${b.amount} submitted for verification`, key: `PAYMENT:${p._id}`}, session);
      return {id: String(p._id), status: p.status};
    });
    res.status(r.replayed ? 200 : 201).json(r);
  }));
  for (const action of ['verify', 'reject', 'void'] as const) app.post(`/api/sales/payments/:id/${action}`, requireAuth, requirePerm(action === 'void' ? 'payment.void' : 'payment.verify'), route(async (req, res) => {
    const {reason} = parse(z.object({reason: text(300).optional().default('')}), req.body || {});
    if (action !== 'verify' && !reason) fail(400, 'A reason is required');
    const r = await mutate(req, `PAYMENT_${action.toUpperCase()}`, async ({session, actor}) => {
      const from = action === 'void' ? 'VERIFIED' : 'UNVERIFIED', to = action === 'verify' ? 'VERIFIED' : action === 'reject' ? 'REJECTED' : 'VOID';
      const p: any = await ErpModels.Payment.findOneAndUpdate({_id: req.params.id, status: from}, {$set: {status: to, ...(action === 'verify' ? {verifiedBy: actor.id, verifiedAt: new Date()} : {voidReason: reason})}}, {session, returnDocument: 'after'}).lean();
      if (!p) fail(409, `Only ${from.toLowerCase()} payments can be ${to.toLowerCase()}`);
      if (action === 'verify') await applyPayment(session, p, 1);
      if (action === 'void') await applyPayment(session, p, -1);
      const owner: any = await Models.users.findOne({id: p.salesmanId}).select('id name role').lean();
      await activity({type: `COLLECTION_${to}`, salesmanId: owner?.role === 'salesman' ? owner.id : undefined, salesmanName: owner?.name, actor, orderId: p.orderId, amountPaise: paise(p.amount), status: to, description: `Collection of ₹${p.amount} ${to.toLowerCase()} by ${actor.name}${reason ? `: ${reason}` : ''}`, key: `PAYMENT_${to}:${p._id}`}, session);
      return {id: String(p._id), status: to};
    });
    res.json(r);
  }));

  // ---------------- Salesman self-service ----------------
  app.get('/api/sales/me/dashboard', requireAuth, requirePerm('sales.self'), route(async (req, res) => {
    const me = sessionUser(req);
    const d = await loadData();
    const now = today(), monthStart = now.slice(0, 8) + '01';
    const targets: any[] = await Sales.Target.find({salesmanId: me.id, status: 'ACTIVE', endDate: {$gte: new Date(Date.now() - 31 * 86400000).toISOString().slice(0, 10)}}).sort({startDate: 1}).lean();
    const mine = d.orders.filter(o => o.createdBy === me.id);
    const byStatus = Object.fromEntries(['Pending', 'Approved', 'Processing', 'Dispatched', 'Delivered', 'Rejected', 'Cancelled'].map(s => [s, mine.filter(o => o.status === s).length]));
    res.json({
      today: now, policy: d.policy,
      targets: targets.map(t => ({...t, revisions: undefined, progress: targetProgress(t, d)})),
      thisMonth: metricsFor(d, me.id, monthStart, now), todayMetrics: metricsFor(d, me.id, now, now),
      ordersByStatus: byStatus, totalOrders: mine.length,
      activities: await Sales.Activity.find({salesmanId: me.id}).sort({at: -1}).limit(15).lean(),
    });
  }));
  // Insights: one-page business health for the signed-in salesman. Own data only. Every figure reuses
  // metricsFor / targetProgress / COUNTED, so numbers always agree with the dashboard and target pages.
  app.get('/api/sales/me/insights', requireAuth, requirePerm('sales.self'), route(async (req, res) => {
    const me = sessionUser(req);
    const now = today();
    const q = parse(z.object({from: isoDay.optional(), to: isoDay.optional()}), {from: req.query.from || undefined, to: req.query.to || undefined});
    const from = q.from || now.slice(0, 8) + '01', to = q.to || now;
    if (from > to) fail(400, 'The start date must be on or before the end date');
    if (daysIn(from, to) > 400) fail(400, 'Choose a period of at most 400 days');
    const d = await loadData();
    const prev = previousRange(from, to);
    const counted = (o: any) => o.createdBy === me.id && COUNTED[d.policy].includes(o.status);
    const mineCounted = d.orders.filter(counted);
    const inPeriod = mineCounted.filter(o => inRange(countedDate(o, d.policy), from, to));

    // --- primary sales target (the active SALES_AMOUNT target overlapping the period the most) ---
    const targetDocs: any[] = await Sales.Target.find({salesmanId: me.id, status: 'ACTIVE', startDate: {$lte: to}, endDate: {$gte: from}}).sort({startDate: 1}).lean();
    const targets = targetDocs.map(t => ({id: String(t._id), name: t.name, type: t.type, period: t.period, targetValue: t.targetValue, startDate: t.startDate, endDate: t.endDate, instructions: t.instructions || '', progress: targetProgress(t, d)}));
    const overlap = (t: {startDate: string; endDate: string}) => Math.max(0, daysIn(t.startDate > from ? t.startDate : from, t.endDate < to ? t.endDate : to));
    const salesTarget = targets.filter(t => t.type === 'SALES_AMOUNT' && overlap(t) > 0).sort((a, b) => overlap(b) - overlap(a) || daysIn(a.startDate, a.endDate) - daysIn(b.startDate, b.endDate))[0];
    let target: any = null;
    if (salesTarget) {
      const span = daysIn(salesTarget.startDate, salesTarget.endDate), perDay = salesTarget.targetValue / span;
      const elapsed = now < salesTarget.startDate ? 0 : daysIn(salesTarget.startDate, now < salesTarget.endDate ? now : salesTarget.endDate);
      const daysRemaining = salesTarget.progress.state === 'ACTIVE' ? salesTarget.progress.daysLeft + 1 : 0; // includes today
      target = {
        ...salesTarget, perDayPaise: Math.round(perDay),
        prorated: overlap(salesTarget) < span, periodTargetPaise: Math.round(perDay * overlap(salesTarget)),
        daysRemaining, requiredPerDayPaise: daysRemaining ? Math.ceil(salesTarget.progress.remaining / daysRemaining) : 0,
        projectedPaise: elapsed > 0 ? Math.round(salesTarget.progress.achieved / elapsed * span) : null,
      };
    }

    // --- sales series for the chart ---
    const grain: 'hour' | 'day' | 'month' = from === to ? 'hour' : daysIn(from, to) <= 62 ? 'day' : 'month';
    const keyOf = (dt: any) => grain === 'hour' ? String(hourOf(dt)).padStart(2, '0') : grain === 'day' ? ymd(dt) : ymd(dt).slice(0, 7);
    const keys: string[] = [];
    if (grain === 'hour') for (let h = 0; h < 24; h++) keys.push(String(h).padStart(2, '0'));
    else if (grain === 'day') for (let k = from; k <= to; k = shiftIso(k, 1)) keys.push(k);
    else for (let k = from.slice(0, 7); k <= to.slice(0, 7); k = nextMonth(k)) keys.push(k);
    const sums = new Map<string, {salesPaise: number; orders: number}>(keys.map(k => [k, {salesPaise: 0, orders: 0}]));
    const daily = new Map<string, number>();
    for (const o of inPeriod) {
      const at = countedDate(o, d.policy), b = sums.get(keyOf(at));
      if (b) { b.salesPaise += paise(o.total); b.orders++; }
      daily.set(ymd(at), (daily.get(ymd(at)) || 0) + paise(o.total));
    }
    const bucketTarget = (k: string) => {
      if (!target || grain === 'hour') return null;
      const [bs, be] = grain === 'day' ? [k, k] : [k + '-01', k + '-' + String(lastDay(k)).padStart(2, '0')];
      const s = [bs, from, target.startDate].sort().pop()!, e = [be, to, target.endDate].sort()[0];
      return s <= e ? Math.round(target.perDayPaise * daysIn(s, e)) : 0;
    };
    const series = keys.map(k => ({key: k, ...sums.get(k)!, targetPaise: bucketTarget(k)}));
    const best = [...daily.entries()].sort((a, b) => b[1] - a[1])[0];

    // --- products & customers in the period ---
    const productSales = new Map<string, {name: string; qty: number; valuePaise: number}>();
    const customerSales = new Map<string, {id: string; name: string; orders: number; valuePaise: number}>();
    for (const o of inPeriod) {
      for (const l of o.items) { const x = productSales.get(l.productId) || {name: l.name, qty: 0, valuePaise: 0}; x.qty += l.qty; x.valuePaise += paise(l.qty * l.price); productSales.set(l.productId, x); }
      const c = customerSales.get(o.customerId) || {id: o.customerId, name: o.customerName, orders: 0, valuePaise: 0}; c.orders++; c.valuePaise += paise(o.total); customerSales.set(o.customerId, c);
    }

    // --- customer health: new vs repeat buyers, customers slipping away ---
    const firstAt = new Map<string, string>(), lastAt = new Map<string, {name: string; last: string; valuePaise: number}>();
    for (const o of mineCounted) {
      const k = ymd(countedDate(o, d.policy));
      if (!firstAt.has(o.customerId) || k < firstAt.get(o.customerId)!) firstAt.set(o.customerId, k);
      const l = lastAt.get(o.customerId) || {name: o.customerName, last: k, valuePaise: 0};
      if (k > l.last) l.last = k; l.valuePaise += paise(o.total); lastAt.set(o.customerId, l);
    }
    const buyers = [...customerSales.keys()], repeat = buyers.filter(id => firstAt.get(id)! < from).length;
    const slipCutoff = shiftIso(now, -SLIP_DAYS);
    const slipping = [...lastAt.entries()].filter(([, v]) => v.last < slipCutoff).map(([id, v]) => ({id, name: v.name, lastOrder: v.last, daysSince: daysIn(v.last, now) - 1, valuePaise: v.valuePaise})).sort((a, b) => b.valuePaise - a.valuePaise);

    // --- dues (as of today, same formula as metricsFor.outstandingPaise) ---
    const paidByOrder = new Map<string, number>();
    for (const p of d.payments) if (p.status === 'VERIFIED' && paymentSalesman(d, p) === me.id) paidByOrder.set(p.orderId, (paidByOrder.get(p.orderId) || 0) + paise(p.amount));
    const dueRows = d.orders.filter(o => o.createdBy === me.id && ['Dispatched', 'Delivered'].includes(o.status))
      .map(o => ({orderId: o.id, customerId: o.customerId, customerName: o.customerName, amountPaise: Math.max(0, paise(o.total) - (paidByOrder.get(o.id) || 0)), ageDays: daysIn(ymd(o.dispatchedAt || o.updatedAt), now) - 1}))
      .filter(r => r.amountPaise > 0);
    const dueByCustomer = new Map<string, {id: string; name: string; amountPaise: number; oldestDays: number}>();
    for (const r of dueRows) { const c = dueByCustomer.get(r.customerId) || {id: r.customerId, name: r.customerName, amountPaise: 0, oldestDays: 0}; c.amountPaise += r.amountPaise; c.oldestDays = Math.max(c.oldestDays, r.ageDays); dueByCustomer.set(r.customerId, c); }
    const oldest = [...dueRows].sort((a, b) => b.ageDays - a.ageDays)[0];

    // --- collections by method & data completeness for the period ---
    const myPayments = d.payments.filter(p => paymentSalesman(d, p) === me.id && inRange(p.paymentDate, from, to));
    const byMethod: Record<string, number> = {};
    for (const p of myPayments.filter(p => p.status === 'VERIFIED')) byMethod[p.method] = (byMethod[p.method] || 0) + paise(p.amount);
    const created = d.orders.filter(o => o.createdBy === me.id && inRange(o.createdAt, from, to));
    const pendingOrders = created.filter(o => o.status === 'Pending').length, unverified = myPayments.filter(p => p.status === 'UNVERIFIED').length;
    const entries = created.length + myPayments.filter(p => ['VERIFIED', 'UNVERIFIED'].includes(p.status)).length;

    const body = {
      period: {from, to, days: daysIn(from, to), today: now, grain}, previous: prev, policy: d.policy,
      metrics: metricsFor(d, me.id, from, to), previousMetrics: metricsFor(d, me.id, prev.from, prev.to),
      target, targets, series, bestDay: best ? {date: best[0], salesPaise: best[1]} : null,
      products: [...productSales.entries()].map(([id, v]) => ({id, ...v})).sort((a, b) => b.valuePaise - a.valuePaise).slice(0, 8),
      customers: [...customerSales.values()].sort((a, b) => b.valuePaise - a.valuePaise).slice(0, 8),
      customerHealth: {buyers: buyers.length, repeat, new: buyers.length - repeat, slippingDays: SLIP_DAYS, slippingCount: slipping.length, slipping: slipping.slice(0, 5)},
      dues: {totalPaise: dueRows.reduce((a, r) => a + r.amountPaise, 0), recentPaise: dueRows.filter(r => r.ageDays <= 30).reduce((a, r) => a + r.amountPaise, 0), olderPaise: dueRows.filter(r => r.ageDays > 30).reduce((a, r) => a + r.amountPaise, 0), oldest: oldest ? {customerName: oldest.customerName, ageDays: oldest.ageDays, amountPaise: oldest.amountPaise} : null, top: [...dueByCustomer.values()].sort((a, b) => b.amountPaise - a.amountPaise).slice(0, 3)},
      collectionsByMethod: byMethod,
      completeness: {pct: entries ? Math.round((1 - (pendingOrders + unverified) / entries) * 100) : 100, pendingOrders, unverifiedCollections: unverified},
    };
    if (req.query.format === 'csv') {
      const rows: Array<Array<string | number>> = [['Section', 'Item', 'Value'], ['Period', 'From', from], ['Period', 'To', to],
        ['Sales', 'Sales counted (₹)', body.metrics.salesPaise / 100], ['Sales', 'Previous period (₹)', body.previousMetrics.salesPaise / 100], ['Sales', 'Orders counted', body.metrics.countedOrders],
        ...(target ? [['Target', target.name, target.targetValue / 100], ['Target', 'Achieved (₹)', target.progress.achieved / 100], ['Target', 'Remaining (₹)', target.progress.remaining / 100]] as Array<Array<string | number>> : []),
        ['Collections', 'Verified this period (₹)', body.metrics.collectedPaise / 100], ['Dues', 'Outstanding today (₹)', body.dues.totalPaise / 100],
        ...series.map(s => ['Sales by ' + grain, s.key, s.salesPaise / 100]), ...body.products.map(p => ['Top products (₹)', `${p.name} × ${p.qty}`, p.valuePaise / 100]), ...body.customers.map(c => ['Top customers (₹)', `${c.name} (${c.orders} orders)`, c.valuePaise / 100])];
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="my-insights-${from}-to-${to}.csv"`);
      return res.send('﻿' + rows.map(r => r.map(c => /[",\r\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : String(c)).join(',')).join('\r\n'));
    }
    res.json(body);
  }));
  app.get('/api/sales/catalogue', requireAuth, requirePerm('catalogue.view'), route(async (req, res) => {
    const me = sessionUser(req);
    const filter: any = {status: 'active'};
    if (me.role === 'salesman') {
      const a: any = await ErpModels.Assignment.findOne({salesmanId: me.id, active: true}).lean();
      if (a?.productIds?.length || a?.categoryIds?.length) {
        const cats: any[] = a.categoryIds?.length ? await ErpModels.Category.find({_id: {$in: a.categoryIds.filter((x: string) => mongoose.isValidObjectId(x))}}).select('name').lean() : [];
        filter.$or = [...(a.productIds?.length ? [{id: {$in: a.productIds}}] : []), ...(cats.length ? [{category: {$in: cats.map(c => c.name)}}] : [])];
      }
    }
    const q = String(req.query.q || '').trim();
    if (q) filter.$and = [{$or: ['name', 'sku', 'category'].map(f => ({[f]: {$regex: escapeRegex(q), $options: 'i'}}))}];
    if (req.query.category) filter.category = String(req.query.category);
    const {page, limit, skip} = paging(req);
    const [total, products, categories] = await Promise.all([Models.products.countDocuments(filter), Models.products.find(filter).sort({sortOrder: 1, name: 1}).skip(skip).limit(limit).lean(), Models.products.distinct('category', {status: 'active'})]);
    const profiles: any[] = await Inv.ProductProfile.find({productId: {$in: products.map((p: any) => p.id)}}).lean();
    const pm = new Map(profiles.map(p => [p.productId, p]));
    // Salesmen get selling price, availability, images and specs — never cost, margin or supplier data.
    sendPage(res, products.map((p: any) => { const pr = pm.get(p.id); return {id: p.id, name: p.name, sku: p.sku, category: p.category, unit: p.unit, price: p.price, available: Math.max(0, p.stock - (p.reservedStock || 0)), images: [...(pr?.images || [])].sort((a: any, b: any) => Number(b.view === 'MAIN') - Number(a.view === 'MAIN')).map((i: any) => i.url), specs: pr ? {doorCount: pr.doorCount, drawerCount: pr.drawerCount, heightIn: pr.heightIn, widthIn: pr.widthIn, depthIn: pr.depthIn, material: pr.material, colour: pr.colour, finish: pr.finish, lockType: pr.lockType, handleType: pr.handleType, features: pr.features, description: pr.description, model: pr.model, design: pr.design} : null}; }), total, page, limit);
    void categories;
  }));
  app.get('/api/sales/catalogue/categories', requireAuth, requirePerm('catalogue.view'), route(async (_req, res) => { res.json((await Models.products.distinct('category', {status: 'active'})).sort()); }));
}
