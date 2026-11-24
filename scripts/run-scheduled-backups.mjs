import fs from "node:fs";
import path from "node:path";

function loadEnvFileIfPresent(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eqIdx = line.indexOf("=");
    if (eqIdx <= 0) continue;
    const key = line.slice(0, eqIdx).trim();
    let val = line.slice(eqIdx + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = val;
    }
  }
}

async function main() {
  const rootDir = process.cwd();
  loadEnvFileIfPresent(path.join(rootDir, ".env.production"));
  loadEnvFileIfPresent(path.join(rootDir, ".env"));

  const { runScheduledBackupsAndMonitoring } = await import(
    "../src/lib/backupMonitoringService"
  );
  const { resetTenantClientsForTests } = await import("../src/lib/tenant");

  try {
    const summary = await runScheduledBackupsAndMonitoring();
    console.log(
      JSON.stringify(
        {
          event: "UAS_SCHEDULED_BACKUP_RUN",
          ok: summary.ok,
          ranAt: summary.ranAt,
          status: summary.status,
          tenantsProcessed: summary.tenantsProcessed,
          succeededCount: summary.succeededCount,
          failedCount: summary.failedCount,
          diskUsagePercent: summary.disk.usagePercent,
          diskAvail: summary.disk.availFormatted,
          alertsTriggeredCount: summary.alertsTriggered.length,
          tenants: summary.tenantResults.map((t) => ({
            slug: t.tenantSlug,
            engine: t.engine,
            ok: t.ok,
            filename: t.filename,
            sizeBytes: t.sizeBytes,
            prunedCount: t.pruned?.totalDeleted ?? 0,
            diskThresholdPercent: t.thresholdPercent,
            error: t.error,
          })),
        },
        null,
        2
      )
    );
    await resetTenantClientsForTests();
    if (!summary.ok) {
      process.exitCode = 1;
    }
  } catch (err) {
    console.error("[run-scheduled-backups] Fatal error:", err);
    await resetTenantClientsForTests().catch(() => {});
    process.exitCode = 1;
  }
}

void main();
