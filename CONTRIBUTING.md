# Contributing to UAS Accounting System

## Coding Standards
- **TypeScript**: Strict mode (`strict`, `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns` in `tsconfig.json`).
- **Domain Formulas**: Keep all accounting calculations inside `src/lib/formulas.ts` so server routes, seeds, client optimistic offline updates, and tests share a single source of truth.
- **Atomic Ledger Mutations**: Every database mutation under `src/app/api/**` must execute inside `prisma.$transaction()`, enforce `isHarvestLockedTx`, and append an `ImmutableAuditLog` record.
- **Documentation**: Preserve existing comments and docstrings unless updating changed behavior.

## Pre-Commit Verification Checklist

Run the following before opening a pull request:

```bash
npx prisma validate
npx eslint . --max-warnings=0
npm run typecheck
npm test
npm run build
```

