// Shared authentication + permission middleware for the Mongo-backed modules
// (ERP, inventory, salesman management). Legacy routes in server.ts keep their own
// equivalent check against the in-memory store.
import type {NextFunction, Request, Response} from 'express';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import {z} from 'zod';
import {config} from './config.js';
import {Models} from './models.js';

export type Role = 'owner' | 'accounts' | 'salesman';
export type SessionUser = {id: string; name: string; email?: string; role: Role};

const claims = z.object({id: z.string(), name: z.string(), email: z.string().email().optional(), phone: z.string().optional(), role: z.enum(['owner', 'accounts', 'salesman']), tv: z.number().int().optional(), exp: z.number().int().positive()});

export const sessionUser = (req: Request) => (req as any).user as SessionUser;

/** Verify the JWT, its claim shape, and (when Mongo is connected) that the account is still active. */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.header('authorization');
  if (!header?.startsWith('Bearer ')) return res.status(401).json({error: 'Authentication required'});
  let parsed;
  try { parsed = claims.safeParse(jwt.verify(header.slice(7), config.JWT_SECRET)); } catch { return res.status(401).json({error: 'Invalid session'}); }
  if (!parsed.success) return res.status(401).json({error: 'Invalid session'});
  if (mongoose.connection.readyState === 1) {
    const u: any = await Models.users.findOne({id: parsed.data.id}).select('active tokenVersion role').lean();
    if (!u || u.active === false || u.role !== parsed.data.role || (u.tokenVersion || 0) !== (parsed.data.tv || 0)) return res.status(401).json({error: 'Session is no longer valid. Please sign in again.'});
  }
  (req as any).user = {id: parsed.data.id, name: parsed.data.name, email: parsed.data.email, role: parsed.data.role};
  next();
}

// ---------- Permissions ----------
// Admin (owner) has everything. Accountant has the defaults below plus anything the Admin
// grants from the delegable list. Salesmen only see the catalogue and their own records.
export const ACCOUNTANT_DEFAULTS = [
  'inventory.view', 'inventory.valuation', 'ledger.view', 'reports.view',
  'supplier.manage', 'supplierPayment.record',
  'purchase.create', 'purchase.receive', 'bill.manage', 'purchase.return',
  'wastage.report', 'adjustment.request', 'count.manage', 'production.view',
  'salesman.view', 'salesman.manage', 'target.view', 'payment.record', 'payment.verify', 'sales.return',
] as const;
export const DELEGABLE = [
  'item.manage', 'purchase.approve', 'bom.manage', 'production.manage', 'production.approve',
  'wastage.approve', 'adjustment.approve', 'count.approve', 'salesman.deactivate', 'salesman.resetPassword', 'target.manage', 'payment.void',
] as const;
export const ADMIN_ONLY = ['inventory.settings', 'ledger.reverse', 'permissions.manage'] as const;
export type Permission = typeof ACCOUNTANT_DEFAULTS[number] | typeof DELEGABLE[number] | typeof ADMIN_ONLY[number] | 'catalogue.view' | 'sales.self';

let grantsCache: {at: number; grants: string[]} = {at: 0, grants: []};
export function setGrantsCache(grants: string[]) { grantsCache = {at: Date.now(), grants}; }
async function accountantGrants(): Promise<string[]> {
  if (Date.now() - grantsCache.at < 10_000) return grantsCache.grants;
  const doc: any = mongoose.connection.readyState === 1 ? await mongoose.connection.db!.collection('invsettings').findOne({_id: 'default' as any}) : null;
  setGrantsCache((doc?.accountantGrants || []).filter((g: string) => (DELEGABLE as readonly string[]).includes(g)));
  return grantsCache.grants;
}

export async function permissionsFor(role: Role): Promise<string[]> {
  if (role === 'owner') return [...ACCOUNTANT_DEFAULTS, ...DELEGABLE, ...ADMIN_ONLY, 'catalogue.view'];
  if (role === 'accounts') return [...ACCOUNTANT_DEFAULTS, ...(await accountantGrants()), 'catalogue.view'];
  return ['catalogue.view', 'sales.self'];
}

export function requirePerm(...perms: Permission[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const user = sessionUser(req);
    if (!user) return res.status(401).json({error: 'Authentication required'});
    const have = await permissionsFor(user.role);
    if (!perms.every(p => have.includes(p))) return res.status(403).json({error: 'You do not have permission for this action'});
    next();
  };
}
