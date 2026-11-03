import {useLanguage} from '../i18n';
import {ChartCard, METHOD_LABEL, count, hourLabel, inr} from '../admin/ui';
import {BarChart, Donut} from '../admin/charts';
import {STATUSES, type OrderList, type OrderStatus} from './api';

const STATUS_COLOR: Record<OrderStatus, string> = {Pending: 'var(--amber)', Approved: 'var(--blue)', Processing: 'var(--s1)', Dispatched: 'var(--cyan)', Delivered: 'var(--green)', Rejected: 'var(--red)', Cancelled: 'var(--s-other)'};

/** Orders analytics: same request (and filters) as the table, so nothing can disagree. */
export default function OrderCharts({d, loading, error, retry, onStatus, onMethod}: {d: OrderList | null; loading: boolean; error: string; retry: () => void; onStatus: (s: string) => void; onMethod: (m: string) => void}) {
  const {t} = useLanguage();
  const empty = !!d && d.totals.count === 0;
  const slices = d ? STATUSES.map(s => ({label: t(s), value: d.analytics.status[s] || 0, color: STATUS_COLOR[s], key: s})).filter(x => x.value > 0) : [];
  const methods = d ? Object.entries(d.analytics.methods).sort((a, b) => b[1] - a[1]) : [];
  const maxM = Math.max(1, ...methods.map(m => m[1]));
  const peak = d ? d.analytics.byHour.indexOf(Math.max(...d.analytics.byHour)) : -1;
  return <div className="zl-grid zl-g3 bl-charts">
    <ChartCard title={t('Orders by hour of day')} hint={d && !empty ? `${t('Busiest')}: ${hourLabel(peak)}` : undefined} loading={loading} error={error} retry={retry} empty={empty ? t('No orders in this period') : false}>
      {d && <BarChart labels={d.analytics.byHour.map((_, h) => hourLabel(h))} values={d.analytics.byHour} format={n => count(n)} ariaLabel={`${t('Orders by hour of day')}; ${t('Busiest')}: ${hourLabel(peak)}`} />}
    </ChartCard>
    <ChartCard title={t('Order status')} hint={t('Click a status to filter')} loading={loading} error={error} retry={retry} empty={empty ? t('No orders in this period') : false}>
      {d && <>
        <Donut items={slices} format={n => count(n)} centerLabel={`${count(d.totals.count)} ${t('orders')}`} ariaLabel={`${t('Order status')}: ${slices.map(s => `${s.label} ${s.value}`).join(', ')}`} />
        <div className="bl-legend">{slices.map(s => <button key={s.key} type="button" onClick={() => onStatus(s.key)}><i style={{background: s.color}} aria-hidden="true" />{s.label} <b className="num">{count(s.value)}</b></button>)}</div>
      </>}
    </ChartCard>
    <ChartCard title={t('Collected by payment mode')} hint={t('Verified payments on these orders')} loading={loading} error={error} retry={retry} empty={d && !methods.length ? t('No verified payments yet') : false}>
      {d && <ul className="bl-hbars" aria-label={t('Collected by payment mode')}>
        {methods.map(([m, v]) => <li key={m}><button type="button" onClick={() => onMethod(m)} aria-label={`${t(METHOD_LABEL[m] || m)}: ${inr(v)}`}>
          <span className="row"><span className="name">{t(METHOD_LABEL[m] || m)}</span><b className="num">{inr(v)}</b></span>
          <span className="bar"><i style={{width: `${v / maxM * 100}%`, background: 'var(--green)'}} /></span>
        </button></li>)}
      </ul>}
    </ChartCard>
  </div>;
}
