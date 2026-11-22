# 04 — Missing Features Report

This report identifies every core capability expected in a professional, enterprise-grade accounting / ERP system that is **completely missing** or **present only as non-functional config/UI scaffolding** in UAS Enterprise, along with business, compliance, and control impacts.

---

## 1. Missing Statutory Statements & Core Financial Reports (`CRITICAL` / `HIGH`)

1. **Statement of Cash Flows — Direct & Indirect Methods (IAS 7)** (`Status: MISSING`, `Severity: CRITICAL`)  
   - **Evidence**: Zero implementation in `ledgerService.ts`, `/api/accounting/reports/*`, or `FinancialReportsTab.tsx` (only a text title string inside AI Copilot's `uasAgentTools.ts` L2155 for recent treasury vouchers).  
   - **Impact**: Statutory financial reporting under IFRS/IAS 1 requires a Statement of Cash Flows categorizing Operating, Investing, and Financing cash movements; stakeholders cannot reconcile net profit to actual cash liquidity changes.
2. **Statement of Changes in Equity & Financial Statement Notes** (`Status: MISSING`, `Severity: HIGH`)  
   - **Evidence**: Absent from `generateFinancialReports` and reporting UI.  
   - **Impact**: Cannot track capital injections, owner drawings/dividends, retained earnings roll-forward, or mandatory accounting policy/contingency disclosures.
3. **AR & AP Aging Reports (`0-30`, `31-60`, `61-90`, `>90` Days)** (`Status: MISSING`, `Severity: HIGH`)  
   - **Evidence**: `SalesInvoice` lacks even a `dueDate` field in `schema.prisma`; zero aging queries across `src/`.  
   - **Impact**: Management cannot monitor overdue receivables, credit risk exposure, bad-debt provisioning triggers, or vendor payment prioritization.
4. **General Ledger Account Statement (Running Balance) & Report Drill-Down** (`Status: MISSING`, `Severity: HIGH`)  
   - **Evidence**: `GeneralLedgerTab.tsx` lists full journal headers; `FinancialReportsTab.tsx` shows summary rows without drill-down links to constituent journal lines/vouchers; no GL-based sub-ledger reconciliation statements for Customers/Vendors/Workers.  
   - **Impact**: Auditors and accountants cannot click a Trial Balance or P&L line item to inspect underlying postings or print an audited GL account statement with opening balance, running balance, and closing balance.
5. **Comparative Financial Statements & Financial Ratios** (`Status: MISSING`, `Severity: MEDIUM`)  
   - **Evidence**: Reports render a single filter snapshot without Period-vs-Period / YoY comparison columns or liquidity/profitability/leverage ratios.

---

## 2. Missing Core Accounting & ERP Sub-Modules

6. **Fixed Assets Management & Depreciation Engine (IAS 16 / IAS 36)** (`Status: MISSING`, `Severity: HIGH`)  
   - **Evidence**: No database tables (`FixedAsset`, `AssetCategory`, `DepreciationRun`), APIs, or UI beyond placeholder COA codes in `coaCatalog.ts`.  
   - **Impact**: Agricultural/commercial enterprises acquiring equipment, pumps, greenhouses, land improvements, or vehicles must track depreciation, asset transfers, disposals, and impairment outside the system and enter manual JEs.
7. **Tax, VAT & Withholding Tax Engine** (`Status: MISSING` / Non-Functional Scaffolding, `Severity: HIGH`)  
   - **Evidence**: Only `PurchaseOrder.taxTotal` exists in schema (`VendorBill` and `SalesInvoice` lack tax fields), `documentExtractionEngine.ts` parses regex tax hints, and `DEFAULT_CONTROL_ACCOUNTS` maps `taxPayableAccount` to `"212101"` (Labor Payables!) and `taxReceivableAccount` to `"114101"` (Vendor Advances!).  
   - **Impact**: Cannot calculate input/output VAT, withholding tax on contractors/vendors, tax exemptions, or produce tax return reports—exposing entities in tax-regulated jurisdictions to statutory non-compliance.
8. **Cheques & Post-Dated Cheques (PDC) Management** (`Status: MISSING`, `Severity: HIGH`)  
   - **Evidence**: Zero schema/code support for received or issued cheques, maturity dates, bank clearing workflows, or bounced cheque reversals.  
   - **Impact**: Real-world wholesale/agricultural cash collections and supplier settlements using cheques cannot be tracked safely before clearing.
9. **Credit Notes, Debit Notes & Sales/Purchase Returns** (`Status: MISSING`, `Severity: HIGH`)  
   - **Evidence**: No sales return or purchase return document models or workflows; users currently edit or hard-delete invoices/bills instead.  
   - **Impact**: Product returns, post-sale price allowances, and supplier disputes cannot be accounted for transparently without altering/deleting historical documents.
10. **GL-Integrated Inventory Valuation (FIFO, NRV, Returns & Transfers)** (`Status: MISSING` / Disconnected, `Severity: CRITICAL`)  
    - **Evidence**: `SystemSettings.costingMethod = "FIFO"` is UI/config only (`movements/route.ts` implements WAC only without GL); `InventoryLot` table is unused outside reset/backup; zero stock transfer-between-warehouses GL/cost logic or NRV write-down support (IAS 2).
11. **Multi-Invoice Payment Allocation & Advance Deposits** (`Status: MISSING`, `Severity: HIGH`)  
    - **Evidence**: `ReceiptVoucher` and `PaymentVoucher` bind to at most a single nullable `invoiceId`/`billId`; no unapplied credit / advance deposit ledger or allocation matrix.
12. **Recurring Journals, Auto-Reversing Accruals & Suspense Accounts** (`Status: MISSING`, `Severity: MEDIUM`)  
    - **Evidence**: No journal template scheduling (`RecurringJournal`), automatic reversal date for month-end accruals, or suspense/clearing tracking.
13. **Monthly Accounting Periods (`AccountingPeriod`)** (`Status: MISSING`, `Severity: HIGH`)  
    - **Evidence**: Only annual `FiscalYear`, a single global `periodLockDate` string, and agricultural `HarvestCycle.isLocked` exist; no month-by-month open/soft-close/hard-close periods across modules.
14. **Account-Level Budgeting, Revisions & Encumbrance Control** (`Status: MISSING`, `Severity: HIGH`)  
    - **Evidence**: Only single `budgetTotal`/`budget` numbers on `Project`/`SubProject`; zero COA-account/department/period budgets, budget approval/revisions, or hard/warning blocks when expense/PO exceeds budget.
15. **Bad Debt Provision (IFRS 9 ECL) & Write-Offs** (`Status: MISSING`, `Severity: HIGH`)  
    - **Evidence**: Zero doubtful-debt allowance model or write-off approval workflow.
16. **Multi-Company Financial Consolidation & Intercompany Eliminations** (`Status: MISSING`, `Severity: MEDIUM`)  
    - **Evidence**: Separate tenants are strictly siloed operational databases; zero holding-group consolidation, due-to/due-from clearing, or elimination entries exist.

---

## 3. Missing Technical & Security Foundations (Blocking Compliance & Integrity)

17. **Stateful / Cryptographic Server Authentication & Session Management** (`Status: MISSING`, `Severity: CRITICAL`)  
    - **Evidence**: `POST /api/auth/login` returns JSON without setting any signed JWT, session table row, or HTTP-only cookie; API routes rely on unverified client headers/body `actor`.
18. **Database-Level Immutability & Double-Entry Constraints** (`Status: MISSING`, `Severity: HIGH`)  
    - **Evidence**: `migration.sql` and `sqliteInitSql.ts` define zero DB triggers or `CHECK` constraints preventing negative/unbalanced journal entries or post-posting SQL mutations.
19. **Full HR / Payroll Sub-ledger** (`Status: MISSING`, `Severity: MEDIUM`)  
    - **Evidence**: Only daily casual agricultural worker wage tracking (`Worker`, `WorkerWageEntry`); lacks salaried staff contracts, allowances, statutory deductions, overtime rules, and end-of-service indemnity accruals (IAS 19).
20. **Automated Sub-ledger vs GL Reconciliation Suite** (`Status: MISSING`, `Severity: HIGH`)  
    - **Evidence**: No automated tie-out report comparing AR GL (`112100` subtree) vs Customer open balances, AP GL (`211100` subtree) vs Vendor unpaid bills, and Inventory GL (`113xxx`) vs Warehouse Stock Valuation (`StockBalance`).
