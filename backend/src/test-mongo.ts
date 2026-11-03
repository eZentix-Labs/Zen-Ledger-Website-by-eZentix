// Test helper: a throwaway single-node MongoDB replica set (transactions enabled).
// Uses the locally cached mongod binary; never touches any real database.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import {MongoMemoryReplSet} from 'mongodb-memory-server';

const cached = path.join(os.homedir(), '.cache', 'mongodb-binaries', 'mongod-x64-win32-7.0.14.exe');
if (!process.env.MONGOMS_SYSTEM_BINARY && fs.existsSync(cached)) process.env.MONGOMS_SYSTEM_BINARY = cached;

export async function startReplSet() {
  const replSet = await MongoMemoryReplSet.create({replSet: {count: 1, storageEngine: 'wiredTiger'}});
  const uri = replSet.getUri('zenledger_test');
  if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)/.test(uri)) throw new Error('Refusing non-local test database');
  return {replSet, uri};
}
