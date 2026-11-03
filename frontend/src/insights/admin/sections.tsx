// Cards of the admin Insights page. Every number comes from GET /api/admin/insights; nothing is computed here
// except presentation (labels, shares of a total already returned, chart scaling).
import React, {useMemo, useState} from 'react';
import {AlertTriangle, ArrowRight, CheckCircle2, Circle} from 'lucide-react';
import {Donut, OTHER, SERIES, StackBar} from '../../admin/charts';
import {Chip, Delta, KpiCard, METHOD_LABEL, Segmented, count, hourLabel, inr, pct} from '../../admin/ui';
import {useI} from '../useI';
import {ComboChart, Quadrant, Zone, zoneOf} from './charts';
import type {AdminInsights, Page} from './types';

type P = {d: AdminInsights; go: (p: Page) => void};
const money = (p: number | null | undefined) => inr(p);
const short = (p: number | null | undefined) => inr(p, true);

export function Open({go, page, label}: {go: (p: Page) => void; page: Page; label: string}) {
  return <button type="button" className="zl-btn sm ins-open" onClick={() => go(page)}>{label} <ArrowRight size={14} aria-hidden="true" /></button>;
}
export function NotRecorded() { const {t} = useI(); return <span className="ins-nr">{t('not recorded')}</span>; }
export function Compact({children, action}: {children: React.ReactNode; action?: React.ReactNode}) { return <div className="ins-compact"><span>{children}</span>{action}</div>; }
function Card({title, hint, aside, children, className = ''}: {title: React.ReactNode; hint?: React.ReactNode; aside?: React.ReactNode; children: React.ReactNode; className?: string}) {
  return <section className={`zl-card ins-card ${className}`}><div className="zl-card-h"><div><h3>{title}</h3>{hint && <p>{hint}</p>}</div>{aside}</div>{children}</section>;
}
export const bucketLabel = (key: string, bucket: AdminInsights['bucket']) => bucket === 'hour' ? hourLabel(Number(key))
  : bucket === 'day' ? new Date(key + 'T00:00:00').toLocaleDateString('en-IN', {day: 'numeric', month: 'short'})
  : new Date(key + '-01T00:00:00').toLocaleDateString('en-IN', {month: 'short', year: '2-digit'});

// ---------------- summary ----------------
export function Summary({d, periodName}: {d: AdminInsights; periodName: string}) {
  const {t, f} = useI(); const k = d.kpi, b = (x: React.ReactNode) => <b>{x}</b>;
  if (!k.bills) return <div className="zl-summary ins-summary" role="status"><span className="k">{t('Summary')}</span>{f('{period} there are no bills yet.', {period: periodName})} {d.money.duePaise > 0 && f('{due} is still due from earlier bills.', {due: b(money(d.money.duePaise))})}</div>;
  const dl = d.deltas.billedPaise;
  return <div className="zl-summary ins-summary" role="status"><span className="k">{t('Summary')}</span>
    {f(k.bills === 1 ? '{period} you billed {billed} on 1 bill' : '{period} you billed {billed} across {n} bills',{period: periodName, billed: b(money(k.billedPaise)), n: b(count(k.bills))})}{dl != null && <> (<Delta value={dl} suffix={t('vs previous period')} />)</>}.{' '}
    {f('{collected} of that is collected and {due} is still due.', {collected: b(money(d.rupee.collectedOnBillsPaise)), due: b(money(d.rupee.stillDuePaise))})}{' '}
    {d.topDueDealer && <>{f('Biggest due overall: {name} ({amount}).', {name: b(d.topDueDealer.name), amount: money(d.topDueDealer.duePaise)})} </>}
    {d.team.best && <>{f('Best salesperson: {name}.', {name: b(d.team.best.name)})} </>}
    {d.canSeeCost && d.completeness.designsNoCost > 0 && <span className="warn"><AlertTriangle size={15} aria-hidden="true" style={{verticalAlign: -2}} /> {f(d.completeness.designsNoCost === 1 ? '1 design sold has no cost price, so profit is not complete.' : '{n} designs sold have no cost price, so profit is not complete.',{n: b(d.completeness.designsNoCost)})}</span>}
  </div>;
}

// ---------------- KPI strip ----------------
export function Kpis({d, go}: P) {
  const {t, s} = useI(); const k = d.kpi, dl = d.deltas, sr = d.series;
  return <div className="zl-kpis ins-kpis">
    <KpiCard label={t('Net sales (excl. GST)')} value={money(k.netSalesPaise)} delta={dl.netSalesPaise} spark={sr.net} hint={t('estimated')} onClick={() => go('Bills')} />
    {d.canSeeCost && <KpiCard label={t('Gross profit')} value={k.grossProfitPaise == null ? <NotRecorded /> : money(k.grossProfitPaise)} delta={dl.grossProfitPaise} spark={k.grossProfitPaise == null ? undefined : sr.profit || undefined} color="var(--green)" hint={s('cost known for {pct} of sales', {pct: pct(d.completeness.costPct, 0)})} onClick={() => go('Products')} />}
    <KpiCard label={t('Collected')} value={money(k.collectedPaise)} delta={dl.collectedPaise} spark={sr.collected} color="var(--cyan)" onClick={() => go('Bills')} />
    <KpiCard label={t('Due now')} value={money(k.duePaise)} hint={s('{n} unpaid bills, all periods', {n: k.dueBills})} onClick={() => go('Bills')} />
    <KpiCard label={t('Bills')} value={count(k.bills)} delta={dl.bills} spark={sr.bills} onClick={() => go('Bills')} />
    <KpiCard label={t('Average bill')} value={money(k.avgBillPaise)} delta={dl.avgBillPaise} onClick={() => go('Bills')} />
    <KpiCard label={t('Active dealers')} value={count(k.activeDealers)} delta={dl.activeDealers} spark={sr.dealers} onClick={() => go('Customers')} />
  </div>;
}
export function Footnote({d}: {d: AdminInsights}) {
  const {s} = useI(); const c = d.rupee.cancelled, p = d.rupee.pending;
  if (!c.count && !p.count) return null;
  return <p className="ins-foot">{[c.count ? s(c.count === 1 ? '1 cancelled/rejected bill ({amount}) not counted' : '{n} cancelled/rejected bills ({amount}) not counted', {n: c.count, amount: money(c.valuePaise)}) : '', p.count ? s(p.count === 1 ? '1 bill waiting for approval ({amount}) not counted yet' : '{n} bills waiting for approval ({amount}) not counted yet',{n: p.count, amount: money(p.valuePaise)}) : ''].filter(Boolean).join(' · ')}</p>;
}

// ---------------- A1 profit ladder ----------------
type Rung = {label: string; sub: string; value: number | null; sign?: '−'; key?: boolean; missing?: string};
export function Ladder({d, go}: P) {
  const {t, s} = useI();
  if (!d.ladder) return <Card title={t('Operating profit')}><Compact>{t('Profit and cost figures are visible only to users with stock valuation access.')}</Compact></Card>;
  const l = d.ladder, base = Math.max(l.netSalesPaise, 1);
  const rows: Rung[] = [
    {label: t('Net sales'), sub: t('Bill value without GST (estimated)'), value: l.netSalesPaise},
    {label: t('Cost of goods sold'), sub: s('Cost price × pieces · cost known for {pct} of sales', {pct: pct(l.costCoveragePct, 0)}), value: l.cogsPaise, sign: '−'},
    {label: t('Gross profit'), sub: t('On designs that have a cost price'), value: l.grossProfitPaise, key: true},
    {label: t('Salaries & advances'), sub: t('Not tracked in the app yet'), value: null, sign: '−', missing: 'x'},
    {label: t('Other expenses'), sub: t('Transport, rent, etc. — not tracked yet'), value: null, sign: '−', missing: 'x'},
    {label: t('Operating profit'), sub: t('Before salaries & expenses (not recorded)'), value: l.operatingProfitPaise, key: true},
  ];
  return <Card title={t('Operating profit ladder')} hint={t('What is left from every rupee of sales')} aside={<Delta value={l.delta} suffix={t('vs previous')} />}>
    {l.grossProfitPaise == null && l.netSalesPaise > 0 && <Compact action={<Open go={go} page="Products" label={t('Add cost prices')} />}>{t('No design billed in this period has a cost price, so profit cannot be worked out yet.')}</Compact>}
    <div className="ins-ladder" role="list">
      {rows.map(r => <div key={r.label} role="listitem" className={`ins-rung${r.key ? ' key' : ''}`}>
        <div className="nm"><b>{r.sign ? `${r.sign} ` : ''}{r.label}</b><small>{r.sub}</small></div>
        <div className="bar" aria-hidden="true">{r.value != null && <i style={{width: `${Math.min(100, Math.abs(r.value) / base * 100)}%`, background: r.key ? (r.value >= 0 ? 'var(--green)' : 'var(--red)') : r.sign ? 'var(--amber)' : 'var(--accent2)'}} />}</div>
        <div className="vv">{r.value == null ? <NotRecorded /> : <><b className="num">{r.sign && r.value ? '−' : ''}{money(r.value)}</b><small className="num">{pct(Math.round(r.value / base * 1000) / 10)}</small></>}</div>
      </div>)}
    </div>
    <p className="zl-note">{s('GST collected ({amount}, estimated) belongs to the government, so it is left out.', {amount: money(l.gstPaise)})} {t('Cost uses each design’s current average manufacturing cost.')}</p>
  </Card>;
}

// ---------------- A2 money out ----------------
export function MoneyOut({d, go}: P) {
  const {t, s} = useI(); const m = d.moneyOut;
  const rows = [{label: t('Purchases from suppliers'), sub: s('{n} purchase bills, before GST', {n: m.purchaseBills}), value: m.anyPurchaseRecorded ? m.purchasesPaise : null, color: 'var(--s1)'},
    {label: t('GST payable'), sub: t('Estimate: GST on sales − input GST'), value: m.gstPayablePaise, color: 'var(--s3)', est: true},
    {label: t('Salaries & advances'), sub: t('Not tracked yet'), value: null, color: 'var(--s2)'}, {label: t('Transport & other expenses'), sub: t('Not tracked yet'), value: null, color: 'var(--s5)'}];
  const max = Math.max(1, ...rows.map(r => r.value || 0));
  return <Card title={t('Where the money went out')} hint={t('Money paid or owed out of the business this period')}>
    {!m.anyPurchaseRecorded && <Compact action={<Open go={go} page="Inventory" label={t('Record purchases')} />}>{t('No purchases recorded yet.')}</Compact>}
    <div className="ins-ladder">{rows.map(r => <div className="ins-rung" key={r.label}>
      <div className="nm"><b>{r.label}</b><small>{r.sub}</small></div>
      <div className="bar" aria-hidden="true">{r.value != null && <i style={{width: `${r.value / max * 100}%`, background: r.color}} />}</div>
      <div className="vv">{r.value == null ? <NotRecorded /> : <><b className="num">{money(r.value)}</b>{r.est && <Chip tone="amber">{t('estimated')}</Chip>}</>}</div>
    </div>)}</div>
    {m.anyPurchaseRecorded && <p className="zl-note">{s('Paid to suppliers this period: {amount}', {amount: money(m.paidToSuppliersPaise)})}</p>}
  </Card>;
}

// ---------------- B1 where every rupee went ----------------
export function Rupee({d}: {d: AdminInsights}) {
  const {t, s} = useI(); const r = d.rupee;
  const rows: Array<[string, number | null, string?]> = [[t('Billed (incl. GST)'), r.billedPaise], [t('Discounts given'), r.discountsPaise], [t('Returns / credit notes'), r.returnsPaise], [t('Collected on these bills'), r.collectedOnBillsPaise, 'var(--green)'], [t('Still due'), r.stillDuePaise, 'var(--amber)']];
  return <Card title={t('Where every rupee went')} hint={t('Bills of this period: billed → collected → due')} aside={r.efficiencyPct != null && <Chip tone={r.efficiencyPct >= 70 ? 'green' : 'amber'}>{s('{pct} collected', {pct: pct(r.efficiencyPct, 0)})}</Chip>}>
    {!r.billedPaise ? <Compact>{t('No bills in this period.')}</Compact> : <>
      <div className="zl-panel">{rows.map(([l, v, c]) => <div className="zl-row" key={l}><span>{l}</span>{v == null ? <NotRecorded /> : <b style={c ? {color: c} : undefined}>{money(v)}</b>}</div>)}</div>
      <h4 className="ins-sub">{t('Bills by payment status')}</h4>
      <StackBar ariaLabel={t('Bills by payment status')} format={money} items={[{label: s('Paid ({n})', {n: r.payStatus.PAID.count}), value: r.payStatus.PAID.paise, color: 'var(--green)'}, {label: s('Part paid ({n})', {n: r.payStatus.PARTIAL.count}), value: r.payStatus.PARTIAL.paise, color: 'var(--amber)'}, {label: s('Unpaid ({n})', {n: r.payStatus.UNPAID.count}), value: r.payStatus.UNPAID.paise, color: 'var(--red)'}]} />
      <p className="zl-note">{t('Cash vs credit sale and discounts are not recorded on bills yet.')}</p>
    </>}
  </Card>;
}

// ---------------- B2 billed vs collected ----------------
export function Trend({d}: {d: AdminInsights}) {
  const {t, s} = useI(); const tr = d.trend;
  const labels = useMemo(() => tr.keys.map(k => bucketLabel(k, d.bucket)), [tr.keys, d.bucket]);
  const unit = d.bucket === 'hour' ? t('hour') : d.bucket === 'day' ? t('day') : t('month');
  const methods = d.rupee.methods.map((m, i) => ({label: t(METHOD_LABEL[m.method] || m.method), value: m.valuePaise, color: SERIES[i] || OTHER}));
  return <Card title={t('Billed vs collected')} hint={s('By {unit} · dashed line = previous period billed', {unit})} aside={tr.best && <Chip tone="violet">{s('Best {unit}: {key} ({amount})', {unit, key: bucketLabel(tr.best.key, d.bucket), amount: short(tr.best.valuePaise)})}</Chip>}>
    {!tr.billed.some(v => v > 0) && !tr.collected.some(v => v > 0) ? <Compact>{t('Nothing billed or collected in this period.')}</Compact> : <>
      <ComboChart labels={labels} bars={tr.billed} line={tr.collected} prev={tr.previousBilled} format={money} axisFormat={short} ariaLabel={t('Billed and collected over time')} names={{bars: t('Billed'), line: t('Collected'), prev: t('Previous period')}} />
      <div className="zl-legend ins-legend"><span><i style={{background: 'var(--accent2)'}} />{t('Billed')}</span><span><i style={{background: 'var(--cyan)', height: 3}} />{t('Collected')}</span><span><i className="dash" />{t('Previous period')}</span></div>
    </>}
    <h4 className="ins-sub">{t('Collected by payment mode')}</h4>
    {methods.length ? <StackBar ariaLabel={t('Collected by payment mode')} format={money} items={methods} /> : <p className="zl-note">{t('No verified collections in this period.')}</p>}
  </Card>;
}

// ---------------- C1 design quadrant ----------------
export function DesignQuadrant({d, go}: P) {
  const {t, s} = useI();
  const pts = useMemo(() => d.designs.filter(x => x.profitPerPiecePaise != null && x.pieces > 0).map(x => ({id: x.id, label: `${x.sku} · ${x.name}`, x: x.pieces, y: x.profitPerPiecePaise!})), [d.designs]);
  const ax = pts.length ? pts.reduce((a, p) => a + p.x, 0) / pts.length : 0, ay = pts.length ? pts.reduce((a, p) => a + p.y, 0) / pts.length : 0;
  const zones: Record<Zone, string> = {win: t('Winners'), popular: t('Popular but low profit'), slow: t('Profitable but slow'), fix: t('Fix or clear')};
  const tips: Record<Zone, string> = {win: t('Keep stocked'), popular: t('Review rate / discount'), slow: t('Push to dealers'), fix: t('Stop buying or offer a discount')};
  const n: Record<Zone, number> = {win: 0, popular: 0, slow: 0, fix: 0}; for (const p of pts) n[zoneOf(p.x, p.y, ax, ay)]++;
  const missing = d.completeness.designsNoCost;
  return <Card title={t('Which designs really make money')} hint={t('Pieces sold vs profit per piece · dashed lines = average')}>
    {pts.length < 2 ? <Compact action={missing > 0 ? <Open go={go} page="Products" label={t('Add cost prices')} /> : undefined}>{missing > 0 ? s(missing === 1 ? 'Needs at least 2 sold designs with a cost price — 1 sold design has none.' : 'Needs at least 2 sold designs with a cost price — {n} sold designs have none.',{n: missing}) : t('Needs at least 2 sold designs with a cost price.')}</Compact> : <>
      <Quadrant points={pts} ax={ax} ay={ay} formatY={short} ariaLabel={t('Designs by pieces sold and profit per piece')} zoneName={zones} axisNames={{x: t('Pieces sold'), y: t('Profit per piece')}} />
      <div className="ins-zones">{(['win', 'popular', 'slow', 'fix'] as Zone[]).map(z => <div key={z} className={`ins-zone-card ${z}`}><b>{zones[z]} <span className="num">({n[z]})</span></b><small>{tips[z]}</small></div>)}</div>
      {missing > 0 && <Compact action={<Open go={go} page="Products" label={t('Fix')} />}>{s(missing === 1 ? '1 sold design has no cost price and is not plotted.' : '{n} sold designs have no cost price and are not plotted.',{n: missing})}</Compact>}
    </>}
  </Card>;
}

// ---------------- C2 top lists ----------------
type Tab = 'profit' | 'pieces' | 'category' | 'dealers';
export function TopLists({d}: {d: AdminInsights}) {
  const {t} = useI();
  const [tab, setTab] = useState<Tab>(d.canSeeCost ? 'profit' : 'pieces');
  const opts: Array<[Tab, string]> = [...(d.canSeeCost ? [['profit', t('By profit')] as [Tab, string]] : []), ['pieces', t('By pieces')], ['category', t('By category')], ['dealers', t('Top dealers')]];
  const designs = useMemo(() => tab === 'profit' ? d.designs.filter(x => x.profitPaise != null).sort((a, b) => b.profitPaise! - a.profitPaise!) : d.designs.slice().sort((a, b) => b.pieces - a.pieces), [d.designs, tab]);
  const cost = d.canSeeCost;
  return <Card title={t('Top designs')} aside={<Segmented value={tab} onChange={setTab} options={opts} label={t('Rank by')} />}>
    {!d.designs.length ? <Compact>{t('No bills in this period.')}</Compact> : tab === 'profit' && !designs.length ? <Compact>{t('No design sold in this period has a cost price yet, so it cannot be ranked by profit.')}</Compact> : <div className="ins-tbl-wrap"><table className="ins-tbl">
      {tab === 'dealers' ? <>
        <thead><tr><th>#</th><th>{t('Dealer')}</th><th className="r">{t('Bills')}</th><th className="r">{t('Billed')}</th><th className="r">{t('Due now')}</th></tr></thead>
        <tbody>{d.dealers.slice(0, 8).map((x, i) => <tr key={x.id}><td className="rk">{i + 1}</td><td>{x.name}</td><td className="r num">{x.bills}</td><td className="r num">{money(x.billedPaise)}</td><td className="r num">{x.duePaise ? money(x.duePaise) : '—'}</td></tr>)}</tbody>
      </> : tab === 'category' ? <>
        <thead><tr><th>#</th><th>{t('Category')}</th><th className="r">{t('Pieces')}</th><th className="r">{t('Sales')}</th>{cost && <th className="r">{t('Profit')}</th>}</tr></thead>
        <tbody>{d.categories.slice(0, 8).map((x, i) => <tr key={x.name}><td className="rk">{i + 1}</td><td>{x.name}</td><td className="r num">{count(x.pieces)}</td><td className="r num">{money(x.salesPaise)}</td>{cost && <td className="r num">{money(x.profitPaise)}{!x.complete && <small title={t('Some designs have no cost price')}> *</small>}</td>}</tr>)}</tbody>
      </> : <>
        <thead><tr><th>#</th><th>{t('Design')}</th><th className="r">{t('Pieces')}</th><th className="r">{t('Sales')}</th>{cost && <><th className="r">{t('Profit')}</th><th className="r">{t('Margin')}</th></>}</tr></thead>
        <tbody>{designs.slice(0, 8).map((x, i) => <tr key={x.id}><td className="rk">{i + 1}</td><td><b className="mono">{x.sku}</b> <span className="ins-dim">{x.name}</span></td><td className="r num">{count(x.pieces)}</td><td className="r num">{money(x.salesPaise)}</td>{cost && <><td className="r num">{x.profitPaise == null ? <span className="ins-dim">{t('no cost')}</span> : money(x.profitPaise)}</td><td className="r num">{pct(x.marginPct, 0)}</td></>}</tr>)}</tbody>
      </>}
    </table></div>}
    {tab === 'category' && cost && d.categories.some(c => !c.complete) && <p className="zl-note">{t('* some designs in this category have no cost price, so profit is understated.')}</p>}
  </Card>;
}

// ---------------- D1 salespeople ----------------
export function Leaderboard({d, go}: P) {
  const {t, s} = useI();
  // Salespeople with nothing this period are counted in one line, not drawn as empty bars.
  const busy = d.salespeople.filter(p => p.billedPaise > 0 || p.collectedPaise > 0 || p.targetPaise != null), idle = d.salespeople.length - busy.length;
  const list = busy.slice(0, 8);
  const max = Math.max(1, ...list.map(p => Math.max(p.billedPaise, p.collectedPaise)));
  return <Card title={t('Salesperson leaderboard')} hint={t('Billed vs collected this period')} aside={<Open go={go} page="Performance" label={t('Open Performance')} />}>
    {!list.length ? <Compact action={<Open go={go} page="Salesmen" label={t('Add salesmen')} />}>{t('No salesperson has billed in this period.')}</Compact> :
      <div className="ins-people">{list.map(p => <button type="button" key={p.id} className="ins-person" onClick={() => go('Performance')} aria-label={s('{name}: billed {billed}, collected {collected}', {name: p.name, billed: money(p.billedPaise), collected: money(p.collectedPaise)})}>
        <span className="top"><b>{p.name}{p.role !== 'salesman' && <small> · {t(p.role === 'owner' ? 'Owner' : 'Accounts')}</small>}</b><span className="ins-chips">{p.targetPct != null && <Chip tone={p.targetPct >= 100 ? 'green' : p.targetPct >= 50 ? 'blue' : 'amber'}>{s('{pct} of target', {pct: pct(p.targetPct, 0)})}</Chip>}<Delta value={p.delta} /></span></span>
        <span className="bars"><span className="ins-bar"><i style={{width: `${p.billedPaise / max * 100}%`, background: 'var(--accent2)'}} /></span><b className="num">{short(p.billedPaise)}</b>
          <span className="ins-bar"><i style={{width: `${p.collectedPaise / max * 100}%`, background: 'var(--cyan)'}} /></span><b className="num">{short(p.collectedPaise)}</b></span>
      </button>)}
      <div className="zl-legend ins-legend"><span><i style={{background: 'var(--accent2)'}} />{t('Billed')}</span><span><i style={{background: 'var(--cyan)'}} />{t('Collected')}</span></div>
      {idle > 0 && <p className="zl-note">{s(idle === 1 ? '1 more salesperson has no bills or collections this period.' : '{n} more salespeople have no bills or collections this period.', {n: idle})}</p>}</div>}
  </Card>;
}

// ---------------- D2 dealers ----------------
export function Dealers({d, go, idleDays, setIdleDays}: P & {idleDays: number; setIdleDays: (n: number) => void}) {
  const {t, s} = useI();
  const items = d.dealerShare.map((x, i) => ({label: x.label === 'Others' ? t('Others') : x.label, value: x.valuePaise, color: x.label === 'Others' ? OTHER : SERIES[i]}));
  return <Card title={t('Dealer concentration & growth')} hint={t('Share of this period’s sales')} aside={<Open go={go} page="Customers" label={t('Open Dealers')} />}>
    {items.length ? <Donut items={items} format={short} centerLabel={t('billed')} ariaLabel={t('Share of sales by dealer')} size={170} /> : <Compact>{t('No bills in this period.')}</Compact>}
    <div className="ins-idle-h"><h4 className="ins-sub">{t('Dealers who stopped ordering')}</h4>
      <label className="ins-inline">{t('No bill for')} <select className="zl-select" value={idleDays} onChange={e => setIdleDays(Number(e.target.value))}>{[30, 45, 60, 90].map(n => <option key={n} value={n}>{s('{n} days', {n})}</option>)}</select></label></div>
    {d.idle.length ? <ul className="ins-list">{d.idle.slice(0, 5).map(x => <li key={x.id}><span>{x.name}<small>{s('Last bill {days} days ago · lifetime {amount}', {days: x.days, amount: short(x.lifetimePaise)})}</small></span><Chip tone={x.days > 90 ? 'red' : 'amber'}>{s('{n} days', {n: x.days})}</Chip></li>)}</ul>
      : <p className="zl-note">{s('Every dealer has ordered in the last {n} days.', {n: idleDays})}</p>}
  </Card>;
}

// ---------------- E1 ageing ----------------
const AGE_COLOR = {'0-7': 'var(--blue)', '8-30': 'var(--amber)', '31-60': 'var(--s5)', '60+': 'var(--red)'} as const;
export function Ageing({d, go}: P) {
  const {t, s} = useI();
  return <Card title={t('Due ageing')} hint={t('All unpaid bills, by days since billing')} aside={<Open go={go} page="Bills" label={t('Open Bills')} />}>
    {!d.money.bills ? <Compact>{t('No money is due. Every bill is paid.')}</Compact> : <>
      <StackBar ariaLabel={t('Due by age')} format={money} items={d.ageing.map(a => ({label: s('{range} days ({n})', {range: a.key, n: a.count}), value: a.paise, color: AGE_COLOR[a.key]}))} />
      <h4 className="ins-sub">{t('Oldest dues')}</h4>
      <ul className="ins-list">{d.overdueDealers.map(x => <li key={x.id}><span>{x.name}<small>{s('{n} unpaid bills · oldest {days} days', {n: x.bills, days: x.oldest})}</small></span><b className="num">{money(x.duePaise)}</b></li>)}</ul>
    </>}
  </Card>;
}

// ---------------- E2 stock ----------------
export function Stock({d, go}: P) {
  const {t, s} = useI(); const st = d.stock;
  return <Card title={t('Stock health')} aside={<Open go={go} page="Inventory" label={t('Open Inventory')} />}>
    {!st.tracked ? <Compact action={<Open go={go} page="Products" label={t('Add designs')} />}>{t('No designs in stock yet.')}</Compact> : <div className="ins-stock">
      <div><h4 className="ins-sub">{s('Low stock ({n})', {n: st.low.length})}</h4>{st.low.length ? <ul className="ins-list">{st.low.slice(0, 4).map(x => <li key={x.id}><span><b className="mono">{x.sku}</b><small>{x.name}</small></span><Chip tone={x.available <= 0 ? 'red' : 'amber'}>{s('{a} left · reorder {r}', {a: x.available, r: x.reorder})}</Chip></li>)}</ul> : <p className="zl-note">{t('Nothing below reorder level.')}</p>}</div>
      <div><h4 className="ins-sub">{s('Dead stock ({n})', {n: st.dead.length})}</h4>
        {st.deadValuePaise != null && st.dead.length > 0 && <p className="ins-big num">{money(st.deadValuePaise)} <small>{t('locked in stock')}</small></p>}
        {st.dead.length ? <ul className="ins-list">{st.dead.slice(0, 4).map(x => <li key={x.id}><span><b className="mono">{x.sku}</b><small>{x.lastSale ? s('{n} pcs · last sold {date}', {n: x.stock, date: bucketLabel(x.lastSale, 'day')}) : s('{n} pcs · never sold', {n: x.stock})}</small></span>{x.valuePaise != null && <b className="num">{short(x.valuePaise)}</b>}</li>)}</ul> : <p className="zl-note">{s('Everything in stock sold in the last {n} days.', {n: st.deadDays})}</p>}
        {st.deadUncosted > 0 && <p className="zl-note">{s('{n} of these have no cost price, so the locked value is understated.', {n: st.deadUncosted})}</p>}</div>
      <div><h4 className="ins-sub">{t('Fast movers')}</h4>{st.fast.length ? <ul className="ins-list">{st.fast.slice(0, 4).map(x => <li key={x.id}><span><b className="mono">{x.sku}</b><small>{x.name}</small></span><span className="ins-dim num">{s('{n} sold · {a} left', {n: x.pieces, a: x.available ?? '—'})}</span></li>)}</ul> : <p className="zl-note">{t('No sales in this period.')}</p>}</div>
    </div>}
  </Card>;
}

// ---------------- mini cards ----------------
function Mini({label, value, sub, split, extra, open}: {label: string; value: React.ReactNode; sub: React.ReactNode; split?: Array<{v: number; c: string; l: string}>; extra?: React.ReactNode; open: React.ReactNode}) {
  const tot = split?.reduce((a, x) => a + x.v, 0) || 0;
  return <section className="zl-card ins-mini"><span className="lbl">{label}</span><b className="val num">{value}</b><span className="sub">{sub}</span>
    {split && <span className="zl-stack ins-ministack" role="img" aria-label={split.map(x => `${x.l} ${x.v}`).join(', ')}>{tot > 0 ? split.filter(x => x.v > 0).map(x => <i key={x.l} style={{flex: x.v, background: x.c}} />) : <i style={{flex: 1, background: 'var(--line)'}} />}</span>}
    {extra && <span className="sub">{extra}</span>}<span className="ins-mini-open">{open}</span></section>;
}
export function MiniCards({d, go}: P) {
  const {t, s} = useI(); const ds = d.dealerStats, tm = d.team, m = d.money, g = d.gst;
  return <div className="ins-g4">
    <Mini label={t('Dealers')} value={count(ds.active)} sub={s('{a} new · {b} returning', {a: ds.new, b: ds.returning})} split={[{v: ds.new, c: 'var(--cyan)', l: t('New')}, {v: ds.returning, c: 'var(--accent2)', l: t('Returning')}]} extra={ds.idle ? <span className="warn">{s('{n} slipping away (no bill in {d} days)', {n: ds.idle, d: d.idleDays})}</span> : t('No dealer is slipping away')} open={<Open go={go} page="Customers" label={t('Open Dealers')} />} />
    <Mini label={t('Sales team')} value={tm.targetPct != null ? pct(tm.targetPct, 0) : '—'} sub={tm.targetPct != null ? t('of team target achieved') : t('No targets set for this period')} split={tm.targetPct != null ? [{v: Math.min(100, tm.targetPct), c: 'var(--green)', l: t('Achieved')}, {v: Math.max(0, 100 - tm.targetPct), c: 'var(--line2)', l: t('Remaining')}] : undefined}
      extra={<>{tm.best ? s('Best: {name}', {name: tm.best.name}) : t('No sales yet')}{tm.needsHelp && <><br /><span className="warn">{s('Needs help: {name} ({pct})', {name: tm.needsHelp.name, pct: pct(tm.needsHelp.targetPct, 0)})}</span></>}</>} open={<Open go={go} page={tm.targetPct != null ? 'Targets' : 'Salesmen'} label={tm.targetPct != null ? t('Open Targets') : t('Open Salesmen')} />} />
    <Mini label={t('Money to collect')} value={money(m.duePaise)} sub={s('Today {a} · older {b}', {a: short(m.dueTodayPaise), b: short(m.dueOlderPaise)})} split={[{v: m.dueTodayPaise, c: 'var(--blue)', l: t('Today')}, {v: m.dueOlderPaise, c: 'var(--amber)', l: t('Older')}]} extra={m.oldest ? s('Oldest: {name}, {days} days', {name: m.oldest.customerName, days: m.oldest.days}) : t('Nothing due')} open={<Open go={go} page="Bills" label={t('Open Bills')} />} />
    <Mini label={t('GST snapshot')} value={money(g.netPaise)} sub={<><Chip tone="amber">{t('estimate')}</Chip> {t('net payable')}</>} split={g.inputPaise != null ? [{v: g.outputPaise, c: 'var(--s3)', l: t('GST on sales')}, {v: g.inputPaise, c: 'var(--s4)', l: t('Input GST')}] : undefined}
      extra={<>{s('On sales {a}', {a: short(g.outputPaise)})} · {g.inputPaise != null ? s('input {b}', {b: short(g.inputPaise)}) : t('input GST not recorded')}{g.gstCoveragePct != null && g.gstCoveragePct < 100 && <><br /><span className="warn">{s('GST rate set for {pct} of sales', {pct: pct(g.gstCoveragePct, 0)})}</span></>}</>} open={<Open go={go} page="Inventory" label={t('Open Reports')} />} />
  </div>;
}

// ---------------- things to do + checklist ----------------
const ONE: Partial<Record<string, string>> = {callOverdue: 'Call the dealer whose dues are over 30 days ({amount})', addCost: 'Add cost price to 1 design so profit is exact', verifyPayments: 'Verify 1 collection waiting for approval ({amount})', restock: '1 design is at or below reorder level — plan production or purchase', addGst: 'Set the GST rate on 1 design so GST is exact'};
const GO_LABEL: Record<string, string> ={Orders: 'Open Bills', Products: 'Open Products', Customers: 'Open Dealers', Inventory: 'Open Inventory', Performance: 'Open Performance', Targets: 'Open Targets'};
export function Todo({d, go}: P) {
  const {t, s} = useI();
  const text = (a: AdminInsights['actions'][number]) => {
    const v = {...a.vars, amount: typeof a.vars.amount === 'number' ? money(a.vars.amount) : ''};
    if (a.vars.n === 1 && ONE[a.kind]) return s(ONE[a.kind]!, v);
    return s({callOverdue: 'Call the {n} dealers whose dues are over 30 days ({amount})', addCost: 'Add cost price to {n} designs so profit is exact', followUp: '{name} hasn’t ordered in {days} days — send a follow-up', verifyPayments: 'Verify {n} collections waiting for approval ({amount})', restock: '{n} designs are at or below reorder level — plan production or purchase', addGst: 'Set the GST rate on {n} designs so GST is exact', coach: '{name} is at {pct}% of target — check in with them'}[a.kind], v);
  };
  return <Card title={t('3 things to do this week')} className="ins-todo">
    {d.actions.length ? <ol className="ins-actions">{d.actions.map((a, i) => <li key={a.kind}><span className="n" aria-hidden="true">{i + 1}</span><span className="tx">{text(a)}</span><Open go={go} page={a.go} label={t(GO_LABEL[a.go] || 'Open')} /></li>)}</ol>
      : <Compact>{t('Nothing urgent — dues, stock and data all look fine for now.')}</Compact>}
  </Card>;
}
const CHECK_LABEL: Record<string, string> = {cost: 'Add cost price to designs', gst: 'Set GST rate on designs', purchases: 'Record purchases', targets: 'Set salesperson targets', expenses: 'Record expenses & salaries (not in the app yet)'};
export function Checklist({d, go, hidden}: P & {hidden: string[]}) {
  const {t, s} = useI(); const items = d.completeness.checklist, done = items.filter(x => x.done).length;
  return <Card title={t('Complete your data to unlock more insights')} hint={hidden.length ? s('Hidden until there is data: {cards}', {cards: hidden.join(', ')}) : undefined} aside={<Chip tone="amber">{s('{pct} complete', {pct: pct(Math.round(done / items.length * 100), 0)})}</Chip>}>
    <div className="ins-progress" role="progressbar" aria-valuenow={done} aria-valuemin={0} aria-valuemax={items.length} aria-label={t('Data completeness')}><i style={{width: `${done / items.length * 100}%`}} /></div>
    <ul className="ins-check">{items.map(x => <li key={x.key} className={x.done ? 'done' : ''}>{x.done ? <CheckCircle2 size={18} aria-hidden="true" /> : <Circle size={18} aria-hidden="true" />}<span>{t(CHECK_LABEL[x.key])}<span className="zl-sr">{x.done ? t('done') : t('not done')}</span></span>{!x.done && x.go && <Open go={go} page={x.go} label={t('Open')} />}</li>)}</ul>
  </Card>;
}
