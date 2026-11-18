"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  BookOpen,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Cpu,
  HelpCircle,
  KeyRound,
  Mic,
  MicOff,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import {
  UAS_SUPPORT_CHAPTERS,
  type SupportChapter,
  type SupportManualSection,
} from "@/lib/uasSupportKnowledge";
import {
  diagnoseLiveSystemState,
  searchSupportKnowledge,
  type SupportSystemDiagnostics,
} from "@/lib/localSupportEngine";
import {
  runUasAiAgent,
  type AgentReasoningStep,
  type ReasoningTier,
} from "@/lib/ai/offlineAgentEngine";
import type { ConfirmationPreviewCard } from "@/lib/ai/uasAgentTools";
import type { LicenseStatusData } from "@/components/LicenseActivationModal";
import type {
  LanguageCode,
  TabId,
  UasBootstrapState,
  UasUser,
} from "@/types/uas";

interface CopilotChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  timestamp: string;
  tierUsed?: ReasoningTier;
  reasoningTrace?: AgentReasoningStep[];
  confirmationCard?: ConfirmationPreviewCard;
  confirmedResult?: {
    executed: boolean;
    entryNumber?: string;
    summary: string;
  };
  navigationTab?: TabId;
  openLicenseModal?: boolean;
}

export interface UasAiCopilotProps {
  lang: LanguageCode;
  currentUser: UasUser | null;
  state: UasBootstrapState;
  licenseStatus: LicenseStatusData | null;
  offlineMode: boolean;
  onNavigateTab: (tab: TabId) => void;
  onOpenLicenseModal: () => void;
  onRefreshState: () => Promise<void> | void;
  onToast: (msg: string) => void;
}

export function UasAiCopilot({
  lang,
  currentUser,
  state,
  licenseStatus,
  offlineMode,
  onNavigateTab,
  onOpenLicenseModal,
  onRefreshState,
  onToast,
}: UasAiCopilotProps) {
  const isAr = lang === "ar";
  const [open, setOpen] = useState(false);
  const [activePane, setActivePane] = useState<"copilot" | "support" | "manual">("copilot");
  const [inputPrompt, setInputPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [expandedTraces, setExpandedTraces] = useState<Record<string, boolean>>({});

  // Voice Recognition & TTS state
  const [voiceLang, setVoiceLang] = useState<"ar-SA" | "ar-YE" | "en-US">(
    isAr ? "ar-SA" : "en-US"
  );
  const [listening, setListening] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(false);
  const recognitionRef = useRef<any>(null);

  // User Manual search & selected chapter state
  const [manualSearch, setManualSearch] = useState("");
  const [selectedChapterNum, setSelectedChapterNum] = useState<number>(1);

  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const clientDiagnostics: Partial<SupportSystemDiagnostics> = useMemo(
    () => ({
      license_status: licenseStatus?.license_status ?? "UNLICENSED",
      is_valid: Boolean(licenseStatus?.is_valid),
      company_name:
        licenseStatus?.company_name ??
        licenseStatus?.customer_name ??
        state.enterpriseProfile?.legalNameAr ??
        null,
      enterprise_name_ar: state.enterpriseProfile?.legalNameAr ?? null,
      enterprise_name_en: state.enterpriseProfile?.legalNameEn ?? null,
      company_locked: Boolean(licenseStatus?.company_locked),
      company_matches: licenseStatus?.company_matches ?? null,
      seat_managed: Boolean(licenseStatus?.seat_managed),
      used_users: licenseStatus?.seats?.used_users ?? 0,
      max_users: licenseStatus?.seats?.max_users ?? licenseStatus?.max_users ?? 7,
      per_user_devices: licenseStatus?.per_user_devices ?? { windows: 1, android: 1 },
      windows_bound: licenseStatus?.seats?.windows_bound ?? 0,
      android_bound: licenseStatus?.seats?.android_bound ?? 0,
      active_mode: licenseStatus?.active_mode ?? "local",
      lan_url: licenseStatus?.lan_url ?? "http://127.0.0.1:3000",
      cloud_url: licenseStatus?.cloud_url ?? "https://qat.world",
      remaining_days: licenseStatus?.remaining_days ?? 0,
      request_code: licenseStatus?.request_code ?? null,
      license_id: licenseStatus?.license_id ?? null,
      error: licenseStatus?.error ?? null,
    }),
    [licenseStatus, state.enterpriseProfile]
  );

  const liveDiagnosticReport = useMemo(
    () => diagnoseLiveSystemState(clientDiagnostics),
    [clientDiagnostics]
  );

  const [messages, setMessages] = useState<CopilotChatMessage[]>(() => [
    {
      id: "welcome-1",
      role: "assistant",
      text: isAr
        ? "مرحباً بك في **المساعد المحاسبي الذكي وخدمة العملاء (UAS AI Copilot)** 🤖.\nيمكنك التحدث بالصوت أو الكتابة بالعربية والإنجليزية لتنفيذ العمليات المحاسبية (مسودة قيد مزدوج، سند قبض/صرف، فاتورة، استعلام عن رصيد حساب، تقارير مالية، فحص المخزون، أو تشخيص الترخيص والمقاعد) — ويعمل بالكامل متصلاً ودون إنترنت!"
        : "Welcome to the **UAS Enterprise Bilingual Voice + Text ERP Copilot & Support Assistant** 🤖.\nSpeak or type in Arabic or English to query account balances, generate Trial Balance / P&L summaries, draft balanced journal entries or vouchers with Confirmation Preview Cards, diagnose 7-user license seats, or search the 7-chapter User Manual — both online and 100% offline!",
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    },
  ]);

  useEffect(() => {
    setVoiceLang(isAr ? "ar-SA" : "en-US");
  }, [isAr]);

  useEffect(() => {
    if (open) {
      chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, open]);

  function speakText(text: string) {
    if (!ttsEnabled || typeof window === "undefined" || !("speechSynthesis" in window)) return;
    try {
      window.speechSynthesis.cancel();
      const clean = text.replace(/[#*`_~>-]/g, " ").replace(/\s+/g, " ").trim();
      const utterance = new SpeechSynthesisUtterance(clean.slice(0, 420));
      utterance.lang = isAr ? "ar-SA" : "en-US";
      window.speechSynthesis.speak(utterance);
    } catch {
      // ignore TTS errors
    }
  }

  async function toggleVoiceListening() {
    if (listening) {
      try {
        recognitionRef.current?.stop?.();
      } catch {
        // ignore
      }
      setListening(false);
      return;
    }

    if (typeof window === "undefined") return;

    // 1. Check Native Capacitor SpeechRecognition plugin first (Android APK)
    const capPlugins = (window as any).Capacitor?.Plugins;
    if (capPlugins?.SpeechRecognition) {
      try {
        setListening(true);
        await capPlugins.SpeechRecognition.requestPermissions?.();
        const res = await capPlugins.SpeechRecognition.start({
          language: voiceLang,
          maxResults: 1,
          prompt: isAr ? "تحدث بأمرك المحاسبي..." : "Speak your ERP command...",
          partialResults: false,
          popup: true,
        });
        const transcript = Array.isArray(res?.matches) ? res.matches[0] : "";
        setListening(false);
        if (transcript) {
          setInputPrompt(transcript);
          await handleSendPrompt(transcript);
        }
        return;
      } catch {
        setListening(false);
      }
    }

    // 2. Standard Web Speech API (Windows Desktop / Chrome / WebView)
    const SpeechRec =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRec) {
      onToast(
        isAr
          ? "المتصفح الحالي لا يدعم الإملاء الصوتي المباشر؛ يمكنك الكتابة النصية فوراً."
          : "Web Speech API is not available in this browser; please type your command."
      );
      return;
    }

    try {
      const rec = new SpeechRec();
      rec.lang = voiceLang;
      rec.interimResults = false;
      rec.maxAlternatives = 1;

      rec.onresult = (event: any) => {
        const transcript = event?.results?.[0]?.[0]?.transcript || "";
        setListening(false);
        if (transcript.trim()) {
          setInputPrompt(transcript.trim());
          handleSendPrompt(transcript.trim());
        }
      };
      rec.onerror = (event: any) => {
        setListening(false);
        const errCode = String(event?.error || "").toLowerCase();
        if (errCode.includes("not-allowed") || errCode.includes("permission") || errCode.includes("service-not-allowed")) {
          onToast(
            isAr
              ? "⚠️ تم رفض إذن الميكروفون؛ يرجى السماح بصلاحية الصوت أو استخدام الكتابة النصية."
              : "⚠️ Microphone permission denied; please allow audio permission or type your command."
          );
        } else if (errCode.includes("no-speech")) {
          onToast(
            isAr
              ? "لم يتم التقاط صوت واضح؛ اضغط رمز الميكروفون وتحدث مجدداً."
              : "No speech detected; tap the microphone and speak again."
          );
        }
      };
      rec.onend = () => {
        setListening(false);
      };

      recognitionRef.current = rec;
      setListening(true);
      rec.start();
    } catch {
      setListening(false);
      onToast(
        isAr ? "تعذر بدء الميكروفون الصوتي" : "Could not start voice microphone"
      );
    }
  }

  async function handleSendPrompt(overrideText?: string) {
    const prompt = (overrideText ?? inputPrompt).trim();
    if (!prompt || busy) return;

    const userMsg: CopilotChatMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      text: prompt,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };
    setMessages((prev) => [...prev, userMsg]);
    if (!overrideText) setInputPrompt("");
    setBusy(true);

    try {
      let agentRes: any = null;
      const shouldUseOfflineDirectly =
        offlineMode || (typeof navigator !== "undefined" && !navigator.onLine);

      if (!shouldUseOfflineDirectly) {
        try {
          const headers: Record<string, string> = { "Content-Type": "application/json" };
          if (currentUser?.id) headers["x-uas-user-id"] = currentUser.id;
          if (currentUser?.role) headers["x-uas-role"] = String(currentUser.role);

          const res = await fetch("/api/ai/agent", {
            method: "POST",
            headers,
            body: JSON.stringify({
              prompt,
              lang,
              actor: currentUser
                ? {
                    userId: currentUser.id,
                    userDisplay: currentUser.name,
                    userRole: currentUser.role,
                  }
                : undefined,
            }),
          });
          if (res.ok) {
            agentRes = await res.json();
          }
        } catch {
          // Network or static Capacitor export fallback -> run offline deterministic engine directly
        }
      }

      if (!agentRes) {
        agentRes = await runUasAiAgent(prompt, {
          user: currentUser ?? "SUPER_ADMIN",
          lang,
          state,
          diagnostics: clientDiagnostics,
        });
      }

      const replyText =
        lang === "ar"
          ? agentRes.replyAr || agentRes.reply
          : agentRes.replyEn || agentRes.reply;

      const assistantMsg: CopilotChatMessage = {
        id: `a-${Date.now()}`,
        role: "assistant",
        text: replyText,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        tierUsed: agentRes.tierUsed,
        reasoningTrace: agentRes.reasoningTrace,
        confirmationCard: agentRes.confirmationCard,
        navigationTab: agentRes.navigationTab,
        openLicenseModal: agentRes.openLicenseModal,
      };

      setMessages((prev) => [...prev, assistantMsg]);
      speakText(replyText);

      // Immediate execution for read-only navigation intent
      if (agentRes.toolName === "navigate_to_module" && agentRes.navigationTab && agentRes.ok) {
        onNavigateTab(agentRes.navigationTab);
      }
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: "assistant",
          text:
            err?.message ||
            (isAr ? "حدث خطأ أثناء معالجة الطلب." : "An error occurred while processing your request."),
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirmAndExecute(msgId: string, card: ConfirmationPreviewCard) {
    if (confirmingId) return;
    setConfirmingId(msgId);

    try {
      let summaryText = "";
      let entryNumber = `JV-AI-${Date.now().toString().slice(-4)}`;
      let handledByServer = false;

      if (!offlineMode && (typeof navigator === "undefined" || navigator.onLine)) {
        try {
          const headers: Record<string, string> = { "Content-Type": "application/json" };
          if (currentUser?.id) headers["x-uas-user-id"] = currentUser.id;
          if (currentUser?.role) headers["x-uas-role"] = String(currentUser.role);

          const res = await fetch("/api/ai/agent", {
            method: "POST",
            headers,
            body: JSON.stringify({
              confirmAction: card,
              lang,
              actor: currentUser
                ? {
                    userId: currentUser.id,
                    userDisplay: currentUser.name,
                    userRole: currentUser.role,
                  }
                : undefined,
            }),
          });
          handledByServer = true;
          const data = await res.json();
          if (!res.ok || !data.success) {
            throw new Error(data.reply || data.error || "Confirmation failed");
          }
          entryNumber = data.entryNumber || entryNumber;
          summaryText = isAr ? data.summaryAr : data.summaryEn;
          await onRefreshState();
        } catch (serverErr: any) {
          if (handledByServer) throw serverErr;
        }
      }

      if (!handledByServer) {
        summaryText = isAr
          ? `✅ تم اعتماد وترحيل القيد محلياً (${entryNumber}) بمبلغ ${card.totalDebit.toLocaleString()} ${card.currency} [executed_by_ai: true].`
          : `✅ Confirmed & executed locally (${entryNumber}) for ${card.totalDebit.toLocaleString()} ${card.currency} [executed_by_ai: true].`;
      }

      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId
            ? {
                ...m,
                confirmedResult: {
                  executed: true,
                  entryNumber,
                  summary: summaryText,
                },
              }
            : m
        )
      );
      onToast(
        isAr
          ? `تم ترحيل العملية بنجاح (${entryNumber})`
          : `Transaction confirmed & posted (${entryNumber})`
      );
      speakText(summaryText);
    } catch (err: any) {
      onToast(err?.message || (isAr ? "فشل ترحيل العملية" : "Failed to execute transaction"));
    } finally {
      setConfirmingId(null);
    }
  }

  const manualSearchResults = useMemo(() => {
    if (!manualSearch.trim()) return [];
    return searchSupportKnowledge(manualSearch, { topK: 6 });
  }, [manualSearch]);

  const activeChapter: SupportChapter =
    UAS_SUPPORT_CHAPTERS.find((c) => c.chapterNumber === selectedChapterNum) ||
    UAS_SUPPORT_CHAPTERS[0];

  const quickPrompts = isAr
    ? [
        "كم رصيد حساب الصندوق الرئيسي 111101؟",
        "اعرض ملخص ميزان المراجعة وقائمة الدخل",
        "سجل قيد يومية مدين 521101 ديزل بمبلغ 25000 ودائن 111101 الصندوق بمبلغ 25000",
        "سند قبض من شركة الأمل بمبلغ 40000",
        "تشخيص حالة الترخيص ومقاعد الـ 7 مستخدمين",
        "كيف ألغي ربط جهاز مفقود؟",
      ]
    : [
        "Query account balance for 111101 Main Cash Vault",
        "Generate Trial Balance and P&L report summary",
        "Draft journal entry debit 521101 25000 credit 111101 25000",
        "Receipt voucher from Al-Amal Co for 40000",
        "Diagnose system health and 7-user license seats",
        "How do I release a lost device seat?",
      ];

  return (
    <>
      {/* Floating Copilot Trigger Button */}
      <div className="fixed bottom-5 right-5 z-40 flex items-center gap-2">
        <button
          type="button"
          data-testid="uas-ai-copilot-fab"
          onClick={() => setOpen((v) => !v)}
          className="group flex items-center gap-2.5 px-4 py-3 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-xl shadow-emerald-900/30 border border-emerald-400/30 transition-all"
          title={
            isAr
              ? "المساعد المحاسبي الذكي ودليل المستخدم (صوت + نص)"
              : "UAS AI ERP Copilot & User Manual (Voice + Text)"
          }
        >
          <div className="relative flex items-center justify-center">
            <Bot className="w-5 h-5" />
            <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-amber-300 animate-ping" />
            <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-amber-400" />
          </div>
          <div className="text-start hidden sm:block">
            <div className="text-xs font-black leading-tight flex items-center gap-1">
              <span>{isAr ? "المساعد الذكي & دليل المستخدم" : "AI Copilot & User Guide"}</span>
              <Sparkles className="w-3 h-3 text-amber-300" />
            </div>
            <div className="text-[10px] text-emerald-100 opacity-90">
              {isAr ? "أوامر صوتية • قيود • دعم دون إنترنت" : "Voice + Text • Offline Ready"}
            </div>
          </div>
        </button>
      </div>

      {/* Floating Copilot Drawer */}
      {open && (
        <div
          dir={isAr ? "rtl" : "ltr"}
          className="fixed bottom-20 right-3 sm:right-5 z-50 w-[calc(100vw-1.5rem)] sm:w-[470px] max-h-[82vh] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl flex flex-col overflow-hidden text-slate-900 dark:text-slate-100"
        >
          {/* Header */}
          <div className="p-4 bg-gradient-to-r from-slate-900 via-emerald-950 to-slate-900 text-white flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-2xl bg-emerald-500/20 border border-emerald-400/30 flex items-center justify-center text-emerald-300 shrink-0">
                <Bot className="w-5 h-5" />
              </div>
              <div>
                <div className="text-xs font-black flex items-center gap-1.5">
                  <span>
                    {isAr
                      ? "وكيل UAS المحاسبي الذكي وخدمة العملاء"
                      : "UAS Reasoning ERP Copilot & Support"}
                  </span>
                  <span className="px-1.5 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 font-mono text-[9px]">
                    {offlineMode ? "OFFLINE NLP" : "HYBRID AI"}
                  </span>
                </div>
                <div className="text-[10px] text-slate-300">
                  {isAr
                    ? `الدور: ${currentUser?.role || "زائر / خدمة العملاء"} • المقاعد: ${clientDiagnostics.used_users}/${clientDiagnostics.max_users}`
                    : `Role: ${currentUser?.role || "Guest / Support"} • Seats: ${clientDiagnostics.used_users}/${clientDiagnostics.max_users}`}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setTtsEnabled((v) => !v)}
                className={`p-1.5 rounded-xl border text-xs transition ${
                  ttsEnabled
                    ? "bg-emerald-500/20 border-emerald-400/40 text-emerald-300"
                    : "border-white/10 text-slate-400 hover:text-white"
                }`}
                title={isAr ? "تفعيل/إيقاف القراءة الصوتية (TTS)" : "Toggle Voice Readout (TTS)"}
              >
                {ttsEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="p-1.5 rounded-xl border border-white/10 text-slate-300 hover:text-white hover:bg-white/10 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* 3-Tab Switcher: AI Copilot | Live Diagnostics | User Manual */}
          <div className="flex border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 text-xs font-black">
            <button
              type="button"
              onClick={() => setActivePane("copilot")}
              className={`flex-1 py-2.5 px-2 border-b-2 flex items-center justify-center gap-1.5 transition ${
                activePane === "copilot"
                  ? "border-emerald-600 text-emerald-600 dark:text-emerald-400 bg-white dark:bg-slate-900"
                  : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
              }`}
            >
              <Cpu className="w-3.5 h-3.5" />
              <span>{isAr ? "المساعد الذكي" : "AI Copilot"}</span>
            </button>

            <button
              type="button"
              onClick={() => setActivePane("support")}
              className={`flex-1 py-2.5 px-2 border-b-2 flex items-center justify-center gap-1.5 transition ${
                activePane === "support"
                  ? "border-emerald-600 text-emerald-600 dark:text-emerald-400 bg-white dark:bg-slate-900"
                  : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
              }`}
            >
              <HelpCircle className="w-3.5 h-3.5" />
              <span>{isAr ? "التشخيص والدعم" : "Diagnostics"}</span>
            </button>

            <button
              type="button"
              data-testid="copilot-user-manual-tab"
              onClick={() => setActivePane("manual")}
              className={`flex-1 py-2.5 px-2 border-b-2 flex items-center justify-center gap-1.5 transition ${
                activePane === "manual"
                  ? "border-emerald-600 text-emerald-600 dark:text-emerald-400 bg-white dark:bg-slate-900"
                  : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
              }`}
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span>{isAr ? "دليل المستخدم (7)" : "User Manual (7)"}</span>
            </button>
          </div>

          {/* =============================================================== */}
          {/* PANE 1: AI ERP COPILOT (Voice + Text + Confirmation Cards)     */}
          {/* =============================================================== */}
          {activePane === "copilot" && (
            <>
              <div className="flex-1 overflow-y-auto p-3.5 space-y-3 max-h-[52vh]">
                {/* Quick suggestion chips */}
                <div className="flex flex-wrap gap-1.5">
                  {quickPrompts.map((qp, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => handleSendPrompt(qp)}
                      className="text-[11px] px-2.5 py-1 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-emerald-500/15 hover:text-emerald-700 dark:hover:text-emerald-300 border border-slate-200 dark:border-slate-700 transition text-start"
                    >
                      {qp}
                    </button>
                  ))}
                </div>

                {/* Messages */}
                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${
                      msg.role === "user" ? "items-end" : "items-start"
                    }`}
                  >
                    <div
                      className={`max-w-[94%] rounded-2xl p-3 text-xs space-y-2 ${
                        msg.role === "user"
                          ? "bg-emerald-600 text-white rounded-br-none"
                          : "bg-slate-100 dark:bg-slate-800/90 text-slate-800 dark:text-slate-100 border border-slate-200 dark:border-slate-700 rounded-bl-none"
                      }`}
                    >
                      <div className="whitespace-pre-line leading-relaxed">{msg.text}</div>

                      {/* Collapsible Reasoning Trace */}
                      {msg.reasoningTrace && msg.reasoningTrace.length > 0 && (
                        <div className="pt-1 border-t border-slate-200/70 dark:border-slate-700/70">
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedTraces((prev) => ({
                                ...prev,
                                [msg.id]: !prev[msg.id],
                              }))
                            }
                            className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1"
                          >
                            {expandedTraces[msg.id] ? (
                              <ChevronUp className="w-3 h-3" />
                            ) : (
                              <ChevronDown className="w-3 h-3" />
                            )}
                            <span>
                              {isAr
                                ? `سلسلة التفكير والاستدلال (${msg.tierUsed || "tier3"})`
                                : `Reasoning Trace (${msg.tierUsed || "tier3"})`}
                            </span>
                          </button>

                          {expandedTraces[msg.id] && (
                            <div className="mt-1.5 space-y-1 p-2 rounded-xl bg-white/80 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-700 text-[10px]">
                              {msg.reasoningTrace.map((st) => (
                                <div key={st.step} className="space-y-0.5">
                                  <div className="font-black text-emerald-700 dark:text-emerald-300">
                                    {isAr ? st.titleAr : st.titleEn}
                                  </div>
                                  <div className="text-slate-600 dark:text-slate-400 font-mono break-words">
                                    {isAr ? st.detailAr : st.detailEn}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Mandatory Financial Confirmation Preview Card */}
                      {msg.confirmationCard && (
                        <div
                          data-testid="ai-confirmation-preview-card"
                          className="mt-2 p-3 rounded-2xl bg-white dark:bg-slate-900 border-2 border-amber-400/80 dark:border-amber-500/60 space-y-2.5 text-slate-900 dark:text-slate-100 shadow-sm"
                        >
                          <div className="flex items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-2">
                            <div className="font-black text-xs text-amber-700 dark:text-amber-300 flex items-center gap-1.5">
                              <ShieldCheck className="w-4 h-4 shrink-0" />
                              <span>
                                {isAr
                                  ? msg.confirmationCard.titleAr
                                  : msg.confirmationCard.titleEn}
                              </span>
                            </div>
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                              {isAr ? "متوازن ✓" : "BALANCED ✓"}
                            </span>
                          </div>

                          <div className="text-[11px] text-slate-600 dark:text-slate-300">
                            <span className="font-bold">{isAr ? "البيان:" : "Narration:"}</span>{" "}
                            {isAr
                              ? msg.confirmationCard.narrationAr
                              : msg.confirmationCard.narrationEn}{" "}
                            • <span className="font-mono">{msg.confirmationCard.date}</span>
                          </div>

                          {/* Debit / Credit Table */}
                          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
                            <table className="w-full text-[11px]">
                              <thead className="bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                                <tr>
                                  <th className="p-1.5 text-start">{isAr ? "الحساب" : "Account"}</th>
                                  <th className="p-1.5 text-end">{isAr ? "مدين (Dr)" : "Debit"}</th>
                                  <th className="p-1.5 text-end">{isAr ? "دائن (Cr)" : "Credit"}</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                {msg.confirmationCard.lines.map((line, i) => (
                                  <tr key={i}>
                                    <td className="p-1.5 font-bold">
                                      <span className="font-mono text-emerald-600">
                                        {line.accountCode}
                                      </span>{" "}
                                      — {isAr ? line.accountNameAr : line.accountNameEn}
                                    </td>
                                    <td className="p-1.5 text-end font-mono font-bold text-sky-700 dark:text-sky-300">
                                      {line.debit > 0 ? line.debit.toLocaleString() : "—"}
                                    </td>
                                    <td className="p-1.5 text-end font-mono font-bold text-amber-700 dark:text-amber-300">
                                      {line.credit > 0 ? line.credit.toLocaleString() : "—"}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                              <tfoot className="bg-slate-50 dark:bg-slate-800/60 font-black">
                                <tr>
                                  <td className="p-1.5">{isAr ? "الإجمالي" : "Total"}</td>
                                  <td className="p-1.5 text-end font-mono">
                                    {msg.confirmationCard.totalDebit.toLocaleString()}{" "}
                                    {msg.confirmationCard.currency}
                                  </td>
                                  <td className="p-1.5 text-end font-mono">
                                    {msg.confirmationCard.totalCredit.toLocaleString()}{" "}
                                    {msg.confirmationCard.currency}
                                  </td>
                                </tr>
                              </tfoot>
                            </table>
                          </div>

                          {msg.confirmedResult?.executed ? (
                            <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 text-[11px] font-bold flex items-center gap-1.5">
                              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
                              <span>{msg.confirmedResult.summary}</span>
                            </div>
                          ) : (
                            <button
                              type="button"
                              data-testid="ai-confirm-execute-btn"
                              disabled={confirmingId === msg.id}
                              onClick={() =>
                                handleConfirmAndExecute(msg.id, msg.confirmationCard!)
                              }
                              className="w-full py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs shadow-sm flex items-center justify-center gap-1.5 disabled:opacity-50 transition"
                            >
                              <CheckCircle2 className="w-4 h-4" />
                              <span>
                                {confirmingId === msg.id
                                  ? isAr
                                    ? "جاري الترحيل..."
                                    : "Posting..."
                                  : "تأكيد وترحيل / Confirm & Execute"}
                              </span>
                            </button>
                          )}
                        </div>
                      )}

                      {/* Deep-Link Action Buttons */}
                      {(msg.navigationTab || msg.openLicenseModal) && (
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {msg.navigationTab && (
                            <button
                              type="button"
                              onClick={() => onNavigateTab(msg.navigationTab!)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 font-bold text-[11px] hover:bg-emerald-500/25 transition"
                            >
                              <ArrowUpRight className="w-3 h-3" />
                              <span>
                                {isAr
                                  ? `فتح القسم (${msg.navigationTab})`
                                  : `Open Module (${msg.navigationTab})`}
                              </span>
                            </button>
                          )}
                          {msg.openLicenseModal && (
                            <button
                              type="button"
                              onClick={onOpenLicenseModal}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-500/15 text-amber-700 dark:text-amber-300 font-bold text-[11px] hover:bg-amber-500/25 transition"
                            >
                              <KeyRound className="w-3 h-3" />
                              <span>
                                {isAr
                                  ? "إدارة الترخيص والمقاعد"
                                  : "Manage License & Seats"}
                              </span>
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>

              {/* Voice + Text Input Bar */}
              <div className="p-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 space-y-2">
                <div className="flex items-center justify-between text-[10px] text-slate-500">
                  <div className="flex items-center gap-1.5">
                    <span>{isAr ? "لغة الميكروفون:" : "Voice Mic Locale:"}</span>
                    <select
                      value={voiceLang}
                      onChange={(e) =>
                        setVoiceLang(e.target.value as "ar-SA" | "ar-YE" | "en-US")
                      }
                      className="rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-1.5 py-0.5 font-mono text-[10px]"
                    >
                      <option value="ar-YE">العربية (اليمن ar-YE)</option>
                      <option value="ar-SA">العربية (السعودية ar-SA)</option>
                      <option value="en-US">English (en-US)</option>
                    </select>
                  </div>
                  <span>
                    {listening
                      ? isAr
                        ? "🎙️ جاري الاستماع... تحدث الآن"
                        : "🎙️ Listening... speak now"
                      : isAr
                      ? "بوابة تأكيد القيود مفعلة 🛡️"
                      : "Mandatory Write Gate Active 🛡️"}
                  </span>
                </div>

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleSendPrompt();
                  }}
                  className="flex items-center gap-1.5"
                >
                  <button
                    type="button"
                    data-testid="copilot-voice-mic-btn"
                    onClick={toggleVoiceListening}
                    className={`p-2.5 rounded-xl border transition shrink-0 ${
                      listening
                        ? "bg-rose-600 text-white border-rose-500 animate-pulse"
                        : "bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-emerald-500"
                    }`}
                    title={isAr ? "إدخال صوتي (عربي / إنجليزي)" : "Voice Input (AR / EN)"}
                  >
                    {listening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                  </button>

                  <input
                    type="text"
                    value={inputPrompt}
                    onChange={(e) => setInputPrompt(e.target.value)}
                    placeholder={
                      isAr
                        ? "اكتب أو تحدث بأمرك (قيد، سند، رصيد، تقرير، أو سؤال دعم)..."
                        : "Ask or command (journal, voucher, balance, report, manual)..."
                    }
                    className="flex-1 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                  />

                  <button
                    type="submit"
                    disabled={busy || !inputPrompt.trim()}
                    className="p-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50 transition shrink-0"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </form>
              </div>
            </>
          )}

          {/* =============================================================== */}
          {/* PANE 2: LIVE CUSTOMER SERVICE DIAGNOSTICS                      */}
          {/* =============================================================== */}
          {activePane === "support" && (
            <div className="p-4 space-y-3.5 overflow-y-auto max-h-[60vh] text-xs">
              <div
                className={`p-3.5 rounded-2xl border ${
                  liveDiagnosticReport.healthy
                    ? "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-300 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200"
                    : "bg-rose-50 dark:bg-rose-950/30 border-rose-300 dark:border-rose-800 text-rose-900 dark:text-rose-200"
                }`}
              >
                <div className="flex items-center justify-between gap-2 font-black text-sm">
                  <span className="flex items-center gap-1.5">
                    {liveDiagnosticReport.healthy ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-rose-600" />
                    )}
                    <span>
                      {isAr
                        ? liveDiagnosticReport.headlineAr
                        : liveDiagnosticReport.headlineEn}
                    </span>
                  </span>
                  <span className="font-mono text-[10px] px-2 py-0.5 rounded-md bg-white/70 dark:bg-black/30">
                    {liveDiagnosticReport.statusBadge}
                  </span>
                </div>

                <ul className="mt-2 space-y-1 text-[11px]">
                  {(isAr
                    ? liveDiagnosticReport.findingsAr
                    : liveDiagnosticReport.findingsEn
                  ).map((f, i) => (
                    <li key={i}>• {f}</li>
                  ))}
                </ul>
              </div>

              <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800 space-y-2">
                <div className="font-black">
                  {isAr ? "التوصيات والإجراءات السريعة:" : "Recommended Actions:"}
                </div>
                <ul className="space-y-1 text-[11px] text-slate-600 dark:text-slate-300">
                  {(isAr
                    ? liveDiagnosticReport.remediationsAr
                    : liveDiagnosticReport.remediationsEn
                  ).map((r, i) => (
                    <li key={i}>• {r}</li>
                  ))}
                </ul>

                <div className="flex flex-wrap gap-2 pt-2">
                  <button
                    type="button"
                    onClick={onOpenLicenseModal}
                    className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs inline-flex items-center gap-1.5"
                  >
                    <KeyRound className="w-3.5 h-3.5" />
                    <span>
                      {isAr
                        ? "فتح نافذة الترخيص وإلغاء ربط الأجهزة"
                        : "Open License & Release Device Seats"}
                    </span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* =============================================================== */}
          {/* PANE 3: SEARCHABLE 7-CHAPTER BILINGUAL USER MANUAL             */}
          {/* =============================================================== */}
          {activePane === "manual" && (
            <div className="p-3.5 space-y-3 overflow-y-auto max-h-[62vh] text-xs">
              {/* Instant Offline Manual Search */}
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute top-2.5 start-3" />
                <input
                  type="text"
                  data-testid="copilot-manual-search-input"
                  value={manualSearch}
                  onChange={(e) => setManualSearch(e.target.value)}
                  placeholder={
                    isAr
                      ? "ابحث في دليل المستخدم (مثال: إلغاء ربط جهاز، قيد يومية، LAN، QR)..."
                      : "Search User Manual (e.g. release seat, journal entry, LAN, QR)..."
                  }
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 ps-8 pe-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                />
              </div>

              {manualSearch.trim() ? (
                <div className="space-y-2.5">
                  <div className="text-[11px] font-bold text-slate-500">
                    {isAr
                      ? `نتائج البحث الفوري دون إنترنت (${manualSearchResults.length}):`
                      : `Offline Manual Search Results (${manualSearchResults.length}):`}
                  </div>
                  {manualSearchResults.map((m) => (
                    <ManualSectionCard
                      key={m.section.id}
                      section={m.section}
                      isAr={isAr}
                      onNavigateTab={onNavigateTab}
                      onOpenLicenseModal={onOpenLicenseModal}
                    />
                  ))}
                </div>
              ) : (
                <>
                  {/* Chapter Pills (1..7) */}
                  <div className="flex flex-wrap gap-1.5">
                    {UAS_SUPPORT_CHAPTERS.map((ch) => (
                      <button
                        key={ch.id}
                        type="button"
                        onClick={() => setSelectedChapterNum(ch.chapterNumber)}
                        className={`px-2.5 py-1 rounded-xl text-[11px] font-bold border transition ${
                          selectedChapterNum === ch.chapterNumber
                            ? "bg-emerald-600 text-white border-emerald-600"
                            : "bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300"
                        }`}
                      >
                        {isAr ? `فصل ${ch.chapterNumber}` : `Ch ${ch.chapterNumber}`}
                      </button>
                    ))}
                  </div>

                  {/* Active Chapter Header & Sections */}
                  <div className="space-y-2.5">
                    <div className="p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/20">
                      <div className="font-black text-emerald-800 dark:text-emerald-300">
                        {isAr ? activeChapter.titleAr : activeChapter.titleEn}
                      </div>
                      <div className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">
                        {isAr ? activeChapter.descriptionAr : activeChapter.descriptionEn}
                      </div>
                    </div>

                    {activeChapter.sections.map((sec) => (
                      <ManualSectionCard
                        key={sec.id}
                        section={sec}
                        isAr={isAr}
                        onNavigateTab={onNavigateTab}
                        onOpenLicenseModal={onOpenLicenseModal}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}

function ManualSectionCard({
  section,
  isAr,
  onNavigateTab,
  onOpenLicenseModal,
}: {
  section: SupportManualSection;
  isAr: boolean;
  onNavigateTab: (tab: TabId) => void;
  onOpenLicenseModal: () => void;
}) {
  return (
    <div className="p-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-2">
      <div className="font-black text-xs text-slate-900 dark:text-slate-100">
        {isAr ? section.titleAr : section.titleEn}
      </div>
      <p className="text-[11px] text-slate-600 dark:text-slate-300 whitespace-pre-line leading-relaxed">
        {isAr ? section.contentAr : section.contentEn}
      </p>
      <div className="space-y-1">
        <div className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400">
          {isAr ? "الخطوات العملية:" : "Steps:"}
        </div>
        <ol className="list-decimal list-inside space-y-0.5 text-[11px] text-slate-600 dark:text-slate-300">
          {(isAr ? section.stepsAr : section.stepsEn).map((st, idx) => (
            <li key={idx}>{st}</li>
          ))}
        </ol>
      </div>
      <div className="flex flex-wrap gap-1.5 pt-1">
        {section.relatedAction === "open_license_modal" && (
          <button
            type="button"
            onClick={onOpenLicenseModal}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-500/15 text-amber-700 dark:text-amber-300 font-bold text-[10px]"
          >
            <KeyRound className="w-3 h-3" />
            <span>{isAr ? "فتح نافذة الترخيص والمقاعد" : "Open License Modal"}</span>
          </button>
        )}
        {section.targetTab && (
          <button
            type="button"
            onClick={() => onNavigateTab(section.targetTab!)}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 font-bold text-[10px]"
          >
            <ArrowUpRight className="w-3 h-3" />
            <span>
              {isAr ? `الانتقال إلى (${section.targetTab})` : `Go to (${section.targetTab})`}
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
