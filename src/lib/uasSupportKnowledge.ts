/**
 * UAS Enterprise — Embedded Offline-Capable Bilingual (Arabic / English) Customer Service
 * Knowledge Base & Interactive User Manual.
 *
 * Zero Node-only dependencies — safe for server routes, desktop runtime, and Capacitor Android APK.
 */
import type { TabId } from "@/types/uas";

export interface SupportManualSection {
  id: string;
  chapterNumber: number;
  chapterId: string;
  titleAr: string;
  titleEn: string;
  summaryAr: string;
  summaryEn: string;
  contentAr: string;
  contentEn: string;
  stepsAr: string[];
  stepsEn: string[];
  troubleshootingAr?: string[];
  troubleshootingEn?: string[];
  keywordsAr: string[];
  keywordsEn: string[];
  targetTab?: TabId;
  relatedAction?: "open_license_modal" | "navigate_tab" | "run_diagnostics";
}

export interface SupportChapter {
  chapterNumber: number;
  id: string;
  titleAr: string;
  titleEn: string;
  descriptionAr: string;
  descriptionEn: string;
  icon: string;
  targetTab?: TabId;
  sections: SupportManualSection[];
}

export const UAS_SUPPORT_CHAPTERS: SupportChapter[] = [
  // =========================================================================
  // CHAPTER 1: First-Time Setup, Login & RBAC Permissions
  // =========================================================================
  {
    chapterNumber: 1,
    id: "ch1-setup-auth-rbac",
    titleAr: "1. التهيئة الأولى، تسجيل الدخول وصلاحيات المستخدمين (RBAC)",
    titleEn: "1. First-Time Setup, Login & RBAC Permissions",
    descriptionAr:
      "دليل التشغيل الأولي بقاعدة البداية الصفرية، تسجيل الدخول، وإدارة الأدوار السبعة والصلاحيات المخصصة.",
    descriptionEn:
      "Zero-transaction baseline onboarding, authentication, and managing the 7 enterprise RBAC roles and custom overrides.",
    icon: "ShieldCheck",
    targetTab: "system",
    sections: [
      {
        id: "ch1-sec1-first-time-setup",
        chapterNumber: 1,
        chapterId: "ch1-setup-auth-rbac",
        titleAr: "التهيئة الذاتية ووضع البداية الصفرية (Zero-Transaction Baseline)",
        titleEn: "Self-Healing Bootstrap & Zero-Transaction Baseline",
        summaryAr:
          "يبدأ النظام بقاعدة بيانات نظيفة خالية من العمليات الوهمية ومزودة بشجرة حسابات قياسية والصندوق الرئيسي.",
        summaryEn:
          "The system boots with a clean zero-transaction SQLite database seeded with the standard COA, main cash vault (0.00), and default admin.",
        contentAr:
          "عند تثبيت منظومة UAS لأول مرة على ويندوز (C:\\UAS-Data) أو تشغيلها، يقوم محرك التهيئة الذاتية (Pure-Runtime Self-Healing SQLite Bootstrap) بإنشاء الجداول الـ 35 تلقائياً من template.db دون الحاجة لأي أدوات خارجية، مع تهيئة شجرة الحسابات القياسية، الصندوق النقدي الرئيسي برصيد 0.00، وأسعار الصرف الافتراضية (YER, SAR, USD).",
        contentEn:
          "On first launch on Windows (C:\\UAS-Data) or standalone mode, the pure-runtime self-healing SQLite bootstrap initializes all 35 tables automatically from template.db with zero external CLI dependencies, seeding the standard Chart of Accounts, Main Cash Vault (0.00 balance), and baseline currency rates (YER, SAR, USD).",
        stepsAr: [
          "قم بتشغيل تطبيق سطح المكتب UAS أو فتح المتصفح على العنوان المحلي http://127.0.0.1:3000.",
          "تأكد من تفعيل الترخيص المؤسسي لربط اسم المنشأة تلقائياً بملف التعريف (EnterpriseProfile).",
          "سجل الدخول بحساب مدير النظام العام (SUPER_ADMIN) لتعيين كلمة المرور وإعداد بيانات المؤسسة والضريبة.",
          "انتقل إلى تبويب (إدارة النظام والأمان) لإضافة المستخدمين وتوزيع الأدوار والمشاريع.",
        ],
        stepsEn: [
          "Launch the UAS desktop application or open http://127.0.0.1:3000 in your browser.",
          "Activate your company-locked license so EnterpriseProfile automatically adopts your licensed organization name.",
          "Sign in with the SUPER_ADMIN account to update your password and configure tax/commercial registry details.",
          "Open the System & Security tab to create user accounts and assign roles and projects.",
        ],
        keywordsAr: [
          "تهيئة",
          "تثبيت",
          "بداية صفرية",
          "تشغيل أول مرة",
          "تسجيل دخول",
          "كلمة المرور",
          "مدير النظام",
          "قاعدة البيانات",
        ],
        keywordsEn: [
          "setup",
          "install",
          "first time",
          "zero baseline",
          "login",
          "sign in",
          "password",
          "bootstrap",
          "initial",
        ],
        targetTab: "system",
        relatedAction: "navigate_tab",
      },
      {
        id: "ch1-sec2-rbac-roles",
        chapterNumber: 1,
        chapterId: "ch1-setup-auth-rbac",
        titleAr: "مصفوفة الصلاحيات والأدوار السبعة (7 RBAC Roles)",
        titleEn: "The 7 Enterprise RBAC Roles & Custom Permission Overrides",
        summaryAr:
          "توزيع الصلاحيات بين مدير النظام، مدير المشاريع، رئيس الحسابات، المحاسب الميداني، المشتريات، المبيعات، والمدقق الخارجي.",
        summaryEn:
          "Granular role-based access control across SUPER_ADMIN, PROJECT_MANAGER, CHIEF_ACCOUNTANT, FIELD_ACCOUNTANT, PROCUREMENT_OFFICER, SALES_COLLECTOR, and EXTERNAL_AUDITOR.",
        contentAr:
          "تعتمد منظومة UAS سبعة أدوار وظيفية محكمة:\n1. مدير النظام العام (SUPER_ADMIN): صلاحية كاملة، إدارة المستخدمين، الهوية المؤسسية CMS، وإلغاء ربط مقاعد أجهزة الترخيص.\n2. مدير المشاريع (PROJECT_MANAGER): إدارة المشاريع، المشاريع الفرعية، مواسم الحصاد/القطفات، واعتماد العمليات.\n3. رئيس الحسابات (CHIEF_ACCOUNTANT): إدارة شجرة الحسابات، ترحيل وعكس القيود اليومية، إقفال الفترات، والتقارير الختامية.\n4. المحاسب الميداني (FIELD_ACCOUNTANT): تسجيل المصروفات، أجور العمال، والعمليات اليومية للمشاريع المسندة إليه.\n5. مسؤول المشتريات (PROCUREMENT_OFFICER): إدارة الموردين، أوامر الشراء، استلام البضائع، وفواتير الموردين.\n6. محصل المبيعات (SALES_COLLECTOR): إدارة العملاء، فواتير المبيعات الفورية والآجلة، وسندات القبض والأقساط.\n7. المدقق المالي الخارجي (EXTERNAL_AUDITOR): صلاحية قراءة فقط (Read-Only) لمراجعة الدفاتر وسجل التدقيق غير القابل للتعديل دون أي صلاحية إضافة أو تعديل.",
        contentEn:
          "UAS enforces 7 enterprise RBAC roles:\n1. SUPER_ADMIN: Full system control, user & role administration, Enterprise CMS branding, and releasing device license seats.\n2. PROJECT_MANAGER: Manages projects, sub-projects, harvest cycles, and operational approvals.\n3. CHIEF_ACCOUNTANT: Manages the Chart of Accounts, posts/reverses journal entries, locks accounting periods, and audits financial statements.\n4. FIELD_ACCOUNTANT: Records operating expenses, worker wages, and daily transactions for assigned projects.\n5. PROCUREMENT_OFFICER: Manages vendors, purchase orders, goods receipts, and vendor bills.\n6. SALES_COLLECTOR: Manages customers, concurrent sales invoices, receipt vouchers, and installment collections.\n7. EXTERNAL_AUDITOR: Strict Read-Only access to inspect ledgers, reports, and the immutable SHA-256 audit log.",
        stepsAr: [
          "لتخصيص صلاحيات مستخدم معين، افتح (إدارة النظام) > (المستخدمون والصلاحيات).",
          "فعّل خيار (استخدام صلاحيات مخصصة Use Custom Permissions) لتحديد المجموعات المسموحة أو صلاحيات الإضافة/التعديل/الترحيل بدقة.",
          "يمكن تقييد وصول المحاسب أو المحصل بمشاريع محددة عبر حقل (المشاريع المسندة Assigned Projects).",
        ],
        stepsEn: [
          "To customize a user's permissions, navigate to System > Users & Permissions.",
          "Enable 'Use Custom Permissions' to toggle specific module groups or granular flags (create, edit, post, approve, treasury).",
          "Restrict row-level access to specific projects using the 'Assigned Projects' selector.",
        ],
        keywordsAr: [
          "صلاحيات",
          "أدوار",
          "مستخدمين",
          "مدير النظام",
          "رئيس الحسابات",
          "محاسب ميداني",
          "مدقق خارجي",
          "قراءة فقط",
          "مشتريات",
          "مبيعات",
          "حساب موقوف",
        ],
        keywordsEn: [
          "rbac",
          "roles",
          "permissions",
          "users",
          "super_admin",
          "chief_accountant",
          "external_auditor",
          "read only",
          "access denied",
          "forbidden",
        ],
        targetTab: "system",
        relatedAction: "navigate_tab",
      },
      {
        id: "ch1-sec3-admin-password-recovery",
        chapterNumber: 1,
        chapterId: "ch1-setup-auth-rbac",
        titleAr: "استعادة كلمة مرور مدير النظام العام (SUPER_ADMIN Password Recovery)",
        titleEn: "SUPER_ADMIN Password Recovery via License & Local CLI",
        summaryAr:
          "استعادة كلمة مرور مدير النظام بأمان تام عبر إثبات ملكية الترخيص الرقمي واسم المنشأة دون إنترنت، أو عبر أداة CLI المحلية.",
        summaryEn:
          "Recover the SUPER_ADMIN password securely offline via cryptographic proof of license ownership (license.uas / UASKEY) or local CLI script.",
        contentAr:
          "لتفادي إغلاق النظام وفقدان الوصول الإداري، يوفر نظام UAS طريقتين رسميتين لاستعادة كلمة مرور مدير النظام العام (SUPER_ADMIN):\n1. الاستعادة من شاشة تسجيل الدخول (Login Screen): اضغط على رابط (نسيت كلمة مرور مدير النظام؟) ثم ارفع ملف الترخيص الرقمي (license.uas) أو الصق رمز (UASKEY-...) وأدخل اسم المنشأة المرخصة بالضبط وكلمة المرور الجديدة. يتحقق النظام تشفيرياً عبر توقيع Ed25519 ومطابقة اسم المنشأة، ويعيد تفعيل الحساب فوراً ويسجل العملية في سجل التدقيق غير القابل للتعديل.\n2. أداة CLI المحلية للطوارئ (Local CLI Script): في خادم الويندوز، افتح سطر الأوامر (PowerShell / CMD) ونفّذ الأمر:\nnode scripts/reset-admin-password.mjs --db \"C:\\UAS-Data\\uas-enterprise.db\" --password \"<كلمة_المرور_الجديدة>\"\nيتم تحديث كلمة المرور وتفعيل الحساب مباشرة.",
        contentEn:
          "To guarantee business continuity without lockouts, UAS provides two authoritative methods to recover the SUPER_ADMIN password:\n1. Login Screen Recovery Modal: Click 'Forgot Admin Password?' on the sign-in screen, upload your signed license.uas file (or paste UASKEY token), enter your exact licensed Company Name, and provide the new password. The system cryptographically verifies Ed25519 ownership, validates company matching, updates the password, and writes an immutable audit record.\n2. Local Emergency CLI Script: On the Windows server host, execute:\nnode scripts/reset-admin-password.mjs --db \"C:\\UAS-Data\\uas-enterprise.db\" --password \"<NewPassword>\"\nThe CLI directly updates the SUPER_ADMIN password and activates the user.",
        stepsAr: [
          "في شاشة تسجيل الدخول: اضغط على رابط (نسيت كلمة مرور مدير النظام؟).",
          "أدخل اسم المنشأة المرخصة تماماً كما هو مسجل في الترخيص.",
          "ارفع ملف license.uas أو الصق رمز المفتاح UASKEY-...",
          "أدخل كلمة المرور الجديدة (6 أحرف على الأقل) واضغط (استعادة وتعيين كلمة المرور).",
          "للاستعادة عبر سطر الأوامر: شغّل node scripts/reset-admin-password.mjs --password <كلمة_المرور>.",
        ],
        stepsEn: [
          "On the login screen: click 'Forgot Admin Password?'.",
          "Enter your licensed organization name exactly as licensed.",
          "Upload your signed license.uas file or paste your UASKEY serial token.",
          "Enter your new password (at least 6 characters) and click 'Recover & Reset'.",
          "Via server CLI: run `node scripts/reset-admin-password.mjs --password <newPassword>`.",
        ],
        keywordsAr: [
          "نسيت كلمة المرور",
          "استعادة كلمة المرور",
          "مدير النظام",
          "super_admin",
          "license.uas",
          "uaskey",
          "إثبات ملكية",
          "reset-admin-password",
          "طوارئ",
        ],
        keywordsEn: [
          "forgot password",
          "password recovery",
          "recover admin",
          "super_admin",
          "license.uas",
          "uaskey",
          "proof of ownership",
          "reset-admin-password",
          "cli reset",
        ],
        targetTab: "system",
        relatedAction: "navigate_tab",
      },
      {
        id: "ch1-sec4-workspace-drafts",
        chapterNumber: 1,
        chapterId: "ch1-setup-auth-rbac",
        titleAr: "مركز مسودات العمل المشتركة (Shared Workspace Drafts - حفظ كمسودة)",
        titleEn: "Shared Workspace Drafts ('Save as Draft') & Team Collaboration",
        summaryAr:
          "حفظ النماذج المعقدة (فواتير، قيود، سندات) كمسودات دون التأثير على دفتر الأستاذ أو المخزون مع إمكانية مشاركتها بين أعضاء الفريق وترقيتها لاحقاً.",
        summaryEn:
          "Save in-progress forms and subforms as drafts without affecting the General Ledger or inventory balances, with collaborative team sharing and one-click promotion.",
        contentAr:
          "يتيح زر (حفظ كمسودة) في كافة نماذج النظام حفظ البيانات قيد الإعداد بأمان تام:\n• عزل مالي كامل: لا يؤثر حفظ المسودة مطلقاً على أرصدة شجرة الحسابات أو حركات المخزون.\n• المشاركة بين الزملاء (SHARED_WORKSPACE): تظهر المسودة في مركز المسودات لكافة المستخدمين المصرح لهم للتعاون والمراجعة المشتركة، مع دعم المسودات الخاصة (PRIVATE).\n• الترقية للاعتماد (Promotion): بعد استكمال البيانات، يمكن للمستخدم المخول ترقية المسودة فورياً إلى قيد يومية أو فاتورة معتمدة لتتحول حالة المسودة إلى (CONVERTED).\n• الحذف الآمن للمسودة: يمكن لمسؤولي النظام ومحرري النماذج حذف المسودات غير المرغوبة بسهولة دون أي بقايا محاسبية.",
        contentEn:
          "The universal 'Save as Draft' capability provides frictionless collaboration across all financial forms:\n• Zero Financial Side-Effects: Drafts never alter GL account balances, inventory stock, or audit totals.\n• Shared Team Visibility: Collaborative drafts (SHARED_WORKSPACE) appear in the Top Bar Drafts Center for authorized colleagues to review and edit together.\n• Atomic Promotion: When finalized, clicking 'Promote Draft' atomically converts the draft into a posted GL entry or invoice, marking the draft CONVERTED.\n• Clean Deletion: Obsolete drafts can be cleanly discarded at any time.",
        stepsAr: [
          "في أي نموذج (قيد يومية، فاتورة مبيعات، مصروف، إلخ)، أدخل البيانات المتاحة واضغط (حفظ كمسودة).",
          "افتح (مركز المسودات) من الشريط العلوي بالنقر على شارة المسودات للاطلاع على مسوداتك ومسودات الزملاء.",
          "اضغط على أي مسودة لتحميلها واستكمالها ثم اضغط (ترقية واعتماد القيد).",
        ],
        stepsEn: [
          "On any transaction form, enter preliminary details and click 'Save as Draft'.",
          "Click the Drafts badge in the Top Command Bar to open the Shared Drafts Center drawer.",
          "Select any draft to reload its inputs, make adjustments, and click 'Promote to Live Transaction'.",
        ],
        keywordsAr: [
          "مسودة",
          "حفظ كمسودة",
          "مسودات مشتركة",
          "مركز المسودات",
          "ترقية مسودة",
          "قيد معلق",
        ],
        keywordsEn: [
          "draft",
          "workspace draft",
          "save as draft",
          "drafts center",
          "promote draft",
          "collaboration",
        ],
        targetTab: "dashboard",
        relatedAction: "navigate_tab",
      },
      {
        id: "ch1-sec5-approval-queues",
        chapterNumber: 1,
        chapterId: "ch1-setup-auth-rbac",
        titleAr: "مركز الاعتمادات والمراجعة والتعديلات المحكومة (Approval Queues & Amendments)",
        titleEn: "Approval Queues, Threshold Rules & Controlled Post-Posting Amendments",
        summaryAr:
          "حوكمة مالية صارمة تحجز العمليات التي تتجاوز سقفاً مالياً محدداً أو تتطلب اعتماداً إدارياً في حالة (PENDING_APPROVAL) وتدير التعديلات بتوثيق كامل للفرق (Before/After Diff).",
        summaryEn:
          "Multi-level approval engine holding high-value postings in PENDING_APPROVAL with self-approval prevention, Before/After audit diffs, and controlled post-posting amendments.",
        contentAr:
          "يوفر محرك الاعتمادات حوكمة مؤسسية تمنع أي تجاوز مالي:\n• مصفوفة قواعد الاعتماد (ApprovalRule): تحديد شروط الحجز وفق القسم، نوع الإجراء، وسقف المبلغ المالي (minAmountBase) مع تعيين الدور المشترط للاعتماد (مثل CHIEF_ACCOUNTANT أو SUPER_ADMIN).\n• منع الاعتماد الذاتي (No Self-Approval): لا يمكن لمنشئ المعاملة اعتماد طلبه بنفسه تحت أي ظرف.\n• التعديلات المحكومة بعد الترحيل: عند تعديل أي سجل مرحل مسبقاً، يحفظ النظام لقطة ما قبل التعديل وما بعده، ويحسب الفروق حقلاً بحقل، ويزيد رقم المراجعة (revisionNumber) مع توثيق الأسباب في سجل الرقابة.\n• قرارات الاعتماد: يملك المعتمد خيار الاعتماد (APPROVED) للترحيل المباشر، أو الرفض (REJECTED)، أو الإرجاع للتعديل (RETURNED_FOR_EDIT) الذي يعيد العملية كمسودة للمنشئ.",
        contentEn:
          "The UAS Approval & Governance Engine ensures multi-layered financial compliance:\n• Threshold Matrix (ApprovalRule): Configure approval rules based on module, action type, and base amount thresholds (minAmountBase) with designated required roles.\n• Strict Anti-Self-Approval: The creator of a transaction can never approve their own submission.\n• Controlled Post-Posting Amendments: Editing already-posted records captures before/after snapshots, generates an immutable diff, and increments revisionNumber upon approval.\n• Multi-Option Decisions: Approvers can Approve, Reject, or Return for Edit (RETURNED_FOR_EDIT) which safely converts the transaction into an editable workspace draft.",
        stepsAr: [
          "عند ترحيل عملية تتجاوز سقف الاعتماد، تُحجز العملية بحالة (بانتظار الاعتماد PENDING_APPROVAL).",
          "يفتح رئيس الحسابات أو مدير النظام (مركز الاعتمادات والمراجعة) من الشريط العلوي.",
          "يراجع المعتمد جدول الفروق وقيم العملية، ثم يضغط (موافقة واعتماد) أو (إرجاع للتعديل مع ذكر السبب).",
        ],
        stepsEn: [
          "Submissions exceeding configured thresholds automatically transition to PENDING_APPROVAL.",
          "Authorized approvers click the Approvals badge in the Top Command Bar to open the Approvals Center.",
          "Review transaction details and before/after diffs, then choose 'Approve', 'Reject', or 'Return for Edit'.",
        ],
        keywordsAr: [
          "اعتماد",
          "مركز الاعتمادات",
          "موافقة",
          "بانتظار الاعتماد",
          "تعديل بعد الترحيل",
          "رفض",
          "إرجاع للتعديل",
          "حوكمة",
        ],
        keywordsEn: [
          "approval",
          "approval request",
          "approval rule",
          "pending approval",
          "amendment",
          "governance",
          "threshold",
          "return for edit",
        ],
        targetTab: "dashboard",
        relatedAction: "navigate_tab",
      },
    ],
  },

  // =========================================================================
  // CHAPTER 2: Company-Locked 7-User Licensing & Seat Management
  // =========================================================================
  {
    chapterNumber: 2,
    id: "ch2-licensing-seats",
    titleAr: "2. الترخيص المشفر المقيد باسم المنشأة وإدارة المقاعد (7 مستخدمين)",
    titleEn: "2. Company-Locked 7-User Ed25519 Licensing & Seat Management",
    descriptionAr:
      "آلية التفعيل الرقمي Ed25519، قفل اسم المنشأة، إدارة حصة 7 مستخدمين × (1 ويندوز + 1 أندرويد)، وإلغاء ربط الأجهزة المفقودة.",
    descriptionEn:
      "Ed25519 cryptographic activation, strict company-name locking, 7 Users × (1 Windows + 1 Android) seat quotas, and releasing lost/replaced device seats.",
    icon: "KeyRound",
    targetTab: "system",
    sections: [
      {
        id: "ch2-sec1-company-lock",
        chapterNumber: 2,
        chapterId: "ch2-licensing-seats",
        titleAr: "قفل اسم المنشأة وحل خطأ عدم تطابق اسم المنشأة (Company Name Lock)",
        titleEn: "Strict Company-Name Lock & Resolving Company Name Mismatch Errors",
        summaryAr:
          "يرتبط الترخيص cryptographically باسم المنشأة المعتمد، ويمنع التفعيل أو تغيير الاسم إلى منشأة مخالفة.",
        summaryEn:
          "Each v2 license is cryptographically signed with company_name, locking EnterpriseProfile (legalNameAr/legalNameEn) to prevent unauthorized company reuse.",
        contentAr:
          "يحتوي ملف الترخيص (.uas) ومفتاح التفعيل (UASKEY-...) على حقل اسم المنشأة (company_name) موقعاً رقمياً بخوارزمية Ed25519:\n• عند التفعيل لأول مرة على نظام جديد (حيث EnterpriseProfile غير مهيأ بعد)، يقوم النظام تلقائياً باعتماد اسم المنشأة من الترخيص في الاسم القانوني (legalNameAr و legalNameEn).\n• يقوم محرك التطبيع (normalizeCompanyName) بتوحيد الحروف العربية (أ/إ/آ -> ا، ة -> ه، ى -> ي) والمسافات وحالة الأحرف اللاتينية لتجنب الأخطاء الإملائية البسيطة.\n• إذا كان النظام مهيأً مسبقاً لمنشأة أخرى لا تطابق الترخيص، يرفض النظام التفعيل فوراً برسالة:\n\"اسم المنشأة لا يطابق الترخيص المعتمد / Company name mismatch: License belongs to '<اسم المنشأة>'.\"\n• كما يمنع النظام تغيير الاسم القانوني في إعدادات الهوية المؤسسية إلى اسم يخالف الترخيص الفعال.",
        contentEn:
          "Every v2 license (.uas file or UASKEY-... serial token) includes an Ed25519-signed company_name:\n• On a fresh installation where EnterpriseProfile.isConfigured is false, activating the license automatically initializes legalNameAr and legalNameEn to payload.company_name.\n• Text normalization (normalizeCompanyName) normalizes Arabic variants (أ/إ/آ -> ا, ة -> ه, ى -> ي), whitespace, and Latin casing.\n• If an existing configured EnterpriseProfile does not match payload.company_name, activation is blocked with:\n\"اسم المنشأة لا يطابق الترخيص المعتمد / Company name mismatch: License belongs to '<company_name>'.\"\n• Enterprise Branding settings (/api/system/branding) also block renaming the locked legal name to a different organization.",
        stepsAr: [
          "افتح نافذة (إدارة الترخيص ومقاعد الأجهزة) من الشريط العلوي أو شاشة الدخول.",
          "أدخل اسم المنشأة المطابق تماماً لما هو مسجل في وثيقة الترخيص.",
          "ارفع ملف license.uas (تفعيل 100% دون إنترنت) أو الصق مفتاح UASKEY-... واضغط (تفعيل).",
        ],
        stepsEn: [
          "Open the License & Device Seats modal from the top bar or login screen.",
          "Enter the Confirmed Company Name matching your issued license.",
          "Upload your license.uas file (100% offline) or paste your UASKEY-... token and click Activate.",
        ],
        troubleshootingAr: [
          "إذا ظهر خطأ (اسم المنشأة لا يطابق الترخيص المعتمد): تأكد من كتابة اسم المنشأة الصحيح في حقل تأكيد اسم المنشأة، أو تحقق من أن قاعدة البيانات الحالية ليست تابعة لشركة أخرى.",
          "إذا ظهر خطأ (التوقيع الرقمي للترخيص غير صحيح): لا تقم بتعديل ملف license.uas يدوياً لأن أي تغيير يبطل توقيع Ed25519.",
        ],
        troubleshootingEn: [
          "If 'Company name mismatch' appears: verify that the Confirmed Company Name field matches your issued license and that the database was not previously configured for a different organization.",
          "If 'Invalid cryptographic signature' appears: ensure license.uas or UASKEY-... was not manually edited or truncated.",
        ],
        keywordsAr: [
          "ترخيص",
          "تفعيل",
          "اسم المنشأة",
          "لا يطابق الترخيص",
          "عدم تطابق",
          "مفتاح التفعيل",
          "ملف الترخيص",
          "توقيع رقمي",
          "قفل المنشأة",
        ],
        keywordsEn: [
          "license",
          "activate",
          "activation",
          "company name",
          "mismatch",
          "company_name",
          "uaskey",
          "ed25519",
          "signature",
          "company lock",
        ],
        targetTab: "system",
        relatedAction: "open_license_modal",
      },
      {
        id: "ch2-sec2-seat-quota-release",
        chapterNumber: 2,
        chapterId: "ch2-licensing-seats",
        titleAr: "حصة 7 مستخدمين × (1 ويندوز + 1 أندرويد) وإلغاء ربط الجهاز (Release Device Seat)",
        titleEn: "7-User × (1 Windows + 1 Android) Quota & SUPER_ADMIN Device Seat Release",
        summaryAr:
          "يسمح الترخيص المؤسسي بـ 7 مستخدمين نشطين كحد أقصى، ولكل مستخدم جهاز ويندوز واحد وجهاز أندرويد واحد، مع إمكانية تحرير المقعد عبر مدير النظام.",
        summaryEn:
          "Enforces up to 7 distinct active users per license, with 1 Windows + 1 Android device per user, and provides SUPER_ADMIN device seat release.",
        contentAr:
          "يدير جدول (LicenseDeviceBinding) مقاعد المستخدمين والأجهزة عبر قاعدة البيانات المحلية SQLite، وتطبيق أندرويد (Capacitor Offline)، وبوابة السحابة (https://qat.world/api/licensing/verify-key):\n• الحد الأقصى للمستخدمين النشطين: 7 مستخدمين مختلفين لكل ترخيص (يتم توحيد البريد الإلكتروني بأحرف صغيرة بدون مسافات).\n• حصة الأجهزة لكل مستخدم: جهاز كمبيوتر واحد (1 Windows HWID) + هاتف ذكي واحد (1 Android HWID).\n• إعادة التفعيل أو الدخول من نفس الجهاز (نفس البريد + المنصة + HWID) ينجح تلقائياً ويحدث طابع (lastSeenAt).\n• عند محاولة تفعيل مستخدم ثامن (8th User) أو جهاز ويندوز/أندرويد ثانٍ لنفس المستخدم، يرفض النظام العملية برسالة واضحة.\n• لتحرير مقعد جهاز مفقود أو مستبدل: يفتح مدير النظام العام (SUPER_ADMIN) نافذة الترخيص > تبويب (مقاعد الأجهزة) ويضغط على زر (إلغاء ربط الجهاز / Release Device Seat) لتحرير جهاز ويندوز أو أندرويد أو جميع أجهزة المستخدم فوراً مع توثيق العملية في سجل التدقيق.",
        contentEn:
          "The shared seat-binding service enforces device quotas across Local SQLite (LicenseDeviceBinding), Capacitor Android offline mode, and https://qat.world/api/licensing/verify-key:\n• Maximum distinct active users per licenseId: 7 users (emails normalized via .trim().toLowerCase()).\n• Per-user device slots: max 1 Windows HWID + 1 Android HWID per user.\n• Re-activating the same (userEmail, platform, hwid) updates lastSeenAt and succeeds.\n• An 8th user (MAX_USERS_REACHED) or a 2nd Windows/Android device for the same user (DEVICE_LIMIT_REACHED) is blocked with a bilingual error.\n• Releasing a lost or replaced laptop/phone: A SUPER_ADMIN opens License Modal > Device Seats tab and clicks 'إلغاء ربط الجهاز / Release Device Seat' for Windows, Android, or All devices of that user.",
        stepsAr: [
          "لمعرفة عدد المقاعد المستهلكة، افتح نافذة الترخيص وانظر إلى شريط (استهلاك المقاعد: X / 7 مستخدمين).",
          "لإلغاء ربط جهاز مفقود أو مستبدل، سجل الدخول بحساب مدير النظام العام (SUPER_ADMIN).",
          "افتح نافذة الترخيص > تبويب (مقاعد الأجهزة Device Seats).",
          "اضغط على زر (إلغاء ربط الجهاز / Release Device Seat) بجانب بريد المستخدم، أو أدخل البريد الإلكتروني واختر المنصة (Windows / Android / All) لتحرير المقعد فوراً.",
        ],
        stepsEn: [
          "Open the License Modal to view the live Seat Usage bar (X / 7 Users, Win & Android counters).",
          "Sign in as SUPER_ADMIN and switch to the 'Device Seats' tab in the License Modal.",
          "Click 'إلغاء ربط الجهاز / Release Device Seat' next to the user's bound Windows or Android slot (or use the direct email release form).",
          "Once released, the user can immediately activate or sign in on their new laptop or phone.",
        ],
        troubleshootingAr: [
          "خطأ (تم الوصول للحد الأقصى لعدد المستخدمين المرخّصين 7): قم بإلغاء ربط مستخدم غير نشط عبر زر (إلغاء ربط الجهاز) بصلاحية SUPER_ADMIN.",
          "خطأ (لدى هذا المستخدم جهاز ويندوز/أندرويد مربوط بالفعل): اطلب من مدير النظام العام تحرير مقعد المنصة القديم (Windows أو Android) قبل التفعيل على الجهاز الجديد.",
        ],
        troubleshootingEn: [
          "Error 'Maximum licensed users (7) reached': Have a SUPER_ADMIN release an inactive user's seat (All Devices) in the Device Seats tab.",
          "Error 'This user already has a bound Windows/Android device': Have a SUPER_ADMIN release that user's old Windows or Android slot before binding the replacement device.",
        ],
        keywordsAr: [
          "مقاعد",
          "مقعد",
          "7 مستخدمين",
          "سبعة مستخدمين",
          "إلغاء ربط الجهاز",
          "تحرير مقعد",
          "جهاز مفقود",
          "جهاز ثاني",
          "ويندوز",
          "أندرويد",
          "الحد الأقصى للمستخدمين",
        ],
        keywordsEn: [
          "seat",
          "seats",
          "7 users",
          "release device seat",
          "unbind",
          "max_users_reached",
          "device_limit_reached",
          "windows",
          "android",
          "lost device",
          "replace laptop",
          "quota",
        ],
        targetTab: "system",
        relatedAction: "open_license_modal",
      },
    ],
  },

  // =========================================================================
  // CHAPTER 3: Operating Modes (Local Standalone, Office LAN, Cloud qat.world)
  // =========================================================================
  {
    chapterNumber: 3,
    id: "ch3-operating-modes",
    titleAr: "3. أوضاع التشغيل (محلي Standalone، خادم شبكة LAN، وسحابي qat.world)",
    titleEn: "3. Operating Modes (Local Standalone, Office LAN 0.0.0.0:3000, Cloud qat.world)",
    descriptionAr:
      "التبديل بين التشغيل المحلي على جهاز واحد، خادم الشبكة المكتبية 0.0.0.0:3000، والخادم السحابي https://qat.world مع مزامنة عدم الاتصال.",
    descriptionEn:
      "Configuring Local Standalone (127.0.0.1:3000), Office LAN Server (0.0.0.0:3000), and Cloud Server (https://qat.world) with offline queue sync.",
    icon: "Network",
    targetTab: "system",
    sections: [
      {
        id: "ch3-sec1-modes-overview",
        chapterNumber: 3,
        chapterId: "ch3-operating-modes",
        titleAr: "الفرق بين الوضع المحلي (Local) وخادم الشبكة (Office LAN) والسحابي (Cloud)",
        titleEn: "Local Standalone vs. Office LAN Server (0.0.0.0:3000) vs. Cloud (qat.world)",
        summaryAr:
          "يدعم النظام ثلاثة أوضاع تشغيل مرنة مع حفظ الإعدادات في uas.runtime.json وفتح جدار حماية ويندوز تلقائياً لوضع LAN.",
        summaryEn:
          "UAS supports Local (127.0.0.1:3000), Office LAN (0.0.0.0:3000 with automatic Windows Firewall rule), and Cloud (https://qat.world) modes.",
        contentAr:
          "تتضمن منظومة UAS ثلاثة أوضاع تشغيل:\n1. الوضع المحلي (Local Standalone - 127.0.0.1:3000): يعمل بالكامل على جهاز كمبيوتر واحد دون الحاجة لاتصال بالشبكة أو الإنترنت، وتُحفظ البيانات في C:\\UAS-Data.\n2. خادم الشبكة المحلية (Office LAN Server - 0.0.0.0:3000): يحوّل الكمبيوتر الرئيسي إلى خادم محلي داخل المكتب أو الشركة؛ يقوم النظام تلقائياً بإنشاء قاعدة جدار حماية ويندوز (UAS Accounting LAN على المنفذ 3000) ويعرض رابط الشبكة (مثل http://192.168.1.10:3000) لتتصل به بقية أجهزة الكمبيوتر وهواتف أندرويد عبر الواي فاي المحلي.\n3. الوضع السحابي (Cloud Server - https://qat.world): يربط التطبيق بالبوابة السحابية المشفرة https://qat.world للعمل عن بُعد ومزامنة الفروع والمحصلين الميدانيين.",
        contentEn:
          "UAS provides three operating modes stored in uas.runtime.json:\n1. Local Standalone (127.0.0.1:3000): Runs 100% offline on a single Windows PC with local SQLite storage in C:\\UAS-Data.\n2. Office LAN Server (0.0.0.0:3000): Binds the desktop server to 0.0.0.0:3000, automatically provisions the 'UAS Accounting LAN' Windows Firewall inbound TCP rule on port 3000, and exposes your LAN URL (e.g. http://192.168.1.x:3000) for office PCs and Android phones.\n3. Cloud Hosted (https://qat.world): Connects to https://qat.world for multi-branch cloud operation and remote mobile synchronization.",
        stepsAr: [
          "للتبديل بين الأوضاع، افتح نافذة الترخيص > تبويب (وضع التشغيل LAN / Cloud).",
          "اختر الوضع المطلوب (Local أو Office LAN أو Cloud) بشرط أن يكون مدرجاً ضمن الأوضاع المصرح بها في الترخيص (allowed_modes).",
          "في وضع LAN، انسخ رابط الشبكة المحلية الظاهر (مثل http://192.168.1.x:3000) وأدخله في إعدادات اتصال الخادم على هواتف أندرويد أو أجهزة المكتب الأخرى.",
        ],
        stepsEn: [
          "Open the License Modal and switch to the 'Runtime Mode' tab.",
          "Select Local Single PC (127.0.0.1:3000), Office LAN Server (0.0.0.0:3000), or Cloud Server (https://qat.world).",
          "In Office LAN mode, copy the displayed Office LAN URL and configure it in the Server Connection switcher on client workstations or Android phones.",
        ],
        keywordsAr: [
          "وضع التشغيل",
          "شبكة محلية",
          "خادم شبكة",
          "سحابي",
          "محلي",
          "واي فاي",
          "جدار الحماية",
          "ربط الهاتف بالكمبيوتر",
          "0.0.0.0",
          "3000",
          "qat.world",
        ],
        keywordsEn: [
          "operating mode",
          "runtime mode",
          "local",
          "standalone",
          "lan",
          "office lan",
          "0.0.0.0:3000",
          "cloud",
          "qat.world",
          "firewall",
          "offline sync",
        ],
        targetTab: "system",
        relatedAction: "open_license_modal",
      },
    ],
  },

  // =========================================================================
  // CHAPTER 4: 5-Level Chart of Accounts (COA) & Double-Entry Journal Vouchers
  // =========================================================================
  {
    chapterNumber: 4,
    id: "ch4-coa-journal",
    titleAr: "4. الدليل المحاسبي الهرمي (5+ مستويات) وقيود اليومية المزدوجة",
    titleEn: "4. 5-Level Chart of Accounts (COA) & Double-Entry Journal Vouchers",
    descriptionAr:
      "هيكلة شجرة الحسابات، التفرقة بين الحسابات الرئيسية والفرعية القابلة للترحيل، وقاعدة توازن القيد المزدوج.",
    descriptionEn:
      "Hierarchical Chart of Accounts structure, parent header vs. leaf posting accounts, and strict balanced double-entry journal vouchers.",
    icon: "BookOpen",
    targetTab: "coa",
    sections: [
      {
        id: "ch4-sec1-coa-hierarchy",
        chapterNumber: 4,
        chapterId: "ch4-coa-journal",
        titleAr: "هيكلة شجرة الحسابات (5-Level / 6-Gen COA) والحسابات القابلة للترحيل",
        titleEn: "Hierarchical Chart of Accounts (COA) & Posting Rules",
        summaryAr:
          "تتكون شجرة الحسابات من الأصول (1)، الالتزامات (2)، حقوق الملكية (3)، الإيرادات (4)، والمصروفات (5)، ولا يُقبل الترحيل إلا على الحسابات الفرعية النهائية.",
        summaryEn:
          "Organizes Assets (1), Liabilities (2), Equity (3), Revenue (4), and Expenses (5) into a multi-level tree where only leaf accounts (isPosting=true) accept ledger postings.",
        contentAr:
          "تُصنف شجرة الحسابات في منظومة UAS إلى خمسة أبواب رئيسية:\n• 1 - الأصول (ASSET): الأصول المتداولة، النقدية بالصناديق والبنوك (مثل 111101 الصندوق الرئيسي)، الذمم المدينة، والمخزون.\n• 2 - الالتزامات / الخصوم (LIABILITY): الذمم الدائنة للموردين، الأجور المستحقة، والالتزامات المتداولة.\n• 3 - حقوق الملكية (EQUITY): رأس المال، الأرباح المبقاة، وجاري الشركاء.\n• 4 - الإيرادات (REVENUE): إيرادات المبيعات والمشاريع.\n• 5 - المصروفات والتكاليف (EXPENSE): تكلفة المبيعات، مصاريف التشغيل، والأجور.\nقاعدة محاسبية صارمة: الحسابات التجميعية/الأبوية (isPosting = false) تُستخدم للتجميع الهرمي في التقارير فقط، بينما يتم ترحيل القيود المالية حصرياً على الحسابات الفرعية النهائية القابلة للترحيل (isPosting = true، المستوى الخامس فما فوق).",
        contentEn:
          "The UAS Chart of Accounts is structured across 5 primary classes:\n• 1 - ASSET (e.g., 111101 Main Cash Vault, Accounts Receivable, Inventory)\n• 2 - LIABILITY (Accounts Payable, Accrued Wages)\n• 3 - EQUITY (Capital, Retained Earnings)\n• 4 - REVENUE (Sales & Project Revenue)\n• 5 - EXPENSE (COGS, Operating Expenses, Labor)\nStrict Posting Rule: Parent header accounts (isPosting = false) automatically roll up child balances and cannot receive direct journal lines. All financial transactions post exclusively to leaf posting accounts (isPosting = true).",
        stepsAr: [
          "انتقل إلى تبويب (شجرة الحسابات COA) لاستعراض الدليل المحاسبي الهرمي.",
          "لإضافة حساب فرعي جديد، اختر الحساب الأب واضغط (إضافة حساب فرعي) مع تحديد نوع الحساب وقابلية الترحيل.",
          "يدعم النظام الترقية التلقائية للحساب عند تفريع حسابات جديدة تحته مع الحفاظ على تسلسل الأجيال.",
        ],
        stepsEn: [
          "Navigate to the Chart of Accounts (COA) tab to browse or search the account hierarchy.",
          "To add a new account, select its parent account and click 'Add Sub-Account'.",
          "Verify that leaf accounts intended for journal entries have 'Posting Account (isPosting)' enabled.",
        ],
        keywordsAr: [
          "شجرة الحسابات",
          "دليل الحسابات",
          "حساب فرعي",
          "حساب رئيسي",
          "الأصول",
          "الالتزامات",
          "حقوق الملكية",
          "الإيرادات",
          "المصروفات",
          "قابل للترحيل",
          "111101",
        ],
        keywordsEn: [
          "coa",
          "chart of accounts",
          "5-level",
          "hierarchy",
          "posting account",
          "isposting",
          "asset",
          "liability",
          "equity",
          "revenue",
          "expense",
          "account code",
        ],
        targetTab: "coa",
        relatedAction: "navigate_tab",
      },
      {
        id: "ch4-sec2-journal-entries",
        chapterNumber: 4,
        chapterId: "ch4-coa-journal",
        titleAr: "قيود اليومية المزدوجة (Double-Entry Journal Vouchers) وشرط التوازن",
        titleEn: "Double-Entry Journal Vouchers & Strict Debit === Credit Guardrails",
        summaryAr:
          "يشترط النظام تساوي إجمالي المدين مع إجمالي الدائن (Debit === Credit) في كل قيد يومية قبل الترحيل لدفتر الأستاذ العام.",
        summaryEn:
          "Every journal entry must contain at least two lines on valid posting accounts with Sum(Debit) === Sum(Credit) > 0 before posting to the General Ledger.",
        contentAr:
          "يخضع دفتر الأستاذ العام (General Ledger) لرقابة القيد المزدوج الصارمة:\n• يجب أن يتكون كل قيد يومية من سطرين على الأقل (طرف مدين وطرف دائن).\n• يجب أن يتطابق مجموع المدين مع مجموع الدائن تماماً (Sum(Debit) === Sum(Credit)).\n• أي قيد غير متوازن يتم رفضه فوراً ولا يُسمح بترحيله.\n• يدعم النظام العملات المتعددة (YER، SAR، USD) مع المعادل بالريال اليمني، ويوثق كل قيد ببصمة تحقق رقمية وسجل تدقيق.",
        contentEn:
          "The General Ledger enforces atomic double-entry accounting:\n• Every journal entry requires at least 2 lines targeting valid posting accounts.\n• Total Debits must strictly equal Total Credits (Sum(Debit) === Sum(Credit) > 0).\n• Unbalanced entries or lines targeting parent header accounts are rejected immediately.\n• Supports multi-currency lines (YER, SAR, USD) normalized to base currency and logged in the audit trail.",
        stepsAr: [
          "افتح تبويب (دفتر الأستاذ العام / قيود اليومية General Ledger).",
          "أدخل البيان (Description)، التاريخ، والمشروع أو مركز التكلفة إن وجد.",
          "أضف أسطر القيد باختيار رقم الحساب الفرعي وإدخال مبلغ المدين أو الدائن حتى يظهر مؤشر (القيد متوازن Balanced).",
          "اضغط (اعتماد وترحيل القيد) ليتم ترحيله فورياً وتحديث أرصدة الحسابات.",
        ],
        stepsEn: [
          "Open the General Ledger (ledger) tab.",
          "Enter the journal date, narration/description, and optional project/cost center.",
          "Add debit and credit lines on leaf posting accounts until Total Debit equals Total Credit.",
          "Click 'Post Journal Entry' to commit the balanced transaction to the ledger.",
        ],
        keywordsAr: [
          "قيد يومية",
          "قيود",
          "دفتر الأستاذ",
          "مدين",
          "دائن",
          "قيد مزدوج",
          "توازن القيد",
          "غير متوازن",
          "ترحيل",
          "عكس قيد",
          "قيد تسوية",
        ],
        keywordsEn: [
          "journal",
          "journal entry",
          "ledger",
          "general ledger",
          "debit",
          "credit",
          "balanced",
          "unbalanced",
          "double entry",
          "post",
          "voucher",
        ],
        targetTab: "ledger",
        relatedAction: "navigate_tab",
      },
      {
        id: "ch4-sec3-gen6-coa-cost-centers",
        chapterNumber: 4,
        chapterId: "ch4-coa-journal",
        titleAr: "الدليل المحاسبي سداسي الأجيال ومراكز التكلفة (6-Generation COA & Cost Centers)",
        titleEn: "6-Generation Chart of Accounts (COA) & Cost Centers Architecture",
        summaryAr:
          "هيكلة متقدمة من 6 أجيال تنتهي بحسابات فرعية تفصيلية (Gen-6) مرتبطة تلقائياً بمراكز التكلفة لكل عميل، مورد، عامل، وخزينة.",
        summaryEn:
          "Advanced 6-generation hierarchy where operational entities (Customer, Vendor, Worker, Treasury) auto-provision a postable leaf GL account (Gen-6) and dedicated Cost Center.",
        contentAr:
          "تعتمد منظومة UAS معيار الدليل المحاسبي سداسي الأجيال (6-Generation COA):\n• الجيل 1: الباب الرئيسي (مثل 100000 الأصول).\n• الجيل 2: المجموعة الرئيسية (مثل 110000 الأصول المتداولة).\n• الجيل 3: المجموعة الفرعية (مثل 112000 المدينون والذمم التجارية).\n• الجيل 4: حساب المراقبة الإجمالي (مثل 112100 العملاء المحليون).\n• الجيل 5: حساب التحكم الفرعي (مثل 112190 حسابات العملاء التفصيلية).\n• الجيل 6: الحساب الفرعي النهائي القابل للترحيل (مثل 112190001 لعميل محدد).\nالتكامل مع مراكز التكلفة: عند إضافة أي عميل أو مورد أو عامل أو خزينة أو مستودع، ينشئ المحرك تلقائياً حساب الجيل السادس ومرفقاً معه مركز تكلفة مطابق (مثل CUS-001) يربط كافة قيود المبيعات والمصروفات بمراكز الربحية.",
        contentEn:
          "UAS adheres to a rigorous 6-Generation Chart of Accounts architecture:\n• Gen 1: Class Header (100000 ASSETS)\n• Gen 2: Group Header (110000 CURRENT ASSETS)\n• Gen 3: Sub-Group (112000 TRADE RECEIVABLES)\n• Gen 4: Control Account (112100 LOCAL TRADE DEBTORS)\n• Gen 5: Sub-Control Header (112190 DETAILED CUSTOMER ACCOUNTS)\n• Gen 6: Leaf Postable Sub-Ledger Account (e.g. 112190001 for specific customer)\nAutomatic Cost Center Binding: Every entity automatically provisions its Gen-6 leaf account along with an associated Cost Center (e.g. CUS-001, VND-001, WRK-001), ensuring multi-dimensional analytics on all postings.",
        stepsAr: [
          "افتح تبويب (شجرة الحسابات COA) ولاحظ تسلسل الأجيال الستة وعلامات (Gen-6).",
          "عند إنشاء عميل أو مورد جديد، يقوم النظام تلقائياً بتوليد حساب الجيل السادس ومركز التكلفة المقترن به.",
          "يمكنك ربط مراكز تكلفة مخصصة (مشاريع، قطاعات زراعية، أسطول) بأسطر قيود اليومية لفرز تقارير الربحية.",
        ],
        stepsEn: [
          "Open the Chart of Accounts (COA) tab to inspect the 6-generation structure with Gen-6 badges.",
          "Creating any Customer, Vendor, or Worker automatically provisions a postable Gen-6 leaf account and Cost Center.",
          "Select Cost Centers on journal lines or invoices to allocate revenues and expenses to specific projects or branches.",
        ],
        keywordsAr: [
          "الجيل السادس",
          "gen-6",
          "مراكز التكلفة",
          "شجرة الحسابات",
          "حساب تحكم",
          "حساب فرعي",
          "ربحية المشاريع",
          "تكلفة",
        ],
        keywordsEn: [
          "gen-6",
          "generation 6",
          "cost center",
          "cost centers",
          "leaf account",
          "sub ledger",
          "profit center",
        ],
        targetTab: "coa",
        relatedAction: "navigate_tab",
      },
      {
        id: "ch4-sec4-fiscal-year-closing",
        chapterNumber: 4,
        chapterId: "ch4-coa-journal",
        titleAr: "إقفال السنة المالية وترحيل الأرصدة الافتتاحية (Fiscal Year Closing & Rollover)",
        titleEn: "Fiscal Year Closing & Automatic Opening Balance Rollover",
        summaryAr:
          "إجراء إقفال دوري ذري يغلق الإيرادات والمصروفات في الأرباح المبقاة (312101) ويرحل الأرصدة الافتتاحية بدقة مع قفل السنة المغلقة.",
        summaryEn:
          "Atomic period closing that rolls up P&L into Retained Earnings (312101), migrates multi-currency opening balances to the next fiscal year, and permanently locks the closed year.",
        contentAr:
          "يوفر محرك إقفال السنة المالية في UAS أماناً محاسبياً متكاملاً وفقاً للمعايير الدولية:\n• فحص الجاهزية المسبق (Precheck): يتأكد من عدم وجود وثائق معلقة (مسودات DRAFT أو اعتمادات بانتظار الموافقة PENDING_APPROVAL).\n• القيد الختامي الذري: يتم تصفير كافة حسابات الإيرادات (الباب 4) والمصروفات (الباب 5) وترحيل صافي الربح/الخسارة إلى حساب الأرباح المبقاة (312101 Retained Earnings).\n• ترحيل الأرصدة الافتتاحية: يتم إنشاء قيد افتتاحي (OPENING) آلياً للسنة المالية الجديدة يتضمن أرصدة الأصول والالتزامات وحقوق الملكية بتفصيل أجيال الحسابات (Gen-6) والعملات الأجنبية.\n• قفل السنة: تُقفل السنة المغلقة نهائياً ويمنع النظام ترحيل أو تعديل أي قيد بتاريخ يقع ضمن فترتها.",
        contentEn:
          "The UAS Year-End Closing Engine enforces international accounting standards:\n• Precheck Verification: Ensures zero unresolved drafts (DRAFT) or unapproved requests (PENDING_APPROVAL) exist in the year.\n• Atomic P&L Closing Entry: Zeroes out all Revenue (Class 4) and Expense (Class 5) accounts and rolls net income into Retained Earnings (312101).\n• Opening Balance Rollover: Automatically provisions the next fiscal year and generates a balanced OPENING journal entry carrying forward Assets, Liabilities, and Equity balances in original currencies and base YER.\n• Immutable Year-Lock: Permanently locks the closed fiscal year, preventing any subsequent edits or backdated postings.",
        stepsAr: [
          "تأكد من ترحيل كافة العمليات واعتماد المسودات قبل بدء الإقفال.",
          "افتح تبويب (إدارة النظام والأمان) أو (سجل الرقابة) واختر (إقفال السنة المالية).",
          "شغّل الفحص المسبق (Run Precheck) للتحقق من سلامة كافة الشروط المحاسبية.",
          "اضغط (تنفيذ الإقفال النهائي والترحيل للسنة الجديدة) للاعتماد الذري.",
        ],
        stepsEn: [
          "Ensure all drafts are either converted or deleted and all pending approvals are resolved.",
          "Open the System Settings or Audit tab and locate the Fiscal Years management section.",
          "Run the Fiscal Year Precheck to verify all closing conditions pass with 0 warnings.",
          "Execute the final atomic close and rollover to create opening balances for the next year.",
        ],
        keywordsAr: [
          "إقفال السنة",
          "إقفال سنوي",
          "سنة مالية",
          "أرباح مبقاة",
          "أرصدة افتتاحية",
          "قفل الفترة",
          "ترحيل الأرصدة",
          "312101",
        ],
        keywordsEn: [
          "fiscal year",
          "year end close",
          "closing",
          "rollover",
          "opening balance",
          "retained earnings",
          "period lock",
        ],
        targetTab: "system",
        relatedAction: "navigate_tab",
      },
      {
        id: "ch4-sec5-fx-revaluation",
        chapterNumber: 4,
        chapterId: "ch4-coa-journal",
        titleAr: "إعادة تقييم فروق أسعار الصرف (FX Revaluation & Realignment)",
        titleEn: "FX Revaluation & Foreign Currency Realignment",
        summaryAr:
          "تقييم دوري للأرصدة النقدية والذمم بالعملات الأجنبية (سعودي، دولار، وغيرها) وفقاً لأسعار الصرف الحالية وتسجيل الأرباح/الخسائر غير المحققة.",
        summaryEn:
          "Periodic revaluation of foreign currency balances (SAR, USD, AED, OMR) against prevailing market rates, automatically booking unrealized FX gain or loss.",
        contentAr:
          "تدعم منظومة UAS إدارة العملات المتعددة مع التقييم المحاسبي الدوري:\n• الحسابات النقدية بالعملات الأجنبية (خزائن وبنوك وذمم بالريال السعودي أو الدولار) تحتفظ برصيدها بالعملة الأصلية وبالمعادل بالعملة الأساسية (YER).\n• عند تغير أسعار السوق، تتيح وظيفة (إعادة تقييم الصرف FX Revaluation) حساب فروق العملة غير المحققة.\n• يُولد النظام آلياً قيد تسوية صرف متوازن: يقيد الفارق لحساب (أرباح فروق أسعار الصرف 421101) في حالة الربح، أو لحساب (خسائر فروق أسعار الصرف 531101) في حالة الخسارة.\n• يضمن ذلك إظهار الأصول والخصوم في الميزانية العمومية بقيمتها العادلة الحقيقية في أي تاريخ.",
        contentEn:
          "UAS delivers native multi-currency accounting with comprehensive FX revaluation:\n• Monetary accounts held in foreign currencies (SAR, USD, AED, OMR) maintain both transaction currency amounts and base currency equivalents (YER).\n• When market rates shift, the FX Revaluation engine compares book value against current closing rates.\n• An atomic revaluation journal entry is generated: booking gains to Unrealized FX Gain (421101) or losses to Unrealized FX Loss (531101).\n• Balances on the Balance Sheet reflect true current fair value without distorting historical ledger transactions.",
        stepsAr: [
          "افتح تبويب (أسعار الصرف والعملات) في الإعدادات أو المحاسبة.",
          "حدّث سعر الصرف اليومي للعملات الأجنبية (سعودي، دولار).",
          "اضغط على (تشغيل إعادة تقييم الصرف FX Revaluation).",
          "راجع المعاينة التفصيلية للمكاسب والخسائر واضغط (اعتماد قيد التسوية).",
        ],
        stepsEn: [
          "Open the Currencies & Exchange Rates section.",
          "Update the current exchange rate for active foreign currencies.",
          "Click 'Run FX Revaluation' to preview unrealized gains or losses across accounts.",
          "Confirm the revaluation preview to post the balanced adjustment journal.",
        ],
        keywordsAr: [
          "فروق الصرف",
          "سعر الصرف",
          "إعادة تقييم",
          "عملات أجنبية",
          "سعودي",
          "دولار",
          "أرباح صرف",
          "خسائر صرف",
          "fx revaluation",
        ],
        keywordsEn: [
          "fx revaluation",
          "exchange rate",
          "foreign currency",
          "currency gain",
          "currency loss",
          "sar",
          "usd",
          "realign",
        ],
        targetTab: "coa",
        relatedAction: "navigate_tab",
      },
    ],
  },

  // =========================================================================
  // CHAPTER 5: Receipts, Payment Vouchers & Cost Centers
  // =========================================================================
  {
    chapterNumber: 5,
    id: "ch5-vouchers-treasury-projects",
    titleAr: "5. سندات القبض والصرف، الخزينة ومراكز التكلفة والمشاريع",
    titleEn: "5. Receipts, Payment Vouchers, Treasury & Cost Centers",
    descriptionAr:
      "إدارة الصناديق والبنوك والمحافظ، سندات القبض والصرف، التحويلات المالية، والمشاريع ومواسم الحصاد.",
    descriptionEn:
      "Managing cash vaults, bank accounts, e-wallets, receipt/payment vouchers, FX transfers, and project/harvest cost centers.",
    icon: "Wallet",
    targetTab: "treasury",
    sections: [
      {
        id: "ch5-sec1-receipts-payments-treasury",
        chapterNumber: 5,
        chapterId: "ch5-vouchers-treasury-projects",
        titleAr: "سندات القبض وسندات الصرف وإدارة الخزائن والبنوك",
        titleEn: "Receipt Vouchers, Payment Vouchers & Treasury Management",
        summaryAr:
          "تولّد سندات القبض والصرف قيود يومية مزدوجة آلياً وترتبط بالخزينة أو البنك وبذمم العملاء أو الموردين.",
        summaryEn:
          "Receipt and payment vouchers automatically post balanced journal entries linking treasury vaults/banks with customer receivables, vendor payables, or expense accounts.",
        contentAr:
          "تُدار السيولة النقدية في تبويب (الخزينة والبنوك Treasury) وتتكامل مع المبيعات والمشتريات والمصروفات:\n• سند قبض (Receipt Voucher): يثبت تحصيل نقدية أو حوالة من عميل أو إيراد، فيجعل حساب الخزينة/البنك مديناً وحساب العميل أو الإيراد دائناً.\n• سند صرف (Payment Voucher): يثبت سداد دفعة لمورد أو مصروف تشغيلي أو أجور عمال، فيجعل حساب المورد أو المصروف مديناً وحساب الخزينة/البنك دائناً.\n• التحويل بين الخزائن والعملات (Treasury Transfer): يدعم التحويل بين الصناديق والبنوك والمحافظ الإلكترونية مع احتساب عمولة التحويل وفروق أسعار الصرف آلياً.",
        contentEn:
          "Treasury operations automatically generate double-entry ledger postings:\n• Receipt Voucher: Debits the selected Treasury Vault/Bank/Wallet account and credits Customer Accounts Receivable or Revenue.\n• Payment Voucher: Debits Vendor Accounts Payable, Operating Expenses, or Worker Wages and credits the Treasury account.\n• Treasury FX Transfer: Transfers funds between vaults/banks across currencies (YER, SAR, USD) with automatic transfer fee accounting.",
        stepsAr: [
          "لإصدار سند قبض لعميل: افتح تبويب (المبيعات) أو (الأقساط والتحصيل) واختر العميل والخزينة المستلمة والمبلغ.",
          "لإصدار سند صرف لمورد أو مصروف: افتح تبويب (المشتريات) أو (المصروفات) وحدد الخزينة الصارفة والمبلغ والبيان.",
          "لطباعة السند مع رمز التحقق الرقمي QR، اضغط على زر (عرض السند / طباعة) بجانب العملية.",
        ],
        stepsEn: [
          "To issue a Receipt Voucher: open Sales or Installments, select the customer, receiving treasury vault/bank, and amount.",
          "To issue a Payment Voucher: open Procurement or Expenses, select the vendor/expense category, paying treasury account, and amount.",
          "Click 'View / Print Voucher' on any transaction to generate a printable voucher with an embedded SHA-256 QR verification code.",
        ],
        keywordsAr: [
          "سند قبض",
          "سند صرف",
          "خزينة",
          "صندوق",
          "بنك",
          "محفظة",
          "تحويل مالي",
          "عملة",
          "صرف",
          "تحصيل",
          "أقساط",
        ],
        keywordsEn: [
          "receipt voucher",
          "payment voucher",
          "treasury",
          "vault",
          "cash",
          "bank",
          "wallet",
          "transfer",
          "installment",
          "collection",
        ],
        targetTab: "treasury",
        relatedAction: "navigate_tab",
      },
      {
        id: "ch5-sec2-cost-centers-projects",
        chapterNumber: 5,
        chapterId: "ch5-vouchers-treasury-projects",
        titleAr: "مراكز التكلفة، المشاريع، المشاريع الفرعية ومواسم الحصاد",
        titleEn: "Cost Centers, Projects, Sub-Projects & Harvest Cycles",
        summaryAr:
          "تتبع ربحية وتكاليف كل مشروع ومشروع فرعي وموسم حصاد (قطفة) بشكل مستقل مع إمكانية إقفال الفترة.",
        summaryEn:
          "Tracks acquisition costs, operating expenses, wages, and sales revenue per Project, Sub-Project, and Harvest Cycle with period locking.",
        contentAr:
          "تعمل المشاريع (Projects) والمشاريع الفرعية (Sub-Projects) ومواسم الحصاد/القطفات (Harvest Cycles) كمراكز تكلفة وربحية متعددة الأبعاد:\n• يمكن ربط أي قيد، فاتورة، مصروف، أو أجر عامل بمشروع محدد وموسم حصاد محدد.\n• يتيح فلتر المشاريع في الشريط العلوي تصفية لوحة القيادة والتقارير المالية فوراً حسب المشروع أو القطفة.\n• عند اكتمال موسم الحصاد، يمكن لرئيس الحسابات أو مدير النظام قفل القطفة محاسبياً (Period Lock) لمنع أي تعديل لاحق إلا عبر قيد تسوية رسمي.",
        contentEn:
          "Projects, Sub-Projects, and Harvest Cycles act as multi-dimensional cost and profit centers:\n• Every invoice, expense, wage entry, and journal voucher can be tagged with a Project, Sub-Project, and Harvest Cycle.\n• Use the global top bar filters to slice the Dashboard and Financial Reports by project or harvest cycle.\n• Completed harvest cycles can be locked (Harvest Cycle Lock) to prevent retroactive edits unless posted via an audited Adjustment Entry.",
        stepsAr: [
          "افتح تبويب (إدارة المشاريع Projects) لإنشاء مشروع جديد أو مشروع فرعي أو موسم حصاد.",
          "عند تسجيل أي مصروف أو عملية بيع، اختر المشروع والقطفة لربط التكلفة والإيراد بمركز التكلفة الصحيح.",
        ],
        stepsEn: [
          "Open the Projects tab to create a Project, Sub-Project, or Harvest Cycle.",
          "Select the target Project and Harvest Cycle when recording sales, procurement bills, expenses, or worker wages.",
        ],
        keywordsAr: [
          "مركز تكلفة",
          "مراكز التكلفة",
          "مشروع",
          "مشاريع",
          "مشروع فرعي",
          "قطفة",
          "موسم حصاد",
          "إغلاق القطفة",
          "استحواذ",
        ],
        keywordsEn: [
          "cost center",
          "project",
          "projects",
          "sub-project",
          "harvest",
          "harvest cycle",
          "acquisition",
          "period lock",
        ],
        targetTab: "projects",
        relatedAction: "navigate_tab",
      },
    ],
  },

  // =========================================================================
  // CHAPTER 6: Sales/Purchase Invoicing, Inventory & Public QR Verification
  // =========================================================================
  {
    chapterNumber: 6,
    id: "ch6-invoicing-inventory-qr",
    titleAr: "6. فواتير المبيعات والمشتريات، المخزون والتحقق الرقمي عبر رمز QR",
    titleEn: "6. Sales/Purchase Invoicing, Inventory & Public QR Verification",
    descriptionAr:
      "دورة المشتريات والمبيعات المتكاملة، مراقبة المخزون والدفعات، والتحقق العام من صحة الوثائق المالية برمز QR.",
    descriptionEn:
      "End-to-end procurement and sales invoicing, real-time inventory lot tracking, and cryptographic QR document verification.",
    icon: "QrCode",
    targetTab: "sales",
    sections: [
      {
        id: "ch6-sec1-sales-procurement-inventory",
        chapterNumber: 6,
        chapterId: "ch6-invoicing-inventory-qr",
        titleAr: "فواتير المبيعات والمشتريات والرقابة الآلية على المخزون",
        titleEn: "Sales & Purchase Invoicing and Automated Inventory Control",
        summaryAr:
          "تؤثر فواتير المشتريات والمبيعات آلياً على كميات المخزون، ذمم الموردين والعملاء، ودفتر الأستاذ العام.",
        summaryEn:
          "Purchase bills and sales invoices atomically update inventory lots, customer/vendor balances, treasury accounts, and the General Ledger.",
        contentAr:
          "تتكامل دورة الفوترة والمخزون في عملية ذرية واحدة (Atomic Transaction):\n• دورة المشتريات (Procurement): تسجيل الموردين -> أوامر الشراء (PO) -> استلام البضائع وزيادة المخزون -> فاتورة المورد وسند الصرف.\n• دورة المبيعات (Sales): تسجيل العملاء -> إصدار فاتورة مبيعات (نقدية، آجلة، أو جزئية) مع دعم البيع المتزامن لعدة محصلين -> خصم الكمية من المخزون وترحيل قيد الإيراد والذمم المدينة آلياً.\n• إدارة المخزون (Inventory): متابعة الأصناف، الدفعات (Inventory Lots & Harvest Batches)، الكميات المتوفرة، وتنبيهات إعادة الطلب.",
        contentEn:
          "Invoicing and inventory operate atomically:\n• Procurement Cycle: Vendors -> Purchase Orders -> Goods Receipts (increments stock) -> Vendor Bills & Payment Vouchers.\n• Sales Cycle: Customers -> Concurrent multi-officer Sales Invoices (Cash, Credit, or Partial payment) -> decrements stock and posts Revenue + Accounts Receivable/Treasury journal lines.\n• Inventory Control: Tracks Inventory Lots and Harvest Batches with real-time available quantities and valuation.",
        stepsAr: [
          "لإصدار فاتورة مبيعات: افتح تبويب (المبيعات Sales)، اختر العميل والصنف والكمية وطريقة الدفع (نقدي/آجل) ثم احفظ الفاتورة.",
          "لتسجيل فاتورة مشتريات: افتح تبويب (المشتريات Procurement)، اختر المورد والأصناف المستلمة وطريقة السداد.",
          "لفحص رصيد المخزون: افتح تبويب (المخزون Inventory) لمراجعة الكميات المتبقية وتكلفة كل صنف.",
        ],
        stepsEn: [
          "To create a Sales Invoice: open the Sales tab, select the customer, item/batch, quantity, unit price, and payment method.",
          "To record a Purchase Bill: open the Procurement tab, select the vendor, items, and payment terms.",
          "To inspect stock levels: open the Inventory tab to view available quantities across lots and harvest batches.",
        ],
        keywordsAr: [
          "فاتورة",
          "فواتير",
          "مبيعات",
          "مشتريات",
          "مورد",
          "عميل",
          "عملاء",
          "مخزون",
          "أصناف",
          "بضاعة",
          "كمية",
          "أمر شراء",
        ],
        keywordsEn: [
          "invoice",
          "sales",
          "purchase",
          "procurement",
          "vendor",
          "bill",
          "customer",
          "inventory",
          "stock",
          "item",
          "lot",
          "po",
        ],
        targetTab: "sales",
        relatedAction: "navigate_tab",
      },
      {
        id: "ch6-sec2-qr-verification",
        chapterNumber: 6,
        chapterId: "ch6-invoicing-inventory-qr",
        titleAr: "التحقق الرقمي العام من صحة الفواتير والسندات عبر رمز QR",
        titleEn: "Cryptographic SHA-256 Public QR Document Verification",
        summaryAr:
          "يحمل كل سند وفاتورة رمز تحقق رقمي فريد يمكن فحصه عبر بوابة التحقق العامة للتأكد من عدم التزوير.",
        summaryEn:
          "Every voucher and invoice carries a deterministic SHA-256 verification hash verifiable via /api/public/verify or the public portal.",
        contentAr:
          "لحماية المنشأة وعملائها من التلاعب أو الفواتير المزورة، يُطبع على كل فاتورة وسند قبض/صرف رمز استجابة سريعة (QR Code) وبصمة تحقق رقمية (مثل UAS-XXXX-XXXX):\n• يمكن لأي عميل أو مدقق إدخال رقم المرجع أو مسح رمز QR في بوابة التحقق العامة (/api/public/verify) للتأكد من أن السند صادر فعلياً من النظام ومطابق للقيمة والتاريخ المسجلين في دفتر الأستاذ.",
        contentEn:
          "Every printed invoice and receipt/payment voucher embeds a deterministic QR code and verification token:\n• Customers and auditors can scan the QR code or query /api/public/verify?code=<REF> to confirm document authenticity, amount, date, and posting status against the ledger.",
        stepsAr: [
          "افتح أي سند أو فاتورة واضغط على أيقونة عرض السند (Voucher Modal) لمشاهدة رمز QR ورقم التحقق.",
          "للتحقق من وثيقة: استخدم أداة التحقق في الصفحة الرئيسية أو استعلم عبر المساعد الذكي برقم السند أو الفاتورة.",
        ],
        stepsEn: [
          "Open any voucher or invoice preview modal to view its printed QR matrix and verification hash.",
          "Verify any document reference via the public verification checker on the portal or through the AI Copilot.",
        ],
        keywordsAr: [
          "رمز qr",
          "كيو آر",
          "تحقق",
          "فحص فاتورة",
          "صحة السند",
          "تزوير",
          "باركود",
          "بصمة رقمية",
        ],
        keywordsEn: [
          "qr",
          "qr code",
          "verify",
          "verification",
          "authentic",
          "document check",
          "hash",
          "public verify",
        ],
        targetTab: "audit",
        relatedAction: "navigate_tab",
      },
      {
        id: "ch6-sec3-multi-unit-inventory",
        chapterNumber: 6,
        chapterId: "ch6-invoicing-inventory-qr",
        titleAr: "المخزون متعدد وحدات القياس ومعاملات التحويل والخيارات المخصصة (Multi-Unit Inventory)",
        titleEn: "Multi-Unit Inventory, Conversion Factors & 'Other / Custom' Units",
        summaryAr:
          "إدارة المستودعات والأصناف بوحدات قياس متعددة (كرتون، شوال، طن، كيس) مع حساب معامل التحويل للوحدة الأساسية وخيار مخصص لأي وحدة جديدة.",
        summaryEn:
          "Multi-unit inventory tracking supporting nested packaging conversions (e.g. 1 Carton = 12 Pieces) with extensible 'Other / Custom' unit onboarding.",
        contentAr:
          "يوفر نظام إدارة المخزون متعدد الوحدات في UAS دقة متناهية وسهولة للمستخدم الميداني:\n• الوحدة الأساسية (Base Unit): يُعرف كل صنف بوحدة قياس أساسية (مثل: حبة، كجم، متر).\n• معاملات التحويل (ItemUnitConversion): يمكن إضافة وحدات تعبئة متعددة لكل صنف (مثل: كرتون = 24 حبة، شوالة = 50 كجم) عبر حقل معامل التحويل للأساس (factorToBase).\n• الحساب التلقائي للكميات والتكلفة: عند البيع أو الشراء بوحدة فرعية، يحسب النظام الكمية بالوحدة الأساسية (baseQuantity = qty * factorToBase) وتكلفة الوحدة الأساسية بدقة.\n• المرونة مع خيار 'أخرى / مخصص': في أي قائمة منسدلة لوحدات القياس أو الفئات، يتيح النظام خيار (أخرى / تحديد مخصص) لإدخال وحدة قياس جديدة فوراً دون الحاجة لمغادرة الشاشة.",
        contentEn:
          "UAS Multi-Unit Inventory Architecture delivers enterprise inventory precision:\n• Base Unit of Measure (UOM): Every item defines a base counting unit (e.g., Piece, KG, Meter).\n• Nested Conversion Factors (factorToBase): Define alternative packaging units (e.g., 1 Box = 12 Pieces, 1 Sack = 50 KG) with automatic factorToBase multiplication.\n• Automated Cost & Stock Ledger: Stock movements record both transaction quantity and normalized base quantity (baseQuantityDelta = qty * factorToBase).\n• Universal 'Other / Custom' Extensibility: Every UOM and Item Category dropdown allows instant inline onboarding of custom packaging without administrative interruptions.",
        stepsAr: [
          "افتح تبويب (المخزون Inventory) ثم اختر (إدارة الوحدات والأصناف).",
          "حدد الصنف واضغط على (إضافة وحدة تعبئة/تحويل) مع إدخال اسم الوحدة ومعامل التحويل للأساس.",
          "عند إصدار فاتورة أو سند استلام، اختر الوحدة المرغوبة وسيقوم النظام باحتساب رصيد المستودع بالوحدة الأساسية آلياً.",
        ],
        stepsEn: [
          "Open the Inventory tab and view the Multi-Unit Inventory & Warehouses panel.",
          "Select any item and configure alternative units with their factorToBase conversion.",
          "When invoicing or moving stock, choose your preferred packaging unit to watch base balances update automatically.",
        ],
        keywordsAr: [
          "وحدات قياس",
          "كرتون",
          "شوالة",
          "معامل تحويل",
          "مستودع",
          "مخزون متعدد الوحدات",
          "وحدة أساسية",
          "أخرى مخصص",
        ],
        keywordsEn: [
          "uom",
          "unit of measure",
          "multi unit",
          "conversion factor",
          "factor to base",
          "warehouse",
          "carton",
          "custom unit",
        ],
        targetTab: "inventory",
        relatedAction: "navigate_tab",
      },
    ],
  },

  // =========================================================================
  // CHAPTER 7: Financial Reports & SQLite Backup/Restore
  // =========================================================================
  {
    chapterNumber: 7,
    id: "ch7-reports-backup",
    titleAr: "7. التقارير المالية الختامية والنسخ الاحتياطي والاستعادة (SQLite Backup/Restore)",
    titleEn: "7. Financial Reports (Trial Balance, P&L, Balance Sheet) & SQLite Backup/Restore",
    descriptionAr:
      "استخراج ميزان المراجعة، قائمة الدخل، الميزانية العمومية، التصدير إلى Excel، وحفظ واستعادة قاعدة البيانات SQLite.",
    descriptionEn:
      "Generating Trial Balance, Income Statement (P&L), and Balance Sheet reports, exporting to Excel, and backing up/restoring SQLite.",
    icon: "FileSpreadsheet",
    targetTab: "reports",
    sections: [
      {
        id: "ch7-sec1-financial-statements",
        chapterNumber: 7,
        chapterId: "ch7-reports-backup",
        titleAr: "ميزان المراجعة، قائمة الدخل (الأرباح والخسائر)، والميزانية العمومية",
        titleEn: "Trial Balance, Income Statement (P&L), and Balance Sheet",
        summaryAr:
          "تقارير مالية لحظية متعددة المستويات مع مطابقة توازن الأصول مع الالتزامات وحقوق الملكية وصافي الربح.",
        summaryEn:
          "Real-time hierarchical financial statements verifying Total Debits === Total Credits and Assets === Liabilities + Equity + Net Income.",
        contentAr:
          "يوفر تبويب (التقارير المالية Financial Reports) ثلاثة قوائم مالية رئيسية محسوبة لحظياً من دفتر الأستاذ العام:\n1. ميزان المراجعة (Trial Balance): يعرض أرصدة ومجاميع المدين والدائن لجميع الحسابات عبر المستويات الهرمية مع التحقق من تطابق الإجمالي العام.\n2. قائمة الدخل / الأرباح والخسائر (Income Statement / P&L): تقارن إجمالي الإيرادات (الباب 4) بإجمالي المصروفات والتكاليف (الباب 5) لاستخراج صافي الربح أو الخسارة.\n3. قائمة المركز المالي / الميزانية العمومية (Balance Sheet): تعرض إجمالي الأصول (الباب 1) ومطابقتها مع الالتزامات (الباب 2) + حقوق الملكية (الباب 3) + صافي أرباح الفترة.\nكما يدعم النظام تصدير المصنف المحاسبي الكامل إلى ملف Excel (.xlsx) بضغطة زر.",
        contentEn:
          "The Financial Reports tab computes three authoritative statements directly from posted General Ledger lines:\n1. Trial Balance: Multi-level rollup of opening/period Debits, Credits, and net balances confirming Sum(Debit) === Sum(Credit).\n2. Income Statement (Profit & Loss): Aggregates Revenue (Class 4) minus Expenses (Class 5) to compute Net Profit/Loss.\n3. Balance Sheet: Summarizes Assets (Class 1) against Liabilities (Class 2) + Equity (Class 3) + Current Period Net Income.\nClick 'Export Excel (.xlsx)' in the top command bar to export the complete multi-sheet accounting workbook.",
        stepsAr: [
          "افتح تبويب (التقارير المالية Reports) من القائمة الجانبية.",
          "اختر نوع التقرير (ميزان المراجعة، قائمة الدخل، أو الميزانية العمومية) وحدد مستوى التفصيل أو المشروع.",
          "لتصدير التقارير والدفاتر إلى إكسل، اضغط على زر (تصدير Excel) في الشريط العلوي.",
        ],
        stepsEn: [
          "Open the Financial Reports (reports) tab from the sidebar.",
          "Switch between Trial Balance, Income Statement, and Balance Sheet, and filter by Project or COA depth level.",
          "Use the 'Export Excel' button in the top command bar to download a full .xlsx workbook.",
        ],
        keywordsAr: [
          "تقرير",
          "تقارير",
          "ميزان المراجعة",
          "قائمة الدخل",
          "الأرباح والخسائر",
          "الميزانية العمومية",
          "المركز المالي",
          "صافي الربح",
          "تصدير إكسل",
          "excel",
        ],
        keywordsEn: [
          "report",
          "reports",
          "trial balance",
          "income statement",
          "p&l",
          "profit and loss",
          "balance sheet",
          "net income",
          "net profit",
          "excel export",
          "xlsx",
        ],
        targetTab: "reports",
        relatedAction: "navigate_tab",
      },
      {
        id: "ch7-sec2-sqlite-backup-restore",
        chapterNumber: 7,
        chapterId: "ch7-reports-backup",
        titleAr: "النسخ الاحتياطي واستعادة قاعدة البيانات (SQLite Backup & Restore)",
        titleEn: "SQLite Database Backup, Restore & Disaster Recovery",
        summaryAr:
          "حفظ نسخ احتياطية آمنة من ملف قاعدة البيانات SQLite في C:\\UAS-Data ومصنفات Excel واستعادتها عند الحاجة.",
        summaryEn:
          "Backing up and restoring the self-contained SQLite database (C:\\UAS-Data) and offline snapshots without data loss.",
        contentAr:
          "تُخزن جميع البيانات المالية في ملف قاعدة بيانات SQLite مستقل وموحد (في المسار C:\\UAS-Data\\uas-enterprise.db على ويندوز أو prisma/dev.db):\n• النسخ التلقائي الدوري (Daily Rolling Snapshots): يقوم النظام يومياً عند بدء التشغيل بأخذ نسخة احتياطية ذرية متسقة عبر أمر VACUUM INTO داخل المجلد C:\\UAS-Data\\backups ويحتفظ بآخر 14 نسخة تلقائياً لحفظ مساحة القرص.\n• تصدير نسخة احتياطية (.uasbak): من تبويب (إدارة النظام والأمان) > (النسخ الاحتياطي واستعادة البيانات)، اضغط (تحميل نسخة احتياطية الآن) لتنزيل حزمة موثقة ومتحقق منها تشفيرياً ببصمة SHA-256، متوافقة مع كل من تطبيق الويندوز وتطبيق الأندرويد والمتصفح.\n• الاستعادة الآمنة مع قفل المنشأة (Safe Restore with Company Lock): يدعم النظام استعادة ملفات .uasbak أو قواعد بيانات .db مع فحص تكامل SQLite والتحقق الصارم من تطابق اسم المنشأة لمنع استبدال دفاتر شركة بأخرى بالخطأ، مع إنشاء نسخة أمان احتياطية تلقائياً قبل الاستبدال (Pre-Restore Snapshot).\n• حماية ساعة النظام (Monotonic Anti-Clock-Rollback): يراقب النظام أي تراجع في ساعة الجهاز لمنع التلاعب بتواريخ الصلاحية أو القيود.",
        contentEn:
          "All financial data lives in a self-contained SQLite database file (C:\\UAS-Data on Windows desktop):\n• Daily Rolling Backups: The server automatically creates an atomic SQLite snapshot via `VACUUM INTO` on startup (at most once every 24 hours) stored in `C:\\UAS-Data\\backups`, keeping the 14 most recent snapshots.\n• 1-Click .uasbak Export: In System Settings > Backup & Disaster Recovery, click 'Download Backup (.uasbak)' to export an SHA-256 verified backup envelope compatible with Windows desktop, Android APK, and web browsers.\n• Safe Restore with Company Lock: Restoring from file or server snapshot validates SQLite integrity, enforces strict company name matching against the active license to prevent overwriting across tenants, and automatically saves a safety pre-restore backup before replacement.\n• Anti-Clock-Rollback Protection: Monotonic clock checks block write mutations if the system clock is rolled backward.",
        stepsAr: [
          "لتحميل نسخة احتياطية فورية: افتح (إدارة النظام والأمان) > اضغط (تحميل نسخة احتياطية الآن .uasbak).",
          "لاستعادة نسخة احتياطية: اضغط (استعادة من ملف) أو اختر أي نسخة يومية من جدول النسخ التلقائية واضغط (استعادة).",
          "سيطلب النظام التأكيد وسيقوم تلقائياً بإنشاء نسخة أمان احتياطية قبل الاستبدال (Pre-Restore Snapshot).",
          "لأخذ نسخة خارجية كاملة: انسخ مجلد C:\\UAS-Data إلى وحدة تخزين خارجية (USB) أو قرص سحابي آمن.",
        ],
        stepsEn: [
          "To export an immediate backup: navigate to System Settings > click 'Download Backup (.uasbak)'.",
          "To restore a backup: click 'Restore from File' or select an automated daily snapshot and click 'Restore'.",
          "The system will prompt for confirmation and automatically take a safety pre-restore snapshot before applying changes.",
          "For cold backups: copy the entire C:\\UAS-Data folder to an external USB drive or secure external storage.",
        ],
        keywordsAr: [
          "نسخ احتياطي",
          "نسخة احتياطية",
          "استعادة",
          "باك اب",
          "فقدان البيانات",
          "نقل النظام",
          "قاعدة بيانات",
          "sqlite",
          "c:\\uas-data",
          "uasbak",
          "vacuum into",
          "نسخ تلقائي",
          "تلاعب بالساعة",
        ],
        keywordsEn: [
          "backup",
          "restore",
          "sqlite",
          "database file",
          "c:\\uas-data",
          "uasbak",
          "vacuum into",
          "rolling backup",
          "recovery",
          "migrate pc",
          "clock rollback",
          "clock tamper",
        ],
        targetTab: "system",
        relatedAction: "navigate_tab",
      },
    ],
  },
];

export function getAllSupportSections(): SupportManualSection[] {
  return UAS_SUPPORT_CHAPTERS.flatMap((ch) => ch.sections);
}

export function getSupportChapterByNumber(chapterNumber: number): SupportChapter | undefined {
  return UAS_SUPPORT_CHAPTERS.find((ch) => ch.chapterNumber === chapterNumber);
}
