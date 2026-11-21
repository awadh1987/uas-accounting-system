export const DEFAULT_ROOT_DOMAIN = "qat.world";

export const TENANT_SLUG_REGEX = /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/;

export const RESERVED_TENANT_SLUGS = new Set<string>([
  "www",
  "api",
  "app",
  "admin",
  "root",
  "auth",
  "login",
  "logout",
  "register",
  "signup",
  "mail",
  "smtp",
  "imap",
  "pop",
  "ftp",
  "cdn",
  "static",
  "assets",
  "downloads",
  "docs",
  "help",
  "support",
  "status",
  "billing",
  "portal",
  "dashboard",
  "system",
  "platform",
  "superadmin",
  "qat",
  "uas",
  "default",
  "public",
  "localhost",
  "staging",
  "dev",
  "test",
  "demo",
  "ns1",
  "ns2",
  "mx",
  "webmail",
  "cpanel",
  "whm",
  "db",
  "sql",
  "sync",
  "ws",
  "wss",
  "vpn",
]);

const ARABIC_CHAR_MAP: Record<string, string> = {
  أ: "a",
  إ: "i",
  آ: "a",
  ا: "a",
  ى: "a",
  ب: "b",
  ت: "t",
  ث: "th",
  ج: "j",
  ح: "h",
  خ: "kh",
  د: "d",
  ذ: "dh",
  ر: "r",
  ز: "z",
  س: "s",
  ش: "sh",
  ص: "s",
  ض: "d",
  ط: "t",
  ظ: "z",
  ع: "a",
  غ: "gh",
  ف: "f",
  ق: "q",
  ك: "k",
  ل: "l",
  م: "m",
  ن: "n",
  ه: "h",
  ة: "h",
  و: "w",
  ؤ: "w",
  ي: "y",
  ئ: "y",
  ء: "",
  لا: "la",
  "٠": "0",
  "١": "1",
  "٢": "2",
  "٣": "3",
  "٤": "4",
  "٥": "5",
  "٦": "6",
  "٧": "7",
  "٨": "8",
  "٩": "9",
  "۰": "0",
  "۱": "1",
  "۲": "2",
  "۳": "3",
  "۴": "4",
  "۵": "5",
  "۶": "6",
  "۷": "7",
  "۸": "8",
  "۹": "9",
};

/**
 * Transliterates Arabic and mixed Unicode text into clean ASCII lowercase characters.
 */
export function transliterateArabicToAscii(input: string): string {
  if (!input) return "";
  // Strip Arabic harakat/diacritics, tatweel, and zero-width marks
  const stripped = input
    .replace(/[\u064B-\u065F\u0670\u0640\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, "")
    .replace(/لا/g, "la")
    .trim();

  let out = "";
  for (const ch of stripped) {
    if (ARABIC_CHAR_MAP[ch] !== undefined) {
      out += ARABIC_CHAR_MAP[ch];
    } else {
      out += ch;
    }
  }
  return out.toLowerCase();
}

function deterministicShortTag(seed: string): string {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36).slice(0, 4).padStart(4, "0");
}

/**
 * Validates an explicit tenant subdomain slug (3–32 chars, `[a-z0-9-]`, no `--`, not reserved).
 */
export function validateTenantSlug(rawSlug?: string | null): {
  valid: boolean;
  normalized: string;
  error?: string;
} {
  const normalized = String(rawSlug || "").trim().toLowerCase();
  if (!normalized) {
    return { valid: false, normalized: "", error: "Tenant slug is required (3-32 lowercase ASCII chars)." };
  }
  if (normalized.length < 3 || normalized.length > 32) {
    return {
      valid: false,
      normalized,
      error: `Tenant slug "${normalized}" must be between 3 and 32 characters.`,
    };
  }
  if (normalized.includes("--")) {
    return {
      valid: false,
      normalized,
      error: `Tenant slug "${normalized}" must not contain consecutive hyphens ("--").`,
    };
  }
  if (!TENANT_SLUG_REGEX.test(normalized)) {
    return {
      valid: false,
      normalized,
      error: `Tenant slug "${normalized}" must match ^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$ (lowercase letters, digits, hyphens).`,
    };
  }
  if (RESERVED_TENANT_SLUGS.has(normalized)) {
    return {
      valid: false,
      normalized,
      error: `Tenant slug "${normalized}" is a reserved system subdomain.`,
    };
  }
  return { valid: true, normalized };
}

/**
 * Derives a validated, collision-disambiguated ASCII lowercase slug (3–32 chars)
 * from an Arabic or English company name (or preferred slug).
 */
export function generateTenantSlug(
  companyName: string,
  opts?: {
    existingSlugs?: Iterable<string>;
    preferredSlug?: string;
    rootDomain?: string;
  }
): {
  slug: string;
  url: string;
  collisionAdjusted: boolean;
} {
  const rootDomain = (opts?.rootDomain || DEFAULT_ROOT_DOMAIN).trim().toLowerCase();
  const existingSet = new Set<string>();
  if (opts?.existingSlugs) {
    for (const s of opts.existingSlugs) {
      const clean = String(s || "").trim().toLowerCase();
      if (clean) existingSet.add(clean);
    }
  }

  let base = "";
  if (opts?.preferredSlug && opts.preferredSlug.trim()) {
    const check = validateTenantSlug(opts.preferredSlug);
    if (check.valid) {
      base = check.normalized;
    }
  }

  if (!base) {
    const rawCandidate = opts?.preferredSlug?.trim() || companyName || "";
    let ascii = transliterateArabicToAscii(rawCandidate)
      .replace(/[\s_./\\]+/g, "-")
      .replace(/[^a-z0-9-]/g, "")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "");

    if (!ascii) {
      ascii = `org-${deterministicShortTag(companyName || "uas")}`;
    } else if (ascii.length < 3) {
      ascii = `${ascii}-co`.replace(/-+/g, "-");
      if (ascii.length < 3) {
        ascii = `${ascii}01`.slice(0, 4);
      }
    }

    if (ascii.length > 32) {
      ascii = ascii.slice(0, 32).replace(/-+$/g, "");
      if (ascii.length < 3) {
        ascii = `org-${deterministicShortTag(companyName)}`;
      }
    }

    if (RESERVED_TENANT_SLUGS.has(ascii)) {
      const suffix = "-org";
      ascii = `${ascii.slice(0, 32 - suffix.length).replace(/-+$/g, "")}${suffix}`;
    }

    base = ascii;
  }

  let candidate = base;
  let collisionAdjusted = false;
  let counter = 2;
  while (
    existingSet.has(candidate) ||
    RESERVED_TENANT_SLUGS.has(candidate) ||
    !TENANT_SLUG_REGEX.test(candidate)
  ) {
    collisionAdjusted = true;
    const suffix = `-${counter}`;
    const prefix = base.slice(0, Math.max(1, 32 - suffix.length)).replace(/-+$/g, "");
    candidate = `${prefix || "org"}${suffix}`;
    counter++;
  }

  return {
    slug: candidate,
    url: buildTenantWorkspaceUrl(candidate, rootDomain),
    collisionAdjusted,
  };
}

export function buildTenantWorkspaceUrl(
  slug: string,
  rootDomain: string = DEFAULT_ROOT_DOMAIN
): string {
  const cleanSlug = String(slug || "").trim().toLowerCase();
  const cleanRoot = String(rootDomain || DEFAULT_ROOT_DOMAIN).trim().toLowerCase();
  if (!cleanSlug || cleanSlug === "default") {
    return `https://${cleanRoot}`;
  }
  return `https://${cleanSlug}.${cleanRoot}`;
}

/**
 * Extracts a validated tenant subdomain slug from a Host or X-Forwarded-Host header.
 * Returns null for apex domain (qat.world), www.qat.world, raw IP addresses, bare localhost, or reserved subdomains.
 */
export function extractSubdomainSlugFromHost(
  hostHeader?: string | null,
  rootDomain: string = DEFAULT_ROOT_DOMAIN
): string | null {
  if (!hostHeader) return null;
  // X-Forwarded-Host can be comma-separated; take first host
  const firstHost = hostHeader.split(",")[0]?.trim().toLowerCase() || "";
  if (!firstHost) return null;

  // Strip port (handles IPv4/host:port and ignores raw IPv6 bracketed hosts)
  const hostname = firstHost.startsWith("[")
    ? firstHost
    : firstHost.split(":")[0]?.trim() || "";
  if (!hostname) return null;

  // Ignore raw IP addresses and bare localhost
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || hostname.includes(":")) {
    return null;
  }

  const cleanRoot = rootDomain.trim().toLowerCase();
  if (hostname === cleanRoot || hostname === `www.${cleanRoot}` || hostname === "localhost") {
    return null;
  }

  let candidate = "";
  if (hostname.endsWith(`.${cleanRoot}`)) {
    candidate = hostname.slice(0, -(cleanRoot.length + 1));
  } else if (hostname.endsWith(".localhost")) {
    candidate = hostname.slice(0, -".localhost".length);
  } else {
    return null;
  }

  // Only single-label subdomains (<slug>.qat.world)
  if (!candidate || candidate.includes(".")) {
    return null;
  }

  const validation = validateTenantSlug(candidate);
  return validation.valid ? validation.normalized : null;
}
