import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { appendAuditLogTx, hashPassword } from "@/lib/serverBootstrap";
import {
  canonicalizeLicensePayload,
  validateLicenseStructure,
  type RuntimeMode,
  type UasLicensePayload,
} from "@/lib/licensing/licenseSchema";
import {
  hasLicensePrivateKey,
  signLicensePayload,
  writeSignedTenantLicenseArtifacts,
} from "@/lib/licensing/licenseSigner";
import { resolveLicenseDataDirectory } from "@/lib/licensing/verifier";
import {
  issueSuperadminTenantLicense,
  listSuperadminTenantLicenses,
  STRICT_TENANT_SLUG_REGEX,
  SuperadminValidationError,
  VALID_LICENSE_PLANS,
  type IssuedSuperadminLicense,
  type SuperadminActor,
  type SuperadminLicensePlan,
  type SuperadminTenantLicenseRow,
} from "@/lib/licensing/superadminLicenseService";
import {
  buildTenantWorkspaceUrl,
  ensureRegistryInitialized,
  findTenantBySlug,
  getTenantMetadata,
  normalizeTenantId,
  resetRegistryForTests,
  runWithTenant,
  updateTenantMetadata,
  validateTenantSlug,
  type TenantMetadata,
} from "@/lib/tenant";
import {
  appendControlPanelAudit,
  clearUserSignInBlock,
  evaluateLicenseGovernance,
  getTenantGovernanceRecord,
  getUserSessionRevocation,
  listControlPanelAudits,
  listRotatedLicenseKeys,
  recordRotatedLicenseKey,
  recordUserSessionRevocation,
  setTenantGovernanceRecord,
  type ControlPanelAuditEntry,
  type LicenseGovernanceStatus,
  type RotatedKeyRecord,
} from "./governanceStore";

export class ControlPanelError extends Error {
  status: number;
  code: string;
  constructor(message: string, code = "CONTROL_PANEL_ERROR", status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export interface ControlPanelTenantSummary extends SuperadminTenantLicenseRow {
  effectiveStatus: LicenseGovernanceStatus;
  governanceReason: string | null;
  rotatedKeysCount: number;
  deviceCount: number;
  activeDeviceCount: number;
  userCount: number;
  activeUserCount: number;
  allowedModes: RuntimeMode[];
}

export interface ControlPanelDeviceView {
  id: string;
  deviceId: string;
  source: "tenant_device" | "seat_binding" | "both";
  platform: string;
  appVersion: string;
  osVersion: string;
  deviceLabel: string;
  userId: string | null;
  userEmail: string | null;
  userDisplay: string | null;
  lastSeenAt: string;
  ipAddress: string | null;
  status: string;
  syncMode: string;
  pendingCommand: string | null;
  seatActive: boolean | null;
}

export interface ControlPanelUserView {
  id: string;
  username: string;
  name: string;
  fullName: string;
  displayName: string;
  email: string;
  role: string;
  department: string;
  active: boolean;
  isActive: boolean;
  archivedAt: string | null;
  lastLoginAt: string | null;
  mustChangePassword: boolean;
  sessionRevokedAt: string | null;
  signInBlocked: boolean;
  boundDevices: Array<{
    deviceId: string;
    platform: string;
    label: string;
    status: string;
    lastSeenAt: string;
  }>;
}

const PLAN_DEFAULTS: Record<
  SuperadminLicensePlan,
  { users: number; branches: number; seats: number }
> = {
  enterprise: { users: 7, branches: 3, seats: 10 },
  pro: { users: 5, branches: 2, seats: 7 },
  starter: { users: 2, branches: 1, seats: 3 },
};

function normalizeCleanSlug(rawSlug: string): string {
  const slug = String(rawSlug || "").trim().toLowerCase();
  if (!slug || !STRICT_TENANT_SLUG_REGEX.test(slug) || !validateTenantSlug(slug).valid) {
    throw new ControlPanelError(
      "معرف المنشأة غير صالح / Invalid tenant slug",
      "INVALID_SLUG",
      400
    );
  }
  return slug;
}

function resolveExistingTenant(rawSlug: string): { slug: string; meta: TenantMetadata } {
  const slug = normalizeCleanSlug(rawSlug);
  resetRegistryForTests();
  ensureRegistryInitialized();
  const meta = findTenantBySlug(slug) || getTenantMetadata(slug);
  if (!meta || meta.tenantId === "default") {
    throw new ControlPanelError(
      `المنشأة غير موجودة (${slug}) / Tenant not found`,
      "TENANT_NOT_FOUND",
      404
    );
  }
  return { slug, meta };
}

function readInstalledTenantUasPayload(slug: string) {
  const dataDir = resolveLicenseDataDirectory();
  const candidates = [
    path.join(/*turbopackIgnore: true*/ dataDir, "licenses", slug, `${slug}.uas`),
    path.join(/*turbopackIgnore: true*/ dataDir, "licenses", slug, "license.uas"),
  ];
  for (const filePath of candidates) {
    try {
      if (fs.existsSync(/*turbopackIgnore: true*/ filePath)) {
        const parsed = JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ filePath, "utf8"));
        const valid = validateLicenseStructure(parsed);
        if (valid) return valid;
      }
    } catch {
      // try next
    }
  }
  return null;
}

function generateDistinctLicenseId(previousId?: string | null): string {
  const prev = (previousId || "").trim().toUpperCase();
  for (let i = 0; i < 10; i++) {
    const candidate = `UAS-2026-${Math.floor(1000 + Math.random() * 9000)}`;
    if (candidate !== prev) return candidate;
  }
  return `UAS-2026-${crypto.randomBytes(2).toString("hex").toUpperCase()}`;
}

function generateTemporaryPassword(): string {
  const token = crypto.randomBytes(6).toString("base64url").replace(/[^a-zA-Z0-9]/g, "");
  return `Tmp@${token.slice(0, 8)}!9`;
}

function computeEffectiveStatus(
  row: SuperadminTenantLicenseRow,
  meta: TenantMetadata | null
): { effectiveStatus: LicenseGovernanceStatus; reason: string | null } {
  const gov = evaluateLicenseGovernance({
    licenseId: row.licenseId,
    slug: row.slug,
    registryStatus: meta?.status || row.status,
    expiresAt: row.expiresAt,
  });
  const mapStatus: Record<string, LicenseGovernanceStatus> = {
    ACTIVE: "active",
    SUSPENDED: "suspended",
    REVOKED: "revoked",
    EXPIRED: "expired",
  };
  return {
    effectiveStatus: mapStatus[gov.status] || "active",
    reason: gov.record?.reason || null,
  };
}

async function getTenantCountsSafe(tenantId: string): Promise<{
  deviceCount: number;
  activeDeviceCount: number;
  userCount: number;
  activeUserCount: number;
}> {
  try {
    return await runWithTenant(tenantId, async () => {
      const [devices, bindings, users] = await Promise.all([
        prisma.tenantDevice.findMany({ select: { status: true } }),
        prisma.licenseDeviceBinding.findMany({ where: { active: true }, select: { id: true } }),
        prisma.user.findMany({
          where: { archivedAt: null },
          select: { active: true, isActive: true },
        }),
      ]);
      const activeDevices = devices.filter((d) => d.status === "ACTIVE").length;
      const totalDevices = Math.max(devices.length, bindings.length);
      const activeTotalDevices = Math.max(activeDevices, bindings.length);
      const activeUsers = users.filter((u) => u.active && u.isActive).length;
      return {
        deviceCount: totalDevices,
        activeDeviceCount: activeTotalDevices,
        userCount: users.length,
        activeUserCount: activeUsers,
      };
    });
  } catch {
    return { deviceCount: 0, activeDeviceCount: 0, userCount: 0, activeUserCount: 0 };
  }
}

export async function listControlPanelTenants(filters?: {
  search?: string;
  status?: string;
  plan?: string;
}): Promise<ControlPanelTenantSummary[]> {
  const baseRows = listSuperadminTenantLicenses();
  const summaries = await Promise.all(
    baseRows.map(async (row) => {
      const meta = findTenantBySlug(row.slug) || getTenantMetadata(row.tenantId);
      const { effectiveStatus, reason } = computeEffectiveStatus(row, meta);
      const gov = getTenantGovernanceRecord(row.slug);
      const rotated = listRotatedLicenseKeys(row.slug);
      const counts = await getTenantCountsSafe(row.tenantId);
      const allowedModes: RuntimeMode[] =
        Array.isArray(meta?.allowedModes) && meta.allowedModes.length > 0
          ? meta.allowedModes
          : ["local", "lan", "cloud"];

      return {
        ...row,
        plan: gov?.planOverride || row.plan,
        maxSeats: gov?.maxSeatsOverride ?? row.maxSeats,
        expiresAt: gov?.expiresAtOverride ?? row.expiresAt,
        effectiveStatus,
        governanceReason: reason,
        rotatedKeysCount: rotated.length,
        allowedModes,
        ...counts,
      };
    })
  );

  let filtered = summaries;
  if (filters?.status && filters.status !== "all") {
    const target = filters.status.trim().toLowerCase();
    filtered = filtered.filter((t) => t.effectiveStatus === target);
  }
  if (filters?.plan && filters.plan !== "all") {
    const targetPlan = filters.plan.trim().toLowerCase();
    filtered = filtered.filter((t) => t.plan.toLowerCase() === targetPlan);
  }
  if (filters?.search && filters.search.trim()) {
    const q = filters.search.trim().toLowerCase();
    filtered = filtered.filter(
      (t) =>
        t.slug.toLowerCase().includes(q) ||
        t.companyName.toLowerCase().includes(q) ||
        (t.adminEmail || "").toLowerCase().includes(q) ||
        (t.licenseId || "").toLowerCase().includes(q)
    );
  }

  return filtered;
}

export async function issueControlPanelTenantLicense(
  rawInput: Record<string, unknown>,
  actor: SuperadminActor
): Promise<IssuedSuperadminLicense> {
  try {
    const issued = await issueSuperadminTenantLicense(rawInput);
    setTenantGovernanceRecord(issued.slug, {
      status: "active",
      licenseId: issued.licenseId,
      updatedBy: actor.email,
      reason: "Initial license issuance",
    });
    appendControlPanelAudit({
      actorEmail: actor.email,
      actorRole: actor.role,
      actionType: "ISSUE_LICENSE",
      targetTenantSlug: issued.slug,
      targetEntityType: "LICENSE",
      targetEntityId: issued.licenseId,
      details: `Issued ${issued.plan} license (${issued.licenseId}) for ${issued.companyName} (${issued.slug}.qat.world)`,
      metadata: { plan: issued.plan, expiresAt: issued.expiresAt },
    });
    return issued;
  } catch (err) {
    if (err instanceof SuperadminValidationError) {
      throw new ControlPanelError(err.message, err.code, err.status);
    }
    throw err;
  }
}

export async function listTenantDevicesForControlPanel(rawSlug: string): Promise<{
  devices: ControlPanelDeviceView[];
  seatBindings: Array<{
    id: string;
    licenseId: string;
    userEmail: string;
    platform: string;
    hwid: string;
    deviceName: string;
    activatedAt: string;
    lastSeenAt: string;
    active: boolean;
  }>;
}> {
  const { meta } = resolveExistingTenant(rawSlug);
  return runWithTenant(meta.tenantId, async () => {
    const [tenantDevices, bindings] = await Promise.all([
      prisma.tenantDevice.findMany({ orderBy: { lastSeenAt: "desc" } }),
      prisma.licenseDeviceBinding.findMany({ orderBy: { lastSeenAt: "desc" } }),
    ]);

    const bindingByHwid = new Map<string, (typeof bindings)[number]>();
    for (const b of bindings) {
      bindingByHwid.set(b.hwid.trim().toUpperCase(), b);
    }

    const seenDeviceIds = new Set<string>();
    const merged: ControlPanelDeviceView[] = tenantDevices.map((d) => {
      const upperId = d.deviceId.trim().toUpperCase();
      seenDeviceIds.add(upperId);
      const seatMatch =
        bindingByHwid.get(upperId) ||
        bindings.find(
          (b) =>
            d.userEmail &&
            b.userEmail.toLowerCase() === d.userEmail.toLowerCase() &&
            b.platform.toLowerCase() === d.platform.toLowerCase()
        );
      return {
        id: d.id,
        deviceId: d.deviceId,
        source: seatMatch ? "both" : "tenant_device",
        platform: d.platform,
        appVersion: d.appVersion,
        osVersion: d.osVersion,
        deviceLabel: d.deviceLabel,
        userId: d.userId,
        userEmail: d.userEmail || seatMatch?.userEmail || null,
        userDisplay: d.userDisplay,
        lastSeenAt: d.lastSeenAt.toISOString(),
        ipAddress: d.ipAddress,
        status: d.status,
        syncMode: d.syncMode,
        pendingCommand: d.pendingCommand,
        seatActive: seatMatch ? seatMatch.active : null,
      };
    });

    for (const b of bindings) {
      const upperHwid = b.hwid.trim().toUpperCase();
      if (seenDeviceIds.has(upperHwid)) continue;
      merged.push({
        id: b.id,
        deviceId: b.hwid,
        source: "seat_binding",
        platform: b.platform,
        appVersion: "—",
        osVersion: "—",
        deviceLabel: b.deviceName || `${b.platform.toUpperCase()} Seat`,
        userId: null,
        userEmail: b.userEmail,
        userDisplay: null,
        lastSeenAt: b.lastSeenAt.toISOString(),
        ipAddress: null,
        status: b.active ? "ACTIVE" : "REVOKED",
        syncMode: "AUTO",
        pendingCommand: null,
        seatActive: b.active,
      });
    }

    return {
      devices: merged,
      seatBindings: bindings.map((b) => ({
        id: b.id,
        licenseId: b.licenseId,
        userEmail: b.userEmail,
        platform: b.platform,
        hwid: b.hwid,
        deviceName: b.deviceName,
        activatedAt: b.activatedAt.toISOString(),
        lastSeenAt: b.lastSeenAt.toISOString(),
        active: b.active,
      })),
    };
  });
}

export async function listTenantUsersForControlPanel(rawSlug: string): Promise<ControlPanelUserView[]> {
  const { meta } = resolveExistingTenant(rawSlug);
  const normTenant = normalizeTenantId(meta.tenantId);

  return runWithTenant(meta.tenantId, async () => {
    const [users, devices, bindings] = await Promise.all([
      prisma.user.findMany({ orderBy: { createdAt: "asc" } }),
      prisma.tenantDevice.findMany({ orderBy: { lastSeenAt: "desc" } }),
      prisma.licenseDeviceBinding.findMany({ where: { active: true } }),
    ]);

    return users.map((u) => {
      const emailLower = (u.email || "").trim().toLowerCase();
      const revocation = getUserSessionRevocation(normTenant, u.id);
      const userDevices = devices.filter(
        (d) =>
          d.userId === u.id ||
          (emailLower && d.userEmail && d.userEmail.trim().toLowerCase() === emailLower)
      );
      const boundDevices = userDevices.map((d) => ({
        deviceId: d.deviceId,
        platform: d.platform,
        label: d.deviceLabel || `${d.platform} device`,
        status: d.status,
        lastSeenAt: d.lastSeenAt.toISOString(),
      }));

      for (const b of bindings) {
        if (b.userEmail.trim().toLowerCase() === emailLower) {
          const already = boundDevices.some(
            (bd) => bd.deviceId.toUpperCase() === b.hwid.trim().toUpperCase()
          );
          if (!already) {
            boundDevices.push({
              deviceId: b.hwid,
              platform: b.platform,
              label: b.deviceName || `${b.platform} seat`,
              status: b.active ? "ACTIVE" : "REVOKED",
              lastSeenAt: b.lastSeenAt.toISOString(),
            });
          }
        }
      }

      const isActiveFlag = Boolean(u.active && u.isActive && !u.archivedAt);
      return {
        id: u.id,
        username: u.username,
        name: u.name,
        fullName: u.fullName,
        displayName: u.displayName || "",
        email: u.email,
        role: u.role,
        department: u.department,
        active: isActiveFlag,
        isActive: isActiveFlag,
        archivedAt: u.archivedAt ? u.archivedAt.toISOString() : null,
        lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
        mustChangePassword: Boolean(u.mustChangePassword),
        sessionRevokedAt: revocation
          ? new Date(revocation.revokedBeforeMs).toISOString()
          : null,
        signInBlocked: Boolean(revocation?.blockSignIn || !isActiveFlag),
        boundDevices,
      };
    });
  });
}

export async function getControlPanelTenantDetail(rawSlug: string): Promise<{
  tenant: ControlPanelTenantSummary;
  devices: ControlPanelDeviceView[];
  seatBindings: Awaited<ReturnType<typeof listTenantDevicesForControlPanel>>["seatBindings"];
  users: ControlPanelUserView[];
  rotatedKeys: RotatedKeyRecord[];
  auditLogs: ControlPanelAuditEntry[];
}> {
  const { slug } = resolveExistingTenant(rawSlug);
  const allTenants = await listControlPanelTenants();
  const tenant = allTenants.find((t) => t.slug === slug);
  if (!tenant) {
    throw new ControlPanelError(`Tenant not found (${slug})`, "TENANT_NOT_FOUND", 404);
  }
  const [devData, users] = await Promise.all([
    listTenantDevicesForControlPanel(slug),
    listTenantUsersForControlPanel(slug),
  ]);
  return {
    tenant,
    devices: devData.devices,
    seatBindings: devData.seatBindings,
    users,
    rotatedKeys: listRotatedLicenseKeys(slug),
    auditLogs: listControlPanelAudits({ slug, limit: 100 }),
  };
}

export async function rotateControlPanelTenantLicense(
  rawSlug: string,
  body: Record<string, unknown>,
  actor: SuperadminActor
): Promise<{
  license: IssuedSuperadminLicense;
  priorLicenseId: string | null;
  immediatelyRevoked: boolean;
  graceUntil: string | null;
}> {
  const { slug, meta } = resolveExistingTenant(rawSlug);
  if (!hasLicensePrivateKey()) {
    throw new ControlPanelError(
      "مفتاح التوقيع الخاص Ed25519 غير موجود على الخادم / Ed25519 private key missing on server",
      "PRIVATE_KEY_MISSING",
      500
    );
  }

  const currentLic = readInstalledTenantUasPayload(slug);
  const priorLicenseId = currentLic?.license_id || meta.licenseId || null;

  const rawPlan =
    typeof body.plan === "string" && body.plan.trim()
      ? body.plan.trim().toLowerCase()
      : meta.plan || "enterprise";
  if (!VALID_LICENSE_PLANS.has(rawPlan as SuperadminLicensePlan)) {
    throw new ControlPanelError("خطة الترخيص غير صالحة / Invalid plan", "INVALID_PLAN", 400);
  }
  const plan = rawPlan as SuperadminLicensePlan;
  const planDef = PLAN_DEFAULTS[plan];

  const maxUsers =
    body.maxSeats !== undefined || body.maxUsers !== undefined
      ? Math.max(1, Math.min(10000, Math.round(Number(body.maxSeats ?? body.maxUsers))))
      : currentLic?.max_users ?? meta.maxSeats ?? planDef.users;

  const maxBranches =
    body.maxBranches !== undefined
      ? Math.max(1, Math.min(1000, Math.round(Number(body.maxBranches))))
      : currentLic?.max_branches ?? planDef.branches;

  const maxLanSeats =
    body.maxLanSeats !== undefined
      ? Math.max(1, Math.min(10000, Math.round(Number(body.maxLanSeats))))
      : currentLic?.max_lan_seats ?? Math.max(planDef.seats, maxUsers);

  const rawExpiresAt =
    typeof body.expiresAt === "string" && body.expiresAt.trim()
      ? body.expiresAt.trim()
      : currentLic?.expires_at || "2027-12-31";
  const parsedExpiry = new Date(rawExpiresAt);
  if (Number.isNaN(parsedExpiry.getTime()) || parsedExpiry.getTime() <= Date.now()) {
    throw new ControlPanelError(
      "تاريخ الانتهاء يجب أن يكون في المستقبل / expiresAt must be a valid future date",
      "INVALID_EXPIRY",
      400
    );
  }

  const allowedModesRaw = Array.isArray(body.allowedModes)
    ? body.allowedModes.map((m) => String(m).trim().toLowerCase()).filter((m): m is RuntimeMode =>
        ["local", "lan", "cloud"].includes(m)
      )
    : currentLic?.allowed_modes || meta.allowedModes || ["local", "lan", "cloud"];
  const allowedModes: RuntimeMode[] =
    allowedModesRaw.length > 0 ? Array.from(new Set(allowedModesRaw)).sort() : ["local", "lan", "cloud"];

  const newLicenseId = generateDistinctLicenseId(priorLicenseId);
  const nowIso = new Date().toISOString();
  const workspaceUrl = meta.tenantUrl || buildTenantWorkspaceUrl(slug);
  const companyName = meta.companyName || currentLic?.company_name || slug;
  const nameAr = meta.nameAr || currentLic?.name_ar || companyName;
  const nameEn = meta.nameEn || currentLic?.name_en || companyName;

  const revokePriorKeyImmediately = body.revokePriorKeyImmediately !== false;
  const graceHours = Number(body.graceHours ?? 0);
  const graceUntil =
    !revokePriorKeyImmediately && Number.isFinite(graceHours) && graceHours > 0
      ? new Date(Date.now() + graceHours * 3600_000).toISOString()
      : null;

  let newAdminCreds: UasLicensePayload["admin_credentials"] | undefined = undefined;
  let adminEmailDisplay = currentLic?.admin_credentials?.email || `admin@${slug}.qat.world`;
  let adminUsernameDisplay = currentLic?.admin_credentials?.username || "admin";
  let resetPasswordPlain = "";

  if (body.resetAdminPassword === true) {
    resetPasswordPlain = generateTemporaryPassword();
    newAdminCreds = {
      email: adminEmailDisplay,
      username: adminUsernameDisplay,
      password: resetPasswordPlain,
      tenant_url: workspaceUrl,
    };
  } else if (currentLic?.admin_credentials) {
    newAdminCreds = currentLic.admin_credentials;
    resetPasswordPlain = currentLic.admin_credentials.password;
  }

  const payload: UasLicensePayload = {
    license_id: newLicenseId,
    customer_name: companyName,
    company_name: companyName,
    name_ar: nameAr,
    name_en: nameEn,
    tenant_slug: slug,
    tenant_url: workspaceUrl,
    ...(newAdminCreds ? { admin_credentials: newAdminCreds } : {}),
    hwid: currentLic?.hwid || "*",
    allowed_modes: allowedModes,
    max_branches: maxBranches,
    max_lan_seats: maxLanSeats,
    max_users: maxUsers,
    per_user_devices: currentLic?.per_user_devices || { windows: 1, android: 1 },
    expires_at: parsedExpiry.toISOString(),
    issued_at: nowIso,
  };

  // Validate canonical structure & sign with Ed25519
  canonicalizeLicensePayload(payload);
  const signedLicense = signLicensePayload(payload);
  const { uasPath, txtPath, uaskey } = writeSignedTenantLicenseArtifacts({
    slug,
    signedLicense,
    adminPasswordPlain: resetPasswordPlain || null,
  });

  if (priorLicenseId) {
    recordRotatedLicenseKey({
      licenseId: priorLicenseId,
      slug,
      rotatedAt: nowIso,
      graceUntil,
      immediatelyRevoked: revokePriorKeyImmediately || !graceUntil,
      replacedByLicenseId: newLicenseId,
      actorEmail: actor.email,
      reason: typeof body.reason === "string" ? body.reason.trim() : undefined,
    });
  }

  updateTenantMetadata(slug, {
    licenseId: newLicenseId,
    plan,
    maxSeats: maxUsers,
    allowedModes,
    status: "ACTIVE",
  });

  setTenantGovernanceRecord(slug, {
    status: "active",
    licenseId: newLicenseId,
    expiresAtOverride: null,
    maxSeatsOverride: null,
    planOverride: null,
    reason: typeof body.reason === "string" ? body.reason.trim() : "Key rotated by platform owner",
    updatedBy: actor.email,
  });

  // Update tenant DB LicenseState (+ optional admin password reset)
  try {
    await runWithTenant(meta.tenantId, async () => {
      await prisma.$transaction(async (tx) => {
        await tx.licenseState.upsert({
          where: { id: "active" },
          update: {
            licenseId: newLicenseId,
            customerName: companyName,
            hwidHash: signedLicense.hwid,
            lastVerifiedUtc: new Date(),
            status: "ACTIVE",
            licenseDataJson: JSON.stringify(signedLicense),
          },
          create: {
            id: "active",
            licenseId: newLicenseId,
            customerName: companyName,
            hwidHash: signedLicense.hwid,
            lastVerifiedUtc: new Date(),
            status: "ACTIVE",
            seatRegistryJson: "[]",
            licenseDataJson: JSON.stringify(signedLicense),
          },
        });

        if (body.resetAdminPassword === true && resetPasswordPlain) {
          const targetAdmin = await tx.user.findFirst({
            where: {
              OR: [
                { email: adminEmailDisplay },
                { username: adminUsernameDisplay },
                { role: "SUPER_ADMIN" },
              ],
            },
          });
          if (targetAdmin) {
            await tx.user.update({
              where: { id: targetAdmin.id },
              data: {
                passwordHash: hashPassword(resetPasswordPlain),
                passwordUpdatedAt: new Date(),
                mustChangePassword: true,
              },
            });
            adminEmailDisplay = targetAdmin.email;
            adminUsernameDisplay = targetAdmin.username;
          }
        }

        await appendAuditLogTx(tx, {
          userId: actor.id,
          userDisplay: `${actor.name} (PLATFORM_OWNER)`,
          userRole: "SUPER_ADMIN",
          actionType: "تدوير وإعادة توليد مفتاح الترخيص (Key Rotation)",
          entityReference: `License:${newLicenseId}`,
          details: `تم إصدار مفتاح ترخيص جديد (${newLicenseId}) بدلاً من (${priorLicenseId || "—"}) — ${
            revokePriorKeyImmediately || !graceUntil
              ? "إلغاء فوري للمفتاح السابق"
              : `فترة سماح حتى ${graceUntil}`
          }`,
        });
      });
    });
  } catch (err) {
    console.warn("[ControlPanel] Notice updating tenant DB on rotation:", err);
  }

  appendControlPanelAudit({
    actorEmail: actor.email,
    actorRole: actor.role,
    actionType: "ROTATE_LICENSE_KEY",
    targetTenantSlug: slug,
    targetEntityType: "LICENSE",
    targetEntityId: newLicenseId,
    details: `Rotated license key from ${priorLicenseId || "NONE"} to ${newLicenseId} (${
      revokePriorKeyImmediately || !graceUntil
        ? "immediate prior-key revocation"
        : `grace until ${graceUntil}`
    })`,
    metadata: {
      priorLicenseId,
      newLicenseId,
      plan,
      maxUsers,
      expiresAt: parsedExpiry.toISOString(),
      immediatelyRevoked: revokePriorKeyImmediately || !graceUntil,
      graceUntil,
    },
  });

  return {
    license: {
      licenseId: newLicenseId,
      slug,
      companyName,
      nameAr,
      nameEn,
      workspaceUrl,
      plan,
      adminEmail: adminEmailDisplay,
      adminUsername: adminUsernameDisplay,
      adminPassword: resetPasswordPlain,
      uaskey,
      expiresAt: parsedExpiry.toISOString(),
      issuedAt: nowIso,
      hasUasFile: fs.existsSync(/*turbopackIgnore: true*/ uasPath),
      hasTxtFile: fs.existsSync(/*turbopackIgnore: true*/ txtPath),
    },
    priorLicenseId,
    immediatelyRevoked: revokePriorKeyImmediately || !graceUntil,
    graceUntil,
  };
}

export async function updateControlPanelTenantLifecycle(
  rawSlug: string,
  body: Record<string, unknown>,
  actor: SuperadminActor
): Promise<{ tenant: ControlPanelTenantSummary }> {
  const { slug, meta } = resolveExistingTenant(rawSlug);
  const action = String(body.action || "update_config").trim().toLowerCase();
  const reason = typeof body.reason === "string" ? body.reason.trim() : undefined;

  const currentLic = readInstalledTenantUasPayload(slug);
  let targetGovStatus: LicenseGovernanceStatus =
    getTenantGovernanceRecord(slug)?.status ||
    (meta.status === "SUSPENDED"
      ? "suspended"
      : meta.status === "REVOKED" || meta.status === "ARCHIVED"
      ? "revoked"
      : meta.status === "EXPIRED"
      ? "expired"
      : "active");
  let targetRegStatus: TenantMetadata["status"] = meta.status;
  let dbLicStatus = "ACTIVE";

  if (action === "suspend") {
    targetGovStatus = "suspended";
    targetRegStatus = "SUSPENDED";
    dbLicStatus = "SUSPENDED";
  } else if (action === "reactivate" || action === "activate") {
    targetGovStatus = "active";
    targetRegStatus = "ACTIVE";
    dbLicStatus = "ACTIVE";
  } else if (action === "revoke") {
    targetGovStatus = "revoked";
    targetRegStatus = "REVOKED";
    dbLicStatus = "REVOKED";
  } else if (action === "expire") {
    targetGovStatus = "expired";
    targetRegStatus = "EXPIRED";
    dbLicStatus = "EXPIRED";
  } else if (action !== "update_config") {
    throw new ControlPanelError(
      `إجراء غير مدعوم (${action}) / Unsupported tenant action`,
      "INVALID_ACTION",
      400
    );
  }

  let nextPlan = meta.plan || "enterprise";
  if (typeof body.plan === "string" && body.plan.trim()) {
    const cleanPlan = body.plan.trim().toLowerCase();
    if (!VALID_LICENSE_PLANS.has(cleanPlan as SuperadminLicensePlan)) {
      throw new ControlPanelError("خطة غير صالحة / Invalid plan", "INVALID_PLAN", 400);
    }
    nextPlan = cleanPlan;
  }

  let nextMaxSeats = meta.maxSeats ?? currentLic?.max_users ?? 7;
  if (body.maxSeats !== undefined || body.maxUsers !== undefined) {
    const parsedSeats = Math.round(Number(body.maxSeats ?? body.maxUsers));
    if (!Number.isFinite(parsedSeats) || parsedSeats < 1 || parsedSeats > 10000) {
      throw new ControlPanelError("عدد المقاعد غير صالح / Invalid seat quota (1-10000)", "INVALID_SEATS", 400);
    }
    nextMaxSeats = parsedSeats;
  } else if (typeof body.plan === "string" && body.plan.trim() && body.maxSeats === undefined) {
    nextMaxSeats = PLAN_DEFAULTS[nextPlan as SuperadminLicensePlan].users;
  }

  let nextExpiresAt = currentLic?.expires_at || null;
  if (typeof body.expiresAt === "string" && body.expiresAt.trim()) {
    const d = new Date(body.expiresAt.trim());
    if (Number.isNaN(d.getTime())) {
      throw new ControlPanelError("تاريخ الانتهاء غير صالح / Invalid expiresAt date", "INVALID_EXPIRY", 400);
    }
    nextExpiresAt = d.toISOString();
    if (action === "reactivate" && d.getTime() <= Date.now()) {
      throw new ControlPanelError(
        "لا يمكن إعادة التفعيل بتاريخ انتهاء منقضٍ / Cannot reactivate with a past expiration date",
        "INVALID_EXPIRY",
        400
      );
    }
  }

  const nextAllowedModes: RuntimeMode[] | undefined = Array.isArray(body.allowedModes)
    ? Array.from(
        new Set(
          body.allowedModes
            .map((m) => String(m).trim().toLowerCase())
            .filter((m): m is RuntimeMode => ["local", "lan", "cloud"].includes(m))
        )
      )
    : undefined;

  updateTenantMetadata(slug, {
    status: targetRegStatus,
    plan: nextPlan,
    maxSeats: nextMaxSeats,
    ...(nextAllowedModes && nextAllowedModes.length > 0 ? { allowedModes: nextAllowedModes } : {}),
  });

  setTenantGovernanceRecord(slug, {
    status: targetGovStatus,
    licenseId: currentLic?.license_id || meta.licenseId || null,
    reason,
    planOverride: nextPlan,
    maxSeatsOverride: nextMaxSeats,
    ...(nextExpiresAt ? { expiresAtOverride: nextExpiresAt } : {}),
    updatedBy: actor.email,
  });

  // Re-sign .uas artifact if config changed and private key is available
  const configModified =
    body.plan !== undefined ||
    body.maxSeats !== undefined ||
    body.maxUsers !== undefined ||
    body.expiresAt !== undefined ||
    body.allowedModes !== undefined;

  let reSignedLicenseJson: string | null = null;
  if (configModified && currentLic && hasLicensePrivateKey() && body.resign !== false) {
    const updatedPayload: UasLicensePayload = {
      ...currentLic,
      max_users: nextMaxSeats,
      max_branches: PLAN_DEFAULTS[nextPlan as SuperadminLicensePlan]?.branches ?? currentLic.max_branches,
      max_lan_seats: Math.max(
        nextMaxSeats,
        PLAN_DEFAULTS[nextPlan as SuperadminLicensePlan]?.seats ?? currentLic.max_lan_seats
      ),
      expires_at: nextExpiresAt || currentLic.expires_at,
      allowed_modes:
        nextAllowedModes && nextAllowedModes.length > 0
          ? [...nextAllowedModes].sort()
          : currentLic.allowed_modes,
    };
    const signed = signLicensePayload(updatedPayload);
    writeSignedTenantLicenseArtifacts({ slug, signedLicense: signed });
    reSignedLicenseJson = JSON.stringify(signed);
  }

  try {
    await runWithTenant(meta.tenantId, async () => {
      await prisma.$transaction(async (tx) => {
        const existingState = await tx.licenseState.findUnique({ where: { id: "active" } });
        if (existingState) {
          await tx.licenseState.update({
            where: { id: "active" },
            data: {
              status: dbLicStatus,
              ...(reSignedLicenseJson ? { licenseDataJson: reSignedLicenseJson } : {}),
            },
          });
        }
        if (action === "revoke") {
          await tx.tenantDevice.updateMany({
            where: { status: { not: "REVOKED" } },
            data: {
              pendingCommand: "WIPE_CREDENTIALS",
              pendingCommandAt: new Date(),
            },
          });
        }
        await appendAuditLogTx(tx, {
          userId: actor.id,
          userDisplay: `${actor.name} (PLATFORM_OWNER)`,
          userRole: "SUPER_ADMIN",
          actionType: `حوكمة ترخيص المنشأة (${action.toUpperCase()})`,
          entityReference: `Tenant:${slug}`,
          details: `Status=${targetGovStatus}, Plan=${nextPlan}, MaxSeats=${nextMaxSeats}${
            reason ? `, Reason=${reason}` : ""
          }`,
        });
      });
    });
  } catch (err) {
    console.warn("[ControlPanel] Tenant DB lifecycle update warning:", err);
  }

  appendControlPanelAudit({
    actorEmail: actor.email,
    actorRole: actor.role,
    actionType: `TENANT_${action.toUpperCase()}`,
    targetTenantSlug: slug,
    targetEntityType: "TENANT",
    targetEntityId: slug,
    details: `Tenant ${slug}: action=${action}, status=${targetGovStatus}, plan=${nextPlan}, maxSeats=${nextMaxSeats}${
      reason ? ` (${reason})` : ""
    }`,
    metadata: {
      action,
      status: targetGovStatus,
      plan: nextPlan,
      maxSeats: nextMaxSeats,
      expiresAt: nextExpiresAt,
      reason,
    },
  });

  const updatedList = await listControlPanelTenants();
  const tenant = updatedList.find((t) => t.slug === slug);
  if (!tenant) {
    throw new ControlPanelError(`Tenant not found (${slug})`, "TENANT_NOT_FOUND", 404);
  }
  return { tenant };
}

export async function controlTenantDeviceFromPanel(
  rawSlug: string,
  rawDeviceId: string,
  body: Record<string, unknown>,
  actor: SuperadminActor
): Promise<{
  devices: ControlPanelDeviceView[];
  action: string;
}> {
  const { slug, meta } = resolveExistingTenant(rawSlug);
  const deviceId = decodeURIComponent(rawDeviceId).trim();
  if (!deviceId) {
    throw new ControlPanelError("deviceId is required", "INVALID_DEVICE_ID", 400);
  }
  const action = String(body.action || "").trim().toLowerCase();
  if (!["approve", "trust", "suspend", "block", "revoke", "unbind", "reset", "re-enroll"].includes(action)) {
    throw new ControlPanelError(
      "إجراء الجهاز غير صالح (approve | suspend | revoke | reset) / Invalid device action",
      "INVALID_ACTION",
      400
    );
  }
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";

  await runWithTenant(meta.tenantId, async () => {
    await prisma.$transaction(async (tx) => {
      const existingDevice = await tx.tenantDevice.findUnique({ where: { deviceId } });
      const matchingBindings = await tx.licenseDeviceBinding.findMany({
        where: {
          OR: [
            { hwid: deviceId },
            { hwid: deviceId.toUpperCase() },
            ...(existingDevice?.userEmail
              ? [
                  {
                    userEmail: existingDevice.userEmail.trim().toLowerCase(),
                    platform: existingDevice.platform.toLowerCase(),
                  },
                ]
              : []),
          ],
        },
      });

      if (!existingDevice && matchingBindings.length === 0) {
        throw new ControlPanelError("الجهاز غير موجود لهذه المنشأة / Device not found", "DEVICE_NOT_FOUND", 404);
      }

      const now = new Date();

      if (action === "approve" || action === "trust") {
        if (existingDevice) {
          await tx.tenantDevice.update({
            where: { deviceId },
            data: { status: "ACTIVE", pendingCommand: null },
          });
        }
        if (matchingBindings.length > 0) {
          await tx.licenseDeviceBinding.updateMany({
            where: { id: { in: matchingBindings.map((b) => b.id) } },
            data: { active: true, lastSeenAt: now },
          });
        }
      } else if (action === "suspend" || action === "block") {
        if (existingDevice) {
          await tx.tenantDevice.update({
            where: { deviceId },
            data: { status: "SUSPENDED" },
          });
        }
      } else if (action === "revoke" || action === "unbind") {
        if (existingDevice) {
          await tx.tenantDevice.update({
            where: { deviceId },
            data: {
              status: "REVOKED",
              pendingCommand: "WIPE_CREDENTIALS",
              pendingCommandAt: now,
            },
          });
        }
        if (matchingBindings.length > 0) {
          await tx.licenseDeviceBinding.updateMany({
            where: { id: { in: matchingBindings.map((b) => b.id) } },
            data: { active: false },
          });
        }
      } else if (action === "reset" || action === "re-enroll") {
        if (matchingBindings.length > 0) {
          await tx.licenseDeviceBinding.updateMany({
            where: { id: { in: matchingBindings.map((b) => b.id) } },
            data: { active: false },
          });
        }
        if (existingDevice) {
          if (body.removeRecord === true) {
            await tx.tenantDevice.delete({ where: { deviceId } });
          } else {
            await tx.tenantDevice.update({
              where: { deviceId },
              data: {
                status: "ACTIVE",
                lastCursor: 0,
                pendingQueueCount: 0,
                lastSyncError: null,
                pendingCommand: "FORCE_FULL_RESYNC",
                pendingCommandAt: now,
                ...(body.unbind === true ? { userId: null, userEmail: null, userDisplay: null } : {}),
              },
            });
          }
        }
      }

      await appendAuditLogTx(tx, {
        userId: actor.id,
        userDisplay: `${actor.name} (PLATFORM_OWNER)`,
        userRole: "SUPER_ADMIN",
        actionType: `إدارة جهاز من لوحة المنصة (${action.toUpperCase()})`,
        entityReference: `TenantDevice:${deviceId}`,
        details: `Action=${action} on device ${deviceId}${reason ? ` — ${reason}` : ""}`,
      });
    });
  });

  appendControlPanelAudit({
    actorEmail: actor.email,
    actorRole: actor.role,
    actionType: `DEVICE_${action.toUpperCase()}`,
    targetTenantSlug: slug,
    targetEntityType: "DEVICE",
    targetEntityId: deviceId,
    details: `Device ${deviceId} (${slug}): ${action}${reason ? ` — ${reason}` : ""}`,
    metadata: { action, reason },
  });

  const devData = await listTenantDevicesForControlPanel(slug);
  return { devices: devData.devices, action };
}

export async function manageTenantUserFromPanel(
  rawSlug: string,
  rawUserId: string,
  body: Record<string, unknown>,
  actor: SuperadminActor
): Promise<{
  action: string;
  user: ControlPanelUserView;
  temporaryPassword?: string;
}> {
  const { slug, meta } = resolveExistingTenant(rawSlug);
  const normTenant = normalizeTenantId(meta.tenantId);
  const targetUserId = decodeURIComponent(rawUserId).trim();
  const action = String(body.action || "").trim().toLowerCase();
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";

  if (!["revoke_access", "revoke", "reactivate", "reset_password"].includes(action)) {
    throw new ControlPanelError(
      "إجراء المستخدم غير صالح (revoke_access | reactivate | reset_password) / Invalid user action",
      "INVALID_ACTION",
      400
    );
  }

  let temporaryPassword: string | undefined;

  const updatedUserId = await runWithTenant(meta.tenantId, async () => {
    return prisma.$transaction(async (tx) => {
      const existing = await tx.user.findFirst({
        where: {
          OR: [
            { id: targetUserId },
            { username: targetUserId },
            { email: targetUserId.toLowerCase() },
          ],
        },
      });
      if (!existing) {
        throw new ControlPanelError("المستخدم غير موجود / User not found", "USER_NOT_FOUND", 404);
      }

      const now = new Date();
      const emailLower = (existing.email || "").trim().toLowerCase();

      if (action === "revoke_access" || action === "revoke") {
        await tx.user.update({
          where: { id: existing.id },
          data: { active: false, isActive: false },
        });
        recordUserSessionRevocation(normTenant, existing.id, {
          revokedBeforeMs: now.getTime(),
          blockSignIn: true,
          reason: reason || "Access revoked by platform owner",
          updatedBy: actor.email,
        });

        await tx.tenantDevice.updateMany({
          where: {
            OR: [
              { userId: existing.id },
              ...(emailLower ? [{ userEmail: emailLower }] : []),
            ],
          },
          data: {
            pendingCommand: "WIPE_CREDENTIALS",
            pendingCommandAt: now,
          },
        });

        if (body.releaseSeats !== false && emailLower) {
          await tx.licenseDeviceBinding.updateMany({
            where: { userEmail: emailLower, active: true },
            data: { active: false },
          });
        }

        await appendAuditLogTx(tx, {
          userId: actor.id,
          userDisplay: `${actor.name} (PLATFORM_OWNER)`,
          userRole: "SUPER_ADMIN",
          actionType: "إلغاء صلاحية وجلسات مستخدم من لوحة المنصة",
          entityReference: `User:${existing.id}`,
          details: `تم إنهاء الجلسات وحظر تسجيل الدخول للمستخدم ${existing.email}${reason ? ` (${reason})` : ""}`,
        });
      } else if (action === "reactivate") {
        await tx.user.update({
          where: { id: existing.id },
          data: { active: true, isActive: true, archivedAt: null },
        });
        clearUserSignInBlock(normTenant, existing.id, actor.email);

        await appendAuditLogTx(tx, {
          userId: actor.id,
          userDisplay: `${actor.name} (PLATFORM_OWNER)`,
          userRole: "SUPER_ADMIN",
          actionType: "إعادة تفعيل حساب مستخدم من لوحة المنصة",
          entityReference: `User:${existing.id}`,
          details: `تمت إعادة تفعيل دخول المستخدم ${existing.email}`,
        });
      } else if (action === "reset_password") {
        const providedPass = typeof body.newPassword === "string" ? body.newPassword : "";
        if (providedPass && providedPass.length < 8) {
          throw new ControlPanelError(
            "كلمة المرور يجب أن لا تقل عن 8 أحرف / Password must be at least 8 characters",
            "WEAK_PASSWORD",
            400
          );
        }
        temporaryPassword = providedPass || generateTemporaryPassword();
        const mustChange = body.mustChangePassword !== false;

        await tx.user.update({
          where: { id: existing.id },
          data: {
            passwordHash: hashPassword(temporaryPassword),
            passwordUpdatedAt: now,
            mustChangePassword: mustChange,
          },
        });

        recordUserSessionRevocation(normTenant, existing.id, {
          revokedBeforeMs: now.getTime(),
          blockSignIn: !(existing.active && existing.isActive),
          reason: "Password reset by platform owner",
          updatedBy: actor.email,
        });

        await appendAuditLogTx(tx, {
          userId: actor.id,
          userDisplay: `${actor.name} (PLATFORM_OWNER)`,
          userRole: "SUPER_ADMIN",
          actionType: "إعادة تعيين كلمة مرور مستخدم من لوحة المنصة",
          entityReference: `User:${existing.id}`,
          details: `تم توليد كلمة مرور مؤقتة وإنهاء الجلسات السابقة للمستخدم ${existing.email}`,
        });
      }

      return existing.id;
    });
  });

  appendControlPanelAudit({
    actorEmail: actor.email,
    actorRole: actor.role,
    actionType: `USER_${action.toUpperCase()}`,
    targetTenantSlug: slug,
    targetEntityType: "USER",
    targetEntityId: updatedUserId,
    details: `User ${updatedUserId} in ${slug}: ${action}${reason ? ` (${reason})` : ""}`,
    metadata: { action, reason },
  });

  const users = await listTenantUsersForControlPanel(slug);
  const updatedUser = users.find((u) => u.id === updatedUserId);
  if (!updatedUser) {
    throw new ControlPanelError("User not found after update", "USER_NOT_FOUND", 404);
  }
  return {
    action,
    user: updatedUser,
    ...(temporaryPassword ? { temporaryPassword } : {}),
  };
}

export function listControlPanelAuditFeed(filters?: {
  slug?: string;
  entityType?: string;
  search?: string;
  limit?: number;
}): ControlPanelAuditEntry[] {
  return listControlPanelAudits(filters);
}
