import { prisma } from "@/lib/prisma";
import { getActiveTenantId } from "@/lib/tenant/tenantContext";
import { ensureSqliteDatabaseReady } from "@/lib/sqliteBootstrap";
import {
  createVendorWithAccountTx,
  ensureCustomerWithAccountTx,
  ensureWorkerWithAccountTx,
  generateFinancialReports,
  postCustomerReceipt,
  postJournalEntry,
  postOperatingExpenseJournalTx,
  postSalesInvoice,
  postWorkerWageJournalTx,
  recordAuditDiffTx,
  transferBetweenTreasuries,
} from "@/lib/accounting/ledgerService";
import {
  computeOperatingExpenseTotal,
  computeSaleTotals,
  computeWorkerWageTotals,
} from "@/lib/formulas";
import { validateHarvestStockForSaleTx } from "@/lib/harvestStockGuard";
import { provisionEntityGen6AccountAndCostCenter } from "@/lib/accountingCoreEngine";
import { assertDateNotInClosedFiscalYear } from "@/lib/fiscalYearClosingEngine";
import { findMatchingApprovalRule, submitApprovalRequest } from "@/lib/approvalEngine";
import { createWorkspaceDraft } from "@/lib/workspaceDraftsEngine";
import {
  appendAuditLogTx,
  findHarvestCycle,
  getBootstrapState,
  isHarvestLockedTx,
} from "@/lib/serverBootstrap";
import { collectServerSupportDiagnostics } from "@/lib/supportDiagnosticsServer";
import { collectServerBriefingInputs } from "./executiveBriefingServer";
import { normalizeMemoryTenantSlug } from "./copilotMemoryTypes";
import {
  linkArchivedAttachmentToRecord,
  listTenantVisionAttachments,
} from "./visionAttachmentArchive";
import type { VisionSourceAttachment } from "./copilotVisionTypes";
import {
  canCreate,
  canLockPeriod,
  canPostLedger,
  isReadOnly,
  normalizeRole,
  type ModuleIdentifier,
} from "@/lib/permissions";
import type { ResolvedActor } from "@/lib/apiHelpers";
import type {
  ConfirmationPreviewCard,
  PreviewLedgerLine,
  UasAgentExecutionContext,
  UasAgentJournalSummary,
} from "./uasAgentTools";

export async function buildServerAgentContext(
  actor?: ResolvedActor | null,
  lang?: "ar" | "en"
): Promise<UasAgentExecutionContext> {
  await ensureSqliteDatabaseReady();

  const [state, reports, diagnostics, rawEntries, briefingInputs] = await Promise.all([
    getBootstrapState(),
    generateFinancialReports(),
    collectServerSupportDiagnostics(),
    prisma.journalEntry.findMany({
      take: 20,
      orderBy: [{ date: "desc" }, { entryNumber: "desc" }],
      include: { lines: true },
    }),
    collectServerBriefingInputs(),
  ]);

  const coaAccounts = reports.trialBalance.rows.map((r) => ({
    code: r.code,
    nameAr: r.nameAr,
    nameEn: r.nameEn,
    level: r.level,
    type: r.type,
    isPosting: r.isPosting,
    rolledUpBalance: r.balance,
    balance: r.balance,
  }));

  const journalEntries: UasAgentJournalSummary[] = rawEntries.map((e) => ({
    id: e.id,
    entryNumber: e.entryNumber,
    date: e.date.toISOString(),
    narrationAr: e.narrationAr,
    narrationEn: e.narrationEn ?? undefined,
    totalDebit: e.lines.reduce((s, l) => s + Number(l.debitBase), 0),
    totalCredit: e.lines.reduce((s, l) => s + Number(l.creditBase), 0),
    status: e.status,
  }));

  const qrLookupHook: UasAgentExecutionContext["qrLookupHook"] = async (q: string) => {
    const [installment, payment, receipt, invoice, bill, journal] = await Promise.all([
      prisma.installmentVoucher.findFirst({
        where: { OR: [{ voucherNo: q }, { qrVerificationHash: q }] },
      }),
      prisma.paymentVoucher.findFirst({
        where: { OR: [{ voucherNumber: q }, { qrVerificationHash: q }] },
        include: { vendor: { select: { nameAr: true } } },
      }),
      prisma.receiptVoucher.findFirst({
        where: { OR: [{ voucherNumber: q }, { qrVerificationHash: q }] },
        include: { customer: { select: { nameAr: true } } },
      }),
      prisma.salesInvoice.findFirst({
        where: { OR: [{ invoiceNumber: q }, { qrVerificationHash: q }] },
        include: { customer: { select: { nameAr: true } } },
      }),
      prisma.vendorBill.findFirst({
        where: { billNumber: q },
        include: { vendor: { select: { nameAr: true } } },
      }),
      prisma.journalEntry.findFirst({
        where: { OR: [{ entryNumber: q }, { reference: q }] },
        include: { lines: true },
      }),
    ]);

    if (installment) {
      return {
        verified: true,
        documentType: installment.type === "CUSTOMER_RECEIPT" ? "سند قبض عميل" : "سند صرف عامل",
        reference: installment.voucherNo,
        party: installment.targetName,
        amount: Number(installment.amountYER),
        currency: "YER",
        date: installment.paymentDate,
        status: "VERIFIED_IMMUTABLE",
      };
    }
    if (payment) {
      return {
        verified: true,
        documentType: "سند صرف مورد (Payment Voucher)",
        reference: payment.voucherNumber,
        party: payment.vendor.nameAr,
        amount: Number(payment.amount),
        currency: payment.currency,
        date: payment.date.toISOString().slice(0, 10),
        status: "POSTED_TO_GL",
      };
    }
    if (receipt) {
      return {
        verified: true,
        documentType: "سند قبض مبيعات (Receipt Voucher)",
        reference: receipt.voucherNumber,
        party: receipt.customer.nameAr,
        amount: Number(receipt.amount),
        currency: receipt.currency,
        date: receipt.date.toISOString().slice(0, 10),
        status: "POSTED_TO_GL",
      };
    }
    if (invoice) {
      return {
        verified: true,
        documentType: "فاتورة مبيعات (Sales Invoice)",
        reference: invoice.invoiceNumber,
        party: invoice.customer.nameAr,
        amount: Number(invoice.totalAmount),
        currency: invoice.currency,
        date: invoice.date.toISOString().slice(0, 10),
        status: invoice.status,
      };
    }
    if (bill) {
      return {
        verified: true,
        documentType: "فاتورة مشتريات مورد (Vendor Bill)",
        reference: bill.billNumber,
        party: bill.vendor.nameAr,
        amount: Number(bill.totalAmount),
        currency: bill.currency,
        date: bill.date.toISOString().slice(0, 10),
        status: bill.status,
      };
    }
    if (journal) {
      const totalDr = journal.lines.reduce((s, l) => s + Number(l.debitBase), 0);
      return {
        verified: true,
        documentType: "قيد يومية عام (Journal Entry)",
        reference: journal.entryNumber,
        party: journal.narrationAr,
        amount: totalDr,
        currency: "YER",
        date: journal.date.toISOString().slice(0, 10),
        status: journal.status,
      };
    }
    return null;
  };

  return {
    user: actor?.user ?? actor?.userRole ?? "SUPER_ADMIN",
    lang,
    state,
    coaAccounts,
    journalEntries,
    reportSnapshot: {
      totalDebits: reports.trialBalance.totalDebits,
      totalCredits: reports.trialBalance.totalCredits,
      isBalanced: reports.trialBalance.isBalanced,
      totalRevenue: reports.incomeStatement.totalRevenue,
      totalExpenses: reports.incomeStatement.totalExpenses,
      netIncome:
        reports.incomeStatement.totalRevenue - reports.incomeStatement.totalExpenses,
      totalAssets: reports.balanceSheet.totalAssets,
      totalLiabilities: reports.balanceSheet.totalLiabilities,
      totalEquity: reports.balanceSheet.totalEquity,
    },
    diagnostics,
    briefingInventoryItems: briefingInputs.inventoryItems,
    briefingSalesInvoices: briefingInputs.salesInvoices,
    pendingConflictsCount: briefingInputs.pendingConflictsCount,
    visionArchiveEntries: listTenantVisionAttachments({
      tenantSlug: normalizeMemoryTenantSlug(getActiveTenantId()),
    }),
    qrLookupHook,
  };
}

export interface ConfirmedExecutionResult {
  ok: boolean;
  status: number;
  code?: string;
  executed_by_ai: boolean;
  entryNumber?: string;
  journalEntryId?: string;
  approvalRequired?: boolean;
  approvalRequestNumber?: string;
  draftId?: string;
  sourceAttachment?: VisionSourceAttachment | null;
  summaryAr: string;
  summaryEn: string;
}

function appendAttachmentReference(
  baseNotes: string,
  att: VisionSourceAttachment | null | undefined
): string {
  if (!att?.attachmentId || !att?.attachmentUrl) return baseNotes;
  const tag = `[source_doc:${att.attachmentId} | ${att.attachmentUrl}]`;
  return baseNotes.includes(att.attachmentId) ? baseNotes : `${baseNotes} ${tag}`.trim();
}

export async function executeConfirmedAiAction(input: {
  confirmationCard: ConfirmationPreviewCard;
  actor: ResolvedActor;
  tenantSlug?: string | null;
}): Promise<ConfirmedExecutionResult> {
  await ensureSqliteDatabaseReady();
  const { confirmationCard, actor } = input;
  const resolvedTenantSlug = normalizeMemoryTenantSlug(
    input.tenantSlug ||
      confirmationCard.sourceAttachment?.tenantSlug ||
      getActiveTenantId()
  );
  const rawAttachment =
    confirmationCard.sourceAttachment ||
    ((confirmationCard.executionPayload?.sourceAttachment as VisionSourceAttachment | undefined) ??
      null);
  const sourceAttachment =
    rawAttachment &&
    normalizeMemoryTenantSlug(rawAttachment.tenantSlug) === resolvedTenantSlug
      ? rawAttachment
      : null;
  const targetUser = actor.user ?? actor.userRole;
  const role = normalizeRole(targetUser);

  if (isReadOnly(targetUser)) {
    return {
      ok: false,
      status: 403,
      code: "RBAC_FORBIDDEN",
      executed_by_ai: false,
      summaryAr: `⛔ غير مصرح: حساب (${role}) للقراءة فقط ولا يمكنه اعتماد أو ترحيل العمليات.`,
      summaryEn: `⛔ RBAC Blocked: Role (${role}) is Read-Only and cannot confirm or post transactions.`,
    };
  }

  const op = confirmationCard.operationType;
  if (op === "JOURNAL_ENTRY" && !canPostLedger(targetUser)) {
    return {
      ok: false,
      status: 403,
      code: "RBAC_FORBIDDEN",
      executed_by_ai: false,
      summaryAr: `⛔ غير مصرح: ترحيل قيود اليومية المباشرة محصور بمدير النظام ورئيس الحسابات.`,
      summaryEn: `⛔ RBAC Blocked: Direct General Ledger posting requires SUPER_ADMIN or CHIEF_ACCOUNTANT.`,
    };
  }

  const moduleMap: Record<ConfirmationPreviewCard["operationType"], ModuleIdentifier> = {
    JOURNAL_ENTRY: "ledger",
    RECEIPT_VOUCHER: "sales",
    PAYMENT_VOUCHER: "expenses",
    SALES_INVOICE: "sales",
    PURCHASE_BILL: "procurement",
    CREATE_CUSTOMER: "customers",
    CREATE_VENDOR: "procurement",
    CREATE_PROJECT: "projects",
    EXPORT_CLIENT_REPORT: "customers",
    RECORD_HARVEST_BATCH: "inventory",
    RECORD_SALE: "sales",
    RECORD_EXPENSE: "expenses",
    RECORD_WORKER_WAGE: "workers",
    TREASURY_TRANSFER: "treasury",
    TOGGLE_PERIOD_LOCK: "audit",
    ADD_HARVEST_CYCLE: "projects",
  };
  const requiredModule = moduleMap[op] || "ledger";
  if (op === "TOGGLE_PERIOD_LOCK") {
    if (!canLockPeriod(targetUser)) {
      return {
        ok: false,
        status: 403,
        code: "RBAC_FORBIDDEN",
        executed_by_ai: false,
        summaryAr: `⛔ غير مصرح: إغلاق أو فتح فترات الحصاد محصور بالإدارة العليا ورئيس الحسابات.`,
        summaryEn: `⛔ RBAC Blocked: Locking/unlocking harvest periods requires SUPER_ADMIN or CHIEF_ACCOUNTANT.`,
      };
    }
  } else if (!canCreate(targetUser, requiredModule)) {
    return {
      ok: false,
      status: 403,
      code: "RBAC_FORBIDDEN",
      executed_by_ai: false,
      summaryAr: `⛔ غير مصرح: دورك الحالي (${role}) لا يملك صلاحية الترحيل في قسم (${requiredModule}).`,
      summaryEn: `⛔ RBAC Blocked: Role (${role}) does not have create permission in '${requiredModule}'.`,
    };
  }

  // 0. Master & Operational AI Actions (Create Customer, Create Vendor, Create Project, Export Client Report)
  if (op === "CREATE_CUSTOMER") {
    const payload = confirmationCard.executionPayload || {};
    const name = String(payload.name || confirmationCard.partyName || "").trim();
    const nameEn = String(payload.nameEn || name).trim();
    const phone = String(payload.phone || "").trim();
    const creditLimit = Math.max(0, Number(payload.creditLimit || 0));
    const address = payload.address ? String(payload.address).trim() : undefined;
    const costCenterId = payload.costCenterId ? String(payload.costCenterId).trim() : undefined;

    const customer = await prisma.$transaction(async (tx) => {
      const cust = await ensureCustomerWithAccountTx(tx, {
        name,
        nameEn,
        phone,
        address,
        costCenterId,
      });
      if (creditLimit > 0) {
        await tx.customer.update({
          where: { id: cust.id },
          data: { creditLimit },
        });
      }
      await recordAuditDiffTx(tx, {
        userId: actor.userId,
        action: "CREATE",
        entity: "Customer",
        entityId: cust.id,
        before: null,
        after: {
          code: cust.code,
          name: cust.name,
          phone: cust.phone,
          creditLimit,
          costCenterId: cust.costCenterId,
          executed_by_ai: true,
        },
      });
      await appendAuditLogTx(tx, {
        ...actor,
        actionType: "إنشاء عميل عبر المساعد الذكي [executed_by_ai: true]",
        entityReference: cust.code,
        details: `إضافة العميل ${cust.name} (${cust.code}) مع ربطه بشجرة الحسابات بالجيل السادس ومراكز التكلفة`,
      });
      return cust;
    });

    return {
      ok: true,
      status: 201,
      executed_by_ai: true,
      entryNumber: customer.code,
      summaryAr: `✅ **تم إنشاء العميل بنجاح!** الاسم: **${customer.name}** • الرمز: \`${customer.code}\` • الهاتف: ${customer.phone || "—"} (تم الربط التلقائي بحساب فرعي بالجيل السادس ومركز تكلفة [executed_by_ai: true]).`,
      summaryEn: `✅ **Customer Created Successfully!** Name: **${customer.name}** • Code: \`${customer.code}\` • Phone: ${customer.phone || "—"} (Auto-provisioned Gen-6 COA leaf & Cost Center [executed_by_ai: true]).`,
    };
  }

  if (op === "CREATE_VENDOR") {
    const payload = confirmationCard.executionPayload || {};
    const nameAr = String(payload.nameAr || confirmationCard.partyName || "").trim();
    const nameEn = payload.nameEn ? String(payload.nameEn).trim() : nameAr;
    const phone = String(payload.phone || "777000000").trim();
    const email = payload.email ? String(payload.email).trim() : undefined;
    const address = payload.address ? String(payload.address).trim() : undefined;
    const taxRegistration = payload.taxRegistration ? String(payload.taxRegistration).trim() : undefined;
    const costCenterId = payload.costCenterId ? String(payload.costCenterId).trim() : undefined;

    const vendor = await prisma.$transaction(async (tx) => {
      const v = await createVendorWithAccountTx(tx, {
        nameAr,
        nameEn,
        phone,
        email,
        address,
        taxRegistration,
        costCenterId,
      });
      await recordAuditDiffTx(tx, {
        userId: actor.userId,
        action: "CREATE",
        entity: "Vendor",
        entityId: v.id,
        before: null,
        after: {
          code: v.code,
          nameAr: v.nameAr,
          phone: v.phone,
          costCenterId: v.costCenterId,
          executed_by_ai: true,
        },
      });
      await appendAuditLogTx(tx, {
        ...actor,
        actionType: "إنشاء مورد عبر المساعد الذكي [executed_by_ai: true]",
        entityReference: v.code,
        details: `إضافة المورد ${v.nameAr} (${v.code}) مع ربطه بشجرة الحسابات بالجيل السادس ومراكز التكلفة`,
      });
      return v;
    });

    return {
      ok: true,
      status: 201,
      executed_by_ai: true,
      entryNumber: vendor.code,
      summaryAr: `✅ **تم إنشاء المورد بنجاح!** الاسم: **${vendor.nameAr}** • الرمز: \`${vendor.code}\` • الهاتف: ${vendor.phone} (تم الربط التلقائي بحساب فرعي بالجيل السادس ومركز تكلفة [executed_by_ai: true]).`,
      summaryEn: `✅ **Supplier Created Successfully!** Name: **${vendor.nameAr}** • Code: \`${vendor.code}\` • Phone: ${vendor.phone} (Auto-provisioned Gen-6 COA leaf & Cost Center [executed_by_ai: true]).`,
    };
  }

  if (op === "CREATE_PROJECT") {
    const payload = confirmationCard.executionPayload || {};
    const name = String(payload.name || confirmationCard.partyName || "").trim();
    const nameEn = String(payload.nameEn || name).trim();
    const budgetTotal = Math.max(0, Number(payload.budgetTotal ?? confirmationCard.totalDebit ?? 0));
    const plannedHarvestCount = Math.max(1, Number(payload.plannedHarvests || 1));
    const count = await prisma.project.count();
    const code = String(payload.code || `PRJ-${String(count + 1).padStart(3, "0")}`).trim();
    const notes = String(payload.notes || "").trim();

    const ORDINAL_HARVESTS = ["القطفة الأولى", "القطفة الثانية", "القطفة الثالثة", "القطفة الرابعة", "القطفة الخامسة"];
    const harvests = Array.from({ length: plannedHarvestCount }, (_, i) => ORDINAL_HARVESTS[i] || `القطفة ${i + 1}`);

    const project = await prisma.$transaction(async (tx) => {
      const uniqueCode = (await tx.project.findUnique({ where: { code } }))
        ? `${code}-${Date.now().toString().slice(-3)}`
        : code;

      const p = await tx.project.create({
        data: {
          code: uniqueCode,
          name,
          nameAr: name,
          nameEn,
          budgetTotal,
          estimatedValue: budgetTotal,
          plannedHarvestCount,
          status: "ACTIVE",
          notes,
          harvestCycles: {
            create: harvests.map((hName, idx) => ({
              cycleNumber: idx + 1,
              name: hName,
              sortOrder: idx + 1,
              isLocked: false,
            })),
          },
        },
      });

      await provisionEntityGen6AccountAndCostCenter(
        { entityType: "PROJECT", entityId: p.id, nameAr: name, nameEn },
        tx
      );

      await recordAuditDiffTx(tx, {
        userId: actor.userId,
        action: "CREATE",
        entity: "Project",
        entityId: p.id,
        before: null,
        after: {
          code: p.code,
          name: p.name,
          budgetTotal,
          executed_by_ai: true,
        },
      });

      await appendAuditLogTx(tx, {
        ...actor,
        actionType: "إنشاء مشروع عبر المساعد الذكي [executed_by_ai: true]",
        entityReference: p.code,
        details: `إضافة مشروع ${p.name} (${p.code}) بموازنة ${budgetTotal.toLocaleString()} ريال ودورات حصاد: ${plannedHarvestCount}`,
      });

      return p;
    });

    return {
      ok: true,
      status: 201,
      executed_by_ai: true,
      entryNumber: project.code,
      summaryAr: `✅ **تم إنشاء المشروع بنجاح!** الاسم: **${project.nameAr}** • الرمز: \`${project.code}\` • الموازنة: **${budgetTotal.toLocaleString()} YER** (تم توليد حساب Gen-6 ومركز تكلفة ودورات الحصاد [executed_by_ai: true]).`,
      summaryEn: `✅ **Project Created Successfully!** Name: **${project.nameAr}** • Code: \`${project.code}\` • Budget: **${budgetTotal.toLocaleString()} YER** (Generated Gen-6 leaf, Cost Center & Harvest Cycles [executed_by_ai: true]).`,
    };
  }

  if (op === "EXPORT_CLIENT_REPORT") {
    const payload = confirmationCard.executionPayload || {};
    const partyName = String(confirmationCard.partyName || payload.customerName || "كافة العملاء").trim();
    const includeSaleDetails = Boolean(payload.includeSaleDetails ?? true);

    return {
      ok: true,
      status: 200,
      executed_by_ai: true,
      entryNumber: `RPT-CUST-${Date.now().toString().slice(-4)}`,
      summaryAr: `📄 **جاهز لتصدير/طباعة كشف حساب العميل (${partyName})**\n- خيار تفاصيل المبيعات: **${includeSaleDetails ? "مضمّنة بالكامل (تفاصيل الأصناف والكميات والأسعار) ✅" : "ملخص إجمالي فقط 📊"}**\nيمكنك طباعة الكشف أو تصدير الملف PDF مباشرة من قسم العملاء.`,
      summaryEn: `📄 **Ready to export/print Client Account Statement (${partyName})**\n- Sale Details: **${includeSaleDetails ? "Itemized sales included (items, qty, price, total) ✅" : "Summary totals only 📊"}**\nYou can print or export PDF directly from the Customers module.`,
    };
  }

  // 0b. Operational & Multi-Section Execution (Harvest, Sales, Expenses, Wages, Treasury Transfer, Locks, Cycles)
  if (op === "RECORD_HARVEST_BATCH") {
    const p = confirmationCard.executionPayload || {};
    const projectId = String(p.projectId || confirmationCard.projectId || "").trim();
    const harvestName = String(p.harvest || "").trim();
    const productGrade = String(p.grade || "رقم 1").trim();
    const harvestedBundles = Math.max(0, Math.round(Number(p.harvestedBundles) || 0));
    const shrinkageBundles = Math.max(0, Math.round(Number(p.shrinkageBundles) || 0));
    const subProjectId = p.subProjectId ? String(p.subProjectId).trim() : null;
    const notes = appendAttachmentReference(
      String(p.notes || "تسجيل عبر المساعد الذكي").trim(),
      sourceAttachment
    );

    const res = await prisma.$transaction(async (tx) => {
      if (await isHarvestLockedTx(tx, projectId, harvestName)) {
        return { locked: true as const };
      }
      const cycle = await findHarvestCycle(tx, projectId, harvestName);
      const batch = await tx.harvestInventoryBatch.create({
        data: {
          projectId,
          subProjectId,
          harvestCycleId: cycle?.id ?? null,
          harvestName,
          productGrade,
          harvestedBundles,
          shrinkageBundles,
          notes,
        },
      });
      await appendAuditLogTx(tx, {
        ...actor,
        actionType: "إضافة دفعة مخزون عبر المساعد الذكي [executed_by_ai: true]",
        entityReference: batch.id,
        details: `${harvestName} (${productGrade}) — ${harvestedBundles} علاقية${sourceAttachment ? ` • [source_doc:${sourceAttachment.attachmentId} | ${sourceAttachment.attachmentUrl}]` : ""}`,
      });
      return { locked: false as const, batch };
    });

    if (res.locked) {
      return {
        ok: false,
        status: 423,
        code: "PERIOD_LOCKED",
        executed_by_ai: false,
        summaryAr: "🔒 تعذر التنفيذ: هذه القطفة مغلقة محاسبياً.",
        summaryEn: "🔒 Blocked: This harvest period is locked in the audit trail.",
      };
    }

    const linkedAttachment = sourceAttachment
      ? linkArchivedAttachmentToRecord({
          tenantSlug: resolvedTenantSlug,
          attachmentId: sourceAttachment.attachmentId,
          recordType: "RECORD_HARVEST_BATCH",
          recordId: res.batch.id,
          entryNumber: res.batch.id,
        }) || sourceAttachment
      : null;

    return {
      ok: true,
      status: 201,
      executed_by_ai: true,
      entryNumber: res.batch.id,
      ...(linkedAttachment ? { sourceAttachment: linkedAttachment } : {}),
      summaryAr: `✅ **تم تسجيل دفعة مخزون الحصاد بنجاح!** الكمية: **${harvestedBundles}** (${productGrade}) في **${harvestName}** [executed_by_ai: true].`,
      summaryEn: `✅ **Harvest Inventory Batch Recorded!** Qty: **${harvestedBundles}** (${productGrade}) in **${harvestName}** [executed_by_ai: true].`,
    };
  }

  if (op === "RECORD_SALE") {
    const p = confirmationCard.executionPayload || {};
    const projectId = String(p.projectId || confirmationCard.projectId || "").trim();
    const subProjectId = p.subProjectId ? String(p.subProjectId).trim() : null;
    const harvestName = String(p.harvest || "").trim();
    const productGrade = String(p.grade || "رقم 1").trim();
    const customerName = String(p.customer || confirmationCard.partyName || "").trim();
    const customerPhone = String(p.phone || "").trim();
    const bundlesCount = Math.max(0, Math.round(Number(p.bundles) || 0));
    const unitPrice = Number(p.price) || 0;
    const creditPaid = Number(p.credit) || 0;
    const saleDate = String(p.date || confirmationCard.date || new Date().toISOString().slice(0, 10));
    const treasuryAccountId = p.treasuryAccountId ? String(p.treasuryAccountId).trim() : "t1";
    const notes = appendAttachmentReference(
      String(p.notes || "تسجيل بيع عبر المساعد الذكي").trim(),
      sourceAttachment
    );

    const { totalAmount, debitReceivable } = computeSaleTotals(bundlesCount, unitPrice, creditPaid);
    const res = await prisma.$transaction(async (tx) => {
      if (await isHarvestLockedTx(tx, projectId, harvestName)) {
        return { locked: true as const };
      }
      const year = new Date(saleDate).getFullYear() || 2026;
      const prefix = `SO-${year}-`;
      const countThisYear = await tx.saleTransaction.count({ where: { sequenceNumber: { startsWith: prefix } } });
      let seqNum = countThisYear + 1;
      let sequenceNumber = `${prefix}${String(seqNum).padStart(4, "0")}`;
      while (await tx.saleTransaction.findFirst({ where: { sequenceNumber } })) {
        seqNum++;
        sequenceNumber = `${prefix}${String(seqNum).padStart(4, "0")}`;
      }
      const receiptVoucherNo = `RV-${Math.floor(100 + Math.random() * 900)}`;
      const dailyBatchLabel = `بيع ذكي #${seqNum}`;
      const cycle = await findHarvestCycle(tx, projectId, harvestName);
      const customer = await ensureCustomerWithAccountTx(tx, { name: customerName, phone: customerPhone });
      const stockGuard = bundlesCount > 0
        ? await validateHarvestStockForSaleTx(tx, {
            projectId,
            subProjectId,
            harvestName,
            productGrade,
            requestedBundles: bundlesCount,
            allowNegativeStock: Boolean(p.allowNegativeStock),
            actorRole: actor.userRole,
          })
        : { overridden: false, availableBundles: 0, shortageBundles: 0 };

      let journalEntryId: string | null = null;
      let finalRevenueCode = "411101";
      if (totalAmount > 0) {
        const invRes = await postSalesInvoice({
          tx,
          customerId: customer.id,
          projectId,
          subProjectId,
          harvestCycleId: cycle?.id ?? null,
          amount: totalAmount,
          currency: "YER",
          date: new Date(`${saleDate}T10:00:00Z`),
          creditPaidImmediate: creditPaid,
          notes,
          sequenceNumber,
          dailyBatchLabel,
          treasuryAccountId,
          createdById: actor.userId ?? undefined,
        });
        journalEntryId = invRes.journalEntry.id;
        finalRevenueCode = invRes.invoice.revenueAccountCode || finalRevenueCode;
        if (creditPaid > 0) {
          await postCustomerReceipt({
            tx,
            customerId: customer.id,
            invoiceId: invRes.invoice.id,
            projectId,
            subProjectId,
            treasuryId: treasuryAccountId,
            amount: creditPaid,
            currency: "YER",
            date: new Date(`${saleDate}T10:05:00Z`),
            notes: `تحصيل عند البيع (${receiptVoucherNo})`,
            createdById: actor.userId ?? undefined,
          });
        }
      }

      const sale = await tx.saleTransaction.create({
        data: {
          sequenceNumber,
          dailyBatchLabel,
          salesOfficerId: actor.userId || null,
          salesOfficerTitle: actor.userDisplay || "المساعد الذكي",
          revenueAccountCode: finalRevenueCode,
          treasuryAccountId,
          projectId,
          subProjectId,
          harvestCycleId: cycle?.id ?? null,
          harvestName,
          saleBatchLabel: dailyBatchLabel,
          customerId: customer.id,
          customerName: customer.name,
          customerPhone: customer.phone,
          productGrade,
          bundlesCount,
          unitPrice,
          totalAmount,
          creditPaid,
          debitReceivable,
          saleDate,
          receiptVoucherNo,
          notes,
          journalEntryId,
        },
      });
      await appendAuditLogTx(tx, {
        ...actor,
        actionType: `ترحيل بيع عبر المساعد الذكي (${sequenceNumber}) [executed_by_ai: true]`,
        entityReference: sale.id,
        details: `${customer.name} • ${bundlesCount} × ${unitPrice} = ${totalAmount} (${harvestName})${stockGuard.overridden ? " [تجاوز مخزون]" : ""}`,
      });
      return { locked: false as const, sale, sequenceNumber };
    });

    if (res.locked) {
      return {
        ok: false,
        status: 423,
        code: "PERIOD_LOCKED",
        executed_by_ai: false,
        summaryAr: "🔒 تعذر ترحيل البيع: القطفة مغلقة محاسبياً.",
        summaryEn: "🔒 Sale blocked: Target harvest period is locked.",
      };
    }

    const linkedSaleAttachment = sourceAttachment
      ? linkArchivedAttachmentToRecord({
          tenantSlug: resolvedTenantSlug,
          attachmentId: sourceAttachment.attachmentId,
          recordType: "RECORD_SALE",
          recordId: res.sequenceNumber,
          entryNumber: res.sequenceNumber,
        }) || sourceAttachment
      : null;

    return {
      ok: true,
      status: 201,
      executed_by_ai: true,
      entryNumber: res.sequenceNumber,
      ...(linkedSaleAttachment ? { sourceAttachment: linkedSaleAttachment } : {}),
      summaryAr: `✅ **تم تسجيل وترحيل عملية البيع بنجاح (${res.sequenceNumber})!** العميل: **${customerName}** • الإجمالي: **${totalAmount.toLocaleString()} YER** [executed_by_ai: true].`,
      summaryEn: `✅ **Harvest Sale Posted (${res.sequenceNumber})!** Customer: **${customerName}** • Total: **${totalAmount.toLocaleString()} YER** [executed_by_ai: true].`,
    };
  }

  if (op === "RECORD_EXPENSE") {
    const p = confirmationCard.executionPayload || {};
    const projectId = String(p.projectId || confirmationCard.projectId || "").trim();
    const subProjectId = p.subProjectId ? String(p.subProjectId).trim() : null;
    const harvestName = String(p.harvest || "").trim();
    const category = String(p.category || "وقود/محروقات").trim();
    const subType = String(p.subType || category).trim();
    const quantity = Number(p.qty) || 1;
    const unitPrice = Number(p.unitPrice) || 0;
    const expenseDate = String(p.date || confirmationCard.date || new Date().toISOString().slice(0, 10));
    const treasuryAccountId = p.treasuryAccountId ? String(p.treasuryAccountId).trim() : undefined;
    const notes = appendAttachmentReference(
      String(p.notes || "مصروف تشغيلي عبر المساعد الذكي").trim(),
      sourceAttachment
    );
    const totalAmount = computeOperatingExpenseTotal(quantity, unitPrice);

    const res = await prisma.$transaction(async (tx) => {
      if (await isHarvestLockedTx(tx, projectId, harvestName)) {
        return { locked: true as const };
      }
      const cycle = await findHarvestCycle(tx, projectId, harvestName);
      const expense = await tx.operatingExpense.create({
        data: {
          projectId,
          subProjectId,
          harvestCycleId: cycle?.id ?? null,
          harvestName,
          category,
          subType,
          quantity,
          unitPrice,
          totalAmount,
          expenseDate,
          notes,
        },
      });
      const je = await postOperatingExpenseJournalTx(tx, {
        expenseId: expense.id,
        projectId,
        subProjectId,
        harvestCycleId: cycle?.id ?? null,
        category,
        subType,
        totalAmount,
        date: expenseDate,
        treasuryAccountId,
        createdById: actor.userId ?? undefined,
      });
      if (je) {
        await tx.operatingExpense.update({ where: { id: expense.id }, data: { journalEntryId: je.id } });
      }
      await appendAuditLogTx(tx, {
        ...actor,
        actionType: "ترحيل مصروف تشغيلي عبر المساعد الذكي [executed_by_ai: true]",
        entityReference: expense.id,
        details: `${category} — ${totalAmount.toLocaleString()} YER (${harvestName})${sourceAttachment ? ` • [source_doc:${sourceAttachment.attachmentId} | ${sourceAttachment.attachmentUrl}]` : ""}`,
      });
      return { locked: false as const, expense, entryNumber: je?.entryNumber || expense.id };
    });

    if (res.locked) {
      return {
        ok: false,
        status: 423,
        code: "PERIOD_LOCKED",
        executed_by_ai: false,
        summaryAr: "🔒 تعذر تسجيل المصروف: القطفة مغلقة محاسبياً.",
        summaryEn: "🔒 Blocked: Harvest period is locked.",
      };
    }

    const linkedExpenseAttachment = sourceAttachment
      ? linkArchivedAttachmentToRecord({
          tenantSlug: resolvedTenantSlug,
          attachmentId: sourceAttachment.attachmentId,
          recordType: "RECORD_EXPENSE",
          recordId: res.expense.id,
          entryNumber: res.entryNumber,
        }) || sourceAttachment
      : null;

    return {
      ok: true,
      status: 201,
      executed_by_ai: true,
      entryNumber: res.entryNumber,
      ...(linkedExpenseAttachment ? { sourceAttachment: linkedExpenseAttachment } : {}),
      summaryAr: `✅ **تم تسجيل وترحيل المصروف التشغيلي (${res.entryNumber})!** الفئة: **${category}** • المبلغ: **${totalAmount.toLocaleString()} YER** [executed_by_ai: true].`,
      summaryEn: `✅ **Operating Expense Posted (${res.entryNumber})!** Category: **${category}** • Amount: **${totalAmount.toLocaleString()} YER** [executed_by_ai: true].`,
    };
  }

  if (op === "RECORD_WORKER_WAGE") {
    const p = confirmationCard.executionPayload || {};
    const projectId = String(p.projectId || confirmationCard.projectId || "").trim();
    const subProjectId = p.subProjectId ? String(p.subProjectId).trim() : null;
    const harvestName = String(p.harvest || "").trim();
    const name = String(p.name || confirmationCard.partyName || "").trim();
    const dailyWage = Number(p.dailyWage) || 0;
    const daysWorked = Number(p.days) || 1;
    const creditAmount = Number(p.credit) || 0;
    const workDate = String(p.date || confirmationCard.date || new Date().toISOString().slice(0, 10));
    const notes = String(p.notes || "أجر مسجل عبر المساعد الذكي").trim();
    const { totalWage, debitBalance } = computeWorkerWageTotals(dailyWage, daysWorked, creditAmount);

    const res = await prisma.$transaction(async (tx) => {
      if (await isHarvestLockedTx(tx, projectId, harvestName)) {
        return { locked: true as const };
      }
      const cycle = await findHarvestCycle(tx, projectId, harvestName);
      const worker = await ensureWorkerWithAccountTx(tx, { name, defaultDailyWage: dailyWage, phone: "" });
      const entry = await tx.workerWageEntry.create({
        data: {
          workerId: worker.id,
          workerName: worker.name,
          projectId,
          subProjectId,
          harvestCycleId: cycle?.id ?? null,
          harvestName,
          dailyWage,
          daysWorked,
          totalWage,
          creditAmount,
          debitBalance,
          workDate,
          notes,
        },
      });
      if (worker.accountId) {
        const je = await postWorkerWageJournalTx(tx, {
          wageEntryId: entry.id,
          workerName: worker.name,
          workerAccountId: worker.accountId,
          projectId,
          subProjectId,
          harvestCycleId: cycle?.id ?? null,
          totalWage,
          creditAmount,
          date: workDate,
          costCenterId: worker.costCenterId ?? undefined,
          createdById: actor.userId ?? undefined,
        });
        if (je) {
          await tx.workerWageEntry.update({ where: { id: entry.id }, data: { journalEntryId: je.id } });
        }
      }
      await appendAuditLogTx(tx, {
        ...actor,
        actionType: "تسجيل أجر عامل عبر المساعد الذكي [executed_by_ai: true]",
        entityReference: entry.id,
        details: `${worker.name} — ${totalWage.toLocaleString()} YER (${harvestName})`,
      });
      return { locked: false as const, entry, worker };
    });

    if (res.locked) {
      return {
        ok: false,
        status: 423,
        code: "PERIOD_LOCKED",
        executed_by_ai: false,
        summaryAr: "🔒 تعذر تسجيل الأجر: القطفة مغلقة محاسبياً.",
        summaryEn: "🔒 Blocked: Harvest period is locked.",
      };
    }

    return {
      ok: true,
      status: 201,
      executed_by_ai: true,
      entryNumber: res.entry.id,
      summaryAr: `✅ **تم تسجيل أجر العامل بنجاح!** العامل: **${res.worker.name}** • الإجمالي: **${totalWage.toLocaleString()} YER** [executed_by_ai: true].`,
      summaryEn: `✅ **Worker Wage Recorded!** Worker: **${res.worker.name}** • Total: **${totalWage.toLocaleString()} YER** [executed_by_ai: true].`,
    };
  }

  if (op === "TREASURY_TRANSFER") {
    const p = confirmationCard.executionPayload || {};
    const res = await transferBetweenTreasuries({
      fromTreasuryId: String(p.fromTreasuryId || ""),
      toTreasuryId: String(p.toTreasuryId || ""),
      amount: Number(p.amount) || 0,
      notes: p.notes ? String(p.notes) : undefined,
      date: p.date ? String(p.date) : new Date(),
      createdById: actor.userId ?? undefined,
    });
    return {
      ok: true,
      status: 201,
      executed_by_ai: true,
      entryNumber: res.journalEntry.entryNumber,
      journalEntryId: res.journalEntry.id,
      summaryAr: `✅ **تم التحويل المالي بنجاح!** رقم القيد: **${res.journalEntry.entryNumber}** [executed_by_ai: true].`,
      summaryEn: `✅ **Treasury Transfer Executed!** Entry: **${res.journalEntry.entryNumber}** [executed_by_ai: true].`,
    };
  }

  if (op === "TOGGLE_PERIOD_LOCK") {
    const p = confirmationCard.executionPayload || {};
    const projectId = String(p.projectId || confirmationCard.projectId || "").trim();
    const harvestName = String(p.harvest || "").trim();
    const lockRes = await prisma.$transaction(async (tx) => {
      const cycle = await tx.harvestCycle.findFirst({ where: { projectId, name: harvestName } });
      if (!cycle) throw new Error("CYCLE_NOT_FOUND");
      const nextLocked = !cycle.isLocked;
      await tx.harvestCycle.update({
        where: { id: cycle.id },
        data: {
          isLocked: nextLocked,
          lockedByUserId: nextLocked ? actor.userId : null,
          lockedById: nextLocked ? actor.userId : null,
          lockedAt: nextLocked ? new Date() : null,
        },
      });
      await appendAuditLogTx(tx, {
        ...actor,
        actionType: `${nextLocked ? "إغلاق فترة قطفة 🔒" : "إعادة فتح فترة قطفة 🔓"} عبر المساعد الذكي [executed_by_ai: true]`,
        entityReference: cycle.id,
        details: `${projectId}::${harvestName}`,
      });
      return { cycle, nextLocked };
    });
    return {
      ok: true,
      status: 200,
      executed_by_ai: true,
      entryNumber: lockRes.cycle.id,
      summaryAr: `✅ **تم ${lockRes.nextLocked ? "الإغلاق المحاسبي 🔒" : "إعادة الفتح 🔓"} للقطفة (${harvestName}) بنجاح!** [executed_by_ai: true]`,
      summaryEn: `✅ **Harvest Period "${harvestName}" ${lockRes.nextLocked ? "Locked 🔒" : "Unlocked 🔓"}!** [executed_by_ai: true]`,
    };
  }

  if (op === "ADD_HARVEST_CYCLE") {
    const p = confirmationCard.executionPayload || {};
    const projectId = String(p.projectId || confirmationCard.projectId || "").trim();
    const harvestName = String(p.name || "").trim();
    await prisma.$transaction(async (tx) => {
      const project = await tx.project.findUnique({ where: { id: projectId }, include: { harvestCycles: true } });
      if (!project) throw new Error("PROJECT_NOT_FOUND");
      const existing = project.harvestCycles.find((h) => h.name === harvestName);
      if (!existing) {
        await tx.harvestCycle.create({
          data: { projectId, name: harvestName, sortOrder: project.harvestCycles.length + 1, isLocked: false },
        });
        await tx.project.update({ where: { id: projectId }, data: { plannedHarvestCount: project.harvestCycles.length + 1 } });
        await appendAuditLogTx(tx, {
          ...actor,
          actionType: "إضافة قطفة عبر المساعد الذكي [executed_by_ai: true]",
          entityReference: projectId,
          details: `إضافة "${harvestName}" إلى ${project.name}`,
        });
      }
    });
    return {
      ok: true,
      status: 201,
      executed_by_ai: true,
      entryNumber: harvestName,
      summaryAr: `✅ **تمت إضافة القطفة (${harvestName}) للمشروع بنجاح!** [executed_by_ai: true]`,
      summaryEn: `✅ **Harvest cycle "${harvestName}" added to project!** [executed_by_ai: true]`,
    };
  }

  const lines: PreviewLedgerLine[] = Array.isArray(confirmationCard.lines)
    ? confirmationCard.lines
    : [];
  if (lines.length < 2) {
    return {
      ok: false,
      status: 400,
      code: "INVALID_JOURNAL_LINES",
      executed_by_ai: false,
      summaryAr: "⚠️ القيد المعاين يجب أن يحتوي على سطرين على الأقل.",
      summaryEn: "⚠️ Previewed entry must contain at least 2 lines.",
    };
  }

  const totalDr = Number(lines.reduce((s, l) => s + Number(l.debit || 0), 0).toFixed(2));
  const totalCr = Number(lines.reduce((s, l) => s + Number(l.credit || 0), 0).toFixed(2));
  if (totalDr <= 0 || Math.abs(totalDr - totalCr) > 0.005) {
    return {
      ok: false,
      status: 400,
      code: "UNBALANCED_JOURNAL_ENTRY",
      executed_by_ai: false,
      summaryAr: `⚠️ القيد غير متوازن (${totalDr} !== ${totalCr}).`,
      summaryEn: `⚠️ Unbalanced journal lines (${totalDr} !== ${totalCr}).`,
    };
  }

  // 1. Workspace Draft Routing (if user explicitly requested saving as draft)
  if (confirmationCard.executionPayload?.isDraft || confirmationCard.executionPayload?.saveAsDraft) {
    const draft = await createWorkspaceDraft({
      module: "ACCOUNTING",
      formType: op,
      titleAr: confirmationCard.narrationAr,
      titleEn: confirmationCard.narrationEn,
      payload: {
        ...confirmationCard.executionPayload,
        currency: confirmationCard.currency || "YER",
        costCenterId: confirmationCard.costCenterId || null,
        lines,
        totalDebit: totalDr,
        totalCredit: totalCr,
      },
      actor: {
        userId: actor.userId || "u1",
        userName: actor.userDisplay || "AI Copilot",
        userRole: actor.userRole || "FIELD_ACCOUNTANT",
      },
    });
    return {
      ok: true,
      status: 201,
      code: "DRAFT_SAVED",
      executed_by_ai: true,
      draftId: draft.id,
      summaryAr: `📝 تم حفظ العملية كمسودة عمل بنجاح (${draft.draftNumber}). يمكنك متابعتها واعتمادها لاحقاً.`,
      summaryEn: `📝 Transaction successfully saved as workspace draft (${draft.draftNumber}).`,
    };
  }

  // 2. Fiscal Year Period Lock Verification
  const entryDateStr = confirmationCard.date || new Date().toISOString().slice(0, 10);
  try {
    await assertDateNotInClosedFiscalYear(prisma, new Date(entryDateStr));
  } catch {
    return {
      ok: false,
      status: 400,
      code: "FISCAL_YEAR_CLOSED",
      executed_by_ai: false,
      summaryAr: `⛔ لا يمكن ترحيل العملية: الفترة المالية لتاريخ (${entryDateStr}) مغلقة ومقفلة بالكامل.`,
      summaryEn: `⛔ Transaction blocked: Fiscal year for date (${entryDateStr}) is closed and locked.`,
    };
  }

  // 3. Approval Engine Governance & Threshold Evaluation
  let exchangeRate = Number(confirmationCard.exchangeRate || 0);
  if (exchangeRate <= 0) {
    if (confirmationCard.currency === "SAR") exchangeRate = 530;
    else if (confirmationCard.currency === "USD") exchangeRate = 2000;
    else exchangeRate = 1.0;
  }
  const totalDrBase = Number((totalDr * exchangeRate).toFixed(2));

  const matchingRule = await findMatchingApprovalRule(
    { module: "ACCOUNTING", actionType: "GL_POSTING", amountBase: totalDrBase },
    prisma
  );

  try {
    if (matchingRule) {
      // Create journal entry with PENDING_APPROVAL status and route to Approval Queue
      const result = await prisma.$transaction(async (tx) => {
        const entry = await postJournalEntry({
          tx,
          date: entryDateStr,
          narrationAr: confirmationCard.narrationAr,
          narrationEn: confirmationCard.narrationEn,
          sourceType: `AI_COPILOT_${op}`,
          projectId: confirmationCard.projectId ?? null,
          createdById: actor.userId ?? undefined,
          lines: lines.map((l) => ({
            accountCode: l.accountCode,
            debit: l.debit,
            credit: l.credit,
            currency: l.currency || confirmationCard.currency || "YER",
            exchangeRate: l.exchangeRate || exchangeRate,
            costCenterId: l.costCenterId || confirmationCard.costCenterId || null,
            memo: l.memo || confirmationCard.narrationAr,
          })),
        });

        await tx.journalEntry.updateMany({
          where: { id: entry.id },
          data: { status: "PENDING_APPROVAL", documentStatus: "PENDING_APPROVAL" },
        });

        return entry;
      });

      const aprReq = await submitApprovalRequest({
        module: "ACCOUNTING",
        actionType: "GL_POSTING",
        targetType: "JournalEntry",
        targetId: result.id,
        documentNumber: result.entryNumber,
        summaryAr: confirmationCard.narrationAr,
        amountBase: totalDrBase,
        currencyCode: confirmationCard.currency || "YER",
        afterSnapshot: {
          entryNumber: result.entryNumber,
          totalDebit: totalDr,
          lines,
          executed_by_ai: true,
        },
        actor: {
          userId: actor.userId || "u1",
          userName: actor.userDisplay || "AI Copilot",
          userRole: actor.userRole || "FIELD_ACCOUNTANT",
        },
      });

      await prisma.$transaction(async (tx) => {
        await recordAuditDiffTx(tx, {
          userId: actor.userId,
          action: "CREATE",
          entity: "ApprovalRequest",
          entityId: aprReq.id,
          before: null,
          after: {
            requestNumber: aprReq.requestNumber,
            targetDocument: result.entryNumber,
            amountBase: totalDrBase,
            ruleId: matchingRule.id,
            executed_by_ai: true,
          },
        });

        await appendAuditLogTx(tx, {
          ...actor,
          actionType: `إحالة عملية المساعد الذكي للاعتماد (${aprReq.requestNumber}) [executed_by_ai: true]`,
          entityReference: aprReq.requestNumber,
          details: JSON.stringify({
            requestNumber: aprReq.requestNumber,
            entryNumber: result.entryNumber,
            amountBase: totalDrBase,
            requiredRole: matchingRule.requiredRole,
          }),
        });
      });

      return {
        ok: true,
        status: 202,
        code: "SUBMITTED_FOR_APPROVAL",
        executed_by_ai: true,
        entryNumber: result.entryNumber,
        journalEntryId: result.id,
        approvalRequired: true,
        approvalRequestNumber: aprReq.requestNumber,
        summaryAr: `⏳ **تم إنشاء القيد بنجاح (${result.entryNumber}) وإحالته لطابور الاعتماد (${aprReq.requestNumber})** نظراً لأن المبلغ (${totalDrBase.toLocaleString()} YER) يتجاوز الحد المالي للقواعد (${matchingRule.minAmountBase.toLocaleString()} YER). يتطلب موافقة: ${matchingRule.requiredRole}.`,
        summaryEn: `⏳ **Journal entry (${result.entryNumber}) created and routed to Approval Queue (${aprReq.requestNumber})** as amount (${totalDrBase.toLocaleString()} YER) exceeds rule threshold (${matchingRule.minAmountBase.toLocaleString()} YER). Requires: ${matchingRule.requiredRole}.`,
      };
    }

    // Direct posting when no approval rule matches
    const posted = await prisma.$transaction(async (tx) => {
      const entry = await postJournalEntry({
        tx,
        date: entryDateStr,
        narrationAr: confirmationCard.narrationAr,
        narrationEn: confirmationCard.narrationEn,
        sourceType: `AI_COPILOT_${op}`,
        projectId: confirmationCard.projectId ?? null,
        createdById: actor.userId ?? undefined,
        lines: lines.map((l) => ({
          accountCode: l.accountCode,
          debit: l.debit,
          credit: l.credit,
          currency: l.currency || confirmationCard.currency || "YER",
          exchangeRate: l.exchangeRate || exchangeRate,
          costCenterId: l.costCenterId || confirmationCard.costCenterId || null,
          memo: l.memo || confirmationCard.narrationAr,
        })),
      });

      await recordAuditDiffTx(tx, {
        userId: actor.userId,
        action: "POST",
        entity: "JournalEntry",
        entityId: entry.id,
        before: null,
        after: {
          entryNumber: entry.entryNumber,
          operationType: op,
          totalDebit: totalDr,
          totalCredit: totalCr,
          costCenterId: confirmationCard.costCenterId,
          currency: confirmationCard.currency || "YER",
          exchangeRate,
          executed_by_ai: true,
        },
      });

      await appendAuditLogTx(tx, {
        ...actor,
        actionType: `ترحيل عملية محاسبية عبر المساعد الذكي (${op}) [executed_by_ai: true]`,
        entityReference: entry.entryNumber,
        details: JSON.stringify({
          entryNumber: entry.entryNumber,
          operationType: op,
          narrationAr: confirmationCard.narrationAr,
          totalDebit: totalDr,
          totalCredit: totalCr,
          currency: confirmationCard.currency || "YER",
          exchangeRate,
          costCenterId: confirmationCard.costCenterId,
          ...(sourceAttachment
            ? {
                sourceAttachmentId: sourceAttachment.attachmentId,
                sourceAttachmentUrl: sourceAttachment.attachmentUrl,
              }
            : {}),
          executed_by_ai: true,
        }),
      });

      return entry;
    });

    const linkedGlAttachment = sourceAttachment
      ? linkArchivedAttachmentToRecord({
          tenantSlug: resolvedTenantSlug,
          attachmentId: sourceAttachment.attachmentId,
          recordType: op,
          recordId: posted.id,
          entryNumber: posted.entryNumber,
        }) || sourceAttachment
      : null;

    return {
      ok: true,
      status: 200,
      executed_by_ai: true,
      entryNumber: posted.entryNumber,
      journalEntryId: posted.id,
      ...(linkedGlAttachment ? { sourceAttachment: linkedGlAttachment } : {}),
      summaryAr: `✅ **تم التأكيد والترحيل بنجاح!** رقم القيد في دفتر الأستاذ: **${posted.entryNumber}** بمبلغ **${totalDr.toLocaleString()} ${confirmationCard.currency}** (موثق في سجل التدقيق بعلامة \`executed_by_ai: true\`).`,
      summaryEn: `✅ **Confirmed & Posted to General Ledger!** Entry Number: **${posted.entryNumber}** for **${totalDr.toLocaleString()} ${confirmationCard.currency}** (recorded in the audit trail with \`executed_by_ai: true\`).`,
    };
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : undefined;
    return {
      ok: false,
      status: 400,
      code: "EXECUTION_FAILED",
      executed_by_ai: false,
      summaryAr: `⚠️ تعذر ترحيل العملية: ${errMsg || "خطأ غير معروف"}`,
      summaryEn: `⚠️ Failed to post confirmed transaction: ${errMsg || "Unknown error"}`,
    };
  }
}
