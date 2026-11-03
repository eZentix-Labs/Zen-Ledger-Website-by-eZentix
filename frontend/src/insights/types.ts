// Shape of GET /api/sales/me/insights (backend/src/sales/routes.ts). Money is always in paise.
export type Metrics = {
  salesPaise: number; revenuePaise: number; countedOrders: number; ordersCreated: number; successfulOrders: number;
  approvedOrders: number; pendingOrders: number; cancelledOrders: number; avgOrderValuePaise: number;
  collectedPaise: number; unverifiedCollectionsPaise: number; outstandingPaise: number;
  newCustomers: number; deliveries: number; assignedCustomers: number;
};
export type TargetProgress = {achieved: number; remaining: number; pct: number | null; state: 'ACTIVE' | 'COMPLETED' | 'OVERDUE' | 'UPCOMING' | 'CANCELLED'; money: boolean; daysLeft: number};
export type Target = {id: string; name: string; type: string; period: string; targetValue: number; startDate: string; endDate: string; instructions: string; progress: TargetProgress};
export type SalesTarget = Target & {perDayPaise: number; prorated: boolean; periodTargetPaise: number; daysRemaining: number; requiredPerDayPaise: number; projectedPaise: number | null};
export type Grain = 'hour' | 'day' | 'month';
export type Insights = {
  period: {from: string; to: string; days: number; today: string; grain: Grain};
  previous: {from: string; to: string};
  policy: 'APPROVED' | 'DISPATCHED';
  metrics: Metrics; previousMetrics: Metrics;
  target: SalesTarget | null; targets: Target[];
  series: Array<{key: string; salesPaise: number; orders: number; targetPaise: number | null}>;
  bestDay: {date: string; salesPaise: number} | null;
  products: Array<{id: string; name: string; qty: number; valuePaise: number}>;
  customers: Array<{id: string; name: string; orders: number; valuePaise: number}>;
  customerHealth: {buyers: number; repeat: number; new: number; slippingDays: number; slippingCount: number; slipping: Array<{id: string; name: string; lastOrder: string; daysSince: number; valuePaise: number}>};
  dues: {totalPaise: number; recentPaise: number; olderPaise: number; oldest: {customerName: string; ageDays: number; amountPaise: number} | null; top: Array<{id: string; name: string; amountPaise: number; oldestDays: number}>};
  collectionsByMethod: Record<string, number>;
  completeness: {pct: number; pendingOrders: number; unverifiedCollections: number};
};
/** Existing salesman-app tabs that Insights can send the user to. */
export type GoTab = 'catalog' | 'orders' | 'collect';
