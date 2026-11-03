// Called inside the legacy commit transaction: turns what the legacy order code changed into
// (1) unified stock-ledger rows for finished goods and (2) append-only business activity events.
// This keeps the proven legacy order/stock logic untouched while making History and activity complete.
import type mongoose from 'mongoose';
import type {Store} from '../types.js';
import {Inv} from '../inventory/models.js';
import {Sales} from './models.js';

const MOVE_TYPE: Record<string, string> = {opening: 'OPENING', purchase_receipt: 'PURCHASE_RECEIPT', reservation: 'RESERVATION', reservation_release: 'RESERVATION_RELEASE', sale: 'SALES_DISPATCH', return: 'SALES_RETURN'};

async function nextTxn(session?: mongoose.ClientSession) {
  const c: any = await Inv.Counter.findOneAndUpdate({_id: 'TXN'}, {$inc: {seq: 1}}, {upsert: true, returnDocument: 'after', session});
  return `TXN-${String(c.seq).padStart(6, '0')}`;
}

export async function mirrorLegacyChanges(session: mongoose.ClientSession | undefined, before: Store, after: Store) {
  const users = new Map(after.users.map(u => [u.id, u]));
  const byEmail = new Map(after.users.filter(u => u.email).map(u => [u.email!.toLowerCase(), u]));

  // ---- finished-goods ledger rows for new legacy movements ----
  const oldMoves = new Set(before.inventoryMovements.map(m => m.id));
  const newMoves = after.inventoryMovements.filter(m => !oldMoves.has(m.id));
  for (const m of newMoves.reverse()) {
    const p = after.products.find(x => x.id === m.productId);
    const prof: any = await Inv.ProductProfile.findOne({productId: m.productId}).session(session ?? null).lean();
    const dOn = (m.afterOnHand - m.beforeOnHand) * 1000;
    const type = MOVE_TYPE[m.type] ?? (dOn >= 0 ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT');
    const cost = prof?.avgCostPaise ?? null;
    const actorUser = byEmail.get(String(m.actor || '').toLowerCase());
    await Inv.Ledger.create([{
      txnNo: await nextTxn(session), itemKind: 'PRODUCT', itemId: m.productId, itemCode: p?.sku, itemName: p?.name, itemType: 'FINISHED_GOOD', categoryId: p?.category, unit: p?.unit || 'pcs',
      type, qtyInM: Math.max(0, dOn), qtyOutM: Math.max(0, -dOn), prevM: m.beforeOnHand * 1000, newM: m.afterOnHand * 1000, prevReservedM: m.beforeReserved * 1000, newReservedM: m.afterReserved * 1000,
      unitCostPaise: dOn ? cost : null, valuePaise: dOn ? (cost == null ? null : Math.round(Math.abs(dOn) / 1000 * cost)) : 0, avgBeforePaise: cost, avgAfterPaise: cost,
      refType: m.sourceId?.startsWith('ord_') ? 'ORDER' : 'PRODUCT', refId: m.sourceId || m.productId, refNumber: m.sourceId ? m.sourceId.slice(-10) : p?.sku,
      reason: m.reason || (type === 'SALES_DISPATCH' ? 'Order dispatched' : type === 'RESERVATION' ? 'Reserved for order' : type === 'RESERVATION_RELEASE' ? 'Order reservation released' : 'Opening stock'),
      performedBy: {id: actorUser?.id || '', name: actorUser?.name || m.actor, role: actorUser?.role || ''}, idempotencyKey: `LEGACY:${m.id}`,
    }], {session});
  }

  // ---- activity events ----
  const events: any[] = [];
  const oldOrders = new Map(before.orders.map(o => [o.id, o]));
  for (const o of after.orders) {
    const prev = oldOrders.get(o.id);
    const salesman = o.createdBy ? users.get(o.createdBy) : undefined;
    const base = {salesmanId: salesman?.role === 'salesman' ? salesman.id : undefined, salesmanName: salesman?.role === 'salesman' ? salesman.name : undefined, customerId: o.customerId, customerName: o.customerName, orderId: o.id, amountPaise: Math.round(o.total * 100), status: o.status};
    if (!prev) events.push({...base, at: new Date(o.createdAt), type: 'ORDER_SUBMITTED', actor: {id: salesman?.id, name: salesman?.name, role: salesman?.role}, description: `Order submitted for ${o.customerName} (${o.items.length} line(s))`, key: `ORDER_SUBMITTED:${o.id}`});
    else if (prev.status !== o.status) {
      const by = o.statusBy ? byEmail.get(o.statusBy.toLowerCase()) : undefined;
      events.push({...base, at: new Date(o.updatedAt), type: `ORDER_${o.status.toUpperCase()}`, actor: {id: by?.id, name: by?.name || o.statusBy, role: by?.role}, description: `Order ${o.status.toLowerCase()}${o.reason ? `: ${o.reason}` : ''}`, key: `ORDER_${o.status.toUpperCase()}:${o.id}:${o.updatedAt}`});
    }
  }
  const oldCustomers = new Set(before.customers.map(c => c.id));
  for (const c of after.customers.filter(x => !oldCustomers.has(x.id) && x.createdBy)) {
    const s = users.get(c.createdBy!);
    events.push({at: new Date(), type: 'CUSTOMER_CREATED', salesmanId: s?.id, salesmanName: s?.name, actor: {id: s?.id, name: s?.name, role: s?.role}, customerId: c.id, customerName: c.name, description: `New customer ${c.name}`, key: `CUSTOMER_CREATED:${c.id}`});
  }
  const oldInvoices = new Set(before.invoices.map(i => i.id));
  for (const inv of after.invoices.filter(x => !oldInvoices.has(x.id))) {
    const o = after.orders.find(x => x.id === inv.id); const s = o?.createdBy ? users.get(o.createdBy) : undefined;
    events.push({at: new Date(inv.createdAt), type: 'INVOICE_CREATED', salesmanId: s?.role === 'salesman' ? s.id : undefined, salesmanName: s?.role === 'salesman' ? s.name : undefined, customerName: inv.customerName, orderId: inv.id, amountPaise: Math.round(inv.total * 100), description: `Invoice ${inv.number} created`, key: `INVOICE_CREATED:${inv.id}`});
  }
  const oldUsers = new Set(before.users.map(u => u.id));
  for (const u of after.users.filter(x => !oldUsers.has(x.id) && x.role === 'salesman')) events.push({at: new Date(), type: 'SALESMAN_CREATED', salesmanId: u.id, salesmanName: u.name, description: `Salesman account created for ${u.name}`, key: `SALESMAN_CREATED:${u.id}`});
  if (events.length) await Sales.Activity.insertMany(events, {session, ordered: true});
}
