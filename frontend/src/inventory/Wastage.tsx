import React, {useState} from 'react';
import {StoredFile, dateTime, fileUrl, get, label, qty, rupees, send, shiftDays, todayIso} from './api';
import {Button, Card, Chip, Confirm, Dialog, ErrorBox, Field, ImageUploader, Input, Loading, Pager, Segment, Select, Table, TextArea, useAction, useLoad, useToast} from './ui';
import {useCan} from './InventoryPage';
import {ItemPicker, useCategories, useItemOptions} from './Items';

export const WASTAGE_TYPES: Array<[string, string]> = [['CUTTING_WASTE', 'Cutting waste'], ['DAMAGED_STEEL', 'Damaged steel / sheets'], ['WELDING_WASTE', 'Welding waste'], ['GRINDING_WASTE', 'Grinding waste'], ['PAINT_WASTE', 'Paint / powder waste'], ['DEFECTIVE_COMPONENT', 'Defective component'], ['DAMAGED_FINISHED_PRODUCT', 'Damaged finished product'], ['PACKAGING_DAMAGE', 'Packaging damage'], ['EXPIRED_UNUSABLE', 'Expired / unusable'], ['OTHER', 'Other']];
const typeLabel = (t: string) => WASTAGE_TYPES.find(x => x[0] === t)?.[1] || label(t);

export function Wastage() {
  const can = useCan(); const cats = useCategories();
  const [f, setF] = useState({status: '', wastageType: '', source: '', categoryId: '', from: shiftDays(todayIso(), -89), to: todayIso()}), [page, setPage] = useState(1), [form, setForm] = useState(false), [decide, setDecide] = useState<{w: any; action: 'approve' | 'reject'} | null>(null);
  const list = useLoad(() => get<any>('/api/inventory/wastage', {...f, page, limit: 20}), [JSON.stringify(f), page]);
  const {run} = useAction();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLSelectElement | HTMLInputElement>) => { setF({...f, [k]: e.target.value}); setPage(1); };
  const total = (list.data?.approvedByType || []).reduce((a: number, x: any) => a + x.cost, 0);
  return <>
    {list.data && <div className="inv-tiles five">
      <div className="inv-tile"><span>Approved wastage cost</span><div className="v red">{rupees(total)}</div><small>in selected filters</small></div>
      {(list.data.approvedByType || []).sort((a: any, b: any) => b.cost - a.cost).slice(0, 4).map((x: any) => <div className="inv-tile" key={x._id}><span>{typeLabel(x._id)}</span><div className="v">{rupees(x.cost)}</div><small>{x.count} record(s)</small></div>)}
    </div>}
    <Card title="Wastage records" aside={can('wastage.report') && <Button onClick={() => setForm(true)}>+ Log wastage</Button>}>
      <div className="inv-filters">
        <Select value={f.status} onChange={set('status')} placeholder="Any status" options={[['PENDING', 'Pending approval'], ['APPROVED', 'Approved'], ['REJECTED', 'Rejected']]} />
        <Select value={f.wastageType} onChange={set('wastageType')} placeholder="Any reason" options={WASTAGE_TYPES} />
        <Select value={f.source} onChange={set('source')} placeholder="Store + production" options={[['STORE', 'From store'], ['PRODUCTION', 'During production']]} />
        <Select value={f.categoryId} onChange={set('categoryId')} placeholder="Any category" options={(cats.data || []).map(c => [c._id, c.name])} />
        <Input type="date" value={f.from} max={f.to} onChange={set('from')} aria-label="From" style={{width: 150}} /><Input type="date" value={f.to} min={f.from} onChange={set('to')} aria-label="To" style={{width: 150}} />
      </div>
      <ErrorBox error={list.error} retry={list.reload} />
      {!list.data ? <Loading /> : <><Table headers={['Record', 'Item', <span className="num">Qty</span>, 'Reason', <span className="num">Cost</span>, 'Status', '']} empty="No wastage recorded in this period.">
        {list.data.items.map((w: any) => <tr key={w._id}><td><span className="inv-mono">{w.number}</span><small>{dateTime(w.createdAt)}</small></td><td><strong>{w.itemName}</strong><small>{w.source === 'PRODUCTION' ? <>Production · <span className="inv-mono">{w.productionNumber}</span></> : 'Store'}</small></td><td className="num">{qty(w.qtyM, w.unit)}</td><td>{typeLabel(w.wastageType)}<small>{w.reason}</small>{(w.images || []).map((i: StoredFile) => <a key={i.url} href={fileUrl(i.url)} target="_blank" rel="noreferrer"><img src={fileUrl(i.url)} alt="evidence" width={32} height={32} style={{objectFit: 'cover', borderRadius: 6, marginRight: 3}} /></a>)}</td><td className="num">{w.costPaise == null ? '—' : rupees(w.costPaise)}</td><td><Chip tone={w.status === 'APPROVED' ? 'green' : w.status === 'PENDING' ? 'amber' : 'red'}>{label(w.status)}</Chip><small>{w.reportedBy?.name}{w.approvedBy ? ` → ${w.approvedBy.name}` : ''}</small>{w.rejectReason && <small>{w.rejectReason}</small>}</td>
          <td>{w.status === 'PENDING' && can('wastage.approve') && <div className="inv-actions"><Button small variant="ghost" onClick={() => setDecide({w, action: 'reject'})}>Reject</Button><Button small variant="success" onClick={() => setDecide({w, action: 'approve'})}>Approve</Button></div>}</td></tr>)}
      </Table><Pager page={page} total={list.data.total} limit={20} onPage={setPage} /></>}
    </Card>
    {form && <WastageForm onClose={() => setForm(false)} onSaved={() => { setForm(false); void list.reload(); }} />}
    {decide && <Confirm title={decide.action === 'approve' ? `Approve ${decide.w.number}` : `Reject ${decide.w.number}`} danger={decide.action === 'reject'} confirmLabel={decide.action === 'approve' ? 'Approve' : 'Reject'} needReason={decide.action === 'reject' ? 'Reason for rejecting' : undefined}
      message={decide.action === 'approve' ? (decide.w.source === 'PRODUCTION' ? `${qty(decide.w.qtyM, decide.w.unit)} of ${decide.w.itemName} already issued to ${decide.w.productionNumber} will be recorded as wastage. Stock is not deducted again.` : `${qty(decide.w.qtyM, decide.w.unit)} of ${decide.w.itemName} will be removed from stock at its average cost.`) : 'The record is kept with your reason; stock does not change.'}
      onClose={() => setDecide(null)} onConfirm={async reason => { if (await run(() => send('POST', `/api/inventory/wastage/${decide.w._id}/${decide.action}`, decide.action === 'reject' ? {reason} : {}), decide.action === 'approve' ? 'Wastage approved' : 'Wastage rejected')) void list.reload(); setDecide(null); }} />}
  </>;
}

export function WastageForm({onClose, onSaved}: {onClose: () => void; onSaved: () => void}) {
  const toast = useToast(); const {busy, run} = useAction();
  const items = useItemOptions();
  const products = useLoad(async () => (await get<any>('/api/inventory/products', {limit: 200})).items as any[], []);
  const orders = useLoad(async () => (await get<any>('/api/inventory/productions', {status: 'WIP', limit: 100})).items as any[], []);
  const [kind, setKind] = useState<'ITEM' | 'PRODUCT'>('ITEM');
  const [f, setF] = useState({itemId: '', qty: '', wastageType: 'CUTTING_WASTE', reason: '', notes: '', productionOrderId: ''});
  const [images, setImages] = useState<StoredFile[]>([]);
  const order = orders.data?.find((o: any) => o._id === f.productionOrderId);
  const choices = kind === 'PRODUCT' ? (products.data || []).map((p: any) => ({_id: p.id, name: p.name, code: p.sku, stockUnit: 'pcs', availableM: p.available * 1000})) : order ? order.lines.map((l: any) => ({_id: l.itemId, name: l.itemName, code: l.itemCode, stockUnit: l.unit})) : (items.data || []);
  const cur = choices.find((i: any) => i._id === f.itemId);
  const save = async () => {
    if (!f.itemId || !(Number(f.qty) > 0) || f.reason.trim().length < 2) return toast('err', 'Choose the item, enter a quantity and a reason');
    if (await run(() => send('POST', '/api/inventory/wastage', {itemKind: kind, itemId: f.itemId, qty: Number(f.qty), wastageType: f.wastageType, reason: f.reason, notes: f.notes, productionOrderId: kind === 'ITEM' && f.productionOrderId ? f.productionOrderId : null, images}), 'Wastage submitted for approval — stock changes only after approval')) onSaved();
  };
  return <Dialog title="Log wastage" onClose={onClose} busy={busy} footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button><Button onClick={save} disabled={busy}>Submit for approval</Button></>}>
    <div className="inv-form">
      <Field label="What was wasted" wide><Segment value={kind} onChange={v => { setKind(v); setF({...f, itemId: '', productionOrderId: '', wastageType: v === 'PRODUCT' ? 'DAMAGED_FINISHED_PRODUCT' : f.wastageType}); }} options={[['ITEM', 'Raw material / accessory'], ['PRODUCT', 'Finished almirah']]} /></Field>
      {kind === 'ITEM' && <Field label="During production order (optional)" wide hint="Choose this when the material was already issued to production — it is then not deducted from stock again"><Select value={f.productionOrderId} onChange={e => setF({...f, productionOrderId: e.target.value, itemId: ''})} placeholder="— Not linked: wasted in the store —" options={(orders.data || []).map((o: any) => [o._id, `${o.number} · ${o.productName}`])} /></Field>}
      <Field label="Item *" wide><ItemPicker items={choices} value={f.itemId} onChange={id => setF({...f, itemId: id})} /></Field>
      <Field label={`Quantity *${cur ? ` (${cur.stockUnit})` : ''}`} hint={cur?.availableM !== undefined ? `${qty(cur.availableM)} available` : order && cur ? (() => { const l = order.lines.find((x: any) => x.itemId === cur._id); return l ? `${qty(l.issuedM - l.returnedM - l.wastedM - l.consumedM)} issued and unaccounted` : ''; })() : undefined}><Input type="number" min="0" step="any" value={f.qty} onChange={e => setF({...f, qty: e.target.value})} /></Field>
      <Field label="Wastage type *"><Select value={f.wastageType} onChange={e => setF({...f, wastageType: e.target.value})} options={WASTAGE_TYPES} /></Field>
      <Field label="Reason *" wide><Input value={f.reason} onChange={e => setF({...f, reason: e.target.value})} maxLength={300} placeholder="e.g. Sheet bent during loading" /></Field>
      <Field label="Notes" wide><TextArea value={f.notes} onChange={e => setF({...f, notes: e.target.value})} /></Field>
      <div className="inv-field wide"><span>Supporting photos</span><ImageUploader files={images} onChange={setImages} purpose="wastage" max={6} /></div>
    </div>
  </Dialog>;
}
