import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { SeatPlatform } from "./licenseSchema";
import type { SeatBindingRecord, SeatStore } from "./seatService";

type Db = PrismaClient | Prisma.TransactionClient;

function toRecord(row: {
  id: string;
  licenseId: string;
  userEmail: string;
  platform: string;
  hwid: string;
  deviceName: string;
  activatedAt: Date;
  lastSeenAt: Date;
  active: boolean;
}): SeatBindingRecord {
  return {
    id: row.id,
    licenseId: row.licenseId,
    userEmail: row.userEmail,
    platform: row.platform as SeatPlatform,
    hwid: row.hwid,
    deviceName: row.deviceName,
    activatedAt: row.activatedAt,
    lastSeenAt: row.lastSeenAt,
    active: row.active,
  };
}

/** SeatStore backed by the Prisma `LicenseDeviceBinding` table (local SQLite, LAN server, or qat.world). */
export function createPrismaSeatStore(db: Db = prisma, root: PrismaClient = prisma): SeatStore {
  return {
    async list(licenseId) {
      const rows = await db.licenseDeviceBinding.findMany({ where: { licenseId } });
      return rows.map(toRecord);
    },

    async upsert(record) {
      const row = await db.licenseDeviceBinding.upsert({
        where: {
          licenseId_userEmail_platform: {
            licenseId: record.licenseId,
            userEmail: record.userEmail,
            platform: record.platform,
          },
        },
        create: {
          licenseId: record.licenseId,
          userEmail: record.userEmail,
          platform: record.platform,
          hwid: record.hwid,
          deviceName: record.deviceName,
          activatedAt: record.activatedAt,
          lastSeenAt: record.lastSeenAt,
          active: record.active,
        },
        update: {
          hwid: record.hwid,
          deviceName: record.deviceName,
          activatedAt: record.activatedAt,
          lastSeenAt: record.lastSeenAt,
          active: record.active,
        },
      });
      return toRecord(row);
    },

    async setActive(licenseId, userEmail, platform, active) {
      const res = await db.licenseDeviceBinding.updateMany({
        where: {
          licenseId,
          userEmail,
          active: !active,
          ...(platform === "all" ? {} : { platform }),
        },
        data: { active },
      });
      return res.count;
    },

    // Interactive transaction: SQLite serializes writers, so the 7-user quota cannot be raced.
    async transaction(fn) {
      return root.$transaction(async (tx) => fn(createPrismaSeatStore(tx, root)), { timeout: 15000 });
    },
  };
}
