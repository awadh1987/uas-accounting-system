import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  canonicalizeLicensePayload,
  type UasLicensePayload,
  type UasSignedLicense,
} from "@/lib/licensing/licenseSchema";
import {
  resolveLicenseDataDirectory,
  resolveWritableProjectRoot,
} from "@/lib/licensing/verifier";

export function resolveLicensePrivateKeyPath(): string {
  const envPath = (process.env.UAS_LICENSE_PRIVATE_KEY_PATH || "").trim();
  if (envPath) return path.resolve(/*turbopackIgnore: true*/ envPath);
  const projectRoot = resolveWritableProjectRoot();
  return path.join(/*turbopackIgnore: true*/ projectRoot, "keys", "uas-license-private.pem");
}

export function hasLicensePrivateKey(): boolean {
  try {
    return fs.existsSync(/*turbopackIgnore: true*/ resolveLicensePrivateKeyPath());
  } catch {
    return false;
  }
}

export function signLicensePayload(payload: UasLicensePayload): UasSignedLicense {
  const privateKeyPath = resolveLicensePrivateKeyPath();
  if (!fs.existsSync(/*turbopackIgnore: true*/ privateKeyPath)) {
    throw new Error(`Ed25519 private signing key not found at ${privateKeyPath}`);
  }
  const privateKeyPem = fs.readFileSync(/*turbopackIgnore: true*/ privateKeyPath, "utf8");
  const privateKey = crypto.createPrivateKey(privateKeyPem);
  const canonical = canonicalizeLicensePayload(payload);
  const signature = crypto
    .sign(null, Buffer.from(canonical, "utf8"), privateKey)
    .toString("base64");
  return {
    ...payload,
    signature,
  };
}

export function writeSignedTenantLicenseArtifacts(input: {
  slug: string;
  signedLicense: UasSignedLicense;
  adminPasswordPlain?: string | null;
}): {
  uasPath: string;
  txtPath: string;
  uaskey: string;
} {
  const slug = input.slug.trim().toLowerCase();
  const dataDir = resolveLicenseDataDirectory();
  const licDir = path.join(/*turbopackIgnore: true*/ dataDir, "licenses", slug);
  fs.mkdirSync(/*turbopackIgnore: true*/ licDir, { recursive: true });

  const uasJson = JSON.stringify(input.signedLicense, null, 2);
  const uasPath = path.join(/*turbopackIgnore: true*/ licDir, `${slug}.uas`);
  const canonicalUasPath = path.join(/*turbopackIgnore: true*/ licDir, "license.uas");
  fs.writeFileSync(/*turbopackIgnore: true*/ uasPath, uasJson, "utf8");
  fs.writeFileSync(/*turbopackIgnore: true*/ canonicalUasPath, uasJson, "utf8");

  const uaskey = `UASKEY-${Buffer.from(JSON.stringify(input.signedLicense), "utf8").toString("base64")}`;
  const cred = input.signedLicense.admin_credentials;
  const adminPasswordLine =
    input.adminPasswordPlain ?? cred?.password ?? null;
  const txtLines = [
    uaskey,
    "",
    "-------------------------------------------------------",
    `Company Name    : ${input.signedLicense.company_name || input.signedLicense.customer_name}`,
    `Workspace URL   : ${input.signedLicense.tenant_url || `https://${slug}.qat.world`}`,
    `License ID      : ${input.signedLicense.license_id}`,
    ...(cred?.email ? [`Admin Email     : ${cred.email}`] : []),
    ...(cred?.username ? [`Admin Username  : ${cred.username}`] : []),
    ...(adminPasswordLine ? [`Admin Password  : ${adminPasswordLine}`] : []),
    "-------------------------------------------------------",
    "",
  ];
  const txtContent = txtLines.join("\n");
  const txtPath = path.join(/*turbopackIgnore: true*/ licDir, `${slug}.uaskey.txt`);
  fs.writeFileSync(/*turbopackIgnore: true*/ txtPath, txtContent, "utf8");

  // Mirror to .next/standalone when UAS_DATA_DIR is not explicitly overridden
  if (!(process.env.UAS_DATA_DIR || "").trim()) {
    const projectRoot = resolveWritableProjectRoot();
    const standaloneDir = path.join(/*turbopackIgnore: true*/ projectRoot, ".next", "standalone");
    if (fs.existsSync(/*turbopackIgnore: true*/ standaloneDir)) {
      const dstDir = path.join(/*turbopackIgnore: true*/ standaloneDir, "data", "licenses", slug);
      fs.mkdirSync(/*turbopackIgnore: true*/ dstDir, { recursive: true });
      fs.writeFileSync(path.join(/*turbopackIgnore: true*/ dstDir, `${slug}.uas`), uasJson, "utf8");
      fs.writeFileSync(path.join(/*turbopackIgnore: true*/ dstDir, "license.uas"), uasJson, "utf8");
      fs.writeFileSync(path.join(/*turbopackIgnore: true*/ dstDir, `${slug}.uaskey.txt`), txtContent, "utf8");
    }
  }

  return { uasPath, txtPath, uaskey };
}
