import crypto from 'node:crypto';
import type {Request} from 'express';
import mongoose from 'mongoose';
import {acquireGlobalLock} from '../repository.js';
import {sessionUser} from '../auth.js';
import {Inv} from './models.js';
import {fail} from './http.js';

export type Actor = {id: string; name: string; role: string};
export type Ctx = {session: mongoose.ClientSession; actor: Actor};

export const actorOf = (req: Request): Actor => { const u = sessionUser(req); return {id: u.id, name: u.name, role: u.role}; };

const canonical = (v: unknown): string => JSON.stringify(v, (_k, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(k => [k, x[k]])) : x);

/**
 * Run a stock/money mutation exactly once:
 *  - requires an Idempotency-Key (header) — a retry with the same key and body returns the first result,
 *    the same key with a different body is rejected;
 *  - takes the cross-process mutation lock shared with the legacy order code (so legacy writes to
 *    `products` can never overwrite inventory writes, or vice versa);
 *  - runs everything in one MongoDB transaction together with the idempotency record.
 */
export async function mutate<T extends Record<string, unknown>>(req: Request, kind: string, fn: (ctx: Ctx) => Promise<T>): Promise<T & {replayed?: boolean}> {
  const key = String(req.header('Idempotency-Key') || '').trim();
  if (!/^[A-Za-z0-9:_.-]{8,128}$/.test(key)) fail(400, 'A valid Idempotency-Key header is required');
  const actor = actorOf(req);
  const hash = crypto.createHash('sha256').update(canonical({kind, path: req.originalUrl.split('?')[0], user: actor.id, body: req.body ?? null})).digest('hex');
  const replay = async (session?: mongoose.ClientSession) => {
    const op: any = await Inv.Operation.findOne({requestKey: key}).session(session ?? null).lean();
    if (!op) return null;
    if (op.payloadHash !== hash) fail(409, 'This request key was already used for different data');
    return {...op.result, replayed: true};
  };
  const early = await replay(); if (early) return early;
  const release = await acquireGlobalLock();
  const session = await mongoose.startSession();
  try {
    let result: any;
    await session.withTransaction(async () => {
      const again = await replay(session); if (again) { result = again; return; }
      result = await fn({session, actor});
      await Inv.Operation.create([{requestKey: key, payloadHash: hash, kind, result, actorId: actor.id}], {session});
    });
    return result;
  } finally { await session.endSession(); await release(); }
}

const tz = process.env.BUSINESS_TIMEZONE || 'Asia/Kolkata';
/** Indian financial year label (April–March), e.g. 2026-27. */
export function fyLabel(d = new Date()) {
  const [y, m] = new Intl.DateTimeFormat('en-CA', {timeZone: tz, year: 'numeric', month: '2-digit'}).format(d).split('-').map(Number);
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}
/** Gap-free document numbers per type and financial year (allocated inside the transaction). */
export async function nextNumber(prefix: string, session: mongoose.ClientSession, perYear = true): Promise<string> {
  const id = perYear ? `${prefix}:${fyLabel()}` : prefix;
  const c: any = await Inv.Counter.findOneAndUpdate({_id: id}, {$inc: {seq: 1}}, {upsert: true, returnDocument: 'after', session});
  return perYear ? `${prefix}/${fyLabel()}/${String(c.seq).padStart(4, '0')}` : `${prefix}-${String(c.seq).padStart(6, '0')}`;
}
