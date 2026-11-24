/**
 * Shared helpers to detect, badge, and toggle synthetic / automated-test / smoke records
 * (such as `IDEM_*`, `FY87906`, `SMOKE-*`, `SKU-BSY-*` artifacts) so live tenant workspaces
 * stay clean during daily accounting and demonstrations.
 */

const SYNTHETIC_TOKEN_RE =
  /(?:^|[\s\-_(/])(?:IDEM_[A-Za-z0-9_-]{3,}|FY8\d{4,}|SMOKE[-_][A-Za-z0-9_-]+|FIXTURE[-_][A-Za-z0-9_-]+|DUMMY[-_][A-Za-z0-9_-]+|SKU-BSY-\d{4,}|TSK-?\d{5,})(?:$|[\s\-_)/])/i;

const SYNTHETIC_NAME_RE =
  /(?:^|\s)(?:Smoke\s*Test|Dummy\s*Project|Test\s*Fixture|صنف\s+بمحركات(?:\s|$)|اختبار\s+وهمي|مشروع\s+تجريبي\s+للاختبار)/i;

const SYNTHETIC_EXACT_PREFIX_RE = /^(?:IDEM_|__TEST__|TEST_SMOKE|MOCK_)/i;

export function isSyntheticTestText(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (SYNTHETIC_EXACT_PREFIX_RE.test(trimmed)) return true;
  if (SYNTHETIC_TOKEN_RE.test(trimmed)) return true;
  if (SYNTHETIC_NAME_RE.test(trimmed)) return true;
  return false;
}

const CANDIDATE_KEYS = [
  "id",
  "code",
  "sku",
  "voucherNo",
  "sequenceNumber",
  "invoiceNumber",
  "poNumber",
  "billNumber",
  "paymentNumber",
  "receiptNumber",
  "entryNumber",
  "reference",
  "referenceId",
  "batch",
  "batchCode",
  "harvest",
  "name",
  "nameAr",
  "nameEn",
  "customer",
  "customerName",
  "vendorName",
  "workerName",
  "description",
  "notes",
  "grade",
] as const;

export function isSyntheticTestRecord(record: unknown): boolean {
  if (!record || typeof record !== "object") return false;
  const obj = record as Record<string, unknown>;

  for (const key of CANDIDATE_KEYS) {
    if (isSyntheticTestText(obj[key])) {
      return true;
    }
  }

  // Also check nested vendor/customer/item summaries when attached
  const nestedCustomer = obj.customerObj as Record<string, unknown> | undefined;
  if (nestedCustomer && isSyntheticTestRecord(nestedCustomer)) return true;

  const nestedVendor = obj.vendor as Record<string, unknown> | undefined;
  if (nestedVendor && (isSyntheticTestText(nestedVendor.nameAr) || isSyntheticTestText(nestedVendor.code))) {
    return true;
  }

  const nestedWorker = obj.worker as Record<string, unknown> | undefined;
  if (nestedWorker && (isSyntheticTestText(nestedWorker.nameAr) || isSyntheticTestText(nestedWorker.code))) {
    return true;
  }

  return false;
}

export function filterOutSyntheticTestRecords<T>(
  items: readonly T[],
  hideTestRecords: boolean
): { visible: T[]; hiddenCount: number } {
  if (!hideTestRecords) {
    let hiddenCount = 0;
    for (const item of items) {
      if (isSyntheticTestRecord(item)) hiddenCount += 1;
    }
    return { visible: [...items], hiddenCount };
  }

  const visible: T[] = [];
  let hiddenCount = 0;
  for (const item of items) {
    if (isSyntheticTestRecord(item)) {
      hiddenCount += 1;
    } else {
      visible.push(item);
    }
  }
  return { visible, hiddenCount };
}
