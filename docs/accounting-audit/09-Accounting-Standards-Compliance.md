# 09 — Accounting Standards Compliance Audit (IAS & IFRS)

> **Methodology Note (Section 4.O & Section 8):** Presence of an account name or screen does not prove compliance. Each standard below distinguishes **(a) Proven Technical Implementation in Code**, **(b) Gaps & Non-Compliance Defects**, and **(c) Entity-Nature / Specialized Accounting Evaluation**.

---

## Summary Compliance Matrix

| Standard | Subject | Technical Status | Critical Gap / Blocker |
|---|---|---|---|
| **IAS 1** | Presentation of Financial Statements | `IMPLEMENTED BUT DEFECTIVE` | Balance Sheet period filter (`fromDate..toDate`), missing Cash Flow & Equity Statement, missing Notes & comparatives, no current/non-current subtotals. |
| **IAS 2** | Inventories | `IMPLEMENTED BUT DEFECTIVE` | Standalone WAC math only; **zero Inventory-to-GL integration**, zero COGS on sales, FIFO non-functional, no NRV lower-of-cost assessment. |
| **IAS 7** | Statement of Cash Flows | `MISSING` | Completely absent from code, APIs, and UI. |
| **IAS 8** | Accounting Policies, Estimates & Errors | `IMPLEMENTED BUT DEFECTIVE` | `updateJournalEntry()` silently overwrites `POSTED` entries; hard deletes destroy records; no prospective/retrospective restatement support. |
| **IAS 10** | Events After the Reporting Period | `PARTIALLY IMPLEMENTED` | `periodLockDate` & `FiscalYear` exist, **but `periodLockDate` is not checked inside `postJournalEntry()` or sub-ledger posting**. |
| **IAS 12** | Income Taxes | `MISSING` | Zero corporate tax provision or deferred tax asset/liability engine. Requires entity jurisdiction review. |
| **IAS 16** | Property, Plant & Equipment | `MISSING` | Zero fixed asset register, capitalization, depreciation schedules, derecognition, or revaluation beyond COA placeholder names. |
| **IAS 19** | Employee Benefits | `PARTIALLY IMPLEMENTED` | Daily wage accrual & payout (`WorkerWageEntry`), **but** Treasury mismatch on cash payout + absence of salaried payroll, leave/EOSB accruals. |
| **IAS 21** | Effects of Changes in FX Rates | `IMPLEMENTED BUT DEFECTIVE` | Functional base `YER` & rate tables exist, **but Realized FX is unwired**, **Unrealized FX double-posts on re-run**, no translation of foreign operations. |
| **IAS 36** | Impairment of Assets | `MISSING` | Zero asset impairment / CGU recoverable-amount models or write-down journals. |
| **IAS 37** | Provisions, Contingent Liabilities & Assets | `MISSING` | Zero provision recognition, unwinding, or contingent disclosure notes. |
| **IFRS 9** | Financial Instruments (ECL / Impairment) | `MISSING` | Customer receivables carry zero Expected Credit Loss (ECL) allowance or write-off controls; `creditLimit` is unenforced. |
| **IFRS 15** | Revenue from Contracts with Customers | `PARTIALLY IMPLEMENTED` | Basic point-in-time `SalesInvoice` GL recognition; lacks sales returns/credit notes, contract liabilities (customer advances), and COGS matching. |
| **IFRS 16** | Leases | `MISSING` | Agricultural leases/acquisition contracts (`ProjectAcquisitionCycle`) post as immediate `VendorBill` AP obligations—no ROU asset or discounted lease liability. |
| **IAS 41*** | Agriculture (Entity-Specific Evaluation) | `MISSING` / `SPECIALIZED` | UAS targets agricultural farms/harvests (`HarvestCycle`, `HarvestInventoryBatch`), yet measures harvests only in physical `bundles` with zero Fair-Value-Less-Costs-to-Sell or biological bearer-plant accounting. |

---

## Detailed Standard-by-Standard Assessment

### 1. IAS 1 — Presentation of Financial Statements (`IMPLEMENTED BUT DEFECTIVE`)
- **Proven Implementation**: `generateFinancialReports()` produces Trial Balance, Income Statement, and Balance Sheet from `JournalEntryLine`s ([ledgerService.ts:L1879-2083](file:///e:/2026/uas-accounting-system/src/lib/accounting/ledgerService.ts#L1879-L2083)).
- **Non-Compliance**:
  - A complete set of financial statements under IAS 1.10 requires: Balance Sheet, Statement of Profit or Loss, Statement of Changes in Equity (**missing**), Statement of Cash Flows (**missing**), Notes (**missing**), and Comparative Information for the preceding period (**missing**).
  - Balance Sheet mathematically violates IAS 1 point-in-time reporting by filtering lines using `fromDate..toDate` instead of cumulative balance `<= asOfDate`.
  - No explicit Current vs Non-Current Asset/Liability subtotals (only individual COA lines listed).

### 2. IAS 2 — Inventories (`IMPLEMENTED BUT DEFECTIVE`)
- **Proven Implementation**: `multiUnitInventoryEngine.ts` computes Weighted Average Cost (`computeWeightedAverageCost`), enforces `convertToBaseQty`, and checks negative-stock policy; `InventoryTab` tracks agricultural `HarvestInventoryBatch` bundles/shrinkage.
- **Non-Compliance**:
  - Zero synchronization between physical warehouse inventory (`StockBalance`, `StockMovement`) and GL Inventory Asset (`113xxx`) or COGS (`51xxxx`).
  - Sales do not recognize Cost of Goods Sold simultaneously with Revenue (violating matching & IAS 2.34).
  - Configured `costingMethod: "FIFO"` is unimplemented in runtime code.
  - Zero Net Realizable Value (NRV) lower-of-cost write-down support (IAS 2.9, IAS 2.34) or agricultural inventory cost absorption from direct farm expenses/wages.

### 3. IAS 7 — Statement of Cash Flows (`MISSING`)
- **Finding**: No Direct or Indirect Cash Flow Statement exists in backend or frontend. Existing `TreasuryTransaction` and `JournalEntry` rows are not classified into Operating, Investing, and Financing activities.

### 4. IAS 8 — Accounting Policies, Changes in Accounting Estimates and Errors (`IMPLEMENTED BUT DEFECTIVE`)
- **Finding**: IAS 8 mandates transparent correction/disclosure of prior-period errors and controlled changes in accounting policies. UAS permits silent in-place line replacement on `POSTED` entries via `updateJournalEntry()` (`ledgerService.ts:L2780`) with no line-level diff log, plus physical `DELETE` endpoints for bills, payments, sales, expenses, workers, and installments.

### 5. IAS 10 — Events After the Reporting Period (`PARTIALLY IMPLEMENTED`)
- **Finding**: Year-end close enforces `FiscalYear.status === "CLOSED"` inside `postJournalEntry()`, **but** `periodLockDate` is omitted from `postJournalEntry()`, `updateJournalEntry()`, and operational vouchers, and closed-year `YEAR_END_CLOSING` entries corrupt historical Income Statement reporting.

### 6. IAS 12 — Income Taxes (`MISSING` — Entity Evaluation Needed)
- **Finding**: Zero income tax expense, current tax payable accrual, tax loss carryforward, or deferred tax temporary difference tracking exists. Applicability depends on legal jurisdiction and tax status of the agricultural/commercial entity.

### 7. IAS 16 — Property, Plant & Equipment (`MISSING`)
- **Finding**: Even though `coaCatalog.ts` lists fixed asset nodes (`121xxx`), zero Fixed Asset Registry, capitalization threshold/pipeline, useful life, depreciation engine (Straight-Line / Declining Balance), or disposal gain/loss posting exists. Requires specialized engineering and accounting evaluation if farms own wells, solar pumps, greenhouses, machinery, or vehicles.

### 8. IAS 19 — Employee Benefits (`PARTIALLY IMPLEMENTED`)
- **Proven Implementation**: `Worker` + `WorkerWageEntry` posts daily wage accrual (`DR Direct Labor 511101 / CR Worker Payable 212190xxx`) and cash payout (`DR Worker / CR 111101`).
- **Gaps**: Cash payout fails to update `TreasuryAccount`; `DELETE /api/workers/[id]` orphans the `WORKER_PAYOUT` JE when deleting an entry with `creditAmount > 0`; zero support for monthly salaried payroll, compensated absences/annual leave accruals, or End-of-Service Benefits (EOSB).

### 9. IAS 21 — Effects of Changes in Foreign Exchange Rates (`IMPLEMENTED BUT DEFECTIVE`)
- **Proven Implementation**: Dual base/foreign columns on `JournalEntryLine`, rate history (`ExchangeRate`), helper functions for realized/unrealized FX (`multiCurrencyEngine.ts`).
- **Non-Compliance**:
  - **IAS 21.28 (Settlement Differences)**: `computeRealizedFxGainLoss()` is never wired into `postVendorPayment()` or `postCustomerReceipt()`, omitting mandatory P&L recognition of FX differences on settlement.
  - **IAS 21.23 (Period-End Re-measurement)**: `POST /api/accounting/fx-revaluation` posts adjustment lines as `currencyCode: "YER"` while querying `currencyCode: { not: "YER" }`—double-posting identical gains/losses if run twice instead of evaluating cumulative base vs closing spot rate (`L17-77, 194-196`).
  - Functional currency hardcoded as `"YER"` with no multi-currency subsidiary translation (IAS 21.39).

### 10. IAS 36 (Impairment), IAS 37 (Provisions) & IFRS 9 (ECL) (`MISSING`)
- **Finding**: Zero receivable Expected Credit Loss (`ECL`) lifetime staging or bad-debt allowance (IFRS 9.5.5); zero asset impairment tests (IAS 36); zero litigation/warranty/onerous-contract provisions (IAS 37).

### 11. IFRS 15 — Revenue from Contracts with Customers (`PARTIALLY IMPLEMENTED`)
- **Proven Implementation**: Records point-in-time invoice receivable (`DR AR / CR Revenue`).
- **Gaps**: No customer advance contract liabilities (IFRS 15.106), no sales returns/credit notes / refund liabilities (IFRS 15.55), and `POST /api/sales` hardcodes `"YER"` while omitting COGS recognition.

### 12. IFRS 16 — Leases & Specialized Agricultural Evaluation (`IAS 41`)
- **IFRS 16 (`MISSING`)**: `ProjectAcquisitionCycle` manages seasonal farm/plot acquisition contracts by generating direct `VendorBill` liabilities (`generateAcquisitionBill`), without evaluating whether multi-year land/greenhouse/equipment leases meet IFRS 16 Right-of-Use Asset + Discounted Lease Liability capitalization criteria (short-term <12-month leases may qualify for exemption under IFRS 16.5, requiring specialized accounting review per contract).
- **IAS 41 — Agriculture (`SPECIALIZED EVALUATION REQUIRED`)**: UAS's primary vertical models agricultural projects, sprays/harvests (`HarvestCycle`), and harvest stock (`HarvestInventoryBatch`). Currently harvest batches record **physical bundle counts only (`unitCost = 0`)** without fair value less costs to sell valuation or biological asset cost capitalization. Whether IAS 41 fair value or IAS 2/cost model applies depends on materiality, market observability, and whether assets are consumable crops vs bearer plants (IAS 16).
