import { PrismaClient } from "@prisma/client";
import { getTenantContext } from "./tenant/tenantContext";

const globalForPrisma = globalThis as unknown as {
  defaultPrisma: PrismaClient | undefined;
};

export const defaultPrisma =
  globalForPrisma.defaultPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.defaultPrisma = defaultPrisma;
}

/**
 * Dynamic multi-tenant PrismaClient proxy.
 * When executed within a `runWithTenant(...)` or `withTenantRoute(...)` context,
 * all queries, transactions, and delegates dynamically route to the isolated tenant DB.
 * When executed outside tenant context, transparently delegates to `defaultPrisma`.
 */
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop, _receiver) {
    const tenantContext = getTenantContext();
    const activeClient = tenantContext?.prisma ?? defaultPrisma;
    const value = Reflect.get(activeClient, prop, activeClient);
    if (typeof value === "function") {
      return value.bind(activeClient);
    }
    return value;
  },
});

export { getTenantPrisma, runWithTenant, withTenantRoute } from "./tenant";
