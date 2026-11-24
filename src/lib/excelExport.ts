import * as XLSX from "xlsx";
import { computeNetOperatingProfit } from "@/lib/formulas";
import { reconcileHarvestInventory } from "@/lib/harvestReconciliation";
import { exportOrShareBinaryFile } from "@/lib/nativeBridge";
import type { UasBootstrapState } from "@/types/uas";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

async function saveOrShareWorkbook(wb: XLSX.WorkBook, filename: string): Promise<void> {
  const arrayBuffer = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  const res = await exportOrShareBinaryFile({
    filename,
    mimeType: XLSX_MIME,
    data: new Uint8Array(arrayBuffer),
    title: filename,
  });
  if (!res.ok && typeof window !== "undefined") {
    XLSX.writeFile(wb, filename);
  }
}

function createRtlSheet(rows: Record<string, unknown>[], numericCols: string[] = []): XLSX.WorkSheet {
  const ws = XLSX.utils.json_to_sheet(rows.length > 0 ? rows : [{ "الحالة": "لا توجد بيانات" }]);
  ws["!views"] = [{ rightToLeft: true }];

  if (rows.length > 0 && numericCols.length > 0) {
    const headers = Object.keys(rows[0]);
    numericCols.forEach((colName) => {
      const colIdx = headers.indexOf(colName);
      if (colIdx === -1) return;
      const isRateOrFactor =
        colName.toLowerCase().includes("rate") ||
        colName.toLowerCase().includes("factor") ||
        colName.includes("سعر الصرف") ||
        colName.includes("معامل التحويل") ||
        colName.includes("معامل");

      const numFormat = isRateOrFactor ? "#,##0.00##" : "#,##0";

      for (let r = 1; r <= rows.length; r++) {
        const cellRef = XLSX.utils.encode_cell({ r, c: colIdx });
        const cell = ws[cellRef];
        if (cell && typeof cell.v === "number") {
          cell.z = numFormat;
        }
      }
    });
  }
  return ws;
}

export function exportFullWorkbookToExcel(
  state: UasBootstrapState,
  options?: {
    filename?: string;
    workerFilter?: string;
    customerFilter?: string;
    tenantSlug?: string | null;
  }
): void {
  const wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] };

  const projectNameById = (pid: string) =>
    state.projects.find((p) => p.id === pid)?.name || "";

  const subProjectNameById = (pid: string, spId?: string | null) => {
    if (!spId) return "";
    const p = state.projects.find((proj) => proj.id === pid);
    const sp = p?.subProjects?.find((s) => s.id === spId);
    return sp ? (sp.code ? `${sp.code} • ${sp.nameAr}` : sp.nameAr) : "";
  };

  // Sheet 1: Projects Summary
  const projRows = state.projects.map((p) => {
    const sTotal = state.sales
      .filter((s) => s.projectId === p.id)
      .reduce((a, b) => a + Number(b.total), 0);
    const eTotal = state.expenses
      .filter((e) => e.projectId === p.id)
      .reduce((a, b) => a + Number(b.total), 0);
    const wTotal = state.workers
      .filter((w) => w.projectId === p.id)
      .reduce((a, b) => a + Number(b.total), 0);

    return {
      "اسم المشروع": p.name,
      "النوع": p.type,
      "قيمة المشروع": Number(p.estimatedValue),
      "عدد القطفات": (p.harvests || []).length,
      "إجمالي المبيعات": sTotal,
      "المصروفات التشغيلية": eTotal,
      "أجور العمال": wTotal,
      "صافي الربح والخسارة": computeNetOperatingProfit(sTotal, eTotal, wTotal),
      "ملاحظات": p.notes,
    };
  });
  XLSX.utils.book_append_sheet(
    wb,
    createRtlSheet(projRows, [
      "قيمة المشروع",
      "إجمالي المبيعات",
      "المصروفات التشغيلية",
      "أجور العمال",
      "صافي الربح والخسارة",
    ]),
    "Projects Summary"
  );

  // Sheet 1.5: Sub-Projects (Cost Centers)
  const subProjRows = state.projects.flatMap((p) =>
    (p.subProjects || []).map((sp) => ({
      "كود القطاع": sp.code,
      "اسم القطاع الفرعي": sp.nameAr,
      "Sector Name": sp.nameEn || "",
      "المشروع الرئيسي": p.name,
      "الحالة": sp.status || "ACTIVE",
      "الموازنة التقديرية (YER)": Number(sp.budget) || 0,
      "المقاول / المورد": sp.vendorName || "—",
      "ملاحظات": sp.notes || "",
    }))
  );
  if (subProjRows.length > 0) {
    XLSX.utils.book_append_sheet(
      wb,
      createRtlSheet(subProjRows, ["الموازنة التقديرية (YER)"]),
      "Sub-Projects"
    );
  }

  // Sheet 2: Customer Sales
  const filteredSales =
    options?.customerFilter && options.customerFilter !== "ALL"
      ? state.sales.filter((s) => s.customer === options.customerFilter)
      : state.sales;

  const saleRows = filteredSales.map((s) => {
    const ext = s as unknown as Record<string, unknown>;
    return {
      "المشروع": projectNameById(s.projectId),
      "القطاع الفرعي": subProjectNameById(s.projectId, s.subProjectId) || "—",
      "مركز التكلفة / Cost Center":
        ext.costCenterCode ||
        ext.costCenterId ||
        (s.subProjectId
          ? state.projects.flatMap((p) => p.subProjects || []).find((sp) => sp.id === s.subProjectId)?.code || s.subProjectId
          : "—"),
      "العملة / Currency": ext.currencyCode || ext.currency || "YER",
      "سعر الصرف / FX Rate": Number(ext.exchangeRate || 1),
      "القطفة": s.harvest,
      "رقم العملية التسلسلي": s.sequenceNumber || s.batch,
      "الوردية / الدفعة": s.dailyBatchLabel || s.batch,
      "مسؤول المبيعات": s.salesOfficerTitle || "—",
      "اسم العميل": s.customer,
      "رقم الهاتف": s.phone,
      "النوع / الدرجة": s.grade,
      "الكمية": Number(s.bundles || 0),
      "كود الوحدة / Unit Code": ext.unitCode || "BUNDLE",
      "معامل التحويل / Factor": Number(ext.factorToBase || 1),
      "السعر": Number(s.price || 0),
      "الإجمالي": Number(s.total || 0),
      "دائن (مقبوض)": Number(s.credit || 0),
      "مدين (متبقي)": Number(s.debit || 0),
      "الحساب الإيرادي": s.revenueAccountCode || "411101",
      "الخزينة": s.treasuryName || "—",
      "التاريخ": s.date,
      "رقم السند": s.voucherNo,
    };
  });
  XLSX.utils.book_append_sheet(
    wb,
    createRtlSheet(saleRows, [
      "الكمية",
      "معامل التحويل / Factor",
      "سعر الصرف / FX Rate",
      "السعر",
      "الإجمالي",
      "دائن (مقبوض)",
      "مدين (متبقي)",
    ]),
    "Customer Sales"
  );

  // Sheet 3: Worker Account Report
  const filteredWorkers =
    options?.workerFilter && options.workerFilter !== "ALL"
      ? state.workers.filter((w) => w.name === options.workerFilter)
      : state.workers;

  const wrkRows = filteredWorkers.map((w) => ({
    "الاسم": w.name,
    "المشروع": projectNameById(w.projectId),
    "القطاع الفرعي": subProjectNameById(w.projectId, w.subProjectId) || "—",
    "القطفة": w.harvest,
    "الأجر اليومي": Number(w.dailyWage),
    "عدد الأيام": Number(w.days),
    "الإجمالي": Number(w.total),
    "دائن (مدفوع)": Number(w.credit),
    "مدين (متبقي)": Number(w.debit),
    "التاريخ": w.date,
  }));
  XLSX.utils.book_append_sheet(
    wb,
    createRtlSheet(wrkRows, ["الأجر اليومي", "الإجمالي", "دائن (مدفوع)", "مدين (متبقي)"]),
    "Worker Account Report"
  );

  // Sheet 4: Operating Expenses
  const expRows = state.expenses.map((e) => {
    const ext = e as unknown as Record<string, unknown>;
    return {
      "المشروع": projectNameById(e.projectId),
      "القطاع الفرعي": subProjectNameById(e.projectId, e.subProjectId) || "—",
      "مركز التكلفة / Cost Center":
        ext.costCenterCode ||
        ext.costCenterId ||
        (e.subProjectId
          ? state.projects.flatMap((p) => p.subProjects || []).find((sp) => sp.id === e.subProjectId)?.code || e.subProjectId
          : "—"),
      "العملة / Currency": ext.currencyCode || ext.currency || "YER",
      "سعر الصرف / FX Rate": Number(ext.exchangeRate || 1),
      "القطفة": e.harvest,
      "الفئة": e.category,
      "البيان": e.subType,
      "الكمية": Number(e.qty || 0),
      "كود الوحدة / Unit Code": ext.unitCode || "QTY",
      "معامل التحويل / Factor": Number(ext.factorToBase || 1),
      "قيمة الوحدة": Number(e.unitPrice || 0),
      "الإجمالي": Number(e.total || 0),
      "التاريخ": e.date,
      "ملاحظات": e.notes,
    };
  });
  XLSX.utils.book_append_sheet(
    wb,
    createRtlSheet(expRows, [
      "الكمية",
      "معامل التحويل / Factor",
      "سعر الصرف / FX Rate",
      "قيمة الوحدة",
      "الإجمالي",
    ]),
    "Operating Expenses"
  );

  // Sheet 5: Treasury & Installments
  const instRows = state.installments.map((inst) => ({
    "رقم السند": inst.voucherNo,
    "النوع": inst.type === "CUSTOMER_RECEIPT" ? "سند قبض عميل" : "سند صرف عامل",
    "العميل / العامل": inst.targetName,
    "الخزينة / البنك":
      state.treasuryAccounts.find((t) => t.id === inst.treasuryId)?.name || inst.treasuryId,
    "المبلغ (YER)": Number(inst.amount),
    "التاريخ": inst.date,
    "ملاحظات": inst.notes,
  }));
  XLSX.utils.book_append_sheet(
    wb,
    createRtlSheet(instRows, ["المبلغ (YER)"]),
    "Treasury & Vouchers"
  );

  // Sheet 6: Inventory Reconciliation
  const invReport = reconcileHarvestInventory(state.inventoryBatches, state.sales);
  const invRows = invReport.rows.map((r) => ({
    "المشروع": projectNameById(r.batch.projectId),
    "القطفة": r.batch.harvest,
    "الدرجة": r.batch.grade,
    "المقطوف": r.harvestedBundles,
    "المباع": r.soldBundles,
    "الفاقد": r.shrinkageBundles,
    "المتبقي": r.remainingBundles,
  }));
  XLSX.utils.book_append_sheet(
    wb,
    createRtlSheet(invRows, ["المقطوف", "المباع", "الفاقد", "المتبقي"]),
    "Inventory"
  );

  // Sheet 7: Audit Log
  const auditRows = state.auditLogs.map((a) => ({
    "التوقيت": a.timestamp,
    "المستخدم": a.user,
    "نوع الحدث": a.action,
    "التفاصيل": a.details,
    "بصمة التحقق": a.hash,
  }));
  XLSX.utils.book_append_sheet(wb, createRtlSheet(auditRows), "Audit Log");

  const dateTag = new Date().toISOString().slice(0, 10);
  const safeTenant = String(options?.tenantSlug || state.enterpriseProfile?.tenantSlug || "default")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-") || "default";
  void saveOrShareWorkbook(wb, options?.filename || `UAS-${safeTenant}-Workbook-${dateTag}.xlsx`);
}

export interface FinancialExportPayload {
  trialBalance: {
    rows: Array<{
      code: string;
      nameAr: string;
      nameEn: string;
      level: number;
      type: string;
      totalDebit: number;
      totalCredit: number;
      netDebit: number;
      netCredit: number;
    }>;
    totalDebits: number;
    totalCredits: number;
  };
  incomeStatement: {
    totalRevenue: number;
    totalCogs: number;
    grossProfit: number;
    totalOperatingExpenses: number;
    totalAdminExpenses: number;
    netProfit: number;
    projectBreakdown: Array<{
      code: string;
      nameAr: string;
      budgetTotal: number;
      revenue: number;
      actualCost: number;
      netProfit: number;
      variance: number;
    }>;
    subProjectBreakdown?: Array<{
      code: string;
      nameAr: string;
      projectNameAr?: string;
      budget: number;
      revenue: number;
      actualCost: number;
      netProfit: number;
      variance: number;
      utilizationPct?: number;
    }>;
  };
  balanceSheet: {
    assetLines: Array<{ code: string; nameAr: string; balance: number }>;
    liabilityLines: Array<{ code: string; nameAr: string; balance: number }>;
    equityLines: Array<{ code: string; nameAr: string; balance: number }>;
    currentYearNetProfit: number;
    totalAssets: number;
    totalLiabilities: number;
    totalEquity: number;
  };
}

export function exportFinancialStatementsToExcel(data: FinancialExportPayload): void {
  const wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] };

  // 1. Trial Balance with Freeze Panes & Active SUM Formulas
  const tbRows = data.trialBalance.rows.map((r) => {
    const indent = "  ".repeat(Math.max(0, r.level - 1));
    return {
      "رقم الحساب": r.code,
      "اسم الحساب": `${indent}${r.nameAr}`,
      "Account Name": `${indent}${r.nameEn || ""}`,
      "الجيل / المستوى": `الجيل ${r.level}`,
      "التصنيف": r.type,
      "إجمالي المدين": Number(r.totalDebit),
      "إجمالي الدائن": Number(r.totalCredit),
      "رصيد مدين": Number(r.netDebit),
      "رصيد دائن": Number(r.netCredit),
    };
  });
  const tbSheet = createRtlSheet(tbRows, [
    "إجمالي المدين",
    "إجمالي الدائن",
    "رصيد مدين",
    "رصيد دائن",
  ]);
  const lastRow = tbRows.length + 1;
  if (tbRows.length > 0) {
    XLSX.utils.sheet_add_aoa(
      tbSheet,
      [
        [
          "الإجمالي العام (ميزان المراجعة)",
          "",
          "",
          "",
          "",
          { t: "n", v: data.trialBalance.totalDebits, z: "#,##0" },
          { t: "n", v: data.trialBalance.totalCredits, z: "#,##0" },
          { t: "n", f: `SUM(H2:H${lastRow})`, z: "#,##0" },
          { t: "n", f: `SUM(I2:I${lastRow})`, z: "#,##0" },
        ],
      ],
      { origin: -1 }
    );
  }
  tbSheet["!views"] = [{ rightToLeft: true, state: "frozen", ySplit: 1 }];
  XLSX.utils.book_append_sheet(wb, tbSheet, "Trial Balance");

  // 2. Profit & Loss & Budget Variance
  const plRows = data.incomeStatement.projectBreakdown.map((p) => ({
    "الرمز": p.code,
    "المشروع": p.nameAr,
    "الموازنة التقديرية": Number(p.budgetTotal),
    "الإيرادات": Number(p.revenue),
    "التكاليف الفعلية": Number(p.actualCost),
    "صافي الربح": Number(p.netProfit),
    "انحراف الموازنة": Number(p.variance),
  }));
  const plSheet = createRtlSheet(plRows, [
    "الموازنة التقديرية",
    "الإيرادات",
    "التكاليف الفعلية",
    "صافي الربح",
    "انحراف الموازنة",
  ]);
  plSheet["!views"] = [{ rightToLeft: true, state: "frozen", ySplit: 1 }];
  XLSX.utils.book_append_sheet(wb, plSheet, "Profit & Loss");

  // 3. Balance Sheet
  const bsRows = [
    ...data.balanceSheet.assetLines.map((a) => ({
      "القسم": "الأصول (Assets)",
      "رقم الحساب": a.code,
      "الحساب": a.nameAr,
      "الرصيد (YER)": Number(a.balance),
    })),
    ...data.balanceSheet.liabilityLines.map((l) => ({
      "القسم": "الالتزامات (Liabilities)",
      "رقم الحساب": l.code,
      "الحساب": l.nameAr,
      "الرصيد (YER)": Number(l.balance),
    })),
    ...data.balanceSheet.equityLines.map((eq) => ({
      "القسم": "حقوق الملكية (Equity)",
      "رقم الحساب": eq.code,
      "الحساب": eq.nameAr,
      "الرصيد (YER)": Number(eq.balance),
    })),
    {
      "القسم": "حقوق الملكية (Equity)",
      "رقم الحساب": "313101",
      "الحساب": "صافي ربح العام المالي الجاري",
      "الرصيد (YER)": Number(data.balanceSheet.currentYearNetProfit),
    },
  ];
  const bsSheet = createRtlSheet(bsRows, ["الرصيد (YER)"]);
  bsSheet["!views"] = [{ rightToLeft: true, state: "frozen", ySplit: 1 }];
  XLSX.utils.book_append_sheet(wb, bsSheet, "Balance Sheet");

  // 4. Sub-Projects Cost Centers Breakdown
  if (data.incomeStatement.subProjectBreakdown && data.incomeStatement.subProjectBreakdown.length > 0) {
    const spRows = data.incomeStatement.subProjectBreakdown.map((sp) => {
      const budget = Number(sp.budget) || 0;
      const actual = Number(sp.actualCost) || 0;
      const rev = Number(sp.revenue) || 0;
      const profit = Number(sp.netProfit) || 0;
      const margin = rev > 0 ? (profit / rev) * 100 : 0;
      return {
        "كود القطاع": sp.code,
        "اسم القطاع الفرعي": sp.nameAr,
        "المشروع الرئيسي": sp.projectNameAr || "—",
        "الموازنة التقديرية (YER)": budget,
        "الإيرادات (YER)": rev,
        "التكاليف الفعلية (YER)": actual,
        "صافي الربح (YER)": profit,
        "المتبقي من الموازنة": Number(sp.variance),
        "نسبة الاستهلاك": `${(Number(sp.utilizationPct) || 0).toFixed(1)}%`,
        "هامش الربح %": `${margin.toFixed(1)}%`,
      };
    });
    const spSheet = createRtlSheet(spRows, [
      "الموازنة التقديرية (YER)",
      "الإيرادات (YER)",
      "التكاليف الفعلية (YER)",
      "صافي الربح (YER)",
      "المتبقي من الموازنة",
    ]);
    spSheet["!views"] = [{ rightToLeft: true, state: "frozen", ySplit: 1 }];
    XLSX.utils.book_append_sheet(wb, spSheet, "Sub-Projects Variance");
  }

  const fsDateTag = new Date().toISOString().slice(0, 10);
  const fsSafeTenant = String((data as { tenantSlug?: string }).tenantSlug || "default")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-") || "default";
  void saveOrShareWorkbook(wb, `UAS-${fsSafeTenant}-Financial-Statements-${fsDateTag}.xlsx`);
}

export type TemplateModule = "sales" | "expenses" | "items" | "customers" | "vendors" | "journal";

export async function exportUasModuleTemplate(module: TemplateModule): Promise<void> {
  const wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] };

  let sampleRows: Record<string, unknown>[] = [];
  const filename = `UAS_Template_${module.toUpperCase()}.xlsx`;

  if (module === "sales") {
    sampleRows = [
      {
        "اسم العميل / CustomerName": "شركة الأمل للتجارة",
        "كود مركز التكلفة / CostCenterCode": "CC-MAIN",
        "كود العملة / CurrencyCode": "YER",
        "سعر الصرف / ExchangeRate": 1,
        "الكمية / Quantity": 50,
        "كود الوحدة / UnitCode": "BUNDLE",
        "معامل التحويل / FactorToBase": 1,
        "سعر الوحدة / UnitPrice": 1200,
        "دائن مقبوض / PaidCredit": 60000,
        "مدين متبقي / RemainingDebit": 0,
        "البيان / Notes": "فاتورة مبيعات محصول",
        "التاريخ / Date": new Date().toISOString().slice(0, 10),
      },
    ];
  } else if (module === "expenses") {
    sampleRows = [
      {
        "الفئة / Category": "وقود/محروقات",
        "البيان / SubType": "ديزل للري",
        "كود مركز التكلفة / CostCenterCode": "CC-MAIN",
        "كود العملة / CurrencyCode": "YER",
        "سعر الصرف / ExchangeRate": 1,
        "الكمية / Quantity": 100,
        "كود الوحدة / UnitCode": "LITER",
        "معامل التحويل / FactorToBase": 1,
        "سعر الوحدة / UnitPrice": 850,
        "الإجمالي / Total": 85000,
        "التاريخ / Date": new Date().toISOString().slice(0, 10),
        "ملاحظات / Notes": "توريد محروقات",
      },
    ];
  } else if (module === "items") {
    sampleRows = [
      {
        "كود الصنف / ItemCode": "ITEM-DIESEL-01",
        "اسم الصنف عربي / NameAr": "ديزل ممتاز",
        "اسم الصنف إنجليزي / NameEn": "Premium Diesel",
        "الفئة / Category": "محروقات ووقود",
        "كود الوحدة الأساسية / BaseUnitCode": "LITER",
        "كود وحدة الشراء / PurchaseUnitCode": "BARREL",
        "معامل التحويل / FactorToBase": 200,
        "سعر الشراء الافتراضي / DefaultCost": 850,
        "سعر البيع الافتراضي / DefaultPrice": 950,
      },
    ];
  } else if (module === "customers") {
    sampleRows = [
      {
        "كود العميل / CustomerCode": "CUST-001",
        "الاسم / Name": "مؤسسة النور الزراعية",
        "رقم الهاتف / Phone": "+967 777 000 111",
        "البريد / Email": "alnoor@example.com",
        "الحد الائتماني / CreditLimit": 500000,
        "كود مركز التكلفة / CostCenterCode": "CC-MAIN",
        "كود الحساب المالي / AccountCode": "112190001",
      },
    ];
  } else if (module === "vendors") {
    sampleRows = [
      {
        "كود المورد / VendorCode": "VEND-001",
        "الاسم / Name": "شركة سبأ للمستلزمات",
        "رقم الهاتف / Phone": "+967 771 222 333",
        "الرقم الضريبي / TaxNumber": "TAX-998877",
        "كود مركز التكلفة / CostCenterCode": "CC-MAIN",
        "كود الحساب المالي / AccountCode": "211190001",
      },
    ];
  } else {
    // journal
    sampleRows = [
      {
        "رقم القيد / EntryNumber": "JV-2026-0001",
        "التاريخ / Date": new Date().toISOString().slice(0, 10),
        "كود الحساب / AccountCode": "521101",
        "كود مركز التكلفة / CostCenterCode": "CC-MAIN",
        "كود العملة / CurrencyCode": "YER",
        "سعر الصرف / ExchangeRate": 1,
        "مدين / Debit": 25000,
        "دائن / Credit": 0,
        "البيان / Narration": "شراء وقود ديزل للري",
      },
      {
        "رقم القيد / EntryNumber": "JV-2026-0001",
        "التاريخ / Date": new Date().toISOString().slice(0, 10),
        "كود الحساب / AccountCode": "111101",
        "كود مركز التكلفة / CostCenterCode": "CC-MAIN",
        "كود العملة / CurrencyCode": "YER",
        "سعر الصرف / ExchangeRate": 1,
        "مدين / Debit": 0,
        "دائن / Credit": 25000,
        "البيان / Narration": "صرف نقدي من الصندوق الرئيسي",
      },
    ];
  }

  const ws = createRtlSheet(sampleRows);
  XLSX.utils.book_append_sheet(wb, ws, "Template");
  await saveOrShareWorkbook(wb, filename);
}

export function normalizeExcelRow(rawRow: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = { ...rawRow };

  for (const [key, val] of Object.entries(rawRow)) {
    const cleanKey = key.trim();
    // Split bilingual headers like "اسم العميل / CustomerName"
    const parts = cleanKey.split("/").map((p) => p.trim());
    const enPart = parts.length > 1 ? parts[1] : parts[0];

    // Canonical camelCase conversion of English part
    const camelKey = enPart.charAt(0).toLowerCase() + enPart.slice(1);
    if (!(camelKey in normalized)) {
      normalized[camelKey] = val;
    }

    // Common accounting field aliases & numeric coercions
    const lowerKey = cleanKey.toLowerCase();
    if (lowerKey.includes("customer") || cleanKey.includes("العميل")) {
      if (!("customer" in normalized)) normalized.customer = val;
      if (!("customerName" in normalized)) normalized.customerName = val;
    }
    if (lowerKey.includes("vendor") || cleanKey.includes("المورد")) {
      if (!("vendor" in normalized)) normalized.vendor = val;
      if (!("vendorName" in normalized)) normalized.vendorName = val;
    }
    if (lowerKey.includes("costcenter") || cleanKey.includes("مركز التكلفة")) {
      if (!("costCenterCode" in normalized)) normalized.costCenterCode = val;
      if (!("costCenterId" in normalized)) normalized.costCenterId = val;
    }
    if (lowerKey.includes("currency") || cleanKey.includes("العملة")) {
      if (!("currencyCode" in normalized)) normalized.currencyCode = val;
      if (!("currency" in normalized)) normalized.currency = val;
    }
    if (lowerKey.includes("rate") || cleanKey.includes("سعر الصرف")) {
      if (!("exchangeRate" in normalized)) normalized.exchangeRate = Number(val) || 1;
    }
    if (
      lowerKey.includes("quantity") ||
      lowerKey.includes("bundles") ||
      cleanKey.includes("الكمية") ||
      cleanKey.includes("علاقيات")
    ) {
      if (!("quantity" in normalized)) normalized.quantity = Number(val) || 0;
      if (!("bundles" in normalized)) normalized.bundles = Number(val) || 0;
      if (!("qty" in normalized)) normalized.qty = Number(val) || 0;
    }
    if (lowerKey.includes("unitcode") || cleanKey.includes("كود الوحدة") || cleanKey.includes("الوحدة")) {
      if (!("unitCode" in normalized)) normalized.unitCode = val;
    }
    if (lowerKey.includes("factor") || cleanKey.includes("معامل التحويل") || cleanKey.includes("معامل")) {
      if (!("factorToBase" in normalized)) normalized.factorToBase = Number(val) || 1;
    }
    if (lowerKey.includes("price") || cleanKey.includes("السعر") || cleanKey.includes("قيمة الوحدة")) {
      if (!("unitPrice" in normalized)) normalized.unitPrice = Number(val) || 0;
      if (!("price" in normalized)) normalized.price = Number(val) || 0;
    }
    if (lowerKey.includes("credit") || cleanKey.includes("دائن") || cleanKey.includes("مقبوض") || cleanKey.includes("مدفوع")) {
      if (!("credit" in normalized)) normalized.credit = Number(val) || 0;
      if (!("paidCredit" in normalized)) normalized.paidCredit = Number(val) || 0;
    }
    if (lowerKey.includes("debit") || cleanKey.includes("مدين") || cleanKey.includes("متبقي")) {
      if (!("debit" in normalized)) normalized.debit = Number(val) || 0;
      if (!("remainingDebit" in normalized)) normalized.remainingDebit = Number(val) || 0;
    }
    if (lowerKey.includes("total") || cleanKey.includes("الإجمالي")) {
      if (!("total" in normalized)) normalized.total = Number(val) || 0;
    }
    if (lowerKey.includes("itemcode") || cleanKey.includes("كود الصنف")) {
      if (!("itemCode" in normalized)) normalized.itemCode = val;
      if (!("code" in normalized)) normalized.code = val;
    }
    if (lowerKey.includes("accountcode") || cleanKey.includes("كود الحساب")) {
      if (!("accountCode" in normalized)) normalized.accountCode = val;
    }
    if (lowerKey.includes("entrynumber") || cleanKey.includes("رقم القيد")) {
      if (!("entryNumber" in normalized)) normalized.entryNumber = val;
    }
    if (lowerKey.includes("date") || cleanKey.includes("التاريخ")) {
      if (!("date" in normalized)) normalized.date = val;
    }
    if (lowerKey.includes("notes") || lowerKey.includes("narration") || cleanKey.includes("البيان") || cleanKey.includes("ملاحظات")) {
      if (!("notes" in normalized)) normalized.notes = val;
      if (!("narration" in normalized)) normalized.narration = val;
    }
  }

  return normalized;
}

export function parseExcelImport<T = Record<string, unknown>>(
  fileBuffer: ArrayBuffer | Uint8Array,
  moduleName?: string
): T[] {
  if (moduleName === "__validate_only__" && fileBuffer.byteLength === 0) return [];
  const wb = XLSX.read(fileBuffer, { type: "array" });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];
  const ws = wb.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
  return rawRows.map((r) => normalizeExcelRow(r) as T);
}

