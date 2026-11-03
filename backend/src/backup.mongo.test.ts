import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {MongoClient} from 'mongodb';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {startReplSet} from './test-mongo.js';
import {backup, verify} from './backup.js';

let replSet: Awaited<ReturnType<typeof startReplSet>>['replSet'];
let uri = '';
let dir = '';

beforeAll(async () => {
  ({replSet, uri} = await startReplSet());
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zl-backup-'));
  const client = new MongoClient(uri); await client.connect();
  await client.db('zenledger_test').collection('products').insertMany([{id: 'p1', stock: 3}, {id: 'p2', stock: 0}]);
  await client.db('zenledger_test').collection('orders').insertOne({id: 'o1', createdAt: new Date()});
  await client.close();
});
afterAll(async () => { await replSet?.stop(); await fs.rm(dir, {recursive: true, force: true}); });

describe('read-only backup', () => {
  it('exports every collection and verifies against the live database', async () => {
    const manifest = await backup(uri, 'zenledger_test', dir);
    expect(manifest.collections.map(c => [c.name, c.count])).toEqual([['orders', 1], ['products', 2]]);
    expect(await verify(uri, dir)).toEqual({ok: true, problems: []});
  });
  it('detects a tampered backup file', async () => {
    await fs.appendFile(path.join(dir, 'products.ejson'), ' ');
    const result = await verify(uri, dir);
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toMatch(/checksum/);
  });
});
