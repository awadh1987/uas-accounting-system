# Database Schema & Accounting Formulas

## Relational Models (`prisma/schema.prisma`)

| Model | Purpose | Key Relations |
| :--- | :--- | :--- |
| `SystemSettings` | Organization name, logo text, default language, theme, and currency | Singleton (`id = "default"`) |
| `User` | System users with role, active status, and SHA-256 password hash | Standalone RBAC directory |
| `Project` | Agricultural projects (`مشروع رئيسي` / `مشروع فرعي`) with parent self-relation | Has many `HarvestCycle`, `OperatingExpense`, `WorkerWageEntry`, `SaleTransaction`, `HarvestInventoryBatch`, `AdjustmentEntry` |
| `HarvestCycle` | Harvest/spray cycles (`القطفة الأولى`, etc.) with `isLocked` audit lock | Belongs to `Project`; unique `(projectId, name)` |
| `TreasuryAccount` | Cash box, banks (Kuraimi), and mobile wallets (Jawali, Jeeb) | Has many `InstallmentVoucher` |
| `CurrencyRate` | Exchange rates relative to `YER` (`YER=1`, `SAR=425`, `USD=1620`) | Keyed by `currencyCode` |
| `OperatingExpense` | Fuel, meals, groceries, transport, and other expenses | Linked to `Project`, `HarvestCycle` |
| `Worker` | Worker master record | Has many `WorkerWageEntry` |
| `WorkerWageEntry` | Daily wage ledger per project/harvest | Linked to `Worker`, `Project`, `HarvestCycle`, `InstallmentVoucher` |
| `Customer` | Customer directory | Has many `SaleTransaction` |
| `SaleTransaction` | Sales invoices by batch, grade, and bundle count | Linked to `Customer`, `Project`, `HarvestCycle`, `InstallmentVoucher` |
| `InstallmentVoucher` | Decoupled receipt (`CUSTOMER_RECEIPT`) & payout (`WORKER_PAYOUT`) vouchers with QR hash | Linked to `TreasuryAccount` and `SaleTransaction` or `WorkerWageEntry` |
| `HarvestInventoryBatch` | Harvested bundles and shrinkage per project/harvest/grade | Linked to `Project`, `HarvestCycle` |
| `ImmutableAuditLog` | Append-only audit trail with timestamp, user, action, and verification hash | Standalone append-only log |
| `AdjustmentEntry` | Approved adjustment entries for locked harvest cycles | Linked to `Project`, `HarvestCycle` |

---

## Core Accounting Formulas (`src/lib/formulas.ts`)

Grounded directly in `UAS.xlsx`:

- **Operating Expense Total**: `totalAmount = quantity * unitPrice`
- **Worker Wage Total (`=F*G`)**: `totalWage = dailyWage * daysWorked`
- **Worker Payable Balance (`=H-I`)**: `debitBalance = totalWage - creditAmount`
- **Sale Total (`=P*Q`)**: `totalAmount = bundlesCount * unitPrice`
- **Customer Receivable Balance (`=R-S`)**: `debitReceivable = totalAmount - creditPaid`
- **Net Operating Profit**: `netProfit = totalSales - (totalOperatingExpenses + totalWorkerWages)`
- **Remaining Inventory**: `remaining = harvestedBundles - soldBundles - shrinkageBundles`

---

## Switching from Local SQLite to Supabase PostgreSQL

1. Run the provider switcher (or manually update `provider` in `prisma/schema.prisma`):
   ```bash
   npm run db:postgres
   ```
   *(To switch back to local SQLite for offline development, run `npm run db:sqlite`.)*
2. Set `DATABASE_URL` in `.env` using your Supabase PostgreSQL connection string (`postgresql://...`).
3. Run `npx prisma db push && npx tsx prisma/seed.ts`.
4. Run [rls-policies.sql](../infra/supabase/rls-policies.sql) in the Supabase SQL Editor to enable RLS across all 15 tables, restrict `User.passwordHash`, protect locked harvest cycles, and lock `ImmutableAuditLog` via both `REVOKE` and a database trigger.

