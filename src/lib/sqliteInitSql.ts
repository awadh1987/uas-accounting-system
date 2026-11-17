// Auto-generated from prisma/schema.prisma by scripts/generate-sqlite-migration.mjs
// Pinned to Prisma 6.19.3 SQLite DDL — used as zero-dependency fallback for pure-runtime self-healing.

export const INITIAL_MIGRATION_NAME = "20261117000000_init";

export const EMBEDDED_SQLITE_MIGRATION_SQL = `-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "isPosting" BOOLEAN NOT NULL DEFAULT false,
    "parentCode" TEXT,
    "parentId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Account_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Account" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "JournalEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entryNumber" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "reference" TEXT,
    "narrationAr" TEXT NOT NULL,
    "narrationEn" TEXT,
    "status" TEXT NOT NULL DEFAULT 'POSTED',
    "sourceType" TEXT,
    "sourceId" TEXT,
    "projectId" TEXT,
    "subProjectId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "JournalEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "JournalEntry_subProjectId_fkey" FOREIGN KEY ("subProjectId") REFERENCES "SubProject" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "JournalEntry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "JournalEntryLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "journalEntryId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "debit" DECIMAL NOT NULL DEFAULT 0,
    "credit" DECIMAL NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'YER',
    "exchangeRate" DECIMAL NOT NULL DEFAULT 1.0,
    "debitBase" DECIMAL NOT NULL DEFAULT 0,
    "creditBase" DECIMAL NOT NULL DEFAULT 0,
    "memo" TEXT,
    "projectId" TEXT,
    "subProjectId" TEXT,
    "harvestCycleId" TEXT,
    CONSTRAINT "JournalEntryLine_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "JournalEntryLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "JournalEntryLine_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "JournalEntryLine_subProjectId_fkey" FOREIGN KEY ("subProjectId") REFERENCES "SubProject" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "JournalEntryLine_harvestCycleId_fkey" FOREIGN KEY ("harvestCycleId") REFERENCES "HarvestCycle" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "journalEntryId" TEXT,
    "fileName" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Attachment_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EnterpriseProfile" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "legalNameAr" TEXT NOT NULL,
    "legalNameEn" TEXT NOT NULL,
    "taxNumber" TEXT,
    "commercialReg" TEXT,
    "currencyCode" TEXT NOT NULL DEFAULT 'YER',
    "isConfigured" BOOLEAN NOT NULL DEFAULT false,
    "address" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "logoUrl" TEXT,
    "brandColor" TEXT NOT NULL DEFAULT '#059669',
    "showUasLogo" BOOLEAN NOT NULL DEFAULT true,
    "uasLogoStyle" TEXT NOT NULL DEFAULT 'emerald-shield',
    "uasLogoCustomUrl" TEXT,
    "showEnterpriseLogo" BOOLEAN NOT NULL DEFAULT true,
    "enterpriseLogoStyle" TEXT NOT NULL DEFAULT 'agri-leaf',
    "enterpriseLogoCustomUrl" TEXT,
    "heroBadgeAr" TEXT NOT NULL DEFAULT 'منصة محاسبة وتخطيط موارد المؤسسات الزراعية | UAS ERP 2026',
    "heroBadgeEn" TEXT NOT NULL DEFAULT 'Enterprise Agricultural Accounting & ERP | UAS 2026',
    "heroTitleAr" TEXT NOT NULL DEFAULT 'النظام المحاسبي الموحد لإدارة المشاريع الزراعية والقطفات والمخزون',
    "heroTitleEn" TEXT NOT NULL DEFAULT 'Unified Accounting System for Agricultural Projects, Harvests & Supply Chain',
    "heroSubtitleAr" TEXT NOT NULL DEFAULT 'دفتر يومية مزدوج القيد، شجرة حسابات خماسية، متابعة المشتريات والموردين، وإدارة الخزينة والبنوك والمحافظ الإلكترونية بدقة لحظية.',
    "heroSubtitleEn" TEXT NOT NULL DEFAULT 'Double-entry General Ledger, 5-tier COA, procurement & 3-way matching, and multi-currency vaults, banks & digital wallets.',
    "aboutMissionAr" TEXT NOT NULL DEFAULT 'تمكين المؤسسات الزراعية والتجارية من إدارة مشاريعها وقطفاتها ومستحقات الموردين والعملاء بشفافية مالية كاملة وتقارير فورية.',
    "aboutMissionEn" TEXT NOT NULL DEFAULT 'Empowering agricultural enterprises with full financial transparency, harvest-cycle control, and audit-ready reporting.',
    "contactPhone" TEXT NOT NULL DEFAULT '',
    "contactWhatsApp" TEXT NOT NULL DEFAULT '',
    "contactAddress" TEXT NOT NULL DEFAULT 'الجمهورية اليمنية - صنعاء',
    "showPublicMetrics" BOOLEAN NOT NULL DEFAULT true,
    "showPublicVerify" BOOLEAN NOT NULL DEFAULT true,
    "ctaPrimaryTextAr" TEXT NOT NULL DEFAULT 'دخول النظام المحاسبي',
    "ctaPrimaryTextEn" TEXT NOT NULL DEFAULT 'Enter ERP Workspace',
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SystemSettings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "orgName" TEXT NOT NULL DEFAULT 'شركة الجبري الزراعية للتنمية والاستثمار | UAS',
    "logoText" TEXT NOT NULL DEFAULT 'UAS',
    "defaultLang" TEXT NOT NULL DEFAULT 'ar',
    "defaultTheme" TEXT NOT NULL DEFAULT 'emerald',
    "defaultCurrency" TEXT NOT NULL DEFAULT 'YER',
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "CurrencyRate" (
    "currencyCode" TEXT NOT NULL PRIMARY KEY,
    "rateToYER" REAL NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'مشروع رئيسي',
    "parentProjectId" TEXT,
    "vendorId" TEXT,
    "budgetTotal" DECIMAL NOT NULL DEFAULT 0,
    "estimatedValue" REAL NOT NULL DEFAULT 0,
    "plannedHarvestCount" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "startDate" DATETIME,
    "endDate" DATETIME,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Project_parentProjectId_fkey" FOREIGN KEY ("parentProjectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Project_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProjectAcquisitionCycle" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "cycleTitle" TEXT NOT NULL,
    "startDate" DATETIME NOT NULL,
    "endDate" DATETIME NOT NULL,
    "contractAmount" DECIMAL NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'YER',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProjectAcquisitionCycle_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SubProject" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "budget" DECIMAL NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT NOT NULL DEFAULT '',
    "vendorId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SubProject_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SubProject_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "HarvestCycle" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "cycleNumber" INTEGER NOT NULL DEFAULT 1,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "lockedByUserId" TEXT,
    "lockedById" TEXT,
    "lockedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HarvestCycle_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Vendor" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "nameEn" TEXT,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "taxRegistration" TEXT,
    "address" TEXT,
    "accountId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Vendor_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "poNumber" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "subProjectId" TEXT,
    "acquisitionCycleId" TEXT,
    "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "subTotal" DECIMAL NOT NULL DEFAULT 0,
    "taxTotal" DECIMAL NOT NULL DEFAULT 0,
    "grandTotal" DECIMAL NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'YER',
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PurchaseOrder_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PurchaseOrder_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PurchaseOrder_subProjectId_fkey" FOREIGN KEY ("subProjectId") REFERENCES "SubProject" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PurchaseOrder_acquisitionCycleId_fkey" FOREIGN KEY ("acquisitionCycleId") REFERENCES "ProjectAcquisitionCycle" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PurchaseOrderItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "purchaseOrderId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "quantity" DECIMAL NOT NULL,
    "unitPrice" DECIMAL NOT NULL,
    "totalPrice" DECIMAL NOT NULL,
    CONSTRAINT "PurchaseOrderItem_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GoodsReceipt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "grnNumber" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "receivedDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receivedTotal" DECIMAL NOT NULL DEFAULT 0,
    "hasVariance" BOOLEAN NOT NULL DEFAULT false,
    "itemsSummary" TEXT,
    "warehouseNotes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GoodsReceipt_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VendorBill" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "billNumber" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "subProjectId" TEXT,
    "purchaseOrderId" TEXT,
    "acquisitionCycleId" TEXT,
    "date" DATETIME NOT NULL,
    "dueDate" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'APPROVED',
    "totalAmount" DECIMAL NOT NULL,
    "paidAmount" DECIMAL NOT NULL DEFAULT 0,
    "balanceDue" DECIMAL NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'YER',
    "isInventory" BOOLEAN NOT NULL DEFAULT false,
    "debitAccountId" TEXT,
    "journalEntryId" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VendorBill_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "VendorBill_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "VendorBill_subProjectId_fkey" FOREIGN KEY ("subProjectId") REFERENCES "SubProject" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "VendorBill_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "VendorBill_acquisitionCycleId_fkey" FOREIGN KEY ("acquisitionCycleId") REFERENCES "ProjectAcquisitionCycle" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PaymentVoucher" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "voucherNumber" TEXT NOT NULL,
    "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vendorId" TEXT NOT NULL,
    "billId" TEXT,
    "treasuryId" TEXT NOT NULL,
    "amount" DECIMAL NOT NULL,
    "transferFee" DECIMAL NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'YER',
    "referenceNumber" TEXT,
    "notes" TEXT,
    "projectId" TEXT,
    "subProjectId" TEXT,
    "acquisitionCycleId" TEXT,
    "journalEntryId" TEXT,
    "qrVerificationHash" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PaymentVoucher_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PaymentVoucher_billId_fkey" FOREIGN KEY ("billId") REFERENCES "VendorBill" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PaymentVoucher_treasuryId_fkey" FOREIGN KEY ("treasuryId") REFERENCES "TreasuryAccount" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PaymentVoucher_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PaymentVoucher_subProjectId_fkey" FOREIGN KEY ("subProjectId") REFERENCES "SubProject" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PaymentVoucher_acquisitionCycleId_fkey" FOREIGN KEY ("acquisitionCycleId") REFERENCES "ProjectAcquisitionCycle" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "nameEn" TEXT,
    "phone" TEXT NOT NULL DEFAULT '',
    "address" TEXT,
    "creditLimit" DECIMAL NOT NULL DEFAULT 0,
    "accountId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Customer_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SalesInvoice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "invoiceNumber" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "subProjectId" TEXT,
    "harvestCycleId" TEXT,
    "sequenceNumber" TEXT,
    "dailyBatchLabel" TEXT,
    "salesOfficerId" TEXT,
    "salesOfficerTitle" TEXT,
    "revenueAccountCode" TEXT DEFAULT '411101',
    "treasuryAccountId" TEXT,
    "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totalAmount" DECIMAL NOT NULL,
    "paidAmount" DECIMAL NOT NULL DEFAULT 0,
    "balanceDue" DECIMAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'POSTED',
    "currency" TEXT NOT NULL DEFAULT 'YER',
    "notes" TEXT,
    "journalEntryId" TEXT,
    "qrVerificationHash" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SalesInvoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SalesInvoice_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SalesInvoice_subProjectId_fkey" FOREIGN KEY ("subProjectId") REFERENCES "SubProject" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SalesInvoice_harvestCycleId_fkey" FOREIGN KEY ("harvestCycleId") REFERENCES "HarvestCycle" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SalesInvoice_treasuryAccountId_fkey" FOREIGN KEY ("treasuryAccountId") REFERENCES "TreasuryAccount" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReceiptVoucher" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "voucherNumber" TEXT NOT NULL,
    "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "customerId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "treasuryId" TEXT NOT NULL,
    "subProjectId" TEXT,
    "amount" DECIMAL NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'YER',
    "notes" TEXT,
    "journalEntryId" TEXT,
    "qrVerificationHash" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReceiptVoucher_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReceiptVoucher_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "SalesInvoice" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ReceiptVoucher_treasuryId_fkey" FOREIGN KEY ("treasuryId") REFERENCES "TreasuryAccount" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReceiptVoucher_subProjectId_fkey" FOREIGN KEY ("subProjectId") REFERENCES "SubProject" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InventoryLot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "lotNumber" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "harvestCycleId" TEXT,
    "grade" TEXT NOT NULL,
    "initialQuantity" DECIMAL NOT NULL,
    "currentQuantity" DECIMAL NOT NULL,
    "shrinkageCount" DECIMAL NOT NULL DEFAULT 0,
    "unitCost" DECIMAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InventoryLot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "InventoryLot_harvestCycleId_fkey" FOREIGN KEY ("harvestCycleId") REFERENCES "HarvestCycle" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "HarvestInventoryBatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "subProjectId" TEXT,
    "harvestCycleId" TEXT,
    "harvestName" TEXT NOT NULL,
    "productGrade" TEXT NOT NULL,
    "harvestedBundles" INTEGER NOT NULL,
    "shrinkageBundles" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HarvestInventoryBatch_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "HarvestInventoryBatch_subProjectId_fkey" FOREIGN KEY ("subProjectId") REFERENCES "SubProject" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "HarvestInventoryBatch_harvestCycleId_fkey" FOREIGN KEY ("harvestCycleId") REFERENCES "HarvestCycle" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TreasuryAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'VAULT',
    "providerNameAr" TEXT NOT NULL DEFAULT '',
    "providerNameEn" TEXT NOT NULL DEFAULT '',
    "accountHolderName" TEXT NOT NULL DEFAULT '',
    "accountNumber" TEXT NOT NULL,
    "ibanOrSwift" TEXT NOT NULL DEFAULT '',
    "branchOrAgent" TEXT NOT NULL DEFAULT '',
    "transferFeePercent" REAL NOT NULL DEFAULT 0,
    "dailyLimit" DECIMAL NOT NULL DEFAULT 0,
    "isDefaultReceipts" BOOLEAN NOT NULL DEFAULT false,
    "isDefaultPayments" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT NOT NULL DEFAULT '',
    "accountId" TEXT NOT NULL,
    "balance" DECIMAL NOT NULL DEFAULT 0,
    "balanceYER" REAL NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'YER',
    "currencyCode" TEXT NOT NULL DEFAULT 'YER',
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TreasuryAccount_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OperatingExpense" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "subProjectId" TEXT,
    "harvestCycleId" TEXT,
    "harvestName" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "subType" TEXT NOT NULL,
    "quantity" REAL NOT NULL DEFAULT 1,
    "unitPrice" REAL NOT NULL DEFAULT 0,
    "totalAmount" REAL NOT NULL DEFAULT 0,
    "expenseDate" TEXT NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "journalEntryId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OperatingExpense_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OperatingExpense_subProjectId_fkey" FOREIGN KEY ("subProjectId") REFERENCES "SubProject" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "OperatingExpense_harvestCycleId_fkey" FOREIGN KEY ("harvestCycleId") REFERENCES "HarvestCycle" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Worker" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL DEFAULT '',
    "defaultDailyWage" REAL NOT NULL DEFAULT 0,
    "accountId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Worker_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WorkerWageEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workerId" TEXT NOT NULL,
    "workerName" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "subProjectId" TEXT,
    "harvestCycleId" TEXT,
    "harvestName" TEXT NOT NULL,
    "dailyWage" REAL NOT NULL,
    "daysWorked" REAL NOT NULL,
    "totalWage" REAL NOT NULL,
    "creditAmount" REAL NOT NULL DEFAULT 0,
    "debitBalance" REAL NOT NULL,
    "workDate" TEXT NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "journalEntryId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkerWageEntry_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WorkerWageEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WorkerWageEntry_subProjectId_fkey" FOREIGN KEY ("subProjectId") REFERENCES "SubProject" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "WorkerWageEntry_harvestCycleId_fkey" FOREIGN KEY ("harvestCycleId") REFERENCES "HarvestCycle" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SaleTransaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sequenceNumber" TEXT,
    "dailyBatchLabel" TEXT,
    "salesOfficerId" TEXT,
    "salesOfficerTitle" TEXT,
    "revenueAccountCode" TEXT NOT NULL DEFAULT '411101',
    "treasuryAccountId" TEXT,
    "projectId" TEXT NOT NULL,
    "subProjectId" TEXT,
    "harvestCycleId" TEXT,
    "harvestName" TEXT NOT NULL,
    "saleBatchLabel" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "productGrade" TEXT NOT NULL,
    "bundlesCount" INTEGER NOT NULL,
    "unitPrice" REAL NOT NULL,
    "totalAmount" REAL NOT NULL,
    "creditPaid" REAL NOT NULL DEFAULT 0,
    "debitReceivable" REAL NOT NULL,
    "saleDate" TEXT NOT NULL,
    "receiptVoucherNo" TEXT NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "journalEntryId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SaleTransaction_treasuryAccountId_fkey" FOREIGN KEY ("treasuryAccountId") REFERENCES "TreasuryAccount" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SaleTransaction_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SaleTransaction_subProjectId_fkey" FOREIGN KEY ("subProjectId") REFERENCES "SubProject" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SaleTransaction_harvestCycleId_fkey" FOREIGN KEY ("harvestCycleId") REFERENCES "HarvestCycle" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SaleTransaction_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InstallmentVoucher" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "voucherNo" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "saleTransactionId" TEXT,
    "workerWageEntryId" TEXT,
    "targetName" TEXT NOT NULL,
    "phone" TEXT NOT NULL DEFAULT '',
    "treasuryAccountId" TEXT NOT NULL,
    "amountYER" REAL NOT NULL,
    "qrVerificationHash" TEXT NOT NULL,
    "paymentDate" TEXT NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "journalEntryId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InstallmentVoucher_saleTransactionId_fkey" FOREIGN KEY ("saleTransactionId") REFERENCES "SaleTransaction" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "InstallmentVoucher_workerWageEntryId_fkey" FOREIGN KEY ("workerWageEntryId") REFERENCES "WorkerWageEntry" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "InstallmentVoucher_treasuryAccountId_fkey" FOREIGN KEY ("treasuryAccountId") REFERENCES "TreasuryAccount" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "displayName" TEXT,
    "phone" TEXT,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'FIELD_ACCOUNTANT',
    "department" TEXT NOT NULL DEFAULT 'المالية والعمليات',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "avatarChar" TEXT NOT NULL DEFAULT 'م',
    "avatarUrl" TEXT,
    "avatarColor" TEXT NOT NULL DEFAULT '#059669',
    "preferredLang" TEXT NOT NULL DEFAULT 'ar',
    "preferredCurrency" TEXT NOT NULL DEFAULT 'YER',
    "preferredTheme" TEXT NOT NULL DEFAULT 'emerald',
    "defaultModule" TEXT,
    "lastLoginAt" DATETIME,
    "useCustomPermissions" BOOLEAN NOT NULL DEFAULT false,
    "customAllowedGroups" TEXT NOT NULL DEFAULT '[]',
    "customPermissionsJson" TEXT NOT NULL DEFAULT '{}',
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "passwordUpdatedAt" DATETIME,
    "assignedProjects" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "ipAddress" TEXT,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ImmutableAuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "timestamp" TEXT NOT NULL,
    "userId" TEXT,
    "userDisplay" TEXT NOT NULL,
    "userRole" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "entityReference" TEXT NOT NULL,
    "details" TEXT NOT NULL,
    "sha256Hash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AdjustmentEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT,
    "harvestCycleId" TEXT,
    "periodLabel" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "amountYER" REAL NOT NULL,
    "createdByUser" TEXT NOT NULL,
    "journalEntryId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdjustmentEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AdjustmentEntry_harvestCycleId_fkey" FOREIGN KEY ("harvestCycleId") REFERENCES "HarvestCycle" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LicenseState" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'active',
    "license_id" TEXT,
    "customer_name" TEXT,
    "hwid_hash" TEXT,
    "last_verified_utc" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'UNLICENSED',
    "seat_registry_json" TEXT NOT NULL DEFAULT '[]',
    "license_data_json" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Account_code_key" ON "Account"("code");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_entryNumber_key" ON "JournalEntry"("entryNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Project_code_key" ON "Project"("code");

-- CreateIndex
CREATE UNIQUE INDEX "SubProject_projectId_code_key" ON "SubProject"("projectId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "HarvestCycle_projectId_name_key" ON "HarvestCycle"("projectId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Vendor_code_key" ON "Vendor"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Vendor_accountId_key" ON "Vendor"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_poNumber_key" ON "PurchaseOrder"("poNumber");

-- CreateIndex
CREATE UNIQUE INDEX "GoodsReceipt_grnNumber_key" ON "GoodsReceipt"("grnNumber");

-- CreateIndex
CREATE UNIQUE INDEX "VendorBill_billNumber_key" ON "VendorBill"("billNumber");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentVoucher_voucherNumber_key" ON "PaymentVoucher"("voucherNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_code_key" ON "Customer"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_name_key" ON "Customer"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_accountId_key" ON "Customer"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesInvoice_invoiceNumber_key" ON "SalesInvoice"("invoiceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ReceiptVoucher_voucherNumber_key" ON "ReceiptVoucher"("voucherNumber");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryLot_lotNumber_key" ON "InventoryLot"("lotNumber");

-- CreateIndex
CREATE UNIQUE INDEX "TreasuryAccount_code_key" ON "TreasuryAccount"("code");

-- CreateIndex
CREATE UNIQUE INDEX "TreasuryAccount_accountId_key" ON "TreasuryAccount"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "Worker_name_key" ON "Worker"("name");

-- CreateIndex
CREATE UNIQUE INDEX "InstallmentVoucher_voucherNo_key" ON "InstallmentVoucher"("voucherNo");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");`;
