import { NextRequest, NextResponse } from "next/server";
import { withTenantRoute } from "@/lib/prisma";
import { authorizeApiAction } from "@/lib/apiHelpers";
import {
  getRuntimeConfig,
  saveRuntimeConfig,
  getServerLanIps,
  getLanServerUrl,
  ensureWindowsFirewallRule,
  verifyCloudHealth,
} from "@/lib/runtimeMode";
import { loadInstalledLicense, verifyLicense } from "@/lib/licensing/verifier";
import type { RuntimeMode } from "@/lib/licensing/licenseSchema";

export const dynamic = "force-dynamic";

export const GET = withTenantRoute(async function GET() {
  const config = getRuntimeConfig();
  const lanIps = getServerLanIps();
  const lanUrl = getLanServerUrl(config.port);

  let cloudHealth = null;
  if (config.cloudUrl) {
    cloudHealth = await verifyCloudHealth(config.cloudUrl);
  }

  const { license } = loadInstalledLicense();

  return NextResponse.json({
    config,
    lanIps,
    lanUrl,
    cloudHealth,
    allowedModes: license?.allowed_modes || ["local", "lan", "cloud"],
  });
});

export const POST = withTenantRoute(async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const auth = await authorizeApiAction(body, req, {
      moduleId: "system",
      action: "edit",
    });
    if (!auth.ok) return auth.response;

    const targetMode = body.mode as RuntimeMode;

    if (!["local", "lan", "cloud"].includes(targetMode)) {
      return NextResponse.json(
        { error: "وضع التشغيل المحدد غير صالح / Invalid runtime mode" },
        { status: 400 }
      );
    }

    // Verify mode is permitted by license
    const { license } = loadInstalledLicense();
    if (license) {
      const ver = verifyLicense(license, targetMode);
      if (!ver.valid && ver.error?.includes("غير مدرج")) {
        return NextResponse.json(
          { error: ver.error },
          { status: 403 }
        );
      }
    }

    const updated = saveRuntimeConfig({
      mode: targetMode,
      ...(body.port ? { port: Number(body.port) } : {}),
      ...(body.cloudUrl ? { cloudUrl: String(body.cloudUrl) } : {}),
      ...(body.customDomain !== undefined ? { customDomain: String(body.customDomain) } : {}),
    });

    let firewallResult = null;
    if (targetMode === "lan") {
      firewallResult = ensureWindowsFirewallRule(updated.port);
    }

    return NextResponse.json({
      success: true,
      config: updated,
      firewall: firewallResult,
      lanUrl: getLanServerUrl(updated.port),
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to switch runtime mode" },
      { status: 500 }
    );
  }
});
