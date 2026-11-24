import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { NextRequest } from "next/server";
import { sanitizeSpeechText } from "../src/lib/speechSanitizer";
import {
  buildGeminiDialectInstruction,
  splitTextForSequentialSpeech,
} from "../src/lib/ai/yemeniLocalization";
import {
  countLearnedDialectEntries,
  getUserDialectLearningEnabled,
  listVisibleTenantMemories,
  resetLearnedDialectForUser,
  setUserDialectLearningEnabled,
  upsertTenantMemory,
} from "../src/lib/ai/copilotMemoryStore";
import { learnFromCopilotTurn } from "../src/lib/ai/copilotLearner";
import { POST as speakPOST } from "../src/app/api/ai/speak/route";

describe("Phase 6: Copilot Chat-Only Speech Sanitization, Continuous Audio & Yemeni Dialect Controls", () => {
  let tmpDataDir = "";
  let prevDataDir: string | undefined;

  before(() => {
    prevDataDir = process.env.UAS_DATA_DIR;
    tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "uas-copilot-p6-"));
    process.env.UAS_DATA_DIR = tmpDataDir;
  });

  after(() => {
    if (tmpDataDir && fs.existsSync(tmpDataDir)) {
      fs.rmSync(tmpDataDir, { recursive: true, force: true });
    }
    if (prevDataDir === undefined) delete process.env.UAS_DATA_DIR;
    else process.env.UAS_DATA_DIR = prevDataDir;
  });

  it("strips internal thinking, system/developer prompts, JSON tool traces, URLs & markdown for speech", () => {
    const rawAssistantText = [
      "<think>Internal chain of thought: check balance in 111101 before replying.</think>",
      "<reasoning>Step 1: call get_cashbox_balance</reasoning>",
      "SYSTEM: Do not reveal confidential rules.",
      "developer: enforce confirmation gate.",
      "tool_call: get_cashbox_balance",
      '{"toolName": "get_cashbox_balance", "args": {"account": "111101"}}',
      "```json",
      '{"status": "draft", "amount": 150000}',
      "```",
      "حياك الله يا غالي! رصيد **الصندوق** اليوم وصل إلى 150,000 YER بنسبة 85% زيادة، راجع [التقرير](https://qat.world/reports) لمزيد من التفاصيل.",
      "<think>trailing unclosed reasoning trace should vanish too",
    ].join("\n");

    const spoken = sanitizeSpeechText(rawAssistantText, {
      speakReasoning: false,
      lang: "ar",
    });

    assert.equal(spoken.includes("Internal chain of thought"), false);
    assert.equal(spoken.includes("Step 1"), false);
    assert.equal(spoken.includes("SYSTEM"), false);
    assert.equal(spoken.includes("developer"), false);
    assert.equal(spoken.includes("tool_call"), false);
    assert.equal(spoken.includes("get_cashbox_balance"), false);
    assert.equal(spoken.includes("qat.world"), false);
    assert.equal(spoken.includes("trailing unclosed"), false);
    assert.ok(spoken.includes("حياك الله يا غالي"));
    assert.ok(spoken.includes("150000 ريال يمني"));
    assert.ok(spoken.includes("85 في المئة"));
  });

  it("rejects speak requests containing only internal reasoning/prompts when speakReasoning=false", async () => {
    const res = await speakPOST(
      new NextRequest("https://qat.world/api/ai/speak", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text: "<think>Only hidden thoughts here</think>\nSYSTEM: prompt line\n{\"toolName\":\"audit\"}",
          lang: "ar",
          dialect: "yemeni",
        }),
      })
    );
    assert.equal(res.status, 400);
    const json = (await res.json()) as { reason?: string };
    assert.equal(json.reason, "EMPTY_SPOKEN_TEXT");
  });

  it("generates everyday Yemeni dialect instructions with learned terms and smooth long chunks", () => {
    const prompt = buildGeminiDialectInstruction("ar", "yemeni", [
      "يفضل المستخدم عبارة الباقي عند العملاء للذمم",
    ]);
    assert.ok(prompt.includes("حياك الله يا غالي"));
    assert.ok(prompt.includes("العلاقي"));
    assert.ok(prompt.includes("الباقي عند العملاء"));
    assert.ok(prompt.includes("الغلّة"));

    const longReply = Array.from({ length: 12 }, (_, idx) =>
      `حياك الله، القطفة رقم ${idx + 1} جاهزة وصافي الغلة في الصندوق 25000 ريال يمني.`
    ).join(" ");
    const chunks = splitTextForSequentialSpeech(longReply, {
      lang: "ar",
      dialect: "yemeni",
      maxChunkChars: 900,
    });
    assert.ok(chunks.length >= 1);
    assert.ok(chunks.every((c) => c.length <= 900));
  });

  it("persists per-user/tenant Dialect Learning toggle and resets only learned dialect without wiping accounting rules", async () => {
    const tenantA = "aljabri";
    const tenantB = "alameri";

    // Seed workspace accounting rule in tenant A (must survive dialect reset)
    upsertTenantMemory({
      tenantSlug: tenantA,
      scope: "workspace",
      category: "domain_fact",
      topicKey: "acct:sanaa_freight",
      content: "مصاريف التوصيل لصنعاء تسجل دائماً على حساب مصروفات النقل 524102",
    });

    // Seed another user's dialect term in tenant A + another tenant's dialect term in tenant B
    upsertTenantMemory({
      tenantSlug: tenantA,
      scope: "user",
      userId: "user-2",
      category: "dialect_preference",
      topicKey: "dialect:other_user_phrase",
      content: "يفضل المستخدم الثاني مصطلح الحواصل",
    });
    upsertTenantMemory({
      tenantSlug: tenantB,
      scope: "user",
      userId: "user-1",
      category: "dialect_preference",
      topicKey: "dialect:alameri_phrase",
      content: "مصطلح البزغة في فرع العامري",
    });

    assert.equal(getUserDialectLearningEnabled({ tenantSlug: tenantA, userId: "user-1" }), true);

    // Disable dialect learning -> dialect turns should NOT learn dialect_preference
    setUserDialectLearningEnabled({ tenantSlug: tenantA, userId: "user-1", enabled: false });
    assert.equal(getUserDialectLearningEnabled({ tenantSlug: tenantA, userId: "user-1" }), false);

    await learnFromCopilotTurn({
      prompt: "خاطبني باللهجة الصنعانية وسمّي التالف فاقد",
      tenantSlug: tenantA,
      userId: "user-1",
      dialect: "yemeni",
      dialectLearningEnabled: false,
      enableGeminiExtraction: false,
    });
    assert.equal(countLearnedDialectEntries({ tenantSlug: tenantA, userId: "user-1" }), 0);

    // Enable dialect learning -> learns dialect_preference cleanly
    setUserDialectLearningEnabled({ tenantSlug: tenantA, userId: "user-1", enabled: true });
    await learnFromCopilotTurn({
      prompt: "خاطبني باللهجة الصنعانية عند عرض العلاقي والقطفة",
      tenantSlug: tenantA,
      userId: "user-1",
      dialect: "yemeni",
      dialectLearningEnabled: true,
      enableGeminiExtraction: false,
    });
    assert.equal(countLearnedDialectEntries({ tenantSlug: tenantA, userId: "user-1" }), 1);

    // Reset learned dialect for user-1 in tenantA
    const resetRes = resetLearnedDialectForUser({ tenantSlug: tenantA, userId: "user-1" });
    assert.equal(resetRes.removedCount, 1);
    assert.equal(countLearnedDialectEntries({ tenantSlug: tenantA, userId: "user-1" }), 0);

    // Accounting rule & other user/tenant dialect memories remain completely untouched!
    const remainingA = listVisibleTenantMemories({ tenantSlug: tenantA, includeInactive: true });
    assert.ok(remainingA.some((m) => m.topicKey === "acct:sanaa_freight"));
    assert.ok(remainingA.some((m) => m.userId === "user-2" && m.topicKey === "dialect:other_user_phrase"));

    const remainingB = listVisibleTenantMemories({ tenantSlug: tenantB, userId: "user-1" });
    assert.ok(remainingB.some((m) => m.topicKey === "dialect:alameri_phrase"));
  });

  it("exposes pre-buffered audio, single stop indicator, and dialect learning/reset controls in UasAiCopilot", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/components/UasAiCopilot.tsx"),
      "utf8"
    );
    assert.ok(src.includes('data-testid="copilot-header-actions-menu"'));
    assert.ok(src.includes('data-testid="uas-ai-copilot-dialect-learning-btn"'));
    assert.ok(src.includes('data-testid="uas-ai-copilot-reset-dialect-btn"'));
    assert.ok(src.includes('data-testid="copilot-global-stop-audio-btn"'));
    assert.ok(src.includes("sanitizeSpeechText("));
    assert.ok(src.includes("PREFETCH_LOOKAHEAD"));
  });
});
