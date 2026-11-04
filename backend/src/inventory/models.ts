// Inventory & manufacturing collections.
// The four broken/unused ERP schemas (ErpRawMaterial, ErpStockLedger, ErpBom, ErpProduction)
// are REPAIRED here under the same model names and collections. They were empty in the
// backed-up database (2026-11-03), so no data migration is needed.
import mongoose from 'mongoose';
import {UNIT_CODES} from './units.js';

const {Schema} = mongoose;
const opts = {timestamps: true, versionKey: false as const};
const actor = new Schema({id: String, name: String, role: String}, {_id: false});
const file = new Schema({id: String, url: String, publicId: String, name: String, mime: String, size: Number, view: String}, {_id: false});

export const ITEM_TYPES = ['RAW_MATERIAL', 'COMPONENT', 'CONSUMABLE', 'PACKAGING', 'SPARE_PART', 'SEMI_FINISHED', 'OTHER'] as const;
export const LEDGER_TYPES = ['OPENING', 'PURCHASE_RECEIPT', 'PURCHASE_RETURN', 'RESERVATION', 'RESERVATION_RELEASE', 'MATERIAL_ISSUE', 'MATERIAL_RETURN', 'PRODUCTION_OUTPUT', 'PRODUCTION_COST_ADJUSTMENT', 'PRODUCTION_VARIANCE', 'SALES_DISPATCH', 'SALES_RETURN', 'WASTAGE', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'COUNT_ADJUSTMENT', 'REVERSAL'] as const;

// ---------- Item master (repaired ErpRawMaterial) ----------
const itemSchema = new Schema({
  name: {type: String, required: true, trim: true},
  code: {type: String, required: true, unique: true, uppercase: true, trim: true},
  sku: {type: String, trim: true},
  barcode: {type: String, trim: true},
  itemType: {type: String, enum: ITEM_TYPES, required: true, index: true},
  categoryId: {type: String, index: true},
  description: String,
  grade: String, thicknessMm: Number, lengthMm: Number, widthMm: Number, diameterMm: Number, weightKg: Number,
  specs: [{key: String, value: String, _id: false}],
  stockUnit: {type: String, enum: UNIT_CODES, required: true},
  purchaseUnits: [{unit: {type: String, enum: UNIT_CODES}, factor: Number, _id: false}],
  onHandM: {type: Number, default: 0, min: 0},
  reservedM: {type: Number, default: 0, min: 0},
  minStockM: {type: Number, default: null}, maxStockM: {type: Number, default: null},
  reorderLevelM: {type: Number, default: null}, reorderQtyM: {type: Number, default: null},
  leadTimeDays: {type: Number, default: null},
  lastPurchaseRatePaise: {type: Number, default: null},     // per stock unit
  avgCostPaise: {type: Number, default: null},              // per stock unit; null = unknown
  preferredSupplierId: {type: String, default: null},
  location: {type: String, default: ''},
  images: [file],
  status: {type: String, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE', index: true},
  revision: {type: Number, default: 0},
}, opts);
itemSchema.index({sku: 1}, {unique: true, partialFilterExpression: {sku: {$type: 'string', $gt: ''}}});
itemSchema.index({barcode: 1}, {unique: true, partialFilterExpression: {barcode: {$type: 'string', $gt: ''}}});
itemSchema.index({name: 'text', code: 'text', sku: 'text'});

// ---------- Unified stock ledger (repaired ErpStockLedger) ----------
const ledgerSchema = new Schema({
  txnNo: {type: String, required: true, unique: true},
  itemKind: {type: String, enum: ['ITEM', 'PRODUCT'], required: true},
  itemId: {type: String, required: true, index: true},
  itemCode: String, itemName: String, itemType: String, categoryId: String, unit: String,
  type: {type: String, enum: LEDGER_TYPES, required: true, index: true},
  qtyInM: {type: Number, default: 0}, qtyOutM: {type: Number, default: 0},
  prevM: Number, newM: Number, prevReservedM: Number, newReservedM: Number,
  unitCostPaise: {type: Number, default: null}, valuePaise: {type: Number, default: null},
  avgBeforePaise: {type: Number, default: null}, avgAfterPaise: {type: Number, default: null},
  refType: {type: String, required: true}, refId: {type: String, required: true}, refNumber: String, refLine: Number,
  location: String, reason: String, notes: String,
  performedBy: actor, approvedBy: {type: actor, default: null}, approvedAt: Date,
  idempotencyKey: {type: String, required: true, unique: true},
  reversalOf: {type: String, default: null}, reversedBy: {type: String, default: null},
}, opts);
ledgerSchema.index({reversalOf: 1}, {unique: true, partialFilterExpression: {reversalOf: {$type: 'string'}}});
ledgerSchema.index({itemId: 1, createdAt: -1});
ledgerSchema.index({refType: 1, refId: 1});
ledgerSchema.index({createdAt: -1});

// ---------- Finished-product profile (companion to legacy `products`) ----------
const productProfileSchema = new Schema({
  productId: {type: String, required: true, unique: true},
  productCode: String, model: String, design: String, doorCount: Number, drawerCount: Number,
  heightIn: Number, widthIn: Number, depthIn: Number, thicknessMm: Number,
  material: String, colour: String, finish: String, lockType: String, handleType: String, weightKg: Number,
  features: [String], description: String, specs: [{key: String, value: String, _id: false}],
  hsnCode: String, gstRateBps: Number,
  brand: String, barcode: String, internalShelves: Number, doorDesign: String,
  wholesalePricePaise: {type: Number, default: null}, retailPricePaise: {type: Number, default: null}, discountBps: {type: Number, default: null},
  warehouseLocation: String,
  // Variants are separate sellable products (own SKU, own stock) grouped under the first model's id.
  variantGroupId: {type: String, default: null, index: true}, variantLabel: String,
  avgCostPaise: {type: Number, default: null},   // manufacturing cost (weighted average of production output)
  minStock: {type: Number, default: null}, maxStock: {type: Number, default: null},
  images: [file],
  sourceRef: {file: String, page: Number},
  revision: {type: Number, default: 0},
}, opts);

// ---------- Suppliers ----------
const supplierSchema = new Schema({
  supplierCode: {type: String, required: true, unique: true, uppercase: true, trim: true},
  name: {type: String, required: true, trim: true},
  category: {type: String, default: 'GENERAL'},
  contactPerson: String, phone: String, email: String, address: String, state: String, stateCode: String,
  gstin: {type: String, uppercase: true, trim: true},
  paymentTermsDays: {type: Number, default: 0},
  openingBalancePaise: {type: Number, default: 0},
  bankName: String, bankAccount: String, ifsc: String, notes: String,
  status: {type: String, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE'},
  revision: {type: Number, default: 0},
}, opts);
supplierSchema.index({gstin: 1}, {unique: true, partialFilterExpression: {gstin: {$type: 'string', $gt: ''}}});
supplierSchema.index({name: 'text', supplierCode: 'text'});

const supplierLedgerSchema = new Schema({
  supplierId: {type: String, required: true, index: true},
  date: {type: Date, required: true},
  type: {type: String, enum: ['OPENING', 'BILL', 'RETURN', 'PAYMENT', 'PAYMENT_VOID'], required: true},
  amountPaise: {type: Number, required: true},  // + increases what we owe, − decreases it
  refType: String, refId: String, refNumber: String, notes: String,
  key: {type: String, required: true, unique: true},
  createdBy: actor,
}, opts);

// ---------- Purchasing ----------
const poLine = new Schema({
  lineNo: Number, itemId: String, itemCode: String, itemName: String, stockUnit: String,
  unit: String, factor: Number, qty: Number, orderedM: Number,
  ratePaise: Number, discountBps: {type: Number, default: 0}, gstRateBps: {type: Number, default: 0},
  taxablePaise: Number, taxPaise: Number, totalPaise: Number,
  receivedM: {type: Number, default: 0}, acceptedM: {type: Number, default: 0}, rejectedM: {type: Number, default: 0}, returnedM: {type: Number, default: 0},
}, {_id: false});
const purchaseOrderSchema = new Schema({
  number: {type: String, required: true, unique: true},
  supplierId: {type: String, required: true, index: true}, supplierName: String,
  status: {type: String, enum: ['DRAFT', 'SUBMITTED', 'APPROVED', 'PARTIALLY_RECEIVED', 'FULLY_RECEIVED', 'REJECTED', 'CANCELLED', 'CLOSED'], default: 'DRAFT', index: true},
  orderDate: Date, expectedDate: Date, paymentTermsDays: Number, interState: Boolean,
  lines: [poLine],
  freightPaise: {type: Number, default: 0}, otherChargesPaise: {type: Number, default: 0},
  taxablePaise: Number, cgstPaise: Number, sgstPaise: Number, igstPaise: Number, roundOffPaise: Number, totalPaise: Number,
  supplierInvoiceNo: String, notes: String, attachments: [file], source: {type: String, default: 'MANUAL'},
  createdBy: actor, submittedAt: Date, approvedBy: actor, approvedAt: Date, rejectReason: String, cancelReason: String, closedReason: String,
  revision: {type: Number, default: 0},
}, opts);

const grnSchema = new Schema({
  number: {type: String, required: true, unique: true},
  poId: {type: String, required: true, index: true}, poNumber: String, supplierId: String, supplierName: String,
  supplierInvoiceNo: String, receivedDate: Date,
  lines: [{lineNo: Number, itemId: String, itemName: String, stockUnit: String, receivedM: Number, acceptedM: Number, rejectedM: Number, rejectReason: String, unitCostPaise: Number, valuePaise: Number, _id: false}],
  totalValuePaise: Number,
  status: {type: String, enum: ['POSTED', 'REVERSED'], default: 'POSTED'},
  notes: String, attachments: [file], postedBy: actor,
}, opts);

const billSchema = new Schema({
  number: {type: String, required: true, unique: true},
  supplierId: {type: String, required: true, index: true}, supplierName: String,
  supplierInvoiceNo: {type: String, required: true}, invoiceNoNorm: String,
  invoiceDate: Date, dueDate: Date,
  poId: String, grnIds: [String],
  lines: [{description: String, itemId: String, qty: Number, unit: String, ratePaise: Number, gstRateBps: Number, amountPaise: Number, _id: false}],
  taxablePaise: Number, taxPaise: Number, discountPaise: Number, freightPaise: Number, totalPaise: {type: Number, required: true},
  paidPaise: {type: Number, default: 0},
  status: {type: String, enum: ['DRAFT', 'POSTED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED'], default: 'DRAFT', index: true},
  attachment: file, importId: String, notes: String, warnings: [String],
  createdBy: actor, postedBy: actor, postedAt: Date,
}, opts);
billSchema.index({supplierId: 1, invoiceNoNorm: 1}, {unique: true, partialFilterExpression: {status: {$ne: 'CANCELLED'}}});

const supplierPaymentSchema = new Schema({
  number: {type: String, required: true, unique: true},
  supplierId: {type: String, required: true, index: true},
  amountPaise: {type: Number, required: true}, method: {type: String, enum: ['CASH', 'BANK', 'UPI', 'CHEQUE', 'OTHER']},
  reference: String, date: Date, allocations: [{billId: String, amountPaise: Number, _id: false}], proof: file,
  status: {type: String, enum: ['POSTED', 'VOID'], default: 'POSTED'}, voidReason: String, notes: String,
  createdBy: actor,
}, opts);

const purchaseReturnSchema = new Schema({
  number: {type: String, required: true, unique: true},
  grnId: String, grnNumber: String, poId: String, supplierId: String, supplierName: String,
  lines: [{lineNo: Number, itemId: String, itemName: String, qtyM: Number, unitCostPaise: Number, valuePaise: Number, reason: String, _id: false}],
  totalValuePaise: Number, notes: String, createdBy: actor,
}, opts);

// ---------- BOM (repaired ErpBom) ----------
const bomSchema = new Schema({
  productId: {type: String, required: true, index: true},  // legacy products.id (finished almirah)
  productName: String,
  version: {type: Number, required: true},
  status: {type: String, enum: ['DRAFT', 'PENDING_APPROVAL', 'ACTIVE', 'INACTIVE'], default: 'DRAFT'},
  outputQty: {type: Number, default: 1},
  lines: [{itemId: String, itemCode: String, itemName: String, unit: String, qtyM: Number, wastageBps: {type: Number, default: 0}, notes: String, _id: false}],
  labourPerUnitPaise: {type: Number, default: 0}, overheadPerUnitPaise: {type: Number, default: 0},
  otherCosts: [{label: String, perUnitPaise: Number, _id: false}],
  notes: String, createdBy: actor, approvedBy: actor, approvedAt: Date,
}, opts);
bomSchema.index({productId: 1, version: 1}, {unique: true});
bomSchema.index({productId: 1}, {unique: true, partialFilterExpression: {status: 'ACTIVE'}, name: 'one_active_bom_per_product'});

// ---------- Production (repaired ErpProduction) ----------
const productionSchema = new Schema({
  number: {type: String, required: true, unique: true},
  productId: {type: String, required: true, index: true}, productName: String,
  bomId: String, bomVersion: Number, bomSnapshot: Schema.Types.Mixed,
  plannedQty: {type: Number, required: true}, completedQty: {type: Number, default: 0}, rejectedQty: {type: Number, default: 0},
  status: {type: String, enum: ['DRAFT', 'SUBMITTED', 'APPROVED', 'MATERIALS_RESERVED', 'IN_PROGRESS', 'QUALITY_CHECK', 'COMPLETED', 'REJECTED', 'CANCELLED'], default: 'DRAFT', index: true},
  startDate: Date, expectedDate: Date, completedAt: Date,
  assignedTo: String, priority: {type: String, default: 'NORMAL'}, notes: String,
  lines: [{itemId: String, itemCode: String, itemName: String, unit: String, requiredM: Number, reservedM: {type: Number, default: 0}, issuedM: {type: Number, default: 0}, returnedM: {type: Number, default: 0}, wastedM: {type: Number, default: 0}, consumedM: {type: Number, default: 0}, issuedValuePaise: {type: Number, default: 0}, returnedValuePaise: {type: Number, default: 0}, plannedWastageM: Number, _id: false}],
  stages: [{code: String, name: String, order: Number, status: {type: String, default: 'PENDING'}, qtyDone: {type: Number, default: 0}, assignedTo: String, startedAt: Date, completedAt: Date, notes: String, _id: false}],
  outputs: [{batchNo: Number, producedQty: Number, acceptedQty: Number, rejectedQty: Number, qcNotes: String, unitCostPaise: Number, valuePaise: Number, postedAt: Date, postedBy: actor, _id: false}],
  labourCostPaise: {type: Number, default: 0}, overheadCostPaise: {type: Number, default: 0}, otherCostPaise: {type: Number, default: 0},
  costAbsorbedPaise: {type: Number, default: 0},
  createdBy: actor, approvedBy: actor, approvedAt: Date, rejectReason: String, cancelReason: String,
  history: [{at: Date, by: String, action: String, notes: String, _id: false}],
}, opts);

// ---------- Stock control ----------
const wastageSchema = new Schema({
  number: {type: String, required: true, unique: true},
  itemKind: {type: String, enum: ['ITEM', 'PRODUCT'], default: 'ITEM'}, itemId: {type: String, required: true}, itemName: String, unit: String,
  qtyM: {type: Number, required: true},
  wastageType: String, reason: String, notes: String,
  source: {type: String, enum: ['STORE', 'PRODUCTION'], required: true},
  productionOrderId: String, productionNumber: String, grnId: String,
  images: [file], costPaise: {type: Number, default: null},
  status: {type: String, enum: ['PENDING', 'APPROVED', 'REJECTED'], default: 'PENDING', index: true},
  reportedBy: actor, approvedBy: actor, approvedAt: Date, rejectReason: String,
}, opts);

const countSchema = new Schema({
  number: {type: String, required: true, unique: true},
  scope: {type: String, enum: ['FULL', 'CATEGORY', 'LOCATION', 'ITEMS'], default: 'ITEMS'}, scopeValue: String,
  blind: {type: Boolean, default: false}, assignedTo: String,
  status: {type: String, enum: ['IN_PROGRESS', 'SUBMITTED', 'POSTED', 'REJECTED'], default: 'IN_PROGRESS', index: true},
  lines: [{itemKind: String, itemId: String, itemCode: String, itemName: String, unit: String, location: String, systemM: Number, watermark: String, countedM: {type: Number, default: null}, varianceM: Number, reason: String, _id: false}],
  createdBy: actor, submittedAt: Date, approvedBy: actor, approvedAt: Date, rejectReason: String, notes: String,
}, opts);

const adjustmentSchema = new Schema({
  number: {type: String, required: true, unique: true},
  type: {type: String, enum: ['INCREASE', 'DECREASE', 'DAMAGED', 'MISSING', 'OPENING_CORRECTION', 'DATA_CORRECTION', 'FOUND', 'OTHER'], required: true},
  itemKind: {type: String, enum: ['ITEM', 'PRODUCT'], default: 'ITEM'}, itemId: String, itemName: String, unit: String,
  currentM: Number, adjustM: Number, newM: Number, unitCostPaise: Number,
  reason: {type: String, required: true}, attachment: file,
  status: {type: String, enum: ['PENDING', 'POSTED', 'REJECTED'], default: 'PENDING', index: true},
  requestedBy: actor, approvedBy: actor, approvedAt: Date, rejectReason: String,
}, opts);

// ---------- Control ----------
const counterSchema = new Schema({_id: String, seq: {type: Number, default: 0}}, {versionKey: false});
const operationSchema = new Schema({requestKey: {type: String, unique: true}, payloadHash: String, kind: String, result: Schema.Types.Mixed, actorId: String}, opts);
const settingsSchema = new Schema({
  _id: {type: String, default: 'default'},
  purchaseApprovalLimitPaise: {type: Number, default: 0},    // 0 = every PO needs approval
  adjustmentApprovalLimitPaise: {type: Number, default: 0},  // 0 = every adjustment needs approval
  selfApprovalAllowed: {type: Boolean, default: false},
  overReceiptToleranceBps: {type: Number, default: 0},
  companyStateCode: {type: String, default: ''},
  stages: {type: [{code: String, name: String, order: Number, _id: false}], default: undefined},
  accountantGrants: {type: [String], default: []},
  salesCountAt: {type: String, enum: ['APPROVED', 'DISPATCHED'], default: 'APPROVED'},
  revision: {type: Number, default: 0},
}, {timestamps: true, versionKey: false});
const storedFileSchema = new Schema({gridId: String, name: String, mime: String, size: Number, sha256: {type: String, index: true}, visibility: {type: String, enum: ['public', 'private']}, uploadedBy: actor, purpose: String}, opts);

const m = <T>(name: string, schema: mongoose.Schema) => (mongoose.models[name] as mongoose.Model<T>) || mongoose.model<T>(name, schema);
export const Inv = {
  Item: m<any>('ErpRawMaterial', itemSchema),
  Ledger: m<any>('ErpStockLedger', ledgerSchema),
  ProductProfile: m<any>('InvProductProfile', productProfileSchema),
  Supplier: m<any>('InvSupplier', supplierSchema),
  SupplierLedger: m<any>('InvSupplierLedger', supplierLedgerSchema),
  PurchaseOrder: m<any>('InvPurchaseOrder', purchaseOrderSchema),
  GoodsReceipt: m<any>('InvGoodsReceipt', grnSchema),
  Bill: m<any>('InvPurchaseBill', billSchema),
  SupplierPayment: m<any>('InvSupplierPayment', supplierPaymentSchema),
  PurchaseReturn: m<any>('InvPurchaseReturn', purchaseReturnSchema),
  Bom: m<any>('ErpBom', bomSchema),
  Production: m<any>('ErpProduction', productionSchema),
  Wastage: m<any>('InvWastage', wastageSchema),
  Count: m<any>('InvStockCount', countSchema),
  Adjustment: m<any>('InvAdjustment', adjustmentSchema),
  Counter: m<any>('InvCounter', counterSchema),
  Operation: m<any>('InvOperation', operationSchema),
  Settings: m<any>('InvSettings', settingsSchema),
  File: m<any>('InvFile', storedFileSchema),
};
