import * as XLSX from "xlsx";
import { computeNetOperatingProfit, computeRemainingStock } from "@/lib/formulas";
import type { UasBootstrapState } from "@/types/uas";

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

  // Sheet 2: Customer Sales
  const filteredSales =
    options?.customerFilter && options.customerFilter !== "ALL"
      ? state.sales.filter((s) => s.customer === options.customerFilter)
      : state.sales;

  const saleRows = filteredSales.map((s) => ({
    "المشروع": projectNameById(s.projectId),
    "القطفة": s.harvest,
    "عملية البيع": s.batch,
    "اسم العميل": s.customer,
    "رقم الهاتف": s.phone,
    "النوع": s.grade,
    "عدد العلاقيات": Number(s.bundles),
    "السعر": Number(s.price),
    "الإجمالي": Number(s.total),
    "دائن (مقبوض)": Number(s.credit),
    "مدين (متبقي)": Number(s.debit),
    "التاريخ": s.date,
    "رقم السند": s.voucherNo,
  }));
  XLSX.utils.book_append_sheet(
    wb,
    createRtlSheet(saleRows, [
      "عدد العلاقيات",
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
    "القطفة": e.harvest,
    "الفئة": e.category,
    "البيان": e.subType,
    "الكمية/اللتر": Number(e.qty),
    "قيمة الوحدة": Number(e.unitPrice),
    "الإجمالي": Number(e.total),
    "التاريخ": e.date,
    "ملاحظات": e.notes,
  }));
  XLSX.utils.book_append_sheet(
    wb,
    createRtlSheet(expRows, ["الكمية/اللتر", "قيمة الوحدة", "الإجمالي"]),
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

  XLSX.writeFile(wb, options?.filename || "UAS_Unified_Accounting_System_Report.xlsx");
}

