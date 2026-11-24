import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { NextRequest } from "next/server";
import {
  createPortableUasbakEnvelope,
  createPostgresPgDumpSnapshot,
  GFS_RETENTION_POLICY,
  hasValidPgDumpHeader,
  isExcludedDevBackupFile,
  listLocalBackups,
  pruneTenantBackups,
  resolvePostgresPgToolConnection,
  restorePostgresFromPgDumpBuffer,
  saveBackupEnvelopeToTenantDir,
  UAS_BACKUP_SCHEMA_VERSION,
} from "../src/lib/backupService";
import { issueSessionToken } from "../src/lib/authSession";
import {
  hasLicensePrivateKey,
  signLicensePayload,
} from "../src/lib/licensing/licenseSigner";
import { saveInstalledLicense } from "../src/lib/licensing/verifier";
import { defaultPrisma, prisma } from "../src/lib/prisma";
import { hashPassword } from "../src/lib/serverBootstrap";
import {
  ensureTenantRegistered,
  isPostgresRuntime,
  resetRegistryForTests,
  resetTenantClientsForTests,
  runWithTenant,
} from "../src/lib/tenant";
import { POST as backupPOST } from "../src/app/api/system/backup/route";
import { GET as backupsGET } from "../src/app/api/system/backups/route";
import { DELETE as backupDELETE } from "../src/app/api/system/backups/[filename]/route";
import { POST as restorePOST } from "../src/app/api/system/restore/route";

const TS = Date.now().toString().slice(-6);
const TENANT_BKP = `bkp-test-${TS}`;
const TENANT_OTHER = `bkp-other-${TS}`;

describe("Phase 3: Engine-Aware Backups, Restore Validation & GFS Retention", () => {
  let tmpRootDir = "";
  let prevDataDir: string | undefined;
  let prevBackupsDir: string | undefined;

  before(() => {
    prevDataDir = process.env.UAS_DATA_DIR;
    prevBackupsDir = process.env.UAS_BACKUPS_DIR;
    tmpRootDir = fs.mkdtempSync(path.join(os.tmpdir(), "uas-bkp-phase3-"));
    process.env.UAS_DATA_DIR = path.join(tmpRootDir, "data");
    process.env.UAS_BACKUPS_DIR = path.join(tmpRootDir, "backups");
    fs.mkdirSync(process.env.UAS_DATA_DIR, { recursive: true });
    fs.mkdirSync(process.env.UAS_BACKUPS_DIR, { recursive: true });
    resetRegistryForTests();

    ensureTenantRegistered(TENANT_BKP, "منشأة النسخ الاحتياطي التجريبية", {
      slug: TENANT_BKP,
      nameAr: "منشأة النسخ الاحتياطي التجريبية",
      licenseId: "UAS-2026-4894",
    });
    ensureTenantRegistered(TENANT_OTHER, "منشأة أخرى معزولة", {
      slug: TENANT_OTHER,
      nameAr: "منشأة أخرى معزولة",
      licenseId: "UAS-2026-6600",
    });
  });

  after(async () => {
    await resetTenantClientsForTests();
    if (isPostgresRuntime()) {
      for (const slug of [TENANT_BKP, TENANT_OTHER]) {
        const schema = `tenant_${slug.replace(/-/g, "_")}`;
        if (/^tenant_bkp_(test|other)_[0-9]+$/.test(schema)) {
          await defaultPrisma
            .$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
            .catch(() => undefined);
        }
      }
    }
    if (tmpRootDir && fs.existsSync(tmpRootDir)) {
      fs.rmSync(tmpRootDir, { recursive: true, force: true });
    }
    if (prevDataDir === undefined) delete process.env.UAS_DATA_DIR;
    else process.env.UAS_DATA_DIR = prevDataDir;
    if (prevBackupsDir === undefined) delete process.env.UAS_BACKUPS_DIR;
    else process.env.UAS_BACKUPS_DIR = prevBackupsDir;
    resetRegistryForTests();
  });

  it("enforces GFS retention (7 daily / 4 weekly / 6 monthly / 3 pre-restore), prunes >7d temp files, and spares attachments", () => {
    const baseDir = path.join(tmpRootDir, "gfs-backups");
    const slug = TENANT_BKP;
    const tenantDir = path.join(baseDir, slug);
    const uploadsDir = path.join(tmpRootDir, "data", "uploads");
    const visionDir = path.join(tmpRootDir, "data", "vision-archive");
    const customTmpDir = path.join(tmpRootDir, "custom-tmp");

    for (const d of [tenantDir, uploadsDir, visionDir, customTmpDir]) {
      fs.mkdirSync(d, { recursive: true });
    }

    // Seed attachments that must NEVER be pruned regardless of age
    const receiptFile = path.join(uploadsDir, "receipt-protected.jpg");
    const tallyFile = path.join(visionDir, "tally-protected.png");
    fs.writeFileSync(receiptFile, "KEEP_RECEIPT");
    fs.writeFileSync(tallyFile, "KEEP_TALLY");
    const veryOldDate = new Date("2025-01-01T00:00:00Z");
    fs.utimesSync(receiptFile, veryOldDate, veryOldDate);
    fs.utimesSync(tallyFile, veryOldDate, veryOldDate);

    // 10 consecutive daily snapshots ending 2026-11-24
    for (let day = 15; day <= 24; day++) {
      fs.writeFileSync(
        path.join(tenantDir, `uas-auto-${slug}-2026-11-${String(day).padStart(2, "0")}.uasbak`),
        "{}"
      );
    }
    // 6 older weekly snapshots (prior ISO weeks before Nov 15)
    for (const wDate of [
      "2026-11-08",
      "2026-11-01",
      "2026-10-25",
      "2026-10-18",
      "2026-10-11",
      "2026-10-04",
    ]) {
      fs.writeFileSync(path.join(tenantDir, `uas-auto-${slug}-${wDate}.uasbak`), "{}");
    }
    // 8 older monthly snapshots (before Oct)
    for (let m = 2; m <= 9; m++) {
      fs.writeFileSync(
        path.join(tenantDir, `uas-auto-${slug}-2026-${String(m).padStart(2, "0")}-01.uasbak`),
        "{}"
      );
    }
    // 5 pre-restore safety snapshots
    for (let p = 1; p <= 5; p++) {
      fs.writeFileSync(
        path.join(tenantDir, `pre-restore-${slug}-2026112${p}010000.uasbak`),
        "{}"
      );
    }
    // Manual snapshot & dev file
    fs.writeFileSync(path.join(tenantDir, `UAS-Backup-Manual-${slug}-2026-11-24.uasbak`), "{}");
    fs.writeFileSync(path.join(baseDir, "standalone_dev_2026-11-22_1901.db"), "DEV");

    // Orphan temp files: one old (> 7d) and one fresh (< 7d)
    const oldTemp = path.join(tenantDir, "uas-pgdump-orphan-old.tmp");
    const freshTemp = path.join(tenantDir, "uas-pgdump-fresh.tmp");
    fs.writeFileSync(oldTemp, "OLD_TMP");
    fs.writeFileSync(freshTemp, "FRESH_TMP");
    const now = new Date("2026-11-24T12:00:00.000Z");
    const oldMtime = new Date(now.getTime() - 9 * 86400_000);
    const freshMtime = new Date(now.getTime() - 2 * 86400_000);
    fs.utimesSync(oldTemp, oldMtime, oldMtime);
    fs.utimesSync(freshTemp, freshMtime, freshMtime);

    const res = pruneTenantBackups({
      tenantSlug: slug,
      baseBackupsDir: baseDir,
      now,
      tempDirs: [tenantDir, baseDir, customTmpDir],
    });

    assert.equal(res.buckets.daily.length, GFS_RETENTION_POLICY.daily);
    assert.equal(res.buckets.weekly.length, GFS_RETENTION_POLICY.weekly);
    assert.equal(res.buckets.monthly.length, GFS_RETENTION_POLICY.monthly);
    assert.equal(res.buckets.preRestore.length, GFS_RETENTION_POLICY.preRestore);
    assert.ok(res.deletedAutoCount > 0);
    assert.equal(res.deletedPreRestoreCount, 2);
    assert.equal(res.deletedTempCount, 1);

    // Manual backup, fresh temp, receipt & tally attachments remain intact
    assert.equal(
      fs.existsSync(path.join(tenantDir, `UAS-Backup-Manual-${slug}-2026-11-24.uasbak`)),
      true
    );
    assert.equal(fs.existsSync(freshTemp), true);
    assert.equal(fs.existsSync(oldTemp), false);
    assert.equal(fs.existsSync(receiptFile), true);
    assert.equal(fs.existsSync(tallyFile), true);
  });

  it("excludes standalone_dev_* and isolates backup listings per tenant", () => {
    const baseDir = process.env.UAS_BACKUPS_DIR!;
    fs.writeFileSync(path.join(baseDir, "standalone_dev_2026-11-22_1901.db"), "DEV");
    const dirA = path.join(baseDir, TENANT_BKP);
    const dirB = path.join(baseDir, TENANT_OTHER);
    fs.mkdirSync(dirA, { recursive: true });
    fs.mkdirSync(dirB, { recursive: true });

    fs.writeFileSync(path.join(dirA, `UAS-Backup-${TENANT_BKP}-2026-11-24.uasbak`), "{}");
    fs.writeFileSync(path.join(dirB, `UAS-Backup-${TENANT_OTHER}-2026-11-24.uasbak`), "{}");

    assert.equal(isExcludedDevBackupFile("standalone_dev_2026-11-22_1901.db"), true);

    const listA = listLocalBackups(TENANT_BKP);
    assert.ok(listA.some((b) => b.filename === `UAS-Backup-${TENANT_BKP}-2026-11-24.uasbak`));
    assert.equal(
      listA.some((b) => b.filename.includes("standalone_dev_")),
      false
    );
    assert.equal(
      listA.some((b) => b.filename.includes(TENANT_OTHER)),
      false
    );
  });

  it("resolves tenant PG databases strictly & executes engine-aware pg_dump/pg_restore + HTTP API guards", async () => {
    // Verify registered multi-tenant PostgreSQL DB routing
    assert.equal(resolvePostgresPgToolConnection("default").database, "uas_qat_prod");

    if (!isPostgresRuntime()) return;

    if (hasLicensePrivateKey()) {
      const signed = signLicensePayload({
        license_id: "UAS-2026-4894",
        customer_name: "منشأة النسخ الاحتياطي التجريبية",
        company_name: "منشأة النسخ الاحتياطي التجريبية",
        hwid: "*",
        allowed_modes: ["local", "lan", "cloud"],
        max_branches: 5,
        max_lan_seats: 10,
        max_users: 10,
        issued_at: new Date().toISOString(),
        expires_at: "2027-12-31T23:59:59.000Z",
      });
      saveInstalledLicense(signed, TENANT_BKP);
    }

    await runWithTenant(TENANT_BKP, async () => {
      await prisma.user.create({
        data: {
          id: "u-bkp-sa",
          username: "bkp_sa",
          name: "مدير النسخ",
          fullName: "مدير النسخ",
          email: "bkp@uas-test.ye",
          passwordHash: hashPassword("Backup@2026"),
          role: "SUPER_ADMIN",
          active: true,
          isActive: true,
        },
      });

      const snap = await createPostgresPgDumpSnapshot({ tenantId: TENANT_BKP });
      assert.equal(snap.envelope.format, "UAS-BACKUP-PG-V3");
      assert.equal(snap.manifest.tenantSlug, TENANT_BKP);
      assert.equal(snap.manifest.engine, "postgresql");
      assert.equal(snap.manifest.schemaVersion, UAS_BACKUP_SCHEMA_VERSION);
      assert.equal(snap.manifest.sha256.length, 64);
      assert.equal(hasValidPgDumpHeader(snap.buffer), true);

      const portable = await createPortableUasbakEnvelope({ tenantId: TENANT_BKP });
      assert.equal(portable.envelope.format, "UAS-BACKUP-PG-V3");

      // Tampered SHA-256 must fail
      await assert.rejects(
        () =>
          restorePostgresFromPgDumpBuffer(
            snap.buffer,
            { userId: "u-bkp-sa", userDisplay: "مدير النسخ", userRole: "SUPER_ADMIN" },
            "tamper_test",
            {
              tenantId: TENANT_BKP,
              expectedSha256: "0".repeat(64),
              expectedTenantSlug: TENANT_BKP,
            }
          ),
        /SHA-256/
      );

      // Wrong tenantSlug must fail
      await assert.rejects(
        () =>
          restorePostgresFromPgDumpBuffer(
            snap.buffer,
            { userId: "u-bkp-sa", userDisplay: "مدير النسخ", userRole: "SUPER_ADMIN" },
            "mismatch_test",
            {
              tenantId: TENANT_BKP,
              expectedSha256: snap.sha256,
              expectedTenantSlug: TENANT_OTHER,
            }
          ),
        /Tenant slug mismatch/
      );

      // Save snapshot & verify delete API when license present
      const token = issueSessionToken({
        userId: "u-bkp-sa",
        userRole: "SUPER_ADMIN",
        tenantId: TENANT_BKP,
        userDisplay: "مدير النسخ (SUPER_ADMIN)",
      });

      if (hasLicensePrivateKey()) {
        const postRes = await backupPOST(
          new NextRequest(`https://${TENANT_BKP}.qat.world/api/system/backup`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-uas-tenant-id": TENANT_BKP,
              "x-uas-session-token": token,
            },
            body: JSON.stringify({}),
          })
        );
        assert.equal(postRes.status, 200);
        const postJson = (await postRes.json()) as {
          ok?: boolean;
          filename?: string;
          format?: string;
          sha256?: string;
          pgDumpBase64?: string;
          manifest?: { tenantSlug?: string; engine?: string };
        };
        assert.equal(postJson.ok, true);
        assert.equal(postJson.format, "UAS-BACKUP-PG-V3");
        assert.equal(postJson.manifest?.tenantSlug, TENANT_BKP);
        assert.equal(postJson.manifest?.engine, "postgresql");

        // Corrupt sha256 on POST /api/system/restore -> 400
        const badRestoreRes = await restorePOST(
          new NextRequest(`https://${TENANT_BKP}.qat.world/api/system/restore`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-uas-tenant-id": TENANT_BKP,
              "x-uas-session-token": token,
            },
            body: JSON.stringify({
              ...postJson,
              sha256: "f".repeat(64),
              manifest: { ...postJson.manifest, sha256: "f".repeat(64) },
            }),
          })
        );
        assert.equal(badRestoreRes.status, 400);

        // Mutate a marker row, then restore atomically via POST /api/system/restore -> row disappears
        const tempProj = await prisma.project.create({
          data: {
            code: `POST-BKP-${TS}`,
            name: "مشروع بعد النسخة",
            nameAr: "مشروع بعد النسخة",
            nameEn: "After Backup Project",
          },
        });
        assert.ok(tempProj.id);

        const goodRestoreRes = await restorePOST(
          new NextRequest(`https://${TENANT_BKP}.qat.world/api/system/restore`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-uas-tenant-id": TENANT_BKP,
              "x-uas-session-token": token,
            },
            body: JSON.stringify({
              localSnapshotName: postJson.filename,
            }),
          })
        );
        assert.equal(goodRestoreRes.status, 200);
        const goodRestoreJson = (await goodRestoreRes.json()) as {
          ok?: boolean;
          preRestoreSnapshot?: string;
        };
        assert.equal(goodRestoreJson.ok, true);
        assert.ok(goodRestoreJson.preRestoreSnapshot?.startsWith(`pre-restore-${TENANT_BKP}-`));

        const afterRestoreCount = await prisma.project.count({
          where: { code: `POST-BKP-${TS}` },
        });
        assert.equal(afterRestoreCount, 0, "Atomic PG restore must revert post-backup project");

        // GET /api/system/backups excludes standalone_dev_* and includes pre-restore snapshot
        const listRes = await backupsGET(
          new NextRequest(`https://${TENANT_BKP}.qat.world/api/system/backups`, {
            method: "GET",
            headers: {
              "x-uas-tenant-id": TENANT_BKP,
              "x-uas-session-token": token,
            },
          })
        );
        assert.equal(listRes.status, 200);
        const listJson = (await listRes.json()) as {
          backups?: Array<{ filename: string }>;
        };
        assert.ok(listJson.backups?.some((b) => b.filename === postJson.filename));
        assert.ok(listJson.backups?.some((b) => b.filename === goodRestoreJson.preRestoreSnapshot));
        assert.equal(
          listJson.backups?.some((b) => b.filename.startsWith("standalone_dev_")),
          false
        );

        // DELETE manual snapshot works & deletes cleanly
        const delRes = await backupDELETE(
          new NextRequest(
            `https://${TENANT_BKP}.qat.world/api/system/backups/${encodeURIComponent(postJson.filename!)}`,
            {
              method: "DELETE",
              headers: {
                "content-type": "application/json",
                "x-uas-tenant-id": TENANT_BKP,
                "x-uas-session-token": token,
              },
              body: JSON.stringify({}),
            }
          ),
          { params: Promise.resolve({ filename: postJson.filename! }) }
        );
        assert.equal(delRes.status, 200);

        // Clean save test envelope check
        await saveBackupEnvelopeToTenantDir(`manual-extra-${TENANT_BKP}.uasbak`, postJson, TENANT_BKP);
      }
    });
  });
});
