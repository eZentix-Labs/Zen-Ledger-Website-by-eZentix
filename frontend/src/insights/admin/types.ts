// Shape of GET /api/admin/insights (backend/src/overview/insights.ts). All money is integer paise.
// `null` means "not recorded / not visible", never zero.
export type Page = 'Overview' | 'Inventory' | 'Products' | 'Orders' | 'Bills' | 'Invoices' | 'Customers' | 'Distributors' | 'Salesmen' | 'Targets' | 'Performance' | 'Settings';
export type Kpi = {billedPaise: number; netSalesPaise: number; gstPaise: number; grossProfitPaise: number | null; collectedPaise: number; bills: number; avgBillPaise: number; activeDealers: number};
export type Design = {id: string; sku: string; name: string; category: string; pieces: number; salesPaise: number; netPaise: number; costPaise: number | null; profitPaise: number | null; marginPct: number | null; profitPerPiecePaise: number | null};
export type Salesperson = {id: string; name: string; role: string | null; active: boolean; billedPaise: number; collectedPaise: number; bills: number; delta: number | null; targetPaise: number | null; achievedPaise: number | null; targetPct: number | null};
export type Action = {kind: 'callOverdue' | 'addCost' | 'followUp' | 'verifyPayments' | 'restock' | 'addGst' | 'coach'; vars: Record<string, string | number>; go: Page};
export type CheckItem = {key: 'cost' | 'gst' | 'purchases' | 'targets' | 'expenses'; done: boolean; available: boolean; go: Page | null};

export type AdminInsights = {
  from: string; to: string; previous: {from: string; to: string}; bucket: 'hour' | 'day' | 'month'; policy: 'APPROVED' | 'DISPATCHED'; canSeeCost: boolean; idleDays: number;
  kpi: Kpi & {duePaise: number; dueBills: number}; previousKpi: Kpi; deltas: Partial<Record<keyof Kpi, number | null>>;
  series: {billed: number[]; net: number[]; profit: number[] | null; collected: number[]; bills: number[]; dealers: number[]};
  // cogs / profit are null when no billed design has a cost price (unknown, not zero).
  ladder: null | {netSalesPaise: number; cogsPaise: number | null; costedNetPaise: number; grossProfitPaise: number | null; salariesPaise: null; expensesPaise: null; operatingProfitPaise: number | null; operatingIsBeforeOverheads: boolean; gstPaise: number; costCoveragePct: number | null; previousOperatingProfitPaise: number | null; delta: number | null};
  moneyOut: {anyPurchaseRecorded: boolean; purchaseBills: number; purchasesPaise: number; paidToSuppliersPaise: number; gstPayablePaise: number; salariesPaise: null; expensesPaise: null};
  gst: {outputPaise: number; inputPaise: number | null; netPaise: number; estimated: true; gstCoveragePct: number | null};
  rupee: {billedPaise: number; discountsPaise: null; returnsPaise: null; collectedOnBillsPaise: number; stillDuePaise: number; efficiencyPct: number | null;
    payStatus: Record<'PAID' | 'PARTIAL' | 'UNPAID', {count: number; paise: number}>; methods: Array<{method: string; valuePaise: number}>;
    cancelled: {count: number; valuePaise: number}; pending: {count: number; valuePaise: number}};
  trend: {keys: string[]; billed: number[]; collected: number[]; previousBilled: number[]; previousCollected: number[]; best: {key: string; valuePaise: number} | null};
  designs: Design[]; categories: Array<{name: string; pieces: number; salesPaise: number; profitPaise: number | null; complete: boolean}>;
  dealers: Array<{id: string; name: string; billedPaise: number; bills: number; duePaise: number}>; dealerShare: Array<{label: string; valuePaise: number}>;
  dealerStats: {active: number; new: number; returning: number; idle: number; everBought: number};
  idle: Array<{id: string; name: string; lastOrder: string; days: number; lifetimePaise: number}>;
  salespeople: Salesperson[]; team: {targetPct: number | null; best: Salesperson | null; needsHelp: Salesperson | null; salesmen: number};
  ageing: Array<{key: '0-7' | '8-30' | '31-60' | '60+'; paise: number; count: number}>;
  overdueDealers: Array<{id: string; name: string; duePaise: number; bills: number; oldest: number}>;
  money: {duePaise: number; dueTodayPaise: number; dueOlderPaise: number; bills: number; oldest: {customerName: string; days: number; duePaise: number} | null; over30: {dealers: number; paise: number}};
  stock: {deadDays: number; tracked: number; low: Array<{id: string; sku: string; name: string; available: number; reorder: number}>;
    dead: Array<{id: string; sku: string; name: string; stock: number; lastSale: string | null; valuePaise: number | null}>; deadValuePaise: number | null; deadUncosted: number;
    fast: Array<{id: string; sku: string; name: string; pieces: number; available: number | null}>};
  completeness: {costPct: number | null; gstPct: number | null; designsNoCost: number; designsNoGst: number; noCost: Array<{id: string; sku: string; name: string}>; checklist: CheckItem[]};
  actions: Action[];
  topDealer: {name: string; billedPaise: number} | null; topDueDealer: {name: string; duePaise: number} | null;
};
