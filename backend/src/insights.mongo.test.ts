// Admin Insights: every figure must agree with the Overview / Order desk (throwaway local replica set).
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
  // p1: 18% GST, ₹6 000 cost. p2: no GST rate, no cost (must be reported, not guessed).
  await Inv.ProductProfile.create([{productId: 'p1', gstRateBps: 1800, avgCostPaise: 600_000}, {productId: 'p2'}]);
  const app = await import('./server.js');
  app.installTestState(await repo.reload(), repo);
  server = createServer(app.app); await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
  url = `http://127.0.0.1:${(server.address() as any).port}`;
  for (const [who, email] of [['owner', 'owner@test.local'], ['acc', 'acc@test.local'], ['s1', 's1@test.local'], ['s2', 's2@test.local']]) tokens[who] = ok(await call('', 'POST', '/api/auth/login', {email, password: 'test-password-1'})).token;
});
afterAll(async () => { server?.close(); await repo?.close(); await replSet?.stop(); });

describe('Admin insights', () => {
  it('builds bills through the existing workflow', async () => {
    const a = ok(await call('s1', 'POST', '/api/orders', {customerId: 'c1', items: [{productId: 'p1', qty: 2}, {productId: 'p2', qty: 1}]})).id; // 25 000
    const b = ok(await call('s2', 'POST', '/api/orders', {customerId: 'c2', items: [{productId: 'p1', qty: 1}]})).id;                          // 10 000
    const c = ok(await call('s1', 'POST', '/api/orders', {customerId: 'c1', items: [{productId: 'p1', qty: 1}]})).id;                          // 10 000, cancelled
    ok(await call('owner', 'PATCH', `/api/orders/${a}/status`, {status: 'Approved'}));
    ok(await call('owner', 'PATCH', `/api/orders/${a}/status`, {status: 'Dispatched'}));
    ok(await call('owner', 'PATCH', `/api/orders/${b}/status`, {status: 'Approved'}));
    ok(await call('owner', 'PATCH', `/api/orders/${c}/status`, {status: 'Cancelled', reason: 'Customer changed mind'}));
    ok(await call('owner', 'POST', '/api/sales/payments', {orderId: a, amount: 5000, method: 'upi'}));
    ok(await call('owner', 'POST', '/api/sales/payments', {orderId: b, amount: 10000, method: 'cash'}));
  });

  it('uses the same billed / collected / due as the Overview', async () => {
    const o = ok(await call('owner', 'GET', `/api/admin/overview?from=${today}&to=${today}`));
    const i = ok(await call('owner', 'GET', `/api/admin/insights?from=${today}&to=${today}`));
    expect(i.kpi.billedPaise).toBe(o.kpi.salesPaise);
    expect(i.kpi.collectedPaise).toBe(o.kpi.collectedPaise);
    expect(i.kpi.duePaise).toBe(o.finance.duePaise);
    expect(i.kpi.bills).toBe(o.kpi.countedOrders);
    expect(i.kpi.avgBillPaise).toBe(o.kpi.aovPaise);
    expect(i.kpi.activeDealers).toBe(o.kpi.buyers);
  });

  it('backs GST out of GST-inclusive prices and leaves uncosted designs out of profit', async () => {
    const i = ok(await call('owner', 'GET', `/api/admin/insights?from=${today}&to=${today}`));
    // p1 lines: 20 000 → 16 949.15 and 10 000 → 8 474.58 net at 18%; p2 has no rate → counted at 0% and reported.
    expect(i.kpi).toMatchObject({billedPaise: 3_500_000, netSalesPaise: 3_042_373, gstPaise: 457_627});
    expect(i.kpi.netSalesPaise + i.kpi.gstPaise).toBe(i.kpi.billedPaise);
    expect(i.ladder).toMatchObject({cogsPaise: 1_800_000, grossProfitPaise: 742_373, salariesPaise: null, expensesPaise: null, costCoveragePct: 85.7});
    expect(i.completeness).toMatchObject({designsNoCost: 1, designsNoGst: 1});
    expect(i.previousKpi.grossProfitPaise).toBeNull();      // nothing costed in the previous period → unknown, not ₹0
    expect(i.deltas.grossProfitPaise).toBeNull();
    const p1 = i.designs.find((x: any) => x.id === 'p1'), p2 = i.designs.find((x: any) => x.id === 'p2');
    expect(p1).toMatchObject({pieces: 3, costPaise: 1_800_000, profitPaise: 742_373});
    expect(p2).toMatchObject({pieces: 1, costPaise: null, profitPaise: null, profitPerPiecePaise: null});
  });

  it('accounts for every billed rupee and the cancelled bill', async () => {
    const i = ok(await call('owner', 'GET', `/api/admin/insights?from=${today}&to=${today}`));
    expect(i.rupee).toMatchObject({billedPaise: 3_500_000, collectedOnBillsPaise: 1_500_000, stillDuePaise: 2_000_000, efficiencyPct: 42.9, discountsPaise: null, returnsPaise: null});
    expect(i.rupee.collectedOnBillsPaise + i.rupee.stillDuePaise).toBe(i.rupee.billedPaise);
    expect(i.rupee.cancelled).toEqual({count: 1, valuePaise: 1_000_000});
    expect(i.rupee.payStatus).toMatchObject({PAID: {count: 1, paise: 1_000_000}, PARTIAL: {count: 1, paise: 2_500_000}});
    expect(i.ageing[0]).toEqual({key: '0-7', paise: 2_000_000, count: 1});
    expect(i.salespeople.map((p: any) => [p.name, p.billedPaise])).toEqual([['Sales One', 2_500_000], ['Sales Two', 1_000_000]]);
    expect(i.stock.low.map((p: any) => p.id)).toEqual(['p2']);
  });

  it('is closed to salesmen and exports CSV', async () => {
    expect((await call('s1', 'GET', `/api/admin/insights?from=${today}&to=${today}`)).status).toBe(403);
    const acc = ok(await call('acc', 'GET', `/api/admin/insights?from=${today}&to=${today}`));
    expect(acc.canSeeCost).toBe(true);
    const csv = await call('owner', 'GET', `/api/admin/insights?from=${today}&to=${today}&format=csv`);
    expect(csv.status).toBe(200);
    expect(String(csv.body)).toContain('Net sales excl. GST (est.)');
    expect(String(csv.body)).toContain('Salaries & advances,not recorded');
  });
});
