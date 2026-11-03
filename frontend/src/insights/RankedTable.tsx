import {memo, useState} from 'react';
import {rupees} from '../inventory/api';
import {Segment} from '../inventory/ui';
import type {Insights} from './types';
import {useI} from './useI';

export const RankedTable = memo(function RankedTable({d}: {d: Insights}) {
  const {t} = useI();
  const [view, setView] = useState<'customers' | 'products'>('customers');
  const rows = view === 'customers' ? d.customers.map(c => ({id: c.id, name: c.name, n: c.orders, v: c.valuePaise})) : d.products.map(p => ({id: p.id, name: p.name, n: p.qty, v: p.valuePaise}));
  return <section className="ins-card" aria-labelledby="ins-rank-h">
    <header className="ins-card-head"><h3 id="ins-rank-h">{t(view === 'customers' ? 'Top customers' : 'Top products')}</h3><Segment value={view} onChange={setView} options={[['customers', t('Customers')], ['products', t('Products')]]} /></header>
    {rows.length ? <div className="inv-table-wrap"><table className="inv-table ins-table">
      <thead><tr><th scope="col">#</th><th scope="col">{t(view === 'customers' ? 'Customer' : 'Product')}</th><th scope="col" className="num">{t(view === 'customers' ? 'Orders' : 'Qty')}</th><th scope="col" className="num">{t('Value')}</th></tr></thead>
      <tbody>{rows.map((r, i) => <tr key={r.id}><td><span className={`ins-rank r${Math.min(i, 3)}`}>{i + 1}</span></td><td className="ins-trunc">{r.name}</td><td className="num">{r.n}</td><td className="num">{rupees(r.v)}</td></tr>)}</tbody>
    </table></div> : <div className="ins-empty"><p>{t('Nothing sold in this period yet.')}</p></div>}
  </section>;
});
