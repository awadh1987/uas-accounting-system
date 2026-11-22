# 12 — Evidence and Source References

Complete catalog of verified source files, symbols, API endpoints, database models, UI screens, and test files examined during this independent read-only audit.

---

## 1. Core Documentation, Schema & Configuration

- Audit Charter: [Comprehensive Accounting System Audit.md](file:///e:/2026/uas-accounting-system/docs/Comprehensive%20Accounting%20System%20Audit.md)
- Architecture Notes: [UAS-ARCHITECTURE-AND-IMPROVEMENTS.md](file:///e:/2026/uas-accounting-system/docs/UAS-ARCHITECTURE-AND-IMPROVEMENTS.md)
- Dependencies & Scripts: [package.json](file:///e:/2026/uas-accounting-system/package.json), [tsconfig.json](file:///e:/2026/uas-accounting-system/tsconfig.json)
- Request Proxy / Subdomain Header Injection: [proxy.ts](file:///e:/2026/uas-accounting-system/src/proxy.ts)
- Database Schema (**55 Models**): [schema.prisma](file:///e:/2026/uas-accounting-system/prisma/schema.prisma)
- Database Migration (**55 Tables**, SQLite DDL): [migration.sql](file:///e:/2026/uas-accounting-system/prisma/migrations/20261117000000_init/migration.sql), [sqliteInitSql.ts](file:///e:/2026/uas-accounting-system/src/lib/sqliteInitSql.ts)
- Database Seed & Baseline Init: [seed.ts](file:///e:/2026/uas-accounting-system/prisma/seed.ts), [sqliteBootstrap.ts](file:///e:/2026/uas-accounting-system/src/lib/sqliteBootstrap.ts), [serverBootstrap.ts](file:///e:/2026/uas-accounting-system/src/lib/serverBootstrap.ts)
- Shared Types: [uas.ts](file:///e:/2026/uas-accounting-system/src/types/uas.ts)

---

## 2. Core Accounting, Sub-Ledger, FX, Closing & ERP Libraries

| File | Key Symbols Audited | Primary Audit Relevance |
|---|---|---|
| [ledgerService.ts](file:///e:/2026/uas-accounting-system/src/lib/accounting/ledgerService.ts) | `nextSequenceCode` (L198), `postJournalEntry` (L481), `reverseJournalEntry` (L675), `postVendorBill` (L739), `postVendorPayment` (L858), `postSalesInvoice` (L1011), `postCustomerReceipt` (L1118), `postOperatingExpenseJournalTx` (L1238), `postWorkerWageJournalTx` (L1314), `createHierarchicalAccount` (L1685), `getCoaTreeWithBalances` (L1824), `buildPostedLineWhere` (L1849), `generateFinancialReports` (L1879), `updateJournalEntry` (L2780), `updateOperatingExpenseAtomic` (L2933), `updateWorkerWageAtomic` (L3070) | Core GL posting/reversal double-inversion bug, mutable posted JEs, BS date filter, closed FY zeroing, Treasury drift on expenses/wages, hardcoded COA & race-prone sequencing. |
| [coaCatalog.ts](file:///e:/2026/uas-accounting-system/src/lib/accounting/coaCatalog.ts) | `STANDARD_COA_NODES`, `mapExpenseCategoryToCoaCode`, `mapProjectIdToSalesRevenueCode` | Authoritative 6-Gen COA seed (`212101` Labor Payables, `114101` Vendor Advances). |
| [accountingCoreEngine.ts](file:///e:/2026/uas-accounting-system/src/lib/accountingCoreEngine.ts) | `ensure6GenerationCoaHierarchy`, `provisionEntityGen6AccountAndCostCenter`, `assertPostableAccount`, `costCenterProfitAndLoss` (L461) | Gen-6 sub-ledger provisioning & Cost Center P&L (`YEAR_END_CLOSING` inclusion defect). |
| [accountingSettings.ts](file:///e:/2026/uas-accounting-system/src/lib/accountingSettings.ts) | `ControlAccountsMap`, `DEFAULT_CONTROL_ACCOUNTS` (L47), `DEFAULT_DOCUMENT_SEQUENCES` (L66), `assertNotInLockedPeriod` (L161), `generateNextDocumentNumber` (L182) | Unwired control accounts & sequence maps; colliding `taxPayableAccount`/`taxReceivableAccount`; `periodLockDate` helper omitted in `ledgerService`. |
| [formulas.ts](file:///e:/2026/uas-accounting-system/src/lib/formulas.ts) | `computeOperatingExpenseTotal`, `computeWorkerWageTotals`, `computeSaleTotals`, `computeRemainingStock`, `computeQrVerificationCode` | Pure JS binary float math & FNV-1a QR hash. |
| [multiCurrencyEngine.ts](file:///e:/2026/uas-accounting-system/src/lib/multiCurrencyEngine.ts) | `DEFAULT_CURRENCIES`, `balanceDualCurrencyLines` (L102), `computeRealizedFxGainLoss` (L215), `computeUnrealizedFxRevaluation` (L266) | Valid FX calculators, **unwired** for realized FX & journal line rounding. |
| [fiscalYearClosingEngine.ts](file:///e:/2026/uas-accounting-system/src/lib/fiscalYearClosingEngine.ts) | `assertDateNotInClosedFiscalYear` (L225), `runFiscalYearPrecheck` (L256), `executeFiscalYearCloseAndRollover` (L494) | P&L close (`YEAR_END_CLOSING`) & Gen-6/FX rollover (`OPENING`); `entryType` filter mismatch vs `ledgerService` reports. |
| [multiUnitInventoryEngine.ts](file:///e:/2026/uas-accounting-system/src/lib/multiUnitInventoryEngine.ts) | `computeWeightedAverageCost` (L64), `checkNegativeStockPolicy` | WAC & negative stock rules; FIFO unimplemented; no GL posting. |
| [bankWalletGateway.ts](file:///e:/2026/uas-accounting-system/src/lib/treasury/bankWalletGateway.ts) | `executeBankOrWalletPayout` (L132), `processInboundCollectionWebhook` (L471), `exportBulkBankTransferFile`, `autoReconcileStatementRows` | Direct `journalEntry.create` bypass, arbitrary `findFirst` beneficiary COA, unverified webhook signature & missing webhook GL entry. |
| [approvalEngine.ts](file:///e:/2026/uas-accounting-system/src/lib/approvalEngine.ts) | `createApprovalRule`, `findMatchingApprovalRule`, `submitApprovalRequest`, `decideApprovalRequest` | State machine & self-approval protection bypassed by core REST APIs. |
| [workspaceDraftsEngine.ts](file:///e:/2026/uas-accounting-system/src/lib/workspaceDraftsEngine.ts) | `createWorkspaceDraft`, `promoteWorkspaceDraft` (L254) | Only applies `PENDING_APPROVAL` to `JOURNAL_VOUCHER` without creating `ApprovalRequest`. |

---

## 3. Security, Multi-Tenancy, Sync, Offline, AI, Export & Governance Libraries

- Multi-Tenancy & Prisma Routing: [prisma.ts](file:///e:/2026/uas-accounting-system/src/lib/prisma.ts), [tenantContext.ts](file:///e:/2026/uas-accounting-system/src/lib/tenant/tenantContext.ts), [tenantRegistry.ts](file:///e:/2026/uas-accounting-system/src/lib/tenant/tenantRegistry.ts), [tenantDbManager.ts](file:///e:/2026/uas-accounting-system/src/lib/tenant/tenantDbManager.ts)
- RBAC & API Auth Helpers: [permissions.ts](file:///e:/2026/uas-accounting-system/src/lib/permissions.ts), [apiHelpers.ts](file:///e:/2026/uas-accounting-system/src/lib/apiHelpers.ts), [guard.ts](file:///e:/2026/uas-accounting-system/src/lib/licensing/guard.ts)
- Idempotency & Entity Lifecycle: [idempotencyGuard.ts](file:///e:/2026/uas-accounting-system/src/lib/idempotencyGuard.ts), [masterLifecycle.ts](file:///e:/2026/uas-accounting-system/src/lib/masterLifecycle.ts), [userLifecycle.ts](file:///e:/2026/uas-accounting-system/src/lib/userLifecycle.ts)
- Scoped Reset & Backup/Restore: [scopedResetEngine.ts](file:///e:/2026/uas-accounting-system/src/lib/scopedResetEngine.ts), [backupService.ts](file:///e:/2026/uas-accounting-system/src/lib/backupService.ts)
- Client API, Offline Sync & Android Local Adapter: [apiClient.ts](file:///e:/2026/uas-accounting-system/src/lib/apiClient.ts), [offlineDb.ts](file:///e:/2026/uas-accounting-system/src/lib/offlineDb.ts), [offlineAndroidStore.ts](file:///e:/2026/uas-accounting-system/src/lib/offlineAndroidStore.ts), [syncEngine.ts](file:///e:/2026/uas-accounting-system/src/lib/sync/syncEngine.ts)
- AI Copilot & Extraction: [agentServerExecutor.ts](file:///e:/2026/uas-accounting-system/src/lib/ai/agentServerExecutor.ts), [documentExtractionEngine.ts](file:///e:/2026/uas-accounting-system/src/lib/ai/documentExtractionEngine.ts), [uasAgentTools.ts](file:///e:/2026/uas-accounting-system/src/lib/ai/uasAgentTools.ts), [offlineAgentEngine.ts](file:///e:/2026/uas-accounting-system/src/lib/ai/offlineAgentEngine.ts)
- Export & Print Engines: [excelExport.ts](file:///e:/2026/uas-accounting-system/src/lib/excelExport.ts), [uasDocumentPrinter.ts](file:///e:/2026/uas-accounting-system/src/lib/print/uasDocumentPrinter.ts)

---

## 4. Audited API Endpoints (**90** Routes Under `src/app/api/`)

- **Accounting (13 routes — 0 with `withTenantRoute`)**:
  `coa`, `cost-centers`, `currencies`, `exchange-rates`, `fx-revaluation`, `fiscal-years`, `fiscal-years/[id]/precheck`, `fiscal-years/[id]/close-and-rollover`, `journal`, `reports/trial-balance`, `reports/income-statement`, `reports/balance-sheet`, `reports/cost-centers`
- **Procurement & AP (4 routes — 0 with `withTenantRoute`)**:
  `vendors`, `pos`, `bills`, `payments`
- **Sales, AR & Installments (6 routes — 0 with `withTenantRoute`)**:
  `sales`, `sales/[id]`, `sales/customers`, `sales/invoices`, `sales/receipts`, `installments`
- **Expenses & Workers (4 routes — 0 with `withTenantRoute`)**:
  `expenses`, `expenses/[id]`, `workers`, `workers/[id]`
- **Inventory & Projects (10 routes — 0 with `withTenantRoute`)**:
  `inventory`, `inventory/uom`, `inventory/categories`, `inventory/warehouses`, `inventory/items`, `inventory/movements`, `projects`, `projects/sub-projects`, `projects/acquisitions`, `projects/harvests`
- **Treasury & Bank Gateway (7 routes — 0 with `withTenantRoute`)**:
  `treasury`, `treasury/transfer`, `treasury/reconcile`, `treasury/reconcile-import`, `treasury/dispatch`, `treasury/batch-export`, `treasury/webhook/[provider]`
- **Audit, Approvals & Drafts (9 routes — 0 with `withTenantRoute`)**:
  `audit/adjustments`, `audit/lock`, `audit/log`, `approvals`, `approvals/rules`, `approvals/[id]/decide`, `drafts`, `drafts/[id]`, `drafts/[id]/promote`
- **Auth, Users, System, Tenant, Sync, Devices, Notifications, AI, Support, Licensing (37 routes — 23 with `withTenantRoute`)**:
  `auth/login` (`T`), `auth/logout`, `auth/recover-admin`, `bootstrap` (`T`), `users` (`T`), `users/[id]` (`T`), `users/[id]/reset-password` (`T`), `users/me/profile`, `users/me/password`, `system/settings` (`T`), `system/branding` (`T`), `system/backup` (`T`), `system/backups` (`T`), `system/restore` (`T`), `system/runtime` (`T`), `system/lifecycle`, `system/reset`, `tenant/config` (`T`), `tenants/provision`, `sync/push` (`T`), `sync/pull` (`T`), `sync/conflicts` (`T`), `devices` (`T`), `devices/[deviceId]` (`T`), `notifications` (`T`), `notifications/[id]/read` (`T`), `ai/agent`, `ai/extract-document` (`T`), `ai/extract-document/post` (`T`), `support/chat`, `public/tenant` (`T`), `public/verify` (`T`), `licensing/activate`, `licensing/status`, `licensing/seats`, `licensing/seats/release`, `licensing/verify-key`

---

## 5. Audited Frontend UI Components (`src/components/`)

- Shell & Auth: [UasAppShell.tsx](file:///e:/2026/uas-accounting-system/src/components/UasAppShell.tsx), [LoginView.tsx](file:///e:/2026/uas-accounting-system/src/components/LoginView.tsx), [SystemTab.tsx](file:///e:/2026/uas-accounting-system/src/components/tabs/SystemTab.tsx)
- Accounting & Reports UI: [GeneralLedgerTab.tsx](file:///e:/2026/uas-accounting-system/src/components/GeneralLedgerTab.tsx), [CoaTreeTab.tsx](file:///e:/2026/uas-accounting-system/src/components/CoaTreeTab.tsx), [FinancialReportsTab.tsx](file:///e:/2026/uas-accounting-system/src/components/FinancialReportsTab.tsx), [AccountingSettingsPanel.tsx](file:///e:/2026/uas-accounting-system/src/components/AccountingSettingsPanel.tsx), [MultiCurrencyFxPanel.tsx](file:///e:/2026/uas-accounting-system/src/components/MultiCurrencyFxPanel.tsx), [FiscalYearClosingModal.tsx](file:///e:/2026/uas-accounting-system/src/components/FiscalYearClosingModal.tsx), [AuditTab.tsx](file:///e:/2026/uas-accounting-system/src/components/tabs/AuditTab.tsx)
- Operations & Sub-Ledgers UI: [ProcurementTab.tsx](file:///e:/2026/uas-accounting-system/src/components/ProcurementTab.tsx), [SalesTab.tsx](file:///e:/2026/uas-accounting-system/src/components/tabs/SalesTab.tsx), [CustomersTab.tsx](file:///e:/2026/uas-accounting-system/src/components/tabs/CustomersTab.tsx), [TreasuryTab.tsx](file:///e:/2026/uas-accounting-system/src/components/tabs/TreasuryTab.tsx) (`L432` calls nonexistent `/api/records/lifecycle`), [BankPayoutModal.tsx](file:///e:/2026/uas-accounting-system/src/components/BankPayoutModal.tsx), [ExpensesTab.tsx](file:///e:/2026/uas-accounting-system/src/components/tabs/ExpensesTab.tsx), [WorkersTab.tsx](file:///e:/2026/uas-accounting-system/src/components/tabs/WorkersTab.tsx), [InventoryTab.tsx](file:///e:/2026/uas-accounting-system/src/components/tabs/InventoryTab.tsx), [MultiUnitInventoryPanel.tsx](file:///e:/2026/uas-accounting-system/src/components/MultiUnitInventoryPanel.tsx), [ProjectsManagerTab.tsx](file:///e:/2026/uas-accounting-system/src/components/ProjectsManagerTab.tsx), [ProjectsTab.tsx](file:///e:/2026/uas-accounting-system/src/components/tabs/ProjectsTab.tsx), [DashboardTab.tsx](file:///e:/2026/uas-accounting-system/src/components/tabs/DashboardTab.tsx), [ApprovalsCenter.tsx](file:///e:/2026/uas-accounting-system/src/components/ApprovalsCenter.tsx), [ApprovalRulesMatrixPanel.tsx](file:///e:/2026/uas-accounting-system/src/components/ApprovalRulesMatrixPanel.tsx), [UasAiCopilot.tsx](file:///e:/2026/uas-accounting-system/src/components/UasAiCopilot.tsx)

---

## 6. Inspected Test Suite (`tests/*.test.ts` — **33** Files)

All 33 test files were cataloged via read-only static inspection ([ledger.test.ts](file:///e:/2026/uas-accounting-system/tests/ledger.test.ts), [accountingCore6GenAndCostCenter.test.ts](file:///e:/2026/uas-accounting-system/tests/accountingCore6GenAndCostCenter.test.ts), [multiCurrencyAndFx.test.ts](file:///e:/2026/uas-accounting-system/tests/multiCurrencyAndFx.test.ts), [fiscalYearClosingAndRollover.test.ts](file:///e:/2026/uas-accounting-system/tests/fiscalYearClosingAndRollover.test.ts), [approvalAndAmendmentEngine.test.ts](file:///e:/2026/uas-accounting-system/tests/approvalAndAmendmentEngine.test.ts), [multiUnitInventory.test.ts](file:///e:/2026/uas-accounting-system/tests/multiUnitInventory.test.ts), [bankWalletGateway.test.ts](file:///e:/2026/uas-accounting-system/tests/bankWalletGateway.test.ts), [idempotencyAndLifecycleInvariants.test.ts](file:///e:/2026/uas-accounting-system/tests/idempotencyAndLifecycleInvariants.test.ts), [multiTenantIsolationAndSync.test.ts](file:///e:/2026/uas-accounting-system/tests/multiTenantIsolationAndSync.test.ts), [phase3ScopedResetAndFactoryFormat.test.ts](file:///e:/2026/uas-accounting-system/tests/phase3ScopedResetAndFactoryFormat.test.ts), [phase4Mission3ControlsAndRbac.test.ts](file:///e:/2026/uas-accounting-system/tests/phase4Mission3ControlsAndRbac.test.ts), [recoveryAndBackup.test.ts](file:///e:/2026/uas-accounting-system/tests/recoveryAndBackup.test.ts), [sqliteBootstrap.test.ts](file:///e:/2026/uas-accounting-system/tests/sqliteBootstrap.test.ts), [formulas.test.ts](file:///e:/2026/uas-accounting-system/tests/formulas.test.ts), [licensingV2.test.ts](file:///e:/2026/uas-accounting-system/tests/licensingV2.test.ts), plus remaining 18 domain/UI/sync/licensing/AI test files).
