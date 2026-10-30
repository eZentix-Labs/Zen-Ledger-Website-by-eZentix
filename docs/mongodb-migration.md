# MongoDB migration and import

The application defaults to `PERSISTENCE=mongo`. Use a dedicated local MongoDB database, not production, for verification.

```powershell
Copy-Item .env.example .env
# Edit .env: set JWT_SECRET, PERSISTENCE=mongo, and a local MONGODB_URI
npm install
npm run import:json
```

The importer reads `DATA_FILE` or `JSON_SOURCE`, validates required arrays, relationships/quantities, and product stock invariants, creates MongoDB indexes, and inserts the records in a transaction. It requires `IMPORT_CONFIRM=EMPTY_LOCAL_DB_ONLY`, refuses database names that do not contain `dev` or `test`, and refuses non-empty targets. It never edits or deletes the source JSON file and cannot silently duplicate records on a rerun.

MongoDB standalone deployments do not support multi-document transactions. Use a local replica set for transaction verification. The API uses a MongoDB lease lock plus transaction for mutation serialization; lease expiry is a recovery mechanism, not a substitute for an atomic conditional stock update in a high-scale deployment.
