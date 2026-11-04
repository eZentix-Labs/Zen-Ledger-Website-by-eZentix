import React, {useState} from 'react';
import {dateTime, day, get, label, qty, rupees, send, todayIso} from './api';
import {Button, Card, Chip, Confirm, Dialog, Empty, ErrorBox, Field, Input, Loading, Meter, Pager, Segment, Select, Table, TextArea, Thumb, useAction, useLoad, useToast} from './ui';
import {useCan} from './InventoryPage';
import {ItemPicker, useItemOptions} from './Items';

const ST_TONE: Record<string, any> = {DRAFT: 'grey', SUBMITTED: 'amber', APPROVED: 'blue', MATERIALS_RESERVED: 'violet', IN_PROGRESS: 'violet', QUALITY_CHECK: 'amber', COMPLETED: 'green', REJECTED: 'red', CANCELLED: 'red', ACTIVE: 'green', PENDING_APPROVAL: 'amber', INACTIVE: 'grey'};
const stChip = (s: string) => <Chip tone={ST_TONE[s] || 'grey'}>{label(s)}</Chip>;
const useProducts = () => useLoad(async () => (await get<any>('/api/inventory/products', {limit: 200})).items as any[], []);

export function Production({sub = 'orders'}: {sub?: string}) {
  return sub === 'bom' ? <Boms /> : <ProductionOrders />;
}

// ---------------- BOM ----------------
function Boms() {
  const can = useCan();
  const [status, setStatus] = useState(''), [form, setForm] = useState<any | null | 'new'>(null), [view, setView] = useState<string | null>(null);
  const list = useLoad(() => get<any[]>('/api/inventory/boms', {status}), [status]);
  return <Card title="Bills of materials" aside={can('bom.manage') && <Button onClick={() => setForm('new')}>+ New BOM</Button>}>
    <div className="inv-note">A BOM lists the raw materials and accessories for one finished almirah. Quantities and costs are entered by you — the catalogues do not contain them. Planned wastage is included once in the requirement and estimated cost.</div>
    <div className="inv-filters"><Select value={status} onChange={e => setStatus(e.target.value)} placeholder="All versions" options={[['ACTIVE', 'Active'], ['PENDING_APPROVAL', 'Waiting approval'], ['DRAFT', 'Draft'], ['INACTIVE', 'Inactive']]} /></div>
    <ErrorBox error={list.error} retry={list.reload} />
    {!list.data ? <Loading /> : <Table headers={['Product', 'Version', 'Materials', <span className="num">Material / unit</span>, <span className="num">Labour + overhead</span>, <span className="num">Estimated / unit</span>, 'Status', '']} empty="No BOMs yet. Create one for each almirah you manufacture.">
      {list.data.map(b => <tr key={b._id}><td><strong>{b.productName}</strong></td><td>v{b.version}</td><td>{b.lines.length}</td><td className="num">{b.cost ? (b.cost.materialPerUnitPaise == null ? <Chip tone="amber">Incomplete</Chip> : rupees(b.cost.materialPerUnitPaise)) : '—'}</td><td className="num">{rupees(b.labourPerUnitPaise + b.overheadPerUnitPaise)}</td><td className="num">{b.cost ? rupees(b.cost.estimatedPerUnitPaise) : '—'}</td><td>{stChip(b.status)}</td><td><Button small variant="ghost" onClick={() => setView(b._id)}>Open</Button></td></tr>)}
    </Table>}
    {form && <BomForm bom={form === 'new' ? undefined : form} onClose={() => setForm(null)} onSaved={() => { setForm(null); void list.reload(); }} />}
    {view && <BomDetail id={view} onClose={() => setView(null)} onChanged={() => void list.reload()} onEdit={(b, copy) => { setView(null); setForm(copy ? {...b, _id: undefined, copy: true} : b); }} />}
  </Card>;
}

export function BomForm({bom, onClose, onSaved}: {bom?: any; onClose: () => void; onSaved: () => void}) {
  const toast = useToast(); const products = useProducts(); const items = useItemOptions();
  const [productId, setProductId] = useState(bom?.productId || '');
  const [lines, setLines] = useState<Array<{itemId: string; qty: string; wastage: string; notes: string}>>(bom ? bom.lines.map((l: any) => ({itemId: l.itemId, qty: String(l.qtyM / 1000), wastage: String((l.wastageBps || 0) / 100), notes: l.notes || ''})) : [{itemId: '', qty: '', wastage: '0', notes: ''}]);
  const [h, setH] = useState({outputQty: String(bom?.outputQty || 1), labour: bom ? String(bom.labourPerUnitPaise / 100) : '0', overhead: bom ? String(bom.overheadPerUnitPaise / 100) : '0', notes: bom?.notes || ''});
  const [other, setOther] = useState<Array<{label: string; rupees: string}>>((bom?.otherCosts || []).map((o: any) => ({label: o.label, rupees: String(o.perUnitPaise / 100)})));
  const {busy, run} = useAction();
  const it = (id: string) => items.data?.find((x: any) => x._id === id);
  const est = lines.reduce((a: number | null, l) => { const i = it(l.itemId); if (a == null || !i) return a; if (i.avgCostPaise == null) return null; return a + Number(l.qty || 0) / Number(h.outputQty || 1) * (1 + Number(l.wastage || 0) / 100) * i.avgCostPaise; }, 0);
  const save = async () => {
    if (!productId) return toast('err', 'Choose the finished product');
    const clean = lines.filter(l => l.itemId);
    if (!clean.length || clean.some(l => !(Number(l.qty) > 0))) return toast('err', 'Add materials with quantities above zero');
    const body = {productId, outputQty: Number(h.outputQty || 1), labourRupees: Number(h.labour || 0), overheadRupees: Number(h.overhead || 0), notes: h.notes, otherCosts: other.filter(o => o.label).map(o => ({label: o.label, rupees: Number(o.rupees || 0)})), lines: clean.map(l => ({itemId: l.itemId, qty: Number(l.qty), wastagePct: Number(l.wastage || 0), notes: l.notes}))};
    const r = await run(() => bom?._id ? send('PUT', `/api/inventory/boms/${bom._id}`, body) : send('POST', '/api/inventory/boms', body), 'BOM saved as draft — submit it for approval');
    if (r) onSaved();
  };
  return <Dialog title={bom?._id ? `Edit BOM v${bom.version}` : bom?.copy ? 'New BOM version' : 'New bill of materials'} onClose={onClose} busy={busy} wide footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button><Button onClick={save} disabled={busy}>Save draft</Button></>}>
    <div className="inv-form four">
      <Field label="Finished product *" wide><Select value={productId} disabled={Boolean(bom)} onChange={e => setProductId(e.target.value)} placeholder="Choose almirah…" options={(products.data || []).map((p: any) => [p.id, `${p.name} (${p.sku})`])} /></Field>
      <Field label="Quantities are for" hint="Number of almirahs this BOM produces"><Input type="number" min="1" step="1" value={h.outputQty} onChange={e => setH({...h, outputQty: e.target.value})} /></Field>
      <Field label="Labour (₹ per almirah)"><Input type="number" min="0" step="any" value={h.labour} onChange={e => setH({...h, labour: e.target.value})} /></Field>
      <Field label="Overhead (₹ per almirah)" hint="Power, gas, consumables not listed"><Input type="number" min="0" step="any" value={h.overhead} onChange={e => setH({...h, overhead: e.target.value})} /></Field>
    </div>
    <h4 style={{margin: '14px 0 8px'}}>Materials & accessories</h4>
    <div className="inv-lines">{lines.map((l, i) => { const x = it(l.itemId); return <div key={i} className="inv-line" style={{gridTemplateColumns: 'minmax(220px,2fr) 120px 110px minmax(120px,1fr) 120px auto'}}>
      <Field label={`Material ${i + 1}`}><ItemPicker items={items.data || []} value={l.itemId} onChange={id => setLines(lines.map((y, j) => j === i ? {...y, itemId: id} : y))} /></Field>
      <Field label={`Qty${x ? ` (${x.stockUnit})` : ''}`}><Input type="number" min="0" step="any" value={l.qty} onChange={e => setLines(lines.map((y, j) => j === i ? {...y, qty: e.target.value} : y))} /></Field>
      <Field label="Wastage %"><Input type="number" min="0" max="100" step="any" value={l.wastage} onChange={e => setLines(lines.map((y, j) => j === i ? {...y, wastage: e.target.value} : y))} /></Field>
      <Field label="Notes"><Input value={l.notes} onChange={e => setLines(lines.map((y, j) => j === i ? {...y, notes: e.target.value} : y))} /></Field>
      <Field label="Cost / unit"><div style={{padding: '9px 0'}}>{!x ? '—' : x.avgCostPaise == null ? <Chip tone="amber">No cost</Chip> : rupees(Math.round(Number(l.qty || 0) / Number(h.outputQty || 1) * (1 + Number(l.wastage || 0) / 100) * x.avgCostPaise))}</div></Field>
      <Button small variant="ghost" aria-label="Remove" disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, j) => j !== i))}>×</Button>
    </div>; })}</div>
    <Button small variant="subtle" onClick={() => setLines([...lines, {itemId: '', qty: '', wastage: '0', notes: ''}])}>+ Add material</Button>
    <div className="inv-field" style={{marginTop: 12}}><span>Other approved costs per almirah</span>{other.map((o, i) => <div key={i} className="inv-actions" style={{marginBottom: 6}}><Input placeholder="e.g. Powder coating job work" value={o.label} onChange={e => setOther(other.map((x, j) => j === i ? {...x, label: e.target.value} : x))} /><Input type="number" min="0" step="any" style={{maxWidth: 130}} value={o.rupees} onChange={e => setOther(other.map((x, j) => j === i ? {...x, rupees: e.target.value} : x))} /><Button small variant="ghost" onClick={() => setOther(other.filter((_, j) => j !== i))}>Remove</Button></div>)}<Button small variant="subtle" onClick={() => setOther([...other, {label: '', rupees: ''}])}>+ Add cost</Button></div>
    <div className="inv-totals"><span>Material cost / almirah</span><span>{est == null ? 'Incomplete — some materials have no cost yet' : rupees(Math.round(est))}</span><span>Labour + overhead + other</span><span>{rupees(Math.round((Number(h.labour || 0) + Number(h.overhead || 0) + other.reduce((a, o) => a + Number(o.rupees || 0), 0)) * 100))}</span><span className="grand">Estimated cost / almirah</span><span className="grand">{est == null ? '—' : rupees(Math.round(est + (Number(h.labour || 0) + Number(h.overhead || 0) + other.reduce((a, o) => a + Number(o.rupees || 0), 0)) * 100))}</span></div>
    <Field label="Notes"><TextArea value={h.notes} onChange={e => setH({...h, notes: e.target.value})} /></Field>
  </Dialog>;
}

export function BomDetail({id, onClose, onChanged, onEdit}: {id: string; onClose: () => void; onChanged: () => void; onEdit: (b: any, copy: boolean) => void}) {
  const can = useCan(); const d = useLoad(() => get<any>(`/api/inventory/boms/${id}`), [id]); const {busy, run} = useAction();
  const b = d.data;
  const act = async (a: string, ok: string) => { if (await run(() => send('POST', `/api/inventory/boms/${id}/${a}`), ok)) { void d.reload(); onChanged(); } };
  return <Dialog title={b ? `${b.productName} · BOM v${b.version}` : 'BOM'} onClose={onClose} wide busy={busy} footer={b && <>
    {b.status === 'DRAFT' && can('bom.manage') && <><Button variant="ghost" onClick={() => onEdit(b, false)}>Edit</Button><Button onClick={() => act('submit', 'Submitted for approval')}>Submit for approval</Button></>}
    {['PENDING_APPROVAL', 'DRAFT', 'INACTIVE'].includes(b.status) && can('production.approve') && <Button variant="success" onClick={() => act('approve', 'BOM approved and active')}>Approve & activate</Button>}
    {b.status === 'ACTIVE' && can('bom.manage') && <><Button variant="ghost" onClick={() => act('deactivate', 'BOM deactivated')}>Deactivate</Button><Button onClick={() => onEdit(b, true)}>Create new version</Button></>}
  </>}>
    <ErrorBox error={d.error} retry={d.reload} />
    {!b ? <Loading /> : <>
      <div className="inv-actions" style={{marginBottom: 12}}>{stChip(b.status)}<small>Quantities for {b.outputQty} almirah(s) · created by {b.createdBy?.name} {day(b.createdAt)}{b.approvedBy ? ` · approved by ${b.approvedBy.name} ${day(b.approvedAt)}` : ''}</small></div>
      <Table headers={['Material', 'Type', <span className="num">Qty</span>, <span className="num">Wastage</span>, <span className="num">Effective / unit</span>, <span className="num">Unit cost</span>, <span className="num">Cost / almirah</span>, <span className="num">In stock</span>]}>
        {(b.cost?.lines || b.lines).map((l: any) => <tr key={l.itemId}><td><strong>{l.itemName}</strong><small className="inv-mono">{l.itemCode}</small></td><td><small>{label(l.itemType)}</small></td><td className="num">{qty(l.qtyM, l.unit)}</td><td className="num">{(l.wastageBps || 0) / 100}%</td><td className="num">{l.effectiveQtyPerUnit?.toFixed(3) ?? '—'}</td><td className="num">{l.missingCost ? <Chip tone="amber">No cost</Chip> : rupees(l.unitCostPaise)}</td><td className="num">{rupees(l.costPerUnitPaise)}</td><td className="num">{l.available ?? '—'}</td></tr>)}
      </Table>
      {b.cost && <div className="inv-totals"><span>Material</span><span>{b.cost.materialPerUnitPaise == null ? `Incomplete (${b.cost.incomplete.join(', ')})` : rupees(b.cost.materialPerUnitPaise)}</span><span>Labour</span><span>{rupees(b.cost.labourPerUnitPaise)}</span><span>Overhead</span><span>{rupees(b.cost.overheadPerUnitPaise)}</span><span>Other</span><span>{rupees(b.cost.otherPerUnitPaise)}</span><span className="grand">Estimated manufacturing cost</span><span className="grand">{rupees(b.cost.estimatedPerUnitPaise)}</span></div>}
      <h4 style={{margin: '16px 0 8px'}}>Version history</h4>
      {b.versions.map((v: any) => <div className="inv-row" key={v._id}><div className="grow"><strong>Version {v.version}</strong><small>{v.createdBy?.name} · {day(v.createdAt)}{v.approvedBy ? ` · approved by ${v.approvedBy.name}` : ''}</small></div>{stChip(v.status)}</div>)}
    </>}
  </Dialog>;
}

// ---------------- Production orders ----------------
function ProductionOrders() {
  const can = useCan();
  const [status, setStatus] = useState('OPEN'), [page, setPage] = useState(1), [form, setForm] = useState(false), [open, setOpen] = useState<string | null>(null);
  const list = useLoad(() => get<any>('/api/inventory/productions', {status, page, limit: 20}), [status, page]);
  return <Card title="Production orders" aside={can('production.manage') && <Button onClick={() => setForm(true)}>+ New production order</Button>}>
    <div className="inv-filters"><Select value={status} onChange={e => { setStatus(e.target.value); setPage(1); }} placeholder="All orders" options={[['OPEN', 'Open'], ...['DRAFT', 'SUBMITTED', 'APPROVED', 'MATERIALS_RESERVED', 'IN_PROGRESS', 'QUALITY_CHECK', 'COMPLETED', 'CANCELLED', 'REJECTED'].map(s => [s, label(s)] as [string, string])]} /></div>
    <ErrorBox error={list.error} retry={list.reload} />
    {!list.data ? <Loading /> : <><Table headers={['Order', 'Product', 'Progress', 'Current stage', 'Expected', 'Status', '']} empty="No production orders.">
      {list.data.items.map((o: any) => <tr key={o._id}><td><span className="inv-mono">{o.number}</span><small>{o.assignedTo || 'Unassigned'}</small></td><td><div className="inv-name">{o.image && <Thumb url={o.image} alt={o.productName} size={34} />}<div><strong>{o.productName}</strong><small>BOM v{o.bomVersion}</small></div></div></td><td style={{minWidth: 130}}><Meter pct={o.progress.outputPct} /><small>{o.completedQty} of {o.plannedQty} done{o.rejectedQty ? ` · ${o.rejectedQty} rejected` : ''}</small></td><td>{o.progress.currentStage || '—'}</td><td className="inv-nowrap">{day(o.expectedDate)}{o.progress.overdue && <small><Chip tone="red">Late</Chip></small>}</td><td>{stChip(o.status)}</td><td><Button small variant="ghost" onClick={() => setOpen(o._id)}>Open</Button></td></tr>)}
    </Table><Pager page={page} total={list.data.total} limit={20} onPage={setPage} /></>}
    {form && <ProductionForm onClose={() => setForm(false)} onSaved={id => { setForm(false); void list.reload(); if (id) setOpen(id); }} />}
    {open && <ProductionDetail id={open} onClose={() => setOpen(null)} onChanged={() => void list.reload()} />}
  </Card>;
}

export function ProductionForm({onClose, onSaved, productId}: {onClose: () => void; onSaved: (id?: string) => void; productId?: string}) {
  const toast = useToast(); const products = useProducts(); const {busy, run} = useAction();
  const [f, setF] = useState({productId: productId || '', plannedQty: '', startDate: todayIso(), expectedDate: '', assignedTo: '', priority: 'NORMAL', notes: ''});
  const p = products.data?.find((x: any) => x.id === f.productId);
  const save = async (submit: boolean) => {
    if (!f.productId || !(Number(f.plannedQty) >= 1)) return toast('err', 'Choose a product and a quantity of at least 1');
    const r: any = await run(() => send('POST', '/api/inventory/productions', {...f, plannedQty: Number(f.plannedQty), expectedDate: f.expectedDate || null, submit}), 'Production order created');
    if (r) onSaved(r.id);
  };
  return <Dialog title="New production order" onClose={onClose} busy={busy} footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button><Button variant="ghost" onClick={() => save(false)} disabled={busy}>Save draft</Button><Button onClick={() => save(true)} disabled={busy}>Create & submit</Button></>}>
    <div className="inv-form">
      <Field label="Finished product *" wide><Select value={f.productId} onChange={e => setF({...f, productId: e.target.value})} placeholder="Choose almirah…" options={(products.data || []).map((x: any) => [x.id, `${x.name}${x.bom ? ` · BOM v${x.bom.version}` : ' · no active BOM'}`])} /></Field>
      {p && !p.bom && <div className="inv-note warn" style={{gridColumn: '1/-1'}}>This product has no approved BOM. Create and approve one under Production → BOM & costing first.</div>}
      <Field label="Quantity to make *"><Input type="number" min="1" step="1" value={f.plannedQty} onChange={e => setF({...f, plannedQty: e.target.value})} /></Field>
      <Field label="Priority"><Select value={f.priority} onChange={e => setF({...f, priority: e.target.value})} options={[['LOW', 'Low'], ['NORMAL', 'Normal'], ['HIGH', 'High']]} /></Field>
      <Field label="Start date"><Input type="date" value={f.startDate} onChange={e => setF({...f, startDate: e.target.value})} /></Field>
      <Field label="Expected completion"><Input type="date" min={f.startDate} value={f.expectedDate} onChange={e => setF({...f, expectedDate: e.target.value})} /></Field>
      <Field label="Assigned employee / team" wide><Input value={f.assignedTo} onChange={e => setF({...f, assignedTo: e.target.value})} maxLength={120} /></Field>
      <Field label="Notes" wide><TextArea value={f.notes} onChange={e => setF({...f, notes: e.target.value})} /></Field>
    </div>
  </Dialog>;
}

export function ProductionDetail({id, onClose, onChanged}: {id: string; onClose: () => void; onChanged: () => void}) {
  const can = useCan(); const toast = useToast();
  const d = useLoad(() => get<any>(`/api/inventory/productions/${id}`), [id]);
  const {busy, run} = useAction();
  const [dlg, setDlg] = useState<'issue' | 'return' | 'output' | 'reject' | 'cancel' | 'complete' | null>(null);
  const o = d.data;
  const act = async (a: string, ok: string, body: any = {}) => { const r = await run(() => send('POST', `/api/inventory/productions/${id}/${a}`, body), ok); if (r) { void d.reload(); onChanged(); } return r; };
  const manage = can('production.manage'), approve = can('production.approve');
  return <Dialog title={o ? `${o.number} · ${o.productName}` : 'Production order'} onClose={onClose} wide busy={busy} footer={o && <>
    {o.status === 'DRAFT' && manage && <Button onClick={() => act('submit', 'Submitted for approval')}>Submit</Button>}
    {o.status === 'SUBMITTED' && approve && <><Button variant="danger" onClick={() => setDlg('reject')}>Reject</Button><Button variant="success" onClick={() => act('approve', 'Production approved')}>Approve</Button></>}
    {o.status === 'APPROVED' && manage && <Button onClick={() => act('reserve', 'Materials reserved')}>Reserve materials</Button>}
    {['MATERIALS_RESERVED', 'IN_PROGRESS', 'QUALITY_CHECK'].includes(o.status) && manage && <Button variant="ghost" onClick={() => setDlg('issue')}>Issue materials</Button>}
    {o.status === 'MATERIALS_RESERVED' && manage && <Button onClick={() => act('start', 'Production started')}>Start production</Button>}
    {['IN_PROGRESS', 'QUALITY_CHECK'].includes(o.status) && manage && <><Button variant="ghost" onClick={() => setDlg('return')}>Return unused</Button>{o.status === 'IN_PROGRESS' && <Button variant="ghost" onClick={() => act('quality-check', 'Sent to quality check')}>Send to QC</Button>}<Button onClick={() => setDlg('output')}>Record QC output</Button></>}
    {['IN_PROGRESS', 'QUALITY_CHECK'].includes(o.status) && approve && <Button variant="success" onClick={() => setDlg('complete')}>Complete</Button>}
    {['DRAFT', 'SUBMITTED', 'APPROVED', 'MATERIALS_RESERVED', 'IN_PROGRESS', 'QUALITY_CHECK'].includes(o.status) && manage && <Button variant="ghost" onClick={() => setDlg('cancel')}>Cancel order</Button>}
  </>}>
    <ErrorBox error={d.error} retry={d.reload} />
    {!o ? <Loading /> : <>
      <div className="inv-gallery" style={{gridTemplateColumns: '150px 1fr'}}>
        <div><Thumb url={o.image} alt={o.productName} size={150} /></div>
        <div>
          <div className="inv-actions" style={{marginBottom: 10}}>{stChip(o.status)}{o.progress.overdue && <Chip tone="red">Behind schedule</Chip>}<small>BOM v{o.bomVersion} · priority {label(o.priority)}</small></div>
          <div className="inv-tiles" style={{gridTemplateColumns: 'repeat(4,minmax(0,1fr))'}}>
            <div className="inv-tile"><span>Planned</span><div className="v">{o.plannedQty}</div></div>
            <div className="inv-tile"><span>Completed (QC passed)</span><div className="v green">{o.completedQty}</div>{o.rejectedQty ? <small>{o.rejectedQty} rejected</small> : null}</div>
            <div className="inv-tile"><span>Remaining</span><div className="v">{o.progress.remainingQty}</div></div>
            <div className="inv-tile"><span>Progress</span><div className="v">{o.progress.outputPct}%</div><Meter pct={o.progress.outputPct} /></div>
          </div>
          <div className="inv-kv">{[['Start', day(o.startDate)], ['Expected', day(o.expectedDate)], ['Completed', day(o.completedAt)], ['Assigned', o.assignedTo || '—'], ['Material cost so far', rupees(o.progress.materialCostPaise)], ['Total cost so far', rupees(o.progress.costSoFarPaise)], ['BOM estimate / unit', rupees(o.bomSnapshot?.estimatedPerUnitPaise)], ['Approved by', o.approvedBy?.name || '—']].map(([k, v]) => <div key={String(k)}><span>{k}</span><b>{v}</b></div>)}</div>
        </div>
      </div>
      {o.rejectReason && <div className="inv-note warn">Rejected: {o.rejectReason}</div>}{o.cancelReason && <div className="inv-note warn">Cancelled: {o.cancelReason}</div>}
      <h4 style={{margin: '16px 0 8px'}}>Materials</h4>
      <Table headers={['Material', <span className="num">Required</span>, <span className="num">Reserved</span>, <span className="num">Issued</span>, <span className="num">Returned</span>, <span className="num">Wasted</span>, <span className="num">Consumed</span>, <span className="num">Unaccounted</span>, <span className="num">Available in store</span>]}>
        {o.lines.map((l: any) => <tr key={l.itemId}><td><strong>{l.itemName}</strong><small>planned wastage {qty(l.plannedWastageM)} {l.unit}</small></td><td className="num">{qty(l.requiredM, l.unit)}</td><td className="num">{qty(l.reservedM)}</td><td className="num">{qty(l.issuedM)}</td><td className="num">{qty(l.returnedM)}</td><td className="num">{qty(l.wastedM)}</td><td className="num">{qty(l.consumedM)}</td><td className="num">{l.unaccountedM ? <Chip tone="amber">{qty(l.unaccountedM)}</Chip> : '0'}</td><td className="num">{l.shortageM ? <Chip tone="red">{qty(l.availableM)} (short {qty(l.shortageM)})</Chip> : qty(l.availableM)}</td></tr>)}
      </Table>
      <small>Material leaves stock once, when it is issued. Wastage and consumption are recorded against the issued quantity and never deducted twice.</small>
      {o.stages?.length > 0 && <><h4 style={{margin: '16px 0 8px'}}>Manufacturing stages</h4><Stages order={o} canEdit={manage && ['IN_PROGRESS', 'QUALITY_CHECK'].includes(o.status)} onChanged={() => { void d.reload(); onChanged(); }} /></>}
      {o.outputs?.length > 0 && <><h4 style={{margin: '16px 0 8px'}}>Output batches (quality inspected)</h4><Table headers={['Batch', 'Posted', <span className="num">Produced</span>, <span className="num">Accepted</span>, <span className="num">Rejected</span>, 'QC notes', <span className="num">Unit cost</span>]}>{o.outputs.map((b: any) => <tr key={b.batchNo}><td>#{b.batchNo}</td><td>{dateTime(b.postedAt)} · {b.postedBy?.name}</td><td className="num">{b.producedQty}</td><td className="num">{b.acceptedQty}</td><td className="num">{b.rejectedQty || '—'}</td><td>{b.qcNotes || '—'}</td><td className="num">{rupees(b.unitCostPaise)}</td></tr>)}</Table></>}
      {o.wastage?.length > 0 && <><h4 style={{margin: '16px 0 8px'}}>Wastage on this order</h4>{o.wastage.map((w: any) => <div className="inv-row" key={w._id}><div className="grow"><strong>{w.itemName} · {qty(w.qtyM, w.unit)}</strong><small>{label(w.wastageType)} · {w.reason}</small></div><Chip tone={w.status === 'APPROVED' ? 'green' : w.status === 'PENDING' ? 'amber' : 'red'}>{label(w.status)}</Chip><span>{rupees(w.costPaise)}</span></div>)}</>}
      <h4 style={{margin: '16px 0 8px'}}>History</h4>
      <div className="inv-timeline">{[...o.history].reverse().map((h: any, i: number) => <div className="ev" key={i}><small>{dateTime(h.at)}</small><div><b>{label(h.action)}</b>{h.notes && <small> · {h.notes}</small>}</div><small>{h.by}</small></div>)}</div>
    </>}
    {dlg === 'issue' && o && <MaterialDialog mode="issue" order={o} onClose={() => setDlg(null)} onSubmit={async (lines, reason) => { if (await act('issue', 'Materials issued — stock reduced', {lines, additionalReason: reason})) setDlg(null); }} />}
    {dlg === 'return' && o && <MaterialDialog mode="return" order={o} onClose={() => setDlg(null)} onSubmit={async lines => { if (await act('return', 'Unused material returned to store', {lines})) setDlg(null); }} />}
    {dlg === 'output' && o && <OutputDialog order={o} onClose={() => setDlg(null)} onSubmit={async b => { if (await act('output', `${b.acceptedQty} almirah(s) added to finished stock`, b)) setDlg(null); }} />}
    {dlg === 'complete' && o && <Confirm title="Complete production" confirmLabel="Complete" needReason={o.completedQty + o.rejectedQty < o.plannedQty ? 'Reason for closing short' : undefined}
      message={<>Completion classifies all issued material that was not returned or wasted as consumed, and releases any unused reservations. {o.lines.some((l: any) => l.unaccountedM > 0) ? 'Unaccounted material will be recorded as consumed — return or log wastage first if that is wrong.' : ''}</>}
      onClose={() => setDlg(null)} onConfirm={async reason => { if (await act('complete', 'Production completed', {notes: reason, closeShort: o.completedQty + o.rejectedQty < o.plannedQty})) setDlg(null); }} />}
    {(dlg === 'reject' || dlg === 'cancel') && o && <Confirm title={dlg === 'reject' ? 'Reject production order' : 'Cancel production order'} danger needReason="Reason" confirmLabel={dlg === 'reject' ? 'Reject' : 'Cancel order'} message={dlg === 'cancel' ? 'Reserved materials are released. Material already issued must first be returned to the store or recorded as wastage.' : 'The order will not go ahead.'} onClose={() => setDlg(null)} onConfirm={async reason => { if (await act(dlg, dlg === 'reject' ? 'Rejected' : 'Production cancelled', {reason})) setDlg(null); else toast('err', 'Not changed'); }} />}
  </Dialog>;
}

function Stages({order, canEdit, onChanged}: {order: any; canEdit: boolean; onChanged: () => void}) {
  const {busy, run} = useAction();
  const [edit, setEdit] = useState<any | null>(null);
  return <div className="inv-stages">{order.stages.map((s: any) => <div key={s.code} className={`inv-stage ${s.status}`}>
    <span className="mark">{s.status === 'COMPLETED' ? '✓' : s.status === 'SKIPPED' ? '–' : ''}</span>
    <div><b>{s.name}</b><small>{label(s.status)} · {s.qtyDone}/{order.plannedQty}{s.assignedTo ? ` · ${s.assignedTo}` : ''}{s.completedAt ? ` · done ${day(s.completedAt)}` : ''}{s.notes ? ` · ${s.notes}` : ''}</small></div>
    {canEdit && <Button small variant="ghost" disabled={busy} onClick={() => setEdit({...s, qty: String(s.qtyDone)})}>Update</Button>}
  </div>)}
    {edit && <Dialog title={`Update stage · ${edit.name}`} onClose={() => setEdit(null)} busy={busy} footer={<><Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button><Button variant="ghost" onClick={async () => { if (await run(() => send('POST', `/api/inventory/productions/${order._id}/stage`, {code: edit.code, status: 'SKIPPED', notes: edit.notes || ''}), 'Stage skipped')) { setEdit(null); onChanged(); } }}>Skip stage</Button><Button onClick={async () => { if (await run(() => send('POST', `/api/inventory/productions/${order._id}/stage`, {code: edit.code, qtyDone: Number(edit.qty), assignedTo: edit.assignedTo || '', notes: edit.notes || undefined}), 'Stage updated')) { setEdit(null); onChanged(); } }}>Save</Button></>}>
      <div className="inv-form"><Field label={`Units finished this stage (of ${order.plannedQty})`}><Input type="number" min="0" max={order.plannedQty} step="1" value={edit.qty} onChange={e => setEdit({...edit, qty: e.target.value})} /></Field><Field label="Responsible"><Input value={edit.assignedTo || ''} onChange={e => setEdit({...edit, assignedTo: e.target.value})} /></Field><Field label="Notes (required to skip)" wide><Input value={edit.notes || ''} onChange={e => setEdit({...edit, notes: e.target.value})} /></Field></div>
    </Dialog>}
  </div>;
}

function MaterialDialog({mode, order, onClose, onSubmit}: {mode: 'issue' | 'return'; order: any; onClose: () => void; onSubmit: (lines: Array<{itemId: string; qty: number}>, reason: string) => Promise<void>}) {
  const toast = useToast();
  const def = (l: any) => mode === 'issue' ? Math.max(0, l.reservedM - Math.min(l.reservedM, l.issuedM)) : Math.max(0, l.unaccountedM);
  const [vals, setVals] = useState<Record<string, string>>(Object.fromEntries(order.lines.map((l: any) => [l.itemId, String(def(l) / 1000)])));
  const [reason, setReason] = useState(''), [busy, setBusy] = useState(false);
  const over = mode === 'issue' && order.lines.some((l: any) => Number(vals[l.itemId] || 0) * 1000 > Math.max(0, l.reservedM - Math.min(l.reservedM, l.issuedM)));
  const go = async () => { const lines = order.lines.filter((l: any) => Number(vals[l.itemId]) > 0).map((l: any) => ({itemId: l.itemId, qty: Number(vals[l.itemId])})); if (!lines.length) return toast('err', 'Enter at least one quantity'); if (over && reason.trim().length < 3) return toast('err', 'Issuing more than reserved is an additional material request — give a reason'); setBusy(true); try { await onSubmit(lines, reason); } finally { setBusy(false); } };
  return <Dialog title={mode === 'issue' ? 'Issue materials to production' : 'Return unused material to store'} onClose={onClose} busy={busy} footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button><Button onClick={go} disabled={busy}>{mode === 'issue' ? 'Issue (reduces stock)' : 'Return to store'}</Button></>}>
    <Table headers={['Material', <span className="num">{mode === 'issue' ? 'Reserved, not issued' : 'Unaccounted'}</span>, 'Quantity']}>{order.lines.map((l: any) => <tr key={l.itemId}><td>{l.itemName}</td><td className="num">{qty(def(l), l.unit)}</td><td><Input type="number" min="0" step="any" style={{width: 110}} value={vals[l.itemId]} onChange={e => setVals({...vals, [l.itemId]: e.target.value})} /></td></tr>)}</Table>
    {over && <Field label="Additional material request — reason *"><Input value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Two sheets mis-cut on the press" /></Field>}
  </Dialog>;
}

function OutputDialog({order, onClose, onSubmit}: {order: any; onClose: () => void; onSubmit: (b: {producedQty: number; acceptedQty: number; qcNotes: string}) => Promise<void>}) {
  const remaining = order.plannedQty - order.completedQty - order.rejectedQty;
  const [f, setF] = useState({produced: String(remaining), accepted: String(remaining), notes: ''}), [busy, setBusy] = useState(false);
  const toast = useToast();
  const go = async () => { const p = Number(f.produced), a = Number(f.accepted); if (!(p >= 1) || a > p || a < 0) return toast('err', 'Accepted must be between 0 and the produced quantity'); if (a < p && !f.notes.trim()) return toast('err', 'Explain why units were rejected'); setBusy(true); try { await onSubmit({producedQty: p, acceptedQty: a, qcNotes: f.notes}); } finally { setBusy(false); } };
  return <Dialog title="Quality inspection & output" onClose={onClose} busy={busy} footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button><Button onClick={go} disabled={busy}>Post output</Button></>}>
    <div className="inv-note">Only units that pass inspection are added to finished stock. {remaining} unit(s) remain on this order.</div>
    <div className="inv-form"><Field label="Units produced"><Input type="number" min="1" max={remaining} step="1" value={f.produced} onChange={e => setF({...f, produced: e.target.value})} /></Field><Field label="Units accepted (QC passed)"><Input type="number" min="0" max={f.produced} step="1" value={f.accepted} onChange={e => setF({...f, accepted: e.target.value})} /></Field><Field label="QC notes" wide hint="Required if any unit is rejected"><TextArea value={f.notes} onChange={e => setF({...f, notes: e.target.value})} /></Field></div>
  </Dialog>;
}

export function WorkInProgress() {
  const list = useLoad(() => get<any>('/api/inventory/productions', {status: 'WIP', limit: 100}), []);
  const [open, setOpen] = useState<string | null>(null), [filter, setFilter] = useState<'all' | 'late'>('all');
  const items = (list.data?.items || []).filter((o: any) => filter === 'all' || o.progress.overdue);
  return <>
    <div className="inv-filters" style={{justifyContent: 'space-between'}}><Segment value={filter} onChange={setFilter} options={[['all', 'All in progress'], ['late', 'Delayed only']]} /><Button variant="ghost" small onClick={list.reload}>Refresh</Button></div>
    <ErrorBox error={list.error} retry={list.reload} />
    {!list.data ? <Loading /> : !items.length ? <Card><Empty>{filter === 'late' ? 'Nothing is behind schedule.' : 'Nothing is being manufactured right now.'}</Empty></Card> : <div className="inv-wip">{items.map((o: any) => <button type="button" key={o._id} className={`inv-wipcard${o.progress.overdue ? ' late' : ''}`} onClick={() => setOpen(o._id)}>
      <div className="inv-actions" style={{flexWrap: 'nowrap'}}><Thumb url={o.image} alt={o.productName} size={52} /><div style={{minWidth: 0, flex: 1}}><strong>{o.productName}</strong><small className="inv-mono" style={{display: 'block'}}>{o.number}</small></div>{stChip(o.status)}</div>
      <div className="inv-actions" style={{justifyContent: 'space-between'}}><span><b>{o.completedQty + o.rejectedQty}</b> / {o.plannedQty} done · {o.progress.remainingQty} pending</span><b>{o.progress.outputPct}%</b></div>
      <Meter pct={o.progress.outputPct} />
      <div className="inv-steps" aria-label={`${o.progress.stagesDone} of ${o.progress.stagesTotal} stages complete`}>{(o.stages || []).map((s: any, i: number) => <i key={s.code} title={`${s.name}: ${label(s.status)}`} className={s.status === 'COMPLETED' || s.status === 'SKIPPED' ? 'done' : s.status === 'IN_PROGRESS' || i === o.progress.stagesDone ? 'now' : ''} />)}</div>
      <small>Current stage: <b style={{color: 'var(--text)'}}>{o.progress.currentStage || 'Not started'}</b></small>
      <div className="inv-kv" style={{gridTemplateColumns: '1fr 1fr'}}><div><span>Responsible</span><b>{o.assignedTo || '—'}</b></div><div><span>Expected</span><b style={{color: o.progress.overdue ? 'var(--inv-red)' : undefined}}>{day(o.expectedDate)}</b></div><div><span>Material consumed</span><b>{rupees(o.progress.materialCostPaise)}</b></div><div><span>Wastage</span><b>{rupees(o.wastageCostPaise)}</b></div></div>
    </button>)}</div>}
    {open && <ProductionDetail id={open} onClose={() => setOpen(null)} onChanged={() => void list.reload()} />}
  </>;
}
