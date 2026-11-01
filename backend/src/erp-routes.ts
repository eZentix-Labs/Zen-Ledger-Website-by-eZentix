import type { Express, NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { config } from './config.js';
import { ErpModels } from './erp-models.js';

type UserContext = { id?: string; role?: string; email?: string };

const idSchema = z.string().trim().min(1);
const roleIs = (roles: string[]) => (req: Request, res: Response, next: NextFunction) => {
  const user = (req as Request & { user?: UserContext }).user;
  if (!user?.role || !roles.includes(user.role)) return res.status(403).json({ error: 'Forbidden' });
  next();
};

function auth(req: Request, res: Response, next: NextFunction) {
  const raw = req.header('authorization');
  if (!raw?.startsWith('Bearer ')) return res.status(401).json({ error: 'Authentication required' });
  try {
    (req as Request & { user?: UserContext }).user = jwt.verify(raw.slice(7), config.JWT_SECRET) as UserContext;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid session' });
  }
}

const admin = roleIs(['owner', 'accounts', 'admin']);
const salesmanOrAdmin = roleIs(['owner', 'accounts', 'admin', 'salesman']);
const slug = (value: string) => value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function registerErpRoutes(app: Express) {
  const allowedOrigins = new Set([
    config.APP_ORIGIN,
    'http://localhost:5173',
    'http://127.0.0.1:5173',
  ]);
  app.use('/api/erp', (req, res, next) => {
    const origin = req.headers.origin;
    if (origin && allowedOrigins.has(origin)) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Vary', 'Origin');
    }
    res.header('Access-Control-Allow-Headers', 'Authorization, Content-Type, Idempotency-Key');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  app.get('/api/erp/catalogue-sources', auth, salesmanOrAdmin, async (_req, res) => {
    res.json(await ErpModels.CatalogueSource.find().sort({ filename: 1 }).lean());
  });

  app.get('/api/erp/categories', auth, salesmanOrAdmin, async (_req, res) => {
    res.json(await ErpModels.Category.find({ active: true }).sort({ name: 1 }).lean());
  });
  app.post('/api/erp/categories', auth, admin, async (req, res) => {
    const parsed = z.object({ name: z.string().min(2), parentId: z.string().nullable().optional(), imageUrl: z.string().url().optional() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid category' });
    const category = await ErpModels.Category.create({ ...parsed.data, slug: slug(parsed.data.name) });
    res.status(201).json(category);
  });
  app.patch('/api/erp/categories/:id', auth, admin, async (req, res) => {
    const category = await ErpModels.Category.findByIdAndUpdate(req.params.id, { $set: req.body }, { new: true, runValidators: true });
    if (!category) return res.status(404).json({ error: 'Category not found' });
    res.json(category);
  });

  app.get('/api/erp/materials', auth, admin, async (_req, res) => {
    res.json(await ErpModels.RawMaterial.find().sort({ name: 1 }).lean());
  });
  app.post('/api/erp/materials', auth, admin, async (req, res) => {
    const parsed = z.object({ name: z.string().min(2), code: z.string().min(1), category: z.string().min(1), description: z.string().optional(), unit: z.enum(['piece', 'kg', 'metre', 'sqft', 'sheet', 'litre', 'box', 'other']), purchasePrice: z.number().nonnegative().optional(), minimumStock: z.number().nonnegative().optional() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid material', details: parsed.error.flatten() });
    const material = await ErpModels.RawMaterial.create(parsed.data);
    res.status(201).json(material);
  });
  app.patch('/api/erp/materials/:id', auth, admin, async (req, res) => {
    const material = await ErpModels.RawMaterial.findByIdAndUpdate(req.params.id, { $set: req.body }, { new: true, runValidators: true });
    if (!material) return res.status(404).json({ error: 'Material not found' });
    res.json(material);
  });
  app.get('/api/erp/materials/:id/ledger', auth, admin, async (req, res) => {
    res.json(await ErpModels.StockLedger.find({ materialId: req.params.id }).sort({ createdAt: -1 }).limit(200).lean());
  });
  app.post('/api/erp/materials/:id/ledger', auth, admin, async (req, res) => {
    const parsed = z.object({
      quantity: z.number().positive(),
      movementType: z.enum(['opening', 'purchase', 'adjustment_in', 'adjustment_out', 'consumption', 'return', 'damage']),
      unit: z.string().min(1),
      referenceType: z.string().optional(),
      referenceId: z.string().optional(),
      notes: z.string().optional(),
      idempotencyKey: z.string().min(8),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid stock movement', details: parsed.error.flatten() });
    const material = await ErpModels.RawMaterial.findById(req.params.id).lean();
    if (!material) return res.status(404).json({ error: 'Material not found' });
    const existing = await ErpModels.StockLedger.findOne({ idempotencyKey: parsed.data.idempotencyKey });
    if (existing) return res.status(200).json(existing);
    const signedQuantity = ['adjustment_out', 'consumption', 'damage'].includes(parsed.data.movementType) ? -parsed.data.quantity : parsed.data.quantity;
    const movement = await ErpModels.StockLedger.create({
      materialId: material._id.toString(),
      materialName: material.name,
      ...parsed.data,
      quantity: signedQuantity,
      createdBy: (req as Request & { user?: UserContext }).user?.id,
    });
    res.status(201).json(movement);
  });

  app.get('/api/erp/boms', auth, salesmanOrAdmin, async (req, res) => {
    const filter = typeof req.query.productId === 'string' ? { productId: req.query.productId } : {};
    res.json(await ErpModels.Bom.find(filter).sort({ productId: 1, version: -1 }).lean());
  });
  app.post('/api/erp/boms', auth, admin, async (req, res) => {
    const parsed = z.object({ productId: idSchema, productName: z.string().min(1), lines: z.array(z.object({ materialId: idSchema, materialName: z.string().min(1), quantity: z.number().positive(), unit: z.string().min(1), wastagePercent: z.number().min(0).max(100).optional(), costBasis: z.number().nonnegative().optional() })).min(1) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid BOM', details: parsed.error.flatten() });
    const latest = await ErpModels.Bom.findOne({ productId: parsed.data.productId }).sort({ version: -1 }).lean();
    const bom = await ErpModels.Bom.create({ ...parsed.data, version: (latest?.version ?? 0) + 1, createdBy: (req as Request & { user?: UserContext }).user?.id });
    res.status(201).json(bom);
  });

  app.get('/api/erp/productions', auth, admin, async (_req, res) => {
    res.json(await ErpModels.Production.find().sort({ createdAt: -1 }).limit(200).lean());
  });
  app.post('/api/erp/productions', auth, admin, async (req, res) => {
    const parsed = z.object({ productId: idSchema, productName: z.string().min(1), bomId: idSchema, bomVersion: z.number().int().positive(), plannedQuantity: z.number().int().positive(), labourCost: z.number().nonnegative().optional(), overheadCost: z.number().nonnegative().optional() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid production plan', details: parsed.error.flatten() });
    const bom = await ErpModels.Bom.findOne({ _id: parsed.data.bomId, productId: parsed.data.productId, version: parsed.data.bomVersion, active: true }).lean();
    if (!bom) return res.status(400).json({ error: 'Active BOM version not found' });
    const estimatedMaterialCost = bom.lines.reduce((sum: number, line: { quantity: number; wastagePercent?: number; costBasis: number }) => sum + line.quantity * parsed.data.plannedQuantity * (1 + (line.wastagePercent ?? 0) / 100) * line.costBasis, 0);
    const production = await ErpModels.Production.create({ ...parsed.data, estimatedMaterialCost, createdBy: (req as Request & { user?: UserContext }).user?.id });
    res.status(201).json(production);
  });
  app.patch('/api/erp/productions/:id/status', auth, admin, async (req, res) => {
    const parsed = z.object({ status: z.enum(['planned', 'materials_reserved', 'in_production', 'quality_check', 'completed', 'cancelled']), actualQuantity: z.number().int().nonnegative().optional(), actualMaterialCost: z.number().nonnegative().optional() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid production status' });
    const production = await ErpModels.Production.findByIdAndUpdate(req.params.id, { $set: { ...parsed.data, ...(parsed.data.status === 'completed' ? { completedBy: (req as Request & { user?: UserContext }).user?.id } : {}) } }, { new: true, runValidators: true });
    if (!production) return res.status(404).json({ error: 'Production record not found' });
    res.json(production);
  });

  app.get('/api/erp/payments', auth, admin, async (req, res) => {
    const filter = typeof req.query.orderId === 'string' ? { orderId: req.query.orderId } : {};
    res.json(await ErpModels.Payment.find(filter).sort({ paymentDate: -1 }).lean());
  });
  app.post('/api/erp/payments', auth, admin, async (req, res) => {
    const parsed = z.object({ orderId: idSchema, customerId: z.string().optional(), salesmanId: z.string().optional(), amount: z.number().positive(), method: z.enum(['cash', 'bank_transfer', 'upi', 'card', 'cheque', 'other']), paymentDate: z.coerce.date(), reference: z.string().optional(), notes: z.string().optional(), idempotencyKey: z.string().min(8) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid payment', details: parsed.error.flatten() });
    const existing = await ErpModels.Payment.findOne({ idempotencyKey: parsed.data.idempotencyKey });
    if (existing) return res.status(200).json(existing);
    const payment = await ErpModels.Payment.create({ ...parsed.data, recordedBy: (req as Request & { user?: UserContext }).user?.id ?? 'unknown' });
    res.status(201).json(payment);
  });

  app.get('/api/erp/salesmen/:salesmanId/assignment', auth, salesmanOrAdmin, async (req, res) => {
    const user = (req as Request & { user?: UserContext }).user;
    if (user?.role === 'salesman' && user.id !== req.params.salesmanId) return res.status(403).json({ error: 'Forbidden' });
    res.json(await ErpModels.Assignment.findOne({ salesmanId: req.params.salesmanId }).lean() ?? { salesmanId: req.params.salesmanId, categoryIds: [], productIds: [], active: true });
  });
  app.put('/api/erp/salesmen/:salesmanId/assignment', auth, admin, async (req, res) => {
    const parsed = z.object({ categoryIds: z.array(z.string()), productIds: z.array(z.string()), active: z.boolean().optional() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid assignment' });
    const assignment = await ErpModels.Assignment.findOneAndUpdate({ salesmanId: req.params.salesmanId }, { $set: { ...parsed.data, updatedBy: (req as Request & { user?: UserContext }).user?.id } }, { upsert: true, new: true, runValidators: true });
    res.json(assignment);
  });
}
