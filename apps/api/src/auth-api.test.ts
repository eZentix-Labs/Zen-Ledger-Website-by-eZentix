import {createServer,Server} from 'node:http';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {ensureDevelopmentUsers,Repository} from './repository.js';
import {Role,Store} from './types.js';

process.env.NODE_ENV='test';
process.env.JWT_SECRET='isolated-test-secret-with-more-than-32-characters';
process.env.PERSISTENCE='json';
process.env.DATA_FILE='./data/phase-5c-test-store.json';
process.env.API_AUTOSTART='false';

const passwordByRole:Record<Role,string>={owner:'owner-test-password',accounts:'accounts-test-password',salesman:'salesman-test-password'};
const hash=(role:Role)=>bcrypt.hashSync(passwordByRole[role],4);
const makeStore=(stockPolicy:'submission'|'approval'|'dispatch'='approval',stock=10):Store=>({users:[{id:'u-owner',name:'Owner',email:'owner@test.local',password:hash('owner'),role:'owner'},{id:'u-accounts',name:'Accounts',email:'accounts@test.local',password:hash('accounts'),role:'accounts'},{id:'u-sales-1',name:'Sales One',email:'sales1@test.local',password:hash('salesman'),role:'salesman'},{id:'u-sales-2',name:'Sales Two',email:'sales2@test.local',password:hash('salesman'),role:'salesman'}],products:[{id:'p1',name:'Rice',sku:'RICE-TEST',category:'Staples',unit:'bag',price:100,stock,reservedStock:0,reorder:2,status:'active'}],customers:[{id:'c1',name:'Test Customer',phone:'0000000000',balance:0}],orders:[{id:'o1',customerId:'c1',customerName:'Test Customer',createdBy:'u-sales-1',items:[],total:100,status:'Pending',createdAt:'2026-01-01T00:00:00.000Z',updatedAt:'2026-01-01T00:00:00.000Z',stockReserved:false},{id:'o2',customerId:'c1',customerName:'Test Customer',createdBy:'u-sales-2',items:[],total:200,status:'Pending',createdAt:'2026-01-02T00:00:00.000Z',updatedAt:'2026-01-02T00:00:00.000Z',stockReserved:false}],invoices:[{id:'i1',number:'INV-TEST-1',customerName:'Test Customer',total:100,paid:0,status:'Due',createdAt:'2026-01-01T00:00:00.000Z'}],settings:{businessName:'Test Business',currency:'INR',stockPolicy,taxEnabled:false},audit:[],inventoryMovements:[]});
class MemoryRepository implements Repository{kind='json' as const;constructor(private state:Store){}async load(){return structuredClone(this.state);}async save(state:Store){this.state=structuredClone(state);}async close(){} }

let httpServer:Server;let baseUrl='';let appModule:typeof import('./server.js');
async function request(path:string,init:RequestInit={}){const response=await fetch(`${baseUrl}${path}`,{...init,headers:{'Content-Type':'application/json',...(init.headers||{})}});const text=await response.text();return {status:response.status,body:text?JSON.parse(text):null};}
async function login(role:Role){const email=role==='owner'?'owner@test.local':role==='accounts'?'accounts@test.local':'sales1@test.local';const result=await request('/api/auth/login',{method:'POST',body:JSON.stringify({email,password:passwordByRole[role]})});expect(result.status).toBe(200);return result.body.token as string;}

beforeAll(async()=>{appModule=await import('./server.js');appModule.installTestState(makeStore(),new MemoryRepository(makeStore()));await new Promise<void>(resolve=>{httpServer=createServer(appModule.app);httpServer.listen(0,'127.0.0.1',()=>{const address=httpServer.address();if(!address||typeof address==='string')throw new Error('Test server did not bind');baseUrl=`http://127.0.0.1:${address.port}`;resolve();});});});
afterAll(async()=>{await new Promise<void>(resolve=>httpServer.close(()=>resolve()));});

describe('API authentication and authorization',()=>{
  it('provisions development roles without affecting production behavior',()=>{const state=makeStore();state.users=state.users.filter(candidate=>candidate.role==='owner');expect(ensureDevelopmentUsers(state)).toBe(true);expect(state.users.filter(candidate=>candidate.email==='accounts@example.com')).toHaveLength(1);expect(state.users.filter(candidate=>candidate.email==='salesperson@example.com')).toHaveLength(1);expect(ensureDevelopmentUsers(state)).toBe(false);});
  it('rejects missing, malformed, and expired authentication',async()=>{expect((await request('/api/dashboard')).status).toBe(401);expect((await request('/api/dashboard',{headers:{Authorization:'Bearer not-a-jwt'}})).status).toBe(401);const expired=jwt.sign({id:'u-owner',name:'Owner',email:'owner@test.local',role:'owner'},process.env.JWT_SECRET!,{expiresIn:-1});expect((await request('/api/dashboard',{headers:{Authorization:`Bearer ${expired}`}})).status).toBe(401);});
  it('allows owner and accounts dashboard access but denies salesman financial access',async()=>{const owner=await login('owner');const accounts=await login('accounts');const salesman=await login('salesman');expect((await request('/api/dashboard',{headers:{Authorization:`Bearer ${owner}`}})).status).toBe(200);expect((await request('/api/dashboard',{headers:{Authorization:`Bearer ${accounts}`}})).status).toBe(200);expect((await request('/api/dashboard',{headers:{Authorization:`Bearer ${salesman}`}})).status).toBe(403);});
  it('restricts salesman orders to the authenticated salesman',async()=>{const salesman=await login('salesman');const result=await request('/api/orders',{headers:{Authorization:`Bearer ${salesman}`}});expect(result.status).toBe(200);expect(result.body).toHaveLength(1);expect(result.body[0].id).toBe('o1');});
  it('denies salesman access to financial, settings, audit, approval, movement, and customer-directory endpoints',async()=>{const salesman=await login('salesman');const headers={Authorization:`Bearer ${salesman}`};expect((await request('/api/invoices',{headers})).status).toBe(403);expect((await request('/api/settings',{headers})).status).toBe(403);expect((await request('/api/audit',{headers})).status).toBe(403);expect((await request('/api/inventory/movements',{headers})).status).toBe(403);expect((await request('/api/customers',{headers})).status).toBe(403);expect((await request('/api/orders/o1/status',{method:'PATCH',headers,body:JSON.stringify({status:'Approved'})})).status).toBe(403);});
  it('keeps settings mutation owner-only and permits salesman catalog access',async()=>{const accounts=await login('accounts');const salesman=await login('salesman');const owner=await login('owner');const settings={businessName:'Test Business',currency:'INR',stockPolicy:'approval',taxEnabled:false};expect((await request('/api/settings',{method:'PATCH',headers:{Authorization:`Bearer ${accounts}`},body:JSON.stringify(settings)})).status).toBe(403);expect((await request('/api/products',{headers:{Authorization:`Bearer ${salesman}`}})).status).toBe(200);expect((await request('/api/settings',{method:'PATCH',headers:{Authorization:`Bearer ${owner}`},body:JSON.stringify(settings)})).status).toBe(200);});
});

describe('isolated order and inventory workflows',()=>{
  it('returns controlled JSON errors for invalid credentials and invalid order quantities',async()=>{
    const invalidLogin=await request('/api/auth/login',{method:'POST',body:JSON.stringify({email:'sales1@test.local',password:'wrong-password'})});
    expect(invalidLogin.status).toBe(401);
    expect(invalidLogin.body).toEqual({error:'Incorrect email or password'});
    const sales=await login('salesman');
    const invalidOrder=await request('/api/orders',{method:'POST',headers:{Authorization:`Bearer ${sales}`},body:JSON.stringify({customerId:'c1',items:[{productId:'p1',qty:0}]})});
    expect(invalidOrder.status).toBe(400);
  });

  it('returns the same order for an exact idempotent retry and rejects payload reuse',async()=>{
    const state=makeStore();appModule.installTestState(state,new MemoryRepository(state));
    const sales=await login('salesman');
    const body={customerId:'c1',items:[{productId:'p1',qty:1}]};
    const headers={Authorization:`Bearer ${sales}`,'Idempotency-Key':'workflow-key-1'};
    const first=await request('/api/orders',{method:'POST',headers,body:JSON.stringify(body)});
    const retry=await request('/api/orders',{method:'POST',headers,body:JSON.stringify(body)});
    expect(first.status).toBe(201);expect(retry.status).toBe(200);
    expect((retry.body as {id:string}).id).toBe((first.body as {id:string}).id);
    const changed=await request('/api/orders',{method:'POST',headers,body:JSON.stringify({customerId:'c1',items:[{productId:'p1',qty:2}]})});
    expect(changed.status).toBe(409);
  });

  it('reserves on submission and releases the reservation exactly once on rejection',async()=>{
    const state=makeStore('submission',2);appModule.installTestState(state,new MemoryRepository(state));
    const sales=await login('salesman');const accounts=await login('accounts');
    const created=await request('/api/orders',{method:'POST',headers:{Authorization:`Bearer ${sales}`,'Idempotency-Key':'submission-key'},body:JSON.stringify({customerId:'c1',items:[{productId:'p1',qty:1}]})});
    const orderId=(created.body as {id:string}).id;expect(created.status).toBe(201);
    const reservedProducts=await request('/api/products',{headers:{Authorization:`Bearer ${sales}`}});
    expect((reservedProducts.body as Array<{available:number}>)[0].available).toBe(1);
    const rejected=await request(`/api/orders/${orderId}/status`,{method:'PATCH',headers:{Authorization:`Bearer ${accounts}`},body:JSON.stringify({status:'Rejected',reason:'Test rejection'})});
    expect(rejected.status).toBe(200);
    const after=await request('/api/products',{headers:{Authorization:`Bearer ${sales}`}});
    expect((after.body as Array<{available:number}>)[0].available).toBe(2);
    const repeated=await request(`/api/orders/${orderId}/status`,{method:'PATCH',headers:{Authorization:`Bearer ${accounts}`},body:JSON.stringify({status:'Rejected',reason:'Test rejection'})});
    expect(repeated.status).toBe(409);
  });

  it('prevents approval oversell when two pending orders compete for the last unit',async()=>{
    const state=makeStore('approval',1);appModule.installTestState(state,new MemoryRepository(state));
    const sales=await login('salesman');const accounts=await login('accounts');
    const first=await request('/api/orders',{method:'POST',headers:{Authorization:`Bearer ${sales}`,'Idempotency-Key':'approval-key-1'},body:JSON.stringify({customerId:'c1',items:[{productId:'p1',qty:1}]})});
    const second=await request('/api/orders',{method:'POST',headers:{Authorization:`Bearer ${sales}`,'Idempotency-Key':'approval-key-2'},body:JSON.stringify({customerId:'c1',items:[{productId:'p1',qty:1}]})});
    expect(first.status).toBe(201);expect(second.status).toBe(201);
    const approved=await request(`/api/orders/${(first.body as {id:string}).id}/status`,{method:'PATCH',headers:{Authorization:`Bearer ${accounts}`},body:JSON.stringify({status:'Approved'})});
    const rejected=await request(`/api/orders/${(second.body as {id:string}).id}/status`,{method:'PATCH',headers:{Authorization:`Bearer ${accounts}`},body:JSON.stringify({status:'Approved'})});
    expect(approved.status).toBe(200);expect(rejected.status).toBe(409);
    const products=await request('/api/products',{headers:{Authorization:`Bearer ${accounts}`}});
    expect((products.body as Array<{stock:number;reservedStock:number;available:number}>)[0]).toMatchObject({stock:1,reservedStock:1,available:0});
  });

  it('serializes concurrent approval requests so only one can reserve the last unit',async()=>{
    const state=makeStore('approval',1);appModule.installTestState(state,new MemoryRepository(state));
    const sales=await login('salesman');const accounts=await login('accounts');
    const requestOrder=(key:string)=>request('/api/orders',{method:'POST',headers:{Authorization:`Bearer ${sales}`,'Idempotency-Key':key},body:JSON.stringify({customerId:'c1',items:[{productId:'p1',qty:1}]})});
    const [first,second]=await Promise.all([requestOrder('concurrent-key-1'),requestOrder('concurrent-key-2')]);
    const ids=[first,second].map(result=>(result.body as {id:string}).id);
    const results=await Promise.all(ids.map(id=>request(`/api/orders/${id}/status`,{method:'PATCH',headers:{Authorization:`Bearer ${accounts}`},body:JSON.stringify({status:'Approved'})})));
    expect(results.filter(result=>result.status===200)).toHaveLength(1);
    expect(results.filter(result=>result.status===409)).toHaveLength(1);
  });

  it('finalizes dispatch once and rejects repeated transitions',async()=>{
    const state=makeStore('dispatch',1);appModule.installTestState(state,new MemoryRepository(state));
    const sales=await login('salesman');const accounts=await login('accounts');
    const created=await request('/api/orders',{method:'POST',headers:{Authorization:`Bearer ${sales}`,'Idempotency-Key':'dispatch-key'},body:JSON.stringify({customerId:'c1',items:[{productId:'p1',qty:1}]})});
    const orderId=(created.body as {id:string}).id;
    expect((await request(`/api/orders/${orderId}/status`,{method:'PATCH',headers:{Authorization:`Bearer ${accounts}`},body:JSON.stringify({status:'Approved'})})).status).toBe(200);
    expect((await request(`/api/orders/${orderId}/status`,{method:'PATCH',headers:{Authorization:`Bearer ${accounts}`},body:JSON.stringify({status:'Dispatched'})})).status).toBe(200);
    expect((await request(`/api/orders/${orderId}/status`,{method:'PATCH',headers:{Authorization:`Bearer ${accounts}`},body:JSON.stringify({status:'Dispatched'})})).status).toBe(409);
    const products=await request('/api/products',{headers:{Authorization:`Bearer ${accounts}`}});
    expect((products.body as Array<{stock:number;reservedStock:number;available:number}>)[0]).toMatchObject({stock:0,reservedStock:0,available:0});
    const movements=await request('/api/inventory/movements?productId=p1',{headers:{Authorization:`Bearer ${accounts}`}});
    expect((movements.body as Array<{type:string}>).filter(m=>m.type==='sale')).toHaveLength(1);
  });
});
