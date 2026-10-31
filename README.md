# Zen Ledger

Zen Ledger is a modular-monolith inventory, salesman ordering, billing and accounts workspace built around a shared API and a responsive admin UI.

## Project layout

- `backend/` is the Render web service. It contains the Express API, MongoDB repository, `render.yaml`, and backend environment template.
- `frontend/` is the Vercel site. It contains the Vite React app, `vercel.json`, and `VITE_API_URL` environment template.

## Local setup

Install Node.js 20+, then run each app in its own terminal:

```powershell
cd backend
npm install
npm run dev
```

```powershell
cd frontend
npm install
npm run dev
```

Set `VITE_API_URL=http://localhost:4000` in `frontend/.env` for local API calls. The demo login is `owner@example.com` / `ChangeMe123!`.

The local demo login is `owner@example.com` / `ChangeMe123!`. Change it before any real use. The default persistence mode is MongoDB. The JSON fallback is for isolated development only and is never mixed with MongoDB writes.

Development-only local accounts are provisioned when `NODE_ENV=development` and the JSON datastore loads: `accounts@example.com` / `AccountsTest123!` and `salesperson@example.com` / `SalesTest123!`. These accounts are never seeded in production. The salesperson workspace supports catalog search, cart, customer creation, idempotent order submission, and own-order tracking.

## What is implemented

- Authenticated owner/admin shell with server-side JWT role checks and rate limiting.
- Zen OS-inspired dark/light responsive design system with persistent theme toggle.
- Dashboard metrics backed by the API, products with low-stock warnings, customer directory, orders, order approvals/rejections, invoices, settings and audit entries.
- Shared product, customer, order and invoice records for admin and salesman workflows.
- Configurable stock policy: order submission, approval, or dispatch/finalization.
- MongoDB models with indexes, timestamps, environment validation, startup lifecycle, and a JSON import utility.
- On-hand, reserved and available stock with inventory movement ledger, idempotency keys, overselling protection, validated order transitions, reservation release, and sale finalization.

## Important limitations

The environment did not provide MongoDB or permit npm registry downloads during implementation, so MongoDB connection and migration were not verified here. `PERSISTENCE=json` remains available as an explicit local fallback. MongoDB mode uses Mongoose sessions and requires a replica set for transaction guarantees; API mutations use a MongoDB lease lock plus transaction. High-scale multi-instance deployment still requires atomic MongoDB stock-operation updates before production use.

Do not use the local JSON datastore for concurrent production traffic, legal/tax reporting, or financial truth.

## Deployment

Create a Render Web Service with root directory `backend`. Render uses `backend/render.yaml`, builds with `npm install && npm run build`, and starts with `npm start`.

Create a Vercel Project with root directory `frontend`. Vercel uses `frontend/vercel.json` and `npm run build`.

After the Render URL exists, set `frontend`'s `VITE_API_URL` to that URL and set the backend `APP_ORIGIN` to the Vercel URL. Configure `MONGODB_URI` and a unique production `JWT_SECRET` in Render.

## JSON import

Never run imports against an unknown or production database. Start a dedicated local MongoDB replica set, set `PERSISTENCE=mongo`, `MONGODB_URI`, and `IMPORT_CONFIRM=EMPTY_LOCAL_DB_ONLY`, then run `npm run import:json`. The original JSON file is read only and never deleted or overwritten. The importer validates required collections and stock invariants, requires a clearly named `dev` or `test` database, and refuses non-empty targets.
