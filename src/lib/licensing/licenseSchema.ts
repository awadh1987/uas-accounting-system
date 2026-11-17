export type RuntimeMode = "local" | "lan" | "cloud";

export interface UasLicensePayload {
  license_id: string;
  customer_name: string;
  hwid: string;
  allowed_modes: RuntimeMode[];
  max_branches: number;
  max_lan_seats: number;
  expires_at: string;
  issued_at: string;
}

export interface UasSignedLicense extends UasLicensePayload {
  signature: string;
}

export function canonicalizeLicensePayload(payload: UasLicensePayload): string {
  const sorted: Record<string, unknown> = {
    allowed_modes: [...(payload.allowed_modes || [])].sort(),
    customer_name: (payload.customer_name || "").trim(),
    expires_at: (payload.expires_at || "").trim(),
    hwid: (payload.hwid || "").trim().toUpperCase(),
    issued_at: (payload.issued_at || "").trim(),
    license_id: (payload.license_id || "").trim().toUpperCase(),
    max_branches: Number(payload.max_branches ?? 1),
    max_lan_seats: Number(payload.max_lan_seats ?? 1),
  };
  return JSON.stringify(sorted);
}

export function validateLicenseStructure(obj: unknown): UasSignedLicense | null {
  if (!obj || typeof obj !== "object") return null;
  const item = obj as Record<string, unknown>;

  if (
    typeof item.license_id !== "string" ||
    typeof item.customer_name !== "string" ||
    typeof item.hwid !== "string" ||
    !Array.isArray(item.allowed_modes) ||
    typeof item.expires_at !== "string" ||
    typeof item.issued_at !== "string" ||
    typeof item.signature !== "string"
  ) {
    return null;
  }

  const allowed_modes: RuntimeMode[] = [];
  for (const m of item.allowed_modes) {
    if (m === "local" || m === "lan" || m === "cloud") {
      allowed_modes.push(m);
    }
  }

  if (allowed_modes.length === 0) return null;

  return {
    license_id: item.license_id,
    customer_name: item.customer_name,
    hwid: item.hwid.toUpperCase(),
    allowed_modes,
    max_branches: Number(item.max_branches || 1),
    max_lan_seats: Number(item.max_lan_seats || 1),
    expires_at: item.expires_at,
    issued_at: item.issued_at,
    signature: item.signature,
  };
}
