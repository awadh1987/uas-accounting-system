import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { appendAuditLogTx } from "@/lib/serverBootstrap";
import { formatIsoToDmy } from "@/lib/uiFormatters";
import { syncPublishedCatalogStockTx } from "@/lib/clientPortal/catalogStockSync";
import {
  CATALOG_AVAILABILITY_LABELS,
  PORTAL_GRADE_PRESETS,
  computeClientCatalogBoardStats,
  type CatalogAvailabilityStatus,
  type ClientCatalogBoardItemView,
  type ClientCatalogBoardStats,
  type StaffCatalogBoardItemView,
} from "@/lib/clientPortal/portalTypes";

export {
  CATALOG_AVAILABILITY_LABELS,
  PORTAL_GRADE_PRESETS,
  computeClientCatalogBoardStats,
  type CatalogAvailabilityStatus,
  type ClientCatalogBoardItemView,
  type ClientCatalogBoardStats,
  type StaffCatalogBoardItemView,
};

function normalizeAvailability(raw?: string | null): CatalogAvailabilityStatus {
  const s = String(raw || "AVAILABLE").trim().toUpperCase();
  if (s === "LIMITED") return "LIMITED";
  if (s === "UNAVAILABLE" || s === "OUT_OF_STOCK") return "UNAVAILABLE";
  return "AVAILABLE";
}

function resolveDisplayUnitLabel(row: {
  unitCode: string;
  unitLabel: string;
  customUnitLabel?: string | null;
}): string {
  if (row.unitCode === "OTHER" && row.customUnitLabel?.trim()) {
    return row.customUnitLabel.trim();
  }
  return row.unitLabel || "علاقية قات";
}

/**
 * Strips any internal staff/audit/inventory cost metadata so only safe client-facing
 * pricing, grading, freshness, and availability attributes leave the tenant boundary.
 */
export function sanitizeClientCatalogBoardItem(row: {
  id: string;
  inventoryItemId?: string | null;
  harvestBatchId?: string | null;
  projectId?: string | null;
  harvestName?: string | null;
  sku?: string | null;
  titleAr: string;
  titleEn?: string | null;
  gradeLabel: string;
  categoryLabel: string;
  sectorType?: string;
  categoryGroup?: string;
  saleMode?: string;
  producerCompany?: string | null;
  countryOfOrigin?: string | null;
  productionDate?: string | null;
  expiryDate?: string | null;
  taxRate?: Prisma.Decimal | number | string | null;
  unitCode: string;
  unitLabel: string;
  customUnitLabel?: string | null;
  unitPrice: Prisma.Decimal | number | string;
  bulkUnitLabel?: string | null;
  partialUnitLabel?: string | null;
  partialUnitPrice?: Prisma.Decimal | number | string;
  multiplierToBase?: Prisma.Decimal | number | string;
  publishedQty?: Prisma.Decimal | number | string | null;
  remainingQty?: Prisma.Decimal | number | string | null;
  lowStockThreshold?: Prisma.Decimal | number | string;
  currency: string;
  availabilityStatus: string;
  pickupLocation?: string | null;
  freshnessLabel: string;
  effectiveDate?: string | null;
  validityNote?: string | null;
  displayOrder: number;
  publishedAt?: Date | string | null;
  notes?: string | null;
}): ClientCatalogBoardItemView {
  const availabilityStatus = normalizeAvailability(row.availabilityStatus);
  const effectiveDate = row.effectiveDate ? String(row.effectiveDate).slice(0, 10) : null;
  const publishedIso =
    row.publishedAt instanceof Date
      ? row.publishedAt.toISOString()
      : row.publishedAt
        ? String(row.publishedAt)
        : null;

  return {
    id: row.id,
    inventoryItemId: row.inventoryItemId ?? null,
    harvestBatchId: row.harvestBatchId ?? null,
    projectId: row.projectId ?? null,
    harvestName: row.harvestName ?? null,
    sku: row.sku ?? null,
    titleAr: row.titleAr,
    titleEn: row.titleEn ?? null,
    gradeLabel: row.gradeLabel || "درجة أولى",
    categoryLabel: row.categoryLabel || "أصناف عامة",
    sectorType: row.sectorType || "HARVEST",
    categoryGroup: row.categoryGroup || "HARVEST",
    saleMode: row.saleMode || "BOTH",
    producerCompany: row.producerCompany ?? null,
    countryOfOrigin: row.countryOfOrigin ?? null,
    productionDate: row.productionDate ? String(row.productionDate).slice(0, 10) : null,
    expiryDate: row.expiryDate ? String(row.expiryDate).slice(0, 10) : null,
    taxRate: Math.max(0, Number(row.taxRate || 0)),
    unitCode: row.unitCode || "QAT_BUNCH",
    unitLabel: row.unitLabel || "علاقية قات",
    customUnitLabel: row.customUnitLabel ?? null,
    displayUnitLabel: resolveDisplayUnitLabel(row),
    unitPrice: Math.max(0, Number(row.unitPrice || 0)),
    bulkUnitLabel: row.bulkUnitLabel ?? null,
    partialUnitLabel: row.partialUnitLabel ?? null,
    partialUnitPrice: Math.max(0, Number(row.partialUnitPrice || 0)),
    multiplierToBase: Math.max(0.0001, Number(row.multiplierToBase || 1)),
    publishedQty:
      row.publishedQty !== null && row.publishedQty !== undefined
        ? Number(row.publishedQty)
        : null,
    remainingQty:
      row.remainingQty !== null && row.remainingQty !== undefined
        ? Number(row.remainingQty)
        : null,
    lowStockThreshold: Number(row.lowStockThreshold || 5),
    currency: row.currency || "YER",
    availabilityStatus,
    availabilityLabelAr: CATALOG_AVAILABILITY_LABELS[availabilityStatus],
    pickupLocation: row.pickupLocation ?? null,
    freshnessLabel: row.freshnessLabel || "قائمة أسعار اليوم",
    effectiveDate,
    effectiveDateDmy: effectiveDate ? formatIsoToDmy(effectiveDate) : "",
    validityNote: row.validityNote ?? null,
    displayOrder: Number(row.displayOrder || 1),
    publishedAt: publishedIso,
    notes: row.notes ?? null,
  };
}

// Re-exported from portalTypes for client & server parity
export function _ensureCatalogBoardStatsExport() {
  return computeClientCatalogBoardStats;
}

/**
 * Queries ONLY published pricing board items for Client Portal consumption.
 * Zero internal cost, margin, or vendor fields exist or are selected.
 */
export async function listPublishedClientCatalogBoard(): Promise<{
  items: ClientCatalogBoardItemView[];
  stats: ClientCatalogBoardStats;
}> {
  await syncPublishedCatalogStockTx(prisma).catch(() => null);
  const rows = await prisma.portalCatalogBoardItem.findMany({
    where: { isPublished: true },
    select: {
      id: true,
      inventoryItemId: true,
      harvestBatchId: true,
      projectId: true,
      harvestName: true,
      sku: true,
      titleAr: true,
      titleEn: true,
      gradeLabel: true,
      categoryLabel: true,
      sectorType: true,
      categoryGroup: true,
      saleMode: true,
      producerCompany: true,
      countryOfOrigin: true,
      productionDate: true,
      expiryDate: true,
      taxRate: true,
      unitCode: true,
      unitLabel: true,
      customUnitLabel: true,
      unitPrice: true,
      bulkUnitLabel: true,
      partialUnitLabel: true,
      partialUnitPrice: true,
      multiplierToBase: true,
      publishedQty: true,
      remainingQty: true,
      lowStockThreshold: true,
      currency: true,
      availabilityStatus: true,
      pickupLocation: true,
      freshnessLabel: true,
      effectiveDate: true,
      validityNote: true,
      displayOrder: true,
      publishedAt: true,
      notes: true,
    },
    orderBy: [{ displayOrder: "asc" }, { publishedAt: "desc" }, { titleAr: "asc" }],
    take: 300,
  });

  const items = rows.map(sanitizeClientCatalogBoardItem);
  return {
    items,
    stats: computeClientCatalogBoardStats(items),
  };
}

export async function listStaffCatalogBoard(): Promise<{
  items: StaffCatalogBoardItemView[];
  stats: ClientCatalogBoardStats;
  inventorySuggestions: Array<{
    id: string;
    sku: string;
    nameAr: string;
    nameEn: string;
    grade: string | null;
    sellPrice: number;
    baseUnitCode: string;
    baseUnitLabel: string;
    sectorType: "HARVEST" | "COMMERCIAL";
  }>;
}> {
  await syncPublishedCatalogStockTx(prisma).catch(() => null);
  const [rows, invRows] = await Promise.all([
    prisma.portalCatalogBoardItem.findMany({
      orderBy: [{ displayOrder: "asc" }, { updatedAt: "desc" }],
      take: 300,
    }),
    prisma.inventoryItem.findMany({
      where: { isActive: true },
      select: {
        id: true,
        sku: true,
        nameAr: true,
        nameEn: true,
        grade: true,
        sectorType: true,
        wholesalePrice: true,
        retailPrice: true,
        baseUnit: { select: { code: true, nameAr: true } },
      },
      orderBy: { nameAr: "asc" },
      take: 150,
    }),
  ]);

  const items: StaffCatalogBoardItemView[] = rows.map((row) => ({
    ...sanitizeClientCatalogBoardItem(row),
    isPublished: Boolean(row.isPublished),
    publishedByName: row.publishedByName ?? null,
    createdByName: row.createdByName ?? null,
    updatedAt: row.updatedAt.toISOString(),
  }));

  const publishedOnly = items.filter((i) => i.isPublished);
  return {
    items,
    stats: computeClientCatalogBoardStats(publishedOnly),
    inventorySuggestions: invRows.map((it) => ({
      id: it.id,
      sku: it.sku,
      nameAr: it.nameAr,
      nameEn: it.nameEn,
      grade: it.grade,
      sellPrice: Number(it.wholesalePrice || it.retailPrice || 0),
      baseUnitCode: it.baseUnit?.code || "QAT_BUNCH",
      baseUnitLabel: it.baseUnit?.nameAr || "علاقية قات",
      sectorType:
        String(it.sectorType || "").toUpperCase() === "COMMERCIAL"
          ? "COMMERCIAL"
          : "HARVEST",
    })),
  };
}

export async function upsertStaffCatalogBoardItem(params: {
  id?: string;
  inventoryItemId?: string | null;
  harvestBatchId?: string | null;
  projectId?: string | null;
  harvestName?: string | null;
  sku?: string | null;
  titleAr: string;
  titleEn?: string | null;
  gradeLabel?: string;
  categoryLabel?: string;
  sectorType?: string;
  categoryGroup?: string;
  saleMode?: string;
  producerCompany?: string | null;
  countryOfOrigin?: string | null;
  productionDate?: string | null;
  expiryDate?: string | null;
  taxRate?: number;
  unitCode?: string;
  unitLabel?: string;
  customUnitLabel?: string | null;
  unitPrice: number;
  bulkUnitLabel?: string | null;
  partialUnitLabel?: string | null;
  partialUnitPrice?: number;
  multiplierToBase?: number;
  publishedQty?: number | null;
  remainingQty?: number | null;
  lowStockThreshold?: number;
  currency?: string;
  availabilityStatus?: string;
  pickupLocation?: string | null;
  freshnessLabel?: string;
  effectiveDate?: string | null;
  validityNote?: string | null;
  displayOrder?: number;
  isPublished?: boolean;
  notes?: string | null;
  tenantSlug?: string;
  actor: { userId?: string | null; userDisplay: string; userRole: string };
}): Promise<StaffCatalogBoardItemView> {
  const titleAr = String(params.titleAr || "").trim();
  if (titleAr.length < 2) {
    throw new Error("يرجى إدخال اسم الصنف (حرفان على الأقل)");
  }

  const unitPrice = Math.max(0, Number(params.unitPrice) || 0);
  const unitCode = String(params.unitCode || "QAT_BUNCH").trim().toUpperCase() || "QAT_BUNCH";
  const customUnitLabel = params.customUnitLabel?.trim() || null;
  if (unitCode === "OTHER" && !customUnitLabel) {
    throw new Error("يرجى كتابة اسم الوحدة المخصصة عند اختيار (أخرى)");
  }

  const sectorType =
    String(params.sectorType || "HARVEST").trim().toUpperCase() === "COMMERCIAL"
      ? "COMMERCIAL"
      : "HARVEST";
  const categoryGroup = String(
    params.categoryGroup || (sectorType === "COMMERCIAL" ? "GENERAL_COMMERCIAL" : "HARVEST")
  )
    .trim()
    .toUpperCase();
  const saleModeRaw = String(params.saleMode || "BOTH").trim().toUpperCase();
  const saleMode =
    saleModeRaw === "BULK" || saleModeRaw === "PARTIAL" ? saleModeRaw : "BOTH";

  const publishedQty =
    params.publishedQty !== undefined && params.publishedQty !== null
      ? Math.max(0, Number(params.publishedQty) || 0)
      : undefined;
  const remainingQty =
    params.remainingQty !== undefined && params.remainingQty !== null
      ? Math.max(0, Number(params.remainingQty) || 0)
      : publishedQty;

  const availabilityStatus = normalizeAvailability(params.availabilityStatus);
  const effectiveDate = params.effectiveDate?.trim()
    ? params.effectiveDate.trim().slice(0, 10)
    : new Date().toISOString().slice(0, 10);
  const isPublished = Boolean(params.isPublished);
  const now = new Date();

  const payload = {
    inventoryItemId: params.inventoryItemId?.trim() || null,
    harvestBatchId: params.harvestBatchId?.trim() || null,
    projectId: params.projectId?.trim() || null,
    harvestName: params.harvestName?.trim() || null,
    sku: params.sku?.trim() || null,
    titleAr,
    titleEn: params.titleEn?.trim() || null,
    gradeLabel: String(params.gradeLabel || "درجة أولى").trim() || "درجة أولى",
    categoryLabel: String(params.categoryLabel || "أصناف عامة").trim() || "أصناف عامة",
    sectorType,
    categoryGroup,
    saleMode,
    producerCompany: params.producerCompany?.trim() || null,
    countryOfOrigin: params.countryOfOrigin?.trim() || null,
    productionDate: params.productionDate?.trim() ? params.productionDate.trim().slice(0, 10) : null,
    expiryDate: params.expiryDate?.trim() ? params.expiryDate.trim().slice(0, 10) : null,
    taxRate: Math.max(0, Number(params.taxRate) || 0),
    unitCode,
    unitLabel:
      unitCode === "OTHER"
        ? customUnitLabel || "أخرى"
        : String(params.unitLabel || "علاقية قات").trim() || "علاقية قات",
    customUnitLabel: unitCode === "OTHER" ? customUnitLabel : null,
    unitPrice,
    bulkUnitLabel: params.bulkUnitLabel?.trim() || null,
    partialUnitLabel: params.partialUnitLabel?.trim() || null,
    partialUnitPrice: Math.max(0, Number(params.partialUnitPrice) || 0),
    multiplierToBase: Math.max(0.0001, Number(params.multiplierToBase) || 1),
    ...(publishedQty !== undefined ? { publishedQty } : {}),
    ...(remainingQty !== undefined ? { remainingQty } : {}),
    ...(params.lowStockThreshold !== undefined
      ? { lowStockThreshold: Math.max(0, Number(params.lowStockThreshold) || 5) }
      : {}),
    currency: String(params.currency || "YER").trim().toUpperCase() || "YER",
    availabilityStatus,
    pickupLocation: params.pickupLocation?.trim() || null,
    freshnessLabel: String(params.freshnessLabel || "قائمة أسعار اليوم").trim() || "قائمة أسعار اليوم",
    effectiveDate,
    validityNote: params.validityNote?.trim() || null,
    displayOrder: Math.max(1, Math.round(Number(params.displayOrder) || 1)),
    isPublished,
    notes: params.notes?.trim() || null,
  };

  const saved = await prisma.$transaction(async (tx) => {
    const existing = params.id
      ? await tx.portalCatalogBoardItem.findUnique({ where: { id: params.id } })
      : null;

    const record = existing
      ? await tx.portalCatalogBoardItem.update({
        where: { id: existing.id },
        data: {
          ...payload,
          ...(isPublished && !existing.isPublished
            ? {
              publishedAt: now,
              publishedById: params.actor.userId ?? null,
              publishedByName: params.actor.userDisplay,
            }
            : !isPublished
              ? { publishedAt: null }
              : {}),
        },
      })
      : await tx.portalCatalogBoardItem.create({
        data: {
          ...payload,
          publishedAt: isPublished ? now : null,
          publishedById: isPublished ? (params.actor.userId ?? null) : null,
          publishedByName: isPublished ? params.actor.userDisplay : null,
          createdById: params.actor.userId ?? null,
          createdByName: params.actor.userDisplay,
        },
      });

    await appendAuditLogTx(tx, {
      userId: params.actor.userId,
      userDisplay: params.actor.userDisplay,
      userRole: params.actor.userRole,
      actionType: isPublished ? "PORTAL_CATALOG_PUBLISHED" : "PORTAL_CATALOG_DRAFT_SAVED",
      entityReference: record.id,
      details: `[tenant:${params.tenantSlug || "default"}] ${existing ? "تحديث" : "إنشاء"
        } بطاقة صنف في لوحة البوابة: ${record.titleAr} (${record.gradeLabel}) بسعر ${unitPrice} ${record.currency} — ${isPublished ? "منشور للعملاء" : "مسودة داخلية"
        }`,
    });

    return record;
  });

  return {
    ...sanitizeClientCatalogBoardItem(saved),
    isPublished: Boolean(saved.isPublished),
    publishedByName: saved.publishedByName ?? null,
    createdByName: saved.createdByName ?? null,
    updatedAt: saved.updatedAt.toISOString(),
  };
}

export async function setCatalogBoardPublishState(params: {
  ids: string[];
  publish: boolean;
  freshnessLabel?: string;
  effectiveDate?: string;
  validityNote?: string;
  tenantSlug?: string;
  actor: { userId?: string | null; userDisplay: string; userRole: string };
}): Promise<{ count: number }> {
  const cleanIds = params.ids.map((x) => x.trim()).filter(Boolean);
  const now = new Date();
  const where = cleanIds.length > 0 ? { id: { in: cleanIds } } : {};

  const res = await prisma.$transaction(async (tx) => {
    const updated = await tx.portalCatalogBoardItem.updateMany({
      where,
      data: {
        isPublished: params.publish,
        publishedAt: params.publish ? now : null,
        ...(params.publish
          ? {
            publishedById: params.actor.userId ?? null,
            publishedByName: params.actor.userDisplay,
          }
          : {}),
        ...(params.freshnessLabel?.trim()
          ? { freshnessLabel: params.freshnessLabel.trim() }
          : {}),
        ...(params.effectiveDate?.trim()
          ? { effectiveDate: params.effectiveDate.trim().slice(0, 10) }
          : {}),
        ...(params.validityNote !== undefined
          ? { validityNote: params.validityNote.trim() || null }
          : {}),
      },
    });

    await appendAuditLogTx(tx, {
      userId: params.actor.userId,
      userDisplay: params.actor.userDisplay,
      userRole: params.actor.userRole,
      actionType: params.publish ? "PORTAL_CATALOG_BATCH_PUBLISH" : "PORTAL_CATALOG_BATCH_UNPUBLISH",
      entityReference: cleanIds.join(",") || "ALL",
      details: `[tenant:${params.tenantSlug || "default"}] ${params.publish ? "نشر للعملاء" : "إيقاف نشر"
        } عدد ${updated.count} صنفاً (${params.freshnessLabel || "قائمة أسعار اليوم"})`,
    });

    return updated;
  });

  return { count: res.count };
}

export async function seedCatalogBoardFromInventory(params: {
  tenantSlug?: string;
  freshnessLabel?: string;
  effectiveDate?: string;
  actor: { userId?: string | null; userDisplay: string; userRole: string };
}): Promise<{ createdCount: number }> {
  const invItems = await prisma.inventoryItem.findMany({
    where: { isActive: true },
    select: {
      id: true,
      sku: true,
      nameAr: true,
      nameEn: true,
      grade: true,
      wholesalePrice: true,
      retailPrice: true,
      baseUnit: { select: { code: true, nameAr: true } },
    },
    orderBy: { nameAr: "asc" },
    take: 80,
  });

  if (invItems.length === 0) return { createdCount: 0 };

  const existing = await prisma.portalCatalogBoardItem.findMany({
    select: { inventoryItemId: true, titleAr: true },
  });
  const existingInvIds = new Set(existing.map((e) => e.inventoryItemId).filter(Boolean));
  const existingTitles = new Set(existing.map((e) => e.titleAr.trim()));

  let createdCount = 0;
  const effDate = params.effectiveDate?.trim()
    ? params.effectiveDate.trim().slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  await prisma.$transaction(async (tx) => {
    for (let i = 0; i < invItems.length; i++) {
      const it = invItems[i];
      if (existingInvIds.has(it.id) || existingTitles.has(it.nameAr.trim())) continue;
      await tx.portalCatalogBoardItem.create({
        data: {
          inventoryItemId: it.id,
          sku: it.sku,
          titleAr: it.nameAr,
          titleEn: it.nameEn,
          gradeLabel: it.grade || "درجة أولى",
          categoryLabel: "مستوردة من دليل المخزون",
          unitCode: (it.baseUnit?.code || "QAT_BUNCH").toUpperCase(),
          unitLabel: it.baseUnit?.nameAr || "علاقية قات",
          unitPrice: Math.max(0, Number(it.wholesalePrice || it.retailPrice || 0)),
          currency: "YER",
          availabilityStatus: "AVAILABLE",
          freshnessLabel: params.freshnessLabel?.trim() || "قائمة أسعار اليوم",
          effectiveDate: effDate,
          displayOrder: existing.length + createdCount + 1,
          isPublished: false,
          createdById: params.actor.userId ?? null,
          createdByName: params.actor.userDisplay,
        },
      });
      createdCount += 1;
    }

    if (createdCount > 0) {
      await appendAuditLogTx(tx, {
        userId: params.actor.userId,
        userDisplay: params.actor.userDisplay,
        userRole: params.actor.userRole,
        actionType: "PORTAL_CATALOG_SEEDED",
        entityReference: `COUNT:${createdCount}`,
        details: `[tenant:${params.tenantSlug || "default"}] استيراد ${createdCount} صنفاً كمسودات فرز وتسعير في لوحة البوابة`,
      });
    }
  });

  return { createdCount };
}

export async function deleteStaffCatalogBoardItem(params: {
  id: string;
  tenantSlug?: string;
  actor: { userId?: string | null; userDisplay: string; userRole: string };
}): Promise<void> {
  const existing = await prisma.portalCatalogBoardItem.findUnique({ where: { id: params.id } });
  if (!existing) throw new Error("بطاقة الصنف غير موجودة");

  await prisma.$transaction(async (tx) => {
    await tx.portalCatalogBoardItem.delete({ where: { id: existing.id } });
    await appendAuditLogTx(tx, {
      userId: params.actor.userId,
      userDisplay: params.actor.userDisplay,
      userRole: params.actor.userRole,
      actionType: "PORTAL_CATALOG_DELETED",
      entityReference: existing.id,
      details: `[tenant:${params.tenantSlug || "default"}] حذف بطاقة الصنف (${existing.titleAr}) من لوحة البوابة`,
    });
  });
}
