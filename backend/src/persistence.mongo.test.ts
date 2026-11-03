import {createServer, Server} from 'node:http';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import {afterAll, beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';
import {startReplSet} from './test-mongo.js';
import {diffStores, MongoRepository, PersistenceError} from './repository.js';
import {Models} from './models.js';
import {Inv} from './inventory/models.js';
import {Sales} from './sales/models.js';
import {Store} from './types.js';

process.env.READ_REFRESH_MS = '0';

const pw = bcrypt.hashSync('test-password-1', 4);
const empty = (): Store => ({users: [], products: [], customers: [], orders: [], invoices: [], settings: undefined as any, audit: [], inventoryMovements: []});
const fixture = (stock = 10, policy: 'submission' | 'approval' | 'dispatch' = 'submission'): Store => ({
  users: [
    {id: 'u-owner', name: 'Owner', email: 'owner@test.local', password: pw, role: 'owner'},
    {id: 'u-acc', name: 'Accounts', email: 'acc@test.local', password: pw, role: 'accounts'},
    {id: 'u-s1', name: 'Sales One', email: 's1@test.local', phone: '9000000001', password: pw, role: 'salesman'},
  ],
  products: [{id: 'p1', name: 'Eco 2 / SRH-52', sku: 'ECO2-SRH52', category: 'Steel Almirah', unit: 'piece', price: 100, stock, reservedStock: 0, reorder: 1, status: 'active'}],
  customers: [{id: 'c1', name: 'Customer', phone: '9000000099', balance: 0}],
  orders: [], invoices: [],
  settings: {businessName: 'Test', currency: 'INR', stockPolicy: policy, taxEnabled: false},
  audit: [], inventoryMovements: [],
});

let replSet: Awaited<ReturnType<typeof startReplSet>>['replSet'];
let uri = '';
let repo: MongoRepository;

async function wipe() { for (const m of [...Object.values(Models), ...Object.values(Inv), ...Object.values(Sales)]) await (m as any).deleteMany({}); }
async function seed(store: Store) { await wipe(); await repo.commit(empty(), store, true); }

type App = typeof import('./server.js');
async function freshApp(): Promise<{app: App; url: string; close: () => Promise<void>}> {
  vi.resetModules();
  const app: App = await import('./server.js');
  app.installTestState(await repo.reload(), repo);
  const server: Server = createServer(app.app);
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  return {app, url: `http://127.0.0.1:${address.port}`, close: () => new Promise(r => server.close(() => r()))};
}
async function call(url: string, path: string, init: RequestInit = {}) {
  const res = await fetch(url + path, {...init, headers: {'Content-Type': 'application/json', ...(init.headers || {})}});
  const text = await res.text();
  return {status: res.status, body: text ? JSON.parse(text) : null};
}
async function token(url: string, email: string) { return (await call(url, '/api/auth/login', {method: 'POST', body: JSON.stringify({email, password: 'test-password-1'})})).body.token as string; }

beforeAll(async () => { ({replSet, uri} = await startReplSet()); repo = new MongoRepository(); await repo.connect(uri); });
afterAll(async () => { await repo?.close(); await replSet?.stop(); });
beforeEach(async () => { await seed(fixture()); });

describe('MongoDB persistence safety (Phase 1)', () => {
  it('runs on a replica set so commits are transactional', () => {
    expect(repo.supportsTransactions).toBe(true);
  });

  it('no longer erases records written by another process (the original data-loss bug)', async () => {
    const {url, close} = await freshApp();
    // Another instance / script writes directly to the database after this app loaded its state.
    await Models.products.create({id: 'p-other', name: 'Written elsewhere', sku: 'OTHER-1', category: 'X', unit: 'piece', price: 1, stock: 3, reservedStock: 0, reorder: 0, status: 'active'});
    await Models.customers.create({id: 'c-other', name: 'Other customer', phone: '9111111111', balance: 0});
    const owner = await token(url, 'owner@test.local');
    const created = await call(url, '/api/customers', {method: 'POST', headers: {Authorization: `Bearer ${owner}`}, body: JSON.stringify({name: 'New Customer', phone: '9222222222'})});
    expect(created.status).toBe(201);
    expect(await Models.products.countDocuments({id: 'p-other'})).toBe(1);
    expect(await Models.customers.countDocuments({id: {$in: ['c-other', created.body.id, 'c1']}})).toBe(3);
    await close();
  });

  it('writes only changed documents', () => {
    const before = fixture(); const after = structuredClone(before);
    after.products[0].reservedStock = 1;
    after.audit.unshift({id: 'a1', action: 'x', actor: 'y', at: new Date().toISOString()});
    const ops = diffStores(before, after);
    expect(ops.map(o => `${o.kind}:${o.collection}`).sort()).toEqual(['insert:audit', 'replace:products']);
  });

  it('refuses to delete records', () => {
    const before = fixture(); const after = structuredClone(before); after.customers = [];
    expect(() => diffStores(before, after)).toThrow(PersistenceError);
  });

  it('rolls back every write when one write in a commit fails', async () => {
    const before = await repo.reload(); const after = structuredClone(before);
    after.users[0].name = 'Renamed';                                            // replace (succeeds)
    after.products.push({...after.products[0], id: 'p-dup'});                  // insert duplicate SKU (fails)
    await expect(repo.commit(before, after)).rejects.toThrow();
    expect((await Models.users.findOne({id: 'u-owner'}).lean() as any).name).toBe('Owner');
    expect(await Models.products.countDocuments()).toBe(1);
  });

  it('survives an application restart with identical data', async () => {
    const {url, close} = await freshApp();
    const owner = await token(url, 'owner@test.local');
    await call(url, '/api/customers', {method: 'POST', headers: {Authorization: `Bearer ${owner}`}, body: JSON.stringify({name: 'Persisted', phone: '9333333333'})});
    await close();
    const before = await repo.reload();
    await repo.close(); repo = new MongoRepository(); await repo.connect(uri);
    const after = await repo.reload();
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
    expect(after.customers.some(c => c.name === 'Persisted')).toBe(true);
    expect(after.users.find(u => u.id === 'u-s1')?.phone).toBe('9000000001'); // phone is no longer dropped
  });

  it('never oversells under 20 concurrent orders split across two app instances', async () => {
    const a = await freshApp(); const b = await freshApp();
    const ta = await token(a.url, 's1@test.local'); const tb = await token(b.url, 's1@test.local');
    const submit = (url: string, t: string, i: number) => call(url, '/api/orders', {method: 'POST', headers: {Authorization: `Bearer ${t}`, 'Idempotency-Key': `concurrency-${i}`}, body: JSON.stringify({customerId: 'c1', items: [{productId: 'p1', qty: 1}]})});
    const results = await Promise.all(Array.from({length: 20}, (_, i) => i % 2 ? submit(a.url, ta, i) : submit(b.url, tb, i)));
    expect(results.filter(r => r.status === 201)).toHaveLength(10);
    expect(results.filter(r => r.status === 409)).toHaveLength(10);
    const product = await Models.products.findOne({id: 'p1'}).lean() as any;
    expect(product.stock).toBe(10); expect(product.reservedStock).toBe(10);
    expect(await Models.orders.countDocuments()).toBe(10);
    expect(await Models.movements.countDocuments({type: 'reservation'})).toBe(10);
    await a.close(); await b.close();
  });

  it('keeps reservations, dispatch-once and movement history intact through the full order lifecycle', async () => {
    await seed(fixture(5, 'approval'));
    const {url, close} = await freshApp();
    const sales = await token(url, 's1@test.local'); const acc = await token(url, 'acc@test.local');
    const order = await call(url, '/api/orders', {method: 'POST', headers: {Authorization: `Bearer ${sales}`, 'Idempotency-Key': 'lifecycle-1'}, body: JSON.stringify({customerId: 'c1', items: [{productId: 'p1', qty: 2}]})});
    expect(order.status).toBe(201);
    const patch = (status: string) => call(url, `/api/orders/${order.body.id}/status`, {method: 'PATCH', headers: {Authorization: `Bearer ${acc}`}, body: JSON.stringify({status})});
    expect((await patch('Approved')).status).toBe(200);
    expect((await Models.products.findOne({id: 'p1'}).lean() as any).reservedStock).toBe(2);
    expect((await patch('Dispatched')).status).toBe(200);
    expect((await patch('Dispatched')).status).toBe(409);
    const product = await Models.products.findOne({id: 'p1'}).lean() as any;
    expect(product).toMatchObject({stock: 3, reservedStock: 0});
    const types = (await Models.movements.find({sourceId: order.body.id}).lean()).map((m: any) => m.type).sort();
    expect(types).toEqual(['reservation', 'sale']);
    const list = await call(url, '/api/orders', {headers: {Authorization: `Bearer ${acc}`}});
    expect(list.status).toBe(200); // createdAt strings sort correctly after a Mongo round-trip
    await close();
  });

  it('a failed handler leaves the database unchanged', async () => {
    await seed(fixture(1, 'submission'));
    const {url, close} = await freshApp();
    const sales = await token(url, 's1@test.local');
    const tooMany = await call(url, '/api/orders', {method: 'POST', headers: {Authorization: `Bearer ${sales}`, 'Idempotency-Key': 'fail-1'}, body: JSON.stringify({customerId: 'c1', items: [{productId: 'p1', qty: 5}]})});
    expect(tooMany.status).toBe(409);
    expect(await Models.orders.countDocuments()).toBe(0);
    expect((await Models.products.findOne({id: 'p1'}).lean() as any).reservedStock).toBe(0);
    await close();
  });
});

afterAll(async () => { if (mongoose.connection.readyState) await mongoose.disconnect(); });
