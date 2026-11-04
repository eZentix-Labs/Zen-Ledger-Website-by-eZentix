import {paise} from '../sales/routes.js';

export type DueFact = {duePaise: number; countedOn: string | null};
export type StockFact = {status?: string; available: number; reorder: number; onHand: number; avgCostPaise: number | null; costScale?: number};
export type ProfitOrder = {items: Array<{productId: string; qty: number; price: number}>};
export type CostProfile = {gstRateBps: number | null; avgCostPaise: number | null};

export function percentChange(current: number, previous: number): number | null {
  return previous ? Math.round((current - previous) / previous * 1000) / 10 : null;
}

export function receivablesAgeing(due: DueFact[], today: string) {
  const buckets = [
    {bucket: '0-30', duePaise: 0, bills: 0},
    {bucket: '31-60', duePaise: 0, bills: 0},
    {bucket: '60+', duePaise: 0, bills: 0},
  ];
  const end = Date.parse(`${today}T00:00:00Z`);
  for (const bill of due) {
    if (bill.duePaise <= 0 || !bill.countedOn) continue;
    const start = Date.parse(`${bill.countedOn}T00:00:00Z`);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    const age = Math.max(0, Math.floor((end - start) / 86400000));
    const index = age <= 30 ? 0 : age <= 60 ? 1 : 2;
    buckets[index].duePaise += bill.duePaise;
    buckets[index].bills++;
  }
  return buckets;
}

export function stockSummary(rows: StockFact[]) {
  const active = rows.filter(x => x.status == null || x.status === 'active' || x.status === 'ACTIVE');
  const low = active.filter(x => x.reorder > 0 && x.available <= x.reorder);
  const out = active.filter(x => x.available <= 0);
  let valuePaise = 0, uncosted = 0;
  for (const x of active) {
    if (x.onHand <= 0) continue;
    if (x.avgCostPaise == null) uncosted++;
    else valuePaise += Math.round(x.onHand * (x.costScale || 1) * x.avgCostPaise);
  }
  return {tracked: active.length, low: low.length, out: out.length, valuePaise, uncosted};
}

export function profitSummary(orders: ProfitOrder[], profiles: Map<string, CostProfile>) {
  let salesPaise = 0, ratedSalesPaise = 0, costedSalesPaise = 0, netCostedSalesPaise = 0, cogsPaise = 0;
  const missingCost = new Set<string>(), missingGst = new Set<string>();
  for (const order of orders) for (const line of order.items) {
    const gross = paise(line.qty * line.price), profile = profiles.get(line.productId);
    const rate = profile?.gstRateBps ?? null;
    salesPaise += gross;
    if (rate == null) missingGst.add(line.productId);
    else ratedSalesPaise += gross;
    const net = rate ? Math.round(gross * 10000 / (10000 + rate)) : gross;
    if (profile?.avgCostPaise == null) missingCost.add(line.productId);
    else {
      costedSalesPaise += gross;
      netCostedSalesPaise += net;
      cogsPaise += Math.round(line.qty * profile.avgCostPaise);
    }
  }
  return {
    salesPaise,
    grossProfitPaise: costedSalesPaise ? netCostedSalesPaise - cogsPaise : null,
    cogsPaise: costedSalesPaise ? cogsPaise : null,
    costCoveragePct: salesPaise ? Math.round(costedSalesPaise / salesPaise * 1000) / 10 : null,
    gstCoveragePct: salesPaise ? Math.round(ratedSalesPaise / salesPaise * 1000) / 10 : null,
    missingCostProducts: [...missingCost],
    missingGstProducts: [...missingGst],
    salariesPaise: null,
    expensesPaise: null,
    estimated: true as const,
  };
}
