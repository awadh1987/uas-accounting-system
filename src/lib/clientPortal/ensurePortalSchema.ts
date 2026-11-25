import { prisma } from "@/lib/prisma";
import { DEFAULT_TENANT_FORM_CONFIG, PORTAL_FORM_SETTING_ID } from "@/lib/clientPortal/portalConfig";
import { ensureSqliteDatabaseReady, isSqliteRuntime } from "@/lib/sqliteBootstrap";
import { getActiveTenantId } from "@/lib/tenant/tenantContext";

const ensuredTenantIds = new Set<string>();

/**
 * Generates idempotent PostgreSQL DDL statements for all Phase 9–14 Client Portal,
 * Pricing Board, Amendments, and WhatsApp Outbox tables/columns.
 * Shared across runtime self-healing and new-tenant schema provisioning.
 */
export function buildPostgresPortalDdlStatements(schemaName?: string): string[] {
  const q = (tableName: string) =>
    schemaName ? `"${schemaName}"."${tableName}"` : `"${tableName}"`;

  return [
    `CREATE TABLE IF NOT EXISTS ${q("ClientPortalAccount")} (
      "id" TEXT NOT NULL PRIMARY KEY,
      "customerId" TEXT,
      "fullName" TEXT NOT NULL,
      "tradeName" TEXT,
      "phone" TEXT NOT NULL,
      "email" TEXT NOT NULL,
      "passwordHash" TEXT NOT NULL,
      "avatarUrl" TEXT,
      "avatarColor" TEXT NOT NULL DEFAULT '#059669',
      "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
      "passwordUpdatedAt" TIMESTAMP(3),
      "sessionVersion" INTEGER NOT NULL DEFAULT 1,
      "clientType" TEXT NOT NULL DEFAULT 'DIRECT_CLIENT',
      "customClientType" TEXT,
      "preferredPickup" TEXT NOT NULL DEFAULT 'السوق',
      "customFieldsJson" TEXT NOT NULL DEFAULT '{}',
      "status" TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
      "notes" TEXT,
      "approvedById" TEXT,
      "approvedByName" TEXT,
      "approvedAt" TIMESTAMP(3),
      "rejectedReason" TEXT,
      "lastLoginAt" TIMESTAMP(3),
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );`,
    `ALTER TABLE ${q("ClientPortalAccount")} ADD COLUMN IF NOT EXISTS "avatarUrl" TEXT;`,
    `ALTER TABLE ${q("ClientPortalAccount")} ADD COLUMN IF NOT EXISTS "avatarColor" TEXT NOT NULL DEFAULT '#059669';`,
    `ALTER TABLE ${q("ClientPortalAccount")} ADD COLUMN IF NOT EXISTS "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;`,
    `ALTER TABLE ${q("ClientPortalAccount")} ADD COLUMN IF NOT EXISTS "passwordUpdatedAt" TIMESTAMP(3);`,
    `ALTER TABLE ${q("ClientPortalAccount")} ADD COLUMN IF NOT EXISTS "sessionVersion" INTEGER NOT NULL DEFAULT 1;`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "ClientPortalAccount_phone_key" ON ${q("ClientPortalAccount")}("phone");`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "ClientPortalAccount_email_key" ON ${q("ClientPortalAccount")}("email");`,
    `CREATE INDEX IF NOT EXISTS "ClientPortalAccount_status_createdAt_idx" ON ${q("ClientPortalAccount")}("status", "createdAt");`,
    `CREATE INDEX IF NOT EXISTS "ClientPortalAccount_customerId_idx" ON ${q("ClientPortalAccount")}("customerId");`,
    `CREATE TABLE IF NOT EXISTS ${q("ClientPasswordResetToken")} (
      "id" TEXT NOT NULL PRIMARY KEY,
      "clientAccountId" TEXT NOT NULL,
      "codeHash" TEXT NOT NULL,
      "initiatedBy" TEXT NOT NULL DEFAULT 'SELF',
      "staffUserId" TEXT,
      "staffUserName" TEXT,
      "expiresAt" TIMESTAMP(3) NOT NULL,
      "usedAt" TIMESTAMP(3),
      "attempts" INTEGER NOT NULL DEFAULT 0,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "ClientPasswordResetToken_clientAccountId_fkey" FOREIGN KEY ("clientAccountId") REFERENCES ${q("ClientPortalAccount")}("id") ON DELETE CASCADE ON UPDATE CASCADE
    );`,
    `CREATE INDEX IF NOT EXISTS "ClientPasswordResetToken_clientAccountId_createdAt_idx" ON ${q("ClientPasswordResetToken")}("clientAccountId", "createdAt");`,
    `CREATE INDEX IF NOT EXISTS "ClientPasswordResetToken_expiresAt_idx" ON ${q("ClientPasswordResetToken")}("expiresAt");`,
    `CREATE TABLE IF NOT EXISTS ${q("ClientGoodsRequest")} (
      "id" TEXT NOT NULL PRIMARY KEY,
      "requestNumber" TEXT NOT NULL,
      "clientAccountId" TEXT NOT NULL,
      "customerId" TEXT,
      "status" TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
      "pickupType" TEXT NOT NULL DEFAULT 'MARKET',
      "pickupLocation" TEXT NOT NULL DEFAULT 'السوق',
      "pickupNotes" TEXT,
      "customDataJson" TEXT NOT NULL DEFAULT '{}',
      "reserveStock" BOOLEAN NOT NULL DEFAULT false,
      "reservedSummaryJson" TEXT NOT NULL DEFAULT '[]',
      "totalEstimated" DECIMAL(65,30) NOT NULL DEFAULT 0,
      "totalConfirmed" DECIMAL(65,30) NOT NULL DEFAULT 0,
      "currency" TEXT NOT NULL DEFAULT 'YER',
      "projectId" TEXT,
      "subProjectId" TEXT,
      "harvestName" TEXT,
      "linkedInvoiceId" TEXT,
      "linkedSaleId" TEXT,
      "linkedReceiptId" TEXT,
      "linkedSalesRecordId" TEXT,
      "linkedDraftId" TEXT,
      "creditPaidPlanned" DECIMAL(65,30) NOT NULL DEFAULT 0,
      "debitPlanned" DECIMAL(65,30) NOT NULL DEFAULT 0,
      "approvedByUserId" TEXT,
      "approvedByName" TEXT,
      "approvedAt" TIMESTAMP(3),
      "reviewedById" TEXT,
      "reviewedByName" TEXT,
      "reviewedAt" TIMESTAMP(3),
      "readyAt" TIMESTAMP(3),
      "handedOverById" TEXT,
      "handedOverByName" TEXT,
      "handedOverAt" TIMESTAMP(3),
      "staffNotes" TEXT,
      "reviewerRemarks" TEXT,
      "amendmentDiffJson" TEXT NOT NULL DEFAULT '[]',
      "beforeSnapshotJson" TEXT,
      "afterSnapshotJson" TEXT,
      "revisionNumber" INTEGER NOT NULL DEFAULT 1,
      "returnedToClientAt" TIMESTAMP(3),
      "returnedByUserId" TEXT,
      "returnedByName" TEXT,
      "clientResponseStatus" TEXT,
      "clientResponseNote" TEXT,
      "clientRespondedAt" TIMESTAMP(3),
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "ClientGoodsRequest_clientAccountId_fkey" FOREIGN KEY ("clientAccountId") REFERENCES ${q("ClientPortalAccount")}("id") ON DELETE CASCADE ON UPDATE CASCADE
    );`,
    `ALTER TABLE ${q("ClientGoodsRequest")} ADD COLUMN IF NOT EXISTS "linkedSalesRecordId" TEXT;`,
    `ALTER TABLE ${q("ClientGoodsRequest")} ADD COLUMN IF NOT EXISTS "linkedDraftId" TEXT;`,
    `ALTER TABLE ${q("ClientGoodsRequest")} ADD COLUMN IF NOT EXISTS "creditPaidPlanned" DECIMAL(65,30) NOT NULL DEFAULT 0;`,
    `ALTER TABLE ${q("ClientGoodsRequest")} ADD COLUMN IF NOT EXISTS "debitPlanned" DECIMAL(65,30) NOT NULL DEFAULT 0;`,
    `ALTER TABLE ${q("ClientGoodsRequest")} ADD COLUMN IF NOT EXISTS "approvedByUserId" TEXT;`,
    `ALTER TABLE ${q("ClientGoodsRequest")} ADD COLUMN IF NOT EXISTS "approvedByName" TEXT;`,
    `ALTER TABLE ${q("ClientGoodsRequest")} ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3);`,
    `ALTER TABLE ${q("ClientGoodsRequest")} ADD COLUMN IF NOT EXISTS "reviewerRemarks" TEXT;`,
    `ALTER TABLE ${q("ClientGoodsRequest")} ADD COLUMN IF NOT EXISTS "amendmentDiffJson" TEXT NOT NULL DEFAULT '[]';`,
    `ALTER TABLE ${q("ClientGoodsRequest")} ADD COLUMN IF NOT EXISTS "beforeSnapshotJson" TEXT;`,
    `ALTER TABLE ${q("ClientGoodsRequest")} ADD COLUMN IF NOT EXISTS "afterSnapshotJson" TEXT;`,
    `ALTER TABLE ${q("ClientGoodsRequest")} ADD COLUMN IF NOT EXISTS "revisionNumber" INTEGER NOT NULL DEFAULT 1;`,
    `ALTER TABLE ${q("ClientGoodsRequest")} ADD COLUMN IF NOT EXISTS "returnedToClientAt" TIMESTAMP(3);`,
    `ALTER TABLE ${q("ClientGoodsRequest")} ADD COLUMN IF NOT EXISTS "returnedByUserId" TEXT;`,
    `ALTER TABLE ${q("ClientGoodsRequest")} ADD COLUMN IF NOT EXISTS "returnedByName" TEXT;`,
    `ALTER TABLE ${q("ClientGoodsRequest")} ADD COLUMN IF NOT EXISTS "clientResponseStatus" TEXT;`,
    `ALTER TABLE ${q("ClientGoodsRequest")} ADD COLUMN IF NOT EXISTS "clientResponseNote" TEXT;`,
    `ALTER TABLE ${q("ClientGoodsRequest")} ADD COLUMN IF NOT EXISTS "clientRespondedAt" TIMESTAMP(3);`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "ClientGoodsRequest_requestNumber_key" ON ${q("ClientGoodsRequest")}("requestNumber");`,
    `CREATE INDEX IF NOT EXISTS "ClientGoodsRequest_clientAccountId_createdAt_idx" ON ${q("ClientGoodsRequest")}("clientAccountId", "createdAt");`,
    `CREATE INDEX IF NOT EXISTS "ClientGoodsRequest_customerId_status_idx" ON ${q("ClientGoodsRequest")}("customerId", "status");`,
    `CREATE INDEX IF NOT EXISTS "ClientGoodsRequest_status_createdAt_idx" ON ${q("ClientGoodsRequest")}("status", "createdAt");`,
    `CREATE INDEX IF NOT EXISTS "ClientGoodsRequest_linkedSalesRecordId_idx" ON ${q("ClientGoodsRequest")}("linkedSalesRecordId");`,
    `CREATE TABLE IF NOT EXISTS ${q("ClientGoodsRequestLine")} (
      "id" TEXT NOT NULL PRIMARY KEY,
      "requestId" TEXT NOT NULL,
      "lineOrder" INTEGER NOT NULL DEFAULT 1,
      "itemId" TEXT,
      "itemTitle" TEXT NOT NULL,
      "requestedQty" DECIMAL(65,30) NOT NULL,
      "confirmedQty" DECIMAL(65,30),
      "unitCode" TEXT NOT NULL DEFAULT 'QAT_BUNCH',
      "unitLabel" TEXT NOT NULL DEFAULT 'علاقية قات',
      "customUnitLabel" TEXT,
      "unitPrice" DECIMAL(65,30) NOT NULL DEFAULT 0,
      "lineTotal" DECIMAL(65,30) NOT NULL DEFAULT 0,
      "notes" TEXT,
      CONSTRAINT "ClientGoodsRequestLine_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES ${q("ClientGoodsRequest")}("id") ON DELETE CASCADE ON UPDATE CASCADE
    );`,
    `CREATE INDEX IF NOT EXISTS "ClientGoodsRequestLine_requestId_idx" ON ${q("ClientGoodsRequestLine")}("requestId");`,
    `CREATE TABLE IF NOT EXISTS ${q("WhatsAppOutboxMessage")} (
      "id" TEXT NOT NULL PRIMARY KEY,
      "draftNumber" TEXT NOT NULL,
      "eventType" TEXT NOT NULL,
      "clientAccountId" TEXT,
      "customerId" TEXT,
      "requestId" TEXT,
      "recipientName" TEXT NOT NULL,
      "recipientPhone" TEXT NOT NULL,
      "templateKey" TEXT,
      "originalMessageText" TEXT NOT NULL,
      "finalMessageText" TEXT NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
      "dispatchChannel" TEXT NOT NULL DEFAULT 'WHATSAPP_LINK',
      "approvedByUserId" TEXT,
      "approvedByName" TEXT,
      "approvedAt" TIMESTAMP(3),
      "sentAt" TIMESTAMP(3),
      "skippedReason" TEXT,
      "providerResponseJson" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "WhatsAppOutboxMessage_draftNumber_key" ON ${q("WhatsAppOutboxMessage")}("draftNumber");`,
    `CREATE INDEX IF NOT EXISTS "WhatsAppOutboxMessage_status_createdAt_idx" ON ${q("WhatsAppOutboxMessage")}("status", "createdAt");`,
    `CREATE INDEX IF NOT EXISTS "WhatsAppOutboxMessage_clientAccountId_createdAt_idx" ON ${q("WhatsAppOutboxMessage")}("clientAccountId", "createdAt");`,
    `CREATE INDEX IF NOT EXISTS "WhatsAppOutboxMessage_customerId_createdAt_idx" ON ${q("WhatsAppOutboxMessage")}("customerId", "createdAt");`,
    `CREATE TABLE IF NOT EXISTS ${q("TenantIntegrationSetting")} (
      "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'whatsapp',
      "provider" TEXT NOT NULL DEFAULT 'WHATSAPP_WEB_LINK',
      "gatewayUrl" TEXT,
      "credentialsEnc" TEXT,
      "senderPhone" TEXT,
      "defaultCountryCode" TEXT NOT NULL DEFAULT '967',
      "autoDraftEventsJson" TEXT NOT NULL DEFAULT '{}',
      "templatesJson" TEXT NOT NULL DEFAULT '{}',
      "configJson" TEXT NOT NULL DEFAULT '{}',
      "isActive" BOOLEAN NOT NULL DEFAULT true,
      "updatedById" TEXT,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );`,
    `CREATE TABLE IF NOT EXISTS ${q("PortalCatalogBoardItem")} (
      "id" TEXT NOT NULL PRIMARY KEY,
      "inventoryItemId" TEXT,
      "sku" TEXT,
      "titleAr" TEXT NOT NULL,
      "titleEn" TEXT,
      "gradeLabel" TEXT NOT NULL DEFAULT 'درجة أولى',
      "categoryLabel" TEXT NOT NULL DEFAULT 'أصناف عامة',
      "unitCode" TEXT NOT NULL DEFAULT 'QAT_BUNCH',
      "unitLabel" TEXT NOT NULL DEFAULT 'علاقية قات',
      "customUnitLabel" TEXT,
      "unitPrice" DECIMAL(65,30) NOT NULL DEFAULT 0,
      "currency" TEXT NOT NULL DEFAULT 'YER',
      "availabilityStatus" TEXT NOT NULL DEFAULT 'AVAILABLE',
      "pickupLocation" TEXT,
      "freshnessLabel" TEXT NOT NULL DEFAULT 'قائمة أسعار اليوم',
      "effectiveDate" TEXT,
      "validityNote" TEXT,
      "displayOrder" INTEGER NOT NULL DEFAULT 1,
      "isPublished" BOOLEAN NOT NULL DEFAULT false,
      "publishedAt" TIMESTAMP(3),
      "publishedById" TEXT,
      "publishedByName" TEXT,
      "notes" TEXT,
      "createdById" TEXT,
      "createdByName" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );`,
    `CREATE INDEX IF NOT EXISTS "PortalCatalogBoardItem_isPublished_displayOrder_idx" ON ${q("PortalCatalogBoardItem")}("isPublished", "displayOrder");`,
    `CREATE INDEX IF NOT EXISTS "PortalCatalogBoardItem_gradeLabel_availabilityStatus_idx" ON ${q("PortalCatalogBoardItem")}("gradeLabel", "availabilityStatus");`,
  ];
}

/**
 * Ensures newly onboarded tenants automatically inherit default portal form settings
 * when no row exists yet, without overwriting customized tenant configurations.
 */
export async function ensureDefaultPortalSettingsRow(
  client: {
    tenantIntegrationSetting: {
      findUnique: typeof prisma.tenantIntegrationSetting.findUnique;
      create: typeof prisma.tenantIntegrationSetting.create;
    };
  } = prisma
): Promise<void> {
  try {
    const existing = await client.tenantIntegrationSetting.findUnique({
      where: { id: PORTAL_FORM_SETTING_ID },
      select: { id: true },
    });
    if (!existing) {
      await client.tenantIntegrationSetting.create({
        data: {
          id: PORTAL_FORM_SETTING_ID,
          provider: "PORTAL_FORM_CONFIG",
          configJson: JSON.stringify(DEFAULT_TENANT_FORM_CONFIG),
          isActive: DEFAULT_TENANT_FORM_CONFIG.portalEnabled,
        },
      });
    }
  } catch {
    // Non-fatal in case of concurrent insert race
  }
}

/**
 * Ensures Phase 9–14 Client Portal, Pricing Board, Amendments & WhatsApp Outbox tables exist
 * idempotently on both SQLite and PostgreSQL runtimes (including `"default"` and newly added tenants).
 */
export async function ensurePortalSchemaReady(): Promise<void> {
  if (isSqliteRuntime()) {
    await ensureSqliteDatabaseReady();
    return;
  }

  const tid = getActiveTenantId();
  if (ensuredTenantIds.has(tid)) return;

  const ddlStatements = buildPostgresPortalDdlStatements();
  for (const sql of ddlStatements) {
    try {
      await prisma.$executeRawUnsafe(sql);
    } catch {
      // Idempotent DDL guard
    }
  }
  await ensureDefaultPortalSettingsRow(prisma);
  ensuredTenantIds.add(tid);
}
