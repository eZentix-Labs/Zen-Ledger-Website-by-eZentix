# Demo Setup Guide

## Run the admin panel on dummy data

One command gives every admin page a full year of dummy business data:

```powershell
cd backend
npm run demo
```

In a second terminal:

```powershell
cd frontend
npm run dev
```

Sign in at the address Vite prints:

| Role | Login | Password |
| --- | --- | --- |
| Owner | `owner@example.com` | `ChangeMe123!` |
| Accounts | `accounts@example.com` | `AccountsTest123!` |
| Salesman | phone `9000010001` to `9000010005` | `Demo@12345` |

The first run takes a few minutes while it builds the data. Later runs start straight away and keep anything you changed.

To throw the data away and rebuild it with dates up to today:

```powershell
npm run demo -- --reset
```

Press Ctrl+C to stop.

Stop `npm run dev` in `backend` first, because both use port 4000. If it is still running, `npm run demo` stops with a message saying so. Your browser may still be signed in to your normal data, so sign out and use a login above.

### What it does and does not touch

- It starts its own MongoDB on port 27028, with files in `backend/data/mongo-demo` (git-ignored).
- It does not load `backend/.env`, so it cannot reach your normal or production database.
- It only works locally. The deployed website keeps showing real data.

### How the data is made

`backend/scripts/demo.ts` replays twelve months of orders, payments, purchases, production and stock control through the real API, in date order, then moves each record back to its simulated date. All figures therefore follow the same rules as live use, and all buttons work. To change the dummy names, products or prices, edit the lists at the top of that file and run with `--reset`.

## Local services (real data)

Backend:

```powershell
cd backend
npm run dev
```

Frontend:

```powershell
cd frontend
npm run dev
```

The previously verified local ports were backend `10000` and frontend `5173`. Keep the frontend API URL pointed to the local backend during local demonstrations.

## Manual demo data sequence

1. Create or verify an Admin account.
2. Create one category.
3. Create one active product with SKU and price.
4. Create one active salesman account.
5. Assign the category/product to the salesman through the ERP assignment API/UI.
6. Create a customer.
7. Submit an order.
8. Update order status as Admin.
9. Verify the Salesman sees only their own order and new status.

Do not use production credentials or production database data for local demonstrations.
