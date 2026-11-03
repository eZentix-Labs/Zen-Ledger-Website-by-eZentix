import {useCallback, useMemo, useState} from 'react';
import {Download} from 'lucide-react';
import {downloadCsv, get, rupees, shiftDays, todayIso} from '../inventory/api';
import {ErrorBox, Input, Segment, errText, useLoad, useToast} from '../inventory/ui';
import {ActionList} from './ActionList';
import {MiniCard} from './MiniCard';
import {PERIODS, PeriodKey, rangeOf} from './period';
import {RankedTable} from './RankedTable';
import {SalesTargetChart} from './SalesTargetChart';
import {SplitBar} from './SplitBar';
import {SummaryCard} from './SummaryCard';
import {TargetLadder} from './TargetLadder';
import {TargetList} from './TargetList';
import {TopProductsChart} from './TopProductsChart';
import type {GoTab, Insights} from './types';
import {useI} from './useI';
import './insights.css';

type Mode = 'simple' | 'full';
/** Per-viewer UI preference (period / mode). Storage may be unavailable; fall back silently. */
function useStored<T extends string>(key: string, initial: T, allowed: readonly T[]) {
  const [v, setV] = useState<T>(() => { try { const s = localStorage.getItem(key) as T | null; return s && allowed.includes(s) ? s : initial; } catch { return initial; } });
  const set = useCallback((x: T) => { setV(x); try { localStorage.setItem(key, x); } catch { /* ignore */ } }, [key]);
  return [v, set] as const;
}

export default function InsightsPage({go}: {go: (tab: GoTab) => void}) {
  const {t, s} = useI();
  const toast = useToast();
  const [period, setPeriod] = useStored<PeriodKey>('insights.period', 'month', PERIODS.map(p => p[0]));
  const [mode, setMode] = useStored<Mode>('insights.mode', 'full', ['simple', 'full']);
  const [custom, setCustom] = useState(() => ({from: shiftDays(todayIso(), -29), to: todayIso()}));
  const range = useMemo(() => rangeOf(period, custom), [period, custom]);
  const valid = Boolean(range.from && range.to && range.from <= range.to);
  const {data, error, loading, reload} = useLoad(() => valid ? get<Insights>('/api/sales/me/insights', range) : Promise.resolve(null), [range.from, range.to, valid]);
  const full = mode === 'full';
  const [exporting, setExporting] = useState(false);
  const exportCsv = async () => {
    setExporting(true);
    try { await downloadCsv('/api/sales/me/insights', range); toast('ok', t('Export downloaded')); } catch (e) { toast('err', errText(e)); } finally { setExporting(false); }
  };

  return <div className="ins" aria-busy={loading}>
    <header className="ins-head">
      <div><h1>{t('Insights')}</h1><p>{t('Your business health on one page')}</p></div>
      <div className="ins-controls">
        <Segment value={period} onChange={setPeriod} options={PERIODS.map(([k, l]) => [k, t(l)])} />
        {period === 'custom' && <span className="ins-dates"><Input type="date" aria-label={t('From')} value={custom.from} max={custom.to} onChange={e => setCustom({...custom, from: e.target.value})} /><Input type="date" aria-label={t('To')} value={custom.to} min={custom.from} max={todayIso()} onChange={e => setCustom({...custom, to: e.target.value})} /></span>}
        <Segment value={mode} onChange={setMode} options={[['simple', t('Simple')], ['full', t('Full')]]} />
        <button type="button" className="ins-ghost" onClick={exportCsv} disabled={exporting || !data}><Download size={14} aria-hidden="true" /> {t('Export')}</button>
        {data && <span className={`ins-chip ${data.completeness.pct >= 100 ? 'green' : 'amber'}`} title={s('{orders} orders awaiting approval, {collections} collections awaiting verification', {orders: data.completeness.pendingOrders, collections: data.completeness.unverifiedCollections})}>{s('Data complete {pct}%', {pct: data.completeness.pct})}</span>}
      </div>
    </header>
    {!valid && <ErrorBox error={t('Choose a start date on or before the end date.')} />}
    <ErrorBox error={error} retry={reload} />
    {!data && loading && <Skeleton full={full} />}
    {data && <div className={`ins-body${loading ? ' stale' : ''}`}>
      <SummaryCard d={data} period={period} />
      <div className={full ? 'ins-row main' : 'ins-row'}>
        <TargetLadder d={data} wide={!full} />
        {full && <SalesTargetChart d={data} />}
      </div>
      {full && <div className="ins-row even"><TopProductsChart d={data} /><RankedTable d={data} /></div>}
      {full && <div className="ins-minis">
        <MiniCard label={t('Customers')} value={data.customerHealth.buyers ? `${Math.round(data.customerHealth.repeat / data.customerHealth.buyers * 100)}%` : '—'}
          sub={data.customerHealth.buyers ? s('repeat buyers · {n} bought this period', {n: data.customerHealth.buyers}) : t('No buyers in this period')}
          action={{label: t('Take an order'), onClick: () => go('catalog')}}>
          {data.customerHealth.buyers > 0 && <SplitBar label="" a={{label: t('New'), value: data.customerHealth.new}} b={{label: t('Repeat'), value: data.customerHealth.repeat}} />}
          <small className={data.customerHealth.slippingCount ? 'ins-warn' : ''}>{data.customerHealth.slippingCount ? s('{n} customers slipping away (no order in {days}+ days)', {n: data.customerHealth.slippingCount, days: data.customerHealth.slippingDays}) : t('No customers slipping away')}</small>
        </MiniCard>
        <MiniCard label={t('Collections / dues')} tone={data.dues.totalPaise ? 'amber' : 'green'} value={rupees(data.dues.totalPaise)}
          sub={s('outstanding today · {collected} collected this period', {collected: rupees(data.metrics.collectedPaise)})}
          action={{label: t('Open collections'), onClick: () => go('collect')}}>
          {data.dues.totalPaise > 0 && <SplitBar label="" money a={{label: t('Last 30 days'), value: data.dues.recentPaise}} b={{label: t('Older'), value: data.dues.olderPaise}} />}
          {data.dues.oldest && <small>{s('Oldest: {name}, {amount} for {days} days', {name: data.dues.oldest.customerName, amount: rupees(data.dues.oldest.amountPaise), days: data.dues.oldest.ageDays})}</small>}
        </MiniCard>
        <MiniCard label={t('Visits / coverage')} value="—" placeholder={t('Coming soon')} sub={t('Visit and route tracking is not recorded yet.')} />
        <MiniCard label={t('My rank')} value="—" placeholder={t('Not available')} sub={t('Team ranking is not shared with salesmen yet.')} />
      </div>}
      <ActionList d={data} go={go} />
      {full && <TargetList targets={data.targets} />}
      <small className="ins-foot">{data.policy === 'DISPATCHED' ? t('Sales count once an order is dispatched.') : t('Sales count once an order is approved.')} {t('Pending, rejected and cancelled orders never count. Collections count after the accounts team verifies them.')}</small>
    </div>}
  </div>;
}

function Skeleton({full}: {full: boolean}) {
  return <div className="ins-body" aria-hidden="true">
    <div className="ins-sk" style={{height: 92}} />
    <div className={full ? 'ins-row main' : 'ins-row'}><div className="ins-sk" style={{height: 280}} />{full && <div className="ins-sk" style={{height: 280}} />}</div>
    {full && <div className="ins-minis">{[0, 1, 2, 3].map(i => <div key={i} className="ins-sk" style={{height: 150}} />)}</div>}
    <div className="ins-sk" style={{height: 160}} />
  </div>;
}
