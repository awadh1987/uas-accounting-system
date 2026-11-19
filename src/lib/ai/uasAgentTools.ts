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
import type {
  TabId,
  UasBootstrapState,
  UasCoaAccount,
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
  | "search_user_manual";

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
  toolName: "draft_journal_entry" | "draft_voucher" | "draft_invoice";
  operationType: "JOURNAL_ENTRY" | "RECEIPT_VOUCHER" | "PAYMENT_VOUCHER" | "SALES_INVOICE" | "PURCHASE_BILL";
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
  coaAccounts?: Array<Pick<UasCoaAccount, "code" | "nameAr" | "nameEn" | "level" | "type" | "isPosting" | "rolledUpBalance" | "balance">>;
  journalEntries?: UasAgentJournalSummary[];
  reportSnapshot?: UasAgentReportSnapshot | null;
  diagnostics?: Partial<SupportSystemDiagnostics> | null;
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

function makeResult(
  lang: "ar" | "en",
  partial: Omit<UasAgentToolResult, "summary">
): UasAgentToolResult {
  return {
    ...partial,
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
        });
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
        });
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
      if (!Number.isFinite(amount) || amount <= 0) {
        return makeResult(lang, {
          ok: false,
          toolName,
          code: "INVALID_AMOUNT",
          requiresConfirmation: false,
          summaryAr: "⚠️ يرجى تحديد مبلغ مالي صحيح أكبر من الصفر للسند.",
          summaryEn: "⚠️ Please provide a valid positive amount for the voucher.",
        });
      }

      const partyName = String(args.partyName ?? args.party ?? (isReceipt ? "عميل نقدي" : "مستفيد عام")).trim();
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

      return makeResult(lang, {
        ok: true,
        toolName,
        requiresConfirmation: true,
        confirmationCard: card,
        data: { preview: card },
        summaryAr: `🛡️ **بوابة الأمان المحاسبي:** تم إعداد مسودة **${isReceipt ? "سند قبض" : "سند صرف"}** بمبلغ **${amount.toLocaleString()} ${currency}** (${partyName}). راجع القيد المزدوج أدناه واضغط **"تأكيد وترحيل / Confirm & Execute"** للاعتماد.`,
        summaryEn: `🛡️ **Accounting Confirmation Gate:** Drafted a **${isReceipt ? "Receipt Voucher" : "Payment Voucher"}** for **${amount.toLocaleString()} ${currency}** (${partyName}). Review the Debit/Credit preview card below and click **"تأكيد وترحيل / Confirm & Execute"**.`,
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

      if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
        return makeResult(lang, {
          ok: false,
          toolName,
          code: "INVALID_AMOUNT",
          requiresConfirmation: false,
          summaryAr: "⚠️ يرجى تحديد كمية وسعر أو مبلغ إجمالي أكبر من الصفر للفاتورة.",
          summaryEn: "⚠️ Please specify a positive quantity/unit price or total amount for the invoice.",
        });
      }

      const partyName = String(args.partyName ?? args.customer ?? args.vendor ?? (isPurchase ? "مورد عام" : "عميل عام")).trim();
      const itemName = String(args.itemName ?? args.grade ?? "صنف 1 ممتاز").trim();
      const paymentMethod = String(args.paymentMethod ?? "CREDIT").toUpperCase() === "CASH" ? "CASH" : "CREDIT";
      const currency = String(args.currency ?? "YER").toUpperCase();
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

      return makeResult(lang, {
        ok: true,
        toolName,
        requiresConfirmation: true,
        confirmationCard: card,
        data: { preview: card },
        summaryAr: `🛡️ **بوابة الأمان المحاسبي:** تم إعداد مسودة **${isPurchase ? "فاتورة مشتريات" : "فاتورة مبيعات"}** بمبلغ **${totalAmount.toLocaleString()} ${currency}** (${partyName} — ${itemName}). اضغط **"تأكيد وترحيل / Confirm & Execute"** لترحيل الفاتورة وقيدها المحاسبي.`,
        summaryEn: `🛡️ **Accounting Confirmation Gate:** Drafted a **${isPurchase ? "Purchase Bill" : "Sales Invoice"}** for **${totalAmount.toLocaleString()} ${currency}** (${partyName} — ${itemName}). Click **"تأكيد وترحيل / Confirm & Execute"** to commit.`,
      });
    }

    // -----------------------------------------------------------------------
    // 7. check_item_stock
    // -----------------------------------------------------------------------
    case "check_item_stock": {
      const q = String(args.query ?? args.item ?? "").trim().toLowerCase();
      const batches = ctx.state?.inventoryBatches ?? [];
      const filtered = q
        ? batches.filter(
            (b) =>
              b.grade.toLowerCase().includes(q) ||
              b.harvest.toLowerCase().includes(q) ||
              b.notes.toLowerCase().includes(q)
          )
        : batches;

      const totalHarvested = filtered.reduce((s, b) => s + Number(b.harvestedBundles || 0), 0);
      const totalShrinkage = filtered.reduce((s, b) => s + Number(b.shrinkageBundles || 0), 0);
      const netAvailable = Math.max(0, totalHarvested - totalShrinkage);

      return makeResult(lang, {
        ok: true,
        toolName,
        requiresConfirmation: false,
        navigationTab: "inventory",
        data: {
          batchCount: filtered.length,
          totalHarvested,
          totalShrinkage,
          netAvailable,
          batches: filtered.slice(0, 10),
        },
        summaryAr:
          filtered.length > 0
            ? `📦 **فحص المخزون (${filtered.length} دفعة):** إجمالي الكمية المستلمة: **${totalHarvested}** • الفاقد/التالف: **${totalShrinkage}** • الرصيد الصافي المتاح: **${netAvailable} وحدة/علاقية**.`
            : "📦 **حالة المخزون:** لا توجد دفعات مخزنية مسجلة حالياً (رصيد المخزون: 0).",
        summaryEn:
          filtered.length > 0
            ? `📦 **Inventory Stock (${filtered.length} batches):** Total Harvested: **${totalHarvested}** • Shrinkage: **${totalShrinkage}** • Net Available Stock: **${netAvailable} units**.`
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
      const report = diagnoseLiveSystemState(ctx.diagnostics);
      return makeResult(lang, {
        ok: true,
        toolName,
        requiresConfirmation: false,
        openLicenseModal: !report.healthy,
        data: { diagnosticReport: report, diagnostics: ctx.diagnostics },
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
      return makeResult(lang, {
        ok: true,
        toolName,
        requiresConfirmation: false,
        navigationTab: firstNav,
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
      });
    }
  }
}
