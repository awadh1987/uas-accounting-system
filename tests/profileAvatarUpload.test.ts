import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { NextRequest } from "next/server";
import { prisma } from "../src/lib/prisma";
import {
  ensureTenantRegistered,
  resetTenantClientsForTests,
  resolveTenantDbFilePath,
  runWithTenant,
} from "../src/lib/tenant";
import { issueSessionToken, SESSION_COOKIE_NAME } from "../src/lib/authSession";
import { getBootstrapState, hashPassword } from "../src/lib/serverBootstrap";
import { ensure6GenerationCoaHierarchy } from "../src/lib/accountingCoreEngine";
import {
  deleteUserAvatarFiles,
  resolvePublicAvatarsDir,
  validateAvatarUpload,
} from "../src/lib/avatarAssets";
import { DELETE as avatarDELETE, POST as avatarPOST } from "../src/app/api/users/me/avatar/route";
import { PATCH as profilePATCH } from "../src/app/api/users/me/profile/route";
import { GET as publicAvatarGET } from "../src/app/api/public/avatar/[tenantKey]/[filename]/route";

const TEST_TAG = `${Math.floor(10000 + Math.random() * 90000)}`;
const TEST_TENANT = `p4-av-${TEST_TAG}`;

// Minimal valid 1x1 PNG binary
const VALID_PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

// Minimal valid JPEG header + EOI
const VALID_JPEG_BYTES = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9,
]);

describe("Phase 4: Real User Profile Picture Support", () => {
  let userId = "";
  let userToken = "";

  before(async () => {
    const tmpDb = path.join(process.cwd(), "data", `test_phase4_base_${TEST_TAG}.db`);
    process.env.DATABASE_URL = `file:${tmpDb}`;

    const dbFile = resolveTenantDbFilePath(TEST_TENANT);
    if (fs.existsSync(dbFile)) fs.unlinkSync(dbFile);
    ensureTenantRegistered(TEST_TENANT, "Avatar Test Org", { slug: TEST_TENANT });

    await runWithTenant(TEST_TENANT, async () => {
      await ensure6GenerationCoaHierarchy(prisma);
      const user = await prisma.user.create({
        data: {
          username: `avatar_user_${TEST_TAG}`,
          name: "أحمد علي",
          fullName: "أحمد علي",
          email: `avatar_${TEST_TAG}@qat.world`,
          passwordHash: hashPassword("Secret123!"),
          role: "CHIEF_ACCOUNTANT",
          department: "Finance",
          active: true,
          isActive: true,
        },
      });
      userId = user.id;
      userToken = issueSessionToken({
        userId: user.id,
        userRole: user.role,
        tenantId: TEST_TENANT,
        userDisplay: user.name,
      });
    });
  });

  after(async () => {
    deleteUserAvatarFiles(TEST_TENANT, userId);
    const avDir = resolvePublicAvatarsDir(TEST_TENANT);
    if (fs.existsSync(avDir)) {
      fs.rmSync(avDir, { recursive: true, force: true });
    }
    resetTenantClientsForTests();
    const dbFile = resolveTenantDbFilePath(TEST_TENANT);
    if (fs.existsSync(dbFile)) fs.unlinkSync(dbFile);
    const baseDb = path.join(process.cwd(), "data", `test_phase4_base_${TEST_TAG}.db`);
    if (fs.existsSync(baseDb)) fs.unlinkSync(baseDb);
  });

  it("validates image magic bytes, blocks SVG/script payloads & oversized images", () => {
    const svgSpoof = Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>");
    const resSpoof = validateAvatarUpload({
      buffer: svgSpoof,
      mimeType: "image/png",
      filename: "evil.png",
    });
    assert.equal(resSpoof.ok, false);

    const oversized = Buffer.alloc(2 * 1024 * 1024 + 64, 0xff);
    oversized[0] = 0xff;
    oversized[1] = 0xd8;
    oversized[2] = 0xff;
    const resSize = validateAvatarUpload({
      buffer: oversized,
      mimeType: "image/jpeg",
      filename: "huge.jpg",
    });
    assert.equal(resSize.ok, false);

    const resOk = validateAvatarUpload({
      buffer: VALID_PNG_BYTES,
      mimeType: "image/png",
      filename: "me.png",
    });
    assert.equal(resOk.ok, true);
    if (resOk.ok) assert.equal(resOk.ext, "png");
  });

  it("uploads, serves, replaces, persists across bootstrap, and deletes real avatar photos", async () => {
    // 1. Unauthenticated upload fails 401
    const unauthForm = new FormData();
    unauthForm.append("file", new File([VALID_PNG_BYTES], "av.png", { type: "image/png" }));
    const unauthRes = await avatarPOST(
      new NextRequest("http://localhost:3000/api/users/me/avatar", {
        method: "POST",
        headers: { "x-uas-tenant-id": TEST_TENANT },
        body: unauthForm,
      })
    );
    assert.equal(unauthRes.status, 401);

    // 2. Spoofed MIME/content upload fails 400
    const badForm = new FormData();
    badForm.append(
      "file",
      new File([Buffer.from("<html>not an image</html>")], "fake.png", { type: "image/png" })
    );
    const badRes = await avatarPOST(
      new NextRequest("http://localhost:3000/api/users/me/avatar", {
        method: "POST",
        headers: {
          "x-uas-tenant-id": TEST_TENANT,
          cookie: `${SESSION_COOKIE_NAME}=${userToken}`,
        },
        body: badForm,
      })
    );
    assert.equal(badRes.status, 400);

    // 3. Valid PNG upload succeeds, persists on User & bootstrap state, and serves via /api/public/avatar
    const okForm = new FormData();
    okForm.append("file", new File([VALID_PNG_BYTES], "profile.png", { type: "image/png" }));
    const upRes = await avatarPOST(
      new NextRequest("http://localhost:3000/api/users/me/avatar", {
        method: "POST",
        headers: {
          "x-uas-tenant-id": TEST_TENANT,
          cookie: `${SESSION_COOKIE_NAME}=${userToken}`,
        },
        body: okForm,
      })
    );
    assert.equal(upRes.status, 200);
    const upBody = (await upRes.json()) as {
      success: boolean;
      avatarUrl: string;
      user: { avatarUrl?: string };
    };
    assert.equal(upBody.success, true);
    assert.ok(
      upBody.avatarUrl.startsWith("/api/public/avatar/"),
      `Unexpected avatarUrl: ${upBody.avatarUrl}`
    );
    assert.equal(upBody.user.avatarUrl, upBody.avatarUrl);

    // Verify bootstrap state contains persisted avatarUrl
    const bootState = await runWithTenant(TEST_TENANT, async () => getBootstrapState());
    const bootUser = bootState.users.find((u) => u.id === userId);
    assert.equal(bootUser?.avatarUrl, upBody.avatarUrl);

    // Verify public endpoint serves exact binary bytes
    const urlParts = upBody.avatarUrl.split("/");
    const urlTenantKey = urlParts[urlParts.length - 2]!;
    const filename1 = urlParts[urlParts.length - 1]!;
    const serveRes = await publicAvatarGET(
      new NextRequest(`http://localhost:3000${upBody.avatarUrl}`),
      { params: Promise.resolve({ tenantKey: urlTenantKey, filename: filename1 }) }
    );
    assert.equal(serveRes.status, 200);
    assert.equal(serveRes.headers.get("content-type"), "image/png");
    const servedBytes = Buffer.from(await serveRes.arrayBuffer());
    assert.equal(Buffer.compare(servedBytes, VALID_PNG_BYTES), 0);

    // Path traversal returns 404
    const travRes = await publicAvatarGET(
      new NextRequest("http://localhost:3000/api/public/avatar/x/..%2Fsecret.png"),
      { params: Promise.resolve({ tenantKey: TEST_TENANT, filename: "../secret.png" }) }
    );
    assert.equal(travRes.status, 404);

    // 4. Replace with JPEG via JSON dataUrl -> old PNG deleted from disk, new JPEG served
    const jpegDataUrl = `data:image/jpeg;base64,${VALID_JPEG_BYTES.toString("base64")}`;
    const repRes = await avatarPOST(
      new NextRequest("http://localhost:3000/api/users/me/avatar", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-uas-tenant-id": TEST_TENANT,
          cookie: `${SESSION_COOKIE_NAME}=${userToken}`,
        },
        body: JSON.stringify({ dataUrl: jpegDataUrl }),
      })
    );
    assert.equal(repRes.status, 200);
    const repBody = (await repRes.json()) as { avatarUrl: string };
    assert.ok(repBody.avatarUrl.endsWith(".jpg"));
    assert.equal(
      fs.existsSync(path.join(resolvePublicAvatarsDir(urlTenantKey), filename1)),
      false,
      "Prior avatar file must be cleaned up on replacement"
    );

    // 5. Profile PATCH rejects javascript: URL
    const xssPatch = await profilePATCH(
      new NextRequest("http://localhost:3000/api/users/me/profile", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-uas-tenant-id": TEST_TENANT,
          cookie: `${SESSION_COOKIE_NAME}=${userToken}`,
        },
        body: JSON.stringify({ avatarUrl: "javascript:alert(1)" }),
      })
    );
    assert.equal(xssPatch.status, 400);

    // 6. DELETE clears avatarUrl in DB & removes file
    const delRes = await avatarDELETE(
      new NextRequest("http://localhost:3000/api/users/me/avatar", {
        method: "DELETE",
        headers: {
          "x-uas-tenant-id": TEST_TENANT,
          cookie: `${SESSION_COOKIE_NAME}=${userToken}`,
        },
      })
    );
    assert.equal(delRes.status, 200);
    const delBody = (await delRes.json()) as { avatarUrl: string; user: { avatarUrl?: string } };
    assert.equal(delBody.avatarUrl, "");
    assert.equal(delBody.user.avatarUrl, "");
  });
});
