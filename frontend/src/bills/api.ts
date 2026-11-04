// Data layer for the Bills page. Shapes mirror backend/src/bills/routes.ts; money is always in paise.
import {downloadCsv, get, send} from '../inventory/api';

export type Tab = 'all' | 'PAID' | 'PARTIAL' | 'UNPAID' | 'overdue' | 'cancelled';
export type PayStatus = 'PAID' | 'PARTIAL' | 'UNPAID' | 'NA';
export type Bill = {
  id: string; number: string; invoiceNumber: string | null; billDate: string; createdAt: string; status: string;
  customerId: string; customerName: string; customerPhone: string; salesmanId: string | null; salesmanName: string | null;
  lines: number; qty: number; itemNames: string[]; totalPaise: number; paidPaise: number; duePaise: number; returnedPaise: number;
  payStatus: PayStatus; methods: string[]; billed: boolean; cancelled: boolean; ageDays: number; overdue: boolean;
};
export type Totals = {count: number; activeCount: number; billedPaise: number; collectedPaise: number; duePaise: number; avgPaise: number; overduePaise: number; overdueCount: number};
export type BillList = {
  items: Bill[]; total: number; page: number; limit: number; totals: Totals; tabs: Record<Tab, number>;
  overdueDays: number; policy: 'APPROVED' | 'DISPATCHED'; salesmen: Array<{id: string; name: string}>; customers: Array<{id: string; name: string}>;
};
export type BillInsights = {
  period: {from: string; to: string; bucket: 'hour' | 'day' | 'month'} | null; previous: {from: string; to: string} | null;
  totals: Totals; previousTotals: Totals | null;
  series: {keys: string[]; billed: number[]; collected: number[]; count: number[]; previousBilled: number[] | null; previousCollected: number[] | null} | null;
  status: {PAID: number; PARTIAL: number; UNPAID: number; cancelled: number};
  statusValue: {PAID: number; PARTIAL: number; UNPAID: number};
  topCustomersByDue: Array<{id: string; name: string; duePaise: number; bills: number}>;
  salesmen: Array<{id: string | null; name: string; billedPaise: number; collectedPaise: number}>;
  ageing: Array<{bucket: '0-7' | '8-30' | '31-60' | '60+'; duePaise: number; bills: number}>;
  overdueDays: number;
};
export type BillLine = {lineNo: number; productId: string; name: string; design: string; sku: string; hsn: string; qty: number; returnedQty: number; returnableQty: number; returnValuePaise: number; returns: Array<{id: string; qty: number; valuePaise: number; reason: string; returnedAt: string; by: string}>; unit: string; ratePaise: number; totalPaise: number; gstRateBps: number; gstRateKnown: boolean; taxablePaise: number; cgstPaise: number; sgstPaise: number};
/** Bill detail: `lines` is the item array here (the list row's `lines` is a count). */
export type BillDetailResponse = Omit<Bill, 'lines'> & {
  lines: BillLine[];
  tax: {taxablePaise: number; cgstPaise: number; sgstPaise: number; estimated: true; missingRates: number};
  customer: {id: string; name: string; phone: string; address: string; balancePaise: number} | null;
  payments: Array<{id: string; amountPaise: number; method: string; status: string; paymentDate: string; reference: string; recordedBy: string}>;
  returns: Array<{id: string; lineNo: number; productId: string; productName: string; qty: number; valuePaise: number; reason: string; returnedAt: string; by: string}>;
  timeline: Array<{at: string; type: string; by: string | null; description: string}>;
  stamps: {createdAt: string; approvedAt: string | null; dispatchedAt: string | null; deliveredAt: string | null; reason: string | null};
  can: {recordPayment: boolean; cancel: boolean; return: boolean};
};

export type Filters = {from: string; to: string; q: string; tab: Tab; salesman: string; customer: string; min: string; max: string};
export const filterQuery = (f: Filters) => ({from: f.from, to: f.to, q: f.q || undefined, tab: f.tab === 'all' ? undefined : f.tab, salesman: f.salesman || undefined, customer: f.customer || undefined, min: f.min || undefined, max: f.max || undefined});

/**
 * For the fixed Bills endpoints (list, insights, form data) a 404 can only mean the API process was started
 * before these routes existed (Node does not reload code). Say that plainly instead of "HTTP 404".
 * Not used for a single bill, where 404 really means "bill not found".
 */
async function billsGet<T>(path: string, query?: Record<string, unknown>): Promise<T> {
  try { return await get<T>(path, query); }
  catch (e) {
    if ((e as {status?: number}).status === 404) throw new Error('The API server is running an older version without the Bills page. Restart the backend (stop it, then run "npm run dev" in the backend folder) and reload this page.');
    throw e;
  }
}

export const billsApi = {
  list: (f: Filters, page: number, limit: number, sort: string, dir: 'asc' | 'desc') => billsGet<BillList>('/api/admin/bills', {...filterQuery(f), page, limit, sort, dir}),
  insights: (f: Filters) => billsGet<BillInsights>('/api/admin/bills/insights', filterQuery(f)),
  detail: (id: string) => get<BillDetailResponse>(`/api/admin/bills/${id}`),
  catalogue: <T,>() => billsGet<T>('/api/admin/bills/catalogue'),
  customers: <T,>() => billsGet<T>('/api/admin/bills/customers'),
  exportCsv: (f: Filters, sort: string, dir: string) => downloadCsv('/api/admin/bills', {...filterQuery(f), sort, dir}),
  /** Existing endpoint: owner/accountant collections are verified immediately. */
  recordPayment: (orderId: string, amountRupees: number, method: string, reference: string, paymentDate: string) =>
    send('POST', '/api/sales/payments', {orderId, amount: amountRupees, method, reference, paymentDate}),
  returnLine: (orderId: string, lineNo: number, qty: number, reason: string, key: string) =>
    send('POST', `/api/sales/orders/${orderId}/returns`, {lineNo, qty, reason}, key),
  /** Existing endpoint: cancelling an approved order releases its stock. */
  cancel: (orderId: string, reason: string) => send('PATCH', `/api/orders/${orderId}/status`, {status: 'Cancelled', reason}),
};
