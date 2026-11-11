Here is the complete engineering specification and Coding Agent prompt formatted in Markdown. It structures the Unified Accounting System (UAS) around an immutable double-entry core, integrates procurement and 5-tier parent/child chart of accounts, and details the frontend, backend, and infrastructure enhancements.

Save the content below as `uas_enterprise_upgrade_prompt.md` in your project root or copy it directly into your coding agent.

---

```markdown
# Unified Accounting System (UAS) Enterprise Architecture & Coding Master Prompt

## 1. Executive Blueprint & Core Philosophy
The Unified Accounting System (UAS) is an enterprise-grade ERP with an **immutable Double-Entry Accounting Engine** at its core. Every operational event across Projects, Procurement, Inventory, Sales, Expenses, and Payroll must map strictly to balanced journal entries ($\sum \text{Debits} = \sum \text{Credits}$) governed by a structured 5-tier Chart of Accounts (COA). 

No balances may be mutated via manual database updates or single-sided columns; all balances are derived dynamically or maintained via atomic ledger posting rules.

---

## 2. Standard 5-Tier Chart of Accounts (COA) Architecture
The system enforces a hierarchical structure: `Parent Account (Class) -> Group -> Control -> Sub-Control -> Detail (Posting Account)`. Only Tier-5 (Detail) accounts accept direct journal entry line postings.

```text
100000 ASSETS (الأصول)
  110000 Current Assets (الأصول المتداولة)
    111000 Cash and Cash Equivalents (النقدية وما في حكمها)
      111100 Main Vault & Treasuries (الصناديق المركزية)
        111101 Central Safe - YER (الصندوق الرئيسي - يمني)
        111102 Central Safe - SAR (صندوق الريال السعودي)
        111103 Central Safe - USD (صندوق الدولار)
      111200 Bank Accounts & Electronic Wallets (البنوك والمحافظ الإلكترونية)
        111201 Kuraimi Islamic Bank (بنك الكريمي الإسلامي)
        111202 Al-Qutaibi Bank (بنك القطيبي)
        111203 Floosak / Jawali Wallet (محفظة فلوسك / جوالي)
    112000 Trade Receivables & Clients (العملاء والمدينون)
      112100 Project Commercial Debtors (مدينو المشاريع)
        112101 Fawaz Al-Jabri (فواز الجابري)
        112102 Youssef Al-Jabri (يوسف الجابري)
    113000 Inventories & Biological Stock (المخزون والأصول الحيوية)
      113100 Agricultural Goods & Harvest Lots (مخزون المحاصيل والعلاقيات)
        113101 Grade 1 Premium Stock (علاقيات صنف 1 ممتاز)
        113102 Grade 2 Standard Stock (علاقيات صنف 2 وسط)
        113103 Raw Harvest Unsorted (محصول خام قيد الفرز)
      113200 Agricultural Inputs & Consumables (المستلزمات الزراعية والمواد)
        113201 Fertilizer & Chemicals Stock (مخزون الأسمدة والمبيدات)
        113202 Diesel & Fuel Reserves (مخزون الوقود والمحروقات)
        113203 Packaging & Crates (أدوات التعبئة والتغليف)
    114000 Advances, Prepayments & Unbilled Work (السلف والمصروفات المدفوعة مقدماً)
      114100 Advance Payments to Suppliers (سلف ومقدمات الموردين)
        114101 Vendor Advances - Procurement (مقدمات مشتريات الموردين)
      114200 Worker Advances (سلف وعهد العمال والمزارعين)
        114201 Worker Advances Ledger (حساب سلف العمال)
  120000 Non-Current Assets (الأصول غير المتداولة)
    121000 Property, Land, Wells & Equipment (الأراضي، الآبار، والآلات)
      121100 Farms & Landed Estates (الأراضي والمزارع)
      121200 Wells, Pumps & Solar Irrigation (الآبار ومنظومات الطاقة الشمسية)

200000 LIABILITIES (الالتزامات)
  210000 Current Liabilities (الالتزامات المتداولة)
    211000 Trade Payables & Vendors (الموردون والتجاريون)
      211100 Procurement Vendors Payable (ذمم موردي المشتريات)
        211101 General Agricultural Supplies Co. (شركة التوريدات الزراعية)
        211102 Fuel & Energy Station Vendor (محطة الوقود والطاقة)
        211103 Equipment Spare Parts Vendor (مورد قطع الغيار والصيانة)
    212000 Accrued Worker Wages & Benefits (أجور العمال المستحقة)
      212100 Harvest & Daily Labor Payables (مستحقات عمال الأجر اليومي والقطفات)
        212101 Bilal Labor Payable (مستحقات العامل بلال)
        212102 Moath Labor Payable (مستحقات العامل معاذ)
        212103 Fawaz Labor Payable (مستحقات العامل فواز)
    213000 Unearned Revenue & Customer Deposits (تأمينات ومقدمات العملاء)
      213100 Client Advances & Pre-orders (دفعات مقدمة من العملاء)

300000 EQUITY (حقوق الملكية)
  310000 Capital & Retained Reserves (رأس المال والاحتياطيات)
    311000 Owner Capital Accounts (رأس مال الملاك والشركاء)
    312000 Retained Earnings (الأرباح المبقاة / المحتجزة)
    313000 Current Year Net Operating Result (صافي نتائج العام المالي الجاري)

400000 REVENUE (الإيرادات)
  410000 Operating Revenue & Sales (إيرادات النشاط والمبيعات)
    411000 Project Harvest Sales (مبيعات محاصيل المشاريع)
      411100 Upper Jabri Sales (مبيعات الجبري العليا)
      411200 Middle Jabri Sales (مبيعات الجبري الوسطى)
      411300 Lower Jabri Sales (مبيعات الجبري السفلى)
    412000 By-Products & Agricultural Services (إيرادات خدمات زراعية ومشتقات)

500000 EXPENSES & COSTS (المصروفات والتكاليف)
  510000 Cost of Goods Sold / Harvest Cost (تكاليف الإنتاج والقطاف)
    511000 Direct Farming & Harvest Labor (أجور القطف والعمالة المباشرة)
    512000 Direct Procurement & Inputs Consumed (تكاليف مدخلات الإنتاج المستهلكة)
  520000 Operating Expenses (المصروفات التشغيلية للمشاريع)
    521000 Fuel, Diesel & Power (وقود ومحروقات وطاقة)
    522000 Worker Meals & Catering (وجبات وإعاشة العمال)
    523000 Transport, Logistics & Cartage (أجور النقل والتوريد)
    524000 Farm Maintenance & Consumable Equipment (صيانة المزرعة والعدد)
  530000 Administrative & General Expenses (المصروفات الإدارية والعمومية)

```

---

## 3. Core Operational Modules Specification

### 1. Projects Engine (Main & Sub-Projects)

* **Hierarchy**: Parent Project (e.g., `الجبري العليا`) with nested Sub-Projects (`قطاع A`, `قطاع B`, `الآبار والضخ`) and linked Harvest/Production Cycles (`القطفات / المرشات`).
* **Analytical Dimensions**: Every transaction (PO, Expense, Journal Entry, Sale, Wage) requires a `projectId` and an optional `subProjectId` / `harvestCycleId` tag.
* **Project Budgeting & Variance**: Allows setting expected vs. actual budget envelopes with real-time Over-Budget warning guards.

### 2. End-to-End Procurement & Payables Workflow

* **Lifecycle**:

1. **Purchase Requisition (PR)**: Initiated by field/project supervisor.
2. **Purchase Order (PO)**: Approved by project manager, specifying Vendor, Project, Items, Tax/Discounts, and Currency.
3. **Goods Received Note (GRN) / Warehouse Inspection**: Validates quantities received into Inventory. Detects shortages/damages.
4. **Vendor Bill (AP Invoice)**: Generates automated Journal Entry:

* `DR 113200 (Inventory/Consumables)` or `DR 520000 (Project Expense)`
* `CR 211100 (Vendor Payable Account)`

1. **Payment Voucher (سند صرف)**:

* `DR 211100 (Vendor Payable Account)`
* `CR 111100 / 111200 (Vault / Bank Account)`

* **Debit/Credit Adjustment Notes**: Full support for supplier returns and post-invoice price adjustments with automated offsetting entries.

### 3. Sales, Receivables & Billing

* **Quotations -> Sales Orders -> Delivery Notes -> Tax Invoices -> Receipt Vouchers (سندات القبض)**.
* **Customer Ledgers**: Real-time statement of account showing date, transaction reference, project reference, debit, credit, running balance, and aging analysis ($0-30$, $31-60$, $61-90$, $90+$ days).
* **Instant Digital Dispatch**: Every invoice and receipt includes a dynamic QR verification code and direct one-click WhatsApp dispatch with pre-filled localized text.

### 4. General Ledger, Budgeting & Financial Statements

* **Double-Entry Journal Engine**: Draft -> Approved -> Posted states. Immutable once posted; reversals via credit/debit adjustment entries only.
* **Automated Real-Time Financial Statements**:
* **Trial Balance (ميزان المراجعة)**: Filterable by Date Range, Project, and Sub-Account level ($1$ to $5$).
* **Profit & Loss Statement (قائمة الدخل)**: Dynamic gross profit, net operating profit, broken down per project or consolidated.
* **Balance Sheet (الميزانية العمومية)**: Assets = Liabilities + Equity balance verification.
* **General Budget vs. Actual (الموازنة التقديرية)**: Drill-down variance analysis.

### 5. Multi-Currency Treasury & Cash Management

* Multi-currency support across all transactions (`YER`, `SAR`, `USD`) with defined base currency and historical exchange rate tables.
* Treasury transfers between Vaults, Banks, and Wallets with dual-entry exchange gain/loss reconciliation.

### 6. Public Landing Page & Enterprise Identity

* Professional public-facing corporate landing page reflecting the enterprise brand identity:
* Hero section highlighting the Agricultural & Industrial enterprise.
* Transparent project metrics and supply-chain track record.
* Client & Vendor onboarding portal link.
* Live Public Voucher Verification endpoint (scanning invoice QR codes lands on an authenticated verification page).

* Enterprise-grade brand styling: Customizable logo, company stamp, tax numbers, and customizable color tokens (Emerald Agritech, Dark Navy Enterprise, or Gold Luxury).

### 7. Reporting, Data Portability & Auditability

* **Excel Engine**: Two-way SheetJS integration. Export any ledger or financial statement with native RTL formatting, freeze panes, and active formulas. Import spreadsheets for bulk items, accounts, and opening balances.
* **Printable PDF Vouchers**: Standardized corporate invoice templates with header, enterprise stamp placeholder, QR code, bilingual labels, and breakdown tables.
* **Immutable Audit Trail & Period Lock**: Tamper-proof event logs capturing `userId`, `ipAddress`, `timestamp`, `action`, `previousState`, and `newState`. Period-locking controls prevent modifying audited harvest cycles.

---

## 4. Prisma Enterprise Database Schema (`prisma/schema.prisma`)

```prisma
datasource db {
  provider = "postgresql" // Switch to postgresql for production Supabase / Cloud Postgres
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

enum Role {
  SUPER_ADMIN
  PROJECT_MANAGER
  CHIEF_ACCOUNTANT
  FIELD_ACCOUNTANT
  PROCUREMENT_OFFICER
  AUDITOR
}

enum AccountType {
  ASSET
  LIABILITY
  EQUITY
  REVENUE
  EXPENSE
}

enum DocStatus {
  DRAFT
  PENDING_APPROVAL
  APPROVED
  POSTED
  PAID
  PARTIALLY_PAID
  VOIDED
}

// ---------------------------------------------------------
// 1. CHART OF ACCOUNTS & GENERAL LEDGER
// ---------------------------------------------------------

model Account {
  id              String         @id @default(cuid())
  code            String         @unique // e.g. "111101"
  nameAr          String
  nameEn          String
  level           Int            // 1 to 5
  type            AccountType
  isPosting       Boolean        @default(false) // Only true for Tier 5
  parentId        String?
  parent          Account?       @relation("AccountHierarchy", fields: [parentId], references: [id])
  children        Account[]      @relation("AccountHierarchy")
  
  journalLines    JournalEntryLine[]
  vendors         Vendor[]
  customers       Customer[]
  treasury        TreasuryAccount?

  createdAt       DateTime       @default(now())
  updatedAt       DateTime       @updatedAt
}

model JournalEntry {
  id              String             @id @default(cuid())
  entryNumber     String             @unique // e.g. "JV-2026-0001"
  date            DateTime
  reference       String?            // External ref, PO#, Invoice#
  narrationAr     String
  narrationEn     String?
  status          DocStatus          @default(POSTED)
  projectId       String?
  project         Project?           @relation(fields: [projectId], references: [id])
  
  lines           JournalEntryLine[]
  attachments     Attachment[]
  createdById     String
  createdBy       User               @relation(fields: [createdById], references: [id])
  
  createdAt       DateTime           @default(now())
  updatedAt       DateTime           @updatedAt
}

model JournalEntryLine {
  id              String        @id @default(cuid())
  journalEntryId  String
  journalEntry    JournalEntry  @relation(fields: [journalEntryId], references: [id], onDelete: Cascade)
  accountId       String
  account         Account       @relation(fields: [accountId], references: [id])
  
  debit           Decimal       @default(0) @db.Decimal(18, 4)
  credit          Decimal       @default(0) @db.Decimal(18, 4)
  currency        String        @default("YER")
  exchangeRate    Decimal       @default(1.0) @db.Decimal(18, 6)
  
  // Multi-Currency Normalized amounts
  debitBase       Decimal       @default(0) @db.Decimal(18, 4)
  creditBase      Decimal       @default(0) @db.Decimal(18, 4)
  
  memo            String?
  projectId       String?
  project         Project?      @relation(fields: [projectId], references: [id])
  subProjectId    String?
  subProject      SubProject?   @relation(fields: [subProjectId], references: [id])
}

// ---------------------------------------------------------
// 2. ENTERPRISE & PROJECTS
// ---------------------------------------------------------

model EnterpriseProfile {
  id              String        @id @default(cuid())
  legalNameAr     String
  legalNameEn     String
  taxNumber       String?
  commercialReg   String?
  currencyCode    String        @default("YER")
  address         String?
  phone           String?
  email           String?
  logoUrl         String?
  brandColor      String        @default("#059669")
}

model Project {
  id              String             @id @default(cuid())
  code            String             @unique
  nameAr          String
  nameEn          String
  budgetTotal     Decimal            @default(0) @db.Decimal(18, 4)
  status          String             @default("ACTIVE")
  startDate       DateTime?
  endDate         DateTime?
  
  subProjects     SubProject[]
  harvestCycles   HarvestCycle[]
  journalEntries  JournalEntry[]
  journalLines    JournalEntryLine[]
  purchaseOrders  PurchaseOrder[]
  vendorBills     VendorBill[]
  salesInvoices   SalesInvoice[]
  inventoryLots   InventoryLot[]

  createdAt       DateTime           @default(now())
  updatedAt       DateTime           @updatedAt
}

model SubProject {
  id              String             @id @default(cuid())
  projectId       String
  project         Project            @relation(fields: [projectId], references: [id], onDelete: Cascade)
  code            String
  nameAr          String
  nameEn          String
  budget          Decimal            @default(0) @db.Decimal(18, 4)
  
  journalLines    JournalEntryLine[]
  purchaseOrders  PurchaseOrder[]
  
  createdAt       DateTime           @default(now())
}

model HarvestCycle {
  id              String        @id @default(cuid())
  projectId       String
  project         Project       @relation(fields: [projectId], references: [id])
  cycleNumber     Int
  name            String        // e.g. "القطفة الأولى - صيف 2026"
  isLocked        Boolean       @default(false)
  lockedAt        DateTime?
  lockedById      String?
  
  inventoryLots   InventoryLot[]
  createdAt       DateTime      @default(now())
}

// ---------------------------------------------------------
// 3. PROCUREMENT & VENDORS
// ---------------------------------------------------------

model Vendor {
  id              String         @id @default(cuid())
  code            String         @unique
  nameAr          String
  nameEn          String?
  phone           String
  email           String?
  taxRegistration String?
  address         String?
  
  accountId       String         @unique // Linked Tier 5 Payables Account
  account         Account        @relation(fields: [accountId], references: [id])
  
  purchaseOrders  PurchaseOrder[]
  bills           VendorBill[]
  payments        PaymentVoucher[]

  createdAt       DateTime       @default(now())
  updatedAt       DateTime       @updatedAt
}

model PurchaseOrder {
  id              String             @id @default(cuid())
  poNumber        String             @unique // e.g. "PO-2026-0042"
  vendorId        String
  vendor          Vendor             @relation(fields: [vendorId], references: [id])
  projectId       String
  project         Project            @relation(fields: [projectId], references: [id])
  subProjectId    String?
  subProject      SubProject?        @relation(fields: [subProjectId], references: [id])
  
  date            DateTime           @default(now())
  status          DocStatus          @default(DRAFT)
  subTotal        Decimal            @default(0) @db.Decimal(18, 4)
  taxTotal        Decimal            @default(0) @db.Decimal(18, 4)
  grandTotal      Decimal            @default(0) @db.Decimal(18, 4)
  currency        String             @default("YER")
  
  items           PurchaseOrderItem[]
  bills           VendorBill[]
  goodsReceipts   GoodsReceipt[]

  createdAt       DateTime           @default(now())
  updatedAt       DateTime           @updatedAt
}

model PurchaseOrderItem {
  id              String        @id @default(cuid())
  purchaseOrderId String
  purchaseOrder   PurchaseOrder @relation(fields: [purchaseOrderId], references: [id], onDelete: Cascade)
  description     String
  unit            String
  quantity        Decimal       @db.Decimal(12, 2)
  unitPrice       Decimal       @db.Decimal(18, 4)
  totalPrice      Decimal       @db.Decimal(18, 4)
}

model GoodsReceipt {
  id              String        @id @default(cuid())
  grnNumber       String        @unique // e.g. "GRN-2026-0012"
  purchaseOrderId String
  purchaseOrder   PurchaseOrder @relation(fields: [purchaseOrderId], references: [id])
  receivedDate    DateTime      @default(now())
  warehouseNotes  String?
}

model VendorBill {
  id              String             @id @default(cuid())
  billNumber      String             @unique // e.g. "BILL-2026-0089"
  vendorId        String
  vendor          Vendor             @relation(fields: [vendorId], references: [id])
  projectId       String
  project         Project            @relation(fields: [projectId], references: [id])
  purchaseOrderId String?
  purchaseOrder   PurchaseOrder?     @relation(fields: [purchaseOrderId], references: [id])
  
  date            DateTime
  dueDate         DateTime?
  status          DocStatus          @default(APPROVED)
  totalAmount     Decimal            @db.Decimal(18, 4)
  paidAmount      Decimal            @default(0) @db.Decimal(18, 4)
  balanceDue      Decimal            @db.Decimal(18, 4)
  currency        String             @default("YER")
  
  paymentVouchers PaymentVoucher[]
  createdAt       DateTime           @default(now())
}

model PaymentVoucher {
  id              String         @id @default(cuid())
  voucherNumber   String         @unique // e.g. "PV-2026-0034"
  date            DateTime       @default(now())
  vendorId        String
  vendor          Vendor         @relation(fields: [vendorId], references: [id])
  billId          String?
  bill            VendorBill?    @relation(fields: [billId], references: [id])
  treasuryId      String
  treasury        TreasuryAccount @relation(fields: [treasuryId], references: [id])
  
  amount          Decimal        @db.Decimal(18, 4)
  currency        String         @default("YER")
  referenceNumber String?
  notes           String?

  createdAt       DateTime       @default(now())
}

// ---------------------------------------------------------
// 4. CLIENTS, SALES & RECEIVABLES
// ---------------------------------------------------------

model Customer {
  id              String         @id @default(cuid())
  code            String         @unique
  nameAr          String
  nameEn          String?
  phone           String
  address         String?
  creditLimit     Decimal        @default(0) @db.Decimal(18, 4)
  
  accountId       String         @unique // Linked Tier 5 Receivables Account
  account         Account        @relation(fields: [accountId], references: [id])
  
  invoices        SalesInvoice[]
  receipts        ReceiptVoucher[]
}

model SalesInvoice {
  id              String           @id @default(cuid())
  invoiceNumber   String           @unique
  customerId      String
  customer        Customer         @relation(fields: [customerId], references: [id])
  projectId       String
  project         Project          @relation(fields: [projectId], references: [id])
  
  date            DateTime         @default(now())
  totalAmount     Decimal          @db.Decimal(18, 4)
  paidAmount      Decimal          @default(0) @db.Decimal(18, 4)
  balanceDue      Decimal          @db.Decimal(18, 4)
  status          DocStatus        @default(POSTED)
  currency        String           @default("YER")
  
  receipts        ReceiptVoucher[]
  createdAt       DateTime         @default(now())
}

model ReceiptVoucher {
  id              String           @id @default(cuid())
  voucherNumber   String           @unique
  date            DateTime         @default(now())
  customerId      String
  customer        Customer         @relation(fields: [customerId], references: [id])
  invoiceId       String?
  invoice         SalesInvoice?    @relation(fields: [invoiceId], references: [id])
  treasuryId      String
  treasury        TreasuryAccount   @relation(fields: [treasuryId], references: [id])
  
  amount          Decimal          @db.Decimal(18, 4)
  currency        String           @default("YER")
  notes           String?
}

// ---------------------------------------------------------
// 5. INVENTORY & LOT TRACKING
// ---------------------------------------------------------

model InventoryLot {
  id              String        @id @default(cuid())
  lotNumber       String        @unique
  projectId       String
  project         Project       @relation(fields: [projectId], references: [id])
  harvestCycleId  String?
  harvestCycle    HarvestCycle? @relation(fields: [harvestCycleId], references: [id])
  grade           String        // "صنف 1", "صنف 2", "روس", "بزغة"
  initialQuantity Decimal       @db.Decimal(12, 2)
  currentQuantity Decimal       @db.Decimal(12, 2)
  shrinkageCount  Decimal       @default(0) @db.Decimal(12, 2)
  unitCost        Decimal       @default(0) @db.Decimal(18, 4)
  createdAt       DateTime      @default(now())
}

// ---------------------------------------------------------
// 6. TREASURY & USERS
// ---------------------------------------------------------

model TreasuryAccount {
  id              String           @id @default(cuid())
  code            String           @unique
  nameAr          String
  nameEn          String
  accountId       String           @unique
  account         Account          @relation(fields: [accountId], references: [id])
  type            String           // VAULT, BANK, WALLET
  balance         Decimal          @default(0) @db.Decimal(18, 4)
  currency        String           @default("YER")
  
  paymentVouchers PaymentVoucher[]
  receiptVouchers ReceiptVoucher[]
}

model User {
  id              String           @id @default(cuid())
  username        String           @unique
  passwordHash    String
  fullName        String
  role            Role             @default(FIELD_ACCOUNTANT)
  assignedProjects String[]        // Array of project IDs
  createdAt       DateTime         @default(now())
  
  journalEntries  JournalEntry[]
  auditLogs       AuditLog[]
}

model AuditLog {
  id              String        @id @default(cuid())
  userId          String
  user            User          @relation(fields: [userId], references: [id])
  action          String        // CREATE, UPDATE, POST, VOID, LOCK
  entity          String        // "JournalEntry", "VendorBill", "HarvestCycle"
  entityId        String
  details         Json
  ipAddress       String?
  timestamp       DateTime      @default(now())
}

model Attachment {
  id              String        @id @default(cuid())
  journalEntryId  String?
  journalEntry    JournalEntry? @relation(fields: [journalEntryId], references: [id])
  fileName        String
  fileUrl         String
  fileType        String
}

```

---

## 5. Automated Accounting Ledger Posting Matrix

The coding agent must implement backend service workers that execute balanced postings atomically via `prisma.$transaction()`:

| Transaction Event | Debit Account (DR) | Credit Account (CR) | Project / Cost Center Tag |
| --- | --- | --- | --- |
| **PO -> Vendor Bill (Inventory)** | `113200` (Direct Input Inventory) | `211100` (Vendor Account) | `projectId`, `subProjectId` |
| **PO -> Vendor Bill (Direct Expense)** | `520000` (Project Expense Category) | `211100` (Vendor Account) | `projectId`, `subProjectId` |
| **Vendor Payment Voucher** | `211100` (Vendor Account) | `111100` / `111200` (Cash / Bank) | `projectId` (for tracking) |
| **Sales Invoice Generation** | `112100` (Customer Account) | `411000` (Harvest Sales Revenue) | `projectId`, `harvestCycleId` |
| **Customer Receipt Voucher** | `111100` / `111200` (Cash / Bank) | `112100` (Customer Account) | `projectId` |
| **Worker Labor Daily Accrual** | `511000` (Direct Farming Labor) | `212100` (Worker Payable) | `projectId`, `harvestCycleId` |
| **Worker Wage Payout Voucher** | `212100` (Worker Payable) | `111100` (Cash Safe) | `projectId` |

---

## 6. Recommended Enhancements for Peak Quality

1. **Three-Way Matching**: Automate verification across `Purchase Order -> Goods Receipt Note (GRN) -> Vendor Bill`. Highlight price or quantity variances before CFO approval.
2. **Offline-First PWA Synchronization**: Field accountants often operate in remote agricultural sites. Maintain a client-side Dexie IndexedDB cache that queues journal drafts and receipts offline, auto-syncing when network connectivity restores.
3. **Automated WhatsApp Bot Webhook**: Allow customers and vendors to query their current debit/credit balance or request their latest statement of account (`كشف حساب`) via WhatsApp messaging.
4. **Multi-Currency Hedging**: Calculate and book unrealized exchange rate gains/losses when reconciling foreign currency accounts against base `YER`.
5. **Role-Based Row-Level Access**: Field accountants can only view and post within their assigned projects; chief accountants and system admins maintain global ledger visibility.

---

# Coding Agent Execution Prompt

```text
You are an expert Principal Full-Stack Enterprise Architect and Senior ERP Software Engineer specializing in Next.js 16 (App Router), TypeScript, Tailwind CSS, Prisma ORM, and double-entry accounting engines.

YOUR MISSION:
Upgrade the Unified Accounting System (UAS) into an enterprise-grade ERP with an immutable Double-Entry General Ledger, a 5-tier Chart of Accounts, end-to-end Procurement, Vendor & Project Accounting, automated financial statements, and an enterprise public landing page.

REFER TO THE ATTACHED SPECIFICATION ABOVE. Execute the implementation adhering strictly to these requirements:

### PHASE 1: PRISMA SCHEMA & SEED DATA ENGINE
1. Replace and migrate `prisma/schema.prisma` with the complete 15-model schema provided in Section 4.
2. Create `prisma/seed.ts` to populate:
   - Complete 5-tier Chart of Accounts (Assets 100000, Liabilities 200000, Equity 300000, Revenue 400000, Expenses 500000).
   - Enterprise Profile ('شركة الجبري الزراعية للتنمية والاستثمار').
   - Default Main Projects ('الجبري العليا', 'الجبري الوسطى', 'الجبري السفلى') with Sub-Projects and active Harvest Cycles.
   - Seed Vendors (e.g., 'شركة التوريدات الزراعية', 'محطة الوقود المركزية') linked to specific 211100 Tier-5 Accounts.
   - Seed Customers ('فواز الجابري', 'يوسف الجابري') linked to 112100 Tier-5 Accounts.
   - Default Treasuries: Cash Vaults (YER, SAR, USD) and Banks (Kuraimi, Qutaibi).

### PHASE 2: ATOMIC DOUBLE-ENTRY TRANSACTION ENGINE
Implement `src/lib/accounting/ledgerService.ts` containing pure, atomic Prisma transaction functions:
1. `postVendorBill({ vendorId, projectId, subProjectId, items, totalAmount, currency, tx })`:
   - Creates `VendorBill`.
   - Generates and posts a balanced `JournalEntry`: DR Expense/Inventory, CR Vendor Account.
2. `postVendorPayment({ vendorId, billId, treasuryId, amount, currency, tx })`:
   - Decrements Vendor Bill balance and Treasury balance.
   - Posts `JournalEntry`: DR Vendor Account, CR Treasury Account.
3. `postSalesInvoice({ customerId, projectId, harvestCycleId, amount, currency, tx })`:
   - Creates `SalesInvoice`.
   - Posts `JournalEntry`: DR Customer Account, CR Sales Revenue.
4. `postCustomerReceipt({ customerId, invoiceId, treasuryId, amount, currency, tx })`:
   - Updates Customer balance and Treasury balance.
   - Posts `JournalEntry`: DR Treasury Account, CR Customer Account.
5. `generateFinancialReports({ fromDate, toDate, projectId })`:
   - Computes dynamic Trial Balance, Profit & Loss, and Balance Sheet purely from posted `JournalEntryLine` records.

### PHASE 3: PROCUREMENT & PROJECT LEDGER APIS
Create clean REST API routes in `src/app/api/`:
- `/api/accounting/coa`: Fetch hierarchical 5-tier account tree with live calculated balances.
- `/api/accounting/journal`: Create and fetch balanced Journal Entries with attachments.
- `/api/accounting/reports/trial-balance`: Dynamic Trial Balance.
- `/api/accounting/reports/income-statement`: Dynamic P&L per project and consolidated.
- `/api/accounting/reports/balance-sheet`: Dynamic Balance Sheet.
- `/api/procurement/pos`: Create and list Purchase Orders.
- `/api/procurement/bills`: Issue Vendor Bills with automated journal postings.
- `/api/procurement/payments`: Issue Vendor Payment Vouchers with treasury reconciliation.
- `/api/projects`: Manage Main Projects, Sub-Projects, Budgets, and Harvest Periods.

### PHASE 4: ENTERPRISE UI & MODULES (Tailwind CSS, Lucide, Chart.js)
Build modular, mobile-responsive React components in `src/components/`:
1. `LandingPage.tsx`: Public corporate landing page showing enterprise brand identity, public voucher QR verification lookup, project achievements, and system login modal.
2. `CoaTreeTab.tsx`: Interactive 5-tier Chart of Accounts tree explorer with account balance rollups and inline child creation.
3. `ProcurementTab.tsx`: Vendor management, PO creator, Bills, and Payment Voucher generator with printable PDF templates.
4. `GeneralLedgerTab.tsx`: Interactive journal entry grid, debit/credit validator, filterable by project, date, and account.
5. `FinancialReportsTab.tsx`: Executive dashboard displaying Trial Balance, Budget Variance, and P&L with SheetJS Excel export (RTL enabled) and PDF generator.
6. `ProjectsManagerTab.tsx`: Parent/Sub-project tracker with budget envelope meters and harvest lock switches.
7. `MobileBottomNav.tsx`: Responsive bottom navigation with quick '+' action sheet for rapid field voucher logging.

### PHASE 5: VERIFICATION & AUDIT
1. Run `npx prisma db push` and `npx tsx prisma/seed.ts` to ensure database integrity.
2. Execute TypeScript checks (`npx tsc --noEmit`) and ESLint (`npm run lint`).
3. Run a test accounting assertion script to verify that:
   $$\sum \text{All Debits} \equiv \sum \text{All Credits}$$
   across the entire general ledger table.

```
