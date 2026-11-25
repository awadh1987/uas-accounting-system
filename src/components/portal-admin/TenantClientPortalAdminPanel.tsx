"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Check,
  CheckCircle2,
  ClipboardCheck,
  Copy,
  KeyRound,
  MessageSquare,
  PackageCheck,
  RefreshCw,
  Save,
  Send,
  Settings,
  UserCheck,
  XCircle,
} from "lucide-react";
import { openExternalOrWhatsApp } from "@/lib/nativeBridge";
import { computeSaleTotals, fmtNum } from "@/lib/formulas";
import { formatIsoToDmy, formatMoney, formatRefreshTimestamp } from "@/lib/uiFormatters";
import { PhoneContactInput } from "@/components/PhoneContactInput";
import { SvgAvatar } from "@/components/SvgAvatar";
import type { TenantFormConfig } from "@/lib/clientPortal/portalConfig";
import type { TenantWhatsAppSettingsPublic } from "@/lib/whatsapp/outboxService";

interface StaffClientAccount {
  id: string;
  customerId: string | null;
  fullName: string;
  tradeName: string | null;
  phone: string;
  email: string;
  avatarUrl?: string;
  avatarColor?: string;
  avatarChar?: string;
  mustChangePassword?: boolean;
  clientType: string;
  preferredPickup: string;
  status: string;
  creditLimit: number;
  linkedCustomerCode?: string | null;
  linkedAccountCode?: string | null;
  createdAt: string;
}

interface StaffRequestItem {
  id: string;
  requestNumber: string;
  status: string;
  statusLabelAr: string;
  pickupLocation: string;
  pickupNotes: string | null;
  reserveStock: boolean;
  totalEstimated: number;
  totalConfirmed: number;
  linkedInvoiceId: string | null;
  linkedSaleId?: string | null;
  linkedSalesRecordId?: string | null;
  linkedDraftId?: string | null;
  creditPaidPlanned?: number;
  debitPlanned?: number;
  approvedByName?: string | null;
  approvedAt?: string | null;
  createdAt: string;
  clientAccount?: {
    id: string;
    fullName: string;
    phone: string;
    customerId: string | null;
    avatarUrl?: string;
    avatarColor?: string;
    avatarChar?: string;
  };
  lines: Array<{
    id: string;
    itemId: string | null;
    itemTitle: string;
    requestedQty: number;
    confirmedQty: number | null;
    displayUnitLabel: string;
    unitPrice: number;
    lineTotal: number;
  }>;
}

interface WhatsAppDraftRecord {
  id: string;
  draftNumber: string;
  eventType: string;
  recipientName: string;
  recipientPhone: string;
  originalMessageText: string;
  finalMessageText: string;
  status: string;
  dispatchChannel: string;
  approvedByName: string | null;
  sentAt: string | null;
  skippedReason: string | null;
  createdAt: string;
}

interface TenantClientPortalAdminPanelProps {
  initialSection?: "registrations" | "requests" | "whatsapp" | "settings";
  canManageSettings?: boolean;
  onRefreshState?: () => Promise<void>;
  onToast: (msg: string) => void;
}

export function TenantClientPortalAdminPanel({
  initialSection = "requests",
  canManageSettings = true,
  onRefreshState,
  onToast,
}: TenantClientPortalAdminPanelProps) {
  const [section, setSection] = useState<"registrations" | "requests" | "whatsapp" | "settings">(initialSection);
  const [loading, setLoading] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState("");

  // Registrations & Client Password Reset
  const [clients, setClients] = useState<StaffClientAccount[]>([]);
  const [availableCustomers, setAvailableCustomers] = useState<
    Array<{ id: string; code: string; nameAr: string; phone: string }>
  >([]);
  const [creditEdits, setCreditEdits] = useState<Record<string, string>>({});
  const [linkCustEdits, setLinkCustEdits] = useState<Record<string, string>>({});
  const [resetBusyClientId, setResetBusyClientId] = useState<string | null>(null);
  const [resetResultBanner, setResetResultBanner] = useState<{
    clientName: string;
    phone: string;
    temporaryPassword: string;
    resetCode: string;
  } | null>(null);
  const [copiedResetFlag, setCopiedResetFlag] = useState(false);

  // Incoming Requests
  const [requests, setRequests] = useState<StaffRequestItem[]>([]);
  const [projects, setProjects] = useState<Array<{ id: string; code: string; nameAr: string }>>([]);
  const [treasuries, setTreasuries] = useState<Array<{ id: string; code: string; nameAr: string }>>([]);
  const [lineQtyEdits, setLineQtyEdits] = useState<Record<string, string>>({});
  const [linePriceEdits, setLinePriceEdits] = useState<Record<string, string>>({});
  const [reqProjectChoice, setReqProjectChoice] = useState<Record<string, string>>({});
  const [reqTreasuryChoice, setReqTreasuryChoice] = useState<Record<string, string>>({});
  const [reqPaidNow, setReqPaidNow] = useState<Record<string, string>>({});
  const [reqReserveFlag, setReqReserveFlag] = useState<Record<string, boolean>>({});

  // WhatsApp Outbox
  const [waDrafts, setWaDrafts] = useState<WhatsAppDraftRecord[]>([]);
  const [waStatusFilter, setWaStatusFilter] = useState("PENDING_APPROVAL");
  const [waEdits, setWaEdits] = useState<Record<string, string>>({});
  const [waSettings, setWaSettings] = useState<TenantWhatsAppSettingsPublic | null>(null);
  const [waApiTokenInput, setWaApiTokenInput] = useState("");

  // Form Config
  const [formCfg, setFormCfg] = useState<TenantFormConfig | null>(null);

  const loadAll = useCallback(async (manual = false) => {
    setLoading(true);
    try {
      const [cRes, rRes, wRes, fRes] = await Promise.all([
        fetch("/api/portal-admin/clients", { cache: "no-store" }),
        fetch("/api/portal-admin/requests", { cache: "no-store" }),
        fetch(`/api/whatsapp-outbox?status=${encodeURIComponent(waStatusFilter)}`, { cache: "no-store" }),
        fetch("/api/portal-admin/form-config", { cache: "no-store" }),
      ]);

      if (cRes.ok) {
        const cData = (await cRes.json()) as {
          clients?: StaffClientAccount[];
          availableCustomers?: Array<{ id: string; code: string; nameAr: string; phone: string }>;
        };
        setClients(cData.clients || []);
        setAvailableCustomers(cData.availableCustomers || []);
      }
      if (rRes.ok) {
        const rData = (await rRes.json()) as {
          requests?: StaffRequestItem[];
          projects?: Array<{ id: string; code: string; nameAr: string }>;
          treasuries?: Array<{ id: string; code: string; nameAr: string }>;
        };
        setRequests(rData.requests || []);
        if (rData.projects) setProjects(rData.projects);
        if (rData.treasuries) setTreasuries(rData.treasuries);
      }
      if (wRes.ok) {
        const wData = (await wRes.json()) as {
          drafts?: WhatsAppDraftRecord[];
          settings?: TenantWhatsAppSettingsPublic;
        };
        setWaDrafts(wData.drafts || []);
        if (wData.settings) setWaSettings(wData.settings);
      }
      if (fRes.ok) {
        const fData = (await fRes.json()) as { formConfig?: TenantFormConfig };
        if (fData.formConfig) setFormCfg(fData.formConfig);
      }
      setLastRefreshedAt(new Date().toISOString());
      if (manual) onToast("✅ تم تحديث بوابة العملاء وقائمة اعتماد واتساب");
    } catch {
      onToast("تعذر تحميل بيانات بوابة العملاء");
    } finally {
      setLoading(false);
    }
  }, [waStatusFilter, onToast]);

  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => {
      if (active) void loadAll(false);
    });
    return () => {
      active = false;
    };
  }, [loadAll]);

  async function handleReviewClient(clientId: string, action: "APPROVE" | "REJECT" | "SUSPEND") {
    const res = await fetch("/api/portal-admin/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientAccountId: clientId,
        action,
        creditLimit: creditEdits[clientId] !== undefined ? Number(creditEdits[clientId]) : undefined,
        linkCustomerId: linkCustEdits[clientId] || undefined,
      }),
    });
    const data = (await res.json()) as { message?: string; error?: string };
    if (!res.ok) {
      onToast(data.error || "تعذر تنفيذ العملية");
      return;
    }
    onToast(data.message || "✅ تم تحديث حالة العميل");
    await Promise.all([loadAll(false), onRefreshState?.()]);
  }

  async function handleStaffResetClientPassword(client: StaffClientAccount) {
    if (
      !confirm(
        `هل تريد إعادة تعيين كلمة مرور العميل (${client.fullName})؟ سيتم إنهاء جلساته الحالية وإلزامه بتغيير كلمة المرور عند الدخول وتجهيز إشعار واتساب للمراجعة.`
      )
    ) {
      return;
    }
    setResetBusyClientId(client.id);
    try {
      const res = await fetch("/api/portal-admin/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientAccountId: client.id,
          action: "RESET_PASSWORD",
        }),
      });
      const data = (await res.json()) as {
        temporaryPassword?: string;
        resetCode?: string;
        message?: string;
        error?: string;
      };
      if (!res.ok || !data.temporaryPassword) {
        onToast(data.error || "تعذر إعادة تعيين كلمة مرور العميل");
        return;
      }
      setResetResultBanner({
        clientName: client.fullName,
        phone: client.phone,
        temporaryPassword: data.temporaryPassword,
        resetCode: data.resetCode || "",
      });
      setCopiedResetFlag(false);
      onToast(data.message || "✅ تم إنشاء كلمة مرور مؤقتة وإدراج إشعار واتساب للمراجعة");
      await loadAll(false);
    } finally {
      setResetBusyClientId(null);
    }
  }

  async function handleRequestAction(
    reqItem: StaffRequestItem,
    action: "CONFIRM" | "MARK_READY" | "HANDOVER" | "REJECT"
  ) {
    const linePayload = reqItem.lines.map((l) => ({
      id: l.id,
      confirmedQty:
        lineQtyEdits[l.id] !== undefined
          ? Number(lineQtyEdits[l.id])
          : Number(l.confirmedQty ?? l.requestedQty),
      unitPrice:
        linePriceEdits[l.id] !== undefined ? Number(linePriceEdits[l.id]) : Number(l.unitPrice || 0),
    }));

    const res = await fetch("/api/portal-admin/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requestId: reqItem.id,
        action,
        projectId: reqProjectChoice[reqItem.id] || projects[0]?.id,
        treasuryId: reqTreasuryChoice[reqItem.id] || treasuries[0]?.id,
        immediatePaidAmount:
          reqPaidNow[reqItem.id] !== undefined
            ? Number(reqPaidNow[reqItem.id] || 0)
            : Number(reqItem.creditPaidPlanned || 0),
        reserveStock: reqReserveFlag[reqItem.id] ?? reqItem.reserveStock,
        lines: linePayload,
      }),
    });
    const data = (await res.json()) as { message?: string; error?: string };
    if (!res.ok) {
      onToast(data.error || "تعذر معالجة طلب العميل");
      return;
    }
    onToast(data.message || "✅ تم تحديث الطلب بنجاح");
    await Promise.all([loadAll(false), onRefreshState?.()]);
  }

  async function handleApproveAndSendWhatsApp(draft: WhatsAppDraftRecord) {
    const edited = waEdits[draft.id] !== undefined ? waEdits[draft.id] : draft.finalMessageText;
    const res = await fetch("/api/whatsapp-outbox", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "APPROVE_SEND",
        id: draft.id,
        editedMessageText: edited,
      }),
    });
    const data = (await res.json()) as {
      whatsappUrl?: string;
      message?: string;
      error?: string;
      messageRecord?: WhatsAppDraftRecord;
    };
    if (!res.ok) {
      onToast(data.error || "تعذر إرسال الرسالة");
      return;
    }
    if (data.whatsappUrl && (!waSettings || waSettings.provider === "WHATSAPP_WEB_LINK")) {
      openExternalOrWhatsApp(data.whatsappUrl);
    }
    onToast("✅ تم اعتماد وإرسال رسالة واتساب بنجاح");
    await loadAll(false);
  }

  async function handleSkipWhatsApp(draft: WhatsAppDraftRecord) {
    const res = await fetch("/api/whatsapp-outbox", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "SKIP",
        id: draft.id,
        reason: "تجاهل الإرسال بواسطة الموظف",
      }),
    });
    if (!res.ok) {
      onToast("تعذر تجاهل الرسالة");
      return;
    }
    onToast("تم تجاهل الرسالة وتسجيل ذلك");
    await loadAll(false);
  }

  const pendingClientsCount = clients.filter((c) => c.status === "PENDING_APPROVAL").length;
  const openRequestsCount = requests.filter((r) =>
    ["PENDING_REVIEW", "CONFIRMED", "READY_FOR_PICKUP"].includes(r.status)
  ).length;
  const pendingWaCount = waDrafts.filter((w) => w.status === "PENDING_APPROVAL").length;

  return (
    <div className="space-y-4 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-200 dark:border-slate-800">
        <div className="flex flex-wrap items-center gap-1.5">
          {[
            { id: "requests" as const, label: `طلبات العملاء الواردة (${openRequestsCount})`, Icon: PackageCheck },
            { id: "registrations" as const, label: `تسجيلات العملاء (${pendingClientsCount} معلق)`, Icon: UserCheck },
            { id: "whatsapp" as const, label: `قائمة اعتماد وإرسال واتساب (${pendingWaCount})`, Icon: MessageSquare },
            ...(canManageSettings
              ? [{ id: "settings" as const, label: "تخصيص النماذج وواتساب", Icon: Settings }]
              : []),
          ].map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setSection(id)}
              className={`px-3 py-1.5 rounded-xl font-extrabold inline-flex items-center gap-1.5 transition ${
                section === id
                  ? "accent-bg shadow-sm"
                  : "border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{label}</span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {lastRefreshedAt && (
            <span className="text-[10px] text-emerald-700 dark:text-emerald-400 font-semibold">
              {formatRefreshTimestamp(lastRefreshedAt)}
            </span>
          )}
          <button
            type="button"
            disabled={loading}
            onClick={() => void loadAll(true)}
            className="px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 font-bold inline-flex items-center gap-1"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            <span>تحديث</span>
          </button>
        </div>
      </div>

      {/* SECTION 1: INCOMING REQUESTS & PICKUP HANDOVER */}
      {section === "requests" && (
        <div className="space-y-3">
          {requests.length === 0 ? (
            <div className="p-6 rounded-2xl bg-slate-50 dark:bg-slate-800/40 text-center text-slate-500">
              لا توجد طلبات واردة من بوابة العملاء حالياً.
            </div>
          ) : (
            requests.map((r) => {
              const liveLines = r.lines.map((l) => {
                const q =
                  lineQtyEdits[l.id] !== undefined
                    ? Math.max(0, Number(lineQtyEdits[l.id]) || 0)
                    : Math.max(0, Number(l.confirmedQty ?? l.requestedQty ?? 0));
                const p =
                  linePriceEdits[l.id] !== undefined
                    ? Math.max(0, Number(linePriceEdits[l.id]) || 0)
                    : Math.max(0, Number(l.unitPrice || 0));
                const { totalAmount } = computeSaleTotals(q, p, 0);
                return { line: l, qty: q, price: p, total: totalAmount };
              });
              const liveOrderTotal = liveLines.reduce((s, x) => s + x.total, 0);
              const livePaid =
                reqPaidNow[r.id] !== undefined
                  ? Math.max(0, Number(reqPaidNow[r.id]) || 0)
                  : Number(r.creditPaidPlanned || 0);
              const { debitReceivable: liveDebit } = computeSaleTotals(liveOrderTotal, 1, livePaid);
              const activeSalesLink = r.linkedSalesRecordId || r.linkedSaleId || r.linkedDraftId;

              return (
              <div
                key={r.id}
                className="p-4 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono font-black px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800">
                      <bdi dir="ltr">{r.requestNumber}</bdi>
                    </span>
                    <SvgAvatar
                      char={r.clientAccount?.avatarChar || (r.clientAccount?.fullName || "ع").charAt(0)}
                      avatarUrl={r.clientAccount?.avatarUrl}
                      color={r.clientAccount?.avatarColor || "#059669"}
                      size={24}
                      alt={r.clientAccount?.fullName || "عميل"}
                    />
                    <span className="font-extrabold text-sm">{r.clientAccount?.fullName || "عميل"}</span>
                    <bdi dir="ltr" className="font-mono text-slate-500">{r.clientAccount?.phone}</bdi>
                    <span className="px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-200 font-bold">
                      {r.statusLabelAr}
                    </span>
                    {activeSalesLink && (
                      <span className="px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-200 font-bold font-mono text-[10px]">
                        مرتبط بالمبيعات (<bdi dir="ltr">{activeSalesLink.slice(0, 8)}</bdi>)
                      </span>
                    )}
                    <span className="text-slate-500">• استلام من: <strong>{r.pickupLocation}</strong></span>
                    <span className="font-mono text-slate-400">
                      <bdi dir="ltr">{formatIsoToDmy(r.createdAt.slice(0, 10))}</bdi>
                    </span>
                  </div>
                  <div className="text-[11px] font-black text-emerald-700 dark:text-emerald-300">
                    الإجمالي: {formatMoney(liveOrderTotal)}
                  </div>
                </div>

                {/* Line Items Editable by Staff */}
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-right border-collapse">
                    <thead>
                      <tr className="border-b bg-slate-50 dark:bg-slate-800/60">
                        <th className="p-2">الصنف</th>
                        <th className="p-2">الوحدة</th>
                        <th className="p-2">المطلوب</th>
                        <th className="p-2">المؤكد</th>
                        <th className="p-2">سعر الوحدة (ريال)</th>
                        <th className="p-2">الإجمالي (P×Q)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                      {liveLines.map(({ line: l, total }) => (
                        <tr key={l.id}>
                          <td className="p-2 font-bold">{l.itemTitle}</td>
                          <td className="p-2">{l.displayUnitLabel}</td>
                          <td className="p-2 font-mono">{fmtNum(l.requestedQty)}</td>
                          <td className="p-2">
                            <input
                              type="number"
                              step="any"
                              disabled={r.status === "COMPLETED"}
                              value={lineQtyEdits[l.id] ?? String(l.confirmedQty ?? l.requestedQty)}
                              onChange={(e) =>
                                setLineQtyEdits((prev) => ({ ...prev, [l.id]: e.target.value }))
                              }
                              className="w-24 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-2 py-1 font-mono"
                            />
                          </td>
                          <td className="p-2">
                            <input
                              type="number"
                              step="any"
                              disabled={r.status === "COMPLETED"}
                              value={linePriceEdits[l.id] ?? String(l.unitPrice || 0)}
                              onChange={(e) =>
                                setLinePriceEdits((prev) => ({ ...prev, [l.id]: e.target.value }))
                              }
                              className="w-28 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-2 py-1 font-mono"
                            />
                          </td>
                          <td className="p-2 font-mono font-extrabold text-emerald-700 dark:text-emerald-300">
                            {formatMoney(total)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {r.status !== "COMPLETED" && r.status !== "REJECTED" && r.status !== "CANCELLED" && (
                  <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] bg-slate-50 dark:bg-slate-800/50 rounded-xl px-3 py-2">
                      <span>الإجمالي (= P×Q): <strong className="text-slate-900 dark:text-white">{formatMoney(liveOrderTotal)}</strong></span>
                      <span>دائن (مقبوض نقد/بنك): <strong className="text-emerald-700 dark:text-emerald-300">{formatMoney(livePaid)}</strong></span>
                      <span>مدين (متبقي آجل): <strong className="text-rose-600 dark:text-rose-400">{formatMoney(liveDebit)}</strong></span>
                    </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        value={reqProjectChoice[r.id] || projects[0]?.id || ""}
                        onChange={(e) =>
                          setReqProjectChoice((prev) => ({ ...prev, [r.id]: e.target.value }))
                        }
                        className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 font-bold"
                      >
                        {projects.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.nameAr}
                          </option>
                        ))}
                      </select>
                      <select
                        value={reqTreasuryChoice[r.id] || treasuries[0]?.id || ""}
                        onChange={(e) =>
                          setReqTreasuryChoice((prev) => ({ ...prev, [r.id]: e.target.value }))
                        }
                        className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 font-bold"
                      >
                        {treasuries.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.nameAr}
                          </option>
                        ))}
                      </select>
                      <input
                        type="number"
                        step="any"
                        min="0"
                        placeholder="دائن / مدفوع الآن"
                        value={reqPaidNow[r.id] ?? (r.creditPaidPlanned ? String(r.creditPaidPlanned) : "")}
                        onChange={(e) =>
                          setReqPaidNow((prev) => ({ ...prev, [r.id]: e.target.value }))
                        }
                        className="w-36 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-2 py-1 font-mono"
                      />
                      <label className="inline-flex items-center gap-1 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={reqReserveFlag[r.id] ?? r.reserveStock}
                          onChange={(e) =>
                            setReqReserveFlag((prev) => ({ ...prev, [r.id]: e.target.checked }))
                          }
                        />
                        <span>حجز المخزون</span>
                      </label>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      {r.status === "PENDING_REVIEW" && (
                        <button
                          type="button"
                          onClick={() => void handleRequestAction(r, "CONFIRM")}
                          className="px-3 py-1.5 rounded-xl bg-indigo-600 text-white font-bold inline-flex items-center gap-1"
                        >
                          <ClipboardCheck className="w-3.5 h-3.5" />
                          <span>اعتماد وفتح أمر بيع</span>
                        </button>
                      )}
                      {(r.status === "PENDING_REVIEW" || r.status === "CONFIRMED") && (
                        <button
                          type="button"
                          onClick={() => void handleRequestAction(r, "MARK_READY")}
                          className="px-3 py-1.5 rounded-xl bg-amber-600 text-white font-bold"
                        >
                          جاهز للاستلام
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void handleRequestAction(r, "HANDOVER")}
                        className="px-3 py-1.5 rounded-xl accent-bg font-extrabold inline-flex items-center gap-1"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>إتمام التسليم (تم الاستلام + فاتورة)</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleRequestAction(r, "REJECT")}
                        className="px-2.5 py-1.5 rounded-xl border border-rose-300 text-rose-600 font-bold"
                      >
                        رفض
                      </button>
                    </div>
                  </div>
                  </div>
                )}
              </div>
              );
            })
          )}
        </div>
      )}

      {/* SECTION 2: NEW CLIENT REGISTRATIONS */}
      {section === "registrations" && (
        <div className="space-y-3">
          {resetResultBanner && (
            <div
              data-testid="staff-client-reset-banner"
              className="p-4 rounded-2xl border border-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 space-y-2"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-black text-emerald-800 dark:text-emerald-200 flex items-center gap-1.5">
                  <KeyRound className="w-4 h-4" />
                  <span>تمت إعادة تعيين كلمة مرور العميل: {resetResultBanner.clientName}</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const text = `كلمة المرور المؤقتة للعميل ${resetResultBanner.clientName}: ${resetResultBanner.temporaryPassword}${
                        resetResultBanner.resetCode ? ` | رمز الاستعادة: ${resetResultBanner.resetCode}` : ""
                      }`;
                      void navigator.clipboard?.writeText(text);
                      setCopiedResetFlag(true);
                    }}
                    className="px-2.5 py-1 rounded-lg bg-white dark:bg-slate-900 border border-emerald-300 text-[11px] font-bold inline-flex items-center gap-1"
                  >
                    {copiedResetFlag ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedResetFlag ? "تم النسخ" : "نسخ البيانات"}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSection("whatsapp")}
                    className="px-3 py-1 rounded-lg bg-emerald-600 text-white text-[11px] font-extrabold inline-flex items-center gap-1"
                  >
                    <Send className="w-3 h-3" />
                    <span>مراجعة وإرسال مسودة واتساب</span>
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-4 text-xs">
                <span>
                  كلمة المرور المؤقتة:{" "}
                  <code dir="ltr" className="px-2 py-0.5 rounded bg-white dark:bg-slate-900 font-mono font-black text-emerald-700 dark:text-emerald-300">
                    {resetResultBanner.temporaryPassword}
                  </code>
                </span>
                {resetResultBanner.resetCode && (
                  <span>
                    رمز التحقق (صالح 30 دقيقة):{" "}
                    <code dir="ltr" className="px-2 py-0.5 rounded bg-white dark:bg-slate-900 font-mono font-black">
                      {resetResultBanner.resetCode}
                    </code>
                  </span>
                )}
              </div>
            </div>
          )}

          {clients.length === 0 ? (
            <div className="p-6 rounded-2xl bg-slate-50 dark:bg-slate-800/40 text-center text-slate-500">
              لا توجد طلبات تسجيل عملاء عبر البوابة حالياً.
            </div>
          ) : (
            clients.map((c) => (
              <div
                key={c.id}
                className="p-4 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 flex flex-wrap items-center justify-between gap-3"
              >
                <div className="flex items-start gap-3">
                  <SvgAvatar
                    char={c.avatarChar || c.fullName.trim().charAt(0) || "ع"}
                    avatarUrl={c.avatarUrl}
                    color={c.avatarColor || "#059669"}
                    size={42}
                    alt={c.fullName}
                  />
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-black text-sm">{c.fullName}</span>
                    {c.tradeName && <span className="text-slate-500">({c.tradeName})</span>}
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold ${
                        c.status === "ACTIVE"
                          ? "bg-emerald-100 text-emerald-700"
                          : c.status === "PENDING_APPROVAL"
                          ? "bg-amber-100 text-amber-800"
                          : "bg-rose-100 text-rose-700"
                      }`}
                    >
                      {c.status}
                    </span>
                    {c.mustChangePassword && (
                      <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200 font-bold text-[10px]">
                        تغيير كلمة المرور مطلوب
                      </span>
                    )}
                    {c.linkedAccountCode && (
                      <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-emerald-50 text-emerald-700">
                        COA {c.linkedAccountCode}
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-500 flex flex-wrap gap-3">
                    <span>هاتف: <bdi dir="ltr" className="font-mono font-bold">{c.phone}</bdi></span>
                    <span>البريد: <bdi dir="ltr">{c.email}</bdi></span>
                    <span>النوع: {c.clientType}</span>
                    <span>الاستلام: {c.preferredPickup}</span>
                    <span>الحد الائتماني: {formatMoney(c.creditLimit)}</span>
                  </div>
                </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                {c.status !== "REJECTED" && (
                  <button
                    type="button"
                    data-testid={`staff-reset-client-${c.id}`}
                    disabled={resetBusyClientId === c.id}
                    onClick={() => void handleStaffResetClientPassword(c)}
                    className="px-2.5 py-1.5 rounded-xl border border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 font-bold inline-flex items-center gap-1 disabled:opacity-50"
                  >
                    <KeyRound className="w-3.5 h-3.5" />
                    <span>{resetBusyClientId === c.id ? "جاري التعيين..." : "إعادة تعيين كلمة المرور"}</span>
                  </button>
                )}

                {c.status === "PENDING_APPROVAL" && (
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={linkCustEdits[c.id] || ""}
                      onChange={(e) =>
                        setLinkCustEdits((prev) => ({ ...prev, [c.id]: e.target.value }))
                      }
                      className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1"
                    >
                      <option value="">إنشاء بطاقة عميل جديدة (COA 112190xxx)</option>
                      {availableCustomers.map((ac) => (
                        <option key={ac.id} value={ac.id}>
                          ربط بـ: {ac.nameAr} ({ac.phone})
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      min="0"
                      placeholder="الحد الائتماني"
                      value={creditEdits[c.id] ?? "0"}
                      onChange={(e) =>
                        setCreditEdits((prev) => ({ ...prev, [c.id]: e.target.value }))
                      }
                      className="w-28 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-2 py-1 font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => void handleReviewClient(c.id, "APPROVE")}
                      className="px-3 py-1.5 rounded-xl accent-bg font-extrabold inline-flex items-center gap-1"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>اعتماد وتفعيل</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleReviewClient(c.id, "REJECT")}
                      className="px-2.5 py-1.5 rounded-xl border border-rose-300 text-rose-600 font-bold inline-flex items-center gap-1"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      <span>رفض</span>
                    </button>
                  </div>
                )}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* SECTION 3: WHATSAPP APPROVAL & EDIT-BEFORE-SEND QUEUE */}
      {section === "whatsapp" && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <select
              value={waStatusFilter}
              onChange={(e) => setWaStatusFilter(e.target.value)}
              className="rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 font-bold"
            >
              <option value="PENDING_APPROVAL">بانتظار الاعتماد والتعديل قبل الإرسال</option>
              <option value="DISPATCHED_LINK">تم الفتح عبر واتساب</option>
              <option value="APPROVED_SENT">تم الإرسال عبر البوابة</option>
              <option value="SKIPPED">المتجاهلة</option>
              <option value="ALL">جميع المسودات والرسائل</option>
            </select>
          </div>

          {waDrafts.length === 0 ? (
            <div className="p-6 rounded-2xl bg-slate-50 dark:bg-slate-800/40 text-center text-slate-500">
              لا توجد رسائل في قائمة اعتماد وإرسال واتساب ضمن هذا الفلتر.
            </div>
          ) : (
            waDrafts.map((d) => {
              const currentText =
                waEdits[d.id] !== undefined ? waEdits[d.id] : d.finalMessageText;
              const canAct = d.status === "PENDING_APPROVAL" || d.status === "FAILED";
              return (
                <div
                  key={d.id}
                  className="p-4 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 space-y-2.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono font-bold px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800">
                        <bdi dir="ltr">{d.draftNumber}</bdi>
                      </span>
                      <span className="font-black text-sm">{d.recipientName}</span>
                      <bdi dir="ltr" className="font-mono text-emerald-700 dark:text-emerald-300 font-bold">
                        +{d.recipientPhone}
                      </bdi>
                      <span className="px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-200 font-bold text-[10px]">
                        {d.eventType}
                      </span>
                      <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 font-bold text-[10px]">
                        {d.status}
                      </span>
                    </div>
                    {d.approvedByName && (
                      <span className="text-[10px] text-slate-400">
                        بواسطة: {d.approvedByName}
                      </span>
                    )}
                  </div>

                  <textarea
                    rows={4}
                    disabled={!canAct}
                    value={currentText}
                    onChange={(e) =>
                      setWaEdits((prev) => ({ ...prev, [d.id]: e.target.value }))
                    }
                    className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/40 p-2.5 text-xs leading-relaxed disabled:opacity-75"
                  />

                  {canAct && (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setWaEdits((prev) => ({ ...prev, [d.id]: d.originalMessageText }))
                        }
                        className="text-slate-500 hover:underline font-bold"
                      >
                        استعادة النص الأصلي
                      </button>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void handleSkipWhatsApp(d)}
                          className="px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 font-bold"
                        >
                          تجاهل
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleApproveAndSendWhatsApp(d)}
                          className="px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold inline-flex items-center gap-1.5"
                        >
                          <Send className="w-3.5 h-3.5" />
                          <span>اعتماد وإرسال</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* SECTION 4: TENANT FORM & PER-TENANT WHATSAPP SETTINGS */}
      {section === "settings" && canManageSettings && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {formCfg && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const res = await fetch("/api/portal-admin/form-config", {
                  method: "PUT",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ formConfig: formCfg }),
                });
                const data = (await res.json()) as { message?: string; error?: string };
                onToast(res.ok ? data.message || "✅ تم حفظ إعدادات النماذج" : data.error || "تعذر الحفظ");
              }}
              className="p-4 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 space-y-3"
            >
              <h4 className="font-black text-sm">إعدادات نماذج بوابة العملاء</h4>
              <div>
                <label className="block font-bold mb-1">سياسة اعتماد العملاء الجدد</label>
                <select
                  value={formCfg.approvalPolicy}
                  onChange={(e) =>
                    setFormCfg({
                      ...formCfg,
                      approvalPolicy: e.target.value === "AUTO" ? "AUTO" : "MANUAL",
                    })
                  }
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 font-bold"
                >
                  <option value="MANUAL">اعتماد يدوي من موظف المنشأة (موصى به)</option>
                  <option value="AUTO">تفعيل تلقائي فور التسجيل</option>
                </select>
              </div>
              <div>
                <label className="block font-bold mb-1">عنوان نموذج الطلب</label>
                <input
                  type="text"
                  value={formCfg.requestHeadingAr}
                  onChange={(e) => setFormCfg({ ...formCfg, requestHeadingAr: e.target.value })}
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2"
                />
              </div>
              <label className="inline-flex items-center gap-2 cursor-pointer font-bold">
                <input
                  type="checkbox"
                  checked={formCfg.allowCustomPickup}
                  onChange={(e) => setFormCfg({ ...formCfg, allowCustomPickup: e.target.checked })}
                />
                <span>السماح بإدخال موقع استلام مخصص (أخرى)</span>
              </label>
              <label className="inline-flex items-center gap-2 cursor-pointer font-bold">
                <input
                  type="checkbox"
                  checked={formCfg.allowUnlistedItems}
                  onChange={(e) => setFormCfg({ ...formCfg, allowUnlistedItems: e.target.checked })}
                />
                <span>السماح بطلب أصناف غير مدرجة بالكتالوج</span>
              </label>
              <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-2">
                <div className="font-bold">تسعير الوحدات الافتراضي في البوابة (اختياري)</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {formCfg.unitOptions.map((u, idx) => (
                    <div
                      key={u.code}
                      className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 dark:border-slate-700 px-2.5 py-1.5"
                    >
                      <span className="font-bold truncate">{u.labelAr}</span>
                      <input
                        type="number"
                        step="any"
                        min="0"
                        placeholder="السعر الافتراضي"
                        value={u.defaultUnitPrice ? String(u.defaultUnitPrice) : ""}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          const nextUnits = formCfg.unitOptions.map((item, i) =>
                            i === idx
                              ? { ...item, defaultUnitPrice: Number.isFinite(v) && v > 0 ? v : undefined }
                              : item
                          );
                          setFormCfg({ ...formCfg, unitOptions: nextUnits });
                        }}
                        className="w-28 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-2 py-1 font-mono text-xs"
                      />
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <button type="submit" className="px-4 py-2 rounded-xl accent-bg font-extrabold inline-flex items-center gap-1.5">
                  <Save className="w-3.5 h-3.5" />
                  <span>حفظ إعدادات النماذج</span>
                </button>
              </div>
            </form>
          )}

          {waSettings && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const res = await fetch("/api/whatsapp-outbox", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    action: "SAVE_SETTINGS",
                    provider: waSettings.provider,
                    gatewayUrl: waSettings.gatewayUrl,
                    senderPhone: waSettings.senderPhone,
                    defaultCountryCode: waSettings.defaultCountryCode,
                    apiToken: waApiTokenInput.trim() || undefined,
                    isActive: waSettings.isActive,
                  }),
                });
                const data = (await res.json()) as {
                  settings?: TenantWhatsAppSettingsPublic;
                  message?: string;
                  error?: string;
                };
                if (res.ok && data.settings) {
                  setWaSettings(data.settings);
                  setWaApiTokenInput("");
                }
                onToast(res.ok ? data.message || "✅ تم حفظ إعدادات واتساب" : data.error || "تعذر الحفظ");
              }}
              className="p-4 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 space-y-3"
            >
              <h4 className="font-black text-sm">إعدادات بوابة واتساب المعزولة للمنشأة</h4>
              <div>
                <label className="block font-bold mb-1">قناة الإرسال</label>
                <select
                  value={waSettings.provider}
                  onChange={(e) =>
                    setWaSettings({
                      ...waSettings,
                      provider: e.target.value as TenantWhatsAppSettingsPublic["provider"],
                    })
                  }
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 font-bold"
                >
                  <option value="WHATSAPP_WEB_LINK">رابط واتساب المباشر (wa.me بعد الاعتماد والتعديل)</option>
                  <option value="CLOUD_API">WhatsApp Cloud API (لكل منشأة مفاتيحها المعزولة)</option>
                  <option value="CUSTOM_WEBHOOK">Webhook / مزود خاص للمنشأة</option>
                </select>
              </div>
              {waSettings.provider !== "WHATSAPP_WEB_LINK" && (
                <>
                  <div>
                    <label className="block font-bold mb-1">رابط البوابة / Webhook URL</label>
                    <input
                      type="url"
                      dir="ltr"
                      value={waSettings.gatewayUrl}
                      onChange={(e) => setWaSettings({ ...waSettings, gatewayUrl: e.target.value })}
                      className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 text-right"
                    />
                  </div>
                  <div>
                    <label className="block font-bold mb-1">
                      مفتاح API {waSettings.hasApiToken ? `(محفوظ: ${waSettings.maskedApiToken})` : ""}
                    </label>
                    <input
                      type="password"
                      dir="ltr"
                      value={waApiTokenInput}
                      onChange={(e) => setWaApiTokenInput(e.target.value)}
                      placeholder="اتركه فارغاً للإبقاء على المفتاح الحالي"
                      className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 text-right"
                    />
                  </div>
                </>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className="block font-bold mb-1">رقم المرسل</label>
                  <PhoneContactInput
                    format="whatsapp_digits"
                    value={waSettings.senderPhone}
                    onChange={(val) => setWaSettings({ ...waSettings, senderPhone: val })}
                    fallbackContacts={clients.map((c) => ({
                      id: c.id,
                      name: c.fullName,
                      phone: c.phone,
                      subtitle: c.linkedCustomerCode || c.preferredPickup,
                    }))}
                    placeholder="967770000000"
                    inputClassName="flex-1 min-w-0 rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 text-right font-mono"
                  />
                </div>
                <div>
                  <label className="block font-bold mb-1">رمز الدولة الافتراضي</label>
                  <input
                    type="text"
                    dir="ltr"
                    value={waSettings.defaultCountryCode}
                    onChange={(e) =>
                      setWaSettings({ ...waSettings, defaultCountryCode: e.target.value })
                    }
                    className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 text-right font-mono"
                  />
                </div>
              </div>
              <button type="submit" className="px-4 py-2 rounded-xl accent-bg font-extrabold inline-flex items-center gap-1.5">
                <Save className="w-3.5 h-3.5" />
                <span>حفظ إعدادات واتساب</span>
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
