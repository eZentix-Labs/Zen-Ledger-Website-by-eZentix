import {memo} from 'react';
import {rupees} from '../inventory/api';
import type {Insights} from './types';
import {useI} from './useI';

/**
 * Fallback for the "which products really make money" quadrant: product cost/margin is deliberately
 * never sent to salesmen (see the catalogue test in workflows.mongo.test.ts), so we rank by sales value.
 */
export const TopProductsChart = memo(function TopProductsChart({d}: {d: Insights}) {
  const {t, s} = useI();
  const items = d.products.slice(0, 6), max = Math.max(1, ...items.map(p => p.valuePaise));
  return <section className="ins-card" aria-labelledby="ins-prod-h">
    <header className="ins-card-head"><div><h3 id="ins-prod-h">{t('Top products by sales')}</h3><small>{t('Profit view needs cost data, which is not shared with salesmen')}</small></div><span className="ins-chip blue">{t('Sales value')}</span></header>
    {items.length ? <ul className="ins-hbars" aria-label={t('Top products by sales')}>
      {items.map((p, i) => <li key={p.id}>
        <div className="ins-hbar-top"><span className="ins-trunc">{p.name}</span><b className="ins-num">{rupees(p.valuePaise)}</b></div>
        <div className="ins-bar" aria-hidden="true"><i className={i === 0 ? 'violet' : 'blue'} style={{width: `${p.valuePaise / max * 100}%`}} /></div>
        <small className="ins-num">{s('{qty} sold', {qty: p.qty})}</small>
      </li>)}
    </ul> : <div className="ins-empty"><p>{t('No products sold in this period yet.')}</p></div>}
  </section>;
});
