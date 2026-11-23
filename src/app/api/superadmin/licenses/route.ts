import { NextRequest, NextResponse } from "next/server";
import { corsOptionsResponse, jsonError } from "@/lib/apiHelpers";
import {
  issueSuperadminTenantLicense,
  listSuperadminTenantLicenses,
  requireSuperadminRootAuth,
  SuperadminValidationError,
} from "@/lib/licensing/superadminLicenseService";

export const dynamic = "force-dynamic";

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req);
}

/**
 * GET /api/superadmin/licenses
 * Lists existing provisioned tenants from tenants_registry.json with license metadata.
 * Restricted strictly to root platform (qat.world) owner/superadmin (`admin@qat.world`).
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await requireSuperadminRootAuth(req);
    if (!auth.ok) return auth.response;

    const tenants = listSuperadminTenantLicenses();
    return NextResponse.json(
      {
        success: true,
        actor: {
          email: auth.actor.email,
          role: auth.actor.role,
          name: auth.actor.name,
        },
        tenants,
      },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        },
      }
    );
  } catch (err) {
    console.error("GET /api/superadmin/licenses error:", err);
    return jsonError("تعذر تحميل قائمة التراخيص والمنشآت / Failed to list tenant licenses", 500);
  }
}

/**
 * POST /api/superadmin/licenses
 * Issues a signed Ed25519 license and provisions isolated PostgreSQL + SQLite tenant DBs.
 * Restricted strictly to root platform (qat.world) owner/superadmin (`admin@qat.world`).
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireSuperadminRootAuth(req);
    if (!auth.ok) return auth.response;

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const issued = await issueSuperadminTenantLicense(body);

    return NextResponse.json(
      {
        success: true,
        license: issued,
      },
      {
        status: 201,
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        },
      }
    );
  } catch (err) {
    if (err instanceof SuperadminValidationError) {
      return NextResponse.json(
        { success: false, code: err.code, error: err.message },
        { status: err.status }
      );
    }
    console.error("POST /api/superadmin/licenses error:", err);
    return jsonError(
      err instanceof Error
        ? `تعذر إصدار الترخيص وتهيئة المنشأة: ${err.message}`
        : "تعذر إصدار الترخيص وتهيئة المنشأة / Failed to issue tenant license",
      500
    );
  }
}
