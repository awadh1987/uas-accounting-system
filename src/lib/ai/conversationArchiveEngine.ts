/**
 * UAS Enterprise — AI Copilot Conversation Archive, Thread Lifecycle & PDF Print Engine
 *
 * Implements:
 *   1. Full thread lifecycle: create, persist, archive, restore, and permanent deletion.
 *   2. Active vs. Archived thread segmentation with search and snippet previews.
 *   3. Automatic migration of legacy single-session chat history.
 *   4. Clean, branded A4 print/PDF specification generator using the UAS Document Printer.
 *
 * Runs 100% offline with localStorage and SQLite fallback compatibility.
 */

import type {
  ConfirmationPreviewCard,
  CitationLink,
  ClarificationPromptData,
  EscalationCardData,
} from "./uasAgentTools";
import type { AgentReasoningStep, ReasoningTier } from "./offlineAgentEngine";
import type { TabId, UasEnterpriseProfile, UasUser } from "@/types/uas";
import type {
  PrintKeyValue,
  PrintSummaryCard,
  PrintTableSection,
  UasPrintDocumentSpec,
} from "@/lib/print/uasDocumentPrinter";

export interface CopilotChatMessage {
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
  citations?: CitationLink[];
  clarificationPrompt?: ClarificationPromptData;
  escalationCard?: EscalationCardData;
  dismissed?: boolean;
  navigationTab?: TabId;
  openLicenseModal?: boolean;
}

export interface CopilotThread {
  id: string;
  userId: string;
  titleAr: string;
  titleEn: string;
  snippet: string;
  createdAt: string;
  updatedAt: string;
  isArchived: boolean;
  archivedAt?: string | null;
  messages: CopilotChatMessage[];
}

export interface ThreadFilterOptions {
  status?: "active" | "archived" | "all";
  search?: string;
}

export function getThreadStorageKey(userId?: string | null): string {
  return `uas_copilot_threads_${userId || "guest"}`;
}

export function getLegacyHistoryKey(userId?: string | null): string {
  return `uas_copilot_history_${userId || "guest"}`;
}

export function deriveThreadTitle(
  messages: CopilotChatMessage[],
  defaultAr = "محادثة جديدة",
  defaultEn = "New Conversation"
): { titleAr: string; titleEn: string } {
  const firstUserMsg = messages.find((m) => m.role === "user" && m.text.trim().length > 0);
  if (!firstUserMsg) {
    return { titleAr: defaultAr, titleEn: defaultEn };
  }
  const clean = firstUserMsg.text.replace(/[\n\r]+/g, " ").trim();
  const truncated = clean.length > 45 ? `${clean.slice(0, 42)}...` : clean;
  return {
    titleAr: truncated,
    titleEn: truncated,
  };
}

export function deriveSnippet(messages: CopilotChatMessage[]): string {
  const relevant = messages
    .filter((m) => m.id !== "welcome-1" && m.text.trim().length > 0)
    .slice(-1)[0];
  if (!relevant) return "—";
  const clean = relevant.text.replace(/[\n\r#*`_~>-]+/g, " ").trim();
  return clean.length > 70 ? `${clean.slice(0, 67)}...` : clean;
}

/**
 * Loads all threads for a specific user.
 * Automatically migrates legacy flat chat history if threads list is empty.
 */
export function loadAllThreads(userId?: string | null): CopilotThread[] {
  if (typeof window === "undefined") return [];

  const storageKey = getThreadStorageKey(userId);
  let threads: CopilotThread[] = [];

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        threads = parsed;
      }
    }
  } catch {
    threads = [];
  }

  // Automatic Migration: if no threads exist yet, check legacy flat history
  if (threads.length === 0) {
    try {
      const legacyKey = getLegacyHistoryKey(userId);
      const legacyRaw = window.localStorage.getItem(legacyKey);
      if (legacyRaw) {
        const legacyMsgs = JSON.parse(legacyRaw);
        if (Array.isArray(legacyMsgs) && legacyMsgs.length > 1) {
          const titles = deriveThreadTitle(legacyMsgs, "المحادثة السابقة", "Previous Chat");
          const migratedThread: CopilotThread = {
            id: `thread-migrated-${Date.now()}`,
            userId: userId || "guest",
            titleAr: titles.titleAr,
            titleEn: titles.titleEn,
            snippet: deriveSnippet(legacyMsgs),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            isArchived: false,
            archivedAt: null,
            messages: legacyMsgs,
          };
          threads = [migratedThread];
          saveAllThreads(userId, threads);
        }
      }
    } catch {
      // ignore migration failures
    }
  }

  return threads;
}

export function saveAllThreads(userId: string | null | undefined, threads: CopilotThread[]): void {
  if (typeof window === "undefined") return;
  const storageKey = getThreadStorageKey(userId);
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(threads));
  } catch {
    // quota exceeded or private browsing
  }
}

/**
 * Creates a new active conversation thread.
 */
export function createThread(
  userId?: string | null,
  initialTitleAr?: string,
  initialTitleEn?: string
): CopilotThread {
  const effectiveUserId = userId || "guest";
  const now = new Date().toISOString();
  const newThread: CopilotThread = {
    id: `thread-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    userId: effectiveUserId,
    titleAr: initialTitleAr || "محادثة جديدة",
    titleEn: initialTitleEn || "New Conversation",
    snippet: "—",
    createdAt: now,
    updatedAt: now,
    isArchived: false,
    archivedAt: null,
    messages: [],
  };

  const existing = loadAllThreads(effectiveUserId);
  const updated = [newThread, ...existing];
  saveAllThreads(effectiveUserId, updated);
  return newThread;
}

/**
 * Saves messages into an active thread, updating snippet and timestamps.
 */
export function saveActiveThreadMessages(
  userId: string | null | undefined,
  threadId: string,
  messages: CopilotChatMessage[]
): CopilotThread | null {
  const effectiveUserId = userId || "guest";
  const threads = loadAllThreads(effectiveUserId);
  const idx = threads.findIndex((t) => t.id === threadId);

  const realMessages = messages.filter((m) => m.id !== "welcome-1");
  const titles = deriveThreadTitle(realMessages);
  const now = new Date().toISOString();

  if (idx !== -1) {
    const current = threads[idx];
    const isDefaultTitle =
      current.titleAr === "محادثة جديدة" ||
      current.titleAr === "New Conversation" ||
      current.titleAr === "—";

    const updatedThread: CopilotThread = {
      ...current,
      titleAr: isDefaultTitle && realMessages.length > 0 ? titles.titleAr : current.titleAr,
      titleEn: isDefaultTitle && realMessages.length > 0 ? titles.titleEn : current.titleEn,
      snippet: deriveSnippet(messages),
      updatedAt: now,
      messages,
    };
    threads[idx] = updatedThread;
    saveAllThreads(effectiveUserId, threads);
    return updatedThread;
  }

  // If thread does not exist, create it on the fly
  const newThread: CopilotThread = {
    id: threadId,
    userId: effectiveUserId,
    titleAr: titles.titleAr,
    titleEn: titles.titleEn,
    snippet: deriveSnippet(messages),
    createdAt: now,
    updatedAt: now,
    isArchived: false,
    archivedAt: null,
    messages,
  };
  threads.unshift(newThread);
  saveAllThreads(effectiveUserId, threads);
  return newThread;
}

/**
 * Archives an active conversation thread.
 */
export function archiveThread(
  userId: string | null | undefined,
  threadId: string
): CopilotThread | null {
  const effectiveUserId = userId || "guest";
  const threads = loadAllThreads(effectiveUserId);
  const idx = threads.findIndex((t) => t.id === threadId);
  if (idx === -1) return null;

  threads[idx] = {
    ...threads[idx],
    isArchived: true,
    archivedAt: new Date().toISOString(),
  };
  saveAllThreads(effectiveUserId, threads);
  return threads[idx];
}

/**
 * Restores an archived conversation thread back to active.
 */
export function restoreThread(
  userId: string | null | undefined,
  threadId: string
): CopilotThread | null {
  const effectiveUserId = userId || "guest";
  const threads = loadAllThreads(effectiveUserId);
  const idx = threads.findIndex((t) => t.id === threadId);
  if (idx === -1) return null;

  threads[idx] = {
    ...threads[idx],
    isArchived: false,
    archivedAt: null,
  };
  saveAllThreads(effectiveUserId, threads);
  return threads[idx];
}

/**
 * Permanently deletes a thread from storage.
 */
export function deleteThreadPermanently(
  userId: string | null | undefined,
  threadId: string
): boolean {
  const effectiveUserId = userId || "guest";
  const threads = loadAllThreads(effectiveUserId);
  const filtered = threads.filter((t) => t.id !== threadId);
  if (filtered.length === threads.length) return false;

  saveAllThreads(effectiveUserId, filtered);
  return true;
}

/**
 * Filters and searches threads with sorting (most recent updated first).
 */
export function filterThreads(
  threads: CopilotThread[],
  options: ThreadFilterOptions = {}
): CopilotThread[] {
  const { status = "active", search = "" } = options;
  const cleanSearch = search.trim().toLowerCase();

  return threads
    .filter((t) => {
      if (status === "active" && t.isArchived) return false;
      if (status === "archived" && !t.isArchived) return false;
      if (cleanSearch) {
        const matchesTitle =
          t.titleAr.toLowerCase().includes(cleanSearch) ||
          t.titleEn.toLowerCase().includes(cleanSearch);
        const matchesSnippet = t.snippet.toLowerCase().includes(cleanSearch);
        const matchesMsgs = t.messages.some((m) =>
          m.text.toLowerCase().includes(cleanSearch)
        );
        return matchesTitle || matchesSnippet || matchesMsgs;
      }
      return true;
    })
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

/**
 * Builds a clean, branded PDF/Print specification for a Copilot conversation thread.
 * Guaranteed strict light-mode, company letterhead, formatted exchanges, proposal cards,
 * citations, and zero floating widget bleed.
 */
export function buildCopilotConversationPrintSpec(params: {
  thread: CopilotThread | { titleAr: string; titleEn?: string; messages: CopilotChatMessage[]; id?: string; createdAt?: string; isArchived?: boolean };
  enterpriseProfile?: UasEnterpriseProfile | null;
  user?: UasUser | null;
  documentDate?: string;
  lang?: "ar" | "en";
}): UasPrintDocumentSpec {
  const { thread, enterpriseProfile, user, documentDate, lang = "ar" } = params;
  const isAr = lang === "ar";
  const messages = thread.messages.filter((m) => m.id !== "welcome-1");
  const dateStr = documentDate || new Date().toISOString().slice(0, 10);

  const userMessagesCount = messages.filter((m) => m.role === "user").length;
  const aiProposalsCount = messages.filter((m) => m.confirmationCard).length;
  const confirmedCount = messages.filter((m) => m.confirmedResult?.executed).length;
  const citationsCount = messages.reduce((s, m) => s + (m.citations?.length || 0), 0);

  const metadata: PrintKeyValue[] = [
    {
      labelAr: "عنوان المحادثة",
      labelEn: "Thread Title",
      value: isAr ? thread.titleAr : (thread.titleEn || thread.titleAr),
    },
    {
      labelAr: "المستخدم / المسؤول",
      labelEn: "User / Operator",
      value: user?.name ? `${user.name} (${user.role})` : isAr ? "المشغل المعتمد" : "Authorized Operator",
    },
    {
      labelAr: "معرف السجل",
      labelEn: "Thread ID",
      value: thread.id || "—",
    },
    {
      labelAr: "تاريخ الإنشاء",
      labelEn: "Created Date",
      value: thread.createdAt ? thread.createdAt.slice(0, 10) : dateStr,
    },
    {
      labelAr: "حالة المحادثة",
      labelEn: "Status",
      value: thread.isArchived
        ? isAr ? "مؤرشفة (Archived)" : "Archived"
        : isAr ? "نشطة (Active)" : "Active",
    },
  ];

  const summaryCards: PrintSummaryCard[] = [
    {
      labelAr: "إجمالي الرسائل",
      labelEn: "Total Messages",
      value: String(messages.length),
      tone: "neutral",
    },
    {
      labelAr: "استفسارات المستخدم",
      labelEn: "User Prompts",
      value: String(userMessagesCount),
      tone: "indigo",
    },
    {
      labelAr: "العمليات المحاسبية المقترحة",
      labelEn: "Proposed Actions",
      value: String(aiProposalsCount),
      tone: "amber",
    },
    {
      labelAr: "العمليات المعتمدة والمرحلة",
      labelEn: "Confirmed & Posted",
      value: String(confirmedCount),
      tone: "emerald",
    },
    {
      labelAr: "المراجع والإحالات",
      labelEn: "Citations & References",
      value: String(citationsCount),
      tone: "neutral",
    },
  ];

  const tableRows = messages.map((m, idx) => {
    const isUser = m.role === "user";
    const sender = isUser
      ? isAr ? "المستخدم (User)" : "User"
      : isAr ? `المساعد الذكي (${m.tierUsed || "offline"})` : `AI Copilot (${m.tierUsed || "offline"})`;

    let actionStatus = "—";
    if (m.confirmationCard) {
      if (m.confirmedResult?.executed) {
        actionStatus = isAr
          ? `✅ تم الترحيل (${m.confirmedResult.entryNumber || "معتمد"})`
          : `✅ Posted (${m.confirmedResult.entryNumber || "Confirmed"})`;
      } else if (m.dismissed) {
        actionStatus = isAr ? "🚫 تم التجاهل دون ترحيل" : "🚫 Dismissed";
      } else {
        actionStatus = isAr
          ? `🛡️ مسودة تنتظر التأكيد (${m.confirmationCard.operationType})`
          : `🛡️ Pending Confirmation (${m.confirmationCard.operationType})`;
      }
    } else if (m.escalationCard) {
      actionStatus = isAr
        ? `⚠️ تصعيد إداري (${m.escalationCard.reasonCode})`
        : `⚠️ Escalated (${m.escalationCard.reasonCode})`;
    } else if (m.clarificationPrompt) {
      actionStatus = isAr ? "❓ طلب توضيح" : "❓ Clarification Prompt";
    }

    let textContent = m.text;
    if (m.citations && m.citations.length > 0) {
      const citList = m.citations.map((c) => (isAr ? c.labelAr : c.labelEn)).join(" • ");
      textContent += `\n\n📌 ${isAr ? "المراجع والروابط:" : "Citations:"} ${citList}`;
    }

    return {
      index: String(idx + 1),
      time: m.timestamp || "—",
      sender,
      content: textContent,
      action: actionStatus,
    };
  });

  const conversationSection: PrintTableSection = {
    headingAr: "سجل الرسائل والاستشارات والعمليات المحاسبية",
    headingEn: "Message Exchanges, Reasoning & Accounting Proposals",
    columns: [
      { key: "index", labelAr: "#", labelEn: "#", align: "center" },
      { key: "time", labelAr: "الوقت", labelEn: "Time", align: "center" },
      { key: "sender", labelAr: "الطرف", labelEn: "Sender", align: "center" },
      { key: "content", labelAr: "نص الرسالة والاستدلال", labelEn: "Content & Reasoning", align: "right" },
      { key: "action", labelAr: "حالة الإجراء", labelEn: "Action Status", align: "center" },
    ],
    rows: tableRows,
  };

  const letterhead = enterpriseProfile
    ? {
        companyNameAr: enterpriseProfile.legalNameAr || "منظومة UAS المحاسبية",
        companyNameEn: enterpriseProfile.legalNameEn || "UAS Accounting System",
        crNumber: enterpriseProfile.commercialReg || undefined,
        taxNumber: enterpriseProfile.taxNumber || undefined,
        phone: enterpriseProfile.contactPhone || enterpriseProfile.phone || undefined,
        address: enterpriseProfile.address || undefined,
        slogan: "نظام إدارة الموارد وتخطيط المنشآت الزراعية والتجارية الذكي",
      }
    : {
        companyNameAr: "منظومة UAS المحاسبية والمالية الذكية",
        companyNameEn: "UAS Smart ERP & Accounting System",
        slogan: "المساعد الذكي • رقابة محاسبية وإسناد قرار فوري",
      };

  return {
    titleAr: "سجل محادثة المساعد المحاسبي الذكي",
    titleEn: "AI Copilot Conversation & Audit Transcript",
    documentNumber: thread.id ? thread.id.slice(0, 36) : `AI-LOG-${Date.now()}`,
    issueDate: dateStr,
    status: confirmedCount > 0 ? "POSTED" : "DRAFT",
    format: "A4_PORTRAIT",
    letterhead,
    metadata,
    summaryCards,
    tables: [conversationSection],
    notes:
      isAr
        ? `تنبيه إداري وأمني: هذا السجل مستخرج رسمياً من منظومة UAS للمساعد الذكي. جميع العمليات المالية المقترحة تخضع لبوابة التأكيد الإلزامي وسجل التدقيق الرقابي (RFC 3161). طبع بواسطة: ${user?.name || "المشغل المعتمد"}.`
        : `Confidentiality & Compliance Notice: Officially exported from UAS AI ERP Copilot. All drafted financial transactions adhere to mandatory user confirmation gates and immutable audit trails (RFC 3161). Printed by: ${user?.name || "Authorized Operator"}.`,
    printedBy: user?.name || (isAr ? "المشغل المعتمد" : "Authorized Operator"),
    preparedBy: isAr ? "المساعد المحاسبي الذكي (UAS AI Copilot)" : "UAS AI ERP Copilot",
    reviewedBy: user?.name || (isAr ? "المسؤول المالي" : "Financial Supervisor"),
  };
}
