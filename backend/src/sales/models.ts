import mongoose from 'mongoose';

const {Schema} = mongoose;
const opts = {timestamps: true, versionKey: false as const};
const actor = new Schema({id: String, name: String, role: String}, {_id: false});

export const TARGET_TYPES = ['SALES_AMOUNT', 'REVENUE', 'ORDER_COUNT', 'COLLECTION_AMOUNT', 'NEW_CUSTOMERS', 'DELIVERIES'] as const;
export const MONEY_TARGETS = ['SALES_AMOUNT', 'REVENUE', 'COLLECTION_AMOUNT'];

const targetSchema = new Schema({
  name: {type: String, required: true, trim: true},
  salesmanId: {type: String, required: true, index: true}, salesmanName: String,
  type: {type: String, enum: TARGET_TYPES, required: true},
  period: {type: String, enum: ['DAILY', 'WEEKLY', 'MONTHLY', 'CUSTOM'], required: true},
  startDate: {type: String, required: true}, endDate: {type: String, required: true},   // YYYY-MM-DD, inclusive, business timezone
  targetValue: {type: Number, required: true, min: 0},                                  // paise for money targets, count otherwise
  description: String, instructions: String,
  status: {type: String, enum: ['ACTIVE', 'CANCELLED'], default: 'ACTIVE', index: true},
  assignedBy: actor, version: {type: Number, default: 1},
  revisions: [{version: Number, at: Date, by: actor, reason: String, before: Schema.Types.Mixed, after: Schema.Types.Mixed, _id: false}],
  achievedNotifiedAt: Date,
}, opts);
targetSchema.index({salesmanId: 1, startDate: 1, endDate: 1});

const activitySchema = new Schema({
  at: {type: Date, required: true, index: true},
  type: {type: String, required: true, index: true},
  salesmanId: {type: String, index: true}, salesmanName: String,
  actor: actor, description: String,
  customerId: String, customerName: String, orderId: String, amountPaise: Number, status: String,
  key: {type: String, required: true, unique: true},
}, {versionKey: false});
activitySchema.index({salesmanId: 1, at: -1});

const m = (name: string, schema: mongoose.Schema) => (mongoose.models[name] as mongoose.Model<any>) || mongoose.model<any>(name, schema);
export const Sales = {Target: m('SalesTarget', targetSchema), Activity: m('SalesActivity', activitySchema)};
