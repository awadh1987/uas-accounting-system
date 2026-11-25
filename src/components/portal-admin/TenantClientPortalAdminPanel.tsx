"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Archive,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Copy,
  CornerUpLeft,
  CreditCard,
  Eye,
  EyeOff,
  FolderOpen,
  KeyRound,
  Layers,
  MessageSquare,
  PackageCheck,
  Plus,
  RefreshCw,
  Save,
  Search,
  Send,
  Settings,
  Trash2,
  UserCheck,
  Wallet,
  XCircle,
} from "lucide-react";
import { PortalAdminPaymentGateSection } from "@/components/portal-admin/PortalAdminPaymentGateSection";
import type { PaymentPaginationMeta } from "@/components/client-portal/ClientPaymentsSection";
import { openExternalOrWhatsApp } from "@/lib/nativeBridge";
import { computeSaleTotals, fmtNum } from "@/lib/formulas";
import {
  formatIsoToDmyTime,
  formatMoney,
  formatRefreshTimestamp,
} from "@/lib/uiFormatters";
import { ActionOverflowMenu } from "@/components/ActionOverflowMenu";
import { PhoneContactInput } from "@/components/PhoneContactInput";
import { SvgAvatar } from "@/components/SvgAvatar";
import { PortalCatalogBoardAdminSection } from "@/components/portal-admin/PortalCatalogBoardAdminSection";
import { groupRequestsByClientAndMonth } from "@/lib/clientPortal/requestGrouping";
import { filterOutSyntheticTestRecords, isSyntheticTestRecord } from "@/lib/testRecordHygiene";
import type { AmendmentDiffEntry } from "@/lib/clientPortal/portalTypes";
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

interface StaffRequestLineItem {
  id: string;
  itemId: string | null;
  itemTitle: string;
  requestedQty: number;
  confirmedQty: number | null;
  unitCode?: string;
  unitLabel?: string;
  customUnitLabel?: string | null;
  displayUnitLabel: string;
  unitPrice: number;
  lineTotal: number;
  isNew?: boolean;
  remove?: boolean;
}

interface StaffRequestItem {
  id: string;
  requestNumber: string;
  status: string;
  statusLabelAr: string;
  pickupType?: string;
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
  reviewerRemarks?: string | null;
  amendmentDiff?: AmendmentDiffEntry[];
  revisionNumber?: number;
  returnedToClientAt?: string | null;
  returnedToClientAtDisplay?: string | null;
  returnedByName?: string | null;
  clientResponseStatus?: string | null;
  clientResponseStatusLabelAr?: string | null;
  clientResponseNote?: string | null;
  clientRespondedAt?: string | null;
  clientRespondedAtDisplay?: string | null;
  sectorType?: string;
  submissionType?: string;
  isArchived?: boolean;
  archivedAt?: string | null;
  archivedAtDisplay?: string | null;
  isHiddenByStaff?: boolean;
  createdAt: string;
  createdAtDisplay?: string;
  updatedAt?: string;
  updatedAtDisplay?: string;
  approvedAtDisplay?: string | null;
  reviewedAt?: string | null;
  reviewedAtDisplay?: string | null;
  readyAt?: string | null;
  readyAtDisplay?: string | null;
  handedOverAt?: string | null;
  handedOverAtDisplay?: string | null;
  canArchiveOrHide?: boolean;
  canSafelyDelete?: boolean;
  clientAccount?: {
    id: string;
    fullName: string;
    phone: string;
    customerId: string | null;
    avatarUrl?: string;
    avatarColor?: string;
    avatarChar?: string;
  };
  lines: StaffRequestLineItem[];
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
  approvedAt?: string | null;
  approvedAtDisplay?: string | null;
  sentAt: string | null;
  sentAtDisplay?: string | null;
  skippedReason: string | null;
  createdAt: string;
  createdAtDisplay?: string;
}

interface TenantClientPortalAdminPanelProps {
  initialSection?:
  | "registrations"
  | "requests"
  | "catalog"
  | "payments"
  | "payment_channels"
  | "whatsapp"
  | "settings";
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
  const [section, setSection] = useState<
    "registrations" | "requests" | "catalog" | "payments" | "payment_channels" | "whatsapp" | "settings"
  >(initialSection);
  const [loading, setLoading] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState("");
  const [hideTestRecords, setHideTestRecords] = useState(true);
  const [showHiddenStaffRequests, setShowHiddenStaffRequests] = useState(false);
  const [selectedStaffReqIds, setSelectedStaffReqIds] = useState<Record<string, boolean>>({});
  const [reqViewMode, setReqViewMode] = useState<"directories" | "flat">("directories");
  const [selectedClientDir, setSelectedClientDir] = useState<string>("ALL");
  const [selectedMonthDir, setSelectedMonthDir] = useState<string>("ALL");
  const [sectorFilter, setSectorFilter] = useState<"ALL" | "HARVEST" | "COMMERCIAL">("ALL");
  const [collapsedDirs, setCollapsedDirs] = useState<Record<string, boolean>>({});

  // Server-side search & pagination for 1,000+ scale
  const [clientsSearchInput, setClientsSearchInput] = useState("");
  const [clientsDebouncedSearch, setClientsDebouncedSearch] = useState("");
  const [clientsPage, setClientsPage] = useState(1);
  const [clientsPagination, setClientsPagination] = useState<PaymentPaginationMeta>({
    page: 1,
    pageSize: 50,
    total: 0,
    totalPages: 1,
    hasMore: false,
  });
  const [requestsSearchInput, setRequestsSearchInput] = useState("");
  const [requestsDebouncedSearch, setRequestsDebouncedSearch] = useState("");
  const [requestsPage, setRequestsPage] = useState(1);
  const [requestsPagination, setRequestsPagination] = useState<PaymentPaginationMeta>({
    page: 1,
    pageSize: 50,
    total: 0,
    totalPages: 1,
    hasMore: false,
  });
  const [pendingPaymentsCount, setPendingPaymentsCount] = useState(0);

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

  // Incoming Requests & Staff Amendments
  const [requests, setRequests] = useState<StaffRequestItem[]>([]);
  const [projects, setProjects] = useState<Array<{ id: string; code: string; nameAr: string }>>([]);
  const [treasuries, setTreasuries] = useState<Array<{ id: string; code: string; nameAr: string }>>([]);
  const [lineTitleEdits, setLineTitleEdits] = useState<Record<string, string>>({});
  const [lineUnitEdits, setLineUnitEdits] = useState<Record<string, string>>({});
  const [lineCustomUnitEdits, setLineCustomUnitEdits] = useState<Record<string, string>>({});
  const [lineQtyEdits, setLineQtyEdits] = useState<Record<string, string>>({});
  const [linePriceEdits, setLinePriceEdits] = useState<Record<string, string>>({});
  const [addedLinesByReq, setAddedLinesByReq] = useState<Record<string, StaffRequestLineItem[]>>({});
  const [removedLineIds, setRemovedLineIds] = useState<Record<string, boolean>>({});
  const [postHandoverEditIds, setPostHandoverEditIds] = useState<Record<string, boolean>>({});
  const [reqPickupLocationEdits, setReqPickupLocationEdits] = useState<Record<string, string>>({});
  const [reqCustomPickupEdits, setReqCustomPickupEdits] = useState<Record<string, string>>({});
  const [reqPickupNotesEdits, setReqPickupNotesEdits] = useState<Record<string, string>>({});
  const [reqReviewerRemarks, setReqReviewerRemarks] = useState<Record<string, string>>({});
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

  useEffect(() => {
    const t = setTimeout(() => {
      setClientsDebouncedSearch(clientsSearchInput.trim());
      setClientsPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [clientsSearchInput]);

  useEffect(() => {
    const t = setTimeout(() => {
      setRequestsDebouncedSearch(requestsSearchInput.trim());
      setRequestsPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [requestsSearchInput]);

  const loadAll = useCallback(async (manual = false) => {
    setLoading(true);
    try {
      const cQs = new URLSearchParams({
        page: String(clientsPage),
        pageSize: "50",
      });
      if (clientsDebouncedSearch) cQs.set("search", clientsDebouncedSearch);

      const rQs = new URLSearchParams({
        page: String(requestsPage),
        pageSize: "50",
      });
      if (showHiddenStaffRequests) rQs.set("includeHidden", "1");
      if (requestsDebouncedSearch) rQs.set("search", requestsDebouncedSearch);

      const [cRes, rRes, wRes, fRes, pRes] = await Promise.all([
        fetch(`/api/portal-admin/clients?${cQs.toString()}`, { cache: "no-store" }),
        fetch(`/api/portal-admin/requests?${rQs.toString()}`, { cache: "no-store" }),
        fetch(`/api/whatsapp-outbox?status=${encodeURIComponent(waStatusFilter)}`, { cache: "no-store" }),
        fetch("/api/portal-admin/form-config", { cache: "no-store" }),
        fetch("/api/portal-admin/payments?status=PENDING_VERIFICATION&pageSize=1", { cache: "no-store" }),
      ]);

      if (cRes.ok) {
        const cData = (await cRes.json()) as {
          clients?: StaffClientAccount[];
          pagination?: PaymentPaginationMeta;
          availableCustomers?: Array<{ id: string; code: string; nameAr: string; phone: string }>;
        };
        setClients(cData.clients || []);
        if (cData.pagination) setClientsPagination(cData.pagination);
        setAvailableCustomers(cData.availableCustomers || []);
      }
      if (rRes.ok) {
        const rData = (await rRes.json()) as {
          requests?: StaffRequestItem[];
          pagination?: PaymentPaginationMeta;
          projects?: Array<{ id: string; code: string; nameAr: string }>;
          treasuries?: Array<{ id: string; code: string; nameAr: string }>;
        };
        setRequests(rData.requests || []);
        if (rData.pagination) setRequestsPagination(rData.pagination);
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
      if (pRes.ok) {
        const pData = (await pRes.json()) as { pagination?: { total?: number } };
        setPendingPaymentsCount(pData.pagination?.total ?? 0);
      }
      setLastRefreshedAt(new Date().toISOString());
      if (manual) onToast("✅ تم تحديث بوابة العملاء وإيصالات السداد وقائمة واتساب");
    } catch {
      onToast("تعذر تحميل بيانات بوابة العملاء");
    } finally {
      setLoading(false);
    }
  }, [waStatusFilter, showHiddenStaffRequests, clientsPage, clientsDebouncedSearch, requestsPage, requestsDebouncedSearch, onToast]);

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
    action: "CONFIRM" | "MARK_READY" | "HANDOVER" | "AMEND" | "RETURN_TO_CLIENT" | "REJECT" | "CANCEL"
  ) {
    const extraLines = addedLinesByReq[reqItem.id] || [];
    const existingLinePayloads = reqItem.lines.map((l) => {
      const nextUnitCode = lineUnitEdits[l.id] || l.unitCode || "QAT_BUNCH";
      const nextCustomUnit =
        lineCustomUnitEdits[l.id] !== undefined
          ? lineCustomUnitEdits[l.id]
          : l.customUnitLabel || "";
      const unitOpt = formCfg?.unitOptions.find((u) => u.code === nextUnitCode);
      return {
        id: l.id,
        itemId: l.itemId,
        itemTitle:
          lineTitleEdits[l.id] !== undefined ? lineTitleEdits[l.id].trim() : l.itemTitle,
        confirmedQty:
          lineQtyEdits[l.id] !== undefined
            ? Number(lineQtyEdits[l.id])
            : Number(l.confirmedQty ?? l.requestedQty),
        unitCode: nextUnitCode,
        unitLabel:
          nextUnitCode === "OTHER"
            ? nextCustomUnit.trim() || "أخرى"
            : unitOpt?.labelAr || l.unitLabel || l.displayUnitLabel,
        customUnitLabel: nextUnitCode === "OTHER" ? nextCustomUnit.trim() : null,
        unitPrice:
          linePriceEdits[l.id] !== undefined ? Number(linePriceEdits[l.id]) : Number(l.unitPrice || 0),
        remove: Boolean(removedLineIds[l.id]),
      };
    });

    const addedPayloads = extraLines
      .filter((xl) => !removedLineIds[xl.id] && (lineTitleEdits[xl.id] ?? xl.itemTitle).trim())
      .map((xl) => {
        const nextUnitCode = lineUnitEdits[xl.id] || xl.unitCode || "QAT_BUNCH";
        const nextCustomUnit =
          lineCustomUnitEdits[xl.id] !== undefined
            ? lineCustomUnitEdits[xl.id]
            : xl.customUnitLabel || "";
        const unitOpt = formCfg?.unitOptions.find((u) => u.code === nextUnitCode);
        return {
          itemTitle: (lineTitleEdits[xl.id] ?? xl.itemTitle).trim(),
          confirmedQty:
            lineQtyEdits[xl.id] !== undefined
              ? Number(lineQtyEdits[xl.id])
              : Number(xl.confirmedQty ?? xl.requestedQty ?? 1),
          unitCode: nextUnitCode,
          unitLabel:
            nextUnitCode === "OTHER"
              ? nextCustomUnit.trim() || "أخرى"
              : unitOpt?.labelAr || "علاقية قات",
          customUnitLabel: nextUnitCode === "OTHER" ? nextCustomUnit.trim() : null,
          unitPrice:
            linePriceEdits[xl.id] !== undefined ? Number(linePriceEdits[xl.id]) : Number(xl.unitPrice || 0),
        };
      });

    const editedPickupLoc = reqPickupLocationEdits[reqItem.id];
    const pickupOpt = formCfg?.pickupOptions.find((p) => p.labelAr === editedPickupLoc || p.code === editedPickupLoc);
    const isOtherPickup =
      editedPickupLoc === "__OTHER__" ||
      editedPickupLoc === "أخرى" ||
      pickupOpt?.type === "OTHER";

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
        pickupType: isOtherPickup ? "OTHER" : pickupOpt?.type || reqItem.pickupType,
        pickupLocation:
          editedPickupLoc !== undefined
            ? isOtherPickup
              ? "أخرى"
              : pickupOpt?.labelAr || editedPickupLoc
            : reqItem.pickupLocation,
        customPickupLocation: isOtherPickup
          ? reqCustomPickupEdits[reqItem.id] || ""
          : undefined,
        pickupNotes:
          reqPickupNotesEdits[reqItem.id] !== undefined
            ? reqPickupNotesEdits[reqItem.id]
            : reqItem.pickupNotes,
        reviewerRemarks:
          reqReviewerRemarks[reqItem.id] !== undefined
            ? reqReviewerRemarks[reqItem.id]
            : undefined,
        lines: [...existingLinePayloads, ...addedPayloads],
      }),
    });
    const data = (await res.json()) as { message?: string; error?: string };
    if (!res.ok) {
      onToast(data.error || "تعذر معالجة طلب العميل");
      return;
    }
    setAddedLinesByReq((prev) => ({ ...prev, [reqItem.id]: [] }));
    if (reqItem.status === "COMPLETED" && action === "AMEND") {
      setPostHandoverEditIds((prev) => ({ ...prev, [reqItem.id]: false }));
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

  async function handleStaffRequestLifecycle(
    reqItem: StaffRequestItem,
    action: "ARCHIVE" | "UNARCHIVE" | "HIDE" | "UNHIDE" | "DELETE"
  ) {
    const res = await fetch("/api/portal-admin/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId: reqItem.id, action }),
    });
    const data = (await res.json()) as { message?: string; error?: string };
    if (!res.ok) {
      onToast(data.error || "تعذر تنفيذ الإجراء على الطلب");
      return;
    }
    onToast(data.message || "✅ تم تحديث الطلب بنجاح");
    await Promise.all([loadAll(false), onRefreshState?.()]);
  }

  async function handleStaffBulkHide(useSelectedOnly: boolean) {
    const requestIds = useSelectedOnly
      ? Object.entries(selectedStaffReqIds)
        .filter(([, checked]) => checked)
        .map(([id]) => id)
      : undefined;
    const res = await fetch("/api/portal-admin/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "BULK_HIDE",
        ...(requestIds && requestIds.length > 0 ? { requestIds } : {}),
        includeArchived: true,
      }),
    });
    const data = (await res.json()) as { message?: string; error?: string };
    if (!res.ok) {
      onToast(data.error || "تعذر تنفيذ الإخفاء الجماعي");
      return;
    }
    setSelectedStaffReqIds({});
    onToast(data.message || "✅ تم الإخفاء الجماعي بنجاح");
    await loadAll(false);
  }

  const { visible: visibleRequests, hiddenCount: hiddenRequestsCount } =
    filterOutSyntheticTestRecords(requests, hideTestRecords);
  const { visible: visibleClients, hiddenCount: hiddenClientsCount } =
    filterOutSyntheticTestRecords(clients, hideTestRecords);
  const { visible: visibleWaDrafts, hiddenCount: hiddenWaCount } =
    filterOutSyntheticTestRecords(waDrafts, hideTestRecords);

  const pendingClientsCount = visibleClients.filter((c) => c.status === "PENDING_APPROVAL").length;
  const openRequestsCount = visibleRequests.filter((r) =>
    ["PENDING_REVIEW", "RETURNED_TO_CLIENT", "CONFIRMED", "READY_FOR_PICKUP"].includes(r.status)
  ).length;
  const pendingWaCount = visibleWaDrafts.filter((w) => w.status === "PENDING_APPROVAL").length;
  const totalHiddenTestCount = hiddenRequestsCount + hiddenClientsCount + hiddenWaCount;

  return (
    <div className="space-y-4 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-200 dark:border-slate-800">
        <div className="flex flex-wrap items-center gap-1.5">
          {[
            { id: "requests" as const, label: `طلبات العملاء الواردة (${openRequestsCount})`, Icon: PackageCheck },
            { id: "payments" as const, label: `إيصالات السداد (${pendingPaymentsCount})`, Icon: CreditCard },
            { id: "catalog" as const, label: "لوحة الأصناف والفرز والأسعار", Icon: Layers },
            { id: "registrations" as const, label: `تسجيلات العملاء (${pendingClientsCount} معلق)`, Icon: UserCheck },
            { id: "whatsapp" as const, label: `قائمة اعتماد وإرسال واتساب (${pendingWaCount})`, Icon: MessageSquare },
            ...(canManageSettings
              ? [
                { id: "payment_channels" as const, label: "بوابات وحسابات الاستلام", Icon: Wallet },
                { id: "settings" as const, label: "تخصيص النماذج وواتساب", Icon: Settings },
              ]
              : []),
          ].map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setSection(id)}
              className={`px-3 py-1.5 rounded-xl font-extrabold inline-flex items-center gap-1.5 transition ${section === id
                ? "accent-bg shadow-sm"
                : "border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{label}</span>
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {section === "requests" && (
            <>
              <button
                type="button"
                data-testid="staff-bulk-hide-completed-btn"
                onClick={() => void handleStaffBulkHide(false)}
                className="px-2.5 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-[11px] font-bold inline-flex items-center gap-1"
              >
                <EyeOff className="w-3.5 h-3.5" />
                <span>إخفاء جماعي للمكتمل/الملغى</span>
              </button>
              {Object.values(selectedStaffReqIds).some(Boolean) && (
                <button
                  type="button"
                  data-testid="staff-bulk-hide-selected-btn"
                  onClick={() => void handleStaffBulkHide(true)}
                  className="px-2.5 py-1.5 rounded-xl bg-slate-800 text-white text-[11px] font-bold inline-flex items-center gap-1"
                >
                  <EyeOff className="w-3.5 h-3.5" />
                  <span>إخفاء المحدد ({Object.values(selectedStaffReqIds).filter(Boolean).length})</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowHiddenStaffRequests((prev) => !prev)}
                className={`px-2.5 py-1.5 rounded-xl border text-[11px] font-bold inline-flex items-center gap-1 ${showHiddenStaffRequests
                  ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-200"
                  : "border-slate-300 dark:border-slate-700"
                  }`}
              >
                {showHiddenStaffRequests ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                <span>{showHiddenStaffRequests ? "إخفاء المخفية" : "عرض المخفية"}</span>
              </button>
            </>
          )}
          <button
            type="button"
            data-testid="portal-admin-toggle-test-filter"
            onClick={() => setHideTestRecords((prev) => !prev)}
            className={`px-2.5 py-1.5 rounded-xl border text-[11px] font-bold ${hideTestRecords
              ? "border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300"
              : "border-amber-400 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200"
              }`}
          >
            {hideTestRecords
              ? `عرض السجلات التجريبية (${totalHiddenTestCount})`
              : "إخفاء السجلات التجريبية"}
          </button>
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

      {/* SECTION 0: TENANT CATALOG, GRADING & PRICING BOARD */}
      {section === "catalog" && (
        <PortalCatalogBoardAdminSection
          formConfig={formCfg}
          hideTestRecords={hideTestRecords}
          onToast={onToast}
        />
      )}

      {/* SECTION 0B: PAYMENT RECEIPT VERIFICATION QUEUE */}
      {section === "payments" && (
        <PortalAdminPaymentGateSection
          mode="payments"
          canManageChannels={canManageSettings}
          onToast={onToast}
          onChanged={() => loadAll(false)}
        />
      )}

      {/* SECTION 0C: TENANT PAYMENT CHANNELS SETUP */}
      {section === "payment_channels" && canManageSettings && (
        <PortalAdminPaymentGateSection
          mode="channels"
          canManageChannels={canManageSettings}
          onToast={onToast}
          onChanged={() => loadAll(false)}
        />
      )}

      {/* SECTION 1: INCOMING REQUESTS, CLIENT MONTHLY DIRECTORIES, AMENDMENTS, RETURN LOOP & HANDOVER */}
      {section === "requests" && (() => {
        const sectorScopedRequests =
          sectorFilter === "ALL"
            ? visibleRequests
            : visibleRequests.filter(
              (r) => (r.sectorType || "HARVEST").toUpperCase() === sectorFilter
            );
        const grouped = groupRequestsByClientAndMonth(sectorScopedRequests);
        const filteredDirectories = grouped.directories
          .filter((d) => selectedClientDir === "ALL" || d.clientKey === selectedClientDir)
          .map((d) => ({
            ...d,
            months: d.months.filter(
              (m) => selectedMonthDir === "ALL" || m.monthKey === selectedMonthDir
            ),
          }))
          .filter((d) => d.months.length > 0);
        const filteredFlatRequests = filteredDirectories.flatMap((d) =>
          d.months.flatMap((m) => m.requests)
        );

        const renderStaffRequestCard = (r: StaffRequestItem) => {
          const combinedLines = [...r.lines, ...(addedLinesByReq[r.id] || [])].filter(
            (l) => !removedLineIds[l.id]
          );
          const liveLines = combinedLines.map((l) => {
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
          const isPostHandoverEditing = Boolean(postHandoverEditIds[r.id]);
          const isLockedTerminal =
            r.status === "REJECTED" ||
            r.status === "CANCELLED" ||
            (r.status === "COMPLETED" && !isPostHandoverEditing);
          const currentPickupChoice =
            reqPickupLocationEdits[r.id] !== undefined
              ? reqPickupLocationEdits[r.id]
              : formCfg?.pickupOptions.some((o) => o.labelAr === r.pickupLocation && o.type !== "OTHER")
                ? r.pickupLocation
                : "__OTHER__";
          const isTestRec = isSyntheticTestRecord(r);

          const canStaffArchiveHide =
            r.canArchiveOrHide ??
            (["COMPLETED", "CANCELLED", "REJECTED"].includes(r.status) || Boolean(r.isArchived));
          const canStaffSafeDelete =
            r.canSafelyDelete ??
            (["CANCELLED", "REJECTED", "PENDING_REVIEW", "RETURNED_TO_CLIENT"].includes(r.status) &&
              !r.reserveStock &&
              !r.linkedSalesRecordId &&
              !r.linkedSaleId &&
              !r.linkedInvoiceId);

          return (
            <div
              key={r.id}
              data-testid={`staff-portal-request-${r.id}`}
              className="p-4 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 space-y-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  {canStaffArchiveHide && (
                    <input
                      type="checkbox"
                      aria-label={`تحديد الطلب ${r.requestNumber}`}
                      checked={Boolean(selectedStaffReqIds[r.id])}
                      onChange={(e) =>
                        setSelectedStaffReqIds((prev) => ({
                          ...prev,
                          [r.id]: e.target.checked,
                        }))
                      }
                      className="rounded border-slate-300"
                    />
                  )}
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
                  <span
                    className={`px-2 py-0.5 rounded-full font-bold ${r.status === "RETURNED_TO_CLIENT"
                      ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200"
                      : "bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-200"
                      }`}
                  >
                    {r.statusLabelAr}
                  </span>
                  {r.clientResponseStatus === "PENDING_STAFF_APPROVAL" && (
                    <span
                      data-testid={`staff-awaiting-approval-${r.id}`}
                      className="px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200 text-[10px] font-black"
                    >
                      بانتظار اعتماد الموظف
                    </span>
                  )}
                  {r.revisionNumber && r.revisionNumber > 1 && (
                    <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-[10px] font-bold">
                      مراجعة #{r.revisionNumber}
                    </span>
                  )}
                  {activeSalesLink && (
                    <span className="px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-200 font-bold font-mono text-[10px]">
                      مرتبط بالمبيعات (<bdi dir="ltr">{activeSalesLink.slice(0, 8)}</bdi>)
                    </span>
                  )}
                  {isTestRec && (
                    <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 text-[10px] font-bold">
                      اختباري
                    </span>
                  )}
                  {r.isArchived && (
                    <span className="px-2 py-0.5 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[10px] font-bold">
                      مؤرشف
                    </span>
                  )}
                  {r.isHiddenByStaff && (
                    <span className="px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-200 text-[10px] font-bold">
                      مخفي
                    </span>
                  )}
                  <span className="text-slate-500">• استلام من: <strong>{r.pickupLocation}</strong></span>
                  <span className="font-mono text-slate-500 inline-flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    <bdi dir="ltr">{r.createdAtDisplay || formatIsoToDmyTime(r.createdAt)}</bdi>
                  </span>
                  {r.handedOverAt && (
                    <span className="font-mono text-[10px] text-emerald-700 dark:text-emerald-300">
                      تسليم: <bdi dir="ltr">{r.handedOverAtDisplay || formatIsoToDmyTime(r.handedOverAt)}</bdi>
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-black text-emerald-700 dark:text-emerald-300">
                    الإجمالي: {formatMoney(liveOrderTotal)}
                  </span>
                  {r.status === "COMPLETED" && (
                    <button
                      type="button"
                      data-testid={`staff-toggle-post-amend-${r.id}`}
                      onClick={() =>
                        setPostHandoverEditIds((prev) => ({ ...prev, [r.id]: !prev[r.id] }))
                      }
                      className={`px-2.5 py-1 rounded-xl border text-[11px] font-bold ${isPostHandoverEditing
                        ? "border-amber-500 bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200"
                        : "border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                        }`}
                    >
                      {isPostHandoverEditing ? "إلغاء تعديل التسليم" : "تعديل ما بعد التسليم"}
                    </button>
                  )}
                  <ActionOverflowMenu
                    size="xs"
                    align="end"
                    items={[
                      {
                        id: "add-line",
                        label: "إضافة صنف جديد للطلب",
                        icon: <Plus className="w-3.5 h-3.5" />,
                        hidden: isLockedTerminal,
                        onClick: () =>
                          setAddedLinesByReq((prev) => ({
                            ...prev,
                            [r.id]: [
                              ...(prev[r.id] || []),
                              {
                                id: `new-${Date.now()}`,
                                itemId: null,
                                itemTitle: "",
                                requestedQty: 1,
                                confirmedQty: 1,
                                unitCode: "QAT_BUNCH",
                                unitLabel: "علاقية قات",
                                displayUnitLabel: "علاقية قات",
                                unitPrice: 0,
                                lineTotal: 0,
                                isNew: true,
                              },
                            ],
                          })),
                      },
                      {
                        id: "archive-staff",
                        label: r.isArchived ? "إلغاء الأرشفة" : "أرشفة الطلب",
                        icon: <Archive className="w-3.5 h-3.5" />,
                        hidden: !canStaffArchiveHide,
                        onClick: () =>
                          handleStaffRequestLifecycle(r, r.isArchived ? "UNARCHIVE" : "ARCHIVE"),
                      },
                      {
                        id: "hide-staff",
                        label: r.isHiddenByStaff ? "إظهار الطلب" : "إخفاء الطلب",
                        icon: r.isHiddenByStaff ? (
                          <Eye className="w-3.5 h-3.5" />
                        ) : (
                          <EyeOff className="w-3.5 h-3.5" />
                        ),
                        hidden: !canStaffArchiveHide,
                        onClick: () =>
                          handleStaffRequestLifecycle(r, r.isHiddenByStaff ? "UNHIDE" : "HIDE"),
                      },
                      {
                        id: "reject",
                        label: "رفض الطلب",
                        icon: <XCircle className="w-3.5 h-3.5" />,
                        tone: "danger",
                        dividerBefore: true,
                        hidden: isLockedTerminal || r.status === "COMPLETED",
                        confirmTitle: `رفض الطلب (${r.requestNumber})`,
                        confirmMessage: "هل تريد رفض هذا الطلب نهائياً؟",
                        onClick: () => handleRequestAction(r, "REJECT"),
                      },
                      {
                        id: "cancel",
                        label: "إلغاء الطلب",
                        icon: <XCircle className="w-3.5 h-3.5" />,
                        tone: "danger",
                        hidden: isLockedTerminal || r.status === "COMPLETED",
                        confirmTitle: `إلغاء الطلب (${r.requestNumber})`,
                        confirmMessage: "هل تريد إلغاء هذا الطلب؟",
                        onClick: () => handleRequestAction(r, "CANCEL"),
                      },
                      {
                        id: "delete-staff-safe",
                        label: "حذف نهائي (لغير المرحّل/الملغى فقط)",
                        icon: <Trash2 className="w-3.5 h-3.5" />,
                        tone: "danger",
                        hidden: !canStaffSafeDelete,
                        confirmTitle: `حذف الطلب (${r.requestNumber})`,
                        confirmMessage: "سيتم حذف الطلب غير المرحّل دون التأثير على أي قيود محاسبية. هل تريد المتابعة؟",
                        onClick: () => handleStaffRequestLifecycle(r, "DELETE"),
                      },
                    ]}
                  />
                </div>
              </div>

              {/* Staff Before/After Diff & Client Response Feedback */}
              {(r.clientResponseNote || (r.amendmentDiff && r.amendmentDiff.length > 0)) && (
                <div className="p-3 rounded-xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 space-y-1.5 text-[11px]">
                  {r.reviewerRemarks && (
                    <div>
                      <strong>ملاحظات المراجع:</strong> {r.reviewerRemarks}
                    </div>
                  )}
                  {r.clientResponseNote && (
                    <div className="font-bold text-indigo-800 dark:text-indigo-200">
                      رد العميل ({r.clientResponseStatus === "CLIENT_APPROVED" ? "موافق" : "رد / ملاحظة"}):{" "}
                      {r.clientResponseNote}
                    </div>
                  )}
                  {r.amendmentDiff && r.amendmentDiff.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 pt-1">
                      {r.amendmentDiff.map((d, idx) => (
                        <div
                          key={`${d.field}-${idx}`}
                          className="px-2 py-1 rounded bg-white/80 dark:bg-slate-900/70 border border-amber-200/70"
                        >
                          <span className="font-bold">{d.labelAr}: </span>
                          <span className="line-through text-rose-600 mx-1">{d.before}</span>
                          <span>←</span>
                          <strong className="text-emerald-700 dark:text-emerald-300 mx-1">{d.after}</strong>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Pickup Location Amendment Bar */}
              {!isLockedTerminal && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px] p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/40">
                  <div>
                    <label className="block font-bold mb-1">تعديل الاستلام من:</label>
                    <select
                      value={currentPickupChoice}
                      onChange={(e) =>
                        setReqPickupLocationEdits((prev) => ({ ...prev, [r.id]: e.target.value }))
                      }
                      className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 font-bold"
                    >
                      {(formCfg?.pickupOptions || [])
                        .filter((p) => p.type !== "OTHER")
                        .map((p) => (
                          <option key={p.code} value={p.labelAr}>
                            {p.labelAr}
                          </option>
                        ))}
                      <option value="__OTHER__">أخرى / موقع مخصص</option>
                    </select>
                    {currentPickupChoice === "__OTHER__" && (
                      <input
                        type="text"
                        value={
                          reqCustomPickupEdits[r.id] !== undefined
                            ? reqCustomPickupEdits[r.id]
                            : r.pickupLocation
                        }
                        onChange={(e) =>
                          setReqCustomPickupEdits((prev) => ({ ...prev, [r.id]: e.target.value }))
                        }
                        placeholder="اكتب موقع الاستلام..."
                        className="mt-1 w-full rounded-lg border border-emerald-400 bg-white dark:bg-slate-900 px-2 py-1"
                      />
                    )}
                  </div>
                  <div>
                    <label className="block font-bold mb-1">تعديل ملاحظات الاستلام</label>
                    <input
                      type="text"
                      value={
                        reqPickupNotesEdits[r.id] !== undefined
                          ? reqPickupNotesEdits[r.id]
                          : r.pickupNotes || ""
                      }
                      onChange={(e) =>
                        setReqPickupNotesEdits((prev) => ({ ...prev, [r.id]: e.target.value }))
                      }
                      placeholder="ملاحظات التسليم..."
                      className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1"
                    />
                  </div>
                  <div>
                    <label className="block font-bold mb-1">ملاحظات المراجع للعميل (عند الإعادة)</label>
                    <input
                      type="text"
                      data-testid={`staff-reviewer-remarks-${r.id}`}
                      value={
                        reqReviewerRemarks[r.id] !== undefined
                          ? reqReviewerRemarks[r.id]
                          : r.reviewerRemarks || ""
                      }
                      onChange={(e) =>
                        setReqReviewerRemarks((prev) => ({ ...prev, [r.id]: e.target.value }))
                      }
                      placeholder="سبب التعديل أو ملاحظات للعميل..."
                      className="w-full rounded-lg border border-amber-400 bg-white dark:bg-slate-900 px-2 py-1"
                    />
                  </div>
                </div>
              )}

              {/* Line Items Editable by Staff (including title, unit/أخرى, qty, price, remove) */}
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
                      {!isLockedTerminal && <th className="p-2">حذف</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                    {liveLines.map(({ line: l, total }) => {
                      const unitVal = lineUnitEdits[l.id] || l.unitCode || "QAT_BUNCH";
                      return (
                        <tr key={l.id}>
                          <td className="p-2 font-bold">
                            {isLockedTerminal ? (
                              l.itemTitle
                            ) : (
                              <input
                                type="text"
                                value={lineTitleEdits[l.id] ?? l.itemTitle}
                                onChange={(e) =>
                                  setLineTitleEdits((prev) => ({ ...prev, [l.id]: e.target.value }))
                                }
                                placeholder="اسم الصنف..."
                                className="w-40 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-2 py-1 font-bold"
                              />
                            )}
                          </td>
                          <td className="p-2 space-y-1">
                            {isLockedTerminal ? (
                              l.displayUnitLabel
                            ) : (
                              <>
                                <select
                                  value={unitVal}
                                  onChange={(e) =>
                                    setLineUnitEdits((prev) => ({ ...prev, [l.id]: e.target.value }))
                                  }
                                  className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 font-bold"
                                >
                                  {(formCfg?.unitOptions || []).map((u) => (
                                    <option key={u.code} value={u.code}>
                                      {u.labelAr}
                                    </option>
                                  ))}
                                </select>
                                {unitVal === "OTHER" && (
                                  <input
                                    type="text"
                                    value={lineCustomUnitEdits[l.id] ?? (l.customUnitLabel || "")}
                                    onChange={(e) =>
                                      setLineCustomUnitEdits((prev) => ({
                                        ...prev,
                                        [l.id]: e.target.value,
                                      }))
                                    }
                                    placeholder="اخرى: ..."
                                    className="w-24 rounded-lg border border-emerald-400 px-2 py-0.5 bg-transparent"
                                  />
                                )}
                              </>
                            )}
                          </td>
                          <td className="p-2 font-mono">{fmtNum(l.requestedQty)}</td>
                          <td className="p-2">
                            <input
                              type="number"
                              step="any"
                              disabled={isLockedTerminal}
                              value={lineQtyEdits[l.id] ?? String(l.confirmedQty ?? l.requestedQty)}
                              onChange={(e) =>
                                setLineQtyEdits((prev) => ({ ...prev, [l.id]: e.target.value }))
                              }
                              className="w-20 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-2 py-1 font-mono"
                            />
                          </td>
                          <td className="p-2">
                            <input
                              type="number"
                              step="any"
                              disabled={isLockedTerminal}
                              value={linePriceEdits[l.id] ?? String(l.unitPrice || 0)}
                              onChange={(e) =>
                                setLinePriceEdits((prev) => ({ ...prev, [l.id]: e.target.value }))
                              }
                              className="w-24 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-2 py-1 font-mono"
                            />
                          </td>
                          <td className="p-2 font-mono font-extrabold text-emerald-700 dark:text-emerald-300">
                            {formatMoney(total)}
                          </td>
                          {!isLockedTerminal && (
                            <td className="p-2">
                              {liveLines.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setRemovedLineIds((prev) => ({ ...prev, [l.id]: true }))
                                  }
                                  className="text-rose-600 p-1 rounded hover:bg-rose-50 dark:hover:bg-rose-950/30"
                                  title="إزالة السطر"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {!isLockedTerminal && (
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
                      {r.status === "COMPLETED" ? (
                        <button
                          type="button"
                          data-testid={`staff-save-post-amend-${r.id}`}
                          onClick={() => void handleRequestAction(r, "AMEND")}
                          className="px-3.5 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-extrabold inline-flex items-center gap-1"
                        >
                          <Save className="w-3.5 h-3.5" />
                          <span>حفظ تعديل الفاتورة والمبيعات (دون تكرار)</span>
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            data-testid={`staff-save-amend-${r.id}`}
                            onClick={() => void handleRequestAction(r, "AMEND")}
                            className="px-3 py-1.5 rounded-xl border border-indigo-400 text-indigo-700 dark:text-indigo-300 font-bold inline-flex items-center gap-1"
                          >
                            <Save className="w-3.5 h-3.5" />
                            <span>حفظ التعديل</span>
                          </button>
                          <button
                            type="button"
                            data-testid={`staff-return-client-${r.id}`}
                            onClick={() => void handleRequestAction(r, "RETURN_TO_CLIENT")}
                            className="px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-extrabold inline-flex items-center gap-1"
                          >
                            <CornerUpLeft className="w-3.5 h-3.5" />
                            <span>إعادة للعميل للموافقة</span>
                          </button>
                          {(r.status === "PENDING_REVIEW" || r.status === "RETURNED_TO_CLIENT" || r.status === "CONFIRMED") && (
                            <button
                              type="button"
                              onClick={() => void handleRequestAction(r, "CONFIRM")}
                              className="px-3 py-1.5 rounded-xl bg-indigo-600 text-white font-bold inline-flex items-center gap-1"
                            >
                              <ClipboardCheck className="w-3.5 h-3.5" />
                              <span>{r.linkedSalesRecordId ? "حفظ وتحديث أمر البيع" : "اعتماد وفتح أمر بيع"}</span>
                            </button>
                          )}
                          {(r.status === "PENDING_REVIEW" || r.status === "CONFIRMED") && (
                            <button
                              type="button"
                              onClick={() => void handleRequestAction(r, "MARK_READY")}
                              className="px-3 py-1.5 rounded-xl border border-amber-500 text-amber-700 dark:text-amber-300 font-bold"
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
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        };

        return (
          <div className="space-y-3">
            {/* Client Monthly Directory Filter & Navigation Bar */}
            <div className="p-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={requestsSearchInput}
                    onChange={(e) => setRequestsSearchInput(e.target.value)}
                    placeholder="بحث برقم الطلب أو اسم العميل..."
                    className="rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 pr-8 pl-3 py-1.5"
                  />
                </div>
                <select
                  data-testid="staff-dir-client-filter"
                  value={selectedClientDir}
                  onChange={(e) => setSelectedClientDir(e.target.value)}
                  className="rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 font-bold"
                >
                  <option value="ALL">جميع العملاء ({grouped.clientOptions.length})</option>
                  {grouped.clientOptions.map((c) => (
                    <option key={c.clientKey} value={c.clientKey}>
                      {c.clientName} ({c.count})
                    </option>
                  ))}
                </select>
                <select
                  data-testid="staff-dir-month-filter"
                  value={selectedMonthDir}
                  onChange={(e) => setSelectedMonthDir(e.target.value)}
                  className="rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 font-bold"
                >
                  <option value="ALL">جميع الأشهر / السنوات</option>
                  {grouped.monthOptions.map((m) => (
                    <option key={m.monthKey} value={m.monthKey}>
                      {m.monthLabelAr} ({m.count})
                    </option>
                  ))}
                </select>
                <select
                  value={sectorFilter}
                  onChange={(e) =>
                    setSectorFilter(e.target.value as "ALL" | "HARVEST" | "COMMERCIAL")
                  }
                  className="rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 font-bold"
                >
                  <option value="ALL">كلا القطاعين</option>
                  <option value="HARVEST">القطاع الزراعي</option>
                  <option value="COMMERCIAL">القطاع التجاري</option>
                </select>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setReqViewMode("directories")}
                  className={`px-2.5 py-1.5 rounded-xl font-bold inline-flex items-center gap-1 ${reqViewMode === "directories"
                    ? "accent-bg"
                    : "border border-slate-300 dark:border-slate-700"
                    }`}
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                  <span>مجلدات العميل / الشهر</span>
                </button>
                <button
                  type="button"
                  onClick={() => setReqViewMode("flat")}
                  className={`px-2.5 py-1.5 rounded-xl font-bold ${reqViewMode === "flat"
                    ? "accent-bg"
                    : "border border-slate-300 dark:border-slate-700"
                    }`}
                >
                  قائمة مسطحة
                </button>
              </div>
            </div>

            {filteredFlatRequests.length === 0 ? (
              <div className="p-6 rounded-2xl bg-slate-50 dark:bg-slate-800/40 text-center text-slate-500 space-y-2">
                <div>لا توجد طلبات واردة من بوابة العملاء حالياً ضمن الفلتر النشط.</div>
                {hiddenRequestsCount > 0 && hideTestRecords && (
                  <button
                    type="button"
                    onClick={() => setHideTestRecords(false)}
                    className="px-3 py-1 rounded-xl border border-slate-300 dark:border-slate-700 font-bold text-[11px]"
                  >
                    عرض {hiddenRequestsCount} سجل اختباري مخفي
                  </button>
                )}
              </div>
            ) : reqViewMode === "flat" ? (
              filteredFlatRequests.map(renderStaffRequestCard)
            ) : (
              <div className="space-y-4">
                {filteredDirectories.map((clientDir) => {
                  const clientCollapsed = Boolean(collapsedDirs[`c:${clientDir.clientKey}`]);
                  return (
                    <div
                      key={clientDir.clientKey}
                      data-testid={`staff-client-directory-${clientDir.clientKey}`}
                      className="rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden bg-slate-50/40 dark:bg-slate-900/40"
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setCollapsedDirs((prev) => ({
                            ...prev,
                            [`c:${clientDir.clientKey}`]: !clientCollapsed,
                          }))
                        }
                        className="w-full p-3.5 flex flex-wrap items-center justify-between gap-2 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 text-right hover:bg-slate-50 dark:hover:bg-slate-800/60"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <FolderOpen className="w-4 h-4 text-emerald-600" />
                          <span className="font-black text-sm">{clientDir.clientName}</span>
                          {clientDir.clientPhone && (
                            <bdi dir="ltr" className="font-mono text-slate-500">
                              {clientDir.clientPhone}
                            </bdi>
                          )}
                          <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200 font-bold text-[10px]">
                            {clientDir.totalRequests} طلب • {clientDir.openRequests} مفتوح
                          </span>
                        </div>
                        <span className="font-bold text-emerald-700 dark:text-emerald-300">
                          {formatMoney(clientDir.totalAmount)} • {clientCollapsed ? "فتح المجلد" : "طي"}
                        </span>
                      </button>

                      {!clientCollapsed && (
                        <div className="p-3 space-y-3">
                          {clientDir.months.map((monthDir) => {
                            const monthFolderKey = `m:${clientDir.clientKey}:${monthDir.monthKey}`;
                            const monthCollapsed = Boolean(collapsedDirs[monthFolderKey]);
                            return (
                              <div
                                key={monthFolderKey}
                                data-testid={`staff-month-folder-${clientDir.clientKey}-${monthDir.monthKey}`}
                                className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/80 overflow-hidden"
                              >
                                <button
                                  type="button"
                                  onClick={() =>
                                    setCollapsedDirs((prev) => ({
                                      ...prev,
                                      [monthFolderKey]: !monthCollapsed,
                                    }))
                                  }
                                  className="w-full px-3 py-2 flex flex-wrap items-center justify-between gap-2 bg-slate-100/80 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-700 font-extrabold text-[11px]"
                                >
                                  <span className="inline-flex items-center gap-1.5">
                                    <FolderOpen className="w-3.5 h-3.5 text-indigo-600" />
                                    <span>مجلد الشهر: {monthDir.monthLabelAr}</span>
                                    <span className="px-2 py-0.5 rounded-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono text-[10px]">
                                      {monthDir.requests.length}
                                    </span>
                                  </span>
                                  <span className="text-slate-500">
                                    {formatMoney(monthDir.totalAmount)} • {monthCollapsed ? "عرض الطلبات" : "إخفاء"}
                                  </span>
                                </button>
                                {!monthCollapsed && (
                                  <div className="p-2.5 space-y-2.5">
                                    {monthDir.requests.map(renderStaffRequestCard)}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {requestsPagination.totalPages > 1 && (
              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                <span className="text-[11px] text-slate-500">
                  صفحة {requestsPagination.page} من {requestsPagination.totalPages} (إجمالي {requestsPagination.total} طلب)
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={requestsPagination.page <= 1}
                    onClick={() => setRequestsPage((p) => Math.max(1, p - 1))}
                    className="px-3 py-1 rounded-lg border border-slate-300 dark:border-slate-700 font-bold disabled:opacity-40"
                  >
                    السابق
                  </button>
                  <button
                    type="button"
                    disabled={!requestsPagination.hasMore}
                    onClick={() => setRequestsPage((p) => p + 1)}
                    className="px-3 py-1 rounded-lg border border-slate-300 dark:border-slate-700 font-bold disabled:opacity-40"
                  >
                    التالي
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* SECTION 2: NEW CLIENT REGISTRATIONS */}
      {section === "registrations" && (
        <div className="space-y-3">
          <div className="p-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 flex flex-wrap items-center justify-between gap-2">
            <div className="relative flex-1 min-w-[220px] max-w-md">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={clientsSearchInput}
                onChange={(e) => setClientsSearchInput(e.target.value)}
                placeholder="بحث باسم العميل، الجوال، البريد، أو الاسم التجاري..."
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 pr-8 pl-3 py-1.5"
              />
            </div>
            <span className="text-[11px] font-bold text-slate-500">
              إجمالي المسجلين: {clientsPagination.total} (صفحة {clientsPagination.page} من {clientsPagination.totalPages})
            </span>
          </div>

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
                      const text = `كلمة المرور المؤقتة للعميل ${resetResultBanner.clientName}: ${resetResultBanner.temporaryPassword}${resetResultBanner.resetCode ? ` | رمز الاستعادة: ${resetResultBanner.resetCode}` : ""
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

          {visibleClients.length === 0 ? (
            <div className="p-6 rounded-2xl bg-slate-50 dark:bg-slate-800/40 text-center text-slate-500">
              لا توجد طلبات تسجيل عملاء عبر البوابة حالياً.
            </div>
          ) : (
            visibleClients.map((c) => (
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
                        className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold ${c.status === "ACTIVE"
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
                      <ActionOverflowMenu
                        size="sm"
                        align="end"
                        items={[
                          {
                            id: "reject-client",
                            label: "رفض طلب التسجيل",
                            icon: <XCircle className="w-3.5 h-3.5" />,
                            tone: "danger",
                            confirmTitle: `رفض العميل (${c.fullName})`,
                            confirmMessage: "هل تريد رفض طلب تسجيل هذا العميل؟",
                            onClick: () => handleReviewClient(c.id, "REJECT"),
                          },
                        ]}
                      />
                    </div>
                  )}
                  {c.status === "ACTIVE" && (
                    <ActionOverflowMenu
                      size="sm"
                      align="end"
                      items={[
                        {
                          id: "suspend-client",
                          label: "تعليق الحساب مؤقتاً",
                          icon: <XCircle className="w-3.5 h-3.5" />,
                          tone: "warning",
                          confirmTitle: `تعليق حساب (${c.fullName})`,
                          confirmMessage: "لن يتمكن العميل من تسجيل الدخول حتى إعادة التفعيل.",
                          onClick: () => handleReviewClient(c.id, "SUSPEND"),
                        },
                      ]}
                    />
                  )}
                </div>
              </div>
            ))
          )}
          {clientsPagination.totalPages > 1 && (
            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
              <span className="text-[11px] text-slate-500">
                صفحة {clientsPagination.page} من {clientsPagination.totalPages} (إجمالي {clientsPagination.total} عميل)
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={clientsPagination.page <= 1}
                  onClick={() => setClientsPage((p) => Math.max(1, p - 1))}
                  className="px-3 py-1 rounded-lg border border-slate-300 dark:border-slate-700 font-bold disabled:opacity-40"
                >
                  السابق
                </button>
                <button
                  type="button"
                  disabled={!clientsPagination.hasMore}
                  onClick={() => setClientsPage((p) => p + 1)}
                  className="px-3 py-1 rounded-lg border border-slate-300 dark:border-slate-700 font-bold disabled:opacity-40"
                >
                  التالي
                </button>
              </div>
            </div>
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

          {visibleWaDrafts.length === 0 ? (
            <div className="p-6 rounded-2xl bg-slate-50 dark:bg-slate-800/40 text-center text-slate-500">
              لا توجد رسائل في قائمة اعتماد وإرسال واتساب ضمن هذا الفلتر.
            </div>
          ) : (
            visibleWaDrafts.map((d) => {
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
                      <span className="font-mono text-slate-400 text-[10px] inline-flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        <bdi dir="ltr">{d.createdAtDisplay || formatIsoToDmyTime(d.createdAt)}</bdi>
                      </span>
                      {d.sentAt && (
                        <span className="font-mono text-emerald-600 dark:text-emerald-400 text-[10px]">
                          أُرسلت: <bdi dir="ltr">{d.sentAtDisplay || formatIsoToDmyTime(d.sentAt)}</bdi>
                        </span>
                      )}
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

              {/* Per-Sector Request Form Customization (Harvest vs Commercial) */}
              <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-3">
                <div className="font-black text-slate-800 dark:text-slate-100">
                  تخصيص نماذج القطاعات (القطاع الزراعي / القطاع التجاري)
                </div>
                {(["HARVEST", "COMMERCIAL"] as const).map((secKey) => {
                  const secLabel = secKey === "HARVEST" ? "القطاع الزراعي" : "القطاع التجاري";
                  const currentSec = formCfg.sectorForms?.[secKey] || {
                    headingAr: secKey === "HARVEST" ? "طلب بضاعة جديدة" : "طلب تجاري (جملة / تجزئة)",
                    subtitleAr: "",
                    allowUnlistedItems: true,
                    customFields: [] as Array<{
                      key: string;
                      labelAr: string;
                      required?: boolean;
                      type?: "text" | "number" | "select";
                      options?: string[];
                      placeholder?: string;
                    }>,
                  };
                  const updateSec = (patch: Partial<typeof currentSec>) =>
                    setFormCfg({
                      ...formCfg,
                      sectorForms: {
                        HARVEST: formCfg.sectorForms?.HARVEST || {
                          headingAr: "طلب بضاعة جديدة",
                          subtitleAr: "",
                          allowUnlistedItems: true,
                          customFields: [],
                        },
                        COMMERCIAL: formCfg.sectorForms?.COMMERCIAL || {
                          headingAr: "طلب تجاري (جملة / تجزئة)",
                          subtitleAr: "",
                          allowUnlistedItems: true,
                          customFields: [],
                        },
                        [secKey]: { ...currentSec, ...patch },
                      },
                    });
                  return (
                    <div
                      key={secKey}
                      className="p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/40 space-y-2"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-black text-xs">{secLabel}</span>
                        <label className="inline-flex items-center gap-1.5 text-[11px] font-bold cursor-pointer">
                          <input
                            type="checkbox"
                            checked={currentSec.allowUnlistedItems !== false}
                            onChange={(e) => updateSec({ allowUnlistedItems: e.target.checked })}
                          />
                          <span>السماح بأصناف غير مدرجة بالكتالوج</span>
                        </label>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <input
                          type="text"
                          value={currentSec.headingAr}
                          onChange={(e) => updateSec({ headingAr: e.target.value })}
                          placeholder={`عنوان نموذج ${secLabel}`}
                          className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 font-bold"
                        />
                        <input
                          type="text"
                          value={currentSec.subtitleAr}
                          onChange={(e) => updateSec({ subtitleAr: e.target.value })}
                          placeholder={`وصف مختصر لنموذج ${secLabel}`}
                          className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-bold text-slate-500">
                            الحقول المخصصة ({currentSec.customFields.length})
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              updateSec({
                                customFields: [
                                  ...currentSec.customFields,
                                  {
                                    key: `field_${Date.now().toString(36)}`,
                                    labelAr: "حقل إضافي",
                                    type: "text",
                                    required: false,
                                  },
                                ],
                              })
                            }
                            className="px-2 py-0.5 rounded-lg border border-emerald-400 text-emerald-700 dark:text-emerald-300 text-[11px] font-bold"
                          >
                            + إضافة حقل لـ {secLabel}
                          </button>
                        </div>
                        {currentSec.customFields.map((cf, cfIdx) => (
                          <div key={cf.key} className="grid grid-cols-1 sm:grid-cols-4 gap-1.5 items-center">
                            <input
                              type="text"
                              value={cf.labelAr}
                              onChange={(e) => {
                                const nextFields = currentSec.customFields.map((f, i) =>
                                  i === cfIdx ? { ...f, labelAr: e.target.value } : f
                                );
                                updateSec({ customFields: nextFields });
                              }}
                              placeholder="اسم الحقل بالعربية"
                              className="sm:col-span-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-[11px] font-bold"
                            />
                            <select
                              value={cf.type || "text"}
                              onChange={(e) => {
                                const nextType: "text" | "number" | "select" =
                                  e.target.value === "number"
                                    ? "number"
                                    : e.target.value === "select"
                                      ? "select"
                                      : "text";
                                const nextFields = currentSec.customFields.map((f, i) =>
                                  i === cfIdx ? { ...f, type: nextType } : f
                                );
                                updateSec({ customFields: nextFields });
                              }}
                              className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-[11px]"
                            >
                              <option value="text">نص</option>
                              <option value="number">رقم</option>
                              <option value="select">قائمة اختيارات</option>
                            </select>
                            <div className="flex items-center justify-between gap-2">
                              <label className="inline-flex items-center gap-1 text-[10px] font-bold">
                                <input
                                  type="checkbox"
                                  checked={Boolean(cf.required)}
                                  onChange={(e) => {
                                    const nextFields = currentSec.customFields.map((f, i) =>
                                      i === cfIdx ? { ...f, required: e.target.checked } : f
                                    );
                                    updateSec({ customFields: nextFields });
                                  }}
                                />
                                <span>إلزامي</span>
                              </label>
                              <button
                                type="button"
                                onClick={() =>
                                  updateSec({
                                    customFields: currentSec.customFields.filter((_, i) => i !== cfIdx),
                                  })
                                }
                                className="text-rose-600 text-[10px] font-bold hover:underline"
                              >
                                حذف
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
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
