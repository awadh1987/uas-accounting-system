import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma";
import {
  computeSnapshotDiff,
  createApprovalRule,
  decideApprovalRequest,
  deleteApprovalRule,
  findMatchingApprovalRule,
  submitApprovalRequest,
} from "../src/lib/approvalEngine";
import { postJournalEntry } from "../src/lib/accounting/ledgerService";
import {
  handleOfflineAndroidApiRequest,
  type OfflineStorageLike,
} from "../src/lib/offlineAndroidStore";

const TAG = `APR${Date.now().toString().slice(-5)}`;
const createdRuleIds: string[] = [];
const createdRequestIds: string[] = [];
const createdJournalIds: string[] = [];
const createdDraftIds: string[] = [];

function memoryStorage(): OfflineStorageLike {
  const m = new Map<string, string>();
  return {
    getItem: (k) => (m.has(k) ? (m.get(k) as string) : null),
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
}

describe("Phase 5 — Multi-Level Approval & Controlled Post-Posting Amendment Governance Engine", () => {
  after(async () => {
    for (const did of createdDraftIds) {
      await prisma.workspaceDraft.deleteMany({ where: { id: did } }).catch(() => {});
    }
    for (const rid of createdRequestIds) {
      await prisma.approvalRequest.deleteMany({ where: { id: rid } }).catch(() => {});
    }
    for (const ruleId of createdRuleIds) {
      await deleteApprovalRule(ruleId).catch(() => {});
    }
    for (const jid of createdJournalIds) {
      await prisma.journalEntry.deleteMany({ where: { id: jid } }).catch(() => {});
    }
    await prisma.$disconnect();
  });

  it("enforces ApprovalRule thresholds, blocks self-approval, and transitions PENDING_APPROVAL -> POSTED on approval", async () => {
    const rule = await createApprovalRule({
      module: "ACCOUNTING",
      actionType: "GL_POSTING",
      minAmountBase: 10000,
      requiredRole: "CHIEF_ACCOUNTANT",
      allowSelfApproval: false,
    });
    createdRuleIds.push(rule.id);

    // Threshold check
    const below = await findMatchingApprovalRule({ module: "ACCOUNTING", actionType: "GL_POSTING", amountBase: 5000 });
    assert.ok(!below || below.id !== rule.id, "Rule should not match below minAmountBase");
    const matched = await findMatchingApprovalRule({ module: "ACCOUNTING", actionType: "GL_POSTING", amountBase: 15000 });
    assert.ok(matched && matched.id === rule.id, "Rule matches above minAmountBase");

    // Create a JournalEntry held in PENDING_APPROVAL
    const pendingJe = await postJournalEntry({
      narrationAr: `قيد بانتظار الاعتماد ${TAG}`,
      status: "PENDING_APPROVAL",
      lines: [
        { accountCode: "111101", debit: 15000 },
        { accountCode: "411101", credit: 15000 },
      ],
    });
    createdJournalIds.push(pendingJe.id);

    const req = await submitApprovalRequest({
      module: "ACCOUNTING",
      actionType: "GL_POSTING",
      targetType: "JournalEntry",
      targetId: pendingJe.id,
      documentNumber: pendingJe.entryNumber,
      summaryAr: `اعتماد قيد ${pendingJe.entryNumber}`,
      amountBase: 15000,
      afterSnapshot: { narrationAr: pendingJe.narrationAr, amountBase: 15000 },
      actor: { userId: "requester-1", userName: "محاسب ميداني", userRole: "FIELD_ACCOUNTANT" },
    });
    createdRequestIds.push(req.id);
    assert.ok(req.requestNumber.startsWith("APR-"));
    assert.equal(req.status, "PENDING");

    // Self-approval MUST be blocked
    await assert.rejects(
      () =>
        decideApprovalRequest({
          requestId: req.id,
          decision: "APPROVED",
          reviewer: { userId: "requester-1", userName: "محاسب ميداني", userRole: "CHIEF_ACCOUNTANT" },
        }),
      /SELF_APPROVAL_FORBIDDEN/
    );

    // Wrong role MUST be blocked
    await assert.rejects(
      () =>
        decideApprovalRequest({
          requestId: req.id,
          decision: "APPROVED",
          reviewer: { userId: "other-field", userName: "محاسب آخر", userRole: "FIELD_ACCOUNTANT" },
        }),
      /APPROVAL_ROLE_REQUIRED/
    );

    // Authorized Chief Accountant approves -> transitions JournalEntry to POSTED
    const decided = await decideApprovalRequest({
      requestId: req.id,
      decision: "APPROVED",
      reviewNotes: "تمت المراجعة والموافقة",
      reviewer: { userId: "chief-1", userName: "رئيس الحسابات", userRole: "CHIEF_ACCOUNTANT" },
    });
    assert.equal(decided.request.status, "APPROVED");

    const updatedJe = await prisma.journalEntry.findUniqueOrThrow({ where: { id: pendingJe.id } });
    assert.equal(updatedJe.status, "POSTED");
    assert.equal(updatedJe.documentStatus, "POSTED");
  });

  it("handles controlled post-posting amendments with Before/After diff, revisionNumber increment, AuditLog, and RETURNED_FOR_EDIT draft handoff", async () => {
    const je = await postJournalEntry({
      narrationAr: `قيد أصلي قبل التعديل ${TAG}`,
      status: "POSTED",
      lines: [
        { accountCode: "111101", debit: 8000 },
        { accountCode: "411101", credit: 8000 },
      ],
    });
    createdJournalIds.push(je.id);
    assert.equal(je.revisionNumber, 1);

    const beforeSnap = { narrationAr: je.narrationAr, reference: je.reference };
    const afterSnap = { narrationAr: `قيد معدل ومعتمد ${TAG}`, reference: `REV-${TAG}` };
    const diffs = computeSnapshotDiff(beforeSnap, afterSnap);
    assert.equal(diffs.length, 2);

    const amendReq = await submitApprovalRequest({
      module: "ACCOUNTING",
      actionType: "AMEND_POSTED_RECORD",
      targetType: "JournalEntry",
      targetId: je.id,
      documentNumber: je.entryNumber,
      summaryAr: `طلب تعديل بيان القيد ${je.entryNumber}`,
      amountBase: 8000,
      beforeSnapshot: beforeSnap,
      afterSnapshot: afterSnap,
      reasonAr: "تصحيح البيان والمرجع بعد المراجعة",
      actor: { userId: "req-amend", userName: "محاسب", userRole: "FIELD_ACCOUNTANT" },
    });
    createdRequestIds.push(amendReq.id);

    const held = await prisma.journalEntry.findUniqueOrThrow({ where: { id: je.id } });
    assert.equal(held.documentStatus, "AMENDMENT_PENDING");

    // Approve amendment -> atomically applies changes + increments revisionNumber + writes AuditLog
    await decideApprovalRequest({
      requestId: amendReq.id,
      decision: "APPROVED",
      reviewNotes: "موافق على تعديل البيان",
      reviewer: { userId: "u1", userName: "مدير النظام", userRole: "SUPER_ADMIN" },
    });

    const amended = await prisma.journalEntry.findUniqueOrThrow({ where: { id: je.id } });
    assert.equal(amended.documentStatus, "POSTED");
    assert.equal(amended.revisionNumber, 2);
    assert.equal(amended.narrationAr, `قيد معدل ومعتمد ${TAG}`);
    assert.equal(amended.reference, `REV-${TAG}`);

    const audit = await prisma.auditLog.findFirst({
      where: { entity: "JournalEntry", entityId: je.id, action: "AMENDMENT_APPROVED" },
    });
    assert.ok(audit, "Immutable AuditLog entry written for approved amendment");

    // RETURNED_FOR_EDIT automatically creates a WorkspaceDraft for revision
    const returnReq = await submitApprovalRequest({
      module: "ACCOUNTING",
      actionType: "AMEND_POSTED_RECORD",
      targetType: "JournalEntry",
      targetId: je.id,
      documentNumber: je.entryNumber,
      summaryAr: `طلب تعديل ثاني ${TAG}`,
      amountBase: 8000,
      beforeSnapshot: afterSnap,
      afterSnapshot: { narrationAr: "تعديل غير مكتمل" },
      reasonAr: "اختبار الإعادة للتعديل",
      actor: { userId: "req-amend", userName: "محاسب", userRole: "FIELD_ACCOUNTANT" },
    });
    createdRequestIds.push(returnReq.id);

    const returned = await decideApprovalRequest({
      requestId: returnReq.id,
      decision: "RETURNED_FOR_EDIT",
      reviewNotes: "يرجى إرفاق رقم المستند المرجعي",
      reviewer: { userId: "u1", userName: "مدير النظام", userRole: "SUPER_ADMIN" },
    });
    assert.equal(returned.request.status, "RETURNED_FOR_EDIT");
    assert.ok(returned.createdDraftId, "RETURNED_FOR_EDIT creates a WorkspaceDraft for revision");
    createdDraftIds.push(returned.createdDraftId!);
  });

  it("mirrors /api/approvals/* rules, requests and decisions in Android Local Mode", async () => {
    const store = memoryStorage();
    const ruleRes = await handleOfflineAndroidApiRequest(
      "/api/approvals/rules",
      {
        method: "POST",
        body: JSON.stringify({
          module: "SALES",
          actionType: "HIGH_VALUE_TRANSACTION",
          minAmountBase: 50000,
          requiredRole: "CHIEF_ACCOUNTANT",
        }),
      },
      store
    );
    assert.equal(ruleRes.status, 201);

    const submitRes = await handleOfflineAndroidApiRequest(
      "/api/approvals",
      {
        method: "POST",
        body: JSON.stringify({
          module: "SALES",
          actionType: "HIGH_VALUE_TRANSACTION",
          targetType: "SalesInvoice",
          targetId: "inv-local-1",
          documentNumber: "INV-2026-0099",
          summaryAr: "اعتماد فاتورة مبيعات كبرى",
          amountBase: 75000,
        }),
      },
      store
    );
    assert.equal(submitRes.status, 201);
    const created = (await submitRes.json()) as { request: { id: string; requestNumber: string } };
    assert.ok(created.request.requestNumber.startsWith("APR-"));

    const decRes = await handleOfflineAndroidApiRequest(
      `/api/approvals/${created.request.id}/decide`,
      { method: "POST", body: JSON.stringify({ decision: "APPROVED", reviewNotes: "معتمد محلياً" }) },
      store
    );
    assert.equal(decRes.status, 200);
    const decData = (await decRes.json()) as { request: { status: string } };
    assert.equal(decData.request.status, "APPROVED");
  });
});
