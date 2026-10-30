# Testing guide

The pure stock invariant tests live in `apps/api/src/stock.test.ts` and cover reservation, available stock, overselling, release, sale finalization, and dispatch policy.

Run:

```powershell
npm run typecheck
npm test
npm run build
```

These commands were not executable in the implementation environment because npm registry access was blocked and `node_modules` was unavailable. No test or build success is claimed until they run in an environment with dependencies installed.
