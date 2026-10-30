import fs from 'node:fs/promises';
import path from 'node:path';
import mongoose from 'mongoose';
import {config} from '../apps/api/src/config.js';
import {Models} from '../apps/api/src/models.js';
import {Store} from '../apps/api/src/types.js';
import {normalize,validateStore} from '../apps/api/src/repository.js';

const source=path.resolve(process.env.JSON_SOURCE||config.dataFile);
if(config.PERSISTENCE!=='mongo')throw new Error('Set PERSISTENCE=mongo before importing. This command never writes JSON.');
if(!config.MONGODB_URI)throw new Error('MONGODB_URI is required.');
if(process.env.IMPORT_CONFIRM!=='EMPTY_LOCAL_DB_ONLY')throw new Error('Refusing import: set IMPORT_CONFIRM=EMPTY_LOCAL_DB_ONLY for an explicitly disposable local database');
const raw=JSON.parse(await fs.readFile(source,'utf8')) as Partial<Store>;
const required=['users','products','customers','orders','invoices','audit'] as const;
for(const key of required)if(!Array.isArray(raw[key]))throw new Error(`Malformed JSON: ${key} must be an array`);
if(!raw.settings||typeof raw.settings!=='object')throw new Error('Malformed JSON: settings is required');
for(const p of raw.products||[]){if(!p.id||!p.sku||typeof p.stock!=='number')throw new Error(`Malformed product: ${p.id||'unknown'}`);p.reservedStock=p.reservedStock||0;}
const incoming=validateStore(normalize({...raw,inventoryMovements:raw.inventoryMovements||[]} as Store));
await mongoose.connect(config.MONGODB_URI);const dbName=mongoose.connection.name;if(!/(^|[_-])(dev|test)([_-]|$)/i.test(dbName)){await mongoose.disconnect();throw new Error(`Refusing import into database ${dbName}; database name must clearly indicate dev or test`);}await Promise.all(Object.values(Models).map(m=>m.createIndexes()));
const existing=await Promise.all([Models.users.countDocuments(),Models.products.countDocuments(),Models.customers.countDocuments(),Models.orders.countDocuments(),Models.invoices.countDocuments(),Models.settings.countDocuments(),Models.audit.countDocuments(),Models.movements.countDocuments()]);if(existing.some(Boolean)){await mongoose.disconnect();throw new Error(`Refusing import: target database ${dbName} is not empty`);}
const session=await mongoose.startSession();try{await session.withTransaction(async()=>{await Promise.all([Models.users.insertMany(incoming.users,{session}),Models.products.insertMany(incoming.products,{session}),Models.customers.insertMany(incoming.customers,{session}),Models.orders.insertMany(incoming.orders,{session}),Models.invoices.insertMany(incoming.invoices,{session}),Models.settings.create([incoming.settings],{session}),Models.audit.insertMany(incoming.audit,{session}),Models.movements.insertMany(incoming.inventoryMovements,{session})]);});}finally{await session.endSession();await mongoose.disconnect();}
console.log(`Imported ${incoming.products.length} products, ${incoming.orders.length} orders, and ${incoming.invoices.length} invoices from ${source}. Original JSON was not modified.`);
