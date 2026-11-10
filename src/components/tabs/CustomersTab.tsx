"use client";

import { useMemo, useState } from "react";
import { fmtNum } from "@/lib/formulas";
import type { UasProject, UasSaleTransaction } from "@/types/uas";

interface CustomersTabProps {
  projects: UasProject[];
  sales: UasSaleTransaction[];
  allSales: UasSaleTransaction[];
  onOpenSaleVoucher: (s: UasSaleTransaction) => void;
  onExportCustomerExcel: (customerFilter: string) => void;
}

export function CustomersTab({
  projects,
  sales,
  allSales,
  onOpenSaleVoucher,
  onExportCustomerExcel,
}: CustomersTabProps) {
  const [selectedCustomer, setSelectedCustomer] = useState("ALL");

  const customerNames = useMemo(
    () => Array.from(new Set(allSales.map((s) => s.customer))),
    [allSales]
  );

  const visibleCustomers = customerNames.filter(
    (c) => selectedCustomer === "ALL" || c === selectedCustomer
  );

  const visibleRows = sales.filter(
    (s) => selectedCustomer === "ALL" || s.customer === selectedCustomer
  );

  return (
    <section className="space-y-6">
      <div className="card-surface rounded-2xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-extrabold">
              فواتير العملاء وكشف حساب العميل (Customer Invoices &amp; Account Report)
            </h3>
            <p className="text-xs text-slate-500">
              فرز العملاء وتصدير الكشوفات والفواتير إلى إكسل و بي دي إف
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 no-print">
            <select
              value={selectedCustomer}
              onChange={(e) => setSelectedCustomer(e.target.value)}
              className="rounded-xl border border-slate-300 bg-transparent px-3 py-1.5 text-xs font-bold"
            >
              <option value="ALL">جميع العملاء (All Customers)</option>
              {customerNames.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <button
              onClick={() => onExportCustomerExcel(selectedCustomer)}
              className="px-3.5 py-1.5 rounded-xl accent-bg text-xs font-bold"
            >
              تصدير كشف العملاء Excel
            </button>
            <button
              onClick={() => window.print()}
              className="px-3.5 py-1.5 rounded-xl border border-slate-300 text-xs font-bold"
            >
              طباعة الفاتورة / الكشف PDF
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {visibleCustomers.map((cName) => {
            const rows = allSales.filter((s) => s.customer === cName);
            const phone = rows[0]?.phone || "—";
            const bundles = rows.reduce((a, b) => a + Number(b.bundles), 0);
            const total = rows.reduce((a, b) => a + Number(b.total), 0);
            const credit = rows.reduce((a, b) => a + Number(b.credit), 0);
            const debit = rows.reduce((a, b) => a + Number(b.debit), 0);

            return (
              <div
                key={cName}
                className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-extrabold text-sm">👤 {cName}</h4>
                    <p className="text-xs text-slate-500">
                      رقم الهاتف: {phone} | عدد العمليات: {rows.length}
                    </p>
                  </div>
                  <span className="accent-badge px-2.5 py-1 rounded-lg text-xs font-bold">
                    {fmtNum(bundles)} علاقية
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 pt-2 border-t text-xs">
                  <div>
                    <div className="text-slate-500">إجمالي الفواتير</div>
                    <div className="font-extrabold">{fmtNum(total)} ريال</div>
                  </div>
                  <div>
                    <div className="text-slate-500">دائن (مسدد)</div>
                    <div className="font-extrabold text-emerald-600">{fmtNum(credit)} ريال</div>
                  </div>
                  <div>
                    <div className="text-slate-500">مدين (متبقي عليه)</div>
                    <div className="font-extrabold text-rose-600">{fmtNum(debit)} ريال</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="overflow-x-auto pt-2">
          <table className="w-full text-xs text-right border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-100/70 dark:bg-slate-800/60">
                <th className="p-2.5">اسم العميل</th>
                <th className="p-2.5">رقم الهاتف</th>
                <th className="p-2.5">المشروع / القطفة</th>
                <th className="p-2.5">عملية البيع</th>
                <th className="p-2.5">النوع</th>
                <th className="p-2.5">عدد العلاقيات</th>
                <th className="p-2.5">السعر</th>
                <th className="p-2.5">الإجمالي</th>
                <th className="p-2.5">دائن (مدفوع)</th>
                <th className="p-2.5">مدين (متبقي)</th>
                <th className="p-2.5 no-print">إصدار فاتورة / سند</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {visibleRows.map((s) => {
                const proj = projects.find((p) => p.id === s.projectId);
                return (
                  <tr key={s.id}>
                    <td className="p-2.5 font-bold">{s.customer}</td>
                    <td className="p-2.5">{s.phone}</td>
                    <td className="p-2.5">
                      {proj ? proj.name : ""} — {s.harvest}
                    </td>
                    <td className="p-2.5">{s.batch}</td>
                    <td className="p-2.5">{s.grade}</td>
                    <td className="p-2.5 font-bold">{fmtNum(s.bundles)}</td>
                    <td className="p-2.5">{fmtNum(s.price)}</td>
                    <td className="p-2.5 font-extrabold">{fmtNum(s.total)}</td>
                    <td className="p-2.5 text-emerald-600 font-bold">{fmtNum(s.credit)}</td>
                    <td className="p-2.5 text-rose-600 font-bold">{fmtNum(s.debit)}</td>
                    <td className="p-2.5 no-print">
                      <button
                        onClick={() => onOpenSaleVoucher(s)}
                        className="px-2.5 py-1 rounded-lg accent-bg text-[11px] font-bold"
                      >
                        فاتورة / سند
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

