/*
 Demo mode: the whole admin panel running on dummy data.

   npm run demo              # first run seeds; later runs reuse the same data
   npm run demo -- --reset   # throw the demo data away and seed fresh (dates move up to today)

 Then run the frontend as usual (cd frontend, npm run dev) and sign in:
   owner@example.com / ChangeMe123!        accounts@example.com / AccountsTest123!
   any salesman, by phone (see SALESMEN) / Demo@12345

 Isolation: this starts its own MongoDB on port 27028 with files in backend/data/mongo-demo (git-ignored).
 NODE_ENV=test means backend/.env is never loaded, so neither the real database nor its URI can be reached.

 How the data is made: twelve months of business are replayed in date order through the real HTTP API, so stock,
 costs, ledgers, balances and approvals obey the same rules as live use. After each event, every timestamp that
 event wrote is moved back to the simulated moment. Steps that fall after "now" are dropped, which is what leaves
 recent orders, purchases and production naturally part-way through their workflow.
*/
import crypto from 'node:crypto';
import {existsSync} from 'node:fs';
import fs from 'node:fs/promises';
import {createServer} from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import {MongoMemoryReplSet} from 'mongodb-memory-server';

const API_PORT = Number(process.env.DEMO_PORT || 4000);
const MONGO_PORT = 27028;
const DB_NAME = 'zenledger_demo';
const DAY = 86_400_000;
const SALESMAN_PASSWORD = 'Demo@12345';

Object.assign(process.env, {NODE_ENV: 'test', PERSISTENCE: 'mongo', API_AUTOSTART: 'false', READ_REFRESH_MS: '0', JWT_SECRET: 'local-demo-secret-only-for-the-dummy-data-database', MONGODB_URI: `mongodb://127.0.0.1:${MONGO_PORT}/${DB_NAME}`});
const cachedMongod = path.join(os.homedir(), '.cache', 'mongodb-binaries', 'mongod-x64-win32-7.0.14.exe');
if (!process.env.MONGOMS_SYSTEM_BINARY && existsSync(cachedMongod)) process.env.MONGOMS_SYSTEM_BINARY = cachedMongod;

// ---------- dummy master data ----------
const SALESMEN = [
  {name: 'Bikash Pal', phone: '9000010001', employeeId: 'SM-0001', territory: 'Kolkata North', address: 'Shyambazar, Kolkata', cats: ['Steel Raj', 'SRH Series']},
  {name: 'Sourav Ghosh', phone: '9000010002', employeeId: 'SM-0002', territory: 'Howrah & Hooghly', address: 'Shibpur, Howrah', cats: ['Steel Raj', 'Premium Design']},
  {name: 'Amit Mondal', phone: '9000010003', employeeId: 'SM-0003', territory: 'North Bengal', address: 'Sevoke Road, Siliguri', cats: ['SRH Series', 'SDH Series']},
  {name: 'Rakesh Sahoo', phone: '9000010004', employeeId: 'SM-0004', territory: 'Odisha Coast', address: 'Saheed Nagar, Bhubaneswar', cats: ['Steel Raj', 'Luxury Photo']},
  {name: 'Priya Nayak', phone: '9000010005', employeeId: 'SM-0005', territory: 'Jharkhand', address: 'Bistupur, Jamshedpur', cats: ['Premium Design', 'Luxury Photo', 'SDH Series']},
  {name: 'Deepak Roy', phone: '9000010006', employeeId: 'SM-0006', territory: 'Bardhaman', address: 'GT Road, Bardhaman', cats: ['Steel Raj'], leftDaysAgo: 75},
];
const CUSTOMERS: Array<[string, string, number]> = [
  ['Maa Tara Furniture', 'College Street, Kolkata', 0], ['Sree Durga Steel House', 'Ultadanga, Kolkata', 0], ['New Bengal Almirah Centre', 'Dum Dum, Kolkata', 0], ['Kolkata Home Mart', 'Gariahat, Kolkata', 0], ['Annapurna Furnishers', 'Barasat, North 24 Parganas', 0],
  ['Howrah Steel Traders', 'GT Road, Howrah', 1], ['Ganga Furniture Mart', 'Serampore, Hooghly', 1], ['Bharat Almirah Stores', 'Chandannagar, Hooghly', 1], ['Rupali Furniture', 'Uluberia, Howrah', 1], ['Shree Ram Steel Works', 'Bally, Howrah', 1],
  ['Himalaya Furniture Hub', 'Hill Cart Road, Siliguri', 2], ['Teesta Steel Corner', 'Jalpaiguri Town', 2], ['Dooars Home Needs', 'Alipurduar', 2], ['Cooch Behar Furnishers', 'Rupnarayan Road, Cooch Behar', 2], ['Malda Almirah House', 'English Bazar, Malda', 2],
  ['Kalinga Steel Traders', 'Unit 4, Bhubaneswar', 3], ['Jagannath Furniture', 'Grand Road, Puri', 3], ['Cuttack Home Centre', 'Badambadi, Cuttack', 3], ['Utkal Almirah Mart', 'Balasore Town', 3], ['Samaleswari Furnishers', 'Sambalpur', 3],
  ['Tata Nagar Furniture', 'Sakchi, Jamshedpur', 4], ['Ranchi Steel Palace', 'Main Road, Ranchi', 4], ['Dhanbad Home World', 'Bank More, Dhanbad', 4], ['Bokaro Furniture Plaza', 'City Centre, Bokaro', 4],
  ['Burdwan Almirah Bhandar', 'Curzon Gate, Bardhaman', 5], ['Asansol Steel Mart', 'GT Road, Asansol', 5], ['Durgapur Home Store', 'Benachity, Durgapur', 5],
];
type DemoProduct = {sku: string; name: string; category: string; price: number; doors: number; drawers: number; h: number; w: number; d: number; mm: number; colour: string; opening: number; reorder: number; weight: number; bom?: boolean};
const PRODUCTS: DemoProduct[] = [
  {sku: 'STEEL-ECO-2', name: 'Steel Raj Eco 2', category: 'Steel Raj', price: 9800, doors: 2, drawers: 1, h: 72, w: 36, d: 19, mm: 0.6, colour: 'Grey', opening: 60, reorder: 12, weight: 58, bom: true},
  {sku: 'STEEL-ECO-3', name: 'Steel Raj Eco 3', category: 'Steel Raj', price: 12900, doors: 3, drawers: 2, h: 72, w: 48, d: 19, mm: 0.6, colour: 'Grey', opening: 40, reorder: 8, weight: 74, bom: true},
  {sku: 'STEEL-CLASSIC-2', name: 'Steel Raj Classic 2', category: 'Steel Raj', price: 11800, doors: 2, drawers: 2, h: 78, w: 36, d: 19, mm: 0.7, colour: 'Ivory', opening: 60, reorder: 12, weight: 66, bom: true},
  {sku: 'STEEL-CLASSIC-3', name: 'Steel Raj Classic 3', category: 'Steel Raj', price: 15400, doors: 3, drawers: 2, h: 78, w: 48, d: 19, mm: 0.7, colour: 'Ivory', opening: 36, reorder: 8, weight: 84, bom: true},
  {sku: 'STEEL-CLASSIC-SPL-2', name: 'Steel Raj Classic SPL 2', category: 'Steel Raj', price: 13200, doors: 2, drawers: 3, h: 78, w: 36, d: 21, mm: 0.7, colour: 'Maroon', opening: 30, reorder: 6, weight: 70},
  {sku: 'STEEL-HEAVY-3', name: 'Steel Raj Heavy 3', category: 'Steel Raj', price: 18900, doors: 3, drawers: 3, h: 84, w: 48, d: 21, mm: 0.9, colour: 'Green', opening: 26, reorder: 6, weight: 102, bom: true},
  {sku: 'STEEL-PREMIUM-2', name: 'Steel Raj Premium 2', category: 'Steel Raj', price: 16500, doors: 2, drawers: 2, h: 84, w: 40, d: 21, mm: 0.8, colour: 'Walnut', opening: 30, reorder: 6, weight: 82, bom: true},
  {sku: 'STEEL-PREMIUM-2L', name: 'Steel Raj Premium 2(L)', category: 'Steel Raj', price: 17800, doors: 2, drawers: 3, h: 84, w: 40, d: 21, mm: 0.8, colour: 'Walnut', opening: 24, reorder: 6, weight: 86},
  {sku: 'SRH-16', name: 'Steel Raj SRH-16', category: 'SRH Series', price: 10600, doors: 2, drawers: 1, h: 72, w: 36, d: 19, mm: 0.6, colour: 'Blue', opening: 34, reorder: 8, weight: 60, bom: true},
  {sku: 'SRH-52', name: 'Steel Raj SRH-52', category: 'SRH Series', price: 12500, doors: 2, drawers: 2, h: 78, w: 36, d: 19, mm: 0.7, colour: 'Brown', opening: 34, reorder: 8, weight: 68, bom: true},
  {sku: 'SRH-95', name: 'Steel Raj SRH-95', category: 'SRH Series', price: 14300, doors: 3, drawers: 2, h: 78, w: 48, d: 19, mm: 0.7, colour: 'Brown', opening: 22, reorder: 5, weight: 80},
  {sku: 'SRH-22', name: 'Steel Raj SRH-22', category: 'SRH Series', price: 11200, doors: 2, drawers: 1, h: 75, w: 36, d: 19, mm: 0.6, colour: 'Silver', opening: 20, reorder: 40, weight: 62},
  {sku: 'FM 901', name: 'Premium Design FM 901', category: 'Premium Design', price: 21500, doors: 2, drawers: 2, h: 84, w: 42, d: 21, mm: 0.8, colour: 'Rose Print', opening: 18, reorder: 4, weight: 88},
  {sku: 'FM 915', name: 'Premium Design FM 915', category: 'Premium Design', price: 23800, doors: 3, drawers: 2, h: 84, w: 50, d: 21, mm: 0.8, colour: 'Floral Print', opening: 16, reorder: 4, weight: 98},
  {sku: 'FM 942', name: 'Premium Design FM 942', category: 'Premium Design', price: 22400, doors: 2, drawers: 3, h: 84, w: 42, d: 21, mm: 0.8, colour: 'Teak Print', opening: 14, reorder: 30, weight: 90},
  {sku: 'NO-12', name: 'Luxury Photo NO-12', category: 'Luxury Photo', price: 26500, doors: 3, drawers: 3, h: 84, w: 54, d: 22, mm: 0.9, colour: 'Mirror Photo', opening: 14, reorder: 3, weight: 112},
  {sku: 'NO-37', name: 'Luxury Photo NO-37', category: 'Luxury Photo', price: 28900, doors: 4, drawers: 3, h: 84, w: 66, d: 22, mm: 0.9, colour: 'Mirror Photo', opening: 10, reorder: 3, weight: 130},
  {sku: 'SDH-08', name: 'SDH-08', category: 'SDH Series', price: 8900, doors: 1, drawers: 1, h: 66, w: 24, d: 18, mm: 0.5, colour: 'Grey', opening: 36, reorder: 8, weight: 42},
  {sku: 'SDH-21', name: 'SDH-21', category: 'SDH Series', price: 9600, doors: 1, drawers: 2, h: 72, w: 24, d: 18, mm: 0.6, colour: 'Ivory', opening: 28, reorder: 6, weight: 46},
  {sku: 'SDH-44', name: 'SDH-44', category: 'SDH Series', price: 10400, doors: 2, drawers: 1, h: 72, w: 30, d: 18, mm: 0.6, colour: 'Maroon', opening: 4, reorder: 6, weight: 52},
];
const SUPPLIERS = [
  {key: 'steel', name: 'Howrah Steel Traders Pvt Ltd', category: 'STEEL', contactPerson: 'Ranjit Das', phone: '9000020001', email: 'sales@howrahsteel.example', address: 'Belilious Road, Howrah', state: 'West Bengal', gstin: '19AABCH1234K1Z5', paymentTermsDays: 30, bankName: 'Demo Bank', bankAccount: '000111222333', ifsc: 'DEMO0001234'},
  {key: 'steel2', name: 'Jamshedpur Metal Agency', category: 'STEEL', contactPerson: 'Harpreet Singh', phone: '9000020002', email: 'orders@jsrmetal.example', address: 'Adityapur, Jamshedpur', state: 'Jharkhand', gstin: '20AAFCJ5678L1Z2', paymentTermsDays: 45},
  {key: 'hardware', name: 'Aligarh Lock & Hardware Co', category: 'HARDWARE', contactPerson: 'Imran Qureshi', phone: '9000020003', email: 'sales@aligarhlock.example', address: 'Sasni Gate, Aligarh', state: 'Uttar Pradesh', gstin: '09AAECA9012M1Z8', paymentTermsDays: 30},
  {key: 'paint', name: 'Bengal Powder Coats', category: 'PAINT', contactPerson: 'Tapas Sen', phone: '9000020004', email: 'tapas@bengalcoats.example', address: 'Dankuni Industrial Area, Hooghly', state: 'West Bengal', gstin: '19AAFCB3456N1Z1', paymentTermsDays: 15},
  {key: 'packing', name: 'Eastern Packaging Industries', category: 'PACKAGING', contactPerson: 'Suman Kar', phone: '9000020005', email: 'suman@easternpack.example', address: 'Taratala, Kolkata', state: 'West Bengal', gstin: '19AAECE7890P1Z6', paymentTermsDays: 15},
  {key: 'chem', name: 'Dankuni Chemicals', category: 'CHEMICALS', contactPerson: 'Mihir Basu', phone: '9000020006', address: 'Dankuni, Hooghly', state: 'West Bengal', paymentTermsDays: 7},
  {key: 'old', name: 'Shalimar Scrap & Steel (old vendor)', category: 'GENERAL', contactPerson: 'N. Prasad', phone: '9000020007', address: 'Shalimar, Howrah', state: 'West Bengal', paymentTermsDays: 0, inactive: true},
] as const;
type SupplierKey = typeof SUPPLIERS[number]['key'];
// [code, name, type, category, unit, opening, cost, reorder, supplier, qty per almirah, gst %, location]
type DemoItem = {code: string; name: string; type: string; cat: string; unit: string; open: number; cost: number; reorder: number; sup: SupplierKey; perUnit?: number; gst: number; loc: string; grade?: string; mm?: number; inactive?: boolean};
const ITEMS: DemoItem[] = [
  {code: 'RM-SHEET-22G', name: 'E.D.D Steel Sheet 22G (8x4 ft)', type: 'RAW_MATERIAL', cat: 'Steel Sheets (E.D.D)', unit: 'sheet', open: 400, cost: 1650, reorder: 120, sup: 'steel', perUnit: 3, gst: 18, loc: 'Steel Bay A', grade: 'EDD', mm: 0.7},
  {code: 'RM-SHEET-24G', name: 'E.D.D Steel Sheet 24G (8x4 ft)', type: 'RAW_MATERIAL', cat: 'Steel Sheets (E.D.D)', unit: 'sheet', open: 260, cost: 1380, reorder: 80, sup: 'steel', gst: 18, loc: 'Steel Bay A', grade: 'EDD', mm: 0.6},
  {code: 'RM-CR-20G', name: 'CR Sheet 20G (8x4 ft)', type: 'RAW_MATERIAL', cat: 'CR Sheets', unit: 'sheet', open: 90, cost: 2120, reorder: 40, sup: 'steel2', gst: 18, loc: 'Steel Bay B', grade: 'CRCA', mm: 0.9},
  {code: 'RM-SQPIPE-25', name: 'Square Pipe 25mm', type: 'RAW_MATERIAL', cat: 'Square Pipes', unit: 'm', open: 800, cost: 68, reorder: 200, sup: 'steel2', perUnit: 4, gst: 18, loc: 'Steel Bay B'},
  {code: 'CMP-HINGE-4', name: 'Concealed Hinge 4 inch', type: 'COMPONENT', cat: 'Hinges', unit: 'pcs', open: 1600, cost: 14.5, reorder: 400, sup: 'hardware', perUnit: 6, gst: 18, loc: 'Hardware Rack 1'},
  {code: 'CMP-LOCK-MP', name: 'Multi-point Almirah Lock', type: 'COMPONENT', cat: 'Locks', unit: 'pcs', open: 320, cost: 165, reorder: 100, sup: 'hardware', perUnit: 1, gst: 18, loc: 'Hardware Rack 1'},
  {code: 'CMP-HANDLE-SS', name: 'SS Door Handle 6 inch', type: 'COMPONENT', cat: 'Handles', unit: 'pcs', open: 640, cost: 42, reorder: 150, sup: 'hardware', perUnit: 2, gst: 18, loc: 'Hardware Rack 2'},
  {code: 'CMP-SCREW-BOX', name: 'Self-tapping Screw (box of 500)', type: 'COMPONENT', cat: 'Screws', unit: 'box', open: 45, cost: 310, reorder: 12, sup: 'hardware', gst: 18, loc: 'Hardware Rack 3'},
  {code: 'CMP-MAGNET', name: 'Magnetic Door Catch', type: 'COMPONENT', cat: 'Magnetic Fittings', unit: 'pcs', open: 240, cost: 18, reorder: 500, sup: 'hardware', gst: 18, loc: 'Hardware Rack 3'},
  {code: 'CON-POWDER-GRY', name: 'Powder Coat Grey', type: 'CONSUMABLE', cat: 'Powder Coating', unit: 'kg', open: 320, cost: 245, reorder: 90, sup: 'paint', perUnit: 1.2, gst: 18, loc: 'Paint Store'},
  {code: 'CON-POWDER-IVY', name: 'Powder Coat Ivory', type: 'CONSUMABLE', cat: 'Powder Coating', unit: 'kg', open: 120, cost: 262, reorder: 40, sup: 'paint', gst: 18, loc: 'Paint Store'},
  {code: 'CON-PRIMER', name: 'Epoxy Primer', type: 'CONSUMABLE', cat: 'Primer', unit: 'l', open: 150, cost: 195, reorder: 50, sup: 'paint', perUnit: 0.3, gst: 18, loc: 'Paint Store'},
  {code: 'CON-PRETREAT', name: 'Pre-treatment Degreaser', type: 'CONSUMABLE', cat: 'Pre-treatment Chemicals (7-tank)', unit: 'l', open: 200, cost: 88, reorder: 60, sup: 'chem', gst: 12, loc: 'Chemical Store'},
  {code: 'CON-WELD-ROD', name: 'MIG Welding Wire 0.8mm', type: 'CONSUMABLE', cat: 'Welding Consumables', unit: 'kg', open: 110, cost: 142, reorder: 30, sup: 'hardware', gst: 18, loc: 'Welding Bay'},
  {code: 'PKG-CARTON-L', name: 'Corrugated Carton (Large)', type: 'PACKAGING', cat: 'Packaging Materials', unit: 'pcs', open: 300, cost: 165, reorder: 80, sup: 'packing', perUnit: 1, gst: 12, loc: 'Packing Area'},
  {code: 'PKG-FOAM', name: 'EPE Foam Sheet', type: 'PACKAGING', cat: 'Packaging Materials', unit: 'm', open: 700, cost: 22, reorder: 150, sup: 'packing', perUnit: 3, gst: 12, loc: 'Packing Area'},
  {code: 'PKG-FILM', name: 'Stretch Film Roll', type: 'PACKAGING', cat: 'Packaging Materials', unit: 'roll', open: 60, cost: 340, reorder: 90, sup: 'packing', gst: 12, loc: 'Packing Area'},
  {code: 'SPR-BLADE', name: 'Shearing Machine Blade', type: 'SPARE_PART', cat: 'Machine Spares', unit: 'pcs', open: 6, cost: 4800, reorder: 2, sup: 'hardware', gst: 18, loc: 'Maintenance Room'},
  {code: 'SPR-NOZZLE', name: 'Powder Gun Nozzle', type: 'SPARE_PART', cat: 'Machine Spares', unit: 'pcs', open: 14, cost: 950, reorder: 4, sup: 'paint', gst: 18, loc: 'Maintenance Room'},
  {code: 'OLD-HINGE-3', name: 'Butt Hinge 3 inch (discontinued)', type: 'COMPONENT', cat: 'Hinges', unit: 'pcs', open: 0, cost: 9, reorder: 0, sup: 'hardware', gst: 18, loc: 'Hardware Rack 4', inactive: true},
];

// ---------- deterministic randomness and time ----------
let seedState = 20261104;
const rnd = () => { seedState = (seedState + 0x6d2b79f5) | 0; let t = Math.imul(seedState ^ (seedState >>> 15), 1 | seedState); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const int = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)];
const chance = (p: number) => rnd() < p;
const NOW = new Date();
const IST = 5.5 * 3600_000;
const ymd = (d: Date) => new Date(d.getTime() + IST).toISOString().slice(0, 10);
/** `days` before today at an IST clock hour. */
const ago = (days: number, hour = 11, minute = 0) => new Date(Date.parse(`${ymd(new Date(NOW.getTime() - days * DAY))}T00:00:00+05:30`) + hour * 3600_000 + minute * 60_000);
const later = (d: Date, days: number) => new Date(d.getTime() + days * DAY);
const round = (n: number, step: number) => Math.max(step, Math.round(n / step) * step);

// ---------- event queue ----------
/** Ends a document's chain on purpose (not a failure worth reporting). */
class StopChain extends Error {}
type Step = {at: Date; label: string; run: () => Promise<unknown>};
const queue: Step[] = [];
const at = (when: Date, label: string, run: () => Promise<unknown>) => { if (when.getTime() < NOW.getTime() - 60_000) queue.push({at: when, label, run}); };
/** Steps of one document, each running only if the one before it succeeded. */
function chain(steps: Array<[Date, string, () => Promise<unknown>]>) {
  const state = {broken: false};
  for (const [when, label, run] of steps) at(when, label, async () => { if (state.broken) return; try { await run(); } catch (e) { state.broken = true; throw e; } });
}

/** Same binding as the real API (all addresses), so another server on the port is an error, not a silent split between 127.0.0.1 and ::1. */
const portIsFree = () => new Promise<boolean>(resolve => { const probe = net.createServer(); probe.once('error', () => resolve(false)); probe.listen(API_PORT, () => probe.close(() => resolve(true))); });

async function main() {
  const reset = process.argv.includes('--reset');
  if (!await portIsFree()) throw new Error(`Port ${API_PORT} is already in use, most likely by "npm run dev" in the backend folder. Stop that first (Ctrl+C in its terminal), then run "npm run demo" again.`);
  const dbPath = path.resolve('data', 'mongo-demo');
  await fs.mkdir(dbPath, {recursive: true});
  const replSet = await MongoMemoryReplSet.create({replSet: {count: 1, name: 'zl-demo', storageEngine: 'wiredTiger'}, instanceOpts: [{port: MONGO_PORT, dbPath}]});
  const uri = replSet.getUri(DB_NAME);
  if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)/.test(uri)) throw new Error('Refusing a non-local demo database');

  const [{MongoRepository}, {Models}, {Inv}, {ErpModels}, {Sales}, server] = await Promise.all([import('../src/repository.js'), import('../src/models.js'), import('../src/inventory/models.js'), import('../src/erp-models.js'), import('../src/sales/models.js'), import('../src/server.js')]);
  const repo = new MongoRepository();
  await repo.connect(uri);
  const native = () => mongoose.connection.db!;
  if (mongoose.connection.name !== DB_NAME) throw new Error('Connected to an unexpected database');

  const seeded = await native().collection('demo_meta').findOne({_id: 'seed' as any});
  const needsSeed = reset || !seeded;
  if (needsSeed) {
    // Only ever this private demo database. Emptied rather than dropped so indexes are built exactly as in the app.
    await Promise.allSettled(mongoose.modelNames().map(n => mongoose.model(n).init()));
    for (const c of await native().listCollections().toArray()) if (!c.name.startsWith('system.')) await native().collection(c.name).deleteMany({});
    const hash = (p: string) => bcrypt.hashSync(p, 10);
    await repo.commit({users: [], products: [], customers: [], orders: [], invoices: [], settings: undefined as any, audit: [], inventoryMovements: []}, {
      users: [
        {id: 'u1', name: 'Demo Owner', email: 'owner@example.com', password: hash('ChangeMe123!'), role: 'owner'},
        {id: 'u-accounts-dev', name: 'Accounts Staff', email: 'accounts@example.com', password: hash('AccountsTest123!'), role: 'accounts'},
      ],
      products: [], orders: [], invoices: [], audit: [], inventoryMovements: [],
      customers: CUSTOMERS.map(([name, address], i) => ({id: `cust-${String(i + 1).padStart(2, '0')}`, name, address, phone: `90000300${String(i + 1).padStart(2, '0')}`, balance: 0})),
      settings: {businessName: 'Demo Almirah Works', currency: 'INR', stockPolicy: 'approval', taxEnabled: false},
    }, true);
  }

  server.installTestState(await repo.reload(), repo);
  const http = createServer(server.app);
  await new Promise<void>((resolve, reject) => { http.once('error', reject); http.listen(API_PORT, () => resolve()); });
  const url = `http://127.0.0.1:${API_PORT}`;

  const tokens: Record<string, string> = {};
  async function call(who: string, method: string, route: string, body?: unknown) {
    const headers: Record<string, string> = {'Content-Type': 'application/json'};
    if (tokens[who]) headers.Authorization = `Bearer ${tokens[who]}`;
    if (method !== 'GET') headers['Idempotency-Key'] = crypto.randomUUID();
    const res = await fetch(url + route, {method, headers, body: body === undefined ? undefined : JSON.stringify(body)});
    const text = await res.text();
    const parsed = text ? JSON.parse(text) : null;
    if (res.status >= 300) throw new Error(`${method} ${route} -> ${res.status}: ${parsed?.error || text}`);
    return parsed;
  }
  const login = async (who: string, credentials: Record<string, string>) => { tokens[who] = (await call('', 'POST', '/api/auth/login', credentials)).token; };

  /** Move everything the last event wrote back to its simulated moment. */
  const KEEP = new Set(['expectedDate', 'dueDate', 'startDate', 'lockedUntil', 'joiningDate']);   // set deliberately, or not a "when it happened" field
  const originalCreated = new Map<string, unknown>();
  let stampCollections: string[] = [];
  const isIso = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v);
  function shift(value: any, since: Date, when: Date): {value: any; changed: boolean} {
    if (value instanceof Date) return value >= since ? {value: when, changed: true} : {value, changed: false};
    if (isIso(value)) return new Date(value) >= since ? {value: when.toISOString(), changed: true} : {value, changed: false};
    if (Array.isArray(value)) { let changed = false; const next = value.map(v => { const r = shift(v, since, when); changed ||= r.changed; return r.value; }); return {value: next, changed}; }
    if (value && typeof value === 'object' && value.constructor === Object) { let changed = false; const next: any = {}; for (const [k, v] of Object.entries(value)) { if (KEEP.has(k)) { next[k] = v; continue; } const r = shift(v, since, when); changed ||= r.changed; next[k] = r.value; } return {value: next, changed}; }
    return {value, changed: false};
  }
  async function stamp(since: Date, when: Date) {
    for (const name of stampCollections) {
      const col = native().collection(name);
      const docs = await col.find({$or: [{updatedAt: {$gte: since}}, {createdAt: {$gte: since}}, {at: {$gte: since}}]}).toArray();
      for (const doc of docs) {
        const {_id, ...rest} = doc;
        const key = `${name}:${String(_id)}`;
        const next = shift(rest, since, when).value;
        // Saving a legacy record can refresh createdAt; a record's creation moment is fixed the first time it is seen.
        if (next.createdAt !== undefined) { if (originalCreated.has(key)) next.createdAt = originalCreated.get(key); else originalCreated.set(key, next.createdAt); }
        await col.replaceOne({_id}, next);
      }
    }
  }
  async function refreshStampCollections() {
    const skip = new Set([Inv.Operation.collection.name, Inv.Counter.collection.name, Inv.Settings.collection.name, Models.lock.collection.name, Models.settings.collection.name, 'demo_meta']);
    stampCollections = (await native().listCollections().toArray()).map(c => c.name).filter(n => !skip.has(n) && !n.startsWith('system.'));
  }

  if (needsSeed) {
    const started = Date.now();
    console.log('Seeding demo data through the API. This takes a few minutes on the first run…');
    await login('owner', {email: 'owner@example.com', password: 'ChangeMe123!'});
    await login('acc', {email: 'accounts@example.com', password: 'AccountsTest123!'});
    const START = ago(370, 10);
    const itemByCode = new Map<string, any>();
    const supplierId = new Map<string, string>();
    const productId = new Map<string, string>();
    const salesmen: Array<{id: string; key: string; name: string; customers: string[]; leftDaysAgo?: number}> = [];

    // ----- setup, dated a little over a year ago -----
    let setupSince = new Date();
    await call('owner', 'POST', '/api/inventory/categories/load-suggested', {});
    const stages = (await call('owner', 'GET', '/api/inventory/settings')).stages;
    await call('owner', 'PUT', '/api/inventory/settings', {revision: 0, purchaseApprovalLimitRupees: 0, adjustmentApprovalLimitRupees: 0, selfApprovalAllowed: false, overReceiptTolerancePct: 2, companyStateCode: '19', stages: stages.map((s: any) => ({name: s.name})), accountantGrants: [], salesCountAt: 'APPROVED'});
    const categories = await call('owner', 'GET', '/api/inventory/categories?active=all');
    const catList: any[] = Array.isArray(categories) ? categories : categories.items;
    const productCats = new Map<string, string>();
    for (const name of new Set(PRODUCTS.map(p => p.category))) productCats.set(name, String((await call('owner', 'POST', '/api/inventory/product-categories', {name}))._id));
    for (const s of SUPPLIERS) {
      const {key, inactive, ...body} = s as any;
      const created = await call('owner', 'POST', '/api/inventory/suppliers', body);
      supplierId.set(key, created.id);
      if (inactive) await call('owner', 'POST', `/api/inventory/suppliers/${created.id}/status`, {status: 'INACTIVE'});
    }
    for (const it of ITEMS) {
      const category = catList.find(c => c.name === it.cat);
      const created = await call('owner', 'POST', '/api/inventory/items', {name: it.name, code: it.code, itemType: it.type, categoryId: category ? String(category._id) : null, stockUnit: it.unit, openingQty: it.open, openingCostRupees: it.cost, reorderLevel: it.reorder, reorderQty: it.reorder * 2, maxStock: it.reorder * 6 || null, leadTimeDays: int(3, 14), preferredSupplierId: supplierId.get(it.sup), location: it.loc, grade: it.grade || '', thicknessMm: it.mm ?? null, description: `Dummy stock item for the demo: ${it.name}.`});
      itemByCode.set(it.code, {...it, id: created.id});
      if (it.inactive) await call('owner', 'POST', `/api/inventory/items/${created.id}/status`, {status: 'INACTIVE'});
    }
    for (const p of PRODUCTS) {
      const created = await call('owner', 'POST', '/api/inventory/products', {
        master: {name: p.name, sku: p.sku, category: p.category, unit: 'piece', price: p.price, reorder: p.reorder},
        profile: {productCode: p.sku, brand: 'Steel Raj', model: p.name, design: p.sku, doorCount: p.doors, drawerCount: p.drawers, internalShelves: 3 + p.doors, heightIn: p.h, widthIn: p.w, depthIn: p.d, thicknessMm: p.mm, weightKg: p.weight, material: 'E.D.D Steel', colour: p.colour, finish: 'Powder Coated', lockType: 'Multi-point', handleType: 'SS Handle', features: ['Locker compartment', 'Saree hanger', 'Adjustable shelves'], description: `${p.name} is a ${p.doors}-door steel almirah with ${p.drawers} drawer(s). Dummy product for the demo.`, hsnCode: '94031000', gstRateBps: 1800, wholesalePriceRupees: Math.round(p.price * 0.92), retailPriceRupees: Math.round(p.price * 1.15), discountPct: 5, warehouseLocation: pick(['Finished Bay 1', 'Finished Bay 2', 'Showroom'])},
        openingQty: p.bom ? p.opening : p.opening * 5, openingCostRupees: Math.round(p.price * (0.62 + rnd() * 0.12)),
      });
      productId.set(p.sku, created.id);
    }
    const variant = await call('owner', 'POST', '/api/inventory/products', {master: {name: 'Steel Raj Classic 2 (Blue)', sku: 'STEEL-CLASSIC-2-BLU', category: 'Steel Raj', unit: 'piece', price: 12100, reorder: 4}, profile: {colour: 'Blue', variantLabel: 'Blue', gstRateBps: 1800, hsnCode: '94031000', doorCount: 2, drawerCount: 2}, openingQty: 14, openingCostRupees: 8300, variantOf: productId.get('STEEL-CLASSIC-2')});
    const discontinued = await call('owner', 'POST', '/api/inventory/products', {master: {name: 'Steel Raj Old Model 1999', sku: 'STEEL-OLD-1999', category: 'Steel Raj', unit: 'piece', price: 7900, reorder: 0}, profile: {gstRateBps: 1800, hsnCode: '94031000', doorCount: 2}, openingQty: 0});
    await call('owner', 'POST', '/api/inventory/products/bulk', {ids: [discontinued.id], status: 'archived'});
    productId.set('STEEL-CLASSIC-2-BLU', variant.id);

    for (const [i, s] of SALESMEN.entries()) {
      const customerIds = CUSTOMERS.map(([, , owner], c) => owner === i ? `cust-${String(c + 1).padStart(2, '0')}` : '').filter(Boolean);
      const created = await call('owner', 'POST', '/api/salesmen', {name: s.name, phone: s.phone, email: `${s.name.split(' ')[0].toLowerCase()}@demo.example`, address: s.address, employeeId: s.employeeId, joiningDate: ymd(ago(380 + i * 60)), territory: s.territory, categoryIds: s.cats.map(c => productCats.get(c)!), customerIds, password: SALESMAN_PASSWORD});
      await Models.users.collection.updateOne({id: created.id}, {$set: {mustChangePassword: false}});
      await login(`s${i}`, {phone: s.phone, password: SALESMAN_PASSWORD});
      salesmen.push({id: created.id, key: `s${i}`, name: s.name, customers: customerIds, leftDaysAgo: (s as any).leftDaysAgo});
    }
    await refreshStampCollections();
    await stamp(setupSince, START);
    server.installTestState(await repo.reload(), repo);              // legacy routes authenticate against this in-memory copy

    // ----- BOMs -----
    const bomProducts = PRODUCTS.filter(p => p.bom);
    const bomLines = (p: DemoProduct) => ITEMS.filter(i => i.perUnit).map(i => ({itemId: itemByCode.get(i.code).id, qty: Math.round(i.perUnit! * (i.code === 'CMP-HINGE-4' ? p.doors * 3 / 6 : i.code === 'CMP-LOCK-MP' ? 1 : p.h * p.w / 2800) * 100) / 100 || 1, wastagePct: i.type === 'RAW_MATERIAL' ? 3 : 0}));
    for (const p of bomProducts) {
      setupSince = new Date();
      const b = await call('owner', 'POST', '/api/inventory/boms', {productId: productId.get(p.sku), lines: bomLines(p), labourRupees: Math.round(p.price * 0.09), overheadRupees: Math.round(p.price * 0.04), otherCosts: [{label: 'Transport to store', rupees: 80}], notes: 'Standard build sheet.'});
      await call('owner', 'POST', `/api/inventory/boms/${b.id}/approve`, {});
      await stamp(setupSince, later(START, 1));
    }

    // ----- purchases: a monthly cycle per supplier, rates creeping up -----
    const consumers = ITEMS.filter(i => i.perUnit);
    const po = (who: string, supplier: SupplierKey, lines: Array<{item: DemoItem; qty: number; rate: number}>, extra: Record<string, unknown> = {}) => call(who, 'POST', '/api/inventory/purchase-orders', {supplierId: supplierId.get(supplier), lines: lines.map(l => ({itemId: itemByCode.get(l.item.code).id, unit: l.item.unit, qty: l.qty, rateRupees: l.rate, gstPct: l.item.gst})), freightRupees: 1500, ...extra});
    let invoiceSeq = 1000;
    function purchaseCycle(start: Date, supplier: SupplierKey, lines: Array<{item: DemoItem; qty: number; rate: number}>, splitReceipt: boolean, payInFull: boolean) {
      let id = '', billId = '';
      const invoice = `${supplier.toUpperCase()}/${++invoiceSeq}`;
      const taxed = lines.reduce((a, l) => a + l.qty * l.rate * (1 + l.item.gst / 100), 0) + 1500;
      const total = Math.round(taxed * 100) / 100;
      const receive = (share: number, reject: boolean) => ({supplierInvoiceNo: invoice, lines: lines.map((l, i) => { const qty = Math.max(1, Math.floor(l.qty * share)); const bad = reject && i === 0 && l.item.unit !== 'kg' ? 2 : 0; return {lineNo: i + 1, receivedQty: qty, acceptedQty: qty - bad, rejectReason: bad ? 'Dented in transit' : ''}; })});
      const steps: Array<[Date, string, () => Promise<unknown>]> = [
        [start, 'PO', async () => { id = (await po('acc', supplier, lines, {submit: true, expectedDate: ymd(later(start, 6)), notes: 'Monthly replenishment.'})).id; }],
        [later(start, 1), 'PO approve', () => call('owner', 'POST', `/api/inventory/purchase-orders/${id}/approve`, {})],
      ];
      if (splitReceipt) {
        steps.push([later(start, 4), 'GRN part', () => call('acc', 'POST', `/api/inventory/purchase-orders/${id}/receive`, {...receive(0.6, true), receivedDate: ymd(later(start, 4))})]);
        steps.push([later(start, 9), 'PO close', async () => { const cur = await Inv.PurchaseOrder.findById(id).lean() as any; if (cur.status === 'PARTIALLY_RECEIVED') await call('owner', 'POST', `/api/inventory/purchase-orders/${id}/close`, {reason: 'Balance rejected at inspection, not required'}); }]);
        steps.push([later(start, 7), 'GRN rest', async () => { const cur = await Inv.PurchaseOrder.findById(id).lean() as any; await call('acc', 'POST', `/api/inventory/purchase-orders/${id}/receive`, {supplierInvoiceNo: invoice, receivedDate: ymd(later(start, 7)), lines: cur.lines.map((l: any) => { const left = (l.orderedM - l.receivedM) / 1000; return {lineNo: l.lineNo, receivedQty: left, acceptedQty: left}; }).filter((l: any) => l.receivedQty > 0)}); }]);
      } else steps.push([later(start, 5), 'GRN', () => call('acc', 'POST', `/api/inventory/purchase-orders/${id}/receive`, {...receive(1, false), receivedDate: ymd(later(start, 5))})]);
      const billed = later(start, 8);
      steps.push([billed, 'Bill', async () => { billId = (await call('acc', 'POST', '/api/inventory/bills', {supplierId: supplierId.get(supplier), supplierInvoiceNo: invoice, invoiceDate: ymd(billed), poId: id, lines: lines.map(l => ({description: l.item.name, itemId: itemByCode.get(l.item.code).id, qty: l.qty, unit: l.item.unit, rateRupees: l.rate, gstPct: l.item.gst})), freightRupees: 1500, totalRupees: total})).id; }]);
      steps.push([later(billed, 1), 'Bill post', () => call('acc', 'POST', `/api/inventory/bills/${billId}/post`, {})]);
      const paid = later(billed, int(12, 28));
      steps.push([paid, 'Supplier pay', () => call('acc', 'POST', '/api/inventory/supplier-payments', {supplierId: supplierId.get(supplier), amountRupees: payInFull ? total : round(total * 0.5, 100), method: pick(['BANK', 'BANK', 'UPI', 'CHEQUE']), reference: `DEMO-${int(100000, 999999)}`, date: ymd(paid), allocations: [{billId, amountRupees: payInFull ? total : round(total * 0.5, 100)}]})]);
      chain(steps);
    }
    for (let m = 12; m >= 0; m--) {
      const growth = 1 + (12 - m) * 0.008;
      const bySupplier = new Map<SupplierKey, Array<{item: DemoItem; qty: number; rate: number}>>();
      for (const item of consumers) { const list = bySupplier.get(item.sup) || []; list.push({item, qty: round(item.perUnit! * 62, item.perUnit! < 1 ? 5 : 10), rate: Math.round(item.cost * growth * 100) / 100}); bySupplier.set(item.sup, list); }
      for (const [supplier, lines] of bySupplier) purchaseCycle(ago(m * 30 + int(16, 24), 11), supplier, lines, m % 3 === 0 && supplier === 'hardware', m > 3 || supplier === 'packing');
    }

    // ----- production: two batches a month -----
    const batches = 2;
    const runProduction = (start: Date, p: DemoProduct, planned: number, rejects: number) => {
      let id = '';
      const steps: Array<[Date, string, () => Promise<unknown>]> = [
        [start, 'Production', async () => { id = (await call('owner', 'POST', '/api/inventory/productions', {productId: productId.get(p.sku), plannedQty: planned, startDate: ymd(start), expectedDate: ymd(later(start, 9)), assignedTo: pick(['Line A – Manik Sarkar', 'Line B – Tapan Dey']), priority: pick(['NORMAL', 'NORMAL', 'HIGH', 'LOW']), notes: 'Scheduled batch.', submit: true})).id; }],
        [later(start, 0.2), 'Production approve', () => call('owner', 'POST', `/api/inventory/productions/${id}/approve`, {})],
        [later(start, 0.4), 'Reserve', () => call('owner', 'POST', `/api/inventory/productions/${id}/reserve`, {})],
        [later(start, 1), 'Issue', async () => { const o = await Inv.Production.findById(id).lean() as any; await call('owner', 'POST', `/api/inventory/productions/${id}/issue`, {lines: o.lines.map((l: any) => ({itemId: l.itemId, qty: l.requiredM / 1000}))}); }],
        [later(start, 1.2), 'Start', () => call('owner', 'POST', `/api/inventory/productions/${id}/start`, {})],
      ];
      stages.forEach((s: any, i: number) => steps.push([later(start, 1.5 + i * 0.6), `Stage ${s.code}`, () => call('owner', 'POST', `/api/inventory/productions/${id}/stage`, {code: s.code, qtyDone: planned})]));
      const end = later(start, 8.5);
      steps.push([end, 'QC', () => call('owner', 'POST', `/api/inventory/productions/${id}/quality-check`, {})]);
      steps.push([later(end, 0.5), 'Output', () => call('owner', 'POST', `/api/inventory/productions/${id}/output`, {producedQty: planned, acceptedQty: planned - rejects, qcNotes: rejects ? 'Paint runs on door panel' : ''})]);
      steps.push([later(end, 0.8), 'Complete', () => call('owner', 'POST', `/api/inventory/productions/${id}/complete`, {notes: 'Batch closed.'})]);
      chain(steps);
    };
    for (let m = 11; m >= 0; m--) for (let b = 0; b < batches; b++) runProduction(ago(m * 30 + 20 - b * 12, 9), bomProducts[(m * batches + b) % bomProducts.length], int(24, 32), chance(0.4) ? int(1, 2) : 0);

    // ----- orders: busier around the Puja season, growing through the year -----
    const NEWCOMERS = new Set(['cust-05', 'cust-10', 'cust-15', 'cust-20', 'cust-24']);
    const orderIds: string[] = [];
    let stockOuts = 0;
    const season = (d: Date) => ({9: 1.5, 10: 1.7, 11: 1.15, 3: 1.2, 4: 1.15}[d.getUTCMonth()] ?? 1);
    function planOrder(when: Date, opts: {stuck?: boolean} = {}) {
      const eligible = salesmen.filter(s => !(s.leftDaysAgo && when.getTime() > ago(s.leftDaysAgo).getTime() - 12 * DAY));
      const s = pick(eligible);
      const recent = when.getTime() > ago(21).getTime();
      const customer = pick(s.customers.filter(c => recent || !NEWCOMERS.has(c)));
      const lines = Array.from({length: pick([1, 1, 2, 2, 3])}, () => pick(PRODUCTS)).filter((p, i, a) => a.indexOf(p) === i).map(p => ({productId: productId.get(p.sku)!, qty: pick([1, 2, 2, 3, 4, 5])}));
      let id = '', total = 0;
      const steps: Array<[Date, string, () => Promise<unknown>]> = [[when, 'Order', async () => { const o = await call(s.key, 'POST', '/api/orders', {customerId: customer, items: lines}); id = o.id; total = o.total; orderIds.push(id); }]];
      const status = (status: string, reason?: string) => () => call(pick(['owner', 'acc']), 'PATCH', `/api/orders/${id}/status`, {status, reason});
      const fate = rnd();
      if (opts.stuck) { chain(steps); return; }
      if (fate < 0.05) { steps.push([later(when, 0.6), 'Reject', status('Rejected', pick(['Credit limit exceeded', 'Duplicate order', 'Pricing mismatch']))]); chain(steps); return; }
      const approved = later(when, 0.2 + rnd() * 1.6);
      steps.push([approved, 'Approve', async () => { try { await status('Approved')(); } catch (e) { if (!/Insufficient/.test(String(e))) throw e; await status('Rejected', 'Out of stock')(); stockOuts++; throw new StopChain(); } }]);
      if (fate < 0.1) { steps.push([later(approved, 1), 'Cancel', status('Cancelled', pick(['Customer changed mind', 'Delivery date not acceptable']))]); chain(steps); return; }
      const processing = later(approved, 0.5 + rnd() * 1.5), dispatched = later(processing, 1 + rnd() * 2), delivered = later(dispatched, 1 + rnd() * 3);
      steps.push([processing, 'Processing', status('Processing')], [dispatched, 'Dispatch', status('Dispatched')], [delivered, 'Deliver', status('Delivered')]);
      if (chance(0.3)) steps.push([later(approved, 0.1), 'Invoice', () => call('acc', 'POST', `/api/invoices/from-order/${id}`, {})]);
      const payMood = rnd();
      const method = () => pick(['cash', 'upi', 'upi', 'bank_transfer', 'bank_transfer', 'cheque', 'card']);
      const pay = (when2: Date, share: number, viaSalesman: boolean, follow: 'verify' | 'reject' | 'none') => {
        let paymentId = '';
        const key = viaSalesman && !s.leftDaysAgo ? s.key : 'acc';
        steps.push([when2, 'Payment', async () => { paymentId = (await call(key, 'POST', '/api/sales/payments', {orderId: id, amount: round(total * share, 50), method: method(), paymentDate: ymd(when2), reference: `DEMO-${int(100000, 999999)}`, notes: ''})).id; }]);
        if (key !== 'acc' && follow !== 'none' && when2.getTime() < ago(12).getTime()) steps.push([later(when2, 1), 'Payment decide', () => call('acc', 'POST', `/api/sales/payments/${paymentId}/${follow}`, {reason: follow === 'reject' ? 'Cheque bounced' : ''})]);
      };
      const collected = later(dispatched, 2 + rnd() * 18);
      if (payMood < 0.62) pay(collected, 1, chance(0.35), 'verify');
      else if (payMood < 0.86) { pay(later(approved, 1), 0.4, false, 'none'); if (chance(0.5)) pay(later(collected, 8), 0.3, true, chance(0.9) ? 'verify' : 'reject'); }
      if (chance(0.05)) steps.push([later(delivered, 3), 'Return', async () => { await call('acc', 'POST', `/api/sales/orders/${id}/returns`, {lineNo: 1, qty: 1, reason: pick(['Door alignment issue', 'Dent on arrival', 'Wrong colour delivered'])}); }]);
      chain(steps);
    }
    for (let d = 365; d >= 0; d--) {
      const when = ago(d);
      const weekday = new Date(when.getTime() + IST).getUTCDay();
      const rate = (0.55 + (365 - d) / 365 * 0.3) * season(new Date(when.getTime() + IST)) * (weekday === 0 ? 0.25 : 1);
      const count = Math.floor(rate) + (chance(rate - Math.floor(rate)) ? 1 : 0);
      for (let i = 0; i < count; i++) planOrder(ago(d, pick([10, 11, 11, 12, 13, 15, 16, 17, 18, 19]), int(0, 59)));
    }
    for (const d of [6, 5, 4]) planOrder(ago(d, 12, 15), {stuck: true});                        // aged, still waiting for approval
    for (const [h, m] of [[9, 40], [10, 25], [11, 10], [12, 5]]) planOrder(ago(0, h, m), {stuck: chance(0.5)});

    // ----- collections in the last few days, so "Today" and "This month" are never empty early in a month -----
    const collect = (when: Date, from: string, share: number) => at(when, 'Recent collection', async () => {
      const list = await call('acc', 'GET', `/api/admin/bills?tab=UNPAID&from=${from}&to=${ymd(NOW)}&limit=100`);
      const bill = pick(list.items as any[]);
      if (bill) await call('acc', 'POST', '/api/sales/payments', {orderId: bill.id, amount: round(bill.duePaise / 100 * share, 50), method: pick(['upi', 'bank_transfer', 'cash']), paymentDate: ymd(when), reference: `DEMO-${int(100000, 999999)}`});
    });
    for (const [d, h] of [[3, 12], [3, 16], [2, 11], [2, 17], [1, 13], [0, 9]]) collect(ago(d, h), ymd(ago(200)), 1);
    for (const [d, h] of [[1, 15], [0, 10]]) collect(ago(d, h), ymd(ago(4)), 0.5);

    // ----- targets -----
    const firstOfMonth = (monthsBack: number) => { const [y, m] = ymd(NOW).split('-').map(Number); return new Date(Date.UTC(y, m - 1 - monthsBack, 1)).toISOString().slice(0, 10); };
    const active = salesmen.filter(s => !s.leftDaysAgo);
    for (let m = 6; m >= 0; m--) {
      const start = firstOfMonth(m);
      for (const s of active) at(new Date(`${start}T10:00:00+05:30`), 'Target', () => call('owner', 'POST', '/api/targets', {name: `${new Date(start).toLocaleString('en-IN', {month: 'long'})} sales`, salesmanId: s.id, type: 'SALES_AMOUNT', period: 'MONTHLY', startDate: start, targetValue: round(350000 + rnd() * 450000, 10000), description: 'Monthly sales target.'}));
    }
    const thisMonth = firstOfMonth(0);
    const monthStart = new Date(`${thisMonth}T10:00:00+05:30`);
    let cancelTarget = '', reviseTarget = '';
    for (const [i, s] of active.entries()) {
      at(later(monthStart, 0.01), 'Target', async () => { const r = await call('owner', 'POST', '/api/targets', {name: 'Collections this month', salesmanId: s.id, type: 'COLLECTION_AMOUNT', period: 'MONTHLY', startDate: thisMonth, targetValue: 300000 + i * 40000}); if (i === 0) reviseTarget = r.created?.[0] || r.id || ''; });
      at(later(monthStart, 0.02), 'Target', () => call('owner', 'POST', '/api/targets', {name: 'Orders this month', salesmanId: s.id, type: 'ORDER_COUNT', period: 'MONTHLY', startDate: thisMonth, targetValue: 8 + i}));
      at(later(monthStart, 0.03), 'Target', async () => { const r = await call('owner', 'POST', '/api/targets', {name: 'New distributors', salesmanId: s.id, type: 'NEW_CUSTOMERS', period: 'MONTHLY', startDate: thisMonth, targetValue: 2}); if (i === 1) cancelTarget = r.created?.[0] || r.id || ''; });
      at(later(monthStart, 0.04), 'Target', () => call('owner', 'POST', '/api/targets', {name: 'Deliveries this month', salesmanId: s.id, type: 'DELIVERIES', period: 'MONTHLY', startDate: thisMonth, targetValue: 6}));
    }
    at(later(monthStart, 0.05), 'Target cancel', async () => { if (cancelTarget) await call('owner', 'POST', `/api/targets/${cancelTarget}/cancel`, {reason: 'Territory re-allocated'}); });
    at(later(monthStart, 0.06), 'Target revise', async () => { if (!reviseTarget) return; const t = await Sales.Target.findById(reviseTarget).lean() as any; await call('owner', 'PUT', `/api/targets/${reviseTarget}`, {name: t.name, salesmanId: t.salesmanId, type: t.type, period: t.period, startDate: t.startDate, targetValue: 280000, version: t.version, reason: 'Festival season adjustment'}); });

    // ----- salesman who left -----
    for (const s of salesmen) if (s.leftDaysAgo) at(ago(s.leftDaysAgo), 'Deactivate salesman', () => call('owner', 'POST', `/api/salesmen/${s.id}/status`, {active: false, reason: 'Left the company'}));

    // ----- every remaining workflow state, so each filter and tab has rows -----
    const item = (code: string) => itemByCode.get(code);
    const sheet = ITEMS[0], hinge = ITEMS[4], carton = ITEMS[14], magnet = ITEMS[8], blade = ITEMS[17], nozzle = ITEMS[18], film = ITEMS[16], screw = ITEMS[7];
    const line = (i: DemoItem, qty: number) => ({item: i, qty, rate: i.cost});
    chain([[ago(2, 11), 'PO draft', () => po('acc', 'steel', [line(sheet, 120)], {expectedDate: ymd(later(NOW, 9)), notes: 'Draft for next month.'})]]);
    chain([[ago(1, 15), 'PO draft', () => po('owner', 'packing', [line(film, 40), line(carton, 200)], {expectedDate: ymd(later(NOW, 7))})]]);
    chain([[ago(3, 12), 'PO submitted', () => po('acc', 'hardware', [line(magnet, 800)], {submit: true, expectedDate: ymd(later(NOW, 5))})]]);
    chain([[ago(1, 12), 'PO submitted', () => po('acc', 'paint', [line(nozzle, 6)], {submit: true, expectedDate: ymd(later(NOW, 12))})]]);
    { let id = ''; chain([[ago(5, 11), 'PO', async () => { id = (await po('acc', 'hardware', [line(screw, 20)], {submit: true, expectedDate: ymd(later(NOW, 2))})).id; }], [ago(4, 11), 'PO approve', () => call('owner', 'POST', `/api/inventory/purchase-orders/${id}/approve`, {})]]); }
    { let id = ''; chain([[ago(16, 11), 'PO late', async () => { id = (await po('acc', 'steel2', [line(ITEMS[2], 60)], {submit: true, expectedDate: ymd(ago(4))})).id; }], [ago(15, 11), 'PO approve', () => call('owner', 'POST', `/api/inventory/purchase-orders/${id}/approve`, {})]]); }
    { let id = ''; chain([[ago(12, 11), 'PO', async () => { id = (await po('acc', 'packing', [line(film, 60)], {submit: true, expectedDate: ymd(ago(1))})).id; }], [ago(11, 11), 'PO approve', () => call('owner', 'POST', `/api/inventory/purchase-orders/${id}/approve`, {})], [ago(6, 11), 'GRN part', () => call('acc', 'POST', `/api/inventory/purchase-orders/${id}/receive`, {supplierInvoiceNo: 'EPI/7781', receivedDate: ymd(ago(6)), lines: [{lineNo: 1, receivedQty: 20, acceptedQty: 20}]})]]); }
    { let id = ''; chain([[ago(40, 11), 'PO', async () => { id = (await po('acc', 'chem', [line(ITEMS[12], 80)], {submit: true})).id; }], [ago(39, 12), 'PO reject', () => call('owner', 'POST', `/api/inventory/purchase-orders/${id}/reject`, {reason: 'Rate higher than last purchase'})]]); }
    { let id = ''; chain([[ago(55, 11), 'PO', async () => { id = (await po('acc', 'steel2', [line(ITEMS[2], 40)], {submit: true})).id; }], [ago(54, 12), 'PO approve', () => call('owner', 'POST', `/api/inventory/purchase-orders/${id}/approve`, {})], [ago(50, 12), 'PO cancel', () => call('acc', 'POST', `/api/inventory/purchase-orders/${id}/cancel`, {reason: 'Supplier could not deliver'})]]); }
    { let id = ''; chain([[ago(70, 11), 'PO', async () => { id = (await po('acc', 'hardware', [line(hinge, 500)], {submit: true})).id; }], [ago(69, 12), 'PO approve', () => call('owner', 'POST', `/api/inventory/purchase-orders/${id}/approve`, {})], [ago(64, 12), 'GRN', () => call('acc', 'POST', `/api/inventory/purchase-orders/${id}/receive`, {supplierInvoiceNo: 'ALH/5512', receivedDate: ymd(ago(64)), lines: [{lineNo: 1, receivedQty: 300, acceptedQty: 300}]})], [ago(58, 12), 'PO close', () => call('owner', 'POST', `/api/inventory/purchase-orders/${id}/close`, {reason: 'Balance not required'})]]); }

    const standaloneBill = (when: Date, supplier: SupplierKey, invoice: string, rupees: number, after?: (id: string) => Array<[Date, string, () => Promise<unknown>]>) => { let id = ''; chain([[when, 'Bill', async () => { id = (await call('acc', 'POST', '/api/inventory/bills', {supplierId: supplierId.get(supplier), supplierInvoiceNo: invoice, invoiceDate: ymd(when), lines: [{description: 'Workshop supplies', qty: 1, unit: 'pcs', rateRupees: rupees, gstPct: 0}], totalRupees: rupees, notes: 'Dummy bill.'})).id; }], ...(after ? after('').map(([w, l, r]) => [w, l, () => (r as any)(id)] as [Date, string, () => Promise<unknown>]) : [])]); };
    standaloneBill(ago(3, 13), 'chem', 'DC/2231', 18450);
    standaloneBill(ago(2, 14), 'paint', 'BPC/8874', 26200);
    standaloneBill(ago(20, 12), 'chem', 'DC/2199', 9400, () => [[ago(19, 12), 'Bill post', ((id: string) => call('acc', 'POST', `/api/inventory/bills/${id}/post`, {})) as any]]);
    standaloneBill(ago(30, 12), 'old', 'SSS/118', 5000, () => [[ago(29, 12), 'Bill cancel', ((id: string) => call('acc', 'POST', `/api/inventory/bills/${id}/cancel`, {reason: 'Duplicate of an earlier entry'})) as any]]);
    { let pay = ''; chain([[ago(26, 12), 'Supplier pay', async () => { pay = (await call('acc', 'POST', '/api/inventory/supplier-payments', {supplierId: supplierId.get('steel'), amountRupees: 25000, method: 'CHEQUE', reference: 'CHQ-DEMO-771', date: ymd(ago(26))})).id; }], [ago(24, 12), 'Supplier pay void', () => call('owner', 'POST', `/api/inventory/supplier-payments/${pay}/void`, {reason: 'Cheque returned by the bank'})]]); }
    for (const days of [80, 33]) at(ago(days, 15), 'Purchase return', async () => { const grn: any = await Inv.GoodsReceipt.findOne({supplierName: /Aligarh|Howrah/}).sort({createdAt: -1}).lean(); await call('acc', 'POST', '/api/inventory/purchase-returns', {grnId: String(grn._id), lines: [{lineNo: grn.lines[0].lineNo, qty: 2, reason: 'Rust spots found on inspection'}]}); });

    const draftBom = PRODUCTS.find(p => p.sku === 'FM 901')!, pendingBom = PRODUCTS.find(p => p.sku === 'NO-12')!;
    at(ago(9, 11), 'BOM draft', () => call('owner', 'POST', '/api/inventory/boms', {productId: productId.get(draftBom.sku), lines: bomLines(draftBom), labourRupees: 1900, overheadRupees: 800, notes: 'First draft for the print range.'}));
    at(ago(6, 11), 'BOM pending', async () => { const b = await call('owner', 'POST', '/api/inventory/boms', {productId: productId.get(pendingBom.sku), lines: bomLines(pendingBom), labourRupees: 2400, overheadRupees: 1000}); await call('owner', 'POST', `/api/inventory/boms/${b.id}/submit`, {}); });
    const revised = PRODUCTS.find(p => p.sku === 'SRH-16')!;
    at(ago(100, 11), 'BOM revision', async () => { const old: any = await Inv.Bom.findOne({productId: productId.get(revised.sku), status: 'ACTIVE'}).lean(); const b = await call('owner', 'POST', '/api/inventory/boms', {productId: productId.get(revised.sku), lines: bomLines(revised), labourRupees: Math.round(revised.price * 0.1), overheadRupees: Math.round(revised.price * 0.04), notes: 'Revised after labour rate change.'}); await call('owner', 'POST', `/api/inventory/boms/${old._id}/deactivate`, {}); await call('owner', 'POST', `/api/inventory/boms/${b.id}/approve`, {}); });

    const newOrder = (p: DemoProduct, qty: number, submit: boolean, when: Date) => call('owner', 'POST', '/api/inventory/productions', {productId: productId.get(p.sku), plannedQty: qty, startDate: ymd(when), expectedDate: ymd(later(when, 10)), assignedTo: 'Line A – Manik Sarkar', priority: 'NORMAL', submit});
    const b0 = bomProducts[0], b1 = bomProducts[1], b2 = bomProducts[2], b3 = bomProducts[3];
    at(ago(2, 10), 'Production draft', () => newOrder(b0, 20, false, NOW));
    at(ago(1, 10), 'Production submitted', () => newOrder(b1, 15, true, NOW));
    at(ago(1, 11), 'Production approved', async () => { const o = await newOrder(b2, 12, true, NOW); await call('owner', 'POST', `/api/inventory/productions/${o.id}/approve`, {}); });
    at(ago(1, 13), 'Production reserved', async () => { const o = await newOrder(b3, 10, true, NOW); await call('owner', 'POST', `/api/inventory/productions/${o.id}/approve`, {}); await call('owner', 'POST', `/api/inventory/productions/${o.id}/reserve`, {}); });
    at(ago(35, 10), 'Production rejected', async () => { const o = await newOrder(b1, 40, true, ago(35)); await call('owner', 'POST', `/api/inventory/productions/${o.id}/reject`, {reason: 'Batch too large for this month'}); });
    at(ago(28, 10), 'Production cancelled', async () => { const o = await newOrder(b2, 18, true, ago(28)); await call('owner', 'POST', `/api/inventory/productions/${o.id}/approve`, {}); await call('owner', 'POST', `/api/inventory/productions/${o.id}/cancel`, {reason: 'Order from distributor withdrawn'}); });
    { const p = bomProducts[4]; let id = ''; const start = ago(14, 9); chain([
      [start, 'Production late', async () => { id = (await call('owner', 'POST', '/api/inventory/productions', {productId: productId.get(p.sku), plannedQty: 16, startDate: ymd(start), expectedDate: ymd(ago(3)), assignedTo: 'Line B – Tapan Dey', priority: 'HIGH', notes: 'Running behind schedule.', submit: true})).id; await call('owner', 'POST', `/api/inventory/productions/${id}/approve`, {}); await call('owner', 'POST', `/api/inventory/productions/${id}/reserve`, {}); }],
      [later(start, 1), 'Issue', async () => { const o = await Inv.Production.findById(id).lean() as any; await call('owner', 'POST', `/api/inventory/productions/${id}/issue`, {lines: o.lines.map((l: any) => ({itemId: l.itemId, qty: l.requiredM / 1000}))}); await call('owner', 'POST', `/api/inventory/productions/${id}/start`, {}); }],
      [later(start, 3), 'Stages', async () => { for (const [i, s] of stages.slice(0, 4).entries()) await call('owner', 'POST', `/api/inventory/productions/${id}/stage`, {code: s.code, qtyDone: i < 3 ? 16 : 9}); }],
      [later(start, 5), 'Wastage', async () => { const w = await call('acc', 'POST', '/api/inventory/wastage', {itemId: item('RM-SHEET-22G').id, qty: 2, wastageType: 'CUTTING_WASTE', reason: 'Mis-cut on shearing machine', productionOrderId: id}); await call('owner', 'POST', `/api/inventory/wastage/${w.id}/approve`, {}); }],
    ]); }

    { const p = bomProducts[5]; let id = ''; const start = ago(10, 9); chain([
      [start, 'Production QC', async () => { id = (await call('owner', 'POST', '/api/inventory/productions', {productId: productId.get(p.sku), plannedQty: 14, startDate: ymd(start), expectedDate: ymd(later(NOW, 2)), assignedTo: 'Line A – Manik Sarkar', priority: 'NORMAL', submit: true})).id; await call('owner', 'POST', `/api/inventory/productions/${id}/approve`, {}); await call('owner', 'POST', `/api/inventory/productions/${id}/reserve`, {}); }],
      [later(start, 1), 'Issue', async () => { const o = await Inv.Production.findById(id).lean() as any; await call('owner', 'POST', `/api/inventory/productions/${id}/issue`, {lines: o.lines.map((l: any) => ({itemId: l.itemId, qty: l.requiredM / 1000}))}); await call('owner', 'POST', `/api/inventory/productions/${id}/start`, {}); }],
      [later(start, 8), 'Stages', async () => { for (const s of stages) await call('owner', 'POST', `/api/inventory/productions/${id}/stage`, {code: s.code, qtyDone: 14}); await call('owner', 'POST', `/api/inventory/productions/${id}/quality-check`, {}); }],
    ]); }

    const wastage = (when: Date, code: string, qty: number, type: string, reason: string, decide?: 'approve' | 'reject') => { let id = ''; chain([[when, 'Wastage', async () => { id = (await call('acc', 'POST', '/api/inventory/wastage', {itemId: item(code).id, qty, wastageType: type, reason})).id; }], ...(decide ? [[later(when, 1), 'Wastage decide', () => call('owner', 'POST', `/api/inventory/wastage/${id}/${decide}`, decide === 'reject' ? {reason: 'Please recheck the quantity'} : {})] as [Date, string, () => Promise<unknown>]] : [])]); };
    for (let m = 10; m >= 1; m -= 2) wastage(ago(m * 30 + 6, 16), pick(['RM-SHEET-24G', 'CON-POWDER-IVY', 'PKG-FILM', 'CMP-MAGNET']), int(1, 4), pick(['DAMAGED_STEEL', 'PAINT_WASTE', 'PACKAGING_DAMAGE', 'DEFECTIVE_COMPONENT']), 'Found during routine inspection', 'approve');
    wastage(ago(18, 16), 'RM-SHEET-24G', 3, 'DAMAGED_STEEL', 'Water seepage in Steel Bay A', 'reject');
    wastage(ago(2, 16), 'CON-POWDER-IVY', 4, 'PAINT_WASTE', 'Powder lumped after moisture exposure');
    wastage(ago(1, 16), 'PKG-FILM', 2, 'PACKAGING_DAMAGE', 'Rolls torn during handling');
    wastage(ago(0, 9, 30), 'CMP-MAGNET', 12, 'DEFECTIVE_COMPONENT', 'Weak magnets in the last lot');

    const count = (when: Date, codes: string[], counted: (i: number, system: number) => number, end: 'approve' | 'reject' | 'submit' | 'open') => at(when, 'Stock count', async () => {
      const c = await call('acc', 'POST', '/api/inventory/stock-counts', {scope: 'ITEMS', itemIds: codes.map(x => item(x).id), blind: false, assignedTo: 'Store – Pintu Halder', notes: 'Cycle count.'});
      const doc: any = await Inv.Count.findById(c.id).lean();
      await call('acc', 'PUT', `/api/inventory/stock-counts/${c.id}/lines`, {lines: doc.lines.map((l: any, i: number) => { const qty = counted(i, l.systemM / 1000); return {itemId: l.itemId, countedQty: end === 'open' && i > 0 ? null : qty, reason: qty === l.systemM / 1000 ? '' : 'Physical count differs'}; })});
      if (end === 'open') return;
      await call('acc', 'POST', `/api/inventory/stock-counts/${c.id}/submit`, {});
      if (end === 'approve') await call('owner', 'POST', `/api/inventory/stock-counts/${c.id}/approve`, {});
      if (end === 'reject') await call('owner', 'POST', `/api/inventory/stock-counts/${c.id}/reject`, {reason: 'Recount the rack, numbers look off'});
    });
    count(ago(120, 17), ['SPR-BLADE', 'SPR-NOZZLE'], (i, s) => i ? s - 1 : s, 'approve');
    count(ago(60, 17), ['SPR-NOZZLE', 'CON-PRETREAT'], (i, s) => i ? s - 3 : s, 'approve');
    count(ago(25, 17), ['CMP-SCREW-BOX', 'SPR-BLADE'], (_i, s) => s + 1, 'reject');
    count(ago(3, 17), ['CON-WELD-ROD', 'SPR-BLADE'], (i, s) => i ? s : s - 2, 'submit');
    count(ago(1, 17), ['CON-PRETREAT', 'SPR-NOZZLE', 'CMP-SCREW-BOX'], (_i, s) => s, 'open');

    const adjust = (when: Date, who: string, type: string, code: string, qty: number, reason: string, then?: 'approve' | 'reject') => at(when, 'Adjustment', async () => { const a = await call(who, 'POST', '/api/inventory/adjustments', {type, itemId: item(code).id, qty, reason}); if (then) await call('owner', 'POST', `/api/inventory/adjustments/${a.id}/${then}`, then === 'reject' ? {reason: 'Not supported by the count sheet'} : {}); });
    adjust(ago(140, 12), 'owner', 'FOUND', 'CMP-SCREW-BOX', 2, 'Found in the old store room');
    adjust(ago(90, 12), 'acc', 'MISSING', 'CON-PRETREAT', 4, 'Not found during audit', 'approve');
    adjust(ago(44, 12), 'acc', 'DAMAGED', 'SPR-NOZZLE', 1, 'Cracked during fitting', 'reject');
    adjust(ago(4, 12), 'acc', 'DECREASE', 'CON-WELD-ROD', 3, 'Used for machine repair');
    adjust(ago(1, 14), 'acc', 'INCREASE', 'PKG-FOAM', 20, 'Unrecorded delivery found');
    at(ago(85, 12), 'Ledger reversal', async () => { const row: any = await Inv.Ledger.findOne({type: 'ADJUSTMENT_OUT', itemKind: 'ITEM'}).lean(); if (row) await call('owner', 'POST', `/api/inventory/ledger/${row._id}/reverse`, {reason: 'Stock was found, entry made in error'}); });

    // ----- replay -----
    queue.sort((a, b) => a.at.getTime() - b.at.getTime());
    const failures = new Map<string, {count: number; sample: string}>();
    for (const [i, step] of queue.entries()) {
      const since = new Date();
      try { await step.run(); }
      catch (e) { if (!(e instanceof StopChain)) { const f = failures.get(step.label) || {count: 0, sample: e instanceof Error ? e.message : String(e)}; f.count++; failures.set(step.label, f); } }
      if (i % 200 === 0) await refreshStampCollections();
      await stamp(since, step.at);
      if (i % 250 === 0) console.log(`  ${i}/${queue.length} events, up to ${ymd(step.at)}`);
    }
    await native().collection('demo_meta').replaceOne({_id: 'seed' as any}, {seededAt: new Date(), orders: orderIds.length}, {upsert: true});
    console.log(`Seeded ${queue.length} events in ${Math.round((Date.now() - started) / 1000)}s (${stockOuts} orders rejected as out of stock).`);
    for (const [label, f] of failures) console.log(`  skipped ${f.count} x ${label}: ${f.sample}`);
    server.installTestState(await repo.reload(), repo);
  } else console.log(`Using existing demo data from ${ymd(new Date((seeded as any).seededAt))}. Run "npm run demo -- --reset" to refresh it.`);

  const counts = {orders: await Models.orders.countDocuments(), products: await Models.products.countDocuments(), distributors: await Models.customers.countDocuments(), payments: await ErpModels.Payment.countDocuments(), purchaseOrders: await Inv.PurchaseOrder.countDocuments(), production: await Inv.Production.countDocuments(), ledgerRows: await Inv.Ledger.countDocuments()};
  console.log(`\nDemo API ready on ${url}`, counts);
  console.log('Now run the frontend (cd frontend, npm run dev) and sign in:\n  owner@example.com / ChangeMe123!\n  accounts@example.com / AccountsTest123!\n  salesman phone 9000010001 / ' + SALESMAN_PASSWORD + '\nPress Ctrl+C to stop.');

  const stop = async () => { http.close(); await repo.close(); await replSet.stop({doCleanup: false, force: false}); process.exit(0); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}

main().catch(e => { console.error('Demo failed:', e instanceof Error ? e.message : e); process.exit(1); });
