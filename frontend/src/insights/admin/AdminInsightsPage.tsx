// Admin Insights: whole-business health (owner / accounts). Data: GET /api/admin/insights.
import {useCallback, useState} from 'react';
import {FileSpreadsheet, Printer} from 'lucide-react';
import {downloadCsv, get} from '../../inventory/api';
import {Chip, ErrorState, KpiSkeletons, PageHeader, PeriodSwitcher, Segmented, Skeleton, ToastHost, pct, useApi, usePeriod, useToast} from '../../admin/ui';
import {useI} from '../useI';
import type {AdminInsights, Page} from './types';
import {Ageing, Checklist, DesignQuadrant, Dealers, Footnote, Kpis, Ladder, Leaderboard, MiniCards, MoneyOut, Rupee, Stock, Summary, Todo, TopLists, Trend} from './sections';
import '../../admin/theme.css';
import './insights.css';

type Mode = 'simple' | 'full';
function useStoredMode(): [Mode, (m: Mode) => void] {
  const [m, setM] = useState<Mode>(() => { try { return localStorage.getItem('adminInsights.mode') === 'simple' ? 'simple' : 'full'; } catch { return 'full'; } });
  return [m, (x: Mode) => { setM(x); try { localStorage.setItem('adminInsights.mode', x); } catch { /* ignore */ } }];
}

function Body({go}: {go: (p: Page) => void}) {
  const {t, s} = useI(); const toast = useToast();
  const [period, setPeriod] = usePeriod('adminInsights.period', 'month');
  const [mode, setMode] = useStoredMode();
  const [idleDays, setIdleDays] = useState(30);
  const valid = period.from <= period.to;
  const q = {from: period.from, to: period.to, idleDays};
  const {data: d, error, loading, reload} = useApi(() => valid ? get<AdminInsights>('/api/admin/insights', q) : Promise.resolve(null), [period.from, period.to, idleDays, valid]);
  const [busy, setBusy] = useState(false);
  const exportCsv = useCallback(async () => {
    setBusy(true);
    try { await downloadCsv('/api/admin/insights', {...q, format: 'csv'}); toast('ok', t('Export downloaded — opens in Excel')); } catch (e) { toast('err', e instanceof Error ? e.message : t('Export failed')); } finally { setBusy(false); }
  }, [q.from, q.to, idleDays]); // eslint-disable-line react-hooks/exhaustive-deps

  const periodName = {today: t('Today'), week: t('This week'), month: t('This month'), year: t('This financial year'), custom: t('In this period')}[period.key];
  const dateText = new Date().toLocaleDateString('en-IN', {weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'});

  // Cards whose data does not exist yet. 3 or more → fold them into the one checklist card.
  const empties: Array<[string, string]> = d ? [
    ...(!d.moneyOut.anyPurchaseRecorded && !d.moneyOut.gstPayablePaise ? [['money', t('Where the money went out')] as [string, string]] : []),
    ...(d.designs.filter(x => x.profitPerPiecePaise != null).length < 2 ? [['quadrant', t('Which designs really make money')] as [string, string]] : []),
    ...(!d.salespeople.some(p => p.billedPaise > 0 || p.collectedPaise > 0 || p.targetPaise != null) ? [['people', t('Salesperson leaderboard')] as [string, string]] : []),
    ...(!d.stock.tracked ? [['stock', t('Stock health')] as [string, string]] : []),
  ] : [];
  const fold = empties.length >= 3, hide = (k: string) => fold && empties.some(e => e[0] === k);
  const full = mode === 'full';

  return <div className="zl ins-page">
    <PageHeader title={t('Insights')} subtitle={`${t('How the business is really doing')} · ${dateText}`} actions={<>
      <PeriodSwitcher value={period} onChange={setPeriod} />
      <Segmented value={mode} onChange={setMode} options={[['simple', t('Simple')], ['full', t('Full')]]} label={t('Detail level')} />
      <span className="zl-actions" role="group" aria-label={t('Export for accountant')}>
        <button type="button" className="zl-btn" onClick={exportCsv} disabled={busy || !d}><FileSpreadsheet size={16} aria-hidden="true" />{t('Excel')}</button>
        <button type="button" className="zl-btn" onClick={() => window.print()} disabled={!d}><Printer size={16} aria-hidden="true" />{t('PDF')}</button>
      </span>
      {d?.canSeeCost && d.completeness.costPct != null && <Chip tone={d.completeness.costPct >= 95 ? 'green' : 'amber'}>{s('Cost known for {pct} of sales', {pct: pct(d.completeness.costPct, 0)})}</Chip>}
    </>} />

    {!valid ? <ErrorState error={t('Choose a start date on or before the end date.')} />
      : error ? <ErrorState error={error} retry={() => void reload()} />
      : loading && !d ? <><Skeleton h={78} r={16} /><div style={{height: 16}} /><KpiSkeletons n={7} /><div className="zl-grid zl-g2"><Skeleton h={320} r={16} /><Skeleton h={320} r={16} /></div></>
      : d && <div aria-busy={loading || undefined} className={loading ? 'ins-reloading' : ''}>
        <Summary d={d} periodName={periodName} />
        <Kpis d={d} go={go} />
        <Footnote d={d} />
        <div className="zl-grid zl-g2">
          <Ladder d={d} go={go} />
          {full ? (hide('money') ? null : <MoneyOut d={d} go={go} />) : <Todo d={d} go={go} />}
        </div>
        {full && <>
          <div className="zl-grid zl-g2"><Rupee d={d} /><Trend d={d} /></div>
          <div className="zl-grid zl-g2">{!hide('quadrant') && <DesignQuadrant d={d} go={go} />}<TopLists d={d} /></div>
          <div className="zl-grid zl-g2">{!hide('people') && <Leaderboard d={d} go={go} />}<Dealers d={d} go={go} idleDays={idleDays} setIdleDays={setIdleDays} /></div>
          <div className="zl-grid zl-g2"><Ageing d={d} go={go} />{!hide('stock') && <Stock d={d} go={go} />}</div>
          <MiniCards d={d} go={go} />
          <div className="zl-grid zl-g2"><Todo d={d} go={go} />{(fold || d.completeness.checklist.some(x => !x.done && x.available)) && <Checklist d={d} go={go} hidden={fold ? empties.map(e => e[1]) : []} />}</div>
        </>}
        <p className="ins-foot">{s('Compared with {from} – {to}.', {from: d.previous.from, to: d.previous.to})} {t(d.policy === 'DISPATCHED' ? 'A bill counts as a sale once it is dispatched.' : 'A bill counts as a sale once it is approved.')} {t('Prices include GST; GST and net sales are estimates from each design’s GST rate.')}</p>
      </div>}
  </div>;
}

export default function AdminInsightsPage({go}: {go: (p: Page) => void}) {
  return <ToastHost><Body go={go} /></ToastHost>;
}
