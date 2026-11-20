# UAS Enterprise Accounting System — Upgrade & Architecture Release Notes (`2026-11-19`)
# توثيق التحديثات المعمارية والتشغيلية — النظام المحاسبي الموحد (UAS Enterprise)

**Release Date / تاريخ الإصدار:** 2026-11-19  
**Scope / النطاق:** Mission 1 & Mission 2 Enterprise Accounting Core, Offline Android Isolation, Multi-Currency FX, Multi-Unit Inventory, 6-Generation COA & Cost Centers, Fiscal Year-End Closing & Opening Rollover, Light-Mode PDF/Print Engine, Universal Drafts, and Multi-Level Approval Governance.  
**Database Compatibility / توافق قواعد البيانات:** Dual SQLite (`dev.db` / Windows Desktop Standalone) & PostgreSQL (`qat.world` Cloud Production) via Prisma 6.19.3 + embedded SQLite runtime bootstrap (`src/lib/sqliteInitSql.ts`).

---

## Executive Summary / الملخص التنفيذي

This release elevates UAS from an operational bookkeeping platform into a full IFRS-aligned, multi-currency, multi-unit, cost-center-enforced Enterprise Resource Planning (ERP) accounting core with strict governance, year-end closing & rollover automation, shared drafts, and publication-grade bilingual (RTL Arabic / English) PDF printing across Web (`qat.world`), Windows Desktop (`UAS.exe`), and Android Offline/Local Mode (`uas-latest.apk`).

يرتقي هذا الإصدار بمنظومة **UAS** إلى نواة محاسبية مؤسسية متكاملة متوافقة مع معايير المحاسبة الدولية (IFRS)، مع شجرة حسابات سداسية الأجيال مرتبطة آلياً بمراكز التكلفة، ومحرك إقفال سنوي وترحيل أرصدة افتتاحية آلي، ومحرك طباعة PDF رسمي بالوضع الفاتح وترويسة الشركة، ومركز مسودات مشتركة، ونظام حوكمة واعتمادات متعدد المستويات.

---

## 1. Android Offline Local-Mode Persistence & Client Data Isolation
### 1. استمرارية الوضع المحلي على أندرويد وعزل بيانات العملاء عن `qat.world`

- **Implementation / التنفيذ:** `src/lib/offlineAndroidStore.ts`, `src/lib/apiClient.ts`, `src/lib/runtimeMode.ts`
- **Architecture:** When running on Android in Local/Offline mode, every `/api/*` request is intercepted cleanly by `handleOfflineAndroidApiRequest()` backed by persistent device storage (`uas_offline_db_*` keys) and a deterministic sync queue (`uas_offline_sync_queue`).
- **Data Isolation:** Clean installs initialize ONLY the local `admin@uas-ye.com` (`SUPER_ADMIN`) account and Main Cash Vault (`0.00`). Zero cloud/tenant data from `qat.world` is ever seeded into offline client builds.
- **Mirrored Endpoints:** Auth, Bootstrap, Users lifecycle, Projects, Workers, Sales, Procurement, Treasury, Multi-Currency & FX, Multi-Unit Inventory, Cost Centers, Fiscal Years, Workspace Drafts, and Approvals.

---

## 2. User Lifecycle Management & Automatic License Seat Release
### 2. إدارة دورة حياة المستخدمين (`أرشفة` / `استعادة` / `حذف`) وتحرير مقاعد الترخيص آلياً

- **Implementation:** `src/lib/userLifecycle.ts`, `src/app/api/users/[id]/route.ts`, `src/components/tabs/SystemTab.tsx`
- **Rules / القواعد:**
  - Users with linked accounting entries (`JournalEntry`, `AuditLog`) cannot be hard-deleted; `DELETE` safely archives (`isActive = false`, `archivedAt = now()`) while preserving referential integrity.
  - Archiving or deleting a user automatically releases their Ed25519 license device seat bindings (`LicenseDeviceBinding`) so seat quotas remain accurate across Windows and Android devices.
  - Self-deletion and unauthorized non-admin lifecycle mutations are strictly blocked (`403`).

---

## 3. Multi-Currency & Dual-Amount Double-Entry Engine + FX Revaluation
### 3. محرك العملات المتعددة والقيد المزدوج المزدوج المبالغ وإعادة تقييم فروق الصرف (FX)

- **Implementation:** `src/lib/multiCurrencyEngine.ts`, `src/app/api/accounting/currencies/route.ts`, `src/app/api/accounting/exchange-rates/route.ts`, `src/app/api/accounting/fx-revaluation/route.ts`, `src/components/MultiCurrencyFxPanel.tsx`
- **Schema:** `Currency`, `ExchangeRate` (`buyRate`, `sellRate`, `midRate`, `rateDate`), plus dual-amount columns on `JournalEntryLine` (`currencyCode`, `exchangeRate`, `foreignDebit`, `foreignCredit`, `baseDebit`, `baseCredit`).
- **Capabilities:**
  - Every foreign-currency journal line stores both Transaction Currency (`USD`, `SAR`, etc.) and Base Currency (`YER`), automatically routing sub-unit rounding variances to `fxRoundingAccount`.
  - Computes Realized FX Gain/Loss on settlement and Unrealized FX Revaluation on open foreign-currency balances at period-end spot rates.

---

## 4. Centralized Accounting & Operational Settings
### 4. لوحة الإعدادات المحاسبية والتشغيلية المركزية

- **Implementation:** `src/lib/accountingSettings.ts`, `src/app/api/system/settings/route.ts`, `src/components/AccountingSettingsPanel.tsx`
- **Configuration Scope:**
  - Fiscal Year boundaries (`fiscalYearStart`, `fiscalYearEnd`) and `periodLockDate`.
  - 16 GL Control Account mappings (`cashAccount`, `arAccount`, `apAccount`, `salesAccount`, `cogsAccount`, `inventoryAssetAccount`, FX Gain/Loss/Rounding accounts, Tax accounts, `retainedEarningsAccount`).
  - Document Sequences (`JV`, `RV`, `PV`, `INV`, `BILL`, `TRN`) with configurable prefix, next number, and zero-padding.
  - Inventory Costing Method (`WEIGHTED_AVERAGE` | `FIFO`), Negative Stock Policy (`BLOCK` | `WARN`), Default Print Layout (`A4` | `80MM` | Custom), and Approval Workflow toggle.

---

## 5. Item Master Data, Multi-Unit Inventory & Universal `"Other / Custom"` Extensibility
### 5. دليل الأصناف والمخزون متعدد الوحدات والمرونة الشاملة (`أخرى / مخصص`)

- **Implementation:** `src/lib/multiUnitInventoryEngine.ts`, `src/app/api/inventory/{items,uom,categories,warehouses,movements}/route.ts`, `src/components/MultiUnitInventoryPanel.tsx`, `src/components/SelectWithOther.tsx`
- **Schema:** `UnitOfMeasure`, `ItemCategory`, `Warehouse`, `InventoryItem`, `ItemUnitConversion` (`factorToBase`), `StockBalance` (`qtyOnHandBase`, `avgUnitCostBase`), `StockMovement`.
- **Capabilities:**
  - Converts any entered unit (`Carton`, `Pack`, `Kg`, custom unit) into base units via `factorToBase`, maintains Weighted Average Cost (WAC), and renders human-readable compound stock breakdowns (e.g., `2 كرتون + 4 حبة`).
  - Universal `"Other / Custom (أخرى / مخصص)"` support allows inline creation of custom UOMs, Categories, Warehouses, and Cost Centers without leaving the active form.

---

## 6. Accounting-Core 6-Generation Chart of Accounts & Mandatory Cost Center Binding
### 6. شجرة الحسابات سداسية الأجيال (الجيل 1 ← الجيل 6) ومراكز التكلفة الإلزامية

- **Implementation:** `src/lib/accountingCoreEngine.ts`, `src/lib/accounting/ledgerService.ts`, `src/app/api/accounting/cost-centers/route.ts`, `src/app/api/accounting/reports/cost-centers/route.ts`, `src/components/CostCenterSelector.tsx`, `src/components/CoaTreeTab.tsx`, `src/components/FinancialReportsTab.tsx`
- **Schema Updates:**
  - `Account`: `generation` (`1..6`), `parentAccountId`, `isPostable`, `subLedgerType` (`CUSTOMER | VENDOR | WORKER | TREASURY | WAREHOUSE | PROJECT | NONE`), `subLedgerEntityId`, `defaultCostCenterId`.
  - `CostCenter`: `code`, `nameAr`, `nameEn`, `parentId`, `generation`, `centerType` (`BRANCH | PROJECT | FARM | DEPARTMENT | FLEET | OTHER`), `customLabel`, `isCustom`, `isActive`.
  - Foreign keys `glAccountId` & `costCenterId` added to `Customer`, `Vendor`, `Worker`, `Warehouse`, `Project`; `costCenterId` added to `JournalEntryLine`, `SalesInvoice`, `VendorBill`, `ReceiptVoucher`, `PaymentVoucher`, `StockMovement`.
- **Auto-Provisioning Mapping (Gen 5 Control → Gen 6 Leaf):**

| Operational Entity / الكيان | Gen 5 Control Code | Gen 6 Leaf Format | Cost Center Group |
|---|---|---|---|
| Customers / العملاء | `112190` | `112190001+` | `CC-CUS` |
| Suppliers / الموردون | `211190` | `211190001+` | `CC-VND` |
| Workers / العمال | `212190` | `212190001+` | `CC-WRK` |
| Cashboxes / الصناديق | `111190` | `111190001+` | `CC-TRS` |
| Banks & Wallets / البنوك والمحافظ | `111290` | `111290001+` | `CC-TRS` |
| Warehouses / المخازن | `113390` | `113390001+` | `CC-WH` |
| Projects / المشاريع | `121390` | `121390001+` | `CC-PRJ` |

- **Enforcement:** Direct postings to non-postable summary accounts (`isPostable = false`) are rejected with `NON_POSTING_ACCOUNT`. `costCenterId` propagates end-to-end into every `JournalEntryLine` (line override → entry default → account default). Financial Statements (`Trial Balance`, `Income Statement`, `Balance Sheet`) and the dedicated **Cost Center P&L (`تقرير مراكز التكلفة`)** filter cleanly by `costCenterId`.

---

## 7. Fiscal Year-End Closing & Opening Balance Roll-Forward Migration
### 7. إقفال السنة المالية وترحيل الأرصدة الافتتاحية للسنة الجديدة

- **Implementation:** `src/lib/fiscalYearClosingEngine.ts`, `src/app/api/accounting/fiscal-years/route.ts`, `src/app/api/accounting/fiscal-years/[id]/precheck/route.ts`, `src/app/api/accounting/fiscal-years/[id]/close-and-rollover/route.ts`, `src/components/FiscalYearClosingModal.tsx`
- **Schema:** `FiscalYear` (`code`, `startDate`, `endDate`, `status` `OPEN | CLOSING_IN_PROGRESS | CLOSED`, `closingJournalEntryId`, `openingJournalEntryId`, `retainedEarningsAccountId`, `netProfitLossBase`, `closedById`, `closedByName`, `closedAt`); `JournalEntry` extended with `fiscalYearId` & `entryType` (`NORMAL | OPENING | ADJUSTMENT | YEAR_END_CLOSING`).
- **3-Step Operational Workflow / سير العمل:**
  1. **Pre-Close Audit (`POST /api/accounting/fiscal-years/[id]/precheck`):** Verifies (a) zero pending `WorkspaceDraft` / `DRAFT` / `PENDING_APPROVAL` documents, (b) strictly balanced base-currency Trial Balance, (c) closing spot exchange rates configured for open FX balances, and (d) valid postable Retained Earnings control account (`312101`).
  2. **Atomic P&L Closing & Lock (`POST /api/accounting/fiscal-years/[id]/close-and-rollover`):** Generates balanced `YEAR_END_CLOSING` entry zeroing Revenue (`4xxxx`) & Expense (`5xxxx`) accounts while preserving Cost Center breakdowns into Retained Earnings; marks year `CLOSED` and advances `SystemSettings.periodLockDate` to block all backdated entries (`FISCAL_YEAR_CLOSED` / `PERIOD_LOCKED`).
  3. **New Year Opening Migration (`OPENING`):** Opens the next `FiscalYear` and generates a strictly balanced `OPENING` journal entry carrying forward all Balance Sheet accounts (`1xxxx`, `2xxxx`, `3xxxx`) — including every Gen-6 sub-ledger account and both Foreign + Base (`YER`) balances — plus non-mutating `OPENING` `StockMovement` rollover markers preserving `StockBalance` quantities & WAC.

---

## 8. Enterprise Light-Mode PDF & Print Letterhead Engine
### 8. محرك الطباعة وتصدير PDF المؤسسي (الوضع الفاتح + ترويسة الشركة والهوية المزدوجة)

- **Implementation:** `src/lib/print/uasDocumentPrinter.ts`, `src/components/print/UasPrintLayout.tsx`
- **Key Guarantees:**
  - **Pure Light Mode:** Renders an isolated standalone HTML5 document (`#FFFFFF` background, `#0F172A` crisp ink, high-contrast borders) — eliminating dark-theme DOM dumps, right-edge clipping, and floating AI Copilot widget text bleed.
  - **Formats:** Supports `A4_PORTRAIT`, `A4_LANDSCAPE`, and `THERMAL_80MM` (POS receipts).
  - **Company Letterhead & Dual UAS Branding:** Dynamic company logo (or geometric monogram), Arabic & English Legal Name, Branch, CR/Tax numbers, Phone, Address, Document Status Watermarks (`مسودة • DRAFT`, `قيد الاعتماد • PENDING APPROVAL`, `معتمد ومرحل • POSTED`, `ملغي • VOID`), 3-column signature blocks (`أعده`, `راجعه`, `اعتمده`), page numbering, and `"Powered by UAS • النظام المحاسبي الموحد"` footer badge.
  - **RTL Bidirectional Typography:** Wraps English titles, currency codes, and document numbers in `<bdi dir="auto">` with `unicode-bidi: isolate;` so parentheses never invert.
  - **Migrated Exporters:** Voucher Modal (A4 + 80mm POS), Financial Statements (TB, P&L, BS, Cost Center P&L), Sales Report, Workers Wages Report, Customer Statements, Executive Dashboard, and General Ledger Journal Vouchers.

---

## 9. Universal Workspace Drafts Module (`حفظ كمسودة`)
### 9. وحدة المسودات المشتركة الشاملة عبر كافة النماذج

- **Implementation:** `src/lib/workspaceDraftsEngine.ts`, `src/app/api/drafts/route.ts`, `src/app/api/drafts/[id]/route.ts`, `src/app/api/drafts/[id]/promote/route.ts`, `src/hooks/useFormDraft.ts`, `src/components/SaveDraftButton.tsx`, `src/components/SharedDraftsCenterDrawer.tsx`
- **Schema:** `WorkspaceDraft` (`draftNumber` `DRF-YYYY-XXXX`, `module`, `formType`, `entityId?`, `titleAr`, `titleEn`, `payloadJson`, `totalAmount?`, `currencyCode`, `visibility` `SHARED_WORKSPACE | PRIVATE`, `status` `ACTIVE_DRAFT | SUBMITTED_FOR_APPROVAL | CONVERTED | DISCARDED`, `convertedEntityId?`).
- **Operational Workflow:**
  - Every operational & accounting form includes a **"حفظ كمسودة"** button beside **"حفظ / ترحيل"** to persist form + subform line items without posting to GL or altering inventory.
  - Top-bar **Drafts Counter Badge (`المسودات`)** opens the **Shared Drafts Center (`مركز المسودات المشتركة`)** where authorized team members filter by module/creator, resume editing in-form with one click, promote/post into a live record, or discard stale drafts.

---

## 10. Multi-Level Approval & Post-Posting Amendment Governance Engine
### 10. محرك الاعتمادات متعددة المستويات وحوكمة التعديلات بعد الترحيل

- **Implementation:** `src/lib/approvalEngine.ts`, `src/app/api/approvals/route.ts`, `src/app/api/approvals/[id]/decide/route.ts`, `src/app/api/approvals/rules/route.ts`, `src/components/ApprovalsCenter.tsx`, `src/components/ApprovalRulesMatrixPanel.tsx`
- **Schema:**
  - `ApprovalRule` (`module`, `actionType`, `minAmountBase`, `currencyCode`, `requiredRole`, `approverUserIdsJson`, `allowSelfApproval`, `isActive`).
  - `ApprovalRequest` (`requestNumber` `APR-YYYY-XXXX`, `ruleId?`, `module`, `actionType`, `targetType`, `targetId`, `documentNumber`, `summaryAr`, `amountBase`, `beforeSnapshotJson?`, `afterSnapshotJson`, `reasonAr?`, `status` `PENDING | APPROVED | REJECTED | RETURNED_FOR_EDIT`, reviewer metadata).
  - Core document governance columns `documentStatus` & `revisionNumber` added to `JournalEntry`, `SalesInvoice`, `VendorBill`, `ReceiptVoucher`, `PaymentVoucher`, and `StockMovement`.
- **Governance Controls:**
  - **Self-Approval Block:** Rejects self-approval (`SELF_APPROVAL_FORBIDDEN`) whenever `allowSelfApproval === false`.
  - **Role Authorization:** Requires `requiredRole` or `SUPER_ADMIN` (or explicit approver ID).
  - **Controlled Post-Posting Amendments:** Displays side-by-side **Before / After** field diffs in **مركز الاعتمادات والمراجعة (`ApprovalsCenter`)**; upon approval, atomically applies the amendment, increments `revisionNumber`, and writes an immutable `AuditLog` record.
  - **Return for Edit:** Automatically creates a `WorkspaceDraft` pre-loaded with reviewer notes so the author can revise and resubmit cleanly.

---

## API Reference Quick Index / فهرس نقاط النهاية (APIs)

| Domain | Endpoint | Methods | Purpose |
|---|---|---|---|
| Cost Centers | `/api/accounting/cost-centers` | `GET, POST, PUT, DELETE` | Hierarchical Cost Center CRUD + `"Other / Custom"` |
| Cost Center P&L | `/api/accounting/reports/cost-centers` | `GET` | Revenue, Expense & Net Profit by Cost Center |
| Fiscal Years | `/api/accounting/fiscal-years` | `GET, POST` | List & initialize Fiscal Years |
| Year-End Precheck | `/api/accounting/fiscal-years/[id]/precheck` | `POST` | 4-point pre-closing audit checklist & preview |
| Year-End Rollover | `/api/accounting/fiscal-years/[id]/close-and-rollover` | `POST` | Atomic P&L close, period lock & opening migration |
| Workspace Drafts | `/api/drafts` | `GET, POST` | List shared/private drafts & save new draft |
| Draft Lifecycle | `/api/drafts/[id]` | `GET, PATCH, DELETE` | Inspect, update, or discard draft |
| Draft Promotion | `/api/drafts/[id]/promote` | `POST` | Validate & convert draft to live/pending document |
| Approval Requests | `/api/approvals` | `GET, POST` | List inbox & submit creation/amendment for approval |
| Approval Decision | `/api/approvals/[id]/decide` | `POST` | Execute `APPROVED`, `REJECTED`, or `RETURNED_FOR_EDIT` |
| Approval Rules | `/api/approvals/rules` | `GET, POST, PUT, DELETE` | Configure Approval Governance Matrix |

---

## 11. Mission 3 Architecture: Global Idempotency, Universal Archive/Safe-Delete, AI Chat Controls & Granular RBAC
### 11. هندسة المرحلة الثالثة: منع التكرار العام، دورة حياة الحذف والأرشفة الآمنة، تحكم المحادثة الذكية وصلاحيات RBAC الدقيقة

#### 11.1 Global Double-Click Idempotency (`withIdempotency`)
- **Implementation:** `src/lib/idempotencyGuard.ts`, `prisma/schema.prisma` (`IdempotencyRecord`), `src/lib/offlineAndroidStore.ts`.
- **Mechanism:** Intercepts mutating requests carrying `X-Idempotency-Key` (UUIDv4) with a 24-hour cache window. Rapid double-clicks or double-taps on web/mobile return the cached HTTP status and body without re-executing general ledger postings, stock deductions, or fiscal year closings.
- **Atomic Transactions & State Guards:** Multi-step financial operations are wrapped in `prisma.$transaction` blocks with conditional `WHERE status = 'ACTIVE_DRAFT'`, `WHERE status = 'OPEN'`, or `WHERE status = 'PENDING'` guards to eliminate concurrency race conditions.

#### 11.2 Universal Master Record Lifecycle (`MasterLifecycle`)
- **Implementation:** `src/lib/masterLifecycle.ts`, `/api/system/lifecycle`, `src/lib/offlineAndroidStore.ts`.
- **Safe-Delete Invariant:** Master entities (`Customer`, `Vendor`, `Worker`, `Project`, `Warehouse`, `InventoryItem`, `CostCenter`, and unposted `WorkspaceDraft`) are inspected for linked financial records (`JournalEntryLine`, `StockMovement`, `SaleTransaction`, `OperatingExpense`, `WorkerWage`, `AuditLog`).
  - **Zero Linked Records:** Permanently deleted from the database along with their associated Generation 6 GL leaf account.
  - **Historical Linked Records:** Auto-archived (`isActive = false`, `archivedAt = now()`) while safely preserving referential integrity, and deactivating the linked Generation 6 GL account (`isPosting = false`).
  - **Restoration:** Single-click restore (`isActive = true`, `archivedAt = null`) reactivates the master record and its GL account.
- **Frontend Action Buttons:** Unified `تعديل` / `أرشفة` / `استعادة` / `حذف` action buttons with an `"إظهار المؤرشفين"` filter toggle across all master tabs.

#### 11.3 AI Copilot Chat Controls & Reasoning Transparency
- **Implementation:** `src/components/UasAiCopilot.tsx`.
- **Collapsible / Minimize Support:** Toggle between full floating copilot modal and minimized bottom-left pill handle (`localStorage.uas_copilot_minimized`), ensuring the right-sidebar Logout button and table columns are never obstructed.
- **Per-Message Edit (`تعديل`):** Inline editing on any historical user prompt bubble. Truncates stale assistant replies after that turn and cleanly re-executes AI reasoning with the updated query.
- **Per-Message Delete (`حذف`) & Clear History (`مسح السجل`):** Delete individual bubbles or clear entire chat thread history (`localStorage.uas_copilot_history_*`).
- **Dismissable Action Preview (`تجاهل الاقتراح`):** Financial Confirmation Preview Cards feature 3 distinct decision buttons:
  - **تنفيذ وترحيل / Execute & Post:** Posts the balanced transaction to the General Ledger.
  - **حفظ كمسودة / Save Draft:** Saves the transaction as an editable `WorkspaceDraft` without affecting the General Ledger.
  - **تجاهل / Dismiss:** Discards the proposed transaction cleanly without writing to the database.

#### 11.4 AI Agent Gen-6, Multi-Currency & Period-Lock Routing
- **Implementation:** `src/lib/ai/uasAgentTools.ts`, `src/lib/ai/offlineAgentEngine.ts`, `src/lib/ai/agentServerExecutor.ts`.
- **Gen-6 Resolution:** Prioritizes postable leaf accounts (`level === 6 && isPosting === true`).
- **Multi-Currency & Multi-Unit:** Extracts foreign currencies (`SAR`, `USD`, `AED`, `OMR`, `EUR`, `YER`) and exchange rates, and converts multi-unit item quantities via `factorToBase`.
- **Governance Gateways:** Enforces `assertDateNotInClosedFiscalYear` and routes transactions exceeding approval thresholds into `SUBMITTED_FOR_APPROVAL` or `WorkspaceDraft` queues.

#### 11.5 Topological Backup, Legacy Restore & Android Replay Queue
- **Implementation:** `src/lib/backupService.ts`, `src/lib/offlineAndroidStore.ts`.
- **Full Schema Export:** Exports all tables in strict foreign-key order: `Currency`, `ExchangeRate`, `CostCenter`, `FiscalYear`, `UnitOfMeasure`, `ItemCategory`, `Warehouse`, `InventoryItem`, `StockBalance`, `TreasuryTransaction`, `WorkspaceDraft`, `ApprovalRule`, `ApprovalRequest`, `IdempotencyRecord`.
- **Legacy Backward-Compatibility:** On restoring older database snapshots, auto-executes `ensure6GenerationCoaHierarchy()`, backfills `baseDebit`/`baseCredit` (`exchangeRate = 1`), and initializes the active `FiscalYear`.
- **Topological Replay Queue:** Android offline mutations are sorted by priority tiers (Currencies/FiscalYears 10 → CostCenters 20 → UOMs/Warehouses 30 → Master Entities 40 → Rules/Drafts 50 → Ledger/Transactions 60 → Approvals 70) to prevent foreign-key deadlock during reconnection.

#### 11.6 Granular RBAC Permissions Matrix
- **Implementation:** `src/lib/permissions.ts`, `src/components/tabs/SystemTab.tsx`.
- **New Permission Flags:**
  - `accounting.close_year` (`canCloseFiscalYear`): Close fiscal year & execute rollover.
  - `accounting.fx_revalue` (`canFxRevalue`): Post unrealized FX revaluation entries.
  - `approvals.decide` (`canDecideApprovals`): Approve or reject approval requests.
  - `approvals.configure` (`canConfigureApprovals`): Configure approval rules & thresholds.
  - `drafts.manage_all` (`canManageAllDrafts`): Inspect and manage all workspace drafts.
  - `inventory.custom_uom` (`canCustomUom`): Register custom units of measure.
  - `records.archive_delete` (`canArchiveDeleteRecords`): Archive, delete, or restore master entities.
- **Configurable UI:** Integrated into the System Tab RBAC matrix and User Permissions Drawer with per-user custom overrides.

#### 11.7 Excel/CSV Reusable Templates & Import Parser
- **Implementation:** `src/lib/excelExport.ts`.
- **Extended Columns:** Added `costCenterCode`, `currencyCode`, `exchangeRate`, `unitCode`, and `factorToBase` across Customer Sales and Operating Expenses sheets.
- **Template Generators & Parsers:** `exportUasModuleTemplate()` produces downloadable templates with sample data for Sales, Expenses, Items, Customers, Vendors, and Journal Vouchers, while `parseExcelImport()` parses uploaded spreadsheets into structured arrays.

---

## 12. Mission 4 Architecture: Live Banking & E-Wallet Execution Gateway, Bulk Bank Files & Statement Auto-Reconciliation
### 12. هندسة المرحلة الرابعة: بوابة الربط والتنفيذ البنكي المباشر والمحافظ الإلكترونية، ملفات التحويلات الجماعية والمطابقة الآلية لكشوفات الحساب

#### 12.1 Pluggable Banking & E-Wallet Gateway Engine (`BankWalletGateway`)
- **Implementation:** `src/lib/treasury/bankWalletGateway.ts`, `prisma/schema.prisma` (`BankPaymentDispatch`, `TreasuryAccount`), `src/lib/offlineAndroidStore.ts`.
- **Supported Providers:**
  - `MANUAL`: Internal cashbox/bank dispatch voucher with double-entry GL ledger posting.
  - `KURAIMI_API`: Kuraimi Express API integration for instant commercial remittances and salary payouts.
  - `JAWALI_API`: WeCash / Jawali mobile wallet gateway integration.
  - `JEEB_API`: CAC Bank Jeeb electronic wallet integration.
  - `ONECASH_API`: OneCash mobile wallet payout integration.
  - `FLOOSAK_API`: Yemen and Kuwait Bank Floosak electronic wallet integration.
  - `CUSTOM_WEBHOOK`: Generic external ERP/banking webhook adapter with configurable authentication headers.
- **Atomic Balance & Daily Limit Enforcement:** Every payout checks the account's configured `dailyLimit` and active balance in atomic transactions before execution.
- **Double-Entry General Ledger Auto-Posting:**
  - Debits the target liability/expense account (e.g., Vendor Accounts Payable `2111xx`, Worker Wages `2112xx`, or Inter-Treasury Clearing).
  - Debits Bank Transfer Fee expense account (`531200`) when transaction fees apply.
  - Credits the specific Gen-6 Bank or Wallet asset account (`111290xxx`).
- **Cryptographic Receipt Audit Trail:** Generates unique dispatch tracking numbers (`DSP-YYYY-XXXX`) and records external banking receipts (`externalReferenceId`), full response payloads, and actor attribution into `ImmutableAuditLog`.

#### 12.2 Unified Multi-Module Payment Execution Modal (`BankPayoutModal`)
- **Implementation:** `src/components/BankPayoutModal.tsx`, `TreasuryTab.tsx`, `ProcurementTab.tsx`, `WorkersTab.tsx`.
- **Pre-filled Contextual Payouts:**
  - **Payment Vouchers (`ProcurementTab.tsx`):** Immediate single-click payout for approved vendor bills, pre-filling vendor name, phone number, voucher amount, and currency.
  - **Worker Wage Entries & Directory (`WorkersTab.tsx`):** Instant payout dispatch for field worker wages or accumulated balance due.
  - **Treasury Disbursements (`TreasuryTab.tsx`):** Manual or direct electronic payouts for miscellaneous treasury operations.
- **Live Receipt Badge:** Renders interactive receipt summary with external transaction ID and updates the source record with a `تم التحويل` status badge.

#### 12.3 Bulk Bank Transfer Files Export (`batch-export`)
- **Implementation:** `src/app/api/treasury/batch-export/route.ts`, `src/lib/treasury/bankWalletGateway.ts`.
- **Formats:** Downloadable `.xlsx` (Excel) and `.csv` formatted in strict RTL layout with bilingual headers matching major Yemeni banking upload standards.
- **Export Trigger:** Accessible directly inside the Statement & Reconciliation drawer with custom file generation.

#### 12.4 Statement Auto-Reconciliation Engine (`reconcile-import`)
- **Implementation:** `src/app/api/treasury/reconcile-import/route.ts`, `src/lib/treasury/bankWalletGateway.ts`.
- **Upload & Parsing:** Accepts bank statement spreadsheets in `.xlsx` or `.csv` format.
- **Tripartite Matching Algorithm:** Matches records by Date, Amount, and Reference Number against posted General Ledger entries.
- **Summary Classification:**
  - **Matched (`طابق بالكامل`):** Transactions reconciled in both the bank statement and UAS GL.
  - **Unmatched in UAS (`غير مسجل بالنظام`):** Bank movements not yet recorded in UAS accounting books.
  - **Unmatched in Bank (`غير ظاهر بالبنك`):** UAS ledger entries pending clearance in the bank statement.
