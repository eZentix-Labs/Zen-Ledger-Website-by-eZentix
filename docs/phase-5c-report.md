# Phase 5C — Authentication and Seed Credential Hardening

Audit/implementation date: 2026-10-28

## Scope and safety

Work was limited to `D:\Business-Management-System`. No MongoDB connection, migration, importer, production database, deployment, commit, or external project access was performed. No real credentials or business data were used.

## Changes made

- `apps/api/src/config.ts`
  - Production now requires `PERSISTENCE=mongo`.
  - Production rejects placeholder/demo/development JWT secrets.
  - Missing or invalid configuration throws a clear startup error without printing secret values.

- `apps/api/src/repository.ts`
  - `makeSeed()` refuses to create the known demo owner in production.
  - Development/test seed behavior remains available for local use.

- `apps/api/src/server.ts`
  - Exported the existing Express app and a test-state installer without changing route contracts.
  - Added an `API_AUTOSTART=false` test guard so tests do not start a server or connect to a database.

- `apps/web/src/main.tsx`
  - Demo email/password fields and demo-account text are now development-only.
  - Production builds start with blank credentials and do not include the demo credential strings.

- `apps/api/src/auth-api.test.ts`
  - Added isolated HTTP authorization tests using an in-memory repository and an ephemeral localhost server.
  - The test repository never connects to MongoDB and does not use the JSON datastore.

## Automated authorization coverage

The new tests cover:

- Missing authentication.
- Malformed JWTs.
- Expired JWTs.
- Owner dashboard access.
- Accounts dashboard access.
- Salesman denial of financial dashboard access.
- Salesman access limited to orders created by that salesman.
- Salesman denial of invoices, settings, audit, inventory movement, customer directory, and approval endpoints.
- Owner-only settings mutation.
- Salesman product catalog access.

## Verification executed

From `D:\Business-Management-System`:

```text
npm run typecheck  -> passed
npm test           -> passed, 2 files / 10 tests
npm run build      -> passed
```

The test/build commands emitted the existing Vite/Vitest config-loader warning about ESM syntax in TypeScript config files. It did not fail the checks.

Additional safe checks:

- Production bundle search found no `ChangeMe123` or `owner@example.com` strings.
- `.env` was absent from the project directory.
- No MongoDB connection or import was attempted.

## Remaining risks

- Production startup behavior was source-checked but not executed with a production environment because doing so without a real configured MongoDB target would be misleading.
- The default development/test seed credentials still exist for local development; they are blocked from production seeding and hidden from production frontend builds.
- The existing MongoDB snapshot-replacement design, incomplete financial workflows, salesman mobile workflow, and missing broader integration tests remain as documented in `docs/phase-5b-audit.md`.
- Password rotation and first-run owner provisioning are not yet implemented. Production must use a controlled owner-provisioning process rather than an empty database seed.

## Conclusion

Known demo credentials can no longer be silently enabled by production startup, and the production frontend does not expose them. Authentication and role boundaries now have automated isolated HTTP coverage. The system is still not production-ready because the remaining Phase 5B persistence and business-workflow risks are unresolved.
