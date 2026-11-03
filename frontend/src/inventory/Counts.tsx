import React, {useEffect, useState} from 'react';
import {StoredFile, dateTime, get, label, qty, send} from './api';
import {Button, Card, Chip, Confirm, Dialog, ErrorBox, Field, Input, Loading, Pager, Segment, Select, Table, TextArea, useAction, useLoad, useToast} from './ui';
import {useCan} from './InventoryPage';
import {ItemPicker, useCategories, useItemOptions} from './Items';

const CNT_TONE: Record<string, any> = {IN_PROGRESS: 'blue', SUBMITTED: 'amber', POSTED: 'green', REJECTED: 'red', PENDING: 'amber'};
export function StockCount({initialSub}: {initialSub?: string}) {
  const [sub, setSub] = useState(initialSub === 'adjustments' ? 'adjustments' : 'counts');
  return <><div className="inv-subtabs"><Segment value={sub} onChange={setSub} options={[['counts', 'Physical counts'], ['adjustments', 'Stock adjustments']]} /></div>{sub === 'counts' ? <Counts /> : <Adjustments />}</>;
}

function Counts() {
  const can = useCan();
  const [status, setStatus] = useState(''), [page, setPage] = useState(1), [create, setCreate] = useState(false), [open, setOpen] = useState<string | null>(null);
  const list = useLoad(() => get<any>('/api/inventory/stock-counts', {status, page, limit: 20}), [status, page]);
  return <Card title="Physical stock counts" aside={can('count.manage') && <Button onClick={() => setCreate(true)}>+ New count</Button>}>
    <div className="inv-note">A count snapshots the system quantity. Counters enter what is physically there; every difference needs a reason; nothing changes until an approver posts it. If stock moves while counting, those items must be recounted.</div>
    <div className="inv-filters"><Select value={status} onChange={e => { setStatus(e.target.value); setPage(1); }} placeholder="Any status" options={[['IN_PROGRESS', 'Counting'], ['SUBMITTED', 'Waiting approval'], ['POSTED', 'Posted'], ['REJECTED', 'Rejected']]} /></div>
    <ErrorBox error={list.error} retry={list.reload} />
    {!list.data ? <Loading /> : <><Table headers={['Count', 'Started', 'Scope', 'Blind', 'Assigned to', 'Started by', 'Approved by', 'Status', '']} empty="No counts yet.">{list.data.items.map((c: any) => <tr key={c._id}><td className="inv-mono">{c.number}</td><td>{dateTime(c.createdAt)}</td><td>{label(c.scope)}{c.scopeValue ? <small>{c.scopeValue}</small> : null}</td><td>{c.blind ? 'Yes' : 'No'}</td><td>{c.assignedTo || '—'}</td><td>{c.createdBy?.name}</td><td>{c.approvedBy?.name || '—'}</td><td><Chip tone={CNT_TONE[c.status]}>{label(c.status)}</Chip></td><td><Button small variant="ghost" onClick={() => setOpen(c._id)}>{c.status === 'IN_PROGRESS' ? 'Count' : 'Open'}</Button></td></tr>)}</Table><Pager page={page} total={list.data.total} limit={20} onPage={setPage} /></>}
    {create && <NewCountDialog onClose={() => setCreate(false)} onSaved={id => { setCreate(false); void list.reload(); if (id) setOpen(id); }} />}
    {open && <CountSheet id={open} onClose={() => setOpen(null)} onChanged={() => void list.reload()} />}
  </Card>;
}

export function NewCountDialog({onClose, onSaved}: {onClose: () => void; onSaved: (id?: string) => void}) {
  const toast = useToast(); const cats = useCategories(); const items = useItemOptions(); const {busy, run} = useAction();
  const [f, setF] = useState({scope: 'CATEGORY', scopeValue: '', blind: true, includeFinishedGoods: false, assignedTo: '', notes: ''});
  const [picked, setPicked] = useState<string[]>([]), [pick, setPick] = useState('');
  const locations = [...new Set((items.data || []).map((i: any) => i.location).filter(Boolean))] as string[];
  const save = async () => {
    if ((f.scope === 'CATEGORY' || f.scope === 'LOCATION') && !f.scopeValue) return toast('err', `Choose a ${f.scope.toLowerCase()}`);
    if (f.scope === 'ITEMS' && !picked.length) return toast('err', 'Add at least one item');
    const r: any = await run(() => send('POST', '/api/inventory/stock-counts', {...f, itemIds: picked}), 'Count started');
    if (r) onSaved(r.id);
  };
  return <Dialog title="Count stock" onClose={onClose} busy={busy} footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button><Button onClick={save} disabled={busy}>Start count</Button></>}>
    <div className="inv-form">
      <Field label="What to count" wide><Segment value={f.scope} onChange={v => setF({...f, scope: v, scopeValue: ''})} options={[['CATEGORY', 'A category'], ['LOCATION', 'A location'], ['ITEMS', 'Selected items'], ['FULL', 'Everything']]} /></Field>
      {f.scope === 'CATEGORY' && <Field label="Category" wide><Select value={f.scopeValue} onChange={e => setF({...f, scopeValue: e.target.value})} placeholder="Choose…" options={(cats.data || []).map(c => [c._id, `${c.name} (${label(c.itemType)})`])} /></Field>}
      {f.scope === 'LOCATION' && <Field label="Location" wide>{locations.length ? <Select value={f.scopeValue} onChange={e => setF({...f, scopeValue: e.target.value})} placeholder="Choose…" options={locations.map(l => [l, l])} /> : <small>No storage locations are set on items yet.</small>}</Field>}
      {f.scope === 'ITEMS' && <div className="inv-field wide"><span>Items</span><div className="inv-actions"><div style={{flex: 1}}><ItemPicker items={items.data || []} value={pick} onChange={setPick} /></div><Button small variant="ghost" disabled={!pick} onClick={() => { if (!picked.includes(pick)) setPicked([...picked, pick]); setPick(''); }}>Add</Button></div><div className="inv-actions" style={{marginTop: 6}}>{picked.map(id => <span key={id} className="inv-chip violet">{items.data?.find((i: any) => i._id === id)?.name}<button type="button" style={{background: 'none', border: 0, color: 'inherit', cursor: 'pointer'}} onClick={() => setPicked(picked.filter(x => x !== id))}>×</button></span>)}</div></div>}
      <label className="inv-check"><input type="checkbox" checked={f.blind} onChange={e => setF({...f, blind: e.target.checked})} /> Blind count (counters don't see system quantity)</label>
      <label className="inv-check"><input type="checkbox" checked={f.includeFinishedGoods} onChange={e => setF({...f, includeFinishedGoods: e.target.checked})} /> Include finished almirahs</label>
      <Field label="Assigned to"><Input value={f.assignedTo} onChange={e => setF({...f, assignedTo: e.target.value})} /></Field>
      <Field label="Notes"><Input value={f.notes} onChange={e => setF({...f, notes: e.target.value})} /></Field>
    </div>
  </Dialog>;
}

function CountSheet({id, onClose, onChanged}: {id: string; onClose: () => void; onChanged: () => void}) {
  const can = useCan(); const d = useLoad(() => get<any>(`/api/inventory/stock-counts/${id}`), [id]); const {busy, run} = useAction();
  const [vals, setVals] = useState<Record<string, {qty: string; reason: string}>>({}), [reject, setReject] = useState(false);
  const c = d.data;
  useEffect(() => { if (c) setVals(Object.fromEntries(c.lines.map((l: any) => [l.itemId, {qty: l.countedM == null ? '' : String(l.countedM / 1000), reason: l.reason || ''}]))); }, [c?._id, c?.status]);
  const editable = c?.status === 'IN_PROGRESS' && can('count.manage');
  const saveLines = () => run(() => send('PUT', `/api/inventory/stock-counts/${id}/lines`, {lines: c.lines.map((l: any) => ({itemId: l.itemId, countedQty: vals[l.itemId]?.qty === '' ? null : Number(vals[l.itemId]?.qty), reason: vals[l.itemId]?.reason || ''}))}), 'Progress saved');
  const variance = (l: any) => { const v = vals[l.itemId]?.qty; return v === '' || v == null || l.systemM == null ? null : Math.round(Number(v) * 1000) - l.systemM; };
  return <Dialog title={c ? `Stock count ${c.number}` : 'Stock count'} onClose={onClose} wide busy={busy} footer={c && <>
    {editable && <><Button variant="ghost" disabled={busy} onClick={saveLines}>Save progress</Button><Button disabled={busy} onClick={async () => { if (await saveLines() && await run(() => send('POST', `/api/inventory/stock-counts/${id}/submit`), 'Submitted for approval')) { void d.reload(); onChanged(); } }}>Submit for approval</Button></>}
    {['SUBMITTED', 'IN_PROGRESS'].includes(c.status) && can('count.approve') && <Button variant="danger" onClick={() => setReject(true)}>Reject</Button>}
    {c.status === 'SUBMITTED' && can('count.approve') && <Button variant="success" disabled={busy} onClick={async () => { if (await run(() => send('POST', `/api/inventory/stock-counts/${id}/approve`), 'Count approved — differences posted to stock')) { void d.reload(); onChanged(); } }}>Approve & post differences</Button>}
  </>}>
    <ErrorBox error={d.error} retry={d.reload} />
    {!c ? <Loading /> : <>
      <div className="inv-actions" style={{marginBottom: 10}}><Chip tone={CNT_TONE[c.status]}>{label(c.status)}</Chip><small>{label(c.scope)}{c.blind ? ' · blind count' : ''} · started by {c.createdBy?.name} {dateTime(c.createdAt)}{c.assignedTo ? ` · counter ${c.assignedTo}` : ''}</small></div>
      {c.rejectReason && <div className="inv-note warn">Rejected: {c.rejectReason}</div>}
      <Table headers={['Item', 'Location', <span className="num">System</span>, 'Physical count', <span className="num">Difference</span>, 'Reason for difference']}>
        {c.lines.map((l: any) => { const v = variance(l); return <tr key={l.itemId}><td><strong>{l.itemName}</strong><small className="inv-mono">{l.itemCode}</small></td><td>{l.location || '—'}</td><td className="num">{l.systemM == null ? <small>hidden</small> : qty(l.systemM, l.unit)}</td>
          <td>{editable ? <Input type="number" min="0" step="any" style={{width: 110}} value={vals[l.itemId]?.qty ?? ''} onChange={e => setVals({...vals, [l.itemId]: {...vals[l.itemId], qty: e.target.value}})} aria-label={`Count for ${l.itemName}`} /> : qty(l.countedM, l.unit)}</td>
          <td className="num">{v == null ? '—' : v === 0 ? <Chip tone="green">0</Chip> : <Chip tone={v < 0 ? 'red' : 'amber'}>{v > 0 ? '+' : ''}{qty(v)}</Chip>}</td>
          <td>{editable ? <Input value={vals[l.itemId]?.reason ?? ''} placeholder={v ? 'Required' : ''} onChange={e => setVals({...vals, [l.itemId]: {...vals[l.itemId], reason: e.target.value}})} /> : l.reason || '—'}</td></tr>; })}
      </Table>
    </>}
    {reject && <Confirm title="Reject count" danger needReason="Reason" confirmLabel="Reject" message="No stock changes. Start a fresh count if needed." onClose={() => setReject(false)} onConfirm={async reason => { if (await run(() => send('POST', `/api/inventory/stock-counts/${id}/reject`, {reason}), 'Count rejected')) { void d.reload(); onChanged(); } setReject(false); }} />}
  </Dialog>;
}

const ADJ_TYPES: Array<[string, string, 'IN' | 'OUT' | null]> = [['INCREASE', 'Increase', 'IN'], ['FOUND', 'Found stock', 'IN'], ['DECREASE', 'Decrease', 'OUT'], ['DAMAGED', 'Damaged stock', 'OUT'], ['MISSING', 'Missing stock', 'OUT'], ['OPENING_CORRECTION', 'Opening correction', null], ['DATA_CORRECTION', 'Data correction', null], ['OTHER', 'Other', null]];
export function AdjustmentForm({item, onClose, onSaved}: {item?: {kind: 'ITEM' | 'PRODUCT'; id: string; name: string; unit: string; availableM: number}; onClose: () => void; onSaved: () => void}) {
  const toast = useToast(); const {busy, run} = useAction(); const items = useItemOptions();
  const [f, setF] = useState({itemId: item?.id || '', type: 'DECREASE', direction: 'OUT' as 'IN' | 'OUT', qty: '', cost: '', reason: ''});
  const [file, setFile] = useState<StoredFile | null>(null);
  const t = ADJ_TYPES.find(x => x[0] === f.type)!;
  const dir = t[2] || f.direction;
  const cur = item || (items.data || []).map((i: any) => ({kind: 'ITEM' as const, id: i._id, name: i.name, unit: i.stockUnit, availableM: i.availableM})).find((i: any) => i.id === f.itemId);
  const newM = cur && Number(f.qty) > 0 ? cur.availableM + (dir === 'IN' ? 1 : -1) * Math.round(Number(f.qty) * 1000) : null;
  const save = async () => {
    if (!cur || !(Number(f.qty) > 0) || f.reason.trim().length < 3) return toast('err', 'Choose the item, quantity and a reason');
    const r: any = await run(() => send('POST', '/api/inventory/adjustments', {type: f.type, itemKind: cur.kind, itemId: cur.id, qty: Number(f.qty), direction: dir, unitCostRupees: f.cost === '' ? null : Number(f.cost), reason: f.reason, attachment: file}));
    if (r) { toast('ok', r.status === 'POSTED' ? 'Adjustment posted to stock' : 'Adjustment submitted for Admin approval — stock unchanged until approved'); onSaved(); }
  };
  return <Dialog title="Stock adjustment" onClose={onClose} busy={busy} footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button><Button onClick={save} disabled={busy}>Submit</Button></>}>
    <div className="inv-form">
      {!item && <Field label="Item *" wide><ItemPicker items={items.data || []} value={f.itemId} onChange={id => setF({...f, itemId: id})} /></Field>}
      {item && <Field label="Item" wide><b>{item.name}</b></Field>}
      <Field label="Type *"><Select value={f.type} onChange={e => setF({...f, type: e.target.value})} options={ADJ_TYPES.map(([v, l]) => [v, l])} /></Field>
      {!t[2] && <Field label="Direction"><Segment value={f.direction} onChange={v => setF({...f, direction: v})} options={[['IN', 'Increase'], ['OUT', 'Decrease']]} /></Field>}
      <Field label={`Quantity *${cur ? ` (${cur.unit})` : ''}`} hint={cur ? `Current available ${qty(cur.availableM)} → new ${newM == null ? '—' : qty(newM)}` : undefined}><Input type="number" min="0" step="any" value={f.qty} onChange={e => setF({...f, qty: e.target.value})} /></Field>
      {dir === 'IN' && <Field label="Unit cost (₹)" hint="Leave blank to use the current average cost"><Input type="number" min="0" step="any" value={f.cost} onChange={e => setF({...f, cost: e.target.value})} /></Field>}
      <Field label="Reason *" wide><TextArea value={f.reason} onChange={e => setF({...f, reason: e.target.value})} maxLength={500} /></Field>
      <div className="inv-field wide"><span>Supporting document</span><label className="inv-btn ghost sm" style={{alignSelf: 'flex-start'}}>{file ? `📎 ${file.name}` : '+ Attach'}<input type="file" hidden accept="application/pdf,image/*" onChange={async e => { const x = e.target.files?.[0]; if (!x) return; const {upload} = await import('./api'); try { setFile(await upload(x, 'document')); } catch (err: any) { toast('err', err.message); } }} /></label></div>
    </div>
    <small>Missing, damaged and data corrections always need Admin approval. Balances are never overwritten — this posts a ledger movement.</small>
  </Dialog>;
}

function Adjustments() {
  const can = useCan();
  const [status, setStatus] = useState(''), [page, setPage] = useState(1), [form, setForm] = useState(false), [decide, setDecide] = useState<{a: any; action: 'approve' | 'reject'} | null>(null);
  const list = useLoad(() => get<any>('/api/inventory/adjustments', {status, page, limit: 20}), [status, page]);
  const {run} = useAction();
  return <Card title="Stock adjustments" aside={can('adjustment.request') && <Button onClick={() => setForm(true)}>+ New adjustment</Button>}>
    <div className="inv-filters"><Select value={status} onChange={e => { setStatus(e.target.value); setPage(1); }} placeholder="Any status" options={[['PENDING', 'Waiting approval'], ['POSTED', 'Posted'], ['REJECTED', 'Rejected']]} /></div>
    <ErrorBox error={list.error} retry={list.reload} />
    {!list.data ? <Loading /> : <><Table headers={['Number', 'Date', 'Item', 'Type', <span className="num">Before</span>, <span className="num">Change</span>, <span className="num">After</span>, 'Reason', 'Requested / approved', 'Status', '']} empty="No adjustments.">{list.data.items.map((a: any) => <tr key={a._id}><td className="inv-mono">{a.number}</td><td><small>{dateTime(a.createdAt)}</small></td><td>{a.itemName}</td><td>{label(a.type)}</td><td className="num">{qty(a.currentM)}</td><td className="num">{a.adjustM > 0 ? '+' : ''}{qty(a.adjustM)} {a.unit}</td><td className="num">{qty(a.newM)}</td><td>{a.reason}</td><td><small>{a.requestedBy?.name}{a.approvedBy ? ` → ${a.approvedBy.name}` : ''}</small></td><td><Chip tone={CNT_TONE[a.status]}>{label(a.status)}</Chip></td><td>{a.status === 'PENDING' && can('adjustment.approve') && <div className="inv-actions"><Button small variant="ghost" onClick={() => setDecide({a, action: 'reject'})}>Reject</Button><Button small variant="success" onClick={() => setDecide({a, action: 'approve'})}>Approve</Button></div>}</td></tr>)}</Table><Pager page={page} total={list.data.total} limit={20} onPage={setPage} /></>}
    {form && <AdjustmentForm onClose={() => setForm(false)} onSaved={() => { setForm(false); void list.reload(); }} />}
    {decide && <Confirm title={`${decide.action === 'approve' ? 'Approve' : 'Reject'} ${decide.a.number}`} danger={decide.action === 'reject'} needReason={decide.action === 'reject' ? 'Reason' : undefined} confirmLabel={decide.action === 'approve' ? 'Approve & post' : 'Reject'} message={decide.action === 'approve' ? `${decide.a.adjustM > 0 ? 'Adds' : 'Removes'} ${qty(Math.abs(decide.a.adjustM), decide.a.unit)} of ${decide.a.itemName}.` : 'Stock does not change.'} onClose={() => setDecide(null)} onConfirm={async reason => { if (await run(() => send('POST', `/api/inventory/adjustments/${decide.a._id}/${decide.action}`, decide.action === 'reject' ? {reason} : {}), decide.action === 'approve' ? 'Adjustment posted' : 'Adjustment rejected')) void list.reload(); setDecide(null); }} />}
  </Card>;
}
