import {memo, useMemo} from 'react';
import {rupees} from '../inventory/api';
import {deltaPct, ladderRows} from './derive';
import type {Insights} from './types';
import {useI} from './useI';

const fmtDate = (iso: string) => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-IN', {day: 'numeric', month: 'short', timeZone: 'UTC'});

/** Target → sales → gap → required pace → projection, as horizontal bar rows. */
export const TargetLadder = memo(function TargetLadder({d, wide}: {d: Insights; wide?: boolean}) {
  const {t, s} = useI();
  const rows = useMemo(() => ladderRows(d, fmtDate, rupees), [d]);
  const delta = deltaPct(d.metrics.salesPaise, d.previousMetrics.salesPaise);
  return <section className={`ins-card ins-ladder${wide ? ' wide' : ''}`} aria-labelledby="ins-ladder-h">
    <header className="ins-card-head">
      <div><h3 id="ins-ladder-h">{t('Target ladder')}</h3><small>{t('Where your numbers stand')}</small></div>
      {delta != null && <span className={`ins-delta ${delta >= 0 ? 'up' : 'down'}`} title={s('Previous period: {amount}', {amount: rupees(d.previousMetrics.salesPaise)})}>{delta >= 0 ? '▲' : '▼'} {Math.abs(delta)}% <small>{t('vs previous period')}</small></span>}
    </header>
    {!d.target ? <div className="ins-empty">
      <p><b>{t('No target set for this period')}</b></p>
      <p>{t('Ask your admin to set a sales target. Until then, here is what you sold:')}</p>
      <div className="ins-kv"><div><span>{t('Sales counted')}</span><b className="ins-num">{rupees(d.metrics.salesPaise)}</b></div><div><span>{t('Orders')}</span><b className="ins-num">{d.metrics.countedOrders}</b></div><div><span>{t('Average order')}</span><b className="ins-num">{rupees(d.metrics.avgOrderValuePaise)}</b></div></div>
    </div> : <ol className="ins-rows">
      {rows.map(r => <li key={r.key} className={`ins-lrow${r.highlight ? ' key' : ''}`}>
        <div className="ins-lrow-label"><b>{t(r.label)}</b><small>{s(r.sub, r.subVars)}</small>{r.estimated && <small className="ins-est">{t('estimated')}</small>}</div>
        <div className="ins-bar" aria-hidden="true"><i className={r.tone} style={{width: `${Math.max(r.bar, r.value ? 1.5 : 0)}%`}} /></div>
        <b className="ins-num ins-lrow-val">{rupees(r.value)}{r.perDay && <small>/{t('day')}</small>}</b>
        <span className="ins-num ins-lrow-pct">{r.pct == null ? '—' : `${r.pct}%`}</span>
      </li>)}
    </ol>}
  </section>;
});
