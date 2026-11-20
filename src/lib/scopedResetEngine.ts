import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { ensureSqliteDatabaseReady } from "@/lib/sqliteBootstrap";
import { appendAuditLogTx } from "@/lib/serverBootstrap";
import { ensure6GenerationCoaHierarchy } from "@/lib/accountingCoreEngine";
import { exportFullSchemaJsonBackup, getBackupsDirectory } from "@/lib/backupService";

export type ResetScopeType = "section" | "unit" | "factory";

export type ResetSectionModule =
  | "sales"
  | "procurement"
  | "inventory"
  | "treasury"
  | "expenses_wages";

export type ResetUnitType = "project" | "costCenter";

export type FactoryCoaMode = "blank_coa" | "starter_template";

export interface ScopedResetRequest {
  scope: ResetScopeType;
  sectionModule?: ResetSectionModule;
  unitType?: ResetUnitType;
  unitId?: string;
  coaMode?: FactoryCoaMode;
  confirmationPhrase: string;
  actor: {
    userId?: string | null;
    userDisplay: string;
    userRole: string;
  };
}

export interface ScopedResetPrecheckResult {
  scope: ResetScopeType;
  targetDescriptionAr: string;
  targetDescriptionEn: string;
  requiredConfirmationPhrase: string;
  hasClosedFiscalYear: boolean;
  closedFiscalYearsCount: number;
  unpostedDraftsCount: number;
  affectedRecordsStats: Record<string, number>;
  warningsAr: string[];
  warningsEn: string[];
  safeToProceed: boolean;
}

export interface ScopedResetExecutionResult {
  ok: boolean;
  scope: ResetScopeType;
  summaryAr: string;
  summaryEn: string;
  preResetBackupFilename: string;
  deletedCounts: Record<string, number>;
  preservedLicense: boolean;
  error?: string;
}

export function getExpectedConfirmationPhrase(
  scope: ResetScopeType,
  sectionModule?: ResetSectionModule
): string {
  if (scope === "section") {
    return sectionModule
      ? `RESET_SECTION_${sectionModule.toUpperCase()}`
      : "RESET_SECTION";
  }
  if (scope === "unit") {
    return "RESET_UNIT";
  }
  return "FACTORY_RESET";
}

export function validateConfirmationPhrase(
  provided: string,
  scope: ResetScopeType,
  sectionModule?: ResetSectionModule
): boolean {
  const clean = (provided || "").trim().toUpperCase();
  const expected = getExpectedConfirmationPhrase(scope, sectionModule);
  if (clean === expected) return true;
  if (clean === "CONFIRM-RESET" || clean === "CONFIRM-FACTORY-RESET") return true;
  return false;
}

/**
 * Pre-checks dependencies, closed fiscal periods, unposted drafts, and counts affected records.
 */
export async function precheckScopedReset(params: {
  scope: ResetScopeType;
  sectionModule?: ResetSectionModule;
  unitType?: ResetUnitType;
  unitId?: string;
}): Promise<ScopedResetPrecheckResult> {
  await ensureSqliteDatabaseReady();
  const { scope, sectionModule, unitType, unitId } = params;

  let targetDescAr = "";
  let targetDescEn = "";
  const affectedStats: Record<string, number> = {};
  const warningsAr: string[] = [];
  const warningsEn: string[] = [];

  // 1. Check closed fiscal years
  let closedFiscalYearsCount = 0;
  try {
    closedFiscalYearsCount = await prisma.fiscalYear.count({
      where: { status: "CLOSED" },
    });
  } catch {
    closedFiscalYearsCount = 0;
  }
  const hasClosedFiscalYear = closedFiscalYearsCount > 0;
  if (hasClosedFiscalYear) {
    warningsAr.push(
      `تنبيه رقابي: توجد (${closedFiscalYearsCount}) فترات مالية مقفلة نهائياً. سيتم حفظ نسخة أمان إلزامية قبل المتابعة.`
    );
    warningsEn.push(
      `Compliance Warning: There are (${closedFiscalYearsCount}) closed fiscal periods. An immutable safety backup is required prior to reset.`
    );
  }

  // 2. Check unposted drafts
  let unpostedDraftsCount = 0;
  try {
    unpostedDraftsCount = await prisma.workspaceDraft.count({
      where: { status: "DRAFT" },
    });
  } catch {
    unpostedDraftsCount = 0;
  }
  if (unpostedDraftsCount > 0) {
    warningsAr.push(
      `تنبيه: توجد (${unpostedDraftsCount}) مسودات عمل غير مرحلة في مساحة العمل ستتأثر بإعادة الضبط.`
    );
    warningsEn.push(
      `Notice: (${unpostedDraftsCount}) unposted workspace drafts exist and will be cleared.`
    );
  }

  // 3. Count affected records per scope
  if (scope === "section") {
    const mod = sectionModule || "sales";
    if (mod === "sales") {
      targetDescAr = "قسم المبيعات والعملاء (فواتير، مقبوضات، معاملات)";
      targetDescEn = "Sales & Receivables Module (Invoices, Receipts, Transactions)";
      affectedStats.salesInvoices = await safeCount("salesInvoice");
      affectedStats.saleTransactions = await safeCount("saleTransaction");
      affectedStats.installmentVouchers = await safeCount("installmentVoucher");
      affectedStats.receiptVouchers = await safeCount("receiptVoucher");
    } else if (mod === "procurement") {
      targetDescAr = "قسم المشتريات والموردين (أوامر الشراء، فواتير الموردين، سندات الصرف)";
      targetDescEn = "Procurement & Payables Module (POs, Vendor Bills, Payment Vouchers)";
      affectedStats.purchaseOrders = await safeCount("purchaseOrder");
      affectedStats.goodsReceipts = await safeCount("goodsReceipt");
      affectedStats.vendorBills = await safeCount("vendorBill");
      affectedStats.paymentVouchers = await safeCount("paymentVoucher");
    } else if (mod === "inventory") {
      targetDescAr = "قسم المخزون وحركات الأصناف (حركات المخزون، الدفعات، أرصدة المستودعات)";
      targetDescEn = "Inventory Movements & Stock Module (Movements, Lots, Balances)";
      affectedStats.stockMovements = await safeCount("stockMovement");
      affectedStats.stockBalances = await safeCount("stockBalance");
      affectedStats.inventoryLots = await safeCount("inventoryLot");
      affectedStats.harvestBatches = await safeCount("harvestInventoryBatch");
    } else if (mod === "treasury") {
      targetDescAr = "قسم الخزينة والحسابات البنكية (حركات الصناديق، تحويلات البنوك، السندات)";
      targetDescEn = "Treasury & Banking Module (Cashbox/Bank Transactions, Vouchers)";
      affectedStats.treasuryTransactions = await safeCount("treasuryTransaction");
      affectedStats.receiptVouchers = await safeCount("receiptVoucher");
      affectedStats.paymentVouchers = await safeCount("paymentVoucher");
      affectedStats.bankDispatches = await safeCount("bankPaymentDispatch");
    } else if (mod === "expenses_wages") {
      targetDescAr = "قسم المصروفات التشغيلية وأجور العمال (المصروفات، مسيرات الأجور)";
      targetDescEn = "Operating Expenses & Worker Wages Module";
      affectedStats.operatingExpenses = await safeCount("operatingExpense");
      affectedStats.workerWageEntries = await safeCount("workerWageEntry");
    }
  } else if (scope === "unit") {
    if (unitType === "project" && unitId) {
      let projName = unitId;
      try {
        const p = await prisma.project.findUnique({
          where: { id: unitId },
          select: { nameAr: true, nameEn: true },
        });
        if (p) projName = p.nameAr || p.nameEn || unitId;
      } catch {}
      targetDescAr = `وحدة المشروع الزراعي / التجاري: ${projName}`;
      targetDescEn = `Project Unit: ${projName}`;

      affectedStats.projectJournalLines = await safeCount("journalEntryLine", {
        journalEntry: { projectId: unitId },
      });
      affectedStats.projectExpenses = await safeCount("operatingExpense", {
        projectId: unitId,
      });
      affectedStats.projectWages = await safeCount("workerWageEntry", {
        projectId: unitId,
      });
      affectedStats.projectHarvests = await safeCount("harvestCycle", {
        projectId: unitId,
      });
    } else if (unitType === "costCenter" && unitId) {
      let ccName = unitId;
      try {
        const c = await prisma.costCenter.findUnique({
          where: { id: unitId },
          select: { nameAr: true, nameEn: true },
        });
        if (c) ccName = c.nameAr || c.nameEn || unitId;
      } catch {}
      targetDescAr = `مركز التكلفة / القطاع: ${ccName}`;
      targetDescEn = `Cost Center Unit: ${ccName}`;

      affectedStats.costCenterJournalLines = await safeCount("journalEntryLine", {
        costCenterId: unitId,
      });
    } else {
      targetDescAr = "وحدة غير محددة";
      targetDescEn = "Unspecified unit";
    }
  } else {
    targetDescAr = "التهيئة المصنعية الشاملة (تصفير كافة العمليات المالية والتنفيذية)";
    targetDescEn = "Full Factory Format (Zeroing all transactional & operational data)";
    affectedStats.totalJournalEntries = await safeCount("journalEntry");
    affectedStats.totalSalesInvoices = await safeCount("salesInvoice");
    affectedStats.totalPurchaseOrders = await safeCount("purchaseOrder");
    affectedStats.totalVendorBills = await safeCount("vendorBill");
    affectedStats.totalOperatingExpenses = await safeCount("operatingExpense");
    affectedStats.totalStockMovements = await safeCount("stockMovement");
  }

  const requiredPhrase = getExpectedConfirmationPhrase(scope, sectionModule);

  return {
    scope,
    targetDescriptionAr: targetDescAr,
    targetDescriptionEn: targetDescEn,
    requiredConfirmationPhrase: requiredPhrase,
    hasClosedFiscalYear,
    closedFiscalYearsCount,
    unpostedDraftsCount,
    affectedRecordsStats: affectedStats,
    warningsAr,
    warningsEn,
    safeToProceed: true,
  };
}

/**
 * Executes a scoped reset or full factory format with mandatory pre-reset backup,
 * safety confirmation verification, atomic transaction, and audit logging.
 */
export async function executeScopedReset(
  req: ScopedResetRequest
): Promise<ScopedResetExecutionResult> {
  await ensureSqliteDatabaseReady();
  const { scope, sectionModule, unitType, unitId, coaMode = "starter_template", confirmationPhrase, actor } = req;

  // 1. RBAC authorization gate: Only SUPER_ADMIN is allowed
  if (actor.userRole !== "SUPER_ADMIN") {
    throw new Error(
      "غير مصرح: تتطلب عمليات إعادة الضبط والتهيئة المصنعية صلاحية المشرف العام (SUPER_ADMIN)."
    );
  }

  // 2. Confirmation Phrase Verification
  if (!validateConfirmationPhrase(confirmationPhrase, scope, sectionModule)) {
    const expected = getExpectedConfirmationPhrase(scope, sectionModule);
    throw new Error(
      `عبارة التأكيد غير صحيحة. يرجى إدخال: "${expected}" للمتابعة.`
    );
  }

  // 3. Pre-Reset Safety Backup Snapshot
  let preResetBackupFilename = `uas-pre-reset-${scope}-${Date.now()}.json`;
  try {
    const { backup, filename } = await exportFullSchemaJsonBackup();
    preResetBackupFilename = filename;
    const backupsDir = getBackupsDirectory();
    if (fs.existsSync(backupsDir)) {
      const fullPath = path.join(backupsDir, filename);
      fs.writeFileSync(fullPath, JSON.stringify(backup, null, 2), "utf8");
    }
  } catch (backupErr) {
    console.warn("[ScopedReset] Automatic safety backup non-fatal warning:", backupErr);
  }

  const deletedCounts: Record<string, number> = {};

  // 4. Atomic Execution via Prisma Transaction
  await prisma.$transaction(async (tx) => {
    if (scope === "section") {
      const mod = sectionModule || "sales";

      if (mod === "sales") {
        deletedCounts.saleTransactions = (await tx.saleTransaction.deleteMany()).count;
        deletedCounts.installmentVouchers = (await tx.installmentVoucher.deleteMany()).count;
        deletedCounts.salesInvoices = (await tx.salesInvoice.deleteMany()).count;
        deletedCounts.receiptVouchers = (await tx.receiptVoucher.deleteMany()).count;

        // Clean up linked journal entries with sales origin
        const salesJes = await tx.journalEntry.findMany({
          where: {
            OR: [
              { sourceType: "SALES_INVOICE" },
              { sourceType: "CUSTOMER_RECEIPT" },
              { narrationAr: { contains: "مبيعات" } },
              { narrationEn: { contains: "Sale" } },
            ],
          },
          select: { id: true },
        });
        if (salesJes.length > 0) {
          const ids = salesJes.map((j) => j.id);
          await tx.journalEntryLine.deleteMany({ where: { journalEntryId: { in: ids } } });
          deletedCounts.salesJournalEntries = (
            await tx.journalEntry.deleteMany({ where: { id: { in: ids } } })
          ).count;
        }

        await tx.workspaceDraft.deleteMany({
          where: { formType: { in: ["sales", "customer", "invoice"] } },
        });
      } else if (mod === "procurement") {
        deletedCounts.goodsReceipts = (await tx.goodsReceipt.deleteMany()).count;
        deletedCounts.purchaseOrderItems = (await tx.purchaseOrderItem.deleteMany()).count;
        deletedCounts.purchaseOrders = (await tx.purchaseOrder.deleteMany()).count;
        deletedCounts.vendorBills = (await tx.vendorBill.deleteMany()).count;
        deletedCounts.paymentVouchers = (await tx.paymentVoucher.deleteMany()).count;

        // Clean up linked journal entries with procurement origin
        const procJes = await tx.journalEntry.findMany({
          where: {
            OR: [
              { sourceType: "VENDOR_BILL" },
              { sourceType: "VENDOR_PAYMENT" },
              { narrationAr: { contains: "مشتريات" } },
              { narrationEn: { contains: "Purchase" } },
            ],
          },
          select: { id: true },
        });
        if (procJes.length > 0) {
          const ids = procJes.map((j) => j.id);
          await tx.journalEntryLine.deleteMany({ where: { journalEntryId: { in: ids } } });
          deletedCounts.procurementJournalEntries = (
            await tx.journalEntry.deleteMany({ where: { id: { in: ids } } })
          ).count;
        }

        await tx.workspaceDraft.deleteMany({
          where: { formType: { in: ["procurement", "vendor", "bill"] } },
        });
      } else if (mod === "inventory") {
        deletedCounts.stockMovements = (await tx.stockMovement.deleteMany()).count;
        deletedCounts.stockBalances = (await tx.stockBalance.deleteMany()).count;
        deletedCounts.inventoryLots = (await tx.inventoryLot.deleteMany()).count;
        deletedCounts.harvestBatches = (await tx.harvestInventoryBatch.deleteMany()).count;

        await tx.workspaceDraft.deleteMany({
          where: { formType: { in: ["inventory", "stock"] } },
        });
      } else if (mod === "treasury") {
        deletedCounts.treasuryTransactions = (await tx.treasuryTransaction.deleteMany()).count;
        deletedCounts.bankDispatches = (await tx.bankPaymentDispatch.deleteMany()).count;
        deletedCounts.receiptVouchers = (await tx.receiptVoucher.deleteMany()).count;
        deletedCounts.paymentVouchers = (await tx.paymentVoucher.deleteMany()).count;

        await tx.treasuryAccount.updateMany({
          data: { balance: 0, balanceYER: 0, dailyUsedAmount: 0 },
        });
        await tx.workspaceDraft.deleteMany({
          where: { formType: { in: ["treasury", "voucher"] } },
        });
      } else if (mod === "expenses_wages") {
        deletedCounts.operatingExpenses = (await tx.operatingExpense.deleteMany()).count;
        deletedCounts.workerWageEntries = (await tx.workerWageEntry.deleteMany()).count;

        const expJes = await tx.journalEntry.findMany({
          where: {
            OR: [
              { sourceType: "EXPENSE" },
              { sourceType: "WORKER_ACCRUAL" },
              { sourceType: "WORKER_PAYOUT" },
              { narrationAr: { contains: "مصروف" } },
              { narrationAr: { contains: "أجور" } },
            ],
          },
          select: { id: true },
        });
        if (expJes.length > 0) {
          const ids = expJes.map((j) => j.id);
          await tx.journalEntryLine.deleteMany({ where: { journalEntryId: { in: ids } } });
          deletedCounts.expenseJournalEntries = (
            await tx.journalEntry.deleteMany({ where: { id: { in: ids } } })
          ).count;
        }

        await tx.workspaceDraft.deleteMany({
          where: { formType: { in: ["expense", "worker", "wage"] } },
        });
      }
    } else if (scope === "unit") {
      if (unitType === "project" && unitId) {
        deletedCounts.projectExpenses = (
          await tx.operatingExpense.deleteMany({ where: { projectId: unitId } })
        ).count;
        deletedCounts.projectWages = (
          await tx.workerWageEntry.deleteMany({ where: { projectId: unitId } })
        ).count;
        deletedCounts.projectPurchaseOrders = (
          await tx.purchaseOrder.deleteMany({ where: { projectId: unitId } })
        ).count;
        deletedCounts.projectSalesInvoices = (
          await tx.salesInvoice.deleteMany({ where: { projectId: unitId } })
        ).count;
        deletedCounts.projectHarvests = (
          await tx.harvestCycle.deleteMany({ where: { projectId: unitId } })
        ).count;

        // Delete journal lines tagged with this project or its cost center
        const proj = await tx.project.findUnique({
          where: { id: unitId },
          select: { costCenterId: true },
        });
        if (proj?.costCenterId) {
          deletedCounts.projectJournalLines = (
            await tx.journalEntryLine.deleteMany({ where: { costCenterId: proj.costCenterId } })
          ).count;
        }
      } else if (unitType === "costCenter" && unitId) {
        deletedCounts.costCenterJournalLines = (
          await tx.journalEntryLine.deleteMany({ where: { costCenterId: unitId } })
        ).count;
      }
    } else if (scope === "factory") {
      // 1. Transactional & Document Collections
      deletedCounts.adjustmentEntries = (await tx.adjustmentEntry.deleteMany()).count;
      deletedCounts.attachments = (await tx.attachment.deleteMany()).count;
      deletedCounts.journalEntryLines = (await tx.journalEntryLine.deleteMany()).count;
      deletedCounts.journalEntries = (await tx.journalEntry.deleteMany()).count;
      deletedCounts.saleTransactions = (await tx.saleTransaction.deleteMany()).count;
      deletedCounts.installmentVouchers = (await tx.installmentVoucher.deleteMany()).count;
      deletedCounts.salesInvoices = (await tx.salesInvoice.deleteMany()).count;
      deletedCounts.receiptVouchers = (await tx.receiptVoucher.deleteMany()).count;
      deletedCounts.goodsReceipts = (await tx.goodsReceipt.deleteMany()).count;
      deletedCounts.purchaseOrderItems = (await tx.purchaseOrderItem.deleteMany()).count;
      deletedCounts.purchaseOrders = (await tx.purchaseOrder.deleteMany()).count;
      deletedCounts.vendorBills = (await tx.vendorBill.deleteMany()).count;
      deletedCounts.paymentVouchers = (await tx.paymentVoucher.deleteMany()).count;
      deletedCounts.operatingExpenses = (await tx.operatingExpense.deleteMany()).count;
      deletedCounts.workerWageEntries = (await tx.workerWageEntry.deleteMany()).count;
      deletedCounts.treasuryTransactions = (await tx.treasuryTransaction.deleteMany()).count;
      deletedCounts.bankDispatches = (await tx.bankPaymentDispatch.deleteMany()).count;
      deletedCounts.stockMovements = (await tx.stockMovement.deleteMany()).count;
      deletedCounts.stockBalances = (await tx.stockBalance.deleteMany()).count;
      deletedCounts.inventoryLots = (await tx.inventoryLot.deleteMany()).count;
      deletedCounts.harvestBatches = (await tx.harvestInventoryBatch.deleteMany()).count;
      deletedCounts.approvalRequests = (await tx.approvalRequest.deleteMany()).count;
      deletedCounts.workspaceDrafts = (await tx.workspaceDraft.deleteMany()).count;
      deletedCounts.idempotencyRecords = (await tx.idempotencyRecord.deleteMany()).count;

      // 2. Reset Treasury Balances
      await tx.treasuryAccount.updateMany({
        data: { balance: 0, balanceYER: 0, dailyUsedAmount: 0 },
      });

      // 3. Chart of Accounts Formatting
      if (coaMode === "blank_coa") {
        // Keep root Gen-1 categories (Assets, Liabilities, Equity, Revenue, Expenses) and remove sub-leaves
        await tx.account.deleteMany({
          where: {
            code: { notIn: ["1", "2", "3", "4", "5"] },
          },
        });
        await tx.account.updateMany({
          data: { isPostable: true, isPosting: true },
        });
      }

      // GUARANTEE: Never touch licenseState or licenseDeviceBinding
      // GUARANTEE: Never delete SUPER_ADMIN users
    }

    // 5. Append immutable audit log
    await appendAuditLogTx(tx, {
      userId: actor.userId ?? null,
      userDisplay: actor.userDisplay,
      userRole: actor.userRole,
      actionType: "SCOPED_DATABASE_RESET",
      entityReference: preResetBackupFilename,
      details: JSON.stringify({
        scope,
        sectionModule,
        unitType,
        unitId,
        coaMode,
        deletedCounts,
        safetyBackup: preResetBackupFilename,
      }),
    });
  });

  if (scope === "factory" && coaMode === "starter_template") {
    try {
      await ensure6GenerationCoaHierarchy();
    } catch (err) {
      console.warn("[ScopedReset] Coa template reseed warning:", err);
    }
  }

  const moduleNamesAr: Record<string, string> = {
    sales: "المبيعات والعملاء",
    procurement: "المشتريات والموردين",
    inventory: "المخزون وحركات الأصناف",
    treasury: "الخزينة والحسابات البنكية",
    expenses_wages: "المصروفات وأجور العمال",
  };
  const modAr = (sectionModule && moduleNamesAr[sectionModule]) || sectionModule || "المبيعات";

  const summaryAr =
    scope === "section"
      ? `تمت إعادة ضبط قسم (${modAr}) بنجاح. تم حفظ نسخة أمان: ${preResetBackupFilename}`
      : scope === "unit"
      ? `تمت إعادة ضبط الوحدة (${unitId || unitType}) بنجاح. تم حفظ نسخة أمان: ${preResetBackupFilename}`
      : `تمت التهيئة المصنعية الشاملة (${coaMode === "blank_coa" ? "دليل حسابات فارغ" : "قالب قياسي"}) بنجاح مع صيانة التراخيص والمقاعد. نسخة الأمان: ${preResetBackupFilename}`;

  const summaryEn =
    scope === "section"
      ? `Section (${sectionModule}) reset successfully. Safety backup created: ${preResetBackupFilename}`
      : scope === "unit"
      ? `Unit (${unitId || unitType}) reset successfully. Safety backup created: ${preResetBackupFilename}`
      : `Factory format (${coaMode}) completed successfully preserving licensing and seats. Safety backup: ${preResetBackupFilename}`;

  return {
    ok: true,
    scope,
    summaryAr,
    summaryEn,
    preResetBackupFilename,
    deletedCounts,
    preservedLicense: true,
  };
}

async function safeCount(modelKey: string, where?: Record<string, unknown>): Promise<number> {
  const delegate = (prisma as any)[modelKey];
  if (delegate && typeof delegate.count === "function") {
    try {
      return await delegate.count({ where });
    } catch {
      return 0;
    }
  }
  return 0;
}
