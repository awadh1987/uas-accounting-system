"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  ArrowUpRight,
  Ban,
  Bell,
  BookOpen,
  Bot,
  Brain,
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Cpu,
  CreditCard,
  Edit3,
  ExternalLink,
  FileText,
  FolderClock,
  Headphones,
  HelpCircle,
  Image as ImageIcon,
  KeyRound,
  Mail,
  MessageSquare,
  MessageSquarePlus,
  Mic,
  MicOff,
  Package,
  Paperclip,
  Phone,
  Pin,
  Plus,
  Printer,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  ToggleLeft,
  ToggleRight,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import {
  loadLocalCopilotMemories,
  normalizeMemoryTenantSlug,
  saveLocalCopilotMemories,
  type CopilotMemoryCategory,
  type CopilotMemoryEntry,
  type MemoryMutationEvent,
} from "@/lib/ai/copilotMemoryTypes";
import {
  generateExecutiveBriefing,
  loadCachedExecutiveBriefing,
  saveCachedExecutiveBriefing,
  type ExecutiveBriefingReport,
} from "@/lib/ai/executiveBriefingEngine";
import {
  compressImageFileForVision,
  type CompressedVisionImage,
} from "@/lib/ai/clientImageCompression";
import {
  MAX_VISION_IMAGE_BYTES,
  type VisionExtractionMetadata,
  type VisionSourceAttachment,
} from "@/lib/ai/copilotVisionTypes";
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
  UasWorkspaceContext,
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
import {
  buildCopilotGreetingFallback,
  formatSpokenTextForGeminiTts,
  type CopilotDialectMode,
} from "@/lib/ai/yemeniLocalization";
import { printUasDocument } from "@/lib/print/uasDocumentPrinter";
import {
  executeMutation,
  getStoredSessionToken,
  getStoredTenantId,
  isAndroidLocalIsolatedMode,
  safeFetchJson,
} from "@/lib/apiClient";
import {
  checkMicrophoneDiagnostics,
  createSpeechTranscriptAccumulator,
  normalizeSpeechError,
  openNativeAppSettings,
  openUnusedAppRestrictionsSettings,
  requestMicrophoneAccess,
  type VoiceDiagnosticStatus,
} from "@/lib/voicePermissions";
import {
  extractDocumentDraft,
  validateExtractedDraft,
} from "@/lib/ai/documentExtractionEngine";
import type { LicenseStatusData } from "@/components/LicenseActivationModal";
import type {
  ExtractedDocumentDraft,
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
  modelUsed?: string;
  taskComplexity?: "operational" | "deep_reasoning";
  reasoningTrace?: AgentReasoningStep[];
  reply?: string;
  replyAr?: string;
  replyEn?: string;
  openLicenseModal?: boolean;
  citations?: CitationLink[];
  clarificationPrompt?: ClarificationPromptData;
  escalationCard?: EscalationCardData;
  learnedEvents?: MemoryMutationEvent[];
  forgottenEntries?: CopilotMemoryEntry[];
  appliedMemoriesCount?: number;
  visionExtraction?: VisionExtractionMetadata;
}


export interface UasAiCopilotProps {
  lang: LanguageCode;
  currentUser: UasUser | null;
  state: UasBootstrapState;
  licenseStatus: LicenseStatusData | null;
  offlineMode: boolean;
  workspaceContext?: UasWorkspaceContext | null;
  onNavigateTab: (tab: TabId) => void;
  onOpenLicenseModal: () => void;
  onRefreshState: () => Promise<void> | void;
  onApplyState?: (nextState: UasBootstrapState, queueCount: number) => void;
  onToast: (msg: string) => void;
}

export function UasAiCopilot({
  lang,
  currentUser,
  state,
  licenseStatus,
  offlineMode,
  workspaceContext,
  onNavigateTab,
  onOpenLicenseModal,
  onRefreshState,
  onApplyState,
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
  const [activePane, setActivePane] = useState<"copilot" | "threads" | "support" | "manual" | "memory">("copilot");
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
  const [voiceLang, setVoiceLang] = useState<"ar-YE" | "ar-SA" | "en-US" | "en-GB">(
    isAr ? "ar-YE" : "en-US"
  );
  const [listening, setListening] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState("");
  const [micDiagnostics, setMicDiagnostics] = useState<VoiceDiagnosticStatus | null>(null);
  const [micSettingsPrompt, setMicSettingsPrompt] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const isStartingVoiceRef = useRef(false);
  const transcriptAccRef = useRef(createSpeechTranscriptAccumulator());
  const textInputRef = useRef<HTMLInputElement | null>(null);

  // Document & Image Extraction state
  const [pendingDocDraft, setPendingDocDraft] = useState<ExtractedDocumentDraft | null>(null);
  const [docExtractBusy, setDocExtractBusy] = useState(false);
  const [docPostBusy, setDocPostBusy] = useState(false);
  const docFileInputRef = useRef<HTMLInputElement | null>(null);
  const visionCameraInputRef = useRef<HTMLInputElement | null>(null);
  const visionImageInputRef = useRef<HTMLInputElement | null>(null);
  const [pendingVisionImage, setPendingVisionImage] = useState<CompressedVisionImage | null>(null);
  const [visionCompressBusy, setVisionCompressBusy] = useState(false);

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

  const [isExpandedWidth, setIsExpandedWidth] = useState(false);
  const [dialect, setDialect] = useState<CopilotDialectMode>(() => {
    if (typeof window !== "undefined") {
      const saved = window.localStorage.getItem("uas_copilot_dialect");
      if (saved === "msa" || saved === "yemeni") return saved;
    }
    return "yemeni";
  });
  const [speakingMsgId, setSpeakingMsgId] = useState<string | null>(null);
  const [audioLoadingMsgId, setAudioLoadingMsgId] = useState<string | null>(null);
  const activeAudioRef = useRef<HTMLAudioElement | null>(null);
  const activeAudioUrlRef = useRef<string | null>(null);

  const handleToggleDialect = () => {
    setDialect((prev) => {
      const next: CopilotDialectMode = prev === "yemeni" ? "msa" : "yemeni";
      if (typeof window !== "undefined") {
        window.localStorage.setItem("uas_copilot_dialect", next);
      }
      return next;
    });
  };

  const activeTenantSlug = useMemo(
    () =>
      normalizeMemoryTenantSlug(
        workspaceContext?.tenantSlug ||
          state.enterpriseProfile?.tenantSlug ||
          getStoredTenantId() ||
          "default"
      ),
    [workspaceContext?.tenantSlug, state.enterpriseProfile?.tenantSlug]
  );

  const [memories, setMemories] = useState<CopilotMemoryEntry[]>(() => {
    if (typeof window !== "undefined") {
      return loadLocalCopilotMemories(
        normalizeMemoryTenantSlug(
          workspaceContext?.tenantSlug || state.enterpriseProfile?.tenantSlug || getStoredTenantId() || "default"
        )
      );
    }
    return [];
  });
  const [memorySearch, setMemorySearch] = useState("");
  const [newMemoryContent, setNewMemoryContent] = useState("");
  const [newMemoryCategory, setNewMemoryCategory] = useState<CopilotMemoryCategory>("domain_fact");
  const [memoryBusy, setMemoryBusy] = useState(false);
  const [briefing, setBriefing] = useState<ExecutiveBriefingReport | null>(() => {
    if (typeof window !== "undefined") {
      return loadCachedExecutiveBriefing(
        normalizeMemoryTenantSlug(
          workspaceContext?.tenantSlug || state.enterpriseProfile?.tenantSlug || getStoredTenantId() || "default"
        )
      );
    }
    return null;
  });
  const [briefingExpanded, setBriefingExpanded] = useState(false);
  const [briefingBusy, setBriefingBusy] = useState(false);

  const liveFallbackBriefing = useMemo(
    () =>
      generateExecutiveBriefing({
        tenantSlug: activeTenantSlug,
        lang: isAr ? "ar" : "en",
        dialect,
        user: currentUser ?? "EXTERNAL_AUDITOR",
        userId: currentUser?.id,
        state,
        memories,
        offlineQueueCount: workspaceContext?.offlineQueueCount ?? 0,
        pendingConflictsCount: workspaceContext?.pendingConflictsCount ?? 0,
      }),
    [
      activeTenantSlug,
      isAr,
      dialect,
      currentUser,
      state,
      memories,
      workspaceContext?.offlineQueueCount,
      workspaceContext?.pendingConflictsCount,
    ]
  );

  const activeBriefing = briefing ?? liveFallbackBriefing;
  const totalBriefingAlertsCount =
    activeBriefing.counts.lowStockCount + activeBriefing.counts.overdueReceivablesCount;

  const mergedWorkspaceContext: UasWorkspaceContext = useMemo(
    () => ({
      ...(workspaceContext ?? {}),
      tenantSlug: activeTenantSlug,
      isOffline:
        workspaceContext?.isOffline ??
        (offlineMode ||
          isAndroidLocalIsolatedMode() ||
          (typeof navigator !== "undefined" && !navigator.onLine)),
      currency: workspaceContext?.currency || state.settings.defaultCurrency,
      dialect: isAr ? dialect : undefined,
    }),
    [workspaceContext, activeTenantSlug, offlineMode, state.settings.defaultCurrency, isAr, dialect]
  );

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
      offline_queue_count: mergedWorkspaceContext.offlineQueueCount ?? 0,
      pending_conflicts_count: mergedWorkspaceContext.pendingConflictsCount ?? 0,
      is_offline: Boolean(mergedWorkspaceContext.isOffline),
      tenant_slug: mergedWorkspaceContext.tenantSlug ?? null,
      active_tab: mergedWorkspaceContext.activeTab ?? null,
    }),
    [licenseStatus, state.enterpriseProfile, mergedWorkspaceContext]
  );

  const liveDiagnosticReport = useMemo(
    () => diagnoseLiveSystemState(clientDiagnostics),
    [clientDiagnostics]
  );

  const historyStorageKey = `uas_copilot_history_${currentUser?.id || "guest"}`;

  const welcomeMessage: CopilotChatMessage = useMemo(
    () => {
      const greet = buildCopilotGreetingFallback({
        lang: isAr ? "ar" : "en",
        dialect,
        activeTab: mergedWorkspaceContext.activeTab,
        projectName:
          mergedWorkspaceContext.selectedProjectId
            ? state.projects.find((p) => p.id === mergedWorkspaceContext.selectedProjectId)?.name
            : null,
      });
      return {
        id: "welcome-1",
        role: "assistant",
        text: isAr ? greet.ar : greet.en,
        timestamp: "—",
      };
    },
    [isAr, dialect, mergedWorkspaceContext.activeTab, mergedWorkspaceContext.selectedProjectId, state.projects]
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

  function stopSpeechPlayback() {
    if (activeAudioRef.current) {
      try {
        activeAudioRef.current.pause();
        activeAudioRef.current.currentTime = 0;
      } catch {
        // ignore
      }
      activeAudioRef.current = null;
    }
    if (activeAudioUrlRef.current) {
      try {
        URL.revokeObjectURL(activeAudioUrlRef.current);
      } catch {
        // ignore
      }
      activeAudioUrlRef.current = null;
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // ignore
      }
    }
    setSpeakingMsgId(null);
    setAudioLoadingMsgId(null);
  }

  function speakViaBrowserFallback(text: string, msgId?: string) {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      setSpeakingMsgId(null);
      return;
    }
    try {
      window.speechSynthesis.cancel();
      const spoken = formatSpokenTextForGeminiTts(text, {
        lang: isAr ? "ar" : "en",
        dialect,
        maxChars: 500,
      });
      if (!spoken) return;
      const utterance = new SpeechSynthesisUtterance(spoken);
      utterance.lang = isAr ? "ar-YE" : "en-US";
      utterance.rate = isAr ? 0.96 : 1.0;
      const voices = window.speechSynthesis.getVoices?.() ?? [];
      const preferredVoice = isAr
        ? voices.find((v) => /ar-ye/i.test(v.lang)) ||
          voices.find((v) => /ar-sa|ar-ae|ar-/i.test(v.lang))
        : voices.find((v) => /en-/i.test(v.lang));
      if (preferredVoice) utterance.voice = preferredVoice;
      if (msgId) setSpeakingMsgId(msgId);
      utterance.onend = () => setSpeakingMsgId(null);
      utterance.onerror = () => setSpeakingMsgId(null);
      window.speechSynthesis.speak(utterance);
    } catch {
      setSpeakingMsgId(null);
    }
  }

  async function speakText(text: string, msgId?: string, forcePlay = false) {
    if (!forcePlay && !ttsEnabled) return;
    if (typeof window === "undefined") return;

    if (msgId && speakingMsgId === msgId) {
      stopSpeechPlayback();
      return;
    }

    stopSpeechPlayback();

    const clean = formatSpokenTextForGeminiTts(text, {
      lang: isAr ? "ar" : "en",
      dialect,
      maxChars: 680,
    });
    if (!clean) return;

    if (!isOfflineClientContext()) {
      try {
        if (msgId) setAudioLoadingMsgId(msgId);
        const res = await fetch("/api/ai/speak", {
          method: "POST",
          headers: buildCopilotRequestHeaders(),
          body: JSON.stringify({
            text: clean,
            lang: isAr ? "ar" : "en",
            dialect,
          }),
        });

        if (res.ok && (res.headers.get("content-type") || "").includes("audio/")) {
          const blob = await res.blob();
          const objectUrl = URL.createObjectURL(blob);
          activeAudioUrlRef.current = objectUrl;
          const audio = new Audio(objectUrl);
          activeAudioRef.current = audio;
          if (msgId) setSpeakingMsgId(msgId);
          setAudioLoadingMsgId(null);
          audio.onended = () => stopSpeechPlayback();
          audio.onerror = () => {
            stopSpeechPlayback();
            speakViaBrowserFallback(clean, msgId);
          };
          await audio.play();
          return;
        }
      } catch {
        // Fallback smoothly to browser speechSynthesis
      } finally {
        setAudioLoadingMsgId(null);
      }
    }

    speakViaBrowserFallback(clean, msgId);
  }

  async function toggleVoiceListening() {
    if (listening || isStartingVoiceRef.current) {
      try {
        recognitionRef.current?.stop?.();
      } catch {
        // ignore
      }
      const flushed = transcriptAccRef.current.flushOnStop();
      setListening(false);
      isStartingVoiceRef.current = false;
      setInterimTranscript("");
      if (flushed) {
        setInputPrompt(flushed);
        await handleSendPrompt(flushed);
      }
      return;
    }

    if (typeof window === "undefined") return;

    // Language-independent mic permission & unused-app check (works identically for ar-YE, ar-SA, en-US, en-GB)
    const diag = await checkMicrophoneDiagnostics();
    setMicDiagnostics(diag);
    if (diag.permissionState !== "granted") {
      const grantedState = await requestMicrophoneAccess();
      if (grantedState === "denied") {
        setMicSettingsPrompt(true);
        onToast(
          isAr
            ? "⚠️ تم رفض إذن الميكروفون؛ اضغط «فتح إعدادات التطبيق» لمنح صلاحية الصوت أو استخدم الكتابة."
            : "⚠️ Microphone permission denied; tap 'Open App Settings' to grant access or use text input."
        );
        return;
      }
    }
    setMicSettingsPrompt(false);

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
          partialResults: true,
          popup: true,
        });
        const transcript = Array.isArray(res?.matches) ? res.matches[0] : "";
        setListening(false);
        isStartingVoiceRef.current = false;
        setInterimTranscript("");
        if (transcript) {
          setInputPrompt(transcript);
          await handleSendPrompt(transcript);
        }
        return;
      } catch {
        setListening(false);
        isStartingVoiceRef.current = false;
        setInterimTranscript("");
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

    const startSpeechEngine = (targetLocale: string) => {
      transcriptAccRef.current.reset();
      isStartingVoiceRef.current = true;
      const rec = new SpeechRec();
      rec.lang = targetLocale;
      rec.interimResults = true;
      rec.continuous = true;
      rec.maxAlternatives = 1;

      rec.onstart = () => {
        isStartingVoiceRef.current = false;
        setListening(true);
      };

      rec.onresult = (event: SpeechRecognitionEventLike) => {
        const resList = event?.results;
        const { combined } = transcriptAccRef.current.ingestResults(
          resList as unknown as Parameters<typeof transcriptAccRef.current.ingestResults>[0]
        );
        if (combined) {
          setInterimTranscript(combined);
          setInputPrompt(combined);
        }
      };

      rec.onerror = (event: SpeechRecognitionErrorEventLike) => {
        const normErr = normalizeSpeechError(event?.error);
        if (normErr.code === "language-not-supported" && targetLocale === "ar-YE") {
          setVoiceLang("ar-SA");
          try {
            rec.abort();
          } catch {}
          startSpeechEngine("ar-SA");
          return;
        }

        setListening(false);
        isStartingVoiceRef.current = false;
        const partial = transcriptAccRef.current.flushOnStop();
        setInterimTranscript("");
        if (partial) {
          setInputPrompt(partial);
        }
        if (normErr.shouldOpenSettings) {
          setMicSettingsPrompt(true);
        }
        if (normErr.code !== "aborted") {
          onToast(isAr ? normErr.messageAr : normErr.messageEn);
          textInputRef.current?.focus();
        }
      };

      rec.onend = () => {
        setListening(false);
        isStartingVoiceRef.current = false;
        const flushed = transcriptAccRef.current.flushOnStop();
        setInterimTranscript("");
        if (flushed) {
          setInputPrompt(flushed);
          void handleSendPrompt(flushed);
        }
      };

      recognitionRef.current = rec;
      rec.start();
    };

    try {
      startSpeechEngine(voiceLang);
    } catch {
      setListening(false);
      isStartingVoiceRef.current = false;
      setInterimTranscript("");
      onToast(
        isAr
          ? "⚠️ تعذر بدء الميكروفون الصوتي؛ يرجى استخدام الإدخال النصي."
          : "⚠️ Could not start voice microphone; please use manual text input."
      );
      textInputRef.current?.focus();
    }
  }

  async function handleDocumentFileSelected(file?: File | null) {
    if (!file) return;
    setDocExtractBusy(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      if (inputPrompt.trim()) {
        formData.append("text", inputPrompt.trim());
      }

      const res = await fetch("/api/ai/extract-document", {
        method: "POST",
        body: formData,
      });
      if (res.ok) {
        const data = (await res.json().catch(() => ({}))) as { draft?: ExtractedDocumentDraft };
        if (data.draft) {
          setPendingDocDraft(data.draft);
          onToast(
            isAr
              ? "✅ تم استخراج مسودة المستند — يرجى المراجعة وتأكيد الترحيل"
              : "✅ Document extracted into editable draft — review and confirm posting"
          );
          return;
        }
      }

      // Offline / local fallback
      let textContent = file.name;
      if (file.type.startsWith("text/") || file.name.endsWith(".csv") || file.name.endsWith(".txt")) {
        textContent = await file.text().catch(() => file.name);
      }
      const localDraft = await extractDocumentDraft({
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        textContent,
        defaultCurrency: state.settings.defaultCurrency || "YER",
        validationContext: { periodLockDate: state.settings.periodLockDate ?? null },
      });
      setPendingDocDraft(localDraft);
      onToast(
        isAr
          ? "✅ تم إعداد مسودة المستند محلياً — يرجى المراجعة قبل الترحيل"
          : "✅ Document draft prepared locally — review before posting"
      );
    } finally {
      setDocExtractBusy(false);
      if (docFileInputRef.current) {
        docFileInputRef.current.value = "";
      }
    }
  }

  async function handleVisionImageSelected(file?: File | null) {
    if (!file) return;
    setVisionCompressBusy(true);
    try {
      const compressed = await compressImageFileForVision(file, {
        maxDimension: 1600,
        quality: 0.82,
      });
      if (compressed.compressedBytes > MAX_VISION_IMAGE_BYTES) {
        onToast(
          isAr
            ? "حجم الصورة بعد الضغط لا يزال يتجاوز 6 ميجابايت؛ يرجى التقاط صورة أوضح وأصغر."
            : "Compressed image still exceeds 6 MB limit; please select a smaller image."
        );
        return;
      }
      setPendingVisionImage(compressed);
      onToast(
        isAr
          ? `📷 تم تجهيز الصورة (${Math.max(1, Math.round(compressed.compressedBytes / 1024))} KB) — اضغط إرسال لتحليلها`
          : `📷 Image ready (${Math.max(1, Math.round(compressed.compressedBytes / 1024))} KB) — press Send to analyze`
      );
    } catch {
      onToast(
        isAr ? "تعذر قراءة أو ضغط الصورة المحددة." : "Failed to read or compress selected image."
      );
    } finally {
      setVisionCompressBusy(false);
      if (visionCameraInputRef.current) visionCameraInputRef.current.value = "";
      if (visionImageInputRef.current) visionImageInputRef.current.value = "";
    }
  }

  function updatePendingDraft(updater: (prev: ExtractedDocumentDraft) => ExtractedDocumentDraft) {
    setPendingDocDraft((prev) => {
      if (!prev) return null;
      const next = updater(prev);
      next.warnings = validateExtractedDraft(next, {
        periodLockDate: state.settings.periodLockDate ?? null,
      });
      return next;
    });
  }

  async function handleConfirmPostExtractedDraft() {
    if (!pendingDocDraft || docPostBusy) return;
    const blockingErrors = validateExtractedDraft(pendingDocDraft, {
      periodLockDate: state.settings.periodLockDate ?? null,
    }).filter((w) => w.severity === "error");

    if (blockingErrors.length > 0) {
      onToast(isAr ? blockingErrors[0].messageAr : blockingErrors[0].messageEn);
      return;
    }

    setDocPostBusy(true);
    try {
      const res = await safeFetchJson<{
        success?: boolean;
        entryNumber?: string;
        error?: string;
      }>("/api/ai/extract-document/post", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(currentUser?.id ? { "x-uas-user-id": currentUser.id } : {}),
          ...(currentUser?.role ? { "x-uas-role": String(currentUser.role) } : {}),
        },
        body: JSON.stringify({
          confirmed: true,
          draft: pendingDocDraft,
          actor: currentUser
            ? {
                userId: currentUser.id,
                userDisplay: currentUser.name,
                userRole: currentUser.role,
              }
            : undefined,
        }),
      });

      if (!res.ok || !res.data?.success) {
        onToast(
          res.data?.error ||
            (isAr ? "تعذر ترحيل المستند المستخرج" : "Failed to post extracted document")
        );
        return;
      }

      const postedNum = res.data.entryNumber || pendingDocDraft.reference;
      setMessages((prev) => [
        ...prev,
        {
          id: getNextMsgId("doc-posted"),
          role: "assistant",
          text: isAr
            ? `✅ تم ترحيل المستند (${pendingDocDraft.fileName}) بقيد يومية معتمد رقم **${postedNum}**.`
            : `✅ Extracted document (${pendingDocDraft.fileName}) posted as Journal Entry **${postedNum}**.`,
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        },
      ]);
      setPendingDocDraft(null);
      await onRefreshState();
      onToast(
        isAr ? `✅ تم ترحيل القيد (${postedNum}) بنجاح` : `✅ Posted Journal Entry (${postedNum})`
      );
    } finally {
      setDocPostBusy(false);
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

    const prevMsg = messages[idx];
    const isCorrectionEdit = prevMsg.text.trim() !== trimmed && trimmed.length >= 8;

    // Truncate subsequent messages after this turn
    const truncated = messages.slice(0, idx);
    setMessages(truncated);

    // Re-run AI reasoning with updated prompt & capture correction context if changed
    await handleSendPrompt(
      trimmed,
      truncated,
      isCorrectionEdit && idx > 0 ? `تصحيح/تعديل المستخدم للطلب السابق: ${trimmed}` : undefined
    );
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

  function isOfflineClientContext(): boolean {
    const isPackagedStaticOrigin =
      typeof window !== "undefined" &&
      (window.location.protocol === "capacitor:" || window.location.protocol === "file:");
    return (
      offlineMode ||
      isAndroidLocalIsolatedMode() ||
      isPackagedStaticOrigin ||
      (typeof navigator !== "undefined" && !navigator.onLine)
    );
  }

  function buildCopilotRequestHeaders(): Record<string, string> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const token = getStoredSessionToken();
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
      headers["x-uas-session-token"] = token;
    }
    const tenantId = getStoredTenantId();
    if (tenantId && tenantId !== "default") {
      headers["x-uas-tenant-id"] = tenantId;
    }
    if (currentUser?.id) headers["x-uas-user-id"] = currentUser.id;
    if (currentUser?.role) headers["x-uas-role"] = String(currentUser.role);
    return headers;
  }

  const refreshTenantMemories = useCallback(async () => {
    const localSnapshot = loadLocalCopilotMemories(activeTenantSlug);
    if (isOfflineClientContext()) {
      setMemories(localSnapshot);
      return;
    }
    setMemoryBusy(true);
    try {
      const headers = buildCopilotRequestHeaders();
      const res = await fetch("/api/ai/memory?includeInactive=true", { headers });
      if (!res.ok) {
        setMemories(localSnapshot);
        return;
      }
      const data = (await res.json()) as { memories?: CopilotMemoryEntry[] };
      let serverList = Array.isArray(data.memories) ? data.memories : [];
      const serverIds = new Set(serverList.map((m) => m.id));
      const unsyncedLocal = localSnapshot.filter((m) => !serverIds.has(m.id));
      if (unsyncedLocal.length > 0) {
        const syncRes = await fetch("/api/ai/memory", {
          method: "POST",
          headers,
          body: JSON.stringify({ action: "sync", entries: unsyncedLocal }),
        });
        if (syncRes.ok) {
          const syncData = (await syncRes.json()) as { memories?: CopilotMemoryEntry[] };
          if (Array.isArray(syncData.memories)) {
            serverList = syncData.memories;
          }
        }
      }
      saveLocalCopilotMemories(activeTenantSlug, serverList);
      setMemories(serverList);
    } catch {
      setMemories(localSnapshot);
    } finally {
      setMemoryBusy(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTenantSlug, offlineMode, currentUser?.id]);

  const refreshExecutiveBriefing = useCallback(
    async (forceRefresh = false) => {
      if (isOfflineClientContext()) {
        const offlineReport = generateExecutiveBriefing({
          tenantSlug: activeTenantSlug,
          lang: isAr ? "ar" : "en",
          dialect,
          user: currentUser ?? "VIEWER",
          userId: currentUser?.id,
          state,
          memories,
          offlineQueueCount: workspaceContext?.offlineQueueCount ?? 0,
          pendingConflictsCount: workspaceContext?.pendingConflictsCount ?? 0,
        });
        saveCachedExecutiveBriefing(activeTenantSlug, offlineReport);
        setBriefing(offlineReport);
        return;
      }

      setBriefingBusy(true);
      try {
        const headers = buildCopilotRequestHeaders();
        const res = forceRefresh
          ? await fetch("/api/ai/briefing", {
              method: "POST",
              headers,
              body: JSON.stringify({
                lang: isAr ? "ar" : "en",
                dialect,
                refresh: true,
              }),
            })
          : await fetch(
              `/api/ai/briefing?lang=${isAr ? "ar" : "en"}&dialect=${dialect}`,
              { headers }
            );
        if (res.ok) {
          const data = (await res.json()) as ExecutiveBriefingReport & { success?: boolean };
          if (data && data.counts) {
            saveCachedExecutiveBriefing(activeTenantSlug, data);
            setBriefing(data);
            return;
          }
        }
      } catch {
        // Fallback to local snapshot calculation
      } finally {
        setBriefingBusy(false);
      }

      const fallbackReport = generateExecutiveBriefing({
        tenantSlug: activeTenantSlug,
        lang: isAr ? "ar" : "en",
        dialect,
        user: currentUser ?? "EXTERNAL_AUDITOR",
        userId: currentUser?.id,
        state,
        memories,
        offlineQueueCount: workspaceContext?.offlineQueueCount ?? 0,
        pendingConflictsCount: workspaceContext?.pendingConflictsCount ?? 0,
      });
      saveCachedExecutiveBriefing(activeTenantSlug, fallbackReport);
      setBriefing(fallbackReport);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeTenantSlug, isAr, dialect, offlineMode, currentUser?.id]
  );

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      void refreshTenantMemories();
      void refreshExecutiveBriefing(false);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [open, refreshTenantMemories, refreshExecutiveBriefing]);

  const handleUndoLearnedEvent = async (msgId: string, ev: MemoryMutationEvent) => {
    try {
      const payload =
        ev.action === "forgotten"
          ? {
              action: "upsert",
              ...ev.entry,
            }
          : {
              action: "undo",
              id: ev.entry.id,
              previousEntry: ev.previousEntry ?? undefined,
            };

      if (!isOfflineClientContext()) {
        const res = await fetch("/api/ai/memory", {
          method: "POST",
          headers: buildCopilotRequestHeaders(),
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          const data = (await res.json()) as { memories?: CopilotMemoryEntry[] };
          if (Array.isArray(data.memories)) {
            saveLocalCopilotMemories(activeTenantSlug, data.memories);
            setMemories(data.memories);
          }
        }
      } else {
        const current = loadLocalCopilotMemories(activeTenantSlug);
        let next =
          ev.action === "forgotten"
            ? [ev.entry, ...current.filter((m) => m.id !== ev.entry.id)]
            : current.filter((m) => m.id !== ev.entry.id);
        if (ev.action !== "forgotten" && ev.previousEntry) {
          next = [ev.previousEntry, ...next];
        }
        saveLocalCopilotMemories(activeTenantSlug, next);
        setMemories(next);
      }

      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId
            ? {
                ...m,
                learnedEvents: (m.learnedEvents ?? []).filter((x) => x.entry.id !== ev.entry.id),
              }
            : m
        )
      );
      onToast(isAr ? "تم التراجع عن التعلّم وتحديث ذاكرة المساعد" : "Undid learned memory");
    } catch {
      onToast(isAr ? "تعذر التراجع عن المعلومة" : "Failed to undo memory");
    }
  };

  const handleAddManualMemory = async () => {
    const content = newMemoryContent.trim();
    if (content.length < 6) return;
    setMemoryBusy(true);
    try {
      const headers = buildCopilotRequestHeaders();
      const res = await fetch("/api/ai/memory", {
        method: "POST",
        headers,
        body: JSON.stringify({
          action: "upsert",
          category: newMemoryCategory,
          scope: newMemoryCategory === "workflow_preference" ? "user" : "workspace",
          topicKey: `${newMemoryCategory}:${content.slice(0, 36)}`,
          content,
          sourceSnippet: content,
          confidence: 0.96,
          pinned: true,
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as { memories?: CopilotMemoryEntry[]; event?: MemoryMutationEvent };
        if (Array.isArray(data.memories)) {
          saveLocalCopilotMemories(activeTenantSlug, data.memories);
          setMemories(data.memories);
        }
        setNewMemoryContent("");
        onToast(isAr ? "تم حفظ القاعدة في ذاكرة المنشأة" : "Rule saved to tenant memory");
      } else {
        const errData = (await res.json().catch(() => ({}))) as { error?: string };
        onToast(errData.error || (isAr ? "تعذر حفظ المعلومة" : "Failed to save rule"));
      }
    } finally {
      setMemoryBusy(false);
    }
  };

  const handleMutateMemory = async (
    mem: CopilotMemoryEntry,
    action: "toggle" | "pin" | "delete"
  ) => {
    setMemoryBusy(true);
    try {
      const payload =
        action === "delete"
          ? { action: "delete", id: mem.id }
          : action === "pin"
          ? { action: "pin", id: mem.id, pinned: !mem.pinned }
          : { action: "toggle", id: mem.id, active: !mem.active };

      if (!isOfflineClientContext()) {
        const res = await fetch("/api/ai/memory", {
          method: "POST",
          headers: buildCopilotRequestHeaders(),
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          const data = (await res.json()) as { memories?: CopilotMemoryEntry[] };
          if (Array.isArray(data.memories)) {
            saveLocalCopilotMemories(activeTenantSlug, data.memories);
            setMemories(data.memories);
          }
        }
      } else {
        const current = loadLocalCopilotMemories(activeTenantSlug);
        const next =
          action === "delete"
            ? current.filter((m) => m.id !== mem.id)
            : current.map((m) =>
                m.id === mem.id
                  ? {
                      ...m,
                      pinned: action === "pin" ? !mem.pinned : m.pinned,
                      active: action === "toggle" ? !mem.active : m.active,
                      updatedAt: new Date().toISOString(),
                    }
                  : m
              );
        saveLocalCopilotMemories(activeTenantSlug, next);
        setMemories(next);
      }
    } finally {
      setMemoryBusy(false);
    }
  };

  async function handleSendPrompt(
    overrideText?: string,
    baseMessages?: CopilotChatMessage[],
    editedDraftContext?: string
  ) {
    const attachedImage = overrideText ? null : pendingVisionImage;
    const rawTypedPrompt = (overrideText ?? inputPrompt).trim();
    if ((!rawTypedPrompt && !attachedImage) || busy) return;

    const prompt =
      rawTypedPrompt ||
      (isAr
        ? "استخرج بيانات هذه الصورة وجهّز مسودة القيد أو السند أو كشف القطفة"
        : "Extract fields from this image and prepare the matching draft card");

    if (!activeThreadId) {
      const newTh = createThread(currentUser?.id, prompt.slice(0, 42), prompt.slice(0, 42));
      setActiveThreadId(newTh.id);
      setAllThreads(loadAllThreads(currentUser?.id));
    }

    const historySnapshot = (baseMessages ?? messages)
      .filter((m) => m.id !== "welcome-1" && m.text.trim().length > 0)
      .slice(-6)
      .map((m) => ({ role: m.role, text: m.text }));

    const userMsg: CopilotChatMessage = {
      id: getNextMsgId("u"),
      role: "user",
      text: prompt,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      ...(attachedImage
        ? {
            imagePreviewUrl: attachedImage.previewDataUrl,
            imageFileName: attachedImage.fileName,
          }
        : {}),
    };
    if (baseMessages) {
      setMessages([...baseMessages, userMsg]);
    } else {
      setMessages((prev) => [...prev, userMsg]);
    }
    if (!overrideText) setInputPrompt("");
    if (attachedImage) setPendingVisionImage(null);
    setBusy(true);

    try {
      let agentRes: CopilotAgentResponse | null = null;
      const shouldUseOfflineDirectly = isOfflineClientContext();

      if (shouldUseOfflineDirectly && attachedImage) {
        const offlineAtt: VisionSourceAttachment = {
          attachmentId: `loc-att-${Date.now().toString(36)}`,
          attachmentUrl: attachedImage.previewDataUrl,
          tenantSlug: activeTenantSlug,
          mimeType: attachedImage.mimeType,
          fileName: attachedImage.fileName,
          checksum: `local-${attachedImage.compressedBytes}`,
          byteLength: attachedImage.compressedBytes,
          extractedAt: new Date().toISOString(),
        };
        try {
          const storeKey = `uas_pending_vision_attachments_v1_${activeTenantSlug}`;
          const prevRaw = window.localStorage.getItem(storeKey);
          const prevList = prevRaw ? (JSON.parse(prevRaw) as VisionSourceAttachment[]) : [];
          window.localStorage.setItem(
            storeKey,
            JSON.stringify([offlineAtt, ...(Array.isArray(prevList) ? prevList : [])].slice(0, 50))
          );
        } catch {
          // ignore storage quota
        }

        const offlineVisionNoticeAr =
          "📵 **ملاحظة وضع الأوفلاين:** تحليل الصور بالذكاء الاصطناعي (Vision OCR) يتطلب اتصالاً بالإنترنت مع خادم `qat.world`. تم حفظ الصورة المرفقة محلياً لهذه المنشأة لربطها عند المزامنة، ويمكنك كتابة بيانات القطفة أو السند مباشرةً في الدردشة لتجهيزها محلياً دون إنترنت.";
        const offlineVisionNoticeEn =
          "📵 **Offline Notice:** Multimodal Vision OCR requires an online connection to `qat.world`. Your image reference was saved locally for linking upon sync, and you can type the receipt or harvest details directly in chat to stage a local draft.";
        if (rawTypedPrompt) {
          agentRes = await runUasAiAgent(rawTypedPrompt, {
            user: currentUser ?? "SUPER_ADMIN",
            lang,
            state,
            workspaceContext: mergedWorkspaceContext,
            diagnostics: clientDiagnostics,
            sourceAttachment: offlineAtt,
          });
        } else {
          agentRes = {
            ok: false,
            tierUsed: "tier3_offline_deterministic",
            modelUsed: "Offline Local Engine",
            reply: isAr ? offlineVisionNoticeAr : offlineVisionNoticeEn,
            replyAr: offlineVisionNoticeAr,
            replyEn: offlineVisionNoticeEn,
            requiresConfirmation: false,
          };
        }
      } else if (!shouldUseOfflineDirectly) {
        try {
          const headers = buildCopilotRequestHeaders();
          const res = await fetch("/api/ai/agent", {
            method: "POST",
            headers,
            body: JSON.stringify({
              prompt,
              lang,
              workspaceContext: mergedWorkspaceContext,
              conversationHistory: historySnapshot,
              ...(attachedImage
                ? {
                    imageAttachment: {
                      imageBase64: attachedImage.base64Data,
                      mimeType: attachedImage.mimeType,
                      fileName: attachedImage.fileName,
                    },
                  }
                : {}),
              ...(editedDraftContext ? { editedDraftContext } : {}),
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
          } else if (res.status === 401) {
            // Guest / pre-login chat on landing or login screen -> route to public Gemini Support API
            const supportRes = await fetch("/api/support/chat", {
              method: "POST",
              headers,
              body: JSON.stringify({
                query: prompt,
                lang,
                dialect,
                diagnostics: clientDiagnostics,
              }),
            });
            if (supportRes.ok) {
              const sData = (await supportRes.json()) as {
                answer?: string;
                answerAr?: string;
                answerEn?: string;
                modelUsed?: string;
              };
              agentRes = {
                ok: true,
                tierUsed: sData.modelUsed && sData.modelUsed !== "Offline Local Engine" ? "tier1_cloud_llm" : "tier3_offline_deterministic",
                modelUsed: sData.modelUsed || "Offline Local Engine",
                reply: sData.answer,
                replyAr: sData.answerAr || sData.answer,
                replyEn: sData.answerEn || sData.answer,
                requiresConfirmation: false,
              };
            }
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
          workspaceContext: mergedWorkspaceContext,
          diagnostics: clientDiagnostics,
        });
      }

      const replyText =
        lang === "ar"
          ? agentRes.replyAr || agentRes.reply || ""
          : agentRes.replyEn || agentRes.reply || "";

      const assistantId = getNextMsgId("a");
      const assistantMsg: CopilotChatMessage = {
        id: assistantId,
        role: "assistant",
        text: replyText,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        tierUsed: agentRes.tierUsed,
        modelUsed:
          agentRes.modelUsed ||
          (agentRes.tierUsed === "tier3_offline_deterministic" ? "Offline Local Engine" : undefined),
        taskComplexity: agentRes.taskComplexity,
        reasoningTrace: agentRes.reasoningTrace,
        confirmationCard: agentRes.confirmationCard,
        navigationTab: agentRes.navigationTab,
        openLicenseModal: agentRes.openLicenseModal,
        citations: agentRes.citations,
        clarificationPrompt: agentRes.clarificationPrompt,
        escalationCard: agentRes.escalationCard,
        learnedEvents: agentRes.learnedEvents,
        visionExtraction: agentRes.visionExtraction,
      };

      if (agentRes.learnedEvents && agentRes.learnedEvents.length > 0) {
        void refreshTenantMemories();
      }

      setMessages((prev) => [...prev, assistantMsg]);
      void speakText(replyText, assistantId);

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
      let linkedAttachment: VisionSourceAttachment | null = card.sourceAttachment ?? null;
      let handledByServer = false;

      if (!isOfflineClientContext()) {
        try {
          const headers = buildCopilotRequestHeaders();

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
          if (data.sourceAttachment) {
            linkedAttachment = data.sourceAttachment as VisionSourceAttachment;
          }
          await onRefreshState();
        } catch (serverErr: unknown) {
          if (handledByServer) throw serverErr;
        }
      }

      if (!handledByServer) {
        const p = (card.executionPayload || {}) as Record<string, unknown>;
        const actorUser = currentUser || state.users[0] || null;
        if (card.operationType === "EXPORT_CLIENT_REPORT") {
          entryNumber = `RPT-CUST-${getNextMsgId("e")}`;
          summaryText = isAr
            ? `📄 كشف حساب العميل (${card.partyName || "كافة العملاء"}) جاهز للطباعة وتصدير PDF.`
            : `📄 Client statement for (${card.partyName || "All Clients"}) is ready for export.`;
          onNavigateTab("customers");
        } else if (actorUser) {
          const endpointMap: Partial<Record<ConfirmationPreviewCard["operationType"], { endpoint: string; nav: TabId }>> = {
            RECORD_HARVEST_BATCH: { endpoint: "/api/inventory", nav: "inventory" },
            RECORD_SALE: { endpoint: "/api/sales", nav: "sales" },
            RECORD_EXPENSE: { endpoint: "/api/expenses", nav: "expenses" },
            RECORD_WORKER_WAGE: { endpoint: "/api/workers", nav: "workers" },
            TREASURY_TRANSFER: { endpoint: "/api/treasury/transfer", nav: "treasury" },
            TOGGLE_PERIOD_LOCK: { endpoint: "/api/audit/lock", nav: "audit" },
            ADD_HARVEST_CYCLE: { endpoint: "/api/projects/harvests", nav: "projects" },
            CREATE_PROJECT: { endpoint: "/api/projects", nav: "projects" },
            CREATE_CUSTOMER: { endpoint: "/api/sales/customers", nav: "customers" },
            CREATE_VENDOR: { endpoint: "/api/procurement/vendors", nav: "procurement" },
            RECEIPT_VOUCHER: { endpoint: "/api/installments", nav: "treasury" },
            PAYMENT_VOUCHER: { endpoint: "/api/installments", nav: "treasury" },
            JOURNAL_ENTRY: { endpoint: "/api/accounting/journal", nav: "ledger" },
            SALES_INVOICE: { endpoint: "/api/accounting/journal", nav: "sales" },
            PURCHASE_BILL: { endpoint: "/api/accounting/journal", nav: "procurement" },
          };
          const targetRoute = endpointMap[card.operationType] || { endpoint: "/api/audit/log", nav: "audit" as TabId };
          const mutPayload: Record<string, unknown> =
            card.operationType === "RECEIPT_VOUCHER" || card.operationType === "PAYMENT_VOUCHER"
              ? {
                  voucherNo: entryNumber,
                  type: card.operationType === "RECEIPT_VOUCHER" ? "تحصيل من عميل" : "دفع لمستفيد",
                  targetName: card.partyName || String(p.partyName || "طرف"),
                  amount: Number(p.amount ?? card.totalDebit ?? 0),
                  date: card.date,
                  notes: `${isAr ? card.narrationAr : card.narrationEn}${card.sourceAttachment ? ` [source_doc:${card.sourceAttachment.attachmentId} | ${card.sourceAttachment.attachmentUrl}]` : ""}`,
                  ...(card.sourceAttachment ? { sourceAttachment: card.sourceAttachment } : {}),
                  executed_by_ai: true,
                }
              : {
                  ...p,
                  ...(card.sourceAttachment
                    ? {
                        notes: `${String(p.notes || "")} [source_doc:${card.sourceAttachment.attachmentId} | ${card.sourceAttachment.attachmentUrl}]`.trim(),
                        sourceAttachment: card.sourceAttachment,
                      }
                    : {}),
                  executed_by_ai: true,
                };

          const mutRes = await executeMutation({
            endpoint: targetRoute.endpoint,
            method: "POST",
            payload: mutPayload,
            label: isAr ? card.titleAr : card.titleEn,
            currentState: state,
            currentUser: actorUser,
            offlineMode: true,
          });
          if (mutRes.error) {
            throw new Error(mutRes.error);
          }
          onApplyState?.(mutRes.state, mutRes.queueCount);
          onNavigateTab(targetRoute.nav);
          entryNumber = `LOC-${getNextMsgId("e")}`;
          summaryText = isAr
            ? `✅ تم التنفيذ والحفظ محلياً (${entryNumber}) — ${card.titleAr}${mutRes.queuedOffline ? ` [قائمة المزامنة #${mutRes.queueCount}]` : " [محفوظ محلياً]"}.`
            : `✅ Executed & persisted locally (${entryNumber}) — ${card.titleEn}${mutRes.queuedOffline ? ` [Sync Queue #${mutRes.queueCount}]` : " [Local Store]"}.`;
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
                  ...(linkedAttachment ? { sourceAttachment: linkedAttachment } : {}),
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

      if (!isOfflineClientContext()) {
        try {
          const headers = buildCopilotRequestHeaders();

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

  const activeTab = mergedWorkspaceContext.activeTab || "dashboard";
  const tabQuickPromptsAr: Partial<Record<TabId, string[]>> = {
    inventory: [
      "مطابقة الحصاد والمخزون والفاقد",
      "سجل دفعة حصاد 50 علاقي رقم 1",
    ],
    sales: [
      "مطابقة الحصاد والمخزون والمبيعات",
      "سند قبض من شركة الأمل بمبلغ 40000",
    ],
    expenses: [
      "سجل مصروف وقود بمبلغ 25000",
      "ملخص المشروع الحالي والموازنة",
    ],
    workers: [
      "ملخص أجور العمال والمستحقات",
      "سجل أجر للعامل أحمد بمبلغ 5000 لمدة 1 يوم",
    ],
    treasury: [
      "أرصدة الخزائن والبنوك المتاحة",
      "تحويل مالي 50000 من الصندوق إلى البنك",
    ],
    audit: [
      "فحص الفترات المغلقة وسجل التدقيق",
      "إغلاق القطفة محاسبياً",
    ],
    system: [
      "تشخيص حالة الترخيص ومقاعد الـ 7 مستخدمين",
      "كيف ألغي ربط جهاز مفقود؟",
    ],
  };
  const tabQuickPromptsEn: Partial<Record<TabId, string[]>> = {
    inventory: [
      "Reconcile harvest inventory & shrinkage",
      "Record harvest batch 50 bundles Grade 1",
    ],
    sales: [
      "Reconcile harvest stock vs sales",
      "Receipt voucher from Al-Amal Co for 40000",
    ],
    expenses: [
      "Record fuel expense 25000 YER",
      "Analyze current workspace & budget",
    ],
    workers: [
      "Workers payroll summary",
      "Record worker wage for Ahmed 5000 for 1 day",
    ],
    treasury: [
      "Query treasury & bank balances",
      "Treasury transfer 50000",
    ],
    audit: [
      "Audit trail and locked periods",
      "Lock current harvest period",
    ],
    system: [
      "Diagnose system health and 7-user license seats",
      "How do I release a lost device seat?",
    ],
  };

  const quickPrompts = isAr
    ? [
        "تحليل الوضع الحالي عبر الأقسام",
        ...(tabQuickPromptsAr[activeTab] || []),
        "أنشئ عميل جديد شركة النور هاتف 771234567 وحد ائتماني 500000",
        "أنشئ مشروع جديد مزرعة الجوف بموازنة 3000000",
        "اعرض ملخص ميزان المراجعة وقائمة الدخل",
        "تشخيص حالة الترخيص ومقاعد الـ 7 مستخدمين",
      ]
    : [
        "Analyze current workspace briefing",
        ...(tabQuickPromptsEn[activeTab] || []),
        "Create customer Al-Noor Co phone 771234567 credit limit 500000",
        "Create project Al-Jawf Farm budget 3000000",
        "Generate Trial Balance and P&L report summary",
        "Diagnose system health and 7-user license seats",
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
              {totalBriefingAlertsCount > 0 ? (
                <span
                  data-testid="copilot-fab-alert-badge"
                  className="absolute -top-2 -right-2 min-w-[18px] h-[18px] px-1 rounded-full bg-amber-400 text-slate-950 text-[10px] font-black flex items-center justify-center shadow"
                >
                  {totalBriefingAlertsCount}
                </span>
              ) : (
                <>
                  <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-amber-300 animate-ping" />
                  <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-amber-400" />
                </>
              )}
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
          className={`${
            isAr ? "left-3 sm:left-5" : "right-3 sm:right-5"
          } fixed bottom-20 md:bottom-6 z-50 w-[calc(100vw-1.5rem)] ${
            isExpandedWidth ? "sm:w-[640px]" : "sm:w-[470px]"
          } max-h-[85vh] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl flex flex-col overflow-hidden text-slate-900 dark:text-slate-100 transition-all`}
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
                  <span
                    data-testid="uas-ai-runtime-badge"
                    className="px-1.5 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 font-mono text-[9px]"
                  >
                    {mergedWorkspaceContext.isOffline
                      ? "Offline Local Engine"
                      : "Online • Gemini"}
                  </span>
                </div>
                <div className="text-[10px] text-slate-300">
                  {isAr
                    ? `الدور: ${currentUser?.role || "زائر"} • الشاشة: ${activeTab} • المقاعد: ${clientDiagnostics.used_users}/${clientDiagnostics.max_users}`
                    : `Role: ${currentUser?.role || "Guest"} • Tab: ${activeTab} • Seats: ${clientDiagnostics.used_users}/${clientDiagnostics.max_users}`}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              {isAr && (
                <button
                  type="button"
                  data-testid="uas-ai-copilot-dialect-btn"
                  onClick={handleToggleDialect}
                  className="px-2 py-1 rounded-xl border border-white/15 bg-white/5 hover:bg-white/15 text-[10px] font-bold text-amber-200 transition"
                  title="التبديل بين اللهجة اليمنية والعربية الفصحى"
                >
                  {dialect === "yemeni" ? "🇾🇪 يمني" : "📖 فصحى"}
                </button>
              )}
              <button
                type="button"
                data-testid="uas-ai-copilot-expand-btn"
                onClick={() => setIsExpandedWidth((v) => !v)}
                className="hidden sm:inline-flex px-2 py-1 rounded-xl border border-white/10 text-[10px] font-bold text-slate-300 hover:text-emerald-300 hover:bg-white/10 transition"
                title={isAr ? "توسيع / تضييق النافذة" : "Toggle Width"}
              >
                {isExpandedWidth ? (isAr ? "ضيق" : "Compact") : (isAr ? "توسيع" : "Wide")}
              </button>
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

            <button
              type="button"
              data-testid="copilot-memory-tab"
              onClick={() => {
                setActivePane("memory");
                void refreshTenantMemories();
              }}
              className={`flex-1 py-2.5 px-2 border-b-2 flex items-center justify-center gap-1.5 transition ${
                activePane === "memory"
                  ? "border-emerald-600 text-emerald-600 dark:text-emerald-400 bg-white dark:bg-slate-900"
                  : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
              }`}
            >
              <Brain className="w-3.5 h-3.5" />
              <span>
                {isAr
                  ? `ذاكرة المساعد (${memories.filter((m) => m.active).length})`
                  : `Memory (${memories.filter((m) => m.active).length})`}
              </span>
            </button>
          </div>

          {/* =============================================================== */}
          {/* PANE 1: AI ERP COPILOT (Voice + Text + Confirmation Cards)     */}
          {/* =============================================================== */}
          {activePane === "copilot" && (
            <>
              {/* Live Workspace Context & Sync Status Strip */}
              <div className="px-3.5 py-2 bg-slate-100/80 dark:bg-slate-950/60 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-[10px]">
                <div className="flex flex-wrap items-center gap-1.5 text-slate-600 dark:text-slate-300 font-bold">
                  <span className="px-2 py-0.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700">
                    {isAr ? `القسم: ${activeTab}` : `Tab: ${activeTab}`}
                  </span>
                  {mergedWorkspaceContext.selectedHarvest && (
                    <span className="px-2 py-0.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700">
                      {mergedWorkspaceContext.selectedHarvest}
                    </span>
                  )}
                  {(mergedWorkspaceContext.offlineQueueCount ?? 0) > 0 && (
                    <span className="px-2 py-0.5 rounded-lg bg-amber-500/15 text-amber-700 dark:text-amber-300 font-mono">
                      {isAr
                        ? `طابور: ${mergedWorkspaceContext.offlineQueueCount}`
                        : `Queued: ${mergedWorkspaceContext.offlineQueueCount}`}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  data-testid="copilot-analyze-context-btn"
                  onClick={() =>
                    handleSendPrompt(
                      isAr ? "تحليل الوضع الحالي عبر الأقسام" : "Analyze current workspace briefing"
                    )
                  }
                  className="px-2 py-0.5 rounded-lg bg-emerald-600/15 hover:bg-emerald-600/25 text-emerald-700 dark:text-emerald-300 font-black transition"
                >
                  {isAr ? "⚡ فحص ذكي للسياق" : "⚡ Analyze Context"}
                </button>
              </div>

              {/* Compact Collapsible Daily Executive Briefing & Low-Stock / Overdue Alerts */}
              <div
                data-testid="copilot-executive-briefing-banner"
                className="px-3.5 py-2 bg-gradient-to-r from-amber-500/10 via-emerald-500/5 to-sky-500/10 border-b border-slate-200 dark:border-slate-800 text-[11px]"
              >
                <div className="flex flex-wrap items-center justify-between gap-1.5">
                  <button
                    type="button"
                    data-testid="copilot-briefing-toggle"
                    onClick={() => setBriefingExpanded((v) => !v)}
                    className="flex flex-wrap items-center gap-1.5 font-black text-slate-800 dark:text-slate-100 hover:text-emerald-700 dark:hover:text-emerald-300 transition text-start"
                  >
                    <Bell className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                    <span>{isAr ? "ملخص اليوم والتنبيهات" : "Daily Briefing & Alerts"}</span>
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-rose-500/15 text-rose-700 dark:text-rose-300 text-[10px]">
                      <Package className="w-3 h-3" />
                      {isAr
                        ? `نقص المخزون: ${activeBriefing.counts.lowStockCount}`
                        : `Low Stock: ${activeBriefing.counts.lowStockCount}`}
                    </span>
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-amber-500/15 text-amber-800 dark:text-amber-300 text-[10px]">
                      <CreditCard className="w-3 h-3" />
                      {isAr
                        ? `ذمم متأخرة: ${activeBriefing.counts.overdueReceivablesCount}`
                        : `Overdue: ${activeBriefing.counts.overdueReceivablesCount}`}
                    </span>
                    {briefingExpanded ? (
                      <ChevronUp className="w-3.5 h-3.5 text-slate-500" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
                    )}
                  </button>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      data-testid="copilot-briefing-speak-btn"
                      onClick={() =>
                        void speakText(
                          activeBriefing.briefing,
                          "daily-briefing-banner",
                          true
                        )
                      }
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-emerald-700 dark:text-emerald-300 font-bold text-[10px] hover:bg-emerald-50 dark:hover:bg-emerald-950/30 transition"
                      title={isAr ? "استماع لملخص اليوم بصوت طبيعي" : "Read Executive Briefing Aloud"}
                    >
                      {speakingMsgId === "daily-briefing-banner" ? (
                        <VolumeX className="w-3 h-3" />
                      ) : (
                        <Volume2 className="w-3 h-3" />
                      )}
                      <span>{isAr ? "استماع" : "Read Aloud"}</span>
                    </button>

                    <button
                      type="button"
                      data-testid="copilot-briefing-refresh-btn"
                      disabled={briefingBusy}
                      onClick={() => {
                        setBriefingExpanded(true);
                        void refreshExecutiveBriefing(true);
                      }}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold text-[10px] transition"
                    >
                      <RefreshCw className={`w-3 h-3 ${briefingBusy ? "animate-spin" : ""}`} />
                      <span>{isAr ? "تحديث الملخص" : "Generate Briefing"}</span>
                    </button>
                  </div>
                </div>

                {briefingExpanded && (
                  <div className="mt-2.5 pt-2.5 border-t border-slate-200/70 dark:border-slate-700/70 space-y-2 max-h-48 overflow-y-auto">
                    <div className="flex items-center justify-between text-[10px] text-slate-500">
                      <span>{activeBriefing.date}</span>
                      <span className="px-1.5 py-0.5 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono">
                        {activeBriefing.modelUsed}
                      </span>
                    </div>
                    <div className="whitespace-pre-line text-[11px] text-slate-700 dark:text-slate-200 leading-relaxed bg-white/80 dark:bg-slate-900/80 p-2.5 rounded-xl border border-slate-200/70 dark:border-slate-800">
                      {activeBriefing.briefing}
                    </div>

                    {activeBriefing.lowStockAlerts.length > 0 && (
                      <div className="space-y-1">
                        <div className="text-[10px] font-black text-rose-700 dark:text-rose-300">
                          {isAr ? "📦 تنبيهات انخفاض المخزون:" : "📦 Low-Stock Alerts:"}
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {activeBriefing.lowStockAlerts.slice(0, 4).map((al) => (
                            <button
                              key={al.id}
                              type="button"
                              data-testid="copilot-low-stock-alert"
                              onClick={() => {
                                void handleSendPrompt(
                                  isAr ? al.followUpPromptAr : al.followUpPromptEn
                                );
                              }}
                              className="text-start px-2 py-1 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/25 text-[10px] text-rose-800 dark:text-rose-200 font-bold transition"
                            >
                              {isAr ? al.summaryAr : al.summaryEn}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {activeBriefing.overdueReceivableAlerts.length > 0 && (
                      <div className="space-y-1">
                        <div className="text-[10px] font-black text-amber-800 dark:text-amber-300">
                          {isAr ? "💳 المديونيات المتأخرة عن السداد:" : "💳 Overdue Receivables:"}
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {activeBriefing.overdueReceivableAlerts.slice(0, 4).map((al) => (
                            <button
                              key={al.id}
                              type="button"
                              data-testid="copilot-overdue-alert"
                              onClick={() => {
                                void handleSendPrompt(
                                  isAr ? al.followUpPromptAr : al.followUpPromptEn
                                );
                              }}
                              className="text-start px-2 py-1 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/25 text-[10px] text-amber-900 dark:text-amber-200 font-bold transition"
                            >
                              {isAr ? al.summaryAr : al.summaryEn}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

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
                        <div className="space-y-1">
                          {msg.role === "assistant" && (
                            <div className="flex items-center justify-between gap-2 text-[10px] font-mono text-slate-400">
                              <div className="flex items-center gap-1.5">
                                {msg.modelUsed && (
                                  <span
                                    data-testid={`msg-model-badge-${msg.id}`}
                                    className="px-1.5 py-0.5 rounded bg-slate-200/70 dark:bg-slate-700/70 text-slate-700 dark:text-slate-200"
                                  >
                                    {msg.modelUsed}
                                  </span>
                                )}
                              </div>
                              <button
                                type="button"
                                data-testid={`msg-speak-btn-${msg.id}`}
                                onClick={() => void speakText(msg.text, msg.id, true)}
                                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-sans text-[10px] font-bold transition ${
                                  speakingMsgId === msg.id
                                    ? "bg-rose-500/15 text-rose-600 dark:text-rose-300"
                                    : "bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300"
                                }`}
                                title={
                                  speakingMsgId === msg.id
                                    ? isAr ? "إيقاف القراءة الصوتية" : "Stop Audio"
                                    : isAr ? "استماع بصوت Gemini الطبيعي" : "Listen with Gemini Voice"
                                }
                              >
                                {speakingMsgId === msg.id ? (
                                  <VolumeX className="w-3 h-3" />
                                ) : (
                                  <Volume2 className="w-3 h-3" />
                                )}
                                <span>
                                  {audioLoadingMsgId === msg.id
                                    ? isAr ? "جاري التوليد..." : "Loading..."
                                    : speakingMsgId === msg.id
                                    ? isAr ? "إيقاف" : "Stop"
                                    : isAr ? "استماع" : "Listen"}
                                </span>
                              </button>
                            </div>
                          )}
                          {msg.imagePreviewUrl && (
                            <div className="mb-1.5">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={msg.imagePreviewUrl}
                                alt={msg.imageFileName || "Attached receipt or harvest sheet"}
                                className="max-h-40 max-w-full rounded-xl border border-white/25 object-cover shadow-sm"
                              />
                              {msg.imageFileName && (
                                <div className="text-[10px] opacity-80 mt-0.5 font-mono truncate">
                                  📷 {msg.imageFileName}
                                </div>
                              )}
                            </div>
                          )}
                          <div className="whitespace-pre-line leading-relaxed">{msg.text}</div>
                        </div>
                      )}

                      {/* Vision Extraction Confidence & Arithmetic Discrepancy Badges */}
                      {msg.visionExtraction && (
                        <div
                          data-testid={`vision-badges-${msg.id}`}
                          className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px]"
                        >
                          <span className="px-2 py-0.5 rounded-lg bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 font-bold border border-indigo-500/25">
                            {isAr
                              ? `ثقة القراءة: ${Math.round(msg.visionExtraction.confidence * 100)}%`
                              : `Confidence: ${Math.round(msg.visionExtraction.confidence * 100)}%`}
                          </span>
                          {msg.visionExtraction.escalatedToReasoningModel && (
                            <span className="px-2 py-0.5 rounded-lg bg-purple-500/15 text-purple-700 dark:text-purple-300 font-bold border border-purple-500/25">
                              {isAr ? "تحقق متعمق (Argon)" : "Deep Verify (Argon)"}
                            </span>
                          )}
                          {msg.visionExtraction.arithmeticMismatch && (
                            <span className="px-2 py-1 rounded-lg bg-rose-500/15 text-rose-700 dark:text-rose-300 font-bold border border-rose-500/30 w-full">
                              {isAr
                                ? msg.visionExtraction.discrepancyNoteAr ||
                                  "⚠️ عدم تطابق حسابي بين مجموع البنود والإجمالي"
                                : msg.visionExtraction.discrepancyNoteEn ||
                                  "⚠️ Arithmetic mismatch between items sum and total"}
                            </span>
                          )}
                        </div>
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

                      {/* Learned & Saved Pill with 1-Click Undo */}
                      {msg.learnedEvents && msg.learnedEvents.length > 0 && (
                        <div
                          data-testid={`learned-memory-pill-${msg.id}`}
                          className="mt-1.5 space-y-1"
                        >
                          {msg.learnedEvents.map((ev) => (
                            <div
                              key={`${ev.action}-${ev.entry.id}`}
                              className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-[10px]"
                            >
                              <div className="flex items-center gap-1.5 min-w-0">
                                <Brain className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                                <div className="truncate">
                                  <span className="font-black text-emerald-700 dark:text-emerald-300 me-1">
                                    {ev.action === "forgotten"
                                      ? isAr
                                        ? "تم النسيان:"
                                        : "Forgotten:"
                                      : isAr
                                      ? "تم التعلم والحفظ:"
                                      : "Learned & Saved:"}
                                  </span>
                                  <span className="text-slate-700 dark:text-slate-200">
                                    {ev.entry.content}
                                  </span>
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => void handleUndoLearnedEvent(msg.id, ev)}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-rose-600 dark:text-rose-400 font-bold shrink-0 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                                title={isAr ? "تراجع عن هذا الحفظ" : "Undo learned rule"}
                              >
                                <RotateCcw className="w-3 h-3" />
                                <span>{isAr ? "تراجع" : "Undo"}</span>
                              </button>
                            </div>
                          ))}
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

                          {/* Archived Vision Document Link & Thumbnail */}
                          {msg.confirmationCard.sourceAttachment && (
                            <div
                              data-testid="card-source-attachment-preview"
                              className="flex items-center justify-between gap-2 p-2 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 text-[10px]"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={msg.confirmationCard.sourceAttachment.attachmentUrl}
                                  alt={msg.confirmationCard.sourceAttachment.fileName}
                                  className="w-9 h-9 rounded-lg object-cover border border-slate-200 dark:border-slate-700 shrink-0"
                                />
                                <div className="min-w-0">
                                  <div className="font-bold text-slate-800 dark:text-slate-100 truncate">
                                    {msg.confirmationCard.sourceAttachment.fileName}
                                  </div>
                                  <div className="text-slate-500 font-mono truncate">
                                    {msg.confirmationCard.sourceAttachment.attachmentId}
                                  </div>
                                </div>
                              </div>
                              <a
                                href={msg.confirmationCard.sourceAttachment.attachmentUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-600/15 hover:bg-emerald-600/25 text-emerald-700 dark:text-emerald-300 font-bold shrink-0"
                              >
                                <ExternalLink className="w-3 h-3" />
                                <span>{isAr ? "عرض المستند" : "View Image"}</span>
                              </a>
                            </div>
                          )}

                          {/* Cross-Section Pre-Flight Checks & Warnings */}
                          {msg.confirmationCard.preFlightChecks &&
                            msg.confirmationCard.preFlightChecks.length > 0 && (
                              <div className="flex flex-wrap gap-1">
                                {msg.confirmationCard.preFlightChecks.map((chk) => (
                                  <span
                                    key={chk.key}
                                    className={`px-2 py-0.5 rounded-lg text-[10px] font-bold border ${
                                      chk.status === "blocked"
                                        ? "bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-300"
                                        : chk.status === "warning"
                                        ? "bg-amber-500/10 border-amber-500/30 text-amber-800 dark:text-amber-300"
                                        : "bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300"
                                    }`}
                                  >
                                    {isAr ? chk.labelAr : chk.labelEn}
                                  </span>
                                ))}
                              </div>
                            )}

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
                              {msg.confirmationCard.lines.length > 0 && (
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
                              )}
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
                            <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 text-[11px] font-bold space-y-1">
                              <div className="flex items-center gap-1.5">
                                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
                                <span>{msg.confirmedResult.summary}</span>
                              </div>
                              {msg.confirmedResult.sourceAttachment && (
                                <div className="flex items-center justify-between gap-2 pt-1 border-t border-emerald-200/60 dark:border-emerald-800/60 text-[10px]">
                                  <span>
                                    {isAr
                                      ? `📎 تم أرشفة وربط الصورة بالسجل (${msg.confirmedResult.entryNumber})`
                                      : `📎 Source image archived & linked to record (${msg.confirmedResult.entryNumber})`}
                                  </span>
                                  <a
                                    href={msg.confirmedResult.sourceAttachment.attachmentUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 underline font-mono"
                                  >
                                    {msg.confirmedResult.sourceAttachment.attachmentId}
                                    <ExternalLink className="w-3 h-3" />
                                  </a>
                                </div>
                              )}
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

              {/* Editable Document & Image Extraction Draft Card */}
              {pendingDocDraft && (
                <div className="mx-3 mb-2 p-3 rounded-2xl border-2 border-indigo-400/70 bg-indigo-50/70 dark:bg-indigo-950/30 space-y-2.5 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-black text-indigo-800 dark:text-indigo-200 flex items-center gap-1.5">
                      <FileText className="w-4 h-4" />
                      <span>
                        {isAr ? "معاينة وتعديل المستند المستخرج" : "Extracted Document Draft"} (
                        {Math.round(pendingDocDraft.confidence * 100)}%)
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setPendingDocDraft(null)}
                      className="p-1 rounded-lg text-slate-400 hover:text-rose-600"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {pendingDocDraft.warnings.length > 0 && (
                    <div className="space-y-1">
                      {pendingDocDraft.warnings.map((w, idx) => (
                        <div
                          key={idx}
                          className={`px-2.5 py-1.5 rounded-xl text-[11px] font-bold flex items-center gap-1.5 ${
                            w.severity === "error"
                              ? "bg-rose-500/15 text-rose-700 dark:text-rose-300"
                              : "bg-amber-500/15 text-amber-800 dark:text-amber-300"
                          }`}
                        >
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                          <span>{isAr ? w.messageAr : w.messageEn}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    <input
                      type="text"
                      value={pendingDocDraft.partyName}
                      onChange={(e) =>
                        updatePendingDraft((d) => ({ ...d, partyName: e.target.value }))
                      }
                      placeholder={isAr ? "اسم المورد / العميل" : "Vendor / Customer"}
                      className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 font-bold"
                    />
                    <input
                      type="date"
                      value={pendingDocDraft.date}
                      onChange={(e) => updatePendingDraft((d) => ({ ...d, date: e.target.value }))}
                      className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 font-mono"
                    />
                    <input
                      type="text"
                      value={pendingDocDraft.reference}
                      onChange={(e) =>
                        updatePendingDraft((d) => ({ ...d, reference: e.target.value }))
                      }
                      placeholder={isAr ? "رقم المرجع / الفاتورة" : "Reference #"}
                      className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 font-mono"
                    />
                    <select
                      value={pendingDocDraft.currency}
                      onChange={(e) =>
                        updatePendingDraft((d) => ({ ...d, currency: e.target.value }))
                      }
                      className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 font-bold"
                    >
                      <option value="YER">YER</option>
                      <option value="SAR">SAR</option>
                      <option value="USD">USD</option>
                    </select>
                  </div>

                  {/* Editable GL Lines */}
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {pendingDocDraft.lines.map((ln, idx) => (
                      <div key={idx} className="grid grid-cols-12 gap-1 text-[10px]">
                        <input
                          type="text"
                          value={ln.accountCode}
                          onChange={(e) =>
                            updatePendingDraft((d) => ({
                              ...d,
                              lines: d.lines.map((x, j) =>
                                j === idx ? { ...x, accountCode: e.target.value } : x
                              ),
                            }))
                          }
                          className="col-span-3 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-1.5 py-1 font-mono font-bold"
                        />
                        <input
                          type="number"
                          value={ln.debit}
                          onChange={(e) =>
                            updatePendingDraft((d) => ({
                              ...d,
                              lines: d.lines.map((x, j) =>
                                j === idx ? { ...x, debit: Number(e.target.value) || 0 } : x
                              ),
                            }))
                          }
                          placeholder="Dr"
                          className="col-span-4 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-1.5 py-1 font-mono"
                        />
                        <input
                          type="number"
                          value={ln.credit}
                          onChange={(e) =>
                            updatePendingDraft((d) => ({
                              ...d,
                              lines: d.lines.map((x, j) =>
                                j === idx ? { ...x, credit: Number(e.target.value) || 0 } : x
                              ),
                            }))
                          }
                          placeholder="Cr"
                          className="col-span-4 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-1.5 py-1 font-mono"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            updatePendingDraft((d) => ({
                              ...d,
                              lines: d.lines.filter((_, j) => j !== idx),
                            }))
                          }
                          className="col-span-1 text-rose-500 font-bold"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      data-testid="ai-doc-confirm-post-btn"
                      disabled={
                        docPostBusy ||
                        pendingDocDraft.warnings.some((w) => w.severity === "error")
                      }
                      onClick={() => void handleConfirmPostExtractedDraft()}
                      className="flex-1 py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs disabled:opacity-50 flex items-center justify-center gap-1.5"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>
                        {docPostBusy
                          ? isAr
                            ? "جاري الترحيل..."
                            : "Posting..."
                          : isAr
                          ? "تأكيد الترحيل"
                          : "Confirm Post"}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingDocDraft(null)}
                      className="py-2 px-3 rounded-xl border border-slate-300 dark:border-slate-700 font-bold text-xs"
                    >
                      {isAr ? "إلغاء" : "Cancel"}
                    </button>
                  </div>
                </div>
              )}

              {/* Voice + Text + Document Input Bar */}
              <div className="p-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 space-y-2">
                {micSettingsPrompt && (
                  <div className="p-2 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-300 dark:border-rose-800 flex items-center justify-between gap-2 text-[11px]">
                    <span className="font-bold text-rose-700 dark:text-rose-300">
                      {isAr
                        ? "صلاحية الميكروفون مرفوضة أو مقيدة."
                        : "Microphone permission is denied or restricted."}
                    </span>
                    <button
                      type="button"
                      onClick={() => openNativeAppSettings()}
                      className="px-2.5 py-1 rounded-lg bg-rose-600 text-white font-bold inline-flex items-center gap-1 shrink-0"
                    >
                      <Settings className="w-3 h-3" />
                      <span>{isAr ? "فتح إعدادات التطبيق" : "Open App Settings"}</span>
                    </button>
                  </div>
                )}

                {micDiagnostics?.unusedAppRestrictionsEnabled && (
                  <div className="p-2 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800 flex items-center justify-between gap-2 text-[11px]">
                    <span className="font-bold text-amber-800 dark:text-amber-300">
                      {isAr
                        ? "تنبيه أندرويد: ميزة «إدارة التطبيق إذا لم يُستخدم» مفعلة وقد تلغي صلاحية الميكروفون."
                        : "Android warning: 'Manage app if unused' is active and may revoke mic/notification permissions."}
                    </span>
                    <button
                      type="button"
                      onClick={() => openUnusedAppRestrictionsSettings()}
                      className="px-2 py-1 rounded-lg bg-amber-600 text-white font-bold shrink-0"
                    >
                      {isAr ? "تعديل" : "Fix"}
                    </button>
                  </div>
                )}

                <div className="flex items-center justify-between text-[10px] text-slate-500">
                  <div className="flex items-center gap-1.5">
                    <span>{isAr ? "لغة الميكروفون:" : "Voice Mic Locale:"}</span>
                    <select
                      value={voiceLang}
                      onChange={(e) =>
                        setVoiceLang(e.target.value as "ar-SA" | "ar-YE" | "en-US" | "en-GB")
                      }
                      className="rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-1.5 py-0.5 font-mono text-[10px]"
                    >
                      <option value="ar-YE">العربية (اليمن ar-YE)</option>
                      <option value="ar-SA">العربية (السعودية ar-SA)</option>
                      <option value="en-US">English (en-US)</option>
                      <option value="en-GB">English (en-GB)</option>
                    </select>
                  </div>
                  <span>
                    {listening
                      ? interimTranscript
                        ? `🎙️ ${interimTranscript.slice(0, 32)}...`
                        : isAr
                        ? "🎙️ جاري الاستماع... تحدث الآن"
                        : "🎙️ Listening... speak now"
                      : isAr
                      ? "بوابة تأكيد القيود مفعلة 🛡️"
                      : "Mandatory Write Gate Active 🛡️"}
                  </span>
                </div>

                <input
                  ref={docFileInputRef}
                  type="file"
                  accept=".pdf,.txt,.csv,image/*"
                  className="hidden"
                  onChange={(e) => void handleDocumentFileSelected(e.target.files?.[0])}
                />
                <input
                  ref={visionCameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => void handleVisionImageSelected(e.target.files?.[0])}
                />
                <input
                  ref={visionImageInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) => void handleVisionImageSelected(e.target.files?.[0])}
                />

                {pendingVisionImage && (
                  <div
                    data-testid="copilot-vision-preview"
                    className="mb-2 p-2 rounded-xl bg-white dark:bg-slate-900 border border-emerald-500/40 flex items-center justify-between gap-2"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={pendingVisionImage.previewDataUrl}
                        alt={pendingVisionImage.fileName}
                        className="w-11 h-11 rounded-lg object-cover border border-slate-200 dark:border-slate-700 shrink-0"
                      />
                      <div className="min-w-0 text-[10px]">
                        <div className="font-bold text-slate-800 dark:text-slate-100 truncate">
                          {pendingVisionImage.fileName}
                        </div>
                        <div className="text-emerald-700 dark:text-emerald-300 font-mono">
                          {Math.max(1, Math.round(pendingVisionImage.compressedBytes / 1024))} KB •{" "}
                          {isAr ? "جاهز للتحليل البصري" : "Ready for Vision OCR"}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      data-testid="copilot-vision-remove-btn"
                      onClick={() => setPendingVisionImage(null)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition"
                      title={isAr ? "إزالة الصورة" : "Remove image"}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleSendPrompt();
                  }}
                  className="flex items-center gap-1.5"
                >
                  <button
                    type="button"
                    data-testid="copilot-vision-camera-btn"
                    disabled={visionCompressBusy || busy}
                    onClick={() => visionCameraInputRef.current?.click()}
                    className="px-2 py-2.5 rounded-xl border bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-emerald-700 dark:text-emerald-300 hover:border-emerald-500 transition shrink-0 disabled:opacity-50 inline-flex items-center gap-1 text-[10px] font-bold"
                    title={isAr ? "تصوير بالكاميرا (كشف قطفة / سند / فاتورة)" : "Camera Capture (Receipt / Harvest Sheet)"}
                  >
                    <Camera className={`w-3.5 h-3.5 ${visionCompressBusy ? "animate-pulse" : ""}`} />
                    <span className="hidden sm:inline">{isAr ? "كاميرا" : "Camera"}</span>
                  </button>
                  <button
                    type="button"
                    data-testid="copilot-vision-upload-btn"
                    disabled={visionCompressBusy || busy}
                    onClick={() => visionImageInputRef.current?.click()}
                    className="px-2 py-2.5 rounded-xl border bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-sky-700 dark:text-sky-300 hover:border-sky-500 transition shrink-0 disabled:opacity-50 inline-flex items-center gap-1 text-[10px] font-bold"
                    title={isAr ? "رفع صورة مستند أو كشف يدوي" : "Upload Receipt or Sheet Image"}
                  >
                    <ImageIcon className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">{isAr ? "صورة" : "Image"}</span>
                  </button>
                  <button
                    type="button"
                    data-testid="copilot-doc-upload-btn"
                    disabled={docExtractBusy}
                    onClick={() => docFileInputRef.current?.click()}
                    className="p-2.5 rounded-xl border bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-indigo-500 transition shrink-0 disabled:opacity-50"
                    title={isAr ? "استخراج PDF أو CSV أو ملف مستند" : "Extract PDF / CSV Document"}
                  >
                    {docExtractBusy ? <Sparkles className="w-4 h-4 animate-pulse text-indigo-600" /> : <Paperclip className="w-4 h-4" />}
                  </button>
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
                    disabled={busy || (!inputPrompt.trim() && !pendingVisionImage)}
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

          {/* =============================================================== */}
          {/* PANE 4: TENANT-SCOPED COPILOT MEMORY & RULES MANAGER            */}
          {/* =============================================================== */}
          {activePane === "memory" && (
            <div className="p-3.5 space-y-3 overflow-y-auto max-h-[62vh] text-xs">
              <div className="p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-between gap-2">
                <div>
                  <div className="font-black text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5">
                    <Brain className="w-4 h-4" />
                    <span>{isAr ? "ذاكرة المساعد الذكي الخاصة بالمنشأة" : "Tenant-Scoped Copilot Memory"}</span>
                  </div>
                  <div className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">
                    {isAr
                      ? `يتعلم المساعد تلقائياً من تصحيحاتك وتفضيلاتك ويعزلها بالكامل للمنشأة (${activeTenantSlug}).`
                      : `Automatically learns corrections, aliases & preferences strictly isolated to tenant (${activeTenantSlug}).`}
                  </div>
                </div>
              </div>

              {/* Manual Add Rule Form */}
              <div className="p-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-2">
                <div className="font-black text-[11px] text-slate-700 dark:text-slate-200">
                  {isAr ? "إضافة قاعدة أو معلومة جديدة يدوياً" : "Manually Add Memory Rule"}
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <select
                    value={newMemoryCategory}
                    onChange={(e) => setNewMemoryCategory(e.target.value as CopilotMemoryCategory)}
                    className="rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2.5 py-1.5 text-[11px]"
                  >
                    <option value="domain_fact">{isAr ? "حقيقة/مصطلح منشأة" : "Domain Fact"}</option>
                    <option value="naming_alias">{isAr ? "مسمى محلي / وحدة" : "Local Alias / Unit"}</option>
                    <option value="correction">{isAr ? "تصحيح محاسبي" : "Correction"}</option>
                    <option value="operational_pattern">{isAr ? "نمط تشغيلي" : "Operational Pattern"}</option>
                    <option value="workflow_preference">{isAr ? "تفضيل شخصي" : "User Preference"}</option>
                  </select>
                  <input
                    type="text"
                    data-testid="copilot-memory-add-input"
                    value={newMemoryContent}
                    onChange={(e) => setNewMemoryContent(e.target.value)}
                    placeholder={
                      isAr
                        ? "مثال: العلاقية درجة أولى تساوي 10 ربطات وتُسجل على فرع صنعاء..."
                        : "e.g. Delivery fees for Sanaa always post to Freight Expense..."
                    }
                    className="flex-1 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-1.5 text-[11px]"
                  />
                  <button
                    type="button"
                    data-testid="copilot-memory-add-btn"
                    disabled={memoryBusy || newMemoryContent.trim().length < 6}
                    onClick={() => void handleAddManualMemory()}
                    className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold text-[11px] inline-flex items-center justify-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>{isAr ? "حفظ" : "Save"}</span>
                  </button>
                </div>
              </div>

              {/* Search Memories */}
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute top-2.5 start-3" />
                <input
                  type="text"
                  value={memorySearch}
                  onChange={(e) => setMemorySearch(e.target.value)}
                  placeholder={isAr ? "بحث في القواعد والمعلومات المحفوظة..." : "Search learned rules & facts..."}
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 ps-8 pe-3 py-1.5 text-[11px]"
                />
              </div>

              {/* Memory List */}
              {memories.length === 0 ? (
                <div className="p-4 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 text-center text-slate-500 text-[11px]">
                  {isAr
                    ? "لا توجد قواعد محفوظة لهذه المنشأة بعد. أخبر المساعد مثل: «تذكر أن مصاريف التوصيل لصنعاء تسجل على مصروفات النقل»."
                    : "No saved memories yet. Tell the Copilot rules like 'Remember that delivery fees post under Freight Expense'."}
                </div>
              ) : (
                <div className="space-y-2">
                  {memories
                    .filter((m) => {
                      const q = memorySearch.trim().toLowerCase();
                      if (!q) return true;
                      return (
                        m.content.toLowerCase().includes(q) ||
                        m.topicKey.toLowerCase().includes(q) ||
                        m.category.toLowerCase().includes(q)
                      );
                    })
                    .map((mem) => (
                      <div
                        key={mem.id}
                        className={`p-3 rounded-2xl border space-y-1.5 ${
                          mem.active
                            ? "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
                            : "border-slate-200/60 dark:border-slate-800/50 bg-slate-100/60 dark:bg-slate-900/40 opacity-65"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                              {mem.category}
                            </span>
                            <span className="px-1.5 py-0.5 rounded-full text-[9px] font-mono bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                              {mem.scope}
                            </span>
                            {mem.pinned && (
                              <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-amber-500/15 text-amber-700 dark:text-amber-300">
                                {isAr ? "مثبت" : "Pinned"}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              disabled={memoryBusy}
                              onClick={() => void handleMutateMemory(mem, "pin")}
                              className={`p-1 rounded-lg transition ${
                                mem.pinned
                                  ? "text-amber-600 bg-amber-500/10"
                                  : "text-slate-400 hover:text-amber-600"
                              }`}
                              title={isAr ? "تثبيت / إلغاء التثبيت" : "Pin / Unpin"}
                            >
                              <Pin className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              disabled={memoryBusy}
                              onClick={() => void handleMutateMemory(mem, "toggle")}
                              className="p-1 rounded-lg text-slate-500 hover:text-emerald-600 transition"
                              title={isAr ? "تفعيل / تعطيل" : "Enable / Disable"}
                            >
                              {mem.active ? (
                                <ToggleRight className="w-4 h-4 text-emerald-600" />
                              ) : (
                                <ToggleLeft className="w-4 h-4 text-slate-400" />
                              )}
                            </button>
                            <button
                              type="button"
                              disabled={memoryBusy}
                              onClick={() => void handleMutateMemory(mem, "delete")}
                              className="p-1 rounded-lg text-slate-400 hover:text-rose-600 transition"
                              title={isAr ? "حذف نهائي" : "Delete"}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                        <div className="font-semibold text-slate-800 dark:text-slate-100 leading-relaxed">
                          {mem.content}
                        </div>
                        <div className="text-[10px] text-slate-400 flex items-center justify-between gap-2 font-mono">
                          <span className="truncate">{mem.topicKey}</span>
                          <span>
                            {isAr ? `استخدام: ${mem.usageCount}` : `Used: ${mem.usageCount}`}
                          </span>
                        </div>
                      </div>
                    ))}
                </div>
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
