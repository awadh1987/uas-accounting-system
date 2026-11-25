"use client";

import { resolveCanonicalPortalPath, resolvePortalRouteSection } from "@/lib/clientPortal/portalRoutes";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import * as XLSX from "xlsx";
import {
  Archive,
  ArrowRight,
  Bell,
  Building2,
  Camera,
  Check,
  CheckCircle2,
  ClipboardList,
  Clock,
  CornerUpLeft,
  CreditCard,
  Download,
  Edit3,
  Eye,
  EyeOff,
  FileSpreadsheet,
  History,
  KeyRound,
  LogIn,
  LogOut,
  MapPin,
  Package,
  Plus,
  Printer,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
  User,
  UserPlus,
  Wallet,
  WifiOff,
  X,
  XCircle,
} from "lucide-react";
import {
  ClientPaymentsSection,
  SubmitPaymentModal,
  type ClientPaymentChannelView,
  type ClientPaymentReceiptView,
  type PaymentPaginationMeta,
} from "@/components/client-portal/ClientPaymentsSection";
import type { GlobalClientMembershipView } from "@/lib/clientPortal/globalClientService";
import { UasDateInput } from "@/components/UasDateInput";
import { ActionOverflowMenu } from "@/components/ActionOverflowMenu";
import { PhoneContactInput } from "@/components/PhoneContactInput";
import { SvgAvatar } from "@/components/SvgAvatar";
import { ThemeSwitcherControl } from "@/components/ThemeSwitcherControl";
import {
  PORTAL_THEME_STORAGE_KEY,
  applyThemeToDocument,
  readStoredThemePreset,
} from "@/lib/themeEngine";
import type { ThemeName } from "@/types/uas";
import {
  BulkItemImportModal,
  QuickRepeatBasketPanel,
} from "@/components/client-portal/BulkImportAndRepeatModal";
import { ClientCatalogPricingBoard } from "@/components/client-portal/ClientCatalogPricingBoard";
import {
  buildQuickRepeatBasket,
  type ParsedBulkRequestRow,
  type QuickRepeatBasketItem,
} from "@/lib/clientPortal/bulkRequestParser";
import { appendCatalogBoardItemLine } from "@/lib/clientPortal/orderLineBuilder";
import {
  computeClientCatalogBoardStats,
  type AmendmentDiffEntry,
  type ClientCatalogBoardItemView,
  type ClientCatalogBoardStats,
  type RequestAmendmentSnapshot,
} from "@/lib/clientPortal/portalTypes";
import { computeSaleTotals, fmtNum } from "@/lib/formulas";
import {
  appendExportSignatureSheet,
  appendExportSignatureToWorksheet,
} from "@/lib/excelExport";
import {
  buildTenantExportFilename,
  formatIsoToDmy,
  formatIsoToDmyTime,
  formatMoney,
  formatRefreshTimestamp,
  resolveExportSignature,
  setActiveClientExportActor,
} from "@/lib/uiFormatters";
import { printUasDocument } from "@/lib/print/uasDocumentPrinter";
import { exportOrShareBinaryFile, isCapacitorNative } from "@/lib/nativeBridge";
import { isInstalledClientApp } from "@/lib/runtimePlatform";
import { extractSubdomainSlugFromHost } from "@/lib/tenant/tenantSlug";
import {
  getStoredTenantId,
  getStoredTenantSlug,
  resolveApiBaseUrl,
  setStoredTenantId,
} from "@/lib/apiClient";
import type { TenantFormConfig } from "@/lib/clientPortal/portalConfig";

const CLIENT_TOKEN_STORAGE_KEY = "uas_client_portal_token_v1";

type PortalSectionTab = "catalog" | "new_request" | "requests" | "statement" | "payments" | "profile";

function resolvePortalTenantEnv(): { slug: string | null; explicitWebScope: boolean } {
  if (typeof window === "undefined") {
    return { slug: null, explicitWebScope: false };
  }
  const hostSlug = extractSubdomainSlugFromHost(window.location.host);
  if (hostSlug) {
    return { slug: hostSlug, explicitWebScope: true };
  }
  try {
    const sp = new URLSearchParams(window.location.search);
    const qSlug = (sp.get("slug") || sp.get("tenant") || "").trim().toLowerCase();
    if (qSlug && qSlug !== "default" && /^[a-z0-9-]+$/.test(qSlug)) {
      return { slug: qSlug, explicitWebScope: true };
    }
  } catch {
    // ignore URL parse error
  }
  if (!isInstalledClientApp()) {
    return { slug: null, explicitWebScope: true };
  }
  const storedSlug = getStoredTenantSlug();
  return {
    slug: storedSlug || null,
    explicitWebScope: false,
  };
}

function normalizeScopeKey(raw?: string | null): string {
  return String(raw || "default")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_");
}

function decodeClientTokenTenant(token: string): { tid: string; slug: string; cid?: string } | null {
  try {
    const dotIdx = token.indexOf(".");
    if (dotIdx <= 0) return null;
    const b64 = token.slice(0, dotIdx).replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const json = decodeURIComponent(escape(window.atob(padded)));
    const parsed = JSON.parse(json) as { tid?: string; slug?: string; cid?: string };
    return {
      tid: normalizeScopeKey(parsed.tid || parsed.slug || "default"),
      slug: String(parsed.slug || parsed.tid || "default").trim().toLowerCase(),
      cid: parsed.cid ? String(parsed.cid) : undefined,
    };
  } catch {
    return null;
  }
}

function getClientTokenStorageKey(overrideSlug?: string | null): string {
  const env = resolvePortalTenantEnv();
  const keySlug = String(overrideSlug || env.slug || "default").trim().toLowerCase();
  return `${CLIENT_TOKEN_STORAGE_KEY}::${keySlug}`;
}

interface ClientAccountView {
  id: string;
  sectorMode?: string;
  allowedSectors?: Array<"HARVEST" | "COMMERCIAL">;
  lockedSector?: "HARVEST" | "COMMERCIAL" | null;
  customerId: string | null;
  fullName: string;
  tradeName: string | null;
  phone: string;
  email: string;
  avatarUrl?: string;
  avatarColor?: string;
  avatarChar?: string;
  mustChangePassword?: boolean;
  passwordUpdatedAt?: string | null;
  clientType: string;
  customClientType: string | null;
  preferredPickup: string;
  customFields: Record<string, unknown>;
  status: "PENDING_APPROVAL" | "ACTIVE" | "REJECTED" | "SUSPENDED" | string;
  notes: string | null;
  creditLimit: number;
  createdAt: string;
}

interface ClientStatementSummaryView {
  creditLimit: number;
  totalInvoiced: number;
  totalPaid: number;
  totalUnpaid: number;
  creditAvailable: number | null;
  creditUtilizationPct?: number;
  openBillsCount?: number;
  paidBillsCount?: number;
  currency: string;
}

interface ClientReceiptView {
  id: string;
  voucherNumber: string;
  date: string;
  amount: number;
  currency: string;
  paymentMethod: string;
  appliedInvoiceId?: string | null;
  appliedInvoiceNumber?: string | null;
  applicationSummary?: string;
  notes: string;
}

interface ClientNotificationView {
  id: string;
  draftNumber: string;
  eventType: string;
  eventLabelAr: string;
  status: string;
  statusLabelAr: string;
  dispatchChannel: string;
  createdAt: string;
  sentAt: string | null;
  previewText: string;
}

interface CatalogItemOption {
  id: string;
  sku: string;
  nameAr: string;
  nameEn: string;
  sectorType?: string;
  grade?: string | null;
  origin?: string | null;
  unitPrice: number;
  baseUnit?: { code: string; nameAr: string; nameEn: string } | null;
  unitPrices?: Record<string, number>;
}

interface ClientRequestLineView {
  id: string;
  itemId: string | null;
  itemTitle: string;
  requestedQty: number;
  confirmedQty: number | null;
  unitCode: string;
  unitLabel: string;
  customUnitLabel: string | null;
  displayUnitLabel: string;
  unitPrice: number;
  lineTotal: number;
  catalogBoardItemId?: string | null;
  saleMode?: string;
  notes: string | null;
}

interface ClientRequestView {
  id: string;
  requestNumber: string;
  pickupPassCode?: string;
  sectorType?: string;
  submissionType?: string;
  status: string;
  statusLabelAr: string;
  pickupType: string;
  pickupLocation: string;
  pickupNotes: string | null;
  reserveStock?: boolean;
  totalEstimated: number;
  totalConfirmed: number;
  currency: string;
  linkedInvoiceId: string | null;
  linkedSaleId?: string | null;
  linkedSalesRecordId?: string | null;
  reviewerRemarks?: string | null;
  amendmentDiff?: AmendmentDiffEntry[];
  beforeSnapshot?: RequestAmendmentSnapshot | null;
  afterSnapshot?: RequestAmendmentSnapshot | null;
  revisionNumber?: number;
  returnedToClientAt?: string | null;
  returnEditPermissions?: {
    price: boolean;
    quantity: boolean;
    unit: boolean;
    pickupLocation: boolean;
    pickupNotes: boolean;
    lines: boolean;
  };
  returnedToClientAtDisplay?: string | null;
  returnedByName?: string | null;
  clientResponseStatus?: string | null;
  clientResponseStatusLabelAr?: string | null;
  clientResponseNote?: string | null;
  clientRespondedAt?: string | null;
  clientRespondedAtDisplay?: string | null;
  isArchivedByClient?: boolean;
  isHiddenByClient?: boolean;
  createdAt: string;
  createdAtDisplay?: string;
  updatedAt?: string;
  updatedAtDisplay?: string;
  approvedAt?: string | null;
  approvedAtDisplay?: string | null;
  handedOverAt?: string | null;
  handedOverAtDisplay?: string | null;
  canClientCancel?: boolean;
  canArchiveOrHide?: boolean;
  canSafelyDelete?: boolean;
  lines: ClientRequestLineView[];
}

interface ClientBillView {
  id: string;
  invoiceNumber: string;
  date: string;
  dueDate: string | null;
  currency: string;
  totalAmount: number;
  paidAmount: number;
  balanceDue: number;
  billStatus: string;
  billStatusAr: string;
  notes: string;
  items: Array<{ description: string; quantity: number; unitPrice: number; totalAmount: number }>;
}

interface StatementRowView {
  id: string;
  date: string;
  reference: string;
  typeAr: string;
  description: string;
  debit: number;
  credit: number;
  runningBalance: number;
  currency: string;
}

interface DraftLineRow {
  rowKey: string;
  lineId?: string;
  catalogBoardItemId?: string | null;
  itemId: string;
  itemTitle: string;
  requestedQty: string;
  unitCode: string;
  customUnitLabel: string;
  unitPrice: string;
  saleMode?: "BULK" | "PARTIAL";
  notes: string;
}

function resolveLineDefaultUnitPrice(
  itemId: string,
  unitCode: string,
  catalog: CatalogItemOption[],
  cfg: TenantFormConfig | null
): string {
  const code = String(unitCode || "QAT_BUNCH").toUpperCase();
  const cat = catalog.find((c) => c.id === itemId);
  if (cat) {
    const byUnit = cat.unitPrices?.[code];
    if (byUnit && byUnit > 0) return String(byUnit);
    if (cat.unitPrice > 0) return String(cat.unitPrice);
  }
  const uOpt = cfg?.unitOptions.find((u) => u.code === code);
  if (uOpt?.defaultUnitPrice && uOpt.defaultUnitPrice > 0) {
    return String(uOpt.defaultUnitPrice);
  }
  return "";
}

function getClientToken(): string {
  if (typeof window === "undefined") return "";
  try {
    const env = resolvePortalTenantEnv();
    const expectedKey = normalizeScopeKey(env.slug || (env.explicitWebScope ? "default" : getStoredTenantId()));
    const scopedKey = getClientTokenStorageKey();
    const token =
      window.localStorage.getItem(scopedKey) ||
      window.localStorage.getItem(CLIENT_TOKEN_STORAGE_KEY) ||
      "";
    if (!token) return "";
    const meta = decodeClientTokenTenant(token);
    if (meta && meta.tid !== expectedKey) {
      return "";
    }
    return token;
  } catch {
    return "";
  }
}

function storeClientToken(token: string, overrideSlug?: string | null) {
  if (typeof window === "undefined") return;
  try {
    const scopedKey = getClientTokenStorageKey(overrideSlug);
    const meta = token ? decodeClientTokenTenant(token) : null;
    if (token) {
      window.localStorage.setItem(scopedKey, token);
      if (meta?.cid) {
        window.localStorage.setItem(`${scopedKey}::cid`, meta.cid);
      }
    } else {
      window.localStorage.removeItem(scopedKey);
      window.localStorage.removeItem(`${scopedKey}::cid`);
      const legacyTok = window.localStorage.getItem(CLIENT_TOKEN_STORAGE_KEY);
      if (legacyTok) {
        const env = resolvePortalTenantEnv();
        const expectedKey = normalizeScopeKey(overrideSlug || env.slug || "default");
        const legacyMeta = decodeClientTokenTenant(legacyTok);
        if (!legacyMeta || legacyMeta.tid === expectedKey) {
          window.localStorage.removeItem(CLIENT_TOKEN_STORAGE_KEY);
        }
      }
    }
  } catch {
    // Non-fatal
  }
}

function resolveClientHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...(extra || {}) };
  const token = getClientToken();
  if (token) headers["x-uas-client-token"] = token;
  const env = resolvePortalTenantEnv();
  if (env.slug) {
    headers["x-uas-tenant-id"] = env.slug;
  } else if (!env.explicitWebScope) {
    const tid = getStoredTenantId() || getStoredTenantSlug();
    if (tid && tid !== "default") headers["x-uas-tenant-id"] = tid;
  }
  return headers;
}

function apiUrl(path: string): string {
  const base = resolveApiBaseUrl().replace(/\/+$/, "");
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

function navigateToTenantPortalUrl(tenantUrl: string): void {
  if (typeof window === "undefined") return;
  const dest = new URL("/portal", tenantUrl).toString();
  window.location.href = dest;
}

export function ClientPortalApp({
  onBackHomeAction,
  initialAuthTab,
  initialPortalSection,
}: {
  onBackHomeAction?: () => void;
  initialAuthTab?: "login" | "register" | "forgot";
  initialPortalSection?: PortalSectionTab;
}) {
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [tenantNameAr, setTenantNameAr] = useState("بوابة العملاء");
  const [tenantSlug, setTenantSlug] = useState("default");
  const [brandColor, setBrandColor] = useState("#059669");
  const [portalTheme, setPortalTheme] = useState<ThemeName>(() =>
    readStoredThemePreset(PORTAL_THEME_STORAGE_KEY, "emerald")
  );
  const [logoUrl, setLogoUrl] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [formConfig, setFormConfig] = useState<TenantFormConfig | null>(null);
  const [catalogItems, setCatalogItems] = useState<CatalogItemOption[]>([]);
  const [boardItems, setBoardItems] = useState<ClientCatalogBoardItemView[]>([]);
  const [boardStats, setBoardStats] = useState<ClientCatalogBoardStats | null>(null);
  const [boardLoading, setBoardLoading] = useState(false);

  const [account, setAccount] = useState<ClientAccountView | null>(null);
  const [authTab, setAuthTab] = useState<"login" | "register" | "forgot">(() => {
    if (initialAuthTab) return initialAuthTab;
    if (typeof window !== "undefined") {
      const sp = new URLSearchParams(window.location.search);
      if (sp.get("tab") === "register") return "register";
      if (sp.get("tab") === "forgot") return "forgot";
    }
    return "login";
  });
  const [portalTab, setPortalTab] = useState<PortalSectionTab>(() => {
    if (initialPortalSection) return initialPortalSection;
    if (typeof window !== "undefined") {
      const routed = resolvePortalRouteSection(window.location.pathname);
      if (routed) return routed.tab;
      try {
        const sp = new URLSearchParams(window.location.search);
        const sec = (sp.get("section") || sp.get("portalTab") || "").trim();
        if (
          sec === "catalog" ||
          sec === "new_request" ||
          sec === "requests" ||
          sec === "statement" ||
          sec === "payments" ||
          sec === "profile"
        ) {
          return sec;
        }
      } catch {
        // ignore
      }
    }
    return "new_request";
  });
  const [guestSection, setGuestSection] = useState<"auth" | "catalog">(() => {
    if (initialPortalSection === "catalog") return "catalog";
    if (typeof window !== "undefined") {
      try {
        const sp = new URLSearchParams(window.location.search);
        const sec = (sp.get("section") || sp.get("portalTab") || "").trim();
        if (sec === "catalog") return "catalog";
      } catch {
        // ignore
      }
    }
    return "auth";
  });
  const [toast, setToast] = useState<string | null>(null);
  const [showBulkImportModal, setShowBulkImportModal] = useState(false);
  const [showQuickRepeat, setShowQuickRepeat] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [draftSavedLocalAt, setDraftSavedLocalAt] = useState<string | null>(null);
  const [amendReplyNotes, setAmendReplyNotes] = useState<Record<string, string>>({});
  const [respondingReqId, setRespondingReqId] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);

  // Login Form
  const [loginIdentifier, setLoginIdentifier] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  // Forgot Password Self-Service Flow
  const [forgotStep, setForgotStep] = useState<"request" | "confirm">("request");
  const [forgotIdentifier, setForgotIdentifier] = useState("");
  const [forgotCode, setForgotCode] = useState("");
  const [forgotNewPassword, setForgotNewPassword] = useState("");
  const [forgotConfirmPassword, setForgotConfirmPassword] = useState("");

  // Registration Form
  const [regFullName, setRegFullName] = useState("");
  const [regTradeName, setRegTradeName] = useState("");
  const [regPhone, setRegPhone] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regClientType, setRegClientType] = useState("DIRECT_CLIENT");
  const [regCustomClientType, setRegCustomClientType] = useState("");
  const [regPreferredPickup, setRegPreferredPickup] = useState("السوق");
  const [regSectorPreference, setRegSectorPreference] = useState<"" | "HARVEST_ONLY" | "COMMERCIAL_ONLY" | "BOTH">("");
  const [regCustomFields, setRegCustomFields] = useState<Record<string, string>>({});

  // Request Builder State
  const [pickupCode, setPickupCode] = useState("MARKET");
  const [customPickupText, setCustomPickupText] = useState("");
  const [pickupNotes, setPickupNotes] = useState("");
  const [reqCustomData, setReqCustomData] = useState<Record<string, string>>({});
  const [lines, setLines] = useState<DraftLineRow[]>([
    {
      rowKey: "row-1",
      itemId: "",
      itemTitle: "",
      requestedQty: "1",
      unitCode: "QAT_BUNCH",
      customUnitLabel: "",
      unitPrice: "",
      notes: "",
    },
  ]);
  const [submittingReq, setSubmittingReq] = useState(false);
  const [activeSector, setActiveSector] = useState<"HARVEST" | "COMMERCIAL">(() => {
    if (typeof window !== "undefined") {
      const routed = resolvePortalRouteSection(window.location.pathname);
      if (routed?.sector) return routed.sector;
    }
    return "HARVEST";
  });
  const [submissionType, setSubmissionType] = useState<"catalog_order" | "client_goods_registration">("catalog_order");
  const [commercialCategoryGroup, setCommercialCategoryGroup] = useState<"FOOD" | "NON_FOOD" | "FUEL" | "GENERAL_COMMERCIAL">("FOOD");
  const [editingRequestId, setEditingRequestId] = useState<string | null>(null);
  const [reqError, setReqError] = useState<string | null>(null);
  const [confirmedReceipt, setConfirmedReceipt] = useState<ClientRequestView | null>(null);

  // History & Statement State
  const [requestsList, setRequestsList] = useState<ClientRequestView[]>([]);
  const [reqFilterStatus, setReqFilterStatus] = useState("ALL");
  const [reqFilterFrom, setReqFilterFrom] = useState("");
  const [reqFilterTo, setReqFilterTo] = useState("");
  const [reqFilterQuery, setReqFilterQuery] = useState("");
  const [reqDebouncedQuery, setReqDebouncedQuery] = useState("");
  const [reqPage, setReqPage] = useState(1);
  const [reqPagination, setReqPagination] = useState<PaymentPaginationMeta>({
    page: 1,
    pageSize: 25,
    total: 0,
    totalPages: 1,
    hasMore: false,
  });
  const [reqIncludeHidden, setReqIncludeHidden] = useState(false);
  const [reqArchiveView, setReqArchiveView] = useState<"ALL" | "ACTIVE" | "ARCHIVED">("ALL");
  const [selectedReqIds, setSelectedReqIds] = useState<Record<string, boolean>>({});
  const [reqLoading, setReqLoading] = useState(false);
  const [reqRefreshedAt, setReqRefreshedAt] = useState("");

  // Multi-Tenant Workspace Switcher & Payment Gate State (Phases 21-22)
  const [memberships, setMemberships] = useState<GlobalClientMembershipView[]>([]);
  const [availableTenants, setAvailableTenants] = useState<
    Array<{ slug: string; tenantId: string; nameAr: string; nameEn: string; tenantUrl: string }>
  >([]);
  const [showWorkspaceModal, setShowWorkspaceModal] = useState(false);
  const [switchingTenantSlug, setSwitchingTenantSlug] = useState<string | null>(null);

  const [paymentChannels, setPaymentChannels] = useState<ClientPaymentChannelView[]>([]);
  const [clientPayments, setClientPayments] = useState<ClientPaymentReceiptView[]>([]);
  const [paymentsPagination, setPaymentsPagination] = useState<PaymentPaginationMeta>({
    page: 1,
    pageSize: 25,
    total: 0,
    totalPages: 1,
    hasMore: false,
  });
  const [paymentsStatusFilter, setPaymentsStatusFilter] = useState("ALL");
  const [paymentsSearch, setPaymentsSearch] = useState("");
  const [paymentsDebouncedSearch, setPaymentsDebouncedSearch] = useState("");
  const [paymentsPage, setPaymentsPage] = useState(1);
  const [paymentsLoading, setPaymentsLoading] = useState(false);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [paymentModalKey, setPaymentModalKey] = useState(0);
  const [paymentModalPreset, setPaymentModalPreset] = useState<{
    channelId?: string;
    amount?: string;
    linkedInvoiceIds?: string[];
    linkedRequestIds?: string[];
    resubmitTarget?: ClientPaymentReceiptView | null;
  }>({});

  const [stmtTab, setStmtTab] = useState<"bills" | "receipts" | "ledger" | "notifications">(() => {
    if (typeof window !== "undefined") {
      const routed = resolvePortalRouteSection(window.location.pathname);
      if (routed?.stmtTab) return routed.stmtTab;
    }
    return "bills";
  });
  const [billStatusFilter, setBillStatusFilter] = useState<"ALL" | "OPEN" | "PAID">("ALL");
  const [stmtSummary, setStmtSummary] = useState<ClientStatementSummaryView>({
    creditLimit: 0,
    totalInvoiced: 0,
    totalPaid: 0,
    totalUnpaid: 0,
    creditAvailable: null,
    creditUtilizationPct: 0,
    openBillsCount: 0,
    paidBillsCount: 0,
    currency: "YER",
  });
  const [billsList, setBillsList] = useState<ClientBillView[]>([]);
  const [receiptsList, setReceiptsList] = useState<ClientReceiptView[]>([]);
  const [notificationsList, setNotificationsList] = useState<ClientNotificationView[]>([]);
  const [statementRows, setStatementRows] = useState<StatementRowView[]>([]);
  const [stmtFrom, setStmtFrom] = useState("");
  const [stmtTo, setStmtTo] = useState("");
  const [stmtLoading, setStmtLoading] = useState(false);
  const [stmtRefreshedAt, setStmtRefreshedAt] = useState("");

  // Profile Edit State + Avatar + Password Change
  const [profName, setProfName] = useState("");
  const [profTradeName, setProfTradeName] = useState("");
  const [profEmail, setProfEmail] = useState("");
  const [profPickup, setProfPickup] = useState("");
  const [profAvatarColor, setProfAvatarColor] = useState("#059669");
  const [profSaving, setProfSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const avatarFileInputRef = useRef<HTMLInputElement | null>(null);
  const [currPassInput, setCurrPassInput] = useState("");
  const [newPassInput, setNewPassInput] = useState("");
  const [confirmPassInput, setConfirmPassInput] = useState("");
  const [changingPass, setChangingPass] = useState(false);

  useEffect(() => {
    applyThemeToDocument(portalTheme, brandColor, PORTAL_THEME_STORAGE_KEY);
    if (
      portalTheme !== "system" ||
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    ) {
      return;
    }
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyThemeToDocument("system", brandColor, PORTAL_THEME_STORAGE_KEY);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, [portalTheme, brandColor]);

  const showNotice = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast((curr) => (curr === msg ? null : curr)), 4500);
  }, []);

  const loadConfig = useCallback(async () => {
    setLoadingConfig(true);
    try {
      const res = await fetch(apiUrl("/api/client-portal/config"), {
        cache: "no-store",
        headers: resolveClientHeaders(),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          tenantNameAr?: string;
          tenantSlug?: string;
          brandColor?: string;
          effectiveLogoUrl?: string;
          contactPhone?: string;
          formConfig?: TenantFormConfig;
          boardItems?: ClientCatalogBoardItemView[];
          boardStats?: ClientCatalogBoardStats;
          items?: CatalogItemOption[];
        };
        if (data.tenantNameAr) setTenantNameAr(data.tenantNameAr);
        if (data.tenantSlug) setTenantSlug(data.tenantSlug);
        if (data.brandColor) setBrandColor(data.brandColor);
        if (data.effectiveLogoUrl) setLogoUrl(data.effectiveLogoUrl);
        if (data.contactPhone) setContactPhone(data.contactPhone);
        if (data.formConfig) {
          setFormConfig(data.formConfig);
          const firstPickup = data.formConfig.pickupOptions[0];
          if (firstPickup) {
            setPickupCode(firstPickup.code);
            setRegPreferredPickup(firstPickup.labelAr);
          }
        }
        if (Array.isArray(data.boardItems)) {
          setBoardItems(data.boardItems);
        }
        if (data.boardStats) {
          setBoardStats(data.boardStats);
        }
        if (Array.isArray(data.items)) {
          setCatalogItems(data.items);
        }
      }
    } catch {
      // keep fallback
    } finally {
      setLoadingConfig(false);
    }
  }, []);

  const refreshCatalogBoard = useCallback(async () => {
    setBoardLoading(true);
    try {
      const res = await fetch(apiUrl("/api/client-portal/catalog"), {
        cache: "no-store",
        headers: resolveClientHeaders(),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          items?: ClientCatalogBoardItemView[];
          stats?: ClientCatalogBoardStats;
        };
        if (Array.isArray(data.items)) setBoardItems(data.items);
        if (data.stats) setBoardStats(data.stats);
        showNotice("✅ تم تحديث قائمة الأسعار والأصناف المنشورة");
      }
    } finally {
      setBoardLoading(false);
    }
  }, [showNotice]);

  const syncProfile = useCallback(async (manual = false) => {
    try {
      const res = await fetch(apiUrl("/api/client-portal/me"), {
        cache: "no-store",
        credentials: "include",
        headers: resolveClientHeaders(),
      });
      if (!res.ok) {
        if (res.status === 401) {
          setAccount(null);
          storeClientToken("");
        }
        return null;
      }
      const data = (await res.json()) as {
        account?: ClientAccountView;
        summary?: typeof stmtSummary;
      };
      if (data.account) {
        setAccount(data.account);
        setProfName(data.account.fullName);
        setProfTradeName(data.account.tradeName || "");
        setProfEmail(data.account.email);
        setProfPickup(data.account.preferredPickup || "السوق");
        setProfAvatarColor(data.account.avatarColor || "#059669");
        if (data.account.mustChangePassword) {
          setPortalTab("profile");
        }
      }
      if (data.summary) setStmtSummary(data.summary);
      if (manual) showNotice("✅ تم تحديث حالة الحساب والرصيد");
      return data.account || null;
    } catch {
      return null;
    }
  }, [showNotice]);

  const loadWorkspaces = useCallback(async () => {
    try {
      const res = await fetch(apiUrl("/api/client-portal/tenants"), {
        cache: "no-store",
        credentials: "include",
        headers: resolveClientHeaders(),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          memberships?: GlobalClientMembershipView[];
          availableTenants?: Array<{
            slug: string;
            tenantId: string;
            nameAr: string;
            nameEn: string;
            tenantUrl: string;
          }>;
        };
        setMemberships(data.memberships || []);
        setAvailableTenants(data.availableTenants || []);
      }
    } catch {
      // non-fatal
    }
  }, []);

  const loadPayments = useCallback(async (manual = false) => {
    if (!account || account.status !== "ACTIVE") return;
    setPaymentsLoading(true);
    try {
      const qs = new URLSearchParams({
        status: paymentsStatusFilter,
        page: String(paymentsPage),
        pageSize: "25",
      });
      if (paymentsDebouncedSearch) qs.set("search", paymentsDebouncedSearch);
      const res = await fetch(apiUrl(`/api/client-portal/payments?${qs.toString()}`), {
        cache: "no-store",
        credentials: "include",
        headers: resolveClientHeaders(),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          channels?: ClientPaymentChannelView[];
          payments?: ClientPaymentReceiptView[];
          pagination?: PaymentPaginationMeta;
        };
        setPaymentChannels(data.channels || []);
        setClientPayments(data.payments || []);
        if (data.pagination) setPaymentsPagination(data.pagination);
        if (manual) showNotice("✅ تم تحديث قنوات الدفع وسجل الإيصالات");
      }
    } finally {
      setPaymentsLoading(false);
    }
  }, [account, paymentsStatusFilter, paymentsPage, paymentsDebouncedSearch, showNotice]);

  const loadRequests = useCallback(async (manual = false) => {
    if (!account || account.status !== "ACTIVE") return;
    setReqLoading(true);
    try {
      const qs = new URLSearchParams();
      qs.set("sectorType", activeSector);
      if (reqFilterStatus !== "ALL") qs.set("status", reqFilterStatus);
      if (reqFilterFrom) qs.set("fromDate", reqFilterFrom);
      if (reqFilterTo) qs.set("toDate", reqFilterTo);
      if (reqDebouncedQuery) qs.set("search", reqDebouncedQuery);
      if (reqIncludeHidden) qs.set("includeHidden", "1");
      qs.set("page", String(reqPage));
      qs.set("pageSize", "25");
      const res = await fetch(apiUrl(`/api/client-portal/requests?${qs.toString()}`), {
        cache: "no-store",
        credentials: "include",
        headers: resolveClientHeaders(),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          requests?: ClientRequestView[];
          pagination?: PaymentPaginationMeta;
        };
        setRequestsList(data.requests || []);
        if (data.pagination) setReqPagination(data.pagination);
        setReqRefreshedAt(new Date().toISOString());
        if (manual) showNotice("✅ تم تحديث سجل الطلبات وحالاتها");
      }
    } finally {
      setReqLoading(false);
    }
  }, [account, activeSector, reqFilterStatus, reqFilterFrom, reqFilterTo, reqDebouncedQuery, reqIncludeHidden, reqPage, showNotice]);

  const loadStatement = useCallback(async (manual = false) => {
    if (!account || account.status !== "ACTIVE") return;
    setStmtLoading(true);
    try {
      const qs = new URLSearchParams();
      if (stmtFrom) qs.set("fromDate", stmtFrom);
      if (stmtTo) qs.set("toDate", stmtTo);
      const res = await fetch(apiUrl(`/api/client-portal/statement?${qs.toString()}`), {
        cache: "no-store",
        credentials: "include",
        headers: resolveClientHeaders(),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          summary?: ClientStatementSummaryView;
          bills?: ClientBillView[];
          receipts?: ClientReceiptView[];
          statementRows?: StatementRowView[];
          notifications?: ClientNotificationView[];
        };
        if (data.summary) setStmtSummary(data.summary);
        setBillsList(data.bills || []);
        setReceiptsList(data.receipts || []);
        setStatementRows(data.statementRows || []);
        setNotificationsList(data.notifications || []);
        setStmtRefreshedAt(new Date().toISOString());
        if (manual) showNotice("✅ تم تحديث الفواتير وسندات القبض وكشف الحساب");
      }
    } finally {
      setStmtLoading(false);
    }
  }, [account, stmtFrom, stmtTo, showNotice]);

  useEffect(() => {
    const t = setTimeout(() => {
      setReqDebouncedQuery(reqFilterQuery.trim());
      setReqPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [reqFilterQuery]);

  useEffect(() => {
    const t = setTimeout(() => {
      setPaymentsDebouncedSearch(paymentsSearch.trim());
      setPaymentsPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [paymentsSearch]);

  function openPaymentModal(preset?: {
    channelId?: string;
    amount?: string;
    linkedInvoiceIds?: string[];
    linkedRequestIds?: string[];
    resubmitTarget?: ClientPaymentReceiptView | null;
  }) {
    setPaymentModalPreset(preset || {});
    setPaymentModalKey((k) => k + 1);
    setPaymentModalOpen(true);
    if (paymentChannels.length === 0) {
      void loadPayments(false);
    }
  }

  async function handleSwitchTenant(targetSlug: string, joinIfMissing = false) {
    setSwitchingTenantSlug(targetSlug);
    try {
      const res = await fetch(apiUrl("/api/client-portal/switch-tenant"), {
        method: "POST",
        credentials: "include",
        headers: resolveClientHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ targetTenantSlug: targetSlug, joinIfMissing }),
      });
      const data = (await res.json()) as {
        error?: string;
        tenantSlug?: string;
        tenantId?: string;
        tenantUrl?: string;
        token?: string;
        account?: ClientAccountView;
      };
      if (!res.ok) {
        showNotice(data.error || "تعذر التبديل إلى مساحة المنشأة المختارة");
        return;
      }
      const nextSlug = data.tenantSlug || targetSlug;
      if (data.token) {
        storeClientToken(data.token, nextSlug);
      }
      setStoredTenantId(nextSlug);
      if (
        typeof window !== "undefined" &&
        !isInstalledClientApp() &&
        extractSubdomainSlugFromHost(window.location.host) &&
        data.tenantUrl
      ) {
        navigateToTenantPortalUrl(data.tenantUrl);
        return;
      }
      if (typeof window !== "undefined" && !isInstalledClientApp()) {
        const nextUrl = new URL(window.location.href);
        if (nextSlug && nextSlug !== "default") {
          nextUrl.searchParams.set("slug", nextSlug);
        } else {
          nextUrl.searchParams.delete("slug");
        }
        window.history.replaceState({}, "", nextUrl.toString());
      }
      setTenantSlug(nextSlug);
      setRequestsList([]);
      setBillsList([]);
      setReceiptsList([]);
      setClientPayments([]);
      setPaymentChannels([]);
      setConfirmedReceipt(null);
      setShowWorkspaceModal(false);
      await Promise.all([loadConfig(), syncProfile(false)]);
      showNotice(`✅ تم التبديل إلى مساحة منشأة: ${nextSlug}`);
    } catch {
      showNotice("تعذر الاتصال بالخادم أثناء تبديل المنشأة");
    } finally {
      setSwitchingTenantSlug(null);
    }
  }

  useEffect(() => {
    if (!initialAuthTab) return;
    let active = true;
    Promise.resolve().then(() => {
      if (active) setAuthTab(initialAuthTab);
    });
    return () => {
      active = false;
    };
  }, [initialAuthTab]);

  useEffect(() => {
    if (!initialPortalSection) return;
    let active = true;
    Promise.resolve().then(() => {
      if (!active) return;
      setPortalTab(initialPortalSection);
      setGuestSection(initialPortalSection === "catalog" ? "catalog" : "auth");
    });
    return () => {
      active = false;
    };
  }, [initialPortalSection]);

  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => {
      if (!active) return;
      if (typeof window !== "undefined" && !isInstalledClientApp()) {
        const env = resolvePortalTenantEnv();
        setStoredTenantId(env.slug || "default");
      }
      void loadConfig();
      void syncProfile(false);
    });
    return () => {
      active = false;
    };
  }, [loadConfig, syncProfile]);

  // Sync browser URL continuously on HTTP/HTTPS origins (skip Capacitor/WebView/standalone shells)
  useEffect(() => {
    if (
      typeof window === "undefined" ||
      !/^https?:$/i.test(window.location.protocol) ||
      isInstalledClientApp()
    ) {
      return;
    }
    if (account?.status === "ACTIVE") {
      const targetPath = resolveCanonicalPortalPath({
        portalTab,
        activeSector,
        stmtTab,
      });
      const currentClean = window.location.pathname.replace(/\/+$/, "") || "/";
      const targetClean = targetPath.replace(/\/+$/, "") || "/";
      if (currentClean !== targetClean) {
        try {
          const sp = new URLSearchParams(window.location.search);
          const nextSearch = sp.toString() ? `?${sp.toString()}` : "";
          window.history.replaceState(null, "", `${targetPath}${nextSearch}`);
        } catch {
          // ignore history errors
        }
      }
    }
  }, [account?.status, portalTab, activeSector, stmtTab]);

  useEffect(() => {
    if (account?.status !== "ACTIVE" || portalTab !== "requests") return;
    let active = true;
    Promise.resolve().then(() => {
      if (active) void loadRequests(false);
    });
    return () => {
      active = false;
    };
  }, [account, portalTab, loadRequests]);

  useEffect(() => {
    if (account?.status !== "ACTIVE" || portalTab !== "statement") return;
    let active = true;
    Promise.resolve().then(() => {
      if (active) void loadStatement(false);
    });
    return () => {
      active = false;
    };
  }, [account, portalTab, loadStatement]);

  useEffect(() => {
    if (account?.status !== "ACTIVE" || portalTab !== "payments") return;
    let active = true;
    Promise.resolve().then(() => {
      if (active) void loadPayments(false);
    });
    return () => {
      active = false;
    };
  }, [account, portalTab, loadPayments]);

  // Pre-load workspaces, recent requests/bills & payment channels on login
  useEffect(() => {
    if (!account) return;
    let active = true;
    Promise.resolve().then(() => {
      if (!active) return;
      void loadWorkspaces();
      if (account.status === "ACTIVE") {
        if (requestsList.length === 0) void loadRequests(false);
        if (billsList.length === 0) void loadStatement(false);
        if (paymentChannels.length === 0) void loadPayments(false);
      }
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account?.id, account?.status]);

  // Network offline/online awareness for mobile / low-connectivity draft resilience
  useEffect(() => {
    if (typeof window === "undefined") return;
    const syncOnline = () => setIsOffline(!window.navigator.onLine);
    syncOnline();
    window.addEventListener("online", syncOnline);
    window.addEventListener("offline", syncOnline);
    return () => {
      window.removeEventListener("online", syncOnline);
      window.removeEventListener("offline", syncOnline);
    };
  }, []);

  const draftStorageKey = account
    ? `uas_portal_order_draft_v1_${tenantSlug}_${account.id}_${activeSector}`
    : null;

  // Return-to-client edit permissions: lock fields the reviewer disallowed (server enforces the same rules with HTTP 403).
  const editLocks = useMemo(() => {
    const none = { price: false, quantity: false, unit: false, pickupLocation: false, pickupNotes: false, lines: false };
    if (!editingRequestId) return none;
    const target = requestsList.find((x) => x.id === editingRequestId);
    const perms = target?.status === "RETURNED_TO_CLIENT" ? target.returnEditPermissions : undefined;
    if (!perms) return none;
    return {
      price: perms.price === false,
      quantity: perms.quantity === false,
      unit: perms.unit === false,
      pickupLocation: perms.pickupLocation === false,
      pickupNotes: perms.pickupNotes === false,
      lines: perms.lines === false,
    };
  }, [editingRequestId, requestsList]);

  const allowedSectors = account?.allowedSectors && account.allowedSectors.length > 0
    ? account.allowedSectors
    : (["HARVEST", "COMMERCIAL"] as Array<"HARVEST" | "COMMERCIAL">);
  const showSectorSwitcher = allowedSectors.length > 1;
  const sectorCatalogItems = useMemo(
    () =>
      catalogItems.filter(
        (it) => (it.sectorType || "HARVEST").toUpperCase() === activeSector
      ),
    [catalogItems, activeSector]
  );

  const switchPortalSector = useCallback(
    (nextSector: "HARVEST" | "COMMERCIAL") => {
      if (nextSector === activeSector) return;
      setActiveSector(nextSector);
      setSubmissionType("catalog_order");
      setEditingRequestId(null);
      setConfirmedReceipt(null);
      setReqError(null);
      setPickupNotes("");
      setReqCustomData({});
      setLines([
        {
          rowKey: `row-${Date.now()}`,
          itemId: "",
          itemTitle: "",
          requestedQty: "1",
          unitCode: nextSector === "COMMERCIAL" ? "OTHER" : "QAT_BUNCH",
          customUnitLabel: nextSector === "COMMERCIAL" ? "كرتون" : "",
          unitPrice: "",
          saleMode: "BULK",
          notes: "",
        },
      ]);
      setReqPage(1);
    },
    [activeSector]
  );

  // Single-sector accounts are locked directly into their allowed sector (no switcher).
  useEffect(() => {
    if (!account?.allowedSectors || account.allowedSectors.length === 0) return undefined;
    const allowed = account.allowedSectors;
    if (!allowed.includes(activeSector)) {
      let active = true;
      Promise.resolve().then(() => {
        if (active) switchPortalSector(allowed[0]);
      });
      return () => {
        active = false;
      };
    }
    return undefined;
  }, [account?.allowedSectors, activeSector, switchPortalSector]);

  // Restore saved local draft on active client session mount
  useEffect(() => {
    if (!draftStorageKey || typeof window === "undefined") return;
    let active = true;
    Promise.resolve().then(() => {
      if (!active) return;
      try {
        const raw = window.localStorage.getItem(draftStorageKey);
        if (!raw) return;
        const saved = JSON.parse(raw) as {
          pickupCode?: string;
          customPickupText?: string;
          pickupNotes?: string;
          reqCustomData?: Record<string, string>;
          lines?: DraftLineRow[];
          savedAt?: string;
        };
        if (Array.isArray(saved.lines) && saved.lines.some((l) => l.itemTitle?.trim())) {
          setLines((prev) => (prev.some((p) => p.itemTitle.trim() !== "") ? prev : saved.lines!));
          if (saved.pickupCode) setPickupCode(saved.pickupCode);
          if (saved.customPickupText !== undefined) setCustomPickupText(saved.customPickupText);
          if (saved.pickupNotes !== undefined) setPickupNotes(saved.pickupNotes);
          if (saved.reqCustomData) setReqCustomData(saved.reqCustomData);
          setDraftSavedLocalAt(saved.savedAt || new Date().toISOString());
        }
      } catch {
        /* ignore corrupt storage */
      }
    });
    return () => {
      active = false;
    };
  }, [draftStorageKey]);

  // Auto-persist active order draft locally for mobile / intermittent network safety
  useEffect(() => {
    if (!draftStorageKey || editingRequestId || typeof window === "undefined") return;
    let active = true;
    const hasMeaningfulContent =
      lines.some((l) => l.itemTitle.trim() !== "") || pickupNotes.trim() !== "";
    try {
      if (!hasMeaningfulContent) {
        window.localStorage.removeItem(draftStorageKey);
        Promise.resolve().then(() => {
          if (active) setDraftSavedLocalAt(null);
        });
      } else {
        const savedAt = new Date().toISOString();
        window.localStorage.setItem(
          draftStorageKey,
          JSON.stringify({
            pickupCode,
            customPickupText,
            pickupNotes,
            reqCustomData,
            lines,
            savedAt,
          })
        );
        Promise.resolve().then(() => {
          if (active) setDraftSavedLocalAt(savedAt);
        });
      }
    } catch {
      /* ignore quota errors */
    }
    return () => {
      active = false;
    };
  }, [draftStorageKey, editingRequestId, pickupCode, customPickupText, pickupNotes, reqCustomData, lines]);

  const quickRepeatItems = useMemo(
    () =>
      buildQuickRepeatBasket({
        requests: requestsList,
        bills: billsList,
        boardItems,
        catalogItems,
        formConfig,
      }),
    [requestsList, billsList, boardItems, catalogItems, formConfig]
  );

  const portalLetterhead = useMemo(
    () => ({
      companyNameAr: tenantNameAr,
      companyNameEn: tenantSlug.toUpperCase(),
      logoUrl,
      phone: contactPhone,
      tenantSlug,
      isCustomTenantBrand: tenantSlug !== "default",
    }),
    [tenantNameAr, tenantSlug, logoUrl, contactPhone]
  );

  const portalExportActor = useMemo(() => {
    if (!account) {
      return {
        username: "portal_guest",
        displayName: "عميل البوابة",
        titleAr: "عميل بوابة إلكترونية",
        titleEn: "Client Portal User",
        tenantSlug,
        tenantName: tenantNameAr,
      };
    }
    return {
      username: account.phone || account.email,
      displayName: account.fullName,
      titleAr: "عميل بوابة إلكترونية",
      titleEn: "Client Portal User",
      tenantSlug,
      tenantName: tenantNameAr,
    };
  }, [account, tenantSlug, tenantNameAr]);

  useEffect(() => {
    setActiveClientExportActor(portalExportActor);
    return () => {
      setActiveClientExportActor(null);
    };
  }, [portalExportActor]);

  async function handleLoginSubmit(e: React.FormEvent) {
    e.preventDefault();
    setAuthError(null);
    setAuthBusy(true);
    try {
      const res = await fetch(apiUrl("/api/client-portal/login"), {
        method: "POST",
        credentials: "include",
        headers: resolveClientHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ identifier: loginIdentifier, password: loginPassword }),
      });
      const data = (await res.json()) as { account?: ClientAccountView; token?: string; error?: string };
      if (!res.ok || !data.account) {
        setAuthError(data.error || "تعذر تسجيل الدخول");
        return;
      }
      if (data.token) storeClientToken(data.token);
      setAccount(data.account);
      setProfName(data.account.fullName);
      setProfTradeName(data.account.tradeName || "");
      setProfEmail(data.account.email);
      setProfPickup(data.account.preferredPickup || "السوق");
      setProfAvatarColor(data.account.avatarColor || "#059669");
      if (data.account.mustChangePassword) {
        setPortalTab("profile");
        showNotice("⚠️ يرجى تحديث كلمة المرور المؤقتة للمتابعة");
      } else {
        showNotice(`مرحباً ${data.account.fullName}`);
      }
    } catch {
      setAuthError("تعذر الاتصال بالخادم، يرجى المحاولة مجدداً");
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleRegisterSubmit(e: React.FormEvent) {
    e.preventDefault();
    setAuthError(null);
    setAuthBusy(true);
    try {
      const res = await fetch(apiUrl("/api/client-portal/register"), {
        method: "POST",
        credentials: "include",
        headers: resolveClientHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          fullName: regFullName,
          tradeName: regTradeName,
          phone: regPhone,
          email: regEmail,
          password: regPassword,
          clientType: regClientType,
          customClientType: regClientType === "OTHER" ? regCustomClientType : undefined,
          preferredPickup: regPreferredPickup,
          sectorPreference: regSectorPreference || undefined,
          customFields: regCustomFields,
        }),
      });
      const data = (await res.json()) as {
        account?: ClientAccountView;
        token?: string;
        message?: string;
        error?: string;
      };
      if (!res.ok || !data.account) {
        setAuthError(data.error || "تعذر إتمام التسجيل");
        return;
      }
      if (data.token) storeClientToken(data.token);
      setAccount(data.account);
      setProfName(data.account.fullName);
      setProfTradeName(data.account.tradeName || "");
      setProfEmail(data.account.email);
      setProfPickup(data.account.preferredPickup || "السوق");
      setProfAvatarColor(data.account.avatarColor || "#059669");
      showNotice(data.message || "✅ تم تسجيل حسابك بنجاح");
    } catch {
      setAuthError("تعذر الاتصال بالخادم");
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleForgotRequestSubmit(e: React.FormEvent) {
    e.preventDefault();
    setAuthError(null);
    setAuthNotice(null);
    setAuthBusy(true);
    try {
      const res = await fetch(apiUrl("/api/client-portal/forgot-password"), {
        method: "POST",
        headers: resolveClientHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          action: "REQUEST",
          identifier: forgotIdentifier.trim(),
        }),
      });
      const data = (await res.json()) as { message?: string; error?: string };
      if (!res.ok) {
        setAuthError(data.error || "تعذر معالجة طلب استعادة كلمة المرور");
        return;
      }
      setAuthNotice(
        data.message ||
        "تم تسجيل طلب استعادة كلمة المرور، يرجى إدخال رمز التحقق فور استلامه من المنشأة."
      );
      setForgotStep("confirm");
    } catch {
      setAuthError("تعذر الاتصال بالخادم، يرجى المحاولة لاحقاً");
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleForgotConfirmSubmit(e: React.FormEvent) {
    e.preventDefault();
    setAuthError(null);
    setAuthNotice(null);
    if (forgotNewPassword.trim().length < 4) {
      setAuthError("كلمة المرور الجديدة يجب أن تتكون من 4 خانات على الأقل");
      return;
    }
    if (forgotNewPassword !== forgotConfirmPassword) {
      setAuthError("تأكيد كلمة المرور الجديدة غير متطابق");
      return;
    }
    setAuthBusy(true);
    try {
      const res = await fetch(apiUrl("/api/client-portal/forgot-password"), {
        method: "POST",
        headers: resolveClientHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          action: "CONFIRM",
          identifier: forgotIdentifier.trim(),
          code: forgotCode.trim(),
          newPassword: forgotNewPassword.trim(),
        }),
      });
      const data = (await res.json()) as { message?: string; error?: string };
      if (!res.ok) {
        setAuthError(data.error || "تعذر تأكيد الرمز وتحديث كلمة المرور");
        return;
      }
      setLoginIdentifier(forgotIdentifier.trim());
      setLoginPassword("");
      setForgotCode("");
      setForgotNewPassword("");
      setForgotConfirmPassword("");
      setForgotStep("request");
      setAuthTab("login");
      setAuthNotice(data.message || "✅ تم تحديث كلمة المرور بنجاح");
      showNotice("✅ تم تحديث كلمة المرور بنجاح، يمكنك الدخول الآن");
    } catch {
      setAuthError("تعذر الاتصال بالخادم");
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const allowed = ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"];
    if (file.type && !allowed.includes(file.type.toLowerCase())) {
      showNotice("صيغة الصورة غير مدعومة (PNG / JPG / WEBP / GIF فقط)");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      showNotice("حجم الصورة الشخصية يجب أن لا يتجاوز 2 ميجابايت");
      return;
    }
    setUploadingAvatar(true);
    try {
      let res: Response;
      if (isCapacitorNative()) {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ""));
          reader.onerror = () => reject(new Error("Read error"));
          reader.readAsDataURL(file);
        });
        res = await fetch(apiUrl("/api/client-portal/me/avatar"), {
          method: "POST",
          credentials: "include",
          headers: resolveClientHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({ dataUrl }),
        });
      } else {
        const form = new FormData();
        form.append("file", file);
        res = await fetch(apiUrl("/api/client-portal/me/avatar"), {
          method: "POST",
          credentials: "include",
          headers: resolveClientHeaders(),
          body: form,
        });
      }
      const data = (await res.json()) as { account?: ClientAccountView; message?: string; error?: string };
      if (!res.ok || !data.account) {
        showNotice(data.error || "تعذر رفع الصورة الشخصية");
        return;
      }
      setAccount(data.account);
      showNotice(data.message || "✅ تم تحديث صورة الملف الشخصي");
    } catch {
      showNotice("تعذر رفع الصورة الشخصية");
    } finally {
      setUploadingAvatar(false);
    }
  }

  async function handleRemoveClientAvatar() {
    setUploadingAvatar(true);
    try {
      const res = await fetch(apiUrl("/api/client-portal/me/avatar"), {
        method: "DELETE",
        credentials: "include",
        headers: resolveClientHeaders(),
      });
      const data = (await res.json()) as { account?: ClientAccountView; message?: string; error?: string };
      if (!res.ok || !data.account) {
        showNotice(data.error || "تعذر إزالة الصورة");
        return;
      }
      setAccount(data.account);
      showNotice(data.message || "✅ تمت إزالة الصورة الشخصية");
    } finally {
      setUploadingAvatar(false);
    }
  }

  async function handleClientPasswordChange(e: React.FormEvent) {
    e.preventDefault();
    if (newPassInput.trim().length < 4) {
      showNotice("كلمة المرور الجديدة يجب أن تكون 4 خانات على الأقل");
      return;
    }
    if (newPassInput !== confirmPassInput) {
      showNotice("تأكيد كلمة المرور الجديدة غير متطابق");
      return;
    }
    setChangingPass(true);
    try {
      const res = await fetch(apiUrl("/api/client-portal/me"), {
        method: "PATCH",
        credentials: "include",
        headers: resolveClientHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          currentPassword: currPassInput,
          newPassword: newPassInput,
        }),
      });
      const data = (await res.json()) as {
        account?: ClientAccountView;
        token?: string;
        message?: string;
        error?: string;
      };
      if (!res.ok || !data.account) {
        showNotice(data.error || "تعذر تحديث كلمة المرور");
        return;
      }
      if (data.token) storeClientToken(data.token);
      setAccount(data.account);
      setCurrPassInput("");
      setNewPassInput("");
      setConfirmPassInput("");
      showNotice(data.message || "✅ تم تغيير كلمة المرور بنجاح");
    } finally {
      setChangingPass(false);
    }
  }

  function loadPickupIntoBuilder(pickupLocation: string, pickupType?: string, notes?: string | null) {
    const matchedOpt = (formConfig?.pickupOptions || []).find(
      (p) => p.labelAr === pickupLocation || (pickupType && p.type === pickupType && p.type !== "OTHER")
    );
    if (matchedOpt && matchedOpt.type !== "OTHER") {
      setPickupCode(matchedOpt.code);
      setCustomPickupText("");
    } else {
      const otherOpt = (formConfig?.pickupOptions || []).find((p) => p.type === "OTHER");
      setPickupCode(otherOpt?.code || "OTHER");
      setCustomPickupText(pickupLocation);
    }
    setPickupNotes(notes || "");
  }

  function handleQuickReorderFromRequest(req: ClientRequestView) {
    setEditingRequestId(null);
    setConfirmedReceipt(null);
    loadPickupIntoBuilder(req.pickupLocation, req.pickupType, req.pickupNotes);
    const clonedLines: DraftLineRow[] = req.lines.map((l, idx) => {
      const matchedItem = catalogItems.find(
        (c) => (l.itemId && c.id === l.itemId) || c.nameAr === l.itemTitle
      );
      const itemId = matchedItem ? matchedItem.id : l.itemId || "__CUSTOM__";
      const liveUnitPrice =
        resolveLineDefaultUnitPrice(itemId, l.unitCode, catalogItems, formConfig) ||
        (l.unitPrice > 0 ? String(l.unitPrice) : "");
      return {
        rowKey: `reorder-${Date.now()}-${idx}`,
        itemId,
        itemTitle: l.itemTitle,
        requestedQty: String(l.confirmedQty ?? l.requestedQty ?? 1),
        unitCode: l.unitCode || "QAT_BUNCH",
        customUnitLabel: l.customUnitLabel || "",
        unitPrice: liveUnitPrice,
        notes: l.notes || "",
      };
    });
    if (clonedLines.length > 0) setLines(clonedLines);
    setPortalTab("new_request");
    showNotice(`✅ تم نسخ أصناف الطلب (${req.requestNumber}) لإعادة الطلب السريع`);
  }

  function handleQuickReorderFromBill(bill: ClientBillView) {
    setEditingRequestId(null);
    setConfirmedReceipt(null);
    const clonedLines: DraftLineRow[] = (bill.items || []).map((it, idx) => {
      const rawTitle = String(it.description || "").replace(/\s*\([^)]*\)\s*$/, "").trim();
      const matchedItem = catalogItems.find((c) => c.nameAr === rawTitle || c.nameEn === rawTitle);
      return {
        rowKey: `bill-reorder-${Date.now()}-${idx}`,
        itemId: matchedItem ? matchedItem.id : "__CUSTOM__",
        itemTitle: matchedItem?.nameAr || rawTitle || it.description,
        requestedQty: String(it.quantity || 1),
        unitCode: "QAT_BUNCH",
        customUnitLabel: "",
        unitPrice: it.unitPrice > 0 ? String(it.unitPrice) : "",
        notes: `إعادة طلب من الفاتورة ${bill.invoiceNumber}`,
      };
    });
    if (clonedLines.length > 0) setLines(clonedLines);
    setPortalTab("new_request");
    showNotice(`✅ تم تحميل بنود الفاتورة (${bill.invoiceNumber}) في نموذج الطلب`);
  }

  function handleStartEditPendingRequest(req: ClientRequestView) {
    setEditingRequestId(req.id);
    setConfirmedReceipt(null);
    loadPickupIntoBuilder(req.pickupLocation, req.pickupType, req.pickupNotes);
    setLines(
      req.lines.map((l, idx) => ({
        rowKey: `edit-${Date.now()}-${idx}`,
        lineId: l.id,
        catalogBoardItemId: l.catalogBoardItemId || null,
        itemId: l.itemId || "__CUSTOM__",
        itemTitle: l.itemTitle,
        requestedQty: String(l.confirmedQty ?? l.requestedQty),
        unitCode: l.unitCode || "QAT_BUNCH",
        customUnitLabel: l.customUnitLabel || "",
        unitPrice: l.unitPrice > 0 ? String(l.unitPrice) : "",
        saleMode: l.saleMode === "PARTIAL" ? "PARTIAL" : "BULK",
        notes: l.notes || "",
      }))
    );
    setPortalTab("new_request");
    showNotice(`تعديل الطلب (${req.requestNumber}) — أي تعديل سيُرسل للموظف للاعتماد`);
  }

  async function handleLogout() {
    await fetch(apiUrl("/api/client-portal/logout"), {
      method: "POST",
      credentials: "include",
      headers: resolveClientHeaders(),
    }).catch(() => null);
    storeClientToken("");
    setAccount(null);
    setConfirmedReceipt(null);
    setMemberships([]);
    setAvailableTenants([]);
    setClientPayments([]);
    setPaymentChannels([]);
    setRequestsList([]);
    setBillsList([]);
    setReceiptsList([]);
  }

  const activePickupOpt = formConfig?.pickupOptions.find((p) => p.code === pickupCode);
  const isCustomPickupSelected =
    pickupCode === "OTHER" || activePickupOpt?.type === "OTHER";

  async function handleSubmitGoodsRequest(e: React.FormEvent) {
    e.preventDefault();
    setReqError(null);

    if (isCustomPickupSelected && !customPickupText.trim()) {
      setReqError("يرجى كتابة موقع الاستلام في حقل (استلام من - تحديد مخصص)");
      return;
    }

    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (!l.itemTitle.trim()) {
        setReqError(`يرجى اختيار أو كتابة اسم الصنف في السطر ${i + 1}`);
        return;
      }
      if (!Number(l.requestedQty) || Number(l.requestedQty) <= 0) {
        setReqError(`يرجى إدخال كمية موجبة في السطر ${i + 1}`);
        return;
      }
      if (l.unitCode === "OTHER" && !l.customUnitLabel.trim()) {
        setReqError(`يرجى كتابة الوحدة في حقل (اخرى:) للسطر ${i + 1}`);
        return;
      }
    }

    setSubmittingReq(true);
    try {
      const targetUrl = editingRequestId
        ? apiUrl(`/api/client-portal/requests/${editingRequestId}`)
        : apiUrl("/api/client-portal/requests");
      const res = await fetch(targetUrl, {
        method: editingRequestId ? "PATCH" : "POST",
        credentials: "include",
        headers: resolveClientHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          ...(editingRequestId ? { action: "EDIT" } : {}),
          sectorType: activeSector,
          submissionType,
          pickupType: activePickupOpt?.type || "MARKET",
          pickupLocation: activePickupOpt?.labelAr || "السوق",
          customPickupLocation: isCustomPickupSelected ? customPickupText.trim() : undefined,
          pickupNotes,
          customData: {
            ...reqCustomData,
            ...(activeSector === "COMMERCIAL" ? { commercialCategoryGroup } : {}),
          },
          lines: lines.map((l) => {
            const uOpt = formConfig?.unitOptions.find((u) => u.code === l.unitCode);
            const pNum = Number(l.unitPrice);
            return {
              ...(editingRequestId && l.lineId ? { id: l.lineId } : {}),
              catalogBoardItemId: l.catalogBoardItemId || null,
              itemId: l.itemId && l.itemId !== "__CUSTOM__" ? l.itemId : null,
              itemTitle: l.itemTitle.trim(),
              requestedQty: Number(l.requestedQty),
              unitCode: l.unitCode,
              unitLabel: uOpt?.labelAr || "علاقية قات",
              customUnitLabel: l.unitCode === "OTHER" ? l.customUnitLabel.trim() : null,
              unitPrice: Number.isFinite(pNum) && pNum > 0 ? pNum : undefined,
              saleMode: l.saleMode || "BULK",
              notes: l.notes.trim() || null,
            };
          }),
        }),
      });
      const data = (await res.json()) as {
        request?: ClientRequestView;
        error?: string;
      };
      if (!res.ok || !data.request) {
        setReqError(data.error || "تعذر إرسال الطلب");
        return;
      }

      const wasEditing = Boolean(editingRequestId);
      setEditingRequestId(null);
      setConfirmedReceipt(data.request);
      if (draftStorageKey && typeof window !== "undefined") {
        try {
          window.localStorage.removeItem(draftStorageKey);
        } catch {
          /* ignore */
        }
      }
      setDraftSavedLocalAt(null);
      showNotice(
        wasEditing
          ? "✅ تم تحديث الطلب — بانتظار اعتماد الموظف"
          : "✅ تم استلام طلبك وإرساله للإدارة للمراجعة"
      );
      setLines([
        {
          rowKey: `row-${Date.now()}`,
          itemId: "",
          itemTitle: "",
          requestedQty: "1",
          unitCode: "QAT_BUNCH",
          customUnitLabel: "",
          unitPrice: "",
          notes: "",
        },
      ]);
      setPickupNotes("");
      setCustomPickupText("");
      void loadRequests(false);
    } catch {
      setReqError("تعذر الاتصال بالخادم — تم حفظ مسودة طلبك محلياً بأمان ويمكنك إعادة المحاولة.");
    } finally {
      setSubmittingReq(false);
    }
  }

  function clearLocalSavedDraft() {
    setEditingRequestId(null);
    setLines([
      {
        rowKey: `row-${Date.now()}`,
        itemId: "",
        itemTitle: "",
        requestedQty: "1",
        unitCode: "QAT_BUNCH",
        customUnitLabel: "",
        unitPrice: "",
        notes: "",
      },
    ]);
    setPickupNotes("");
    setCustomPickupText("");
    if (draftStorageKey && typeof window !== "undefined") {
      try {
        window.localStorage.removeItem(draftStorageKey);
      } catch {
        /* ignore */
      }
    }
    setDraftSavedLocalAt(null);
    showNotice("تم تفريغ مسودة الطلب الحالية");
  }

  function handleAddCatalogItemToOrder(item: ClientCatalogBoardItemView, qty: number) {
    setConfirmedReceipt(null);
    setEditingRequestId(null);
    if (item.pickupLocation) {
      loadPickupIntoBuilder(item.pickupLocation, undefined, pickupNotes);
    }
    setLines((prev) => {
      const mappedInput = prev.map((x) => ({
        id: x.lineId,
        localKey: x.rowKey,
        catalogBoardItemId: x.catalogBoardItemId || null,
        itemId: x.itemId || null,
        itemTitle: x.itemTitle,
        requestedQty: Number(x.requestedQty) || 1,
        unitCode: x.unitCode,
        unitLabel: x.unitCode,
        customUnitLabel: x.customUnitLabel,
        unitPrice: Number(x.unitPrice) || 0,
        saleMode: x.saleMode,
        notes: x.notes,
      }));
      const { nextLines } = appendCatalogBoardItemLine(mappedInput, item, {
        requestedQty: qty,
      });
      return nextLines.map((nl) => {
        const prevMatch = prev.find((p) => p.rowKey === nl.localKey);
        if (prevMatch) return prevMatch;
        return {
          rowKey: nl.localKey,
          catalogBoardItemId: nl.catalogBoardItemId || item.id,
          itemId: nl.itemId || "",
          itemTitle: nl.itemTitle,
          requestedQty: String(nl.requestedQty),
          unitCode: nl.unitCode || "QAT_BUNCH",
          customUnitLabel: nl.customUnitLabel || "",
          unitPrice: nl.unitPrice > 0 ? String(nl.unitPrice) : "",
          saleMode: nl.saleMode === "PARTIAL" ? "PARTIAL" : "BULK",
          notes: nl.notes || "",
        };
      });
    });
    showNotice(`✅ تم إضافة (${item.titleAr} × ${qty}) كسطر مستقل في تسجيل طلب`);
  }

  function handleApplyBulkRows(parsedRows: ParsedBulkRequestRow[], mode: "merge" | "replace") {
    const mapped: DraftLineRow[] = parsedRows.map((r, idx) => ({
      rowKey: `bulk-${Date.now()}-${idx}`,
      itemId: r.itemId || "__CUSTOM__",
      itemTitle: r.itemTitle,
      requestedQty: String(r.requestedQty),
      unitCode: r.unitCode || "QAT_BUNCH",
      customUnitLabel: r.customUnitLabel || "",
      unitPrice: r.unitPrice > 0 ? String(r.unitPrice) : "",
      notes: r.notes || "",
    }));
    setLines((prev) => {
      if (mode === "replace") return mapped;
      const nonEmptyPrev = prev.filter((x) => x.itemTitle.trim() !== "");
      return [...nonEmptyPrev, ...mapped];
    });
    const warnRows = parsedRows.filter(
      (r) => r.needsPriceConfirmation || r.needsCustomUnitConfirmation
    ).length;
    showNotice(
      warnRows > 0
        ? `✅ تم إدراج ${mapped.length} صنفاً — يرجى مراجعة ${warnRows} سطر لتأكيد السعر أو الوحدة المخصصة`
        : `✅ تم استيراد ${mapped.length} صنفاً إلى الطلب بنجاح`
    );
  }

  function handleAddQuickRepeatOne(it: QuickRepeatBasketItem) {
    setLines((prev) => {
      const cleaned = prev.filter((x) => x.itemTitle.trim() !== "");
      return [
        ...cleaned,
        {
          rowKey: `repeat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          itemId: it.itemId || "__CUSTOM__",
          itemTitle: it.itemTitle,
          requestedQty: String(it.lastQty || 1),
          unitCode: it.unitCode || "QAT_BUNCH",
          customUnitLabel: it.customUnitLabel || "",
          unitPrice: it.unitPrice > 0 ? String(it.unitPrice) : "",
          notes: "من سلة الأصناف المتكررة",
        },
      ];
    });
    showNotice(`✅ تم إضافة (${it.itemTitle}) من سلة الأصناف المتكررة`);
  }

  function handleAddQuickRepeatAll(basket: QuickRepeatBasketItem[]) {
    if (basket.length === 0) return;
    const mapped: DraftLineRow[] = basket.map((it, idx) => ({
      rowKey: `repeat-all-${Date.now()}-${idx}`,
      itemId: it.itemId || "__CUSTOM__",
      itemTitle: it.itemTitle,
      requestedQty: String(it.lastQty || 1),
      unitCode: it.unitCode || "QAT_BUNCH",
      customUnitLabel: it.customUnitLabel || "",
      unitPrice: it.unitPrice > 0 ? String(it.unitPrice) : "",
      notes: "سلة الأصناف المتكررة",
    }));
    setLines((prev) => {
      const cleaned = prev.filter((x) => x.itemTitle.trim() !== "");
      return [...cleaned, ...mapped];
    });
    showNotice(`✅ تم تعبئة ${mapped.length} أصناف متكررة في نموذج الطلب`);
  }

  async function handleRespondToAmendment(
    reqId: string,
    decision: "APPROVE_AMENDMENTS" | "DECLINE_AMENDMENTS"
  ) {
    setRespondingReqId(reqId);
    try {
      const res = await fetch(apiUrl(`/api/client-portal/requests/${reqId}`), {
        method: "PATCH",
        credentials: "include",
        headers: resolveClientHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          action: decision,
          clientResponseNote: amendReplyNotes[reqId] || undefined,
        }),
      });
      const data = (await res.json()) as { error?: string; message?: string };
      if (!res.ok) {
        showNotice(data.error || "تعذر إرسال قرار العميل على التعديلات");
        return;
      }
      showNotice(
        data.message ||
        (decision === "APPROVE_AMENDMENTS"
          ? "✅ تم اعتماد التعديلات وتأكيد الطلب بنجاح"
          : "↩️ تم إعادة الطلب للمراجعة بناءً على ملاحظاتك")
      );
      await loadRequests(false);
    } catch {
      showNotice("تعذر الاتصال بالخادم — يرجى المحاولة مرة أخرى");
    } finally {
      setRespondingReqId(null);
    }
  }

  async function handleRequestLifecycle(
    reqId: string,
    action: "CANCEL" | "ARCHIVE" | "UNARCHIVE" | "HIDE" | "UNHIDE" | "DELETE"
  ) {
    try {
      const res = await fetch(apiUrl(`/api/client-portal/requests/${reqId}`), {
        method: "PATCH",
        credentials: "include",
        headers: resolveClientHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ action }),
      });
      const data = (await res.json()) as { error?: string; message?: string };
      if (!res.ok) {
        showNotice(data.error || "تعذر تنفيذ الإجراء على الطلب");
        return;
      }
      showNotice(data.message || "✅ تم تحديث حالة الطلب");
      void loadRequests(false);
    } catch {
      showNotice("تعذر تنفيذ العملية");
    }
  }

  async function handleBulkHideRequests(useSelectedOnly: boolean) {
    const pickedIds = useSelectedOnly
      ? Object.entries(selectedReqIds)
        .filter(([, checked]) => checked)
        .map(([id]) => id)
      : undefined;
    try {
      const res = await fetch(apiUrl("/api/client-portal/requests"), {
        method: "PATCH",
        credentials: "include",
        headers: resolveClientHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          action: "BULK_HIDE",
          ...(pickedIds && pickedIds.length > 0 ? { requestIds: pickedIds } : {}),
          includeArchived: true,
        }),
      });
      const data = (await res.json()) as { message?: string; error?: string };
      if (!res.ok) {
        showNotice(data.error || "تعذر تنفيذ الإخفاء الجماعي");
        return;
      }
      setSelectedReqIds({});
      showNotice(data.message || "✅ تم الإخفاء الجماعي بنجاح");
      void loadRequests(false);
    } catch {
      showNotice("تعذر الاتصال بالخادم أثناء الإخفاء الجماعي");
    }
  }

  async function handleCancelPendingRequest(reqId: string) {
    await handleRequestLifecycle(reqId, "CANCEL");
  }

  function handleExportStatementExcel() {
    const wb = XLSX.utils.book_new();
    wb.Workbook = { Views: [{ RTL: true }] };
    const sig = resolveExportSignature({
      actor: portalExportActor,
      tenantSlug,
      tenantName: tenantNameAr,
    });

    const billRows = billsList.map((b) => ({
      "رقم الفاتورة": b.invoiceNumber,
      "التاريخ": formatIsoToDmy(b.date),
      "الحالة": b.billStatusAr,
      "الإجمالي": b.totalAmount,
      "المدفوع": b.paidAmount,
      "المتبقي": b.balanceDue,
      "العملة": b.currency === "YER" ? "ريال (YER)" : b.currency,
    }));
    const wsBills = XLSX.utils.json_to_sheet(billRows.length > 0 ? billRows : [{ "الحالة": "لا توجد فواتير" }]);
    wsBills["!views"] = [{ rightToLeft: true }];
    appendExportSignatureToWorksheet(wsBills, Math.max(1, billRows.length), sig);
    XLSX.utils.book_append_sheet(wb, wsBills, "الفواتير");

    const stmtSheetRows = statementRows.map((r) => ({
      "التاريخ": formatIsoToDmy(r.date),
      "المرجع": r.reference,
      "النوع": r.typeAr,
      "البيان": r.description,
      "مدين (عليه)": r.debit,
      "دائن (له)": r.credit,
      "الرصيد التراكمي": r.runningBalance,
      "العملة": r.currency === "YER" ? "ريال (YER)" : r.currency,
    }));
    const wsStmt = XLSX.utils.json_to_sheet(
      stmtSheetRows.length > 0 ? stmtSheetRows : [{ "الحالة": "لا توجد حركات" }]
    );
    wsStmt["!views"] = [{ rightToLeft: true }];
    appendExportSignatureToWorksheet(wsStmt, Math.max(1, stmtSheetRows.length), sig);
    XLSX.utils.book_append_sheet(wb, wsStmt, "كشف الحساب");

    const receiptRows = receiptsList.map((rc) => ({
      "رقم السند": rc.voucherNumber,
      "التاريخ": formatIsoToDmy(rc.date),
      "الطريقة": rc.paymentMethod,
      "التوجيه / الفاتورة": rc.applicationSummary || rc.appliedInvoiceNumber || "دفعة على الحساب",
      "المبلغ": rc.amount,
      "العملة": rc.currency === "YER" ? "ريال (YER)" : rc.currency,
      "البيان": rc.notes,
    }));
    const wsReceipts = XLSX.utils.json_to_sheet(
      receiptRows.length > 0 ? receiptRows : [{ "الحالة": "لا توجد سندات قبض" }]
    );
    wsReceipts["!views"] = [{ rightToLeft: true }];
    appendExportSignatureToWorksheet(wsReceipts, Math.max(1, receiptRows.length), sig);
    XLSX.utils.book_append_sheet(wb, wsReceipts, "سندات القبض");

    appendExportSignatureSheet(wb, sig);

    const filename = buildTenantExportFilename({
      tenantSlug,
      module: "ClientStatement",
      ext: "xlsx",
    });
    const arr = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
    void exportOrShareBinaryFile({
      filename,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      data: new Uint8Array(arr),
      title: filename,
    }).then((res) => {
      if (!res.ok) XLSX.writeFile(wb, filename);
    });
    showNotice("✅ تم تصدير كشف الحساب إلى Excel");
  }

  function handleExportStatementCsv() {
    const sig = resolveExportSignature({
      actor: portalExportActor,
      tenantSlug,
      tenantName: tenantNameAr,
    });
    const csvCell = (val: unknown) => `"${String(val ?? "").replace(/"/g, '""')}"`;
    const headers = [
      "التاريخ",
      "المرجع",
      "النوع",
      "البيان",
      "مدين (ريال / YER)",
      "دائن (ريال / YER)",
      "الرصيد التراكمي",
      "العملة",
    ];
    const bodyRows = statementRows.map((r) =>
      [
        formatIsoToDmy(r.date),
        r.reference,
        r.typeAr,
        r.description,
        r.debit,
        r.credit,
        r.runningBalance,
        r.currency === "YER" ? "ريال (YER)" : r.currency,
      ]
        .map(csvCell)
        .join(",")
    );
    const sigFooter = [
      "",
      [csvCell("توقيع المُصدِر / Export Signature")].join(","),
      [csvCell("Username"), csvCell(sig.username), csvCell("Display Name"), csvCell(sig.displayName)].join(","),
      [csvCell("Title"), csvCell(`${sig.titleAr} (${sig.titleEn})`), csvCell("Workspace"), csvCell(`${sig.tenantName} (${sig.tenantSlug})`)].join(","),
      [csvCell("Exported At"), csvCell(sig.exportedAtDisplay)].join(","),
    ];
    const csvContent = "\uFEFF" + [headers.map(csvCell).join(","), ...bodyRows, ...sigFooter].join("\r\n");
    const filename = buildTenantExportFilename({
      tenantSlug,
      module: "ClientStatement",
      ext: "csv",
    });
    const bytes = new TextEncoder().encode(csvContent);
    void exportOrShareBinaryFile({
      filename,
      mimeType: "text/csv;charset=utf-8",
      data: bytes,
      title: filename,
    }).then((res) => {
      if (!res.ok && typeof window !== "undefined") {
        const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
      }
    });
    showNotice("✅ تم تصدير كشف الحساب بصيغة CSV");
  }

  function printReceiptSpec(req: ClientRequestView) {
    const orderTotal = req.totalConfirmed > 0 ? req.totalConfirmed : req.totalEstimated;
    void printUasDocument({
      titleAr: "إيصال استلام طلب عميل — تم استلام طلبك",
      titleEn: "Client Pickup Request Confirmation",
      documentNumber: req.requestNumber,
      documentDate: req.createdAt.slice(0, 10),
      currency: req.currency || "YER",
      status: req.status === "COMPLETED" ? "POSTED" : "PENDING_APPROVAL",
      format: "A4_PORTRAIT",
      letterhead: portalLetterhead,
      printedBy: account?.fullName || "بوابة العملاء",
      exportedBy: portalExportActor,
      metadata: [
        { labelAr: "العميل", labelEn: "Client", value: account?.fullName || "" },
        { labelAr: "الجوال", labelEn: "Phone", value: account?.phone || "" },
        { labelAr: "موقع الاستلام", labelEn: "Pickup", value: req.pickupLocation },
        { labelAr: "حالة الطلب", labelEn: "Status", value: req.statusLabelAr },
        { labelAr: "التاريخ والوقت", labelEn: "Date & Time", value: req.createdAtDisplay || formatIsoToDmyTime(req.createdAt) },
      ],
      tables: [
        {
          headingAr: "الأصناف المطلوبة والتسعير",
          headingEn: "Requested Items & Pricing",
          columns: [
            { key: "title", labelAr: "الصنف", labelEn: "Item" },
            { key: "qty", labelAr: "الكمية المطلوبة", labelEn: "Requested Qty", numeric: true },
            { key: "unit", labelAr: "الوحدة", labelEn: "Unit" },
            { key: "price", labelAr: "سعر الوحدة", labelEn: "Unit Price", numeric: true },
            { key: "total", labelAr: "الإجمالي (P×Q)", labelEn: "Total", numeric: true },
            { key: "notes", labelAr: "ملاحظات", labelEn: "Notes" },
          ],
          rows: req.lines.map((l) => ({
            title: l.itemTitle,
            qty: fmtNum(l.confirmedQty ?? l.requestedQty),
            unit: l.displayUnitLabel,
            price: l.unitPrice > 0 ? formatMoney(l.unitPrice, req.currency || "YER") : "يُحدد عند المراجعة",
            total: l.lineTotal > 0 ? formatMoney(l.lineTotal, req.currency || "YER") : "تقديري",
            notes: l.notes || "—",
          })),
          totalsRow: {
            title: "إجمالي الطلب",
            total: orderTotal > 0 ? formatMoney(orderTotal, req.currency || "YER") : "يُحدد عند المراجعة",
          },
        },
      ],
    });
  }

  return (
    <div dir="rtl" className="min-h-screen overflow-x-clip bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 pb-8">
      {/* Branded Portal Header */}
      <header
        className="sticky top-0 z-30 border-b border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur px-4 py-3 shadow-sm"
      >
        <div className="max-w-5xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {logoUrl ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={logoUrl}
                  alt={tenantNameAr}
                  className="w-10 h-10 rounded-xl object-contain bg-white border border-slate-200 p-0.5 shrink-0"
                />
              </>
            ) : (
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-black shrink-0"
                style={{ backgroundColor: brandColor }}
              >
                <Package className="w-5 h-5" />
              </div>
            )}
            <div className="min-w-0">
              <h1 className="text-sm sm:text-base font-black truncate">{tenantNameAr}</h1>
              <div className="text-[11px] text-slate-500 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span>بوابة العملاء الإلكترونية</span>
                {tenantSlug !== "default" && (
                  <span className="font-mono text-[10px] px-1.5 rounded bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300">
                    <bdi dir="ltr">{tenantSlug}</bdi>
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs flex-wrap">
            {account && (
              <button
                type="button"
                data-testid="portal-workspace-switcher-btn"
                onClick={() => {
                  setShowWorkspaceModal(true);
                  void loadWorkspaces();
                }}
                className="px-3 py-1.5 rounded-xl border border-emerald-400 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300 font-extrabold inline-flex items-center gap-1 hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
              >
                <Building2 className="w-3.5 h-3.5" />
                <span>منشآتي ({Math.max(1, memberships.length)})</span>
              </button>
            )}
            <ThemeSwitcherControl
              theme={portalTheme}
              lang="ar"
              compact
              testId="portal-theme-switcher"
              onChangeTheme={(next) => setPortalTheme(next)}
            />
            {account && (
              <button
                type="button"
                onClick={() => void handleLogout()}
                className="px-3 py-1.5 rounded-xl border border-rose-300 dark:border-rose-800 text-rose-600 font-bold inline-flex items-center gap-1 hover:bg-rose-50 dark:hover:bg-rose-950/30"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>خروج</span>
              </button>
            )}
            {onBackHomeAction ? (
              <button
                type="button"
                onClick={onBackHomeAction}
                className="px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 font-bold inline-flex items-center gap-1"
              >
                <ArrowRight className="w-3.5 h-3.5" />
                <span>الرئيسية</span>
              </button>
            ) : (
              <Link
                href={
                  typeof window !== "undefined" &&
                    !extractSubdomainSlugFromHost(window.location.host) &&
                    tenantSlug &&
                    tenantSlug !== "default"
                    ? `/?slug=${encodeURIComponent(tenantSlug)}`
                    : "/"
                }
                className="px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 font-bold inline-flex items-center gap-1"
              >
                <ArrowRight className="w-3.5 h-3.5" />
                <span>صفحة المنشأة</span>
              </Link>
            )}
          </div>
        </div>
      </header>

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-2xl bg-slate-900 text-white text-xs font-extrabold shadow-2xl">
          {toast}
        </div>
      )}

      <main className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        {loadingConfig ? (
          <div className="card-surface rounded-2xl p-8 text-center text-xs text-slate-500">
            جاري تحميل إعدادات بوابة المنشأة...
          </div>
        ) : !account ? (
          <div className="space-y-4">
            <div className="max-w-xl mx-auto flex rounded-xl border border-slate-200 dark:border-slate-700 p-1 bg-white dark:bg-slate-900 text-xs shadow-xs">
              <button
                type="button"
                data-testid="portal-guest-tab-auth"
                onClick={() => setGuestSection("auth")}
                className={`flex-1 py-2 rounded-lg font-black inline-flex items-center justify-center gap-1.5 transition ${guestSection === "auth" ? "accent-bg shadow-sm" : "text-slate-600 dark:text-slate-300"
                  }`}
              >
                <LogIn className="w-3.5 h-3.5" />
                <span>دخول / تسجيل العميل</span>
              </button>
              <button
                type="button"
                data-testid="portal-guest-tab-catalog"
                onClick={() => setGuestSection("catalog")}
                className={`flex-1 py-2 rounded-lg font-black inline-flex items-center justify-center gap-1.5 transition ${guestSection === "catalog" ? "accent-bg shadow-sm" : "text-slate-600 dark:text-slate-300"
                  }`}
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>الأسعار والفرز المنشورة{boardItems.length > 0 ? ` (${boardItems.length})` : ""}</span>
              </button>
            </div>

            {guestSection === "catalog" ? (
              <div className="space-y-4">
                <div className="p-3.5 rounded-2xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-bold text-emerald-900 dark:text-emerald-200">
                    يمكنك استعراض قائمة الأسعار والفرز المنشورة من {tenantNameAr}، ثم تسجيل الدخول لإرسال طلبك مباشرة.
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setGuestSection("auth");
                      setAuthTab("login");
                    }}
                    className="px-3.5 py-1.5 rounded-xl accent-bg font-black"
                  >
                    دخول لإرسال الطلب
                  </button>
                </div>
                <ClientCatalogPricingBoard
                  boardItems={boardItems}
                  boardStats={boardStats}
                  draftLines={lines}
                  loading={boardLoading}
                  onRefresh={() => void refreshCatalogBoard()}
                  onAddToOrder={(item, qty) => {
                    handleAddCatalogItemToOrder(item, qty);
                    setGuestSection("auth");
                    setAuthTab("login");
                    showNotice("✅ تم تجهيز الصنف في طلبك — سجّل الدخول لإتمام الإرسال");
                  }}
                  onGoToOrder={() => {
                    setGuestSection("auth");
                    setAuthTab("login");
                  }}
                />
              </div>
            ) : (
              <div className="max-w-xl mx-auto card-surface rounded-2xl p-5 sm:p-6 space-y-5 shadow-md">
                <div className="flex rounded-xl border border-slate-200 dark:border-slate-700 p-1 bg-slate-100 dark:bg-slate-800/60 text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      setAuthTab("login");
                      setAuthError(null);
                      setAuthNotice(null);
                    }}
                    className={`flex-1 py-2 rounded-lg font-black inline-flex items-center justify-center gap-1.5 transition ${authTab === "login" ? "accent-bg shadow-sm" : "text-slate-600 dark:text-slate-300"
                      }`}
                  >
                    <LogIn className="w-3.5 h-3.5" />
                    <span>دخول العميل</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAuthTab("register");
                      setAuthError(null);
                      setAuthNotice(null);
                    }}
                    className={`flex-1 py-2 rounded-lg font-black inline-flex items-center justify-center gap-1.5 transition ${authTab === "register" ? "accent-bg shadow-sm" : "text-slate-600 dark:text-slate-300"
                      }`}
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                    <span>تسجيل عميل جديد</span>
                  </button>
                  <button
                    type="button"
                    data-testid="portal-auth-tab-forgot"
                    onClick={() => {
                      setAuthTab("forgot");
                      setAuthError(null);
                      setAuthNotice(null);
                    }}
                    className={`flex-1 py-2 rounded-lg font-black inline-flex items-center justify-center gap-1.5 transition ${authTab === "forgot" ? "accent-bg shadow-sm" : "text-slate-600 dark:text-slate-300"
                      }`}
                  >
                    <KeyRound className="w-3.5 h-3.5" />
                    <span>نسيت كلمة المرور</span>
                  </button>
                </div>

                {authError && (
                  <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-200 text-xs font-bold">
                    {authError}
                  </div>
                )}
                {authNotice && (
                  <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-200 text-xs font-bold">
                    {authNotice}
                  </div>
                )}

                {authTab === "login" ? (
                  <form onSubmit={handleLoginSubmit} className="space-y-3.5 text-xs">
                    <div>
                      <label className="block font-bold mb-1">رقم الجوال أو البريد الإلكتروني</label>
                      <input
                        type="text"
                        required
                        value={loginIdentifier}
                        onChange={(e) => setLoginIdentifier(e.target.value)}
                        placeholder="777123456 أو client@example.com"
                        className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2.5"
                      />
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="block font-bold">كلمة المرور / رمز PIN</label>
                        <button
                          type="button"
                          data-testid="portal-forgot-password-link"
                          onClick={() => {
                            setForgotIdentifier(loginIdentifier);
                            setForgotStep("request");
                            setAuthError(null);
                            setAuthNotice(null);
                            setAuthTab("forgot");
                          }}
                          className="text-[11px] font-bold text-emerald-700 dark:text-emerald-300 hover:underline"
                        >
                          نسيت كلمة المرور؟
                        </button>
                      </div>
                      <input
                        type="password"
                        required
                        value={loginPassword}
                        onChange={(e) => setLoginPassword(e.target.value)}
                        placeholder="••••••"
                        className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2.5"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={authBusy}
                      className="w-full py-2.5 rounded-xl accent-bg font-black text-sm shadow-sm disabled:opacity-60"
                    >
                      {authBusy ? "جاري الدخول..." : "دخول إلى حساب العميل"}
                    </button>
                  </form>
                ) : authTab === "forgot" ? (
                  <div className="space-y-4 text-xs">
                    <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-100 dark:border-slate-800">
                      <button
                        type="button"
                        onClick={() => setForgotStep("request")}
                        className={`px-3 py-1 rounded-lg font-bold ${forgotStep === "request" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300" : "text-slate-500"
                          }`}
                      >
                        1. طلب رمز الاستعادة
                      </button>
                      <button
                        type="button"
                        onClick={() => setForgotStep("confirm")}
                        className={`px-3 py-1 rounded-lg font-bold ${forgotStep === "confirm" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300" : "text-slate-500"
                          }`}
                      >
                        2. إدخال الرمز وكلمة المرور الجديدة
                      </button>
                    </div>

                    {forgotStep === "request" ? (
                      <form onSubmit={handleForgotRequestSubmit} className="space-y-3">
                        <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
                          أدخل رقم الجوال أو البريد الإلكتروني المسجل في بوابة هذه المنشأة لإصدار رمز تحقق صالح لمرة واحدة (يُرسل إشعار بعد مراجعة الإدارة أو عبر البريد المهيأ).
                        </p>
                        <div>
                          <label className="block font-bold mb-1">رقم الجوال أو البريد الإلكتروني *</label>
                          <PhoneContactInput
                            testId="portal-forgot-identifier"
                            required
                            value={forgotIdentifier}
                            onChange={setForgotIdentifier}
                            placeholder="777123456 أو client@example.com"
                          />
                        </div>
                        <button
                          type="submit"
                          disabled={authBusy}
                          className="w-full py-2.5 rounded-xl accent-bg font-black text-sm shadow-sm disabled:opacity-60"
                        >
                          {authBusy ? "جاري الطلب..." : "طلب رمز استعادة كلمة المرور"}
                        </button>
                      </form>
                    ) : (
                      <form onSubmit={handleForgotConfirmSubmit} className="space-y-3">
                        <div>
                          <label className="block font-bold mb-1">رقم الجوال أو البريد الإلكتروني *</label>
                          <input
                            type="text"
                            required
                            value={forgotIdentifier}
                            onChange={(e) => setForgotIdentifier(e.target.value)}
                            placeholder="777123456 أو client@example.com"
                            className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2"
                          />
                        </div>
                        <div>
                          <label className="block font-bold mb-1">رمز التحقق ذو الـ 6 أرقام *</label>
                          <input
                            type="text"
                            required
                            dir="ltr"
                            value={forgotCode}
                            onChange={(e) => setForgotCode(e.target.value)}
                            placeholder="123456"
                            className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 font-mono text-center tracking-widest"
                          />
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                          <div>
                            <label className="block font-bold mb-1">كلمة المرور الجديدة *</label>
                            <input
                              type="password"
                              required
                              minLength={4}
                              value={forgotNewPassword}
                              onChange={(e) => setForgotNewPassword(e.target.value)}
                              placeholder="••••••"
                              className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2"
                            />
                          </div>
                          <div>
                            <label className="block font-bold mb-1">تأكيد كلمة المرور الجديدة *</label>
                            <input
                              type="password"
                              required
                              minLength={4}
                              value={forgotConfirmPassword}
                              onChange={(e) => setForgotConfirmPassword(e.target.value)}
                              placeholder="••••••"
                              className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2"
                            />
                          </div>
                        </div>
                        <button
                          type="submit"
                          disabled={authBusy}
                          className="w-full py-2.5 rounded-xl accent-bg font-black text-sm shadow-sm disabled:opacity-60"
                        >
                          {authBusy ? "جاري التحديث..." : "تأكيد الرمز وتعيين كلمة المرور الجديدة"}
                        </button>
                      </form>
                    )}
                  </div>
                ) : (
                  <form onSubmit={handleRegisterSubmit} className="space-y-3 text-xs">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block font-bold mb-1">الاسم الكامل / الاسم التجاري *</label>
                        <input
                          type="text"
                          required
                          value={regFullName}
                          onChange={(e) => setRegFullName(e.target.value)}
                          placeholder="محمد علي / محلات البركة"
                          className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2"
                        />
                      </div>
                      <div>
                        <label className="block font-bold mb-1">الاسم التجاري المختصر (اختياري)</label>
                        <input
                          type="text"
                          value={regTradeName}
                          onChange={(e) => setRegTradeName(e.target.value)}
                          placeholder="اختياري"
                          className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block font-bold mb-1">رقم الجوال * (يمني أو دولي)</label>
                        <PhoneContactInput
                          testId="portal-reg-phone"
                          required
                          value={regPhone}
                          onChange={setRegPhone}
                          onContactSelected={(c) => {
                            if (!regFullName.trim() && c.name) setRegFullName(c.name);
                          }}
                          placeholder="777123456"
                        />
                      </div>
                      <div>
                        <label className="block font-bold mb-1">البريد الإلكتروني *</label>
                        <input
                          type="email"
                          required
                          dir="ltr"
                          value={regEmail}
                          onChange={(e) => setRegEmail(e.target.value)}
                          placeholder="client@example.com"
                          className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 text-right"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block font-bold mb-1">نوع العميل *</label>
                        <select
                          value={regClientType}
                          onChange={(e) => setRegClientType(e.target.value)}
                          className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 font-bold"
                        >
                          {(formConfig?.clientTypes || []).map((ct) => (
                            <option key={ct.code} value={ct.code}>
                              {ct.labelAr}
                            </option>
                          ))}
                        </select>
                        {regClientType === "OTHER" && (
                          <input
                            type="text"
                            required
                            value={regCustomClientType}
                            onChange={(e) => setRegCustomClientType(e.target.value)}
                            placeholder="حدد نوع العميل..."
                            className="mt-1.5 w-full rounded-xl border border-emerald-400 bg-transparent px-3 py-1.5"
                          />
                        )}
                      </div>
                      <div>
                        <label className="block font-bold mb-1">موقع الاستلام المفضل</label>
                        <select
                          value={regPreferredPickup}
                          onChange={(e) => setRegPreferredPickup(e.target.value)}
                          className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 font-bold"
                        >
                          {(formConfig?.pickupOptions || [])
                            .filter((p) => p.type !== "OTHER")
                            .map((p) => (
                              <option key={p.code} value={p.labelAr}>
                                {p.labelAr}
                              </option>
                            ))}
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="block font-bold mb-1">كلمة المرور / رمز PIN (4 خانات فأكثر) *</label>
                      <input
                        type="password"
                        required
                        minLength={4}
                        value={regPassword}
                        onChange={(e) => setRegPassword(e.target.value)}
                        placeholder="••••••"
                        className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2"
                      />
                    </div>

                    {(formConfig as { allowSectorPreferenceOnRegister?: boolean; defaultSectorMode?: string } | null)?.allowSectorPreferenceOnRegister &&
                      ((formConfig as { defaultSectorMode?: string } | null)?.defaultSectorMode || "BOTH") === "BOTH" && (
                        <div>
                          <label className="block font-bold mb-1">القطاع المفضل (اختياري)</label>
                          <select
                            data-testid="portal-reg-sector-preference"
                            value={regSectorPreference}
                            onChange={(e) =>
                              setRegSectorPreference(
                                e.target.value as "" | "HARVEST_ONLY" | "COMMERCIAL_ONLY" | "BOTH"
                              )
                            }
                            className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 font-bold"
                          >
                            <option value="">حسب الإعداد الافتراضي للمنشأة</option>
                            <option value="BOTH">القطاع الزراعي + القطاع التجاري</option>
                            <option value="HARVEST_ONLY">القطاع الزراعي فقط</option>
                            <option value="COMMERCIAL_ONLY">القطاع التجاري فقط</option>
                          </select>
                        </div>
                      )}

                    {(formConfig?.customRegistrationFields || []).map((f) => (
                      <div key={f.key}>
                        <label className="block font-bold mb-1">
                          {f.labelAr} {f.required ? "*" : ""}
                        </label>
                        {f.type === "select" && Array.isArray(f.options) && f.options.length > 0 ? (
                          <select
                            required={f.required}
                            value={regCustomFields[f.key] || ""}
                            onChange={(e) =>
                              setRegCustomFields((prev) => ({ ...prev, [f.key]: e.target.value }))
                            }
                            className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 font-bold"
                          >
                            <option value="">اختر...</option>
                            {f.options.map((opt) => (
                              <option key={opt} value={opt}>
                                {opt}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type={f.type === "number" ? "number" : "text"}
                            required={f.required}
                            placeholder={f.placeholder || f.labelAr}
                            value={regCustomFields[f.key] || ""}
                            onChange={(e) =>
                              setRegCustomFields((prev) => ({ ...prev, [f.key]: e.target.value }))
                            }
                            className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2"
                          />
                        )}
                      </div>
                    ))}

                    <button
                      type="submit"
                      disabled={authBusy}
                      className="w-full py-2.5 rounded-xl accent-bg font-black text-sm shadow-sm disabled:opacity-60"
                    >
                      {authBusy ? "جاري التسجيل..." : "إرسال طلب التسجيل"}
                    </button>
                  </form>
                )}
              </div>
            )}
          </div>
        ) : account.status === "PENDING_APPROVAL" ? (
          <div className="max-w-xl mx-auto card-surface rounded-2xl p-6 text-center space-y-4">
            <div className="w-12 h-12 mx-auto rounded-2xl bg-amber-100 dark:bg-amber-950/60 text-amber-600 flex items-center justify-center">
              <Clock className="w-6 h-6" />
            </div>
            <h2 className="text-base font-black">حسابك قيد المراجعة والاعتماد</h2>
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              مرحباً <strong>{account.fullName}</strong>، تم استلام طلب التسجيل برقم الجوال{" "}
              <bdi dir="ltr" className="font-mono font-bold">{account.phone}</bdi>. ستتمكن من تقديم الطلبات ومتابعة الفواتير وكشف الحساب فور اعتماد إدارة <strong>{tenantNameAr}</strong>.
            </p>
            <button
              type="button"
              onClick={() => void syncProfile(true)}
              className="px-4 py-2 rounded-xl accent-bg text-xs font-extrabold inline-flex items-center gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>تحديث حالة الحساب</span>
            </button>
          </div>
        ) : (
          <div className="space-y-5">
            {/* Mandatory Password Update Guard Banner */}
            {account.mustChangePassword && (
              <div
                data-testid="portal-must-change-password-banner"
                className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 flex flex-wrap items-center justify-between gap-3 text-xs text-amber-900 dark:text-amber-200"
              >
                <div className="flex items-start gap-2.5">
                  <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-black">يلزم تغيير كلمة المرور المؤقتة للمتابعة</div>
                    <p className="text-[11px] leading-relaxed">
                      تمت إعادة تعيين كلمة مرور حسابك بواسطة الإدارة أو استخدام كلمة مؤقتة. يرجى تعيين كلمة مرور جديدة من تبويب الملف الشخصي قبل إرسال طلبات جديدة.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setPortalTab("profile")}
                  className="px-3.5 py-1.5 rounded-xl bg-amber-600 text-white font-extrabold shrink-0"
                >
                  تغيير كلمة المرور الآن
                </button>
              </div>
            )}

            {/* Dual Trading Sector Top Switcher (Section 1 Harvest vs Section 2 Commercial) */}
            {showSectorSwitcher && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5" data-testid="portal-sector-switcher">
              <button
                type="button"
                data-testid="portal-sector-tab-harvest"
                onClick={() => switchPortalSector("HARVEST")}
                className={`p-3.5 rounded-2xl border text-right transition flex items-center justify-between gap-2 ${activeSector === "HARVEST"
                    ? "border-emerald-500 bg-emerald-50/80 dark:bg-emerald-950/40 shadow-sm"
                    : "card-surface border-slate-200 dark:border-slate-700 hover:border-emerald-300"
                  }`}
              >
                <div>
                  <div className="font-black text-xs sm:text-sm text-slate-900 dark:text-white">
                    القطاع الزراعي
                  </div>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${activeSector === "HARVEST" ? "accent-bg" : "bg-slate-100 dark:bg-slate-800 text-slate-500"}`}>
                  {activeSector === "HARVEST" ? "نشط" : "فتح"}
                </span>
              </button>

              <button
                type="button"
                data-testid="portal-sector-tab-commercial"
                onClick={() => switchPortalSector("COMMERCIAL")}
                className={`p-3.5 rounded-2xl border text-right transition flex items-center justify-between gap-2 ${activeSector === "COMMERCIAL"
                    ? "border-amber-500 bg-amber-50/80 dark:bg-amber-950/40 shadow-sm"
                    : "card-surface border-slate-200 dark:border-slate-700 hover:border-amber-300"
                  }`}
              >
                <div>
                  <div className="font-black text-xs sm:text-sm text-slate-900 dark:text-white">
                    القطاع التجاري
                  </div>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${activeSector === "COMMERCIAL" ? "bg-amber-600 text-white" : "bg-slate-100 dark:bg-slate-800 text-slate-500"}`}>
                  {activeSector === "COMMERCIAL" ? "نشط" : "فتح"}
                </span>
              </button>
            </div>
            )}

            {/* Portal Top Summary + Sub-Tabs */}
            <div className="card-surface rounded-2xl p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <SvgAvatar
                    char={account.avatarChar || account.fullName.trim().charAt(0) || "ع"}
                    avatarUrl={account.avatarUrl}
                    color={account.avatarColor || "#059669"}
                    size={44}
                    alt={account.tradeName || account.fullName}
                  />
                  <div>
                    <div className="text-xs text-slate-500">مرحباً بك في بوابة العملاء</div>
                    <div className="text-base font-black flex items-center gap-2 flex-wrap">
                      <span>{account.tradeName || account.fullName}</span>
                      <span className="px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 text-[10px] font-extrabold">
                        حساب مفعل
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 text-xs">
                  <div className="px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800">
                    <span className="text-slate-500">الحد الائتماني: </span>
                    <strong className="tabular-nums">{formatMoney(stmtSummary.creditLimit)}</strong>
                  </div>
                  <div className="px-3 py-1.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300">
                    <span>الرصيد المستحق: </span>
                    <strong className="tabular-nums">{formatMoney(stmtSummary.totalUnpaid)}</strong>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5 pt-2 border-t border-slate-100 dark:border-slate-800 text-xs">
                {[
                  {
                    id: "catalog" as const,
                    label: (() => {
                      const cnt = boardItems.filter((item) =>
                        activeSector === "COMMERCIAL"
                          ? (item.sectorType || "HARVEST").toUpperCase() === "COMMERCIAL"
                          : (item.sectorType || "HARVEST").toUpperCase() !== "COMMERCIAL"
                      ).length;
                      return `قائمة الأسعار والأصناف${cnt > 0 ? ` (${cnt})` : ""}`;
                    })(),
                    Icon: Sparkles,
                  },
                  {
                    id: "new_request" as const,
                    label:
                      formConfig?.sectorForms?.[activeSector]?.headingAr ||
                      formConfig?.requestHeadingAr ||
                      "تسجيل طلب",
                    Icon: Plus,
                  },
                  { id: "requests" as const, label: "سجل الطلبات ومتابعة الحالة", Icon: ClipboardList },
                  { id: "statement" as const, label: "الفواتير وكشف الحساب", Icon: CreditCard },
                  { id: "payments" as const, label: "المدفوعات والإيصالات", Icon: Wallet },
                  { id: "profile" as const, label: "الملف الشخصي", Icon: User },
                ].map(({ id, label, Icon }) => (
                  <button
                    key={id}
                    type="button"
                    data-testid={`portal-nav-${id}`}
                    onClick={() => {
                      setPortalTab(id);
                      if (id === "new_request") setConfirmedReceipt(null);
                    }}
                    className={`px-3.5 py-2 rounded-xl font-extrabold inline-flex items-center gap-1.5 transition ${portalTab === id
                      ? "accent-bg shadow-sm"
                      : "border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                      }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span>{label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* TAB 0: TENANT-PUBLISHED INVENTORY, GRADING & PRICING BOARD */}
            {portalTab === "catalog" && (() => {
              const sectorBoardItems = boardItems.filter((item) => {
                const itemSec = (item.sectorType || "HARVEST").toUpperCase();
                if (activeSector === "COMMERCIAL") return itemSec === "COMMERCIAL";
                return itemSec !== "COMMERCIAL";
              });
              const displayItems =
                activeSector === "HARVEST" && sectorBoardItems.length === 0 && boardItems.every((b) => !b.sectorType)
                  ? boardItems
                  : sectorBoardItems;
              return (
                <ClientCatalogPricingBoard
                  boardItems={displayItems}
                  boardStats={computeClientCatalogBoardStats(displayItems)}
                  draftLines={lines}
                  loading={boardLoading}
                  onRefresh={() => void refreshCatalogBoard()}
                  onAddToOrder={handleAddCatalogItemToOrder}
                  onGoToOrder={() => {
                    setConfirmedReceipt(null);
                    setPortalTab("new_request");
                  }}
                />
              );
            })()}

            {/* TAB 1: NEW REQUEST / PICKUP ORDER */}
            {portalTab === "new_request" && (
              confirmedReceipt ? (
                <div className="card-surface rounded-2xl p-6 space-y-4 border-emerald-300 dark:border-emerald-800">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="w-11 h-11 rounded-2xl bg-emerald-100 dark:bg-emerald-950 text-emerald-600 flex items-center justify-center shrink-0">
                        <CheckCircle2 className="w-6 h-6" />
                      </div>
                      <div>
                        <h2 className="text-lg font-black text-emerald-700 dark:text-emerald-300">
                          تم استلام طلبك
                        </h2>
                        <p className="text-xs text-slate-500">
                          المرجع: <bdi dir="ltr" className="font-mono font-bold">{confirmedReceipt.requestNumber}</bdi> • الحالة:{" "}
                          <strong className="text-amber-600">{confirmedReceipt.statusLabelAr}</strong>
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <button
                        type="button"
                        onClick={() => printReceiptSpec(confirmedReceipt)}
                        className="px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 font-bold inline-flex items-center gap-1"
                      >
                        <Printer className="w-3.5 h-3.5" />
                        <span>طباعة / حفظ PDF</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setPortalTab("requests");
                          void loadRequests(true);
                        }}
                        className="px-3 py-1.5 rounded-xl border border-emerald-500 text-emerald-700 dark:text-emerald-300 font-bold inline-flex items-center gap-1"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span>تحديث ومتابعة الطلب</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmedReceipt(null)}
                        className="px-3.5 py-1.5 rounded-xl accent-bg font-extrabold"
                      >
                        + تسجيل طلب جديد
                      </button>
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 text-xs flex flex-wrap gap-4 justify-between items-center">
                    <div className="flex flex-wrap gap-4">
                      <div>
                        <span className="text-slate-500">موقع الاستلام: </span>
                        <strong>{confirmedReceipt.pickupLocation}</strong>
                      </div>
                      <div>
                        <span className="text-slate-500">التاريخ والوقت: </span>
                        <bdi dir="ltr" className="font-mono">
                          {confirmedReceipt.createdAtDisplay || formatIsoToDmyTime(confirmedReceipt.createdAt)}
                        </bdi>
                      </div>
                    </div>
                    <div className="font-black text-emerald-700 dark:text-emerald-300">
                      {(() => {
                        const tot =
                          confirmedReceipt.totalConfirmed > 0
                            ? confirmedReceipt.totalConfirmed
                            : confirmedReceipt.totalEstimated;
                        return tot > 0
                          ? `الإجمالي (= P × Q): ${formatMoney(tot, confirmedReceipt.currency || "YER")}`
                          : "التسعير: تقديري / يُحدد عند المراجعة";
                      })()}
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-xs text-right border-collapse">
                      <thead>
                        <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-100/70 dark:bg-slate-800/60">
                          <th className="p-2">#</th>
                          <th className="p-2">الصنف</th>
                          <th className="p-2">الكمية</th>
                          <th className="p-2">الوحدة</th>
                          <th className="p-2">سعر الوحدة</th>
                          <th className="p-2">الإجمالي (= P × Q)</th>
                          <th className="p-2">ملاحظات</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                        {confirmedReceipt.lines.map((l, idx) => (
                          <tr key={l.id}>
                            <td className="p-2">{idx + 1}</td>
                            <td className="p-2 font-bold">{l.itemTitle}</td>
                            <td className="p-2 font-mono font-bold">{fmtNum(l.requestedQty)}</td>
                            <td className="p-2">{l.displayUnitLabel}</td>
                            <td className="p-2 font-mono">
                              {l.unitPrice > 0
                                ? formatMoney(l.unitPrice, confirmedReceipt.currency || "YER")
                                : "تقديري / يُحدد عند المراجعة"}
                            </td>
                            <td className="p-2 font-mono font-bold text-emerald-700 dark:text-emerald-300">
                              {l.lineTotal > 0
                                ? formatMoney(l.lineTotal, confirmedReceipt.currency || "YER")
                                : "—"}
                            </td>
                            <td className="p-2 text-slate-500">{l.notes || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleSubmitGoodsRequest} className="card-surface rounded-2xl p-5 space-y-4 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h2 className="text-base font-black">
                        {editingRequestId
                          ? "تعديل طلب قيد المراجعة"
                          : formConfig?.sectorForms?.[activeSector]?.headingAr ||
                            formConfig?.requestHeadingAr ||
                            "تسجيل طلب"}
                      </h2>
                      <p className="text-xs text-slate-500">
                        {formConfig?.sectorForms?.[activeSector]?.subtitleAr ||
                          formConfig?.requestSubtitleAr}
                      </p>
                    </div>
                    {editingRequestId && (
                      <button
                        type="button"
                        onClick={() => setEditingRequestId(null)}
                        className="px-3 py-1 rounded-xl border border-slate-300 dark:border-slate-700 font-bold text-[11px]"
                      >
                        إلغاء التعديل (طلب جديد)
                      </button>
                    )}
                  </div>

                  {activeSector === "COMMERCIAL" && (
                    <div className="p-3 rounded-xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block font-bold mb-1">تصنيف البضائع في القطاع التجاري</label>
                        <select
                          value={commercialCategoryGroup}
                          onChange={(e) =>
                            setCommercialCategoryGroup(
                              e.target.value as "FOOD" | "NON_FOOD" | "FUEL" | "GENERAL_COMMERCIAL"
                            )
                          }
                          className="w-full rounded-xl border border-amber-300 dark:border-amber-700 bg-white dark:bg-slate-900 px-3 py-2 font-bold"
                        >
                          <option value="FOOD">مواد غذائية (جملة وتجزئة)</option>
                          <option value="NON_FOOD">بضائع استهلاكية وغير غذائية</option>
                          <option value="FUEL">محروقات ووقود وطاقة</option>
                          <option value="GENERAL_COMMERCIAL">تجارة عامة ومواد متعددة</option>
                        </select>
                      </div>
                      <div>
                        <label className="block font-bold mb-1">نوع تقديم الطلب التجاري</label>
                        <select
                          value={submissionType}
                          onChange={(e) =>
                            setSubmissionType(
                              e.target.value === "client_goods_registration"
                                ? "client_goods_registration"
                                : "catalog_order"
                            )
                          }
                          className="w-full rounded-xl border border-amber-300 dark:border-amber-700 bg-white dark:bg-slate-900 px-3 py-2 font-bold"
                        >
                          <option value="catalog_order">طلب من كتالوج الأصناف المنشورة</option>
                          <option value="client_goods_registration">تسجيل بضاعة / طلب جملة وتجزئة مخصص</option>
                        </select>
                      </div>
                    </div>
                  )}

                  {editingRequestId && (() => {
                    const editingReq = requestsList.find((x) => x.id === editingRequestId);
                    if (!editingReq || editingReq.status !== "RETURNED_TO_CLIENT") return null;
                    const p = editingReq.returnEditPermissions;
                    return (
                      <div
                        data-testid="portal-return-permissions-banner"
                        className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 space-y-1.5 text-amber-900 dark:text-amber-200"
                      >
                        <div className="font-black">
                          طلب معاد للموافقة والتعديل {editingReq.reviewerRemarks ? `— ملاحظات المراجع: ${editingReq.reviewerRemarks}` : ""}
                        </div>
                        {p && (
                          <div className="flex flex-wrap gap-1.5 text-[10px]">
                            {[
                              { ok: p.price, label: "السعر" },
                              { ok: p.quantity, label: "الكمية" },
                              { ok: p.unit, label: "الوحدة" },
                              { ok: p.pickupLocation, label: "الاستلام من:" },
                              { ok: p.pickupNotes, label: "ملاحظات الاستلام" },
                              { ok: p.lines, label: "الأصناف" },
                            ].map((tag) => (
                              <span
                                key={tag.label}
                                className={`px-2 py-0.5 rounded-full font-bold ${
                                  tag.ok
                                    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
                                    : "bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                                }`}
                              >
                                {tag.ok ? "مسموح: " : "مقفل: "}
                                {tag.label}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {reqError && (
                    <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-200 font-bold flex flex-wrap items-center justify-between gap-2">
                      <span>{reqError}</span>
                      <button
                        type="submit"
                        className="px-3 py-1 rounded-lg bg-rose-600 text-white font-extrabold text-[11px]"
                      >
                        إعادة المحاولة الآن
                      </button>
                    </div>
                  )}

                  {(isOffline || draftSavedLocalAt) && !editingRequestId && (
                    <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                      <div className="flex items-center gap-2 font-bold">
                        {isOffline && (
                          <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300">
                            <WifiOff className="w-3.5 h-3.5" />
                            <span>وضع عدم الاتصال / ضعف الشبكة: مسودتك محفوظة بأمان محلياً</span>
                          </span>
                        )}
                        {!isOffline && draftSavedLocalAt && (
                          <span className="text-emerald-700 dark:text-emerald-300">
                            ✓ تم حفظ مسودة الطلب محلياً تلقائياً ({formatRefreshTimestamp(draftSavedLocalAt)})
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={clearLocalSavedDraft}
                        className="text-slate-500 hover:text-rose-600 font-bold hover:underline"
                      >
                        تفريغ المسودة
                      </button>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block font-extrabold mb-1">استلام من:</label>
                      <select
                        value={pickupCode}
                        disabled={editLocks.pickupLocation}
                        onChange={(e) => setPickupCode(e.target.value)}
                        className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 font-bold"
                      >
                        {(formConfig?.pickupOptions || []).map((opt) => (
                          <option key={opt.code} value={opt.code}>
                            {opt.labelAr}
                          </option>
                        ))}
                      </select>
                      {isCustomPickupSelected && (
                        <input
                          type="text"
                          required
                          disabled={editLocks.pickupLocation}
                          value={customPickupText}
                          onChange={(e) => setCustomPickupText(e.target.value)}
                          placeholder="اكتب موقع الاستلام المخصص..."
                          className="mt-2 w-full rounded-xl border border-emerald-400 bg-transparent px-3 py-2 disabled:opacity-50"
                        />
                      )}
                    </div>
                    <div>
                      <label className="block font-bold mb-1">ملاحظات الاستلام / الموعد المفضل (اختياري)</label>
                      <input
                        type="text"
                        value={pickupNotes}
                        disabled={editLocks.pickupNotes}
                        onChange={(e) => setPickupNotes(e.target.value)}
                        placeholder="مثال: الاستلام الساعة 1 ظهراً"
                        className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2"
                      />
                    </div>
                  </div>

                  {(() => {
                    const mergedCustomFields = [
                      ...(formConfig?.customRequestFields || []),
                      ...(formConfig?.sectorForms?.[activeSector]?.customFields || []),
                    ].filter(
                      (cf, idx, arr) => arr.findIndex((x) => x.key === cf.key) === idx
                    );
                    if (mergedCustomFields.length === 0) return null;
                    return (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {mergedCustomFields.map((cf) => (
                          <div key={cf.key}>
                            <label className="block font-bold mb-1">
                              {cf.labelAr} {cf.required ? "*" : ""}
                            </label>
                            {cf.type === "select" && Array.isArray(cf.options) && cf.options.length > 0 ? (
                              <select
                                required={cf.required}
                                value={reqCustomData[cf.key] || ""}
                                onChange={(e) =>
                                  setReqCustomData((prev) => ({ ...prev, [cf.key]: e.target.value }))
                                }
                                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 font-bold"
                              >
                                <option value="">اختر...</option>
                                {cf.options.map((opt) => (
                                  <option key={opt} value={opt}>
                                    {opt}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <input
                                type={cf.type === "number" ? "number" : "text"}
                                required={cf.required}
                                placeholder={cf.placeholder || cf.labelAr}
                                value={reqCustomData[cf.key] || ""}
                                onChange={(e) =>
                                  setReqCustomData((prev) => ({ ...prev, [cf.key]: e.target.value }))
                                }
                                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2"
                              />
                            )}
                          </div>
                        ))}
                      </div>
                    );
                  })()}

                  {/* Multi-line Items */}
                  <div className="space-y-2.5 pt-2 border-t border-slate-200 dark:border-slate-800">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-black text-slate-700 dark:text-slate-200">
                        أصناف الطلب ({lines.length})
                      </span>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          disabled={editLocks.lines}
                          data-testid="portal-open-bulk-import-btn"
                          onClick={() => setShowBulkImportModal(true)}
                          className="px-3 py-1.5 rounded-xl border border-indigo-400 text-indigo-700 dark:text-indigo-300 font-extrabold inline-flex items-center gap-1 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <FileSpreadsheet className="w-3.5 h-3.5" />
                          <span>استيراد أصناف بالجملة</span>
                        </button>
                        <button
                          type="button"
                          disabled={editLocks.lines}
                          data-testid="portal-toggle-quick-repeat-btn"
                          onClick={() => setShowQuickRepeat((prev) => !prev)}
                          className={`px-3 py-1.5 rounded-xl border font-extrabold inline-flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed ${showQuickRepeat
                            ? "border-indigo-600 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-800 dark:text-indigo-200"
                            : "border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800"
                            }`}
                        >
                          <History className="w-3.5 h-3.5" />
                          <span>سلة الأصناف المتكررة ({quickRepeatItems.length})</span>
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setLines((prev) => [
                              ...prev,
                              {
                                rowKey: `row-${Date.now()}-${prev.length}`,
                                itemId: "",
                                itemTitle: "",
                                requestedQty: "1",
                                unitCode: "QAT_BUNCH",
                                customUnitLabel: "",
                                unitPrice: resolveLineDefaultUnitPrice("", "QAT_BUNCH", catalogItems, formConfig),
                                notes: "",
                              },
                            ])
                          }
                          disabled={editLocks.lines}
                          className="px-3 py-1.5 rounded-xl border border-emerald-500 text-emerald-700 dark:text-emerald-300 font-extrabold inline-flex items-center gap-1 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>+ إضافة صنف</span>
                        </button>
                      </div>
                    </div>

                    {showQuickRepeat && (
                      <QuickRepeatBasketPanel
                        items={quickRepeatItems}
                        onAddOne={handleAddQuickRepeatOne}
                        onAddAll={handleAddQuickRepeatAll}
                      />
                    )}

                    {lines.map((row, idx) => {
                      const rowQtyNum = Math.max(0, Number(row.requestedQty) || 0);
                      const rowPriceNum = Math.max(0, Number(row.unitPrice) || 0);
                      const { totalAmount: rowTotal } = computeSaleTotals(rowQtyNum, rowPriceNum, 0);
                      return (
                        <div
                          key={row.rowKey}
                          className="p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/40 space-y-2"
                        >
                          <div className="flex items-center justify-between flex-wrap gap-2">
                            <span className="font-bold text-slate-500">الصنف #{idx + 1}</span>
                            <div className="flex items-center gap-3">
                              <span className="text-[11px] font-black text-emerald-700 dark:text-emerald-300">
                                {rowPriceNum > 0
                                  ? `الإجمالي (P×Q): ${formatMoney(rowTotal)}`
                                  : "التسعير: تقديري / يُحدد عند المراجعة"}
                              </span>
                              {lines.length > 1 && !editLocks.lines && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setLines((prev) => prev.filter((x) => x.rowKey !== row.rowKey))
                                  }
                                  className="text-rose-600 font-bold inline-flex items-center gap-0.5 hover:underline"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                  <span>حذف السطر</span>
                                </button>
                              )}
                            </div>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                            <div className="sm:col-span-4 space-y-1.5">
                              {sectorCatalogItems.length > 0 && (
                                <select
                                  aria-label="اختيار من الأصناف"
                                  disabled={editLocks.lines}
                                  value={row.itemId}
                                  onChange={(e) => {
                                    const nextId = e.target.value;
                                    const found = sectorCatalogItems.find((it) => it.id === nextId);
                                    setLines((prev) =>
                                      prev.map((x) =>
                                        x.rowKey === row.rowKey
                                          ? {
                                            ...x,
                                            itemId: nextId,
                                            itemTitle: found ? found.nameAr : nextId === "__CUSTOM__" ? "" : x.itemTitle,
                                            unitPrice:
                                              nextId === "__CUSTOM__"
                                                ? ""
                                                : resolveLineDefaultUnitPrice(nextId, x.unitCode, sectorCatalogItems, formConfig) || x.unitPrice,
                                          }
                                          : x
                                      )
                                    );
                                  }}
                                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-2 font-bold disabled:opacity-50"
                                >
                                  <option value="">اختر الصنف أو اكتب أدناه...</option>
                                  {sectorCatalogItems.map((it) => (
                                    <option key={it.id} value={it.id}>
                                      {it.nameAr} {it.unitPrice > 0 ? `(${fmtNum(it.unitPrice)} ريال)` : ""}
                                    </option>
                                  ))}
                                  {(formConfig?.sectorForms?.[activeSector]?.allowUnlistedItems ??
                                    formConfig?.allowUnlistedItems ??
                                    true) && <option value="__CUSTOM__">صنف آخر غير مدرج</option>}
                                </select>
                              )}
                              <input
                                type="text"
                                required
                                disabled={editLocks.lines}
                                value={row.itemTitle}
                                onChange={(e) =>
                                  setLines((prev) =>
                                    prev.map((x) =>
                                      x.rowKey === row.rowKey ? { ...x, itemTitle: e.target.value } : x
                                    )
                                  )
                                }
                                placeholder={
                                  activeSector === "COMMERCIAL"
                                    ? "اسم الصنف التجاري (مثال: أرز بسمتي 10 كجم)"
                                    : "اسم الصنف (مثال: قات صوطي درجة أولى)"
                                }
                                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 font-bold disabled:opacity-50"
                              />
                            </div>

                            <div className="sm:col-span-2">
                              <label className="block text-[10px] text-slate-500 mb-1">الكمية *</label>
                              <input
                                type="number"
                                step="any"
                                min="0.01"
                                required
                                value={row.requestedQty}
                                disabled={editLocks.quantity}
                                onChange={(e) =>
                                  setLines((prev) =>
                                    prev.map((x) =>
                                      x.rowKey === row.rowKey ? { ...x, requestedQty: e.target.value } : x
                                    )
                                  )
                                }
                                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 font-mono font-bold"
                              />
                            </div>

                            <div className="sm:col-span-2 space-y-1.5">
                              <label className="block text-[10px] text-slate-500 mb-1">الوحدة *</label>
                              <select
                                value={row.unitCode}
                                disabled={editLocks.unit}
                                onChange={(e) => {
                                  const nextUnit = e.target.value;
                                  setLines((prev) =>
                                    prev.map((x) =>
                                      x.rowKey === row.rowKey
                                        ? {
                                          ...x,
                                          unitCode: nextUnit,
                                          unitPrice:
                                            resolveLineDefaultUnitPrice(x.itemId, nextUnit, catalogItems, formConfig) ||
                                            x.unitPrice,
                                        }
                                        : x
                                    )
                                  );
                                }}
                                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-2 font-bold"
                              >
                                {(formConfig?.unitOptions || []).map((u) => (
                                  <option key={u.code} value={u.code}>
                                    {u.labelAr}
                                  </option>
                                ))}
                              </select>
                              {row.unitCode === "OTHER" && (
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[11px] font-black text-emerald-700 dark:text-emerald-300 shrink-0">
                                    اخرى:
                                  </span>
                                  <input
                                    type="text"
                                    required
                                    disabled={editLocks.unit}
                                    value={row.customUnitLabel}
                                    onChange={(e) =>
                                      setLines((prev) =>
                                        prev.map((x) =>
                                          x.rowKey === row.rowKey
                                            ? { ...x, customUnitLabel: e.target.value }
                                            : x
                                        )
                                      )
                                    }
                                    placeholder="اكتب اسم الوحدة..."
                                    className="w-full rounded-xl border border-emerald-400 bg-white dark:bg-slate-900 px-2.5 py-1.5 disabled:opacity-50"
                                  />
                                </div>
                              )}
                            </div>

                            <div className="sm:col-span-2">
                              <label className="block text-[10px] text-slate-500 mb-1">سعر الوحدة (ريال)</label>
                              <input
                                type="number"
                                step="any"
                                min="0"
                                value={row.unitPrice}
                                disabled={editLocks.price}
                                onChange={(e) =>
                                  setLines((prev) =>
                                    prev.map((x) =>
                                      x.rowKey === row.rowKey ? { ...x, unitPrice: e.target.value } : x
                                    )
                                  )
                                }
                                placeholder="يُحدد عند المراجعة"
                                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-2 font-mono font-bold"
                              />
                            </div>

                            <div className="sm:col-span-2">
                              <label className="block text-[10px] text-slate-500 mb-1">ملاحظات</label>
                              <input
                                type="text"
                                value={row.notes}
                                onChange={(e) =>
                                  setLines((prev) =>
                                    prev.map((x) =>
                                      x.rowKey === row.rowKey ? { ...x, notes: e.target.value } : x
                                    )
                                  )
                                }
                                placeholder="اختياري"
                                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-2"
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {(() => {
                    const orderEstimatedTotal = lines.reduce(
                      (s, row) =>
                        s + computeSaleTotals(Math.max(0, Number(row.requestedQty) || 0), Math.max(0, Number(row.unitPrice) || 0), 0).totalAmount,
                      0
                    );
                    const hasUnpriced = lines.some((l) => !(Number(l.unitPrice) > 0));
                    return (
                      <div className="p-3 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <span className="font-bold text-slate-600 dark:text-slate-300">الإجمالي الكلي التقديري للطلب (= P × Q): </span>
                          <strong className="text-base font-black text-emerald-700 dark:text-emerald-300">
                            {orderEstimatedTotal > 0 ? formatMoney(orderEstimatedTotal) : "تقديري (يُعتمد من الإدارة)"}
                          </strong>
                        </div>
                        {hasUnpriced && (
                          <span className="text-[11px] text-amber-700 dark:text-amber-300 font-bold">
                            * الأصناف غير المسعرة يتم تسعيرها عند مراجعة الطلب
                          </span>
                        )}
                      </div>
                    );
                  })()}

                  <div className="pt-2">
                    <button
                      type="submit"
                      disabled={submittingReq}
                      className="w-full sm:w-auto px-6 py-2.5 rounded-xl accent-bg font-black text-sm shadow-md disabled:opacity-60"
                    >
                      {submittingReq
                        ? "جاري الحفظ والإرسال..."
                        : editingRequestId
                          ? "حفظ تعديلات الطلب"
                          : "إرسال الطلب"}
                    </button>
                  </div>
                </form>
              )
            )}

            <BulkItemImportModal
              open={showBulkImportModal}
              onClose={() => setShowBulkImportModal(false)}
              tenantSlug={tenantSlug}
              boardItems={boardItems.filter((item) =>
                activeSector === "COMMERCIAL"
                  ? (item.sectorType || "HARVEST").toUpperCase() === "COMMERCIAL"
                  : (item.sectorType || "HARVEST").toUpperCase() !== "COMMERCIAL"
              )}
              catalogItems={sectorCatalogItems}
              formConfig={formConfig}
              onApplyRows={handleApplyBulkRows}
            />

            {/* TAB 2: REQUEST HISTORY & LIVE STATUS */}
            {portalTab === "requests" && (
              <div className="card-surface rounded-2xl p-5 space-y-4 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-base font-black">سجل الطلبات وحالة التنفيذ</h2>
                    {reqRefreshedAt && (
                      <div className="text-[10px] text-emerald-700 dark:text-emerald-400 font-semibold">
                        {formatRefreshTimestamp(reqRefreshedAt)}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={reqLoading}
                      onClick={() => void loadRequests(true)}
                      className="px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 font-bold inline-flex items-center gap-1.5"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${reqLoading ? "animate-spin" : ""}`} />
                      <span>تحديث</span>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void printUasDocument({
                          titleAr: "سجل طلبات العميل",
                          titleEn: "Client Requests History",
                          documentNumber: `CLI-REQ-${new Date().toISOString().slice(0, 10)}`,
                          currency: "YER",
                          status: "POSTED",
                          format: "A4_LANDSCAPE",
                          letterhead: portalLetterhead,
                          printedBy: account?.fullName || "بوابة العملاء",
                          exportedBy: portalExportActor,
                          tables: [
                            {
                              headingAr: "الطلبات المسجلة والتسعير",
                              headingEn: "Requests & Pricing",
                              columns: [
                                { key: "num", labelAr: "رقم الطلب" },
                                { key: "date", labelAr: "التاريخ" },
                                { key: "pickup", labelAr: "موقع الاستلام" },
                                { key: "status", labelAr: "الحالة" },
                                { key: "lines", labelAr: "الأصناف والتسعير" },
                                { key: "total", labelAr: "الإجمالي", numeric: true },
                              ],
                              rows: requestsList.map((r) => {
                                const tot = r.totalConfirmed > 0 ? r.totalConfirmed : r.totalEstimated;
                                return {
                                  num: r.requestNumber,
                                  date: formatIsoToDmy(r.createdAt.slice(0, 10)),
                                  pickup: r.pickupLocation,
                                  status: r.statusLabelAr,
                                  lines: r.lines
                                    .map(
                                      (l) =>
                                        `${l.itemTitle} (${l.confirmedQty ?? l.requestedQty} ${l.displayUnitLabel}${l.unitPrice > 0 ? ` × ${fmtNum(l.unitPrice)}` : ""
                                        })`
                                    )
                                    .join("، "),
                                  total: tot > 0 ? formatMoney(tot, r.currency || "YER") : "تقديري",
                                };
                              }),
                            },
                          ],
                        })
                      }
                      className="px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 font-bold inline-flex items-center gap-1"
                    >
                      <Printer className="w-3.5 h-3.5" />
                      <span>PDF / طباعة</span>
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2.5 items-center">
                  <select
                    value={reqFilterStatus}
                    onChange={(e) => setReqFilterStatus(e.target.value)}
                    className="w-full min-h-[40px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 font-bold"
                  >
                    <option value="ALL">جميع الحالات</option>
                    <option value="PENDING_REVIEW">قيد المراجعة</option>
                    <option value="RETURNED_TO_CLIENT">معاد للموافقة</option>
                    <option value="CONFIRMED">مؤكد</option>
                    <option value="READY_FOR_PICKUP">جاهز للاستلام</option>
                    <option value="COMPLETED">تم الاستلام</option>
                    <option value="CANCELLED">ملغى</option>
                  </select>
                  <select
                    value={reqArchiveView}
                    onChange={(e) =>
                      setReqArchiveView(e.target.value as "ALL" | "ACTIVE" | "ARCHIVED")
                    }
                    className="w-full min-h-[40px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 font-bold"
                  >
                    <option value="ALL">النشطة والمؤرشفة</option>
                    <option value="ACTIVE">غير المؤرشفة فقط</option>
                    <option value="ARCHIVED">الأرشيف فقط</option>
                  </select>
                  <UasDateInput value={reqFilterFrom} onChange={setReqFilterFrom} placeholder="من: يوم / شهر / سنة" />
                  <UasDateInput value={reqFilterTo} onChange={setReqFilterTo} placeholder="إلى: يوم / شهر / سنة" />
                  <input
                    type="text"
                    value={reqFilterQuery}
                    onChange={(e) => setReqFilterQuery(e.target.value)}
                    placeholder="بحث برقم الطلب أو الصنف..."
                    className="rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2"
                  />
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      data-testid="portal-bulk-hide-completed-btn"
                      onClick={() => void handleBulkHideRequests(false)}
                      className="px-2.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 font-bold inline-flex items-center gap-1"
                    >
                      <EyeOff className="w-3.5 h-3.5" />
                      <span>إخفاء جماعي للمكتمل/الملغى</span>
                    </button>
                    {Object.values(selectedReqIds).some(Boolean) && (
                      <button
                        type="button"
                        data-testid="portal-bulk-hide-selected-btn"
                        onClick={() => void handleBulkHideRequests(true)}
                        className="px-2.5 py-2 rounded-xl bg-slate-800 text-white font-bold inline-flex items-center gap-1"
                      >
                        <EyeOff className="w-3.5 h-3.5" />
                        <span>إخفاء المحدد ({Object.values(selectedReqIds).filter(Boolean).length})</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setReqIncludeHidden((prev) => !prev)}
                      className={`px-2.5 py-2 rounded-xl border font-bold inline-flex items-center gap-1 ${reqIncludeHidden
                          ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-200"
                          : "border-slate-300 dark:border-slate-700"
                        }`}
                    >
                      {reqIncludeHidden ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                      <span>{reqIncludeHidden ? "إخفاء المخفية" : "عرض المخفية"}</span>
                    </button>
                  </div>
                </div>

                {requestsList.filter((r) =>
                  activeSector === "COMMERCIAL"
                    ? r.sectorType === "COMMERCIAL"
                    : r.sectorType !== "COMMERCIAL"
                ).length === 0 ? (
                  <div className="p-8 text-center text-slate-500 space-y-3 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700">
                    <div>لا توجد طلبات مسجلة حالياً في هذا القطاع ضمن هذه الفلاتر.</div>
                    <div className="flex flex-wrap justify-center gap-2">
                      {(reqFilterStatus !== "ALL" || reqFilterFrom || reqFilterTo || reqFilterQuery) && (
                        <button
                          type="button"
                          onClick={() => {
                            setReqFilterStatus("ALL");
                            setReqFilterFrom("");
                            setReqFilterTo("");
                            setReqFilterQuery("");
                          }}
                          className="px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 font-bold"
                        >
                          إعادة ضبط الفلاتر
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setPortalTab("new_request")}
                        className="px-4 py-1.5 rounded-xl accent-bg font-extrabold"
                      >
                        + تسجيل طلب جديد
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {requestsList
                      .filter((r) => {
                        const matchSector =
                          activeSector === "COMMERCIAL"
                            ? r.sectorType === "COMMERCIAL"
                            : r.sectorType !== "COMMERCIAL";
                        if (!matchSector) return false;
                        if (reqArchiveView === "ACTIVE") return !r.isArchivedByClient;
                        if (reqArchiveView === "ARCHIVED") return Boolean(r.isArchivedByClient);
                        return true;
                      })
                      .map((r) => {
                        const stepperStages = [
                          { key: "PENDING_REVIEW", label: "قيد المراجعة" },
                          { key: "RETURNED_TO_CLIENT", label: "معاد للموافقة" },
                          { key: "CONFIRMED", label: "مؤكد" },
                          { key: "READY_FOR_PICKUP", label: "جاهز للاستلام" },
                          { key: "COMPLETED", label: "تم الاستلام" },
                        ];
                        const activeStageIdx = stepperStages.findIndex((st) => st.key === r.status);
                        const isTerminalClosed = r.status === "CANCELLED" || r.status === "REJECTED";
                        const canClientModifyPending =
                          (r.status === "PENDING_REVIEW" || r.status === "RETURNED_TO_CLIENT") &&
                          !r.reserveStock &&
                          !r.linkedSalesRecordId &&
                          !r.linkedSaleId &&
                          !r.linkedInvoiceId;
                        const canClientCancelPending =
                          r.canClientCancel ??
                          ((r.status === "PENDING_REVIEW" || r.status === "RETURNED_TO_CLIENT") &&
                            !r.reserveStock &&
                            !r.linkedSalesRecordId &&
                            !r.linkedSaleId &&
                            !r.linkedInvoiceId);
                        const canArchiveHide =
                          r.canArchiveOrHide ??
                          (["COMPLETED", "CANCELLED", "REJECTED"].includes(r.status) || Boolean(r.isArchivedByClient));
                        const canSafeDelete =
                          r.canSafelyDelete ??
                          (["CANCELLED", "REJECTED", "PENDING_REVIEW", "RETURNED_TO_CLIENT"].includes(r.status) &&
                            !r.reserveStock &&
                            !r.linkedSalesRecordId &&
                            !r.linkedSaleId &&
                            !r.linkedInvoiceId);
                        return (
                          <div key={r.id} className="p-4 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-2 flex-wrap">
                                {canArchiveHide && (
                                  <input
                                    type="checkbox"
                                    aria-label={`تحديد ${r.requestNumber}`}
                                    checked={Boolean(selectedReqIds[r.id])}
                                    onChange={(e) =>
                                      setSelectedReqIds((prev) => ({
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
                                <span
                                  className={`px-2.5 py-0.5 rounded-full font-extrabold ${r.status === "RETURNED_TO_CLIENT"
                                    ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200"
                                    : r.status === "CANCELLED" || r.status === "REJECTED"
                                      ? "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200"
                                      : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
                                    }`}
                                >
                                  {r.statusLabelAr}
                                </span>
                                {r.isArchivedByClient && (
                                  <span className="px-2 py-0.5 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[10px] font-bold">
                                    مؤرشف
                                  </span>
                                )}
                                {r.isHiddenByClient && (
                                  <span className="px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-200 text-[10px] font-bold">
                                    مخفي
                                  </span>
                                )}
                                {r.clientResponseStatus === "PENDING_STAFF_APPROVAL" && (
                                  <span
                                    data-testid={`portal-pending-staff-badge-${r.id}`}
                                    className="px-2.5 py-0.5 rounded-full bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200 text-[10px] font-black"
                                  >
                                    بانتظار اعتماد الموظف
                                  </span>
                                )}
                                {(r.status === "CONFIRMED" || r.status === "READY_FOR_PICKUP") && (
                                  <span className="px-2 py-0.5 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800 font-mono font-bold text-indigo-700 dark:text-indigo-200 text-[11px]">
                                    كود الاستلام: <bdi dir="ltr">{r.pickupPassCode || r.requestNumber}</bdi>
                                  </span>
                                )}
                                <span className="text-slate-500 inline-flex items-center gap-1">
                                  <MapPin className="w-3.5 h-3.5 text-emerald-600" />
                                  {r.pickupLocation}
                                </span>
                                <span className="font-mono text-slate-500 inline-flex items-center gap-1">
                                  <Clock className="w-3 h-3" />
                                  <bdi dir="ltr">{r.createdAtDisplay || formatIsoToDmyTime(r.createdAt)}</bdi>
                                </span>
                              </div>
                              <div className="flex items-center gap-1.5 flex-wrap">
                                {canClientModifyPending && (
                                  <button
                                    type="button"
                                    data-testid={`portal-edit-req-${r.id}`}
                                    onClick={() => handleStartEditPendingRequest(r)}
                                    className="px-2.5 py-1 rounded-xl border border-indigo-400 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 font-bold text-[11px] inline-flex items-center gap-1"
                                  >
                                    <Edit3 className="w-3 h-3" />
                                    <span>تعديل الطلب</span>
                                  </button>
                                )}
                                {canClientCancelPending && (
                                  <button
                                    type="button"
                                    data-testid={`portal-cancel-req-${r.id}`}
                                    onClick={() => void handleCancelPendingRequest(r.id)}
                                    className="px-2.5 py-1 rounded-xl border border-rose-400 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/40 font-bold text-[11px] inline-flex items-center gap-1"
                                  >
                                    <XCircle className="w-3 h-3" />
                                    <span>إلغاء الطلب</span>
                                  </button>
                                )}
                                <button
                                  type="button"
                                  data-testid={`portal-reorder-req-${r.id}`}
                                  onClick={() => handleQuickReorderFromRequest(r)}
                                  className="px-2.5 py-1 rounded-xl border border-emerald-400 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 font-bold text-[11px] inline-flex items-center gap-1"
                                >
                                  <RotateCcw className="w-3 h-3" />
                                  <span>إعادة طلب سريع</span>
                                </button>
                                <ActionOverflowMenu
                                  size="xs"
                                  align="end"
                                  items={[
                                    {
                                      id: "reorder",
                                      label: "إعادة طلب سريع",
                                      icon: <RotateCcw className="w-3.5 h-3.5" />,
                                      onClick: () => handleQuickReorderFromRequest(r),
                                    },
                                    {
                                      id: "edit",
                                      label: "تعديل الطلب",
                                      icon: <Edit3 className="w-3.5 h-3.5" />,
                                      hidden: !canClientModifyPending,
                                      onClick: () => handleStartEditPendingRequest(r),
                                    },
                                    {
                                      id: "print",
                                      label: "طباعة الإيصال / بطاقة الاستلام PDF",
                                      icon: <Printer className="w-3.5 h-3.5" />,
                                      onClick: () => printReceiptSpec(r),
                                    },
                                    {
                                      id: "archive",
                                      label: r.isArchivedByClient ? "إلغاء الأرشفة" : "أرشفة",
                                      icon: <Archive className="w-3.5 h-3.5" />,
                                      hidden: !canArchiveHide,
                                      onClick: () =>
                                        handleRequestLifecycle(
                                          r.id,
                                          r.isArchivedByClient ? "UNARCHIVE" : "ARCHIVE"
                                        ),
                                    },
                                    {
                                      id: "hide",
                                      label: r.isHiddenByClient ? "إظهار الطلب" : "إخفاء",
                                      icon: r.isHiddenByClient ? (
                                        <Eye className="w-3.5 h-3.5" />
                                      ) : (
                                        <EyeOff className="w-3.5 h-3.5" />
                                      ),
                                      hidden: !canArchiveHide,
                                      onClick: () =>
                                        handleRequestLifecycle(
                                          r.id,
                                          r.isHiddenByClient ? "UNHIDE" : "HIDE"
                                        ),
                                    },
                                    {
                                      id: "cancel",
                                      label: "إلغاء الطلب",
                                      icon: <XCircle className="w-3.5 h-3.5" />,
                                      tone: "danger",
                                      hidden: !canClientCancelPending,
                                      confirmTitle: `إلغاء الطلب (${r.requestNumber})`,
                                      confirmMessage: "هل أنت متأكد من إلغاء هذا الطلب قبل معالجة الإدارة؟",
                                      onClick: () => handleCancelPendingRequest(r.id),
                                    },
                                    {
                                      id: "delete-safe",
                                      label: "حذف نهائي (للطلبات الملغاة/غير المرحّلة)",
                                      icon: <Trash2 className="w-3.5 h-3.5" />,
                                      tone: "danger",
                                      hidden: !canSafeDelete,
                                      confirmTitle: `حذف الطلب (${r.requestNumber})`,
                                      confirmMessage: "سيتم حذف الطلب غير المرحّل نهائياً دون المساس بأي قيود مالية. هل تريد المتابعة؟",
                                      onClick: () => handleRequestLifecycle(r.id, "DELETE"),
                                    },
                                  ]}
                                />
                              </div>
                            </div>

                            {!isTerminalClosed && (
                              <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5 pt-1 text-[10px]">
                                {stepperStages.map((st, idx) => {
                                  const done = activeStageIdx >= idx;
                                  const isCurrent = activeStageIdx === idx;
                                  return (
                                    <div
                                      key={st.key}
                                      className={`px-2 py-1 rounded-lg border text-center font-bold transition ${isCurrent
                                        ? st.key === "RETURNED_TO_CLIENT"
                                          ? "bg-amber-500 text-white border-amber-500 shadow-xs"
                                          : "bg-emerald-600 text-white border-emerald-600 shadow-xs"
                                        : done
                                          ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800"
                                          : "bg-slate-50 dark:bg-slate-900 text-slate-400 border-slate-200 dark:border-slate-800"
                                        }`}
                                    >
                                      {idx + 1}. {st.label}
                                    </div>
                                  );
                                })}
                              </div>
                            )}

                            {/* Phase 14 Pickup Pass Card */}
                            {(r.status === "CONFIRMED" || r.status === "READY_FOR_PICKUP") && (
                              <div
                                data-testid={`portal-pickup-pass-${r.id}`}
                                className="p-3 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 flex flex-wrap items-center justify-between gap-2 text-[11px]"
                              >
                                <div className="space-y-0.5">
                                  <div className="font-black text-emerald-800 dark:text-emerald-200">
                                    بطاقة الاستلام — رمز الاستلام: <bdi dir="ltr" className="font-mono">{r.pickupPassCode || r.requestNumber}</bdi>
                                  </div>
                                  <div className="text-slate-600 dark:text-slate-300">
                                    استلام من: <strong>{r.pickupLocation}</strong>
                                    {r.pickupNotes ? ` • التعليمات: ${r.pickupNotes}` : ""}
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => printReceiptSpec(r)}
                                  className="px-3 py-1 rounded-xl bg-white dark:bg-slate-900 border border-emerald-400 text-emerald-700 dark:text-emerald-300 font-bold inline-flex items-center gap-1"
                                >
                                  <Printer className="w-3 h-3" />
                                  <span>طباعة بطاقة الاستلام</span>
                                </button>
                              </div>
                            )}

                            {/* Phase 13 Return to Client for Approval Banner + Client Pending Diff Summary */}
                            {r.status !== "RETURNED_TO_CLIENT" &&
                              r.amendmentDiff &&
                              r.amendmentDiff.length > 0 && (
                                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 space-y-2 text-[11px]">
                                  <div className="font-bold text-slate-700 dark:text-slate-200">
                                    ملخص التعديلات المسجلة ({r.revisionNumber ? `مراجعة #${r.revisionNumber}` : "محدث"}):
                                  </div>
                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                                    {r.amendmentDiff.map((diff, i) => (
                                      <div key={`${diff.field}-${i}`} className="px-2 py-1 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700">
                                        <span className="font-bold">{diff.labelAr}: </span>
                                        <span className="text-rose-600 line-through mx-1">{diff.before}</span>
                                        <span>←</span>
                                        <strong className="text-emerald-700 dark:text-emerald-300 mx-1">{diff.after}</strong>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                            {r.status === "RETURNED_TO_CLIENT" && (
                              <div
                                data-testid={`portal-amendment-review-${r.id}`}
                                className="p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 space-y-3 text-xs"
                              >
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div className="font-black text-amber-900 dark:text-amber-200 flex items-center gap-1.5">
                                    <CornerUpLeft className="w-4 h-4 text-amber-600" />
                                    <span>تم تعديل الطلب وإعادته لموافقتك</span>
                                  </div>
                                  {r.returnedByName && (
                                    <span className="text-[11px] text-amber-800 dark:text-amber-300">
                                      بواسطة: {r.returnedByName}
                                      {r.returnedToClientAt ? ` • ${r.returnedToClientAtDisplay || formatIsoToDmyTime(r.returnedToClientAt)}` : ""}
                                    </span>
                                  )}
                                </div>

                                {r.reviewerRemarks && (
                                  <div className="p-2.5 rounded-xl bg-white/80 dark:bg-slate-900/60 border border-amber-200 dark:border-amber-800">
                                    <span className="font-bold text-amber-900 dark:text-amber-200">ملاحظات المراجع: </span>
                                    <span>{r.reviewerRemarks}</span>
                                  </div>
                                )}

                                {r.amendmentDiff && r.amendmentDiff.length > 0 && (
                                  <div className="overflow-x-auto rounded-xl border border-amber-200 dark:border-amber-800 bg-white dark:bg-slate-900">
                                    <table className="w-full text-[11px] text-right border-collapse">
                                      <thead>
                                        <tr className="bg-amber-100/70 dark:bg-amber-950/60 border-b border-amber-200 dark:border-amber-800">
                                          <th className="p-2">البند المعدل</th>
                                          <th className="p-2">قبل التعديل</th>
                                          <th className="p-2">بعد التعديل</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-amber-100 dark:divide-amber-900/40">
                                        {r.amendmentDiff.map((diff, i) => (
                                          <tr key={`${diff.field}-${i}`}>
                                            <td className="p-2 font-bold">{diff.labelAr}</td>
                                            <td className="p-2 text-rose-600 line-through">{diff.before}</td>
                                            <td className="p-2 text-emerald-700 dark:text-emerald-300 font-bold">{diff.after}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                )}

                                <div className="flex flex-wrap items-center gap-2 pt-1">
                                  <input
                                    type="text"
                                    value={amendReplyNotes[r.id] || ""}
                                    onChange={(e) =>
                                      setAmendReplyNotes((prev) => ({ ...prev, [r.id]: e.target.value }))
                                    }
                                    placeholder="ملاحظة اختيارية (أو سبب طلب التعديل عند الرفض)..."
                                    className="flex-1 min-w-[200px] rounded-xl border border-amber-300 dark:border-amber-700 bg-white dark:bg-slate-900 px-3 py-1.5"
                                  />
                                  <button
                                    type="button"
                                    disabled={respondingReqId === r.id}
                                    data-testid={`portal-approve-amend-${r.id}`}
                                    onClick={() => void handleRespondToAmendment(r.id, "APPROVE_AMENDMENTS")}
                                    className="px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold inline-flex items-center gap-1 disabled:opacity-50"
                                  >
                                    <Check className="w-3.5 h-3.5" />
                                    <span>اعتماد التعديلات</span>
                                  </button>
                                  <button
                                    type="button"
                                    disabled={respondingReqId === r.id}
                                    data-testid={`portal-decline-amend-${r.id}`}
                                    onClick={() => void handleRespondToAmendment(r.id, "DECLINE_AMENDMENTS")}
                                    className="px-3 py-1.5 rounded-xl border border-rose-400 text-rose-700 dark:text-rose-300 font-bold inline-flex items-center gap-1 disabled:opacity-50"
                                  >
                                    <CornerUpLeft className="w-3.5 h-3.5" />
                                    <span>رفض / طلب تعديل</span>
                                  </button>
                                </div>
                              </div>
                            )}

                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex flex-wrap gap-2">
                                {r.lines.map((l) => (
                                  <span
                                    key={l.id}
                                    className="px-2.5 py-1 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-semibold"
                                  >
                                    {l.itemTitle}: <strong>{fmtNum(l.confirmedQty ?? l.requestedQty)}</strong> {l.displayUnitLabel}
                                    {l.unitPrice > 0 && (
                                      <span className="text-emerald-700 dark:text-emerald-300 font-mono">
                                        {" "}× {fmtNum(l.unitPrice)} = {formatMoney(l.lineTotal, r.currency || "YER")}
                                      </span>
                                    )}
                                  </span>
                                ))}
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-[11px] font-black text-emerald-700 dark:text-emerald-300">
                                  {(r.totalConfirmed > 0 ? r.totalConfirmed : r.totalEstimated) > 0
                                    ? `الإجمالي: ${formatMoney(
                                      r.totalConfirmed > 0 ? r.totalConfirmed : r.totalEstimated,
                                      r.currency || "YER"
                                    )}`
                                    : "التسعير: يُحدد عند المراجعة"}
                                </span>
                                {["CONFIRMED", "READY_FOR_PICKUP", "COMPLETED"].includes(r.status) && (
                                  <button
                                    type="button"
                                    data-testid={`portal-pay-request-${r.id}`}
                                    onClick={() => {
                                      const due = r.totalConfirmed > 0 ? r.totalConfirmed : r.totalEstimated;
                                      openPaymentModal({
                                        amount: due > 0 ? String(due) : "",
                                        linkedRequestIds: [r.id],
                                        linkedInvoiceIds: r.linkedInvoiceId ? [r.linkedInvoiceId] : [],
                                      });
                                    }}
                                    className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold inline-flex items-center gap-1"
                                  >
                                    <CreditCard className="w-3 h-3" />
                                    <span>تسجيل سداد</span>
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    {reqPagination.totalPages > 1 && (
                      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                        <span className="text-[11px] text-slate-500">
                          صفحة {reqPagination.page} من {reqPagination.totalPages} (إجمالي {reqPagination.total} طلب)
                        </span>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            disabled={reqPagination.page <= 1}
                            onClick={() => setReqPage((p) => Math.max(1, p - 1))}
                            className="px-3 py-1 rounded-lg border border-slate-300 dark:border-slate-700 font-bold disabled:opacity-40"
                          >
                            السابق
                          </button>
                          <button
                            type="button"
                            disabled={!reqPagination.hasMore}
                            onClick={() => setReqPage((p) => p + 1)}
                            className="px-3 py-1 rounded-lg border border-slate-300 dark:border-slate-700 font-bold disabled:opacity-40"
                          >
                            التالي
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* TAB 3: BILLS & ACCOUNT STATEMENT */}
            {portalTab === "statement" && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
                  <div className="card-surface rounded-2xl p-4">
                    <div className="text-slate-500 font-bold">المدفوع</div>
                    <div className="text-lg font-black text-emerald-600 mt-1 tabular-nums">
                      {formatMoney(stmtSummary.totalPaid)}
                    </div>
                  </div>
                  <div className="card-surface rounded-2xl p-4">
                    <div className="text-slate-500 font-bold">غير المسدد / المتبقي</div>
                    <div className="text-lg font-black text-rose-600 mt-1 tabular-nums">
                      {formatMoney(stmtSummary.totalUnpaid)}
                    </div>
                  </div>
                  <div className="card-surface rounded-2xl p-4 space-y-1">
                    <div className="text-slate-500 font-bold">الحد الائتماني والاستخدام</div>
                    <div className="text-lg font-black text-indigo-600 tabular-nums">
                      {formatMoney(stmtSummary.creditLimit)}
                    </div>
                    {stmtSummary.creditAvailable !== null && (
                      <div className="text-[10px] text-slate-500">
                        المتاح: <strong className="text-emerald-700 dark:text-emerald-300">{formatMoney(stmtSummary.creditAvailable)}</strong> ({stmtSummary.creditUtilizationPct ?? 0}%)
                      </div>
                    )}
                    {stmtSummary.creditLimit > 0 && (
                      <div className="w-full h-1.5 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${(stmtSummary.creditUtilizationPct ?? 0) >= 85
                            ? "bg-rose-500"
                            : (stmtSummary.creditUtilizationPct ?? 0) >= 60
                              ? "bg-amber-500"
                              : "bg-emerald-500"
                            }`}
                          style={{ width: `${Math.min(100, stmtSummary.creditUtilizationPct ?? 0)}%` }}
                        />
                      </div>
                    )}
                  </div>
                  <div className="card-surface rounded-2xl p-4">
                    <div className="text-slate-500 font-bold">حالة الفواتير</div>
                    <div className="text-lg font-black mt-1 tabular-nums">
                      {stmtSummary.openBillsCount ?? billsList.filter((b) => b.billStatus !== "PAID").length} مفتوحة /{" "}
                      <span className="text-emerald-600">
                        {stmtSummary.paidBillsCount ?? billsList.filter((b) => b.billStatus === "PAID").length} مسددة
                      </span>
                    </div>
                  </div>
                </div>

                <div className="card-surface rounded-2xl p-5 space-y-4 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="inline-flex flex-wrap rounded-xl border border-slate-200 dark:border-slate-700 p-1 bg-slate-50 dark:bg-slate-900 gap-1">
                      <button
                        type="button"
                        data-testid="portal-open-payment-modal-btn"
                        onClick={() =>
                          openPaymentModal({
                            amount: stmtSummary.totalUnpaid > 0 ? String(stmtSummary.totalUnpaid) : "",
                          })
                        }
                        className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold inline-flex items-center gap-1"
                      >
                        <CreditCard className="w-3.5 h-3.5" />
                        <span>تسجيل سداد / دفع على الحساب</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setStmtTab("bills")}
                        className={`px-3 py-1.5 rounded-lg font-bold ${stmtTab === "bills" ? "accent-bg" : ""
                          }`}
                      >
                        الفواتير ({billsList.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setStmtTab("receipts")}
                        className={`px-3 py-1.5 rounded-lg font-bold ${stmtTab === "receipts" ? "accent-bg" : ""
                          }`}
                      >
                        سندات القبض والدفعات ({receiptsList.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setStmtTab("ledger")}
                        className={`px-3 py-1.5 rounded-lg font-bold ${stmtTab === "ledger" ? "accent-bg" : ""
                          }`}
                      >
                        كشف الحساب التفصيلي ({statementRows.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setStmtTab("notifications")}
                        className={`px-3 py-1.5 rounded-lg font-bold inline-flex items-center gap-1 ${stmtTab === "notifications" ? "accent-bg" : ""
                          }`}
                      >
                        <Bell className="w-3.5 h-3.5" />
                        <span>الإشعارات ({notificationsList.length})</span>
                      </button>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {stmtRefreshedAt && (
                        <span className="text-[10px] text-emerald-700 dark:text-emerald-400 font-semibold">
                          {formatRefreshTimestamp(stmtRefreshedAt)}
                        </span>
                      )}
                      <UasDateInput value={stmtFrom} onChange={setStmtFrom} placeholder="من: يوم / شهر / سنة" />
                      <UasDateInput value={stmtTo} onChange={setStmtTo} placeholder="إلى: يوم / شهر / سنة" />
                      <button
                        type="button"
                        disabled={stmtLoading}
                        onClick={() => void loadStatement(true)}
                        className="px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 font-bold inline-flex items-center gap-1.5"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${stmtLoading ? "animate-spin" : ""}`} />
                        <span>تحديث</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleExportStatementExcel}
                        className="px-3 py-1.5 rounded-xl border border-emerald-500 text-emerald-700 dark:text-emerald-300 font-bold inline-flex items-center gap-1"
                      >
                        <FileSpreadsheet className="w-3.5 h-3.5" />
                        <span>Excel</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleExportStatementCsv}
                        className="px-3 py-1.5 rounded-xl border border-indigo-400 text-indigo-700 dark:text-indigo-300 font-bold inline-flex items-center gap-1"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>CSV</span>
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          void printUasDocument({
                            titleAr: "كشف حساب العميل والفواتير",
                            titleEn: "Client Account Statement",
                            documentNumber: `STMT-${new Date().toISOString().slice(0, 10)}`,
                            currency: "YER",
                            status: "POSTED",
                            format: "A4_PORTRAIT",
                            letterhead: portalLetterhead,
                            printedBy: account.fullName,
                            exportedBy: portalExportActor,
                            summaryCards: [
                              { labelAr: "المدفوع", labelEn: "Paid", value: formatMoney(stmtSummary.totalPaid), tone: "emerald" },
                              { labelAr: "المتبقي المستحق", labelEn: "Balance Due", value: formatMoney(stmtSummary.totalUnpaid), tone: "rose" },
                              { labelAr: "الحد الائتماني", labelEn: "Credit Limit", value: formatMoney(stmtSummary.creditLimit), tone: "indigo" },
                            ],
                            tables: [
                              {
                                headingAr: "تفاصيل كشف الحساب",
                                headingEn: "Statement Ledger",
                                columns: [
                                  { key: "date", labelAr: "التاريخ" },
                                  { key: "ref", labelAr: "المرجع" },
                                  { key: "type", labelAr: "النوع" },
                                  { key: "desc", labelAr: "البيان" },
                                  { key: "debit", labelAr: "مدين", numeric: true },
                                  { key: "credit", labelAr: "دائن", numeric: true },
                                  { key: "bal", labelAr: "الرصيد", numeric: true },
                                ],
                                rows: statementRows.map((r) => ({
                                  date: formatIsoToDmy(r.date),
                                  ref: r.reference,
                                  type: r.typeAr,
                                  desc: r.description,
                                  debit: fmtNum(r.debit),
                                  credit: fmtNum(r.credit),
                                  bal: fmtNum(r.runningBalance),
                                })),
                              },
                            ],
                          })
                        }
                        className="px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 font-bold inline-flex items-center gap-1"
                      >
                        <Printer className="w-3.5 h-3.5" />
                        <span>PDF / طباعة</span>
                      </button>
                    </div>
                  </div>

                  {stmtTab === "bills" ? (
                    <div className="space-y-3">
                      <div className="flex items-center gap-1.5">
                        {[
                          { id: "ALL" as const, label: `الكل (${billsList.length})` },
                          { id: "OPEN" as const, label: `مفتوحة / جزئية (${billsList.filter((b) => b.billStatus !== "PAID").length})` },
                          { id: "PAID" as const, label: `مسددة (${billsList.filter((b) => b.billStatus === "PAID").length})` },
                        ].map((f) => (
                          <button
                            key={f.id}
                            type="button"
                            onClick={() => setBillStatusFilter(f.id)}
                            className={`px-2.5 py-1 rounded-lg border font-bold ${billStatusFilter === f.id
                              ? "border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                              : "border-slate-200 dark:border-slate-700 text-slate-500"
                              }`}
                          >
                            {f.label}
                          </button>
                        ))}
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs text-right border-collapse">
                          <thead>
                            <tr className="border-b bg-slate-100/80 dark:bg-slate-800/70">
                              <th className="p-2.5">رقم الفاتورة</th>
                              <th className="p-2.5">التاريخ</th>
                              <th className="p-2.5">الحالة</th>
                              <th className="p-2.5">الإجمالي</th>
                              <th className="p-2.5">المدفوع</th>
                              <th className="p-2.5">غير المسدد</th>
                              <th className="p-2.5">إجراءات</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                            {billsList
                              .filter((b) =>
                                billStatusFilter === "ALL"
                                  ? true
                                  : billStatusFilter === "OPEN"
                                    ? b.billStatus !== "PAID"
                                    : b.billStatus === "PAID"
                              )
                              .map((b) => (
                                <tr key={b.id}>
                                  <td className="p-2.5 font-mono font-bold"><bdi dir="ltr">{b.invoiceNumber}</bdi></td>
                                  <td className="p-2.5 font-mono"><bdi dir="ltr">{formatIsoToDmy(b.date)}</bdi></td>
                                  <td className="p-2.5">
                                    <span
                                      className={`px-2 py-0.5 rounded-full font-bold ${b.billStatus === "PAID"
                                        ? "bg-emerald-100 text-emerald-700"
                                        : b.billStatus === "PARTIALLY_PAID"
                                          ? "bg-amber-100 text-amber-800"
                                          : "bg-rose-100 text-rose-700"
                                        }`}
                                    >
                                      {b.billStatusAr}
                                    </span>
                                  </td>
                                  <td className="p-2.5 font-bold tabular-nums">{fmtNum(b.totalAmount)}</td>
                                  <td className="p-2.5 text-emerald-600 font-bold tabular-nums">{fmtNum(b.paidAmount)}</td>
                                  <td className="p-2.5 text-rose-600 font-bold tabular-nums">{fmtNum(b.balanceDue)}</td>
                                  <td className="p-2.5 flex flex-wrap items-center gap-1.5">
                                    {b.billStatus !== "PAID" && b.balanceDue > 0 && (
                                      <button
                                        type="button"
                                        data-testid={`portal-pay-bill-${b.id}`}
                                        onClick={() =>
                                          openPaymentModal({
                                            amount: String(b.balanceDue),
                                            linkedInvoiceIds: [b.id],
                                          })
                                        }
                                        className="px-2 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold inline-flex items-center gap-1"
                                      >
                                        <CreditCard className="w-3 h-3" />
                                        <span>سداد هذه الفاتورة</span>
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      data-testid={`portal-reorder-bill-${b.id}`}
                                      onClick={() => handleQuickReorderFromBill(b)}
                                      className="px-2 py-1 rounded-lg border border-emerald-400 text-emerald-700 dark:text-emerald-300 font-bold inline-flex items-center gap-1 hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
                                    >
                                      <RotateCcw className="w-3 h-3" />
                                      <span>إعادة طلب</span>
                                    </button>
                                  </td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : stmtTab === "receipts" ? (
                    <div className="overflow-x-auto">
                      {receiptsList.length === 0 ? (
                        <div className="p-6 text-center text-slate-500">لا توجد سندات قبض مسجلة في هذه الفترة.</div>
                      ) : (
                        <table className="w-full text-xs text-right border-collapse">
                          <thead>
                            <tr className="border-b bg-slate-100/80 dark:bg-slate-800/70">
                              <th className="p-2.5">رقم السند</th>
                              <th className="p-2.5">التاريخ</th>
                              <th className="p-2.5">الطريقة</th>
                              <th className="p-2.5">التطبيق على الفاتورة / الرصيد</th>
                              <th className="p-2.5">المبلغ المسدد</th>
                              <th className="p-2.5">البيان</th>
                              <th className="p-2.5">إيصال PDF</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                            {receiptsList.map((rc) => (
                              <tr key={rc.id}>
                                <td className="p-2.5 font-mono font-bold"><bdi dir="ltr">{rc.voucherNumber}</bdi></td>
                                <td className="p-2.5 font-mono"><bdi dir="ltr">{formatIsoToDmy(rc.date)}</bdi></td>
                                <td className="p-2.5 font-bold">{rc.paymentMethod}</td>
                                <td className="p-2.5 font-semibold text-indigo-700 dark:text-indigo-300">
                                  {rc.applicationSummary || rc.appliedInvoiceNumber || "دفعة مقيدة في الحساب"}
                                </td>
                                <td className="p-2.5 font-black text-emerald-600 tabular-nums">{formatMoney(rc.amount, rc.currency)}</td>
                                <td className="p-2.5">{rc.notes}</td>
                                <td className="p-2.5">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void printUasDocument({
                                        titleAr: "إيصال سداد دفعة — بوابة العملاء",
                                        titleEn: "Payment Receipt Voucher",
                                        documentNumber: rc.voucherNumber,
                                        documentDate: rc.date,
                                        currency: rc.currency || "YER",
                                        status: "POSTED",
                                        format: "A4_PORTRAIT",
                                        letterhead: portalLetterhead,
                                        printedBy: account.fullName,
                                        exportedBy: portalExportActor,
                                        metadata: [
                                          { labelAr: "العميل", labelEn: "Client", value: account.fullName },
                                          { labelAr: "الجوال", labelEn: "Phone", value: account.phone },
                                          { labelAr: "طريقة الدفع", labelEn: "Method", value: rc.paymentMethod },
                                        ],
                                        summaryCards: [
                                          { labelAr: "المبلغ المستلم", labelEn: "Amount Paid", value: formatMoney(rc.amount, rc.currency), tone: "emerald" },
                                        ],
                                        tables: [
                                          {
                                            headingAr: "تفاصيل السند",
                                            headingEn: "Voucher Details",
                                            columns: [
                                              { key: "ref", labelAr: "رقم السند" },
                                              { key: "date", labelAr: "التاريخ" },
                                              { key: "notes", labelAr: "البيان" },
                                              { key: "amt", labelAr: "المبلغ", numeric: true },
                                            ],
                                            rows: [
                                              {
                                                ref: rc.voucherNumber,
                                                date: formatIsoToDmy(rc.date),
                                                notes: rc.notes || "سداد مستحق",
                                                amt: formatMoney(rc.amount, rc.currency),
                                              },
                                            ],
                                          },
                                        ],
                                      })
                                    }
                                    className="px-2 py-1 rounded-lg border border-slate-300 dark:border-slate-700 font-bold inline-flex items-center gap-1"
                                  >
                                    <Printer className="w-3 h-3" />
                                    <span>طباعة</span>
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  ) : stmtTab === "notifications" ? (
                    <div className="space-y-2.5">
                      {notificationsList.length === 0 ? (
                        <div className="p-6 text-center text-slate-500 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 space-y-2">
                          <div>لا توجد إشعارات مسجلة حتى الآن.</div>
                          <button
                            type="button"
                            onClick={() => void loadStatement(true)}
                            className="px-3 py-1 rounded-xl border border-slate-300 dark:border-slate-700 font-bold"
                          >
                            تحديث الإشعارات
                          </button>
                        </div>
                      ) : (
                        notificationsList.map((n) => (
                          <div
                            key={n.id}
                            className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/40 space-y-1"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-mono font-bold px-2 py-0.5 rounded bg-slate-200/70 dark:bg-slate-800">
                                  <bdi dir="ltr">{n.draftNumber}</bdi>
                                </span>
                                <span className="font-extrabold">{n.eventLabelAr}</span>
                                <span
                                  className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold ${n.status === "APPROVED_SENT" || n.status === "DISPATCHED_LINK"
                                    ? "bg-emerald-100 text-emerald-700"
                                    : n.status === "PENDING_APPROVAL"
                                      ? "bg-amber-100 text-amber-800"
                                      : "bg-slate-200 text-slate-600"
                                    }`}
                                >
                                  {n.statusLabelAr}
                                </span>
                              </div>
                              <span className="font-mono text-[10px] text-slate-400">
                                <bdi dir="ltr">{formatIsoToDmyTime(n.createdAt)}</bdi>
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
                              {n.previewText}
                            </p>
                          </div>
                        ))
                      )}
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      {statementRows.length === 0 ? (
                        <div className="p-6 text-center text-slate-500 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 space-y-2">
                          <div>لا توجد حركات مالية ضمن الفترة المحددة.</div>
                          {(stmtFrom || stmtTo) && (
                            <button
                              type="button"
                              onClick={() => {
                                setStmtFrom("");
                                setStmtTo("");
                              }}
                              className="px-3 py-1 rounded-xl border border-slate-300 dark:border-slate-700 font-bold"
                            >
                              إزالة فلتر التاريخ
                            </button>
                          )}
                        </div>
                      ) : (
                        <table className="w-full text-xs text-right border-collapse">
                          <thead>
                            <tr className="border-b bg-slate-100/80 dark:bg-slate-800/70">
                              <th className="p-2.5">التاريخ</th>
                              <th className="p-2.5">المرجع</th>
                              <th className="p-2.5">الحركة</th>
                              <th className="p-2.5">البيان</th>
                              <th className="p-2.5">مدين</th>
                              <th className="p-2.5">دائن</th>
                              <th className="p-2.5">الرصيد</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                            {statementRows.map((r) => (
                              <tr key={r.id}>
                                <td className="p-2.5 font-mono"><bdi dir="ltr">{formatIsoToDmy(r.date)}</bdi></td>
                                <td className="p-2.5 font-mono font-bold"><bdi dir="ltr">{r.reference}</bdi></td>
                                <td className="p-2.5 font-bold">{r.typeAr}</td>
                                <td className="p-2.5">{r.description}</td>
                                <td className="p-2.5 tabular-nums">{fmtNum(r.debit)}</td>
                                <td className="p-2.5 text-emerald-600 font-bold tabular-nums">{fmtNum(r.credit)}</td>
                                <td className="p-2.5 font-black tabular-nums">{fmtNum(r.runningBalance)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB 4: UNIFIED CLIENT PROFILE, AVATAR & PASSWORD MANAGEMENT */}
            {portalTab === "profile" && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 text-xs">
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    setProfSaving(true);
                    try {
                      const res = await fetch(apiUrl("/api/client-portal/me"), {
                        method: "PATCH",
                        credentials: "include",
                        headers: resolveClientHeaders({ "Content-Type": "application/json" }),
                        body: JSON.stringify({
                          fullName: profName,
                          tradeName: profTradeName,
                          email: profEmail,
                          preferredPickup: profPickup,
                          avatarColor: profAvatarColor,
                        }),
                      });
                      const data = (await res.json()) as {
                        account?: ClientAccountView;
                        message?: string;
                        error?: string;
                      };
                      if (!res.ok || !data.account) {
                        showNotice(data.error || "تعذر حفظ الملف الشخصي");
                        return;
                      }
                      setAccount(data.account);
                      showNotice(data.message || "✅ تم حفظ الملف الشخصي");
                    } finally {
                      setProfSaving(false);
                    }
                  }}
                  className="card-surface rounded-2xl p-5 space-y-4"
                >
                  <h2 className="text-base font-black">حسابي والملف الشخصي</h2>

                  {/* Client Avatar Upload + Initials Color Fallback */}
                  <div className="p-3.5 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-900/40 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <SvgAvatar
                          char={account.avatarChar || profName.trim().charAt(0) || "ع"}
                          avatarUrl={account.avatarUrl}
                          color={profAvatarColor}
                          size={52}
                          alt={profName}
                        />
                        <div>
                          <div className="font-extrabold">صورة الملف الشخصي</div>
                          <div className="text-[10px] text-slate-400">
                            PNG / JPG / WEBP / GIF — بحد أقصى 2MB
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          ref={avatarFileInputRef}
                          type="file"
                          accept="image/png,image/jpeg,image/webp,image/gif"
                          onChange={handleAvatarUpload}
                          className="hidden"
                          data-testid="portal-avatar-file-input"
                        />
                        <button
                          type="button"
                          data-testid="portal-avatar-upload-btn"
                          disabled={uploadingAvatar}
                          onClick={() => avatarFileInputRef.current?.click()}
                          className="px-3 py-1.5 rounded-xl accent-bg font-extrabold inline-flex items-center gap-1 disabled:opacity-50"
                        >
                          <Camera className="w-3.5 h-3.5" />
                          <span>{uploadingAvatar ? "جاري الرفع..." : "رفع صورة"}</span>
                        </button>
                        {account.avatarUrl && (
                          <button
                            type="button"
                            data-testid="portal-avatar-remove-btn"
                            disabled={uploadingAvatar}
                            onClick={() => void handleRemoveClientAvatar()}
                            className="px-2.5 py-1.5 rounded-xl border border-rose-300 text-rose-600 font-bold inline-flex items-center gap-1 disabled:opacity-50"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>إزالة</span>
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[11px] font-bold text-slate-500">لون الشعار الافتراضي:</span>
                      {["#059669", "#2563eb", "#7c3aed", "#d97706", "#db2777", "#0f766e"].map((hex) => (
                        <button
                          key={hex}
                          type="button"
                          onClick={() => setProfAvatarColor(hex)}
                          className="w-6 h-6 rounded-full border-2 flex items-center justify-center"
                          style={{
                            backgroundColor: hex,
                            borderColor: profAvatarColor === hex ? "#0f172a" : "transparent",
                          }}
                        >
                          {profAvatarColor === hex && <Check className="w-3 h-3 text-white" />}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block font-bold mb-1">الاسم الكامل</label>
                      <input
                        type="text"
                        required
                        value={profName}
                        onChange={(e) => setProfName(e.target.value)}
                        className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2"
                      />
                    </div>
                    <div>
                      <label className="block font-bold mb-1">الاسم التجاري</label>
                      <input
                        type="text"
                        value={profTradeName}
                        onChange={(e) => setProfTradeName(e.target.value)}
                        className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2"
                      />
                    </div>
                    <div>
                      <label className="block font-bold mb-1">رقم الجوال (ثابت وموثق)</label>
                      <input
                        type="text"
                        disabled
                        dir="ltr"
                        value={account.phone}
                        className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-800 px-3 py-2 font-mono opacity-75 text-right"
                      />
                    </div>
                    <div>
                      <label className="block font-bold mb-1">البريد الإلكتروني</label>
                      <input
                        type="email"
                        required
                        dir="ltr"
                        value={profEmail}
                        onChange={(e) => setProfEmail(e.target.value)}
                        className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 text-right"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block font-bold mb-1">موقع الاستلام المفضل (استلام من:)</label>
                    <input
                      type="text"
                      list="portal-pickup-suggestions"
                      value={profPickup}
                      onChange={(e) => setProfPickup(e.target.value)}
                      className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2"
                    />
                    <datalist id="portal-pickup-suggestions">
                      {(formConfig?.pickupOptions || [])
                        .filter((p) => p.type !== "OTHER")
                        .map((p) => (
                          <option key={p.code} value={p.labelAr} />
                        ))}
                    </datalist>
                  </div>
                  <button
                    type="submit"
                    disabled={profSaving}
                    className="px-5 py-2 rounded-xl accent-bg font-extrabold disabled:opacity-50"
                  >
                    {profSaving ? "جاري الحفظ..." : "حفظ بيانات الملف الشخصي"}
                  </button>
                </form>

                {/* Password Update Card */}
                <form
                  onSubmit={handleClientPasswordChange}
                  className="card-surface rounded-2xl p-5 space-y-3.5 self-start"
                >
                  <div className="flex items-center gap-2 border-b border-slate-100 dark:border-slate-800 pb-2.5">
                    <KeyRound className="w-4 h-4 text-indigo-600" />
                    <h3 className="text-sm font-black">تغيير كلمة المرور والأمان</h3>
                  </div>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    تغيير كلمة المرور يؤدي تلقائياً إلى إنهاء جميع الجلسات المفتوحة على الأجهزة الأخرى حفاظاً على أمان حسابك.
                  </p>
                  <div>
                    <label className="block font-bold mb-1">كلمة المرور الحالية / المؤقتة *</label>
                    <input
                      type="password"
                      required
                      value={currPassInput}
                      onChange={(e) => setCurrPassInput(e.target.value)}
                      placeholder="••••••"
                      className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2"
                    />
                  </div>
                  <div>
                    <label className="block font-bold mb-1">كلمة المرور الجديدة (4 خانات فأكثر) *</label>
                    <input
                      type="password"
                      required
                      minLength={4}
                      value={newPassInput}
                      onChange={(e) => setNewPassInput(e.target.value)}
                      placeholder="••••••"
                      className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2"
                    />
                  </div>
                  <div>
                    <label className="block font-bold mb-1">تأكيد كلمة المرور الجديدة *</label>
                    <input
                      type="password"
                      required
                      minLength={4}
                      value={confirmPassInput}
                      onChange={(e) => setConfirmPassInput(e.target.value)}
                      placeholder="••••••"
                      className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={changingPass}
                    className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-black disabled:opacity-50"
                  >
                    {changingPass ? "جاري التحديث..." : "تحديث كلمة المرور الآن"}
                  </button>
                </form>
              </div>
            )}

            {/* TAB 4: PAYMENTS & RECEIPT UPLOADS */}
            {portalTab === "payments" && (
              <ClientPaymentsSection
                channels={paymentChannels}
                payments={clientPayments}
                pagination={paymentsPagination}
                loading={paymentsLoading}
                statusFilter={paymentsStatusFilter}
                onStatusFilterChange={(next) => {
                  setPaymentsStatusFilter(next);
                  setPaymentsPage(1);
                }}
                searchQuery={paymentsSearch}
                onSearchQueryChange={setPaymentsSearch}
                onPageChange={setPaymentsPage}
                onRefresh={() => void loadPayments(true)}
                onOpenNewPayment={openPaymentModal}
                resolveHeaders={resolveClientHeaders}
                apiUrl={apiUrl}
                onToast={showNotice}
              />
            )}
          </div>
        )}
      </main>

      {/* Submit Payment & Attach Receipt Modal */}
      {account && (
        <SubmitPaymentModal
          key={paymentModalKey}
          open={paymentModalOpen}
          channels={paymentChannels}
          openBills={billsList
            .filter((b) => b.billStatus !== "PAID" && b.balanceDue > 0)
            .map((b) => ({
              id: b.id,
              invoiceNumber: b.invoiceNumber,
              balanceDue: b.balanceDue,
              currency: b.currency,
            }))}
          initialChannelId={paymentModalPreset.channelId}
          initialAmount={paymentModalPreset.amount}
          initialLinkedInvoiceIds={paymentModalPreset.linkedInvoiceIds}
          initialLinkedRequestIds={paymentModalPreset.linkedRequestIds}
          resubmitTarget={paymentModalPreset.resubmitTarget}
          onClose={() => setPaymentModalOpen(false)}
          onSubmitted={async () => {
            await Promise.all([loadPayments(false), loadStatement(false), syncProfile(false)]);
          }}
          resolveHeaders={resolveClientHeaders}
          apiUrl={apiUrl}
          onToast={showNotice}
        />
      )}

      {/* Multi-Tenant Workspace Switcher Modal (Phase 21) */}
      {showWorkspaceModal && account && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setShowWorkspaceModal(false)}
        >
          <div
            dir="rtl"
            className="bg-white dark:bg-slate-900 rounded-2xl max-w-lg w-full p-5 space-y-4 shadow-2xl border border-slate-200 dark:border-slate-700 text-xs max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-100 dark:border-slate-800">
              <h3 className="text-sm font-black flex items-center gap-2">
                <Building2 className="w-4 h-4 text-emerald-600" />
                <span>منشآتي ومساحات العمل المسجلة</span>
              </h3>
              <button
                type="button"
                onClick={() => setShowWorkspaceModal(false)}
                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2">
              <div className="text-[11px] font-bold text-slate-500">
                حساباتك الحالية ({memberships.length || 1})
              </div>
              {memberships.length === 0 ? (
                <div className="p-3 rounded-xl border border-emerald-300 bg-emerald-50/50 dark:bg-emerald-950/30 flex items-center justify-between">
                  <div>
                    <div className="font-black">{tenantNameAr}</div>
                    <div className="text-[11px] font-mono text-slate-500">
                      <bdi dir="ltr">{tenantSlug}</bdi>
                    </div>
                  </div>
                  <span className="px-2.5 py-0.5 rounded-full bg-emerald-600 text-white font-bold">
                    الحالية
                  </span>
                </div>
              ) : (
                memberships.map((m) => {
                  const isCurrent = m.tenantSlug === tenantSlug;
                  return (
                    <div
                      key={m.id}
                      className={`p-3 rounded-xl border flex flex-wrap items-center justify-between gap-2 ${isCurrent
                          ? "border-emerald-400 bg-emerald-50/60 dark:bg-emerald-950/30"
                          : "border-slate-200 dark:border-slate-700"
                        }`}
                    >
                      <div className="space-y-0.5">
                        <div className="font-black text-xs flex items-center gap-2">
                          <span>{m.tenantName}</span>
                          <span className="font-mono text-[10px] text-slate-500">
                            <bdi dir="ltr">{m.tenantSlug}</bdi>
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500">
                          الرصيد: <strong>{formatMoney(m.balance)}</strong> • الحد الائتماني:{" "}
                          <strong>{formatMoney(m.creditLimit)}</strong>
                        </div>
                      </div>
                      {isCurrent ? (
                        <span className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white font-extrabold">
                          المساحة النشطة
                        </span>
                      ) : (
                        <button
                          type="button"
                          disabled={switchingTenantSlug === m.tenantSlug}
                          onClick={() => void handleSwitchTenant(m.tenantSlug, false)}
                          className="px-3 py-1.5 rounded-lg border border-emerald-500 text-emerald-700 dark:text-emerald-300 font-extrabold hover:bg-emerald-50 dark:hover:bg-emerald-950/40 disabled:opacity-50"
                        >
                          {switchingTenantSlug === m.tenantSlug ? "جاري التبديل..." : "الدخول للمنشأة"}
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {availableTenants.length > 0 && (
              <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <div className="text-[11px] font-bold text-slate-500">
                  الانضمام السريع لمنشأة أخرى بنفس رقم الجوال والبريد الموحد
                </div>
                <div className="space-y-1.5 max-h-44 overflow-y-auto">
                  {availableTenants.map((t) => (
                    <div
                      key={t.slug}
                      className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 flex items-center justify-between gap-2"
                    >
                      <div>
                        <div className="font-bold">{t.nameAr}</div>
                        <div className="text-[10px] font-mono text-slate-500">
                          <bdi dir="ltr">{t.slug}</bdi>
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={switchingTenantSlug === t.slug}
                        onClick={() => void handleSwitchTenant(t.slug, true)}
                        className="px-3 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold disabled:opacity-50"
                      >
                        {switchingTenantSlug === t.slug ? "جاري الربط..." : "تسجيل ودخول"}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
