"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Building2,
  Check,
  CheckCircle2,
  Copy,
  FileCheck,
  Globe2,
  HardDrive,
  KeyRound,
  Laptop,
  MessageCircle,
  Network,
  QrCode,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Trash2,
  Upload,
  Users,
  X,
} from "lucide-react";
import { generateQrMatrix } from "@/lib/formulas";
import { openExternalOrWhatsApp } from "@/lib/nativeBridge";
import {
  activateOfflineClientLicense,
  detectClientPlatform,
  getClientDeviceHwid,
  getOfflineClientSeatUsage,
  releaseOfflineClientSeat,
  type SeatPlatform,
  type SeatUsage,
  type SeatUserUsage,
} from "@/lib/licensing";
import type { UasEnterpriseProfile, UasUser } from "@/types/uas";

export interface LicenseStatusData {
  request_code: string;
  hwid: string;
  active_mode: "local" | "lan" | "cloud";
  license_status:
    | "ACTIVE"
    | "UNLICENSED"
    | "EXPIRED"
    | "HWID_MISMATCH"
    | "CLOCK_TAMPER"
    | "SEAT_LIMIT_REACHED"
    | "MODE_NOT_ALLOWED"
    | "COMPANY_MISMATCH";
  is_valid: boolean;
  error?: string | null;
  customer_name?: string | null;
  company_name?: string | null;
  company_locked?: boolean;
  company_matches?: boolean | null;
  seat_managed?: boolean;
  max_users?: number | null;
  per_user_devices?: { windows: number; android: number } | null;
  seats?: {
    used_users: number;
    max_users: number;
    windows_bound: number;
    android_bound: number;
  } | null;
  license_id?: string | null;
  allowed_modes: ("local" | "lan" | "cloud")[];
  max_branches: number;
  max_lan_seats: number;
  active_seats: number;
  expires_at?: string | null;
  issued_at?: string | null;
  remaining_days: number;
  server_lan_ips: string[];
  lan_url: string;
  cloud_url?: string;
}

interface LicenseActivationModalProps {
  open: boolean;
  statusData: LicenseStatusData | null;
  lang: "ar" | "en";
  currentUser?: UasUser | null;
  enterpriseProfile?: UasEnterpriseProfile | null;
  onClose?: () => void;
  onRefreshStatus: () => void;
  onToast: (msg: string) => void;
}

interface SeatDetailsResponse {
  success: boolean;
  seat_managed: boolean;
  company_name?: string;
  license_id?: string;
  can_manage?: boolean;
  usage?: SeatUsage;
}

export function LicenseActivationModal({
  open,
  statusData,
  lang,
  currentUser,
  enterpriseProfile,
  onClose,
  onRefreshStatus,
  onToast,
}: LicenseActivationModalProps) {
  const isAr = lang === "ar";
  const [activeTab, setActiveTab] = useState<"activate" | "seats" | "request" | "mode">("activate");
  const [copiedCode, setCopiedCode] = useState(false);
  const [serialKey, setSerialKey] = useState("");
  const [companyNameInput, setCompanyNameInput] = useState("");
  const [userEmailInput, setUserEmailInput] = useState("");
  const [activating, setActivating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Seat usage & SUPER_ADMIN seat release state
  const [seatDetails, setSeatDetails] = useState<SeatDetailsResponse | null>(null);
  const [loadingSeats, setLoadingSeats] = useState(false);
  const [releasingKey, setReleasingKey] = useState<string | null>(null);
  const [manualReleaseEmail, setManualReleaseEmail] = useState("");
  const [manualReleasePlatform, setManualReleasePlatform] = useState<SeatPlatform | "all">("all");

  // Runtime Mode Switcher State
  const [selectedMode, setSelectedMode] = useState<"local" | "lan" | "cloud">(
    statusData?.active_mode || "local"
  );
  const [switchingMode, setSwitchingMode] = useState(false);

  const isSuperAdmin =
    String(currentUser?.role || "").trim().toUpperCase() === "SUPER_ADMIN" ||
    Boolean(seatDetails?.can_manage);

  // Sync defaults when modal opens or status changes
  useEffect(() => {
    if (statusData?.active_mode) {
      setSelectedMode(statusData.active_mode);
    }
  }, [statusData?.active_mode]);

  useEffect(() => {
    if (!companyNameInput) {
      const candidate =
        statusData?.company_name ||
        (enterpriseProfile?.isConfigured ? enterpriseProfile.legalNameAr : "") ||
        "";
      if (candidate && candidate !== "اسم المنشأة" && candidate !== "Enterprise Name") {
        setCompanyNameInput(candidate);
      }
    }
  }, [statusData?.company_name, enterpriseProfile?.isConfigured, enterpriseProfile?.legalNameAr, companyNameInput]);

  useEffect(() => {
    if (currentUser?.email && !userEmailInput) {
      setUserEmailInput(currentUser.email);
    }
  }, [currentUser?.email, userEmailInput]);

  const fetchSeatDetails = useCallback(async () => {
    setLoadingSeats(true);
    try {
      const headers: Record<string, string> = {};
      if (currentUser?.id) headers["x-uas-user-id"] = currentUser.id;
      if (currentUser?.role) headers["x-uas-role"] = String(currentUser.role);
      const res = await fetch("/api/licensing/seats", { headers });
      if (res.ok) {
        const data = (await res.json()) as SeatDetailsResponse;
        setSeatDetails(data);
        return;
      }
    } catch {
      // Fall back to offline Capacitor seat store
    }
    try {
      const offline = await getOfflineClientSeatUsage({
        actorRole: currentUser?.role ? String(currentUser.role) : "SUPER_ADMIN",
      });
      setSeatDetails(offline as SeatDetailsResponse);
    } catch {
      // ignore
    } finally {
      setLoadingSeats(false);
    }
  }, [currentUser?.id, currentUser?.role]);

  useEffect(() => {
    if (open) {
      fetchSeatDetails();
    }
  }, [open, fetchSeatDetails]);

  if (!open) return null;

  const requestCode = statusData?.request_code || "REQ-0000-0000-0000-0000";
  const { cells, codeHash } = generateQrMatrix(requestCode, 11);

  const maxUsers =
    seatDetails?.usage?.maxUsers ??
    statusData?.seats?.max_users ??
    statusData?.max_users ??
    7;
  const usedUsers =
    seatDetails?.usage?.usedUsers ??
    statusData?.seats?.used_users ??
    0;
  const windowsBound =
    seatDetails?.usage?.windowsBound ??
    statusData?.seats?.windows_bound ??
    0;
  const androidBound =
    seatDetails?.usage?.androidBound ??
    statusData?.seats?.android_bound ??
    0;
  const perUserWin =
    seatDetails?.usage?.perUserDevices?.windows ??
    statusData?.per_user_devices?.windows ??
    1;
  const perUserAndroid =
    seatDetails?.usage?.perUserDevices?.android ??
    statusData?.per_user_devices?.android ??
    1;
  const boundUsers: SeatUserUsage[] = Array.isArray(seatDetails?.usage?.users)
    ? (seatDetails?.usage?.users as SeatUserUsage[])
    : [];

  function handleCopyRequestCode() {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(requestCode);
      setCopiedCode(true);
      onToast(isAr ? "تم نسخ رمز طلب الترخيص" : "Request Code copied to clipboard");
      setTimeout(() => setCopiedCode(false), 2500);
    }
  }

  async function runActivationRequest(payload: {
    licenseFileContent?: string;
    activationKey?: string;
  }) {
    setErrorMsg(null);
    setSuccessMsg(null);
    setActivating(true);

    const platform = detectClientPlatform();
    const clientHwid = getClientDeviceHwid();
    const effectiveEmail = (userEmailInput || currentUser?.email || "").trim();
    const effectiveCompany = companyNameInput.trim();

    try {
      let handledByServer = false;
      try {
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (currentUser?.id) headers["x-uas-user-id"] = currentUser.id;
        if (currentUser?.role) headers["x-uas-role"] = String(currentUser.role);

        const res = await fetch("/api/licensing/activate", {
          method: "POST",
          headers,
          body: JSON.stringify({
            ...payload,
            companyName: effectiveCompany || undefined,
            userEmail: effectiveEmail || undefined,
            platform,
          }),
        });
        const isJson = (res.headers.get("content-type") || "").includes("application/json");
        if ((res.status === 404 || res.status === 405) && !isJson) {
          throw new Error("STATIC_EXPORT_OFFLINE_ACTIVATE");
        }
        handledByServer = true;
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || (isAr ? "فشل تفعيل الترخيص" : "Failed to activate license"));
        }
      } catch (serverErr: any) {
        if (handledByServer) {
          throw serverErr;
        }
        // Offline / Capacitor static export fallback
        const offlineRes = await activateOfflineClientLicense({
          ...payload,
          confirmCompanyName: effectiveCompany || undefined,
          userEmail: effectiveEmail || undefined,
          platform,
          hwid: clientHwid,
        });
        if (!offlineRes.success) {
          throw new Error(offlineRes.error);
        }
      }

      setSuccessMsg(
        isAr
          ? "تم تفعيل الترخيص بنجاح وتوثيقه مشفراً مع قفل اسم المنشأة ومقعد المستخدم!"
          : "License activated, company lock verified, and device seat bound!"
      );
      onToast(isAr ? "تم تفعيل المنظومة بنجاح" : "System activated successfully");
      if (payload.activationKey) setSerialKey("");
      onRefreshStatus();
      await fetchSeatDetails();
    } catch (err: any) {
      setErrorMsg(err?.message || (isAr ? "فشل التفعيل" : "Activation failed"));
    } finally {
      setActivating(false);
    }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      await runActivationRequest({ licenseFileContent: text });
    } finally {
      e.target.value = "";
    }
  }

  async function handleSerialActivate(e: React.FormEvent) {
    e.preventDefault();
    if (!serialKey.trim()) return;
    await runActivationRequest({ activationKey: serialKey.trim() });
  }

  async function handleReleaseSeat(targetEmail: string, targetPlatform: SeatPlatform | "all") {
    const cleanEmail = targetEmail.trim().toLowerCase();
    if (!cleanEmail) return;

    const actionKey = `${cleanEmail}:${targetPlatform}`;
    setReleasingKey(actionKey);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      let handledByServer = false;
      try {
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (currentUser?.id) headers["x-uas-user-id"] = currentUser.id;
        if (currentUser?.role) headers["x-uas-role"] = String(currentUser.role);

        const res = await fetch("/api/licensing/seats/release", {
          method: "POST",
          headers,
          body: JSON.stringify({
            userEmail: cleanEmail,
            platform: targetPlatform,
            actor: {
              userId: currentUser?.id || "u1",
              userRole: currentUser?.role || "SUPER_ADMIN",
            },
          }),
        });
        const isJson = (res.headers.get("content-type") || "").includes("application/json");
        if ((res.status === 404 || res.status === 405) && !isJson) {
          throw new Error("STATIC_EXPORT_OFFLINE_RELEASE");
        }
        handledByServer = true;
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(
            data.error || (isAr ? "فشل إلغاء ربط الجهاز" : "Failed to release device seat")
          );
        }
      } catch (serverErr: any) {
        if (handledByServer) throw serverErr;
        const offlineRes = await releaseOfflineClientSeat({
          userEmail: cleanEmail,
          platform: targetPlatform,
          actorRole: currentUser?.role ? String(currentUser.role) : "SUPER_ADMIN",
        });
        if (!offlineRes.success) {
          throw new Error(offlineRes.error);
        }
      }

      const msg = isAr
        ? `تم إلغاء ربط الجهاز للمستخدم (${cleanEmail}) وتحرير المقعد بنجاح.`
        : `Released device seat for ${cleanEmail} (${targetPlatform}).`;
      setSuccessMsg(msg);
      onToast(msg);
      setManualReleaseEmail("");
      await fetchSeatDetails();
      onRefreshStatus();
    } catch (err: any) {
      setErrorMsg(err?.message || (isAr ? "تعذر إلغاء ربط الجهاز" : "Could not release seat"));
    } finally {
      setReleasingKey(null);
    }
  }

  async function handleSwitchMode(targetMode: "local" | "lan" | "cloud") {
    setSwitchingMode(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/system/runtime", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: targetMode }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "Failed to switch mode");
      }
      setSelectedMode(targetMode);
      onToast(
        isAr
          ? `تم تفعيل وضع: ${targetMode.toUpperCase()}`
          : `Switched to ${targetMode.toUpperCase()} mode`
      );
      onRefreshStatus();
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to switch runtime mode");
    } finally {
      setSwitchingMode(false);
    }
  }

  const status = statusData?.license_status || "UNLICENSED";
  const isValid = Boolean(statusData?.is_valid);
  const allowedModes = statusData?.allowed_modes || ["local"];
  const lockedCompanyName =
    statusData?.company_name ||
    seatDetails?.company_name ||
    statusData?.customer_name ||
    null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-950/80 backdrop-blur-md overflow-y-auto">
      <div className="relative w-full max-w-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl p-6 sm:p-8 space-y-5 my-auto text-slate-900 dark:text-slate-100">
        {/* Header & Status Indicator */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-5">
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-black bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>UAS Ed25519 Company-Locked Multi-Seat Licensing</span>
            </div>
            <h2 className="text-xl sm:text-2xl font-black">
              {isAr ? "إدارة الترخيص ومقاعد الأجهزة وبيئة التشغيل" : "License, Device Seats & Runtime"}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {isAr
                ? `ترخيص مؤسسي مقيد باسم المنشأة (${maxUsers} مستخدمين × [${perUserWin} ويندوز + ${perUserAndroid} أندرويد] لكل مستخدم)`
                : `Company-locked license (${maxUsers} Users × [${perUserWin} Windows + ${perUserAndroid} Android] per user)`}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                onRefreshStatus();
                fetchSeatDetails();
              }}
              className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 transition"
              title={isAr ? "تحديث الحالة" : "Refresh Status"}
            >
              <RefreshCw className={`w-4 h-4 ${loadingSeats ? "animate-spin" : ""}`} />
            </button>
            {isValid && onClose && (
              <button
                type="button"
                onClick={onClose}
                className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 transition"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Status Alert Banner */}
        <div
          className={`p-4 rounded-2xl border text-xs font-bold flex items-center justify-between gap-3 ${
            isValid
              ? "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200"
              : status === "CLOCK_TAMPER" || status === "COMPANY_MISMATCH"
              ? "bg-rose-50 dark:bg-rose-950/40 border-rose-300 dark:border-rose-800 text-rose-800 dark:text-rose-200"
              : status === "EXPIRED"
              ? "bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-200"
              : "bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200"
          }`}
        >
          <div className="flex items-center gap-2.5">
            {isValid ? (
              <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0" />
            ) : (
              <ShieldAlert className="w-5 h-5 text-rose-600 shrink-0" />
            )}
            <div>
              <div className="font-black text-sm">
                {isValid
                  ? isAr
                    ? `مرخص للمنشأة: ${lockedCompanyName || "مؤسسة معتمدة"}`
                    : `Licensed to: ${lockedCompanyName || "Authorized Enterprise"}`
                  : status === "COMPANY_MISMATCH"
                  ? isAr
                    ? "اسم المنشأة لا يطابق الترخيص المعتمد"
                    : "Company Name Mismatch Against License"
                  : status === "CLOCK_TAMPER"
                  ? isAr
                    ? "تنبيه أمان: تم اكتشاف تلاعب بساعة وتاريخ الجهاز"
                    : "Security Alert: Monotonic Clock Rollback Detected"
                  : status === "EXPIRED"
                  ? isAr
                    ? "انتهت صلاحية الترخيص الحالي"
                    : "License Has Expired"
                  : status === "HWID_MISMATCH"
                  ? isAr
                    ? "الترخيص مرتبط بجهاز كمبيوتر آخر"
                    : "Hardware Fingerprint Mismatch"
                  : isAr
                  ? "المنظومة غير مفعلة (تحتاج إلى ترخيص)"
                  : "System Unlicensed"}
              </div>
              <div className="text-[11px] opacity-80 mt-0.5">
                {statusData?.error ||
                  (isValid
                    ? isAr
                      ? `رقم الترخيص: ${statusData?.license_id} • متبقي ${statusData?.remaining_days} يوماً • المستخدمون: ${usedUsers} / ${maxUsers}`
                      : `ID: ${statusData?.license_id} • ${statusData?.remaining_days} days remaining • Seats: ${usedUsers} / ${maxUsers} Users`
                    : isAr
                    ? "يرجى إدخال اسم المنشأة المطابق للترخيص ورفع ملف .uas أو المفتاح التسلسلي"
                    : "Confirm company name below and upload your .uas file or enter your activation key")}
              </div>
            </div>
          </div>

          <div className="text-end shrink-0">
            <span className="font-mono text-xs px-2.5 py-1 rounded-lg bg-white/70 dark:bg-black/30 border border-current">
              {status}
            </span>
          </div>
        </div>

        {/* Live Seat Usage Indicator Bar (X / 7 Users, Windows & Android slots) */}
        <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
              <Users className="w-4 h-4" />
            </div>
            <div>
              <div className="font-black flex items-center gap-2">
                <span>
                  {isAr
                    ? `استهلاك المقاعد: ${usedUsers} / ${maxUsers} مستخدمين`
                    : `Active Seat Usage: ${usedUsers} / ${maxUsers} Users`}
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                  {usedUsers} / {maxUsers} Users
                </span>
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                {isAr
                  ? `الحصة لكل مستخدم: ${perUserWin} ويندوز + ${perUserAndroid} أندرويد • الأجهزة المربوطة: ${windowsBound} ويندوز / ${androidBound} أندرويد`
                  : `Quota per user: ${perUserWin} Windows + ${perUserAndroid} Android • Bound: ${windowsBound} Win / ${androidBound} Android`}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono text-[11px]">
              <Laptop className="w-3.5 h-3.5 text-sky-600" />
              <span>Win {windowsBound}/{maxUsers * perUserWin}</span>
            </span>
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono text-[11px]">
              <Smartphone className="w-3.5 h-3.5 text-emerald-600" />
              <span>Android {androidBound}/{maxUsers * perUserAndroid}</span>
            </span>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex flex-wrap border-b border-slate-200 dark:border-slate-800">
          <button
            type="button"
            onClick={() => setActiveTab("activate")}
            className={`pb-2.5 px-3.5 text-xs font-black border-b-2 transition flex items-center gap-1.5 ${
              activeTab === "activate"
                ? "border-emerald-600 text-emerald-600 dark:text-emerald-400"
                : "border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-white"
            }`}
          >
            <Upload className="w-3.5 h-3.5" />
            <span>{isAr ? "تفعيل الترخيص" : "Activate License"}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab("seats");
              fetchSeatDetails();
            }}
            className={`pb-2.5 px-3.5 text-xs font-black border-b-2 transition flex items-center gap-1.5 ${
              activeTab === "seats"
                ? "border-emerald-600 text-emerald-600 dark:text-emerald-400"
                : "border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-white"
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>
              {isAr
                ? `مقاعد الأجهزة (${usedUsers}/${maxUsers})`
                : `Device Seats (${usedUsers}/${maxUsers})`}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("request")}
            className={`pb-2.5 px-3.5 text-xs font-black border-b-2 transition flex items-center gap-1.5 ${
              activeTab === "request"
                ? "border-emerald-600 text-emerald-600 dark:text-emerald-400"
                : "border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-white"
            }`}
          >
            <QrCode className="w-3.5 h-3.5" />
            <span>{isAr ? "رمز طلب الترخيص" : "Request Code"}</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("mode")}
            className={`pb-2.5 px-3.5 text-xs font-black border-b-2 transition flex items-center gap-1.5 ${
              activeTab === "mode"
                ? "border-emerald-600 text-emerald-600 dark:text-emerald-400"
                : "border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-white"
            }`}
          >
            <Network className="w-3.5 h-3.5" />
            <span>{isAr ? "وضع التشغيل (LAN / Cloud)" : "Runtime Mode"}</span>
          </button>
        </div>

        {errorMsg && (
          <div className="p-3.5 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs font-bold flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {successMsg && (
          <div className="p-3.5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-xs font-bold flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* Tab 1: Activate License */}
        {activeTab === "activate" && (
          <div className="space-y-4">
            {/* Company Name Confirmation & User Seat Email */}
            <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/40 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-emerald-600" />
                  <h4 className="font-extrabold text-xs">
                    {isAr
                      ? "تأكيد اسم المنشأة وحساب المستخدم (Company Lock & User Seat)"
                      : "Company Name Lock & User Seat Confirmation"}
                  </h4>
                </div>
                {lockedCompanyName && (
                  <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                    {isAr ? `مقفل على: ${lockedCompanyName}` : `Locked: ${lockedCompanyName}`}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                    {isAr
                      ? "اسم المنشأة المطابق للترخيص (Company Name)"
                      : "Confirmed Company Name"}
                  </label>
                  <input
                    type="text"
                    data-testid="license-company-name-input"
                    value={companyNameInput}
                    onChange={(e) => setCompanyNameInput(e.target.value)}
                    placeholder={
                      isAr
                        ? "مثال: شركة الجابري للتجارة"
                        : "e.g. Al-Jabri Trading Co."
                    }
                    className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                    {isAr
                      ? "البريد الإلكتروني للمستخدم (User Seat Email)"
                      : "User Email for Device Seat"}
                  </label>
                  <input
                    type="email"
                    data-testid="license-user-email-input"
                    value={userEmailInput}
                    onChange={(e) => setUserEmailInput(e.target.value)}
                    placeholder="user@company.com"
                    className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-mono font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                  />
                </div>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {isAr
                  ? "عند التفعيل لأول مرة يتم اعتماد اسم المنشأة تلقائياً، ويرفض النظام أي ترخيص لمنشأة أخرى أو تجاوز حد 7 مستخدمين × (1 ويندوز + 1 أندرويد)."
                  : "On first install the company profile is initialized to the licensed company name; mismatched company licenses or > 7 users × (1 Win + 1 Android) are blocked."}
              </p>
            </div>

            {/* Offline .uas File Uploader (USB flash drive buyers) */}
            <div className="p-5 rounded-2xl border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-emerald-500 dark:hover:border-emerald-500 transition text-center space-y-3 bg-slate-50/50 dark:bg-slate-950/30">
              <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 text-emerald-600 mx-auto flex items-center justify-center">
                <FileCheck className="w-5 h-5" />
              </div>
              <div>
                <h4 className="font-extrabold text-sm">
                  {isAr ? "رفع ملف الترخيص (.uas) — تفعيل فوري دون إنترنت" : "Upload .uas License File (100% Offline)"}
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  {isAr
                    ? "خاص بمشتري الفلاش ميموري USB أو التراخيص المرسلة عبر البريد/الواتساب"
                    : "For USB flash drive buyers or licenses received via WhatsApp/Email"}
                </p>
              </div>

              <label className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl accent-bg text-xs font-bold cursor-pointer shadow-sm hover:opacity-95 transition">
                <Upload className="w-3.5 h-3.5" />
                <span>{activating ? (isAr ? "جاري التحقق..." : "Validating...") : isAr ? "اختيار ملف license.uas" : "Choose license.uas"}</span>
                <input
                  type="file"
                  accept=".uas,.json,application/json,text/plain,*/*"
                  onChange={handleFileUpload}
                  disabled={activating}
                  className="hidden"
                />
              </label>
            </div>

            {/* Online Serial Key Input */}
            <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-3">
              <div className="flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-emerald-600" />
                <h4 className="font-bold text-xs">
                  {isAr ? "التفعيل عبر المفتاح التسلسلي الرقمي (Online Serial Key)" : "Online Serial Activation Key"}
                </h4>
              </div>

              <form onSubmit={handleSerialActivate} className="flex gap-2">
                <input
                  type="text"
                  value={serialKey}
                  onChange={(e) => setSerialKey(e.target.value)}
                  placeholder="UASKEY-..."
                  className="flex-1 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/50 px-3.5 py-2 text-xs font-mono font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                />
                <button
                  type="submit"
                  disabled={activating || !serialKey.trim()}
                  className="px-4 py-2 rounded-xl accent-bg text-xs font-black shadow-sm disabled:opacity-50 transition"
                >
                  {activating ? (isAr ? "جاري التفعيل..." : "Activating...") : isAr ? "تفعيل" : "Activate"}
                </button>
              </form>
            </div>
          </div>
        )}

        {/* Tab 2: Seat Management & SUPER_ADMIN Device Seat Release */}
        {activeTab === "seats" && (
          <div className="space-y-4">
            <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-extrabold">
                  {isAr
                    ? `جدول مقاعد المستخدمين (${usedUsers} / ${maxUsers}Users)`
                    : `Licensed User Seats (${usedUsers} / ${maxUsers} Users)`}
                </div>
                <span className="text-[11px] font-mono text-slate-500">
                  {perUserWin} Windows + {perUserAndroid} Android / User
                </span>
              </div>

              {boundUsers.length === 0 ? (
                <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs text-slate-500 text-center">
                  {isAr
                    ? "لا توجد أجهزة مربوطة حالياً بهذا الترخيص."
                    : "No active device seats bound to this license yet."}
                </div>
              ) : (
                <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                  {boundUsers.map((u) => (
                    <div
                      key={u.userEmail}
                      className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs"
                    >
                      <div className="space-y-1">
                        <div className="font-mono font-bold text-slate-800 dark:text-slate-100">
                          {u.userEmail}
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-[11px]">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border ${
                              u.windows
                                ? "bg-sky-500/10 border-sky-500/30 text-sky-700 dark:text-sky-300"
                                : "bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-400"
                            }`}
                          >
                            <Laptop className="w-3 h-3" />
                            <span>
                              Windows: {u.windows ? `1/${perUserWin} (${u.windows.hwid.slice(0, 8)})` : `0/${perUserWin}`}
                            </span>
                          </span>

                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border ${
                              u.android
                                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300"
                                : "bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-400"
                            }`}
                          >
                            <Smartphone className="w-3 h-3" />
                            <span>
                              Android: {u.android ? `1/${perUserAndroid} (${u.android.hwid.slice(0, 8)})` : `0/${perUserAndroid}`}
                            </span>
                          </span>
                        </div>
                      </div>

                      {isSuperAdmin && (
                        <div className="flex flex-wrap items-center gap-1.5">
                          {u.windows && (
                            <button
                              type="button"
                              onClick={() => handleReleaseSeat(u.userEmail, "windows")}
                              disabled={releasingKey === `${u.userEmail}:windows`}
                              className="px-2.5 py-1 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-700 dark:text-rose-300 border border-rose-500/30 text-[11px] font-bold inline-flex items-center gap-1 transition disabled:opacity-50"
                            >
                              <Trash2 className="w-3 h-3" />
                              <span>{isAr ? "إلغاء ربط ويندوز" : "Release Win"}</span>
                            </button>
                          )}
                          {u.android && (
                            <button
                              type="button"
                              onClick={() => handleReleaseSeat(u.userEmail, "android")}
                              disabled={releasingKey === `${u.userEmail}:android`}
                              className="px-2.5 py-1 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-700 dark:text-rose-300 border border-rose-500/30 text-[11px] font-bold inline-flex items-center gap-1 transition disabled:opacity-50"
                            >
                              <Trash2 className="w-3 h-3" />
                              <span>{isAr ? "إلغاء ربط أندرويد" : "Release Android"}</span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleReleaseSeat(u.userEmail, "all")}
                            disabled={releasingKey === `${u.userEmail}:all`}
                            className="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-bold inline-flex items-center gap-1 transition disabled:opacity-50"
                          >
                            <Trash2 className="w-3 h-3" />
                            <span>{isAr ? "إلغاء ربط الجهاز / Release Device Seat" : "Release Device Seat"}</span>
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Direct SUPER_ADMIN Release Device Seat panel */}
            {isSuperAdmin && (
              <div className="p-4 rounded-2xl border border-rose-200 dark:border-rose-900/50 bg-rose-50/40 dark:bg-rose-950/20 space-y-3">
                <div className="text-xs font-extrabold text-rose-800 dark:text-rose-200 flex items-center gap-2">
                  <Trash2 className="w-4 h-4" />
                  <span>
                    {isAr
                      ? "إلغاء ربط الجهاز / Release Device Seat (مدير النظام العام SUPER_ADMIN)"
                      : "إلغاء ربط الجهاز / Release Device Seat (SUPER_ADMIN)"}
                  </span>
                </div>
                <p className="text-[11px] text-slate-600 dark:text-slate-400">
                  {isAr
                    ? "تحرير مقعد جهاز كمبيوتر أو هاتف مفقود/مستبدل لإتاحة التفعيل على جهاز جديد."
                    : "Free a lost or replaced laptop/phone seat so the user can activate on a replacement device."}
                </p>

                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="email"
                    value={manualReleaseEmail}
                    onChange={(e) => setManualReleaseEmail(e.target.value)}
                    placeholder={isAr ? "البريد الإلكتروني للمستخدم (user@company.com)" : "User email (user@company.com)"}
                    className="flex-1 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-mono font-bold"
                  />
                  <select
                    value={manualReleasePlatform}
                    onChange={(e) => setManualReleasePlatform(e.target.value as SeatPlatform | "all")}
                    className="rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-bold"
                  >
                    <option value="all">{isAr ? "جميع الأجهزة (Win + Android)" : "All Devices (Win + Android)"}</option>
                    <option value="windows">{isAr ? "جهاز ويندوز فقط (Windows)" : "Windows Only"}</option>
                    <option value="android">{isAr ? "جهاز أندرويد فقط (Android)" : "Android Only"}</option>
                  </select>
                  <button
                    type="button"
                    data-testid="release-device-seat-btn"
                    onClick={() => handleReleaseSeat(manualReleaseEmail, manualReleasePlatform)}
                    disabled={!manualReleaseEmail.trim() || Boolean(releasingKey)}
                    className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-black inline-flex items-center justify-center gap-1.5 disabled:opacity-50 transition"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>إلغاء ربط الجهاز / Release Device Seat</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tab 3: Machine Request Code */}
        {activeTab === "request" && (
          <div className="space-y-4">
            <div className="p-5 rounded-2xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 space-y-3">
              <div className="text-xs font-bold text-slate-500 dark:text-slate-400">
                {isAr ? "رمز تعريف الجهاز الفريد (Machine Request Code):" : "Machine Request Code:"}
              </div>

              <div className="flex items-center justify-between gap-3 bg-white dark:bg-slate-900 p-3.5 rounded-xl border border-slate-300 dark:border-slate-700">
                <span className="font-mono text-base font-black text-emerald-600 dark:text-emerald-400 tracking-wider select-all">
                  {requestCode}
                </span>

                <button
                  type="button"
                  onClick={handleCopyRequestCode}
                  className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-bold flex items-center gap-1.5 transition"
                >
                  {copiedCode ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedCode ? (isAr ? "تم النسخ" : "Copied") : isAr ? "نسخ" : "Copy"}</span>
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() =>
                    openExternalOrWhatsApp({
                      text: `طلب ترخيص منظومة UAS ERP:\nاسم المؤسسة: ${companyNameInput || ""}\nرمز الجهاز: ${requestCode}`,
                    })
                  }
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 text-xs font-bold hover:bg-emerald-500/20 transition"
                >
                  <MessageCircle className="w-3.5 h-3.5" />
                  <span>{isAr ? "إرسال عبر واتساب" : "Send via WhatsApp"}</span>
                </button>
              </div>
            </div>

            {/* QR Code Presentation */}
            <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 flex items-center gap-5">
              <svg
                width="74"
                height="74"
                viewBox="0 0 74 74"
                className="bg-white p-1 rounded-xl border border-slate-200 shrink-0"
              >
                {cells.map((cell, idx) => (
                  <rect
                    key={idx}
                    x={cell.c * 6 + 4}
                    y={cell.r * 6 + 4}
                    width="5"
                    height="5"
                    fill="#065f46"
                    rx="1"
                  />
                ))}
              </svg>

              <div className="text-xs space-y-1 text-slate-500 dark:text-slate-400">
                <div className="font-bold text-slate-800 dark:text-slate-200">
                  {isAr ? "مسح الرمز عبر الهاتف الذكي" : "Scan Request Code with Phone"}
                </div>
                <div className="text-[11px] font-mono text-emerald-600 font-bold">
                  ID: {codeHash}
                </div>
                <p>
                  {isAr
                    ? "يمكن للبائع أو مهندس الدعم الفني مسح هذا الرمز مباشرة لإصدار ملف ترخيص (.uas) فوري لجهازك."
                    : "Support engineers can scan this QR code to generate and issue your license immediately."}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Tab 4: Runtime Mode Switcher */}
        {activeTab === "mode" && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {/* Local Mode */}
              <button
                type="button"
                onClick={() => handleSwitchMode("local")}
                disabled={switchingMode || !allowedModes.includes("local")}
                className={`p-4 rounded-2xl border text-start space-y-2 transition relative ${
                  selectedMode === "local"
                    ? "border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/30 ring-2 ring-emerald-500/30"
                    : "border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700"
                } ${!allowedModes.includes("local") ? "opacity-50 cursor-not-allowed" : ""}`}
              >
                <div className="w-8 h-8 rounded-xl bg-slate-200 dark:bg-slate-800 flex items-center justify-center text-slate-700 dark:text-slate-300">
                  <HardDrive className="w-4 h-4" />
                </div>
                <div className="font-extrabold text-xs">
                  {isAr ? "محلي (Standalone)" : "Local Single PC"}
                </div>
                <div className="text-[11px] text-slate-400">127.0.0.1:3000</div>
              </button>

              {/* LAN Server Mode */}
              <button
                type="button"
                onClick={() => handleSwitchMode("lan")}
                disabled={switchingMode || !allowedModes.includes("lan")}
                className={`p-4 rounded-2xl border text-start space-y-2 transition relative ${
                  selectedMode === "lan"
                    ? "border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/30 ring-2 ring-emerald-500/30"
                    : "border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700"
                } ${!allowedModes.includes("lan") ? "opacity-50 cursor-not-allowed" : ""}`}
              >
                <div className="w-8 h-8 rounded-xl bg-indigo-500/10 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                  <Network className="w-4 h-4" />
                </div>
                <div className="font-extrabold text-xs">
                  {isAr ? "خادم شبكة (Office LAN)" : "Office LAN Server"}
                </div>
                <div className="text-[11px] text-slate-400">0.0.0.0:3000</div>
              </button>

              {/* Cloud Mode */}
              <button
                type="button"
                onClick={() => handleSwitchMode("cloud")}
                disabled={switchingMode || !allowedModes.includes("cloud")}
                className={`p-4 rounded-2xl border text-start space-y-2 transition relative ${
                  selectedMode === "cloud"
                    ? "border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/30 ring-2 ring-emerald-500/30"
                    : "border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700"
                } ${!allowedModes.includes("cloud") ? "opacity-50 cursor-not-allowed" : ""}`}
              >
                <div className="w-8 h-8 rounded-xl bg-amber-500/10 flex items-center justify-center text-amber-600 dark:text-amber-400">
                  <Globe2 className="w-4 h-4" />
                </div>
                <div className="font-extrabold text-xs">
                  {isAr ? "سحابي (Cloud Hosted)" : "Cloud Server"}
                </div>
                <div className="text-[11px] text-slate-400">https://qat.world</div>
              </button>
            </div>

            {/* Mode Details Box */}
            {selectedMode === "lan" && (
              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800 space-y-2 text-xs">
                <div className="font-bold flex items-center justify-between">
                  <span>{isAr ? "رابط الوصول عبر الشبكة المحلية:" : "Office LAN URL:"}</span>
                  <span className="font-mono text-emerald-600 font-black">{statusData?.lan_url}</span>
                </div>
                <div className="text-slate-500 dark:text-slate-400 text-[11px]">
                  {isAr
                    ? `الأجهزة المتصلة حالياً: ${statusData?.active_seats || 1} من أصل ${statusData?.max_lan_seats || 10} مقاعد مسموحة.`
                    : `Active Workstations: ${statusData?.active_seats || 1} of ${statusData?.max_lan_seats || 10} allowed LAN seats.`}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Footer info */}
        <div className="flex items-center justify-between text-[11px] text-slate-400 pt-2 border-t border-slate-100 dark:border-slate-800">
          <span>UAS Accounting System • Company-Locked Multi-Seat Ed25519 Engine</span>
          {isValid && onClose && (
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 rounded-xl accent-bg font-bold text-xs"
            >
              {isAr ? "متابعة إلى النظام" : "Continue to System"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
