import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { validateVisionImagePayload } from "../src/lib/ai/copilotVisionTypes";
import { extractDocumentFromVisionImage } from "../src/lib/ai/copilotVisionExtractor";
import {
  runGeminiCopilotAgent,
  type GeminiClientFactory,
} from "../src/lib/ai/geminiCopilotEngine";
import { INITIAL_FALLBACK_STATE } from "../src/lib/seedFallback";
import type { CopilotMemoryEntry } from "../src/lib/ai/copilotMemoryTypes";

const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

test("Vision payload validator enforces MIME types and 6 MB cap", () => {
  const okPng = validateVisionImagePayload({
    imageBase64: `data:image/png;base64,${TINY_PNG_BASE64}`,
    mimeType: "",
  });
  assert.equal(okPng.ok, true);

  const badMime = validateVisionImagePayload({
    imageBase64: TINY_PNG_BASE64,
    mimeType: "application/pdf",
  });
  assert.equal(badMime.ok, false);
  if (!badMime.ok) {
    assert.equal(badMime.code, "UNSUPPORTED_MIME_TYPE");
    assert.equal(badMime.status, 400);
  }

  const emptyImg = validateVisionImagePayload({
    imageBase64: "",
    mimeType: "image/jpeg",
  });
  assert.equal(emptyImg.ok, false);
  if (!emptyImg.ok) {
    assert.equal(emptyImg.code, "EMPTY_IMAGE");
  }

  // > 6 MB base64 payload (~8.4M base64 chars -> ~6.3 MB decoded)
  const oversizedBase64 = "A".repeat(8_400_000);
  const tooLarge = validateVisionImagePayload({
    imageBase64: oversizedBase64,
    mimeType: "image/jpeg",
  });
  assert.equal(tooLarge.ok, false);
  if (!tooLarge.ok) {
    assert.equal(tooLarge.code, "PAYLOAD_TOO_LARGE");
    assert.equal(tooLarge.status, 413);
  }
});

test("Multimodal harvest tally sheet extraction maps to draft_harvest_batch with mandatory ConfirmationPreviewCard", async () => {
  const sampleState = {
    ...INITIAL_FALLBACK_STATE,
    projects: [
      {
        id: "prj-rawdah",
        code: "PRJ-01",
        name: "مزرعة الروضة",
        location: "صنعاء",
        budgetTotal: 500000,
        plannedHarvests: 4,
        harvests: ["القطفة الأولى", "البزغة"],
        subProjects: [],
      },
    ],
  };

  let capturedInlineMime = "";
  let capturedModel = "";
  const fakeFactory: GeminiClientFactory = () => ({
    models: {
      generateContent: async (params) => {
        capturedModel = params.model;
        const firstUserContent = Array.isArray(params.contents) ? params.contents[0] : null;
        const parts = (firstUserContent?.parts ?? []) as Array<{
          inlineData?: { mimeType?: string; data?: string };
        }>;
        capturedInlineMime = parts.find((p) => p.inlineData)?.inlineData?.mimeType || "";

        return {
          text: JSON.stringify({
            documentType: "harvest_tally_sheet",
            confidence: 0.91,
            projectName: "مزرعة الروضة",
            harvest: "القطفة الأولى",
            grade: "علاقية درجة أولى",
            currency: "YER",
            totalBundles: 65,
            shrinkageBundles: 3,
            notes: "كشف قطفة الصباح - البزغة",
            lineItems: [
              {
                description: "علاقية درجة أولى",
                grade: "علاقية درجة أولى",
                harvest: "القطفة الأولى",
                quantity: 40,
                unitPrice: 0,
                total: 0,
                shrinkageBundles: 2,
              },
              {
                description: "علاقية درجة أولى (مسائي)",
                grade: "علاقية درجة أولى",
                harvest: "القطفة الأولى",
                quantity: 25,
                unitPrice: 0,
                total: 0,
                shrinkageBundles: 1,
              },
            ],
          }),
        } as never;
      },
    },
  });

  const res = await runGeminiCopilotAgent("اقرأ كشف القطفة المرفق", {
    user: "SUPER_ADMIN",
    lang: "ar",
    state: sampleState,
    workspaceContext: {
      tenantSlug: "al-rawdah",
      activeTab: "inventory",
      selectedProjectId: "prj-rawdah",
      selectedHarvest: "القطفة الأولى",
    },
    imageAttachment: {
      imageBase64: TINY_PNG_BASE64,
      mimeType: "image/png",
      fileName: "harvest-sheet.png",
    },
    geminiApiKey: "fake-vision-key",
    clientFactory: fakeFactory,
  });

  assert.equal(res.ok, true);
  assert.equal(capturedInlineMime, "image/png");
  assert.equal(capturedModel, "gemini-3.8-flash");
  assert.equal(res.toolName, "draft_harvest_batch");
  assert.equal(res.requiresConfirmation, true);
  assert.equal(res.confirmationCard?.operationType, "RECORD_HARVEST_BATCH");
  assert.equal(res.visionExtraction?.escalatedToReasoningModel, false);
  assert.equal(res.visionExtraction?.arithmeticMismatch, false);
  assert.equal(res.confirmationCard?.executionPayload?.harvestedBundles, 65);
  assert.equal(res.confirmationCard?.executionPayload?.shrinkageBundles, 3);
});

test("Messy receipt escalates gemini-3.8-flash -> gemini-4-argon, flags arithmetic mismatch, applies tenant memory & preserves RBAC", async () => {
  const sampleState = {
    ...INITIAL_FALLBACK_STATE,
    projects: [
      {
        id: "prj-rawdah",
        code: "PRJ-01",
        name: "مزرعة الروضة",
        location: "صنعاء",
        budgetTotal: 800000,
        plannedHarvests: 3,
        harvests: ["القطفة الأولى"],
        subProjects: [],
      },
    ],
  };

  const memories: CopilotMemoryEntry[] = [
    {
      id: "mem-transport",
      tenantSlug: "al-rawdah",
      scope: "workspace",
      category: "operational_pattern",
      topicKey: "expense_map:sanaa_delivery",
      content: "مصاريف التوصيل لصنعاء تسجل تحت مصروفات النقل والتوزيع",
      sourceSnippet: "مصاريف التوصيل لصنعاء",
      confidence: 0.94,
      usageCount: 2,
      pinned: true,
      active: true,
      createdAt: "2026-11-20T00:00:00Z",
      updatedAt: "2026-11-20T00:00:00Z",
    },
  ];

  const modelsCalled: string[] = [];
  const fakeFactory: GeminiClientFactory = () => ({
    models: {
      generateContent: async (params) => {
        modelsCalled.push(params.model);
        if (params.model === "gemini-3.8-flash") {
          return {
            text: JSON.stringify({
              documentType: "expense_or_supplier_receipt",
              confidence: 0.61, // Triggers escalation!
              partyName: "مؤسسة النقل السريع",
              notes: "توصيل شحنة إلى صنعاء",
              currency: "YER",
              handwrittenTotal: 25000,
              lineItems: [
                { description: "نقل صنعاء", quantity: 1, unitPrice: 12000, total: 12000 },
                { description: "تحميل", quantity: 1, unitPrice: 10000, total: 10000 },
              ], // sum = 22000 != 25000
            }),
          } as never;
        }
        return {
          text: JSON.stringify({
            documentType: "expense_or_supplier_receipt",
            confidence: 0.89,
            partyName: "مؤسسة النقل السريع",
            notes: "توصيل شحنة إلى صنعاء",
            currency: "YER",
            handwrittenTotal: 25000,
            lineItems: [
              { description: "نقل صنعاء", quantity: 1, unitPrice: 12000, total: 12000 },
              { description: "تحميل", quantity: 1, unitPrice: 10000, total: 10000 },
            ],
          }),
        } as never;
      },
    },
  });

  const adminRes = await runGeminiCopilotAgent("سند توصيل صنعاء", {
    user: "SUPER_ADMIN",
    lang: "ar",
    state: sampleState,
    memories,
    workspaceContext: {
      tenantSlug: "al-rawdah",
      activeTab: "expenses",
      selectedProjectId: "prj-rawdah",
    },
    imageAttachment: {
      imageBase64: TINY_PNG_BASE64,
      mimeType: "image/jpeg",
    },
    geminiApiKey: "fake-vision-key",
    clientFactory: fakeFactory,
  });

  assert.deepEqual(modelsCalled, ["gemini-3.8-flash", "gemini-4-argon"]);
  assert.equal(adminRes.ok, true);
  assert.equal(adminRes.modelUsed, "Gemini 4 Argon");
  assert.equal(adminRes.visionExtraction?.escalatedToReasoningModel, true);
  assert.equal(adminRes.visionExtraction?.arithmeticMismatch, true);
  assert.equal(adminRes.visionExtraction?.discrepancyAmount, 3000);
  assert.equal(adminRes.requiresConfirmation, true);
  assert.equal(
    String(adminRes.confirmationCard?.titleAr || "").includes("مصروفات النقل والتوزيع"),
    true
  );

  // Read-only auditor cannot bypass RBAC via Vision extraction
  const auditorRes = await runGeminiCopilotAgent("سند توصيل صنعاء", {
    user: "EXTERNAL_AUDITOR",
    lang: "ar",
    state: sampleState,
    memories,
    workspaceContext: { tenantSlug: "al-rawdah", selectedProjectId: "prj-rawdah" },
    imageAttachment: {
      imageBase64: TINY_PNG_BASE64,
      mimeType: "image/jpeg",
    },
    geminiApiKey: "fake-vision-key",
    clientFactory: fakeFactory,
  });
  assert.equal(auditorRes.ok, false);
  assert.equal(auditorRes.toolResult.code, "RBAC_FORBIDDEN");
  assert.equal(auditorRes.requiresConfirmation, false);
});

test("Vision returns 503 offline fallback hint when key is missing and client modules contain zero server SDK secrets", async () => {
  const prevKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "";
  try {
    const res = await extractDocumentFromVisionImage({
      imageBase64: TINY_PNG_BASE64,
      mimeType: "image/png",
      lang: "ar",
      geminiApiKey: "",
    });
    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.equal(res.status, 503);
      assert.equal(res.code, "VISION_OFFLINE_OR_UNCONFIGURED");
    }
  } finally {
    if (prevKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = prevKey;
  }

  for (const relPath of [
    "src/lib/ai/clientImageCompression.ts",
    "src/lib/ai/copilotVisionTypes.ts",
    "src/components/UasAiCopilot.tsx",
  ]) {
    const content = fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
    assert.equal(content.includes('from "@google/genai"'), false);
    assert.equal(content.includes("GoogleGenAI"), false);
    assert.equal(content.includes("GEMINI_API_KEY"), false);
    assert.equal(content.includes("AIzaSy"), false);
  }
});
