/*
 Copy the dummy data into a NEW, separate database so a client can see it on a hosted link.

   1. Keep "npm run demo" running in another terminal (this reads from it).
   2. In PowerShell:
        $env:DEMO_TARGET_URI='<your Atlas connection string>'
        npm run demo:push

 Safety:
 - Always writes to the database named below (or DEMO_TARGET_DB), whatever database the connection string names.
   That name must contain "demo", so the live database can't be chosen by accident.
 - Refuses to write if the target database already has any data, so nothing is ever overwritten.
 - The connection string is read from the environment and never printed.
 - The public default passwords are not copied: every account gets one new random password, shown once at the end.
*/
import crypto from 'node:crypto';
import dns from 'node:dns';
import bcrypt from 'bcryptjs';
import {MongoClient} from 'mongodb';

const SOURCE_URI = 'mongodb://127.0.0.1:27028/?directConnection=true';
const SOURCE_DB = 'zenledger_demo';
const TARGET_DB = process.env.DEMO_TARGET_DB || 'zenledger_client_demo';
const BATCH = 500;

async function main() {
  const uri = process.env.DEMO_TARGET_URI;
  if (!uri) throw new Error('Set DEMO_TARGET_URI to your Atlas connection string first (see the top of this file).');
  if (!/demo/i.test(TARGET_DB)) throw new Error('The target database name must contain "demo".');
  if (TARGET_DB === SOURCE_DB) throw new Error('The target database must be different from the source.');
  if (uri.startsWith('mongodb+srv')) dns.setServers(['1.1.1.1', '8.8.8.8']);

  const source = new MongoClient(SOURCE_URI, {serverSelectionTimeoutMS: 5000});
  const target = new MongoClient(uri, {serverSelectionTimeoutMS: 20000});
  try {
    await source.connect().catch(() => { throw new Error('The demo database is not running. Start "npm run demo" in another terminal, then try again.'); });
    await target.connect().catch(e => { throw new Error(`Could not connect to the target. Check the password and that Atlas Network Access allows this computer. (${e?.codeName || e?.name || 'connection error'})`); });
    const from = source.db(SOURCE_DB), to = target.db(TARGET_DB);
    if (!await from.collection('demo_meta').findOne({})) throw new Error('The demo data is not fully built yet. Wait for "Demo API ready", then try again.');

    const existing = await to.listCollections().toArray();
    for (const c of existing) if (!c.name.startsWith('system.') && await to.collection(c.name).estimatedDocumentCount()) throw new Error(`Database "${TARGET_DB}" already has data, so nothing was changed. Set DEMO_TARGET_DB to a new name containing "demo".`);

    const names = (await from.listCollections().toArray()).map(c => c.name).filter(n => !n.startsWith('system.') && n !== 'demo_meta');
    let total = 0;
    for (const name of names) {
      const batch: any[] = [];
      const flush = async () => { if (batch.length) { await to.collection(name).insertMany(batch, {ordered: true}); batch.length = 0; } };
      for await (const doc of from.collection(name).find()) { batch.push(doc); if (batch.length >= BATCH) await flush(); }
      await flush();
      const [a, b] = await Promise.all([from.collection(name).countDocuments(), to.collection(name).countDocuments()]);
      if (a !== b) throw new Error(`Copy check failed for ${name}: ${a} source, ${b} target.`);
      total += b;
      if (b) console.log(`  ${name.padEnd(28)} ${String(b).padStart(6)}`);
    }

    const password = crypto.randomBytes(12).toString('base64url');
    await to.collection('users').updateMany({}, {$set: {password: bcrypt.hashSync(password, 10), mustChangePassword: false}});

    console.log(`\nCopied ${total} records into database "${TARGET_DB}", and every count matched.`);
    console.log('\nNew password for ALL demo accounts (shown only this once):');
    console.log(`  ${password}`);
    console.log('  Owner: owner@example.com   Accounts: accounts@example.com   Salesman: phone 9000010001');
    console.log(`\nNext: set MONGODB_URI on the demo Render service to your connection string with "/${TARGET_DB}" as the database name.`);
  } finally {
    await Promise.allSettled([source.close(), target.close()]);
  }
}

main().catch(e => { console.error('Push failed:', e instanceof Error ? e.message : 'unknown error'); process.exit(1); });
