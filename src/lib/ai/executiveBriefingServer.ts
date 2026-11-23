/**
 * UAS Enterprise — Server-Side Prisma & Memory Loader for Executive Briefings
 *
 * Strictly server-only (`prisma`, `getBootstrapState`, `retrieveServerCopilotMemories`).
 * Enforces tenant isolation (`getActiveTenantId`) and optional per-day memoization
 * (bypassed when `refresh: true`).
 */
import { prisma } from "@/lib/prisma";
import { getActiveTenantId } from "@/lib/tenant/tenantContext";
import { getBootstrapState } from "@/lib/serverBootstrap";
import { normalizeMemoryTenantSlug } from "./copilotMemoryTypes";
import { retrieveServerCopilotMemories } from "./copilotMemoryStore";
import {
  generateExecutiveBriefing,
  type BriefingInventoryItemInput,
  type BriefingSalesInvoiceInput,
  type ExecutiveBriefingReport,
} from "./executiveBriefingEngine";
import type { CopilotDialectMode } from "./yemeniLocalization";
import type { UserRole } from "@/types/uas";

export interface ServerBriefingInputs {
  tenantSlug: string;
  inventoryItems: BriefingInventoryItemInput[];
  salesInvoices: BriefingSalesInvoiceInput[];
  pendingConflictsCount: number;
}

const DAILY_BRIEFING_CACHE = new Map<string, ExecutiveBriefingReport>();

export async function collectServerBriefingInputs(
  explicitTenantSlug?: string | null
): Promise<ServerBriefingInputs> {
  const tenantSlug = normalizeMemoryTenantSlug(
    explicitTenantSlug || getActiveTenantId()
  );

  const [rawItems, rawInvoices, pendingConflictsCount] = await Promise.all([
    prisma.inventoryItem
      .findMany({
        where: { isActive: true, archivedAt: null },
        include: {
          baseUnit: { select: { nameAr: true, nameEn: true } },
          balances: { select: { qtyOnHandBase: true } },
        },
        take: 150,
      })
      .catch(() => []),
    prisma.salesInvoice
      .findMany({
        where: {
          status: { notIn: ["VOIDED", "PAID"] },
          balanceDue: { gt: 0 },
        },
        include: {
          customer: { select: { nameAr: true, nameEn: true, phone: true } },
        },
        orderBy: [{ dueDate: "asc" }, { date: "asc" }],
        take: 150,
      })
      .catch(() => []),
    prisma.syncConflict
      .count({ where: { status: "CONFLICT_PENDING" } })
      .catch(() => 0),
  ]);

  const inventoryItems: BriefingInventoryItemInput[] = rawItems.map((it) => ({
    id: it.id,
    sku: it.sku,
    nameAr: it.nameAr,
    nameEn: it.nameEn,
    unitName: it.baseUnit?.nameAr || it.baseUnit?.nameEn || "وحدة",
    qtyOnHand: (it.balances ?? []).reduce(
      (sum, b) => sum + (Number(b.qtyOnHandBase) || 0),
      0
    ),
    minStockAlert: Number(it.minStockAlert) || 0,
  }));

  const salesInvoices: BriefingSalesInvoiceInput[] = rawInvoices.map((inv) => ({
    id: inv.id,
    invoiceNumber: inv.invoiceNumber,
    customerName: inv.customer?.nameAr || inv.customer?.nameEn || "عميل",
    customerPhone: inv.customer?.phone || undefined,
    balanceDue: Number(inv.balanceDue) || 0,
    currency: inv.currencyCode || inv.currency || "YER",
    baseAmount: Number(inv.baseAmount) || 0,
    exchangeRate: Number(inv.exchangeRate) || 1,
    date: inv.date.toISOString().slice(0, 10),
    dueDate: inv.dueDate ? inv.dueDate.toISOString().slice(0, 10) : null,
    status: inv.status,
    projectId: inv.projectId,
  }));

  return {
    tenantSlug,
    inventoryItems,
    salesInvoices,
    pendingConflictsCount,
  };
}

export async function buildServerExecutiveBriefing(params: {
  tenantSlug?: string | null;
  userId?: string | null;
  userRole?: UserRole | string | null;
  lang?: "ar" | "en";
  dialect?: CopilotDialectMode;
  date?: string;
  focus?: "all" | "low_stock" | "overdue_receivables";
  lowStockThreshold?: number;
  defaultCreditTermDays?: number;
  refresh?: boolean;
}): Promise<ExecutiveBriefingReport> {
  const tenantSlug = normalizeMemoryTenantSlug(
    params.tenantSlug || getActiveTenantId()
  );
  const lang: "ar" | "en" = params.lang === "en" ? "en" : "ar";
  const dialect: CopilotDialectMode = params.dialect === "msa" ? "msa" : "yemeni";
  const refDate =
    params.date && /^\d{4}-\d{2}-\d{2}/.test(params.date)
      ? params.date.slice(0, 10)
      : new Date().toISOString().slice(0, 10);
  const cacheKey = `${tenantSlug}::${refDate}::${lang}::${dialect}::${params.userRole || "EXTERNAL_AUDITOR"}::${params.focus || "all"}`;

  if (!params.refresh) {
    const cached = DAILY_BRIEFING_CACHE.get(cacheKey);
    if (cached && Date.now() - Date.parse(cached.generatedAt) < 120_000) {
      return cached;
    }
  }

  const [state, serverInputs] = await Promise.all([
    getBootstrapState(),
    collectServerBriefingInputs(tenantSlug),
  ]);

  const memories = retrieveServerCopilotMemories({
    tenantSlug,
    userId: params.userId,
    query: "briefing مخزون ذمم عملاء خزينة",
    limit: 8,
  });

  const report = generateExecutiveBriefing({
    tenantSlug,
    date: refDate,
    lang,
    dialect,
    user: params.userRole,
    userId: params.userId,
    state,
    inventoryItems: serverInputs.inventoryItems,
    salesInvoices: serverInputs.salesInvoices,
    pendingConflictsCount: serverInputs.pendingConflictsCount,
    memories,
    lowStockThreshold: params.lowStockThreshold,
    defaultCreditTermDays: params.defaultCreditTermDays,
    focus: params.focus,
  });

  DAILY_BRIEFING_CACHE.set(cacheKey, report);
  return report;
}
