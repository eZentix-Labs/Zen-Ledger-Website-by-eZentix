/*
 Restores a backup (from scripts/backup-mongo.ts) into a throwaway local in-memory replica set
 and checks that the application's persistence layer reads it correctly and that a mutation
 leaves every unrelated document byte-for-byte unchanged. Never connects to a remote database.

   npx tsx scripts/verify-backup-locally.ts <backup-dir>
*/
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'local-verification-secret-with-32-characters';
process.env.PERSISTENCE = 'mongo';
process.env.API_AUTOSTART = 'false';
process.env.READ_REFRESH_MS = '0';

import fs from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'node:http';
import jwt from 'jsonwebtoken';
import {MongoClient} from 'mongodb';
import {EJSON} from 'bson';

const dir = path.resolve(process.argv[2] || '');
const manifest = JSON.parse(await fs.readFile(path.join(dir, 'manifest.json'), 'utf8'));
const {startReplSet} = await import('../src/test-mongo.js');
const {replSet, uri} = await startReplSet();
process.env.MONGODB_URI = uri; // local throwaway instance only
const local = new MongoClient(uri); await local.connect();
const db = local.db('zenledger_test');
for (const c of manifest.collections) {
  const docs = EJSON.parse(await fs.readFile(path.join(dir, c.file), 'utf8'), {relaxed: false}) as any[];
  if (docs.length) await db.collection(c.name).insertMany(docs);
}
const snapshot = async (name: string) => EJSON.stringify(await db.collection(name).find().sort({_id: 1}).toArray());
const checks: [string, boolean, string?][] = [];
try {
  const {MongoRepository, diffStores} = await import('../src/repository.js');
  const repo = new MongoRepository(); await repo.connect(uri);
  const store = await repo.reload();                       // also runs validateStore (stock invariants)
  checks.push(['restored data loads and passes stock invariants', true]);
  checks.push(['reload → diff is empty (no spurious writes)', diffStores(store, structuredClone(store)).length === 0]);
  checks.push(['products: count matches backup', store.products.length === manifest.collections.find((c: any) => c.name === 'products').count]);
  checks.push(['every product: 0 ≤ reserved ≤ stock', store.products.every(p => p.reservedStock >= 0 && p.reservedStock <= p.stock)]);
  const reservedByOrders = new Map<string, number>();
  for (const o of store.orders) if (o.stockReserved) for (const l of o.items) reservedByOrders.set(l.productId, (reservedByOrders.get(l.productId) || 0) + l.qty);
  checks.push(['reserved stock equals open reserved orders', store.products.every(p => (reservedByOrders.get(p.id) || 0) === p.reservedStock), JSON.stringify([...reservedByOrders])]);

  const before = Object.fromEntries(await Promise.all(['products', 'orders', 'inventorymovements', 'invoices', 'users'].map(async n => [n, await snapshot(n)])));
  const app = await import('../src/server.js');
  app.installTestState(store, repo);
  const server = createServer(app.app); await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as any).port;
  const owner = store.users.find(u => u.role === 'owner')!;
  const token = jwt.sign({id: owner.id, name: owner.name, email: owner.email, role: 'owner'}, process.env.JWT_SECRET!, {expiresIn: '5m'});
  const get = (p: string) => fetch(`http://127.0.0.1:${port}${p}`, {headers: {Authorization: `Bearer ${token}`}});
  checks.push(['GET /api/orders works on real data', (await get('/api/orders')).status === 200]);
  checks.push(['GET /api/dashboard works on real data', (await get('/api/dashboard')).status === 200]);
  const created = await fetch(`http://127.0.0.1:${port}/api/customers`, {method: 'POST', headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'}, body: JSON.stringify({name: 'Local verification customer', phone: '9000000000'})});
  checks.push(['a mutation succeeds on real data', created.status === 201]);
  for (const n of Object.keys(before)) checks.push([`unrelated collection "${n}" byte-for-byte unchanged after the mutation`, before[n] === await snapshot(n)]);
  server.close(); await repo.close();
} catch (e) {
  checks.push(['verification run', false, e instanceof Error ? e.message : String(e)]);
} finally { await local.close(); await replSet.stop(); }
for (const [name, ok, detail] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? `  (${detail})` : ''}`);
process.exit(checks.every(c => c[1]) ? 0 : 1);
