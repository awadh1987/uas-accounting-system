import * as XLSX from "xlsx";
import { computeSaleTotals } from "@/lib/formulas";
import type { ClientCatalogBoardItemView } from "@/lib/clientPortal/portalTypes";
import type { TenantFormConfig } from "@/lib/clientPortal/portalConfig";

export interface CatalogItemMatchSource {
  id: string;
  sku?: string | null;
  nameAr: string;
  nameEn?: string | null;
  unitPrice: number;
  unitPrices?: Record<string, number>;
}

export interface ParsedBulkRequestRow {
  rowIndex: number;
  rawLine: string;
  itemId: string;
  itemTitle: string;
  requestedQty: number;
  unitCode: string;
  unitLabel: string;
  customUnitLabel: string;
  displayUnitLabel: string;
  unitPrice: number;
  lineTotal: number;
  notes: string;
  matchedFromCatalog: boolean;
  needsPriceConfirmation: boolean;
  needsCustomUnitConfirmation: boolean;
  rowError: string | null;
}

export interface BulkParseResult {
  rows: ParsedBulkRequestRow[];
  validRowsCount: number;
  warningRowsCount: number;
  errorRowsCount: number;
  estimatedOrderTotal: number;
}

export interface QuickRepeatBasketItem {
  key: string;
  itemId: string | null;
  itemTitle: string;
  unitCode: string;
  unitLabel: string;
  customUnitLabel: string | null;
  displayUnitLabel: string;
  lastQty: number;
  unitPrice: number;
  lineTotal: number;
  orderCount: number;
  lastOrderedAt: string;
  needsPriceConfirmation: boolean;
}

function normalizeLookupText(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/\s+/g, " ");
}

function parseArabicOrEnglishNumber(raw: unknown): number {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : NaN;
  const s = String(raw ?? "")
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[,،\s]+/g, "")
    .replace(/[^\d.-]/g, "")
    .trim();
  if (!s) return NaN;
  const num = Number(s);
  return Number.isFinite(num) ? num : NaN;
}

function splitCsvLine(line: string, delimiter: string): string[] {
  if (delimiter !== ",") {
    return line.split(delimiter).map((part) => part.trim().replace(/^"|"$/g, ""));
  }
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

function detectDelimiter(line: string): string | null {
  if (line.includes("\t")) return "\t";
  if (line.includes("|")) return "|";
  if (line.includes(";")) return ";";
  if (line.includes(",")) return ",";
  if (line.includes("،")) return "،";
  return null;
}

function resolveUnitSelection(
  rawUnit: string,
  formConfig?: TenantFormConfig | null
): {
  unitCode: string;
  unitLabel: string;
  customUnitLabel: string;
  displayUnitLabel: string;
  needsCustomUnitConfirmation: boolean;
} {
  const unitText = rawUnit.trim();
  const unitOptions = formConfig?.unitOptions || [
    { code: "QAT_BUNCH", labelAr: "علاقية قات", labelEn: "Qat Bunch" },
    { code: "PIECE", labelAr: "حبة", labelEn: "Piece" },
    { code: "BAG", labelAr: "كيس", labelEn: "Bag" },
    { code: "CARTON", labelAr: "كرتون", labelEn: "Carton" },
    { code: "KG", labelAr: "كجم", labelEn: "Kg" },
    { code: "OTHER", labelAr: "أخرى", labelEn: "Other" },
  ];

  if (!unitText) {
    const fallback = unitOptions[0] || { code: "QAT_BUNCH", labelAr: "علاقية قات" };
    return {
      unitCode: fallback.code,
      unitLabel: fallback.labelAr,
      customUnitLabel: "",
      displayUnitLabel: fallback.labelAr,
      needsCustomUnitConfirmation: false,
    };
  }

  const norm = normalizeLookupText(unitText);
  if (norm === "اخري" || norm === "اخرى" || norm === "other") {
    return {
      unitCode: "OTHER",
      unitLabel: "أخرى",
      customUnitLabel: "",
      displayUnitLabel: "أخرى",
      needsCustomUnitConfirmation: true,
    };
  }

  const matched = unitOptions.find((u) => {
    const codeNorm = u.code.toLowerCase();
    const arNorm = normalizeLookupText(u.labelAr);
    const enNorm = normalizeLookupText(u.labelEn || "");
    if (norm === codeNorm || norm === arNorm || (enNorm && norm === enNorm)) return true;
    if (
      u.code === "QAT_BUNCH" &&
      (norm.includes("علاقيه") || norm === "ربطه" || norm === "حزمه" || norm === "bunch")
    ) {
      return true;
    }
    return false;
  });

  if (matched) {
    return {
      unitCode: matched.code,
      unitLabel: matched.labelAr,
      customUnitLabel: "",
      displayUnitLabel: matched.labelAr,
      needsCustomUnitConfirmation: false,
    };
  }

  // Treat unrecognized unit text as explicit custom unit ("OTHER") pre-filled cleanly
  return {
    unitCode: "OTHER",
    unitLabel: "أخرى",
    customUnitLabel: unitText,
    displayUnitLabel: unitText,
    needsCustomUnitConfirmation: false,
  };
}

function matchCatalogSource(
  titleOrSku: string,
  unitCode: string,
  options?: {
    boardItems?: ClientCatalogBoardItemView[];
    catalogItems?: CatalogItemMatchSource[];
    formConfig?: TenantFormConfig | null;
  }
): {
  itemId: string;
  itemTitle: string;
  unitPrice: number;
  matchedFromCatalog: boolean;
} {
  const normInput = normalizeLookupText(titleOrSku);
  const board = options?.boardItems || [];
  const catalog = options?.catalogItems || [];

  const boardHit = board.find(
    (b) =>
      normalizeLookupText(b.titleAr) === normInput ||
      (b.titleEn && normalizeLookupText(b.titleEn) === normInput) ||
      (b.sku && b.sku.trim().toLowerCase() === titleOrSku.trim().toLowerCase()) ||
      (normInput.length >= 3 && normalizeLookupText(b.titleAr).includes(normInput))
  );
  if (boardHit) {
    return {
      itemId: boardHit.inventoryItemId || boardHit.id,
      itemTitle: boardHit.titleAr,
      unitPrice: Number(boardHit.unitPrice || 0),
      matchedFromCatalog: true,
    };
  }

  const catHit = catalog.find(
    (c) =>
      normalizeLookupText(c.nameAr) === normInput ||
      (c.nameEn && normalizeLookupText(c.nameEn) === normInput) ||
      (c.sku && c.sku.trim().toLowerCase() === titleOrSku.trim().toLowerCase()) ||
      (normInput.length >= 3 && normalizeLookupText(c.nameAr).includes(normInput))
  );
  if (catHit) {
    const byUnit = catHit.unitPrices?.[unitCode.toUpperCase()];
    const resolvedPrice = byUnit && byUnit > 0 ? byUnit : Number(catHit.unitPrice || 0);
    return {
      itemId: catHit.id,
      itemTitle: catHit.nameAr,
      unitPrice: resolvedPrice,
      matchedFromCatalog: true,
    };
  }

  const unitDefault = options?.formConfig?.unitOptions.find(
    (u) => u.code.toUpperCase() === unitCode.toUpperCase()
  )?.defaultUnitPrice;

  return {
    itemId: "",
    itemTitle: titleOrSku.trim(),
    unitPrice: Number(unitDefault || 0),
    matchedFromCatalog: false,
  };
}

interface HeaderIndices {
  itemIdx: number;
  qtyIdx: number;
  unitIdx: number;
  priceIdx: number;
  notesIdx: number;
}

function detectHeaderRow(cells: string[]): HeaderIndices | null {
  const norms = cells.map((c) => normalizeLookupText(c));
  const findIdx = (patterns: string[]) =>
    norms.findIndex((cell) => patterns.some((p) => cell === p || cell.includes(p)));

  const itemIdx = findIdx(["الصنف", "اسم الصنف", "المنتج", "item", "product", "description"]);
  const qtyIdx = findIdx(["الكميه", "كميه", "qty", "quantity"]);
  if (itemIdx === -1 && qtyIdx === -1) return null;

  return {
    itemIdx: itemIdx >= 0 ? itemIdx : 0,
    qtyIdx: qtyIdx >= 0 ? qtyIdx : 1,
    unitIdx: findIdx(["الوحده", "وحده", "unit"]),
    priceIdx: findIdx(["سعر الوحده", "السعر", "price", "unit price"]),
    notesIdx: findIdx(["ملاحظات", "ملاحظه", "notes", "note"]),
  };
}

/**
 * Shared parser normalizing multi-row matrices (from pasted text or CSV/XLSX worksheets)
 * into validated request lines with live P x Q calculation and custom unit support.
 */
export function parseBulkOrderMatrix(
  matrix: string[][],
  options?: {
    boardItems?: ClientCatalogBoardItemView[];
    catalogItems?: CatalogItemMatchSource[];
    formConfig?: TenantFormConfig | null;
  }
): BulkParseResult {
  const nonEmpty = matrix.filter((row) => row.some((c) => String(c || "").trim() !== ""));
  if (nonEmpty.length === 0) {
    return {
      rows: [],
      validRowsCount: 0,
      warningRowsCount: 0,
      errorRowsCount: 0,
      estimatedOrderTotal: 0,
    };
  }

  const headerMap = detectHeaderRow(nonEmpty[0]);
  const dataRows = headerMap ? nonEmpty.slice(1) : nonEmpty;

  const parsedRows: ParsedBulkRequestRow[] = dataRows.map((cells, idx) => {
    const rawLine = cells.join(" | ");
    let rawItem = "";
    let rawQty = "";
    let rawUnit = "";
    let rawPrice = "";
    let rawNotes = "";

    if (headerMap) {
      rawItem = String(cells[headerMap.itemIdx] ?? "").trim();
      rawQty = String(cells[headerMap.qtyIdx] ?? "").trim();
      rawUnit = headerMap.unitIdx >= 0 ? String(cells[headerMap.unitIdx] ?? "").trim() : "";
      rawPrice = headerMap.priceIdx >= 0 ? String(cells[headerMap.priceIdx] ?? "").trim() : "";
      rawNotes = headerMap.notesIdx >= 0 ? String(cells[headerMap.notesIdx] ?? "").trim() : "";
    } else if (cells.length === 1) {
      // Single string like "قات صوطي x 5" or "قات صوطي 5"
      const compactMatch = /^(.+?)(?:\s+[xX×*]\s+|\s+)([0-9٠-٩]+(?:[.,][0-9٠-٩]+)?)$/.exec(
        cells[0].trim()
      );
      if (compactMatch) {
        rawItem = compactMatch[1].trim();
        rawQty = compactMatch[2].trim();
      } else {
        rawItem = cells[0].trim();
        rawQty = "1";
      }
    } else {
      rawItem = String(cells[0] ?? "").trim();
      rawQty = String(cells[1] ?? "1").trim() || "1";
      rawUnit = String(cells[2] ?? "").trim();
      rawPrice = String(cells[3] ?? "").trim();
      rawNotes = String(cells[4] ?? "").trim();
    }

    const parsedQty = parseArabicOrEnglishNumber(rawQty);
    const requestedQty = Number.isFinite(parsedQty) && parsedQty > 0 ? parsedQty : 0;
    const unitResolved = resolveUnitSelection(rawUnit, options?.formConfig);
    const catalogMatch = matchCatalogSource(rawItem, unitResolved.unitCode, options);

    const parsedPrice = rawPrice ? parseArabicOrEnglishNumber(rawPrice) : NaN;
    const unitPrice =
      Number.isFinite(parsedPrice) && parsedPrice > 0
        ? parsedPrice
        : catalogMatch.unitPrice > 0
        ? catalogMatch.unitPrice
        : 0;

    const { totalAmount: lineTotal } = computeSaleTotals(requestedQty, unitPrice, 0);

    let rowError: string | null = null;
    if (!catalogMatch.itemTitle || catalogMatch.itemTitle.length < 2) {
      rowError = "اسم الصنف مفقود أو قصير";
    } else if (!(requestedQty > 0)) {
      rowError = "الكمية يجب أن تكون أكبر من صفر";
    }

    const needsPriceConfirmation = unitPrice <= 0;
    const needsCustomUnitConfirmation = unitResolved.needsCustomUnitConfirmation;

    return {
      rowIndex: idx + 1,
      rawLine,
      itemId: catalogMatch.itemId,
      itemTitle: catalogMatch.itemTitle,
      requestedQty,
      unitCode: unitResolved.unitCode,
      unitLabel: unitResolved.unitLabel,
      customUnitLabel: unitResolved.customUnitLabel,
      displayUnitLabel: unitResolved.displayUnitLabel,
      unitPrice,
      lineTotal,
      notes: rawNotes,
      matchedFromCatalog: catalogMatch.matchedFromCatalog,
      needsPriceConfirmation,
      needsCustomUnitConfirmation,
      rowError,
    };
  });

  const validRowsCount = parsedRows.filter((r) => !r.rowError).length;
  const warningRowsCount = parsedRows.filter(
    (r) => !r.rowError && (r.needsPriceConfirmation || r.needsCustomUnitConfirmation)
  ).length;
  const errorRowsCount = parsedRows.filter((r) => Boolean(r.rowError)).length;
  const estimatedOrderTotal = parsedRows
    .filter((r) => !r.rowError)
    .reduce((sum, r) => sum + r.lineTotal, 0);

  return {
    rows: parsedRows,
    validRowsCount,
    warningRowsCount,
    errorRowsCount,
    estimatedOrderTotal,
  };
}

export function parseBulkOrderText(
  rawText: string,
  options?: {
    boardItems?: ClientCatalogBoardItemView[];
    catalogItems?: CatalogItemMatchSource[];
    formConfig?: TenantFormConfig | null;
  }
): BulkParseResult {
  const lines = String(rawText || "")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => Boolean(l) && !/^[-_=]{3,}$/.test(l));

  const matrix = lines.map((line) => {
    const delim = detectDelimiter(line);
    if (!delim) return [line];
    return splitCsvLine(line, delim);
  });

  return parseBulkOrderMatrix(matrix, options);
}

export function parseBulkOrderFileBuffer(
  data: ArrayBuffer | Uint8Array,
  fileName: string,
  options?: {
    boardItems?: ClientCatalogBoardItemView[];
    catalogItems?: CatalogItemMatchSource[];
    formConfig?: TenantFormConfig | null;
  }
): BulkParseResult {
  const lower = String(fileName || "").toLowerCase();
  if (lower.endsWith(".csv") || lower.endsWith(".tsv") || lower.endsWith(".txt")) {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    const decoded = new TextDecoder("utf-8").decode(bytes);
    return parseBulkOrderText(decoded, options);
  }

  const wb = XLSX.read(data, { type: data instanceof Uint8Array ? "array" : "buffer" });
  const firstSheetName = wb.SheetNames[0];
  if (!firstSheetName) {
    return parseBulkOrderMatrix([], options);
  }
  const sheet = wb.Sheets[firstSheetName];
  const rawMatrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
    raw: false,
  });
  const stringMatrix = rawMatrix.map((row) =>
    Array.isArray(row) ? row.map((cell) => String(cell ?? "").trim()) : []
  );
  return parseBulkOrderMatrix(stringMatrix, options);
}

export function generateBulkImportSampleText(): string {
  return [
    "الصنف, الكمية, الوحدة, سعر الوحدة, ملاحظات",
    "قات صوطي درجة أولى, 5, علاقية قات, 4500, تغليف صباحي",
    "قات نهمي نخب ممتاز, 3, كيس, 12000, فرز خاص",
    "قطفة مسائية خاصة, 4, ربطة ملكي, 3200, وحدة مخصصة",
  ].join("\n");
}

export function buildBulkImportTemplateWorkbook(): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] };
  const rows = [
    {
      الصنف: "قات صوطي درجة أولى",
      الكمية: 5,
      الوحدة: "علاقية قات",
      "سعر الوحدة": 4500,
      ملاحظات: "تغليف صباحي",
    },
    {
      الصنف: "قات نهمي نخب ممتاز",
      الكمية: 3,
      الوحدة: "كيس",
      "سعر الوحدة": 12000,
      ملاحظات: "فرز خاص",
    },
    {
      الصنف: "صنف خاص",
      الكمية: 2,
      الوحدة: "ربطة ملكي",
      "سعر الوحدة": 3200,
      ملاحظات: "وحدة مخصصة",
    },
  ];
  const ws = XLSX.utils.json_to_sheet(rows);
  ws["!views"] = [{ rightToLeft: true }];
  XLSX.utils.book_append_sheet(wb, ws, "استيراد_أصناف_الطلب");
  return wb;
}

export function buildQuickRepeatBasket(params: {
  requests: Array<{
    status: string;
    createdAt: string;
    lines: Array<{
      itemId: string | null;
      itemTitle: string;
      requestedQty: number;
      confirmedQty: number | null;
      unitCode: string;
      unitLabel: string;
      customUnitLabel: string | null;
      displayUnitLabel: string;
      unitPrice: number;
    }>;
  }>;
  bills: Array<{
    date: string;
    items: Array<{ description: string; quantity: number; unitPrice: number }>;
  }>;
  boardItems?: ClientCatalogBoardItemView[];
  catalogItems?: CatalogItemMatchSource[];
  formConfig?: TenantFormConfig | null;
}): QuickRepeatBasketItem[] {
  const map = new Map<string, QuickRepeatBasketItem>();

  const registerEntry = (entry: {
    itemId: string | null;
    itemTitle: string;
    qty: number;
    unitCode: string;
    unitLabel: string;
    customUnitLabel: string | null;
    displayUnitLabel: string;
    unitPrice: number;
    orderedAt: string;
  }) => {
    const cleanTitle = entry.itemTitle.trim();
    if (!cleanTitle) return;
    const key = `${normalizeLookupText(cleanTitle)}|${entry.unitCode}|${normalizeLookupText(
      entry.customUnitLabel || ""
    )}`;

    const boardOrCatalog = matchCatalogSource(cleanTitle, entry.unitCode, {
      boardItems: params.boardItems,
      catalogItems: params.catalogItems,
      formConfig: params.formConfig,
    });
    const effectivePrice =
      boardOrCatalog.unitPrice > 0 ? boardOrCatalog.unitPrice : Math.max(0, entry.unitPrice);
    const effectiveQty = Math.max(0.5, Number(entry.qty) || 1);
    const { totalAmount: lineTotal } = computeSaleTotals(effectiveQty, effectivePrice, 0);

    const prev = map.get(key);
    if (!prev) {
      map.set(key, {
        key,
        itemId: entry.itemId || boardOrCatalog.itemId || null,
        itemTitle: cleanTitle,
        unitCode: entry.unitCode || "QAT_BUNCH",
        unitLabel: entry.unitLabel || "علاقية قات",
        customUnitLabel: entry.customUnitLabel ?? null,
        displayUnitLabel: entry.displayUnitLabel || entry.unitLabel || "علاقية قات",
        lastQty: effectiveQty,
        unitPrice: effectivePrice,
        lineTotal,
        orderCount: 1,
        lastOrderedAt: entry.orderedAt,
        needsPriceConfirmation: effectivePrice <= 0,
      });
    } else {
      prev.orderCount += 1;
      if (entry.orderedAt >= prev.lastOrderedAt) {
        prev.lastOrderedAt = entry.orderedAt;
        prev.lastQty = effectiveQty;
        if (effectivePrice > 0) {
          prev.unitPrice = effectivePrice;
          prev.lineTotal = computeSaleTotals(effectiveQty, effectivePrice, 0).totalAmount;
          prev.needsPriceConfirmation = false;
        }
      }
    }
  };

  for (const r of params.requests) {
    if (r.status === "CANCELLED" || r.status === "REJECTED") continue;
    for (const l of r.lines) {
      registerEntry({
        itemId: l.itemId,
        itemTitle: l.itemTitle,
        qty: l.confirmedQty ?? l.requestedQty,
        unitCode: l.unitCode,
        unitLabel: l.unitLabel,
        customUnitLabel: l.customUnitLabel,
        displayUnitLabel: l.displayUnitLabel,
        unitPrice: l.unitPrice,
        orderedAt: r.createdAt,
      });
    }
  }

  for (const b of params.bills) {
    for (const it of b.items) {
      registerEntry({
        itemId: null,
        itemTitle: it.description,
        qty: it.quantity,
        unitCode: "QAT_BUNCH",
        unitLabel: "علاقية قات",
        customUnitLabel: null,
        displayUnitLabel: "علاقية قات",
        unitPrice: it.unitPrice,
        orderedAt: b.date,
      });
    }
  }

  return Array.from(map.values())
    .sort((a, b) => {
      if (b.orderCount !== a.orderCount) return b.orderCount - a.orderCount;
      return b.lastOrderedAt.localeCompare(a.lastOrderedAt);
    })
    .slice(0, 12);
}
