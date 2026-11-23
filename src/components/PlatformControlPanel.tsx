"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Ban,
  Building2,
  Check,
  CheckCircle2,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  FileText,
  History,
  KeyRound,
  Laptop,
  Loader2,
  Monitor,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Sliders,
  UserCheck,
  Users,
  UserX,
  X,
} from "lucide-react";
import { getStoredSessionToken, safeFetchJson } from "@/lib/apiClient";
import {
  DEFAULT_ROOT_DOMAIN,
  transliterateArabicToAscii,
  validateTenantSlug,
} from "@/lib/tenant/tenantSlug";
import type {
  IssuedSuperadminLicenseView,
  LicensePlanId,
} from "@/components/SuperadminLicenseGeneratorPanel";

export interface ControlPanelTenantItem {
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
  effectiveStatus: "active" | "suspended" | "revoked" | "expired";
  governanceReason: string | null;
  rotatedKeysCount: number;
  deviceCount: number;
  activeDeviceCount: number;
  userCount: number;
  activeUserCount: number;
  allowedModes: string[];
  hasUasFile: boolean;
  hasTxtFile: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ControlPanelDeviceItem {
  id: string;
  deviceId: string;
  source: "tenant_device" | "seat_binding" | "both";
  platform: string;
  appVersion: string;
  osVersion: string;
  deviceLabel: string;
  userId: string | null;
  userEmail: string | null;
  userDisplay: string | null;
  lastSeenAt: string;
  ipAddress: string | null;
  status: string;
  syncMode: string;
  pendingCommand: string | null;
  seatActive: boolean | null;
}

export interface ControlPanelUserItem {
  id: string;
  username: string;
  name: string;
  fullName: string;
  displayName: string;
  email: string;
  role: string;
  department: string;
  active: boolean;
  isActive: boolean;
  archivedAt: string | null;
  lastLoginAt: string | null;
  mustChangePassword: boolean;
  sessionRevokedAt: string | null;
  signInBlocked: boolean;
  boundDevices: Array<{
    deviceId: string;
    platform: string;
    label: string;
    status: string;
    lastSeenAt: string;
  }>;
}

export interface RotatedKeyItem {
  licenseId: string;
  slug: string;
  rotatedAt: string;
  graceUntil: string | null;
  immediatelyRevoked: boolean;
  replacedByLicenseId: string;
  actorEmail: string;
  reason?: string;
}

export interface ControlPanelAuditItem {
  id: string;
  timestamp: string;
  actorEmail: string;
  actorRole: string;
  actionType: string;
  targetTenantSlug: string | null;
  targetEntityType: "TENANT" | "LICENSE" | "DEVICE" | "USER";
  targetEntityId: string;
  details: string;
}

interface ConfirmDialogState {
  title: string;
  message: string;
  tone: "danger" | "warning" | "primary";
  requireReason?: boolean;
  reasonLabel?: string;
  onConfirm: (reason: string) => Promise<void>;
}

interface PlatformControlPanelProps {
  lang?: "ar" | "en";
  onToast?: (msg: string) => void;
  showStandaloneLinks?: boolean;
}

function formatDateShort(raw?: string | null): string {
  if (!raw) return "—";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

function formatDateTime(raw?: string | null): string {
  if (!raw) return "—";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toISOString().replace("T", " ").slice(0, 16);
}

async function copySafe(text: string): Promise<boolean> {
  if (!text) return false;
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fallback
    }
  }
  if (typeof document !== "undefined") {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
  return false;
}

function suggestSlug(companyName: string): string {
  return transliterateArabicToAscii(companyName)
    .replace(/[\s_./\\]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/g, "");
}

function StatusBadge({
  status,
  isAr,
}: {
  status: string;
  isAr: boolean;
}) {
  const s = status.toLowerCase();
  if (s === "active") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 whitespace-nowrap">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
        {isAr ? "نشط" : "Active"}
      </span>
    );
  }
  if (s === "suspended") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 whitespace-nowrap">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
        {isAr ? "معلّق" : "Suspended"}
      </span>
    );
  }
  if (s === "revoked") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300 whitespace-nowrap">
        <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
        {isAr ? "ملغى" : "Revoked"}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300 whitespace-nowrap">
      <span className="w-1.5 h-1.5 rounded-full bg-slate-500" />
      {isAr ? "منتهي" : "Expired"}
    </span>
  );
}

function PlatformIcon({ platform }: { platform: string }) {
  const p = platform.toLowerCase();
  if (p === "android") return <Smartphone className="w-4 h-4 text-emerald-600 shrink-0" />;
  if (p === "windows") return <Laptop className="w-4 h-4 text-indigo-600 shrink-0" />;
  return <Monitor className="w-4 h-4 text-sky-600 shrink-0" />;
}

export function PlatformControlPanel({
  lang = "ar",
  onToast,
  showStandaloneLinks = true,
}: PlatformControlPanelProps) {
  const isAr = lang === "ar";
  const dir = isAr ? "rtl" : "ltr";

  const [mainTab, setMainTab] = useState<"tenants" | "issue" | "audit">("tenants");
  const [tenants, setTenants] = useState<ControlPanelTenantItem[]>([]);
  const [loadingTenants, setLoadingTenants] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [planFilter, setPlanFilter] = useState<string>("all");

  // Selected tenant detail
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<"lifecycle" | "devices" | "users" | "history">("lifecycle");
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailTenant, setDetailTenant] = useState<ControlPanelTenantItem | null>(null);
  const [devices, setDevices] = useState<ControlPanelDeviceItem[]>([]);
  const [users, setUsers] = useState<ControlPanelUserItem[]>([]);
  const [rotatedKeys, setRotatedKeys] = useState<RotatedKeyItem[]>([]);
  const [tenantAuditLogs, setTenantAuditLogs] = useState<ControlPanelAuditItem[]>([]);

  // Lifecycle config form state
  const [editPlan, setEditPlan] = useState<LicensePlanId>("enterprise");
  const [editMaxSeats, setEditMaxSeats] = useState("7");
  const [editExpiresAt, setEditExpiresAt] = useState("2027-12-31");
  const [rotateGraceHours, setRotateGraceHours] = useState("0");
  const [rotateImmediateRevoke, setRotateImmediateRevoke] = useState(true);
  const [rotateResetAdminPass, setRotateResetAdminPass] = useState(false);
  const [rotatedResult, setRotatedResult] = useState<IssuedSuperadminLicenseView | null>(null);

  // Temp password banner on user password reset
  const [tempPasswordBanner, setTempPasswordBanner] = useState<{
    email: string;
    password: string;
  } | null>(null);

  // New tenant issuance form
  const [newCompanyName, setNewCompanyName] = useState("");
  const [newSlug, setNewSlug] = useState("");
  const [newSlugTouched, setNewSlugTouched] = useState(false);
  const [newAdminEmail, setNewAdminEmail] = useState("");
  const [newAdminEmailTouched, setNewAdminEmailTouched] = useState(false);
  const [newPlan, setNewPlan] = useState<LicensePlanId>("enterprise");
  const [newExpiresAt, setNewExpiresAt] = useState("2027-12-31");
  const [issuing, setIssuing] = useState(false);
  const [issuedResult, setIssuedResult] = useState<IssuedSuperadminLicenseView | null>(null);

  // Platform audit feed
  const [platformAuditLogs, setPlatformAuditLogs] = useState<ControlPanelAuditItem[]>([]);
  const [auditSearch, setAuditSearch] = useState("");
  const [auditEntityFilter, setAuditEntityFilter] = useState("ALL");
  const [loadingAudit, setLoadingAudit] = useState(false);

  // Confirm modal & busy state
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const [confirmReason, setConfirmReason] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const notify = useCallback(
    (msg: string) => {
      onToast?.(msg);
    },
    [onToast]
  );

  const handleCopy = useCallback(
    async (text: string | null | undefined, id: string, label: string) => {
      if (!text) return;
      const ok = await copySafe(text);
      if (ok) {
        setCopiedId(id);
        setTimeout(() => setCopiedId((p) => (p === id ? null : p)), 2000);
        notify(isAr ? `✅ تم نسخ ${label}` : `✅ Copied ${label}`);
      } else {
        notify(isAr ? "تعذر النسخ التلقائي" : "Copy failed");
      }
    },
    [isAr, notify]
  );

  const fetchTenantsRequest = useCallback(async () => {
    return safeFetchJson<{
      success?: boolean;
      tenants?: ControlPanelTenantItem[];
      error?: string;
    }>("/api/control-panel/tenants", {
      cache: "no-store",
      credentials: "include",
    });
  }, []);

  const loadTenants = useCallback(async () => {
    setLoadingTenants(true);
    setListError(null);
    try {
      const res = await fetchTenantsRequest();
      if (!res.ok || !res.data?.success) {
        setListError(
          res.data?.error ||
            (isAr ? "تعذر تحميل بيانات لوحة التحكم" : "Failed to load control panel tenants")
        );
        return;
      }
      setTenants(Array.isArray(res.data.tenants) ? res.data.tenants : []);
    } finally {
      setLoadingTenants(false);
    }
  }, [fetchTenantsRequest, isAr]);

  const loadTenantDetail = useCallback(
    async (slug: string) => {
      setLoadingDetail(true);
      try {
        const res = await safeFetchJson<{
          success?: boolean;
          tenant?: ControlPanelTenantItem;
          devices?: ControlPanelDeviceItem[];
          users?: ControlPanelUserItem[];
          rotatedKeys?: RotatedKeyItem[];
          auditLogs?: ControlPanelAuditItem[];
          error?: string;
        }>(`/api/control-panel/tenants/${encodeURIComponent(slug)}`, {
          cache: "no-store",
          credentials: "include",
        });
        if (!res.ok || !res.data?.success || !res.data.tenant) {
          notify(res.data?.error || (isAr ? "تعذر تحميل تفاصيل المنشأة" : "Failed to load tenant"));
          return;
        }
        const t = res.data.tenant;
        setDetailTenant(t);
        setDevices(res.data.devices || []);
        setUsers(res.data.users || []);
        setRotatedKeys(res.data.rotatedKeys || []);
        setTenantAuditLogs(res.data.auditLogs || []);
        setEditPlan(
          (["enterprise", "pro", "starter"].includes(t.plan) ? t.plan : "enterprise") as LicensePlanId
        );
        setEditMaxSeats(String(t.maxSeats || 7));
        setEditExpiresAt(formatDateShort(t.expiresAt) !== "—" ? formatDateShort(t.expiresAt) : "2027-12-31");
      } finally {
        setLoadingDetail(false);
      }
    },
    [isAr, notify]
  );

  const fetchAuditRequest = useCallback(async () => {
    const qs = new URLSearchParams();
    if (auditEntityFilter !== "ALL") qs.set("entityType", auditEntityFilter);
    if (auditSearch.trim()) qs.set("search", auditSearch.trim());
    return safeFetchJson<{
      success?: boolean;
      auditLogs?: ControlPanelAuditItem[];
    }>(`/api/control-panel/audit?${qs.toString()}`, {
      cache: "no-store",
      credentials: "include",
    });
  }, [auditEntityFilter, auditSearch]);

  const loadPlatformAudit = useCallback(async () => {
    setLoadingAudit(true);
    try {
      const res = await fetchAuditRequest();
      if (res.ok && res.data?.success) {
        setPlatformAuditLogs(res.data.auditLogs || []);
      }
    } finally {
      setLoadingAudit(false);
    }
  }, [fetchAuditRequest]);

  useEffect(() => {
    let cancelled = false;
    void fetchTenantsRequest().then((res) => {
      if (cancelled) return;
      if (!res.ok || !res.data?.success) {
        setListError(
          res.data?.error ||
            "تعذر تحميل بيانات لوحة التحكم / Failed to load control panel tenants"
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
  }, [fetchTenantsRequest]);

  useEffect(() => {
    if (mainTab !== "audit") return;
    let cancelled = false;
    void fetchAuditRequest().then((res) => {
      if (cancelled) return;
      if (res.ok && res.data?.success) {
        setPlatformAuditLogs(res.data.auditLogs || []);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [mainTab, fetchAuditRequest]);

  const filteredTenants = useMemo(() => {
    return tenants.filter((t) => {
      if (statusFilter !== "all" && t.effectiveStatus !== statusFilter) return false;
      if (planFilter !== "all" && t.plan.toLowerCase() !== planFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        return (
          t.slug.toLowerCase().includes(q) ||
          t.companyName.toLowerCase().includes(q) ||
          (t.adminEmail || "").toLowerCase().includes(q) ||
          (t.licenseId || "").toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [tenants, statusFilter, planFilter, searchQuery]);

  const stats = useMemo(() => {
    return {
      total: tenants.length,
      active: tenants.filter((t) => t.effectiveStatus === "active").length,
      blocked: tenants.filter((t) => t.effectiveStatus !== "active").length,
      devices: tenants.reduce((acc, t) => acc + t.deviceCount, 0),
      users: tenants.reduce((acc, t) => acc + t.userCount, 0),
    };
  }, [tenants]);

  async function handleDownload(slug: string, type: "uas" | "txt") {
    const token = getStoredSessionToken();
    const headers: Record<string, string> = {};
    if (token) headers["x-uas-session-token"] = token;
    const res = await fetch(
      `/api/control-panel/tenants/${encodeURIComponent(slug)}/download?type=${type}`,
      { credentials: "include", headers }
    );
    if (!res.ok) {
      notify(isAr ? "تعذر تنزيل الملف" : "Download failed");
      return;
    }
    const blob = await res.blob();
    const filename = type === "uas" ? `${slug}.uas` : `${slug}.uaskey.txt`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function openConfirm(cfg: ConfirmDialogState) {
    setConfirmReason("");
    setConfirmDialog(cfg);
  }

  async function runConfirmedAction() {
    if (!confirmDialog) return;
    setActionBusy(true);
    try {
      await confirmDialog.onConfirm(confirmReason.trim());
      setConfirmDialog(null);
      setConfirmReason("");
    } finally {
      setActionBusy(false);
    }
  }

  async function executeTenantLifecycle(
    slug: string,
    payload: Record<string, unknown>,
    successMsg: string
  ) {
    const res = await safeFetchJson<{ success?: boolean; error?: string }>(
      `/api/control-panel/tenants/${encodeURIComponent(slug)}`,
      {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    if (!res.ok || !res.data?.success) {
      notify(res.data?.error || (isAr ? "فشل تحديث حالة المنشأة" : "Failed to update tenant"));
      return;
    }
    notify(successMsg);
    await Promise.all([loadTenants(), loadTenantDetail(slug)]);
  }

  async function executeKeyRotation(slug: string, reason: string) {
    const res = await safeFetchJson<{
      success?: boolean;
      license?: IssuedSuperadminLicenseView;
      error?: string;
    }>(`/api/control-panel/tenants/${encodeURIComponent(slug)}/rotate`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        plan: editPlan,
        maxSeats: Number(editMaxSeats) || 7,
        expiresAt: editExpiresAt,
        revokePriorKeyImmediately: rotateImmediateRevoke,
        graceHours: rotateImmediateRevoke ? 0 : Number(rotateGraceHours) || 24,
        resetAdminPassword: rotateResetAdminPass,
        reason,
      }),
    });
    if (!res.ok || !res.data?.success || !res.data.license) {
      notify(res.data?.error || (isAr ? "فشل تدوير المفتاح" : "Key rotation failed"));
      return;
    }
    setRotatedResult(res.data.license);
    notify(
      isAr
        ? `✅ تم إصدار مفتاح جديد (${res.data.license.licenseId})`
        : `✅ Rotated license key (${res.data.license.licenseId})`
    );
    await Promise.all([loadTenants(), loadTenantDetail(slug)]);
  }

  async function executeDeviceAction(
    slug: string,
    deviceId: string,
    action: "approve" | "suspend" | "revoke" | "reset",
    reason: string
  ) {
    const res = await safeFetchJson<{ success?: boolean; error?: string }>(
      `/api/control-panel/tenants/${encodeURIComponent(slug)}/devices/${encodeURIComponent(deviceId)}`,
      {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reason }),
      }
    );
    if (!res.ok || !res.data?.success) {
      notify(res.data?.error || (isAr ? "فشل تحديث الجهاز" : "Device action failed"));
      return;
    }
    notify(isAr ? "✅ تم تحديث حالة الجهاز" : "✅ Device updated");
    await Promise.all([loadTenants(), loadTenantDetail(slug)]);
  }

  async function executeUserAction(
    slug: string,
    user: ControlPanelUserItem,
    action: "revoke_access" | "reactivate" | "reset_password",
    reason: string
  ) {
    const res = await safeFetchJson<{
      success?: boolean;
      temporaryPassword?: string;
      error?: string;
    }>(
      `/api/control-panel/tenants/${encodeURIComponent(slug)}/users/${encodeURIComponent(user.id)}`,
      {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reason }),
      }
    );
    if (!res.ok || !res.data?.success) {
      notify(res.data?.error || (isAr ? "فشل تنفيذ الإجراء على المستخدم" : "User action failed"));
      return;
    }
    if (res.data.temporaryPassword) {
      setTempPasswordBanner({
        email: user.email,
        password: res.data.temporaryPassword,
      });
    }
    notify(isAr ? "✅ تم تحديث صلاحية المستخدم" : "✅ User updated");
    await Promise.all([loadTenants(), loadTenantDetail(slug)]);
  }

  async function handleIssueTenant(e: React.FormEvent) {
    e.preventDefault();
    setIssuing(true);
    try {
      const cleanSlug = newSlug.trim().toLowerCase();
      const res = await safeFetchJson<{
        success?: boolean;
        license?: IssuedSuperadminLicenseView;
        error?: string;
      }>("/api/control-panel/tenants", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: cleanSlug,
          companyName: newCompanyName.trim(),
          adminEmail: newAdminEmail.trim() || `admin@${cleanSlug}.${DEFAULT_ROOT_DOMAIN}`,
          plan: newPlan,
          expiresAt: newExpiresAt,
        }),
      });
      if (!res.ok || !res.data?.success || !res.data.license) {
        notify(res.data?.error || (isAr ? "فشل إصدار الترخيص" : "Failed to issue license"));
        return;
      }
      setIssuedResult(res.data.license);
      notify(
        isAr
          ? `✅ تم إصدار الترخيص وتجهيز ${res.data.license.workspaceUrl}`
          : `✅ Issued license for ${res.data.license.workspaceUrl}`
      );
      await loadTenants();
    } finally {
      setIssuing(false);
    }
  }

  return (
    <div dir={dir} className="space-y-5 w-full max-w-full overflow-x-hidden text-xs sm:text-sm">
      {/* Header */}
      <div className="rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-emerald-600/10 via-emerald-500/5 to-transparent p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300 font-black text-sm sm:text-base">
            <ShieldCheck className="w-5 h-5 shrink-0" />
            <span>
              {isAr
                ? "لوحة التحكم المركزية لمنصة UAS (الحوكمة الكاملة)"
                : "UAS Platform Control Panel (Full Governance Suite)"}
            </span>
          </div>
          <p className="text-[11px] sm:text-xs text-slate-600 dark:text-slate-300">
            {isAr
              ? "إدارة دورة حياة التراخيص وتدوير مفاتيح Ed25519 والتحكم بالأجهزة وجلسات المستخدمين وسجل التدقيق الشامل."
              : "Lifecycle governance, Ed25519 key rotation, device trust/revocation, user session termination, and platform audit trail."}
          </p>
        </div>

        {showStandaloneLinks && (
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <a
              href="/control-panel"
              className="inline-flex items-center gap-1.5 min-h-[38px] px-3 rounded-xl bg-emerald-600 text-white font-bold text-xs hover:bg-emerald-700 transition"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>{isAr ? "فتح لوحة التحكم المستقلة" : "Open /control-panel"}</span>
            </a>
          </div>
        )}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <div className="card-surface rounded-2xl border border-slate-200 dark:border-slate-800 p-3.5">
          <div className="text-[11px] text-slate-500">{isAr ? "إجمالي المنشآت" : "Total Tenants"}</div>
          <div className="text-xl font-black mt-1 tabular-nums">{stats.total}</div>
        </div>
        <div className="card-surface rounded-2xl border border-slate-200 dark:border-slate-800 p-3.5">
          <div className="text-[11px] text-slate-500">{isAr ? "تراخيص نشطة" : "Active Licenses"}</div>
          <div className="text-xl font-black mt-1 text-emerald-600 tabular-nums">{stats.active}</div>
        </div>
        <div className="card-surface rounded-2xl border border-slate-200 dark:border-slate-800 p-3.5">
          <div className="text-[11px] text-slate-500">{isAr ? "معلّق / ملغى / منتهي" : "Blocked / Expired"}</div>
          <div className="text-xl font-black mt-1 text-rose-600 tabular-nums">{stats.blocked}</div>
        </div>
        <div className="card-surface rounded-2xl border border-slate-200 dark:border-slate-800 p-3.5">
          <div className="text-[11px] text-slate-500">{isAr ? "الأجهزة المسجلة" : "Registered Devices"}</div>
          <div className="text-xl font-black mt-1 text-indigo-600 tabular-nums">{stats.devices}</div>
        </div>
        <div className="card-surface rounded-2xl border border-slate-200 dark:border-slate-800 p-3.5 col-span-2 sm:col-span-1">
          <div className="text-[11px] text-slate-500">{isAr ? "مستخدمو المنشآت" : "Tenant Users"}</div>
          <div className="text-xl font-black mt-1 tabular-nums">{stats.users}</div>
        </div>
      </div>

      {/* Main Switcher */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
        <button
          type="button"
          onClick={() => {
            setMainTab("tenants");
            setSelectedSlug(null);
          }}
          className={`min-h-[40px] px-4 rounded-xl font-extrabold text-xs inline-flex items-center gap-2 transition ${
            mainTab === "tenants"
              ? "bg-emerald-600 text-white shadow-xs"
              : "card-surface border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
          }`}
        >
          <Building2 className="w-4 h-4" />
          <span>{isAr ? "المنشآت والحوكمة" : "Tenants & Governance"}</span>
        </button>

        <button
          type="button"
          onClick={() => setMainTab("issue")}
          className={`min-h-[40px] px-4 rounded-xl font-extrabold text-xs inline-flex items-center gap-2 transition ${
            mainTab === "issue"
              ? "bg-emerald-600 text-white shadow-xs"
              : "card-surface border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
          }`}
        >
          <Plus className="w-4 h-4" />
          <span>{isAr ? "إصدار ترخيص منشأة" : "Issue New License"}</span>
        </button>

        <button
          type="button"
          onClick={() => setMainTab("audit")}
          className={`min-h-[40px] px-4 rounded-xl font-extrabold text-xs inline-flex items-center gap-2 transition ${
            mainTab === "audit"
              ? "bg-emerald-600 text-white shadow-xs"
              : "card-surface border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
          }`}
        >
          <History className="w-4 h-4" />
          <span>{isAr ? "سجل التدقيق الشامل" : "Platform Audit Log"}</span>
        </button>
      </div>

      {/* TAB 1: TENANTS LIST OR TENANT DETAIL */}
      {mainTab === "tenants" && !selectedSlug && (
        <div className="card-surface rounded-2xl border border-slate-200 dark:border-slate-800 p-4 sm:p-5 space-y-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3 pointer-events-none" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={isAr ? "بحث بالاسم، النطاق، البريد، أو رقم الترخيص..." : "Search company, slug, email, license ID..."}
                className="w-full min-h-[40px] rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent ps-9 pe-3 py-1.5 text-xs"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="min-h-[40px] rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 text-xs font-bold"
              >
                <option value="all">{isAr ? "كل الحالات" : "All Statuses"}</option>
                <option value="active">{isAr ? "نشط" : "Active"}</option>
                <option value="suspended">{isAr ? "معلّق" : "Suspended"}</option>
                <option value="revoked">{isAr ? "ملغى" : "Revoked"}</option>
                <option value="expired">{isAr ? "منتهي" : "Expired"}</option>
              </select>

              <select
                value={planFilter}
                onChange={(e) => setPlanFilter(e.target.value)}
                className="min-h-[40px] rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 text-xs font-bold"
              >
                <option value="all">{isAr ? "كل الباقات" : "All Plans"}</option>
                <option value="enterprise">Enterprise</option>
                <option value="pro">Pro</option>
                <option value="starter">Starter</option>
              </select>

              <button
                type="button"
                onClick={() => void loadTenants()}
                disabled={loadingTenants}
                className="min-h-[40px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 inline-flex items-center gap-1.5 text-xs font-bold"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingTenants ? "animate-spin" : ""}`} />
                <span>{isAr ? "تحديث" : "Refresh"}</span>
              </button>
            </div>
          </div>

          {listError && (
            <div className="rounded-xl border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/30 p-3 text-xs text-rose-700 dark:text-rose-300">
              {listError}
            </div>
          )}

          {loadingTenants && tenants.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-500 flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>{isAr ? "جاري تحميل المنشآت..." : "Loading tenants..."}</span>
            </div>
          ) : filteredTenants.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-500">
              {isAr ? "لا توجد منشآت مطابقة للبحث." : "No matching tenants found."}
            </div>
          ) : (
            <>
              {/* Mobile Cards */}
              <div className="grid grid-cols-1 gap-3 md:hidden">
                {filteredTenants.map((t) => (
                  <div
                    key={t.slug}
                    className="rounded-xl border border-slate-200 dark:border-slate-700 p-3.5 space-y-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-black text-sm truncate">{t.companyName}</div>
                        <div dir="ltr" className="font-mono text-[11px] text-emerald-600 dark:text-emerald-400 truncate">
                          {t.slug}.qat.world
                        </div>
                      </div>
                      <StatusBadge status={t.effectiveStatus} isAr={isAr} />
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-[11px]">
                      <div>
                        <span className="text-slate-400 block">{isAr ? "الباقة" : "Plan"}</span>
                        <span className="font-bold uppercase">{t.plan}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block">{isAr ? "المقاعد" : "Seats"}</span>
                        <span className="font-bold tabular-nums">{t.maxSeats}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block">{isAr ? "الأجهزة / المستخدمون" : "Dev / Users"}</span>
                        <span className="font-bold tabular-nums">{t.deviceCount} / {t.userCount}</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedSlug(t.slug);
                        setDetailTab("lifecycle");
                        setRotatedResult(null);
                        setTempPasswordBanner(null);
                        void loadTenantDetail(t.slug);
                      }}
                      className="w-full min-h-[40px] rounded-xl bg-emerald-600 text-white font-bold text-xs flex items-center justify-center gap-1.5"
                    >
                      <Sliders className="w-3.5 h-3.5" />
                      <span>{isAr ? "إدارة الحوكمة والأجهزة والمستخدمين" : "Manage Tenant Governance"}</span>
                    </button>
                  </div>
                ))}
              </div>

              {/* Desktop Table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-700 text-slate-500">
                      <th className="py-2.5 px-3 text-start font-bold">{isAr ? "المنشأة" : "Tenant"}</th>
                      <th className="py-2.5 px-3 text-start font-bold">{isAr ? "الحالة" : "Status"}</th>
                      <th className="py-2.5 px-3 text-start font-bold">{isAr ? "الباقة والمقاعد" : "Plan & Seats"}</th>
                      <th className="py-2.5 px-3 text-start font-bold">{isAr ? "الترخيص والانتهاء" : "License & Expiry"}</th>
                      <th className="py-2.5 px-3 text-start font-bold">{isAr ? "الأجهزة / المستخدمون" : "Devices / Users"}</th>
                      <th className="py-2.5 px-3 text-end font-bold">{isAr ? "التحكم" : "Control"}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800">
                    {filteredTenants.map((t) => (
                      <tr key={t.slug} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                        <td className="py-3 px-3">
                          <div className="font-bold">{t.companyName}</div>
                          <div dir="ltr" className="font-mono text-[11px] text-emerald-600 dark:text-emerald-400">
                            {t.slug}.qat.world
                          </div>
                        </td>
                        <td className="py-3 px-3">
                          <StatusBadge status={t.effectiveStatus} isAr={isAr} />
                        </td>
                        <td className="py-3 px-3">
                          <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-bold uppercase text-[10px]">
                            {t.plan}
                          </span>
                          <span className="ms-2 font-mono text-[11px] text-slate-500">
                            {t.maxSeats} {isAr ? "مقاعد" : "seats"}
                          </span>
                        </td>
                        <td className="py-3 px-3 font-mono text-[11px]">
                          <div>{t.licenseId || "—"}</div>
                          <div className="text-slate-400">{formatDateShort(t.expiresAt)}</div>
                        </td>
                        <td className="py-3 px-3 tabular-nums font-bold">
                          <span>{t.activeDeviceCount}/{t.deviceCount} {isAr ? "أجهزة" : "dev"}</span>
                          <span className="mx-1.5 text-slate-300">·</span>
                          <span>{t.activeUserCount}/{t.userCount} {isAr ? "مستخدم" : "usr"}</span>
                        </td>
                        <td className="py-3 px-3 text-end">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedSlug(t.slug);
                                setDetailTab("lifecycle");
                                setRotatedResult(null);
                                setTempPasswordBanner(null);
                                void loadTenantDetail(t.slug);
                              }}
                              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[11px] inline-flex items-center gap-1"
                            >
                              <Sliders className="w-3.5 h-3.5" />
                              <span>{isAr ? "إدارة" : "Manage"}</span>
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
      )}

      {/* TENANT DETAIL GOVERNANCE CONSOLE */}
      {mainTab === "tenants" && selectedSlug && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => {
                setSelectedSlug(null);
                setDetailTenant(null);
              }}
              className="min-h-[38px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-bold inline-flex items-center gap-1.5"
            >
              <ChevronRight className={`w-4 h-4 ${isAr ? "" : "rotate-180"}`} />
              <span>{isAr ? "العودة لقائمة المنشآت" : "Back to Tenants"}</span>
            </button>

            {detailTenant && (
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={detailTenant.effectiveStatus} isAr={isAr} />
                <button
                  type="button"
                  onClick={() => void handleDownload(detailTenant.slug, "uas")}
                  className="min-h-[36px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-bold inline-flex items-center gap-1"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>.uas</span>
                </button>
                <button
                  type="button"
                  onClick={() => void handleDownload(detailTenant.slug, "txt")}
                  className="min-h-[36px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-bold inline-flex items-center gap-1"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>.uaskey.txt</span>
                </button>
                {detailTenant.uaskey && (
                  <button
                    type="button"
                    onClick={() => void handleCopy(detailTenant.uaskey, `det-${detailTenant.slug}`, "UASKEY")}
                    className="min-h-[36px] px-3 rounded-xl bg-emerald-600 text-white text-xs font-bold inline-flex items-center gap-1"
                  >
                    {copiedId === `det-${detailTenant.slug}` ? (
                      <Check className="w-3.5 h-3.5" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                    <span>{isAr ? "نسخ المفتاح" : "Copy Key"}</span>
                  </button>
                )}
              </div>
            )}
          </div>

          {loadingDetail && !detailTenant ? (
            <div className="card-surface rounded-2xl border border-slate-200 dark:border-slate-800 p-10 text-center text-xs text-slate-500 flex items-center justify-center gap-2">
              <Loader2 className="w-5 h-5 animate-spin text-emerald-600" />
              <span>{isAr ? "جاري تحميل لوحة حوكمة المنشأة..." : "Loading tenant governance..."}</span>
            </div>
          ) : detailTenant ? (
            <>
              {/* Tenant Banner */}
              <div className="card-surface rounded-2xl border border-slate-200 dark:border-slate-800 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <h2 className="text-base font-black">{detailTenant.companyName}</h2>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 mt-1">
                    <span dir="ltr" className="font-mono text-emerald-600 dark:text-emerald-400">
                      {detailTenant.workspaceUrl}
                    </span>
                    <span>·</span>
                    <span dir="ltr" className="font-mono">{detailTenant.licenseId || "NO-LICENSE"}</span>
                    <span>·</span>
                    <span>{isAr ? `ينتهي ${formatDateShort(detailTenant.expiresAt)}` : `Expires ${formatDateShort(detailTenant.expiresAt)}`}</span>
                  </div>
                  {detailTenant.governanceReason && (
                    <div className="text-[11px] text-amber-700 dark:text-amber-300 mt-1">
                      {isAr ? "سبب الحالة:" : "Reason:"} {detailTenant.governanceReason}
                    </div>
                  )}
                </div>

                {/* Quick Lifecycle Action Buttons */}
                <div className="flex flex-wrap items-center gap-2">
                  {detailTenant.effectiveStatus !== "active" && (
                    <button
                      type="button"
                      onClick={() =>
                        openConfirm({
                          title: isAr ? "إعادة تفعيل المنشأة والترخيص" : "Reactivate Tenant License",
                          message: isAr
                            ? `هل تريد إعادة تفعيل ترخيص المنشأة (${detailTenant.companyName}) وإزالة الحظر؟`
                            : `Reactivate license and workspace access for ${detailTenant.companyName}?`,
                          tone: "primary",
                          onConfirm: async (reason) => {
                            await executeTenantLifecycle(
                              detailTenant.slug,
                              { action: "reactivate", reason },
                              isAr ? "✅ تم إعادة تفعيل المنشأة" : "✅ Tenant reactivated"
                            );
                          },
                        })
                      }
                      className="min-h-[38px] px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold inline-flex items-center gap-1.5"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>{isAr ? "إعادة تفعيل" : "Reactivate"}</span>
                    </button>
                  )}

                  {detailTenant.effectiveStatus === "active" && (
                    <button
                      type="button"
                      onClick={() =>
                        openConfirm({
                          title: isAr ? "تعليق ترخيص المنشأة" : "Suspend Tenant License",
                          message: isAr
                            ? `سيؤدي التعليق إلى إيقاف التحقق السحابي والمحلي ومنع الدخول لمنشأة (${detailTenant.companyName}).`
                            : `Suspending ${detailTenant.companyName} blocks online/LAN/offline verification and sign-in immediately.`,
                          tone: "warning",
                          requireReason: true,
                          reasonLabel: isAr ? "سبب التعليق" : "Suspension reason",
                          onConfirm: async (reason) => {
                            await executeTenantLifecycle(
                              detailTenant.slug,
                              { action: "suspend", reason },
                              isAr ? "⏸️ تم تعليق المنشأة" : "⏸️ Tenant suspended"
                            );
                          },
                        })
                      }
                      className="min-h-[38px] px-3 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold inline-flex items-center gap-1.5"
                    >
                      <Ban className="w-3.5 h-3.5" />
                      <span>{isAr ? "تعليق مؤقت" : "Suspend"}</span>
                    </button>
                  )}

                  {detailTenant.effectiveStatus !== "revoked" && (
                    <button
                      type="button"
                      onClick={() =>
                        openConfirm({
                          title: isAr ? "إلغاء ترخيص المنشأة نهائياً" : "Revoke Tenant License",
                          message: isAr
                            ? `سيتم إلغاء الترخيص وإرسال أمر مسح الجلسات لجميع أجهزة (${detailTenant.companyName}).`
                            : `Revoking ${detailTenant.companyName} permanently disables the license and triggers credential wipe on connected devices.`,
                          tone: "danger",
                          requireReason: true,
                          reasonLabel: isAr ? "سبب الإلغاء" : "Revocation reason",
                          onConfirm: async (reason) => {
                            await executeTenantLifecycle(
                              detailTenant.slug,
                              { action: "revoke", reason },
                              isAr ? "⛔ تم إلغاء الترخيص" : "⛔ Tenant revoked"
                            );
                          },
                        })
                      }
                      className="min-h-[38px] px-3 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold inline-flex items-center gap-1.5"
                    >
                      <ShieldAlert className="w-3.5 h-3.5" />
                      <span>{isAr ? "إلغاء الترخيص" : "Revoke"}</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Detail Sub-Tabs */}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setDetailTab("lifecycle")}
                  className={`px-3.5 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 ${
                    detailTab === "lifecycle"
                      ? "bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900"
                      : "card-surface border border-slate-200 dark:border-slate-700"
                  }`}
                >
                  <KeyRound className="w-3.5 h-3.5" />
                  <span>{isAr ? "الترخيص وتدوير المفاتيح" : "License & Key Rotation"}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setDetailTab("devices")}
                  className={`px-3.5 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 ${
                    detailTab === "devices"
                      ? "bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900"
                      : "card-surface border border-slate-200 dark:border-slate-700"
                  }`}
                >
                  <Laptop className="w-3.5 h-3.5" />
                  <span>
                    {isAr ? `الأجهزة المسجلة (${devices.length})` : `Devices (${devices.length})`}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setDetailTab("users")}
                  className={`px-3.5 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 ${
                    detailTab === "users"
                      ? "bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900"
                      : "card-surface border border-slate-200 dark:border-slate-700"
                  }`}
                >
                  <Users className="w-3.5 h-3.5" />
                  <span>
                    {isAr ? `المستخدمون والجلسات (${users.length})` : `Users (${users.length})`}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setDetailTab("history")}
                  className={`px-3.5 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 ${
                    detailTab === "history"
                      ? "bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900"
                      : "card-surface border border-slate-200 dark:border-slate-700"
                  }`}
                >
                  <Activity className="w-3.5 h-3.5" />
                  <span>{isAr ? "سجل عمليات المنشأة" : "Tenant Audit Trail"}</span>
                </button>
              </div>

              {/* DETAIL TAB 1: LICENSE LIFECYCLE & KEY ROTATION */}
              {detailTab === "lifecycle" && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {/* Plan, Seat Quota & Expiry Management */}
                  <div className="card-surface rounded-2xl border border-slate-200 dark:border-slate-800 p-4 space-y-4">
                    <h3 className="font-black text-sm flex items-center gap-2">
                      <Sliders className="w-4 h-4 text-emerald-600" />
                      <span>{isAr ? "الباقة والمقاعد وتاريخ الانتهاء" : "Plan, Seat Quota & Expiration"}</span>
                    </h3>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-[11px] font-bold mb-1">
                          {isAr ? "الباقة" : "Plan"}
                        </label>
                        <select
                          value={editPlan}
                          onChange={(e) => setEditPlan(e.target.value as LicensePlanId)}
                          className="w-full min-h-[40px] rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-2.5 text-xs font-bold"
                        >
                          <option value="enterprise">Enterprise</option>
                          <option value="pro">Pro</option>
                          <option value="starter">Starter</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold mb-1">
                          {isAr ? "حد المقاعد (المستخدمون)" : "Max Seats"}
                        </label>
                        <input
                          type="number"
                          min={1}
                          max={10000}
                          value={editMaxSeats}
                          onChange={(e) => setEditMaxSeats(e.target.value)}
                          className="w-full min-h-[40px] rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-2.5 text-xs font-mono"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold mb-1">
                          {isAr ? "تاريخ الانتهاء" : "Expires At"}
                        </label>
                        <input
                          type="date"
                          dir="ltr"
                          value={editExpiresAt}
                          onChange={(e) => setEditExpiresAt(e.target.value)}
                          className="w-full min-h-[40px] rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-2.5 text-xs font-mono"
                        />
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          openConfirm({
                            title: isAr ? "حفظ تعديل الباقة والمقاعد" : "Update Plan & Seat Quota",
                            message: isAr
                              ? `تحديث الترخيص إلى باقة (${editPlan}) بحد (${editMaxSeats}) مقاعد وانتهاء (${editExpiresAt}) وإعادة التوقيع؟`
                              : `Update plan to ${editPlan}, maxSeats=${editMaxSeats}, expiresAt=${editExpiresAt} and re-sign .uas?`,
                            tone: "primary",
                            onConfirm: async (reason) => {
                              await executeTenantLifecycle(
                                detailTenant.slug,
                                {
                                  action: "update_config",
                                  plan: editPlan,
                                  maxSeats: Number(editMaxSeats) || 7,
                                  expiresAt: editExpiresAt,
                                  reason,
                                },
                                isAr ? "✅ تم تحديث إعدادات الترخيص" : "✅ License config updated"
                              );
                            },
                          })
                        }
                        className="min-h-[40px] px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs"
                      >
                        {isAr ? "حفظ وتحديث الترخيص" : "Save & Re-Sign Config"}
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          openConfirm({
                            title: isAr ? "وسم الترخيص كمنتهي الصلاحية" : "Mark License Expired",
                            message: isAr
                              ? `سيتم تحويل حالة المنشأة (${detailTenant.companyName}) إلى منتهي الصلاحية.`
                              : `Mark ${detailTenant.companyName} license as EXPIRED?`,
                            tone: "warning",
                            onConfirm: async (reason) => {
                              await executeTenantLifecycle(
                                detailTenant.slug,
                                { action: "expire", reason },
                                isAr ? "تم تحديث الحالة إلى منتهي" : "Marked expired"
                              );
                            },
                          })
                        }
                        className="min-h-[40px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-bold"
                      >
                        {isAr ? "وسم كمنتهي" : "Mark Expired"}
                      </button>
                    </div>
                  </div>

                  {/* Regenerate / Rotate Ed25519 License Key */}
                  <div className="card-surface rounded-2xl border border-slate-200 dark:border-slate-800 p-4 space-y-4">
                    <h3 className="font-black text-sm flex items-center gap-2">
                      <RotateCcw className="w-4 h-4 text-indigo-600" />
                      <span>{isAr ? "تدوير وإعادة توليد مفتاح الترخيص" : "Regenerate / Rotate Ed25519 Key"}</span>
                    </h3>

                    <div className="space-y-2.5 text-xs">
                      <label className="flex items-center gap-2 font-semibold cursor-pointer">
                        <input
                          type="checkbox"
                          checked={rotateImmediateRevoke}
                          onChange={(e) => setRotateImmediateRevoke(e.target.checked)}
                          className="rounded border-slate-300"
                        />
                        <span>
                          {isAr
                            ? "إلغاء فوري للمفتاح السابق عند التدوير"
                            : "Immediately revoke prior license key on rotation"}
                        </span>
                      </label>

                      {!rotateImmediateRevoke && (
                        <div>
                          <label className="block text-[11px] font-bold mb-1">
                            {isAr ? "فترة سماح المفتاح السابق (ساعات)" : "Prior Key Grace Period (hours)"}
                          </label>
                          <input
                            type="number"
                            min={1}
                            max={720}
                            value={rotateGraceHours}
                            onChange={(e) => setRotateGraceHours(e.target.value)}
                            className="w-36 min-h-[38px] rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-2.5 text-xs font-mono"
                          />
                        </div>
                      )}

                      <label className="flex items-center gap-2 font-semibold cursor-pointer">
                        <input
                          type="checkbox"
                          checked={rotateResetAdminPass}
                          onChange={(e) => setRotateResetAdminPass(e.target.checked)}
                          className="rounded border-slate-300"
                        />
                        <span>
                          {isAr
                            ? "توليد كلمة مرور جديدة لمدير المنشأة وتضمينها"
                            : "Also reset tenant admin password"}
                        </span>
                      </label>
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        openConfirm({
                          title: isAr ? "تأكيد تدوير مفتاح الترخيص" : "Confirm License Key Rotation",
                          message: isAr
                            ? `سيتم إصدار رقم ترخيص جديد وتوقيع Ed25519 محدث لمنشأة (${detailTenant.companyName}).`
                            : `Issue a new License ID and Ed25519-signed key for ${detailTenant.companyName}?`,
                          tone: "warning",
                          requireReason: true,
                          reasonLabel: isAr ? "سبب التدوير" : "Rotation reason",
                          onConfirm: async (reason) => {
                            await executeKeyRotation(detailTenant.slug, reason);
                          },
                        })
                      }
                      className="min-h-[42px] px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs inline-flex items-center gap-2"
                    >
                      <RotateCcw className="w-4 h-4" />
                      <span>{isAr ? "إصدار وتدوير المفتاح الآن" : "Rotate License Key Now"}</span>
                    </button>

                    {rotatedResult && (
                      <div className="rounded-xl border border-emerald-400 bg-emerald-50/70 dark:bg-emerald-950/30 p-3 space-y-2 text-xs">
                        <div className="font-black text-emerald-800 dark:text-emerald-300">
                          {isAr ? "المفتاح الجديد:" : "New Rotated License:"} {rotatedResult.licenseId}
                        </div>
                        {rotatedResult.adminPassword && (
                          <div className="font-mono text-[11px]">
                            {isAr ? "كلمة المرور:" : "Password:"} {rotatedResult.adminPassword}
                          </div>
                        )}
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => void handleCopy(rotatedResult.uaskey, "rot-key", "UASKEY")}
                            className="px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white font-bold text-[11px] inline-flex items-center gap-1"
                          >
                            <Copy className="w-3 h-3" />
                            <span>{isAr ? "نسخ UASKEY" : "Copy UASKEY"}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDownload(detailTenant.slug, "uas")}
                            className="px-2.5 py-1.5 rounded-lg border border-emerald-600/40 font-bold text-[11px]"
                          >
                            .uas
                          </button>
                        </div>
                      </div>
                    )}

                    {rotatedKeys.length > 0 && (
                      <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-1.5">
                        <div className="text-[11px] font-bold text-slate-500">
                          {isAr ? "سجل المفاتيح المدورة السابقة:" : "Prior Rotated Keys:"}
                        </div>
                        <div className="space-y-1 max-h-36 overflow-y-auto">
                          {rotatedKeys.map((rk) => (
                            <div
                              key={`${rk.licenseId}-${rk.rotatedAt}`}
                              className="text-[11px] font-mono bg-slate-50 dark:bg-slate-900 rounded-lg px-2.5 py-1.5 flex items-center justify-between gap-2"
                            >
                              <span>{rk.licenseId} → {rk.replacedByLicenseId}</span>
                              <span className={rk.immediatelyRevoked ? "text-rose-600" : "text-amber-600"}>
                                {rk.immediatelyRevoked
                                  ? isAr ? "ملغى فوراً" : "Revoked"
                                  : `${isAr ? "سماح حتى" : "Grace"} ${formatDateTime(rk.graceUntil)}`}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* DETAIL TAB 2: REGISTERED DEVICES */}
              {detailTab === "devices" && (
                <div className="card-surface rounded-2xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="font-black text-sm">
                      {isAr ? "الأجهزة المرتبطة بالمنشأة" : "Registered Tenant Devices"}
                    </h3>
                    <button
                      type="button"
                      onClick={() => void loadTenantDetail(detailTenant.slug)}
                      className="px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-bold inline-flex items-center gap-1"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>{isAr ? "تحديث" : "Refresh"}</span>
                    </button>
                  </div>

                  {devices.length === 0 ? (
                    <div className="py-8 text-center text-xs text-slate-500">
                      {isAr ? "لا توجد أجهزة مسجلة لهذه المنشأة حتى الآن." : "No devices registered for this tenant yet."}
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs border-collapse">
                        <thead>
                          <tr className="border-b border-slate-200 dark:border-slate-700 text-slate-500">
                            <th className="py-2 px-2.5 text-start">{isAr ? "الجهاز والمنصة" : "Device & Platform"}</th>
                            <th className="py-2 px-2.5 text-start">{isAr ? "المستخدم" : "User"}</th>
                            <th className="py-2 px-2.5 text-start">{isAr ? "آخر ظهور / IP" : "Last Seen / IP"}</th>
                            <th className="py-2 px-2.5 text-start">{isAr ? "الحالة" : "Status"}</th>
                            <th className="py-2 px-2.5 text-end">{isAr ? "الإجراءات" : "Actions"}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800">
                          {devices.map((d) => (
                            <tr key={d.deviceId}>
                              <td className="py-2.5 px-2.5">
                                <div className="flex items-center gap-2">
                                  <PlatformIcon platform={d.platform} />
                                  <div>
                                    <div className="font-bold">{d.deviceLabel || d.deviceId}</div>
                                    <div dir="ltr" className="font-mono text-[10px] text-slate-500">
                                      {d.deviceId} · {d.platform} · v{d.appVersion} {d.osVersion ? `(${d.osVersion})` : ""}
                                    </div>
                                  </div>
                                </div>
                              </td>
                              <td className="py-2.5 px-2.5 text-[11px]">
                                <div>{d.userDisplay || "—"}</div>
                                <div dir="ltr" className="font-mono text-slate-500">{d.userEmail || "—"}</div>
                              </td>
                              <td dir="ltr" className="py-2.5 px-2.5 font-mono text-[11px]">
                                <div>{formatDateTime(d.lastSeenAt)}</div>
                                <div className="text-slate-400">{d.ipAddress || "—"}</div>
                              </td>
                              <td className="py-2.5 px-2.5">
                                <span
                                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                    d.status === "ACTIVE"
                                      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
                                      : d.status === "SUSPENDED"
                                      ? "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300"
                                      : "bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-300"
                                  }`}
                                >
                                  {d.status}
                                </span>
                              </td>
                              <td className="py-2.5 px-2.5 text-end">
                                <div className="inline-flex flex-wrap justify-end gap-1">
                                  {d.status !== "ACTIVE" && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        void executeDeviceAction(detailTenant.slug, d.deviceId, "approve", "")
                                      }
                                      className="px-2 py-1 rounded-lg bg-emerald-600 text-white text-[11px] font-bold"
                                    >
                                      {isAr ? "اعتماد" : "Approve"}
                                    </button>
                                  )}
                                  {d.status === "ACTIVE" && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        openConfirm({
                                          title: isAr ? "حظر/تعليق الجهاز" : "Suspend Device",
                                          message: isAr
                                            ? `تعليق الجهاز (${d.deviceLabel || d.deviceId}) ومنعه من المزامنة؟`
                                            : `Suspend device ${d.deviceId}?`,
                                          tone: "warning",
                                          onConfirm: async (reason) => {
                                            await executeDeviceAction(detailTenant.slug, d.deviceId, "suspend", reason);
                                          },
                                        })
                                      }
                                      className="px-2 py-1 rounded-lg bg-amber-600 text-white text-[11px] font-bold"
                                    >
                                      {isAr ? "تعليق" : "Suspend"}
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() =>
                                      openConfirm({
                                        title: isAr ? "إلغاء ربط الجهاز" : "Revoke / Unbind Device",
                                        message: isAr
                                          ? `إلغاء صلاحية الجهاز (${d.deviceId}) وتحرير مقعده وإرسال أمر مسح الجلسة؟`
                                          : `Revoke ${d.deviceId}, free its seat, and wipe credentials?`,
                                        tone: "danger",
                                        onConfirm: async (reason) => {
                                          await executeDeviceAction(detailTenant.slug, d.deviceId, "revoke", reason);
                                        },
                                      })
                                    }
                                    className="px-2 py-1 rounded-lg bg-rose-600 text-white text-[11px] font-bold"
                                  >
                                    {isAr ? "إلغاء ربط" : "Revoke"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      openConfirm({
                                        title: isAr ? "إعادة تعيين / إعادة تسجيل الجهاز" : "Reset / Re-enroll Device",
                                        message: isAr
                                          ? `إعادة ضبط مؤشر المزامنة وتحرير المقعد لإعادة تسجيل الجهاز (${d.deviceId})؟`
                                          : `Reset sync cursor and release seat binding for re-enrollment of ${d.deviceId}?`,
                                        tone: "primary",
                                        onConfirm: async (reason) => {
                                          await executeDeviceAction(detailTenant.slug, d.deviceId, "reset", reason);
                                        },
                                      })
                                    }
                                    className="px-2 py-1 rounded-lg border border-slate-300 dark:border-slate-700 text-[11px] font-bold"
                                  >
                                    {isAr ? "إعادة ضبط" : "Reset"}
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* DETAIL TAB 3: TENANT USERS & CREDENTIALS */}
              {detailTab === "users" && (
                <div className="card-surface rounded-2xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="font-black text-sm">
                      {isAr ? "مستخدمو المنشأة وإدارة الجلسات" : "Tenant Users & Credential Governance"}
                    </h3>
                    <button
                      type="button"
                      onClick={() => void loadTenantDetail(detailTenant.slug)}
                      className="px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-bold inline-flex items-center gap-1"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>{isAr ? "تحديث" : "Refresh"}</span>
                    </button>
                  </div>

                  {tempPasswordBanner && (
                    <div className="rounded-xl border-2 border-amber-400 bg-amber-50 dark:bg-amber-950/30 p-3 flex flex-wrap items-center justify-between gap-3">
                      <div className="space-y-0.5 text-xs">
                        <div className="font-black text-amber-900 dark:text-amber-200">
                          {isAr
                            ? `تم توليد كلمة مرور مؤقتة للحساب: ${tempPasswordBanner.email}`
                            : `Temporary password generated for ${tempPasswordBanner.email}`}
                        </div>
                        <div dir="ltr" className="font-mono font-black text-sm select-all">
                          {tempPasswordBanner.password}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            void handleCopy(tempPasswordBanner.password, "tmp-pw", isAr ? "كلمة المرور المؤقتة" : "Temporary password")
                          }
                          className="px-3 py-1.5 rounded-lg bg-amber-600 text-white font-bold text-xs inline-flex items-center gap-1"
                        >
                          <Copy className="w-3.5 h-3.5" />
                          <span>{isAr ? "نسخ كلمة المرور" : "Copy Password"}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setTempPasswordBanner(null)}
                          className="p-1.5 rounded-lg hover:bg-amber-200/50"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  )}

                  {users.length === 0 ? (
                    <div className="py-8 text-center text-xs text-slate-500">
                      {isAr ? "لا يوجد مستخدمون مسجلون." : "No users found."}
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs border-collapse">
                        <thead>
                          <tr className="border-b border-slate-200 dark:border-slate-700 text-slate-500">
                            <th className="py-2 px-2.5 text-start">{isAr ? "المستخدم والدور" : "User & Role"}</th>
                            <th className="py-2 px-2.5 text-start">{isAr ? "الحالة وآخر دخول" : "State & Last Login"}</th>
                            <th className="py-2 px-2.5 text-start">{isAr ? "الأجهزة المرتبطة" : "Bound Devices"}</th>
                            <th className="py-2 px-2.5 text-end">{isAr ? "الإجراءات" : "Actions"}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800">
                          {users.map((u) => (
                            <tr key={u.id}>
                              <td className="py-2.5 px-2.5">
                                <div className="font-bold">{u.displayName || u.name}</div>
                                <div dir="ltr" className="font-mono text-[11px] text-slate-500">
                                  {u.email} ({u.username})
                                </div>
                                <span className="inline-block mt-0.5 px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[10px] font-bold">
                                  {u.role}
                                </span>
                              </td>
                              <td className="py-2.5 px-2.5 text-[11px]">
                                <div>
                                  <span
                                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                      u.active && !u.signInBlocked
                                        ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
                                        : "bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-300"
                                    }`}
                                  >
                                    {u.active && !u.signInBlocked
                                      ? isAr ? "نشط" : "Active"
                                      : isAr ? "موقوف / محظور" : "Blocked"}
                                  </span>
                                </div>
                                <div dir="ltr" className="font-mono text-slate-400 mt-1">
                                  {u.lastLoginAt ? formatDateTime(u.lastLoginAt) : "—"}
                                </div>
                              </td>
                              <td className="py-2.5 px-2.5 text-[11px]">
                                {u.boundDevices.length === 0 ? (
                                  <span className="text-slate-400">—</span>
                                ) : (
                                  <div className="space-y-1">
                                    {u.boundDevices.map((bd) => (
                                      <div key={bd.deviceId} className="font-mono text-[10px]">
                                        {bd.platform}: {bd.label} ({bd.status})
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </td>
                              <td className="py-2.5 px-2.5 text-end">
                                <div className="inline-flex flex-wrap justify-end gap-1.5">
                                  {u.active && !u.signInBlocked ? (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        openConfirm({
                                          title: isAr ? "إلغاء الجلسات وحظر الدخول" : "Revoke Access & Sessions",
                                          message: isAr
                                            ? `إنهاء جميع الجلسات النشطة فوراً وحظر تسجيل الدخول للمستخدم (${u.email})؟`
                                            : `Terminate active sessions and block sign-in for ${u.email}?`,
                                          tone: "danger",
                                          requireReason: true,
                                          reasonLabel: isAr ? "السبب" : "Reason",
                                          onConfirm: async (reason) => {
                                            await executeUserAction(detailTenant.slug, u, "revoke_access", reason);
                                          },
                                        })
                                      }
                                      className="px-2.5 py-1 rounded-lg bg-rose-600 text-white text-[11px] font-bold inline-flex items-center gap-1"
                                    >
                                      <UserX className="w-3 h-3" />
                                      <span>{isAr ? "إلغاء الوصول" : "Revoke Access"}</span>
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        openConfirm({
                                          title: isAr ? "إعادة تفعيل المستخدم" : "Reactivate User",
                                          message: isAr
                                            ? `إعادة السماح بتسجيل الدخول للمستخدم (${u.email})؟`
                                            : `Re-enable sign-in for ${u.email}?`,
                                          tone: "primary",
                                          onConfirm: async (reason) => {
                                            await executeUserAction(detailTenant.slug, u, "reactivate", reason);
                                          },
                                        })
                                      }
                                      className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white text-[11px] font-bold inline-flex items-center gap-1"
                                    >
                                      <UserCheck className="w-3 h-3" />
                                      <span>{isAr ? "تفعيل" : "Reactivate"}</span>
                                    </button>
                                  )}

                                  <button
                                    type="button"
                                    onClick={() =>
                                      openConfirm({
                                        title: isAr ? "إعادة تعيين كلمة المرور" : "Reset User Password",
                                        message: isAr
                                          ? `توليد كلمة مرور مؤقتة جديدة وإنهاء الجلسات السابقة للمستخدم (${u.email})؟`
                                          : `Generate a temporary password and invalidate prior sessions for ${u.email}?`,
                                        tone: "warning",
                                        onConfirm: async (reason) => {
                                          await executeUserAction(detailTenant.slug, u, "reset_password", reason);
                                        },
                                      })
                                    }
                                    className="px-2.5 py-1 rounded-lg border border-amber-500/60 text-amber-700 dark:text-amber-300 text-[11px] font-bold inline-flex items-center gap-1"
                                  >
                                    <KeyRound className="w-3 h-3" />
                                    <span>{isAr ? "تعيين كلمة مرور" : "Reset Password"}</span>
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* DETAIL TAB 4: TENANT AUDIT LOG */}
              {detailTab === "history" && (
                <div className="card-surface rounded-2xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
                  <h3 className="font-black text-sm">
                    {isAr ? "سجل حوكمة المنشأة" : "Tenant Governance Audit Log"}
                  </h3>
                  {tenantAuditLogs.length === 0 ? (
                    <div className="py-6 text-center text-xs text-slate-500">
                      {isAr ? "لا توجد سجلات حوكمة لهذه المنشأة بعد." : "No governance audit entries yet."}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {tenantAuditLogs.map((a) => (
                        <div
                          key={a.id}
                          className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 text-xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2"
                        >
                          <div>
                            <div className="font-bold">
                              <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono text-[10px] me-2">
                                {a.actionType}
                              </span>
                              <span>{a.details}</span>
                            </div>
                            <div className="text-[11px] text-slate-400 mt-0.5">
                              {a.actorEmail} · {a.targetEntityType}:{a.targetEntityId}
                            </div>
                          </div>
                          <div dir="ltr" className="font-mono text-[11px] text-slate-400 shrink-0">
                            {formatDateTime(a.timestamp)}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          ) : null}
        </div>
      )}

      {/* TAB 2: ISSUE NEW LICENSE */}
      {mainTab === "issue" && (
        <form
          onSubmit={handleIssueTenant}
          className="card-surface rounded-2xl border border-slate-200 dark:border-slate-800 p-4 sm:p-6 space-y-4"
        >
          <h3 className="font-black text-sm flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
            <KeyRound className="w-4 h-4 text-emerald-600" />
            <span>{isAr ? "إصدار ترخيص وتجهيز منشأة جديدة" : "Issue New Ed25519 Tenant License"}</span>
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold mb-1">
                {isAr ? "اسم المنشأة *" : "Company Name *"}
              </label>
              <input
                type="text"
                required
                value={newCompanyName}
                onChange={(e) => {
                  const v = e.target.value;
                  setNewCompanyName(v);
                  if (!newSlugTouched) {
                    const s = suggestSlug(v);
                    setNewSlug(s);
                    if (!newAdminEmailTouched) {
                      setNewAdminEmail(s ? `admin@${s}.${DEFAULT_ROOT_DOMAIN}` : "");
                    }
                  }
                }}
                className="w-full min-h-[42px] rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-bold mb-1">
                {isAr ? "النطاق الفرعي (Slug) *" : "Tenant Slug *"}
              </label>
              <input
                type="text"
                required
                dir="ltr"
                value={newSlug}
                onChange={(e) => {
                  setNewSlugTouched(true);
                  const cleaned = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 32);
                  setNewSlug(cleaned);
                  if (!newAdminEmailTouched) {
                    setNewAdminEmail(cleaned ? `admin@${cleaned}.${DEFAULT_ROOT_DOMAIN}` : "");
                  }
                }}
                className="w-full min-h-[42px] rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 text-sm font-mono"
              />
              {newSlug && !validateTenantSlug(newSlug).valid && (
                <span className="text-[11px] text-rose-600">
                  {validateTenantSlug(newSlug).error}
                </span>
              )}
            </div>

            <div>
              <label className="block text-xs font-bold mb-1">
                {isAr ? "بريد المدير" : "Admin Email"}
              </label>
              <input
                type="email"
                dir="ltr"
                value={newAdminEmail}
                onChange={(e) => {
                  setNewAdminEmailTouched(true);
                  setNewAdminEmail(e.target.value);
                }}
                className="w-full min-h-[42px] rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 text-sm font-mono"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold mb-1">{isAr ? "الباقة" : "Plan"}</label>
                <select
                  value={newPlan}
                  onChange={(e) => setNewPlan(e.target.value as LicensePlanId)}
                  className="w-full min-h-[42px] rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 text-xs font-bold"
                >
                  <option value="enterprise">Enterprise (7 users)</option>
                  <option value="pro">Pro (5 users)</option>
                  <option value="starter">Starter (2 users)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold mb-1">{isAr ? "الانتهاء" : "Expires At"}</label>
                <input
                  type="date"
                  dir="ltr"
                  value={newExpiresAt}
                  onChange={(e) => setNewExpiresAt(e.target.value)}
                  className="w-full min-h-[42px] rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 text-xs font-mono"
                />
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={issuing}
            className="min-h-[44px] px-5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs inline-flex items-center gap-2 disabled:opacity-60"
          >
            {issuing ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
            <span>{isAr ? "إصدار الترخيص وتجهيز المنشأة" : "Issue License & Provision"}</span>
          </button>

          {issuedResult && (
            <div className="rounded-xl border border-emerald-400 bg-emerald-50/60 dark:bg-emerald-950/30 p-4 space-y-2 text-xs">
              <div className="font-black text-emerald-800 dark:text-emerald-300">
                ✅ {issuedResult.companyName} ({issuedResult.licenseId})
              </div>
              <div dir="ltr" className="font-mono text-[11px]">
                {issuedResult.workspaceUrl} · {issuedResult.adminEmail} · Pass: {issuedResult.adminPassword}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void handleCopy(issuedResult.uaskey, "new-key", "UASKEY")}
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white font-bold text-[11px] inline-flex items-center gap-1"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>{isAr ? "نسخ UASKEY" : "Copy UASKEY"}</span>
                </button>
                <button
                  type="button"
                  onClick={() => void handleDownload(issuedResult.slug, "uas")}
                  className="px-3 py-1.5 rounded-lg border border-emerald-600/40 font-bold text-[11px]"
                >
                  .uas
                </button>
                <button
                  type="button"
                  onClick={() => void handleDownload(issuedResult.slug, "txt")}
                  className="px-3 py-1.5 rounded-lg border border-slate-400/40 font-bold text-[11px]"
                >
                  .uaskey.txt
                </button>
              </div>
            </div>
          )}
        </form>
      )}

      {/* TAB 3: PLATFORM AUDIT LOG */}
      {mainTab === "audit" && (
        <div className="card-surface rounded-2xl border border-slate-200 dark:border-slate-800 p-4 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3 pointer-events-none" />
              <input
                type="search"
                value={auditSearch}
                onChange={(e) => setAuditSearch(e.target.value)}
                placeholder={isAr ? "بحث في سجل التدقيق..." : "Search audit events..."}
                className="w-full min-h-[38px] rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent ps-9 pe-3 text-xs"
              />
            </div>

            <div className="flex items-center gap-2">
              <select
                value={auditEntityFilter}
                onChange={(e) => setAuditEntityFilter(e.target.value)}
                className="min-h-[38px] rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 text-xs font-bold"
              >
                <option value="ALL">{isAr ? "كل الكيانات" : "All Entities"}</option>
                <option value="LICENSE">{isAr ? "التراخيص" : "Licenses"}</option>
                <option value="TENANT">{isAr ? "المنشآت" : "Tenants"}</option>
                <option value="DEVICE">{isAr ? "الأجهزة" : "Devices"}</option>
                <option value="USER">{isAr ? "المستخدمون" : "Users"}</option>
              </select>

              <button
                type="button"
                onClick={() => void loadPlatformAudit()}
                disabled={loadingAudit}
                className="min-h-[38px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-bold inline-flex items-center gap-1"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingAudit ? "animate-spin" : ""}`} />
                <span>{isAr ? "تحديث" : "Refresh"}</span>
              </button>
            </div>
          </div>

          {platformAuditLogs.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-500">
              {isAr ? "لا توجد سجلات مطابقة." : "No audit entries found."}
            </div>
          ) : (
            <div className="space-y-2">
              {platformAuditLogs.map((a) => (
                <div
                  key={a.id}
                  className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 text-xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2"
                >
                  <div>
                    <div className="font-bold">
                      <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono text-[10px] me-2">
                        {a.actionType}
                      </span>
                      <span>{a.details}</span>
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      {a.actorEmail} · {a.targetTenantSlug || "platform"} · {a.targetEntityType}:{a.targetEntityId}
                    </div>
                  </div>
                  <div dir="ltr" className="font-mono text-[11px] text-slate-400 shrink-0">
                    {formatDateTime(a.timestamp)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Confirmation Dialog */}
      {confirmDialog && (
        <div className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-5 space-y-4 shadow-2xl">
            <div className="flex items-start gap-2.5">
              <AlertTriangle
                className={`w-5 h-5 shrink-0 mt-0.5 ${
                  confirmDialog.tone === "danger"
                    ? "text-rose-600"
                    : confirmDialog.tone === "warning"
                    ? "text-amber-600"
                    : "text-emerald-600"
                }`}
              />
              <div>
                <h4 className="font-black text-sm">{confirmDialog.title}</h4>
                <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 leading-relaxed">
                  {confirmDialog.message}
                </p>
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-bold mb-1">
                {confirmDialog.reasonLabel || (isAr ? "ملاحظة / سبب (اختياري)" : "Reason / Note (optional)")}
              </label>
              <input
                type="text"
                value={confirmReason}
                onChange={(e) => setConfirmReason(e.target.value)}
                placeholder={isAr ? "اكتب السبب للتوثيق في سجل التدقيق..." : "Enter audit note..."}
                className="w-full min-h-[38px] rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 text-xs"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                disabled={actionBusy}
                onClick={() => setConfirmDialog(null)}
                className="min-h-[38px] px-4 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-bold"
              >
                {isAr ? "إلغاء" : "Cancel"}
              </button>
              <button
                type="button"
                disabled={actionBusy || (confirmDialog.requireReason && !confirmReason.trim())}
                onClick={() => void runConfirmedAction()}
                className={`min-h-[38px] px-4 rounded-xl text-white text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-50 ${
                  confirmDialog.tone === "danger"
                    ? "bg-rose-600 hover:bg-rose-700"
                    : confirmDialog.tone === "warning"
                    ? "bg-amber-600 hover:bg-amber-700"
                    : "bg-emerald-600 hover:bg-emerald-700"
                }`}
              >
                {actionBusy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>{isAr ? "تأكيد التنفيذ" : "Confirm"}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
