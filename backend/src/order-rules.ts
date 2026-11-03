import type {OrderStatus} from './types.js';
/** Allowed order status moves — the single rule set used by the status endpoint and the admin order desk. */
export const transitions: Record<OrderStatus, OrderStatus[]> = {Pending: ['Approved', 'Rejected', 'Cancelled'], Approved: ['Processing', 'Rejected', 'Cancelled', 'Dispatched'], Processing: ['Dispatched', 'Cancelled'], Dispatched: ['Delivered'], Delivered: [], Rejected: [], Cancelled: []};
