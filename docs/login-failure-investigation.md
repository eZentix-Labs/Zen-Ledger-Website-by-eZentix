# Login Failure Investigation — Post Phase 5C

Investigation date: 2026-10-28

## Confirmed root cause

The frontend helper in `apps/web/src/main.tsx` called `response.json()` unconditionally. When the API was unavailable or a proxy returned an empty/non-JSON response, that call threw `Unexpected end of JSON input` before the application could show a useful error.

The current workspace has no `.env` file. The API configuration in `apps/api/src/config.ts` requires `JWT_SECRET`, and `PERSISTENCE` defaults to `mongo`, which also requires `MONGODB_URI`. A safe local startup attempt failed before the server listened:

```text
Error: Invalid environment configuration: Invalid input: expected string, received undefined
```

The Vite proxy in `apps/web/vite.config.ts` targets `http://localhost:4000`. With the API not running, the frontend login request cannot receive the expected JSON authentication response. This is a local configuration/startup problem, not evidence that a password or database record is incorrect.

Phase 5C security behavior was not the defect: production seed credentials remain blocked, and the production bundle does not contain the demo credential strings.

## Minimal fix

- Added `apps/web/src/api.ts` with safe response parsing.
  - Valid JSON backend errors preserve their safe `error` message.
  - Empty responses produce a controlled error.
  - HTML/malformed responses produce a generic safe transport error.
  - No response body, token, password, stack trace, or credential is exposed.
- Updated `apps/web/src/main.tsx` to use the safe parser while preserving existing routes and request contracts.
- Added `apps/web/src/api-response.test.ts` for success, JSON error, empty response, and non-JSON response cases.

## Correct local setup

Do not bypass the Phase 5C startup guard. For isolated local development:

1. Copy `.env.example` to `.env`.
2. Set a locally generated `JWT_SECRET` with at least 32 characters.
3. Choose `PERSISTENCE=json` for a local-only datastore, or configure a disposable local MongoDB replica set with `PERSISTENCE=mongo` and `MONGODB_URI`.
4. Run `npm run dev`.

No `.env` was created during this investigation, and no database was connected.

## Verification

Executed successfully:

```text
npm run typecheck  -> passed
npm test           -> passed, 2 files / 10 tests
npm run build      -> passed
```

The test suite includes the existing authorization tests and the new response-handling regression tests. Tests run with `API_AUTOSTART=false` and an in-memory repository; they do not start the real API or connect to MongoDB.

Additional checks:

- The current API startup failure was observed safely with no database configured.
- The production frontend bundle contains neither demo credential string.
- No production database, import, migration, commit, or deployment was used.

## Browser login status

An actual browser login against a running local API was not verified because the project has no `.env` configuration and no local database configuration was supplied. The backend’s safe startup failure and the isolated HTTP/auth tests were verified instead.

## Remaining setup requirement

The local operator must provide a valid development `.env` and choose JSON or an isolated local MongoDB replica set. Production still requires MongoDB, a non-placeholder JWT secret, and a controlled owner-provisioning process; Phase 5C security protections must not be bypassed.
