import crypto from "node:crypto";
import { PrismaClient } from "@prisma/client";
import {
  STANDARD_COA_NODES,
  mapExpenseCategoryToCoaCode,
} from "../src/lib/accounting/coaCatalog";
import {
  computeOperatingExpenseTotal,
  computeQrVerificationCode,
  computeSaleTotals,
  computeWorkerWageTotals,
} from "../src/lib/formulas";

const prisma = new PrismaClient();

function hashPassword(password: string): string {
  return crypto.createHash("sha256").update(password).digest("hex");
}

function sha256Audit(payload: string): string {
  return (
    "SHA256-" +
    crypto
      .createHash("sha256")
      .update(payload)
      .digest("hex")
      .slice(0, 12)
      .toUpperCase()
  );
}

async function main() {
  console.log("Seeding Unified Accounting System (UAS) Enterprise Database...");

  // 1. Clear in strict dependency-safe order for idempotent seeding
  await prisma.$transaction([
    prisma.attachment.deleteMany(),
    prisma.journalEntryLine.deleteMany(),
    prisma.journalEntry.deleteMany(),
    prisma.auditLog.deleteMany(),
    prisma.adjustmentEntry.deleteMany(),
    prisma.immutableAuditLog.deleteMany(),
    prisma.installmentVoucher.deleteMany(),
    prisma.paymentVoucher.deleteMany(),
    prisma.vendorBill.deleteMany(),
    prisma.goodsReceipt.deleteMany(),
    prisma.purchaseOrderItem.deleteMany(),
    prisma.purchaseOrder.deleteMany(),
    prisma.vendor.deleteMany(),
    prisma.receiptVoucher.deleteMany(),
    prisma.salesInvoice.deleteMany(),
    prisma.inventoryLot.deleteMany(),
    prisma.harvestInventoryBatch.deleteMany(),
    prisma.saleTransaction.deleteMany(),
    prisma.customer.deleteMany(),
    prisma.workerWageEntry.deleteMany(),
    prisma.worker.deleteMany(),
    prisma.operatingExpense.deleteMany(),
    prisma.subProject.deleteMany(),
    prisma.harvestCycle.deleteMany(),
    prisma.projectAcquisitionCycle.deleteMany(),
    prisma.project.deleteMany(),
    prisma.treasuryAccount.deleteMany(),
    prisma.account.deleteMany(),
    prisma.currencyRate.deleteMany(),
    prisma.user.deleteMany(),
    prisma.systemSettings.deleteMany(),
    prisma.enterpriseProfile.deleteMany(),
  ]);

  // 2. Enterprise Profile & System Settings
  await prisma.enterpriseProfile.create({
    data: {
      id: "default",
      legalNameAr: "شركة الجبري الزراعية للتنمية والاستثمار",
      legalNameEn: "Al-Jabri Agricultural Development & Investment Co.",
      taxNumber: "30049811200003",
      commercialReg: "CR-YE-2026-8841",
      currencyCode: "YER",
      address: "الجمهورية اليمنية - صنعاء / مزارع الجبري الإنتاجية",
      phone: "783118231",
      email: "finance@aljabri-agri.com",
      logoUrl: "/icons/icon.svg",
      brandColor: "#059669",
    },
  });

  await prisma.systemSettings.create({
    data: {
      id: "default",
      orgName: "شركة الجبري الزراعية للتنمية والاستثمار | UAS",
      logoText: "UAS",
      defaultLang: "ar",
      defaultTheme: "emerald",
      defaultCurrency: "YER",
    },
  });

  // 3. Currency Rates (Base = YER)
  await prisma.currencyRate.createMany({
    data: [
      { currencyCode: "YER", rateToYER: 1 },
      { currencyCode: "SAR", rateToYER: 425 },
      { currencyCode: "USD", rateToYER: 1620 },
    ],
  });

  // 4. Users — 7 Enterprise RBAC Roles (Default password: "123456")
  const defaultPassHash = hashPassword("123456");
  await prisma.user.createMany({
    data: [
      {
        id: "u1",
        username: "system_owner",
        name: "مدير النظام العام",
        fullName: "مدير النظام العام / System Owner",
        email: "admin@uas-ye.com",
        passwordHash: defaultPassHash,
        role: "SUPER_ADMIN",
        department: "الإدارة العليا وتقنية المعلومات",
        active: true,
        avatarChar: "م",
        assignedProjects: JSON.stringify(["p1", "p2", "p3"]),
      },
      {
        id: "u2",
        username: "project_manager",
        name: "مدير المشاريع",
        fullName: "مدير المشاريع / Project Manager",
        email: "pm@uas-ye.com",
        passwordHash: defaultPassHash,
        role: "PROJECT_MANAGER",
        department: "إدارة المشاريع والعمليات الزراعية",
        active: true,
        avatarChar: "ش",
        assignedProjects: JSON.stringify(["p1", "p2", "p3"]),
      },
      {
        id: "u3",
        username: "chief_accountant",
        name: "رئيس الحسابات",
        fullName: "رئيس الحسابات / Chief Accountant",
        email: "accountant@uas-ye.com",
        passwordHash: defaultPassHash,
        role: "CHIEF_ACCOUNTANT",
        department: "الإدارة المالية والحسابات",
        active: true,
        avatarChar: "ح",
        assignedProjects: JSON.stringify(["p1", "p2", "p3"]),
      },
      {
        id: "u4",
        username: "procurement_officer",
        name: "مسؤول المشتريات والمخازن",
        fullName: "مسؤول المشتريات والمخازن / Procurement Officer",
        email: "procurement@uas-ye.com",
        passwordHash: defaultPassHash,
        role: "PROCUREMENT_OFFICER",
        department: "المشتريات وسلسلة الإمداد",
        active: true,
        avatarChar: "ت",
        assignedProjects: JSON.stringify(["p1", "p2"]),
      },
      {
        id: "u5",
        username: "sales_collector",
        name: "مسؤول المبيعات والتحصيل",
        fullName: "مسؤول المبيعات والتحصيل / Sales Collector",
        email: "sales@uas-ye.com",
        passwordHash: defaultPassHash,
        role: "SALES_COLLECTOR",
        department: "المبيعات وعلاقات العملاء",
        active: true,
        avatarChar: "ب",
        assignedProjects: JSON.stringify(["p1", "p2", "p3"]),
      },
      {
        id: "u6",
        username: "field_accountant",
        name: "محاسب ميداني",
        fullName: "محاسب ميداني / Field Accountant",
        email: "field@uas-ye.com",
        passwordHash: defaultPassHash,
        role: "FIELD_ACCOUNTANT",
        department: "العمليات الميدانية بالمزارع",
        active: true,
        avatarChar: "ع",
        assignedProjects: JSON.stringify(["p1"]),
      },
      {
        id: "u7",
        username: "financial_auditor",
        name: "مدقق مالي",
        fullName: "مدقق مالي / Financial Auditor",
        email: "auditor@uas-ye.com",
        passwordHash: defaultPassHash,
        role: "EXTERNAL_AUDITOR",
        department: "التدقيق والرقابة الخارجية",
        active: true,
        avatarChar: "د",
        assignedProjects: JSON.stringify(["p1", "p2", "p3"]),
      },
    ],
  });

  // 5. Complete 6-Generation Chart of Accounts (Assets 100000 -> Expenses 500000)
  const accountIdByCode = new Map<string, string>();
  for (const level of [1, 2, 3, 4, 5, 6] as const) {
    const nodes = STANDARD_COA_NODES.filter((n) => n.level === level);
    for (const node of nodes) {
      const parentId = node.parentCode
        ? (accountIdByCode.get(node.parentCode) ?? null)
        : null;
      const created = await prisma.account.create({
        data: {
          code: node.code,
          nameAr: node.nameAr,
          nameEn: node.nameEn,
          level: node.level,
          type: node.type,
          isPosting: node.isPosting,
          parentId,
        },
      });
      accountIdByCode.set(node.code, created.id);
    }
  }
  const accId = (code: string) => {
    const id = accountIdByCode.get(code);
    if (!id) throw new Error(`Missing seeded COA code: ${code}`);
    return id;
  };

  // 6. Treasuries linked to Tier-5 1111xx / 1112xx COA Accounts
  await prisma.treasuryAccount.createMany({
    data: [
      {
        id: "t1",
        code: "TR-VAULT-YER",
        name: "الصندوق الرئيسي - يمني (Central Safe - YER)",
        nameAr: "الصندوق الرئيسي - يمني",
        nameEn: "Central Safe - YER",
        type: "VAULT",
        providerNameAr: "الخزينة النقدية الرئيسية",
        providerNameEn: "Main Cash Vault",
        accountHolderName: "الإدارة المالية",
        accountNumber: "CASH-01",
        branchOrAgent: "المركز الرئيسي - صنعاء",
        transferFeePercent: 0,
        dailyLimit: 0,
        isDefaultReceipts: true,
        isDefaultPayments: false,
        isActive: true,
        accountId: accId("111101"),
        currency: "YER",
        currencyCode: "YER",
        balance: 120000,
        balanceYER: 120000,
      },
      {
        id: "t2",
        code: "TR-BANK-KUR",
        name: "بنك الكريمي الإسلامي (Kuraimi Bank)",
        nameAr: "بنك الكريمي الإسلامي",
        nameEn: "Kuraimi Islamic Bank",
        type: "BANK",
        providerNameAr: "بنك الكريمي للتمويل الأصغر الإسلامي",
        providerNameEn: "Al-Kuraimi Islamic Microfinance Bank",
        accountHolderName: "شركة الجبري الزراعية للتنمية والاستثمار",
        accountNumber: "KUR-88412",
        ibanOrSwift: "YE-KUR-88412-001",
        branchOrAgent: "الفرع الرئيسي - الستين",
        transferFeePercent: 0.25,
        dailyLimit: 5000000,
        isDefaultReceipts: false,
        isDefaultPayments: true,
        isActive: true,
        accountId: accId("111201"),
        currency: "YER",
        currencyCode: "YER",
        balance: 350000,
        balanceYER: 350000,
      },
      {
        id: "t3",
        code: "TR-WAL-JWL",
        name: "محفظة فلوسك / جوالي (Jawali Wallet)",
        nameAr: "محفظة فلوسك / جوالي",
        nameEn: "Floosak / Jawali Wallet",
        type: "WALLET",
        providerNameAr: "محفظة جوالي الإلكترونية",
        providerNameEn: "Jawali E-Wallet",
        accountHolderName: "التحصيل الإلكتروني",
        accountNumber: "JWL-78311",
        branchOrAgent: "شبكة وكلاء جوالي",
        transferFeePercent: 0.5,
        dailyLimit: 1000000,
        isDefaultReceipts: false,
        isDefaultPayments: false,
        isActive: true,
        accountId: accId("111203"),
        currency: "YER",
        currencyCode: "YER",
        balance: 95000,
        balanceYER: 95000,
      },
      {
        id: "t4",
        code: "TR-WAL-JEB",
        name: "محفظة جيب (Jeeb Wallet)",
        nameAr: "محفظة جيب",
        nameEn: "Jeeb Wallet",
        type: "WALLET",
        providerNameAr: "محفظة جيب",
        providerNameEn: "Jeeb Wallet",
        accountHolderName: "المشتريات الميدانية",
        accountNumber: "JEB-78311",
        branchOrAgent: "وكيل جيب المعتمد",
        transferFeePercent: 0.5,
        dailyLimit: 1000000,
        isDefaultReceipts: false,
        isDefaultPayments: false,
        isActive: true,
        accountId: accId("111204"),
        currency: "YER",
        currencyCode: "YER",
        balance: 60000,
        balanceYER: 60000,
      },
      {
        id: "t5",
        code: "TR-VAULT-SAR",
        name: "صندوق الريال السعودي (Central Safe - SAR)",
        nameAr: "صندوق الريال السعودي",
        nameEn: "Central Safe - SAR",
        type: "VAULT",
        providerNameAr: "خزينة النقد الأجنبي - ريال سعودي",
        providerNameEn: "SAR Central Safe",
        accountHolderName: "الإدارة المالية",
        accountNumber: "CASH-SAR-01",
        branchOrAgent: "المركز الرئيسي",
        transferFeePercent: 0,
        dailyLimit: 0,
        isDefaultReceipts: false,
        isDefaultPayments: false,
        isActive: true,
        accountId: accId("111102"),
        currency: "SAR",
        currencyCode: "SAR",
        balance: 500,
        balanceYER: 212500,
      },
      {
        id: "t6",
        code: "TR-VAULT-USD",
        name: "صندوق الدولار (Central Safe - USD)",
        nameAr: "صندوق الدولار",
        nameEn: "Central Safe - USD",
        type: "VAULT",
        providerNameAr: "خزينة النقد الأجنبي - دولار أمريكي",
        providerNameEn: "USD Central Safe",
        accountHolderName: "الإدارة المالية",
        accountNumber: "CASH-USD-01",
        branchOrAgent: "المركز الرئيسي",
        transferFeePercent: 0,
        dailyLimit: 0,
        isDefaultReceipts: false,
        isDefaultPayments: false,
        isActive: true,
        accountId: accId("111103"),
        currency: "USD",
        currencyCode: "USD",
        balance: 250,
        balanceYER: 405000,
      },
      {
        id: "t7",
        code: "TR-BANK-QTB",
        name: "بنك القطيبي الإسلامي (Al-Qutaibi Bank)",
        nameAr: "بنك القطيبي الإسلامي",
        nameEn: "Al-Qutaibi Bank",
        type: "BANK",
        providerNameAr: "بنك القطيبي الإسلامي",
        providerNameEn: "Al-Qutaibi Islamic Bank",
        accountHolderName: "شركة الجبري الزراعية للتنمية والاستثمار",
        accountNumber: "QTB-55109",
        ibanOrSwift: "YE-QTB-55109-001",
        branchOrAgent: "فرع حدة",
        transferFeePercent: 0.25,
        dailyLimit: 5000000,
        isDefaultReceipts: false,
        isDefaultPayments: false,
        isActive: true,
        accountId: accId("111202"),
        currency: "YER",
        currencyCode: "YER",
        balance: 180000,
        balanceYER: 180000,
      },
    ],
  });

  // 7. Projects, Sub-Projects & Harvest Cycles
  await prisma.project.create({
    data: {
      id: "p1",
      code: "PRJ-001",
      name: "الجبري العليا",
      nameAr: "الجبري العليا",
      nameEn: "Upper Al-Jabri",
      type: "مشروع رئيسي",
      parentProjectId: null,
      budgetTotal: 1000000,
      estimatedValue: 1000000,
      plannedHarvestCount: 3,
      status: "ACTIVE",
      startDate: new Date("2026-10-01T00:00:00Z"),
      notes: "مشروع مزارع الجبري العليا الرئيسي",
    },
  });

  await prisma.project.create({
    data: {
      id: "p2",
      code: "PRJ-002",
      name: "الجبري الوسطى",
      nameAr: "الجبري الوسطى",
      nameEn: "Middle Al-Jabri",
      type: "مشروع رئيسي",
      parentProjectId: null,
      budgetTotal: 750000,
      estimatedValue: 750000,
      plannedHarvestCount: 2,
      status: "ACTIVE",
      startDate: new Date("2026-10-01T00:00:00Z"),
      notes: "مشروع مزارع الجبري الوسطى الرئيسي",
    },
  });

  await prisma.project.create({
    data: {
      id: "p3",
      code: "PRJ-003",
      name: "الجبري السفلى",
      nameAr: "الجبري السفلى",
      nameEn: "Lower Al-Jabri",
      type: "مشروع رئيسي",
      parentProjectId: null,
      budgetTotal: 500000,
      estimatedValue: 500000,
      plannedHarvestCount: 2,
      status: "ACTIVE",
      startDate: new Date("2026-10-15T00:00:00Z"),
      notes: "مشروع مزارع الجبري السفلى الرئيسي",
    },
  });

  await prisma.subProject.createMany({
    data: [
      {
        id: "sp1",
        projectId: "p1",
        code: "SUB-01",
        nameAr: "قطاع A - المدرجات",
        nameEn: "Sector A - Terraces",
        budget: 450000,
        status: "ACTIVE",
        notes: "قطاع زراعي وإنتاجي رئيسي للمدرجات الجبلية",
      },
      {
        id: "sp2",
        projectId: "p1",
        code: "SUB-02",
        nameAr: "قطاع B - الوادي",
        nameEn: "Sector B - Valley",
        budget: 350000,
        status: "ACTIVE",
        notes: "القطاع المنبسط بوادي الجبري",
      },
      {
        id: "sp3",
        projectId: "p1",
        code: "SUB-03",
        nameAr: "الآبار ومنظومات الضخ",
        nameEn: "Wells & Solar Pumping",
        budget: 200000,
        status: "ACTIVE",
        notes: "منظومة الطاقة الشمسية وضخ المياه",
      },
      {
        id: "sp4",
        projectId: "p2",
        code: "SUB-01",
        nameAr: "قطاع الوسطى الشرقي",
        nameEn: "Middle East Sector",
        budget: 450000,
        status: "ACTIVE",
        notes: "المدرجات الشرقية لمزارع الوسطى",
      },
      {
        id: "sp5",
        projectId: "p2",
        code: "SUB-02",
        nameAr: "شبكة الري والتخزين",
        nameEn: "Irrigation & Storage",
        budget: 300000,
        status: "ACTIVE",
        notes: "خزانات وشبكات التقطير",
      },
      {
        id: "sp6",
        projectId: "p3",
        code: "SUB-01",
        nameAr: "قطاع السفلى الرئيسي",
        nameEn: "Lower Main Sector",
        budget: 500000,
        status: "ACTIVE",
        notes: "المزارع الرئيسية للمنطقة السفلى",
      },
    ],
  });

  await prisma.harvestCycle.createMany({
    data: [
      {
        id: "hc_p1_1",
        projectId: "p1",
        cycleNumber: 1,
        name: "القطفة الأولى",
        sortOrder: 1,
        isLocked: false,
      },
      {
        id: "hc_p1_2",
        projectId: "p1",
        cycleNumber: 2,
        name: "القطفة الثانية",
        sortOrder: 2,
        isLocked: false,
      },
      {
        id: "hc_p1_3",
        projectId: "p1",
        cycleNumber: 3,
        name: "القطفة الثالثة",
        sortOrder: 3,
        isLocked: false,
      },
      {
        id: "hc_p2_1",
        projectId: "p2",
        cycleNumber: 1,
        name: "القطفة الأولى",
        sortOrder: 1,
        isLocked: false,
      },
      {
        id: "hc_p2_2",
        projectId: "p2",
        cycleNumber: 2,
        name: "القطفة الثانية",
        sortOrder: 2,
        isLocked: false,
      },
      {
        id: "hc_p3_1",
        projectId: "p3",
        cycleNumber: 1,
        name: "القطفة الأولى",
        sortOrder: 1,
        isLocked: false,
      },
      {
        id: "hc_p3_2",
        projectId: "p3",
        cycleNumber: 2,
        name: "القطفة الثانية",
        sortOrder: 2,
        isLocked: false,
      },
    ],
  });

  // 8. Vendors linked to Tier-5 2111xx Accounts
  await prisma.vendor.createMany({
    data: [
      {
        id: "v1",
        code: "VND-001",
        nameAr: "شركة التوريدات الزراعية",
        nameEn: "General Agricultural Supplies Co.",
        phone: "777100200",
        email: "sales@agrisupplies-ye.com",
        taxRegistration: "TAX-VND-101",
        address: "صنعاء - شارع تعز",
        accountId: accId("211101"),
      },
      {
        id: "v2",
        code: "VND-002",
        nameAr: "محطة الوقود المركزية",
        nameEn: "Central Fuel & Energy Station",
        phone: "777300400",
        email: "billing@centralfuel-ye.com",
        taxRegistration: "TAX-VND-102",
        address: "خط مأرب - المحطة المركزية",
        accountId: accId("211102"),
      },
      {
        id: "v3",
        code: "VND-003",
        nameAr: "مورد قطع الغيار والصيانة",
        nameEn: "Equipment Spare Parts Vendor",
        phone: "777500600",
        email: "parts@spares-ye.com",
        taxRegistration: "TAX-VND-103",
        address: "صنعاء - المنطقة الصناعية",
        accountId: accId("211103"),
      },
    ],
  });

  // Link sample Project owner vendor & seed Project Acquisition Cycle (non-GL contract schedule)
  await prisma.project.update({
    where: { id: "p1" },
    data: { vendorId: "v1" },
  });

  await prisma.projectAcquisitionCycle.create({
    data: {
      id: "acq_p1_1",
      projectId: "p1",
      cycleTitle: "عقد تأسيس وتشغيل الموسم الأول 2026",
      startDate: new Date("2026-10-01T00:00:00Z"),
      endDate: new Date("2027-03-31T23:59:59Z"),
      contractAmount: 1000000,
      currency: "YER",
      status: "ACTIVE",
      notes: "دفعات مجدولة لصاحب المشروع مقابل عقد الاستحواذ والتطوير",
    },
  });

  // 9. Customers linked to Tier-5 1121xx Accounts
  await prisma.customer.createMany({
    data: [
      {
        id: "cust1",
        code: "CUST-001",
        name: "فواز الجابري",
        nameAr: "فواز الجابري",
        nameEn: "Fawaz Al-Jabri",
        phone: "783118231",
        address: "صنعاء - سوق الجملة",
        creditLimit: 500000,
        accountId: accId("112101"),
      },
      {
        id: "cust2",
        code: "CUST-002",
        name: "يوسف الجابري",
        nameAr: "يوسف الجابري",
        nameEn: "Youssef Al-Jabri",
        phone: "783118231",
        address: "ذمار - المركز التجاري",
        creditLimit: 300000,
        accountId: accId("112102"),
      },
    ],
  });

  // 10. Workers linked to Tier-5 2121xx Accounts
  await prisma.worker.createMany({
    data: [
      {
        id: "wrk1",
        name: "بلال",
        phone: "783118231",
        defaultDailyWage: 5000,
        accountId: accId("212101"),
      },
      {
        id: "wrk2",
        name: "معاذ",
        phone: "783118231",
        defaultDailyWage: 4000,
        accountId: accId("212102"),
      },
      {
        id: "wrk3",
        name: "فواز",
        phone: "783118231",
        defaultDailyWage: 3000,
        accountId: accId("212103"),
      },
    ],
  });

  // Helper for atomic Journal Entry creation in seed
  let jvSeq = 1;
  async function seedJournal(params: {
    date: string;
    reference: string;
    narrationAr: string;
    narrationEn: string;
    sourceType: string;
    sourceId?: string;
    projectId?: string | null;
    subProjectId?: string | null;
    createdById?: string;
    lines: Array<{
      accountCode: string;
      debit?: number;
      credit?: number;
      currency?: string;
      exchangeRate?: number;
      memo?: string;
      projectId?: string | null;
      subProjectId?: string | null;
      harvestCycleId?: string | null;
    }>;
  }) {
    const entryNumber = `JV-2026-${String(jvSeq++).padStart(4, "0")}`;
    let totalDrBase = 0;
    let totalCrBase = 0;
    const preparedLines = params.lines.map((l) => {
      const rate = l.exchangeRate ?? 1;
      const dr = l.debit ?? 0;
      const cr = l.credit ?? 0;
      const debitBase = Number((dr * rate).toFixed(4));
      const creditBase = Number((cr * rate).toFixed(4));
      totalDrBase += debitBase;
      totalCrBase += creditBase;
      return {
        accountId: accId(l.accountCode),
        debit: dr,
        credit: cr,
        currency: l.currency ?? "YER",
        exchangeRate: rate,
        debitBase,
        creditBase,
        memo: l.memo ?? params.narrationAr,
        projectId:
          l.projectId !== undefined ? l.projectId : (params.projectId ?? null),
        subProjectId: l.subProjectId ?? null,
        harvestCycleId: l.harvestCycleId ?? null,
      };
    });

    if (Math.abs(totalDrBase - totalCrBase) > 0.0001) {
      throw new Error(
        `Seed JournalEntry ${entryNumber} is unbalanced: DR=${totalDrBase}, CR=${totalCrBase}`,
      );
    }

    return prisma.journalEntry.create({
      data: {
        entryNumber,
        date: new Date(`${params.date}T10:00:00Z`),
        reference: params.reference,
        narrationAr: params.narrationAr,
        narrationEn: params.narrationEn,
        status: "POSTED",
        sourceType: params.sourceType,
        sourceId: params.sourceId ?? null,
        projectId: params.projectId ?? null,
        subProjectId: params.subProjectId ?? null,
        createdById: params.createdById ?? "u1",
        lines: { create: preparedLines },
      },
    });
  }

  // 11. Opening Balances Journal Entry (JV-2026-0001)
  // Opening cash/bank balances reconcile precisely with final treasury balances after seed transactions
  await seedJournal({
    date: "2026-10-31",
    reference: "OPENING-2026",
    narrationAr: "قيد الأرصدة الافتتاحية للأصول والبنوك ورأس المال",
    narrationEn:
      "Opening Balances for Cash, Banks, Agricultural Estates & Paid-In Capital",
    sourceType: "OPENING",
    sourceId: "OPEN-2026",
    lines: [
      {
        accountCode: "111101",
        debit: 135000,
        memo: "رصيد افتتاحي - الصندوق الرئيسي يمني",
      },
      {
        accountCode: "111201",
        debit: 400000,
        memo: "رصيد افتتاحي - بنك الكريمي",
      },
      {
        accountCode: "111203",
        debit: 75000,
        memo: "رصيد افتتاحي - محفظة جوالي",
      },
      { accountCode: "111204", debit: 60000, memo: "رصيد افتتاحي - محفظة جيب" },
      {
        accountCode: "111102",
        debit: 500,
        currency: "SAR",
        exchangeRate: 425,
        memo: "رصيد افتتاحي - 500 ريال سعودي",
      },
      {
        accountCode: "111103",
        debit: 250,
        currency: "USD",
        exchangeRate: 1620,
        memo: "رصيد افتتاحي - 250 دولار أمريكي",
      },
      {
        accountCode: "111202",
        debit: 180000,
        memo: "رصيد افتتاحي - بنك القطيبي",
      },
      {
        accountCode: "121101",
        debit: 1000000,
        projectId: "p1",
        memo: "أراضي ومزارع مشاريع الجبري",
      },
      {
        accountCode: "121201",
        debit: 500000,
        projectId: "p1",
        memo: "آبار ومنظومات الضخ بالطاقة الشمسية",
      },
      {
        accountCode: "311101",
        credit: 2967500,
        memo: "رأس المال المدفوع الافتتاحي",
      },
    ],
  });

  // 12. End-to-End Procurement Workflow Seed (PO -> GRN -> Vendor Bill -> Payment Voucher)
  await prisma.purchaseOrder.create({
    data: {
      id: "po1",
      poNumber: "PO-2026-0001",
      vendorId: "v1",
      projectId: "p1",
      subProjectId: "sp1",
      date: new Date("2026-11-01T08:00:00Z"),
      status: "APPROVED",
      subTotal: 120000,
      taxTotal: 0,
      grandTotal: 120000,
      currency: "YER",
      notes: "توريد أسمدة ومبيدات وأكياس تعبئة لمشروع الجبري العليا",
      items: {
        create: [
          {
            description: "أسمدة عضوية ومغذيات (كيس 50 كجم)",
            unit: "كيس",
            quantity: 10,
            unitPrice: 9000,
            totalPrice: 90000,
          },
          {
            description: "أدوات تعبئة وصناديق حفظ المحصول",
            unit: "ربطة",
            quantity: 10,
            unitPrice: 3000,
            totalPrice: 30000,
          },
        ],
      },
    },
  });

  await prisma.goodsReceipt.create({
    data: {
      id: "grn1",
      grnNumber: "GRN-2026-0001",
      purchaseOrderId: "po1",
      receivedDate: new Date("2026-11-01T14:00:00Z"),
      receivedTotal: 120000,
      hasVariance: false,
      itemsSummary: JSON.stringify([
        {
          description: "أسمدة عضوية ومغذيات (كيس 50 كجم)",
          ordered: 10,
          received: 10,
        },
        {
          description: "أدوات تعبئة وصناديق حفظ المحصول",
          ordered: 10,
          received: 10,
        },
      ]),
      warehouseNotes: "مطابق 100% لأمر الشراء PO-2026-0001 بدون عجز",
    },
  });

  const bill1Je = await seedJournal({
    date: "2026-11-01",
    reference: "BILL-2026-0001",
    narrationAr:
      "إثبات فاتورة مشتريات مخزنية رقم BILL-2026-0001 - شركة التوريدات الزراعية",
    narrationEn:
      "Vendor Bill BILL-2026-0001 Inventory Intake - General Agricultural Supplies Co.",
    sourceType: "VENDOR_BILL",
    sourceId: "bill1",
    projectId: "p1",
    createdById: "u4",
    lines: [
      {
        accountCode: "113201",
        debit: 120000,
        projectId: "p1",
        subProjectId: "sp1",
        memo: "مخزون أسمدة ومستلزمات زراعية",
      },
      {
        accountCode: "211101",
        credit: 120000,
        projectId: "p1",
        subProjectId: "sp1",
        memo: "استحقاق شركة التوريدات الزراعية",
      },
    ],
  });

  await prisma.vendorBill.create({
    data: {
      id: "bill1",
      billNumber: "BILL-2026-0001",
      vendorId: "v1",
      projectId: "p1",
      subProjectId: "sp1",
      purchaseOrderId: "po1",
      date: new Date("2026-11-01T15:00:00Z"),
      dueDate: new Date("2026-11-30T15:00:00Z"),
      status: "PARTIALLY_PAID",
      totalAmount: 120000,
      paidAmount: 50000,
      balanceDue: 70000,
      currency: "YER",
      isInventory: true,
      debitAccountId: accId("113201"),
      journalEntryId: bill1Je.id,
      notes: "فاتورة مخزون أسمدة - مطابقة ثلاثية مكتملة",
    },
  });

  const pv1Je = await seedJournal({
    date: "2026-11-02",
    reference: "PV-2026-0001",
    narrationAr: "سند صرف دفعة للمورد شركة التوريدات الزراعية من بنك الكريمي",
    narrationEn: "Vendor Payment PV-2026-0001 via Kuraimi Bank",
    sourceType: "VENDOR_PAYMENT",
    sourceId: "pv1",
    projectId: "p1",
    createdById: "u3",
    lines: [
      {
        accountCode: "211101",
        debit: 50000,
        projectId: "p1",
        subProjectId: "sp1",
        memo: "سداد جزئي لفاتورة BILL-2026-0001",
      },
      {
        accountCode: "111201",
        credit: 50000,
        projectId: "p1",
        memo: "تحويل من بنك الكريمي الإسلامي",
      },
    ],
  });

  await prisma.paymentVoucher.create({
    data: {
      id: "pv1",
      voucherNumber: "PV-2026-0001",
      date: new Date("2026-11-02T11:00:00Z"),
      vendorId: "v1",
      billId: "bill1",
      treasuryId: "t2",
      amount: 50000,
      currency: "YER",
      referenceNumber: "KUR-TX-99012",
      notes: "دفعة أولى من مستحقات فاتورة الأسمدة",
      projectId: "p1",
      journalEntryId: pv1Je.id,
      qrVerificationHash: computeQrVerificationCode(
        "PV:PV-2026-0001|VND:v1|AMT:50000",
      ),
    },
  });

  await prisma.purchaseOrder.create({
    data: {
      id: "po2",
      poNumber: "PO-2026-0002",
      vendorId: "v2",
      projectId: "p2",
      subProjectId: "sp4",
      date: new Date("2026-11-03T09:00:00Z"),
      status: "APPROVED",
      subTotal: 60000,
      taxTotal: 0,
      grandTotal: 60000,
      currency: "YER",
      notes: "احتياطي ديزل لمشروع الجبري الوسطى",
      items: {
        create: [
          {
            description: "ديزل تشغيل مضخات الري (لتر)",
            unit: "لتر",
            quantity: 60,
            unitPrice: 1000,
            totalPrice: 60000,
          },
        ],
      },
    },
  });

  await prisma.goodsReceipt.create({
    data: {
      id: "grn2",
      grnNumber: "GRN-2026-0002",
      purchaseOrderId: "po2",
      receivedDate: new Date("2026-11-03T12:00:00Z"),
      receivedTotal: 60000,
      hasVariance: false,
      warehouseNotes: "تم استلام 60 لتر ديزل في خزانات الجبري الوسطى",
    },
  });

  const bill2Je = await seedJournal({
    date: "2026-11-03",
    reference: "BILL-2026-0002",
    narrationAr:
      "فاتورة مخزون وقود لمشروع الجبري الوسطى - محطة الوقود المركزية",
    narrationEn:
      "Vendor Bill BILL-2026-0002 Fuel Reserve - Central Fuel Station",
    sourceType: "VENDOR_BILL",
    sourceId: "bill2",
    projectId: "p2",
    createdById: "u4",
    lines: [
      {
        accountCode: "113202",
        debit: 60000,
        projectId: "p2",
        subProjectId: "sp4",
        memo: "مخزون وقود لمضخات الجبري الوسطى",
      },
      {
        accountCode: "211102",
        credit: 60000,
        projectId: "p2",
        subProjectId: "sp4",
        memo: "استحقاق محطة الوقود المركزية",
      },
    ],
  });

  await prisma.vendorBill.create({
    data: {
      id: "bill2",
      billNumber: "BILL-2026-0002",
      vendorId: "v2",
      projectId: "p2",
      subProjectId: "sp4",
      purchaseOrderId: "po2",
      date: new Date("2026-11-03T13:00:00Z"),
      dueDate: new Date("2026-12-03T13:00:00Z"),
      status: "APPROVED",
      totalAmount: 60000,
      paidAmount: 0,
      balanceDue: 60000,
      currency: "YER",
      isInventory: true,
      debitAccountId: accId("113202"),
      journalEntryId: bill2Je.id,
      notes: "آجل لمدة 30 يوماً",
    },
  });

  // 13. Operating Expenses (UAS.xlsx grounded: total 85,000 YER on p1)
  const rawExpenses = [
    {
      id: "e1",
      projectId: "p1",
      subProjectId: "sp1",
      harvestCycleId: "hc_p1_1",
      harvestName: "القطفة الأولى",
      category: "وقود/محروقات",
      subType: "ديزل تشغيل مضخات (لتر)",
      quantity: 40,
      unitPrice: 1000,
      expenseDate: "2026-11-01",
      notes: "وقود القطفة الأولى",
    },
    {
      id: "e2",
      projectId: "p1",
      subProjectId: "sp1",
      harvestCycleId: "hc_p1_1",
      harvestName: "القطفة الأولى",
      category: "وجبات غذائية",
      subType: "فطور وغداء عمال الحصاد",
      quantity: 1,
      unitPrice: 18000,
      expenseDate: "2026-11-02",
      notes: "وجبات غذائية",
    },
    {
      id: "e3",
      projectId: "p1",
      subProjectId: "sp2",
      harvestCycleId: "hc_p1_1",
      harvestName: "القطفة الأولى",
      category: "مواد غذائية",
      subType: "ماء + أكياس فارغة + عصير",
      quantity: 1,
      unitPrice: 12000,
      expenseDate: "2026-11-02",
      notes: "مستلزمات تعبئة",
    },
    {
      id: "e4",
      projectId: "p1",
      subProjectId: "sp1",
      harvestCycleId: "hc_p1_1",
      harvestName: "القطفة الأولى",
      category: "أجور نقل",
      subType: "نقل عمال من/إلى الجبري العليا",
      quantity: 1,
      unitPrice: 15000,
      expenseDate: "2026-11-03",
      notes: "مواصلات العمال",
    },
  ];

  for (const exp of rawExpenses) {
    const totalAmount = computeOperatingExpenseTotal(
      exp.quantity,
      exp.unitPrice,
    );
    const je = await seedJournal({
      date: exp.expenseDate,
      reference: `EXP-${exp.id.toUpperCase()}`,
      narrationAr: `مصروف تشغيلي (${exp.category}): ${exp.subType}`,
      narrationEn: `Operating Expense: ${exp.subType}`,
      sourceType: "EXPENSE",
      sourceId: exp.id,
      projectId: exp.projectId,
      subProjectId: exp.subProjectId,
      createdById: "u3",
      lines: [
        {
          accountCode: mapExpenseCategoryToCoaCode(exp.category),
          debit: totalAmount,
          projectId: exp.projectId,
          subProjectId: exp.subProjectId,
          harvestCycleId: exp.harvestCycleId,
          memo: exp.subType,
        },
        {
          accountCode: "111101",
          credit: totalAmount,
          projectId: exp.projectId,
          subProjectId: exp.subProjectId,
          harvestCycleId: exp.harvestCycleId,
          memo: `صرف نقدي - ${exp.subType}`,
        },
      ],
    });

    await prisma.operatingExpense.create({
      data: {
        ...exp,
        totalAmount,
        journalEntryId: je.id,
      },
    });
  }

  // 14. Worker Wage Entries & Labor Accrual/Payout Journals (Total wages = 130,000, Paid = 30,000)
  const rawWageEntries = [
    {
      id: "w1",
      workerId: "wrk1",
      workerName: "بلال",
      payableCode: "212101",
      projectId: "p1",
      subProjectId: "sp1",
      harvestCycleId: "hc_p1_1",
      harvestName: "القطفة الأولى",
      dailyWage: 5000,
      daysWorked: 10,
      creditAmount: 10000,
      workDate: "2026-11-04",
      notes: "القطفة الأولى",
    },
    {
      id: "w2",
      workerId: "wrk2",
      workerName: "معاذ",
      payableCode: "212102",
      projectId: "p1",
      subProjectId: "sp1",
      harvestCycleId: "hc_p1_1",
      harvestName: "القطفة الأولى",
      dailyWage: 4000,
      daysWorked: 5,
      creditAmount: 10000,
      workDate: "2026-11-04",
      notes: "القطفة الأولى",
    },
    {
      id: "w3",
      workerId: "wrk3",
      workerName: "فواز",
      payableCode: "212103",
      projectId: "p1",
      subProjectId: "sp2",
      harvestCycleId: "hc_p1_1",
      harvestName: "القطفة الأولى",
      dailyWage: 3000,
      daysWorked: 20,
      creditAmount: 10000,
      workDate: "2026-11-04",
      notes: "القطفة الأولى",
    },
  ];

  for (const w of rawWageEntries) {
    const totals = computeWorkerWageTotals(
      w.dailyWage,
      w.daysWorked,
      w.creditAmount,
    );
    const accrualJe = await seedJournal({
      date: w.workDate,
      reference: `WRK-ACC-${w.id.toUpperCase()}`,
      narrationAr: `إثبات استحقاق أجر العامل ${w.workerName} (${w.daysWorked} أيام × ${w.dailyWage})`,
      narrationEn: `Worker Wage Accrual: ${w.workerName}`,
      sourceType: "WORKER_ACCRUAL",
      sourceId: w.id,
      projectId: w.projectId,
      subProjectId: w.subProjectId,
      createdById: "u3",
      lines: [
        {
          accountCode: "511101",
          debit: totals.totalWage,
          projectId: w.projectId,
          subProjectId: w.subProjectId,
          harvestCycleId: w.harvestCycleId,
          memo: `أجور عمالة مباشرة - ${w.workerName}`,
        },
        {
          accountCode: w.payableCode,
          credit: totals.totalWage,
          projectId: w.projectId,
          subProjectId: w.subProjectId,
          harvestCycleId: w.harvestCycleId,
          memo: `مستحق للعامل ${w.workerName}`,
        },
      ],
    });

    if (w.creditAmount > 0) {
      await seedJournal({
        date: w.workDate,
        reference: `WRK-PAY-${w.id.toUpperCase()}`,
        narrationAr: `صرف دفعة من أجر العامل ${w.workerName} نقداً`,
        narrationEn: `Worker Wage Payout: ${w.workerName}`,
        sourceType: "WORKER_PAYOUT",
        sourceId: w.id,
        projectId: w.projectId,
        subProjectId: w.subProjectId,
        createdById: "u3",
        lines: [
          {
            accountCode: w.payableCode,
            debit: w.creditAmount,
            projectId: w.projectId,
            subProjectId: w.subProjectId,
            harvestCycleId: w.harvestCycleId,
            memo: `تسوية مستحقات ${w.workerName}`,
          },
          {
            accountCode: "111101",
            credit: w.creditAmount,
            projectId: w.projectId,
            subProjectId: w.subProjectId,
            harvestCycleId: w.harvestCycleId,
            memo: `صرف نقدي للعامل ${w.workerName}`,
          },
        ],
      });
    }

    await prisma.workerWageEntry.create({
      data: {
        id: w.id,
        workerId: w.workerId,
        workerName: w.workerName,
        projectId: w.projectId,
        subProjectId: w.subProjectId,
        harvestCycleId: w.harvestCycleId,
        harvestName: w.harvestName,
        dailyWage: w.dailyWage,
        daysWorked: w.daysWorked,
        totalWage: totals.totalWage,
        creditAmount: w.creditAmount,
        debitBalance: totals.debitBalance,
        workDate: w.workDate,
        notes: w.notes,
        journalEntryId: accrualJe.id,
      },
    });
  }

  // 15. Sales Transactions, Enterprise SalesInvoices & ReceiptVouchers (Total Sales = 430,000 YER)
  const rawSales = [
    {
      id: "s1",
      invoiceId: "sinv1",
      invoiceNumber: "INV-2026-0001",
      rvId: "rcp1",
      customerAccountCode: "112101",
      treasuryId: "t1",
      treasuryAccountCode: "111101",
      projectId: "p1",
      subProjectId: "sp1",
      harvestCycleId: "hc_p1_1",
      harvestName: "القطفة الأولى",
      saleBatchLabel: "عملية بيع 1",
      customerId: "cust1",
      customerName: "فواز الجابري",
      customerPhone: "783118231",
      productGrade: "رقم 1/رقم 2/رقم 3/ روس/بزغة",
      bundlesCount: 100,
      unitPrice: 2000,
      creditPaid: 50000,
      saleDate: "2026-11-05",
      receiptVoucherNo: "RV-001",
      notes: "عملية بيع 1 - الجبري العليا",
    },
    {
      id: "s2",
      invoiceId: "sinv2",
      invoiceNumber: "INV-2026-0002",
      rvId: "rcp2",
      customerAccountCode: "112102",
      treasuryId: "t3",
      treasuryAccountCode: "111203",
      projectId: "p1",
      subProjectId: "sp2",
      harvestCycleId: "hc_p1_1",
      harvestName: "القطفة الأولى",
      saleBatchLabel: "عملية بيع 1",
      customerId: "cust2",
      customerName: "يوسف الجابري",
      customerPhone: "783118231",
      productGrade: "رقم 1/رقم 2/رقم 3/ روس/بزغة",
      bundlesCount: 100,
      unitPrice: 150,
      creditPaid: 10000,
      saleDate: "2026-11-05",
      receiptVoucherNo: "RV-002",
      notes: "عملية بيع 1 - الجبري العليا",
    },
    {
      id: "s3",
      invoiceId: "sinv3",
      invoiceNumber: "INV-2026-0003",
      rvId: "rcp3",
      customerAccountCode: "112101",
      treasuryId: "t1",
      treasuryAccountCode: "111101",
      projectId: "p1",
      subProjectId: "sp1",
      harvestCycleId: "hc_p1_1",
      harvestName: "القطفة الأولى",
      saleBatchLabel: "عملية بيع 2",
      customerId: "cust1",
      customerName: "فواز الجابري",
      customerPhone: "783118231",
      productGrade: "رقم 1/رقم 2/رقم 3/ روس/بزغة",
      bundlesCount: 100,
      unitPrice: 2000,
      creditPaid: 50000,
      saleDate: "2026-11-08",
      receiptVoucherNo: "RV-003",
      notes: "عملية بيع 2 - الجبري العليا",
    },
    {
      id: "s4",
      invoiceId: "sinv4",
      invoiceNumber: "INV-2026-0004",
      rvId: "rcp4",
      customerAccountCode: "112102",
      treasuryId: "t3",
      treasuryAccountCode: "111203",
      projectId: "p1",
      subProjectId: "sp2",
      harvestCycleId: "hc_p1_1",
      harvestName: "القطفة الأولى",
      saleBatchLabel: "عملية بيع 2",
      customerId: "cust2",
      customerName: "يوسف الجابري",
      customerPhone: "783118231",
      productGrade: "رقم 1/رقم 2/رقم 3/ روس/بزغة",
      bundlesCount: 100,
      unitPrice: 150,
      creditPaid: 10000,
      saleDate: "2026-11-08",
      receiptVoucherNo: "RV-004",
      notes: "عملية بيع 2 - الجبري العليا",
    },
  ];

  for (let idx = 0; idx < rawSales.length; idx++) {
    const s = rawSales[idx];
    const seqNo = `SO-2026-000${idx + 1}`;
    const totals = computeSaleTotals(s.bundlesCount, s.unitPrice, s.creditPaid);
    const invJe = await seedJournal({
      date: s.saleDate,
      reference: s.invoiceNumber,
      narrationAr: `إثبات فاتورة مبيعات ${s.invoiceNumber} - ${s.customerName} (${s.saleBatchLabel})`,
      narrationEn: `Sales Invoice ${s.invoiceNumber} - ${s.customerName}`,
      sourceType: "SALES_INVOICE",
      sourceId: s.invoiceId,
      projectId: s.projectId,
      subProjectId: s.subProjectId,
      createdById: "u3",
      lines: [
        {
          accountCode: s.customerAccountCode,
          debit: totals.totalAmount,
          projectId: s.projectId,
          subProjectId: s.subProjectId,
          harvestCycleId: s.harvestCycleId,
          memo: `استحقاق على العميل ${s.customerName}`,
        },
        {
          accountCode: "411101",
          credit: totals.totalAmount,
          projectId: s.projectId,
          subProjectId: s.subProjectId,
          harvestCycleId: s.harvestCycleId,
          memo: `إيراد مبيعات ${s.harvestName} (${s.bundlesCount} علاقية)`,
        },
      ],
    });

    const rcpJe = await seedJournal({
      date: s.saleDate,
      reference: s.receiptVoucherNo,
      narrationAr: `سند قبض ${s.receiptVoucherNo} من العميل ${s.customerName}`,
      narrationEn: `Customer Receipt ${s.receiptVoucherNo}`,
      sourceType: "CUSTOMER_RECEIPT",
      sourceId: s.rvId,
      projectId: s.projectId,
      subProjectId: s.subProjectId,
      createdById: "u3",
      lines: [
        {
          accountCode: s.treasuryAccountCode,
          debit: s.creditPaid,
          projectId: s.projectId,
          subProjectId: s.subProjectId,
          harvestCycleId: s.harvestCycleId,
          memo: `توريد نقدي/محفظة من ${s.customerName}`,
        },
        {
          accountCode: s.customerAccountCode,
          credit: s.creditPaid,
          projectId: s.projectId,
          subProjectId: s.subProjectId,
          harvestCycleId: s.harvestCycleId,
          memo: `تحصيل دفعة فاتورة ${s.invoiceNumber}`,
        },
      ],
    });

    await prisma.saleTransaction.create({
      data: {
        id: s.id,
        sequenceNumber: seqNo,
        dailyBatchLabel: s.saleBatchLabel,
        salesOfficerId: "u3",
        salesOfficerTitle: "فواز الجابري (مسؤول مبيعات)",
        revenueAccountCode: "411101",
        treasuryAccountId: s.treasuryId,
        projectId: s.projectId,
        subProjectId: s.subProjectId,
        harvestCycleId: s.harvestCycleId,
        harvestName: s.harvestName,
        saleBatchLabel: s.saleBatchLabel,
        customerId: s.customerId,
        customerName: s.customerName,
        customerPhone: s.customerPhone,
        productGrade: s.productGrade,
        bundlesCount: s.bundlesCount,
        unitPrice: s.unitPrice,
        totalAmount: totals.totalAmount,
        creditPaid: s.creditPaid,
        debitReceivable: totals.debitReceivable,
        saleDate: s.saleDate,
        receiptVoucherNo: s.receiptVoucherNo,
        notes: s.notes,
        journalEntryId: invJe.id,
      },
    });

    await prisma.salesInvoice.create({
      data: {
        id: s.invoiceId,
        sequenceNumber: seqNo,
        dailyBatchLabel: s.saleBatchLabel,
        salesOfficerId: "u3",
        salesOfficerTitle: "فواز الجابري (مسؤول مبيعات)",
        revenueAccountCode: "411101",
        treasuryAccountId: s.treasuryId,
        invoiceNumber: s.invoiceNumber,
        customerId: s.customerId,
        projectId: s.projectId,
        subProjectId: s.subProjectId,
        harvestCycleId: s.harvestCycleId,
        date: new Date(`${s.saleDate}T12:00:00Z`),
        totalAmount: totals.totalAmount,
        paidAmount: s.creditPaid,
        balanceDue: totals.debitReceivable,
        status:
          totals.debitReceivable <= 0
            ? "PAID"
            : s.creditPaid > 0
              ? "PARTIALLY_PAID"
              : "POSTED",
        currency: "YER",
        notes: s.notes,
        journalEntryId: invJe.id,
        qrVerificationHash: computeQrVerificationCode(
          `INV:${s.invoiceNumber}|CUST:${s.customerName}|AMT:${totals.totalAmount}`,
        ),
      },
    });

    await prisma.receiptVoucher.create({
      data: {
        id: s.rvId,
        voucherNumber: s.receiptVoucherNo,
        date: new Date(`${s.saleDate}T13:00:00Z`),
        customerId: s.customerId,
        invoiceId: s.invoiceId,
        treasuryId: s.treasuryId,
        subProjectId: s.subProjectId,
        amount: s.creditPaid,
        currency: "YER",
        notes: `دفعة مسددة على ${s.invoiceNumber}`,
        journalEntryId: rcpJe.id,
        qrVerificationHash: computeQrVerificationCode(
          `INST:${s.receiptVoucherNo}|PARTY:${s.customerName}|AMT:${s.creditPaid}|DATE:${s.saleDate}`,
        ),
      },
    });
  }

  // 16. Installment Vouchers (Compatible with TreasuryTab & Public QR Verification)
  const rawInstallments = [
    {
      id: "inst1",
      voucherNo: "RV-001",
      type: "CUSTOMER_RECEIPT",
      saleTransactionId: "s1",
      workerWageEntryId: null,
      targetName: "فواز الجابري (عملية بيع 1)",
      phone: "783118231",
      treasuryAccountId: "t1",
      amountYER: 50000,
      paymentDate: "2026-11-05",
      notes: "دفعة أولى نقدية عند البيع",
    },
    {
      id: "inst2",
      voucherNo: "RV-002",
      type: "CUSTOMER_RECEIPT",
      saleTransactionId: "s2",
      workerWageEntryId: null,
      targetName: "يوسف الجابري (عملية بيع 1)",
      phone: "783118231",
      treasuryAccountId: "t3",
      amountYER: 10000,
      paymentDate: "2026-11-05",
      notes: "تحويل عبر محفظة جوالي",
    },
    {
      id: "inst3",
      voucherNo: "PV-001",
      type: "WORKER_PAYOUT",
      saleTransactionId: null,
      workerWageEntryId: "w1",
      targetName: "بلال (القطفة الأولى)",
      phone: "783118231",
      treasuryAccountId: "t1",
      amountYER: 10000,
      paymentDate: "2026-11-04",
      notes: "دفعة مقدمة من أجر العامل بلال",
    },
  ];
  await prisma.installmentVoucher.createMany({
    data: rawInstallments.map((inst) => ({
      ...inst,
      qrVerificationHash: computeQrVerificationCode(
        `INST:${inst.voucherNo}|PARTY:${inst.targetName}|AMT:${inst.amountYER}|DATE:${inst.paymentDate}`,
      ),
    })),
  });

  // 17. Inventory Lots & Harvest Inventory Batches
  await prisma.inventoryLot.createMany({
    data: [
      {
        id: "lot1",
        lotNumber: "LOT-2026-P1-G1",
        projectId: "p1",
        harvestCycleId: "hc_p1_1",
        grade: "صنف 1 ممتاز",
        initialQuantity: 250,
        currentQuantity: 10,
        shrinkageCount: 3,
        unitCost: 850,
      },
      {
        id: "lot2",
        lotNumber: "LOT-2026-P1-G2",
        projectId: "p1",
        harvestCycleId: "hc_p1_1",
        grade: "صنف 2 وسط",
        initialQuantity: 170,
        currentQuantity: 5,
        shrinkageCount: 2,
        unitCost: 110,
      },
    ],
  });

  await prisma.harvestInventoryBatch.create({
    data: {
      id: "inv1",
      projectId: "p1",
      subProjectId: "sp1",
      harvestCycleId: "hc_p1_1",
      harvestName: "القطفة الأولى",
      productGrade: "رقم 1/رقم 2/رقم 3/ روس/بزغة",
      harvestedBundles: 420,
      shrinkageBundles: 5,
      notes: "إجمالي قطفة الجبري العليا الأولى",
    },
  });

  // 18. Enterprise Audit Logs & Immutable Audit Logs
  await prisma.auditLog.createMany({
    data: [
      {
        id: "eaud1",
        userId: "u1",
        action: "POST",
        entity: "JournalEntry",
        entityId: "JV-2026-0001",
        details: {
          summary: "ترحيل قيد الأرصدة الافتتاحية المزدوج",
          balanced: true,
        },
        ipAddress: "127.0.0.1",
      },
      {
        id: "eaud2",
        userId: "u4",
        action: "CREATE",
        entity: "VendorBill",
        entityId: "BILL-2026-0001",
        details: {
          vendor: "شركة التوريدات الزراعية",
          amount: 120000,
          threeWayMatched: true,
        },
        ipAddress: "127.0.0.1",
      },
    ],
  });

  await prisma.immutableAuditLog.createMany({
    data: [
      {
        id: "aud1",
        timestamp: "2026-11-05 09:15",
        userId: "u1",
        userDisplay: "مدير النظام العام (SUPER_ADMIN)",
        userRole: "SUPER_ADMIN",
        actionType: "تهيئة شجرة الحسابات 5-Tier",
        entityReference: "COA",
        details:
          "تأسيس دليل الحسابات الموحد ذي 5 مستويات وتفعيل محرك القيد المزدوج",
        sha256Hash: "UAS-9F4A2C",
      },
      {
        id: "aud2",
        timestamp: "2026-11-05 14:30",
        userId: "u3",
        userDisplay: "رئيس الحسابات (CHIEF_ACCOUNTANT)",
        userRole: "CHIEF_ACCOUNTANT",
        actionType: "سند قبض مبيعات",
        entityReference: "inst1",
        details:
          "تحصيل 50,000 ريال من عميل الجملة إلى الصندوق الرئيسي وترحيل القيد الآلي",
        sha256Hash: "UAS-3B8E11",
      },
      {
        id: "aud3",
        timestamp: "2026-11-08 11:00",
        userId: "u1",
        userDisplay: "مدير النظام العام (SUPER_ADMIN)",
        userRole: "SUPER_ADMIN",
        actionType: "تهيئة قاعدة البيانات",
        entityReference: "seed",
        details:
          "تم ترحيل بيانات UAS.xlsx وسجلات المشتريات والقيود المتزنة بنجاح",
        sha256Hash: sha256Audit("UAS-SEED-2026"),
      },
    ],
  });

  console.log(
    "Database seeded successfully with 5-tier COA & balanced Double-Entry Ledger!",
  );
}

main()
  .catch((e) => {
    console.error("Seed error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
