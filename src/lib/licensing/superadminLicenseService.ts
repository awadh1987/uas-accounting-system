import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { NextRequest, NextResponse } from "next/server";
import { isPlatformAdminSurfaceEnabled } from "@/lib/buildTarget";
import { extractSessionTokenFromRequest } from "@/lib/authSession";
import { forbiddenError, unauthorizedError } from "@/lib/apiHelpers";
import { extractUasKeyToken, validateLicenseStructure } from "@/lib/licensing/licenseSchema";
import {
  resolveLicenseDataDirectory,
  resolveWritableProjectRoot,
} from "@/lib/licensing/verifier";
import { defaultPrisma } from "@/lib/prisma";
import {
  buildTenantWorkspaceUrl,
  ensureRegistryInitialized,
  extractSubdomainSlugFromHost,
  extractTenantResolutionFromRequest,
  getRegistryFilePath,
  listRegisteredTenants,
  normalizeTenantId,
  resetRegistryForTests,
  validateTenantSlug,
} from "@/lib/tenant";

const execFileAsync = promisify(execFile);

export type SuperadminLicensePlan = "enterprise" | "pro" | "starter";

export const VALID_LICENSE_PLANS = new Set<SuperadminLicensePlan>([
  "enterprise",
  "pro",
  "starter",
]);

export const STRICT_TENANT_SLUG_REGEX = /^[a-z0-9-]{3,32}$/;

export interface SuperadminActor {
  id: string;
  username: string;
  email: string;
  name: string;
  role: string;
}

export interface IssuedSuperadminLicense {
  licenseId: string;
  slug: string;
  companyName: string;
  nameAr: string;
  nameEn: string;
  workspaceUrl: string;
  plan: SuperadminLicensePlan;
  adminEmail: string;
  adminUsername: string;
  adminPassword: string;
  uaskey: string;
  expiresAt: string;
  issuedAt: string;
  hasUasFile: boolean;
  hasTxtFile: boolean;
}

export interface SuperadminTenantLicenseRow {
  slug: string;
  tenantId: string;
  companyName: string;
  nameAr: string;
  nameEn: string;
  workspaceUrl: string;
  plan: string;
  licenseId: string | null;
  expiresAt: string | null;
  issuedAt: string | null;
  adminEmail: string | null;
  adminUsername: string | null;
  uaskey: string | null;
  maxSeats: number;
  status: string;
  hasUasFile: boolean;
  hasTxtFile: boolean;
  createdAt: string;
  updatedAt: string;
}

function getRequestSubdomain(req: NextRequest): string | null {
  const forwardedHost = req.headers.get("x-forwarded-host");
  const hostHeader = req.headers.get("host");
  let urlHost = "";
  try {
    urlHost = new URL(req.url, "http://localhost").host;
  } catch {
    urlHost = "";
  }
  return (
    extractSubdomainSlugFromHost(forwardedHost) ||
    extractSubdomainSlugFromHost(hostHeader) ||
    extractSubdomainSlugFromHost(urlHost)
  );
}

/**
 * Strictly authorizes root-platform (`qat.world` / non-tenant) superadmin requests.
 * Rejects tenant subdomains (`*.qat.world`), tenant-scoped sessions/headers,
 * unauthenticated requests (`401`), and non-owner accounts (`403`).
 */
export async function requireSuperadminRootAuth(
  req: NextRequest
): Promise<{ ok: true; actor: SuperadminActor } | { ok: false; response: NextResponse }> {
  if (!isPlatformAdminSurfaceEnabled()) {
    return {
      ok: false,
      response: forbiddenError(
        "⛔ لوحة تحكم المنصة ومولد التراخيص غير متاحين في نسخ التطبيق المستقلة / Platform control panel and license generator are excluded from standalone/mobile builds"
      ),
    };
  }

  const subdomain = getRequestSubdomain(req);
  if (subdomain) {
    return {
      ok: false,
      response: forbiddenError(
        "⛔ هذا القسم متاح من المنصة الرئيسية (qat.world) فقط ولا يُسمح به من نطاقات المنشآت / Restricted to root platform (qat.world)"
      ),
    };
  }

  const resolution = extractTenantResolutionFromRequest(req);
  if (resolution.tenantId !== "default") {
    return {
      ok: false,
      response: forbiddenError(
        "⛔ هذا القسم محصور بمساحة المنصة الرئيسية / Restricted to root platform workspace"
      ),
    };
  }

  const session = extractSessionTokenFromRequest(req);
  if (!session.payload) {
    return {
      ok: false,
      response: unauthorizedError(
        "غير مصرح: يرجى تسجيل الدخول بحساب مالك المنصة / Authentication required"
      ),
    };
  }

  if (normalizeTenantId(session.payload.tid) !== "default") {
    return {
      ok: false,
      response: forbiddenError(
        "⛔ جلسات المنشآت الفرعية غير مخولة للوصول لإدارة التراخيص / Tenant session cannot access platform superadmin APIs"
      ),
    };
  }

  const dbUser = await defaultPrisma.user.findFirst({
    where: {
      OR: [{ id: session.payload.uid }, { username: session.payload.uid }],
    },
    select: {
      id: true,
      username: true,
      email: true,
      name: true,
      displayName: true,
      role: true,
      active: true,
      isActive: true,
      archivedAt: true,
    },
  });

  if (!dbUser) {
    return {
      ok: false,
      response: unauthorizedError(
        "غير مصرح: الحساب غير موجود / Authenticated user not found"
      ),
    };
  }

  if (dbUser.active === false || dbUser.isActive === false || Boolean(dbUser.archivedAt)) {
    return {
      ok: false,
      response: forbiddenError("🔒 الحساب موقوف أو مؤرشف / Account is suspended or archived"),
    };
  }

  const email = String(dbUser.email || "").trim().toLowerCase();
  const rawRole = String(dbUser.role || "").trim().toUpperCase();
  const isOwner =
    rawRole === "OWNER" || (rawRole === "SUPER_ADMIN" && email === "admin@qat.world");

  if (!isOwner) {
    return {
      ok: false,
      response: forbiddenError(
        "⛔ الوصول محصور بمالك المنصة (admin@qat.world) / Access restricted to platform owner (admin@qat.world)"
      ),
    };
  }

  return {
    ok: true,
    actor: {
      id: dbUser.id,
      username: dbUser.username,
      email,
      name: dbUser.displayName || dbUser.name,
      role: rawRole,
    },
  };
}

function readTxtMetadata(txtPath: string): {
  uaskey: string | null;
  adminEmail: string | null;
  adminUsername: string | null;
  adminPassword: string | null;
} {
  if (!fs.existsSync(/*turbopackIgnore: true*/ txtPath)) {
    return { uaskey: null, adminEmail: null, adminUsername: null, adminPassword: null };
  }
  try {
    const raw = fs.readFileSync(/*turbopackIgnore: true*/ txtPath, "utf8");
    const uaskey = extractUasKeyToken(raw);
    const emailMatch = raw.match(/^\s*Admin Email\s*:\s*(.+)$/im);
    const userMatch = raw.match(/^\s*Admin Username\s*:\s*(.+)$/im);
    const passMatch = raw.match(/^\s*Admin Password\s*:\s*(.+)$/im);
    return {
      uaskey,
      adminEmail: emailMatch?.[1]?.trim() || null,
      adminUsername: userMatch?.[1]?.trim() || null,
      adminPassword: passMatch?.[1]?.trim() || null,
    };
  } catch {
    return { uaskey: null, adminEmail: null, adminUsername: null, adminPassword: null };
  }
}

function readUasFileMetadata(uasPath: string) {
  if (!fs.existsSync(/*turbopackIgnore: true*/ uasPath)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(/*turbopackIgnore: true*/ uasPath, "utf8");
    const parsed = JSON.parse(raw);
    const valid = validateLicenseStructure(parsed);
    if (!valid) return null;
    const token = `UASKEY-${Buffer.from(JSON.stringify(valid), "utf8").toString("base64")}`;
    return { license: valid, uaskey: token };
  } catch {
    return null;
  }
}

function inferPlanFromSeatCount(maxUsers?: number | null): SuperadminLicensePlan {
  if (typeof maxUsers === "number" && maxUsers > 0) {
    if (maxUsers <= 2) return "starter";
    if (maxUsers <= 5) return "pro";
  }
  return "enterprise";
}

/**
 * Lists all provisioned tenants from `tenants_registry.json` enriched with
 * license metadata and file presence flags from `data/licenses/<slug>/`.
 */
export function listSuperadminTenantLicenses(): SuperadminTenantLicenseRow[] {
  resetRegistryForTests();
  ensureRegistryInitialized();

  const dataDir = resolveLicenseDataDirectory();
  const rows: SuperadminTenantLicenseRow[] = [];

  for (const meta of listRegisteredTenants()) {
    const slug = (meta.slug || meta.tenantId || "").trim().toLowerCase();
    if (!slug || slug === "default" || meta.tenantId === "default") {
      continue;
    }

    const licDir = path.join(/*turbopackIgnore: true*/ dataDir, "licenses", slug);
    const slugUasPath = path.join(/*turbopackIgnore: true*/ licDir, `${slug}.uas`);
    const fallbackUasPath = path.join(/*turbopackIgnore: true*/ licDir, "license.uas");
    const slugTxtPath = path.join(/*turbopackIgnore: true*/ licDir, `${slug}.uaskey.txt`);
    const fallbackTxtPath = path.join(/*turbopackIgnore: true*/ licDir, "license.uaskey.txt");

    const hasUasFile = fs.existsSync(/*turbopackIgnore: true*/ slugUasPath);
    const hasTxtFile = fs.existsSync(/*turbopackIgnore: true*/ slugTxtPath);

    const uasInfo =
      readUasFileMetadata(slugUasPath) || readUasFileMetadata(fallbackUasPath);
    const txtInfo = readTxtMetadata(
      hasTxtFile ? slugTxtPath : fallbackTxtPath
    );

    const lic = uasInfo?.license;
    const plan =
      meta.plan && VALID_LICENSE_PLANS.has(meta.plan as SuperadminLicensePlan)
        ? meta.plan
        : inferPlanFromSeatCount(lic?.max_users ?? meta.maxSeats);

    rows.push({
      slug,
      tenantId: meta.tenantId,
      companyName: meta.companyName || lic?.company_name || slug,
      nameAr: meta.nameAr || lic?.name_ar || meta.companyName || slug,
      nameEn: meta.nameEn || lic?.name_en || meta.companyName || slug,
      workspaceUrl: meta.tenantUrl || lic?.tenant_url || buildTenantWorkspaceUrl(slug),
      plan,
      licenseId: lic?.license_id || meta.licenseId || null,
      expiresAt: lic?.expires_at || null,
      issuedAt: lic?.issued_at || null,
      adminEmail: lic?.admin_credentials?.email || txtInfo.adminEmail || null,
      adminUsername: lic?.admin_credentials?.username || txtInfo.adminUsername || null,
      uaskey: txtInfo.uaskey || uasInfo?.uaskey || null,
      maxSeats: lic?.max_users ?? meta.maxSeats ?? 7,
      status: meta.status || "ACTIVE",
      hasUasFile,
      hasTxtFile,
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
    });
  }

  rows.sort((a, b) => {
    const ta = Date.parse(b.updatedAt || b.createdAt || "") || 0;
    const tb = Date.parse(a.updatedAt || a.createdAt || "") || 0;
    return ta - tb;
  });

  return rows;
}

export class SuperadminValidationError extends Error {
  status: number;
  code: string;
  constructor(message: string, code = "VALIDATION_ERROR", status = 400) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function cleanupStrayRootLicenseFiles(projectRoot: string): void {
  const candidates = [
    path.join(/*turbopackIgnore: true*/ projectRoot, "license.uas"),
    path.join(/*turbopackIgnore: true*/ projectRoot, "license.uaskey.txt"),
    path.join(/*turbopackIgnore: true*/ projectRoot, ".next", "standalone", "license.uas"),
    path.join(/*turbopackIgnore: true*/ projectRoot, ".next", "standalone", "license.uaskey.txt"),
  ];
  for (const filePath of candidates) {
    try {
      if (fs.existsSync(/*turbopackIgnore: true*/ filePath)) {
        fs.unlinkSync(/*turbopackIgnore: true*/ filePath);
      }
    } catch {
      // Non-fatal cleanup
    }
  }
}

function mirrorArtifactsToStandalone(projectRoot: string, slug: string): void {
  if ((process.env.UAS_DATA_DIR || "").trim()) {
    return;
  }
  const standaloneDir = path.join(/*turbopackIgnore: true*/ projectRoot, ".next", "standalone");
  if (!fs.existsSync(/*turbopackIgnore: true*/ standaloneDir)) {
    return;
  }

  const srcLicDir = path.join(/*turbopackIgnore: true*/ projectRoot, "data", "licenses", slug);
  const dstLicDir = path.join(/*turbopackIgnore: true*/ standaloneDir, "data", "licenses", slug);
  if (fs.existsSync(/*turbopackIgnore: true*/ srcLicDir)) {
    fs.mkdirSync(/*turbopackIgnore: true*/ dstLicDir, { recursive: true });
    for (const fileName of ["license.uas", `${slug}.uas`, `${slug}.uaskey.txt`]) {
      const srcFile = path.join(/*turbopackIgnore: true*/ srcLicDir, fileName);
      const dstFile = path.join(/*turbopackIgnore: true*/ dstLicDir, fileName);
      if (fs.existsSync(/*turbopackIgnore: true*/ srcFile)) {
        fs.copyFileSync(/*turbopackIgnore: true*/ srcFile, /*turbopackIgnore: true*/ dstFile);
      }
    }
  }

  const srcSqlite = path.join(/*turbopackIgnore: true*/ projectRoot, "data", "tenants", `${slug}.db`);
  const dstSqlite = path.join(/*turbopackIgnore: true*/ standaloneDir, "data", "tenants", `${slug}.db`);
  if (fs.existsSync(/*turbopackIgnore: true*/ srcSqlite)) {
    fs.mkdirSync(path.dirname(/*turbopackIgnore: true*/ dstSqlite), { recursive: true });
    fs.copyFileSync(/*turbopackIgnore: true*/ srcSqlite, /*turbopackIgnore: true*/ dstSqlite);
  }

  const srcRegistry = getRegistryFilePath();
  const dstRegistry = path.join(/*turbopackIgnore: true*/ standaloneDir, "tenants_registry.json");
  if (fs.existsSync(/*turbopackIgnore: true*/ srcRegistry)) {
    fs.copyFileSync(/*turbopackIgnore: true*/ srcRegistry, /*turbopackIgnore: true*/ dstRegistry);
  }
}

/**
 * Validates issuance input, executes `scripts/licensing/issue-license.mjs` asynchronously,
 * mirrors artifacts into `.next/standalone`, cleans stray root files, and returns credentials.
 */
export async function issueSuperadminTenantLicense(rawInput: Record<string, unknown>): Promise<IssuedSuperadminLicense> {
  const slug = typeof rawInput.slug === "string" ? rawInput.slug.trim().toLowerCase() : "";
  if (!slug || !STRICT_TENANT_SLUG_REGEX.test(slug)) {
    throw new SuperadminValidationError(
      "النطاق الفرعي يجب أن يكون 3-32 حرفاً إنجليزياً صغيراً أو أرقاماً أو شرطة / Slug must match /^[a-z0-9-]{3,32}$/",
      "INVALID_SLUG"
    );
  }
  const slugValidation = validateTenantSlug(slug);
  if (!slugValidation.valid) {
    throw new SuperadminValidationError(
      slugValidation.error || "Invalid or reserved tenant slug",
      "INVALID_SLUG"
    );
  }

  const companyName =
    typeof rawInput.companyName === "string" ? rawInput.companyName.trim().replace(/\s+/g, " ") : "";
  if (!companyName || companyName.length < 2 || companyName.length > 150) {
    throw new SuperadminValidationError(
      "اسم المنشأة مطلوب (حرفان على الأقل) / Company name is required (2-150 chars)",
      "INVALID_COMPANY_NAME"
    );
  }

  const nameAr =
    typeof rawInput.nameAr === "string" && rawInput.nameAr.trim()
      ? rawInput.nameAr.trim().replace(/\s+/g, " ")
      : companyName;
  const nameEn =
    typeof rawInput.nameEn === "string" && rawInput.nameEn.trim()
      ? rawInput.nameEn.trim().replace(/\s+/g, " ")
      : companyName;

  const rawAdminEmail =
    typeof rawInput.adminEmail === "string" ? rawInput.adminEmail.trim().toLowerCase() : "";
  const adminEmail = rawAdminEmail || `admin@${slug}.qat.world`;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail) || adminEmail.length > 160) {
    throw new SuperadminValidationError(
      "صيغة البريد الإلكتروني غير صحيحة / Invalid adminEmail format",
      "INVALID_EMAIL"
    );
  }

  const rawPlan =
    typeof rawInput.plan === "string" && rawInput.plan.trim()
      ? rawInput.plan.trim().toLowerCase()
      : "enterprise";
  if (!VALID_LICENSE_PLANS.has(rawPlan as SuperadminLicensePlan)) {
    throw new SuperadminValidationError(
      "الخطة غير صالحة (enterprise, pro, starter) / Invalid plan",
      "INVALID_PLAN"
    );
  }
  const plan = rawPlan as SuperadminLicensePlan;

  const rawExpiresAt =
    typeof rawInput.expiresAt === "string" && rawInput.expiresAt.trim()
      ? rawInput.expiresAt.trim()
      : "2027-12-31";
  const parsedExpiry = new Date(rawExpiresAt);
  if (Number.isNaN(parsedExpiry.getTime()) || parsedExpiry.getTime() <= Date.now()) {
    throw new SuperadminValidationError(
      "تاريخ الانتهاء يجب أن يكون تاريخاً صحيحاً في المستقبل / expiresAt must be a valid future date",
      "INVALID_EXPIRY"
    );
  }

  const projectRoot = resolveWritableProjectRoot();
  const dataDir = resolveLicenseDataDirectory();
  const scriptPath = path.join(/*turbopackIgnore: true*/ projectRoot, "scripts", "licensing", "issue-license.mjs");
  if (!fs.existsSync(/*turbopackIgnore: true*/ scriptPath)) {
    throw new Error(`License issuer script not found at ${scriptPath}`);
  }

  const outUasPath = path.join(/*turbopackIgnore: true*/ dataDir, "licenses", slug, `${slug}.uas`);
  fs.mkdirSync(path.dirname(/*turbopackIgnore: true*/ outUasPath), { recursive: true });

  const args = [
    scriptPath,
    "--slug",
    slug,
    "--company",
    companyName,
    "--name-ar",
    nameAr,
    "--name-en",
    nameEn,
    "--admin-email",
    adminEmail,
    "--plan",
    plan,
    "--expires",
    rawExpiresAt,
    "--hwid",
    "*",
    "--modes",
    "local,lan,cloud",
    "--out",
    outUasPath,
  ];

  await execFileAsync(process.execPath, args, {
    cwd: projectRoot,
    env: { ...process.env },
    timeout: 120_000,
    maxBuffer: 4 * 1024 * 1024,
  });

  cleanupStrayRootLicenseFiles(projectRoot);
  mirrorArtifactsToStandalone(projectRoot, slug);

  // Refresh in-memory registry so the running process immediately recognizes the new subdomain
  resetRegistryForTests();
  ensureRegistryInitialized();

  const slugUasPath = path.join(/*turbopackIgnore: true*/ dataDir, "licenses", slug, `${slug}.uas`);
  const slugTxtPath = path.join(/*turbopackIgnore: true*/ dataDir, "licenses", slug, `${slug}.uaskey.txt`);
  const uasMeta = readUasFileMetadata(slugUasPath);
  const txtMeta = readTxtMetadata(slugTxtPath);

  if (!uasMeta) {
    throw new Error(`Issued license file missing or invalid at ${slugUasPath}`);
  }

  const lic = uasMeta.license;
  return {
    licenseId: lic.license_id,
    slug,
    companyName: lic.company_name || lic.customer_name || companyName,
    nameAr: lic.name_ar || nameAr,
    nameEn: lic.name_en || nameEn,
    workspaceUrl: lic.tenant_url || buildTenantWorkspaceUrl(slug),
    plan,
    adminEmail: lic.admin_credentials?.email || txtMeta.adminEmail || adminEmail,
    adminUsername: lic.admin_credentials?.username || txtMeta.adminUsername || "admin",
    adminPassword: lic.admin_credentials?.password || txtMeta.adminPassword || "",
    uaskey: txtMeta.uaskey || uasMeta.uaskey,
    expiresAt: lic.expires_at,
    issuedAt: lic.issued_at,
    hasUasFile: fs.existsSync(/*turbopackIgnore: true*/ slugUasPath),
    hasTxtFile: fs.existsSync(/*turbopackIgnore: true*/ slugTxtPath),
  };
}

/**
 * Resolves a downloadable license artifact (`.uas` or `.uaskey.txt`) with strict
 * slug validation and path traversal protection.
 */
export function resolveSafeLicenseDownloadFile(
  rawSlug: string,
  rawType: string | null
):
  | {
      ok: true;
      filePath: string;
      filename: string;
      contentType: string;
      content: Buffer;
    }
  | { ok: false; status: number; error: string } {
  const slug = String(rawSlug || "").trim().toLowerCase();
  if (!slug || !STRICT_TENANT_SLUG_REGEX.test(slug) || !validateTenantSlug(slug).valid) {
    return {
      ok: false,
      status: 400,
      error: "معرف النطاق الفرعي غير صالح / Invalid tenant slug",
    };
  }

  const type = String(rawType || "uas").trim().toLowerCase();
  if (type !== "uas" && type !== "txt") {
    return {
      ok: false,
      status: 400,
      error: "نوع الملف غير صالح (uas | txt) / Invalid file type (expected uas or txt)",
    };
  }

  const dataDir = resolveLicenseDataDirectory();
  const licensesBase = path.resolve(/*turbopackIgnore: true*/ dataDir, "licenses");
  const tenantDir = path.resolve(/*turbopackIgnore: true*/ licensesBase, slug);

  if (!tenantDir.startsWith(licensesBase + path.sep)) {
    return { ok: false, status: 400, error: "Invalid path" };
  }

  const candidates =
    type === "uas"
      ? [`${slug}.uas`, "license.uas"]
      : [`${slug}.uaskey.txt`, "license.uaskey.txt"];

  for (const name of candidates) {
    const resolved = path.resolve(/*turbopackIgnore: true*/ tenantDir, name);
    if (!resolved.startsWith(tenantDir + path.sep)) {
      return { ok: false, status: 400, error: "Invalid path" };
    }
    if (fs.existsSync(/*turbopackIgnore: true*/ resolved)) {
      const content = fs.readFileSync(/*turbopackIgnore: true*/ resolved);
      return {
        ok: true,
        filePath: resolved,
        filename: type === "uas" ? `${slug}.uas` : `${slug}.uaskey.txt`,
        contentType: type === "uas" ? "application/octet-stream" : "text/plain; charset=utf-8",
        content,
      };
    }
  }

  return {
    ok: false,
    status: 404,
    error: "ملف الترخيص غير موجود لهذه المنشأة / License file not found for this tenant",
  };
}
