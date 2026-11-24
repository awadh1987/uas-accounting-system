import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { resolveTenantCloudUrl } from "../src/lib/serverConnection";
import {
  filterOutSyntheticTestRecords,
  isSyntheticTestRecord,
  isSyntheticTestText,
} from "../src/lib/testRecordHygiene";
import {
  buildTenantExportFilename,
  formatIsoToDmy,
  formatMoney,
  formatRefreshTimestamp,
  parseDmyOrIsoToIso,
} from "../src/lib/uiFormatters";
import {
  buildUasPrintHtml,
  buildUasPrintJobTitle,
} from "../src/lib/print/uasDocumentPrinter";

const REPO_ROOT = path.resolve(__dirname, "..");

describe("Phase 8 — ERP UI Polish, Dates, Test Hygiene, PDF RTL Shaping & Overflow Controls", () => {
  it("resolves tenant cloud URLs consistently across active slugs and default", () => {
    for (const slug of ["aljabri", "alameri", "yasser-albukli", "uas-ye"]) {
      assert.equal(resolveTenantCloudUrl(slug), `https://${slug}.qat.world`);
    }
    assert.equal(resolveTenantCloudUrl("default"), "https://qat.world");
  });

  it("identifies synthetic test/IDM records accurately without flagging real agricultural records", () => {
    assert.equal(isSyntheticTestText("IDEM_605367"), true);
    assert.equal(isSyntheticTestText("FY87906"), true);
    assert.equal(isSyntheticTestText("صنف بمحركات (SKU-BSY-536712)"), true);
    assert.equal(isSyntheticTestText("SMOKE-VENDOR-01"), true);

    assert.equal(isSyntheticTestText("مزرعة وادي ظهر - الجبري"), false);
    assert.equal(isSyntheticTestText("INV-2026-0042"), false);
    assert.equal(isSyntheticTestText("محمد ناصر العامري"), false);

    const mixed = [
      { id: "1", voucherNo: "RV-1001", customer: "شركة الأمل" },
      { id: "2", voucherNo: "IDEM_605367", customer: "عميل تجريبي" },
      { id: "3", code: "CUST-002", nameAr: "FY87906" },
    ];
    const filtered = filterOutSyntheticTestRecords(mixed, true);
    assert.equal(filtered.hiddenCount, 2);
    assert.deepEqual(
      filtered.visible.map((r) => r.id),
      ["1"]
    );
    assert.equal(isSyntheticTestRecord(mixed[1]), true);
    assert.equal(isSyntheticTestRecord(mixed[0]), false);
  });

  it("formats Yemeni dd / mm / yyyy dates, parses back to ISO, unifies money & filenames", () => {
    assert.equal(formatIsoToDmy("2026-11-24"), "24 / 11 / 2026");
    assert.equal(parseDmyOrIsoToIso("24 / 11 / 2026"), "2026-11-24");
    assert.equal(parseDmyOrIsoToIso("05/03/2026"), "2026-03-05");
    assert.equal(parseDmyOrIsoToIso("30 / 02 / 2026"), null);
    assert.equal(parseDmyOrIsoToIso("15 / 13 / 2026"), null);

    assert.equal(formatMoney(15000, "YER", { lang: "ar" }), "15,000 ريال");
    assert.equal(formatMoney(15000, "YER", { lang: "en" }), "15,000 YER");
    assert.ok(formatRefreshTimestamp(new Date("2026-11-24T10:15:30Z"), "ar").includes("آخر تحديث:"));

    const fname = buildTenantExportFilename({
      tenantSlug: "aljabri",
      module: "ClientStatement",
      ext: "xlsx",
      date: "2026-11-24",
    });
    assert.equal(fname, "UAS-aljabri-ClientStatement-2026-11-24.xlsx");
  });

  it("renders connected Arabic glyphs in RTL PDF/print HTML (zero letter-spacing glyph breakage)", () => {
    const html = buildUasPrintHtml({
      titleAr: "كشف حساب العميل",
      titleEn: "Customer Account Statement",
      documentNumber: "STMT-2026-01",
      documentDate: "2026-11-24",
      status: "POSTED",
      letterhead: {
        companyNameAr: "شركة الجبري الزراعية",
        companyNameEn: "Al-Jabri Agri",
        tenantSlug: "aljabri",
        isCustomTenantBrand: true,
      },
    });

    assert.ok(html.includes('<html lang="ar" dir="rtl">'));
    assert.ok(!html.includes("letter-spacing: 2px;"), "Arabic watermark must not apply letter-spacing: 2px");
    assert.ok(html.includes(".uas-table thead { display: table-header-group; }"));
    assert.equal(
      buildUasPrintJobTitle({
        titleAr: "تقرير",
        titleEn: "Sales Report",
        documentNumber: "RPT-01",
        documentDate: "2026-11-24",
        letterhead: { companyNameAr: "X", tenantSlug: "aljabri" },
      }),
      "aljabri-Sales-Report-RPT-01-2026-11-24"
    );
  });

  it("enforces Phase 8 UI standards across ERP components (refresh, overflow menu, dd/mm/yyyy, clearance, clean Arabic labels)", () => {
    const checkHas = (relPath: string, needles: string[]) => {
      const content = fs.readFileSync(path.join(REPO_ROOT, relPath), "utf8");
      for (const n of needles) {
        assert.ok(content.includes(n), `${relPath} missing expected token: ${n}`);
      }
      return content;
    };

    const proc = checkHas("src/components/ProcurementTab.tsx", [
      "ActionOverflowMenu",
      "UasDateInput",
      "تحديث",
      "رقم الهاتف:",
      'data-testid="procurement-subtab-select"',
    ]);
    assert.ok(!proc.includes("(PO → GRN → Bill → Payment)"));

    const sales = checkHas("src/components/tabs/SalesTab.tsx", [
      "ActionOverflowMenu",
      "UasDateInput",
      "تحديث",
      "إعادة ضبط الفلاتر",
      'data-testid="sales-actions-select"',
    ]);
    assert.ok(!sales.includes("(Sales Volume)"));
    assert.ok(!sales.includes("(Cash Collections)"));
    assert.ok(!sales.includes("(Credit Due)"));

    const cust = checkHas("src/components/tabs/CustomersTab.tsx", [
      "ActionOverflowMenu",
      "تحديث",
      "formatMoney",
      "بوابة العملاء والطلبات",
      "اعتماد وإرسال واتساب",
    ]);
    assert.ok(!cust.includes("(Clients Directory & Statements)"));
    assert.ok(!cust.includes("(All Customers)"));
    assert.ok(!cust.includes("(Include details for each sale)"));

    checkHas("src/components/MultiUnitInventoryPanel.tsx", ["ActionOverflowMenu", "dir={isAr ? \"rtl\" : \"ltr\"}", "lg:col-span-2"]);
    checkHas("src/components/tabs/InventoryTab.tsx", ["تحديث", "تسجيل دفعة حصاد الآن"]);
    checkHas("src/components/tabs/WorkersTab.tsx", ["ActionOverflowMenu", "UasDateInput", "رقم الهاتف:", "تحديث"]);
    checkHas("src/components/UasAppShell.tsx", ["pb-28 md:pb-24", "ClientPortalApp"]);
  });
});
