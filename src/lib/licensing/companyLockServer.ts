import { prisma } from "@/lib/prisma";
import { isCompanyLockedPayload, type UasSignedLicense } from "./licenseSchema";
import { loadInstalledLicense, verifyLicenseSignature } from "./verifier";
import type { ProfileNames, ProfileRepo } from "./companyLock";

export type { ProfileNames, ProfileRepo };

/** EnterpriseProfile (id "default") repository. */
export function createPrismaProfileRepo(): ProfileRepo {
  return {
    async get() {
      const row = await prisma.enterpriseProfile.findUnique({
        where: { id: "default" },
        select: { legalNameAr: true, legalNameEn: true, isConfigured: true },
      });
      return row ? { legalNameAr: row.legalNameAr, legalNameEn: row.legalNameEn, isConfigured: row.isConfigured } : null;
    },
    async adopt(patch) {
      await prisma.enterpriseProfile.upsert({
        where: { id: "default" },
        update: patch,
        create: { id: "default", ...patch },
      });
    },
  };
}

/**
 * The installed license, but only if it is a company-locked (v2) license carrying a VALID Ed25519
 * signature — a forged / hand-edited license file can never impose (or lift) the name lock.
 */
export function loadActiveLockedLicense(): UasSignedLicense | null {
  const { license } = loadInstalledLicense();
  if (!license || !isCompanyLockedPayload(license)) return null;
  return verifyLicenseSignature(license) ? license : null;
}
