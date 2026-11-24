import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { NextRequest } from "next/server";
import {
  clampDiskAlertThresholdPercent,
  DEFAULT_DISK_ALERT_THRESHOLD_PERCENT,
  parseAccountingSettings,
  resolveDefaultDiskAlertThresholdPercent,
  resolveEffectiveDiskThresholdPercent,
} from "../src/lib/accountingSettings";
import {
  dispatchBackupOrDiskAlert,
  filterActiveTenantsForScheduledBackup,
  inspectDiskUsage,
  loadBackupAlertsState,
  runScheduledBackupsAndMonitoring,
} from "../src/lib/backupMonitoringService";
import { issueSessionToken } from "../src/lib/authSession";
import {
  hasLicensePrivateKey,
  signLicensePayload,
} from "../src/lib/licensing/licenseSigner";
import { saveInstalledLicense } from "../src/lib/licensing/verifier";
import { listNotifications } from "../src/lib/notifications/notificationService";
import { defaultPrisma, prisma } from "../src/lib/prisma";
import { hashPassword } from "../src/lib/serverBootstrap";
import {
  ensureTenantRegistered,
  isPostgresRuntime,
  resetRegistryForTests,
  resetTenantClientsForTests,
  runWithTenant,
} from "../src/lib/tenant";
import { GET as settingsGET, PUT as settingsPUT } from "../src/app/api/system/settings/route";
import { GET as backupsGET } from "../src/app/api/system/backups/route";

const TS = Date.now().toString().slice(-6);
const TENANT_MON = `mon-test-${TS}`;

describe("Phase 4: Configurable Disk Threshold, Scheduled Runner & Alert Deduplication", () => {
  let tmpRootDir = "";
  let prevDataDir: string | undefined;
  let prevBackupsDir: string | undefined;
  let prevThresholdEnv: string | undefined;

  before(() => {
    prevDataDir = process.env.UAS_DATA_DIR;
    prevBackupsDir = process.env.UAS_BACKUPS_DIR;
    prevThresholdEnv = process.env.UAS_DISK_ALERT_THRESHOLD_PERCENT;

    tmpRootDir = fs.mkdtempSync(path.join(os.tmpdir(), "uas-mon-phase4-"));
    process.env.UAS_DATA_DIR = path.join(tmpRootDir, "data");
    process.env.UAS_BACKUPS_DIR = path.join(tmpRootDir, "backups");
    fs.mkdirSync(process.env.UAS_DATA_DIR, { recursive: true });
    fs.mkdirSync(process.env.UAS_BACKUPS_DIR, { recursive: true });
    delete process.env.UAS_DISK_ALERT_THRESHOLD_PERCENT;
    resetRegistryForTests();

    ensureTenantRegistered(TENANT_MON, "منشأة مراقبة النسخ والقرص", {
      slug: TENANT_MON,
      nameAr: "منشأة مراقبة النسخ والقرص",
      licenseId: "UAS-2026-4894",
    });
  });

  after(async () => {
    await resetTenantClientsForTests();
    if (isPostgresRuntime()) {
      const schema = `tenant_${TENANT_MON.replace(/-/g, "_")}`;
      if (/^tenant_mon_test_[0-9]+$/.test(schema)) {
        await defaultPrisma
          .$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
          .catch(() => undefined);
      }
    }
    if (tmpRootDir && fs.existsSync(tmpRootDir)) {
      fs.rmSync(tmpRootDir, { recursive: true, force: true });
    }
    if (prevDataDir === undefined) delete process.env.UAS_DATA_DIR;
    else process.env.UAS_DATA_DIR = prevDataDir;
    if (prevBackupsDir === undefined) delete process.env.UAS_BACKUPS_DIR;
    else process.env.UAS_BACKUPS_DIR = prevBackupsDir;
    if (prevThresholdEnv === undefined) delete process.env.UAS_DISK_ALERT_THRESHOLD_PERCENT;
    else process.env.UAS_DISK_ALERT_THRESHOLD_PERCENT = prevThresholdEnv;
    resetRegistryForTests();
  });

  it("clamps diskAlertThresholdPercent cleanly (50-95, default 80) and honors env override", () => {
    assert.equal(DEFAULT_DISK_ALERT_THRESHOLD_PERCENT, 80);
    assert.equal(resolveDefaultDiskAlertThresholdPercent(), 80);
    assert.equal(clampDiskAlertThresholdPercent(10), 50);
    assert.equal(clampDiskAlertThresholdPercent(99), 95);
    assert.equal(clampDiskAlertThresholdPercent(84.4), 84);
    assert.equal(clampDiskAlertThresholdPercent("bad", 80), 80);

    process.env.UAS_DISK_ALERT_THRESHOLD_PERCENT = "72";
    assert.equal(resolveDefaultDiskAlertThresholdPercent(), 72);
    assert.equal(parseAccountingSettings(null).diskAlertThresholdPercent, 72);

    // Explicit DB setting overrides env default cleanly
    assert.equal(
      resolveEffectiveDiskThresholdPercent({
        tenantAdminConfigJson: JSON.stringify({ diskAlertThresholdPercent: 90 }),
      }),
      90
    );
    delete process.env.UAS_DISK_ALERT_THRESHOLD_PERCENT;
  });

  it("inspects disk usage and deduplicates backup/disk alerts within cooldown while delivering notifications", async () => {
    const disk = inspectDiskUsage([tmpRootDir]);
    assert.ok(disk.totalBytes > 0);
    assert.ok(disk.usagePercent >= 0 && disk.usagePercent <= 100);

    await runWithTenant(TENANT_MON, async () => {
      await prisma.user.create({
        data: {
          id: "u-mon-sa",
          username: "mon_sa",
          name: "مدير المراقبة",
          fullName: "مدير المراقبة",
          email: "mon@uas-test.ye",
          passwordHash: hashPassword("Monitor@2026"),
          role: "SUPER_ADMIN",
          active: true,
          isActive: true,
        },
      });

      const t0 = new Date("2026-11-24T02:30:00.000Z");
      const alert1 = await dispatchBackupOrDiskAlert({
        tenantId: TENANT_MON,
        tenantSlug: TENANT_MON,
        kind: "DISK_THRESHOLD_EXCEEDED",
        titleAr: "تنبيه امتلاء القرص",
        titleEn: "Disk Threshold Exceeded",
        messageAr: "تم تجاوز حد الامتلاء 80%",
        messageEn: "Disk threshold exceeded 80%",
        diskUsagePercent: 86,
        thresholdPercent: 80,
        now: t0,
        cooldownMs: 3600_000,
      });
      assert.equal(alert1.sent, true);
      assert.equal(alert1.suppressedByCooldown, false);

      // Immediate second alert within cooldown -> suppressed!
      const alert2 = await dispatchBackupOrDiskAlert({
        tenantId: TENANT_MON,
        tenantSlug: TENANT_MON,
        kind: "DISK_THRESHOLD_EXCEEDED",
        titleAr: "تنبيه امتلاء القرص",
        titleEn: "Disk Threshold Exceeded",
        messageAr: "تم تجاوز حد الامتلاء 80%",
        messageEn: "Disk threshold exceeded 80%",
        diskUsagePercent: 87,
        thresholdPercent: 80,
        now: new Date(t0.getTime() + 10 * 60_000),
        cooldownMs: 3600_000,
      });
      assert.equal(alert2.sent, false);
      assert.equal(alert2.suppressedByCooldown, true);

      const notifs = await listNotifications({ channel: "security" });
      assert.ok(
        notifs.notifications.some(
          (n) => n.eventType === "SYSTEM_ALERT" && n.targetEntityId === `DISK_THRESHOLD_EXCEEDED:${TENANT_MON}`
        )
      );
    });
  });

  it("persists diskAlertThresholdPercent via /api/system/settings and triggers alert on scheduled backup failure", async () => {
    if (hasLicensePrivateKey()) {
      const signed = signLicensePayload({
        license_id: "UAS-2026-4894",
        customer_name: "منشأة مراقبة النسخ والقرص",
        company_name: "منشأة مراقبة النسخ والقرص",
        hwid: "*",
        allowed_modes: ["local", "lan", "cloud"],
        max_branches: 5,
        max_lan_seats: 10,
        max_users: 10,
        issued_at: new Date().toISOString(),
        expires_at: "2027-12-31T23:59:59.000Z",
      });
      saveInstalledLicense(signed, TENANT_MON);
    }

    await runWithTenant(TENANT_MON, async () => {
      if (hasLicensePrivateKey()) {
        const token = issueSessionToken({
          userId: "u-mon-sa",
          userRole: "SUPER_ADMIN",
          tenantId: TENANT_MON,
          userDisplay: "مدير المراقبة (SUPER_ADMIN)",
        });

        const putRes = await settingsPUT(
          new NextRequest(`https://${TENANT_MON}.qat.world/api/system/settings`, {
            method: "PUT",
            headers: {
              "content-type": "application/json",
              "x-uas-tenant-id": TENANT_MON,
              "x-uas-session-token": token,
            },
            body: JSON.stringify({ diskAlertThresholdPercent: 99 }), // clamped to 95
          })
        );
        assert.equal(putRes.status, 200);
        const putJson = (await putRes.json()) as {
          settings?: { diskAlertThresholdPercent?: number };
        };
        assert.equal(putJson.settings?.diskAlertThresholdPercent, 95);

        const getRes = await settingsGET(
          new NextRequest(`https://${TENANT_MON}.qat.world/api/system/settings`, {
            headers: { "x-uas-tenant-id": TENANT_MON },
          })
        );
        const getJson = (await getRes.json()) as {
          settings?: { diskAlertThresholdPercent?: number };
        };
        assert.equal(getJson.settings?.diskAlertThresholdPercent, 95);

        const healthRes = await backupsGET(
          new NextRequest(`https://${TENANT_MON}.qat.world/api/system/backups`, {
            headers: {
              "x-uas-tenant-id": TENANT_MON,
              "x-uas-session-token": token,
            },
          })
        );
        assert.equal(healthRes.status, 200);
        const healthJson = (await healthRes.json()) as {
          ok?: boolean;
          health?: {
            diskAlertThresholdPercent?: number;
            retentionPolicy?: { daily?: number; weekly?: number; monthly?: number };
            diskUsagePercent?: number;
            engine?: string;
          };
        };
        assert.equal(healthJson.ok, true);
        assert.equal(healthJson.health?.diskAlertThresholdPercent, 95);
        assert.equal(healthJson.health?.retentionPolicy?.daily, 7);
        assert.equal(healthJson.health?.retentionPolicy?.weekly, 4);
        assert.equal(healthJson.health?.retentionPolicy?.monthly, 6);
        assert.equal(typeof healthJson.health?.diskUsagePercent, "number");
      }

      // Filter keeps active production tenants and drops synthetic orphans without DB
      const filtered = filterActiveTenantsForScheduledBackup(
        [
          {
            tenantId: "default",
            slug: "default",
            companyName: "Root",
            schemaOrDb: "default",
            status: "ACTIVE",
            createdAt: "",
            updatedAt: "",
          },
          {
            tenantId: "aljabri",
            slug: "aljabri",
            companyName: "Aljabri",
            postgresDb: "uas_aljabri",
            schemaOrDb: "uas_aljabri",
            licenseId: "UAS-2026-4894",
            status: "ACTIVE",
            createdAt: "",
            updatedAt: "",
          },
          {
            tenantId: "phase1_core_999999",
            slug: "phase1-core-999999",
            companyName: "Ghost Test",
            postgresDb: "uas_ghost_nonexistent",
            schemaOrDb: "uas_ghost_nonexistent",
            status: "ACTIVE",
            createdAt: "",
            updatedAt: "",
          },
        ],
        new Set(["uas_qat_prod", "uas_aljabri"])
      );
      assert.equal(filtered.length, 2);

      // Simulate scheduled run with 1 failing backup + disk exceeding threshold
      const summary = await runScheduledBackupsAndMonitoring({
        now: new Date("2026-11-24T02:35:00.000Z"),
        mockDiskUsagePercent: 97,
        cooldownMs: 0,
        tenants: [
          {
            tenantId: TENANT_MON,
            slug: TENANT_MON,
            companyName: "Monitor Test",
            schemaOrDb: TENANT_MON,
            status: "ACTIVE",
            createdAt: "",
            updatedAt: "",
          },
        ],
        backupTenantFn: async () => {
          throw new Error("Simulated pg_dump network failure");
        },
      });

      assert.equal(summary.ok, false);
      assert.equal(summary.status, "FAILED");
      assert.equal(summary.failedCount, 1);
      assert.ok(summary.alertsTriggered.some((a) => a.kind === "BACKUP_FAILED"));

      const alertsState = loadBackupAlertsState();
      assert.equal(alertsState.lastScheduledRun?.status, "FAILED");
    });
  });
});
