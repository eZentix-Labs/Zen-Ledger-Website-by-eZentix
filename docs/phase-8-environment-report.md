# Phase 8 — Safe Local Integration Testing Environment Report

Date: 2026-10-29
Project: `D:\Business-Management-System`

## Safety outcome

Inspection and verification stayed inside `D:\Business-Management-System`. No application business logic was changed. No Docker container was started, no Windows service was changed, no database was connected to, no data was deleted or reset, and no importer or migration was run. Existing listeners and processes were not stopped.

## Discovered environment

| Component | Result |
|---|---|
| Node.js | `v22.22.1` |
| npm | `10.9.4` |
| Docker client | `28.4.0` available |
| Docker daemon | Not usable; connection to `docker_engine` failed and Docker config access was denied |
| mongosh | `2.13.0` available |
| mongod executable | Not found on PATH |
| Windows MongoDB service | A service named `MongoDB` is running and set to Automatic |
| Local Mongo listener | `127.0.0.1:27017` is occupied by PID 5408 |
| Browser packages | Playwright, Puppeteer, `@playwright/test`, Cypress, and Selenium WebDriver are not installed |
| Browser executables | Chrome, Edge, and Firefox were not exposed through the command environment |
| Existing app listeners | Ports 4000, 4001, and 5173 are occupied; they were not stopped or reused for database testing |

The running MongoDB service and its database ownership/purpose could not be established safely. Service/process metadata queries requiring elevated WMI access were denied. The existing outbound MongoDB connections observed on the machine further reinforce that port 27017 must be treated as unknown and off-limits.

## MongoDB test environment decision

No safe disposable replica set is currently available.

Docker is installed, but the daemon is not running or accessible. A local MongoDB service exists, but it is not confirmed as disposable or owned by this project. Therefore no connection attempt was made and no test database was selected.

Required approval/blocker before MongoDB testing:

1. Provide or approve a disposable MongoDB replica-set environment that is clearly isolated from the running `MongoDB` service.
2. Use a dedicated test-only port such as `27018` and a dedicated data directory such as `D:\Business-Management-System\.test\mongo-rs0`.
3. Use an unmistakable database name such as `bms_phase8_test_only`.
4. Verify the selected port is free and the data directory is newly created for this test only. Do not reuse or delete an existing MongoDB directory.
5. Configure a test-only URI such as `mongodb://127.0.0.1:27018/bms_phase8_test_only?replicaSet=bms_phase8_rs&directConnection=true` only after the isolated `mongod` is explicitly identified.

The required software is missing from PATH, so it was not installed automatically. If Docker is approved and its daemon is made available, an isolated container-based setup can be prepared using a dedicated volume and test port. If a local MongoDB binary is approved, the replica set can be initialized with a new data directory and `--replSet bms_phase8_rs`. Those actions were not executed because they would start software and create persistent local state.

Do not use the running service on port 27017, the existing application `.env`, or any unknown connection string for this phase.

## Browser testing decision

Browser E2E cannot run from the current checkout. No browser automation dependency or usable browser executable is available. The CUA browser session previously failed during initialization before a browser could be selected.

No dependency was installed. The smallest approved option is Playwright, added as a development dependency, plus a locally installed Chromium browser if the package does not provide an accessible executable. A future setup should use a separate test command and isolated local API/frontend ports, for example API `4002` and Vite `5174`, with `PERSISTENCE=json` pointing to a dedicated test data file or the isolated Mongo test URI. The browser suite must never inherit production environment variables.

The browser suite should cover the Phase 7 workflows: role login/logout, salesperson catalog/search/cart/customer/order flow, admin/accounts approval/rejection, stock/status display, unauthorized navigation/API responses, loading/error states, desktop viewport, and mobile viewport. None of these browser workflows is claimed as passed here.

## Configuration and commands for a future approved run

Safe checks already run from the project root:

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

Actual results:

```text
npm.cmd run typecheck -> passed
npm.cmd test         -> passed, 2 files / 16 tests
npm.cmd run build    -> passed; API TypeScript emitted and Vite produced dist/web
```

The commands emitted the existing non-fatal Vite config-loader warning. No warning was used to bypass a failure.

After approval and isolated infrastructure setup, verify before starting the app:

```powershell
Test-NetConnection 127.0.0.1 -Port 27018
Get-ChildItem D:\Business-Management-System\.test\mongo-rs0
```

Then use a separately scoped test environment, never the project `.env` used for ordinary local development:

```text
NODE_ENV=test
PORT=4002
APP_ORIGIN=http://localhost:5174
JWT_SECRET=<unique test-only secret of at least 32 characters>
PERSISTENCE=mongo
MONGODB_URI=mongodb://127.0.0.1:27018/bms_phase8_test_only?replicaSet=bms_phase8_rs&directConnection=true
```

The URI and secret must be supplied only through the approved isolated test process environment and must not be committed or printed.

## Current verification classification

- TypeScript and existing isolated API tests: implemented and passing.
- Production build: passing.
- MongoDB replica-set persistence: blocked; no safe isolated topology.
- Browser E2E: blocked; automation/browser tooling absent.
- Production readiness: not established.

## Confirmation

No production database, existing user data, unrelated project, Windows service, Docker daemon, or running application process was modified. No software or dependency was installed.

## Safest next step

Approve one isolated testing route: either provide a disposable MongoDB replica set on a dedicated port or explicitly approve installation/activation of a test-only MongoDB/Docker setup; separately approve adding Playwright and a browser runtime if browser E2E is required. Until then, retain the current passing isolated tests and do not use real business data.
