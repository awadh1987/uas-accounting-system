import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma";
import { hashPassword } from "../src/lib/serverBootstrap";
import { archiveOrRestoreUser, safeDeleteOrArchiveUser } from "../src/lib/userLifecycle";

const TEST_PREFIX = `ulc-${Date.now()}`;
const createdUserIds: string[] = [];
const createdLicenseIds: string[] = [];
const createdAuditLogIds: string[] = [];

const ADMIN_ACTOR = {
  userId: "u1",
  userRole: "SUPER_ADMIN",
  userDisplay: "مدير النظام العام (SUPER_ADMIN)",
};

describe("Phase 1 — User Archive (أرشفة) & Safe Delete (حذف) with License Seat Release", () => {
  after(async () => {
    // Cleanup any test records left in dev.db
    for (const id of createdAuditLogIds) {
      await prisma.auditLog.deleteMany({ where: { id } }).catch(() => {});
    }
    for (const lid of createdLicenseIds) {
      await prisma.licenseDeviceBinding.deleteMany({ where: { licenseId: lid } }).catch(() => {});
    }
    for (const uid of createdUserIds) {
      await prisma.auditLog.deleteMany({ where: { userId: uid } }).catch(() => {});
      await prisma.user.deleteMany({ where: { id: uid } }).catch(() => {});
    }
  });

  it("blocks non-admin roles and blocks self-deletion", async () => {
    const nonAdminRes = await safeDeleteOrArchiveUser("some-user", {
      userId: "u2",
      userRole: "FIELD_ACCOUNTANT",
      userDisplay: "Field Accountant",
    });
    assert.equal(nonAdminRes.ok, false);
    assert.equal(nonAdminRes.status, 403);

    const selfRes = await safeDeleteOrArchiveUser(ADMIN_ACTOR.userId, ADMIN_ACTOR);
    assert.equal(selfRes.ok, false);
    assert.equal(selfRes.status, 400);
  });

  it("permanently deletes a user with 0 linked records and releases their LicenseDeviceBinding seat", async () => {
    const email = `${TEST_PREFIX}-clean@company.test`;
    const licenseId = `LIC-${TEST_PREFIX}-1`;
    createdLicenseIds.push(licenseId);

    const user = await prisma.user.create({
      data: {
        username: `${TEST_PREFIX}_clean`,
        name: "مستخدم بدون قيود",
        fullName: "مستخدم بدون قيود - Test",
        email,
        passwordHash: hashPassword("123456"),
        role: "FIELD_ACCOUNTANT",
        department: "المالية",
        active: true,
        isActive: true,
      },
    });
    createdUserIds.push(user.id);

    await prisma.licenseDeviceBinding.create({
      data: {
        licenseId,
        userEmail: email,
        platform: "android",
        hwid: "HWID-TEST-CLEAN-01",
        deviceName: "Pixel Test",
        active: true,
      },
    });

    const outcome = await safeDeleteOrArchiveUser(user.id, ADMIN_ACTOR);
    assert.equal(outcome.ok, true);
    assert.equal(outcome.deleted, true);
    assert.equal(outcome.archived, false);
    assert.equal(outcome.seatsReleased, 1);

    const stillExists = await prisma.user.findUnique({ where: { id: user.id } });
    assert.equal(stillExists, null);

    const activeSeats = await prisma.licenseDeviceBinding.count({
      where: { licenseId, userEmail: email, active: true },
    });
    assert.equal(activeSeats, 0);
  });

  it("auto-archives a user with linked AuditLog records instead of deleting and releases their license seat", async () => {
    const email = `${TEST_PREFIX}-linked@company.test`;
    const licenseId = `LIC-${TEST_PREFIX}-2`;
    createdLicenseIds.push(licenseId);

    const user = await prisma.user.create({
      data: {
        username: `${TEST_PREFIX}_linked`,
        name: "محاسب مرتبط بقيود",
        fullName: "محاسب مرتبط بقيود - Test",
        email,
        passwordHash: hashPassword("123456"),
        role: "CHIEF_ACCOUNTANT",
        department: "الحسابات",
        active: true,
        isActive: true,
      },
    });
    createdUserIds.push(user.id);

    const audit = await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: "POST",
        entity: "JournalEntry",
        entityId: `JV-${TEST_PREFIX}`,
        details: { note: "Linked accounting action" },
      },
    });
    createdAuditLogIds.push(audit.id);

    await prisma.licenseDeviceBinding.create({
      data: {
        licenseId,
        userEmail: email,
        platform: "windows",
        hwid: "HWID-TEST-LINKED-01",
        deviceName: "Windows PC",
        active: true,
      },
    });

    const outcome = await safeDeleteOrArchiveUser(user.id, ADMIN_ACTOR);
    assert.equal(outcome.ok, true);
    assert.equal(outcome.deleted, false);
    assert.equal(outcome.archived, true);
    assert.equal(outcome.seatsReleased, 1);
    assert.ok(outcome.message.includes("أرشفة المستخدم"));
    assert.equal(outcome.guardReason, "LINKED_RECORDS");
    assert.ok(outcome.guidance && outcome.guidance.length > 0);

    const archivedUser = await prisma.user.findUnique({ where: { id: user.id } });
    assert.ok(archivedUser);
    assert.equal(archivedUser.isActive, false);
    assert.equal(archivedUser.active, false);
    assert.ok(archivedUser.archivedAt instanceof Date);

    // Verify restore brings user back cleanly
    const restoreRes = await archiveOrRestoreUser(user.id, "restore", ADMIN_ACTOR);
    assert.equal(restoreRes.ok, true);
    assert.equal(restoreRes.restored, true);

    const restoredUser = await prisma.user.findUnique({ where: { id: user.id } });
    assert.ok(restoredUser);
    assert.equal(restoredUser.isActive, true);
    assert.equal(restoredUser.archivedAt, null);
  });
});
