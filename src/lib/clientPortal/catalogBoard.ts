import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { appendAuditLogTx } from "@/lib/serverBootstrap";
import { formatIsoToDmy } from "@/lib/uiFormatters";
import {
  CATALOG_AVAILABILITY_LABELS,
  PORTAL_GRADE_PRESETS,
  type CatalogAvailabilityStatus,
  type ClientCatalogBoardItemView,
  type ClientCatalogBoardStats,
  type StaffCatalogBoardItemView,
} from "@/lib/clientPortal/portalTypes";

export {
  CATALOG_AVAILABILITY_LABELS,
  PORTAL_GRADE_PRESETS,
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
  sku?: string | null;
  titleAr: string;
  titleEn?: string | null;
  gradeLabel: string;
  categoryLabel: string;
  unitCode: string;
  unitLabel: string;
  customUnitLabel?: string | null;
  unitPrice: Prisma.Decimal | number | string;
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
    sku: row.sku ?? null,
    titleAr: row.titleAr,
    titleEn: row.titleEn ?? null,
    gradeLabel: row.gradeLabel || "درجة أولى",
    categoryLabel: row.categoryLabel || "أصناف عامة",
    unitCode: row.unitCode || "QAT_BUNCH",
    unitLabel: row.unitLabel || "علاقية قات",
    customUnitLabel: row.customUnitLabel ?? null,
    displayUnitLabel: resolveDisplayUnitLabel(row),
    unitPrice: Math.max(0, Number(row.unitPrice || 0)),
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

export function computeClientCatalogBoardStats(
  items: ClientCatalogBoardItemView[]
): ClientCatalogBoardStats {
  const gradeSet = new Set<string>();
  const categorySet = new Set<string>();
  const unitMap = new Map<string, string>();
  let availableCount = 0;
  let limitedCount = 0;
  let unavailableCount = 0;

  let latestFreshnessLabel = "قائمة أسعار اليوم";
  let latestEffectiveDate: string | null = null;
  let latestValidityNote: string | null = null;

  for (const it of items) {
    if (it.gradeLabel) gradeSet.add(it.gradeLabel);
    if (it.categoryLabel) categorySet.add(it.categoryLabel);
    if (!unitMap.has(it.unitCode)) {
      unitMap.set(it.unitCode, it.displayUnitLabel);
    }
    if (it.availabilityStatus === "AVAILABLE") availableCount += 1;
    else if (it.availabilityStatus === "LIMITED") limitedCount += 1;
    else unavailableCount += 1;

    if (it.effectiveDate && (!latestEffectiveDate || it.effectiveDate >= latestEffectiveDate)) {
      latestEffectiveDate = it.effectiveDate;
      latestFreshnessLabel = it.freshnessLabel || latestFreshnessLabel;
      latestValidityNote = it.validityNote ?? latestValidityNote;
    } else if (!latestEffectiveDate && it.freshnessLabel) {
      latestFreshnessLabel = it.freshnessLabel;
      latestValidityNote = it.validityNote ?? latestValidityNote;
    }
  }

  return {
    totalPublished: items.length,
    availableCount,
    limitedCount,
    unavailableCount,
    gradesCount: gradeSet.size,
    categoriesCount: categorySet.size,
    grades: Array.from(gradeSet),
    categories: Array.from(categorySet),
    units: Array.from(unitMap.entries()).map(([unitCode, displayUnitLabel]) => ({
      unitCode,
      displayUnitLabel,
    })),
    latestFreshnessLabel,
    latestEffectiveDate,
    latestEffectiveDateDmy: latestEffectiveDate ? formatIsoToDmy(latestEffectiveDate) : "",
    latestValidityNote,
  };
}

/**
 * Queries ONLY published pricing board items for Client Portal consumption.
 * Zero internal cost, margin, or vendor fields exist or are selected.
 */
export async function listPublishedClientCatalogBoard(): Promise<{
  items: ClientCatalogBoardItemView[];
  stats: ClientCatalogBoardStats;
}> {
  const rows = await prisma.portalCatalogBoardItem.findMany({
    where: { isPublished: true },
    select: {
      id: true,
      inventoryItemId: true,
      sku: true,
      titleAr: true,
      titleEn: true,
      gradeLabel: true,
      categoryLabel: true,
      unitCode: true,
      unitLabel: true,
      customUnitLabel: true,
      unitPrice: true,
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
  }>;
}> {
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
    })),
  };
}

export async function upsertStaffCatalogBoardItem(params: {
  id?: string;
  inventoryItemId?: string | null;
  sku?: string | null;
  titleAr: string;
  titleEn?: string | null;
  gradeLabel?: string;
  categoryLabel?: string;
  unitCode?: string;
  unitLabel?: string;
  customUnitLabel?: string | null;
  unitPrice: number;
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

  const availabilityStatus = normalizeAvailability(params.availabilityStatus);
  const effectiveDate = params.effectiveDate?.trim()
    ? params.effectiveDate.trim().slice(0, 10)
    : new Date().toISOString().slice(0, 10);
  const isPublished = Boolean(params.isPublished);
  const now = new Date();

  const payload = {
    inventoryItemId: params.inventoryItemId?.trim() || null,
    sku: params.sku?.trim() || null,
    titleAr,
    titleEn: params.titleEn?.trim() || null,
    gradeLabel: String(params.gradeLabel || "درجة أولى").trim() || "درجة أولى",
    categoryLabel: String(params.categoryLabel || "أصناف عامة").trim() || "أصناف عامة",
    unitCode,
    unitLabel:
      unitCode === "OTHER"
        ? customUnitLabel || "أخرى"
        : String(params.unitLabel || "علاقية قات").trim() || "علاقية قات",
    customUnitLabel: unitCode === "OTHER" ? customUnitLabel : null,
    unitPrice,
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
      details: `[tenant:${params.tenantSlug || "default"}] ${
        existing ? "تحديث" : "إنشاء"
      } بطاقة صنف في لوحة البوابة: ${record.titleAr} (${record.gradeLabel}) بسعر ${unitPrice} ${record.currency} — ${
        isPublished ? "منشور للعملاء" : "مسودة داخلية"
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
      details: `[tenant:${params.tenantSlug || "default"}] ${
        params.publish ? "نشر للعملاء" : "إيقاف نشر"
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
