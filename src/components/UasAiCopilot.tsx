"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  ArrowUpRight,
  Ban,
  BookOpen,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Cpu,
  Edit3,
  ExternalLink,
  FileText,
  FolderClock,
  Headphones,
  HelpCircle,
  KeyRound,
  Mail,
  MessageSquare,
  MessageSquarePlus,
  Mic,
  MicOff,
  Phone,
  Plus,
  Printer,
  Search,
  Send,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
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
import type {
  CitationLink,
  ClarificationPromptData,
  ConfirmationPreviewCard,
  EscalationCardData,
  UasAgentToolResult,
} from "@/lib/ai/uasAgentTools";
import {
  type CopilotChatMessage,
  type CopilotThread,
  archiveThread,
  buildCopilotConversationPrintSpec,
  createThread,
  deleteThreadPermanently,
  deriveSnippet,
  filterThreads,
  loadAllThreads,
  restoreThread,
  saveActiveThreadMessages,
} from "@/lib/ai/conversationArchiveEngine";
import { printUasDocument } from "@/lib/print/uasDocumentPrinter";
import type { LicenseStatusData } from "@/components/LicenseActivationModal";
import type {
  LanguageCode,
  TabId,
  UasBootstrapState,
  UasUser,
} from "@/types/uas";

interface SpeechRecognitionEventLike {
  results?: Array<Array<{ transcript?: string }>>;
}

interface SpeechRecognitionErrorEventLike {
  error?: string;
}

interface SpeechRecognitionInstance {
  lang: string;
  continuous?: boolean;
  interimResults?: boolean;
  maxAlternatives?: number;
  onstart?: (() => void) | null;
  onresult?: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror?: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend?: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

interface WindowWithSpeech {
  Capacitor?: {
    Plugins?: {
      SpeechRecognition?: {
        requestPermissions?: () => Promise<unknown>;
        start: (options: {
          language: string;
          maxResults: number;
          prompt: string;
          partialResults: boolean;
          popup: boolean;
        }) => Promise<{ matches?: string[] }>;
      };
    };
  };
  SpeechRecognition?: new () => SpeechRecognitionInstance;
  webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
}

interface CopilotAgentResponse extends Partial<UasAgentToolResult> {
  tierUsed?: ReasoningTier;
  reasoningTrace?: AgentReasoningStep[];
  reply?: string;
  replyAr?: string;
  replyEn?: string;
  openLicenseModal?: boolean;
  citations?: CitationLink[];
  clarificationPrompt?: ClarificationPromptData;
  escalationCard?: EscalationCardData;
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
  const [docRtl, setDocRtl] = useState<boolean>(() => {
    if (typeof document !== "undefined") {
      return document.documentElement.dir === "rtl" || document.documentElement.lang === "ar";
    }
    return true;
  });

  useEffect(() => {
    if (typeof document === "undefined") return;
    const checkRtl = () => {
      setDocRtl(document.documentElement.dir === "rtl" || document.documentElement.lang === "ar");
    };
    checkRtl();
    const observer = new MutationObserver(checkRtl);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["dir", "lang"] });
    return () => observer.disconnect();
  }, []);

  const isAr = lang === "ar" || (lang !== "en" && docRtl);
  const [open, setOpen] = useState(false);
  const [activePane, setActivePane] = useState<"copilot" | "threads" | "support" | "manual">("copilot");
  const [inputPrompt, setInputPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [expandedTraces, setExpandedTraces] = useState<Record<string, boolean>>({});
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");

  // Conversation Threads & Archive State
  const [allThreads, setAllThreads] = useState<CopilotThread[]>(() => {
    if (typeof window !== "undefined") {
      return loadAllThreads(currentUser?.id);
    }
    return [];
  });
  const [activeThreadId, setActiveThreadId] = useState<string | null>(() => {
    if (typeof window !== "undefined") {
      const loaded = loadAllThreads(currentUser?.id);
      const activeOnes = loaded.filter((t) => !t.isArchived);
      return activeOnes.length > 0 ? activeOnes[0].id : null;
    }
    return null;
  });
  const [threadSearch, setThreadSearch] = useState<string>("");
  const [threadTab, setThreadTab] = useState<"active" | "archived">("active");

  // Voice Recognition & TTS state: Arabic pinned to ar-YE with ar-SA fallback
  const [voiceLang, setVoiceLang] = useState<"ar-YE" | "ar-SA" | "en-US">(
    isAr ? "ar-YE" : "en-US"
  );
  const [listening, setListening] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const isStartingVoiceRef = useRef(false);
  const textInputRef = useRef<HTMLInputElement | null>(null);

  // User Manual search & selected chapter state
  const [manualSearch, setManualSearch] = useState("");
  const [selectedChapterNum, setSelectedChapterNum] = useState<number>(1);

  // Collapsible / Hideable Copilot State
  const [isMinimized, setIsMinimized] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      return window.localStorage.getItem("uas_copilot_minimized") === "true";
    }
    return false;
  });

  const handleToggleMinimize = (min?: boolean) => {
    setIsMinimized((prev) => {
      const next = typeof min === "boolean" ? min : !prev;
      if (typeof window !== "undefined") {
        window.localStorage.setItem("uas_copilot_minimized", next ? "true" : "false");
      }
      return next;
    });
  };

  useEffect(() => {
    const handleToggle = () => {
      setIsMinimized(false);
      setOpen((v) => !v);
    };
    const handleOpen = () => {
      setIsMinimized(false);
      setOpen(true);
    };
    window.addEventListener("uas:toggle-copilot", handleToggle);
    window.addEventListener("uas:open-copilot", handleOpen);
    return () => {
      window.removeEventListener("uas:toggle-copilot", handleToggle);
      window.removeEventListener("uas:open-copilot", handleOpen);
    };
  }, []);

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

  const historyStorageKey = `uas_copilot_history_${currentUser?.id || "guest"}`;

  const welcomeMessage: CopilotChatMessage = useMemo(
    () => ({
      id: "welcome-1",
      role: "assistant",
      text: isAr
        ? "مرحباً بك في **المساعد المحاسبي الذكي وخدمة العملاء (UAS AI Copilot)** 🤖.\nيمكنك التحدث بالصوت أو الكتابة بالعربية والإنجليزية لتنفيذ العمليات المحاسبية (مسودة قيد مزدوج، سند قبض/صرف، فاتورة، استعلام عن رصيد حساب، تقارير مالية، فحص المخزون، أو تشخيص الترخيص والمقاعد) — ويعمل بالكامل متصلاً ودون إنترنت!"
        : "Welcome to the **UAS Enterprise Bilingual Voice + Text ERP Copilot & Support Assistant** 🤖.\nSpeak or type in Arabic or English to query account balances, generate Trial Balance / P&L summaries, draft balanced journal entries or vouchers with Confirmation Preview Cards, diagnose 7-user license seats, or search the 7-chapter User Manual — both online and 100% offline!",
      timestamp: "—",
    }),
    [isAr]
  );

  const [messages, setMessages] = useState<CopilotChatMessage[]>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = window.localStorage.getItem(historyStorageKey);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length > 0) return parsed;
        }
      } catch {
        // storage fallback
      }
    }
    return [welcomeMessage];
  });

  // Adjust history if user account changes (derived during render, eliminates cascading render in useEffect)
  const [prevHistoryKey, setPrevHistoryKey] = useState(historyStorageKey);
  if (prevHistoryKey !== historyStorageKey) {
    setPrevHistoryKey(historyStorageKey);
    let loaded: CopilotChatMessage[] | null = null;
    if (typeof window !== "undefined") {
      try {
        const saved = window.localStorage.getItem(historyStorageKey);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length > 0) loaded = parsed;
        }
      } catch {}
    }
    setMessages(loaded || [welcomeMessage]);

    // Adjust threads when user account changes
    const loadedThreads = typeof window !== "undefined" ? loadAllThreads(currentUser?.id) : [];
    setAllThreads(loadedThreads);
    const activeOnes = loadedThreads.filter((t) => !t.isArchived);
    setActiveThreadId(activeOnes.length > 0 ? activeOnes[0].id : null);
  }

  // Adjust voice language when isAr changes during render (eliminates cascading render in useEffect)
  const [prevIsAr, setPrevIsAr] = useState(isAr);
  if (prevIsAr !== isAr) {
    setPrevIsAr(isAr);
    setVoiceLang(isAr ? "ar-YE" : "en-US");
  }

  // Always show welcome message in active language when starting a thread
  const displayedMessages = useMemo(() => {
    if (messages.length === 1 && messages[0].id === "welcome-1") {
      return [welcomeMessage];
    }
    return messages;
  }, [messages, welcomeMessage]);

  // Sync messages to external storage (localStorage and thread storage)
  useEffect(() => {
    if (typeof window !== "undefined") {
      const realMessages = messages.filter((m) => m.id !== "welcome-1");
      if (realMessages.length > 0) {
        try {
          window.localStorage.setItem(historyStorageKey, JSON.stringify(messages));
        } catch {
          // quota exceeded or private browsing
        }

        if (activeThreadId) {
          saveActiveThreadMessages(currentUser?.id, activeThreadId, messages);
        }
      } else {
        try {
          window.localStorage.removeItem(historyStorageKey);
        } catch {}
      }
    }
  }, [messages, historyStorageKey, activeThreadId, currentUser?.id]);

  useEffect(() => {
    if (open) {
      chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [displayedMessages, open]);

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
    if (listening || isStartingVoiceRef.current) {
      try {
        recognitionRef.current?.stop?.();
        recognitionRef.current?.abort?.();
      } catch {
        // ignore
      }
      setListening(false);
      isStartingVoiceRef.current = false;
      return;
    }

    if (typeof window === "undefined") return;

    const win = window as unknown as WindowWithSpeech;

    // 1. Check Native Capacitor SpeechRecognition plugin first (Android APK)
    const capPlugins = win.Capacitor?.Plugins;
    if (capPlugins?.SpeechRecognition) {
      try {
        isStartingVoiceRef.current = true;
        await capPlugins.SpeechRecognition.requestPermissions?.();
        setListening(true);
        const res = await capPlugins.SpeechRecognition.start({
          language: voiceLang,
          maxResults: 1,
          prompt: isAr ? "تحدث بأمرك المحاسبي..." : "Speak your ERP command...",
          partialResults: false,
          popup: true,
        });
        const transcript = Array.isArray(res?.matches) ? res.matches[0] : "";
        setListening(false);
        isStartingVoiceRef.current = false;
        if (transcript) {
          setInputPrompt(transcript);
          await handleSendPrompt(transcript);
        }
        return;
      } catch {
        setListening(false);
        isStartingVoiceRef.current = false;
      }
    }

    // 2. Standard Web Speech API (Windows Desktop / Chrome / WebView)
    const SpeechRec = win.SpeechRecognition || win.webkitSpeechRecognition;
    if (!SpeechRec) {
      onToast(
        isAr
          ? "⚠️ التعرف الصوتي غير مدعوم في هذا المتصفح/البيئة؛ تم تحويلك للإدخال النصي."
          : "⚠️ Speech recognition is not available in this environment; please use manual text input."
      );
      textInputRef.current?.focus();
      return;
    }

    try {
      isStartingVoiceRef.current = true;
      const rec = new SpeechRec();
      rec.lang = voiceLang;
      rec.interimResults = false;
      rec.maxAlternatives = 1;

      rec.onstart = () => {
        isStartingVoiceRef.current = false;
        setListening(true);
      };

      rec.onresult = (event: SpeechRecognitionEventLike) => {
        const transcript = event?.results?.[0]?.[0]?.transcript || "";
        setListening(false);
        isStartingVoiceRef.current = false;
        if (transcript.trim()) {
          setInputPrompt(transcript.trim());
          handleSendPrompt(transcript.trim());
        }
      };

      rec.onerror = (event: SpeechRecognitionErrorEventLike) => {
        setListening(false);
        isStartingVoiceRef.current = false;
        const errCode = String(event?.error || "").toLowerCase();

        // Automatic fallback from ar-YE to ar-SA if Yemeni dialect is not installed in the browser/engine
        if (errCode.includes("language-not-supported") || errCode.includes("bad-grammar")) {
          if (rec.lang === "ar-YE") {
            setVoiceLang("ar-SA");
            try {
              const fallbackRec = new SpeechRec();
              fallbackRec.lang = "ar-SA";
              fallbackRec.interimResults = false;
              fallbackRec.maxAlternatives = 1;
              fallbackRec.onstart = () => {
                isStartingVoiceRef.current = false;
                setListening(true);
              };
              fallbackRec.onresult = rec.onresult;
              fallbackRec.onerror = () => {
                setListening(false);
                isStartingVoiceRef.current = false;
                onToast(
                  isAr
                    ? "⚠️ تعذر التعرف على الصوت؛ يرجى الكتابة يدوياً في الحقل النصي."
                    : "⚠️ Speech recognition error; please type your command manually."
                );
                textInputRef.current?.focus();
              };
              fallbackRec.onend = () => {
                setListening(false);
                isStartingVoiceRef.current = false;
              };
              recognitionRef.current = fallbackRec;
              isStartingVoiceRef.current = true;
              fallbackRec.start();
              return;
            } catch {
              // fallback failed, continue to notification
            }
          }
        }

        if (
          errCode.includes("not-allowed") ||
          errCode.includes("permission") ||
          errCode.includes("service-not-allowed")
        ) {
          onToast(
            isAr
              ? "⚠️ تم رفض إذن الميكروفون؛ يرجى السماح بصلاحية الصوت أو استخدام الكتابة النصية."
              : "⚠️ Microphone permission denied; please allow audio permission or type your command."
          );
          textInputRef.current?.focus();
        } else if (errCode.includes("no-speech")) {
          onToast(
            isAr
              ? "لم يتم التقاط صوت واضح؛ اضغط رمز الميكروفون وتحدث مجدداً."
              : "No speech detected; tap the microphone and speak again."
          );
        } else if (!errCode.includes("aborted")) {
          onToast(
            isAr
              ? `⚠️ حالة الصوت: ${errCode}؛ يمكنك المتابعة بالكتابة النصية.`
              : `⚠️ Voice status: ${errCode}; you can continue with manual text.`
          );
          textInputRef.current?.focus();
        }
      };

      rec.onend = () => {
        setListening(false);
        isStartingVoiceRef.current = false;
      };

      recognitionRef.current = rec;
      rec.start();
    } catch {
      setListening(false);
      isStartingVoiceRef.current = false;
      onToast(
        isAr
          ? "⚠️ تعذر بدء الميكروفون الصوتي؛ يرجى استخدام الإدخال النصي."
          : "⚠️ Could not start voice microphone; please use manual text input."
      );
      textInputRef.current?.focus();
    }
  }

  const handleClearHistory = () => {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(historyStorageKey);
    }
    setMessages([welcomeMessage]);
    if (activeThreadId) {
      deleteThreadPermanently(currentUser?.id, activeThreadId);
      setAllThreads(loadAllThreads(currentUser?.id));
      setActiveThreadId(null);
    }
    onToast(isAr ? "تم مسح سجل المحادثة بنجاح" : "Chat history cleared successfully");
  };

  const handleNewChat = () => {
    const newTh = createThread(currentUser?.id);
    setActiveThreadId(newTh.id);
    setMessages([welcomeMessage]);
    setAllThreads(loadAllThreads(currentUser?.id));
    setActivePane("copilot");
    onToast(isAr ? "بدء محادثة جديدة" : "New conversation started");
  };

  const handleOpenThread = (thread: CopilotThread) => {
    setActiveThreadId(thread.id);
    setMessages(thread.messages.length > 0 ? thread.messages : [welcomeMessage]);
    setActivePane("copilot");
    onToast(
      isAr
        ? `تم فتح المحادثة: ${thread.titleAr}`
        : `Opened: ${thread.titleEn}`
    );
  };

  const handleArchiveThread = (threadId: string) => {
    archiveThread(currentUser?.id, threadId);
    setAllThreads(loadAllThreads(currentUser?.id));
    if (activeThreadId === threadId) {
      setMessages([welcomeMessage]);
      setActiveThreadId(null);
    }
    onToast(isAr ? "تم نقل المحادثة إلى الأرشيف" : "Thread moved to archive");
  };

  const handleRestoreThread = (threadId: string) => {
    restoreThread(currentUser?.id, threadId);
    setAllThreads(loadAllThreads(currentUser?.id));
    onToast(isAr ? "تم استعادة المحادثة من الأرشيف" : "Thread restored from archive");
  };

  const handleDeleteThread = (threadId: string) => {
    deleteThreadPermanently(currentUser?.id, threadId);
    setAllThreads(loadAllThreads(currentUser?.id));
    if (activeThreadId === threadId) {
      setMessages([welcomeMessage]);
      setActiveThreadId(null);
    }
    onToast(isAr ? "تم حذف المحادثة نهائياً" : "Thread permanently deleted");
  };

  const handlePrintConversation = async (threadToPrint?: CopilotThread | null) => {
    const thread =
      threadToPrint ||
      allThreads.find((t) => t.id === activeThreadId) || {
        id: activeThreadId || `thread-live-${Date.now()}`,
        userId: currentUser?.id || "guest",
        titleAr: isAr ? "محادثة المساعد الذكي الحالية" : "Active AI Copilot Thread",
        titleEn: "Active AI Copilot Thread",
        snippet: deriveSnippet(messages),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isArchived: false,
        archivedAt: null,
        messages,
      };

    const printSpec = buildCopilotConversationPrintSpec({
      thread,
      enterpriseProfile: state.enterpriseProfile,
      user: currentUser,
      lang: isAr ? "ar" : "en",
    });

    try {
      await printUasDocument(printSpec);
      onToast(isAr ? "تم فتح نافذة الطباعة / تصدير PDF بنجاح" : "Print / PDF preview opened");
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      onToast(errMsg || (isAr ? "فشل فتح معاينة الطباعة" : "Failed to open print preview"));
    }
  };

  const handleDeleteMessage = (msgId: string) => {
    setMessages((prev) => {
      const next = prev.filter((m) => m.id !== msgId);
      return next.length > 0 ? next : [welcomeMessage];
    });
    onToast(isAr ? "تم حذف الرسالة" : "Message deleted");
  };

  const handleSaveEditMessage = async (msgId: string) => {
    const trimmed = editingText.trim();
    if (!trimmed) return;
    setEditingMessageId(null);

    const idx = messages.findIndex((m) => m.id === msgId);
    if (idx === -1) return;

    // Truncate subsequent messages after this turn
    const truncated = messages.slice(0, idx);
    setMessages(truncated);

    // Re-run AI reasoning with updated prompt
    await handleSendPrompt(trimmed, truncated);
  };

  const messageSeqRef = useRef(1);
  const getNextMsgId = useCallback((prefix: string): string => {
  const seq = messageSeqRef.current++;
    return `${prefix}-${seq}`;
  }, []);

  const handleDismissAction = (msgId: string) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === msgId ? { ...m, dismissed: true } : m))
    );
    onToast(isAr ? "تم تجاهل الاقتراح دون ترحيل" : "Proposal dismissed without posting");
  };

  async function handleSendPrompt(overrideText?: string, baseMessages?: CopilotChatMessage[]) {
    const prompt = (overrideText ?? inputPrompt).trim();
    if (!prompt || busy) return;

    if (!activeThreadId) {
      const newTh = createThread(currentUser?.id, prompt.slice(0, 42), prompt.slice(0, 42));
      setActiveThreadId(newTh.id);
      setAllThreads(loadAllThreads(currentUser?.id));
    }

    const userMsg: CopilotChatMessage = {
      id: getNextMsgId("u"),
      role: "user",
      text: prompt,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };
    if (baseMessages) {
      setMessages([...baseMessages, userMsg]);
    } else {
      setMessages((prev) => [...prev, userMsg]);
    }
    if (!overrideText) setInputPrompt("");
    setBusy(true);

    try {
      let agentRes: CopilotAgentResponse | null = null;
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
          ? agentRes.replyAr || agentRes.reply || ""
          : agentRes.replyEn || agentRes.reply || "";

      const assistantMsg: CopilotChatMessage = {
        id: getNextMsgId("a"),
        role: "assistant",
        text: replyText,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        tierUsed: agentRes.tierUsed,
        reasoningTrace: agentRes.reasoningTrace,
        confirmationCard: agentRes.confirmationCard,
        navigationTab: agentRes.navigationTab,
        openLicenseModal: agentRes.openLicenseModal,
        citations: agentRes.citations,
        clarificationPrompt: agentRes.clarificationPrompt,
        escalationCard: agentRes.escalationCard,
      };

      setMessages((prev) => [...prev, assistantMsg]);
      speakText(replyText);

      // Immediate execution for read-only navigation intent
      if (agentRes.toolName === "navigate_to_module" && agentRes.navigationTab && agentRes.ok) {
        onNavigateTab(agentRes.navigationTab);
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setMessages((prev) => [
        ...prev,
        {
          id: getNextMsgId("err"),
          role: "assistant",
          text:
            errorMsg ||
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
      let entryNumber = `JV-AI-${getNextMsgId("e")}`;
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
        } catch (serverErr: unknown) {
          if (handledByServer) throw serverErr;
        }
      }

      if (!handledByServer) {
        if (card.operationType === "CREATE_CUSTOMER") {
          entryNumber = `CUST-LOC-${getNextMsgId("e")}`;
          summaryText = isAr
            ? `✅ تم اعتماد وإنشاء العميل محلياً (${card.partyName || card.executionPayload?.name}) برمز (${entryNumber}) [executed_by_ai: true].`
            : `✅ Confirmed & created client locally (${card.partyName || card.executionPayload?.name}) [executed_by_ai: true].`;
          onNavigateTab("customers");
        } else if (card.operationType === "CREATE_VENDOR") {
          entryNumber = `VND-LOC-${getNextMsgId("e")}`;
          summaryText = isAr
            ? `✅ تم اعتماد وإنشاء المورد محلياً (${card.partyName || card.executionPayload?.nameAr}) برمز (${entryNumber}) [executed_by_ai: true].`
            : `✅ Confirmed & created supplier locally (${card.partyName || card.executionPayload?.nameAr}) [executed_by_ai: true].`;
          onNavigateTab("procurement");
        } else if (card.operationType === "CREATE_PROJECT") {
          entryNumber = `PRJ-LOC-${getNextMsgId("e")}`;
          summaryText = isAr
            ? `✅ تم اعتماد وإنشاء المشروع محلياً (${card.partyName || card.executionPayload?.name}) برمز (${entryNumber}) [executed_by_ai: true].`
            : `✅ Confirmed & created project locally (${card.partyName || card.executionPayload?.name}) [executed_by_ai: true].`;
          onNavigateTab("projects");
        } else if (card.operationType === "EXPORT_CLIENT_REPORT") {
          entryNumber = `RPT-CUST-${getNextMsgId("e")}`;
          summaryText = isAr
            ? `📄 كشف حساب العميل (${card.partyName || "كافة العملاء"}) جاهز للطباعة وتصدير PDF.`
            : `📄 Client statement for (${card.partyName || "All Clients"}) is ready for export.`;
          onNavigateTab("customers");
        } else {
          summaryText = isAr
            ? `✅ تم اعتماد وترحيل القيد محلياً (${entryNumber}) بمبلغ ${card.totalDebit.toLocaleString()} ${card.currency} [executed_by_ai: true].`
            : `✅ Confirmed & executed locally (${entryNumber}) for ${card.totalDebit.toLocaleString()} ${card.currency} [executed_by_ai: true].`;
        }
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
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      onToast(errorMsg || (isAr ? "فشل ترحيل العملية" : "Failed to execute transaction"));
    } finally {
      setConfirmingId(null);
    }
  }

  async function handleSaveAsDraft(msgId: string, card: ConfirmationPreviewCard) {
    if (confirmingId) return;
    setConfirmingId(msgId);

    try {
      let summaryText = "";
      let draftNumber = `DRFT-AI-${getNextMsgId("e")}`;
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
              isDraft: true,
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
            throw new Error(data.reply || data.error || "Saving draft failed");
          }
          draftNumber = data.draftNumber || data.draftId || draftNumber;
          summaryText = isAr ? data.summaryAr : data.summaryEn;
          await onRefreshState();
        } catch (serverErr: unknown) {
          if (handledByServer) throw serverErr;
        }
      }

      if (!handledByServer) {
        summaryText = isAr
          ? `📝 تم حفظ العملية كمسودة عمل محلياً (${draftNumber}) بنجاح.`
          : `📝 Saved locally as workspace draft (${draftNumber}).`;
      }

      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId
            ? {
                ...m,
                confirmedResult: {
                  executed: true,
                  entryNumber: draftNumber,
                  summary: summaryText,
                },
              }
            : m
        )
      );
      onToast(summaryText);
      speakText(summaryText);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      onToast(errorMsg || (isAr ? "فشل حفظ المسودة" : "Failed to save draft"));
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
        "أنشئ عميل جديد شركة النور هاتف 771234567 وحد ائتماني 500000",
        "أنشئ مورد جديد مؤسسة البركة هاتف 777112233",
        "أنشئ مشروع جديد مزرعة الجوف بموازنة 3000000",
        "تصدير كشف حساب العميل شركة الأمل مع تفاصيل المبيعات",
        "كم رصيد حساب الصندوق الرئيسي 111101؟",
        "اعرض ملخص ميزان المراجعة وقائمة الدخل",
        "سجل قيد يومية مدين 521101 ديزل بمبلغ 25000 ودائن 111101 بمبلغ 25000",
        "سند قبض من شركة الأمل بمبلغ 40000",
        "تشخيص حالة الترخيص ومقاعد الـ 7 مستخدمين",
        "كيف ألغي ربط جهاز مفقود؟",
      ]
    : [
        "Create customer Al-Noor Co phone 771234567 credit limit 500000",
        "Create vendor Al-Baraka Trading phone 777112233",
        "Create project Al-Jawf Farm budget 3000000",
        "Export client report for Al-Amal Co with sale details",
        "Query account balance for 111101 Main Cash Vault",
        "Generate Trial Balance and P&L report summary",
        "Draft journal entry debit 521101 25000 credit 111101 25000",
        "Receipt voucher from Al-Amal Co for 40000",
        "Diagnose system health and 7-user license seats",
        "How do I release a lost device seat?",
      ];

  return (
    <>
      {/* Floating Copilot Trigger Pill or Minimized Handle */}
      {isMinimized ? (
        <div
          className={
            isAr
              ? "fixed bottom-20 md:bottom-6 left-4 sm:left-6 z-40 flex items-center gap-1.5"
              : "fixed bottom-20 md:bottom-6 right-4 sm:right-6 z-40 flex items-center gap-1.5"
          }
        >
          <button
            type="button"
            data-testid="uas-ai-copilot-minimized-btn"
            onClick={() => {
              handleToggleMinimize(false);
              setOpen(true);
            }}
            className="p-3 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-xl shadow-emerald-900/30 border border-emerald-400/30 hover:scale-105 transition-all flex items-center gap-2"
            title={
              isAr
                ? "إظهار المساعد المحاسبي الذكي (UAS AI Copilot)"
                : "Restore UAS AI ERP Copilot"
            }
          >
            <div className="relative flex items-center justify-center">
              <Bot className="w-5 h-5" />
              <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-amber-400" />
            </div>
            <span className="text-xs font-black hidden sm:inline">
              {isAr ? "المساعد الذكي" : "AI Copilot"}
            </span>
          </button>
        </div>
      ) : (
        <div
          className={
            isAr
              ? "fixed bottom-20 md:bottom-6 left-4 sm:left-6 z-40 flex items-center gap-1.5"
              : "fixed bottom-20 md:bottom-6 right-4 sm:right-6 z-40 flex items-center gap-1.5"
          }
        >
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

          {/* Minimize / Hide Button on Floating Pill */}
          <button
            type="button"
            data-testid="uas-ai-copilot-hide-pill-btn"
            onClick={(e) => {
              e.stopPropagation();
              handleToggleMinimize(true);
            }}
            className="p-2 sm:p-2.5 rounded-2xl bg-slate-900/85 hover:bg-red-950/80 text-slate-300 hover:text-red-300 border border-slate-700/60 hover:border-red-500/40 shadow-xl transition-all text-xs flex items-center gap-1.5"
            title={isAr ? "إخفاء المساعد (تصغير إلى الزاوية) ✕" : "Hide Copilot ✕"}
            aria-label={isAr ? "إخفاء المساعد" : "Hide Copilot"}
          >
            <X className="w-4 h-4 text-red-400 shrink-0" />
            <span className="text-[11px] font-black text-slate-200">
              {isAr ? "إخفاء" : "Hide"}
            </span>
          </button>
        </div>
      )}

      {/* Floating Copilot Drawer */}
      {open && (
        <div
          dir={isAr ? "rtl" : "ltr"}
          className={
            isAr
              ? "fixed bottom-20 md:bottom-6 left-3 sm:left-5 z-50 w-[calc(100vw-1.5rem)] sm:w-[470px] max-h-[82vh] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl flex flex-col overflow-hidden text-slate-900 dark:text-slate-100"
              : "fixed bottom-20 md:bottom-6 right-3 sm:right-5 z-50 w-[calc(100vw-1.5rem)] sm:w-[470px] max-h-[82vh] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl flex flex-col overflow-hidden text-slate-900 dark:text-slate-100"
          }
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
                data-testid="uas-ai-copilot-new-chat-btn"
                onClick={handleNewChat}
                className="p-1.5 rounded-xl border border-white/10 text-slate-300 hover:text-emerald-300 hover:bg-white/10 transition"
                title={isAr ? "محادثة جديدة" : "New Chat"}
              >
                <MessageSquarePlus className="w-4 h-4" />
              </button>
              <button
                type="button"
                data-testid="uas-ai-copilot-export-pdf-btn"
                onClick={() => handlePrintConversation()}
                className="p-1.5 rounded-xl border border-white/10 text-slate-300 hover:text-emerald-300 hover:bg-white/10 transition"
                title={isAr ? "طباعة / تصدير PDF للمحادثة الحالية" : "Print / Export Conversation PDF"}
              >
                <Printer className="w-4 h-4" />
              </button>
              <button
                type="button"
                data-testid="uas-ai-copilot-clear-history-btn"
                onClick={handleClearHistory}
                className="p-1.5 rounded-xl border border-white/10 text-slate-300 hover:text-rose-300 hover:bg-white/10 transition"
                title={isAr ? "مسح السجل" : "Clear Thread"}
              >
                <Trash2 className="w-4 h-4" />
              </button>
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
              {/* Minimize / Hide Button in Drawer Header */}
              <button
                type="button"
                data-testid="uas-ai-copilot-header-hide-btn"
                onClick={() => {
                  setOpen(false);
                  handleToggleMinimize(true);
                }}
                className="p-1.5 rounded-xl border border-white/10 text-slate-300 hover:text-white hover:bg-white/10 transition"
                title={isAr ? "إخفاء المساعد (تصغير)" : "Minimize / Hide Copilot"}
              >
                <ChevronDown className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="p-1.5 rounded-xl border border-white/10 text-slate-300 hover:text-white hover:bg-white/10 transition"
                title={isAr ? "إغلاق النافذة" : "Close Window"}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* 4-Tab Switcher: AI Copilot | Threads & Archive | Live Diagnostics | User Manual */}
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
              data-testid="copilot-threads-tab"
              onClick={() => {
                setAllThreads(loadAllThreads(currentUser?.id));
                setActivePane("threads");
              }}
              className={`flex-1 py-2.5 px-2 border-b-2 flex items-center justify-center gap-1.5 transition ${
                activePane === "threads"
                  ? "border-emerald-600 text-emerald-600 dark:text-emerald-400 bg-white dark:bg-slate-900"
                  : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
              }`}
            >
              <FolderClock className="w-3.5 h-3.5" />
              <span>{isAr ? "السجلات والأرشيف" : "Threads & Archive"}</span>
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
              <span>{isAr ? "دليل (7)" : "Manual (7)"}</span>
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
                {displayedMessages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`group relative flex flex-col ${
                      msg.role === "user" ? "items-end" : "items-start"
                    }`}
                  >
                    <div
                      className={`relative max-w-[94%] rounded-2xl p-3 text-xs space-y-2 ${
                        msg.role === "user"
                          ? "bg-emerald-600 text-white rounded-br-none"
                          : "bg-slate-100 dark:bg-slate-800/90 text-slate-800 dark:text-slate-100 border border-slate-200 dark:border-slate-700 rounded-bl-none"
                      }`}
                    >
                      {/* Bubble Action Bar: Edit (user) & Delete */}
                      <div
                        className={`absolute -top-3 ${
                          msg.role === "user" ? "left-2" : "right-2"
                        } flex items-center gap-1 opacity-90 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity z-10`}
                      >
                        {msg.role === "user" && editingMessageId !== msg.id && (
                          <button
                            type="button"
                            data-testid={`edit-msg-${msg.id}`}
                            onClick={() => {
                              setEditingMessageId(msg.id);
                              setEditingText(msg.text);
                            }}
                            className="p-1 rounded-lg bg-slate-900/90 hover:bg-slate-900 text-slate-200 hover:text-white border border-slate-700/60 shadow-md transition"
                            title={isAr ? "تعديل وإعادة تشغيل" : "Edit & Re-run"}
                          >
                            <Edit3 className="w-3 h-3" />
                          </button>
                        )}
                        {(msg.id !== "welcome-1" || displayedMessages.length > 1) && (
                          <button
                            type="button"
                            data-testid={`delete-msg-${msg.id}`}
                            onClick={() => handleDeleteMessage(msg.id)}
                            className="p-1 rounded-lg bg-slate-900/90 hover:bg-rose-700 text-slate-200 hover:text-white border border-slate-700/60 shadow-md transition"
                            title={isAr ? "حذف" : "Delete"}
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>

                      {editingMessageId === msg.id ? (
                        <div className="space-y-2 pt-1 w-full">
                          <textarea
                            value={editingText}
                            onChange={(e) => setEditingText(e.target.value)}
                            rows={2}
                            autoFocus
                            className="w-full rounded-xl bg-emerald-700/80 text-white border border-emerald-400/50 p-2 text-xs focus:outline-none focus:ring-1 focus:ring-white font-sans"
                          />
                          <div className="flex items-center gap-1.5 justify-end">
                            <button
                              type="button"
                              onClick={() => setEditingMessageId(null)}
                              className="px-2 py-1 rounded-lg bg-black/20 hover:bg-black/40 text-white text-[10px] font-bold"
                            >
                              {isAr ? "إلغاء" : "Cancel"}
                            </button>
                            <button
                              type="button"
                              data-testid="ai-save-edit-btn"
                              onClick={() => handleSaveEditMessage(msg.id)}
                              className="px-2.5 py-1 rounded-lg bg-white text-emerald-800 hover:bg-emerald-50 text-[10px] font-black flex items-center gap-1 shadow-sm"
                            >
                              <Check className="w-3 h-3" />
                              <span>{isAr ? "تعديل وإعادة تشغيل" : "Edit & Re-run"}</span>
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="whitespace-pre-line leading-relaxed">{msg.text}</div>
                      )}

                      {/* Collapsible Reasoning Trace */}
                      {msg.reasoningTrace && msg.reasoningTrace.length > 0 && (
                        <div className="pt-1 border-t border-slate-200/70 dark:border-slate-700/70">
                          <button
                            type="button"
                            data-testid={`toggle-trace-${msg.id}`}
                            onClick={() =>
                              setExpandedTraces((prev) => ({
                                ...prev,
                                [msg.id]: !prev[msg.id],
                              }))
                            }
                            className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1 hover:underline"
                          >
                            {expandedTraces[msg.id] ? (
                              <ChevronUp className="w-3 h-3" />
                            ) : (
                              <ChevronDown className="w-3 h-3" />
                            )}
                            <span>
                              {isAr
                                ? `سلسلة التفكير والاستدلال المحاسبي (${msg.tierUsed || "tier3"})`
                                : `Accounting Reasoning Trace (${msg.tierUsed || "tier3"})`}
                            </span>
                          </button>

                          {expandedTraces[msg.id] && (
                            <div
                              data-testid={`reasoning-trace-content-${msg.id}`}
                              className="mt-1.5 space-y-1.5 p-2.5 rounded-xl bg-white/90 dark:bg-slate-900/90 border border-slate-200 dark:border-slate-700 text-[10px]"
                            >
                              {msg.reasoningTrace.map((st) => (
                                <div key={st.step} className="space-y-0.5 border-b border-slate-100 dark:border-slate-800 last:border-0 pb-1">
                                  <div className="font-black text-emerald-700 dark:text-emerald-300 flex items-center gap-1">
                                    <Cpu className="w-3 h-3 shrink-0" />
                                    <span>{isAr ? st.titleAr : st.titleEn}</span>
                                  </div>
                                  <div className="text-slate-600 dark:text-slate-400 font-mono break-words ps-4">
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

                          {/* Card Content: Master Records vs Financial Journal Tables */}
                          {msg.confirmationCard.operationType === "CREATE_CUSTOMER" ? (
                            <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-[11px] space-y-1.5">
                              <div className="flex justify-between items-center">
                                <span className="text-slate-500">{isAr ? "اسم العميل:" : "Customer Name:"}</span>
                                <span className="font-bold text-emerald-700 dark:text-emerald-300">
                                  {msg.confirmationCard.partyName || String(msg.confirmationCard.executionPayload?.name || "")}
                                </span>
                              </div>
                              <div className="flex justify-between items-center">
                                <span className="text-slate-500">{isAr ? "رقم الهاتف:" : "Phone:"}</span>
                                <span className="font-mono">
                                  {String(msg.confirmationCard.executionPayload?.phone || (isAr ? "غير محدد" : "N/A"))}
                                </span>
                              </div>
                              <div className="flex justify-between items-center">
                                <span className="text-slate-500">{isAr ? "الحد الائتماني:" : "Credit Limit:"}</span>
                                <span className="font-mono font-bold">
                                  {Number(msg.confirmationCard.executionPayload?.creditLimit || 0).toLocaleString()} YER
                                </span>
                              </div>
                              <div className="flex justify-between items-center">
                                <span className="text-slate-500">{isAr ? "حساب الأستاذ العام:" : "GL Account:"}</span>
                                <span className="font-mono text-emerald-600 font-bold">
                                  1121xx (توليد حساب فرعي بالجيل السادس)
                                </span>
                              </div>
                              <div className="flex justify-between items-center">
                                <span className="text-slate-500">{isAr ? "مركز التكلفة:" : "Cost Center:"}</span>
                                <span className="font-mono text-amber-600 font-bold">
                                  {msg.confirmationCard.costCenterId || (isAr ? "CC-CUST-... (توليد آلي)" : "CC-CUST-... (Auto)")}
                                </span>
                              </div>
                            </div>
                          ) : msg.confirmationCard.operationType === "CREATE_VENDOR" ? (
                            <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-[11px] space-y-1.5">
                              <div className="flex justify-between items-center">
                                <span className="text-slate-500">{isAr ? "اسم المورد:" : "Supplier Name:"}</span>
                                <span className="font-bold text-emerald-700 dark:text-emerald-300">
                                  {msg.confirmationCard.partyName || String(msg.confirmationCard.executionPayload?.nameAr || "")}
                                </span>
                              </div>
                              <div className="flex justify-between items-center">
                                <span className="text-slate-500">{isAr ? "رقم الهاتف:" : "Phone:"}</span>
                                <span className="font-mono">
                                  {String(msg.confirmationCard.executionPayload?.phone || "777000000")}
                                </span>
                              </div>
                              <div className="flex justify-between items-center">
                                <span className="text-slate-500">{isAr ? "حساب الأستاذ العام:" : "GL Account:"}</span>
                                <span className="font-mono text-emerald-600 font-bold">
                                  2111xx (توليد حساب فرعي بالجيل السادس)
                                </span>
                              </div>
                              <div className="flex justify-between items-center">
                                <span className="text-slate-500">{isAr ? "مركز التكلفة:" : "Cost Center:"}</span>
                                <span className="font-mono text-amber-600 font-bold">
                                  {msg.confirmationCard.costCenterId || (isAr ? "CC-VND-... (توليد آلي)" : "CC-VND-... (Auto)")}
                                </span>
                              </div>
                            </div>
                          ) : msg.confirmationCard.operationType === "CREATE_PROJECT" ? (
                            <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-[11px] space-y-1.5">
                              <div className="flex justify-between items-center">
                                <span className="text-slate-500">{isAr ? "اسم المشروع:" : "Project Name:"}</span>
                                <span className="font-bold text-emerald-700 dark:text-emerald-300">
                                  {msg.confirmationCard.partyName || String(msg.confirmationCard.executionPayload?.name || "")}
                                </span>
                              </div>
                              <div className="flex justify-between items-center">
                                <span className="text-slate-500">{isAr ? "الموازنة المقدرة:" : "Budget Total:"}</span>
                                <span className="font-mono font-bold text-emerald-600">
                                  {Number(msg.confirmationCard.totalDebit || msg.confirmationCard.executionPayload?.budgetTotal || 0).toLocaleString()} YER
                                </span>
                              </div>
                              <div className="flex justify-between items-center">
                                <span className="text-slate-500">{isAr ? "دورات الحصاد:" : "Harvest Cycles:"}</span>
                                <span className="font-mono">
                                  {String(msg.confirmationCard.executionPayload?.plannedHarvests || 1)} دورات
                                </span>
                              </div>
                              <div className="flex justify-between items-center">
                                <span className="text-slate-500">{isAr ? "مركز التكلفة والربط:" : "Cost Center:"}</span>
                                <span className="font-mono text-amber-600 font-bold">
                                  {msg.confirmationCard.costCenterId || (isAr ? "CC-PRJ-... (توليد آلي)" : "CC-PRJ-... (Auto)")}
                                </span>
                              </div>
                            </div>
                          ) : msg.confirmationCard.operationType === "EXPORT_CLIENT_REPORT" ? (
                            <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-[11px] space-y-1.5">
                              <div className="flex justify-between items-center">
                                <span className="text-slate-500">{isAr ? "العميل المستهدف:" : "Client Target:"}</span>
                                <span className="font-bold text-emerald-700 dark:text-emerald-300">
                                  {msg.confirmationCard.partyName || (isAr ? "كافة العملاء" : "All Clients")}
                                </span>
                              </div>
                              <div className="flex justify-between items-center">
                                <span className="text-slate-500">{isAr ? "تفاصيل كل عملية بيع:" : "Per-Sale Details:"}</span>
                                <span className="font-bold text-emerald-600">
                                  {msg.confirmationCard.executionPayload?.includeSaleDetails !== false
                                    ? isAr ? "مضمّنة بالكامل (الأصناف والأسعار) ✅" : "Included Itemized ✅"
                                    : isAr ? "ملخص إجمالي فقط 📊" : "Summary Totals Only 📊"}
                                </span>
                              </div>
                            </div>
                          ) : (
                            <>
                              {/* 5-Dimension Accounting Resolution Summary */}
                              <div className="grid grid-cols-2 gap-1.5 p-2 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/70 text-[10px]">
                                <div>
                                  <span className="text-slate-400">{isAr ? "مركز التكلفة:" : "Cost Center:"}</span>{" "}
                                  <span className="font-bold text-slate-700 dark:text-slate-200">
                                    {msg.confirmationCard.costCenterId || (isAr ? "CC-MAIN (الرئيسي)" : "CC-MAIN (Default)")}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-slate-400">{isAr ? "العملة والصرف:" : "Currency & FX:"}</span>{" "}
                                  <span className="font-bold text-slate-700 dark:text-slate-200">
                                    {msg.confirmationCard.currency || "YER"}{" "}
                                    {msg.confirmationCard.exchangeRate && msg.confirmationCard.exchangeRate !== 1
                                      ? `(1 = ${msg.confirmationCard.exchangeRate} YER)`
                                      : ""}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-slate-400">{isAr ? "الحسابات (الجيل 6):" : "Gen-6 Accounts:"}</span>{" "}
                                  <span className="font-bold text-emerald-600 dark:text-emerald-400">
                                    {msg.confirmationCard.lines.map((l) => l.accountCode).join(", ")}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-slate-400">{isAr ? "بوابة الاعتماد:" : "Approval Gate:"}</span>{" "}
                                  <span className="font-bold text-amber-600 dark:text-amber-400">
                                    {isAr ? "جاهز للترحيل / مسودة" : "Verified / Ready"}
                                  </span>
                                </div>
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
                            </>
                          )}

                          {msg.dismissed ? (
                            <div className="p-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-500 dark:text-slate-400 text-[11px] font-bold flex items-center gap-1.5">
                              <Ban className="w-4 h-4 shrink-0 text-slate-400" />
                              <span>
                                {isAr
                                  ? "🚫 تم تجاهل هذا الاقتراح المحاسبي دون ترحيل."
                                  : "🚫 Accounting proposal dismissed without posting."}
                              </span>
                            </div>
                          ) : msg.confirmedResult?.executed ? (
                            <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 text-[11px] font-bold flex items-center gap-1.5">
                              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
                              <span>{msg.confirmedResult.summary}</span>
                            </div>
                          ) : (
                            <div className="flex flex-col sm:flex-row gap-2 pt-1">
                              <button
                                type="button"
                                data-testid="ai-confirm-execute-btn"
                                disabled={confirmingId === msg.id}
                                onClick={() =>
                                  handleConfirmAndExecute(msg.id, msg.confirmationCard!)
                                }
                                className="flex-1 py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs shadow-sm flex items-center justify-center gap-1.5 disabled:opacity-50 transition"
                              >
                                <CheckCircle2 className="w-4 h-4" />
                                <span>
                                  {confirmingId === msg.id
                                    ? isAr
                                      ? "جاري التنفيذ..."
                                      : "Processing..."
                                    : msg.confirmationCard.operationType === "EXPORT_CLIENT_REPORT"
                                    ? isAr ? "فتح كشف الحساب والطباعة" : "Open Statement & Print"
                                    : isAr
                                    ? msg.confirmationCard.confirmButtonLabelAr || "تنفيذ وترحيل"
                                    : msg.confirmationCard.confirmButtonLabelEn || "Execute & Post"}
                                </span>
                              </button>

                              {!["CREATE_CUSTOMER", "CREATE_VENDOR", "CREATE_PROJECT", "EXPORT_CLIENT_REPORT"].includes(
                                msg.confirmationCard.operationType
                              ) && (
                                <button
                                  type="button"
                                  data-testid="ai-save-draft-btn"
                                  disabled={confirmingId === msg.id}
                                  onClick={() =>
                                    handleSaveAsDraft(msg.id, msg.confirmationCard!)
                                  }
                                  className="py-2 px-3 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs shadow-sm flex items-center justify-center gap-1.5 disabled:opacity-50 transition"
                                  title={isAr ? "حفظ كمسودة عمل لمراجعتها لاحقاً" : "Save as workspace draft"}
                                >
                                  <FileText className="w-3.5 h-3.5" />
                                  <span>{isAr ? "حفظ كمسودة" : "Save Draft"}</span>
                                </button>
                              )}

                              <button
                                type="button"
                                data-testid="ai-dismiss-btn"
                                disabled={confirmingId === msg.id}
                                onClick={() => handleDismissAction(msg.id)}
                                className="py-2 px-3 rounded-xl bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold text-xs shadow-sm flex items-center justify-center gap-1.5 transition"
                                title={isAr ? "تجاهل" : "Dismiss"}
                              >
                                <Ban className="w-3.5 h-3.5 text-slate-400" />
                                <span>{isAr ? "تجاهل" : "Dismiss"}</span>
                              </button>
                            </div>
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

                      {/* Interactive Clarification Card */}
                      {msg.clarificationPrompt && (
                        <div
                          data-testid="ai-clarification-card"
                          className="mt-2 p-3 rounded-2xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-300/80 dark:border-amber-600/50 space-y-2 text-slate-900 dark:text-slate-100"
                        >
                          <div className="flex items-center gap-1.5 text-xs font-black text-amber-800 dark:text-amber-300">
                            <HelpCircle className="w-4 h-4 shrink-0" />
                            <span>
                              {isAr
                                ? msg.clarificationPrompt.questionAr
                                : msg.clarificationPrompt.questionEn}
                            </span>
                          </div>
                          {msg.clarificationPrompt.quickOptions &&
                            msg.clarificationPrompt.quickOptions.length > 0 && (
                              <div className="flex flex-wrap gap-1.5 pt-1">
                                {msg.clarificationPrompt.quickOptions.map((opt, i) => (
                                  <button
                                    key={i}
                                    type="button"
                                    data-testid={`clarification-option-${i}`}
                                    onClick={() => handleSendPrompt(opt.promptFill)}
                                    className="px-2.5 py-1 rounded-xl bg-white dark:bg-slate-800 hover:bg-amber-100 dark:hover:bg-amber-900/40 text-amber-900 dark:text-amber-200 text-xs font-bold border border-amber-200 dark:border-amber-700/60 shadow-sm transition"
                                  >
                                    {isAr ? opt.labelAr : opt.labelEn}
                                  </button>
                                ))}
                              </div>
                            )}
                        </div>
                      )}

                      {/* Escalation Card (Company Admin & UAS Support) */}
                      {msg.escalationCard && (
                        <div
                          data-testid="ai-escalation-card"
                          className="mt-2.5 p-3.5 rounded-2xl bg-gradient-to-br from-rose-50 to-orange-50 dark:from-rose-950/40 dark:to-orange-950/30 border-2 border-rose-400/80 dark:border-rose-500/60 space-y-3 text-slate-900 dark:text-slate-100 shadow-sm"
                        >
                          <div className="flex items-center justify-between gap-2 border-b border-rose-200 dark:border-rose-800/60 pb-2">
                            <div className="flex items-center gap-1.5 font-black text-xs text-rose-700 dark:text-rose-300">
                              <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
                              <span>{isAr ? "بطاقة تصعيد ومراجعة إدارية" : "Administrative Escalation Card"}</span>
                            </div>
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-black bg-rose-500/15 text-rose-700 dark:text-rose-300">
                              {msg.escalationCard.reasonCode}
                            </span>
                          </div>

                          <div className="text-[11px] text-slate-700 dark:text-slate-300 leading-relaxed">
                            <span className="font-bold text-rose-600 dark:text-rose-400">
                              {isAr ? "سبب التوقف:" : "Block Reason:"}
                            </span>{" "}
                            {isAr ? msg.escalationCard.reasonAr : msg.escalationCard.reasonEn}
                            {msg.escalationCard.moduleTab && (
                              <span className="block mt-0.5 text-slate-500 text-[10px]">
                                {isAr ? "القسم المعني:" : "Module Tab:"} <code className="font-mono bg-white/70 dark:bg-black/30 px-1 py-0.5 rounded">{msg.escalationCard.moduleTab}</code>
                              </span>
                            )}
                          </div>

                          {/* Admin & Support Contacts */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 text-[11px]">
                            {/* Company Admin */}
                            <div className="p-2 rounded-xl bg-white/80 dark:bg-slate-900/80 border border-rose-200 dark:border-rose-900/40 space-y-1">
                              <div className="font-bold text-[10px] text-slate-500 flex items-center gap-1">
                                <ShieldAlert className="w-3 h-3 text-amber-500" />
                                <span>{isAr ? "مسؤول المنشأة المعتمد:" : "Company Admin:"}</span>
                              </div>
                              <div className="font-black text-xs truncate">
                                {msg.escalationCard.adminContact.name || (isAr ? "مدير النظام" : "System Admin")}
                              </div>
                              <div className="flex flex-wrap gap-1 pt-0.5">
                                {msg.escalationCard.adminContact.phone && (
                                  <a
                                    href={`tel:${msg.escalationCard.adminContact.phone}`}
                                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 text-[10px] font-bold"
                                  >
                                    <Phone className="w-2.5 h-2.5" />
                                    <span>{msg.escalationCard.adminContact.phone}</span>
                                  </a>
                                )}
                                {msg.escalationCard.adminContact.whatsApp && (
                                  <a
                                    href={`https://wa.me/${msg.escalationCard.adminContact.whatsApp.replace(/[^0-9]/g, "")}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-green-500/10 hover:bg-green-500/20 text-green-700 dark:text-green-300 text-[10px] font-bold"
                                  >
                                    <MessageSquare className="w-2.5 h-2.5" />
                                    <span>واتساب</span>
                                  </a>
                                )}
                              </div>
                            </div>

                            {/* UAS Technical Support */}
                            <div className="p-2 rounded-xl bg-white/80 dark:bg-slate-900/80 border border-rose-200 dark:border-rose-900/40 space-y-1">
                              <div className="font-bold text-[10px] text-slate-500 flex items-center gap-1">
                                <Headphones className="w-3 h-3 text-sky-500" />
                                <span>{isAr ? "الدعم الفني المعتمد (UAS Support):" : "UAS Technical Support:"}</span>
                              </div>
                              <div className="font-black text-xs truncate">
                                {msg.escalationCard.supportContact.hotline}
                              </div>
                              <div className="flex flex-wrap gap-1 pt-0.5">
                                <a
                                  href={`mailto:${msg.escalationCard.supportContact.email}`}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-sky-500/10 hover:bg-sky-500/20 text-sky-700 dark:text-sky-300 text-[10px] font-bold"
                                >
                                  <Mail className="w-2.5 h-2.5" />
                                  <span>{msg.escalationCard.supportContact.email}</span>
                                </a>
                                <a
                                  href={msg.escalationCard.supportContact.portalUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 text-[10px] font-bold"
                                >
                                  <ExternalLink className="w-2.5 h-2.5" />
                                  <span>{isAr ? "بوابة الدعم" : "Portal"}</span>
                                </a>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Citations & Navigation Links */}
                      {msg.citations && msg.citations.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5 pt-1.5">
                          <span className="text-[10px] font-bold text-slate-400">
                            {isAr ? "المراجع والروابط:" : "Citations & Links:"}
                          </span>
                          {msg.citations.map((c, i) => (
                            <button
                              key={i}
                              type="button"
                              data-testid={`citation-link-${i}`}
                              onClick={() => onNavigateTab(c.tab)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-teal-500/15 hover:bg-teal-500/25 text-teal-700 dark:text-teal-300 font-bold text-[11px] border border-teal-500/20 transition"
                            >
                              <ArrowUpRight className="w-3 h-3" />
                              <span>{isAr ? c.labelAr : c.labelEn}</span>
                            </button>
                          ))}
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
                    ref={textInputRef}
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
          {/* PANE 2: CONVERSATION THREADS & ARCHIVE                         */}
          {/* =============================================================== */}
          {activePane === "threads" && (
            <div className="flex-1 overflow-y-auto p-3.5 space-y-3 max-h-[52vh]">
              {/* Top controls: New Chat button & Active/Archived segmented tabs */}
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  data-testid="copilot-threads-new-chat-btn"
                  onClick={handleNewChat}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow transition"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{isAr ? "محادثة جديدة" : "New Chat"}</span>
                </button>

                {/* Segmented Filter: Active vs Archived */}
                <div className="inline-flex rounded-xl bg-slate-100 dark:bg-slate-800 p-0.5 text-xs font-bold">
                  <button
                    type="button"
                    data-testid="copilot-threads-tab-active"
                    onClick={() => setThreadTab("active")}
                    className={`px-3 py-1 rounded-lg transition ${
                      threadTab === "active"
                        ? "bg-white dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 shadow-sm"
                        : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                    }`}
                  >
                    {isAr ? `النشطة (${allThreads.filter((t) => !t.isArchived).length})` : `Active (${allThreads.filter((t) => !t.isArchived).length})`}
                  </button>
                  <button
                    type="button"
                    data-testid="copilot-threads-tab-archived"
                    onClick={() => setThreadTab("archived")}
                    className={`px-3 py-1 rounded-lg transition ${
                      threadTab === "archived"
                        ? "bg-white dark:bg-slate-900 text-amber-600 dark:text-amber-400 shadow-sm"
                        : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                    }`}
                  >
                    {isAr ? `المؤرشفة (${allThreads.filter((t) => t.isArchived).length})` : `Archived (${allThreads.filter((t) => t.isArchived).length})`}
                  </button>
                </div>
              </div>

              {/* Search Input */}
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute top-2.5 start-2.5" />
                <input
                  type="text"
                  data-testid="copilot-threads-search-input"
                  value={threadSearch}
                  onChange={(e) => setThreadSearch(e.target.value)}
                  placeholder={isAr ? "بحث في المحادثات والأرشيف..." : "Search threads & archive..."}
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 ps-8 pe-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                />
              </div>

              {/* Threads List */}
              {(() => {
                const filtered = filterThreads(allThreads, { status: threadTab, search: threadSearch });
                if (filtered.length === 0) {
                  return (
                    <div className="p-8 text-center text-slate-400 space-y-2">
                      <Archive className="w-8 h-8 mx-auto text-slate-300 dark:text-slate-600" />
                      <div className="text-xs font-bold">
                        {isAr ? "لا توجد محادثات في هذه القائمة" : "No conversations found in this view"}
                      </div>
                    </div>
                  );
                }

                return (
                  <div className="space-y-2">
                    {filtered.map((th) => {
                      const isActive = th.id === activeThreadId;
                      const title = isAr ? th.titleAr : th.titleEn;
                      const msgCount = th.messages.length;
                      const dateStr = new Date(th.updatedAt).toLocaleDateString(
                        isAr ? "ar-YE" : "en-US",
                        { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }
                      );

                      return (
                        <div
                          key={th.id}
                          data-testid={`thread-card-${th.id}`}
                          className={`p-3 rounded-2xl border transition space-y-2 ${
                            isActive
                              ? "border-emerald-500/50 bg-emerald-50/40 dark:bg-emerald-950/20"
                              : "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-700"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="space-y-0.5 flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="font-black text-xs text-slate-900 dark:text-slate-100 truncate">
                                  {title}
                                </span>
                                {isActive && (
                                  <span className="px-1.5 py-0.5 rounded-md bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 text-[9px] font-bold">
                                    {isAr ? "الحالية" : "Current"}
                                  </span>
                                )}
                                {th.isArchived && (
                                  <span className="px-1.5 py-0.5 rounded-md bg-amber-500/20 text-amber-700 dark:text-amber-300 text-[9px] font-bold">
                                    {isAr ? "مؤرشفة" : "Archived"}
                                  </span>
                                )}
                              </div>
                              <div className="text-[11px] text-slate-500 truncate">{th.snippet}</div>
                            </div>
                            <div className="text-[10px] text-slate-400 whitespace-nowrap">{dateStr}</div>
                          </div>

                          <div className="flex items-center justify-between pt-1 border-t border-slate-100 dark:border-slate-800/80">
                            <div className="text-[10px] text-slate-400 font-mono">
                              {msgCount} {isAr ? "رسالة" : "msgs"}
                            </div>

                            <div className="flex items-center gap-1">
                              {/* Open / Resume Chat */}
                              <button
                                type="button"
                                data-testid={`thread-open-${th.id}`}
                                onClick={() => handleOpenThread(th)}
                                className="px-2 py-1 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 text-[10px] font-bold transition flex items-center gap-1"
                                title={isAr ? "فتح ومتابعة المحادثة" : "Open / Resume"}
                              >
                                <span>{isAr ? "فتح" : "Open"}</span>
                              </button>

                              {/* Print / Export PDF */}
                              <button
                                type="button"
                                data-testid={`thread-print-${th.id}`}
                                onClick={() => handlePrintConversation(th)}
                                className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 transition"
                                title={isAr ? "طباعة / تصدير PDF" : "Print / Export PDF"}
                              >
                                <Printer className="w-3.5 h-3.5" />
                              </button>

                              {/* Archive / Restore */}
                              {th.isArchived ? (
                                <button
                                  type="button"
                                  data-testid={`thread-restore-${th.id}`}
                                  onClick={() => handleRestoreThread(th.id)}
                                  className="p-1 rounded-lg hover:bg-amber-100 dark:hover:bg-amber-950/40 text-amber-600 dark:text-amber-400 transition"
                                  title={isAr ? "استعادة من الأرشيف" : "Restore thread"}
                                >
                                  <ArchiveRestore className="w-3.5 h-3.5" />
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  data-testid={`thread-archive-${th.id}`}
                                  onClick={() => handleArchiveThread(th.id)}
                                  className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 hover:text-amber-600 transition"
                                  title={isAr ? "أرشفة المحادثة" : "Archive thread"}
                                >
                                  <Archive className="w-3.5 h-3.5" />
                                </button>
                              )}

                              {/* Delete Permanently */}
                              <button
                                type="button"
                                data-testid={`thread-delete-${th.id}`}
                                onClick={() => handleDeleteThread(th.id)}
                                className="p-1 rounded-lg hover:bg-rose-100 dark:hover:bg-rose-950/40 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 transition"
                                title={isAr ? "حذف نهائي" : "Delete permanently"}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          )}

          {/* =============================================================== */}
          {/* PANE 3: LIVE CUSTOMER SERVICE DIAGNOSTICS                      */}
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
