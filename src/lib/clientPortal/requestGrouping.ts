export interface GroupableClientRequest {
  id: string;
  requestNumber: string;
  status: string;
  totalEstimated?: number;
  totalConfirmed?: number;
  createdAt: string;
  clientAccount?: {
    id?: string;
    fullName?: string;
    tradeName?: string | null;
    phone?: string;
  } | null;
}

export interface MonthlyRequestFolder<T extends GroupableClientRequest> {
  monthKey: string; // e.g. "2026-11"
  monthLabelAr: string; // e.g. "نوفمبر 2026 (11 / 2026)"
  year: number;
  month: number;
  requests: T[];
  totalAmount: number;
  openCount: number;
}

export interface ClientRequestDirectory<T extends GroupableClientRequest> {
  clientKey: string;
  clientName: string;
  clientPhone: string;
  totalRequests: number;
  openRequests: number;
  totalAmount: number;
  months: MonthlyRequestFolder<T>[];
}

const ARABIC_MONTHS: string[] = [
  "يناير",
  "فبراير",
  "مارس",
  "أبريل",
  "مايو",
  "يونيو",
  "يوليو",
  "أغسطس",
  "سبتمبر",
  "أكتوبر",
  "نوفمبر",
  "ديسمبر",
];

export function resolveYearMonthKey(isoOrDate: string): {
  monthKey: string;
  monthLabelAr: string;
  year: number;
  month: number;
} {
  const match = /^(\d{4})-(\d{2})/.exec(String(isoOrDate || "").trim());
  const now = new Date();
  const year = match ? Number(match[1]) : now.getUTCFullYear();
  const month = match ? Number(match[2]) : now.getUTCMonth() + 1;
  const safeMonth = month >= 1 && month <= 12 ? month : 1;
  const monthKey = `${String(year).padStart(4, "0")}-${String(safeMonth).padStart(2, "0")}`;
  const arName = ARABIC_MONTHS[safeMonth - 1] || String(safeMonth);
  const monthLabelAr = `${arName} ${year} (${String(safeMonth).padStart(2, "0")} / ${year})`;
  return { monthKey, monthLabelAr, year, month: safeMonth };
}

const OPEN_STATUSES = new Set([
  "PENDING_REVIEW",
  "RETURNED_TO_CLIENT",
  "CONFIRMED",
  "READY_FOR_PICKUP",
]);

export function groupRequestsByClientAndMonth<T extends GroupableClientRequest>(
  requests: T[]
): {
  directories: ClientRequestDirectory<T>[];
  clientOptions: Array<{ clientKey: string; clientName: string; clientPhone: string; count: number }>;
  monthOptions: Array<{ monthKey: string; monthLabelAr: string; count: number }>;
} {
  const clientMap = new Map<
    string,
    {
      clientKey: string;
      clientName: string;
      clientPhone: string;
      monthsMap: Map<string, MonthlyRequestFolder<T>>;
    }
  >();
  const globalMonthCounts = new Map<string, { monthKey: string; monthLabelAr: string; count: number }>();

  for (const req of requests) {
    const cId = req.clientAccount?.id?.trim();
    const cName =
      req.clientAccount?.tradeName?.trim() ||
      req.clientAccount?.fullName?.trim() ||
      "عميل غير مرتبط";
    const cPhone = req.clientAccount?.phone?.trim() || "";
    const clientKey = cId || `name:${cName}`;

    let clientEntry = clientMap.get(clientKey);
    if (!clientEntry) {
      clientEntry = {
        clientKey,
        clientName: cName,
        clientPhone: cPhone,
        monthsMap: new Map(),
      };
      clientMap.set(clientKey, clientEntry);
    }

    const ym = resolveYearMonthKey(req.createdAt);
    let monthFolder = clientEntry.monthsMap.get(ym.monthKey);
    if (!monthFolder) {
      monthFolder = {
        monthKey: ym.monthKey,
        monthLabelAr: ym.monthLabelAr,
        year: ym.year,
        month: ym.month,
        requests: [],
        totalAmount: 0,
        openCount: 0,
      };
      clientEntry.monthsMap.set(ym.monthKey, monthFolder);
    }

    const val =
      Number(req.totalConfirmed || 0) > 0
        ? Number(req.totalConfirmed || 0)
        : Number(req.totalEstimated || 0);
    monthFolder.requests.push(req);
    monthFolder.totalAmount += val;
    if (OPEN_STATUSES.has(req.status)) {
      monthFolder.openCount += 1;
    }

    const gm = globalMonthCounts.get(ym.monthKey) || {
      monthKey: ym.monthKey,
      monthLabelAr: ym.monthLabelAr,
      count: 0,
    };
    gm.count += 1;
    globalMonthCounts.set(ym.monthKey, gm);
  }

  const directories: ClientRequestDirectory<T>[] = Array.from(clientMap.values()).map((entry) => {
    const months = Array.from(entry.monthsMap.values()).sort((a, b) =>
      b.monthKey.localeCompare(a.monthKey)
    );
    for (const m of months) {
      m.requests.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    return {
      clientKey: entry.clientKey,
      clientName: entry.clientName,
      clientPhone: entry.clientPhone,
      totalRequests: months.reduce((s, m) => s + m.requests.length, 0),
      openRequests: months.reduce((s, m) => s + m.openCount, 0),
      totalAmount: months.reduce((s, m) => s + m.totalAmount, 0),
      months,
    };
  });

  directories.sort((a, b) => {
    const aLatest = a.months[0]?.requests[0]?.createdAt || "";
    const bLatest = b.months[0]?.requests[0]?.createdAt || "";
    return bLatest.localeCompare(aLatest);
  });

  const clientOptions = directories.map((d) => ({
    clientKey: d.clientKey,
    clientName: d.clientName,
    clientPhone: d.clientPhone,
    count: d.totalRequests,
  }));

  const monthOptions = Array.from(globalMonthCounts.values()).sort((a, b) =>
    b.monthKey.localeCompare(a.monthKey)
  );

  return { directories, clientOptions, monthOptions };
}
