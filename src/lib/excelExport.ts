import * as XLSX from "xlsx";
import { computeNetOperatingProfit, computeRemainingStock } from "@/lib/formulas";
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
      for (let r = 1; r <= rows.length; r++) {
        const cellRef = XLSX.utils.encode_cell({ r, c: colIdx });
        const cell = ws[cellRef];
        if (cell && typeof cell.v === "number") {
          cell.z = "#,##0";
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

  const saleRows = filteredSales.map((s) => ({
    "المشروع": projectNameById(s.projectId),
    "القطاع الفرعي": subProjectNameById(s.projectId, s.subProjectId) || "—",
    "مركز التكلفة / Cost Center": (s as any).costCenterCode || (s as any).costCenterId || "—",
    "العملة / Currency": (s as any).currencyCode || (s as any).currency || "YER",
    "سعر الصرف / FX Rate": Number((s as any).exchangeRate || 1),
    "القطفة": s.harvest,
    "رقم العملية التسلسلي": s.sequenceNumber || s.batch,
    "الوردية / الدفعة": s.dailyBatchLabel || s.batch,
    "مسؤول المبيعات": s.salesOfficerTitle || "—",
    "اسم العميل": s.customer,
    "رقم الهاتف": s.phone,
    "النوع / الدرجة": s.grade,
    "الكمية": Number(s.bundles),
    "كود الوحدة / Unit Code": (s as any).unitCode || "BUNDLE",
    "معامل التحويل / Factor": Number((s as any).factorToBase || 1),
    "السعر": Number(s.price),
    "الإجمالي": Number(s.total),
    "دائن (مقبوض)": Number(s.credit),
    "مدين (متبقي)": Number(s.debit),
    "الحساب الإيرادي": s.revenueAccountCode || "411101",
    "الخزينة": s.treasuryName || "—",
    "التاريخ": s.date,
    "رقم السند": s.voucherNo,
  }));
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
  const expRows = state.expenses.map((e) => ({
    "المشروع": projectNameById(e.projectId),
    "القطاع الفرعي": subProjectNameById(e.projectId, e.subProjectId) || "—",
    "مركز التكلفة / Cost Center": (e as any).costCenterCode || (e as any).costCenterId || "—",
    "العملة / Currency": (e as any).currencyCode || (e as any).currency || "YER",
    "سعر الصرف / FX Rate": Number((e as any).exchangeRate || 1),
    "القطفة": e.harvest,
    "الفئة": e.category,
    "البيان": e.subType,
    "الكمية": Number(e.qty),
    "كود الوحدة / Unit Code": (e as any).unitCode || "QTY",
    "معامل التحويل / Factor": Number((e as any).factorToBase || 1),
    "قيمة الوحدة": Number(e.unitPrice),
    "الإجمالي": Number(e.total),
    "التاريخ": e.date,
    "ملاحظات": e.notes,
  }));
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
  const invRows = state.inventoryBatches.map((b) => {
    const soldBundles = state.sales
      .filter((s) => s.projectId === b.projectId && s.harvest === b.harvest && s.grade === b.grade)
      .reduce((acc, s) => acc + (Number(s.bundles) || 0), 0);
    return {
      "المشروع": projectNameById(b.projectId),
      "القطفة": b.harvest,
      "الدرجة": b.grade,
      "المقطوف": Number(b.harvestedBundles),
      "المباع": soldBundles,
      "الفاقد": Number(b.shrinkageBundles),
      "المتبقي": computeRemainingStock(b.harvestedBundles, soldBundles, b.shrinkageBundles),
    };
  });
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

  void saveOrShareWorkbook(wb, options?.filename || "UAS_Unified_Accounting_System_Report.xlsx");
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

  void saveOrShareWorkbook(wb, "UAS_Enterprise_Financial_Statements.xlsx");
}

export type TemplateModule = "sales" | "expenses" | "items" | "customers" | "vendors" | "journal";

export async function exportUasModuleTemplate(module: TemplateModule): Promise<void> {
  const wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] };

  let sampleRows: Record<string, unknown>[] = [];
  let filename = `UAS_Template_${module.toUpperCase()}.xlsx`;

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

export function parseExcelImport<T = Record<string, unknown>>(
  fileBuffer: ArrayBuffer | Uint8Array,
  _moduleName?: string
): T[] {
  const wb = XLSX.read(fileBuffer, { type: "array" });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];
  const ws = wb.Sheets[sheetName];
  return XLSX.utils.sheet_to_json<T>(ws, { defval: "" });
}

