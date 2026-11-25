import { defaultPrisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/serverBootstrap";
import { ensureCentralPostgresRegistryReady } from "@/lib/clientPortal/ensurePortalSchema";
import { ensureSqliteDatabaseReady, isSqliteRuntime } from "@/lib/sqliteBootstrap";
import { buildTenantWorkspaceUrl, findTenantBySlug, getTenantMetadata } from "@/lib/tenant";

export interface GlobalClientMembershipView {
  id: string;
  globalClientId: string;
  tenantSlug: string;
  tenantId: string;
  tenantName: string;
  tenantUrl: string;
  clientAccountId: string;
  customerId: string | null;
  status: string;
  creditLimit: number;
  balance: number;
  deviceLimit: number;
  updatedAt: string;
}

async function ensureCentralGlobalTablesReady(): Promise<void> {
  if (isSqliteRuntime()) {
    await ensureSqliteDatabaseReady();
  } else {
    await ensureCentralPostgresRegistryReady();
  }
}

/**
 * Links or creates a GlobalClientIdentity (single unified credential across all tenants)
 * and registers the client's Per-Tenant Membership.
 */
export async function ensureGlobalClientIdentityAndMembership(params: {
  normalizedPhone: string;
  normalizedEmail: string;
  fullName: string;
  tradeName?: string | null;
  rawPassword: string;
  passwordHash: string;
  avatarColor?: string;
  tenantSlug: string;
  tenantId: string;
  tenantName?: string | null;
  clientAccountId: string;
  customerId?: string | null;
  status: string;
  creditLimit?: number;
  balance?: number;
  deviceLimit?: number;
  skipPasswordVerification?: boolean;
}): Promise<{ globalClientId: string; reusedExistingIdentity: boolean }> {
  await ensureCentralGlobalTablesReady();

  const existingByPhone = await defaultPrisma.globalClientIdentity.findUnique({
    where: { normalizedPhone: params.normalizedPhone },
  });
  const existingByEmail = await defaultPrisma.globalClientIdentity.findUnique({
    where: { normalizedEmail: params.normalizedEmail },
  });

  if (existingByPhone && existingByEmail && existingByPhone.id !== existingByEmail.id) {
    throw new Error(
      "رقم الجوال والبريد الإلكتروني مرتبطان بهويتين موحدتين مختلفتين — يرجى استخدام نفس الجوال والبريد الموحد"
    );
  }

  let identity = existingByPhone || existingByEmail;
  let reusedExistingIdentity = false;

  if (identity) {
    reusedExistingIdentity = true;
    if (!params.skipPasswordVerification && !verifyPassword(params.rawPassword, identity.passwordHash)) {
      throw new Error(
        "رقم الجوال أو البريد الإلكتروني مسجل مسبقاً في الهوية الموحدة — يرجى إدخال كلمة المرور الموحدة الخاصة بك للانضمام لهذه المنشأة"
      );
    }
    if (
      existingByPhone &&
      !existingByEmail &&
      identity.normalizedEmail !== params.normalizedEmail
    ) {
      // Keep primary identity email or allow linking under the same global client identity
    }
    identity = await defaultPrisma.globalClientIdentity.update({
      where: { id: identity.id },
      data: {
        lastLoginAt: new Date(),
      },
    });
  } else {
    identity = await defaultPrisma.globalClientIdentity.create({
      data: {
        normalizedPhone: params.normalizedPhone,
        normalizedEmail: params.normalizedEmail,
        fullName: params.fullName,
        tradeName: params.tradeName ?? null,
        passwordHash: params.passwordHash,
        avatarColor: params.avatarColor || "#059669",
      },
    });
  }

  const meta = findTenantBySlug(params.tenantSlug) || getTenantMetadata(params.tenantId);
  const resolvedTenantName =
    params.tenantName || meta?.nameAr || meta?.companyName || params.tenantSlug;

  await defaultPrisma.globalClientMembership.upsert({
    where: {
      tenantSlug_clientAccountId: {
        tenantSlug: params.tenantSlug,
        clientAccountId: params.clientAccountId,
      },
    },
    update: {
      globalClientId: identity.id,
      tenantId: params.tenantId,
      tenantName: resolvedTenantName,
      customerId: params.customerId ?? null,
      normalizedPhone: params.normalizedPhone,
      normalizedEmail: params.normalizedEmail,
      status: params.status,
      creditLimit: params.creditLimit ?? 0,
      balance: params.balance ?? 0,
      deviceLimit: params.deviceLimit ?? 3,
      lastSyncedAt: new Date(),
    },
    create: {
      globalClientId: identity.id,
      tenantSlug: params.tenantSlug,
      tenantId: params.tenantId,
      tenantName: resolvedTenantName,
      clientAccountId: params.clientAccountId,
      customerId: params.customerId ?? null,
      normalizedPhone: params.normalizedPhone,
      normalizedEmail: params.normalizedEmail,
      status: params.status,
      creditLimit: params.creditLimit ?? 0,
      balance: params.balance ?? 0,
      deviceLimit: params.deviceLimit ?? 3,
      lastSyncedAt: new Date(),
    },
  });

  return { globalClientId: identity.id, reusedExistingIdentity };
}

export async function syncGlobalClientMembershipStatus(params: {
  globalClientId?: string | null;
  tenantSlug: string;
  tenantId: string;
  tenantName?: string | null;
  clientAccountId: string;
  customerId?: string | null;
  normalizedPhone: string;
  normalizedEmail: string;
  fullName?: string;
  status: string;
  creditLimit?: number;
  balance?: number;
  deviceLimit?: number;
}): Promise<void> {
  try {
    await ensureCentralGlobalTablesReady();
    let globalId = params.globalClientId || null;
    if (!globalId) {
      const existingIdentity = await defaultPrisma.globalClientIdentity.findFirst({
        where: {
          OR: [
            { normalizedPhone: params.normalizedPhone },
            { normalizedEmail: params.normalizedEmail },
          ],
        },
        select: { id: true },
      });
      globalId = existingIdentity?.id ?? null;
    }
    if (!globalId) return;

    const meta = findTenantBySlug(params.tenantSlug) || getTenantMetadata(params.tenantId);
    const resolvedTenantName =
      params.tenantName || meta?.nameAr || meta?.companyName || params.tenantSlug;

    await defaultPrisma.globalClientMembership.upsert({
      where: {
        tenantSlug_clientAccountId: {
          tenantSlug: params.tenantSlug,
          clientAccountId: params.clientAccountId,
        },
      },
      update: {
        globalClientId: globalId,
        tenantId: params.tenantId,
        tenantName: resolvedTenantName,
        ...(params.customerId !== undefined ? { customerId: params.customerId } : {}),
        status: params.status,
        ...(params.creditLimit !== undefined ? { creditLimit: params.creditLimit } : {}),
        ...(params.balance !== undefined ? { balance: params.balance } : {}),
        ...(params.deviceLimit !== undefined ? { deviceLimit: params.deviceLimit } : {}),
        lastSyncedAt: new Date(),
      },
      create: {
        globalClientId: globalId,
        tenantSlug: params.tenantSlug,
        tenantId: params.tenantId,
        tenantName: resolvedTenantName,
        clientAccountId: params.clientAccountId,
        customerId: params.customerId ?? null,
        normalizedPhone: params.normalizedPhone,
        normalizedEmail: params.normalizedEmail,
        status: params.status,
        creditLimit: params.creditLimit ?? 0,
        balance: params.balance ?? 0,
        deviceLimit: params.deviceLimit ?? 3,
        lastSyncedAt: new Date(),
      },
    });
  } catch {
    // Non-fatal cross-DB sync guard
  }
}

export async function syncGlobalClientPasswordHash(params: {
  globalClientId?: string | null;
  normalizedPhone: string;
  normalizedEmail: string;
  passwordHash: string;
}): Promise<void> {
  try {
    await ensureCentralGlobalTablesReady();
    const target = params.globalClientId
      ? await defaultPrisma.globalClientIdentity.findUnique({ where: { id: params.globalClientId } })
      : await defaultPrisma.globalClientIdentity.findFirst({
          where: {
            OR: [
              { normalizedPhone: params.normalizedPhone },
              { normalizedEmail: params.normalizedEmail },
            ],
          },
        });
    if (!target) return;
    await defaultPrisma.globalClientIdentity.update({
      where: { id: target.id },
      data: {
        passwordHash: params.passwordHash,
        sessionVersion: { increment: 1 },
      },
    });
  } catch {
    // Non-fatal
  }
}

export async function getGlobalClientIdentityById(globalClientId: string) {
  await ensureCentralGlobalTablesReady();
  return defaultPrisma.globalClientIdentity.findUnique({
    where: { id: globalClientId },
  });
}

export async function listClientTenantMemberships(params: {
  globalClientId?: string | null;
  normalizedPhone?: string | null;
  normalizedEmail?: string | null;
}): Promise<GlobalClientMembershipView[]> {
  await ensureCentralGlobalTablesReady();

  let globalId = params.globalClientId || null;
  if (!globalId && (params.normalizedPhone || params.normalizedEmail)) {
    const idRow = await defaultPrisma.globalClientIdentity.findFirst({
      where: {
        OR: [
          ...(params.normalizedPhone ? [{ normalizedPhone: params.normalizedPhone }] : []),
          ...(params.normalizedEmail ? [{ normalizedEmail: params.normalizedEmail }] : []),
        ],
      },
      select: { id: true },
    });
    globalId = idRow?.id ?? null;
  }

  if (!globalId) return [];

  const rows = await defaultPrisma.globalClientMembership.findMany({
    where: { globalClientId: globalId },
    orderBy: [{ updatedAt: "desc" }],
  });

  return rows.map((r) => {
    const meta = findTenantBySlug(r.tenantSlug) || getTenantMetadata(r.tenantId);
    const slug = meta?.slug || r.tenantSlug;
    return {
      id: r.id,
      globalClientId: r.globalClientId,
      tenantSlug: slug,
      tenantId: r.tenantId,
      tenantName: r.tenantName || meta?.nameAr || meta?.companyName || slug,
      tenantUrl: meta?.tenantUrl || buildTenantWorkspaceUrl(slug),
      clientAccountId: r.clientAccountId,
      customerId: r.customerId,
      status: r.status,
      creditLimit: Number(r.creditLimit || 0),
      balance: Number(r.balance || 0),
      deviceLimit: Number(r.deviceLimit || 3),
      updatedAt: r.updatedAt.toISOString(),
    };
  });
}
