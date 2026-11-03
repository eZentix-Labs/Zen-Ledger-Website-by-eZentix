import type {Express} from 'express';
import {registerItemRoutes} from './routes-items.js';
import {registerSupplierRoutes} from './routes-suppliers.js';
import {registerPurchaseRoutes} from './routes-purchases.js';
import {registerProductionRoutes} from './routes-production.js';
import {registerControlRoutes} from './routes-control.js';
import {registerReportRoutes} from './routes-reports.js';
import {registerProductRoutes} from './routes-products.js';

export {registerFileRoutes} from './files.js';
export {Inv} from './models.js';

/** All /api/inventory/* routes. Requires MongoDB (transactions); see docs/INVENTORY_DATABASE_ARCHITECTURE.md. */
export function registerInventoryRoutes(app: Express) {
  registerItemRoutes(app);
  registerProductRoutes(app);
  registerSupplierRoutes(app);
  registerPurchaseRoutes(app);
  registerProductionRoutes(app);
  registerControlRoutes(app);
  registerReportRoutes(app);
}
