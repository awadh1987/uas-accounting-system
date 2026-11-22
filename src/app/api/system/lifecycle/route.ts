import { NextRequest, NextResponse } from "next/server";
import { withTenantRoute } from "@/lib/prisma";
import { ensureSqliteDatabaseReady } from "@/lib/sqliteBootstrap";
import { authorizeApiAction, forbiddenError, jsonError } from "@/lib/apiHelpers";
import { withIdempotency } from "@/lib/idempotencyGuard";
import { hasGranularPermission } from "@/lib/permissions";
import {
  archiveMasterRecord,
  restoreMasterRecord,
  safeDeleteOrArchiveMasterRecord,
  type MasterEntityType,
} from "@/lib/masterLifecycle";

export const dynamic = "force-dynamic";

export const POST = withTenantRoute(async function POST(req: NextRequest) {
  return withIdempotency(req, async (r) => {
    try {
      await ensureSqliteDatabaseReady();
      const body = (await r.json()) as Record<string, unknown>;
      const auth = await authorizeApiAction(body, r, {
        moduleId: "system",
        action: "delete",
      });
      if (!auth.ok) return auth.response;
      const actor = auth.actor;

      if (!hasGranularPermission(actor.user || actor.userRole, "records.archive_delete")) {
        return forbiddenError("غير مصرح: ليس لديك صلاحية أرشفة أو حذف السجلات الأساسية");
      }

      const entityType = String(body.entityType || "") as MasterEntityType;
      const id = String(body.id || "").trim();
      const action = String(body.action || "SAFE_DELETE").toUpperCase();

      if (!entityType || !id) {
        return jsonError("entityType و id مطلوبان", 400);
      }

      const validActor = {
        userId: actor.userId,
        userRole: actor.userRole,
        userDisplay: actor.userDisplay || "مستخدم النظام",
      };

      let result;
      if (action === "ARCHIVE") {
        result = await archiveMasterRecord(entityType, id, validActor);
      } else if (action === "RESTORE") {
        result = await restoreMasterRecord(entityType, id, validActor);
      } else {
        result = await safeDeleteOrArchiveMasterRecord(entityType, id, validActor);
      }

      return NextResponse.json(result, { status: result.status });
    } catch (error) {
      console.error("POST /api/system/lifecycle error:", error);
      return jsonError("تعذر تنفيذ العملية على السجل", 500);
    }
  });
});
