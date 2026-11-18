import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getAllSupportSections,
  getSupportChapterByNumber,
  UAS_SUPPORT_CHAPTERS,
} from "../src/lib/uasSupportKnowledge";
import {
  answerSupportQuery,
  detectSupportLanguage,
  diagnoseLiveSystemState,
  extractArabicRoot,
  normalizeSupportText,
  searchSupportKnowledge,
} from "../src/lib/localSupportEngine";

describe("Phase 3 — Bilingual Customer Service Knowledge Base (src/lib/uasSupportKnowledge.ts)", () => {
  it("contains all 7 required Arabic + English user manual chapters with structured steps", () => {
    assert.equal(UAS_SUPPORT_CHAPTERS.length, 7);
    for (let num = 1; num <= 7; num++) {
      const ch = getSupportChapterByNumber(num);
      assert.ok(ch, `Chapter ${num} must exist`);
      assert.ok(ch.titleAr.length > 5 && ch.titleEn.length > 5);
      assert.ok(ch.sections.length >= 1, `Chapter ${num} must have sections`);
      for (const sec of ch.sections) {
        assert.ok(sec.contentAr.length > 40, `Section ${sec.id} Arabic content must be comprehensive`);
        assert.ok(sec.contentEn.length > 40, `Section ${sec.id} English content must be comprehensive`);
        assert.ok(sec.stepsAr.length >= 2, `Section ${sec.id} must have Arabic steps`);
        assert.ok(sec.stepsEn.length >= 2, `Section ${sec.id} must have English steps`);
        assert.ok(sec.keywordsAr.length >= 3 && sec.keywordsEn.length >= 3);
      }
    }
    assert.ok(getAllSupportSections().length >= 12);
  });
});

describe("Phase 3 — Weighted Bilingual BM25 + Arabic Root Retrieval Engine (100% Offline)", () => {
  it("normalizes Arabic variants and extracts shared roots for broken plurals", () => {
    assert.equal(normalizeSupportText("إلغاءُ رَبْطِ الأَجْهِزَةِ"), "الغاء ربط الاجهزه");
    assert.equal(extractArabicRoot("تراخيص"), extractArabicRoot("الترخيص"));
    assert.equal(extractArabicRoot("مقاعد"), extractArabicRoot("مقعد"));
    assert.equal(extractArabicRoot("فواتير"), extractArabicRoot("فاتوره"));
    assert.equal(detectSupportLanguage("كيف ألغي ربط جهاز مفقود؟"), "ar");
    assert.equal(detectSupportLanguage("How do I release a device seat?"), "en");
  });

  it("retrieves accurate manual sections for Arabic queries across all 7 chapters", () => {
    const q1 = searchSupportKnowledge("كيف أضيف مستخدم جديد وأخصص صلاحيات المدقق المالي؟");
    assert.ok(q1.length > 0);
    assert.equal(q1[0].section.chapterNumber, 1);

    const q2 = searchSupportKnowledge("لماذا يظهر خطأ اسم المنشأة لا يطابق الترخيص المعتمد؟");
    assert.ok(q2.length > 0);
    assert.equal(q2[0].section.id, "ch2-sec1-company-lock");

    const q2b = searchSupportKnowledge("كيف أقوم بإلغاء ربط جهاز مفقود بعد وصول 7 مستخدمين؟");
    assert.ok(q2b.length > 0);
    assert.equal(q2b[0].section.id, "ch2-sec2-seat-quota-release");

    const q3 = searchSupportKnowledge("تشغيل خادم الشبكة المحلية 0.0.0.0:3000 وربط هواتف أندرويد بالواي فاي");
    assert.ok(q3.length > 0);
    assert.equal(q3[0].section.chapterNumber, 3);

    const q4 = searchSupportKnowledge("قيد يومية غير متوازن المدين لا يساوي الدائن في شجرة الحسابات");
    assert.ok(q4.length > 0);
    assert.equal(q4[0].section.chapterNumber, 4);

    const q5 = searchSupportKnowledge("إصدار سند قبض وسند صرف وربطها بمركز التكلفة والقطفة");
    assert.ok(q5.length > 0);
    assert.equal(q5[0].section.chapterNumber, 5);

    const q6 = searchSupportKnowledge("التحقق من صحة الفاتورة عبر رمز QR وفحص كمية المخزون");
    assert.ok(q6.length > 0);
    assert.equal(q6[0].section.chapterNumber, 6);

    const q7 = searchSupportKnowledge("استخراج ميزان المراجعة وقائمة الدخل والنسخ الاحتياطي لقاعدة بيانات SQLite");
    assert.ok(q7.length > 0);
    assert.equal(q7[0].section.chapterNumber, 7);
  });

  it("retrieves accurate manual sections for English queries across all 7 chapters", () => {
    const e1 = searchSupportKnowledge("How do RBAC roles and EXTERNAL_AUDITOR read-only permissions work?");
    assert.ok(e1.length > 0);
    assert.equal(e1[0].section.chapterNumber, 1);

    const e2 = searchSupportKnowledge("How can SUPER_ADMIN release a lost laptop or Android device seat when 7 users are full?");
    assert.ok(e2.length > 0);
    assert.equal(e2[0].section.id, "ch2-sec2-seat-quota-release");

    const e3 = searchSupportKnowledge("Switch runtime mode to Office LAN server 0.0.0.0:3000 or Cloud qat.world");
    assert.ok(e3.length > 0);
    assert.equal(e3[0].section.chapterNumber, 3);

    const e4 = searchSupportKnowledge("5-level Chart of Accounts leaf posting account and balanced debit credit journal entry");
    assert.ok(e4.length > 0);
    assert.equal(e4[0].section.chapterNumber, 4);

    const e7 = searchSupportKnowledge("Export Trial Balance, Income Statement, Balance Sheet and backup SQLite C:\\UAS-Data");
    assert.ok(e7.length > 0);
    assert.equal(e7[0].section.chapterNumber, 7);
  });
});

describe("Phase 3 — Live Offline System Diagnostics & Support Chat Engine", () => {
  it("diagnoses live Company Name Mismatch in Arabic and English with actionable steps", () => {
    const resAr = answerSupportQuery("لماذا يرفض النظام التفعيل ويظهر اسم المنشأة لا يطابق الترخيص؟", {
      diagnostics: {
        license_status: "COMPANY_MISMATCH",
        is_valid: false,
        company_name: "شركة الجابري للتجارة",
        enterprise_name_ar: "شركة العامري",
        company_locked: true,
        company_matches: false,
        seat_managed: true,
        used_users: 2,
        max_users: 7,
        windows_bound: 2,
        android_bound: 1,
        active_mode: "local",
      },
    });

    assert.equal(resAr.lang, "ar");
    assert.equal(resAr.diagnosticReport.healthy, false);
    assert.equal(resAr.diagnosticReport.statusBadge, "COMPANY_MISMATCH");
    assert.match(resAr.answer, /شركة الجابري للتجارة/);
    assert.match(resAr.answer, /شركة العامري/);
    assert.ok(resAr.suggestedActions.some((a) => a.type === "open_license_modal"));
  });

  it("diagnoses 7 / 7 full seat usage and guides SUPER_ADMIN to Release Device Seat", () => {
    const resEn = answerSupportQuery("Why is the 8th user blocked from activating their phone?", {
      lang: "en",
      diagnostics: {
        license_status: "ACTIVE",
        is_valid: true,
        company_name: "Al-Jabri Trading",
        company_locked: true,
        company_matches: true,
        seat_managed: true,
        used_users: 7,
        max_users: 7,
        per_user_devices: { windows: 1, android: 1 },
        windows_bound: 7,
        android_bound: 6,
        active_mode: "lan",
        lan_url: "http://192.168.1.25:3000",
        remaining_days: 340,
      },
    });

    assert.equal(resEn.lang, "en");
    assert.match(resEn.answer, /7 \/ 7 Users/);
    assert.match(resEn.answer, /Release Device Seat/);
    assert.match(resEn.answer, /192\.168\.1\.25:3000/);
  });

  it("collects live diagnostics from local SQLite via collectServerSupportDiagnostics", async () => {
    const { collectServerSupportDiagnostics } = await import("../src/lib/supportDiagnosticsServer");
    const live = await collectServerSupportDiagnostics();

    assert.ok(live.active_mode === "local" || live.active_mode === "lan" || live.active_mode === "cloud");
    assert.equal(typeof live.max_users, "number");
    assert.equal(typeof live.used_users, "number");
    const report = diagnoseLiveSystemState(live);
    assert.ok(report.findingsAr.length >= 2 && report.findingsEn.length >= 2);
  });
});
