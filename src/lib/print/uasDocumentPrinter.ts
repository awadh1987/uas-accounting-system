/**
 * UAS Enterprise PDF & Print Document Engine (Mission 2 / Phase 3)
 * --------------------------------------------------------------------------
 * Pure light-mode (#FFFFFF background, #0F172A crisp ink) document renderer.
 * Supports A4 Portrait, A4 Landscape, and 80mm Thermal POS formats.
 * Never captures dark-mode UI containers or floating widgets (e.g. AI Copilot).
 *
 * Cross-platform dispatch:
 *  - Windows Desktop (UAS.exe) & Web (qat.world): isolated hidden <iframe> print
 *  - Android APK (Capacitor): dedicated light-mode print portal -> Android PrintManager
 *    (with Capacitor Filesystem/Share fallback)
 */
import { isCapacitorNative, triggerNativePrint } from "@/lib/nativeBridge";
import type { UasEnterpriseProfile } from "@/types/uas";

export type PrintPaperFormat = "A4_PORTRAIT" | "A4_LANDSCAPE" | "THERMAL_80MM";
export type DocumentStatusBadge = "DRAFT" | "PENDING_APPROVAL" | "POSTED" | "VOID";

export interface CompanyLetterheadMeta {
  companyNameAr: string;
  companyNameEn?: string;
  logoUrl?: string | null;
  branchName?: string;
  crNumber?: string;
  taxNumber?: string;
  phone?: string;
  address?: string;
  slogan?: string;
}

export interface PrintKeyValue {
  labelAr: string;
  labelEn?: string;
  value: string;
}

export interface PrintSummaryCard {
  labelAr: string;
  labelEn?: string;
  value: string;
  tone?: "neutral" | "emerald" | "rose" | "amber" | "indigo";
}

export interface PrintTableColumn {
  key: string;
  labelAr: string;
  labelEn?: string;
  align?: "right" | "left" | "center";
  numeric?: boolean;
}

export interface PrintTableSection {
  headingAr?: string;
  headingEn?: string;
  columns: PrintTableColumn[];
  rows: Array<Record<string, string | number | null | undefined>>;
  totalsRow?: Record<string, string | number | null | undefined>;
}

export interface UasPrintDocumentSpec {
  titleAr: string;
  titleEn?: string;
  documentNumber?: string;
  fiscalYear?: string;
  costCenter?: string;
  issueDate?: string;
  currency?: string;
  status?: DocumentStatusBadge;
  format?: PrintPaperFormat;
  letterhead?: CompanyLetterheadMeta;
  metadata?: PrintKeyValue[];
  summaryCards?: PrintSummaryCard[];
  tables?: PrintTableSection[];
  notes?: string;
  qrHash?: string;
  printedBy?: string;
  preparedBy?: string;
  reviewedBy?: string;
  approvedBy?: string;
}

const STATUS_META: Record<
  DocumentStatusBadge,
  { ar: string; en: string; watermark: string; color: string; bg: string; border: string }
> = {
  DRAFT: {
    ar: "مسودة",
    en: "DRAFT",
    watermark: "مسودة • DRAFT",
    color: "#92400e",
    bg: "#fef3c7",
    border: "#f59e0b",
  },
  PENDING_APPROVAL: {
    ar: "قيد الاعتماد",
    en: "PENDING APPROVAL",
    watermark: "قيد الاعتماد • PENDING APPROVAL",
    color: "#9a3412",
    bg: "#ffedd5",
    border: "#f97316",
  },
  POSTED: {
    ar: "معتمد ومرحل",
    en: "POSTED",
    watermark: "معتمد ومرحل • POSTED",
    color: "#065f46",
    bg: "#d1fae5",
    border: "#10b981",
  },
  VOID: {
    ar: "ملغي",
    en: "VOID",
    watermark: "ملغي • VOID",
    color: "#991b1b",
    bg: "#fee2e2",
    border: "#ef4444",
  },
};

export function escapeHtml(raw: string | number | null | undefined): string {
  const s = String(raw ?? "");
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Wraps mixed English / numeric / currency / code spans in `<bdi>` with
 * `unicode-bidi: isolate` so RTL parentheses and currency codes never invert.
 */
export function isolateBdi(raw: string | number | null | undefined, className = ""): string {
  const safe = escapeHtml(raw);
  const cls = className ? ` class="${className}"` : "";
  return `<bdi dir="auto"${cls}>${safe}</bdi>`;
}

export function resolveLetterheadFromProfile(
  profile?: UasEnterpriseProfile | null
): CompanyLetterheadMeta {
  const nameAr = profile?.legalNameAr?.trim() || "النظام المحاسبي الموحد";
  const nameEn = profile?.legalNameEn?.trim() || "Unified Accounting System";
  return {
    companyNameAr: nameAr,
    companyNameEn: nameEn,
    logoUrl: profile?.enterpriseLogoCustomUrl || profile?.logoUrl || null,
    branchName: profile?.heroBadgeAr?.trim() || undefined,
    crNumber: profile?.commercialReg?.trim() || undefined,
    taxNumber: profile?.taxNumber?.trim() || undefined,
    phone: profile?.phone?.trim() || undefined,
    address: profile?.address?.trim() || undefined,
    slogan: profile?.heroBadgeEn?.trim() || undefined,
  };
}

function buildMonogram(nameAr: string, nameEn?: string): string {
  const source = (nameEn || nameAr || "UAS").trim();
  const words = source.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return `${words[0][0] ?? "U"}${words[1][0] ?? "A"}`.toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

function buildPageCss(format: PrintPaperFormat): string {
  if (format === "THERMAL_80MM") {
    return `
      @page { size: 80mm auto; margin: 3mm; }
      .uas-doc { width: 74mm; max-width: 74mm; margin: 0 auto; padding: 2mm; font-size: 10px; }
      .uas-letterhead { flex-direction: column; align-items: center; text-align: center; gap: 6px; }
      .uas-meta-grid { grid-template-columns: 1fr; }
      .uas-cards { grid-template-columns: 1fr; }
      .uas-signatures { grid-template-columns: 1fr; gap: 8px; }
    `;
  }
  const size = format === "A4_LANDSCAPE" ? "A4 landscape" : "A4 portrait";
  const maxW = format === "A4_LANDSCAPE" ? "277mm" : "190mm";
  return `
    @page {
      size: ${size};
      margin: 10mm 10mm 14mm 10mm;
      @bottom-left {
        content: "صفحة " counter(page) " من " counter(pages);
        font-size: 9px;
        color: #475569;
      }
    }
    .uas-doc { width: 100%; max-width: ${maxW}; margin: 0 auto; padding: 4mm 2mm; font-size: 11px; }
  `;
}

/**
 * Generates a complete, standalone, pure light-mode HTML5 accounting document
 * with Company Letterhead, Status Watermark, RTL `<bdi>` isolation, and Dual UAS Footer.
 */
export function buildUasPrintHtml(spec: UasPrintDocumentSpec): string {
  const format: PrintPaperFormat = spec.format ?? "A4_PORTRAIT";
  const status: DocumentStatusBadge = spec.status ?? "POSTED";
  const st = STATUS_META[status];
  const lh: CompanyLetterheadMeta = {
    companyNameAr: spec.letterhead?.companyNameAr?.trim() || "النظام المحاسبي الموحد",
    companyNameEn: spec.letterhead?.companyNameEn?.trim() || "Unified Accounting System",
    logoUrl: spec.letterhead?.logoUrl || null,
    branchName: spec.letterhead?.branchName,
    crNumber: spec.letterhead?.crNumber,
    taxNumber: spec.letterhead?.taxNumber,
    phone: spec.letterhead?.phone,
    address: spec.letterhead?.address,
  };

  const issueDate = spec.issueDate || new Date().toISOString().slice(0, 16).replace("T", " ");
  const docNumber = spec.documentNumber || `RPT-${new Date().getFullYear()}-${Date.now().toString().slice(-4)}`;
  const currency = (spec.currency || "YER").toUpperCase();
  const fiscalYear = spec.fiscalYear || `FY-${new Date().getFullYear()}`;
  const printedAt = new Date().toISOString().slice(0, 16).replace("T", " ");
  const printedBy = spec.printedBy || "مستخدم النظام / System User";

  const logoHtml = lh.logoUrl
    ? `<img src="${escapeHtml(lh.logoUrl)}" alt="${escapeHtml(lh.companyNameAr)}" class="uas-logo-img" />`
    : `<div class="uas-logo-monogram">${escapeHtml(buildMonogram(lh.companyNameAr, lh.companyNameEn))}</div>`;

  const companyDetailsParts: string[] = [];
  if (lh.branchName) companyDetailsParts.push(`الفرع: ${isolateBdi(lh.branchName)}`);
  if (lh.crNumber) companyDetailsParts.push(`س.ت / CR: ${isolateBdi(lh.crNumber)}`);
  if (lh.taxNumber) companyDetailsParts.push(`الرقم الضريبي / Tax: ${isolateBdi(lh.taxNumber)}`);
  if (lh.phone) companyDetailsParts.push(`هاتف: ${isolateBdi(lh.phone)}`);
  if (lh.address) companyDetailsParts.push(`العنوان: ${escapeHtml(lh.address)}`);

  const docMetaItems: PrintKeyValue[] = [
    { labelAr: "رقم المستند", labelEn: "Doc No", value: docNumber },
    { labelAr: "السنة المالية", labelEn: "Fiscal Year", value: fiscalYear },
    { labelAr: "تاريخ الإصدار", labelEn: "Issue Date", value: issueDate },
    { labelAr: "العملة", labelEn: "Currency", value: currency },
    ...(spec.costCenter ? [{ labelAr: "مركز التكلفة", labelEn: "Cost Center", value: spec.costCenter }] : []),
    ...(spec.metadata || []),
  ];

  const metaHtml = docMetaItems
    .map(
      (m) => `
      <div class="uas-meta-item">
        <span class="uas-meta-label">${escapeHtml(m.labelAr)}${m.labelEn ? ` <span class="uas-en">(${isolateBdi(m.labelEn)})</span>` : ""}</span>
        <span class="uas-meta-value">${isolateBdi(m.value)}</span>
      </div>`
    )
    .join("");

  const cardsHtml =
    spec.summaryCards && spec.summaryCards.length > 0
      ? `<div class="uas-cards">${spec.summaryCards
          .map(
            (c) => `
          <div class="uas-card uas-tone-${c.tone || "neutral"}">
            <div class="uas-card-label">${escapeHtml(c.labelAr)}${c.labelEn ? ` <span class="uas-en">(${isolateBdi(c.labelEn)})</span>` : ""}</div>
            <div class="uas-card-value">${isolateBdi(c.value)}</div>
          </div>`
          )
          .join("")}</div>`
      : "";

  const tablesHtml = (spec.tables || [])
    .map((tbl) => {
      const heading = tbl.headingAr
        ? `<div class="uas-section-title">${escapeHtml(tbl.headingAr)}${tbl.headingEn ? ` <span class="uas-en">— ${isolateBdi(tbl.headingEn)}</span>` : ""}</div>`
        : "";
      const thead = `<thead><tr>${tbl.columns
        .map(
          (col) =>
            `<th style="text-align:${col.align || "right"}">${escapeHtml(col.labelAr)}${col.labelEn ? `<div class="uas-th-en">${isolateBdi(col.labelEn)}</div>` : ""}</th>`
        )
        .join("")}</tr></thead>`;

      const tbody =
        tbl.rows.length > 0
          ? `<tbody>${tbl.rows
              .map(
                (row) =>
                  `<tr>${tbl.columns
                    .map((col) => {
                      const val = row[col.key];
                      const rendered = col.numeric ? isolateBdi(val ?? "0", "uas-num") : isolateBdi(val ?? "—");
                      return `<td style="text-align:${col.align || "right"}">${rendered}</td>`;
                    })
                    .join("")}</tr>`
              )
              .join("")}</tbody>`
          : `<tbody><tr><td colspan="${tbl.columns.length}" class="uas-empty">لا توجد بيانات مطابقة / ${isolateBdi("No matching records")}</td></tr></tbody>`;

      const tfoot = tbl.totalsRow
        ? `<tfoot><tr>${tbl.columns
            .map((col) => {
              const val = tbl.totalsRow?.[col.key];
              return `<td style="text-align:${col.align || "right"}">${val !== undefined && val !== null ? isolateBdi(val, col.numeric ? "uas-num" : "") : ""}</td>`;
            })
            .join("")}</tr></tfoot>`
        : "";

      return `<section class="uas-table-section">${heading}<table class="uas-table">${thead}${tbody}${tfoot}</table></section>`;
    })
    .join("");

  const notesHtml = spec.notes
    ? `<div class="uas-notes"><strong>ملاحظات / ${isolateBdi("Notes")}:</strong> ${escapeHtml(spec.notes)}</div>`
    : "";

  const qrHtml = spec.qrHash
    ? `<div class="uas-qr-strip"><span>رمز التحقق المحاسبي (${isolateBdi("Verification Hash")}):</span> <code>${isolateBdi(spec.qrHash)}</code></div>`
    : "";

  const titleEnHtml = spec.titleEn
    ? `<div class="uas-doc-title-en">${isolateBdi(spec.titleEn)}</div>`
    : "";

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(spec.titleAr)}${spec.documentNumber ? ` - ${escapeHtml(spec.documentNumber)}` : ""}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      background: #FFFFFF !important;
      color: #0F172A !important;
      font-family: "Cairo", "Tajawal", "Segoe UI", Tahoma, Arial, sans-serif;
      direction: rtl;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    bdi { unicode-bidi: isolate; }
    ${buildPageCss(format)}

    .uas-doc {
      position: relative;
      background: #FFFFFF;
      color: #0F172A;
    }

    /* Status Watermark */
    .uas-watermark {
      position: fixed;
      top: 44%;
      left: 50%;
      transform: translate(-50%, -50%) rotate(-28deg);
      font-size: 46px;
      font-weight: 900;
      letter-spacing: 2px;
      color: ${st.color};
      opacity: ${status === "POSTED" ? "0.055" : "0.11"};
      pointer-events: none;
      white-space: nowrap;
      z-index: 0;
      border: 4px solid ${st.color};
      padding: 8px 26px;
      border-radius: 14px;
    }

    .uas-content { position: relative; z-index: 1; }

    /* Official Company Letterhead Band */
    .uas-letterhead {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 14px;
      border-bottom: 2.5px solid #0F172A;
      padding-bottom: 10px;
      margin-bottom: 12px;
    }
    .uas-brand-block { display: flex; align-items: center; gap: 12px; }
    .uas-logo-img {
      width: 54px; height: 54px; object-fit: contain;
      border: 1px solid #cbd5e1; border-radius: 10px; padding: 3px; background: #ffffff;
    }
    .uas-logo-monogram {
      width: 54px; height: 54px; border-radius: 10px;
      background: #0F172A; color: #FFFFFF;
      display: flex; align-items: center; justify-content: center;
      font-size: 20px; font-weight: 900; letter-spacing: 1px;
    }
    .uas-company-ar { font-size: 16px; font-weight: 900; color: #0F172A; line-height: 1.25; }
    .uas-company-en { font-size: 11px; font-weight: 700; color: #475569; margin-top: 2px; }
    .uas-company-details { font-size: 9.5px; color: #334155; margin-top: 4px; display: flex; flex-wrap: wrap; gap: 10px; }

    .uas-doc-header-right { text-align: left; }
    .uas-doc-title-ar { font-size: 15px; font-weight: 900; color: #0F172A; }
    .uas-doc-title-en { font-size: 10.5px; font-weight: 700; color: #475569; margin-top: 2px; }
    .uas-status-pill {
      display: inline-block;
      margin-top: 6px;
      padding: 2px 10px;
      border-radius: 999px;
      font-size: 10px;
      font-weight: 800;
      color: ${st.color};
      background: ${st.bg};
      border: 1px solid ${st.border};
    }

    /* Metadata Grid */
    .uas-meta-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 6px;
      margin-bottom: 12px;
      background: #F8FAFC;
      border: 1px solid #CBD5E1;
      border-radius: 8px;
      padding: 8px 10px;
    }
    .uas-meta-item { display: flex; flex-direction: column; gap: 2px; }
    .uas-meta-label { font-size: 9px; font-weight: 700; color: #475569; }
    .uas-meta-value { font-size: 10.5px; font-weight: 800; color: #0F172A; }
    .uas-en { font-size: 9px; color: #64748B; font-weight: 600; }

    /* KPI Summary Cards */
    .uas-cards {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
      gap: 8px;
      margin-bottom: 12px;
    }
    .uas-card {
      border: 1px solid #CBD5E1;
      border-radius: 8px;
      padding: 8px 10px;
      background: #FFFFFF;
    }
    .uas-tone-emerald { border-right: 4px solid #059669; }
    .uas-tone-rose { border-right: 4px solid #e11d48; }
    .uas-tone-amber { border-right: 4px solid #d97706; }
    .uas-tone-indigo { border-right: 4px solid #4f46e5; }
    .uas-tone-neutral { border-right: 4px solid #0F172A; }
    .uas-card-label { font-size: 9.5px; font-weight: 700; color: #475569; }
    .uas-card-value { font-size: 13px; font-weight: 900; color: #0F172A; margin-top: 3px; font-variant-numeric: tabular-nums; }

    /* Tables */
    .uas-table-section { margin-bottom: 14px; page-break-inside: auto; }
    .uas-section-title {
      font-size: 12px; font-weight: 900; color: #0F172A;
      margin-bottom: 5px; padding-bottom: 3px; border-bottom: 1px solid #E2E8F0;
    }
    .uas-table {
      width: 100%;
      border-collapse: collapse;
      border: 1px solid #94A3B8;
      font-size: 10px;
    }
    .uas-table th {
      background: #F1F5F9;
      color: #0F172A;
      font-weight: 800;
      padding: 6px 7px;
      border: 1px solid #94A3B8;
      white-space: nowrap;
    }
    .uas-th-en { font-size: 8.5px; font-weight: 600; color: #475569; }
    .uas-table td {
      padding: 5px 7px;
      border: 1px solid #CBD5E1;
      color: #0F172A;
      vertical-align: top;
    }
    .uas-table tbody tr:nth-child(even) { background: #F8FAFC; }
    .uas-table tfoot td {
      background: #E2E8F0;
      font-weight: 900;
      border-top: 2px solid #0F172A;
    }
    .uas-num { font-family: "Consolas", "Courier New", monospace; font-variant-numeric: tabular-nums; }
    .uas-empty { text-align: center; padding: 14px !important; color: #64748B; font-style: italic; }

    .uas-notes {
      border: 1px solid #CBD5E1;
      background: #F8FAFC;
      border-radius: 6px;
      padding: 8px 10px;
      font-size: 10px;
      margin-bottom: 10px;
    }
    .uas-qr-strip {
      font-size: 9.5px;
      color: #334155;
      border: 1px dashed #94A3B8;
      border-radius: 6px;
      padding: 5px 10px;
      margin-bottom: 12px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .uas-qr-strip code { font-family: monospace; font-weight: 700; color: #0F172A; }

    /* Dual UAS Signature Footer & Audit Strip */
    .uas-footer {
      margin-top: 18px;
      padding-top: 10px;
      border-top: 1.5px solid #0F172A;
      page-break-inside: avoid;
    }
    .uas-signatures {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 16px;
      margin-bottom: 14px;
    }
    .uas-sig-box {
      border: 1px solid #CBD5E1;
      border-radius: 6px;
      padding: 8px 10px;
      min-height: 54px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }
    .uas-sig-title { font-size: 9.5px; font-weight: 800; color: #0F172A; }
    .uas-sig-name { font-size: 9px; color: #475569; margin-top: 16px; border-top: 1px dotted #94A3B8; padding-top: 3px; }

    .uas-audit-strip {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      font-size: 9px;
      color: #475569;
      background: #F8FAFC;
      border: 1px solid #E2E8F0;
      border-radius: 6px;
      padding: 6px 10px;
    }
    .uas-powered-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-weight: 900;
      color: #0F172A;
      background: #FFFFFF;
      border: 1px solid #0F172A;
      border-radius: 999px;
      padding: 2px 10px;
      font-size: 9.5px;
    }
    .uas-powered-dot {
      width: 7px; height: 7px; border-radius: 999px; background: #059669; display: inline-block;
    }
  </style>
</head>
<body>
  <div class="uas-doc" data-format="${format}" data-status="${status}">
    <div class="uas-watermark" aria-hidden="true">${isolateBdi(st.watermark)}</div>
    <div class="uas-content">
      <header class="uas-letterhead">
        <div class="uas-brand-block">
          ${logoHtml}
          <div>
            <div class="uas-company-ar">${escapeHtml(lh.companyNameAr)}</div>
            ${lh.companyNameEn ? `<div class="uas-company-en">${isolateBdi(lh.companyNameEn)}</div>` : ""}
            ${companyDetailsParts.length > 0 ? `<div class="uas-company-details">${companyDetailsParts.map((p) => `<span>${p}</span>`).join("")}</div>` : ""}
          </div>
        </div>
        <div class="uas-doc-header-right">
          <div class="uas-doc-title-ar">${escapeHtml(spec.titleAr)}</div>
          ${titleEnHtml}
          <div class="uas-status-pill">${escapeHtml(st.ar)} / ${isolateBdi(st.en)}</div>
        </div>
      </header>

      <div class="uas-meta-grid">${metaHtml}</div>
      ${cardsHtml}
      ${tablesHtml}
      ${notesHtml}
      ${qrHtml}

      <footer class="uas-footer">
        <div class="uas-signatures">
          <div class="uas-sig-box">
            <div class="uas-sig-title">أعده / ${isolateBdi("Prepared By")}</div>
            <div class="uas-sig-name">${escapeHtml(spec.preparedBy || printedBy)}</div>
          </div>
          <div class="uas-sig-box">
            <div class="uas-sig-title">راجعه / ${isolateBdi("Reviewed By")}</div>
            <div class="uas-sig-name">${escapeHtml(spec.reviewedBy || "التوقيع / Signature")}</div>
          </div>
          <div class="uas-sig-box">
            <div class="uas-sig-title">اعتمده / ${isolateBdi("Approved By")}</div>
            <div class="uas-sig-name">${escapeHtml(spec.approvedBy || "المدير المالي / Finance Manager")}</div>
          </div>
        </div>

        <div class="uas-audit-strip">
          <span>طُبع بواسطة: <strong>${escapeHtml(printedBy)}</strong> • ${isolateBdi(printedAt)}</span>
          <span class="uas-page-num">صفحة ${isolateBdi("1")} من ${isolateBdi("1")}</span>
          <span class="uas-powered-badge">
            <span class="uas-powered-dot"></span>
            <span>${isolateBdi("Powered by UAS")} • النظام المحاسبي الموحد</span>
          </span>
        </div>
      </footer>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Dispatches the clean light-mode document to the native print / Save-as-PDF spooler
 * across Windows Desktop (UAS.exe), Web (qat.world), and Android APK (Capacitor).
 */
export async function printUasDocument(spec: UasPrintDocumentSpec): Promise<{ ok: boolean; method: string }> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return { ok: false, method: "ssr_noop" };
  }

  const html = buildUasPrintHtml(spec);
  const jobTitle = `${spec.titleEn || spec.titleAr}-${spec.documentNumber || "UAS"}`
    .replace(/[^\w\u0600-\u06FF-]+/g, "-")
    .slice(0, 80);

  // Android Capacitor APK: inject an isolated light-mode print portal so Android PrintManager
  // captures ONLY the pure light-mode accounting document (never dark UI or AI Copilot).
  if (isCapacitorNative()) {
    const portalId = "uas-clean-print-portal";
    const styleId = "uas-clean-print-portal-style";
    document.getElementById(portalId)?.remove();
    document.getElementById(styleId)?.remove();

    const styleEl = document.createElement("style");
    styleEl.id = styleId;
    styleEl.textContent = `
      @media screen { #${portalId} { display: none !important; } }
      @media print {
        body > *:not(#${portalId}) { display: none !important; }
        html, body { background: #FFFFFF !important; color: #0F172A !important; }
        #${portalId} { display: block !important; background: #FFFFFF !important; }
      }
    `;
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    const headStyleMatch = html.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
    const portal = document.createElement("div");
    portal.id = portalId;
    portal.innerHTML = `${headStyleMatch ? `<style>${headStyleMatch[1]}</style>` : ""}${bodyMatch ? bodyMatch[1] : html}`;
    document.head.appendChild(styleEl);
    document.body.appendChild(portal);

    const res = await triggerNativePrint({ title: jobTitle });
    setTimeout(() => {
      document.getElementById(portalId)?.remove();
      document.getElementById(styleId)?.remove();
    }, 2500);
    return { ok: res.ok, method: res.method };
  }

  // Windows Desktop (UAS.exe) & Web (qat.world): isolated hidden iframe print
  return new Promise((resolve) => {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("aria-hidden", "true");
    iframe.style.position = "fixed";
    iframe.style.right = "-9999px";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    document.body.appendChild(iframe);

    const win = iframe.contentWindow;
    const doc = iframe.contentDocument || win?.document;
    if (!win || !doc) {
      iframe.remove();
      resolve({ ok: false, method: "iframe_unavailable" });
      return;
    }

    doc.open();
    doc.write(html);
    doc.close();

    const prevTitle = document.title;
    document.title = jobTitle;

    const cleanup = () => {
      document.title = prevTitle;
      setTimeout(() => iframe.remove(), 600);
    };

    setTimeout(() => {
      try {
        win.focus();
        win.print();
        cleanup();
        resolve({ ok: true, method: "isolated_iframe_print" });
      } catch {
        cleanup();
        resolve({ ok: false, method: "isolated_iframe_error" });
      }
    }, 180);
  });
}
