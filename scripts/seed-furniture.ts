import fs from 'node:fs/promises';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import {config} from '../apps/api/src/config.js';
import {ensureDevelopmentUsers,makeSeed,validateStore} from '../apps/api/src/repository.js';
import type {Customer,InventoryMovement,Product,Store} from '../apps/api/src/types.js';

const target=path.resolve(process.env.FURNITURE_DATA_FILE||'./data/furniture-test-store.json');
const dataRoot=path.resolve('./data');
const dryRun=process.argv.includes('--dry-run');
const confirmation=process.env.FURNITURE_TEST_CONFIRM;

if(config.NODE_ENV==='production')throw new Error('Furniture test seed refuses to run in production');
if(config.PERSISTENCE!=='json')throw new Error('Furniture test seed requires explicit PERSISTENCE=json');
if(!target.startsWith(`${dataRoot}${path.sep}`)||!path.basename(target).toLowerCase().includes('furniture-test'))throw new Error('Furniture test seed target must be a dedicated furniture-test file under data');
if(!dryRun&&confirmation!=='YES')throw new Error('Refusing to write furniture test data; set FURNITURE_TEST_CONFIRM=YES for the dedicated test file');

const products:Array<Omit<Product,'id'|'stock'|'reservedStock'>>=[
  {name:'Steel Almirah — 2 Door',sku:'FURN-ALM-2D',category:'Test Furniture / Almirahs',unit:'piece',price:12500,reorder:5,status:'active'},
  {name:'Steel Almirah — 3 Door',sku:'FURN-ALM-3D',category:'Test Furniture / Almirahs',unit:'piece',price:17800,reorder:4,status:'active'},
  {name:'Steel Almirah — Locker Model',sku:'FURN-ALM-LKR',category:'Test Furniture / Almirahs',unit:'piece',price:21400,reorder:3,status:'active'},
  {name:'Wooden Wardrobe — 2 Door',sku:'FURN-WRD-2D',category:'Test Furniture / Wardrobes',unit:'piece',price:28500,reorder:5,status:'active'},
  {name:'Wooden Wardrobe — 3 Door',sku:'FURN-WRD-3D',category:'Test Furniture / Wardrobes',unit:'piece',price:38200,reorder:4,status:'active'},
  {name:'Sliding Door Wardrobe',sku:'FURN-WRD-SLD',category:'Test Furniture / Wardrobes',unit:'piece',price:46500,reorder:2,status:'active'},
  {name:'Office Storage Cabinet',sku:'FURN-OFC-CAB',category:'Test Furniture / Office',unit:'piece',price:16800,reorder:4,status:'active'},
  {name:'Filing Cabinet',sku:'FURN-FIL-CAB',category:'Test Furniture / Office',unit:'piece',price:9200,reorder:3,status:'active'},
  {name:'Kitchen Storage Cabinet',sku:'FURN-KIT-CAB',category:'Test Furniture / Kitchen',unit:'piece',price:22400,reorder:4,status:'active'},
  {name:'Shoe Rack',sku:'FURN-SHO-RCK',category:'Test Furniture / Storage',unit:'piece',price:6800,reorder:4,status:'active'},
  {name:'Bedside Cabinet',sku:'FURN-BED-CAB',category:'Test Furniture / Bedroom',unit:'piece',price:5400,reorder:3,status:'active'},
  {name:'Bookshelf',sku:'FURN-BOK-SHF',category:'Test Furniture / Storage',unit:'piece',price:7800,reorder:4,status:'active'},
  {name:'Drawer Unit',sku:'FURN-DRW-UNT',category:'Test Furniture / Office',unit:'piece',price:8600,reorder:3,status:'active'},
  {name:'Wall Cabinet',sku:'FURN-WAL-CAB',category:'Test Furniture / Storage',unit:'piece',price:11200,reorder:3,status:'active'},
  {name:'Small Steel Locker',sku:'FURN-STL-LKR',category:'Test Furniture / Lockers',unit:'piece',price:7400,reorder:3,status:'active'},
  {name:'Almirah Shelf',sku:'FURN-ALM-SHF',category:'Test Furniture / Accessories',unit:'piece',price:1800,reorder:3,status:'active'},
  {name:'Almirah Handle Set',sku:'FURN-ALM-HDL',category:'Test Furniture / Accessories',unit:'piece',price:650,reorder:5,status:'active'},
  {name:'Lock and Key Set',sku:'FURN-LCK-KEY',category:'Test Furniture / Accessories',unit:'piece',price:480,reorder:5,status:'active'},
  {name:'Drawer Channel Set',sku:'FURN-DRW-CHN',category:'Test Furniture / Accessories',unit:'piece',price:950,reorder:5,status:'active'},
  {name:'Wardrobe Hinge Set',sku:'FURN-WRD-HNG',category:'Test Furniture / Accessories',unit:'piece',price:720,reorder:5,status:'active'},
];
const stockBySku:Record<string,number>={
  'FURN-ALM-2D':12,'FURN-ALM-3D':8,'FURN-ALM-LKR':6,'FURN-WRD-2D':2,'FURN-WRD-3D':5,
  'FURN-WRD-SLD':0,'FURN-OFC-CAB':7,'FURN-FIL-CAB':9,'FURN-KIT-CAB':4,'FURN-SHO-RCK':11,
  'FURN-BED-CAB':8,'FURN-BOK-SHF':6,'FURN-DRW-UNT':3,'FURN-WAL-CAB':5,'FURN-STL-LKR':4,
  'FURN-ALM-SHF':15,'FURN-ALM-HDL':25,'FURN-LCK-KEY':30,'FURN-DRW-CHN':18,'FURN-WRD-HNG':22,
};
const customers=[
  ['Fictional Customer — Maple Home','+91 70000 10001'],['Fictional Customer — Cedar Office','+91 70000 10002'],
  ['Fictional Customer — Ivory Living','+91 70000 10003'],['Fictional Customer — Metro Furnishers','+91 70000 10004'],
  ['Fictional Customer — Blue Room','+91 70000 10005'],['Fictional Customer — North Desk','+91 70000 10006'],
  ['Fictional Customer — Quiet Corner','+91 70000 10007'],['Fictional Customer — Green Shelf','+91 70000 10008'],
  ['Fictional Customer — Empty Order Case','+91 70000 10009'],
];

async function readExisting():Promise<Store>{try{return validateStore(JSON.parse(await fs.readFile(target,'utf8')) as Store);}catch(error){const code=error&&typeof error==='object'&&'code' in error?(error as {code?:string}).code:undefined;if(code==='ENOENT'){const seed=makeSeed();seed.products=[];seed.customers=[];seed.orders=[];seed.invoices=[];seed.audit=[];seed.inventoryMovements=[];ensureDevelopmentUsers(seed);return seed;}throw new Error('Dedicated furniture test file exists but is malformed; it was left untouched');}}
function testProductId(index:number){return `furn-test-p-${String(index+1).padStart(3,'0')}`;}
function testCustomerId(index:number){return `furn-test-c-${String(index+1).padStart(3,'0')}`;}
function movement(product:Product,actor:string,sourceId:string):InventoryMovement{return {id:`furn-test-opening-${product.id}`,productId:product.id,unit:product.unit,quantity:product.stock,type:'opening',sourceId,actor,beforeOnHand:0,afterOnHand:product.stock,beforeReserved:0,afterReserved:0,createdAt:'2026-10-29T00:00:00.000Z'};}

const store=await readExisting();
const additions={products:0,customers:0,movements:0};
const sourceId='furn-test-seed-2026-10-29';
for(const [index,definition] of products.entries()){
  const id=testProductId(index);const existingById=store.products.find(product=>product.id===id);const existingBySku=store.products.find(product=>product.sku===definition.sku);
  if(existingById){if(existingById.sku!==definition.sku)throw new Error(`Refusing conflicting test product id ${id}`);continue;}
  if(existingBySku)throw new Error(`Refusing to reuse existing product SKU ${definition.sku}`);
  const product={id,...definition,stock:stockBySku[definition.sku],reservedStock:0};store.products.push(product);store.inventoryMovements.push(movement(product,'furniture-test-seed',sourceId));additions.products++;additions.movements++;
}
for(const [index,[name,phone]] of customers.entries()){
  const id=testCustomerId(index);const existingById=store.customers.find(customer=>customer.id===id);if(existingById){if(existingById.name!==name)throw new Error(`Refusing conflicting test customer id ${id}`);continue;}
  store.customers.push({id,name,phone,balance:0} as Customer);additions.customers++;
}
validateStore(store);
console.log(JSON.stringify({dryRun,target,fictional:true,products:store.products.filter(product=>product.id.startsWith('furn-test-')).length,customers:store.customers.filter(customer=>customer.id.startsWith('furn-test-')).length,orders:store.orders.filter(order=>order.id.startsWith('furn-test-')).length,added:additions},null,2));
if(!dryRun){await fs.mkdir(path.dirname(target),{recursive:true});const temporary=`${target}.tmp`;await fs.writeFile(temporary,JSON.stringify(store,null,2),'utf8');await fs.rename(temporary,target);}
