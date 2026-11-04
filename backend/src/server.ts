import dns  from "node:dns";
import http from "http";
dns.setServers(["1.1.1.1", "8.8.8.8"]);
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import {z} from 'zod';
import {config} from './config.js';
import {Models} from './models.js';
import {JsonRepository,MongoRepository,Repository} from './repository.js';
import {Order,OrderStatus,Role,Store} from './types.js';
import {StockError,available,finalizeSale,release,reserve} from './stock.js';
import {registerErpRoutes} from './erp-routes.js';
import {registerFileRoutes,registerInventoryRoutes} from './inventory/index.js';
import {registerSalesRoutes,recordLogin} from './sales/index.js';
import {transitions} from './order-rules.js';
import {registerAdminRoutes} from './overview/routes.js';
import {registerInsightsRoutes} from './overview/insights.js';
import {registerBillRoutes} from './bills/routes.js';


export const app=express();
const allowedOrigins=new Set([config.APP_ORIGIN, 'http://localhost:5173', 'http://127.0.0.1:5173','http://localhost:4173','http://127.0.0.1:4173','https://zen-ledger-website-by-e-zentix-8b9g.vercel.app','https://zen-ledger-website-by-e-zentix-8b9g-git-main-ezentic.vercel.app']);
// Vite moves to 5174, 5175… when 5173 is busy (e.g. another project), which used to make login fail with
// "Failed to fetch". Any local dev port is fine: auth is a bearer token, not a cookie, so CORS guards no credentials.
const localDevOrigin=/^http:\/\/(localhost|127\.0\.0\.1|\[::1\]):\d{2,5}$/;
const originAllowed=(origin:string)=>allowedOrigins.has(origin)||localDevOrigin.test(origin);
// Security middleware first; every route (legacy, ERP, inventory) is registered after it.
app.use(helmet());app.use(cors({origin:(origin,callback)=>{if(!origin||originAllowed(origin))return callback(null,true);return callback(new Error('CORS origin is not allowed'));}}));app.use(rateLimit({windowMs:60_000,max:240,standardHeaders:true,legacyHeaders:false,skip:()=>config.NODE_ENV==='test'}));
// Raw-body upload route must come before the JSON parser.
registerFileRoutes(app);
app.use(express.json({limit:'1mb'}));
registerErpRoutes(app);
registerInventoryRoutes(app);
registerSalesRoutes(app);
registerAdminRoutes(app);
registerInsightsRoutes(app);
registerBillRoutes(app);
let db:Store;let repo:Repository;
let lock=Promise.resolve();
let loadedAt=0;
const READ_REFRESH_MS=Number(process.env.READ_REFRESH_MS??2_000);
// Snapshot of the committed state the current mutation started from; persist() writes only the difference.
let base:Store|undefined;
/**
 * Every mutation: take the cross-process lock, re-read committed state (so writes made by
 * another instance or by the inventory module are never overwritten), run the handler, and
 * commit only changed documents. On failure the in-memory state is restored.
 */
async function runExclusive<T>(fn:()=>Promise<T>):Promise<T>{const releaseLock=await repo?.acquireMutationLock?.();const previous=db;try{if(repo.reload){db=await repo.reload();loadedAt=Date.now();}base=structuredClone(db);return await fn();}catch(e){db=previous;throw e;}finally{base=undefined;await releaseLock?.();}}
function exclusive<T>(fn:()=>Promise<T>):Promise<T>{const next=lock.then(()=>runExclusive(fn),()=>runExclusive(fn));lock=next.then(()=>undefined,()=>undefined);return next;}
/** Queue a read-side refresh on the same in-process queue so it never swaps state under a running mutation. */
function refreshForRead():Promise<void>{if(!repo?.reload||Date.now()-loadedAt<READ_REFRESH_MS)return Promise.resolve();const next=lock.then(async()=>{if(Date.now()-loadedAt<READ_REFRESH_MS)return;db=await repo.reload!();loadedAt=Date.now();});lock=next.then(()=>undefined,()=>undefined);return next;}
// GET reads use a fresh snapshot. Mongo login reads only its indexed user record so newly
// provisioned accounts can sign in without refreshing every collection.
app.use('/api',(req,res,next)=>{if(req.method!=='GET')return next();refreshForRead().then(()=>next(),e=>{console.error(e);res.status(503).json({error:'Database temporarily unavailable'});});});
function id(prefix:string){return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;}
function user(req:express.Request){return (req as any).user as {id:string;name:string;email:string;role:Role};}
function audit(action:string,actor=userContext?.email||'system'){db.audit.unshift({id:id('audit'),action,actor,at:new Date().toISOString()});}
let userContext:{email:string}|undefined;
async function persist(){if(repo.commit&&base){await repo.commit(base,db);base=structuredClone(db);return;}await repo.save(db);}
function businessDay(value:string){return new Intl.DateTimeFormat('en-CA',{timeZone:config.BUSINESS_TIMEZONE,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));}
const claims=z.object({id:z.string(),name:z.string(),email:z.string().email().optional(),phone:z.string().optional(),role:z.enum(['owner','accounts','salesman']),tv:z.number().int().optional(),exp:z.number().int().positive()});
function auth(req:express.Request,res:express.Response,next:express.NextFunction){const token=req.headers.authorization?.replace('Bearer ','');if(!token)return res.status(401).json({error:'Authentication required'});try{const parsed=claims.safeParse(jwt.verify(token,config.JWT_SECRET));if(!parsed.success)return res.status(401).json({error:'Invalid session'});const account=db.users.find(u=>u.id===parsed.data.id);if(!account||account.active===false||account.role!==parsed.data.role||(account.tokenVersion||0)!==(parsed.data.tv||0))return res.status(401).json({error:'Session is no longer valid. Please sign in again.'});(req as any).user=parsed.data;next();}catch{return res.status(401).json({error:'Invalid session'});}}
function allow(...roles:Role[]){return (req:express.Request,res:express.Response,next:express.NextFunction)=>{if(!roles.includes(user(req)?.role))return res.status(403).json({error:'Permission denied'});next();};}
function idem(req:express.Request){return String(req.header('Idempotency-Key')||'').trim()||undefined;}
function handleError(res:express.Response,e:unknown){if(e instanceof StockError)return res.status(409).json({error:e.message,code:e.code});console.error(e);return res.status(500).json({error:'Unexpected server error'});}
function exclusiveHandler(req:express.Request,res:express.Response,fn:()=>Promise<unknown>):void{void exclusive(fn).catch((e:unknown)=>{handleError(res,e);});}
const orderBody=z.object({customerId:z.string().min(1),items:z.array(z.object({productId:z.string().min(1),qty:z.number().finite().positive()})).min(1)});
const statusBody=z.object({status:z.enum(['Approved','Rejected','Cancelled','Processing','Dispatched','Delivered']),reason:z.string().max(500).optional()});

app.get('/api/health',(_,res)=>res.json({ok:true,service:'business-management-api',persistence:repo?.kind||'starting'}));
app.post('/api/auth/login',async(req,res)=>{const parsed=z.object({email:z.string().email().optional(),phone:z.string().min(5).optional(),password:z.string().min(8)}).refine(v=>Boolean(v.email||v.phone)).safeParse(req.body);if(!parsed.success)return res.status(400).json({error:'Enter a valid phone/email and password'});const identifier=parsed.data.phone?.replace(/\D/g,'')||parsed.data.email?.toLowerCase();const u=repo?.kind==='mongo'?await Models.users.findOne({$or:[{email:identifier},{email:`${identifier}@phone.local`},{phone:identifier}]}).lean():db.users.find(x=>x.email?.toLowerCase()===identifier||x.email?.endsWith('@phone.local')&&x.email.slice(0,-12)===identifier||x.phone?.replace(/\D/g,'')===identifier);if(!u||!bcrypt.compareSync(parsed.data.password,u.password))return res.status(401).json({error:'Incorrect phone/email or password'});if(u.active===false)return res.status(403).json({error:'This account has been deactivated. Contact your administrator.'});const phone=u.phone|| (u.email?.endsWith('@phone.local')?u.email.slice(0,-12):undefined);const token=jwt.sign({id:u.id,name:u.name,email:u.email,phone,role:u.role,tv:u.tokenVersion||0},config.JWT_SECRET,{expiresIn:'8h'});if(repo?.kind==='mongo')void recordLogin(u.id,u.role,u.name);res.json({token,user:{id:u.id,name:u.name,email:u.email,phone,role:u.role,mustChangePassword:Boolean(u.mustChangePassword)}});});
app.get('/api/me',auth,(req,res)=>res.json({user:user(req)}));
app.get('/api/users',auth,allow('owner'),(_,res)=>res.json(db.users.filter(u=>u.role==='salesman').map(({password,...safe})=>({...safe,phone:safe.phone|| (safe.email?.endsWith('@phone.local')?safe.email.slice(0,-12):undefined)}))));
app.post('/api/users',auth,allow('owner'),(req,res)=>exclusiveHandler(req,res,async()=>{const parsed=z.object({name:z.string().min(2),phone:z.string().min(5),password:z.string().min(8)}).safeParse(req.body);if(!parsed.success)return res.status(400).json({error:'Name, phone and an 8-character password are required'});const phone=parsed.data.phone.replace(/\D/g,'');if(db.users.some(u=>u.phone?.replace(/\D/g,'')===phone))return res.status(409).json({error:'Phone number already exists'});const created={id:id('u'),name:parsed.data.name,email:`${phone}@phone.local`,phone,password:bcrypt.hashSync(parsed.data.password,10),role:'salesman' as const};db.users.push(created);audit(`Created salesman ${created.name}`,user(req).email);await persist();const {password:_,...safe}=created;return res.status(201).json(safe);}));
app.get('/api/dashboard',auth,allow('owner','accounts'),(_,res)=>{const today=businessDay(new Date().toISOString());const todayInvoices=db.invoices.filter(i=>businessDay(i.createdAt)===today);const sales=todayInvoices.reduce((s,i)=>s+i.total,0);const collections=todayInvoices.reduce((s,i)=>s+i.paid,0);const low=db.products.filter(p=>available(p)<=p.reorder).length;res.json({sales,collections,dues:db.customers.reduce((s,c)=>s+c.balance,0),lowStock:low,pendingOrders:db.orders.filter(o=>o.status==='Pending').length,products:db.products.length,customers:db.customers.length,expenses:0});});
app.get('/api/products',auth,(req,res)=>{const q=String(req.query.q||'').toLowerCase();const page=Math.max(1,Number(req.query.page||1));const limit=Math.min(100,Math.max(1,Number(req.query.limit||50)));const all=db.products.filter(p=>p.status==='active'&&(!q||`${p.name} ${p.sku} ${p.category}`.toLowerCase().includes(q)));res.set({'X-Total-Count':String(all.length),'X-Page':String(page),'X-Limit':String(limit)}).json(all.slice((page-1)*limit,page*limit).map(p=>({...p,available:available(p)})));});
app.post('/api/products',auth,allow('owner','accounts'),(req,res)=>exclusiveHandler(req,res,async()=>{const p=z.object({name:z.string().min(2),sku:z.string().min(2),category:z.string().min(1),unit:z.string().min(1),price:z.number().nonnegative(),stock:z.number().nonnegative(),reorder:z.number().nonnegative()}).safeParse(req.body);if(!p.success)return res.status(400).json({error:'Invalid product details'});if(db.products.some(x=>x.sku===p.data.sku))return res.status(409).json({error:'SKU already exists'});const product={id:id('p'),...p.data,reservedStock:0,status:'active' as const};db.products.unshift(product);db.inventoryMovements.unshift({id:id('mov'),productId:product.id,unit:product.unit,quantity:product.stock,type:'opening',actor:user(req).email,beforeOnHand:0,afterOnHand:product.stock,beforeReserved:0,afterReserved:0,createdAt:new Date().toISOString()});audit(`Created product ${product.sku}`,user(req).email);await persist();return res.status(201).json({...product,available:available(product)});}));
app.get('/api/customers',auth,allow('owner','accounts'),(_,res)=>res.json(db.customers));
app.get('/api/my-customers',auth,allow('salesman'),(req,res)=>res.json(db.customers.filter(c=>c.createdBy===user(req).id||c.assignedSalesmanId===user(req).id)));
app.post('/api/customers',auth,allow('owner','accounts','salesman'),(req,res)=>exclusiveHandler(req,res,async()=>{const p=z.object({name:z.string().min(2),phone:z.string().min(5)}).safeParse(req.body);if(!p.success)return res.status(400).json({error:'Name and phone are required'});const customer={id:id('c'),...p.data,balance:0,createdBy:user(req).role==='salesman'?user(req).id:undefined};db.customers.unshift(customer);audit(`Created customer ${customer.name}`,user(req).email);await persist();return res.status(201).json(customer);}));
app.get('/api/inventory/movements',auth,allow('owner','accounts'),(req,res)=>{const productId=String(req.query.productId||'');res.json(db.inventoryMovements.filter(m=>!productId||m.productId===productId).slice(0,500));});
app.get('/api/orders',auth,(req,res)=>{const role=user(req).role;const own=role==='salesman'?db.orders.filter(o=>o.createdBy===user(req).id):db.orders;res.json([...own].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)));});
app.post('/api/orders',auth,allow('owner','salesman'),(req,res)=>exclusiveHandler(req,res,async()=>{const parsed=orderBody.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:'Customer and at least one valid item are required'});const key=idem(req);const fingerprint=JSON.stringify(parsed.data);if(key){const existing=db.orders.find(o=>o.idempotencyKey===`${user(req).id}:${key}`);if(existing){if(existing.requestFingerprint!==fingerprint)return res.status(409).json({error:'Idempotency-Key was already used with a different request'});return res.status(200).json(existing);}}const c=db.customers.find(x=>x.id===parsed.data.customerId);if(!c)return res.status(404).json({error:'Customer not found'});const items=[];for(const line of parsed.data.items){const product=db.products.find(x=>x.id===line.productId&&x.status==='active');if(!product)return res.status(404).json({error:'Product not found'});items.push({productId:product.id,name:product.name,qty:line.qty,price:product.price,unit:product.unit});}const order:Order={id:id('ord'),customerId:c.id,customerName:c.name,createdBy:user(req).id,items,total:items.reduce((s,x)=>s+x.qty*x.price,0),status:'Pending',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),idempotencyKey:key?`${user(req).id}:${key}`:undefined,requestFingerprint:fingerprint,stockReserved:false};if(db.settings.stockPolicy==='submission'){for(const line of items)reserve(db.products.find(p=>p.id===line.productId)!,line.qty,db.settings.stockPolicy,user(req).email,order.id,db.inventoryMovements,key);order.stockReserved=true;}db.orders.unshift(order);audit(`Submitted order ${order.id}`,user(req).email);await persist();return res.status(201).json(order);}));
app.patch('/api/orders/:id/status',auth,allow('owner','accounts'),(req,res)=>exclusiveHandler(req,res,async()=>{const parsed=statusBody.safeParse(req.body);const o=db.orders.find(x=>x.id===req.params.id);if(!o||!parsed.success)return res.status(400).json({error:'Invalid order update'});if(!transitions[o.status].includes(parsed.data.status))return res.status(409).json({error:`Cannot move order from ${o.status} to ${parsed.data.status}`});const actor=user(req).email;if(parsed.data.status==='Approved'&&db.settings.stockPolicy==='approval'){for(const line of o.items)reserve(db.products.find(p=>p.id===line.productId)!,line.qty,db.settings.stockPolicy,actor,o.id,db.inventoryMovements);o.stockReserved=true;}if((parsed.data.status==='Rejected'||parsed.data.status==='Cancelled')&&o.stockReserved){for(const line of o.items)release(db.products.find(x=>x.id===line.productId)!,line.qty,actor,o.id,db.inventoryMovements);o.stockReserved=false;}if(parsed.data.status==='Dispatched'){for(const line of o.items)finalizeSale(db.products.find(p=>p.id===line.productId)!,line.qty,db.settings.stockPolicy,actor,o.id,db.inventoryMovements);o.stockReserved=false;}o.status=parsed.data.status;o.reason=parsed.data.reason;o.updatedAt=new Date().toISOString();const stamp={Approved:'approvedAt',Dispatched:'dispatchedAt',Delivered:'deliveredAt',Rejected:'closedAt',Cancelled:'closedAt'}[parsed.data.status as string] as keyof Order|undefined;if(stamp)(o as any)[stamp]=o.updatedAt;(o as any).statusBy=actor;audit(`Order ${o.id} marked ${o.status}`,actor);await persist();return res.json(o);}));
app.get('/api/invoices',auth,allow('owner','accounts'),(_,res)=>res.json(db.invoices));
app.post('/api/invoices/from-order/:id',auth,allow('owner','accounts'),(req,res)=>exclusiveHandler(req,res,async()=>{const o=db.orders.find(x=>x.id===req.params.id);if(!o||!['Approved','Processing','Dispatched','Delivered'].includes(o.status))return res.status(400).json({error:'Order is not eligible for invoicing'});if(db.invoices.some(i=>i.id===o.id))return res.status(409).json({error:'Invoice already exists'});const number=`INV-${new Date().getFullYear()}-${String(db.invoices.length+1).padStart(4,'0')}`;const inv={id:o.id,number,customerName:o.customerName,total:o.total,paid:0,status:'Due' as const,createdAt:new Date().toISOString()};db.invoices.unshift(inv);const c=db.customers.find(x=>x.id===o.customerId);if(c)c.balance+=o.total;audit(`Created invoice ${number}`,user(req).email);await persist();return res.status(201).json(inv);}));
app.get('/api/settings',auth,allow('owner','accounts'),(_,res)=>res.json(db.settings));
app.patch('/api/settings',auth,allow('owner'),(req,res)=>exclusiveHandler(req,res,async()=>{const p=z.object({businessName:z.string().min(2),currency:z.string().min(3),stockPolicy:z.enum(['submission','approval','dispatch']),taxEnabled:z.boolean()}).safeParse(req.body);if(!p.success)return res.status(400).json({error:'Invalid settings'});if(db.orders.some(o=>['Pending','Approved','Processing'].includes(o.status))&&p.data.stockPolicy!==db.settings.stockPolicy)return res.status(409).json({error:'Cannot change stock policy while active orders exist'});db.settings=p.data;audit('Updated business settings',user(req).email);await persist();return res.json(db.settings);}));
app.get('/api/audit',auth,allow('owner','accounts'),(_,res)=>res.json(db.audit.slice(0,100)));
app.use((err:any,_req:express.Request,res:express.Response,_next:express.NextFunction)=>handleError(res,err));

async function initialize(){if(db)return;repo=config.PERSISTENCE==='mongo'?new MongoRepository():new JsonRepository();if(repo instanceof MongoRepository)await repo.connect();db=await repo.load();loadedAt=Date.now();}
async function bootstrap(){await initialize();if(process.env.VERCEL)return;const server=app.listen(config.PORT,()=>console.log(`API listening on http://localhost:${config.PORT} using ${repo.kind}`));const shutdown=async()=>{server.close();await repo.close();process.exit(0)};process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);}
export async function ensureInitialized(){await initialize();}
export function installTestState(testDb:Store,testRepo:Repository){db=testDb;repo=testRepo;loadedAt=Date.now();}
export {bootstrap};
if(process.env.API_AUTOSTART!=='false'&&!process.env.VERCEL)bootstrap().catch(e=>{console.error('API startup failed:',e instanceof Error?e.message:'unknown error');process.exit(1);});

