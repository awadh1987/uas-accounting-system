/**
 * Pure TypeScript high-precision decimal arithmetic helpers.
 * Uses scaled integer BigInt / exact string parsing to eliminate IEEE-754 binary
 * floating-point drift (e.g. 0.1 + 0.2 !== 0.3) across both server and client runtimes.
 */

export type DecimalLike =
  | number
  | string
  | { toString(): string }
  | null
  | undefined;

const INTERNAL_SCALE = 8; // 10^8 sub-unit precision before rounding

export function toDecimalNumber(value: DecimalLike, fallback = 0): number {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  const n = Number(value.toString());
  return Number.isFinite(n) ? n : fallback;
}

function parseToScaledInt(value: DecimalLike, scale = INTERNAL_SCALE): bigint {
  const num = toDecimalNumber(value, 0);
  if (num === 0) return BigInt(0);

  // Use fixed string representation with extra headroom, avoiding scientific notation bugs
  const rawStr =
    typeof value === "string"
      ? value.trim()
      : typeof value === "number"
      ? value.toFixed(scale + 2)
      : value !== null && value !== undefined
      ? value.toString().trim()
      : "0";

  let normalized = rawStr;
  if (/e/i.test(normalized)) {
    normalized = num.toFixed(scale + 2);
  }

  const neg = normalized.startsWith("-");
  if (neg || normalized.startsWith("+")) {
    normalized = normalized.slice(1);
  }

  const parts = normalized.split(".");
  const intPart = (parts[0] || "0").replace(/\D/g, "") || "0";
  const fracRaw = (parts[1] || "").replace(/\D/g, "");
  const padded = fracRaw.padEnd(scale + 1, "0");
  const mainFrac = padded.slice(0, scale);
  const roundDigit = Number(padded[scale] || "0");

  let scaled = BigInt(intPart + mainFrac);
  if (roundDigit >= 5) {
    scaled += BigInt(1);
  }
  return neg ? -scaled : scaled;
}

function scaledIntToNumber(scaled: bigint, scale = INTERNAL_SCALE): number {
  if (scaled === BigInt(0)) return 0;
  const neg = scaled < BigInt(0);
  const abs = neg ? -scaled : scaled;
  const str = abs.toString().padStart(scale + 1, "0");
  const intPart = str.slice(0, str.length - scale) || "0";
  const fracPart = str.slice(str.length - scale);
  const numStr = `${neg ? "-" : ""}${intPart}.${fracPart}`;
  return Number(numStr);
}

export function roundDecimal(value: DecimalLike, decimals = 4): number {
  const num = toDecimalNumber(value, 0);
  if (num === 0) return 0;
  const scaled = parseToScaledInt(value, decimals);
  return scaledIntToNumber(scaled, decimals);
}

export function round4Decimal(value: DecimalLike): number {
  return roundDecimal(value, 4);
}

export function round2Decimal(value: DecimalLike): number {
  return roundDecimal(value, 2);
}

export function dAdd(a: DecimalLike, b: DecimalLike, decimals = 4): number {
  const sa = parseToScaledInt(a, INTERNAL_SCALE);
  const sb = parseToScaledInt(b, INTERNAL_SCALE);
  return roundDecimal(scaledIntToNumber(sa + sb, INTERNAL_SCALE), decimals);
}

export function dSub(a: DecimalLike, b: DecimalLike, decimals = 4): number {
  const sa = parseToScaledInt(a, INTERNAL_SCALE);
  const sb = parseToScaledInt(b, INTERNAL_SCALE);
  return roundDecimal(scaledIntToNumber(sa - sb, INTERNAL_SCALE), decimals);
}

export function dSum(values: DecimalLike[], decimals = 4): number {
  let total = BigInt(0);
  for (const v of values) {
    total += parseToScaledInt(v, INTERNAL_SCALE);
  }
  return roundDecimal(scaledIntToNumber(total, INTERNAL_SCALE), decimals);
}

export function dMul(a: DecimalLike, b: DecimalLike, decimals = 4): number {
  const sa = parseToScaledInt(a, INTERNAL_SCALE);
  const sb = parseToScaledInt(b, INTERNAL_SCALE);
  const prod = sa * sb;
  const factor = BigInt(10) ** BigInt(INTERNAL_SCALE);
  const half = factor / BigInt(2);
  const rounded =
    prod >= BigInt(0) ? (prod + half) / factor : (prod - half) / factor;
  return roundDecimal(scaledIntToNumber(rounded, INTERNAL_SCALE), decimals);
}

export function dDiv(a: DecimalLike, b: DecimalLike, decimals = 4): number {
  const denom = toDecimalNumber(b, 0);
  if (denom === 0) return 0;
  const sa = parseToScaledInt(a, INTERNAL_SCALE);
  const sb = parseToScaledInt(b, INTERNAL_SCALE);
  if (sb === BigInt(0)) return 0;
  const extraScale = BigInt(10) ** BigInt(INTERNAL_SCALE);
  const numer = sa * extraScale;
  const absSb = sb < BigInt(0) ? -sb : sb;
  const sameSign = (numer >= BigInt(0)) === (sb >= BigInt(0));
  const half = absSb / BigInt(2);
  const absNumer = numer < BigInt(0) ? -numer : numer;
  const qAbs = (absNumer + half) / absSb;
  const q = sameSign ? qAbs : -qAbs;
  return roundDecimal(scaledIntToNumber(q, INTERNAL_SCALE), decimals);
}

export function dAbs(a: DecimalLike, decimals = 4): number {
  return Math.abs(roundDecimal(a, decimals));
}
