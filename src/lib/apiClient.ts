"use client";

import {
  computeOperatingExpenseTotal,
  computeQrVerificationCode,
  computeSaleTotals,
  computeWorkerWageTotals,
  formatAuditTimestamp,
} from "@/lib/formulas";
import {
  enqueueOfflineMutation,
  getOfflineQueue,
  getOfflineQueueCount,
  loadOfflineSnapshot,
  removeOfflineQueueItem,
  saveOfflineSnapshot,
} from "@/lib/offlineDb";
import { INITIAL_FALLBACK_STATE } from "@/lib/seedFallback";
import type { UasBootstrapState, UasUser } from "@/types/uas";

export const SERVER_URL_STORAGE_KEY = "uas_server_url";

export function getApiBaseUrl(): string {
  if (typeof window !== "undefined") {
    const saved = window.localStorage.getItem(SERVER_URL_STORAGE_KEY);
    if (saved && saved.trim()) {
      return saved.trim().replace(/\/+$/, "");
    }
  }
  return (process.env.NEXT_PUBLIC_API_BASE_URL || "").replace(/\/+$/, "");
}

export function setApiBaseUrl(url: string): void {
  if (typeof window === "undefined") return;
  const cleaned = url.trim().replace(/\/+$/, "");
  if (!cleaned) {
    window.localStorage.removeItem(SERVER_URL_STORAGE_KEY);
  } else {
    window.localStorage.setItem(SERVER_URL_STORAGE_KEY, cleaned);
  }
}

export function resetApiBaseUrl(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(SERVER_URL_STORAGE_KEY);
}

let fetchInterceptorInstalled = false;

export function installGlobalApiFetchInterceptor(): void {
  if (typeof window === "undefined" || fetchInterceptorInstalled) return;
  fetchInterceptorInstalled = true;
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const base = getApiBaseUrl();
    if (base && typeof input === "string" && input.startsWith("/api/")) {
      return originalFetch(`${base}${input}`, init);
    }
    return originalFetch(input, init);
  };
}

export const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL || "").replace(/\/+$/, "");

export interface ApiMutationResult {
  state: UasBootstrapState;
  queuedOffline: boolean;
  queueCount: number;
  error?: string;
}

function makeActorPayload(currentUser: UasUser) {
  return {
    userId: currentUser.id,
    userDisplay: `${currentUser.name} (${currentUser.role})`,
    userRole: currentUser.role,
  };
}

function makeLocalHash(seed: string): string {
  return computeQrVerificationCode(`${seed}-${Date.now()}`);
}

export async function fetchBootstrapState(): Promise<{
  state: UasBootstrapState;
  fromOfflineCache: boolean;
  queueCount: number;
}> {
  const queueCount = await getOfflineQueueCount();
  try {
    const base = getApiBaseUrl();
    const res = await fetch(`${base}/api/bootstrap`, {
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const serverState = (await res.json()) as UasBootstrapState;
    await saveOfflineSnapshot(serverState);
    return { state: serverState, fromOfflineCache: false, queueCount };
  } catch {
    const cached = await loadOfflineSnapshot();
    if (cached) {
      return { state: cached, fromOfflineCache: true, queueCount };
    }
    await saveOfflineSnapshot(INITIAL_FALLBACK_STATE);
    return { state: INITIAL_FALLBACK_STATE, fromOfflineCache: true, queueCount };
  }
}

function applyLocalOptimistic(
  prev: UasBootstrapState,
  endpoint: string,
  method: "POST" | "PATCH" | "DELETE",
  payload: Record<string, unknown>,
  currentUser: UasUser
): { next: UasBootstrapState; error?: string } {
  const next: UasBootstrapState = structuredClone(prev);
  const ts = formatAuditTimestamp(new Date());
  const actorLabel = `${currentUser.name} (${currentUser.role})`;

  const addAudit = (action: string, details: string) => {
    next.auditLogs.unshift({
      id: "aud-" + Date.now(),
      timestamp: ts,
      user: actorLabel,
      action,
      details,
      hash: makeLocalHash(action + details),
    });
  };

  if (endpoint === "/api/projects" && method === "POST") {
    const name = String(payload.name || "").trim();
    const type = String(payload.type || "مشروع رئيسي");
    const parentProjectId = type === "مشروع فرعي" ? String(payload.parentProjectId || "") : "";
    const estimatedValue = Number(payload.estimatedValue) || 0;
    const count = Math.max(1, Number(payload.plannedHarvests) || 1);
    const notes = String(payload.notes || "");
    const ordinals = ["القطفة الأولى", "القطفة الثانية", "القطفة الثالثة", "القطفة الرابعة", "القطفة الخامسة"];
    const harvests = Array.from({ length: count }, (_, i) => ordinals[i] || `القطفة ${i + 1}`);
    const id = "p" + Date.now();
    next.projects.push({
      id,
      name,
      type,
      parentProjectId,
      estimatedValue,
      plannedHarvests: count,
      notes,
      harvests,
    });
    harvests.forEach((h) => {
      next.lockedPeriods[`${id}::${h}`] = false;
    });
    addAudit("إنشاء مشروع (محلي)", `${name} بقيمة ${estimatedValue.toLocaleString("en-US")} ريال`);
    return { next };
  }

  if (endpoint === "/api/projects/harvests" && method === "POST") {
    const pid = String(payload.projectId || "");
    const hName = String(payload.name || "").trim();
    const proj = next.projects.find((p) => p.id === pid);
    if (proj && hName && !proj.harvests.includes(hName)) {
      proj.harvests.push(hName);
      proj.plannedHarvests = proj.harvests.length;
      next.lockedPeriods[`${pid}::${hName}`] = false;
      addAudit("إضافة قطفة / مرشة (محلي)", `${proj.name} — ${hName}`);
    }
    return { next };
  }

  if (endpoint === "/api/expenses" && method === "POST") {
    const projectId = String(payload.projectId || "");
    const harvest = String(payload.harvest || "");
    if (next.lockedPeriods[`${projectId}::${harvest}`]) {
      return { next: prev, error: "🔒 هذه القطفة مغلقة محاسبياً!" };
    }
    const qty = Number(payload.qty) || 1;
    const unitPrice = Number(payload.unitPrice) || 0;
    const total = computeOperatingExpenseTotal(qty, unitPrice);
    next.expenses.push({
      id: "e" + Date.now(),
      projectId,
      harvest,
      category: String(payload.category || "وقود/محروقات"),
      subType: String(payload.subType || payload.category || ""),
      qty,
      unitPrice,
      total,
      date: String(payload.date || ts.slice(0, 10)),
      notes: String(payload.notes || ""),
    });
    addAudit("إضافة مصروف تشغيلي (محلي)", `${payload.category} — ${total.toLocaleString("en-US")} ريال`);
    return { next };
  }

  if (endpoint.startsWith("/api/expenses/") && method === "DELETE") {
    const id = endpoint.split("/").pop() || "";
    const rec = next.expenses.find((e) => e.id === id);
    if (rec && next.lockedPeriods[`${rec.projectId}::${rec.harvest}`]) {
      return {
        next: prev,
        error: "🔒 هذه القطفة مغلقة محاسبياً! لا يمكن الحذف إلا بعد فتح القطفة أو عبر قيد تسوية",
      };
    }
    next.expenses = next.expenses.filter((e) => e.id !== id);
    addAudit("حذف مصروف تشغيلي (محلي)", rec ? `${rec.category} - ${rec.total} ريال` : id);
    return { next };
  }

  if (endpoint === "/api/workers" && method === "POST") {
    const projectId = String(payload.projectId || "");
    const harvest = String(payload.harvest || "");
    if (next.lockedPeriods[`${projectId}::${harvest}`]) {
      return { next: prev, error: "🔒 هذه القطفة مغلقة محاسبياً!" };
    }
    const dailyWage = Number(payload.dailyWage) || 0;
    const days = Number(payload.days) || 1;
    const credit = Number(payload.credit) || 0;
    const { totalWage, debitBalance } = computeWorkerWageTotals(dailyWage, days, credit);
    next.workers.push({
      id: "w" + Date.now(),
      projectId,
      harvest,
      name: String(payload.name || ""),
      dailyWage,
      days,
      total: totalWage,
      credit,
      debit: debitBalance,
      date: String(payload.date || ts.slice(0, 10)),
      notes: String(payload.notes || ""),
    });
    addAudit("إضافة سجل أجر عامل (محلي)", `${payload.name} — ${totalWage.toLocaleString("en-US")} ريال`);
    return { next };
  }

  if (endpoint.startsWith("/api/workers/") && method === "DELETE") {
    const id = endpoint.split("/").pop() || "";
    const rec = next.workers.find((w) => w.id === id);
    if (rec && next.lockedPeriods[`${rec.projectId}::${rec.harvest}`]) {
      return {
        next: prev,
        error: "🔒 هذه القطفة مغلقة محاسبياً! لا يمكن الحذف إلا بعد فتح القطفة أو عبر قيد تسوية",
      };
    }
    next.workers = next.workers.filter((w) => w.id !== id);
    addAudit("حذف سجل عامل (محلي)", rec ? `${rec.name} - ${rec.total} ريال` : id);
    return { next };
  }

  if (endpoint === "/api/sales" && method === "POST") {
    const projectId = String(payload.projectId || "");
    const harvest = String(payload.harvest || "");
    if (next.lockedPeriods[`${projectId}::${harvest}`]) {
      return { next: prev, error: "🔒 هذه القطفة مغلقة محاسبياً!" };
    }
    const bundles = Number(payload.bundles) || 0;
    const price = Number(payload.price) || 0;
    const credit = Number(payload.credit) || 0;
    const { totalAmount, debitReceivable } = computeSaleTotals(bundles, price, credit);
    const seq = String(
      payload.sequenceNumber ||
        payload.batch ||
        `SO-${new Date().getFullYear()}-${Date.now().toString().slice(-4)}`
    );
    next.sales.push({
      id: "s" + Date.now(),
      projectId,
      subProjectId: payload.subProjectId ? String(payload.subProjectId) : undefined,
      harvest,
      batch: String(payload.batch || seq),
      sequenceNumber: seq,
      dailyBatchLabel: String(payload.dailyBatchLabel || "وردية مفتوحة"),
      salesOfficerId: payload.salesOfficerId ? String(payload.salesOfficerId) : undefined,
      salesOfficerTitle: payload.salesOfficerTitle ? String(payload.salesOfficerTitle) : undefined,
      revenueAccountCode: String(payload.revenueAccountCode || "411101"),
      treasuryAccountId: payload.treasuryAccountId ? String(payload.treasuryAccountId) : undefined,
      customer: String(payload.customer || ""),
      phone: String(payload.phone || ""),
      grade: String(payload.grade || "رقم 1"),
      bundles,
      price,
      total: totalAmount,
      credit,
      debit: debitReceivable,
      date: String(payload.date || ts.slice(0, 10)),
      voucherNo: String(payload.voucherNo || "RV-" + Date.now().toString().slice(-3)),
      notes: String(payload.notes || ""),
    });
    addAudit("إضافة عملية بيع (محلي)", `${payload.customer} — ${totalAmount.toLocaleString("en-US")} ريال`);
    return { next };
  }

  if (endpoint.startsWith("/api/sales/") && method === "DELETE") {
    const id = endpoint.split("/").pop() || "";
    const rec = next.sales.find((s) => s.id === id);
    if (rec && next.lockedPeriods[`${rec.projectId}::${rec.harvest}`]) {
      return {
        next: prev,
        error: "🔒 هذه القطفة مغلقة محاسبياً! لا يمكن الحذف إلا بعد فتح القطفة أو عبر قيد تسوية",
      };
    }
    next.sales = next.sales.filter((s) => s.id !== id);
    addAudit("حذف عملية بيع (محلي)", rec ? `${rec.customer} - ${rec.total} ريال` : id);
    return { next };
  }

  if (endpoint === "/api/installments" && method === "POST") {
    const type = String(payload.type || "CUSTOMER_RECEIPT");
    const targetId = String(payload.targetId || "");
    const treasuryId = String(payload.treasuryId || "t1");
    const amount = Number(payload.amount) || 0;
    const voucherNo = String(payload.voucherNo || "RV-INST-" + Date.now().toString().slice(-3));
    const date = String(payload.date || ts.slice(0, 10));
    const notes = String(payload.notes || "دفعة مسجلة");

    const treas = next.treasuryAccounts.find((t) => t.id === treasuryId);
    let targetName = "";
    let phone = "";

    if (type === "CUSTOMER_RECEIPT") {
      const sale = next.sales.find((s) => s.id === targetId);
      if (!sale) return { next: prev, error: "الفاتورة غير موجودة" };
      if (next.lockedPeriods[`${sale.projectId}::${sale.harvest}`]) {
        return { next: prev, error: "🔒 القطفة مغلقة محاسبياً!" };
      }
      sale.credit += amount;
      sale.debit = sale.total - sale.credit;
      targetName = `${sale.customer} (${sale.batch})`;
      phone = sale.phone || "";
      if (treas) treas.balanceYER += amount;
    } else {
      const worker = next.workers.find((w) => w.id === targetId);
      if (!worker) return { next: prev, error: "سجل العامل غير موجود" };
      if (next.lockedPeriods[`${worker.projectId}::${worker.harvest}`]) {
        return { next: prev, error: "🔒 القطفة مغلقة محاسبياً!" };
      }
      worker.credit += amount;
      worker.debit = worker.total - worker.credit;
      targetName = `${worker.name} (${worker.harvest})`;
      if (treas) treas.balanceYER -= amount;
    }

    next.installments.unshift({
      id: "inst" + Date.now(),
      voucherNo,
      type,
      targetId,
      targetName,
      phone,
      treasuryId,
      amount,
      date,
      notes,
    });
    addAudit(
      type === "CUSTOMER_RECEIPT" ? "سند قبض دفعة عميل (محلي)" : "سند صرف دفعة عامل (محلي)",
      `سند ${voucherNo} — ${targetName} — ${amount.toLocaleString("en-US")} ريال`
    );
    return { next };
  }

  if (endpoint === "/api/inventory" && method === "POST") {
    const projectId = String(payload.projectId || "");
    const harvest = String(payload.harvest || "");
    if (next.lockedPeriods[`${projectId}::${harvest}`]) {
      return { next: prev, error: "🔒 هذه القطفة مغلقة محاسبياً!" };
    }
    const harvestedBundles = Number(payload.harvestedBundles) || 0;
    const shrinkageBundles = Number(payload.shrinkageBundles) || 0;
    next.inventoryBatches.push({
      id: "inv" + Date.now(),
      projectId,
      harvest,
      grade: String(payload.grade || "رقم 1"),
      harvestedBundles,
      shrinkageBundles,
      notes: String(payload.notes || ""),
    });
    addAudit("إضافة دفعة مخزون علاقيات (محلي)", `${harvest} — ${harvestedBundles} علاقية`);
    return { next };
  }

  if (endpoint === "/api/audit/lock" && method === "POST") {
    const key = String(payload.key || "");
    const nextLocked = !next.lockedPeriods[key];
    next.lockedPeriods[key] = nextLocked;
    addAudit(nextLocked ? "إغلاق فترة قطفة 🔒" : "إعادة فتح فترة قطفة 🔓", `المعرف: ${key}`);
    return { next };
  }

  if (endpoint === "/api/audit/adjustments" && method === "POST") {
    const label = String(payload.periodLabel || payload.key || "");
    const reason = String(payload.reason || "");
    const amount = Number(payload.amount) || 0;
    addAudit("قيد تسوية محاسبي معتمد", `[${label}] ${reason} — القيمة: ${amount.toLocaleString("en-US")} ريال`);
    return { next };
  }

  if (endpoint === "/api/audit/log" && method === "POST") {
    addAudit(String(payload.action || ""), String(payload.details || ""));
    return { next };
  }

  if (endpoint === "/api/system/settings" && method === "PATCH") {
    if (payload.orgName) next.settings.orgName = String(payload.orgName);
    if (payload.logoText) next.settings.logoText = String(payload.logoText);
    if (payload.defaultLang === "ar" || payload.defaultLang === "en") {
      next.settings.defaultLang = payload.defaultLang;
    }
    if (
      payload.defaultTheme === "emerald" ||
      payload.defaultTheme === "dark" ||
      payload.defaultTheme === "royal"
    ) {
      next.settings.defaultTheme = payload.defaultTheme;
    }
    if (
      payload.defaultCurrency === "YER" ||
      payload.defaultCurrency === "SAR" ||
      payload.defaultCurrency === "USD"
    ) {
      next.settings.defaultCurrency = payload.defaultCurrency;
    }
    return { next };
  }

  if (endpoint === "/api/users" && method === "POST") {
    const name = String(payload.name || "");
    next.users.push({
      id: "u" + Date.now(),
      name,
      email: String(payload.email || "user@uas-ye.com"),
      role: String(payload.role || "محاسب رئيسي (Accountant)"),
      active: true,
      avatarChar: name.charAt(0) || "م",
    });
    addAudit("إضافة مستخدم نظام (محلي)", name);
    return { next };
  }

  if (endpoint.startsWith("/api/users/") && method === "PATCH") {
    const id = endpoint.split("/").pop() || "";
    const u = next.users.find((x) => x.id === id);
    if (u) {
      if (payload.toggleActive === true) u.active = !u.active;
      if (payload.name) u.name = String(payload.name);
      if (payload.avatarChar) u.avatarChar = String(payload.avatarChar).slice(0, 2);
    }
    return { next };
  }

  return { next };
}

export async function executeMutation(opts: {
  endpoint: string;
  method: "POST" | "PATCH" | "DELETE";
  payload: Record<string, unknown>;
  label: string;
  currentState: UasBootstrapState;
  currentUser: UasUser;
  offlineMode: boolean;
}): Promise<ApiMutationResult> {
  const bodyWithActor = {
    ...opts.payload,
    actor: makeActorPayload(opts.currentUser),
  };

  const isBrowserOffline = typeof navigator !== "undefined" && !navigator.onLine;
  if (opts.offlineMode || isBrowserOffline) {
    const optimistic = applyLocalOptimistic(
      opts.currentState,
      opts.endpoint,
      opts.method,
      opts.payload,
      opts.currentUser
    );
    if (optimistic.error) {
      const queueCount = await getOfflineQueueCount();
      return {
        state: opts.currentState,
        queuedOffline: false,
        queueCount,
        error: optimistic.error,
      };
    }
    await saveOfflineSnapshot(optimistic.next);
    const queueCount = await enqueueOfflineMutation({
      endpoint: opts.endpoint,
      method: opts.method,
      payload: bodyWithActor,
      label: opts.label,
    });
    return {
      state: optimistic.next,
      queuedOffline: true,
      queueCount,
    };
  }

  try {
    const base = getApiBaseUrl();
    const res = await fetch(`${base}${opts.endpoint}`, {
      method: opts.method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bodyWithActor),
    });
    const data = (await res.json().catch(() => ({}))) as {
      state?: UasBootstrapState;
      error?: string;
    };

    if (!res.ok) {
      const queueCount = await getOfflineQueueCount();
      return {
        state: opts.currentState,
        queuedOffline: false,
        queueCount,
        error: data.error || `HTTP ${res.status}`,
      };
    }

    if (data.state) {
      await saveOfflineSnapshot(data.state);
      const queueCount = await getOfflineQueueCount();
      return { state: data.state, queuedOffline: false, queueCount };
    }

    const refreshed = await fetchBootstrapState();
    return {
      state: refreshed.state,
      queuedOffline: false,
      queueCount: refreshed.queueCount,
    };
  } catch {
    // Network dropped mid-request: fall back seamlessly to offline queue
    const optimistic = applyLocalOptimistic(
      opts.currentState,
      opts.endpoint,
      opts.method,
      opts.payload,
      opts.currentUser
    );
    if (optimistic.error) {
      const queueCount = await getOfflineQueueCount();
      return {
        state: opts.currentState,
        queuedOffline: false,
        queueCount,
        error: optimistic.error,
      };
    }
    await saveOfflineSnapshot(optimistic.next);
    const queueCount = await enqueueOfflineMutation({
      endpoint: opts.endpoint,
      method: opts.method,
      payload: bodyWithActor,
      label: opts.label,
    });
    return {
      state: optimistic.next,
      queuedOffline: true,
      queueCount,
    };
  }
}

export async function syncQueuedOfflineMutations(currentUser: UasUser): Promise<{
  syncedCount: number;
  failedCount: number;
  state: UasBootstrapState;
  remainingQueue: number;
}> {
  const items = await getOfflineQueue();
  let syncedCount = 0;
  let failedCount = 0;

  const base = getApiBaseUrl();
  for (const item of items) {
    try {
      const res = await fetch(`${base}${item.endpoint}`, {
        method: item.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(item.payload),
      });
      if (res.ok || res.status === 404 || res.status === 423) {
        if (item.id !== undefined) await removeOfflineQueueItem(item.id);
        if (res.ok) syncedCount++;
        else failedCount++;
      } else {
        failedCount++;
      }
    } catch {
      failedCount++;
    }
  }

  if (syncedCount > 0) {
    await fetch(`${base}/api/audit/log`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "مزامنة سحابية (Cloud Sync)",
        details: `تمت مزامنة ${syncedCount} عمليات ميدانية من IndexedDB مع قاعدة البيانات المركزية`,
        actor: makeActorPayload(currentUser),
      }),
    }).catch(() => null);
  }

  const refreshed = await fetchBootstrapState();
  return {
    syncedCount,
    failedCount,
    state: refreshed.state,
    remainingQueue: refreshed.queueCount,
  };
}

