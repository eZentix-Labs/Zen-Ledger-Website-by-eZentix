// Bills: list footer, KPIs and charts must agree, and match the Order desk (throwaway local replica set).
import {createServer, Server} from 'node:http';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {startReplSet} from './test-mongo.js';
import {MongoRepository} from './repository.js';
import {Store} from './types.js';
import {Inv} from './inventory/models.js';

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
    {id: 'p1', name: 'Double Door Almirah', sku: 'DD-1', category: 'Double Door', unit: 'piece', price: 11800, stock: 20, reservedStock: 0, reorder: 2, status: 'active'},
    {id: 'p2', name: 'Locker Cabinet', sku: 'LK-1', category: 'Locker', unit: 'piece', price: 5000, stock: 5, reservedStock: 0, reorder: 1, status: 'active'},
  ],
  customers: [{id: 'c1', name: 'Kalinga Steel Traders', phone: '9000000099', balance: 0, createdBy: 'u-s1'}, {id: 'c2', name: 'Customer Two', phone: '9000000098', balance: 0, createdBy: 'u-s2'}],
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
  await Inv.ProductProfile.create([{productId: 'p1', gstRateBps: 1800, design: 'FM 901'}, {productId: 'p2'}]);
  const app = await import('./server.js');
  app.installTestState(await repo.reload(), repo);
  server = createServer(app.app); await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
  url = `http://127.0.0.1:${(server.address() as any).port}`;
  for (const [who, email] of [['owner', 'owner@test.local'], ['acc', 'acc@test.local'], ['s1', 's1@test.local'], ['s2', 's2@test.local']]) tokens[who] = ok(await call('', 'POST', '/api/auth/login', {email, password: 'test-password-1'})).token;
});
afterAll(async () => { server?.close(); await repo?.close(); await replSet?.stop(); });

let full = '', part = '', unpaid = '', gone = '';
describe('Bills', () => {
  it('bills are approved-or-later orders; pending ones are not bills', async () => {
    full = ok(await call('s1', 'POST', '/api/orders', {customerId: 'c1', items: [{productId: 'p1', qty: 1}]})).id;   // 11 800
    part = ok(await call('s1', 'POST', '/api/orders', {customerId: 'c1', items: [{productId: 'p1', qty: 2}]})).id;   // 23 600
    unpaid = ok(await call('s2', 'POST', '/api/orders', {customerId: 'c2', items: [{productId: 'p2', qty: 1}]})).id; // 5 000
    gone = ok(await call('s2', 'POST', '/api/orders', {customerId: 'c2', items: [{productId: 'p2', qty: 1}]})).id;   // cancelled after approval
    ok(await call('s1', 'POST', '/api/orders', {customerId: 'c1', items: [{productId: 'p2', qty: 1}]}));             // stays pending
    for (const id of [full, part, unpaid, gone]) ok(await call('owner', 'PATCH', `/api/orders/${id}/status`, {status: 'Approved'}));
    ok(await call('owner', 'PATCH', `/api/orders/${gone}/status`, {status: 'Cancelled', reason: 'Customer changed mind'}));
    ok(await call('acc', 'POST', '/api/sales/payments', {orderId: full, amount: 11800, method: 'cash'}));
    ok(await call('acc', 'POST', '/api/sales/payments', {orderId: part, amount: 5000, method: 'upi'}));
    const list = ok(await call('owner', 'GET', `/api/admin/bills?from=${today}&to=${today}`));
    expect(list.total).toBe(4);
    expect(list.tabs).toMatchObject({all: 4, PAID: 1, PARTIAL: 1, UNPAID: 1, overdue: 0, cancelled: 1});
    expect(list.totals).toMatchObject({count: 4, activeCount: 3, billedPaise: 4_040_000, collectedPaise: 1_680_000, duePaise: 2_360_000, avgPaise: Math.round(4_040_000 / 3), overdueCount: 0});
  });

  it('KPIs, footer and charts describe the same bills, and match the Order desk', async () => {
    const q = `from=${today}&to=${today}`;
    const list = ok(await call('owner', 'GET', `/api/admin/bills?${q}`));
    const ins = ok(await call('owner', 'GET', `/api/admin/bills/insights?${q}`));
    expect(ins.totals).toEqual(list.totals);
    expect(ins.series.keys).toHaveLength(24);
    const s = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
    expect(s(ins.series.billed)).toBe(ins.totals.billedPaise);
    expect(s(ins.series.collected)).toBe(ins.totals.collectedPaise);
    expect(ins.status).toEqual({PAID: 1, PARTIAL: 1, UNPAID: 1, cancelled: 1});
    expect(ins.topCustomersByDue.map((c: any) => [c.id, c.duePaise])).toEqual([['c1', 1_860_000], ['c2', 500_000]]);
    expect(s(ins.ageing.map((a: any) => a.duePaise))).toBe(ins.totals.duePaise);
    // per-bill money is the Order desk's (orderFacts)
    const desk = ok(await call('owner', 'GET', '/api/admin/orders?limit=200'));
    for (const b of list.items) {
      const o = desk.items.find((x: any) => x.id === b.id);
      expect([b.totalPaise, b.paidPaise, b.duePaise]).toEqual([o.totalPaise, o.paidPaise, o.duePaise]);
    }
  });

  it('tabs and filters apply to KPIs exactly as to the list; search finds item names', async () => {
    for (const f of ['tab=PARTIAL', 'tab=cancelled', 'salesman=u-s2', 'customer=c1', 'q=locker', 'min=10000', 'max=6000']) {
      const list = ok(await call('owner', 'GET', `/api/admin/bills?${f}`));
      const ins = ok(await call('owner', 'GET', `/api/admin/bills/insights?${f}`));
      expect(ins.totals).toEqual(list.totals);
      expect(list.total).toBe(list.totals.count);
    }
    expect(ok(await call('owner', 'GET', '/api/admin/bills?tab=PARTIAL')).items.map((b: any) => b.id)).toEqual([part]);
    expect(ok(await call('owner', 'GET', '/api/admin/bills?q=locker')).total).toBe(2);
  });

  it('bill detail: lines with estimated GST (from design rate), payments, permissions', async () => {
    const d = ok(await call('owner', 'GET', `/api/admin/bills/${part}`));
    expect(d.lines[0]).toMatchObject({design: 'FM 901', qty: 2, ratePaise: 1_180_000, totalPaise: 2_360_000, gstRateBps: 1800, gstRateKnown: true, taxablePaise: 2_000_000, cgstPaise: 180_000, sgstPaise: 180_000});
    expect(d.tax).toMatchObject({taxablePaise: 2_000_000, estimated: true, missingRates: 0});
    expect(d.payments).toMatchObject([{amountPaise: 500_000, method: 'upi', status: 'VERIFIED'}]);
    expect(d.can).toEqual({recordPayment: true, cancel: true});
    const u = ok(await call('owner', 'GET', `/api/admin/bills/${unpaid}`));
    expect(u.tax.missingRates).toBe(1); // p2 has no GST rate: reported, not hidden
    expect((await call('owner', 'GET', '/api/admin/bills/nope')).status).toBe(404);
  });

  it('New bill form data: catalogue (design, GST, available stock) and customers (balance, last bill)', async () => {
    const cat = ok(await call('owner', 'GET', '/api/admin/bills/catalogue'));
    expect(cat.find((p: any) => p.id === 'p1')).toMatchObject({design: 'FM 901', pricePaise: 1_180_000, gstRateBps: 1800});
    expect(cat.find((p: any) => p.id === 'p2')).toMatchObject({gstRateBps: null});
    expect(JSON.stringify(cat)).not.toMatch(/cost/i);
    const cust = ok(await call('owner', 'GET', '/api/admin/bills/customers'));
    expect(cust.find((c: any) => c.id === 'c1')).toMatchObject({name: 'Kalinga Steel Traders', lastBillDate: today, salesmanName: 'Sales One'});
    // a bill made the way the New bill page does it: create → approve → pay
    const id = ok(await call('owner', 'POST', '/api/orders', {customerId: 'c2', items: [{productId: 'p1', qty: 1}]})).id;
    ok(await call('owner', 'PATCH', `/api/orders/${id}/status`, {status: 'Approved'}));
    ok(await call('owner', 'POST', '/api/sales/payments', {orderId: id, amount: 11800, method: 'upi', reference: 'UTR1'}));
    expect(ok(await call('owner', 'GET', `/api/admin/bills/${id}`))).toMatchObject({payStatus: 'PAID', duePaise: 0, salesmanName: 'Owner'});
  });

  it('salesmen only ever see their own bills; CSV export has a totals row', async () => {
    const mine = ok(await call('s1', 'GET', '/api/admin/bills'));
    expect(mine.items.every((b: any) => b.salesmanId === 'u-s1')).toBe(true);
    expect((await call('s1', 'GET', `/api/admin/bills/${unpaid}`)).status).toBe(404);
    const csv = await fetch(`${url}/api/admin/bills?format=csv`, {headers: {Authorization: `Bearer ${tokens.owner}`}});
    expect(csv.headers.get('content-type')).toMatch(/text\/csv/);
    expect((await csv.text()).trim().split('\r\n').pop()).toMatch(/^Total,/);
  });
});
