import mongoose from 'mongoose';

const { Schema } = mongoose;

const categorySchema = new Schema({
  name: { type: String, required: true, trim: true },
  slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
  parentId: { type: String, default: null },
  imageUrl: String,
  active: { type: Boolean, default: true },
}, { timestamps: true });
categorySchema.index({ name: 'text', slug: 'text' });

const rawMaterialSchema = new Schema({
  name: { type: String, required: true, trim: true },
  code: { type: String, required: true, unique: true, uppercase: true, trim: true },
  category: { type: String, required: true, trim: true },
  description: String,
  unit: { type: String, required: true, enum: ['piece', 'kg', 'metre', 'sqft', 'sheet', 'litre', 'box', 'other'] },
  purchasePrice: { type: Number, min: 0, default: 0 },
  averageCost: { type: Number, min: 0, default: 0 },
  availableStock: { type: Number, min: 0, default: 0 },
  reservedStock: { type: Number, min: 0, default: 0 },
  minimumStock: { type: Number, min: 0, default: 0 },
  supplierId: String,
  active: { type: Boolean, default: true },
}, { timestamps: true });
rawMaterialSchema.index({ name: 'text', code: 'text', category: 'text' });

const bomSchema = new Schema({
  productId: { type: String, required: true, index: true },
  productName: { type: String, required: true },
  version: { type: Number, required: true, min: 1 },
  lines: [{
    materialId: { type: String, required: true },
    materialName: { type: String, required: true },
    quantity: { type: Number, required: true, min: 0 },
    unit: { type: String, required: true },
    wastagePercent: { type: Number, min: 0, max: 100, default: 0 },
    costBasis: { type: Number, min: 0, default: 0 },
    active: { type: Boolean, default: true },
  }],
  active: { type: Boolean, default: true },
  createdBy: String,
}, { timestamps: true });
bomSchema.index({ productId: 1, version: 1 }, { unique: true });

const stockLedgerSchema = new Schema({
  materialId: { type: String, required: true, index: true },
  materialName: String,
  quantity: { type: Number, required: true },
  unit: { type: String, required: true },
  movementType: { type: String, required: true, enum: ['opening', 'purchase', 'adjustment', 'consumption', 'return', 'damage', 'reservation', 'reservation_release'] },
  referenceId: String,
  idempotencyKey: { type: String, unique: true, sparse: true },
  userId: String,
  notes: String,
}, { timestamps: true });
stockLedgerSchema.index({ materialId: 1, createdAt: -1 });

const productionSchema = new Schema({
  productId: { type: String, required: true, index: true },
  productName: { type: String, required: true },
  bomId: { type: String, required: true },
  bomVersion: { type: Number, required: true },
  plannedQuantity: { type: Number, required: true, min: 1 },
  actualQuantity: { type: Number, min: 0, default: 0 },
  status: { type: String, enum: ['planned', 'materials_reserved', 'in_production', 'quality_check', 'completed', 'cancelled'], default: 'planned' },
  estimatedMaterialCost: { type: Number, min: 0, default: 0 },
  actualMaterialCost: { type: Number, min: 0, default: 0 },
  labourCost: { type: Number, min: 0, default: 0 },
  overheadCost: { type: Number, min: 0, default: 0 },
  consumedMaterials: [{ materialId: String, materialName: String, quantity: Number, unit: String, cost: Number }],
  createdBy: String,
  completedBy: String,
}, { timestamps: true });

const paymentSchema = new Schema({
  orderId: { type: String, required: true, index: true },
  customerId: String,
  salesmanId: String,
  amount: { type: Number, required: true, min: 0.01 },
  method: { type: String, enum: ['cash', 'bank_transfer', 'upi', 'card', 'cheque', 'other'], required: true },
  paymentDate: { type: Date, required: true },
  reference: String,
  notes: String,
  idempotencyKey: { type: String, required: true, unique: true },
  recordedBy: { type: String, required: true },
}, { timestamps: true });

const assignmentSchema = new Schema({
  salesmanId: { type: String, required: true, index: true },
  categoryIds: [String],
  productIds: [String],
  active: { type: Boolean, default: true },
  updatedBy: String,
}, { timestamps: true });
assignmentSchema.index({ salesmanId: 1 }, { unique: true });

const catalogueSourceSchema = new Schema({
  filename: { type: String, required: true, unique: true },
  pageCount: Number,
  extractionStatus: { type: String, enum: ['pending', 'image_only', 'text_extracted', 'reviewed'], default: 'pending' },
  notes: String,
  reviewedBy: String,
}, { timestamps: true });

export const ErpModels = {
  Category: mongoose.models.ErpCategory || mongoose.model('ErpCategory', categorySchema),
  RawMaterial: mongoose.models.ErpRawMaterial || mongoose.model('ErpRawMaterial', rawMaterialSchema),
  Bom: mongoose.models.ErpBom || mongoose.model('ErpBom', bomSchema),
  StockLedger: mongoose.models.ErpStockLedger || mongoose.model('ErpStockLedger', stockLedgerSchema),
  Production: mongoose.models.ErpProduction || mongoose.model('ErpProduction', productionSchema),
  Payment: mongoose.models.ErpPayment || mongoose.model('ErpPayment', paymentSchema),
  Assignment: mongoose.models.ErpAssignment || mongoose.model('ErpAssignment', assignmentSchema),
  CatalogueSource: mongoose.models.ErpCatalogueSource || mongoose.model('ErpCatalogueSource', catalogueSourceSchema),
};
