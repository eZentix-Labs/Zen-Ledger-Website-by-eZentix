import {useLanguage} from '../i18n';
import {ChartCard, count, hourLabel, inr} from '../admin/ui';
import {BarChart, Donut, SrTable, StackBar, TrendChart} from '../admin/charts';
import type {BillInsights, Tab} from './api';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const keyLabel = (k: string, bucket: 'hour' | 'day' | 'month') => bucket === 'hour' ? hourLabel(Number(k)) : bucket === 'day' ? `${Number(k.slice(8))} ${MONTHS[Number(k.slice(5, 7)) - 1]}` : `${MONTHS[Number(k.slice(5, 7)) - 1]} ${k.slice(2, 4)}`;
const money = (p: number) => inr(p, true);

/** Bills analytics row. Everything reflects the active filters (same request as the KPI cards). */
export default function BillCharts({x, loading, error, retry, onCustomer, onSalesman, onTab}: {x: BillInsights | null; loading: boolean; error: string; retry: () => void; onCustomer: (id: string) => void; onSalesman: (id: string) => void; onTab: (t: Tab) => void}) {
  const {t} = useLanguage();
  const s = x?.series, b = x?.period?.bucket || 'day';
  const labels = s ? s.keys.map(k => keyLabel(k, b)) : [];
  const noBills = !!x && x.totals.count === 0;
  const st = x?.status;
  const slices = st ? [
    {label: t('Paid'), value: st.PAID, color: 'var(--green)', tab: 'PAID' as Tab},
    {label: t('Part paid'), value: st.PARTIAL, color: 'var(--amber)', tab: 'PARTIAL' as Tab},
    {label: t('Unpaid'), value: st.UNPAID, color: 'var(--red)', tab: 'UNPAID' as Tab},
    {label: t('Cancelled'), value: st.cancelled, color: 'var(--s-other)', tab: 'cancelled' as Tab},
  ].filter(v => v.value > 0) : [];
  const maxDue = Math.max(1, ...(x?.topCustomersByDue.map(c => c.duePaise) || [0]));
  const maxSm = Math.max(1, ...(x?.salesmen.map(m => m.billedPaise) || [0]));
  const ageColors: Record<string, string> = {'0-7': 'var(--s2)', '8-30': 'var(--amber)', '31-60': 'var(--s5)', '60+': 'var(--red)'};
  const ageing = (x?.ageing || []).filter(a => a.duePaise > 0).map(a => ({label: `${a.bucket} ${t('days')}`, value: a.duePaise, color: ageColors[a.bucket]!}));

  return <div className="bl-charts">
    <div className="zl-grid zl-g2">
      <ChartCard title={t('Billed over time')} hint={x?.previous ? `${t('Dashed line: previous period')} (${x.previous.from} – ${x.previous.to})` : t('Pick a period to compare')} loading={loading} error={error} retry={retry} empty={!s ? t('Choose a period to see the trend') : noBills ? t('No bills in this period') : false}>
        {s && <TrendChart labels={labels} current={s.billed} previous={s.previousBilled || undefined} format={money} ariaLabel={`${t('Billed per')} ${t(b)}: ${t('total')} ${inr(x!.totals.billedPaise)}`} curName={t('Billed')} prevName={t('Previous period')} />}
      </ChartCard>
      <ChartCard title={t('Collected on these bills')} hint={t('Verified payments, by bill date')} loading={loading} error={error} retry={retry} empty={!s ? t('Choose a period to see the trend') : noBills ? t('No bills in this period') : false}>
        {s && <BarChart labels={labels} values={s.collected} format={money} color="var(--green)" ariaLabel={`${t('Collected per')} ${t(b)}: ${t('total')} ${inr(x!.totals.collectedPaise)}`} height={200} />}
      </ChartCard>
    </div>
    <div className="zl-grid zl-g3">
      <ChartCard title={t('Payment status')} hint={t('Click a status to filter')} loading={loading} error={error} retry={retry} empty={noBills ? t('No bills in this period') : false}>
        {x && <>
          <Donut items={slices} format={n => count(n)} centerLabel={`${count(x.totals.count)} ${t('bills')}`} ariaLabel={`${t('Payment status')}: ${slices.map(v => `${v.label} ${v.value}`).join(', ')}`} />
          <div className="bl-legend">{slices.map(v => <button key={v.label} type="button" onClick={() => onTab(v.tab)}><i style={{background: v.color}} aria-hidden="true" />{v.label} <b className="num">{count(v.value)}</b></button>)}</div>
        </>}
      </ChartCard>
      <ChartCard title={t('Top customers by due')} hint={t('Click a customer to filter')} loading={loading} error={error} retry={retry} empty={x && !x.topCustomersByDue.length ? t('Nothing is due') : false}>
        {x && <ul className="bl-hbars" aria-label={t('Top customers by due')}>
          {x.topCustomersByDue.map(c => <li key={c.id}><button type="button" onClick={() => onCustomer(c.id)} aria-label={`${c.name}: ${inr(c.duePaise)} ${t('due on')} ${c.bills} ${t('bills')}`}>
            <span className="row"><span className="name">{c.name}</span><b className="num red">{inr(c.duePaise)}</b></span>
            <span className="bar"><i style={{width: `${c.duePaise / maxDue * 100}%`, background: 'var(--red)'}} /></span>
          </button></li>)}
        </ul>}
      </ChartCard>
      <ChartCard title={t('Salesman: billed vs collected')} hint={t('Click a salesman to filter')} loading={loading} error={error} retry={retry} empty={x && !x.salesmen.length ? t('No bills in this period') : false}>
        {x && <ul className="bl-hbars" aria-label={t('Billed and collected by salesman')}>
          {x.salesmen.map(m => <li key={m.id || 'none'}><button type="button" disabled={!m.id} onClick={() => m.id && onSalesman(m.id)} aria-label={`${m.name}: ${t('billed')} ${inr(m.billedPaise)}, ${t('collected')} ${inr(m.collectedPaise)}`}>
            <span className="row"><span className="name">{m.name}</span><span className="num"><b>{money(m.billedPaise)}</b> <small className="green">/ {money(m.collectedPaise)}</small></span></span>
            <span className="bar"><i style={{width: `${m.collectedPaise / maxSm * 100}%`, background: 'var(--green)'}} /><i style={{width: `${(m.billedPaise - m.collectedPaise) / maxSm * 100}%`, background: 'var(--s1)', opacity: .55}} /></span>
          </button></li>)}
          <li className="bl-key"><i style={{background: 'var(--green)'}} aria-hidden="true" />{t('Collected')} <i style={{background: 'var(--s1)', opacity: .55}} aria-hidden="true" />{t('Still due')}</li>
        </ul>}
      </ChartCard>
    </div>
    <ChartCard title={t('Due ageing')} hint={t('Money still due, by days since the bill date')} loading={loading} error={error} retry={retry} empty={x && !ageing.length ? t('Nothing is due') : false}>
      {x && <>
        <StackBar items={ageing} format={money} ariaLabel={`${t('Due ageing')}: ${ageing.map(a => `${a.label} ${inr(a.value)}`).join(', ')}`} />
        <div className="bl-legend">{x.ageing.map(a => <span key={a.bucket}><i style={{background: ageColors[a.bucket]}} aria-hidden="true" />{a.bucket} {t('days')} <b className="num">{inr(a.duePaise)}</b> <small>({a.bills})</small></span>)}</div>
        <SrTable caption={t('Due ageing')} head={[t('Days'), t('Due'), t('Bills')]} rows={x.ageing.map(a => [a.bucket, inr(a.duePaise), a.bills])} />
      </>}
    </ChartCard>
  </div>;
}
