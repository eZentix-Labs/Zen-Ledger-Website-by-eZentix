import React, {useState} from 'react';
import {dateTime, downloadCsv, get, label, qty, rupees, send, shiftDays, todayIso} from './api';
import {Button, Card, Chip, Confirm, ErrorBox, Input, Loading, Pager, Search, Select, Table, useAction, useLoad, useToast, errText} from './ui';
import {useCan} from './InventoryPage';

const TYPES = ['OPENING', 'PURCHASE_RECEIPT', 'PURCHASE_RETURN', 'RESERVATION', 'RESERVATION_RELEASE', 'MATERIAL_ISSUE', 'MATERIAL_RETURN', 'PRODUCTION_OUTPUT', 'SALES_DISPATCH', 'SALES_RETURN', 'WASTAGE', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'COUNT_ADJUSTMENT', 'REVERSAL'];
const REVERSIBLE = ['OPENING', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'COUNT_ADJUSTMENT', 'WASTAGE'];

export function History() {
  const can = useCan(); const toast = useToast();
  const [f, setF] = useState({q: '', type: '', itemKind: '', itemType: '', ref: '', from: shiftDays(todayIso(), -29), to: todayIso()}), [page, setPage] = useState(1), [rev, setRev] = useState<any | null>(null);
  const list = useLoad(() => get<any>('/api/inventory/ledger', {...f, page, limit: 50}), [JSON.stringify(f), page]);
  const {run} = useAction();
  const set = (k: keyof typeof f, v: string) => { setF({...f, [k]: v}); setPage(1); };
  return <Card title="Stock history" aside={<Button variant="ghost" onClick={() => downloadCsv('/api/inventory/reports/stock-ledger', {from: f.from, to: f.to}).catch(e => toast('err', errText(e)))}>Export CSV</Button>}>
    <div className="inv-note">Every stock change is recorded here and can never be edited or deleted. Mistakes are corrected with a reversal entry that points to the original.</div>
    <div className="inv-filters">
      <Search value={f.q} onChange={v => set('q', v)} placeholder="Item name or code" />
      <Input value={f.ref} onChange={e => set('ref', e.target.value)} placeholder="Reference / txn no." style={{maxWidth: 170}} />
      <Select value={f.type} onChange={e => set('type', e.target.value)} placeholder="All movement types" options={TYPES.map(t => [t, label(t)])} />
      <Select value={f.itemKind} onChange={e => set('itemKind', e.target.value)} placeholder="Materials + finished" options={[['ITEM', 'Materials & accessories'], ['PRODUCT', 'Finished almirahs']]} />
      <Input type="date" value={f.from} max={f.to} onChange={e => set('from', e.target.value)} aria-label="From" style={{width: 150}} /><Input type="date" value={f.to} min={f.from} onChange={e => set('to', e.target.value)} aria-label="To" style={{width: 150}} />
    </div>
    <ErrorBox error={list.error} retry={list.reload} />
    {!list.data ? <Loading /> : <><Table headers={['Txn', 'When', 'Item', 'Type', 'Reference', <span className="num">Previous</span>, <span className="num">In</span>, <span className="num">Out</span>, <span className="num">New</span>, <span className="num">Unit cost</span>, <span className="num">Value</span>, 'By / approved', '']} empty="No movements in this period.">
      {list.data.items.map((r: any) => <tr key={r._id}><td className="inv-mono">{r.txnNo}</td><td><small>{dateTime(r.createdAt)}</small></td><td><strong>{r.itemName}</strong><small className="inv-mono">{r.itemCode}</small></td>
        <td>{label(r.type)}{r.reversalOf && <small>reverses earlier entry</small>}{r.reversedBy && <Chip tone="amber">Reversed</Chip>}{r.newReservedM !== r.prevReservedM && !r.qtyInM && !r.qtyOutM && <small>reserved {qty(r.prevReservedM)} → {qty(r.newReservedM)}</small>}</td>
        <td><span className="inv-mono">{r.refNumber || '—'}</span><small>{label(r.refType)}{r.reason ? ` · ${r.reason}` : ''}</small></td>
        <td className="num">{qty(r.prevM)}</td><td className="num">{r.qtyInM ? qty(r.qtyInM) : ''}</td><td className="num">{r.qtyOutM ? qty(r.qtyOutM) : ''}</td><td className="num">{qty(r.newM)} {r.unit}</td>
        <td className="num">{r.unitCostPaise === undefined ? '' : rupees(r.unitCostPaise)}</td><td className="num">{r.valuePaise === undefined ? '' : rupees(r.valuePaise)}</td>
        <td><small>{r.performedBy?.name}{r.approvedBy?.name && r.approvedBy.name !== r.performedBy?.name ? ` · ✓ ${r.approvedBy.name}` : ''}</small></td>
        <td>{can('ledger.reverse') && REVERSIBLE.includes(r.type) && !r.reversedBy && <Button small variant="ghost" onClick={() => setRev(r)}>Reverse</Button>}</td></tr>)}
    </Table><Pager page={page} total={list.data.total} limit={50} onPage={setPage} /></>}
    {rev && <Confirm title={`Reverse ${rev.txnNo}`} danger needReason="Reason for the reversal" confirmLabel="Post reversal" message={`An equal and opposite movement (${rev.qtyInM ? '−' + qty(rev.qtyInM) : '+' + qty(rev.qtyOutM)} ${rev.unit} of ${rev.itemName}) will be posted at the original cost. The original entry stays visible. A reversal that would make stock negative is refused.`} onClose={() => setRev(null)} onConfirm={async reason => { if (await run(() => send('POST', `/api/inventory/ledger/${rev._id}/reverse`, {reason}), 'Reversal posted')) void list.reload(); setRev(null); }} />}
  </Card>;
}
