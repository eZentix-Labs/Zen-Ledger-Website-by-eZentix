/*
 Read-only MongoDB backup + verification.

   npx tsx scripts/backup-mongo.ts --uri-env MONGODB_URI [--out <dir>]
   npx tsx scripts/backup-mongo.ts --verify <dir> --uri-env MONGODB_URI

 - Reads the connection string from the named environment variable (default MONGODB_URI,
   loaded from backend/.env). The URI is never printed.
 - Writes one EJSON file per collection plus manifest.json (counts + SHA-256).
 - Default output: ../../backups/<database>-<timestamp> (outside the git repository).
 - Restore (only when you decide to): mongorestore is not used; use
   scripts/backup-mongo.ts output with `mongoimport --jsonArray` or ask for a restore script.
*/
import dns from 'node:dns';
import path from 'node:path';
import dotenv from 'dotenv';
import {backup, verify} from '../src/backup.js';

dns.setServers(['1.1.1.1', '8.8.8.8']);
dotenv.config();
const args = process.argv.slice(2);
const arg = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const uri = process.env[arg('--uri-env') || 'MONGODB_URI'];
if (!uri) { console.error('Connection string environment variable is not set'); process.exit(1); }
const database = new URL(uri.replace(/^mongodb\+srv:/, 'http:').replace(/^mongodb:/, 'http:')).pathname.slice(1) || 'test';

const verifyDir = arg('--verify');
if (verifyDir) {
  const result = await verify(uri, path.resolve(verifyDir));
  console.log(result.ok ? 'VERIFIED: backup matches the live database' : `VERIFY FAILED:\n- ${result.problems.join('\n- ')}`);
  process.exit(result.ok ? 0 : 2);
}
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const out = path.resolve(arg('--out') || path.join('..', '..', 'backups', `${database}-${stamp}`));
const manifest = await backup(uri, database, out);
console.log(`Backed up database "${manifest.database}" on ${manifest.host} to ${out}`);
for (const c of manifest.collections) console.log(`  ${c.name.padEnd(28)} ${String(c.count).padStart(7)} docs`);
const result = await verify(uri, out);
console.log(result.ok ? 'VERIFIED: backup matches the live database' : `VERIFY FAILED:\n- ${result.problems.join('\n- ')}`);
process.exit(result.ok ? 0 : 2);
