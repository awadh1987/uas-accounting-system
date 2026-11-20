import { prisma } from "@/lib/prisma";
import { appendAuditLogTx } from "@/lib/serverBootstrap";

export type MasterEntityType =
  | "Customer"
  | "Vendor"
  | "Worker"
  | "Project"
  | "Warehouse"
  | "InventoryItem"
  | "CostCenter"
  | "Account"
  | "WorkspaceDraft"
  | "TreasuryAccount";

export interface MasterLifecycleActor {
  userId: string | null;
  userRole: string;
  userDisplay: string;
}

export interface MasterLifecycleResult {
  ok: boolean;
  status: number;
  deleted: boolean;
  archived: boolean;
  restored?: boolean;
  linkedCount: number;
  message: string;
  error?: string;
  entityType: MasterEntityType;
  id: string;
}

/**
 * Counts all financial, transactional, audit, and hierarchy links for a master entity.
 */
export async function countLinkedRecordsTx(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  entityType: MasterEntityType,
  id: string
): Promise<{ count: number; details: Record<string, number> }> {
  const details: Record<string, number> = {};

  switch (entityType) {
    case "Customer": {
      const cust = await tx.customer.findUnique({ where: { id } });
      if (!cust) return { count: 0, details: {} };

      const accountIds = [cust.accountId, cust.glAccountId].filter(Boolean) as string[];

      const [journalLines, invoices, receipts, sales, auditLogs] = await Promise.all([
        accountIds.length > 0
          ? tx.journalEntryLine.count({ where: { accountId: { in: accountIds } } })
          : 0,
        tx.salesInvoice.count({ where: { customerId: id } }),
        tx.receiptVoucher.count({ where: { customerId: id } }),
        tx.saleTransaction.count({
          where: {
            OR: [
              { customerId: id },
              { customerName: cust.name },
              { customerName: cust.nameAr },
            ],
          },
        }),
        tx.auditLog.count({
          where: {
            entityId: id,
          },
        }),
      ]);

      details.journalLines = journalLines;
      details.invoices = invoices;
      details.receipts = receipts;
      details.sales = sales;
      details.auditLogs = auditLogs;
      break;
    }

    case "Vendor": {
      const vend = await tx.vendor.findUnique({ where: { id } });
      if (!vend) return { count: 0, details: {} };

      const accountIds = [vend.accountId, vend.glAccountId].filter(Boolean) as string[];

      const [journalLines, pos, bills, payments, ownedProjects, auditLogs] = await Promise.all([
        accountIds.length > 0
          ? tx.journalEntryLine.count({ where: { accountId: { in: accountIds } } })
          : 0,
        tx.purchaseOrder.count({ where: { vendorId: id } }),
        tx.vendorBill.count({ where: { vendorId: id } }),
        tx.paymentVoucher.count({ where: { vendorId: id } }),
        tx.project.count({ where: { vendorId: id } }),
        tx.auditLog.count({
          where: {
            entityId: id,
          },
        }),
      ]);

      details.journalLines = journalLines;
      details.purchaseOrders = pos;
      details.bills = bills;
      details.payments = payments;
      details.ownedProjects = ownedProjects;
      details.auditLogs = auditLogs;
      break;
    }

    case "Worker": {
      const worker = await tx.worker.findUnique({ where: { id } });
      if (!worker) return { count: 0, details: {} };

      const accountIds = [worker.accountId, worker.glAccountId].filter(Boolean) as string[];

      const [journalLines, wageEntries, auditLogs] = await Promise.all([
        accountIds.length > 0
          ? tx.journalEntryLine.count({ where: { accountId: { in: accountIds } } })
          : 0,
        tx.workerWageEntry.count({
          where: {
            OR: [{ workerId: id }, { workerName: worker.name }],
          },
        }),
        tx.auditLog.count({
          where: {
            entityId: id,
          },
        }),
      ]);

      details.journalLines = journalLines;
      details.wageEntries = wageEntries;
      details.auditLogs = auditLogs;
      break;
    }

    case "Project": {
      const [journalEntries, journalLines, expenses, wages, sales, pos, bills, invs] =
        await Promise.all([
          tx.journalEntry.count({ where: { projectId: id } }),
          tx.journalEntryLine.count({ where: { projectId: id } }),
          tx.operatingExpense.count({ where: { projectId: id } }),
          tx.workerWageEntry.count({ where: { projectId: id } }),
          tx.saleTransaction.count({ where: { projectId: id } }),
          tx.purchaseOrder.count({ where: { projectId: id } }),
          tx.vendorBill.count({ where: { projectId: id } }),
          tx.salesInvoice.count({ where: { projectId: id } }),
        ]);

      details.journalEntries = journalEntries;
      details.journalLines = journalLines;
      details.expenses = expenses;
      details.wages = wages;
      details.sales = sales;
      details.purchaseOrders = pos;
      details.bills = bills;
      details.salesInvoices = invs;
      break;
    }

    case "Warehouse": {
      const [movements, balancesWithStock, defaultItems] = await Promise.all([
        tx.stockMovement.count({ where: { warehouseId: id } }),
        tx.stockBalance.count({ where: { warehouseId: id, qtyOnHandBase: { not: 0 } } }),
        tx.inventoryItem.count({ where: { defaultWarehouseId: id } }),
      ]);

      details.stockMovements = movements;
      details.stockBalances = balancesWithStock;
      details.defaultItems = defaultItems;
      break;
    }

    case "InventoryItem": {
      const [movements, balancesWithStock, conversions] = await Promise.all([
        tx.stockMovement.count({ where: { itemId: id } }),
        tx.stockBalance.count({ where: { itemId: id, qtyOnHandBase: { not: 0 } } }),
        tx.itemUnitConversion.count({ where: { itemId: id } }),
      ]);

      details.stockMovements = movements;
      details.stockBalances = balancesWithStock;
      details.conversions = conversions;
      break;
    }

    case "CostCenter": {
      const [lines, children, accounts, movements, invoices, bills] = await Promise.all([
        tx.journalEntryLine.count({ where: { costCenterId: id } }),
        tx.costCenter.count({ where: { parentId: id } }),
        tx.account.count({ where: { defaultCostCenterId: id } }),
        tx.stockMovement.count({ where: { costCenterId: id } }),
        tx.salesInvoice.count({ where: { costCenterId: id } }),
        tx.vendorBill.count({ where: { costCenterId: id } }),
      ]);

      details.journalLines = lines;
      details.children = children;
      details.accounts = accounts;
      details.stockMovements = movements;
      details.salesInvoices = invoices;
      details.vendorBills = bills;
      break;
    }

    case "Account": {
      const [lines, children, customers, vendors, workers, warehouses, projects] =
        await Promise.all([
          tx.journalEntryLine.count({ where: { accountId: id } }),
          tx.account.count({ where: { parentId: id } }),
          tx.customer.count({ where: { OR: [{ accountId: id }, { glAccountId: id }] } }),
          tx.vendor.count({ where: { OR: [{ accountId: id }, { glAccountId: id }] } }),
          tx.worker.count({ where: { OR: [{ accountId: id }, { glAccountId: id }] } }),
          tx.warehouse.count({ where: { glAccountId: id } }),
          tx.project.count({ where: { glAccountId: id } }),
        ]);

      details.journalLines = lines;
      details.children = children;
      details.customers = customers;
      details.vendors = vendors;
      details.workers = workers;
      details.warehouses = warehouses;
      details.projects = projects;
      break;
    }

    case "WorkspaceDraft": {
      const draft = await tx.workspaceDraft.findUnique({ where: { id } });
      if (draft && draft.status === "CONVERTED") {
        details.convertedToEntity = 1;
      }
      break;
    }

    case "TreasuryAccount": {
      const trs = await tx.treasuryAccount.findUnique({ where: { id } });
      if (!trs) break;
      const [lines, dispatches, receipts, payments] = await Promise.all([
        tx.journalEntryLine.count({ where: { accountId: trs.accountId } }),
        tx.bankPaymentDispatch.count({ where: { treasuryAccountId: id } }),
        tx.receiptVoucher.count({ where: { treasuryId: id } }),
        tx.paymentVoucher.count({ where: { treasuryId: id } }),
      ]);
      details.journalLines = lines;
      details.bankPaymentDispatches = dispatches;
      details.receiptVouchers = receipts;
      details.paymentVouchers = payments;
      break;
    }
  }

  const totalCount = Object.values(details).reduce((sum, v) => sum + v, 0);
  return { count: totalCount, details };
}

/**
 * Universal Safe-Delete or Auto-Archive:
 * - If 0 linked records exist -> permanently deletes record (and cleanly deletes unlinked Gen-6 GL account).
 * - If historical records exist -> auto-archives (`isActive = false`, `archivedAt = new Date()`) and deactivates linked Gen-6 GL account.
 */
export async function safeDeleteOrArchiveMasterRecord(
  entityType: MasterEntityType,
  id: string,
  actor: MasterLifecycleActor
): Promise<MasterLifecycleResult> {
  return prisma.$transaction(async (tx) => {
    const { count: linkedCount, details } = await countLinkedRecordsTx(tx, entityType, id);

    if (linkedCount === 0) {
      // -----------------------------------------------------------------------
      // PERMANENT DELETE (Zero historical references)
      // -----------------------------------------------------------------------
      switch (entityType) {
        case "Customer": {
          const cust = await tx.customer.findUnique({ where: { id } });
          if (!cust) return notFoundResult(entityType, id);

          await tx.customer.delete({ where: { id } });

          // Also delete newly auto-provisioned leaf GL account if 0 journal lines exist
          const glId = cust.glAccountId || cust.accountId;
          if (glId) {
            const linesOnGl = await tx.journalEntryLine.count({ where: { accountId: glId } });
            if (linesOnGl === 0) {
              await tx.account.deleteMany({ where: { id: glId } }).catch(() => {});
            }
          }
          break;
        }

        case "Vendor": {
          const vend = await tx.vendor.findUnique({ where: { id } });
          if (!vend) return notFoundResult(entityType, id);

          await tx.vendor.delete({ where: { id } });

          const glId = vend.glAccountId || vend.accountId;
          if (glId) {
            const linesOnGl = await tx.journalEntryLine.count({ where: { accountId: glId } });
            if (linesOnGl === 0) {
              await tx.account.deleteMany({ where: { id: glId } }).catch(() => {});
            }
          }
          break;
        }

        case "Worker": {
          const w = await tx.worker.findUnique({ where: { id } });
          if (!w) return notFoundResult(entityType, id);

          await tx.worker.delete({ where: { id } });

          const glId = w.glAccountId || w.accountId;
          if (glId) {
            const linesOnGl = await tx.journalEntryLine.count({ where: { accountId: glId } });
            if (linesOnGl === 0) {
              await tx.account.deleteMany({ where: { id: glId } }).catch(() => {});
            }
          }
          break;
        }

        case "Project": {
          const p = await tx.project.findUnique({ where: { id } });
          if (!p) return notFoundResult(entityType, id);

          await tx.project.delete({ where: { id } });
          if (p.glAccountId) {
            const linesOnGl = await tx.journalEntryLine.count({ where: { accountId: p.glAccountId } });
            if (linesOnGl === 0) {
              await tx.account.deleteMany({ where: { id: p.glAccountId } }).catch(() => {});
            }
          }
          break;
        }

        case "Warehouse": {
          const wh = await tx.warehouse.findUnique({ where: { id } });
          if (!wh) return notFoundResult(entityType, id);

          // Delete clean 0-quantity balances
          await tx.stockBalance.deleteMany({ where: { warehouseId: id } });
          await tx.warehouse.delete({ where: { id } });

          if (wh.glAccountId) {
            const linesOnGl = await tx.journalEntryLine.count({ where: { accountId: wh.glAccountId } });
            if (linesOnGl === 0) {
              await tx.account.deleteMany({ where: { id: wh.glAccountId } }).catch(() => {});
            }
          }
          break;
        }

        case "InventoryItem": {
          const item = await tx.inventoryItem.findUnique({ where: { id } });
          if (!item) return notFoundResult(entityType, id);

          // Clean unit conversions and 0-qty balances
          await tx.itemUnitConversion.deleteMany({ where: { itemId: id } });
          await tx.stockBalance.deleteMany({ where: { itemId: id } });
          await tx.inventoryItem.delete({ where: { id } });
          break;
        }

        case "CostCenter": {
          const cc = await tx.costCenter.findUnique({ where: { id } });
          if (!cc) return notFoundResult(entityType, id);

          await tx.costCenter.delete({ where: { id } });
          break;
        }

        case "Account": {
          const acc = await tx.account.findUnique({ where: { id } });
          if (!acc) return notFoundResult(entityType, id);

          await tx.account.delete({ where: { id } });
          break;
        }

        case "WorkspaceDraft": {
          await tx.workspaceDraft.delete({ where: { id } });
          break;
        }

        case "TreasuryAccount": {
          const trs = await tx.treasuryAccount.findUnique({ where: { id } });
          if (!trs) return notFoundResult(entityType, id);
          await tx.treasuryAccount.delete({ where: { id } });
          if (trs.accountId) {
            const linesOnGl = await tx.journalEntryLine.count({ where: { accountId: trs.accountId } });
            if (linesOnGl === 0) {
              await tx.account.deleteMany({ where: { id: trs.accountId } }).catch(() => {});
            }
          }
          break;
        }
      }

      await appendAuditLogTx(tx, {
        userId: actor.userId,
        userRole: actor.userRole,
        userDisplay: actor.userDisplay,
        actionType: `حذف نهائي (${entityType})`,
        entityReference: id,
        details: `تم حذف السجل ${entityType} [${id}] نهائياً لعدم وجود حركات مرتبطة به`,
      });

      return {
        ok: true,
        status: 200,
        deleted: true,
        archived: false,
        linkedCount: 0,
        message: "تم حذف السجل نهائياً لعدم وجود حركات مرتبطة",
        entityType,
        id,
      };
    } else {
      // -----------------------------------------------------------------------
      // AUTO-ARCHIVE (Preserve historical integrity)
      // -----------------------------------------------------------------------
      const now = new Date();

      switch (entityType) {
        case "Customer": {
          const cust = await tx.customer.update({
            where: { id },
            data: { isActive: false, archivedAt: now },
          });
          const glId = cust.glAccountId || cust.accountId;
          if (glId) {
            await tx.account.updateMany({
              where: { id: glId },
              data: { isActive: false, archivedAt: now },
            });
          }
          break;
        }

        case "Vendor": {
          const vend = await tx.vendor.update({
            where: { id },
            data: { isActive: false, archivedAt: now },
          });
          const glId = vend.glAccountId || vend.accountId;
          if (glId) {
            await tx.account.updateMany({
              where: { id: glId },
              data: { isActive: false, archivedAt: now },
            });
          }
          break;
        }

        case "Worker": {
          const w = await tx.worker.update({
            where: { id },
            data: { isActive: false, archivedAt: now },
          });
          const glId = w.glAccountId || w.accountId;
          if (glId) {
            await tx.account.updateMany({
              where: { id: glId },
              data: { isActive: false, archivedAt: now },
            });
          }
          break;
        }

        case "Project": {
          const p = await tx.project.update({
            where: { id },
            data: { isActive: false, archivedAt: now, status: "ARCHIVED" },
          });
          if (p.glAccountId) {
            await tx.account.updateMany({
              where: { id: p.glAccountId },
              data: { isActive: false, archivedAt: now },
            });
          }
          break;
        }

        case "Warehouse": {
          const wh = await tx.warehouse.update({
            where: { id },
            data: { isActive: false, archivedAt: now },
          });
          if (wh.glAccountId) {
            await tx.account.updateMany({
              where: { id: wh.glAccountId },
              data: { isActive: false, archivedAt: now },
            });
          }
          break;
        }

        case "InventoryItem": {
          await tx.inventoryItem.update({
            where: { id },
            data: { isActive: false, archivedAt: now },
          });
          break;
        }

        case "CostCenter": {
          await tx.costCenter.update({
            where: { id },
            data: { isActive: false, archivedAt: now },
          });
          break;
        }

        case "Account": {
          await tx.account.update({
            where: { id },
            data: { isActive: false, archivedAt: now },
          });
          break;
        }

        case "WorkspaceDraft": {
          await tx.workspaceDraft.update({
            where: { id },
            data: { status: "DISCARDED" },
          });
          break;
        }

        case "TreasuryAccount": {
          const trs = await tx.treasuryAccount.update({
            where: { id },
            data: { isActive: false, archivedAt: now },
          });
          if (trs.accountId) {
            await tx.account.updateMany({
              where: { id: trs.accountId },
              data: { isActive: false, archivedAt: now },
            });
          }
          break;
        }
      }

      await appendAuditLogTx(tx, {
        userId: actor.userId,
        userRole: actor.userRole,
        userDisplay: actor.userDisplay,
        actionType: `أرشفة آلية (${entityType})`,
        entityReference: id,
        details: `تم أرشفة السجل ${entityType} [${id}] لوجود ${linkedCount} سجل مالي أو تاريخي مرتبط (${JSON.stringify(details)})`,
      });

      return {
        ok: true,
        status: 200,
        deleted: false,
        archived: true,
        linkedCount,
        message: `تم أرشفة السجل وإلغاء تنشيطه مع حسابه المحاسبي لوجود (${linkedCount}) حركة مالية وتاريخية مرتبطة`,
        entityType,
        id,
      };
    }
  });
}

/**
 * Explicit Archive Action (sets `isActive = false`, `archivedAt = now`).
 */
export async function archiveMasterRecord(
  entityType: MasterEntityType,
  id: string,
  actor: MasterLifecycleActor
): Promise<MasterLifecycleResult> {
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    switch (entityType) {
      case "Customer": {
        const cust = await tx.customer.update({
          where: { id },
          data: { isActive: false, archivedAt: now },
        });
        const glId = cust.glAccountId || cust.accountId;
        if (glId) {
          await tx.account.updateMany({
            where: { id: glId },
            data: { isActive: false, archivedAt: now },
          });
        }
        break;
      }

      case "Vendor": {
        const vend = await tx.vendor.update({
          where: { id },
          data: { isActive: false, archivedAt: now },
        });
        const glId = vend.glAccountId || vend.accountId;
        if (glId) {
          await tx.account.updateMany({
            where: { id: glId },
            data: { isActive: false, archivedAt: now },
          });
        }
        break;
      }

      case "Worker": {
        const w = await tx.worker.update({
          where: { id },
          data: { isActive: false, archivedAt: now },
        });
        const glId = w.glAccountId || w.accountId;
        if (glId) {
          await tx.account.updateMany({
            where: { id: glId },
            data: { isActive: false, archivedAt: now },
          });
        }
        break;
      }

      case "Project": {
        const p = await tx.project.update({
          where: { id },
          data: { isActive: false, archivedAt: now, status: "ARCHIVED" },
        });
        if (p.glAccountId) {
          await tx.account.updateMany({
            where: { id: p.glAccountId },
            data: { isActive: false, archivedAt: now },
          });
        }
        break;
      }

      case "Warehouse": {
        const wh = await tx.warehouse.update({
          where: { id },
          data: { isActive: false, archivedAt: now },
        });
        if (wh.glAccountId) {
          await tx.account.updateMany({
            where: { id: wh.glAccountId },
            data: { isActive: false, archivedAt: now },
          });
        }
        break;
      }

      case "InventoryItem": {
        await tx.inventoryItem.update({
          where: { id },
          data: { isActive: false, archivedAt: now },
        });
        break;
      }

      case "CostCenter": {
        await tx.costCenter.update({
          where: { id },
          data: { isActive: false, archivedAt: now },
        });
        break;
      }

      case "Account": {
        await tx.account.update({
          where: { id },
          data: { isActive: false, archivedAt: now },
        });
        break;
      }

      case "WorkspaceDraft": {
        await tx.workspaceDraft.update({
          where: { id },
          data: { status: "DISCARDED" },
        });
        break;
      }

      case "TreasuryAccount": {
        const trs = await tx.treasuryAccount.update({
          where: { id },
          data: { isActive: false, archivedAt: now },
        });
        if (trs.accountId) {
          await tx.account.updateMany({
            where: { id: trs.accountId },
            data: { isActive: false, archivedAt: now },
          });
        }
        break;
      }
    }

    await appendAuditLogTx(tx, {
      userId: actor.userId,
      userRole: actor.userRole,
      userDisplay: actor.userDisplay,
      actionType: `أرشفة يدوية (${entityType})`,
      entityReference: id,
      details: `تم أرشفة السجل ${entityType} [${id}] وإلغاء تنشيطه مع حسابه المحاسبي`,
    });

    return {
      ok: true,
      status: 200,
      deleted: false,
      archived: true,
      linkedCount: 0,
      message: "تمت أرشفة السجل وإلغاء تنشيطه بنجاح",
      entityType,
      id,
    };
  });
}

/**
 * Universal Restore Action (sets `isActive = true`, `archivedAt = null`).
 */
export async function restoreMasterRecord(
  entityType: MasterEntityType,
  id: string,
  actor: MasterLifecycleActor
): Promise<MasterLifecycleResult> {
  return prisma.$transaction(async (tx) => {
    switch (entityType) {
      case "Customer": {
        const cust = await tx.customer.update({
          where: { id },
          data: { isActive: true, archivedAt: null },
        });
        const glId = cust.glAccountId || cust.accountId;
        if (glId) {
          await tx.account.updateMany({
            where: { id: glId },
            data: { isActive: true, archivedAt: null },
          });
        }
        break;
      }

      case "Vendor": {
        const vend = await tx.vendor.update({
          where: { id },
          data: { isActive: true, archivedAt: null },
        });
        const glId = vend.glAccountId || vend.accountId;
        if (glId) {
          await tx.account.updateMany({
            where: { id: glId },
            data: { isActive: true, archivedAt: null },
          });
        }
        break;
      }

      case "Worker": {
        const w = await tx.worker.update({
          where: { id },
          data: { isActive: true, archivedAt: null },
        });
        const glId = w.glAccountId || w.accountId;
        if (glId) {
          await tx.account.updateMany({
            where: { id: glId },
            data: { isActive: true, archivedAt: null },
          });
        }
        break;
      }

      case "Project": {
        const p = await tx.project.update({
          where: { id },
          data: { isActive: true, archivedAt: null, status: "ACTIVE" },
        });
        if (p.glAccountId) {
          await tx.account.updateMany({
            where: { id: p.glAccountId },
            data: { isActive: true, archivedAt: null },
          });
        }
        break;
      }

      case "Warehouse": {
        const wh = await tx.warehouse.update({
          where: { id },
          data: { isActive: true, archivedAt: null },
        });
        if (wh.glAccountId) {
          await tx.account.updateMany({
            where: { id: wh.glAccountId },
            data: { isActive: true, archivedAt: null },
          });
        }
        break;
      }

      case "InventoryItem": {
        await tx.inventoryItem.update({
          where: { id },
          data: { isActive: true, archivedAt: null },
        });
        break;
      }

      case "CostCenter": {
        await tx.costCenter.update({
          where: { id },
          data: { isActive: true, archivedAt: null },
        });
        break;
      }

      case "Account": {
        await tx.account.update({
          where: { id },
          data: { isActive: true, archivedAt: null },
        });
        break;
      }

      case "WorkspaceDraft": {
        await tx.workspaceDraft.update({
          where: { id },
          data: { status: "ACTIVE_DRAFT" },
        });
        break;
      }

      case "TreasuryAccount": {
        const trs = await tx.treasuryAccount.update({
          where: { id },
          data: { isActive: true, archivedAt: null },
        });
        if (trs.accountId) {
          await tx.account.updateMany({
            where: { id: trs.accountId },
            data: { isActive: true, archivedAt: null },
          });
        }
        break;
      }
    }

    await appendAuditLogTx(tx, {
      userId: actor.userId,
      userRole: actor.userRole,
      userDisplay: actor.userDisplay,
      actionType: `استعادة سجل (${entityType})`,
      entityReference: id,
      details: `تم استعادة السجل ${entityType} [${id}] وتنشيطه مع حسابه المحاسبي`,
    });

    return {
      ok: true,
      status: 200,
      deleted: false,
      archived: false,
      restored: true,
      linkedCount: 0,
      message: "تمت استعادة السجل وتنشيطه بنجاح",
      entityType,
      id,
    };
  });
}

function notFoundResult(entityType: MasterEntityType, id: string): MasterLifecycleResult {
  return {
    ok: false,
    status: 404,
    deleted: false,
    archived: false,
    linkedCount: 0,
    message: "السجل غير موجود",
    error: `${entityType} record not found: ${id}`,
    entityType,
    id,
  };
}
