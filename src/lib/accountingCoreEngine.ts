/**
 * Accounting-Core Engine (Mission 2 / Phase 1)
 * --------------------------------------------------------------------------
 * 6-Generation Chart of Accounts + Cost Centers.
 *
 *  Gen 1 Class (100000) -> Gen 2 Group -> Gen 3 Sub-Group -> Gen 4 Control
 *  -> Gen 5 Sub-Control (summary once it has children) -> Gen 6 Postable leaf
 *  sub-ledger account (e.g. 112190001 = first Trade Customer).
 *
 * Every operational sub-ledger entity (Customer, Vendor, Worker, Warehouse,
 * Project, Treasury) is bound to its own Gen-6 leaf GL account AND a Cost Center.
 *
 * NOTE: Pure Prisma helpers only (no import of ledgerService) so ledgerService
 * can depend on this module without a cycle.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { dAdd, dMul, dSub, round4Decimal, toDecimalNumber } from "@/lib/decimalMath";

type Db = Prisma.TransactionClient | typeof prisma;

export type SubLedgerEntityType =
  | "CUSTOMER"
  | "VENDOR"
  | "WORKER"
  | "TREASURY"
  | "WAREHOUSE"
  | "PROJECT";

export const COST_CENTER_TYPES = ["BRANCH", "PROJECT", "FARM", "DEPARTMENT", "FLEET", "OTHER"] as const;
export type CostCenterType = (typeof COST_CENTER_TYPES)[number];

export const COST_CENTER_TYPE_LABELS: Record<CostCenterType, { ar: string; en: string }> = {
  BRANCH: { ar: "فرع", en: "Branch" },
  PROJECT: { ar: "مشروع", en: "Project" },
  FARM: { ar: "مزرعة", en: "Farm" },
  DEPARTMENT: { ar: "قسم / إدارة", en: "Department" },
  FLEET: { ar: "أسطول / آليات", en: "Fleet" },
  OTHER: { ar: "أخرى / مخصص", en: "Other / Custom" },
};

interface ControlSpec {
  accountType: "ASSET" | "LIABILITY";
  gen4Code: string;
  gen4Parent: string;
  gen4NameAr: string;
  gen4NameEn: string;
  gen5Code: string;
  gen5NameAr: string;
  gen5NameEn: string;
  namePrefixAr: string;
  namePrefixEn: string;
  ccPrefix: string;
  ccGroupNameAr: string;
  ccGroupNameEn: string;
  centerType: CostCenterType;
}

export const SUB_LEDGER_CONTROL_SPECS: Record<SubLedgerEntityType, ControlSpec> = {
  CUSTOMER: {
    accountType: "ASSET", gen4Code: "112100", gen4Parent: "112000",
    gen4NameAr: "مدينو المشاريع والعملاء", gen4NameEn: "Project Commercial Debtors",
    gen5Code: "112190", gen5NameAr: "العملاء التجاريون (حساب رقابي)", gen5NameEn: "Trade Customers (Control)",
    namePrefixAr: "", namePrefixEn: "", ccPrefix: "CUS", ccGroupNameAr: "مراكز تكلفة العملاء", ccGroupNameEn: "Customer Cost Centers", centerType: "OTHER",
  },
  VENDOR: {
    accountType: "LIABILITY", gen4Code: "211100", gen4Parent: "211000",
    gen4NameAr: "ذمم موردي المشتريات", gen4NameEn: "Procurement Vendors Payable",
    gen5Code: "211190", gen5NameAr: "الموردون التجاريون (حساب رقابي)", gen5NameEn: "Trade Suppliers (Control)",
    namePrefixAr: "", namePrefixEn: "", ccPrefix: "VND", ccGroupNameAr: "مراكز تكلفة الموردين", ccGroupNameEn: "Supplier Cost Centers", centerType: "OTHER",
  },
  WORKER: {
    accountType: "LIABILITY", gen4Code: "212100", gen4Parent: "212000",
    gen4NameAr: "مستحقات عمال الأجر اليومي والقطفات", gen4NameEn: "Harvest & Daily Labor Payables",
    gen5Code: "212190", gen5NameAr: "مستحقات العمال والموظفين (حساب رقابي)", gen5NameEn: "Workers Accrued Wages (Control)",
    namePrefixAr: "مستحقات العامل ", namePrefixEn: "Labor Payable - ", ccPrefix: "WRK", ccGroupNameAr: "مراكز تكلفة العمال", ccGroupNameEn: "Worker Cost Centers", centerType: "OTHER",
  },
  TREASURY: {
    accountType: "ASSET", gen4Code: "111100", gen4Parent: "111000",
    gen4NameAr: "الصناديق المركزية", gen4NameEn: "Main Vault & Treasuries",
    gen5Code: "111190", gen5NameAr: "الصناديق والبنوك التحليلية (حساب رقابي)", gen5NameEn: "Cashboxes & Banks (Control)",
    namePrefixAr: "", namePrefixEn: "", ccPrefix: "TRS", ccGroupNameAr: "مراكز تكلفة الخزينة", ccGroupNameEn: "Treasury Cost Centers", centerType: "OTHER",
  },
  WAREHOUSE: {
    accountType: "ASSET", gen4Code: "113300", gen4Parent: "113000",
    gen4NameAr: "مخزون المستودعات", gen4NameEn: "Warehouse Inventories",
    gen5Code: "113390", gen5NameAr: "المخازن (حساب رقابي)", gen5NameEn: "Warehouses (Control)",
    namePrefixAr: "مخزون ", namePrefixEn: "Inventory - ", ccPrefix: "WH", ccGroupNameAr: "مراكز تكلفة المخازن", ccGroupNameEn: "Warehouse Cost Centers", centerType: "DEPARTMENT",
  },
  PROJECT: {
    accountType: "ASSET", gen4Code: "121300", gen4Parent: "121000",
    gen4NameAr: "مشاريع قيد التنفيذ", gen4NameEn: "Projects In Progress",
    gen5Code: "121390", gen5NameAr: "المشاريع (حساب رقابي)", gen5NameEn: "Projects (Control)",
    namePrefixAr: "مشروع ", namePrefixEn: "Project - ", ccPrefix: "PRJ", ccGroupNameAr: "مراكز تكلفة المشاريع", ccGroupNameEn: "Project Cost Centers", centerType: "PROJECT",
  },
};

/** Derive the strict Gen/Postable mirror fields from the canonical level/isPosting pair. */
export function deriveGenFields(level: number, isPosting: boolean, parentId?: string | null) {
  const generation = Math.min(6, Math.max(1, level));
  return { generation, isPostable: Boolean(isPosting), parentAccountId: parentId ?? null };
}

export function isValidCostCenterType(v: string): v is CostCenterType {
  return (COST_CENTER_TYPES as readonly string[]).includes(v);
}

const ENTITY_MODEL: Record<SubLedgerEntityType, "customer" | "vendor" | "worker" | "warehouse" | "project" | null> = {
  CUSTOMER: "customer", VENDOR: "vendor", WORKER: "worker", WAREHOUSE: "warehouse", PROJECT: "project", TREASURY: null,
};

async function ensureAccountNode(
  tx: Db,
  node: { code: string; nameAr: string; nameEn: string; level: number; type: string; isPosting: boolean; parentCode: string | null }
) {
  const existing = await tx.account.findUnique({ where: { code: node.code } });
  if (existing) return existing;
  const parent = node.parentCode ? await tx.account.findUnique({ where: { code: node.parentCode } }) : null;
  if (node.parentCode && !parent) throw new Error(`PARENT_COA_MISSING:${node.parentCode}`);
  return tx.account.create({
    data: {
      code: node.code, nameAr: node.nameAr, nameEn: node.nameEn, level: node.level, type: node.type,
      isPosting: node.isPosting, parentCode: node.parentCode, parentId: parent?.id ?? null,
      ...deriveGenFields(node.level, node.isPosting, parent?.id),
      subLedgerType: "NONE",
    },
  });
}

/** Ensure Gen4 + Gen5 control chain for one sub-ledger type. Returns the Gen5 control account. */
export async function ensureControlChain(tx: Db, entityType: SubLedgerEntityType) {
  const s = SUB_LEDGER_CONTROL_SPECS[entityType];
  await ensureAccountNode(tx, {
    code: s.gen4Code, nameAr: s.gen4NameAr, nameEn: s.gen4NameEn, level: 4, type: s.accountType, isPosting: false, parentCode: s.gen4Parent,
  });
  const gen5 = await ensureAccountNode(tx, {
    code: s.gen5Code, nameAr: s.gen5NameAr, nameEn: s.gen5NameEn, level: 5, type: s.accountType, isPosting: false, parentCode: s.gen4Code,
  });
  if (entityType === "TREASURY") {
    await ensureAccountNode(tx, {
      code: "111200", nameAr: "البنوك والمحافظ الإلكترونية", nameEn: "Bank Accounts & Electronic Wallets", level: 4, type: "ASSET", isPosting: false, parentCode: "111000",
    });
    const bankGen5 = await ensureAccountNode(tx, {
      code: "111290", nameAr: "البنوك والمحافظ التحليلية (حساب رقابي)", nameEn: "Banks & Wallets (Control)", level: 5, type: "ASSET", isPosting: false, parentCode: "111200",
    });
    if (bankGen5.subLedgerType !== "TREASURY" || bankGen5.isPosting) {
      await tx.account.update({
        where: { id: bankGen5.id },
        data: { subLedgerType: "TREASURY", isPosting: false, isPostable: false },
      });
    }
  }
  if (gen5.subLedgerType !== entityType || gen5.isPosting) {
    return tx.account.update({
      where: { id: gen5.id },
      data: { subLedgerType: entityType, isPosting: false, isPostable: false },
    });
  }
  return gen5;
}

async function ensureCostCenterGroup(tx: Db, entityType: SubLedgerEntityType) {
  const s = SUB_LEDGER_CONTROL_SPECS[entityType];
  const code = `CC-${s.ccPrefix}`;
  const found = await tx.costCenter.findUnique({ where: { code } });
  if (found) return found;
  return tx.costCenter.create({
    data: { code, nameAr: s.ccGroupNameAr, nameEn: s.ccGroupNameEn, generation: 1, centerType: s.centerType },
  });
}

/**
 * Seeds / migrates the COA into the clean 6-generation structure.
 * Idempotent and NON-DESTRUCTIVE: no journal line, balance or account code is moved.
 *  - Mirrors level/isPosting/parentId into generation/isPostable/parentAccountId
 *  - Ensures Gen4/Gen5 control chains and root cost-center groups for all sub-ledger types
 *  - Tags existing customer/vendor/worker/treasury accounts with their sub-ledger link
 */
export async function ensure6GenerationCoaHierarchy(client?: Db) {
  const run = async (tx: Db) => {
    for (let lvl = 1; lvl <= 6; lvl++) {
      await tx.account.updateMany({ where: { level: lvl, NOT: { generation: lvl } }, data: { generation: lvl } });
    }
    await tx.account.updateMany({ where: { isPosting: true, isPostable: false }, data: { isPostable: true } });
    await tx.account.updateMany({ where: { isPosting: false, isPostable: true }, data: { isPostable: false } });
    const unlinked = await tx.account.findMany({
      where: { parentAccountId: null, NOT: { parentId: null } },
      select: { id: true, parentId: true },
    });
    for (const a of unlinked) {
      await tx.account.update({ where: { id: a.id }, data: { parentAccountId: a.parentId } });
    }

    const controls: Record<string, string> = {};
    for (const t of Object.keys(SUB_LEDGER_CONTROL_SPECS) as SubLedgerEntityType[]) {
      const c = await ensureControlChain(tx, t);
      controls[t] = c.code;
      await ensureCostCenterGroup(tx, t);
    }

    // Tag existing sub-ledger accounts (legacy Gen-5 customer/vendor/worker accounts stay in place)
    const customers = await tx.customer.findMany({ select: { id: true, accountId: true } });
    for (const c of customers) {
      await tx.account.updateMany({ where: { id: c.accountId, subLedgerType: null }, data: { subLedgerType: "CUSTOMER", subLedgerEntityId: c.id } });
      await tx.customer.updateMany({ where: { id: c.id, glAccountId: null }, data: { glAccountId: c.accountId } });
    }
    const vendors = await tx.vendor.findMany({ select: { id: true, accountId: true } });
    for (const v of vendors) {
      await tx.account.updateMany({ where: { id: v.accountId, subLedgerType: null }, data: { subLedgerType: "VENDOR", subLedgerEntityId: v.id } });
      await tx.vendor.updateMany({ where: { id: v.id, glAccountId: null }, data: { glAccountId: v.accountId } });
    }
    const workers = await tx.worker.findMany({ where: { NOT: { accountId: null } }, select: { id: true, accountId: true } });
    for (const w of workers) {
      await tx.account.updateMany({ where: { id: w.accountId!, subLedgerType: null }, data: { subLedgerType: "WORKER", subLedgerEntityId: w.id } });
      await tx.worker.updateMany({ where: { id: w.id, glAccountId: null }, data: { glAccountId: w.accountId } });
    }
    const treasuries = await tx.treasuryAccount.findMany({ select: { id: true, accountId: true } });
    for (const t of treasuries) {
      if (!t.accountId) continue;
      await tx.account.updateMany({ where: { id: t.accountId, subLedgerType: null }, data: { subLedgerType: "TREASURY", subLedgerEntityId: t.id } });
    }
    // Backfill Gen-6 leaf + cost center for warehouses/projects that predate Phase 1
    const whs = await tx.warehouse.findMany({ where: { OR: [{ glAccountId: null }, { costCenterId: null }] } });
    for (const w of whs) {
      await provisionEntityGen6AccountAndCostCenter(
        { entityType: "WAREHOUSE", entityId: w.id, nameAr: w.nameAr, nameEn: w.nameEn, costCenterId: w.costCenterId },
        tx
      );
    }
    const prjs = await tx.project.findMany({ where: { OR: [{ glAccountId: null }, { costCenterId: null }] } });
    for (const p of prjs) {
      await provisionEntityGen6AccountAndCostCenter(
        { entityType: "PROJECT", entityId: p.id, nameAr: p.nameAr || p.name, nameEn: p.nameEn || p.name, costCenterId: p.costCenterId },
        tx
      );
    }
    return { controls };
  };
  if (client && "$transaction" in client) return (client as typeof prisma).$transaction(run);
  return run(client ?? prisma);
}

async function nextLeafCode(tx: Db, controlCode: string, controlId: string): Promise<string> {
  const siblings = await tx.account.findMany({ where: { parentId: controlId }, select: { code: true } });
  let max = 0;
  for (const s of siblings) {
    const n = Number(s.code.slice(controlCode.length));
    if (Number.isFinite(n) && n > max) max = n;
  }
  let seq = max + 1;
  for (;;) {
    const code = `${controlCode}${String(seq).padStart(3, "0")}`;
    if (!(await tx.account.findUnique({ where: { code } }))) return code;
    seq++;
  }
}

async function nextCostCenterCode(tx: Db, prefix: string): Promise<string> {
  const count = await tx.costCenter.count({ where: { code: { startsWith: `CC-${prefix}-` } } });
  let seq = count + 1;
  for (;;) {
    const code = `CC-${prefix}-${String(seq).padStart(4, "0")}`;
    if (!(await tx.costCenter.findUnique({ where: { code } }))) return code;
    seq++;
  }
}

export interface ProvisionEntityInput {
  entityType: SubLedgerEntityType;
  entityId: string;
  nameAr: string;
  nameEn?: string;
  /** Optional Gen-5 control account code override (must be an existing summary account of Gen 5). */
  parentControlCode?: string;
  /** Re-use an existing cost center instead of creating one. */
  costCenterId?: string | null;
}

/**
 * Auto-provisions the dedicated Generation-6 postable leaf GL account + Cost Center for an entity
 * and links both back to the entity row when it already exists. Idempotent per (entityType, entityId).
 */
export async function provisionEntityGen6AccountAndCostCenter(input: ProvisionEntityInput, client?: Db) {
  const run = async (tx: Db) => {
    const spec = SUB_LEDGER_CONTROL_SPECS[input.entityType];
    if (!spec) throw new Error(`UNKNOWN_SUBLEDGER_TYPE:${input.entityType}`);

    const prior = await tx.account.findFirst({
      where: { subLedgerType: input.entityType, subLedgerEntityId: input.entityId, generation: 6 },
    });

    let control = await ensureControlChain(tx, input.entityType);
    if (input.parentControlCode && input.parentControlCode !== control.code) {
      let custom = await tx.account.findUnique({ where: { code: input.parentControlCode } });
      if (!custom) throw new Error(`PARENT_COA_MISSING:${input.parentControlCode}`);
      if (custom.level !== 5) throw new Error(`PARENT_CONTROL_MUST_BE_GEN5:${input.parentControlCode}`);
      if (custom.isPosting) {
        const used = await tx.journalEntryLine.count({ where: { accountId: custom.id } });
        if (used > 0) throw new Error(`PARENT_HAS_TRANSACTIONS:${custom.code}`);
        custom = await tx.account.update({ where: { id: custom.id }, data: { isPosting: false, isPostable: false } });
      }
      control = custom;
    }

    const nameAr = `${spec.namePrefixAr}${input.nameAr.trim()}`;
    const nameEn = `${spec.namePrefixEn}${(input.nameEn || input.nameAr).trim()}`;

    // Cost Center
    let costCenterId = input.costCenterId ?? prior?.defaultCostCenterId ?? null;
    if (!costCenterId) {
      const group = await ensureCostCenterGroup(tx, input.entityType);
      const cc = await tx.costCenter.create({
        data: {
          code: await nextCostCenterCode(tx, spec.ccPrefix),
          nameAr: input.nameAr.trim(),
          nameEn: (input.nameEn || input.nameAr).trim(),
          parentId: group.id,
          generation: 2,
          centerType: spec.centerType,
        },
      });
      costCenterId = cc.id;
    }

    // Gen-6 leaf
    let leaf = prior;
    if (!leaf) {
      leaf = await tx.account.create({
        data: {
          code: await nextLeafCode(tx, control.code, control.id),
          nameAr, nameEn, level: 6, type: control.type, isPosting: true,
          parentCode: control.code, parentId: control.id,
          generation: 6, isPostable: true, parentAccountId: control.id,
          subLedgerType: input.entityType, subLedgerEntityId: input.entityId,
          defaultCostCenterId: costCenterId,
        },
      });
    } else if (leaf.defaultCostCenterId !== costCenterId) {
      leaf = await tx.account.update({ where: { id: leaf.id }, data: { defaultCostCenterId: costCenterId } });
    }

    // Link back to the entity row if it exists
    const model = ENTITY_MODEL[input.entityType];
    if (model) {
      const data: Record<string, string> = { glAccountId: leaf.id, costCenterId };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (tx as any)[model].updateMany({ where: { id: input.entityId }, data });
    }
    return { account: leaf, costCenterId, controlCode: control.code };
  };
  if (client && "$transaction" in client) return (client as typeof prisma).$transaction(run);
  return run(client ?? prisma);
}

/**
 * Enforces that only postable leaf accounts accept direct journal lines.
 * Self-heals the mirror flags on legacy rows (isPosting=true but isPostable not yet synced).
 */
export async function assertPostableAccount(
  tx: Db,
  account: { id: string; code: string; nameAr: string; level: number; isPosting: boolean; isPostable: boolean }
) {
  if (!account.isPosting) {
    throw new Error(
      `NON_POSTING_ACCOUNT: Account ${account.code} (${account.nameAr}) is Tier-${account.level}. Only operational posting leaf accounts (isPostable = true) accept direct journal postings.`
    );
  }
  if (!account.isPostable) {
    await tx.account.update({
      where: { id: account.id },
      data: { isPostable: true, generation: Math.min(6, account.level) },
    });
  }
}

/** Resolve the effective cost center for a journal line. */
export function resolveLineCostCenter(opts: {
  line?: string | null;
  entry?: string | null;
  accountDefault?: string | null;
}): string | null {
  return opts.line || opts.entry || opts.accountDefault || null;
}

// ----------------------------------------------------------------------------
// Cost Center CRUD
// ----------------------------------------------------------------------------
export interface CostCenterInput {
  code?: string;
  nameAr: string;
  nameEn?: string;
  parentId?: string | null;
  centerType?: string;
  customLabel?: string | null;
  isActive?: boolean;
}

export async function listCostCenters(client: Db = prisma) {
  return client.costCenter.findMany({ orderBy: { code: "asc" } });
}

export async function createCostCenter(input: CostCenterInput, client: Db = prisma) {
  const nameAr = input.nameAr?.trim();
  if (!nameAr) throw new Error("COST_CENTER_NAME_REQUIRED: اسم مركز التكلفة مطلوب");
  const centerType = (input.centerType || "OTHER").toUpperCase();
  if (!isValidCostCenterType(centerType)) throw new Error(`INVALID_CENTER_TYPE:${input.centerType}`);
  let generation = 1;
  if (input.parentId) {
    const parent = await client.costCenter.findUnique({ where: { id: input.parentId } });
    if (!parent) throw new Error("PARENT_COST_CENTER_NOT_FOUND");
    if (parent.generation >= 6) throw new Error("COST_CENTER_MAX_GENERATION: الحد الأقصى 6 أجيال");
    generation = parent.generation + 1;
  }
  const code = input.code?.trim() || (await nextCostCenterCode(client, "GEN"));
  if (await client.costCenter.findUnique({ where: { code } })) throw new Error(`DUPLICATE_COST_CENTER_CODE:${code}`);
  return client.costCenter.create({
    data: {
      code, nameAr, nameEn: input.nameEn?.trim() || nameAr, parentId: input.parentId ?? null, generation,
      centerType, customLabel: input.customLabel?.trim() || null,
      isCustom: centerType === "OTHER", isActive: input.isActive ?? true,
    },
  });
}

export async function updateCostCenter(id: string, input: Partial<CostCenterInput>, client: Db = prisma) {
  const existing = await client.costCenter.findUnique({ where: { id } });
  if (!existing) throw new Error("COST_CENTER_NOT_FOUND");
  const data: Prisma.CostCenterUpdateInput = {};
  if (input.nameAr !== undefined) data.nameAr = input.nameAr.trim();
  if (input.nameEn !== undefined) data.nameEn = input.nameEn.trim();
  if (input.customLabel !== undefined) data.customLabel = input.customLabel?.trim() || null;
  if (input.isActive !== undefined) data.isActive = input.isActive;
  if (input.centerType !== undefined) {
    const t = input.centerType.toUpperCase();
    if (!isValidCostCenterType(t)) throw new Error(`INVALID_CENTER_TYPE:${input.centerType}`);
    data.centerType = t;
    data.isCustom = t === "OTHER";
  }
  return client.costCenter.update({ where: { id }, data });
}

export async function deleteCostCenter(id: string, client: Db = prisma) {
  const cc = await client.costCenter.findUnique({ where: { id } });
  if (!cc) throw new Error("COST_CENTER_NOT_FOUND");
  const [lines, children, accounts] = await Promise.all([
    client.journalEntryLine.count({ where: { costCenterId: id } }),
    client.costCenter.count({ where: { parentId: id } }),
    client.account.count({ where: { defaultCostCenterId: id } }),
  ]);
  if (lines > 0 || children > 0 || accounts > 0) {
    // Never destroy history: deactivate instead
    await client.costCenter.update({ where: { id }, data: { isActive: false } });
    return { deleted: false, deactivated: true };
  }
  await client.costCenter.delete({ where: { id } });
  return { deleted: true, deactivated: false };
}

// ----------------------------------------------------------------------------
// Cost Center P&L report
// ----------------------------------------------------------------------------
export async function costCenterProfitAndLoss(
  filters: {
    costCenterId?: string;
    fromDate?: string | Date;
    toDate?: string | Date;
    includeYearEndClosing?: boolean;
  } = {},
  client: Db = prisma
) {
  const dateFilter: Prisma.DateTimeFilter = {};
  if (filters.fromDate) dateFilter.gte = new Date(filters.fromDate);
  if (filters.toDate) {
    const end = new Date(filters.toDate);
    if (typeof filters.toDate === "string" && filters.toDate.length <= 10) {
      end.setUTCHours(23, 59, 59, 999);
    }
    dateFilter.lte = end;
  }

  const where: Prisma.JournalEntryLineWhereInput = {
    journalEntry: {
      status: "POSTED",
      documentStatus: "POSTED",
      ...(filters.includeYearEndClosing ? {} : { entryType: { not: "YEAR_END_CLOSING" } }),
      ...(filters.fromDate || filters.toDate ? { date: dateFilter } : {}),
    },
    account: { type: { in: ["REVENUE", "EXPENSE"] } },
    ...(filters.costCenterId ? { costCenterId: filters.costCenterId } : {}),
  };
  const lines = await client.journalEntryLine.findMany({ where, include: { account: true } });
  const centers = await client.costCenter.findMany();
  const byId = new Map(centers.map((c) => [c.id, c]));
  const rows = new Map<string, { costCenterId: string | null; code: string; nameAr: string; nameEn: string; revenue: number; expense: number; net: number }>();
  for (const l of lines) {
    const key = l.costCenterId ?? "__none__";
    const cc = l.costCenterId ? byId.get(l.costCenterId) : null;
    const row = rows.get(key) ?? {
      costCenterId: l.costCenterId, code: cc?.code ?? "—", nameAr: cc?.nameAr ?? "بدون مركز تكلفة", nameEn: cc?.nameEn ?? "Unassigned", revenue: 0, expense: 0, net: 0,
    };
    const rate = toDecimalNumber(l.exchangeRate, 1) || 1;
    const baseDr = toDecimalNumber(l.baseDebit) || toDecimalNumber(l.debitBase) || dMul(l.debit, rate, 4);
    const baseCr = toDecimalNumber(l.baseCredit) || toDecimalNumber(l.creditBase) || dMul(l.credit, rate, 4);
    if (l.account.type === "REVENUE") row.revenue = dAdd(row.revenue, dSub(baseCr, baseDr, 4), 4);
    else row.expense = dAdd(row.expense, dSub(baseDr, baseCr, 4), 4);
    rows.set(key, row);
  }
  const out = [...rows.values()].map((r) => ({
    ...r,
    revenue: round4Decimal(r.revenue),
    expense: round4Decimal(r.expense),
    net: dSub(r.revenue, r.expense, 4),
  }));
  return {
    rows: out,
    totals: out.reduce(
      (t, r) => ({
        revenue: dAdd(t.revenue, r.revenue, 4),
        expense: dAdd(t.expense, r.expense, 4),
        net: dAdd(t.net, r.net, 4),
      }),
      { revenue: 0, expense: 0, net: 0 }
    ),
  };
}
