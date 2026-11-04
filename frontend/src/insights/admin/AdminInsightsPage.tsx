// Admin Insights: whole-business health as graphs (owner / accounts). Data: GET /api/admin/insights.
import {useCallback, useState} from 'react';
import {CalendarDays, FileSpreadsheet, Printer, RefreshCw} from 'lucide-react';
import {downloadCsv, get} from '../../inventory/api';
import {Chip, ErrorState, PageHeader, PeriodSwitcher, Segmented, Skeleton, StatSkeletons, ToastHost, day, pct, useApi, usePeriod, useToast} from '../../admin/ui';
import {useI} from '../useI';
import type {AdminInsights, Page} from './types';
import {Ageing, BillsChart, Checklist, DeadStock, DealerShare, DesignQuadrant, FastMovers, Footnote, Gst, IdleDealers, Kpis, Ladder, Leaderboard, LowStock, MoneyOut, OldestDues, Open, PayModes, ProfitTrend, Rupee, Section, Summary, TeamTarget, Todo, TopDealers, TopLists, Trend} from './sections';
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

  // Cards whose data does not exist yet. 3 or more → fold them into the one checklist card.
  const empties: Array<[string, string]> = d ? [
    ...(!d.moneyOut.anyPurchaseRecorded && !d.moneyOut.gstPayablePaise ? [['money', t('Where the money went out')] as [string, string]] : []),
    ...(d.designs.filter(x => x.profitPerPiecePaise != null).length < 2 ? [['quadrant', t('Which designs really make money')] as [string, string]] : []),
    ...(!d.salespeople.some(p => p.billedPaise > 0 || p.collectedPaise > 0 || p.targetPaise != null) ? [['people', t('Salesperson leaderboard')] as [string, string]] : []),
    ...(!d.stock.tracked ? [['stock', t('Stock health')] as [string, string]] : []),
  ] : [];
  const fold = empties.length >= 3, hide = (k: string) => fold && empties.some(e => e[0] === k);
  const full = mode === 'full';

  return <div className="zl zl-shell ins-page">
    <PageHeader eyebrow={t('FINANCE')} title={t('Insights')} subtitle={t('How the business is really doing')} actions={<PeriodSwitcher value={period} onChange={setPeriod} />} />
    <div className="zl-metabar">
      <span className="zl-metabar-range"><CalendarDays size={14} aria-hidden="true" /> {t('Showing')} {day(period.from)} – {day(period.to)}{d?.canSeeCost && d.completeness.costPct != null && <Chip tone={d.completeness.costPct >= 95 ? 'green' : 'amber'}>{s('Cost known for {pct} of sales', {pct: pct(d.completeness.costPct, 0)})}</Chip>}</span>
      <span className="zl-metabar-right">
        <Segmented value={mode} onChange={setMode} options={[['simple', t('Simple')], ['full', t('Full')]]} label={t('Detail level')} />
        <button type="button" className="zl-btn sm" onClick={exportCsv} disabled={busy || !d}><FileSpreadsheet size={14} aria-hidden="true" />{t('Excel')}</button>
        <button type="button" className="zl-btn sm" onClick={() => window.print()} disabled={!d}><Printer size={14} aria-hidden="true" />{t('PDF')}</button>
        <button type="button" className="zl-btn sm" aria-label={t('Refresh')} aria-busy={loading} onClick={() => void reload()}><RefreshCw size={14} className={loading ? 'zl-spin' : undefined} aria-hidden="true" /><span className="ins-btn-t">{t('Refresh')}</span></button>
      </span>
    </div>

    {!valid ? <ErrorState error={t('Choose a start date on or before the end date.')} />
      : error ? <ErrorState error={error} retry={() => void reload()} />
      : loading && !d ? <div aria-busy="true"><StatSkeletons /><div className="ins-hero"><Skeleton h={440} r={16} /><Skeleton h={440} r={16} /></div><div className="ins-g3"><Skeleton h={300} r={16} /><Skeleton h={300} r={16} /><Skeleton h={300} r={16} /></div></div>
      : d && <div aria-busy={loading || undefined} className={loading ? 'ins-reloading' : ''}>
        <Kpis d={d} go={go} />
        <Footnote d={d} />
        <div className="ins-hero"><Trend d={d} /><div className="ins-stack"><Summary d={d} periodName={periodName} /><Todo d={d} go={go} /></div></div>

        {full && <Section title={t('Cash')} hint={t('Where the bills of this period stand')} action={<Open go={go} page="Bills" label={t('Open Bills')} />}>
          <div className="ins-g3"><Rupee d={d} /><PayModes d={d} /><BillsChart d={d} /></div>
        </Section>}

        <Section title={t('Profit')} hint={t('What is left after the cost of goods')}>
          <div className="ins-g2"><Ladder d={d} go={go} /><ProfitTrend d={d} /></div>
          {full && <div className="ins-g2">{!hide('money') && <MoneyOut d={d} go={go} />}<Gst d={d} /></div>}
        </Section>

        {full && <>
          <Section title={t('Designs')} hint={t('Which products earn, and which only sell')} action={<Open go={go} page="Products" label={t('Open Products')} />}>
            <div className="ins-g2">{!hide('quadrant') && <DesignQuadrant d={d} go={go} />}<TopLists d={d} /></div>
          </Section>
          <Section title={t('Dealers')} hint={t('Who buys, and who has gone quiet')} action={<Open go={go} page="Customers" label={t('Open Dealers')} />}>
            <div className="ins-g3"><DealerShare d={d} /><TopDealers d={d} /><IdleDealers d={d} idleDays={idleDays} setIdleDays={setIdleDays} /></div>
          </Section>
          <Section title={t('Sales team')} hint={t('Billing, collection and targets')} action={<Open go={go} page="Performance" label={t('Open Performance')} />}>
            <div className="ins-hero">{!hide('people') && <Leaderboard d={d} go={go} />}<TeamTarget d={d} go={go} /></div>
          </Section>
          <Section title={t('Money to collect')} hint={t('How old the unpaid bills are')} action={<Open go={go} page="Bills" label={t('Open Bills')} />}>
            <div className="ins-g2"><Ageing d={d} /><OldestDues d={d} /></div>
          </Section>
          {!hide('stock') && <Section title={t('Stock health')} hint={t('What to reorder, and what is stuck')} action={<Open go={go} page="Inventory" label={t('Open Inventory')} />}>
            <div className="ins-g3"><LowStock d={d} /><DeadStock d={d} /><FastMovers d={d} /></div>
          </Section>}
          {(fold || d.completeness.checklist.some(x => !x.done && x.available)) && <div className="ins-sec"><Checklist d={d} go={go} hidden={fold ? empties.map(e => e[1]) : []} /></div>}
        </>}
        <p className="ins-foot ins-end">{s('Compared with {from} – {to}.', {from: day(d.previous.from), to: day(d.previous.to)})} {t(d.policy === 'DISPATCHED' ? 'A bill counts as a sale once it is dispatched.' : 'A bill counts as a sale once it is approved.')} {t('Prices include GST; GST and net sales are estimates from each design’s GST rate.')}</p>
      </div>}
  </div>;
}

export default function AdminInsightsPage({go}: {go: (p: Page) => void}) {
  // The app's page key for dealers is Distributors; the API's action links say Customers.
  const open = useCallback((p: Page) => go(p === 'Customers' ? 'Distributors' : p), [go]);
  return <ToastHost><Body go={open} /></ToastHost>;
}
