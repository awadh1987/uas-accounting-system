import assert from "node:assert/strict";
import { describe, it } from "node:test";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  DEFAULT_MAX_USERS,
  DEFAULT_PER_USER_DEVICES,
  canonicalizeLicensePayload,
  companyNamesMatch,
  getLicenseSeatPolicy,
  isWildcardHwid,
  normalizeCompanyName,
  parseHwidTargets,
  validateLicenseStructure,
  type UasLicensePayload,
  type UasSignedLicense,
} from "../src/lib/licensing/licenseSchema";
import { matchHwidOrRequestCode } from "../src/lib/licensing/hwid";
import { verifyLicenseSignature } from "../src/lib/licensing/verifier";
import {
  checkProfileUpdateAgainstLock,
  companyMismatchMessage,
  evaluateCompanyLock,
  PLACEHOLDER_NAME_AR,
  PLACEHOLDER_NAME_EN,
  type ProfileNames,
  type ProfileRepo,
} from "../src/lib/licensing/companyLock";
import {
  bindSeat,
  MemorySeatStore,
  releaseSeat,
  seatPolicyFromLicense,
} from "../src/lib/licensing/seatService";
import { enforceActivationPolicy } from "../src/lib/licensing/activationPolicy";
import { releaseKeySeat, verifyKeyRequest } from "../src/lib/licensing/licenseAuthority";
import {
  activateOfflineClientLicense,
  createMemoryStorage,
  LocalStorageProfileStore,
  LocalStorageSeatStore,
  releaseOfflineClientSeat,
} from "../src/lib/licensing/seatClient";

const keyPair = crypto.generateKeyPairSync("ed25519");
const publicKeyPem = keyPair.publicKey.export({ type: "spki", format: "pem" }).toString();

function signLicense(payload: UasLicensePayload): UasSignedLicense {
  const canonical = canonicalizeLicensePayload(payload);
  const signature = crypto.sign(null, Buffer.from(canonical, "utf8"), keyPair.privateKey).toString("base64");
  return { ...payload, signature };
}

function v2Payload(overrides: Partial<UasLicensePayload> = {}): UasLicensePayload {
  return {
    license_id: "UAS-2026-7777",
    customer_name: "شركة الجابري للتجارة",
    company_name: "شركة الجابري للتجارة",
    hwid: "*",
    allowed_modes: ["local", "lan", "cloud"],
    max_branches: 3,
    max_lan_seats: 10,
    max_users: 7,
    per_user_devices: { windows: 1, android: 1 },
    expires_at: "2030-01-01T00:00:00.000Z",
    issued_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("normalizeCompanyName", () => {
  it("trims, collapses spaces and lowercases Latin characters", () => {
    assert.equal(normalizeCompanyName("  Al   JABRI \t Trading  Co  "), "al jabri trading co");
  });

  it("normalizes Arabic alef variants أ/إ/آ → ا", () => {
    assert.equal(normalizeCompanyName("أحمد"), "احمد");
    assert.equal(normalizeCompanyName("إبراهيم"), "ابراهيم");
    assert.equal(normalizeCompanyName("آل"), "ال");
  });

  it("normalizes ة → ه and ى → ي", () => {
    assert.equal(normalizeCompanyName("شركة"), "شركه");
    assert.equal(normalizeCompanyName("مصطفى"), "مصطفي");
  });

  it("treats spelling variants of the same Arabic name as equal", () => {
    assert.equal(companyNamesMatch("شركة  أبناء  مصطفى", "شركه ابناء مصطفي"), true);
    assert.equal(companyNamesMatch("شركة الجابري", "شركة العامري"), false);
  });

  it("ignores bidi marks, tatweel and diacritics", () => {
    assert.equal(normalizeCompanyName("\u200Fشـركـة\u200E"), "شركه");
    assert.equal(normalizeCompanyName("شَرِكَة"), "شركه");
  });

  it("never matches empty names", () => {
    assert.equal(normalizeCompanyName(""), "");
    assert.equal(companyNamesMatch("", ""), false);
    assert.equal(companyNamesMatch("   ", "  "), false);
  });
});

describe("Extended Ed25519 payload (v2 company-locked)", () => {
  it("verifies a v2 signed license and covers the new fields in the signature", () => {
    const lic = signLicense(v2Payload());
    assert.equal(verifyLicenseSignature(lic, publicKeyPem), true);
  });

  it("survives validateLicenseStructure round-trip with the signature intact", () => {
    const lic = signLicense(v2Payload());
    const roundTrip = validateLicenseStructure(JSON.parse(JSON.stringify(lic)));
    assert.ok(roundTrip);
    assert.equal(roundTrip.company_name, "شركة الجابري للتجارة");
    assert.equal(roundTrip.max_users, 7);
    assert.deepEqual(roundTrip.per_user_devices, { windows: 1, android: 1 });
    assert.equal(verifyLicenseSignature(roundTrip, publicKeyPem), true);
  });

  it("rejects tampering with company_name, max_users or per_user_devices", () => {
    const lic = signLicense(v2Payload());
    assert.equal(verifyLicenseSignature({ ...lic, company_name: "Another Co" }, publicKeyPem), false);
    assert.equal(verifyLicenseSignature({ ...lic, max_users: 70 }, publicKeyPem), false);
    assert.equal(
      verifyLicenseSignature({ ...lic, per_user_devices: { windows: 5, android: 1 } }, publicKeyPem),
      false
    );
    assert.equal(verifyLicenseSignature({ ...lic, hwid: "AAAA" }, publicKeyPem), false);
  });

  it("rejects stripping v2 fields from a v2 license (downgrade attack)", () => {
    const lic = signLicense(v2Payload());
    const { company_name, max_users, per_user_devices, ...legacyShape } = lic;
    void company_name; void max_users; void per_user_devices;
    assert.equal(verifyLicenseSignature(legacyShape as UasSignedLicense, publicKeyPem), false);
  });

  it("rejects injecting v2 fields into a legacy license", () => {
    const legacy = signLicense({
      license_id: "UAS-LEGACY-1",
      customer_name: "Legacy Co",
      hwid: "ANY",
      allowed_modes: ["local"],
      max_branches: 1,
      max_lan_seats: 1,
      expires_at: "2030-01-01T00:00:00.000Z",
      issued_at: "2026-01-01T00:00:00.000Z",
    });
    assert.equal(verifyLicenseSignature(legacy, publicKeyPem), true);
    assert.equal(
      verifyLicenseSignature({ ...legacy, company_name: "Legacy Co", max_users: 99 }, publicKeyPem),
      false
    );
  });

  it("keeps the legacy canonical form byte-identical (existing licenses keep verifying)", () => {
    const canonical = canonicalizeLicensePayload({
      license_id: "uas-1",
      customer_name: " X ",
      hwid: "abc",
      allowed_modes: ["lan", "local"],
      max_branches: 2,
      max_lan_seats: 3,
      expires_at: "e",
      issued_at: "i",
    });
    assert.equal(
      canonical,
      '{"allowed_modes":["lan","local"],"customer_name":"X","expires_at":"e","hwid":"ABC","issued_at":"i","license_id":"UAS-1","max_branches":2,"max_lan_seats":3}'
    );
  });

  it("applies defaults max_users=7 and per_user_devices={1,1} when omitted", () => {
    const lic = validateLicenseStructure({
      ...signLicense(v2Payload()),
      max_users: undefined,
      per_user_devices: undefined,
    });
    assert.ok(lic);
    assert.equal(lic.max_users, DEFAULT_MAX_USERS);
    assert.deepEqual(lic.per_user_devices, DEFAULT_PER_USER_DEVICES);
    assert.equal(DEFAULT_MAX_USERS, 7);
    // Signature issued with explicit defaults still verifies
    assert.equal(verifyLicenseSignature(lic, publicKeyPem), true);
  });

  it("rejects malformed v2 fields", () => {
    const base = signLicense(v2Payload());
    assert.equal(validateLicenseStructure({ ...base, company_name: "   " }), null);
    assert.equal(validateLicenseStructure({ ...base, company_name: 42 }), null);
    assert.equal(validateLicenseStructure({ ...base, max_users: 0 }), null);
    assert.equal(validateLicenseStructure({ ...base, max_users: 2.5 }), null);
    assert.equal(validateLicenseStructure({ ...base, per_user_devices: { windows: -1, android: 1 } }), null);
    assert.equal(validateLicenseStructure({ ...base, per_user_devices: { windows: 0, android: 0 } }), null);
    assert.equal(validateLicenseStructure({ ...base, per_user_devices: "x" }), null);
  });

  it("exposes the effective seat policy", () => {
    const policy = getLicenseSeatPolicy(v2Payload());
    assert.equal(policy.companyLocked, true);
    assert.equal(policy.companyName, "شركة الجابري للتجارة");
    assert.equal(policy.maxUsers, 7);
    assert.deepEqual(policy.perUserDevices, { windows: 1, android: 1 });
    assert.equal(policy.seatManaged, true);

    const legacy = getLicenseSeatPolicy({ ...v2Payload(), company_name: undefined, hwid: "AB12" });
    assert.equal(legacy.companyLocked, false);
    assert.equal(legacy.companyName, null);
    assert.equal(legacy.seatManaged, false);
  });
});

describe("HWID parsing: '*', comma-separated and single", () => {
  const machine = "866F1933C42E97649F106C970FAE8A564943083BA7080668E9A54E963D51D898";
  const other1 = "1".repeat(64);
  const other2 = "2".repeat(64);

  it("parses wildcard, lists and singles", () => {
    assert.deepEqual(parseHwidTargets("*"), { wildcard: true, targets: [] });
    assert.deepEqual(parseHwidTargets(" * "), { wildcard: true, targets: [] });
    assert.deepEqual(parseHwidTargets("aa, bb ,,cc"), { wildcard: false, targets: ["AA", "BB", "CC"] });
    assert.deepEqual(parseHwidTargets("abc"), { wildcard: false, targets: ["ABC"] });
    assert.equal(isWildcardHwid("*"), true);
    assert.equal(isWildcardHwid(machine), false);
  });

  it("wildcard matches any machine", () => {
    assert.equal(matchHwidOrRequestCode("*", machine), true);
  });

  it("single HWID matches only the exact machine (full HWID or request code)", () => {
    assert.equal(matchHwidOrRequestCode(machine, machine), true);
    assert.equal(matchHwidOrRequestCode(other1, machine), false);
    assert.equal(matchHwidOrRequestCode("REQ-866F-1933-C42E-9764", machine), true);
  });

  it("comma-separated list matches if ANY entry matches", () => {
    assert.equal(matchHwidOrRequestCode(`${other1},${machine},${other2}`, machine), true);
    assert.equal(matchHwidOrRequestCode(`${other1}, ${other2}`, machine), false);
    assert.equal(matchHwidOrRequestCode(`${other1},REQ-866F-1933-C42E-9764`, machine), true);
  });

  it("empty target never matches", () => {
    assert.equal(matchHwidOrRequestCode("", machine), false);
    assert.equal(matchHwidOrRequestCode(" , ", machine), false);
  });

  it("canonicalization is order-stable per list and signature covers the HWID list", () => {
    const lic = signLicense(v2Payload({ hwid: `${other1},${other2}` }));
    assert.equal(verifyLicenseSignature(lic, publicKeyPem), true);
    assert.equal(verifyLicenseSignature({ ...lic, hwid: `${other1},${machine}` }, publicKeyPem), false);
  });
});

describe("Issuer CLI (scripts/licensing/issue-license.mjs)", () => {
  const root = process.cwd();
  const privateKeyExists = fs.existsSync(path.join(root, "keys", "uas-license-private.pem"));

  it("issues a v2 license whose signature verifies with the shipped public key", { skip: !privateKeyExists }, () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "uas-issue-"));
    const out = path.join(tmp, "company.uas");
    try {
      const stdout = execFileSync(
        process.execPath,
        [
          path.join(root, "scripts", "licensing", "issue-license.mjs"),
          "--company", "  شركة   الجابري  للتجارة ",
          "--users", "7",
          "--win-per-user", "1",
          "--android-per-user", "1",
          "--hwid", "*",
          "--modes", "local,lan,cloud",
          "--days", "365",
          "--out", out,
        ],
        { encoding: "utf8" }
      );

      assert.match(stdout, /Company Name\s*: شركة الجابري للتجارة/);
      assert.match(stdout, /Max Users\s*: 7/);
      assert.match(stdout, /Devices\/User\s*: 1 Windows \+ 1 Android/);
      assert.match(stdout, /UASKEY-/);

      const parsed = JSON.parse(fs.readFileSync(out, "utf8"));
      const lic = validateLicenseStructure(parsed);
      assert.ok(lic);
      assert.equal(lic.hwid, "*");
      assert.equal(lic.company_name, "شركة الجابري للتجارة");
      assert.equal(lic.max_users, 7);
      assert.deepEqual(lic.per_user_devices, { windows: 1, android: 1 });
      // Verifies against the real embedded public key (UAS_LICENSE_PUBLIC_KEY)
      assert.equal(verifyLicenseSignature(lic), true);

      // Full UASKEY token (also saved next to the license) decodes to the same signed license
      const keyFile = path.join(tmp, "company.uaskey.txt");
      const token = fs.readFileSync(keyFile, "utf8").trim();
      assert.ok(token.startsWith("UASKEY-"));
      const decoded = validateLicenseStructure(JSON.parse(Buffer.from(token.slice(7), "base64").toString("utf8")));
      assert.ok(decoded);
      assert.equal(verifyLicenseSignature(decoded), true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("supports multi-HWID lists and rejects a missing company", { skip: !privateKeyExists }, () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "uas-issue-"));
    const out = path.join(tmp, "multi.uas");
    try {
      execFileSync(
        process.execPath,
        [
          path.join(root, "scripts", "licensing", "issue-license.mjs"),
          "--company", "Multi HWID Co",
          "--hwid", "aaaa1111aaaa1111, bbbb2222bbbb2222",
          "--out", out,
        ],
        { encoding: "utf8" }
      );
      const lic = validateLicenseStructure(JSON.parse(fs.readFileSync(out, "utf8")));
      assert.ok(lic);
      assert.equal(lic.hwid, "AAAA1111AAAA1111,BBBB2222BBBB2222");
      assert.equal(verifyLicenseSignature(lic), true);

      assert.throws(
        () =>
          execFileSync(process.execPath, [path.join(root, "scripts", "licensing", "issue-license.mjs"), "--hwid", "*", "--out", out], {
            encoding: "utf8",
            stdio: "pipe",
          }),
        /--company/
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

function createMemoryProfileRepo(initial: ProfileNames | null = null): ProfileRepo & { current: ProfileNames | null } {
  return {
    current: initial,
    async get() {
      return this.current ? { ...this.current } : null;
    },
    async adopt(patch) {
      this.current = { ...patch };
    },
  };
}

describe("Phase 2 — Company-Name Lock & EnterpriseProfile Protection", () => {
  const licensedCompany = "شركة الجابري للتجارة";

  it("auto-initializes EnterpriseProfile when unconfigured or default placeholders", async () => {
    assert.equal(evaluateCompanyLock(licensedCompany, null).outcome, "ADOPT");
    const repo = createMemoryProfileRepo({
      legalNameAr: PLACEHOLDER_NAME_AR,
      legalNameEn: PLACEHOLDER_NAME_EN,
      isConfigured: false,
    });
    const store = new MemorySeatStore();
    const lic = signLicense(v2Payload({ company_name: licensedCompany }));

    const res = await enforceActivationPolicy(
      {
        license: lic,
        userEmail: "admin@aljabri.com",
        platform: "windows",
        hwid: "WIN-HWID-01",
      },
      { profileRepo: repo, seatStore: store }
    );

    assert.equal(res.ok, true);
    if (res.ok) {
      assert.equal(res.companyLock, "ADOPTED");
    }
    assert.deepEqual(repo.current, {
      legalNameAr: licensedCompany,
      legalNameEn: licensedCompany,
      isConfigured: true,
    });
  });

  it("blocks activation when existing EnterpriseProfile belongs to a different company", async () => {
    const repo = createMemoryProfileRepo({
      legalNameAr: "شركة العامري للاستثمار",
      legalNameEn: "Al-Ameri Investment Co.",
      isConfigured: true,
    });
    const store = new MemorySeatStore();
    const lic = signLicense(v2Payload({ company_name: licensedCompany }));

    const res = await enforceActivationPolicy(
      {
        license: lic,
        userEmail: "admin@aljabri.com",
        platform: "windows",
        hwid: "WIN-HWID-01",
      },
      { profileRepo: repo, seatStore: store }
    );

    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.equal(res.code, "COMPANY_MISMATCH");
      assert.equal(
        res.error,
        `اسم المنشأة لا يطابق الترخيص المعتمد / Company name mismatch: License belongs to '${licensedCompany}'.`
      );
    }
    // Zero seats bound when company lock rejects
    assert.equal((await store.list(lic.license_id)).length, 0);
  });

  it("blocks activation when operator types a mismatched confirmCompanyName", async () => {
    const repo = createMemoryProfileRepo(null);
    const store = new MemorySeatStore();
    const lic = signLicense(v2Payload({ company_name: licensedCompany }));

    const res = await enforceActivationPolicy(
      {
        license: lic,
        confirmCompanyName: "شركة أخرى مختلفة",
        userEmail: "admin@aljabri.com",
        platform: "windows",
        hwid: "WIN-HWID-01",
      },
      { profileRepo: repo, seatStore: store }
    );

    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.equal(res.code, "COMPANY_MISMATCH");
      assert.equal(res.error, companyMismatchMessage(licensedCompany));
    }
    assert.equal(repo.current, null);
  });

  it("blocks renaming legalNameAr/legalNameEn in Enterprise Settings to a violating company name", () => {
    const existing: ProfileNames = {
      legalNameAr: "شركة الجابري للتجارة",
      legalNameEn: "Al-Jabri Trading",
      isConfigured: true,
    };

    // Normalized Arabic variant of the licensed name is allowed
    const variantOk = checkProfileUpdateAgainstLock(licensedCompany, existing, {
      legalNameAr: "شركه الجابري للتجاره",
    });
    assert.equal(variantOk.ok, true);

    // Updating the secondary English translation while keeping Arabic locked is allowed
    const enOk = checkProfileUpdateAgainstLock(licensedCompany, existing, {
      legalNameEn: "Al-Jabri Trading Co. Ltd.",
    });
    assert.equal(enOk.ok, true);

    // Changing the locked Arabic legal name to another company is blocked
    const blocked = checkProfileUpdateAgainstLock(licensedCompany, existing, {
      legalNameAr: "شركة النخبة القابضة",
    });
    assert.equal(blocked.ok, false);
    if (!blocked.ok) {
      assert.equal(blocked.error, companyMismatchMessage(licensedCompany));
    }
  });
});

describe("Phase 2 — 7-User × (1 Windows + 1 Android) Quota Enforcement (SQLite Prisma, Cloud verify-key & Capacitor Offline)", () => {
  const licensedCompany = "شركة الجابري للتجارة";

  it("enforces 7 users × (1 Win + 1 Android), blocks 8th user & 2nd device, refreshes lastSeenAt, and frees slot on release in SQLite (Prisma)", async () => {
    const { prisma } = await import("../src/lib/prisma");
    const { createPrismaSeatStore } = await import("../src/lib/licensing/prismaSeatStore");
    const { ensureSqliteDatabaseReady } = await import("../src/lib/sqliteBootstrap");
    await ensureSqliteDatabaseReady();

    const licenseId = `UAS-SQLITE-SEAT-TEST-${Date.now()}`;
    const lic = signLicense(v2Payload({ license_id: licenseId, company_name: licensedCompany }));
    const policy = seatPolicyFromLicense(lic);
    const store = createPrismaSeatStore();
    const profileRepo = createMemoryProfileRepo(null);

    try {
      // 1) Activate 7 distinct users, each with 1 Windows + 1 Android device (14 total bindings)
      for (let i = 1; i <= 7; i++) {
        const email = `  User${i}@AlJabri.com `;
        const winRes = await enforceActivationPolicy(
          {
            license: lic,
            confirmCompanyName: "شركه الجابري للتجاره",
            userEmail: email,
            platform: "windows",
            hwid: `WIN-PC-0${i}`,
            deviceName: `Win-Laptop-${i}`,
          },
          { profileRepo, seatStore: store, now: new Date("2026-11-18T10:00:00Z") }
        );
        assert.equal(winRes.ok, true, `User ${i} Windows device should activate`);

        const andRes = await enforceActivationPolicy(
          {
            license: lic,
            userEmail: email.toLowerCase(),
            platform: "android",
            hwid: `ANDROID-PHONE-0${i}`,
            deviceName: `Android-Phone-${i}`,
          },
          { profileRepo, seatStore: store, now: new Date("2026-11-18T10:05:00Z") }
        );
        assert.equal(andRes.ok, true, `User ${i} Android device should activate`);
      }

      // 2) Re-activating the same (userEmail, platform, hwid) updates lastSeenAt and succeeds
      const laterTime = new Date("2026-11-18T15:30:00Z");
      const refreshRes = await bindSeat(
        store,
        policy,
        {
          licenseId,
          userEmail: "USER1@ALJABRI.COM",
          platform: "windows",
          hwid: "WIN-PC-01",
        },
        laterTime
      );
      assert.equal(refreshRes.ok, true);
      if (refreshRes.ok) {
        assert.equal(refreshRes.status, "REFRESHED");
        assert.equal(refreshRes.binding.lastSeenAt.toISOString(), laterTime.toISOString());
        assert.equal(refreshRes.usage.usedUsers, 7);
        assert.equal(refreshRes.usage.windowsBound, 7);
        assert.equal(refreshRes.usage.androidBound, 7);
      }

      // 3) 8th user is blocked on both Windows and Android
      const eighthWin = await bindSeat(store, policy, {
        licenseId,
        userEmail: "user8@aljabri.com",
        platform: "windows",
        hwid: "WIN-PC-08",
      });
      assert.equal(eighthWin.ok, false);
      if (!eighthWin.ok) {
        assert.equal(eighthWin.code, "MAX_USERS_REACHED");
        assert.match(eighthWin.error, /Maximum licensed users \(7\) reached/);
      }

      const eighthAndroid = await bindSeat(store, policy, {
        licenseId,
        userEmail: "user8@aljabri.com",
        platform: "android",
        hwid: "ANDROID-PHONE-08",
      });
      assert.equal(eighthAndroid.ok, false);
      if (!eighthAndroid.ok) {
        assert.equal(eighthAndroid.code, "MAX_USERS_REACHED");
      }

      // 4) 2nd Windows device for User 1 is blocked
      const secondWin = await bindSeat(store, policy, {
        licenseId,
        userEmail: "user1@aljabri.com",
        platform: "windows",
        hwid: "WIN-PC-01-SECOND-LAPTOP",
      });
      assert.equal(secondWin.ok, false);
      if (!secondWin.ok) {
        assert.equal(secondWin.code, "DEVICE_LIMIT_REACHED");
        assert.match(secondWin.error, /already has a bound Windows device/);
      }

      // 5) 2nd Android device for User 1 is blocked
      const secondAndroid = await bindSeat(store, policy, {
        licenseId,
        userEmail: "user1@aljabri.com",
        platform: "android",
        hwid: "ANDROID-PHONE-01-SECOND",
      });
      assert.equal(secondAndroid.ok, false);
      if (!secondAndroid.ok) {
        assert.equal(secondAndroid.code, "DEVICE_LIMIT_REACHED");
        assert.match(secondAndroid.error, /already has a bound Android device/);
      }

      // 6) Releasing User 1's Windows seat frees ONLY their Windows slot so their replacement laptop binds
      const relWin = await releaseSeat(store, policy, licenseId, "user1@aljabri.com", "windows");
      assert.equal(relWin.released, 1);
      assert.equal(relWin.usage.windowsBound, 6);
      assert.equal(relWin.usage.usedUsers, 7); // still active on Android

      const reboundWin = await bindSeat(store, policy, {
        licenseId,
        userEmail: "user1@aljabri.com",
        platform: "windows",
        hwid: "WIN-PC-01-REPLACEMENT",
      });
      assert.equal(reboundWin.ok, true);
      if (reboundWin.ok) {
        assert.equal(reboundWin.status, "REBOUND");
        assert.equal(reboundWin.usage.windowsBound, 7);
      }

      // 7) Releasing all devices for User 7 frees the 7th user slot, allowing User 8 to activate
      const relUser7 = await releaseSeat(store, policy, licenseId, "user7@aljabri.com", "all");
      assert.equal(relUser7.released, 2);
      assert.equal(relUser7.usage.usedUsers, 6);

      const user8NowOk = await bindSeat(store, policy, {
        licenseId,
        userEmail: "user8@aljabri.com",
        platform: "windows",
        hwid: "WIN-PC-08",
      });
      assert.equal(user8NowOk.ok, true);
      if (user8NowOk.ok) {
        assert.equal(user8NowOk.usage.usedUsers, 7);
      }
    } finally {
      await prisma.licenseDeviceBinding.deleteMany({ where: { licenseId } });
    }
  });

  it("enforces company lock and 7 × (1 Win + 1 Android) in cloud authority (/api/licensing/verify-key)", async () => {
    const store = new MemorySeatStore();
    const lic = signLicense(v2Payload({ license_id: "UAS-CLOUD-777", company_name: licensedCompany }));
    const key = `UASKEY-${Buffer.from(JSON.stringify(lic)).toString("base64")}`;

    // Wrong company is rejected with 403 COMPANY_MISMATCH
    const wrongCompany = await verifyKeyRequest(
      {
        key,
        company_name: "Wrong Corp",
        user_email: "user1@aljabri.com",
        platform: "windows",
        hwid: "CLOUD-WIN-1",
      },
      { store, publicKeyPem }
    );
    assert.equal(wrongCompany.status, 403);
    assert.equal(wrongCompany.body.code, "COMPANY_MISMATCH");
    assert.equal(wrongCompany.body.error, companyMismatchMessage(licensedCompany));

    // 7 users × (1 Win + 1 Android) succeed
    for (let i = 1; i <= 7; i++) {
      for (const platform of ["windows", "android"] as const) {
        const res = await verifyKeyRequest(
          {
            key,
            company_name: licensedCompany,
            user_email: `user${i}@aljabri.com`,
            platform,
            hwid: `CLOUD-${platform.toUpperCase()}-${i}`,
          },
          { store, publicKeyPem }
        );
        assert.equal(res.status, 200);
        assert.equal(res.body.success, true);
      }
    }

    // 8th user is rejected with 409 MAX_USERS_REACHED
    const user8 = await verifyKeyRequest(
      {
        key,
        company_name: licensedCompany,
        user_email: "user8@aljabri.com",
        platform: "windows",
        hwid: "CLOUD-WIN-8",
      },
      { store, publicKeyPem }
    );
    assert.equal(user8.status, 409);
    assert.equal(user8.body.code, "MAX_USERS_REACHED");

    // 2nd Android device for user 1 is rejected with 409 DEVICE_LIMIT_REACHED
    const secondAndroid = await verifyKeyRequest(
      {
        key,
        company_name: licensedCompany,
        user_email: "user1@aljabri.com",
        platform: "android",
        hwid: "CLOUD-ANDROID-1-NEW",
      },
      { store, publicKeyPem }
    );
    assert.equal(secondAndroid.status, 409);
    assert.equal(secondAndroid.body.code, "DEVICE_LIMIT_REACHED");

    // Cloud seat release frees user 1's Android slot
    const rel = await releaseKeySeat(
      { key, user_email: "user1@aljabri.com", platform: "android" },
      { store, publicKeyPem }
    );
    assert.equal(rel.status, 200);
    assert.equal(rel.body.released, 1);

    const retryAndroid = await verifyKeyRequest(
      {
        key,
        company_name: licensedCompany,
        user_email: "user1@aljabri.com",
        platform: "android",
        hwid: "CLOUD-ANDROID-1-NEW",
      },
      { store, publicKeyPem }
    );
    assert.equal(retryAndroid.status, 200);
  });

  it("enforces company lock, 7 × (1 Win + 1 Android) & SUPER_ADMIN seat release in Capacitor offline mode (WebCrypto)", async () => {
    const storage = createMemoryStorage();
    const seatStore = new LocalStorageSeatStore(storage);
    const profileStore = new LocalStorageProfileStore(storage);

    const lic = signLicense(v2Payload({ license_id: "UAS-CAP-OFFLINE-1", company_name: licensedCompany }));
    const uaskey = `UASKEY-${Buffer.from(JSON.stringify(lic)).toString("base64")}`;

    // 1) Activate 7 users × (1 Windows + 1 Android) offline using WebCrypto Ed25519 verification
    for (let i = 1; i <= 7; i++) {
      const win = await activateOfflineClientLicense(
        {
          activationKey: uaskey,
          confirmCompanyName: licensedCompany,
          userEmail: `user${i}@aljabri.com`,
          platform: "windows",
          hwid: `OFFLINE-WIN-${i}`,
        },
        { storage, seatStore, profileRepo: profileStore, publicKeyPem }
      );
      assert.equal(win.success, true);

      const and = await activateOfflineClientLicense(
        {
          licenseFileContent: JSON.stringify(lic),
          userEmail: `user${i}@aljabri.com`,
          platform: "android",
          hwid: `OFFLINE-AND-${i}`,
        },
        { storage, seatStore, profileRepo: profileStore, publicKeyPem }
      );
      assert.equal(and.success, true);
    }

    // Profile was automatically adopted on first activation
    const adoptedProfile = await profileStore.get();
    assert.equal(adoptedProfile?.isConfigured, true);
    assert.equal(adoptedProfile?.legalNameAr, licensedCompany);

    // Offline profile rename to a different company is blocked
    const renameBlocked = await profileStore.updateNames({ legalNameAr: "شركة مخالفة" }, publicKeyPem);
    assert.equal(renameBlocked.ok, false);

    // 2) Activating a license for a different company on the now-configured device is blocked
    const foreignCompanyLic = signLicense(
      v2Payload({ license_id: "UAS-CAP-FOREIGN", company_name: "شركة المنافس" })
    );
    const wrongCompany = await activateOfflineClientLicense(
      {
        licenseFileContent: JSON.stringify(foreignCompanyLic),
        userEmail: "user1@aljabri.com",
        platform: "android",
        hwid: "OFFLINE-AND-1",
      },
      { storage, seatStore, profileRepo: profileStore, publicKeyPem }
    );
    assert.equal(wrongCompany.success, false);
    if (!wrongCompany.success) {
      assert.equal(wrongCompany.code, "COMPANY_MISMATCH");
    }

    // 3) 8th user is blocked offline
    const user8 = await activateOfflineClientLicense(
      {
        activationKey: uaskey,
        userEmail: "user8@aljabri.com",
        platform: "android",
        hwid: "OFFLINE-AND-8",
      },
      { storage, seatStore, profileRepo: profileStore, publicKeyPem }
    );
    assert.equal(user8.success, false);
    if (!user8.success) {
      assert.equal(user8.code, "MAX_USERS_REACHED");
    }

    // 4) 2nd Android device for User 1 is blocked offline
    const secondPhone = await activateOfflineClientLicense(
      {
        activationKey: uaskey,
        userEmail: "user1@aljabri.com",
        platform: "android",
        hwid: "OFFLINE-AND-1-SECOND",
      },
      { storage, seatStore, profileRepo: profileStore, publicKeyPem }
    );
    assert.equal(secondPhone.success, false);
    if (!secondPhone.success) {
      assert.equal(secondPhone.code, "DEVICE_LIMIT_REACHED");
    }

    // 5) Non-SUPER_ADMIN cannot release a seat
    const nonAdminRel = await releaseOfflineClientSeat(
      { userEmail: "user1@aljabri.com", platform: "android", actorRole: "FIELD_ACCOUNTANT" },
      { storage, seatStore }
    );
    assert.equal(nonAdminRel.success, false);
    if (!nonAdminRel.success) {
      assert.equal(nonAdminRel.code, "FORBIDDEN");
    }

    // 6) SUPER_ADMIN releases User 1's Android seat, allowing the replacement phone to activate
    const adminRel = await releaseOfflineClientSeat(
      { userEmail: "user1@aljabri.com", platform: "android", actorRole: "SUPER_ADMIN" },
      { storage, seatStore }
    );
    assert.equal(adminRel.success, true);

    const replacementPhone = await activateOfflineClientLicense(
      {
        activationKey: uaskey,
        userEmail: "user1@aljabri.com",
        platform: "android",
        hwid: "OFFLINE-AND-1-SECOND",
      },
      { storage, seatStore, profileRepo: profileStore, publicKeyPem }
    );
    assert.equal(replacementPhone.success, true);
  });
});

