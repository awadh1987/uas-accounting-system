import { NextResponse } from "next/server";
import { ControlPanelError } from "./controlPanelService";
import { SuperadminValidationError } from "@/lib/licensing/superadminLicenseService";
import { jsonError } from "@/lib/apiHelpers";

export const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
};

export function handleControlPanelError(err: unknown, fallbackMsg: string): NextResponse {
  if (err instanceof ControlPanelError || err instanceof SuperadminValidationError) {
    return NextResponse.json(
      { success: false, code: err.code, error: err.message },
      { status: err.status, headers: NO_STORE_HEADERS }
    );
  }
  console.error("Control Panel API Error:", err);
  const detail = err instanceof Error ? err.message : fallbackMsg;
  return jsonError(detail || fallbackMsg, 500);
}
