import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma";
import {
  createWorkspaceDraft,
  discardWorkspaceDraft,
  listWorkspaceDrafts,
  promoteWorkspaceDraft,
  updateWorkspaceDraft,
} from "../src/lib/workspaceDraftsEngine";
import {
  handleOfflineAndroidApiRequest,
  type OfflineStorageLike,
} from "../src/lib/offlineAndroidStore";

const TAG = `DRF${Date.now().toString().slice(-5)}`;
const createdDraftIds: string[] = [];
const createdJournalIds: string[] = [];

function memoryStorage(): OfflineStorageLike {
  const m = new Map<string, string>();
  return {
    getItem: (k) => (m.has(k) ? (m.get(k) as string) : null),
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
}

describe("Phase 4 — Universal Workspace Drafts Module (حفظ كمسودة)", () => {
  after(async () => {
    for (const jid of createdJournalIds) {
      await prisma.journalEntry.deleteMany({ where: { id: jid } }).catch(() => {});
    }
    for (const did of createdDraftIds) {
      await prisma.workspaceDraft.deleteMany({ where: { id: did } }).catch(() => {});
    }
    await prisma.$disconnect();
  });

  it("(a) saves and updates a form + subform line items as draft WITHOUT affecting GL or stock", async () => {
    const draft = await createWorkspaceDraft({
      module: "ACCOUNTING",
      formType: "JOURNAL_VOUCHER",
      titleAr: `مسودة قيد يومية ${TAG}`,
      titleEn: `Draft JV ${TAG}`,
      totalAmount: 2500,
      currencyCode: "YER",
      visibility: "SHARED_WORKSPACE",
      payload: {
        date: "2026-11-18",
        narrationAr: `قيد مسودة ${TAG}`,
        lines: [
          { accountCode: "111101", debit: 2500, credit: 0, memo: "سطر مدين" },
          { accountCode: "411101", debit: 0, credit: 2500, memo: "سطر دائن" },
        ],
      },
      actor: { userId: "u-creator", userName: "أحمد المحاسب", userRole: "FIELD_ACCOUNTANT" },
    });
    createdDraftIds.push(draft.id);

    assert.ok(draft.draftNumber.startsWith("DRF-"));
    assert.equal(draft.status, "ACTIVE_DRAFT");
    assert.equal(Array.isArray(draft.payload.lines), true);

    // Update draft line items
    const updated = await updateWorkspaceDraft(draft.id, {
      totalAmount: 3000,
      payload: {
        date: "2026-11-18",
        narrationAr: `قيد مسودة محدث ${TAG}`,
        lines: [
          { accountCode: "111101", debit: 3000, credit: 0, memo: "سطر مدين محدث" },
          { accountCode: "411101", debit: 0, credit: 3000, memo: "سطر دائن محدث" },
        ],
      },
      actor: { userId: "u-colleague", userName: "سالم المراجع", userRole: "CHIEF_ACCOUNTANT" },
    });

    assert.equal(Number(updated.totalAmount), 3000);
    assert.equal(updated.updatedByName, "سالم المراجع");
    const linkedGl = await prisma.journalEntry.count({
      where: { OR: [{ reference: draft.draftNumber }, { narrationAr: { contains: TAG } }] },
    });
    const linkedStock = await prisma.stockMovement.count({ where: { referenceId: draft.id } });
    assert.equal(linkedGl, 0, "Saving/updating a draft must NOT post to GL");
    assert.equal(linkedStock, 0, "Saving/updating a draft must NOT alter stock");
  });

  it("(b) enforces SHARED_WORKSPACE visibility across colleagues while isolating PRIVATE drafts", async () => {
    const shared = await createWorkspaceDraft({
      module: "SALES",
      formType: "SALES_INVOICE",
      titleAr: `مسودة مشتركة ${TAG}`,
      payload: { customer: "عميل مشترك", amount: 5000 },
      visibility: "SHARED_WORKSPACE",
      actor: { userId: "user-A", userName: "المستخدم أ", userRole: "FIELD_ACCOUNTANT" },
    });
    createdDraftIds.push(shared.id);

    const priv = await createWorkspaceDraft({
      module: "SALES",
      formType: "SALES_INVOICE",
      titleAr: `مسودة خاصة ${TAG}`,
      payload: { customer: "عميل خاص", amount: 1200 },
      visibility: "PRIVATE",
      actor: { userId: "user-A", userName: "المستخدم أ", userRole: "FIELD_ACCOUNTANT" },
    });
    createdDraftIds.push(priv.id);

    // Colleague user-B sees SHARED_WORKSPACE but NOT user-A's PRIVATE draft
    const forColleague = await listWorkspaceDrafts({
      module: "SALES",
      userId: "user-B",
      userRole: "FIELD_ACCOUNTANT",
    });
    assert.ok(forColleague.some((d: { id: string }) => d.id === shared.id), "Colleague sees shared draft");
    assert.ok(!forColleague.some((d: { id: string }) => d.id === priv.id), "Colleague cannot see private draft");

    // Creator user-A sees both
    const forCreator = await listWorkspaceDrafts({
      module: "SALES",
      userId: "user-A",
      userRole: "FIELD_ACCOUNTANT",
    });
    assert.ok(forCreator.some((d: { id: string }) => d.id === shared.id));
    assert.ok(forCreator.some((d: { id: string }) => d.id === priv.id));

    // Discarding hides draft from active list
    await discardWorkspaceDraft(priv.id, { userId: "user-A", userName: "المستخدم أ" });
    const afterDiscard = await listWorkspaceDrafts({
      module: "SALES",
      userId: "user-A",
      userRole: "FIELD_ACCOUNTANT",
    });
    assert.ok(!afterDiscard.some((d: { id: string }) => d.id === priv.id), "Discarded draft excluded from active list");
  });

  it("(c) promotes a saved Journal Voucher draft into a live posted JournalEntry and marks draft CONVERTED", async () => {
    const draft = await createWorkspaceDraft({
      module: "ACCOUNTING",
      formType: "JOURNAL_VOUCHER",
      titleAr: `قيد للترحيل ${TAG}`,
      totalAmount: 4200,
      payload: {
        date: "2026-11-18T10:00:00Z",
        narrationAr: `قيد محوّل من مسودة ${TAG}`,
        lines: [
          { accountCode: "111101", debit: 4200, credit: 0, memo: "تحصيل نقدي" },
          { accountCode: "411101", debit: 0, credit: 4200, memo: "إيراد مبيعات" },
        ],
      },
      actor: { userId: "u1", userName: "المدير المالي", userRole: "SUPER_ADMIN" },
    });
    createdDraftIds.push(draft.id);

    const promoted = await promoteWorkspaceDraft(draft.id, {
      userId: "u1",
      userName: "المدير المالي",
      userRole: "SUPER_ADMIN",
    });

    assert.ok(promoted.convertedEntityId, "Converted entity ID returned");
    createdJournalIds.push(promoted.convertedEntityId!);
    assert.equal(promoted.draft.status, "CONVERTED");

    const liveJe = await prisma.journalEntry.findUnique({
      where: { id: promoted.convertedEntityId! },
      include: { lines: true },
    });
    assert.ok(liveJe, "Live JournalEntry created in General Ledger");
    assert.equal(liveJe!.lines.length, 2);

    // Promoting an already-converted draft is blocked
    await assert.rejects(
      () => promoteWorkspaceDraft(draft.id, { userId: "u1", userName: "المدير المالي" }),
      /DRAFT_ALREADY_CONVERTED/
    );
  });

  it("mirrors /api/drafts CRUD & promote in Android Local Mode", async () => {
    const store = memoryStorage();
    const createRes = await handleOfflineAndroidApiRequest(
      "/api/drafts",
      {
        method: "POST",
        body: JSON.stringify({
          module: "SALES",
          formType: "SALES_INVOICE",
          titleAr: "مسودة بيع محلية",
          totalAmount: 9500,
          payload: { customer: "عميل محلي", bundles: 5 },
        }),
      },
      store
    );
    assert.equal(createRes.status, 201);
    const created = (await createRes.json()) as { draft: { id: string; draftNumber: string } };
    assert.ok(created.draft.draftNumber.startsWith("DRF-"));

    const listRes = await handleOfflineAndroidApiRequest("/api/drafts", { method: "GET" }, store);
    const listData = (await listRes.json()) as { activeCount: number };
    assert.equal(listData.activeCount, 1);

    const promoRes = await handleOfflineAndroidApiRequest(
      `/api/drafts/${created.draft.id}/promote`,
      { method: "POST", body: JSON.stringify({}) },
      store
    );
    assert.equal(promoRes.status, 200);
    const promoData = (await promoRes.json()) as { draft: { status: string } };
    assert.equal(promoData.draft.status, "CONVERTED");
  });
});
