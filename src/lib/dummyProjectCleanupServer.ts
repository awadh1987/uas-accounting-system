/**
 * UAS Enterprise — Tenant-Scoped Server Dummy / Test Project Cleanup Service
 *
 * Inspects ONLY the active tenant's Prisma/SQLite database for leftover dummy or
 * automated-test projects (never cross-tenant, never deletes real projects),
 * providing safe dry-run previews and transactional confirmed cleanup.
 */
import { prisma } from "@/lib/prisma";
import { getActiveTenantId } from "@/lib/tenant/tenantContext";
import { appendAuditLogTx } from "@/lib/serverBootstrap";
import { normalizeMemoryTenantSlug } from "@/lib/ai/copilotMemoryTypes";
import {
  identifyDummyTestProjects,
  type DummyProjectCandidate,
} from "./dummyProjectRules";
import type { ResolvedActor } from "./apiHelpers";

export async function listCandidateDummyProjectsForTenant(
  explicitTenantSlug?: string | null
): Promise<{ tenantSlug: string; totalProjects: number; candidates: DummyProjectCandidate[] }> {
  const tenantSlug = normalizeMemoryTenantSlug(explicitTenantSlug || getActiveTenantId());
  const all = await prisma.project.findMany({
    select: { id: true, code: true, name: true, nameAr: true },
    orderBy: { createdAt: "asc" },
  });
  return {
    tenantSlug,
    totalProjects: all.length,
    candidates: identifyDummyTestProjects(all),
  };
}

export async function deleteConfirmedDummyProjects(params: {
  projectIds: string[];
  actor: Pick<ResolvedActor, "userId" | "userDisplay" | "userRole">;
  tenantSlug?: string | null;
}): Promise<{
  tenantSlug: string;
  deletedCount: number;
  deletedCodes: string[];
}> {
  const tenantSlug = normalizeMemoryTenantSlug(params.tenantSlug || getActiveTenantId());
  const requestedSet = new Set(params.projectIds.map((id) => String(id).trim()).filter(Boolean));
  if (requestedSet.size === 0) {
    return { tenantSlug, deletedCount: 0, deletedCodes: [] };
  }

  // Re-validate strictly against `identifyDummyTestProjects` so a spoofed ID can NEVER delete a real project!
  const current = await listCandidateDummyProjectsForTenant(tenantSlug);
  const safeToDelete = current.candidates.filter((c) => requestedSet.has(c.id));
  if (safeToDelete.length === 0) {
    return { tenantSlug, deletedCount: 0, deletedCodes: [] };
  }

  const safeIds = safeToDelete.map((c) => c.id);
  const deletedCodes = safeToDelete.map((c) => c.code || c.name);

  await prisma.$transaction(async (tx) => {
    const linkedInvoices = await tx.salesInvoice.findMany({
      where: { projectId: { in: safeIds } },
      select: { id: true, journalEntryId: true },
    });
    const invIds = linkedInvoices.map((i) => i.id);
    if (invIds.length > 0) {
      await tx.salesInvoiceItem.deleteMany({ where: { invoiceId: { in: invIds } } });
      await tx.salesInvoice.deleteMany({ where: { id: { in: invIds } } });
    }
    const jeIds = linkedInvoices
      .map((i) => i.journalEntryId)
      .filter((id): id is string => Boolean(id));
    if (jeIds.length > 0) {
      await tx.journalEntryLine.deleteMany({ where: { journalEntryId: { in: jeIds } } });
      await tx.journalEntry.deleteMany({ where: { id: { in: jeIds } } });
    }

    await tx.saleTransaction.deleteMany({ where: { projectId: { in: safeIds } } });
    await tx.operatingExpense.deleteMany({ where: { projectId: { in: safeIds } } });
    await tx.harvestInventoryBatch.deleteMany({ where: { projectId: { in: safeIds } } });
    await tx.harvestCycle.deleteMany({ where: { projectId: { in: safeIds } } });
    await tx.project.deleteMany({ where: { id: { in: safeIds } } });

    await appendAuditLogTx(tx, {
      userId: params.actor.userId,
      userDisplay: params.actor.userDisplay,
      userRole: params.actor.userRole,
      actionType: "تنظيف المشاريع الوهمية والاختبارية عبر المساعد الذكي [executed_by_ai: true]",
      entityReference: `CLEANUP-${safeIds.length}`,
      details: `Tenant(${tenantSlug}) cleaned ${safeIds.length} dummy/test projects: ${deletedCodes.slice(0, 10).join(", ")}`,
    });
  });

  return {
    tenantSlug,
    deletedCount: safeIds.length,
    deletedCodes,
  };
}
