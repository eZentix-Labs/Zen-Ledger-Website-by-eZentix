// End-to-end business workflows through the real HTTP API on a throwaway local replica set.
import {createServer, Server} from 'node:http';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {startReplSet} from './test-mongo.js';
import {MongoRepository} from './repository.js';
import {Models} from './models.js';
import {Inv} from './inventory/models.js';
import {Sales} from './sales/models.js';
import {Store} from './types.js';

process.env.READ_REFRESH_MS = '0';
const pw = bcrypt.hashSync('test-password-1', 4);
const store = (): Store => ({
  users: [
    {id: 'u-owner', name: 'Owner', email: 'owner@test.local', password: pw, role: 'owner'},
    {id: 'u-acc', name: 'Accountant', email: 'acc@test.local', password: pw, role: 'accounts'},
    {id: 'u-s1', name: 'Sales One', email: 's1@test.local', phone: '9000000001', password: pw, role: 'salesman'},
  ],
  products: [{id: 'p-eco2', name: 'Eco 2 / SRH-52', sku: 'ECO2-SRH52', category: 'Steel Almirah', unit: 'piece', price: 12500, stock: 0, reservedStock: 0, reorder: 1, status: 'active'}],
  customers: [{id: 'c1', name: 'Customer One', phone: '9000000099', balance: 0, createdBy: 'u-s1'}],
  orders: [], invoices: [], settings: {businessName: 'Test', currency: 'INR', stockPolicy: 'approval', taxEnabled: false}, audit: [], inventoryMovements: [],
});

let replSet: any; let repo: MongoRepository; let server: Server; let url = '';
const tokens: Record<string, string> = {};
async function call(who: string, method: string, path: string, body?: unknown, key: string | false = crypto.randomUUID()) {
  const headers: Record<string, string> = {'Content-Type': 'application/json'};
  if (tokens[who]) headers.Authorization = `Bearer ${tokens[who]}`;
  if (key && method !== 'GET') headers['Idempotency-Key'] = key;
  const res = await fetch(url + path, {method, headers, body: body === undefined ? undefined : JSON.stringify(body)});
  const text = await res.text();
  return {status: res.status, body: text ? JSON.parse(text) : null};
}
const ok = (r: {status: number; body: any}, expected = [200, 201]) => { if (!expected.includes(r.status)) throw new Error(`HTTP ${r.status}: ${JSON.stringify(r.body)}`); return r.body; };
const item = async (id: string) => (await Inv.Item.findById(id).lean()) as any;
const product = async () => (await Models.products.findOne({id: 'p-eco2'}).lean()) as any;

beforeAll(async () => {
  ({replSet} = await startReplSet());
  repo = new MongoRepository(); await repo.connect(replSet.getUri('zenledger_test'));
  await repo.commit({users: [], products: [], customers: [], orders: [], invoices: [], settings: undefined as any, audit: [], inventoryMovements: []}, store(), true);
  const app = await import('./server.js');
  app.installTestState(await repo.reload(), repo);
  server = createServer(app.app); await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
  url = `http://127.0.0.1:${(server.address() as any).port}`;
  for (const [who, email] of [['owner', 'owner@test.local'], ['acc', 'acc@test.local'], ['s1', 's1@test.local']]) tokens[who] = ok(await call('', 'POST', '/api/auth/login', {email, password: 'test-password-1'}, false)).token;
});
afterAll(async () => { server?.close(); await repo?.close(); await replSet?.stop(); });

let sheet = '', hinge = '', supplier = '';
describe('Inventory: suppliers, materials, purchases', () => {
  it('creates a supplier and rejects a duplicate', async () => {
    supplier = ok(await call('acc', 'POST', '/api/inventory/suppliers', {name: 'Howrah Steel Traders', category: 'STEEL', phone: '9830000001', contactPerson: 'R. Das', address: 'Howrah', paymentTermsDays: 30})).id;
    expect((await call('acc', 'POST', '/api/inventory/suppliers', {name: 'howrah steel traders', phone: '9830000002'})).status).toBe(409);
  });
  it('creates raw materials (opening stock writes the ledger) and enforces unique codes and valid units', async () => {
    sheet = ok(await call('owner', 'POST', '/api/inventory/items', {name: 'E.D.D Steel Sheet 22G', code: 'RM-SHEET-22', itemType: 'RAW_MATERIAL', stockUnit: 'sheet', purchaseUnits: [{unit: 'kg', factor: 0.05}], reorderLevel: 20, maxStock: 200, preferredSupplierId: supplier})).id;
    hinge = ok(await call('owner', 'POST', '/api/inventory/items', {name: 'Hinge 4 inch', code: 'CMP-HINGE-4', itemType: 'COMPONENT', stockUnit: 'pcs', openingQty: 400, openingCostRupees: 12.5})).id;
    expect((await item(hinge)).onHandM).toBe(400_000);
    expect(await Inv.Ledger.countDocuments({itemId: hinge, type: 'OPENING'})).toBe(1);
    expect((await call('owner', 'POST', '/api/inventory/items', {name: 'Dup', code: 'rm-sheet-22', itemType: 'RAW_MATERIAL', stockUnit: 'pcs'})).status).toBe(409);
    expect((await call('owner', 'POST', '/api/inventory/items', {name: 'Bad', code: 'BAD-1', itemType: 'COMPONENT', stockUnit: 'pcs', openingQty: 1.5})).status).toBe(400);
    expect((await call('owner', 'POST', '/api/inventory/items', {name: 'Bad conv', code: 'BAD-2', itemType: 'COMPONENT', stockUnit: 'pcs', purchaseUnits: [{unit: 'pcs', factor: 2}]})).status).toBe(400);
  });
  it('S1/S2: PO does not change stock; partial then full receipt adds exactly the accepted quantity once', async () => {
    const po = ok(await call('acc', 'POST', '/api/inventory/purchase-orders', {supplierId: supplier, lines: [{itemId: sheet, unit: 'sheet', qty: 100, rateRupees: 950, gstPct: 18}], freightRupees: 1000, submit: true}));
    expect(po.status).toBe('SUBMITTED');
    expect((await item(sheet)).onHandM).toBe(0);
    expect((await call('acc', 'POST', `/api/inventory/purchase-orders/${po.id}/approve`, {})).status).toBe(403); // accountant lacks purchase.approve
    expect((await call('acc', 'POST', `/api/inventory/purchase-orders/${po.id}/receive`, {lines: [{lineNo: 1, receivedQty: 60, acceptedQty: 60}]})).status).toBe(409); // not approved yet
    ok(await call('owner', 'POST', `/api/inventory/purchase-orders/${po.id}/approve`, {}));
    const key = 'grn-partial-1';
    const g1 = ok(await call('acc', 'POST', `/api/inventory/purchase-orders/${po.id}/receive`, {supplierInvoiceNo: 'HST/101', lines: [{lineNo: 1, receivedQty: 62, acceptedQty: 60, rejectReason: '2 sheets dented'}]}, key));
    const replay = ok(await call('acc', 'POST', `/api/inventory/purchase-orders/${po.id}/receive`, {supplierInvoiceNo: 'HST/101', lines: [{lineNo: 1, receivedQty: 62, acceptedQty: 60, rejectReason: '2 sheets dented'}]}, key));
    expect(replay.id).toBe(g1.id);
    expect((await item(sheet)).onHandM).toBe(60_000);
    expect(g1.poStatus).toBe('PARTIALLY_RECEIVED');
    // landed cost = (95,000 taxable + 1,000 freight) / 100 sheets = ₹960 = 96,000 paise per sheet (GST excluded)
    expect((await item(sheet)).avgCostPaise).toBe(96000);
    ok(await call('acc', 'POST', `/api/inventory/purchase-orders/${po.id}/receive`, {lines: [{lineNo: 1, receivedQty: 40, acceptedQty: 40}]}));
    expect((await item(sheet)).onHandM).toBe(100_000);
    expect((await call('acc', 'POST', `/api/inventory/purchase-orders/${po.id}/receive`, {lines: [{lineNo: 1, receivedQty: 1, acceptedQty: 1}]})).status).toBe(409);
    expect(await Inv.Ledger.countDocuments({itemId: sheet, type: 'PURCHASE_RECEIPT'})).toBe(2);
    expect((await Inv.PurchaseOrder.findById(po.id).lean() as any).status).toBe('FULLY_RECEIVED');
  });
  it('S10: a bill (incl. imported) creates only a draft payable, never stock; duplicate invoices are refused', async () => {
    const before = (await item(sheet)).onHandM;
    const bill = ok(await call('acc', 'POST', '/api/inventory/bills', {supplierId: supplier, supplierInvoiceNo: 'HST/101', invoiceDate: '2026-11-01', lines: [{description: 'E.D.D sheet 22G', itemId: sheet, qty: 100, unit: 'sheet', rateRupees: 950, gstPct: 18}], freightRupees: 1000, totalRupees: 113100, source: 'IMPORT'}));
    expect((await item(sheet)).onHandM).toBe(before);
    expect((await call('acc', 'POST', '/api/inventory/bills', {supplierId: supplier, supplierInvoiceNo: 'hst-101', invoiceDate: '2026-11-01', totalRupees: 5})).status).toBe(409);
    ok(await call('acc', 'POST', `/api/inventory/bills/${bill.id}/post`, {}));
    expect((await call('acc', 'POST', `/api/inventory/bills/${bill.id}/post`, {})).status).toBe(409);
    const detail = ok(await call('acc', 'GET', `/api/inventory/suppliers/${supplier}`));
    expect(detail.summary.outstandingPaise).toBe(11_310_000);
    ok(await call('acc', 'POST', '/api/inventory/supplier-payments', {supplierId: supplier, amountRupees: 50000, method: 'BANK', reference: 'NEFT-1'}));
    expect(ok(await call('acc', 'GET', `/api/inventory/suppliers/${supplier}`)).summary.outstandingPaise).toBe(6_310_000);
    expect((await Inv.Bill.findById(bill.id).lean() as any).status).toBe('PARTIALLY_PAID');
  });
  it('S7: purchase return reduces stock at GRN cost and credits the supplier', async () => {
    const grn: any = await Inv.GoodsReceipt.findOne({}).sort({createdAt: 1}).lean();
    ok(await call('acc', 'POST', '/api/inventory/purchase-returns', {grnId: String(grn._id), lines: [{lineNo: 1, qty: 5, reason: 'Rust spots'}]}));
    expect((await item(sheet)).onHandM).toBe(95_000);
    expect(await Inv.SupplierLedger.countDocuments({supplierId: supplier, type: 'RETURN'})).toBe(1);
    expect((await call('acc', 'POST', '/api/inventory/purchase-returns', {grnId: String(grn._id), lines: [{lineNo: 1, qty: 56, reason: 'too many'}]})).status).toBe(409);
  });
});

let prodId = '';
describe('Inventory: BOM, production, wastage, counts', () => {
  it('S3: BOM approval and production consume raw material once and add finished goods only after QC', async () => {
    const bom = ok(await call('owner', 'POST', '/api/inventory/boms', {productId: 'p-eco2', lines: [{itemId: sheet, qty: 2, wastagePct: 0}, {itemId: hinge, qty: 4}], labourRupees: 600, overheadRupees: 150}));
    expect((await call('acc', 'POST', `/api/inventory/boms/${bom.id}/approve`, {})).status).toBe(403);
    ok(await call('owner', 'POST', `/api/inventory/boms/${bom.id}/approve`, {}));
    const po = ok(await call('owner', 'POST', '/api/inventory/productions', {productId: 'p-eco2', plannedQty: 10, submit: true}));
    prodId = po.id;
    ok(await call('owner', 'POST', `/api/inventory/productions/${po.id}/approve`, {}));
    ok(await call('owner', 'POST', `/api/inventory/productions/${po.id}/reserve`, {}));
    expect((await item(sheet)).reservedM).toBe(20_000);
    expect((await item(sheet)).onHandM).toBe(95_000);
    ok(await call('owner', 'POST', `/api/inventory/productions/${po.id}/issue`, {lines: [{itemId: sheet, qty: 20}, {itemId: hinge, qty: 40}]}));
    expect((await item(sheet))).toMatchObject({onHandM: 75_000, reservedM: 0});
    expect((await item(hinge)).onHandM).toBe(360_000);
    ok(await call('owner', 'POST', `/api/inventory/productions/${po.id}/start`, {}));
    ok(await call('owner', 'POST', `/api/inventory/productions/${po.id}/stage`, {code: 'MATERIAL_PREPARATION', qtyDone: 10}));
    expect((await call('owner', 'POST', `/api/inventory/productions/${po.id}/stage`, {code: 'BENDING', qtyDone: 5})).status).toBe(400); // cutting not done yet
    // Production wastage against issued material: no second stock deduction
    const w = ok(await call('acc', 'POST', '/api/inventory/wastage', {itemId: sheet, qty: 1, wastageType: 'CUTTING_WASTE', reason: 'Mis-cut', productionOrderId: po.id}));
    ok(await call('owner', 'POST', `/api/inventory/wastage/${w.id}/approve`, {}));
    expect((await item(sheet)).onHandM).toBe(75_000);
    const out1 = ok(await call('owner', 'POST', `/api/inventory/productions/${po.id}/output`, {producedQty: 6, acceptedQty: 6}));
    expect(out1.acceptedQty).toBe(6);
    expect((await product()).stock).toBe(6);
    const detail = ok(await call('owner', 'GET', `/api/inventory/productions/${po.id}`));
    expect(detail.progress.outputPct).toBe(60);
    ok(await call('owner', 'POST', `/api/inventory/productions/${po.id}/output`, {producedQty: 4, acceptedQty: 3, qcNotes: 'Paint defect on 1'}));
    expect((await product()).stock).toBe(9);
    expect((await call('owner', 'POST', `/api/inventory/productions/${po.id}/output`, {producedQty: 1, acceptedQty: 1})).status).toBe(409);
    ok(await call('owner', 'POST', `/api/inventory/productions/${po.id}/complete`, {}));
    const done: any = await Inv.Production.findById(po.id).lean();
    expect(done.status).toBe('COMPLETED');
    const sheetLine = done.lines.find((l: any) => l.itemId === sheet);
    expect(sheetLine).toMatchObject({issuedM: 20_000, wastedM: 1_000, consumedM: 19_000});
    // 20 sheets × ₹960 + 40 hinges × ₹12.50 + labour 6,000 + overhead 1,500 = ₹27,200 over 9 good units
    const prof: any = await Inv.ProductProfile.findOne({productId: 'p-eco2'}).lean();
    expect(Math.round(prof.avgCostPaise * 9)).toBe(2_720_000);
  });
  it('S4: store wastage changes stock only after approval, exactly once', async () => {
    const w = ok(await call('acc', 'POST', '/api/inventory/wastage', {itemId: sheet, qty: 5, wastageType: 'DAMAGED_STEEL', reason: 'Water damage'}));
    expect((await item(sheet)).onHandM).toBe(75_000);
    expect((await call('acc', 'POST', `/api/inventory/wastage/${w.id}/approve`, {})).status).toBe(403);
    const r = ok(await call('owner', 'POST', `/api/inventory/wastage/${w.id}/approve`, {}));
    expect(r.costPaise).toBe(5 * 96000);
    expect((await call('owner', 'POST', `/api/inventory/wastage/${w.id}/approve`, {})).status).toBe(409);
    expect((await item(sheet)).onHandM).toBe(70_000);
  });
  it('S5: count variance posts only after approval and refuses stale counts', async () => {
    const c = ok(await call('acc', 'POST', '/api/inventory/stock-counts', {scope: 'ITEMS', itemIds: [sheet], blind: true}));
    ok(await call('acc', 'PUT', `/api/inventory/stock-counts/${c.id}/lines`, {lines: [{itemId: sheet, countedQty: 64, reason: 'Six sheets missing'}]}));
    ok(await call('acc', 'POST', `/api/inventory/stock-counts/${c.id}/submit`, {}));
    expect((await item(sheet)).onHandM).toBe(70_000);
    ok(await call('owner', 'POST', `/api/inventory/stock-counts/${c.id}/approve`, {}));
    expect((await item(sheet)).onHandM).toBe(64_000);
    expect((await call('owner', 'POST', `/api/inventory/stock-counts/${c.id}/approve`, {})).status).toBe(409);
    const stale = ok(await call('acc', 'POST', '/api/inventory/stock-counts', {scope: 'ITEMS', itemIds: [hinge]}));
    ok(await call('acc', 'PUT', `/api/inventory/stock-counts/${stale.id}/lines`, {lines: [{itemId: hinge, countedQty: 360}]}));
    ok(await call('acc', 'POST', `/api/inventory/stock-counts/${stale.id}/submit`, {}));
    ok(await call('owner', 'POST', '/api/inventory/adjustments', {type: 'FOUND', itemId: hinge, qty: 2, reason: 'Found in packing area'}));
    expect((await call('owner', 'POST', `/api/inventory/stock-counts/${stale.id}/approve`, {})).status).toBe(409);
  });
  it('adjustments need approval for accountants; reversals happen once and never go negative', async () => {
    const a = ok(await call('acc', 'POST', '/api/inventory/adjustments', {type: 'MISSING', itemId: hinge, qty: 10, reason: 'Not found during audit'}));
    expect(a.status).toBe('PENDING');
    expect((await item(hinge)).onHandM).toBe(362_000);
    ok(await call('owner', 'POST', `/api/inventory/adjustments/${a.id}/approve`, {}));
    expect((await item(hinge)).onHandM).toBe(352_000);
    const row: any = await Inv.Ledger.findOne({refId: a.id}).lean();
    expect((await call('acc', 'POST', `/api/inventory/ledger/${row._id}/reverse`, {reason: 'Found them'})).status).toBe(403);
    ok(await call('owner', 'POST', `/api/inventory/ledger/${row._id}/reverse`, {reason: 'Found them'}));
    expect((await item(hinge)).onHandM).toBe(362_000);
    expect((await call('owner', 'POST', `/api/inventory/ledger/${row._id}/reverse`, {reason: 'again'})).status).toBe(409);
  });
  it('S9: negative stock is impossible, even with concurrent requests', async () => {
    const cur = (await item(sheet)).onHandM / 1000; // 64
    const res = await Promise.all(Array.from({length: 10}, () => call('owner', 'POST', '/api/inventory/adjustments', {type: 'DECREASE', itemId: sheet, qty: 10, reason: 'Concurrency test'})));
    const posted = res.filter(r => r.status === 201).length;
    expect(posted).toBe(Math.floor(cur / 10));
    expect(res.filter(r => r.status === 409).length).toBe(10 - posted);
    expect((await item(sheet)).onHandM).toBe(cur * 1000 - posted * 10_000);
    expect((await call('owner', 'POST', '/api/inventory/adjustments', {type: 'DECREASE', itemId: sheet, qty: -1, reason: 'bad'})).status).toBe(400);
  });
  it('S9: salesmen cannot touch inventory; ledger balances reconcile with item stock', async () => {
    for (const [m, p] of [['GET', '/api/inventory/items'], ['POST', '/api/inventory/wastage'], ['GET', '/api/inventory/ledger'], ['POST', '/api/inventory/purchase-orders']]) expect((await call('s1', m, p, m === 'POST' ? {} : undefined)).status).toBe(403);
    for (const id of [sheet, hinge]) {
      const rows: any[] = await Inv.Ledger.find({itemId: id}).lean();
      expect(rows.reduce((a, r) => a + r.qtyInM - r.qtyOutM, 0)).toBe((await item(id)).onHandM);
    }
  });
});

describe('Finished goods, sales dispatch, salesmen and targets', () => {
  let orderId = '';
  it('S8: legacy dispatch decreases finished stock once and is mirrored into the unified ledger', async () => {
    const o = ok(await call('s1', 'POST', '/api/orders', {customerId: 'c1', items: [{productId: 'p-eco2', qty: 2}]}, 'order-1'));
    orderId = o.id;
    ok(await call('acc', 'PATCH', `/api/orders/${orderId}/status`, {status: 'Approved'}));
    ok(await call('acc', 'PATCH', `/api/orders/${orderId}/status`, {status: 'Dispatched'}));
    expect((await call('acc', 'PATCH', `/api/orders/${orderId}/status`, {status: 'Dispatched'})).status).toBe(409);
    expect((await product())).toMatchObject({stock: 7, reservedStock: 0});
    expect(await Inv.Ledger.countDocuments({itemId: 'p-eco2', type: 'SALES_DISPATCH'})).toBe(1);
    expect(await Inv.Ledger.countDocuments({itemId: 'p-eco2', type: 'RESERVATION'})).toBe(1);
    const rows: any[] = await Inv.Ledger.find({itemId: 'p-eco2'}).lean();
    expect(rows.reduce((a, r) => a + r.qtyInM - r.qtyOutM, 0)).toBe(7000);
    expect(await Sales.Activity.countDocuments({orderId, type: {$in: ['ORDER_SUBMITTED', 'ORDER_APPROVED', 'ORDER_DISPATCHED']}})).toBe(3);
  });
  it('accountant creates a salesman who must change the temporary password; deactivation ends sessions', async () => {
    const r = ok(await call('acc', 'POST', '/api/salesmen', {name: 'Bikash Pal', phone: '98300 11223', employeeId: 'SM-0002', territory: 'Howrah', generatePassword: true}));
    expect(r.temporaryPassword).toHaveLength(12);
    expect((await call('acc', 'POST', '/api/salesmen', {name: 'Other', phone: '9830011223', password: 'abcdefgh1'})).status).toBe(409);
    const stored: any = await Models.users.findOne({id: r.id}).lean();
    expect(stored.password).not.toContain(r.temporaryPassword);
    const login = ok(await call('', 'POST', '/api/auth/login', {phone: '9830011223', password: r.temporaryPassword}, false));
    expect(login.user.mustChangePassword).toBe(true);
    tokens.s2 = login.token;
    tokens.s2 = ok(await call('s2', 'POST', '/api/auth/change-password', {currentPassword: r.temporaryPassword, newPassword: 'my-new-password-1'})).token;
    expect((await call('s2', 'GET', '/api/sales/me/dashboard')).status).toBe(200);
    expect((await call('acc', 'POST', `/api/salesmen/${r.id}/status`, {active: false, reason: 'Left the company'})).status).toBe(403); // not granted
    ok(await call('owner', 'POST', `/api/salesmen/${r.id}/status`, {active: false, reason: 'Left the company'}));
    expect((await call('s2', 'GET', '/api/sales/me/dashboard')).status).toBe(401);
    expect((await call('', 'POST', '/api/auth/login', {phone: '9830011223', password: 'my-new-password-1'}, false)).status).toBe(403);
  });
  it('targets count approved orders only, never pending/cancelled; history is kept; salesmen see only their own', async () => {
    const today = new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Kolkata'}).format(new Date());
    expect((await call('acc', 'POST', '/api/targets', {name: 'November sales', salesmanId: 'u-s1', type: 'SALES_AMOUNT', period: 'MONTHLY', startDate: today.slice(0, 8) + '01', targetValue: 100000})).status).toBe(403);
    const t = ok(await call('owner', 'POST', '/api/targets', {name: 'November sales', salesmanId: 'u-s1', type: 'SALES_AMOUNT', period: 'MONTHLY', startDate: today.slice(0, 8) + '01', targetValue: 100000}));
    ok(await call('s1', 'POST', '/api/orders', {customerId: 'c1', items: [{productId: 'p-eco2', qty: 1}]}, 'order-pending'));
    const cancelled = ok(await call('s1', 'POST', '/api/orders', {customerId: 'c1', items: [{productId: 'p-eco2', qty: 1}]}, 'order-cancel'));
    ok(await call('acc', 'PATCH', `/api/orders/${cancelled.id}/status`, {status: 'Approved'}));
    ok(await call('acc', 'PATCH', `/api/orders/${cancelled.id}/status`, {status: 'Cancelled'}));
    const mine = ok(await call('s1', 'GET', '/api/targets'));
    expect(mine.items).toHaveLength(1);
    expect(mine.items[0].progress).toMatchObject({achieved: 2_500_000, remaining: 7_500_000, pct: 25}); // only the dispatched ₹25,000 order
    const id = t.created[0];
    const cur: any = await Sales.Target.findById(id).lean();
    ok(await call('owner', 'PUT', `/api/targets/${id}`, {name: 'November sales', salesmanId: 'u-s1', type: 'SALES_AMOUNT', period: 'MONTHLY', startDate: cur.startDate, targetValue: 50000, version: cur.version, reason: 'Festival season adjustment'}));
    const after: any = await Sales.Target.findById(id).lean();
    expect(after.revisions).toHaveLength(1);
    expect(after.revisions[0].before.targetValue).toBe(10_000_000);
    expect((await call('s1', 'GET', '/api/salesmen')).status).toBe(403);
    expect((await call('s1', 'GET', '/api/sales/activities')).body.items.every((a: any) => a.salesmanId === 'u-s1')).toBe(true);
  });
  it('collections: salesman submissions stay unverified until an accountant verifies them', async () => {
    const p = ok(await call('s1', 'POST', '/api/sales/payments', {orderId, amount: 10000, method: 'cash'}));
    expect(p.status).toBe('UNVERIFIED');
    let perf = ok(await call('acc', 'GET', '/api/sales/performance'));
    expect(perf.salesmen.find((s: any) => s.id === 'u-s1').collectedPaise).toBe(0);
    ok(await call('acc', 'POST', `/api/sales/payments/${p.id}/verify`, {}));
    perf = ok(await call('acc', 'GET', '/api/sales/performance'));
    const s1 = perf.salesmen.find((s: any) => s.id === 'u-s1');
    expect(s1.collectedPaise).toBe(1_000_000);
    expect(s1.outstandingPaise).toBe(1_500_000);
    expect((await Models.customers.findOne({id: 'c1'}).lean() as any).balance).toBe(-10000);
  });
  it('insights: own data only, same numbers as the dashboard, never cost', async () => {
    const dash = ok(await call('s1', 'GET', '/api/sales/me/dashboard'));
    const ins = ok(await call('s1', 'GET', '/api/sales/me/insights'));
    expect(ins.period.from).toBe(dash.today.slice(0, 8) + '01');
    expect(ins.metrics).toEqual(dash.thisMonth);                       // one definition per number
    expect(ins.dues.totalPaise).toBe(dash.thisMonth.outstandingPaise);
    expect(ins.series.reduce((a: number, s: any) => a + s.salesPaise, 0)).toBe(ins.metrics.salesPaise);
    expect(ins.target).toMatchObject({type: 'SALES_AMOUNT', progress: {achieved: 2_500_000}});
    expect(ins.collectionsByMethod.cash).toBe(1_000_000);
    expect(ins.customers.every((c: any) => c.id === 'c1')).toBe(true);
    expect(JSON.stringify(ins)).not.toMatch(/avgCost|costPrice|supplier/i);
    const today = ok(await call('s1', 'GET', `/api/sales/me/insights?from=${dash.today}&to=${dash.today}`));
    expect(today.period.grain).toBe('hour');
    expect(today.series).toHaveLength(24);
    expect((await call('s1', 'GET', '/api/sales/me/insights?from=2026-05-10&to=2026-05-01')).status).toBe(400);
    expect((await call('owner', 'GET', '/api/sales/me/insights')).status).toBe(403);
    const csv = await fetch(`${url}/api/sales/me/insights?format=csv`, {headers: {Authorization: `Bearer ${tokens.s1}`}});
    expect(csv.headers.get('content-type')).toMatch(/text\/csv/);
    expect(await csv.text()).toMatch(/Sales counted/);
  });
  it('salesman catalogue exposes price, availability and specs but never cost', async () => {
    const cat = ok(await call('s1', 'GET', '/api/sales/catalogue'));
    expect(cat.items[0]).toMatchObject({id: 'p-eco2', available: expect.any(Number)});
    expect(JSON.stringify(cat)).not.toMatch(/avgCost|costPrice|valuePaise|supplier/i);
  });
  it('dashboard and reports come from real records', async () => {
    const d = ok(await call('owner', 'GET', '/api/inventory/dashboard'));
    expect(d.metrics.rawMaterialItems).toBe(1);
    expect(d.costControl.purchaseCostPaise).toBe(9_600_000);
    expect(d.completeness.total).toBe(7);
    expect(d.completeness.checks.map((c: any) => c.label)).toEqual(['Materials have valid units', 'Materials have purchase costs', 'Reorder levels configured', 'Suppliers configured', 'Products have images', 'BOM configured', 'Production records complete']);
    const po = ok(await call('owner', 'GET', '/api/inventory/purchase-orders', undefined));
    expect(po.items.every((p: any) => ['NOT_BILLED', 'UNPAID', 'PARTIALLY_PAID', 'PAID'].includes(p.paymentStatus))).toBe(true);
    expect(ok(await call('owner', 'GET', '/api/inventory/purchase-orders?status=COMPLETED')).items.every((p: any) => ['FULLY_RECEIVED', 'CLOSED'].includes(p.status))).toBe(true);
    const csv = await fetch(`${url}/api/inventory/reports/stock-valuation?format=csv`, {headers: {Authorization: `Bearer ${tokens.owner}`}});
    expect(csv.headers.get('content-type')).toContain('text/csv');
    expect(await csv.text()).toContain('E.D.D Steel Sheet 22G');
  });
});
