import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma";
import { hashPassword } from "../src/lib/serverBootstrap";
import { archiveOrRestoreUser, safeDeleteOrArchiveUser } from "../src/lib/userLifecycle";
import { handleOfflineAndroidApiRequest, type OfflineStorageLike } from "../src/lib/offlineAndroidStore";

function createMemoryStorage(): OfflineStorageLike {
  const store = new Map<string, string>();
  return {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
  };
}

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

  it("blocks non-admin roles and blocks self-deletion with specific guardReason and guidance", async () => {
    const nonAdminRes = await safeDeleteOrArchiveUser("some-user", {
      userId: "u2",
      userRole: "FIELD_ACCOUNTANT",
      userDisplay: "Field Accountant",
    });
    assert.equal(nonAdminRes.ok, false);
    assert.equal(nonAdminRes.status, 403);
    assert.equal(nonAdminRes.guardReason, "INSUFFICIENT_PERMISSIONS");
    assert.ok(nonAdminRes.guidance && nonAdminRes.guidance.length > 0);

    const selfRes = await safeDeleteOrArchiveUser(ADMIN_ACTOR.userId, ADMIN_ACTOR);
    assert.equal(selfRes.ok, false);
    assert.equal(selfRes.status, 400);
    assert.equal(selfRes.guardReason, "SELF_DELETION");
    assert.ok(selfRes.guidance && selfRes.guidance.includes("حالياً"));

    const notFoundRes = await safeDeleteOrArchiveUser("non-existent-user-xyz", ADMIN_ACTOR);
    assert.equal(notFoundRes.ok, false);
    assert.equal(notFoundRes.status, 404);
    assert.equal(notFoundRes.guardReason, "USER_NOT_FOUND");
    assert.ok(notFoundRes.guidance && notFoundRes.guidance.length > 0);
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

  it("finds user by targetEmail option in safeDeleteOrArchiveUser if id does not directly match", async () => {
    const email = `${TEST_PREFIX}-lookup@company.test`;
    const user = await prisma.user.create({
      data: {
        username: `${TEST_PREFIX}_lookup`,
        name: "مستخدم للبحث بالإيميل",
        fullName: "مستخدم للبحث بالإيميل - Test",
        email,
        passwordHash: hashPassword("123456"),
        role: "FIELD_ACCOUNTANT",
        department: "الفروع",
        active: true,
        isActive: true,
      },
    });
    createdUserIds.push(user.id);

    // Call safeDeleteOrArchiveUser with an arbitrary non-matching id string, but valid targetEmail
    const outcome = await safeDeleteOrArchiveUser("unknown-or-legacy-id", ADMIN_ACTOR, {
      targetEmail: email,
    });
    assert.equal(outcome.ok, true);
    assert.equal(outcome.deleted, true);

    const check = await prisma.user.findUnique({ where: { id: user.id } });
    assert.equal(check, null);
  });

  it("verifies offline store API returns actionable guidance on delete guards and password reset errors", async () => {
    const memStorage = createMemoryStorage();

    // 1. Password reset with short password (< 6 chars) on existing user (u1)
    const shortPassRes = await handleOfflineAndroidApiRequest(
      "/api/users/u1/reset-password",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          newPassword: "123",
          actor: { userId: "u1", userDisplay: "Admin", userRole: "SUPER_ADMIN" },
        }),
      },
      memStorage
    );
    assert.equal(shortPassRes.status, 400);
    const shortPassJson = await shortPassRes.json();
    assert.equal(shortPassJson.code, "PASSWORD_TOO_SHORT");
    assert.ok(shortPassJson.guidance && shortPassJson.guidance.includes("6 أحرف"));

    // 2. Password reset for non-existent user
    const notFoundReset = await handleOfflineAndroidApiRequest(
      "/api/users/non-existent-xyz/reset-password",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          newPassword: "ValidPassword123!",
          actor: { userId: "u1", userDisplay: "Admin", userRole: "SUPER_ADMIN" },
        }),
      },
      memStorage
    );
    assert.equal(notFoundReset.status, 404);
    const notFoundResetJson = await notFoundReset.json();
    assert.equal(notFoundResetJson.code, "USER_NOT_FOUND");
    assert.ok(notFoundResetJson.guidance && notFoundResetJson.guidance.length > 0);

    // 3. User delete self-deletion guard in offline store
    const selfDelRes = await handleOfflineAndroidApiRequest(
      "/api/users/u1",
      {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetUserId: "u1",
          actor: { userId: "u1", userDisplay: "Admin", userRole: "SUPER_ADMIN" },
        }),
      },
      memStorage
    );
    assert.equal(selfDelRes.status, 400);
    const selfDelJson = await selfDelRes.json();
    assert.equal(selfDelJson.guardReason, "SELF_DELETION");
    assert.ok(selfDelJson.guidance && selfDelJson.guidance.includes("حالياً"));
  });
});
