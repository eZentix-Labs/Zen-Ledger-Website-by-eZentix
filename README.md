# Zen Ledger

Zen Ledger is a modular-monolith inventory, salesman ordering, billing and accounts workspace built around a shared API and a responsive admin UI.

## Local setup

1. Install Node.js 20+.
2. Copy `.env.example` to `.env`, set a long `JWT_SECRET`, and choose `PERSISTENCE=mongo` or the explicit local fallback `PERSISTENCE=json`.
3. Run `npm install`.
4. Run `npm run dev`.
5. Open `http://localhost:5173`.

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

## Commands

`npm run dev` starts API on port 4000 and Vite on port 5173.

`npm run typecheck` and `npm run build` validate the two TypeScript projects after dependencies are available.

`npm test` runs the stock invariant tests once dependencies are installed.

## JSON import

Never run imports against an unknown or production database. Start a dedicated local MongoDB replica set, set `PERSISTENCE=mongo`, `MONGODB_URI`, and `IMPORT_CONFIRM=EMPTY_LOCAL_DB_ONLY`, then run `npm run import:json`. The original JSON file is read only and never deleted or overwritten. The importer validates required collections and stock invariants, requires a clearly named `dev` or `test` database, and refuses non-empty targets.
