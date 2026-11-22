# 05 — Accounting & Technical Defects and Risks

Every defect below is proven by direct source inspection across UI, API, domain services, database schema, and offline storage adapters.

---

## Summary by Severity

| Severity | Count | Key Themes |
|---|---:|---|
| **CRITICAL** | 10 | Reversal double-inversion, spoofable unauthenticated APIs, 67/90 non-tenant routes, inventory↔GL disconnect, broken Balance Sheet/closed P&L queries, in-place mutation of posted GL entries, FX revaluation double-posting, Treasury↔GL drift, insecure inbound webhook |
| **HIGH** | 12 | Bypassed approval workflow, `DELETE /api/sales/[id]` orphaning, hard deletes with GL deletion fallback, un-enforced `periodLockDate`/`creditLimit`/3-way match, unused Realized FX & Control Accounts/Sequences config, Scoped Reset unbalanced JEs, `Decimal`/`Float` precision loss, Treasury UI 404 `/api/records/lifecycle`, Android offline local stubs |
| **MEDIUM** | 5 | `reverseJournalEntry` dropping `costCenterId`, race-prone `nextSequenceCode`, unsalted SHA-256 + default `"123456"` seeds, `fx-revaluation` orphan L5 accounts without `parentId`, fail-open license guard catch block |

---

## 1. CRITICAL Accounting & Technical Defects

### DEF-01: Journal Reversal Double-Inversion Bug Corrupts Trial Balance & Financial Statements
- **Location**: `reverseJournalEntry()` ([ledgerService.ts:L675-717](file:///e:/2026/uas-accounting-system/src/lib/accounting/ledgerService.ts#L675-L717)) and `buildPostedLineWhere()` ([ledgerService.ts:L1864-1867](file:///e:/2026/uas-accounting-system/src/lib/accounting/ledgerService.ts#L1864-L1867))
- **Root Cause**: Reversing a `POSTED` journal entry **both**:
  1. Creates an opposite-sign reversal entry with `status: "POSTED"` (and `documentStatus: "POSTED"`), **and**
  2. Updates the original entry to `status: "VOIDED"`.
  Then `buildPostedLineWhere()` filters `journalEntry: { status: "POSTED", documentStatus: "POSTED" }`, **excluding the original entry while retaining the reversal**.
- **Mathematical Effect**: Instead of `+100 (orig) - 100 (rev) = 0`, reporting computes `0 (orig excluded) - 100 (rev included) = -100`! Every reversed entry creates a permanent opposite-sign ghost balance across Trial Balance, Income Statement, Balance Sheet, and Cost Center P&L.
- **Secondary Defect (`L701-711`)**: `reverseJournalEntry` maps `projectId`, `subProjectId`, and `harvestCycleId` onto reversal lines **but omits `costCenterId`**, distorting Cost Center P&L reports even further.

### DEF-02: Complete Absence of Server-Side Authentication & Spoofable `SUPER_ADMIN` Default
- **Location**: [login/route.ts](file:///e:/2026/uas-accounting-system/src/app/api/auth/login/route.ts), [logout/route.ts](file:///e:/2026/uas-accounting-system/src/app/api/auth/logout/route.ts), `extractActor()` / `resolveVerifiedActor()` ([apiHelpers.ts:L33-130](file:///e:/2026/uas-accounting-system/src/lib/apiHelpers.ts#L33-L130)), [system/reset/route.ts:L53-67](file:///e:/2026/uas-accounting-system/src/app/api/system/reset/route.ts#L53-L67), [treasury/dispatch/route.ts:L9-12](file:///e:/2026/uas-accounting-system/src/app/api/treasury/dispatch/route.ts#L9-L12)
- **Root Cause**: `/api/auth/login` verifies credentials and returns JSON `{ user }` with **zero** `Set-Cookie`, signed JWT, or DB session token (`logout/route.ts` clears cookies that are never created). `extractActor()` trusts unverified `body.actor` or headers (`x-uas-user-id`, `x-uas-role`) and defaults omitted identity to `{ userId: "u1", userRole: "SUPER_ADMIN" }`. Even `resolveVerifiedActor()` returns spoofed `actor.userRole` when `actor.userId` is absent in DB (`L129`). Furthermore, `29` routes call `extractActor()` without `authorizeApiAction()`, and `25` routes omit even `extractActor()`.
- **Impact**: Any unauthenticated network client can forge headers/body or omit them to post GL entries, trigger bank payouts, export backups, modify users, or execute a full `FACTORY_RESET`.

### DEF-03: Multi-Tenant Context Bypass Across 67 of 90 API Routes
- **Location**: `withTenantRoute` ([tenantContext.ts](file:///e:/2026/uas-accounting-system/src/lib/tenant/tenantContext.ts)) vs Route Scan across `src/app/api/`
- **Root Cause**: Only **23 / 90** routes wrap handlers with `withTenantRoute()`. All **67 remaining routes** execute without setting the `AsyncLocalStorage` tenant DB context—including all `accounting/*` (13 routes), `procurement/*` (4), `sales/*` (5), `expenses/*` (2), `workers/*` (2), `inventory/*` (6), `projects/*` (4), `treasury/*` (7), `approvals/*` (3), `audit/*` (3), `drafts/*` (3), `installments` (1), `system/reset` (1), `system/lifecycle` (1), and `ai/agent` (1).
- **Impact**: `GET /api/bootstrap` (which uses `withTenantRoute`) renders Tenant B's workspace, yet saving a journal entry (`/api/accounting/journal`), bill, invoice, or report hits the `default` tenant database—causing severe cross-tenant corruption and data disclosure.

### DEF-04: Inventory & Sales COGS Completely Disconnected from General Ledger
- **Location**: [inventory/movements/route.ts:L140-195](file:///e:/2026/uas-accounting-system/src/app/api/inventory/movements/route.ts#L140-L195), `postVendorBill` ([ledgerService.ts:L739-850](file:///e:/2026/uas-accounting-system/src/lib/accounting/ledgerService.ts#L739-L850)), [sales/route.ts](file:///e:/2026/uas-accounting-system/src/app/api/sales/route.ts), [inventory/items/route.ts:L200-202](file:///e:/2026/uas-accounting-system/src/app/api/inventory/items/route.ts#L200-L202)
- **Root Cause**:
  1. `POST /api/inventory/movements` updates `StockBalance` and creates `StockMovement` (and `StockMovement` in WAC), **but generates zero `JournalEntry` rows**.
  2. `InventoryItem.inventoryAccountId`, `cogsAccountId`, and `revenueAccountId` are persisted in schema/API (`items/route.ts`) **but never queried or posted anywhere**.
  3. `postVendorBill(..., isInventory: true)` debits GL `113201` (Inventory) **without creating any `StockMovement` or updating `StockBalance`**.
  4. `POST /api/sales` and `postSalesInvoice()` credit Revenue and debit AR, **but never deduct warehouse `StockBalance` or `HarvestInventoryBatch` and never post `DR COGS / CR Inventory`**.
  5. `SystemSettings.costingMethod = "FIFO"` is UI/DB config only; `movements/route.ts` uses `computeWeightedAverageCost` exclusively, and `InventoryLot` is unused.
- **Impact**: Balance Sheet Inventory and Income Statement COGS never reconcile to physical stock quantities or valuation.

### DEF-05: Balance Sheet Uses Period Range Filter & Reports Double-Count Across Years / Zero Closed P&L
- **Location**: `buildPostedLineWhere` & `generateFinancialReports` ([ledgerService.ts:L1849-2083](file:///e:/2026/uas-accounting-system/src/lib/accounting/ledgerService.ts#L1849-L2083)), `costCenterProfitAndLoss` ([accountingCoreEngine.ts:L461-504](file:///e:/2026/uas-accounting-system/src/lib/accountingCoreEngine.ts#L461-L504))
- **Root Cause**:
  1. **Balance Sheet Period Filter Bug**: `generateFinancialReports(filters)` passes the same `filters.fromDate` and `filters.toDate` into `getCoaTreeWithBalances(filters)` for **both** Income Statement and Balance Sheet (`L1880`). Filtering `fromDate: 2026-11-01, toDate: 2026-11-30` drops all historical Cash, Receivables, Payables, and Equity prior to Nov 1 from the Balance Sheet!
  2. **Closed-Year Zeroing Bug**: Unlike `runFiscalYearPrecheck` (`entryType: { not: "YEAR_END_CLOSING" }`), `buildPostedLineWhere` and `costCenterProfitAndLoss` do NOT exclude `YEAR_END_CLOSING` entries. Once a fiscal year is closed, its Revenue and Expense closing entries cancel P&L balances to `0` when viewing that closed year's Income Statement or Cost Center P&L!
  3. **Multi-Year Double-Counting**: Querying without `fromDate` after year-end rollover sums Year 1 `NORMAL` asset/liability lines **plus** Year 2 `OPENING` carry-forward lines (`executeFiscalYearCloseAndRollover`), doubling cumulative Balance Sheet balances.

### DEF-06: Posted Journal Entries Are Mutated In-Place, Stripping FX & Cost Center Attribution
- **Location**: `updateJournalEntry()` ([ledgerService.ts:L2780-2931](file:///e:/2026/uas-accounting-system/src/lib/accounting/ledgerService.ts#L2780-L2931)), `GeneralLedgerTab.tsx` (`POSTED` edit button `L970-980`)
- **Root Cause**: `updateJournalEntry()` only blocks `status === "VOIDED"`, allowing full replacement of lines via `journalEntryLine.deleteMany` + `createMany` (`L2888-2891`) and date changes on already `POSTED` entries. It checks neither `periodLockDate` nor `assertDateNotInClosedFiscalYear` for `nextDate`. Additionally, `preparedLines` (`L2867-2879`) omits `currencyCode`, `foreignDebit`, `foreignCredit`, `baseDebit`, `baseCredit`, and `costCenterId`, silently resetting them to schema defaults (`"YER"`, `0`, `0`, `0`, `0`, `null`)! Meanwhile `recordAuditDiffTx` logs only `{ date, reference, narrationAr, lineCount }` (`L2915-2926`), hiding amount/account changes.

### DEF-07: Foreign Currency Revaluation Double-Posts on Repeat Runs Without Auth or Closing Guards
- **Location**: `POST /api/accounting/fx-revaluation` ([fx-revaluation/route.ts:L17-238](file:///e:/2026/uas-accounting-system/src/app/api/accounting/fx-revaluation/route.ts#L17-L238))
- **Root Cause**:
  1. `collectOpenFxPositions()` queries `journalEntryLine` where `currencyCode: { not: "YER" }` (`L21`) and sums `debitBase - creditBase` as `bookedBaseBalance`.
  2. `POST` inserts the revaluation adjustment `JournalEntry` directly via `tx.journalEntry.create` with **`currency: "YER"` and `currencyCode: "YER"`** (`L194-195`).
  3. Because the revaluation adjustment itself is tagged `"YER"`, **re-running FX revaluation at the same spot rate reads the exact same unchanged foreign base balance and posts identical gains/losses repeatedly!**
  4. The route calls `extractActor()` (no `authorizeApiAction`, ignoring `canFxRevalue`), skips `assertDateNotInClosedFiscalYear`, lacks `withIdempotency`, and creates missing `421102`/`521102` accounts at `level: 5` without `parentId`/`generation`/`isPostable`.

### DEF-08: Perpetual Drift Between GL Cash/Bank Balances and `TreasuryAccount` Sub-Ledger
- **Location**: Multiple write paths:
  - `postOperatingExpenseJournalTx` ([ledgerService.ts:L1238-1309](file:///e:/2026/uas-accounting-system/src/lib/accounting/ledgerService.ts#L1238-L1309)) & `POST /api/expenses` — credits treasury GL (`111101` / chosen treasury COA) **without decrementing `TreasuryAccount.balance` / `balanceYER`**.
  - `postWorkerWageJournalTx` ([ledgerService.ts:L1380-1412](file:///e:/2026/uas-accounting-system/src/lib/accounting/ledgerService.ts#L1380-L1412)) & `POST /api/workers` — credits `111101` for initial `creditAmount > 0` **without decrementing `TreasuryAccount`**.
  - `POST /api/audit/adjustments` ([adjustments/route.ts:L48](file:///e:/2026/uas-accounting-system/src/app/api/audit/adjustments/route.ts#L48)) — credits `111101` **without updating `TreasuryAccount`**.
  - `DELETE /api/procurement/payments` ([payments/route.ts:L387-435](file:///e:/2026/uas-accounting-system/src/app/api/procurement/payments/route.ts#L387-L435)) — reverses `VendorBill` and GL **without restoring `TreasuryAccount.balance` / `balanceYER`**.
  - `DELETE /api/installments` ([installments/route.ts:L250-253](file:///e:/2026/uas-accounting-system/src/app/api/installments/route.ts#L250-L253)) — updates `balanceYER` **without updating `balance`**.
  - `DELETE /api/sales/[id]` ([sales/[id]/route.ts:L100-120](file:///e:/2026/uas-accounting-system/src/app/api/sales/%5Bid%5D/route.ts#L100-L120)) — never restores `TreasuryAccount` on deleted paid sales.
  - `processInboundCollectionWebhook` ([bankWalletGateway.ts:L471-555](file:///e:/2026/uas-accounting-system/src/lib/treasury/bankWalletGateway.ts#L471-L555)) — increments `TreasuryAccount` **without creating any `JournalEntry`**.

### DEF-09: Unauthenticated Inbound Bank Webhook Credits Treasury Without Signatures or GL Entry
- **Location**: `POST /api/treasury/webhook/[provider]` and `processInboundCollectionWebhook()` ([bankWalletGateway.ts:L471-555](file:///e:/2026/uas-accounting-system/src/lib/treasury/bankWalletGateway.ts#L471-L555))
- **Root Cause**: `signatureHeader` parameter is accepted in `InboundWebhookInput` (`L47`) and **never verified**; route lacks HMAC validation, auth, and `withTenantRoute`; webhook creates a `RECONCILED` `BankPaymentDispatch` and increments `TreasuryAccount.balance` with **zero GL `JournalEntry`** and **zero `SalesInvoice`/`ReceiptVoucher` settlement**.
- **Related Gateway Defect (`executeBankOrWalletPayout`, `L309-391`)**: Bypasses `postJournalEntry()` (uses raw `tx.journalEntry.create` skipping closed-FY/period checks), picks an arbitrary `findFirst` `211190`/`212190` vendor/worker account instead of the voucher's actual vendor/worker account, duplicates GL credit/debit if invoked after `PaymentVoucher` already posted GL, and writes fake `sha256Hash: "HASH-${Date.now()}-${dispatch.id}"`.

### DEF-10: Approval Workflow Completely Bypassed on Standard Financial REST Endpoints
- **Location**: [workspaceDraftsEngine.ts:L287-309](file:///e:/2026/uas-accounting-system/src/lib/workspaceDraftsEngine.ts#L287-L309), [agentServerExecutor.ts:L553-609](file:///e:/2026/uas-accounting-system/src/lib/ai/agentServerExecutor.ts#L553-L609), vs direct routes `/api/accounting/journal`, `/api/procurement/bills`, `/api/procurement/payments`, `/api/sales/*`, `/api/expenses`, `/api/workers`
- **Root Cause**: None of the standard API routes check `SystemSettings.requireApprovalWorkflow` or call `findMatchingApprovalRule()` / `submitApprovalRequest()`. Even `promoteWorkspaceDraft()` only applies `PENDING_APPROVAL` to `JOURNAL_VOUCHER` (not invoices, bills, payments, receipts, or wages) and never inserts an `ApprovalRequest` row for `ApprovalsCenter`!

---

## 2. HIGH Defects & Integrity Risks

- **DEF-11 (`DELETE /api/sales/[id]` Orphaned Accounting Sub-Ledger Records & Redundant Receipt/Installment Creation)**: `POST /api/sales` creates `SaleTransaction` + `SalesInvoice` + `ReceiptVoucher` + `InstallmentVoucher` (duplicate collection documents for one sale!). `DELETE /api/sales/[id]` deletes `SaleTransaction` and reverses only `SaleTransaction.journalEntryId`, leaving `SalesInvoice`, `ReceiptVoucher` (and its separate GL entry!), `InstallmentVoucher`, and `TreasuryAccount` untouched.
- **DEF-12 (Hard Deletes with Catch-Swallowed GL Destruction)**: `DELETE /api/procurement/bills` (L361-364), `DELETE /api/procurement/payments` (L412-415), `DELETE /api/installments` (L265-268), `DELETE /api/sales/[id]` (L111), `DELETE /api/expenses/[id]` (L111), and `DELETE /api/workers/[id]` (L105) physically delete operational rows—and the first three catch `reverseJournalEntry` errors (e.g., if already voided or locked) by executing `tx.journalEntryLine.deleteMany` + `tx.journalEntry.delete`!
- **DEF-13 (`periodLockDate` Ignored Across Core Posting Paths)**: `assertNotInLockedPeriod()` ([accountingSettings.ts:L161](file:///e:/2026/uas-accounting-system/src/lib/accountingSettings.ts#L161)) is called only in `fx-revaluation`, `syncEngine`, and AI doc extraction validation—never inside `postJournalEntry()`, `updateJournalEntry()`, `postVendorBill()`, `postSalesInvoice()`, `POST /api/expenses`, `POST /api/workers`, or `POST /api/sales`.
- **DEF-14 (Dead Configuration Maps & Colliding Tax Control Codes)**: `ControlAccountsMap` and `generateNextDocumentNumber()` in `accountingSettings.ts` are editable in `AccountingSettingsPanel.tsx`, **but completely ignored** by `ledgerService.ts` (hardcoded COA strings + `nextSequenceCode`). Default `taxPayableAccount: "212101"` = *مستحقات الأجور والرواتب (Payroll Payables)* and `taxReceivableAccount: "114101"` = *دفعات مقدمة للموردين (Vendor Advances)* in `coaCatalog.ts`.
- **DEF-15 (Realized FX Calculation Helper Unwired)**: `computeRealizedFxGainLoss()` ([multiCurrencyEngine.ts:L215](file:///e:/2026/uas-accounting-system/src/lib/multiCurrencyEngine.ts#L215)) is never called when `postVendorPayment()` or `postCustomerReceipt()` settles a foreign-currency bill/invoice at a changed rate. `balanceDualCurrencyLines()` (`L102`) is likewise never called in `postJournalEntry()`.
- **DEF-16 (`ScopedResetEngine` Creates Unbalanced GL Entries & Corrupts Blank COA)**:
  - `executeScopedReset` (`scope === "unit"`, [scopedResetEngine.ts:L429-437](file:///e:/2026/uas-accounting-system/src/lib/scopedResetEngine.ts#L429-L437)) deletes `journalEntryLine` by `costCenterId` alone without validating whether its parent `JournalEntry` has remaining lines on another cost center—leaving **single-sided unbalanced `JournalEntry` headers** (`Sum(Debit) !== Sum(Credit)`)!
  - `scope === "section"` (`sectionModule === "treasury"`, `L372`) resets `TreasuryAccount` balances to zero without reversing/zeroing Treasury GL lines.
  - `factory` (`blank_coa`, `L476`) preserves `code: { notIn: ["1", "2", "3", "4", "5"] }` whereas actual Gen-1 root codes are `"100000".."500000"`, wiping Gen-1 roots too.
  - `precheckScopedReset` (`L129`) counts `workspaceDraft` `status: "DRAFT"` instead of `"ACTIVE_DRAFT"`.
- **DEF-17 (Un-enforced `Customer.creditLimit` & Bypassed Three-Way Matching)**: `Customer.creditLimit` is never checked before invoicing; `POST /api/procurement/bills` allows posting without any `GoodsReceipt` or with variance and unconditionally flips PO status to `"POSTED"`.
- **DEF-18 (Broken Treasury UI Lifecycle Endpoint `/api/records/lifecycle`)**: [TreasuryTab.tsx:L432](file:///e:/2026/uas-accounting-system/src/components/tabs/TreasuryTab.tsx#L432) posts Archive/Restore/Safe-Delete requests to `/api/records/lifecycle` (404 Not Found) with payload key `entityId` instead of `/api/system/lifecycle` with key `id`.
- **DEF-19 (Mixed `Decimal` vs IEEE-754 `Float` Monetary Columns & JS Floating-Point Math)**: Over 30 numeric monetary/rate/quantity columns across `schema.prisma` (`TreasuryAccount.balanceYER`, `OperatingExpense`, `WorkerWageEntry`, `SaleTransaction`, `InstallmentVoucher`, `StockBalance`, `StockMovement`, `BankPaymentDispatch`, `AdjustmentEntry`, `Project.estimatedValue`, and FX helper columns on invoices/vouchers) use `Float` instead of `Decimal`, and arithmetic uses binary JS `number` (`round4`).
- **DEF-20 (Android Offline Adapter Functional Divergence)**: In Android Local Mode (`isAndroidLocalIsolatedMode()`), [offlineAndroidStore.ts:L2064-2624](file:///e:/2026/uas-accounting-system/src/lib/offlineAndroidStore.ts#L2064-L2624) returns empty arrays/zeros for `/api/accounting/reports/*` and `/api/accounting/fx-revaluation`, skips Debit=Credit & leaf validation on `/api/accounting/journal`, and skips WAC/StockBalance calculations on `/api/inventory/movements`.
- **DEF-21 (Non-Transactional Sync Replay & Audit Diff Blind Spots)**: `syncEngine.ts` `pushClientMutations` lacks `postJournalEntry()` / `ApprovalRule` pipelines on several entity types (`SalesInvoice`/`VendorBill` generic updates), and `updateJournalEntry()` diff omits line-level changes.
- **DEF-22 (Unsalted SHA-256 Passwords & Hardcoded Seed Default `"123456"`)**: [serverBootstrap.ts:L47-48](file:///e:/2026/uas-accounting-system/src/lib/serverBootstrap.ts#L47-L48), [seed.ts](file:///e:/2026/uas-accounting-system/prisma/seed.ts), and [tenantDbManager.ts](file:///e:/2026/uas-accounting-system/src/lib/tenant/tenantDbManager.ts) hash passwords with bare unsalted `crypto.createHash("sha256")` and seed default admin accounts with `"123456"`.

---

## 3. MEDIUM Defects & Risks

- **DEF-23 (`reverseJournalEntry` drops `costCenterId`)**: [ledgerService.ts:L701-711](file:///e:/2026/uas-accounting-system/src/lib/accounting/ledgerService.ts#L701-L711).
- **DEF-24 (`nextSequenceCode` Race Condition)**: Count-based `count() + 1` with `Date.now().slice(-4)` collision patch (`L198-242`) risks duplicate numbers under concurrent requests or sequence gaps on voids.
- **DEF-25 (`fx-revaluation` Auto-Creates Level-5 COA Without Parent Link)**: `fx-revaluation/route.ts` `L169-179` creates `421102`/`521102` without `parentId`, `parentCode`, `generation`, or `isPostable`.
- **DEF-26 (`checkLicenseAndClock` Fails Open)**: [apiHelpers.ts:L167-169](file:///e:/2026/uas-accounting-system/src/lib/apiHelpers.ts#L167-L169) swallows errors in `catch` and continues authorizing writes.
- **DEF-27 (PostgreSQL `TenantDbManager` Runtime Enum Cloner Complexity & Silent Catch Fallbacks)**: `clonePostgresEnumTypes`/`remapPostgresEnumColumns` catch failures with warnings (`tenantDbManager.ts`), and production runtime parity could not be live-tested in PostgreSQL (`NOT VERIFIED`).
