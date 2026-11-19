import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildUasPrintHtml,
  isolateBdi,
  resolveLetterheadFromProfile,
} from "../src/lib/print/uasDocumentPrinter";

describe("Phase 3 — Enterprise PDF & Print Document Engine (Letterhead + Dual UAS Branding)", () => {
  it("(a) renders full Company Letterhead metadata, monogram/logo, signature blocks and Dual UAS footer", () => {
    const htmlWithLogo = buildUasPrintHtml({
      titleAr: "كشف حساب وأجور العمال",
      titleEn: "Worker Account Report",
      documentNumber: "RPT-WRK-2026-001",
      fiscalYear: "FY-2026",
      costCenter: "CC-PRJ-0001 • مزرعة الشمال",
      currency: "YER",
      status: "POSTED",
      printedBy: "أحمد المحاسب",
      letterhead: {
        companyNameAr: "شركة النهضة التجارية المحدودة",
        companyNameEn: "Al-Nahda Trading Co. Ltd.",
        logoUrl: "https://example.com/logo.png",
        branchName: "الفرع الرئيسي - صنعاء",
        crNumber: "CR-88412",
        taxNumber: "TAX-991002",
        phone: "777123456",
        address: "صنعاء - شارع الزبيري",
      },
      tables: [
        {
          headingAr: "تفاصيل الأجور",
          headingEn: "Wage Details",
          columns: [
            { key: "worker", labelAr: "العامل", labelEn: "Worker" },
            { key: "amount", labelAr: "المبلغ", labelEn: "Amount", numeric: true },
          ],
          rows: [{ worker: "بلال محمد", amount: "15,000" }],
          totalsRow: { worker: "الإجمالي", amount: "15,000" },
        },
      ],
    });

    // Letterhead assertions
    assert.ok(htmlWithLogo.includes("شركة النهضة التجارية المحدودة"), "Company Arabic name present");
    assert.ok(htmlWithLogo.includes("Al-Nahda Trading Co. Ltd."), "Company English name present");
    assert.ok(htmlWithLogo.includes('src="https://example.com/logo.png"'), "Uploaded company logo rendered");
    assert.ok(htmlWithLogo.includes("CR-88412"), "Commercial Registration rendered");
    assert.ok(htmlWithLogo.includes("TAX-991002"), "Tax Number rendered");
    assert.ok(htmlWithLogo.includes("الفرع الرئيسي - صنعاء"), "Branch name rendered");
    assert.ok(htmlWithLogo.includes("CC-PRJ-0001"), "Cost Center rendered");
    assert.ok(htmlWithLogo.includes("FY-2026"), "Fiscal Year rendered");
    assert.ok(htmlWithLogo.includes("RPT-WRK-2026-001"), "Document number rendered");

    // Dual UAS Signature Footer & Audit Strip
    assert.ok(htmlWithLogo.includes("أعده"), "Prepared By signature block present");
    assert.ok(htmlWithLogo.includes("راجعه"), "Reviewed By signature block present");
    assert.ok(htmlWithLogo.includes("اعتمده"), "Approved By signature block present");
    assert.ok(htmlWithLogo.includes("Powered by UAS"), "Dual UAS Powered-By badge present");
    assert.ok(htmlWithLogo.includes("النظام المحاسبي الموحد"), "UAS Arabic branding present");
    assert.ok(htmlWithLogo.includes("أحمد المحاسب"), "Printed-by user present");
    assert.ok(htmlWithLogo.includes("صفحة "), "Page numbering present");

    // Monogram fallback when no logoUrl is uploaded
    const htmlMonogram = buildUasPrintHtml({
      titleAr: "سند قبض",
      letterhead: { companyNameAr: "مؤسسة الأمل", companyNameEn: "Al Amal" },
    });
    assert.ok(htmlMonogram.includes('class="uas-logo-monogram">AA<'), "Monogram fallback rendered");

    // resolveLetterheadFromProfile helper
    const resolved = resolveLetterheadFromProfile(null);
    assert.ok(resolved.companyNameAr.length > 0);
  });

  it("(b) injects accurate status watermark and pill for DRAFT, PENDING_APPROVAL, POSTED, and VOID", () => {
    const draftHtml = buildUasPrintHtml({ titleAr: "قيد يومية", status: "DRAFT" });
    assert.ok(draftHtml.includes('data-status="DRAFT"'));
    assert.ok(draftHtml.includes("مسودة • DRAFT"), "DRAFT watermark injected");

    const pendingHtml = buildUasPrintHtml({ titleAr: "فاتورة مبيعات", status: "PENDING_APPROVAL" });
    assert.ok(pendingHtml.includes('data-status="PENDING_APPROVAL"'));
    assert.ok(pendingHtml.includes("قيد الاعتماد • PENDING APPROVAL"), "PENDING_APPROVAL watermark injected");

    const postedHtml = buildUasPrintHtml({ titleAr: "فاتورة مبيعات", status: "POSTED" });
    assert.ok(postedHtml.includes('data-status="POSTED"'));
    assert.ok(postedHtml.includes("معتمد ومرحل • POSTED"), "POSTED watermark injected");

    const voidHtml = buildUasPrintHtml({ titleAr: "سند صرف", status: "VOID" });
    assert.ok(voidHtml.includes('data-status="VOID"'));
    assert.ok(voidHtml.includes("ملغي • VOID"), "VOID watermark injected");
  });

  it("(c) enforces dir=rtl and <bdi> unicode-bidi: isolate for mixed Arabic/English titles & currency codes", () => {
    const isolated = isolateBdi("Worker Account Report (USD)");
    assert.equal(isolated, '<bdi dir="auto">Worker Account Report (USD)</bdi>');

    const html = buildUasPrintHtml({
      titleAr: "كشف حساب وأجور العمال",
      titleEn: "Worker Account Report",
      currency: "SAR",
      documentNumber: "INV-2026-0042",
    });

    assert.ok(html.includes('<html lang="ar" dir="rtl">'), "Document enforces dir=rtl");
    assert.ok(html.includes("bdi { unicode-bidi: isolate; }"), "CSS unicode-bidi: isolate rule enforced");
    assert.ok(html.includes('<bdi dir="auto">Worker Account Report</bdi>'), "English subtitle wrapped in <bdi>");
    assert.ok(html.includes('<bdi dir="auto">SAR</bdi>'), "Currency code wrapped in <bdi>");
    assert.ok(html.includes('<bdi dir="auto">INV-2026-0042</bdi>'), "Document number wrapped in <bdi>");
    // Ensure broken inverted parentheses never appear
    assert.ok(!html.includes(")Worker Account Report("));
  });

  it("(d) guarantees pure light-mode output with zero dark-mode or AI Copilot widget bleed across A4 & 80mm formats", () => {
    const a4Html = buildUasPrintHtml({
      titleAr: "تقرير المبيعات",
      titleEn: "Sales Report",
      format: "A4_LANDSCAPE",
    });

    assert.ok(a4Html.includes("background: #FFFFFF !important;"), "Pure white background enforced");
    assert.ok(a4Html.includes("color: #0F172A !important;"), "Crisp dark ink enforced");
    assert.ok(a4Html.includes("size: A4 landscape"), "A4 Landscape @page rule applied");
    assert.ok(!a4Html.includes("المساعد الذكي & دليل المستخدم"), "Zero AI Copilot widget text bleed");
    assert.ok(!a4Html.includes("bg-slate-900"), "Zero dark-mode utility class bleed");
    assert.ok(!a4Html.includes("dark:"), "Zero dark-mode variant bleed");

    const posHtml = buildUasPrintHtml({
      titleAr: "إيصال نقاط البيع",
      format: "THERMAL_80MM",
    });
    assert.ok(posHtml.includes("size: 80mm auto"), "80mm Thermal POS @page rule applied");
    assert.ok(posHtml.includes('data-format="THERMAL_80MM"'));
  });
});
