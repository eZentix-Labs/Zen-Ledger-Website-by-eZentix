import {describe, expect, it} from 'vitest';
import {percentChange, profitSummary, receivablesAgeing, stockSummary} from './calculations.js';
import {periodStats} from './routes.js';

describe('overview calculations', () => {
  it('counts only policy-counted sales and verified collections in the selected period', () => {
    const d: any = {
      policy: 'APPROVED',
      orders: [
        {id: 'counted', status: 'Approved', approvedAt: '2026-11-04T08:00:00.000Z', createdAt: '2026-11-04T08:00:00.000Z', total: 1200, customerId: 'c1'},
        {id: 'pending', status: 'Pending', createdAt: '2026-11-04T09:00:00.000Z', total: 400, customerId: 'c2'},
      ],
      payments: [
        {orderId: 'counted', status: 'VERIFIED', paymentDate: '2026-11-04T10:00:00.000Z', amount: 200},
        {orderId: 'counted', status: 'UNVERIFIED', paymentDate: '2026-11-04T10:00:00.000Z', amount: 300},
      ],
      customers: [], invoices: [],
    };
    const ctx: any = {paid: new Map(), methods: new Map(), users: new Map(), userList: [], phones: new Map()};
    const out = periodStats(d, ctx, '2026-11-04', '2026-11-04', 'hour');
    expect(out.kpi.salesPaise).toBe(120_000);
    expect(out.kpi.countedOrders).toBe(1);
    expect(out.kpi.collectedPaise).toBe(20_000);
  });

  it('returns null when percent change has no non-zero comparison baseline', () => {
    expect(percentChange(0, 0)).toBeNull();
    expect(percentChange(125, 0)).toBeNull();
    expect(percentChange(125, 100)).toBe(25);
    expect(percentChange(75, 100)).toBe(-25);
  });

  it('places receivables in non-overlapping bill-age buckets at exact boundaries', () => {
    const aged = receivablesAgeing([
      {duePaise: 10_000, countedOn: '2026-10-05'}, // 30 days
      {duePaise: 20_000, countedOn: '2026-10-04'}, // 31 days
      {duePaise: 30_000, countedOn: '2026-09-05'}, // 60 days
      {duePaise: 40_000, countedOn: '2026-09-04'}, // 61 days
      {duePaise: 50_000, countedOn: null},
      {duePaise: 60_000, countedOn: '2026-10-05'},
    ], '2026-11-04');
    expect(aged).toEqual([
      {bucket: '0-30', duePaise: 70_000, bills: 2},
      {bucket: '31-60', duePaise: 50_000, bills: 2},
      {bucket: '60+', duePaise: 40_000, bills: 1},
    ]);
  });

  it('counts active low/out-of-stock records and leaves uncosted stock out of valuation', () => {
    const stock = stockSummary([
      {status: 'active', available: 0, reorder: 2, onHand: 0, avgCostPaise: 1200},
      {status: 'ACTIVE', available: 3, reorder: 3, onHand: 4, avgCostPaise: 1000},
      {status: 'ACTIVE', available: 10, reorder: 0, onHand: 10, avgCostPaise: null},
      {status: 'archived', available: 0, reorder: 5, onHand: 4, avgCostPaise: 500},
      {status: 'ACTIVE', available: 2, reorder: 3, onHand: 4000, costScale: 0.001, avgCostPaise: 2500},
    ]);
    expect(stock).toEqual({tracked: 4, low: 3, out: 1, valuePaise: 14_000, uncosted: 1});
  });

  it('marks profit as estimated, uses net-of-GST costed lines, and preserves missing values', () => {
    const profit = profitSummary([{items: [
      {productId: 'costed', qty: 2, price: 118},
      {productId: 'unknown', qty: 1, price: 100},
    ]}], new Map([
      ['costed', {gstRateBps: 1800, avgCostPaise: 5000}],
      ['unknown', {gstRateBps: null, avgCostPaise: null}],
    ]));
    expect(profit).toMatchObject({
      salesPaise: 33_600,
      grossProfitPaise: 10_000,
      cogsPaise: 10_000,
      costCoveragePct: 70.2,
      gstCoveragePct: 70.2,
      missingCostProducts: ['unknown'],
      missingGstProducts: ['unknown'],
      salariesPaise: null,
      expensesPaise: null,
      estimated: true,
    });
    expect(profitSummary([{items: [{productId: 'unknown', qty: 1, price: 100}]}], new Map()).grossProfitPaise).toBeNull();
  });
});
