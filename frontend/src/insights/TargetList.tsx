import {memo} from 'react';
import {day, label, rupees} from '../inventory/api';
import {Chip, Meter} from '../inventory/ui';
import type {Target} from './types';
import {useI} from './useI';

const tv = (t: Target, v: number) => t.progress.money ? rupees(v) : String(v);
const tone = (s: Target['progress']['state']) => s === 'COMPLETED' ? 'green' : s === 'OVERDUE' ? 'red' : s === 'UPCOMING' ? 'blue' : 'violet';

/** Every target overlapping the period (all types). Moved here from the salesman Dashboard ("My targets"). */
export const TargetList = memo(function TargetList({targets}: {targets: Target[]}) {
  const {t, s} = useI();
  return <section className="ins-card" aria-labelledby="ins-tl-h">
    <header className="ins-card-head"><h3 id="ins-tl-h">{t('All my targets in this period')}</h3></header>
    {targets.length ? <div className="ins-targets">{targets.map(x => { const p = x.progress; return <article key={x.id} className="ins-target">
      <div className="ins-target-top"><div><small>{label(x.period)} · {label(x.type)}</small><b>{x.name}</b></div><Chip tone={tone(p.state)}>{label(p.state)}</Chip></div>
      <div className="ins-target-pct"><strong className="ins-num">{p.pct == null ? '—' : `${p.pct}%`}</strong> <small>{t('completed')}</small></div>
      <Meter pct={p.pct} tone={p.state === 'COMPLETED' ? 'green' : p.state === 'OVERDUE' ? 'red' : undefined} />
      <div className="ins-kv"><div><span>{t('Target')}</span><b className="ins-num">{tv(x, x.targetValue)}</b></div><div><span>{t('Achieved')}</span><b className="ins-num">{tv(x, p.achieved)}</b></div><div><span>{t('Remaining')}</span><b className="ins-num">{tv(x, p.remaining)}</b></div></div>
      <small>{day(x.startDate)} – {day(x.endDate)}{p.state === 'ACTIVE' ? ` · ${s('{n} day(s) left', {n: p.daysLeft})}` : ''}</small>
      {x.instructions && <small className="ins-instr">{x.instructions}</small>}
    </article>; })}</div> : <div className="ins-empty"><p>{t('No target is assigned to you for this period.')}</p></div>}
  </section>;
});
