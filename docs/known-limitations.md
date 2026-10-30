# Known limitations and unresolved decisions

- MongoDB/Mongoose adapter is implemented but not verified in this environment because dependencies and a MongoDB topology were unavailable. Transactions require a replica set.
- JSON fallback remains intentionally available for local development; it is not suitable for concurrent production traffic.
- Mongo mutation serialization uses a MongoDB lease lock plus transaction around the current snapshot repository. It protects concurrent application writers, but high-scale deployments should move stock mutations to atomic conditional updates and append-only ledger writes.
- Salesman customer visibility is intentionally restricted until customer-to-salesman assignment rules are implemented; salesmen can create customers but cannot list the full customer directory.
- Payments, split payments, expense entries, daily closing, returns, reporting exports, print layouts and user management are not complete.
- The JSON datastore is for local development only.
- Tax/GST rates, invoice legal text, business identity, printer width, payment methods and production stock timing require confirmation.
- Automated test coverage is not yet complete because dependency installation was blocked in this environment.
