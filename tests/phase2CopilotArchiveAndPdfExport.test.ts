import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import {
  type CopilotChatMessage,
  type CopilotThread,
  createThread,
  saveActiveThreadMessages,
  archiveThread,
  restoreThread,
  deleteThreadPermanently,
  filterThreads,
  loadAllThreads,
  getThreadStorageKey,
  getLegacyHistoryKey,
  buildCopilotConversationPrintSpec,
} from "../src/lib/ai/conversationArchiveEngine";
import type { UasEnterpriseProfile, UasUser } from "../src/types/uas";

const memoryStore = new Map<string, string>();
const mockLocalStorage = {
  getItem: (key: string) => (memoryStore.has(key) ? (memoryStore.get(key) as string) : null),
  setItem: (key: string, value: string) => {
    memoryStore.set(key, String(value));
  },
  removeItem: (key: string) => {
    memoryStore.delete(key);
  },
  clear: () => {
    memoryStore.clear();
  },
};

(globalThis as unknown as { window?: { localStorage: typeof mockLocalStorage } }).window = {
  localStorage: mockLocalStorage,
};

describe("Mission 5: Phase 2 — Copilot Conversation Archive & PDF Export Engine", () => {
  const testUserId = "user-test-777";

  beforeEach(() => {
    mockLocalStorage.clear();
  });

  describe("1. Thread Creation & Lifecycle Management", () => {
    it("creates a new thread with unique ID, default titles, and empty messages", () => {
      const thread = createThread(testUserId);
      assert.ok(thread.id.startsWith("thread-"));
      assert.equal(thread.userId, testUserId);
      assert.equal(thread.titleAr, "محادثة جديدة");
      assert.equal(thread.titleEn, "New Conversation");
      assert.equal(thread.isArchived, false);
      assert.deepEqual(thread.messages, []);
      assert.equal(thread.snippet, "—");
      assert.ok(thread.createdAt);
      assert.ok(thread.updatedAt);

      const all = loadAllThreads(testUserId);
      assert.equal(all.length, 1);
      assert.equal(all[0].id, thread.id);
    });

    it("creates multiple threads in reverse chronological order (newest first)", () => {
      const th1 = createThread(testUserId, "محادثة 1", "Chat 1");
      const th2 = createThread(testUserId, "محادثة 2", "Chat 2");

      const all = loadAllThreads(testUserId);
      assert.equal(all.length, 2);
      assert.equal(all[0].id, th2.id);
      assert.equal(all[1].id, th1.id);
    });

    it("saves messages to an active thread and auto-derives title from first user message", () => {
      const thread = createThread(testUserId);
      const messages: CopilotChatMessage[] = [
        {
          id: "welcome-1",
          role: "assistant",
          text: "مرحباً بك في UAS AI Copilot",
          timestamp: "09:00",
        },
        {
          id: "msg-user-1",
          role: "user",
          text: "سند قبض من شركة النور بمبلغ 50000 ريال",
          timestamp: "09:01",
        },
        {
          id: "msg-asst-1",
          role: "assistant",
          text: "تم إعداد مسودة سند القبض بنجاح.",
          timestamp: "09:02",
        },
      ];

      const updated = saveActiveThreadMessages(testUserId, thread.id, messages);
      assert.ok(updated);
      assert.equal(updated.messages.length, 3);
      assert.equal(updated.titleAr, "سند قبض من شركة النور بمبلغ 50000 ريال");
      assert.ok(updated.snippet.includes("تم إعداد مسودة سند القبض"));

      // Verify persistence
      const reloaded = loadAllThreads(testUserId);
      assert.equal(reloaded[0].titleAr, "سند قبض من شركة النور بمبلغ 50000 ريال");
      assert.equal(reloaded[0].messages.length, 3);
    });

    it("creates a thread on the fly if threadId does not exist when saving messages", () => {
      const newId = "thread-on-the-fly-123";
      const messages: CopilotChatMessage[] = [
        {
          id: "msg-1",
          role: "user",
          text: "استعلام عن رصيد حساب الصندوق 111101",
          timestamp: "10:00",
        },
      ];

      const saved = saveActiveThreadMessages(testUserId, newId, messages);
      assert.equal(saved?.id, newId);
      assert.equal(saved?.titleAr, "استعلام عن رصيد حساب الصندوق 111101");

      const all = loadAllThreads(testUserId);
      assert.ok(all.some((t) => t.id === newId));
    });
  });

  describe("2. Thread Archiving & Restoration", () => {
    it("archives an active thread and sets archivedAt timestamp", () => {
      const thread = createThread(testUserId, "محادثة الحسابات", "Accounts Chat");
      assert.equal(thread.isArchived, false);

      const archived = archiveThread(testUserId, thread.id);
      assert.ok(archived);
      assert.equal(archived.isArchived, true);
      assert.ok(archived.archivedAt);

      const all = loadAllThreads(testUserId);
      assert.equal(all[0].isArchived, true);
    });

    it("restores an archived thread back to active state", () => {
      const thread = createThread(testUserId, "محادثة مؤرشفة", "Archived Chat");
      archiveThread(testUserId, thread.id);

      const restored = restoreThread(testUserId, thread.id);
      assert.ok(restored);
      assert.equal(restored.isArchived, false);
      assert.equal(restored.archivedAt, null);

      const all = loadAllThreads(testUserId);
      assert.equal(all[0].isArchived, false);
    });

    it("returns null when attempting to archive or restore a non-existent thread", () => {
      assert.equal(archiveThread(testUserId, "invalid-thread-id"), null);
      assert.equal(restoreThread(testUserId, "invalid-thread-id"), null);
    });
  });

  describe("3. Permanent Deletion", () => {
    it("permanently deletes a thread from storage", () => {
      const th1 = createThread(testUserId, "محادثة 1", "Chat 1");
      const th2 = createThread(testUserId, "محادثة 2", "Chat 2");

      assert.equal(loadAllThreads(testUserId).length, 2);

      const deleted = deleteThreadPermanently(testUserId, th1.id);
      assert.equal(deleted, true);

      const remaining = loadAllThreads(testUserId);
      assert.equal(remaining.length, 1);
      assert.equal(remaining[0].id, th2.id);
    });

    it("returns false when attempting to delete a non-existent thread", () => {
      const deleted = deleteThreadPermanently(testUserId, "not-found");
      assert.equal(deleted, false);
    });
  });

  describe("4. Thread Search & Status Filtering", () => {
    it("filters threads by active vs archived status", () => {
      const thActive = createThread(testUserId, "نشطة 1", "Active 1");
      const thArchived = createThread(testUserId, "مؤرشفة 1", "Archived 1");
      archiveThread(testUserId, thArchived.id);

      const all = loadAllThreads(testUserId);

      const activeOnly = filterThreads(all, { status: "active" });
      assert.equal(activeOnly.length, 1);
      assert.equal(activeOnly[0].id, thActive.id);

      const archivedOnly = filterThreads(all, { status: "archived" });
      assert.equal(archivedOnly.length, 1);
      assert.equal(archivedOnly[0].id, thArchived.id);

      const allThreads = filterThreads(all, { status: "all" });
      assert.equal(allThreads.length, 2);
    });

    it("searches threads by title, snippet, or message content", () => {
      const th1 = createThread(testUserId);
      saveActiveThreadMessages(testUserId, th1.id, [
        {
          id: "m1",
          role: "user",
          text: "تقرير ميزانية مشروع مزرعة الجوف",
          timestamp: "12:00",
        },
      ]);

      const th2 = createThread(testUserId);
      saveActiveThreadMessages(testUserId, th2.id, [
        {
          id: "m2",
          role: "user",
          text: "فاتورة مبيعات شركة النور",
          timestamp: "12:05",
        },
      ]);

      const all = loadAllThreads(testUserId);

      const searchJawf = filterThreads(all, { search: "الجوف" });
      assert.equal(searchJawf.length, 1);
      assert.equal(searchJawf[0].id, th1.id);

      const searchNoor = filterThreads(all, { search: "النور" });
      assert.equal(searchNoor.length, 1);
      assert.equal(searchNoor[0].id, th2.id);

      const searchNotFound = filterThreads(all, { search: "كلمة_غير_موجودة" });
      assert.equal(searchNotFound.length, 0);
    });
  });

  describe("5. Legacy Flat Chat History Migration", () => {
    it("automatically migrates legacy flat chat history to a thread on first load", () => {
      const legacyKey = getLegacyHistoryKey(testUserId);
      const legacyMessages: CopilotChatMessage[] = [
        {
          id: "welcome-1",
          role: "assistant",
          text: "مرحباً بك",
          timestamp: "—",
        },
        {
          id: "legacy-msg-1",
          role: "user",
          text: "فحص رصيد حساب البنك الإسلامي 111201",
          timestamp: "11:00",
        },
        {
          id: "legacy-msg-2",
          role: "assistant",
          text: "رصيد الحساب هو 450,000 ريال يمني.",
          timestamp: "11:01",
        },
      ];

      // Simulate existing legacy flat history in localStorage
      mockLocalStorage.setItem(legacyKey, JSON.stringify(legacyMessages));

      // Ensure threads storage is initially empty
      mockLocalStorage.removeItem(getThreadStorageKey(testUserId));

      const threads = loadAllThreads(testUserId);
      assert.equal(threads.length, 1);
      assert.ok(threads[0].id.startsWith("thread-migrated-"));
      assert.equal(threads[0].titleAr, "فحص رصيد حساب البنك الإسلامي 111201");
      assert.equal(threads[0].messages.length, 3);
      assert.equal(threads[0].isArchived, false);
    });
  });

  describe("6. PDF / Print Conversation Spec Builder", () => {
    it("generates an official UAS A4 print document specification with letterhead, cards, and itemized table", () => {
      const thread: CopilotThread = {
        id: "thread-sample-print",
        userId: testUserId,
        titleAr: "استفسارات الحسابات وسندات القبض",
        titleEn: "Accounts & Receipt Inquiries",
        snippet: "تم إعداد مسودة سند القبض",
        createdAt: "2026-11-20T10:00:00Z",
        updatedAt: "2026-11-20T10:15:00Z",
        isArchived: false,
        archivedAt: null,
        messages: [
          {
            id: "msg-1",
            role: "user",
            text: "سند قبض من شركة النور بمبلغ 25000 ريال",
            timestamp: "10:00",
          },
          {
            id: "msg-2",
            role: "assistant",
            text: "تم إعداد مسودة سند القبض ومطابقتها مع الحسابات.",
            timestamp: "10:01",
            confirmationCard: {
              actionId: "act-rv-1",
              toolName: "draft_voucher",
              operationType: "RECEIPT_VOUCHER",
              titleAr: "مسودة سند قبض",
              titleEn: "Draft Receipt Voucher",
              narrationAr: "سند قبض بمبلغ 25,000 ر.ي من شركة النور",
              narrationEn: "Receipt voucher 25,000 YER from Al-Noor Co",
              date: "2026-11-20",
              currency: "YER",
              totalDebit: 25000,
              totalCredit: 25000,
              isBalanced: true,
              lines: [],
              confirmButtonLabelAr: "ترحيل",
              confirmButtonLabelEn: "Post",
              confirmButtonLabel: "ترحيل",
              executionPayload: {
                voucherType: "RECEIPT",
                amount: 25000,
                partyName: "شركة النور",
              },
            },
            confirmedResult: {
              executed: true,
              entryNumber: "RV-2026-0042",
              summary: "تم الترحيل بنجاح",
            },
            citations: [
              {
                labelAr: "سندات القبض والصرف",
                labelEn: "Receipt & Payment Vouchers",
                tab: "treasury",
                type: "tab",
              },
            ],
          },
          {
            id: "msg-3",
            role: "user",
            text: "أقفل الفترة المالية لشهر يناير",
            timestamp: "10:10",
          },
          {
            id: "msg-4",
            role: "assistant",
            text: "لا يمكن إقفال الفترة بدون صلاحيات المدير المالي.",
            timestamp: "10:11",
            escalationCard: {
              reasonCode: "CLOSED_PERIOD_OR_POLICY_BLOCK",
              reasonAr: "يتطلب إقفال الفترة اعتماد المدير المالي",
              reasonEn: "Closing fiscal period requires CFO sign-off",
              moduleTab: "accounting",
              adminContact: {
                name: "Company Admin",
                phone: "+967-771122334",
              },
              supportContact: {
                hotline: "800-UAS-SUPPORT",
                whatsApp: "+967-770000000",
                email: "support@uas-erp.com",
                portalUrl: "https://support.uas.world",
              },
            },
          },
        ],
      };

      const mockProfile: UasEnterpriseProfile = {
        id: "ent-1",
        legalNameAr: "شركة التجارة العامة والخدمات",
        legalNameEn: "General Trading & Services Co.",
        currencyCode: "YER",
        brandColor: "#059669",
        commercialReg: "CR-78910",
        taxNumber: "TAX-12345",
      };

      const mockUser: UasUser = {
        id: "u-1",
        username: "awadh_admin",
        name: "أحمد العواضي",
        email: "admin@uas.world",
        role: "SUPER_ADMIN",
        active: true,
        avatarChar: "A",
      };

      const spec = buildCopilotConversationPrintSpec({
        thread,
        enterpriseProfile: mockProfile,
        user: mockUser,
        lang: "ar",
      });

      // Verify Letterhead & Metadata
      assert.equal(spec.documentNumber, "thread-sample-print");
      assert.ok(spec.titleAr.includes("سجل محادثة المساعد المحاسبي الذكي"));
      assert.equal(spec.letterhead?.companyNameAr, "شركة التجارة العامة والخدمات");
      assert.ok((spec.metadata?.length ?? 0) >= 4);

      const sessionCard = spec.metadata?.find((c) => c.labelAr === "معرف السجل");
      assert.ok(sessionCard);
      assert.equal(sessionCard.value, "thread-sample-print");

      // Verify Summary Cards
      assert.ok(spec.summaryCards);
      assert.equal(spec.summaryCards.length, 5);
      const totalTurns = spec.summaryCards.find((s) => s.labelAr === "إجمالي الرسائل");
      assert.equal(totalTurns?.value, "4");
      const confirmedCard = spec.summaryCards.find((s) => s.labelAr === "العمليات المعتمدة والمرحلة");
      assert.equal(confirmedCard?.value, "1");

      // Verify Tables (Itemized messages)
      assert.ok(spec.tables);
      assert.equal(spec.tables.length, 1);
      const tableSection = spec.tables[0];
      assert.ok(tableSection.headingAr?.includes("سجل الرسائل"));
      assert.equal(tableSection.columns.length, 5);
      assert.equal(tableSection.rows.length, 4);

      // Verify Row 2 (Assistant reply with confirmation and citation)
      const assistantRow = tableSection.rows[1];
      assert.ok(String(assistantRow.sender).includes("المساعد الذكي"));
      assert.ok(String(assistantRow.action).includes("RV-2026-0042"));
      assert.ok(String(assistantRow.content).includes("سندات القبض والصرف"));

      // Verify Row 4 (Escalation card)
      const escalationRow = tableSection.rows[3];
      assert.ok(String(escalationRow.action).includes("تصعيد إداري"));
      assert.ok(String(escalationRow.action).includes("CLOSED_PERIOD_OR_POLICY_BLOCK"));

      // Verify Notes
      assert.ok(spec.notes?.includes("أحمد العواضي"));
      assert.ok(spec.notes?.includes("RFC 3161"));
    });

    it("generates an English print document specification when lang is 'en'", () => {
      const thread: CopilotThread = {
        id: "thread-en-print",
        userId: "user-en",
        titleAr: "محادثة إنجليزية",
        titleEn: "Invoicing and Customer Inquiries",
        snippet: "Invoiced customer successfully",
        createdAt: "2026-11-20T11:00:00Z",
        updatedAt: "2026-11-20T11:05:00Z",
        isArchived: false,
        archivedAt: null,
        messages: [
          {
            id: "m1",
            role: "user",
            text: "Invoice customer Al-Amal Co for 1500 USD",
            timestamp: "11:00",
          },
          {
            id: "m2",
            role: "assistant",
            text: "Draft invoice created for Al-Amal Co.",
            timestamp: "11:01",
          },
        ],
      };

      const spec = buildCopilotConversationPrintSpec({
        thread,
        lang: "en",
      });

      assert.ok(spec.titleEn?.includes("AI Copilot Conversation & Audit Transcript"));
      const sessionCard = spec.metadata?.find((c) => c.labelEn === "Thread ID");
      assert.ok(sessionCard);
      assert.equal(sessionCard.value, "thread-en-print");

      assert.ok(spec.tables);
      assert.equal(spec.tables[0].columns[0].labelEn, "#");
      assert.equal(spec.tables[0].columns[1].labelEn, "Time");
      assert.equal(spec.tables[0].columns[2].labelEn, "Sender");
      assert.equal(spec.tables[0].columns[3].labelEn, "Content & Reasoning");
      assert.equal(spec.tables[0].columns[4].labelEn, "Action Status");
    });
  });
});
