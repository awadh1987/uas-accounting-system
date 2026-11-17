"use client";

import React, { useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  FileCheck,
  Globe2,
  HardDrive,
  KeyRound,
  MessageCircle,
  Network,
  QrCode,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Upload,
  X,
} from "lucide-react";
import { generateQrMatrix } from "@/lib/formulas";

export interface LicenseStatusData {
  request_code: string;
  hwid: string;
  active_mode: "local" | "lan" | "cloud";
  license_status: "ACTIVE" | "UNLICENSED" | "EXPIRED" | "HWID_MISMATCH" | "CLOCK_TAMPER" | "SEAT_LIMIT_REACHED" | "MODE_NOT_ALLOWED";
  is_valid: boolean;
  error?: string | null;
  customer_name?: string | null;
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
  onClose?: () => void;
  onRefreshStatus: () => void;
  onToast: (msg: string) => void;
}

export function LicenseActivationModal({
  open,
  statusData,
  lang,
  onClose,
  onRefreshStatus,
  onToast,
}: LicenseActivationModalProps) {
  const isAr = lang === "ar";
  const [activeTab, setActiveTab] = useState<"activate" | "request" | "mode">("activate");
  const [copiedCode, setCopiedCode] = useState(false);
  const [serialKey, setSerialKey] = useState("");
  const [activating, setActivating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Runtime Mode Switcher State
  const [selectedMode, setSelectedMode] = useState<"local" | "lan" | "cloud">(
    statusData?.active_mode || "local"
  );
  const [switchingMode, setSwitchingMode] = useState(false);

  if (!open) return null;

  const requestCode = statusData?.request_code || "REQ-0000-0000-0000-0000";
  const { cells, codeHash } = generateQrMatrix(requestCode, 11);

  function handleCopyRequestCode() {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(requestCode);
      setCopiedCode(true);
      onToast(isAr ? "تم نسخ رمز طلب الترخيص" : "Request Code copied to clipboard");
      setTimeout(() => setCopiedCode(false), 2500);
    }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    setErrorMsg(null);
    setSuccessMsg(null);
    const file = e.target.files?.[0];
    if (!file) return;

    setActivating(true);
    try {
      const text = await file.text();
      const res = await fetch("/api/licensing/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ licenseFileContent: text }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || (isAr ? "فشل تفعيل ملف الترخيص" : "Failed to activate license"));
      }

      setSuccessMsg(
        isAr
          ? "تم تفعيل الترخيص بنجاح وتوثيقه على هذا الجهاز!"
          : "License successfully activated and bound to hardware!"
      );
      onToast(isAr ? "تم التفعيل بنجاح!" : "Activated successfully!");
      onRefreshStatus();
    } catch (err: any) {
      setErrorMsg(err?.message || (isAr ? "خطأ في قراءة ملف الترخيص" : "Invalid license file"));
    } finally {
      setActivating(false);
      e.target.value = "";
    }
  }

  async function handleSerialActivate(e: React.FormEvent) {
    e.preventDefault();
    if (!serialKey.trim()) return;

    setErrorMsg(null);
    setSuccessMsg(null);
    setActivating(true);

    try {
      const res = await fetch("/api/licensing/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activationKey: serialKey.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || (isAr ? "فشل التفعيل عبر المفتاح" : "Failed to activate with serial"));
      }

      setSuccessMsg(
        isAr
          ? "تم تفعيل الترخيص بنجاح!"
          : "License activated successfully!"
      );
      onToast(isAr ? "تم تفعيل المنظومة بنجاح" : "System activated successfully");
      setSerialKey("");
      onRefreshStatus();
    } catch (err: any) {
      setErrorMsg(err?.message || (isAr ? "مفتاح التفعيل غير صالح" : "Invalid serial key"));
    } finally {
      setActivating(false);
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-950/80 backdrop-blur-md overflow-y-auto">
      <div className="relative w-full max-w-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl p-6 sm:p-8 space-y-6 my-auto text-slate-900 dark:text-slate-100">
        {/* Header & Status Indicator */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-5">
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-black bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>UAS Ed25519 Cryptographic Licensing</span>
            </div>
            <h2 className="text-xl sm:text-2xl font-black">
              {isAr ? "إدارة الترخيص وبيئة التشغيل" : "License & Runtime Orchestration"}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {isAr
                ? "تفعيل المنظومة برمز العتاد المشفر وضبط خادم الشبكة المحلية أو السحابية"
                : "Hardware-bound cryptographic activation and Local/LAN/Cloud configuration"}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onRefreshStatus}
              className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 transition"
              title={isAr ? "تحديث الحالة" : "Refresh Status"}
            >
              <RefreshCw className="w-4 h-4" />
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
              : status === "CLOCK_TAMPER"
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
                    ? `مرخص بنجاح: ${statusData?.customer_name || "مؤسسة معتمدة"}`
                    : `Active License: ${statusData?.customer_name || "Authorized Enterprise"}`
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
                      ? `رقم الترخيص: ${statusData?.license_id} • متبقي ${statusData?.remaining_days} يوماً`
                      : `ID: ${statusData?.license_id} • ${statusData?.remaining_days} days remaining`
                    : isAr
                    ? "يرجى نسخ رمز طلب الترخيص أدناه وإرساله للبائع أو رفع ملف الترخيص"
                    : "Please send Request Code below or upload your .uas license file")}
              </div>
            </div>
          </div>

          <div className="text-end shrink-0">
            <span className="font-mono text-xs px-2.5 py-1 rounded-lg bg-white/70 dark:bg-black/30 border border-current">
              {status}
            </span>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex border-b border-slate-200 dark:border-slate-800">
          <button
            type="button"
            onClick={() => setActiveTab("activate")}
            className={`pb-2.5 px-4 text-xs font-black border-b-2 transition flex items-center gap-1.5 ${
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
            onClick={() => setActiveTab("request")}
            className={`pb-2.5 px-4 text-xs font-black border-b-2 transition flex items-center gap-1.5 ${
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
            className={`pb-2.5 px-4 text-xs font-black border-b-2 transition flex items-center gap-1.5 ${
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
          <div className="space-y-5">
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
                  accept=".uas,.json"
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

        {/* Tab 2: Machine Request Code */}
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
                <a
                  href={`https://wa.me/?text=${encodeURIComponent(
                    `طلب ترخيص منظومة UAS ERP:\nاسم المؤسسة:\nرمز الجهاز: ${requestCode}`
                  )}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 text-xs font-bold hover:bg-emerald-500/20 transition"
                >
                  <MessageCircle className="w-3.5 h-3.5" />
                  <span>{isAr ? "إرسال عبر واتساب" : "Send via WhatsApp"}</span>
                </a>
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

        {/* Tab 3: Runtime Mode Switcher */}
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
          <span>UAS Accounting System • Hardware-Bound Cryptographic Engine</span>
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
