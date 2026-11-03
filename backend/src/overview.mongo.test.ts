// Admin Overview + Order desk: every figure must agree across endpoints (throwaway local replica set).
import {createServer, Server} from 'node:http';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {startReplSet} from './test-mongo.js';
import {MongoRepository} from './repository.js';
import {Store} from './types.js';

process.env.READ_REFRESH_MS = '0';
const pw = bcrypt.hashSync('test-password-1', 4);
const store = (): Store => ({
  users: [
    {id: 'u-owner', name: 'Owner', email: 'owner@test.local', password: pw, role: 'owner'},
    {id: 'u-acc', name: 'Accountant', email: 'acc@test.local', password: pw, role: 'accounts'},
    {id: 'u-s1', name: 'Sales One', email: 's1@test.local', phone: '9000000001', password: pw, role: 'salesman'},
    {id: 'u-s2', name: 'Sales Two', email: 's2@test.local', phone: '9000000002', password: pw, role: 'salesman'},
  ],
  products: [
    {id: 'p1', name: 'Double Door Almirah', sku: 'DD-1', category: 'Double Door', unit: 'piece', price: 10000, stock: 20, reservedStock: 0, reorder: 2, status: 'active'},
    {id: 'p2', name: 'Locker Cabinet', sku: 'LK-1', category: 'Locker', unit: 'piece', price: 5000, stock: 1, reservedStock: 0, reorder: 3, status: 'active'},
  ],
  customers: [{id: 'c1', name: 'Customer One', phone: '9000000099', balance: 0, createdBy: 'u-s1'}, {id: 'c2', name: 'Customer Two', phone: '9000000098', balance: 0, createdBy: 'u-s2'}],
  orders: [], invoices: [], settings: {businessName: 'Test', currency: 'INR', stockPolicy: 'approval', taxEnabled: false}, audit: [], inventoryMovements: [],
});
let replSet: any; let repo: MongoRepository; let server: Server; let url = '';
const tokens: Record<string, string> = {};
async function call(who: string, method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = {'Content-Type': 'application/json', Authorization: `Bearer ${tokens[who] || ''}`};
  if (method !== 'GET') headers['Idempotency-Key'] = crypto.randomUUID();
  const res = await fetch(url + path, {method, headers, body: body === undefined ? undefined : JSON.stringify(body)});
  const t = await res.text();
  let parsed: any = null; try { parsed = t ? JSON.parse(t) : null; } catch { parsed = t; }
  return {status: res.status, body: parsed};
}
const ok = (r: {status: number; body: any}) => { if (r.status >= 300) throw new Error(`HTTP ${r.status}: ${JSON.stringify(r.body)}`); return r.body; };
const today = new Intl.DateTimeFormat('en-CA', {timeZone: process.env.BUSINESS_TIMEZONE || 'Asia/Kolkata'}).format(new Date());

beforeAll(async () => {
  ({replSet} = await startReplSet());
  repo = new MongoRepository(); await repo.connect(replSet.getUri('zenledger_test'));
  await repo.commit({users: [], products: [], customers: [], orders: [], invoices: [], settings: undefined as any, audit: [], inventoryMovements: []}, store(), true);
  const app = await import('./server.js');
  app.installTestState(await repo.reload(), repo);
  server = createServer(app.app); await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
  url = `http://127.0.0.1:${(server.address() as any).port}`;
  for (const [who, email] of [['owner', 'owner@test.local'], ['acc', 'acc@test.local'], ['s1', 's1@test.local'], ['s2', 's2@test.local']]) tokens[who] = ok(await call('', 'POST', '/api/auth/login', {email, password: 'test-password-1'})).token;
});
afterAll(async () => { server?.close(); await repo?.close(); await replSet?.stop(); });

let a = '', b = '', c = '';
describe('Admin overview and order desk', () => {
  it('builds orders through the existing workflow', async () => {
    a = ok(await call('s1', 'POST', '/api/orders', {customerId: 'c1', items: [{productId: 'p1', qty: 2}, {productId: 'p2', qty: 1}]})).id; // 25 000
    b = ok(await call('s2', 'POST', '/api/orders', {customerId: 'c2', items: [{productId: 'p1', qty: 1}]})).id;                          // 10 000
    c = ok(await call('s1', 'POST', '/api/orders', {customerId: 'c1', items: [{productId: 'p1', qty: 1}]})).id;                          // 10 000
    ok(await call('owner', 'PATCH', `/api/orders/${a}/status`, {status: 'Approved'}));
    ok(await call('owner', 'PATCH', `/api/orders/${a}/status`, {status: 'Dispatched'}));
    ok(await call('owner', 'PATCH', `/api/orders/${b}/status`, {status: 'Approved'}));
    ok(await call('owner', 'PATCH', `/api/orders/${c}/status`, {status: 'Cancelled', reason: 'Customer changed mind'}));
    ok(await call('owner', 'POST', '/api/sales/payments', {orderId: a, amount: 5000, method: 'upi'}));
    ok(await call('owner', 'POST', '/api/sales/payments', {orderId: b, amount: 10000, method: 'cash'}));
  });

  it('overview KPIs agree with the order desk totals and the salesman achievement rule', async () => {
    const o = ok(await call('owner', 'GET', `/api/admin/overview?from=${today}&to=${today}`));
    expect(o.bucket).toBe('hour');
    expect(o.kpi).toMatchObject({salesPaise: 3_500_000, countedOrders: 2, ordersCreated: 3, collectedPaise: 1_500_000, aovPaise: 1_750_000, cancelled: 1, buyers: 2, newCustomers: 2});
    expect(o.duePaise).toBe(2_000_000);                    // 25 000 − 5 000 on A; B fully paid
    expect(o.finance).toMatchObject({duePaise: 2_000_000, dueTodayPaise: 2_000_000, collectedTodayPaise: 1_500_000});
    expect(o.statusCounts).toEqual({Dispatched: 1, Approved: 1, Cancelled: 1});
    expect(o.paymentMethods).toEqual([{method: 'cash', valuePaise: 1_000_000}, {method: 'upi', valuePaise: 500_000}]);
    expect(o.topProducts[0]).toMatchObject({id: 'p1', valuePaise: 3_000_000, qty: 3});
    expect(o.categories.map((x: any) => x.name)).toEqual(['Double Door', 'Locker']);
    expect(o.operations).toMatchObject({pending: 0, inProgress: 1, dispatched: 1, lowStock: 1});
    expect(o.management.topPerformer).toMatchObject({id: 'u-s1', salesPaise: 2_500_000});
    expect(o.recent).toHaveLength(3);
    expect(o.series.sales.reduce((x: number, y: number) => x + y, 0)).toBe(o.kpi.salesPaise);

    const desk = ok(await call('owner', 'GET', `/api/admin/orders?from=${today}&to=${today}`));
    expect(desk.totals).toMatchObject({count: 3, valuePaise: 4_500_000, paidPaise: 1_500_000, duePaise: o.duePaise, countedValuePaise: o.kpi.salesPaise, cancelled: 1});
    expect(desk.statusCounts).toEqual(o.statusCounts);
    expect(desk.analytics.methods).toEqual({upi: 500_000, cash: 1_000_000});
    const row = desk.items.find((x: any) => x.id === a);
    expect(row).toMatchObject({payStatus: 'PARTIAL', paidPaise: 500_000, duePaise: 2_000_000, methods: ['upi'], salesmanName: 'Sales One', customerPhone: '9000000099', lines: 2, qty: 3});
    expect(desk.items.find((x: any) => x.id === c)).toMatchObject({payStatus: 'NA', duePaise: 0});
  });

  it('filters, sorts and exports exactly the filtered result', async () => {
    const paid = ok(await call('owner', 'GET', '/api/admin/orders?pay=PAID'));
    expect(paid.items.map((x: any) => x.id)).toEqual([b]);
    const st = ok(await call('owner', 'GET', '/api/admin/orders?status=Cancelled'));
    expect(st.items.map((x: any) => x.id)).toEqual([c]);
    expect(st.statusCounts).toMatchObject({Cancelled: 1, Approved: 1, Dispatched: 1}); // tabs ignore the status filter
    expect(ok(await call('owner', 'GET', '/api/admin/orders?q=locker')).items.map((x: any) => x.id)).toEqual([a]);
    expect(ok(await call('owner', 'GET', '/api/admin/orders?q=9000000098')).items.map((x: any) => x.id)).toEqual([b]);
    expect(ok(await call('owner', 'GET', '/api/admin/orders?salesman=u-s2')).items.map((x: any) => x.id)).toEqual([b]);
    expect(ok(await call('owner', 'GET', '/api/admin/orders?min=20000')).items.map((x: any) => x.id)).toEqual([a]);
    expect(ok(await call('owner', 'GET', '/api/admin/orders?method=cash')).items.map((x: any) => x.id)).toEqual([b]);
    expect(ok(await call('owner', 'GET', '/api/admin/orders?sort=total&dir=asc')).items[2].id).toBe(a);
    const csv = await call('owner', 'GET', '/api/admin/orders?status=Approved,Dispatched&format=csv');
    expect(csv.status).toBe(200);
    expect(String(csv.body).trim().split('\n')).toHaveLength(3);
    expect((await call('owner', 'GET', '/api/admin/orders?from=2026-13-01')).status).toBe(400);
  });

  it('order detail: lines, payments, timeline with actor, allowed next statuses', async () => {
    const d = ok(await call('owner', 'GET', `/api/admin/orders/${a}`));
    expect(d.lines).toHaveLength(2);
    expect(d.lines[0]).toMatchObject({sku: 'DD-1', category: 'Double Door', lineTotalPaise: 2_000_000});
    expect(d.payments).toHaveLength(1);
    expect(d.payments[0]).toMatchObject({amountPaise: 500_000, method: 'upi', status: 'VERIFIED'});
    expect(d.timeline.map((t: any) => t.type)).toEqual(expect.arrayContaining(['ORDER_SUBMITTED', 'ORDER_APPROVED', 'ORDER_DISPATCHED']));
    expect(d.next).toEqual(['Delivered']);
    expect(d.can).toMatchObject({changeStatus: true, recordPayment: true, invoice: true});
    expect((await call('owner', 'GET', '/api/admin/orders/nope')).status).toBe(404);
  });

  it('roles: accountant sees everything, salesman only their own orders and no overview', async () => {
    expect(ok(await call('acc', 'GET', '/api/admin/overview')).kpi.salesPaise).toBe(3_500_000);
    expect((await call('s1', 'GET', '/api/admin/overview')).status).toBe(403);
    const mine = ok(await call('s1', 'GET', '/api/admin/orders'));
    expect(mine.items.map((x: any) => x.id).sort()).toEqual([a, c].sort());
    expect((await call('s1', 'GET', `/api/admin/orders/${b}`)).status).toBe(404);
    expect(ok(await call('s1', 'GET', `/api/admin/orders/${a}`)).next).toEqual([]);
    expect((await call('', 'GET', '/api/admin/orders')).status).toBe(401);
  });
});
