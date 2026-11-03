import type {Request, Response} from 'express';
import {ZodError, z} from 'zod';
import {UnitError} from './units.js';

export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) { super(message); }
}
export const fail = (status: number, message: string, details?: unknown): never => { throw new HttpError(status, message, details); };

/** Wrap an async route handler with consistent JSON error responses. */
export const route = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response) => {
  fn(req, res).catch((e: any) => {
    if (e instanceof HttpError) return res.status(e.status).json({error: e.message, ...(e.details ? {details: e.details} : {})});
    if (e instanceof UnitError) return res.status(400).json({error: e.message});
    if (e instanceof ZodError) return res.status(400).json({error: e.issues[0] ? `${e.issues[0].path.join('.') || 'input'}: ${e.issues[0].message}` : 'Invalid input', details: e.issues});
    if (e?.code === 11000) return res.status(409).json({error: `Duplicate value: ${Object.keys(e.keyPattern || e.keyValue || {}).join(', ') || 'record already exists'}`});
    if (e?.name === 'ValidationError' || e?.name === 'CastError') return res.status(400).json({error: e.message});
    console.error(e);
    res.status(500).json({error: 'Unexpected server error'});
  });
};

export const parse = <T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> => schema.parse(value);

export function paging(req: Request) {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  return {page, limit, skip: (page - 1) * limit};
}
export function sendPage(res: Response, items: unknown[], total: number, page: number, limit: number) {
  res.set({'X-Total-Count': String(total)}).json({items, total, page, limit});
}

/** Rupees (number, ≤2 dp) → integer paise. */
export const rupees = z.number().finite().min(0).max(1e10).transform(v => Math.round(v * 100));
export const optionalText = (max = 500) => z.string().trim().max(max).optional().or(z.literal('').transform(() => undefined));
export const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
