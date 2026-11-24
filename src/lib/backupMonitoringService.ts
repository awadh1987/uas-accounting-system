import fs from "node:fs";
import path from "node:path";
import { prisma, defaultPrisma } from "@/lib/prisma";
import {
  formatBytes,
  getBackupsDirectory,
  getTenantBackupsDirectory,
  GFS_RETENTION_POLICY,
  createScheduledAutoBackupForActiveTenant,
  normalizeBackupTenantSlug,
  pruneTenantBackups,
  type PruneTenantBackupsResult,
} from "@/lib/backupService";
import { resolveEffectiveDiskThresholdPercent } from "@/lib/accountingSettings";
import { emitNotification } from "@/lib/notifications/notificationService";
import { appendAuditLogTx } from "@/lib/serverBootstrap";
import { isSqliteRuntime } from "@/lib/sqliteBootstrap";
import { getActiveTenantId, runWithTenant } from "@/lib/tenant/tenantContext";
import { isPostgresRuntime } from "@/lib/tenant/tenantDbManager";
import {
  listRegisteredTenants,
  type TenantMetadata,
} from "@/lib/tenant/tenantRegistry";

export const DEFAULT_ALERT_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6 hours

export interface DiskMountStats {
  path: string;
  totalBytes: number;
  freeBytes: number;
  availBytes: number;
  usedBytes: number;
  usagePercent: number;
  totalFormatted: string;
  usedFormatted: string;
  availFormatted: string;
}

export interface DiskUsageSnapshot {
  checkedAt: string;
  primaryPath: string;
  usagePercent: number;
  totalBytes: number;
  usedBytes: number;
  availBytes: number;
  totalFormatted: string;
  usedFormatted: string;
  availFormatted: string;
  mounts: DiskMountStats[];
}

export interface BackupMonitoringAlertRecord {
  id: string;
  timestamp: string;
  dedupKey: string;
  kind: "BACKUP_FAILED" | "DISK_THRESHOLD_EXCEEDED";
  tenantSlug: string;
  severity: "CRITICAL" | "WARNING";
  titleAr: string;
  titleEn: string;
  messageAr: string;
  messageEn: string;
  diskUsagePercent?: number;
  thresholdPercent?: number;
  webhookDispatched: boolean;
}

export interface ScheduledBackupTenantResult {
  tenantId: string;
  tenantSlug: string;
  engine: "postgresql" | "sqlite";
  ok: boolean;
  ranAt: string;
  filename?: string;
  sha256?: string;
  sizeBytes?: number;
  thresholdPercent: number;
  diskUsagePercent: number;
  diskExceeded: boolean;
  pruned?: PruneTenantBackupsResult;
  alertSent?: boolean;
  alertSuppressedByCooldown?: boolean;
  error?: string;
}

export interface ScheduledBackupRunSummary {
  ok: boolean;
  ranAt: string;
  status: "SUCCESS" | "PARTIAL_FAILURE" | "FAILED";
  tenantsProcessed: number;
  succeededCount: number;
  failedCount: number;
  disk: DiskUsageSnapshot;
  alertsTriggered: BackupMonitoringAlertRecord[];
  tenantResults: ScheduledBackupTenantResult[];
}

export interface BackupAlertsState {
  version: 1;
  lastScheduledRun: ScheduledBackupRunSummary | null;
  lastTenantRuns: Record<string, ScheduledBackupTenantResult>;
  cooldowns: Record<string, string>;
  recentAlerts: BackupMonitoringAlertRecord[];
}

function getAppRootDir(): string {
  const cwd = process.cwd();
  const normalized = cwd.replace(/\\/g, "/").replace(/\/+$/, "");
  if (normalized.endsWith("/.next/standalone")) {
    return path.resolve(/*turbopackIgnore: true*/ cwd, "..", "..");
  }
  return cwd;
}

export function getBackupAlertsStateFilePath(): string {
  const explicitDir = (process.env.UAS_DATA_DIR || "").trim();
  const dataDir = explicitDir
    ? path.resolve(/*turbopackIgnore: true*/ explicitDir)
    : path.join(/*turbopackIgnore: true*/ getAppRootDir(), "data");
  return path.resolve(/*turbopackIgnore: true*/ dataDir, "backup-alerts-state.json");
}

export function loadBackupAlertsState(): BackupAlertsState {
  const filePath = getBackupAlertsStateFilePath();
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<BackupAlertsState>;
      return {
        version: 1,
        lastScheduledRun: parsed.lastScheduledRun ?? null,
        lastTenantRuns:
          parsed.lastTenantRuns && typeof parsed.lastTenantRuns === "object"
            ? parsed.lastTenantRuns
            : {},
        cooldowns:
          parsed.cooldowns && typeof parsed.cooldowns === "object" ? parsed.cooldowns : {},
        recentAlerts: Array.isArray(parsed.recentAlerts) ? parsed.recentAlerts : [],
      };
    }
  } catch {
    // Fallback to empty state
  }
  return {
    version: 1,
    lastScheduledRun: null,
    lastTenantRuns: {},
    cooldowns: {},
    recentAlerts: [],
  };
}

export function saveBackupAlertsState(state: BackupAlertsState): void {
  const filePath = getBackupAlertsStateFilePath();
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const trimmed: BackupAlertsState = {
    version: 1,
    lastScheduledRun: state.lastScheduledRun,
    lastTenantRuns: state.lastTenantRuns || {},
    cooldowns: state.cooldowns || {},
    recentAlerts: (state.recentAlerts || []).slice(0, 100),
  };
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(trimmed, null, 2), "utf8");
  fs.renameSync(tmpPath, filePath);
}

export function inspectDiskUsage(targetPaths?: string[]): DiskUsageSnapshot {
  const appRoot = getAppRootDir();
  const backupsDir = getBackupsDirectory();
  const candidates = targetPaths && targetPaths.length > 0
    ? targetPaths
    : [backupsDir, appRoot, "/var/backups/uas"];

  const mounts: DiskMountStats[] = [];
  const seenKeys = new Set<string>();

  for (const candidate of candidates) {
    if (!candidate) continue;
    let probePath = path.resolve(candidate);
    while (!fs.existsSync(probePath)) {
      const parent = path.dirname(probePath);
      if (parent === probePath) break;
      probePath = parent;
    }
    if (!fs.existsSync(probePath)) continue;

    try {
      const stat = fs.statfsSync(probePath);
      const bsize = Number(stat.bsize) || 4096;
      const totalBytes = Number(stat.blocks) * bsize;
      const freeBytes = Number(stat.bfree) * bsize;
      const availBytes = Number(stat.bavail) * bsize;
      const usedBytes = Math.max(0, totalBytes - freeBytes);
      const effectiveTotal = usedBytes + availBytes;
      const usagePercent =
        effectiveTotal > 0
          ? Math.min(100, Math.round((usedBytes / effectiveTotal) * 1000) / 10)
          : 0;
      const dedup = `${totalBytes}:${availBytes}`;
      if (seenKeys.has(dedup)) continue;
      seenKeys.add(dedup);

      mounts.push({
        path: probePath,
        totalBytes,
        freeBytes,
        availBytes,
        usedBytes,
        usagePercent,
        totalFormatted: formatBytes(totalBytes),
        usedFormatted: formatBytes(usedBytes),
        availFormatted: formatBytes(availBytes),
      });
    } catch {
      // Ignore unmounted or permission-restricted candidate paths
    }
  }

  const primary =
    mounts.slice().sort((a, b) => b.usagePercent - a.usagePercent)[0] ?? {
      path: backupsDir,
      totalBytes: 0,
      freeBytes: 0,
      availBytes: 0,
      usedBytes: 0,
      usagePercent: 0,
      totalFormatted: "0 B",
      usedFormatted: "0 B",
      availFormatted: "0 B",
    };

  return {
    checkedAt: new Date().toISOString(),
    primaryPath: primary.path,
    usagePercent: primary.usagePercent,
    totalBytes: primary.totalBytes,
    usedBytes: primary.usedBytes,
    availBytes: primary.availBytes,
    totalFormatted: primary.totalFormatted,
    usedFormatted: primary.usedFormatted,
    availFormatted: primary.availFormatted,
    mounts,
  };
}

export function computeDirectorySizeBytes(dirPath: string): number {
  if (!dirPath || !fs.existsSync(dirPath)) return 0;
  let total = 0;
  const stack = [dirPath];
  let visited = 0;
  while (stack.length > 0 && visited < 20000) {
    const current = stack.pop()!;
    visited++;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      try {
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) {
          stack.push(full);
        } else if (entry.isFile()) {
          total += fs.statSync(full).size;
        }
      } catch {
        // Skip unreadable entry
      }
    }
  }
  return total;
}

async function sendOptionalEnvWebhooks(record: BackupMonitoringAlertRecord): Promise<boolean> {
  let delivered = false;
  const webhookUrl = (process.env.UAS_ALERT_WEBHOOK_URL || "").trim();
  if (webhookUrl) {
    try {
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(record),
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) delivered = true;
    } catch {
      // Non-fatal webhook delivery failure
    }
  }

  const emailWebhookUrl = (process.env.UAS_ALERT_EMAIL_WEBHOOK_URL || "").trim();
  if (emailWebhookUrl) {
    try {
      const res = await fetch(emailWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: record.titleEn,
          text: `${record.messageEn}\n\n${record.messageAr}`,
          record,
        }),
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) delivered = true;
    } catch {
      // Non-fatal
    }
  }

  const tgToken = (process.env.UAS_TELEGRAM_BOT_TOKEN || "").trim();
  const tgChatId = (process.env.UAS_TELEGRAM_CHAT_ID || "").trim();
  if (tgToken && tgChatId) {
    try {
      const text = `⚠️ UAS Alert (${record.tenantSlug})\n${record.titleAr}\n${record.messageAr}\n${record.messageEn}`;
      const res = await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: tgChatId,
          text,
        }),
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) delivered = true;
    } catch {
      // Non-fatal
    }
  }

  return delivered;
}

export async function dispatchBackupOrDiskAlert(params: {
  tenantId: string;
  tenantSlug: string;
  kind: "BACKUP_FAILED" | "DISK_THRESHOLD_EXCEEDED";
  titleAr: string;
  titleEn: string;
  messageAr: string;
  messageEn: string;
  diskUsagePercent?: number;
  thresholdPercent?: number;
  now?: Date;
  cooldownMs?: number;
  skipDbNotification?: boolean;
}): Promise<{
  sent: boolean;
  suppressedByCooldown: boolean;
  record?: BackupMonitoringAlertRecord;
}> {
  const now = params.now ?? new Date();
  const cooldownMs = params.cooldownMs ?? DEFAULT_ALERT_COOLDOWN_MS;
  const dedupKey = `${params.kind}:${params.tenantSlug}`;
  const state = loadBackupAlertsState();

  const lastSentIso = state.cooldowns[dedupKey];
  if (lastSentIso) {
    const lastSentMs = Date.parse(lastSentIso);
    if (!Number.isNaN(lastSentMs) && now.getTime() - lastSentMs < cooldownMs) {
      return { sent: false, suppressedByCooldown: true };
    }
  }

  const record: BackupMonitoringAlertRecord = {
    id: `bkp-alert-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: now.toISOString(),
    dedupKey,
    kind: params.kind,
    tenantSlug: params.tenantSlug,
    severity: "CRITICAL",
    titleAr: params.titleAr,
    titleEn: params.titleEn,
    messageAr: params.messageAr,
    messageEn: params.messageEn,
    diskUsagePercent: params.diskUsagePercent,
    thresholdPercent: params.thresholdPercent,
    webhookDispatched: false,
  };

  record.webhookDispatched = await sendOptionalEnvWebhooks(record);

  if (!params.skipDbNotification) {
    const emitInsideTenant = async () => {
      await prisma.$transaction(async (tx) => {
        await emitNotification(
          {
            eventType: "SYSTEM_ALERT",
            channel: "security",
            severity: "CRITICAL",
            titleAr: params.titleAr,
            titleEn: params.titleEn,
            messageAr: params.messageAr,
            messageEn: params.messageEn,
            targetTab: "system",
            targetEntityType: "BackupMonitoring",
            targetEntityId: dedupKey,
            metadata: {
              alertKind: params.kind,
              tenantSlug: params.tenantSlug,
              diskUsagePercent: params.diskUsagePercent,
              thresholdPercent: params.thresholdPercent,
            },
          },
          tx
        );
        await appendAuditLogTx(tx, {
          userId: null,
          userDisplay: "مجدول النسخ الاحتياطي (Backup Scheduler)",
          userRole: "SUPER_ADMIN",
          actionType: params.kind,
          entityReference: `BackupMonitor:${params.tenantSlug}`,
          details: `${params.messageAr} | ${params.messageEn}`,
        });
      });
    };

    try {
      if (getActiveTenantId() === params.tenantId) {
        await emitInsideTenant();
      } else {
        await runWithTenant(params.tenantId, emitInsideTenant);
      }
    } catch (dbErr) {
      console.warn(
        `[BackupMonitoring] Could not emit DB notification for ${params.tenantSlug}:`,
        dbErr
      );
    }
  }

  state.cooldowns[dedupKey] = now.toISOString();
  state.recentAlerts.unshift(record);
  saveBackupAlertsState(state);

  return { sent: true, suppressedByCooldown: false, record };
}

const SYNTHETIC_TEST_TENANT_PATTERN =
  /^(phase\d+_|sync_gov_test_|al_jabri_test_|tenant_(alpha|gamma)_|dynamic_reg_|devgov_|bkp_(test|other)_|aljabri_qa_|other_qa_|alwaha_|autologin_|align_|brandtest_|p3h-|p4-)/i;

export function filterActiveTenantsForScheduledBackup(
  registered: TenantMetadata[],
  existingPgDatabases?: Set<string>
): TenantMetadata[] {
  const active = registered.filter((t) => (t.status || "ACTIVE") === "ACTIVE");
  return active.filter((t) => {
    const normId = t.tenantId || "default";
    if (normId === "default") return true;
    const isSynthetic =
      SYNTHETIC_TEST_TENANT_PATTERN.test(normId) ||
      SYNTHETIC_TEST_TENANT_PATTERN.test(t.slug || "");
    if (isSynthetic) {
      if (!existingPgDatabases || !t.postgresDb) return false;
      return Boolean(t.licenseId) && existingPgDatabases.has(t.postgresDb);
    }
    if (existingPgDatabases && t.postgresDb && !existingPgDatabases.has(t.postgresDb)) {
      return false;
    }
    return true;
  });
}

export async function runScheduledBackupsAndMonitoring(opts?: {
  now?: Date;
  tenants?: TenantMetadata[];
  mockDiskUsagePercent?: number;
  cooldownMs?: number;
  backupTenantFn?: (tenant: TenantMetadata, now: Date) => Promise<{
    filename: string;
    filePath: string;
    engine: "postgresql" | "sqlite";
    sha256: string;
    sizeBytes: number;
  }>;
}): Promise<ScheduledBackupRunSummary> {
  const now = opts?.now ?? new Date();
  let existingPgDbs: Set<string> | undefined;

  if (!opts?.tenants && isPostgresRuntime()) {
    try {
      const rows = await defaultPrisma.$queryRawUnsafe<Array<{ datname: string }>>(
        `SELECT datname FROM pg_database;`
      );
      existingPgDbs = new Set((rows || []).map((r) => r.datname));
    } catch {
      existingPgDbs = undefined;
    }
  }

  const targetTenants = opts?.tenants
    ? opts.tenants
    : filterActiveTenantsForScheduledBackup(listRegisteredTenants(), existingPgDbs);

  const realDisk = inspectDiskUsage();
  const effectiveDiskUsagePercent =
    typeof opts?.mockDiskUsagePercent === "number" && Number.isFinite(opts.mockDiskUsagePercent)
      ? opts.mockDiskUsagePercent
      : realDisk.usagePercent;
  const diskSnapshot: DiskUsageSnapshot = {
    ...realDisk,
    usagePercent: effectiveDiskUsagePercent,
  };

  const tenantResults: ScheduledBackupTenantResult[] = [];
  const alertsTriggered: BackupMonitoringAlertRecord[] = [];
  const state = loadBackupAlertsState();

  for (const tenant of targetTenants) {
    const tenantId = tenant.tenantId || "default";
    const tenantSlug = normalizeBackupTenantSlug(tenant.slug || tenantId);
    const engine: "postgresql" | "sqlite" = isSqliteRuntime() ? "sqlite" : "postgresql";
    let thresholdPercent = resolveEffectiveDiskThresholdPercent(null);

    try {
      const settingsAndBackup = async () => {
        const settingsRow = await prisma.systemSettings
          .findUnique({ where: { id: "default" } })
          .catch(() => null);
        thresholdPercent = resolveEffectiveDiskThresholdPercent(settingsRow);
        if (opts?.backupTenantFn) {
          return await opts.backupTenantFn(tenant, now);
        }
        return await createScheduledAutoBackupForActiveTenant(now);
      };

      const backupOut = await runWithTenant(tenantId, settingsAndBackup);
      const pruned = pruneTenantBackups({ tenantSlug, now });

      const diskExceeded = effectiveDiskUsagePercent >= thresholdPercent;
      let alertSent = false;
      let alertSuppressedByCooldown = false;

      if (diskExceeded) {
        const alertRes = await dispatchBackupOrDiskAlert({
          tenantId,
          tenantSlug,
          kind: "DISK_THRESHOLD_EXCEEDED",
          titleAr: `⚠️ تنبيه امتلاء القرص (${effectiveDiskUsagePercent}% >= ${thresholdPercent}%)`,
          titleEn: `⚠️ Disk Usage Threshold Exceeded (${effectiveDiskUsagePercent}% >= ${thresholdPercent}%)`,
          messageAr: `بلغت نسبة امتلاء مساحة التخزين ${effectiveDiskUsagePercent}% وتجاوزت الحد المعتمد (${thresholdPercent}%) في نطاق المنشأة (${tenantSlug}).`,
          messageEn: `Filesystem disk usage reached ${effectiveDiskUsagePercent}% (configured alert threshold: ${thresholdPercent}%) for tenant ${tenantSlug}.`,
          diskUsagePercent: effectiveDiskUsagePercent,
          thresholdPercent,
          now,
          cooldownMs: opts?.cooldownMs,
        });
        alertSent = alertRes.sent;
        alertSuppressedByCooldown = alertRes.suppressedByCooldown;
        if (alertRes.record) alertsTriggered.push(alertRes.record);
      }

      const tResult: ScheduledBackupTenantResult = {
        tenantId,
        tenantSlug,
        engine: backupOut.engine,
        ok: true,
        ranAt: now.toISOString(),
        filename: backupOut.filename,
        sha256: backupOut.sha256,
        sizeBytes: backupOut.sizeBytes,
        thresholdPercent,
        diskUsagePercent: effectiveDiskUsagePercent,
        diskExceeded,
        pruned,
        alertSent,
        alertSuppressedByCooldown,
      };
      tenantResults.push(tResult);
      state.lastTenantRuns[tenantSlug] = tResult;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const alertRes = await dispatchBackupOrDiskAlert({
        tenantId,
        tenantSlug,
        kind: "BACKUP_FAILED",
        titleAr: `🚨 فشل النسخ الاحتياطي المجدول للمنشأة (${tenantSlug})`,
        titleEn: `🚨 Scheduled Daily Backup Failed (${tenantSlug})`,
        messageAr: `تعذر إتمام النسخ الاحتياطي التلقائي اليومي للمنشأة (${tenantSlug}): ${errMsg}`,
        messageEn: `Automated daily backup failed for tenant ${tenantSlug}: ${errMsg}`,
        diskUsagePercent: effectiveDiskUsagePercent,
        thresholdPercent,
        now,
        cooldownMs: opts?.cooldownMs,
      });
      if (alertRes.record) alertsTriggered.push(alertRes.record);

      const failRes: ScheduledBackupTenantResult = {
        tenantId,
        tenantSlug,
        engine,
        ok: false,
        ranAt: now.toISOString(),
        thresholdPercent,
        diskUsagePercent: effectiveDiskUsagePercent,
        diskExceeded: effectiveDiskUsagePercent >= thresholdPercent,
        alertSent: alertRes.sent,
        alertSuppressedByCooldown: alertRes.suppressedByCooldown,
        error: errMsg,
      };
      tenantResults.push(failRes);
      state.lastTenantRuns[tenantSlug] = failRes;
    }
  }

  const succeededCount = tenantResults.filter((r) => r.ok).length;
  const failedCount = tenantResults.length - succeededCount;
  const status: ScheduledBackupRunSummary["status"] =
    failedCount === 0 ? "SUCCESS" : succeededCount > 0 ? "PARTIAL_FAILURE" : "FAILED";

  const summary: ScheduledBackupRunSummary = {
    ok: failedCount === 0,
    ranAt: now.toISOString(),
    status,
    tenantsProcessed: tenantResults.length,
    succeededCount,
    failedCount,
    disk: diskSnapshot,
    alertsTriggered,
    tenantResults,
  };

  // Reload state in case alerts updated cooldowns/recentAlerts during loop
  const latestState = loadBackupAlertsState();
  latestState.lastScheduledRun = summary;
  for (const tr of tenantResults) {
    latestState.lastTenantRuns[tr.tenantSlug] = tr;
  }
  saveBackupAlertsState(latestState);

  return summary;
}

export interface TenantBackupHealthSummary {
  tenantSlug: string;
  engine: "postgresql" | "sqlite";
  lastScheduledBackupAt: string | null;
  lastScheduledStatus: string | null;
  lastBackupFilename: string | null;
  lastBackupError: string | null;
  retentionPolicy: typeof GFS_RETENTION_POLICY;
  diskUsagePercent: number;
  diskAlertThresholdPercent: number;
  diskWarningExceeded: boolean;
  diskTotalFormatted: string;
  diskUsedFormatted: string;
  diskAvailFormatted: string;
  tenantBackupsBytes: number;
  tenantBackupsFormatted: string;
  attachmentsBytes: number;
  attachmentsFormatted: string;
  attachmentsCount: number;
}

export async function getTenantBackupHealthSummary(
  tenantIdOverride?: string
): Promise<TenantBackupHealthSummary> {
  const activeTenant = tenantIdOverride || getActiveTenantId();
  const tenantSlug = normalizeBackupTenantSlug(activeTenant);
  const engine: "postgresql" | "sqlite" = isSqliteRuntime() ? "sqlite" : "postgresql";

  const [settingsRow, attachmentRows] = await Promise.all([
    prisma.systemSettings.findUnique({ where: { id: "default" } }).catch(() => null),
    prisma.attachment
      .findMany({
        select: { fileUrl: true, fileName: true },
      })
      .catch(() => [] as Array<{ fileUrl: string; fileName: string }>),
  ]);

  const diskAlertThresholdPercent = resolveEffectiveDiskThresholdPercent(settingsRow);
  const disk = inspectDiskUsage();
  const alertsState = loadBackupAlertsState();
  const tenantLast = alertsState.lastTenantRuns?.[tenantSlug] ?? null;

  const tenantBackupsDir = getTenantBackupsDirectory(tenantSlug);
  const tenantBackupsBytes = computeDirectorySizeBytes(tenantBackupsDir);

  const appRoot = getAppRootDir();
  const attachmentsCount = attachmentRows.length;
  let attachmentsBytes = 0;
  const seenAttachmentPaths = new Set<string>();
  for (const row of attachmentRows) {
    const url = String(row.fileUrl || "").trim();
    if (!url) continue;
    if (url.startsWith("data:")) {
      const commaIdx = url.indexOf(",");
      if (commaIdx > 0) {
        attachmentsBytes += Math.floor(((url.length - commaIdx - 1) * 3) / 4);
      }
      continue;
    }
    const cleanRel = url
      .replace(/^https?:\/\/[^/]+/i, "")
      .replace(/^\/+/, "")
      .replace(/^api\/uploads\//, "uploads/");
    const safeRel = path.normalize(cleanRel).replace(/^(\.\.(\/|\\|$))+/, "");
    const candidates = [
      path.join(appRoot, "data", safeRel),
      path.join(appRoot, "public", safeRel),
      path.join(appRoot, safeRel),
    ];
    for (const cand of candidates) {
      if (seenAttachmentPaths.has(cand)) break;
      try {
        if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
          seenAttachmentPaths.add(cand);
          attachmentsBytes += fs.statSync(cand).size;
          break;
        }
      } catch {
        // Ignore stat error
      }
    }
  }
  if (attachmentsBytes === 0 && tenantSlug === "default") {
    attachmentsBytes =
      computeDirectorySizeBytes(path.join(appRoot, "data", "uploads")) +
      computeDirectorySizeBytes(path.join(appRoot, "data", "vision-archive"));
  }

  return {
    tenantSlug,
    engine,
    lastScheduledBackupAt: tenantLast?.ranAt ?? alertsState.lastScheduledRun?.ranAt ?? null,
    lastScheduledStatus: tenantLast
      ? tenantLast.ok
        ? "SUCCESS"
        : "FAILED"
      : alertsState.lastScheduledRun?.status ?? null,
    lastBackupFilename: tenantLast?.filename ?? null,
    lastBackupError: tenantLast?.error ?? null,
    retentionPolicy: GFS_RETENTION_POLICY,
    diskUsagePercent: disk.usagePercent,
    diskAlertThresholdPercent,
    diskWarningExceeded: disk.usagePercent >= diskAlertThresholdPercent,
    diskTotalFormatted: disk.totalFormatted,
    diskUsedFormatted: disk.usedFormatted,
    diskAvailFormatted: disk.availFormatted,
    tenantBackupsBytes,
    tenantBackupsFormatted: formatBytes(tenantBackupsBytes),
    attachmentsBytes,
    attachmentsFormatted: formatBytes(attachmentsBytes),
    attachmentsCount,
  };
}
