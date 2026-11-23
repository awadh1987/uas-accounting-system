/**
 * UAS Enterprise — Proactive Daily Executive Briefing & Low-Stock / Overdue-Receivable Alert Engine
 *
 * Zero Node-only imports: runs identically on the server (alongside Prisma & Gemini synthesis)
 * and 100% offline in Capacitor Android APK & Windows Desktop localStorage mode.
 *
 * Enforces strict tenant isolation (`tenantSlug` on every snapshot & cached item),
 * role-aware visibility, Yemeni dialect / MSA / English narration, and Copilot Memory grounding.
 */

import { reconcileHarvestInventory } from "@/lib/harvestReconciliation";
import { canAccessModule, isReadOnly, normalizeRole } from "@/lib/permissions";
import {
  normalizeMemoryTenantSlug,
  retrieveRelevantMemories,
  type CopilotMemoryEntry,
} from "./copilotMemoryTypes";
import type { CopilotDialectMode } from "./yemeniLocalization";
import type {
  TabId,
  UasBootstrapState,
  UasSaleTransaction,
  UserRole,
} from "@/types/uas";

export type AlertSeverity = "critical" | "warning";

export interface BriefingInventoryItemInput {
  id: string;
  sku?: string;
  nameAr: string;
  nameEn?: string;
  unitName?: string;
  qtyOnHand: number;
  minStockAlert: number;
}

export interface BriefingSalesInvoiceInput {
  id: string;
  invoiceNumber: string;
  customerName: string;
  customerPhone?: string;
  balanceDue: number;
  currency?: string;
  baseAmount?: number;
  exchangeRate?: number;
  date: string;
  dueDate?: string | null;
  status?: string;
  projectId?: string | null;
  harvest?: string | null;
}

export interface LowStockAlertItem {
  id: string;
  source: "inventory_item" | "harvest_batch";
  itemName: string;
  unit: string;
  currentQty: number;
  thresholdQty: number;
  shortageQty: number;
  severity: AlertSeverity;
  projectId?: string;
  projectName?: string;
  harvest?: string;
  batchId?: string;
  summaryAr: string;
  summaryEn: string;
  followUpPromptAr: string;
  followUpPromptEn: string;
  recommendedTab: TabId;
}

export interface OverdueReceivableAlertItem {
  id: string;
  source: "sales_invoice" | "sale_transaction";
  customerName: string;
  customerPhone?: string;
  invoiceOrVoucher: string;
  overdueAmount: number;
  currency: string;
  amountYer: number;
  daysOverdue: number;
  dueDate: string;
  severity: AlertSeverity;
  projectId?: string;
  harvest?: string;
  summaryAr: string;
  summaryEn: string;
  followUpPromptAr: string;
  followUpPromptEn: string;
  recommendedTab: TabId;
}

export interface ExecutiveBriefingPriority {
  id: string;
  priority: "high" | "medium" | "info";
  titleAr: string;
  titleEn: string;
  detailAr: string;
  detailEn: string;
  followUpPromptAr: string;
  followUpPromptEn: string;
  targetTab: TabId;
}

export interface ExecutiveBriefingReport {
  date: string;
  tenantSlug: string;
  lang: "ar" | "en";
  dialect: CopilotDialectMode;
  role: UserRole;
  generatedAt: string;
  modelUsed: string;
  counts: {
    lowStockCount: number;
    overdueReceivablesCount: number;
    criticalAlertsCount: number;
    totalOverdueAmountYer: number;
    cashBalanceYer: number;
    todayRevenueYer: number;
    todayExpensesYer: number;
    pendingConflictsCount: number;
    offlineQueueCount: number;
  };
  lowStockAlerts: LowStockAlertItem[];
  overdueReceivableAlerts: OverdueReceivableAlertItem[];
  priorities: ExecutiveBriefingPriority[];
  appliedMemories: Array<{ id: string; category: string; content: string }>;
  briefingAr: string;
  briefingEn: string;
  briefing: string;
}

export interface GenerateExecutiveBriefingInput {
  tenantSlug?: string | null;
  date?: string;
  lang?: "ar" | "en";
  dialect?: CopilotDialectMode;
  user?: UserRole | string | { id?: string; role?: UserRole | string } | null;
  userId?: string | null;
  userName?: string | null;
  state?: UasBootstrapState | null;
  inventoryItems?: BriefingInventoryItemInput[];
  salesInvoices?: BriefingSalesInvoiceInput[];
  memories?: CopilotMemoryEntry[];
  offlineQueueCount?: number;
  pendingConflictsCount?: number;
  lowStockThreshold?: number;
  defaultCreditTermDays?: number;
  focus?: "all" | "low_stock" | "overdue_receivables";
}

function parseIsoDayMs(raw: string | null | undefined): number | null {
  const clean = String(raw || "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(clean)) return null;
  const ms = Date.parse(`${clean}T00:00:00Z`);
  return Number.isFinite(ms) ? ms : null;
}

function safeDiffDays(laterIso: string, earlierIso: string): number {
  const a = parseIsoDayMs(laterIso);
  const b = parseIsoDayMs(earlierIso);
  if (a === null || b === null) return 0;
  return Math.floor((a - b) / 86_400_000);
}

function addDaysIso(baseIso: string, days: number): string {
  const ms = parseIsoDayMs(baseIso);
  if (ms === null) return baseIso.slice(0, 10);
  return new Date(ms + days * 86_400_000).toISOString().slice(0, 10);
}

function convertToYer(
  amount: number,
  currency: string,
  rates?: Record<string, number>
): number {
  const c = (currency || "YER").toUpperCase();
  if (c === "YER") return amount;
  const r = Number(rates?.[c] ?? 1);
  return amount * (Number.isFinite(r) && r > 0 ? r : 1);
}

/**
 * Extracts a customer-specific credit term (e.g. "العميل هائل يتعامل بالآجل لمدة 30 يوم")
 * from tenant-scoped Copilot memories when present.
 */
function resolveCreditTermDaysForCustomer(
  customerName: string,
  memories: CopilotMemoryEntry[],
  fallbackDays: number
): number {
  const cleanCust = customerName.trim().toLowerCase();
  if (!cleanCust) return fallbackDays;
  for (const m of memories) {
    if (!m.active) continue;
    const contentLower = m.content.toLowerCase();
    if (!contentLower.includes(cleanCust)) continue;
    const match = m.content.match(/(?:لمدة|اجل|آجل|net|terms?)\s*[:=]?\s*(\d{1,3})\s*(?:يوم|ايام|أيام|days?)/i);
    if (match?.[1]) {
      const days = Number(match[1]);
      if (Number.isFinite(days) && days > 0 && days <= 365) return days;
    }
  }
  return fallbackDays;
}

export function generateExecutiveBriefing(
  input: GenerateExecutiveBriefingInput = {}
): ExecutiveBriefingReport {
  const tenantSlug = normalizeMemoryTenantSlug(
    input.tenantSlug || input.state?.enterpriseProfile?.tenantSlug || "default"
  );
  const refDate =
    (input.date && /^\d{4}-\d{2}-\d{2}/.test(input.date)
      ? input.date.slice(0, 10)
      : new Date().toISOString().slice(0, 10));
  const lang: "ar" | "en" = input.lang === "en" ? "en" : "ar";
  const dialect: CopilotDialectMode = input.dialect === "msa" ? "msa" : "yemeni";
  const role: UserRole = normalizeRole(
    typeof input.user === "object" && input.user ? input.user.role || "EXTERNAL_AUDITOR" : input.user || "SUPER_ADMIN"
  );
  const readOnlyActor = isReadOnly(role);
  const canInspectSales = canAccessModule(role, "sales");
  const canInspectInventory = canAccessModule(role, "inventory");
  const canInspectTreasury = canAccessModule(role, "treasury");

  const state = input.state ?? null;
  const defaultBatchThreshold = Math.max(1, input.lowStockThreshold ?? 10);
  const defaultCreditDays = Math.max(1, input.defaultCreditTermDays ?? 14);
  const exchangeRates = state?.exchangeRates as Record<string, number> | undefined;

  // Strictly isolate memories by tenantSlug
  const isolatedMemories = retrieveRelevantMemories({
    entries: input.memories ?? [],
    tenantSlug,
    userId: input.userId,
    query: `${input.focus || "briefing"} مخزون ذمم عملاء خزينة`,
    limit: 6,
  });

  const lowStockAlerts: LowStockAlertItem[] = [];
  const overdueReceivableAlerts: OverdueReceivableAlertItem[] = [];

  // 1. Multi-Unit Inventory Catalog Alerts (from InventoryItem / StockBalance)
  if (canInspectInventory && Array.isArray(input.inventoryItems)) {
    for (const item of input.inventoryItems) {
      const minAlert = Number(item.minStockAlert) || 0;
      const qty = Number(item.qtyOnHand) || 0;
      if (minAlert <= 0) continue;
      if (qty <= minAlert) {
        const critical = qty <= 0 || qty <= minAlert * 0.35;
        const unit = item.unitName || (lang === "ar" ? "وحدة" : "unit");
        const shortageQty = Math.max(0, minAlert - qty);
        const nameDisplay = lang === "ar" ? item.nameAr : item.nameEn || item.nameAr;
        lowStockAlerts.push({
          id: `item-${item.id}`,
          source: "inventory_item",
          itemName: nameDisplay,
          unit,
          currentQty: qty,
          thresholdQty: minAlert,
          shortageQty,
          severity: critical ? "critical" : "warning",
          summaryAr: `الصنف «${item.nameAr}» منخفض (${qty} ${unit} / حد التنبيه ${minAlert}).`,
          summaryEn: `Item "${item.nameEn || item.nameAr}" low (${qty} ${unit} / min ${minAlert}).`,
          followUpPromptAr: readOnlyActor
            ? `افحص تفاصيل مخزون الصنف ${item.nameAr} وحركاته`
            : `افحص مخزون الصنف ${item.nameAr} واقترح أمر شراء تعويضي`,
          followUpPromptEn: readOnlyActor
            ? `Inspect stock movements and balance for ${item.nameEn || item.nameAr}`
            : `Check stock for ${item.nameEn || item.nameAr} and suggest replenishment`,
          recommendedTab: readOnlyActor ? "inventory" : "procurement",
        });
      }
    }
  }

  // 2. Harvest Batch Reconciliation Stock Alerts
  if (canInspectInventory && state) {
    const batches = state.inventoryBatches ?? [];
    const sales = state.sales ?? [];
    const projectsById = new Map((state.projects ?? []).map((p) => [p.id, p]));
    const recon = reconcileHarvestInventory(batches, sales);

    for (const row of recon.rows) {
      const b = row.batch;
      const proj = projectsById.get(b.projectId);
      const unitLabel = "علاقية";
      const unitEn = "bundles";
      const ratio = row.usableBundles > 0 ? row.remainingBundles / row.usableBundles : 0;
      const isDepletedOrShortage =
        row.status === "SHORTAGE" ||
        row.shortageBundles > 0 ||
        (row.usableBundles > 0 && row.remainingBundles <= 0);
      const isLow =
        !isDepletedOrShortage &&
        row.usableBundles > 0 &&
        (row.remainingBundles <= defaultBatchThreshold || ratio <= 0.2);

      if (isDepletedOrShortage || isLow) {
        const severity: AlertSeverity = isDepletedOrShortage ? "critical" : "warning";
        const effectiveRemaining =
          row.shortageBundles > 0 ? -row.shortageBundles : row.remainingBundles;
        lowStockAlerts.push({
          id: `batch-${b.id}`,
          source: "harvest_batch",
          itemName: `${b.grade} (${b.harvest})`,
          unit: lang === "ar" ? unitLabel : unitEn,
          currentQty: effectiveRemaining,
          thresholdQty: defaultBatchThreshold,
          shortageQty: Math.max(0, defaultBatchThreshold - effectiveRemaining),
          severity,
          projectId: b.projectId,
          projectName: proj?.name,
          harvest: b.harvest,
          batchId: b.id,
          summaryAr:
            row.shortageBundles > 0
              ? `عجز في «${b.grade}» (${b.harvest}): متجاوز بمقدار ${row.shortageBundles} ${unitLabel}.`
              : `انخفاض «${b.grade}» (${b.harvest}): متبقي ${row.remainingBundles} ${unitLabel} من أصل ${row.usableBundles}.`,
          summaryEn:
            row.shortageBundles > 0
              ? `Shortage on "${b.grade}" (${b.harvest}): deficit of ${row.shortageBundles} bundles.`
              : `Low stock on "${b.grade}" (${b.harvest}): ${row.remainingBundles} of ${row.usableBundles} bundles left.`,
          followUpPromptAr: `طابق مخزون القطفة ${b.harvest} لصنف ${b.grade} واعرض التفاصيل`,
          followUpPromptEn: `Reconcile harvest batch ${b.harvest} grade ${b.grade} and show stock details`,
          recommendedTab: "inventory",
        });
      }
    }
  }

  // Sort low-stock alerts: critical first, lowest qty first
  lowStockAlerts.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === "critical" ? -1 : 1;
    return a.currentQty - b.currentQty;
  });

  // 3. Overdue Receivables Alerts — Prisma SalesInvoices first, then State credit sales
  const seenInvoiceRefs = new Set<string>();
  if (canInspectSales && Array.isArray(input.salesInvoices)) {
    for (const inv of input.salesInvoices) {
      const balanceDue = Number(inv.balanceDue) || 0;
      const statusUpper = String(inv.status || "POSTED").toUpperCase();
      if (balanceDue <= 0.01 || statusUpper === "VOIDED" || statusUpper === "PAID") continue;
      seenInvoiceRefs.add(inv.invoiceNumber);

      const creditDays = resolveCreditTermDaysForCustomer(
        inv.customerName,
        isolatedMemories,
        defaultCreditDays
      );
      const computedDue = inv.dueDate
        ? inv.dueDate.slice(0, 10)
        : addDaysIso(inv.date, creditDays);
      const daysOverdue = safeDiffDays(refDate, computedDue);
      if (daysOverdue <= 0) continue;

      const currency = (inv.currency || "YER").toUpperCase();
      const amountYer =
        inv.baseAmount && inv.baseAmount > 0 && currency === "YER"
          ? balanceDue
          : convertToYer(balanceDue, currency, exchangeRates);
      const severity: AlertSeverity = daysOverdue >= 30 || amountYer >= 250_000 ? "critical" : "warning";

      overdueReceivableAlerts.push({
        id: `inv-${inv.id}`,
        source: "sales_invoice",
        customerName: inv.customerName,
        customerPhone: inv.customerPhone,
        invoiceOrVoucher: inv.invoiceNumber,
        overdueAmount: balanceDue,
        currency,
        amountYer,
        daysOverdue,
        dueDate: computedDue,
        severity,
        projectId: inv.projectId ?? undefined,
        harvest: inv.harvest ?? undefined,
        summaryAr: `${inv.customerName} (${inv.invoiceNumber}): متأخر ${daysOverdue} يوم بمبلغ ${balanceDue.toLocaleString()} ${currency}.`,
        summaryEn: `${inv.customerName} (${inv.invoiceNumber}): ${daysOverdue} days overdue (${balanceDue.toLocaleString()} ${currency}).`,
        followUpPromptAr: readOnlyActor
          ? `اعرض رصيد ومديونية العميل ${inv.customerName} وتفاصيل الفاتورة ${inv.invoiceNumber}`
          : `جهّز مسودة سند قبض من العميل ${inv.customerName} بمبلغ ${balanceDue} ${currency} مقابل ${inv.invoiceNumber}`,
        followUpPromptEn: readOnlyActor
          ? `Check balance and invoice ${inv.invoiceNumber} details for customer ${inv.customerName}`
          : `Draft receipt voucher from customer ${inv.customerName} for ${balanceDue} ${currency} against ${inv.invoiceNumber}`,
        recommendedTab: "sales",
      });
    }
  }

  // Fallback / Offline credit sales in state.sales
  if (canInspectSales && state?.sales?.length) {
    for (const s of state.sales as UasSaleTransaction[]) {
      if (s.archivedAt || s.isActive === false) continue;
      if (s.voucherNo && seenInvoiceRefs.has(s.voucherNo)) continue;
      const dueAmount = Number(s.debit ?? Math.max(0, (Number(s.total) || 0) - (Number(s.credit) || 0)));
      if (dueAmount <= 0.01) continue;

      const creditDays = resolveCreditTermDaysForCustomer(
        s.customer,
        isolatedMemories,
        defaultCreditDays
      );
      const dueDate = addDaysIso(s.date, creditDays);
      const daysOverdue = safeDiffDays(refDate, dueDate);
      if (daysOverdue <= 0) continue;

      const severity: AlertSeverity = daysOverdue >= 30 || dueAmount >= 250_000 ? "critical" : "warning";
      overdueReceivableAlerts.push({
        id: `sale-${s.id}`,
        source: "sale_transaction",
        customerName: s.customer,
        customerPhone: s.phone,
        invoiceOrVoucher: s.voucherNo || s.id,
        overdueAmount: dueAmount,
        currency: "YER",
        amountYer: dueAmount,
        daysOverdue,
        dueDate,
        severity,
        projectId: s.projectId,
        harvest: s.harvest,
        summaryAr: `${s.customer} (${s.voucherNo || s.harvest}): مديونية متأخرة ${daysOverdue} يوم بمبلغ ${dueAmount.toLocaleString()} YER.`,
        summaryEn: `${s.customer} (${s.voucherNo || s.harvest}): ${daysOverdue} days overdue (${dueAmount.toLocaleString()} YER).`,
        followUpPromptAr: readOnlyActor
          ? `اعرض كشف حساب العميل ${s.customer}`
          : `جهّز مسودة سند قبض من العميل ${s.customer} بمبلغ ${dueAmount} ريال`,
        followUpPromptEn: readOnlyActor
          ? `Show statement for customer ${s.customer}`
          : `Draft receipt voucher from ${s.customer} for ${dueAmount} YER`,
        recommendedTab: "sales",
      });
    }
  }

  // Sort overdue receivables: highest daysOverdue * amount first
  overdueReceivableAlerts.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === "critical" ? -1 : 1;
    if (b.daysOverdue !== a.daysOverdue) return b.daysOverdue - a.daysOverdue;
    return b.amountYer - a.amountYer;
  });

  // 4. Financial & Sync KPIs for Today
  const cashBalanceYer = canInspectTreasury
    ? (state?.treasuryAccounts ?? []).reduce(
        (sum, t) => sum + (Number(t.balanceYER ?? t.balance) || 0),
        0
      )
    : 0;
  const todayRevenueYer = canInspectSales
    ? (state?.sales ?? [])
        .filter((s) => String(s.date || "").slice(0, 10) === refDate)
        .reduce((sum, s) => sum + (Number(s.total) || 0), 0)
    : 0;
  const todayExpensesYer =
    (state?.expenses ?? [])
      .filter((e) => String(e.date || "").slice(0, 10) === refDate)
      .reduce((sum, e) => sum + (Number(e.total) || 0), 0) +
    (state?.workers ?? [])
      .filter((w) => String(w.date || "").slice(0, 10) === refDate)
      .reduce((sum, w) => sum + (Number(w.total) || 0), 0);

  const totalOverdueAmountYer = overdueReceivableAlerts.reduce(
    (sum, a) => sum + a.amountYer,
    0
  );
  const criticalAlertsCount =
    lowStockAlerts.filter((a) => a.severity === "critical").length +
    overdueReceivableAlerts.filter((a) => a.severity === "critical").length;
  const offlineQueueCount = input.offlineQueueCount ?? 0;
  const pendingConflictsCount = input.pendingConflictsCount ?? 0;

  // 5. Build Actionable Daily Priorities
  const priorities: ExecutiveBriefingPriority[] = [];
  if (overdueReceivableAlerts.length > 0) {
    const topRec = overdueReceivableAlerts[0];
    priorities.push({
      id: "prio-receivables",
      priority: "high",
      titleAr: `تحصيل ذمم متأخرة (${overdueReceivableAlerts.length})`,
      titleEn: `Collect Overdue Receivables (${overdueReceivableAlerts.length})`,
      detailAr: `أقدمها: ${topRec.customerName} (${topRec.daysOverdue} يوم — ${topRec.overdueAmount.toLocaleString()} ${topRec.currency}) بإجمالي ${Math.round(totalOverdueAmountYer).toLocaleString()} ريال يمني.`,
      detailEn: `Top aging: ${topRec.customerName} (${topRec.daysOverdue}d overdue, ${topRec.overdueAmount.toLocaleString()} ${topRec.currency}), total ${Math.round(totalOverdueAmountYer).toLocaleString()} YER.`,
      followUpPromptAr: topRec.followUpPromptAr,
      followUpPromptEn: topRec.followUpPromptEn,
      targetTab: "sales",
    });
  }
  if (lowStockAlerts.length > 0) {
    const topStock = lowStockAlerts[0];
    priorities.push({
      id: "prio-low-stock",
      priority: topStock.severity === "critical" ? "high" : "medium",
      titleAr: `معالجة تنبيهات المخزون والقطفات (${lowStockAlerts.length})`,
      titleEn: `Resolve Stock & Harvest Alerts (${lowStockAlerts.length})`,
      detailAr: topStock.summaryAr,
      detailEn: topStock.summaryEn,
      followUpPromptAr: topStock.followUpPromptAr,
      followUpPromptEn: topStock.followUpPromptEn,
      targetTab: topStock.recommendedTab,
    });
  }
  if (pendingConflictsCount > 0 || offlineQueueCount > 0) {
    priorities.push({
      id: "prio-sync",
      priority: pendingConflictsCount > 0 ? "high" : "medium",
      titleAr: `حالة المزامنة (${offlineQueueCount} بالانتظار • ${pendingConflictsCount} تعارض)`,
      titleEn: `Sync Status (${offlineQueueCount} queued • ${pendingConflictsCount} conflicts)`,
      detailAr: "راجع العمليات المعلقة أو تعارضات المزامنة لضمان تطابق السجل المحلي والسحابي.",
      detailEn: "Review queued offline writes or sync conflicts for ledger consistency.",
      followUpPromptAr: "افحص حالة المزامنة وطابور العمليات وسجل التدقيق",
      followUpPromptEn: "Check sync queue, pending conflicts, and audit trail",
      targetTab: "audit",
    });
  }

  // 6. Compose Humanized Narrative (Yemeni / MSA / English)
  const greetingLineAr =
    dialect === "msa"
      ? `**الموجز التنفيذي اليومي (${refDate}) — دور (${role}):**`
      : `**حياك الله يا غالي — هذا ملخص اليوم (${refDate}) (${role}):**`;

  const arSections: string[] = [greetingLineAr];
  if (canInspectTreasury) {
    arSections.push(
      dialect === "msa"
        ? `💰 **السيولة والنشاط اليومي:** رصيد الخزينة الحالي **${Math.round(cashBalanceYer).toLocaleString()} ريال يمني**، ومبيعات اليوم **${Math.round(todayRevenueYer).toLocaleString()} ريال يمني** مقابل مصروفات وأجور **${Math.round(todayExpensesYer).toLocaleString()} ريال يمني**.`
        : `💰 **الخزينة وحركة اليوم:** المتاح الحين في الصناديق والخزائن **${Math.round(cashBalanceYer).toLocaleString()} ريال يمني**، ومبيعات اليوم **${Math.round(todayRevenueYer).toLocaleString()} YER** والمصروفات والأجور **${Math.round(todayExpensesYer).toLocaleString()} YER**.`
    );
  }

  if (lowStockAlerts.length > 0) {
    arSections.push(
      `📦 **تنبيهات انخفاض المخزون والعلاقي (${lowStockAlerts.length}):**\n` +
        lowStockAlerts
          .slice(0, 4)
          .map((a) => `- ${a.severity === "critical" ? "🚨" : "⚠️"} ${a.summaryAr}`)
          .join("\n")
    );
  } else if (canInspectInventory) {
    arSections.push(
      dialect === "msa"
        ? "✅ **المخزون والقطفات:** لا توجد أصناف أو دفعات تحت حد التنبيه."
        : "✅ **المخزون والقطفات:** أمور المخزون طيبة اليوم وما في أي نقص أو عجز تحت الحد."
    );
  }

  if (overdueReceivableAlerts.length > 0) {
    arSections.push(
      `💳 **المديونية والذمم المتأخرة (${overdueReceivableAlerts.length} — إجمالي ${Math.round(totalOverdueAmountYer).toLocaleString()} ريال يمني):**\n` +
        overdueReceivableAlerts
          .slice(0, 4)
          .map((a) => `- ${a.severity === "critical" ? "🚨" : "⚠️"} ${a.summaryAr}`)
          .join("\n")
    );
  } else if (canInspectSales) {
    arSections.push(
      dialect === "msa"
        ? "✅ **الذمم والتحصيل:** لا توجد فواتير أو مديونيات عملاء متجاوزة لموعد السداد."
        : "✅ **المديونية والسندات:** ما في أي ذمم عملاء متأخرة عن السداد اليوم."
    );
  }

  if (readOnlyActor) {
    arSections.push("🔒 *ملاحظة الصلاحية:* حسابك بوضع القراءة فقط؛ أزرار المتابعة ستعرض التفاصيل والتقارير بدون إنشاء قيود أو سندات.");
  }

  if (isolatedMemories.length > 0) {
    arSections.push(
      `🧠 **قواعد المنشأة المطبّقة:** ${isolatedMemories
        .slice(0, 2)
        .map((m) => m.content)
        .join(" • ")}`
    );
  }

  const enSections: string[] = [
    `**Daily Executive Briefing (${refDate} — ${role}):**`,
  ];
  if (canInspectTreasury) {
    enSections.push(
      `💰 **Treasury & Today's Activity:** Cash on hand is **${Math.round(cashBalanceYer).toLocaleString()} YER**; today's revenue **${Math.round(todayRevenueYer).toLocaleString()} YER** vs expenses/wages **${Math.round(todayExpensesYer).toLocaleString()} YER**.`
    );
  }
  if (lowStockAlerts.length > 0) {
    enSections.push(
      `📦 **Low-Stock & Harvest Alerts (${lowStockAlerts.length}):**\n` +
        lowStockAlerts
          .slice(0, 4)
          .map((a) => `- ${a.severity === "critical" ? "🚨" : "⚠️"} ${a.summaryEn}`)
          .join("\n")
    );
  } else if (canInspectInventory) {
    enSections.push("✅ **Inventory & Harvests:** All batches and catalog items are above reorder thresholds.");
  }
  if (overdueReceivableAlerts.length > 0) {
    enSections.push(
      `💳 **Overdue Customer Receivables (${overdueReceivableAlerts.length} — ${Math.round(totalOverdueAmountYer).toLocaleString()} YER):**\n` +
        overdueReceivableAlerts
          .slice(0, 4)
          .map((a) => `- ${a.severity === "critical" ? "🚨" : "⚠️"} ${a.summaryEn}`)
          .join("\n")
    );
  } else if (canInspectSales) {
    enSections.push("✅ **Receivables:** No customer invoices or credit sales are past due today.");
  }
  if (readOnlyActor) {
    enSections.push("🔒 *RBAC Notice:* Read-only role active; alert follow-ups inspect data without creating draft vouchers.");
  }
  if (isolatedMemories.length > 0) {
    enSections.push(
      `🧠 **Applied Tenant Memory:** ${isolatedMemories
        .slice(0, 2)
        .map((m) => m.content)
        .join(" • ")}`
    );
  }

  const briefingAr = arSections.join("\n\n");
  const briefingEn = enSections.join("\n\n");

  const filteredLowStock =
    input.focus === "overdue_receivables" ? [] : lowStockAlerts;
  const filteredOverdue =
    input.focus === "low_stock" ? [] : overdueReceivableAlerts;

  return {
    date: refDate,
    tenantSlug,
    lang,
    dialect,
    role,
    generatedAt: new Date().toISOString(),
    modelUsed: "Offline Local Engine",
    counts: {
      lowStockCount: lowStockAlerts.length,
      overdueReceivablesCount: overdueReceivableAlerts.length,
      criticalAlertsCount,
      totalOverdueAmountYer,
      cashBalanceYer,
      todayRevenueYer,
      todayExpensesYer,
      pendingConflictsCount,
      offlineQueueCount,
    },
    lowStockAlerts: filteredLowStock,
    overdueReceivableAlerts: filteredOverdue,
    priorities,
    appliedMemories: isolatedMemories.map((m) => ({
      id: m.id,
      category: m.category,
      content: m.content,
    })),
    briefingAr,
    briefingEn,
    briefing: lang === "ar" ? briefingAr : briefingEn,
  };
}

// ---------------------------------------------------------------------------
// Tenant-Isolated Browser / Offline Snapshot Cache
// ---------------------------------------------------------------------------

const BRIEFING_CACHE_PREFIX = "uas_copilot_briefing_v1_";

function briefingCacheKey(tenantSlug: string): string {
  return `${BRIEFING_CACHE_PREFIX}${normalizeMemoryTenantSlug(tenantSlug)}`;
}

export function loadCachedExecutiveBriefing(
  tenantSlug: string,
  expectedDate?: string
): ExecutiveBriefingReport | null {
  if (typeof window === "undefined") return null;
  const normTenant = normalizeMemoryTenantSlug(tenantSlug);
  try {
    const raw = window.localStorage.getItem(briefingCacheKey(normTenant));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ExecutiveBriefingReport;
    if (!parsed || normalizeMemoryTenantSlug(parsed.tenantSlug) !== normTenant) {
      return null;
    }
    if (expectedDate && parsed.date !== expectedDate.slice(0, 10)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveCachedExecutiveBriefing(
  tenantSlug: string,
  report: ExecutiveBriefingReport
): void {
  if (typeof window === "undefined") return;
  const normTenant = normalizeMemoryTenantSlug(tenantSlug);
  if (normalizeMemoryTenantSlug(report.tenantSlug) !== normTenant) return;
  try {
    window.localStorage.setItem(briefingCacheKey(normTenant), JSON.stringify(report));
  } catch {
    // ignore quota errors
  }
}
