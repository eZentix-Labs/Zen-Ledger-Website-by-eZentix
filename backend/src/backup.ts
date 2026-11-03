// Read-only MongoDB backup and verification. Never writes to the database.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {MongoClient} from 'mongodb';
import {EJSON} from 'bson';

export type Manifest = {
  createdAt: string; database: string; host: string;
  collections: {name: string; count: number; file: string; sha256: string}[];
};

const hostOf = (uri: string) => uri.replace(/^mongodb(\+srv)?:\/\/([^@]*@)?/, '').split(/[/?]/)[0];

/** Export every collection of `database` into `outDir` as canonical EJSON, plus a manifest. */
export async function backup(uri: string, database: string, outDir: string): Promise<Manifest> {
  const client = new MongoClient(uri, {readPreference: 'secondaryPreferred'});
  await client.connect();
  try {
    const db = client.db(database);
    await fs.mkdir(outDir, {recursive: true});
    const manifest: Manifest = {createdAt: new Date().toISOString(), database, host: hostOf(uri), collections: []};
    const names = (await db.listCollections({}, {nameOnly: true}).toArray()).map(c => c.name).filter(n => !n.startsWith('system.')).sort();
    for (const name of names) {
      const docs = await db.collection(name).find({}).sort({_id: 1}).toArray();
      const text = EJSON.stringify(docs, undefined, 0, {relaxed: false});
      const file = `${name}.ejson`;
      await fs.writeFile(path.join(outDir, file), text, 'utf8');
      manifest.collections.push({name, count: docs.length, file, sha256: crypto.createHash('sha256').update(text).digest('hex')});
    }
    await fs.writeFile(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
    return manifest;
  } finally { await client.close(); }
}

/** Verify a backup: file checksums intact, files parse, counts and _id sets match the live database. */
export async function verify(uri: string, outDir: string): Promise<{ok: boolean; problems: string[]}> {
  const manifest: Manifest = JSON.parse(await fs.readFile(path.join(outDir, 'manifest.json'), 'utf8'));
  const client = new MongoClient(uri, {readPreference: 'secondaryPreferred'});
  await client.connect();
  const problems: string[] = [];
  try {
    const db = client.db(manifest.database);
    for (const c of manifest.collections) {
      const text = await fs.readFile(path.join(outDir, c.file), 'utf8');
      if (crypto.createHash('sha256').update(text).digest('hex') !== c.sha256) { problems.push(`${c.name}: checksum mismatch`); continue; }
      const docs = EJSON.parse(text, {relaxed: false}) as Array<{_id: unknown}>;
      if (docs.length !== c.count) problems.push(`${c.name}: file has ${docs.length} documents, manifest says ${c.count}`);
      const live = await db.collection(c.name).find({}, {projection: {_id: 1}}).toArray();
      const liveIds = new Set(live.map(d => EJSON.stringify(d._id)));
      const missing = docs.filter(d => !liveIds.has(EJSON.stringify(d._id))).length;
      if (live.length !== docs.length) problems.push(`${c.name}: live database has ${live.length} documents, backup has ${docs.length} (changed since backup?)`);
      if (missing) problems.push(`${c.name}: ${missing} backed-up documents are not in the live database`);
    }
    return {ok: problems.length === 0, problems};
  } finally { await client.close(); }
}
