import React, {useState} from 'react';
import {compactRupees, dateTime, get, label, qty, rupees, shiftDays, todayIso} from './api';
import {Button, Card, Dialog, ErrorBox, Input, Loading, Segment, useLoad} from './ui';
import type {Nav} from './InventoryPage';

type Range = 'today' | '7d' | '30d' | 'month' | 'custom';
const RANGES: Array<[Range, string]> = [['today', 'Today'], ['7d', '7 days'], ['30d', '30 days'], ['month', 'This month'], ['custom', 'Custom']];
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
  return <div className="inv-trend">
    <div className="inv-trend-head"><h4>Month by month</h4><Segment value={view} onChange={setView} options={[['chart', 'Chart'], ['table', 'Table']]} /></div>
    {view === 'chart' ? <>
      <div className="inv-bars" role="img" aria-label="Monthly values by type; switch to Table for exact figures">
        {trends.map(t => <div className="col" key={t.month}><div className="stack">{SERIES.map(([k, l, c]) => <i key={k} className={c} style={{height: `${(t[k] || 0) / max * 100}%`}} onMouseMove={e => setTip({x: e.clientX + 12, y: e.clientY + 12, title: `${l} · ${month(t.month)}`, value: rupees(t[k] || 0)})} onMouseLeave={() => setTip(null)} />)}</div><span className="lbl">{month(t.month)}</span></div>)}
      </div>
      <div className="inv-legend">{SERIES.map(([k, l, c]) => <span key={k}><i className={c} />{l}</span>)}</div>
      {tip && <div className="inv-tip" style={{left: tip.x, top: tip.y}}><b>{tip.title}</b>{tip.value}</div>}
    </> : <div className="inv-table-wrap"><table className="inv-table"><thead><tr><th>Month</th>{SERIES.map(([k, l]) => <th key={k} className="num">{l}</th>)}</tr></thead><tbody>{trends.map(t => <tr key={t.month}><td>{month(t.month)}</td>{SERIES.map(([k]) => <td key={k} className="num">{rupees(t[k] || 0)}</td>)}</tr>)}</tbody></table></div>}
  </div>;
}

function Stat({name, value, note, alert, title, onClick}: {name: string; value: React.ReactNode; note: React.ReactNode; alert?: 'red' | 'amber'; title?: string; onClick: () => void}) {
  return <button type="button" className="inv-stat" onClick={onClick}><span>{name}</span><b title={title}>{value}</b><small>{alert && <i className={`inv-dot ${alert}`} aria-hidden="true" />}{note}</small></button>;
}

const SEVERITY: Record<string, number> = {red: 0, amber: 1, blue: 2};
const SHOWN = 6;

export function Overview({nav}: {nav: Nav}) {
  const [range, setRange] = useState<Range>('30d'), [custom, setCustom] = useState({from: shiftDays(todayIso(), -29), to: todayIso()});
  const [allAttention, setAllAttention] = useState(false), [dialog, setDialog] = useState<'health' | 'flow' | null>(null);
  const b = bounds(range, custom);
  const {data: d, error, loading, reload} = useLoad(() => get('/api/inventory/dashboard', b), [b.from, b.to]);
  const alerts = useLoad(() => get('/api/inventory/alerts'), []);
  if (!d) return error ? <ErrorBox error={error} retry={reload} /> : <Loading text="Loading overview…" />;
  const m = d.metrics, cc = d.costControl, c = d.completeness;
  const incomplete = cc ? cc.incomplete.uncostedMovements + cc.incomplete.uncostedWastage + cc.incomplete.uncostedStockItems : 0;
  const attention: Array<{dot: string; title: string; sub: string; label: string; go: () => void}> = [];
  for (const r of alerts.data?.reorder || []) attention.push({dot: r.status === 'OUT' ? 'red' : 'amber', title: `${r.name} ${r.status === 'OUT' ? 'is out of stock' : 'is at reorder level'}`, sub: `${qty(r.availableM)} ${r.unit} available${r.reorderLevelM != null ? ` · reorder at ${qty(r.reorderLevelM)}` : ''}${r.onOrderM ? ` · ${qty(r.onOrderM)} on order` : ''}`, label: 'Order', go: () => nav('purchases', 'reorder')});
  const appr: Array<[string, number, Parameters<Nav>[0], string?]> = [['purchase order', m.approvals.purchaseOrders, 'purchases', 'orders'], ['wastage record', m.approvals.wastage, 'wastage'], ['stock adjustment', m.approvals.adjustments, 'count', 'adjustments'], ['stock count', m.approvals.stockCounts, 'count', 'counts'], ['BOM version', m.approvals.boms, 'production', 'bom'], ['production order', m.approvals.production, 'production', 'orders']];
  for (const [l, n, t, s] of appr) if (n) attention.push({dot: 'blue', title: `${n} ${l}${n === 1 ? '' : 's'} waiting for approval`, sub: 'Needs a decision', label: 'Review', go: () => nav(t, s)});
  const overdue: any[] = alerts.data?.overduePurchaseOrders || [];
  if (overdue.length === 1) attention.push({dot: 'red', title: `${overdue[0].number} from ${overdue[0].supplierName} is overdue`, sub: `Expected ${new Date(overdue[0].expectedDate).toLocaleDateString('en-IN')}`, label: 'Open', go: () => nav('purchases', 'orders')});
  else if (overdue.length) { const suppliers = [...new Set(overdue.map(p => p.supplierName))]; attention.push({dot: 'red', title: `${overdue.length} purchase orders are overdue`, sub: `${suppliers.slice(0, 2).join(', ')}${suppliers.length > 2 ? ` and ${suppliers.length - 2} more` : ''}`, label: 'Review', go: () => nav('purchases', 'orders')}); }
  for (const o of alerts.data?.productionShortages || []) attention.push({dot: 'amber', title: `${o.number} · ${o.productName} is short of material`, sub: o.short.map((s: any) => s.itemName).join(', '), label: 'Open', go: () => nav('production', 'orders')});
  attention.sort((x, y) => SEVERITY[x.dot] - SEVERITY[y.dot]);
  const shown = allAttention ? attention : attention.slice(0, SHOWN);
  const firstApproval = appr.find(a => a[1] > 0);
  const toReorder = m.lowStock + m.outOfStock;
  const period: Array<[string, number]> = cc ? [['Purchases', cc.purchaseCostPaise], ['Material used', cc.materialConsumptionPaise], ['Production cost', cc.productionCostPaise], ['Wastage', cc.wastageCostPaise]] : [];
  const toFix = c.total - c.passed;

  return <>
    <div className="inv-stats">
      {cc ? <Stat name="Stock value" value={compactRupees(cc.stockValuePaise)} title={rupees(cc.stockValuePaise)} note={`${compactRupees(m.finishedGoodsValuePaise)} finished goods`} onClick={() => nav('finished')} /> : <Stat name="Finished units" value={m.finishedUnits.toLocaleString('en-IN')} note={`${m.finishedProducts} products`} onClick={() => nav('finished')} />}
      <Stat name="To reorder" value={toReorder} alert={m.outOfStock ? 'red' : toReorder ? 'amber' : undefined} note={m.outOfStock ? `${m.outOfStock} out of stock` : toReorder ? 'at or below reorder level' : 'All stock is healthy'} onClick={() => nav('purchases', 'reorder')} />
      <Stat name="Waiting for approval" value={m.pendingApprovals} note={m.pendingApprovals ? 'need a decision' : 'Nothing is waiting'} onClick={() => firstApproval ? nav(firstApproval[2], firstApproval[3]) : nav('purchases', 'orders')} />
      <Stat name="In production" value={m.activeProduction} note={m.activeProduction === 1 ? 'order running' : 'orders running'} onClick={() => nav('wip')} />
    </div>

    <div className="inv-ov-cols">
      <Card title={<h3>Needs attention{attention.length ? <span className="inv-count quiet">{attention.length}</span> : null}</h3>}>
        {alerts.error ? <ErrorBox error={alerts.error} retry={alerts.reload} /> : !alerts.data ? <Loading /> : attention.length ? <>
          {shown.map((a, i) => <div className="inv-row" key={i}><span className={`inv-dot ${a.dot}`} aria-hidden="true" /><div className="grow">{a.title}<small>{a.sub}</small></div><Button small variant="ghost" onClick={a.go}>{a.label}</Button></div>)}
          {attention.length > SHOWN && <Button variant="subtle" onClick={() => setAllAttention(v => !v)}>{allAttention ? 'Show fewer' : `Show all ${attention.length}`}</Button>}
        </> : <small>All clear. Nothing is low, overdue or waiting for approval.</small>}
      </Card>
      <Card title={<h3>Recent movements</h3>} aside={<Button variant="subtle" onClick={() => nav('history')}>View all</Button>}>
        {d.recentMovements.length ? d.recentMovements.slice(0, SHOWN).map((r: any) => <div className="inv-row" key={r._id}><div className="grow">{r.itemName}<small>{label(r.type)} · {dateTime(r.at)}</small></div><span className="inv-mono">{r.qtyInM ? `+${qty(r.qtyInM)} ${r.unit}` : r.qtyOutM ? `−${qty(r.qtyOutM)} ${r.unit}` : 'Reserved'}</span></div>) : <small>No stock has moved yet. Add a stock item or record a purchase to begin.</small>}
      </Card>
    </div>

    {cc ? <Card title={<h3>Spend and output</h3>} aside={<><Segment value={range} onChange={setRange} options={RANGES} />{range === 'custom' && <><Input type="date" value={custom.from} max={custom.to} onChange={e => setCustom({...custom, from: e.target.value})} aria-label="From" style={{width: 145}} /><Input type="date" value={custom.to} min={custom.from} max={todayIso()} onChange={e => setCustom({...custom, to: e.target.value})} aria-label="To" style={{width: 145}} /></>}</>}>
      <div className="inv-period" aria-busy={loading}>{period.map(([l, v]) => <div key={l}><span>{l}</span><b title={rupees(v)}>{compactRupees(v)}</b></div>)}<div><span>Almirahs finished</span><b>{cc.unitsProduced}</b></div></div>
      {incomplete > 0 && <div className="inv-note warn" style={{marginBottom: 0}}>Some values are incomplete: {cc.incomplete.uncostedStockItems ? `${cc.incomplete.uncostedStockItems} stocked item(s) have no cost; ` : ''}{cc.incomplete.uncostedMovements ? `${cc.incomplete.uncostedMovements} movement(s) in this period had no cost; ` : ''}{cc.incomplete.uncostedWastage ? `${cc.incomplete.uncostedWastage} wastage record(s) had no cost. ` : ''}They are left out of the totals rather than guessed.</div>}
      {d.trends.length > 0 && <TrendChart trends={d.trends} />}
    </Card> : <div className="inv-note">Cost figures are visible to roles with valuation access.</div>}

    <div className="inv-ov-foot">
      <button type="button" onClick={() => setDialog('health')}>Records {c.pct}% complete{toFix ? ` · ${toFix} to fix` : ''}</button>
      <button type="button" onClick={() => setDialog('flow')}>How stock moves</button>
    </div>

    {dialog === 'health' && <Dialog title="Inventory records" onClose={() => setDialog(null)}>
      <small>Stock value and manufacturing cost are only as true as these records. {c.passed} of {c.total} checks pass.</small>
      <div style={{marginTop: 6}}>{c.checks.map((k: any) => <div className="inv-check-row" key={k.key}><span className={k.passed ? 'ok' : 'no'} aria-label={k.passed ? 'Passed' : 'Needs attention'}>{k.passed ? '✓' : '✗'}</span><div>{k.label}<small>{k.passed ? (k.total ? `all ${k.total} OK` : 'nothing to check yet') : `${k.failingCount} to fix${k.failing.length ? `: ${k.failing.slice(0, 3).join(', ')}${k.failingCount > 3 ? '…' : ''}` : ''}`}</small></div>{k.passed ? <span /> : <Button small variant="ghost" onClick={() => { setDialog(null); nav(k.action.tab, k.action.sub); }}>Fix</Button>}</div>)}</div>
    </Dialog>}
    {dialog === 'flow' && <Dialog title="How stock moves" onClose={() => setDialog(null)}>
      <div className="inv-flowlist">{FLOW.map(([dot, t, p]) => <div className="inv-row" key={t}><span className="inv-dot" style={{background: DOT[dot], marginTop: 6}} /><div className="grow"><b>{t}</b><small>{p}</small></div></div>)}</div>
      <small style={{display: 'block', marginTop: 8}}>Every change is written to History with who did it, the reference document and the quantity before and after. Mistakes are corrected with a reversal, never by editing or deleting.</small>
    </Dialog>}
  </>;
}
