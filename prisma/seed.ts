import crypto from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { STANDARD_COA_NODES } from "../src/lib/accounting/coaCatalog";

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
  console.log(
    "Seeding Unified Accounting System (UAS) — Clean Zero-Transaction Enterprise Baseline...",
  );

  // 1. Clear all tables in strict dependency-safe order for idempotent seeding
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
  ]);

  // 2. Enterprise Profile & System Settings (Zero-State Baseline - Preserve existing configuration)
  const existingProfile = await prisma.enterpriseProfile.findUnique({ where: { id: "default" } });
  if (!existingProfile) {
    await prisma.enterpriseProfile.create({
      data: {
        id: "default",
        legalNameAr: "اسم المنشأة",
        legalNameEn: "Enterprise Name",
        taxNumber: "",
        commercialReg: "",
        currencyCode: "YER",
        isConfigured: false,
        address: "",
        phone: "",
        email: "",
        logoUrl: "/icons/icon.svg",
        brandColor: "#059669",
        contactPhone: "",
        contactWhatsApp: "",
        contactAddress: "",
      },
    });
  }

  const existingSettings = await prisma.systemSettings.findUnique({ where: { id: "default" } });
  if (!existingSettings) {
    await prisma.systemSettings.create({
      data: {
        id: "default",
        orgName: "النظام المحاسبي الموحد (UAS Enterprise)",
        logoText: "UAS",
        defaultLang: "ar",
        defaultTheme: "emerald",
        defaultCurrency: "YER",
      },
    });
  }

  // 3. Default Exchange Rates (Base = YER)
  await prisma.currencyRate.createMany({
    data: [
      { currencyCode: "YER", rateToYER: 1 },
      { currencyCode: "SAR", rateToYER: 425 },
      { currencyCode: "USD", rateToYER: 1620 },
    ],
  });

  // 4. Users — Single Initial Administrator Account (if no users exist in PostgreSQL)
  // Preserves existing real users and never deletes or overwrites them.
  const existingUsersCount = await prisma.user.count();
  if (existingUsersCount === 0) {
    const defaultPassHash = hashPassword("123456");
    await prisma.user.create({
      data: {
        id: "u1",
        username: "system_owner",
        name: "مدير النظام العام",
        fullName: "مدير النظام العام / System Owner",
        displayName: "",
        phone: "",
        email: "admin@uas-ye.com",
        passwordHash: defaultPassHash,
        role: "SUPER_ADMIN",
        department: "الإدارة العليا وتقنية المعلومات",
        active: true,
        isActive: true,
        avatarChar: "م",
        avatarColor: "#059669",
        preferredLang: "ar",
        preferredCurrency: "YER",
        preferredTheme: "emerald",
        useCustomPermissions: false,
        customAllowedGroups: "[]",
        customPermissionsJson: "{}",
        mustChangePassword: false,
        assignedProjects: "[]",
      },
    });
  }

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
          parentCode: node.parentCode,
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

  // 6. Main Cash Vault (Balance = 0.00 YER, linked to COA 111101)
  await prisma.treasuryAccount.create({
    data: {
      id: "t1",
      code: "TR-VAULT-YER",
      name: "الصندوق الرئيسي - يمني (Main Cash Vault - YER)",
      nameAr: "الصندوق الرئيسي - يمني",
      nameEn: "Main Cash Vault - YER",
      type: "VAULT",
      providerNameAr: "الخزينة النقدية الرئيسية",
      providerNameEn: "Main Cash Vault",
      accountHolderName: "الإدارة المالية",
      accountNumber: "CASH-01",
      branchOrAgent: "المركز الرئيسي",
      transferFeePercent: 0,
      dailyLimit: 0,
      isDefaultReceipts: true,
      isDefaultPayments: true,
      isActive: true,
      accountId: accId("111101"),
      currency: "YER",
      currencyCode: "YER",
      balance: 0,
      balanceYER: 0,
    },
  });

  // 7. Initial Immutable Audit Log Entry (Zero-Transaction Baseline)
  const nowStr = new Date().toISOString().slice(0, 16).replace("T", " ");
  await prisma.immutableAuditLog.create({
    data: {
      id: "aud-zero-init",
      timestamp: nowStr,
      userId: "u1",
      userDisplay: "مدير النظام العام (SUPER_ADMIN)",
      userRole: "SUPER_ADMIN",
      actionType: "تهيئة النظام المحاسبي (وضع البداية الصفرية)",
      entityReference: "COA-6GEN-ZERO",
      details:
        "تم تهيئة شجرة الحسابات سداسية الأجيال (6-Generation COA) والصندوق الرئيسي (0.00) والأدوار السبعة بنجاح بدون حركات سابقة.",
      sha256Hash: sha256Audit("UAS-ZERO-BASELINE-2026"),
    },
  });

  console.log(
    "Clean zero-transaction UAS database seeded successfully (6-generation COA, Main Cash Vault 0.00, 7 RBAC roles).",
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
