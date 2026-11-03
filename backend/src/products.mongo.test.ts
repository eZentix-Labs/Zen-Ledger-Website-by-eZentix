// Product management on the shared catalogue, through the real HTTP API (throwaway local replica set).
import {createServer, Server} from 'node:http';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {startReplSet} from './test-mongo.js';
import {MongoRepository} from './repository.js';
import {Models} from './models.js';
import {Inv} from './inventory/models.js';
import {Store} from './types.js';

process.env.READ_REFRESH_MS = '0';
const pw = bcrypt.hashSync('test-password-1', 4);
const store = (): Store => ({
  users: [
    {id: 'u-owner', name: 'Owner', email: 'owner@test.local', password: pw, role: 'owner'},
    {id: 'u-acc', name: 'Accountant', email: 'acc@test.local', password: pw, role: 'accounts'},
    {id: 'u-s1', name: 'Sales One', email: 's1@test.local', phone: '9000000001', password: pw, role: 'salesman'},
  ],
  products: [], customers: [{id: 'c1', name: 'Customer One', phone: '9000000099', balance: 0, createdBy: 'u-s1'}],
  orders: [], invoices: [], settings: {businessName: 'Test', currency: 'INR', stockPolicy: 'approval', taxEnabled: false}, audit: [], inventoryMovements: [],
});
let replSet: any; let repo: MongoRepository; let server: Server; let url = '';
const tokens: Record<string, string> = {};
async function call(who: string, method: string, path: string, body?: unknown, raw?: Buffer) {
  const headers: Record<string, string> = {'Content-Type': raw ? 'image/png' : 'application/json', Authorization: `Bearer ${tokens[who] || ''}`};
  if (method !== 'GET') headers['Idempotency-Key'] = crypto.randomUUID();
  const res = await fetch(url + path, {method, headers, body: raw ?? (body === undefined ? undefined : JSON.stringify(body))});
  const t = await res.text();
  return {status: res.status, body: t ? JSON.parse(t) : null};
}
const ok = (r: {status: number; body: any}) => { if (r.status >= 300) throw new Error(`HTTP ${r.status}: ${JSON.stringify(r.body)}`); return r.body; };
// 1x1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

beforeAll(async () => {
  ({replSet} = await startReplSet());
  repo = new MongoRepository(); await repo.connect(replSet.getUri('zenledger_test'));
  await repo.commit({users: [], products: [], customers: [], orders: [], invoices: [], settings: undefined as any, audit: [], inventoryMovements: []}, store(), true);
  const app = await import('./server.js');
  app.installTestState(await repo.reload(), repo);
  server = createServer(app.app); await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
  url = `http://127.0.0.1:${(server.address() as any).port}`;
  for (const [who, email] of [['owner', 'owner@test.local'], ['acc', 'acc@test.local'], ['s1', 's1@test.local']]) tokens[who] = ok(await call('', 'POST', '/api/auth/login', {email, password: 'test-password-1'})).token;
});
afterAll(async () => { server?.close(); await repo?.close(); await replSet?.stop(); });

let eco2 = '', variant = '', dup = '', img: any;
describe('Almari product management', () => {
  it('Admin creates a product with specs and opening stock (one ledger entry); others cannot', async () => {
    const body = {master: {name: 'Steel Almirah Eco 2', sku: 'ECO2-RED', category: 'Double Door', price: 12500, reorder: 2}, profile: {doorCount: 2, drawerCount: 1, internalShelves: 4, heightIn: 78, widthIn: 34, depthIn: 20, thicknessMm: 0.8, colour: 'Red', finish: 'Powder coated', lockType: 'Maruti lock', brand: 'Steel Raj', wholesalePriceRupees: 11000, retailPriceRupees: 13500, discountPct: 5, gstRateBps: 1800, warehouseLocation: 'FG godown'}, openingQty: 5, openingCostRupees: 7000};
    eco2 = ok(await call('owner', 'POST', '/api/inventory/products', body)).id;
    expect((await Models.products.findOne({id: eco2}).lean() as any).stock).toBe(5);
    expect(await Inv.Ledger.countDocuments({itemKind: 'PRODUCT', itemId: eco2, type: 'OPENING'})).toBe(1);
    expect((await call('owner', 'POST', '/api/inventory/products', body)).status).toBe(409);
    expect((await call('acc', 'POST', '/api/inventory/products', {...body, master: {...body.master, sku: 'X1'}})).status).toBe(403);
    expect((await call('s1', 'GET', '/api/inventory/products')).status).toBe(403);
    expect((await call('s1', 'PUT', `/api/inventory/products/${eco2}/profile`, {colour: 'Blue'})).status).toBe(403);
    const d = ok(await call('owner', 'GET', `/api/inventory/products/${eco2}`));
    expect(d.profile).toMatchObject({doorCount: 2, wholesalePricePaise: 1_100_000, retailPricePaise: 1_350_000, discountBps: 500});
    expect(d.manufacturingCostPaise).toBe(700_000);
    expect(d.marginPct).toBe(44);
    expect(d.stock).toMatchObject({opening: 5, onHand: 5, available: 5, unrecordedBeforeHistory: 0});
  });
  it('uploads, replaces and removes images; shared images survive removal from a duplicate', async () => {
    img = ok(await call('owner', 'POST', '/api/files?purpose=product', undefined, PNG));
    const img2 = ok(await call('owner', 'POST', '/api/files?purpose=product', undefined, PNG));
    ok(await call('owner', 'PUT', `/api/inventory/products/${eco2}/profile`, {images: [{...img, view: 'MAIN'}, {...img2, view: 'INTERIOR'}]}));
    dup = ok(await call('owner', 'POST', `/api/inventory/products/${eco2}/duplicate`, {sku: 'ECO2-BLUE', name: 'Steel Almirah Eco 2 Blue', overrides: {colour: 'Blue'}})).id;
    const dd = ok(await call('owner', 'GET', `/api/inventory/products/${dup}`));
    expect(dd.profile.images).toHaveLength(2);
    expect(dd.manufacturingCostPaise).toBeNull();   // cost is never copied
    expect(dd.stock.onHand).toBe(0);
    ok(await call('owner', 'PUT', `/api/inventory/products/${dup}/profile`, {images: []}));   // remove from the duplicate
    expect(await Inv.File.countDocuments({_id: img.id})).toBe(1);                          // still used by the original
    ok(await call('owner', 'PUT', `/api/inventory/products/${eco2}/profile`, {images: [{...img, view: 'MAIN'}]}));   // replace set: img2 no longer used
    expect(await Inv.File.countDocuments({_id: img2.id})).toBe(0);
  });
  it('variants are separate products with their own SKU and stock', async () => {
    variant = ok(await call('owner', 'POST', `/api/inventory/products/${eco2}/duplicate`, {sku: 'ECO2-RED-H72', name: 'Steel Almirah Eco 2 (72 in)', asVariant: true, variantLabel: '72 in height', overrides: {heightIn: 72}})).id;
    const v = ok(await call('owner', 'GET', `/api/inventory/products/${variant}`));
    expect(v.profile).toMatchObject({heightIn: 72, variantLabel: '72 in height', variantGroupId: eco2});
    expect(v.stock.onHand).toBe(0);
    const root = ok(await call('owner', 'GET', `/api/inventory/products/${eco2}`));
    expect(root.variants.map((x: any) => x.sku)).toEqual(['ECO2-RED-H72']);
    expect(root.stock.onHand).toBe(5);
    const list = ok(await call('owner', 'GET', '/api/inventory/products?q=ECO2-RED'));
    expect(list.items.find((x: any) => x.id === eco2).variantCount).toBe(2);
  });
  it('deletes only products without history; archived products cannot be ordered or seen by salesmen', async () => {
    expect((await call('owner', 'DELETE', `/api/inventory/products/${eco2}`)).status).toBe(409);
    ok(await call('owner', 'DELETE', `/api/inventory/products/${dup}`));
    expect(await Models.products.countDocuments({id: dup})).toBe(0);
    ok(await call('owner', 'POST', '/api/inventory/products/bulk', {ids: [variant], status: 'archived', warehouseLocation: 'Back store'}));
    expect((await Models.products.findOne({id: variant}).lean() as any).status).toBe('archived');
    expect((await call('s1', 'POST', '/api/orders', {customerId: 'c1', items: [{productId: variant, qty: 1}]})).status).toBe(404);
    const cat = ok(await call('s1', 'GET', '/api/sales/catalogue'));
    expect(cat.items.map((x: any) => x.id)).toEqual([eco2]);
    expect(JSON.stringify(cat)).not.toMatch(/avgCost|manufacturingCost|wholesale|valuePaise/i);
    expect(cat.items[0].images).toHaveLength(1);
  });
  it('stock and sales history use the existing order flow and dispatch-once ledger', async () => {
    const o = ok(await call('s1', 'POST', '/api/orders', {customerId: 'c1', items: [{productId: eco2, qty: 2}]}));
    ok(await call('acc', 'PATCH', `/api/orders/${o.id}/status`, {status: 'Approved'}));
    ok(await call('acc', 'PATCH', `/api/orders/${o.id}/status`, {status: 'Dispatched'}));
    const d = ok(await call('owner', 'GET', `/api/inventory/products/${eco2}`));
    expect(d.stock).toMatchObject({opening: 5, dispatched: 2, onHand: 3, reserved: 0, unrecordedBeforeHistory: 0});
    expect(d.sales).toMatchObject({orders: 1, countedOrders: 1, unitsSold: 2, valuePaise: 2_500_000});
    // Inventory > Finished Goods reads the same record
    const fg = ok(await call('acc', 'GET', '/api/inventory/products?q=ECO2-RED'));
    expect(fg.items[0]).toMatchObject({stock: 3, available: 3});
  });
  it('BOM integration: configured flag, cost and buildable quantity from real stock', async () => {
    const before = ok(await call('owner', 'GET', `/api/inventory/products/${eco2}`));
    expect(before.manufacturing.configured).toBe(false);
    const sheet = ok(await call('owner', 'POST', '/api/inventory/items', {name: 'Sheet', code: 'SH-1', itemType: 'RAW_MATERIAL', stockUnit: 'sheet', openingQty: 9, openingCostRupees: 900})).id;
    const bom = ok(await call('owner', 'POST', '/api/inventory/boms', {productId: eco2, lines: [{itemId: sheet, qty: 2}], labourRupees: 500}));
    ok(await call('owner', 'POST', `/api/inventory/boms/${bom.id}/approve`, {}));
    const d = ok(await call('owner', 'GET', `/api/inventory/products/${eco2}`));
    expect(d.manufacturing.configured).toBe(true);
    expect(d.manufacturing.maxBuildable).toBe(4);   // 9 sheets / 2 per almirah
    expect(d.manufacturing.bom.cost.estimatedPerUnitPaise).toBe(2 * 90000 + 50000);
    const a = ok(await call('acc', 'GET', `/api/inventory/products/${eco2}`));
    expect(a.manufacturing.availability[0].canMake).toBe(4);
  });
  it('imports with a preview, never touching stock; renames categories with their products; exports CSV', async () => {
    const rows = [{sku: 'ECO2-RED', price: '13000', colour: 'Maroon'}, {sku: 'NEW-LOCKER', name: 'Locker Cabinet 12', category: 'Locker Cabinet', price: '18000', doorCount: '12'}, {sku: 'BAD', price: 'x'}];
    const prev = ok(await call('owner', 'POST', '/api/inventory/products/import', {rows}));
    expect(prev.report.map((r: any) => r.action)).toEqual(['UPDATE', 'CREATE', 'ERROR']);
    expect((await call('owner', 'POST', '/api/inventory/products/import', {rows, apply: true})).status).toBe(400);
    const done = ok(await call('owner', 'POST', '/api/inventory/products/import', {rows: rows.slice(0, 2), apply: true}));
    expect(done).toMatchObject({created: 1, updated: 1});
    expect((await Models.products.findOne({id: eco2}).lean() as any)).toMatchObject({price: 13000, stock: 3});
    ok(await call('owner', 'POST', '/api/inventory/product-categories/rename', {from: 'Double Door', to: 'Double Door Steel Almari'}));
    expect((await Models.products.findOne({id: eco2}).lean() as any).category).toBe('Double Door Steel Almari');
    expect((await call('owner', 'POST', '/api/inventory/product-categories/status', {name: 'Double Door Steel Almari', active: false})).status).toBe(409);
    const csv = await fetch(`${url}/api/inventory/reports/product-catalogue?format=csv`, {headers: {Authorization: `Bearer ${tokens.acc}`}});
    const text = await csv.text();
    expect(text).toContain('ECO2-RED'); expect(text).toContain('Locker Cabinet 12');
  });
});
