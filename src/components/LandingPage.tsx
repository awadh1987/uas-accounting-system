"use client";
import { isInstalledClientApp } from "@/lib/runtimePlatform";

import React, { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import {
  Building2,
  CheckCircle2,
  ClipboardList,
  CreditCard,
  Download,
  Globe2,
  Lock,
  MapPin,
  MessageCircle,
  Monitor,
  Phone,
  Plus,
  QrCode,
  Search,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  UserPlus,
  Users,
} from "lucide-react";
import { DualLogoBadge } from "@/components/DualLogoBadge";
import { ThemeSwitcherControl } from "@/components/ThemeSwitcherControl";
import { buildTenantAccentVars } from "@/lib/themeEngine";
import { getApiBaseUrl } from "@/lib/apiClient";
import { resolveEffectiveTagline } from "@/lib/branding";
import { fmtNum } from "@/lib/formulas";
import { openExternalOrWhatsApp } from "@/lib/nativeBridge";
import { extractSubdomainSlugFromHost } from "@/lib/tenant/tenantSlug";
import type { LanguageCode, TabId, ThemeName, UasBootstrapState, UasUser } from "@/types/uas";

export type ClientPortalEntrySection =
  | "catalog"
  | "new_request"
  | "requests"
  | "statement"
  | "profile";

interface LandingPageProps {
  state: UasBootstrapState;
  lang: LanguageCode;
  theme?: ThemeName;
  currentUser?: UasUser | null;
  onEnterErp: (tab?: TabId) => void;
  onOpenLogin: () => void;
  onOpenClientPortal?: (
    initialAuthTab?: "login" | "register",
    initialSection?: ClientPortalEntrySection
  ) => void;
  onToggleLang: () => void;
  onChangeTheme?: (next: ThemeName) => void;
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

const noopSubscribe = () => () => { };
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
  theme = "emerald",
  currentUser,
  onEnterErp,
  onOpenLogin,
  onOpenClientPortal,
  onToggleLang,
  onChangeTheme,
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
  const [activeTenants, setActiveTenants] = useState<
    Array<{ slug: string; nameAr: string; nameEn: string; tenantUrl: string }>
  >([]);
  const [tenantClientCards, setTenantClientCards] = useState<
    Array<{
      id: string;
      displayName: string;
      avatarChar: string;
      avatarColor: string;
      clientType: string;
      loginUrl: string;
    }>
  >([]);
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
        if (!active || !data) return;
        if (Array.isArray(data.activeTenants)) {
          setActiveTenants(data.activeTenants);
        }
        if (Array.isArray(data.clientCards)) {
          setTenantClientCards(data.clientCards);
        }
        if (data.isTenantWorkspace) {
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

  const totalSalesFallback = state.sales.reduce((s, x) => s + Number(x.total || 0), 0);

  return (
    <div
      className="min-h-screen flex flex-col bg-[var(--bg-primary)] text-[var(--text-primary)]"
      style={
        profile?.brandColor
          ? (buildTenantAccentVars(profile.brandColor, theme === "dark" ? "dark" : "light") as React.CSSProperties)
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

              </>
            )}

            {onChangeTheme && (
              <ThemeSwitcherControl
                theme={theme}
                lang={lang}
                compact
                testId="landing-theme-switcher"
                onChangeTheme={onChangeTheme}
              />
            )}

            {!isTenantBranded && (
              <>
                {onOpenClientPortal ? (
                  <button
                    type="button"
                    onClick={() => onOpenClientPortal("login", "new_request")}
                    className="px-3.5 py-2 rounded-xl border border-emerald-500/50 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 text-xs font-extrabold flex items-center gap-1.5 hover:bg-emerald-100 dark:hover:bg-emerald-950/60 transition"
                  >
                    <Users className="w-3.5 h-3.5" />
                    <span>{isAr ? "بوابة العملاء" : "Client Portal"}</span>
                  </button>
                ) : (
                  <Link
                    href="/client/portal/"
                    className="px-3.5 py-2 rounded-xl border border-emerald-500/50 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 text-xs font-extrabold flex items-center gap-1.5 hover:bg-emerald-100 dark:hover:bg-emerald-950/60 transition"
                  >
                    <Users className="w-3.5 h-3.5" />
                    <span>{isAr ? "بوابة العملاء" : "Client Portal"}</span>
                  </Link>
                )}
              </>
            )}

            <button
              type="button"
              onClick={onToggleLang}
              className="px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-bold flex items-center gap-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 transition text-slate-700 dark:text-slate-300 uas-light-btn"
            >
              <Globe2 className="w-3.5 h-3.5" />
              <span>{isAr ? "English" : "العربية"}</span>
            </button>

            <button
              type="button"
              data-testid="root-login-cta"
              onClick={currentUser ? () => onEnterErp("dashboard") : onOpenLogin}
              className="px-4 py-2 rounded-xl accent-bg text-xs font-extrabold shadow-sm flex items-center gap-2 hover:opacity-95 transition uas-light-btn"
            >
              <Lock className="w-3.5 h-3.5" />
              <span>{isAr ? "دخول" : "Sign In"}</span>
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* Focused Hero Section */}
        <section className="max-w-7xl mx-auto px-4 sm:px-8 py-10 sm:py-14 grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
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
                    className={`p-4 rounded-2xl border text-xs space-y-2 ${verifyResult.verified
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

        {/* Prominent Tenant Client Portal Card Above Feature/KPI/Portfolio Sections */}
        {isTenantBranded && (
          <section
            id="tenant-client-portal"
            data-testid="tenant-client-portal-card"
            className="max-w-7xl mx-auto px-4 sm:px-8 pb-10 space-y-5"
          >
            {(() => {
              const isHostSub =
                typeof window !== "undefined" &&
                Boolean(extractSubdomainSlugFromHost(window.location.host));
              const slugQuery =
                !isHostSub && activeTenantSlug && activeTenantSlug !== "default"
                  ? `slug=${encodeURIComponent(activeTenantSlug)}`
                  : "";
              const buildPortalHref = (paramsStr?: string) => {
                const parts = [paramsStr, slugQuery].filter(Boolean);
                return parts.length > 0 ? `/client/portal/?${parts.join("&")}` : "/client/portal/";
              };
              const directoryBtnClass =
                "min-h-[44px] px-4 py-2.5 rounded-2xl border border-emerald-500/40 bg-white dark:bg-slate-900 text-emerald-800 dark:text-emerald-200 text-xs font-extrabold inline-flex items-center justify-center gap-2 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 transition shadow-xs";
              return (
                <div className="card-surface rounded-3xl p-6 sm:p-8 border border-emerald-500/35 bg-gradient-to-br from-emerald-50/70 via-white to-slate-50 dark:from-emerald-950/35 dark:via-slate-900 dark:to-slate-950 shadow-md space-y-6">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="space-y-2 max-w-2xl">
                      <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 text-[11px] font-black">
                        <Users className="w-3.5 h-3.5 shrink-0" />
                        <span>
                          {isAr
                            ? `بوابة العملاء والخدمات الإلكترونية • ${legalName}`
                            : `Client Portal & Service Directory • ${legalName}`}
                        </span>
                      </div>
                      <h3 className="text-xl sm:text-2xl font-black tracking-tight">
                        {isAr
                          ? `بوابة عملاء ${legalName} — الأسعار والطلبات وكشف الحساب`
                          : `${legalName} Client Portal — Catalog, Orders & Statements`}
                      </h3>
                      <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                        {isAr
                          ? `منصة متكاملة لعملاء ${legalName} لتسجيل الدخول أو إنشاء حساب عميل جديد، واستعراض الأسعار والفرز المنشورة، وتسجيل طلبات الاستلام ومتابعتها، ومراجعة الفواتير وكشف الحساب.`
                          : `Dedicated portal for ${legalName} clients to sign in, self-register, browse published pricing & grades, submit and track goods requests, and review invoices & statements.`}
                      </p>
                    </div>
                    <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/80 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-[11px] font-mono font-bold text-slate-600 dark:text-slate-300">
                      <Building2 className="w-3.5 h-3.5 text-emerald-600" />
                      <bdi dir="ltr">{activeTenantSlug || "default"}</bdi>
                    </div>
                  </div>

                  {/* Full Action Directory inside Client Portal Card */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 pt-1">
                    {onOpenClientPortal ? (
                      <>
                        <button
                          type="button"
                          data-testid="tenant-portal-login-cta"
                          onClick={() => onOpenClientPortal("login", "new_request")}
                          className="min-h-[46px] px-4 py-2.5 rounded-2xl accent-bg text-xs sm:text-sm font-black inline-flex items-center justify-center gap-2 shadow-sm hover:opacity-95 transition"
                        >
                          <Users className="w-4 h-4 shrink-0" />
                          <span>{isAr ? "دخول بوابة العملاء" : "Client Portal Sign In"}</span>
                        </button>

                        <button
                          type="button"
                          data-testid="tenant-portal-register-cta"
                          onClick={() => onOpenClientPortal("register", "new_request")}
                          className={directoryBtnClass}
                        >
                          <UserPlus className="w-4 h-4 shrink-0 text-emerald-600" />
                          <span>{isAr ? "تسجيل عميل جديد" : "New Client Registration"}</span>
                        </button>

                        <button
                          type="button"
                          data-testid="tenant-portal-catalog-cta"
                          onClick={() => onOpenClientPortal("login", "catalog")}
                          className={directoryBtnClass}
                        >
                          <Sparkles className="w-4 h-4 shrink-0 text-amber-600" />
                          <span>{isAr ? "الأسعار والفرز" : "Catalog & Pricing"}</span>
                        </button>

                        <button
                          type="button"
                          data-testid="tenant-portal-request-cta"
                          onClick={() => onOpenClientPortal("login", "new_request")}
                          className={directoryBtnClass}
                        >
                          <Plus className="w-4 h-4 shrink-0 text-emerald-600" />
                          <span>{isAr ? "تسجيل طلب" : "New Goods Request"}</span>
                        </button>

                        <button
                          type="button"
                          data-testid="tenant-portal-tracking-cta"
                          onClick={() => onOpenClientPortal("login", "requests")}
                          className={directoryBtnClass}
                        >
                          <ClipboardList className="w-4 h-4 shrink-0 text-indigo-600" />
                          <span>{isAr ? "متابعة الطلبات" : "Track Orders"}</span>
                        </button>

                        <button
                          type="button"
                          data-testid="tenant-portal-statement-cta"
                          onClick={() => onOpenClientPortal("login", "statement")}
                          className={directoryBtnClass}
                        >
                          <CreditCard className="w-4 h-4 shrink-0 text-cyan-600" />
                          <span>{isAr ? "الفواتير وكشف الحساب" : "Invoices & Statement"}</span>
                        </button>
                      </>
                    ) : (
                      <>
                        <Link
                          href={buildPortalHref()}
                          data-testid="tenant-portal-login-cta"
                          className="min-h-[46px] px-4 py-2.5 rounded-2xl accent-bg text-xs sm:text-sm font-black inline-flex items-center justify-center gap-2 shadow-sm hover:opacity-95 transition"
                        >
                          <Users className="w-4 h-4 shrink-0" />
                          <span>{isAr ? "دخول بوابة العملاء" : "Client Portal Sign In"}</span>
                        </Link>

                        <Link
                          href={buildPortalHref("tab=register")}
                          data-testid="tenant-portal-register-cta"
                          className={directoryBtnClass}
                        >
                          <UserPlus className="w-4 h-4 shrink-0 text-emerald-600" />
                          <span>{isAr ? "تسجيل عميل جديد" : "New Client Registration"}</span>
                        </Link>

                        <Link
                          href={buildPortalHref("section=catalog")}
                          data-testid="tenant-portal-catalog-cta"
                          className={directoryBtnClass}
                        >
                          <Sparkles className="w-4 h-4 shrink-0 text-amber-600" />
                          <span>{isAr ? "الأسعار والفرز" : "Catalog & Pricing"}</span>
                        </Link>

                        <Link
                          href={buildPortalHref("section=new_request")}
                          data-testid="tenant-portal-request-cta"
                          className={directoryBtnClass}
                        >
                          <Plus className="w-4 h-4 shrink-0 text-emerald-600" />
                          <span>{isAr ? "تسجيل طلب" : "New Goods Request"}</span>
                        </Link>

                        <Link
                          href={buildPortalHref("section=requests")}
                          data-testid="tenant-portal-tracking-cta"
                          className={directoryBtnClass}
                        >
                          <ClipboardList className="w-4 h-4 shrink-0 text-indigo-600" />
                          <span>{isAr ? "متابعة الطلبات" : "Track Orders"}</span>
                        </Link>

                        <Link
                          href={buildPortalHref("section=statement")}
                          data-testid="tenant-portal-statement-cta"
                          className={directoryBtnClass}
                        >
                          <CreditCard className="w-4 h-4 shrink-0 text-cyan-600" />
                          <span>{isAr ? "الفواتير وكشف الحساب" : "Invoices & Statement"}</span>
                        </Link>
                      </>
                    )}
                  </div>

                  {/* Tenant Client Cards with Direct Login Links */}
                  <div
                    data-testid="tenant-client-cards-section"
                    className="pt-4 border-t border-emerald-200/70 dark:border-emerald-900/50 space-y-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-xs font-black text-emerald-800 dark:text-emerald-200 flex items-center gap-1.5">
                        <Users className="w-4 h-4" />
                        <span>
                          {isAr
                            ? `بطاقات دخول عملاء ${legalName}`
                            : `${legalName} Client Portal Cards`}
                        </span>
                      </div>
                      <Link
                        href={buildPortalHref()}
                        className="text-[11px] font-extrabold text-emerald-700 dark:text-emerald-300 hover:underline"
                      >
                        {isAr ? "فتح بوابة العملاء الكاملة" : "Open Full Portal"}
                      </Link>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                      {tenantClientCards.length > 0
                        ? tenantClientCards.slice(0, 6).map((c) => (
                          <Link
                            key={c.id}
                            href={c.loginUrl || buildPortalHref()}
                            data-testid={`tenant-client-card-${c.id}`}
                            className="p-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-emerald-500 transition flex items-center justify-between gap-2.5 group uas-light-card"
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <span
                                className="w-8 h-8 rounded-xl text-white font-black text-xs flex items-center justify-center shrink-0"
                                style={{ backgroundColor: c.avatarColor || "#059669" }}
                              >
                                {c.avatarChar}
                              </span>
                              <div className="min-w-0">
                                <div className="font-extrabold text-xs truncate">
                                  {c.displayName}
                                </div>
                                <div className="text-[10px] text-slate-500">
                                  {c.clientType === "WHOLESALE"
                                    ? isAr
                                      ? "عميل جملة وتوريد"
                                      : "Wholesale Client"
                                    : isAr
                                      ? "حساب عميل مفعل"
                                      : "Active Client Account"}
                                </div>
                              </div>
                            </div>
                            <span className="px-2.5 py-1 rounded-xl accent-badge text-[10px] font-black shrink-0">
                              {isAr ? "دخول العميل" : "Client Login"}
                            </span>
                          </Link>
                        ))
                        : [
                          {
                            id: "client-wholesale",
                            titleAr: "بوابة عملاء الجملة والتوريد",
                            titleEn: "Wholesale & Trade Clients",
                            href: buildPortalHref(),
                          },
                          {
                            id: "client-retail",
                            titleAr: "العملاء المباشرون وطلبات التجزئة",
                            titleEn: "Direct & Partial Order Clients",
                            href: buildPortalHref("section=catalog"),
                          },
                          {
                            id: "client-register",
                            titleAr: "انضم كعميل جديد للمنشأة",
                            titleEn: "Register New Client Account",
                            href: buildPortalHref("tab=register"),
                          },
                        ].map((card) => (
                          <Link
                            key={card.id}
                            href={card.href}
                            data-testid={`tenant-client-card-${card.id}`}
                            className="p-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-emerald-500 transition flex items-center justify-between gap-2.5 uas-light-card"
                          >
                            <span className="font-extrabold text-xs">
                              {isAr ? card.titleAr : card.titleEn}
                            </span>
                            <span className="px-2.5 py-1 rounded-xl accent-badge text-[10px] font-black shrink-0">
                              {isAr ? "دخول" : "Open"}
                            </span>
                          </Link>
                        ))}
                    </div>
                  </div>

                </div>
              );
            })()}
          </section>
        )}

        {/* Active UAS Tenants Directory (Root apex qat.world only — placed directly above UAS Architecture) */}
        {!isTenantBranded && (
          <section
            data-testid="root-active-tenants-section"
            className="max-w-7xl mx-auto px-4 sm:px-8 pb-10 space-y-5"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-xl font-black">
                  {isAr ? "بوابات المنشآت النشطة (تسجيل الدخول)" : "Active UAS Tenant Workspaces"}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {isAr
                    ? "اختر منشأتك للدخول المباشر إلى مساحة العمل المستقلة وبوابة العملاء الخاصة بها"
                    : "Select a registered organization workspace to sign in directly"}
                </p>
              </div>
              <span className="px-3 py-1 rounded-full accent-badge text-[11px] font-black">
                {activeTenants.length} {isAr ? "منشأة نشطة" : "Active Workspaces"}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {activeTenants.map((tenant) => (
                <a
                  key={tenant.slug}
                  href={tenant.tenantUrl}
                  data-testid={`root-tenant-card-${tenant.slug}`}
                  className="card-surface rounded-2xl p-5 border border-slate-200 dark:border-slate-800 hover:border-emerald-500/70 hover:shadow-lg transition flex flex-col justify-between gap-4 group uas-light-card"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-10 h-10 rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                        <Building2 className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <h4 className="font-black text-sm truncate group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition">
                          {isAr ? tenant.nameAr : tenant.nameEn}
                        </h4>
                        <div className="text-[11px] font-mono text-slate-500 truncate">
                          <bdi dir="ltr">{tenant.tenantUrl}</bdi>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-slate-800 text-xs">
                    <span className="font-mono font-bold text-slate-400">
                      <bdi dir="ltr">{tenant.slug}.qat.world</bdi>
                    </span>
                    <span className="px-3 py-1.5 rounded-xl accent-bg font-black inline-flex items-center gap-1.5">
                      <Lock className="w-3 h-3" />
                      <span>{isAr ? "دخول" : "Sign In"}</span>
                    </span>
                  </div>
                </a>
              ))}
            </div>
          </section>
        )}

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
                  <span>{isAr ? "التواصل المباشر مع المؤسسة" : "Direct Contact"}</span>
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
