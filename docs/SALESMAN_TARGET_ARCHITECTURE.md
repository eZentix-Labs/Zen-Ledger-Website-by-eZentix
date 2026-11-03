# Salesman, Order, Target, Activity and Permission Architecture

**Status:** Proposal for approval. No code has been written.
**Companion docs:** `BUSINESS_REQUIREMENT_AUDIT.md`, `INVENTORY_ARCHITECTURE.md`, `IMPLEMENTATION_ROADMAP.md`.

---

## 1. Permissions (enforced on the server)

Roles stay as they are today: Admin (legacy `owner`), Accountant (`accounts`), Salesman. Authorization moves from role checks to **permission checks**: `requirePermission('salesman.create')` on every route.

- **Role defaults** live in code.
- **Accountant grants** are configurable by Admin and stored in DB as `rolePermissions` overrides. Only permissions marked *delegable* can be granted. System, security and user-admin permissions are never delegable.
- Every request re-reads `isActive` and `tokenVersion` (cached for 30 s). Deactivating a user or resetting their password revokes their sessions immediately.

| Permission | Admin | Accountant default | Delegable to Accountant | Salesman |
|---|:-:|:-:|:-:|:-:|
| inventory.view / dashboard | ✔ | ✔ | — | ✘ |
| supplier.manage, material.manage, product.manage, bom.manage | ✔ | ✘ | ✔ | ✘ |
| purchase.create / purchase.approve / grn.confirm | ✔ | ✔ / ✘ / ✔ | ✔ (approve) | ✘ |
| production.manage | ✔ | ✘ | ✔ | ✘ |
| inventory.adjust.request / approve / reverse | ✔ | ✔ / ✘ / ✘ | ✔ (approve) | ✘ |
| salesman.view / create / edit / deactivate / resetPassword | ✔ | ✔ / ✔ / ✔ / ✘ / ✘ | ✔ (deactivate, reset) | ✘ |
| customer.manage / assign | ✔ | ✔ | — | own only (create) |
| order.review (approve/reject) / dispatch / deliver / cancel | ✔ | ✘ / ✔ / ✔ / ✘ | ✔ | own: create, cancel while PENDING |
| target.view / manage | ✔ | ✔ / ✘ | ✔ (manage) | own view |
| payment.record / verify / void | ✔ | ✔ / ✔ / ✘ | ✔ (void) | own: record collection (unverified) |
| supplierPayment.record | ✔ | ✔ | — | ✘ |
| reports.financial / export | ✔ | ✔ | — | ✘ |
| activity.view (all) | ✔ | ✔ | — | own only |
| settings.business, settings.security, user.admin (admins/accountants), permissions.manage | ✔ | ✘ | **never** | ✘ |

**Salesman data scoping:** every query adds `salesmanId = me` or `customer.assignedSalesmanId = me`. The salesman serializer removes cost price, average cost, margins, supplier data, raw materials and other salesmen's records. Tests assert that these fields are absent.

---

## 2. Salesman accounts

Salesman management gets one admin page, replacing the three duplicate pages that exist today.

**Fields:**
- full name, phone (login identifier, unique, normalised to digits), optional email (unique)
- address
- employee ID (unique, auto-suggested `SM-0001`)
- joining date
- territory (free text, or a managed list if you prefer)
- assigned customers, assigned product categories/models
- status

**Profile model:** in option A, the user document gets these fields and a separate `salesmanProfiles` collection keyed by userId. In option B, a `SalesmanProfile` table has a 1:1 link to `User`.

**Password handling:**
- On create, Admin/Accountant either types a temporary password (≥ 10 characters, bcrypt) or ticks "generate", which shows the password once.
- The account is flagged `mustChangePassword`, so the salesman has to set their own password at first login.
- **Reset** generates a new temporary password, bumps `tokenVersion` (logging out every device) and is written to the audit log. Plain passwords are never stored or logged.

**Duplicates:** a unique index on normalised phone, email and employeeId. The UI warns on near-duplicate names in the same territory.

**Deactivate:** the user can no longer log in and sessions are revoked. Their orders, customers and targets stay intact. Their customers can be reassigned in bulk.

**Creating the account also creates an initial target** if a value is entered (§4).

---

## 3. Sales order lifecycle

Building on today's statuses (`Pending/Approved/…`), renamed and extended:

```
DRAFT (salesman, device-local) → SUBMITTED → APPROVED → DISPATCHED → DELIVERED → COMPLETED
                                     │           │            │            │
                                     ▼           ▼            │            └─(full return)→ RETURNED
                                 REJECTED   CANCELLED          └─(partial)→ sales return records
```

| Step | Who | Effect |
|---|---|---|
| Submit | Salesman | Prices locked from the variant at submission (salesman cannot edit price). Idempotency key. Reserve stock if the policy is `submission`. |
| Approve / Reject (reason required) | `order.review` | Reserve if the policy is `approval`. Any stock shortage is shown and blocks approval. Reject releases the reservation. |
| Dispatch | `order.dispatch` | `SALES_DISPATCH` ledger rows (consumes the reservation). **Invoice is generated here.** Today invoices can be made before dispatch; that ends. |
| Deliver | `order.deliver` | Delivery date + note |
| Complete | automatic | When DELIVERED **and** invoice balance = 0 |
| Cancel | Admin; Salesman only while SUBMITTED | Releases the reservation. Not allowed after dispatch (use a return). |
| Sales return | `order.review` | `SALES_RETURN` stock in + credit note reduces the receivable |

Every transition writes an `orderStatusHistory` row (actor, from, to, reason, time) and an activity event.

**Discounts:** salesmen cannot change prices. If you want negotiated prices, the salesman *requests* a discount % and it is approved at the Approve step. This is off by default.

**Real-time status:** the salesman app polls `GET /my/orders?since=` every 30 s while open, and on focus. WebSockets are not needed at this scale.

**Payments / collections:**
- The Accountant or Admin records a payment, which is **verified** immediately.
- A salesman can record a collection in the field (amount, mode, reference, photo of receipt optional), which stays **UNVERIFIED** until the Accountant verifies or rejects it.
- Only verified payments reduce invoice and customer balances.
- Voiding requires a reason and is audited.

---

## 4. Targets

### 4.1 Model

`Target`:
- name, salesmanId
- type: `SALES_AMOUNT` | `ORDER_COUNT` | `NEW_CUSTOMERS` | `PRODUCT_QTY` (optional scope: category/model/variant) | `COLLECTION_AMOUNT` | `DELIVERIES`
- period: `DAILY` | `WEEKLY` | `MONTHLY` | `CUSTOM`
- startDate, endDate (inclusive, business timezone Asia/Kolkata)
- targetValue
- description, instructions
- status: `ACTIVE` | `CANCELLED`; `COMPLETED`/`OVERDUE` are **derived**, not stored
- assignedBy, assignedAt, version

**Revisions:** editing the value, dates or scope creates a `TargetRevision` row `{targetId, version, before, after, changedBy, changedAt, reason (required)}`. A target is never silently changed. Cancelled targets remain in the history.

Admin can enable or disable target types for the business in settings.

### 4.2 What counts (single policy, used everywhere)

| Type | Counted records | Date used | Excluded |
|---|---|---|---|
| SALES_AMOUNT | Taxable value (excl. GST) of orders **DISPATCHED or later**, minus credit notes (returns) dated in the period | dispatch date; return date for deductions | DRAFT, SUBMITTED, APPROVED-not-dispatched, REJECTED, CANCELLED |
| ORDER_COUNT | Orders that reached DISPATCHED | dispatch date | same as above; a fully returned order is subtracted in the period of its return |
| NEW_CUSTOMERS | Customers created by or assigned to the salesman whose **first** order was dispatched in the period | first dispatch date | customers with no dispatched order, duplicates merged by phone |
| PRODUCT_QTY | Dispatched quantity of in-scope variants minus returned qty | dispatch / return date | as SALES_AMOUNT |
| COLLECTION_AMOUNT | **Verified**, non-voided payments attributed to the salesman | payment date | unverified, rejected or voided collections |
| DELIVERIES | Orders reaching DELIVERED | delivery date | — |

> Why dispatch and not approval? Approval is a promise. Dispatch is the point where stock leaves and the invoice is issued, so it is verifiable. If you prefer *invoice paid* for sales targets, it is a single setting, but it must be the same for every salesman.

**Attribution:** an order belongs to the salesman who submitted it. Collections belong to the salesman who collected them, or else to the customer's assigned salesman at the time of payment.

### 4.3 Progress calculation

```
achieved   = Σ counted records in [start, end]   (computed on read, never stored)
remaining  = max(0, target − achieved)
percent    = target > 0 ? achieved / target × 100 : (achieved > 0 ? "n/a – no target" : 0)
display    = percent shown uncapped (e.g. 112%); bar capped at 100% with an "exceeded" badge
status     = COMPLETED if achieved ≥ target
             OVERDUE   if today > end and achieved < target
             ACTIVE    otherwise; UPCOMING if today < start
```

- Returns dated after the period ends reduce the period they fall in, not the original period. This avoids rewriting closed history. The detail view shows the return so the change can be traced.
- A target-reached event is written to the activity log once per target. That write is idempotent.
- A cached snapshot (`targetProgress` refreshed on relevant events + nightly) is allowed for fast dashboards, but the detail view always recomputes from source.

### 4.4 Screens

- **Admin/Accountant target dashboard:**
  - Filters: period, salesman, type, status.
  - Table with progress bars (target, achieved, remaining, %, deadline, status).
  - Overdue and completed counts.
  - Achievement trend chart (monthly % per salesman).
  - Revision history drawer.
  - "Add target" modal with a bulk option (same target for several salesmen).
- **Salesman** cards for "My daily / weekly / monthly target". Each card shows target, achieved, remaining, %, deadline and status, with a large progress ring. Tapping a card lists the orders/payments that counted.

---

## 5. Activity monitoring

**Activity event** (append-only): actorId, actorRole, salesmanId (subject), type, description, customerId?, orderId?, amount?, status snapshot, createdAt, source (`api`).

Events are written in the **same transaction** as the business action, so an event exists only if the action happened.

**Types:**
- `LOGIN`
- `CUSTOMER_CREATED`, `CUSTOMER_ASSIGNED`
- `INTERACTION_RECORDED` (manual note: visit/call/enquiry, entered by the salesman)
- `ORDER_SUBMITTED`, `ORDER_MODIFIED`, `ORDER_APPROVED`, `ORDER_REJECTED`, `ORDER_CANCELLED`, `ORDER_DISPATCHED`, `ORDER_DELIVERED`, `ORDER_COMPLETED`
- `COLLECTION_RECORDED`, `COLLECTION_VERIFIED`, `COLLECTION_REJECTED`
- `TARGET_ASSIGNED`, `TARGET_REVISED`, `TARGET_ACHIEVED`

**Privacy boundary:**
- Not collected: GPS tracking, background location, device or app usage, contacts, call logs, screen time.
- Login events store only time and a coarse user-agent string (no IP shown to Admin).

**Admin activity dashboard:**
- Filters: today / yesterday / this week / this month / custom; salesman; territory; customer; order status.
- **Cards:** total/active/inactive salesmen, orders, sales value (per §4.2 rule), collections (verified), pending collections (unverified + outstanding), completed and pending orders.
- **Tables:** salesman-wise performance, customer-wise, product-wise.
- Timeline per salesman with infinite scroll.

**Individual performance page:**
- assigned/completed targets, achievement %
- total sales, orders, **average order value = sales ÷ dispatched order count** (both from the same rule)
- collections and pending
- new customers, completed deliveries
- recent activity
- 12-month history chart

Every metric links to the underlying records. Comparisons between salesmen use the same formulas and period.

The salesman sees their own timeline and their own performance page only.

---

## 6. Mapping to each codebase

| Concept | Option A (Mongo legacy) | Option B (Postgres rebuild) |
|---|---|---|
| Users/roles | reuse `users` (+phone field fix, isActive, tokenVersion, mustChangePassword) | reuse `User` (has isActive, tokenVersion) + mustChangePassword |
| Salesman profile | **new** `salesmanProfiles` | **new** `SalesmanProfile` |
| Permissions | **new** `rolePermissions`; replace `allow()` / `roleIs()` | extend shared `permissions` with a DB override table |
| Customers | reuse `customers` (+assignedSalesmanId, address, GSTIN; drop `min:0` on balance) | reuse `Dealer` (has salespersonId) |
| Orders | reuse `orders` (+number, salesmanId explicit, timestamps per stage, history) | reuse `SalesOrder` + `OrderStatusHistory`; add COMPLETED |
| Payments | replace `ErpPayment` with `payments` (+status VERIFIED/UNVERIFIED/VOID, invoice allocation) | reuse `Receipt` (+UNVERIFIED status, collectedById exists) |
| Targets | **new** `targets`, `targetRevisions` | replace `SalesTarget` (monthly amount) with `Target` + `TargetRevision`; migrate rows as MONTHLY SALES_AMOUNT |
| Activity | **new** `activityEvents` (keep `audit` for system audit) | **new** `ActivityEvent` (keep `AuditLog`) |
| Assignment of catalogue | reuse `ErpAssignment`, now enforced on the catalogue query | **new** `SalesmanCatalogueScope` |
