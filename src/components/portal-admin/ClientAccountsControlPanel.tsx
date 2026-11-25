"use client";

import { useCallback, useEffect, useState } from "react";
import {
  SECTOR_MODE_LABEL_AR,
  normalizeSectorMode,
  type SectorMode,
} from "@/lib/clientPortal/portalPolicy";
import { formatIsoToDmyTime } from "@/lib/uiFormatters";

interface ManagedClient {
  id: string;
  fullName: string;
  tradeName: string | null;
  phone: string;
  status: string;
  sectorMode: string;
  customerId: string | null;
  creditLimit: number;
  suspendedAt?: string | null;
  archivedAt?: string | null;
  createdAt?: string | null;
}

interface Props {
  onToast: (msg: string) => void;
  /** Staff `Username` + `Title` signature appended to shared/copied client messages. */
  signature?: string;
}

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "نشط",
  SUSPENDED: "إيقاف مؤقت",
  ARCHIVED: "مؤرشف",
  PENDING_APPROVAL: "بانتظار الاعتماد",
  REJECTED: "مرفوض",
};

const STATUS_FILTERS = ["ALL", "ACTIVE", "SUSPENDED", "ARCHIVED", "PENDING_APPROVAL"] as const;

/** Tenant-side Sector Access Control Panel + full client account management (إدارة حسابات العملاء). */
export function ClientAccountsControlPanel({ onToast, signature }: Props) {
  const [defaultMode, setDefaultMode] = useState<SectorMode>("BOTH");
  const [allowPref, setAllowPref] = useState(false);
  const [clients, setClients] = useState<ManagedClient[]>([]);
  const [status, setStatus] = useState<(typeof STATUS_FILTERS)[number]>("ALL");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [bulkMode, setBulkMode] = useState<string>("BOTH");
  const [busy, setBusy] = useState(false);
  const [resetBanner, setResetBanner] = useState<{ name: string; phone: string; password: string } | null>(null);

  const load = useCallback(async () => {
    const qs = new URLSearchParams({ status, pageSize: "200" });
    if (search.trim()) qs.set("search", search.trim());
    const [cfgRes, listRes] = await Promise.all([
      fetch("/api/portal-admin/form-config", { cache: "no-store" }).catch(() => null),
      fetch(`/api/portal-admin/clients?${qs.toString()}`, { cache: "no-store" }).catch(() => null),
    ]);
    if (cfgRes?.ok) {
      const d = (await cfgRes.json()) as {
        formConfig?: { defaultSectorMode?: string; allowSectorPreferenceOnRegister?: boolean };
      };
      setDefaultMode(normalizeSectorMode(d.formConfig?.defaultSectorMode, "BOTH"));
      setAllowPref(Boolean(d.formConfig?.allowSectorPreferenceOnRegister));
    }
    if (listRes?.ok) {
      const d = (await listRes.json()) as { clients?: ManagedClient[] };
      setClients(d.clients || []);
    }
  }, [status, search]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  async function post(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch("/api/portal-admin/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as Record<string, unknown> & { error?: string; message?: string };
      if (!res.ok) {
        onToast(data.error || "تعذر تنفيذ الإجراء");
        return null;
      }
      onToast(data.message || "✅ تم تنفيذ الإجراء");
      await load();
      return data;
    } finally {
      setBusy(false);
    }
  }

  async function saveTenantDefaults() {
    setBusy(true);
    try {
      const res = await fetch("/api/portal-admin/form-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          formConfig: { defaultSectorMode: defaultMode, allowSectorPreferenceOnRegister: allowPref },
        }),
      });
      const d = (await res.json()) as { error?: string; message?: string };
      onToast(res.ok ? d.message || "✅ تم الحفظ" : d.error || "تعذر الحفظ");
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword(c: ManagedClient) {
    if (!confirm(`إعادة تعيين كلمة مرور (${c.fullName})؟ سيُطلب منه تغييرها عند الدخول وتُنهى جلساته.`)) return;
    const data = (await post({ clientAccountId: c.id, action: "RESET_PASSWORD" })) as
      | { temporaryPassword?: string }
      | null;
    if (data?.temporaryPassword) {
      setResetBanner({ name: c.fullName, phone: c.phone, password: data.temporaryPassword });
    }
  }

  async function copyToClient() {
    if (!resetBanner) return;
    const text = [
      `مرحباً ${resetBanner.name}`,
      `كلمة المرور المؤقتة: ${resetBanner.password}`,
      "سيُطلب منك تغييرها عند أول دخول إلى بوابة العملاء.",
      signature ? `— ${signature}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      onToast("✅ تم نسخ رسالة الإرسال للعميل");
    } catch {
      onToast(text);
    }
  }

  async function sendNoticeToClient(c: ManagedClient) {
    setBusy(true);
    try {
      const portalOrigin = typeof window !== "undefined" ? window.location.origin : "https://qat.world";
      const messageText = [
        `مرحباً ${c.fullName}`,
        `حالة حسابك في بوابة العملاء: ${STATUS_LABEL[c.status] || c.status}`,
        `الرابط المباشر للبوابة: ${portalOrigin}/client/portal/`,
        signature ? `— ${signature}` : "",
      ]
        .filter(Boolean)
        .join("\n");

      const res = await fetch("/api/whatsapp-outbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "CREATE_DRAFT",
          eventType: "CUSTOM",
          clientAccountId: c.id,
          customerId: c.customerId,
          recipientName: c.fullName,
          recipientPhone: c.phone,
          messageText,
        }),
      });
      if (res.ok) {
        onToast("✅ تم إدراج إشعار للعميل في مركز الإشعارات للمراجعة والإرسال");
      } else {
        await navigator.clipboard?.writeText(messageText).catch(() => null);
        onToast("✅ تم نسخ نص الإشعار للعميل");
      }
    } finally {
      setBusy(false);
    }
  }

  const selectedIds = Object.keys(selected).filter((k) => selected[k]);

  return (
    <div className="space-y-4 text-xs" data-testid="client-accounts-control-panel">
      <section className="card-surface rounded-2xl p-4 space-y-3" data-testid="sector-access-control-panel">
        <h3 className="font-black text-sm">التحكم في القطاعات المتاحة للعملاء</h3>
        <div className="flex flex-wrap items-end gap-3">
          <label className="space-y-1">
            <span className="block font-bold">الوضع الافتراضي للمنشأة</span>
            <select
              value={defaultMode}
              onChange={(e) => setDefaultMode(normalizeSectorMode(e.target.value))}
              data-testid="tenant-default-sector-mode"
              className="rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 font-bold"
            >
              {(Object.keys(SECTOR_MODE_LABEL_AR) as SectorMode[]).map((m) => (
                <option key={m} value={m}>
                  {SECTOR_MODE_LABEL_AR[m]}
                </option>
              ))}
            </select>
          </label>
          <label className="inline-flex items-center gap-2 font-bold">
            <input type="checkbox" checked={allowPref} onChange={(e) => setAllowPref(e.target.checked)} />
            السماح للعميل باختيار القطاع عند التسجيل
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={() => void saveTenantDefaults()}
            className="px-4 py-2 rounded-xl accent-bg font-extrabold"
          >
            حفظ
          </button>
        </div>
      </section>

      <section className="card-surface rounded-2xl p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-black text-sm">إدارة حسابات العملاء</h3>
          <div className="flex flex-wrap items-center gap-1.5">
            {STATUS_FILTERS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                className={`px-2.5 py-1 rounded-lg font-bold ${status === s ? "accent-bg" : "border border-slate-300 dark:border-slate-700"}`}
              >
                {s === "ALL" ? "الكل" : STATUS_LABEL[s]}
              </button>
            ))}
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث بالاسم أو الجوال"
              className="rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-2 py-1"
            />
          </div>
        </div>

        {selectedIds.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 p-2 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-300" data-testid="bulk-sector-bar">
            <span className="font-bold">تحديد {selectedIds.length} عميل — تعيين القطاعات:</span>
            <select
              value={bulkMode}
              onChange={(e) => setBulkMode(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white dark:bg-slate-900 px-2 py-1 font-bold"
            >
              <option value="INHERIT">افتراضي المنشأة</option>
              {(Object.keys(SECTOR_MODE_LABEL_AR) as SectorMode[]).map((m) => (
                <option key={m} value={m}>
                  {SECTOR_MODE_LABEL_AR[m]}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                await post({ action: "BULK_SET_SECTORS", clientAccountIds: selectedIds, sectorMode: bulkMode });
                setSelected({});
              }}
              className="px-3 py-1 rounded-lg accent-bg font-extrabold"
            >
              تطبيق
            </button>
          </div>
        )}

        {resetBanner && (
          <div className="p-3 rounded-xl border border-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 space-y-1">
            <div className="font-black">كلمة المرور المؤقتة للعميل ({resetBanner.name})</div>
            <div className="font-mono font-black text-base" dir="ltr">{resetBanner.password}</div>
            <button type="button" onClick={() => void copyToClient()} className="px-3 py-1 rounded-lg accent-bg font-extrabold">
              إرسال للعميل (نسخ الرسالة)
            </button>
            <button type="button" onClick={() => setResetBanner(null)} className="px-3 py-1 mr-2 rounded-lg border border-slate-300 font-bold">
              إغلاق
            </button>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-right border-collapse">
            <thead>
              <tr className="text-slate-500">
                <th className="p-2" />
                <th className="p-2">العميل</th>
                <th className="p-2">الحالة والتوقيت</th>
                <th className="p-2">القطاعات</th>
                <th className="p-2">الإجراءات</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => {
                const auditStamp = c.archivedAt
                  ? `أرشفة: ${formatIsoToDmyTime(c.archivedAt)}`
                  : c.suspendedAt
                  ? `إيقاف: ${formatIsoToDmyTime(c.suspendedAt)}`
                  : c.createdAt
                  ? formatIsoToDmyTime(c.createdAt)
                  : "";
                return (
                <tr key={c.id} className="border-t border-slate-200 dark:border-slate-800" data-testid={`managed-client-${c.id}`}>
                  <td className="p-2">
                    <input
                      type="checkbox"
                      checked={Boolean(selected[c.id])}
                      onChange={(e) => setSelected((p) => ({ ...p, [c.id]: e.target.checked }))}
                    />
                  </td>
                  <td className="p-2 font-bold">
                    {c.fullName}
                    <div className="font-mono text-[10px] text-slate-500" dir="ltr">{c.phone}</div>
                  </td>
                  <td className="p-2">
                    <div className="font-bold">{STATUS_LABEL[c.status] || c.status}</div>
                    {auditStamp && (
                      <div className="font-mono text-[10px] text-slate-400">
                        <bdi dir="ltr">{auditStamp}</bdi>
                      </div>
                    )}
                  </td>
                  <td className="p-2">
                    <select
                      value={c.sectorMode || "INHERIT"}
                      disabled={busy}
                      onChange={(e) => void post({ clientAccountId: c.id, action: "SET_SECTORS", sectorMode: e.target.value })}
                      className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 font-bold"
                    >
                      <option value="INHERIT">افتراضي المنشأة</option>
                      {(Object.keys(SECTOR_MODE_LABEL_AR) as SectorMode[]).map((m) => (
                        <option key={m} value={m}>
                          {SECTOR_MODE_LABEL_AR[m]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="p-2">
                    <div className="flex flex-wrap gap-1">
                      {c.status === "ACTIVE" && (
                        <button type="button" disabled={busy} onClick={() => void post({ clientAccountId: c.id, action: "SUSPEND" })} className="px-2 py-1 rounded-lg border border-amber-400 font-bold">
                          إيقاف مؤقت
                        </button>
                      )}
                      {c.status !== "ARCHIVED" && c.status !== "PENDING_APPROVAL" && (
                        <button type="button" disabled={busy} onClick={() => void post({ clientAccountId: c.id, action: "ARCHIVE" })} className="px-2 py-1 rounded-lg border border-slate-400 font-bold">
                          أرشفة
                        </button>
                      )}
                      {(c.status === "SUSPENDED" || c.status === "ARCHIVED") && (
                        <button type="button" disabled={busy} onClick={() => void post({ clientAccountId: c.id, action: "REACTIVATE" })} className="px-2 py-1 rounded-lg border border-emerald-500 font-bold">
                          إعادة تفعيل
                        </button>
                      )}
                      <button type="button" disabled={busy} onClick={() => void resetPassword(c)} className="px-2 py-1 rounded-lg border border-indigo-400 font-bold">
                        إعادة تعيين كلمة المرور
                      </button>
                      <button type="button" disabled={busy} onClick={() => void sendNoticeToClient(c)} className="px-2 py-1 rounded-lg border border-emerald-500 font-bold">
                        إرسال للعميل
                      </button>
                      <button type="button" disabled={busy} onClick={() => void post({ clientAccountId: c.id, action: "REVOKE_SESSIONS" })} className="px-2 py-1 rounded-lg border border-rose-400 font-bold">
                        إنهاء الجلسات النشطة
                      </button>
                      {c.customerId && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            const v = prompt("الحد الائتماني الجديد", String(c.creditLimit || 0));
                            if (v !== null) void post({ clientAccountId: c.id, action: "SET_CREDIT_LIMIT", creditLimit: Number(v) });
                          }}
                          className="px-2 py-1 rounded-lg border border-slate-400 font-bold"
                        >
                          الحد الائتماني
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
                );
              })}
              {clients.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-4 text-center text-slate-500">لا توجد حسابات مطابقة</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
