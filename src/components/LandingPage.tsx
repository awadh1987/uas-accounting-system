"use client";
import { isInstalledClientApp } from "@/lib/runtimePlatform";

import React, { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Building2,
  CheckCircle2,
  Coins,
  Download,
  Globe2,
  Layers,
  Lock,
  MapPin,
  MessageCircle,
  Monitor,
  Phone,
  QrCode,
  Search,
  ShieldCheck,
  Smartphone,
  TrendingUp,
  Users,
} from "lucide-react";
import { DualLogoBadge } from "@/components/DualLogoBadge";
import {
  FALLBACK_DOWNLOAD_PACKAGES,
  type DownloadPackageInfo,
} from "@/lib/downloadsTypes";
import { getApiBaseUrl } from "@/lib/apiClient";
import { resolveEffectiveTagline } from "@/lib/branding";
import { fmtNum } from "@/lib/formulas";
import { openExternalOrWhatsApp } from "@/lib/nativeBridge";
import { extractSubdomainSlugFromHost } from "@/lib/tenant/tenantSlug";
import type { LanguageCode, TabId, UasBootstrapState, UasUser } from "@/types/uas";

interface LandingPageProps {
  state: UasBootstrapState;
  lang: LanguageCode;
  currentUser?: UasUser | null;
  onEnterErp: (tab?: TabId) => void;
  onOpenLogin: () => void;
  onOpenClientPortal?: (initialAuthTab?: "login" | "register") => void;
  onToggleLang: () => void;
  onSelectProjectCard?: (projectId: string) => void;
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

const noopSubscribe = () => () => {};
const getClientInstalledSnapshot = () => isInstalledClientApp();
const getServerInstalledSnapshot = () => true;

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
  onOpenClientPortal,
  onToggleLang,
  onSelectProjectCard,
}: LandingPageProps) {
  const profile = state.enterpriseProfile;
  const isAr = lang === "ar";
  const isInstalledApp = useSyncExternalStore(
    noopSubscribe,
    getClientInstalledSnapshot,
    getServerInstalledSnapshot
  );
  const [query, setQuery] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);
  const [publicMetrics, setPublicMetrics] = useState<PublicSummary | null>(null);
  const [downloadPackages, setDownloadPackages] = useState<DownloadPackageInfo[]>(
    FALLBACK_DOWNLOAD_PACKAGES
  );
  const [downloadsVersion, setDownloadsVersion] = useState<string>("1.0.0");
  const [downloadsUpdatedAt, setDownloadsUpdatedAt] = useState<string | null>(null);
  const [tenantPortalInfo, setTenantPortalInfo] = useState<{
    isTenantWorkspace: boolean;
    tenantSlug: string | null;
    tenantUrl: string;
    taglineAr?: string;
    taglineEn?: string;
    welcomeNoticeAr?: string;
    welcomeNoticeEn?: string;
    supportEmail?: string;
  } | null>(() => {
    const hostSlug =
      typeof window !== "undefined" ? extractSubdomainSlugFromHost(window.location.host) : null;
    return hostSlug
      ? {
          isTenantWorkspace: true,
          tenantSlug: hostSlug,
          tenantUrl: `https://${hostSlug}.qat.world`,
        }
      : null;
  });

  useEffect(() => {
    let active = true;
    const hostSlug =
      typeof window !== "undefined" ? extractSubdomainSlugFromHost(window.location.host) : null;

    fetch("/api/public/tenant")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (active && data?.isTenantWorkspace) {
          setTenantPortalInfo({
            isTenantWorkspace: Boolean(data.isTenantWorkspace),
            tenantSlug: data.tenantSlug || hostSlug,
            tenantUrl: data.tenantUrl || (hostSlug ? `https://${hostSlug}.qat.world` : "https://qat.world"),
            taglineAr: data.profile?.taglineAr || "",
            taglineEn: data.profile?.taglineEn || "",
            welcomeNoticeAr: data.profile?.welcomeNoticeAr || "",
            welcomeNoticeEn: data.profile?.welcomeNoticeEn || "",
            supportEmail: data.profile?.supportEmail || "",
          });
        }
      })
      .catch(() => null);

    fetch("/api/public/verify")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (active && data?.metrics) {
          setPublicMetrics(data.metrics as PublicSummary);
        }
      })
      .catch(() => null);

    if (!isInstalledApp) {
      fetch("/api/public/downloads", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (active && Array.isArray(data?.packages) && data.packages.length > 0) {
            setDownloadPackages(data.packages as DownloadPackageInfo[]);
            if (data.version) setDownloadsVersion(String(data.version));
            if (data.updatedAt) setDownloadsUpdatedAt(String(data.updatedAt));
          }
        })
        .catch(() => null);
    }

    return () => {
      active = false;
    };
  }, [isInstalledApp]);

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

  const isTenantBranded = Boolean(
    tenantPortalInfo?.isTenantWorkspace || (profile?.tenantSlug && profile.tenantSlug !== "default")
  );
  const activeTenantSlug = tenantPortalInfo?.tenantSlug || profile?.tenantSlug || null;
  const activeTenantUrl =
    tenantPortalInfo?.tenantUrl ||
    (activeTenantSlug ? `https://${activeTenantSlug}.qat.world` : null);
  const welcomeNotice = isAr
    ? tenantPortalInfo?.welcomeNoticeAr || profile?.welcomeNoticeAr || ""
    : tenantPortalInfo?.welcomeNoticeEn || profile?.welcomeNoticeEn || "";
  const supportEmail = tenantPortalInfo?.supportEmail || profile?.supportEmail || profile?.email || "";

  const legalName = isAr
    ? profile?.legalNameAr?.trim() || "منظومة تخطيط الموارد المحاسبية"
    : profile?.legalNameEn?.trim() || "Enterprise Resource Planning";
  const tagline = resolveEffectiveTagline(
    {
      taglineAr: profile?.taglineAr || tenantPortalInfo?.taglineAr || "",
      taglineEn: profile?.taglineEn || tenantPortalInfo?.taglineEn || "",
    },
    lang
  );

  const ArrowIcon = isAr ? ArrowLeft : ArrowRight;
  const totalSalesFallback = state.sales.reduce((s, x) => s + Number(x.total || 0), 0);

  return (
    <div
      className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
      style={
        profile?.brandColor
          ? ({ "--tenant-accent": profile.brandColor } as React.CSSProperties)
          : undefined
      }
    >
      {isTenantBranded && (
        <div
          className="px-4 py-2 text-center text-[11px] font-bold text-white flex flex-wrap items-center justify-center gap-2"
          style={{ backgroundColor: profile?.brandColor || "#059669" }}
        >
          <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
          <span>
            {isAr
              ? `مساحة عمل معزولة خاصة بالمنشأة: ${legalName}`
              : `Dedicated Tenant Workspace: ${legalName}`}
          </span>
          {activeTenantUrl && (
            <span className="font-mono px-2 py-0.5 rounded bg-black/20" dir="ltr">
              {activeTenantUrl}
            </span>
          )}
          {supportEmail && (
            <span className="font-mono opacity-90" dir="ltr">
              • {supportEmail}
            </span>
          )}
        </div>
      )}
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
              <p className="text-[11px] text-slate-500 dark:text-slate-400 flex flex-wrap items-center gap-2">
                <span>{tagline}</span>
                {profile?.commercialReg && (
                  <>
                    <span>•</span>
                    <span>
                      {isAr ? `سجل تجاري: ${profile.commercialReg}` : `CR: ${profile.commercialReg}`}
                    </span>
                  </>
                )}
                {profile?.taxNumber && (
                  <>
                    <span>•</span>
                    <span>
                      {isAr ? `الرقم الضريبي: ${profile.taxNumber}` : `Tax ID: ${profile.taxNumber}`}
                    </span>
                  </>
                )}
              </p>
            </div>
          </div>

          {/* Top Actions: Downloads + Language Switcher + Sign In Button */}
          <div className="flex items-center gap-2">
            {!isInstalledApp && !isTenantBranded && (
              <>
            <a
              href="/downloads/UAS-Setup-Win64.exe"
              download="UAS-Setup-Win64.exe"
              className="px-3 py-2 rounded-xl border border-indigo-500/40 hover:border-indigo-500 bg-indigo-50/50 dark:bg-indigo-950/30 text-xs font-bold flex items-center gap-1.5 text-indigo-700 dark:text-indigo-300 transition"
              title={isAr ? "تحميل نسخة ويندوز المكتبية والشبكية (UAS-Setup-Win64.exe)" : "Download Windows Desktop / LAN Edition"}
            >
              <Monitor className="w-3.5 h-3.5 text-indigo-600" />
              <span className="hidden sm:inline">{isAr ? "ويندوز (Desktop / LAN)" : "Windows"}</span>
              <span className="sm:hidden">.EXE</span>
            </a>

            <a
              href="/downloads/UAS-Mobile-Release-qat.world.apk"
              download="UAS-Mobile-Release-qat.world.apk"
              className="px-3 py-2 rounded-xl border border-emerald-500/40 hover:border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/30 text-xs font-bold flex items-center gap-1.5 text-emerald-700 dark:text-emerald-300 transition"
              title={isAr ? "تحميل تطبيق Android APK الميداني" : "Download Android APK"}
            >
              <Download className="w-3.5 h-3.5 text-emerald-600" />
              <span className="hidden sm:inline">{isAr ? "تطبيق أندرويد" : "Android"}</span>
              <span className="sm:hidden">APK</span>
            </a>

            <a
              href="#downloads-center"
              className="hidden md:inline-flex px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-bold items-center gap-1.5 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
            >
              <span>{isAr ? "التحميلات" : "Downloads"}</span>
            </a>
              </>
            )}

            <button
              type="button"
              onClick={onToggleLang}
              className="px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-bold flex items-center gap-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 transition text-slate-700 dark:text-slate-300"
            >
              <Globe2 className="w-3.5 h-3.5" />
              <span>{isAr ? "English" : "العربية"}</span>
            </button>

            {onOpenClientPortal ? (
              <button
                type="button"
                onClick={() => onOpenClientPortal("login")}
                className="px-3.5 py-2 rounded-xl border border-emerald-500/50 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 text-xs font-extrabold flex items-center gap-1.5 hover:bg-emerald-100 dark:hover:bg-emerald-950/60 transition"
              >
                <Users className="w-3.5 h-3.5" />
                <span>{isAr ? "بوابة العملاء" : "Client Portal"}</span>
              </button>
            ) : (
              <Link
                href="/portal"
                className="px-3.5 py-2 rounded-xl border border-emerald-500/50 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 text-xs font-extrabold flex items-center gap-1.5 hover:bg-emerald-100 dark:hover:bg-emerald-950/60 transition"
              >
                <Users className="w-3.5 h-3.5" />
                <span>{isAr ? "بوابة العملاء" : "Client Portal"}</span>
              </Link>
            )}

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

            {welcomeNotice && (
              <div className="p-3.5 rounded-2xl border border-emerald-300/70 dark:border-emerald-800 bg-emerald-50/70 dark:bg-emerald-950/30 text-xs font-bold text-emerald-900 dark:text-emerald-200 max-w-2xl">
                {welcomeNotice}
              </div>
            )}

            <div className="pt-2 flex flex-wrap gap-3">
              {currentUser && (
                <button
                  type="button"
                  onClick={() => onEnterErp("dashboard")}
                  className="px-6 py-3.5 rounded-2xl accent-bg text-sm font-black shadow-lg hover:shadow-xl flex items-center gap-2.5 transition"
                >
                  <ArrowIcon className="w-4 h-4" />
                  <span>
                    {isAr
                      ? "الانتقال إلى لوحة العمليات"
                      : "Go to ERP Workspace"}
                  </span>
                </button>
              )}

              {!isInstalledApp && !isTenantBranded && (
                <>
              <a
                href="/downloads/UAS-Setup-Win64.exe"
                download="UAS-Setup-Win64.exe"
                className="px-5 py-3.5 rounded-2xl border border-indigo-500/40 bg-indigo-50/50 dark:bg-indigo-950/30 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 text-sm font-bold shadow-xs flex items-center gap-2 text-indigo-700 dark:text-indigo-300 transition"
              >
                <Monitor className="w-4 h-4 text-indigo-600" />
                <span>{isAr ? "تحميل نسخة ويندوز (Desktop / LAN)" : "Download Windows Setup"}</span>
              </a>

              <a
                href="/downloads/UAS-Mobile-Release-qat.world.apk"
                download="UAS-Mobile-Release-qat.world.apk"
                className="px-5 py-3.5 rounded-2xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-sm font-bold shadow-xs flex items-center gap-2 text-slate-800 dark:text-slate-200 transition"
              >
                <Download className="w-4 h-4 text-emerald-600" />
                <span>{isAr ? "تحميل تطبيق Android APK الميداني" : "Download Android APK"}</span>
              </a>
                </>
              )}
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
            <div className="flex flex-wrap items-center justify-between gap-2 mb-6">
              <div>
                <h3 className="text-lg font-black">
                  {isAr ? "مشاريع المؤسسة الإنتاجية (Enterprise Portfolio)" : "Enterprise Portfolio"}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {isAr
                    ? "انقر على أي مشروع للدخول المباشر إلى جذر المشروع وسجلات عملياته بعد التحقق الأمني"
                    : "Click any project card to access its root workspace context & financial records"}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {state.projects.slice(0, 3).map((proj) => (
                <div
                  key={proj.id}
                  data-testid={`portfolio-project-${proj.id}`}
                  role="button"
                  tabIndex={0}
                  onClick={() =>
                    onSelectProjectCard
                      ? onSelectProjectCard(proj.id)
                      : onEnterErp("projects")
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      if (onSelectProjectCard) onSelectProjectCard(proj.id);
                      else onEnterErp("projects");
                    }
                  }}
                  className="card-surface rounded-2xl p-5 space-y-3 border border-slate-200 dark:border-slate-800 hover:border-emerald-500/70 hover:shadow-lg transition cursor-pointer group focus:outline-none focus:ring-2 focus:ring-emerald-500/40 text-start"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 font-bold text-slate-700 dark:text-slate-300">
                      {proj.code || proj.id.toUpperCase()}
                    </span>
                    <span className="accent-badge px-2.5 py-1 rounded-lg text-[11px] font-bold group-hover:bg-emerald-600 group-hover:text-white transition">
                      {proj.status || "ACTIVE"}
                    </span>
                  </div>
                  <div>
                    <h4 className="font-extrabold text-base group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition">
                      {proj.nameAr || proj.name}
                    </h4>
                    {proj.notes && <p className="text-xs text-slate-500 mt-1 line-clamp-2">{proj.notes}</p>}
                  </div>
                  <div className="flex justify-between items-center text-xs pt-2 border-t border-slate-100 dark:border-slate-800">
                    <span className="text-slate-500">{isAr ? "الموازنة:" : "Budget:"}</span>
                    <span className="font-extrabold text-emerald-600 flex items-center gap-1.5">
                      <span>{fmtNum(proj.budgetTotal ?? proj.estimatedValue)} YER</span>
                      <ArrowIcon className="w-3.5 h-3.5 opacity-60 group-hover:opacity-100 group-hover:translate-x-[-2px] rtl:group-hover:translate-x-[-2px] ltr:group-hover:translate-x-[2px] transition" />
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Tenant Client Portal & Self-Registration Card (Replaces APK/.exe downloads on tenant pages) */}
        {isTenantBranded ? (
          <section
            id="tenant-client-portal"
            data-testid="tenant-client-portal-card"
            className="max-w-7xl mx-auto px-4 sm:px-8 py-10 border-t border-slate-200/80 dark:border-slate-800 space-y-5"
          >
            <div className="card-surface rounded-3xl p-6 sm:p-8 border border-emerald-500/30 bg-gradient-to-br from-emerald-50/60 via-white to-slate-50 dark:from-emerald-950/30 dark:via-slate-900 dark:to-slate-950 shadow-sm space-y-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-2 max-w-2xl">
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 text-[11px] font-black">
                    <Users className="w-3.5 h-3.5 shrink-0" />
                    <span>
                      {isAr
                        ? `بوابة العملاء والطلبات الإلكترونية • ${legalName}`
                        : `Client Portal & Self-Registration • ${legalName}`}
                    </span>
                  </div>
                  <h3 className="text-xl sm:text-2xl font-black tracking-tight">
                    {isAr
                      ? `خدمة عملاء ${legalName} — تسجيل الطلبات وكشوفات الحساب`
                      : `${legalName} Client Portal — Orders, Receipts & Statements`}
                  </h3>
                  <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                    {isAr
                      ? `بوابة مخصصة لعملاء ${legalName} لتسجيل الدخول ومتابعة طلبات البضاعة وإيصالات الاستلام والفواتير وكشف الحساب المباشر، أو التقديم كعميل جديد لتفعيل حسابك والبدء بتسجيل طلباتك أونلاين.`
                      : `Dedicated portal for ${legalName} clients to sign in, submit goods requests, track pickups, view invoices & live account statements, or self-register as a new client.`}
                  </p>
                </div>
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/80 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-[11px] font-mono font-bold text-slate-600 dark:text-slate-300">
                  <Building2 className="w-3.5 h-3.5 text-emerald-600" />
                  <bdi dir="ltr">{activeTenantSlug || "default"}</bdi>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                <div className="rounded-2xl p-4 bg-white/80 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 space-y-1">
                  <div className="font-black text-emerald-700 dark:text-emerald-300">
                    {isAr ? "1. دخول العملاء المسجلين" : "1. Client Sign-In"}
                  </div>
                  <p className="text-slate-500 dark:text-slate-400 leading-relaxed">
                    {isAr
                      ? "سجّل الدخول برقم الجوال أو البريد الإلكتروني لإرسال طلبات الشراء والاستلام، ومتابعة حالة الاعتماد، وطباعة الفواتير."
                      : "Sign in using your registered mobile or email to submit orders and track receipts & statements."}
                  </p>
                </div>
                <div className="rounded-2xl p-4 bg-white/80 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 space-y-1">
                  <div className="font-black text-indigo-700 dark:text-indigo-300">
                    {isAr ? "2. تسجيل عميل جديد" : "2. New Client Registration"}
                  </div>
                  <p className="text-slate-500 dark:text-slate-400 leading-relaxed">
                    {isAr
                      ? "عميل جديد؟ أنشئ حسابك مباشرة برقم جوالك من الهاتف أو يدوياً، وبعد مراجعة واعتماد الإدارة يمكنك رفع الطلبات فوراً."
                      : "New client? Register in seconds with your phone number; once approved by staff, start placing requests."}
                  </p>
                </div>
                <div className="rounded-2xl p-4 bg-white/80 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 space-y-1">
                  <div className="font-black text-slate-700 dark:text-slate-200">
                    {isAr ? "3. دخول مساحة عمل المنشأة" : "3. Staff Workspace Login"}
                  </div>
                  <p className="text-slate-500 dark:text-slate-400 leading-relaxed">
                    {isAr
                      ? "بوابة الموظفين والمحاسبين ومديري النظام لإدارة المبيعات والمخزون واعتماد طلبات بوابة العملاء."
                      : "Authenticated staff portal for accounting, inventory, sales, and Client Portal approvals."}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3 pt-1">
                {onOpenClientPortal ? (
                  <>
                    <button
                      type="button"
                      data-testid="tenant-portal-login-cta"
                      onClick={() => onOpenClientPortal("login")}
                      className="min-h-[44px] px-5 py-2.5 rounded-2xl accent-bg text-xs sm:text-sm font-black inline-flex items-center gap-2 shadow-sm hover:opacity-95 transition"
                    >
                      <Users className="w-4 h-4" />
                      <span>{isAr ? "دخول بوابة العملاء" : "Client Portal Sign In"}</span>
                    </button>
                    <button
                      type="button"
                      data-testid="tenant-portal-register-cta"
                      onClick={() => onOpenClientPortal("register")}
                      className="min-h-[44px] px-5 py-2.5 rounded-2xl border border-emerald-500/50 bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-300 text-xs sm:text-sm font-black inline-flex items-center gap-2 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 transition"
                    >
                      <ArrowLeft className="w-4 h-4" />
                      <span>{isAr ? "تسجيل عميل جديد" : "New Client Registration"}</span>
                    </button>
                  </>
                ) : (
                  <>
                    <Link
                      href="/portal"
                      data-testid="tenant-portal-login-cta"
                      className="min-h-[44px] px-5 py-2.5 rounded-2xl accent-bg text-xs sm:text-sm font-black inline-flex items-center gap-2 shadow-sm hover:opacity-95 transition"
                    >
                      <Users className="w-4 h-4" />
                      <span>{isAr ? "دخول بوابة العملاء" : "Client Portal Sign In"}</span>
                    </Link>
                    <Link
                      href="/portal?tab=register"
                      data-testid="tenant-portal-register-cta"
                      className="min-h-[44px] px-5 py-2.5 rounded-2xl border border-emerald-500/50 bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-300 text-xs sm:text-sm font-black inline-flex items-center gap-2 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 transition"
                    >
                      <ArrowLeft className="w-4 h-4" />
                      <span>{isAr ? "تسجيل عميل جديد" : "New Client Registration"}</span>
                    </Link>
                  </>
                )}

                <button
                  type="button"
                  data-testid="tenant-staff-login-cta"
                  onClick={currentUser ? () => onEnterErp("dashboard") : onOpenLogin}
                  className="min-h-[44px] px-5 py-2.5 rounded-2xl border border-slate-300 dark:border-slate-700 bg-white/90 dark:bg-slate-900 text-xs sm:text-sm font-extrabold inline-flex items-center gap-2 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                >
                  <ShieldCheck className="w-4 h-4 text-slate-600 dark:text-slate-300" />
                  <span>
                    {currentUser
                      ? isAr
                        ? "فتح مساحة العمل"
                        : "Open Staff Workspace"
                      : isAr
                      ? "دخول مساحة العمل"
                      : "Staff Workspace Sign In"}
                  </span>
                </button>
              </div>
            </div>
          </section>
        ) : (
        /* Visitor Downloads Center (Android APK & Windows Desktop/LAN .exe — Root Distribution Only) */
        !isInstalledApp && (
          <section
            id="downloads-center"
            data-testid="public-downloads-section"
            className="max-w-7xl mx-auto px-4 sm:px-8 py-10 border-t border-slate-200/80 dark:border-slate-800 space-y-5"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-lg sm:text-xl font-black flex items-center gap-2">
                  <Download className="w-5 h-5 text-emerald-600 shrink-0" />
                  <span>{isAr ? "التطبيقات والتحميلات الرسمية" : "Official Desktop & Mobile Downloads"}</span>
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {isAr
                    ? "تحميل مباشر دون الحاجة لتسجيل الدخول — حزم أندرويد وويندوز الموثقة مع حجم الملف والإصدار الفعلي"
                    : "Direct public downloads without sign-in required — verified Android APK and Windows installers with live file sizes & version info"}
                </p>
              </div>
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[11px] font-bold text-slate-600 dark:text-slate-300">
                <span>{isAr ? `الإصدار: v${downloadsVersion}` : `Release v${downloadsVersion}`}</span>
                {downloadsUpdatedAt && (
                  <>
                    <span>•</span>
                    <span dir="ltr">{downloadsUpdatedAt.slice(0, 10)}</span>
                  </>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {downloadPackages.map((pkg) => {
                const isAndroid = pkg.platform === "android";
                const updatedDate = pkg.updatedAt ? pkg.updatedAt.slice(0, 10) : null;
                return (
                  <div
                    key={pkg.id}
                    data-testid={`download-card-${pkg.platform}`}
                    className="card-surface rounded-3xl p-5 sm:p-6 border border-slate-200 dark:border-slate-800 flex flex-col justify-between gap-4 shadow-sm hover:border-emerald-500/50 transition"
                  >
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div
                            className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 ${
                              isAndroid
                                ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                                : "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400"
                            }`}
                          >
                            {isAndroid ? <Smartphone className="w-5 h-5" /> : <Monitor className="w-5 h-5" />}
                          </div>
                          <div className="min-w-0">
                            <h4 className="font-black text-sm sm:text-base truncate">
                              {isAr ? pkg.titleAr : pkg.titleEn}
                            </h4>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono truncate" dir="ltr">
                              {pkg.fileName}
                            </p>
                          </div>
                        </div>

                        <span
                          className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase ${
                            pkg.exists
                              ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                              : "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                          }`}
                        >
                          {pkg.exists
                            ? isAr ? "متاح للتحميل" : "Available"
                            : isAr ? "غير مرفوع حالياً" : "Pending Upload"}
                        </span>
                      </div>

                      <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                        {isAr ? pkg.subtitleAr : pkg.subtitleEn}
                      </p>

                      <div className="grid grid-cols-3 gap-2 text-[11px] bg-slate-50 dark:bg-slate-900/70 p-2.5 rounded-2xl border border-slate-200/70 dark:border-slate-800">
                        <div>
                          <div className="text-slate-400">{isAr ? "نوع الملف" : "File Type"}</div>
                          <div className="font-black font-mono uppercase">{pkg.extension}</div>
                        </div>
                        <div>
                          <div className="text-slate-400">{isAr ? "الحجم" : "File Size"}</div>
                          <div className="font-black font-mono" dir="ltr">
                            {pkg.sizeFormatted}
                          </div>
                        </div>
                        <div>
                          <div className="text-slate-400">{isAr ? "الإصدار / التاريخ" : "Version / Date"}</div>
                          <div className="font-bold font-mono truncate" dir="ltr">
                            {updatedDate ? `v${pkg.version} (${updatedDate})` : `v${pkg.version}`}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <a
                        href={pkg.downloadUrl}
                        download={pkg.fileName}
                        data-testid={`download-link-${pkg.platform}`}
                        aria-disabled={!pkg.exists}
                        className={`flex-1 min-h-[44px] px-4 py-2.5 rounded-2xl text-xs sm:text-sm font-black inline-flex items-center justify-center gap-2 transition shadow-sm ${
                          pkg.exists
                            ? isAndroid
                              ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                              : "bg-indigo-600 hover:bg-indigo-700 text-white"
                            : "bg-slate-200 dark:bg-slate-800 text-slate-400 pointer-events-none"
                        }`}
                      >
                        <Download className="w-4 h-4 shrink-0" />
                        <span>
                          {pkg.exists
                            ? isAr
                              ? `تحميل مباشر (${pkg.sizeFormatted})`
                              : `Download Now (${pkg.sizeFormatted})`
                            : isAr
                            ? "غير متاح بعد"
                            : "Not Yet Uploaded"}
                        </span>
                      </a>

                      {pkg.exists && pkg.mirrorDownloadUrl && pkg.mirrorFileName && (
                        <a
                          href={pkg.mirrorDownloadUrl}
                          download={pkg.mirrorFileName}
                          className="min-h-[44px] px-3 py-2 rounded-2xl border border-slate-300 dark:border-slate-700 text-[11px] font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 inline-flex items-center justify-center"
                          title={pkg.mirrorFileName}
                        >
                          {pkg.mirrorFileName}
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )
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
                <button
                  type="button"
                  onClick={() => openExternalOrWhatsApp({ phone: profile.contactWhatsApp })}
                  className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 font-bold hover:bg-emerald-500/20 transition"
                >
                  <MessageCircle className="w-4 h-4 shrink-0" />
                  <span>{isAr ? "واتساب المؤسسة" : "Enterprise WhatsApp"}</span>
                </button>
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
