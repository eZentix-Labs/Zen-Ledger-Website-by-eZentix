import {describe, expect, it} from 'vitest';
import {assertSafeMongoUri, isLocalMongoUri} from './mongo-safety.js';

describe('MongoDB URI safety', () => {
  it('accepts local IPv4 and localhost URIs', () => {
    expect(isLocalMongoUri('mongodb://127.0.0.1:27017/zenledger_test')).toBe(true);
    expect(isLocalMongoUri('mongodb://localhost:27017/zenledger_test')).toBe(true);
  });

  it('rejects a non-local URI by default', () => {
    expect(() => assertSafeMongoUri('mongodb+srv://cluster.example/zenledger')).toThrow(/non-local/);
  });

  it('allows a remote URI only with explicit opt-in', () => {
    expect(() => assertSafeMongoUri('mongodb+srv://cluster.example/zenledger', true)).not.toThrow();
  });

  it('does not treat a hostname suffix as loopback', () => {
    expect(isLocalMongoUri('mongodb://localhost.attacker.example/zenledger')).toBe(false);
  });
});
