import React, {useEffect, useMemo, useState} from 'react';
import {StoredFile, apiBase, day, get, label, openPrivate, qty, rupees, send, todayIso, upload} from './api';
import {Button, Card, Chip, Confirm, Dialog, ErrorBox, Field, Input, Loading, Meter, Pager, Search, Segment, Select, Table, TextArea, errText, useAction, useLoad, useToast} from './ui';
import {useCan, useMeta} from './InventoryPage';
import {ItemPicker, useItemOptions, useSupplierOptions} from './Items';
import {SupplierForm} from './Suppliers';

const PO_TONE: Record<string, any> = {DRAFT: 'grey', SUBMITTED: 'amber', APPROVED: 'blue', PARTIALLY_RECEIVED: 'violet', FULLY_RECEIVED: 'green', CLOSED: 'green', REJECTED: 'red', CANCELLED: 'red'};
export const poChip = (s: string) => <Chip tone={PO_TONE[s] || 'grey'}>{label(s)}</Chip>;
const BILL_TONE: Record<string, any> = {DRAFT: 'grey', POSTED: 'amber', PARTIALLY_PAID: 'violet', PAID: 'green', CANCELLED: 'red'};

/** Units an item can be bought in: stock unit, its verified purchase units, and same-dimension units. */
function unitsFor(item: any, all: Array<{code: string; dimension: string}>) {
  if (!item) return [];
  const dim = all.find(u => u.code === item.stockUnit)?.dimension;
  const set = new Set([item.stockUnit, ...(item.purchaseUnits || []).map((p: any) => p.unit), ...(dim && dim !== 'COUNT' ? all.filter(u => u.dimension === dim).map(u => u.code) : [])]);
  return [...set];
}
function FileButton({file}: {file?: StoredFile | null}) { const toast = useToast(); return file ? <Button small variant="ghost" onClick={() => openPrivate(file.url).catch(e => toast('err', errText(e)))}>📎 {file.name || 'Attachment'}</Button> : null; }
function Attach({files, onChange, purpose = 'document'}: {files: StoredFile[]; onChange: (f: StoredFile[]) => void; purpose?: string}) {
  const toast = useToast(); const [busy, setBusy] = useState(false);
  return <div className="inv-actions">{files.map(f => <span key={f.url} className="inv-chip violet">📎 {f.name}<button type="button" style={{background: 'none', border: 0, color: 'inherit', cursor: 'pointer'}} aria-label="Remove attachment" onClick={() => onChange(files.filter(x => x.url !== f.url))}>×</button></span>)}
    <label className="inv-btn ghost sm" style={{cursor: busy ? 'wait' : 'pointer'}}>{busy ? 'Uploading…' : '+ Attach invoice / document'}<input type="file" hidden accept="application/pdf,image/jpeg,image/png,image/webp" disabled={busy} onChange={async e => { const f = e.target.files?.[0]; e.target.value = ''; if (!f) return; setBusy(true); try { onChange([...files, await upload(f, purpose)]); } catch (err) { toast('err', errText(err)); } finally { setBusy(false); } }} /></label></div>;
}

export function Purchases({sub = 'orders'}: {sub?: string}) {
  return <>
    {sub === 'orders' && <PurchaseOrders />}{sub === 'receipts' && <Receipts />}{sub === 'bills' && <Bills />}{sub === 'payments' && <Payments />}{sub === 'returns' && <Returns />}{sub === 'reorder' && <Reorder />}
  </>;
}

function PurchaseOrders() {
  const can = useCan();
  const [q, setQ] = useState(''), [status, setStatus] = useState(''), [page, setPage] = useState(1), [form, setForm] = useState<any | null | 'new'>(null), [open, setOpen] = useState<string | null>(null);
  const list = useLoad(() => get<any>('/api/inventory/purchase-orders', {q, status, page, limit: 20}), [q, status, page]);
  return <Card title="Purchase orders" aside={can('purchase.create') && <Button onClick={() => setForm('new')}>+ New purchase order</Button>}>
    <div className="inv-filters"><Segment value={status} onChange={v => { setStatus(v); setPage(1); }} options={[['', 'All'], ['DRAFT', 'Drafts'], ['PENDING', 'Pending'], ['PARTIALLY_RECEIVED', 'Partially received'], ['COMPLETED', 'Completed'], ['CANCELLED', 'Cancelled']]} /><Search value={q} onChange={v => { setQ(v); setPage(1); }} placeholder="PO number, supplier or invoice no." /></div>
    <ErrorBox error={list.error} retry={list.reload} />
    {!list.data ? <Loading /> : <><Table headers={['PO', 'Supplier', 'Expected', 'Received', <span className="num">Total</span>, 'Status', '']} empty="No purchase orders match.">
      {list.data.items.map((p: any) => { const ord = p.lines.reduce((a: number, l: any) => a + l.orderedM, 0), acc = p.lines.reduce((a: number, l: any) => a + l.acceptedM, 0); return <tr key={p._id}><td><span className="inv-mono">{p.number}</span><small>{day(p.orderDate || p.createdAt)}{p.source === 'REORDER' ? ' · from alerts' : ''}{p.invoiceAttachments ? ` · 📎 ${p.invoiceAttachments}` : ''}</small></td><td>{p.supplierName}</td><td className="inv-nowrap">{day(p.expectedDate)}</td><td style={{minWidth: 110}}><Meter pct={ord ? acc / ord * 100 : 0} tone={acc >= ord && ord ? 'green' : 'violet'} /><small>{p.lines.length} line(s) · {ord ? Math.round(acc / ord * 100) : 0}%</small></td><td className="num">{rupees(p.totalPaise)}</td><td><div className="inv-chips">{poChip(p.status)}{p.paymentStatus === 'PAID' ? <Chip tone="green">Paid</Chip> : p.paymentStatus === 'PARTIALLY_PAID' ? <Chip tone="violet">Part paid</Chip> : p.paymentStatus === 'UNPAID' ? <Chip tone="amber">Unpaid</Chip> : null}</div></td><td><Button small variant="ghost" onClick={() => setOpen(p._id)}>{p.status === 'DRAFT' ? 'Edit' : 'View'}</Button></td></tr>; })}
    </Table><Pager page={page} total={list.data.total} limit={20} onPage={setPage} /></>}
    {form && <PurchaseOrderForm po={form === 'new' ? undefined : form} onClose={() => setForm(null)} onSaved={() => { setForm(null); void list.reload(); }} />}
    {open && <PurchaseOrderDetail id={open} onClose={() => setOpen(null)} onChanged={() => void list.reload()} onEdit={po => { setOpen(null); setForm(po); }} />}
  </Card>;
}

type Line = {itemId: string; unit: string; qty: string; rate: string; discount: string; gst: string};
export function PurchaseOrderForm({po, prefill, onClose, onSaved}: {po?: any; prefill?: {supplierId?: string; lines?: Line[]; supplierInvoiceNo?: string; attachments?: StoredFile[]}; onClose: () => void; onSaved: (id?: string) => void}) {
  const meta = useMeta(); const toast = useToast();
  const sups = useSupplierOptions(), items = useItemOptions();
  const [supplierId, setSupplierId] = useState(po?.supplierId || prefill?.supplierId || '');
  const [lines, setLines] = useState<Line[]>(po ? po.lines.map((l: any) => ({itemId: l.itemId, unit: l.unit, qty: String(l.qty), rate: String(l.ratePaise / 100), discount: String(l.discountBps / 100), gst: String(l.gstRateBps / 100)})) : prefill?.lines || [{itemId: '', unit: '', qty: '', rate: '', discount: '0', gst: '18'}]);
  const [h, setH] = useState({expectedDate: po?.expectedDate?.slice(0, 10) || '', freight: po ? String(po.freightPaise / 100) : '0', other: po ? String(po.otherChargesPaise / 100) : '0', invoice: po?.supplierInvoiceNo || prefill?.supplierInvoiceNo || '', notes: po?.notes || ''});
  const [files, setFiles] = useState<StoredFile[]>(po?.attachments || prefill?.attachments || []);
  const [addSupplier, setAddSupplier] = useState(false);
  const {busy, run} = useAction();
  const itemOf = (id: string) => items.data?.find((i: any) => i._id === id);
  const setLine = (i: number, patch: Partial<Line>) => setLines(lines.map((l, j) => j === i ? {...l, ...patch} : l));
  const est = useMemo(() => {
    const ls = lines.map(l => { const t = Math.round(Number(l.qty || 0) * Number(l.rate || 0) * 100 * (1 - Number(l.discount || 0) / 100)); return {t, tax: Math.round(t * Number(l.gst || 0) / 100)}; });
    const taxable = ls.reduce((a, x) => a + x.t, 0), tax = ls.reduce((a, x) => a + x.tax, 0), extra = Math.round((Number(h.freight || 0) + Number(h.other || 0)) * 100);
    return {taxable, tax, extra, total: taxable + tax + extra, lines: ls};
  }, [lines, h.freight, h.other]);
  const save = async (submit: boolean) => {
    if (!supplierId) return toast('err', 'Choose a supplier');
    const clean = lines.filter(l => l.itemId);
    if (!clean.length) return toast('err', 'Add at least one item');
    if (clean.some(l => !(Number(l.qty) > 0) || l.rate === '' || !l.unit)) return toast('err', 'Every line needs a unit, a quantity above zero and a rate');
    const body = {supplierId, expectedDate: h.expectedDate || null, freightRupees: Number(h.freight || 0), otherChargesRupees: Number(h.other || 0), supplierInvoiceNo: h.invoice, notes: h.notes, attachments: files, submit,
      lines: clean.map(l => ({itemId: l.itemId, unit: l.unit, qty: Number(l.qty), rateRupees: Number(l.rate), discountPct: Number(l.discount || 0), gstPct: Number(l.gst || 0)}))};
    const r: any = await run(() => po ? send('PUT', `/api/inventory/purchase-orders/${po._id}`, {...body, revision: po.revision}) : send('POST', '/api/inventory/purchase-orders', body), submit ? 'Purchase order submitted for approval' : 'Draft saved — stock does not change until goods are received');
    if (r) onSaved(r.id);
  };
  return <Dialog title={po ? `Edit ${po.number}` : 'Record purchase — new purchase order'} onClose={onClose} busy={busy} wide footer={<><small style={{marginRight: 'auto'}}>Creating a purchase order never changes stock. Stock rises only when accepted goods are received.</small><Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button><Button variant="ghost" onClick={() => save(false)} disabled={busy}>Save draft</Button><Button onClick={() => save(true)} disabled={busy}>{busy ? 'Saving…' : 'Save & submit for approval'}</Button></>}>
    <div className="inv-form three">
      <Field label="Supplier *"><div className="inv-actions" style={{flexWrap: 'nowrap'}}><Select value={supplierId} onChange={e => setSupplierId(e.target.value)} placeholder="Choose supplier…" options={(sups.data || []).map((s: any) => [s._id, `${s.name} (${s.supplierCode})`])} /><Button small variant="ghost" onClick={() => setAddSupplier(true)}>+ New</Button></div></Field>
      <Field label="Expected delivery"><Input type="date" min={todayIso()} value={h.expectedDate} onChange={e => setH({...h, expectedDate: e.target.value})} /></Field>
      <Field label="Supplier invoice no."><Input value={h.invoice} onChange={e => setH({...h, invoice: e.target.value})} maxLength={60} /></Field>
    </div>
    <h4 style={{margin: '16px 0 8px'}}>Materials</h4>
    <div className="inv-lines">{lines.map((l, i) => { const it = itemOf(l.itemId); const units = unitsFor(it, meta.units); return <div key={i} className="inv-line" style={{gridTemplateColumns: 'minmax(200px,2.4fr) 110px 100px 120px 90px 80px 110px auto'}}>
      <Field label={`Item ${i + 1}`}><ItemPicker items={items.data || []} value={l.itemId} onChange={id => { const x = itemOf(id); setLine(i, {itemId: id, unit: x?.stockUnit || '', rate: x?.lastPurchaseRatePaise ? String(x.lastPurchaseRatePaise / 100) : l.rate}); }} /></Field>
      <Field label="Unit"><select className="inv-input" value={l.unit} onChange={e => setLine(i, {unit: e.target.value})}>{!units.length && <option value="">—</option>}{units.map(u => <option key={u} value={u}>{u}</option>)}</select></Field>
      <Field label="Quantity"><Input type="number" min="0" step="any" value={l.qty} onChange={e => setLine(i, {qty: e.target.value})} /></Field>
      <Field label={`Rate (₹/${l.unit || 'unit'})`}><Input type="number" min="0" step="any" value={l.rate} onChange={e => setLine(i, {rate: e.target.value})} /></Field>
      <Field label="Disc. %"><Input type="number" min="0" max="100" step="any" value={l.discount} onChange={e => setLine(i, {discount: e.target.value})} /></Field>
      <Field label="GST %"><select className="inv-input" value={l.gst} onChange={e => setLine(i, {gst: e.target.value})}>{['0', '5', '12', '18', '28'].map(g => <option key={g} value={g}>{g}%</option>)}</select></Field>
      <Field label="Amount"><div style={{padding: '9px 0', fontVariantNumeric: 'tabular-nums'}}>{rupees(est.lines[i].t + est.lines[i].tax)}</div></Field>
      <Button small variant="ghost" aria-label={`Remove line ${i + 1}`} disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, j) => j !== i))}>×</Button>
      {it && l.unit && l.unit !== it.stockUnit && <small style={{gridColumn: '1/-1'}}>Converted to stock unit: {l.qty || 0} {l.unit} = {Math.round(Number(l.qty || 0) * (it.purchaseUnits?.find((p: any) => p.unit === l.unit)?.factor ?? 1) * 1000) / 1000} {it.stockUnit}{!it.purchaseUnits?.some((p: any) => p.unit === l.unit) && ' (standard conversion)'}</small>}
    </div>; })}</div>
    <Button variant="subtle" small onClick={() => setLines([...lines, {itemId: '', unit: '', qty: '', rate: '', discount: '0', gst: '18'}])}>+ Add material</Button>
    <div className="inv-form three" style={{marginTop: 14}}>
      <Field label="Freight (₹)"><Input type="number" min="0" step="any" value={h.freight} onChange={e => setH({...h, freight: e.target.value})} /></Field>
      <Field label="Other charges (₹)"><Input type="number" min="0" step="any" value={h.other} onChange={e => setH({...h, other: e.target.value})} /></Field>
      <Field label="Notes"><Input value={h.notes} onChange={e => setH({...h, notes: e.target.value})} maxLength={2000} /></Field>
    </div>
    <div style={{marginTop: 10}}><Attach files={files} onChange={setFiles} /></div>
    <div className="inv-totals"><span>Taxable value</span><span>{rupees(est.taxable)}</span><span>GST (CGST+SGST or IGST)</span><span>{rupees(est.tax)}</span><span>Freight & other</span><span>{rupees(est.extra)}</span><span className="grand">Estimated total</span><span className="grand">{rupees(est.total)}</span></div>
    <small style={{display: 'block', textAlign: 'right'}}>Final totals, GST split and round-off are calculated by the server.</small>
    {addSupplier && <SupplierForm onClose={() => setAddSupplier(false)} onSaved={id => { setAddSupplier(false); void sups.reload().then(() => id && setSupplierId(id)); }} />}
  </Dialog>;
}

function PurchaseOrderDetail({id, onClose, onChanged, onEdit}: {id: string; onClose: () => void; onChanged: () => void; onEdit: (po: any) => void}) {
  const can = useCan();
  const d = useLoad(() => get<any>(`/api/inventory/purchase-orders/${id}`), [id]);
  const {busy, run} = useAction();
  const [dlg, setDlg] = useState<'receive' | 'bill' | 'return' | 'reject' | 'cancel' | 'close' | null>(null);
  const p = d.data;
  const act = async (path: string, ok: string, body: any = {}) => { const r = await run(() => send('POST', `/api/inventory/purchase-orders/${id}/${path}`, body), ok); if (r) { void d.reload(); onChanged(); } return r; };
  return <Dialog title={p ? `Purchase order ${p.number}` : 'Purchase order'} onClose={onClose} wide busy={busy} footer={p && <>
    {p.status === 'DRAFT' && can('purchase.create') && <><Button variant="ghost" onClick={() => onEdit(p)}>Edit</Button><Button onClick={() => act('submit', 'Submitted for approval')} disabled={busy}>Submit for approval</Button></>}
    {p.status === 'SUBMITTED' && can('purchase.approve') && <><Button variant="danger" onClick={() => setDlg('reject')}>Reject</Button><Button variant="success" onClick={() => act('approve', 'Purchase order approved')} disabled={busy}>Approve</Button></>}
    {['APPROVED', 'PARTIALLY_RECEIVED'].includes(p.status) && can('purchase.receive') && <Button onClick={() => setDlg('receive')}>Receive goods</Button>}
    {p.grns.length > 0 && can('bill.manage') && <Button variant="ghost" onClick={() => setDlg('bill')}>Record supplier bill</Button>}
    {p.grns.length > 0 && can('purchase.return') && <Button variant="ghost" onClick={() => setDlg('return')}>Return to supplier</Button>}
    {['DRAFT', 'SUBMITTED', 'APPROVED'].includes(p.status) && can('purchase.create') && !p.grns.length && <Button variant="ghost" onClick={() => setDlg('cancel')}>Cancel order</Button>}
    {['APPROVED', 'PARTIALLY_RECEIVED', 'FULLY_RECEIVED'].includes(p.status) && can('purchase.approve') && <Button variant="ghost" onClick={() => setDlg('close')}>Close</Button>}
  </>}>
    <ErrorBox error={d.error} retry={d.reload} />
    {!p ? <Loading /> : <>
      <div className="inv-kv" style={{marginBottom: 14}}>{[['Supplier', p.supplierName], ['Status', poChip(p.status)], ['Ordered', day(p.orderDate)], ['Expected', day(p.expectedDate)], ['Created by', p.createdBy?.name], ['Approved by', p.approvedBy ? `${p.approvedBy.name} · ${day(p.approvedAt)}` : '—'], ['Supplier invoice', p.supplierInvoiceNo || '—'], ['Payment terms', `${p.paymentTermsDays || 0} days`]].map(([k, v]) => <div key={String(k)}><span>{k}</span><b>{v}</b></div>)}</div>
      {p.rejectReason && <div className="inv-note warn">Rejected: {p.rejectReason}</div>}{p.cancelReason && <div className="inv-note warn">Cancelled: {p.cancelReason}</div>}{p.closedReason && <div className="inv-note">Closed: {p.closedReason}</div>}
      <Table headers={['#', 'Item', <span className="num">Ordered</span>, <span className="num">Rate</span>, <span className="num">GST</span>, <span className="num">Amount</span>, <span className="num">Accepted</span>, <span className="num">Rejected</span>, <span className="num">Pending</span>, <span className="num">Landed cost / stock unit</span>]}>
        {p.lines.map((l: any) => <tr key={l.lineNo}><td>{l.lineNo}</td><td><strong>{l.itemName}</strong><small className="inv-mono">{l.itemCode}</small></td><td className="num">{l.qty} {l.unit}</td><td className="num">{rupees(l.ratePaise)}{l.discountBps ? <small>−{l.discountBps / 100}%</small> : null}</td><td className="num">{l.gstRateBps / 100}%</td><td className="num">{rupees(l.totalPaise)}</td><td className="num">{qty(l.acceptedM, l.stockUnit)}</td><td className="num">{l.rejectedM ? qty(l.rejectedM, l.stockUnit) : '—'}</td><td className="num">{qty(l.pendingM, l.stockUnit)}</td><td className="num">{rupees(l.landedUnitCostPaise)}</td></tr>)}
      </Table>
      <div className="inv-totals"><span>Taxable</span><span>{rupees(p.taxablePaise)}</span>{p.igstPaise ? <><span>IGST</span><span>{rupees(p.igstPaise)}</span></> : <><span>CGST</span><span>{rupees(p.cgstPaise)}</span><span>SGST</span><span>{rupees(p.sgstPaise)}</span></>}<span>Freight + other</span><span>{rupees(p.freightPaise + p.otherChargesPaise)}</span><span>Round off</span><span>{rupees(p.roundOffPaise)}</span><span className="grand">Total</span><span className="grand">{rupees(p.totalPaise)}</span></div>
      {p.attachments?.length > 0 && <div className="inv-actions">{p.attachments.map((f: StoredFile) => <FileButton key={f.url} file={f} />)}</div>}
      <h4 style={{margin: '18px 0 8px'}}>Goods receipts</h4>
      {p.grns.length ? <Table headers={['GRN', 'Date', 'Invoice', 'Lines', <span className="num">Value</span>, 'Received by']}>{p.grns.map((g: any) => <tr key={g._id}><td className="inv-mono">{g.number}</td><td className="inv-nowrap">{day(g.receivedDate)}</td><td>{g.supplierInvoiceNo || '—'}</td><td>{g.lines.map((l: any) => <small key={l.lineNo}>{l.itemName}: +{qty(l.acceptedM, l.stockUnit)}{l.rejectedM ? ` (rejected ${qty(l.rejectedM)}: ${l.rejectReason})` : ''}</small>)}</td><td className="num">{rupees(g.totalValuePaise)}</td></tr>)}</Table> : <small>No goods received yet.</small>}
      {(p.bills.length > 0 || p.returns.length > 0) && <><h4 style={{margin: '18px 0 8px'}}>Bills & returns</h4>{p.bills.map((b: any) => <div className="inv-row" key={b._id}><div className="grow"><strong>Bill {b.number}</strong><small>Supplier invoice {b.supplierInvoiceNo} · {day(b.invoiceDate)}</small></div><Chip tone={BILL_TONE[b.status]}>{label(b.status)}</Chip><span>{rupees(b.totalPaise)}</span></div>)}{p.returns.map((r: any) => <div className="inv-row" key={r._id}><div className="grow"><strong>Return {r.number}</strong><small>{r.lines.map((l: any) => `${l.itemName} −${qty(l.qtyM)}`).join(', ')}</small></div><span>{rupees(r.totalValuePaise)}</span></div>)}</>}
    </>}
    {dlg === 'receive' && p && <ReceiveDialog po={p} onClose={() => setDlg(null)} onSaved={() => { setDlg(null); void d.reload(); onChanged(); }} />}
    {dlg === 'bill' && p && <BillForm prefill={{supplierId: p.supplierId, poId: p._id, supplierInvoiceNo: p.supplierInvoiceNo, lines: p.lines.filter((l: any) => l.acceptedM).map((l: any) => ({description: l.itemName, itemId: l.itemId, qty: String(Math.round(l.acceptedM / l.factor) / 1000), unit: l.unit, rate: String(l.ratePaise / 100), gst: String(l.gstRateBps / 100)})), freight: String(p.freightPaise / 100)}} onClose={() => setDlg(null)} onSaved={() => { setDlg(null); void d.reload(); }} />}
    {dlg === 'return' && p && <ReturnForm grns={p.grns} onClose={() => setDlg(null)} onSaved={() => { setDlg(null); void d.reload(); onChanged(); }} />}
    {(dlg === 'reject' || dlg === 'cancel' || dlg === 'close') && p && <Confirm title={dlg === 'reject' ? 'Reject purchase order' : dlg === 'cancel' ? 'Cancel purchase order' : 'Close purchase order'} danger={dlg !== 'close'} needReason="Reason" confirmLabel={label(dlg)} message={dlg === 'close' ? 'Closing stops further receipts. Any quantity not yet received is cancelled.' : 'No stock is affected.'} onClose={() => setDlg(null)} onConfirm={async reason => { await act(dlg, `Purchase order ${dlg === 'close' ? 'closed' : dlg + 'ed'}`, {reason}); setDlg(null); }} />}
  </Dialog>;
}

function ReceiveDialog({po, onClose, onSaved}: {po: any; onClose: () => void; onSaved: () => void}) {
  const toast = useToast(); const {busy, run} = useAction();
  const open = po.lines.filter((l: any) => l.pendingM > 0);
  const [rows, setRows] = useState(open.map((l: any) => { const pend = Math.round(l.pendingM / l.factor) / 1000; return {lineNo: l.lineNo, received: String(pend), accepted: String(pend), reason: ''}; }));
  const [h, setH] = useState({date: todayIso(), invoice: po.supplierInvoiceNo || '', notes: ''});
  const [files, setFiles] = useState<StoredFile[]>([]);
  const set = (i: number, k: string, v: string) => setRows(rows.map((r: any, j: number) => j === i ? {...r, [k]: v, ...(k === 'received' && Number(r.accepted) > Number(v) ? {accepted: v} : {})} : r));
  const save = async () => {
    const lines = rows.filter((r: any) => Number(r.received) > 0).map((r: any) => ({lineNo: r.lineNo, receivedQty: Number(r.received), acceptedQty: Number(r.accepted || 0), rejectReason: r.reason}));
    if (!lines.length) return toast('err', 'Enter the quantity received for at least one line');
    if (lines.some((l: any) => l.acceptedQty > l.receivedQty)) return toast('err', 'Accepted cannot exceed received');
    if (lines.some((l: any) => l.acceptedQty < l.receivedQty && !l.rejectReason.trim())) return toast('err', 'Give a reason for every rejected quantity');
    const r = await run(() => send('POST', `/api/inventory/purchase-orders/${po._id}/receive`, {receivedDate: h.date, supplierInvoiceNo: h.invoice, notes: h.notes, attachments: files, lines}), 'Goods received — accepted quantity added to stock');
    if (r) onSaved();
  };
  return <Dialog title={`Receive goods · ${po.number}`} onClose={onClose} busy={busy} wide footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button><Button onClick={save} disabled={busy}>{busy ? 'Posting…' : 'Post goods receipt'}</Button></>}>
    <div className="inv-note">Count and inspect the delivery. Only the <b>accepted</b> quantity enters stock; rejected quantity stays with the supplier. Posting is final — corrections are made with a purchase return.</div>
    <div className="inv-form three"><Field label="Received on"><Input type="date" max={todayIso()} value={h.date} onChange={e => setH({...h, date: e.target.value})} /></Field><Field label="Supplier invoice / challan no."><Input value={h.invoice} onChange={e => setH({...h, invoice: e.target.value})} /></Field><Field label="Notes"><Input value={h.notes} onChange={e => setH({...h, notes: e.target.value})} /></Field></div>
    <Table headers={['Item', <span className="num">Pending</span>, 'Received', 'Accepted', 'Rejected', 'Rejection reason']}>
      {open.map((l: any, i: number) => { const r = rows[i]; const rej = Math.max(0, Number(r.received || 0) - Number(r.accepted || 0)); return <tr key={l.lineNo}><td><strong>{l.itemName}</strong><small>in {l.unit}{l.unit !== l.stockUnit ? ` (stock unit ${l.stockUnit})` : ''}</small></td><td className="num">{Math.round(l.pendingM / l.factor) / 1000} {l.unit}</td><td><Input type="number" min="0" step="any" style={{width: 100}} value={r.received} onChange={e => set(i, 'received', e.target.value)} /></td><td><Input type="number" min="0" step="any" style={{width: 100}} value={r.accepted} onChange={e => set(i, 'accepted', e.target.value)} /></td><td className="num">{rej ? <Chip tone="amber">{Math.round(rej * 1000) / 1000}</Chip> : '—'}</td><td><Input disabled={!rej} value={r.reason} placeholder={rej ? 'Required' : ''} onChange={e => set(i, 'reason', e.target.value)} /></td></tr>; })}
    </Table>
    <div style={{marginTop: 10}}><Attach files={files} onChange={setFiles} /></div>
  </Dialog>;
}

function Receipts() {
  const [page, setPage] = useState(1);
  const list = useLoad(() => get<any>('/api/inventory/goods-receipts', {page, limit: 20}), [page]);
  return <Card title="Goods receipts" aside={<small>Every receipt here increased stock by the accepted quantity.</small>}>
    <ErrorBox error={list.error} retry={list.reload} />
    {!list.data ? <Loading /> : <><Table headers={['GRN', 'Supplier', 'PO', 'Items', <span className="num">Value</span>]} empty="No goods received yet.">{list.data.items.map((g: any) => <tr key={g._id}><td><span className="inv-mono">{g.number}</span><small>{day(g.receivedDate)}{g.postedBy?.name ? ` · ${g.postedBy.name}` : ''}</small></td><td>{g.supplierName}</td><td><span className="inv-mono">{g.poNumber}</span><small>{g.supplierInvoiceNo || 'No invoice no.'}</small></td><td>{g.lines.map((l: any) => <small key={l.lineNo}>{l.itemName} +{qty(l.acceptedM, l.stockUnit)}{l.rejectedM ? ` · rejected ${qty(l.rejectedM)}` : ''}</small>)}</td><td className="num">{rupees(g.totalValuePaise)}</td><td>{g.postedBy?.name}</td></tr>)}</Table><Pager page={page} total={list.data.total} limit={20} onPage={setPage} /></>}
  </Card>;
}

type BillLine = {description: string; itemId: string; qty: string; unit: string; rate: string; gst: string};
export function BillForm({prefill, onClose, onSaved, attachment, source = 'MANUAL'}: {prefill?: {supplierId?: string; poId?: string; supplierInvoiceNo?: string; lines?: BillLine[]; freight?: string}; attachment?: StoredFile | null; source?: 'MANUAL' | 'IMPORT'; onClose: () => void; onSaved: () => void}) {
  const toast = useToast(); const sups = useSupplierOptions(), items = useItemOptions();
  const [h, setH] = useState({supplierId: prefill?.supplierId || '', invoiceNo: prefill?.supplierInvoiceNo || '', date: todayIso(), discount: '0', freight: prefill?.freight || '0', total: '', notes: '', poId: prefill?.poId || ''});
  const [lines, setLines] = useState<BillLine[]>(prefill?.lines?.length ? prefill.lines : [{description: '', itemId: '', qty: '', unit: '', rate: '', gst: '18'}]);
  const [warnings, setWarnings] = useState<string[]>([]), [checked, setChecked] = useState(false), [createPo, setCreatePo] = useState(false);
  const [openPos, setOpenPos] = useState<any[]>([]);
  const {busy, run} = useAction();
  const computed = Math.round(lines.reduce((a, l) => a + Number(l.qty || 0) * Number(l.rate || 0) * (1 + Number(l.gst || 0) / 100), 0) * 100) - Math.round(Number(h.discount || 0) * 100) + Math.round(Number(h.freight || 0) * 100);
  useEffect(() => { setChecked(false); }, [h, lines]);
  useEffect(() => { if (!h.supplierId || source !== 'IMPORT') return; void send<any>('POST', '/api/inventory/bill-import/match', {supplierId: h.supplierId, descriptions: []}).then(r => setOpenPos(r.openPurchaseOrders)).catch(() => undefined); }, [h.supplierId, source]);
  const setLine = (i: number, p: Partial<BillLine>) => setLines(lines.map((l, j) => j === i ? {...l, ...p} : l));
  const body = () => ({supplierId: h.supplierId, supplierInvoiceNo: h.invoiceNo, invoiceDate: h.date, poId: h.poId || null, discountRupees: Number(h.discount || 0), freightRupees: Number(h.freight || 0), totalRupees: Number(h.total || computed / 100), notes: h.notes, attachment: attachment || null, source,
    lines: lines.filter(l => l.description.trim()).map(l => ({description: l.description, itemId: l.itemId || null, qty: Number(l.qty || 0), unit: l.unit, rateRupees: Number(l.rate || 0), gstPct: Number(l.gst || 0)}))});
  const matchAll = async () => { const r = await run(() => send<any>('POST', '/api/inventory/bill-import/match', {supplierId: h.supplierId || undefined, descriptions: lines.map(l => l.description)})); if (r) { setLines(lines.map((l, i) => l.itemId || !r.matches[i]?.itemId ? l : {...l, itemId: r.matches[i].itemId})); setOpenPos(r.openPurchaseOrders); toast('ok', `${r.matches.filter((m: any) => m.itemId).length} of ${lines.length} line(s) matched — please confirm each match`); } };
  const check = async () => { if (!h.supplierId || !h.invoiceNo) return toast('err', 'Choose the supplier and enter the invoice number'); const r = await run(() => send<any>('POST', '/api/inventory/bills/check', body())); if (r) { setWarnings(r.warnings); setChecked(true); } };
  const save = async () => {
    if (!checked) return check();
    const r = await run(() => send<any>('POST', '/api/inventory/bills', body()), 'Draft bill saved — stock is unchanged until goods are received');
    if (r && createPo) {
      const ls = lines.filter(l => l.itemId && Number(l.qty) > 0);
      const it = (id: string) => items.data?.find((x: any) => x._id === id);
      await run(() => send('POST', '/api/inventory/purchase-orders', {supplierId: h.supplierId, supplierInvoiceNo: h.invoiceNo, notes: `Created from imported bill ${r.number}`, attachments: attachment ? [attachment] : [], freightRupees: Number(h.freight || 0), lines: ls.map(l => ({itemId: l.itemId, unit: l.unit || it(l.itemId)?.stockUnit, qty: Number(l.qty), rateRupees: Number(l.rate || 0), discountPct: 0, gstPct: Number(l.gst || 0)}))}), 'Draft purchase order created from the bill');
    }
    if (r) onSaved();
  };
  return <Dialog title={source === 'IMPORT' ? 'Review imported bill' : 'Record supplier bill'} onClose={onClose} busy={busy} wide footer={<><small style={{marginRight: 'auto'}}>Saving creates a DRAFT bill. Post it to add the payable to the supplier ledger. Stock is never changed by a bill.</small><Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button><Button variant="ghost" onClick={check} disabled={busy}>Check for problems</Button><Button onClick={save} disabled={busy || warnings.some(w => w.startsWith('DUPLICATE:'))}>{checked ? 'Save draft bill' : 'Check & save'}</Button></>}>
    <div className="inv-form four">
      <Field label="Supplier *"><Select value={h.supplierId} onChange={e => setH({...h, supplierId: e.target.value})} placeholder="Choose…" options={(sups.data || []).map((s: any) => [s._id, s.name])} /></Field>
      <Field label="Supplier invoice no. *"><Input value={h.invoiceNo} onChange={e => setH({...h, invoiceNo: e.target.value})} maxLength={60} /></Field>
      <Field label="Invoice date *"><Input type="date" max={todayIso()} value={h.date} onChange={e => setH({...h, date: e.target.value})} /></Field>
      <Field label="Against purchase order"><Select value={h.poId} onChange={e => setH({...h, poId: e.target.value})} placeholder="— None —" options={openPos.map(p => [p._id, `${p.number} · ${label(p.status)}`])} /></Field>
    </div>
    <h4 style={{margin: '14px 0 8px', display: 'flex', justifyContent: 'space-between'}}>Bill lines {source === 'IMPORT' && <Button small variant="ghost" onClick={matchAll} disabled={busy}>Match to stock items</Button>}</h4>
    <div className="inv-lines">{lines.map((l, i) => <div key={i} className="inv-line" style={{gridTemplateColumns: 'minmax(160px,1.6fr) minmax(170px,1.6fr) 90px 80px 110px 80px auto'}}>
      <Field label="Description on bill"><Input value={l.description} onChange={e => setLine(i, {description: e.target.value})} /></Field>
      <Field label={l.itemId ? 'Matched stock item' : 'Stock item (unmatched)'}><ItemPicker items={items.data || []} value={l.itemId} onChange={id => setLine(i, {itemId: id, unit: l.unit || items.data?.find((x: any) => x._id === id)?.stockUnit || ''})} placeholder="— Not matched —" /></Field>
      <Field label="Qty"><Input type="number" min="0" step="any" value={l.qty} onChange={e => setLine(i, {qty: e.target.value})} /></Field>
      <Field label="Unit"><Input value={l.unit} onChange={e => setLine(i, {unit: e.target.value})} maxLength={10} /></Field>
      <Field label="Rate (₹)"><Input type="number" min="0" step="any" value={l.rate} onChange={e => setLine(i, {rate: e.target.value})} /></Field>
      <Field label="GST %"><Input type="number" min="0" max="28" step="any" value={l.gst} onChange={e => setLine(i, {gst: e.target.value})} /></Field>
      <Button small variant="ghost" aria-label="Remove line" disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, j) => j !== i))}>×</Button>
    </div>)}</div>
    <Button small variant="subtle" onClick={() => setLines([...lines, {description: '', itemId: '', qty: '', unit: '', rate: '', gst: '18'}])}>+ Add line</Button>
    <div className="inv-form four" style={{marginTop: 12}}>
      <Field label="Discount (₹)"><Input type="number" min="0" step="any" value={h.discount} onChange={e => setH({...h, discount: e.target.value})} /></Field>
      <Field label="Freight (₹)"><Input type="number" min="0" step="any" value={h.freight} onChange={e => setH({...h, freight: e.target.value})} /></Field>
      <Field label="Bill total (₹) *" hint={`Lines add up to ${rupees(computed)}`}><Input type="number" min="0" step="any" value={h.total} placeholder={(computed / 100).toFixed(2)} onChange={e => setH({...h, total: e.target.value})} /></Field>
      <Field label="Notes"><Input value={h.notes} onChange={e => setH({...h, notes: e.target.value})} /></Field>
    </div>
    {source === 'IMPORT' && <label className="inv-check" style={{marginTop: 10}}><input type="checkbox" checked={createPo} onChange={e => setCreatePo(e.target.checked)} /> Also create a DRAFT purchase order from the matched lines (for receiving the goods)</label>}
    {checked && (warnings.length ? <div className="inv-note warn"><b>Please review:</b><ul style={{margin: '6px 0 0', paddingLeft: 18}}>{warnings.map(w => <li key={w}>{w.replace(/^[A-Z_]+: ?/, '')}</li>)}</ul></div> : <div className="inv-note">No problems found.</div>)}
  </Dialog>;
}

export function ImportBillDialog({onClose, onSaved}: {onClose: () => void; onSaved: () => void}) {
  const toast = useToast();
  const cfg = useLoad(() => get<any>('/api/inventory/bill-import/config'), []);
  const [file, setFile] = useState<StoredFile | null>(null), [preview, setPreview] = useState(''), [busy, setBusy] = useState(false), [review, setReview] = useState(false);
  const pick = async (f?: File) => {
    if (!f) return;
    if (!['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(f.type)) return toast('err', 'Upload a PDF, JPG, PNG or WebP file');
    setBusy(true);
    try { const stored = await upload(f, 'bill'); setFile(stored); setPreview(f.type.startsWith('image/') ? URL.createObjectURL(f) : ''); } catch (e) { toast('err', errText(e)); } finally { setBusy(false); }
  };
  if (review && file) return <BillForm source="IMPORT" attachment={file} onClose={onClose} onSaved={onSaved} />;
  return <Dialog title="Import a bill" onClose={onClose} busy={busy} footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button><Button disabled={!file || busy} onClick={() => setReview(true)}>Continue to review</Button></>}>
    {cfg.data && <div className="inv-note">{cfg.data.message}</div>}
    <label className="inv-dropzone" style={{width: '100%', height: 180}}><input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={e => void pick(e.target.files?.[0])} /><span style={{fontSize: 15}}>{busy ? 'Uploading…' : file ? `✓ ${file.name}` : 'Choose the supplier bill (PDF or photo)'}</span><small>The original is stored securely and attached to the bill · max 10 MB</small></label>
    {preview && <img src={preview} alt="Bill preview" style={{maxWidth: '100%', maxHeight: 360, marginTop: 12, borderRadius: 10, border: '1px solid var(--line)'}} />}
    {file && !preview && <div style={{marginTop: 10}}><FileButton file={file} /></div>}
    <small style={{display: 'block', marginTop: 10}}>Next you will enter or correct supplier, invoice number, date, lines, GST and total, match lines to stock items and see duplicate and total checks. Nothing reaches stock until the goods are received.</small>
  </Dialog>;
}

function Bills() {
  const can = useCan();
  const [status, setStatus] = useState(''), [page, setPage] = useState(1), [form, setForm] = useState(false), [pay, setPay] = useState<any | null>(null);
  const list = useLoad(() => get<any>('/api/inventory/bills', {status, page, limit: 20}), [status, page]);
  const {busy, run} = useAction();
  const act = async (b: any, path: string, ok: string) => { if (await run(() => send('POST', `/api/inventory/bills/${b._id}/${path}`), ok)) void list.reload(); };
  return <Card title="Supplier bills" aside={can('bill.manage') && <Button onClick={() => setForm(true)}>+ Record bill</Button>}>
    <div className="inv-filters"><Select value={status} onChange={e => { setStatus(e.target.value); setPage(1); }} placeholder="All bills" options={[['UNPAID', 'Unpaid (posted)'], ['DRAFT', 'Draft'], ['PAID', 'Paid'], ['CANCELLED', 'Cancelled']]} /></div>
    <ErrorBox error={list.error} retry={list.reload} />
    {!list.data ? <Loading /> : <><Table headers={['Bill', 'Supplier', 'Invoice no.', 'Invoice date', 'Due', <span className="num">Total</span>, <span className="num">Paid</span>, 'Status', '']} empty="No bills recorded.">{list.data.items.map((b: any) => <tr key={b._id}>
      <td className="inv-mono">{b.number}{b.importId && <small>imported</small>}</td><td>{b.supplierName}</td><td>{b.supplierInvoiceNo}</td><td className="inv-nowrap">{day(b.invoiceDate)}</td><td className="inv-nowrap">{day(b.dueDate)}{b.overdue && <Chip tone="red">Overdue</Chip>}</td><td className="num">{rupees(b.totalPaise)}</td><td className="num">{rupees(b.paidPaise)}</td><td><Chip tone={BILL_TONE[b.status]}>{label(b.status)}</Chip>{b.warnings?.length > 0 && b.status === 'DRAFT' && <small>{b.warnings.length} warning(s)</small>}</td>
      <td><div className="inv-actions">{b.attachment && <FileButton file={b.attachment} />}{b.status === 'DRAFT' && can('bill.manage') && <><Button small variant="ghost" disabled={busy} onClick={() => act(b, 'cancel', 'Bill cancelled')}>Cancel</Button><Button small disabled={busy} onClick={() => act(b, 'post', 'Bill posted to the supplier ledger')}>Post</Button></>}{['POSTED', 'PARTIALLY_PAID'].includes(b.status) && can('supplierPayment.record') && <Button small variant="ghost" onClick={() => setPay(b)}>Pay</Button>}</div></td>
    </tr>)}</Table><Pager page={page} total={list.data.total} limit={20} onPage={setPage} /></>}
    {form && <BillForm onClose={() => setForm(false)} onSaved={() => { setForm(false); void list.reload(); }} />}
    {pay && <PaymentForm supplierId={pay.supplierId} bill={pay} onClose={() => setPay(null)} onSaved={() => { setPay(null); void list.reload(); }} />}
  </Card>;
}

export function PaymentForm({supplierId, bill, onClose, onSaved}: {supplierId?: string; bill?: any; onClose: () => void; onSaved: () => void}) {
  const toast = useToast(); const sups = useSupplierOptions(); const {busy, run} = useAction();
  const [f, setF] = useState({supplierId: supplierId || '', amount: bill ? String((bill.totalPaise - bill.paidPaise) / 100) : '', method: 'BANK', reference: '', date: todayIso(), notes: ''});
  const [proof, setProof] = useState<StoredFile[]>([]);
  const save = async () => {
    if (!f.supplierId || !(Number(f.amount) > 0)) return toast('err', 'Choose a supplier and enter an amount');
    const r = await run(() => send('POST', '/api/inventory/supplier-payments', {supplierId: f.supplierId, amountRupees: Number(f.amount), method: f.method, reference: f.reference, date: f.date, notes: f.notes, proof: proof[0] || null, ...(bill ? {allocations: [{billId: bill._id, amountRupees: Number(f.amount)}]} : {})}), 'Payment recorded');
    if (r) onSaved();
  };
  return <Dialog title={bill ? `Pay bill ${bill.number}` : 'Record supplier payment'} onClose={onClose} busy={busy} footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button><Button onClick={save} disabled={busy}>Record payment</Button></>}>
    <div className="inv-form">
      <Field label="Supplier"><Select value={f.supplierId} disabled={Boolean(supplierId)} onChange={e => setF({...f, supplierId: e.target.value})} placeholder="Choose…" options={(sups.data || []).map((s: any) => [s._id, s.name])} /></Field>
      <Field label="Amount (₹)" hint={bill ? `Balance ${rupees(bill.totalPaise - bill.paidPaise)}` : 'Applied to the oldest unpaid bills first'}><Input type="number" min="0" step="any" value={f.amount} onChange={e => setF({...f, amount: e.target.value})} /></Field>
      <Field label="Method"><Select value={f.method} onChange={e => setF({...f, method: e.target.value})} options={[['BANK', 'Bank transfer'], ['UPI', 'UPI'], ['CHEQUE', 'Cheque'], ['CASH', 'Cash'], ['OTHER', 'Other']]} /></Field>
      <Field label="Reference (UTR / cheque no.)"><Input value={f.reference} onChange={e => setF({...f, reference: e.target.value})} /></Field>
      <Field label="Date"><Input type="date" max={todayIso()} value={f.date} onChange={e => setF({...f, date: e.target.value})} /></Field>
      <Field label="Notes"><Input value={f.notes} onChange={e => setF({...f, notes: e.target.value})} /></Field>
      <div className="inv-field wide"><span>Payment proof</span><Attach files={proof} onChange={p => setProof(p.slice(-1))} purpose="payment" /></div>
    </div>
  </Dialog>;
}

function Payments() {
  const can = useCan();
  const [page, setPage] = useState(1), [form, setForm] = useState(false), [voiding, setVoiding] = useState<any | null>(null);
  const list = useLoad(() => get<any>('/api/inventory/supplier-payments', {page, limit: 20}), [page]);
  const sups = useSupplierOptions(); const {run} = useAction();
  const name = (id: string) => sups.data?.find((s: any) => s._id === id)?.name || '';
  return <Card title="Supplier payments" aside={can('supplierPayment.record') && <Button onClick={() => setForm(true)}>+ Record payment</Button>}>
    <ErrorBox error={list.error} retry={list.reload} />
    {!list.data ? <Loading /> : <><Table headers={['Number', 'Date', 'Supplier', 'Method', 'Reference', <span className="num">Amount</span>, 'Allocated to', 'Status', '']} empty="No payments recorded.">{list.data.items.map((p: any) => <tr key={p._id}><td className="inv-mono">{p.number}</td><td className="inv-nowrap">{day(p.date)}</td><td>{name(p.supplierId)}</td><td>{label(p.method)}</td><td>{p.reference || '—'}</td><td className="num">{rupees(p.amountPaise)}</td><td><small>{p.allocations.length} bill(s)</small></td><td>{p.status === 'VOID' ? <Chip tone="red">Void</Chip> : <Chip tone="green">Posted</Chip>}</td><td><div className="inv-actions">{p.proof && <FileButton file={p.proof} />}{p.status === 'POSTED' && can('purchase.approve') && <Button small variant="ghost" onClick={() => setVoiding(p)}>Void</Button>}</div></td></tr>)}</Table><Pager page={page} total={list.data.total} limit={20} onPage={setPage} /></>}
    {form && <PaymentForm onClose={() => setForm(false)} onSaved={() => { setForm(false); void list.reload(); }} />}
    {voiding && <Confirm title={`Void payment ${voiding.number}`} danger needReason="Reason for voiding" confirmLabel="Void payment" message="A reversing entry is added to the supplier ledger and the bills become unpaid again. The payment record is kept." onClose={() => setVoiding(null)} onConfirm={async reason => { if (await run(() => send('POST', `/api/inventory/supplier-payments/${voiding._id}/void`, {reason}), 'Payment voided')) void list.reload(); setVoiding(null); }} />}
  </Card>;
}

function ReturnForm({grns, onClose, onSaved}: {grns: any[]; onClose: () => void; onSaved: () => void}) {
  const toast = useToast(); const {busy, run} = useAction();
  const [grnId, setGrnId] = useState(grns[0]?._id || ''), [rows, setRows] = useState<Record<number, {qty: string; reason: string}>>({}), [notes, setNotes] = useState('');
  const grn = grns.find(g => g._id === grnId);
  const save = async () => {
    const lines = Object.entries(rows).filter(([, r]) => Number(r.qty) > 0).map(([ln, r]) => ({lineNo: Number(ln), qty: Number(r.qty), reason: r.reason}));
    if (!lines.length) return toast('err', 'Enter a quantity to return');
    if (lines.some(l => l.reason.trim().length < 2)) return toast('err', 'Give a reason for each returned line');
    if (await run(() => send('POST', '/api/inventory/purchase-returns', {grnId, notes, lines}), 'Returned to supplier — stock reduced and debit note recorded')) onSaved();
  };
  return <Dialog title="Return to supplier" onClose={onClose} busy={busy} footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button><Button variant="danger" onClick={save} disabled={busy}>Post return</Button></>}>
    <Field label="Goods receipt"><Select value={grnId} onChange={e => { setGrnId(e.target.value); setRows({}); }} options={grns.map(g => [g._id, `${g.number} · ${day(g.receivedDate)}`])} /></Field>
    {grn && <Table headers={['Item', <span className="num">Accepted</span>, 'Return qty', 'Reason']}>{grn.lines.filter((l: any) => l.acceptedM).map((l: any) => <tr key={l.lineNo}><td>{l.itemName}</td><td className="num">{qty(l.acceptedM, l.stockUnit)}</td><td><Input type="number" min="0" step="any" style={{width: 100}} value={rows[l.lineNo]?.qty || ''} onChange={e => setRows({...rows, [l.lineNo]: {qty: e.target.value, reason: rows[l.lineNo]?.reason || ''}})} /></td><td><Input value={rows[l.lineNo]?.reason || ''} onChange={e => setRows({...rows, [l.lineNo]: {qty: rows[l.lineNo]?.qty || '', reason: e.target.value}})} /></td></tr>)}</Table>}
    <Field label="Notes"><TextArea value={notes} onChange={e => setNotes(e.target.value)} /></Field>
  </Dialog>;
}

function Returns() {
  const [page, setPage] = useState(1);
  const list = useLoad(() => get<any>('/api/inventory/purchase-returns', {page, limit: 20}), [page]);
  return <Card title="Purchase returns" aside={<small>Create a return from the purchase order → “Return to supplier”.</small>}>
    <ErrorBox error={list.error} retry={list.reload} />
    {!list.data ? <Loading /> : <><Table headers={['Number', 'Date', 'Supplier', 'GRN', 'Items', <span className="num">Debit note</span>, 'By']} empty="No returns.">{list.data.items.map((r: any) => <tr key={r._id}><td className="inv-mono">{r.number}</td><td className="inv-nowrap">{day(r.createdAt)}</td><td>{r.supplierName}</td><td className="inv-mono">{r.grnNumber}</td><td>{r.lines.map((l: any) => <small key={l.lineNo}>{l.itemName} −{qty(l.qtyM)} ({l.reason})</small>)}</td><td className="num">{rupees(r.totalValuePaise)}</td><td>{r.createdBy?.name}</td></tr>)}</Table><Pager page={page} total={list.data.total} limit={20} onPage={setPage} /></>}
  </Card>;
}

function Reorder() {
  const alerts = useLoad(() => get<any>('/api/inventory/alerts'), []);
  const [sel, setSel] = useState<string[]>([]); const {busy, run} = useAction(); const [result, setResult] = useState<any>(null);
  const make = async () => { const r = await run(() => send<any>('POST', '/api/inventory/alerts/purchase-drafts', {itemIds: sel})); if (r) { setResult(r); setSel([]); void alerts.reload(); } };
  const a = alerts.data;
  return <>
    <Card title="Reorder suggestions" aside={<Button disabled={!sel.length || busy} onClick={make}>Create purchase drafts ({sel.length})</Button>}>
      <div className="inv-note">Suggested quantity = maximum stock − (available + already on order), rounded up to whole units. Drafts are grouped by preferred supplier and are <b>never</b> submitted or sent automatically — review rates and GST before submitting.</div>
      {result && <div className="inv-note">{result.created.length ? `Created ${result.created.join(', ')}.` : 'No drafts created.'} {result.skipped.length ? `Skipped: ${result.skipped.join('; ')}` : ''}</div>}
      <ErrorBox error={alerts.error} retry={alerts.reload} />
      {!a ? <Loading /> : <Table headers={['', 'Item', 'Status', <span className="num">Available</span>, <span className="num">Reorder level</span>, <span className="num">On order</span>, <span className="num">Suggested</span>, 'Preferred supplier', 'Lead time']} empty="Nothing is below its reorder level.">{a.reorder.map((s: any) => <tr key={s.itemId}><td><input type="checkbox" aria-label={`Select ${s.name}`} checked={sel.includes(s.itemId)} onChange={e => setSel(e.target.checked ? [...sel, s.itemId] : sel.filter(x => x !== s.itemId))} /></td><td><strong>{s.name}</strong><small className="inv-mono">{s.code}</small></td><td>{s.status === 'OUT' ? <Chip tone="red">Out</Chip> : <Chip tone="amber">Low</Chip>}</td><td className="num">{qty(s.availableM, s.unit)}</td><td className="num">{qty(s.reorderLevelM)}</td><td className="num">{qty(s.onOrderM)}</td><td className="num">{s.suggestedM == null ? <small>Set max stock</small> : qty(s.suggestedM, s.unit)}</td><td>{s.preferredSupplierName || <small>None</small>}</td><td>{s.leadTimeDays == null ? '—' : `${s.leadTimeDays} d`}</td></tr>)}</Table>}
    </Card>
    {a && (a.overduePurchaseOrders.length > 0 || a.productionShortages.length > 0) && <div className="inv-cols even">
      <Card title="Overdue deliveries">{a.overduePurchaseOrders.length ? a.overduePurchaseOrders.map((p: any) => <div className="inv-row" key={p._id}><span className="inv-dot red" /><div className="grow"><strong>{p.number}</strong><small>{p.supplierName} · expected {day(p.expectedDate)}</small></div>{poChip(p.status)}</div>) : <small>None.</small>}</Card>
      <Card title="Production shortages">{a.productionShortages.length ? a.productionShortages.map((o: any) => <div className="inv-row" key={o._id}><span className="inv-dot amber" /><div className="grow"><strong>{o.number} · {o.productName}</strong><small>{o.short.map((s: any) => `${s.itemName}: need ${qty(s.neededM)}, have ${qty(s.availableM)} ${s.unit}`).join('; ')}</small></div></div>) : <small>None.</small>}</Card>
    </div>}
  </>;
}
void apiBase;
