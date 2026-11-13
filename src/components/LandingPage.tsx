"use client";

import React, { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Building2,
  CheckCircle2,
  Coins,
  Globe2,
  Layers,
  Lock,
  MapPin,
  MessageCircle,
  Phone,
  QrCode,
  Search,
  ShieldCheck,
  TrendingUp,
  Users,
} from "lucide-react";
import { DualLogoBadge } from "@/components/DualLogoBadge";
import { getApiBaseUrl } from "@/lib/apiClient";
import { fmtNum } from "@/lib/formulas";
import type { LanguageCode, TabId, UasBootstrapState, UasUser } from "@/types/uas";

interface LandingPageProps {
  state: UasBootstrapState;
  lang: LanguageCode;
  currentUser?: UasUser | null;
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
  const isAr = lang === "ar";
  const [query, setQuery] = useState("");
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
      const apiBase = getApiBaseUrl();
      const res = await fetch(`${apiBase}/api/public/verify?q=${encodeURIComponent(trimmed)}`, {
        cache: "no-store",
      });
      const data = (await res.json()) as VerifyResult;
      setVerifyResult(data);
    } catch {
      setVerifyResult({
        verified: false,
        message: isAr ? "تعذر الاتصال بخدمة التحقق حالياً" : "Unable to reach verification service",
      });
    } finally {
      setVerifying(false);
    }
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    await runVerifyLookup(query);
  }

  const legalName = isAr
    ? profile?.legalNameAr?.trim() || "منظومة تخطيط الموارد المحاسبية"
    : profile?.legalNameEn?.trim() || "Enterprise Resource Planning";

  const ArrowIcon = isAr ? ArrowLeft : ArrowRight;
  const totalSalesFallback = state.sales.reduce((s, x) => s + Number(x.total || 0), 0);

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      {/* Top Corporate Navigation Bar */}
      <header className="card-surface sticky top-0 z-30 border-b border-slate-200 dark:border-slate-800 px-4 sm:px-8 py-3.5 shadow-sm backdrop-blur-md bg-white/90 dark:bg-slate-900/90">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <DualLogoBadge
              profile={profile}
              logoText={state.settings.logoText}
              size="md"
            />
            <div>
              <h1 className="font-black text-sm sm:text-base leading-tight">
                {legalName}
              </h1>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-2">
                {[
                  profile?.commercialReg
                    ? `${isAr ? "سجل تجاري:" : "CR:"} ${profile.commercialReg}`
                    : null,
                  profile?.taxNumber
                    ? `${isAr ? "الرقم الضريبي:" : "Tax ID:"} ${profile.taxNumber}`
                    : null,
                ]
                  .filter(Boolean)
                  .map((el, i) => (
                    <React.Fragment key={i}>
                      {i > 0 && <span>•</span>}
                      <span>{el}</span>
                    </React.Fragment>
                  ))}
                {!profile?.commercialReg && !profile?.taxNumber && (
                  <span>{isAr ? "منظومة مالية ومحاسبية مؤسسية" : "Enterprise Accounting Platform"}</span>
                )}
              </p>
            </div>
          </div>

          {/* Top Actions: Language Switcher + Single Sign In Button */}
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onToggleLang}
              className="px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-bold flex items-center gap-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 transition text-slate-700 dark:text-slate-300"
            >
              <Globe2 className="w-3.5 h-3.5" />
              <span>{isAr ? "English" : "العربية"}</span>
            </button>

            <button
              type="button"
              onClick={currentUser ? () => onEnterErp("dashboard") : onOpenLogin}
              className="px-4 py-2 rounded-xl accent-bg text-xs font-extrabold shadow-sm flex items-center gap-2 hover:opacity-95 transition"
            >
              <Lock className="w-3.5 h-3.5" />
              <span>
                {currentUser
                  ? isAr
                    ? `دخول مساحة العمل (${currentUser.name})`
                    : `Enter Workspace (${currentUser.name})`
                  : isAr
                  ? "تسجيل الدخول"
                  : "Sign In"}
              </span>
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* Focused Hero Section */}
        <section className="max-w-7xl mx-auto px-4 sm:px-8 py-12 sm:py-16 grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
          <div className={`${profile?.showPublicVerify !== false ? "lg:col-span-7" : "lg:col-span-12 max-w-4xl"} space-y-6`}>
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full accent-badge text-xs font-black">
              <ShieldCheck className="w-4 h-4" />
              <span>
                {isAr
                  ? profile?.heroBadgeAr || "منظومة تخطيط الموارد المحاسبية الموحدة (UAS Enterprise)"
                  : profile?.heroBadgeEn || "Unified Accounting System (UAS Enterprise ERP)"}
              </span>
            </div>

            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-black leading-tight tracking-tight">
              {isAr
                ? profile?.heroTitleAr || "إدارة محاسبية ومالية شاملة للمشاريع وسلاسل الإمداد"
                : profile?.heroTitleEn || "Comprehensive Enterprise Accounting & Supply Chain Platform"}
            </h2>

            <p className="text-sm sm:text-base text-slate-600 dark:text-slate-300 leading-relaxed max-w-2xl">
              {isAr
                ? profile?.heroSubtitleAr ||
                  "نظام مؤسسي متكامل يربط شجرة الحسابات خماسية المستويات بالعمليات والعملاء والموردين بدفتر أستاذ محكم وتقارير فورية وتوثيق إلكتروني."
                : profile?.heroSubtitleEn ||
                  "Integrated double-entry general ledger connecting projects, supply chains, treasury, and partners with immutable audit trails and real-time financial statements."}
            </p>

            <div className="pt-2 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={currentUser ? () => onEnterErp("dashboard") : onOpenLogin}
                className="px-6 py-3.5 rounded-2xl accent-bg text-sm font-black shadow-lg hover:shadow-xl flex items-center gap-2.5 transition"
              >
                <ArrowIcon className="w-4 h-4" />
                <span>
                  {currentUser
                    ? isAr
                      ? "الانتقال إلى لوحة العمليات"
                      : "Go to ERP Workspace"
                    : isAr
                    ? "تسجيل الدخول إلى مساحة العمل"
                    : "Sign In to Workspace"}
                </span>
              </button>
            </div>
          </div>

          {/* Clean Public Voucher QR Verification Box */}
          {profile?.showPublicVerify !== false && (
            <div className="lg:col-span-5">
              <div className="card-surface rounded-3xl p-6 sm:p-7 shadow-xl border border-slate-200 dark:border-slate-800 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                    <QrCode className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="font-black text-base">
                      {isAr ? "التحقق العام من السندات والفواتير" : "Public Document Verification"}
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {isAr
                        ? "تحقق فوري من السندات والفواتير الصادرة برمز QR"
                        : "Verify authenticity of issued vouchers & invoices"}
                    </p>
                  </div>
                </div>

                <form onSubmit={handleVerify} className="flex gap-2">
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    type="text"
                    placeholder={isAr ? "أدخل رقم السند أو الفاتورة..." : "Enter voucher or invoice code..."}
                    className="flex-1 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/50 px-3.5 py-2.5 text-xs font-mono font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                  />
                  <button
                    type="submit"
                    disabled={verifying || !query.trim()}
                    className="px-4 py-2.5 rounded-xl accent-bg text-xs font-extrabold flex items-center gap-1.5 shrink-0 disabled:opacity-50 transition"
                  >
                    <Search className="w-3.5 h-3.5" />
                    <span>{verifying ? "..." : isAr ? "تحقق" : "Verify"}</span>
                  </button>
                </form>

                {verifyResult && (
                  <div
                    className={`p-4 rounded-2xl border text-xs space-y-2 ${
                      verifyResult.verified
                        ? "bg-emerald-50/70 dark:bg-emerald-950/30 border-emerald-300 dark:border-emerald-800"
                        : "bg-rose-50/70 dark:bg-rose-950/30 border-rose-300 dark:border-rose-800"
                    }`}
                  >
                    {verifyResult.verified ? (
                      <>
                        <div className="flex items-center justify-between font-extrabold text-emerald-700 dark:text-emerald-300">
                          <span className="flex items-center gap-1.5">
                            <CheckCircle2 className="w-4 h-4 shrink-0" />
                            {verifyResult.documentType}
                          </span>
                          <span className="font-mono">{verifyResult.reference}</span>
                        </div>
                        <div>
                          <strong className="text-slate-700 dark:text-slate-300">
                            {isAr ? "الطرف / البيان:" : "Party:"}
                          </strong>{" "}
                          {verifyResult.party}
                        </div>
                        <div className="flex justify-between">
                          <span>
                            <strong className="text-slate-700 dark:text-slate-300">
                              {isAr ? "المبلغ:" : "Amount:"}
                            </strong>{" "}
                            {fmtNum(verifyResult.amount)} {verifyResult.currency}
                          </span>
                          <span>
                            <strong className="text-slate-700 dark:text-slate-300">
                              {isAr ? "التاريخ:" : "Date:"}
                            </strong>{" "}
                            {verifyResult.date}
                          </span>
                        </div>
                        {verifyResult.hash && (
                          <div className="font-mono text-[10px] text-slate-500 break-all pt-1 border-t border-emerald-200 dark:border-emerald-800/60">
                            Hash: {verifyResult.hash}
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="font-bold text-rose-700 dark:text-rose-300">
                        {verifyResult.message}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </section>

        {/* Feature Pillars Grid (Global SaaS Standard) */}
        <section className="max-w-7xl mx-auto px-4 sm:px-8 py-8 sm:py-12 border-t border-slate-200/80 dark:border-slate-800">
          <div className="text-center max-w-2xl mx-auto mb-10 space-y-2">
            <h3 className="text-xl sm:text-2xl font-black">
              {isAr ? "ركائز النظام المحاسبي الموحد" : "Enterprise Core Architecture"}
            </h3>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
              {isAr
                ? "بنية تحتية مالية متكاملة مصممة وفق أحدث المعايير المحاسبية الدولية"
                : "Institutional-grade financial infrastructure built on international accounting standards"}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
            {/* Pillar 1 */}
            <div className="card-surface rounded-2xl p-6 space-y-3 border border-slate-200 dark:border-slate-800 hover:border-emerald-500/50 transition">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <h4 className="font-black text-sm">
                {isAr ? "دفتر الأستاذ العام والقيد المزدوج" : "Double-Entry General Ledger"}
              </h4>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                {isAr
                  ? "ترحيل ذري متوازن 100% مع شجرة حسابات قياسية من 5 مستويات وسجل تدقيق غير قابل للتعديل."
                  : "Atomic balanced journal entries with 5-tier Chart of Accounts and immutable audit trail."}
              </p>
            </div>

            {/* Pillar 2 */}
            <div className="card-surface rounded-2xl p-6 space-y-3 border border-slate-200 dark:border-slate-800 hover:border-indigo-500/50 transition">
              <div className="w-10 h-10 rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
                <Layers className="w-5 h-5" />
              </div>
              <h4 className="font-black text-sm">
                {isAr ? "إدارة المشاريع والمخزون" : "Projects & Inventory Control"}
              </h4>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                {isAr
                  ? "تتبع دقيق لدورات الإنتاج والمشاريع والقطفات الزراعية مع مراقبة المستودعات وحركات التوريد."
                  : "Multi-project tracking, harvest production cycles, inventory batches, and supply chain control."}
              </p>
            </div>

            {/* Pillar 3 */}
            <div className="card-surface rounded-2xl p-6 space-y-3 border border-slate-200 dark:border-slate-800 hover:border-amber-500/50 transition">
              <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center">
                <Coins className="w-5 h-5" />
              </div>
              <h4 className="font-black text-sm">
                {isAr ? "الخزينة والعملات المتعددة" : "Treasury & Multi-Currency"}
              </h4>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                {isAr
                  ? "مراقبة الصناديق النقدية والحسابات البنكية مع فروق أسعار الصرف وإصدار السندات والتحصيلات."
                  : "Multi-currency bank & vault management (YER, SAR, USD) with real-time settlement vouchers."}
              </p>
            </div>

            {/* Pillar 4 */}
            <div className="card-surface rounded-2xl p-6 space-y-3 border border-slate-200 dark:border-slate-800 hover:border-cyan-500/50 transition">
              <div className="w-10 h-10 rounded-xl bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 flex items-center justify-center">
                <BarChart3 className="w-5 h-5" />
              </div>
              <h4 className="font-black text-sm">
                {isAr ? "التقارير والقوائم المالية اللحظية" : "Live Financial Statements"}
              </h4>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                {isAr
                  ? "ميزان مراجعة فوري، قائمة الدخل، وقائمة المركز المالي مع إمكانية التصدير إلى Excel و PDF."
                  : "Instant trial balance, income statement, and balance sheet with one-click Excel & PDF export."}
              </p>
            </div>
          </div>
        </section>

        {/* Live Enterprise Track Record (Optional) */}
        {profile?.showPublicMetrics !== false && (
          <section className="max-w-7xl mx-auto px-4 sm:px-8 py-8">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="card-surface rounded-2xl p-5 space-y-1 border border-slate-200 dark:border-slate-800">
                <div className="text-xs font-bold text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                  <Building2 className="w-4 h-4 text-emerald-600" />
                  {isAr ? "المشاريع النشطة" : "Active Projects"}
                </div>
                <div className="text-2xl font-black text-emerald-600">
                  {publicMetrics?.projects ?? state.projects.length}
                </div>
                <div className="text-[11px] text-slate-400 truncate">
                  {isAr ? "مشاريع استثمارية وإنتاجية" : "Operational portfolios"}
                </div>
              </div>

              <div className="card-surface rounded-2xl p-5 space-y-1 border border-slate-200 dark:border-slate-800">
                <div className="text-xs font-bold text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                  <TrendingUp className="w-4 h-4 text-indigo-600" />
                  {isAr ? "إجمالي الأصول المسجلة" : "Ledger Assets"}
                </div>
                <div className="text-2xl font-black text-indigo-600">
                  {fmtNum(publicMetrics?.totalAssets ?? 0)} YER
                </div>
                <div className="text-[11px] text-slate-400">
                  {isAr ? "مطابقة لميزانية متزنة" : "100% Balanced Ledger"}
                </div>
              </div>

              <div className="card-surface rounded-2xl p-5 space-y-1 border border-slate-200 dark:border-slate-800">
                <div className="text-xs font-bold text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                  <Users className="w-4 h-4 text-amber-600" />
                  {isAr ? "الموردون والعملاء" : "Partners & Clients"}
                </div>
                <div className="text-2xl font-black text-amber-600">
                  {(publicMetrics?.vendors ?? 0) + (publicMetrics?.customers ?? 0)}
                </div>
                <div className="text-[11px] text-slate-400">
                  {isAr ? "حسابات تفصيلية معتمدة" : "Subledger Accounts"}
                </div>
              </div>

              <div className="card-surface rounded-2xl p-5 space-y-1 border border-slate-200 dark:border-slate-800">
                <div className="text-xs font-bold text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  {isAr ? "توازن دفتر الأستاذ" : "GL Balance Integrity"}
                </div>
                <div className="text-2xl font-black text-emerald-600">
                  {publicMetrics?.isLedgerBalanced === false ? "CHECK" : "Σ DR = Σ CR"}
                </div>
                <div className="text-[11px] text-slate-400">
                  {fmtNum(publicMetrics?.totalRevenue ?? totalSalesFallback)} YER {isAr ? "إيرادات" : "Revenue"}
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Active Projects Showcase (rendered only when projects actually exist) */}
        {state.projects.length > 0 && (
          <section className="max-w-7xl mx-auto px-4 sm:px-8 py-8 border-t border-slate-200/80 dark:border-slate-800">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-black">
                {isAr ? "مشاريع المؤسسة الإنتاجية" : "Enterprise Portfolio"}
              </h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {state.projects.slice(0, 3).map((proj) => (
                <div key={proj.id} className="card-surface rounded-2xl p-5 space-y-3 border border-slate-200 dark:border-slate-800">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 font-bold">
                      {proj.code || proj.id.toUpperCase()}
                    </span>
                    <span className="accent-badge px-2.5 py-1 rounded-lg text-[11px] font-bold">
                      {proj.status || "ACTIVE"}
                    </span>
                  </div>
                  <div>
                    <h4 className="font-extrabold text-base">{proj.nameAr || proj.name}</h4>
                    {proj.notes && <p className="text-xs text-slate-500 mt-1">{proj.notes}</p>}
                  </div>
                  <div className="flex justify-between text-xs pt-2 border-t border-slate-100 dark:border-slate-800">
                    <span className="text-slate-500">{isAr ? "الموازنة:" : "Budget:"}</span>
                    <span className="font-extrabold text-emerald-600">
                      {fmtNum(proj.budgetTotal ?? proj.estimatedValue)} YER
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Corporate Information Section */}
        <section className="max-w-7xl mx-auto px-4 sm:px-8 py-10 border-t border-slate-200/80 dark:border-slate-800">
          <div className="card-surface rounded-3xl p-6 sm:p-8 grid grid-cols-1 lg:grid-cols-12 gap-6 items-center border border-slate-200 dark:border-slate-800">
            <div className="lg:col-span-7 space-y-2.5">
              <div className="text-xs font-black text-emerald-600 uppercase tracking-wider">
                {isAr ? "عن المؤسسة والمنهج المالي" : "Governance & Enterprise Standards"}
              </div>
              <h3 className="text-xl font-black">
                {legalName}
              </h3>
              <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                {isAr
                  ? profile?.aboutMissionAr ||
                    "منظومة محاسبية وتخطيط موارد مؤسسية متقدمة تلتزم بأعلى معايير الرقابة والشفافية وتكامل العمليات المالية."
                  : profile?.aboutMissionEn ||
                    "Enterprise Resource Planning platform dedicated to rigorous financial governance, transparency, and operational excellence."}
              </p>
            </div>

            <div className="lg:col-span-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-2.5 text-xs">
              {(profile?.contactPhone || profile?.phone) && (
                <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-2xl bg-slate-100/70 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
                  <Phone className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span className="font-bold font-mono" dir="ltr">
                    {profile?.contactPhone || profile?.phone}
                  </span>
                </div>
              )}
              {profile?.contactWhatsApp && (
                <a
                  href={`https://wa.me/${profile.contactWhatsApp.replace(/[^0-9]/g, "")}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 font-bold hover:bg-emerald-500/20 transition"
                >
                  <MessageCircle className="w-4 h-4 shrink-0" />
                  <span>{isAr ? "واتساب المؤسسة" : "Enterprise WhatsApp"}</span>
                </a>
              )}
              {(profile?.contactAddress || profile?.address) && (
                <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-2xl bg-slate-100/70 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
                  <MapPin className="w-4 h-4 text-indigo-600 shrink-0" />
                  <span className="font-medium text-slate-700 dark:text-slate-300">
                    {profile?.contactAddress || profile?.address}
                  </span>
                </div>
              )}
            </div>
          </div>
        </section>
      </main>

      {/* Corporate Footer */}
      <footer className="border-t border-slate-200 dark:border-slate-800 py-6 px-4 text-center text-xs text-slate-500 dark:text-slate-400 space-y-1">
        <p>
          {legalName} — Unified Accounting System (UAS Enterprise ERP)
          {(profile?.contactAddress || profile?.address) ? ` • ${profile?.contactAddress || profile?.address}` : ""}
          {profile?.email ? ` • ${profile.email}` : ""}
        </p>
        <p className="text-[11px] text-slate-400">
          {[
            profile?.commercialReg
              ? `${isAr ? "سجل تجاري رقم:" : "Commercial Registration:"} ${profile.commercialReg}`
              : null,
            profile?.taxNumber
              ? `${isAr ? "الرقم الضريبي:" : "Tax Number:"} ${profile.taxNumber}`
              : null,
          ]
            .filter(Boolean)
            .join(" • ")}
        </p>
      </footer>
    </div>
  );
}
