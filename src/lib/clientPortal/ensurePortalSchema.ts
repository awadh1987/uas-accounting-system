import { prisma } from "@/lib/prisma";
import { ensureSqliteDatabaseReady, isSqliteRuntime } from "@/lib/sqliteBootstrap";
import { getActiveTenantId } from "@/lib/tenant/tenantContext";

const ensuredTenantIds = new Set<string>();

/**
 * Ensures Phase 9 Client Portal & WhatsApp Outbox tables exist idempotently on both
 * SQLite and PostgreSQL runtimes (including `"default"` PG database and newly added tenants).
 */
export async function ensurePortalSchemaReady(): Promise<void> {
  if (isSqliteRuntime()) {
    await ensureSqliteDatabaseReady();
    return;
  }

  const tid = getActiveTenantId();
  if (ensuredTenantIds.has(tid)) return;

  const ddlStatements = [
    `CREATE TABLE IF NOT EXISTS "ClientPortalAccount" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "customerId" TEXT,
      "fullName" TEXT NOT NULL,
      "tradeName" TEXT,
      "phone" TEXT NOT NULL,
      "email" TEXT NOT NULL,
      "passwordHash" TEXT NOT NULL,
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
    `CREATE UNIQUE INDEX IF NOT EXISTS "ClientPortalAccount_phone_key" ON "ClientPortalAccount"("phone");`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "ClientPortalAccount_email_key" ON "ClientPortalAccount"("email");`,
    `CREATE INDEX IF NOT EXISTS "ClientPortalAccount_status_createdAt_idx" ON "ClientPortalAccount"("status", "createdAt");`,
    `CREATE INDEX IF NOT EXISTS "ClientPortalAccount_customerId_idx" ON "ClientPortalAccount"("customerId");`,
    `CREATE TABLE IF NOT EXISTS "ClientGoodsRequest" (
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
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "ClientGoodsRequest_clientAccountId_fkey" FOREIGN KEY ("clientAccountId") REFERENCES "ClientPortalAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE
    );`,
    `ALTER TABLE "ClientGoodsRequest" ADD COLUMN IF NOT EXISTS "linkedSalesRecordId" TEXT;`,
    `ALTER TABLE "ClientGoodsRequest" ADD COLUMN IF NOT EXISTS "linkedDraftId" TEXT;`,
    `ALTER TABLE "ClientGoodsRequest" ADD COLUMN IF NOT EXISTS "creditPaidPlanned" DECIMAL(65,30) NOT NULL DEFAULT 0;`,
    `ALTER TABLE "ClientGoodsRequest" ADD COLUMN IF NOT EXISTS "debitPlanned" DECIMAL(65,30) NOT NULL DEFAULT 0;`,
    `ALTER TABLE "ClientGoodsRequest" ADD COLUMN IF NOT EXISTS "approvedByUserId" TEXT;`,
    `ALTER TABLE "ClientGoodsRequest" ADD COLUMN IF NOT EXISTS "approvedByName" TEXT;`,
    `ALTER TABLE "ClientGoodsRequest" ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3);`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "ClientGoodsRequest_requestNumber_key" ON "ClientGoodsRequest"("requestNumber");`,
    `CREATE INDEX IF NOT EXISTS "ClientGoodsRequest_clientAccountId_createdAt_idx" ON "ClientGoodsRequest"("clientAccountId", "createdAt");`,
    `CREATE INDEX IF NOT EXISTS "ClientGoodsRequest_customerId_status_idx" ON "ClientGoodsRequest"("customerId", "status");`,
    `CREATE INDEX IF NOT EXISTS "ClientGoodsRequest_status_createdAt_idx" ON "ClientGoodsRequest"("status", "createdAt");`,
    `CREATE INDEX IF NOT EXISTS "ClientGoodsRequest_linkedSalesRecordId_idx" ON "ClientGoodsRequest"("linkedSalesRecordId");`,
    `CREATE TABLE IF NOT EXISTS "ClientGoodsRequestLine" (
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
      CONSTRAINT "ClientGoodsRequestLine_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ClientGoodsRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE
    );`,
    `CREATE INDEX IF NOT EXISTS "ClientGoodsRequestLine_requestId_idx" ON "ClientGoodsRequestLine"("requestId");`,
    `CREATE TABLE IF NOT EXISTS "WhatsAppOutboxMessage" (
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
    `CREATE UNIQUE INDEX IF NOT EXISTS "WhatsAppOutboxMessage_draftNumber_key" ON "WhatsAppOutboxMessage"("draftNumber");`,
    `CREATE INDEX IF NOT EXISTS "WhatsAppOutboxMessage_status_createdAt_idx" ON "WhatsAppOutboxMessage"("status", "createdAt");`,
    `CREATE INDEX IF NOT EXISTS "WhatsAppOutboxMessage_clientAccountId_createdAt_idx" ON "WhatsAppOutboxMessage"("clientAccountId", "createdAt");`,
    `CREATE INDEX IF NOT EXISTS "WhatsAppOutboxMessage_customerId_createdAt_idx" ON "WhatsAppOutboxMessage"("customerId", "createdAt");`,
    `CREATE TABLE IF NOT EXISTS "TenantIntegrationSetting" (
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
  ];

  for (const ddl of ddlStatements) {
    try {
      await prisma.$executeRawUnsafe(ddl);
    } catch {
      // Idempotent DDL guard
    }
  }
  ensuredTenantIds.add(tid);
}
