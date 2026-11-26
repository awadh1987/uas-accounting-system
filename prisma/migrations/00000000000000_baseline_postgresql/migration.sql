-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SUPER_ADMIN', 'PROJECT_MANAGER', 'CHIEF_ACCOUNTANT', 'PROCUREMENT_OFFICER', 'SALES_COLLECTOR', 'FIELD_ACCOUNTANT', 'EXTERNAL_AUDITOR');

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "isPosting" BOOLEAN NOT NULL DEFAULT false,
    "parentCode" TEXT,
    "parentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "generation" INTEGER NOT NULL DEFAULT 1,
    "parentAccountId" TEXT,
    "isPostable" BOOLEAN NOT NULL DEFAULT false,
    "subLedgerType" TEXT,
    "subLedgerEntityId" TEXT,
    "defaultCostCenterId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalEntry" (
    "id" TEXT NOT NULL,
    "entryNumber" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "reference" TEXT,
    "narrationAr" TEXT NOT NULL,
    "narrationEn" TEXT,
    "status" TEXT NOT NULL DEFAULT 'POSTED',
    "sourceType" TEXT,
    "sourceId" TEXT,
    "entryType" TEXT NOT NULL DEFAULT 'NORMAL',
    "fiscalYearId" TEXT,
    "projectId" TEXT,
    "subProjectId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "documentStatus" TEXT NOT NULL DEFAULT 'POSTED',
    "revisionNumber" INTEGER NOT NULL DEFAULT 1,
    "isReversed" BOOLEAN NOT NULL DEFAULT false,
    "reversedByEntryId" TEXT,

    CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalEntryLine" (
    "id" TEXT NOT NULL,
    "journalEntryId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "debit" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "credit" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'YER',
    "currencyCode" TEXT NOT NULL DEFAULT 'YER',
    "exchangeRate" DECIMAL(65,30) NOT NULL DEFAULT 1.0,
    "foreignDebit" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "foreignCredit" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "debitBase" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "creditBase" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "baseDebit" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "baseCredit" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "memo" TEXT,
    "projectId" TEXT,
    "subProjectId" TEXT,
    "harvestCycleId" TEXT,
    "costCenterId" TEXT,

    CONSTRAINT "JournalEntryLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "journalEntryId" TEXT,
    "fileName" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnterpriseProfile" (
    "id" TEXT NOT NULL DEFAULT 'default',
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
    "faviconUrl" TEXT,
    "brandColor" TEXT NOT NULL DEFAULT '#059669',
    "taglineAr" TEXT NOT NULL DEFAULT '',
    "taglineEn" TEXT NOT NULL DEFAULT '',
    "showUasLogo" BOOLEAN NOT NULL DEFAULT true,
    "uasLogoStyle" TEXT NOT NULL DEFAULT 'official-brand',
    "uasLogoCustomUrl" TEXT,
    "showEnterpriseLogo" BOOLEAN NOT NULL DEFAULT false,
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
    "tenantSlug" TEXT,
    "welcomeNoticeAr" TEXT NOT NULL DEFAULT '',
    "welcomeNoticeEn" TEXT NOT NULL DEFAULT '',
    "supportEmail" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EnterpriseProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "orgName" TEXT NOT NULL DEFAULT 'شركة الجبري الزراعية للتنمية والاستثمار | UAS',
    "logoText" TEXT NOT NULL DEFAULT 'UAS',
    "defaultLang" TEXT NOT NULL DEFAULT 'ar',
    "defaultTheme" TEXT NOT NULL DEFAULT 'emerald',
    "defaultCurrency" TEXT NOT NULL DEFAULT 'YER',
    "fiscalYearStart" TEXT DEFAULT '2026-01-01',
    "fiscalYearEnd" TEXT DEFAULT '2026-12-31',
    "periodLockDate" TEXT,
    "requireApprovalWorkflow" BOOLEAN NOT NULL DEFAULT false,
    "enforceThreeWayMatch" BOOLEAN NOT NULL DEFAULT true,
    "threeWayTolerancePct" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "threeWayToleranceAmount" DECIMAL(65,30) NOT NULL DEFAULT 0.01,
    "costingMethod" TEXT NOT NULL DEFAULT 'WEIGHTED_AVERAGE',
    "negativeStockPolicy" TEXT NOT NULL DEFAULT 'BLOCK',
    "printLayout" TEXT NOT NULL DEFAULT 'A4',
    "controlAccountsJson" TEXT NOT NULL DEFAULT '{}',
    "documentSequencesJson" TEXT NOT NULL DEFAULT '{}',
    "autoSyncEnabled" BOOLEAN NOT NULL DEFAULT true,
    "autoSyncIntervalSec" INTEGER NOT NULL DEFAULT 60,
    "defaultDeviceSyncMode" TEXT NOT NULL DEFAULT 'AUTO',
    "requireDeviceApproval" BOOLEAN NOT NULL DEFAULT false,
    "tenantAdminConfigJson" TEXT NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CurrencyRate" (
    "currencyCode" TEXT NOT NULL,
    "rateToYER" DECIMAL(65,30) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CurrencyRate_pkey" PRIMARY KEY ("currencyCode")
);

-- CreateTable
CREATE TABLE "Currency" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "symbol" TEXT NOT NULL DEFAULT '',
    "decimalPlaces" INTEGER NOT NULL DEFAULT 2,
    "isBaseCurrency" BOOLEAN NOT NULL DEFAULT false,
    "isCustom" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Currency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExchangeRate" (
    "id" TEXT NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "rateDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "buyRate" DECIMAL(65,30) NOT NULL,
    "sellRate" DECIMAL(65,30) NOT NULL,
    "midRate" DECIMAL(65,30) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExchangeRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'مشروع رئيسي',
    "parentProjectId" TEXT,
    "vendorId" TEXT,
    "budgetTotal" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "estimatedValue" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "plannedHarvestCount" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "glAccountId" TEXT,
    "costCenterId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectAcquisitionCycle" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "cycleTitle" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "contractAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'YER',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectAcquisitionCycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubProject" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "budget" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT NOT NULL DEFAULT '',
    "vendorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HarvestCycle" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "cycleNumber" INTEGER NOT NULL DEFAULT 1,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "lockedByUserId" TEXT,
    "lockedById" TEXT,
    "lockedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HarvestCycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vendor" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "nameEn" TEXT,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "taxRegistration" TEXT,
    "address" TEXT,
    "accountId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "glAccountId" TEXT,
    "costCenterId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" TEXT NOT NULL,
    "poNumber" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "subProjectId" TEXT,
    "acquisitionCycleId" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "subTotal" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "taxTotal" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "grandTotal" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'YER',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderItem" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "quantity" DECIMAL(65,30) NOT NULL,
    "unitPrice" DECIMAL(65,30) NOT NULL,
    "totalPrice" DECIMAL(65,30) NOT NULL,

    CONSTRAINT "PurchaseOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoodsReceipt" (
    "id" TEXT NOT NULL,
    "grnNumber" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "warehouseId" TEXT,
    "journalEntryId" TEXT,
    "receivedDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receivedTotal" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "hasVariance" BOOLEAN NOT NULL DEFAULT false,
    "itemsSummary" TEXT,
    "itemsJson" TEXT,
    "warehouseNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoodsReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorBill" (
    "id" TEXT NOT NULL,
    "billNumber" TEXT NOT NULL,
    "billType" TEXT NOT NULL DEFAULT 'BILL',
    "originalBillId" TEXT,
    "vendorId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "subProjectId" TEXT,
    "purchaseOrderId" TEXT,
    "acquisitionCycleId" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'APPROVED',
    "subTotal" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "whtAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(65,30) NOT NULL,
    "paidAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "balanceDue" DECIMAL(65,30) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'YER',
    "currencyCode" TEXT NOT NULL DEFAULT 'YER',
    "exchangeRate" DECIMAL(65,30) NOT NULL DEFAULT 1.0,
    "foreignAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "baseAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "isInventory" BOOLEAN NOT NULL DEFAULT false,
    "debitAccountId" TEXT,
    "journalEntryId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "costCenterId" TEXT,
    "documentStatus" TEXT NOT NULL DEFAULT 'POSTED',
    "revisionNumber" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "VendorBill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorBillItem" (
    "id" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "itemId" TEXT,
    "warehouseId" TEXT,
    "taxCodeId" TEXT,
    "description" TEXT NOT NULL,
    "unitId" TEXT,
    "quantity" DECIMAL(65,30) NOT NULL,
    "unitPrice" DECIMAL(65,30) NOT NULL,
    "netAmount" DECIMAL(65,30) NOT NULL,
    "taxAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "whtAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(65,30) NOT NULL,

    CONSTRAINT "VendorBillItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentVoucher" (
    "id" TEXT NOT NULL,
    "voucherNumber" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vendorId" TEXT NOT NULL,
    "billId" TEXT,
    "allocationsJson" TEXT,
    "treasuryId" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "transferFee" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'YER',
    "currencyCode" TEXT NOT NULL DEFAULT 'YER',
    "exchangeRate" DECIMAL(65,30) NOT NULL DEFAULT 1.0,
    "foreignAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "baseAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "referenceNumber" TEXT,
    "notes" TEXT,
    "projectId" TEXT,
    "subProjectId" TEXT,
    "acquisitionCycleId" TEXT,
    "journalEntryId" TEXT,
    "qrVerificationHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "costCenterId" TEXT,
    "documentStatus" TEXT NOT NULL DEFAULT 'POSTED',
    "revisionNumber" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "PaymentVoucher_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "tenantSlug" TEXT NOT NULL DEFAULT 'default',
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "nameEn" TEXT,
    "phone" TEXT NOT NULL DEFAULT '',
    "address" TEXT,
    "creditLimit" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "accountId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "glAccountId" TEXT,
    "costCenterId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesInvoice" (
    "id" TEXT NOT NULL,
    "tenantSlug" TEXT NOT NULL DEFAULT 'default',
    "invoiceNumber" TEXT NOT NULL,
    "invoiceType" TEXT NOT NULL DEFAULT 'INVOICE',
    "originalInvoiceId" TEXT,
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
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" TIMESTAMP(3),
    "subTotal" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "whtAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(65,30) NOT NULL,
    "paidAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "balanceDue" DECIMAL(65,30) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'POSTED',
    "currency" TEXT NOT NULL DEFAULT 'YER',
    "currencyCode" TEXT NOT NULL DEFAULT 'YER',
    "exchangeRate" DECIMAL(65,30) NOT NULL DEFAULT 1.0,
    "foreignAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "baseAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "journalEntryId" TEXT,
    "cogsJournalEntryId" TEXT,
    "qrVerificationHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "costCenterId" TEXT,
    "documentStatus" TEXT NOT NULL DEFAULT 'POSTED',
    "revisionNumber" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "SalesInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesInvoiceItem" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "itemId" TEXT,
    "warehouseId" TEXT,
    "taxCodeId" TEXT,
    "description" TEXT NOT NULL,
    "unitId" TEXT,
    "quantity" DECIMAL(65,30) NOT NULL,
    "unitPrice" DECIMAL(65,30) NOT NULL,
    "netAmount" DECIMAL(65,30) NOT NULL,
    "taxAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "whtAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(65,30) NOT NULL,
    "costOfGoodsSold" DECIMAL(65,30) NOT NULL DEFAULT 0,

    CONSTRAINT "SalesInvoiceItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceiptVoucher" (
    "id" TEXT NOT NULL,
    "tenantSlug" TEXT NOT NULL DEFAULT 'default',
    "voucherNumber" TEXT NOT NULL,
    "linkedPaymentReceiptId" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "customerId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "allocationsJson" TEXT,
    "treasuryId" TEXT NOT NULL,
    "subProjectId" TEXT,
    "amount" DECIMAL(65,30) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'YER',
    "currencyCode" TEXT NOT NULL DEFAULT 'YER',
    "exchangeRate" DECIMAL(65,30) NOT NULL DEFAULT 1.0,
    "foreignAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "baseAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "journalEntryId" TEXT,
    "qrVerificationHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "costCenterId" TEXT,
    "documentStatus" TEXT NOT NULL DEFAULT 'POSTED',
    "revisionNumber" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ReceiptVoucher_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryLot" (
    "id" TEXT NOT NULL,
    "lotNumber" TEXT NOT NULL,
    "projectId" TEXT,
    "harvestCycleId" TEXT,
    "itemId" TEXT,
    "warehouseId" TEXT,
    "grade" TEXT NOT NULL,
    "initialQuantity" DECIMAL(65,30) NOT NULL,
    "currentQuantity" DECIMAL(65,30) NOT NULL,
    "shrinkageCount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "unitCost" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "receivedDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryLot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HarvestInventoryBatch" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "subProjectId" TEXT,
    "harvestCycleId" TEXT,
    "harvestName" TEXT NOT NULL,
    "productGrade" TEXT NOT NULL,
    "harvestedBundles" INTEGER NOT NULL,
    "shrinkageBundles" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HarvestInventoryBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TreasuryAccount" (
    "id" TEXT NOT NULL,
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
    "transferFeePercent" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "dailyLimit" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "isDefaultReceipts" BOOLEAN NOT NULL DEFAULT false,
    "isDefaultPayments" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT NOT NULL DEFAULT '',
    "accountId" TEXT NOT NULL,
    "balance" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "balanceYER" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'YER',
    "currencyCode" TEXT NOT NULL DEFAULT 'YER',
    "gatewayProvider" TEXT NOT NULL DEFAULT 'MANUAL',
    "gatewayMerchantId" TEXT,
    "gatewayEndpointUrl" TEXT,
    "gatewayCredentialsEnc" TEXT,
    "isSandbox" BOOLEAN NOT NULL DEFAULT true,
    "dailyUsedAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "lastDailyResetDate" TEXT,
    "archivedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TreasuryAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperatingExpense" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "subProjectId" TEXT,
    "harvestCycleId" TEXT,
    "harvestName" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "subType" TEXT NOT NULL,
    "quantity" DECIMAL(65,30) NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "taxCodeId" TEXT,
    "netAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "whtAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "expenseDate" TEXT NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "journalEntryId" TEXT,
    "documentStatus" TEXT NOT NULL DEFAULT 'POSTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OperatingExpense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Worker" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL DEFAULT '',
    "defaultDailyWage" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "accountId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "glAccountId" TEXT,
    "costCenterId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "Worker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkerWageEntry" (
    "id" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "workerName" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "subProjectId" TEXT,
    "harvestCycleId" TEXT,
    "harvestName" TEXT NOT NULL,
    "dailyWage" DECIMAL(65,30) NOT NULL,
    "daysWorked" DECIMAL(65,30) NOT NULL,
    "totalWage" DECIMAL(65,30) NOT NULL,
    "creditAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "debitBalance" DECIMAL(65,30) NOT NULL,
    "workDate" TEXT NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "journalEntryId" TEXT,
    "documentStatus" TEXT NOT NULL DEFAULT 'POSTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkerWageEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaleTransaction" (
    "id" TEXT NOT NULL,
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
    "unitPrice" DECIMAL(65,30) NOT NULL,
    "totalAmount" DECIMAL(65,30) NOT NULL,
    "creditPaid" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "debitReceivable" DECIMAL(65,30) NOT NULL,
    "saleDate" TEXT NOT NULL,
    "receiptVoucherNo" TEXT NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "journalEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SaleTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstallmentVoucher" (
    "id" TEXT NOT NULL,
    "voucherNo" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "saleTransactionId" TEXT,
    "workerWageEntryId" TEXT,
    "targetName" TEXT NOT NULL,
    "phone" TEXT NOT NULL DEFAULT '',
    "treasuryAccountId" TEXT NOT NULL,
    "amountYER" DECIMAL(65,30) NOT NULL,
    "qrVerificationHash" TEXT NOT NULL,
    "paymentDate" TEXT NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "journalEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InstallmentVoucher_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "displayName" TEXT,
    "phone" TEXT,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'FIELD_ACCOUNTANT',
    "department" TEXT NOT NULL DEFAULT 'المالية والعمليات',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "archivedAt" TIMESTAMP(3),
    "avatarChar" TEXT NOT NULL DEFAULT 'م',
    "avatarUrl" TEXT,
    "avatarColor" TEXT NOT NULL DEFAULT '#059669',
    "preferredLang" TEXT NOT NULL DEFAULT 'ar',
    "preferredCurrency" TEXT NOT NULL DEFAULT 'YER',
    "preferredTheme" TEXT NOT NULL DEFAULT 'emerald',
    "defaultModule" TEXT,
    "lastLoginAt" TIMESTAMP(3),
    "useCustomPermissions" BOOLEAN NOT NULL DEFAULT false,
    "customAllowedGroups" TEXT NOT NULL DEFAULT '[]',
    "customPermissionsJson" TEXT NOT NULL DEFAULT '{}',
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "passwordUpdatedAt" TIMESTAMP(3),
    "assignedProjects" TEXT NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "ipAddress" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImmutableAuditLog" (
    "id" TEXT NOT NULL,
    "timestamp" TEXT NOT NULL,
    "userId" TEXT,
    "userDisplay" TEXT NOT NULL,
    "userRole" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "entityReference" TEXT NOT NULL,
    "details" TEXT NOT NULL,
    "sha256Hash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImmutableAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdjustmentEntry" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "harvestCycleId" TEXT,
    "periodLabel" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "amountYER" DECIMAL(65,30) NOT NULL,
    "createdByUser" TEXT NOT NULL,
    "journalEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdjustmentEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LicenseState" (
    "id" TEXT NOT NULL DEFAULT 'active',
    "license_id" TEXT,
    "customer_name" TEXT,
    "hwid_hash" TEXT,
    "last_verified_utc" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'UNLICENSED',
    "seat_registry_json" TEXT NOT NULL DEFAULT '[]',
    "license_data_json" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LicenseState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LicenseDeviceBinding" (
    "id" TEXT NOT NULL,
    "licenseId" TEXT NOT NULL,
    "userEmail" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "hwid" TEXT NOT NULL,
    "deviceName" TEXT NOT NULL DEFAULT '',
    "activatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "LicenseDeviceBinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TreasuryTransaction" (
    "id" TEXT NOT NULL,
    "treasuryId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "currencyCode" TEXT NOT NULL DEFAULT 'YER',
    "exchangeRate" DECIMAL(65,30) NOT NULL DEFAULT 1.0,
    "foreignAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "baseAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "notes" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TreasuryTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnitOfMeasure" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "isBaseDefault" BOOLEAN NOT NULL DEFAULT false,
    "isCustom" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UnitOfMeasure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemCategory" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "parentId" TEXT,
    "isCustom" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ItemCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Warehouse" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "location" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isCustom" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "glAccountId" TEXT,
    "costCenterId" TEXT,

    CONSTRAINT "Warehouse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryItem" (
    "id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "barcode" TEXT,
    "nameAr" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "categoryId" TEXT,
    "itemType" TEXT NOT NULL DEFAULT 'STOCKABLE',
    "sectorType" TEXT NOT NULL DEFAULT 'HARVEST',
    "grade" TEXT,
    "origin" TEXT,
    "producerCompany" TEXT,
    "countryOfOrigin" TEXT,
    "productionDate" TEXT,
    "expiryDate" TEXT,
    "baseUnitId" TEXT NOT NULL,
    "defaultWarehouseId" TEXT,
    "purchasePrice" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "dispatchCost" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "taxRate" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "wholesalePrice" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "retailPrice" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "minSellPrice" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "minStockAlert" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "maxStockLevel" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "inventoryAccountId" TEXT,
    "cogsAccountId" TEXT,
    "revenueAccountId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemUnitConversion" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "customUnitLabel" TEXT,
    "factorToBase" DECIMAL(65,30) NOT NULL,
    "barcode" TEXT,
    "purchasePrice" DECIMAL(65,30),
    "sellPrice" DECIMAL(65,30),
    "isDefaultSalesUnit" BOOLEAN NOT NULL DEFAULT false,
    "isDefaultPurchaseUnit" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ItemUnitConversion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockBalance" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "qtyOnHandBase" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "avgUnitCostBase" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "movementType" TEXT NOT NULL,
    "enteredQty" DECIMAL(65,30) NOT NULL,
    "enteredUnitId" TEXT NOT NULL,
    "factorToBase" DECIMAL(65,30) NOT NULL DEFAULT 1,
    "baseQtyDelta" DECIMAL(65,30) NOT NULL,
    "unitCostBase" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "costCenterId" TEXT,
    "documentStatus" TEXT NOT NULL DEFAULT 'POSTED',
    "revisionNumber" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostCenter" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "parentId" TEXT,
    "generation" INTEGER NOT NULL DEFAULT 1,
    "centerType" TEXT NOT NULL DEFAULT 'OTHER',
    "customLabel" TEXT,
    "isCustom" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CostCenter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FiscalYear" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "closingJournalEntryId" TEXT,
    "openingJournalEntryId" TEXT,
    "retainedEarningsAccountId" TEXT,
    "netProfitLossBase" DECIMAL(65,30),
    "closedById" TEXT,
    "closedByName" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FiscalYear_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountingPeriod" (
    "id" TEXT NOT NULL,
    "fiscalYearId" TEXT,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "closedById" TEXT,
    "closedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountingPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "taxType" TEXT NOT NULL DEFAULT 'VAT',
    "ratePct" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "isCompound" BOOLEAN NOT NULL DEFAULT false,
    "isInclusive" BOOLEAN NOT NULL DEFAULT false,
    "salesTaxAccountCode" TEXT DEFAULT '214101',
    "purchaseTaxAccountCode" TEXT DEFAULT '114301',
    "whtAccountCode" TEXT DEFAULT '214201',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxRate" (
    "id" TEXT NOT NULL,
    "taxCodeId" TEXT NOT NULL,
    "ratePct" DECIMAL(65,30) NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaxRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceDraft" (
    "id" TEXT NOT NULL,
    "draftNumber" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "formType" TEXT NOT NULL,
    "entityId" TEXT,
    "titleAr" TEXT NOT NULL,
    "titleEn" TEXT NOT NULL DEFAULT '',
    "payloadJson" TEXT NOT NULL,
    "totalAmount" DECIMAL(65,30),
    "currencyCode" TEXT NOT NULL DEFAULT 'YER',
    "visibility" TEXT NOT NULL DEFAULT 'SHARED_WORKSPACE',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE_DRAFT',
    "convertedEntityId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "updatedById" TEXT,
    "updatedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalRule" (
    "id" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "minAmountBase" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "currencyCode" TEXT NOT NULL DEFAULT 'YER',
    "requiredRole" TEXT NOT NULL DEFAULT 'CHIEF_ACCOUNTANT',
    "approverUserIdsJson" TEXT NOT NULL DEFAULT '[]',
    "allowSelfApproval" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalRequest" (
    "id" TEXT NOT NULL,
    "requestNumber" TEXT NOT NULL,
    "ruleId" TEXT,
    "module" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "documentNumber" TEXT NOT NULL,
    "summaryAr" TEXT NOT NULL,
    "summaryEn" TEXT NOT NULL DEFAULT '',
    "amountBase" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "currencyCode" TEXT NOT NULL DEFAULT 'YER',
    "beforeSnapshotJson" TEXT,
    "afterSnapshotJson" TEXT NOT NULL,
    "reasonAr" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requestedById" TEXT NOT NULL,
    "requestedByName" TEXT NOT NULL,
    "reviewedById" TEXT,
    "reviewedByName" TEXT,
    "reviewNotes" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyRecord" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "userId" TEXT,
    "statusCode" INTEGER NOT NULL,
    "responseJson" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankPaymentDispatch" (
    "id" TEXT NOT NULL,
    "dispatchNumber" TEXT NOT NULL,
    "treasuryAccountId" TEXT NOT NULL,
    "sourceVoucherType" TEXT NOT NULL,
    "sourceVoucherId" TEXT NOT NULL,
    "beneficiaryName" TEXT NOT NULL,
    "beneficiaryAccountOrPhone" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "feeAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "currencyCode" TEXT NOT NULL DEFAULT 'YER',
    "exchangeRate" DECIMAL(65,30) NOT NULL DEFAULT 1,
    "baseAmount" DECIMAL(65,30) NOT NULL,
    "provider" TEXT NOT NULL,
    "externalReferenceId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "rawResponseJson" TEXT,
    "errorMessage" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "costCenterId" TEXT,
    "journalEntryId" TEXT,
    "executedById" TEXT NOT NULL,
    "executedByName" TEXT NOT NULL,
    "executedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankPaymentDispatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncChangeLog" (
    "cursor" SERIAL NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "deviceId" TEXT,
    "actorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncChangeLog_pkey" PRIMARY KEY ("cursor")
);

-- CreateTable
CREATE TABLE "SyncConflict" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "deviceId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'CONFLICT_PENDING',
    "reason" TEXT NOT NULL,
    "clientPayloadJson" TEXT NOT NULL,
    "serverSnapshotJson" TEXT NOT NULL,
    "resolutionNotes" TEXT,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncConflict_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationEvent" (
    "id" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'general',
    "severity" TEXT NOT NULL DEFAULT 'INFO',
    "titleAr" TEXT NOT NULL,
    "titleEn" TEXT NOT NULL,
    "messageAr" TEXT NOT NULL,
    "messageEn" TEXT NOT NULL,
    "targetTab" TEXT,
    "targetEntityType" TEXT,
    "targetEntityId" TEXT,
    "recipientUserId" TEXT,
    "actorUserId" TEXT,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "metadataJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantDevice" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "tenantSlug" TEXT NOT NULL DEFAULT 'default',
    "activationKey" TEXT,
    "platform" TEXT NOT NULL,
    "appVersion" TEXT NOT NULL DEFAULT '1.0.0',
    "osVersion" TEXT NOT NULL DEFAULT '',
    "deviceLabel" TEXT NOT NULL DEFAULT '',
    "userId" TEXT,
    "userEmail" TEXT,
    "userDisplay" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "syncMode" TEXT NOT NULL DEFAULT 'AUTO',
    "syncIntervalSec" INTEGER NOT NULL DEFAULT 60,
    "pendingQueueCount" INTEGER NOT NULL DEFAULT 0,
    "lastCursor" INTEGER NOT NULL DEFAULT 0,
    "lastSyncAt" TIMESTAMP(3),
    "lastSyncError" TEXT,
    "pendingCommand" TEXT,
    "pendingCommandAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientPortalAccount" (
    "id" TEXT NOT NULL,
    "tenantSlug" TEXT NOT NULL DEFAULT 'default',
    "globalClientId" TEXT,
    "customerId" TEXT,
    "fullName" TEXT NOT NULL,
    "tradeName" TEXT,
    "phone" TEXT NOT NULL,
    "normalizedPhone" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL,
    "normalizedEmail" TEXT NOT NULL DEFAULT '',
    "passwordHash" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "avatarColor" TEXT NOT NULL DEFAULT '#059669',
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "passwordUpdatedAt" TIMESTAMP(3),
    "sessionVersion" INTEGER NOT NULL DEFAULT 1,
    "sectorMode" TEXT NOT NULL DEFAULT 'INHERIT',
    "suspendedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "deviceLimit" INTEGER NOT NULL DEFAULT 3,
    "clientType" TEXT NOT NULL DEFAULT 'DIRECT_CLIENT',
    "customClientType" TEXT,
    "preferredPickup" TEXT NOT NULL DEFAULT 'السوق',
    "customFieldsJson" TEXT NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
    "notes" TEXT,
    "approvedById" TEXT,
    "approvedByName" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedReason" TEXT,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientPortalAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientPasswordResetToken" (
    "id" TEXT NOT NULL,
    "clientAccountId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "initiatedBy" TEXT NOT NULL DEFAULT 'SELF',
    "staffUserId" TEXT,
    "staffUserName" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientPasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientGoodsRequest" (
    "id" TEXT NOT NULL,
    "tenantSlug" TEXT NOT NULL DEFAULT 'default',
    "requestNumber" TEXT NOT NULL,
    "clientAccountId" TEXT NOT NULL,
    "customerId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
    "pickupType" TEXT NOT NULL DEFAULT 'MARKET',
    "pickupLocation" TEXT NOT NULL DEFAULT 'السوق',
    "pickupNotes" TEXT,
    "customDataJson" TEXT NOT NULL DEFAULT '{}',
    "reserveStock" BOOLEAN NOT NULL DEFAULT false,
    "reservedSummaryJson" TEXT NOT NULL DEFAULT '[]',
    "totalEstimated" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "totalConfirmed" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'YER',
    "projectId" TEXT,
    "subProjectId" TEXT,
    "harvestName" TEXT,
    "linkedInvoiceId" TEXT,
    "linkedSaleId" TEXT,
    "linkedReceiptId" TEXT,
    "linkedSalesRecordId" TEXT,
    "linkedDraftId" TEXT,
    "creditPaidPlanned" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "debitPlanned" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "approvedByUserId" TEXT,
    "approvedByName" TEXT,
    "approvedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "reviewedByName" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "readyAt" TIMESTAMP(3),
    "handedOverById" TEXT,
    "handedOverByName" TEXT,
    "handedOverAt" TIMESTAMP(3),
    "staffNotes" TEXT,
    "reviewerRemarks" TEXT,
    "amendmentDiffJson" TEXT NOT NULL DEFAULT '[]',
    "beforeSnapshotJson" TEXT,
    "afterSnapshotJson" TEXT,
    "revisionNumber" INTEGER NOT NULL DEFAULT 1,
    "returnedToClientAt" TIMESTAMP(3),
    "returnedByUserId" TEXT,
    "returnedByName" TEXT,
    "returnEditPermissionsJson" TEXT NOT NULL DEFAULT '{}',
    "clientResponseStatus" TEXT,
    "clientResponseNote" TEXT,
    "clientRespondedAt" TIMESTAMP(3),
    "sectorType" TEXT NOT NULL DEFAULT 'HARVEST',
    "submissionType" TEXT NOT NULL DEFAULT 'catalog_order',
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "archivedBy" TEXT,
    "isArchivedByClient" BOOLEAN NOT NULL DEFAULT false,
    "archivedByClientAt" TIMESTAMP(3),
    "isHiddenByClient" BOOLEAN NOT NULL DEFAULT false,
    "hiddenByClientAt" TIMESTAMP(3),
    "isHiddenByStaff" BOOLEAN NOT NULL DEFAULT false,
    "hiddenByStaffAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientGoodsRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientGoodsRequestLine" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "lineOrder" INTEGER NOT NULL DEFAULT 1,
    "itemId" TEXT,
    "catalogBoardItemId" TEXT,
    "itemTitle" TEXT NOT NULL,
    "requestedQty" DECIMAL(65,30) NOT NULL,
    "confirmedQty" DECIMAL(65,30),
    "unitCode" TEXT NOT NULL DEFAULT 'QAT_BUNCH',
    "unitLabel" TEXT NOT NULL DEFAULT 'علاقية قات',
    "customUnitLabel" TEXT,
    "unitPrice" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "saleMode" TEXT NOT NULL DEFAULT 'BULK',
    "notes" TEXT,

    CONSTRAINT "ClientGoodsRequestLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppOutboxMessage" (
    "id" TEXT NOT NULL,
    "draftNumber" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "clientAccountId" TEXT,
    "customerId" TEXT,
    "requestId" TEXT,
    "recipientName" TEXT NOT NULL,
    "recipientPhone" TEXT NOT NULL,
    "templateKey" TEXT,
    "originalMessageText" TEXT NOT NULL,
    "finalMessageText" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
    "dispatchChannel" TEXT NOT NULL DEFAULT 'WHATSAPP_LINK',
    "approvedByUserId" TEXT,
    "approvedByName" TEXT,
    "approvedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "skippedReason" TEXT,
    "providerResponseJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppOutboxMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantIntegrationSetting" (
    "id" TEXT NOT NULL DEFAULT 'whatsapp',
    "provider" TEXT NOT NULL DEFAULT 'WHATSAPP_WEB_LINK',
    "gatewayUrl" TEXT,
    "credentialsEnc" TEXT,
    "senderPhone" TEXT,
    "defaultCountryCode" TEXT NOT NULL DEFAULT '967',
    "autoDraftEventsJson" TEXT NOT NULL DEFAULT '{}',
    "templatesJson" TEXT NOT NULL DEFAULT '{}',
    "configJson" TEXT NOT NULL DEFAULT '{}',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantIntegrationSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortalCatalogBoardItem" (
    "id" TEXT NOT NULL,
    "inventoryItemId" TEXT,
    "harvestBatchId" TEXT,
    "projectId" TEXT,
    "harvestName" TEXT,
    "sku" TEXT,
    "titleAr" TEXT NOT NULL,
    "titleEn" TEXT,
    "gradeLabel" TEXT NOT NULL DEFAULT 'درجة أولى',
    "categoryLabel" TEXT NOT NULL DEFAULT 'أصناف عامة',
    "sectorType" TEXT NOT NULL DEFAULT 'HARVEST',
    "categoryGroup" TEXT NOT NULL DEFAULT 'HARVEST',
    "saleMode" TEXT NOT NULL DEFAULT 'BOTH',
    "producerCompany" TEXT,
    "countryOfOrigin" TEXT,
    "productionDate" TEXT,
    "expiryDate" TEXT,
    "taxRate" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "unitCode" TEXT NOT NULL DEFAULT 'QAT_BUNCH',
    "unitLabel" TEXT NOT NULL DEFAULT 'علاقية قات',
    "customUnitLabel" TEXT,
    "unitPrice" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "bulkUnitLabel" TEXT,
    "partialUnitLabel" TEXT,
    "partialUnitPrice" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "multiplierToBase" DECIMAL(65,30) NOT NULL DEFAULT 1,
    "publishedQty" DECIMAL(65,30),
    "remainingQty" DECIMAL(65,30),
    "lowStockThreshold" DECIMAL(65,30) NOT NULL DEFAULT 5,
    "currency" TEXT NOT NULL DEFAULT 'YER',
    "availabilityStatus" TEXT NOT NULL DEFAULT 'AVAILABLE',
    "pickupLocation" TEXT,
    "freshnessLabel" TEXT NOT NULL DEFAULT 'قائمة أسعار اليوم',
    "effectiveDate" TEXT,
    "validityNote" TEXT,
    "displayOrder" INTEGER NOT NULL DEFAULT 1,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "publishedById" TEXT,
    "publishedByName" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PortalCatalogBoardItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommercialDispatchOrder" (
    "id" TEXT NOT NULL,
    "dispatchNumber" TEXT NOT NULL,
    "requestId" TEXT,
    "sectorType" TEXT NOT NULL DEFAULT 'COMMERCIAL',
    "warehouseId" TEXT,
    "driverName" TEXT,
    "vehicleInfo" TEXT,
    "tripStatus" TEXT NOT NULL DEFAULT 'PENDING_PICK',
    "podNotes" TEXT,
    "pickedAt" TIMESTAMP(3),
    "packedAt" TIMESTAMP(3),
    "dispatchedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "itemsJson" TEXT NOT NULL DEFAULT '[]',
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommercialDispatchOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "nameAr" TEXT,
    "nameEn" TEXT,
    "tenantUrl" TEXT,
    "licenseId" TEXT,
    "plan" TEXT,
    "isolationMode" TEXT NOT NULL DEFAULT 'DEDICATED_DB',
    "postgresDb" TEXT,
    "sqliteDbPath" TEXT,
    "schemaOrDb" TEXT NOT NULL,
    "allowedModesJson" TEXT NOT NULL DEFAULT '["local","lan","cloud"]',
    "maxSeats" INTEGER NOT NULL DEFAULT 10,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GlobalClientIdentity" (
    "id" TEXT NOT NULL,
    "normalizedPhone" TEXT NOT NULL,
    "normalizedEmail" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "tradeName" TEXT,
    "passwordHash" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "avatarColor" TEXT NOT NULL DEFAULT '#059669',
    "sessionVersion" INTEGER NOT NULL DEFAULT 1,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GlobalClientIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GlobalClientMembership" (
    "id" TEXT NOT NULL,
    "globalClientId" TEXT NOT NULL,
    "tenantSlug" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "tenantName" TEXT,
    "clientAccountId" TEXT NOT NULL,
    "customerId" TEXT,
    "normalizedPhone" TEXT NOT NULL,
    "normalizedEmail" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
    "creditLimit" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "balance" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "deviceLimit" INTEGER NOT NULL DEFAULT 3,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GlobalClientMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantPaymentChannel" (
    "id" TEXT NOT NULL,
    "tenantSlug" TEXT NOT NULL DEFAULT 'default',
    "category" TEXT NOT NULL,
    "providerCode" TEXT NOT NULL DEFAULT 'CUSTOM',
    "displayNameAr" TEXT NOT NULL,
    "displayNameEn" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'YER',
    "accountOrWalletNumber" TEXT NOT NULL,
    "beneficiaryName" TEXT NOT NULL,
    "ibanOrBranch" TEXT,
    "qrImageUrl" TEXT,
    "instructionsAr" TEXT,
    "treasuryAccountId" TEXT NOT NULL,
    "glAccountId" TEXT,
    "displayOrder" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantPaymentChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientPaymentReceipt" (
    "id" TEXT NOT NULL,
    "submissionNumber" TEXT NOT NULL,
    "tenantSlug" TEXT NOT NULL DEFAULT 'default',
    "clientAccountId" TEXT NOT NULL,
    "customerId" TEXT,
    "channelId" TEXT NOT NULL,
    "channelCategory" TEXT NOT NULL,
    "channelNameAr" TEXT NOT NULL,
    "treasuryAccountId" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'YER',
    "transferReference" TEXT NOT NULL,
    "normalizedReference" TEXT NOT NULL,
    "transferAt" TIMESTAMP(3) NOT NULL,
    "transferDateDmy" TEXT NOT NULL,
    "transferTimeHm" TEXT NOT NULL,
    "linkedInvoiceIdsJson" TEXT NOT NULL DEFAULT '[]',
    "linkedRequestIdsJson" TEXT NOT NULL DEFAULT '[]',
    "clientNotes" TEXT,
    "receiptFileName" TEXT,
    "receiptFilePath" TEXT,
    "receiptMimeType" TEXT,
    "receiptFileSize" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "staffNotes" TEXT,
    "clarificationReason" TEXT,
    "rejectionReason" TEXT,
    "reviewedByUserId" TEXT,
    "reviewedByName" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "linkedReceiptVoucherId" TEXT,
    "linkedJournalEntryId" TEXT,
    "auditHistoryJson" TEXT NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientPaymentReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Account_code_key" ON "Account"("code");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_entryNumber_key" ON "JournalEntry"("entryNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Currency_code_key" ON "Currency"("code");

-- CreateIndex
CREATE INDEX "ExchangeRate_currencyCode_rateDate_idx" ON "ExchangeRate"("currencyCode", "rateDate");

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
CREATE INDEX "VendorBillItem_billId_idx" ON "VendorBillItem"("billId");

-- CreateIndex
CREATE INDEX "VendorBillItem_itemId_idx" ON "VendorBillItem"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentVoucher_voucherNumber_key" ON "PaymentVoucher"("voucherNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_code_key" ON "Customer"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_name_key" ON "Customer"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_accountId_key" ON "Customer"("accountId");

-- CreateIndex
CREATE INDEX "Customer_tenantSlug_phone_idx" ON "Customer"("tenantSlug", "phone");

-- CreateIndex
CREATE INDEX "Customer_tenantSlug_isActive_idx" ON "Customer"("tenantSlug", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "SalesInvoice_invoiceNumber_key" ON "SalesInvoice"("invoiceNumber");

-- CreateIndex
CREATE INDEX "SalesInvoice_tenantSlug_customerId_createdAt_idx" ON "SalesInvoice"("tenantSlug", "customerId", "createdAt");

-- CreateIndex
CREATE INDEX "SalesInvoice_tenantSlug_status_idx" ON "SalesInvoice"("tenantSlug", "status");

-- CreateIndex
CREATE INDEX "SalesInvoiceItem_invoiceId_idx" ON "SalesInvoiceItem"("invoiceId");

-- CreateIndex
CREATE INDEX "SalesInvoiceItem_itemId_idx" ON "SalesInvoiceItem"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "ReceiptVoucher_voucherNumber_key" ON "ReceiptVoucher"("voucherNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ReceiptVoucher_linkedPaymentReceiptId_key" ON "ReceiptVoucher"("linkedPaymentReceiptId");

-- CreateIndex
CREATE INDEX "ReceiptVoucher_tenantSlug_customerId_createdAt_idx" ON "ReceiptVoucher"("tenantSlug", "customerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryLot_lotNumber_key" ON "InventoryLot"("lotNumber");

-- CreateIndex
CREATE INDEX "InventoryLot_itemId_warehouseId_receivedDate_idx" ON "InventoryLot"("itemId", "warehouseId", "receivedDate");

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
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "LicenseDeviceBinding_licenseId_idx" ON "LicenseDeviceBinding"("licenseId");

-- CreateIndex
CREATE UNIQUE INDEX "LicenseDeviceBinding_licenseId_userEmail_platform_key" ON "LicenseDeviceBinding"("licenseId", "userEmail", "platform");

-- CreateIndex
CREATE INDEX "TreasuryTransaction_treasuryId_date_idx" ON "TreasuryTransaction"("treasuryId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "UnitOfMeasure_code_key" ON "UnitOfMeasure"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ItemCategory_code_key" ON "ItemCategory"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Warehouse_code_key" ON "Warehouse"("code");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryItem_sku_key" ON "InventoryItem"("sku");

-- CreateIndex
CREATE INDEX "InventoryItem_sectorType_isActive_idx" ON "InventoryItem"("sectorType", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ItemUnitConversion_itemId_unitId_key" ON "ItemUnitConversion"("itemId", "unitId");

-- CreateIndex
CREATE UNIQUE INDEX "StockBalance_itemId_warehouseId_key" ON "StockBalance"("itemId", "warehouseId");

-- CreateIndex
CREATE INDEX "StockMovement_itemId_warehouseId_createdAt_idx" ON "StockMovement"("itemId", "warehouseId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CostCenter_code_key" ON "CostCenter"("code");

-- CreateIndex
CREATE UNIQUE INDEX "FiscalYear_code_key" ON "FiscalYear"("code");

-- CreateIndex
CREATE UNIQUE INDEX "AccountingPeriod_code_key" ON "AccountingPeriod"("code");

-- CreateIndex
CREATE INDEX "AccountingPeriod_startDate_endDate_status_idx" ON "AccountingPeriod"("startDate", "endDate", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AccountingPeriod_year_month_key" ON "AccountingPeriod"("year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "TaxCode_code_key" ON "TaxCode"("code");

-- CreateIndex
CREATE INDEX "TaxRate_taxCodeId_effectiveFrom_idx" ON "TaxRate"("taxCodeId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceDraft_draftNumber_key" ON "WorkspaceDraft"("draftNumber");

-- CreateIndex
CREATE INDEX "WorkspaceDraft_module_status_idx" ON "WorkspaceDraft"("module", "status");

-- CreateIndex
CREATE INDEX "WorkspaceDraft_createdById_visibility_idx" ON "WorkspaceDraft"("createdById", "visibility");

-- CreateIndex
CREATE INDEX "ApprovalRule_module_actionType_isActive_idx" ON "ApprovalRule"("module", "actionType", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalRequest_requestNumber_key" ON "ApprovalRequest"("requestNumber");

-- CreateIndex
CREATE INDEX "ApprovalRequest_status_module_idx" ON "ApprovalRequest"("status", "module");

-- CreateIndex
CREATE INDEX "ApprovalRequest_targetType_targetId_idx" ON "ApprovalRequest"("targetType", "targetId");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyRecord_idempotencyKey_key" ON "IdempotencyRecord"("idempotencyKey");

-- CreateIndex
CREATE INDEX "IdempotencyRecord_idempotencyKey_idx" ON "IdempotencyRecord"("idempotencyKey");

-- CreateIndex
CREATE INDEX "IdempotencyRecord_expiresAt_idx" ON "IdempotencyRecord"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "BankPaymentDispatch_dispatchNumber_key" ON "BankPaymentDispatch"("dispatchNumber");

-- CreateIndex
CREATE UNIQUE INDEX "BankPaymentDispatch_idempotencyKey_key" ON "BankPaymentDispatch"("idempotencyKey");

-- CreateIndex
CREATE INDEX "BankPaymentDispatch_treasuryAccountId_idx" ON "BankPaymentDispatch"("treasuryAccountId");

-- CreateIndex
CREATE INDEX "BankPaymentDispatch_status_idx" ON "BankPaymentDispatch"("status");

-- CreateIndex
CREATE INDEX "BankPaymentDispatch_provider_idx" ON "BankPaymentDispatch"("provider");

-- CreateIndex
CREATE INDEX "BankPaymentDispatch_sourceVoucherType_sourceVoucherId_idx" ON "BankPaymentDispatch"("sourceVoucherType", "sourceVoucherId");

-- CreateIndex
CREATE UNIQUE INDEX "SyncChangeLog_idempotencyKey_key" ON "SyncChangeLog"("idempotencyKey");

-- CreateIndex
CREATE INDEX "SyncChangeLog_entityType_entityId_idx" ON "SyncChangeLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "SyncChangeLog_createdAt_idx" ON "SyncChangeLog"("createdAt");

-- CreateIndex
CREATE INDEX "SyncConflict_status_createdAt_idx" ON "SyncConflict"("status", "createdAt");

-- CreateIndex
CREATE INDEX "NotificationEvent_isRead_createdAt_idx" ON "NotificationEvent"("isRead", "createdAt");

-- CreateIndex
CREATE INDEX "NotificationEvent_eventType_createdAt_idx" ON "NotificationEvent"("eventType", "createdAt");

-- CreateIndex
CREATE INDEX "NotificationEvent_recipientUserId_isRead_idx" ON "NotificationEvent"("recipientUserId", "isRead");

-- CreateIndex
CREATE UNIQUE INDEX "TenantDevice_deviceId_key" ON "TenantDevice"("deviceId");

-- CreateIndex
CREATE INDEX "TenantDevice_status_lastSeenAt_idx" ON "TenantDevice"("status", "lastSeenAt");

-- CreateIndex
CREATE INDEX "TenantDevice_userId_idx" ON "TenantDevice"("userId");

-- CreateIndex
CREATE INDEX "ClientPortalAccount_tenantSlug_status_createdAt_idx" ON "ClientPortalAccount"("tenantSlug", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ClientPortalAccount_tenantSlug_normalizedPhone_idx" ON "ClientPortalAccount"("tenantSlug", "normalizedPhone");

-- CreateIndex
CREATE INDEX "ClientPortalAccount_tenantSlug_normalizedEmail_idx" ON "ClientPortalAccount"("tenantSlug", "normalizedEmail");

-- CreateIndex
CREATE INDEX "ClientPortalAccount_status_createdAt_idx" ON "ClientPortalAccount"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ClientPortalAccount_customerId_idx" ON "ClientPortalAccount"("customerId");

-- CreateIndex
CREATE INDEX "ClientPortalAccount_globalClientId_idx" ON "ClientPortalAccount"("globalClientId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientPortalAccount_tenantSlug_normalizedPhone_key" ON "ClientPortalAccount"("tenantSlug", "normalizedPhone");

-- CreateIndex
CREATE UNIQUE INDEX "ClientPortalAccount_tenantSlug_normalizedEmail_key" ON "ClientPortalAccount"("tenantSlug", "normalizedEmail");

-- CreateIndex
CREATE INDEX "ClientPasswordResetToken_clientAccountId_createdAt_idx" ON "ClientPasswordResetToken"("clientAccountId", "createdAt");

-- CreateIndex
CREATE INDEX "ClientPasswordResetToken_expiresAt_idx" ON "ClientPasswordResetToken"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ClientGoodsRequest_requestNumber_key" ON "ClientGoodsRequest"("requestNumber");

-- CreateIndex
CREATE INDEX "ClientGoodsRequest_tenantSlug_clientAccountId_createdAt_idx" ON "ClientGoodsRequest"("tenantSlug", "clientAccountId", "createdAt");

-- CreateIndex
CREATE INDEX "ClientGoodsRequest_tenantSlug_status_createdAt_idx" ON "ClientGoodsRequest"("tenantSlug", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ClientGoodsRequest_clientAccountId_createdAt_idx" ON "ClientGoodsRequest"("clientAccountId", "createdAt");

-- CreateIndex
CREATE INDEX "ClientGoodsRequest_customerId_status_idx" ON "ClientGoodsRequest"("customerId", "status");

-- CreateIndex
CREATE INDEX "ClientGoodsRequest_status_createdAt_idx" ON "ClientGoodsRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ClientGoodsRequest_linkedSalesRecordId_idx" ON "ClientGoodsRequest"("linkedSalesRecordId");

-- CreateIndex
CREATE INDEX "ClientGoodsRequest_sectorType_status_idx" ON "ClientGoodsRequest"("sectorType", "status");

-- CreateIndex
CREATE INDEX "ClientGoodsRequestLine_requestId_idx" ON "ClientGoodsRequestLine"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppOutboxMessage_draftNumber_key" ON "WhatsAppOutboxMessage"("draftNumber");

-- CreateIndex
CREATE INDEX "WhatsAppOutboxMessage_status_createdAt_idx" ON "WhatsAppOutboxMessage"("status", "createdAt");

-- CreateIndex
CREATE INDEX "WhatsAppOutboxMessage_clientAccountId_createdAt_idx" ON "WhatsAppOutboxMessage"("clientAccountId", "createdAt");

-- CreateIndex
CREATE INDEX "WhatsAppOutboxMessage_customerId_createdAt_idx" ON "WhatsAppOutboxMessage"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "PortalCatalogBoardItem_isPublished_displayOrder_idx" ON "PortalCatalogBoardItem"("isPublished", "displayOrder");

-- CreateIndex
CREATE INDEX "PortalCatalogBoardItem_gradeLabel_availabilityStatus_idx" ON "PortalCatalogBoardItem"("gradeLabel", "availabilityStatus");

-- CreateIndex
CREATE INDEX "PortalCatalogBoardItem_sectorType_isPublished_idx" ON "PortalCatalogBoardItem"("sectorType", "isPublished");

-- CreateIndex
CREATE UNIQUE INDEX "CommercialDispatchOrder_dispatchNumber_key" ON "CommercialDispatchOrder"("dispatchNumber");

-- CreateIndex
CREATE INDEX "CommercialDispatchOrder_tripStatus_createdAt_idx" ON "CommercialDispatchOrder"("tripStatus", "createdAt");

-- CreateIndex
CREATE INDEX "CommercialDispatchOrder_requestId_idx" ON "CommercialDispatchOrder"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_tenantId_key" ON "tenants"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE INDEX "tenants_status_updatedAt_idx" ON "tenants"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "tenants_slug_status_idx" ON "tenants"("slug", "status");

-- CreateIndex
CREATE UNIQUE INDEX "GlobalClientIdentity_normalizedPhone_key" ON "GlobalClientIdentity"("normalizedPhone");

-- CreateIndex
CREATE UNIQUE INDEX "GlobalClientIdentity_normalizedEmail_key" ON "GlobalClientIdentity"("normalizedEmail");

-- CreateIndex
CREATE INDEX "GlobalClientIdentity_normalizedPhone_idx" ON "GlobalClientIdentity"("normalizedPhone");

-- CreateIndex
CREATE INDEX "GlobalClientIdentity_normalizedEmail_idx" ON "GlobalClientIdentity"("normalizedEmail");

-- CreateIndex
CREATE INDEX "GlobalClientMembership_globalClientId_status_idx" ON "GlobalClientMembership"("globalClientId", "status");

-- CreateIndex
CREATE INDEX "GlobalClientMembership_tenantSlug_status_createdAt_idx" ON "GlobalClientMembership"("tenantSlug", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "GlobalClientMembership_tenantSlug_normalizedPhone_key" ON "GlobalClientMembership"("tenantSlug", "normalizedPhone");

-- CreateIndex
CREATE UNIQUE INDEX "GlobalClientMembership_tenantSlug_normalizedEmail_key" ON "GlobalClientMembership"("tenantSlug", "normalizedEmail");

-- CreateIndex
CREATE UNIQUE INDEX "GlobalClientMembership_tenantSlug_clientAccountId_key" ON "GlobalClientMembership"("tenantSlug", "clientAccountId");

-- CreateIndex
CREATE INDEX "TenantPaymentChannel_tenantSlug_isActive_displayOrder_idx" ON "TenantPaymentChannel"("tenantSlug", "isActive", "displayOrder");

-- CreateIndex
CREATE INDEX "TenantPaymentChannel_treasuryAccountId_idx" ON "TenantPaymentChannel"("treasuryAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientPaymentReceipt_submissionNumber_key" ON "ClientPaymentReceipt"("submissionNumber");

-- CreateIndex
CREATE INDEX "ClientPaymentReceipt_tenantSlug_clientAccountId_createdAt_idx" ON "ClientPaymentReceipt"("tenantSlug", "clientAccountId", "createdAt");

-- CreateIndex
CREATE INDEX "ClientPaymentReceipt_tenantSlug_status_createdAt_idx" ON "ClientPaymentReceipt"("tenantSlug", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ClientPaymentReceipt_customerId_status_idx" ON "ClientPaymentReceipt"("customerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ClientPaymentReceipt_tenantSlug_channelId_normalizedReferen_key" ON "ClientPaymentReceipt"("tenantSlug", "channelId", "normalizedReference");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_defaultCostCenterId_fkey" FOREIGN KEY ("defaultCostCenterId") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_fiscalYearId_fkey" FOREIGN KEY ("fiscalYearId") REFERENCES "FiscalYear"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_subProjectId_fkey" FOREIGN KEY ("subProjectId") REFERENCES "SubProject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntryLine" ADD CONSTRAINT "JournalEntryLine_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntryLine" ADD CONSTRAINT "JournalEntryLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntryLine" ADD CONSTRAINT "JournalEntryLine_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntryLine" ADD CONSTRAINT "JournalEntryLine_subProjectId_fkey" FOREIGN KEY ("subProjectId") REFERENCES "SubProject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntryLine" ADD CONSTRAINT "JournalEntryLine_harvestCycleId_fkey" FOREIGN KEY ("harvestCycleId") REFERENCES "HarvestCycle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntryLine" ADD CONSTRAINT "JournalEntryLine_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExchangeRate" ADD CONSTRAINT "ExchangeRate_currencyCode_fkey" FOREIGN KEY ("currencyCode") REFERENCES "Currency"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_parentProjectId_fkey" FOREIGN KEY ("parentProjectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_glAccountId_fkey" FOREIGN KEY ("glAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectAcquisitionCycle" ADD CONSTRAINT "ProjectAcquisitionCycle_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubProject" ADD CONSTRAINT "SubProject_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubProject" ADD CONSTRAINT "SubProject_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HarvestCycle" ADD CONSTRAINT "HarvestCycle_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vendor" ADD CONSTRAINT "Vendor_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vendor" ADD CONSTRAINT "Vendor_glAccountId_fkey" FOREIGN KEY ("glAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vendor" ADD CONSTRAINT "Vendor_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_subProjectId_fkey" FOREIGN KEY ("subProjectId") REFERENCES "SubProject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_acquisitionCycleId_fkey" FOREIGN KEY ("acquisitionCycleId") REFERENCES "ProjectAcquisitionCycle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorBill" ADD CONSTRAINT "VendorBill_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorBill" ADD CONSTRAINT "VendorBill_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorBill" ADD CONSTRAINT "VendorBill_subProjectId_fkey" FOREIGN KEY ("subProjectId") REFERENCES "SubProject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorBill" ADD CONSTRAINT "VendorBill_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorBill" ADD CONSTRAINT "VendorBill_acquisitionCycleId_fkey" FOREIGN KEY ("acquisitionCycleId") REFERENCES "ProjectAcquisitionCycle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorBill" ADD CONSTRAINT "VendorBill_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorBillItem" ADD CONSTRAINT "VendorBillItem_billId_fkey" FOREIGN KEY ("billId") REFERENCES "VendorBill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentVoucher" ADD CONSTRAINT "PaymentVoucher_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentVoucher" ADD CONSTRAINT "PaymentVoucher_billId_fkey" FOREIGN KEY ("billId") REFERENCES "VendorBill"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentVoucher" ADD CONSTRAINT "PaymentVoucher_treasuryId_fkey" FOREIGN KEY ("treasuryId") REFERENCES "TreasuryAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentVoucher" ADD CONSTRAINT "PaymentVoucher_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentVoucher" ADD CONSTRAINT "PaymentVoucher_subProjectId_fkey" FOREIGN KEY ("subProjectId") REFERENCES "SubProject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentVoucher" ADD CONSTRAINT "PaymentVoucher_acquisitionCycleId_fkey" FOREIGN KEY ("acquisitionCycleId") REFERENCES "ProjectAcquisitionCycle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentVoucher" ADD CONSTRAINT "PaymentVoucher_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_glAccountId_fkey" FOREIGN KEY ("glAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesInvoice" ADD CONSTRAINT "SalesInvoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesInvoice" ADD CONSTRAINT "SalesInvoice_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesInvoice" ADD CONSTRAINT "SalesInvoice_subProjectId_fkey" FOREIGN KEY ("subProjectId") REFERENCES "SubProject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesInvoice" ADD CONSTRAINT "SalesInvoice_harvestCycleId_fkey" FOREIGN KEY ("harvestCycleId") REFERENCES "HarvestCycle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesInvoice" ADD CONSTRAINT "SalesInvoice_treasuryAccountId_fkey" FOREIGN KEY ("treasuryAccountId") REFERENCES "TreasuryAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesInvoice" ADD CONSTRAINT "SalesInvoice_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesInvoiceItem" ADD CONSTRAINT "SalesInvoiceItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "SalesInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptVoucher" ADD CONSTRAINT "ReceiptVoucher_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptVoucher" ADD CONSTRAINT "ReceiptVoucher_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "SalesInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptVoucher" ADD CONSTRAINT "ReceiptVoucher_treasuryId_fkey" FOREIGN KEY ("treasuryId") REFERENCES "TreasuryAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptVoucher" ADD CONSTRAINT "ReceiptVoucher_subProjectId_fkey" FOREIGN KEY ("subProjectId") REFERENCES "SubProject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptVoucher" ADD CONSTRAINT "ReceiptVoucher_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryLot" ADD CONSTRAINT "InventoryLot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryLot" ADD CONSTRAINT "InventoryLot_harvestCycleId_fkey" FOREIGN KEY ("harvestCycleId") REFERENCES "HarvestCycle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HarvestInventoryBatch" ADD CONSTRAINT "HarvestInventoryBatch_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HarvestInventoryBatch" ADD CONSTRAINT "HarvestInventoryBatch_subProjectId_fkey" FOREIGN KEY ("subProjectId") REFERENCES "SubProject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HarvestInventoryBatch" ADD CONSTRAINT "HarvestInventoryBatch_harvestCycleId_fkey" FOREIGN KEY ("harvestCycleId") REFERENCES "HarvestCycle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreasuryAccount" ADD CONSTRAINT "TreasuryAccount_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperatingExpense" ADD CONSTRAINT "OperatingExpense_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperatingExpense" ADD CONSTRAINT "OperatingExpense_subProjectId_fkey" FOREIGN KEY ("subProjectId") REFERENCES "SubProject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperatingExpense" ADD CONSTRAINT "OperatingExpense_harvestCycleId_fkey" FOREIGN KEY ("harvestCycleId") REFERENCES "HarvestCycle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Worker" ADD CONSTRAINT "Worker_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Worker" ADD CONSTRAINT "Worker_glAccountId_fkey" FOREIGN KEY ("glAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Worker" ADD CONSTRAINT "Worker_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerWageEntry" ADD CONSTRAINT "WorkerWageEntry_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerWageEntry" ADD CONSTRAINT "WorkerWageEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerWageEntry" ADD CONSTRAINT "WorkerWageEntry_subProjectId_fkey" FOREIGN KEY ("subProjectId") REFERENCES "SubProject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerWageEntry" ADD CONSTRAINT "WorkerWageEntry_harvestCycleId_fkey" FOREIGN KEY ("harvestCycleId") REFERENCES "HarvestCycle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleTransaction" ADD CONSTRAINT "SaleTransaction_treasuryAccountId_fkey" FOREIGN KEY ("treasuryAccountId") REFERENCES "TreasuryAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleTransaction" ADD CONSTRAINT "SaleTransaction_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleTransaction" ADD CONSTRAINT "SaleTransaction_subProjectId_fkey" FOREIGN KEY ("subProjectId") REFERENCES "SubProject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleTransaction" ADD CONSTRAINT "SaleTransaction_harvestCycleId_fkey" FOREIGN KEY ("harvestCycleId") REFERENCES "HarvestCycle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleTransaction" ADD CONSTRAINT "SaleTransaction_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstallmentVoucher" ADD CONSTRAINT "InstallmentVoucher_saleTransactionId_fkey" FOREIGN KEY ("saleTransactionId") REFERENCES "SaleTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstallmentVoucher" ADD CONSTRAINT "InstallmentVoucher_workerWageEntryId_fkey" FOREIGN KEY ("workerWageEntryId") REFERENCES "WorkerWageEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstallmentVoucher" ADD CONSTRAINT "InstallmentVoucher_treasuryAccountId_fkey" FOREIGN KEY ("treasuryAccountId") REFERENCES "TreasuryAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdjustmentEntry" ADD CONSTRAINT "AdjustmentEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdjustmentEntry" ADD CONSTRAINT "AdjustmentEntry_harvestCycleId_fkey" FOREIGN KEY ("harvestCycleId") REFERENCES "HarvestCycle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemCategory" ADD CONSTRAINT "ItemCategory_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ItemCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Warehouse" ADD CONSTRAINT "Warehouse_glAccountId_fkey" FOREIGN KEY ("glAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Warehouse" ADD CONSTRAINT "Warehouse_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ItemCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_baseUnitId_fkey" FOREIGN KEY ("baseUnitId") REFERENCES "UnitOfMeasure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_defaultWarehouseId_fkey" FOREIGN KEY ("defaultWarehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemUnitConversion" ADD CONSTRAINT "ItemUnitConversion_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemUnitConversion" ADD CONSTRAINT "ItemUnitConversion_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "UnitOfMeasure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockBalance" ADD CONSTRAINT "StockBalance_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockBalance" ADD CONSTRAINT "StockBalance_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_enteredUnitId_fkey" FOREIGN KEY ("enteredUnitId") REFERENCES "UnitOfMeasure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostCenter" ADD CONSTRAINT "CostCenter_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingPeriod" ADD CONSTRAINT "AccountingPeriod_fiscalYearId_fkey" FOREIGN KEY ("fiscalYearId") REFERENCES "FiscalYear"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxRate" ADD CONSTRAINT "TaxRate_taxCodeId_fkey" FOREIGN KEY ("taxCodeId") REFERENCES "TaxCode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "ApprovalRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankPaymentDispatch" ADD CONSTRAINT "BankPaymentDispatch_treasuryAccountId_fkey" FOREIGN KEY ("treasuryAccountId") REFERENCES "TreasuryAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientPasswordResetToken" ADD CONSTRAINT "ClientPasswordResetToken_clientAccountId_fkey" FOREIGN KEY ("clientAccountId") REFERENCES "ClientPortalAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientGoodsRequest" ADD CONSTRAINT "ClientGoodsRequest_clientAccountId_fkey" FOREIGN KEY ("clientAccountId") REFERENCES "ClientPortalAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientGoodsRequestLine" ADD CONSTRAINT "ClientGoodsRequestLine_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ClientGoodsRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GlobalClientMembership" ADD CONSTRAINT "GlobalClientMembership_globalClientId_fkey" FOREIGN KEY ("globalClientId") REFERENCES "GlobalClientIdentity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientPaymentReceipt" ADD CONSTRAINT "ClientPaymentReceipt_clientAccountId_fkey" FOREIGN KEY ("clientAccountId") REFERENCES "ClientPortalAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

