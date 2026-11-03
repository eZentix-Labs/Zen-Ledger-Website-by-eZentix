/*
 Local development MongoDB (single-node replica set, so transactions work), persisted in
 backend/data/mongo-dev (git-ignored). Never touches Atlas.

   npx tsx scripts/dev-db.ts                     # start (keeps running; Ctrl+C to stop)
   npx tsx scripts/dev-db.ts --restore <backup>  # first run only: load a backup made by backup-mongo.ts

 Then run the API against it, e.g. in PowerShell:
   $env:NODE_ENV='development'; $env:PERSISTENCE='mongo'; $env:MONGODB_URI='<printed uri>'; $env:JWT_SECRET='local-dev-secret-at-least-32-characters-long'; $env:PORT='10000'; npx tsx src/server.ts
*/
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {existsSync} from 'node:fs';
import {MongoMemoryReplSet} from 'mongodb-memory-server';
import {MongoClient} from 'mongodb';
import {EJSON} from 'bson';

const cached = path.join(os.homedir(), '.cache', 'mongodb-binaries', 'mongod-x64-win32-7.0.14.exe');
if (!process.env.MONGOMS_SYSTEM_BINARY && existsSync(cached)) process.env.MONGOMS_SYSTEM_BINARY = cached;
const dbPath = path.resolve('data', 'mongo-dev');
await fs.mkdir(dbPath, {recursive: true});
const replSet = await MongoMemoryReplSet.create({replSet: {count: 1, name: 'zl-dev', storageEngine: 'wiredTiger'}, instanceOpts: [{port: 27027, dbPath}]});
const uri = replSet.getUri('zenledger_dev');
const i = process.argv.indexOf('--restore');
if (i > 0) {
  const dir = path.resolve(process.argv[i + 1]);
  const client = new MongoClient(uri); await client.connect();
  const db = client.db('zenledger_dev');
  if ((await db.listCollections().toArray()).length) { console.error('zenledger_dev is not empty; refusing to restore over it'); process.exit(1); }
  const manifest = JSON.parse(await fs.readFile(path.join(dir, 'manifest.json'), 'utf8'));
  for (const c of manifest.collections) {
    const docs = EJSON.parse(await fs.readFile(path.join(dir, c.file), 'utf8'), {relaxed: false}) as any[];
    if (docs.length) await db.collection(c.name).insertMany(docs);
    console.log(`restored ${c.name}: ${docs.length}`);
  }
  await client.close();
}
console.log(`Local dev MongoDB ready: ${uri}`);
const stop = async () => { await replSet.stop({doCleanup: false, force: false}); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
setInterval(() => undefined, 1 << 30);
