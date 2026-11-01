# Demo Setup Guide

## Local services

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

## Demo data sequence

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
