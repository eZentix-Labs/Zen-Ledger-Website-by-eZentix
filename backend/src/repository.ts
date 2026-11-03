import fs from 'node:fs/promises';
import path from 'node:path';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import {config} from './config.js';
import {Models} from './models.js';
import {Store} from './types.js';
import {pdfCatalogProducts} from './catalog.js';
import {mirrorLegacyChanges} from './sales/mirror.js';

export interface Repository {
  kind: 'json' | 'mongo';
  /** First load at startup (may seed an empty development database). */
  load(): Promise<Store>;
  /** Read the current committed state without seeding. Used under the mutation lock. */
  reload?(): Promise<Store>;
  /** Persist only what changed between `before` and `after`. */
  commit?(before: Store, after: Store): Promise<void>;
  save(store: Store): Promise<void>;
  close(): Promise<void>;
  acquireMutationLock?: () => Promise<() => Promise<void>>;
}

export class JsonRepository implements Repository {
  kind = 'json' as const;
  constructor(private file = config.dataFile) {}
  async load() {
    try {
      const store = validateStore(normalize(JSON.parse(await fs.readFile(this.file, 'utf8')) as Store));
      if (config.NODE_ENV !== 'production' && ensureDevelopmentUsers(store)) await this.save(store);
      return store;
    } catch (e: any) {
      if (e?.code !== 'ENOENT') throw new Error('JSON datastore exists but could not be parsed or failed validation; original file was left untouched');
      const seed = makeSeed(); ensureDevelopmentUsers(seed); await this.save(seed); return seed;
    }
  }
  async commit(_before: Store, after: Store) { await this.save(after); }
  async save(store: Store) { await fs.mkdir(path.dirname(this.file), {recursive: true}); await fs.writeFile(this.file, JSON.stringify(store, null, 2), 'utf8'); }
  async close() {}
}

type KeyedCollection = Exclude<keyof Store, 'settings'>;
const keyed: Array<[KeyedCollection, keyof typeof Models]> = [
  ['users', 'users'], ['products', 'products'], ['customers', 'customers'], ['orders', 'orders'],
  ['invoices', 'invoices'], ['audit', 'audit'], ['inventoryMovements', 'movements'],
];

export class PersistenceError extends Error {}

/**
 * MongoDB persistence.
 *
 * History: this used to delete every collection and re-insert the whole in-memory
 * store on each save, which silently erased writes made by any other process
 * (second instance, deploy overlap, scripts, the new inventory module).
 *
 * Now: callers hold the cross-process mutation lock, `reload()` reads the current
 * committed state, and `commit()` writes only inserted/changed documents inside a
 * transaction (when the deployment is a replica set, as Atlas always is).
 * Documents are never deleted by this layer.
 */
export class MongoRepository implements Repository {
  kind = 'mongo' as const;
  private replicaSet = false;
  async connect(uri = config.MONGODB_URI!) {
    try {
      await mongoose.connect(uri);
      await Promise.all(Object.values(Models).map(model => model.createIndexes()));
      const hello = await mongoose.connection.db!.admin().command({hello: 1});
      this.replicaSet = Boolean(hello.setName);
    } catch (e) { await mongoose.disconnect().catch(() => undefined); throw e; }
  }
  get supportsTransactions() { return this.replicaSet; }

  async load() {
    const store = await this.read();
    if (store) return store;
    // Empty database. Never create a known default admin or fake customers in production.
    if (config.NODE_ENV === 'production') {
      const email = process.env.BOOTSTRAP_OWNER_EMAIL, password = process.env.BOOTSTRAP_OWNER_PASSWORD;
      if (!email || !password || password.length < 12) throw new Error('Empty production database: set BOOTSTRAP_OWNER_EMAIL and a 12+ character BOOTSTRAP_OWNER_PASSWORD to create the first owner account');
      const seed: Store = {...makeSeed(), customers: [], users: [{id: 'u1', name: 'Owner', email: email.toLowerCase(), password: bcrypt.hashSync(password, 10), role: 'owner'}]};
      await this.insertAll(seed); return seed;
    }
    const seed = makeSeed(); ensureDevelopmentUsers(seed); await this.insertAll(seed); return seed;
  }

  async reload() {
    const store = await this.read();
    if (!store) throw new PersistenceError('Database is empty or incomplete; refusing to continue');
    return store;
  }

  private async read(): Promise<Store | null> {
    const [users, products, customers, orders, invoices, settings, audit, movements] = await Promise.all([
      Models.users.find().lean(), Models.products.find().lean(), Models.customers.find().lean(), Models.orders.find().lean(),
      Models.invoices.find().lean(), Models.settings.findOne().lean(), Models.audit.find().sort({at: -1}).lean(), Models.movements.find().sort({createdAt: -1}).lean(),
    ]);
    const anyRecords = users.length + products.length + customers.length + orders.length + invoices.length + audit.length + movements.length + (settings ? 1 : 0);
    if (!anyRecords) return null;
    if (!users.length || !settings) throw new PersistenceError('MongoDB contains a partial/incomplete application dataset; refusing to seed or overwrite it');
    return validateStore(normalize({users: users.map(strip), products: products.map(strip), customers: customers.map(strip), orders: orders.map(strip), invoices: invoices.map(strip), settings: strip(settings), audit: audit.map(strip), inventoryMovements: movements.map(strip)} as Store));
  }

  private async insertAll(store: Store) {
    await this.commit(emptyStore(), store, true);
  }

  /** Full-store save is no longer supported: it was the data-loss bug. */
  async save(_store: Store): Promise<never> {
    throw new PersistenceError('MongoRepository.save() is disabled; use commit(before, after) under the mutation lock');
  }

  async commit(before: Store, after: Store, allowSettingsInsert = false) {
    const ops = diffStores(before, after);
    if (!ops.length) return;
    const run = async (session?: mongoose.ClientSession) => {
      // Same transaction: finished-goods ledger rows + business activity events for what changed.
      await mirrorLegacyChanges(session, before.settings ? before : {...before, settings: after.settings}, after);
      for (const op of ops) {
        const model = op.collection === 'settings' ? Models.settings : Models[op.model!];
        if (op.kind === 'insert') await model.insertMany(op.docs, {session, ordered: true});
        else if (op.collection === 'settings') {
          if (allowSettingsInsert) await model.create([op.doc], {session});
          else { const res = await model.replaceOne({}, op.doc, {session}); if (res.matchedCount !== 1) throw new PersistenceError('Business settings document is missing'); }
        } else {
          const res = await model.replaceOne({id: op.id}, op.doc, {session});
          if (res.matchedCount !== 1) throw new PersistenceError(`Record ${op.collection}/${op.id} no longer exists; refusing to recreate it`);
        }
      }
    };
    if (!this.replicaSet) return run();
    const session = await mongoose.startSession();
    try { await session.withTransaction(() => run(session)); } finally { await session.endSession(); }
  }

  async acquireMutationLock() { return acquireGlobalLock(); }
  async close() { await mongoose.disconnect(); }
}

/** Cross-process mutation lock shared by legacy routes and the inventory module. */
export async function acquireGlobalLock(): Promise<() => Promise<void>> {
  {
    const owner = `${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    for (let attempt = 0; attempt < 600; attempt++) {
      const now = new Date(); const until = new Date(Date.now() + 120_000);
      try {
        const got = await Models.lock.findOneAndUpdate({_id: 'global', $or: [{lockedUntil: {$lte: now}}, {lockedUntil: {$exists: false}}]}, {$set: {owner, lockedUntil: until}}, {upsert: true, returnDocument: 'after'});
        if (got?.owner === owner) return async () => { await Models.lock.deleteOne({_id: 'global', owner}); };
      } catch (e: any) { if (e?.code !== 11000) throw e; }
      await new Promise(resolve => setTimeout(resolve, 25 + Math.random() * 50));
    }
    throw new Error('Timed out waiting for the MongoDB mutation lock');
  }
}

type Op =
  | {kind: 'insert'; collection: KeyedCollection; model: keyof typeof Models; docs: any[]}
  | {kind: 'replace'; collection: KeyedCollection; model: keyof typeof Models; id: string; doc: any}
  | {kind: 'replace'; collection: 'settings'; model?: undefined; id?: undefined; doc: any};

/** Compute the minimal set of writes. Deletions are treated as a programming error. */
export function diffStores(before: Store, after: Store): Op[] {
  const ops: Op[] = [];
  for (const [collection, model] of keyed) {
    const prev = new Map((before[collection] as any[]).map(d => [d.id, JSON.stringify(d)]));
    const nextIds = new Set<string>();
    const inserts: any[] = [];
    for (const doc of after[collection] as any[]) {
      if (!doc.id) throw new PersistenceError(`A ${collection} record has no id`);
      if (nextIds.has(doc.id)) throw new PersistenceError(`Duplicate ${collection} id ${doc.id}`);
      nextIds.add(doc.id);
      const old = prev.get(doc.id);
      if (old === undefined) inserts.push(doc);
      else if (old !== JSON.stringify(doc)) ops.push({kind: 'replace', collection, model, id: doc.id, doc});
    }
    for (const id of prev.keys()) if (!nextIds.has(id)) throw new PersistenceError(`Refusing to delete ${collection}/${id}`);
    if (inserts.length) ops.push({kind: 'insert', collection, model, docs: inserts});
  }
  if (JSON.stringify(before.settings) !== JSON.stringify(after.settings)) ops.push({kind: 'replace', collection: 'settings', doc: after.settings});
  return ops;
}

function emptyStore(): Store { return {users: [], products: [], customers: [], orders: [], invoices: [], settings: undefined as any, audit: [], inventoryMovements: []}; }
/**
 * Drop Mongo internals and normalise to plain JSON: Dates become ISO strings (the app's types use
 * strings) and nested ObjectIds (Mongoose adds `_id` to array subdocuments such as order lines)
 * become hex strings. Without this, a cloned snapshot never equals the original and every
 * order would be rewritten on each commit.
 */
function strip<T extends Record<string, any>>(doc: T): T { const {_id, __v, ...rest} = doc; return JSON.parse(JSON.stringify(rest)) as T; }
export function normalize(store: Store): Store { for (const product of store.products || []) product.reservedStock = product.reservedStock || 0; for (const order of store.orders || []) { order.stockReserved = order.stockReserved || false; order.updatedAt = order.updatedAt || order.createdAt; } store.inventoryMovements = store.inventoryMovements || []; return store; }
export function validateStore(store: Store): Store { if (!Array.isArray(store.products) || !Array.isArray(store.orders)) throw new Error('Datastore is missing required product or order collections'); for (const p of store.products) if (!Number.isFinite(p.stock) || p.stock < 0 || !Number.isFinite(p.reservedStock) || p.reservedStock < 0 || p.reservedStock > p.stock) throw new Error(`Invalid stock invariant for product ${p.id}`); for (const o of store.orders) { if (!o.id || !Array.isArray(o.items)) throw new Error(`Invalid order ${o.id || 'unknown'}`); for (const line of o.items) if (!Number.isFinite(line.qty) || line.qty <= 0) throw new Error(`Invalid quantity in order ${o.id}`); } return store; }
export function ensureDevelopmentUsers(store: Store): boolean { if (config.NODE_ENV === 'production') return false; let changed = false; const users = [{id: 'u-accounts-dev', name: 'Accounts Staff', email: 'accounts@example.com', password: bcrypt.hashSync('AccountsTest123!', 10), role: 'accounts' as const}, {id: 'u-salesman-dev', name: 'Sales Person', email: 'salesperson@example.com', password: bcrypt.hashSync('SalesTest123!', 10), role: 'salesman' as const}]; for (const candidate of users) if (!store.users.some(existing => existing.email === candidate.email)) { store.users.push(candidate); changed = true; } return changed; }
/** Development-only seed. Production never uses the demo owner or demo customers (see MongoRepository.load). */
export function makeSeed(): Store { return {users: [{id: 'u1', name: 'Owner', email: 'owner@example.com', password: bcrypt.hashSync('ChangeMe123!', 10), role: 'owner'}], products: pdfCatalogProducts(), customers: [], orders: [], invoices: [], settings: {businessName: 'Your Business', currency: 'INR', stockPolicy: 'approval', taxEnabled: false}, audit: [], inventoryMovements: []}; }
