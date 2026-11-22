# 03 — Accounting Requirements Matrix (Checklists A–P & Technical/UI/Testing)

Status Legend: `IMPLEMENTED` | `PARTIALLY IMPLEMENTED` | `IMPLEMENTED BUT DEFECTIVE` | `MISSING` | `NOT VERIFIED` | `NOT APPLICABLE`  
Severity Legend: `CRITICAL` | `HIGH` | `MEDIUM` | `LOW`

---

## Section A — Financial Foundation & Accounting Configuration

| ID | Requirement | Status | Severity | Exact Code / Schema Evidence | Audit Finding & Gap Notes |
|---|---|---|---|---|---|
| A.1 | Entity / Company Profile Settings | `IMPLEMENTED` | LOW | `EnterpriseProfile` (`schema.prisma`), `GET/PUT/PATCH /api/system/branding` | Stores legal names, tax/CR numbers, currency, logos; company-name license lock integrated. |
| A.2 | Hierarchical Chart of Accounts | `IMPLEMENTED` | LOW | `Account` (`schema.prisma`), `STANDARD_COA_NODES` (`coaCatalog.ts`), `createHierarchicalAccount` (`ledgerService.ts` L1685), `CoaTreeTab.tsx` | Full 6-generation COA tree with automatic parent summary promotion (`isPosting=false`). |
| A.3 | Account Types & Normal Balances | `IMPLEMENTED` | LOW | `AccountType` enum (`ASSET`, `LIABILITY`, `EQUITY`, `REVENUE`, `EXPENSE`), `calculateNormalBalance` (`ledgerService.ts`) | Debit-normal (`ASSET`, `EXPENSE`) and Credit-normal (`LIABILITY`, `EQUITY`, `REVENUE`) enforced in reporting rollups. |
| A.4 | Hierarchy Levels, Roll-up & Posting Flags | `IMPLEMENTED` | MEDIUM | `level`/`generation`, `isPosting`/`isPostable`, `assertPostableAccount` (`accountingCoreEngine.ts`), `getCoaTreeWithBalances` (`ledgerService.ts` L1824) | Gen 1–5 control nodes reject direct posting (`NON_POSTING_ACCOUNT`); dual fields kept synced in core helpers, though `fx-revaluation` auto-creates L5 nodes without `parentId`. |
| A.5 | Control Accounts Configuration | `IMPLEMENTED BUT DEFECTIVE` | **HIGH** | `ControlAccountsMap` (`accountingSettings.ts` L1-64), `AccountingSettingsPanel.tsx`, hardcoded codes in `ledgerService.ts` | Configuration saved in `SystemSettings.controlAccountsJson`, **but ignored at runtime** by `ledgerService.ts` (hardcodes `111101`, `113201`, `524101`, `511101`, `531201`, `311101`). Defaults `taxPayableAccount: "212101"` (Labor Payables) & `taxReceivableAccount: "114101"` (Vendor Advances) collide with `coaCatalog.ts`. |
| A.6 | Automated Posting Configuration & Default Accounts | `PARTIALLY IMPLEMENTED` | **HIGH** | `coaCatalog.ts` (`mapExpenseCategoryToCoaCode`), `InventoryItem.*AccountId` (`schema.prisma`), `resolveOrCreatePostingAccountTx` | Category and project defaults work partially, **but** `InventoryItem.inventoryAccountId`/`cogsAccountId`/`revenueAccountId` are never posted and `ControlAccountsMap` is ignored. |
| A.7 | Currency, Precision & Rounding Settings | `PARTIALLY IMPLEMENTED` | **HIGH** | `Currency` (`decimalPlaces`), `SystemSettings.defaultCurrency`, `balanceDualCurrencyLines` (`multiCurrencyEngine.ts` L102), mixed `Decimal`/`Float` in `schema.prisma` | `balanceDualCurrencyLines` is never called inside `postJournalEntry()`; rounding defaults to `round4` in JS floating-point `number` across `ledgerService.ts` while >30 schema columns use `Float`. |
| A.8 | Fiscal Years & Accounting Periods Config | `PARTIALLY IMPLEMENTED` | **HIGH** | `FiscalYear` (`schema.prisma`), `fiscalYearClosingEngine.ts`, `SystemSettings.periodLockDate`, `HarvestCycle.isLocked` | FiscalYear table handles annual open/close, **but** no sub-period/monthly `AccountingPeriod` table exists; `periodLockDate` is not enforced in `postJournalEntry()`. |
| A.9 | Accounting Dimensions Config | `PARTIALLY IMPLEMENTED` | MEDIUM | `CostCenter` (`schema.prisma`), `Project`, `SubProject`, `HarvestCycle` | Robust project/cost-center dimensions; lacks Branch/Department/Segment mandatory rules per COA account. |
| A.10 | Accounting Policies Config | `PARTIALLY IMPLEMENTED` | **HIGH** | `SystemSettings.costingMethod`, `negativeStockPolicy`, `requireApprovalWorkflow` | `FIFO` setting has zero code implementation; `requireApprovalWorkflow` ignored by standard REST APIs. |
| A.11 | Document Reference Numbering Management | `IMPLEMENTED BUT DEFECTIVE` | MEDIUM | `DEFAULT_DOCUMENT_SEQUENCES` / `generateNextDocumentNumber` (`accountingSettings.ts` L182), `nextSequenceCode` (`ledgerService.ts` L198) | `generateNextDocumentNumber` is **never called**; `ledgerService.ts` uses race-prone `count() + 1` with `Date.now().slice(-4)` collision fallback; `fx-revaluation` uses `FXR-${year}-${Date.now().slice(-5)}`. |

---

## Section B — General Ledger

| ID | Requirement | Status | Severity | Exact Code / Schema Evidence | Audit Finding & Gap Notes |
|---|---|---|---|---|---|
| B.1 | Journal Entries (Core Engine & CRUD) | `IMPLEMENTED BUT DEFECTIVE` | **CRITICAL** | `postJournalEntry` (`ledgerService.ts` L481), `updateJournalEntry` (`ledgerService.ts` L2780), `/api/accounting/journal` | Creation balances lines, **but `PUT /api/accounting/journal` mutates `POSTED` entries in-place**, deleting lines and omitting `currencyCode`/`foreign*`/`base*`/`costCenterId`. Route lacks `withTenantRoute`. |
| B.2 | Manual Journals | `IMPLEMENTED BUT DEFECTIVE` | **HIGH** | `POST /api/accounting/journal`, `GeneralLedgerTab.tsx` | Works in default DB, **but** misses `withTenantRoute`, `ApprovalRule` checks, and `periodLockDate`. Android local mode saves unvalidated raw objects. |
| B.3 | Recurring Journals | `MISSING` | MEDIUM | Searched `src/` — zero matches outside project acquisition text | No schedule/template table or cron/batch execution for recurring monthly entries. |
| B.4 | Auto-Reversing & Accrual Templates | `MISSING` | MEDIUM | Searched `src/` | No next-period automatic reversal flag (`reverseOnDate`) on accrual/journal entries. |
| B.5 | Adjustment Entries | `IMPLEMENTED BUT DEFECTIVE` | **HIGH** | `POST /api/audit/adjustments`, `AdjustmentEntry`, `AuditTab.tsx` | Hardcodes `DR 531101 / CR 111101` without updating `TreasuryAccount` balances, lacks `authorizeApiAction`/`withTenantRoute`, always cash-credits regardless of adjustment type. |
| B.6 | Opening Balances | `IMPLEMENTED` | MEDIUM | `executeFiscalYearCloseAndRollover` (`fiscalYearClosingEngine.ts`) | Year rollover creates `OPENING` entry preserving Gen-6 & FX balances; lacks standalone opening-balance import wizard UI on initial company onboarding. |
| B.7 | Journal Approval | `IMPLEMENTED BUT DEFECTIVE` | **HIGH** | `ApprovalRule`/`ApprovalRequest` (`approvalEngine.ts`), `agentServerExecutor.ts`, `workspaceDraftsEngine.ts` | Only enforced in AI Agent (`GL_POSTING`) and partially in draft promote (`PENDING_APPROVAL` flag without creating `ApprovalRequest`). **Bypassed completely** by `POST /api/accounting/journal` & operational REST endpoints. |
| B.8 | Journal Posting Rules & Immutability | `IMPLEMENTED BUT DEFECTIVE` | **CRITICAL** | `postJournalEntry` vs `updateJournalEntry` (`ledgerService.ts`), `bankWalletGateway.ts` L377 | `updateJournalEntry` modifies `POSTED` entries; `bankWalletGateway` inserts raw `JournalEntry` bypassing `postJournalEntry()`; no SQLite/Postgres trigger preventing mutations. |
| B.9 | Journal Reversal | `IMPLEMENTED BUT DEFECTIVE` | **CRITICAL** | `reverseJournalEntry` (`ledgerService.ts` L675) & `buildPostedLineWhere` (L1864) | **Double-Inversion Bug**: reversal is `POSTED` while original becomes `VOIDED` and is excluded from reports, leaving net inverted balance in GL reports! Also drops `costCenterId` on reversal lines. |
| B.10 | General Ledger & Account Ledger Inquiry | `PARTIALLY IMPLEMENTED` | **HIGH** | `GET /api/accounting/journal`, `GeneralLedgerTab.tsx`, `CoaTreeTab.tsx` | Lists JEs & COA rolled balances, **but** lacks running per-account balance ledger statement view (`fromDate` opening + movements + closing per GL account) and misses `withTenantRoute`. |
| B.11 | Trial Balance | `IMPLEMENTED BUT DEFECTIVE` | **CRITICAL** | `generateFinancialReports` (`ledgerService.ts` L1879), `/api/accounting/reports/trial-balance` | Excludes `VOIDED` originals while keeping `POSTED` reversals; fails to separate Opening / Period / Closing columns properly across fiscal years; omits `withTenantRoute`. |
| B.12 | Account Reconciliation (GL Accounts) | `PARTIALLY IMPLEMENTED` | **HIGH** | `/api/treasury/reconcile` | Only Treasury GL accounts have line check-off UI (`reconciled` boolean); non-cash clearing/AR/AP/inter-account GL reconciliation is absent. |
| B.13 | Suspense Accounts | `MISSING` | LOW | Searched `src/` — zero hits | No suspense/clearing account workflow for unallocated receipts or unidentified differences. |
| B.14 | Intercompany Journals | `MISSING` | MEDIUM | Searched `src/` | Zero intercompany due-to/due-from posting rules. |
| B.15 | Journal Audit Trail | `PARTIALLY IMPLEMENTED` | **HIGH** | `AuditLog`, `ImmutableAuditLog`, `recordAuditDiffTx`, `/api/audit/log` | Diffs & SHA-256 hash entries written, **but** no hash-chain `prevHash` link across rows, `updateJournalEntry` diff logs only header/lineCount (not old vs new lines!), and some direct mutations lack diffs. |

---

## Section C — Accounts Receivable (AR)

| ID | Requirement | Status | Severity | Exact Code / Schema Evidence | Audit Finding & Gap Notes |
|---|---|---|---|---|---|
| C.1 | Customer Master & Gen-6 Sub-ledger | `IMPLEMENTED` | LOW | `Customer`, `ensureCustomerWithAccountTx`, `/api/sales/customers`, `CustomersTab.tsx` | Auto-provisions `112190xxx` + Cost Center `CC-CUS`; safe delete vs archive supported (route misses `withTenantRoute`). |
| C.2 | Sales Invoices | `IMPLEMENTED BUT DEFECTIVE` | **HIGH** | `postSalesInvoice` (`ledgerService.ts` L1011), `/api/sales/invoices`, `/api/sales` | Posts `DR AR / CR Revenue`, **but** zero line-item table (`SalesInvoiceItem`), zero VAT/tax, zero COGS/Inventory deduction, and `SalesInvoice` is skipped in `DELETE /api/sales/[id]`. |
| C.3 | Debit & Credit Notes (AR) | `MISSING` | **HIGH** | Searched `schema.prisma` & `src/` | No sales returns / credit memo / debit memo document type or reversal-with-return-reason workflow. |
| C.4 | Receipts & Collection Vouchers | `IMPLEMENTED BUT DEFECTIVE` | **HIGH** | `postCustomerReceipt` (`ledgerService.ts` L1118), `ReceiptVoucher`, `InstallmentVoucher`, `/api/sales/receipts`, `/api/installments`, `/api/sales` | `POST /api/sales` creates **both** `ReceiptVoucher` & `InstallmentVoucher` when paid>0; `DELETE /api/installments` fails to update `TreasuryAccount.balance`; no realized FX on foreign collections. |
| C.5 | Advance Payments / Customer Deposits | `MISSING` | MEDIUM | Searched `src/` (`Customer` liability advance account absent) | Cannot record unapplied customer advances as liability (`21xxxx`) prior to invoicing. |
| C.6 | Customer Settlements & Payment Allocation | `MISSING` | **HIGH** | Single optional `invoiceId` on `ReceiptVoucher` | No multi-invoice allocation, partial settlement schedule, or open-item matching screen. |
| C.7 | AR Aging Analysis | `MISSING` | **HIGH** | Searched `src/` (`aging`, `dueDate` on `SalesInvoice` absent!) | `SalesInvoice` doesn't even have a `dueDate` column in `schema.prisma`; zero 0-30 / 31-60 / 61-90 / >90 aging reports. |
| C.8 | Credit Limits Enforcement | `IMPLEMENTED BUT DEFECTIVE` | **HIGH** | `Customer.creditLimit` (`schema.prisma`), `postSalesInvoice` (`ledgerService.ts`), `POST /api/sales` | Field exists in DB/UI (`CustomersTab.tsx`), **but zero validation** prevents invoicing beyond `creditLimit` + current balance. |
| C.9 | Customer Statements | `IMPLEMENTED BUT DEFECTIVE` | **HIGH** | `CustomersTab.tsx` (`buildCustomerStatementPrintSpec`), `excelExport.ts` | Prints/exports `SaleTransaction` operational rows instead of authoritative GL sub-ledger postings (`ReceiptVoucher`, manual AR JEs, adjustments omitted). |
| C.10 | Bad Debt Provision & Write-Offs | `MISSING` | **HIGH** | Searched `src/` | Zero allowance for doubtful accounts (`ECL` / IFRS 9) or AR write-off workflow. |
| C.11 | Revenue Recognition Schedules | `MISSING` | MEDIUM | Searched `src/` | Point-in-time recognition only; no deferred revenue / performance-obligation schedules (IFRS 15). |

---

## Section D — Accounts Payable (AP)

| ID | Requirement | Status | Severity | Exact Code / Schema Evidence | Audit Finding & Gap Notes |
|---|---|---|---|---|---|
| D.1 | Vendor Master & Gen-6 Sub-ledger | `IMPLEMENTED` | LOW | `Vendor`, `createVendorWithAccountTx`, `/api/procurement/vendors`, `ProcurementTab.tsx` | Auto-provisions `211190xxx` + `CC-VND`; lifecycle archive/safe-delete implemented (route misses `withTenantRoute`). |
| D.2 | Purchase Invoices (Vendor Bills) | `IMPLEMENTED BUT DEFECTIVE` | **HIGH** | `postVendorBill` (`ledgerService.ts` L739), `/api/procurement/bills` | Lacks `VendorBillItem` line items, zero tax columns/postings, `DELETE` hard-deletes unpaid bills (`journalEntry.delete` fallback on error), and `isInventory=true` creates zero `StockMovement`. |
| D.3 | Debit & Credit Notes (AP) | `MISSING` | **HIGH** | Searched `schema.prisma` & `src/` | No purchase return / vendor credit memo document or workflow. |
| D.4 | Payment Vouchers | `IMPLEMENTED BUT DEFECTIVE` | **CRITICAL** | `postVendorPayment` (`ledgerService.ts` L858), `/api/procurement/payments` | Posting works for AP & Treasury, **but `DELETE /api/procurement/payments` fails to restore `TreasuryAccount.balance`/`balanceYER`** and omits realized FX gain/loss. |
| D.5 | Advance Payments / Vendor Deposits | `PARTIALLY IMPLEMENTED` | MEDIUM | `114101` COA exists; no prepayment workflow | Cannot post vendor advance (`DR 114101`) and apply against subsequent `VendorBill`. |
| D.6 | Payment Scheduling & Due Management | `MISSING` | MEDIUM | `VendorBill.dueDate` exists; zero scheduling queries/UI | No due-bill queue, maturity calendar, or cash requirement schedule. |
| D.7 | Three-Way Match (PO ↔ GRN ↔ Bill) | `PARTIALLY IMPLEMENTED` | **HIGH** | `PurchaseOrder`, `GoodsReceipt`, `GET /api/procurement/bills` L40-72, `POST /api/procurement/bills` | `GET` computes `threeWayStatus`, **but `POST /api/procurement/bills` does zero enforcement**—posts bills without GRNs or with huge price/qty variances, and marks PO `POSTED`. |
| D.8 | Vendor Reconciliation & Supplier Statements | `PARTIALLY IMPLEMENTED` | MEDIUM | `/api/procurement/vendors` aggregates `bills` & `payments` | Operational summary only; excludes direct AP GL entries and lacks period statement PDF with GL verification. |
| D.9 | AP Aging | `MISSING` | **HIGH** | Searched `src/` | Zero AP aging report by `dueDate`. |
| D.10 | Withholding Tax (AP) | `MISSING` | **HIGH** | Searched `src/` | Zero WHT calculation or retention on vendor bills/payments. |
| D.11 | Duplicate Invoice Detection | `PARTIALLY IMPLEMENTED` | MEDIUM | Client-side `window.confirm` in `ProcurementTab.tsx` / `SalesTab.tsx` | Non-blocking JS alert on same vendor/amount only; no server-side unique `(vendorId, vendorInvoiceNumber)` constraint. |

---

## Section E — Cash & Bank Management

| ID | Requirement | Status | Severity | Exact Code / Schema Evidence | Audit Finding & Gap Notes |
|---|---|---|---|---|---|
| E.1 | Cash Vaults, Banks & Wallets | `IMPLEMENTED BUT DEFECTIVE` | **HIGH** | `TreasuryAccount`, `/api/treasury`, `TreasuryTab.tsx` | Good multi-type & Gen-6 linking, **but `TreasuryTab.tsx` L432 calls nonexistent `/api/records/lifecycle` (404)** on Archive/Restore/Delete, and route omits `withTenantRoute`. |
| E.2 | Cash Receipts & Payments | `IMPLEMENTED BUT DEFECTIVE` | **CRITICAL** | `postOperatingExpenseJournalTx` (L1238), `postWorkerWageJournalTx` (L1314), `/api/audit/adjustments`, `/api/installments`, `/api/treasury/webhook/[provider]` | Cash receipts/payments via Customer/Vendor work, **but Operating Expenses, Worker Wages (initial payout), Audit Adjustments, Deleted Payments, and Inbound Webhooks cause GL vs `TreasuryAccount` drift**. |
| E.3 | Bank / Treasury Transfers | `IMPLEMENTED` | LOW | `transferBetweenTreasuries` (`ledgerService.ts`), `POST /api/treasury/transfer` | Handles same-currency & FX transfers with transfer fees atomically (misses `withTenantRoute`). |
| E.4 | Cheque & Post-Dated Cheque (PDC) Management | `MISSING` | **HIGH** | Searched `schema.prisma` & `src/` | Zero cheque book register, cheque numbers, clearing dates, bounced cheque handling, or PDC holding accounts. |
| E.5 | Bank Reconciliation & Statement Import | `PARTIALLY IMPLEMENTED` | **HIGH** | `/api/treasury/reconcile`, `/api/treasury/reconcile-import`, `autoReconcileStatementRows` (`bankWalletGateway.ts`) | Supports GL line check-off and XLSX/CSV matching in memory/API response, **but doesn't persist Bank Statement records, outstanding reconciling items, or formal Bank Reconciliation Statements**. |
| E.6 | Cash Flow & Cash Forecasting | `MISSING` | **HIGH** | Searched `src/` | Zero IAS 7 Cash Flow Statement and zero forward cash-flow projection. |
| E.7 | Petty Cash Management | `MISSING` | MEDIUM | Searched `src/` | No custodian imprest float limit, replenishment voucher, or field petty-cash liquidation workflow. |
| E.8 | Bank/Wallet API Gateway & Webhooks | `IMPLEMENTED BUT DEFECTIVE` | **CRITICAL** | `bankWalletGateway.ts`, `/api/treasury/dispatch`, `/api/treasury/webhook/[provider]` | Gateway bypasses `postJournalEntry()`, queries arbitrary `findFirst` vendor/worker account (`211190`/`212190`), uses fake `sha256Hash: "HASH-..."`; inbound webhook ignores `signatureHeader`, skips GL posting, and never settles invoices; dispatch route defaults actor to `SUPER_ADMIN`. |

---

## Section F — Multi-Currency Management

| ID | Requirement | Status | Severity | Exact Code / Schema Evidence | Audit Finding & Gap Notes |
|---|---|---|---|---|---|
| F.1 | Multi-Currency & Rate Tables | `IMPLEMENTED` | LOW | `Currency`, `ExchangeRate`, `CurrencyRate`, `/api/accounting/currencies`, `/api/accounting/exchange-rates` | Supports base YER + SAR/USD/AED/OMR + custom currencies & buy/sell/mid rates (misses `withTenantRoute` & `authorizeApiAction`). |
| F.2 | Base, Functional & Presentation Currency | `PARTIALLY IMPLEMENTED` | MEDIUM | `baseDebit`/`baseCredit` (YER), `formatCurrencyVal` (`formulas.ts`) | Functional base currency fixed to `"YER"`; presentation currency conversion in reports is client display scaling on operational tabs only, not IAS 21 financial statement translation. |
| F.3 | Historical & Transaction-Specific Exchange Rates | `IMPLEMENTED BUT DEFECTIVE` | **HIGH** | `postJournalEntry`, `updateJournalEntry`, `VendorBill`/`SalesInvoice` schemas | `postJournalEntry` resolves line rate properly, **but** `updateJournalEntry` fails to update `foreign*`/`base*`/`currencyCode`, and `VendorBill`/`SalesInvoice` schemas store unused `Float` FX fields left at `1.0`/`0`. |
| F.4 | Foreign Balance Revaluation (Unrealized FX) | `IMPLEMENTED BUT DEFECTIVE` | **CRITICAL** | `POST /api/accounting/fx-revaluation`, `computeUnrealizedFxRevaluation` (`multiCurrencyEngine.ts` L266) | **Double-Posting Bug**: queries lines with `currencyCode: { not: "YER" }`, posts adjustment lines with `currencyCode: "YER"` -> re-running posts duplicate adjustments! No `authorizeApiAction`, no closed-FY check, auto-creates COA accounts without `parentId`. |
| F.5 | Realized Exchange Gain/Loss | `IMPLEMENTED BUT DEFECTIVE` | **HIGH** | `computeRealizedFxGainLoss` (`multiCurrencyEngine.ts` L215) vs `postVendorPayment`/`postCustomerReceipt` | Pure calculation helper exists and passes unit tests, **but is NEVER called** by AP/AR settlement posting functions! |
| F.6 | Currency Rounding & Translation | `PARTIALLY IMPLEMENTED` | **HIGH** | `balanceDualCurrencyLines` (`multiCurrencyEngine.ts` L102) | Helper exists, **never wired** into `postJournalEntry()` or report generation. |

---

## Section G — Fixed Assets Management

| ID | Requirement | Status | Severity | Exact Code / Schema Evidence | Audit Finding & Gap Notes |
|---|---|---|---|---|---|
| G.1–G.14 | Asset Register, Categories, Acquisition, Capitalization, Depreciation Methods/Posting, Transfer, Disposal, Revaluation, Impairment, Maintenance, Components, History, Reporting | `MISSING` | **HIGH** | Searched entire `prisma/schema.prisma` and `src/` (`depreciat|amortiz|FixedAsset|impairment` -> 0 matches) | Completely absent across DB, services, APIs, and UI. (Entity nature note: Agricultural farms/enterprises typically hold land improvements, wells/pumps, greenhouses, vehicles, equipment—only placeholder COA codes exist in `coaCatalog.ts`). |

---

## Section H — Cost & Management Accounting

| ID | Requirement | Status | Severity | Exact Code / Schema Evidence | Audit Finding & Gap Notes |
|---|---|---|---|---|---|
| H.1 | Cost Centers & Analytical Hierarchy | `IMPLEMENTED` | LOW | `CostCenter` (`schema.prisma`), `accountingCoreEngine.ts`, `/api/accounting/cost-centers` | 6-Gen hierarchy (`FARM`, `HOUSE`, `WELL`, `PROJECT`, `WAREHOUSE`, `DEPARTMENT`, `VEHICLE`, `OTHER`) + automatic entity linking. |
| H.2 | Profit Centers & Project / SubProject Profitability | `IMPLEMENTED BUT DEFECTIVE` | **HIGH** | `costCenterProfitAndLoss` (`accountingCoreEngine.ts` L461), `generateFinancialReports` (`ledgerService.ts`) | `reverseJournalEntry` drops `costCenterId`, and `costCenterProfitAndLoss` fails to exclude `YEAR_END_CLOSING` rows, zeroing closed-year cost center results! |
| H.3 | Cost Allocation, Indirect Costs & Overhead Distribution | `MISSING` | **HIGH** | Searched `src/` | No automated overhead distribution rules across farms/projects/cost centers. |
| H.4 | Product / Service / Manufacturing / Standard Costing | `MISSING` | MEDIUM | Searched `src/` | No BOM, production orders, standard vs actual cost variances, or agricultural biological asset costing (IAS 41). Only WAC average inventory calculation exists standalone. |

---

## Section I — Budgeting & Financial Planning

| ID | Requirement | Status | Severity | Exact Code / Schema Evidence | Audit Finding & Gap Notes |
|---|---|---|---|---|---|
| I.1 | Project & Sub-Project Budgets + Actual vs Budget Variance | `IMPLEMENTED` | MEDIUM | `Project.budgetTotal`, `SubProject.budget`, `generateFinancialReports` (`ledgerService.ts` L1941-2026), `FinancialReportsTab.tsx` L832 | Displays project/sub-project budget vs actual cost & utilization %. |
| I.2 | Annual, Department, Branch, Cost-Center, Account Budgets | `MISSING` | **HIGH** | Searched `schema.prisma` | No `Budget` or `BudgetLine` tables by COA account, fiscal period, department, or cost center. |
| I.3 | Budget Approval, Revision, Control & Alerts | `MISSING` | **HIGH** | Searched `src/` | Over-budget flag is visual only; zero pre-posting budget availability enforcement, commitment/encumbrance tracking, or alerts. |
| I.4 | Financial & Rolling Forecasts | `MISSING` | MEDIUM | Searched `src/` | Absent. |

---

## Section J — Tax Management

| ID | Requirement | Status | Severity | Exact Code / Schema Evidence | Audit Finding & Gap Notes |
|---|---|---|---|---|---|
| J.1–J.11 | Tax Configuration, VAT, WHT, Sales/Purchase Tax, Exemptions, Effective Dates, Tax Calc, Reconciliation, Returns, Reports, Tax Audit Trail | `IMPLEMENTED BUT DEFECTIVE` / `MISSING` | **HIGH** | `PurchaseOrder.taxTotal` (`/api/procurement/pos`), `DEFAULT_CONTROL_ACCOUNTS` (`accountingSettings.ts` L61-62), `documentExtractionEngine.ts` L242 | Essentially **MISSING**: no tax rate catalog, zero tax calculation/GL posting in invoices, bills, expenses, or sales; `taxPayableAccount` (`212101`) maps to Labor Payables and `taxReceivableAccount` (`114101`) maps to Vendor Advances; zero tax reports/filings. |

---

## Section K — Financial Closing & Fiscal Year Management

| ID | Requirement | Status | Severity | Exact Code / Schema Evidence | Audit Finding & Gap Notes |
|---|---|---|---|---|---|
| K.1 | Fiscal Year Setup & Year-End Closing / Rollover | `IMPLEMENTED BUT DEFECTIVE` | **CRITICAL** | `fiscalYearClosingEngine.ts` (`runFiscalYearPrecheck`, `executeFiscalYearCloseAndRollover`), `/api/accounting/fiscal-years/*` | Precheck blocks closing on pending docs and atomically creates `YEAR_END_CLOSING` + next-year `OPENING` entries, **but**: (a) closed-year P&L in reports reads `YEAR_END_CLOSING` entries making closed-year revenue/expense 0; (b) `/api/accounting/fiscal-years/*` lacks `withTenantRoute`; (c) `precheck` endpoint lacks auth guard. |
| K.2 | Accounting Periods (Month-End Open/Close) | `MISSING` | **HIGH** | Only `FiscalYear` + global `SystemSettings.periodLockDate` + `HarvestCycle.isLocked` | No monthly/quarterly `AccountingPeriod` table allowing staged soft-close/reopen per month & module. |
| K.3 | Period Lock Enforcement (`periodLockDate`) | `IMPLEMENTED BUT DEFECTIVE` | **CRITICAL** | `assertNotInLockedPeriod` (`accountingSettings.ts` L161) called ONLY in `fx-revaluation` & `syncEngine` | `postJournalEntry`, `updateJournalEntry`, `postVendorBill`, `postSalesInvoice`, `POST /api/expenses`, `POST /api/workers`, and `POST /api/sales` **NEVER check `periodLockDate`**! |
| K.4 | Pre-Close Depreciation / Inventory Reconcile / Post-Closing TB / Prior-Period Adjustments (IAS 8) | `MISSING` | **HIGH** | Searched `fiscalYearClosingEngine.ts` & `src/` | No pre-close inventory sub-ledger-to-GL tie-out, no depreciation run check, no "exclude closing entries" toggle on Income Statement vs Post-Closing Trial Balance. |

---

## Section L — Financial Statements & Reporting

| ID | Requirement | Status | Severity | Exact Code / Schema Evidence | Audit Finding & Gap Notes |
|---|---|---|---|---|---|
| L.1 | Trial Balance | `IMPLEMENTED BUT DEFECTIVE` | **CRITICAL** | `generateFinancialReports` (`ledgerService.ts` L1879) | Distorted by reversed/voided entries & cross-year unfiltered cumulative + opening entry overlap. |
| L.2 | Balance Sheet | `IMPLEMENTED BUT DEFECTIVE` | **CRITICAL** | `generateFinancialReports` (`ledgerService.ts` L1850-1869, L2028-2039) | **CRITICAL BUG**: Filters asset/liability/equity lines by `fromDate..toDate` period instead of cumulative `<= toDate`! |
| L.3 | Income Statement | `IMPLEMENTED BUT DEFECTIVE` | **CRITICAL** | `generateFinancialReports` (`ledgerService.ts` L1910-1929) | Shows 0 for closed fiscal years because `buildPostedLineWhere` includes `YEAR_END_CLOSING` entries; also skewed by reversed/voided entries. |
| L.4 | Cash Flow Statement (IAS 7) | `MISSING` | **CRITICAL** | Searched `src/` (only string header in `uasAgentTools.ts` L2155) | Absent (no Direct or Indirect Operating/Investing/Financing Cash Flow Statement). |
| L.5 | Statement of Changes in Equity & Notes | `MISSING` | **HIGH** | Searched `src/` | Absent. |
| L.6 | AR / AP / Aging / Tax / Fixed Assets / Ratios / Comparative Statements | `MISSING` | **HIGH** | Searched `src/`, `FinancialReportsTab.tsx` | All absent from backend & UI. |
| L.7 | Cost Accounting & Budget vs Actual Reports | `IMPLEMENTED BUT DEFECTIVE` | **HIGH** | `FinancialReportsTab.tsx`, `costCenterProfitAndLoss` | Exists, subject to `costCenterId` drop on reversals & `YEAR_END_CLOSING` inclusion. |
| L.8 | Drill-Down to Source Documents | `MISSING` | **HIGH** | `FinancialReportsTab.tsx` | Report tables display aggregated lines only; clicking rows does not drill into `JournalEntry` or source vouchers. |
| L.9 | Excel & PDF Print Export | `IMPLEMENTED` | LOW | [excelExport.ts](file:///e:/2026/uas-accounting-system/src/lib/excelExport.ts), [uasDocumentPrinter.ts](file:///e:/2026/uas-accounting-system/src/lib/print/uasDocumentPrinter.ts) | Pure light-mode A4/Thermal print layout & RTL Excel export with formulas; exports reflect upstream report defects. |

---

## Section M — Financial Consolidation & Multi-Company

| ID | Requirement | Status | Severity | Exact Code / Schema Evidence | Audit Finding & Gap Notes |
|---|---|---|---|---|---|
| M.1–M.9 | Multi-Company Consolidation, Intercompany Transactions/Reconciliation, Eliminations, Group COA, Currency Translation | `MISSING` | MEDIUM | `tenantContext.ts` / `tenantDbManager.ts` provide **SaaS Tenant Isolation**, NOT financial consolidation | Separate tenants are isolated databases/schemas; zero inter-entity consolidation or elimination functionality exists. (`MEDIUM` if single-entity enterprise; `HIGH` for holding groups). |

---

## Section N — Internal Control & Financial Governance

| ID | Requirement | Status | Severity | Exact Code / Schema Evidence | Audit Finding & Gap Notes |
|---|---|---|---|---|---|
| N.1 | Server Authentication & Session Validation | `MISSING` | **CRITICAL** | `/api/auth/login` (`login/route.ts`), `extractActor` (`apiHelpers.ts` L33), `system/reset` (`route.ts`), `treasury/dispatch` (`route.ts`) | **No signed cookies, JWT, or server session verification.** Any request can spoof `body.actor` / headers or omit them to execute as `SUPER_ADMIN` (`u1`). Passwords use unsalted SHA-256 (`serverBootstrap.ts` L47). |
| N.2 | Role-Based Access Control (RBAC) | `PARTIALLY IMPLEMENTED` | **CRITICAL** | `permissions.ts`, `authorizeApiAction` (`apiHelpers.ts`) vs 90 API routes | Rich role/granular permission matrix exists, **but 29 routes use spoofable `extractActor` without `authorizeApiAction` and 25 routes lack both** (including `fx-revaluation`, `audit/adjustments`, `audit/lock`, `system/reset`, `system/lifecycle`, `treasury/dispatch`, `treasury/webhook/*`). |
| N.3 | Approval Workflows & Maker-Checker | `IMPLEMENTED BUT DEFECTIVE` | **CRITICAL** | `approvalEngine.ts`, `workspaceDraftsEngine.ts`, `agentServerExecutor.ts` | Well-built approval state machine with self-approval blocks, **but bypassed by all standard accounting/procurement/sales/expense/worker REST routes**; draft promote fails to create `ApprovalRequest`. |
| N.4 | Immutability, Audit Trail & Reversal Controls | `IMPLEMENTED BUT DEFECTIVE` | **CRITICAL** | `updateJournalEntry`, `DELETE` routes, `ImmutableAuditLog` | In-place mutation of `POSTED` JEs, hard deletes on transactional tables, non-chained row hashes (no `prevHash`), `webhook` has `executedById: "webhook"` without signature verification. |
| N.5 | Duplicate Prevention & Idempotency | `PARTIALLY IMPLEMENTED` | **HIGH** | `idempotencyGuard.ts` | Idempotency implemented well on **17 / 90** routes; missing on critical mutating routes like `fx-revaluation`, `audit/adjustments`, `treasury/transfer`, `treasury/reconcile-import`, `procurement/payments`. |

---

## Section O — Accounting Standards Compliance (Summary Matrix)

*(Detailed standard-by-standard breakdown in [09-Accounting-Standards-Compliance.md](file:///e:/2026/uas-accounting-system/docs/accounting-audit/09-Accounting-Standards-Compliance.md))*

| Standard | Status | Summary Basis |
|---|---|---|
| **IAS 1** (Presentation) | `IMPLEMENTED BUT DEFECTIVE` | BS period filter bug, missing Cash Flow & Equity Statement, missing Notes, no Current/Non-Current subtotals, no Comparatives. |
| **IAS 2** (Inventories) | `IMPLEMENTED BUT DEFECTIVE` | WAC exists standalone, **but** zero GL inventory accounting, zero COGS recognition on sales, zero NRV/lower-of-cost write-downs, FIFO non-functional. |
| **IAS 7** (Cash Flows) | `MISSING` | Statement of Cash Flows does not exist. |
| **IAS 8** (Policies & Errors) | `IMPLEMENTED BUT DEFECTIVE` | Allows silent in-place mutation of posted entries & hard deletes instead of prospective/retrospective restatement logs. |
| **IAS 10** (Events After Period) | `PARTIALLY IMPLEMENTED` | `periodLockDate` / `FiscalYear` closing exist conceptually, **but** `periodLockDate` is not enforced in `postJournalEntry`. |
| **IAS 12** (Income Taxes) | `MISSING` | Current & deferred income tax accounting absent. |
| **IAS 16** (PP&E) | `MISSING` | Fixed assets, capitalization, depreciation, and disposal absent. |
| **IAS 19** (Employee Benefits) | `PARTIALLY IMPLEMENTED` | Daily wage accrual/payment only (`WorkerWageEntry`); no monthly payroll, EOSB, leave accruals, or deductions. |
| **IAS 21** (Foreign Exchange) | `IMPLEMENTED BUT DEFECTIVE` | Multi-currency rates exist, **but** Realized FX unused, Unrealized FX double-posts on repeat runs, no statement translation. |
| **IAS 36** (Impairment) | `MISSING` | Zero asset impairment or CGU testing. |
| **IAS 37** (Provisions) | `MISSING` | No provisions, contingencies, or bad-debt reserves. |
| **IFRS 9** (Financial Instruments) | `MISSING` / `PARTIALLY IMPLEMENTED` | Zero Expected Credit Loss (`ECL`) provisioning on receivables or fair-value/amortized-cost instruments. |
| **IFRS 15** (Revenue) | `PARTIALLY IMPLEMENTED` | Point-in-time invoice posting exists; lacks returns/credit notes, variable consideration, contract liabilities/advances, or sales COGS matching. |
| **IFRS 16** (Leases) | `MISSING` | Agricultural lease/acquisition cycles (`ProjectAcquisitionCycle`) are treated as immediate AP bills/expenses with zero Right-of-Use asset / Lease Liability discounting. |

---

## Section P — ERP Financial Integration Matrix

*(Detailed end-to-end flow audit in [06-Financial-Integration-Audit.md](file:///e:/2026/uas-accounting-system/docs/accounting-audit/06-Financial-Integration-Audit.md))*

| Process Area | Integration Status | Critical Defect / Disconnection |
|---|---|---|
| Sales (`POST /api/sales`, `/invoices`, `/receipts`) | `IMPLEMENTED BUT DEFECTIVE` | Redundant receipt+installment creation; broken `DELETE /api/sales/[id]`; no Stock deduction or COGS GL; `creditLimit` ignored. |
| Purchasing (`PO`, `GRN`, `VendorBill`, `Payment`) | `IMPLEMENTED BUT DEFECTIVE` | 3-way match ignored on bill posting; `isInventory` bill creates zero `StockMovement`; `DELETE /payments` omits `TreasuryAccount` restore; no WHT/VAT/Realized FX. |
| Inventory & Warehouse Operations | `MISSING` (GL Link) | `StockMovement` creates zero GL entries; `InventoryItem.*AccountId` unused; FIFO absent; Android offline skips stock math. |
| Payroll / Labor (`Workers`) | `IMPLEMENTED BUT DEFECTIVE` | Accrual/payout GL works, **but** cash payout (`creditAmount > 0`) credits `111101` **without deducting `TreasuryAccount.balance`**. |
| Operating Expenses | `IMPLEMENTED BUT DEFECTIVE` | Credits `111101` / treasury COA **without deducting `TreasuryAccount.balance`**. |
| Projects & Acquisitions | `PARTIALLY IMPLEMENTED` | Acquisition bills post GL; unit-level reset (`scopedResetEngine`) deletes GL lines asymmetrically. |
| Banking & Webhooks | `IMPLEMENTED BUT DEFECTIVE` | `executeBankOrWalletPayout` bypasses `postJournalEntry`; inbound webhooks lack signature verification, skip GL, and fail to settle AR invoices. |
| Tax Management | `MISSING` | Zero tax postings across any ERP module. |
