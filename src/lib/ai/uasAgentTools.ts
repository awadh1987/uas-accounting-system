/**
 * UAS Enterprise — Cross-Module RBAC Tool Registry & Financial Safety Guardrails
 *
 * Implements all 11 typed ERP tools across Navigation, Accounting, Invoicing & Inventory,
 * and Reports & Support.
 *
 * Zero Node-only dependencies — runs identically on the server (with SQLite adapter)
 * and 100% offline in the Windows Desktop & Capacitor Android client.
 */
import { STANDARD_COA_NODES } from "@/lib/accounting/coaCatalog";
import {
  canAccessModule,
  canCreate,
  canLockPeriod,
  canPostLedger,
  isReadOnly,
  normalizeRole,
  type ModuleIdentifier,
} from "@/lib/permissions";
import {
  answerSupportQuery,
  diagnoseLiveSystemState,
  type SupportSystemDiagnostics,
} from "@/lib/localSupportEngine";
import { buildCopilotGreetingFallback } from "./yemeniLocalization";
import {
  evaluateSaleAgainstHarvestStock,
  reconcileHarvestInventory,
} from "@/lib/harvestReconciliation";
import type { CopilotMemoryEntry } from "./copilotMemoryTypes";
import type {
  TabId,
  UasBootstrapState,
  UasCoaAccount,
  UasProject,
  UasUser,
  UserRole,
} from "@/types/uas";

export type UasAgentToolName =
  | "navigate_to_module"
  | "query_account_balance"
  | "search_journal_entries"
  | "draft_journal_entry"
  | "draft_voucher"
  | "draft_invoice"
  | "check_item_stock"
  | "verify_qr_document"
  | "generate_report_summary"
  | "diagnose_system_health"
  | "search_user_manual"
  | "create_customer"
  | "create_vendor"
  | "create_project"
  | "export_client_report"
  | "query_workspace_data"
  | "reconcile_harvest_inventory"
  | "analyze_workspace_context"
  | "draft_harvest_batch"
  | "draft_sale_transaction"
  | "draft_operating_expense"
  | "draft_worker_wage"
  | "draft_treasury_transfer"
  | "toggle_period_lock"
  | "add_harvest_cycle";

export interface UasWorkspaceContext {
  activeTab?: TabId;
  selectedProjectId?: string | null;
  selectedSubProjectId?: string | null;
  selectedHarvest?: string | null;
  tenantSlug?: string | null;
  runtimeMode?: string;
  offlineQueueCount?: number;
  pendingConflictsCount?: number;
  isOffline?: boolean;
  currency?: string;
  dialect?: "yemeni" | "msa";
}

export interface PreFlightCheckItem {
  key: string;
  status: "ok" | "warning" | "blocked";
  labelAr: string;
  labelEn: string;
  detailAr?: string;
  detailEn?: string;
}

export interface CitationLink {
  labelAr: string;
  labelEn: string;
  tab: TabId;
  referenceId?: string;
  type: "tab" | "record" | "manual";
}

export interface ClarificationOption {
  labelAr: string;
  labelEn: string;
  promptFill: string;
}

export interface ClarificationPromptData {
  questionAr: string;
  questionEn: string;
  missingFields: string[];
  quickOptions: ClarificationOption[];
}

export interface EscalationCardData {
  reasonCode: string;
  reasonAr: string;
  reasonEn: string;
  moduleTab?: TabId;
  referenceId?: string;
  adminContact: {
    name?: string;
    phone?: string;
    email?: string;
    whatsApp?: string;
  };
  supportContact: {
    hotline: string;
    whatsApp: string;
    email: string;
    portalUrl: string;
  };
}

export interface PreviewLedgerLine {
  accountCode: string;
  accountNameAr: string;
  accountNameEn: string;
  debit: number;
  credit: number;
  memo?: string;
  costCenterId?: string | null;
  currency?: string;
  exchangeRate?: number;
  factorToBase?: number;
}

export interface ConfirmationPreviewCard {
  actionId: string;
  toolName:
    | "draft_journal_entry"
    | "draft_voucher"
    | "draft_invoice"
    | "create_customer"
    | "create_vendor"
    | "create_project"
    | "export_client_report"
    | "draft_harvest_batch"
    | "draft_sale_transaction"
    | "draft_operating_expense"
    | "draft_worker_wage"
    | "draft_treasury_transfer"
    | "toggle_period_lock"
    | "add_harvest_cycle";
  operationType:
    | "JOURNAL_ENTRY"
    | "RECEIPT_VOUCHER"
    | "PAYMENT_VOUCHER"
    | "SALES_INVOICE"
    | "PURCHASE_BILL"
    | "CREATE_CUSTOMER"
    | "CREATE_VENDOR"
    | "CREATE_PROJECT"
    | "EXPORT_CLIENT_REPORT"
    | "RECORD_HARVEST_BATCH"
    | "RECORD_SALE"
    | "RECORD_EXPENSE"
    | "RECORD_WORKER_WAGE"
    | "TREASURY_TRANSFER"
    | "TOGGLE_PERIOD_LOCK"
    | "ADD_HARVEST_CYCLE";
  titleAr: string;
  titleEn: string;
  narrationAr: string;
  narrationEn: string;
  date: string;
  currency: "YER" | "SAR" | "USD" | string;
  exchangeRate?: number;
  costCenterId?: string | null;
  totalDebit: number;
  totalCredit: number;
  isBalanced: boolean;
  partyName?: string;
  projectId?: string;
  lines: PreviewLedgerLine[];
  preFlightChecks?: PreFlightCheckItem[];
  warningsAr?: string[];
  warningsEn?: string[];
  endpoint?: string;
  httpMethod?: "POST" | "PATCH" | "DELETE";
  confirmButtonLabelAr: string;
  confirmButtonLabelEn: string;
  confirmButtonLabel: string;
  executionPayload: Record<string, unknown>;
}

export interface UasAgentJournalSummary {
  id: string;
  entryNumber: string;
  date: string;
  narrationAr: string;
  narrationEn?: string;
  totalDebit: number;
  totalCredit: number;
  status: string;
}

export interface UasAgentReportSnapshot {
  totalDebits: number;
  totalCredits: number;
  isBalanced: boolean;
  totalRevenue: number;
  totalExpenses: number;
  netIncome: number;
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
}

export interface UasAgentExecutionContext {
  user?: UasUser | UserRole | string | null;
  lang?: "ar" | "en";
  state?: UasBootstrapState | null;
  workspaceContext?: UasWorkspaceContext | null;
  coaAccounts?: Array<Pick<UasCoaAccount, "code" | "nameAr" | "nameEn" | "level" | "type" | "isPosting" | "rolledUpBalance" | "balance">>;
  journalEntries?: UasAgentJournalSummary[];
  reportSnapshot?: UasAgentReportSnapshot | null;
  diagnostics?: Partial<SupportSystemDiagnostics> | null;
  memories?: CopilotMemoryEntry[];
  qrLookupHook?: (code: string) => Promise<{
    verified: boolean;
    documentType?: string;
    reference?: string;
    party?: string;
    amount?: number;
    currency?: string;
    date?: string;
    status?: string;
  } | null>;
}

export interface UasAgentToolResult {
  ok: boolean;
  toolName: UasAgentToolName;
  code?: string;
  requiresConfirmation: boolean;
  summaryAr: string;
  summaryEn: string;
  summary: string;
  data?: Record<string, unknown>;
  navigationTab?: TabId;
  openLicenseModal?: boolean;
  confirmationCard?: ConfirmationPreviewCard;
  citations?: CitationLink[];
  clarificationPrompt?: ClarificationPromptData;
  escalationCard?: EscalationCardData;
}

export interface UasAgentToolSchema {
  name: UasAgentToolName;
  isWriteTool: boolean;
  descriptionAr: string;
  descriptionEn: string;
  parameters: Record<string, string>;
}

export const UAS_AGENT_TOOL_SCHEMAS: UasAgentToolSchema[] = [
  {
    name: "navigate_to_module",
    isWriteTool: false,
    descriptionAr: "فتح أي قسم أو شاشة في منظومة UAS مباشرة مع التحقق من صلاحية الدور (RBAC).",
    descriptionEn: "Navigate directly to any UAS ERP module/tab with RBAC permission verification.",
    parameters: { tab: "dashboard|coa|ledger|treasury|sales|customers|procurement|inventory|projects|expenses|workers|reports|audit|system|mobile" },
  },
  {
    name: "query_account_balance",
    isWriteTool: false,
    descriptionAr: "الاستعلام عن رصيد وتفاصيل أي حساب في شجرة الحسابات الخماسية أو الخزينة.",
    descriptionEn: "Query balance and hierarchy metadata for any COA or Treasury account by code or name.",
    parameters: { query: "account code (e.g. 111101) or Arabic/English name" },
  },
  {
    name: "search_journal_entries",
    isWriteTool: false,
    descriptionAr: "البحث في قيود اليومية ودفتر الأستاذ العام حسب البيان أو رقم القيد أو المبلغ.",
    descriptionEn: "Search General Ledger journal entries by keyword, reference, or account code.",
    parameters: { search: "keyword or entry number", limit: "optional max entries" },
  },
  {
    name: "draft_journal_entry",
    isWriteTool: true,
    descriptionAr: "إعداد مسودة قيد يومية مزدوج متوازن (Debit === Credit) على حسابات فرعية قابلة للترحيل (يتطلب تأكيد المستخدم).",
    descriptionEn: "Draft a balanced double-entry journal voucher on valid 5-level leaf COA accounts (requires explicit user confirmation).",
    parameters: {
      narrationAr: "Arabic narration",
      narrationEn: "English narration",
      date: "YYYY-MM-DD",
      currency: "YER|SAR|USD",
      lines: "Array<{ accountCode, debit, credit, memo? }>",
    },
  },
  {
    name: "draft_voucher",
    isWriteTool: true,
    descriptionAr: "إعداد مسودة سند قبض أو سند صرف مع توليد قيد اليومية المزدوج المعاين (يتطلب تأكيد المستخدم).",
    descriptionEn: "Draft a Receipt Voucher or Payment Voucher with a balanced Debit/Credit preview card (requires explicit user confirmation).",
    parameters: {
      voucherType: "RECEIPT|PAYMENT",
      partyName: "customer or payee/vendor name",
      amount: "positive amount",
      currency: "YER|SAR|USD",
      narration: "description",
      treasuryAccountCode: "optional treasury COA code (default 111101)",
      counterpartyAccountCode: "optional counterparty COA code",
    },
  },
  {
    name: "draft_invoice",
    isWriteTool: true,
    descriptionAr: "إعداد مسودة فاتورة مبيعات أو فاتورة مشتريات مع معاينة القيد المحاسبي المزدوج (يتطلب تأكيد المستخدم).",
    descriptionEn: "Draft a Sales Invoice or Purchase Bill with a balanced Debit/Credit preview card (requires explicit user confirmation).",
    parameters: {
      invoiceType: "SALES|PURCHASE",
      partyName: "customer or vendor name",
      itemName: "item or grade description",
      quantity: "quantity",
      unitPrice: "unit price",
      amount: "optional total amount override",
      paymentMethod: "CASH|CREDIT",
      currency: "YER|SAR|USD",
    },
  },
  {
    name: "check_item_stock",
    isWriteTool: false,
    descriptionAr: "فحص الكميات المتوفرة في المخزون والدفعات ومواسم الحصاد.",
    descriptionEn: "Check available stock quantities across inventory lots and harvest batches.",
    parameters: { query: "optional item or grade name filter" },
  },
  {
    name: "verify_qr_document",
    isWriteTool: false,
    descriptionAr: "التحقق من صحة وموثوقية أي فاتورة أو سند عبر رقم السند أو بصمة QR الرقمية.",
    descriptionEn: "Verify authenticity of any voucher, invoice, or document by reference number or SHA-256 QR code.",
    parameters: { code: "voucher number, invoice number, or QR hash" },
  },
  {
    name: "generate_report_summary",
    isWriteTool: false,
    descriptionAr: "توليد ملخص فوري لميزان المراجعة أو قائمة الدخل (الأرباح والخسائر) أو الميزانية العمومية.",
    descriptionEn: "Generate an instant summary of the Trial Balance, Income Statement (P&L), or Balance Sheet.",
    parameters: { reportType: "trial_balance|income_statement|balance_sheet|all" },
  },
  {
    name: "diagnose_system_health",
    isWriteTool: false,
    descriptionAr: "تشخيص حالة الترخيص، تطابق اسم المنشأة، مقاعد الـ 7 مستخدمين (ويندوز وأندرويد)، ووضع التشغيل.",
    descriptionEn: "Run live diagnostics on license validity, company-name lock, 7-user × (1 Win + 1 Android) seats, and runtime mode.",
    parameters: {},
  },
  {
    name: "search_user_manual",
    isWriteTool: false,
    descriptionAr: "البحث في دليل المستخدم وقاعدة معرفة خدمة العملاء (7 فصول بالعربية والإنجليزية).",
    descriptionEn: "Search the embedded 7-chapter bilingual User Manual and Customer Service knowledge base.",
    parameters: { query: "question or topic in Arabic or English" },
  },
  {
    name: "create_customer",
    isWriteTool: true,
    descriptionAr: "إنشاء عميل (زبون) جديد مع توليد حساب فرعي تلقائي بالجيل السادس (1121xx) ومركز تكلفة خاص (يتطلب تأكيد المستخدم).",
    descriptionEn: "Create a new client/customer with auto-provisioned Gen-6 GL leaf account (1121xx) and Cost Center (requires explicit user confirmation).",
    parameters: {
      name: "Arabic/primary customer name",
      phone: "optional phone number",
      creditLimit: "optional credit limit in YER",
      costCenterId: "optional cost center code",
      address: "optional address",
    },
  },
  {
    name: "create_vendor",
    isWriteTool: true,
    descriptionAr: "إنشاء مورد (vendor) جديد مع توليد حساب فرعي تلقائي بالجيل السادس (2111xx) ومركز تكلفة خاص (يتطلب تأكيد المستخدم).",
    descriptionEn: "Create a new supplier/vendor with auto-provisioned Gen-6 GL leaf account (2111xx) and Cost Center (requires explicit user confirmation).",
    parameters: {
      nameAr: "supplier name in Arabic",
      phone: "contact phone number",
      costCenterId: "optional cost center code",
      email: "optional email",
      address: "optional address",
    },
  },
  {
    name: "create_project",
    isWriteTool: true,
    descriptionAr: "إنشاء مشروع زراعي/تشغيلي جديد مع تحديد الموازنة ومركز التكلفة ودورات الحصاد (يتطلب تأكيد المستخدم).",
    descriptionEn: "Create a new project with budget, cost center, and harvest cycles (requires explicit user confirmation).",
    parameters: {
      name: "project name",
      budgetTotal: "budget amount in YER",
      costCenterId: "optional cost center code",
      plannedHarvests: "number of harvest cycles (default 1)",
      notes: "optional notes",
    },
  },
  {
    name: "export_client_report",
    isWriteTool: false,
    descriptionAr: "توليد كشف حساب وتصدير تقرير عميل مع خيار تضمين تفاصيل كل عملية بيع للطباعة وPDF.",
    descriptionEn: "Generate and export client account statement with optional itemized per-sale details for PDF/print.",
    parameters: {
      customerName: "customer name or code",
      includeSaleDetails: "true | false (include per-sale item breakdown)",
    },
  },
  {
    name: "query_workspace_data",
    isWriteTool: false,
    descriptionAr: "البحث في بيانات مساحة العمل اللحظية (العملاء، الموردين، المشاريع، المخزون، العمال، الخزينة، التدقيق) مع روابط الاقتباس المباشرة.",
    descriptionEn: "Live workspace search for customers, vendors, projects, inventory, workers, treasury, audit locks, and vouchers with citation links.",
    parameters: {
      query: "search query or target entity name",
      scope: "all|customers|vendors|projects|inventory|vouchers|workers|treasury|audit",
    },
  },
  {
    name: "reconcile_harvest_inventory",
    isWriteTool: false,
    descriptionAr: "مطابقة مخزون الحصاد والمبيعات والفاقد والعجز والمبالغ المستحقة لكل مشروع وقطفة.",
    descriptionEn: "Cross-check harvest batches, spoilage/shrinkage, sales quantities, shortages, and open receivables per project & harvest.",
    parameters: {
      projectId: "optional project ID or name",
      harvest: "optional harvest cycle name",
      grade: "optional product grade",
    },
  },
  {
    name: "analyze_workspace_context",
    isWriteTool: false,
    descriptionAr: "تحليل سياق الشاشة النشطة والمشروع المختار وحالة الاتصال والمزامنة وتقديم توصيات ومؤشرات مخاطر عابرة للأقسام.",
    descriptionEn: "Inspect active tab, selected project/harvest, online/offline sync state, and surface cross-section risks and next actions.",
    parameters: {
      focus: "optional topic or section to prioritize",
    },
  },
  {
    name: "draft_harvest_batch",
    isWriteTool: true,
    descriptionAr: "إعداد مسودة تسجيل دفعة قطفة ومخزون حصاد جديدة مع فحص إغلاق القطفة (يتطلب تأكيد المستخدم).",
    descriptionEn: "Draft a new harvest inventory batch with period-lock pre-flight checks (requires user confirmation).",
    parameters: {
      projectId: "optional project ID",
      projectName: "optional project name",
      harvest: "harvest cycle name",
      grade: "product grade (e.g. رقم 1)",
      harvestedBundles: "harvested bundles count",
      shrinkageBundles: "optional spoilage/shrinkage count",
      notes: "optional notes",
    },
  },
  {
    name: "draft_sale_transaction",
    isWriteTool: true,
    descriptionAr: "إعداد مسودة عملية بيع مع فحص توفر مخزون القطفة وإغلاق الفترة ومديونية العميل ورصيد الخزينة (يتطلب تأكيد المستخدم).",
    descriptionEn: "Draft a harvest sale transaction with cross-section stock, period-lock, customer AR, and treasury checks (requires user confirmation).",
    parameters: {
      customer: "customer name",
      bundles: "quantity sold",
      price: "unit price",
      credit: "amount paid immediately",
      projectId: "optional project ID",
      harvest: "optional harvest cycle name",
      grade: "optional product grade",
      treasuryAccountId: "optional treasury ID",
    },
  },
  {
    name: "draft_operating_expense",
    isWriteTool: true,
    descriptionAr: "إعداد مسودة مصروف تشغيلي (وقود، وجبات، صيانة، نقل) مع فحص إغلاق القطفة والموازنة وسيولة الخزينة (يتطلب تأكيد المستخدم).",
    descriptionEn: "Draft an operating expense entry with period-lock, project budget, and treasury balance checks (requires user confirmation).",
    parameters: {
      category: "expense category",
      subType: "optional expense item details",
      qty: "quantity (default 1)",
      unitPrice: "unit price or total amount",
      projectId: "optional project ID",
      harvest: "optional harvest cycle",
      treasuryAccountId: "optional treasury account ID",
    },
  },
  {
    name: "draft_worker_wage",
    isWriteTool: true,
    descriptionAr: "إعداد مسودة أجر يومي لعامل مع فحص القطفة والموازنة والمصروف المدفوع والمتبقي (يتطلب تأكيد المستخدم).",
    descriptionEn: "Draft a daily worker wage entry with period-lock and paid vs accrued wage validation (requires user confirmation).",
    parameters: {
      name: "worker full name",
      dailyWage: "daily wage rate",
      days: "number of days worked (default 1)",
      credit: "amount paid upfront",
      projectId: "optional project ID",
      harvest: "optional harvest cycle",
    },
  },
  {
    name: "draft_treasury_transfer",
    isWriteTool: true,
    descriptionAr: "إعداد مسودة تحويل مالي بين حسابات الخزينة والبنوك مع فحص كفاية الرصيد ورسوم التحويل (يتطلب تأكيد المستخدم).",
    descriptionEn: "Draft an internal treasury transfer between cashboxes/banks with balance sufficiency check (requires user confirmation).",
    parameters: {
      fromTreasuryId: "source treasury ID or name",
      toTreasuryId: "destination treasury ID or name",
      amount: "transfer amount",
      notes: "optional transfer reference/notes",
    },
  },
  {
    name: "toggle_period_lock",
    isWriteTool: true,
    descriptionAr: "إغلاق أو إعادة فتح فترة قطفة محاسبياً مع فحص صلاحية الإدارة وتدقيق المخزون والذمم قبل الإقفال (يتطلب تأكيد المستخدم).",
    descriptionEn: "Lock or unlock a harvest period with RBAC verification and stock/receivables pre-lock audit (requires user confirmation).",
    parameters: {
      projectId: "optional project ID",
      projectName: "optional project name",
      harvest: "harvest cycle name",
    },
  },
  {
    name: "add_harvest_cycle",
    isWriteTool: true,
    descriptionAr: "إضافة قطفة أو مرشة جديدة لمشروع قائم مع التحقق من عدم التكرار (يتطلب تأكيد المستخدم).",
    descriptionEn: "Add a new harvest cycle to an existing project (requires user confirmation).",
    parameters: {
      projectId: "optional project ID",
      projectName: "optional project name",
      name: "harvest cycle name",
    },
  },
];

// ---------------------------------------------------------------------------
// COA Resolution & Tab Alias Helpers
// ---------------------------------------------------------------------------

export interface ResolvedCoaNode {
  code: string;
  nameAr: string;
  nameEn: string;
  level: number;
  type: string;
  isPosting: boolean;
  balance: number;
}

export function getMergedCoaCatalog(ctx: UasAgentExecutionContext): ResolvedCoaNode[] {
  const byCode = new Map<string, ResolvedCoaNode>();

  for (const seed of STANDARD_COA_NODES) {
    byCode.set(seed.code, {
      code: seed.code,
      nameAr: seed.nameAr,
      nameEn: seed.nameEn,
      level: seed.level,
      type: seed.type,
      isPosting: seed.isPosting,
      balance: 0,
    });
  }

  if (Array.isArray(ctx.coaAccounts)) {
    for (const acc of ctx.coaAccounts) {
      byCode.set(acc.code, {
        code: acc.code,
        nameAr: acc.nameAr,
        nameEn: acc.nameEn,
        level: Number(acc.level),
        type: acc.type,
        isPosting: Boolean(acc.isPosting),
        balance: Number(acc.rolledUpBalance ?? acc.balance ?? 0),
      });
    }
  }

  // Enrich main cash vault balance from bootstrap state if available
  if (ctx.state?.treasuryAccounts?.length) {
    const mainVault = ctx.state.treasuryAccounts[0];
    const cashNode = byCode.get("111101");
    if (cashNode && cashNode.balance === 0 && mainVault) {
      cashNode.balance = Number(mainVault.balanceYER ?? mainVault.balance ?? 0);
    }
  }

  return [...byCode.values()];
}

export function findCoaAccount(
  catalog: ResolvedCoaNode[],
  codeOrQuery: string
): ResolvedCoaNode | undefined {
  const q = String(codeOrQuery ?? "").trim();
  if (!q) return undefined;

  const exactCode = catalog.find((a) => a.code === q);
  if (exactCode) return exactCode;

  const qLower = q.toLowerCase();

  // 1. Prioritize Generation 6 leaf posting accounts (level === 6 && isPosting)
  const gen6Match = catalog.find(
    (a) =>
      a.isPosting &&
      a.level === 6 &&
      (a.nameAr.includes(q) || a.nameEn.toLowerCase().includes(qLower))
  );
  if (gen6Match) return gen6Match;

  // 2. Prioritize Generation 5+ leaf posting accounts (level >= 5 && isPosting)
  const postingMatch = catalog.find(
    (a) =>
      a.isPosting &&
      a.level >= 5 &&
      (a.nameAr.includes(q) || a.nameEn.toLowerCase().includes(qLower))
  );
  if (postingMatch) return postingMatch;

  // 3. Any leaf posting account
  const anyPosting = catalog.find(
    (a) =>
      a.isPosting &&
      (a.nameAr.includes(q) || a.nameEn.toLowerCase().includes(qLower))
  );
  if (anyPosting) return anyPosting;

  return catalog.find(
    (a) => a.nameAr.includes(q) || a.nameEn.toLowerCase().includes(qLower)
  );
}

const TAB_ALIASES: Record<string, { tab: TabId; labelAr: string; labelEn: string }> = {
  dashboard: { tab: "dashboard", labelAr: "لوحة القيادة والملخصات", labelEn: "Executive Dashboard" },
  "لوحة القيادة": { tab: "dashboard", labelAr: "لوحة القيادة والملخصات", labelEn: "Executive Dashboard" },
  "الرئيسية": { tab: "dashboard", labelAr: "لوحة القيادة والملخصات", labelEn: "Executive Dashboard" },
  coa: { tab: "coa", labelAr: "شجرة الحسابات (5-Tier COA)", labelEn: "Chart of Accounts (COA)" },
  "شجرة الحسابات": { tab: "coa", labelAr: "شجرة الحسابات (5-Tier COA)", labelEn: "Chart of Accounts (COA)" },
  "دليل الحسابات": { tab: "coa", labelAr: "شجرة الحسابات (5-Tier COA)", labelEn: "Chart of Accounts (COA)" },
  ledger: { tab: "ledger", labelAr: "دفتر اليومية والأستاذ العام", labelEn: "General Ledger" },
  "دفتر الأستاذ": { tab: "ledger", labelAr: "دفتر اليومية والأستاذ العام", labelEn: "General Ledger" },
  "دفتر اليومية": { tab: "ledger", labelAr: "دفتر اليومية والأستاذ العام", labelEn: "General Ledger" },
  "القيود": { tab: "ledger", labelAr: "دفتر اليومية والأستاذ العام", labelEn: "General Ledger" },
  treasury: { tab: "treasury", labelAr: "الخزينة والبنوك والمحافظ", labelEn: "Treasury, Banks & Wallets" },
  "الخزينة": { tab: "treasury", labelAr: "الخزينة والبنوك والمحافظ", labelEn: "Treasury, Banks & Wallets" },
  "الصندوق": { tab: "treasury", labelAr: "الخزينة والبنوك والمحافظ", labelEn: "Treasury, Banks & Wallets" },
  "البنوك": { tab: "treasury", labelAr: "الخزينة والبنوك والمحافظ", labelEn: "Treasury, Banks & Wallets" },
  sales: { tab: "sales", labelAr: "المبيعات والفواتير", labelEn: "Sales & Invoicing" },
  "المبيعات": { tab: "sales", labelAr: "المبيعات والفواتير", labelEn: "Sales & Invoicing" },
  customers: { tab: "customers", labelAr: "العملاء والمدينون", labelEn: "Customers & Receivables" },
  "العملاء": { tab: "customers", labelAr: "العملاء والمدينون", labelEn: "Customers & Receivables" },
  procurement: { tab: "procurement", labelAr: "المشتريات والموردون", labelEn: "Procurement & Vendors" },
  "المشتريات": { tab: "procurement", labelAr: "المشتريات والموردون", labelEn: "Procurement & Vendors" },
  "الموردين": { tab: "procurement", labelAr: "المشتريات والموردون", labelEn: "Procurement & Vendors" },
  inventory: { tab: "inventory", labelAr: "المخزون والدفعات", labelEn: "Inventory & Batches" },
  "المخزون": { tab: "inventory", labelAr: "المخزون والدفعات", labelEn: "Inventory & Batches" },
  projects: { tab: "projects", labelAr: "المشاريع ومواسم الحصاد", labelEn: "Projects & Harvest Cycles" },
  "المشاريع": { tab: "projects", labelAr: "المشاريع ومواسم الحصاد", labelEn: "Projects & Harvest Cycles" },
  expenses: { tab: "expenses", labelAr: "المصروفات التشغيلية", labelEn: "Operating Expenses" },
  "المصروفات": { tab: "expenses", labelAr: "المصروفات التشغيلية", labelEn: "Operating Expenses" },
  workers: { tab: "workers", labelAr: "العمال والأجور اليومية", labelEn: "Workers & Daily Wages" },
  "العمال": { tab: "workers", labelAr: "العمال والأجور اليومية", labelEn: "Workers & Daily Wages" },
  reports: { tab: "reports", labelAr: "التقارير والقوائم المالية", labelEn: "Financial Reports" },
  "التقارير": { tab: "reports", labelAr: "التقارير والقوائم المالية", labelEn: "Financial Reports" },
  "ميزان المراجعة": { tab: "reports", labelAr: "التقارير والقوائم المالية", labelEn: "Financial Reports" },
  "قائمة الدخل": { tab: "reports", labelAr: "التقارير والقوائم المالية", labelEn: "Financial Reports" },
  "الميزانية": { tab: "reports", labelAr: "التقارير والقوائم المالية", labelEn: "Financial Reports" },
  audit: { tab: "audit", labelAr: "سجل التدقيق والرقابة", labelEn: "Immutable Audit Trail" },
  "التدقيق": { tab: "audit", labelAr: "سجل التدقيق والرقابة", labelEn: "Immutable Audit Trail" },
  system: { tab: "system", labelAr: "إدارة النظام والصلاحيات والهوية", labelEn: "System, RBAC & Branding" },
  "النظام": { tab: "system", labelAr: "إدارة النظام والصلاحيات والهوية", labelEn: "System, RBAC & Branding" },
  "الإعدادات": { tab: "system", labelAr: "إدارة النظام والصلاحيات والهوية", labelEn: "System, RBAC & Branding" },
  mobile: { tab: "mobile", labelAr: "تطبيق الجوال والمزامنة", labelEn: "Mobile App & Sync" },
  prompt: { tab: "prompt", labelAr: "موجه الوكيل الذكي", labelEn: "Agent Prompt" },
};

export function resolveNavigationTarget(rawTarget: string): {
  tab: TabId;
  labelAr: string;
  labelEn: string;
} | null {
  const clean = String(rawTarget ?? "").trim().toLowerCase();
  if (!clean) return null;
  if (TAB_ALIASES[clean]) return TAB_ALIASES[clean];

  for (const [key, val] of Object.entries(TAB_ALIASES)) {
    if (clean.includes(key.toLowerCase()) || key.toLowerCase().includes(clean)) {
      return val;
    }
  }
  return null;
}

export function buildEscalationCard(params: {
  code: string;
  summaryAr: string;
  summaryEn: string;
  tab?: TabId;
  referenceId?: string;
  ctx?: UasAgentExecutionContext;
}): EscalationCardData {
  const { code, summaryAr, summaryEn, tab, referenceId, ctx } = params;
  const adminUser = ctx?.state?.users?.find(
    (u) => u.role === "SUPER_ADMIN" || u.role === "ADMIN"
  );
  const profile = ctx?.state?.enterpriseProfile;

  return {
    reasonCode: code || "POLICY_BLOCK",
    reasonAr: summaryAr,
    reasonEn: summaryEn,
    moduleTab: tab,
    referenceId,
    adminContact: {
      name: profile?.legalNameAr || adminUser?.name || "مسؤول المنشأة المعتمد",
      phone: profile?.contactPhone || profile?.phone || adminUser?.phone || "777123456",
      email: profile?.email || adminUser?.email || "admin@uas-system.local",
      whatsApp: profile?.contactWhatsApp || profile?.phone || adminUser?.phone || "777123456",
    },
    supportContact: {
      hotline: "+967 777 000 000",
      whatsApp: "+967 777 000 000",
      email: "support@qat.world",
      portalUrl: "https://qat.world/support",
    },
  };
}

function makeResult(
  lang: "ar" | "en",
  partial: Omit<UasAgentToolResult, "summary">,
  ctx?: UasAgentExecutionContext
): UasAgentToolResult {
  let escalationCard = partial.escalationCard;
  const escalatableCodes = [
    "RBAC_FORBIDDEN",
    "CLOSED_FISCAL_YEAR",
    "SEATS_EXHAUSTED",
    "COMPANY_MISMATCH",
    "LICENSE_EXPIRED",
    "UNLICENSED",
    "DOCUMENT_NOT_FOUND",
    "COA_NON_POSTING_ACCOUNT",
    "UNBALANCED_JOURNAL_ENTRY",
    "APPROVAL_REQUIRED_POST_POSTING",
  ];
  if (!escalationCard && !partial.ok && partial.code && escalatableCodes.includes(partial.code)) {
    escalationCard = buildEscalationCard({
      code: partial.code,
      summaryAr: partial.summaryAr,
      summaryEn: partial.summaryEn,
      tab: partial.navigationTab,
      referenceId: partial.code,
      ctx,
    });
  }

  return {
    ...partial,
    escalationCard,
    summary: lang === "ar" ? partial.summaryAr : partial.summaryEn,
  };
}

function checkWritePermission(
  user: UasUser | UserRole | string | null | undefined,
  moduleId: ModuleIdentifier,
  requireLedgerPost = false
): { allowed: true } | { allowed: false; summaryAr: string; summaryEn: string } {
  const effectiveUser = user ?? "SUPER_ADMIN";
  const role = normalizeRole(effectiveUser);

  if (isReadOnly(effectiveUser)) {
    return {
      allowed: false,
      summaryAr: `⛔ غير مصرح: حساب (${role}) مخصص للقراءة والتدقيق فقط ولا يملك صلاحية إنشاء أو ترحيل العمليات المالية.`,
      summaryEn: `⛔ RBAC Blocked: Role (${role}) is Read-Only and cannot draft or post financial transactions.`,
    };
  }

  if (requireLedgerPost && !canPostLedger(effectiveUser)) {
    return {
      allowed: false,
      summaryAr: `⛔ غير مصرح: ترحيل قيود اليومية المباشرة لدفتر الأستاذ محصور بمدير النظام العام (SUPER_ADMIN) ورئيس الحسابات (CHIEF_ACCOUNTANT). دورك الحالي: ${role}.`,
      summaryEn: `⛔ RBAC Blocked: Posting direct General Ledger journal entries requires SUPER_ADMIN or CHIEF_ACCOUNTANT (current role: ${role}).`,
    };
  }

  if (!canCreate(effectiveUser, moduleId)) {
    return {
      allowed: false,
      summaryAr: `⛔ غير مصرح: دورك الحالي (${role}) لا يملك صلاحية الإضافة في قسم (${moduleId}).`,
      summaryEn: `⛔ RBAC Blocked: Your role (${role}) does not have create permission in module '${moduleId}'.`,
    };
  }

  return { allowed: true };
}

function resolveProjectAndHarvest(
  ctx: UasAgentExecutionContext,
  args: Record<string, unknown>
): { project: UasProject | null; harvest: string } {
  const projects = ctx.state?.projects ?? [];
  const requestedId = String(args.projectId ?? ctx.workspaceContext?.selectedProjectId ?? "").trim();
  const requestedName = String(args.projectName ?? args.project ?? "").trim().toLowerCase();

  let project: UasProject | null = null;
  if (requestedId) {
    project = projects.find((p) => p.id === requestedId) ?? null;
  }
  if (!project && requestedName) {
    project =
      projects.find(
        (p) =>
          p.name.toLowerCase().includes(requestedName) ||
          requestedName.includes(p.name.toLowerCase()) ||
          (p.code && p.code.toLowerCase() === requestedName)
      ) ?? null;
  }
  if (!project && projects.length > 0) {
    project = projects[0];
  }

  const requestedHarvest = String(args.harvest ?? ctx.workspaceContext?.selectedHarvest ?? "").trim();
  const harvest =
    requestedHarvest ||
    (project?.harvests && project.harvests.length > 0 ? project.harvests[0] : "القطفة الأولى");

  return { project, harvest };
}

function buildCrossSectionPreFlightChecks(params: {
  ctx: UasAgentExecutionContext;
  project?: UasProject | null;
  harvest?: string;
  treasuryIdOrCode?: string;
  outflowAmount?: number;
  checkBudgetSpend?: number;
  customerName?: string;
  grade?: string;
  requestedBundles?: number;
}): {
  checks: PreFlightCheckItem[];
  warningsAr: string[];
  warningsEn: string[];
  isPeriodLocked: boolean;
  stockBlocked: boolean;
} {
  const { ctx, project, harvest, treasuryIdOrCode, outflowAmount, checkBudgetSpend, customerName, grade, requestedBundles } =
    params;
  const checks: PreFlightCheckItem[] = [];
  const warningsAr: string[] = [];
  const warningsEn: string[] = [];
  let isPeriodLocked = false;
  let stockBlocked = false;

  if (project && harvest) {
    const lockKey = `${project.id}::${harvest}`;
    isPeriodLocked = Boolean(ctx.state?.lockedPeriods?.[lockKey]);
    checks.push({
      key: "period_lock",
      status: isPeriodLocked ? "blocked" : "ok",
      labelAr: isPeriodLocked ? `الفترة مقفلة محاسبياً (${harvest})` : `الفترة مفتوحة للتشغيل (${harvest})`,
      labelEn: isPeriodLocked ? `Harvest period is locked (${harvest})` : `Harvest period is open (${harvest})`,
    });
    if (isPeriodLocked) {
      warningsAr.push(`🔒 فترة "${harvest}" لمشروع "${project.name}" مغلقة محاسبياً في سجل المراجعة.`);
      warningsEn.push(`🔒 Harvest period "${harvest}" on "${project.name}" is locked in Audit Trail.`);
    }
  }

  if (project && harvest && typeof requestedBundles === "number" && requestedBundles > 0) {
    const stockCheck = evaluateSaleAgainstHarvestStock({
      batches: ctx.state?.inventoryBatches ?? [],
      sales: ctx.state?.sales ?? [],
      projectId: project.id,
      harvest,
      grade: grade || "رقم 1",
      requestedBundles,
    });
    if (stockCheck.hasTrackedBatches) {
      if (stockCheck.shortageBundles > 0) {
        stockBlocked = true;
        checks.push({
          key: "harvest_stock",
          status: "warning",
          labelAr: `عجز مخزون الحصاد: متاح ${stockCheck.availableBundles} فقط والمطلوب ${requestedBundles}`,
          labelEn: `Harvest stock shortage: ${stockCheck.availableBundles} available vs ${requestedBundles} requested`,
        });
        warningsAr.push(
          `📦 عجز مخزون في (${harvest} - ${grade || "رقم 1"}): المتاح ${stockCheck.availableBundles} والمطلوب ${requestedBundles} (عجز ${stockCheck.shortageBundles}).`
        );
        warningsEn.push(
          `📦 Stock shortage in (${harvest} - ${grade || "رقم 1"}): ${stockCheck.availableBundles} available vs ${requestedBundles} requested (short ${stockCheck.shortageBundles}).`
        );
      } else {
        checks.push({
          key: "harvest_stock",
          status: "ok",
          labelAr: `المخزون متوفر: ${stockCheck.availableBundles} وحدة قبل العملية`,
          labelEn: `Stock available: ${stockCheck.availableBundles} bundles on hand`,
        });
      }
    }
  }

  if (typeof outflowAmount === "number" && outflowAmount > 0 && (ctx.state?.treasuryAccounts?.length ?? 0) > 0) {
    const accounts = ctx.state?.treasuryAccounts ?? [];
    const targetAcc =
      (treasuryIdOrCode
        ? accounts.find((a) => a.id === treasuryIdOrCode || a.code === treasuryIdOrCode)
        : undefined) ?? accounts[0];
    if (targetAcc) {
      const bal = Number(targetAcc.balanceYER ?? targetAcc.balance ?? 0);
      if (bal < outflowAmount) {
        checks.push({
          key: "treasury_balance",
          status: "warning",
          labelAr: `رصيد ${targetAcc.nameAr} (${bal.toLocaleString()}) أقل من المطلوب (${outflowAmount.toLocaleString()})`,
          labelEn: `${targetAcc.nameEn || targetAcc.nameAr} balance (${bal.toLocaleString()}) is below ${outflowAmount.toLocaleString()}`,
        });
        warningsAr.push(
          `💳 تنبيه سيولة: رصيد "${targetAcc.nameAr}" الحالي ${bal.toLocaleString()} قد يصبح سالباً بعد صرف ${outflowAmount.toLocaleString()}.`
        );
        warningsEn.push(
          `💳 Liquidity warning: "${targetAcc.nameEn || targetAcc.nameAr}" balance (${bal.toLocaleString()}) is lower than ${outflowAmount.toLocaleString()}.`
        );
      } else {
        checks.push({
          key: "treasury_balance",
          status: "ok",
          labelAr: `رصيد ${targetAcc.nameAr} كافٍ (${bal.toLocaleString()})`,
          labelEn: `${targetAcc.nameEn || targetAcc.nameAr} has sufficient balance (${bal.toLocaleString()})`,
        });
      }
    }
  }

  if (project && typeof checkBudgetSpend === "number" && checkBudgetSpend > 0) {
    const budget = Number(project.budgetTotal || project.estimatedValue || 0);
    if (budget > 0) {
      const existingExp = (ctx.state?.expenses ?? [])
        .filter((e) => e.projectId === project.id)
        .reduce((s, e) => s + Number(e.total || 0), 0);
      const existingWages = (ctx.state?.workers ?? [])
        .filter((w) => w.projectId === project.id)
        .reduce((s, w) => s + Number(w.total || 0), 0);
      const projected = existingExp + existingWages + checkBudgetSpend;
      const pct = Math.round((projected / budget) * 100);
      if (projected > budget) {
        checks.push({
          key: "project_budget",
          status: "warning",
          labelAr: `تجاوز موازنة "${project.name}" (${pct}% من ${budget.toLocaleString()})`,
          labelEn: `Exceeds "${project.name}" budget (${pct}% of ${budget.toLocaleString()})`,
        });
        warningsAr.push(`📊 تنبيه موازنة: هذه العملية ترفع إنفاق مشروع "${project.name}" إلى ${pct}% من الموازنة المعتمدة.`);
        warningsEn.push(`📊 Budget warning: This entry brings "${project.name}" spend to ${pct}% of approved budget.`);
      } else {
        checks.push({
          key: "project_budget",
          status: "ok",
          labelAr: `ضمن موازنة "${project.name}" (الاستهلاك بعد الترحيل ${pct}%)`,
          labelEn: `Within "${project.name}" budget (${pct}% utilized after posting)`,
        });
      }
    }
  }

  if (customerName) {
    const openDue = (ctx.state?.sales ?? [])
      .filter((s) => s.customer.toLowerCase() === customerName.toLowerCase())
      .reduce((sum, s) => sum + Number(s.debit ?? Math.max(0, Number(s.total || 0) - Number(s.credit || 0))), 0);
    if (openDue > 0) {
      checks.push({
        key: "customer_ar",
        status: "ok",
        labelAr: `رصيد مديونية سابقة على ${customerName}: ${openDue.toLocaleString()} YER`,
        labelEn: `Existing receivable balance for ${customerName}: ${openDue.toLocaleString()} YER`,
      });
    }
  }

  if (ctx.workspaceContext?.isOffline || (ctx.workspaceContext?.offlineQueueCount ?? 0) > 0) {
    const qCount = ctx.workspaceContext?.offlineQueueCount ?? 0;
    checks.push({
      key: "offline_sync",
      status: "ok",
      labelAr: `وضع محلي/أوفلاين: سيتم الترحيل محلياً (${qCount} في الطابور)`,
      labelEn: `Offline/Local Mode: Posts locally & queues sync (${qCount} queued)`,
    });
  }

  return { checks, warningsAr, warningsEn, isPeriodLocked, stockBlocked };
}

function appendWarningsText(summaryAr: string, summaryEn: string, warningsAr: string[], warningsEn: string[]): { summaryAr: string; summaryEn: string } {
  const arBlock = warningsAr.length > 0 ? `\n\n⚠️ **ملاحظات الفحص المتقاطع:**\n${warningsAr.map((w) => `- ${w}`).join("\n")}` : "";
  const enBlock = warningsEn.length > 0 ? `\n\n⚠️ **Cross-Section Pre-Flight Notes:**\n${warningsEn.map((w) => `- ${w}`).join("\n")}` : "";
  return {
    summaryAr: `${summaryAr}${arBlock}`,
    summaryEn: `${summaryEn}${enBlock}`,
  };
}

// ---------------------------------------------------------------------------
// Tool Implementations
// ---------------------------------------------------------------------------

export async function executeUasAgentTool(
  toolName: UasAgentToolName,
  args: Record<string, unknown>,
  ctx: UasAgentExecutionContext = {}
): Promise<UasAgentToolResult> {
  const lang = ctx.lang ?? "ar";
  const catalog = getMergedCoaCatalog(ctx);
  const todayIso = new Date().toISOString().slice(0, 10);

  switch (toolName) {
    // -----------------------------------------------------------------------
    // 1. navigate_to_module
    // -----------------------------------------------------------------------
    case "navigate_to_module": {
      const targetStr = String(args.tab ?? args.module ?? args.target ?? "").trim();
      const resolved = resolveNavigationTarget(targetStr);
      if (!resolved) {
        return makeResult(lang, {
          ok: false,
          toolName,
          code: "UNKNOWN_MODULE",
          requiresConfirmation: false,
          summaryAr: `لم يتم التعرف على القسم المطلوب (${targetStr}). الأقسام المتاحة: لوحة القيادة، شجرة الحسابات، دفتر اليومية، الخزينة، المبيعات، المشتريات، المخزون، المشاريع، المصروفات، العمال، التقارير، التدقيق، النظام.`,
          summaryEn: `Unrecognized module '${targetStr}'. Available tabs: dashboard, coa, ledger, treasury, sales, procurement, inventory, projects, expenses, workers, reports, audit, system.`,
        });
      }

      if (ctx.user && !canAccessModule(ctx.user, resolved.tab)) {
        const role = normalizeRole(ctx.user);
        return makeResult(lang, {
          ok: false,
          toolName,
          code: "RBAC_FORBIDDEN",
          requiresConfirmation: false,
          summaryAr: `⛔ غير مصرح: دورك الحالي (${role}) لا يملك صلاحية الوصول إلى قسم (${resolved.labelAr}).`,
          summaryEn: `⛔ RBAC Blocked: Your role (${role}) is not authorized to access '${resolved.labelEn}'.`,
        }, ctx);
      }

      return makeResult(lang, {
        ok: true,
        toolName,
        requiresConfirmation: false,
        navigationTab: resolved.tab,
        data: { tab: resolved.tab, labelAr: resolved.labelAr, labelEn: resolved.labelEn },
        summaryAr: `✅ تم فتح قسم: **${resolved.labelAr}** (\`${resolved.tab}\`).`,
        summaryEn: `✅ Navigated to module: **${resolved.labelEn}** (\`${resolved.tab}\`).`,
      });
    }

    // -----------------------------------------------------------------------
    // 2. query_account_balance
    // -----------------------------------------------------------------------
    case "query_account_balance": {
      const query = String(args.query ?? args.accountCode ?? args.account ?? "111101").trim();
      const match = findCoaAccount(catalog, query);
      if (!match) {
        return makeResult(lang, {
          ok: false,
          toolName,
          code: "ACCOUNT_NOT_FOUND",
          requiresConfirmation: false,
          summaryAr: `لم يتم العثور على حساب مطابق لـ "${query}" في شجرة الحسابات.`,
          summaryEn: `No account matching "${query}" was found in the Chart of Accounts.`,
        });
      }

      const postingLabelAr = match.isPosting ? "حساب فرعي قابل للترحيل (Leaf Posting)" : "حساب تجميعي أبوي (Summary Header)";
      const postingLabelEn = match.isPosting ? "Leaf Posting Account" : "Summary Header Account";
      return makeResult(lang, {
        ok: true,
        toolName,
        requiresConfirmation: false,
        navigationTab: "coa",
        data: { account: match },
        summaryAr: `📊 **حساب ${match.code} — ${match.nameAr}** (${match.nameEn})\n- التصنيف: ${match.type} • الجيل/المستوى: ${match.level} (${postingLabelAr})\n- الرصيد الحالي: **${match.balance.toLocaleString()} YER**`,
        summaryEn: `📊 **Account ${match.code} — ${match.nameEn}** (${match.nameAr})\n- Type: ${match.type} • Level: ${match.level} (${postingLabelEn})\n- Current Balance: **${match.balance.toLocaleString()} YER**`,
      });
    }

    // -----------------------------------------------------------------------
    // 3. search_journal_entries
    // -----------------------------------------------------------------------
    case "search_journal_entries": {
      const search = String(args.search ?? args.query ?? "").trim().toLowerCase();
      const limit = Math.min(20, Math.max(1, Number(args.limit ?? 5)));
      const list = ctx.journalEntries ?? [];
      const filtered = search
        ? list.filter(
            (e) =>
              e.entryNumber.toLowerCase().includes(search) ||
              e.narrationAr.toLowerCase().includes(search) ||
              (e.narrationEn || "").toLowerCase().includes(search)
          )
        : list;
      const top = filtered.slice(0, limit);

      if (top.length === 0) {
        return makeResult(lang, {
          ok: true,
          toolName,
          requiresConfirmation: false,
          navigationTab: "ledger",
          data: { entries: [], count: 0 },
          summaryAr: search
            ? `لا توجد قيود يومية مطابقة للبحث "${search}" حالياً في دفتر الأستاذ.`
            : "دفتر اليومية في وضع البداية الصفرية (لا توجد قيود مرحلة بعد).",
          summaryEn: search
            ? `No journal entries matching "${search}" were found in the General Ledger.`
            : "The General Ledger is currently at the zero-transaction baseline (0 posted entries).",
        });
      }

      const linesAr = top.map(
        (e) => `- **${e.entryNumber}** (${e.date.slice(0, 10)}): ${e.narrationAr} — مدين: ${e.totalDebit.toLocaleString()} / دائن: ${e.totalCredit.toLocaleString()} (${e.status})`
      );
      const linesEn = top.map(
        (e) => `- **${e.entryNumber}** (${e.date.slice(0, 10)}): ${e.narrationEn || e.narrationAr} — Dr: ${e.totalDebit.toLocaleString()} / Cr: ${e.totalCredit.toLocaleString()} (${e.status})`
      );

      return makeResult(lang, {
        ok: true,
        toolName,
        requiresConfirmation: false,
        navigationTab: "ledger",
        data: { entries: top, count: filtered.length },
        summaryAr: `📒 **نتائج البحث في دفتر اليومية (${filtered.length} قيد):**\n${linesAr.join("\n")}`,
        summaryEn: `📒 **General Ledger Journal Entries (${filtered.length} found):**\n${linesEn.join("\n")}`,
      });
    }

    // -----------------------------------------------------------------------
    // 4. draft_journal_entry (WRITE TOOL -> MANDATORY CONFIRMATION PREVIEW CARD)
    // -----------------------------------------------------------------------
    case "draft_journal_entry": {
      const perm = checkWritePermission(ctx.user, "ledger", true);
      if (!perm.allowed) {
        return makeResult(lang, {
          ok: false,
          toolName,
          code: "RBAC_FORBIDDEN",
          requiresConfirmation: false,
          summaryAr: perm.summaryAr,
          summaryEn: perm.summaryEn,
        }, ctx);
      }

      const rawLines = Array.isArray(args.lines) ? (args.lines as Array<Record<string, unknown>>) : [];
      if (rawLines.length < 2) {
        return makeResult(lang, {
          ok: false,
          toolName,
          code: "INVALID_JOURNAL_LINES",
          requiresConfirmation: false,
          summaryAr: "⚠️ خطأ محاسبي: يجب أن يتكون قيد اليومية المزدوج من سطرين على الأقل (طرف مدين وطرف دائن).",
          summaryEn: "⚠️ Accounting Error: A double-entry journal voucher must contain at least 2 lines (debit and credit).",
        });
      }

      const resolvedLines: PreviewLedgerLine[] = [];
      let totalDebit = 0;
      let totalCredit = 0;

      for (const line of rawLines) {
        const accInput = String(line.accountCode ?? line.account ?? "").trim();
        const acc = findCoaAccount(catalog, accInput);
        if (!acc) {
          return makeResult(lang, {
            ok: false,
            toolName,
            code: "COA_ACCOUNT_NOT_FOUND",
            requiresConfirmation: false,
            summaryAr: `⚠️ رمز الحساب "${accInput}" غير موجود في شجرة الحسابات المعتمدة.`,
            summaryEn: `⚠️ Account "${accInput}" does not exist in the Chart of Accounts.`,
          });
        }
        if (!acc.isPosting || acc.level < 5) {
          return makeResult(lang, {
            ok: false,
            toolName,
            code: "COA_NON_POSTING_ACCOUNT",
            requiresConfirmation: false,
            summaryAr: `⚠️ الحساب (${acc.code} - ${acc.nameAr}) هو حساب رئيسي/تجميعي (المستوى ${acc.level}). لا يُسمح بالترحيل إلا على الحسابات الفرعية النهائية (المستوى 5+، isPosting = true).`,
            summaryEn: `⚠️ Account (${acc.code} - ${acc.nameEn}) is a parent summary header (Level ${acc.level}). Postings are only permitted on leaf accounts (Level 5+, isPosting = true).`,
          });
        }

        const debit = Math.max(0, Number(line.debit ?? 0));
        const credit = Math.max(0, Number(line.credit ?? 0));
        if (debit === 0 && credit === 0) {
          return makeResult(lang, {
            ok: false,
            toolName,
            code: "ZERO_LINE_AMOUNT",
            requiresConfirmation: false,
            summaryAr: `⚠️ سطر الحساب (${acc.code}) يحتوي على قيمة صفرية في المدين والدائن معاً.`,
            summaryEn: `⚠️ Journal line for account (${acc.code}) has zero debit and zero credit.`,
          });
        }
        if (debit > 0 && credit > 0) {
          return makeResult(lang, {
            ok: false,
            toolName,
            code: "DUAL_SIDED_LINE",
            requiresConfirmation: false,
            summaryAr: `⚠️ لا يمكن أن يكون نفس سطر القيد (${acc.code}) مديناً ودائناً في آن واحد.`,
            summaryEn: `⚠️ A single journal line (${acc.code}) cannot have both debit and credit amounts simultaneously.`,
          });
        }

        totalDebit += debit;
        totalCredit += credit;
        resolvedLines.push({
          accountCode: acc.code,
          accountNameAr: acc.nameAr,
          accountNameEn: acc.nameEn,
          debit,
          credit,
          memo: typeof line.memo === "string" ? line.memo : undefined,
          costCenterId: typeof line.costCenterId === "string" ? line.costCenterId : (typeof args.costCenterId === "string" ? args.costCenterId : undefined),
          currency: typeof line.currency === "string" ? line.currency : (typeof args.currency === "string" ? args.currency : undefined),
          exchangeRate: typeof line.exchangeRate === "number" ? line.exchangeRate : (typeof args.exchangeRate === "number" ? args.exchangeRate : undefined),
          factorToBase: typeof line.factorToBase === "number" ? line.factorToBase : (typeof args.factorToBase === "number" ? args.factorToBase : undefined),
        });
      }

      totalDebit = Number(totalDebit.toFixed(2));
      totalCredit = Number(totalCredit.toFixed(2));

      if (totalDebit <= 0 || Math.abs(totalDebit - totalCredit) > 0.005) {
        return makeResult(lang, {
          ok: false,
          toolName,
          code: "UNBALANCED_JOURNAL_ENTRY",
          requiresConfirmation: false,
          summaryAr: `⚠️ القيد غير متوازن محاسبياً! إجمالي المدين (${totalDebit.toLocaleString()}) لا يساوي إجمالي الدائن (${totalCredit.toLocaleString()}). الفرق: ${Math.abs(totalDebit - totalCredit).toLocaleString()}. تم رفض المسودة لحماية توازن دفتر الأستاذ.`,
          summaryEn: `⚠️ Unbalanced Journal Entry! Total Debit (${totalDebit.toLocaleString()}) !== Total Credit (${totalCredit.toLocaleString()}). Difference: ${Math.abs(totalDebit - totalCredit).toLocaleString()}. Draft rejected.`,
        });
      }

      const narrationAr = String(args.narrationAr ?? args.narration ?? "قيد يومية عبر المساعد الذكي").trim();
      const narrationEn = String(args.narrationEn ?? args.narration ?? narrationAr).trim();
      const date = String(args.date ?? todayIso).slice(0, 10);
      const currency = String(args.currency ?? "YER").toUpperCase();
      const exchangeRate = typeof args.exchangeRate === "number" ? args.exchangeRate : undefined;
      const costCenterId = typeof args.costCenterId === "string" ? args.costCenterId : undefined;

      const card: ConfirmationPreviewCard = {
        actionId: `ai-je-${Date.now()}`,
        toolName: "draft_journal_entry",
        operationType: "JOURNAL_ENTRY",
        titleAr: "معاينة قيد يومية مزدوج (بانتظار التأكيد والترحيل)",
        titleEn: "Double-Entry Journal Voucher Preview (Awaiting Confirmation)",
        narrationAr,
        narrationEn,
        date,
        currency,
        exchangeRate,
        costCenterId,
        totalDebit,
        totalCredit,
        isBalanced: true,
        projectId: typeof args.projectId === "string" ? args.projectId : undefined,
        lines: resolvedLines,
        confirmButtonLabelAr: "تأكيد وترحيل",
        confirmButtonLabelEn: "Confirm & Execute",
        confirmButtonLabel: "تأكيد وترحيل / Confirm & Execute",
        executionPayload: {
          operationType: "JOURNAL_ENTRY",
          narrationAr,
          narrationEn,
          date,
          currency,
          exchangeRate,
          costCenterId,
          lines: resolvedLines,
          projectId: typeof args.projectId === "string" ? args.projectId : undefined,
          executed_by_ai: true,
        },
      };

      return makeResult(lang, {
        ok: true,
        toolName,
        requiresConfirmation: true,
        confirmationCard: card,
        data: { preview: card },
        summaryAr: `🛡️ **بوابة الأمان المحاسبي:** تم إعداد مسودة قيد يومية متوازن بمبلغ **${totalDebit.toLocaleString()} ${currency}** (${narrationAr}). يرجى مراجعة جدول المدين/الدائن أدناه والضغط على **"تأكيد وترحيل / Confirm & Execute"** لاعتماد الترحيل في دفتر الأستاذ.`,
        summaryEn: `🛡️ **Accounting Confirmation Gate:** Drafted a balanced journal entry for **${totalDebit.toLocaleString()} ${currency}** (${narrationEn}). Please review the Debit/Credit preview card below and click **"تأكيد وترحيل / Confirm & Execute"** to post to the General Ledger.`,
      });
    }

    // -----------------------------------------------------------------------
    // 5. draft_voucher (WRITE TOOL -> MANDATORY CONFIRMATION PREVIEW CARD)
    // -----------------------------------------------------------------------
    case "draft_voucher": {
      const rawType = String(args.voucherType ?? args.type ?? "PAYMENT").trim().toUpperCase();
      const isReceipt = rawType === "RECEIPT" || rawType === "سند قبض" || rawType === "قبض";
      const targetModule: ModuleIdentifier = isReceipt ? "sales" : "expenses";

      const perm = checkWritePermission(ctx.user, targetModule, false);
      if (!perm.allowed) {
        return makeResult(lang, {
          ok: false,
          toolName,
          code: "RBAC_FORBIDDEN",
          requiresConfirmation: false,
          summaryAr: perm.summaryAr,
          summaryEn: perm.summaryEn,
        });
      }

      const amount = Number(args.amount ?? 0);
      const rawParty = String(args.partyName ?? args.party ?? "").trim();
      const hasParty = Boolean(rawParty);
      const hasAmount = Number.isFinite(amount) && amount > 0;

      if (args.isClarificationNeeded || !hasAmount || !hasParty) {
        const missingFields: string[] = [];
        if (!hasParty) missingFields.push("partyName");
        if (!hasAmount) missingFields.push("amount");

        const extState = ctx.state as (UasBootstrapState & {
          customers?: Array<{ nameAr?: string }>;
          vendors?: Array<{ nameAr?: string }>;
        }) | null | undefined;
        const dynamicCustomers: string[] = (extState?.customers ?? [])
          .map((c: { nameAr?: string }) => c.nameAr)
          .filter((n): n is string => Boolean(n));
        const dynamicVendors: string[] = (extState?.vendors ?? [])
          .map((v: { nameAr?: string }) => v.nameAr)
          .filter((n): n is string => Boolean(n));

        const partyOptions: string[] = isReceipt
          ? (dynamicCustomers.length > 0 ? dynamicCustomers : ["شركة الأمل للتجارة", "شركة النور"])
          : (dynamicVendors.length > 0 ? dynamicVendors : ["مؤسسة البركة", "مؤسسة النصر"]);

        const quickOptions: ClarificationOption[] = !hasParty
          ? partyOptions.map((p: string) => ({
              labelAr: p,
              labelEn: p,
              promptFill: isReceipt
                ? `سند قبض من ${p} بمبلغ ${hasAmount ? `${amount} ${args.currency || "YER"}` : "50000 YER"}`
                : `سند صرف إلى ${p} بمبلغ ${hasAmount ? `${amount} ${args.currency || "YER"}` : "50000 YER"}`,
            }))
          : [
              { labelAr: "50,000 YER", labelEn: "50,000 YER", promptFill: isReceipt ? `سند قبض من ${rawParty} بمبلغ 50000 YER` : `سند صرف إلى ${rawParty} بمبلغ 50000 YER` },
              { labelAr: "100,000 YER", labelEn: "100,000 YER", promptFill: isReceipt ? `سند قبض من ${rawParty} بمبلغ 100000 YER` : `سند صرف إلى ${rawParty} بمبلغ 100000 YER` },
              { labelAr: "500 SAR", labelEn: "500 SAR", promptFill: isReceipt ? `سند قبض من ${rawParty} بمبلغ 500 SAR` : `سند صرف إلى ${rawParty} بمبلغ 500 SAR` },
            ];

        return makeResult(lang, {
          ok: true,
          toolName,
          requiresConfirmation: false,
          clarificationPrompt: {
            questionAr: !hasParty
              ? `يرجى تحديد الطرف ${isReceipt ? "المستلم منه (العميل)" : "المستفيد (المورد)"} لإصدار سند ${isReceipt ? "القبض" : "الصرف"}:`
              : `يرجى تحديد مبلغ سند ${isReceipt ? "القبض" : "الصرف"} والعملة:`,
            questionEn: !hasParty
              ? `Please specify the party (${isReceipt ? "Customer" : "Payee/Vendor"}) for this ${isReceipt ? "Receipt" : "Payment"} voucher:`
              : `Please specify the voucher amount and currency:`,
            missingFields,
            quickOptions,
          },
          summaryAr: `❓ **مطلوب توضيح لاستكمال السند:** يرجى تحديد ${!hasParty ? "اسم الطرف/العميل" : "مبلغ السند"} لمتابعة إعداد السند المحاسبي.`,
          summaryEn: `❓ **Clarification Needed:** Please specify the ${!hasParty ? "party name" : "voucher amount"} to proceed with drafting the voucher.`,
        }, ctx);
      }

      const partyName = rawParty;
      const currency = String(args.currency ?? "YER").toUpperCase();
      const exchangeRate = typeof args.exchangeRate === "number" ? args.exchangeRate : undefined;
      const costCenterId = typeof args.costCenterId === "string" ? args.costCenterId : undefined;
      const defaultTreasuryCode = currency === "SAR" ? "111102" : currency === "USD" ? "111103" : "111101";

      const treasuryAcc =
        findCoaAccount(catalog, String(args.treasuryAccountCode ?? defaultTreasuryCode)) ??
        findCoaAccount(catalog, "111101")!;
      const counterpartyDefault = isReceipt ? "112101" : "524101";
      const counterpartyAcc =
        findCoaAccount(catalog, String(args.counterpartyAccountCode ?? counterpartyDefault)) ??
        findCoaAccount(catalog, counterpartyDefault)!;

      if (!treasuryAcc.isPosting || !counterpartyAcc.isPosting) {
        return makeResult(lang, {
          ok: false,
          toolName,
          code: "COA_NON_POSTING_ACCOUNT",
          requiresConfirmation: false,
          summaryAr: "⚠️ يجب أن تكون حسابات السند حسابات فرعية قابلة للترحيل (المستوى 5+).",
          summaryEn: "⚠️ Voucher accounts must be leaf posting accounts (Level 5+).",
        });
      }

      const narrationAr = String(
        args.narration ??
          (isReceipt
            ? `سند قبض من ${partyName}`
            : `سند صرف إلى ${partyName}`)
      ).trim();
      const narrationEn = String(
        args.narrationEn ??
          (isReceipt
            ? `Receipt voucher from ${partyName}`
            : `Payment voucher to ${partyName}`)
      ).trim();

      const lines: PreviewLedgerLine[] = isReceipt
        ? [
            {
              accountCode: treasuryAcc.code,
              accountNameAr: treasuryAcc.nameAr,
              accountNameEn: treasuryAcc.nameEn,
              debit: amount,
              credit: 0,
              memo: narrationAr,
              costCenterId,
              currency,
              exchangeRate,
            },
            {
              accountCode: counterpartyAcc.code,
              accountNameAr: counterpartyAcc.nameAr,
              accountNameEn: counterpartyAcc.nameEn,
              debit: 0,
              credit: amount,
              memo: partyName,
              costCenterId,
              currency,
              exchangeRate,
            },
          ]
        : [
            {
              accountCode: counterpartyAcc.code,
              accountNameAr: counterpartyAcc.nameAr,
              accountNameEn: counterpartyAcc.nameEn,
              debit: amount,
              credit: 0,
              memo: partyName,
              costCenterId,
              currency,
              exchangeRate,
            },
            {
              accountCode: treasuryAcc.code,
              accountNameAr: treasuryAcc.nameAr,
              accountNameEn: treasuryAcc.nameEn,
              debit: 0,
              credit: amount,
              memo: narrationAr,
              costCenterId,
              currency,
              exchangeRate,
            },
          ];

      const voucherPreFlight = buildCrossSectionPreFlightChecks({
        ctx,
        outflowAmount: !isReceipt ? amount : undefined,
        treasuryIdOrCode: treasuryAcc.code,
        customerName: isReceipt ? partyName : undefined,
      });

      const card: ConfirmationPreviewCard = {
        actionId: `ai-vch-${Date.now()}`,
        toolName: "draft_voucher",
        operationType: isReceipt ? "RECEIPT_VOUCHER" : "PAYMENT_VOUCHER",
        titleAr: isReceipt
          ? `معاينة سند قبض (${partyName})`
          : `معاينة سند صرف (${partyName})`,
        titleEn: isReceipt
          ? `Receipt Voucher Preview (${partyName})`
          : `Payment Voucher Preview (${partyName})`,
        narrationAr,
        narrationEn,
        date: String(args.date ?? todayIso).slice(0, 10),
        currency,
        exchangeRate,
        costCenterId,
        totalDebit: amount,
        totalCredit: amount,
        isBalanced: true,
        partyName,
        lines,
        preFlightChecks: voucherPreFlight.checks,
        warningsAr: voucherPreFlight.warningsAr,
        warningsEn: voucherPreFlight.warningsEn,
        confirmButtonLabelAr: "تأكيد وترحيل",
        confirmButtonLabelEn: "Confirm & Execute",
        confirmButtonLabel: "تأكيد وترحيل / Confirm & Execute",
        executionPayload: {
          operationType: isReceipt ? "RECEIPT_VOUCHER" : "PAYMENT_VOUCHER",
          partyName,
          amount,
          currency,
          exchangeRate,
          costCenterId,
          narrationAr,
          narrationEn,
          date: String(args.date ?? todayIso).slice(0, 10),
          lines,
          executed_by_ai: true,
        },
      };

      const voucherMsg = appendWarningsText(
        `🛡️ **بوابة الأمان المحاسبي:** تم إعداد مسودة **${isReceipt ? "سند قبض" : "سند صرف"}** بمبلغ **${amount.toLocaleString()} ${currency}** (${partyName}). راجع القيد المزدوج أدناه واضغط **"تأكيد وترحيل / Confirm & Execute"** للاعتماد.`,
        `🛡️ **Accounting Confirmation Gate:** Drafted a **${isReceipt ? "Receipt Voucher" : "Payment Voucher"}** for **${amount.toLocaleString()} ${currency}** (${partyName}). Review the Debit/Credit preview card below and click **"تأكيد وترحيل / Confirm & Execute"**.`,
        voucherPreFlight.warningsAr,
        voucherPreFlight.warningsEn
      );

      return makeResult(lang, {
        ok: true,
        toolName,
        requiresConfirmation: true,
        confirmationCard: card,
        data: { preview: card, preFlightChecks: voucherPreFlight.checks },
        summaryAr: voucherMsg.summaryAr,
        summaryEn: voucherMsg.summaryEn,
      });
    }

    // -----------------------------------------------------------------------
    // 6. draft_invoice (WRITE TOOL -> MANDATORY CONFIRMATION PREVIEW CARD)
    // -----------------------------------------------------------------------
    case "draft_invoice": {
      const rawType = String(args.invoiceType ?? args.type ?? "SALES").trim().toUpperCase();
      const isPurchase = rawType === "PURCHASE" || rawType === "BILL" || rawType === "مشتريات";
      const targetModule: ModuleIdentifier = isPurchase ? "procurement" : "sales";

      const perm = checkWritePermission(ctx.user, targetModule, false);
      if (!perm.allowed) {
        return makeResult(lang, {
          ok: false,
          toolName,
          code: "RBAC_FORBIDDEN",
          requiresConfirmation: false,
          summaryAr: perm.summaryAr,
          summaryEn: perm.summaryEn,
        });
      }

      const qty = Math.max(1, Number(args.quantity ?? args.bundles ?? 1));
      const unitPrice = Math.max(0, Number(args.unitPrice ?? args.price ?? 0));
      const explicitAmount = Number(args.amount ?? 0);
      const totalAmount = Number((explicitAmount > 0 ? explicitAmount : qty * unitPrice).toFixed(2));
      const rawParty = String(args.partyName ?? args.customer ?? args.vendor ?? "").trim();
      const hasParty = Boolean(rawParty);
      const hasAmount = Number.isFinite(totalAmount) && totalAmount > 0;
      const currency = String(args.currency ?? "YER").toUpperCase();

      if (args.isClarificationNeeded || !hasAmount || !hasParty) {
        const missingFields: string[] = [];
        if (!hasParty) missingFields.push("partyName");
        if (!hasAmount) missingFields.push("amount");

        const extState = ctx.state as (UasBootstrapState & {
          customers?: Array<{ nameAr?: string }>;
          vendors?: Array<{ nameAr?: string }>;
        }) | null | undefined;
        const dynamicCustomers: string[] = (extState?.customers ?? [])
          .map((c: { nameAr?: string }) => c.nameAr)
          .filter((n): n is string => Boolean(n));
        const dynamicVendors: string[] = (extState?.vendors ?? [])
          .map((v: { nameAr?: string }) => v.nameAr)
          .filter((n): n is string => Boolean(n));

        const partyOptions: string[] = isPurchase
          ? (dynamicVendors.length > 0 ? dynamicVendors : ["مؤسسة البركة", "مؤسسة النصر"])
          : (dynamicCustomers.length > 0 ? dynamicCustomers : ["شركة الأمل للتجارة", "شركة النور"]);

        const quickOptions: ClarificationOption[] = !hasParty
          ? partyOptions.map((p: string) => ({
              labelAr: p,
              labelEn: p,
              promptFill: isPurchase
                ? `فاتورة مشتريات من ${p} بمبلغ ${hasAmount ? `${totalAmount} ${currency}` : "75000 YER"}`
                : `فاتورة مبيعات للعميل ${p} بمبلغ ${hasAmount ? `${totalAmount} ${currency}` : "75000 YER"}`,
            }))
          : [
              { labelAr: "50,000 YER", labelEn: "50,000 YER", promptFill: isPurchase ? `فاتورة مشتريات من ${rawParty} بمبلغ 50000 YER` : `فاتورة مبيعات للعميل ${rawParty} بمبلغ 50000 YER` },
              { labelAr: "100,000 YER", labelEn: "100,000 YER", promptFill: isPurchase ? `فاتورة مشتريات من ${rawParty} بمبلغ 100000 YER` : `فاتورة مبيعات للعميل ${rawParty} بمبلغ 100000 YER` },
              { labelAr: "50 كرتون × 2000 YER", labelEn: "50 boxes @ 2000 YER", promptFill: isPurchase ? `فاتورة مشتريات من ${rawParty} 50 كرتون بسعر 2000 YER` : `فاتورة مبيعات للعميل ${rawParty} 50 كرتون بسعر 2000 YER` },
            ];

        return makeResult(lang, {
          ok: true,
          toolName,
          requiresConfirmation: false,
          clarificationPrompt: {
            questionAr: !hasParty
              ? `يرجى تحديد ${isPurchase ? "المورد" : "العميل"} لإصدار ${isPurchase ? "فاتورة المشتريات" : "فاتورة المبيعات"}:`
              : `يرجى تحديد مبلغ أو كمية وسعر الفاتورة:`,
            questionEn: !hasParty
              ? `Please specify the ${isPurchase ? "vendor" : "customer"} for this ${isPurchase ? "purchase bill" : "sales invoice"}:`
              : `Please specify the invoice amount or quantity and unit price:`,
            missingFields,
            quickOptions,
          },
          summaryAr: `❓ **مطلوب توضيح لاستكمال الفاتورة:** يرجى تحديد ${!hasParty ? "اسم الطرف" : "المبلغ والكمية"} لمتابعة إعداد مسودة الفاتورة.`,
          summaryEn: `❓ **Clarification Needed:** Please specify the ${!hasParty ? "party name" : "amount and quantity"} to proceed with drafting the invoice.`,
        }, ctx);
      }

      const partyName = rawParty;
      const itemName = String(args.itemName ?? args.grade ?? "صنف 1 ممتاز").trim();
      const paymentMethod = String(args.paymentMethod ?? "CREDIT").toUpperCase() === "CASH" ? "CASH" : "CREDIT";
      const exchangeRate = typeof args.exchangeRate === "number" ? args.exchangeRate : undefined;
      const costCenterId = typeof args.costCenterId === "string" ? args.costCenterId : undefined;
      const factorToBase = typeof args.factorToBase === "number" ? args.factorToBase : undefined;

      const debitCode = isPurchase
        ? "512101" // مصروف مدخلات الإنتاج المستهلكة
        : paymentMethod === "CASH"
        ? "111101" // الصندوق الرئيسي
        : "112101"; // حساب العملاء التجاريين العام

      const creditCode = isPurchase
        ? paymentMethod === "CASH"
          ? "111101"
          : "211101" // حساب الموردين التجاريين العام
        : "411101"; // إيراد مبيعات المحاصيل الرئيسية

      const debitAcc = findCoaAccount(catalog, debitCode)!;
      const creditAcc = findCoaAccount(catalog, creditCode)!;

      const narrationAr = isPurchase
        ? `فاتورة مشتريات (${itemName} × ${qty}) من المورد: ${partyName}`
        : `فاتورة مبيعات (${itemName} × ${qty}) للعميل: ${partyName}`;
      const narrationEn = isPurchase
        ? `Purchase Bill (${itemName} × ${qty}) from vendor: ${partyName}`
        : `Sales Invoice (${itemName} × ${qty}) to customer: ${partyName}`;

      const lines: PreviewLedgerLine[] = [
        {
          accountCode: debitAcc.code,
          accountNameAr: debitAcc.nameAr,
          accountNameEn: debitAcc.nameEn,
          debit: totalAmount,
          credit: 0,
          memo: narrationAr,
          costCenterId,
          currency,
          exchangeRate,
          factorToBase,
        },
        {
          accountCode: creditAcc.code,
          accountNameAr: creditAcc.nameAr,
          accountNameEn: creditAcc.nameEn,
          debit: 0,
          credit: totalAmount,
          memo: narrationAr,
          costCenterId,
          currency,
          exchangeRate,
          factorToBase,
        },
      ];

      const invProject = resolveProjectAndHarvest(ctx, args);
      const invPreFlight = buildCrossSectionPreFlightChecks({
        ctx,
        project: invProject.project,
        harvest: invProject.harvest,
        outflowAmount: isPurchase && paymentMethod === "CASH" ? totalAmount : undefined,
        customerName: !isPurchase ? partyName : undefined,
        grade: !isPurchase ? itemName : undefined,
        requestedBundles: !isPurchase ? qty : undefined,
      });

      const card: ConfirmationPreviewCard = {
        actionId: `ai-inv-${Date.now()}`,
        toolName: "draft_invoice",
        operationType: isPurchase ? "PURCHASE_BILL" : "SALES_INVOICE",
        titleAr: isPurchase
          ? `معاينة فاتورة مشتريات (${partyName})`
          : `معاينة فاتورة مبيعات (${partyName})`,
        titleEn: isPurchase
          ? `Purchase Bill Preview (${partyName})`
          : `Sales Invoice Preview (${partyName})`,
        narrationAr,
        narrationEn,
        date: String(args.date ?? todayIso).slice(0, 10),
        currency,
        exchangeRate,
        costCenterId,
        totalDebit: totalAmount,
        totalCredit: totalAmount,
        isBalanced: true,
        partyName,
        lines,
        preFlightChecks: invPreFlight.checks,
        warningsAr: invPreFlight.warningsAr,
        warningsEn: invPreFlight.warningsEn,
        confirmButtonLabelAr: "تأكيد وترحيل",
        confirmButtonLabelEn: "Confirm & Execute",
        confirmButtonLabel: "تأكيد وترحيل / Confirm & Execute",
        executionPayload: {
          operationType: isPurchase ? "PURCHASE_BILL" : "SALES_INVOICE",
          partyName,
          itemName,
          quantity: qty,
          unitPrice,
          amount: totalAmount,
          currency,
          exchangeRate,
          costCenterId,
          factorToBase,
          paymentMethod,
          date: String(args.date ?? todayIso).slice(0, 10),
          lines,
          executed_by_ai: true,
        },
      };

      const invMsg = appendWarningsText(
        `🛡️ **بوابة الأمان المحاسبي:** تم إعداد مسودة **${isPurchase ? "فاتورة مشتريات" : "فاتورة مبيعات"}** بمبلغ **${totalAmount.toLocaleString()} ${currency}** (${partyName} — ${itemName}). اضغط **"تأكيد وترحيل / Confirm & Execute"** لترحيل الفاتورة وقيدها المحاسبي.`,
        `🛡️ **Accounting Confirmation Gate:** Drafted a **${isPurchase ? "Purchase Bill" : "Sales Invoice"}** for **${totalAmount.toLocaleString()} ${currency}** (${partyName} — ${itemName}). Click **"تأكيد وترحيل / Confirm & Execute"** to commit.`,
        invPreFlight.warningsAr,
        invPreFlight.warningsEn
      );

      return makeResult(lang, {
        ok: true,
        toolName,
        requiresConfirmation: true,
        confirmationCard: card,
        data: { preview: card, preFlightChecks: invPreFlight.checks },
        summaryAr: invMsg.summaryAr,
        summaryEn: invMsg.summaryEn,
      });
    }

    // -----------------------------------------------------------------------
    // 7. check_item_stock
    // -----------------------------------------------------------------------
    case "check_item_stock": {
      const q = String(args.query ?? args.item ?? "").trim().toLowerCase();
      const batches = ctx.state?.inventoryBatches ?? [];
      const sales = ctx.state?.sales ?? [];
      const report = reconcileHarvestInventory(batches, sales);
      const filteredRows = q
        ? report.rows.filter(
            (r) =>
              r.batch.grade.toLowerCase().includes(q) ||
              r.batch.harvest.toLowerCase().includes(q) ||
              r.batch.notes.toLowerCase().includes(q)
          )
        : report.rows;

      const totalHarvested = filteredRows.reduce((s, r) => s + r.harvestedBundles, 0);
      const totalShrinkage = filteredRows.reduce((s, r) => s + r.shrinkageBundles, 0);
      const totalSold = filteredRows.reduce((s, r) => s + r.soldBundles, 0);
      const netAvailable = filteredRows.reduce((s, r) => s + r.remainingBundles, 0);

      return makeResult(lang, {
        ok: true,
        toolName,
        requiresConfirmation: false,
        navigationTab: "inventory",
        data: {
          batchCount: filteredRows.length,
          totalHarvested,
          totalShrinkage,
          totalSold,
          netAvailable,
          batches: filteredRows.slice(0, 10).map((r) => r.batch),
        },
        summaryAr:
          filteredRows.length > 0
            ? `📦 **فحص المخزون (${filteredRows.length} دفعة):** المقطوف: **${totalHarvested}** • المباع: **${totalSold}** • الفاقد/التالف: **${totalShrinkage}** • الرصيد المتبقي: **${netAvailable} وحدة/علاقية**.`
            : "📦 **حالة المخزون:** لا توجد دفعات مخزنية مسجلة حالياً (رصيد المخزون: 0).",
        summaryEn:
          filteredRows.length > 0
            ? `📦 **Inventory Stock (${filteredRows.length} batches):** Total Harvested: **${totalHarvested}** • Sold: **${totalSold}** • Shrinkage: **${totalShrinkage}** • Net Available Stock: **${netAvailable} units**.`
            : "📦 **Inventory Status:** No inventory batches recorded yet (Available stock: 0).",
      });
    }

    // -----------------------------------------------------------------------
    // 8. verify_qr_document
    // -----------------------------------------------------------------------
    case "verify_qr_document": {
      const code = String(args.code ?? args.reference ?? args.query ?? "").trim();
      if (!code) {
        return makeResult(lang, {
          ok: false,
          toolName,
          code: "MISSING_QR_CODE",
          requiresConfirmation: false,
          summaryAr: "يرجى تزويد رقم السند أو الفاتورة أو رمز التحقق QR لفحصه.",
          summaryEn: "Please provide a voucher number, invoice number, or QR verification code to inspect.",
        });
      }

      if (ctx.qrLookupHook) {
        const verifiedDoc = await ctx.qrLookupHook(code);
        if (verifiedDoc && verifiedDoc.verified) {
          return makeResult(lang, {
            ok: true,
            toolName,
            requiresConfirmation: false,
            navigationTab: "audit",
            data: verifiedDoc,
            summaryAr: `✅ **وثيقة صحيحة وموثقة رقمياً:**\n- النوع: ${verifiedDoc.documentType}\n- المرجع: \`${verifiedDoc.reference}\`\n- الطرف: ${verifiedDoc.party}\n- المبلغ: **${Number(verifiedDoc.amount || 0).toLocaleString()} ${verifiedDoc.currency || "YER"}**\n- الحالة: \`${verifiedDoc.status}\``,
            summaryEn: `✅ **Cryptographically Verified Document:**\n- Type: ${verifiedDoc.documentType}\n- Reference: \`${verifiedDoc.reference}\`\n- Party: ${verifiedDoc.party}\n- Amount: **${Number(verifiedDoc.amount || 0).toLocaleString()} ${verifiedDoc.currency || "YER"}**\n- Status: \`${verifiedDoc.status}\``,
          });
        }
      }

      // Check in client bootstrap state (sales & installments)
      const sale = ctx.state?.sales?.find(
        (s) => s.voucherNo.toLowerCase() === code.toLowerCase() || s.id.toLowerCase() === code.toLowerCase()
      );
      if (sale) {
        return makeResult(lang, {
          ok: true,
          toolName,
          requiresConfirmation: false,
          navigationTab: "sales",
          data: { verified: true, documentType: "فاتورة مبيعات", reference: sale.voucherNo, party: sale.customer, amount: sale.total },
          summaryAr: `✅ **وثيقة مبيعات موثقة:** رقم السند \`${sale.voucherNo}\` • العميل: **${sale.customer}** • المبلغ: **${sale.total.toLocaleString()} YER** • التاريخ: ${sale.date}.`,
          summaryEn: `✅ **Verified Sales Document:** Voucher \`${sale.voucherNo}\` • Customer: **${sale.customer}** • Amount: **${sale.total.toLocaleString()} YER** • Date: ${sale.date}.`,
        });
      }

      const inst = ctx.state?.installments?.find(
        (v) =>
          v.voucherNo.toLowerCase() === code.toLowerCase() ||
          (v.qrVerificationHash || "").toLowerCase() === code.toLowerCase()
      );
      if (inst) {
        return makeResult(lang, {
          ok: true,
          toolName,
          requiresConfirmation: false,
          navigationTab: "treasury",
          data: { verified: true, documentType: inst.type, reference: inst.voucherNo, party: inst.targetName, amount: inst.amount },
          summaryAr: `✅ **سند موثق رقمياً:** رقم السند \`${inst.voucherNo}\` • الطرف: **${inst.targetName}** • المبلغ: **${inst.amount.toLocaleString()} YER** • بصمة QR: \`${inst.qrVerificationHash || "VERIFIED"}\`.`,
          summaryEn: `✅ **Verified Voucher:** Reference \`${inst.voucherNo}\` • Party: **${inst.targetName}** • Amount: **${inst.amount.toLocaleString()} YER** • QR Hash: \`${inst.qrVerificationHash || "VERIFIED"}\`.`,
        });
      }

      return makeResult(lang, {
        ok: false,
        toolName,
        code: "DOCUMENT_NOT_FOUND",
        requiresConfirmation: false,
        summaryAr: `❌ لم يتم العثور على أي سند أو فاتورة مطابقة للرمز \`${code}\` في السجلات المالية.`,
        summaryEn: `❌ No voucher or invoice matching code \`${code}\` was found in the ledger.`,
      });
    }

    // -----------------------------------------------------------------------
    // 9. generate_report_summary
    // -----------------------------------------------------------------------
    case "generate_report_summary": {
      const snap = ctx.reportSnapshot;
      const stateSalesRev = (ctx.state?.sales ?? []).reduce((s, r) => s + Number(r.total || 0), 0);
      const stateExpenses = (ctx.state?.expenses ?? []).reduce((s, r) => s + Number(r.total || 0), 0);
      const stateWages = (ctx.state?.workers ?? []).reduce((s, r) => s + Number(r.total || 0), 0);
      const stateTreasury = (ctx.state?.treasuryAccounts ?? []).reduce((s, r) => s + Number(r.balanceYER || 0), 0);

      const totalRevenue = snap ? snap.totalRevenue : stateSalesRev;
      const totalExpenses = snap ? snap.totalExpenses : stateExpenses + stateWages;
      const netIncome = snap ? snap.netIncome : totalRevenue - totalExpenses;
      const totalAssets = snap ? snap.totalAssets : stateTreasury;
      const totalDebits = snap ? snap.totalDebits : totalRevenue + totalExpenses;
      const totalCredits = snap ? snap.totalCredits : totalRevenue + totalExpenses;
      const isBalanced = snap ? snap.isBalanced : true;

      return makeResult(lang, {
        ok: true,
        toolName,
        requiresConfirmation: false,
        navigationTab: "reports",
        data: {
          totalDebits,
          totalCredits,
          isBalanced,
          totalRevenue,
          totalExpenses,
          netIncome,
          totalAssets,
        },
        summaryAr:
          `📈 **ملخص القوائم المالية اللحظي:**\n` +
          `- **ميزان المراجعة (Trial Balance):** إجمالي المدين **${totalDebits.toLocaleString()} YER** = إجمالي الدائن **${totalCredits.toLocaleString()} YER** (${isBalanced ? "متوازن ✅" : "غير متوازن ⚠️"})\n` +
          `- **قائمة الدخل (P&L):** الإيرادات **${totalRevenue.toLocaleString()} YER** — المصروفات **${totalExpenses.toLocaleString()} YER** = صافي النتيجة **${netIncome.toLocaleString()} YER**\n` +
          `- **المركز المالي (Balance Sheet):** إجمالي الأصول المتداولة/الخزينة **${totalAssets.toLocaleString()} YER**`,
        summaryEn:
          `📈 **Real-Time Financial Statements Summary:**\n` +
          `- **Trial Balance:** Total Debits **${totalDebits.toLocaleString()} YER** = Total Credits **${totalCredits.toLocaleString()} YER** (${isBalanced ? "Balanced ✅" : "Unbalanced ⚠️"})\n` +
          `- **Income Statement (P&L):** Revenue **${totalRevenue.toLocaleString()} YER** — Expenses **${totalExpenses.toLocaleString()} YER** = Net Income **${netIncome.toLocaleString()} YER**\n` +
          `- **Balance Sheet:** Total Assets / Treasury **${totalAssets.toLocaleString()} YER**`,
      });
    }

    // -----------------------------------------------------------------------
    // 10. diagnose_system_health (Wired directly to Phase 3 diagnostic engine)
    // -----------------------------------------------------------------------
    case "diagnose_system_health": {
      const mergedDiagnostics: Partial<SupportSystemDiagnostics> = {
        ...(ctx.diagnostics ?? {}),
        offline_queue_count: ctx.workspaceContext?.offlineQueueCount ?? ctx.diagnostics?.offline_queue_count ?? 0,
        pending_conflicts_count: ctx.workspaceContext?.pendingConflictsCount ?? ctx.diagnostics?.pending_conflicts_count ?? 0,
        is_offline: ctx.workspaceContext?.isOffline ?? ctx.diagnostics?.is_offline ?? false,
        tenant_slug: ctx.workspaceContext?.tenantSlug ?? ctx.diagnostics?.tenant_slug ?? null,
        active_tab: ctx.workspaceContext?.activeTab ?? ctx.diagnostics?.active_tab ?? null,
      };
      const report = diagnoseLiveSystemState(mergedDiagnostics);
      return makeResult(lang, {
        ok: true,
        toolName,
        requiresConfirmation: false,
        navigationTab: report.healthy ? "system" : undefined,
        openLicenseModal: !report.healthy,
        data: { diagnosticReport: report, diagnostics: mergedDiagnostics },
        summaryAr:
          `🔍 **تشخيص حالة النظام والترخيص (${report.statusBadge}):**\n` +
          `**${report.headlineAr}**\n` +
          report.findingsAr.map((f) => `- ${f}`).join("\n") +
          (report.remediationsAr.length > 0
            ? `\n**التوصيات:**\n` + report.remediationsAr.map((r) => `- ${r}`).join("\n")
            : ""),
        summaryEn:
          `🔍 **System & Licensing Health Diagnostics (${report.statusBadge}):**\n` +
          `**${report.headlineEn}**\n` +
          report.findingsEn.map((f) => `- ${f}`).join("\n") +
          (report.remediationsEn.length > 0
            ? `\n**Recommendations:**\n` + report.remediationsEn.map((r) => `- ${r}`).join("\n")
            : ""),
      });
    }

    // -----------------------------------------------------------------------
    // 11. search_user_manual (Wired directly to Phase 3 support knowledge engine)
    // -----------------------------------------------------------------------
    case "search_user_manual": {
      const query = String(args.query ?? "").trim();
      const supportRes = answerSupportQuery(query, {
        lang,
        diagnostics: ctx.diagnostics,
        topK: 3,
      });

      const firstNav = supportRes.matches[0]?.section.targetTab;
      const citations: CitationLink[] = supportRes.matches.map((m) => ({
        labelAr: `فصل ${m.section.chapterNumber}: ${m.section.titleAr}`,
        labelEn: `Ch.${m.section.chapterNumber}: ${m.section.titleEn}`,
        tab: (m.section.targetTab as TabId) || "system",
        referenceId: m.section.id,
        type: "manual",
      }));

      return makeResult(lang, {
        ok: true,
        toolName,
        requiresConfirmation: false,
        navigationTab: firstNav,
        citations,
        openLicenseModal: supportRes.suggestedActions.some((a) => a.type === "open_license_modal"),
        data: {
          matches: supportRes.matches.map((m) => ({
            id: m.section.id,
            chapterNumber: m.section.chapterNumber,
            titleAr: m.section.titleAr,
            titleEn: m.section.titleEn,
            score: m.score,
          })),
          diagnosticReport: supportRes.diagnosticReport,
        },
        summaryAr: supportRes.answerAr,
        summaryEn: supportRes.answerEn,
      }, ctx);
    }

    // -----------------------------------------------------------------------
    // 12. create_customer (WRITE TOOL -> MANDATORY CONFIRMATION PREVIEW CARD)
    // -----------------------------------------------------------------------
    case "create_customer": {
      const perm = checkWritePermission(ctx.user, "customers", false);
      if (!perm.allowed) {
        return makeResult(lang, {
          ok: false,
          toolName,
          code: "RBAC_FORBIDDEN",
          requiresConfirmation: false,
          summaryAr: perm.summaryAr,
          summaryEn: perm.summaryEn,
        });
      }

      const rawName = String(args.name ?? args.customerName ?? args.partyName ?? "").trim();
      if (!rawName || rawName === "عميل جديد" || args.isClarificationNeeded) {
        return makeResult(lang, {
          ok: true,
          toolName,
          requiresConfirmation: false,
          clarificationPrompt: {
            questionAr: "يرجى تحديد اسم العميل أو المنشأة ورقم الهاتف لإنشاء الحساب:",
            questionEn: "Please specify the customer or organization name and phone number:",
            missingFields: ["name"],
            quickOptions: [
              { labelAr: "شركة الأمل للتجارة", labelEn: "Al-Amal Trading Co.", promptFill: "إنشاء عميل جديد باسم شركة الأمل للتجارة بهاتف 777112233" },
              { labelAr: "مؤسسة النور الحديثة", labelEn: "Al-Noor Modern Est.", promptFill: "إنشاء عميل جديد باسم مؤسسة النور الحديثة بهاتف 777223344" },
              { labelAr: "مجموعة الفلاح الزراعية", labelEn: "Al-Falah Agri Group", promptFill: "إنشاء عميل جديد باسم مجموعة الفلاح الزراعية بهاتف 777334455" },
            ],
          },
          summaryAr: "❓ **مطلوب توضيح:** يرجى تزويدي باسم العميل الجديد ورقم الهاتف لإنشاء الحساب بالجيل السادس ومركز التكلفة.",
          summaryEn: "❓ **Clarification Needed:** Please specify the customer name and phone to generate the Gen-6 account and profile.",
        }, ctx);
      }

      const name = rawName;

      const nameEn = String(args.nameEn ?? name).trim();
      const phone = String(args.phone ?? "").trim();
      const creditLimit = Math.max(0, Number(args.creditLimit ?? 0));
      const costCenterId = typeof args.costCenterId === "string" ? args.costCenterId : undefined;
      const address = typeof args.address === "string" ? args.address : undefined;

      const card: ConfirmationPreviewCard = {
        actionId: `ai-cust-${Date.now()}`,
        toolName: "create_customer",
        operationType: "CREATE_CUSTOMER",
        titleAr: `معاينة إنشاء عميل جديد (${name})`,
        titleEn: `Create New Customer Preview (${name})`,
        narrationAr: `إضافة عميل جديد: ${name}${phone ? ` • هاتف: ${phone}` : ""}${creditLimit > 0 ? ` • حد ائتماني: ${creditLimit.toLocaleString()} YER` : ""}`,
        narrationEn: `Create customer: ${name}${phone ? ` • Phone: ${phone}` : ""}${creditLimit > 0 ? ` • Credit limit: ${creditLimit.toLocaleString()} YER` : ""}`,
        date: todayIso,
        currency: "YER",
        costCenterId,
        totalDebit: 0,
        totalCredit: 0,
        isBalanced: true,
        partyName: name,
        lines: [
          {
            accountCode: "112190xxx",
            accountNameAr: `العميل: ${name} (الجيل السادس)`,
            accountNameEn: `Customer: ${nameEn} (Gen-6 Leaf)`,
            debit: 0,
            credit: 0,
            costCenterId,
          },
        ],
        confirmButtonLabelAr: "تأكيد وإنشاء العميل",
        confirmButtonLabelEn: "Confirm & Create Client",
        confirmButtonLabel: "تأكيد وإنشاء العميل / Confirm & Create Client",
        executionPayload: {
          operationType: "CREATE_CUSTOMER",
          name,
          nameEn,
          phone,
          creditLimit,
          costCenterId,
          address,
          executed_by_ai: true,
        },
      };

      return makeResult(lang, {
        ok: true,
        toolName,
        requiresConfirmation: true,
        confirmationCard: card,
        data: { preview: card },
        summaryAr: `🛡️ **بوابة التأكيد:** تم إعداد مقترح إنشاء العميل **(${name})**${phone ? ` بهاتف: ${phone}` : ""}${creditLimit > 0 ? ` وحد ائتماني: ${creditLimit.toLocaleString()} YER` : ""}.\nسيتم ربطه تلقائياً بحساب فرعي بالجيل السادس (1121xx) ومركز تكلفة خاص. اضغط **"تأكيد وإنشاء العميل"** للاعتماد.`,
        summaryEn: `🛡️ **Confirmation Gate:** Prepared proposal to create customer **(${name})**${phone ? ` with phone: ${phone}` : ""}${creditLimit > 0 ? ` and credit limit: ${creditLimit.toLocaleString()} YER` : ""}.\nWill auto-provision a Gen-6 GL leaf account (1121xx) and Cost Center. Click **"Confirm & Create Client"** to execute.`,
      });
    }

    // -----------------------------------------------------------------------
    // 13. create_vendor (WRITE TOOL -> MANDATORY CONFIRMATION PREVIEW CARD)
    // -----------------------------------------------------------------------
    case "create_vendor": {
      const perm = checkWritePermission(ctx.user, "procurement", false);
      if (!perm.allowed) {
        return makeResult(lang, {
          ok: false,
          toolName,
          code: "RBAC_FORBIDDEN",
          requiresConfirmation: false,
          summaryAr: perm.summaryAr,
          summaryEn: perm.summaryEn,
        });
      }

      const rawNameAr = String(args.nameAr ?? args.name ?? args.vendorName ?? args.partyName ?? "").trim();
      if (!rawNameAr || rawNameAr === "مورد جديد" || args.isClarificationNeeded) {
        return makeResult(lang, {
          ok: true,
          toolName,
          requiresConfirmation: false,
          clarificationPrompt: {
            questionAr: "يرجى تحديد اسم المورد أو المورد المعتمد ورقم الهاتف:",
            questionEn: "Please specify the supplier or vendor name and phone number:",
            missingFields: ["nameAr"],
            quickOptions: [
              { labelAr: "مؤسسة البركة للمستلزمات", labelEn: "Al-Baraka Supplies", promptFill: "إنشاء مورد جديد باسم مؤسسة البركة للمستلزمات بهاتف 771122334" },
              { labelAr: "شركة النصر للأسمدة", labelEn: "Al-Nasr Fertilizers", promptFill: "إنشاء مورد جديد باسم شركة النصر للأسمدة بهاتف 772233445" },
              { labelAr: "مؤسسة الوحدة للتجارة", labelEn: "Al-Wehda Trading", promptFill: "إنشاء مورد جديد باسم مؤسسة الوحدة للتجارة بهاتف 773344556" },
            ],
          },
          summaryAr: "❓ **مطلوب توضيح:** يرجى تحديد اسم المورد ورقم الهاتف للمتابعة في إعداد بطاقة المورد.",
          summaryEn: "❓ **Clarification Needed:** Please specify the supplier name and phone number to draft the vendor profile.",
        }, ctx);
      }

      const nameAr = rawNameAr;

      const nameEn = typeof args.nameEn === "string" ? args.nameEn.trim() : nameAr;
      const phone = String(args.phone ?? "777000000").trim();
      const costCenterId = typeof args.costCenterId === "string" ? args.costCenterId : undefined;
      const email = typeof args.email === "string" ? args.email.trim() : undefined;
      const address = typeof args.address === "string" ? args.address.trim() : undefined;
      const taxRegistration = typeof args.taxRegistration === "string" ? args.taxRegistration.trim() : undefined;

      const card: ConfirmationPreviewCard = {
        actionId: `ai-vnd-${Date.now()}`,
        toolName: "create_vendor",
        operationType: "CREATE_VENDOR",
        titleAr: `معاينة إنشاء مورد جديد (${nameAr})`,
        titleEn: `Create New Supplier Preview (${nameAr})`,
        narrationAr: `إضافة مورد جديد: ${nameAr}${phone ? ` • هاتف: ${phone}` : ""}`,
        narrationEn: `Create supplier: ${nameAr}${phone ? ` • Phone: ${phone}` : ""}`,
        date: todayIso,
        currency: "YER",
        costCenterId,
        totalDebit: 0,
        totalCredit: 0,
        isBalanced: true,
        partyName: nameAr,
        lines: [
          {
            accountCode: "211190xxx",
            accountNameAr: `المورد: ${nameAr} (الجيل السادس)`,
            accountNameEn: `Supplier: ${nameEn} (Gen-6 Leaf)`,
            debit: 0,
            credit: 0,
            costCenterId,
          },
        ],
        confirmButtonLabelAr: "تأكيد وإنشاء المورد",
        confirmButtonLabelEn: "Confirm & Create Supplier",
        confirmButtonLabel: "تأكيد وإنشاء المورد / Confirm & Create Supplier",
        executionPayload: {
          operationType: "CREATE_VENDOR",
          nameAr,
          nameEn,
          phone,
          costCenterId,
          email,
          address,
          taxRegistration,
          executed_by_ai: true,
        },
      };

      return makeResult(lang, {
        ok: true,
        toolName,
        requiresConfirmation: true,
        confirmationCard: card,
        data: { preview: card },
        summaryAr: `🛡️ **بوابة التأكيد:** تم إعداد مقترح إنشاء المورد **(${nameAr})**${phone ? ` بهاتف: ${phone}` : ""}.\nسيتم ربطه تلقائياً بحساب فرعي بالجيل السادس (2111xx) ومركز تكلفة خاص. اضغط **"تأكيد وإنشاء المورد"** للاعتماد.`,
        summaryEn: `🛡️ **Confirmation Gate:** Prepared proposal to create supplier **(${nameAr})**${phone ? ` with phone: ${phone}` : ""}.\nWill auto-provision a Gen-6 GL leaf account (2111xx) and Cost Center. Click **"Confirm & Create Supplier"** to execute.`,
      });
    }

    // -----------------------------------------------------------------------
    // 14. create_project (WRITE TOOL -> MANDATORY CONFIRMATION PREVIEW CARD)
    // -----------------------------------------------------------------------
    case "create_project": {
      const perm = checkWritePermission(ctx.user, "projects", false);
      if (!perm.allowed) {
        return makeResult(lang, {
          ok: false,
          toolName,
          code: "RBAC_FORBIDDEN",
          requiresConfirmation: false,
          summaryAr: perm.summaryAr,
          summaryEn: perm.summaryEn,
        });
      }

      const rawProjectName = String(args.name ?? args.projectName ?? args.title ?? "").trim();
      if (!rawProjectName || rawProjectName === "مشروع جديد" || args.isClarificationNeeded) {
        return makeResult(lang, {
          ok: true,
          toolName,
          requiresConfirmation: false,
          clarificationPrompt: {
            questionAr: "يرجى تحديد اسم المشروع والموازنة التقديرية:",
            questionEn: "Please specify the project name and estimated budget:",
            missingFields: ["name"],
            quickOptions: [
              { labelAr: "مزرعة الجوف - قطاع أ", labelEn: "Al-Jawf Farm - Sector A", promptFill: "إنشاء مشروع مزرعة الجوف - قطاع أ بموازنة 5000000 YER ودورتي حصاد" },
              { labelAr: "مشروع البيوت المحمية م/1", labelEn: "Greenhouse Project M1", promptFill: "إنشاء مشروع البيوت المحمية م/1 بموازنة 3000000 YER ودورة حصاد واحدة" },
              { labelAr: "مشروع وادي سردود الزراعي", labelEn: "Wadi Sardood Agri Project", promptFill: "إنشاء مشروع وادي سردود الزراعي بموازنة 7500000 YER و3 دورات حصاد" },
            ],
          },
          summaryAr: "❓ **مطلوب توضيح:** يرجى تزويدي باسم المشروع والموازنة التقديرية لإعداد قيد التأسيس وبطاقة المشروع.",
          summaryEn: "❓ **Clarification Needed:** Please specify the project name and budget to set up the project profile.",
        }, ctx);
      }

      const name = rawProjectName;

      const budgetTotal = Math.max(0, Number(args.budgetTotal ?? args.budget ?? 0));
      const plannedHarvests = Math.max(1, Number(args.plannedHarvests ?? args.harvests ?? 1));
      const costCenterId = typeof args.costCenterId === "string" ? args.costCenterId : undefined;
      const code = typeof args.code === "string" ? args.code.trim() : undefined;
      const notes = typeof args.notes === "string" ? args.notes.trim() : undefined;

      const card: ConfirmationPreviewCard = {
        actionId: `ai-prj-${Date.now()}`,
        toolName: "create_project",
        operationType: "CREATE_PROJECT",
        titleAr: `معاينة إنشاء مشروع جديد (${name})`,
        titleEn: `Create New Project Preview (${name})`,
        narrationAr: `إضافة مشروع جديد: ${name}${budgetTotal > 0 ? ` • موازنة: ${budgetTotal.toLocaleString()} YER` : ""} • دورات الحصاد: ${plannedHarvests}`,
        narrationEn: `Create project: ${name}${budgetTotal > 0 ? ` • Budget: ${budgetTotal.toLocaleString()} YER` : ""} • Harvests: ${plannedHarvests}`,
        date: todayIso,
        currency: "YER",
        costCenterId,
        totalDebit: budgetTotal,
        totalCredit: budgetTotal,
        isBalanced: true,
        partyName: name,
        lines: [
          {
            accountCode: "121190xxx",
            accountNameAr: `مشروع: ${name} (حساب رأسمالي / أصول بالجيل السادس)`,
            accountNameEn: `Project: ${name} (Gen-6 Leaf)`,
            debit: budgetTotal,
            credit: budgetTotal,
            costCenterId,
          },
        ],
        confirmButtonLabelAr: "تأكيد وإنشاء المشروع",
        confirmButtonLabelEn: "Confirm & Create Project",
        confirmButtonLabel: "تأكيد وإنشاء المشروع / Confirm & Create Project",
        executionPayload: {
          operationType: "CREATE_PROJECT",
          name,
          code,
          budgetTotal,
          plannedHarvests,
          costCenterId,
          notes,
          executed_by_ai: true,
        },
      };

      return makeResult(lang, {
        ok: true,
        toolName,
        requiresConfirmation: true,
        confirmationCard: card,
        data: { preview: card },
        summaryAr: `🛡️ **بوابة التأكيد:** تم إعداد مقترح إنشاء المشروع **(${name})** بموازنة **${budgetTotal.toLocaleString()} YER** ودورات حصاد (${plannedHarvests}).\nسيتم ربطه تلقائياً بمركز تكلفة وحساب Gen-6. اضغط **"تأكيد وإنشاء المشروع"** للاعتماد.`,
        summaryEn: `🛡️ **Confirmation Gate:** Prepared proposal to create project **(${name})** with budget **${budgetTotal.toLocaleString()} YER** and ${plannedHarvests} harvest cycles.\nWill auto-provision a Gen-6 GL leaf and Cost Center. Click **"Confirm & Create Project"** to execute.`,
      });
    }

    // -----------------------------------------------------------------------
    // 15. export_client_report
    // -----------------------------------------------------------------------
    case "export_client_report": {
      const customerName = String(args.customerName ?? args.customer ?? args.partyName ?? "").trim();
      const includeSaleDetails = args.includeSaleDetails !== false && String(args.includeSaleDetails).toLowerCase() !== "false";

      const matchingSales = (ctx.state?.sales ?? []).filter((s) =>
        customerName ? s.customer.toLowerCase().includes(customerName.toLowerCase()) : true
      );
      const totalSales = matchingSales.reduce((s, r) => s + Number(r.total || 0), 0);
      const totalPaid = matchingSales.reduce((s, r) => s + Number(r.credit || 0), 0);
      const balanceDue = matchingSales.reduce((s, r) => s + Number(r.debit ?? (r.total - (r.credit || 0))), 0);

      const citations: CitationLink[] = [
        {
          labelAr: `سجل مبيعات العميل (${customerName || "الكل"})`,
          labelEn: `Customer Sales Ledger (${customerName || "All"})`,
          tab: "customers",
          type: "tab",
        },
      ];

      return makeResult(lang, {
        ok: true,
        toolName,
        requiresConfirmation: false,
        navigationTab: "customers",
        citations,
        data: {
          customerName: customerName || (lang === "ar" ? "كافة العملاء" : "All Customers"),
          includeSaleDetails,
          salesCount: matchingSales.length,
          totalSales,
          totalPaid,
          balanceDue,
        },
        summaryAr:
          `📄 **كشف حساب العميل (${customerName || "كافة العملاء"}):**\n` +
          `- عدد عمليات البيع المسجلة: **${matchingSales.length}** عملية\n` +
          `- إجمالي المبيعات: **${totalSales.toLocaleString()} YER** • المسدد: **${totalPaid.toLocaleString()} YER**\n` +
          `- رصيد المديونية المتبقي: **${balanceDue.toLocaleString()} YER**\n` +
          `- خيار تفاصيل المبيعات: **${includeSaleDetails ? "تضمين تفاصيل كل عملية بيع: مضمّنة بالكامل (الأصناف، الكميات، الأسعار، الدفعات) ✅" : "ملخص إجمالي فقط 📊"}**\n` +
          `[تم تحويلك إلى قسم العملاء لطباعة أو تصدير التقرير PDF فوراً]`,
        summaryEn:
          `📄 **Client Account Statement (${customerName || "All Clients"}):**\n` +
          `- Sales Transactions: **${matchingSales.length}** sales\n` +
          `- Total Sales: **${totalSales.toLocaleString()} YER** • Paid: **${totalPaid.toLocaleString()} YER**\n` +
          `- Balance Due: **${balanceDue.toLocaleString()} YER**\n` +
          `- Detail Mode: **${includeSaleDetails ? "Itemized sale details included (items, qty, rates, payments) ✅" : "Summary totals only 📊"}**\n` +
          `[Navigated to Customers module to print or export PDF immediately]`,
      }, ctx);
    }

    // -----------------------------------------------------------------------
    // 16. query_workspace_data (READ TOOL -> LIVE OPERATIONAL Q&A + CITATIONS)
    // -----------------------------------------------------------------------
    case "query_workspace_data": {
      const scope = String(args.scope ?? "all").toLowerCase();
      const rawQuery = String(args.query ?? "").trim();
      const queryLower = rawQuery.toLowerCase();

      const citations: CitationLink[] = [];

      // A. Scope: Customers / Client Balances
      if (
        scope === "customers" ||
        queryLower.includes("عميل") ||
        queryLower.includes("customer") ||
        queryLower.includes("client") ||
        queryLower.includes("مديونية") ||
        queryLower.includes("مديونيه")
      ) {
        const sales = ctx.state?.sales ?? [];
        const matchingSales = sales.filter((s) => {
          if (!rawQuery) return true;
          const cust = s.customer.toLowerCase();
          return cust.includes(queryLower) || queryLower.includes(cust) || s.phone.includes(rawQuery);
        });
        const totalSales = matchingSales.reduce((s, r) => s + Number(r.total || 0), 0);
        const totalPaid = matchingSales.reduce((s, r) => s + Number(r.credit || 0), 0);
        const balanceDue = matchingSales.reduce((s, r) => s + Number(r.debit ?? (r.total - (r.credit || 0))), 0);

        citations.push({
          labelAr: "سجل مبيعات وحسابات العملاء",
          labelEn: "Customer Accounts & Sales Ledger",
          tab: "customers",
          type: "tab",
        });

        const targetName = rawQuery || (lang === "ar" ? "كافة العملاء" : "All Customers");
        return makeResult(lang, {
          ok: true,
          toolName,
          requiresConfirmation: false,
          navigationTab: "customers",
          citations,
          data: {
            scope: "customers",
            targetName,
            transactionsCount: matchingSales.length,
            totalSales,
            totalPaid,
            balanceDue,
          },
          summaryAr:
            `📊 **بيانات رصيد ومديونية العميل (${targetName}):**\n` +
            `- إجمالي المبيعات المحررة: **${totalSales.toLocaleString()} YER**\n` +
            `- المسدد والمقبوض: **${totalPaid.toLocaleString()} YER**\n` +
            `- رصيد المديونية المتبقي: **${balanceDue.toLocaleString()} YER**\n` +
            `- عدد الفواتير والعمليات: **${matchingSales.length}** عملية مسجلة.\n` +
            `*(يمكنك النقر على الرابط المباشر أدناه للانتقال لقسم العملاء)*`,
          summaryEn:
            `📊 **Client Account & Balance Data (${targetName}):**\n` +
            `- Total Invoiced: **${totalSales.toLocaleString()} YER**\n` +
            `- Total Paid: **${totalPaid.toLocaleString()} YER**\n` +
            `- Outstanding Balance Due: **${balanceDue.toLocaleString()} YER**\n` +
            `- Transactions: **${matchingSales.length}** recorded.\n` +
            `*(Click citation link below to navigate to Customers module)*`,
        }, ctx);
      }

      // B. Scope: Vendors / Supplier Payables
      if (
        scope === "vendors" ||
        queryLower.includes("مورد") ||
        queryLower.includes("vendor") ||
        queryLower.includes("supplier") ||
        queryLower.includes("مستحق")
      ) {
        const expenses = ctx.state?.expenses ?? [];
        const matchingExpenses = expenses.filter((e) =>
          rawQuery ? e.notes.toLowerCase().includes(queryLower) || e.category.toLowerCase().includes(queryLower) || e.subType.toLowerCase().includes(queryLower) : true
        );
        const totalExpenses = matchingExpenses.reduce((s, r) => s + Number(r.total || 0), 0);

        citations.push({
          labelAr: "سجل المشتريات والمصروفات التشغيلية",
          labelEn: "Procurement & Operating Expenses",
          tab: "procurement",
          type: "tab",
        });

        const targetVendor = rawQuery || (lang === "ar" ? "الموردين والمشتريات" : "Vendors & Procurement");
        return makeResult(lang, {
          ok: true,
          toolName,
          requiresConfirmation: false,
          navigationTab: "procurement",
          citations,
          data: {
            scope: "vendors",
            targetVendor,
            count: matchingExpenses.length,
            totalExpenses,
          },
          summaryAr:
            `📦 **بيانات المشتريات ومستحقات الموردين (${targetVendor}):**\n` +
            `- إجمالي فواتير ومصروفات المشتريات: **${totalExpenses.toLocaleString()} YER**\n` +
            `- عدد القيود والفواتير: **${matchingExpenses.length}** عملية مسجلة.\n` +
            `*(يمكنك النقر على الرابط أدناه للاطلاع على التفاصيل في قسم المشتريات)*`,
          summaryEn:
            `📦 **Vendor Payables & Procurement Data (${targetVendor}):**\n` +
            `- Total Expenses/Bills: **${totalExpenses.toLocaleString()} YER**\n` +
            `- Recorded Transactions: **${matchingExpenses.length}** records.\n` +
            `*(Click the citation link below to view in Procurement module)*`,
        }, ctx);
      }

      // C. Scope: Projects / Cost Centers
      if (
        scope === "projects" ||
        queryLower.includes("مشروع") ||
        queryLower.includes("project") ||
        queryLower.includes("موازنة") ||
        queryLower.includes("budget")
      ) {
        const projects = ctx.state?.projects ?? [];
        const matchingProjects = projects.filter((p) => {
          if (!rawQuery) return true;
          const pName = p.name.toLowerCase();
          const pCode = (p.code ?? "").toLowerCase();
          return (
            pName.includes(queryLower) ||
            queryLower.includes(pName) ||
            (pCode && (pCode.includes(queryLower) || queryLower.includes(pCode)))
          );
        });

        if (matchingProjects.length > 0) {
          const p = matchingProjects[0];
          const budget = p.budgetTotal || p.estimatedValue || 0;
          const expenses = (ctx.state?.expenses ?? []).filter((e) => e.projectId === p.id);
          const wages = (ctx.state?.workers ?? []).filter((w) => w.projectId === p.id);
          const sales = (ctx.state?.sales ?? []).filter((s) => s.projectId === p.id);

          const totalSpend = expenses.reduce((s, r) => s + Number(r.total || 0), 0) + wages.reduce((s, r) => s + Number(r.total || 0), 0);
          const totalRevenue = sales.reduce((s, r) => s + Number(r.total || 0), 0);
          const netProfit = totalRevenue - totalSpend;
          const remainingBudget = budget - totalSpend;

          citations.push({
            labelAr: `بطاقة المشروع: ${p.name}`,
            labelEn: `Project Card: ${p.name}`,
            tab: "projects",
            referenceId: p.id,
            type: "record",
          });
          citations.push({
            labelAr: "قائمة الدخل والتقارير المالية للمشروع",
            labelEn: "Financial Reports & Project P&L",
            tab: "reports",
            type: "tab",
          });

          return makeResult(lang, {
            ok: true,
            toolName,
            requiresConfirmation: false,
            navigationTab: "projects",
            citations,
            data: {
              scope: "projects",
              projectId: p.id,
              projectName: p.name,
              budget,
              totalSpend,
              totalRevenue,
              netProfit,
              remainingBudget,
            },
            summaryAr:
              `🌱 **الملخص المالي والتشغيلي لمشروع (${p.name}):**\n` +
              `- الموازنة المعتمدة: **${budget.toLocaleString()} YER**\n` +
              `- إجمالي المصروفات والأجور الفعلية: **${totalSpend.toLocaleString()} YER**\n` +
              `- المتبقي من الموازنة: **${remainingBudget.toLocaleString()} YER**\n` +
              `- إجمالي إيرادات المبيعات المحققة: **${totalRevenue.toLocaleString()} YER**\n` +
              `- صافي الأرباح التشغيلية: **${netProfit.toLocaleString()} YER**\n` +
              `*(روابط المتابعة السريعة مرفقة أدناه لمراجعة بطاقة المشروع والتقارير)*`,
            summaryEn:
              `🌱 **Financial & Operational Summary for Project (${p.name}):**\n` +
              `- Approved Budget: **${budget.toLocaleString()} YER**\n` +
              `- Actual Spend (Expenses & Wages): **${totalSpend.toLocaleString()} YER**\n` +
              `- Remaining Budget: **${remainingBudget.toLocaleString()} YER**\n` +
              `- Sales Revenue: **${totalRevenue.toLocaleString()} YER**\n` +
              `- Net Operating Profit: **${netProfit.toLocaleString()} YER**\n` +
              `*(Click below to open project card and financial reports)*`,
          }, ctx);
        }
      }

      // D0. Scope: Workers & Harvest Labor
      if (
        scope === "workers" ||
        queryLower.includes("عامل") ||
        queryLower.includes("عمال") ||
        queryLower.includes("اجور") ||
        queryLower.includes("أجور") ||
        queryLower.includes("worker") ||
        queryLower.includes("wage") ||
        queryLower.includes("payroll")
      ) {
        const workers = ctx.state?.workers ?? [];
        const matched = rawQuery
          ? workers.filter(
              (w) =>
                w.name.toLowerCase().includes(queryLower) ||
                (w.harvest || "").toLowerCase().includes(queryLower)
            )
          : workers;
        const list = matched.length > 0 ? matched : workers;
        const totalWages = list.reduce((s, w) => s + Number(w.total || 0), 0);
        const totalPaid = list.reduce((s, w) => s + Number(w.credit || 0), 0);
        const totalOwed = list.reduce((s, w) => s + Number(w.debit ?? Math.max(0, w.total - w.credit)), 0);

        citations.push({
          labelAr: "قسم أجور العمال والحصاد",
          labelEn: "Workers & Field Payroll",
          tab: "workers",
          type: "tab",
        });

        return makeResult(lang, {
          ok: true,
          toolName,
          requiresConfirmation: false,
          navigationTab: "workers",
          citations,
          data: {
            scope: "workers",
            count: list.length,
            totalWages,
            totalPaid,
            totalOwed,
            workers: list.slice(-5),
          },
          summaryAr:
            `👷 **ملخص أجور العمال والعمالة الزراعية:**\n` +
            `- عدد السجلات: **${list.length}** قيد أجر • إجمالي المستحق: **${totalWages.toLocaleString()} YER**\n` +
            `- المسدد فعلياً: **${totalPaid.toLocaleString()} YER** • المتبقي غير المدفوع: **${totalOwed.toLocaleString()} YER**\n` +
            `*(يمكنك تسجيل أجر جديد بمجرد كتابة: سجل أجر للعامل فلان بمبلغ ...)*`,
          summaryEn:
            `👷 **Workers & Harvest Payroll Summary:**\n` +
            `- Entries: **${list.length}** • Gross Wages: **${totalWages.toLocaleString()} YER**\n` +
            `- Paid: **${totalPaid.toLocaleString()} YER** • Unpaid Payable Balance: **${totalOwed.toLocaleString()} YER**\n` +
            `*(To post a wage via chat, ask: "record worker wage for <name> daily <amount>")*`,
        }, ctx);
      }

      // D1. Scope: Audit Trail & Harvest Locks
      if (
        scope === "audit" ||
        queryLower.includes("تدقيق") ||
        queryLower.includes("اقفال") ||
        queryLower.includes("إقفال") ||
        queryLower.includes("مغلق") ||
        queryLower.includes("audit") ||
        queryLower.includes("lock")
      ) {
        const locks = Object.entries(ctx.state?.lockedPeriods ?? {}).filter(([, v]) => Boolean(v));
        const allAudits = ctx.state?.auditLogs ?? [];
        const audits = allAudits.slice(0, 5);
        const qCount = ctx.workspaceContext?.offlineQueueCount ?? 0;
        const cCount = ctx.workspaceContext?.pendingConflictsCount ?? 0;

        citations.push({
          labelAr: "سجل التدقيق وإقفال الفترات",
          labelEn: "Audit Trail & Period Locks",
          tab: "audit",
          type: "tab",
        });

        return makeResult(lang, {
          ok: true,
          toolName,
          requiresConfirmation: false,
          navigationTab: "audit",
          citations,
          data: {
            scope: "audit",
            lockedPeriodsCount: locks.length,
            lockedKeys: locks.map(([k]) => k),
            recentAuditCount: audits.length,
            offlineQueueCount: qCount,
            pendingConflictsCount: cCount,
          },
          summaryAr:
            `🔒 **تقرير التدقيق وإقفال الفترات:**\n` +
            `- عدد القطفات المغلقة محاسبياً: **${locks.length}** ${locks.length > 0 ? `(${locks.slice(0, 3).map(([k]) => k).join("، ")})` : ""}\n` +
            `- أحدث حركات التدقيق: **${allAudits.length}** حركة • طابور الأوفلاين: **${qCount}** • تعارضات المزامنة: **${cCount}**.\n` +
            (audits.length > 0 ? `\n**آخر حركات التدقيق:**\n${audits.map((a) => `- [${a.user}] ${a.action} (${a.details})`).join("\n")}` : ""),
          summaryEn:
            `🔒 **Audit Trail & Period Lock Report:**\n` +
            `- Locked Harvest Periods: **${locks.length}** ${locks.length > 0 ? `(${locks.slice(0, 3).map(([k]) => k).join(", ")})` : ""}\n` +
            `- Audit Entries: **${allAudits.length}** • Offline Sync Queue: **${qCount}** • Pending Conflicts: **${cCount}**.\n` +
            (audits.length > 0 ? `\n**Recent Audit Log:**\n${audits.map((a) => `- [${a.user}] ${a.action} (${a.details})`).join("\n")}` : ""),
        }, ctx);
      }

      // D2. Scope: Treasury Accounts Balances
      if (scope === "treasury") {
        const accounts = ctx.state?.treasuryAccounts ?? [];
        const totalYER = accounts.reduce((s, a) => s + Number(a.balanceYER || a.balance || 0), 0);
        citations.push({
          labelAr: "أرصدة الصناديق والبنوك",
          labelEn: "Treasury & Bank Accounts",
          tab: "treasury",
          type: "tab",
        });
        return makeResult(lang, {
          ok: true,
          toolName,
          requiresConfirmation: false,
          navigationTab: "treasury",
          citations,
          data: { scope: "treasury", accountsCount: accounts.length, totalYER, accounts },
          summaryAr:
            `🏦 **أرصدة الخزينة والبنوك (${accounts.length} حساب):**\n` +
            `- إجمالي السيولة المعادلة: **${totalYER.toLocaleString()} YER**\n` +
            accounts.map((a) => `- \`${a.code || a.id}\` ${a.nameAr || a.name}: **${Number(a.balance || 0).toLocaleString()} ${a.currencyCode || "YER"}**`).join("\n"),
          summaryEn:
            `🏦 **Treasury & Bank Balances (${accounts.length} accounts):**\n` +
            `- Total Base Liquidity: **${totalYER.toLocaleString()} YER**\n` +
            accounts.map((a) => `- \`${a.code || a.id}\` ${a.nameEn || a.nameAr || a.name}: **${Number(a.balance || 0).toLocaleString()} ${a.currencyCode || "YER"}**`).join("\n"),
        }, ctx);
      }

      // D. Scope: Recent Vouchers / Treasury
      if (
        scope === "vouchers" ||
        queryLower.includes("سند") ||
        queryLower.includes("voucher") ||
        queryLower.includes("قبض") ||
        queryLower.includes("صرف") ||
        queryLower.includes("خزينة")
      ) {
        const installments = ctx.state?.installments ?? [];
        const recent = installments.slice(-5).reverse();
        const totalVoucherAmount = installments.reduce((s, r) => s + Number(r.amount || 0), 0);

        citations.push({
          labelAr: "سجل الخزينة وسندات القبض والصرف",
          labelEn: "Treasury & Installment Vouchers",
          tab: "treasury",
          type: "tab",
        });

        const recentListAr = recent.map((v) => `- ${v.voucherNo}: **${v.amount.toLocaleString()} YER** (${v.targetName || "طرف مسجل"}) • ${v.date}`).join("\n");
        const recentListEn = recent.map((v) => `- ${v.voucherNo}: **${v.amount.toLocaleString()} YER** (${v.targetName || "Party"}) • ${v.date}`).join("\n");

        return makeResult(lang, {
          ok: true,
          toolName,
          requiresConfirmation: false,
          navigationTab: "treasury",
          citations,
          data: {
            scope: "vouchers",
            totalCount: installments.length,
            totalVoucherAmount,
            recent,
          },
          summaryAr:
            `💰 **سندات الخزينة وحركة المدفوعات والمقبوضات:**\n` +
            `- إجمالي عدد السندات المسجلة: **${installments.length}** سند بمبلغ إجمالي **${totalVoucherAmount.toLocaleString()} YER**\n` +
            (recent.length > 0 ? `\n**أحدث السندات المسجلة:**\n${recentListAr}\n` : "") +
            `*(يمكنك النقر أدناه لفتح سجل الخزينة)*`,
          summaryEn:
            `💰 **Treasury Vouchers & Cash Flow Summary:**\n` +
            `- Total Vouchers: **${installments.length}** vouchers totaling **${totalVoucherAmount.toLocaleString()} YER**\n` +
            (recent.length > 0 ? `\n**Recent Vouchers:**\n${recentListEn}\n` : "") +
            `*(Click below to open Treasury module)*`,
        }, ctx);
      }

      // E. Composite or Open Workspace Knowledge / Support Fallback
      citations.push({
        labelAr: "لوحة القيادة والمؤشرات العامة",
        labelEn: "Executive Dashboard",
        tab: "dashboard",
        type: "tab",
      });

      const supportRes = answerSupportQuery(rawQuery, {
        lang,
        diagnostics: ctx.diagnostics,
        topK: 2,
      });

      if (supportRes.matches.length > 0) {
        for (const m of supportRes.matches) {
          citations.push({
            labelAr: `فصل ${m.section.chapterNumber}: ${m.section.titleAr}`,
            labelEn: `Ch.${m.section.chapterNumber}: ${m.section.titleEn}`,
            tab: (m.section.targetTab as TabId) || "system",
            referenceId: m.section.id,
            type: "manual",
          });
        }
      }

      const totalCashYER = (ctx.state?.treasuryAccounts ?? []).reduce((s, a) => s + Number(a.balanceYER || a.balance || 0), 0);
      const activeProjectsCount = (ctx.state?.projects ?? []).length;
      const salesCount = (ctx.state?.sales ?? []).length;

      return makeResult(lang, {
        ok: true,
        toolName,
        requiresConfirmation: false,
        navigationTab: "dashboard",
        citations,
        data: {
          scope: "all",
          totalCashYER,
          activeProjectsCount,
          salesCount,
        },
        summaryAr:
          `🏢 **ملخص بيانات منظومة UAS وقواعد العمل:**\n` +
          `- السيولة النقدية المتاحة بالخزائن والبنوك: **${totalCashYER.toLocaleString()} YER**\n` +
          `- عدد المشاريع المسجلة: **${activeProjectsCount}** مشاريع • عمليات البيع: **${salesCount}** عملية.\n\n` +
          `📖 **إجابة الاستفسار والقواعد المحاسبية:**\n${supportRes.answerAr}`,
        summaryEn:
          `🏢 **UAS System Workspace Snapshot & Rules:**\n` +
          `- Available Treasury & Bank Cash: **${totalCashYER.toLocaleString()} YER**\n` +
          `- Active Projects: **${activeProjectsCount}** • Sales Transactions: **${salesCount}**.\n\n` +
          `📖 **Knowledge & Policy Guidance:**\n${supportRes.answerEn}`,
      }, ctx);
    }

    // -----------------------------------------------------------------------
    // 17. reconcile_harvest_inventory (CROSS-SECTION REASONING)
    // -----------------------------------------------------------------------
    case "reconcile_harvest_inventory": {
      const targetProjectId = String(args.projectId ?? ctx.workspaceContext?.selectedProjectId ?? "").trim();
      const targetHarvest = String(args.harvest ?? ctx.workspaceContext?.selectedHarvest ?? "").trim();
      const targetGrade = String(args.grade ?? "").trim().toLowerCase();

      const batches = (ctx.state?.inventoryBatches ?? []).filter((b) => {
        if (targetProjectId && b.projectId !== targetProjectId) return false;
        if (targetHarvest && b.harvest !== targetHarvest) return false;
        if (targetGrade && !b.grade.toLowerCase().includes(targetGrade)) return false;
        return true;
      });
      const sales = (ctx.state?.sales ?? []).filter((s) => {
        if (targetProjectId && s.projectId !== targetProjectId) return false;
        if (targetHarvest && s.harvest !== targetHarvest) return false;
        if (targetGrade && !s.grade.toLowerCase().includes(targetGrade)) return false;
        return true;
      });

      const report = reconcileHarvestInventory(batches, sales);
      const totalHarvested = report.rows.reduce((s, r) => s + r.harvestedBundles, 0);
      const totalShrinkage = report.rows.reduce((s, r) => s + r.shrinkageBundles, 0);
      const totalSold = report.rows.reduce((s, r) => s + r.soldBundles, 0);
      const totalRemaining = report.rows.reduce((s, r) => s + r.remainingBundles, 0);
      const uncollectedAR = sales.reduce((s, r) => s + Number(r.debit ?? Math.max(0, r.total - r.credit)), 0);
      const shrinkageRate = totalHarvested > 0 ? Math.round((totalShrinkage / totalHarvested) * 100) : 0;

      const anomalyNotesAr: string[] = [];
      const anomalyNotesEn: string[] = [];
      const shortageCount = report.summary.shortageBatchCount;
      if (shortageCount > 0) {
        anomalyNotesAr.push(`🚨 توجد **${shortageCount}** دفعات بها عجز مخزون سالب (مباع أكبر من المتاح بعد التالف).`);
        anomalyNotesEn.push(`🚨 **${shortageCount}** batches have negative stock shortage (sold exceeds net stock).`);
      }
      if (shrinkageRate >= 10) {
        anomalyNotesAr.push(`⚠️ نسبة التالف/الفرز مرتفعة (**${shrinkageRate}%** من إجمالي المحصول).`);
        anomalyNotesEn.push(`⚠️ Spoilage/shrinkage rate is elevated (**${shrinkageRate}%** of harvested yield).`);
      }
      if (uncollectedAR > 0) {
        anomalyNotesAr.push(`💳 ذمم مبيعات غير محصلة ضمن هذه القطفات: **${uncollectedAR.toLocaleString()} YER**.`);
        anomalyNotesEn.push(`💳 Uncollected receivables in scope: **${uncollectedAR.toLocaleString()} YER**.`);
      }

      const citations: CitationLink[] = [
        { labelAr: "مطابقة المخزون والدفعات", labelEn: "Inventory & Batch Reconciliation", tab: "inventory", type: "tab" },
        { labelAr: "سجل المبيعات والذمم", labelEn: "Sales & Receivables", tab: "sales", type: "tab" },
      ];

      return makeResult(lang, {
        ok: true,
        toolName,
        requiresConfirmation: false,
        navigationTab: "inventory",
        citations,
        data: {
          scopeProjectId: targetProjectId || null,
          scopeHarvest: targetHarvest || null,
          rowsCount: report.rows.length,
          shortageCount,
          totalHarvested,
          totalShrinkage,
          totalSold,
          totalRemaining,
          shrinkageRate,
          uncollectedAR,
        },
        summaryAr:
          `🔍 **تقرير المطابقة المتقاطعة للحصاد والمخزون والمبيعات (${report.rows.length} سجل):**\n` +
          `- إجمالي المقطوف: **${totalHarvested}** • التالف/الفاقد: **${totalShrinkage}** (${shrinkageRate}%) • المباع: **${totalSold}** • الصافي المتاح: **${totalRemaining}**\n` +
          (anomalyNotesAr.length > 0 ? `\n**الملاحظات والمخاطر المكتشفة:**\n${anomalyNotesAr.map((n) => `- ${n}`).join("\n")}` : "\n✅ **النتيجة:** جميع الدفعات متطابقة بدون عجز مخزني."),
        summaryEn:
          `🔍 **Cross-Section Harvest, Inventory & Sales Reconciliation (${report.rows.length} rows):**\n` +
          `- Harvested: **${totalHarvested}** • Shrinkage: **${totalShrinkage}** (${shrinkageRate}%) • Sold: **${totalSold}** • Net Available: **${totalRemaining}**\n` +
          (anomalyNotesEn.length > 0 ? `\n**Detected Anomalies & Risks:**\n${anomalyNotesEn.map((n) => `- ${n}`).join("\n")}` : "\n✅ **Status:** All harvest batches reconcile cleanly with zero negative shortages."),
      }, ctx);
    }

    // -----------------------------------------------------------------------
    // 18. analyze_workspace_context (MULTI-SECTION CONTEXTUAL REASONING)
    // -----------------------------------------------------------------------
    case "analyze_workspace_context": {
      const wCtx = ctx.workspaceContext ?? {};
      const activeTab = (wCtx.activeTab || "dashboard") as TabId;
      const { project, harvest } = resolveProjectAndHarvest(ctx, args);
      const isOffline = Boolean(wCtx.isOffline || wCtx.offlineQueueCount);
      const qCount = wCtx.offlineQueueCount ?? 0;
      const cCount = wCtx.pendingConflictsCount ?? 0;

      const projectSales = project ? (ctx.state?.sales ?? []).filter((s) => s.projectId === project.id) : (ctx.state?.sales ?? []);
      const projectExpenses = project ? (ctx.state?.expenses ?? []).filter((e) => e.projectId === project.id) : (ctx.state?.expenses ?? []);
      const projectWages = project ? (ctx.state?.workers ?? []).filter((w) => w.projectId === project.id) : (ctx.state?.workers ?? []);
      const projectBatches = project ? (ctx.state?.inventoryBatches ?? []).filter((b) => b.projectId === project.id) : (ctx.state?.inventoryBatches ?? []);

      const revenue = projectSales.reduce((s, r) => s + Number(r.total || 0), 0);
      const arDue = projectSales.reduce((s, r) => s + Number(r.debit ?? Math.max(0, r.total - r.credit)), 0);
      const spend = projectExpenses.reduce((s, r) => s + Number(r.total || 0), 0) + projectWages.reduce((s, w) => s + Number(w.total || 0), 0);
      const cashBalance = (ctx.state?.treasuryAccounts ?? []).reduce((s, a) => s + Number(a.balanceYER || a.balance || 0), 0);
      const recon = reconcileHarvestInventory(projectBatches, projectSales);
      const isLocked = project ? Boolean(ctx.state?.lockedPeriods?.[`${project.id}::${harvest}`]) : false;

      const insightsAr: string[] = [];
      const insightsEn: string[] = [];

      if (isOffline || qCount > 0 || cCount > 0) {
        insightsAr.push(`📡 وضع التشغيل: ${isOffline ? "أوفلاين/محلي" : "متصل"} • طابور المزامنة: **${qCount}** • تعارضات: **${cCount}**.`);
        insightsEn.push(`📡 Runtime: ${isOffline ? "Offline/Local" : "Online"} • Queued writes: **${qCount}** • Conflicts: **${cCount}**.`);
      }
      const shortageCount = recon.summary.shortageBatchCount;
      if (shortageCount > 0) {
        insightsAr.push(`📦 تنبيه: يوجد عجز مخزون في **${shortageCount}** دفعات حصاد يتطلب مراجعة.`);
        insightsEn.push(`📦 Alert: **${shortageCount}** harvest batches show stock shortages.`);
      }
      if (arDue > 0) {
        insightsAr.push(`💰 مستحقات تحصيل لدى العملاء: **${arDue.toLocaleString()} YER** — يمكنك إصدار سند قبض مباشرة.`);
        insightsEn.push(`💰 Open customer receivables: **${arDue.toLocaleString()} YER** — you can draft a receipt voucher directly.`);
      }
      if (isLocked) {
        insightsAr.push(`🔒 تنبيه: القطفة النشطة (**${harvest}**) مقفلة محاسبياً؛ أي قيد عليها سيتطلب فتح الفترة أولاً.`);
        insightsEn.push(`🔒 Notice: Active harvest (**${harvest}**) is period-locked; new postings require unlocking first.`);
      }
      if (project && (project.budgetTotal || 0) > 0 && spend > (project.budgetTotal || 0)) {
        insightsAr.push(`⚠️ الإنفاق الفعلي (**${spend.toLocaleString()} YER**) تجاوز موازنة المشروع (**${(project.budgetTotal || 0).toLocaleString()} YER**).`);
        insightsEn.push(`⚠️ Actual spend (**${spend.toLocaleString()} YER**) exceeds project budget (**${(project.budgetTotal || 0).toLocaleString()} YER**).`);
      }

      const citations: CitationLink[] = [
        { labelAr: `القسم النشط (${activeTab})`, labelEn: `Active Tab (${activeTab})`, tab: activeTab, type: "tab" },
      ];
      if (shortageCount > 0) {
        citations.push({ labelAr: "فحص عجز المخزون", labelEn: "Inspect Stock Shortages", tab: "inventory", type: "tab" });
      }

      const isGreeting = String(args.focus ?? "").toLowerCase() === "greeting";
      const greeting = isGreeting
        ? buildCopilotGreetingFallback({
            lang,
            dialect: wCtx.dialect ?? "yemeni",
            activeTab,
            projectName: project?.name ?? null,
          })
        : null;

      return makeResult(lang, {
        ok: true,
        toolName,
        requiresConfirmation: false,
        navigationTab: activeTab,
        citations,
        data: {
          activeTab,
          projectId: project?.id ?? null,
          projectName: project?.name ?? null,
          harvest,
          isLocked,
          revenue,
          spend,
          arDue,
          cashBalance,
          shortageCount,
          offlineQueueCount: qCount,
          pendingConflictsCount: cCount,
        },
        summaryAr:
          (greeting ? `${greeting.ar}\n\n` : "") +
          `🧠 **ملخص السياق الحالي (${activeTab}):**\n` +
          (project ? `- المشروع النشط: **${project.name}** • القطفة: **${harvest}** (${isLocked ? "مقفلة 🔒" : "مفتوحة 🔓"})\n` : "") +
          `- الإيرادات: **${revenue.toLocaleString()} YER** • المصروفات والأجور: **${spend.toLocaleString()} YER** • صافي السيولة بالخزينة: **${cashBalance.toLocaleString()} YER**\n` +
          (insightsAr.length > 0 ? `\n**تنبيهات وتوصيات تهمك:**\n${insightsAr.map((i) => `- ${i}`).join("\n")}` : "\n✅ المؤشرات متوازنة والأمور طيبة، ما في أي عجز أو تنبيهات حرجة حالياً."),
        summaryEn:
          (greeting ? `${greeting.en}\n\n` : "") +
          `🧠 **Cross-Section Workspace Briefing (${activeTab}):**\n` +
          (project ? `- Active Project: **${project.name}** • Harvest: **${harvest}** (${isLocked ? "Locked 🔒" : "Open 🔓"})\n` : "") +
          `- Revenue: **${revenue.toLocaleString()} YER** • Spend (Exp+Wages): **${spend.toLocaleString()} YER** • Cash On Hand: **${cashBalance.toLocaleString()} YER**\n` +
          (insightsEn.length > 0 ? `\n**Cross-Section Insights & Recommendations:**\n${insightsEn.map((i) => `- ${i}`).join("\n")}` : "\n✅ Metrics are balanced with no critical warnings right now."),
      }, ctx);
    }

    // -----------------------------------------------------------------------
    // 19. draft_harvest_batch
    // -----------------------------------------------------------------------
    case "draft_harvest_batch": {
      const perm = checkWritePermission(ctx.user, "inventory", false);
      if (!perm.allowed) {
        return makeResult(lang, { ok: false, toolName, code: "RBAC_FORBIDDEN", requiresConfirmation: false, summaryAr: perm.summaryAr, summaryEn: perm.summaryEn }, ctx);
      }
      const { project, harvest } = resolveProjectAndHarvest(ctx, args);
      if (!project) {
        return makeResult(lang, {
          ok: false,
          toolName,
          code: "PROJECT_REQUIRED",
          requiresConfirmation: false,
          summaryAr: "يرجى إنشاء أو تحديد مشروع أولاً قبل تسجيل دفعة مخزون حصاد.",
          summaryEn: "Please select or create a project before recording a harvest inventory batch.",
        });
      }
      const grade = String(args.grade ?? "رقم 1").trim();
      const harvestedBundles = Math.max(0, Math.round(Number(args.harvestedBundles ?? args.bundles ?? args.quantity ?? 0)));
      const shrinkageBundles = Math.max(0, Math.round(Number(args.shrinkageBundles ?? args.shrinkage ?? 0)));
      if (harvestedBundles <= 0) {
        return makeResult(lang, {
          ok: true,
          toolName,
          requiresConfirmation: false,
          clarificationPrompt: {
            questionAr: `كم عدد العلاقيات المقطوفة لتسجيلها في (${project.name} - ${harvest})؟`,
            questionEn: `How many harvested bundles should be recorded for (${project.name} - ${harvest})?`,
            missingFields: ["harvestedBundles"],
            quickOptions: [
              { labelAr: "50 علاقي رقم 1", labelEn: "50 bundles Grade 1", promptFill: `سجل دفعة حصاد 50 علاقي رقم 1 في ${harvest}` },
              { labelAr: "100 علاقي رقم 1", labelEn: "100 bundles Grade 1", promptFill: `سجل دفعة حصاد 100 علاقي رقم 1 في ${harvest}` },
            ],
          },
          summaryAr: "❓ يرجى تحديد كمية العلاقيات المقطوفة لتسجيل الدفعة.",
          summaryEn: "❓ Please specify the harvested bundle count to record the batch.",
        }, ctx);
      }

      const preFlight = buildCrossSectionPreFlightChecks({ ctx, project, harvest });
      const card: ConfirmationPreviewCard = {
        actionId: `ai-invlot-${Date.now()}`,
        toolName: "draft_harvest_batch",
        operationType: "RECORD_HARVEST_BATCH",
        titleAr: `معاينة تسجيل دفعة حصاد (${harvest} - ${grade})`,
        titleEn: `Harvest Batch Preview (${harvest} - ${grade})`,
        narrationAr: `إضافة ${harvestedBundles} علاقي (${grade})${shrinkageBundles > 0 ? ` • تالف ${shrinkageBundles}` : ""} لمشروع ${project.name}`,
        narrationEn: `Record ${harvestedBundles} bundles (${grade})${shrinkageBundles > 0 ? ` • shrinkage ${shrinkageBundles}` : ""} for ${project.name}`,
        date: todayIso,
        currency: "YER",
        projectId: project.id,
        totalDebit: 0,
        totalCredit: 0,
        isBalanced: true,
        lines: [],
        preFlightChecks: preFlight.checks,
        warningsAr: preFlight.warningsAr,
        warningsEn: preFlight.warningsEn,
        endpoint: "/api/inventory",
        httpMethod: "POST",
        confirmButtonLabelAr: "تأكيد وتسجيل الدفعة",
        confirmButtonLabelEn: "Confirm & Save Batch",
        confirmButtonLabel: "تأكيد وتسجيل الدفعة / Confirm & Save Batch",
        executionPayload: {
          operationType: "RECORD_HARVEST_BATCH",
          projectId: project.id,
          subProjectId: ctx.workspaceContext?.selectedSubProjectId ?? null,
          harvest,
          grade,
          harvestedBundles,
          shrinkageBundles,
          notes: String(args.notes ?? `تم التسجيل عبر المساعد الذكي`),
          executed_by_ai: true,
        },
      };
      const msg = appendWarningsText(
        `🛡️ **بوابة التأكيد:** جاهز لتسجيل دفعة حصاد (**${harvestedBundles}** علاقي ${grade}) في مشروع **${project.name}** (${harvest}).`,
        `🛡️ **Confirmation Gate:** Ready to record harvest batch (**${harvestedBundles}** bundles ${grade}) on **${project.name}** (${harvest}).`,
        preFlight.warningsAr,
        preFlight.warningsEn
      );
      return makeResult(lang, { ok: true, toolName, requiresConfirmation: true, confirmationCard: card, data: { preview: card }, ...msg });
    }

    // -----------------------------------------------------------------------
    // 20. draft_sale_transaction
    // -----------------------------------------------------------------------
    case "draft_sale_transaction": {
      const perm = checkWritePermission(ctx.user, "sales", false);
      if (!perm.allowed) {
        return makeResult(lang, { ok: false, toolName, code: "RBAC_FORBIDDEN", requiresConfirmation: false, summaryAr: perm.summaryAr, summaryEn: perm.summaryEn }, ctx);
      }
      const { project, harvest } = resolveProjectAndHarvest(ctx, args);
      if (!project) {
        return makeResult(lang, {
          ok: false,
          toolName,
          code: "PROJECT_REQUIRED",
          requiresConfirmation: false,
          summaryAr: "يرجى اختيار مشروع قبل تسجيل عملية البيع.",
          summaryEn: "Please select an active project before recording a sale.",
        });
      }
      const customer = String(args.customer ?? args.partyName ?? "").trim();
      const bundles = Math.max(0, Math.round(Number(args.bundles ?? args.quantity ?? 0)));
      const price = Math.max(0, Number(args.price ?? args.unitPrice ?? 0));
      const credit = Math.max(0, Number(args.credit ?? 0));
      const grade = String(args.grade ?? "رقم 1").trim();

      if (!customer || bundles <= 0 || price <= 0) {
        return makeResult(lang, {
          ok: true,
          toolName,
          requiresConfirmation: false,
          clarificationPrompt: {
            questionAr: "لتسجيل البيع، يرجى تحديد اسم العميل، عدد العلاقيات، وسعر الوحدة:",
            questionEn: "To record a harvest sale, please provide customer name, bundle quantity, and unit price:",
            missingFields: [!customer ? "customer" : "", bundles <= 0 ? "bundles" : "", price <= 0 ? "price" : ""].filter(Boolean),
            quickOptions: [
              { labelAr: "بيع 10 علاقي بسعر 5000 لعميل الأمل", labelEn: "Sell 10 @ 5000 to Al-Amal", promptFill: `سجل بيع 10 علاقي بسعر 5000 للعميل شركة الأمل في ${harvest}` },
            ],
          },
          summaryAr: "❓ يرجى تحديد العميل والكمية وسعر العلاقية لإعداد عملية البيع وفحص المخزون.",
          summaryEn: "❓ Please specify customer name, bundle count, and unit price to validate stock and draft the sale.",
        }, ctx);
      }

      const total = bundles * price;
      const treasuryAccountId = String(args.treasuryAccountId ?? ctx.state?.treasuryAccounts?.[0]?.id ?? "t1");
      const preFlight = buildCrossSectionPreFlightChecks({
        ctx,
        project,
        harvest,
        customerName: customer,
        grade,
        requestedBundles: bundles,
      });

      const lines: PreviewLedgerLine[] = [
        {
          accountCode: credit >= total ? "111101" : "112101",
          accountNameAr: credit >= total ? "الصندوق الرئيسي" : `العميل: ${customer}`,
          accountNameEn: credit >= total ? "Main Treasury" : `Customer: ${customer}`,
          debit: total,
          credit: 0,
        },
        {
          accountCode: "411101",
          accountNameAr: `إيراد مبيعات (${harvest} - ${grade})`,
          accountNameEn: `Harvest Sales Revenue (${harvest})`,
          debit: 0,
          credit: total,
        },
      ];

      const card: ConfirmationPreviewCard = {
        actionId: `ai-sale-${Date.now()}`,
        toolName: "draft_sale_transaction",
        operationType: "RECORD_SALE",
        titleAr: `معاينة تسجيل عملية بيع (${customer})`,
        titleEn: `Harvest Sale Preview (${customer})`,
        narrationAr: `بيع ${bundles} علاقي ${grade} × ${price.toLocaleString()} = ${total.toLocaleString()} YER للعميل ${customer} (مدفوع: ${credit.toLocaleString()})`,
        narrationEn: `Sale ${bundles} bundles (${grade}) × ${price.toLocaleString()} = ${total.toLocaleString()} YER to ${customer} (Paid: ${credit.toLocaleString()})`,
        date: String(args.date ?? todayIso).slice(0, 10),
        currency: "YER",
        projectId: project.id,
        partyName: customer,
        totalDebit: total,
        totalCredit: total,
        isBalanced: true,
        lines,
        preFlightChecks: preFlight.checks,
        warningsAr: preFlight.warningsAr,
        warningsEn: preFlight.warningsEn,
        endpoint: "/api/sales",
        httpMethod: "POST",
        confirmButtonLabelAr: "تأكيد وترحيل البيع",
        confirmButtonLabelEn: "Confirm & Post Sale",
        confirmButtonLabel: "تأكيد وترحيل البيع / Confirm & Post Sale",
        executionPayload: {
          operationType: "RECORD_SALE",
          projectId: project.id,
          subProjectId: ctx.workspaceContext?.selectedSubProjectId ?? null,
          harvest,
          grade,
          customer,
          phone: String(args.phone ?? ""),
          bundles,
          price,
          credit,
          date: String(args.date ?? todayIso).slice(0, 10),
          treasuryAccountId,
          allowNegativeStock: Boolean(args.allowNegativeStock),
          notes: String(args.notes ?? `تسجيل عبر المساعد الذكي`),
          executed_by_ai: true,
        },
      };

      const msg = appendWarningsText(
        `🛡️ **بوابة التأكيد:** جاهز لترحيل عملية بيع بمبلغ **${total.toLocaleString()} YER** للعميل **${customer}** (${bundles} × ${price.toLocaleString()}) من مخزون **${harvest}**.`,
        `🛡️ **Confirmation Gate:** Ready to post sale of **${total.toLocaleString()} YER** to **${customer}** (${bundles} × ${price.toLocaleString()}) from **${harvest}**.`,
        preFlight.warningsAr,
        preFlight.warningsEn
      );
      return makeResult(lang, { ok: true, toolName, requiresConfirmation: true, confirmationCard: card, data: { preview: card, preFlightChecks: preFlight.checks }, ...msg });
    }

    // -----------------------------------------------------------------------
    // 21. draft_operating_expense
    // -----------------------------------------------------------------------
    case "draft_operating_expense": {
      const perm = checkWritePermission(ctx.user, "expenses", false);
      if (!perm.allowed) {
        return makeResult(lang, { ok: false, toolName, code: "RBAC_FORBIDDEN", requiresConfirmation: false, summaryAr: perm.summaryAr, summaryEn: perm.summaryEn }, ctx);
      }
      const { project, harvest } = resolveProjectAndHarvest(ctx, args);
      if (!project) {
        return makeResult(lang, {
          ok: false,
          toolName,
          code: "PROJECT_REQUIRED",
          requiresConfirmation: false,
          summaryAr: "يرجى تحديد مشروع لتسجيل المصروف التشغيلي.",
          summaryEn: "Please select a project before recording an operating expense.",
        });
      }
      const category = String(args.category ?? "وقود/محروقات").trim();
      const subType = String(args.subType ?? category).trim();
      const qty = Math.max(1, Number(args.qty ?? args.quantity ?? 1));
      const unitPrice = Math.max(0, Number(args.unitPrice ?? args.amount ?? 0));
      const total = qty * unitPrice;
      if (total <= 0) {
        return makeResult(lang, {
          ok: true,
          toolName,
          requiresConfirmation: false,
          clarificationPrompt: {
            questionAr: "ما هو نوع ومبلغ المصروف التشغيلي المطلوب تسجيله؟",
            questionEn: "What is the expense category and amount?",
            missingFields: ["unitPrice"],
            quickOptions: [
              { labelAr: "وقود/ديزل 25,000 YER", labelEn: "Fuel/Diesel 25,000 YER", promptFill: `سجل مصروف وقود بمبلغ 25000 YER في ${harvest}` },
              { labelAr: "نقل/توريد 15,000 YER", labelEn: "Transport 15,000 YER", promptFill: `سجل مصروف نقل بمبلغ 15000 YER في ${harvest}` },
            ],
          },
          summaryAr: "❓ يرجى تحديد مبلغ المصروف التشغيلي (مثال: سجل مصروف وقود بمبلغ 25000 YER).",
          summaryEn: "❓ Please specify the expense amount (e.g. record fuel expense of 25000 YER).",
        }, ctx);
      }

      const treasuryAccountId = String(args.treasuryAccountId ?? ctx.state?.treasuryAccounts?.[0]?.id ?? "t1");
      const preFlight = buildCrossSectionPreFlightChecks({
        ctx,
        project,
        harvest,
        outflowAmount: total,
        treasuryIdOrCode: treasuryAccountId,
        checkBudgetSpend: total,
      });

      const card: ConfirmationPreviewCard = {
        actionId: `ai-exp-${Date.now()}`,
        toolName: "draft_operating_expense",
        operationType: "RECORD_EXPENSE",
        titleAr: `معاينة مصروف تشغيلي (${category})`,
        titleEn: `Operating Expense Preview (${category})`,
        narrationAr: `صرف ${total.toLocaleString()} YER (${category} — ${subType}) لمشروع ${project.name} (${harvest})`,
        narrationEn: `Expense ${total.toLocaleString()} YER (${category} — ${subType}) on ${project.name} (${harvest})`,
        date: String(args.date ?? todayIso).slice(0, 10),
        currency: "YER",
        projectId: project.id,
        totalDebit: total,
        totalCredit: total,
        isBalanced: true,
        lines: [
          { accountCode: "524101", accountNameAr: `مصروف: ${category}`, accountNameEn: `Expense: ${category}`, debit: total, credit: 0 },
          { accountCode: "111101", accountNameAr: "الخزينة/الصندوق", accountNameEn: "Treasury", debit: 0, credit: total },
        ],
        preFlightChecks: preFlight.checks,
        warningsAr: preFlight.warningsAr,
        warningsEn: preFlight.warningsEn,
        endpoint: "/api/expenses",
        httpMethod: "POST",
        confirmButtonLabelAr: "تأكيد وترحيل المصروف",
        confirmButtonLabelEn: "Confirm & Post Expense",
        confirmButtonLabel: "تأكيد وترحيل المصروف / Confirm & Post Expense",
        executionPayload: {
          operationType: "RECORD_EXPENSE",
          projectId: project.id,
          subProjectId: ctx.workspaceContext?.selectedSubProjectId ?? null,
          harvest,
          category,
          subType,
          qty,
          unitPrice,
          date: String(args.date ?? todayIso).slice(0, 10),
          treasuryAccountId,
          notes: String(args.notes ?? `مصروف مسجل عبر المساعد الذكي`),
          executed_by_ai: true,
        },
      };

      const msg = appendWarningsText(
        `🛡️ **بوابة التأكيد:** جاهز لترحيل مصروف **${category}** بمبلغ **${total.toLocaleString()} YER** على **${project.name}** (${harvest}).`,
        `🛡️ **Confirmation Gate:** Ready to post expense **${category}** of **${total.toLocaleString()} YER** on **${project.name}** (${harvest}).`,
        preFlight.warningsAr,
        preFlight.warningsEn
      );
      return makeResult(lang, { ok: true, toolName, requiresConfirmation: true, confirmationCard: card, data: { preview: card, preFlightChecks: preFlight.checks }, ...msg });
    }

    // -----------------------------------------------------------------------
    // 22. draft_worker_wage
    // -----------------------------------------------------------------------
    case "draft_worker_wage": {
      const perm = checkWritePermission(ctx.user, "workers", false);
      if (!perm.allowed) {
        return makeResult(lang, { ok: false, toolName, code: "RBAC_FORBIDDEN", requiresConfirmation: false, summaryAr: perm.summaryAr, summaryEn: perm.summaryEn }, ctx);
      }
      const { project, harvest } = resolveProjectAndHarvest(ctx, args);
      if (!project) {
        return makeResult(lang, {
          ok: false,
          toolName,
          code: "PROJECT_REQUIRED",
          requiresConfirmation: false,
          summaryAr: "يرجى اختيار مشروع قبل تسجيل أجر عامل.",
          summaryEn: "Please select a project before recording worker wages.",
        });
      }
      const name = String(args.name ?? args.workerName ?? "").trim();
      const dailyWage = Math.max(0, Number(args.dailyWage ?? args.wage ?? args.amount ?? 0));
      const days = Math.max(1, Number(args.days ?? 1));
      const credit = Math.max(0, Number(args.credit ?? 0));
      if (!name || dailyWage <= 0) {
        return makeResult(lang, {
          ok: true,
          toolName,
          requiresConfirmation: false,
          clarificationPrompt: {
            questionAr: "يرجى تحديد اسم العامل والأجر اليومي (وعدد الأيام):",
            questionEn: "Please provide worker name, daily wage, and days worked:",
            missingFields: [!name ? "name" : "", dailyWage <= 0 ? "dailyWage" : ""].filter(Boolean),
            quickOptions: [
              { labelAr: "أحمد علي — 5,000 × 1 يوم", labelEn: "Ahmed Ali — 5,000 × 1 day", promptFill: `سجل أجر العامل أحمد علي بمبلغ 5000 YER لمدة 1 يوم في ${harvest}` },
            ],
          },
          summaryAr: "❓ يرجى تحديد اسم العامل وقيمة الأجر اليومي لتجهيز قيد الأجور.",
          summaryEn: "❓ Please provide worker name and daily wage to prepare the payroll entry.",
        }, ctx);
      }

      const total = dailyWage * days;
      const preFlight = buildCrossSectionPreFlightChecks({
        ctx,
        project,
        harvest,
        outflowAmount: credit > 0 ? credit : undefined,
        checkBudgetSpend: total,
      });

      const card: ConfirmationPreviewCard = {
        actionId: `ai-wage-${Date.now()}`,
        toolName: "draft_worker_wage",
        operationType: "RECORD_WORKER_WAGE",
        titleAr: `معاينة تسجيل أجر عامل (${name})`,
        titleEn: `Worker Wage Preview (${name})`,
        narrationAr: `أجر ${name}: ${dailyWage.toLocaleString()} × ${days} أيام = ${total.toLocaleString()} YER (مدفوع: ${credit.toLocaleString()})`,
        narrationEn: `Wage ${name}: ${dailyWage.toLocaleString()} × ${days}d = ${total.toLocaleString()} YER (Paid: ${credit.toLocaleString()})`,
        date: String(args.date ?? todayIso).slice(0, 10),
        currency: "YER",
        projectId: project.id,
        partyName: name,
        totalDebit: total,
        totalCredit: total,
        isBalanced: true,
        lines: [
          { accountCode: "511101", accountNameAr: `أجور عمال الحصاد (${name})`, accountNameEn: `Harvest Wages (${name})`, debit: total, credit: 0 },
          { accountCode: credit >= total ? "111101" : "212101", accountNameAr: credit >= total ? "الخزينة" : `مستحقات العامل: ${name}`, accountNameEn: credit >= total ? "Treasury" : `Payable: ${name}`, debit: 0, credit: total },
        ],
        preFlightChecks: preFlight.checks,
        warningsAr: preFlight.warningsAr,
        warningsEn: preFlight.warningsEn,
        endpoint: "/api/workers",
        httpMethod: "POST",
        confirmButtonLabelAr: "تأكيد وتسجيل الأجر",
        confirmButtonLabelEn: "Confirm & Post Wage",
        confirmButtonLabel: "تأكيد وتسجيل الأجر / Confirm & Post Wage",
        executionPayload: {
          operationType: "RECORD_WORKER_WAGE",
          projectId: project.id,
          subProjectId: ctx.workspaceContext?.selectedSubProjectId ?? null,
          harvest,
          name,
          dailyWage,
          days,
          credit,
          date: String(args.date ?? todayIso).slice(0, 10),
          notes: String(args.notes ?? `أجر مسجل عبر المساعد الذكي`),
          executed_by_ai: true,
        },
      };
      const msg = appendWarningsText(
        `🛡️ **بوابة التأكيد:** جاهز لتسجيل أجر العامل **${name}** بإجمالي **${total.toLocaleString()} YER** على **${project.name}** (${harvest}).`,
        `🛡️ **Confirmation Gate:** Ready to record wage for **${name}** totaling **${total.toLocaleString()} YER** on **${project.name}** (${harvest}).`,
        preFlight.warningsAr,
        preFlight.warningsEn
      );
      return makeResult(lang, { ok: true, toolName, requiresConfirmation: true, confirmationCard: card, data: { preview: card, preFlightChecks: preFlight.checks }, ...msg });
    }

    // -----------------------------------------------------------------------
    // 23. draft_treasury_transfer
    // -----------------------------------------------------------------------
    case "draft_treasury_transfer": {
      const perm = checkWritePermission(ctx.user, "treasury", false);
      if (!perm.allowed) {
        return makeResult(lang, { ok: false, toolName, code: "RBAC_FORBIDDEN", requiresConfirmation: false, summaryAr: perm.summaryAr, summaryEn: perm.summaryEn }, ctx);
      }
      const accounts = ctx.state?.treasuryAccounts ?? [];
      if (accounts.length < 2) {
        return makeResult(lang, {
          ok: false,
          toolName,
          code: "INSUFFICIENT_TREASURY_ACCOUNTS",
          requiresConfirmation: false,
          summaryAr: "تحتاج العملية إلى وجود حسابي خزينة/بنك على الأقل لإجراء التحويل الداخلي.",
          summaryEn: "At least two treasury/bank accounts are required for an internal transfer.",
        });
      }
      const fromKey = String(args.fromTreasuryId ?? "").trim().toLowerCase();
      const toKey = String(args.toTreasuryId ?? "").trim().toLowerCase();
      const matchAcc = (a: (typeof accounts)[number], key: string) =>
        a.id.toLowerCase() === key ||
        (a.code || "").toLowerCase() === key ||
        (a.nameAr || a.name || "").toLowerCase().includes(key);
      const fromAcc = (fromKey ? accounts.find((a) => matchAcc(a, fromKey)) : undefined) ?? accounts[0];
      const toAcc =
        (toKey ? accounts.find((a) => matchAcc(a, toKey)) : undefined) ??
        accounts.find((a) => a.id !== fromAcc.id) ??
        accounts[1];

      const fromLabelAr = fromAcc.nameAr || fromAcc.name;
      const fromLabelEn = fromAcc.nameEn || fromLabelAr;
      const toLabelAr = toAcc.nameAr || toAcc.name;
      const toLabelEn = toAcc.nameEn || toLabelAr;
      const trfCurrency = fromAcc.currencyCode || "YER";

      const amount = Math.max(0, Number(args.amount ?? 0));
      if (amount <= 0 || fromAcc.id === toAcc.id) {
        return makeResult(lang, {
          ok: true,
          toolName,
          requiresConfirmation: false,
          clarificationPrompt: {
            questionAr: "يرجى تحديد مبلغ التحويل وحساب المصدر والوجهة:",
            questionEn: "Please specify transfer amount and distinct source/destination treasury accounts:",
            missingFields: ["amount"],
            quickOptions: [
              { labelAr: `تحويل 50,000 من ${fromLabelAr} إلى ${toLabelAr}`, labelEn: `Transfer 50,000`, promptFill: `تحويل 50000 من ${fromLabelAr} إلى ${toLabelAr}` },
            ],
          },
          summaryAr: "❓ يرجى تحديد مبلغ التحويل المالي بين الحسابات.",
          summaryEn: "❓ Please specify a valid transfer amount between distinct treasury accounts.",
        }, ctx);
      }

      const preFlight = buildCrossSectionPreFlightChecks({
        ctx,
        outflowAmount: amount,
        treasuryIdOrCode: fromAcc.id,
      });

      const card: ConfirmationPreviewCard = {
        actionId: `ai-trf-${Date.now()}`,
        toolName: "draft_treasury_transfer",
        operationType: "TREASURY_TRANSFER",
        titleAr: `تحويل مالي: ${fromLabelAr} ⬅️ ${toLabelAr}`,
        titleEn: `Treasury Transfer: ${fromLabelEn} -> ${toLabelEn}`,
        narrationAr: `تحويل ${amount.toLocaleString()} ${trfCurrency} من ${fromLabelAr} إلى ${toLabelAr}`,
        narrationEn: `Transfer ${amount.toLocaleString()} ${trfCurrency} from ${fromLabelEn} to ${toLabelEn}`,
        date: String(args.date ?? todayIso).slice(0, 10),
        currency: trfCurrency,
        totalDebit: amount,
        totalCredit: amount,
        isBalanced: true,
        lines: [
          { accountCode: toAcc.code || toAcc.id, accountNameAr: toLabelAr, accountNameEn: toLabelEn, debit: amount, credit: 0 },
          { accountCode: fromAcc.code || fromAcc.id, accountNameAr: fromLabelAr, accountNameEn: fromLabelEn, debit: 0, credit: amount },
        ],
        preFlightChecks: preFlight.checks,
        warningsAr: preFlight.warningsAr,
        warningsEn: preFlight.warningsEn,
        endpoint: "/api/treasury/transfer",
        httpMethod: "POST",
        confirmButtonLabelAr: "تأكيد التحويل المالي",
        confirmButtonLabelEn: "Confirm Transfer",
        confirmButtonLabel: "تأكيد التحويل المالي / Confirm Transfer",
        executionPayload: {
          operationType: "TREASURY_TRANSFER",
          fromTreasuryId: fromAcc.id,
          toTreasuryId: toAcc.id,
          amount,
          notes: String(args.notes ?? `تحويل داخلي عبر المساعد الذكي`),
          date: String(args.date ?? todayIso).slice(0, 10),
          executed_by_ai: true,
        },
      };
      const msg = appendWarningsText(
        `🛡️ **بوابة التأكيد:** جاهز لتحويل **${amount.toLocaleString()} ${trfCurrency}** من **${fromLabelAr}** إلى **${toLabelAr}**.`,
        `🛡️ **Confirmation Gate:** Ready to transfer **${amount.toLocaleString()} ${trfCurrency}** from **${fromLabelEn}** to **${toLabelEn}**.`,
        preFlight.warningsAr,
        preFlight.warningsEn
      );
      return makeResult(lang, { ok: true, toolName, requiresConfirmation: true, confirmationCard: card, data: { preview: card, preFlightChecks: preFlight.checks }, ...msg });
    }

    // -----------------------------------------------------------------------
    // 24. toggle_period_lock
    // -----------------------------------------------------------------------
    case "toggle_period_lock": {
      const effectiveUser = ctx.user ?? "SUPER_ADMIN";
      if (!canLockPeriod(effectiveUser)) {
        const role = normalizeRole(effectiveUser);
        return makeResult(lang, {
          ok: false,
          toolName,
          code: "RBAC_FORBIDDEN",
          requiresConfirmation: false,
          summaryAr: `⛔ غير مصرح: إغلاق أو فتح فترات الحصاد محصور بالإدارة العليا ورئيس الحسابات (دورك: ${role}).`,
          summaryEn: `⛔ RBAC Blocked: Locking/unlocking harvest periods requires SUPER_ADMIN or CHIEF_ACCOUNTANT (role: ${role}).`,
        }, ctx);
      }
      const { project, harvest } = resolveProjectAndHarvest(ctx, args);
      if (!project) {
        return makeResult(lang, {
          ok: false,
          toolName,
          code: "PROJECT_REQUIRED",
          requiresConfirmation: false,
          summaryAr: "يرجى اختيار مشروع لتعديل حالة إغلاق القطفة.",
          summaryEn: "Please select a project to lock/unlock a harvest period.",
        });
      }
      const key = `${project.id}::${harvest}`;
      const currentlyLocked = Boolean(ctx.state?.lockedPeriods?.[key]);
      const actionVerbAr = currentlyLocked ? "إعادة فتح" : "إغلاق محاسبي";
      const actionVerbEn = currentlyLocked ? "Unlock" : "Lock";

      // Audit stock & AR before locking
      const harvestSales = (ctx.state?.sales ?? []).filter((s) => s.projectId === project.id && s.harvest === harvest);
      const harvestBatches = (ctx.state?.inventoryBatches ?? []).filter((b) => b.projectId === project.id && b.harvest === harvest);
      const recon = reconcileHarvestInventory(harvestBatches, harvestSales);
      const periodShortages = recon.summary.shortageBatchCount;
      const arDue = harvestSales.reduce((s, r) => s + Number(r.debit ?? Math.max(0, r.total - r.credit)), 0);
      const checks: PreFlightCheckItem[] = [
        {
          key: "lock_audit",
          status: periodShortages > 0 ? "warning" : "ok",
          labelAr: `مخزون القطفة: ${recon.rows.reduce((s, r) => s + r.remainingBundles, 0)} متبقي • عجز: ${periodShortages}`,
          labelEn: `Period Stock: ${recon.rows.reduce((s, r) => s + r.remainingBundles, 0)} left • shortages: ${periodShortages}`,
        },
        {
          key: "open_ar",
          status: arDue > 0 ? "warning" : "ok",
          labelAr: `ذمم غير محصلة: ${arDue.toLocaleString()} YER`,
          labelEn: `Open Receivables: ${arDue.toLocaleString()} YER`,
        },
      ];
      const warningsAr: string[] = [];
      const warningsEn: string[] = [];
      if (!currentlyLocked && periodShortages > 0) {
        warningsAr.push(`⚠️ يوجد عجز مخزون في ${harvest} قبل الإقفال.`);
        warningsEn.push(`⚠️ Stock shortages exist in ${harvest} prior to locking.`);
      }

      const card: ConfirmationPreviewCard = {
        actionId: `ai-lock-${Date.now()}`,
        toolName: "toggle_period_lock",
        operationType: "TOGGLE_PERIOD_LOCK",
        titleAr: `${actionVerbAr} فترة (${harvest})`,
        titleEn: `${actionVerbEn} Period (${harvest})`,
        narrationAr: `${actionVerbAr} فترة "${harvest}" لمشروع ${project.name}`,
        narrationEn: `${actionVerbEn} harvest period "${harvest}" for ${project.name}`,
        date: todayIso,
        currency: "YER",
        projectId: project.id,
        totalDebit: 0,
        totalCredit: 0,
        isBalanced: true,
        lines: [],
        preFlightChecks: checks,
        warningsAr,
        warningsEn,
        endpoint: "/api/audit/lock",
        httpMethod: "POST",
        confirmButtonLabelAr: currentlyLocked ? "تأكيد إعادة الفتح 🔓" : "تأكيد الإغلاق المحاسبي 🔒",
        confirmButtonLabelEn: currentlyLocked ? "Confirm Unlock 🔓" : "Confirm Period Lock 🔒",
        confirmButtonLabel: currentlyLocked ? "تأكيد إعادة الفتح / Confirm Unlock" : "تأكيد الإغلاق / Confirm Lock",
        executionPayload: {
          operationType: "TOGGLE_PERIOD_LOCK",
          key,
          projectId: project.id,
          harvest,
          currentlyLocked,
          executed_by_ai: true,
        },
      };
      const msg = appendWarningsText(
        `🛡️ **بوابة الاعتماد:** جاهز لتنفيذ **${actionVerbAr}** على (${project.name} — ${harvest}).`,
        `🛡️ **Confirmation Gate:** Ready to **${actionVerbEn}** (${project.name} — ${harvest}).`,
        warningsAr,
        warningsEn
      );
      return makeResult(lang, { ok: true, toolName, requiresConfirmation: true, confirmationCard: card, data: { preview: card, preFlightChecks: checks }, ...msg });
    }

    // -----------------------------------------------------------------------
    // 25. add_harvest_cycle
    // -----------------------------------------------------------------------
    case "add_harvest_cycle": {
      const perm = checkWritePermission(ctx.user, "projects", false);
      if (!perm.allowed) {
        return makeResult(lang, { ok: false, toolName, code: "RBAC_FORBIDDEN", requiresConfirmation: false, summaryAr: perm.summaryAr, summaryEn: perm.summaryEn }, ctx);
      }
      const { project } = resolveProjectAndHarvest(ctx, args);
      const name = String(args.name ?? args.harvest ?? "").trim();
      if (!project || !name) {
        return makeResult(lang, {
          ok: true,
          toolName,
          requiresConfirmation: false,
          clarificationPrompt: {
            questionAr: "ما هو اسم القطفة أو المرشة الجديدة المراد إضافتها للمشروع؟",
            questionEn: "What is the name of the new harvest cycle to add?",
            missingFields: ["name"],
            quickOptions: [
              { labelAr: "القطفة الثالثة", labelEn: "Harvest 3", promptFill: "أضف قطفة جديدة باسم القطفة الثالثة" },
            ],
          },
          summaryAr: "❓ يرجى تحديد اسم القطفة الجديدة لإضافتها للمشروع.",
          summaryEn: "❓ Please specify the new harvest cycle name.",
        }, ctx);
      }

      const card: ConfirmationPreviewCard = {
        actionId: `ai-cyc-${Date.now()}`,
        toolName: "add_harvest_cycle",
        operationType: "ADD_HARVEST_CYCLE",
        titleAr: `إضافة دورة حصاد جديدة (${name})`,
        titleEn: `Add New Harvest Cycle (${name})`,
        narrationAr: `إضافة "${name}" إلى مشروع ${project.name}`,
        narrationEn: `Add harvest cycle "${name}" to ${project.name}`,
        date: todayIso,
        currency: "YER",
        projectId: project.id,
        totalDebit: 0,
        totalCredit: 0,
        isBalanced: true,
        lines: [],
        endpoint: "/api/projects/harvests",
        httpMethod: "POST",
        confirmButtonLabelAr: "تأكيد وإضافة القطفة",
        confirmButtonLabelEn: "Confirm & Add Harvest",
        confirmButtonLabel: "تأكيد وإضافة القطفة / Confirm & Add Harvest",
        executionPayload: {
          operationType: "ADD_HARVEST_CYCLE",
          projectId: project.id,
          name,
          executed_by_ai: true,
        },
      };
      return makeResult(lang, {
        ok: true,
        toolName,
        requiresConfirmation: true,
        confirmationCard: card,
        data: { preview: card },
        summaryAr: `🛡️ **بوابة التأكيد:** جاهز لإضافة القطفة الجديدة **(${name})** إلى مشروع **${project.name}**.`,
        summaryEn: `🛡️ **Confirmation Gate:** Ready to add harvest cycle **(${name})** to project **${project.name}**.`,
      });
    }
  }
}
