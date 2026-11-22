# 10 — Accounting Testing & Quality Assurance Gaps

---

## 1. Test Inventory & Inspection Limitations

- **Total Test Files Inspected**: **33** `*.test.ts` files in `tests/` (using Node built-in `node:test` + `tsx`).
- **Live Test Execution Status**: **`NOT VERIFIED` (Did NOT Execute `npm test`)** — strictly prohibited by the Independent Audit Charter (`Comprehensive Accounting System Audit.md` Section 8 & user instructions: read-only inspection only, zero DB mutations/executions). Note that 18 of the 33 test files connect directly to mutable Prisma SQLite (`prisma/dev.db` / tenant SQLite files).
- **Inspection Findings Across the 33 Test Files**:
  - **18 files** exercise Prisma / SQLite queries directly (`ledger.test.ts`, `accountingCore6GenAndCostCenter.test.ts`, `multiCurrencyAndFx.test.ts`, `fiscalYearClosingAndRollover.test.ts`, `approvalAndAmendmentEngine.test.ts`, `multiUnitInventory.test.ts`, `bankWalletGateway.test.ts`, `idempotencyAndLifecycleInvariants.test.ts`, `multiTenantIsolationAndSync.test.ts`, `sqliteBootstrap.test.ts`, `workspaceDrafts.test.ts`, `userLifecycle.test.ts`, `syncNotificationsAndDevices.test.ts`, `aiAgent.test.ts`, `aiAgentAndBackupSync.test.ts`, `licensing.test.ts`, `licensingV2.test.ts`, `architectureSubdomainAndTenantConfig.test.ts`). Note: `licensingV2.test.ts` contains **2 tests with `{ skip: !privateKeyExists }`** (`L262`, `L309`).
  - **15 files** test pure helper functions, in-memory localStorage adapters (`offlineAndroidStore.ts`), or static source/diagnostics (`formulas.test.ts`, `phase4Mission3ControlsAndRbac.test.ts`, `printDocumentEngine.test.ts`, `phase3ScopedResetAndFactoryFormat.test.ts`, `enterprisePortfolioGuardedNavigation.test.ts`, `phase1Copilot*`, `phase2*`, `phase3Pdf*`, `nativeBridge.test.ts`, `voiceTransport*`, `androidLicensing*`, `recoveryAndBackup.test.ts`, `supportEngine.test.ts`).
  - **Zero** React component tests (React Testing Library) or browser E2E tests (Playwright/Cypress) exist for any UI form or tab.
  - **Only 6 files** reference HTTP/route handlers or `fetch` (`routeOrFetch=True`), leaving the vast majority of the **90 Next.js API routes completely untested over HTTP**.

---

## 2. Why Current Tests Missed Critical Accounting & Security Defects

Even if all 33 existing test files passed locally, static audit proves **they do NOT test key enterprise failure modes**:

| Defect Area Missed by Existing Tests | What Existing Tests Actually Check Instead | Specific Uncovered Critical Scenario |
|---|---|---|
| **Reversal Double-Inversion (`DEF-01`)** | `ledger.test.ts` checks `postJournalEntry` balance (`Sum(Dr) === Sum(Cr)`) and `generateFinancialReports()` without reversing any entry first. | **Missing Test**: Post entry -> call `reverseJournalEntry()` -> call `generateFinancialReports()` -> assert account net balance returns to **`0.00`**. Would **FAIL** today (`-amount` ghost balance)! |
| **Balance Sheet Date Bug (`DEF-05`)** | `ledger.test.ts` calls `generateFinancialReports()` with no `fromDate..toDate` filters. | **Missing Test**: Post Equity Capital on `2026-01-01`, Sale on `2026-11-10`, query Balance Sheet for `fromDate=2026-11-01&toDate=2026-11-30` -> Cash & Equity from Jan 1 vanish! |
| **Closed Fiscal Year Income Statement (`DEF-05`)** | `fiscalYearClosingAndRollover.test.ts` checks `YEAR_END_CLOSING` & `OPENING` lines directly via `prisma.journalEntry`, never calling `generateFinancialReports({ fromDate, toDate })` on the closed year! | **Missing Test**: Close FY-2019 -> generate FY-2019 Income Statement (`generateFinancialReports`) -> today shows Revenue = `0`, Expense = `0`! |
| **Multi-Tenant Route Bypass (`DEF-03`)** | `multiTenantIsolationAndSync.test.ts` tests `runWithTenantContext()` directly in TypeScript rather than hitting `/api/accounting/*`, `/api/sales/*`, `/api/procurement/*`. | **Missing Test**: HTTP `POST /api/accounting/journal` with `x-uas-tenant-id: tenant_b` -> assert write landed in `tenant_b` DB, NOT `default` DB. Currently **FAILS across 67 / 90 routes**! |
| **Authentication & RBAC Spoofing (`DEF-02`)** | `phase4Mission3ControlsAndRbac.test.ts` & `ledger.test.ts` pass fake user objects into `permissions.ts` pure helpers (`canCloseFiscalYear`, `isReadOnly`), never sending unauthenticated HTTP requests to routes! | **Missing Test**: Send `POST /api/system/reset`, `/api/accounting/fx-revaluation`, `/api/treasury/dispatch` with forged `actor.userRole: "SUPER_ADMIN"` or empty actor -> currently returns `200 OK` as `SUPER_ADMIN`! |
| **Inventory ↔ GL & COGS (`DEF-04`)** | `multiUnitInventory.test.ts` asserts `computeWeightedAverageCost()` and `StockBalance` row counts (`bal.qtyOnHandBase = 72`), never asserting GL `JournalEntry` creation or Sales COGS. | **Missing Test**: `POST /api/procurement/bills` (`isInventory=true`) -> assert `StockBalance` updated; `POST /api/inventory/movements` -> assert `JournalEntry` created; `POST /api/sales` -> assert stock deducted & COGS posted. |
| **Treasury ↔ GL Drift (`DEF-08`)** | `bankWalletGateway.test.ts` tests `executeBankOrWalletPayout` balance deduction cleanly, while `ledger.test.ts` never checks `TreasuryAccount.balanceYER` vs GL balance after expenses, wages, audit adjustments, or `DELETE /api/procurement/payments`. | **Missing Test**: Record operating expense (`POST /api/expenses`) or paid worker wage (`POST /api/workers`) or delete vendor payment (`DELETE /api/procurement/payments`) -> assert `TreasuryAccount.balanceYER === GL Account Balance`. Fails immediately! |
| **FX Revaluation Repeat Run & Realized FX (`DEF-07`, `DEF-15`)** | `multiCurrencyAndFx.test.ts` tests pure helper functions `computeRealizedFxGainLoss()` & `computeUnrealizedFxRevaluation()` in isolation without running `POST /api/accounting/fx-revaluation` twice or calling `postVendorPayment`/`postCustomerReceipt` at changed FX rates! | **Missing Test**: Run `POST /api/accounting/fx-revaluation` twice at identical spot rate -> 2nd run must post `0` adjustment. Settle 100 USD AR invoice at 1650 vs booked 1600 -> must post `50,000` Realized FX Gain. |
| **Sales & Installment Deletion Integrity (`DEF-11`)** | `ledger.test.ts` rolls back test transactions using `throw new Error(SENTINEL)` and never tests `DELETE /api/sales/[id]` or `DELETE /api/installments`. | **Missing Test**: Create partial-paid sale via `POST /api/sales` -> call `DELETE /api/sales/[id]` -> assert `SalesInvoice`, `ReceiptVoucher`, `InstallmentVoucher`, GL, and `TreasuryAccount` all cleanly offset/reversed. Currently leaves orphans! |
| **Approval Bypass on REST Routes (`DEF-10`)** | `approvalAndAmendmentEngine.test.ts` tests `approvalEngine.ts` helpers directly in isolation; `aiAgentAndBackupSync.test.ts` tests AI tool path. | **Missing Test**: Enable `requireApprovalWorkflow = true` / `ApprovalRule` -> `POST /api/accounting/journal` or `/api/procurement/bills` -> assert `PENDING_APPROVAL` & `ApprovalRequest` created. Currently posts immediately (`POSTED`)! |
| **Scoped Reset Unbalanced GL (`DEF-16`)** | `phase3ScopedResetAndFactoryFormat.test.ts` mocks/runs offline store or `precheckScopedReset`, never inspecting post-reset Trial Balance balance (`Sum(Dr) === Sum(Cr)`) after a `unit` / `costCenter` / `treasury` reset! | **Missing Test**: Post cross-cost-center JE -> run `executeScopedReset({ scope: "unit", unitType: "costCenter" })` -> assert Trial Balance still balances. Currently deletes half of JE lines leaving broken entries! |
| **UI API Contract & Button Tests (`DEF-18`)** | Zero UI tests exist. `TreasuryTab.tsx` calling nonexistent `/api/records/lifecycle` was never caught. | **Missing Test**: Click Archive/Delete on Treasury Card -> fails 404 in browser. |

---

## 3. Critical Missing Test Categories (Section 7 Matrix)

- **API HTTP Integration Suite (Real NextRequest + Tenant Context + Unauthenticated Reject Checks)**: `MISSING` across ~84/90 endpoints.
- **Ledger Invariant Property/Regression Suite** (`reverseJournalEntry` + `updateJournalEntry` immutability + `YEAR_END_CLOSING` + cumulative Balance Sheet + FX re-run idempotency): `MISSING`.
- **Cross-Module E2E Accounting Reconciliation Tests** (`Sub-Ledger AR/AP/Treasury/Inventory === GL Control Balances`): `MISSING`.
- **Database Precision & Rounding Stress Tests** (`0.0001` / large scale YER * FX conversions comparing `Decimal` vs `Float`): `MISSING`.
- **Frontend UI / Component / Playwright E2E Suite**: `MISSING`.
- **PostgreSQL Multi-Tenant Production Parity Tests**: `PARTIAL / NOT VERIFIED` (tests clone SQL string transformations rather than live PostgreSQL instance execution).
