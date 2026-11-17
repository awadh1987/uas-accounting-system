import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  canonicalizeLicensePayload,
  validateLicenseStructure,
  type UasSignedLicense,
} from "../src/lib/licensing/licenseSchema";
import { verifyLicense, verifyLicenseSignature } from "../src/lib/licensing/verifier";
import { getMachineHwid, getMachineRequestCode, matchHwidOrRequestCode } from "../src/lib/licensing/hwid";

describe("UAS Ed25519 Cryptographic Licensing Engine", () => {
  it("computes deterministic machine HWID and Request Code", () => {
    const hwid = getMachineHwid();
    const reqCode = getMachineRequestCode();

    assert.ok(hwid && hwid.length === 64, "HWID should be 64-char SHA256 hex string");
    assert.match(reqCode, /^REQ-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}$/, "Request code format matches");
    assert.ok(matchHwidOrRequestCode(reqCode, hwid), "Request code must match machine HWID");
  });

  it("verifies freshly issued license against public key", () => {
    const licensePath = path.resolve(process.cwd(), "license.uas");
    assert.ok(fs.existsSync(licensePath), "license.uas should exist from issuance test");

    const raw = fs.readFileSync(licensePath, "utf8");
    const parsed = JSON.parse(raw);
    const validated = validateLicenseStructure(parsed);
    assert.ok(validated, "License structure must be valid");

    const isSigValid = verifyLicenseSignature(validated);
    assert.equal(isSigValid, true, "Ed25519 signature must verify against embedded public key");

    const result = verifyLicense(validated, "local");
    assert.equal(result.valid, true, "License must be valid for current machine in local mode");
    assert.equal(result.status, "ACTIVE");
  });

  it("rejects tampered license payloads", () => {
    const licensePath = path.resolve(process.cwd(), "license.uas");
    const raw = fs.readFileSync(licensePath, "utf8");
    const tampered = JSON.parse(raw);

    // Tamper with customer name or max seats
    tampered.max_lan_seats = 9999;
    const isSigValid = verifyLicenseSignature(tampered);
    assert.equal(isSigValid, false, "Tampered license payload must fail Ed25519 signature verification");
  });

  it("rejects foreign HWID licenses", () => {
    // Create a new keypair to sign a foreign license
    const { privateKey } = crypto.generateKeyPairSync("ed25519");
    const foreignLicense: UasSignedLicense = {
      license_id: "UAS-FOREIGN-01",
      customer_name: "Foreign Machine Corp",
      hwid: "0000000000000000000000000000000000000000000000000000000000000000",
      allowed_modes: ["local", "lan"],
      max_branches: 1,
      max_lan_seats: 5,
      expires_at: "2030-01-01T00:00:00Z",
      issued_at: "2026-01-01T00:00:00Z",
      signature: "",
    };

    const canonical = canonicalizeLicensePayload(foreignLicense);
    foreignLicense.signature = crypto.sign(null, Buffer.from(canonical, "utf8"), privateKey).toString("base64");

    const result = verifyLicense(foreignLicense);
    assert.equal(result.valid, false);
    // Even if signature were checked against custom key, HWID will not match current machine
    assert.equal(matchHwidOrRequestCode(foreignLicense.hwid, getMachineHwid()), false);
  });

  it("enforces monotonic clock and detects clock rollbacks", async () => {
    const { checkLicenseAndClock } = await import("../src/lib/licensing/guard");
    const { prisma } = await import("../src/lib/prisma");

    // First check should succeed
    const firstCheck = await checkLicenseAndClock("local");
    assert.equal(firstCheck.allowed, true);

    // Simulate clock rollback: update DB lastVerifiedUtc to 2 hours in the future
    const futureTime = new Date(Date.now() + 2 * 60 * 60 * 1000);
    await prisma.licenseState.upsert({
      where: { id: "active" },
      update: { lastVerifiedUtc: futureTime },
      create: { id: "active", lastVerifiedUtc: futureTime, status: "ACTIVE" },
    });

    // Check again with current time: should detect tampering!
    const tamperCheck = await checkLicenseAndClock("local");
    assert.equal(tamperCheck.allowed, false);
    assert.equal(tamperCheck.code, "LICENSE_CLOCK_TAMPER");

    // Restore valid timestamp for remaining tests
    await prisma.licenseState.update({
      where: { id: "active" },
      data: { status: "ACTIVE", lastVerifiedUtc: new Date() },
    });
  });

  it("enforces max_lan_seats in LAN mode", async () => {
    const { checkLicenseAndClock } = await import("../src/lib/licensing/guard");
    const { prisma } = await import("../src/lib/prisma");

    // Reset license state seat registry to empty
    await prisma.licenseState.update({
      where: { id: "active" },
      data: { seatRegistryJson: "[]", status: "ACTIVE", lastVerifiedUtc: new Date() },
    });

    // Simulate 10 unique devices connecting
    for (let i = 1; i <= 10; i++) {
      const res = await checkLicenseAndClock("lan", `seat-token-${i}`, `192.168.1.${10 + i}`, `PC-${i}`);
      assert.equal(res.allowed, true, `Seat ${i} should be permitted`);
    }

    // 11th device should be rejected since max_lan_seats is 10
    const eleventhRes = await checkLicenseAndClock("lan", "seat-token-11", "192.168.1.99", "PC-11");
    assert.equal(eleventhRes.allowed, false);
    assert.equal(eleventhRes.code, "LICENSE_SEAT_LIMIT");
    assert.ok(eleventhRes.error?.includes("Maximum LAN seats"), "Error message must include English text");
    assert.ok(eleventhRes.error?.includes("أجهزة"), "Error message must include Arabic text");

    // Existing active seat reconnecting should still be permitted
    const existingRes = await checkLicenseAndClock("lan", "seat-token-1", "192.168.1.11", "PC-1");
    assert.equal(existingRes.allowed, true, "Existing registered seat should be allowed");
  });
});
