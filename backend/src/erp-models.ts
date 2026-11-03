import mongoose from 'mongoose';

// Raw materials, stock ledger, BOM and production were repaired and moved to
// ./inventory/models.ts (same model names and collections).
const { Schema } = mongoose;

const categorySchema = new Schema({
  name: { type: String, required: true, trim: true },
  slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
  parentId: { type: String, default: null },
  imageUrl: String,
  active: { type: Boolean, default: true },
  // 'product' (catalogue categories) or 'inventory' (stock-item categories)
  scope: { type: String, enum: ['product', 'inventory'], default: 'product', index: true },
  itemType: { type: String, default: null },
  code: { type: String, default: null },
  sortOrder: { type: Number, default: 0 },
}, { timestamps: true });
categorySchema.index({ name: 'text', slug: 'text' });

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
  status: { type: String, enum: ['VERIFIED', 'UNVERIFIED', 'REJECTED', 'VOID'], default: 'VERIFIED' },
  verifiedBy: String, verifiedAt: Date, voidReason: String,
}, { timestamps: true });

const assignmentSchema = new Schema({
  salesmanId: { type: String, required: true },  // unique index declared below
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
  Payment: mongoose.models.ErpPayment || mongoose.model('ErpPayment', paymentSchema),
  Assignment: mongoose.models.ErpAssignment || mongoose.model('ErpAssignment', assignmentSchema),
  CatalogueSource: mongoose.models.ErpCatalogueSource || mongoose.model('ErpCatalogueSource', catalogueSourceSchema),
};
