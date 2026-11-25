import { round4Decimal as round4 } from "@/lib/decimalMath";

export interface CatalogItemLike {
  id: string;
  inventoryItemId?: string | null;
  titleAr: string;
  gradeLabel?: string | null;
  categoryLabel?: string | null;
  sectorType?: string | null;
  categoryGroup?: string | null;
  saleMode?: string | null;
  unitCode?: string | null;
  unitLabel?: string | null;
  customUnitLabel?: string | null;
  unitPrice: number;
  bulkUnitLabel?: string | null;
  partialUnitLabel?: string | null;
  partialUnitPrice?: number | null;
}

export interface IsolatedOrderDraftLine {
  id?: string;
  localKey: string;
  catalogBoardItemId?: string | null;
  itemId?: string | null;
  itemTitle: string;
  requestedQty: number;
  unitCode: string;
  unitLabel: string;
  customUnitLabel?: string | null;
  unitPrice: number;
  saleMode?: string;
  notes?: string | null;
}

export function createDraftLineKey(prefix = "line"): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createBlankOrderLine(): IsolatedOrderDraftLine {
  return {
    localKey: createDraftLineKey("blank"),
    catalogBoardItemId: null,
    itemId: "",
    itemTitle: "",
    requestedQty: 1,
    unitCode: "QAT_BUNCH",
    unitLabel: "علاقية قات",
    customUnitLabel: "",
    unitPrice: 0,
    saleMode: "BULK",
    notes: "",
  };
}

export function isBlankInitialOrderLine(line: IsolatedOrderDraftLine): boolean {
  return (
    !line.catalogBoardItemId &&
    !String(line.itemId || "").trim() &&
    !line.itemTitle.trim() &&
    Number(line.unitPrice || 0) === 0 &&
    !String(line.notes || "").trim()
  );
}

/**
 * Adds a published catalog board item/grade/price selection as a strictly isolated,
 * separate order line item. Never merges quantities with existing lines or overwrites
 * other lines' unit prices or grades.
 */
export function appendCatalogBoardItemLine(
  currentLines: IsolatedOrderDraftLine[],
  item: CatalogItemLike,
  opts?: {
    requestedQty?: number;
    saleMode?: "BULK" | "PARTIAL";
  }
): {
  nextLines: IsolatedOrderDraftLine[];
  addedLine: IsolatedOrderDraftLine;
} {
  const chosenSaleMode =
    opts?.saleMode === "PARTIAL" || (item.saleMode === "PARTIAL" && Number(item.partialUnitPrice || 0) > 0)
      ? "PARTIAL"
      : "BULK";

  const resolvedUnitPrice =
    chosenSaleMode === "PARTIAL" && Number(item.partialUnitPrice || 0) > 0
      ? Math.max(0, Number(item.partialUnitPrice || 0))
      : Math.max(0, Number(item.unitPrice || 0));

  const unitCode = String(item.unitCode || "QAT_BUNCH").trim().toUpperCase() || "QAT_BUNCH";
  const resolvedUnitLabel =
    chosenSaleMode === "PARTIAL" && item.partialUnitLabel
      ? item.partialUnitLabel
      : String(item.unitLabel || "علاقية قات").trim() || "علاقية قات";

  const customUnitLabel =
    unitCode === "OTHER"
      ? item.customUnitLabel || resolvedUnitLabel || ""
      : "";

  const addedLine: IsolatedOrderDraftLine = {
    localKey: createDraftLineKey("cat"),
    catalogBoardItemId: item.id,
    itemId: item.inventoryItemId || null,
    itemTitle: item.titleAr,
    requestedQty: Math.max(1, Number(opts?.requestedQty || 1)),
    unitCode,
    unitLabel: resolvedUnitLabel,
    customUnitLabel,
    unitPrice: resolvedUnitPrice,
    saleMode: chosenSaleMode,
    notes: item.gradeLabel ? `الدرجة: ${item.gradeLabel}` : "",
  };

  if (currentLines.length === 1 && isBlankInitialOrderLine(currentLines[0])) {
    return {
      nextLines: [addedLine],
      addedLine,
    };
  }

  return {
    nextLines: [...currentLines, addedLine],
    addedLine,
  };
}

export function updateIsolatedOrderLine(
  lines: IsolatedOrderDraftLine[],
  index: number,
  patch: Partial<IsolatedOrderDraftLine>
): IsolatedOrderDraftLine[] {
  return lines.map((line, i) => (i === index ? { ...line, ...patch } : line));
}

export function removeIsolatedOrderLine(
  lines: IsolatedOrderDraftLine[],
  index: number
): IsolatedOrderDraftLine[] {
  const remaining = lines.filter((_, i) => i !== index);
  return remaining.length > 0 ? remaining : [createBlankOrderLine()];
}

export function computeIsolatedLineTotal(qty: number, unitPrice: number): number {
  const safeQty = Number.isFinite(Number(qty)) ? Math.max(0, Number(qty)) : 0;
  const safePrice = Number.isFinite(Number(unitPrice)) ? Math.max(0, Number(unitPrice)) : 0;
  return round4(safeQty * safePrice);
}

export interface RequestLifecycleShape {
  status: string;
  reserveStock?: boolean;
  linkedInvoiceId?: string | null;
  linkedSaleId?: string | null;
  linkedReceiptId?: string | null;
  linkedSalesRecordId?: string | null;
  linkedDraftId?: string | null;
  isArchived?: boolean;
  isArchivedByClient?: boolean;
}

export function canClientCancelRequest(req: RequestLifecycleShape): boolean {
  const cancelableStatus = req.status === "PENDING_REVIEW";
  return Boolean(
    cancelableStatus &&
      !req.reserveStock &&
      !req.linkedSalesRecordId &&
      !req.linkedSaleId &&
      !req.linkedInvoiceId &&
      !req.linkedDraftId
  );
}

export function canArchiveOrHideRequest(req: RequestLifecycleShape): boolean {
  return (
    req.status === "COMPLETED" ||
    req.status === "CANCELLED" ||
    req.status === "REJECTED" ||
    Boolean(req.isArchived) ||
    Boolean(req.isArchivedByClient)
  );
}

export function canSafelyDeleteRequest(req: RequestLifecycleShape): {
  allowed: boolean;
  reason?: string;
} {
  if (
    req.linkedSalesRecordId ||
    req.linkedSaleId ||
    req.linkedInvoiceId ||
    req.linkedReceiptId ||
    req.linkedDraftId
  ) {
    return {
      allowed: false,
      reason:
        "لا يمكن حذف طلب مرتبط بفاتورة مبيعات أو سند قبض أو سجل مبيعات مرحّل دون معالجة محاسبية وعكس القيد أولاً",
    };
  }
  if (req.reserveStock) {
    return {
      allowed: false,
      reason: "لا يمكن حذف طلب يحتوي على حجز مخزون نشط قبل تحرير الكمية المحجوزة أو إلغائه",
    };
  }
  if (
    req.status === "CONFIRMED" ||
    req.status === "READY_FOR_PICKUP" ||
    req.status === "COMPLETED"
  ) {
    return {
      allowed: false,
      reason:
        "لا يمكن حذف الطلبات المؤكدة أو الجاهزة للاستلام أو المكتملة للحفاظ على سلامة السجل المحاسبي — استخدم الأرشفة أو الإخفاء بدلاً من ذلك",
    };
  }
  return { allowed: true };
}
