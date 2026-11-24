import { prisma } from "@/lib/prisma";

export interface PickupOptionConfig {
  code: string;
  labelAr: string;
  labelEn?: string;
  type: "MARKET" | "BRANCH" | "WAREHOUSE" | "OTHER";
}

export interface PortalUnitOption {
  code: string;
  labelAr: string;
  labelEn?: string;
}

export interface PortalClientTypeOption {
  code: string;
  labelAr: string;
  labelEn?: string;
}

export interface PortalCustomFieldDef {
  key: string;
  labelAr: string;
  required?: boolean;
  type?: "text" | "number" | "select";
  options?: string[];
  placeholder?: string;
}

export interface TenantFormConfig {
  portalEnabled: boolean;
  approvalPolicy: "MANUAL" | "AUTO";
  requestHeadingAr: string;
  requestSubtitleAr: string;
  allowCustomPickup: boolean;
  allowUnlistedItems: boolean;
  defaultReserveStock: boolean;
  pickupOptions: PickupOptionConfig[];
  unitOptions: PortalUnitOption[];
  clientTypes: PortalClientTypeOption[];
  customRegistrationFields: PortalCustomFieldDef[];
  customRequestFields: PortalCustomFieldDef[];
}

export const PORTAL_FORM_SETTING_ID = "portal_form";

export const DEFAULT_TENANT_FORM_CONFIG: TenantFormConfig = {
  portalEnabled: true,
  approvalPolicy: "MANUAL",
  requestHeadingAr: "تسجيل طلب",
  requestSubtitleAr: "تقديم طلب استلام بضاعة ومتابعة حالتها الفورية وكشف حسابك المالي",
  allowCustomPickup: true,
  allowUnlistedItems: true,
  defaultReserveStock: false,
  pickupOptions: [
    { code: "MARKET", labelAr: "السوق", labelEn: "Market", type: "MARKET" },
    { code: "BRANCH_MAIN", labelAr: "فرع المبيعات الرئيسي", labelEn: "Main Branch", type: "BRANCH" },
    { code: "WH_MAIN", labelAr: "مخزن رقم 1", labelEn: "Warehouse #1", type: "WAREHOUSE" },
    { code: "OTHER", labelAr: "أخرى", labelEn: "Other", type: "OTHER" },
  ],
  unitOptions: [
    { code: "QAT_BUNCH", labelAr: "علاقية قات", labelEn: "Qat Bunch" },
    { code: "PIECE", labelAr: "حبة", labelEn: "Piece" },
    { code: "BAG", labelAr: "كيس", labelEn: "Bag" },
    { code: "CARTON", labelAr: "كرتون", labelEn: "Carton" },
    { code: "KG", labelAr: "كجم", labelEn: "Kg" },
    { code: "OTHER", labelAr: "أخرى", labelEn: "Other" },
  ],
  clientTypes: [
    { code: "WHOLESALE", labelAr: "تاجر جملة", labelEn: "Wholesale" },
    { code: "RETAIL", labelAr: "محل تجزئة", labelEn: "Retail" },
    { code: "DISTRIBUTOR", labelAr: "موزع", labelEn: "Distributor" },
    { code: "DIRECT_CLIENT", labelAr: "عميل مباشر", labelEn: "Direct Client" },
    { code: "OTHER", labelAr: "أخرى", labelEn: "Other" },
  ],
  customRegistrationFields: [],
  customRequestFields: [],
};

function sanitizePickupOptions(input: unknown): PickupOptionConfig[] {
  if (!Array.isArray(input) || input.length === 0) {
    return [...DEFAULT_TENANT_FORM_CONFIG.pickupOptions];
  }
  const clean: PickupOptionConfig[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const obj = raw as Record<string, unknown>;
    const code = String(obj.code || "").trim().toUpperCase() || `LOC_${clean.length + 1}`;
    const labelAr = String(obj.labelAr || "").trim();
    if (!labelAr) continue;
    const rawType = String(obj.type || "BRANCH").toUpperCase();
    const type =
      rawType === "MARKET" || rawType === "BRANCH" || rawType === "WAREHOUSE" || rawType === "OTHER"
        ? rawType
        : "BRANCH";
    clean.push({ code, labelAr, labelEn: obj.labelEn ? String(obj.labelEn).trim() : undefined, type });
  }
  if (!clean.some((o) => o.code === "OTHER" || o.type === "OTHER")) {
    clean.push({ code: "OTHER", labelAr: "أخرى", labelEn: "Other", type: "OTHER" });
  }
  return clean.length > 0 ? clean : [...DEFAULT_TENANT_FORM_CONFIG.pickupOptions];
}

function sanitizeUnitOptions(input: unknown): PortalUnitOption[] {
  if (!Array.isArray(input) || input.length === 0) {
    return [...DEFAULT_TENANT_FORM_CONFIG.unitOptions];
  }
  const clean: PortalUnitOption[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const obj = raw as Record<string, unknown>;
    const code = String(obj.code || "").trim().toUpperCase() || `UNIT_${clean.length + 1}`;
    const labelAr = String(obj.labelAr || "").trim();
    if (!labelAr) continue;
    clean.push({ code, labelAr, labelEn: obj.labelEn ? String(obj.labelEn).trim() : undefined });
  }
  if (!clean.some((u) => u.code === "QAT_BUNCH" || u.labelAr.includes("علاقية قات"))) {
    clean.unshift({ code: "QAT_BUNCH", labelAr: "علاقية قات", labelEn: "Qat Bunch" });
  }
  if (!clean.some((u) => u.code === "OTHER")) {
    clean.push({ code: "OTHER", labelAr: "أخرى", labelEn: "Other" });
  }
  return clean;
}

function sanitizeCustomFields(input: unknown): PortalCustomFieldDef[] {
  if (!Array.isArray(input)) return [];
  const res: PortalCustomFieldDef[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const obj = raw as Record<string, unknown>;
    const labelAr = String(obj.labelAr || "").trim();
    if (!labelAr) continue;
    const key =
      String(obj.key || "")
        .trim()
        .replace(/[^a-zA-Z0-9_]/g, "_") || `field_${res.length + 1}`;
    const typeRaw = String(obj.type || "text").toLowerCase();
    const type = typeRaw === "number" || typeRaw === "select" ? typeRaw : "text";
    const options = Array.isArray(obj.options)
      ? obj.options.map((x) => String(x).trim()).filter(Boolean)
      : undefined;
    res.push({
      key,
      labelAr,
      required: Boolean(obj.required),
      type,
      options,
      placeholder: obj.placeholder ? String(obj.placeholder).trim() : undefined,
    });
  }
  return res;
}

export function normalizeTenantFormConfig(raw: unknown): TenantFormConfig {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_TENANT_FORM_CONFIG };
  }
  const obj = raw as Record<string, unknown>;
  const policyRaw = String(obj.approvalPolicy || "MANUAL").toUpperCase();
  return {
    portalEnabled: obj.portalEnabled === undefined ? true : Boolean(obj.portalEnabled),
    approvalPolicy: policyRaw === "AUTO" ? "AUTO" : "MANUAL",
    requestHeadingAr:
      String(obj.requestHeadingAr || "").trim() || DEFAULT_TENANT_FORM_CONFIG.requestHeadingAr,
    requestSubtitleAr:
      String(obj.requestSubtitleAr || "").trim() || DEFAULT_TENANT_FORM_CONFIG.requestSubtitleAr,
    allowCustomPickup: obj.allowCustomPickup === undefined ? true : Boolean(obj.allowCustomPickup),
    allowUnlistedItems: obj.allowUnlistedItems === undefined ? true : Boolean(obj.allowUnlistedItems),
    defaultReserveStock: Boolean(obj.defaultReserveStock),
    pickupOptions: sanitizePickupOptions(obj.pickupOptions),
    unitOptions: sanitizeUnitOptions(obj.unitOptions),
    clientTypes:
      Array.isArray(obj.clientTypes) && obj.clientTypes.length > 0
        ? (obj.clientTypes as PortalClientTypeOption[]).filter((c) => c?.code && c?.labelAr)
        : [...DEFAULT_TENANT_FORM_CONFIG.clientTypes],
    customRegistrationFields: sanitizeCustomFields(obj.customRegistrationFields),
    customRequestFields: sanitizeCustomFields(obj.customRequestFields),
  };
}

export async function getTenantFormConfig(): Promise<TenantFormConfig> {
  try {
    const row = await prisma.tenantIntegrationSetting.findUnique({
      where: { id: PORTAL_FORM_SETTING_ID },
    });
    if (!row?.configJson) return { ...DEFAULT_TENANT_FORM_CONFIG };
    const parsed = JSON.parse(row.configJson) as unknown;
    return normalizeTenantFormConfig(parsed);
  } catch {
    return { ...DEFAULT_TENANT_FORM_CONFIG };
  }
}

export async function saveTenantFormConfig(
  patch: Partial<TenantFormConfig>,
  updatedById?: string | null
): Promise<TenantFormConfig> {
  const current = await getTenantFormConfig();
  const merged = normalizeTenantFormConfig({
    ...current,
    ...patch,
  });

  await prisma.tenantIntegrationSetting.upsert({
    where: { id: PORTAL_FORM_SETTING_ID },
    update: {
      provider: "PORTAL_FORM_CONFIG",
      configJson: JSON.stringify(merged),
      isActive: merged.portalEnabled,
      updatedById: updatedById ?? null,
    },
    create: {
      id: PORTAL_FORM_SETTING_ID,
      provider: "PORTAL_FORM_CONFIG",
      configJson: JSON.stringify(merged),
      isActive: merged.portalEnabled,
      updatedById: updatedById ?? null,
    },
  });

  return merged;
}
