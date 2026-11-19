import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  canArchiveDeleteRecords,
  canCloseFiscalYear,
  canConfigureApprovals,
  canCustomUom,
  canDecideApprovals,
  canFxRevalue,
  canManageAllDrafts,
  hasGranularPermission,
} from "../src/lib/permissions";
import { parseExcelImport } from "../src/lib/excelExport";
import * as XLSX from "xlsx";

describe("Phase 4: Granular RBAC Permissions & System Invariants", () => {
  it("verifies SUPER_ADMIN possesses all 7 granular action rights", () => {
    const admin = "SUPER_ADMIN";
    assert.equal(hasGranularPermission(admin, "accounting.close_year"), true);
    assert.equal(hasGranularPermission(admin, "accounting.fx_revalue"), true);
    assert.equal(hasGranularPermission(admin, "approvals.decide"), true);
    assert.equal(hasGranularPermission(admin, "approvals.configure"), true);
    assert.equal(hasGranularPermission(admin, "drafts.manage_all"), true);
    assert.equal(hasGranularPermission(admin, "inventory.custom_uom"), true);
    assert.equal(hasGranularPermission(admin, "records.archive_delete"), true);

    assert.equal(canCloseFiscalYear(admin), true);
    assert.equal(canFxRevalue(admin), true);
    assert.equal(canDecideApprovals(admin), true);
    assert.equal(canConfigureApprovals(admin), true);
    assert.equal(canManageAllDrafts(admin), true);
    assert.equal(canCustomUom(admin), true);
    assert.equal(canArchiveDeleteRecords(admin), true);
  });

  it("verifies CHIEF_ACCOUNTANT has financial closure, revaluation, approvals and archive rights", () => {
    const chief = "CHIEF_ACCOUNTANT";
    assert.equal(hasGranularPermission(chief, "accounting.close_year"), true);
    assert.equal(hasGranularPermission(chief, "accounting.fx_revalue"), true);
    assert.equal(hasGranularPermission(chief, "approvals.decide"), true);
    assert.equal(hasGranularPermission(chief, "approvals.configure"), true);
    assert.equal(hasGranularPermission(chief, "drafts.manage_all"), true);
    assert.equal(hasGranularPermission(chief, "inventory.custom_uom"), true);
    assert.equal(hasGranularPermission(chief, "records.archive_delete"), true);
  });

  it("verifies PROJECT_MANAGER can approve and manage drafts, but cannot close fiscal years or configure approval rules", () => {
    const pm = "PROJECT_MANAGER";
    assert.equal(hasGranularPermission(pm, "approvals.decide"), true);
    assert.equal(hasGranularPermission(pm, "drafts.manage_all"), true);
    assert.equal(hasGranularPermission(pm, "inventory.custom_uom"), true);
    assert.equal(hasGranularPermission(pm, "accounting.close_year"), false);
    assert.equal(hasGranularPermission(pm, "accounting.fx_revalue"), false);
    assert.equal(hasGranularPermission(pm, "approvals.configure"), false);
    assert.equal(hasGranularPermission(pm, "records.archive_delete"), false);
  });

  it("verifies FIELD_ACCOUNTANT and EXTERNAL_AUDITOR cannot close year, revalue FX, or archive records", () => {
    const field = "FIELD_ACCOUNTANT";
    const auditor = "EXTERNAL_AUDITOR";

    assert.equal(hasGranularPermission(field, "accounting.close_year"), false);
    assert.equal(hasGranularPermission(field, "accounting.fx_revalue"), false);
    assert.equal(hasGranularPermission(field, "records.archive_delete"), false);
    assert.equal(hasGranularPermission(field, "approvals.configure"), false);

    assert.equal(hasGranularPermission(auditor, "accounting.close_year"), false);
    assert.equal(hasGranularPermission(auditor, "accounting.fx_revalue"), false);
    assert.equal(hasGranularPermission(auditor, "approvals.decide"), false);
    assert.equal(hasGranularPermission(auditor, "records.archive_delete"), false);
  });

  it("verifies custom user overrides can grant or revoke specific granular rights", () => {
    const customUser = {
      id: "u-custom-1",
      name: "Custom Auditor",
      email: "auditor@uas.local",
      role: "EXTERNAL_AUDITOR",
      active: true,
      avatarChar: "A",
      useCustomPermissions: true,
      customOverrides: {
        canArchiveDeleteRecords: true,
        canCustomUom: true,
      },
    };

    assert.equal(canArchiveDeleteRecords(customUser), true);
    assert.equal(canCustomUom(customUser), true);
    assert.equal(canCloseFiscalYear(customUser), false);
  });
});

describe("Phase 4: Excel/CSV Import Parser & Template Invariants", () => {
  it("correctly parses multi-currency and multi-unit columns from an Excel workbook", () => {
    const wb = XLSX.utils.book_new();
    const rows = [
      {
        CustomerName: "Al-Amal Co",
        CostCenterCode: "CC-MAIN",
        CurrencyCode: "SAR",
        ExchangeRate: 530,
        Quantity: 10,
        UnitCode: "BUNDLE",
        FactorToBase: 1,
        UnitPrice: 100,
        PaidCredit: 530000,
      },
    ];
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, "Sales");

    const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
    const parsed = parseExcelImport<any>(buf, "sales");

    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].CustomerName, "Al-Amal Co");
    assert.equal(parsed[0].customer, "Al-Amal Co");
    assert.equal(parsed[0].CostCenterCode, "CC-MAIN");
    assert.equal(parsed[0].costCenterCode, "CC-MAIN");
    assert.equal(parsed[0].CurrencyCode, "SAR");
    assert.equal(parsed[0].currencyCode, "SAR");
    assert.equal(Number(parsed[0].ExchangeRate), 530);
    assert.equal(parsed[0].UnitCode, "BUNDLE");
    assert.equal(parsed[0].unitCode, "BUNDLE");
    assert.equal(Number(parsed[0].FactorToBase), 1);
    assert.equal(Number(parsed[0].factorToBase), 1);
  });

  it("normalizes composite bilingual headers and preserves decimal exchange rates & factors", () => {
    const wb = XLSX.utils.book_new();
    const rows = [
      {
        "اسم العميل / CustomerName": "شركة الأمل للتجارة",
        "كود مركز التكلفة / CostCenterCode": "CC-AGRI-01",
        "كود العملة / CurrencyCode": "USD",
        "سعر الصرف / ExchangeRate": 530.75,
        "الكمية / Quantity": 25.5,
        "كود الوحدة / UnitCode": "CARTON",
        "معامل التحويل / FactorToBase": 12.5,
        "سعر الوحدة / UnitPrice": 80.25,
        "دائن مقبوض / PaidCredit": 150000,
        "مدين متبقي / RemainingDebit": 0,
      },
    ];
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, "Sales");

    const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
    const parsed = parseExcelImport<any>(buf, "sales");

    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].customer, "شركة الأمل للتجارة");
    assert.equal(parsed[0].customerName, "شركة الأمل للتجارة");
    assert.equal(parsed[0].costCenterCode, "CC-AGRI-01");
    assert.equal(parsed[0].currencyCode, "USD");
    assert.equal(parsed[0].exchangeRate, 530.75);
    assert.equal(parsed[0].quantity, 25.5);
    assert.equal(parsed[0].unitCode, "CARTON");
    assert.equal(parsed[0].factorToBase, 12.5);
    assert.equal(parsed[0].unitPrice, 80.25);
    assert.equal(parsed[0].credit, 150000);
  });
});
