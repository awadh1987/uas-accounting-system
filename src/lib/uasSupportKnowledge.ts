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
          "تُخزن جميع البيانات المالية في ملف قاعدة بيانات SQLite مستقل وموحد (في المسار C:\\UAS-Data\\uas-enterprise.db على ويندوز أو prisma/dev.db):\n• النسخ الاحتياطي (Backup): يمكنك أخذ نسخة احتياطية فورية بنسخ ملف قاعدة البيانات في C:\\UAS-Data بالإضافة إلى تصدير المصنف الكامل بصيغة Excel (.xlsx) من الشريط العلوي.\n• الاستعادة (Restore): لاستعادة نسخة احتياطية على جهاز جديد، قم بتثبيت البرنامج، تفعيل ترخيص المنشأة، ثم وضع ملف قاعدة البيانات الاحتياطي في C:\\UAS-Data؛ سيقوم محرك التهيئة الذاتية (sqliteBootstrap) بالتحقق من سلامة الجداول وتشغيلها فوراً.\n• حماية ساعة النظام (Monotonic Anti-Clock-Rollback): يراقب النظام أي تراجع في ساعة الجهاز لمنع التلاعب بتواريخ الصلاحية أو القيود.",
        contentEn:
          "All financial data lives in a self-contained SQLite database file (C:\\UAS-Data on Windows desktop):\n• Backup: Copy the SQLite database file from C:\\UAS-Data (along with license.uas) to an external USB drive or secure cloud folder, and export periodic Excel (.xlsx) workbooks from the top bar.\n• Restore: On a replacement machine, install UAS, place your backed-up SQLite database and license.uas in C:\\UAS-Data, and launch the app. The pure-runtime self-healing bootstrap automatically verifies schema integrity.\n• Anti-Clock-Rollback Protection: Monotonic clock checks block write mutations if the system clock is rolled backward.",
        stepsAr: [
          "لأخذ نسخة احتياطية سريعة: اضغط (تصدير Excel) من الشريط العلوي، وانسخ مجلد C:\\UAS-Data إلى وحدة تخزين خارجية (USB).",
          "عند استبدال جهاز كمبيوتر: اطلب من مدير النظام العام (SUPER_ADMIN) الضغط على (إلغاء ربط الجهاز) للجهاز القديم، ثم انسخ C:\\UAS-Data للجهاز الجديد وفعّل الترخيص.",
        ],
        stepsEn: [
          "For immediate backup: click 'Export Excel' in the top bar and copy C:\\UAS-Data to an external USB or backup drive.",
          "When migrating to a new PC: have SUPER_ADMIN click 'Release Device Seat' for the old PC, copy C:\\UAS-Data to the new PC, and activate.",
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
          "تلاعب بالساعة",
        ],
        keywordsEn: [
          "backup",
          "restore",
          "sqlite",
          "database file",
          "c:\\uas-data",
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
