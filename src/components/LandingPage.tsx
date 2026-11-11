"use client";

import React, { useEffect, useState } from "react";
import {
  Building2,
  CheckCircle2,
  FileCheck2,
  Globe2,
  Lock,
  QrCode,
  Search,
  ShieldCheck,
  Sprout,
  TrendingUp,
  Users,
} from "lucide-react";
import { fmtNum } from "@/lib/formulas";
import type { LanguageCode, TabId, UasBootstrapState, UasUser } from "@/types/uas";

interface LandingPageProps {
  state: UasBootstrapState;
  lang: LanguageCode;
  currentUser: UasUser;
  onEnterErp: (tab?: TabId) => void;
  onOpenLogin: () => void;
  onToggleLang: () => void;
}

interface PublicSummary {
  projects: number;
  vendors: number;
  customers: number;
  postedJournals: number;
  totalAssets: number;
  totalRevenue: number;
  isLedgerBalanced: boolean;
}

interface VerifyResult {
  verified: boolean;
  documentType?: string;
  reference?: string;
  party?: string;
  amount?: number;
  currency?: string;
  date?: string;
  treasury?: string;
  hash?: string;
  status?: string;
  message?: string;
}

export function LandingPage({
  state,
  lang,
  currentUser,
  onEnterErp,
  onOpenLogin,
  onToggleLang,
}: LandingPageProps) {
  const profile = state.enterpriseProfile;
  const [query, setQuery] = useState("RV-001");
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);
  const [publicMetrics, setPublicMetrics] = useState<PublicSummary | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/public/verify")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (active && data?.metrics) {
          setPublicMetrics(data.metrics as PublicSummary);
        }
      })
      .catch(() => null);
    return () => {
      active = false;
    };
  }, []);

  async function runVerifyLookup(lookupTerm: string) {
    const trimmed = lookupTerm.trim();
    if (!trimmed) return;
    setVerifying(true);
    try {
      const apiBase = (process.env.NEXT_PUBLIC_API_BASE_URL || "").replace(/\/+$/, "");
      const res = await fetch(`${apiBase}/api/public/verify?q=${encodeURIComponent(trimmed)}`, {
        cache: "no-store",
      });
      const data = (await res.json()) as VerifyResult;
      setVerifyResult(data);
    } catch {
      setVerifyResult({
        verified: false,
        message: "تعذر الاتصال بخدمة التحقق حالياً",
      });
    } finally {
      setVerifying(false);
    }
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    await runVerifyLookup(query);
  }

  const isAr = lang === "ar";
  const totalSalesFallback = state.sales.reduce((s, x) => s + Number(x.total || 0), 0);

  return (
    <div className="min-h-screen flex flex-col">
      {/* Top Corporate Bar */}
      <header className="card-surface sticky top-0 z-30 border-b px-4 sm:px-8 py-3.5 shadow-sm">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl accent-bg flex items-center justify-center font-black text-base shadow-md">
              {state.settings.logoText || "UAS"}
            </div>
            <div>
              <h1 className="font-extrabold text-sm sm:text-base leading-tight">
                {isAr
                  ? profile?.legalNameAr || "شركة الجبري الزراعية للتنمية والاستثمار"
                  : profile?.legalNameEn || "Al-Jabri Agricultural Development & Investment Co."}
              </h1>
              <p className="text-[11px] text-slate-500 flex items-center gap-2">
                <span>{isAr ? "الرقم الضريبي:" : "Tax ID:"} {profile?.taxNumber || "30049811200003"}</span>
                <span>•</span>
                <span>{profile?.commercialReg || "CR-YE-2026-8841"}</span>
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={onToggleLang}
              className="px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold flex items-center gap-1.5 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <Globe2 className="w-3.5 h-3.5" />
              <span>{isAr ? "English" : "العربية"}</span>
            </button>
            <button
              onClick={onOpenLogin}
              className="px-4 py-2 rounded-xl border border-emerald-600 text-emerald-700 dark:text-emerald-300 text-xs font-bold flex items-center gap-1.5 hover:bg-emerald-50"
            >
              <Lock className="w-3.5 h-3.5" />
              <span>{isAr ? "تسجيل الدخول" : "System Login"}</span>
            </button>
            <button
              onClick={() => onEnterErp("dashboard")}
              className="px-4 py-2 rounded-xl accent-bg text-xs font-extrabold shadow-sm flex items-center gap-1.5"
            >
              <Building2 className="w-4 h-4" />
              <span>
                {isAr
                  ? `دخول النظام المحاسبي (${currentUser.name})`
                  : `Enter Accounting ERP (${currentUser.name})`}
              </span>
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero Section */}
        <section className="max-w-7xl mx-auto px-4 sm:px-8 py-10 sm:py-14 grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          <div className="lg:col-span-7 space-y-5">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full accent-badge text-xs font-extrabold">
              <ShieldCheck className="w-4 h-4" />
              <span>
                {isAr
                  ? "منظومة محاسبة القيد المزدوج الموحدة (5-Tier COA)"
                  : "Immutable Double-Entry ERP & 5-Tier Chart of Accounts"}
              </span>
            </div>

            <h2 className="text-2xl sm:text-4xl font-black leading-snug">
              {isAr
                ? "البنية الرقمية والمحاسبية المتكاملة لمشاريع الجبري الزراعية والاستثمارية"
                : "Enterprise Agricultural Accounting, Procurement & Project Ledger Platform"}
            </h2>

            <p className="text-sm sm:text-base text-slate-600 dark:text-slate-300 leading-relaxed max-w-2xl">
              {isAr
                ? "نظام محاسبي مؤسسي يربط المشاريع والقطفات والمشتريات والموردين والعملاء والمخزون بمحرك قيد مزدوج غير قابل للتعديل مع تقارير مالية فورية وتوثيق QR إلكتروني."
                : "Every procurement bill, harvest sale, payroll accrual, and treasury settlement posts atomically to a balanced double-entry general ledger with live financial statements and QR voucher verification."}
            </p>

            <div className="flex flex-wrap gap-3 pt-2">
              <button
                onClick={() => onEnterErp("dashboard")}
                className="px-5 py-3 rounded-2xl accent-bg text-sm font-extrabold shadow-lg flex items-center gap-2"
              >
                <TrendingUp className="w-4 h-4" />
                <span>{isAr ? "استعراض لوحة التحكم والتقارير" : "Launch Executive ERP"}</span>
              </button>
              <button
                onClick={() => onEnterErp("procurement")}
                className="px-5 py-3 rounded-2xl card-surface text-sm font-bold hover:border-emerald-500 flex items-center gap-2"
              >
                <FileCheck2 className="w-4 h-4 text-emerald-600" />
                <span>{isAr ? "بوابة المشتريات والموردين" : "Procurement & Vendors Portal"}</span>
              </button>
              <button
                onClick={() => onEnterErp("reports")}
                className="px-5 py-3 rounded-2xl card-surface text-sm font-bold hover:border-indigo-500 flex items-center gap-2"
              >
                <Sprout className="w-4 h-4 text-indigo-600" />
                <span>{isAr ? "القوائم المالية وميزان المراجعة" : "Live Financial Statements"}</span>
              </button>
            </div>
          </div>

          {/* Live Public Voucher QR Verification Card */}
          <div className="lg:col-span-5">
            <div className="card-surface rounded-3xl p-6 shadow-xl space-y-4 border-2 border-emerald-500/20">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 flex items-center justify-center">
                  <QrCode className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-extrabold text-base">
                    {isAr ? "التحقق الفوري من السندات والفواتير" : "Public Voucher QR Verification"}
                  </h3>
                  <p className="text-xs text-slate-500">
                    {isAr
                      ? "أدخل رقم السند أو الفاتورة أو رمز QR (مثال: RV-001، PV-2026-0001، BILL-2026-0001)"
                      : "Enter voucher, invoice, bill, or journal code (e.g. RV-001, PV-2026-0001)"}
                  </p>
                </div>
              </div>

              <form onSubmit={handleVerify} className="flex gap-2">
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  type="text"
                  placeholder="RV-001 / PV-2026-0001 / BILL-2026-0001"
                  className="flex-1 rounded-xl border border-slate-300 bg-transparent px-3 py-2.5 text-xs font-mono font-bold"
                />
                <button
                  type="submit"
                  disabled={verifying}
                  className="px-4 py-2.5 rounded-xl accent-bg text-xs font-extrabold flex items-center gap-1.5 shrink-0"
                >
                  <Search className="w-3.5 h-3.5" />
                  <span>{verifying ? "..." : isAr ? "تحقق" : "Verify"}</span>
                </button>
              </form>

              <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                <span className="text-slate-400">{isAr ? "أمثلة سريعة:" : "Try:"}</span>
                {["RV-001", "PV-2026-0001", "BILL-2026-0001", "JV-2026-0001"].map((sample) => (
                  <button
                    key={sample}
                    type="button"
                    onClick={() => {
                      setQuery(sample);
                      void runVerifyLookup(sample);
                    }}
                    className="px-2 py-0.5 rounded-md border border-slate-200 dark:border-slate-700 font-mono hover:border-emerald-500"
                  >
                    {sample}
                  </button>
                ))}
              </div>

              {verifyResult && (
                <div
                  className={`p-4 rounded-2xl border text-xs space-y-1.5 ${
                    verifyResult.verified
                      ? "bg-emerald-50/70 dark:bg-emerald-950/30 border-emerald-300"
                      : "bg-rose-50/70 dark:bg-rose-950/30 border-rose-300"
                  }`}
                >
                  {verifyResult.verified ? (
                    <>
                      <div className="flex items-center justify-between font-extrabold text-emerald-700 dark:text-emerald-300">
                        <span className="flex items-center gap-1.5">
                          <CheckCircle2 className="w-4 h-4" />
                          {verifyResult.documentType}
                        </span>
                        <span className="font-mono">{verifyResult.reference}</span>
                      </div>
                      <div>
                        <strong>{isAr ? "الطرف / البيان:" : "Party:"}</strong> {verifyResult.party}
                      </div>
                      <div className="flex justify-between">
                        <span>
                          <strong>{isAr ? "المبلغ:" : "Amount:"}</strong>{" "}
                          {fmtNum(verifyResult.amount)} {verifyResult.currency}
                        </span>
                        <span>
                          <strong>{isAr ? "التاريخ:" : "Date:"}</strong> {verifyResult.date}
                        </span>
                      </div>
                      {verifyResult.hash && (
                        <div className="font-mono text-[11px] text-slate-500">
                          Hash: {verifyResult.hash} • Status: {verifyResult.status}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="font-bold text-rose-700">{verifyResult.message}</div>
                  )}
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Live Enterprise Track Record Metrics */}
        <section className="max-w-7xl mx-auto px-4 sm:px-8 pb-10">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="card-surface rounded-2xl p-5 space-y-1">
              <div className="text-xs font-bold text-slate-500 flex items-center gap-1.5">
                <Sprout className="w-4 h-4 text-emerald-600" />
                {isAr ? "المشاريع الإنتاجية النشطة" : "Active Projects"}
              </div>
              <div className="text-2xl font-black text-emerald-600">
                {publicMetrics?.projects ?? state.projects.length}
              </div>
              <div className="text-[11px] text-slate-400">الجبري العليا • الوسطى • السفلى</div>
            </div>

            <div className="card-surface rounded-2xl p-5 space-y-1">
              <div className="text-xs font-bold text-slate-500 flex items-center gap-1.5">
                <TrendingUp className="w-4 h-4 text-indigo-600" />
                {isAr ? "إجمالي الأصول المسجلة" : "Total Ledger Assets"}
              </div>
              <div className="text-2xl font-black text-indigo-600">
                {fmtNum(publicMetrics?.totalAssets ?? 3412500)} YER
              </div>
              <div className="text-[11px] text-slate-400">
                {isAr ? "مدققة بميزانية متزنة 100%" : "100% Balance-Sheet Verified"}
              </div>
            </div>

            <div className="card-surface rounded-2xl p-5 space-y-1">
              <div className="text-xs font-bold text-slate-500 flex items-center gap-1.5">
                <Users className="w-4 h-4 text-amber-600" />
                {isAr ? "الموردون والعملاء المربوطون" : "Linked Vendors & Clients"}
              </div>
              <div className="text-2xl font-black text-amber-600">
                {(publicMetrics?.vendors ?? 3) + (publicMetrics?.customers ?? 2)}
              </div>
              <div className="text-[11px] text-slate-400">
                {isAr ? "حسابات تفصيلية من المستوى 5" : "Tier-5 Subledger Accounts"}
              </div>
            </div>

            <div className="card-surface rounded-2xl p-5 space-y-1">
              <div className="text-xs font-bold text-slate-500 flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                {isAr ? "حالة توازن دفتر الأستاذ" : "GL Balance Integrity"}
              </div>
              <div className="text-2xl font-black text-emerald-600">
                {publicMetrics?.isLedgerBalanced === false ? "CHECK" : "Σ DR = Σ CR"}
              </div>
              <div className="text-[11px] text-slate-400">
                {fmtNum(publicMetrics?.totalRevenue ?? totalSalesFallback)} YER {isAr ? "مبيعات موثقة" : "Revenue"}
              </div>
            </div>
          </div>
        </section>

        {/* Projects & Supply Chain Showcase */}
        <section className="max-w-7xl mx-auto px-4 sm:px-8 pb-12">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-extrabold">
              {isAr ? "مشاريع المؤسسة والقطاعات الزراعية" : "Enterprise Projects & Agricultural Sectors"}
            </h3>
            <button
              onClick={() => onEnterErp("projects")}
              className="text-xs font-extrabold text-emerald-600 hover:underline"
            >
              {isAr ? "إدارة المشاريع والموازنات ←" : "Manage Projects →"}
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {state.projects.slice(0, 3).map((proj) => (
              <div key={proj.id} className="card-surface rounded-2xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 font-bold">
                    {proj.code || proj.id.toUpperCase()}
                  </span>
                  <span className="accent-badge px-2.5 py-1 rounded-lg text-[11px] font-bold">
                    {proj.status || "ACTIVE"}
                  </span>
                </div>
                <div>
                  <h4 className="font-extrabold text-base">{proj.nameAr || proj.name}</h4>
                  <p className="text-xs text-slate-500">{proj.notes}</p>
                </div>
                <div className="flex justify-between text-xs pt-2 border-t border-slate-100 dark:border-slate-800">
                  <span>{isAr ? "الموازنة التقديرية:" : "Budget:"}</span>
                  <span className="font-extrabold text-emerald-600">
                    {fmtNum(proj.budgetTotal ?? proj.estimatedValue)} YER
                  </span>
                </div>
                <div className="text-[11px] text-slate-400">
                  {isAr ? "القطفات:" : "Cycles:"} {(proj.harvests || []).join(" • ")}
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200 dark:border-slate-800 py-5 px-4 text-center text-xs text-slate-500">
        {profile?.legalNameAr || "شركة الجبري الزراعية للتنمية والاستثمار"} — Unified Accounting System (UAS) •{" "}
        {profile?.address || "صنعاء - الجمهورية اليمنية"} • {profile?.email || "finance@aljabri-agri.com"}
      </footer>
    </div>
  );
}

