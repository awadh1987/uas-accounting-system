"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Building2,
  Calendar,
  Check,
  Copy,
  Download,
  ExternalLink,
  FileCode2,
  FileText,
  Globe2,
  KeyRound,
  Loader2,
  Mail,
  MessageSquareShare,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { getStoredSessionToken, safeFetchJson } from "@/lib/apiClient";
import {
  DEFAULT_ROOT_DOMAIN,
  transliterateArabicToAscii,
  validateTenantSlug,
} from "@/lib/tenant/tenantSlug";

export type LicensePlanId = "enterprise" | "pro" | "starter";

export interface IssuedSuperadminLicenseView {
  licenseId: string;
  slug: string;
  companyName: string;
  nameAr: string;
  nameEn: string;
  workspaceUrl: string;
  plan: LicensePlanId | string;
  adminEmail: string;
  adminUsername: string;
  adminPassword: string;
  uaskey: string;
  expiresAt: string;
  issuedAt: string;
  hasUasFile: boolean;
  hasTxtFile: boolean;
}

export interface SuperadminTenantLicenseItem {
  slug: string;
  tenantId: string;
  companyName: string;
  nameAr: string;
  nameEn: string;
  workspaceUrl: string;
  plan: string;
  licenseId: string | null;
  expiresAt: string | null;
  issuedAt: string | null;
  adminEmail: string | null;
  adminUsername: string | null;
  uaskey: string | null;
  maxSeats: number;
  status: string;
  hasUasFile: boolean;
  hasTxtFile: boolean;
  createdAt: string;
  updatedAt: string;
}

interface SuperadminLicenseGeneratorPanelProps {
  lang?: "ar" | "en";
  onToast?: (message: string) => void;
  showStandaloneLink?: boolean;
}

const PLAN_OPTIONS: {
  id: LicensePlanId;
  labelAr: string;
  labelEn: string;
  metaAr: string;
  metaEn: string;
}[] = [
  {
    id: "enterprise",
    labelAr: "المؤسسي (Enterprise)",
    labelEn: "Enterprise",
    metaAr: "7 مستخدمين · 3 فروع · 10 مقاعد LAN",
    metaEn: "7 users · 3 branches · 10 LAN seats",
  },
  {
    id: "pro",
    labelAr: "الاحترافي (Pro)",
    labelEn: "Pro",
    metaAr: "5 مستخدمين · فرعان · 7 مقاعد LAN",
    metaEn: "5 users · 2 branches · 7 LAN seats",
  },
  {
    id: "starter",
    labelAr: "الأساسي (Starter)",
    labelEn: "Starter",
    metaAr: "مستخدمين · فرع واحد · 3 مقاعد LAN",
    metaEn: "2 users · 1 branch · 3 LAN seats",
  },
];

function sanitizeSlugDraft(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 32);
}

function suggestSlugFromCompany(companyName: string): string {
  const ascii = transliterateArabicToAscii(companyName)
    .replace(/[\s_./\\]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/g, "");
  return ascii;
}

async function copyTextSafe(text: string): Promise<boolean> {
  if (!text) return false;
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fallback below
    }
  }
  if (typeof document !== "undefined") {
    try {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(textarea);
      return ok;
    } catch {
      return false;
    }
  }
  return false;
}

function formatDateShort(raw?: string | null): string {
  if (!raw) return "—";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

function formatWhatsAppCredentials(
  issued: IssuedSuperadminLicenseView,
  isAr: boolean
): string {
  if (isAr) {
    return [
      `✅ *بيانات تفعيل منظومة UAS المحاسبية*`,
      `🏢 *المنشأة:* ${issued.companyName}`,
      `🌐 *رابط المساحة السحابية:* ${issued.workspaceUrl}`,
      `📦 *الباقة:* ${issued.plan.toUpperCase()}`,
      `🆔 *رقم الترخيص:* ${issued.licenseId}`,
      `📅 *صالح حتى:* ${formatDateShort(issued.expiresAt)}`,
      ``,
      `👤 *بيانات دخول المدير:*`,
      `• البريد الإلكتروني: ${issued.adminEmail}`,
      `• اسم المستخدم: ${issued.adminUsername}`,
      `• كلمة المرور: ${issued.adminPassword}`,
      ``,
      `🔑 *مفتاح التفعيل (UASKEY):*`,
      issued.uaskey,
    ].join("\n");
  }
  return [
    `✅ *UAS Accounting Activation Credentials*`,
    `🏢 *Company:* ${issued.companyName}`,
    `🌐 *Workspace URL:* ${issued.workspaceUrl}`,
    `📦 *Plan:* ${issued.plan.toUpperCase()}`,
    `🆔 *License ID:* ${issued.licenseId}`,
    `📅 *Expires At:* ${formatDateShort(issued.expiresAt)}`,
    ``,
    `👤 *Admin Login:*`,
    `• Email: ${issued.adminEmail}`,
    `• Username: ${issued.adminUsername}`,
    `• Password: ${issued.adminPassword}`,
    ``,
    `🔑 *Activation Key (UASKEY):*`,
    issued.uaskey,
  ].join("\n");
}

export function SuperadminLicenseGeneratorPanel({
  lang = "ar",
  onToast,
  showStandaloneLink = true,
}: SuperadminLicenseGeneratorPanelProps) {
  const isAr = lang === "ar";
  const dir = isAr ? "rtl" : "ltr";

  const [companyName, setCompanyName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [adminEmail, setAdminEmail] = useState("");
  const [adminEmailTouched, setAdminEmailTouched] = useState(false);
  const [plan, setPlan] = useState<LicensePlanId>("enterprise");
  const [expiresAt, setExpiresAt] = useState("2027-12-31");

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [issuedResult, setIssuedResult] = useState<IssuedSuperadminLicenseView | null>(null);

  const [tenants, setTenants] = useState<SuperadminTenantLicenseItem[]>([]);
  const [loadingTenants, setLoadingTenants] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [downloadingKey, setDownloadingKey] = useState<string | null>(null);

  const notify = useCallback(
    (msg: string) => {
      if (onToast) onToast(msg);
    },
    [onToast]
  );

  const markCopied = useCallback((id: string) => {
    setCopiedId(id);
    setTimeout(() => {
      setCopiedId((prev) => (prev === id ? null : prev));
    }, 2000);
  }, []);

  const loadTenantsRequest = useCallback(async () => {
    return safeFetchJson<{
      success?: boolean;
      tenants?: SuperadminTenantLicenseItem[];
      error?: string;
    }>("/api/superadmin/licenses", {
      cache: "no-store",
      credentials: "include",
    });
  }, []);

  const fetchTenants = useCallback(async () => {
    setLoadingTenants(true);
    setListError(null);
    try {
      const res = await loadTenantsRequest();
      if (!res.ok || !res.data?.success) {
        setListError(
          res.data?.error ||
            (isAr ? "تعذر تحميل سجل التراخيص والمنشآت" : "Failed to load issued licenses")
        );
        return;
      }
      setTenants(Array.isArray(res.data.tenants) ? res.data.tenants : []);
    } finally {
      setLoadingTenants(false);
    }
  }, [isAr, loadTenantsRequest]);

  useEffect(() => {
    let cancelled = false;
    void loadTenantsRequest().then((res) => {
      if (cancelled) return;
      if (!res.ok || !res.data?.success) {
        setListError(
          res.data?.error ||
            "تعذر تحميل سجل التراخيص والمنشآت / Failed to load issued licenses"
        );
        setLoadingTenants(false);
        return;
      }
      setTenants(Array.isArray(res.data.tenants) ? res.data.tenants : []);
      setListError(null);
      setLoadingTenants(false);
    });
    return () => {
      cancelled = true;
    };
  }, [loadTenantsRequest]);

  const slugValidation = useMemo(() => {
    if (!slug) return null;
    return validateTenantSlug(slug);
  }, [slug]);

  const previewUrl = `https://${slug || "your-tenant"}.${DEFAULT_ROOT_DOMAIN}`;

  function handleCompanyChange(val: string) {
    setCompanyName(val);
    if (!slugTouched) {
      const suggested = suggestSlugFromCompany(val);
      setSlug(suggested);
      if (!adminEmailTouched) {
        setAdminEmail(suggested ? `admin@${suggested}.${DEFAULT_ROOT_DOMAIN}` : "");
      }
    }
  }

  function handleSlugChange(val: string) {
    setSlugTouched(true);
    const cleaned = sanitizeSlugDraft(val);
    setSlug(cleaned);
    if (!adminEmailTouched) {
      setAdminEmail(cleaned ? `admin@${cleaned}.${DEFAULT_ROOT_DOMAIN}` : "");
    }
  }

  function handleAdminEmailChange(val: string) {
    setAdminEmailTouched(true);
    setAdminEmail(val);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    const cleanSlug = slug.trim().toLowerCase();
    const check = validateTenantSlug(cleanSlug);
    if (!check.valid) {
      setFormError(
        check.error ||
          (isAr
            ? "النطاق الفرعي غير صالح (3 إلى 32 حرفاً إنجليزياً صغيراً أو أرقاماً أو شرطة)"
            : "Invalid tenant slug")
      );
      return;
    }

    if (!companyName.trim() || companyName.trim().length < 2) {
      setFormError(
        isAr ? "يرجى إدخال اسم المنشأة الكامل" : "Please enter the company name"
      );
      return;
    }

    setSubmitting(true);
    try {
      const res = await safeFetchJson<{
        success?: boolean;
        license?: IssuedSuperadminLicenseView;
        error?: string;
      }>("/api/superadmin/licenses", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          slug: cleanSlug,
          companyName: companyName.trim(),
          adminEmail: adminEmail.trim() || `admin@${cleanSlug}.${DEFAULT_ROOT_DOMAIN}`,
          plan,
          expiresAt: expiresAt.trim() || "2027-12-31",
        }),
      });

      if (!res.ok || !res.data?.success || !res.data.license) {
        const msg =
          res.data?.error ||
          (isAr
            ? "فشل إصدار الترخيص وتهيئة قاعدة بيانات المنشأة"
            : "Failed to issue license and provision tenant");
        setFormError(msg);
        notify(msg);
        return;
      }

      setIssuedResult(res.data.license);
      notify(
        isAr
          ? `✅ تم إصدار الترخيص وتجهيز ${res.data.license.workspaceUrl}`
          : `✅ License issued and tenant provisioned at ${res.data.license.workspaceUrl}`
      );
      await fetchTenants();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCopy(text: string | null | undefined, id: string, label: string) {
    if (!text) {
      notify(isAr ? "المحتوى غير متوفر للنسخ" : "Nothing available to copy");
      return;
    }
    const ok = await copyTextSafe(text);
    if (ok) {
      markCopied(id);
      notify(isAr ? `✅ تم نسخ ${label}` : `✅ Copied ${label}`);
    } else {
      notify(isAr ? "تعذر النسخ التلقائي — يرجى النسخ يدوياً" : "Clipboard copy failed");
    }
  }

  async function handleDownloadFile(targetSlug: string, type: "uas" | "txt") {
    const busyKey = `${targetSlug}:${type}`;
    setDownloadingKey(busyKey);
    try {
      const token = getStoredSessionToken();
      const headers: Record<string, string> = {};
      if (token) {
        headers["x-uas-session-token"] = token;
      }
      const url = `/api/superadmin/licenses/${encodeURIComponent(targetSlug)}/download?type=${type}`;
      const res = await fetch(url, {
        method: "GET",
        credentials: "include",
        headers,
      });

      if (!res.ok) {
        const errPayload = (await res.json().catch(() => ({}))) as { error?: string };
        notify(
          errPayload.error ||
            (isAr ? "تعذر تنزيل ملف الترخيص" : "Failed to download license file")
        );
        return;
      }

      const blob = await res.blob();
      const filename = type === "uas" ? `${targetSlug}.uas` : `${targetSlug}.uaskey.txt`;
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
      notify(isAr ? `⬇️ جاري تنزيل ${filename}` : `⬇️ Downloading ${filename}`);
    } finally {
      setDownloadingKey(null);
    }
  }

  const filteredTenants = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return tenants;
    return tenants.filter(
      (t) =>
        t.slug.toLowerCase().includes(q) ||
        t.companyName.toLowerCase().includes(q) ||
        (t.adminEmail || "").toLowerCase().includes(q) ||
        (t.licenseId || "").toLowerCase().includes(q)
    );
  }, [tenants, searchQuery]);

  return (
    <div dir={dir} className="space-y-5 w-full max-w-full overflow-x-hidden text-xs sm:text-sm">
      {/* Header Banner */}
      <div className="rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-emerald-600/10 via-emerald-500/5 to-transparent p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300 font-black text-sm sm:text-base">
            <ShieldCheck className="w-5 h-5 shrink-0" />
            <span>
              {isAr
                ? "مولد التراخيص وتجهيز المنشآت السحابية (Superadmin)"
                : "Superadmin License Generator & Tenant Provisioner"}
            </span>
          </div>
          <p className="text-[11px] sm:text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
            {isAr
              ? "إصدار مفاتيح Ed25519 الموقعة رقمياً وتهيئة قواعد بيانات PostgreSQL و SQLite المعزولة فورياً من المتصفح."
              : "Issue Ed25519-signed licenses and provision isolated PostgreSQL & SQLite tenant workspaces directly from mobile or desktop."}
          </p>
        </div>

        {showStandaloneLink && (
          <Link
            href="/superadmin/licenses"
            className="inline-flex items-center justify-center gap-2 min-h-[40px] px-3.5 py-2 rounded-xl border border-emerald-500/40 bg-white/80 dark:bg-slate-900/80 text-emerald-700 dark:text-emerald-300 font-bold text-xs hover:bg-emerald-50 dark:hover:bg-emerald-950/50 transition shrink-0"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span>{isAr ? "فتح الصفحة المستقلة" : "Open Dedicated Page"}</span>
          </Link>
        )}
      </div>

      {/* Issuance Form Card */}
      <form
        onSubmit={handleSubmit}
        className="card-surface rounded-2xl border border-slate-200 dark:border-slate-700/80 p-4 sm:p-6 space-y-4"
      >
        <div className="flex items-center gap-2 font-black text-sm border-b border-slate-200 dark:border-slate-700 pb-3">
          <Sparkles className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>
            {isAr ? "إصدار ترخيص وتجهيز منشأة جديدة" : "Issue New Tenant License"}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Company Name */}
          <div className="space-y-1.5">
            <label className="block font-bold text-xs text-slate-700 dark:text-slate-200">
              {isAr ? "اسم المنشأة / الشركة *" : "Company Name *"}
            </label>
            <div className="relative">
              <Building2 className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3 pointer-events-none" />
              <input
                type="text"
                required
                value={companyName}
                onChange={(e) => handleCompanyChange(e.target.value)}
                placeholder={
                  isAr ? "مثال: وكالة الجابري لتجارة القات" : "e.g. Al-Jabri Trading Co."
                }
                className="w-full min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent ps-9 pe-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
          </div>

          {/* Tenant Slug */}
          <div className="space-y-1.5">
            <label className="block font-bold text-xs text-slate-700 dark:text-slate-200">
              {isAr ? "النطاق الفرعي (Tenant Slug) *" : "Tenant Slug *"}
            </label>
            <div className="relative">
              <Globe2 className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3 pointer-events-none" />
              <input
                type="text"
                required
                dir="ltr"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={slug}
                onChange={(e) => handleSlugChange(e.target.value)}
                placeholder="aljabri"
                className="w-full min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent ps-9 pe-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
              <span
                dir="ltr"
                className="inline-flex items-center gap-1 font-mono font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 px-2.5 py-1 rounded-lg break-all"
              >
                {previewUrl}
              </span>
              {slugValidation && !slugValidation.valid && (
                <span className="text-rose-600 dark:text-rose-400 font-semibold">
                  {slugValidation.error}
                </span>
              )}
            </div>
          </div>

          {/* Admin Email */}
          <div className="space-y-1.5">
            <label className="block font-bold text-xs text-slate-700 dark:text-slate-200">
              {isAr ? "بريد مدير المنشأة (اختياري)" : "Admin Email (optional)"}
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3 pointer-events-none" />
              <input
                type="email"
                dir="ltr"
                value={adminEmail}
                onChange={(e) => handleAdminEmailChange(e.target.value)}
                placeholder={`admin@${slug || "tenant"}.${DEFAULT_ROOT_DOMAIN}`}
                className="w-full min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent ps-9 pe-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
          </div>

          {/* Expiry Date */}
          <div className="space-y-1.5">
            <label className="block font-bold text-xs text-slate-700 dark:text-slate-200">
              {isAr ? "تاريخ انتهاء الترخيص" : "Expiry Date"}
            </label>
            <div className="relative">
              <Calendar className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3 pointer-events-none" />
              <input
                type="date"
                dir="ltr"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                className="w-full min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent ps-9 pe-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
          </div>
        </div>

        {/* Plan Selector */}
        <div className="space-y-1.5">
          <label className="block font-bold text-xs text-slate-700 dark:text-slate-200">
            {isAr ? "باقة الترخيص (Plan)" : "License Plan"}
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            {PLAN_OPTIONS.map((opt) => {
              const selected = plan === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setPlan(opt.id)}
                  className={`min-h-[54px] rounded-xl border p-3 text-start transition flex flex-col justify-center gap-0.5 ${
                    selected
                      ? "border-emerald-500 bg-emerald-50/70 dark:bg-emerald-950/40 ring-2 ring-emerald-500/30"
                      : "border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/60"
                  }`}
                >
                  <div className="font-black text-xs flex items-center justify-between gap-2">
                    <span>{isAr ? opt.labelAr : opt.labelEn}</span>
                    {selected && <Check className="w-4 h-4 text-emerald-600 shrink-0" />}
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    {isAr ? opt.metaAr : opt.metaEn}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {formError && (
          <div className="rounded-xl border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 p-3 text-xs text-rose-700 dark:text-rose-300 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{formError}</span>
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full min-h-[48px] rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-black text-sm px-4 py-3 transition flex items-center justify-center gap-2 shadow-sm"
        >
          {submitting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>
                {isAr
                  ? "جاري توقيع الترخيص وتهيئة قواعد البيانات..."
                  : "Signing license & provisioning databases..."}
              </span>
            </>
          ) : (
            <>
              <KeyRound className="w-4 h-4" />
              <span>
                {isAr
                  ? "إصدار الترخيص وتهيئة المنشأة الآن"
                  : "Issue License & Provision Tenant"}
              </span>
            </>
          )}
        </button>
      </form>

      {/* Issued Result Card */}
      {issuedResult && (
        <div className="rounded-2xl border-2 border-emerald-500/60 bg-emerald-50/50 dark:bg-emerald-950/25 p-4 sm:p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-emerald-500/20 pb-3">
            <div className="flex items-center gap-2 font-black text-sm sm:text-base text-emerald-800 dark:text-emerald-300">
              <Check className="w-5 h-5 shrink-0" />
              <span>
                {isAr
                  ? "تم إصدار الترخيص وتجهيز المنشأة بنجاح"
                  : "License Issued & Tenant Provisioned"}
              </span>
            </div>
            <span className="font-mono text-xs font-bold px-2.5 py-1 rounded-lg bg-emerald-600 text-white">
              {issuedResult.licenseId}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
            <div className="rounded-xl bg-white/80 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-700 p-3 space-y-0.5">
              <div className="text-[11px] text-slate-500">{isAr ? "المنشأة" : "Company"}</div>
              <div className="font-bold">{issuedResult.companyName}</div>
            </div>
            <div className="rounded-xl bg-white/80 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-700 p-3 space-y-0.5">
              <div className="text-[11px] text-slate-500">{isAr ? "رابط المساحة" : "Workspace URL"}</div>
              <a
                href={issuedResult.workspaceUrl}
                target="_blank"
                rel="noopener noreferrer"
                dir="ltr"
                className="font-mono font-bold text-emerald-700 dark:text-emerald-300 hover:underline break-all inline-flex items-center gap-1"
              >
                {issuedResult.workspaceUrl}
                <ExternalLink className="w-3 h-3 shrink-0" />
              </a>
            </div>
            <div className="rounded-xl bg-white/80 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-700 p-3 space-y-0.5">
              <div className="text-[11px] text-slate-500">{isAr ? "تاريخ الانتهاء" : "Expires At"}</div>
              <div dir="ltr" className="font-mono font-bold">
                {formatDateShort(issuedResult.expiresAt)}
              </div>
            </div>
            <div className="rounded-xl bg-white/80 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-700 p-3 space-y-0.5">
              <div className="text-[11px] text-slate-500">{isAr ? "بريد المدير" : "Admin Email"}</div>
              <div dir="ltr" className="font-mono font-bold break-all">
                {issuedResult.adminEmail}
              </div>
            </div>
            <div className="rounded-xl bg-white/80 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-700 p-3 space-y-0.5">
              <div className="text-[11px] text-slate-500">{isAr ? "اسم المستخدم" : "Admin Username"}</div>
              <div dir="ltr" className="font-mono font-bold">
                {issuedResult.adminUsername}
              </div>
            </div>
            <div className="rounded-xl bg-white/80 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-700 p-3 space-y-0.5">
              <div className="text-[11px] text-slate-500">{isAr ? "كلمة المرور الأولية" : "Admin Password"}</div>
              <div dir="ltr" className="font-mono font-bold text-amber-700 dark:text-amber-300 break-all">
                {issuedResult.adminPassword || "—"}
              </div>
            </div>
          </div>

          {/* Token preview */}
          <div className="rounded-xl bg-slate-900 text-emerald-300 p-3 space-y-1">
            <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">
              UASKEY Activation Token
            </div>
            <div dir="ltr" className="font-mono text-[11px] break-all max-h-24 overflow-y-auto select-all">
              {issuedResult.uaskey}
            </div>
          </div>

          {/* 4 One-Tap Action Buttons */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
            <button
              type="button"
              onClick={() =>
                handleCopy(
                  issuedResult.uaskey,
                  `result-key-${issuedResult.slug}`,
                  "UASKEY"
                )
              }
              className="min-h-[44px] rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs px-3 py-2.5 flex items-center justify-center gap-2 transition"
            >
              {copiedId === `result-key-${issuedResult.slug}` ? (
                <Check className="w-4 h-4 shrink-0" />
              ) : (
                <Copy className="w-4 h-4 shrink-0" />
              )}
              <span>{isAr ? "نسخ مفتاح UASKEY" : "Copy UASKEY-..."}</span>
            </button>

            <button
              type="button"
              onClick={() =>
                handleCopy(
                  formatWhatsAppCredentials(issuedResult, isAr),
                  `result-creds-${issuedResult.slug}`,
                  isAr ? "بيانات الدخول" : "Login Credentials"
                )
              }
              className="min-h-[44px] rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-slate-700 dark:hover:bg-slate-600 text-white font-bold text-xs px-3 py-2.5 flex items-center justify-center gap-2 transition"
            >
              {copiedId === `result-creds-${issuedResult.slug}` ? (
                <Check className="w-4 h-4 shrink-0" />
              ) : (
                <MessageSquareShare className="w-4 h-4 shrink-0" />
              )}
              <span>
                {isAr
                  ? "نسخ بيانات الدخول (إشعار/إيميل)"
                  : "Copy Credentials (Notice/Email)"}
              </span>
            </button>

            <button
              type="button"
              disabled={downloadingKey === `${issuedResult.slug}:uas`}
              onClick={() => handleDownloadFile(issuedResult.slug, "uas")}
              className="min-h-[44px] rounded-xl border border-emerald-600/40 bg-white dark:bg-slate-900 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 font-bold text-xs px-3 py-2.5 flex items-center justify-center gap-2 transition"
            >
              <Download className="w-4 h-4 shrink-0" />
              <span>{isAr ? "تحميل .uas" : "Download .uas"}</span>
            </button>

            <button
              type="button"
              disabled={downloadingKey === `${issuedResult.slug}:txt`}
              onClick={() => handleDownloadFile(issuedResult.slug, "txt")}
              className="min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 font-bold text-xs px-3 py-2.5 flex items-center justify-center gap-2 transition"
            >
              <FileText className="w-4 h-4 shrink-0" />
              <span>{isAr ? "تحميل .uaskey.txt" : "Download .uaskey.txt"}</span>
            </button>
          </div>
        </div>
      )}

      {/* Existing Issued Tenants */}
      <div className="card-surface rounded-2xl border border-slate-200 dark:border-slate-700/80 p-4 sm:p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-200 dark:border-slate-700 pb-3">
          <div className="flex items-center gap-2 font-black text-sm">
            <FileCode2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>
              {isAr ? "سجل المنشآت والتراخيص الصادرة" : "Issued Tenant Licenses"}
            </span>
            <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
              {tenants.length}
            </span>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:w-64">
              <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3 pointer-events-none" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={isAr ? "بحث بالاسم أو النطاق..." : "Filter by slug or company..."}
                className="w-full min-h-[40px] rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent ps-9 pe-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <button
              type="button"
              onClick={() => fetchTenants()}
              disabled={loadingTenants}
              className="min-h-[40px] min-w-[40px] rounded-xl border border-slate-300 dark:border-slate-700 px-3 flex items-center justify-center hover:bg-slate-100 dark:hover:bg-slate-800 transition"
              title={isAr ? "تحديث" : "Refresh"}
            >
              <RefreshCw className={`w-4 h-4 ${loadingTenants ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>

        {listError && (
          <div className="rounded-xl border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 p-3 text-xs text-rose-700 dark:text-rose-300">
            {listError}
          </div>
        )}

        {loadingTenants && tenants.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-500 flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>{isAr ? "جاري تحميل المنشآت..." : "Loading tenants..."}</span>
          </div>
        ) : filteredTenants.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-500">
            {isAr ? "لا توجد منشآت مطابقة." : "No matching tenant licenses found."}
          </div>
        ) : (
          <>
            {/* Mobile Cards (< md) */}
            <div className="grid grid-cols-1 gap-3 md:hidden">
              {filteredTenants.map((t) => (
                <div
                  key={t.slug}
                  className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white/60 dark:bg-slate-900/50 p-3.5 space-y-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-black text-sm truncate">{t.companyName}</div>
                      <a
                        href={t.workspaceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        dir="ltr"
                        className="font-mono text-[11px] font-bold text-emerald-600 dark:text-emerald-400 break-all hover:underline"
                      >
                        {t.workspaceUrl}
                      </a>
                    </div>
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300 shrink-0">
                      {t.plan}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-600 dark:text-slate-300">
                    <div>
                      <span className="text-slate-400 block">{isAr ? "الانتهاء" : "Expires"}</span>
                      <span dir="ltr" className="font-mono font-semibold">
                        {formatDateShort(t.expiresAt)}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <span className="text-slate-400 block">{isAr ? "البريد" : "Admin Email"}</span>
                      <span dir="ltr" className="font-mono font-semibold truncate block">
                        {t.adminEmail || "—"}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 pt-1">
                    <button
                      type="button"
                      disabled={!t.hasUasFile || downloadingKey === `${t.slug}:uas`}
                      onClick={() => handleDownloadFile(t.slug, "uas")}
                      className="min-h-[40px] rounded-lg border border-slate-300 dark:border-slate-700 px-2 py-1.5 text-[11px] font-bold flex items-center justify-center gap-1 disabled:opacity-40 hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      <Download className="w-3.5 h-3.5 shrink-0" />
                      <span>.uas</span>
                    </button>
                    <button
                      type="button"
                      disabled={!t.hasTxtFile || downloadingKey === `${t.slug}:txt`}
                      onClick={() => handleDownloadFile(t.slug, "txt")}
                      className="min-h-[40px] rounded-lg border border-slate-300 dark:border-slate-700 px-2 py-1.5 text-[11px] font-bold flex items-center justify-center gap-1 disabled:opacity-40 hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      <FileText className="w-3.5 h-3.5 shrink-0" />
                      <span>.txt</span>
                    </button>
                    <button
                      type="button"
                      disabled={!t.uaskey}
                      onClick={() => handleCopy(t.uaskey, `row-${t.slug}`, `${t.slug} UASKEY`)}
                      className="min-h-[40px] rounded-lg bg-emerald-600 text-white px-2 py-1.5 text-[11px] font-bold flex items-center justify-center gap-1 disabled:opacity-40 hover:bg-emerald-700"
                    >
                      {copiedId === `row-${t.slug}` ? (
                        <Check className="w-3.5 h-3.5 shrink-0" />
                      ) : (
                        <Copy className="w-3.5 h-3.5 shrink-0" />
                      )}
                      <span>{isAr ? "نسخ" : "Copy"}</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop Table (>= md) */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-700 text-slate-500 text-start">
                    <th className="py-2.5 px-3 text-start font-bold">
                      {isAr ? "المنشأة والنطاق" : "Company & Workspace"}
                    </th>
                    <th className="py-2.5 px-3 text-start font-bold">
                      {isAr ? "الباقة" : "Plan"}
                    </th>
                    <th className="py-2.5 px-3 text-start font-bold">
                      {isAr ? "بريد المدير" : "Admin Email"}
                    </th>
                    <th className="py-2.5 px-3 text-start font-bold">
                      {isAr ? "الانتهاء" : "Expiry"}
                    </th>
                    <th className="py-2.5 px-3 text-start font-bold">
                      {isAr ? "الملفات" : "Files"}
                    </th>
                    <th className="py-2.5 px-3 text-end font-bold">
                      {isAr ? "الإجراءات" : "Actions"}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800">
                  {filteredTenants.map((t) => (
                    <tr key={t.slug} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                      <td className="py-3 px-3">
                        <div className="font-bold">{t.companyName}</div>
                        <a
                          href={t.workspaceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          dir="ltr"
                          className="font-mono text-[11px] text-emerald-600 dark:text-emerald-400 hover:underline"
                        >
                          {t.workspaceUrl}
                        </a>
                      </td>
                      <td className="py-3 px-3">
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300">
                          {t.plan}
                        </span>
                      </td>
                      <td dir="ltr" className="py-3 px-3 font-mono text-[11px]">
                        {t.adminEmail || "—"}
                      </td>
                      <td dir="ltr" className="py-3 px-3 font-mono text-[11px]">
                        {formatDateShort(t.expiresAt)}
                      </td>
                      <td className="py-3 px-3">
                        <div className="flex items-center gap-1.5 text-[10px] font-mono">
                          <span
                            className={`px-1.5 py-0.5 rounded ${
                              t.hasUasFile
                                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
                                : "bg-slate-100 text-slate-400 dark:bg-slate-800"
                            }`}
                          >
                            .uas
                          </span>
                          <span
                            className={`px-1.5 py-0.5 rounded ${
                              t.hasTxtFile
                                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
                                : "bg-slate-100 text-slate-400 dark:bg-slate-800"
                            }`}
                          >
                            .uaskey.txt
                          </span>
                        </div>
                      </td>
                      <td className="py-3 px-3">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            disabled={!t.hasUasFile || downloadingKey === `${t.slug}:uas`}
                            onClick={() => handleDownloadFile(t.slug, "uas")}
                            className="px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-[11px] font-bold hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 inline-flex items-center gap-1"
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>.uas</span>
                          </button>
                          <button
                            type="button"
                            disabled={!t.hasTxtFile || downloadingKey === `${t.slug}:txt`}
                            onClick={() => handleDownloadFile(t.slug, "txt")}
                            className="px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-[11px] font-bold hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 inline-flex items-center gap-1"
                          >
                            <FileText className="w-3.5 h-3.5" />
                            <span>.txt</span>
                          </button>
                          <button
                            type="button"
                            disabled={!t.uaskey}
                            onClick={() => handleCopy(t.uaskey, `row-${t.slug}`, `${t.slug} UASKEY`)}
                            className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold disabled:opacity-40 inline-flex items-center gap-1"
                          >
                            {copiedId === `row-${t.slug}` ? (
                              <Check className="w-3.5 h-3.5" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                            <span>{isAr ? "نسخ المفتاح" : "Copy Key"}</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
