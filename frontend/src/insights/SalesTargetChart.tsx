import {memo, useMemo} from 'react';
import {compactRupees, rupees} from '../inventory/api';
import {cashSplit} from './derive';
import {SplitBar} from './SplitBar';
import type {Insights} from './types';
import {useI} from './useI';

const W = 600, H = 220, L = 52, R = 14, T = 16, B = 26;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const nice = (v: number) => { if (v <= 0) return 1; const p = 10 ** Math.floor(Math.log10(v)), n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; };

/** Bars = actual sales per bucket (hour / day / month), green line = target pace per bucket. */
export const SalesTargetChart = memo(function SalesTargetChart({d}: {d: Insights}) {
  const {t, s} = useI();
  const g = d.period.grain, data = d.series;
  const geo = useMemo(() => {
    const max = nice(Math.max(1, ...data.map(x => Math.max(x.salesPaise, x.targetPaise ?? 0))));
    const bw = (W - L - R) / Math.max(1, data.length), y = (v: number) => T + (H - T - B) * (1 - v / max);
    const top = Math.max(...data.map(x => x.salesPaise));
    const every = g === 'hour' ? 3 : g === 'day' ? Math.ceil(data.length / 10) : 1;
    const xLabel = (k: string) => g === 'hour' ? k : g === 'day' ? String(Number(k.slice(8))) : MONTHS[Number(k.slice(5)) - 1];
    const line = data.map((x, i) => x.targetPaise == null ? null : [L + bw * i + bw / 2, y(x.targetPaise)] as const).filter(Boolean) as Array<readonly [number, number]>;
    return {max, bw, y, top, every, xLabel, line};
  }, [data, g]);
  const label = s('Sales by {grain}: total {total}. Highest {best}.', {grain: t(g), total: rupees(d.metrics.salesPaise), best: rupees(geo.top)});
  const split = cashSplit(d.collectionsByMethod), last = d.series.filter(x => x.targetPaise != null).pop();
  return <section className="ins-card ins-chart" aria-labelledby="ins-chart-h">
    <header className="ins-card-head"><div><h3 id="ins-chart-h">{t('Sales vs target')}</h3><small>{t(g === 'hour' ? 'By hour' : g === 'day' ? 'By day' : 'By month')}</small></div>
      <div className="ins-legend"><span><i className="bar" />{t('Sales')}</span>{d.target && g !== 'hour' && <span><i className="line" />{t('Target pace')}</span>}</div></header>
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="ins-svg">
      {[0, .5, 1].map(f => <g key={f}><line x1={L} x2={W - R} y1={geo.y(geo.max * f)} y2={geo.y(geo.max * f)} className="grid" /><text x={L - 6} y={geo.y(geo.max * f) + 4} className="ax" textAnchor="end">{compactRupees(geo.max * f)}</text></g>)}
      {data.map((x, i) => { const h = H - B - geo.y(x.salesPaise); return <g key={x.key}>
        {x.salesPaise > 0 && <rect x={L + geo.bw * i + geo.bw * .19} width={geo.bw * .62} y={geo.y(x.salesPaise)} height={Math.max(1, h)} rx={Math.min(4, geo.bw * .2)} className={x.salesPaise === geo.top ? 'b top' : 'b'}><title>{`${geo.xLabel(x.key)} · ${rupees(x.salesPaise)} · ${x.orders} ${t('Orders').toLowerCase()}`}</title></rect>}
        {i % geo.every === 0 && <text x={L + geo.bw * i + geo.bw / 2} y={H - 8} className="ax" textAnchor="middle">{geo.xLabel(x.key)}</text>}
      </g>; })}
      {geo.line.length > 1 && <polyline points={geo.line.map(p => p.join(',')).join(' ')} className="tl" />}
      {geo.line.length > 0 && last && <><circle cx={geo.line[geo.line.length - 1][0]} cy={geo.line[geo.line.length - 1][1]} r="3.5" className="tp" /><text x={Math.min(W - R, geo.line[geo.line.length - 1][0])} y={geo.line[geo.line.length - 1][1] - 8} className="tlab" textAnchor="end">{compactRupees(last.targetPaise)}</text></>}
    </svg>
    {d.metrics.salesPaise === 0 && <p className="ins-note">{t('No sales counted in this period yet.')}</p>}
    {g === 'hour' && d.target && <p className="ins-note">{s('Daily share of your target: {amount}', {amount: rupees(d.target.perDayPaise)})}</p>}
    <div className="ins-splits">
      <SplitBar label={t('Collections: cash vs UPI / bank')} a={{label: t('Cash'), value: split.cash}} b={{label: t('UPI / bank'), value: split.digital}} c={split.other ? {label: t('Cheque / other'), value: split.other} : undefined} money empty={t('No verified collections in this period')} />
      <SplitBar label={t('Buyers: new vs repeat')} a={{label: t('New'), value: d.customerHealth.new}} b={{label: t('Repeat'), value: d.customerHealth.repeat}} empty={t('No buyers in this period')} />
    </div>
  </section>;
});
