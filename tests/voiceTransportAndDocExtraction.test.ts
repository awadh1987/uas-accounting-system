import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  checkMicrophoneDiagnostics,
  createSpeechTranscriptAccumulator,
  normalizeSpeechError,
} from "../src/lib/voicePermissions";
import {
  computeBackoffWithJitterMs,
  resilientFetch,
  resolveTransportTarget,
} from "../src/lib/transportResolver";
import {
  parseDocumentTextDeterministically,
  validateExtractedDraft,
} from "../src/lib/ai/documentExtractionEngine";

function createMemoryStorage(initial: Record<string, string> = {}) {
  const data: Record<string, string> = { ...initial };
  return {
    getItem(k: string) {
      return data[k] ?? null;
    },
    setItem(k: string, v: string) {
      data[k] = v;
    },
    removeItem(k: string) {
      delete data[k];
    },
  };
}

describe("Voice Permissions, Transport Resilience & AI Copilot Document Extraction", () => {
  describe("1. Language-Independent Voice Permissions & Interim Transcript Flushing", () => {
    it("checks microphone permission and unused-app revocation status independently of speech locale", async () => {
      const mockWin = {
        UasAndroidNative: {
          checkMicrophonePermission: () =>
            JSON.stringify({
              granted: true,
              shouldShowRationale: false,
              unusedAppRestrictionsStatus: 2,
              unusedRestrictionsEnabled: true,
            }),
        },
      };

      const diag = await checkMicrophoneDiagnostics(mockWin as any);
      assert.equal(diag.permissionState, "granted");
      assert.equal(diag.isNativeAndroid, true);
      assert.equal(diag.unusedAppRestrictionsEnabled, true);
      assert.equal(diag.unusedAppStatusCode, 2);
    });

    it("normalizes speech error codes cleanly across not-allowed, audio-capture, no-speech, and language-not-supported", () => {
      const eDenied = normalizeSpeechError("not-allowed");
      assert.equal(eDenied.code, "not-allowed");
      assert.equal(eDenied.shouldOpenSettings, true);

      const eAudio = normalizeSpeechError("audio-capture");
      assert.equal(eAudio.code, "audio-capture");
      assert.equal(eAudio.shouldOpenSettings, true);

      const eNoSpeech = normalizeSpeechError("no-speech");
      assert.equal(eNoSpeech.code, "no-speech");
      assert.equal(eNoSpeech.shouldOpenSettings, false);

      const eLang = normalizeSpeechError("language-not-supported");
      assert.equal(eLang.code, "language-not-supported");
    });

    it("accumulates interim transcripts and flushes cleanly once on stop/onend", () => {
      const acc = createSpeechTranscriptAccumulator();
      const step1 = acc.ingestResults([{ isFinal: false, 0: { transcript: "قيد صرف" } }]);
      assert.equal(step1.combined, "قيد صرف");

      const step2 = acc.ingestResults([
        { isFinal: true, 0: { transcript: "قيد صرف وقود" } },
        { isFinal: false, 0: { transcript: "بمبلغ خمسين ألف" } },
      ]);
      assert.equal(step2.combined, "قيد صرف وقود بمبلغ خمسين ألف");

      const flushed = acc.flushOnStop();
      assert.equal(flushed, "قيد صرف وقود بمبلغ خمسين ألف");
      assert.equal(acc.flushOnStop(), "", "Subsequent flush must not duplicate committed transcript");
    });
  });

  describe("2. Unified Transport Resolver & Resilient Backoff Fetch", () => {
    it("resolves Cloud (<slug>.qat.world), Office LAN, and Local modes cleanly", () => {
      const cloudStorage = createMemoryStorage({
        uas_runtime_mode: "cloud",
        uas_tenant_id: "al-jabri",
      });
      const cloudTarget = resolveTransportTarget({ storage: cloudStorage });
      assert.equal(cloudTarget.mode, "cloud");
      assert.equal(cloudTarget.baseUrl, "https://al-jabri.qat.world");
      assert.equal(cloudTarget.tenantSlug, "al-jabri");

      const lanStorage = createMemoryStorage({
        uas_runtime_mode: "lan",
        uas_lan_server_url: "http://192.168.1.88:3000",
      });
      const lanTarget = resolveTransportTarget({ storage: lanStorage });
      assert.equal(lanTarget.mode, "lan");
      assert.equal(lanTarget.baseUrl, "http://192.168.1.88:3000");

      const localStorage = createMemoryStorage({ uas_runtime_mode: "local" });
      const localTarget = resolveTransportTarget({ storage: localStorage });
      assert.equal(localTarget.mode, "local");
      assert.equal(localTarget.baseUrl, "");
    });

    it("retries transient 502/503/504 with exponential backoff + jitter and never retries 4xx or un-keyed mutations", async () => {
      const b0 = computeBackoffWithJitterMs(0, 100, 1000, () => 0.5);
      const b1 = computeBackoffWithJitterMs(1, 100, 1000, () => 0.5);
      assert.ok(b1 > b0);

      // 1. Retries 503 then succeeds on attempt 2
      let calls = 0;
      const sleeps: number[] = [];
      const resOk = await resilientFetch(
        "https://al-jabri.qat.world/api/bootstrap",
        { method: "GET" },
        {
          maxRetries: 2,
          baseBackoffMs: 50,
          randomFn: () => 0.5,
          sleepFn: async (ms) => {
            sleeps.push(ms);
          },
          fetchImpl: async () => {
            calls++;
            if (calls < 3) return new Response("Bad Gateway", { status: 502 });
            return new Response(JSON.stringify({ ok: true }), { status: 200 });
          },
        }
      );
      assert.equal(resOk.status, 200);
      assert.equal(calls, 3);
      assert.equal(sleeps.length, 2);

      // 2. Never retries 403 Forbidden
      let calls403 = 0;
      const res403 = await resilientFetch(
        "https://al-jabri.qat.world/api/devices",
        { method: "GET" },
        {
          maxRetries: 2,
          sleepFn: async () => {},
          fetchImpl: async () => {
            calls403++;
            return new Response("Revoked", { status: 403 });
          },
        }
      );
      assert.equal(res403.status, 403);
      assert.equal(calls403, 1);

      // 3. Mutating POST without X-Idempotency-Key does not retry on 503; with key it does
      let unkeyedCalls = 0;
      await resilientFetch(
        "https://al-jabri.qat.world/api/expenses",
        { method: "POST", body: "{}" },
        {
          maxRetries: 2,
          sleepFn: async () => {},
          fetchImpl: async () => {
            unkeyedCalls++;
            return new Response("Unavailable", { status: 503 });
          },
        }
      );
      assert.equal(unkeyedCalls, 1);

      let keyedCalls = 0;
      const resKeyed = await resilientFetch(
        "https://al-jabri.qat.world/api/expenses",
        {
          method: "POST",
          headers: { "X-Idempotency-Key": "idem-123" },
          body: "{}",
        },
        {
          maxRetries: 2,
          sleepFn: async () => {},
          fetchImpl: async () => {
            keyedCalls++;
            if (keyedCalls === 1) return new Response("Unavailable", { status: 503 });
            return new Response("{}", { status: 201 });
          },
        }
      );
      assert.equal(resKeyed.status, 201);
      assert.equal(keyedCalls, 2);
    });
  });

  describe("3. AI Copilot Document & Image Extraction + Safe Posting Validation", () => {
    it("extracts structured bilingual purchase bills and sales invoices into balanced GL drafts", () => {
      const billDraft = parseDocumentTextDeterministically({
        fileName: "vendor-bill-2026.pdf",
        mimeType: "application/pdf",
        textContent: `
          فاتورة مشتريات
          المورد: مؤسسة النور للتوريدات الزراعية
          رقم الفاتورة: BILL-2026-441
          التاريخ: 2026-11-18
          طريقة الدفع: آجل
          العملة: YER
          المبلغ قبل الضريبة: 100000
          الضريبة: 5000
          الإجمالي: 105000
        `,
      });

      assert.equal(billDraft.documentType, "PURCHASE_BILL");
      assert.equal(billDraft.partyName, "مؤسسة النور للتوريدات الزراعية");
      assert.equal(billDraft.reference, "BILL-2026-441");
      assert.equal(billDraft.date, "2026-11-18");
      assert.equal(billDraft.paymentMethod, "CREDIT");
      assert.equal(billDraft.totalAmount, 105000);
      assert.ok(billDraft.lines.length >= 2);
      const totalDr = billDraft.lines.reduce((s, l) => s + l.debit, 0);
      const totalCr = billDraft.lines.reduce((s, l) => s + l.credit, 0);
      assert.equal(totalDr, 105000);
      assert.equal(totalCr, 105000);
      assert.equal(
        billDraft.warnings.filter((w) => w.severity === "error").length,
        0,
        "Balanced complete bill should have zero blocking errors"
      );
    });

    it("surfaces validation warnings for unbalanced lines, missing party, duplicate reference, and locked fiscal periods", () => {
      const draft = parseDocumentTextDeterministically({
        fileName: "receipt.png",
        mimeType: "image/png",
        textContent: "Total: 50000 USD Date: 2026-01-10 Ref: INV-DUP-01",
        validationContext: {
          periodLockDate: "2026-06-30",
          existingReferences: ["INV-DUP-01"],
        },
      });

      // Intentionally unbalance lines
      draft.lines[0].debit = 40000;
      const warnings = validateExtractedDraft(draft, {
        periodLockDate: "2026-06-30",
        existingReferences: ["INV-DUP-01"],
      });

      const codes = new Set(warnings.map((w) => w.code));
      assert.ok(codes.has("MISSING_FIELD"));
      assert.ok(codes.has("UNBALANCED"));
      assert.ok(codes.has("DUPLICATE_SUSPECTED"));
      assert.ok(codes.has("FISCAL_PERIOD_LOCKED"));
    });
  });
});
