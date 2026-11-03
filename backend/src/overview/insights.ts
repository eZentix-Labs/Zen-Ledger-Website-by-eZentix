// Admin Insights: whole-business health for one period. Read-only.
//
// "One definition per number": a sale (a "bill") is an order counted by the sales policy (COUNTED / countedDate),
// billed value is order.total, collected / paid / due come from orderFacts() and the period series from periodStats().
// These are the same definitions the Overview, the Orders desk and the salesman targets use.
//
// Agreed basis (decision of 2026-11-04): order prices INCLUDE GST. GST and net sales are therefore ESTIMATED by
// backing out each design's GST rate (product profile gstRateBps). A design with no GST rate is counted as 0% GST
// and reported in `completeness`. Cost of goods = qty × the design's current weighted-average manufacturing cost
// (profile avgCostPaise); designs without a cost are left out of profit and reported in `completeness`.
// Not recorded anywhere in the app yet, so always returned as null (never as a zero): salaries & advances, other
// expenses, sales discounts, sales returns / credit notes, walk-in vs dealer, cash vs credit sale.
import type {Express, Request} from 'express';
import {z} from 'zod';
import {permissionsFor, requireAuth, requirePerm, sessionUser} from '../auth.js';
import {Models} from '../models.js';
import {Inv} from '../inventory/models.js';
import {Sales} from '../sales/models.js';
import {fail, parse, route} from '../inventory/http.js';
import {COUNTED, Data, countedDate, daysIn, inRange, loadData, metricsFor, paise, previousRange, shiftIso, targetProgress, today, ymd} from '../sales/routes.js';
import {Bucket, bucketOf, buckets, context, keyOf, orderFacts, periodStats, range, sum} from './routes.js';

const DEAD_DAYS = 60;                     // in stock but not sold for this long = dead stock
const AGE_BUCKETS: Array<[string, number, number]> = [['0-7', 0, 7], ['8-30', 8, 30], ['31-60', 31, 60], ['60+', 61, Infinity]];
const LIVE_BILL = ['POSTED', 'PARTIALLY_PAID', 'PAID'];
const pctOf = (a: number, b: number) => b ? Math.round(a / b * 1000) / 10 : null;
const delta = (a: number | null, b: number | null) => a == null || b == null || !b ? null : Math.round((a - b) / Math.abs(b) * 1000) / 10;

type Profile = {gstRateBps: number | null; costPaise: number | null};
type Product = {id: string; sku: string; name: string; category: string; stock: number; reservedStock: number; reorder: number; status: string};

/** Splits one bill line (GST-inclusive) into net value, GST and cost. */
function splitLine(l: any, prof: Profile | undefined) {
  const gross = paise(l.qty * l.price), rate = prof?.gstRateBps ?? null;
  const net = rate ? Math.round(gross * 10000 / (10000 + rate)) : gross;
  const cost = prof?.costPaise != null ? Math.round(prof.costPaise * l.qty) : null;
  return {gross, net, gst: gross - net, cost, hasRate: rate != null, qty: l.qty};
}

/** Line-level sales facts for counted bills in [from, to]; bucketed for sparklines. */
function salesFacts(d: Data, profiles: Map<string, Profile>, from: string, to: string, b: Bucket) {
  const keys = buckets(from, to, b), idx = new Map(keys.map((k, i) => [k, i])), z = () => keys.map(() => 0);
  const s = {billed: z(), net: z(), profit: z(), bills: z(), dealers: keys.map(() => new Set<string>())};
  const orders = d.orders.filter(o => COUNTED[d.policy].includes(o.status) && inRange(countedDate(o, d.policy), from, to));
  const designs = new Map<string, {pieces: number; gross: number; net: number; cost: number; costed: boolean; name: string}>();
  let gross = 0, net = 0, gst = 0, cogs = 0, costedGross = 0, costedNet = 0, ratedGross = 0;
  for (const o of orders) {
    const i = idx.get(keyOf(countedDate(o, d.policy), b));
    let oNet = 0, oProfit = 0;
    for (const l of o.items) {
      const x = splitLine(l, profiles.get(l.productId));
      gross += x.gross; net += x.net; gst += x.gst; oNet += x.net;
      if (x.hasRate) ratedGross += x.gross;
      if (x.cost != null) { cogs += x.cost; costedGross += x.gross; costedNet += x.net; oProfit += x.net - x.cost; }
      const g = designs.get(l.productId) || {pieces: 0, gross: 0, net: 0, cost: 0, costed: x.cost != null, name: l.name};
      g.pieces += l.qty; g.gross += x.gross; g.net += x.net; g.cost += x.cost ?? 0; designs.set(l.productId, g);
    }
    if (i != null) { s.billed[i] += paise(o.total); s.net[i] += oNet; s.profit[i] += oProfit; s.bills[i]++; s.dealers[i].add(o.customerId); }
  }
  const billed = sum(orders.map(o => paise(o.total)));
  return {
    orders, designs, keys,
    series: {billed: s.billed, net: s.net, profit: s.profit, bills: s.bills, dealers: s.dealers.map(x => x.size)},
    billedPaise: billed, netPaise: net, gstPaise: gst, linesGrossPaise: gross,
    // No costed line at all → profit is unknown (null), never a ₹0 that looks like a fact.
    cogsPaise: costedGross ? cogs : null, costedNetPaise: costedNet, grossProfitPaise: costedGross ? costedNet - cogs : null,
    costCoveragePct: pctOf(costedGross, gross), gstCoveragePct: pctOf(ratedGross, gross),
    bills: orders.length, dealers: new Set(orders.map(o => o.customerId)).size,
  };
}

async function inputs() {
  const [products, profiles, bills, supplierPays, targets, anyBill] = await Promise.all([
    Models.products.find().select('id sku name category stock reservedStock reorder status').lean() as Promise<Product[]>,
    Inv.ProductProfile.find().select('productId gstRateBps avgCostPaise').lean(),
    Inv.Bill.find({status: {$in: LIVE_BILL}}).select('invoiceDate postedAt createdAt taxablePaise taxPaise totalPaise').lean(),
    Inv.SupplierPayment.find({status: 'POSTED'}).select('date createdAt amountPaise').lean(),
    Sales.Target.find({status: 'ACTIVE'}).lean(),
    Inv.Bill.exists({status: {$ne: 'CANCELLED'}}),
  ]);
  const pm = new Map<string, Profile>(profiles.map((p: any) => [p.productId, {gstRateBps: p.gstRateBps ?? null, costPaise: p.avgCostPaise ?? null}]));
  return {products, profiles: pm, bills, supplierPays, targets, anyPurchase: Boolean(anyBill)};
}

export function registerInsightsRoutes(app: Express) {
  app.get('/api/admin/insights', requireAuth, requirePerm('reports.view'), route(async (req: Request, res) => {
    const me = sessionUser(req);
    if (me.role === 'salesman') fail(403, 'You do not have permission for this action');
    const q = parse(z.object({idleDays: z.coerce.number().int().min(7).max(365).default(30), format: z.enum(['json', 'csv']).default('json')}), {idleDays: req.query.idleDays || undefined, format: req.query.format || undefined});
    const {from, to} = range(req);
    const canSeeCost = (await permissionsFor(me.role)).includes('inventory.valuation');
    const [d, inp] = await Promise.all([loadData(), inputs()]);
    const ctx = await context(d), b = bucketOf(from, to), prev = previousRange(from, to), now = today();
    const pmap = new Map(inp.products.map(p => [p.id, p]));

    const cur = salesFacts(d, inp.profiles, from, to, b), before = salesFacts(d, inp.profiles, prev.from, prev.to, b);
    const ps = periodStats(d, ctx, from, to, b), pps = periodStats(d, ctx, prev.from, prev.to, b);
    const facts = d.orders.map(o => orderFacts(d, ctx, o)), fm = new Map(facts.map(f => [f.id, f]));
    const periodFacts = cur.orders.map(o => fm.get(o.id)!);
    const due = facts.filter(f => f.duePaise > 0);
    const ageOf = (f: {countedOn: string | null}) => f.countedOn ? daysIn(f.countedOn, now) - 1 : 0;

    // ---------- KPIs (billed & collected are the Overview's numbers) ----------
    const kpiOf = (s: typeof cur, p: typeof ps) => ({
      billedPaise: s.billedPaise, netSalesPaise: s.netPaise, gstPaise: s.gstPaise,
      grossProfitPaise: canSeeCost ? s.grossProfitPaise : null,
      collectedPaise: p.kpi.collectedPaise, bills: s.bills, avgBillPaise: s.bills ? Math.round(s.billedPaise / s.bills) : 0, activeDealers: s.dealers,
    });
    const kpi = {...kpiOf(cur, ps), duePaise: sum(due.map(f => f.duePaise)), dueBills: due.length};
    const previousKpi = kpiOf(before, pps);
    const deltas = Object.fromEntries(Object.keys(previousKpi).map(k => [k, delta((kpi as any)[k], (previousKpi as any)[k])]));

    // ---------- profit ladder ----------
    const ladder = canSeeCost ? {
      netSalesPaise: cur.netPaise, cogsPaise: cur.cogsPaise, costedNetPaise: cur.costedNetPaise, grossProfitPaise: cur.grossProfitPaise,
      salariesPaise: null, expensesPaise: null,
      operatingProfitPaise: cur.grossProfitPaise,          // before salaries & expenses: neither is recorded in the app yet
      operatingIsBeforeOverheads: true, gstPaise: cur.gstPaise, costCoveragePct: cur.costCoveragePct,
      previousOperatingProfitPaise: before.grossProfitPaise, delta: delta(cur.grossProfitPaise, before.grossProfitPaise),
    } : null;

    // ---------- money out & GST (purchase bills dated in the period) ----------
    const billDate = (x: any) => x.invoiceDate || x.postedAt || x.createdAt;
    const pBills = inp.bills.filter((x: any) => inRange(billDate(x), from, to));
    const inputGst = sum(pBills.map((x: any) => x.taxPaise || 0));
    const gst = {outputPaise: cur.gstPaise, inputPaise: inp.anyPurchase ? inputGst : null, netPaise: cur.gstPaise - (inp.anyPurchase ? inputGst : 0), estimated: true, gstCoveragePct: cur.gstCoveragePct};
    const moneyOut = {
      anyPurchaseRecorded: inp.anyPurchase, purchaseBills: pBills.length,
      purchasesPaise: sum(pBills.map((x: any) => x.taxablePaise ?? ((x.totalPaise || 0) - (x.taxPaise || 0)))),
      paidToSuppliersPaise: sum(inp.supplierPays.filter((x: any) => inRange(x.date || x.createdAt, from, to)).map((x: any) => x.amountPaise || 0)),
      gstPayablePaise: Math.max(0, gst.netPaise), salariesPaise: null, expensesPaise: null,
    };

    // ---------- where every rupee went (bills of this period) ----------
    const paidOnBills = sum(periodFacts.map(f => Math.min(f.paidPaise, f.totalPaise)));
    const payStatus: Record<string, {count: number; paise: number}> = {PAID: {count: 0, paise: 0}, PARTIAL: {count: 0, paise: 0}, UNPAID: {count: 0, paise: 0}};
    for (const f of periodFacts) if (payStatus[f.payStatus]) { payStatus[f.payStatus].count++; payStatus[f.payStatus].paise += f.totalPaise; }
    const methods = new Map<string, number>();
    for (const p of d.payments.filter(p => p.status === 'VERIFIED' && inRange(p.paymentDate, from, to) && fm.has(p.orderId))) methods.set(p.method, (methods.get(p.method) || 0) + paise(p.amount));
    const created = d.orders.filter(o => inRange(o.createdAt, from, to));
    const cancelled = created.filter(o => ['Rejected', 'Cancelled'].includes(o.status)), pending = created.filter(o => o.status === 'Pending');
    const rupee = {
      billedPaise: cur.billedPaise, discountsPaise: null, returnsPaise: null,
      collectedOnBillsPaise: paidOnBills, stillDuePaise: sum(periodFacts.map(f => f.duePaise)), efficiencyPct: pctOf(paidOnBills, cur.billedPaise),
      payStatus, methods: [...methods.entries()].map(([method, valuePaise]) => ({method, valuePaise})).sort((x, y) => y.valuePaise - x.valuePaise),
      cancelled: {count: cancelled.length, valuePaise: sum(cancelled.map(o => paise(o.total)))}, pending: {count: pending.length, valuePaise: sum(pending.map(o => paise(o.total)))},
    };
    const best = cur.series.billed.reduce((bi, v, i, a) => v > a[bi] ? i : bi, 0);
    const trend = {keys: cur.keys, billed: cur.series.billed, collected: ps.series.collected, previousBilled: before.series.billed, previousCollected: pps.series.collected, best: cur.series.billed[best] > 0 ? {key: cur.keys[best], valuePaise: cur.series.billed[best]} : null};

    // ---------- designs ----------
    const designs = [...cur.designs.entries()].map(([id, g]) => {
      const p = pmap.get(id), profit = g.costed ? g.net - g.cost : null;
      return {id, sku: p?.sku || '', name: p?.name || g.name, category: p?.category || 'Uncategorised', pieces: g.pieces, salesPaise: g.gross, netPaise: g.net,
        costPaise: canSeeCost && g.costed ? g.cost : null, profitPaise: canSeeCost ? profit : null,
        marginPct: canSeeCost && profit != null ? pctOf(profit, g.net) : null, profitPerPiecePaise: canSeeCost && profit != null && g.pieces ? Math.round(profit / g.pieces) : null};
    }).sort((x, y) => y.salesPaise - x.salesPaise);
    const cats = new Map<string, {name: string; pieces: number; salesPaise: number; profitPaise: number; costed: boolean}>();
    for (const x of designs) { const c = cats.get(x.category) || {name: x.category, pieces: 0, salesPaise: 0, profitPaise: 0, costed: true}; c.pieces += x.pieces; c.salesPaise += x.salesPaise; if (x.profitPaise == null) c.costed = false; else c.profitPaise += x.profitPaise; cats.set(x.category, c); }
    const categories = [...cats.values()].map(c => ({name: c.name, pieces: c.pieces, salesPaise: c.salesPaise, profitPaise: canSeeCost ? c.profitPaise : null, complete: c.costed})).sort((x, y) => y.salesPaise - x.salesPaise);
    const soldNoCost = designs.filter(x => !cur.designs.get(x.id)!.costed);
    const soldNoGst = designs.filter(x => inp.profiles.get(x.id)?.gstRateBps == null);

    // ---------- dealers ----------
    const byDealer = new Map<string, {billedPaise: number; bills: number}>();
    for (const o of cur.orders) { const x = byDealer.get(o.customerId) || {billedPaise: 0, bills: 0}; x.billedPaise += paise(o.total); x.bills++; byDealer.set(o.customerId, x); }
    const cname = new Map(d.customers.map((c: any) => [c.id, c.name]));
    const dueBy = new Map<string, {duePaise: number; bills: number; oldest: number}>();
    for (const f of due) { const x = dueBy.get(f.customerId) || {duePaise: 0, bills: 0, oldest: 0}; x.duePaise += f.duePaise; x.bills++; x.oldest = Math.max(x.oldest, ageOf(f)); dueBy.set(f.customerId, x); }
    const dealers = [...byDealer.entries()].map(([id, x]) => ({id, name: cname.get(id) || id, ...x, duePaise: dueBy.get(id)?.duePaise || 0})).sort((x, y) => y.billedPaise - x.billedPaise);
    const lastBuy = new Map<string, string>(), lifetime = new Map<string, number>();
    for (const o of d.orders.filter(o => COUNTED[d.policy].includes(o.status))) { const k = ymd(countedDate(o, d.policy)); if (k > (lastBuy.get(o.customerId) || '')) lastBuy.set(o.customerId, k); lifetime.set(o.customerId, (lifetime.get(o.customerId) || 0) + paise(o.total)); }
    const cut = shiftIso(now, -q.idleDays);
    const idle = [...lastBuy.entries()].filter(([, k]) => k < cut).map(([id, k]) => ({id, name: cname.get(id) || id, lastOrder: k, days: daysIn(k, now) - 1, lifetimePaise: lifetime.get(id) || 0})).sort((x, y) => y.lifetimePaise - x.lifetimePaise);
    const top5 = dealers.slice(0, 5), others = sum(dealers.slice(5).map(x => x.billedPaise));
    const dealerShare = [...top5.map(x => ({label: x.name, valuePaise: x.billedPaise})), ...(others ? [{label: 'Others', valuePaise: others}] : [])];

    // ---------- salespeople (same achievement rule as the Targets page) ----------
    const people = new Set<string>([...ctx.userList.filter(u => u.role === 'salesman').map(u => u.id), ...cur.orders.map(o => o.createdBy).filter(Boolean)]);
    const tFor = (id: string) => inp.targets.filter((t: any) => t.salesmanId === id && t.type === 'SALES_AMOUNT' && t.startDate <= to && t.endDate >= from);
    const salespeople = [...people].map(id => {
      const m = metricsFor(d, id, from, to), pm2 = metricsFor(d, id, prev.from, prev.to), ts = tFor(id);
      const target = ts.length ? sum(ts.map((t: any) => t.targetValue)) : null, achieved = ts.length ? sum(ts.map((t: any) => targetProgress(t, d).achieved)) : null;
      const u = ctx.users.get(id);
      return {id, name: u?.name || 'Unknown', role: u?.role || null, active: u?.active !== false, billedPaise: m.salesPaise, collectedPaise: m.collectedPaise, bills: m.countedOrders, delta: delta(m.salesPaise, pm2.salesPaise), targetPaise: target, achievedPaise: achieved, targetPct: target && achieved != null ? pctOf(achieved, target) : null};
    }).filter(p => p.billedPaise > 0 || p.collectedPaise > 0 || p.targetPaise != null || (p.role === 'salesman' && p.active)).sort((x, y) => y.billedPaise - x.billedPaise);
    const withT = salespeople.filter(p => p.targetPaise != null);
    const team = {
      targetPct: withT.length ? pctOf(sum(withT.map(p => p.achievedPaise || 0)), sum(withT.map(p => p.targetPaise || 0))) : null,
      best: salespeople.find(p => p.role === 'salesman' && p.billedPaise > 0) || null,
      needsHelp: withT.filter(p => (p.targetPct ?? 0) < 50).sort((x, y) => (x.targetPct ?? 0) - (y.targetPct ?? 0))[0] || null,
      salesmen: ctx.userList.filter(u => u.role === 'salesman' && u.active !== false).length,
    };

    // ---------- receivables ----------
    const ageing = AGE_BUCKETS.map(([key, lo, hi]) => { const xs = due.filter(f => { const a = ageOf(f); return a >= lo && a <= hi; }); return {key, paise: sum(xs.map(f => f.duePaise)), count: xs.length}; });
    const overdueDealers = [...dueBy.entries()].map(([id, x]) => ({id, name: cname.get(id) || id, ...x})).sort((x, y) => y.oldest - x.oldest || y.duePaise - x.duePaise).slice(0, 5);
    const oldest = due.slice().sort((x, y) => ageOf(y) - ageOf(x))[0];
    const money = {duePaise: kpi.duePaise, dueTodayPaise: sum(due.filter(f => f.countedOn === now).map(f => f.duePaise)), dueOlderPaise: sum(due.filter(f => f.countedOn !== now).map(f => f.duePaise)), bills: due.length,
      oldest: oldest ? {customerName: oldest.customerName, days: ageOf(oldest), duePaise: oldest.duePaise} : null,
      over30: {dealers: new Set(due.filter(f => ageOf(f) > 30).map(f => f.customerId)).size, paise: sum(due.filter(f => ageOf(f) > 30).map(f => f.duePaise))}};

    // ---------- stock ----------
    const active = inp.products.filter(p => p.status === 'active');
    const lastSale = new Map<string, string>();
    for (const o of d.orders.filter(o => COUNTED[d.policy].includes(o.status))) { const k = ymd(countedDate(o, d.policy)); for (const l of o.items) if (k > (lastSale.get(l.productId) || '')) lastSale.set(l.productId, k); }
    const deadCut = shiftIso(now, -DEAD_DAYS), costOf = (id: string) => inp.profiles.get(id)?.costPaise ?? null;
    const deadAll = active.filter(p => p.stock > 0 && (lastSale.get(p.id) || '') < deadCut);
    const stock = {
      deadDays: DEAD_DAYS, tracked: active.length,
      low: active.filter(p => p.reorder > 0 && p.stock - (p.reservedStock || 0) <= p.reorder).map(p => ({id: p.id, sku: p.sku, name: p.name, available: p.stock - (p.reservedStock || 0), reorder: p.reorder})).sort((x, y) => x.available - y.available),
      dead: deadAll.map(p => ({id: p.id, sku: p.sku, name: p.name, stock: p.stock, lastSale: lastSale.get(p.id) || null, valuePaise: canSeeCost && costOf(p.id) != null ? Math.round(p.stock * costOf(p.id)!) : null})).sort((x, y) => (y.valuePaise || 0) - (x.valuePaise || 0) || y.stock - x.stock),
      deadValuePaise: canSeeCost ? sum(deadAll.map(p => costOf(p.id) != null ? Math.round(p.stock * costOf(p.id)!) : 0)) : null, deadUncosted: deadAll.filter(p => costOf(p.id) == null).length,
      fast: designs.slice().sort((x, y) => y.pieces - x.pieces).slice(0, 5).map(x => ({id: x.id, sku: x.sku, name: x.name, pieces: x.pieces, available: pmap.has(x.id) ? pmap.get(x.id)!.stock - (pmap.get(x.id)!.reservedStock || 0) : null})),
    };

    // ---------- data completeness & things to do (only what the data supports) ----------
    const unverified = d.payments.filter(p => p.status === 'UNVERIFIED' && fm.has(p.orderId));
    const completeness = {
      costPct: cur.costCoveragePct, gstPct: cur.gstCoveragePct, designsNoCost: soldNoCost.length, designsNoGst: soldNoGst.length,
      noCost: soldNoCost.slice(0, 10).map(x => ({id: x.id, sku: x.sku, name: x.name})),
      checklist: [
        {key: 'cost', done: cur.bills > 0 && soldNoCost.length === 0, available: true, go: 'Products'},
        {key: 'gst', done: cur.bills > 0 && soldNoGst.length === 0, available: true, go: 'Products'},
        {key: 'purchases', done: inp.anyPurchase, available: true, go: 'Inventory'},
        {key: 'targets', done: inp.targets.length > 0, available: true, go: 'Targets'},
        {key: 'expenses', done: false, available: false, go: null},
      ],
    };
    const actions: Array<{kind: string; vars: Record<string, string | number>; go: string}> = [];
    if (money.over30.dealers) actions.push({kind: 'callOverdue', vars: {n: money.over30.dealers, amount: money.over30.paise}, go: 'Bills'});
    if (canSeeCost && soldNoCost.length) actions.push({kind: 'addCost', vars: {n: soldNoCost.length}, go: 'Products'});
    if (idle[0]) actions.push({kind: 'followUp', vars: {name: idle[0].name, days: idle[0].days}, go: 'Customers'});
    if (unverified.length) actions.push({kind: 'verifyPayments', vars: {n: unverified.length, amount: sum(unverified.map(p => paise(p.amount)))}, go: 'Orders'});
    if (stock.low.length) actions.push({kind: 'restock', vars: {n: stock.low.length}, go: 'Inventory'});
    if (soldNoGst.length) actions.push({kind: 'addGst', vars: {n: soldNoGst.length}, go: 'Products'});
    if (team.needsHelp) actions.push({kind: 'coach', vars: {name: team.needsHelp.name, pct: team.needsHelp.targetPct ?? 0}, go: 'Performance'});

    const out = {
      from, to, previous: prev, bucket: b, policy: d.policy, canSeeCost, idleDays: q.idleDays,
      kpi, previousKpi, deltas,
      series: {billed: cur.series.billed, net: cur.series.net, profit: canSeeCost ? cur.series.profit : null, collected: ps.series.collected, bills: cur.series.bills, dealers: cur.series.dealers},
      ladder, moneyOut, gst, rupee, trend,
      designs, categories, dealers: dealers.slice(0, 10), dealerShare,
      dealerStats: {active: ps.kpi.buyers, new: ps.kpi.newCustomers, returning: ps.kpi.repeatCustomers, idle: idle.length, everBought: lastBuy.size},
      idle: idle.slice(0, 8), salespeople, team, ageing, overdueDealers, money, stock, completeness, actions: actions.slice(0, 3),
      topDealer: dealers[0] ? {name: dealers[0].name, billedPaise: dealers[0].billedPaise} : null,
      topDueDealer: [...dueBy.entries()].sort((x, y) => y[1].duePaise - x[1].duePaise).map(([id, x]) => ({name: cname.get(id) || id, duePaise: x.duePaise}))[0] || null,
    };

    if (q.format === 'csv') {
      const esc = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
      const r = (v: number | null) => v == null ? 'not recorded' : v / 100;
      const rows: unknown[][] = [[`Insights ${from} to ${to}`], ['Prices include GST; GST and net sales are estimates from each design GST rate.'], [],
        ['Summary', 'Value (₹)'], ['Billed incl. GST', r(kpi.billedPaise)], ['Net sales excl. GST (est.)', r(kpi.netSalesPaise)], ['GST collected (est.)', r(kpi.gstPaise)],
        ...(canSeeCost ? [['Cost of goods sold', r(cur.cogsPaise)], ['Gross profit', r(cur.grossProfitPaise)], ['Cost known for % of sales', cur.costCoveragePct]] : []),
        ['Collected', r(kpi.collectedPaise)], ['Due now (all bills)', r(kpi.duePaise)], ['Bills', kpi.bills], ['Average bill', r(kpi.avgBillPaise)], ['Active dealers', kpi.activeDealers],
        ['Purchases (taxable)', r(moneyOut.purchasesPaise)], ['Input GST', r(gst.inputPaise)], ['Net GST payable (est.)', r(gst.netPaise)], ['Salaries & advances', 'not recorded'], ['Other expenses', 'not recorded'], [],
        ['Design no.', 'Design', 'Category', 'Pieces', 'Sales incl. GST (₹)', ...(canSeeCost ? ['Profit (₹)', 'Margin %'] : [])],
        ...designs.map(x => [x.sku, x.name, x.category, x.pieces, x.salesPaise / 100, ...(canSeeCost ? [x.profitPaise == null ? 'no cost price' : x.profitPaise / 100, x.marginPct ?? ''] : [])]), [],
        ['Dealer', 'Bills', 'Billed (₹)', 'Due now (₹)'], ...dealers.map(x => [x.name, x.bills, x.billedPaise / 100, x.duePaise / 100]), [],
        ['Salesperson', 'Bills', 'Billed (₹)', 'Collected (₹)', 'Target achieved %'], ...salespeople.map(x => [x.name, x.bills, x.billedPaise / 100, x.collectedPaise / 100, x.targetPct ?? '']), [],
        ['Due age (days)', 'Bills', 'Due (₹)'], ...ageing.map(x => [x.key, x.count, x.paise / 100])];
      res.set('Content-Type', 'text/csv; charset=utf-8').set('Content-Disposition', `attachment; filename="insights-${from}-to-${to}.csv"`).send('﻿' + rows.map(x => x.map(esc).join(',')).join('\n'));
      return;
    }
    res.json(out);
  }));
}
