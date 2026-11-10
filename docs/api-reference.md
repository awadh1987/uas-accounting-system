# API Reference

All API endpoints live under `src/app/api/` and execute mutations inside `prisma.$transaction()` with server-side formula calculation, period-lock checks (`423 HARVEST_LOCKED`), and `ImmutableAuditLog` entries.

## Endpoints

| Method & Path | Description | Key Behavior |
| :--- | :--- | :--- |
| `GET /api/bootstrap` | Fetch complete application state | Returns settings, exchange rates, treasury, installments, inventory, period locks, audit logs, users (excluding `passwordHash`), projects, expenses, workers, and sales |
| `POST /api/projects` | Create main or sub-project | Generates planned `HarvestCycle` records and logs audit event |
| `POST /api/projects/harvests` | Add harvest/spray cycle to project | Appends `HarvestCycle` and increments `plannedHarvestCount` |
| `POST /api/expenses` | Record operating expense | Computes `totalAmount = qty * unitPrice`; rejects with `423` if harvest is locked |
| `DELETE /api/expenses/[id]` | Delete operating expense | Rejects with `423` if harvest is locked |
| `POST /api/workers` | Record worker wage entry | Upserts `Worker`, computes `totalWage` and `debitBalance`; rejects with `423` if locked |
| `DELETE /api/workers/[id]` | Delete worker wage entry | Rejects with `423` if harvest is locked |
| `POST /api/sales` | Record sale transaction | Upserts `Customer`, computes `totalAmount` and `debitReceivable`; rejects with `423` if locked |
| `DELETE /api/sales/[id]` | Delete sale transaction | Rejects with `423` if harvest is locked |
| `POST /api/installments` | Issue customer receipt or worker payout | Atomically updates `SaleTransaction` / `WorkerWageEntry` and `TreasuryAccount.balanceYER`, generates unique `voucherNo` and QR hash |
| `POST /api/inventory` | Add harvest inventory batch | Rejects with `423` if harvest is locked |
| `POST /api/audit/lock` | Toggle harvest period lock | Toggles `HarvestCycle.isLocked`, `lockedAt`, and `lockedByUserId` |
| `POST /api/audit/adjustments` | Post approved adjustment entry | Creates `AdjustmentEntry` and records audit event |
| `POST /api/audit/log` | Record audit log event | Used for WhatsApp dispatch and offline cloud sync logging |
| `PATCH /api/system/settings` | Update org branding/lang/theme | Upserts `SystemSettings` singleton |
| `POST /api/users` | Create user account | Hashes password (`SHA-256`) and assigns role |
| `PATCH /api/users/[id]` | Toggle active status or update profile | Supports password reset and avatar/name updates |
| `POST /api/auth/login` | Verify user sign-in | Validates active status and password hash; logs sign-in |

