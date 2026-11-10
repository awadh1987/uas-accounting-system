import crypto from "node:crypto";
import { PrismaClient } from "@prisma/client";
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
  return "SHA256-" + crypto.createHash("sha256").update(payload).digest("hex").slice(0, 12).toUpperCase();
}

async function main() {
  console.log("Seeding Unified Accounting System (UAS) database...");

  // Clear in dependency-safe order for deterministic idempotent seeding
  await prisma.$transaction([
    prisma.adjustmentEntry.deleteMany(),
    prisma.immutableAuditLog.deleteMany(),
    prisma.installmentVoucher.deleteMany(),
    prisma.harvestInventoryBatch.deleteMany(),
    prisma.saleTransaction.deleteMany(),
    prisma.customer.deleteMany(),
    prisma.workerWageEntry.deleteMany(),
    prisma.worker.deleteMany(),
    prisma.operatingExpense.deleteMany(),
    prisma.harvestCycle.deleteMany(),
    prisma.project.deleteMany(),
    prisma.treasuryAccount.deleteMany(),
    prisma.currencyRate.deleteMany(),
    prisma.user.deleteMany(),
    prisma.systemSettings.deleteMany(),
  ]);

  // 1. System Settings
  await prisma.systemSettings.create({
    data: {
      id: "default",
      orgName: "النظام المحاسبي الموحد Unified Accounting System (UAS)",
      logoText: "UAS",
      defaultLang: "ar",
      defaultTheme: "emerald",
      defaultCurrency: "YER",
    },
  });

  // 2. Currency Rates
  await prisma.currencyRate.createMany({
    data: [
      { currencyCode: "YER", rateToYER: 1 },
      { currencyCode: "SAR", rateToYER: 425 },
      { currencyCode: "USD", rateToYER: 1620 },
    ],
  });

  // 3. Users (default password: "123456")
  const defaultPassHash = hashPassword("123456");
  await prisma.user.createMany({
    data: [
      {
        id: "u1",
        name: "أحمد الجابري",
        email: "admin@uas-ye.com",
        passwordHash: defaultPassHash,
        role: "مدير النظام (Admin)",
        active: true,
        avatarChar: "أ",
      },
      {
        id: "u2",
        name: "فواز الجابري",
        email: "fawaz@uas-ye.com",
        passwordHash: defaultPassHash,
        role: "مدير مشاريع (Project Manager)",
        active: true,
        avatarChar: "ف",
      },
      {
        id: "u3",
        name: "بلال المحاسب",
        email: "bilal@uas-ye.com",
        passwordHash: defaultPassHash,
        role: "محاسب رئيسي (Accountant)",
        active: true,
        avatarChar: "ب",
      },
    ],
  });

  // 4. Treasury Accounts
  await prisma.treasuryAccount.createMany({
    data: [
      {
        id: "t1",
        name: "الصندوق الرئيسي (Main Cash Box)",
        type: "CASH",
        accountNumber: "CASH-01",
        currencyCode: "YER",
        balanceYER: 120000,
      },
      {
        id: "t2",
        name: "بنك الكريمي (Kuraimi Bank)",
        type: "BANK",
        accountNumber: "KUR-88412",
        currencyCode: "YER",
        balanceYER: 350000,
      },
      {
        id: "t3",
        name: "محفظة جوالي (Jawali Wallet)",
        type: "WALLET",
        accountNumber: "JWL-78311",
        currencyCode: "YER",
        balanceYER: 95000,
      },
      {
        id: "t4",
        name: "محفظة جيب (Jeeb Wallet)",
        type: "WALLET",
        accountNumber: "JEB-78311",
        currencyCode: "YER",
        balanceYER: 60000,
      },
    ],
  });

  // 5. Projects (Main projects first, then Sub-projects)
  await prisma.project.create({
    data: {
      id: "p1",
      name: "الجبري العليا",
      type: "مشروع رئيسي",
      parentProjectId: null,
      estimatedValue: 1000000,
      plannedHarvestCount: 3,
      notes: "بقعة قات الجبري",
    },
  });

  await prisma.project.create({
    data: {
      id: "p2",
      name: "الجبري الوسطى",
      type: "مشروع رئيسي",
      parentProjectId: null,
      estimatedValue: 750000,
      plannedHarvestCount: 2,
      notes: "مشروع الجبري الوسطى",
    },
  });

  await prisma.project.create({
    data: {
      id: "p3",
      name: "الجبري السفلى",
      type: "مشروع فرعي",
      parentProjectId: "p1",
      estimatedValue: 500000,
      plannedHarvestCount: 2,
      notes: "فرع الجبري السفلى",
    },
  });

  // 6. Harvest Cycles
  const harvestSeed = [
    { id: "hc_p1_1", projectId: "p1", name: "القطفة الأولى", sortOrder: 1, isLocked: false },
    { id: "hc_p1_2", projectId: "p1", name: "القطفة الثانية", sortOrder: 2, isLocked: false },
    { id: "hc_p1_3", projectId: "p1", name: "القطفة الثالثة", sortOrder: 3, isLocked: false },
    { id: "hc_p2_1", projectId: "p2", name: "القطفة الأولى", sortOrder: 1, isLocked: false },
    { id: "hc_p2_2", projectId: "p2", name: "القطفة الثانية", sortOrder: 2, isLocked: false },
    { id: "hc_p3_1", projectId: "p3", name: "القطفة الأولى", sortOrder: 1, isLocked: false },
    { id: "hc_p3_2", projectId: "p3", name: "القطفة الثانية", sortOrder: 2, isLocked: false },
  ];
  await prisma.harvestCycle.createMany({ data: harvestSeed });

  // 7. Operating Expenses
  const rawExpenses = [
    {
      id: "e1",
      projectId: "p1",
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
  await prisma.operatingExpense.createMany({
    data: rawExpenses.map((e) => ({
      ...e,
      totalAmount: computeOperatingExpenseTotal(e.quantity, e.unitPrice),
    })),
  });

  // 8. Workers & Worker Wage Entries
  await prisma.worker.createMany({
    data: [
      { id: "wrk1", name: "بلال", phone: "783118231", defaultDailyWage: 5000 },
      { id: "wrk2", name: "معاذ", phone: "783118231", defaultDailyWage: 4000 },
      { id: "wrk3", name: "فواز", phone: "783118231", defaultDailyWage: 3000 },
    ],
  });

  const rawWageEntries = [
    {
      id: "w1",
      workerId: "wrk1",
      workerName: "بلال",
      projectId: "p1",
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
      projectId: "p1",
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
      projectId: "p1",
      harvestCycleId: "hc_p1_1",
      harvestName: "القطفة الأولى",
      dailyWage: 3000,
      daysWorked: 20,
      creditAmount: 10000,
      workDate: "2026-11-04",
      notes: "القطفة الأولى",
    },
  ];
  await prisma.workerWageEntry.createMany({
    data: rawWageEntries.map((w) => ({
      ...w,
      ...computeWorkerWageTotals(w.dailyWage, w.daysWorked, w.creditAmount),
    })),
  });

  // 9. Customers & Sale Transactions
  await prisma.customer.createMany({
    data: [
      { id: "cust1", name: "فواز الجابري", phone: "783118231" },
      { id: "cust2", name: "يوسف الجابري", phone: "783118231" },
    ],
  });

  const rawSales = [
    {
      id: "s1",
      projectId: "p1",
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
      projectId: "p1",
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
      projectId: "p1",
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
      projectId: "p1",
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
  await prisma.saleTransaction.createMany({
    data: rawSales.map((s) => ({
      ...s,
      ...computeSaleTotals(s.bundlesCount, s.unitPrice, s.creditPaid),
    })),
  });

  // 10. Installment Vouchers
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
        `INST:${inst.voucherNo}|PARTY:${inst.targetName}|AMT:${inst.amountYER}|DATE:${inst.paymentDate}`
      ),
    })),
  });

  // 11. Harvest Inventory Batches
  await prisma.harvestInventoryBatch.create({
    data: {
      id: "inv1",
      projectId: "p1",
      harvestCycleId: "hc_p1_1",
      harvestName: "القطفة الأولى",
      productGrade: "رقم 1/رقم 2/رقم 3/ روس/بزغة",
      harvestedBundles: 420,
      shrinkageBundles: 5,
      notes: "إجمالي قطفة الجبري العليا الأولى",
    },
  });

  // 12. Immutable Audit Logs
  await prisma.immutableAuditLog.createMany({
    data: [
      {
        id: "aud1",
        timestamp: "2026-11-05 09:15",
        userId: "u1",
        userDisplay: "أحمد الجابري (Admin)",
        userRole: "مدير النظام (Admin)",
        actionType: "إنشاء مشروع",
        entityReference: "p1",
        details: "تأسيس مشروع الجبري العليا بقيمة 1,000,000 ريال",
        sha256Hash: "UAS-9F4A2C",
      },
      {
        id: "aud2",
        timestamp: "2026-11-05 14:30",
        userId: "u3",
        userDisplay: "بلال المحاسب (Accountant)",
        userRole: "محاسب رئيسي (Accountant)",
        actionType: "سند قبض مبيعات",
        entityReference: "inst1",
        details: "تحصيل 50,000 ريال من فواز الجابري إلى الصندوق الرئيسي",
        sha256Hash: "UAS-3B8E11",
      },
      {
        id: "aud3",
        timestamp: "2026-11-08 11:00",
        userId: "u1",
        userDisplay: "أحمد الجابري (Admin)",
        userRole: "مدير النظام (Admin)",
        actionType: "تهيئة قاعدة البيانات",
        entityReference: "seed",
        details: "تم ترحيل بيانات UAS.xlsx الأساسية والتحقق من جميع المعادلات",
        sha256Hash: sha256Audit("UAS-SEED-2026"),
      },
    ],
  });

  console.log("Database seeded successfully!");
}

main()
  .catch((e) => {
    console.error("Seed error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

