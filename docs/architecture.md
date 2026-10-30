# Architecture and business invariants

The repository is split into `apps/api` and `apps/web`. The API owns validation, authentication, authorization, stock policy, invoice eligibility and audit logging. The browser never supplies authoritative totals or stock balances.

## Core records

MongoDB is the default persistence mode. Mongoose models are defined in `apps/api/src/models.ts` with unique/indexed identifiers, timestamps and field constraints. `PERSISTENCE=json` is an explicit local fallback; the API selects exactly one repository at startup and never writes both. `scripts/import-json.ts` imports a validated JSON snapshot into an isolated MongoDB database without modifying the source file.

## Stock policy

`submission` reserves stock when a salesman submits an order. `approval` reserves stock when an authorized user approves it. `dispatch` consumes on-hand stock at dispatch. Reservation does not reduce on-hand; available stock is `onHand - reserved`. Rejection/cancellation releases reservations, while dispatch finalization creates a sale movement and reduces on-hand. Every change records before/after quantities, source, actor, timestamp and idempotency key where applicable.

Mongo mode uses Mongoose transactions when the connected topology supports them. A standalone MongoDB server does not support multi-document transactions; startup rejects a standalone topology. Mutations are serialized within one process and across API instances with a short-lived MongoDB lease lock before the transaction. The current snapshot repository is therefore protected against concurrent application writers while the lock is held, but a future high-scale deployment should replace snapshot replacement with atomic conditional product updates and append-only ledger writes.

## Permissions

Owner: all modules, settings, approvals, reports, audit. Accounts: purchases, invoices, payments, expenses, permitted reports. Salesman: catalog, permitted customer records, order submission and own order status. Every sensitive action must be enforced by the API.
