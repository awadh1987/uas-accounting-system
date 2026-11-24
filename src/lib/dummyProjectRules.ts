/**
 * UAS Enterprise — Browser-Safe Dummy / Test Project Identification Rules
 *
 * Strictly detects automated-test, smoke-test, and build-fixture projects without
 * ever flagging real agricultural farms or seeded tenant projects (`default`, `PRJ-01`, etc.).
 */

export interface DummyProjectCandidate {
  id: string;
  code: string;
  name: string;
  nameAr?: string | null;
  reason: "test_code_pattern" | "test_name_pattern";
}

const TEST_PROJECT_CODE_PATTERNS = [
  /^PRJ-(?:F?P\d{5,}|P\d+-\d+|SMOKE|TEST)/i,
  /^(?:TEST|DUMMY|SMOKE|MOCK|FIXTURE)-/i,
];

const TEST_PROJECT_NAME_PATTERNS = [
  /^مشروع\s+(?:ربحية\s+)?P\d{5,}/i,
  /(?:\bsmoke\s*test\b|\btest\s*project\b|\bdummy\s*project\b|\bfixture\b|اختبار\s+وهمي|مشروع\s+تجريبي\s+للاختبار)/i,
];

export function identifyDummyTestProjects(
  projects: Array<{ id: string; code?: string | null; name: string; nameAr?: string | null }>
): DummyProjectCandidate[] {
  const candidates: DummyProjectCandidate[] = [];
  for (const p of projects) {
    if (!p || !p.id || p.id === "default") continue;
    const code = String(p.code || "").trim();
    const name = String(p.name || p.nameAr || "").trim();

    if (code && TEST_PROJECT_CODE_PATTERNS.some((re) => re.test(code))) {
      candidates.push({
        id: p.id,
        code,
        name,
        nameAr: p.nameAr,
        reason: "test_code_pattern",
      });
      continue;
    }

    if (name && TEST_PROJECT_NAME_PATTERNS.some((re) => re.test(name))) {
      candidates.push({
        id: p.id,
        code,
        name,
        nameAr: p.nameAr,
        reason: "test_name_pattern",
      });
    }
  }
  return candidates;
}
