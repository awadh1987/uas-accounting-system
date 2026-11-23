/**
 * Pure TypeScript RFC 8032 Ed25519 Signature Verification + SHA-512 + SPKI DER Parser.
 *
 * Zero Node.js or WebCrypto `{ name: "Ed25519" }` dependencies: runs identically
 * across non-HTTPS HTTP LAN origins (where `crypto.subtle` is undefined), Android
 * Capacitor WebViews without WebCrypto Ed25519 support, Windows `.exe` WebViews,
 * and standard Node/browser environments.
 */

const MASK_64 = (BigInt(1) << BigInt(64)) - BigInt(1);

const SHA512_K = [
  "428a2f98d728ae22", "7137449123ef65cd", "b5c0fbcfec4d3b2f", "e9b5dba58189dbbc",
  "3956c25bf348b538", "59f111f1b605d019", "923f82a4af194f9b", "ab1c5ed5da6d8118",
  "d807aa98a3030242", "12835b0145706fbe", "243185be4ee4b28c", "550c7dc3d5ffb4e2",
  "72be5d74f27b896f", "80deb1fe3b1696b1", "9bdc06a725c71235", "c19bf174cf692694",
  "e49b69c19ef14ad2", "efbe4786384f25e3", "0fc19dc68b8cd5b5", "240ca1cc77ac9c65",
  "2de92c6f592b0275", "4a7484aa6ea6e483", "5cb0a9dcbd41fbd4", "76f988da831153b5",
  "983e5152ee66dfab", "a831c66d2db43210", "b00327c898fb213f", "bf597fc7beef0ee4",
  "c6e00bf33da88fc2", "d5a79147930aa725", "06ca6351e003826f", "142929670a0e6e70",
  "27b70a8546d22ffc", "2e1b21385c26c926", "4d2c6dfc5ac42aed", "53380d139d95b3df",
  "650a73548baf63de", "766a0abb3c77b2a8", "81c2c92e47edaee6", "92722c851482353b",
  "a2bfe8a14cf10364", "a81a664bbc423001", "c24b8b70d0f89791", "c76c51a30654be30",
  "d192e819d6ef5218", "d69906245565a910", "f40e35855771202a", "106aa07032bbd1b8",
  "19a4c116b8d2d0c8", "1e376c085141ab53", "2748774cdf8eeb99", "34b0bcb5e19b48a8",
  "391c0cb3c5c95a63", "4ed8aa4ae3418acb", "5b9cca4f7763e373", "682e6ff3d6b2b8a3",
  "748f82ee5defb2fc", "78a5636f43172f60", "84c87814a1f0ab72", "8cc702081a6439ec",
  "90befffa23631e28", "a4506cebde82bde9", "bef9a3f7b2c67915", "c67178f2e372532b",
  "ca273eceea26619c", "d186b8c721c0c207", "eada7dd6cde0eb1e", "f57d4f7fee6ed178",
  "06f067aa72176fba", "0a637dc5a2c898a6", "113f9804bef90dae", "1b710b35131c471b",
  "28db77f523047d84", "32caab7b40c72493", "3c9ebe0a15c9bebc", "431d67c49c100d4c",
  "4cc5d4becb3e42b6", "597f299cfc657e2a", "5fcb6fab3ad6faec", "6c44198c4a475817",
].map((h) => BigInt(`0x${h}`));

const SHA512_IV = [
  "6a09e667f3bcc908",
  "bb67ae8584caa73b",
  "3c6ef372fe94f82b",
  "a54ff53a5f1d36f1",
  "510e527fade682d1",
  "9b05688c2b3e6c1f",
  "1f83d9abfb41bd6b",
  "5be0cd19137e2179",
].map((h) => BigInt(`0x${h}`));

function rotr64(x: bigint, n: number): bigint {
  const shift = BigInt(n);
  const inv = BigInt(64 - n);
  return ((x >> shift) | (x << inv)) & MASK_64;
}

export function sha512(input: Uint8Array): Uint8Array {
  const bitLen = BigInt(input.length) * BigInt(8);
  // Pad with 0x80, then zeros so total length ≡ 112 (mod 128), then 16-byte big-endian length
  const rem = (input.length + 1 + 16) % 128;
  const zeroPad = rem === 0 ? 0 : 128 - rem;
  const padded = new Uint8Array(input.length + 1 + zeroPad + 16);
  padded.set(input, 0);
  padded[input.length] = 0x80;

  let lenTmp = bitLen;
  for (let i = padded.length - 1; i >= padded.length - 16 && lenTmp > BigInt(0); i--) {
    padded[i] = Number(lenTmp & BigInt(0xff));
    lenTmp >>= BigInt(8);
  }

  const h = [...SHA512_IV];
  const w = new Array<bigint>(80);

  for (let offset = 0; offset < padded.length; offset += 128) {
    for (let i = 0; i < 16; i++) {
      const idx = offset + i * 8;
      let val = BigInt(0);
      for (let j = 0; j < 8; j++) {
        val = (val << BigInt(8)) | BigInt(padded[idx + j]);
      }
      w[i] = val;
    }

    for (let i = 16; i < 80; i++) {
      const s0 = rotr64(w[i - 15], 1) ^ rotr64(w[i - 15], 8) ^ (w[i - 15] >> BigInt(7));
      const s1 = rotr64(w[i - 2], 19) ^ rotr64(w[i - 2], 61) ^ (w[i - 2] >> BigInt(6));
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) & MASK_64;
    }

    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 80; i++) {
      const S1 = rotr64(e, 14) ^ rotr64(e, 18) ^ rotr64(e, 41);
      const ch = (e & f) ^ ((~e & MASK_64) & g);
      const temp1 = (hh + S1 + ch + SHA512_K[i] + w[i]) & MASK_64;
      const S0 = rotr64(a, 28) ^ rotr64(a, 34) ^ rotr64(a, 39);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) & MASK_64;

      hh = g;
      g = f;
      f = e;
      e = (d + temp1) & MASK_64;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) & MASK_64;
    }

    h[0] = (h[0] + a) & MASK_64;
    h[1] = (h[1] + b) & MASK_64;
    h[2] = (h[2] + c) & MASK_64;
    h[3] = (h[3] + d) & MASK_64;
    h[4] = (h[4] + e) & MASK_64;
    h[5] = (h[5] + f) & MASK_64;
    h[6] = (h[6] + g) & MASK_64;
    h[7] = (h[7] + hh) & MASK_64;
  }

  const out = new Uint8Array(64);
  for (let i = 0; i < 8; i++) {
    let val = h[i];
    for (let j = 7; j >= 0; j--) {
      out[i * 8 + j] = Number(val & BigInt(0xff));
      val >>= BigInt(8);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Curve25519 / Ed25519 Arithmetic (RFC 8032)
// ---------------------------------------------------------------------------

const P = (BigInt(1) << BigInt(255)) - BigInt(19);
const L = BigInt("7237005577332262213973186563042994240857116359379907606001950938285454250989");

function mod(a: bigint, m: bigint = P): bigint {
  const r = a % m;
  return r >= BigInt(0) ? r : r + m;
}

function modPow(base: bigint, exp: bigint, m: bigint = P): bigint {
  let result = BigInt(1);
  let b = mod(base, m);
  let e = exp;
  while (e > BigInt(0)) {
    if ((e & BigInt(1)) === BigInt(1)) {
      result = (result * b) % m;
    }
    b = (b * b) % m;
    e >>= BigInt(1);
  }
  return result;
}

function modInv(a: bigint, m: bigint = P): bigint {
  return modPow(a, m - BigInt(2), m);
}

const D = mod(-BigInt(121665) * modInv(BigInt(121666)));
const TWO_D = mod(BigInt(2) * D);
const SQRT_M1 = modPow(BigInt(2), (P - BigInt(1)) / BigInt(4));

const BX = BigInt("15112221349535400772501151409588531511454012693041857206046113283949847762202");
const BY = BigInt("46316835694926478169428394003475163141307993866256225615783033603165251855960");

interface ExtPoint {
  x: bigint;
  y: bigint;
  z: bigint;
  t: bigint;
}

const ZERO_POINT: ExtPoint = {
  x: BigInt(0),
  y: BigInt(1),
  z: BigInt(1),
  t: BigInt(0),
};

const BASE_POINT: ExtPoint = {
  x: BX,
  y: BY,
  z: BigInt(1),
  t: (BX * BY) % P,
};

function pointAdd(p1: ExtPoint, p2: ExtPoint): ExtPoint {
  const A = mod((p1.y - p1.x) * (p2.y - p2.x));
  const B = mod((p1.y + p1.x) * (p2.y + p2.x));
  const C = mod(p1.t * TWO_D * p2.t);
  const Dval = mod(BigInt(2) * p1.z * p2.z);
  const E = mod(B - A);
  const F = mod(Dval - C);
  const G = mod(Dval + C);
  const H = mod(B + A);
  return {
    x: (E * F) % P,
    y: (G * H) % P,
    z: (F * G) % P,
    t: (E * H) % P,
  };
}

function pointDouble(p: ExtPoint): ExtPoint {
  const A = (p.x * p.x) % P;
  const B = (p.y * p.y) % P;
  const C = mod(BigInt(2) * p.z * p.z);
  const H = mod(A + B);
  const xPlusY = p.x + p.y;
  const E = mod(H - ((xPlusY * xPlusY) % P));
  const G = mod(A - B);
  const F = mod(C + G);
  return {
    x: (E * F) % P,
    y: (G * H) % P,
    z: (F * G) % P,
    t: (E * H) % P,
  };
}

function scalarMult(point: ExtPoint, scalar: bigint): ExtPoint {
  let q = ZERO_POINT;
  let r = point;
  let k = scalar;
  while (k > BigInt(0)) {
    if ((k & BigInt(1)) === BigInt(1)) {
      q = pointAdd(q, r);
    }
    r = pointDouble(r);
    k >>= BigInt(1);
  }
  return q;
}

function bytesToBigIntLE(bytes: Uint8Array): bigint {
  let val = BigInt(0);
  for (let i = bytes.length - 1; i >= 0; i--) {
    val = (val << BigInt(8)) | BigInt(bytes[i]);
  }
  return val;
}

function decodePoint(bytes: Uint8Array): ExtPoint | null {
  if (bytes.length !== 32) return null;
  const raw = bytesToBigIntLE(bytes);
  const signBit = (raw >> BigInt(255)) & BigInt(1);
  const y = raw & ((BigInt(1) << BigInt(255)) - BigInt(1));
  if (y >= P) return null;

  const y2 = (y * y) % P;
  const u = mod(y2 - BigInt(1));
  const v = mod(D * y2 + BigInt(1));
  const v3 = (v * v % P) * v % P;
  const v7 = ((v3 * v3) % P) * v % P;
  const uv7 = (u * v7) % P;
  let x = (((u * v3) % P) * modPow(uv7, (P - BigInt(5)) / BigInt(8))) % P;

  const vx2 = (v * ((x * x) % P)) % P;
  if (vx2 !== u) {
    if (vx2 === mod(-u)) {
      x = (x * SQRT_M1) % P;
    } else {
      return null;
    }
  }

  if (x === BigInt(0) && signBit === BigInt(1)) {
    return null;
  }
  if ((x & BigInt(1)) !== signBit) {
    x = P - x;
  }
  return {
    x,
    y,
    z: BigInt(1),
    t: (x * y) % P,
  };
}

function pointsEqual(p1: ExtPoint, p2: ExtPoint): boolean {
  const xEq = (p1.x * p2.z) % P === (p2.x * p1.z) % P;
  const yEq = (p1.y * p2.z) % P === (p2.y * p1.z) % P;
  return xEq && yEq;
}

const ED25519_SPKI_PREFIX = [
  0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
];

/**
 * Extracts raw 32-byte Ed25519 public key from a SubjectPublicKeyInfo (SPKI) DER buffer
 * or passes through an already-raw 32-byte key.
 */
export function extractRawEd25519PublicKeyFromSpki(spkiBytes: Uint8Array): Uint8Array | null {
  if (spkiBytes.length === 32) {
    return spkiBytes;
  }
  if (spkiBytes.length !== 44) {
    return null;
  }
  for (let i = 0; i < ED25519_SPKI_PREFIX.length; i++) {
    if (spkiBytes[i] !== ED25519_SPKI_PREFIX[i]) {
      return null;
    }
  }
  return spkiBytes.slice(12);
}

/**
 * Pure RFC 8032 Ed25519 detached signature verification using a 32-byte raw public key.
 */
export function verifyEd25519RawPure(
  rawPublicKey: Uint8Array,
  message: Uint8Array,
  signature: Uint8Array
): boolean {
  if (rawPublicKey.length !== 32 || signature.length !== 64) {
    return false;
  }

  const A = decodePoint(rawPublicKey);
  if (!A) return false;

  const rBytes = signature.slice(0, 32);
  const sBytes = signature.slice(32, 64);

  const R = decodePoint(rBytes);
  if (!R) return false;

  const s = bytesToBigIntLE(sBytes);
  if (s >= L) return false;

  const hInput = new Uint8Array(32 + 32 + message.length);
  hInput.set(rBytes, 0);
  hInput.set(rawPublicKey, 32);
  hInput.set(message, 64);

  const digest = sha512(hInput);
  const k = bytesToBigIntLE(digest) % L;

  const sb = scalarMult(BASE_POINT, s);
  const ka = scalarMult(A, k);
  const rhs = pointAdd(R, ka);
  return pointsEqual(sb, rhs);
}

/**
 * Verifies an Ed25519 signature against an SPKI DER public key (44 bytes, as encoded inside PEM files).
 */
export function verifyEd25519SpkiPure(
  spkiBytes: Uint8Array,
  message: Uint8Array,
  signature: Uint8Array
): boolean {
  const rawPub = extractRawEd25519PublicKeyFromSpki(spkiBytes);
  if (!rawPub) return false;
  return verifyEd25519RawPure(rawPub, message, signature);
}
