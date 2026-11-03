import type { Express, Request, Response } from 'express';
import { z } from 'zod';
import { ErpModels } from './erp-models.js';
import { requireAuth, requirePerm, sessionUser } from './auth.js';

// Catalogue categories, customer payments (legacy stub), salesman catalogue assignment.
// The raw-material / ledger / BOM / production endpoints that used to live here were broken
// (enum mismatch, no stock movement, unvalidated $set) and are replaced by /api/inventory/*.

const slug = (value: string) => value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response) => { fn(req, res).catch((e) => { console.error(e); res.status(500).json({ error: 'Unexpected server error' }); }); };

export function registerErpRoutes(app: Express) {
  app.get('/api/erp/catalogue-sources', requireAuth, requirePerm('catalogue.view'), wrap(async (_req, res) => {
    res.json(await ErpModels.CatalogueSource.find().sort({ filename: 1 }).lean());
  }));

  app.get('/api/erp/categories', requireAuth, requirePerm('catalogue.view'), wrap(async (_req, res) => {
    res.json(await ErpModels.Category.find({ active: true, scope: { $ne: 'inventory' } }).sort({ name: 1 }).lean());
  }));
  const categoryBody = z.object({ name: z.string().trim().min(2).max(80), parentId: z.string().nullable().optional(), imageUrl: z.string().url().optional(), active: z.boolean().optional() });
  app.post('/api/erp/categories', requireAuth, requirePerm('item.manage'), wrap(async (req, res) => {
    const parsed = categoryBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid category' });
    if (await ErpModels.Category.exists({ slug: slug(parsed.data.name) })) return res.status(409).json({ error: 'Category already exists' });
    res.status(201).json(await ErpModels.Category.create({ ...parsed.data, slug: slug(parsed.data.name), scope: 'product' }));
  }));
  app.patch('/api/erp/categories/:id', requireAuth, requirePerm('item.manage'), wrap(async (req, res) => {
    const parsed = categoryBody.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid category' });
    const category = await ErpModels.Category.findByIdAndUpdate(req.params.id, { $set: parsed.data }, { returnDocument: 'after', runValidators: true });
    if (!category) return res.status(404).json({ error: 'Category not found' });
    res.json(category);
  }));

  app.get('/api/erp/salesmen/:salesmanId/assignment', requireAuth, requirePerm('catalogue.view'), wrap(async (req, res) => {
    const user = sessionUser(req);
    if (user.role === 'salesman' && user.id !== req.params.salesmanId) return res.status(403).json({ error: 'Forbidden' });
    res.json(await ErpModels.Assignment.findOne({ salesmanId: req.params.salesmanId }).lean() ?? { salesmanId: req.params.salesmanId, categoryIds: [], productIds: [], active: true });
  }));
  app.put('/api/erp/salesmen/:salesmanId/assignment', requireAuth, requirePerm('salesman.manage'), wrap(async (req, res) => {
    const parsed = z.object({ categoryIds: z.array(z.string()), productIds: z.array(z.string()), active: z.boolean().optional() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid assignment' });
    const assignment = await ErpModels.Assignment.findOneAndUpdate({ salesmanId: req.params.salesmanId }, { $set: { ...parsed.data, updatedBy: sessionUser(req).id } }, { upsert: true, returnDocument: 'after', runValidators: true });
    res.json(assignment);
  }));
}
