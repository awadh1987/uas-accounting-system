import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  createSpeechTranscriptAccumulator,
  mergeSpeechTranscriptSegments,
} from "../src/lib/voicePermissions";
import {
  formatSpokenTextForGeminiTts,
  splitTextForSequentialSpeech,
} from "../src/lib/ai/yemeniLocalization";
import { identifyDummyTestProjects } from "../src/lib/dummyProjectRules";
import {
  deleteConfirmedDummyProjects,
  listCandidateDummyProjectsForTenant,
} from "../src/lib/dummyProjectCleanupServer";
import { executeUasAgentTool } from "../src/lib/ai/uasAgentTools";
import { runUasAiAgent } from "../src/lib/ai/offlineAgentEngine";
import { INITIAL_FALLBACK_STATE } from "../src/lib/seedFallback";
import { prisma } from "../src/lib/prisma";

const REPO_ROOT = path.resolve(__dirname, "..");

test("Voice input accumulator merges overlapping Chrome/Android SpeechRecognition results without repetition", () => {
  const merged = mergeSpeechTranscriptSegments([
    "سجل مصروف",
    "سجل مصروف نقل قات",
    "نقل قات 5000 ريال",
    "5000 ريال للقطفة الأولى",
  ]);
  assert.equal(merged, "سجل مصروف نقل قات 5000 ريال للقطفة الأولى");

  const acc = createSpeechTranscriptAccumulator();
  acc.reset("من فضلك");
  const r1 = acc.ingestResults([
    { isFinal: false, 0: { transcript: "من فضلك افتح" } },
  ]);
  assert.equal(r1.combined, "من فضلك افتح");

  const r2 = acc.ingestResults([
    { isFinal: true, 0: { transcript: "افتح شاشة المصروفات" } },
    { isFinal: false, 0: { transcript: "شاشة المصروفات اليوم" } },
  ]);
  assert.equal(r2.combined, "من فضلك افتح شاشة المصروفات اليوم");

  const flushed = acc.flushOnStop();
  assert.equal(flushed, "من فضلك افتح شاشة المصروفات اليوم");

  acc.reset("من فضلك");
  const ext = acc.commitExternalFinal("افتح شاشة المصروفات اليوم");
  assert.equal(ext, "من فضلك افتح شاشة المصروفات اليوم");
});

test("Voice output formatter & sequential splitter preserve full long replies without 680-char cutoff", () => {
  const sentences = Array.from({ length: 14 }, (_, idx) =>
    `البند رقم ${idx + 1}: تم مطابقة رصيد الصندوق والبنك لمركز تكلفة مزرعة وادي ظهر ومبيعات القطفة رقم ${idx + 1} بإجمالي ${(idx + 1) * 15000} ريال يمني دون أي عجز في المخزون.`
  );
  const longReply = sentences.join("\n") + "\nالنهاية الكاملة للتقرير المالي المعتمد.";
  assert.ok(longReply.length > 1800);

  const formattedFull = formatSpokenTextForGeminiTts(longReply, {
    lang: "ar",
    dialect: "yemeni",
  });
  assert.ok(formattedFull.length > 1500, "Default TTS formatting must not truncate at 680 chars");
  assert.ok(formattedFull.includes("النهاية الكاملة للتقرير المالي المعتمد"));

  const chunks = splitTextForSequentialSpeech(longReply, {
    lang: "ar",
    dialect: "yemeni",
    maxChunkChars: 420,
  });
  assert.ok(chunks.length >= 4, `Expected >=4 chunks for >1800-char reply, got ${chunks.length}`);
  for (const ch of chunks) {
    assert.ok(ch.length <= 425, `Chunk slightly exceeded limit: ${ch.length}`);
  }
  const recombined = chunks.join(" ");
  assert.ok(recombined.includes("البند رقم 1"));
  assert.ok(recombined.includes("النهاية الكاملة للتقرير المالي المعتمد"));
});

test("identifyDummyTestProjects detects leftover test patterns and protects real farms", () => {
  const sampleProjects = [
    { id: "default", code: "PRJ-01", name: "مزرعة وادي ظهر الرئيسية", nameAr: "مزرعة وادي ظهر الرئيسية" },
    { id: "real-1", code: "PRJ-ALAMERI", name: "مزرعة العامري - خولان", nameAr: "مزرعة العامري - خولان" },
    { id: "tst-1", code: "PRJ-P1778223001", name: "مشروع P1778223001", nameAr: "مشروع P1778223001" },
    { id: "tst-2", code: "PRJ-FP1778229999", name: "مشروع ربحية P1778229999", nameAr: "مشروع ربحية P1778229999" },
    { id: "tst-3", code: "PRJ-SMOKE-99", name: "Smoke Check Farm", nameAr: "مشروع تجريبي للاختبار" },
  ];
  const detected = identifyDummyTestProjects(sampleProjects);
  assert.deepEqual(
    detected.map((d) => d.id),
    ["tst-1", "tst-2", "tst-3"]
  );
});

test("cleanup_dummy_projects tool enforces RBAC, supports dryRun, and stages ConfirmationPreviewCard", async () => {
  const mixedState = {
    ...INITIAL_FALLBACK_STATE,
    projects: [
      { id: "real-farm-1", code: "PRJ-01", name: "مزرعة الوادي", budgetTotal: 500000, harvests: ["القطفة الأولى"] },
      { id: "dummy-p1", code: "PRJ-P1778221111", name: "مشروع P1778221111", budgetTotal: 10000, harvests: [] },
      { id: "dummy-fp2", code: "PRJ-FP1778222222", name: "مشروع ربحية P1778222222", budgetTotal: 10000, harvests: [] },
    ],
  };

  const blockedRes = await executeUasAgentTool(
    "cleanup_dummy_projects",
    {},
    {
      lang: "ar",
      user: "EXTERNAL_AUDITOR",
      state: mixedState,
      workspaceContext: { tenantSlug: "alameri" },
    }
  );
  assert.equal(blockedRes.ok, false);
  assert.equal(blockedRes.code, "RBAC_FORBIDDEN");
  assert.equal(blockedRes.requiresConfirmation, false);

  const dryRes = await executeUasAgentTool(
    "cleanup_dummy_projects",
    { dryRun: true },
    {
      lang: "ar",
      user: "PROJECT_MANAGER",
      state: mixedState,
      workspaceContext: { tenantSlug: "alameri" },
    }
  );
  assert.equal(dryRes.ok, true);
  assert.equal(dryRes.requiresConfirmation, false);
  assert.equal((dryRes.data as { candidateCount: number }).candidateCount, 2);
  assert.equal((dryRes.data as { preservedCount: number }).preservedCount, 1);

  const confirmRes = await executeUasAgentTool(
    "cleanup_dummy_projects",
    {},
    {
      lang: "ar",
      user: "SUPER_ADMIN",
      state: mixedState,
      workspaceContext: { tenantSlug: "alameri" },
    }
  );
  assert.equal(confirmRes.ok, true);
  assert.equal(confirmRes.requiresConfirmation, true);
  assert.equal(confirmRes.confirmationCard?.operationType, "CLEANUP_DUMMY_PROJECTS");
  assert.deepEqual(
    confirmRes.confirmationCard?.executionPayload?.projectIds,
    ["dummy-p1", "dummy-fp2"]
  );

  // Offline agent natural language routing
  const offlineDry = await runUasAiAgent("فحص المشاريع التجريبية", {
    lang: "ar",
    user: "SUPER_ADMIN",
    state: mixedState,
    workspaceContext: { tenantSlug: "alameri" },
  });
  assert.equal(offlineDry.toolName, "cleanup_dummy_projects");
  assert.equal(offlineDry.requiresConfirmation, false);
  assert.ok(offlineDry.reply.includes("2"));

  const offlineCleanup = await runUasAiAgent("نظف المشاريع التجريبية", {
    lang: "ar",
    user: "SUPER_ADMIN",
    state: mixedState,
    workspaceContext: { tenantSlug: "alameri" },
  });
  assert.equal(offlineCleanup.toolName, "cleanup_dummy_projects");
  assert.equal(offlineCleanup.requiresConfirmation, true);
  assert.equal(offlineCleanup.confirmationCard?.operationType, "CLEANUP_DUMMY_PROJECTS");
});

test("deleteConfirmedDummyProjects deletes only validated test projects and protects real projects", async () => {
  const stamp = Date.now();
  const dummyProj = await prisma.project.create({
    data: {
      code: `PRJ-TEST-${stamp}`,
      name: `Smoke Test Temp ${stamp}`,
      nameAr: `مشروع تجريبي للاختبار ${stamp}`,
      nameEn: `Smoke Test Temp ${stamp}`,
      budgetTotal: 1000,
      estimatedValue: 1000,
      plannedHarvestCount: 1,
      status: "ACTIVE",
    },
  });
  const realProj = await prisma.project.create({
    data: {
      code: `PRJ-LIVE-${stamp}`,
      name: `Real Valley Farm ${stamp}`,
      nameAr: `مزرعة الوادي الحقيقية ${stamp}`,
      nameEn: `Real Valley Farm ${stamp}`,
      budgetTotal: 500000,
      estimatedValue: 500000,
      plannedHarvestCount: 2,
      status: "ACTIVE",
    },
  });

  try {
    const listed = await listCandidateDummyProjectsForTenant("default");
    assert.ok(listed.candidates.some((c) => c.id === dummyProj.id));
    assert.ok(!listed.candidates.some((c) => c.id === realProj.id));

    // Attempt deletion with BOTH IDs passed; realProj MUST remain untouched!
    const res = await deleteConfirmedDummyProjects({
      projectIds: [dummyProj.id, realProj.id],
      actor: {
        userId: "u1",
        userDisplay: "Test Admin",
        userRole: "SUPER_ADMIN",
      },
      tenantSlug: "default",
    });

    assert.equal(res.deletedCount, 1);
    const dummyCheck = await prisma.project.findUnique({ where: { id: dummyProj.id } });
    const realCheck = await prisma.project.findUnique({ where: { id: realProj.id } });
    assert.equal(dummyCheck, null, "Dummy project must be deleted");
    assert.ok(realCheck, "Real project must NEVER be deleted");
  } finally {
    await prisma.auditLog.deleteMany({
      where: { entityId: { startsWith: "CLEANUP-" } },
    }).catch(() => {});
    await prisma.project.deleteMany({
      where: { id: { in: [dummyProj.id, realProj.id] } },
    });
    await prisma.$disconnect();
  }
});

test("Responsive dropdown layouts and manual voice send safety exist across Copilot and UAS views", () => {
  const copilotSrc = fs.readFileSync(path.join(REPO_ROOT, "src/components/UasAiCopilot.tsx"), "utf8");
  assert.ok(copilotSrc.includes('data-testid="copilot-pane-select"'));
  assert.ok(copilotSrc.includes('data-testid="copilot-header-actions-btn"'));
  assert.ok(copilotSrc.includes('data-testid="copilot-context-actions-select"'));
  assert.ok(copilotSrc.includes('data-testid="copilot-attach-menu-btn"'));
  assert.ok(copilotSrc.includes('data-testid="copilot-quick-actions-select"'));
  assert.ok(copilotSrc.includes('data-testid="copilot-manual-chapter-select"'));
  assert.ok(copilotSrc.includes("copilot-citations-select-"));
  assert.ok(copilotSrc.includes("manual-section-jump-"));
  assert.ok(copilotSrc.includes("max-h-[82dvh]"));
  assert.ok(copilotSrc.includes("overflow-x-hidden"));
  assert.ok(copilotSrc.includes("splitTextForSequentialSpeech("));
  assert.ok(
    !/rec\.onend\s*=\s*\(\)\s*=>\s*\{[\s\S]{0,300}handleSendPrompt\(flushed\)/.test(copilotSrc),
    "rec.onend must NOT auto-send partial dictated prompts while speaking"
  );

  const shellSrc = fs.readFileSync(path.join(REPO_ROOT, "src/components/UasAppShell.tsx"), "utf8");
  assert.ok(shellSrc.includes('data-testid="app-subtabs-select"'));
  assert.ok(shellSrc.includes('data-testid="sales-view-mode-select"'));

  const procSrc = fs.readFileSync(path.join(REPO_ROOT, "src/components/ProcurementTab.tsx"), "utf8");
  assert.ok(procSrc.includes('data-testid="procurement-subtab-select"'));

  const finSrc = fs.readFileSync(path.join(REPO_ROOT, "src/components/FinancialReportsTab.tsx"), "utf8");
  assert.ok(finSrc.includes('data-testid="financial-currency-mode-select"'));
  assert.ok(finSrc.includes('data-testid="financial-report-tab-select"'));

  const sysSrc = fs.readFileSync(path.join(REPO_ROOT, "src/components/tabs/SystemTab.tsx"), "utf8");
  assert.ok(sysSrc.includes('data-testid="system-subtab-select"'));
  assert.ok(
    /isPlatformSuperadmin\s*&&\s*\([\s\S]*superadmin-licenses[\s\S]*control-panel/.test(sysSrc),
    "Platform superadmin dropdown options must remain guarded by isPlatformSuperadmin"
  );

  const projSrc = fs.readFileSync(path.join(REPO_ROOT, "src/components/ProjectsManagerTab.tsx"), "utf8");
  assert.ok(projSrc.includes("project-cycles-select-"));

  const treasurySrc = fs.readFileSync(path.join(REPO_ROOT, "src/components/tabs/TreasuryTab.tsx"), "utf8");
  assert.ok(treasurySrc.includes('data-testid="treasury-actions-select"'));

  const salesSrc = fs.readFileSync(path.join(REPO_ROOT, "src/components/tabs/SalesTab.tsx"), "utf8");
  assert.ok(salesSrc.includes('data-testid="sales-actions-select"'));
});
