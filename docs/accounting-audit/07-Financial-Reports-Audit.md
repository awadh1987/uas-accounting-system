# 07 — Financial Reports Audit

This report audits every financial statement, managerial report, and export output produced by UAS Enterprise ([ledgerService.ts](file:///e:/2026/uas-accounting-system/src/lib/accounting/ledgerService.ts), [accountingCoreEngine.ts](file:///e:/2026/uas-accounting-system/src/lib/accountingCoreEngine.ts), [FinancialReportsTab.tsx](file:///e:/2026/uas-accounting-system/src/components/FinancialReportsTab.tsx), [CustomersTab.tsx](file:///e:/2026/uas-accounting-system/src/components/tabs/CustomersTab.tsx), [excelExport.ts](file:///e:/2026/uas-accounting-system/src/lib/excelExport.ts), [uasDocumentPrinter.ts](file:///e:/2026/uas-accounting-system/src/lib/print/uasDocumentPrinter.ts), and [offlineAndroidStore.ts](file:///e:/2026/uas-accounting-system/src/lib/offlineAndroidStore.ts)).

---

## 1. Accuracy & Integrity Assessment of Existing Reports

| Report / Output | Source / API Route | Reported Result Reliability | Proven Bugs & Accounting Violations |
|---|---|---|---|
| **Trial Balance (Gen 1–6)** | `generateFinancialReports()` ([ledgerService.ts:L1879-1909](file:///e:/2026/uas-accounting-system/src/lib/accounting/ledgerService.ts#L1879-L1909)), `/api/accounting/reports/trial-balance` | **UNRELIABLE (`CRITICAL`)** | 1. **Double-Inversion Reversal Bug**: Excludes `VOIDED` original entries while counting `POSTED` reversal entries (`L1865`), introducing inverted ghost balances.<br>2. **Opening Rollover Double-Count**: When queried without `fromDate` across >1 fiscal year, sums Year 1 ending transactions + Year 2 `OPENING` carry-forward entry (`executeFiscalYearCloseAndRollover`).<br>3. **No Opening / Movement / Ending Columns**: Only shows cumulative `totalDebit`/`totalCredit` and `netDebit`/`netCredit`.<br>4. **No `withTenantRoute` or Auth Guard**: Reads default DB across tenants. |
| **Income Statement (P&L)** | `generateFinancialReports()` (`L1910-1929`), `/api/accounting/reports/income-statement` | **UNRELIABLE (`CRITICAL`)** | 1. **Closed Fiscal Year Zeroing Bug**: `buildPostedLineWhere` does NOT exclude `entryType: "YEAR_END_CLOSING"`. After closing FY-2026 into Retained Earnings, generating FY-2026 Income Statement yields **Revenue = 0, Expenses = 0, Net Profit = 0**.<br>2. **Zero COGS Integration**: Inventory sales post zero COGS; direct wages/expenses show in `51xxxx`, skewing gross margin.<br>3. **Duplicate FX Revaluation Inflation & Voided Reversal Ghost Entries** directly pollute net profit.<br>4. **Missing Comparative Columns** (Prior Period / Budget variance on GL accounts). |
| **Balance Sheet (Statement of Financial Position)** | `generateFinancialReports()` (`L2028-2039`), `/api/accounting/reports/balance-sheet` | **MATHEMATICALLY INVALID UNDER DATE FILTERS (`CRITICAL`)** | 1. **Period Range Filter Instead of As-Of Cumulative Balance**: Passes `fromDate..toDate` into `buildPostedLineWhere` (`L1867`). Any report filtered by month/quarter (e.g., `fromDate=2026-11-01&toDate=2026-11-30`) **discards all cumulative Asset/Liability/Equity balances prior to `fromDate`**! Even worse, adding `currentYearNetProfit` (which is period P&L) still misstates Retained Earnings and permanent accounts.<br>2. **Unfiltered Multi-Year Double Count** when `fromDate` omitted after rollover.<br>3. **No Current vs Non-Current Classification Totals** (IAS 1) and no Asset Inventory / Cash / AP accuracy due to integration defects. |
| **Project & SubProject Budget vs Actual** | `generateFinancialReports()` (`L1930-2026`), `FinancialReportsTab.tsx` L832-952 | **PARTIALLY RELIABLE (`HIGH`)** | Uses GL lines filtered by `projectId`/`subProjectId`, **so it inherits closed-year `YEAR_END_CLOSING` zeroing & `VOIDED` reversal corruption**, plus scoped unit reset line deletions. |
| **Cost Center Profit & Loss** | `costCenterProfitAndLoss()` ([accountingCoreEngine.ts:L461-504](file:///e:/2026/uas-accounting-system/src/lib/accountingCoreEngine.ts#L461-L504)), `/api/accounting/reports/cost-centers` | **DEFECTIVE (`HIGH`)** | 1. Does NOT filter `documentStatus: "POSTED"` (only `journalEntry: { status: "POSTED" }`, missing document-status gating) and does NOT exclude `YEAR_END_CLOSING` entries.<br>2. Reversals created by `reverseJournalEntry` drop `costCenterId`, leaving reversed amounts in `Unassigned` (`__none__`) instead of offsetting the cost center! |
| **Customer Account Statement** | [CustomersTab.tsx](file:///e:/2026/uas-accounting-system/src/components/tabs/CustomersTab.tsx) (`buildCustomerStatementPrintSpec`), `excelExport.ts` | **DEFECTIVE (`HIGH`)** | Reads `state.sales` (`SaleTransaction`) operational records—omits `SalesInvoice`/`ReceiptVoucher` posted directly in AR, omits manual journal adjustments to customer Gen-6 `112190xxx`, and diverges after partial deletes/updates. |
| **Excel Workbook & PDF Print Engine** | `exportFinancialStatementsToExcel` ([excelExport.ts:L350-476](file:///e:/2026/uas-accounting-system/src/lib/excelExport.ts#L350-L476)), [uasDocumentPrinter.ts](file:///e:/2026/uas-accounting-system/src/lib/print/uasDocumentPrinter.ts) | **PRESENTATION SOUND / DATA TAINTED** | Technical export formatting (RTL Excel, A4/Thermal light-mode HTML, `<bdi>` isolation, signatures, QR hashes) is solid, **but exports the flawed numbers from `generateFinancialReports()`**. |
| **Android Offline Mode Reports** | [offlineAndroidStore.ts:L2609-2615](file:///e:/2026/uas-accounting-system/src/lib/offlineAndroidStore.ts#L2609-L2615) | **NON-FUNCTIONAL STUBS (`CRITICAL`)** | `/api/accounting/reports/cost-centers` and `/api/accounting/reports/*` return hardcoded empty `{ rows: [], totals: ... 0 }` on Android local mode! |

---

## 2. Traceability & Drill-Down Audit

- **Transaction → GL Traceability**: Invoices, Bills, Payments, Receipts, Sales, Expenses, Wages store `journalEntryId` (note: Worker Wage with `creditAmount > 0` creates a second `WORKER_PAYOUT` JE whose ID is not stored in `WorkerWageEntry.journalEntryId`, though `sourceId` references `wageEntry.id`).
- **Report → Transaction Drill-Down (`MISSING`)**: Inspecting [FinancialReportsTab.tsx](file:///e:/2026/uas-accounting-system/src/components/FinancialReportsTab.tsx) shows table rows for Trial Balance, Income Statement, Balance Sheet, and Budget vs Actual contain **zero click handlers / links** to filter `GeneralLedgerTab` by account or inspect underlying `JournalEntry` lines or source invoices/vouchers.
- **Tenant & Auth Exposure on All 4 Report APIs**:
  - [/api/accounting/reports/trial-balance/route.ts](file:///e:/2026/uas-accounting-system/src/app/api/accounting/reports/trial-balance/route.ts)
  - [/api/accounting/reports/income-statement/route.ts](file:///e:/2026/uas-accounting-system/src/app/api/accounting/reports/income-statement/route.ts)
  - [/api/accounting/reports/balance-sheet/route.ts](file:///e:/2026/uas-accounting-system/src/app/api/accounting/reports/balance-sheet/route.ts)
  - [/api/accounting/reports/cost-centers/route.ts](file:///e:/2026/uas-accounting-system/src/app/api/accounting/reports/cost-centers/route.ts)
  **All 4 routes** have `withTenantRoute = False`, `authorizeApiAction = False`, and `extractActor = False`. Anyone on the internet can hit `GET /api/accounting/reports/trial-balance` without authentication and retrieve default tenant financial statements.

---

## 3. Missing Financial Reports Checklist (Section 4.L)

The following required reports are completely absent from `ledgerService.ts`, API routes, and `FinancialReportsTab.tsx`:
1. Cash Flow Statement (IAS 7 — Operating / Investing / Financing)
2. Statement of Changes in Equity
3. Notes to Financial Statements
4. AR Aging & AP Aging Schedules (`0-30`, `31-60`, `61-90`, `>90` days)
5. Formal Bank Reconciliation Statements (Book vs Bank Balance + Reconciling Items)
6. Inventory Valuation & Movement Summary Tied to GL (`113xxx`)
7. Fixed Assets Register & Depreciation Schedule Reports
8. VAT / Tax Return & Withholding Tax Summary Reports
9. Financial Ratios Dashboard (Current Ratio, Quick Ratio, DSO, DPO, Net/Gross Margin)
10. Comparative Multi-Period Financial Statements (Current vs Prior Year / Month)
11. GL Account Ledger Running Balance Statement (`Opening + DR - CR = Ending`)
