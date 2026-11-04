// Data layer for the admin Orders page. Reads the Order desk API (backend/src/overview/routes.ts, built on
// orderFacts) and changes orders only through the existing endpoints, so stock rules stay identical.
import {downloadCsv, get, send} from '../inventory/api';

export type OrderStatus = 'Pending' | 'Approved' | 'Processing' | 'Dispatched' | 'Delivered' | 'Rejected' | 'Cancelled';
export const STATUSES: OrderStatus[] = ['Pending', 'Approved', 'Processing', 'Dispatched', 'Delivered', 'Rejected', 'Cancelled'];
export const FLOW: OrderStatus[] = ['Pending', 'Approved', 'Processing', 'Dispatched', 'Delivered'];
export type PayStatus = 'PAID' | 'PARTIAL' | 'UNPAID' | 'NA';

export type OrderRow = {
  id: string; number: string; createdAt: string; updatedAt: string | null; status: OrderStatus;
  customerId: string; customerName: string; customerPhone: string; salesmanId: string | null; salesmanName: string | null; salesmanRole: string | null;
  lines: number; qty: number; firstItem: string; itemNames: string[];
  totalPaise: number; paidPaise: number; duePaise: number; payStatus: PayStatus; methods: string[];
  counted: boolean; countedOn: string | null; delayed: boolean; ageHours: number;
};
export type OrderTotals = {count: number; valuePaise: number; paidPaise: number; duePaise: number; countedValuePaise: number; countedOrders: number; pending: number; inProgress: number; completed: number; cancelled: number; delayed: number};
export type OrderList = {
  items: OrderRow[]; page: number; limit: number; total: number; totals: OrderTotals; statusCounts: Partial<Record<OrderStatus, number>>;
  analytics: {byHour: number[]; status: Partial<Record<OrderStatus, number>>; methods: Record<string, number>};
  salesmen: Array<{id: string; name: string; role: string}>; delayRule: {pendingHours: number; activeHours: number};
};
export type OrderDetail = Omit<OrderRow, 'lines'> & {
  returnedPaise: number;
  returns: Array<{id: string; lineNo: number; productId: string; productName: string; qty: number; valuePaise: number; reason: string; returnedAt: string; by: string}>;
  lines: Array<{productId: string; lineNo: number; name: string; qty: number; returnedQty: number; returnableQty: number; returnValuePaise: number; returns: Array<{id: string; qty: number; valuePaise: number; reason: string; returnedAt: string}>; price: number; unit?: string; sku: string; category: string; lineTotalPaise: number}>;
  customer: {id: string; name: string; phone: string; address: string; balance: number} | null;
  payments: Array<{id: string; amountPaise: number; method: string; status: string; paymentDate: string; reference: string; recordedBy: string | null; createdAt: string}>;
  timeline: Array<{at: string; type: string; by: string | null; description: string}>;
  stamps: {createdAt: string; approvedAt: string | null; dispatchedAt: string | null; deliveredAt: string | null; closedAt: string | null; reason: string | null; statusBy: string | null};
  invoice: {id: string; number: string; total: number; paid: number; status: string; createdAt: string} | null;
  next: OrderStatus[];
  can: {changeStatus: boolean; recordPayment: boolean; invoice: boolean; duplicate: boolean; return: boolean};
};

export type OrderFilters = {from: string; to: string; q: string; status: string; pay: string; method: string; salesman: string; min: string; max: string; delayed: boolean};
export const orderQuery = (f: OrderFilters) => ({from: f.from, to: f.to, q: f.q || undefined, status: f.status || undefined, pay: f.pay || undefined, method: f.method || undefined, salesman: f.salesman || undefined, min: f.min || undefined, max: f.max || undefined, delayed: f.delayed ? '1' : undefined});

/** A 404 on the fixed list endpoint can only mean the API process predates the Order desk. */
async function deskGet<T>(path: string, query?: Record<string, unknown>): Promise<T> {
  try { return await get<T>(path, query); }
  catch (e) {
    if ((e as {status?: number}).status === 404) throw new Error('The API server is running an older version without the Order desk. Restart the backend (stop it, then run "npm run dev" in the backend folder) and reload this page.');
    throw e;
  }
}

export const ordersApi = {
  list: (f: OrderFilters, page: number, limit: number, sort: string, dir: 'asc' | 'desc') => deskGet<OrderList>('/api/admin/orders', {...orderQuery(f), page, limit, sort, dir}),
  /** Same endpoint and same filters (status included) over the previous window, so "vs previous period" compares like with like. */
  totals: (f: OrderFilters) => deskGet<OrderList>('/api/admin/orders', {...orderQuery(f), page: 1, limit: 1}).then(r => r.totals),
  detail: (id: string) => get<OrderDetail>(`/api/admin/orders/${id}`),
  exportCsv: (f: OrderFilters, sort: string, dir: string) => downloadCsv('/api/admin/orders', {...orderQuery(f), sort, dir}),
  setStatus: (id: string, status: OrderStatus, reason?: string) => send('PATCH', `/api/orders/${id}/status`, reason ? {status, reason} : {status}),
  createInvoice: (id: string) => send<{number: string}>('POST', `/api/invoices/from-order/${id}`),
  recordPayment: (orderId: string, amountRupees: number, method: string, reference: string, paymentDate: string) =>
    send('POST', '/api/sales/payments', {orderId, amount: amountRupees, method, reference, paymentDate}),
  returnLine: (orderId: string, lineNo: number, qty: number, reason: string, key: string) =>
    send('POST', `/api/sales/orders/${orderId}/returns`, {lineNo, qty, reason}, key),
};
