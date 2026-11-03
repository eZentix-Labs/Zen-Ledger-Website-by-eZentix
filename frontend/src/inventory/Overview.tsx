import React, {useState} from 'react';
import {dateTime, get, label, qty, rupees, shiftDays, todayIso} from './api';
import {Button, Card, ErrorBox, Input, Loading, Segment, useLoad} from './ui';
import type {Nav} from './InventoryPage';

type Range = 'today' | '7d' | '30d' | 'month' | 'custom';
const RANGES: Array<[Range, string]> = [['today', 'Today'], ['7d', '7 days'], ['30d', '30 days'], ['month', 'This month'], ['custom', 'Custom']];
const RANGE_TEXT: Record<Range, string> = {today: 'today', '7d': 'last 7 days', '30d': 'last 30 days', month: 'this month', custom: 'custom range'};
function bounds(r: Range, custom: {from: string; to: string}) {
  const t = todayIso();
  if (r === 'today') return {from: t, to: t};
  if (r === '7d') return {from: shiftDays(t, -6), to: t};
  if (r === '30d') return {from: shiftDays(t, -29), to: t};
  if (r === 'month') return {from: t.slice(0, 8) + '01', to: t};
  return custom;
}
// "How inventory changes stock": the rules the backend actually enforces.
const FLOW: Array<[string, string, string]> = [
  ['green', 'Purchase receipt increases raw material stock', 'Only the quantity accepted on a goods receipt is added. A purchase order never changes stock.'],
  ['blue', 'Material issue moves materials into production', 'Stock leaves the store once, when material is issued to an approved production order.'],
  ['violet', 'Production consumption tracks actual usage', 'Issued material is classified as consumed, returned or wasted on the production order.'],
  ['amber', 'Wastage records manufacturing loss', 'Production wastage is recorded against material already issued, so it is never deducted twice. Store wastage deducts only after approval.'],
  ['green', 'Production completion adds approved finished goods', 'Only almirahs that pass quality inspection enter finished stock.'],
  ['red', 'Sales dispatch reduces finished goods stock', 'Stock falls once, when an order is dispatched. Pending or approved orders only reserve it.'],
];
const DOT: Record<string, string> = {green: 'var(--iv-gr)', blue: 'var(--iv-bl)', violet: 'var(--iv-ac)', amber: 'var(--iv-am)', red: 'var(--iv-rd)'};
const SERIES: Array<[string, string, string]> = [['purchasesPaise', 'Purchases', 's1'], ['consumptionPaise', 'Material consumption', 's2'], ['productionPaise', 'Production output', 's3'], ['wastagePaise', 'Wastage', 's4']];

function TrendChart({trends}: {trends: any[]}) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const [tip, setTip] = useState<{x: number; y: number; title: string; value: string} | null>(null);
  const max = Math.max(1, ...trends.flatMap(t => SERIES.map(([k]) => t[k] || 0)));
  const month = (m: string) => new Date(m + '-01T00:00:00').toLocaleDateString('en-IN', {month: 'short', year: '2-digit'});
  return <Card title="Monthly purchases, consumption, production & wastage" aside={<Segment value={view} onChange={setView} options={[['chart', 'Chart'], ['table', 'Table']]} />}>
    {view === 'chart' ? <>
      <div className="inv-bars" role="img" aria-label="Monthly values by type; switch to Table for exact figures">
        {trends.map(t => <div className="col" key={t.month}><div className="stack">{SERIES.map(([k, l, c]) => <i key={k} className={c} style={{height: `${(t[k] || 0) / max * 100}%`}} onMouseMove={e => setTip({x: e.clientX + 12, y: e.clientY + 12, title: `${l} · ${month(t.month)}`, value: rupees(t[k] || 0)})} onMouseLeave={() => setTip(null)} />)}</div><span className="lbl">{month(t.month)}</span></div>)}
      </div>
      <div className="inv-legend">{SERIES.map(([k, l, c]) => <span key={k}><i className={c} />{l}</span>)}</div>
      {tip && <div className="inv-tip" style={{left: tip.x, top: tip.y}}><b>{tip.title}</b>{tip.value}</div>}
    </> : <div className="inv-table-wrap"><table className="inv-table"><thead><tr><th>Month</th>{SERIES.map(([k, l]) => <th key={k} className="num">{l}</th>)}</tr></thead><tbody>{trends.map(t => <tr key={t.month}><td>{month(t.month)}</td>{SERIES.map(([k]) => <td key={k} className="num">{rupees(t[k] || 0)}</td>)}</tr>)}</tbody></table></div>}
  </Card>;
}

export function Overview({nav}: {nav: Nav}) {
  const [range, setRange] = useState<Range>('30d'), [custom, setCustom] = useState({from: shiftDays(todayIso(), -29), to: todayIso()});
  const b = bounds(range, custom);
  const {data: d, error, loading, reload} = useLoad(() => get('/api/inventory/dashboard', b), [b.from, b.to]);
  const alerts = useLoad(() => get('/api/inventory/alerts'), []);
  if (!d) return error ? <ErrorBox error={error} retry={reload} /> : <Loading text="Loading overview…" />;
  const m = d.metrics, cc = d.costControl, c = d.completeness;
  const tile = (title: string, value: React.ReactNode, sub: React.ReactNode, color: string, go: string, onGo: () => void) => <div className="inv-tile"><span>{title}</span><div className={`v ${color}`}>{value}</div><small>{sub}</small><button className="go" type="button" onClick={onGo}>{go}</button></div>;
  const incomplete = cc ? cc.incomplete.uncostedMovements + cc.incomplete.uncostedWastage + cc.incomplete.uncostedStockItems : 0;
  const attention: Array<{dot: string; title: string; sub: string; label: string; go: () => void}> = [];
  for (const r of (alerts.data?.reorder || []).slice(0, 6)) attention.push({dot: r.status === 'OUT' ? 'red' : 'amber', title: `${r.name} ${r.status === 'OUT' ? 'is out of stock' : 'is at reorder level'}`, sub: `${qty(r.availableM)} ${r.unit} available${r.reorderLevelM != null ? ` · reorder at ${qty(r.reorderLevelM)}` : ''}${r.onOrderM ? ` · ${qty(r.onOrderM)} on order` : ''}`, label: 'Order', go: () => nav('purchases', 'reorder')});
  const appr: Array<[string, number, Parameters<Nav>[0], string?]> = [['purchase order', m.approvals.purchaseOrders, 'purchases'], ['wastage record', m.approvals.wastage, 'wastage'], ['stock adjustment', m.approvals.adjustments, 'count', 'adjustments'], ['stock count', m.approvals.stockCounts, 'count'], ['BOM version', m.approvals.boms, 'production', 'bom'], ['production order', m.approvals.production, 'production']];
  for (const [l, n, t, s] of appr) if (n) attention.push({dot: 'blue', title: `${n} ${l}${n === 1 ? '' : 's'} waiting for approval`, sub: 'Approvals are recorded with who approved and when', label: 'Review', go: () => nav(t, s)});
  for (const p of (alerts.data?.overduePurchaseOrders || []).slice(0, 4)) attention.push({dot: 'red', title: `${p.number} from ${p.supplierName} is overdue`, sub: `expected ${new Date(p.expectedDate).toLocaleDateString('en-IN')}`, label: 'Open', go: () => nav('purchases')});
  for (const o of (alerts.data?.productionShortages || []).slice(0, 4)) attention.push({dot: 'amber', title: `${o.number} · ${o.productName} is short of material`, sub: o.short.map((s: any) => s.itemName).join(', '), label: 'Open', go: () => nav('production')});

  return <>
    {cc && <Card title={<h3>Manufacturing cost control · {RANGE_TEXT[range]}</h3>} aside={<><Segment value={range} onChange={setRange} options={RANGES} />{range === 'custom' && <><Input type="date" value={custom.from} max={custom.to} onChange={e => setCustom({...custom, from: e.target.value})} aria-label="From" style={{width: 145}} /><Input type="date" value={custom.to} min={custom.from} max={todayIso()} onChange={e => setCustom({...custom, to: e.target.value})} aria-label="To" style={{width: 145}} /></>}<Button variant="ghost" small disabled={loading} onClick={reload}>{loading ? 'Refreshing…' : 'Refresh'}</Button></>}>
      <div className="inv-tiles">
        {tile('Material purchase cost', rupees(cc.purchaseCostPaise), `${cc.purchaseReceipts} receipt line(s) · GST excluded`, '', 'Open purchases', () => nav('purchases'))}
        {tile('Material consumption cost', rupees(cc.materialConsumptionPaise), 'issued to production, less returns', '', 'View production', () => nav('production'))}
        {tile('Production cost', rupees(cc.productionCostPaise), `${cc.unitsProduced} almirah(s) finished`, '', 'View production', () => nav('production'))}
        {tile('Wastage cost', rupees(cc.wastageCostPaise), `${cc.wastageRecords} approved record(s)`, cc.wastageCostPaise ? 'red' : '', 'See wastage', () => nav('wastage'))}
        {tile('Stock on hand', rupees(cc.stockValuePaise), `${m.lowStock + m.outOfStock} item(s) to reorder`, '', 'Open stock', () => nav('raw'))}
        {tile('Stock movements today', d.movementsToday.total, Object.entries(d.movementsToday.byType).map(([k, v]) => `${v} ${label(k).toLowerCase()}`).join(' · ') || 'none yet today', '', 'Open history', () => nav('history'))}
      </div>
      {incomplete > 0 && <div className="inv-note warn" style={{marginBottom: 0, marginTop: 10}}>Some values are incomplete: {cc.incomplete.uncostedStockItems ? `${cc.incomplete.uncostedStockItems} stocked item(s) have no cost; ` : ''}{cc.incomplete.uncostedMovements ? `${cc.incomplete.uncostedMovements} movement(s) in this period had no cost; ` : ''}{cc.incomplete.uncostedWastage ? `${cc.incomplete.uncostedWastage} wastage record(s) had no cost. ` : ''}They are left out of the totals rather than guessed.</div>}
    </Card>}
    {!cc && <div className="inv-note">Cost figures are visible to roles with valuation access.</div>}

    <div className="inv-cols">
      <Card title={<h3>Inventory records complete</h3>} aside={<b className="inv-bigpct" style={{color: c.pct >= 85 ? 'var(--iv-gr)' : 'var(--iv-am)'}}>{c.pct}%</b>}>
        <div className="inv-meter big"><i style={{width: `${c.pct}%`}} /></div>
        <small>Stock value and manufacturing cost are only as true as these records. {c.passed} of {c.total} checks pass.</small>
        <div style={{marginTop: 6}}>{c.checks.map((k: any) => <div className="inv-check-row" key={k.key}><span className={k.passed ? 'ok' : 'no'} aria-label={k.passed ? 'Passed' : 'Needs attention'}>{k.passed ? '✓' : '✗'}</span><div>{k.label}<small>{k.passed ? (k.total ? `all ${k.total} OK` : 'nothing to check yet') : `${k.failingCount} to fix${k.failing.length ? `: ${k.failing.slice(0, 3).join(', ')}${k.failingCount > 3 ? '…' : ''}` : ''}`}</small></div>{k.passed ? <span /> : <Button small variant="ghost" onClick={() => nav(k.action.tab, k.action.sub)}>Fix</Button>}</div>)}</div>
      </Card>
      <Card title={<h3>How inventory changes stock</h3>}>
        <div className="inv-flowlist">{FLOW.map(([dot, t, p]) => <div className="inv-row" key={t}><span className="inv-dot" style={{background: DOT[dot], marginTop: 6}} /><div className="grow"><b>{t}</b><small>{p}</small></div></div>)}</div>
        <small style={{display: 'block', marginTop: 8}}>Every change is written to History with who did it, the reference document and the quantity before and after. Mistakes are corrected with a reversal, never by editing or deleting.</small>
      </Card>
    </div>

    <div className="inv-cols">
      <Card title={<h3>Needs attention</h3>}>{alerts.error ? <ErrorBox error={alerts.error} retry={alerts.reload} /> : !alerts.data ? <Loading /> : attention.length ? attention.map((a, i) => <div className="inv-row" key={i}><span className={`inv-dot ${a.dot === 'green' ? '' : a.dot}`} /><div className="grow">{a.title}<small>{a.sub}</small></div><Button small variant="ghost" onClick={a.go}>{a.label}</Button></div>) : <small>All clear — nothing is low, overdue or waiting for approval.</small>}</Card>
      <Card title={<h3>Recent stock movements</h3>} aside={<Button variant="ghost" small onClick={() => nav('history')}>All history</Button>}>
        {d.recentMovements.length ? d.recentMovements.map((r: any) => <div className="inv-row" key={r._id}><span className={`inv-dot ${r.qtyOutM ? 'amber' : r.qtyInM ? '' : 'blue'}`} /><div className="grow">{r.itemName}<small>{label(r.type)} · {r.refNumber || '—'} · {dateTime(r.at)}</small></div><span className="inv-mono">{r.qtyInM ? `+${qty(r.qtyInM)}` : r.qtyOutM ? `−${qty(r.qtyOutM)}` : 'reserved'} {r.unit}</span></div>) : <small>No stock has moved yet. Add a stock item or record a purchase to begin.</small>}
      </Card>
    </div>
    {cc && d.trends.length > 0 && <TrendChart trends={d.trends} />}
  </>;
}
