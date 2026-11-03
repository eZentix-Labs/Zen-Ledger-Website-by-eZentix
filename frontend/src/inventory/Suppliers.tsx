import React, {useState} from 'react';
import {day, get, label, rupees, send} from './api';
import {Button, Card, Chip, Confirm, Dialog, ErrorBox, Field, Input, Loading, Pager, Search, Segment, Select, Table, TextArea, useAction, useLoad, useToast} from './ui';
import {useCan} from './InventoryPage';
import {PaymentForm, poChip} from './Purchases';

const CATS: Array<[string, string]> = [['STEEL', 'Steel supplier'], ['HARDWARE', 'Hardware supplier'], ['PAINT', 'Paint / powder supplier'], ['CHEMICALS', 'Chemicals supplier'], ['PACKAGING', 'Packaging supplier'], ['GENERAL', 'General supplier']];

export function Suppliers() {
  const can = useCan();
  const [q, setQ] = useState(''), [category, setCategory] = useState(''), [status, setStatus] = useState('ACTIVE'), [page, setPage] = useState(1), [form, setForm] = useState<any | null | 'new'>(null), [open, setOpen] = useState<string | null>(null);
  const list = useLoad(() => get<any>('/api/inventory/suppliers', {q, category, status, page, limit: 25}), [q, category, status, page]);
  return <Card title="Suppliers" aside={can('supplier.manage') && <Button onClick={() => setForm('new')}>+ Add supplier</Button>}>
    <div className="inv-filters"><Search value={q} onChange={v => { setQ(v); setPage(1); }} placeholder="Name, code, phone, GSTIN or contact" /><Select value={category} onChange={e => { setCategory(e.target.value); setPage(1); }} placeholder="All categories" options={CATS} /><Select value={status} onChange={e => { setStatus(e.target.value); setPage(1); }} options={[['ACTIVE', 'Active'], ['INACTIVE', 'Inactive'], ['all', 'All']]} /></div>
    <ErrorBox error={list.error} retry={list.reload} />
    {!list.data ? <Loading /> : <><Table headers={['Code', 'Supplier', 'Category', 'Contact', 'GSTIN', 'Terms', <span className="num">Outstanding</span>, 'Pending bills', 'Status', '']} empty="No suppliers yet.">
      {list.data.items.map((s: any) => <tr key={s._id}><td className="inv-mono">{s.supplierCode}</td><td><strong>{s.name}</strong><small>{s.state}</small></td><td>{CATS.find(c => c[0] === s.category)?.[1] || label(s.category)}</td><td>{s.contactPerson || '—'}<small>{s.phone}{s.email ? ` · ${s.email}` : ''}</small></td><td className="inv-mono">{s.gstin || '—'}</td><td>{s.paymentTermsDays} days</td><td className="num">{s.outstandingPaise ? <b>{rupees(s.outstandingPaise)}</b> : '—'}</td><td>{s.pendingBills || '—'}</td><td>{s.status === 'ACTIVE' ? <Chip tone="green">Active</Chip> : <Chip>Inactive</Chip>}</td><td><div className="inv-actions"><Button small variant="ghost" onClick={() => setOpen(s._id)}>View</Button>{can('supplier.manage') && <Button small variant="ghost" onClick={() => setForm(s)}>Edit</Button>}</div></td></tr>)}
    </Table><Pager page={page} total={list.data.total} limit={25} onPage={setPage} /></>}
    {form && <SupplierForm supplier={form === 'new' ? undefined : form} onClose={() => setForm(null)} onSaved={() => { setForm(null); void list.reload(); }} />}
    {open && <SupplierDetail id={open} onClose={() => setOpen(null)} onChanged={() => void list.reload()} />}
  </Card>;
}

export function SupplierForm({supplier, onClose, onSaved}: {supplier?: any; onClose: () => void; onSaved: (id?: string) => void}) {
  const toast = useToast(); const {busy, run} = useAction();
  const s = supplier || {};
  const [f, setF] = useState({supplierCode: s.supplierCode || '', name: s.name || '', category: s.category || 'STEEL', contactPerson: s.contactPerson || '', phone: s.phone || '', email: s.email || '', address: s.address || '', state: s.state || '', gstin: s.gstin || '', paymentTermsDays: String(s.paymentTermsDays ?? 30), bankName: s.bankName || '', bankAccount: s.bankAccount || '', ifsc: s.ifsc || '', notes: s.notes || '', opening: '0'});
  const up = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({...f, [k]: e.target.value});
  const save = async () => {
    if (f.name.trim().length < 2 || !f.phone.trim()) return toast('err', 'Supplier name and phone are required');
    if (f.gstin && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(f.gstin.toUpperCase())) return toast('err', 'GSTIN must be 15 characters in the standard format');
    const {opening, ...rest} = f;
    const body = {...rest, gstin: f.gstin.toUpperCase(), paymentTermsDays: Number(f.paymentTermsDays || 0)};
    const r: any = await run(() => supplier ? send('PATCH', `/api/inventory/suppliers/${supplier._id}`, {...body, revision: supplier.revision}) : send('POST', '/api/inventory/suppliers', {...body, openingBalanceRupees: Number(opening || 0)}), supplier ? 'Supplier updated' : 'Supplier added');
    if (r) onSaved(r.id || supplier?._id);
  };
  return <Dialog title={supplier ? `Edit ${supplier.name}` : 'Add supplier'} onClose={onClose} busy={busy} wide footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button><Button onClick={save} disabled={busy}>{supplier ? 'Save' : 'Add supplier'}</Button></>}>
    <div className="inv-form three">
      <Field label="Supplier name *"><Input value={f.name} onChange={up('name')} maxLength={160} /></Field>
      <Field label="Supplier code" hint={supplier ? undefined : 'Leave blank to number automatically'}><Input value={f.supplierCode} disabled={Boolean(supplier)} onChange={up('supplierCode')} maxLength={20} /></Field>
      <Field label="Category"><Select value={f.category} onChange={up('category')} options={CATS} /></Field>
      <Field label="Contact person"><Input value={f.contactPerson} onChange={up('contactPerson')} /></Field>
      <Field label="Phone *"><Input value={f.phone} onChange={up('phone')} inputMode="tel" /></Field>
      <Field label="Email"><Input type="email" value={f.email} onChange={up('email')} /></Field>
      <Field label="Address" wide><TextArea value={f.address} onChange={up('address')} /></Field>
      <Field label="State"><Input value={f.state} onChange={up('state')} placeholder="West Bengal" /></Field>
      <Field label="GSTIN"><Input value={f.gstin} onChange={up('gstin')} maxLength={15} style={{textTransform: 'uppercase'}} /></Field>
      <Field label="Payment terms (days)"><Input type="number" min="0" max="365" value={f.paymentTermsDays} onChange={up('paymentTermsDays')} /></Field>
      {!supplier && <Field label="Opening balance (₹)" hint="What you already owe this supplier"><Input type="number" step="any" value={f.opening} onChange={up('opening')} /></Field>}
      <div className="inv-section-title">Bank details (visible to Admin and Accountant only)</div>
      <Field label="Bank"><Input value={f.bankName} onChange={up('bankName')} /></Field><Field label="Account no."><Input value={f.bankAccount} onChange={up('bankAccount')} /></Field><Field label="IFSC"><Input value={f.ifsc} onChange={up('ifsc')} /></Field>
      <Field label="Notes" wide><TextArea value={f.notes} onChange={up('notes')} /></Field>
    </div>
  </Dialog>;
}

function SupplierDetail({id, onClose, onChanged}: {id: string; onClose: () => void; onChanged: () => void}) {
  const can = useCan(); const d = useLoad(() => get<any>(`/api/inventory/suppliers/${id}`), [id]);
  const [tab, setTab] = useState('statement'), [pay, setPay] = useState(false), [confirm, setConfirm] = useState(false);
  const {run} = useAction();
  const s = d.data;
  return <Dialog title={s ? s.name : 'Supplier'} onClose={onClose} wide footer={s && <>{can('supplier.manage') && <Button variant="ghost" onClick={() => setConfirm(true)}>{s.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate'}</Button>}{can('supplierPayment.record') && <Button onClick={() => setPay(true)}>Record payment</Button>}</>}>
    <ErrorBox error={d.error} retry={d.reload} />
    {!s ? <Loading /> : <>
      <div className="inv-kv" style={{marginBottom: 14}}>{[['Code', s.supplierCode], ['Category', label(s.category)], ['Contact', `${s.contactPerson || '—'} · ${s.phone}`], ['Email', s.email || '—'], ['GSTIN', s.gstin || '—'], ['Address', s.address || '—'], ['Payment terms', `${s.paymentTermsDays} days`], ['Bank', s.bankName ? `${s.bankName} · ${s.bankAccount} · ${s.ifsc}` : '—']].map(([k, v]) => <div key={k}><span>{k}</span><b>{v}</b></div>)}</div>
      <div className="inv-tiles five">
        <div className="inv-tile"><span>Opening</span><div className="v">{rupees(s.summary.openingPaise)}</div></div>
        <div className="inv-tile"><span>Purchases (bills)</span><div className="v">{rupees(s.summary.purchasesPaise)}</div></div>
        <div className="inv-tile"><span>Returns</span><div className="v">{rupees(s.summary.returnsPaise)}</div></div>
        <div className="inv-tile"><span>Payments</span><div className="v">{rupees(s.summary.paymentsPaise)}</div></div>
        <div className="inv-tile"><span>Outstanding</span><div className={`v ${s.summary.outstandingPaise > 0 ? 'amber' : 'green'}`}>{rupees(s.summary.outstandingPaise)}</div><small>{s.summary.pendingBills} pending · {s.summary.overdueBills} overdue</small></div>
      </div>
      <Segment value={tab} onChange={setTab} options={[['statement', 'Ledger statement'], ['pos', `Purchase orders (${s.purchaseOrders.length})`], ['bills', `Bills (${s.bills.length})`], ['payments', `Payments (${s.payments.length})`], ['returns', `Returns (${s.returns.length})`], ['items', `Materials supplied (${s.suppliedItems.length})`]]} />
      <div style={{marginTop: 12}}>
        {tab === 'statement' && <Table headers={['Date', 'Type', 'Reference', 'Notes', <span className="num">Debit (owed)</span>, <span className="num">Credit (paid / returned)</span>, <span className="num">Balance</span>]} empty="No transactions yet.">{s.statement.map((e: any) => <tr key={e._id}><td>{day(e.date)}</td><td>{label(e.type)}</td><td className="inv-mono">{e.refNumber || '—'}</td><td><small>{e.notes}</small></td><td className="num">{e.amountPaise > 0 ? rupees(e.amountPaise) : ''}</td><td className="num">{e.amountPaise < 0 ? rupees(-e.amountPaise) : ''}</td><td className="num"><b>{rupees(e.balancePaise)}</b></td></tr>)}</Table>}
        {tab === 'pos' && <Table headers={['PO', 'Date', 'Expected', <span className="num">Total</span>, 'Status']}>{s.purchaseOrders.map((p: any) => <tr key={p._id}><td className="inv-mono">{p.number}</td><td>{day(p.orderDate)}</td><td>{day(p.expectedDate)}</td><td className="num">{rupees(p.totalPaise)}</td><td>{poChip(p.status)}</td></tr>)}</Table>}
        {tab === 'bills' && <Table headers={['Bill', 'Invoice no.', 'Date', 'Due', <span className="num">Total</span>, <span className="num">Paid</span>, 'Status']}>{s.bills.map((b: any) => <tr key={b._id}><td className="inv-mono">{b.number}</td><td>{b.supplierInvoiceNo}</td><td>{day(b.invoiceDate)}</td><td>{day(b.dueDate)}</td><td className="num">{rupees(b.totalPaise)}</td><td className="num">{rupees(b.paidPaise)}</td><td><Chip>{label(b.status)}</Chip></td></tr>)}</Table>}
        {tab === 'payments' && <Table headers={['Number', 'Date', 'Method', 'Reference', <span className="num">Amount</span>, 'Status']}>{s.payments.map((p: any) => <tr key={p._id}><td className="inv-mono">{p.number}</td><td>{day(p.date)}</td><td>{label(p.method)}</td><td>{p.reference || '—'}</td><td className="num">{rupees(p.amountPaise)}</td><td>{label(p.status)}</td></tr>)}</Table>}
        {tab === 'returns' && <Table headers={['Number', 'Date', 'GRN', <span className="num">Value</span>]}>{s.returns.map((r: any) => <tr key={r._id}><td className="inv-mono">{r.number}</td><td>{day(r.createdAt)}</td><td className="inv-mono">{r.grnNumber}</td><td className="num">{rupees(r.totalValuePaise)}</td></tr>)}</Table>}
        {tab === 'items' && <Table headers={['Code', 'Material', 'Unit']} empty="Set this supplier as the preferred supplier on materials to list them here.">{s.suppliedItems.map((i: any) => <tr key={i._id}><td className="inv-mono">{i.code}</td><td>{i.name}</td><td>{i.stockUnit}</td></tr>)}</Table>}
      </div>
    </>}
    {pay && s && <PaymentForm supplierId={s._id} onClose={() => setPay(false)} onSaved={() => { setPay(false); void d.reload(); onChanged(); }} />}
    {confirm && s && <Confirm title={s.status === 'ACTIVE' ? 'Deactivate supplier' : 'Reactivate supplier'} message={s.status === 'ACTIVE' ? 'Inactive suppliers cannot receive new purchase orders. History is kept.' : 'The supplier can be used for purchases again.'} onClose={() => setConfirm(false)} onConfirm={async () => { if (await run(() => send('POST', `/api/inventory/suppliers/${s._id}/status`, {status: s.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE'}), 'Supplier updated')) { void d.reload(); onChanged(); } setConfirm(false); }} />}
  </Dialog>;
}
