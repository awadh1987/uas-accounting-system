import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildCustomerStatementPrintSpec } from "../src/components/tabs/CustomersTab";
import { buildUasPrintHtml, isolateBdi } from "../src/lib/print/uasDocumentPrinter";
import type { UasProject, UasSaleTransaction } from "../src/types/uas";

describe("Phase 3 — Client PDF Sale Details Toggle & Mobile/RTL Polish", () => {
  const sampleProjects: UasProject[] = [
    {
      id: "PRJ-01",
      code: "PRJ-001",
      name: "مزرعة الجوف",
      type: "FARM",
      parentProjectId: "NONE",
      estimatedValue: 5000000,
      plannedHarvests: 4,
      notes: "مشروع زراعي",
      harvests: ["قطفة أولى", "قطفة ثانية"],
      subProjects: [],
    },
  ];

  const sampleSales: UasSaleTransaction[] = [
    {
      id: "sale-1",
      date: "2026-11-20",
      voucherNo: "V-1001",
      customer: "شركة الأمل للتجارة",
      phone: "777123456",
      projectId: "PRJ-01",
      harvest: "قطفة أولى",
      batch: "دفعة-1",
      grade: "درجة أولى ممتاز",
      bundles: 50,
      price: 2000,
      total: 100000,
      credit: 60000,
      debit: 40000,
      notes: "تسليم فوري",
    },
    {
      id: "sale-2",
      date: "2026-11-21",
      voucherNo: "V-1002",
      customer: "شركة الأمل للتجارة",
      phone: "777123456",
      projectId: "PRJ-01",
      harvest: "قطفة ثانية",
      batch: "دفعة-2",
      grade: "درجة ثانية",
      bundles: 25,
      price: 1600,
      total: 40000,
      credit: 40000,
      debit: 0,
      notes: "سداد نقدي كامل",
    },
  ];

  it("(1) builds detailed statement PDF spec with per-sale items (quantities, units, prices, harvest)", () => {
    const detailedSpec = buildCustomerStatementPrintSpec({
      selectedCustomer: "شركة الأمل للتجارة",
      visibleRows: sampleSales,
      projects: sampleProjects,
      includeSaleDetails: true,
      documentDate: "2026-11-20",
    });

    assert.equal(detailedSpec.format, "A4_LANDSCAPE");
    assert.equal(detailedSpec.status, "POSTED");
    assert.equal(detailedSpec.documentNumber, "RPT-CUST-2026-11-20");

    const modeMeta = detailedSpec.metadata?.find((m) => m.labelAr === "نمط التقرير");
    assert.ok(modeMeta, "Report mode metadata present");
    assert.ok(modeMeta.value.includes("مفصل"), "Detailed mode label included in metadata");

    const table = detailedSpec.tables?.[0];
    assert.ok(table, "Table section exists");
    assert.equal(table.columns.length, 10, "10 detailed columns present");

    const columnKeys = table.columns.map((c) => c.key);
    assert.ok(columnKeys.includes("bundles"), "bundles/qty column included");
    assert.ok(columnKeys.includes("price"), "unit price column included");
    assert.ok(columnKeys.includes("grade"), "grade column included");
    assert.ok(columnKeys.includes("harvest"), "harvest/project column included");

    // Check rows data
    assert.equal(table.rows.length, 2);
    assert.equal(table.rows[0].bundles, "50");
    assert.equal(table.rows[0].price, "2,000");
    assert.equal(table.rows[0].grade, "درجة أولى ممتاز");
    assert.ok(String(table.rows[0].harvest).includes("مزرعة الجوف"));

    // Check totals
    assert.ok(table.totalsRow, "Totals row present");
    assert.equal(table.totalsRow.bundles, "75");
    assert.equal(table.totalsRow.total, "140,000");
    assert.equal(table.totalsRow.credit, "100,000");
    assert.equal(table.totalsRow.debit, "40,000");

    // Render HTML
    const html = buildUasPrintHtml(detailedSpec);
    assert.ok(html.includes("حركات وفواتير العميل مع تفاصيل المبيعات"));
    assert.ok(html.includes("درجة أولى ممتاز"));
    assert.ok(html.includes("2,000"));
    assert.ok(html.includes("140,000"));
  });

  it("(2) builds summary-only statement PDF spec when includeSaleDetails is false", () => {
    const summarySpec = buildCustomerStatementPrintSpec({
      selectedCustomer: "شركة الأمل للتجارة",
      visibleRows: sampleSales,
      projects: sampleProjects,
      includeSaleDetails: false,
      documentDate: "2026-11-20",
    });

    assert.equal(summarySpec.format, "A4_PORTRAIT");
    const modeMeta = summarySpec.metadata?.find((m) => m.labelAr === "نمط التقرير");
    assert.ok(modeMeta?.value.includes("ملخص"), "Summary mode label included in metadata");

    const table = summarySpec.tables?.[0];
    assert.ok(table);
    assert.equal(table.columns.length, 6, "6 summary columns present");

    const columnKeys = table.columns.map((c) => c.key);
    assert.ok(!columnKeys.includes("bundles"), "bundles/qty column omitted in summary mode");
    assert.ok(!columnKeys.includes("price"), "unit price column omitted in summary mode");
    assert.ok(!columnKeys.includes("grade"), "grade column omitted in summary mode");

    // Rows
    assert.equal(table.rows.length, 2);
    assert.equal(table.rows[0].total, "100,000");
    assert.equal(table.rows[0].credit, "60,000");
    assert.equal(table.rows[0].debit, "40,000");

    // Render HTML
    const html = buildUasPrintHtml(summarySpec);
    assert.ok(html.includes("حركات وفواتير العميل (ملخص)"));
    assert.ok(!html.includes("درجة أولى ممتاز"), "Grade omitted in summary HTML");
  });

  it("(3) protects negative currency numbers and bi-directional text with isolateBdi in RTL", () => {
    const negAmount = "-15,000";
    const bdiMarkup = isolateBdi(negAmount);

    assert.ok(bdiMarkup.startsWith("<bdi dir=\"auto\""), "bdi wrapper includes dir='auto'");
    assert.ok(bdiMarkup.includes("-15,000"), "Preserves minus sign and formatted digits");

    const mixedBdi = isolateBdi("-25,000 YER (خسارة)");
    assert.ok(mixedBdi.includes("-25,000 YER"), "Contains negative amount with currency");
  });
});
