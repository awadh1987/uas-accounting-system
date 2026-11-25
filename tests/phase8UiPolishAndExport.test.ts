import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
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
  resolveExportSignature,
} from "../src/lib/uiFormatters";
import {
  appendExportSignatureSheet,
  appendExportSignatureToWorksheet,
} from "../src/lib/excelExport";
import { exportBulkBankTransferFile } from "../src/lib/treasury/bankWalletGateway";
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

  it("embeds Username + Title signature block across PDF/Print, Excel and CSV exports without breaking sorting or leaking paths", () => {
    const html = buildUasPrintHtml({
      titleAr: "فاتورة مبيعات وكشف",
      titleEn: "Sales Invoice & Statement",
      documentNumber: "INV-2026-99",
      documentDate: "2026-11-24",
      status: "POSTED",
      letterhead: {
        companyNameAr: "شركة الجبري",
        tenantSlug: "aljabri",
        isCustomTenantBrand: true,
      },
      exportedBy: {
        username: "ahmed_sales",
        displayName: "أحمد السقاف",
        titleAr: "مسؤول مبيعات وتحصيل",
        titleEn: "Sales & Collections",
        tenantSlug: "aljabri",
        tenantName: "شركة الجبري",
      },
    });
    assert.ok(html.includes('data-testid="uas-export-signature-block"'));
    assert.ok(html.includes("ahmed_sales"));
    assert.ok(html.includes("أحمد السقاف"));
    assert.ok(html.includes("مسؤول مبيعات وتحصيل"));
    assert.ok(html.includes("aljabri"));
    assert.ok(!html.includes("/var/www"));

    // Excel workbook signature block separated by blank rows + dedicated signature sheet
    const sig = resolveExportSignature({
      actor: {
        username: "khalid_chief",
        displayName: "خالد العامري",
        titleAr: "رئيس الحسابات",
        titleEn: "Chief Accountant",
        tenantSlug: "alameri",
        tenantName: "شركة العامري",
      },
    });
    const wb = XLSX.utils.book_new();
    const dataRows = [
      { "الصنف": "صوطي", "الكمية": 10, "الإجمالي": 50000 },
      { "الصنف": "عنسي", "الكمية": 5, "الإجمالي": 25000 },
    ];
    const ws = XLSX.utils.json_to_sheet(dataRows);
    appendExportSignatureToWorksheet(ws, dataRows.length, sig);
    XLSX.utils.book_append_sheet(wb, ws, "المبيعات");
    appendExportSignatureSheet(wb, sig);

    // Blank separator rows after table (dataRows.length + 1 = row index 3 -> separator rows 3 & 4 empty!)
    assert.equal(ws[XLSX.utils.encode_cell({ r: 3, c: 0 })], undefined);
    const sigSheetRows = XLSX.utils.sheet_to_json<Record<string, string>>(wb.Sheets["توقيع المُصدِر"]);
    const joinedSig = JSON.stringify(sigSheetRows);
    assert.ok(joinedSig.includes("khalid_chief"));
    assert.ok(joinedSig.includes("رئيس الحسابات"));
    assert.ok(joinedSig.includes("alameri"));

    // CSV export BOM + signature metadata without breaking data columns
    const csvExport = exportBulkBankTransferFile({
      treasuryAccountId: "t1",
      provider: "KURAIMI_API",
      format: "csv",
      tenantSlug: "uas-ye",
      exportedBy: {
        username: "treasury_ops",
        displayName: "سالم باوزير",
        titleAr: "مسؤول الخزينة",
        tenantSlug: "uas-ye",
        tenantName: "نظام اليمن",
      },
      items: [
        { beneficiaryName: "محمد علي", accountOrPhone: "777111222", amount: 15000, currencyCode: "YER" },
      ],
    });
    const csvStr = csvExport.buffer.toString("utf8");
    assert.ok(csvStr.startsWith("\uFEFF"), "CSV must keep UTF-8 BOM for Arabic Excel rendering");
    assert.ok(csvStr.includes("treasury_ops"));
    assert.ok(csvStr.includes("مسؤول الخزينة"));
    assert.ok(csvStr.includes("uas-ye"));
    assert.ok(!csvStr.includes("/var/www"));
  });

  it("hides APK/EXE installers on tenant landing/login, places Client Portal card above feature sections with full directory and single دخول login, and wires PhoneContactInput everywhere", () => {
    const landingSrc = fs.readFileSync(path.join(REPO_ROOT, "src/components/LandingPage.tsx"), "utf8");
    assert.ok(landingSrc.includes("!isInstalledApp && !isTenantBranded"));
    assert.ok(landingSrc.includes('data-testid="tenant-client-portal-card"'));
    assert.ok(landingSrc.includes("دخول بوابة العملاء"));
    assert.ok(landingSrc.includes("تسجيل عميل جديد"));
    assert.ok(landingSrc.includes("الأسعار والفرز"));
    assert.ok(landingSrc.includes("تسجيل طلب"));
    assert.ok(landingSrc.includes("متابعة الطلبات"));
    assert.ok(landingSrc.includes("الفواتير وكشف الحساب"));
    assert.ok(landingSrc.includes('data-testid="tenant-staff-login-cta"'));
    assert.ok(landingSrc.includes("دخول"));
    assert.ok(!landingSrc.includes("مدير النظام العام"));
    assert.ok(!landingSrc.includes("SUPER_ADMIN"));
    assert.ok(
      landingSrc.indexOf('data-testid="tenant-client-portal-card"') <
        landingSrc.indexOf("ركائز النظام المحاسبي الموحد")
    );

    const loginSrc = fs.readFileSync(path.join(REPO_ROOT, "src/components/LoginView.tsx"), "utf8");
    assert.ok(loginSrc.includes("!isInstalledApp && !isTenantWorkspace"));

    const systemSrc = fs.readFileSync(path.join(REPO_ROOT, "src/components/tabs/SystemTab.tsx"), "utf8");
    assert.ok(systemSrc.includes("TenantClientPortalAdminPanel"));
    assert.ok(systemSrc.includes('activeSubTab === "client-portal"'));
    assert.ok(systemSrc.includes("/downloads/UAS-Mobile-Release-qat.world.apk"));

    const customersSrc = fs.readFileSync(path.join(REPO_ROOT, "src/components/tabs/CustomersTab.tsx"), "utf8");
    assert.ok(customersSrc.includes("TenantClientPortalAdminPanel"));
    assert.ok(customersSrc.includes('canEdit(currentUser, "system")'));

    const salesSrc = fs.readFileSync(path.join(REPO_ROOT, "src/components/tabs/SalesTab.tsx"), "utf8");
    assert.ok(salesSrc.includes('data-testid="sales-open-portal-admin"'));

    const phoneWiredFiles = [
      "src/components/client-portal/ClientPortalApp.tsx",
      "src/components/tabs/SalesTab.tsx",
      "src/components/tabs/CustomersTab.tsx",
      "src/components/ProcurementTab.tsx",
      "src/components/QuickMasterCreateModal.tsx",
      "src/components/tabs/WorkersTab.tsx",
      "src/components/BankPayoutModal.tsx",
      "src/components/UserProfileDrawer.tsx",
      "src/components/portal-admin/TenantClientPortalAdminPanel.tsx",
      "src/components/TenantAdminConfigPanel.tsx",
      "src/components/tabs/SystemTab.tsx",
    ];
    for (const rel of phoneWiredFiles) {
      const content = fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
      assert.ok(content.includes("PhoneContactInput"), `${rel} must use PhoneContactInput`);
    }

    const manifestXml = fs.readFileSync(
      path.join(REPO_ROOT, "android/app/src/main/AndroidManifest.xml"),
      "utf8"
    );
    assert.ok(manifestXml.includes("android.permission.READ_CONTACTS"));
  });
});
